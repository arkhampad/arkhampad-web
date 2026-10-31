-- 031: Early rank for the share card on "You". Your rank = the order in which you first used ArkhamPad
-- (first trade on an ArkhamPad coin, or first coin launched here), among everyone who has.
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run again.
create or replace function public.ely_early(p_addr text) returns jsonb
language sql security definer stable set search_path = public as $$
  with acts as (
    select lower(t.trader) as a, min(t.at) as f
    from ely_trades t join ely_tokens k on k.address = t.token and k.ours
    where t.trader is not null
    group by lower(t.trader)
    union all
    select lower(creator), min(created_at) from ely_tokens
    where ours and creator is not null and created_at is not null
    group by lower(creator)
  ),
  firsts as (select a, min(f) as f from acts group by a),
  me as (select f from firsts where a = lower(p_addr))
  select jsonb_build_object(
    'rank', case when (select f from me) is null then null
                 else (select count(*) from firsts where f < (select f from me)) + 1 end,
    'total', (select count(*) from firsts),
    'since', (select f from me)
  );
$$;
grant execute on function public.ely_early(text) to anon, authenticated;
