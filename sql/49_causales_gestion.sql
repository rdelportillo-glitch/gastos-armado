-- ============================================================================
-- 49 · Maestro de causales · columna "Gestión" configurable
--
-- Gestión de la causal (Maestros → Causales):
--   Normal    → la causal cierra la gestión: al auditarla el registro pasa a Realizado.
--   Pendiente → el servicio queda por reprogramar: se ve en rojo, sigue En gestión y vuelve a Asignación al finalizar el día.
--   Cancelado → el servicio se cancela: se ve en rojo y el registro queda como cancelado (igual que Cliente cancela): no vuelve a Asignación.
-- Solo agrega una columna opcional a public.causales y la llena donde aún está vacía:
--   · las causales que contienen PENDIENTE → Pendiente (así funcionaba ya, por el nombre);
--   · CLIENTE CANCELA y CLIENTE ARMA - LLAMADA → Cancelado.
-- No borra ni modifica otros datos. Se puede correr más de una vez.
-- ============================================================================

alter table public.causales add column if not exists gestion text;

update public.causales set gestion = 'Pendiente' where gestion is null and upper(name) like '%PENDIENTE%';
update public.causales set gestion = 'Cancelado' where gestion is null and upper(btrim(name)) in ('CLIENTE CANCELA', 'CLIENTE ARMA - LLAMADA');

notify pgrst, 'reload schema';
