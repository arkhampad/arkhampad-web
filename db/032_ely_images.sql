-- 032: animated coin pictures (GIFs). A launch stores its picture on-chain, which only fits a tiny still
-- image; an animated GIF is kept here instead and the coin's metadata points to
-- https://arkhampad.com/api/ely-file?h=<sha256>. Pictures are public; anyone can add one through
-- /api/ely-upload (size and type are checked there and here).
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run again.
create table if not exists public.ely_images (
  hash  text primary key,
  mime  text not null,
  data  text not null,               -- base64
  at    timestamptz not null default now()
);
alter table public.ely_images enable row level security;
drop policy if exists "public read" on public.ely_images;
create policy "public read" on public.ely_images for select using (true);

create or replace function public.ely_img_put(p_hash text, p_mime text, p_data text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if p_hash !~ '^[0-9a-f]{64}$' or p_mime not in ('image/gif', 'image/webp', 'image/png') then return false; end if;
  if length(p_data) > 2800000 then return false; end if; -- about 2 MB of picture
  insert into ely_images (hash, mime, data) values (p_hash, p_mime, p_data) on conflict (hash) do nothing;
  return true;
end $$;
grant execute on function public.ely_img_put(text, text, text) to anon, authenticated;
