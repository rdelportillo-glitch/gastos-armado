-- ============================================================================
-- Armados en almacén (nuevo módulo) + rol "tecnico" + separación de datos por cliente
--  Flujo: el cliente (Jamar) o el equipo registra una SOLICITUD por almacén (con consecutivo interno AA-000001, número de
--  PQR, fecha de compromiso y la lista de productos); el técnico registra los ARMADOS que va haciendo (producto, cantidad,
--  fotos) y el equipo cierra la solicitud con PQR, técnico y fotos validados.
--  1) profiles.client_name (empresa del usuario cliente) y profiles.technician_id (ficha de Personal del usuario técnico).
--  2) Roles: 'cliente' y 'tecnico' quedan fuera de is_active_user(): no leen ninguna tabla interna; solo tienen los permisos de abajo.
--  3) Tablas: warehouses (maestro de almacenes), store_requests, store_assemblies, store_request_events (historial).
--  4) Cada cliente solo ve lo suyo; el técnico ve las solicitudes abiertas y sus propios armados.
--  5) Bucket privado "armados-fotos" (máx. 15 MB) para fotos de los armados y soportes del PQR.
--  6) Funciones de búsqueda de productos sin precios (cliente y técnico).
-- Se puede correr más de una vez sin problema. No modifica datos existentes (solo completa client_name de los clientes que ya existen).
-- ============================================================================

-- 1) Perfil: empresa y ficha de técnico
alter table public.profiles add column if not exists client_name text;
alter table public.profiles add column if not exists technician_id uuid references public.technicians(id);
update public.profiles set client_name = 'JAMAR' where role = 'cliente' and client_name is null;

-- 2) Roles y acceso
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('admin', 'operador', 'consulta', 'cliente', 'tecnico'));

create or replace function public.is_active_user()
returns boolean as $$
  select coalesce((select active and role not in ('cliente', 'tecnico') from public.profiles where id = auth.uid()), false);
$$ language sql stable security definer;

-- Solo un administrador cambia rol, estado, empresa o ficha de técnico de un usuario
create or replace function public.profiles_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null
     and (new.role is distinct from old.role or new.active is distinct from old.active
          or new.client_name is distinct from old.client_name or new.technician_id is distinct from old.technician_id)
     and coalesce(public.current_role(), '') <> 'admin' then
    raise exception 'Solo un administrador puede cambiar el rol, el estado, la empresa o la ficha de técnico de un usuario';
  end if;
  return new;
end $$;

-- Funciones de apoyo (security definer: evitan recursión entre políticas)
create or replace function public.my_client() returns text language sql stable security definer set search_path = public as $$
  select client_name from public.profiles where id = auth.uid();
$$;
create or replace function public.my_technician() returns uuid language sql stable security definer set search_path = public as $$
  select technician_id from public.profiles where id = auth.uid();
$$;

-- 3) Tablas
create table if not exists public.warehouses (
  id uuid primary key default gen_random_uuid(),
  client text not null default 'JAMAR',
  name text not null,
  city text,
  department text,
  contact_name text,
  contact_phone text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (client, name)
);

create sequence if not exists public.store_request_seq;
grant usage, select on sequence public.store_request_seq to authenticated;

create table if not exists public.store_requests (
  id uuid primary key default gen_random_uuid(),
  request_no text not null unique,
  client text not null,
  warehouse_id uuid not null references public.warehouses(id),
  origin text not null check (origin in ('PQR', 'Directo')),
  pqr_number text,
  commitment_date date,
  requested_date date not null default current_date,
  requester_name text,
  notes text,
  items jsonb not null default '[]'::jsonb,
  attachments jsonb not null default '[]'::jsonb,
  status text not null default 'Abierta' check (status in ('Abierta', 'Cerrada', 'Cancelada')),
  closed_at timestamptz,
  closed_by uuid references public.profiles(id),
  close_notes text,
  cancel_reason text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz
);
create index if not exists idx_store_requests_client on public.store_requests(client, requested_date);
create index if not exists idx_store_requests_warehouse on public.store_requests(warehouse_id);
create index if not exists idx_store_requests_pqr on public.store_requests(client, pqr_number);

create table if not exists public.store_assemblies (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.store_requests(id),
  product_code text not null,
  product_name text not null,
  product_line text,
  quantity int not null check (quantity > 0),
  technician_id uuid not null references public.technicians(id),
  technician_name text,
  assembled_on date not null default current_date,
  photos jsonb not null default '[]'::jsonb,
  notes text,
  voided boolean not null default false,
  void_reason text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz
);
create index if not exists idx_store_assemblies_request on public.store_assemblies(request_id);
create index if not exists idx_store_assemblies_tech on public.store_assemblies(technician_id, assembled_on);

create table if not exists public.store_request_events (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.store_requests(id),
  at timestamptz not null default now(),
  user_id uuid,
  user_name text,
  action text not null,
  detail text
);
create index if not exists idx_store_request_events_request on public.store_request_events(request_id);

-- Funciones que consultan estas tablas sin pasar por sus políticas
create or replace function public.request_client(rid uuid) returns text language sql stable security definer set search_path = public as $$
  select client from public.store_requests where id = rid;
$$;
create or replace function public.request_open(rid uuid) returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select status = 'Abierta' from public.store_requests where id = rid), false);
$$;
create or replace function public.i_worked_on(rid uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.store_assemblies where request_id = rid and technician_id = public.my_technician());
$$;
create or replace function public.warehouse_client(wid uuid) returns text language sql stable security definer set search_path = public as $$
  select client from public.warehouses where id = wid;
$$;
-- Cliente dueño de un archivo del bucket (la primera carpeta es el id de la solicitud); nulo si no aplica
create or replace function public.folder_client(path text) returns text language plpgsql stable security definer set search_path = public as $$
declare rid uuid;
begin
  begin rid := (string_to_array(path, '/'))[1]::uuid; exception when others then return null; end;
  return (select client from public.store_requests where id = rid);
end $$;

-- Triggers de la solicitud: número, autor, cliente (el del almacén) e historial
create or replace function public.store_requests_guard() returns trigger language plpgsql security definer set search_path = public as $$
declare uname text;
begin
  select name into uname from public.profiles where id = auth.uid();
  if tg_op = 'INSERT' then
    new.request_no := 'AA-' || lpad(nextval('public.store_request_seq')::text, 6, '0');
    new.client := (select client from public.warehouses where id = new.warehouse_id);
    if auth.uid() is not null then new.created_by := auth.uid(); end if;
    return new;
  end if;
  if new.request_no is distinct from old.request_no then raise exception 'El número de solicitud no se puede modificar'; end if;
  if new.warehouse_id is distinct from old.warehouse_id then new.client := (select client from public.warehouses where id = new.warehouse_id); end if;
  if new.client is distinct from old.client then raise exception 'La solicitud no puede cambiar de cliente'; end if;
  new.updated_at := now();
  if auth.uid() is not null then new.updated_by := auth.uid(); end if;
  if new.items is distinct from old.items then
    insert into public.store_request_events (request_id, user_id, user_name, action, detail)
    values (new.id, auth.uid(), uname, 'Lista de productos modificada', jsonb_array_length(old.items) || ' → ' || jsonb_array_length(new.items) || ' productos');
  end if;
  if new.pqr_number is distinct from old.pqr_number then
    insert into public.store_request_events (request_id, user_id, user_name, action, detail)
    values (new.id, auth.uid(), uname, 'PQR modificado', coalesce(old.pqr_number, '-') || ' → ' || coalesce(new.pqr_number, '-'));
  end if;
  if new.status is distinct from old.status then
    insert into public.store_request_events (request_id, user_id, user_name, action, detail)
    values (new.id, auth.uid(), uname, 'Estado: ' || old.status || ' → ' || new.status, coalesce(new.cancel_reason, new.close_notes));
  end if;
  return new;
end $$;
drop trigger if exists trg_store_requests_guard on public.store_requests;
create trigger trg_store_requests_guard before insert or update on public.store_requests for each row execute function public.store_requests_guard();

create or replace function public.store_requests_created() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.store_request_events (request_id, user_id, user_name, action, detail)
  values (new.id, auth.uid(), (select name from public.profiles where id = auth.uid()), 'Solicitud creada', new.origin || ' · ' || jsonb_array_length(new.items) || ' productos');
  return new;
end $$;
drop trigger if exists trg_store_requests_created on public.store_requests;
create trigger trg_store_requests_created after insert on public.store_requests for each row execute function public.store_requests_created();

-- Triggers del armado: autor y nombre del técnico
create or replace function public.store_assemblies_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.technician_name := (select name from public.technicians where id = new.technician_id);
  if tg_op = 'INSERT' then
    if auth.uid() is not null then new.created_by := auth.uid(); end if;
  else
    new.updated_at := now();
    if auth.uid() is not null then new.updated_by := auth.uid(); end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_store_assemblies_guard on public.store_assemblies;
create trigger trg_store_assemblies_guard before insert or update on public.store_assemblies for each row execute function public.store_assemblies_guard();

-- 4) Políticas (no hay DELETE en ninguna tabla: nada se borra)
alter table public.warehouses enable row level security;
alter table public.store_requests enable row level security;
alter table public.store_assemblies enable row level security;
alter table public.store_request_events enable row level security;

drop policy if exists "warehouses_select" on public.warehouses;
drop policy if exists "warehouses_insert" on public.warehouses;
drop policy if exists "warehouses_update" on public.warehouses;
create policy "warehouses_select" on public.warehouses for select
  using (public.is_active_user() or (public.current_role() = 'cliente' and client = public.my_client()) or (public.current_role() = 'tecnico' and active));
create policy "warehouses_insert" on public.warehouses for insert with check (public.current_role() in ('admin', 'operador'));
create policy "warehouses_update" on public.warehouses for update using (public.current_role() in ('admin', 'operador')) with check (public.current_role() in ('admin', 'operador'));

drop policy if exists "store_requests_select" on public.store_requests;
drop policy if exists "store_requests_insert_internal" on public.store_requests;
drop policy if exists "store_requests_insert_cliente" on public.store_requests;
drop policy if exists "store_requests_insert_tecnico" on public.store_requests;
drop policy if exists "store_requests_update_internal" on public.store_requests;
drop policy if exists "store_requests_update_cliente" on public.store_requests;
create policy "store_requests_select" on public.store_requests for select
  using (public.is_active_user()
         or (public.current_role() = 'cliente' and client = public.my_client())
         or (public.current_role() = 'tecnico' and (status = 'Abierta' or public.i_worked_on(id))));
create policy "store_requests_insert_internal" on public.store_requests for insert with check (public.current_role() in ('admin', 'operador'));
create policy "store_requests_insert_cliente" on public.store_requests for insert
  with check (public.current_role() = 'cliente' and origin = 'PQR' and status = 'Abierta' and public.warehouse_client(warehouse_id) = public.my_client());
create policy "store_requests_insert_tecnico" on public.store_requests for insert
  with check (public.current_role() = 'tecnico' and origin = 'Directo' and status = 'Abierta' and public.my_technician() is not null);
create policy "store_requests_update_internal" on public.store_requests for update
  using (public.current_role() in ('admin', 'operador')) with check (public.current_role() in ('admin', 'operador'));
-- El cliente puede editar su solicitud (por ejemplo agregar productos cuando el técnico ya está en sitio) mientras esté Abierta, y cancelarla
create policy "store_requests_update_cliente" on public.store_requests for update
  using (public.current_role() = 'cliente' and client = public.my_client() and status = 'Abierta')
  with check (public.current_role() = 'cliente' and client = public.my_client() and status in ('Abierta', 'Cancelada') and closed_at is null);

drop policy if exists "store_assemblies_select" on public.store_assemblies;
drop policy if exists "store_assemblies_insert_internal" on public.store_assemblies;
drop policy if exists "store_assemblies_insert_tecnico" on public.store_assemblies;
drop policy if exists "store_assemblies_update_internal" on public.store_assemblies;
drop policy if exists "store_assemblies_update_tecnico" on public.store_assemblies;
create policy "store_assemblies_select" on public.store_assemblies for select
  using (public.is_active_user()
         or (public.current_role() = 'cliente' and public.request_client(request_id) = public.my_client())
         or (public.current_role() = 'tecnico' and technician_id = public.my_technician()));
create policy "store_assemblies_insert_internal" on public.store_assemblies for insert with check (public.current_role() in ('admin', 'operador'));
create policy "store_assemblies_insert_tecnico" on public.store_assemblies for insert
  with check (public.current_role() = 'tecnico' and technician_id = public.my_technician() and public.request_open(request_id));
create policy "store_assemblies_update_internal" on public.store_assemblies for update
  using (public.current_role() in ('admin', 'operador')) with check (public.current_role() in ('admin', 'operador'));
create policy "store_assemblies_update_tecnico" on public.store_assemblies for update
  using (public.current_role() = 'tecnico' and technician_id = public.my_technician() and public.request_open(request_id))
  with check (public.current_role() = 'tecnico' and technician_id = public.my_technician() and public.request_open(request_id));

drop policy if exists "store_request_events_select" on public.store_request_events;
create policy "store_request_events_select" on public.store_request_events for select
  using (public.is_active_user() or (public.current_role() = 'cliente' and public.request_client(request_id) = public.my_client()));

-- 5) Fotos y soportes
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('armados-fotos', 'armados-fotos', false, 15728640,
        array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf', 'message/rfc822',
              'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/csv'])
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types, public = false;

drop policy if exists "armados_fotos_select" on storage.objects;
drop policy if exists "armados_fotos_insert" on storage.objects;
create policy "armados_fotos_select" on storage.objects for select
  using (bucket_id = 'armados-fotos'
         and (public.is_active_user() or owner_id = auth.uid()::text
              or (public.current_role() = 'cliente' and public.folder_client(name) = public.my_client())));
create policy "armados_fotos_insert" on storage.objects for insert
  with check (bucket_id = 'armados-fotos' and public.current_role() in ('admin', 'operador', 'tecnico', 'cliente'));

-- 6) Búsqueda de productos sin precios (cliente, técnico y equipo)
create or replace function public.cliente_buscar_productos(q text)
returns table (code text, name text, minutes int, persons int, line text, subline text)
language sql stable security definer set search_path = public as $$
  select p.code, p.name, p.minutes, p.persons, p.line, p.subline
  from public.assembly_products p
  where public.current_role() in ('cliente', 'tecnico', 'admin', 'operador') and p.active
    and (p.code ilike '%' || btrim(q) || '%' or p.name ilike '%' || btrim(q) || '%')
  order by p.name limit 15;
$$;
revoke all on function public.cliente_buscar_productos(text) from public;
grant execute on function public.cliente_buscar_productos(text) to authenticated;

-- Productos por código (para validar la lista de un PQR cargada desde Excel)
create or replace function public.productos_por_codigo(codes text[])
returns table (code text, name text, line text, subline text)
language sql stable security definer set search_path = public as $$
  select p.code, p.name, p.line, p.subline
  from public.assembly_products p
  where public.current_role() in ('cliente', 'tecnico', 'admin', 'operador') and p.code = any (codes);
$$;
revoke all on function public.productos_por_codigo(text[]) from public;
grant execute on function public.productos_por_codigo(text[]) to authenticated;

-- Almacén de los PQR de ejemplo (viene en el listado de Jamar). El resto se carga en Maestros → Almacenes.
insert into public.warehouses (client, name, city, department) values ('JAMAR', 'ALMACEN RIOACHA', 'RIOHACHA', 'LA GUAJIRA')
on conflict (client, name) do nothing;
