-- ============================================================================
-- Activos y herramientas: departamento donde esta cada herramienta.
-- Permite ver cuantas herramientas DISPONIBLES hay por departamento (las
-- asignadas ya se ubican por el departamento del tecnico, pero una herramienta
-- disponible no tiene tecnico, asi que necesita su propia ubicacion).
-- Ejecutar en el SQL Editor de Supabase ANTES de publicar la version de la
-- app que incluye este campo (si no, guardar cualquier herramienta falla).
-- ============================================================================
-- Columna opcional; es seguro correrlo mas de una vez.

alter table public.assets
  add column if not exists department text;

-- Relleno inicial, solo donde esta vacio: herramientas asignadas toman el
-- departamento de su tecnico actual...
update public.assets a
set department = t.department
from public.technicians t
where a.department is null
  and a.technician_id = t.id
  and t.department is not null;

-- ...y las disponibles que alguna vez se asignaron toman el departamento del
-- ultimo tecnico que las tuvo (donde probablemente fueron devueltas).
update public.assets a
set department = t.department
from (
  select distinct on (asset_id) asset_id, technician_id
  from public.asset_assignments
  order by asset_id, from_date desc, created_at desc
) l
join public.technicians t on t.id = l.technician_id
where a.id = l.asset_id
  and a.department is null
  and t.department is not null;

-- No se requieren cambios de RLS.
