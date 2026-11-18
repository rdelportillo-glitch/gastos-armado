-- ============================================================================
-- Histórico de asignación: si la causal auditada es PENDIENTE, la columna ARMADO? también dice PENDIENTE (antes decía NO).
-- Solo cambia filas del histórico no anuladas cuya causal auditada contiene PENDIENTE y cuyo ARMADO? no es CANCELADOS ni ya PENDIENTE.
-- Actualiza la columna armado y, si la fila guarda su CSV (fila_csv), también la posición 20 (columna "ARMADO?"). No toca otras tablas ni otras filas. Se puede correr más de una vez.
--
-- Para ver cuántas cambia ANTES de correr el UPDATE:
--   select count(*) from public.assignment_history h
--   where not h.anulado and upper(coalesce(h.causal_auditada, '')) like '%PENDIENTE%' and coalesce(h.armado, '') not in ('PENDIENTE', 'CANCELADOS');
-- ============================================================================

update public.assignment_history h
set armado = 'PENDIENTE',
    fila_csv = case
      when h.fila_csv is not null and jsonb_typeof(h.fila_csv) = 'array' and jsonb_array_length(h.fila_csv) > 20
        then jsonb_set(h.fila_csv, '{20}', to_jsonb('PENDIENTE'::text))   -- posición 20 = columna "ARMADO?" del CSV de Carga
      else h.fila_csv
    end
where not h.anulado
  and upper(coalesce(h.causal_auditada, '')) like '%PENDIENTE%'
  and coalesce(h.armado, '') not in ('PENDIENTE', 'CANCELADOS');
