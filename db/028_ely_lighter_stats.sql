-- Lighter stats refresh (cuts Supabase disk reads a lot). The old version re-read the whole trade
-- history and rewrote every token row every 30 seconds. This one only looks at tokens that traded in
-- the last 24 hours (using the indexes), and touches other rows only when their dollar value moved.
create or replace function public.ely_refresh_stats(hype_usd double precision) returns void
language plpgsql as $$
begin
  with act as (
    select distinct token from public.ely_trades where at > now() - interval '24 hours'
    union
    select address from public.ely_tokens where vol24_hype > 0 or buys24 > 0 or sells24 > 0
  ),
  day as (
    select token, sum(hype) as vol, count(*) filter (where side = 'buy') as buys, count(*) filter (where side = 'sell') as sells
    from public.ely_trades where at > now() - interval '24 hours' group by token
  ),
  s as (
    select a.token,
      (select x.price_hype from public.ely_trades x where x.token = a.token order by x.at desc limit 1) as last_p,
      (select x.at from public.ely_trades x where x.token = a.token order by x.at desc limit 1) as last_at,
      (select x.price_hype from public.ely_trades x where x.token = a.token and x.at <= now() - interval '24 hours' order by x.at desc limit 1) as before_p,
      (select x.price_hype from public.ely_trades x where x.token = a.token and x.at > now() - interval '24 hours' order by x.at asc limit 1) as first_p,
      (select count(*) from public.ely_balances b where b.token = a.token and b.amount > 0) as holders,
      (select sum(z.amount) from (select b.amount from public.ely_balances b where b.token = a.token and b.amount > 0 order by b.amount desc limit 10) z) as top10
    from act a
  )
  update public.ely_tokens t set
    price_hype = coalesce(s.last_p, t.price_hype),
    mcap_hype = coalesce(s.last_p, t.price_hype) * t.supply / power(10, t.decimals),
    mcap_usd = coalesce(s.last_p, t.price_hype) * t.supply / power(10, t.decimals) * hype_usd,
    vol24_hype = coalesce(day.vol, 0),
    buys24 = coalesce(day.buys, 0),
    sells24 = coalesce(day.sells, 0),
    change24 = case when coalesce(s.before_p, s.first_p) > 0
                    then (coalesce(s.last_p, t.price_hype) - coalesce(s.before_p, s.first_p)) / coalesce(s.before_p, s.first_p) * 100 end,
    holders = s.holders,
    top10_pct = case when t.supply > 0 then coalesce(s.top10, 0) / t.supply * 100 end,
    last_trade_at = coalesce(s.last_at, t.last_trade_at),
    updated_at = now()
  from s left join day on day.token = s.token
  where t.address = s.token;

  -- every other token: only its dollar value follows HYPE; write the row only when it moved over 1%
  update public.ely_tokens t set mcap_usd = t.mcap_hype * hype_usd
  where t.mcap_hype is not null and hype_usd > 0
    and (t.mcap_usd is null or abs(t.mcap_usd - t.mcap_hype * hype_usd) > 0.01 * t.mcap_hype * hype_usd);
end $$;
