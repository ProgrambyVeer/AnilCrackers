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

#### Supabase configuration validation

`src/lib/supabase-config.ts` validates the browser settings before any Supabase client is created:

- The URL must be `https://` (plain `http://` is allowed only for `localhost` or `127.0.0.1`).
- The key must be a public anon or publishable key.
- PostgreSQL or pooler connection strings, `YOUR_…` placeholders, personal access tokens (`sbp_…`), secret keys (`sb_secret_…`) and service-role JWTs are rejected.

When the settings are invalid:

- Development falls back to the sample-data preview and shows a "Supabase not connected" notice naming the problem.
- Production builds show a "Site configuration required" page on every route. They never fall back to mock authentication.
- Neither message includes configuration values.

`vite.config.ts` also excludes any `VITE_*` value shaped like a database connection string or secret credential from the browser bundle. It logs only the variable name. Vite inlines every `VITE_*` value into public JavaScript, so a credential that was ever placed in one must be treated as exposed and rotated.

## Supabase setup

1. Create a Supabase project and open its SQL Editor.
2. Review the ordered migrations before any database action:
   - [`202611020001_initial_platform.sql`](./supabase/migrations/202611020001_initial_platform.sql)
   - [`202611020002_stock_vendor_approval.sql`](./supabase/migrations/202611020002_stock_vendor_approval.sql)
   - [`202611020003_vendor_routing_privacy.sql`](./supabase/migrations/202611020003_vendor_routing_privacy.sql)
   - [`202611040004_protected_interest_submission.sql`](./supabase/migrations/202611040004_protected_interest_submission.sql)
   Apply them only through an explicitly approved migration process. Do not edit or replay a migration already recorded as applied.
3. Configure Google under **Authentication → Providers → Google**. Add the Google client ID and secret in Supabase (never in this repository).
4. In the Google OAuth client's authorized redirect URIs, add `https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback`. In Supabase **Authentication → URL Configuration**, set the Site URL to the deployed Vercel domain and add `http://localhost:5173/**` plus the production app origin to the allowed redirect URLs.
5. Add the project API URL (`https://YOUR_PROJECT_REF.supabase.co`) and public anon/publishable key to `.env.local`. Never use the database pooler URL or a personal access token as the browser key.
6. Sign in once using the intended Google administrator account, independently verify its confirmed `auth.users` UUID in the trusted Supabase SQL Editor, then follow [`supabase/manual/first_superadmin.sql`](./supabase/manual/first_superadmin.sql). The script requires the UUID and a confirmation phrase, and refuses to elevate a user with an existing profile or create another initial Super Admin. A transaction-level advisory lock serializes executions through the check and insert; the script requires READ COMMITTED isolation so a waiting execution sees the committed administrator. Keep the whole DO block together; do not remove its guards or run provisioning through application code. If a manually provisioned Super Admin already exists, preserve that account and do not run the initial provisioning script.

7. A vendor signs in at `/vendor` with Google and submits the business application using a valid Indian mobile number. It is normalized and kept private in the vendor application. The Super Admin reviews applications in **Vendor management** at `/admin`; only approval creates an active vendor profile.
8. Add products in `/vendor`, including both language names and descriptions, stock quantity, and low-stock threshold. Customers see stock status only. Interest enquiries never reserve or decrement stock. Image uploads are limited to JPG, PNG, WebP, or AVIF up to 5 MB. Products with no price remain unpriced; no zero price is implied.
9. A customer interest list may contain products belonging to one vendor only. The database enforces this rule and checks that the vendor is active and approved before recording an enquiry. The WhatsApp destination comes from that vendor's private application phone and is returned only after the enquiry is saved. The customer must explicitly open WhatsApp; no message is sent automatically.
10. Shop settings configure the public shop name, address, description, logo, and availability. The legacy shop-level WhatsApp field is not used for customer routing.

### OAuth callback checklist

- Supabase Google provider: OAuth client ID and secret are configured in Supabase Auth.
- Google OAuth authorized redirect URI: `https://YOUR_PROJECT_ID.supabase.co/auth/v1/callback`.
- Supabase Site URL: the application origin (Vercel domain in production).
- Supabase allowed redirect URLs: local Vite origin and production origin.
- On the Google consent screen, configure publishing/test-user settings appropriate for the two staff Google accounts.

## Security model

- Supabase Auth Google OAuth identifies staff. The UI checks the authenticated profile for usability; PostgreSQL RLS policies and grants are the actual authorization boundary.
- Only an active, approved `vendor` or `superadmin` profile can read enquiries. Vendors can read or update an enquiry only when every item in it belongs to that vendor; an enquiry containing mixed, missing, or deleted product ownership is hidden from vendors. Item snapshots have the same whole-enquiry ownership check. Super Admins retain platform-wide access. Vendors can manage only products assigned to their profile, including stock quantity and low-stock threshold. Super Admins can change product visibility but cannot edit stock or catalogue details. Only `superadmin` can update shop settings or use audited database functions to approve, reject, suspend, or reactivate vendors.
- Staff profiles cannot be created or promoted through the browser. The initial roles are provisioned in the SQL Editor. The vendor cannot assign a Super Admin role.
- Google-authenticated applicants can read only their own vendor application. Super Admins can review applications and audit events. Pending applicants have no staff profile; rejected applications can be resubmitted. Approval/rejection and access changes record the administrator profile ID and timestamp.
- Anonymous users can read active catalogue products only while the shop and owning vendor are active and approved. The public projection exposes stock status and a vendor UUID for single-vendor cart validation, but not exact quantities, vendor phone numbers, profiles, enquiries, or enquiry items. Public shop settings are limited to active shop data.
- Customers submit through the `submit-interest` Edge Function. After migration 004, `submit_interest` and the limiter/replay RPCs are executable by `service_role` only, not by `PUBLIC`, `anon`, or `authenticated`. The Edge Function uses its own runtime-provided server identity and never forwards the browser's Authorization header to the database. The database RPC still validates product availability, quantities, single-vendor ownership, approval and phone destination, and writes the enquiry and snapshots atomically. It never modifies stock.
- The `product-images` bucket is public-read for catalogue imagery; vendor product-image writes are scoped to the vendor's storage folder, and shop-image writes require Super Admin. Only image MIME types are accepted and the bucket caps files at 5 MB.
- Customer interest quantities are stored in that browser's localStorage. Enquiry submission does not decrement stock. WhatsApp is offered only after the database confirms a saved enquiry, and opening the link remains a customer action.
- The browser uses only the Supabase anon/publishable key. Never expose the Supabase service-role key.

### Protected submission architecture and activation blockers

The implementation exists locally; **CAPTCHA and rate limiting are not deployed, configured, or verified live**. No migration or function was applied. Any older installed database may still expose the original direct RPC until migration 004 is approved and applied. Both new frontend and server default to submissions disabled; catalogue browsing and local interest persistence continue to work.

[`supabase/functions/submit-interest`](./supabase/functions/submit-interest/) validates actual request bytes (16 KiB maximum), field types, Indian mobile numbers, UUIDs, distinct items, quantities 1–99, and at most 30 products. It rejects client vendor IDs, WhatsApp numbers, and unknown fields. Its order is validation → shared rate-limit RPC → server CAPTCHA verification → atomic token claim → existing atomic enquiry RPC. Rate-limit attempts intentionally persist even when CAPTCHA or enquiry validation fails. The response includes only `reference_code` and the database-derived `whatsapp_number`; no customer record or internal enquiry UUID is returned. The browser never automatically opens or sends WhatsApp.

CAPTCHA is provider-neutral at the configuration boundary: choose `turnstile` or `hcaptcha` with matching public site key and server secret. The browser widget produces a token; the server calls the provider's fixed HTTPS Siteverify endpoint, requires `success: true`, an allowlisted hostname and a timestamp at most five minutes old, and rejects token reuse through a unique PostgreSQL token-hash row. hCaptcha additionally receives the expected site key. There is no development CAPTCHA bypass. Provider/network failures fail closed. Selecting a provider also requires reviewing its privacy/cookie disclosures and hostname configuration before activation.

The distributed limiter uses PostgreSQL, not process memory or Redis. All Edge instances call the same service-only RPC on the same primary database. Primary-key UPSERT row locks atomically increment independent fixed-window counters: **3 attempts per IP per UTC minute, 20 per IP per UTC hour, and 5 per normalized phone per UTC hour**. Rotating a phone cannot bypass the IP limits; rotating an IP cannot bypass the phone limit. Fixed windows can allow traffic on both sides of a boundary; these are not rolling-window guarantees. Limits include failed CAPTCHA attempts. All instances must share the same HMAC secret; changing it resets effective identity buckets and should not be done during an attack. IP/phone/token values are HMAC-SHA-256 hashes, never raw values, in an unexposed `interest_security` schema with RLS and no client privileges. Expired buckets/tokens are deleted in bounded, indexed batches on subsequent calls; an approved retention job should remove remaining expired hashes if traffic stops. The 15-minute replay retention exceeds the maximum accepted CAPTCHA age. This design needs no external rate-limit service, but database capacity and concurrent-limit behavior must be load-tested.

**Client-IP trust is an activation requirement, not a header-name assumption.** Configure one header containing a single IP that your gateway overwrites on *every* request path, including direct access to the function origin. Arbitrary client headers, an unverified `X-Forwarded-For` first entry, or a Cloudflare-only header when the origin remains publicly bypassable are unsafe. There is no fallback to another header or `"unknown"` bucket. Missing/malformed/multi-IP values fail closed. Confirm with spoofed-header and direct-origin tests before setting `INTEREST_TRUSTED_IP_VERIFIED=true`; if the hosting gateway cannot guarantee overwrite, keep submissions disabled and obtain an approved trusted gateway design. CORS is not an authentication or bot-protection boundary.

#### Configuration (placeholders only)

Browser build settings are in [`.env.example`](./.env.example). Only public values belong here:

```dotenv
VITE_INTEREST_SUBMISSION_ENABLED=false
VITE_CAPTCHA_PROVIDER=CHOOSE_TURNSTILE_OR_HCAPTCHA
VITE_CAPTCHA_SITE_KEY=YOUR_PUBLIC_CAPTCHA_SITE_KEY
```

Server-only settings are in [`supabase/functions/.env.example`](./supabase/functions/.env.example):

```dotenv
INTEREST_SUBMISSION_ENABLED=false
INTEREST_CAPTCHA_PROVIDER=CHOOSE_TURNSTILE_OR_HCAPTCHA
INTEREST_CAPTCHA_SITE_KEY=YOUR_PUBLIC_CAPTCHA_SITE_KEY
INTEREST_CAPTCHA_SECRET=YOUR_SERVER_CAPTCHA_SECRET
INTEREST_CAPTCHA_HOSTNAMES=YOUR_CUSTOMER_HOSTNAME
INTEREST_ALLOWED_ORIGINS=https://YOUR_CUSTOMER_HOSTNAME
INTEREST_RATE_HASH_SECRET=YOUR_RANDOM_SERVER_SECRET_AT_LEAST_32_CHARACTERS
INTEREST_TRUSTED_IP_HEADER=YOUR_GATEWAY_OVERWRITTEN_SINGLE_IP_HEADER
INTEREST_TRUSTED_IP_VERIFIED=false
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` must come from the trusted Edge runtime, never the browser. The service identity bypasses RLS: restrict access to function secrets and never log its key, upstream error bodies, CAPTCHA tokens, customer bodies, or phone numbers. Only fixed diagnostic codes are logged by this handler. Hostnames/origins accept comma-separated exact entries; origins include scheme/port and no trailing slash, hostnames do not. Use a securely generated random HMAC secret of at least 32 characters. Keep real secrets in ignored local files or server secret management, not either example file.

`[functions.submit-interest] verify_jwt=false` deliberately permits unauthenticated customers; all validation, CAPTCHA, limiter and replay gates remain mandatory inside the handler. Provider URLs and database RPC names are fixed by code, not client-controlled.

After explicit approval: apply outstanding migrations in order, install the function with its server secrets while disabled, verify grants, RLS, rate-limit concurrency, CAPTCHA expiry/replay/wrong-host rejection, trusted IP behavior and stock/rollback tests in disposable local/staging infrastructure. Then enable the server flag and finally the frontend flag with matching provider/site key. Rollback/incident response should disable the server flag and retain service-only RPC grants; never re-grant direct browser submission. No database or deployment action was performed for this implementation.

## Data privacy and retention

Enquiry name, phone number, selected products, and timestamps are collected only to respond to the customer's request. They are visible to the Super Admin and to the vendor responsible for every product in that enquiry; they are not displayed in the public catalogue. Tell customers that the responsible vendor and authorized platform administrators receive these details before they submit.

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

`npm run test` covers stock/interest helpers, static SQL authorization contracts, mocked Edge validation/CAPTCHA/limiter failure and success paths, frontend invocation, widget lifecycle, and English/Kannada text. It makes no external CAPTCHA/database calls and does **not** prove deployed grants, database concurrency or stock preservation.

Database-only tests require disposable local Supabase with approved migrations 001–004 and pgTAP; they were **not executed** here:

- [`vendor_enquiry_isolation.test.sql`](./supabase/tests/vendor_enquiry_isolation.test.sql): actual vendor A/B/customer privacy and status update RLS, mixed/deleted products, Super Admin access.
- [`protected_interest.test.sql`](./supabase/tests/protected_interest.test.sql): actual direct RPC denial for anon/authenticated, independent counters, replay claims, server-derived destination, stock preservation, inactive/suspended vendor and product rejection, and rollback after partial item processing. Tests roll back their fixtures.
- [`first_superadmin_concurrency.mjs`](./supabase/tests/first_superadmin_concurrency.mjs): explicitly opt-in two-connection PostgreSQL test using the **actual manual script**, checks the second session is waiting on the advisory lock and only the first UUID gains a role. Requires `psql`, an empty initial Super Admin state, and the disposable CLI database at hardcoded `127.0.0.1:54322`. It creates/removes test UUIDs only. Run only after separately approving local test database actions: `node supabase\tests\first_superadmin_concurrency.mjs --disposable-local-only`. This is a test harness, not a production provisioning workflow.

The Edge handler is type-checked by `npm run build`; the small Deno entrypoint and hosted Edge runtime still require `deno check`/local function serving in an approved environment (Deno is not installed here). Real provider credentials/hostnames are required for live CAPTCHA checks. Never run database tests against production.

Source review: migration 002 gates product reads/writes on active approved ownership, prevents owner transfer through `WITH CHECK`, limits Super Admin edits to visibility through its trigger, revokes anonymous direct product SELECT and profile UPDATE, and scopes image writes. Migration 003 scopes enquiry/item access to whole-enquiry ownership and permits only status-column updates via the original grant; mixed/deleted-product enquiries are hidden from vendors. The reviewed SECURITY DEFINER functions use an empty search path and qualified objects. These are source conclusions, not a statement that production has those migrations or grants installed.

## Deploy to Vercel

1. Push this repository to a private GitHub repository.
2. Import that repository into one Vercel project.
3. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in Vercel project environment variables for Preview and Production.
4. Deploy. [`vercel.json`](./vercel.json) rewrites direct route visits and refreshes (`/vendor`, `/admin`) to the React app.
5. Add the deployment domain under Supabase Auth's allowed redirect URLs and configure it as the Supabase Site URL.
6. Add `anilcrackers.teranode1.com` to Vercel's domain settings and configure the DNS records Vercel specifies with the domain/DNS provider. No DNS or production changes have been made by this project.
7. Verify the customer route, Google login for each provisioned role, and authorization using both accounts before announcing the site.

## Current setup boundaries

This repository contains the frontend, local migrations, policies, tests, and deployment configuration. Production database state, applied migration history, OAuth settings, and deployment state must be verified by an authorized operator; they are not inferred from local files. No database or deployment action is part of local implementation work.
