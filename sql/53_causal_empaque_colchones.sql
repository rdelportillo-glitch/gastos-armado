-- ============================================================================
-- Causal de devolución EMPAQUE COLCHONES (junto a ALMACEN y SOBRECARGA).
-- Los servicios que quedan sin asignar en el paso 3 de Asignación se envían a Carga como devueltos, con una de estas causales (la elige el usuario).
-- Solo agrega la causal al maestro si todavía no existe (no pisa ni borra nada). Se puede correr más de una vez.
-- Después, en Maestros → Causales, se le puede poner la Gestión que corresponda (igual que a ALMACEN y SOBRECARGA).
-- ============================================================================

insert into public.causales (name, active)
select v.nombre, true
from (values ('EMPAQUE COLCHONES')) as v(nombre)
where not exists (select 1 from public.causales c where upper(btrim(c.name)) = v.nombre);
