-- ============================================================================
-- Gestión preventiva: llamar a los clientes para confirmar la cita del día siguiente.
--  1) preventive_calls: una fila por llamada/gestión (servicio, fecha del servicio, resultado, nota, nueva fecha si se reprograma, técnico asignado en ese momento).
--     Resultados: Confirmado, No contesta, Cancela, Cliente arma, Reprogramado, Revertido (deshacer una cancelación). Las filas no se editan ni se borran.
--     alerta = true cuando el resultado retira o devuelve un servicio de la asignación (lo pone la app): genera el aviso para quienes asignan.
--  2) preventive_alert_reads: qué usuario ya leyó cada aviso.
--  3) Tres causales nuevas en el maestro (Maestros → Causales) con gestión "Cancelado", para identificar lo que sale de la gestión preventiva:
--     PREVENTIVA - CLIENTE CANCELA, PREVENTIVA - CLIENTE ARMA, PREVENTIVA - REPROGRAMADO. Solo se agregan si no existen (y si ya existían sin gestión, se les pone Cancelado); no se toca ninguna otra causal.
-- Permisos: administrador y operador registran; consulta solo ve; cada usuario marca como leídos sus propios avisos. No hay borrado.
-- Se puede correr más de una vez. No modifica datos existentes.
-- ============================================================================

create table if not exists public.preventive_calls (
  id uuid primary key default gen_random_uuid(),
  servicio text not null,
  fecha_servicio date not null,
  resultado text not null check (resultado in ('Confirmado', 'No contesta', 'Cancela', 'Cliente arma', 'Reprogramado', 'Revertido')),
  causal text,
  nueva_fecha date,
  nota text,
  cliente text,
  telefono text,
  technician_id uuid references public.technicians(id),
  technician_name text,
  departamento text,
  ciudad text,
  productos text,
  alerta boolean not null default false,
  created_by uuid references public.profiles(id) default auth.uid(),
  created_by_name text,
  created_at timestamptz not null default now()
);
create index if not exists idx_preventive_calls_fecha on public.preventive_calls(fecha_servicio);
create index if not exists idx_preventive_calls_servicio on public.preventive_calls(servicio, fecha_servicio);
create index if not exists idx_preventive_calls_alerta on public.preventive_calls(alerta, created_at);

create table if not exists public.preventive_alert_reads (
  call_id uuid not null references public.preventive_calls(id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles(id),
  read_at timestamptz not null default now(),
  primary key (call_id, user_id)
);

alter table public.preventive_calls enable row level security;
alter table public.preventive_alert_reads enable row level security;

drop policy if exists "preventive_calls_select" on public.preventive_calls;
drop policy if exists "preventive_calls_insert" on public.preventive_calls;
create policy "preventive_calls_select" on public.preventive_calls for select
  using (public.is_active_user() and public.current_role() in ('admin', 'operador', 'consulta'));
create policy "preventive_calls_insert" on public.preventive_calls for insert
  with check (public.is_active_user() and public.current_role() in ('admin', 'operador'));
-- Sin políticas de UPDATE ni DELETE: la gestión queda como historial.

drop policy if exists "preventive_reads_select" on public.preventive_alert_reads;
drop policy if exists "preventive_reads_insert" on public.preventive_alert_reads;
create policy "preventive_reads_select" on public.preventive_alert_reads for select
  using (public.is_active_user() and user_id = auth.uid());
create policy "preventive_reads_insert" on public.preventive_alert_reads for insert
  with check (public.is_active_user() and public.current_role() in ('admin', 'operador') and user_id = auth.uid());

-- Causales de la gestión preventiva (gestión "Cancelado": el servicio sale de la asignación y queda cancelado en Carga).
insert into public.causales (name, active, gestion)
select v.nombre, true, 'Cancelado'
from (values ('PREVENTIVA - CLIENTE CANCELA'), ('PREVENTIVA - CLIENTE ARMA'), ('PREVENTIVA - REPROGRAMADO')) as v(nombre)
where not exists (select 1 from public.causales c where upper(btrim(c.name)) = v.nombre);
-- Si alguna de esas causales ya existía sin gestión elegida, se le pone "Cancelado" (no se cambia una gestión ya elegida).
update public.causales set gestion = 'Cancelado'
where gestion is null and upper(btrim(name)) in ('PREVENTIVA - CLIENTE CANCELA', 'PREVENTIVA - CLIENTE ARMA', 'PREVENTIVA - REPROGRAMADO');
