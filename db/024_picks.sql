-- 024: ArkhamPad Picks — a few coins with the strongest healthy momentum, each with its real result
-- 1 hour and 24 hours after it was picked (shown publicly on /picks).
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run again.
create table if not exists public.ext_picks (
  id          bigserial primary key,
  chain_id    integer not null,
  address     text not null,
  name        text,
  symbol      text,
  image       text,
  picked_at   timestamptz not null default now(),
  pick_mc     numeric not null,
  score       numeric,
  mc_1h       numeric,
  mc_24h      numeric
);
create index if not exists ext_picks_time_idx on public.ext_picks (picked_at desc);
create index if not exists ext_picks_coin_idx on public.ext_picks (chain_id, address, picked_at desc);
alter table public.ext_picks enable row level security;
drop policy if exists "public read" on public.ext_picks;
create policy "public read" on public.ext_picks for select using (true);
grant select on public.ext_picks to anon, authenticated;
