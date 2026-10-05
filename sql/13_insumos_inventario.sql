-- ============================================================================
-- Insumos con inventario: cada insumo del catalogo puede llevar su propio
-- stock ("Controla inventario"), y cada compra/entrega de stock tiene un
-- consecutivo (COM-0001, ENT-0001).
-- Ejecutar en el SQL Editor de Supabase ANTES de publicar la version de la
-- app que incluye esto (si no, no se podran guardar compras ni entregas).
-- ============================================================================
-- Se puede correr mas de una vez sin problema.

-- 1) Marca por insumo (por defecto ninguno la lleva; lo ya controlado por
--    subcategoria, como el Vinipel, sigue funcionando igual).
alter table public.products
  add column if not exists track_stock boolean not null default false;

-- 2) Consecutivo de cada movimiento de stock.
alter table public.stock_movements
  add column if not exists consecutive text;

-- 3) Consecutivo para los movimientos que ya existen, en orden de creacion,
--    continuando despues del mayor que ya haya por tipo.
with base as (
  select type, coalesce(max(substring(consecutive from '[0-9]+$')::int), 0) as mx
  from public.stock_movements
  where consecutive is not null
  group by type
), numbered as (
  select m.id,
         case when m.type = 'Compra' then 'COM' else 'ENT' end as prefix,
         coalesce(b.mx, 0) + row_number() over (partition by m.type order by m.created_at, m.id) as n
  from public.stock_movements m
  left join base b on b.type = m.type
  where m.consecutive is null
)
update public.stock_movements m
set consecutive = numbered.prefix || '-' || lpad(numbered.n::text, 4, '0')
from numbered
where m.id = numbered.id;

-- 4) No permite dos movimientos con el mismo consecutivo.
create unique index if not exists stock_movements_consecutive_unique
  on public.stock_movements (consecutive)
  where consecutive is not null;

-- No se requieren cambios de RLS.
