-- ============================================================================
-- 58 · Comercial → Ventas: venta de productos por los técnicos, con su inventario, precios y comisión
--
--  - public.sales_products:      qué insumos con inventario se venden, a qué precio y con qué comisión por unidad (los edita solo el administrador).
--  - public.sales_price_history: historial automático de cada cambio de precio o comisión.
--  - public.sales / sale_items:  cada venta (consecutivo propio VEN-000001) con sus productos. Cada línea guarda el precio y la comisión VIGENTES al vender,
--                                así cambiar el precio después no altera las ventas pasadas.
--  - Inventario del técnico = lo que se le ENTREGÓ (Inventario → Entrega) menos lo que VENDIÓ. Cada venta lo descuenta; anular una venta lo devuelve.
--    El stock del almacén no cambia al vender: ese ya salió cuando se hizo la entrega al técnico.
--
--  Seguridad: las ventas SOLO se crean y se anulan con las funciones registrar_venta() y anular_venta(). Ahí la base de datos pone el precio y la comisión,
--  revisa que el técnico tenga stock y que la persona sea quien dice ser; nadie escribe directo en las tablas de ventas. El técnico ve solo sus ventas.
--  La venta guarda el nombre y el documento del cliente (para facturar más adelante): los ve el administrador, el operador, la consulta y el técnico que la hizo.
--
-- Solo crea objetos nuevos; no modifica ni borra datos existentes. Se puede correr más de una vez.
-- ============================================================================

create sequence if not exists public.sales_seq;

-- ------------------------- Qué se vende y a qué precio -------------------------
create table if not exists public.sales_products (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null unique references public.products(id),
  unit_price numeric not null check (unit_price >= 0),
  commission numeric not null default 0 check (commission >= 0),   -- comisión del técnico por unidad vendida
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

create table if not exists public.sales_price_history (
  id uuid primary key default gen_random_uuid(),
  sales_product_id uuid not null references public.sales_products(id),
  product_id uuid not null references public.products(id),
  unit_price numeric not null,
  commission numeric not null,
  active boolean not null,
  changed_by uuid references public.profiles(id),
  changed_at timestamptz not null default now()
);
create index if not exists idx_sales_price_history_prod on public.sales_price_history(product_id, changed_at);

create or replace function public.sales_products_historial() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.unit_price = old.unit_price and new.commission = old.commission and new.active = old.active then return new; end if;
  insert into public.sales_price_history (sales_product_id, product_id, unit_price, commission, active, changed_by)
  values (new.id, new.product_id, new.unit_price, new.commission, new.active, auth.uid());
  return new;
end;
$$;
drop trigger if exists trg_sales_products_historial on public.sales_products;
create trigger trg_sales_products_historial after insert or update on public.sales_products for each row execute function public.sales_products_historial();

-- ----------------------------------- Ventas -----------------------------------
create table if not exists public.sales (
  id uuid primary key default gen_random_uuid(),
  consecutive text not null unique,
  sale_date date not null default current_date,
  technician_id uuid not null references public.technicians(id),
  origin text not null check (origin in ('servicio', 'particular')),   -- servicio: se vendió durante un servicio · particular: a un cliente sin servicio
  service_no text,
  customer_name text not null,
  doc_type text,
  doc_number text,
  payment_method text not null check (payment_method in ('Efectivo', 'Transferencia')),
  notes text,
  total numeric not null default 0,
  commission_total numeric not null default 0,
  status text not null default 'Activa' check (status in ('Activa', 'Anulada')),
  void_reason text,
  voided_by uuid references public.profiles(id),
  voided_at timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists idx_sales_tecnico on public.sales(technician_id, sale_date);
create index if not exists idx_sales_fecha on public.sales(sale_date);

create table if not exists public.sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales(id),
  product_id uuid not null references public.products(id),
  product_name text not null,
  quantity int not null check (quantity > 0),
  unit_price numeric not null,                                          -- precio vigente al vender
  commission numeric not null,                                          -- comisión por unidad vigente al vender
  line_total numeric generated always as (quantity * unit_price) stored,
  commission_total numeric generated always as (quantity * commission) stored
);
create index if not exists idx_sale_items_sale on public.sale_items(sale_id);
create index if not exists idx_sale_items_product on public.sale_items(product_id);

-- ------------------------------- Permisos (RLS) -------------------------------
alter table public.sales_products enable row level security;
alter table public.sales_price_history enable row level security;
alter table public.sales enable row level security;
alter table public.sale_items enable row level security;

drop policy if exists "sales_products_select" on public.sales_products;
drop policy if exists "sales_products_insert" on public.sales_products;
drop policy if exists "sales_products_update" on public.sales_products;
create policy "sales_products_select" on public.sales_products for select using (public.is_active_user());
create policy "sales_products_insert" on public.sales_products for insert with check (public.current_role() = 'admin');
create policy "sales_products_update" on public.sales_products for update using (public.current_role() = 'admin') with check (public.current_role() = 'admin');

drop policy if exists "sales_price_history_select" on public.sales_price_history;
create policy "sales_price_history_select" on public.sales_price_history for select using (public.is_active_user());

drop policy if exists "sales_select" on public.sales;
create policy "sales_select" on public.sales for select
  using (public.is_active_user() or (public.is_active_tecnico() and technician_id = public.my_technician()));

drop policy if exists "sale_items_select" on public.sale_items;
create policy "sale_items_select" on public.sale_items for select
  using (exists (select 1 from public.sales s where s.id = sale_items.sale_id));
-- Sin políticas de INSERT / UPDATE / DELETE en ventas: solo se escribe con registrar_venta() y anular_venta().

-- ------------------------------ Inventario del técnico ------------------------------
-- Unidades de un producto que tiene el técnico: lo que se le entregó (entregas no anuladas) menos lo que vendió (ventas no anuladas).
create or replace function public.ventas_stock(p_tecnico uuid, p_producto uuid) returns numeric language sql stable security definer set search_path = public as $$
  select coalesce((select sum(m.quantity) from public.stock_movements m
                    where m.type = 'Entrega' and m.technician_id = p_tecnico and m.product_id = p_producto and m.status <> 'Anulado'), 0)
       - coalesce((select sum(i.quantity) from public.sale_items i join public.sales s on s.id = i.sale_id
                    where s.technician_id = p_tecnico and i.product_id = p_producto and s.status = 'Activa'), 0);
$$;

-- Inventario para vender por técnico y producto: entregado, vendido y stock, con el precio y la comisión vigentes.
-- El técnico solo ve el suyo; administrador, operador y consulta ven el de quien pidan (o el de todos si p_tecnico es null).
create or replace function public.ventas_inventario(p_tecnico uuid default null)
returns table (technician_id uuid, product_id uuid, product_name text, unit_price numeric, commission numeric, price_active boolean, entregado numeric, vendido numeric, stock numeric)
language plpgsql stable security definer set search_path = public as $$
declare v_tec uuid;
begin
  if public.is_active_tecnico() then
    v_tec := public.my_technician();
    if v_tec is null then return; end if;
  elsif public.is_active_user() then
    v_tec := p_tecnico;
  else
    raise exception 'Sin permiso para ver el inventario de ventas.';
  end if;
  return query
    with ent as (
      select m.technician_id as t, m.product_id as p, sum(m.quantity) as q
      from public.stock_movements m
      where m.type = 'Entrega' and m.status <> 'Anulado' and m.technician_id is not null and m.product_id is not null
        and (v_tec is null or m.technician_id = v_tec)
        and m.product_id in (select sp.product_id from public.sales_products sp)
      group by m.technician_id, m.product_id
    ), ven as (
      select s.technician_id as t, i.product_id as p, sum(i.quantity) as q
      from public.sale_items i join public.sales s on s.id = i.sale_id
      where s.status = 'Activa' and (v_tec is null or s.technician_id = v_tec)
      group by s.technician_id, i.product_id
    ), claves as (
      select t, p from ent union select t, p from ven
    )
    select c.t, c.p, pr.name, sp.unit_price, sp.commission, sp.active, coalesce(e.q, 0)::numeric, coalesce(v.q, 0)::numeric, (coalesce(e.q, 0) - coalesce(v.q, 0))::numeric
    from claves c
    join public.products pr on pr.id = c.p
    join public.sales_products sp on sp.product_id = c.p
    left join ent e on e.t = c.t and e.p = c.p
    left join ven v on v.t = c.t and v.p = c.p
    order by pr.name;
end;
$$;

-- ----------------------------------- Registrar venta -----------------------------------
-- p: { technician_id (solo administrador/operador; el técnico siempre vende a su nombre), sale_date (solo administrador/operador; el técnico, hoy),
--      origin ('servicio' | 'particular'), service_no, customer_name, doc_type, doc_number, payment_method ('Efectivo' | 'Transferencia'), notes,
--      items: [ { product_id, quantity } ] }
-- Devuelve la venta creada. Todo ocurre en una sola operación: si algo falla (por ejemplo, no alcanza el stock), no se guarda nada.
create or replace function public.registrar_venta(p jsonb) returns public.sales language plpgsql security definer set search_path = public as $$
declare
  v_es_tecnico boolean := public.is_active_tecnico();
  v_tec uuid;
  v_fecha date;
  v_origen text := coalesce(p->>'origin', 'servicio');
  v_nombre text := nullif(btrim(coalesce(p->>'customer_name', '')), '');
  v_pago text := p->>'payment_method';
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

  insert into public.sales (consecutive, sale_date, technician_id, origin, service_no, customer_name, doc_type, doc_number, payment_method, notes, created_by)
  values ('VEN-' || lpad(nextval('public.sales_seq')::text, 6, '0'), v_fecha, v_tec, v_origen,
          case when v_origen = 'servicio' then nullif(btrim(coalesce(p->>'service_no', '')), '') else null end,
          v_nombre, nullif(btrim(coalesce(p->>'doc_type', '')), ''), nullif(btrim(coalesce(p->>'doc_number', '')), ''), v_pago,
          nullif(btrim(coalesce(p->>'notes', '')), ''), auth.uid())
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

-- ------------------------------------ Anular venta ------------------------------------
-- Solo administrador y operador. La venta no se borra: queda anulada con su motivo y las unidades vuelven al inventario del técnico.
create or replace function public.anular_venta(p_venta uuid, p_motivo text) returns public.sales language plpgsql security definer set search_path = public as $$
declare v_venta public.sales;
begin
  if public.current_role() not in ('admin', 'operador') then raise exception 'Solo el administrador o el operador pueden anular una venta.'; end if;
  if nullif(btrim(coalesce(p_motivo, '')), '') is null then raise exception 'Escribe el motivo de la anulación.'; end if;
  update public.sales set status = 'Anulada', void_reason = btrim(p_motivo), voided_by = auth.uid(), voided_at = now()
  where id = p_venta and status = 'Activa'
  returning * into v_venta;
  if not found then raise exception 'La venta no existe o ya estaba anulada.'; end if;
  return v_venta;
end;
$$;

-- Quién puede llamar las funciones: solo usuarios con sesión (no el acceso anónimo).
revoke all on function public.registrar_venta(jsonb) from public, anon;
revoke all on function public.anular_venta(uuid, text) from public, anon;
revoke all on function public.ventas_inventario(uuid) from public, anon;
revoke all on function public.ventas_stock(uuid, uuid) from public, anon;
grant execute on function public.registrar_venta(jsonb) to authenticated;
grant execute on function public.anular_venta(uuid, text) to authenticated;
grant execute on function public.ventas_inventario(uuid) to authenticated;

notify pgrst, 'reload schema';
