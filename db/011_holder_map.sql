-- ArkhamPad 011: token transfers + holder map (who holds a coin and how wallets connect).
-- Run once in Supabase (SQL Editor -> New query -> paste -> Run) BEFORE uploading update-53. Safe to run again.

create table if not exists public.coin_transfers (
  chain_id   integer not null,
  coin       text    not null,          -- coin address, lowercase
  tx_hash    text    not null,
  log_index  integer not null,
  "from"     text    not null,
  "to"       text    not null,
  amount     numeric not null,          -- whole tokens
  block      bigint  not null,
  primary key (chain_id, tx_hash, log_index)
);
create index if not exists coin_transfers_coin_idx on public.coin_transfers (chain_id, coin, block);
alter table public.coin_transfers enable row level security;
drop policy if exists "public read" on public.coin_transfers;
create policy "public read" on public.coin_transfers for select using (true);
grant select on public.coin_transfers to anon, authenticated;

-- backfill progress for transfers that happened before this update
create table if not exists public.transfer_sync (
  chain_id    integer primary key,
  hub         text    not null,
  next_block  bigint  not null,   -- next block the backfill will read
  until_block bigint  not null,   -- live indexing covers everything after this
  done        boolean not null default false
);

-- Holder map for one coin: top holders with balances, buy/sell totals, first buy,
-- and the token transfers between those holders (the links on the map).
create or replace function public.coin_holder_graph(p_chain integer, p_coin text, p_exclude text[] default '{}')
returns json language sql stable security definer set search_path = public as $$
  with c as (
    select address, curve, creator, phase from coins where chain_id = p_chain and address = lower(p_coin)
  ),
  has_tx as (select exists (select 1 from coin_transfers t where t.chain_id = p_chain and t.coin = lower(p_coin)) as yes),
  -- balances from transfers when we have them, otherwise from curve trades
  bal_tx as (
    select w as wallet, sum(d) as bal from (
      select "to" as w, amount as d from coin_transfers where chain_id = p_chain and coin = lower(p_coin)
      union all
      select "from", -amount from coin_transfers where chain_id = p_chain and coin = lower(p_coin)
    ) x group by w
  ),
  bal_tr as (
    select trader as wallet, sum(case when is_buy then coins else -coins end) as bal
    from trades where chain_id = p_chain and coin = lower(p_coin) group by trader
  ),
  bal as (
    select * from bal_tx where (select yes from has_tx)
    union all
    select * from bal_tr where not (select yes from has_tx)
  ),
  stats as (
    select trader as wallet,
           sum(case when is_buy then usdc else 0 end) as bought,
           sum(case when is_buy then 0 else usdc end) as sold,
           min(case when is_buy then ts end) as first_ts,
           min(case when is_buy then block end) as first_block
    from trades where chain_id = p_chain and coin = lower(p_coin) group by trader
  ),
  top as (
    select b.wallet, b.bal, s.bought, s.sold, s.first_ts, s.first_block
    from bal b left join stats s on s.wallet = b.wallet
    where b.bal > 0.000001
      and b.wallet not in ('0x0000000000000000000000000000000000000000', '0x000000000000000000000000000000000000dead')
      and not (b.wallet = any (select lower(unnest(p_exclude))))
    order by b.bal desc limit 150
  ),
  links as (
    select least("from","to") as a, greatest("from","to") as b, sum(amount) as amount, count(*) as n
    from coin_transfers
    where chain_id = p_chain and coin = lower(p_coin)
      and "from" in (select wallet from top) and "to" in (select wallet from top)
      and "from" <> (select curve from c) and "to" <> (select curve from c)
    group by 1, 2
  )
  select json_build_object(
    'coin', (select address from c), 'curve', (select curve from c), 'creator', (select creator from c), 'phase', (select phase from c),
    'launch_block', (select created_block from coins where chain_id = p_chain and address = lower(p_coin)),
    'launch_ts', (select created_at from coins where chain_id = p_chain and address = lower(p_coin)),
    'from_transfers', (select yes from has_tx),
    'holders_total', (select count(*) from bal where bal > 0.000001),
    'holders', coalesce((select json_agg(json_build_object('w', wallet, 'bal', bal, 'bought', coalesce(bought, 0), 'sold', coalesce(sold, 0), 'first_ts', first_ts, 'first_block', first_block) order by bal desc) from top), '[]'::json),
    'links', coalesce((select json_agg(json_build_object('a', a, 'b', b, 'amount', amount, 'n', n)) from links), '[]'::json)
  );
$$;
grant execute on function public.coin_holder_graph(integer, text, text[]) to anon, authenticated;
