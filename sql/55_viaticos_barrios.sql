-- ============================================================================
-- Viáticos por municipio: barrios que se pagan como municipios (ej. Punta Canoa).
--   - public.viatico_municipios.kind: MUNICIPIO (por defecto, como hasta ahora) o BARRIO. Una fila BARRIO usa el nombre del barrio en "municipality" y se aplica a los servicios
--     cuyo barrio sea ese (en el departamento de la fila); tiene prioridad sobre el municipio del servicio y cuenta como una ciudad más para el adicional por ciudad.
--   - public.viatico_municipios.parent_city: municipio al que pertenece el barrio (opcional). Si se llena, la fila solo aplica a los servicios de ese municipio.
-- Solo agrega dos columnas; las filas que ya existen quedan como MUNICIPIO. No borra ni modifica datos. Se puede correr más de una vez.
-- ============================================================================

alter table public.viatico_municipios add column if not exists kind text not null default 'MUNICIPIO' check (kind in ('MUNICIPIO', 'BARRIO'));
alter table public.viatico_municipios add column if not exists parent_city text;

notify pgrst, 'reload schema';
