-- ============================================================================
-- Trabajos realizados: cada registro pasa a representar un producto
-- trabajado por un técnico (antes era "servicio + tipo + cantidad").
-- Ejecutar en el SQL Editor de Supabase DESPUÉS de 01, 02, 03 (y 05/06 si ya
-- se aplicaron los cambios de inventario y personal).
-- ============================================================================
-- No se elimina ni se renombra la tabla "services" ni sus columnas
-- existentes: los registros antiguos (con service_type y sin producto) se
-- conservan tal cual y se siguen contando igual que hoy en los reportes.

alter table public.services
  add column product_id uuid references public.products(id),
  add column observacion_trabajo text check (observacion_trabajo in ('Desarme', 'Empaque', 'N.A.N')),
  add column armado text check (armado in ('SI', 'NO')),
  alter column service_type drop not null;

create index idx_services_product on public.services(product_id);

-- No se requieren cambios de RLS: las políticas existentes sobre
-- "services" no distinguen por columna.
