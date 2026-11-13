-- ============================================================================
-- Quejas por incumplimiento (Reportes → "Quejas por incumplimiento"): las quejas que envia el cliente (Excel semanal, p. ej. "Semana 1-Nov ASC.xlsx"),
-- cruzadas con el cierre de Extreme y el historico de asignacion para saber que tecnico fue el causante y si la queja le aplica o no.
--   - public.quejas_incumplimiento: una fila por caso (numero de caso de Salesforce). Guarda lo que trae el Excel (servicio, texto de la queja, diagnostico, subcausal...)
--     y lo que la persona decida a mano sobre el caso (aplica si/no, causante, tecnico, comentario). El analisis automatico NO se guarda: se calcula al abrir el reporte,
--     con el Extreme y el historico mas recientes.
--   - Volver a subir el mismo Excel (o uno de la semana siguiente que repita casos) no duplica: actualiza lo del Excel y respeta lo decidido a mano.
--   - Guarda el texto de las quejas (puede traer nombres de clientes): solo lo ven administrador, operador y consulta.
--   - Lo lee el administrador, el operador y la consulta; lo escribe el administrador y el operador; solo el administrador puede quitar una queja cargada por error.
-- Solo crea una tabla nueva; no modifica ni borra datos existentes. Se puede correr mas de una vez.
-- ============================================================================

create table if not exists public.quejas_incumplimiento (
  id uuid primary key default gen_random_uuid(),
  caso text not null unique,                 -- numero de caso (Salesforce); evita duplicados al volver a cargar
  fecha date not null,                       -- fecha de la queja (dia de Colombia)
  servicio text,                             -- numero de servicio de armado
  empresa text not null default 'JAMAR',     -- empresa a la que pertenece el servicio (las quejas que llegan son de Jamar)
  informacion_caso text,                     -- "INFORMACION DEL CASO SALESFORCE": lo que dice el cliente
  diagnostico text,                          -- "DIAGNOSTICO DEL TECNICO": analisis de ASC sobre el caso
  pregunta text,
  subcausal text,
  causal_cierre text,                        -- causal con la que se cerro el servicio (CLIENTE CANCELA, VISITA NO EFECTIVA...)
  departamento text,
  proveedor text,
  -- Lo que decide la persona (vacio = vale el analisis automatico)
  aplica_manual text check (aplica_manual in ('si', 'no')),
  causante_manual text,                      -- Tecnico / Asignacion / Cliente / Fuerza mayor / Otro
  technician_manual_id uuid references public.technicians(id),
  comentario text,
  revisado_por uuid references public.profiles(id),
  revisado_at timestamptz,
  source_file text,
  loaded_by uuid references public.profiles(id),
  loaded_at timestamptz not null default now()
);
create index if not exists idx_quejas_fecha on public.quejas_incumplimiento(fecha);
create index if not exists idx_quejas_servicio on public.quejas_incumplimiento(servicio);

alter table public.quejas_incumplimiento enable row level security;
drop policy if exists "quejas_incumplimiento_select" on public.quejas_incumplimiento;
drop policy if exists "quejas_incumplimiento_insert" on public.quejas_incumplimiento;
drop policy if exists "quejas_incumplimiento_update" on public.quejas_incumplimiento;
drop policy if exists "quejas_incumplimiento_delete" on public.quejas_incumplimiento;
create policy "quejas_incumplimiento_select" on public.quejas_incumplimiento for select using (public.current_role() in ('admin', 'operador', 'consulta'));
create policy "quejas_incumplimiento_insert" on public.quejas_incumplimiento for insert with check (public.current_role() in ('admin', 'operador'));
-- El UPDATE lo necesitan el upsert (volver a cargar el Excel) y la decision manual de cada caso.
create policy "quejas_incumplimiento_update" on public.quejas_incumplimiento for update
  using (public.current_role() in ('admin', 'operador')) with check (public.current_role() in ('admin', 'operador'));
create policy "quejas_incumplimiento_delete" on public.quejas_incumplimiento for delete using (public.current_role() = 'admin');

notify pgrst, 'reload schema';
