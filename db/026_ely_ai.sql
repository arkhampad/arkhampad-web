-- Daily limit for the "coin idea from Elysium trends" AI helper (10 per visitor per day).
-- The table is private; the site's /api/ely-idea function counts through ely_ai_take().
create table if not exists ely_ai_use (
  k    text not null,
  day  date not null default (now() at time zone 'utc')::date,
  n    integer not null default 0,
  primary key (k, day)
);
alter table ely_ai_use enable row level security;

create or replace function ely_ai_take(p_key text) returns integer
language plpgsql security definer set search_path = public as $$
declare v integer;
begin
  insert into ely_ai_use (k, day, n) values (left(p_key, 80), (now() at time zone 'utc')::date, 1)
  on conflict (k, day) do update set n = ely_ai_use.n + 1
  returning n into v;
  delete from ely_ai_use where day < (now() at time zone 'utc')::date - 2;
  return v;
end $$;
grant execute on function ely_ai_take(text) to anon, authenticated;

-- Network stats for the Stats page: one JSON blob, rebuilt by the indexer every 5 minutes into
-- ely_meta('stats'), so visitors never run heavy queries.
create or replace function public.ely_stats() returns jsonb
language sql stable as $$
  with t as (
    select address, name, symbol, image, created_at, ours,
           case when ours then 'ArkhamPad' else coalesce(launchpad, 'Other') end as pad
    from public.ely_tokens where pool is not null
  ),
  tr as (
    select x.at, x.hype, x.trader, x.token, t.pad, t.ours
    from public.ely_trades x join t on t.address = x.token
  ),
  days as (
    select generate_series((now() at time zone 'utc')::date - 29, (now() at time zone 'utc')::date, interval '1 day')::date as d
  ),
  daily as (
    select d.d,
           coalesce(sum(tr.hype), 0) as vol,
           count(tr.at) as trades,
           count(distinct tr.trader) as traders,
           coalesce(sum(tr.hype) filter (where tr.ours), 0) as ours_vol,
           (select count(*) from t where (t.created_at at time zone 'utc')::date = d.d) as new_tokens,
           (select count(*) from t where t.ours and (t.created_at at time zone 'utc')::date = d.d) as new_ours
    from days d left join tr on (tr.at at time zone 'utc')::date = d.d
    group by d.d order by d.d
  ),
  hours as (
    select generate_series(date_trunc('hour', now()) - interval '47 hours', date_trunc('hour', now()), interval '1 hour') as h
  ),
  hourly as (
    select h.h, coalesce(sum(tr.hype), 0) as vol, count(tr.at) as trades
    from hours h left join tr on date_trunc('hour', tr.at) = h.h
    group by h.h order by h.h
  ),
  pads as (
    select pad,
           coalesce(sum(hype) filter (where at > now() - interval '24 hours'), 0) as vol_24h,
           coalesce(sum(hype) filter (where at > now() - interval '7 days'), 0) as vol_7d,
           count(*) filter (where at > now() - interval '24 hours') as trades_24h
    from tr group by pad
  ),
  padtokens as (select pad, count(*) as tokens from t group by pad),
  top as (
    select t.address, t.name, t.symbol, t.image, t.pad, t.ours, sum(tr.hype) as vol_7d, count(*) as trades_7d
    from tr join t on t.address = tr.token
    where tr.at > now() - interval '7 days'
    group by t.address, t.name, t.symbol, t.image, t.pad, t.ours
    order by vol_7d desc limit 10
  )
  select jsonb_build_object(
    'updated', now(),
    'tokens', (select count(*) from t),
    'tokens_ours', (select count(*) from t where ours),
    'holders', (select count(distinct holder) from public.ely_balances where amount > 0),
    'trades_all', (select count(*) from tr),
    'trades_24h', (select count(*) from tr where at > now() - interval '24 hours'),
    'traders_24h', (select count(distinct trader) from tr where at > now() - interval '24 hours'),
    'traders_all', (select count(distinct trader) from tr),
    'vol_all', (select coalesce(sum(hype), 0) from tr),
    'vol_24h', (select coalesce(sum(hype), 0) from tr where at > now() - interval '24 hours'),
    'vol_7d', (select coalesce(sum(hype), 0) from tr where at > now() - interval '7 days'),
    'ours', jsonb_build_object(
      'coins', (select count(*) from t where ours),
      'vol_all', (select coalesce(sum(hype), 0) from tr where ours),
      'vol_24h', (select coalesce(sum(hype), 0) from tr where ours and at > now() - interval '24 hours'),
      'creator_fees', (select coalesce(sum(hype), 0) * 0.003 from tr where ours)
    ),
    'daily', (select coalesce(jsonb_agg(jsonb_build_object('d', d, 'vol', vol, 'trades', trades, 'traders', traders, 'ours_vol', ours_vol, 'new_tokens', new_tokens, 'new_ours', new_ours) order by d), '[]') from daily),
    'hourly', (select coalesce(jsonb_agg(jsonb_build_object('h', h, 'vol', vol, 'trades', trades) order by h), '[]') from hourly),
    'pads', (select coalesce(jsonb_agg(jsonb_build_object('name', p.pad, 'vol_24h', p.vol_24h, 'vol_7d', p.vol_7d, 'trades_24h', p.trades_24h, 'tokens', coalesce(pt.tokens, 0)) order by p.vol_7d desc), '[]') from pads p left join padtokens pt on pt.pad = p.pad),
    'top', (select coalesce(jsonb_agg(to_jsonb(top) order by vol_7d desc), '[]') from top)
  );
$$;

create or replace function public.ely_save_stats() returns void
language sql as $$
  insert into public.ely_meta (k, v, updated_at) values ('stats', public.ely_stats(), now())
  on conflict (k) do update set v = excluded.v, updated_at = now();
$$;
