-- ============================================================================
-- Asignación · Fase 1: maestros de zonas, barrios y productos de armado
-- (Este archivo deja constancia del SQL que ya se ejecutó en Supabase.)
-- Se puede correr más de una vez sin problema.
-- ============================================================================
alter table public.technicians add column if not exists assign_order int;
alter table public.technicians add column if not exists coordinator text;

create table if not exists public.geo_abbreviations (
  abbr text primary key,
  name text not null,
  region_id int not null,
  level text not null,
  dept_abbr text
);

create table if not exists public.geo_zones (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  latitude numeric, longitude numeric,
  zone_id int, cluster int, head text, region int,
  compatibility int, danger text, zone_type text, dept_abbr text,
  distance_km numeric, travel_time numeric, viatico numeric, distance_value numeric,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.geo_neighborhoods (
  id uuid primary key default gen_random_uuid(),
  city text not null,
  neighborhood text not null,
  zone_id uuid not null references public.geo_zones(id),
  region int, zone_type text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (city, neighborhood)
);
create index if not exists idx_geo_neighborhoods_zone on public.geo_neighborhoods(zone_id);

create table if not exists public.assembly_products (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  code2 text,
  price_single numeric, price_pair numeric,
  minutes int, supplier text,
  persons int not null default 1,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.assembly_complexity (
  id uuid primary key default gen_random_uuid(),
  line text not null,
  subline text not null,
  complexity text not null check (complexity in ('Baja','Media','Alta')),
  embeddable boolean not null default false,
  unique (line, subline)
);

do $$
declare t text;
begin
  foreach t in array array['geo_abbreviations','geo_zones','geo_neighborhoods','assembly_products','assembly_complexity'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "%s_select" on public.%I', t, t);
    execute format('drop policy if exists "%s_admin_all" on public.%I', t, t);
    execute format('create policy "%s_select" on public.%I for select using (public.is_active_user())', t, t);
    execute format('create policy "%s_admin_all" on public.%I for all using (public.current_role() = ''admin'') with check (public.current_role() = ''admin'')', t, t);
  end loop;
end $$;
