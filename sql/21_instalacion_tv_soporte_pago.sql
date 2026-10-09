-- ============================================================================
-- Instalación de TV · Soporte de pago
-- Permite adjuntar a cada instalación el soporte del pago: comprobante de la transferencia o foto
-- del recibo firmado por el cliente (efectivo).
--  1) Bucket privado "tv-soportes" en Storage (máx. 5 MB; imágenes y PDF).
--  2) Políticas: cualquier usuario activo puede ver; solo administrador y operador pueden subir.
--     No hay política de borrado ni de edición: los soportes no se eliminan.
--  3) Columnas en tv_offers con el archivo vigente (el último subido).
-- Se puede correr más de una vez sin problema. No modifica datos existentes.
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('tv-soportes', 'tv-soportes', false, 5242880,
        array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'])
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types, public = false;

drop policy if exists "tv_soportes_select" on storage.objects;
drop policy if exists "tv_soportes_insert" on storage.objects;
create policy "tv_soportes_select" on storage.objects for select
  using (bucket_id = 'tv-soportes' and public.is_active_user());
create policy "tv_soportes_insert" on storage.objects for insert
  with check (bucket_id = 'tv-soportes' and public.current_role() in ('admin', 'operador'));

alter table public.tv_offers add column if not exists soporte_pago_path text;
alter table public.tv_offers add column if not exists soporte_pago_nombre text;
alter table public.tv_offers add column if not exists soporte_pago_at timestamptz;
alter table public.tv_offers add column if not exists soporte_pago_by uuid references public.profiles(id);
