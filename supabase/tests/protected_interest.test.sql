-- Disposable local Supabase only, after migrations 001 through 004.
begin;
select no_plan();

select ok(not has_function_privilege('anon', 'public.submit_interest(text,text,jsonb)', 'EXECUTE'), 'anon has no direct submission grant');
select ok(not has_function_privilege('authenticated', 'public.submit_interest(text,text,jsonb)', 'EXECUTE'), 'authenticated has no direct submission grant');
select ok(has_function_privilege('service_role', 'public.submit_interest(text,text,jsonb)', 'EXECUTE'), 'Edge server identity has submission permission');

set local role anon;
select throws_ok(
  $$select public.submit_interest('Test Customer', '9876543210', '[]'::jsonb)$$,
  '42501', 'permission denied for function submit_interest', 'anonymous direct RPC call is denied'
);
select throws_ok(
  $$select public.consume_interest_rate_limit(repeat('a',64), repeat('b',64))$$,
  '42501', 'permission denied for function consume_interest_rate_limit', 'anonymous cannot manipulate limiter state'
);
reset role;
set local role authenticated;
select throws_ok(
  $$select public.submit_interest('Test Customer', '9876543210', '[]'::jsonb)$$,
  '42501', 'permission denied for function submit_interest', 'authenticated direct RPC call is denied'
);
select throws_ok(
  $$select public.claim_interest_captcha(repeat('a',64))$$,
  '42501', 'permission denied for function claim_interest_captcha', 'authenticated cannot claim CAPTCHA tokens'
);
reset role;

set local role service_role;
select is((public.consume_interest_rate_limit(repeat('a',64), repeat('b',64))->>'allowed')::boolean, true, 'first attempt allowed');
select is((public.consume_interest_rate_limit(repeat('a',64), repeat('b',64))->>'allowed')::boolean, true, 'second attempt allowed');
select is((public.consume_interest_rate_limit(repeat('a',64), repeat('b',64))->>'allowed')::boolean, true, 'third attempt allowed');
select is((public.consume_interest_rate_limit(repeat('a',64), repeat('c',64))->>'allowed')::boolean, false, 'rotating phone cannot bypass IP burst limit');
select is(public.claim_interest_captcha(repeat('d',64)), true, 'first CAPTCHA claim allowed');
select is(public.claim_interest_captcha(repeat('d',64)), false, 'CAPTCHA cannot be claimed twice');
reset role;

-- A separate phone key, requested through distinct IP keys.
set local role service_role;
do $$
begin
  for i in 1..5 loop
    perform public.consume_interest_rate_limit(md5(i::text) || md5(i::text), repeat('e',64));
  end loop;
end;
$$;
select is((public.consume_interest_rate_limit(repeat('f',64), repeat('e',64))->>'allowed')::boolean, false, 'rotating IP cannot bypass phone limit');
reset role;

insert into auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data)
values ('00000000-0000-4000-8000-000000000101', 'authenticated', 'authenticated', 'protected-vendor@example.test', now(), '{"provider":"google"}');
insert into public.profiles (id, role, is_active)
values ('00000000-0000-4000-8000-000000000101', 'vendor', true);
insert into public.vendor_applications (id, business_name, owner_name, phone, email, location, status)
values ('00000000-0000-4000-8000-000000000101', 'Protected Vendor', 'Test Vendor', '+919876543211', 'protected-vendor@example.test', 'Udupi', 'approved');
insert into public.products (id, name_en, name_kn, category, vendor_id, stock_quantity)
values ('00000000-0000-4000-8000-000000000110', 'Protected Product', 'Test Product', 'Ground', '00000000-0000-4000-8000-000000000101', 7);
update public.shop_settings set is_active = true where id = 1;

set local role service_role;
select set_config('test.saved_interest', public.submit_interest(
  'Test Customer', '9876543210',
  '[{"product_id":"00000000-0000-4000-8000-000000000110","quantity":99}]'
)::text, true);
reset role;
select is((current_setting('test.saved_interest')::jsonb)->>'whatsapp_number', '919876543211', 'RPC derives the destination from the owning vendor');
select is((select stock_quantity from public.products where id = '00000000-0000-4000-8000-000000000110'), 7, 'successful enquiry does not decrement or reserve stock');
select is((select quantity from public.enquiry_items where enquiry_id = ((current_setting('test.saved_interest')::jsonb)->>'enquiry_id')::uuid), 99, 'quantity can exceed stock because this is interest only');

select set_config('test.enquiries_before', (select count(*)::text from public.enquiries), true);
select set_config('test.items_before', (select count(*)::text from public.enquiry_items), true);
set local role service_role;
select throws_ok(
  $$select public.submit_interest('Test Customer', '9876543210',
    '[{"product_id":"00000000-0000-4000-8000-000000000110","quantity":1},{"product_id":"00000000-0000-4000-8000-000000000119","quantity":1}]')$$,
  '22023', 'A selected product is no longer available from an active, approved vendor.',
  'failure after a valid first item rejects the entire enquiry'
);
reset role;
select is((select count(*) from public.enquiries), current_setting('test.enquiries_before')::bigint, 'failed RPC rolls back the enquiry row');
select is((select count(*) from public.enquiry_items), current_setting('test.items_before')::bigint, 'failed RPC rolls back all item snapshots');
select is((select stock_quantity from public.products where id = '00000000-0000-4000-8000-000000000110'), 7, 'failed enquiry also preserves stock');

update public.products set is_active = false where id = '00000000-0000-4000-8000-000000000110';
set local role service_role;
select throws_ok(
  $$select public.submit_interest('Test Customer', '9876543210', '[{"product_id":"00000000-0000-4000-8000-000000000110","quantity":1}]')$$,
  '22023', 'A selected product is no longer available from an active, approved vendor.', 'inactive products cannot be submitted'
);
reset role;
update public.products set is_active = true where id = '00000000-0000-4000-8000-000000000110';
update public.vendor_applications set status = 'suspended' where id = '00000000-0000-4000-8000-000000000101';
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000101', true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000101","role":"authenticated"}', true);
set local role authenticated;
with changed as (
  update public.products set stock_quantity = 0 where id = '00000000-0000-4000-8000-000000000110' returning id
) select is((select count(*) from changed), 0::bigint, 'suspended vendor cannot change product stock');
reset role;
set local role service_role;
select throws_ok(
  $$select public.submit_interest('Test Customer', '9876543210', '[{"product_id":"00000000-0000-4000-8000-000000000110","quantity":1}]')$$,
  '22023', 'A selected product is no longer available from an active, approved vendor.', 'suspended vendors cannot receive submissions'
);
reset role;
update public.vendor_applications set status = 'approved' where id = '00000000-0000-4000-8000-000000000101';
update public.profiles set is_active = false where id = '00000000-0000-4000-8000-000000000101';
set local role authenticated;
with changed as (
  update public.products set stock_quantity = 0 where id = '00000000-0000-4000-8000-000000000110' returning id
) select is((select count(*) from changed), 0::bigint, 'inactive vendor cannot change product stock');
with removed as (
  delete from public.products where id = '00000000-0000-4000-8000-000000000110' returning id
) select is((select count(*) from removed), 0::bigint, 'inactive vendor cannot delete products');
select throws_ok(
  $$insert into public.products (name_en, name_kn, category, vendor_id) values ('Blocked Product', 'Test Product', 'Ground', '00000000-0000-4000-8000-000000000101')$$,
  '42501', 'new row violates row-level security policy for table "products"', 'inactive vendor cannot create products'
);
reset role;
set local role service_role;
select throws_ok(
  $$select public.submit_interest('Test Customer', '9876543210', '[{"product_id":"00000000-0000-4000-8000-000000000110","quantity":1}]')$$,
  '22023', 'A selected product is no longer available from an active, approved vendor.', 'inactive vendors cannot receive submissions'
);
reset role;

select * from finish();
rollback;
