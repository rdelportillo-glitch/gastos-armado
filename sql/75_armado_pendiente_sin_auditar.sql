-- ============================================================================
-- Histórico de asignación: los servicios que se finalizaron sin auditar (la plataforma les puso la causal auditada PENDIENTE al cerrar el día)
-- quedaron con la columna ARMADO? vacía. Debe decir PENDIENTE, igual que cuando se audita a mano con esa causal.
-- Solo cambia filas del histórico NO anuladas, con causal auditada que contiene PENDIENTE y ARMADO? vacío. No toca CANCELADOS, SI ni NO, ni otras tablas.
-- Actualiza la columna armado y, si la fila guarda su CSV (fila_csv), también la posición 20 (columna "ARMADO?"). Se puede correr más de una vez.
--
-- Para ver cuántas cambia ANTES de correr el UPDATE:
--   select count(*) from public.assignment_history h
--   where not h.anulado and upper(coalesce(h.causal_auditada, '')) like '%PENDIENTE%' and coalesce(h.armado, '') = '';
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
  and coalesce(h.armado, '') = '';
