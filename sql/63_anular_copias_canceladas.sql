-- ============================================================================
-- Histórico de asignación: copias canceladas que quedaron guardadas como "Realizado" sin técnico.
-- Caso: servicios repetidos (carga duplicada) que se cancelaron, pero al finalizar el día se guardaron en el histórico como una fila más, sin técnico, con el mismo
-- servicio y producto de la fila buena (la que sí tiene técnico). Eso infla el histórico y los reportes.
--
-- Este script ANULA (no borra) solo esas filas: las que no tienen técnico, cuyo registro de Carga está cancelado y para las que ya existe, el mismo día, otra fila del
-- mismo servicio y producto CON técnico. Quedan guardadas con el motivo y se pueden restaurar desde el Histórico (solo administrador). No cuentan en reportes ni CSV.
-- No toca: filas sin técnico que no tienen una fila gemela con técnico (por ejemplo sobrecarga o almacén), ni nada de otras tablas.
-- Se puede correr más de una vez (las ya anuladas no se tocan).
--
-- Para ver cuántas va a anular ANTES de correr el UPDATE, corre solo este SELECT (debe dar 57 con los datos del 11/11):
--   select count(*) from public.assignment_history h join public.services s on s.id = h.service_id
--   where not h.anulado and h.technician_id is null and coalesce(h.technician_name,'') = ''
--     and coalesce((s.asig->>'cancelada')::boolean, false)
--     and exists (select 1 from public.assignment_history h2 where h2.id <> h.id and h2.day = h.day and h2.servicio = h.servicio
--                 and h2.producto is not distinct from h.producto and not h2.anulado
--                 and (h2.technician_id is not null or coalesce(h2.technician_name,'') <> ''));
-- ============================================================================

update public.assignment_history h
set anulado = true,
    anulado_motivo = 'Registro repetido: copia cancelada del mismo servicio y producto (ya existe con tecnico ese dia)'
from public.services s
where s.id = h.service_id
  and not h.anulado
  and h.technician_id is null
  and coalesce(h.technician_name, '') = ''
  and coalesce((s.asig->>'cancelada')::boolean, false)
  and exists (
    select 1 from public.assignment_history h2
    where h2.id <> h.id and h2.day = h.day and h2.servicio = h.servicio
      and h2.producto is not distinct from h.producto and not h2.anulado
      and (h2.technician_id is not null or coalesce(h2.technician_name, '') <> '')
  );
