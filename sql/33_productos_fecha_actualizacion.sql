-- ============================================================================
-- Productos de armado: fecha de actualizacion
--  Agrega assembly_products.updated_at: la fecha y hora de la ultima vez que cambio el producto (nombre, linea, tiempos, precios, estado, manual...).
--  La actualiza la propia base de datos con un trigger, venga el cambio de donde venga (Maestros, importacion, Asignacion...), y solo cuando
--  el registro realmente cambia (un guardado sin cambios no la mueve).
--  Los productos existentes arrancan con su fecha de creacion (o la del ultimo manual si es mas reciente).
--  No modifica otros datos. Se puede correr mas de una vez.
-- ============================================================================
alter table public.assembly_products add column if not exists updated_at timestamptz;
update public.assembly_products set updated_at = greatest(created_at, coalesce(manual_at, created_at)) where updated_at is null;
alter table public.assembly_products alter column updated_at set default now();
alter table public.assembly_products alter column updated_at set not null;
create index if not exists idx_assembly_products_updated on public.assembly_products(updated_at desc);

create or replace function public.assembly_products_touch() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.updated_at := coalesce(new.updated_at, now());
  elsif (to_jsonb(new) - 'updated_at') is distinct from (to_jsonb(old) - 'updated_at') then
    new.updated_at := now();
  else
    new.updated_at := old.updated_at;
  end if;
  return new;
end $$;
drop trigger if exists trg_assembly_products_touch on public.assembly_products;
create trigger trg_assembly_products_touch before insert or update on public.assembly_products
  for each row execute function public.assembly_products_touch();