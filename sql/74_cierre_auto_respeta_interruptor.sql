-- ============================================================================
-- Carga: el cierre automático respeta el interruptor "Cierre automático 11:59 pm" desde la base de datos.
-- Hasta ahora el interruptor (assignment_settings, clave carga_cierre_auto) solo lo leía el navegador de quien tenía la plataforma abierta. Se vio que, con el interruptor
-- apagado, el cierre automático corrió igual desde el navegador de un operador (días 2026-11-18 y 2026-11-19). Ahora la función que reserva el cierre de cada día
-- (claim_cierre_dia) también lo revisa: si el interruptor está apagado, no reserva el día y nadie puede ejecutar el cierre automático, sin importar el navegador.
--   · Sin interruptor guardado o encendido: todo igual que antes.
--   · Apagado ({"activo": false}): claim_cierre_dia devuelve false.
-- El botón manual "Finalizar día" no usa esta función y sigue funcionando siempre.
-- Solo reemplaza una función; no modifica ni borra datos. Se puede correr más de una vez.
-- ============================================================================

create or replace function public.claim_cierre_dia(p_day date) returns boolean
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not (public.is_active_user() and public.current_role() in ('admin', 'operador')) then return false; end if;
  -- Interruptor apagado: no se reserva ningún día.
  if exists (select 1 from public.assignment_settings s where s.key = 'carga_cierre_auto' and (s.value ->> 'activo') = 'false') then return false; end if;
  insert into public.carga_cierres_auto (day, status, claimed_by) values (p_day, 'en curso', auth.uid())
  on conflict (day) do update
    set status = 'en curso', claimed_by = auth.uid(), claimed_at = now(), finished_at = null, detail = null
    where carga_cierres_auto.status = 'error'
       or (carga_cierres_auto.status = 'en curso' and carga_cierres_auto.claimed_at < now() - interval '10 minutes');
  get diagnostics n = row_count;
  return n > 0;
end $$;

revoke all on function public.claim_cierre_dia(date) from public;
grant execute on function public.claim_cierre_dia(date) to authenticated;
