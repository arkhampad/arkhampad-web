-- 023: wider other-DEX listing (new coins allowed, no socials or holder-spread rule) and the market cap
-- each coin had when ArkhamPad first listed it, plus a health score that orders the Trending list.
-- Run once in Supabase BEFORE uploading the package: SQL Editor -> New query -> paste -> Run. Safe to run again.
alter table public.ext_tokens add column if not exists first_mc numeric;
alter table public.ext_tokens add column if not exists listed_at timestamptz;
alter table public.ext_tokens add column if not exists score numeric;
create index if not exists ext_tokens_score_idx on public.ext_tokens (score desc nulls last) where listed;
