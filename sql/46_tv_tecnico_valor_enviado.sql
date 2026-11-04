-- ============================================================================
-- 46 · Instalación de TV → Ejecución y cobro: ajuste del rol técnico (continúa el sql 45)
--
--  1) El técnico ahora SÍ registra el "Valor Enviado a Biver" (columna valor_facturado, solo cambió el nombre en pantalla).
--  2) El técnico NO puede editar el valor cobrado: solo puede dejarlo igual al valor acordado de la oferta (valor_total).
--     Lo impide el disparador, no solo la pantalla. Administrador y operador siguen editándolo.
--  Sigue sin poder tocar el control del cobro (efectivo entregado, comprobante verificado) ni los datos de la oferta.
--
-- Solo reemplaza la función del disparador creada en el sql 45. Se puede correr más de una vez. No modifica datos.
-- ============================================================================

create or replace function public.tv_offers_guard_tecnico() returns trigger language plpgsql security definer set search_path = public as $$
declare
  permitidas text[] := array['ejecucion', 'tecnico_id', 'convertido_en_casa', 'valor_cobrado', 'valor_facturado', 'cobro_metodo', 'comprobante_ref', 'reclamo',
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
  -- El valor cobrado es fijo para el técnico: queda igual al valor acordado de la oferta
  if new.valor_cobrado is distinct from old.valor_cobrado and new.valor_cobrado is distinct from new.valor_total then
    raise exception 'El técnico no puede editar el valor cobrado: es el valor acordado de la oferta.';
  end if;
  -- Ya registrada: solo se puede adjuntar el soporte (no cambiar lo reportado)
  if coalesce(old.ejecucion, 'Pendiente') <> 'Pendiente' and (to_jsonb(new) - soporte) is distinct from (to_jsonb(old) - soporte) then
    raise exception 'La instalación ya tiene resultado registrado: solo el operador puede corregirlo.';
  end if;
  return new;
end;
$$;
-- El disparador trg_tv_offers_guard_tecnico (sql 45) ya apunta a esta función: no hay que recrearlo.
