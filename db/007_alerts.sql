-- ArkhamPad: price alerts, notifications (the bell) and web push subscriptions.
-- Only the relayer reads and writes these (no public access). Safe to run again.
create table if not exists public.price_alerts (
  id         bigserial primary key,
  "user"     text not null,
  chain_id   integer not null,
  coin       text not null,
  tick       text not null,
  direction  text not null check (direction in ('above', 'below')),
  target_mc  numeric not null,
  status     text not null default 'open' check (status in ('open', 'hit', 'deleted')),
  created_at timestamptz not null default now(),
  hit_at     timestamptz
);
create index if not exists price_alerts_open_idx on public.price_alerts (status) where status = 'open';
create index if not exists price_alerts_user_idx on public.price_alerts ("user", created_at desc);
alter table public.price_alerts enable row level security;

create table if not exists public.notifications (
  id         bigserial primary key,
  "user"     text not null,
  kind       text not null,          -- price, order, follow, graduated
  title      text not null,
  body       text not null,
  url        text not null default '/',
  read       boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_idx on public.notifications ("user", created_at desc);
alter table public.notifications enable row level security;

create table if not exists public.push_subs (
  endpoint   text primary key,
  "user"     text not null,
  keys       jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists push_subs_user_idx on public.push_subs ("user");
alter table public.push_subs enable row level security;
