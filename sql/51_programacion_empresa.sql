-- ============================================================================
-- 51 · Programación de servicios · empresa de la orden
--
-- Las órdenes de Programación entraban siempre a Asignación como empresa JAMAR (la tabla no guardaba la empresa). Con la carga masiva de servicios
-- (una sola plantilla para Jamar, Tugo, particulares y otras empresas) cada orden guarda su empresa en service_orders.company y viaja a Asignación,
-- Carga y los reportes. Las órdenes que ya existen quedan sin empresa y siguen entrando como JAMAR.
--
-- Solo agrega una columna opcional. No modifica ni borra datos. Se puede correr más de una vez.
-- ============================================================================

alter table public.service_orders add column if not exists company text;

notify pgrst, 'reload schema';
