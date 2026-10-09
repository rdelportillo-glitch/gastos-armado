-- ============================================================================
-- Permiso del operador para actualizar servicios (Carga / Asignación)
-- Problema: la política original solo dejaba ACTUALIZAR servicios al administrador
-- ("services_update_admin"), aunque el operador sí podía crearlos. El flujo de Asignación
-- actualiza servicios ya cargados (asignar técnico, finalizar el día, cargar el reporte de
-- Extreme, auditar causales), y al operador le salía:
--   "new row violates row-level security policy (USING expression) for table services".
-- Solución: la actualización queda permitida a administrador y operador. Consultas sigue sin poder escribir.
-- Se puede correr más de una vez sin problema. No modifica datos.
-- ============================================================================

drop policy if exists "services_update_admin" on public.services;
drop policy if exists "services_update_admin_operador" on public.services;
create policy "services_update_admin_operador" on public.services
  for update
  using (public.current_role() in ('admin', 'operador'))
  with check (public.current_role() in ('admin', 'operador'));
