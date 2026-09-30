-- Feed v3 migration: rich blocks + reusable cards. Safe to re-run.

alter table public.notes add column if not exists kind text not null default 'text';
alter table public.notes add column if not exists data jsonb;

create table if not exists public.snippets (
  id text primary key,
  name text not null,
  kind text not null,
  data jsonb,
  created_at timestamptz not null default now()
);
alter table public.snippets enable row level security;

drop policy if exists "read snippets" on public.snippets;
create policy "read snippets" on public.snippets for select using (true);

drop policy if exists "auth snippets ins" on public.snippets;
drop policy if exists "auth snippets upd" on public.snippets;
drop policy if exists "auth snippets del" on public.snippets;
create policy "auth snippets ins" on public.snippets for insert to authenticated with check (true);
create policy "auth snippets upd" on public.snippets for update to authenticated using (true);
create policy "auth snippets del" on public.snippets for delete to authenticated using (true);
