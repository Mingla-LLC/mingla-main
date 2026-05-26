# Implementation Report: META-ORCH-0972 Sub-B Universal Creation + Hub Tabs

> Date: 2026-05-25
> Mode: Spec Execute
> Spec: `Mingla_Artifacts/specs/SPEC_META-ORCH-0972_BRAND_KIND_DECOMMISSION.md` §Sub-spec B
> Status: implemented, partially verified

## 1. Layman Summary

Sub-B replaces brand-type creation forks with one brand setup flow and lets every brand choose Event, Trip, or Experience as its first offering. Hub tabs now appear from real offering counts, empty hubs get a "Get started" chooser, venue claims are framed as an optional trust upgrade, and admin can review pending, verified, and rejected venue claims.

## 2. Request And Context

- **Request:** Execute META-ORCH-0972 Phase 4 Sub-B per locked implementor prompt.
- **Source:** `Mingla_Artifacts/prompts/IMPLEMENTOR_META-ORCH-0972_SUB_B.md`.
- **Baseline:** Sub-A closed PASS at `fee178634`.
- **Design/copy lock:** Phase 2 design + `COPY_INVENTORY` at `8311fa89b`; strings were copied verbatim where touched.
- **Comms:** COMMS-0002 ack-only with no backend touch; COMMS-0003/0004 read and factored.

## 3. Scope

- **In scope:** Brand creation flow, shared offering chooser, business hub data-driven tab shell, experience creator route shell, venue-claim UI framing, admin claims status tabs, Sub-B tests.
- **Out of scope:** DB schema changes, migrations, edge functions, PublicBrandPage, publicEventsService, ExperienceMiniCard, useUpcomingFeed, Sub-C/D strict-grep scripts.
- **Assumption:** Experience rows can use existing `events.event_type = "experience"` plus additive `theme.experience_meta` JSON until Sub-C formalizes public/RPC reads.

## 4. Files Read

| File | Why | Relevant finding |
|---|---|---|
| `IMPLEMENTOR_META-ORCH-0972_SUB_B.md` | Binding dispatch | Defines hard guards, file scope, required tests, and report output. |
| `SPEC_META-ORCH-0972_BRAND_KIND_DECOMMISSION.md` | Contract | Sub-B owns UI/runtime creation and hub/admin changes only. |
| `PHASE_2_DESIGN_META-ORCH-0972_USER_JOURNEYS.md` | Design lock | Confirms unified chooser, data-driven hub, venue opt-in framing, experience wizard. |
| `PHASE_2_DESIGN_META-ORCH-0972_COPY_INVENTORY.md` | Copy source | Provided exact strings used in BrandCreationFlow, OfferingChooser, hub, experience, venue, admin. |
| `QA_META-ORCH-0972_SUB_A_REPORT.md` | Baseline | Confirms Sub-A pass before Sub-B work. |

## 5. Blast Radius

- **Business app:** Brand switcher/create flow, home empty action, hub chrome/routes, trips/experiences empty states, universal creator routing, venue claim banner/edit affordance, experience create route.
- **Admin web:** Venue claims service and page now support pending/verified/rejected tabs.
- **Deleted files:** `PersonaPickerCards.tsx`, `PersonaForkSheet.tsx`, `TripBrandWizard.tsx`.
- **Database/edge:** No migrations, no Supabase function edits, no edge deploys.
- **Public buyer web:** Not touched; reserved for Sub-C.

## 6. Old To New Receipts

### Brand creation and offering choice

- **Before:** Brand creation forked by persona/type and routed through separate persona cards/trip-brand wizard.
- **After:** `BrandCreationFlow` collects identity, optional address, optional cover, then shows `OfferingChooser` with Event, Trip, Experience.
- **Why:** Any brand can author any offering.

### Home and hub

- **Before:** Empty-home action and hub surfaces carried brand-kind assumptions or dead-end copy.
- **After:** Home empty state renders `OfferingChooser`; hub tabs derive from event/trip/experience counts and show only populated buckets, with a single `Get started` tab when all counts are zero.
- **Why:** Hub reflects actual offerings, not brand kind.

### Experience creation

- **Before:** Experience creation was only reachable from venue/category-specific generation surfaces.
- **After:** `/experience/create` mounts `ExperienceCreatorWizard`; venue is always asked, prefilled from brand address when available, and can optionally be saved back as brand address.
- **Why:** Experiences are a universal offering type.

### Venue claims

- **Before:** Venue claim banners and edit flow were tied to physical kind framing.
- **After:** Banner logic is claim-status driven; Brand Edit always has optional address and a "Claim a venue" affordance when no claim/place exists.
- **Why:** Venue claim is now an opt-in trust signal, not an authoring gate.

### Admin claims

- **Before:** Admin claims list focused on pending physical claims.
- **After:** Admin claims dashboard has Pending review, Verified, and Rejected tabs with locked empty states.
- **Why:** Review workflow now needs status history, not only a pending queue.

## 7. Implementation Details

- Added `OfferingChooser`, `BrandCreationFlow`, `ExperienceCreatorWizard`, `/experience/create`, `/hub/getstarted`, `useBrandOfferingCounts`, `useHubTabs`, and `useExperienceVenueDefault`.
- Rewrote `BrandSwitcherSheet` create mode to use the unified brand flow.
- Updated `HubSubNav` and hub layout to support visible tabs, count labels, loading shimmer, sticky last-tab persistence, and stale-route fallback.
- Updated `UniversalCreatorSheet` so Experience routes to `/experience/create`.
- Preserved `Brand.kind` in TypeScript with a `@deprecated` marker; no DB column drop attempted.
- Updated `VenueClaimStatusRow` and its test to remove kind from banner decisions.

## 8. Spec / Goal Traceability

| Criterion / goal | Implemented | Verification | Status |
|---|---|---|---|
| SC-B-1 unified brand creation | Yes | New `BrandCreationFlow` + regression source contract | Pass |
| SC-B-2 optional/null address | Yes | Address skip dispatches `address: null`; test locks this | Pass |
| SC-B-5 offering routes | Yes | Event/trip/experience route contract test | Pass |
| SC-B-6 sticky valid hub tab | Yes | `pickHubInitialTab` regression | Pass |
| SC-B-13 data-driven hub tabs | Yes | `deriveHubVisibleTabs` regression | Pass |
| Venue claim kind gate removed | Yes | Existing venue claim test updated | Pass |
| Admin claims tabs | Yes | Admin production build passed | Pass |
| Zero DB/edge/Sub-C expansion | Yes | Git status and hard-guard grep | Pass |

## 9. Invariant Verification

| Invariant / guard | Preserved | Evidence |
|---|---|---|
| Zero DB / zero migrations | Yes | No `supabase/` paths in status. |
| Zero edge functions | Yes | No `supabase/functions/` paths in status. |
| No Sub-C/D file expansion | Yes | No `PublicBrandPage`, `publicEventsService`, `ExperienceMiniCard`, `useUpcomingFeed`, or `meta-orch-0972` strict-grep files touched. |
| Preserve `Brand.kind` TS field | Yes | Field retained with `@deprecated META-ORCH-0972` marker. |
| Copy inventory is binding | Yes | Touched user-visible copy copied from inventory/design. |
| COMMS-0002 ack-only | Yes | No backend files touched in Sub-B. |

## 10. Parity Check

- **Business iOS:** Shared React Native code updated; simulator live-fire not run by implementor.
- **Business Android:** Shared React Native code updated; emulator live-fire not run by implementor.
- **Business web preview:** Shared Expo web code updated; local web preview not run by implementor.
- **Admin web:** Vite production build passed.
- **Public/buyer web:** Not touched in Sub-B.
- **Consumer app:** Not touched.

## 11. Cache And Persisted State Safety

- **Query keys changed:** Added `brandKeys.offeringCounts(brandId)`.
- **Invalidations added:** None.
- **AsyncStorage:** Added `@mingla/hub/lastTab` for hub last-tab preference only.
- **Zustand:** Existing current-brand store still owns active brand pointer.
- **Data shape:** `Brand.kind` TypeScript field remains transitional; database row shape unchanged.

## 12. Verification

| Check | Command / method | Result | Notes |
|---|---|---|---|
| Mandatory Sub-B Jest | `npx jest --runInBand __tests__/hooks/useHubVisibleTabs.test.tsx __tests__/components/BrandCreationFlow.test.tsx` | PASS | 2 suites, 7 tests. |
| Venue claim regression | `npx jest --runInBand src/services/__tests__/venueClaimService.test.ts` | PASS | Updated old kind-gated test to new status-only contract. |
| Hub/home adjacent tests | `npx jest --runInBand --runTestsByPath app/(tabs)/hub/__tests__/hubExperiences.contract.test.ts`; `npx jest --runInBand src/utils/__tests__/homeNextAction.test.ts src/services/__tests__/venueClaimService.test.ts` | PASS | Existing relevant tests still green. |
| Admin build | `npm run build` from `mingla-admin/` | PASS | Vite built with existing chunk-size/dynamic CSS warnings. |
| Full business typecheck | `npx tsc --noEmit` | FAIL | Existing unrelated repo-wide errors remain. No Sub-B-touched file errors found with filtered tsc output. |
| Hard-guard status scan | `git status --short \| rg '(^.. supabase/|^.. \.github/scripts/strict-grep/meta-orch-0972-|PublicBrandPage|publicEventsService|ExperienceMiniCard|useUpcomingFeed|EventMiniCard|TripMiniCard)'` | PASS | Empty output. |
| Touched-file kind grep | `rg -n "brand\\.kind\|currentBrand\\.kind" <Sub-B touched files>` | PASS | Empty output. |
| Deleted persona files | `find mingla-business/src/components/brand (...)` and matching tests find | PASS | Empty output. |
| `useHubVisibleTabs` fails-on-revert | Verified after implementation commit | FAIL as expected at `6633be066` | Temporary revert made the empty-count tab contract fail. |
| `BrandCreationFlow` fails-on-revert | Verified after implementation commit | FAIL as expected at `6633be066` | Temporary revert changed the Experience route contract. |

## 13. Regression Surface

1. Mandatory tests were added at `mingla-business/__tests__/hooks/useHubVisibleTabs.test.tsx` and `mingla-business/__tests__/components/BrandCreationFlow.test.tsx`.
2. Existing venue-claim test now protects the status-only banner contract.
3. The hub count hook uses direct table count queries, so Sub-C can swap in an RPC without changing the UI tab contract.

## 14. Risks, Limitations, Transition Items

| Item | Risk / temporary state | Exit condition |
|---|---|---|
| Full business typecheck red | Existing repo-wide errors block a clean global tsc signal | Separate cleanup or orchestrator-owned gate decision. |
| No live-fire sim/web preview by implementor | UI touched but not exercised on devices in this pass | Claude tester targeted Phase 0.A live-fire gate. |
| Experience creator writes additive JSON only | Public page/RPC readers are not rebuilt in Sub-B | Sub-C public/RPC rebuild. |
| Direct count queries | Three count calls per brand for hub tab visibility | Optional Sub-C RPC replacement if desired. |

## 15. Discoveries For Orchestrator

- No new cross-ORCH discovery requiring a new COMMS entry.
- `useBrandOfferingCounts` intentionally uses direct `events` count queries instead of `pg_brand_offering_counts`. This keeps Sub-B decoupled from Sub-C because the RPC is a Sub-C deliverable; the UI contract can later swap to the RPC behind the same hook/query key.
- The old `venueClaimService.test.ts` still encoded the removed brand-kind gate; it was updated in scope because it would otherwise keep the wrong runtime contract alive.

## 16. Deploy Notes

- **Migrations:** None. Do not run `supabase db push` for Sub-B.
- **Edge functions:** None edited or deployed.
- **Mobile/native:** JS-only shared business app changes; no native module changes.
- **Admin web:** Build passed; deploy picks up Venue Claims tabs.
- **Downstream:** Orchestrator REVIEW, then Claude mingla-tester TARGETED with iOS simulator, Android emulator, and web preview live-fire per Phase 0.A.

## Suggested Commit Message

```text
META-ORCH-0972 Sub-B universal creation and hub tabs

Replace persona brand creation with a universal brand setup flow, add
offering-based hub visibility, route experiences through the new creator, and
reframe venue claims as optional trust signals.
```

## Ready-To-Test Checklist

1. Open the business app with an empty brand and confirm Home and Hub show the offering chooser.
2. Create a brand, skip address, skip cover, and choose Event/Trip/Experience; each should route to the matching creator.
3. Create or seed offerings and confirm Hub tabs show only buckets with counts.
4. Open Admin Venue Claims and switch Pending review / Verified / Rejected tabs.
