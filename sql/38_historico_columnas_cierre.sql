-- ============================================================================
-- Histórico de asignación · columnas de cierre de la plantilla de Carga (U a AC):
-- ARMADO?, CAUSALES, SUBCAUSALES, NOTAS, GARANTIA, SOLUCION, AUDITORIA, PRIMER PISO y VALOR INSTALACION DE TV.
-- Solo agrega columnas nuevas (todas opcionales) a assignment_history; no modifica ni borra datos existentes.
-- Se puede correr más de una vez sin problema.
-- ============================================================================

alter table public.assignment_history add column if not exists armado text;
alter table public.assignment_history add column if not exists causales text;
alter table public.assignment_history add column if not exists subcausales text;
alter table public.assignment_history add column if not exists notas text;
alter table public.assignment_history add column if not exists garantia text;
alter table public.assignment_history add column if not exists solucion text;
alter table public.assignment_history add column if not exists auditoria text;
alter table public.assignment_history add column if not exists primer_piso text;
alter table public.assignment_history add column if not exists valor_tv numeric;
