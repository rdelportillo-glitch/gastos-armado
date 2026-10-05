-- ============================================================================
-- Asignación · Fase 1 (ajustes)
--  1) Ubicación operativa del personal de campo: 'Disponible' (sale a ruta) o 'Sede'.
--  2) Un mismo barrio/municipio puede existir en varios departamentos (por ejemplo
--     CASCAJAL en Atlántico y en Bolívar): la llave única pasa a incluir la región.
-- Se puede correr más de una vez sin problema.
-- ============================================================================
alter table public.technicians add column if not exists operation_site text;

alter table public.geo_neighborhoods drop constraint if exists geo_neighborhoods_city_neighborhood_key;
alter table public.geo_neighborhoods alter column region set not null;
alter table public.geo_neighborhoods drop constraint if exists geo_neighborhoods_region_city_neighborhood_key;
alter table public.geo_neighborhoods add constraint geo_neighborhoods_region_city_neighborhood_key unique (region, city, neighborhood);
