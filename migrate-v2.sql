-- Feed v2 migration: captions, freeform layout, floating notes.
-- Supabase → SQL Editor → run once. Safe to re-run.

alter table public.images add column if not exists cap text;
alter table public.images add column if not exists fx double precision;
alter table public.images add column if not exists fy double precision;
alter table public.images add column if not exists fw double precision;

create table if not exists public.notes (
  id text primary key,
  day date not null,
  text text not null default '',
  fx double precision,
  fy double precision,
  fw double precision,
  created_at timestamptz not null default now()
);
create index if not exists notes_day_idx on public.notes (day desc);

alter table public.notes enable row level security;
create policy "read notes" on public.notes for select using (true);

-- If you've done the lockdown (recommended):
create policy "auth notes ins" on public.notes for insert to authenticated with check (true);
create policy "auth notes upd" on public.notes for update to authenticated using (true);
create policy "auth notes del" on public.notes for delete to authenticated using (true);

-- If you're still on the open demo policies instead, comment the three
-- policies above and use these:
-- create policy "demo notes ins" on public.notes for insert with check (true);
-- create policy "demo notes upd" on public.notes for update using (true);
-- create policy "demo notes del" on public.notes for delete using (true);
