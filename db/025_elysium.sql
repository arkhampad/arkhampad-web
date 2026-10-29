-- 025: Elysium. Every token paired with HYPE on Elysium (every launchpad), its trades and holders,
-- written by the indexer's Elysium loop (indexer/elysium.mjs). Public read for the site.
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run again.

create table if not exists public.ely_tokens (
  address        text primary key,
  name           text,
  symbol         text,
  decimals       integer not null default 18,
  supply         numeric not null default 0,
  uri            text,
  image          text,
  description    text,
  launchpad      text,
  venue          text not null,              -- 'v3' or 'v4'
  pool           text not null,              -- v3 pool address or v4 pool id
  manager        text,                       -- v3 factory or v4 pool manager
  whype          text,                       -- the HYPE side (0x0 = native HYPE on v4)
  token_is0      boolean not null,
  fee            integer,
  tick_spacing   integer,
  hooks          text,
  maker          text,                       -- the contract the pool was created through
  creator        text,
  ours           boolean not null default false,
  created_block  bigint,
  created_at     timestamptz,
  price_hype     double precision,
  mcap_hype      double precision,
  mcap_usd       double precision,
  vol24_hype     double precision not null default 0,
  buys24         integer not null default 0,
  sells24        integer not null default 0,
  change24       double precision,
  holders        integer not null default 0,
  top10_pct      double precision,
  last_trade_at  timestamptz,
  updated_at     timestamptz not null default now()
);
create index if not exists ely_tokens_vol_idx on public.ely_tokens (vol24_hype desc);
create index if not exists ely_tokens_new_idx on public.ely_tokens (created_at desc);
create index if not exists ely_tokens_mcap_idx on public.ely_tokens (mcap_hype desc);

create table if not exists public.ely_trades (
  id          bigserial primary key,
  token       text not null,
  tx          text not null,
  log_index   integer not null,
  block       bigint not null,
  at          timestamptz not null,
  side        text not null,                 -- 'buy' or 'sell'
  hype        double precision not null,
  amount      double precision not null,
  price_hype  double precision,
  trader      text,
  unique (tx, log_index)
);
create index if not exists ely_trades_token_idx on public.ely_trades (token, at desc);
create index if not exists ely_trades_at_idx on public.ely_trades (at desc);
create index if not exists ely_trades_trader_idx on public.ely_trades (trader, at desc);

create table if not exists public.ely_balances (
  token   text not null,
  holder  text not null,
  amount  numeric not null default 0,
  primary key (token, holder)
);
create index if not exists ely_balances_holder_idx on public.ely_balances (holder) where amount > 0;
create index if not exists ely_balances_top_idx on public.ely_balances (token, amount desc);

create table if not exists public.ely_state (k text primary key, v text);
create table if not exists public.ely_meta (k text primary key, v jsonb, updated_at timestamptz not null default now());

alter table public.ely_tokens enable row level security;
alter table public.ely_trades enable row level security;
alter table public.ely_balances enable row level security;
alter table public.ely_meta enable row level security;
alter table public.ely_state enable row level security;
drop policy if exists "public read" on public.ely_tokens;
create policy "public read" on public.ely_tokens for select using (true);
drop policy if exists "public read" on public.ely_trades;
create policy "public read" on public.ely_trades for select using (true);
drop policy if exists "public read" on public.ely_balances;
create policy "public read" on public.ely_balances for select using (true);
drop policy if exists "public read" on public.ely_meta;
create policy "public read" on public.ely_meta for select using (true);
grant select on public.ely_tokens, public.ely_trades, public.ely_balances, public.ely_meta to anon, authenticated;
revoke all on public.ely_state from anon, authenticated;

-- stats for the lists: 24h volume, trades, change, last price, market cap, holders, top-10 share
create or replace function public.ely_refresh_stats(hype_usd double precision) returns void
language sql as $$
  with day as (
    select token,
           sum(hype) as vol, count(*) filter (where side = 'buy') as buys, count(*) filter (where side = 'sell') as sells
    from public.ely_trades where at > now() - interval '24 hours' group by token
  ),
  last as (
    select distinct on (token) token, price_hype, at from public.ely_trades order by token, at desc, id desc
  ),
  before as (
    select distinct on (token) token, price_hype from public.ely_trades where at <= now() - interval '24 hours' order by token, at desc, id desc
  ),
  first_day as (
    select distinct on (token) token, price_hype from public.ely_trades where at > now() - interval '24 hours' order by token, at asc, id asc
  ),
  h as (
    select token, count(*) filter (where amount > 0) as holders from public.ely_balances group by token
  ),
  top as (
    select token, sum(amount) as top10 from (
      select token, amount, row_number() over (partition by token order by amount desc) as r
      from public.ely_balances where amount > 0
    ) x where r <= 10 group by token
  )
  update public.ely_tokens t set
    price_hype = coalesce(last.price_hype, t.price_hype),
    mcap_hype = coalesce(last.price_hype, t.price_hype) * t.supply / power(10, t.decimals),
    mcap_usd = coalesce(last.price_hype, t.price_hype) * t.supply / power(10, t.decimals) * hype_usd,
    vol24_hype = coalesce(day.vol, 0),
    buys24 = coalesce(day.buys, 0),
    sells24 = coalesce(day.sells, 0),
    change24 = case when coalesce(before.price_hype, first_day.price_hype) > 0
                    then (coalesce(last.price_hype, t.price_hype) - coalesce(before.price_hype, first_day.price_hype)) / coalesce(before.price_hype, first_day.price_hype) * 100 end,
    holders = coalesce(h.holders, 0),
    top10_pct = case when t.supply > 0 then coalesce(top.top10, 0) / t.supply * 100 end,
    last_trade_at = last.at,
    updated_at = now()
  from public.ely_tokens t2
  left join day on day.token = t2.address
  left join last on last.token = t2.address
  left join before on before.token = t2.address
  left join first_day on first_day.token = t2.address
  left join h on h.token = t2.address
  left join top on top.token = t2.address
  where t.address = t2.address;
$$;
