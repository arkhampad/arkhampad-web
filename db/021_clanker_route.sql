-- 021: Clanker coins launched on other sites trade through ArkhamPad's own route (PadClankerRoute).
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run again.
--
-- ext_tokens.clanker_hook  the Clanker fee hook of the coin's pool (null: not a Clanker pool, KyberSwap is used)
-- ext_tokens.clanker_pool  that pool's id (the pool the route check passed on)
alter table public.ext_tokens add column if not exists clanker_hook text;
alter table public.ext_tokens add column if not exists clanker_pool text;

-- every coin's sell route is checked again (Clanker pools now through ArkhamPad's route)
update public.ext_tokens set route_checked_at = null;
