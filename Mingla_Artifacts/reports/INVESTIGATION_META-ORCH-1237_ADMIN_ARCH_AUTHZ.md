# INVESTIGATION — META-ORCH-1237 [Admin full-visibility console] — Admin architecture, coverage & the authorization seam

**Phase:** INVESTIGATE (read-only). **Author:** mingla-forensics. **Date:** 2026-07-03.
**Backend:** Supabase LIVE PROD `gqnoajqerqhnvulmnyvv`. All DB evidence via read-only `execute_sql` SELECT / `get_advisors`.
**Scope:** Domain 1 of META-ORCH-1237 — the admin console's existing coverage and the authorization pattern any new "full CRUD over prod business entities" pages must follow. NO fix, NO spec here.

COMMS ledger scanned on entry: no OPEN `BLOCK`/`WARN` entry targets forensics, META-ORCH-1237, or `ALL` that is actionable (only historical COMMS-0059, an ORCH-1209/1210 branch-renumber notice). Nothing to ack.

---

## Headline findings

1. **The admin browser holds ONLY the anon key** (`mingla-admin/src/lib/supabase.js:4` — `VITE_SUPABASE_ANON_KEY`). Confirmed: every privileged read/write flows through one of exactly THREE server-side seams — (a) `is_admin_user()`-gated **RLS policies** on a curated table set, (b) ~80 `admin_*` **SECURITY DEFINER RPCs** that self-gate on `is_admin_user()`, or (c) **service_role edge functions** that re-check `admin_users` internally. There is no fourth path and no service_role in the browser.

2. **The canonical server-side admin gate is the SQL function `is_admin_user()`** (SECURITY DEFINER, STABLE): resolve `auth.uid()` → `auth.users.email` → `EXISTS(SELECT 1 FROM admin_users WHERE email=… AND status='active')`. `admin_users(id,email,role,status,invited_by,created_at,accepted_at)` is the allowlist table; `status` ∈ invited/active/revoked. Client gating (`ALLOWED_ADMIN_EMAILS=['seth@usemingla.com']` hardcoded fallback + dynamic `get_admin_emails()` + 2FA password/OTP) is cosmetic — the DB gate is the real one.

3. **The core business entities the new console targets are UNREACHABLE by admins today.** `events`, `orders`/`order_line_items`/`tickets`/`ticket_types`, `event_rsvps`/`event_rsvp_guests`/`event_dates`, `creator_accounts`, `subscriptions`, and all `stripe_connect_*` tables have RLS ENABLED but **ZERO admin policies** — their policies are owner/brand-team/buyer-scoped (`biz_*` rank functions) or public-read. An admin's anon session (whose `auth.uid()` is not a brand member) can read only PUBLIC events and can WRITE nothing to these tables. No `admin_*` RPC covers them either.

4. **`events` is the single parent table for ALL offering types** — events, trips (`trip_days`), experiences (`experience_stops`), and RSVP events (`event_rsvps`) all FK to `events.id` (proven via FK graph). Ticketing chains `orders → order_line_items/tickets → ticket_types → events`. So "events (RSVP+standard) + trips + experiences" is ONE entity family with child tables, not five separate tables — this simplifies the console's data model but concentrates the missing-authz gap on one hub table.

5. **The proven safe-write pattern already exists in TWO flavors** the new console can reuse verbatim: (a) SECURITY DEFINER RPC with `IF NOT public.is_admin_user() THEN RAISE EXCEPTION` as the first statement (e.g. `admin_grant_override`, `admin_set_platform_take_rate`); (b) service_role edge fn that does `getUser(token)` then `admin_users` active-check → 403 (e.g. `admin-seed-places`, `backfill-place-photos`, `admin-place-search`, `careers-cv-signed-url`), with `verify_jwt` defaulting to `true` (no config.toml override for any admin fn).

6. **Audit logging exists but is advisory/bypassable, not enforced.** `admin_audit_log` (RLS: INSERT+SELECT gated by `is_admin_user()`) is written by `auditLog.logAdminAction()` — a **client-side, best-effort, manually-called** insert. The SECURITY DEFINER mutation RPCs do NOT write audit rows themselves. Any mutation where the page author forgot to call `logAdminAction` (or a direct DB write) is silently unaudited.

7. **A partial admin RLS surface already exists on `brands`, `profiles`, `venue_listings` and place/rules/config tables** — `profiles` (admin read-all + update-all), `brands` (admin read + update-for-claim-review), `venue_listings` (admin READ only, no write), `place_pool` (admin update), plus `seeding_*`, `feature_flags`, `app_config`, `integrations`, `rule_*`, `support_*`, `user_reports`, and all `admin_*` tables. So a "users / brands" console is partly buildable via existing RLS; an "events / orders / venues-write / accounts / Stripe" console is NOT.

8. **Security posture is otherwise deny-by-default and healthy for the gap-fill.** `get_advisors(security)`: no core business table has RLS *disabled* (the 12 `rls_disabled_in_public` are `_backup_*`/`_archive_*`/`spatial_ref_sys`/PostGIS). 16 `rls_enabled_no_policy` tables (`orders`? no — `payment_webhook_events`, `mingla_revenue_log`, `job_applications`, `reservation_checkout_sessions`, etc.) are intentionally service-role-only. The 270+314 "security_definer_function_executable by anon/authenticated" advisories are EXPECTED for the admin-RPC pattern — they make the internal `is_admin_user()` guard load-bearing (any authenticated user can *call* `admin_grant_override`; only the guard stops them).

---

## Existing-coverage table (entity → page → read? → edit? → mechanism)

| Admin page (`mingla-admin/src/pages/`) | Entity | Read | Edit | Mechanism (proof) |
|---|---|---|---|---|
| `OverviewPage.jsx` | Dashboard stats + recent activity | Y | N | direct table counts (`STAT_CARDS`, RLS-gated) + `admin_audit_log` read |
| `AdminPage.jsx` | `admin_users` | Y | Y | **direct** `.from("admin_users").insert/update` (RLS `is_admin_user()`), lines 169/201/231/249 |
| `SubscriptionManagementPage.jsx` | subscriptions / overrides | Y | Y | RPC `admin_list_subscriptions`, `admin_subscription_stats`, `admin_grant_override`, `admin_revoke_override`, `admin_get_override_history`; direct `admin_subscription_overrides` read is own-scope only (RLS `auth.uid()=user_id`) |
| `UserManagementPage.jsx` | `profiles` (consumer users) | Y | Y | read via `profiles_with_segment` view; ban/edit via **direct** `profiles.update` (RLS admin update-all); `admin_toggle_partner` RPC; delete via direct batch-delete + `delete-user` edge fn — **see Discovery D-1 (delete path suspect)** |
| `PlacePoolManagementPage.jsx` | `place_pool`, `seeding_cities` | Y | Y | direct `place_pool`/`seeding_cities` writes (RLS) + `admin_*` RPCs + `admin-seed-places`/`backfill-place-photos` edge fns |
| `LaunchCitiesPage.jsx` | `seeding_cities.is_live_for_consumers` | Y | Y | RPC `admin_set_city_live` (**invoker-rights, no internal guard** — relies on `admin_write_seeding_cities` RLS) + direct `seeding_cities.update` |
| `SignalLibraryPage.jsx` / `DeckScoreTunerPage.jsx` | `place_scores`, `signal_definitions` | Y | Y | direct reads + `admin_set_place_signal_score`/`admin_apply_score_override`/`admin_pin_place_to_top` RPCs + `run-signal-scorer` edge fn |
| `PlaceIntelligenceTrialPage.jsx` | trial runs | Y | Y(run) | `run-place-intelligence-trial` edge fn + `place_intelligence_trial_runs` read (RLS) |
| `EmailPage.jsx` | `email_templates`, `admin_email_log` | Y | Y | direct CRUD (RLS) + `marketing-send` edge fn |
| `BetaLeadsPage.jsx` | beta/explorer leads | Y | **N** | RPC `admin_beta_leads_list` (read-only) |
| `CareersPage.jsx` | postings + `job_applications` | Y | Y | `admin_careers_*` / `admin_job_applications_list` / `admin_set_job_application_status` RPCs + `careers-cv-signed-url` edge fn |
| `PricingPage.jsx` | platform + per-brand take rate | Y | Y | `admin_get_pricing_config` / `admin_set_platform_take_rate` / `admin_set_brand_take_rate_override` RPCs |
| `ClaimsPage.jsx` | venue claims (`brands`/`venue_listings`) | Y | Y | RPC `admin_get_claim_review_bundle` + `admin-review-venue-claim` edge fn (approve/reject/need-info) |
| `SupportDeskPage.jsx` | `support_tickets`, `messages`, `brands` | Y | Y | direct reads (RLS `is_admin_user()`/`is_support_staff`) + `support-claim`/`support-send`/`support-set-status`/`support-grant-staff` edge fns |
| `StripeModePage.jsx` | Stripe **config** mode | Y | **N** | public `stripe-mode` edge fn (global test/live alignment only — **NOT per-brand Connect status**) |
| `ApiHealthPage.jsx` | external-service health | Y | **N** | RPC `admin_get_api_health` / `admin_get_api_health_incidents` |
| `SettingsPage.jsx` | `feature_flags`, `app_config`, `integrations` | Y | Y | direct CRUD (RLS admin) + `admin_get_feature_flags` |

**Coverage gap vs META-ORCH-1237 target entities:** consumer **users** ✅ (profiles); business **accounts** (`creator_accounts`) ❌; **brands** ⚠️ (read/claim-update RLS exists, no general console); **events / RSVP / trips / experiences** (`events`+children) ❌; **venues** ⚠️ (read RLS + claim review only, no write, no general console); **orders/tickets** ❌; **Stripe per-brand status** ❌ (only global config page); **subscriptions** ✅ (via RPCs).

---

## Authorization model (with proof)

### Identity & session (client)
- `mingla-admin/src/lib/supabase.js:3-4` — `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` only. No service_role anywhere in `mingla-admin/`.
- `context/AuthContext.jsx` — 2FA: `verifyPassword` (signInWithPassword → immediate signOut, `suppressSessionRef` prevents dashboard flash) → `sendOtp`/`verifyOtp` (email OTP, `FULL_AUTH_KEY` localStorage flag = proof-of-2FA). `shouldAcceptSession` (line 40) requires session + email in allowlist + `FULL_AUTH_KEY`.
- Allowlist: `lib/constants.js:5` `ALLOWED_ADMIN_EMAILS=['seth@usemingla.com']` (hardcoded fallback) UNION dynamic `admin_users` via `supabase.rpc('get_admin_emails')` (`AuthContext.jsx:129`). Non-hardcoded admins additionally verified by `is_admin_email` RPC in `verifyPassword` (line 276). Invite flow: `check_invited_admin` / `activate_invited_admin` (self-activation SECURITY DEFINER).
- `lib/authHelpers.js` — password rules + 5-attempt/5-min localStorage lockout. **All client-side; not a server control.**

### The server-side gate (the real enforcement)
`is_admin_user()` — SECURITY DEFINER, STABLE (verbatim):
```
SELECT email INTO v_email FROM auth.users WHERE id = auth.uid();
RETURN EXISTS (SELECT 1 FROM admin_users WHERE email = v_email AND status = 'active');
```
Variants in the wild (equivalent): inline `EXISTS(SELECT 1 FROM admin_users WHERE email=auth.email() AND status='active')` (e.g. `admin_edit_place`), and a `lower(auth.email())` form on some rule tables. `is_admin_email(p_email)` is the pre-auth (anon) check used at login.

### Seam A — admin-gated RLS policies (direct anon-key writes succeed under RLS)
Tables carrying an `is_admin_user()`/`admin_users`-EXISTS policy (from `pg_policies`):
`admin_users` (CRUD), `admin_audit_log` (INS+SEL), `admin_backfill_log`, `admin_email_log` (ALL), `app_config` (I/U/D), `feature_flags` (I/U/D), `integrations` (ALL), `beta_feedback` (SEL/UPD), `brands` (SEL + UPDATE-for-claim), `brand_hours` (SEL), `profiles` (**SEL-all + UPDATE-all**), `place_pool` (UPDATE), `place_admin_actions`, `place_external_reviews` (SEL), `card_generation_runs`, `engagement_metrics` (SEL), `rule_sets`/`rule_set_versions`/`rule_entries`/`rules_runs`/`rules_run_results`/`rules_versions` (ALL), `seeding_cities`/`seeding_operations`/`seeding_tiles` (ALL), `photo_aesthetic_*`, `place_intelligence_runs`/`_trial_runs`, `email_templates` (ALL), `user_reports` (SEL/UPD), `venue_claim_feedback` (ALL), `venue_listings` (**SEL only**), `support_*`, `conversations`/`messages` (support-scoped). This is how `AdminPage`/`SettingsPage`/`EmailPage`/`UserManagementPage`/`PlacePool` write directly with the anon key.

### Seam B — SECURITY DEFINER RPCs (self-gated)
~80 `admin_*` functions (full list in `pg_proc`). Canonical shape (from `admin_grant_override`, `admin_set_platform_take_rate`): `IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;` as the first statement, then the privileged write under definer rights. **Load-bearing:** these are `EXECUTE`-able by anon/authenticated (advisor: 270 anon + 314 authenticated `security_definer_function_executable`) — only the internal guard blocks non-admins.
- **Anomaly A-1:** `admin_set_city_live` is `LANGUAGE sql`, **NOT SECURITY DEFINER, NO internal guard** — it runs with invoker rights and is authorized solely by the `admin_write_seeding_cities` RLS ALL-policy. Not a hole today (RLS covers it) but it is a *different* guarantee source than the rest; a copy-paste of this shape onto a table lacking admin RLS would silently fail-open-to-deny or, worse, rely on a broad policy.

### Seam C — service_role edge functions (internal admin re-check)
`verify_jwt` for every admin fn defaults to `true` (no override in `supabase/config.toml` for `admin-*`, `delete-user`, `backfill-place-photos`, `run-signal-scorer`, `admin-place-search`; `careers-cv-signed-url` is explicitly `verify_jwt=true`). Internal gate = `getUser(token)` then `admin_users` active-check → 403.
- Exemplar (`careers-cv-signed-url/index.ts:46-60`): getUser → `admin_users.select('id').eq('email',user.email).eq('status','active').maybeSingle()` → 403 if null → then service-role storage signed URL.
- `admin-seed-places` (1935), `backfill-place-photos` (68), `admin-place-search` (393): identical `admin_users` active check.
- `admin-review-venue-claim` (246-270): getUser → `rpc('is_admin_user')` → then writes via dedicated SECURITY DEFINER RPCs (which re-assert `is_admin_user`) and a service-role client.

---

## Service-role edge-fn pattern (the reusable safe-write contract for NEW privileged writes)

For any new-console operation that needs cross-table cascades, storage, external APIs, or writing a service-role-only table, the established, proven contract is:
1. `config.toml` — leave `verify_jwt` default (`true`) so the platform rejects tokenless callers first.
2. `getUser(authHeader)` via a service-role or anon client to resolve the caller's real identity.
3. Re-check `admin_users WHERE email=user.email AND status='active'` (or `rpc('is_admin_user')`) → return 403 on miss.
4. Perform the privileged work with the service-role client.
5. (Gap — see below) write an `admin_audit_log` row **inside** the function so the audit cannot be skipped.

Note: today the admin invokes edge functions mostly for place-seeding, photos, claims, support, careers-CV, and self-delete. **There is no general-purpose "admin write arbitrary business entity" edge fn or RPC** — that is the net-new infrastructure META-ORCH-1237 needs.

---

## Audit posture

- Table `admin_audit_log(admin_email, action, target_type, target_id, metadata)` — RLS INSERT `is_admin_user()`, SELECT `is_admin_user()`.
- Writer `lib/auditLog.js` `logAdminAction()` — client-side, wrapped in try/catch that **swallows all errors** ("never block the primary action"). `ACTION_LABELS` enumerates ~40 known actions.
- **Enforcement gap:** auditing is opt-in per call site. RPCs and RLS-direct writes do not self-audit. A mutation is only logged if the page author remembered to call `logAdminAction` after it. A new full-CRUD console MUST NOT inherit this — audit belongs server-side (inside the RPC/edge fn) to be trustworthy.

---

## Reusable UI / service scaffolding (what new entity pages should reuse)

- **Shell/nav:** `components/layout/AppShell.jsx` (Sidebar+Header+`NAV_ITEMS`). Adding a page = add an entry to `NAV_GROUPS` in `lib/constants.js` **and** register its icon in `Sidebar.jsx` ICON_MAP (missing icon silently falls back to LayoutDashboard — a documented footgun for Careers/Support).
- **UI kit:** `components/ui/*` — `Table`, `Modal`, `Badge`, `Button`, `Card`(+`SectionCard`/`AlertCard`), `Input`, `SearchInput`, `Tabs`, `Toast`, `Dropdown`, `Skeleton`, `Spinner`, `Avatar`, `Breadcrumbs`, `PhotoLightbox`. `CommandPalette.jsx` for global nav.
- **Data plumbing:** `lib/supabase.js` `invokeWithRefresh()` (session-safe edge invoke — use for all edge calls), `services/*` pattern (thin RPC/edge wrappers: `adminClaimsService`, `careersService`, `apiHealthService`, `deckTunerService`).
- **Utilities:** `lib/exportCsv.js` (CSV with formula-injection escaping + 10k-row cap), `lib/formatters.js`, `lib/featureFlags.js` (`admin_get_feature_flags` RPC → gated tabs), `lib/auditLog.js` (`logAdminAction` + `ACTION_LABELS`), `lib/edgeFunctionError.js` (error extraction), `context/{Theme,Toast}Context`.

---

## Gaps (enumerated for synthesis — NOT solutions)

- **G-1 (primary):** `events` (events/trips/experiences/RSVP hub) + `event_dates`/`event_rsvps`/`event_rsvp_guests`/`ticket_types`/`orders`/`order_line_items`/`tickets` have RLS on and **no admin read and no admin write** path (no policy, no RPC). Full-visibility+edit here needs net-new infrastructure.
- **G-2:** `creator_accounts` (business "accounts") — no admin read/write (owner + public-share-scoped only).
- **G-3:** `venue_listings` — admin READ RLS exists but **no admin write**; no general venue console (only claim review).
- **G-4:** Per-brand **Stripe Connect status** (`stripe_connect_accounts`, `partner_stripe_connect_accounts`, `stripe_external_accounts`, `stripe_disputes`, `creator_accounts.stripe_account_id`) — no admin read path; `StripeModePage` is global config only.
- **G-5:** **Audit not server-enforced** (client-side, swallow-errors, opt-in) — any new mutation surface risks unaudited writes.
- **G-6:** **Two divergent gate idioms** coexist (`is_admin_user()` vs inline `admin_users` EXISTS vs `lower(auth.email())` vs the guard-less `admin_set_city_live`). A new console should standardize on ONE (`is_admin_user()`), or inconsistency compounds.
- **G-7 / Discovery D-1:** `UserManagementPage` "delete user" appears structurally suspect — `profiles` has admin UPDATE-all but **no admin DELETE** RLS, and the `delete-user` edge fn deletes the **caller's own** `auth.users` id (self-delete flow, `index.ts:131/137`), not an arbitrary target. The admin delete path may be partially broken for arbitrary users. `SUSPECTED` (source-only; not the focus of this domain) — flag for the synthesis / a separate ORCH.
- **G-8:** `rls_enabled_no_policy` service-role-only tables the console may want to *surface* (`mingla_revenue_log`, `payment_webhook_events`, `order_installments` reads, `job_applications`) require an RPC/edge read path — direct anon read returns nothing.

---

## Authorization CONCLUSION

**Any NEW "full CRUD visibility over prod business entities" page MUST authorize server-side; the anon-key browser can never be trusted.** The single canonical gate is `public.is_admin_user()` (auth.uid → auth.users.email → `admin_users` active). Two acceptable, already-proven enforcement mechanisms:
- **Preferred for writes and for reading owner-scoped/sensitive tables (events, orders, creator_accounts, Stripe, venues):** new `admin_*` **SECURITY DEFINER RPCs** whose FIRST statement is `IF NOT public.is_admin_user() THEN RAISE EXCEPTION`, OR service_role **edge functions** that `getUser(token)` + re-check `admin_users` active (verify_jwt=true) — following the `careers-cv-signed-url`/`admin-seed-places` contract, and **writing `admin_audit_log` inside the function** to make audit non-bypassable.
- **Acceptable for simple, non-sensitive tables (mirroring today's `profiles`/`brands`):** add `is_admin_user()` **RLS policies** (read + write) so the anon-key client writes directly under RLS. Do NOT copy the guard-less `admin_set_city_live` shape.

**Safe admin WRITE to the target prod entities is NOT currently possible — it requires net-new infrastructure.** The core hub (`events` and its children, `orders`/`tickets`, `creator_accounts`, `venue_listings`-write, Stripe status) has zero admin read/write today; every one of those must get either an admin RLS policy pair or an admin RPC/edge fn before the console can read or mutate it.

**Top risks:** (1) **RLS gaps** — shipping console pages that silently return empty / fail-write because no admin policy/RPC exists on `events`/`orders`/`creator_accounts`; (2) **unaudited mutations** — inheriting the client-side opt-in audit for a far larger write surface; (3) **guard idiom drift** — a new RPC missing the `is_admin_user()` first-statement guard is a full fail-open (RPCs are anon-executable); (4) **the self-delete `delete-user` confusion (D-1)** being mistaken for an admin delete primitive.

**Recommended next phase:** SPEC (synthesis across META-ORCH-1237 domains). Recommended scope direction: standardize on `is_admin_user()` SECURITY DEFINER RPCs (+ server-side audit) as the write contract for the sensitive hub entities, RLS-policy additions only for simple tables; treat `events` as the single offering hub; treat per-brand Stripe status and orders/tickets as read-via-RPC surfaces. (Direction only — not a solution.)

---

## Confidence

`proven` for the authorization model, coverage table, entity model, and the gap map — all backed by live-PROD `pg_proc`/`pg_policies`/FK-graph queries and verbatim source at cited `file:line`. `suspected` for Discovery D-1 (admin arbitrary-user delete) — source-only, out of this domain's focus, flagged not chased. No runtime repro required (pure backend/RLS/edge-fn authz investigation — Prime-Directive-7 exemption applies).
