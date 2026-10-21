-- ============================================================================
-- Procesos disciplinarios (seguimiento de casos de personal)
--  1) disciplinary_cases: un caso por persona de Personal (consecutivo PD-000001, PD-000002... lo pone la base de datos),
--     con tipo de falta, asunto, descripcion, estado, responsable, decision y fechas.
--  2) disciplinary_events: bitacora del caso (apertura, notas de seguimiento, cambios de estado, citaciones, descargos, decision...),
--     cada movimiento con sus documentos adjuntos. Es un registro historico: no se edita ni se borra.
--  3) Bucket privado "procesos-disciplinarios" en Storage (max. 15 MB; PDF, imagenes, Word, Excel y texto) para los documentos.
--  Permisos (datos sensibles): el administrador crea y edita; el operador solo consulta (ve casos y descarga documentos);
--  ningun otro rol tiene acceso (ni consulta, cliente o tecnico). NO hay borrado: los casos se cierran o archivan.
-- Se puede correr mas de una vez sin problema. No modifica datos existentes.
-- ============================================================================

create sequence if not exists public.disciplinary_case_seq;
grant usage, select on sequence public.disciplinary_case_seq to authenticated;

create table if not exists public.disciplinary_cases (
  id uuid primary key default gen_random_uuid(),
  case_no text not null unique,
  technician_id uuid not null references public.technicians(id),
  opened_on date not null default current_date,
  incident_date date,
  fault_type text not null,
  subject text not null,
  description text,
  status text not null default 'Abierto',
  responsible_id uuid references public.profiles(id),
  decision text,
  decision_notes text,
  closed_on date,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);
create index if not exists idx_disc_cases_tech on public.disciplinary_cases(technician_id);
create index if not exists idx_disc_cases_status on public.disciplinary_cases(status);
create index if not exists idx_disc_cases_opened on public.disciplinary_cases(opened_on);

create table if not exists public.disciplinary_events (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.disciplinary_cases(id),
  event_date date not null default current_date,
  event_type text not null,
  note text,
  from_status text,
  to_status text,
  attachments jsonb not null default '[]'::jsonb,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists idx_disc_events_case on public.disciplinary_events(case_id, created_at);

-- El consecutivo lo pone siempre la base de datos y no se puede modificar; quien crea el caso queda registrado.
create or replace function public.disciplinary_cases_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.case_no := 'PD-' || lpad(nextval('public.disciplinary_case_seq')::text, 6, '0');
    if auth.uid() is not null then new.created_by := auth.uid(); end if;
  else
    if new.case_no is distinct from old.case_no then
      raise exception 'El numero del caso no se puede modificar';
    end if;
    if new.technician_id is distinct from old.technician_id then
      raise exception 'La persona del caso no se puede cambiar';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_disciplinary_cases_guard on public.disciplinary_cases;
create trigger trg_disciplinary_cases_guard before insert or update on public.disciplinary_cases
  for each row execute function public.disciplinary_cases_guard();

-- Quien registra el movimiento siempre es quien inserta.
create or replace function public.disciplinary_events_guard() returns trigger language plpgsql as $$
begin
  if auth.uid() is not null then new.created_by := auth.uid(); end if;
  return new;
end $$;
drop trigger if exists trg_disciplinary_events_guard on public.disciplinary_events;
create trigger trg_disciplinary_events_guard before insert on public.disciplinary_events
  for each row execute function public.disciplinary_events_guard();

alter table public.disciplinary_cases enable row level security;
alter table public.disciplinary_events enable row level security;

drop policy if exists "disc_cases_select" on public.disciplinary_cases;
drop policy if exists "disc_cases_insert" on public.disciplinary_cases;
drop policy if exists "disc_cases_update" on public.disciplinary_cases;
create policy "disc_cases_select" on public.disciplinary_cases for select
  using (public.is_active_user() and public.current_role() in ('admin', 'operador'));
create policy "disc_cases_insert" on public.disciplinary_cases for insert
  with check (public.is_active_user() and public.current_role() = 'admin');
create policy "disc_cases_update" on public.disciplinary_cases for update
  using (public.is_active_user() and public.current_role() = 'admin')
  with check (public.is_active_user() and public.current_role() = 'admin');
-- Sin politica de DELETE: los casos no se borran.

drop policy if exists "disc_events_select" on public.disciplinary_events;
drop policy if exists "disc_events_insert" on public.disciplinary_events;
create policy "disc_events_select" on public.disciplinary_events for select
  using (public.is_active_user() and public.current_role() in ('admin', 'operador'));
create policy "disc_events_insert" on public.disciplinary_events for insert
  with check (public.is_active_user() and public.current_role() = 'admin');
-- Sin politicas de UPDATE ni DELETE: la bitacora es un registro historico.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('procesos-disciplinarios', 'procesos-disciplinarios', false, 15728640,
        array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic',
              'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
              'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              'text/plain'])
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types, public = false;

drop policy if exists "procesos_disc_select" on storage.objects;
drop policy if exists "procesos_disc_insert" on storage.objects;
create policy "procesos_disc_select" on storage.objects for select
  using (bucket_id = 'procesos-disciplinarios' and public.is_active_user() and public.current_role() in ('admin', 'operador'));
create policy "procesos_disc_insert" on storage.objects for insert
  with check (bucket_id = 'procesos-disciplinarios' and public.is_active_user() and public.current_role() = 'admin');
-- Sin politicas de UPDATE ni DELETE en el bucket: los documentos no se reemplazan ni se borran.
