-- ============================================================================
-- Armados en almacen: el tecnico solo ve (y trabaja) las solicitudes ABIERTAS de los almacenes de SU departamento
--  Antes un tecnico veia todas las solicitudes abiertas y las cerradas en las que habia trabajado. Ahora:
--   1) Solo ve solicitudes en estado Abierta cuyo almacen este en el mismo departamento que el de su ficha de Personal
--      (se compara sin importar tildes, mayusculas ni espacios: "Atlantico" = "ATLÁNTICO"). Las cerradas o canceladas ya no las ve.
--   2) Solo ve los almacenes de su departamento (para crear solicitudes directas).
--   3) Solo puede crear solicitudes directas y registrar o corregir armados en almacenes de su departamento.
--  Si la ficha del tecnico no tiene departamento, no ve solicitudes: hay que llenarlo en Personal.
--  No toca admin, operador, consulta ni cliente. No modifica datos. Se puede correr mas de una vez.
-- ============================================================================

-- Departamento sin tildes, en mayusculas y con espacios normalizados
create or replace function public.norm_depto(t text) returns text language sql immutable as $$
  select btrim(upper(regexp_replace(translate(coalesce(t, ''), 'áéíóúÁÉÍÓÚñÑüÜ', 'aeiouAEIOUnNuU'), '\s+', ' ', 'g')));
$$;

-- Departamento (normalizado) del tecnico que tiene la sesion; vacio si no tiene
create or replace function public.my_department() returns text language sql stable security definer set search_path = public as $$
  select public.norm_depto((select department from public.technicians where id = public.my_technician()));
$$;

-- ¿El almacen esta en el departamento del tecnico?
create or replace function public.warehouse_in_my_department(wid uuid) returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select public.my_department() <> '' and public.norm_depto(department) = public.my_department() from public.warehouses where id = wid), false);
$$;

-- ¿La solicitud es de un almacen del departamento del tecnico?
create or replace function public.request_in_my_department(rid uuid) returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select public.warehouse_in_my_department(warehouse_id) from public.store_requests where id = rid), false);
$$;

drop policy if exists "warehouses_select" on public.warehouses;
create policy "warehouses_select" on public.warehouses for select
  using (public.is_active_user()
         or (public.current_role() = 'cliente' and client = public.my_client())
         or (public.current_role() = 'tecnico' and active and public.my_department() <> '' and public.norm_depto(department) = public.my_department()));

drop policy if exists "store_requests_select" on public.store_requests;
create policy "store_requests_select" on public.store_requests for select
  using (public.is_active_user()
         or (public.current_role() = 'cliente' and client = public.my_client())
         or (public.current_role() = 'tecnico' and status = 'Abierta' and public.warehouse_in_my_department(warehouse_id)));

drop policy if exists "store_requests_insert_tecnico" on public.store_requests;
create policy "store_requests_insert_tecnico" on public.store_requests for insert
  with check (public.current_role() = 'tecnico' and origin = 'Directo' and status = 'Abierta' and public.my_technician() is not null
              and public.warehouse_in_my_department(warehouse_id));

drop policy if exists "store_assemblies_insert_tecnico" on public.store_assemblies;
create policy "store_assemblies_insert_tecnico" on public.store_assemblies for insert
  with check (public.current_role() = 'tecnico' and technician_id = public.my_technician() and public.request_open(request_id)
              and public.request_in_my_department(request_id));

drop policy if exists "store_assemblies_update_tecnico" on public.store_assemblies;
create policy "store_assemblies_update_tecnico" on public.store_assemblies for update
  using (public.current_role() = 'tecnico' and technician_id = public.my_technician() and public.request_open(request_id) and public.request_in_my_department(request_id))
  with check (public.current_role() = 'tecnico' and technician_id = public.my_technician() and public.request_open(request_id) and public.request_in_my_department(request_id));
