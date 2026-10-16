-- ============================================================================
-- Rol "cliente" (para Jamar y futuros clientes): acceso solo al módulo de Programación de servicios,
-- y solo con tipo de solicitud "Ruta Critica". Se aplica en la base de datos, no solo en la pantalla.
--  1) profiles.role acepta 'cliente'.
--  2) is_active_user() deja de aceptar a un cliente: así NINGUNA tabla interna (gastos, personal, servicios,
--     maestros, ajustes, archivos...) le responde, ni por la API directa. Los permisos de abajo son los únicos que tiene.
--  3) El cliente solo ve y crea sus propias órdenes (service_orders), únicamente "Ruta Critica" y en estado Programada;
--     no puede editarlas ni cancelarlas. Para llenar el formulario lee departamentos, ciudades y barrios, y busca
--     productos con una función que NO devuelve precios (cliente_buscar_productos).
--  4) Sube las fotos de su solicitud a "programacion-fotos" y solo ve las que subió.
--  5) Seguridad adicional (aplica a todos los roles):
--     - profiles: un usuario ya no puede cambiarse a sí mismo el rol ni el estado activo (solo un administrador);
--       antes la política de actualización lo permitía. Un cliente tampoco ve la lista de usuarios de la empresa.
--     - service_orders: created_by siempre es quien inserta (no se puede suplantar).
-- Se puede correr más de una vez sin problema. No modifica datos existentes.
-- ============================================================================

-- 1) Rol permitido
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('admin', 'operador', 'consulta', 'cliente'));

-- 2) Un cliente no cuenta como "usuario activo interno"
create or replace function public.is_active_user()
returns boolean as $$
  select coalesce((select active and role <> 'cliente' from public.profiles where id = auth.uid()), false);
$$ language sql stable security definer;

-- 5) profiles: el rol y el estado solo los cambia un administrador; el cliente no ve a los demás usuarios
create or replace function public.profiles_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and (new.role is distinct from old.role or new.active is distinct from old.active)
     and coalesce(public.current_role(), '') <> 'admin' then
    raise exception 'Solo un administrador puede cambiar el rol o el estado de un usuario';
  end if;
  return new;
end $$;
drop trigger if exists trg_profiles_guard on public.profiles;
create trigger trg_profiles_guard before update on public.profiles for each row execute function public.profiles_guard();

drop policy if exists "profiles_select_authenticated" on public.profiles;
create policy "profiles_select_authenticated" on public.profiles for select
  using (auth.role() = 'authenticated' and (id = auth.uid() or coalesce(public.current_role(), '') <> 'cliente'));

-- 3) Órdenes del cliente
create or replace function public.service_orders_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.order_no := 'PS-' || lpad(nextval('public.service_order_seq')::text, 6, '0');
    if auth.uid() is not null then new.created_by := auth.uid(); end if;
  elsif new.order_no is distinct from old.order_no then
    raise exception 'El número de orden no se puede modificar';
  end if;
  return new;
end $$;

drop policy if exists "service_orders_select" on public.service_orders;
drop policy if exists "service_orders_insert_cliente" on public.service_orders;
create policy "service_orders_select" on public.service_orders for select
  using (public.is_active_user() or (public.current_role() = 'cliente' and created_by = auth.uid()));
create policy "service_orders_insert_cliente" on public.service_orders for insert
  with check (public.current_role() = 'cliente' and request_type = 'Ruta Critica' and status = 'Programada');
-- (el cliente no tiene política de UPDATE ni de DELETE)

-- Listas para el formulario: departamentos y barrios (sin datos sensibles) para el cliente
drop policy if exists "geo_abbreviations_select_cliente" on public.geo_abbreviations;
create policy "geo_abbreviations_select_cliente" on public.geo_abbreviations for select using (public.current_role() = 'cliente');
drop policy if exists "geo_neighborhoods_select_cliente" on public.geo_neighborhoods;
create policy "geo_neighborhoods_select_cliente" on public.geo_neighborhoods for select using (public.current_role() = 'cliente');

-- Búsqueda de productos para el cliente: solo código, nombre, tiempo, personas, línea y sublínea (sin precios ni proveedor)
create or replace function public.cliente_buscar_productos(q text)
returns table (code text, name text, minutes int, persons int, line text, subline text)
language sql stable security definer set search_path = public as $$
  select p.code, p.name, p.minutes, p.persons, p.line, p.subline
  from public.assembly_products p
  where public.current_role() in ('cliente', 'admin', 'operador') and p.active
    and (p.code ilike '%' || btrim(q) || '%' or p.name ilike '%' || btrim(q) || '%')
  order by p.name limit 15;
$$;
revoke all on function public.cliente_buscar_productos(text) from public;
grant execute on function public.cliente_buscar_productos(text) to authenticated;

-- 4) Fotos de la solicitud: el cliente sube y ve solo las suyas
drop policy if exists "programacion_fotos_insert" on storage.objects;
create policy "programacion_fotos_insert" on storage.objects for insert
  with check (bucket_id = 'programacion-fotos' and public.current_role() in ('admin', 'operador', 'cliente'));
drop policy if exists "programacion_fotos_select_cliente" on storage.objects;
create policy "programacion_fotos_select_cliente" on storage.objects for select
  using (bucket_id = 'programacion-fotos' and public.current_role() = 'cliente' and owner_id = auth.uid()::text);
