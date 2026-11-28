-- ============================================================================
-- 82 · Instalación de TV → Ejecución y cobro: opción "Sin técnico"
-- Marca que la instalación se registró expresamente sin técnico. Sin la marca, una instalación con el técnico vacío toma el del servicio (Carga o histórico);
-- con la marca no se le atribuye a nadie (tabla, concreción y Técnico integral).
-- Solo agrega una columna (por defecto falso). No modifica datos ni permisos: el técnico no puede cambiarla (lo impide el disparador de sql/45 y 46).
-- Se puede correr más de una vez.
-- ============================================================================

alter table public.tv_offers add column if not exists sin_tecnico boolean not null default false;

notify pgrst, 'reload schema';

-- Comprobación (opcional): debe devolver 1 fila
-- select column_name from information_schema.columns where table_schema = 'public' and table_name = 'tv_offers' and column_name = 'sin_tecnico';
