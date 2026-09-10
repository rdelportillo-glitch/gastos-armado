-- ============================================================================
-- ROW LEVEL SECURITY — permisos aplicados directamente en la base de datos
-- Roles: admin | operador | consulta  (definidos en profiles.role)
-- ============================================================================

create or replace function public.current_role()
returns text as $$
  select role from public.profiles where id = auth.uid();
$$ language sql stable security definer;

create or replace function public.is_active_user()
returns boolean as $$
  select coalesce((select active from public.profiles where id = auth.uid()), false);
$$ language sql stable security definer;

alter table public.profiles enable row level security;
alter table public.technicians enable row level security;
alter table public.categories enable row level security;
alter table public.subcategories enable row level security;
alter table public.products enable row level security;
alter table public.expenses enable row level security;
alter table public.assets enable row level security;
alter table public.asset_assignments enable row level security;
alter table public.audit_log enable row level security;
alter table public.services enable row level security;
alter table public.asset_types enable row level security;
alter table public.stock_movements enable row level security;

-- ---------------------------- PROFILES --------------------------------------
create policy "profiles_select_authenticated" on public.profiles
  for select using (auth.role() = 'authenticated');

create policy "profiles_update_self_or_admin" on public.profiles
  for update using (auth.uid() = id or public.current_role() = 'admin');
-- Nota: la creación de usuarios NO se hace por INSERT directo desde el
-- cliente (bloqueado por RLS); se hace mediante la Edge Function
-- "create-user" con la service role key, que crea el auth.user y dispara
-- el trigger handle_new_user().

-- ------------------------- MAESTROS (solo admin escribe) --------------------
create policy "technicians_select_all" on public.technicians
  for select using (public.is_active_user());
create policy "technicians_write_admin" on public.technicians
  for insert with check (public.current_role() = 'admin');
create policy "technicians_update_admin" on public.technicians
  for update using (public.current_role() = 'admin');

create policy "categories_select_all" on public.categories
  for select using (public.is_active_user());
create policy "categories_write_admin" on public.categories
  for insert with check (public.current_role() = 'admin');
create policy "categories_update_admin" on public.categories
  for update using (public.current_role() = 'admin');

create policy "subcategories_select_all" on public.subcategories
  for select using (public.is_active_user());
create policy "subcategories_write_admin" on public.subcategories
  for insert with check (public.current_role() = 'admin');
create policy "subcategories_update_admin" on public.subcategories
  for update using (public.current_role() = 'admin');

create policy "products_select_all" on public.products
  for select using (public.is_active_user());
create policy "products_write_admin" on public.products
  for insert with check (public.current_role() = 'admin');
create policy "products_update_admin" on public.products
  for update using (public.current_role() = 'admin');

-- ------------------------------ GASTOS --------------------------------------
create policy "expenses_select_all" on public.expenses
  for select using (public.is_active_user());

create policy "expenses_insert_admin_operador" on public.expenses
  for insert with check (public.current_role() in ('admin', 'operador'));

-- Un administrador puede editar/anular cualquier movimiento.
create policy "expenses_update_admin" on public.expenses
  for update using (public.current_role() = 'admin');

-- Un operador solo puede anular (actualizar) sus propios movimientos activos.
create policy "expenses_update_own_operador" on public.expenses
  for update using (
    public.current_role() = 'operador'
    and responsible_user_id = auth.uid()
    and status = 'Activo'
  );

-- ------------------------- ACTIVOS Y ASIGNACIONES ----------------------------
create policy "assets_select_all" on public.assets
  for select using (public.is_active_user());
create policy "assets_write_admin_operador" on public.assets
  for insert with check (public.current_role() in ('admin', 'operador'));
create policy "assets_update_admin_operador" on public.assets
  for update using (public.current_role() in ('admin', 'operador'));

create policy "asset_assignments_select_all" on public.asset_assignments
  for select using (public.is_active_user());
create policy "asset_assignments_insert_admin_operador" on public.asset_assignments
  for insert with check (public.current_role() in ('admin', 'operador'));
create policy "asset_assignments_update_admin_operador" on public.asset_assignments
  for update using (public.current_role() in ('admin', 'operador'));

-- ------------------------------ AUDITORÍA ------------------------------------
-- Solo administradores pueden leer el log de auditoría.
create policy "audit_log_select_admin" on public.audit_log
  for select using (public.current_role() = 'admin');

-- Cualquier usuario activo autenticado puede insertar su propia entrada
-- de auditoría (se genera automáticamente al hacer cambios en la app).
create policy "audit_log_insert_own" on public.audit_log
  for insert with check (public.is_active_user() and user_id = auth.uid());

-- --------------------------- SERVICIOS REALIZADOS ----------------------------
create policy "services_select_all" on public.services
  for select using (public.is_active_user());
create policy "services_insert_admin_operador" on public.services
  for insert with check (public.current_role() in ('admin', 'operador'));
create policy "services_update_admin" on public.services
  for update using (public.current_role() = 'admin');

-- ------------------------- TIPOS DE HERRAMIENTA (catálogo) -------------------
create policy "asset_types_select_all" on public.asset_types
  for select using (public.is_active_user());
create policy "asset_types_write_admin_operador" on public.asset_types
  for insert with check (public.current_role() in ('admin', 'operador'));
create policy "asset_types_update_admin_operador" on public.asset_types
  for update using (public.current_role() in ('admin', 'operador'));

-- --------------------------- INVENTARIO (STOCK) ------------------------------
create policy "stock_movements_select_all" on public.stock_movements
  for select using (public.is_active_user());
create policy "stock_movements_insert_admin_operador" on public.stock_movements
  for insert with check (public.current_role() in ('admin', 'operador'));
create policy "stock_movements_update_admin" on public.stock_movements
  for update using (public.current_role() = 'admin');
