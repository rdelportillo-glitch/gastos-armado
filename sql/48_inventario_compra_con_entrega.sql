-- ============================================================================
-- 48 · Inventario: compra con entrega al técnico en un solo registro
--
-- Al registrar una compra se puede indicar el técnico que la recibe: se crean la compra (entra al stock y va a Gastos, como siempre)
-- y la entrega al técnico (sale del stock). La entrega queda ligada a la compra con related_movement_id: si la compra se anula,
-- su entrega también se anula, para que el stock no quede descuadrado.
--
-- No cambia RLS (las políticas de stock_movements ya existen). Se puede correr más de una vez. No modifica datos existentes.
-- ============================================================================

alter table public.stock_movements add column if not exists related_movement_id uuid references public.stock_movements(id);
create index if not exists idx_stock_movements_related_movement on public.stock_movements(related_movement_id);

notify pgrst, 'reload schema';
