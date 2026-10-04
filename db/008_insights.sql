-- ArkhamPad: real Analytics + Daily, invites (25% of platform fees), holder comments.
-- Run once in Supabase SQL Editor. Safe to run again.

-- ---------------------------------------------------------------- analytics
create or replace function public.platform_stats()
returns table (coins_total bigint, coins_24h bigint, graduated bigint, volume_24h numeric, volume_7d numeric, volume_all numeric,
               trades_24h bigint, trades_all bigint, traders_24h bigint, traders_all bigint, fees_all numeric)
language sql stable as $$
  select
    (select count(*) from public.coins),
    (select count(*) from public.coins where created_at > now() - interval '24 hours'),
    (select count(*) from public.coins where phase = 2),
    (select coalesce(sum(usdc), 0) from public.trades where ts > now() - interval '24 hours'),
    (select coalesce(sum(usdc), 0) from public.trades where ts > now() - interval '7 days'),
    (select coalesce(sum(usdc), 0) from public.trades),
    (select count(*) from public.trades where ts > now() - interval '24 hours'),
    (select count(*) from public.trades),
    (select count(distinct trader) from public.trades where ts > now() - interval '24 hours'),
    (select count(distinct trader) from public.trades),
    (select coalesce(sum(fee), 0) from public.trades);
$$;

create or replace function public.daily_series(p_days integer default 30)
returns table (day date, volume numeric, trades bigint, traders bigint, launches bigint, graduations bigint)
language sql stable as $$
  with d as (select generate_series((now() at time zone 'utc')::date - (least(p_days, 365) - 1), (now() at time zone 'utc')::date, interval '1 day')::date as day)
  select d.day,
    coalesce((select sum(usdc) from public.trades t where (t.ts at time zone 'utc')::date = d.day), 0),
    (select count(*) from public.trades t where (t.ts at time zone 'utc')::date = d.day),
    (select count(distinct trader) from public.trades t where (t.ts at time zone 'utc')::date = d.day),
    (select count(*) from public.coins c where (c.created_at at time zone 'utc')::date = d.day),
    (select count(*) from public.coins c where c.graduated_at is not null and (c.graduated_at at time zone 'utc')::date = d.day)
  from d order by d.day;
$$;

-- One day's highlights (UTC day). Gainer = biggest rise from the day's first to last trade price.
create or replace function public.day_recap(p_day date default null)
returns jsonb language sql stable as $$
  with dd as (select coalesce(p_day, (now() at time zone 'utc')::date) as day),
  t as (select tr.* from public.trades tr, dd where (tr.ts at time zone 'utc')::date = dd.day),
  per as (
    select t.chain_id, t.coin, sum(t.usdc) as vol, count(*) as n,
      (array_agg(t.price_usd order by t.ts, t.log_index))[1] as p0,
      (array_agg(t.price_usd order by t.ts desc, t.log_index desc))[1] as p1
    from t group by 1, 2
  ),
  named as (select p.*, c.symbol, c.name, c.mc_usd, c.image_url from per p join public.coins c on c.chain_id = p.chain_id and c.address = p.coin)
  select jsonb_build_object(
    'day', (select day from dd),
    'volume', (select coalesce(sum(usdc), 0) from t),
    'trades', (select count(*) from t),
    'traders', (select count(distinct trader) from t),
    'launches', (select count(*) from public.coins c, dd where (c.created_at at time zone 'utc')::date = dd.day),
    'graduations', (select count(*) from public.coins c, dd where c.graduated_at is not null and (c.graduated_at at time zone 'utc')::date = dd.day),
    'fastest_grad_s', (select min(extract(epoch from c.graduated_at - c.created_at)) from public.coins c, dd where c.graduated_at is not null and (c.graduated_at at time zone 'utc')::date = dd.day),
    'gainer', (select to_jsonb(x) from (select chain_id, coin, symbol, name, image_url, round(((p1 - p0) / nullif(p0, 0)) * 100, 1) as change, mc_usd from named where p0 > 0 order by (p1 - p0) / p0 desc limit 1) x),
    'top_volume', (select to_jsonb(x) from (select chain_id, coin, symbol, name, image_url, vol, mc_usd from named order by vol desc limit 1) x),
    'biggest_trade', (select to_jsonb(x) from (select t.trader, t.usdc, t.is_buy, c.symbol, t.chain_id, t.coin from t join public.coins c on c.chain_id = t.chain_id and c.address = t.coin order by t.usdc desc limit 1) x),
    'top', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (select chain_id, coin, symbol, name, image_url, vol, n, round(((p1 - p0) / nullif(p0, 0)) * 100, 1) as change, mc_usd from named order by vol desc limit 10) x)
  );
$$;
grant execute on function public.platform_stats() to anon, authenticated;
grant execute on function public.daily_series(integer) to anon, authenticated;
grant execute on function public.day_recap(date) to anon, authenticated;

-- ---------------------------------------------------------------- invites
-- A new user is linked to whoever invited them (once, never changed).
-- The inviter earns 25% of ArkhamPad's share of the fees on the friend's trades for 12 months.
create table if not exists public.referrals (
  "user"     text primary key,
  referrer   text not null,
  created_at timestamptz not null default now()
);
create index if not exists referrals_referrer_idx on public.referrals (referrer);
alter table public.referrals enable row level security;
drop policy if exists "public read" on public.referrals;
create policy "public read" on public.referrals for select using (true);
grant select on public.referrals to anon, authenticated;

create table if not exists public.ref_payouts (
  id         bigserial primary key,
  referrer   text not null,
  chain_id   integer not null,
  amount     numeric not null,
  tx_hash    text,
  created_at timestamptz not null default now()
);
create index if not exists ref_payouts_idx on public.ref_payouts (referrer, chain_id);
alter table public.ref_payouts enable row level security;
drop policy if exists "public read" on public.ref_payouts;
create policy "public read" on public.ref_payouts for select using (true);
grant select on public.ref_payouts to anon, authenticated;

-- Earned per network. Trade fee is 1%; ArkhamPad keeps 70% of it; the inviter gets 25% of that.
create or replace function public.ref_earnings(p_referrer text)
returns table (chain_id integer, friends bigint, volume numeric, earned numeric, paid numeric)
language sql stable as $$
  with f as (select r."user", r.created_at from public.referrals r where r.referrer = lower(p_referrer)),
  e as (
    select t.chain_id, count(distinct t.trader) as friends, sum(t.usdc) as volume, sum(t.fee) * 0.7 * 0.25 as earned
    from public.trades t join f on f."user" = t.trader
    where t.ts >= f.created_at and t.ts < f.created_at + interval '12 months'
    group by t.chain_id
  )
  select e.chain_id, e.friends, e.volume, e.earned,
    coalesce((select sum(p.amount) from public.ref_payouts p where p.referrer = lower(p_referrer) and p.chain_id = e.chain_id), 0)
  from e;
$$;
grant execute on function public.ref_earnings(text) to anon, authenticated;

-- ---------------------------------------------------------------- comments (holders only, posted through the relayer)
create table if not exists public.comments (
  id         bigserial primary key,
  chain_id   integer not null,
  coin       text not null,
  "user"     text not null,
  body       text not null,
  holder_pct numeric,
  deleted    boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists comments_coin_idx on public.comments (chain_id, coin, created_at desc);
alter table public.comments enable row level security;
drop policy if exists "public read" on public.comments;
create policy "public read" on public.comments for select using (not deleted);
grant select on public.comments to anon, authenticated;
