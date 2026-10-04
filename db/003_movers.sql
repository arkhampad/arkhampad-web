-- ArkhamPad: short-term market data so the front page shows what is moving right now.
-- Run once in Supabase SQL Editor (before the indexer update). Safe to run again.
alter table public.ext_tokens add column if not exists change_5m numeric;
alter table public.ext_tokens add column if not exists vol_1h numeric;
alter table public.ext_tokens add column if not exists txns_5m integer;
create index if not exists ext_tokens_vol1h_idx on public.ext_tokens (vol_1h desc nulls last);
