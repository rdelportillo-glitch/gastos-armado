-- ============================================================================
-- Asignación · Fase 2: carga del día, estados de gestión y disponibilidad diaria
--  1) services: el técnico pasa a ser opcional (un servicio cargado aún no tiene técnico),
--     estado de gestión (Pendiente / En gestión / Realizado), orden de ruta, tiempo y los
--     datos de la base de asignación (jsonb).
--  2) assignment_availability: estado y novedad de cada técnico por día.
--  3) assignment_settings: criterios de asignación editables (los guarda el administrador).
-- Se puede correr más de una vez sin problema. No modifica ni borra datos existentes:
-- todos los servicios que ya existen quedan como "Realizado", igual que se han tratado hasta hoy.
-- ============================================================================

alter table public.services alter column technician_id drop not null;

alter table public.services add column if not exists estado_gestion text not null default 'Realizado';
alter table public.services drop constraint if exists services_estado_gestion_check;
alter table public.services add constraint services_estado_gestion_check check (estado_gestion in ('Pendiente', 'En gestión', 'Realizado'));
alter table public.services add column if not exists ruta_orden int;
alter table public.services add column if not exists tiempo_min int;
alter table public.services add column if not exists asig jsonb;

create index if not exists idx_services_estado_fecha on public.services(estado_gestion, date);

create table if not exists public.assignment_availability (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  technician_id uuid not null references public.technicians(id),
  state text not null default 'Disponible',
  novelty_minutes int not null default 0,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  unique (date, technician_id)
);

create table if not exists public.assignment_settings (
  key text primary key,
  value jsonb not null,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

alter table public.assignment_availability enable row level security;
alter table public.assignment_settings enable row level security;

drop policy if exists "assignment_availability_select" on public.assignment_availability;
drop policy if exists "assignment_availability_write" on public.assignment_availability;
create policy "assignment_availability_select" on public.assignment_availability for select using (public.is_active_user());
create policy "assignment_availability_write" on public.assignment_availability for all
  using (public.current_role() in ('admin', 'operador')) with check (public.current_role() in ('admin', 'operador'));

drop policy if exists "assignment_settings_select" on public.assignment_settings;
drop policy if exists "assignment_settings_admin" on public.assignment_settings;
create policy "assignment_settings_select" on public.assignment_settings for select using (public.is_active_user());
create policy "assignment_settings_admin" on public.assignment_settings for all
  using (public.current_role() = 'admin') with check (public.current_role() = 'admin');
