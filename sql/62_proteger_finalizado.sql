-- ============================================================================
-- Registros que quedaron en Carga aunque su dia ya esta finalizado (y en el Historico de asignacion).
-- Causa probable: al finalizar un dia, Carga marca cada registro como finalizado. Si otra persona tenia la pantalla abierta desde antes (sin recargar) y guarda un
-- cambio sobre ese mismo registro (por ejemplo al cargar el reporte de Extreme), su copia desactualizada vuelve a dejarlo "sin finalizar". Resultado: el registro
-- sigue apareciendo en Carga con la fecha de un dia ya cerrado, y los reportes que suman Historico + Carga lo cuentan dos veces.
--
-- Este script hace dos cosas, ambas solo sobre public.services (no toca el historico ni borra nada):
--   1) REPARA lo que ya paso: marca como finalizados los registros que siguen sin finalizar pero que YA estan en el historico (mismo registro y mismo dia, resultado Realizado),
--      y los duplicados cancelados (cancelados por Jamar, sin tecnico) cuyo servicio ya esta en el historico ese dia.
--   2) PROTEGE hacia adelante: un registro finalizado ya no se puede volver a "sin finalizar" por un guardado desactualizado. Solo se permite cuando el registro vuelve
--      a Pendiente (reprogramacion / reasignacion), que es el unico caso legitimo.
-- Se puede correr mas de una vez. La reparacion es reversible: poner finalized_at = null en esos registros los devuelve a Carga.
-- ============================================================================

-- 1) Reparacion
update public.services s
set finalized_at = now(),
    finalized_by = (select h.finalized_by from public.assignment_history h where h.service_id = s.id and h.day = s.date order by h.day limit 1)
where s.finalized_at is null
  and s.estado_gestion = 'Realizado'
  and exists (select 1 from public.assignment_history h where h.service_id = s.id and h.day = s.date);

update public.services s
set finalized_at = now()
where s.finalized_at is null
  and s.estado_gestion = 'Realizado'
  and s.technician_id is null
  and coalesce((s.asig->>'cancelada')::boolean, false)
  and s.date < current_date
  and exists (select 1 from public.assignment_history h where h.servicio = s.servicio_externo and h.day = s.date);

-- 2) Proteccion
create or replace function public.services_proteger_finalizado()
returns trigger
language plpgsql
as $$
begin
  if old.finalized_at is not null and new.finalized_at is null and coalesce(new.estado_gestion, '') <> 'Pendiente' then
    new.finalized_at := old.finalized_at;
    new.finalized_by := old.finalized_by;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_services_proteger_finalizado on public.services;
create trigger trg_services_proteger_finalizado
  before update on public.services
  for each row execute function public.services_proteger_finalizado();
