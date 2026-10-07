-- ArkhamPad: quality list for coins from other DEXs.
-- Run once in Supabase SQL Editor. Safe to run again.
--
-- The indexer checks every coin (can it be sold, taxes) and marks up to ~5,000
-- active, liquid, safe coins as "listed". The site shows only listed coins in
-- its lists; any coin can still be opened by its address.

alter table public.ext_tokens add column if not exists gp_checked_at timestamptz;
alter table public.ext_tokens add column if not exists honeypot boolean;
alter table public.ext_tokens add column if not exists cannot_sell boolean;
alter table public.ext_tokens add column if not exists buy_tax numeric;
alter table public.ext_tokens add column if not exists sell_tax numeric;
alter table public.ext_tokens add column if not exists has_profile boolean not null default false;
alter table public.ext_tokens add column if not exists listed boolean not null default false;

create index if not exists ext_tokens_listed_vol_idx on public.ext_tokens (vol_24h desc nulls last) where listed;
create index if not exists ext_tokens_unchecked_idx on public.ext_tokens (chain_id, vol_24h desc nulls last) where gp_checked_at is null;
