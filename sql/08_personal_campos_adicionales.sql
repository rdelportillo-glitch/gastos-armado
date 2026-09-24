-- ============================================================================
-- Personal: campos adicionales (placa, contrato, pico y placa, transporte,
-- capacidad, vivienda, cuenta bancaria).
-- Ejecutar en el SQL Editor de Supabase ANTES de usar la version de la app que
-- incluye estos campos (si no, guardar cualquier persona falla).
-- ============================================================================
-- Todas las columnas son opcionales (null) y no tocan datos existentes. El
-- "Comentarios" de la pantalla reutiliza la columna "notes" que ya existia.

alter table public.technicians
  add column plate text,
  add column contract_type text,
  add column pico_placa_day text,
  add column transport_mode text,
  add column capacity_minutes numeric,
  add column residence text,
  add column bank_account text,
  add column bank_account_type text;

-- No se requieren cambios de RLS.
