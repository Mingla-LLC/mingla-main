# CODEX_INDEPENDENT_REVIEW_META-ORCH-0972_AUDIT

**ORCH:** META-ORCH-0972 [brand-kind decommission + universal feature access + data-driven hub/public tabs]  
**Reviewer:** Codex `forensic-mingla`  
**Mode:** Independent REVIEW of Phase 1 AUDIT  
**Date:** 2026-05-25  
**Working tree:** `~/Desktop/mingla-orchs/meta-orch-0972-[brand-kind-decommission-universal-features]/` on branch `meta-orch-0972-brand-kind-decommission-universal-features`  

---

## 1. Verdict

**VERDICT: NEEDS WORK**

The Phase 1 audit is directionally correct on the major architecture and most high-risk catalogue claims. Independent source checks confirmed the authoring gate truth table, hub experience gates, ORCH-0963 public-page kind branch, public-trip RPC guard, VE1/ORCH-0962 view predicates, admin dependency, server-side AI gates, and consumer-app false positives.

However, this review found targeted gaps that should be fixed before Phase 2 designer handoff:

1. The catalogue missed at least two active business-app brand-kind surfaces: `mingla-business/app/trip/[id]/edit.tsx:67` and `mingla-business/src/utils/brandPatch.ts:38-40`.
2. `INVESTIGATION_META-ORCH-0972_OPEN_QUESTIONS.md` is stale and contradicts later resolved state for Q1-Q4/Q6-Q10; especially Q4/Q9, where Report 1 says operator chose experiences in Upcoming with JSON sub-fields, while Report 4 still says Q4 is open and recommends excluding experiences from Upcoming.
3. The audit contains solution-drift language despite the read-only audit constraint, including new hook/RPC suggestions.

This is not a full rejection. The audit should receive a targeted supplemental/update, then Codex can re-review only those deltas.

---

## 2. Spot-check Results

| # | Surface | Catalogue claim | Observed at HEAD | Result |
|---|---|---|---|---|
| 1 | `mingla-business/src/services/brandAuthoringGate.ts:17-44` | Gate is delete-able because only `physical+unverified` blocks; `popup` and `trip_planner` already pass. | Predicate is exactly `row.kind === "physical" && row.claim_status !== "verified"`; only two callsites found in `eventDrafts.ts:172` and `tripsService.ts:441`. | MATCH |
| 2 | `mingla-business/app/(tabs)/hub/experiences.tsx:292/307/319/331/345` | Five distinct kind gates. | Confirmed all five: unverified physical guard, restaurant snap, play snap, creative placeholder, non-physical dead-end. | MATCH |
| 3 | `mingla-business/src/components/brand/PublicBrandPage.tsx:144` + `isTripBrand` refs | Post-rebase ORCH-0963 branch exists; 14 `isTripBrand` occurrences. | `const isTripBrand = brand.kind === "trip_planner"` at line 144; `rg -o isTripBrand | wc -l` returns 14. | MATCH |
| 4 | `supabase/migrations/20260728000000_orch_0963_pg_public_trips_by_brand.sql:46` | Single body guard `b.kind = 'trip_planner'`. | Line 46 is `AND b.kind = 'trip_planner'`; comments also mention it, but body has one guard. | MATCH |
| 5 | `supabase/migrations/20260613000000_ve1_physical_venue_brand_onboarding.sql:157-180` | VE1 public brand view used `kind IN ('popup','trip_planner') OR physical+verified`. | Confirmed in VE1 migration; also confirmed current latest view is ORCH-0962 at `20260727000003...:14-39` with equivalent predicate. | MATCH |
| 6 | `supabase/migrations/20260622000000_ve4_claimed_venues_public_view.sql:11-55` | RLS policies use `kind='physical'` plus verified claim for brands/hours/place_pool public reads. | Confirmed three public-read policies; no later migration replaces those policies. | MATCH |
| 7 | `mingla-admin/src/services/adminClaimsService.js:37` | One actual admin brand-kind dependency. | Confirmed `.eq("kind", "physical")`; `rg` found no other admin brand-kind dependency. | MATCH |
| 8 | `supabase/functions/parse-restaurant-menu/index.ts:155/161` | Server-side AI gate on physical + verified. | Confirmed `brand.kind !== "physical"` and `brand.claim_status !== "verified"` blocks. | MATCH |
| 9 | `supabase/functions/parse-play-activities/index.ts:162/176` | Server-side AI gate on physical + verified. | Confirmed both blocks. | MATCH |
| 10 | `supabase/functions/_shared/agentTools.ts:412/421` | Agent tool has server-side physical/verified gate. | Confirmed `brand.kind !== "physical"` and claim-status gate at line 421. | MATCH |
| 11 | `app-mobile/src/payments/nativeCheckoutFlow.ts:13/53/58/84` | Consumer `kind` is checkout response discriminator, not brand kind. | Confirmed `free_completed`, `requires_payment`, `requires_web_redirect` response union. | MATCH |
| 12 | `app-mobile/src/contexts/deckStateRegistry.ts:24/30/31` | Consumer `kind` is deck context discriminator, not brand kind. | Confirmed `solo` / `collab` deck context union; `rg brand.kind... app-mobile/src` has zero hits. | MATCH |
| 13 | `mingla-business/app/trip/[id]/edit.tsx:67` | Not catalogued. | Active route effect returns early when `currentBrand.kind !== "trip_planner"` while migrating client-only trip IDs to server drafts. | MISMATCH: MISSED SURFACE |
| 14 | `mingla-business/src/utils/brandPatch.ts:38-40` | Not catalogued. | Dirty-patch helper includes `kind` in update patches when draft kind changes. | MISMATCH: MISSED SURFACE |
| 15 | `mingla-business/src/services/publicEventsService.ts:987/1086` | Line 987 VERIFY-NEEDED; line 1086 false positive. | Line 987 orders trip inclusions by inclusion `kind`; line 1086 maps trip inclusion `kind`. Not brand-kind. | MATCH WITH LOW CLEANUP |

---

## 3. Checklist Coverage

| Checklist item | Verdict | Evidence |
|---|---|---|
| Catalogue completeness | **FAIL** | Targeted grep found missed active surfaces in `trip/[id]/edit.tsx:67` and `brandPatch.ts:38-40`; `UniversalCreatorSheet.tsx:79-80` also contains stale kind-gate copy. |
| Migration-chain rule applied correctly | **PASS** | Latest `brands_kind_check` is ORCH-0855; latest `business_public_brands_view` and `claimed_venues_public_view` are ORCH-0962; current public-read policies remain VE4. |
| No false positives in DELETE column | **PASS** | Spot-checked authoring gate, persona/TripBrandWizard references, and BrandEdit kind section; DELETE classifications are plausible, though missed surfaces must be added. |
| No solution drift | **FAIL** | Reports include new hook/RPC direction such as `useHubTabVisibility()`, `pg_public_experiences_by_brand`, and `pg_public_brand_upcoming`; these exceed pure catalogue language. |
| Cross-references consistent | **FAIL** | Report 1 says Q4/Q9 are resolved with experiences in Upcoming and JSON sub-fields; Open Questions still marks Q4/Q9 open and recommends a conflicting default. |
| DROP COLUMN safety plan ordering | **PASS WITH GAP** | Code-first → views/RLS → RPCs → constraint/column is sound, but the missed code surfaces need to be inserted before Stage 4 can be trusted. |
| Post-rebase supplemental verified | **PASS** | `PublicBrandPage.tsx`, `publicEventsService.ts`, ORCH-0963 RPC, and strict-grep gate exist at HEAD and match the supplemental claims. |
| 8 user journeys cover the model | **PASS WITH STALE-Q CAVEAT** | Journeys cover the right user flows, including public mixed offerings; Q references are stale where operator answers later resolved them. |
| Open questions actionable | **FAIL** | The dispatch and WORLD_MAP say Q1-Q11 are answered, but the report itself still marks many open and contains obsolete recommendations. |
| Comms-ledger cross-checks | **PASS** | Report 1 acknowledges COMMS-0002 and COMMS-0003; Data Model Audit carries the backend allowlist requirement forward. |

---

## 4. Gaps Found

### G1 — Missed active trip-edit kind gate

`mingla-business/app/trip/[id]/edit.tsx:67` returns early when `currentBrand.kind !== "trip_planner"` inside the client-only trip draft migration path. This is an active business-app brand-kind dependency and should be catalogued before any universal trip-authoring implementation work.

### G2 — Missed brand update patch surface

`mingla-business/src/utils/brandPatch.ts:38-40` includes `kind` in dirty-field patches. This is active brand-edit plumbing and should be catalogued alongside `BrandEditView`, `brandMapping`, and `brandsService`.

### G3 — Open-questions artifact is stale and contradicts resolved operator decisions

`INVESTIGATION_META-ORCH-0972_OPEN_QUESTIONS.md` still says Q4 is open and recommends excluding experiences from Upcoming. Report 1 supplemental, WORLD_MAP, and the dispatch state the operator chose experiences IN Upcoming with `theme.experience_meta.next_occurrence_at` JSON sub-fields. This is a material handoff risk for Phase 2.

### G4 — Low-risk stale copy/comment miss

`mingla-business/src/components/ui/UniversalCreatorSheet.tsx:79-80` still documents `/trip/create` as gated to `trip_planner`. This is copy/comment-only but should be catalogued as UPDATE-COPY or explicitly false-positive/out-of-scope.

---

## 5. Solution-drift Flags

The audit mostly uses catalogue/disposition language, but the following lines go beyond current-state verification:

| File | Line(s) | Drift |
|---|---|---|
| `INVESTIGATION_META-ORCH-0972_BRAND_KIND_GAP_AUDIT.md` | 156 | Says a new `useHubTabVisibility()` hook is needed. |
| `INVESTIGATION_META-ORCH-0972_BRAND_KIND_GAP_AUDIT.md` | 215 | Names `pg_public_experiences_by_brand` or `pg_public_brand_upcoming` as needed for the Upcoming tab. |
| `INVESTIGATION_META-ORCH-0972_DATA_MODEL_AUDIT.md` | 29-31 | Specifies exact migration actions for dropping constraint/column inside an audit report. |
| `INVESTIGATION_META-ORCH-0972_DATA_MODEL_AUDIT.md` | 349 | Names creating a new `pg_public_experiences_by_brand` RPC as a plan step while Q4/Q9 are not reconciled in Report 4. |

These are not necessarily bad ideas; they are phase-drift for a read-only audit and should be moved or reframed in the later spec/design artifact.

---

## 6. Recommendation To Orchestrator

Route back to Claude `mingla-forensics` for a targeted supplemental, not a full re-audit.

Required rework before Phase 2:

1. Add the missed surfaces (`trip/[id]/edit.tsx:67`, `brandPatch.ts:38-40`, and stale UniversalCreatorSheet copy if desired) to the catalogue and DROP COLUMN safety plan.
2. Reconcile `INVESTIGATION_META-ORCH-0972_OPEN_QUESTIONS.md` with the operator's actual Q1-Q11 answers, especially Q4/Q9/Q10.
3. Reword or move solution-drift lines so the Phase 1 audit stays catalogue-only.
4. Re-run the same small Codex review only against the changed sections.

Downstream routing after targeted cleanup: if the supplemental fixes these items, proceed to Phase 2 designer.

---

## 7. Confidence Level

**Confidence: HIGH** on the NEEDS WORK verdict.

Reasoning: I read all five deliverable artifacts, ran the required targeted greps, and independently verified more than the minimum eight catalogue claims against source. The core audit is trustworthy enough to avoid a full restart, but the missed active surfaces plus stale open-questions artifact are real handoff defects.

End of Codex independent review.
