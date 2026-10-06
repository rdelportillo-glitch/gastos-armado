-- ============================================================================
-- Asignación · Fase 4: cierre del día e histórico
--  1) services.finalized_at / finalized_by: un servicio con fecha de cierre sale de la pantalla
--     de Carga (queda archivado, sin borrarse; los realizados se siguen contando en Trabajos
--     realizados y en la tasa de vinipel).
--  2) assignment_history: foto de cada servicio del día al momento de finalizarlo (técnico,
--     región, resultado, causales...). No se edita ni se borra: es el histórico oficial.
-- Se puede correr más de una vez sin problema. No modifica datos existentes.
-- ============================================================================

alter table public.services add column if not exists finalized_at timestamptz;
alter table public.services add column if not exists finalized_by uuid references public.profiles(id);
create index if not exists idx_services_finalized on public.services(finalized_at);

create table if not exists public.assignment_history (
  id uuid primary key default gen_random_uuid(),
  day date not null,
  service_id uuid not null,
  servicio text not null,
  codigo text,
  producto text,
  quantity numeric not null default 1,
  tiempo_min int,
  technician_id uuid references public.technicians(id),
  technician_name text,
  helper_name text,
  region int,
  departamento text,
  ciudad text,
  barrio text,
  direccion text,
  cliente text,
  zona text,
  ruta_orden int,
  prioridad text,
  tipo text,
  resultado text not null check (resultado in ('Realizado', 'No realizado')),
  estado_extreme text,
  causal_extreme text,
  causal_auditada text,
  diagnostico text,
  finalized_by uuid references public.profiles(id),
  finalized_at timestamptz not null default now(),
  unique (day, service_id)
);
create index if not exists idx_assignment_history_day on public.assignment_history(day);
create index if not exists idx_assignment_history_tech on public.assignment_history(technician_id, day);
create index if not exists idx_assignment_history_region on public.assignment_history(region, day);

alter table public.assignment_history enable row level security;
drop policy if exists "assignment_history_select" on public.assignment_history;
drop policy if exists "assignment_history_insert" on public.assignment_history;
drop policy if exists "assignment_history_update" on public.assignment_history;
create policy "assignment_history_select" on public.assignment_history for select using (public.is_active_user());
create policy "assignment_history_insert" on public.assignment_history for insert with check (public.current_role() in ('admin', 'operador'));
-- El upsert (para que cerrar un día dos veces no duplique) necesita también UPDATE; solo lo usa el cierre del día.
create policy "assignment_history_update" on public.assignment_history for update
  using (public.current_role() in ('admin', 'operador')) with check (public.current_role() in ('admin', 'operador'));
-- No hay política de DELETE: el histórico no se borra.
