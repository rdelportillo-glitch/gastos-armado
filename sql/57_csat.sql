-- ============================================================================
-- CSAT del cliente (informe mensual en PowerPoint "INFORME CSAT ARMADO"): satisfacción de los clientes por técnico y por departamento.
--   - public.csat_resumen:      CSAT del mes (general del cliente y de nuestra operación "asc"): satisfechos, insatisfechos, total, % y meta.
--   - public.csat_departamento: cifras oficiales por departamento y mes (las de la tabla del PowerPoint).
--   - public.csat_tecnico:      una fila por técnico, departamento (del PowerPoint) y mes: % de CSAT y motivo de insatisfacción. technician_id enlaza con Personal.
--   - public.csat_alias:        memoria de la homologación: cómo se llama el técnico en el PowerPoint y a qué ficha de Personal corresponde (vacío = no tiene ficha).
--   - No guarda datos de clientes: solo nombres de técnicos, porcentajes y motivos genéricos ("Producto mal armado").
--   - Volver a cargar el mismo PowerPoint (o el del mes siguiente, que repite meses) no duplica: actualiza las filas por mes.
--   - Lo lee el administrador, el operador y la consulta; lo escribe el administrador y el operador. No hay DELETE: el histórico no se borra.
-- Solo crea tablas nuevas; no modifica ni borra datos existentes. Se puede correr más de una vez.
-- ============================================================================

create table if not exists public.csat_resumen (
  id uuid primary key default gen_random_uuid(),
  mes date not null,                         -- primer día del mes
  ambito text not null check (ambito in ('general', 'asc')),   -- general = todo el cliente · asc = nuestra operación (Asc - Biver)
  satisfechos int,                           -- vacío en los meses que solo traen el % de la tendencia
  insatisfechos int,
  total int,
  csat numeric(5, 2),
  meta numeric(5, 2),
  source_file text,
  loaded_by uuid references public.profiles(id),
  loaded_at timestamptz not null default now(),
  unique (mes, ambito)
);

create table if not exists public.csat_departamento (
  id uuid primary key default gen_random_uuid(),
  mes date not null,
  departamento text not null,
  satisfechos int,
  insatisfechos int,
  csat numeric(5, 2),
  source_file text,
  loaded_by uuid references public.profiles(id),
  loaded_at timestamptz not null default now(),
  unique (mes, departamento)
);

create table if not exists public.csat_tecnico (
  id uuid primary key default gen_random_uuid(),
  mes date not null,
  tecnico_ppt text not null,                 -- nombre como viene en el PowerPoint
  nombre_plano text not null,                -- el mismo nombre en mayúsculas y sin tildes (clave de la homologación)
  departamento text not null,                -- departamento en que sale en el PowerPoint
  technician_id uuid references public.technicians(id),
  csat numeric(5, 2),
  motivos text,                              -- motivos de insatisfacción (vacío si no hubo)
  source_file text,
  loaded_by uuid references public.profiles(id),
  loaded_at timestamptz not null default now(),
  unique (mes, nombre_plano, departamento)
);
create index if not exists idx_csat_tecnico_mes on public.csat_tecnico(mes);
create index if not exists idx_csat_tecnico_tec on public.csat_tecnico(technician_id, mes);

create table if not exists public.csat_alias (
  nombre_plano text primary key,
  technician_id uuid references public.technicians(id),   -- vacío = se decidió que ese nombre no tiene ficha en Personal
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['csat_resumen', 'csat_departamento', 'csat_tecnico', 'csat_alias'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "%s_select" on public.%I', t, t);
    execute format('drop policy if exists "%s_insert" on public.%I', t, t);
    execute format('drop policy if exists "%s_update" on public.%I', t, t);
    execute format('create policy "%s_select" on public.%I for select using (public.current_role() in (''admin'', ''operador'', ''consulta''))', t, t);
    execute format('create policy "%s_insert" on public.%I for insert with check (public.current_role() in (''admin'', ''operador''))', t, t);
    -- El UPDATE lo necesita el upsert (volver a cargar un mes actualiza las filas en vez de duplicarlas).
    execute format('create policy "%s_update" on public.%I for update using (public.current_role() in (''admin'', ''operador'')) with check (public.current_role() in (''admin'', ''operador''))', t, t);
  end loop;
end $$;

notify pgrst, 'reload schema';
