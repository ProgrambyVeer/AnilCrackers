import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(resolve('supabase/migrations/202611020002_stock_vendor_approval.sql'), 'utf8')
const initialMigration = readFileSync(resolve('supabase/migrations/202611020001_initial_platform.sql'), 'utf8')

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
    const functionSql = initialMigration.match(/create function public\.submit_interest[\s\S]*?\n\$\$;/i)?.[0] ?? ''
    expect(functionSql).not.toMatch(/stock_quantity|update\s+public\.products/i)
  })
})
