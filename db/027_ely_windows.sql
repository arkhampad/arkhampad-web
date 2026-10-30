-- Discover's time filter (5m / 1h / 6h / 24h): price change and volume over the shorter windows.
-- ely_refresh_windows() runs right after ely_refresh_stats() in the indexer. Safe to run again.
alter table public.ely_tokens add column if not exists change5m double precision;
alter table public.ely_tokens add column if not exists change1h double precision;
alter table public.ely_tokens add column if not exists change6h double precision;
alter table public.ely_tokens add column if not exists vol5m_hype double precision not null default 0;
alter table public.ely_tokens add column if not exists vol1h_hype double precision not null default 0;
alter table public.ely_tokens add column if not exists vol6h_hype double precision not null default 0;

create or replace function public.ely_refresh_windows() returns void
language sql security definer set search_path = public as $$
  with w as (
    select token,
      sum(hype) filter (where at > now() - interval '5 minutes') as v5,
      sum(hype) filter (where at > now() - interval '1 hour') as v1,
      sum(hype) as v6
    from public.ely_trades where at > now() - interval '6 hours' group by token
  ),
  ref as (
    -- last price at or before each window start (falls back to the first trade inside the window)
    select t.address as token,
      coalesce((select price_hype from public.ely_trades x where x.token = t.address and x.at <= now() - interval '5 minutes' order by x.at desc, x.id desc limit 1),
               (select price_hype from public.ely_trades x where x.token = t.address and x.at > now() - interval '5 minutes' order by x.at asc, x.id asc limit 1)) as p5,
      coalesce((select price_hype from public.ely_trades x where x.token = t.address and x.at <= now() - interval '1 hour' order by x.at desc, x.id desc limit 1),
               (select price_hype from public.ely_trades x where x.token = t.address and x.at > now() - interval '1 hour' order by x.at asc, x.id asc limit 1)) as p1,
      coalesce((select price_hype from public.ely_trades x where x.token = t.address and x.at <= now() - interval '6 hours' order by x.at desc, x.id desc limit 1),
               (select price_hype from public.ely_trades x where x.token = t.address and x.at > now() - interval '6 hours' order by x.at asc, x.id asc limit 1)) as p6
    from public.ely_tokens t where t.last_trade_at > now() - interval '30 hours'
  )
  update public.ely_tokens t set
    vol5m_hype = coalesce(w.v5, 0),
    vol1h_hype = coalesce(w.v1, 0),
    vol6h_hype = coalesce(w.v6, 0),
    change5m = case when ref.p5 > 0 then (t.price_hype - ref.p5) / ref.p5 * 100 end,
    change1h = case when ref.p1 > 0 then (t.price_hype - ref.p1) / ref.p1 * 100 end,
    change6h = case when ref.p6 > 0 then (t.price_hype - ref.p6) / ref.p6 * 100 end
  from ref left join w on w.token = ref.token
  where t.address = ref.token;
  -- tokens with no trade in the last 30 hours: nothing moved in the short windows
  update public.ely_tokens set vol5m_hype = 0, vol1h_hype = 0, vol6h_hype = 0, change5m = 0, change1h = 0, change6h = 0
  where (last_trade_at is null or last_trade_at <= now() - interval '30 hours') and (vol6h_hype <> 0 or change6h is distinct from 0);
$$;
select public.ely_refresh_windows();
