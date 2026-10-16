-- ============================================================================
-- Programación de servicios · Número de servicio
--  El número de servicio (el de Jamar / Extreme, ej. 5263760) lo escribe el usuario y es obligatorio en las solicitudes de
--  "Ruta Critica". Con ese número el servicio entra a Asignación, igual que los de las bases de Jamar. La orden interna
--  (PS-000001) se conserva como consecutivo propio.
--  Para el rol cliente la base de datos exige el número de servicio al crear la solicitud.
-- Se puede correr más de una vez sin problema. No modifica datos existentes.
-- ============================================================================

alter table public.service_orders add column if not exists service_number text;
create index if not exists idx_service_orders_service_number on public.service_orders(service_number);

drop policy if exists "service_orders_insert_cliente" on public.service_orders;
create policy "service_orders_insert_cliente" on public.service_orders for insert
  with check (public.current_role() = 'cliente' and request_type = 'Ruta Critica' and status = 'Programada'
              and nullif(btrim(service_number), '') is not null);
