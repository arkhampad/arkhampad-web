-- ArkhamPad 010: public profiles (display name + picture per wallet).
-- Run once in Supabase (SQL Editor -> New query -> paste -> Run) BEFORE uploading update-49. Safe to run again.
create table if not exists public.profiles (
  wallet     text primary key,              -- lowercase address
  name       text,
  avatar_url text,
  updated_at timestamptz not null default now()
);
create unique index if not exists profiles_name_idx on public.profiles (lower(name)) where name is not null;
alter table public.profiles enable row level security;
drop policy if exists "public read" on public.profiles;
create policy "public read" on public.profiles for select using (true);
grant select on public.profiles to anon, authenticated;
