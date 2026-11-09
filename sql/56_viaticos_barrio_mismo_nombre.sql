-- ============================================================================
-- Viáticos por municipio: un barrio puede llamarse igual que un municipio (ej. PUNTA CANOA es municipio en Bolívar y también un barrio de Cartagena).
--   Hasta ahora la tabla era única por (departamento, municipio), y no dejaba crear el barrio. Ahora la unicidad es por tipo:
--     · MUNICIPIO: único por (departamento, municipio), como siempre.
--     · BARRIO: único por (departamento, barrio, municipio al que pertenece).
-- Solo cambia los índices únicos; no modifica ni borra datos (todas las filas actuales son MUNICIPIO). Requiere el sql 55. Se puede correr más de una vez.
-- Nota: el sql 43 (carga inicial) usa el índice anterior; ya está cargado, no hay que volver a correrlo.
-- ============================================================================

drop index if exists public.viatico_municipios_unique;
create unique index if not exists viatico_municipios_unique_municipio on public.viatico_municipios (upper(btrim(department)), upper(btrim(municipality))) where kind = 'MUNICIPIO';
create unique index if not exists viatico_municipios_unique_barrio on public.viatico_municipios (upper(btrim(department)), upper(btrim(municipality)), upper(btrim(coalesce(parent_city, '')))) where kind = 'BARRIO';

notify pgrst, 'reload schema';
