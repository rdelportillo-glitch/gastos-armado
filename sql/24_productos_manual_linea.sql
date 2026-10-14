-- ============================================================================
-- Maestros · Productos de armado: manual/instructivo adjunto + línea y sublínea
--  1) assembly_products.line / subline: línea y sublínea de cada producto (para columnas y filtros).
--     Se rellenan una sola vez con lo que ya traen los servicios cargados (código → línea/sublínea),
--     con la misma ortografía de la tabla de Complejidad cuando existe. Solo completa donde está vacío.
--  2) assembly_products.manual_*: el manual o instructivo vigente del producto (el último subido).
--  3) Bucket privado "producto-manuales" en Storage (máx. 20 MB; PDF, imágenes, Word, PowerPoint,
--     Excel y MP4). Cualquier usuario activo puede ver; solo el administrador puede subir.
--     No hay política de borrado ni de edición: los archivos reemplazados quedan guardados.
-- Se puede correr más de una vez sin problema. No borra ni cambia datos existentes.
-- ============================================================================

alter table public.assembly_products add column if not exists line text;
alter table public.assembly_products add column if not exists subline text;
alter table public.assembly_products add column if not exists manual_path text;
alter table public.assembly_products add column if not exists manual_name text;
alter table public.assembly_products add column if not exists manual_at timestamptz;
alter table public.assembly_products add column if not exists manual_by uuid references public.profiles(id);
create index if not exists idx_assembly_products_line on public.assembly_products(line, subline);

-- Relleno inicial de línea y sublínea desde los servicios ya cargados (solo donde está vacío).
with fuente as (
  select distinct on (s.asig->>'codigo')
         s.asig->>'codigo' as code,
         coalesce(c.line, s.asig->>'linea') as line,
         coalesce(c.subline, s.asig->>'sublinea') as subline
  from public.services s
  left join public.assembly_complexity c
    on upper(c.line) = upper(s.asig->>'linea') and upper(c.subline) = upper(s.asig->>'sublinea')
  where s.asig is not null
    and coalesce(s.asig->>'codigo', '') <> ''
    and coalesce(s.asig->>'linea', '') <> ''
  order by s.asig->>'codigo', (c.line is null)
)
update public.assembly_products p
   set line = f.line, subline = f.subline
  from fuente f
 where p.code = f.code and p.line is null;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('producto-manuales', 'producto-manuales', false, 20971520,
        array['application/pdf', 'image/jpeg', 'image/png', 'image/webp',
              'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
              'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
              'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              'video/mp4'])
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types, public = false;

drop policy if exists "producto_manuales_select" on storage.objects;
drop policy if exists "producto_manuales_insert" on storage.objects;
create policy "producto_manuales_select" on storage.objects for select
  using (bucket_id = 'producto-manuales' and public.is_active_user());
create policy "producto_manuales_insert" on storage.objects for insert
  with check (bucket_id = 'producto-manuales' and public.current_role() = 'admin');
