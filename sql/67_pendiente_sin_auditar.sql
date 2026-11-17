-- ============================================================================
-- Histórico de asignación: lo que se finalizó sin auditar y volvió a pendientes debe quedar con la causal auditada PENDIENTE (no vacía).
-- Al finalizar el día en Carga, los registros sin realizar vuelven a pendientes para la próxima asignación; los que no se habían auditado se guardaban en el histórico con la
-- causal auditada vacía. Desde ahora el cierre del día los guarda con PENDIENTE; este script corrige los que ya estaban guardados.
--
-- Solo toca filas del histórico que: no están anuladas, tienen resultado "No realizado", NO tienen causal auditada, no son armados en almacén (esos traen su causal) y cuyo registro
-- de Carga no está cancelado ni anulado. Pone causal_auditada = 'PENDIENTE' y, si la fila trae su CSV guardado (fila_csv), también la columna "Causal auditada" (posición 29).
-- No toca filas con causal, ni Realizado, ni otras tablas. Se puede correr más de una vez.
--
-- Para ver cuántas va a cambiar ANTES de correr el UPDATE:
--   select count(*) from public.assignment_history h
--   where not h.anulado and h.resultado = 'No realizado' and btrim(coalesce(h.causal_auditada, '')) = '' and coalesce(h.tipo, '') <> 'Armado en almacén'
--     and not exists (select 1 from public.services s where s.id = h.service_id and (coalesce((s.asig ->> 'cancelada')::boolean, false) or coalesce(s.asig ? 'anulada', false)));
-- ============================================================================

update public.assignment_history h
set causal_auditada = 'PENDIENTE',
    fila_csv = case
      when h.fila_csv is not null and jsonb_typeof(h.fila_csv) = 'array' and jsonb_array_length(h.fila_csv) > 29
        then jsonb_set(h.fila_csv, '{29}', to_jsonb('PENDIENTE'::text))   -- posición 29 = columna "Causal auditada" del CSV de Carga
      else h.fila_csv
    end
where not h.anulado
  and h.resultado = 'No realizado'
  and btrim(coalesce(h.causal_auditada, '')) = ''
  and coalesce(h.tipo, '') <> 'Armado en almacén'
  and not exists (
    select 1 from public.services s
    where s.id = h.service_id and (coalesce((s.asig ->> 'cancelada')::boolean, false) or coalesce(s.asig ? 'anulada', false))
  );
