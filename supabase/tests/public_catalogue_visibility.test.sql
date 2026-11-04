-- Public catalogue visibility and vendor product ownership.
-- Run only against a disposable local Supabase database after migrations 001-004, for example:
--   supabase test db
-- Never run against production.
begin;

select plan(12);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'catalogue-approved@example.test', '', now(), '{"provider":"google"}', '{}', now(), now()),
  ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'catalogue-suspended@example.test', '', now(), '{"provider":"google"}', '{}', now(), now()),
  ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'catalogue-pending@example.test', '', now(), '{"provider":"google"}', '{}', now(), now());

insert into public.profiles (id, display_name, role, is_active) values
  ('00000000-0000-4000-8000-0000000000a1', 'Approved Vendor', 'vendor', true),
  ('00000000-0000-4000-8000-0000000000b1', 'Suspended Vendor', 'vendor', false),
  ('00000000-0000-4000-8000-0000000000c1', 'Pending Vendor', 'vendor', true);

insert into public.vendor_applications (id, business_name, owner_name, phone, email, location, status) values
  ('00000000-0000-4000-8000-0000000000a1', 'Approved Crackers', 'Vendor A', '+919876500001', 'catalogue-approved@example.test', 'Udupi', 'approved'),
  ('00000000-0000-4000-8000-0000000000b1', 'Suspended Crackers', 'Vendor B', '+919876500002', 'catalogue-suspended@example.test', 'Udupi', 'suspended'),
  ('00000000-0000-4000-8000-0000000000c1', 'Pending Crackers', 'Vendor C', '+919876500003', 'catalogue-pending@example.test', 'Udupi', 'pending');

insert into public.products (id, vendor_id, name_en, name_kn, category, is_active, stock_quantity, selling_price) values
  ('00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-0000000000a1', 'Approved Active', 'Approved Active KN', 'Ground', true, 10, 150),
  ('00000000-0000-4000-8000-0000000000a3', '00000000-0000-4000-8000-0000000000a1', 'Approved Inactive', 'Approved Inactive KN', 'Ground', false, 10, 150),
  ('00000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-0000000000b1', 'Suspended Active', 'Suspended Active KN', 'Ground', true, 10, 150),
  ('00000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-0000000000c1', 'Pending Active', 'Pending Active KN', 'Ground', true, 10, 150);

update public.shop_settings set is_active = true where id = 1;

set local role anon;
select ok(exists (select 1 from public.public_catalogue_products where id = '00000000-0000-4000-8000-0000000000a2'), 'approved vendor active product is visible to customers');
select ok(not exists (select 1 from public.public_catalogue_products where id = '00000000-0000-4000-8000-0000000000a3'), 'inactive product is hidden');
select ok(not exists (select 1 from public.public_catalogue_products where id = '00000000-0000-4000-8000-0000000000b2'), 'suspended vendor product is hidden');
select ok(not exists (select 1 from public.public_catalogue_products where id = '00000000-0000-4000-8000-0000000000c2'), 'pending vendor product is hidden');
select throws_ok('select count(*) from public.products', '42501', null, 'customers cannot bypass the view to read the products table');
reset role;

select is(
  (select count(*) from information_schema.columns
   where table_schema = 'public' and table_name = 'public_catalogue_products'
     and column_name in ('phone', 'email', 'owner_name', 'business_name', 'location', 'whatsapp_number', 'stock_quantity')),
  0::bigint,
  'public catalogue exposes no private vendor or raw stock fields'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000a1', true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);

with updated as (
  update public.products set selling_price = 99 where id = '00000000-0000-4000-8000-0000000000a2' returning id
) select is((select count(*) from updated), 1::bigint, 'approved vendor can update its own product price');

with updated as (
  update public.products set selling_price = 1 where id = '00000000-0000-4000-8000-0000000000b2' returning id
) select is((select count(*) from updated), 0::bigint, 'vendor A cannot edit vendor B product');

select throws_ok(
  $$ insert into public.products (vendor_id, name_en, name_kn, category) values ('00000000-0000-4000-8000-0000000000b1', 'Forged', 'Forged KN', 'Ground') $$,
  '42501', null, 'vendor A cannot create a product owned by vendor B'
);
select throws_ok(
  $$ update public.products set vendor_id = '00000000-0000-4000-8000-0000000000b1' where id = '00000000-0000-4000-8000-0000000000a2' $$,
  '42501', null, 'vendor A cannot reassign its product to vendor B'
);
reset role;

set local role anon;
select is(
  (select selling_price from public.public_catalogue_products where id = '00000000-0000-4000-8000-0000000000a2'),
  99.00::numeric,
  'customers see the updated price'
);
reset role;

update public.shop_settings set is_active = false where id = 1;
set local role anon;
select is((select count(*) from public.public_catalogue_products), 0::bigint, 'an inactive shop hides the whole catalogue');
reset role;

select * from finish();
rollback;
