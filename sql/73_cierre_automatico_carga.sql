-- ============================================================================
-- Carga: cierre automático del día (11:59 pm).
-- La plataforma finaliza sola el día de Carga a las 11:59 pm (en el navegador de un administrador u operador que la tenga abierta) y, si nadie la tenía abierta,
-- lo recupera en cuanto alguien entre después (hasta 3 días atrás). Para que dos personas conectadas no lo ejecuten a la vez, cada día se "reserva" con
-- una función atómica. Esta tabla solo guarda esa reserva y su resultado (quién lo hizo, cuándo y cómo terminó).
--   claim_cierre_dia(día)  → true si este usuario puede ejecutar el cierre de ese día (nadie lo hizo ni lo está haciendo; un intento anterior con error
--                            o "en curso" hace más de 10 minutos se puede retomar). Solo administrador y operador.
--   finish_cierre_dia(...) → marca el día como listo o con error (solo quien lo reservó).
-- El histórico ya es idempotente (un cierre repetido no duplica filas), así que un reintento es seguro.
-- No modifica ningún dato existente. Se puede correr más de una vez.
-- ============================================================================

create table if not exists public.carga_cierres_auto (
  day date primary key,
  status text not null check (status in ('en curso', 'listo', 'error')),
  claimed_by uuid references public.profiles(id),
  claimed_at timestamptz not null default now(),
  finished_at timestamptz,
  detail text
);

alter table public.carga_cierres_auto enable row level security;
drop policy if exists "cierres_auto_select" on public.carga_cierres_auto;
create policy "cierres_auto_select" on public.carga_cierres_auto for select
  using (public.is_active_user() and public.current_role() in ('admin', 'operador', 'consulta'));
-- Sin políticas de INSERT/UPDATE/DELETE: solo se escribe con las dos funciones de abajo.

create or replace function public.claim_cierre_dia(p_day date) returns boolean
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not (public.is_active_user() and public.current_role() in ('admin', 'operador')) then return false; end if;
  insert into public.carga_cierres_auto (day, status, claimed_by) values (p_day, 'en curso', auth.uid())
  on conflict (day) do update
    set status = 'en curso', claimed_by = auth.uid(), claimed_at = now(), finished_at = null, detail = null
    where carga_cierres_auto.status = 'error'
       or (carga_cierres_auto.status = 'en curso' and carga_cierres_auto.claimed_at < now() - interval '10 minutes');
  get diagnostics n = row_count;
  return n > 0;
end $$;

create or replace function public.finish_cierre_dia(p_day date, p_ok boolean, p_detail text) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.carga_cierres_auto
     set status = case when p_ok then 'listo' else 'error' end, finished_at = now(), detail = left(p_detail, 500)
   where day = p_day and claimed_by = auth.uid();
end $$;

revoke all on function public.claim_cierre_dia(date) from public;
revoke all on function public.finish_cierre_dia(date, boolean, text) from public;
grant execute on function public.claim_cierre_dia(date) to authenticated;
grant execute on function public.finish_cierre_dia(date, boolean, text) to authenticated;
