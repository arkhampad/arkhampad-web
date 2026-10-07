-- When DexScreener first listed each ArkhamPad coin (set by the indexer's dexwatch).
-- Run once in Supabase SQL Editor. Safe to run again.
alter table public.coins add column if not exists dex_listed_at timestamptz;

-- coin_list is "select c.*": recreate it so it picks up the new column.
drop view if exists public.coin_list;
create view public.coin_list as
select c.*,
  coalesce(d.vol_24h, 0)    as volume_24h,
  coalesce(d.trades_24h, 0) as trades_24h,
  case when p.price_24h is null or p.price_24h = 0 then null
       else round(((c.price_usd - p.price_24h) / p.price_24h) * 100, 2) end as change_24h_pct,
  (select count(distinct t.trader) from public.trades t
     where t.chain_id = c.chain_id and t.coin = c.address and t.is_buy) as buyers,
  coalesce(f.fees, 0) * 0.3 as creator_fees_usd,
  greatest(0, coalesce(f.pool_usd, 0)) as pool_usd
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
) p on true
left join lateral (
  select sum(t.fee) as fees,
         sum(case when t.is_buy then t.usdc - t.fee else -t.usdc end) as pool_usd
  from public.trades t
  where t.chain_id = c.chain_id and t.coin = c.address
) f on true;
alter view public.coin_list set (security_invoker = true);
grant select on public.coin_list to anon, authenticated;
