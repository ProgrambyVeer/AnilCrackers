create type public.vendor_application_status as enum ('pending', 'approved', 'rejected', 'suspended');

alter table public.products
  add column stock_quantity integer not null default 0 check (stock_quantity >= 0),
  add column low_stock_threshold integer not null default 5 check (low_stock_threshold >= 0),
  add column vendor_id uuid references public.profiles (id) on delete set null;

update public.products
set vendor_id = (
  select p.id
  from public.profiles p
  where p.role = 'vendor'
  order by p.created_at, p.id
  limit 1
)
where vendor_id is null;

create index products_vendor_stock_idx
  on public.products (vendor_id, stock_quantity, is_active);

create table public.vendor_applications (
  id uuid primary key references auth.users (id) on delete cascade,
  business_name text not null check (char_length(btrim(business_name)) between 2 and 160),
  owner_name text not null check (char_length(btrim(owner_name)) between 2 and 100),
  phone text not null check (phone = '' or char_length(phone) between 8 and 24),
  email text not null check (email = '' or char_length(email) between 3 and 254),
  location text not null check (char_length(btrim(location)) between 2 and 300),
  status public.vendor_application_status not null default 'pending',
  rejection_reason text check (rejection_reason is null or char_length(btrim(rejection_reason)) between 2 and 1000),
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (status in ('pending', 'approved', 'suspended') and rejection_reason is null)
    or (status = 'rejected' and rejection_reason is not null)
  )
);

create index vendor_applications_status_date_idx
  on public.vendor_applications (status, submitted_at desc);

create table public.vendor_application_events (
  id bigint generated always as identity primary key,
  application_id uuid not null references public.vendor_applications (id) on delete cascade,
  actor_id uuid references public.profiles (id) on delete set null,
  action text not null check (action in ('submitted', 'resubmitted', 'approved', 'rejected', 'suspended', 'reactivated')),
  reason text check (reason is null or char_length(reason) <= 1000),
  created_at timestamptz not null default now()
);

create index vendor_application_events_application_date_idx
  on public.vendor_application_events (application_id, created_at desc);

insert into public.vendor_applications (
  id, business_name, owner_name, phone, email, location, status, submitted_at, reviewed_at
)
select
  p.id,
  coalesce(nullif(btrim(p.display_name), ''), 'Existing vendor'),
  coalesce(nullif(btrim(p.display_name), ''), 'Existing vendor'),
  '',
  coalesce(u.email, ''),
  'Location not provided',
  case when p.is_active then 'approved'::public.vendor_application_status else 'suspended'::public.vendor_application_status end,
  p.created_at,
  null
from public.profiles p
join auth.users u on u.id = p.id
where p.role = 'vendor'
on conflict (id) do nothing;

create function public.is_approved_vendor()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    join public.vendor_applications a on a.id = p.id
    where p.id = (select auth.uid())
      and p.role = 'vendor'
      and p.is_active
      and a.status = 'approved'
  );
$$;

revoke all on function public.is_approved_vendor() from public;
grant execute on function public.is_approved_vendor() to anon, authenticated;

alter table public.vendor_applications enable row level security;
alter table public.vendor_application_events enable row level security;

create policy "Applicants and Super Admin can read vendor applications"
on public.vendor_applications for select to authenticated
using (id = (select auth.uid()) or public.is_superadmin());

create policy "Applicants and Super Admin can read application history"
on public.vendor_application_events for select to authenticated
using (
  public.is_superadmin()
  or exists (
    select 1 from public.vendor_applications a
    where a.id = application_id and a.id = (select auth.uid())
  )
);

revoke all on public.vendor_applications, public.vendor_application_events from public, anon, authenticated;
grant select on public.vendor_applications, public.vendor_application_events to authenticated;

create function public.submit_vendor_application(
  p_business_name text,
  p_owner_name text,
  p_phone text,
  p_location text
)
returns public.vendor_applications
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := auth.uid();
  v_email text := lower(btrim(coalesce(auth.jwt() ->> 'email', '')));
  v_application public.vendor_applications;
  v_resubmission boolean := exists (
    select 1 from public.vendor_applications a
    where a.id = auth.uid() and a.status = 'rejected'
  );
begin
  if v_id is null or v_email = ''
     or coalesce(auth.jwt() -> 'app_metadata' ->> 'provider', '') <> 'google' then
    raise exception 'Sign in with Google before applying.' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.profiles p where p.id = v_id
  ) then
    raise exception 'An account with an assigned staff role cannot submit a vendor application.' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_business_name, ''))) not between 2 and 160
     or char_length(btrim(coalesce(p_owner_name, ''))) not between 2 and 100
     or char_length(btrim(coalesce(p_phone, ''))) not between 8 and 24
     or char_length(btrim(coalesce(p_location, ''))) not between 2 and 300 then
    raise exception 'Complete all vendor application fields with valid values.' using errcode = '22023';
  end if;

  insert into public.vendor_applications (id, business_name, owner_name, phone, email, location)
  values (v_id, btrim(p_business_name), btrim(p_owner_name), btrim(p_phone), v_email, btrim(p_location))
  on conflict (id) do update
    set business_name = excluded.business_name,
        owner_name = excluded.owner_name,
        phone = excluded.phone,
        email = excluded.email,
        location = excluded.location,
        status = 'pending',
        rejection_reason = null,
        submitted_at = now(),
        reviewed_at = null,
        reviewed_by = null,
        updated_at = now()
    where vendor_applications.status = 'rejected'
  returning * into v_application;

  if not found then
    raise exception 'An application is already pending or approved for this account.' using errcode = '23505';
  end if;

  insert into public.vendor_application_events (application_id, actor_id, action)
  values (v_id, null, case when v_resubmission then 'resubmitted' else 'submitted' end);

  return v_application;
end;
$$;

create function public.approve_vendor_application(p_application_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_application public.vendor_applications;
begin
  if not public.is_superadmin() then
    raise exception 'Only an active Super Admin can approve vendor applications.' using errcode = '42501';
  end if;

  select * into v_application
  from public.vendor_applications
  where id = p_application_id and status = 'pending'
  for update;
  if not found then
    raise exception 'The vendor application is not pending.' using errcode = '22023';
  end if;
  if exists (select 1 from public.profiles p where p.id = p_application_id and p.role = 'superadmin') then
    raise exception 'A Super Admin account cannot be converted into a vendor account.' using errcode = '42501';
  end if;

  insert into public.profiles (id, display_name, role, is_active)
  values (p_application_id, v_application.owner_name, 'vendor', true)
  on conflict (id) do update
    set display_name = excluded.display_name,
        role = 'vendor',
        is_active = true;

  update public.vendor_applications
  set status = 'approved', rejection_reason = null, reviewed_at = now(), reviewed_by = v_actor
  where id = p_application_id;

  update public.products
  set vendor_id = p_application_id
  where vendor_id is null
    and not exists (
      select 1 from public.products owned where owned.vendor_id is not null
    );

  insert into public.vendor_application_events (application_id, actor_id, action)
  values (p_application_id, v_actor, 'approved');
end;
$$;

create function public.reject_vendor_application(p_application_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
begin
  if not public.is_superadmin() then
    raise exception 'Only an active Super Admin can reject vendor applications.' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) not between 2 and 1000 then
    raise exception 'Provide a rejection reason between 2 and 1000 characters.' using errcode = '22023';
  end if;

  update public.vendor_applications
  set status = 'rejected', rejection_reason = btrim(p_reason), reviewed_at = now(), reviewed_by = v_actor
  where id = p_application_id and status = 'pending';
  if not found then
    raise exception 'The vendor application is not pending.' using errcode = '22023';
  end if;

  insert into public.vendor_application_events (application_id, actor_id, action, reason)
  values (p_application_id, v_actor, 'rejected', btrim(p_reason));
end;
$$;

create function public.set_vendor_access(p_vendor_id uuid, p_is_active boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_next_status public.vendor_application_status;
begin
  if not public.is_superadmin() then
    raise exception 'Only an active Super Admin can change vendor access.' using errcode = '42501';
  end if;
  if p_is_active is null then
    raise exception 'A vendor access state is required.' using errcode = '22023';
  end if;

  v_next_status := case when p_is_active then 'approved'::public.vendor_application_status else 'suspended'::public.vendor_application_status end;

  update public.profiles
  set is_active = p_is_active
  where id = p_vendor_id and role = 'vendor';
  if not found then
    raise exception 'The vendor profile does not exist.' using errcode = '22023';
  end if;

  update public.vendor_applications
  set status = v_next_status, reviewed_at = now(), reviewed_by = v_actor
  where id = p_vendor_id and status in ('approved', 'suspended');
  if not found then
    raise exception 'Only an approved vendor can be suspended or reactivated.' using errcode = '22023';
  end if;

  insert into public.vendor_application_events (application_id, actor_id, action)
  values (p_vendor_id, v_actor, case when p_is_active then 'reactivated' else 'suspended' end);
end;
$$;

revoke all on function public.submit_vendor_application(text, text, text, text) from public;
revoke all on function public.approve_vendor_application(uuid) from public;
revoke all on function public.reject_vendor_application(uuid, text) from public;
revoke all on function public.set_vendor_access(uuid, boolean) from public;
grant execute on function public.submit_vendor_application(text, text, text, text) to authenticated;
grant execute on function public.approve_vendor_application(uuid) to authenticated;
grant execute on function public.reject_vendor_application(uuid, text) to authenticated;
grant execute on function public.set_vendor_access(uuid, boolean) to authenticated;

drop policy "Public can read active products while the shop is active" on public.products;
drop policy "Vendor can add products" on public.products;
drop policy "Active staff can update product visibility and vendor catalogue" on public.products;
drop policy "Vendor can delete products" on public.products;

create policy "Public can read active catalogue products"
on public.products for select to anon
using (
  is_active
  and exists (select 1 from public.shop_settings s where s.id = 1 and s.is_active)
);

create policy "Staff can read owned products or admin catalogue"
on public.products for select to authenticated
using (public.is_superadmin() or (public.is_approved_vendor() and vendor_id = (select auth.uid())));

create policy "Approved vendors can insert their own products"
on public.products for insert to authenticated
with check (public.is_approved_vendor() and vendor_id = (select auth.uid()));

create policy "Vendors can update their own products; Super Admin can manage visibility"
on public.products for update to authenticated
using (
  public.is_superadmin()
  or (public.is_approved_vendor() and vendor_id = (select auth.uid()))
)
with check (
  public.is_superadmin()
  or (public.is_approved_vendor() and vendor_id = (select auth.uid()))
);

create policy "Vendors can delete their own products"
on public.products for delete to authenticated
using (public.is_approved_vendor() and vendor_id = (select auth.uid()));

revoke select on public.products from anon;

create view public.public_catalogue_products
with (security_barrier = true)
as
select
  p.id, p.name_en, p.name_kn, p.description_en, p.description_kn, p.category,
  p.image_url, p.mrp, p.selling_price, p.is_active, p.sort_order,
  p.created_at, p.updated_at,
  case
    when p.stock_quantity = 0 then 'out-of-stock'
    when p.stock_quantity <= p.low_stock_threshold then 'low-stock'
    else 'in-stock'
  end as stock_status
from public.products p
where p.is_active
  and exists (select 1 from public.shop_settings s where s.id = 1 and s.is_active);

revoke all on public.public_catalogue_products from public;
grant select on public.public_catalogue_products to anon, authenticated;

create or replace function public.guard_superadmin_product_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.is_superadmin()
     and row(
       new.id, new.vendor_id, new.name_en, new.name_kn, new.description_en,
       new.description_kn, new.category, new.image_url, new.mrp,
       new.selling_price, new.stock_quantity, new.low_stock_threshold,
       new.sort_order, new.created_at
     ) is distinct from row(
       old.id, old.vendor_id, old.name_en, old.name_kn, old.description_en,
       old.description_kn, old.category, old.image_url, old.mrp,
       old.selling_price, old.stock_quantity, old.low_stock_threshold,
       old.sort_order, old.created_at
     ) then
    raise exception 'Super Admin may only change product visibility.' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke update (is_active) on public.profiles from authenticated;
revoke update on public.profiles from authenticated;

drop policy "Staff can upload images for their role" on storage.objects;
drop policy "Staff can update images for their role" on storage.objects;
drop policy "Staff can delete images for their role" on storage.objects;

create policy "Approved vendors can upload owned product images; Super Admin can upload shop images"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'product-images'
  and (
    (
      (storage.foldername(name))[1] = 'products'
      and (storage.foldername(name))[2] = (select auth.uid())::text
      and public.is_approved_vendor()
    )
    or ((storage.foldername(name))[1] = 'shop' and public.is_superadmin())
  )
);

create policy "Approved vendors can update owned product images; Super Admin can update shop images"
on storage.objects for update to authenticated
using (
  bucket_id = 'product-images'
  and (
    (
      (storage.foldername(name))[1] = 'products'
      and (storage.foldername(name))[2] = (select auth.uid())::text
      and public.is_approved_vendor()
    )
    or ((storage.foldername(name))[1] = 'shop' and public.is_superadmin())
  )
)
with check (
  bucket_id = 'product-images'
  and (
    (
      (storage.foldername(name))[1] = 'products'
      and (storage.foldername(name))[2] = (select auth.uid())::text
      and public.is_approved_vendor()
    )
    or ((storage.foldername(name))[1] = 'shop' and public.is_superadmin())
  )
);

create policy "Approved vendors can delete owned product images; Super Admin can delete shop images"
on storage.objects for delete to authenticated
using (
  bucket_id = 'product-images'
  and (
    (
      (storage.foldername(name))[1] = 'products'
      and (storage.foldername(name))[2] = (select auth.uid())::text
      and public.is_approved_vendor()
    )
    or ((storage.foldername(name))[1] = 'shop' and public.is_superadmin())
  )
);
