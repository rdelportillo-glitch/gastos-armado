-- ============================================================================
-- 45 · Instalación de TV → Ejecución y cobro: el técnico registra desde su usuario
--
-- Antes solo administrador y operador veían/registraban. Ahora el usuario con rol "tecnico":
--  1) Ve SOLO sus instalaciones (oferta con su ficha como técnico, o de un servicio que tiene asignado).
--  2) Registra el resultado de las que están pendientes: resultado, cobro (valor, cómo se pagó, referencia),
--     objeción/motivo, reclamo y el soporte de pago (foto). Tiene un margen de 2 horas, solo para adjuntar el soporte.
--  3) NO puede tocar el valor facturado ni el control del cobro (efectivo entregado, comprobante verificado) ni ningún dato de la oferta:
--     lo impide un disparador (trigger), no solo la pantalla.
--  4) Lee la configuración de Instalación de TV (para la lista de objeciones) y los permisos por rol (assignment_settings), solo esas dos claves.
--
-- Se puede correr más de una vez. No modifica datos existentes. Administrador y operador no cambian.
-- ============================================================================

-- ¿La persona de la sesión es un técnico activo?
create or replace function public.is_active_tecnico() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select active and role = 'tecnico' from public.profiles where id = auth.uid()), false);
$$;

-- ¿La oferta es de este técnico? (su ficha en la oferta, o un servicio de armado asignado a él con ese número de servicio)
create or replace function public.tv_offer_is_mine(p_servicio text, p_tecnico uuid) returns boolean language sql stable security definer set search_path = public as $$
  select public.is_active_tecnico() and public.my_technician() is not null and (
    p_tecnico = public.my_technician()
    or exists (select 1 from public.services s where s.servicio_externo = p_servicio and s.technician_id = public.my_technician())
  );
$$;

-- ---------------------------- tv_offers ----------------------------
drop policy if exists "tv_offers_select_tecnico" on public.tv_offers;
create policy "tv_offers_select_tecnico" on public.tv_offers for select
  using (estado in ('Aceptó', 'Indeciso') and public.tv_offer_is_mine(servicio, tecnico_id));

drop policy if exists "tv_offers_update_tecnico" on public.tv_offers;
create policy "tv_offers_update_tecnico" on public.tv_offers for update
  using (
    estado in ('Aceptó', 'Indeciso') and public.tv_offer_is_mine(servicio, tecnico_id)
    and (coalesce(ejecucion, 'Pendiente') = 'Pendiente' or (ejecucion_by = auth.uid() and ejecucion_at > now() - interval '2 hours'))
  )
  with check (estado in ('Aceptó', 'Indeciso') and public.tv_offer_is_mine(servicio, tecnico_id));
-- Sigue sin política de DELETE ni de INSERT para el técnico.

-- Qué columnas puede cambiar el técnico (todas las demás deben quedar idénticas)
create or replace function public.tv_offers_guard_tecnico() returns trigger language plpgsql security definer set search_path = public as $$
declare
  permitidas text[] := array['ejecucion', 'tecnico_id', 'convertido_en_casa', 'valor_cobrado', 'cobro_metodo', 'comprobante_ref', 'reclamo',
    'ejecucion_at', 'ejecucion_by', 'ejecucion_nota', 'soporte_pago_path', 'soporte_pago_nombre', 'soporte_pago_at', 'soporte_pago_by', 'updated_at'];
  soporte text[] := array['soporte_pago_path', 'soporte_pago_nombre', 'soporte_pago_at', 'soporte_pago_by', 'updated_at'];
begin
  if not public.is_active_tecnico() then return new; end if; -- administrador y operador: sin restricción
  if (to_jsonb(new) - permitidas) is distinct from (to_jsonb(old) - permitidas) then
    raise exception 'El técnico solo puede registrar el resultado, el cobro y el soporte de pago de la instalación.';
  end if;
  if new.tecnico_id is distinct from old.tecnico_id and new.tecnico_id is distinct from public.my_technician() then
    raise exception 'El técnico solo puede registrarse a sí mismo en la instalación.';
  end if;
  -- Ya registrada: solo se puede adjuntar el soporte (no cambiar lo reportado)
  if coalesce(old.ejecucion, 'Pendiente') <> 'Pendiente' and (to_jsonb(new) - soporte) is distinct from (to_jsonb(old) - soporte) then
    raise exception 'La instalación ya tiene resultado registrado: solo el operador puede corregirlo.';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_tv_offers_guard_tecnico on public.tv_offers;
create trigger trg_tv_offers_guard_tecnico before update on public.tv_offers for each row execute function public.tv_offers_guard_tecnico();

-- ------------------- configuración (solo dos claves) -------------------
drop policy if exists "assignment_settings_select_tecnico" on public.assignment_settings;
create policy "assignment_settings_select_tecnico" on public.assignment_settings for select
  using (public.is_active_tecnico() and key in ('tv_config', 'permisos_roles'));

-- ----------------- soporte de pago (bucket tv-soportes) -----------------
-- La carpeta de cada archivo es el id de la oferta: el técnico solo sube y ve soportes de SUS ofertas.
drop policy if exists "tv_soportes_select_tecnico" on storage.objects;
create policy "tv_soportes_select_tecnico" on storage.objects for select
  using (bucket_id = 'tv-soportes' and public.is_active_tecnico()
    and exists (select 1 from public.tv_offers o where o.id::text = (storage.foldername(name))[1]));
drop policy if exists "tv_soportes_insert_tecnico" on storage.objects;
create policy "tv_soportes_insert_tecnico" on storage.objects for insert
  with check (bucket_id = 'tv-soportes' and public.is_active_tecnico()
    and exists (select 1 from public.tv_offers o where o.id::text = (storage.foldername(name))[1]));
