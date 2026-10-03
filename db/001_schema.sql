-- ArkhamPad database schema (run once in Supabase: SQL Editor -> New query -> paste -> Run).
-- Safe to run again: everything uses IF NOT EXISTS / OR REPLACE.

create table if not exists public.sync_state (
  chain_id    integer primary key,
  last_block  bigint  not null default 0,
  updated_at  timestamptz not null default now()
);

create table if not exists public.coins (
  chain_id      integer not null,
  address       text    not null,           -- coin (ERC20) address, lowercase
  curve         text    not null,           -- bonding curve address, lowercase
  creator       text    not null,
  name          text    not null,
  symbol        text    not null,
  metadata_uri  text    not null default '',
  lock_seconds  integer not null default 0,
  fee_mode      smallint not null default 0, -- 0 to creator, 1 buyback & burn
  phase         smallint not null default 0, -- 0 open, 1 full, 2 graduated
  v_usdc        numeric not null default 0,  -- curve virtual USDC (human units)
  v_coin        numeric not null default 0,  -- curve virtual coins (human units)
  usdc_reserve  numeric not null default 0,
  price_usd     numeric not null default 0,
  mc_usd        numeric not null default 0,
  start_mc_usd  numeric not null default 0,
  trades_count  integer not null default 0,
  volume_usd    numeric not null default 0,  -- all-time curve volume
  created_block bigint  not null,
  created_tx    text    not null,
  created_at    timestamptz not null,
  last_trade_at timestamptz,
  graduated_at  timestamptz,
  pool_usdc     numeric,
  pool_coins    numeric,
  primary key (chain_id, address)
);
create unique index if not exists coins_curve_idx on public.coins (chain_id, curve);
create index if not exists coins_created_idx on public.coins (created_at desc);
create index if not exists coins_mc_idx on public.coins (mc_usd desc);

create table if not exists public.trades (
  chain_id   integer not null,
  tx_hash    text    not null,
  log_index  integer not null,
  coin       text    not null,
  trader     text    not null,
  is_buy     boolean not null,
  usdc       numeric not null,   -- USDC paid (buy, incl. fee) or received (sell)
  coins      numeric not null,
  fee        numeric not null,
  price_usd  numeric not null,   -- price after the trade
  mc_usd     numeric not null,
  block      bigint  not null,
  ts         timestamptz not null,
  primary key (chain_id, tx_hash, log_index)
);
create index if not exists trades_coin_ts_idx on public.trades (chain_id, coin, ts desc);
create index if not exists trades_ts_idx on public.trades (ts desc);
create index if not exists trades_trader_idx on public.trades (trader, ts desc);

create table if not exists public.promotions (
  chain_id       integer not null,  -- chain where the payment happened
  tx_hash        text    not null,
  log_index      integer not null,
  coin           text    not null,
  coin_chain_id  bigint  not null,  -- chain of the promoted coin
  payer          text    not null,
  plan           smallint not null,
  seconds        integer not null,
  price_usd      numeric not null,
  starts_at      timestamptz not null,
  ends_at        timestamptz not null,
  primary key (chain_id, tx_hash, log_index)
);
create index if not exists promotions_active_idx on public.promotions (ends_at desc);

-- Coin list with 24h numbers, used by Discover / Terminal.
create or replace view public.coin_list as
select c.*,
  coalesce(d.vol_24h, 0)    as volume_24h,
  coalesce(d.trades_24h, 0) as trades_24h,
  case when p.price_24h is null or p.price_24h = 0 then null
       else round(((c.price_usd - p.price_24h) / p.price_24h) * 100, 2) end as change_24h_pct,
  (select count(distinct t.trader) from public.trades t
     where t.chain_id = c.chain_id and t.coin = c.address and t.is_buy) as buyers
from public.coins c
left join lateral (
  select sum(t.usdc) as vol_24h, count(*) as trades_24h
  from public.trades t
  where t.chain_id = c.chain_id and t.coin = c.address and t.ts > now() - interval '24 hours'
) d on true
left join lateral (
  select t.price_usd as price_24h
  from public.trades t
  where t.chain_id = c.chain_id and t.coin = c.address and t.ts <= now() - interval '24 hours'
  order by t.ts desc limit 1
) p on true;

-- Candles for charts: interval in seconds (60, 300, 900, 3600, 14400, 86400).
create or replace function public.coin_candles(p_chain integer, p_coin text, p_interval integer, p_limit integer default 300)
returns table (t timestamptz, o numeric, h numeric, l numeric, c numeric, v numeric)
language sql stable as $$
  with b as (
    select to_timestamp(floor(extract(epoch from ts) / p_interval) * p_interval) as bucket,
           ts, block, log_index, price_usd, usdc
    from public.trades
    where chain_id = p_chain and coin = lower(p_coin)
  )
  select bucket,
         (array_agg(price_usd order by block, log_index))[1],
         max(price_usd), min(price_usd),
         (array_agg(price_usd order by block desc, log_index desc))[1],
         sum(usdc)
  from b group by bucket order by bucket desc limit p_limit
$$;

-- Read-only public access (the website uses the anon key). Only the indexer writes.
alter table public.sync_state enable row level security;
alter table public.coins      enable row level security;
alter table public.trades     enable row level security;
alter table public.promotions enable row level security;

drop policy if exists "public read" on public.coins;
create policy "public read" on public.coins for select using (true);
drop policy if exists "public read" on public.trades;
create policy "public read" on public.trades for select using (true);
drop policy if exists "public read" on public.promotions;
create policy "public read" on public.promotions for select using (true);
drop policy if exists "public read" on public.sync_state;
create policy "public read" on public.sync_state for select using (true);

grant usage on schema public to anon, authenticated;
grant select on public.coins, public.trades, public.promotions, public.sync_state, public.coin_list to anon, authenticated;
grant execute on function public.coin_candles(integer, text, integer, integer) to anon, authenticated;
