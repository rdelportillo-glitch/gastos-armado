-- ============================================================================
-- 77 · Histórico de asignación → "Cierre en Extreme el mismo día" completado a mano (solo administrador)
--
--  - El histórico compara el día en que se cerró cada producto en Extreme (tabla cierre_extreme, que se llena al cargar el reporte de Extreme) con el día del servicio.
--  - Los servicios que NO aparecen en Extreme se completan a mano con "Cumplió" o "No cumplió". Ese dato se guarda aquí, en el mismo registro del histórico:
--      cierre_manual      'Cumplió' | 'No cumplió' (vacío = sin completar)
--      cierre_manual_por  quién lo marcó
--      cierre_manual_at   cuándo
--  - Solo el administrador puede marcarlo o cambiarlo: lo exige un disparador (trigger), no solo la pantalla. El quién y el cuándo los pone la base de datos.
--  - El cierre del día (que escribe otras columnas del mismo registro) no toca estas columnas, así que lo marcado no se pierde aunque se vuelva a cerrar el día.
-- Solo agrega columnas, una restricción y un disparador; no modifica ni borra datos existentes. Se puede correr más de una vez.
-- ============================================================================

alter table public.assignment_history add column if not exists cierre_manual text;
alter table public.assignment_history add column if not exists cierre_manual_por uuid references public.profiles(id);
alter table public.assignment_history add column if not exists cierre_manual_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'assignment_history_cierre_manual_check') then
    alter table public.assignment_history
      add constraint assignment_history_cierre_manual_check check (cierre_manual is null or cierre_manual in ('Cumplió', 'No cumplió'));
  end if;
end $$;

create or replace function public.assignment_history_cierre_manual_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.cierre_manual is distinct from old.cierre_manual then
    if auth.uid() is not null and public.current_role() is distinct from 'admin' then
      raise exception 'Solo el administrador puede completar el cierre en Extreme a mano.';
    end if;
    if new.cierre_manual is null then
      new.cierre_manual_por := null; new.cierre_manual_at := null;
    else
      new.cierre_manual_por := auth.uid(); new.cierre_manual_at := now();
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_assignment_history_cierre_manual on public.assignment_history;
create trigger trg_assignment_history_cierre_manual before update on public.assignment_history for each row execute function public.assignment_history_cierre_manual_guard();

notify pgrst, 'reload schema';
