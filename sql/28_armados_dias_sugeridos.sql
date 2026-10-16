-- ============================================================================
-- Armados en almacén · días sugeridos y datos del almacén para Asignación
--  1) store_requests.suggested_days / target_date: días sugeridos para terminar el PQR y la fecha límite que resulta.
--  2) warehouses.neighborhood / address: barrio y dirección del almacén. Con departamento, ciudad y barrio del maestro de zonas,
--     las unidades pendientes de la solicitud entran a Asignación ubicadas en su zona.
--  3) Corrige el departamento del almacén de ejemplo al nombre que usa el maestro de zonas (GUAJIRA).
-- Se puede correr más de una vez sin problema. No borra ni cambia datos existentes (salvo el departamento del punto 3).
-- ============================================================================

alter table public.store_requests add column if not exists suggested_days int;
alter table public.store_requests add column if not exists target_date date;
update public.store_requests set target_date = commitment_date where target_date is null and commitment_date is not null;

alter table public.warehouses add column if not exists neighborhood text;
alter table public.warehouses add column if not exists address text;

update public.warehouses set department = 'GUAJIRA' where name = 'ALMACEN RIOACHA' and department = 'LA GUAJIRA';
