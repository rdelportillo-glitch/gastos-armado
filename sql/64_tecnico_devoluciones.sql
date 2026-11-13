-- ============================================================================
-- Histórico de asignación: las devoluciones (ALMACEN, SOBRECARGA, EMPAQUE COLCHONES) deben tener ese motivo como técnico.
-- En Carga, un servicio devuelto sin técnico lleva el motivo como técnico y como causal; algunas filas del histórico (p. ej. las del 04/11) quedaron con la causal pero
-- sin técnico. Este script rellena el técnico con la causal auditada en las filas del histórico que no tienen técnico (ni ficha ni nombre) y cuya causal auditada es una de
-- esas tres. También pone el nombre en la columna TECNICO del CSV guardado de esa fila (fila_csv), para que el CSV del Histórico coincida.
-- No toca filas con técnico, ni anuladas, ni otras causales, ni otras tablas. Se puede correr más de una vez.
--
-- Para ver cuántas va a cambiar ANTES de correr el UPDATE (deben ser 11 con los datos del 04/11):
--   select count(*) from public.assignment_history
--   where not anulado and technician_id is null and coalesce(technician_name,'') = ''
--     and upper(btrim(coalesce(causal_auditada,''))) in ('ALMACEN','SOBRECARGA','EMPAQUE COLCHONES');
-- ============================================================================

update public.assignment_history
set technician_name = upper(btrim(causal_auditada)),
    fila_csv = case
      when fila_csv is not null and jsonb_typeof(fila_csv) = 'array' and jsonb_array_length(fila_csv) > 16
        then jsonb_set(fila_csv, '{16}', to_jsonb(upper(btrim(causal_auditada))))   -- posición 16 = columna TECNICO del CSV de Carga
      else fila_csv
    end
where not anulado
  and technician_id is null
  and coalesce(technician_name, '') = ''
  and upper(btrim(coalesce(causal_auditada, ''))) in ('ALMACEN', 'SOBRECARGA', 'EMPAQUE COLCHONES');
