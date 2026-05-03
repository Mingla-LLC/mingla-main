# INVESTIGATION — PR #59 — Cycle B1 backend schema + RLS audit

**Date:** 2026-05-01
**Mode:** INVESTIGATE (independent forensics audit, not a bug hunt)
**Source PR:** https://github.com/Mingla-LLC/mingla-main/pull/59 (`feat/b1-business-schema-rls`)
**Author:** Taofeek F. Obafemi-Babatunde (co-founder)
**Migration file:** `supabase/migrations/20260502100000_b1_business_schema_rls.sql` (2,062 lines, single new file)
**Issue addressed:** #46 (Cycle B1 — backend schema + RLS, BUSINESS_PROJECT_PLAN §B.1–§B.8)
**Final verdict:** 🟡 **APPROVE WITH FOLLOW-UPS** — see §10
**Confidence:** HIGH (full migration read; full migration-chain walk; consumer-frontend cross-check; mobile + admin query-scan)

---

## 1. Symptom Summary

This is an audit, not a bug investigation. 2,062-line single-file migration awaiting approval; co-founder authored; orchestrator + user requested independent forensics review with merge verdict.

The PR delivers the entire Mingla Business backend foundation: 19 new tables, 12 helper functions, 8 BEFORE triggers, ~50 RLS policies, 3 anon `security_invoker` views, anon column-level grants. Edge functions, client cutover, and end-to-end flows are explicitly out of scope per PR description.

---

## 2. Investigation Manifest

| # | File | Layer | Why | Lines |
|---|------|-------|-----|-------|
| 1 | `supabase/migrations/20260502100000_b1_business_schema_rls.sql` | Migration (PR) | Source of truth — read in full | 2,062 |
| 2 | `gh pr view 59` | PR description | Author's gaps/risks list | n/a |
| 3 | `gh issue view 46` | Spec | What the PR claims to deliver | n/a |
| 4 | `supabase/migrations/20260404000001_creator_accounts.sql` | Migration (existing) | Only pre-existing table this PR extends | 59 |
| 5 | grep across `supabase/migrations/` for all 21 new table names | Migration chain | Confirm no name/policy collision | n/a |
| 6 | `mingla-business/src/store/currentBrandStore.ts` | Consumer | Frontend Brand shape vs backend `brands` | 543 |
| 7 | `mingla-business/src/store/liveEventStore.ts` (head) | Consumer | Frontend LiveEvent shape vs backend `events` | 120 of 250+ |
| 8 | `mingla-business/app/e/[brandSlug]/[eventSlug].tsx` | Consumer | Public event page slug-routing dependency | 45 |
| 9 | grep across `app-mobile/` for `.from('<new-table>')` | Cross-domain | Confirm no mobile query collision | n/a |
| 10 | grep across `mingla-admin/` for `.from('<new-table>')` | Cross-domain | Confirm no admin query collision | n/a |

---

## 3. Findings

### 3.1 Root Causes

🔴 **None.** This is an audit; no live bug to root-cause. The findings below are forward-looking quality and security gaps, not active failures.

### 3.2 Should-fix (🟠 — block merge or address as immediate follow-up)

---

**SF-1 — `brands.slug` is mutable; conflicts with consumer invariant I-17**

| Field | Value |
|---|---|
| **File + line** | `supabase/migrations/20260502100000_b1_business_schema_rls.sql:86–140` |
| **Exact code** | `CREATE TABLE ... brands ... slug text NOT NULL` + only `trg_brands_immutable_account_id` trigger; no slug guard |
| **What it does** | Anyone with `brand_admin+` can `UPDATE brands SET slug = ...` |
| **What it should do** | Reject any UPDATE that changes `slug` post-creation (per consumer invariant I-17, see comment in `mingla-business/src/store/currentBrandStore.ts:271–283`: *"FROZEN at brand creation per I-17. NEVER add an edit path — IG-bio links and shared brand URLs (Cycle 7 `/b/{brandSlug}` surface) depend on this slug being immutable."*) |
| **Causal chain** | Brand admin renames slug → `idx_brands_slug_active` is updated → all previously-shared URLs (`/b/old-slug`, `/e/old-slug/foo`) 404 → revenue loss for any organiser who promoted a now-dead link. The consumer side defensively snapshots `brandSlug` on `LiveEvent` (`liveEventStore.ts:47`) but new public-brand-page links have no equivalent protection. |
| **Verification** | Add a `BEFORE UPDATE` trigger `biz_prevent_brand_slug_change` mirroring `biz_prevent_brand_account_id_change`. Prove by attempting `UPDATE brands SET slug = 'x' WHERE id = ...` — should `RAISE EXCEPTION`. |

---

**SF-2 — `events.slug` is mutable; breaks Cycle 7 public URLs**

| Field | Value |
|---|---|
| **File + line** | `supabase/migrations/20260502100000_b1_business_schema_rls.sql:403–478` |
| **Exact code** | `slug text NOT NULL` + only `trg_events_immutable_brand_id` trigger; no slug guard |
| **What it does** | Anyone with `event_manager+` can `UPDATE events SET slug = ...` |
| **What it should do** | Reject post-creation slug mutation. The route `app/e/[brandSlug]/[eventSlug].tsx` resolves events by `(brandSlug, eventSlug)`. A renamed slug 404s every previously-shared URL (Cycle 7 ship + share-modal embed). |
| **Causal chain** | Organiser renames event for typo fix → all promoted share URLs 404 → ticket-page funnel collapses. |
| **Verification** | Add `biz_prevent_event_slug_change` BEFORE UPDATE trigger, OR introduce a `events.slug_history text[]` redirect column and a route-resolver that consults it. The trigger is simpler and matches the brand-slug fix. |

---

**SF-3 — `events.created_by` is mutable; allows attribution forgery**

| Field | Value |
|---|---|
| **File + line** | `supabase/migrations/20260502100000_b1_business_schema_rls.sql:404–406, 585–597` |
| **Exact code** | INSERT policy: `created_by = auth.uid()`. UPDATE policy: no equivalent guard; trigger only protects `brand_id`. |
| **What it does** | Any `event_manager+` user can `UPDATE events SET created_by = '<other-user-id>'` and impersonate the original creator in audit trails. |
| **What it should do** | `created_by` should be immutable post-INSERT. Today the `audit_log` table records mutations correctly, but if a future surface displays "Created by: X" sourced from `events.created_by`, the UI is forgeable. |
| **Causal chain** | Brand admin reassigns `created_by` to another team member → ticket-history attribution misleads downstream finance reporting and accountability. |
| **Verification** | Add `biz_prevent_event_created_by_change` BEFORE UPDATE trigger. |

---

**SF-4 — "Append-only" tables (`audit_log`, `scan_events`) allow service-role mutation/deletion**

| Field | Value |
|---|---|
| **File + line** | `supabase/migrations/20260502100000_b1_business_schema_rls.sql:1301–1318` (scan_events) and `1534–1551` (audit_log) |
| **Exact code** | `IF auth.uid() IS NULL THEN RETURN COALESCE(NEW, OLD); END IF; RAISE EXCEPTION 'audit_log is append-only for clients';` |
| **What it does** | Trigger blocks UPDATE/DELETE only for clients with a JWT. Service-role calls (no `auth.uid()`) sail through and can mutate/delete rows. |
| **What it should do** | Decision: either (a) block ALL mutations including service role for true append-only ("audit log is append-only for ALL roles"), or (b) explicitly document the carve-out so a future maintainer doesn't ship a sweeper edge function that silently rewrites history. The trigger comment `'audit_log is append-only for clients'` already hints at this — but the comment-on-table claims `'Append-only audit trail; inserts via service role only'` (no mention that mutations are allowed for service role). |
| **Causal chain** | A future edge function could, by mistake or design, call `DELETE FROM audit_log WHERE ...` — bypassing the trigger and breaking the immutability promise. Hidden today, surfaces during compliance review. |
| **Verification** | Decide and pick one: (a) drop the `auth.uid() IS NULL` short-circuit so the trigger blocks even service role, OR (b) update both `COMMENT ON TABLE` lines to read "append-only for non-service-role; mutations restricted to migration scripts." |

---

**SF-5 — `refunds.status` lacks CHECK constraint (inconsistent with peer tables)**

| Field | Value |
|---|---|
| **File + line** | `supabase/migrations/20260502100000_b1_business_schema_rls.sql:1621–1631` |
| **Exact code** | `status text NOT NULL DEFAULT 'pending'` — no CHECK |
| **What it does** | Allows arbitrary string values in `refunds.status`. Peers (`orders.payment_status`, `payouts.status`, `tickets.status`, `waitlist_entries.status`, `events.status`, `account_deletion_requests.status`) all have CHECK constraints. |
| **What it should do** | Add `CHECK (status IN ('pending','succeeded','failed','cancelled'))` (or whatever Stripe refund states map to). |
| **Causal chain** | Drift today (zero rows). Drift later: a webhook handler stores `'success'` in one place and `'succeeded'` in another → finance dashboards mis-aggregate. |
| **Verification** | Decide the legal value list with the payments author and add the CHECK. |

---

**SF-6 — `door_sales_ledger.payment_method` lacks CHECK constraint (inconsistent with `orders.payment_method`)**

| Field | Value |
|---|---|
| **File + line** | `supabase/migrations/20260502100000_b1_business_schema_rls.sql:1639–1652` vs `844–855` |
| **Exact code** | `door_sales_ledger.payment_method text NOT NULL` — no CHECK; `orders.payment_method` has `CHECK (payment_method IN ('online_card','nfc','card_reader','cash','manual'))` |
| **What it should do** | Either inherit the same enum as `orders.payment_method` (if the door_sales_ledger only carries non-online entries, narrow to `('nfc','card_reader','cash','manual')`). |
| **Causal chain** | Same drift class as SF-5. |

---

### 3.3 Hidden flaws (🟡 — log for B2/B3 cleanup)

**HF-1** — `events.organiser_contact jsonb` is exposed to anon via the public-events RLS (line 1786–1794) and via `events_public_view` (line 1875–1907). The shape is unstructured. If an organiser writes their personal phone into this field, it's globally visible on share pages. Recommend: validate shape at write time (edge function) or schema-validate in the database with a CHECK on jsonb keys.

**HF-2** — `events.created_by` (auth.users.id) is exposed to anon via the same public-events RLS. Mild user-ID enumeration vector. Either column-revoke from anon (mirror the `creator_accounts` and `brands` REVOKE+GRANT pattern at lines 1978–2005) or accept.

**HF-3** — Original `creator_accounts` policy `"Creators can update own account"` (existing migration `20260404000001_creator_accounts.sql:42–47`) lets a user UPDATE `deleted_at` directly — bypassing the `account_deletion_requests` pipeline that B1 introduces. Pre-existing, but B1 makes this contradiction concrete. Recommend: either narrow that policy to exclude `deleted_at` (column-level RLS) or trust the pipeline by convention. Same applies to `default_brand_id` — no FK ownership check, so a user could set any brand-id (including one they don't own) as their default. Cosmetic only (display defaults), but worth noting.

**HF-4** — `permissions_matrix` SELECT policy is `USING (true)` for all `authenticated` (line 1493–1498). Mingla mobile users (consumer app) are also `authenticated` — they can read this table. Today's seed rows are harmless role/action mappings. Risk: a future row containing a sensitive flag (kill-switch, beta-gate name) gets accidentally exposed across both apps. Recommend: scope to `EXISTS (SELECT 1 FROM creator_accounts WHERE id = auth.uid())` so only Business-app-bootstrapped users see it.

**HF-5** — None of the new tables (`brands`, `events`, `tickets`, `orders`, `scan_events`, etc.) are added to `supabase_realtime` publication. When the business app starts subscribing to live ticket sales / scan progress, a follow-up migration mirroring `20260312400002_add_collaboration_tables_to_realtime.sql` will be needed. Not a B1 blocker (B1 is schema-only, no live consumer) but called out so it doesn't get forgotten in B2/B3.

**HF-6** — `tickets` has SELECT (line 1376) and two UPDATE policies (lines 1394, 1412), but **NO INSERT or DELETE policy**. All ticket issuance and removal must go through service role (edge functions). This is per spec ("issuance via service role") and is good defense in depth — but means there is no admin "manual ticket issue" UI fallback path without an edge function. The orchestrator and B2 author should be explicitly aware: an admin manual issuance feature requires an edge function, not a direct table insert.

**HF-7** — `events.visibility` enum includes `'discover'` (line 425) but no RLS policy grants reads of `visibility = 'discover'` events to anyone except brand team (via the brand-team SELECT policy at line 564). If "discover" means "show in Mingla mobile discover tab", then mobile-side reads need either (a) an additional RLS grant for authenticated mobile users to read `visibility IN ('public','discover') AND show_on_discover = true`, or (b) the mobile-side queries go through a service-role edge function. Confirm semantic intent before B2 mobile cutover.

**HF-8** — `events_public_view` (line 1875) returns `theme jsonb` to anon. Same untyped-surface concern as HF-1: organiser-controlled jsonb dumped publicly. Validate shape or accept.

### 3.4 Observations (🔵 — informational)

**OB-1** — Frontend `Brand` shape (`mingla-business/src/store/currentBrandStore.ts:271–385`) has fields that don't map 1:1 to backend `brands`:
- `displayName` → backend `name` (rename in cutover layer)
- `bio` + `tagline` → backend has only `description`
- `kind` ("physical" | "popup") → **MISSING in backend** (Cycle 7 dependency)
- `address` → **MISSING in backend** (Cycle 7 dependency; `events.location_text` is event-scoped, not brand-scoped)
- `coverHue` (number) → **MISSING in backend** (Cycle 7 FX2 dependency; could be stashed in `social_links jsonb` or new column in B2)
- `contact.phoneCountryIso` → backend has `contact_phone` text only (no country ISO)
- `social_links` is structured frontend-side, untyped jsonb backend-side

Not a B1 blocker (B1 is schema only; cutover is later) but the orchestrator should know B2/B3 either adds these columns OR the frontend collapses to backend shape.

**OB-2** — Frontend `LiveEvent` shape (`mingla-business/src/store/liveEventStore.ts:43–83`) has `format`, `category`, `whenMode`, `coverHue`, `requireApproval`, `allowTransfers`, `hideRemainingCount`, `passwordProtected`, `hideAddressUntilTicket`, `venueName` — backend `events` table doesn't model these directly. Most can live in `theme jsonb` or `organiser_contact jsonb`; some (e.g., `requireApproval`, `passwordProtected`) probably belong on `ticket_types` (which already has both). `category` and `format` need either columns or a controlled-vocabulary jsonb shape.

**OB-3** — Frontend `LiveEvent.brandSlug` is FROZEN at publish (`liveEventStore.ts:47`). Backend `events` table has no `brand_slug_snapshot`. If SF-1 lands (slug immutable), this is moot. If not, add `events.brand_slug_snapshot text` so historical share links survive any future brand-rename feature.

**OB-4** — **Zero query collisions across mobile and admin.** Greps confirm no `app-mobile/src/services/**` or `mingla-admin/src/**` file references any of the 21 new table names via `supabase.from('<name>')`. No cross-domain RLS surprise.

**OB-5** — `tickets.qr_code` UNIQUE INDEX is global (across all events). Implementor must ensure the QR generator uses sufficient entropy to avoid global collisions; per-event uniqueness `(event_id, qr_code)` would be an alternative if collision risk is non-trivial.

**OB-6** — `orders.created_by_scanner_id` references `auth.users` directly, not `event_scanners`. A scanner who creates a door sale and is later removed from `event_scanners` retains the FK reference (until auth user deletion sets it null). Acceptable — historical attribution shouldn't change with current role.

**OB-7** — `tickets` BEFORE INSERT/UPDATE consistency trigger (line 1124–1149) correctly enforces that `event_id` matches both `order.event_id` and `ticket_type.event_id`. ✅

**OB-8** — Scanner update trigger (line 1211–1293) correctly:
- Allows finance+ team unconditional updates.
- Constrains scanners to ONLY mutate `status` (valid→used), `used_at`, `used_by_scanner_id`.
- Binds `used_by_scanner_id = auth.uid()` on check-in (Copilot review fix).
- Auto-stamps `used_at = now()` if NULL; rejects future-stamps > 2min.
- Rejects valid→void or used→valid by scanners. ✅

**OB-9** — `payment_webhook_events.stripe_event_id` has a UNIQUE INDEX (line 1674–1675) — webhook idempotency is structurally enforced. ✅

**OB-10** — `stripe_connect_accounts` has NO `access_token` or other secret column (Mingla relies on `Stripe-Account` header against the platform's secret key, not stored OAuth tokens). ✅ No secrets-at-rest exposure risk.

---

## 4. Five-Layer Cross-Check

| Layer | Result |
|---|---|
| **Spec (issue #46 + BUSINESS_PROJECT_PLAN §B.1–§B.8)** | All sections covered. Tables match the journey list (J-B1.1 through J-B1.7). |
| **Schema** | Indexes on all FKs and lookup paths. Constraints consistent EXCEPT SF-5 (refunds.status) and SF-6 (door_sales_ledger.payment_method). Soft-delete (`deleted_at`) used correctly for brands, events, ticket_types, creator_accounts. Immutability triggers cover account_id (brands), brand_id (events), event_id (event_dates) — but NOT slug or created_by (SF-1, SF-2, SF-3). |
| **Code (RLS policies + helpers)** | `SECURITY DEFINER` helpers all set `search_path = public, pg_temp` — correct. All policies scoped to brand membership via helpers. No `USING (true)` policy except `permissions_matrix` (HF-4) and the deliberate anon public-views pattern. |
| **Runtime (intended behavior)** | Cannot live-test (audit-only). Static reasoning suggests the policy + trigger combination on `tickets` correctly handles the multi-permissive-UPDATE concern Taofeek flagged (HR-2 verdict below). |
| **Data** | No data state to verify (fresh tables). Permissions matrix seed rows are sensible defaults. |

**Layer disagreements:**
- Frontend `Brand`/`LiveEvent` shapes have fields the backend doesn't model (OB-1, OB-2). Not a contradiction — B1 is intentionally schema-first; cutover work is B2/B3.
- Consumer invariant I-17 (brand slug immutable) is documented in frontend code but not enforced server-side (SF-1). True contradiction.

---

## 5. HR-1 through HR-9 Verdicts

| Surface | Verdict | Note |
|---|---|---|
| **HR-1 Cross-brand isolation** | ✅ PASS | All policies scope through `biz_is_brand_member_for_read` / `biz_brand_effective_rank` / `biz_can_read_order` / `biz_can_manage_payments_for_brand`. Brand A's owner cannot read Brand B's events, tickets, or orders. |
| **HR-2 Tickets multiple permissive UPDATE** | ✅ PASS | Trigger `biz_tickets_enforce_update` (line 1211) correctly partitions: finance+ unconditional; scanner-only check-in fields; `used_by_scanner_id = auth.uid()` bound on valid→used. Scanner cannot forge `status`, `price` (no price column on tickets), or `redeemed_at`. Finance manager CAN flip `used_at` (acceptable; finance is the highest authority short of admin). |
| **HR-3 Anon read of `ticket_types`** | ✅ PASS | Scoped to `is_hidden IS NOT TRUE AND is_disabled IS NOT TRUE` AND parent event `visibility = 'public' AND status IN ('scheduled','live')`. Pricing for draft / hidden / disabled / deleted-brand events is NOT exposed. |
| **HR-4 Audit log append-only** | 🟡 PARTIAL | Anon/authenticated INSERT/UPDATE/DELETE are denied (no policy + trigger raises). Service role can mutate (SF-4). Decision required. |
| **HR-5 Stripe Connect + payment tables** | ✅ PASS | No access_token at rest. Webhook idempotency via UNIQUE INDEX on `stripe_event_id`. Finance role grant via `biz_can_manage_payments_for_brand`: brand_admin OR explicit finance_manager membership only — `event_manager` cannot touch refunds/payouts/door_sales. ✅ |
| **HR-6 `permissions_matrix` open to authenticated** | 🟡 ACCEPT NOW | Current rows harmless. Recommend HF-4 tightening so future drift can't accidentally leak. |
| **HR-7 `creator_accounts` extensions** | 🟡 PARTIAL | `default_brand_id` ON DELETE SET NULL (good). `deleted_at` user-mutable bypasses pipeline (HF-3). `default_brand_id` has no ownership check (cosmetic). |
| **HR-8 Migration chain safety** | ✅ PASS | Only `creator_accounts` exists prior; ADD COLUMN IF NOT EXISTS is safe. No name collision in any of 293+ prior migrations (verified via grep). All policies use DROP IF EXISTS. All functions CREATE OR REPLACE. Idempotent. |
| **HR-9 Mobile cross-impact** | ✅ PASS | Zero `.from('<new-table>')` references in `app-mobile/src/services/**` or `mingla-admin/src/**`. No name collision risk. |

---

## 6. Constitutional + Invariant Compliance

### Constitutional principles

| # | Principle | Result |
|---|-----------|--------|
| #2 | One owner per truth | ✅ New tables don't duplicate existing state. `brand_team_members` is the sole authority for membership; `tickets` is the sole authority for issuance. |
| #3 | No silent failures | ✅ RLS denials surface as Postgres errors. No `USING (true)` then app-code filter. EXCEPT permissions_matrix (HF-4) which is intentionally `USING (true)` but doesn't filter sensitive data app-side either. |
| #6 | Logout clears | ✅ RLS naturally enforces. No token-based bypass; all helpers use `auth.uid()` consistently. |
| #7 | TRANSITIONALs documented | ✅ PR description explicitly lists what's not wired (edge functions, client cutover, live Stripe). |
| #8 | Subtract before adding | ✅ No old tables superseded; nothing to drop. The old `creator_accounts` policies remain, which interacts with HF-3 — surface for B2/B3 reconciliation. |
| #11 | One auth instance | ✅ All RLS uses `auth.uid()` consistently. All helpers receive `(p_user_id uuid)` and the callers always pass `auth.uid()`. |

### Invariants

| ID | Invariant | Result |
|---|-----------|--------|
| **I-17** | Brand-slug stability | 🟠 **VIOLATED** — backend allows mutation; frontend depends on immutability. See SF-1. |
| **(implied) Event-slug stability** | Public URLs depend on it | 🟠 **VIOLATED** — see SF-2. |
| **Audit append-only** | No mutations after insert | 🟡 Partial — service-role bypass (SF-4). |
| **Ticket non-double-redemption** | A ticket scanned twice should be detected | ✅ Schema models `status = 'used'` and trigger forbids used→valid. Application layer (edge function or scanner client) must check status before issuing the UPDATE; database raises if scanner attempts the wrong transition. The `scan_events.scan_result` enum has `'duplicate'` and `'wrong_event'` for audit. ✅ |
| **Cross-brand isolation** | A brand cannot read another brand's data | ✅ Verified across every table (HR-1 PASS). |

---

## 7. Migration chain safety

- **Existing tables touched by this PR:** `creator_accounts` (extended with 4 columns, all `IF NOT EXISTS`).
- **Name collisions:** Searched all 293 prior migrations for any of the 21 new table names. **Zero collisions.** Earlier hits for `events` were `events JSONB` (ticketmaster cache row), `events` as the English word in comments ("postgres_changes events"), and telemetry table names (`engagement_metrics_table`) — none reuse the bare `events` table name in `public.events`.
- **Policy name collisions:** Each `CREATE POLICY` is preceded by `DROP POLICY IF EXISTS` with the exact name. Re-application is idempotent.
- **Function collisions:** All helpers are `CREATE OR REPLACE` with stable signatures. Helper names are namespaced `biz_*` to avoid clashing with existing `update_updated_at_column`, etc.
- **Application order:** This migration timestamp `20260502100000` is later than all current migrations (latest pre-PR is `20260502000002`). Applies cleanly on top of HEAD.
- **External blocker note (from PR description):** PR mentions an unrelated `storage.objects` ownership migration blocking `db reset` in one environment. This migration itself does NOT depend on that blocker being resolved — it touches only `public.*` and `auth.users` references. Should apply cleanly even if the storage migration is unresolved.

**Verdict:** ✅ Chain is safe. No collisions. Idempotent re-application supported.

---

## 8. Frontend impact map (informational, NOT a merge blocker)

When B2/B3 cutover lands, the following will need work:

### `mingla-business/`

| File | Change required |
|---|---|
| `src/store/currentBrandStore.ts` | Map frontend `Brand` shape to backend `brands` table. Either add backend columns for `kind`/`address`/`coverHue`/`tagline`/`phoneCountryIso` OR reshape frontend to drop them. Either way, the client store contracts to ID-only + cache once `brands` reads come from React Query. |
| `src/store/liveEventStore.ts` | Same pattern: backend `events` lacks `format`/`category`/`whenMode`/`coverHue`/`requireApproval`/`allowTransfers`/`hideRemainingCount`/`passwordProtected`/`hideAddressUntilTicket`/`venueName`. Decide: jsonb (`theme`, `organiser_contact`) or new columns. |
| `src/store/draftEventStore.ts` (publishDraft) | The single I-16 ownership-transfer point will need to call an edge function (insert event + event_dates + ticket_types in a transaction) instead of `addLiveEvent` to local store. |
| `src/store/brandList.ts` | Currently stub. Becomes a React Query hook reading from `brands` table. |
| `app/e/[brandSlug]/[eventSlug].tsx` | Resolves event by `(brandSlug, eventSlug)`. Requires either (a) brand-slug + event-slug both immutable (SF-1, SF-2), or (b) join through `brand_slug_snapshot` on events (OB-3). |
| `src/components/brand/PublicBrandPage.tsx` | Reads brand by slug → `brands_public_view`. Must handle anon read (no auth) and exclude stripe/tax columns (already revoked). |

### `app-mobile/` and `mingla-admin/`

Zero immediate impact. No queries reference any new table. When the consumer app starts displaying business events on Discover, it'll need either a new RLS allow (HF-7) or a service-role edge function.

### Edge functions (B2/B3 work, not B1)

- Brand creation (writes `creator_accounts.default_brand_id` + `brands` + initial `brand_team_members` row for the owner — needs to set role='account_owner').
- Event publish (writes `events` + `event_dates` + `ticket_types` in transaction).
- Ticket issuance (service-role-only INSERT into `tickets` per HF-6).
- Stripe webhook handler (idempotent INSERT into `payment_webhook_events`, then process).
- Scan-event sync (offline-batch INSERT into `scan_events`).
- `audit_log` writer (called by every mutation edge function).
- Account deletion pipeline (writes `account_deletion_requests`).

---

## 9. Discoveries for Orchestrator

1. **Invariant I-17 (brand-slug stability) is documented in frontend code but unenforced in backend.** Even if SF-1 is fixed in this PR, the codebase needs a single canonical statement of I-17 in `Mingla_Artifacts/INVARIANT_REGISTRY.md` so future cycles don't re-discover this.
2. **No realtime publication membership for any business table** (HF-5). When B-cycles start needing live updates (organiser dashboard, scanner check-in feed), a follow-up migration is required.
3. **`tickets` has no INSERT policy by design** (HF-6). This is the right call BUT means even brand admins cannot manually issue a ticket via direct SQL — they need an edge function. Surface this in B2 planning so "admin manual issuance" doesn't get assumed.
4. **`permissions_matrix` is readable by Mingla mobile users** (HF-4). Today benign. Add a guard before someone uses this table as a kill-switch board.
5. **Frontend Brand/LiveEvent shapes have ~10 fields that don't map to backend tables** (OB-1, OB-2). Schedule a B2 schema-reconciliation task before client cutover work begins, otherwise the implementor will hit "where does X go?" on every shape mapping.
6. **PR description mentions an unrelated `storage.objects` migration blocking `db reset` in one env.** That blocker is outside this PR's scope, but it WILL prevent CI verification of clean apply. Resolve in parallel.
7. **No automated RLS regression test suite is included.** PR description acknowledges. B-cycle should commit to writing RLS tests (Postgres `SET ROLE` + assertion patterns) before the platform sees customer data.

---

## 10. Final Verdict

### 🟡 **APPROVE WITH FOLLOW-UPS**

**Rationale.** The migration is fundamentally sound and well-architected:
- Every helper is `SECURITY DEFINER` with `SET search_path = public, pg_temp`.
- Every public table has RLS enabled with deny-by-default semantics (no row visible without an explicit policy).
- Cross-brand isolation is correctly scoped through brand-membership helpers.
- The high-risk surface Taofeek pre-flagged (multiple permissive UPDATE on `tickets`) is correctly handled by the BEFORE UPDATE trigger with proper scanner-identity binding.
- The anon public surface (§B.8) is column-revoked AND policy-scoped — no stripe/tax data leaks.
- Migration chain is collision-free, idempotent, and has zero cross-domain query impact on mobile or admin.

**Why "with follow-ups" rather than "approve":**
- **SF-1 (brand-slug immutability)** directly conflicts with consumer invariant I-17 already shipped to frontend code. Either land a slug-immutability trigger in this PR before merge OR treat as immediate B1.5 follow-up before any production write to `brands`.
- **SF-2 (event-slug immutability)** has the same risk profile for Cycle 7 share URLs.
- **SF-3 (events.created_by immutability)** — small but identical pattern.
- **SF-4 (append-only carve-out for service role)** needs an explicit decision logged; current code is a Schrödinger-immutable.
- **SF-5, SF-6 (missing CHECK constraints)** are quality drift, easily fixed.

If the team prefers ZERO follow-ups, this becomes 🟠 **REQUEST CHANGES** — add the four immutability triggers (brands.slug, events.slug, events.created_by) and the two CHECK constraints (refunds.status, door_sales_ledger.payment_method) and decide on SF-4. Six small additions; estimate < 1 hour.

If "follow-ups acceptable," merge as-is and queue SF-1 through SF-6 + HF-3 + HF-4 + HF-7 as B1.5 / B2 prerequisites.

**🔴 Security review NOT required.** No critical security holes. RLS is correctly layered; helpers are correctly hardened; anon surface is correctly column-revoked.

---

## 11. Confidence

**HIGH.**
- Read the complete migration file in full (2,062 lines).
- Walked the migration chain via grep across all 293 prior migrations for each new table name (zero collisions confirmed).
- Read the only pre-existing extended table (`creator_accounts`) in full.
- Read the consumer Brand store (`currentBrandStore.ts`, 543 lines) and confirmed shape mismatches.
- Sampled `liveEventStore.ts` head (120 lines, full LiveEvent interface).
- Confirmed zero `.from('<new-table>')` references across `app-mobile/src/services/**` and `mingla-admin/src/**`.
- Verified the scanner trigger (line 1211–1293) by static reasoning across all role/event-scanner permutations.
- Cross-referenced PR author's pre-flagged risks (1–6 in PR description) against findings — every flagged risk is covered in the verdict.

The only variable left unverified is live-fire RLS behavior — that requires applying the migration to a staging DB and running role-impersonation queries, which is outside the audit scope per the dispatch's hard constraints.
