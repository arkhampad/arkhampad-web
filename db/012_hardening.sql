-- ArkhamPad 012: security hardening before mainnet. Run once in Supabase. Safe to run again.
-- transfer_sync is internal (indexer only): no public access at all.
alter table public.transfer_sync enable row level security;
revoke all on public.transfer_sync from anon, authenticated;
