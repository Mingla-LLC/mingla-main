# IMPLEMENTATION REPORT — META-ORCH-0972 Sub-C

## 1. Verdict

**IMPLEMENTED — ready for orchestrator REVIEW, then operator migration gate.**

Sub-C now ships Stage 0 + Stage 2 + Stage 3 of the brand-kind decommission safety plan in one migration: additive offering-count/upcoming/experience RPCs, public view rewrites without `b.kind AS brand_kind`, RLS policy rewrites without `kind='physical'`, ORCH-0963 public trips RPC kind-guard removal, and venue claim SECURITY DEFINER body rewrites without `brands.kind` writes/filters.

The public brand page now renders data-driven tabs for Upcoming, Events, Trips, Experiences, and About; zero-offering brands keep identity/About visible with neutral empty copy; owner offering counts now use `pg_brand_offering_counts`; the TypeScript `Brand.kind` field is removed.

## 2. COMMS Acks

| Entry | Severity | Action |
|---|---:|---|
| COMMS-0002 | BLOCK | Acknowledged in anchor ledger and complied: new `supabase/migrations/20260729000000_meta_orch_0972_universal_authoring.sql` plus `supabase/functions/__tests__/pg_public_brand_upcoming.test.sql` are added to `ORCH_0972_BACKEND_ALLOWLIST` in the same commit scope. |
| COMMS-0003 | WARN | Acknowledged; no external API docs or Stripe/Resend/provider changes in Sub-C. |
| COMMS-0004 | FYI | Read and preserved launch-routing context. |
| COMMS-0005 | WARN | Acknowledged; `PublicBrandPage.tsx` was rebuilt below/around the tab/data surfaces. The web `<Head>` SEO/metadata block was not edited. |

## 3. Inputs Read

| Input | Use |
|---|---|
| `Mingla_Artifacts/prompts/IMPLEMENTOR_META-ORCH-0972_SUB_C.md` | Binding dispatch, guards, output shape, operator command. |
| `Mingla_Artifacts/specs/SPEC_META-ORCH-0972_BRAND_KIND_DECOMMISSION.md` §Sub-spec C | Migration order, public page rebuild contract, SC-C acceptance checks. |
| `Mingla_Artifacts/reports/QA_META-ORCH-0972_SUB_B_ANDROID_RETEST_3.md` | Sub-B PASS context and files not to disturb. |
| `Mingla_Artifacts/reports/IMPLEMENTATION_META-ORCH-0972_SUB_B.md` + `IMPLEMENTATION_META-ORCH-0972_SUB_B_ANDROID_REWORK_3.md` | Sub-B lazy Stripe/native-startup baseline to preserve. |
| `Mingla_Artifacts/investigations/INVESTIGATION_META-ORCH-0972_DATA_MODEL_AUDIT.md` | DROP COLUMN safety plan Stage 0/2/3 mechanics. |
| `Mingla_Artifacts/reports/INVESTIGATION_META-ORCH-0972_OPEN_QUESTIONS.md` | Q4/Q9/Q11 decisions for Upcoming, experience metadata, and Stage 4 archive awareness. |
| `COMMS_LEDGER.md` | COMMS-0002/0003/0004/0005 routing and constraints. |

## 4. Root-Cause / Scope Tie-Back

Legacy public brand behavior depended on `brands.kind` to decide what a brand was allowed to show. That blocked universal authoring because trips, events, and experiences were coupled to brand persona instead of actual offering rows.

Sub-C changes the contract to "a brand can surface whatever published offerings it owns." The database exposes per-offering read models and the public page assembles tabs from fetched data, while Stage 4 column removal remains intentionally deferred to a later release-cycle migration.

## 5. Files Changed

| Area | Files |
|---|---|
| Migration + allowlist | `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs`; `supabase/migrations/20260729000000_meta_orch_0972_universal_authoring.sql`; `supabase/functions/__tests__/pg_public_brand_upcoming.test.sql` |
| Public brand UI | `mingla-business/src/components/brand/PublicBrandPage.tsx`; `ExperienceMiniCard.tsx`; `NextEventTeaser.tsx`; `mingla-business/app/b/[brandSlug]/index.tsx`; `useUpcomingFeed.ts`; `usePublicEvents.ts` |
| Public data service | `mingla-business/src/services/publicEventsService.ts`; public event/venue service tests |
| Owner counts + brand typing | `useBrandOfferingCounts.ts`; `types/brand.ts`; `brandMapping.ts`; `businessEvents.ts`; `brandList.ts`; `currentBrandStore.ts`; `useBrands.ts`; `useBusinessEvents.ts`; related tests |

## 6. Regression Coverage

| Test / Check | Result | Fails-on-revert |
|---|---:|---|
| `npx jest --runTestsByPath __tests__/components/PublicBrandPage.dataDriven.test.tsx` | PASS, 4 tests | Verified at `2aea165d5`; temporary reverse of `PublicBrandPage.tsx` + `publicEventsService.ts` produced 4 failing assertions. |
| `supabase/functions/__tests__/pg_public_brand_upcoming.test.sql` | Added SQL post-migration regression for interleave, cursor, limit+1, and `offering_type` shape | Annotated `2aea165d5`; baseline has no `pg_public_brand_upcoming` function, so this fails after migration revert/post-apply absence. |
| Focused Jest public-brand/service battery | PASS, 10 suites / 53 tests | Covers existing ORCH-0962/0963/Ve4 behavior that Sub-C must not break. |

Command run:

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/meta-orch-0972-[brand-kind-decommission-universal-features]/mingla-business" && npx jest --runTestsByPath __tests__/components/PublicBrandPage.dataDriven.test.tsx src/components/brand/__tests__/PublicBrandPage.nextEventTeaser.test.ts src/components/brand/__tests__/PublicBrandPage.tripBrand.test.ts src/components/brand/__tests__/TripMiniCard.cancelledTripLeak.adversarial.test.ts src/components/brand/__tests__/PublicBrandPage.pastCap.adversarial.test.ts src/services/__tests__/publicEventsService.tripFetch.test.ts src/services/__tests__/publicEventsService.orch_0962.test.ts src/services/__tests__/publicEventsService.orch_0962.adversarial.test.ts src/services/__tests__/publicEventsService.test.ts src/services/__tests__/publicEventsService.ve4.test.ts
```

## 7. Verification Gates + SC-C Criteria

| Gate | Result |
|---|---|
| Branch | PASS: `meta-orch-0972-brand-kind-decommission-universal-features`. |
| Baseline before Sub-C edits | PASS: `2aea165d5`. |
| Ancestors | PASS: `411925909` and `fee178634` remain ancestors. |
| Migration filename collision | PASS: no pre-existing `20260729` collision before authoring; current worktree now owns `20260729000000_meta_orch_0972_universal_authoring.sql`. |
| Worktree Supabase link | PASS: linked to project `gqnoajqerqhnvulmnyvv` for operator command readiness. |
| `supabase migration list --linked` | PASS: new `20260729000000` is local-only pending; no remote-only migrations. |
| `node --check .github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` | PASS. |
| `node .github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` | PASS; C7 allowlist accepts Sub-C backend files. |
| Scoped `git diff --check` | PASS on Sub-C files. Global `git diff --check` is blocked by pre-existing trailing whitespace in `QA_META-ORCH-0972_SUB_B_REPORT.md`, which was not staged. |
| `npm run typecheck -- --noEmit` | FAIL due pre-existing checkout, marketing editor, native Stripe module, draft fixture, and shared package errors. Sub-C-specific `PublicBrandPage.tsx` / `useUpcomingFeed.ts` errors were fixed and are no longer present. |
| Sub-B immutable file list | PASS: no diffs to BrandCreationFlow, OfferingChooser, useHubTabs, BrandSwitcherSheet, native Stripe boundary/wrapper files, checkout payment screens, package/lockfiles, or Metro config. |
| Package bumps | PASS: none. |
| `<Head>` lane | PASS: no diff inside the `PublicBrandPage.tsx` web SEO/metadata `<Head>` block. |

SC-C cross-reference:

| Criterion | Status |
|---|---|
| SC-C-1 | Migration authored with Stage 0/2/3 in the required order. |
| SC-C-2 | Views rewritten without `b.kind` SELECT/WHERE usage; `business_public_events_view` now exposes `event_type` and drops `brand_kind`. |
| SC-C-3 | Brands, brand_hours, and place_pool public RLS policies rewritten without physical-kind guards. |
| SC-C-4 | New/rewritten RPCs present: `pg_brand_offering_counts`, `pg_public_brand_upcoming`, `pg_public_experiences_by_brand`, `pg_public_trips_by_brand`, `biz_create_venue_brand_pending_review`, `biz_review_venue_claim`. |
| SC-C-5 | `pg_public_trips_by_brand` no longer joins/filters on `brands.kind`; tester should probe popup-brand trips after operator migration. |
| SC-C-6 | `pg_brand_offering_counts` is authenticated-only and backed by published non-deleted event rows. |
| SC-C-7 | `pg_public_brand_upcoming` interleaves event/trip/experience rows chronologically and returns `limit + 1`. |
| SC-C-8 / SC-C-9 | Public views and RPC grants applied for anon/authenticated where required; owner-count RPC remains authenticated-only. |
| SC-C-10 through SC-C-12 | `biz_create_venue_brand_pending_review` no longer inserts `kind`; `biz_review_venue_claim` no longer requires `kind='physical'`; Stage 4 drop-column deferred. |
| SC-C-13 | `BusinessPublicBrandViewRow.kind`, `BusinessPublicEventViewRow.brand_kind`, and `Brand.kind` TS fields removed. |
| SC-C-14 | SQL regression file added. |
| SC-C-15 | PublicBrandPage data-driven regression file added and fail-on-revert verified. |

## 8. Refreshed Evidence

Read-only Management API probe results before recording the operator command:

| Probe | Result |
|---|---|
| `public.brands` SELECT policies | 5 existing SELECT policies. The named kind policy `"Public can read verified physical venues"` is present; there are parallel owner/admin/member/public-event policies. Migration therefore drops/replaces only the named kind policy and supplements parallel policies, as required. |
| Live non-deleted brands | 21. Stage 4 archive/drop-column follow-up must keep this in mind; Sub-C does not drop the column. |
| Existing `pg_public_trips_by_brand` kind guard | Present before Sub-C (`pg_get_functiondef` contained the ORCH-0963 kind guard), proving the migration has a real guard to remove. |
| Experience next occurrence rows | 0 rows currently match `event_type='experience' AND deleted_at IS NULL AND theme->'experience_meta'->>'next_occurrence_at' IS NOT NULL`; partial index clause does not omit live known data today. |

Operator command, not run by implementor:

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/meta-orch-0972-[brand-kind-decommission-universal-features]" && /Users/sethogieva/bin/supabase migration list --linked
# expect: no remote-only versions
cd "/Users/sethogieva/Desktop/mingla-orchs/meta-orch-0972-[brand-kind-decommission-universal-features]" && /Users/sethogieva/bin/supabase db push --linked
```

## 9. Constraints-Held Checklist

| Constraint | Held |
|---|---:|
| Did not run `supabase db push` | YES |
| Did not deploy Supabase functions | YES |
| Did not open a PR | YES |
| Did not include the deploy-gate tag in commit messaging | YES |
| Migration + backend allowlist in same commit scope | YES |
| Sub-A immutable | YES |
| Sub-B immutable guarded files untouched | YES |
| `metro.config.js` Connect alias preserved | YES |
| No package or lockfile changes | YES |
| `411925909` ancestor preserved | YES |
| `fee178634` ancestor preserved | YES |
| Stage 4 `DROP COLUMN brands.kind` not attempted | YES |

## 10. Downstream Routing

Control returns to Claude `mingla-orchestrator` for REVIEW of Sub-C. After REVIEW approval, Seth runs the operator-gated `supabase db push --linked` command above from this worktree. After migration confirmation, orchestrator should route Sub-D for edge function deploys, strict-grep gate rewrites, and the Q15 parser regate; tester then validates Sub-D before any Stage 4 `DROP COLUMN brands.kind` follow-up. The final META-ORCH-0972 close PR still needs `[TEST-MOD-APPROVED META-ORCH-0972]` in the squash body.
