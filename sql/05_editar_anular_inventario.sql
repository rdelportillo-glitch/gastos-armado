-- ============================================================================
-- Editar y anular movimientos de inventario (compras / entregas)
-- Ejecutar en el SQL Editor de Supabase DESPUÉS de 01, 02 y 03.
-- ============================================================================
-- No se permite eliminar físicamente un movimiento: se "anula" (se conserva
-- el registro, se excluye del stock disponible y queda visible con el
-- motivo). Es el mismo patrón que ya usa la tabla "expenses".
--
-- related_expense_id vincula una "Compra" de inventario con el gasto
-- ("Compra de stock") que la app genera automáticamente junto con ella, para
-- poder anular o corregir ambos registros de forma consistente. Las
-- "Entregas" no generan gasto, así que este campo queda vacío en ellas.

alter table public.stock_movements
  add column status text not null default 'Activo' check (status in ('Activo', 'Anulado')),
  add column annul_reason text,
  add column annul_user_id uuid references public.profiles(id),
  add column annul_date date,
  add column related_expense_id uuid references public.expenses(id);

create index idx_stock_movements_status on public.stock_movements(status);
create index idx_stock_movements_related_expense on public.stock_movements(related_expense_id);

-- No se requieren cambios de RLS: la política "stock_movements_update_admin"
-- (creada en 02_rls.sql) ya permite que un administrador actualice
-- cualquier columna de cualquier movimiento; la edición y anulación quedan
-- restringidas a ese rol sin necesidad de una política adicional.
