# Anil Crackers Interest Platform

One responsive React application for the public customer catalogue, Anil's vendor workspace, and the Super Admin console. All three routes use one Supabase project:

- `/` — public catalogue and interest-only WhatsApp enquiry
- `/vendor` — Google-authenticated vendor workspace
- `/admin` — Google-authenticated Super Admin console

Customer enquiries are not orders. The platform does not accept payment, reserve stock, book delivery, or automatically send WhatsApp messages.

## Requirements

- Node.js 20.19.x or 22.12+
- A Supabase project
- A Google OAuth client configured through Supabase Auth

## Run locally

```powershell
npm install
Copy-Item .env.example .env.local
```

Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in `.env.local` using the Supabase project URL and the public anon/publishable key. Never put a `service_role` key in a Vite variable or browser code.

```powershell
npm run dev
```

Vite prints the local URL. Open `http://localhost:5173/`, `http://localhost:5173/vendor`, or `http://localhost:5173/admin`. When Supabase is not configured, development shows a sample customer catalogue and in-memory staff previews so each portal can be inspected. Preview edits are discarded on refresh; customer enquiry submission is disabled and no database or storage operations are performed.

If Supabase is configured but Google OAuth is not ready, set `VITE_DEV_PORTAL_PREVIEW=true` in `.env.local` to preview staff screens without authentication. This override only works in Vite development mode, does not create a session or change roles, and preview staff changes remain in memory. Restart Vite after changing environment variables. Production always requires Google authentication and database role verification.

## Supabase setup

1. Create a Supabase project and open its SQL Editor.
2. Run [`supabase/migrations/202611020001_initial_platform.sql`](./supabase/migrations/202611020001_initial_platform.sql).
3. Configure Google under **Authentication → Providers → Google**. Add the Google client ID and secret in Supabase (never in this repository).
4. In the Google OAuth client's authorized redirect URIs, add `https://YOUR_PROJECT_ID.supabase.co/auth/v1/callback`. In Supabase **Authentication → URL Configuration**, set the Site URL to the deployed Vercel domain and add `http://localhost:5173/**` plus the production app origin to the allowed redirect URLs.
5. Add the Supabase URL and anon/publishable key to `.env.local`.
6. In the SQL Editor, provision the manually controlled Super Admin account. Replace the placeholder with the actual Google account email; the account must first sign in once through `/admin` so it exists in `auth.users`.

```sql
-- Replace this email placeholder with the platform owner's Google account address.
insert into public.profiles (id, display_name, role, is_active)
select id, coalesce(raw_user_meta_data->>'full_name', email), 'superadmin', true
from auth.users
where lower(email) = lower('YOUR_SUPER_ADMIN_GOOGLE_EMAIL')
on conflict (id) do update
set role = excluded.role, is_active = true, display_name = excluded.display_name;
```

7. After the Super Admin profile exists, review and apply the incremental [`202611020002_stock_vendor_approval.sql`](./supabase/migrations/202611020002_stock_vendor_approval.sql) migration. It adds stock, vendor ownership, application review, audit history, and stricter access policies. Do not apply it to production until the migration has been reviewed and explicitly approved. Existing vendor profiles are carried forward as approved records; historical reviewer identities are not fabricated.
8. A vendor signs in at `/vendor` with Google and submits the business application. The Super Admin reviews it in **Vendor management** at `/admin`; only approval creates an active vendor profile. Pending vendors cannot manage products or read enquiries.

9. Set the shop WhatsApp number, address, description, and status in `/admin`. The number must include its country code (for example, `91` followed by the Indian mobile number). The initial shop record is created by the migration with an empty WhatsApp number; enquiry submission stays disabled until it is configured.
10. Add products in `/vendor`, including both language names and descriptions, stock quantity, and low-stock threshold. Customers see stock status only. Interest enquiries never reserve or decrement stock. Image uploads are limited to JPG, PNG, WebP, or AVIF up to 5 MB. Products with no price remain unpriced; no zero price is implied.

### OAuth callback checklist

- Supabase Google provider: OAuth client ID and secret are configured in Supabase Auth.
- Google OAuth authorized redirect URI: `https://YOUR_PROJECT_ID.supabase.co/auth/v1/callback`.
- Supabase Site URL: the application origin (Vercel domain in production).
- Supabase allowed redirect URLs: local Vite origin and production origin.
- On the Google consent screen, configure publishing/test-user settings appropriate for the two staff Google accounts.

## Security model

- Supabase Auth Google OAuth identifies staff. The UI checks the authenticated profile for usability; PostgreSQL RLS policies and grants are the actual authorization boundary.
- Only an active, approved `vendor` or `superadmin` profile can read enquiries. Vendors can manage only products assigned to their profile, including stock quantity and low-stock threshold. Super Admins can change product visibility but cannot edit stock or catalogue details. Only `superadmin` can update shop settings or use audited database functions to approve, reject, suspend, or reactivate vendors.
- Staff profiles cannot be created or promoted through the browser. The initial roles are provisioned in the SQL Editor. The vendor cannot assign a Super Admin role.
- Google-authenticated applicants can read only their own vendor application. Super Admins can review applications and audit events. Pending applicants have no staff profile; rejected applications can be resubmitted. Approval/rejection and access changes record the administrator profile ID and timestamp.
- Anonymous users can read active catalogue products only while the shop is active, through a public projection that exposes stock status but not exact quantities, vendor IDs, profiles, enquiries, or enquiry items. Public shop settings are limited to active shop data.
- Anonymous enquiry submission uses the `submit_interest` PostgreSQL function. It validates customer inputs, verifies active products and quantities, and derives historical product names and prices from the database in one transaction. The browser does not submit prices.
- The `product-images` bucket is public-read for catalogue imagery; vendor product-image writes are scoped to the vendor's storage folder, and shop-image writes require Super Admin. Only image MIME types are accepted and the bucket caps files at 5 MB.
- Customer interest quantities are stored in that browser's localStorage. Enquiry submission does not decrement stock. WhatsApp is offered only after the database confirms a saved enquiry, and opening the link remains a customer action.
- The browser uses only the Supabase anon/publishable key. Never expose the Supabase service-role key.

## Data privacy and retention

Enquiry name, phone number, selected products, and timestamps are collected only to respond to the customer's request. They are visible only to authorized staff and are not displayed in the public catalogue. Tell customers that the shop receives these details before they submit.

Suggested retention: delete customer enquiry records and their product snapshots 90 days after the Deepavali season unless the customer or applicable law requires earlier or longer retention. A Super Admin can run this reviewed cleanup in the Supabase SQL Editor:

```sql
delete from public.enquiries
where created_at < now() - interval '90 days';
```

Deleting an enquiry cascades to its item snapshots. For an individual deletion, first verify the `reference_code`, then run `delete from public.enquiries where reference_code = 'AC-...';`. Do not export enquiry data unless it is needed for shop operations, and securely remove any exported copy.

## Development and validation

```powershell
npm run test
npm run lint
npm run build
```

The test suite covers stock calculations and validation, local customer-interest persistence, migration authorization contracts, customer form validation, WhatsApp message generation, and English/Kannada translations. A live Supabase project and its Google credentials are required to exercise authenticated database operations end-to-end.

## Deploy to Vercel

1. Push this repository to a private GitHub repository.
2. Import that repository into one Vercel project.
3. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in Vercel project environment variables for Preview and Production.
4. Deploy. [`vercel.json`](./vercel.json) rewrites direct route visits and refreshes (`/vendor`, `/admin`) to the React app.
5. Add the deployment domain under Supabase Auth's allowed redirect URLs and configure it as the Supabase Site URL.
6. Add `anilcrackers.teranode1.com` to Vercel's domain settings and configure the DNS records Vercel specifies with the domain/DNS provider. No DNS or production changes have been made by this project.
7. Verify the customer route, Google login for each provisioned role, and authorization using both accounts before announcing the site.

## Current setup boundaries

The frontend, SQL migration, role policies, storage policies, tests, and deployment configuration are prepared locally. No Supabase project, Google credentials, GitHub repository, Vercel project, DNS, or production deployment was available or changed here. The project does not fabricate sample products or enquiry data when Supabase is unavailable; the customer UI reports the configuration/load state instead.
