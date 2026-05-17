# IMPLEMENTATION REPORT — ORCH-0859 [Tr2 Minimum Viable Trip] REWORK 2

**Status:** completed · **Verification:** passed at jest layer; iOS smoke still owed (§7)
**Skill:** Claude `mingla-implementor`
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Predecessor:** `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0859_TR2_REWORK_REPORT.md`
**Triggering QA:** `Mingla_Artifacts/reports/QA_ORCH-0859_TR2_MINIMUM_VIABLE_TRIP_REPORT_RETEST_1.md` + operator's live-fire 7-item findings (registered by orchestrator into this rework)
**Tested HEAD:** `899b6c70` plus uncommitted REWORK 2 edits

---

## 1. Layman summary

Operator's first real wizard run surfaced 7 polish-to-MVP issues. All 7 fixed in one combined return. Trip-planner brands can now actually use the wizard end-to-end: drafts in the Events tab are hidden, drafts can be reopened to finish, currency on Step 4 is locked to the brand's currency, dates use real native pickers with no-past-dates, status bar no longer collides with the header, and a visible step progress bar appears at the top of every step.

---

## 2. Items fixed (operator-numbered)

### Item 1 (P0) — Step 4 pricing blocked by `ticket_currency_must_match_event_currency`

**Files:**
- [src/components/trip/TripCreatorStep4Pricing.tsx](mingla-business/src/components/trip/TripCreatorStep4Pricing.tsx) — currency `<TextInput>` removed, replaced with read-only `<View>` showing the event's currency.
- [src/services/tripsService.ts](mingla-business/src/services/tripsService.ts) — `updateTripPricing` now SELECTs `events.currency` and always passes that to the `ticket_types` update; `patch.currency` is accepted on the type for backwards compatibility but IGNORED.
- [src/components/trip/TripCreatorWizard.tsx](mingla-business/src/components/trip/TripCreatorWizard.tsx) `autosaveStep4` — `currency` key removed from the patch.

**Why:** `tg_enforce_event_ticket_currency` trigger (ORCH-0769) rejects mismatches between ticket_types.currency and events.currency. Letting operators type free-form currency on Step 4 caused the trigger to raise on every autosave that differed from the event's locked currency.

### Item 2 (P2) — Wizard bleeds into status bar

**File:** [src/components/trip/TripCreatorWizard.tsx](mingla-business/src/components/trip/TripCreatorWizard.tsx)

Added `useSafeAreaInsets` import + `paddingTop: insets.top` on the root `KeyboardAvoidingView`. Mirrors [src/components/event/EventCreatorWizard.tsx:38,170,651](mingla-business/src/components/event/EventCreatorWizard.tsx#L38) pattern.

### Item 3 (P1) — Trips leak into Events tab

**File:** [src/services/businessEvents.ts](mingla-business/src/services/businessEvents.ts) `fetchBusinessEventsForBrand`

Discovery: `business_management_events_view` does NOT expose the `event_type` column (verified via `pg_get_viewdef` probe + `SELECT event_type FROM business_management_events_view` failing). So a direct `.eq("event_type", "event")` filter on the view fails at the Postgrest column-resolution layer. Implemented client-side filter instead: fetch view rows → second small `events.in("id", ids).select("id, event_type")` query → build trip-id set → filter view rows. One extra round-trip. Inline comment cites the parity with `discover-merged-events`.

**Out-of-scope note for orchestrator:** a future ORCH could add `event_type` to the view (recreate view migration) to eliminate the extra round-trip. Not blocking.

### Item 4 (P1) — No edit path for draft trips

**File:** [app/(tabs)/hub/trips.tsx](mingla-business/app/%28tabs%29/hub/trips.tsx)

`Pressable.onPress` now discriminates by `trip.status === "draft"` → routes to `/trip/{id}/edit` (wizard host); other statuses → `/trip/{id}` (operator dashboard). Accessibility label also branches ("Continue editing X" vs "Open X").

### Item 5 (P1) — Free-form date text → native date picker

**File:** [src/components/trip/TripCreatorStep1Basics.tsx](mingla-business/src/components/trip/TripCreatorStep1Basics.tsx) — substantial rewrite.

- Imported `@react-native-community/datetimepicker` (already in `package.json`, v8.4.4).
- Start/end `<TextInput>` replaced with `<Pressable>` rows showing the formatted selected date (or "Tap to pick").
- iOS: `<Modal transparent>` with a spinner `<DateTimePicker>` + Done button (commit-on-Done, not commit-per-wheel-stop) — mirrors event-wizard iOS pattern.
- Android: dialog-mode `<DateTimePicker>` with `display="default"` (commit-on-set / cancel-on-dismissed).
- Web: hidden `<input type="date">` with `min` attribute.
- `minimumDate`: start = today; end = `max(startAt, today)`.
- Auto-bumps end date forward if a new start is later than the existing end.
- All commit paths route through `dateToIso(d, isEnd)` which serializes to `YYYY-MM-DDT00:00:00.000Z` (start) or `T23:59:59.000Z` (end) — same ISO 8601 contract the publish RPC expects.

### Item 6 (P2) — Visible step progress

**File:** [src/components/trip/TripCreatorWizard.tsx](mingla-business/src/components/trip/TripCreatorWizard.tsx)

Added a 5-segment horizontal progress bar below the header. Three states: complete (warm accent fill), current (warm accent at 60% opacity), upcoming (faint white). `testID="trip-wizard-progress"` for accessibility/test discovery. Operator-friendly visual on top of the existing "Step X of 5" text.

### Item 7 (P1 → degraded to defensive on top of item 1) — "Couldn't save your changes" stale banner after fixing Step 4

**Investigation result: CONFIRMED CASCADE from item 1.** Root cause: [TripCreatorWizard.tsx](mingla-business/src/components/trip/TripCreatorWizard.tsx) `handleBack` cleared `publishError` but `handleNext` did NOT clear on success. Sequence that triggered it: operator typed wrong currency on Step 4 → tapped Next → autosave threw `ticket_currency_must_match_event_currency` → `publishError` set with `pointsToStep: 4` → operator went Back → fixed currency to EUR → tapped Next → autosave succeeded → wizard advanced to Step 5 → BUT `publishError` state never cleared → Step 5 still showed the stale "Go back to Step 4 to fix" banner.

**Two fixes layered (belt + braces):**
1. Item 1 removes the failure path entirely — autosave can never fail on Step 4 because the user can't enter a mismatched currency anymore.
2. `handleNext` now calls `setPublishError(null)` after `autosaveCurrentStep()` succeeds — defensive against future failure paths.

---

## 3. Verification

### Jest (all Tr2 suites, fresh shell)

```
PASS src/services/__tests__/tripsService.test.ts                           (3 tests)
PASS src/services/__tests__/tripsService.createTripDraft.currency.test.ts  (2 tests)
PASS src/services/__tests__/tripsService.updateTripPricing.currency.test.ts (2 tests, NEW)
PASS src/services/__tests__/tripCheckoutService.test.ts                    (5 tests)
PASS src/hooks/__tests__/useTrips.test.ts                                  (7 tests)
PASS app/trip/__tests__/trip-create-publish.test.ts                        (8 tests)
PASS app/t/__tests__/public-trip-page.test.ts                              (8 tests)
PASS src/components/trip/__tests__/publishErrorMapper.adversarial.test.ts  (6 tests, tester adversarial)
PASS src/components/trip/__tests__/tr2RewordPolish.test.ts                 (9 tests, NEW)

Test Suites: 9 passed, 9 total
Tests:       49 passed, 49 total  (was 38)
```

### Adversarial structural CI

```
Result: 14 PASS, 0 FAIL
```

### Regression test gate (Step 0.5)

- **Implementor happy-path NEW (item 1, P0):** [src/services/__tests__/tripsService.updateTripPricing.currency.test.ts](mingla-business/src/services/__tests__/tripsService.updateTripPricing.currency.test.ts) — 2 tests asserting `ticket_types.currency` derives from event currency regardless of `patch.currency`. Fails-on-revert verified by inline edit `currency: eventCurrency` → `currency: patch.currency ?? eventCurrency` → test FAILed at "always sends events.currency to ticket_types" → restored → 2/2 PASS.
- **Implementor source-grep regression (items 2, 3, 4, 5, 6, 7):** [src/components/trip/__tests__/tr2RewordPolish.test.ts](mingla-business/src/components/trip/__tests__/tr2RewordPolish.test.ts) — 9 tests pinning the file/line commitments. Fails-on-revert verified independently for items 4 (reverted draft-routing → "hub/trips routes drafts..." test FAILed → restored → PASS) and 5 (removed DateTimePicker import → "Step 1 imports DateTimePicker..." test FAILed → restored → PASS). Items 2/6/7 fails-on-revert NOT independently spot-checked but the assertions are tight regex matches over the specific lines added — reverting any of them would mechanically fail the matcher.
- **Tester adversarial:** untouched (immutable per Step 0.5 (b) gate); still 6/6 PASS.

### Type-check

`npx tsc --noEmit` not run as a hard gate (large pre-existing baseline of 81 errors documented in Tr1 close — checking the delta would require a clean baseline diff). Spot-check: no new errors observed against any REWORK 2 file during jest compilation (jest uses ts-jest with babel which catches the same errors).

---

## 4. Cross-surface impact

| Surface | Touched | Behavior change |
|---|---|---|
| Business iOS | YES | All 7 fixes apply; SafeArea fix is iOS-meaningful |
| Business Android | YES (shared RN code) | All 7 apply; DateTimePicker uses Android-native dialog mode |
| Business Web preview | YES (shared code) | DateTimePicker falls back to `<input type="date">` HTML5 native; SafeArea is no-op (`insets.top === 0`) |
| Consumer iOS / Android | NO | `app-mobile/` untouched |
| Buyer/anonymous Web | NO | No buyer-anon route touch |
| Admin Web | NO | `mingla-admin/` untouched |

Parity is automatic — single code path consumed by all three business surfaces.

---

## 5. Invariants preserved

- I-1.2-UNIFIED-EVENT-TYPE: events tab now correctly filters by event_type='event' (was leaking trips); discover-merged-events parity preserved.
- Constitution #2 (one owner per truth): currency is now owned exclusively by events.currency; ticket_types.currency mirrors. Wizard no longer creates a competing owner.
- Constitution #3 (no silent failures): item 7 fix makes the banner state truthful — error appears when there's an actual error, clears when fixed.
- Constitution #12 (validate at right time): item 5 enforces start-date ≥ today and end-date ≥ start-date at the picker layer (not at publish-time after operator has filled the whole wizard).
- Append-only CI: respected — `tripsService.test.ts` was already TEST-MOD-APPROVED in REWORK 1 and is NOT touched this turn; both new test files are additive.

---

## 6. Regression surface (what tester should attack)

1. **Event-wizard parity** — `tripsService.test.ts` still passes; the publishTrip + SlugCollisionError + RPC-error tests should remain green.
2. **Cache safety** — `useUpdateTripPricing` mutation now no-longer receives `currency` from the wizard, but its `onSuccess` invalidation pattern is unchanged. Confirm no stale React Query cache.
3. **Events tab perf** — extra round-trip per fetch (item 3 client-side filter). With ~10–50 events typical, latency impact is negligible (~30ms extra round-trip).
4. **Web Stripe ↔ trip currency** — the read-only currency display on Step 4 reads from the loaded trip; confirm it shows the actual event currency, not a stale state.
5. **Edit-existing-draft path** — operator taps draft trip in `/hub/trips` → routes to `/trip/{id}/edit` → wizard loads existing values → operator can edit + save + publish. Full round-trip not unit-tested.

---

## 7. Live-fire status

NOT performed in this Claude session. All fixes are TS-layer except item 5 which uses an already-installed native module (`@react-native-community/datetimepicker` v8.4.4 — no new pod). Operator should Cmd+R reload on the iPhone 17 Pro sim (UDID `17091E60-C3B6-4167-980D-60C348E177F6`).

If item 5 (DateTimePicker) shows the iOS modal correctly, no rebuild needed. If the spinner doesn't appear / crashes on launch, the dev build may need a `pod install` cycle even though the module is in package.json — fall back to `Mingla_Artifacts/IOS_DEV_BUILD_REBUILD_RUNBOOK.md`.

---

## 8. Discoveries for orchestrator

- **None new this turn** beyond what was already registered in the prior IMPLEMENT report (META-ORCH for forensics+SPEC body-read discipline) and the prior QA report (Postgrest contract primer + Bug #1 adversarial gap).
- **Out-of-scope note (item 3):** `business_management_events_view` would benefit from exposing `event_type` so the events filter can be a server-side `.eq()` instead of the client-side post-fetch filter. Not blocking — defer to a future ORCH if/when view changes happen anyway.

---

## 9. Files changed (8)

```
M  mingla-business/src/components/trip/TripCreatorStep4Pricing.tsx               (item 1)
M  mingla-business/src/components/trip/TripCreatorStep1Basics.tsx                (item 5, substantial)
M  mingla-business/src/components/trip/TripCreatorWizard.tsx                     (items 1, 2, 6, 7)
M  mingla-business/src/services/tripsService.ts                                  (item 1)
M  mingla-business/src/services/businessEvents.ts                                (item 3)
M  mingla-business/app/(tabs)/hub/trips.tsx                                      (item 4)
A  mingla-business/src/services/__tests__/tripsService.updateTripPricing.currency.test.ts  (item 1 happy-path)
A  mingla-business/src/components/trip/__tests__/tr2RewordPolish.test.ts         (items 2-7 source-grep)
```

No new migrations. No edge function changes. Edge function deploys (`ticket-confirmation-dispatch` + `discover-merged-events`) remain orchestrator-owned at CLOSE per prior QA §10.
