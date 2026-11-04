begin;

select plan(9);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'isolation-vendor-a@example.test', '', now(), '{"provider":"google"}', '{}', now(), now()),
  ('00000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'isolation-vendor-b@example.test', '', now(), '{"provider":"google"}', '{}', now(), now()),
  ('00000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'isolation-admin@example.test', '', now(), '{"provider":"google"}', '{}', now(), now());

insert into public.profiles (id, display_name, role, is_active) values
  ('00000000-0000-4000-8000-000000000001', 'Isolation Vendor A', 'vendor', true),
  ('00000000-0000-4000-8000-000000000002', 'Isolation Vendor B', 'vendor', true),
  ('00000000-0000-4000-8000-000000000003', 'Isolation Admin', 'superadmin', true);

insert into public.vendor_applications (
  id, business_name, owner_name, phone, email, location, status
) values
  ('00000000-0000-4000-8000-000000000001', 'Isolation A', 'Vendor A', '+919876543210', 'isolation-vendor-a@example.test', 'Udupi', 'approved'),
  ('00000000-0000-4000-8000-000000000002', 'Isolation B', 'Vendor B', '+919876543211', 'isolation-vendor-b@example.test', 'Udupi', 'approved');

insert into public.products (id, name_en, name_kn, category, vendor_id) values
  ('00000000-0000-4000-8000-000000000010', 'Vendor A Product', 'A ಉತ್ಪನ್ನ', 'Ground', '00000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-000000000020', 'Vendor B Product', 'B ಉತ್ಪನ್ನ', 'Ground', '00000000-0000-4000-8000-000000000002');

insert into public.enquiries (id, customer_name, customer_phone) values
  ('00000000-0000-4000-8000-000000000011', 'Own enquiry', '9876543210'),
  ('00000000-0000-4000-8000-000000000012', 'Other vendor enquiry', '9876543210'),
  ('00000000-0000-4000-8000-000000000013', 'Mixed vendor enquiry', '9876543210'),
  ('00000000-0000-4000-8000-000000000014', 'Missing product enquiry', '9876543210');

insert into public.enquiry_items (
  enquiry_id, product_id, product_name_snapshot, quantity
) values
  ('00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000010', 'Vendor A Product', 1),
  ('00000000-0000-4000-8000-000000000012', '00000000-0000-4000-8000-000000000020', 'Vendor B Product', 1),
  ('00000000-0000-4000-8000-000000000013', '00000000-0000-4000-8000-000000000010', 'Vendor A Product', 1),
  ('00000000-0000-4000-8000-000000000013', '00000000-0000-4000-8000-000000000020', 'Vendor B Product', 1),
  ('00000000-0000-4000-8000-000000000014', null, 'Deleted Product Snapshot', 1);

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

select is((select count(*) from public.enquiries), 1::bigint, 'vendor A sees only its complete enquiry');
select is((select count(*) from public.enquiry_items), 1::bigint, 'vendor A sees only its corresponding item snapshot');
with updated as (
    update public.enquiries set status = 'contacted'
    where id = '00000000-0000-4000-8000-000000000011'
    returning id
) select is(
  (select count(*) from updated),
  1::bigint,
  'vendor A can update its enquiry status'
);
with updated as (
    update public.enquiries set status = 'contacted'
    where id = '00000000-0000-4000-8000-000000000012'
    returning id
) select is(
  (select count(*) from updated),
  0::bigint,
  'vendor A cannot update another vendor enquiry'
);
select ok(
  has_column_privilege('authenticated', 'public.enquiries', 'status', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.enquiries', 'customer_name', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.enquiries', 'customer_phone', 'UPDATE'),
  'vendors can update status but not customer identity fields'
);

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is((select count(*) from public.enquiries), 1::bigint, 'vendor B sees only its complete enquiry');
select is((select count(*) from public.enquiry_items), 1::bigint, 'vendor B sees only its corresponding item snapshot');

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000003', true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select is((select count(*) from public.enquiries), 4::bigint, 'Super Admin retains access to all enquiries');
select is((select count(*) from public.enquiry_items), 5::bigint, 'Super Admin retains access to all item snapshots');

select * from finish();
rollback;
