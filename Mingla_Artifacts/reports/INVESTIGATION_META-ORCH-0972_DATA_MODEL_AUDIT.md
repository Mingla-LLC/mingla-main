# INVESTIGATION_META-ORCH-0972_DATA_MODEL_AUDIT

**ORCH:** META-ORCH-0972 [brand-kind decommission + universal feature access]
**Phase:** 1 of 4 — AUDIT (Schema + RLS + Views + RPCs + Edge Functions + DROP COLUMN safety plan)
**Mode:** INVESTIGATE (read-only)
**Author:** Claude `mingla-forensics`
**Date:** 2026-05-25
**Worktree base:** PRE-ORCH-0963 (see Report 1 §"P1 DISCOVERY" — `pg_public_trips_by_brand` migration NOT in this branch yet)

This report is the companion data-model audit to [`INVESTIGATION_META-ORCH-0972_BRAND_KIND_GAP_AUDIT.md`](./INVESTIGATION_META-ORCH-0972_BRAND_KIND_GAP_AUDIT.md). It catalogues every database object that depends on `brands.kind`, applies the migration-chain rule (LATEST migration is authoritative), and outputs the **DROP COLUMN safety plan** for Phase 4.

---

## Migration-chain rule applied

Every SQL object below was verified by grepping ALL migrations for the object name, sorting by timestamp, and reading the LAST migration that creates/replaces it. No early-migration definitions are cited as current truth.

---

## A. Tables + constraints

### A.1 `brands.kind` column

| Migration | Action | Current state? |
|---|---|---|
| [`20260506000000_brand_kind_address_cover_hue_media.sql`](supabase/migrations/20260506000000_brand_kind_address_cover_hue_media.sql) | `ADD COLUMN kind text NOT NULL DEFAULT 'popup' CHECK (kind IN ('physical','popup'))` | Superseded |
| [`20260607000000_orch_0855_brands_kind_trip_planner.sql`](supabase/migrations/20260607000000_orch_0855_brands_kind_trip_planner.sql) | `DROP CONSTRAINT brands_kind_check; ADD CONSTRAINT brands_kind_check CHECK (kind IN ('physical','popup','trip_planner'))` | **CURRENT (verified latest)** |

**Disposition:**
- Phase 4 Sub-C migration 1: `ALTER TABLE public.brands DROP CONSTRAINT brands_kind_check;`
- Phase 4 Sub-C migration 2 (one safe-deploy cycle later): `ALTER TABLE public.brands DROP COLUMN kind;`
- Default value (`'popup'`) becomes moot once column is dropped; no rows need backfill (the column itself is leaving).

### A.2 `brands.claim_status` column

| Migration | Action | Current state? |
|---|---|---|
| [`20260613000000_ve1_physical_venue_brand_onboarding.sql`](supabase/migrations/20260613000000_ve1_physical_venue_brand_onboarding.sql) | `ADD COLUMN claim_status text NOT NULL DEFAULT 'none'` + `CHECK (claim_status IN ('none','pending_review','verified','rejected'))` | **CURRENT (no later modification)** |

**Disposition:** **KEEP** the column. Under META-ORCH-0972 model, `claim_status` drives the optional "Verified location" badge — it stops being a gate but stays as data. The CHECK constraint stays. No migration needed for this column.

### A.3 `brands` table — relevant columns (read-context for Phase 2/3)

Other columns referenced by Phase 2/3 design decisions:
- `address text` — already nullable; becomes universal optional input post-Phase 4
- `place_pool_id uuid` — link to claimed Google Places venue (NULL = no claim)
- `default_currency text` — unchanged
- `cover_hue integer`, `cover_media_url text`, `cover_media_type text`, `profile_photo_type text` — visual customization, no kind coupling
- `display_attendee_count boolean` — display preference, no kind coupling
- `custom_links jsonb` — no kind coupling
- `deleted_at timestamptz` — soft-delete; unchanged

No additional schema changes needed beyond the `kind` column + constraint drop in Phase 4.

---

## B. Views

### B.1 `business_public_brands_view`

| Migration | Action |
|---|---|
| `20260613000000_ve1_physical_venue_brand_onboarding.sql:157-182` | Initial CREATE VIEW |
| **[`20260727000003_orch_0962_brand_field_render_truthful.sql:14-39`](supabase/migrations/20260727000003_orch_0962_brand_field_render_truthful.sql)** | **DROP / RECREATE — CURRENT (verified latest)** |

**Current SQL (post-ORCH-0962, lines 14-39 of the migration):**
- SELECTs `b.kind` among many other brand columns
- WHERE: `b.deleted_at IS NULL AND (b.kind IN ('popup','trip_planner') OR (b.kind = 'physical' AND b.claim_status = 'verified'))`

**Disposition (REPURPOSE):**
- DROP `b.kind` from SELECT list
- REWRITE WHERE to `b.deleted_at IS NULL` (universal — every non-deleted brand is publicly visible)
- The current "verified or non-physical" gate was a venue-claim filter; under new model, all brands are publicly visible; visibility moderation for unclaimed-but-fake-brands risk is OUT of scope of META-ORCH-0972 per operator (no live brands today, low risk window)

**Risk:** HIGH — this view feeds the public brand page, the BrandPickerSheet, and consumer-app brand profile rendering. Any error in the rewrite blanks out brand discovery.

### B.2 `claimed_venues_public_view`

| Migration | Action |
|---|---|
| `20260622000000_ve4_claimed_venues_public_view.sql:77-124` | Initial CREATE VIEW |
| **[`20260727000003_orch_0962_brand_field_render_truthful.sql:44-94`](supabase/migrations/20260727000003_orch_0962_brand_field_render_truthful.sql)** | **DROP / RECREATE — CURRENT (verified latest)** |

**Current SQL (post-ORCH-0962, lines 44-94):**
- SELECTs `b.kind` (line ~67) + venue fields
- WHERE: `b.kind = 'physical' AND b.claim_status = 'verified'`

**Disposition (REPURPOSE):**
- DROP `b.kind` from SELECT list
- REWRITE WHERE to `b.claim_status = 'verified'` alone (any brand with a verified venue claim)
- Semantically: this view represents "brands that have completed a Google Places venue claim" — under new model, any brand can opt in to claim, so the kind filter is wrong/redundant

**Risk:** MEDIUM — feeds the "Verified location" badge surface. After rewrite, badge shows on any brand with `claim_status='verified'`, which under the new model is correct.

### B.3 `business_public_events_view`

| Migration | Action |
|---|---|
| **[`20260727000003_orch_0962_brand_field_render_truthful.sql:99-152`](supabase/migrations/20260727000003_orch_0962_brand_field_render_truthful.sql)** | **CURRENT — adds `b.kind AS brand_kind` to public event detail context (line ~109)** |

**Disposition (REPURPOSE):**
- DROP `b.kind AS brand_kind` from SELECT (the consumer doesn't need it under new model)
- WHERE stays unchanged (selects events, not brands)
- **Cross-ref:** Dim 9 catalogue notes that `viewRowToBrand` reads `brand_kind` from this view as part of ORCH-0962's truthful-render fix. That mapping path needs to be removed in Phase 4 Sub-D when this view is rewritten.

**Risk:** LOW — kind is a passthrough field; consumer can drop the read.

---

## C. RLS policies

### C.1 brands table — "Public can read verified physical venues"

| File | Lines |
|---|---|
| [`20260622000000_ve4_claimed_venues_public_view.sql:11-19`](supabase/migrations/20260622000000_ve4_claimed_venues_public_view.sql) |

**Current predicate:** `deleted_at IS NULL AND kind = 'physical' AND claim_status = 'verified'`
**Roles:** `anon, authenticated`
**Operation:** SELECT

**Disposition (REPURPOSE):**
- Predicate rewrites to `deleted_at IS NULL` (universal public-read for non-deleted brands)
- OR if narrower semantic is wanted: `deleted_at IS NULL AND claim_status = 'verified'` (only verified-venue brands are publicly readable via this policy; non-claimed brands rely on the parallel public-read policy)

**Critical:** This is the most security-sensitive RLS rewrite in Phase 4. Phase 3 spec MUST exhaustively enumerate the parallel public-read policies on `brands` (there's typically a separate "anyone can read brands" policy) to make sure removing the kind filter doesn't widen exposure unintentionally.

**Risk:** HIGH (RLS security boundary).

### C.2 brand_hours table — "Public can read hours for verified physical venues"

| File | Lines |
|---|---|
| [`20260622000000_ve4_claimed_venues_public_view.sql:24-37`](supabase/migrations/20260622000000_ve4_claimed_venues_public_view.sql) |

**Current predicate:** `EXISTS(SELECT 1 FROM brands b WHERE b.id = brand_hours.brand_id AND b.kind = 'physical' AND b.claim_status = 'verified')`
**Roles:** `anon, authenticated`
**Operation:** SELECT

**Disposition (REPURPOSE):**
- Drop the `b.kind = 'physical'` predicate from the EXISTS subquery
- Keep `b.claim_status = 'verified'` — brand hours only make sense for verified venue brands

**Risk:** MEDIUM. Brand hours editor is gated to `claim_status='verified'` in the app — symmetric on read.

### C.3 place_pool table — "Public can read place_pool for verified physical venues"

| File | Lines |
|---|---|
| [`20260622000000_ve4_claimed_venues_public_view.sql:42-55`](supabase/migrations/20260622000000_ve4_claimed_venues_public_view.sql) |

**Current predicate:** `EXISTS(SELECT 1 FROM brands b WHERE b.place_pool_id = place_pool.id AND b.kind = 'physical' AND b.claim_status = 'verified')`
**Roles:** `anon, authenticated`
**Operation:** SELECT

**Disposition (REPURPOSE):** drop the `b.kind = 'physical'` predicate; keep the verified check.

**Risk:** MEDIUM. `place_pool` is the Google Places ingestion table; exposing place_pool rows to anon is gated on brand-side verification — symmetric on read.

### C.4 Admin policies on brands

| File | Policy | Predicate | Disposition |
|---|---|---|---|
| `20260613000000_ve1_physical_venue_brand_onboarding.sql:132-136` | "Admins can read brands for operations" | `is_admin_user()` (no kind/claim guard) | NO-CHANGE |
| `20260613000000_ve1_physical_venue_brand_onboarding.sql:144-149` | "Admins can update brands for claim review" | `is_admin_user()` (no kind/claim guard) | NO-CHANGE |

Admin policies don't filter on kind — they grant blanket admin access. No changes needed.

### C.5 Other tables — kind-coupled RLS verification

The audit verified (via subagent C) that **no other tables** carry RLS policies branching on `brands.kind`. The 3 policies above (brands, brand_hours, place_pool) are exhaustive. `events`, `tickets`, `business_events`, `ticket_types`, etc. do NOT have kind-coupled RLS.

---

## D. RPCs (SECURITY DEFINER functions)

### D.1 `biz_create_venue_brand_pending_review()`

| File | Lines | Latest? |
|---|---|---|
| [`20260618000000_ve2_pool_match_claim.sql:38-219`](supabase/migrations/20260618000000_ve2_pool_match_claim.sql) | Final definition | YES (verified — no later CREATE OR REPLACE) |

**Kind reference:** Line ~162: `INSERT INTO brands (kind, ...) VALUES ('physical', ...)` — hardcodes `kind = 'physical'` in the new-brand INSERT (this RPC is called when a user starts a venue claim flow that creates a new physical brand on the fly).

**Disposition (REPURPOSE):**
- Drop the `kind` column from the INSERT entirely (DB default `'popup'` would apply but the column is going away in Phase 4 anyway)
- OR parameterize `kind` as a function argument (avoid — kind concept is going away)
- Simplest path: drop `kind` from INSERT in same migration that drops the column

**Risk:** MEDIUM — this RPC is the entry point for the venue claim flow.

### D.2 `biz_review_venue_claim()`

| File | Lines | Latest? |
|---|---|---|
| [`20260619000000_ve3_admin_claim_review.sql:30-191`](supabase/migrations/20260619000000_ve3_admin_claim_review.sql) | Final definition | YES |

**Kind reference:** Line 61: `WHERE b.id = p_brand_id AND b.kind = 'physical'` — guards admin review action to only operate on physical brands.

**Disposition (REPURPOSE):**
- Drop `AND b.kind = 'physical'` from the guard
- Replace with `AND b.claim_status IN ('pending_review', 'verified', 'rejected')` (the action only makes sense for brands that have initiated a claim)

**Risk:** MEDIUM — this is the admin venue-claim approval/rejection RPC.

### D.3 `biz_upsert_brand_hours()`

| File | Lines | Latest? |
|---|---|---|
| [`20260614000000_ve1_pr_review_hardening.sql:27-84`](supabase/migrations/20260614000000_ve1_pr_review_hardening.sql) | Final | YES |

**Kind reference:** None. NO-CHANGE.

### D.4 Other RPCs

Subagent C verified by grep across `supabase/migrations/`: no other RPC bodies contain `brand.kind` or `brands.kind` filters. The remaining RPCs (`pg_public_brand_by_slug`, `biz_ticket_checkout_create_session`, `biz_trip_tickets_sold`, etc.) operate on brand IDs or event IDs without referencing kind.

**Notably absent in this worktree:** `pg_public_trips_by_brand` (ORCH-0963's new anon RPC). When the worktree rebases onto origin/main, this RPC needs treatment per the Phase 1 audit:
- The new RPC has `WHERE b.kind = 'trip_planner'` brand-kind guard
- Under META-ORCH-0972 model, the brand-kind guard must be REMOVED so the RPC returns trip rows for ANY brand that has trips published

---

## E. Edge functions

### E.1 `parse-restaurant-menu/index.ts` — kind-gated AI menu parser

| File | Lines | Behavior |
|---|---|---|
| [`supabase/functions/parse-restaurant-menu/index.ts:144`](supabase/functions/parse-restaurant-menu/index.ts) | `.select("id, name, kind, venue_category, claim_status, default_currency, ...")` from brands |
| Same file:155 | `if (brand.kind !== "physical") return errorResponse(403, "BRAND_NOT_ELIGIBLE", "Menu generation is for physical venues only")` |
| Same file:161 | `if (brand.claim_status !== "verified") return errorResponse(...)` |

**Disposition (DELETE both gates):**
- Per operator 2026-05-25: AI experience generators become universal
- DELETE line 155 (kind gate) and line 161 (claim_status gate)
- DROP `kind, claim_status` from the SELECT list (line 144) — only `venue_category` is still relevant for menu-parsing context

**Risk:** MEDIUM — this is a server-side authorization removal. Phase 5 tester must verify no privilege escalation surface opens.

### E.2 `parse-play-activities/index.ts` — kind-gated AI activities parser

| File | Lines | Behavior |
|---|---|---|
| [`supabase/functions/parse-play-activities/index.ts:151`](supabase/functions/parse-play-activities/index.ts) | `.select("id, name, kind, venue_category, claim_status, ...")` |
| Same file:162 | `if (brand.kind !== "physical") return errorResponse(403, "BRAND_NOT_ELIGIBLE", ...)` |
| Same file:176 | `if (brand.claim_status !== "verified") return errorResponse(...)` |

**Disposition:** Same as E.1 — DELETE both gates, DROP kind/claim_status from SELECT.

### E.3 `_shared/agentTools.ts` — kind-gated AI experience tool

| File | Lines | Behavior |
|---|---|---|
| [`supabase/functions/_shared/agentTools.ts:412`](supabase/functions/_shared/agentTools.ts) | `if (brand.kind !== "physical") throw new ToolError("INVALID_ARGS", "Experiences require a verified physical venue")` |

**Disposition (DELETE):** removed under universal-access model. The `create_experience` agent tool becomes available to any brand.

**Risk:** MEDIUM — agent tools execute server-side; removing the gate means any brand can have the AI agent author experiences for them.

### E.4 `_shared/agentTools.ts` — other kind references

Subagent C verified line 421 is part of the same gate's error message — DELETE with line 412.

### E.5 `agent-chat/index.ts` — FALSE POSITIVES

Lines 296, 301, 308 reference `error.kind` — this is Google Gemini's error-object field, NOT brand.kind. **NO-CHANGE.**

### E.6 `_shared/email/tripConfirmationEmail.ts` — FALSE POSITIVE

Lines 157-158 reference `i.kind === "included"` / `i.kind === "excluded"` — this is the trip-inclusion enum (each trip inclusion item is tagged "included" or "excluded"). NOT brand.kind. **NO-CHANGE.**

### E.7 `_shared/email/buyerLifecycleAdapters.ts` — NO KIND REFERENCES

Subagent C grepped and found no `brand.kind` or `brands.kind` references. **NO-CHANGE.**

### E.8 `ticket-confirmation-dispatch/index.ts` + `installment_kinds.test.ts` — FALSE POSITIVES

Lines 729-736 in `index.ts` route on `body.kind` where the discriminator values are `installment_dunning` / `installment_plan_paid_in_full` etc. — this is the installment notification kind enum. NOT brand.kind. The test file `installment_kinds.test.ts` tests THIS enum. **NO-CHANGE.**

---

## F. Strict-grep CI gates

### F.1 ORCH-0855 adversarial check (A-07 + A-13)

| File | Lines | Assertion |
|---|---|---|
| `scripts/ci/orch-0855-adversarial-check.mjs` | 155-290 | A-07 locks `PersonaDef.id` to `'place' \| 'event' \| 'trip'` literal union |
| Same | (within range) | A-13 forbids re-introduction of a kind editor for trip-planner brands |

**Disposition:** Phase 4 Sub-D deletes both assertions (or the entire file if no other assertions remain). Update [.github/workflows/strict-grep-mingla-business.yml](.github/workflows/strict-grep-mingla-business.yml) to remove the corresponding job.

### F.2 ORCH-0963 strict-grep gate (only on origin/main; not in worktree)

| File | Assertions |
|---|---|
| `.github/scripts/strict-grep/orch-0963-public-brand-kind-branched.mjs` | C1: PublicBrandPage contains `brand.kind === "trip_planner"`; C2: publicEventsService calls `pg_public_trips_by_brand`; C3: BusinessPublicBrandViewRow.kind admits `"trip_planner"`; C4: event-type filter only in allowlisted files |

**Disposition (after rebase):**
- DELETE C1 (kind-branching is going away)
- DELETE C3 (TS union goes away with kind column)
- PRESERVE C2 (RPC is still called universally — just no kind guard)
- PRESERVE C4 (route segregation between /e and /t still applies)
- ADD new gate enforcing I-PUBLIC-PAGE-DATA-DRIVEN-TABS

### F.3 ORCH-0863 marketing-hub-phase-b backend allowlist

Per COMMS-0002 (factored): Phase 4 backend-touching commits must update `ORCH_0972_BACKEND_ALLOWLIST` in `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` for every `supabase/functions/` or `supabase/migrations/` file touched in the same commit.

---

## DROP COLUMN SAFETY PLAN — `brands.kind`

Dependency order — every layer below must be cleared BEFORE the column drop can run. Sequenced in 4 stages.

### Stage 1 — App + edge function code (no DB changes)

Stage 1 commits remove all CODE that reads `brand.kind`. After Stage 1 lands and deploys, no code in production reads the column; the column persists but is dormant.

1. **Phase 4 Sub-A** — delete `brandAuthoringGate.ts` + remove 2 callsites (D3)
2. **Phase 4 Sub-A** — delete `trip/create.tsx:52` kind gate (D7)
3. **Phase 4 Sub-A** — REGATE `experiences.tsx` 5 kind gates (D6)
4. **Phase 4 Sub-A** — REGATE `homeNextAction.ts` rung 2 + delete rung 4 (D5)
5. **Phase 4 Sub-A** — REGATE `canGenerateExperiencesFromMenu/Activities.ts` (D8)
6. **Phase 4 Sub-A** — DELETE `parse-restaurant-menu` kind+claim gates (E.1)
7. **Phase 4 Sub-A** — DELETE `parse-play-activities` kind+claim gates (E.2)
8. **Phase 4 Sub-A** — DELETE `agentTools.ts` kind gate (E.3)
9. **Phase 4 Sub-B** — DELETE `BrandEditView` SECTION B-2 kind picker (D2)
10. **Phase 4 Sub-B** — DELETE persona picker (PersonaPickerCards + PersonaForkSheet + BrandSwitcherSheet persona-fork mode) (D1)
11. **Phase 4 Sub-B** — DELETE `TripBrandWizard` (D1) + collapse into unified `BrandCreationFlow`
12. **Phase 4 Sub-B** — DELETE address-conditional-on-kind logic (D4)
13. **Phase 4 Sub-B** — REGATE `homeNextAction` rung 2 + UI to 3-button chooser (D5)
14. **Phase 4 Sub-B** — REGATE `VenueClaimStatusBanner` + `venueClaimBannerLogic` (D10)
15. **Phase 4 Sub-B** — REGATE `mingla-admin/src/services/adminClaimsService.js:37` filter (D12 finding)
16. **Phase 4 Sub-C** — REPURPOSE `PublicBrandPage.tsx` to data-driven tabs (D9)
17. **Phase 4 Sub-C** — REPURPOSE `publicEventsService.ts` to parallel-fetch (D9)
18. **Phase 4 Sub-C** — DELETE `BusinessPublicBrandViewRow.kind` TS union (D9)

### Stage 2 — Database views + RLS rewrites (DB changes; no column drop yet)

Stage 2 commits rewrite views and RLS so they don't reference `brands.kind`. After Stage 2 lands and deploys, no SQL reads the column.

19. **Phase 4 Sub-C migration** — DROP/RECREATE `business_public_brands_view` without `kind` in SELECT or WHERE
20. **Phase 4 Sub-C migration** — DROP/RECREATE `claimed_venues_public_view` without `kind` in SELECT or WHERE (WHERE becomes `claim_status='verified'` alone)
21. **Phase 4 Sub-C migration** — DROP/RECREATE `business_public_events_view` without `b.kind AS brand_kind` in SELECT (consumer read path needs update — Sub-D)
22. **Phase 4 Sub-C migration** — DROP / REPLACE 3 RLS policies (brands public-read, brand_hours public-read, place_pool public-read) without `kind = 'physical'` predicate
23. **Phase 4 Sub-C migration** — Rebase-aware: REWRITE `pg_public_trips_by_brand` RPC to drop `WHERE b.kind = 'trip_planner'` guard (returns trip rows for any brand)
24. **Phase 4 Sub-C migration** — Create new RPC `pg_public_experiences_by_brand(p_brand_slug)` if experiences are to appear on public page (pending Q4)

### Stage 3 — RPC rewrites

25. **Phase 4 Sub-C migration** — REPLACE `biz_create_venue_brand_pending_review()` body: remove `kind` from INSERT
26. **Phase 4 Sub-C migration** — REPLACE `biz_review_venue_claim()` body: remove `AND b.kind = 'physical'` guard

### Stage 4 — Constraint + column drop

After Stages 1+2+3 have been deployed and operating cleanly for ≥1 release cycle (no rollback signal):

27. **Phase 4 Sub-C migration (follow-up safe-deploy, 1 cycle later)** — `ALTER TABLE public.brands DROP CONSTRAINT brands_kind_check;`
28. **Phase 4 Sub-C migration (same follow-up)** — `ALTER TABLE public.brands DROP COLUMN kind;`
29. **Phase 4 Sub-D** — DELETE `scripts/ci/orch-0855-adversarial-check.mjs` assertions A-07 + A-13 (and the strict-grep workflow job that runs them)
30. **Phase 4 Sub-D** — DELETE/REPURPOSE `.github/scripts/strict-grep/orch-0963-public-brand-kind-branched.mjs` (after rebase) per F.2

### Backup snapshot retention

Per CLOSE Step 5h convention, if the column has any rows worth preserving for forensic recovery: `CREATE TABLE _archive_meta_orch_0972_brand_kind AS SELECT id, kind FROM public.brands;` before the DROP, with a 14-day retention reminder scheduled. **However:** operator has previously stated "zero live brands at INTAKE" — verify still true; if zero brands, the archive snapshot is unnecessary. Phase 3 spec confirms.

---

## Cross-references

- Companion Report: [`INVESTIGATION_META-ORCH-0972_BRAND_KIND_GAP_AUDIT.md`](./INVESTIGATION_META-ORCH-0972_BRAND_KIND_GAP_AUDIT.md) (12-dimension catalogue)
- Companion Report: [`INVESTIGATION_META-ORCH-0972_USER_JOURNEY_GAPS.md`](./INVESTIGATION_META-ORCH-0972_USER_JOURNEY_GAPS.md) (Phase 2 designer inputs)
- Companion Report: [`INVESTIGATION_META-ORCH-0972_OPEN_QUESTIONS.md`](./INVESTIGATION_META-ORCH-0972_OPEN_QUESTIONS.md) (operator questions Q1–Q11)
- Comms ledger COMMS-0002 (ORCH-0863 backend allowlist requirement for Phase 4)
- Base-tree discovery in Report 1 §"P1 DISCOVERY" (rebase needed before Phase 4 to pick up ORCH-0963 surfaces)

End of Report 2.
