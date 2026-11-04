-- ============================================================================
-- Pago de viáticos y plantilla de pago al banco.
--   1) technicians: datos bancarios para la plantilla de pago (tipo de identificación, banco destino, nombre y apellido del titular). El número de identificación
--      es "document" y el número y el tipo de cuenta ya existían (bank_account, bank_account_type).
--   2) expenses: bank_sent_at / bank_sent_by marcan los gastos ya enviados al banco en una plantilla, para no pagarlos dos veces.
--   3) viatico_pagos: pagos de viático y de pico y placa marcados como pagados (uno por día, persona y tipo); al marcarlos se crea el gasto automáticamente.
-- Solo agrega columnas opcionales y una tabla nueva; no modifica ni borra datos existentes. Se puede correr más de una vez.
-- ============================================================================

alter table public.technicians add column if not exists id_type text;
alter table public.technicians add column if not exists bank_code text;
alter table public.technicians add column if not exists holder_first_name text;
alter table public.technicians add column if not exists holder_last_name text;

alter table public.expenses add column if not exists bank_sent_at timestamptz;
alter table public.expenses add column if not exists bank_sent_by uuid references public.profiles(id);

create table if not exists public.viatico_pagos (
  id uuid primary key default gen_random_uuid(),
  day date not null,
  technician_id uuid not null references public.technicians(id),
  kind text not null check (kind in ('Viático', 'Pico y placa')),
  amount numeric not null check (amount >= 0),
  detail text,
  expense_id uuid,
  status text not null default 'Pagado' check (status in ('Pagado', 'Anulado')),
  paid_by uuid references public.profiles(id),
  paid_at timestamptz not null default now(),
  unique (day, technician_id, kind)
);
create index if not exists idx_viatico_pagos_day on public.viatico_pagos(day);

alter table public.viatico_pagos enable row level security;
drop policy if exists "viatico_pagos_select_all" on public.viatico_pagos;
drop policy if exists "viatico_pagos_insert_admin_operador" on public.viatico_pagos;
drop policy if exists "viatico_pagos_update_admin_operador" on public.viatico_pagos;
create policy "viatico_pagos_select_all" on public.viatico_pagos for select using (public.is_active_user());
create policy "viatico_pagos_insert_admin_operador" on public.viatico_pagos for insert with check (public.current_role() in ('admin', 'operador'));
create policy "viatico_pagos_update_admin_operador" on public.viatico_pagos for update
  using (public.current_role() in ('admin', 'operador')) with check (public.current_role() in ('admin', 'operador'));
-- No hay DELETE: un pago se anula (status = 'Anulado') y se puede volver a marcar.

notify pgrst, 'reload schema';
