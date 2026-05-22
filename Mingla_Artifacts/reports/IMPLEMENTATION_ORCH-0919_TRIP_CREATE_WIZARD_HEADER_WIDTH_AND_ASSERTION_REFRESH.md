# Implementation Report: Trip Create Wizard Header, Width, And Assertion Refresh (ORCH-0919)

> Date: 2026-05-22
> Mode: Diagnose and Fix
> Spec: User-directed ORCH-0919 prompt
> Status: implemented, partially verified

## 1. Layman Summary

The trip creation wizard no longer repeats the same step title block inside the scroll body. The active step title and subtitle now live in the mobile header with the existing progress tracker, and steps 2-7 use the wizard body's width instead of adding their own nested side padding. The stale publish contract test now reflects the current 7-step wizard, including Step 5 policy, Step 6 intake, and Step 7 publish wiring.

## 2. Request And Context

- **Request:** Refresh the stale trip create publish assertion and fix wizard layout issues shown in the operator screenshots.
- **Source:** User-dispatched `$implementor` prompt for ORCH-0919.
- **Affected surfaces:** `mingla-business` trip create/edit wizard on mobile and narrow web; shared trip preview padding when explicitly overridden by wizard review.
- **Related issues/artifacts:** Screenshot set from 2026-05-22 around 5:29-5:33 AM; ORCH-0880 7-step wizard shape.

## 3. Scope

- **In scope:** Wizard chrome/title placement, child-step width/padding cleanup, Step 7 review width, stale source-grep test refresh.
- **Out of scope:** Backend publishing behavior, autosave mutations, refund policy logic, traveler intake behavior, payment plan behavior, visual live-fire simulator capture.
- **Assumptions:** The mobile header is the correct single owner for progress plus active step copy, per operator direction.

## 4. Files Read

| File | Why | Relevant finding |
|---|---|---|
| `mingla-business/src/components/trip/TripCreatorWizard.tsx` | Main wizard host | In-body `STEP N OF 7` title block caused duplicate title/subtitle below existing progress chrome. |
| `mingla-business/src/components/trip/TripCreatorStep2Itinerary.tsx` | Step 2 width issue | Nested ScrollView and `paddingHorizontal: spacing.lg` narrowed day cards. |
| `mingla-business/src/components/trip/TripCreatorStep3Inclusions.tsx` | Step 3 width issue | Nested ScrollView and `paddingHorizontal: spacing.lg` narrowed controls. |
| `mingla-business/src/components/trip/TripCreatorStep4Pricing.tsx` | Step 4 width issue | Extra host horizontal padding narrowed pricing/payment-plan content. |
| `mingla-business/src/components/trip/TripCreatorStep5Review.tsx` | Step 7 review issue | Review helper and TripPreview body added extra side padding. |
| `mingla-business/src/components/trip/TripPreview.tsx` | Step 7 preview width | Public default body padding needed an override for framed wizard review usage. |
| `mingla-business/app/trip/__tests__/trip-create-publish.test.ts` | Regression test | Stale Step 5 publish regex could not match current Step 7 publish branch. |

## 5. Blast Radius

- **Direct changes:** Trip wizard header/body layout and source-grep test.
- **Cascade changes:** Step 2/3 components now rely on parent scroll containers; current usages are wizard and edit-published accordion surfaces.
- **Parity surfaces:** Business iOS, Android, and web preview through shared React Native bundle.
- **Cache impact:** None.
- **State boundaries:** None.
- **Auth/RLS/security:** None.
- **Deploy path:** JS-only; eligible for OTA/web deploy if bundled with the target release.

## 6. Old To New Receipts

### `TripCreatorWizard.tsx`

- **Before:** Mobile header showed progress, then scroll body repeated `STEP N OF 7`, title, and subtitle.
- **After:** Mobile header owns brand/step, active title, subtitle, and autosave state; scroll body starts with the actual step content.
- **Why:** Removes repetitive chrome and gives the content area more usable vertical space.
- **Approx lines changed:** 68.

### `TripCreatorStep2Itinerary.tsx`

- **Before:** Nested ScrollView added its own horizontal padding inside the wizard body.
- **After:** Plain View lets the wizard body own scrolling and width.
- **Why:** Day cards fill the same content width as Step 1.
- **Approx lines changed:** 14.

### `TripCreatorStep3Inclusions.tsx`

- **Before:** Nested SmartScrollView added its own horizontal padding inside the wizard body.
- **After:** Plain View lets the wizard body own scrolling and width.
- **Why:** Included/excluded controls fill the same content width as Step 1.
- **Approx lines changed:** 14.

### `TripCreatorStep4Pricing.tsx`

- **Before:** Host added extra horizontal padding.
- **After:** Host keeps vertical spacing only.
- **Why:** Pricing/payment-plan cards fill the wizard body width.
- **Approx lines changed:** 1.

### `TripCreatorStep5Review.tsx` and `TripPreview.tsx`

- **Before:** Review preview had stacked padding from wizard body plus TripPreview body.
- **After:** TripPreview accepts `contentPadding`, and wizard review passes `0`.
- **Why:** Step 7 review aligns with the wizard content width while public trip preview keeps its default padding.
- **Approx lines changed:** 7.

### `trip-create-publish.test.ts`

- **Before:** Test asserted stale Step 5 publish wiring.
- **After:** Test asserts all 7 mounted step components and Step 7 `handlePublishTap` wiring.
- **Why:** Locks the post-ORCH-0880 wizard contract.
- **Approx lines changed:** 14.

## 7. Implementation Details

- **Architecture decisions:** Kept one owner for wizard scrolling and horizontal padding: `TripCreatorWizard`.
- **Data flow:** Unchanged.
- **Mutation/query behavior:** Unchanged.
- **State handling:** Unchanged.
- **Error handling:** Unchanged.
- **Copy/accessibility:** Active step title/subtitle moved to existing mobile chrome; existing labels and test IDs retained.
- **Analytics/notifications/realtime:** None.

## 8. Spec / Goal Traceability

| Criterion / goal | Implemented | Verification | Status |
|---|---|---|---|
| Refresh stale publish assertion to Step 7 | Yes | Jest publish contract test | PASS |
| Add Step 5 policy mount assertion | Yes | Jest publish contract test | PASS |
| Add Step 6 intake mount assertion | Yes | Jest publish contract test | PASS |
| Remove duplicate Step 2/3/4/5/6 title block | Yes | Source review and targeted lint | PASS |
| Make Step 2/3/4/7 use full wizard body width | Yes | Source review and targeted lint | PASS |
| Live-fire simulator visual verification | No | Not run in this turn | MANUAL GATE |

## 9. Invariant Verification

| Invariant | Relevant | Preserved | Notes |
|---|---|---|---|
| No backend/data behavior change | Yes | Yes | UI-only layout and test changes. |
| Tests move with behavior | Yes | Yes | Existing test refreshed with `[TEST-MOD-APPROVED ORCH-0919]` marker in source; commit body must also include it. |
| Protect unrelated dirty work | Yes | Yes | Existing dirty files outside this scope were left untouched. |
| One state owner per truth | Yes | Yes | No new state owner introduced. |

## 10. Parity Check

- **Mobile:** Source-level mobile wizard changes implemented; simulator visual gate remains pending.
- **Business app:** Directly affected.
- **Admin:** Not affected.
- **Public/web:** `TripPreview` default behavior unchanged; only wizard review passes `contentPadding={0}`.
- **Solo/collab:** Not applicable.
- **Gaps:** Needs operator or tester simulator screenshot confirmation.

## 11. Cache And Persisted State Safety

- **Query keys changed:** None.
- **Invalidations added:** None.
- **Data shape changes:** None.
- **AsyncStorage/Zustand impact:** None.
- **Cold start behavior:** Unchanged.

## 12. Verification

| Check | Command / method | Result | Notes |
|---|---|---|---|
| Focused publish/layout contract test | `npx jest app/trip/__tests__/trip-create-publish.test.ts --runInBand` | PASS, 10/10 | Watchman recrawl warning only. |
| Targeted lint on touched files | `npx eslint src/components/trip/TripCreatorWizard.tsx src/components/trip/TripCreatorStep2Itinerary.tsx src/components/trip/TripCreatorStep3Inclusions.tsx src/components/trip/TripCreatorStep4Pricing.tsx src/components/trip/TripCreatorStep5Review.tsx src/components/trip/TripPreview.tsx app/trip/__tests__/trip-create-publish.test.ts` | PASS | No warnings after stale Keyboard import removal. |
| Whitespace diff check | `git diff --check -- [touched files]` | PASS | No whitespace errors. |
| Full typecheck | `npx tsc --noEmit --pretty false` | FAIL, pre-existing | Fails in checkout buyer files, ComposerV2, native payments declarations, event-rendering package, phone-input package, and existing DraftEvent test fixtures; no failures in touched trip wizard files. |

## 13. Regression Surface

1. Edit published trip accordion uses Step 2/3/4 components; removing nested padding should widen content there too.
2. Public TripPreview keeps default padding unless a caller explicitly passes `contentPadding`.
3. Source-grep tests now guard both the Step 7 publish wiring and the no-duplicate-header/no-nested-side-padding layout contract.

## 14. Risks, Limitations, Transition Items

| Item | Risk / temporary state | Exit condition | Location |
|---|---|---|---|
| No simulator screenshot captured | Visual issue could need minor spacing tuning | Tester/operator verifies iPhone 17 create wizard steps 2-7 | Business mobile simulator |
| Full typecheck remains red | Broader repo gate may still fail independently | Separate ORCH fixes existing TS errors | See verification output |
| Existing test modification | Append-only CI requires approval token | Commit body includes `[TEST-MOD-APPROVED ORCH-0919]` | Commit/PR metadata |

## 15. Discoveries For Orchestrator

- The publish contract test still contains a stale "KeyboardAvoidingView" assertion that passes only because the string appears in comments after ORCH-0892-B deleted the actual wrapper. This was not changed because it is outside the requested ORCH-0919 assertion refresh.

## 16. Deploy Notes

- **Migrations:** None.
- **Edge functions:** None.
- **Mobile OTA/native:** JS-only; OTA eligible.
- **Business/admin web:** Business web preview bundle affected if deployed.
- **Env vars/secrets:** None.

## Suggested Commit Message

```text
fix(trip-wizard): refresh create wizard chrome and publish assertion

Resolves: ORCH-0919
Evidence: npx jest app/trip/__tests__/trip-create-publish.test.ts --runInBand; targeted eslint on touched files
[TEST-MOD-APPROVED ORCH-0919]
Deploy: JS-only, OTA eligible; no migrations or edge functions
```

## Ready-To-Test Checklist

1. Open create trip wizard on iPhone 17 simulator and confirm steps 2-7 show one title/subtitle in the header, with no repeated `STEP N OF 7` block in the scroll body.
2. Confirm Step 2 day cards, Step 3 included/excluded controls, Step 4 pricing/payment plan, and Step 7 review cards align to the same usable width as Step 1.
3. Confirm Step 7 publish button still opens the publish confirmation and routes through existing publish behavior.
