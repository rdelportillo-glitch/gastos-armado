-- ============================================================================
-- Armados en almacen: APOYO (segundo tecnico en un armado)
--   1) store_assemblies: helper_id y helper_name (el nombre lo pone el sistema, igual que el del tecnico). El apoyo no puede ser el mismo tecnico.
--   2) El apoyo ve sus armados y las solicitudes en las que ayudo (mismas reglas que el tecnico).
--   3) Funcion armados_apoyos(): el tecnico (que no puede leer la tabla de personal) elige su apoyo entre los tecnicos de campo activos de SU departamento
--      (solo id y nombre).
-- No modifica datos. Se puede correr mas de una vez. Requiere sql/27 y sql/35.
-- ============================================================================

alter table public.store_assemblies add column if not exists helper_id uuid references public.technicians(id);
alter table public.store_assemblies add column if not exists helper_name text;
create index if not exists idx_store_assemblies_helper on public.store_assemblies(helper_id, assembled_on);

create or replace function public.store_assemblies_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.technician_name := (select name from public.technicians where id = new.technician_id);
  if new.helper_id is not null and new.helper_id = new.technician_id then raise exception 'El apoyo no puede ser el mismo tecnico del armado'; end if;
  new.helper_name := (select name from public.technicians where id = new.helper_id);
  if tg_op = 'INSERT' then
    if auth.uid() is not null then new.created_by := auth.uid(); end if;
  else
    new.updated_at := now();
    if auth.uid() is not null then new.updated_by := auth.uid(); end if;
  end if;
  return new;
end $$;

create or replace function public.i_worked_on(rid uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.store_assemblies where request_id = rid and (technician_id = public.my_technician() or helper_id = public.my_technician()));
$$;

drop policy if exists "store_assemblies_select" on public.store_assemblies;
create policy "store_assemblies_select" on public.store_assemblies for select
  using (public.is_active_user()
         or (public.current_role() = 'cliente' and public.request_client(request_id) = public.my_client())
         or (public.current_role() = 'tecnico' and (technician_id = public.my_technician() or helper_id = public.my_technician())));

create or replace function public.armados_apoyos()
returns table (id uuid, name text)
language sql stable security definer set search_path = public as $$
  select t.id, t.name
  from public.technicians t
  where public.current_role() = 'tecnico'
    and public.my_department() <> ''
    and public.norm_depto(t.department) = public.my_department()
    and t.status = 'Activo'
    and coalesce(t.category, '') <> 'Administrativo'
    and t.id <> public.my_technician()
  order by t.name;
$$;
revoke all on function public.armados_apoyos() from public;
revoke all on function public.armados_apoyos() from anon;
grant execute on function public.armados_apoyos() to authenticated;

-- Comprobacion (opcional): debe devolver 2 filas (helper_id, helper_name)
-- select column_name from information_schema.columns where table_schema = 'public' and table_name = 'store_assemblies' and column_name like 'helper%';
