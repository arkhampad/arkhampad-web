-- ArkhamPad 009: AI features + testnet redeploy.
-- Run once in Supabase (SQL Editor -> New query -> paste -> Run) BEFORE uploading update-47. Safe to run again.

-- 1) Spam filter: scam/spam comments are kept but hidden behind a notice on the coin page.
alter table public.comments add column if not exists hidden boolean not null default false;
alter table public.comments add column if not exists hidden_reason text;

-- 2) The indexer remembers which hub (deployment) it follows. When the hub changes,
--    it removes the old deployment's coins, trades, orders, alerts and comments for
--    that chain once, then indexes the new hub from its first block.
alter table public.sync_state add column if not exists hub text;

-- read access stays the same (comments: everyone reads, only the relayer writes)
grant select on public.comments to anon, authenticated;
