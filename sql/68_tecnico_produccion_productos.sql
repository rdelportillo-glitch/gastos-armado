-- ============================================================================
-- Técnicos con contrato "Producción": ver (solo ver) el catálogo de Productos de armado del Maestro.
--
-- Un técnico (rol "tecnico") no puede leer las tablas internas. Estas dos funciones de LECTURA le dan lo único que necesita, y solo si su ficha de Personal tiene el tipo de contrato
-- "Producción":
--   · tecnico_ve_productos_armado(): ¿puede ver el catálogo? (true para el administrador, el operador y la consulta, y para el técnico con contrato Producción)
--   · tecnico_productos_armado():    el catálogo de productos activos: código, producto, línea, sublínea, minutos, personas y precio de armado (individual y entre dos).
-- No devuelve proveedor ni archivos, y no permite crear, editar ni borrar nada. Un técnico con otro tipo de contrato (Biver, Temporal) o sin ficha no recibe nada.
-- Solo agrega dos funciones de lectura (no crea tablas ni cambia datos). Se puede correr más de una vez.
-- ============================================================================

create or replace function public.tecnico_ve_productos_armado()
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.current_role() in ('admin', 'operador', 'consulta'), false)
      or exists (
        select 1
        from public.profiles p
        join public.technicians t on t.id = p.technician_id
        where p.id = auth.uid() and p.role = 'tecnico' and p.active
          and t.contract_type ilike 'produc%'
      );
$$;

create or replace function public.tecnico_productos_armado()
returns table (code text, name text, line text, subline text, minutes int, persons int, price_single numeric, price_pair numeric)
language sql stable security definer set search_path = public as $$
  select p.code, p.name, p.line, p.subline, p.minutes, p.persons, p.price_single, p.price_pair
  from public.assembly_products p
  where p.active and public.tecnico_ve_productos_armado()
  order by p.name;
$$;

revoke all on function public.tecnico_ve_productos_armado() from public;
revoke all on function public.tecnico_productos_armado() from public;
grant execute on function public.tecnico_ve_productos_armado() to authenticated;
grant execute on function public.tecnico_productos_armado() to authenticated;

notify pgrst, 'reload schema';
