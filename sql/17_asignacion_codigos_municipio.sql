-- ============================================================================
-- Asignación · Códigos de municipio (maestro)
-- La base de Jamar trae algunos municipios solo como código (columna CIUDAD, ej. AN|BA = Barbosa).
-- Se administran desde Maestros → Barrios y zonas equivalentes → Códigos de municipio.
-- Se puede correr más de una vez sin problema.
-- ============================================================================
create table if not exists public.geo_city_codes (
  id uuid primary key default gen_random_uuid(),
  dept_code text not null,
  city_code text not null,
  city_name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (dept_code, city_code)
);

alter table public.geo_city_codes enable row level security;
drop policy if exists "geo_city_codes_select" on public.geo_city_codes;
drop policy if exists "geo_city_codes_admin_all" on public.geo_city_codes;
create policy "geo_city_codes_select" on public.geo_city_codes for select using (public.is_active_user());
create policy "geo_city_codes_admin_all" on public.geo_city_codes for all
  using (public.current_role() = 'admin') with check (public.current_role() = 'admin');

-- Códigos iniciales (los que ya conocía la herramienta de asignación).
insert into public.geo_city_codes (dept_code, city_code, city_name) values
  ('AT', 'SU', 'SUAN'),
  ('MA', 'GUH', 'GUACHACA'),
  ('AT', 'RE', 'REPELON'),
  ('BO', 'SP', 'SAN JUAN DE NEMOPUSENO'),
  ('AT', 'SV', 'SANTA VERONICA'),
  ('AN', 'BA', 'BARBOSA'),
  ('BO', 'AR', 'ARENAL'),
  ('CU', 'LC', 'LA CALERA'),
  ('AT', 'PA', 'PALERMO'),
  ('AT', 'CP', 'CAMPECHE'),
  ('AT', 'IL', 'ISABEL LOPEZ'),
  ('AT', 'JM', 'JUAN MINA'),
  ('SU', 'MO', 'MORROA'),
  ('BO', 'ST', 'SANTA CATALINA'),
  ('CO', 'SA', 'SAGUN'),
  ('MA', 'BU', 'BURITACA'),
  ('BO', 'CL', 'CLEMENCIA'),
  ('CU', 'TA', 'TABIO'),
  ('AT', 'CL', 'CANDELARIA'),
  ('SD', 'LB', 'LEBRIJA'),
  ('MA', 'TA', 'TASAJERA'),
  ('GU', 'CAM', 'CAMARONES'),
  ('CO', 'SP', 'SAN PELAYO'),
  ('MA', 'GY', 'GUAMAL'),
  ('MA', 'ZB', 'ZONA BANANERA'),
  ('CO', 'SS', 'SAN ANDRES DE SOTAVENTO'),
  ('AT', 'MO', 'MOLINERO'),
  ('AT', 'MR', 'MARTILLO'),
  ('CO', 'SE', 'SAN ANTERO'),
  ('CU', 'RO', 'EL ROSAL'),
  ('AT', 'PG', 'PUERTO GIRALDO'),
  ('SU', 'TV', 'TOLU VIEJO'),
  ('MA', 'OR', 'ORIHUECA'),
  ('MA', 'RF', 'RIOFRIO'),
  ('AT', 'PTAL', 'PITAL DE MEGUA'),
  ('SU', 'CZ', 'COROZAL'),
  ('AT', 'CR', 'CARACOLI')
on conflict (dept_code, city_code) do nothing;
