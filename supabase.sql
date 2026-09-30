-- Feed: full schema (fresh installs). Existing DBs: run migrate-v2.sql instead.
create table if not exists public.images (
  id text primary key,
  day date not null,
  w int not null, h int not null,
  tags jsonb not null default '[]',
  product jsonb, page text, cap text,
  fx double precision, fy double precision, fw double precision,
  path text not null,
  created_at timestamptz not null default now()
);
create index if not exists images_day_idx on public.images (day desc, created_at asc);

create table if not exists public.pages (
  slug text primary key,
  title text not null,
  subtitle text not null default '',
  body text not null default '',
  images jsonb not null default '[]',
  created_at timestamptz not null default now()
);

create table if not exists public.notes (
  id text primary key,
  day date not null,
  text text not null default '',
  fx double precision, fy double precision, fw double precision,
  created_at timestamptz not null default now()
);
create index if not exists notes_day_idx on public.notes (day desc);

alter table public.images enable row level security;
alter table public.pages  enable row level security;
alter table public.notes  enable row level security;

create policy "read images" on public.images for select using (true);
create policy "read pages"  on public.pages  for select using (true);
create policy "read notes"  on public.notes  for select using (true);

create policy "auth images ins" on public.images for insert to authenticated with check (true);
create policy "auth images upd" on public.images for update to authenticated using (true);
create policy "auth images del" on public.images for delete to authenticated using (true);
create policy "auth pages ins"  on public.pages  for insert to authenticated with check (true);
create policy "auth pages upd"  on public.pages  for update to authenticated using (true);
create policy "auth pages del"  on public.pages  for delete to authenticated using (true);
create policy "auth notes ins"  on public.notes  for insert to authenticated with check (true);
create policy "auth notes upd"  on public.notes  for update to authenticated using (true);
create policy "auth notes del"  on public.notes  for delete to authenticated using (true);

-- STORAGE (dashboard step, not SQL): Storage → New bucket → "daylog" → Public,
-- then bucket policies: INSERT/UPDATE/DELETE for authenticated.
