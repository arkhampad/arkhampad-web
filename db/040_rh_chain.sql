-- 040: Robinhood Chain (chain 4663). Same tables and stats as Elysium (025, 027, 034), prefixed rh_. The "hype" columns hold ETH on this chain.
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run again.

create table if not exists public.rh_tokens (
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
create index if not exists rh_tokens_vol_idx on public.rh_tokens (vol24_hype desc);
create index if not exists rh_tokens_new_idx on public.rh_tokens (created_at desc);
create index if not exists rh_tokens_mcap_idx on public.rh_tokens (mcap_hype desc);

create table if not exists public.rh_trades (
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
create index if not exists rh_trades_token_idx on public.rh_trades (token, at desc);
create index if not exists rh_trades_at_idx on public.rh_trades (at desc);
create index if not exists rh_trades_trader_idx on public.rh_trades (trader, at desc);

create table if not exists public.rh_balances (
  token   text not null,
  holder  text not null,
  amount  numeric not null default 0,
  primary key (token, holder)
);
create index if not exists rh_balances_holder_idx on public.rh_balances (holder) where amount > 0;
create index if not exists rh_balances_top_idx on public.rh_balances (token, amount desc);

create table if not exists public.rh_state (k text primary key, v text);
create table if not exists public.rh_meta (k text primary key, v jsonb, updated_at timestamptz not null default now());

alter table public.rh_tokens enable row level security;
alter table public.rh_trades enable row level security;
alter table public.rh_balances enable row level security;
alter table public.rh_meta enable row level security;
alter table public.rh_state enable row level security;
drop policy if exists "public read" on public.rh_tokens;
create policy "public read" on public.rh_tokens for select using (true);
drop policy if exists "public read" on public.rh_trades;
create policy "public read" on public.rh_trades for select using (true);
drop policy if exists "public read" on public.rh_balances;
create policy "public read" on public.rh_balances for select using (true);
drop policy if exists "public read" on public.rh_meta;
create policy "public read" on public.rh_meta for select using (true);
grant select on public.rh_tokens, public.rh_trades, public.rh_balances, public.rh_meta to anon, authenticated;
revoke all on public.rh_state from anon, authenticated;

-- stats for the lists: 24h volume, trades, change, last price, market cap, holders, top-10 share
create or replace function public.rh_refresh_stats(hype_usd double precision) returns void
language sql as $$
  with day as (
    select token,
           sum(hype) as vol, count(*) filter (where side = 'buy') as buys, count(*) filter (where side = 'sell') as sells
    from public.rh_trades where at > now() - interval '24 hours' group by token
  ),
  last as (
    select distinct on (token) token, price_hype, at from public.rh_trades order by token, at desc, id desc
  ),
  before as (
    select distinct on (token) token, price_hype from public.rh_trades where at <= now() - interval '24 hours' order by token, at desc, id desc
  ),
  first_day as (
    select distinct on (token) token, price_hype from public.rh_trades where at > now() - interval '24 hours' order by token, at asc, id asc
  ),
  h as (
    select token, count(*) filter (where amount > 0) as holders from public.rh_balances group by token
  ),
  top as (
    select token, sum(amount) as top10 from (
      select token, amount, row_number() over (partition by token order by amount desc) as r
      from public.rh_balances where amount > 0
    ) x where r <= 10 group by token
  )
  update public.rh_tokens t set
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
  from public.rh_tokens t2
  left join day on day.token = t2.address
  left join last on last.token = t2.address
  left join before on before.token = t2.address
  left join first_day on first_day.token = t2.address
  left join h on h.token = t2.address
  left join top on top.token = t2.address
  where t.address = t2.address;
$$;

alter table public.rh_tokens add column if not exists change5m double precision;
alter table public.rh_tokens add column if not exists change1h double precision;
alter table public.rh_tokens add column if not exists change6h double precision;
alter table public.rh_tokens add column if not exists vol5m_hype double precision not null default 0;
alter table public.rh_tokens add column if not exists vol1h_hype double precision not null default 0;
alter table public.rh_tokens add column if not exists vol6h_hype double precision not null default 0;

-- 034: far fewer disk writes from the list stats (Nov 5: the database ran out of disk IO and went down).
-- Before: every minute, every coin that traded in the last 24 hours (~2,000) was re-read and its row
-- rewritten, even when nothing had changed (Postgres writes a new row version for every UPDATE).
-- Now:
--   * the every-minute run only looks at coins with a trade in the last 15 minutes;
--   * a full run (every coin of the last 24 hours, plus dollar values following HYPE) every 10 minutes;
--   * a row is written only when one of its numbers actually changed (stats and short windows alike).
-- The indexer calls rh_refresh_stats_v2(hype_usd, recent_only). Safe to run again.

create or replace function public.rh_refresh_stats_v2(hype_usd double precision, recent_only boolean) returns void
language plpgsql as $$
declare since timestamptz := now() - case when recent_only then interval '15 minutes' else interval '24 hours' end;
begin
  with act as (
    select distinct token from public.rh_trades where at > since
    union
    select address from public.rh_tokens where not recent_only and (vol24_hype > 0 or buys24 > 0 or sells24 > 0)
  ),
  day as (
    select x.token, sum(x.hype) as vol, count(*) filter (where x.side = 'buy') as buys, count(*) filter (where x.side = 'sell') as sells
    from public.rh_trades x join act on act.token = x.token
    where x.at > now() - interval '24 hours' group by x.token
  ),
  s as (
    select a.token, tk.pool, tk.manager, tk.supply, tk.decimals, tk.price_hype as old_p, tk.last_trade_at as old_at,
      (select x.price_hype from public.rh_trades x where x.token = a.token order by x.at desc limit 1) as last_p,
      (select x.at from public.rh_trades x where x.token = a.token order by x.at desc limit 1) as last_at,
      (select x.price_hype from public.rh_trades x where x.token = a.token and x.at <= now() - interval '24 hours' order by x.at desc limit 1) as before_p,
      (select x.price_hype from public.rh_trades x where x.token = a.token and x.at > now() - interval '24 hours' order by x.at asc limit 1) as first_p,
      (select count(*) from public.rh_balances b where b.token = a.token and b.amount > 0 and b.holder is distinct from tk.pool and b.holder is distinct from tk.manager) as holders,
      (select sum(z.amount) from (select b.amount from public.rh_balances b where b.token = a.token and b.amount > 0 and b.holder is distinct from tk.pool and b.holder is distinct from tk.manager order by b.amount desc limit 10) z) as top10
    from act a join public.rh_tokens tk on tk.address = a.token
  ),
  v as (
    select s.token,
      coalesce(s.last_p, s.old_p) as price,
      coalesce(s.last_p, s.old_p) * s.supply / power(10, s.decimals) as mcap,
      coalesce(day.vol, 0) as vol, coalesce(day.buys, 0) as buys, coalesce(day.sells, 0) as sells,
      case when coalesce(s.before_p, s.first_p) > 0
           then (coalesce(s.last_p, s.old_p) - coalesce(s.before_p, s.first_p)) / coalesce(s.before_p, s.first_p) * 100 end as chg,
      s.holders,
      case when s.supply > 0 then coalesce(s.top10, 0) / s.supply * 100 end as top10,
      coalesce(s.last_at, s.old_at) as last_at
    from s left join day on day.token = s.token
  )
  update public.rh_tokens t set
    price_hype = v.price,
    mcap_hype = v.mcap,
    mcap_usd = v.mcap * hype_usd,
    vol24_hype = v.vol,
    buys24 = v.buys,
    sells24 = v.sells,
    change24 = v.chg,
    holders = v.holders,
    top10_pct = v.top10,
    last_trade_at = v.last_at,
    updated_at = now()
  from v
  where t.address = v.token
    and (t.price_hype is distinct from v.price or t.vol24_hype is distinct from v.vol or t.buys24 is distinct from v.buys
      or t.sells24 is distinct from v.sells or t.holders is distinct from v.holders or t.last_trade_at is distinct from v.last_at
      or abs(coalesce(t.change24, 0) - coalesce(v.chg, 0)) > 0.05 or abs(coalesce(t.top10_pct, 0) - coalesce(v.top10, 0)) > 0.05
      or (t.change24 is null) <> (v.chg is null)
      or abs(coalesce(t.mcap_usd, 0) - v.mcap * hype_usd) > 0.002 * greatest(v.mcap * hype_usd, 1));

  if not recent_only then
    -- every other coin: only its dollar value follows HYPE; write the row only when it moved over 1%
    update public.rh_tokens t set mcap_usd = t.mcap_hype * hype_usd
    where t.mcap_hype is not null and hype_usd > 0
      and (t.mcap_usd is null or abs(t.mcap_usd - t.mcap_hype * hype_usd) > 0.01 * t.mcap_hype * hype_usd);
  end if;
end $$;

-- the old name keeps working (full run), in case an older indexer calls it
create or replace function public.rh_refresh_stats(hype_usd double precision) returns void
language sql as $$ select public.rh_refresh_stats_v2(hype_usd, false); $$;

-- short windows (5m / 1h / 6h): same numbers as before, but a row is written only when they changed
create or replace function public.rh_refresh_windows() returns void
language sql security definer set search_path = public as $$
  with w as (
    select token,
      sum(hype) filter (where at > now() - interval '5 minutes') as v5,
      sum(hype) filter (where at > now() - interval '1 hour') as v1,
      sum(hype) as v6
    from public.rh_trades where at > now() - interval '6 hours' group by token
  ),
  ref as (
    select t.address as token, t.price_hype,
      coalesce((select price_hype from public.rh_trades x where x.token = t.address and x.at <= now() - interval '5 minutes' order by x.at desc, x.id desc limit 1),
               (select price_hype from public.rh_trades x where x.token = t.address and x.at > now() - interval '5 minutes' order by x.at asc, x.id asc limit 1)) as p5,
      coalesce((select price_hype from public.rh_trades x where x.token = t.address and x.at <= now() - interval '1 hour' order by x.at desc, x.id desc limit 1),
               (select price_hype from public.rh_trades x where x.token = t.address and x.at > now() - interval '1 hour' order by x.at asc, x.id asc limit 1)) as p1,
      coalesce((select price_hype from public.rh_trades x where x.token = t.address and x.at <= now() - interval '6 hours' order by x.at desc, x.id desc limit 1),
               (select price_hype from public.rh_trades x where x.token = t.address and x.at > now() - interval '6 hours' order by x.at asc, x.id asc limit 1)) as p6
    from public.rh_tokens t where t.last_trade_at > now() - interval '30 hours'
  ),
  v as (
    select ref.token, coalesce(w.v5, 0) as v5, coalesce(w.v1, 0) as v1, coalesce(w.v6, 0) as v6,
      case when ref.p5 > 0 then (ref.price_hype - ref.p5) / ref.p5 * 100 end as c5,
      case when ref.p1 > 0 then (ref.price_hype - ref.p1) / ref.p1 * 100 end as c1,
      case when ref.p6 > 0 then (ref.price_hype - ref.p6) / ref.p6 * 100 end as c6
    from ref left join w on w.token = ref.token
  )
  update public.rh_tokens t set vol5m_hype = v.v5, vol1h_hype = v.v1, vol6h_hype = v.v6, change5m = v.c5, change1h = v.c1, change6h = v.c6
  from v
  where t.address = v.token
    and (t.vol5m_hype is distinct from v.v5 or t.vol1h_hype is distinct from v.v1 or t.vol6h_hype is distinct from v.v6
      or abs(coalesce(t.change5m, 0) - coalesce(v.c5, 0)) > 0.05 or abs(coalesce(t.change1h, 0) - coalesce(v.c1, 0)) > 0.05
      or abs(coalesce(t.change6h, 0) - coalesce(v.c6, 0)) > 0.05
      or (t.change5m is null) <> (v.c5 is null) or (t.change1h is null) <> (v.c1 is null) or (t.change6h is null) <> (v.c6 is null));
  update public.rh_tokens set vol5m_hype = 0, vol1h_hype = 0, vol6h_hype = 0, change5m = 0, change1h = 0, change6h = 0
  where (last_trade_at is null or last_trade_at <= now() - interval '30 hours') and (vol6h_hype <> 0 or change6h is distinct from 0);
$$;

select 'ok' as db_034;
