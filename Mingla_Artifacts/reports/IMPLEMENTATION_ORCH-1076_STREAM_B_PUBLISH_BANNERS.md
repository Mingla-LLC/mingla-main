# IMPLEMENTATION — ORCH-1076 Stream B [business-app proactive publish banners]

**Skill:** mingla-implementor (Claude parity mirror).
**Date:** 2026-06-04.
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1076-[paid-readiness-supply-and-publish-banners]/` on branch `ORCH-1076-paid-readiness-supply-and-publish-banners`.
**Base commit:** `1dcc346ca` (ORCH-1076 Stream A — suppress paid offerings from brands that can't charge).
**SPEC:** `Mingla_Artifacts/specs/SPEC_ORCH-1076_STREAM_B_PUBLISH_BANNERS.md` (committed `20b412e83`).
**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-1076_STREAM_B_PUBLISH_BANNERS.md`.
**Status:** implemented and verified (logic + tsc + eslint + jest). On-device SC-iOS/SC-Android remain the orchestrator+operator QA step (shared RN, parity automatic).

---

## 0. Comms ledger

Read on entry. No BLOCK/WARN row is addressed to `mingla-implementor`+ORCH-1076 or requires action. **COMMS-0002 (backend allowlist) is N/A** — this ORCH touches NO `supabase/functions/` file and NO migration, so no strict-grep backend allowlist update is required. **COMMS-0003 (external-API docs inline) is N/A** — no external API, no migration, no edge function is introduced or modified; the only server references are INTERNAL (the already-shipped ORCH-1075 migration predicates, cited by line in the resolver header for parity). No new ledger entry written (no cross-ORCH discovery affecting another in-flight ORCH; the one SPEC-vs-reality nuance found is a test-expectation correction, documented in §7).

---

## 1. One-line summary

Trips and experiences now get the SAME proactive "Connect Stripe to publish" guidance events already have — a banner in the CREATE wizard, a disabled Publish button, and a blocking toast on tap — driven by per-type paid resolvers that EXACTLY mirror the ORCH-1075 server predicates, with the reactive server guard left untouched as the canonical fail-close.

---

## 2. Files changed — Old → New receipts

### F-2 `src/components/offering/publishStripeReadiness.ts` (NEW)
**Before:** did not exist.
**Now:** pure module exporting `offeringNeedsStripeToPublish({isPaid, stripeStatus})` + per-type resolvers `eventDraftIsPaid`, `tripDraftIsPaid`, `experienceDraftIsPaid`. Each resolver's header cites the exact ORCH-1075 migration lines it mirrors (`pg_brand_can_charge` L65-78; event L2133-2151; trip L2454-2473; experience L301-313/356-360 + L874-884/928-930) and carries the regression-guard comment: "If the server predicate changes, update these resolvers + the parity fixtures in the SAME PR."
**Why:** SPEC §4 (HARD parity contract) + §11 step 1. INV-1.
**Lines:** ~95 (new file).

### F-1 `src/components/offering/StripeBlockedCard.tsx` (NEW)
**Before:** did not exist; the card was a private sub-component inside `CreatorStep7Preview.tsx`.
**Now:** shared `<StripeBlockedCard title? body? ctaLabel? onConnectStripe testID?>` primitive. Defaults reproduce the event copy + tokens VERBATIM (GlassCard base, `flag`/`chevR` icons, `accent.*` CTA tokens, the exact `warnCard`/`statusRow`/`statusTitle`/`statusSub`/`connectStripeBtn`/`connectStripeLabel` styles).
**Why:** SPEC §3 F-1 + §11 step 2.
**Lines:** ~120 (new file).

### F-3 `src/components/event/CreatorStep7Preview.tsx`
**Before:** rendered a LOCAL `StripeBlockedCard` sub-component (lines 221-248) with its `connectStripeBtn`/`connectStripeLabel` styles.
**Now:** imports the shared F-1 and renders `<StripeBlockedCard onConnectStripe={onConnectStripe} />` with NO copy override (inherits byte-identical defaults). Local sub-component + interface + the two now-unused styles deleted. `warnCard`/`statusRow`/`statusTitle`/`statusSub`/`statusTextCol` retained (still used by ReadyCard/ErrorsBlockedCard).
**Why:** SPEC §3 F-3 + §11 step 3 — PURE byte-identical refactor.
**Lines:** ~-30 net (deleted sub-component, +1 import + comment).

### F-4 `src/components/trip/TripPreview.tsx`
**Before:** `TripPreviewBrand` = `{id, slug, name, bio?, coverMediaUrl?}`.
**Now:** + optional `stripeStatus?: BrandStripeStatus | null` (additive; public `/t/{slug}` passes nothing; anon-tolerant preserved). Imports `BrandStripeStatus` type.
**Why:** SPEC §3 F-4. INV-7.
**Lines:** ~+10.

### F-5 `app/trip/[id]/edit.tsx`
**Before:** built the narrow `brand={{id,slug,name,bio,coverMediaUrl}}`, dropping `stripeStatus`.
**Now:** + `stripeStatus: currentBrand.stripeStatus ?? null`.
**Why:** SPEC §3 F-5 (thread readiness from the authenticated route).
**Lines:** ~+2.

### F-6 `src/components/trip/TripCreatorStep5Review.tsx`
**Before:** rendered the reactive `publishError` banner + `TripPreview`.
**Now:** + optional `needsStripe?: boolean` (default false) + `onConnectStripe?`. Renders the shared `StripeBlockedCard` (trip copy: "Stripe required for paid trips" / body / "Finish Stripe setup") BELOW the reactive `publishError` and ABOVE the preview when `needsStripe`. New `stripeBannerWrap` style.
**Why:** SPEC §3 F-6 + §7.2. Both banners co-render (different concerns).
**Lines:** ~+30.

### F-7 `src/components/trip/TripCreatorWizard.tsx`
**Before:** dock Publish `disabled={submitting}`; `handlePublishTap` opened the confirm dialog unconditionally; only the reactive catch handled Stripe.
**Now:** computes `tripNeedsStripe = offeringNeedsStripeToPublish({isPaid: tripDraftIsPaid(step4Draft), stripeStatus: brand.stripeStatus ?? null})`; `handleConnectStripe → brandStripeOnboardingRoute(trip.brandId)`; passes `needsStripe`+`onConnectStripe` to F-6; dock Publish `disabled={submitting || tripNeedsStripe}`; `handlePublishTap` pre-checks `tripNeedsStripe` → blocking toast "Connect Stripe to publish this paid trip." + early-return (no confirm dialog). Reactive catch untouched.
**Why:** SPEC §3 F-7 + §7.3.
**Lines:** ~+30.

### F-8 `src/components/experience/ExperienceCreatorWizard.tsx`
**Before:** no proactive banner; Publish `disabled` only on `submitting`(loading); reactive `handlePaidPublishGuard` only.
**Now:** computes `experienceNeedsStripe = !isLiveEdit && offeringNeedsStripeToPublish({isPaid: experienceDraftIsPaid({isFree, resolvedTotalMajor}), stripeStatus: brand?.stripeStatus ?? null})`; `handleConnectStripe → brandStripeOnboardingRoute(brand.id)`; mounts the shared banner (experience copy) inline at the bottom of the Pricing step (4) AND above the footer Publish on the Cover step (5); footer Publish `disabled={experienceNeedsStripe}` (Save-as-draft stays enabled); `handleSubmit(true)` pre-checks `experienceNeedsStripe` → toast "Connect Stripe to publish this paid experience." + return before `biz_publish_experience`. Live-edit branch keeps ONLY the reactive catch (gate is `!isLiveEdit`). New `stripeBannerWrap` style.
**Why:** SPEC §3 F-8 + §5 D-3 + §7.2/7.3.
**Lines:** ~+45.

**No other files changed.** `businessTodos.ts`, `paidPublishGuards.ts`, and the ORCH-1075 server guard are UNTOUCHED (N-2/N-3).

---

## 3. Cross-surface impact (Step 3.5)

| Surface | Affected | What changes | Parity |
|---|---|---|---|
| Consumer iOS / Android (`app-mobile/`) | NO | — | Consumer app doesn't author offerings. |
| Buyer/anon Web (`mingla-business/` `/t/{slug}`, `/checkout/…`) | NO | `TripPreviewBrand.stripeStatus` is optional; the public route never passes it. | Anon buyers never publish. |
| Business iOS | YES | Paid trip/experience on a Stripe-inactive brand: banner + disabled Publish + blocking toast. Events byte-identical. | Shared RN — automatic. |
| Business Android | YES | Identical to iOS; GlassCard opaque-fallback policy already compliant (reused variant). | Automatic. |
| Admin Web | NO | — | Admin doesn't render creator wizards. |
| Business Web preview | YES | Identical to iOS. | Automatic. |

Parity across the 3 affected surfaces is AUTOMATIC (one shared component tree). No manual per-platform code path → no cross-surface drift risk to flag.

---

## 4. Spec traceability (Success Criteria)

| SC | Status | Evidence |
|---|---|---|
| SC-1 Event refactor identity | PASS | T-15 (event-identity snapshot): shared card default copy === original event strings; Step 7 renders the bare-prop shared card; local sub-component gone. Fails-on-revert proven (§6). |
| SC-2 Trip banner shows | PASS | T-17: review renders the trip StripeBlockedCard when `needsStripe`; F-7 computes it from the paid resolver + status; CTA → `brandStripeOnboardingRoute(trip.brandId)`. |
| SC-3 Trip banner hidden when free | PASS | T-18 / default-false; `tripDraftIsPaid` returns false for empty/0 price (T-05). |
| SC-4 Trip banner hidden when active | PASS | `offeringNeedsStripeToPublish` false when `stripeStatus==="active"` (T-02). |
| SC-5 Trip Publish disabled + toast | PASS | T-19: dock `disabled={submitting || tripNeedsStripe}`; `handlePublishTap` toasts + returns before the confirm dialog. |
| SC-6 Experience banner shows (Pricing + Cover) | PASS | Pricing/Cover mount tests; `experienceDraftIsPaid` true for whole (T-06) + per-stop sum (T-07). |
| SC-7 Experience hidden when free | PASS | T-08 (`isFree` overrides) / T-09 (sum 0). |
| SC-8 Experience hidden when active | PASS | T-02. |
| SC-9 Experience Publish disabled, draft enabled, toast | PASS | T-20 (Publish disabled, Save-as-draft NOT) + T-21 (pre-check returns before RPC). |
| SC-10 Per-type parity truth-table | PASS | T-10/T-11/T-12 assert client === independently-computed server boolean for every fixture row. |
| SC-11 No edit-to-paid banner | PASS | T-23: `EditPublishedTripScreen` has no `StripeBlockedCard`; experience gate is `!isLiveEdit`. |
| SC-12 Server fail-close intact | PASS | T-24: reactive `mapPublishErrorToState` + `stripe_charges_disabled` + `brandStripeOnboardingRoute` still wired; ORCH-1075 migration/guards untouched. |
| SC-13 `businessTodos.ts` untouched | PASS | Diff check: file not in the ORCH-1076 diff. |
| SC-iOS / SC-Android | DEFERRED (on-device QA) | Shared RN; parity automatic. Orchestrator+operator step per dispatch. |

---

## 5. The per-type parity contract (INV-1) — server lines mirrored

| Type | Server predicate (migration `20260911000000_orch_1075_…sql`) | Client mirror |
|---|---|---|
| Stripe-ready | `pg_brand_can_charge` L65-78 (attached account, `detached_at IS NULL`, `charges_enabled IS DISTINCT FROM false`) | `stripeStatus === "active"` (deriveBrandStripeStatus.ts:57) |
| Event | L2133-2151: `bool_or(availableAt IN ('online','both') AND NOT isFree AND round(price*100)>0)` | `tickets.some(!isFree && (priceGbp??0)>0)` |
| Trip | L2454-2473: `max(price_cents) WHERE available_online > 0` | `round(parseFloat(priceMajor)*100) > 0` |
| Experience | L301-313/356-360 + L874-884/928-930: `NOT is_free AND v_resolved_total>0` (whole OR Σ stop) | `!isFree && resolvedTotalMajor>0` |

The parity tests (T-10/T-11/T-12) independently recompute the server boolean from the same cents/total math and assert the client resolver matches for every fixture row.

---

## 6. Regression test + Step 0.5 evidence

**Test files shipped in the closing diff (5):**
- `src/components/offering/__tests__/publishStripeReadiness.test.ts` — T-01…T-12 (resolvers + server-parity truth-tables).
- `src/components/offering/__tests__/StripeBlockedCard.test.tsx` — T-13/T-14 (shared primitive default + custom copy + CTA wiring + tokens).
- `src/components/event/__tests__/CreatorStep7Preview.refactorParity.test.tsx` — T-15/T-16 (event-identity snapshot + ready-branch intact).
- `src/components/trip/__tests__/TripPublishStripeBanner.test.tsx` — T-17/T-18/T-19 + T-23/T-24.
- `src/components/experience/__tests__/ExperiencePublishStripeBanner.test.tsx` — T-20/T-21/T-22 + T-23.

**Harness note:** mingla-business runs Jest in a **Node environment without react-test-renderer / @testing-library/react-native** (jest.config.cjs). Importing an RN component into a test fails to transform its native imports. Per the established repo convention (e.g. `event/__tests__/PublicEventPage.closeButton.test.tsx`), the pure resolvers (T-01…T-12) are true unit tests, and the component-level criteria (T-13…T-24) are **source-characterization** tests pinning the JSX wiring + byte-identity of the extracted card. For the event-identity guard (T-15) this is actually a STRONGER lock than a render snapshot: it pins the shared card's default copy = the exact pre-refactor strings AND asserts Step 7 consumes it with NO copy override AND the local sub-component is gone.

**Passing run (5 ORCH-1076 suites):**
```
Test Suites: 5 passed, 5 total
Tests:       64 passed, 64 total
```

**Fails-on-revert verified at `1dcc346ca`:**
1. **Resolver parity** — dropping the `!isFree` gate in `experienceDraftIsPaid` (`draft.resolvedTotalMajor > 0`) → `publishStripeReadiness.test.ts` FAILS (T-08 `1 failed, 35 passed`). Restored → all pass.
2. **Event-identity** — changing the shared card default title to `"Stripe required for paid tickets DRIFT"` → BOTH `StripeBlockedCard.test.tsx` AND `CreatorStep7Preview.refactorParity.test.tsx` FAIL (`2 failed`). Restored → all pass.

Both reverts target the exact behaviors Stream B exists to protect (client/server paid-detection parity; the byte-identical event refactor), proving the tests are not vacuous.

---

## 7. SPEC discrepancy found + corrected (test expectation only)

SPEC §9 T-05 lists `priceMajor:"0.005"` → expected `false` ("rounds to 0"). This is incorrect: `0.005 * 100 = 0.5` EXACTLY in IEEE-754, and both `Math.round(0.5) = 1` (client) and PostgreSQL `round(0.5) = 1` (server, round-half-away-from-zero) → 1 cent → **paid (true)**. The resolver is server-faithful (the binding INV-1 contract); the test asserts `true` for `0.005` and documents the discrepancy inline. The `0.004` row (rounds to 0) correctly stays `false`. The T-10 parity test independently confirms client === server for `0.005` regardless. No code change to the resolver was warranted — it already moves with the server. Flagged here for the SPEC author; not a cross-ORCH concern (no ledger entry needed).

---

## 8. tsc / ESLint / full-suite gate

- **`tsc --noEmit`:** ZERO errors in any ORCH-1076-touched file (filtered). Pre-existing repo-wide errors (e.g. `account.tsx` IconName, checkout buyers' implicit-any, `DraftEvent.category` in legacy tests, `@mingla/payments-native` module, brand-rendering package) exist at the base commit and are untouched by this ORCH.
- **ESLint (touched + test files):** clean. The only remaining note is a PRE-EXISTING `react-hooks/exhaustive-deps` warning at the `venueDefault` useEffect in `ExperienceCreatorWizard.tsx` (confirmed present at HEAD `1dcc346ca` before my edit). `TripPreview.tsx`'s `@mingla/event-rendering` `import/no-unresolved` is likewise a pre-existing baseline (monorepo workspace-resolution quirk, present at HEAD).
- **5 new ORCH-1076 suites:** `Test Suites: 5 passed, 5 total / Tests: 64 passed, 64 total` — captured cleanly (all 24 SPEC T-cases + extra edge coverage).
- **Full mingla-business jest suite:** the worktree carries a large PRE-EXISTING baseline of failing suites (same root as the baseline tsc errors — legacy `DraftEvent.category` fixtures, `@mingla/*` module resolution, etc.), unrelated to this ORCH.
- **Environment note (self-caused, recovered):** running many concurrent background jest invocations against the SHARED anchor `node_modules` (symlinked into this worktree) truncated several jest build files to null-content-with-preserved-byte-size (`@jest/test-sequencer/build/index.js`, `@jest/core/build/TestScheduler.js`, `@jest/fake-timers/build/legacyFakeTimers.js`), which then surfaced as `Sequencer is not a constructor` / `createTestScheduler is not a function` / `LegacyFakeTimers is not a constructor`. RESOLVED by restoring each corrupted file from the npm cache tarball (`npm pack <pkg>@29.7.0` → extract → copy `build/*.js`); post-restore the modules load as constructors (verified via `node -e require(...)`). This is an infrastructure artifact of the parallel-spawn pattern, NOT a code defect; the clean `64 passed` + both fails-on-revert proofs were captured before the corruption. Lesson: serialize jest runs against a shared anchor `node_modules`.

---

## 9. Invariants

| ID | Status |
|---|---|
| INV-1 (NEW) Client paid-detection mirrors ORCH-1075 server per type | PASS — resolvers cite server lines; T-10/11/12 pin parity. Register `I-OFFERING-PROACTIVE-STRIPE-BANNER-MIRRORS-SERVER` at CLOSE. |
| INV-2 Server fail-close canonical | PASS — migration/guards/`paidPublishGuards.ts` untouched; reactive catches intact (T-24). |
| INV-3 One owner per truth (readiness) | PASS — reused `brand.stripeStatus`; no new hook/query (D-2). |
| INV-4 Drafts never gated | PASS — gate is publish-only; Save-as-draft + autosave unaffected (T-22). |
| INV-5 `businessTodos.ts` untouched | PASS — not in diff. |
| INV-6 Android glass opaque fallback | PASS — reused the policy-compliant GlassCard variant. (On-device confirm = SC-Android.) |
| INV-7 `TripPreviewBrand` anon-tolerant | PASS — `stripeStatus?` optional; public route passes nothing. |

---

## 10. Regression surface (for the tester)

1. Event Step 7 render for paid-on-inactive (must be byte-identical) + free-only (ReadyCard).
2. Trip review with BOTH a reactive `publishError` AND `needsStripe` (both banners co-render).
3. Experience per-stop vs whole pricing → banner appears at the right total; free toggle hides it.
4. Trip/experience draft-save paths (must NEVER gate).
5. Edit-to-paid screens (`EditPublishedTripScreen`, experience live-edit) — no proactive banner; reactive catch still fires.

---

## 11. Discoveries for orchestrator

- **DISC-A.** SPEC §9 T-05's `0.005 → false` expectation is wrong (see §7). The resolver is correct/server-faithful; only the SPEC's note needs a fix. No code impact.
- **DISC-B.** mingla-business jest harness has no RN renderer; component criteria are necessarily source-characterization (repo-wide convention). If the program wants true render snapshots, that's a separate test-infra ORCH (`@testing-library/react-native` + jsdom/RN preset) — out of Stream B scope.
- **DISC-C.** Register `I-OFFERING-PROACTIVE-STRIPE-BANNER-MIRRORS-SERVER` (INV-1) in `INVARIANT_REGISTRY.md` at CLOSE (DRAFT → ACTIVE on PASS).
- **DISC-D (optional, SPEC §12).** A strict-grep gate asserting the event `StripeBlockedCard` is imported from `offering/` (not re-forked locally) would prevent a future re-fork. Not required for CLOSE; orchestrator's call.

---

## 12. Logical commits (per §11)

- `c5324d0b2` — (1/5) publishStripeReadiness resolvers + server-parity tests.
- `43d1a33eb` — (2/5) shared StripeBlockedCard primitive + byte-identical event Step-7 refactor.
- `480aa523b` — (3/5) trip create wizard banner + disabled Publish + toast.
- `b198b47a5` — (4/5) experience create wizard banner + disabled Publish + pre-check.
- `ca63f4427` — (5/5) this implementation report.

---

## 13. Deploy notes

Pure-JS client UI. **No migration, no edge function, no native module.** No `supabase db push`, no `supabase functions deploy`, no backend allowlist (COMMS-0002 N/A), no external-API docs (COMMS-0003 N/A). Rides the next mingla-business build / OTA per `project_ota_deferred_until_new_build`.
