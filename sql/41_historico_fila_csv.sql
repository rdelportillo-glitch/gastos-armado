-- ============================================================================
-- Histórico de asignación · fila completa del CSV de Carga.
-- Al "Finalizar día" se guarda, por cada registro, la fila exacta del CSV de Carga (jsonb) y su orden, para que el CSV del Histórico de asignación sea
-- igual al de Carga (mismas columnas, mismo orden). Los días ya cerrados quedan con estas columnas vacías y se arman con lo que se guardó.
-- Solo agrega dos columnas opcionales a assignment_history; no modifica ni borra datos. Se puede correr más de una vez.
-- ============================================================================

alter table public.assignment_history add column if not exists fila_csv jsonb;
alter table public.assignment_history add column if not exists csv_orden int;
notify pgrst, 'reload schema';
