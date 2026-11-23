-- ============================================================================
-- Carga masiva (Carga): los servicios cargados SIN técnico ahora entran a Carga "En gestión" (antes quedaban "Pendiente" en Asignación).
-- Este script pasa a Carga los que ya se habían cargado antes del cambio y siguen Pendientes: origen "Carga masiva", sin técnico, sin cerrar,
-- no cancelados ni anulados, con fecha de servicio desde el 21/11/2026. Solo cambia estado_gestion (Pendiente → En gestión). No borra nada.
-- Es reversible: volver a poner estado_gestion = 'Pendiente' en esos registros los devuelve a Asignación. Se puede correr más de una vez.
--
-- Para ver cuántos cambia ANTES de correr el UPDATE:
--   select count(*), count(distinct servicio_externo), min(date), max(date) from public.services s
--   where s.estado_gestion = 'Pendiente' and s.finalized_at is null and s.technician_id is null and s.date >= '2026-11-21'
--     and (s.asig->>'origen') = 'Carga masiva' and coalesce((s.asig->>'cancelada')::boolean, false) = false and coalesce((s.asig->>'anulada')::boolean, false) = false;
-- ============================================================================

update public.services s
set estado_gestion = 'En gestión'
where s.estado_gestion = 'Pendiente'
  and s.finalized_at is null
  and s.technician_id is null
  and s.date >= '2026-11-21'
  and (s.asig->>'origen') = 'Carga masiva'
  and coalesce((s.asig->>'cancelada')::boolean, false) = false
  and coalesce((s.asig->>'anulada')::boolean, false) = false;
