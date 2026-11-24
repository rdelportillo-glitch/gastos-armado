-- ============================================================================
-- 78 · "Mi desempeño" del técnico: resultados del reporte Técnico integral publicados por técnico y mes
--
--  - public.tecnico_desempeno: una fila por técnico y mes (periodo AAAA-MM) con lo que el administrador u operador PUBLICA desde el reporte Técnico integral:
--      puntaje general, posición en su departamento y a nivel nacional (solo el número: "#3 de 12"), sus 7 indicadores frente a la meta (cada uno con su posición)
--      y el detalle: quejas, cierres en línea fuera de horario, garantías y monitoreos por debajo del objetivo (sin nombres, teléfonos ni direcciones de clientes).
--  - Cada técnico lee SOLO su fila (su ficha de Personal enlazada a su usuario); no ve nada de los demás técnicos. Lo exige la base de datos, no solo la pantalla.
--  - Escriben (publican) el administrador y el operador; el administrador, el operador y la consulta pueden leerlo todo. No hay DELETE: lo publicado se reemplaza al volver a publicar el mismo mes.
-- Solo crea una tabla nueva; no modifica ni borra datos existentes. Se puede correr más de una vez. Necesita las funciones is_active_tecnico() y my_technician() (sql/27 y sql/45).
-- ============================================================================

create table if not exists public.tecnico_desempeno (
  technician_id uuid not null references public.technicians(id),
  periodo text not null check (periodo ~ '^\d{4}-\d{2}$'),     -- mes publicado, AAAA-MM
  desde date not null,                                           -- rango que cubre lo publicado (del 1 del mes hasta el día de la publicación)
  hasta date not null,
  departamento text,
  puntaje numeric,
  rank_depto int, total_depto int,
  rank_nacional int, total_nacional int,
  indicadores jsonb not null default '[]'::jsonb,                -- los 7 indicadores: valor, meta, semáforo, puntaje, texto y posición de cada uno
  detalle jsonb not null default '{}'::jsonb,                    -- quejas, cierres fuera de horario, garantías y monitoreos bajo el objetivo
  metas jsonb not null default '{}'::jsonb,                      -- las metas con las que se calculó
  publicado_por uuid references public.profiles(id),
  publicado_at timestamptz not null default now(),
  primary key (technician_id, periodo)
);
create index if not exists idx_tecnico_desempeno_periodo on public.tecnico_desempeno(periodo);

alter table public.tecnico_desempeno enable row level security;
drop policy if exists "tecnico_desempeno_select" on public.tecnico_desempeno;
drop policy if exists "tecnico_desempeno_insert" on public.tecnico_desempeno;
drop policy if exists "tecnico_desempeno_update" on public.tecnico_desempeno;
create policy "tecnico_desempeno_select" on public.tecnico_desempeno for select
  using (public.current_role() in ('admin', 'operador', 'consulta')
         or (public.is_active_tecnico() and public.my_technician() is not null and technician_id = public.my_technician()));
create policy "tecnico_desempeno_insert" on public.tecnico_desempeno for insert with check (public.current_role() in ('admin', 'operador'));
create policy "tecnico_desempeno_update" on public.tecnico_desempeno for update
  using (public.current_role() in ('admin', 'operador')) with check (public.current_role() in ('admin', 'operador'));
-- Sin política de DELETE.

notify pgrst, 'reload schema';
