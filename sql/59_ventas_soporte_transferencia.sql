-- ============================================================================
-- 59 · Ventas → Pago por transferencia con su soporte, en la misma venta
--
--  - Cuando la venta se paga por TRANSFERENCIA, el técnico adjunta el soporte (foto o PDF del comprobante) y, si quiere, la referencia o número de aprobación,
--    en el mismo registro de la venta. El soporte es obligatorio: registrar_venta() no guarda una venta por transferencia sin él.
--  - Bucket privado "ventas-soportes" (máx. 5 MB; imágenes y PDF). La carpeta de cada archivo es el id de la ficha del técnico que vende:
--    el técnico solo sube y ve los suyos; administrador, operador y consulta ven todos (la consulta no sube).
--  - adjuntar_soporte_venta(): reemplaza el soporte vigente de una venta por transferencia (el archivo anterior queda guardado, no se borra).
--    El técnico solo puede hacerlo en las 2 horas siguientes a registrar la venta y solo en las suyas; administrador y operador, siempre.
--  - Reemplaza registrar_venta() (la de sql/58) para que reciba y valide el soporte. Si se vuelve a correr sql/58 después de este, hay que volver a correr este.
--
-- Solo agrega columnas, un bucket y funciones; no modifica ni borra datos existentes (las ventas por transferencia anteriores quedan sin soporte). Se puede correr más de una vez.
-- ============================================================================

alter table public.sales add column if not exists payment_ref text;
alter table public.sales add column if not exists payment_proof_path text;
alter table public.sales add column if not exists payment_proof_name text;
alter table public.sales add column if not exists payment_proof_at timestamptz;
alter table public.sales add column if not exists payment_proof_by uuid references public.profiles(id);

-- ------------------------------- Bucket de soportes -------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ventas-soportes', 'ventas-soportes', false, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'])
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types, public = false;

drop policy if exists "ventas_soportes_select" on storage.objects;
drop policy if exists "ventas_soportes_insert" on storage.objects;
create policy "ventas_soportes_select" on storage.objects for select
  using (bucket_id = 'ventas-soportes' and (public.is_active_user() or (public.is_active_tecnico() and (storage.foldername(name))[1] = public.my_technician()::text)));
create policy "ventas_soportes_insert" on storage.objects for insert
  with check (bucket_id = 'ventas-soportes' and (public.current_role() in ('admin', 'operador') or (public.is_active_tecnico() and (storage.foldername(name))[1] = public.my_technician()::text)));
-- Sin políticas de UPDATE ni DELETE: los soportes no se editan ni se borran.

-- ----------------------------------- Registrar venta -----------------------------------
-- p: { technician_id (solo administrador/operador), sale_date (solo administrador/operador), origin ('servicio' | 'particular'), service_no, customer_name, doc_type, doc_number,
--      payment_method ('Efectivo' | 'Transferencia'), payment_ref, payment_proof_path, payment_proof_name (obligatorios si es Transferencia), notes, items: [ { product_id, quantity } ] }
create or replace function public.registrar_venta(p jsonb) returns public.sales language plpgsql security definer set search_path = public as $$
declare
  v_es_tecnico boolean := public.is_active_tecnico();
  v_tec uuid;
  v_fecha date;
  v_origen text := coalesce(p->>'origin', 'servicio');
  v_nombre text := nullif(btrim(coalesce(p->>'customer_name', '')), '');
  v_pago text := p->>'payment_method';
  v_ruta text := nullif(btrim(coalesce(p->>'payment_proof_path', '')), '');
  v_venta public.sales;
  v_sp public.sales_products;
  v_nom text;
  v_stock numeric;
  v_lineas jsonb := '[]'::jsonb;
  r record;
begin
  if not v_es_tecnico and public.current_role() not in ('admin', 'operador') then
    raise exception 'Sin permiso para registrar ventas.';
  end if;
  if v_es_tecnico then
    v_tec := public.my_technician();
    v_fecha := (now() at time zone 'America/Bogota')::date;
  else
    v_tec := nullif(p->>'technician_id', '')::uuid;
    v_fecha := coalesce(nullif(p->>'sale_date', '')::date, (now() at time zone 'America/Bogota')::date);
  end if;
  if v_tec is null then raise exception 'La venta debe tener un técnico (el usuario no tiene ficha de Personal enlazada).'; end if;
  if v_origen not in ('servicio', 'particular') then raise exception 'Origen de venta no válido.'; end if;
  if v_nombre is null then raise exception 'Falta el nombre del cliente.'; end if;
  if v_pago is null or v_pago not in ('Efectivo', 'Transferencia') then raise exception 'Elige la forma de pago (Efectivo o Transferencia).'; end if;
  if v_pago = 'Transferencia' then
    if v_ruta is null then raise exception 'Adjunta el soporte de la transferencia.'; end if;
    if split_part(v_ruta, '/', 1) <> v_tec::text then raise exception 'El soporte de la transferencia no corresponde a este técnico.'; end if;
  else
    v_ruta := null;
  end if;
  if jsonb_typeof(p->'items') is distinct from 'array' or jsonb_array_length(p->'items') = 0 then raise exception 'Agrega al menos un producto.'; end if;

  -- Un solo registro a la vez por técnico: evita que dos ventas simultáneas gasten el mismo stock.
  perform pg_advisory_xact_lock(hashtextextended('ventas:' || v_tec::text, 0));

  -- Primero se revisa todo (productos, precios y stock); recién después se toma el consecutivo, así un intento fallido no deja huecos en la numeración.
  -- Los productos repetidos se suman; el precio y la comisión salen siempre de la lista de precios (no de lo que mande la pantalla).
  for r in
    select (e->>'product_id')::uuid as pid, sum((e->>'quantity')::int) as qty
    from jsonb_array_elements(p->'items') e group by 1
  loop
    if r.qty is null or r.qty <= 0 then raise exception 'La cantidad debe ser mayor que cero.'; end if;
    select * into v_sp from public.sales_products where product_id = r.pid;
    if not found or not v_sp.active then raise exception 'Ese producto no está disponible para la venta.'; end if;
    select name into v_nom from public.products where id = r.pid;
    v_stock := public.ventas_stock(v_tec, r.pid);
    if r.qty > v_stock then raise exception 'No hay stock suficiente de % (disponible: %, pedido: %).', v_nom, v_stock, r.qty; end if;
    v_lineas := v_lineas || jsonb_build_object('pid', r.pid, 'nombre', v_nom, 'qty', r.qty, 'precio', v_sp.unit_price, 'comision', v_sp.commission);
  end loop;

  insert into public.sales (consecutive, sale_date, technician_id, origin, service_no, customer_name, doc_type, doc_number, payment_method, notes, created_by,
                            payment_ref, payment_proof_path, payment_proof_name, payment_proof_at, payment_proof_by)
  values ('VEN-' || lpad(nextval('public.sales_seq')::text, 6, '0'), v_fecha, v_tec, v_origen,
          case when v_origen = 'servicio' then nullif(btrim(coalesce(p->>'service_no', '')), '') else null end,
          v_nombre, nullif(btrim(coalesce(p->>'doc_type', '')), ''), nullif(btrim(coalesce(p->>'doc_number', '')), ''), v_pago,
          nullif(btrim(coalesce(p->>'notes', '')), ''), auth.uid(),
          case when v_pago = 'Transferencia' then nullif(btrim(coalesce(p->>'payment_ref', '')), '') else null end,
          v_ruta, case when v_ruta is null then null else nullif(btrim(coalesce(p->>'payment_proof_name', '')), '') end,
          case when v_ruta is null then null else now() end, case when v_ruta is null then null else auth.uid() end)
  returning * into v_venta;

  insert into public.sale_items (sale_id, product_id, product_name, quantity, unit_price, commission)
  select v_venta.id, (l->>'pid')::uuid, l->>'nombre', (l->>'qty')::int, (l->>'precio')::numeric, (l->>'comision')::numeric
  from jsonb_array_elements(v_lineas) l;

  update public.sales s set total = x.t, commission_total = x.c
  from (select coalesce(sum(line_total), 0) as t, coalesce(sum(commission_total), 0) as c from public.sale_items where sale_id = v_venta.id) x
  where s.id = v_venta.id
  returning s.* into v_venta;
  return v_venta;
end;
$$;

-- ------------------------- Adjuntar o reemplazar el soporte -------------------------
create or replace function public.adjuntar_soporte_venta(p_venta uuid, p_path text, p_nombre text, p_ref text default null) returns public.sales language plpgsql security definer set search_path = public as $$
declare
  v_venta public.sales;
  v_es_tecnico boolean := public.is_active_tecnico();
begin
  if not v_es_tecnico and public.current_role() not in ('admin', 'operador') then raise exception 'Sin permiso para adjuntar el soporte.'; end if;
  select * into v_venta from public.sales where id = p_venta;
  if not found then raise exception 'La venta no existe.'; end if;
  if v_venta.status <> 'Activa' then raise exception 'La venta está anulada.'; end if;
  if v_venta.payment_method <> 'Transferencia' then raise exception 'Solo las ventas por transferencia llevan soporte.'; end if;
  if v_es_tecnico then
    if v_venta.technician_id is distinct from public.my_technician() then raise exception 'Esa venta no es tuya.'; end if;
    if v_venta.created_at < now() - interval '2 hours' then raise exception 'Pasaron más de 2 horas desde el registro: pídele al operador que cambie el soporte.'; end if;
  end if;
  if nullif(btrim(coalesce(p_path, '')), '') is null or split_part(p_path, '/', 1) <> v_venta.technician_id::text then raise exception 'El soporte no corresponde a este técnico.'; end if;
  update public.sales set payment_proof_path = p_path, payment_proof_name = nullif(btrim(coalesce(p_nombre, '')), ''), payment_proof_at = now(), payment_proof_by = auth.uid(),
         payment_ref = coalesce(nullif(btrim(coalesce(p_ref, '')), ''), payment_ref)
  where id = p_venta returning * into v_venta;
  return v_venta;
end;
$$;

revoke all on function public.registrar_venta(jsonb) from public, anon;
revoke all on function public.adjuntar_soporte_venta(uuid, text, text, text) from public, anon;
grant execute on function public.registrar_venta(jsonb) to authenticated;
grant execute on function public.adjuntar_soporte_venta(uuid, text, text, text) to authenticated;

notify pgrst, 'reload schema';
