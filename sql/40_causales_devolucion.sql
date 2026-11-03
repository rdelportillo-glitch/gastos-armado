-- ============================================================================
-- Causales de devolución de Asignación: ALMACEN y SOBRECARGA.
-- Los servicios que quedan sin asignar en el paso 3 de Asignación se envían a Carga como devueltos, con una de estas dos causales (la elige el usuario).
-- Solo agrega las dos causales al maestro si todavía no existen (no pisa ni borra nada). Se puede correr más de una vez.
-- ============================================================================

insert into public.causales (name, active)
select v.nombre, true
from (values ('ALMACEN'), ('SOBRECARGA')) as v(nombre)
where not exists (select 1 from public.causales c where upper(btrim(c.name)) = v.nombre);
