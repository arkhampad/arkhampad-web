-- ArkhamPad: coins from other DEXs (display only) + realtime + view hardening.
-- Run once in Supabase SQL Editor. Safe to run again.

create table if not exists public.ext_tokens (
  chain_id       integer not null,
  address        text    not null,
  network        text    not null,          -- GeckoTerminal network id
  pool           text,
  dex            text,
  name           text    not null,
  symbol         text    not null,
  image          text,
  price_usd      numeric,
  mcap_usd       numeric,
  fdv_usd        numeric,
  liq_usd        numeric,
  vol_24h        numeric,
  change_1h      numeric,
  change_24h     numeric,
  buys_24h       integer,
  sells_24h      integer,
  pool_created   timestamptz,
  trending_rank  integer,
  spark          numeric[] not null default '{}', -- recent prices, oldest first
  first_seen     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  primary key (chain_id, address)
);
create index if not exists ext_tokens_vol_idx on public.ext_tokens (vol_24h desc nulls last);
create index if not exists ext_tokens_trend_idx on public.ext_tokens (trending_rank) where trending_rank is not null;
create index if not exists ext_tokens_new_idx on public.ext_tokens (pool_created desc nulls last);
create index if not exists ext_tokens_sym_idx on public.ext_tokens (lower(symbol));

alter table public.ext_tokens enable row level security;
drop policy if exists "public read" on public.ext_tokens;
create policy "public read" on public.ext_tokens for select using (true);
grant select on public.ext_tokens to anon, authenticated;

-- The coin list view runs with the reader's rights (clears the "unrestricted" warning).
alter view public.coin_list set (security_invoker = true);

-- Live updates for the website (new trades and coin changes arrive instantly).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table public.trades; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.coins;  exception when duplicate_object then null; end;
  end if;
end $$;
