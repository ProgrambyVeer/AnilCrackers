create extension if not exists pgcrypto with schema extensions;

create type public.user_role as enum ('vendor', 'superadmin');
create type public.enquiry_status as enum ('new', 'contacted', 'completed', 'closed');

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (display_name is null or char_length(display_name) <= 100),
  role public.user_role not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.shop_settings (
  id smallint primary key default 1 check (id = 1),
  shop_name text not null default 'Anil Crackers' check (char_length(shop_name) between 1 and 120),
  whatsapp_number text not null default '' check (
    char_length(whatsapp_number) <= 24
    and (
      whatsapp_number = ''
      or regexp_replace(whatsapp_number, '[^0-9]', '', 'g') ~ '^[1-9][0-9]{9,14}$'
    )
  ),
  address text not null default '' check (char_length(address) <= 500),
  logo_url text,
  description text not null default '' check (char_length(description) <= 1000),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  name_en text not null check (char_length(btrim(name_en)) between 1 and 120),
  name_kn text not null check (char_length(btrim(name_kn)) between 1 and 160),
  description_en text not null default '' check (char_length(description_en) <= 1000),
  description_kn text not null default '' check (char_length(description_kn) <= 1000),
  category text not null check (category in ('Ground', 'Sparklers', 'Aerial', 'Sound', 'Combo', 'Other')),
  image_url text,
  mrp numeric(10, 2) check (mrp is null or mrp >= 0),
  selling_price numeric(10, 2) check (selling_price is null or selling_price >= 0),
  is_active boolean not null default true,
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (mrp is null or selling_price is null or selling_price <= mrp)
);

create table public.enquiries (
  id uuid primary key default gen_random_uuid(),
  reference_code text not null unique default ('AC-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))),
  customer_name text not null check (char_length(btrim(customer_name)) between 2 and 100),
  customer_phone text not null check (char_length(customer_phone) between 9 and 24),
  status public.enquiry_status not null default 'new',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.enquiry_items (
  id uuid primary key default gen_random_uuid(),
  enquiry_id uuid not null references public.enquiries (id) on delete cascade,
  product_id uuid references public.products (id) on delete set null,
  product_name_snapshot text not null check (char_length(product_name_snapshot) between 1 and 120),
  quantity integer not null check (quantity between 1 and 99),
  mrp_snapshot numeric(10, 2) check (mrp_snapshot is null or mrp_snapshot >= 0),
  selling_price_snapshot numeric(10, 2) check (selling_price_snapshot is null or selling_price_snapshot >= 0),
  created_at timestamptz not null default now()
);

create index products_public_catalogue_idx on public.products (sort_order, name_en) where is_active;
create index products_category_active_idx on public.products (category, sort_order) where is_active;
create index enquiries_created_at_idx on public.enquiries (created_at desc);
create index enquiries_status_created_at_idx on public.enquiries (status, created_at desc);
create index enquiry_items_enquiry_id_idx on public.enquiry_items (enquiry_id);

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create trigger shop_settings_set_updated_at
before update on public.shop_settings
for each row execute function public.set_updated_at();

create trigger products_set_updated_at
before update on public.products
for each row execute function public.set_updated_at();

create trigger enquiries_set_updated_at
before update on public.enquiries
for each row execute function public.set_updated_at();

create function public.has_staff_role(p_roles public.user_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.is_active
      and p.role = any (p_roles)
  );
$$;

create function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_staff_role(array['vendor', 'superadmin']::public.user_role[]);
$$;

create function public.is_superadmin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_staff_role(array['superadmin']::public.user_role[]);
$$;

create function public.guard_superadmin_product_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.is_superadmin()
     and row(
       new.id,
       new.name_en,
       new.name_kn,
       new.description_en,
       new.description_kn,
       new.category,
       new.image_url,
       new.mrp,
       new.selling_price,
       new.sort_order,
       new.created_at
     ) is distinct from row(
       old.id,
       old.name_en,
       old.name_kn,
       old.description_en,
       old.description_kn,
       old.category,
       old.image_url,
       old.mrp,
       old.selling_price,
       old.sort_order,
       old.created_at
     ) then
    raise exception 'Super Admin may only change product visibility.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger products_guard_superadmin_changes
before update on public.products
for each row execute function public.guard_superadmin_product_changes();

revoke all on function public.has_staff_role(public.user_role[]) from public;
revoke all on function public.is_staff() from public;
revoke all on function public.is_superadmin() from public;
grant execute on function public.has_staff_role(public.user_role[]) to anon, authenticated;
grant execute on function public.is_staff() to anon, authenticated;
grant execute on function public.is_superadmin() to anon, authenticated;

alter table public.profiles enable row level security;
alter table public.shop_settings enable row level security;
alter table public.products enable row level security;
alter table public.enquiries enable row level security;
alter table public.enquiry_items enable row level security;

create policy "Profiles are visible to the account owner and Super Admin"
on public.profiles for select to authenticated
using (id = (select auth.uid()) or public.is_superadmin());

create policy "Super Admin can update other profile access"
on public.profiles for update to authenticated
using (public.is_superadmin() and id <> (select auth.uid()))
with check (public.is_superadmin() and id <> (select auth.uid()));

create policy "Public can read an active shop; staff can read settings"
on public.shop_settings for select to anon, authenticated
using (is_active or public.is_staff());

create policy "Only Super Admin can update shop settings"
on public.shop_settings for update to authenticated
using (public.is_superadmin())
with check (public.is_superadmin());

create policy "Public can read active products while the shop is active"
on public.products for select to anon, authenticated
using (
  public.is_staff()
  or (
    is_active
    and exists (select 1 from public.shop_settings s where s.id = 1 and s.is_active)
  )
);

create policy "Vendor can add products"
on public.products for insert to authenticated
with check (public.has_staff_role(array['vendor']::public.user_role[]));

create policy "Active staff can update product visibility and vendor catalogue"
on public.products for update to authenticated
using (public.is_staff())
with check (public.is_staff());

create policy "Vendor can delete products"
on public.products for delete to authenticated
using (public.has_staff_role(array['vendor']::public.user_role[]));

create policy "Active staff can read enquiries"
on public.enquiries for select to authenticated
using (public.is_staff());

create policy "Active staff can update enquiry tracking status"
on public.enquiries for update to authenticated
using (public.is_staff())
with check (public.is_staff());

create policy "Active staff can read enquiry item snapshots"
on public.enquiry_items for select to authenticated
using (
  public.is_staff()
  and exists (
    select 1 from public.enquiries e
    where e.id = enquiry_id
  )
);

revoke all on public.profiles, public.shop_settings, public.products, public.enquiries, public.enquiry_items from public, anon, authenticated;
grant select on public.shop_settings, public.products to anon, authenticated;
grant select on public.profiles to authenticated;
grant update (is_active) on public.profiles to authenticated;
grant update (shop_name, whatsapp_number, address, logo_url, description, is_active) on public.shop_settings to authenticated;
grant select, insert, update, delete on public.products to authenticated;
grant select on public.enquiries, public.enquiry_items to authenticated;
grant update (status) on public.enquiries to authenticated;

create function public.submit_interest(
  p_customer_name text,
  p_customer_phone text,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := btrim(coalesce(p_customer_name, ''));
  v_phone text := btrim(coalesce(p_customer_phone, ''));
  v_phone_digits text;
  v_item jsonb;
  v_product_id uuid;
  v_quantity integer;
  v_item_count integer;
  v_seen_ids uuid[] := array[]::uuid[];
  v_product_name text;
  v_mrp numeric(10, 2);
  v_selling_price numeric(10, 2);
  v_enquiry_id uuid;
  v_reference_code text;
  v_whatsapp text;
begin
  if char_length(v_name) not between 2 and 100 then
    raise exception 'Enter a name between 2 and 100 characters.' using errcode = '22023';
  end if;

  if char_length(v_phone) not between 9 and 24
     or v_phone !~ '^[+]?[0-9][0-9() -]{8,22}$' then
    raise exception 'Enter a valid phone number.' using errcode = '22023';
  end if;

  v_phone_digits := regexp_replace(v_phone, '[^0-9]', '', 'g');
  if char_length(v_phone_digits) = 12 and left(v_phone_digits, 2) = '91' then
    v_phone_digits := substr(v_phone_digits, 3);
  end if;
  if char_length(v_phone_digits) <> 10 or v_phone_digits !~ '^[6-9][0-9]{9}$' then
    raise exception 'Enter a valid phone number.' using errcode = '22023';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Select at least one product.' using errcode = '22023';
  end if;

  v_item_count := jsonb_array_length(p_items);
  if v_item_count not between 1 and 30 then
    raise exception 'Select between 1 and 30 products.' using errcode = '22023';
  end if;

  select s.whatsapp_number
    into v_whatsapp
    from public.shop_settings s
   where s.id = 1 and s.is_active;

  if not found then
    raise exception 'The shop is not currently accepting enquiries.' using errcode = '22023';
  end if;

  if regexp_replace(coalesce(v_whatsapp, ''), '[^0-9]', '', 'g') !~ '^[1-9][0-9]{9,14}$' then
    raise exception 'The shop WhatsApp number is not configured.' using errcode = '22023';
  end if;

  insert into public.enquiries (customer_name, customer_phone)
  values (v_name, v_phone)
  returning id, reference_code into v_enquiry_id, v_reference_code;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    if coalesce(v_item->>'product_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'A selected product is invalid.' using errcode = '22023';
    end if;
    if coalesce(v_item->>'quantity', '') !~ '^[0-9]{1,2}$' then
      raise exception 'Each quantity must be between 1 and 99.' using errcode = '22023';
    end if;

    v_product_id := (v_item->>'product_id')::uuid;
    v_quantity := (v_item->>'quantity')::integer;
    if v_quantity not between 1 and 99 then
      raise exception 'Each quantity must be between 1 and 99.' using errcode = '22023';
    end if;
    if v_product_id = any(v_seen_ids) then
      raise exception 'A product may only appear once in the interest list.' using errcode = '22023';
    end if;
    v_seen_ids := array_append(v_seen_ids, v_product_id);

    select p.name_en, p.mrp, p.selling_price
      into v_product_name, v_mrp, v_selling_price
      from public.products p
     where p.id = v_product_id and p.is_active;

    if not found then
      raise exception 'A selected product is no longer available.' using errcode = '22023';
    end if;

    insert into public.enquiry_items (
      enquiry_id,
      product_id,
      product_name_snapshot,
      quantity,
      mrp_snapshot,
      selling_price_snapshot
    ) values (
      v_enquiry_id,
      v_product_id,
      v_product_name,
      v_quantity,
      v_mrp,
      v_selling_price
    );
  end loop;

  return jsonb_build_object('enquiry_id', v_enquiry_id, 'reference_code', v_reference_code);
end;
$$;

revoke all on function public.submit_interest(text, text, jsonb) from public;
grant execute on function public.submit_interest(text, text, jsonb) to anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', true, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'image/avif'])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy "Public can view product and shop images"
on storage.objects for select to anon, authenticated
using (bucket_id = 'product-images');

create policy "Staff can upload images for their role"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'product-images'
  and (
    (name like 'products/%' and public.has_staff_role(array['vendor']::public.user_role[]))
    or (name like 'shop/%' and public.is_superadmin())
  )
);

create policy "Staff can update images for their role"
on storage.objects for update to authenticated
using (
  bucket_id = 'product-images'
  and (
    (name like 'products/%' and public.has_staff_role(array['vendor']::public.user_role[]))
    or (name like 'shop/%' and public.is_superadmin())
  )
)
with check (
  bucket_id = 'product-images'
  and (
    (name like 'products/%' and public.has_staff_role(array['vendor']::public.user_role[]))
    or (name like 'shop/%' and public.is_superadmin())
  )
);

create policy "Staff can delete images for their role"
on storage.objects for delete to authenticated
using (
  bucket_id = 'product-images'
  and (
    (name like 'products/%' and public.has_staff_role(array['vendor']::public.user_role[]))
    or (name like 'shop/%' and public.is_superadmin())
  )
);

insert into public.shop_settings (id, shop_name)
values (1, 'Anil Crackers')
on conflict (id) do nothing;
