-- ============================================================================
-- 50 · Ruta del técnico ("Mi ruta del día")
--
--  1) El rol "tecnico" puede LEER sus propios servicios (los que tiene asignados en Carga/Asignación): solo filas donde él es el técnico. No escribe en services.
--  2) route_reports: el reporte del técnico por servicio y día (marcó realizado, hora y ubicación del celular al cerrarlo). Una fila por (día, servicio, técnico).
--     El técnico crea y actualiza solo los suyos; administrador y operador pueden todo; el resto del equipo lo lee. No hay borrado.
--     Es un reporte del técnico: no cambia el estado oficial del servicio (eso sigue siendo la auditoría de Carga).
--
-- Se puede correr más de una vez. No modifica datos existentes. Requiere el sql 45 (función is_active_tecnico).
-- ============================================================================

drop policy if exists "services_select_tecnico" on public.services;
create policy "services_select_tecnico" on public.services for select
  using (public.is_active_tecnico() and technician_id = public.my_technician());

create table if not exists public.route_reports (
  id uuid primary key default gen_random_uuid(),
  day date not null,
  servicio text not null,
  technician_id uuid not null references public.technicians(id),
  done boolean not null default true,
  done_at timestamptz,
  lat numeric,
  lng numeric,
  accuracy numeric,
  location_status text check (location_status in ('ok', 'denegada', 'sin_senal', 'no_disponible')),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (day, servicio, technician_id)
);
create index if not exists idx_route_reports_day on public.route_reports(day);
create index if not exists idx_route_reports_tech on public.route_reports(technician_id, day);

alter table public.route_reports enable row level security;
drop policy if exists "route_reports_select" on public.route_reports;
drop policy if exists "route_reports_insert" on public.route_reports;
drop policy if exists "route_reports_update" on public.route_reports;
create policy "route_reports_select" on public.route_reports for select
  using (public.is_active_user() or (public.is_active_tecnico() and technician_id = public.my_technician()));
create policy "route_reports_insert" on public.route_reports for insert
  with check (public.current_role() in ('admin', 'operador') or (public.is_active_tecnico() and technician_id = public.my_technician()));
create policy "route_reports_update" on public.route_reports for update
  using (public.current_role() in ('admin', 'operador') or (public.is_active_tecnico() and technician_id = public.my_technician()))
  with check (public.current_role() in ('admin', 'operador') or (public.is_active_tecnico() and technician_id = public.my_technician()));
-- Sin política de DELETE: los reportes no se borran.

notify pgrst, 'reload schema';
