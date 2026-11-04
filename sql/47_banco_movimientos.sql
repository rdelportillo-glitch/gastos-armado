-- ============================================================================
-- 47 · Banco: movimientos del extracto (Davivienda) y saldo
--
--  1) bank_movements: cada movimiento del archivo del banco (fecha de sistema, fecha de causación = fecha de sistema + 1 día, descripción, valor, tipo).
--     tipo: 'Gasto' (costo financiero que se lleva a Gastos), 'Pago' (pago o transferencia que ya está registrada como gasto de cada persona: solo mueve el saldo),
--           'Abono' (dinero que entra), 'Otro' (débito sin clasificar: solo mueve el saldo).
--     dedupe_key evita cargar dos veces el mismo movimiento (varios archivos se traslapan).
--  2) expenses.bank_movement_id: el gasto creado a partir de un movimiento del banco.
--
-- El saldo de referencia (el saldo del banco en una fecha) y las reglas de clasificación se guardan en assignment_settings (clave "banco_config"), que ya existe.
-- Administrador y operador cargan y reclasifican; consulta solo ve. No hay política de borrado: los movimientos no se eliminan.
-- Se puede correr más de una vez. No modifica datos existentes.
-- ============================================================================

create table if not exists public.bank_movements (
  id uuid primary key default gen_random_uuid(),
  dedupe_key text not null unique,
  fecha_sistema date not null,
  fecha date not null,
  documento text,
  descripcion text not null,
  transaccion text not null check (transaccion in ('Nota Débito', 'Nota Crédito')),
  oficina text,
  valor numeric not null check (valor >= 0),
  tipo text not null check (tipo in ('Gasto', 'Pago', 'Abono', 'Otro')),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists idx_bank_movements_fecha_sistema on public.bank_movements(fecha_sistema);
create index if not exists idx_bank_movements_fecha on public.bank_movements(fecha);

alter table public.bank_movements enable row level security;
drop policy if exists "bank_movements_select" on public.bank_movements;
drop policy if exists "bank_movements_insert" on public.bank_movements;
drop policy if exists "bank_movements_update" on public.bank_movements;
create policy "bank_movements_select" on public.bank_movements for select using (public.is_active_user());
create policy "bank_movements_insert" on public.bank_movements for insert with check (public.current_role() in ('admin', 'operador'));
create policy "bank_movements_update" on public.bank_movements for update
  using (public.current_role() in ('admin', 'operador')) with check (public.current_role() in ('admin', 'operador'));

alter table public.expenses add column if not exists bank_movement_id uuid references public.bank_movements(id);
create index if not exists idx_expenses_bank_movement on public.expenses(bank_movement_id);

notify pgrst, 'reload schema';
