-- 018: live updates. The site listens for new trades (Supabase Realtime) so prices, charts,
-- lists and holdings refresh the moment a trade is indexed, instead of waiting for the next poll.
-- Safe to run more than once.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'trades'
  ) then
    alter publication supabase_realtime add table public.trades;
  end if;
end $$;
