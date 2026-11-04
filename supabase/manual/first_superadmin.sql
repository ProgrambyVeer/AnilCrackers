-- Run manually in the trusted Supabase SQL Editor only after all approved
-- Release 1 migrations are installed.
-- Do not run this from application code or a client-accessible RPC.
do $$
declare
  v_user_id uuid := null; -- Replace with the explicitly verified auth.users UUID.
  v_confirmation text := ''; -- Set to: PROVISION_FIRST_SUPERADMIN
  v_email text;
  v_display_name text;
begin
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Provisioning requires READ COMMITTED isolation so a waiting execution sees the committed administrator.';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(741620, 1);

  if v_user_id is null then
    raise exception 'Set the exact, verified Google auth.users UUID before provisioning.';
  end if;
  if v_confirmation <> 'PROVISION_FIRST_SUPERADMIN' then
    raise exception 'Set the explicit provisioning confirmation phrase before proceeding.';
  end if;

  select u.email, coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name')
    into v_email, v_display_name
  from auth.users u
  where u.id = v_user_id
    and u.email_confirmed_at is not null
    and u.raw_app_meta_data ->> 'provider' = 'google'
  for update;

  if not found then
    raise exception 'The UUID must identify a Google-authenticated user with a confirmed email.';
  end if;
  if exists (select 1 from public.profiles where role = 'superadmin') then
    raise exception 'A Super Admin already exists; preserve that account and do not provision another initial administrator.';
  end if;
  if exists (select 1 from public.profiles where id = v_user_id) then
    raise exception 'This user already has a profile; refusing to change or elevate its role.';
  end if;

  insert into public.profiles (id, display_name, role, is_active)
  values (v_user_id, coalesce(nullif(btrim(v_display_name), ''), v_email), 'superadmin', true);
end;
$$;
