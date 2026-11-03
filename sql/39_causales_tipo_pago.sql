-- ============================================================================
-- Maestro de Causales · tipo de pago por causal (No Pago, Tarifa, Desplazamiento, Diagnóstico...).
-- La lista de tipos de pago se administra en Maestros > Causales (se guarda en assignment_settings, sin tablas nuevas).
-- Solo agrega una columna opcional a public.causales y carga los valores de la tabla entregada para las causales que ya existen
-- (solo donde aún no hay un tipo de pago). No borra ni modifica otros datos. Se puede correr más de una vez.
-- ============================================================================

alter table public.causales add column if not exists payment_type text;

update public.causales c set payment_type = v.tipo
from (values
  ('NO REALIZADO', 'No Pago'),
  ('CAL-TRA ARMADO DE MULTIMUEBLE', 'Tarifa'),
  ('INSTALACION DE PIEZA', 'Tarifa'),
  ('INSTALACION PIEZA', 'Tarifa'),
  ('DESARMADO DE MULTIMUEBLE', 'Tarifa'),
  ('CLIENTE ARMO EL PRODUCTO', 'Desplazamiento'),
  ('NO ARMADO POR NOVEDAD', 'Diagnóstico'),
  ('ARMADO CON NOVEDAD', 'Tarifa'),
  ('DIRECCION ERRADA', 'Desplazamiento'),
  ('CLIENTE NO RESIDE', 'Desplazamiento'),
  ('INMUEBLE CERRADO', 'Desplazamiento'),
  ('ESPERA PROLONGADA', 'Desplazamiento'),
  ('NO QUISO ARMADO', 'Desplazamiento'),
  ('CONDICION NO OPERABLE', 'Diagnóstico'),
  ('EMPAQUE', 'Tarifa'),
  ('AJUSTE DE PRODUCTO', 'Tarifa'),
  ('PRODUCTO NO ARMABLE', 'Desplazamiento')
) as v(nombre, tipo)
where upper(btrim(c.name)) = v.nombre and c.payment_type is null;
