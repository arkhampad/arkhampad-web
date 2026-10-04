-- ArkhamPad: automatic orders (limit buy, take profit, stop loss).
-- The user signs the trade up front; the relayer sends it when the price is right.
-- Only the relayer reads and writes this table (no public access).
create table if not exists public.orders (
  id           bigserial primary key,
  chain_id     integer not null,
  "user"       text    not null,
  coin         text    not null,
  kind         text    not null check (kind in ('limit_buy', 'take_profit', 'stop_loss')),
  venue        text    not null check (venue in ('curve', 'pool')),
  trigger_mc   numeric not null,            -- market cap (USD) that triggers the order
  amount       numeric not null,            -- USDC for buys, coins for sells
  body         jsonb   not null,            -- the signed request, sent as-is when triggered
  nonce        text    not null,
  deadline     timestamptz not null,
  status       text    not null default 'open' check (status in ('open', 'filled', 'cancelled', 'expired', 'failed')),
  tries        integer not null default 0,
  note         text,
  tx_hash      text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists orders_open_idx on public.orders (chain_id, status) where status = 'open';
create index if not exists orders_user_idx on public.orders ("user", created_at desc);
create unique index if not exists orders_nonce_idx on public.orders (chain_id, "user", nonce);
alter table public.orders enable row level security;
