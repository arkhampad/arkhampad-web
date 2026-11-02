-- 030: Elysium airdrop points + leaderboard.
-- Built entirely from data the indexer already writes: ely_trades (every buy/sell, with its HYPE
-- size and the trader) and ely_tokens (every coin, with its creator). Genesis NFT holders get 2x;
-- ely_genesis is filled by the indexer once the Genesis contract address is wired (empty = 1x for all).
-- Read-only, additive — safe to run again. Run once in Supabase: SQL Editor -> New query -> paste -> Run.

-- Points formula (change the two numbers here to retune later):
--   points = (volume_in_HYPE + launches * 50) * (genesis ? 2 : 1)

create table if not exists public.ely_genesis (
  holder     text primary key,            -- lowercased wallet that holds an ArkhamPad Genesis NFT
  minted_at  timestamptz not null default now()
);

create or replace function public.ely_points(p_limit int default 100, p_wallet text default null)
returns table (
  wallet    text,
  volume    double precision,
  trades    bigint,
  launches  bigint,
  genesis   boolean,
  points    double precision,
  rank      bigint
) language sql stable as $$
  with vol as (
    select lower(trader) as wallet, coalesce(sum(hype), 0) as volume, count(*) as trades
    from public.ely_trades
    where trader is not null
    group by lower(trader)
  ),
  lau as (
    select lower(creator) as wallet, count(*) as launches
    from public.ely_tokens
    where creator is not null and ours = true
    group by lower(creator)
  ),
  merged as (
    select
      coalesce(v.wallet, l.wallet) as wallet,
      coalesce(v.volume, 0)        as volume,
      coalesce(v.trades, 0)        as trades,
      coalesce(l.launches, 0)      as launches,
      (g.holder is not null)       as genesis
    from vol v
    full outer join lau l on l.wallet = v.wallet
    left join public.ely_genesis g on g.holder = coalesce(v.wallet, l.wallet)
  ),
  scored as (
    select *, (volume + launches * 50) * (case when genesis then 2 else 1 end) as points
    from merged
  ),
  ranked as (
    select *, row_number() over (order by points desc, volume desc) as rank
    from scored
  )
  select wallet, volume, trades, launches, genesis, points, rank
  from ranked
  where (p_wallet is null or wallet = lower(p_wallet))
  order by rank
  limit case when p_wallet is null then p_limit else 1 end;
$$;
