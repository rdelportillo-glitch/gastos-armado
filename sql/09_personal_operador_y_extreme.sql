-- ============================================================================
-- Personal: permite que operador cree/edite (no active/inactive/retire), y
-- agrega el campo "Usuario Extreme".
-- Ejecutar en el SQL Editor de Supabase ANTES de publicar la version de la
-- app que incluye estos cambios.
-- ============================================================================

-- 1) Columna nueva, opcional, no toca datos existentes.
alter table public.technicians
  add column extreme_user text;

-- 2) RLS: hoy solo el admin puede crear/editar technicians. Se amplia a
-- operador. La restriccion de "operador no puede inactivar/retirar" se
-- aplica en la interfaz (los botones de cambiar estado solo se muestran a
-- admin); a nivel de base de datos, un operador seguira pudiendo hacer
-- UPDATE sobre cualquier columna de technicians (igual de amplio que hoy es
-- para admin), no hay una restriccion por columna a nivel de RLS.
drop policy if exists "technicians_write_admin" on public.technicians;
create policy "technicians_write_admin_operador" on public.technicians
  for insert with check (public.current_role() in ('admin', 'operador'));

drop policy if exists "technicians_update_admin" on public.technicians;
create policy "technicians_update_admin_operador" on public.technicians
  for update using (public.current_role() in ('admin', 'operador'));
