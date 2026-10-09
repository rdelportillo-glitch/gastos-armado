-- ============================================================================
-- Instalación de TV · Adicionales configurables
-- Permite que el administrador agregue más adicionales (ej. "Soporte de TV") en Configuración.
-- Cada oferta guarda la lista de adicionales elegidos, con su nombre, valor y minutos de ese momento
-- (así un cambio posterior de precios no altera lo ya ofrecido). Las tres casillas anteriores
-- (desmonte, cables, punto eléctrico) se siguen guardando; las ofertas viejas siguen funcionando.
-- Se puede correr más de una vez sin problema. No modifica datos existentes.
-- ============================================================================

alter table public.tv_offers add column if not exists adicionales jsonb not null default '[]'::jsonb;

-- No se requieren cambios de RLS.
