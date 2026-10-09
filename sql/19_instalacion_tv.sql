-- ============================================================================
-- Instalación de TV (servicio adicional): agenda de llamadas y gestión de ofertas.
--  1) tv_offers: una oferta por servicio (cliente) que tiene panel de TV o centro de
--     entretenimiento. Guarda el estado de la gestión, los datos de la instalación
--     (pulgadas, valor, acciones adicionales, forma de pago) y, para la fase de ejecución,
--     el resultado en campo y el cobro.
--  2) tv_calls: bitácora de cada llamada (no se edita ni se borra).
-- Tarifas, valores de las acciones adicionales, minutos de la instalación, guion y objeciones
-- se guardan en assignment_settings (clave "tv_config"), que ya existe.
-- Se puede correr más de una vez sin problema. No modifica datos existentes.
-- ============================================================================

create table if not exists public.tv_offers (
  id uuid primary key default gen_random_uuid(),
  servicio text not null unique,
  fecha_prog date,
  cliente text,
  telefonos text,
  direccion text,
  ciudad text,
  departamento text,
  region int,
  productos text,
  estado text not null default 'Por llamar'
    check (estado in ('Por llamar', 'Rellamar', 'Aceptó', 'Indeciso', 'No aceptó', 'No contactado')),
  pulgadas int,
  valor_base numeric,
  desmonte_tv boolean not null default false,
  organizar_cables boolean not null default false,
  mover_punto boolean not null default false,
  valor_adicionales numeric not null default 0,
  valor_total numeric,
  tiempo_min int,
  forma_pago text check (forma_pago in ('Efectivo', 'Transferencia')),
  comprobante_ok boolean not null default false,
  objecion text,
  observacion text,
  proxima_llamada timestamptz,
  intentos int not null default 0,
  primera_llamada_at timestamptz,
  gestor_id uuid references public.profiles(id),
  -- ejecución en campo (la registra el operador con lo que reporta el técnico)
  ejecucion text check (ejecucion in ('Pendiente', 'Realizada', 'No realizada', 'Reprogramada')),
  tecnico_id uuid references public.technicians(id),
  convertido_en_casa boolean,
  valor_cobrado numeric,
  cobro_metodo text check (cobro_metodo in ('Efectivo', 'Transferencia')),
  reclamo text,
  ejecucion_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_tv_offers_fecha on public.tv_offers(fecha_prog);
create index if not exists idx_tv_offers_estado on public.tv_offers(estado);
create index if not exists idx_tv_offers_proxima on public.tv_offers(proxima_llamada);

create table if not exists public.tv_calls (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null references public.tv_offers(id),
  servicio text not null,
  called_at timestamptz not null default now(),
  gestor_id uuid references public.profiles(id),
  telefono text,
  resultado text not null check (resultado in ('No contesta', 'Ocupado', 'Buzón', 'Número errado', 'Contactado')),
  decision text check (decision in ('Aceptó', 'Indeciso', 'No aceptó')),
  objecion text,
  nota text,
  proxima_llamada timestamptz
);
create index if not exists idx_tv_calls_offer on public.tv_calls(offer_id);
create index if not exists idx_tv_calls_fecha on public.tv_calls(called_at);

alter table public.tv_offers enable row level security;
alter table public.tv_calls enable row level security;

drop policy if exists "tv_offers_select" on public.tv_offers;
drop policy if exists "tv_offers_insert" on public.tv_offers;
drop policy if exists "tv_offers_update" on public.tv_offers;
create policy "tv_offers_select" on public.tv_offers for select using (public.is_active_user());
create policy "tv_offers_insert" on public.tv_offers for insert with check (public.current_role() in ('admin', 'operador'));
create policy "tv_offers_update" on public.tv_offers for update
  using (public.current_role() in ('admin', 'operador')) with check (public.current_role() in ('admin', 'operador'));
-- Sin política de DELETE: las ofertas no se borran.

drop policy if exists "tv_calls_select" on public.tv_calls;
drop policy if exists "tv_calls_insert" on public.tv_calls;
create policy "tv_calls_select" on public.tv_calls for select using (public.is_active_user());
create policy "tv_calls_insert" on public.tv_calls for insert with check (public.current_role() in ('admin', 'operador'));
-- La bitácora de llamadas es solo de inserción: no se edita ni se borra.
