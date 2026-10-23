-- ============================================================================
-- Armados en almacen: causal por producto
--  Cada armado que se registra (un producto) lleva una causal elegida de una lista (CAL-TRA ARMADO DE MULTIMUEBLE, PRODUCTO YA ARMADO,
--  DESARMADO DE MULTIMUEBLE, ARMADO CON NOVEDAD, CONDICION NO OPERABLE, ESPERA PROLONGADA, NO ARMADO POR NOVEDAD). La lista vive en la aplicacion;
--  en la base solo se guarda el texto. Es informativa: no cambia como cuentan las unidades armadas.
--  Los armados anteriores quedan con la causal vacia. No modifica datos existentes. Se puede correr mas de una vez.
-- ============================================================================
alter table public.store_assemblies add column if not exists cause text;