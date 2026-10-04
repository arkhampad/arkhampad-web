-- ArkhamPad: coin images uploaded by creators, and the coin list exposing them.
-- Run once in Supabase SQL Editor (before the indexer update). Safe to run again.
alter table public.coins add column if not exists image_url text;

create table if not exists public.coin_images (
  chain_id   integer not null,
  coin       text    not null,
  mime       text    not null,
  data       bytea   not null,
  updated_at timestamptz not null default now(),
  primary key (chain_id, coin)
);
-- served by the relayer (/img/...), never read directly by the site
alter table public.coin_images enable row level security;

-- The list view picks up image_url (a view's columns are fixed when it is created).
drop view if exists public.coin_list;
create view public.coin_list with (security_invoker = true) as
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
grant select on public.coin_list to anon, authenticated;
