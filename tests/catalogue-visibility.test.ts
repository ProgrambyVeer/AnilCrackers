import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import {
  applyImageFallback,
  classifyCatalogueError,
  describeCatalogueIssue,
  fallbackProductImage,
  productImageSrc,
  staffErrorMessage,
  type CatalogueIssue,
} from '../src/lib/catalogue'
import { demoCatalogueProducts, demoProducts } from '../src/lib/demo'

const read = (path: string) => readFileSync(path, 'utf8')
const appSource = read('src/App.tsx')
const initialMigration = read('supabase/migrations/202611020001_initial_platform.sql')
const approvalMigration = read('supabase/migrations/202611020002_stock_vendor_approval.sql')
const routingMigration = read('supabase/migrations/202611020003_vendor_routing_privacy.sql')

function latestCatalogueView() {
  const start = routingMigration.indexOf('create or replace view public.public_catalogue_products')
  const end = routingMigration.indexOf('grant select on public.public_catalogue_products', start)
  expect(start).toBeGreaterThan(-1)
  return routingMigration.slice(start, end)
}

describe('catalogue load diagnostics', () => {
  it.each<[unknown, CatalogueIssue]>([
    [{ code: 'PGRST205', message: "Could not find the table 'public.public_catalogue_products' in the schema cache" }, 'schema-missing'],
    [{ code: '42P01', message: 'relation does not exist' }, 'schema-missing'],
    [new Error('Supabase is not configured. VITE_SUPABASE_URL is not set.'), 'not-configured'],
    [{ code: '42501', message: 'permission denied for view public_catalogue_products' }, 'permission-denied'],
    [new TypeError('Failed to fetch'), 'network'],
    [{ code: 'XX000', message: 'boom' }, 'unknown'],
    [null, 'unknown'],
  ])('classifies %o as %s', (error, issue) => {
    expect(classifyCatalogueError(error)).toBe(issue)
  })

  it('gives a precise, value-free diagnostic when the live schema is missing', () => {
    expect(describeCatalogueIssue('schema-missing')).toMatch(/migrations 001–004/)
    expect(staffErrorMessage({ code: 'PGRST205', message: "Could not find the table 'public.profiles' in the schema cache" }, 'x')).toMatch(/database objects are missing/)
    expect(staffErrorMessage(new Error('Your session expired. Sign in again.'), 'x')).toBe('Your session expired. Sign in again.')
  })

  it('shows public customers a generic message in production and the diagnostic only in development', () => {
    expect(appSource).toContain("import.meta.env.DEV ? `Live catalogue unavailable (development diagnostic): ${describeCatalogueIssue(loadError)}` : loadError === 'not-configured' ? t('configError') : t('loadError')")
  })
})

describe('demo products are never presented as live vendor products', () => {
  it('uses demo catalogue data only in development when Supabase is not configured', () => {
    expect(appSource).toContain('const DEV_CUSTOMER_PREVIEW = import.meta.env.DEV && !supabase')
    const uses = [...appSource.matchAll(/demoCatalogueProducts/g)].map((match) => match.index ?? 0)
    const loaderUse = appSource.indexOf('setProducts(demoCatalogueProducts)') + 'setProducts('.length
    expect(uses.filter((index) => index !== loaderUse && !appSource.slice(index - 200, index).includes('import {'))).toEqual([])
    expect(appSource.slice(loaderUse - 140, loaderUse)).toContain('if (DEV_CUSTOMER_PREVIEW) {')
  })

  it('labels every preview card as a sample and live cards as live', () => {
    expect(appSource).toContain('sample={DEV_CUSTOMER_PREVIEW}')
    expect(appSource).toContain("data-catalogue-source={sample ? 'sample' : 'live'}")
    expect(appSource).toContain('{sample ? <span className="product-sample-tag">Sample</span> : null}')
  })

  it('tells preview vendors their products will not reach the customer catalogue', () => {
    expect(appSource).toContain('will not appear in the customer catalogue')
  })

  it('keeps the demo catalogue consistent with the public visibility rule', () => {
    expect(demoCatalogueProducts.map((product) => product.id)).toEqual(demoProducts.filter((product) => product.is_active).map((product) => product.id))
  })
})

describe('public catalogue publishing rules (SQL contract for migration 003)', () => {
  const view = latestCatalogueView()

  it('shows only active products of approved, active vendors while the shop is active', () => {
    expect(view).toContain('where product.is_active')
    expect(view).toContain('and product.vendor_id is not null')
    expect(view).toMatch(/settings\.id = 1 and settings\.is_active/)
    expect(view).toContain("vendor_profile.role = 'vendor'")
    expect(view).toContain('and vendor_profile.is_active')
    expect(view).toContain("and application.status = 'approved'")
    expect(view).not.toMatch(/approved_by|product_approval|superadmin/i)
  })

  it('exposes only catalogue fields and no private vendor information', () => {
    const columns = view.slice(view.indexOf('select'), view.indexOf('from public.products'))
    for (const field of ['name_en', 'name_kn', 'description_en', 'description_kn', 'category', 'image_url', 'mrp', 'selling_price', 'stock_status', 'vendor_id']) {
      expect(columns).toContain(field)
    }
    expect(columns).not.toMatch(/phone|email|owner_name|business_name|location|whatsapp/)
    // Raw stock numbers are used only to derive stock_status, never selected as output columns.
    const withoutStockCase = columns.replace(/case[\s\S]*?end as stock_status/, '')
    expect(withoutStockCase).not.toMatch(/stock_quantity|low_stock_threshold/)
    expect(routingMigration).toContain('grant select on public.public_catalogue_products to anon, authenticated;')
    expect(approvalMigration).toContain('revoke select on public.products from anon;')
  })

  it('lets approved vendors write only their own products', () => {
    expect(approvalMigration).toMatch(/for insert to authenticated\s+with check \(public\.is_approved_vendor\(\) and vendor_id = \(select auth\.uid\(\)\)\)/)
    const update = approvalMigration.slice(approvalMigration.indexOf('create policy "Vendors can update their own products'), approvalMigration.indexOf('create policy "Vendors can delete their own products"'))
    expect(update.match(/public\.is_approved_vendor\(\) and vendor_id = \(select auth\.uid\(\)\)/g)).toHaveLength(2)
    expect(approvalMigration).toMatch(/for delete to authenticated\s+using \(public\.is_approved_vendor\(\) and vendor_id = \(select auth\.uid\(\)\)\)/)
  })

  it('stores product images in a public bucket under the owning vendor folder', () => {
    expect(initialMigration).toContain("values ('product-images', 'product-images', true,")
    expect(initialMigration).toMatch(/for select to anon, authenticated\s+using \(bucket_id = 'product-images'\)/)
    expect(approvalMigration).toMatch(/\(storage\.foldername\(name\)\)\[2\] = \(select auth\.uid\(\)\)::text\s+and public\.is_approved_vendor\(\)/)
    expect(appSource).toContain('uploadedPath = `products/${ownerId}/${crypto.randomUUID()}.${extensionFor(imageFile.type)}`')
  })
})

describe('product image handling', () => {
  it('builds the public URL the customer catalogue renders', () => {
    const client = createClient('https://abcdefghijk.supabase.co', 'public-anon-key')
    const url = client.storage.from('product-images').getPublicUrl('products/00000000-0000-4000-8000-000000000001/a.webp').data.publicUrl
    expect(url).toBe('https://abcdefghijk.supabase.co/storage/v1/object/public/product-images/products/00000000-0000-4000-8000-000000000001/a.webp')
    expect(productImageSrc(url)).toBe(url)
  })

  it('falls back when the image is missing or fails to load, without looping', () => {
    expect(productImageSrc(null)).toBe(fallbackProductImage)
    expect(productImageSrc('   ')).toBe(fallbackProductImage)
    const image = document.createElement('img')
    image.src = 'https://abcdefghijk.supabase.co/storage/v1/object/public/product-images/products/missing.webp'
    const event = { currentTarget: image } as unknown as Parameters<typeof applyImageFallback>[0]
    applyImageFallback(event)
    expect(image.src).toBe(fallbackProductImage)
    image.src = 'https://example.test/also-broken.png'
    applyImageFallback(event)
    expect(image.src).toBe('https://example.test/also-broken.png')
    expect(appSource.match(/onError=\{applyImageFallback\}/g)?.length).toBeGreaterThanOrEqual(4)
  })
})
