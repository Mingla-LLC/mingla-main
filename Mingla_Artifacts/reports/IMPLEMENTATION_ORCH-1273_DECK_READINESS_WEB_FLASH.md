# IMPLEMENTATION — ORCH-1273 · Venue deck-readiness "Recommend me" step flashes/closes on web create (venue stuck at `processing`)

- **Phase:** IMPLEMENT (client-nav-only fix; web-facing)
- **Date:** 2026-07-03
- **Worktree:** `~/Desktop/mingla-orchs/orch-1273-[deck-readiness-web-flash]/` on branch `orch-1273-deck-readiness-web-flash` (rebased on `origin/main` @ `9dc99ea46`).
- **Binding contract:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-1273_DECK_READINESS_WEB_FLASH.md` §G / §F-9.
- **Status:** implemented and verified (source + gates + jest + web export; authed business-web runtime unreachable per `feedback_biz_web_authed_runtime_unreachable_cap_claims`, so the runtime landing itself is `implemented, unverified` — see Verification matrix).

---

## 1. Summary

When you finished creating a brand-new venue on the Business **web** app and tapped "Submit for review," the "Get recommended on Mingla" (AI / deck-readiness) screen flashed for a split second and vanished, leaving the venue half-built and stuck at `business_authoring_status='processing'` forever. Root cause (proven in the investigation): that screen was rendered from throw-away React state (`createdVenue`) inside the create wizard, behind volatile auth/hydration/brand gates — any one-frame re-resolution of `/venue/create` on web tore it down and the blanked draft made it unrecoverable in-session.

The fix makes the create flow land on the **durable** `/venue/deck-readiness` route on submit-success — the exact same server-state-reloading route the Hub "Edit listing" recovery path already uses. That route addresses the screen by URL params and reloads everything from the server, so it is immune to the auth/hydration/chunk reflows that caused the flash. The claim path's intentional defer is untouched. Ships web-only via Vercel; reaches native on the next native build (business OTA prohibited — COMMS-0052/0063).

---

## 2. SPEC success-criteria coverage

The binding artifact is an investigation (§F-9 recommended fix), not a numbered SPEC; the acceptance criteria are derived from the dispatch. Commit hash `c6e94b2c2` (recorded below at commit time; = the ORCH-1273 implement commit).

| SC | Criterion | Status | Evidence |
|----|-----------|--------|----------|
| SC-1 | Create tier-1 success navigates via `router.replace` to the durable `/venue/deck-readiness` route (never the ephemeral inline mount) | ✓ | `VenueCreatorWizard.tsx` handleSubmit create branch; jest `venueCreateDurableDeckReadiness.orch1273` test 1 |
| SC-2 | The nav uses the route's REAL param contract (`brand_id`,`place_pool_id`,`venue_id`,`focus`) via the canonical `routeForDeckReadinessFix({...fix:"review_pipeline"})` builder — exact parity with `VenueListingContent.handleEdit` recovery | ✓ | `routeForDeckReadinessFix` → `/venue/deck-readiness?brand_id&focus=review&fix=review_pipeline&place_pool_id&venue_id`; jest test 1 asserts the param set + `fix:"review_pipeline"` |
| SC-3 | The ephemeral inline `<VenueDeckReadinessSetup>` mount + `createdVenue` transient state are REMOVED (subtract-before-add) | ✓ | wizard diff; jest tests 2+3; strict-grep gate (b)+(c) |
| SC-4 | Claim path's intentional defer is UNTOUCHED | ✓ | claim branch (`onDone(...)` return before create leg) unchanged; wizard diff shows no claim-branch edits |
| SC-5 | No cron / auto-transition out of `processing` added | ✓ | zero migration/edge changes (diff = 5 files, all client/CI/docs) |
| SC-6 | Landing target reloads brand+venue+pipeline state server-side (durable) | ✓ | `app/venue/deck-readiness.tsx` uses `useVenueListing(venueId)` (`fetchVenueListing` server read) + `useBrandPlaceAuthoringContext(brandId,placePoolId,venueId)`; jest test 4 |
| SC-7 | Stuck venue remains recoverable via Hub "Edit listing" | ✓ | recovery path (`VenueListingContent.tsx:192`) UNTOUCHED; now shares the same route builder as create |
| SC-8 | CI regression guard (strict-grep + jest) with fails-on-revert | ✓ | gate `--self-test` 5/5 + real PASS; jest 4/4; fails-on-revert proven by true line deletion |
| SC-9 | Web build succeeds | ✓ | `expo export -p web --clear` exit 0 |

---

## 3. Files changed

| File | Δ | What |
|------|---|------|
| `mingla-business/src/components/venue/VenueCreatorWizard.tsx` | ~ +18 / −34 net (comment-heavy) | Create success → `router.replace(routeForDeckReadinessFix(...))`; removed `createdVenue` state, inline `<VenueDeckReadinessSetup>` mount, and its now-unused `VenueDeckReadinessSetup` + `VenueCategory` imports; added `routeForDeckReadinessFix` import; `router` added to `handleSubmit` deps; header doc updated |
| `.github/scripts/strict-grep/i-proposed-1273-create-lands-on-durable-deck-readiness.mjs` | +185 (new) | Gate for `I-PROPOSED-1273-CREATE-LANDS-ON-DURABLE-DECK-READINESS` (`--self-test` 5/5) |
| `.github/workflows/strict-grep-mingla-business.yml` | +13 | New job `orch-1273-create-lands-on-durable-deck-readiness` (self-test + run) |
| `mingla-business/src/components/venue/__tests__/venueCreateDurableDeckReadiness.orch1273.test.ts` | +185 (new) | Happy-path AST regression test (4 assertions) |
| `Mingla_Artifacts/INVARIANT_REGISTRY.md` | +13 | DRAFT entry + explicit ORCH-ID-collision note |

No files touched outside the create-branch nav seam + its CI guard. Claim path, durable route, recovery CTA, migrations, edge functions: untouched.

---

## 4. Data-model changes applied

None. Client-navigation-only fix. No tables, columns, constraints, indexes, RLS, or migrations.

## 5. Edge functions touched

None. (`run-business-place-authoring-pipeline` unchanged; the `'processing'` write + its operator-driven exits are unchanged by design — no auto-transition added.)

---

## 6. Regression tests added

- **Happy-path (implementor):** `mingla-business/src/components/venue/__tests__/venueCreateDurableDeckReadiness.orch1273.test.ts` — 4 assertions (AST-parsed via `@babel/parser`, runs under the default ts-jest/node config; no RTL needed): (1) `router.replace(routeForDeckReadinessFix({...}))` exists with the `brandId/placePoolId/venueId/fix:"review_pipeline"` contract; (2) no inline `<VenueDeckReadinessSetup>` JSX; (3) no `createdVenue`/`setCreatedVenue` state; (4) the durable route reloads via `useVenueListing` + `useBrandPlaceAuthoringContext` from URL params. **4/4 PASS.**
- **CI gate:** `.github/scripts/strict-grep/i-proposed-1273-create-lands-on-durable-deck-readiness.mjs` — `--self-test` 5/5 PASS + real run PASS.
- **fails-on-revert verified at `c6e94b2c2`** by TRUE LINE DELETION of the `router.replace(routeForDeckReadinessFix({...}))` seam (8 lines): jest core assertion `expect(durableNavCall).not.toBeNull()` FAILED (Received: null) AND gate exited 1 ("create-success navigation seam missing"). Fix restored (file sha `8a214202748f9bef19295a613808460b627c1bfc` before/after identical) → jest 4/4 PASS, gate exit 0.
- **Append-only:** no existing test modified or deleted. (Pre-existing stale `VenueCreatorWizard.ve2.test.ts` left untouched — see Discoveries.)

---

## 7. Old → New receipt

### `mingla-business/src/components/venue/VenueCreatorWizard.tsx`
- **What it did before:** on create-path tier-1 success, `setCreatedVenue({...})` armed throw-away React state + `reset()` the draft, then a conditional `if (createdVenue !== null && user?.id && currentBrand !== null) return <VenueDeckReadinessSetup .../>` rendered the deck-readiness screen INLINE from that state, nested under create.tsx's `!isAuthReady || user===null || !hydrated` gate. Any one-frame subtree re-resolution on web unmounted it and lost the venue → stuck at `processing`.
- **What it does now:** on create-path tier-1 success, `reset()` the draft (unchanged, per-brand) then `router.replace(routeForDeckReadinessFix({ brandId, placePoolId: tier1.place_pool_id, venueId, fix: "review_pipeline" }))` and `return`. The ephemeral state + inline mount + their now-unused imports (`VenueDeckReadinessSetup`, `VenueCategory`) are deleted. The user lands on the durable `/venue/deck-readiness` route which reloads all state from the server and persists.
- **Why:** §F-9 — the create leg must be durable/param-addressed, not ephemeral. Neutralizes all three F-2 unmount candidates (auth-gate flicker / chunk reload / re-render cascade) at once by not depending on `/venue/create` transient state.
- **Lines changed:** ~52 (incl. doc comments); net code shrinks (subtract-before-add).

---

## 8. Cross-surface impact

| Surface | Affected | Notes |
|---------|----------|-------|
| Buyer/anonymous Web | No | anon routes untouched |
| Business **Web** (Vercel) | **YES** | the fix — create-venue post-submit now lands durably on deck-readiness (parity automatic; shared RN code) |
| Business iOS | Deferred | rides next native build; business native still pre-1255 (deployment skew F-7); OTA prohibited (COMMS-0052/0063) |
| Business Android | Deferred | same as iOS |
| Consumer iOS/Android | No | consumer app not touched |
| Admin Web | No | not touched |

Parity is AUTOMATIC (single RN codebase). No manual per-surface work.

---

## 9. Smoke result

- **Static/AST:** jest 4/4 PASS; strict-grep gate self-test 5/5 + real PASS.
- **Related gates (no regression):** `orch-1218-venue-authoring-no-vendor-leak`, `orch-1255-{no-hidden-brand,venue-approval-per-venue-row,pipeline-no-brand-onconflict,public-venue-anon-safe}`, `orch-1263-{claim-front-load-and-overnight,claim-stage-only-preapprove}` — all PASS.
- **Web build:** `npx expo export -p web --output-dir web-build --clear` → `EXPO_EXPORT_EXIT=0`; `deck-readiness` route + create route both compiled. (build artifact deleted, not committed.)
- **tsc:** `npx tsc --noEmit` — 0 errors mention `VenueCreatorWizard.tsx` / `deckReadinessRoutes.ts`. All 68 non-`packages/` errors + all `packages/` errors are pre-existing baseline (test-dep type resolution: `@testing-library/react-native`, `react-dom/server`; unrelated `any`s) → **zero-new vs origin/main**.
- **Runtime (authed business web):** UNVERIFIED — authed business-web runtime is unreachable in this environment (`feedback_biz_web_authed_runtime_unreachable_cap_claims`). The fix is trigger-agnostic by construction; the tester should drive a live create on Vercel and confirm the deck-readiness screen persists (no flash) and the venue advances past `processing` after running AI + confirm.

---

## 10. Known issues / deferred

- **create.tsx `phase="success"` create sub-branch is now dead-for-create** (only the CLAIM path reaches it). It renders inside a shared `isClaimSuccess` ternary that is STILL LIVE for claim, so I did NOT dissect it (scope guard: "CREATE branch only; do not touch claim" + avoid claim-render risk). Harmless unreachable code. Recommend a follow-up cleanup ORCH to remove the create sub-branch + the now-always-null `coverWarning` plumbing from create.tsx. (Discovery below.)
- **No proactive "finish getting recommended" to-do** for venues at `processing` (investigation §G optional hardening (a)). Not in this scope; register separately. Recovery remains via Hub "Edit listing".
- **ORCH-1268** ("deck-readiness screen has no exit") pre-flagged in memory — reconcile separately.
- **F-8** (claim staging onto a live seeded place's status/inputs) — separate ticket per the investigation.
- Business native rides the next native build (no `eas update`).

---

## 11. Operator action required

- **No migration `db push`.** None written.
- **No edge deploy.** None written.
- **Ship:** web-only via **Vercel** (`[deploy]` commit tag) after merge — orchestrator/operator-owned. Business native reaches this on the next native build.
- **Cleanup SQL for the 2 stuck test rows** (investigation §H) is orchestrator/operator-owned (read-only-verified in the investigation) — NOT run here.

---

## 12. Discoveries for Orchestrator

1. **⚠️ ORCH-ID COLLISION.** "ORCH-1273" is ALSO the merged admin Identity console (`cf0cff156`, `i-1273-identity-admin-read.mjs`, `I-PROPOSED-1273-IDENTITY-ADMIN-READ`, registry §"DRAFT — ORCH-1273 (admin Identity console)"). This deck-readiness ORCH is a SECOND, later dispatch on the same number — an INTAKE ID-scan miss. I kept the dispatched ID (investigation is committed as ORCH-1273) but used a DISTINCT gate filename/job/invariant suffix (`…-CREATE-LANDS-ON-DURABLE-DECK-READINESS`) so nothing overlaps. **Recommend the orchestrator renumber one of the two at CLOSE** and reconcile the registry/World Map.
2. **Pre-existing stale test.** `mingla-business/src/components/venue/__tests__/VenueCreatorWizard.ve2.test.ts` asserts `CoverPickerSheet`/`syncHeroMedia`/`runTier2Pipeline`/`initialTier2`/`focus === "cover"` — tokens that left the wizard when META-ORCH-1255(R2) split `VenueDeckReadinessSetup` into its own module. It fails identically on origin/main (verified: all those tokens are absent in `origin/main:VenueCreatorWizard.tsx`); NOT caused by this ORCH. Left untouched (append-only). Recommend a `[TEST-MOD-APPROVED]` follow-up to retarget or retire it.
3. **create.tsx dead create-success sub-branch** (see §10) — small follow-up cleanup ORCH.
4. The business jest suite is not a blocking CI job (COMMS-0056) — the strict-grep gate is the enforcing CI surface for this invariant; the jest test is the append-only regression proof.
