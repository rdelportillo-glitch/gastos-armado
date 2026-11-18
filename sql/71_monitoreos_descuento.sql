-- ============================================================================
-- Monitoreos: descuento. Cada monitoreo puede indicar si aplica descuento y el valor a descontar.
--   applies_discount: true / false (por defecto false)
--   discount_value:   valor en pesos a descontar (0 si no aplica)
-- Solo agrega dos columnas con valor por defecto: los monitoreos existentes quedan "sin descuento". No cambia permisos ni borra nada. Se puede correr más de una vez.
-- ============================================================================

alter table public.monitoring_records add column if not exists applies_discount boolean not null default false;
alter table public.monitoring_records add column if not exists discount_value numeric not null default 0;
