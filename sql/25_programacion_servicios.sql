-- ============================================================================
-- Programación de servicios (reemplaza el formulario "Servicios Particulares")
--  1) Consecutivo interno de la Orden de servicio: secuencia que genera PS-000001, PS-000002...
--     El usuario no lo escribe: lo pone la base de datos al guardar y no se puede cambiar después.
--  2) service_orders: una fila por orden programada (cliente, ubicación, productos, fecha, tipo de solicitud, fotos).
--     Al programar, la aplicación también crea los servicios Pendientes que alimentan la Asignación.
--  3) Bucket privado "programacion-fotos" en Storage (máx. 10 MB; imágenes y PDF) para las fotos de la solicitud.
--  Permisos: ven todos los usuarios activos; crean y editan administrador y operador. No hay borrado:
--  una orden se cancela (queda el registro).
-- Se puede correr más de una vez sin problema. No modifica datos existentes.
-- ============================================================================

create sequence if not exists public.service_order_seq;
grant usage, select on sequence public.service_order_seq to authenticated;

create table if not exists public.service_orders (
  id uuid primary key default gen_random_uuid(),
  order_no text not null unique,
  customer_name text not null,
  phone text,
  department text not null,
  city text not null,
  neighborhood text,
  address text not null,
  notes text,
  customer_report text,
  scheduled_date date not null,
  request_type text not null,
  products jsonb not null default '[]'::jsonb,
  total_minutes int not null default 0,
  photos jsonb not null default '[]'::jsonb,
  status text not null default 'Programada' check (status in ('Programada', 'Cancelada')),
  cancel_reason text,
  requester_email text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz
);
create index if not exists idx_service_orders_date on public.service_orders(scheduled_date);
create index if not exists idx_service_orders_created on public.service_orders(created_at);

-- El número de orden lo pone siempre la base de datos y no se puede modificar.
create or replace function public.service_orders_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.order_no := 'PS-' || lpad(nextval('public.service_order_seq')::text, 6, '0');
  elsif new.order_no is distinct from old.order_no then
    raise exception 'El número de orden no se puede modificar';
  end if;
  return new;
end $$;
drop trigger if exists trg_service_orders_guard on public.service_orders;
create trigger trg_service_orders_guard before insert or update on public.service_orders
  for each row execute function public.service_orders_guard();

alter table public.service_orders enable row level security;
drop policy if exists "service_orders_select" on public.service_orders;
drop policy if exists "service_orders_insert" on public.service_orders;
drop policy if exists "service_orders_update" on public.service_orders;
create policy "service_orders_select" on public.service_orders for select using (public.is_active_user());
create policy "service_orders_insert" on public.service_orders for insert with check (public.current_role() in ('admin', 'operador'));
create policy "service_orders_update" on public.service_orders for update
  using (public.current_role() in ('admin', 'operador')) with check (public.current_role() in ('admin', 'operador'));
-- No hay política de DELETE: las órdenes no se borran.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('programacion-fotos', 'programacion-fotos', false, 10485760,
        array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'])
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types, public = false;

drop policy if exists "programacion_fotos_select" on storage.objects;
drop policy if exists "programacion_fotos_insert" on storage.objects;
create policy "programacion_fotos_select" on storage.objects for select
  using (bucket_id = 'programacion-fotos' and public.is_active_user());
create policy "programacion_fotos_insert" on storage.objects for insert
  with check (bucket_id = 'programacion-fotos' and public.current_role() in ('admin', 'operador'));
