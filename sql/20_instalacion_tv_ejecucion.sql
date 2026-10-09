-- ============================================================================
-- Instalación de TV · Fase 2: ejecución en campo, cobro y controles
-- Agrega a tv_offers lo que faltaba para el control de cobros de la propuesta:
--   ejecucion_nota        motivo cuando la instalación no se realizó o se reprogramó
--   efectivo_entregado    el técnico entregó el efectivo al jefe de operaciones (con recibo)
--   efectivo_entregado_at cuándo se entregó
--   comprobante_ref       referencia del comprobante de la transferencia verificada
--   ejecucion_by          quién registró el resultado
-- Se puede correr más de una vez sin problema. No modifica datos existentes.
-- ============================================================================

alter table public.tv_offers add column if not exists ejecucion_nota text;
alter table public.tv_offers add column if not exists efectivo_entregado boolean not null default false;
alter table public.tv_offers add column if not exists efectivo_entregado_at timestamptz;
alter table public.tv_offers add column if not exists comprobante_ref text;
alter table public.tv_offers add column if not exists ejecucion_by uuid references public.profiles(id);

-- No se requieren cambios de RLS: las políticas de tv_offers ya permiten actualizar a administrador y operador.
