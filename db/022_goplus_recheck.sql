-- 022: coins whose GoPlus safety answer came back empty (the free tier answered only the first coin
-- of each batch) are checked again right away, one coin per call.
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run again.
update public.ext_tokens
set gp_checked_at = null
where chain_id in (8453, 56)
  and gp_checked_at is not null
  and honeypot is null and sell_tax is null and top10_pct is null;
