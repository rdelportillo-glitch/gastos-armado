-- ============================================================================
-- 60 · Histórico de asignación → anular registros (solo administrador)
--
--  - Un registro del histórico se ANULA (no se borra): queda guardado con el motivo, quién lo anuló y cuándo, y se puede restaurar.
--    Los registros anulados no cuentan en el histórico, el CSV, el Informe de cierre Jamar, el Resumen de rutas ni los viáticos.
--  - Solo el administrador puede anular o restaurar: lo exige un disparador (trigger), no solo la pantalla. El operador sigue pudiendo cerrar el día
--    (el cierre no toca estas columnas, así que un registro anulado sigue anulado aunque se vuelva a cerrar el mismo día).
--  - No hay política de DELETE: el histórico no se borra.
-- Solo agrega columnas y un disparador; no modifica ni borra datos existentes. Se puede correr más de una vez.
-- ============================================================================

alter table public.assignment_history add column if not exists anulado boolean not null default false;
alter table public.assignment_history add column if not exists anulado_motivo text;
alter table public.assignment_history add column if not exists anulado_por uuid references public.profiles(id);
alter table public.assignment_history add column if not exists anulado_at timestamptz;
create index if not exists idx_assignment_history_anulado on public.assignment_history(anulado) where anulado;

create or replace function public.assignment_history_anulacion_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.anulado is distinct from old.anulado or new.anulado_motivo is distinct from old.anulado_motivo then
    if auth.uid() is not null and public.current_role() is distinct from 'admin' then
      raise exception 'Solo el administrador puede anular o restaurar registros del histórico.';
    end if;
    if new.anulado then
      if nullif(btrim(coalesce(new.anulado_motivo, '')), '') is null then raise exception 'Escribe el motivo de la anulación.'; end if;
      new.anulado_motivo := btrim(new.anulado_motivo);
      if old.anulado is distinct from true then new.anulado_por := auth.uid(); new.anulado_at := now(); end if;
    else
      new.anulado_motivo := null; new.anulado_por := null; new.anulado_at := null;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_assignment_history_anulacion on public.assignment_history;
create trigger trg_assignment_history_anulacion before update on public.assignment_history for each row execute function public.assignment_history_anulacion_guard();

notify pgrst, 'reload schema';
