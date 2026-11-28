-- ============================================================================
-- 80 · Instalación de TV: auditoría de las instalaciones NO REALIZADAS
-- Se llama al cliente para confirmar si el técnico hizo la instalación por aparte: resultado de la llamada, si aplica descuento, valor y comentarios.
-- Va en una tabla aparte de tv_offers para que el TÉCNICO NO PUEDA LEERLA (él sí lee sus instalaciones).
--  · Leen: administrador, operador y consulta. Escriben: administrador y operador. Nadie borra.
-- No modifica datos. Se puede correr más de una vez. Requiere sql/19 y sql/27 (is_active_user excluye técnico y cliente).
-- ============================================================================

create table if not exists public.tv_auditorias (
  offer_id uuid primary key references public.tv_offers(id),
  servicio text not null,
  resultado text not null check (resultado in ('Lo realizó por aparte', 'No lo realizó', 'No contesta')),
  aplica_descuento boolean not null default false,
  valor numeric check (valor is null or valor >= 0),
  comentarios text,
  auditado_por uuid references public.profiles(id),
  auditado_por_nombre text,
  auditado_at timestamptz not null default now(),
  -- si aplica descuento, el valor es obligatorio
  check (not aplica_descuento or coalesce(valor, 0) > 0)
);

create or replace function public.tv_auditorias_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null then
    new.auditado_por := auth.uid();
    new.auditado_por_nombre := (select name from public.profiles where id = auth.uid());
  end if;
  new.auditado_at := now();
  return new;
end $$;
drop trigger if exists trg_tv_auditorias_guard on public.tv_auditorias;
create trigger trg_tv_auditorias_guard before insert or update on public.tv_auditorias for each row execute function public.tv_auditorias_guard();

alter table public.tv_auditorias enable row level security;
drop policy if exists "tv_auditorias_select" on public.tv_auditorias;
drop policy if exists "tv_auditorias_insert" on public.tv_auditorias;
drop policy if exists "tv_auditorias_update" on public.tv_auditorias;
create policy "tv_auditorias_select" on public.tv_auditorias for select using (public.is_active_user());
create policy "tv_auditorias_insert" on public.tv_auditorias for insert with check (public.current_role() in ('admin', 'operador'));
create policy "tv_auditorias_update" on public.tv_auditorias for update using (public.current_role() in ('admin', 'operador')) with check (public.current_role() in ('admin', 'operador'));

grant select, insert, update on public.tv_auditorias to authenticated;
revoke all on public.tv_auditorias from anon;

-- Comprobación (opcional): debe devolver 1 fila
-- select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'tv_auditorias';
