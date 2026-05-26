# Implementation Report: META-ORCH-0972 Sub-A Backend Gates + Early Returns

> Date: 2026-05-25
> Mode: Spec Execute
> Spec: `Mingla_Artifacts/specs/SPEC_META-ORCH-0972_BRAND_KIND_DECOMMISSION.md` §Sub-spec A
> Status: implemented, partially verified

## 1. Layman Summary

Sub-A removes the old "only certain brand kinds can create certain offerings" backend and product-code blockers. Event drafts, trip drafts, trip route entry, and the existing AI experience parser paths now move toward universal authoring without changing the database schema or deploying edge functions.

## 2. Request And Context

- **Request:** Execute META-ORCH-0972 Phase 4 Sub-A per locked SPEC.
- **Source:** User-dispatched implementor prompt with SPEC, REVIEW, and Phase 2 design lock at `8311fa89b`.
- **Affected surfaces:** `mingla-business` service/routes/home/hub utility code, existing AI parser edge-function source, ORCH-0863 strict-grep allowlist, regression tests.
- **Related issues/artifacts:** `REVIEW_META-ORCH-0972_SPEC.md` P2-1 + P4 Phase 0 notes; COMMS-0002/0003/0004 acknowledged.

## 3. Scope

- **In scope:** Sub-A gate deletion, product-code early-return deletion, CreateBrandInput kind removal, old test deletions, SC-A-7 regression test, ORCH_0972 backend allowlist.
- **Out of scope:** DB schema changes, migrations, migration apply, edge-function deploy, BrandCreationFlow, public brand page rewrite, Sub-C/D migrations and new strict-grep gates.
- **Assumptions:** Remaining `brand.kind` reads in public page, venue banner, hub trips, and public service tests belong to later Sub-B/C work because the dispatch explicitly forbids touching those lanes in Sub-A.

## 4. Files Read

| File | Why | Relevant finding |
|---|---|---|
| `SPEC_META-ORCH-0972_BRAND_KIND_DECOMMISSION.md` §A.1-A.6 | Contract | Defines Sub-A file set, 5 test deletions, SC-A-7 regression. |
| `REVIEW_META-ORCH-0972_SPEC.md` | Review constraints | P2-1 says events use `description`, not `bio`; P4 lists Phase 0 schema checks. |
| Phase 2 design docs at `8311fa89b` | Design lock | Confirms universal authoring, no DB change in Sub-A, parser tool-type category inference. |
| Target product/service/edge files | Read-before-write | Confirmed current kind/claim gates and obsolete early returns. |

## 5. Blast Radius

- **Direct changes:** Removed `brandAuthoringGate.ts`; removed event/trip draft gate calls; deleted trip-create and trip-edit brand-kind returns; updated home rung behavior; regated existing AI parser surfaces by venue category only.
- **Cascade changes:** Removed create-brand `kind` input plumbing and obsolete persona/trip-kind tests; updated nearby source-contract tests.
- **Parity surfaces:** Shared business app code covers iOS/Android/web preview. Edge source is shared once deployed in Sub-D.
- **Cache impact:** No query keys or invalidations changed.
- **State boundaries:** React Query/Zustand ownership unchanged; optimistic brand create keeps a transitional `kind: "popup"` only because the current `Brand` type still requires it until later sub-specs.
- **Auth/RLS/security:** Ownership checks remain in edge functions and tool executor. No RLS or schema mutation.
- **Deploy path:** No DB push. No edge deploy in Sub-A; source deploy deferred to Sub-D.

## 6. Old To New Receipts

### `eventDrafts.ts`, `tripsService.ts`, `brandAuthoringGate.ts`

- **Before:** Draft creation called a gate that rejected unverified physical brands.
- **After:** Gate file deleted; event/trip draft creation carries the invariant comment and continues to normal insert flow.
- **Why:** I-BRAND-UNIVERSAL-AUTHORING.

### `trip/create.tsx`, `trip/[id]/edit.tsx`

- **Before:** `/trip/create` and client-ID migration returned early unless the current brand was `trip_planner`.
- **After:** Every current brand can enter the trip draft flow and migrate client IDs.
- **Why:** T-03/T-04 universal trip authoring.

### `homeNextAction.ts`, `home.tsx`

- **Before:** Stripe inactive always won; zero-offering CTA branched by kind; physical-no-address rung existed.
- **After:** Stripe rung fires only for paid drafts; zero-offering state is universal chooser copy; address rung removed.
- **Why:** Q1 + Sub-A T-07.

### AI parser and agent tool files

- **Before:** Parser endpoints selected `kind`/`claim_status` and rejected non-physical or unverified brands.
- **After:** Existing ownership checks remain; `kind`/`claim_status` selects and gates are removed; venue-category checks remain for the two legacy parser entry points; tool args carry `temporaryCategory`.
- **Why:** Universal parser access with no brand-kind read.

### Brand create/mapping/patch

- **Before:** `CreateBrandInput` and create/patch mappers accepted/wrote brand kind.
- **After:** Create input no longer accepts kind; create and dirty-patch no longer write kind.
- **Why:** Unified brand creation contract preparation.

### Tests and strict-grep

- **Before:** Five obsolete tests encoded persona/trip-kind contracts; ORCH-0863 C7 would block touched backend files.
- **After:** Five tests deleted; SC-A-7 regression added; `ORCH_0972_BACKEND_ALLOWLIST` added with the three touched edge paths.
- **Why:** Regression coverage moves to universal authoring; COMMS-0002 satisfied.

## 7. Implementation Details

- **Architecture decisions:** Subtract gates without introducing new DB, edge deploy, or new strict-grep gates.
- **Data flow:** Draft creation still resolves auth, default currency, and inserts events/trips through existing service paths.
- **Mutation/query behavior:** No query-key changes; create-brand input removes `kind`.
- **State handling:** `homeNextAction` now treats paid local draft tickets as the only Stripe upsell trigger.
- **Error handling:** Existing Supabase errors still throw; parser ownership and venue-category errors remain.
- **Copy/accessibility:** Updated stale `/trip/create` source-contract copy and trip route gate test. No new UI components.
- **Analytics/notifications/realtime:** No changes.

## 8. Spec / Goal Traceability

| Criterion / goal | Implemented | Verification | Status |
|---|---|---|---|
| SC-A-1 type/build check | Code updated; full typecheck attempted | `npx tsc --noEmit --pretty false` fails on pre-existing unrelated repo errors; Sub-A-exposed `home.tsx` rung-4 type error fixed | Partial |
| SC-A-2 no Sub-A brand-kind reads | Sub-A files cleaned | Broad grep still finds later Sub-B/C files that were hard-guarded out of scope | Partial |
| SC-A-3 edge files have zero `brand.kind` | Yes | `rg -n "brand\\.kind" ...` returned no hits | Pass |
| SC-A-4 5 obsolete tests deleted | Yes | `find ... personaFork/TripBrandWizard/tripPlannerKind` returned empty | Pass |
| SC-A-5 existing tests | Attempted | Full `npx jest --runInBand` ran 239 suites: 201 passed, 38 failed on pre-existing unrelated stale tests/tooling | Partial |
| SC-A-6 typecheck | Attempted | Full typecheck blocked by unrelated repo-wide errors, including missing Playwright/native package types and existing DraftEvent fixture drift | Partial |
| SC-A-7 regression | Yes | New test passes; gate-revert failure verified at `18d33fcd9` | Pass |

## 9. Invariant Verification

| Invariant | Relevant | Preserved | Notes |
|---|---|---|---|
| I-BRAND-UNIVERSAL-AUTHORING | Yes | Introduced in code comments | No authoring kind gate remains in Sub-A touched services/edge paths. |
| I-COMMS-LEDGER | Yes | Acknowledged | COMMS-0002/0003/0004 factored; anchor ledger was already dirty, so ack was local-only. |
| I-ARI-USER-JWT-ONLY | Yes | Yes | Parser endpoints still use caller JWT and ownership check. |
| I-TRIP-SPOTS-MIRRORS-CAPACITY-GATE | Indirect | Yes | No trip capacity SQL/RPC touched. |

## 10. Parity Check

- **Mobile:** Shared business route/service code affects iOS and Android.
- **Business app:** Event/trip draft and hub parser entry logic updated.
- **Admin:** Not touched.
- **Public/web:** Public page files intentionally not touched in Sub-A.
- **Solo/collab:** No collaboration-state changes.
- **Gaps:** Sub-B/C must remove remaining public page, venue banner, hub trips, and public-service `brand.kind` reads.

## 11. Cache And Persisted State Safety

- **Query keys changed:** None.
- **Invalidations added:** None.
- **Data shape changes:** Type-level create input no longer accepts `kind`; DB row shape unchanged.
- **AsyncStorage/Zustand impact:** None.
- **Cold start behavior:** No persisted migration.

## 12. Verification

| Check | Command / method | Result | Notes |
|---|---|---|---|
| Targeted Jest | `npx jest mingla-business/__tests__/services/eventDrafts.universalAuthoring.test.ts mingla-business/src/utils/__tests__/homeNextAction.test.ts mingla-business/src/utils/__tests__/canGenerateExperiencesFromMenu.test.ts mingla-business/src/utils/__tests__/canGenerateExperiencesFromActivities.test.ts mingla-business/app/trip/__tests__/trip-create-publish.test.ts --runInBand` from `mingla-business/` | PASS | 5 suites, 30 tests. |
| SC-A-7 fails-on-revert | Temporarily reversed `eventDrafts.ts` + `brandAuthoringGate.ts` diff from `18d33fcd9`, ran SC-A-7 test, then reapplied diff | FAIL as expected | Rejected with `PhysicalVenueNotVerifiedError`. |
| Deno check | `/Users/sethogieva/.deno/bin/deno check supabase/functions/parse-restaurant-menu/index.ts supabase/functions/parse-play-activities/index.ts supabase/functions/_shared/agentTools.ts` | PASS | Edge source only; no deploy. |
| Deno tests | `/Users/sethogieva/.deno/bin/deno test supabase/functions/_shared/geminiMenuParser.test.ts supabase/functions/_shared/geminiActivitiesParser.test.ts` | PASS | 7 tests. |
| ORCH-0863 gate | `node .github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` | PASS | C7 satisfied by `ORCH_0972_BACKEND_ALLOWLIST`. |
| Deleted-tests find | `find mingla-business/__tests__ mingla-business/src/components/brand/__tests__ mingla-business/src/services/__tests__ ...` | PASS | Empty output. |
| Edge brand-kind grep | `rg -n "brand\\.kind" supabase/functions/...` | PASS | No hits. |
| Full Jest | `npx jest --runInBand` | FAIL | 201 passed / 38 failed; failures are stale/unrelated suites, not Sub-A-specific. |
| Full typecheck | `npx tsc --noEmit --pretty false` | FAIL | Pre-existing repo-wide errors outside Sub-A remain. |
| Phase 0 events field verification | Migration/source grep | PASS | Baseline `events` table has `description`; ORCH-0963 RPC already selects `e.description`; no `events.bio`/`e.bio` found in relevant RPC path. |

## 13. Regression Surface

1. Brand creation surfaces still exist until Sub-B; they now omit `kind` when calling `useCreateBrand`.
2. AI parser UI still uses venue category as a temporary selector until Sub-B/C introduce the final experience creator.
3. Public brand page and venue claim surfaces still read `brand.kind`; reserved for later sub-specs.

## 14. Risks, Limitations, Transition Items

| Item | Risk / temporary state | Exit condition | Location |
|---|---|---|---|
| Broad SC-A-2 grep not globally zero | Later-phase `brand.kind` reads remain because Sub-A hard guard forbids touching them | Sub-B/C implementation | `PublicBrandPage`, `VenueClaimStatusBanner`, `hub/trips`, `publicEventsService` tests |
| Full test/type gates red | Repo contains existing stale tests/tooling/type errors | Separate cleanup or later ORCH fixes | See Verification table |
| Edge source not deployed | Runtime behavior unchanged until deploy | Sub-D deploy after source+gate work closes | Supabase functions |

## 15. Discoveries For Orchestrator

- No new cross-ORCH discovery requiring a new COMMS entry.
- The spec's broad SC-A-2 wording conflicts with the Sub-A hard guard; orchestrator review should treat remaining later-phase `brand.kind` reads as known Sub-B/C work, not Sub-A drift.

## 16. Deploy Notes

- **Migrations:** None. No DB schema change. No `supabase db push`.
- **Edge functions:** Source edited only; do not deploy in Sub-A. Deploy deferred to Sub-D.
- **Mobile OTA/native:** JS-only business app changes; no native module change.
- **Business/admin web:** Business web preview picks up JS changes when deployed; admin untouched.
- **Env vars/secrets:** None.

## Suggested Commit Message

```text
META-ORCH-0972 Sub-A universal authoring gates

Remove backend authoring gates and product-code early returns for Sub-A, add
the SC-A-7 regression, and allowlist the touched edge source files for
ORCH-0863 C7.

[TEST-MOD-APPROVED META-ORCH-0972 Sub-A]
```

## Ready-To-Test Checklist

1. Run the targeted Jest command in §12; expect 5 suites / 30 tests to pass.
2. Run the Deno check and Deno test commands in §12; expect all green.
3. Run ORCH-0863 strict-grep; expect C7 green with `ORCH_0972_BACKEND_ALLOWLIST`.
4. Do not deploy Supabase functions until Sub-D.
