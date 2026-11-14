-- ============================================================================
-- Programación de servicios · seguimiento de las órdenes para el cliente (Jamar)
--
-- El usuario de Jamar (rol cliente) solo veía "Programada" o "Cancelada" en sus órdenes, porque no puede leer los servicios de Asignación/Carga. Esta función le devuelve,
-- SOLO de sus propias órdenes, el estado real calculado con los servicios de cada orden (igual que lo ve el equipo en Programación) y un detalle con el resultado:
--   · Programada          · aún no está asignada a un técnico (o no hay servicios en Asignación)
--   · En gestión          · asignada a un técnico (se muestra la fecha de la visita)
--   · Realizada           · gestión cerrada: el detalle trae la causal con la que se cerró (armado, cliente cancela, dirección errada...)
--   · Realizada parcial   · parte de los productos ya se gestionó
--   · No realizada        · el servicio no se pudo realizar (el detalle trae la causal) y vuelve a programarse
--   · Cancelada
-- No devuelve nombres de técnicos, precios ni datos de otras órdenes. Un cliente solo recibe las órdenes que él creó; admin, operador y consulta reciben todas.
-- Solo agrega una función de lectura (no crea tablas ni cambia datos). Se puede correr más de una vez.
-- ============================================================================

create or replace function public.cliente_seguimiento_ordenes()
returns table (order_id uuid, estado text, detalle text, fecha date)
language sql stable security definer set search_path = public as $$
  with ordenes as (
    select o.id, o.order_no, o.status, coalesce(nullif(btrim(o.service_number), ''), o.order_no) as servicio
    from public.service_orders o
    where public.current_role() in ('admin', 'operador', 'consulta')
       or (public.current_role() = 'cliente' and o.created_by = auth.uid())
  ),
  sv as (
    select o.id as order_id, s.id as service_id, s.estado_gestion, s.finalized_at, s.date as dia, s.causal_auditada, s.causal_extreme
    from ordenes o
    join public.services s on (
      (s.asig ->> 'ordenId') = o.id::text
      or ((s.asig ->> 'ordenId') is null and (s.servicio_externo = o.order_no or s.servicio_externo = o.servicio))
    )
    where not coalesce((s.asig ->> 'cancelada')::boolean, false) and not coalesce(s.asig ? 'anulada', false)
  ),
  ult as (  -- resultado más reciente de cada servicio en el histórico de asignación
    select distinct on (h.service_id) h.service_id, h.resultado, h.causal_auditada, h.causal_extreme, h.day
    from public.assignment_history h
    where h.service_id in (select service_id from sv) and not h.anulado
    order by h.service_id, h.day desc
  ),
  det as (
    select sv.order_id, sv.service_id, sv.estado_gestion, sv.finalized_at, sv.dia, u.resultado, u.day as dia_hist,
           coalesce(nullif(btrim(sv.causal_auditada), ''), nullif(btrim(sv.causal_extreme), ''), nullif(btrim(u.causal_auditada), ''), nullif(btrim(u.causal_extreme), '')) as causal
    from sv left join ult u on u.service_id = sv.service_id
  ),
  resumen as (
    select o.id, o.status,
      count(d.service_id) as total,
      count(*) filter (where d.service_id is not null and (d.estado_gestion = 'Realizado' or d.finalized_at is not null)) as hechos,
      count(*) filter (where d.estado_gestion = 'En gestión' and d.finalized_at is null) as en_gestion,
      count(*) filter (where d.estado_gestion = 'Pendiente' and d.finalized_at is null and d.resultado = 'No realizado') as no_realizados,
      string_agg(distinct d.causal, ', ') filter (where d.estado_gestion = 'Realizado' or d.finalized_at is not null) as causales_hechos,
      string_agg(distinct d.causal, ', ') filter (where d.estado_gestion = 'Pendiente' and d.finalized_at is null and d.resultado = 'No realizado') as causales_no,
      max(d.dia) as ultimo_dia
    from ordenes o left join det d on d.order_id = o.id
    group by o.id, o.status
  )
  select r.id,
    case when r.status = 'Cancelada' then 'Cancelada'
         when r.total = 0 then 'Programada'
         when r.hechos = r.total then 'Realizada'
         when r.hechos > 0 then 'Realizada parcial'
         when r.en_gestion > 0 then 'En gestión'
         when r.no_realizados > 0 then 'No realizada'
         else 'Programada' end,
    case when r.status = 'Cancelada' then null
         when r.total = 0 then null
         when r.hechos = r.total then nullif('Resultado: ' || coalesce(r.causales_hechos, ''), 'Resultado: ')
         when r.hechos > 0 then r.hechos || ' de ' || r.total || ' productos gestionados' || coalesce(' · ' || r.causales_hechos, '')
         when r.en_gestion > 0 then 'Asignada a un técnico para el ' || to_char(r.ultimo_dia, 'DD/MM/YYYY')
         when r.no_realizados > 0 then 'No se pudo realizar' || coalesce(': ' || r.causales_no, '') || ' · vuelve a programarse'
         else null end,
    r.ultimo_dia
  from resumen r;
$$;

revoke all on function public.cliente_seguimiento_ordenes() from public;
grant execute on function public.cliente_seguimiento_ordenes() to authenticated;

notify pgrst, 'reload schema';
