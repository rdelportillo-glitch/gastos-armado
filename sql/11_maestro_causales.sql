-- ============================================================================
-- Maestro de Causales (modulo "Maestros"): lista editable de causales que
-- alimenta la "Causal auditada" del modulo Carga. Las causales no se borran:
-- se anulan (active = false) para no perder el historial.
-- Ejecutar en el SQL Editor de Supabase ANTES de publicar la version de la
-- app que incluye el modulo Maestros.
-- ============================================================================

create table public.causales (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- No permite dos causales con el mismo nombre, sin importar mayusculas.
create unique index causales_name_unique on public.causales (upper(name));

alter table public.causales enable row level security;

-- Cualquier usuario activo puede leerlas (las necesita el modulo Carga);
-- solo un administrador puede crear o editar.
create policy "causales_select_all" on public.causales
  for select using (public.is_active_user());
create policy "causales_insert_admin" on public.causales
  for insert with check (public.current_role() = 'admin');
create policy "causales_update_admin" on public.causales
  for update using (public.current_role() = 'admin');

-- Lista inicial entregada por el usuario.
insert into public.causales (name) values
  ('CONDICION NO OPERABLE'),
  ('NO ARMADO POR NOVEDAD'),
  ('CAL-TRA ARMADO DE MULTIMUEBLE'),
  ('CLIENTE ARMA - LLAMADA'),
  ('AJUSTE DE PRODUCTO'),
  ('DIRECCION ERRADA'),
  ('CLIENTE CANCELA'),
  ('INMUEBLE CERRADO'),
  ('CLIENTE ARMO EL PRODUCTO'),
  ('ARMADO CON NOVEDAD'),
  ('EMPAQUE'),
  ('PRODUCTO NO ARMABLE'),
  ('INSTALACION PIEZA'),
  ('CLIENTE NO RESIDE'),
  ('NO QUISO ARMADO'),
  ('DESARMADO DE MULTIMUEBLE'),
  ('ESPERA PROLONGADA'),
  ('REPARACION MENOR'),
  ('VISITA NO EFECTIVA - FUERZA MAYOR')
on conflict do nothing;
