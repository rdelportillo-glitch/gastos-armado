-- ============================================================================
-- Monitoreos (auditorias digitales y presenciales de la operacion)
--  1) monitoring_records: un registro por monitoreo (canal Digital o Presencial) con el tecnico monitoreado, el servicio, las respuestas de cada
--     subcomponente (Cumple / No Cumple / N/A), el resultado y puntaje de cada componente, el error critico, la calificacion final y el semaforo.
--     El consecutivo (MD-000001 digital, MP-000001 presencial) lo pone la base de datos.
--     El resultado queda guardado tal como se calculo ese dia (con los pesos de ese momento): si despues cambia la configuracion en Maestros,
--     los monitoreos anteriores no se alteran.
--  2) La configuracion (componentes, subcomponentes, pesos, semaforo y errores criticos) NO necesita tabla nueva: vive en assignment_settings
--     (clave "monitoreos_config"), igual que las demas configuraciones compartidas.
--  Permisos: administrador y operador crean y editan; consulta solo ve; ningun otro rol tiene acceso (ni cliente ni tecnico).
--  NO hay borrado: un monitoreo se anula con motivo (queda el registro).
-- Se puede correr mas de una vez. No modifica datos existentes.
-- ============================================================================

create sequence if not exists public.monitoring_seq;
grant usage, select on sequence public.monitoring_seq to authenticated;

create table if not exists public.monitoring_records (
  id uuid primary key default gen_random_uuid(),
  record_no text not null unique,
  channel text not null check (channel in ('Digital', 'Presencial')),
  audit_date date not null,
  auditor_id uuid references public.profiles(id),
  auditor_name text,
  technician_id uuid not null references public.technicians(id),
  technician_name text,
  department text,
  coordinator text,
  city text,
  service_no text,
  products_count int,
  original_service_date date,
  answers jsonb not null default '{}'::jsonb,
  results jsonb not null default '[]'::jsonb,
  critical_error boolean not null default false,
  critical_type text,
  score numeric not null default 0,
  traffic_light text,
  observations text,
  status text not null default 'Activo' check (status in ('Activo', 'Anulado')),
  void_reason text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz
);
create index if not exists idx_monitoring_date on public.monitoring_records(audit_date);
create index if not exists idx_monitoring_tech on public.monitoring_records(technician_id);
create index if not exists idx_monitoring_channel on public.monitoring_records(channel, audit_date);

-- Consecutivo y autor los pone siempre la base de datos; el numero no se puede cambiar ni cambiar de canal.
create or replace function public.monitoring_records_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.record_no := case new.channel when 'Digital' then 'MD-' else 'MP-' end || lpad(nextval('public.monitoring_seq')::text, 6, '0');
    if auth.uid() is not null then new.created_by := auth.uid(); end if;
  else
    if new.record_no is distinct from old.record_no then raise exception 'El numero del monitoreo no se puede modificar'; end if;
    if new.channel is distinct from old.channel then raise exception 'El canal del monitoreo no se puede cambiar'; end if;
    new.updated_at := now();
    if auth.uid() is not null then new.updated_by := auth.uid(); end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_monitoring_records_guard on public.monitoring_records;
create trigger trg_monitoring_records_guard before insert or update on public.monitoring_records
  for each row execute function public.monitoring_records_guard();

alter table public.monitoring_records enable row level security;
drop policy if exists "monitoring_select" on public.monitoring_records;
drop policy if exists "monitoring_insert" on public.monitoring_records;
drop policy if exists "monitoring_update" on public.monitoring_records;
create policy "monitoring_select" on public.monitoring_records for select
  using (public.is_active_user() and public.current_role() in ('admin', 'operador', 'consulta'));
create policy "monitoring_insert" on public.monitoring_records for insert
  with check (public.is_active_user() and public.current_role() in ('admin', 'operador'));
create policy "monitoring_update" on public.monitoring_records for update
  using (public.is_active_user() and public.current_role() in ('admin', 'operador'))
  with check (public.is_active_user() and public.current_role() in ('admin', 'operador'));
-- Sin politica de DELETE: los monitoreos no se borran, se anulan.
