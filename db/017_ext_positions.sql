-- Coins from other DEXs a user has traded on ArkhamPad (so the profile can show them).
-- Written only by the relayer after a successful trade; balances are read live from the chain.
create table if not exists public.ext_positions (
  "user"     text        not null,
  chain_id   integer     not null,
  coin       text        not null,
  updated_at timestamptz not null default now(),
  primary key ("user", chain_id, coin)
);
alter table public.ext_positions enable row level security;
drop policy if exists ext_positions_read on public.ext_positions;
create policy ext_positions_read on public.ext_positions for select using (true);
grant select on public.ext_positions to anon, authenticated;
