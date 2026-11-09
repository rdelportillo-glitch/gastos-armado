-- ============================================================================
-- Cierre en línea (Extreme): histórico de cierres para el reporte "Cierre en línea".
--   - public.cierre_extreme: una fila por producto (servicio-código) que trae el Reporte detallado de encuestas de precierre de Extreme, con la hora fin de trabajo,
--     el técnico, su coordinador, el departamento, el municipio, el estado y la causal. Se llena solo al cargar el reporte de Extreme en Carga
--     (y, opcionalmente, con el Excel histórico del tablero de Cierre en Línea).
--   - No guarda direcciones, teléfonos, cédulas ni nombres de clientes.
--   - Se puede cargar el mismo reporte más de una vez: la fila es única por (clave, unidad), así que no se duplica.
--   - Lo lee el administrador, el operador y la consulta; lo escribe el administrador y el operador. No hay DELETE: el histórico no se borra.
-- Solo crea una tabla nueva; no modifica ni borra datos existentes. Se puede correr más de una vez.
-- ============================================================================

create table if not exists public.cierre_extreme (
  id uuid primary key default gen_random_uuid(),
  clave text not null,                    -- servicio-código como lo trae Extreme (ej. 5265232-7042414001)
  unidad int not null default 1,          -- si la misma clave viene repetida en el reporte (varias unidades del mismo producto)
  servicio text not null,
  codigo text,
  closed_day date,                        -- día de la hora fin de trabajo (si no la trae, el día de creación de la encuesta)
  closed_hour smallint check (closed_hour between 0 and 23),  -- hora (0 a 23) de cierre; vacía si el reporte no trae hora fin de trabajo
  closed_at timestamp,                    -- hora local de Colombia (sin zona horaria), si el reporte trae los minutos
  scheduled_day date,                     -- día programado del servicio, si se conoce
  technician_id uuid references public.technicians(id),
  tecnico text,
  coordinador text,
  departamento text,
  municipio text,
  estado text,                            -- Realizado / No realizado
  causal text,
  origen text not null default 'encuestas',  -- encuestas (reporte de Extreme cargado en Carga) | excel-dash (Excel histórico del tablero)
  source_file text,
  loaded_by uuid references public.profiles(id),
  loaded_at timestamptz not null default now(),
  unique (clave, unidad)
);
create index if not exists idx_cierre_extreme_day on public.cierre_extreme(closed_day);
create index if not exists idx_cierre_extreme_tecnico on public.cierre_extreme(technician_id, closed_day);

alter table public.cierre_extreme enable row level security;
drop policy if exists "cierre_extreme_select" on public.cierre_extreme;
drop policy if exists "cierre_extreme_insert" on public.cierre_extreme;
drop policy if exists "cierre_extreme_update" on public.cierre_extreme;
create policy "cierre_extreme_select" on public.cierre_extreme for select using (public.current_role() in ('admin', 'operador', 'consulta'));
create policy "cierre_extreme_insert" on public.cierre_extreme for insert with check (public.current_role() in ('admin', 'operador'));
-- El UPDATE lo necesita el upsert (volver a cargar el mismo reporte actualiza las filas en vez de duplicarlas).
create policy "cierre_extreme_update" on public.cierre_extreme for update
  using (public.current_role() in ('admin', 'operador')) with check (public.current_role() in ('admin', 'operador'));

notify pgrst, 'reload schema';
