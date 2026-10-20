-- ============================================================================
-- Instalación de TV · Valor facturado
-- Agrega a tv_offers el valor facturado de la instalación (distinto del valor cobrado al cliente):
--   valor_facturado   monto facturado por la instalación realizada
-- Se puede correr más de una vez sin problema. No modifica datos existentes.
-- No se requieren cambios de RLS: las políticas de tv_offers ya permiten actualizar a administrador y operador.
-- ============================================================================

alter table public.tv_offers add column if not exists valor_facturado numeric;
