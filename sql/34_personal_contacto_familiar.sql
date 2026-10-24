-- ============================================================================
-- Personal: telefono de un familiar o contacto de emergencia
--  Agrega technicians.family_contact_phone (texto, opcional). No modifica datos existentes ni permisos (RLS).
--  Se puede correr mas de una vez. Ejecutar ANTES de usar la version de la app que incluye el campo
--  (si no, guardar una persona falla porque la columna no existe).
-- ============================================================================
alter table public.technicians add column if not exists family_contact_phone text;