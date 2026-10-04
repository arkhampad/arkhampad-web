-- ArkhamPad: follows and the real traders leaderboard.
-- Run once in Supabase SQL Editor. Safe to run again.
create table if not exists public.follows (
  follower   text not null,
  trader     text not null,
  created_at timestamptz not null default now(),
  primary key (follower, trader)
);
create index if not exists follows_trader_idx on public.follows (trader);
alter table public.follows enable row level security;
drop policy if exists "public read" on public.follows;
create policy "public read" on public.follows for select using (true);
grant select on public.follows to anon, authenticated;

-- Profit per trader: money taken out + value still held - money put in, per coin,
-- over the last p_days days (0 = all time). Unrealised value uses the coin's latest price.
create or replace function public.trader_board(p_days integer default 7, p_limit integer default 100, p_exclude text[] default '{}', p_trader text default null)
returns table (trader text, pnl numeric, bought numeric, sold numeric, volume numeric, trades bigint, coins bigint, wins bigint, last_trade timestamptz, followers bigint)
language sql stable as $$
  with t as (
    select tr.trader, tr.chain_id, tr.coin, tr.is_buy, tr.usdc, tr.coins, tr.ts
    from public.trades tr
    where (p_days = 0 or tr.ts > now() - make_interval(days => p_days))
      and tr.trader <> all (p_exclude)
      and tr.trader <> '0x000000000000000000000000000000000000dead'
      and (p_trader is null or tr.trader = lower(p_trader))
  ),
  per as (
    select t.trader, t.chain_id, t.coin,
      sum(case when t.is_buy then t.usdc else 0 end) as bought,
      sum(case when t.is_buy then 0 else t.usdc end) as sold,
      sum(case when t.is_buy then t.coins else -t.coins end) as net,
      count(*) as n, max(t.ts) as last
    from t group by 1, 2, 3
  ),
  val as (
    select p.*, greatest(p.net, 0) * coalesce(c.price_usd, 0) as held
    from per p left join public.coins c on c.chain_id = p.chain_id and c.address = p.coin
  ),
  agg as (
    select v.trader, sum(v.sold + v.held - v.bought) as pnl, sum(v.bought) as bought, sum(v.sold) as sold,
      sum(v.bought + v.sold) as volume, sum(v.n)::bigint as trades, count(*)::bigint as coins,
      count(*) filter (where v.sold + v.held - v.bought > 0)::bigint as wins, max(v.last) as last_trade
    from val v group by v.trader
  )
  select a.*, (select count(*) from public.follows f where f.trader = a.trader)::bigint as followers
  from agg a order by a.pnl desc limit greatest(1, least(p_limit, 500));
$$;
grant execute on function public.trader_board(integer, integer, text[], text) to anon, authenticated;
