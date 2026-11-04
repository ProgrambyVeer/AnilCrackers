create schema interest_security;
revoke all on schema interest_security from public, anon, authenticated;

create table interest_security.rate_buckets (
  scope text not null,
  key_hash text not null check (key_hash ~ '^[0-9a-f]{64}$'),
  window_start timestamptz not null,
  attempts integer not null check (attempts > 0),
  expires_at timestamptz not null,
  primary key (scope, key_hash, window_start)
);

create table interest_security.used_captcha (
  token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null
);

create index rate_buckets_expiry_idx on interest_security.rate_buckets (expires_at);
create index used_captcha_expiry_idx on interest_security.used_captcha (expires_at);
alter table interest_security.rate_buckets enable row level security;
alter table interest_security.used_captcha enable row level security;
revoke all on interest_security.rate_buckets, interest_security.used_captcha
  from public, anon, authenticated, service_role;

create function public.consume_interest_rate_limit(p_ip_hash text, p_phone_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_scope text;
  v_key text;
  v_seconds integer;
  v_limit integer;
  v_start timestamptz;
  v_attempts integer;
begin
  if p_ip_hash is null or p_ip_hash !~ '^[0-9a-f]{64}$'
     or p_phone_hash is null or p_phone_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid rate-limit key.' using errcode = '22023';
  end if;

  delete from interest_security.rate_buckets
  where ctid in (
    select ctid from interest_security.rate_buckets
    where expires_at < v_now order by expires_at limit 200
    for update skip locked
  );

  -- Every instance uses the same primary-key rows. UPSERT locks serialize counts.
  for v_scope, v_key, v_seconds, v_limit in
    select scope, key_hash, seconds, max_attempts from (values
      (1, 'ip-minute', p_ip_hash, 60, 3),
      (2, 'ip-hour', p_ip_hash, 3600, 20),
      (3, 'phone-hour', p_phone_hash, 3600, 5)
    ) as limits(priority, scope, key_hash, seconds, max_attempts)
    order by priority
  loop
    v_start := to_timestamp(floor(extract(epoch from v_now) / v_seconds) * v_seconds);
    insert into interest_security.rate_buckets (scope, key_hash, window_start, attempts, expires_at)
    values (v_scope, v_key, v_start, 1, v_start + make_interval(secs => v_seconds))
    on conflict (scope, key_hash, window_start) do update
      set attempts = least(interest_security.rate_buckets.attempts + 1, v_limit + 1)
    returning attempts into v_attempts;

    if v_attempts > v_limit then
      return jsonb_build_object(
        'allowed', false,
        'retry_after', greatest(1, ceil(extract(epoch from v_start + make_interval(secs => v_seconds) - v_now))::integer)
      );
    end if;
  end loop;

  return jsonb_build_object('allowed', true, 'retry_after', 0);
end;
$$;

create function public.claim_interest_captcha(p_token_hash text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inserted integer;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid CAPTCHA key.' using errcode = '22023';
  end if;

  delete from interest_security.used_captcha
  where ctid in (
    select ctid from interest_security.used_captcha
    where expires_at < clock_timestamp() order by expires_at limit 200
    for update skip locked
  );
  insert into interest_security.used_captcha (token_hash, expires_at)
  values (p_token_hash, clock_timestamp() + interval '15 minutes')
  on conflict (token_hash) do nothing;
  get diagnostics v_inserted = row_count;
  return v_inserted = 1;
end;
$$;

revoke all on function public.consume_interest_rate_limit(text, text) from public, anon, authenticated;
revoke all on function public.claim_interest_captcha(text) from public, anon, authenticated;
revoke all on function public.submit_interest(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.consume_interest_rate_limit(text, text) to service_role;
grant execute on function public.claim_interest_captcha(text) to service_role;
grant execute on function public.submit_interest(text, text, jsonb) to service_role;
