import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(resolve('supabase/migrations/202611020002_stock_vendor_approval.sql'), 'utf8')
const routingMigration = readFileSync(resolve('supabase/migrations/202611020003_vendor_routing_privacy.sql'), 'utf8')
const initialMigration = readFileSync(resolve('supabase/migrations/202611020001_initial_platform.sql'), 'utf8')
const provisioningScript = readFileSync(resolve('supabase/manual/first_superadmin.sql'), 'utf8')
const envExample = readFileSync(resolve('.env.example'), 'utf8')
const protectedMigration = readFileSync(resolve('supabase/migrations/202611040004_protected_interest_submission.sql'), 'utf8')

describe('database authorization contract', () => {
  it('scopes product writes to an approved vendor owning the row', () => {
    expect(migration).toMatch(/public\.is_approved_vendor\(\) and vendor_id = \(select auth\.uid\(\)\)/)
    expect(migration).toContain('add column stock_quantity integer not null default 0 check (stock_quantity >= 0)')
    expect(migration).toContain('add column low_stock_threshold integer not null default 5 check (low_stock_threshold >= 0)')
    expect(migration).toContain('revoke update (is_active) on public.profiles from authenticated')
    expect(migration).toContain('revoke update on public.profiles from authenticated')
  })

  it('requires active Super Admin authorization for approval and rejection', () => {
    expect(migration).toMatch(/approve_vendor_application[\s\S]*?if not public\.is_superadmin\(\) then/)
    expect(migration).toMatch(/reject_vendor_application[\s\S]*?if not public\.is_superadmin\(\) then/)
    expect(migration).toContain("values (p_application_id, v_actor, 'approved')")
    expect(migration).toContain("values (p_application_id, v_actor, 'rejected', btrim(p_reason))")
    expect(migration).toContain("raise exception 'A Super Admin account cannot be converted into a vendor account.'")
    expect(migration).toContain("where vendor_applications.status = 'rejected'")
  })

  it('does not make pending applicants staff or expose customer enquiry data', () => {
    expect(migration).not.toMatch(/create policy[^;]+on public\.vendor_applications for insert/i)
    expect(migration).toContain('create function public.is_approved_vendor()')
    expect(migration).toContain("a.status = 'approved'")
    expect(initialMigration).toContain('create policy "Active staff can read enquiries"')
    expect(initialMigration).toContain('create policy "Active staff can read enquiry item snapshots"')
  })

  it('exposes stock status but not exact quantities or vendor identity publicly', () => {
    const projection = migration.match(/create view public\.public_catalogue_products[\s\S]*?as\s+select([\s\S]*?)from public\.products/i)?.[1] ?? ''
    expect(projection).not.toMatch(/\bvendor_id\b|as\s+stock_quantity|as\s+low_stock_threshold/i)
    expect(projection).toContain('end as stock_status')
    expect(migration).toContain("when p.stock_quantity <= p.low_stock_threshold then 'low-stock'")
    expect(migration).toContain('revoke select on public.products from anon')
  })

  it('keeps interest submission independent of stock inventory', () => {
    const functionSql = routingMigration.match(/create or replace function public\.submit_interest[\s\S]*?\n\$\$;/i)?.[0] ?? ''
    expect(functionSql).not.toMatch(/stock_quantity|update\s+public\.products/i)
  })

  it('limits vendor enquiry rows to complete enquiries for one approved vendor', () => {
    const ownershipFunction = routingMigration.match(/create or replace function public\.vendor_owns_entire_enquiry[\s\S]*?\n\$\$;/i)?.[0] ?? ''
    expect(ownershipFunction).toContain('public.is_approved_vendor()')
    expect(ownershipFunction).toMatch(/product\.vendor_id = \(select auth\.uid\(\)\)/)
    expect(ownershipFunction).toMatch(/product\.vendor_id is distinct from \(select auth\.uid\(\)\)/)
    expect(routingMigration).toMatch(/public\.is_superadmin\(\)\s+or\s+public\.vendor_owns_entire_enquiry\(id\)/)
    expect(routingMigration).toMatch(/public\.is_superadmin\(\)\s+or\s+\(\s*public\.vendor_owns_entire_enquiry\(enquiry_id\)/)
    expect(routingMigration).toContain('drop policy if exists "Active staff can read enquiries"')
    expect(routingMigration).toContain('drop policy if exists "Active staff can read enquiry item snapshots"')
  })

  it('enforces a single active approved vendor and returns only its private destination after writes', () => {
    const functionSql = routingMigration.match(/create or replace function public\.submit_interest[\s\S]*?\n\$\$;/i)?.[0] ?? ''
    expect(functionSql).toMatch(/v_phone !~ '\^\[\+\]\?\[0-9\(\]\[0-9\(\) -\]\{8,22\}\$'/)
    expect(functionSql).toMatch(/vendor_profile\.is_active/)
    expect(functionSql).toMatch(/vendor_application\.status = 'approved'/)
    expect(functionSql).toMatch(/v_vendor_id is distinct from v_product_vendor_id/)
    expect(functionSql).toContain('public.normalize_indian_mobile(v_vendor_phone)')
    expect(functionSql).toMatch(/insert into public\.enquiry_items[\s\S]*?return jsonb_build_object/)
    expect(functionSql).toMatch(/'whatsapp_number', regexp_replace\(v_vendor_whatsapp/)
    expect(routingMigration).not.toMatch(/select[^;]*phone[^;]*from public\.public_catalogue_products/i)
  })

  it('normalizes vendor mobile numbers and updates application timestamps on every update', () => {
    expect(routingMigration).toContain('create or replace function public.normalize_indian_mobile')
    expect(routingMigration).toContain('create or replace function public.normalize_vendor_application_phone')
    expect(routingMigration).toContain('drop trigger if exists vendor_applications_normalize_phone')
    expect(routingMigration).toContain('drop trigger if exists vendor_applications_set_updated_at')
    expect(routingMigration).toMatch(/before update on public\.vendor_applications[\s\S]*?execute function public\.set_updated_at\(\)/)
  })

  it('keeps vendor phone private and exposes only the vendor ID needed for cart validation', () => {
    const viewSql = routingMigration.match(/create or replace view public\.public_catalogue_products[\s\S]*?;[\r\n]/i)?.[0] ?? ''
    expect(viewSql).toContain('product.vendor_id')
    expect(viewSql).toContain("application.status = 'approved'")
    expect(viewSql).not.toMatch(/phone|whatsapp/i)
    expect(viewSql).not.toMatch(/as\s+stock_quantity|as\s+low_stock_threshold/i)
  })

  it('provisions only a verified Google auth UUID and never upserts a client-assigned role', () => {
    expect(provisioningScript).toContain('v_user_id uuid := null')
    expect(provisioningScript).toContain('email_confirmed_at is not null')
    expect(provisioningScript).toContain("raw_app_meta_data ->> 'provider' = 'google'")
    expect(provisioningScript).toContain('if exists (select 1 from public.profiles where role = \'superadmin\') then')
    expect(provisioningScript).not.toMatch(/on conflict/i)
    expect(provisioningScript).not.toMatch(/YOUR_SUPER_ADMIN_GOOGLE_EMAIL/i)
  })

  it('serializes first administrator check and insert using a transaction advisory lock', () => {
    expect(provisioningScript).toContain("current_setting('transaction_isolation') <> 'read committed'")
    expect(provisioningScript).toContain('pg_catalog.pg_advisory_xact_lock(741620, 1)')
    expect(provisioningScript.indexOf('pg_advisory_xact_lock')).toBeLessThan(provisioningScript.indexOf("where role = 'superadmin'"))
    expect(provisioningScript.indexOf("where role = 'superadmin'")).toBeLessThan(provisioningScript.indexOf('insert into public.profiles'))
    expect(provisioningScript).not.toMatch(/\bcommit\s*;/i)
  })

  it('revokes both anonymous and authenticated direct submission and limiter access', () => {
    for (const signature of ['submit_interest(text, text, jsonb)', 'consume_interest_rate_limit(text, text)', 'claim_interest_captcha(text)']) {
      expect(protectedMigration).toContain(`revoke all on function public.${signature} from public, anon, authenticated;`)
      expect(protectedMigration).toContain(`grant execute on function public.${signature} to service_role;`)
    }
    expect(protectedMigration).not.toMatch(/grant execute[^;]+to (?:anon|authenticated)/)
    expect(protectedMigration).toContain('set search_path = \'\'')
    expect(protectedMigration).toContain('on conflict (scope, key_hash, window_start) do update')
    expect(protectedMigration).toContain('on conflict (token_hash) do nothing')
  })

  it('does not include a browser direct-RPC path or server secrets', () => {
    const app = readFileSync(resolve('src/App.tsx'), 'utf8')
    const client = readFileSync(resolve('src/lib/submit-interest.ts'), 'utf8')
    expect(app).not.toMatch(/rpc\(['"]submit_interest/)
    expect(client).toContain("functions.invoke<unknown>('submit-interest'")
    expect(client).not.toContain('SERVICE_ROLE')
    expect(envExample).not.toContain('SERVICE_ROLE')
    expect(envExample).toContain('VITE_INTEREST_SUBMISSION_ENABLED=false')
  })

  it('keeps the checked-in environment template free of real project credentials', () => {
    expect(envExample).toContain('VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co')
    expect(envExample).toContain('VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_OR_PUBLISHABLE_KEY')
    expect(envExample).not.toMatch(/pooler\.supabase\.com|sbp_[a-z0-9]{20,}/i)
  })
})
