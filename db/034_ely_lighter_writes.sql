-- 034: far fewer disk writes from the list stats (Nov 5: the database ran out of disk IO and went down).
-- Before: every minute, every coin that traded in the last 24 hours (~2,000) was re-read and its row
-- rewritten, even when nothing had changed (Postgres writes a new row version for every UPDATE).
-- Now:
--   * the every-minute run only looks at coins with a trade in the last 15 minutes;
--   * a full run (every coin of the last 24 hours, plus dollar values following HYPE) every 10 minutes;
--   * a row is written only when one of its numbers actually changed (stats and short windows alike).
-- The indexer calls ely_refresh_stats_v2(hype_usd, recent_only). Safe to run again.

create or replace function public.ely_refresh_stats_v2(hype_usd double precision, recent_only boolean) returns void
language plpgsql as $$
declare since timestamptz := now() - case when recent_only then interval '15 minutes' else interval '24 hours' end;
begin
  with act as (
    select distinct token from public.ely_trades where at > since
    union
    select address from public.ely_tokens where not recent_only and (vol24_hype > 0 or buys24 > 0 or sells24 > 0)
  ),
  day as (
    select x.token, sum(x.hype) as vol, count(*) filter (where x.side = 'buy') as buys, count(*) filter (where x.side = 'sell') as sells
    from public.ely_trades x join act on act.token = x.token
    where x.at > now() - interval '24 hours' group by x.token
  ),
  s as (
    select a.token, tk.pool, tk.manager, tk.supply, tk.decimals, tk.price_hype as old_p, tk.last_trade_at as old_at,
      (select x.price_hype from public.ely_trades x where x.token = a.token order by x.at desc limit 1) as last_p,
      (select x.at from public.ely_trades x where x.token = a.token order by x.at desc limit 1) as last_at,
      (select x.price_hype from public.ely_trades x where x.token = a.token and x.at <= now() - interval '24 hours' order by x.at desc limit 1) as before_p,
      (select x.price_hype from public.ely_trades x where x.token = a.token and x.at > now() - interval '24 hours' order by x.at asc limit 1) as first_p,
      (select count(*) from public.ely_balances b where b.token = a.token and b.amount > 0 and b.holder is distinct from tk.pool and b.holder is distinct from tk.manager) as holders,
      (select sum(z.amount) from (select b.amount from public.ely_balances b where b.token = a.token and b.amount > 0 and b.holder is distinct from tk.pool and b.holder is distinct from tk.manager order by b.amount desc limit 10) z) as top10
    from act a join public.ely_tokens tk on tk.address = a.token
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
  update public.ely_tokens t set
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
    update public.ely_tokens t set mcap_usd = t.mcap_hype * hype_usd
    where t.mcap_hype is not null and hype_usd > 0
      and (t.mcap_usd is null or abs(t.mcap_usd - t.mcap_hype * hype_usd) > 0.01 * t.mcap_hype * hype_usd);
  end if;
end $$;

-- the old name keeps working (full run), in case an older indexer calls it
create or replace function public.ely_refresh_stats(hype_usd double precision) returns void
language sql as $$ select public.ely_refresh_stats_v2(hype_usd, false); $$;

-- short windows (5m / 1h / 6h): same numbers as before, but a row is written only when they changed
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
    select t.address as token, t.price_hype,
      coalesce((select price_hype from public.ely_trades x where x.token = t.address and x.at <= now() - interval '5 minutes' order by x.at desc, x.id desc limit 1),
               (select price_hype from public.ely_trades x where x.token = t.address and x.at > now() - interval '5 minutes' order by x.at asc, x.id asc limit 1)) as p5,
      coalesce((select price_hype from public.ely_trades x where x.token = t.address and x.at <= now() - interval '1 hour' order by x.at desc, x.id desc limit 1),
               (select price_hype from public.ely_trades x where x.token = t.address and x.at > now() - interval '1 hour' order by x.at asc, x.id asc limit 1)) as p1,
      coalesce((select price_hype from public.ely_trades x where x.token = t.address and x.at <= now() - interval '6 hours' order by x.at desc, x.id desc limit 1),
               (select price_hype from public.ely_trades x where x.token = t.address and x.at > now() - interval '6 hours' order by x.at asc, x.id asc limit 1)) as p6
    from public.ely_tokens t where t.last_trade_at > now() - interval '30 hours'
  ),
  v as (
    select ref.token, coalesce(w.v5, 0) as v5, coalesce(w.v1, 0) as v1, coalesce(w.v6, 0) as v6,
      case when ref.p5 > 0 then (ref.price_hype - ref.p5) / ref.p5 * 100 end as c5,
      case when ref.p1 > 0 then (ref.price_hype - ref.p1) / ref.p1 * 100 end as c1,
      case when ref.p6 > 0 then (ref.price_hype - ref.p6) / ref.p6 * 100 end as c6
    from ref left join w on w.token = ref.token
  )
  update public.ely_tokens t set vol5m_hype = v.v5, vol1h_hype = v.v1, vol6h_hype = v.v6, change5m = v.c5, change1h = v.c1, change6h = v.c6
  from v
  where t.address = v.token
    and (t.vol5m_hype is distinct from v.v5 or t.vol1h_hype is distinct from v.v1 or t.vol6h_hype is distinct from v.v6
      or abs(coalesce(t.change5m, 0) - coalesce(v.c5, 0)) > 0.05 or abs(coalesce(t.change1h, 0) - coalesce(v.c1, 0)) > 0.05
      or abs(coalesce(t.change6h, 0) - coalesce(v.c6, 0)) > 0.05
      or (t.change5m is null) <> (v.c5 is null) or (t.change1h is null) <> (v.c1 is null) or (t.change6h is null) <> (v.c6 is null));
  update public.ely_tokens set vol5m_hype = 0, vol1h_hype = 0, vol6h_hype = 0, change5m = 0, change1h = 0, change6h = 0
  where (last_trade_at is null or last_trade_at <= now() - interval '30 hours') and (vol6h_hype <> 0 or change6h is distinct from 0);
$$;

select 'ok' as db_034;
