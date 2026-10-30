-- ArkhamPad referrals: share arkhampad.com/?r=CODE; you earn 20% of ArkhamPad's fee share (0.14% of volume)
-- on every trade your invitees make on coins launched on ArkhamPad, paid in HYPE every 30 minutes by
-- the keeper. A code is the first 8 hex characters of the wallet address. An invitee proves the invite
-- with a free signature (checked by the indexer), so nobody can claim someone else as theirs.

create table if not exists public.ely_ref_codes (
  code     text primary key,
  address  text not null unique,
  at       timestamptz not null default now()
);
create table if not exists public.ely_ref_claims (
  user_addr text primary key,
  code      text not null,
  sig       text not null,
  at        timestamptz not null default now(),
  ok        boolean
);
create table if not exists public.ely_refs (
  user_addr text primary key,
  referrer  text not null,
  at        timestamptz not null default now()
);
create index if not exists ely_refs_referrer_idx on public.ely_refs (referrer);
create table if not exists public.ely_ref_paid (
  referrer   text primary key,
  paid_hype  double precision not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.ely_ref_codes enable row level security;
alter table public.ely_ref_claims enable row level security;
alter table public.ely_refs enable row level security;
alter table public.ely_ref_paid enable row level security;
revoke all on public.ely_ref_codes, public.ely_ref_claims, public.ely_refs, public.ely_ref_paid from anon, authenticated;

-- register your own code (it can only ever be the start of your address)
create or replace function public.ely_ref_code(p_addr text) returns text
language plpgsql security definer set search_path = public as $$
declare a text := lower(p_addr); c text;
begin
  if a !~ '^0x[0-9a-f]{40}$' then return null; end if;
  c := substr(a, 3, 8);
  insert into ely_ref_codes (code, address) values (c, a) on conflict do nothing;
  return c;
end $$;

-- an invitee's signed claim; the indexer checks the signature before it counts
create or replace function public.ely_ref_claim(p_user text, p_code text, p_sig text) returns boolean
language plpgsql security definer set search_path = public as $$
declare u text := lower(p_user); c text := lower(p_code);
begin
  if u !~ '^0x[0-9a-f]{40}$' or c !~ '^[0-9a-f]{8}$' or p_sig !~ '^0x[0-9a-f]{130}$' then return false; end if;
  if exists (select 1 from ely_refs where user_addr = u) then return false; end if;
  if exists (select 1 from ely_ref_codes where code = c and address = u) then return false; end if; -- not yourself
  insert into ely_ref_claims (user_addr, code, sig) values (u, c, p_sig)
    on conflict (user_addr) do update set code = excluded.code, sig = excluded.sig, at = now(), ok = null
    where ely_ref_claims.ok is not true;
  return true;
end $$;

-- what a referrer sees on their You page
create or replace function public.ely_ref_stats(p_addr text) returns jsonb
language sql security definer stable set search_path = public as $$
  with r as (select user_addr, at from ely_refs where referrer = lower(p_addr)),
  v as (
    select coalesce(sum(t.hype), 0) as vol
    from ely_trades t join r on r.user_addr = t.trader and t.at >= r.at
    join ely_tokens k on k.address = t.token and k.ours
  )
  select jsonb_build_object(
    'invited', (select count(*) from r),
    'volume', (select vol from v),
    'earned', (select vol from v) * 0.0014,
    'paid', coalesce((select paid_hype from ely_ref_paid where referrer = lower(p_addr)), 0)
  );
$$;

grant execute on function public.ely_ref_code(text), public.ely_ref_claim(text, text, text), public.ely_ref_stats(text) to anon, authenticated;
