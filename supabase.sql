-- Daylog schema. Supabase → SQL Editor → New query → paste → Run.

create table if not exists public.images (
  id text primary key,
  day date not null,
  w int not null,
  h int not null,
  tags jsonb not null default '[]',
  product jsonb,
  page text,
  path text not null,
  created_at timestamptz not null default now()
);
create index if not exists images_day_idx on public.images (day desc, created_at asc);

create table if not exists public.pages (
  slug text primary key,
  title text not null,
  subtitle text not null default '',
  body text not null default '',
  images jsonb not null default '[]',   -- [{id,w,h,path}]
  created_at timestamptz not null default now()
);

alter table public.images enable row level security;
alter table public.pages enable row level security;

-- Everyone can read.
create policy "read images" on public.images for select using (true);
create policy "read pages"  on public.pages  for select using (true);

-- DEMO POLICIES: anyone with the anon key can write. Fine while testing a
-- personal site; see README > Security to lock down with Supabase Auth.
create policy "write images ins" on public.images for insert with check (true);
create policy "write images upd" on public.images for update using (true);
create policy "write images del" on public.images for delete using (true);
create policy "write pages ins"  on public.pages  for insert with check (true);
create policy "write pages upd"  on public.pages  for update using (true);
create policy "write pages del"  on public.pages  for delete using (true);

-- STORAGE: dashboard → Storage → New bucket → name it  daylog  → check "Public bucket".
-- Then Storage → daylog → Policies: allow SELECT for all; INSERT/DELETE for all (demo)
-- or authenticated-only once you enable Auth.
