-- ============================================================================
-- Modulo "Carga": trae datos de la Plantilla de carga (servicio, tecnico
-- titular/apoyo, producto, cliente...) y del Reporte de Extreme (causal,
-- diagnostico, estado), cruzados por la llave Servicio + Codigo de producto.
-- Ejecutar en el SQL Editor de Supabase ANTES de publicar la version de la
-- app que incluye este modulo.
-- ============================================================================
-- Todas las columnas son opcionales y no tocan los registros existentes de
-- "services" (Trabajos realizados) creados manualmente o por el importador
-- anterior; esos siguen funcionando igual, simplemente no tienen estos
-- campos llenos.

alter table public.services
  add column servicio_externo text,
  add column producto_externo_codigo text,
  add column producto_externo_nombre text,
  add column cliente_nombre text,
  add column direccion text,
  add column departamento_externo text,
  add column ciudad_externa text,
  add column tecnico2_nombre text,
  add column tecnico3_nombre text,
  add column estado_extreme text,
  add column causal_extreme text,
  add column diagnostico text,
  add column causal_auditada text,
  add column fecha_prog date;

-- Llave de cruce Servicio + Codigo de producto, para encontrar rapido el
-- registro al importar el Reporte de Extreme y para evitar duplicados al
-- reimportar la misma Plantilla.
create index idx_services_servicio_codigo on public.services(servicio_externo, producto_externo_codigo);

-- No se requieren cambios de RLS: las politicas existentes sobre "services"
-- no distinguen por columna.
