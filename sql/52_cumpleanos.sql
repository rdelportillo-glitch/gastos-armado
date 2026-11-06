-- ============================================================================
-- 52 · Personal: fecha de nacimiento · Pagos: bono de cumpleaños
--
--  1) technicians.birth_date: fecha de nacimiento de cada persona de Personal (para saber quién cumple años y calcular el bono).
--  2) viatico_pagos acepta el tipo 'Cumpleaños' (el listado de Pagos marca como pagado el bono igual que los viáticos y el pico y placa).
--
-- La matriz de valores (perfil × antigüedad y cargos administrativos) se guarda en la configuración de Pagos (assignment_settings), sin tablas nuevas.
-- No borra ni modifica datos. Se puede correr más de una vez.
-- ============================================================================

alter table public.technicians add column if not exists birth_date date;

alter table public.viatico_pagos drop constraint if exists viatico_pagos_kind_check;
alter table public.viatico_pagos add constraint viatico_pagos_kind_check check (kind in ('Viático', 'Pico y placa', 'Cumpleaños'));

notify pgrst, 'reload schema';
