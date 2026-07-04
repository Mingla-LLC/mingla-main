# INVESTIGATION (MASTER SYNTHESIS) — META-ORCH-1237

**Admin full-visibility console — users, accounts, brands, events (RSVP + standard), trips, experiences, venues, Stripe status: view + edit + support.**

- **Phase:** INVESTIGATE (complete). Read-only, evidence-first. 4 parallel domain sweeps synthesized here.
- **Affected Surfaces:** Admin Web (`mingla-admin/`) only. Backend touch expected (admin-authz RLS/RPCs/edge fns). NOT in scope: consumer/business shipping apps, buyer-web.
- **Backend:** Supabase LIVE PROD `gqnoajqerqhnvulmnyvv`.
- **Domain reports (detail):**
  - `INVESTIGATION_META-ORCH-1237_ADMIN_ARCH_AUTHZ.md`
  - `INVESTIGATION_META-ORCH-1237_IDENTITY_USERS_ACCOUNTS_BRANDS.md`
  - `INVESTIGATION_META-ORCH-1237_OFFERINGS_EVENTS_TRIPS_EXPERIENCES_VENUES.md`
  - `INVESTIGATION_META-ORCH-1237_MONEY_STRIPE_ORDERS_SUBS.md`

---

## 1. EXECUTIVE TRUTH (what is real)

1. **The admin app is mature and the right host.** `mingla-admin/` is a Vite/React app (anon-key client, hash routing, ~18 pages, shared UI kit `components/ui/*` + `AppShell` + `CommandPalette`, `services/*` + `exportCsv`/`formatters`). We EXTEND it; we do not start over.
2. **The admin browser holds ONLY the anon key** (`mingla-admin/src/lib/supabase.js:4`) — never service_role. Every privileged action must flow through one of **3 proven server seams**: (a) `is_admin_user()`-gated RLS, (b) `admin_*` SECURITY DEFINER RPCs whose FIRST statement is `IF NOT is_admin_user() THEN RAISE`, (c) service_role edge fns that re-check `admin_users` and 403 otherwise. There are already ~80 `admin_*` RPCs to copy the idiom from.
3. **The canonical admin gate is `is_admin_user()`** (SECURITY DEFINER → `auth.uid()` → `auth.users.email` → `admin_users WHERE email=… AND status='active'`). Client allowlist/OTP is cosmetic; the DB gate is the real control.
4. **One `events` table is the hub for FOUR of the seven entities.** `events.event_type CHECK ('event','experience','trip','rsvp')` — trips (`trip_days`, `trip_pricing_tiers`, …), experiences (`experience_stops`), standard ticketed events (`ticket_types → orders → tickets`), and RSVP events (`event_rsvps`, `event_rsvp_guests`, `events.rsvp_*`) are all `events` rows + type-specific child tables. **Venues** (`venue_listings`) are the only offering stored separately. → The "offerings" admin surface is largely ONE unified, type-filtered screen + a venue/reservations screen, not four builds.
5. **Identity is unified.** One `auth.users`; `profiles` (consumer) + `creator_accounts` (business) share the same PK (`profiles.id = creator_accounts.id`, proven on all 13 business accounts). One "Person" view can show both halves + their brands + subscriptions + tickets.
6. **The money DATA already exists and is kept fresh.** The Stripe webhook pipeline (`stripe-webhook` → `routeStripeEvent`, idempotent) fully populates `stripe_connect_accounts` (charges/payouts enabled, `requirements`, derived status via `pg_derive_brand_stripe_status()`), `stripe_disputes`, `refunds`, `payouts`, `mingla_revenue_log`. **The gap is read/act AUTHORIZATION + UI, not data capture.**

## 2. THE GAP (what admin CANNOT do today — = Seth's ask)

Admin RLS/RPC coverage TODAY vs the target:

| Entity | Admin READ today | Admin EDIT/ACT today | Console page today |
|---|---|---|---|
| Consumer users (`profiles`) | ✅ full (RLS read+update) | ✅ core fields, disable(`active`), beta | UserManagementPage (consumer-only) |
| Business accounts (`creator_accounts`) | ❌ (1 fragile 2-field read via public-share RLS) | ❌ none | ❌ |
| Brands (`brands`) | ✅ (RLS read+update, `kind` alive) | ✅ permitted by RLS but only used by claims | ❌ (only via claims) |
| Team / invites (`brand_team_members`, `brand_invitations`, `partner_brand_links`) | ❌ none | ❌ none | ❌ |
| Events std/RSVP + trips + experiences (`events`+children) | ❌ public-published only | ❌ none | ❌ |
| RSVP guest lists (`event_rsvps`, `_guests`) | ❌ none | ❌ none | ❌ |
| Orders / tickets (`orders`, `tickets`, `ticket_types`) | ❌ none | ❌ none | ❌ |
| Venues (`venue_listings`) | ✅ READ (RLS) | ❌ no general edit; claim-state only | ❌ (claims queue only) |
| Reservations stack (`reservations`, settings, capacity, blackouts) | ❌ none | ❌ none | ❌ |
| Stripe Connect status (`stripe_connect_accounts`) | ❌ (only 2 mirrored booleans on `brands`) | ❌ (refresh/onboard are brand-JWT-gated → admin 403) | StripeModePage = env diagnostic, not per-brand |
| Refunds / disputes (`refunds`, `stripe_disputes`, `payouts`) | ❌ none | ❌ (brand-gated only → admin 403) | ❌ |
| Consumer subscriptions (`subscriptions`, overrides) | ✅ via RPCs | ✅ grant/revoke override + Global Plus | SubscriptionManagementPage |
| Support tickets (`support_tickets`) | ✅ all (RLS) | ✅ reply/status | SupportDeskPage (no money/offering context) |

**Bottom line:** for the entities Seth named — business accounts, brands (as an editable surface), the whole events/trips/experiences/RSVP hub, orders/refunds/disputes, per-brand Stripe status, venue details/reservations — admin has **no view, no edit, and no page**. Each needs net-new authorization infrastructure PLUS a console page. Consumer users + consumer subscriptions + venue-claims + support are the only areas partially built.

## 3. THE SAFE-BUILD PATTERN (proven, to copy)

- **READ:** add `is_admin_user()` SELECT policies (mirror `venue_listings`/`brands`) for non-sensitive visibility, OR read via `admin_*` SECURITY DEFINER RPCs where cross-table joins/derivation is needed (e.g. derived Stripe status, RSVP counts).
- **EDIT/ACT:** `admin_*` SECURITY DEFINER RPC with `IF NOT is_admin_user() THEN RAISE EXCEPTION` as the FIRST statement + a **server-side** `admin_audit_log` write; OR a service_role edge fn (`getUser(token)` + `admin_users` active-check → 403) for anything needing the Stripe API (refund, onboarding-link refresh, dispute action).
- **NEVER** put service_role in the browser bundle. **NEVER** ship a guard-less admin RPC (fails fully open).

## 4. RISKS & CONTRADICTIONS TO RESOLVE (foundation work)

1. **Split admin-identity model.** `brands`/most tables use `is_admin_user()` (`admin_users` table); `partner_*` tables use `profiles.account_type='admin'`. → **Standardize on `is_admin_user()`** before adding a wider write surface (foundation task).
2. **Audit is advisory & bypassable.** `admin_audit_log` is written client-side by `auditLog.logAdminAction()` (opt-in per call site, swallows errors); RLS/RPC writes don't self-audit. → A larger write surface REQUIRES **server-side audit inside every admin write RPC** (foundation task + invariant).
3. **Doc-vs-schema contradiction: `brands.kind`.** Memory says decommissioned; schema shows `kind NOT NULL DEFAULT 'popup' CHECK (physical/popup/trip_planner)` — decommission was product-layer only. → Reconcile in DECISION_LOG; the admin brand editor must treat `kind` as a live column.
4. **Pre-existing suspicious auth paths (out-of-domain, fold into foundation review):** `admin_set_city_live` is guard-less invoker-rights; the `delete-user` edge fn is a SELF-delete (deletes caller's own id) — there is **no safe admin arbitrary-user-delete path today**, so any "delete user" console action needs net-new, carefully-guarded infra. Registered as a risk, not yet an ORCH.
5. **Silent empty-read/failed-write** from RLS/RPC gaps: admin lists that quietly return only public rows look "working" but hide drafts/private/cross-brand data. Every admin read path must be proven against a known draft/private row.

## 5. PROPOSED PHASED BUILD PLAN (child ORCHs)

Sequenced so visibility ships fast and every edit power lands behind an audited, `is_admin_user()`-gated seam. Each child ORCH = its own worktree, spec, design (UI), implement, test, close.

- **ORCH-1271 — Admin authorization & audit FOUNDATION** *(must ship first; scope-independent)*. Standardize `is_admin_user()` as the single admin gate (retire `account_type='admin'` usage in the console's target tables); add a **server-side audited admin-write primitive** (shared RPC/edge-fn skeleton that guards + writes `admin_audit_log`); pre-stage the `I-ADMIN-WRITE-AUDITED` + `I-ADMIN-GATE-FIRST-STATEMENT` invariants + strict-grep gate; add an admin nav group ("Business") + shared entity-page scaffolding (list/detail/edit shell reusing `AppShell`/UI kit). Reconcile `brands.kind` in DECISION_LOG.
- **ORCH-1272 — Identity console** (users + accounts + brands). Unified **Person** view (consumer profile + business account + brands + subscriptions + tickets); **Brand** editor (profile, currency, `kind`, owner-reassign, suspend/soft-delete); **Team/Invites** (view roles, add/remove/change-role, resend/revoke). New admin RPCs on `creator_accounts`, `brand_team_members`, `brand_invitations`.
- **ORCH-1273 — Offerings console** (events std + RSVP, trips, experiences, venues). ONE unified cross-brand offerings list (type filter, status/visibility, search) + detail/edit; **RSVP guest console** (`event_rsvps` list, approve/deny, capacity/waitlist); **standard-event** ticket-tier + attendees view; **trips** itinerary/pricing view+fix; **experiences** stops view+moderate; **venues** details + reservations stack. Admin SELECT RLS + admin edit/state-change RPCs on the `events` hub + children + `venue_listings` write.
- **ORCH-1274 — Money console** (Stripe status + orders + refunds + disputes + subs support). Per-brand Connect status + `requirements` + admin refresh + re-onboarding link; order search + admin refund; dispute view/resolve; subscription support context. Admin-authz on the money edge fns (or admin twins) + admin read of `stripe_connect_accounts`/`orders`/`refunds`/`stripe_disputes`.
- **ORCH-1275 — Support glue + hardening** *(optional/last)*. Cross-nav Person/Brand ⇄ tickets ⇄ orders/Connect; wire money+offering context into `SupportDeskPage`; audit-coverage sweep; CSV exports; polish.

**Dependency:** 1271 blocks 1272/1273/1274 (they consume its authz+audit primitive + scaffolding). 1272/1273/1274 are largely independent of each other and could parallelize AFTER 1271. 1275 is last.

**ID note:** children numbered 1271-1275 (max+1 after a concurrent session registered META-ORCH-1270); the META itself remains 1237.

## 6. THE ONE DECISION FOR SETH (day-one write scope)

All three options build on the same foundation (1238) and the same audited-RPC pattern; they differ in **when EDIT powers land vs VISIBILITY**:

- **(A) Visibility-first** — every domain ships **read-only first** (full see-everything console fast), then edit/action powers layer in per domain. Fastest to "support can SEE all of it"; smallest security surface per release; edit arrives later.
- **(B) View+Edit per domain** *(Seth's literal ask: "see, edit, change")* — each domain ships view AND edit together. Full power per domain sooner; larger security/test surface per release; slower to first ship.
- **(C) Big-bang** — everything, read+write, in one release. Highest risk, longest before anything ships, hardest to test. **Not recommended.**

**Recommendation:** **(A) Visibility-first**, then edit per domain — it gets you "full visibility to help & support" in weeks not months, keeps each edit power behind a proven audited seam, and matches "proof before promotion." Edit is NOT dropped — it's phased right behind visibility, domain by domain.

Secondary safety recommendation (fold into 1238, no decision needed unless you object): **high-risk actions** (refund, owner-reassignment, user/brand delete, subscription cancel) require a **typed reason + confirm + server-side audit row**; consider a `super_admin` sub-tier for the destructive few. This is the guardrail that makes "full edit power" safe.

---

*Investigation complete. Awaiting the day-one scope decision (§6) before dispatching SPECs. Foundation (ORCH-1271) is scope-independent and can begin immediately on approval.*
