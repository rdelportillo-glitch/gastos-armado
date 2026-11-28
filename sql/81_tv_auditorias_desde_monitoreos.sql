-- ============================================================================
-- 81 · Descuentos centralizados en Auditoría (Instalación de TV)
--   1) tv_auditorias acepta auditorías que vienen de un monitoreo (sin instalación "No realizada" asociada) y guarda técnico y fecha del servicio.
--   2) COPIA los descuentos de los monitoreos activos (¿Aplica descuento? = sí) a Auditoría, con el valor, las observaciones y el número del monitoreo (MD-...).
--      Si el servicio tiene una instalación "No realizada" sin auditar, queda enlazada a ella.
-- No borra ni modifica nada de los monitoreos: sus datos siguen guardados. Se puede correr más de una vez (no duplica). Requiere sql/80, sql/36 y sql/71.
-- ============================================================================

alter table public.tv_auditorias add column if not exists id uuid not null default gen_random_uuid();
alter table public.tv_auditorias add column if not exists tecnico_id uuid references public.technicians(id);
alter table public.tv_auditorias add column if not exists tecnico_nombre text;
alter table public.tv_auditorias add column if not exists fecha_servicio date;
alter table public.tv_auditorias add column if not exists monitoreo_id uuid references public.monitoring_records(id);
alter table public.tv_auditorias add column if not exists monitoreo_no text;

-- La llave pasa de la oferta a un id propio (una auditoría de monitoreo puede no tener oferta)
do $$ begin
  if exists (select 1 from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
             where c.conrelid = 'public.tv_auditorias'::regclass and c.contype = 'p' and a.attname = 'offer_id') then
    alter table public.tv_auditorias drop constraint tv_auditorias_pkey;
    alter table public.tv_auditorias add primary key (id);
  end if;
end $$;
alter table public.tv_auditorias alter column offer_id drop not null;
alter table public.tv_auditorias alter column resultado drop not null;
create unique index if not exists tv_auditorias_offer_uq on public.tv_auditorias(offer_id);
create unique index if not exists tv_auditorias_monitoreo_uq on public.tv_auditorias(monitoreo_id);
alter table public.tv_auditorias drop constraint if exists tv_auditorias_origen;
alter table public.tv_auditorias add constraint tv_auditorias_origen check (offer_id is not null or monitoreo_id is not null);

-- Quién y cuándo: solo se pone solo cuando hay una persona con sesión (la copia conserva el auditor y la fecha del monitoreo)
create or replace function public.tv_auditorias_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null then
    new.auditado_por := auth.uid();
    new.auditado_por_nombre := (select name from public.profiles where id = auth.uid());
    new.auditado_at := now();
  end if;
  return new;
end $$;

-- Copia de los descuentos de monitoreo
insert into public.tv_auditorias (offer_id, servicio, aplica_descuento, valor, comentarios, tecnico_id, tecnico_nombre, fecha_servicio, monitoreo_id, monitoreo_no, auditado_por, auditado_por_nombre, auditado_at)
select o.id, m.servicio, true, m.discount_value, nullif(btrim(m.observations), ''), m.technician_id, m.technician_name, o.fecha_prog, m.id, m.record_no, m.auditor_id, m.auditor_name, m.audit_date::timestamp + interval '12 hours'
from (
  select r.*, btrim(coalesce(r.service_no, '')) as servicio, row_number() over (partition by btrim(coalesce(r.service_no, '')) order by r.audit_date, r.record_no) as n
  from public.monitoring_records r
  where r.applies_discount and coalesce(r.discount_value, 0) > 0 and r.status = 'Activo'
) m
left join public.tv_offers o on m.n = 1 and o.servicio = m.servicio and o.ejecucion = 'No realizada'
  and not exists (select 1 from public.tv_auditorias a where a.offer_id = o.id)
where not exists (select 1 from public.tv_auditorias a where a.monitoreo_id = m.id);

-- Comprobación (opcional): cuántas auditorías vinieron de monitoreo y su valor total
-- select count(*), sum(valor) from public.tv_auditorias where monitoreo_id is not null;
