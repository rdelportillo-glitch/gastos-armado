-- ============================================================================
-- Módulo de Personal: permite clasificar cada registro como técnico de campo
-- o personal administrativo, para que gastos, activos, servicios e
-- inventario también se puedan asignar a personal administrativo.
-- Ejecutar en el SQL Editor de Supabase DESPUÉS de 01, 02, 03 (y 05 si ya
-- se aplicó el cambio de inventario).
-- ============================================================================
-- No se crea una tabla nueva ni se toca ninguna relación existente: se
-- agrega una sola columna a "technicians" con un valor por defecto, así que
-- todos los técnicos ya existentes quedan automáticamente clasificados como
-- "Técnico de campo" sin necesidad de tocarlos uno por uno.

alter table public.technicians
  add column category text not null default 'Técnico de campo' check (category in ('Técnico de campo', 'Administrativo'));

create index idx_technicians_category on public.technicians(category);

-- No se requieren cambios de RLS: las políticas existentes sobre
-- "technicians" no distinguen por columna.
