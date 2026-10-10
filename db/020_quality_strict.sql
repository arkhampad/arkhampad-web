-- 020: stricter listing for coins from other DEXs (after a user sold a coin for cents).
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run again.
--
-- ext_tokens.has_socials        the coin has an X account or a website on DexScreener
-- ext_tokens.socials_checked_at when that was last looked up
-- ext_tokens.owner_risk         GoPlus: the owner can mint, pause, blacklist, change taxes or balances, or is hidden
-- ext_tokens.top10_pct          share of supply in the 10 biggest wallets (pools, locks and burn addresses left out)
-- ext_tokens.creator_pct        share of supply the creator still holds
-- ext_tokens.decimals           the coin's decimals (for the sell-route check)
-- ext_tokens.route_ok           KyberSwap can buy and sell it within 10% of its market price
-- ext_tokens.route_checked_at   when that was last checked
alter table public.ext_tokens add column if not exists has_socials boolean;
alter table public.ext_tokens add column if not exists socials_checked_at timestamptz;
alter table public.ext_tokens add column if not exists owner_risk boolean;
alter table public.ext_tokens add column if not exists top10_pct numeric;
alter table public.ext_tokens add column if not exists creator_pct numeric;
alter table public.ext_tokens add column if not exists decimals integer;
alter table public.ext_tokens add column if not exists route_ok boolean;
alter table public.ext_tokens add column if not exists route_checked_at timestamptz;

-- everything is checked again under the new rules
update public.ext_tokens set gp_checked_at = null;
