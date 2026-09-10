-- ============================================================================
-- SEED OPCIONAL: gastos, servicios realizados y movimientos de inventario
-- ============================================================================
-- Estos datos necesitan un "responsable" (responsible_user_id) que apunte a un
-- usuario real de auth.users / public.profiles. Como esos usuarios se crean
-- DESPUÉS de correr el esquema (ver README, paso "Crear usuarios"), este
-- script se ejecuta al final, reemplazando el correo del administrador.
--
-- 1) Crea al menos un usuario admin desde el Dashboard de Supabase
--    (Authentication → Add user), por ejemplo admin@tuempresa.com
-- 2) Reemplaza 'admin@tuempresa.com' abajo por ese correo real
-- 3) Ejecuta este script en el SQL Editor
-- ============================================================================

do $$
declare
  v_user_id uuid;
  v_tech_id uuid;
  v_sub_id uuid;
  v_cat_id uuid;
  v_tipo text;
  v_qty numeric;
  v_unit numeric;
  v_date date;
  v_vinipel_sub_id uuid;
  i int;
begin
  select id into v_user_id from auth.users where email = 'admin@tuempresa.com' limit 1;

  if v_user_id is null then
    raise notice 'No se encontró el usuario admin@tuempresa.com. Ajusta el correo en este script y vuelve a ejecutarlo.';
    return;
  end if;

  -- 1) Gastos generales de ejemplo (excluye Vinipel, que ahora se maneja por inventario)
  for i in 1..45 loop
    select id into v_tech_id from public.technicians where status = 'Activo' order by random() limit 1;
    select id, category_id, tipo into v_sub_id, v_cat_id, v_tipo
      from public.subcategories where lower(name) <> 'vinipel' order by random() limit 1;
    v_date := current_date - (floor(random()*180))::int;

    if v_tipo = 'activo' then
      v_qty := 1; v_unit := 150000 + floor(random()*600000);
    elsif v_tipo = 'gasto' then
      v_qty := 1 + floor(random()*4); v_unit := 15000 + floor(random()*80000);
    else
      v_qty := 1 + floor(random()*4); v_unit := 5000 + floor(random()*25000);
    end if;

    insert into public.expenses
      (date, technician_id, category_id, subcategory_id, product_id, concept_manual, quantity, unit_value, observation, responsible_user_id, status)
    values
      (v_date, v_tech_id, v_cat_id, v_sub_id, null, 'Movimiento de ejemplo', v_qty, v_unit, '', v_user_id, 'Activo');
  end loop;

  -- 2) Servicios realizados de ejemplo (para poder calcular tasas de uso)
  for i in 1..40 loop
    select id into v_tech_id from public.technicians where status = 'Activo' order by random() limit 1;
    v_date := current_date - (floor(random()*180))::int;
    insert into public.services (date, technician_id, service_type, quantity, observation, responsible_user_id)
    values (
      v_date, v_tech_id,
      (array['Instalación','Mantenimiento','Reparación','Reconexión'])[1 + floor(random()*4)],
      1 + floor(random()*4), '', v_user_id
    );
  end loop;

  -- 3) Inventario de vinipel: una compra grande y varias entregas a técnicos
  select id into v_vinipel_sub_id from public.subcategories where lower(name) = 'vinipel' limit 1;

  if v_vinipel_sub_id is not null then
    insert into public.stock_movements (type, date, subcategory_id, quantity, unit_cost, supplier, observation, responsible_user_id)
    values ('Compra', current_date - 60, v_vinipel_sub_id, 200, 18000, 'Proveedor de ejemplo', 'Compra inicial de inventario', v_user_id);

    -- también queda como gasto general de la empresa (sin técnico)
    insert into public.expenses (date, technician_id, category_id, subcategory_id, concept_manual, quantity, unit_value, observation, responsible_user_id, status)
    select current_date - 60, null, category_id, id, 'Compra de stock — Proveedor de ejemplo', 200, 18000, 'Compra inicial de inventario', v_user_id, 'Activo'
    from public.subcategories where id = v_vinipel_sub_id;

    for i in 1..25 loop
      select id into v_tech_id from public.technicians where status = 'Activo' order by random() limit 1;
      v_date := current_date - (floor(random()*55))::int;
      insert into public.stock_movements (type, date, subcategory_id, quantity, technician_id, observation, responsible_user_id)
      values ('Entrega', v_date, v_vinipel_sub_id, 1 + floor(random()*3), v_tech_id, '', v_user_id);
    end loop;
  end if;

  insert into public.audit_log (user_id, action, record, old_value, new_value)
  values (v_user_id, 'Carga de datos de ejemplo', 'expenses/services/stock_movements', '-', 'Datos de ejemplo insertados');

  raise notice 'Datos de ejemplo insertados: gastos, servicios e inventario de vinipel.';
end $$;
