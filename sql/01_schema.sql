-- ============================================================================
-- ESQUEMA: Gestión de gastos operativos de técnicos de armado
-- Ejecutar en el SQL Editor de Supabase, en orden: 01, 02, 03 (y 04 opcional)
-- ============================================================================

create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- PERFILES (extiende auth.users con nombre, usuario y rol)
-- ----------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  username text unique not null,
  role text not null check (role in ('admin', 'operador', 'consulta')) default 'consulta',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Crea automáticamente un perfil cuando se registra un usuario en auth.users
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, name, username, role, active)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', new.email),
    coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'role', 'consulta'),
    true
  )
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ----------------------------------------------------------------------------
-- TÉCNICOS
-- ----------------------------------------------------------------------------
create table public.technicians (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  name text not null,
  document text,
  phone text,
  city text,
  department text,
  zone text,
  entry_date date,
  status text not null check (status in ('Activo', 'Inactivo', 'Retirado')) default 'Activo',
  exit_date date,
  type text,
  notes text,
  created_at timestamptz not null default now()
);
create index idx_technicians_status on public.technicians(status);

-- ----------------------------------------------------------------------------
-- CATEGORÍAS Y SUBCATEGORÍAS
-- ----------------------------------------------------------------------------
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.subcategories (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.categories(id),
  name text not null,
  tipo text not null check (tipo in ('consumible', 'gasto', 'activo')) default 'gasto',
  track_stock boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (category_id, name)
);
create index idx_subcategories_category on public.subcategories(category_id);

-- ----------------------------------------------------------------------------
-- PRODUCTOS / ELEMENTOS
-- ----------------------------------------------------------------------------
create table public.products (
  id uuid primary key default gen_random_uuid(),
  subcategory_id uuid not null references public.subcategories(id),
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index idx_products_subcategory on public.products(subcategory_id);

-- ----------------------------------------------------------------------------
-- GASTOS
-- ----------------------------------------------------------------------------
create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  technician_id uuid references public.technicians(id),
  category_id uuid not null references public.categories(id),
  subcategory_id uuid not null references public.subcategories(id),
  product_id uuid references public.products(id),
  concept_manual text,
  quantity numeric not null check (quantity > 0),
  unit_value numeric not null check (unit_value >= 0),
  total_value numeric generated always as (quantity * unit_value) stored,
  observation text,
  attachment_name text,
  responsible_user_id uuid references public.profiles(id),
  status text not null check (status in ('Activo', 'Anulado')) default 'Activo',
  annul_reason text,
  annul_user_id uuid references public.profiles(id),
  annul_date date,
  created_at timestamptz not null default now()
);
create index idx_expenses_date on public.expenses(date);
create index idx_expenses_technician on public.expenses(technician_id);
create index idx_expenses_status on public.expenses(status);
create index idx_expenses_category on public.expenses(category_id);
create index idx_expenses_subcategory on public.expenses(subcategory_id);

-- ----------------------------------------------------------------------------
-- ACTIVOS / HERRAMIENTAS Y SU TRAZABILIDAD
-- ----------------------------------------------------------------------------
create table public.assets (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  type text not null,
  brand text,
  model text,
  serial text,
  value numeric,
  purchase_date date,
  technician_id uuid references public.technicians(id),
  delivery_date date,
  status text not null check (status in ('Disponible', 'Asignado', 'En reparación', 'Dañado', 'Perdido', 'Dado de baja')) default 'Disponible',
  created_at timestamptz not null default now()
);
create index idx_assets_technician on public.assets(technician_id);

create table public.asset_assignments (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.assets(id),
  technician_id uuid not null references public.technicians(id),
  from_date date not null,
  to_date date,
  assigned_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index idx_asset_assignments_asset on public.asset_assignments(asset_id);
create index idx_asset_assignments_technician on public.asset_assignments(technician_id);

-- ----------------------------------------------------------------------------
-- SERVICIOS REALIZADOS (para calcular tasas de uso de insumos, p. ej. vinipel)
-- ----------------------------------------------------------------------------
create table public.services (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  technician_id uuid not null references public.technicians(id),
  service_type text not null,
  quantity numeric not null check (quantity > 0),
  observation text,
  responsible_user_id uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index idx_services_technician on public.services(technician_id);
create index idx_services_date on public.services(date);

-- ----------------------------------------------------------------------------
-- TIPOS DE HERRAMIENTA (catálogo editable, referenciado por assets.type)
-- ----------------------------------------------------------------------------
create table public.asset_types (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- INVENTARIO: compras (entradas) y entregas a técnicos (salidas), separadas
-- ----------------------------------------------------------------------------
create table public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('Compra', 'Entrega')),
  date date not null,
  subcategory_id uuid not null references public.subcategories(id),
  product_id uuid references public.products(id),
  quantity numeric not null check (quantity > 0),
  technician_id uuid references public.technicians(id), -- solo en 'Entrega'
  unit_cost numeric, -- solo en 'Compra'
  supplier text, -- solo en 'Compra'
  observation text,
  responsible_user_id uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index idx_stock_movements_subcategory on public.stock_movements(subcategory_id);
create index idx_stock_movements_technician on public.stock_movements(technician_id);
create index idx_stock_movements_type on public.stock_movements(type);

-- ----------------------------------------------------------------------------
-- AUDITORÍA
-- ----------------------------------------------------------------------------
create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id),
  action text not null,
  record text,
  old_value text,
  new_value text,
  created_at timestamptz not null default now()
);
create index idx_audit_log_created on public.audit_log(created_at desc);

-- ----------------------------------------------------------------------------
-- NOTA DE DISEÑO
-- ----------------------------------------------------------------------------
-- No se incluye una tabla "expense_details" separada: cada gasto registrado
-- representa una sola línea (técnico + concepto + cantidad + valor), que es
-- el nivel de detalle que usa toda la plataforma. Si más adelante necesitas
-- gastos con múltiples líneas dentro de un mismo comprobante, se puede migrar
-- fácilmente separando "expenses" (cabecera) de "expense_details" (líneas)
-- sin romper el resto del modelo.
