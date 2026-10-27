-- ============================================================================
-- Monitoreos: cronograma mensual
--  1) monitoring_schedule: cada fila es un monitoreo programado (mes, fecha, auditor, tecnico, canal). El cronograma lo calcula la aplicacion
--     (por antiguedad, cargo y resultados del mes anterior) y se puede editar a mano. Si se recalcula, lo anterior queda como "Cancelado"
--     (no se borra). Si el monitoreo ya se hizo o no, no se guarda aqui: se deduce de los monitoreos registrados (monitoring_records).
--  2) monitoring_records.auditor_person_id: la persona administrativa (de Personal) que hizo el monitoreo, para cruzarla con el cronograma.
--  La configuracion (quienes son auditores y cuantos monitoreos hacen al mes, y los parametros del calculo) vive en assignment_settings
--  (clave "monitoreos_cronograma"), sin tabla nueva.
--  Permisos: administrador y operador crean y editan; consulta solo ve; ningun otro rol tiene acceso. No hay borrado.
-- Se puede correr mas de una vez. No modifica datos existentes.
-- ============================================================================

alter table public.monitoring_records add column if not exists auditor_person_id uuid references public.technicians(id);

create table if not exists public.monitoring_schedule (
  id uuid primary key default gen_random_uuid(),
  month text not null check (month ~ '^[0-9]{4}-[0-9]{2}$'),
  planned_date date not null,
  auditor_person_id uuid references public.technicians(id),
  technician_id uuid not null references public.technicians(id),
  channel text not null default 'Digital' check (channel in ('Digital', 'Presencial')),
  status text not null default 'Programado' check (status in ('Programado', 'Cancelado')),
  origin text not null default 'Calculado' check (origin in ('Calculado', 'Manual')),
  score numeric,
  level text,
  note text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz
);
create index if not exists idx_monitoring_schedule_month on public.monitoring_schedule(month, planned_date);
create index if not exists idx_monitoring_schedule_tech on public.monitoring_schedule(technician_id);

create or replace function public.monitoring_schedule_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then new.created_by := auth.uid(); end if;
  else
    new.updated_at := now();
    if auth.uid() is not null then new.updated_by := auth.uid(); end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_monitoring_schedule_guard on public.monitoring_schedule;
create trigger trg_monitoring_schedule_guard before insert or update on public.monitoring_schedule
  for each row execute function public.monitoring_schedule_guard();

alter table public.monitoring_schedule enable row level security;
drop policy if exists "monitoring_schedule_select" on public.monitoring_schedule;
drop policy if exists "monitoring_schedule_insert" on public.monitoring_schedule;
drop policy if exists "monitoring_schedule_update" on public.monitoring_schedule;
create policy "monitoring_schedule_select" on public.monitoring_schedule for select
  using (public.is_active_user() and public.current_role() in ('admin', 'operador', 'consulta'));
create policy "monitoring_schedule_insert" on public.monitoring_schedule for insert
  with check (public.is_active_user() and public.current_role() in ('admin', 'operador'));
create policy "monitoring_schedule_update" on public.monitoring_schedule for update
  using (public.is_active_user() and public.current_role() in ('admin', 'operador'))
  with check (public.is_active_user() and public.current_role() in ('admin', 'operador'));
-- Sin politica de DELETE: las entradas del cronograma se cancelan, no se borran.
