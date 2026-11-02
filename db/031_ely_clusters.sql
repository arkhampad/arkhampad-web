-- 031: Elysium "cluster / bot supply" metric, per coin.
-- Clustered wallets = wallets that BOUGHT this coin in the SAME BLOCK as at least one other wallet
-- (coordinated bundle buys — a strong bot signal). Reports what % of the CIRCULATING supply those
-- wallets hold right now. Circulating = all wallet balances except the pool and burn/zero addresses.
-- Built from data the indexer already writes: ely_trades (block, trader, side) + ely_balances + ely_tokens.
-- Read-only, additive — safe to run again. Run once in Supabase: SQL Editor -> New query -> paste -> Run.

create or replace function public.ely_clusters(p_coin text)
returns table (
  holders             int,
  cluster_wallets     int,
  clusters            int,
  cluster_supply_pct  double precision,
  top10_pct           double precision,
  biggest_cluster_pct double precision
) language sql stable as $$
  with coin as (
    select lower(address) as a, lower(coalesce(pool, '')) as pool, supply
    from public.ely_tokens where lower(address) = lower(p_coin)
  ),
  -- current balances held by wallets (exclude the pool and burn/zero)
  bal as (
    select lower(b.holder) as w, b.amount
    from public.ely_balances b, coin
    where lower(b.token) = coin.a
      and b.amount > 0
      and lower(b.holder) <> coin.pool
      and lower(b.holder) not in (
        '0x000000000000000000000000000000000000dead',
        '0x0000000000000000000000000000000000000000'
      )
  ),
  circ as (select coalesce(sum(amount), 0) as amt from bal),
  -- buys, by block (exclude the pool as a trader)
  buys as (
    select t.block, lower(t.trader) as w
    from public.ely_trades t, coin
    where lower(t.token) = coin.a and t.side = 'buy' and t.trader is not null
      and lower(t.trader) <> coin.pool
  ),
  -- same-block groups with 2+ distinct wallets = a coordinated bundle
  grp as (
    select block, array_agg(distinct w) as ws, count(distinct w) as n
    from buys group by block having count(distinct w) >= 2
  ),
  clustered as (select distinct unnest(ws) as w from grp),
  cl_bal as (select coalesce(sum(b.amount), 0) as amt from bal b join clustered c on c.w = b.w),
  -- current supply share of each same-block group, to surface the single biggest cluster
  grp_bal as (
    select g.block, coalesce(sum(b.amount), 0) as amt
    from grp g cross join lateral unnest(g.ws) as gw(w)
    left join bal b on b.w = gw.w
    group by g.block
  ),
  top10 as (select coalesce(sum(amount), 0) as amt from (select amount from bal order by amount desc limit 10) x)
  select
    (select count(*) from bal)::int                                                                    as holders,
    (select count(*) from clustered)::int                                                               as cluster_wallets,
    (select count(*) from grp)::int                                                                     as clusters,
    case when (select amt from circ) > 0 then (select amt from cl_bal) / (select amt from circ) * 100 else 0 end as cluster_supply_pct,
    case when (select amt from circ) > 0 then (select amt from top10)  / (select amt from circ) * 100 else 0 end as top10_pct,
    case when (select amt from circ) > 0 then coalesce((select max(amt) from grp_bal), 0) / (select amt from circ) * 100 else 0 end as biggest_cluster_pct;
$$;

-- let the site (anon/authenticated) call it
grant execute on function public.ely_clusters(text) to anon, authenticated;
