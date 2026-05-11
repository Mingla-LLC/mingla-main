# Security Protocol

Security findings are minimum P1. Auth bypass, data exposure, payment/order/ticket integrity, secret leakage, or RLS bypass are P0.

## Attack Surface

Map:

- Edge functions, RPCs, webhooks.
- Supabase direct table access and RLS.
- Realtime channels.
- Storage buckets and paths.
- Mobile/business/admin clients.
- Public web/event pages.
- Deep links and notification links.
- Payment/subscription/order/ticket flows.
- Admin/support tools.

## Authentication

Check:

- OAuth/OTP/token validation.
- Rate limits and attempt limits.
- Token refresh path and 401 behavior.
- Sign-out clears React Query, Zustand, AsyncStorage, subscriptions, tokens, push registration where relevant.
- Admin auth and role checks.
- Webhook signature verification.

## Authorization / RLS

For touched tables:

`Table | anon | authenticated own | authenticated other | admin | service_role | Notes`

Check:

- RLS enabled.
- SELECT/INSERT/UPDATE/DELETE policies cover app operations.
- Wrong actor cannot read/write.
- Policies handle `auth.uid()` null.
- No unsafe `USING (true)` on user data.
- Service-role edge functions enforce actor/role manually.
- Block/friend/team/brand/org permissions are bidirectional where needed.

## Data Exposure

Check:

- API responses return only needed fields.
- Error messages do not leak schema, existence, tokens, or stack traces.
- Logs do not include tokens, service keys, OTPs, PII, payment secrets, webhook payload secrets.
- Client bundles do not contain service-role keys or third-party server keys.
- Location privacy and Go Dark/block visibility hold.
- Public pages expose only public data.

## Input Validation

Check:

- Required fields, types, ranges, formats.
- State transitions are allowed from current state.
- IDs are validated and actor-owned.
- JSON parsing safely handles malformed payloads.
- Storage/file paths sanitize user input.
- Search/display names cannot inject HTML/admin UI.
- SQL uses parameterized APIs, not string interpolation.

## Third-Party And Payments

Check:

- API keys come from env/secret stores.
- External responses are validated.
- Timeouts and retries are safe.
- Idempotency exists for webhooks, charges, orders, tickets, notifications.
- Stripe/RevenueCat state matches DB and UI.
- Refunds, failed payments, 3DS, Connect onboarding, account disabled/restricted states are not silently accepted.

## Admin Security

Check:

- Admin-only endpoints verify admin role.
- Destructive actions confirm and audit.
- Admin cannot escalate own privileges.
- Support/admin data access is logged if the feature requires it.

## Report Format

For each finding:

- Severity.
- Entry point.
- File/line/schema/policy.
- Exploit or wrong-actor scenario.
- Impact.
- Required fix.
- Retest step.
