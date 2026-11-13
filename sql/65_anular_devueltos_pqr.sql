-- ============================================================================
-- Histórico de asignación: PQR de armados en almacén que se enviaron a la Asignación del domingo 8 y se cerraron como "devueltos por proveedor" (ALMACEN).
-- Esas filas (servicio AA-000064, AA-000065 y AA-000066, "No realizado") no son armados reales: el armado entra al histórico cuando se CIERRA el PQR en Armados en almacén.
-- Este script las ANULA (no borra): quedan guardadas con el motivo y se pueden restaurar desde el Histórico (solo administrador). No cuentan en reportes ni CSV.
-- NO toca las filas que entraron al cerrar el PQR (servicio = número de PQR, las que salen en store_assemblies), ni la fila "Realizado" de AA-000066 (PANEL DE TV DALLAS,
-- armado por un técnico en la asignación del 09/11), ni nada de otras tablas. Se puede correr más de una vez.
--
-- Para ver cuántas va a anular ANTES de correr el UPDATE (deben ser 10: 2 de AA-000064, 1 de AA-000065 y 7 de AA-000066):
--   select r.request_no, count(*) from public.store_requests r join public.assignment_history h
--     on (h.servicio = r.request_no or h.servicio like r.request_no || '-%')
--   where r.pqr_number in ('267852954', '267853102', '267851315') and not h.anulado and h.resultado = 'No realizado'
--     and not exists (select 1 from public.store_assemblies a where a.request_id = r.id and a.id = h.service_id)
--   group by r.request_no order by 1;
-- ============================================================================

update public.assignment_history h
set anulado = true,
    anulado_motivo = 'Devuelto por proveedor desde Asignacion: el armado entra al historico al cerrar el PQR'
from public.store_requests r
where r.pqr_number in ('267852954', '267853102', '267851315')
  and (h.servicio = r.request_no or h.servicio like r.request_no || '-%')
  and not h.anulado
  and h.resultado = 'No realizado'
  and not exists (select 1 from public.store_assemblies a where a.request_id = r.id and a.id = h.service_id);
