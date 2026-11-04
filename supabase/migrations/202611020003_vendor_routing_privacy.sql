-- Vendor destinations are private application data. Only return one after a
-- complete, single-vendor interest enquiry has been stored successfully.

create or replace function public.normalize_indian_mobile(p_phone text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select case
    when cleaned.digits ~ '^[6-9][0-9]{9}$' then '+91' || cleaned.digits
    when cleaned.digits ~ '^91[6-9][0-9]{9}$' then '+' || cleaned.digits
    else null
  end
  from (
    select regexp_replace(btrim(p_phone), '[^0-9]', '', 'g') as digits
    where btrim(p_phone) ~ '^[+]?[0-9(][0-9() -]{8,22}$'
  ) as cleaned;
$$;

revoke all on function public.normalize_indian_mobile(text) from public;
grant execute on function public.normalize_indian_mobile(text) to authenticated;

create or replace function public.normalize_vendor_application_phone()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.phone := public.normalize_indian_mobile(new.phone);
    if new.phone is null then
      raise exception 'Enter a valid Indian mobile number for WhatsApp enquiries.' using errcode = '22023';
    end if;
  elsif new.phone is distinct from old.phone then
    new.phone := public.normalize_indian_mobile(new.phone);
    if new.phone is null then
      raise exception 'Enter a valid Indian mobile number for WhatsApp enquiries.' using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists vendor_applications_normalize_phone on public.vendor_applications;
create trigger vendor_applications_normalize_phone
before insert or update on public.vendor_applications
for each row execute function public.normalize_vendor_application_phone();

drop trigger if exists vendor_applications_set_updated_at on public.vendor_applications;
create trigger vendor_applications_set_updated_at
before update on public.vendor_applications
for each row execute function public.set_updated_at();

-- Normalize existing valid numbers. Legacy empty or invalid numbers are left
-- intact and cannot be used as enquiry destinations until corrected manually.
update public.vendor_applications
set phone = public.normalize_indian_mobile(phone)
where public.normalize_indian_mobile(phone) is not null
  and phone is distinct from public.normalize_indian_mobile(phone);

create or replace function public.vendor_owns_entire_enquiry(p_enquiry_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_approved_vendor()
    and exists (
      select 1
      from public.enquiry_items item
      join public.products product on product.id = item.product_id
      where item.enquiry_id = p_enquiry_id
        and product.vendor_id = (select auth.uid())
    )
    and not exists (
      select 1
      from public.enquiry_items item
      left join public.products product on product.id = item.product_id
      where item.enquiry_id = p_enquiry_id
        and product.vendor_id is distinct from (select auth.uid())
    );
$$;

revoke all on function public.vendor_owns_entire_enquiry(uuid) from public;
grant execute on function public.vendor_owns_entire_enquiry(uuid) to authenticated;

drop policy if exists "Active staff can read enquiries" on public.enquiries;
drop policy if exists "Active staff can update enquiry tracking status" on public.enquiries;
drop policy if exists "Super Admin or owning vendor can read enquiries" on public.enquiries;
drop policy if exists "Super Admin or owning vendor can update enquiry tracking status" on public.enquiries;
create policy "Super Admin or owning vendor can read enquiries"
on public.enquiries for select to authenticated
using (public.is_superadmin() or public.vendor_owns_entire_enquiry(id));

create policy "Super Admin or owning vendor can update enquiry tracking status"
on public.enquiries for update to authenticated
using (public.is_superadmin() or public.vendor_owns_entire_enquiry(id))
with check (public.is_superadmin() or public.vendor_owns_entire_enquiry(id));

drop policy if exists "Active staff can read enquiry item snapshots" on public.enquiry_items;
drop policy if exists "Super Admin or owning vendor can read enquiry item snapshots" on public.enquiry_items;
create policy "Super Admin or owning vendor can read enquiry item snapshots"
on public.enquiry_items for select to authenticated
using (
  public.is_superadmin()
  or (
    public.vendor_owns_entire_enquiry(enquiry_id)
    and exists (
      select 1
      from public.products product
      where product.id = product_id
        and product.vendor_id = (select auth.uid())
    )
  )
);

create or replace view public.public_catalogue_products
with (security_barrier = true)
as
select
  product.id, product.name_en, product.name_kn, product.description_en,
  product.description_kn, product.category, product.image_url, product.mrp,
  product.selling_price, product.is_active, product.sort_order,
  product.created_at, product.updated_at,
  case
    when product.stock_quantity = 0 then 'out-of-stock'
    when product.stock_quantity <= product.low_stock_threshold then 'low-stock'
    else 'in-stock'
  end as stock_status,
  product.vendor_id
from public.products product
where product.is_active
  and product.vendor_id is not null
  and exists (
    select 1
    from public.shop_settings settings
    where settings.id = 1 and settings.is_active
  )
  and exists (
    select 1
    from public.profiles vendor_profile
    join public.vendor_applications application on application.id = vendor_profile.id
    where vendor_profile.id = product.vendor_id
      and vendor_profile.role = 'vendor'
      and vendor_profile.is_active
      and application.status = 'approved'
  );

revoke all on public.public_catalogue_products from public;
grant select on public.public_catalogue_products to anon, authenticated;

create or replace function public.submit_interest(
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
  v_product_vendor_id uuid;
  v_vendor_id uuid;
  v_vendor_phone text;
  v_vendor_whatsapp text;
  v_enquiry_id uuid;
  v_reference_code text;
begin
  if char_length(v_name) not between 2 and 100 then
    raise exception 'Enter a name between 2 and 100 characters.' using errcode = '22023';
  end if;

  if char_length(v_phone) not between 9 and 24
     or v_phone !~ '^[+]?[0-9(][0-9() -]{8,22}$' then
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

  perform 1
  from public.shop_settings settings
  where settings.id = 1 and settings.is_active
  for share;
  if not found then
    raise exception 'The shop is not currently accepting enquiries.' using errcode = '22023';
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

    select
      product.name_en,
      product.mrp,
      product.selling_price,
      product.vendor_id,
      vendor_application.phone
    into
      v_product_name,
      v_mrp,
      v_selling_price,
      v_product_vendor_id,
      v_vendor_phone
    from public.products product
    join public.profiles vendor_profile
      on vendor_profile.id = product.vendor_id
     and vendor_profile.role = 'vendor'
     and vendor_profile.is_active
    join public.vendor_applications vendor_application
      on vendor_application.id = vendor_profile.id
     and vendor_application.status = 'approved'
    where product.id = v_product_id
      and product.is_active
    for share of product, vendor_profile, vendor_application;

    if not found then
      raise exception 'A selected product is no longer available from an active, approved vendor.' using errcode = '22023';
    end if;

    if v_vendor_id is null then
      v_vendor_id := v_product_vendor_id;
      v_vendor_whatsapp := public.normalize_indian_mobile(v_vendor_phone);
    elsif v_vendor_id is distinct from v_product_vendor_id then
      raise exception 'All selected products must belong to one approved vendor.' using errcode = '22023';
    end if;

    if v_vendor_whatsapp is null then
      raise exception 'The vendor WhatsApp number is invalid or unavailable.' using errcode = '22023';
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

  return jsonb_build_object(
    'enquiry_id', v_enquiry_id,
    'reference_code', v_reference_code,
    'whatsapp_number', regexp_replace(v_vendor_whatsapp, '[^0-9]', '', 'g')
  );
end;
$$;

revoke all on function public.submit_interest(text, text, jsonb) from public;
grant execute on function public.submit_interest(text, text, jsonb) to anon, authenticated;
