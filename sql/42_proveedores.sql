-- ============================================================================
-- Proveedores (categoría Gastos): tabla de proveedores con sus datos de pago y el vínculo del gasto con el proveedor.
--   1) public.suppliers: proveedores (nombre/ID, identificación, titular, banco, tipo y número de cuenta, observaciones, estado). No se borran: se inactivan.
--   2) public.expenses.supplier_id: un gasto se paga a una persona de Personal (technician_id) o a un proveedor (supplier_id).
-- Solo crea una tabla nueva y agrega una columna opcional; no modifica ni borra datos existentes. Se puede correr más de una vez.
-- ============================================================================

create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  id_type text,
  id_number text,
  holder_first_name text,
  holder_last_name text,
  bank_code text,
  account_type text,
  account_number text,
  observations text,
  status text not null default 'Activo' check (status in ('Activo', 'Inactivo')),
  created_at timestamptz not null default now()
);
-- No permite dos proveedores con el mismo nombre, sin importar mayúsculas ni espacios en los extremos.
create unique index if not exists suppliers_name_unique on public.suppliers (upper(btrim(name)));

alter table public.suppliers enable row level security;
drop policy if exists "suppliers_select_all" on public.suppliers;
drop policy if exists "suppliers_insert_admin_operador" on public.suppliers;
drop policy if exists "suppliers_update_admin_operador" on public.suppliers;
-- Cualquier usuario activo los lee (el historial de gastos muestra a quién se pagó); solo administrador y operador crean o editan. No hay DELETE.
create policy "suppliers_select_all" on public.suppliers for select using (public.is_active_user());
create policy "suppliers_insert_admin_operador" on public.suppliers for insert with check (public.current_role() in ('admin', 'operador'));
create policy "suppliers_update_admin_operador" on public.suppliers for update
  using (public.current_role() in ('admin', 'operador')) with check (public.current_role() in ('admin', 'operador'));

alter table public.expenses add column if not exists supplier_id uuid references public.suppliers(id);
create index if not exists idx_expenses_supplier on public.expenses(supplier_id);
notify pgrst, 'reload schema';
