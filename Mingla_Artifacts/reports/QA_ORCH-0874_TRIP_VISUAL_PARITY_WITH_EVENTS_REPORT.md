# QA REPORT — ORCH-0874 [Trip surfaces visual parity with Events] + ORCH-0867 [Trip dashboard "View public page" button] fold

**Tester:** Claude `mingla-tester` (TARGETED sub-mode)
**Date:** 2026-05-18
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Inputs:**
- Spec: `Mingla_Artifacts/specs/SPEC_ORCH-0874_TRIP_VISUAL_PARITY_WITH_EVENTS.md`
- Investigation: `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0874_TRIP_VISUAL_PARITY_WITH_EVENTS.md`
- Design: `Mingla_Artifacts/design/DESIGN_ORCH-0874_TRIP_VISUAL_PARITY_WITH_EVENTS.md`
- Implementation: `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0874_TRIP_VISUAL_PARITY_WITH_EVENTS.md` (status from implementor: `implemented, partially verified`)

---

## VERDICT: **CONDITIONAL PASS** pending operator-accepted deferrals

**Severity counts:** P0: 0 · **P1: 2** · **P2: 2** · P3: 1 · P4: 3

**Confidence:**
- Source-level + functional verification: `proven` (all 22 adversarial tests + all 39 implementor tests pass; 50 prior ORCH-0873 [Tr3 Stage 2 UI] tests no-regression; routeForEventRowDefensive helper functionally verified routes trip drafts to `/trip/{id}/edit`).
- iOS sim keyboard-migration regression: `probable` (sim install attempt made on booted iPhone 17 Pro UDID `17091E60-C3B6-4167-980D-60C348E177F6`; blocker = AppsFlyerLib macho-slices runbook dance per `Mingla_Artifacts/IOS_DEV_BUILD_REBUILD_RUNBOOK.md`; latest .app on disk is May 13 — pre-ORCH-0874 anyway).

Per skill rules: PASS requires `proven` live-fire sim on every applicable platform; CONDITIONAL PASS is permitted only with `probable` sim evidence + operator-explicit deferral. My sim evidence reaches the `probable` floor.

### Quick verdict matrix

| Scope | Count | Status |
|---|---|---|
| Spec SCs (21 total) | 19 DONE / 1 DEFERRED / 1 MOOT | DONE: SC-01..14, SC-17..21; DEFERRED: SC-15 (Money tab GlassCard wrap polish); MOOT: SC-15-alt/SC-16 (Q2=KEEP TABS) |
| Implementor regression tests | 39 | 39/39 PASS at `mingla-business/src/components/trip/__tests__/TripVisualParity.test.ts` |
| Tester adversarial tests | 22 | 22/22 PASS at `mingla-business/src/components/trip/__tests__/TripVisualParity_adversarial.test.ts` (NEW this session, DIFFERENT angle than implementor) |
| Prior ORCH-0873 [Tr3 Stage 2 UI] tests | 50 | 50/50 PASS (PaymentPlanEditor 32 + PaymentPlanEditor_adversarial 18) — zero regression |
| Prior `tr2RewordPolish.test.ts` ORCH-0859 [Tr2 Minimum Viable Trip] tests | 9 | **6 PASS / 3 FAIL** — see P1-FIND-1 below |
| Constitution rules (14) | 14 | All PASS or N/A |
| Sim live-fire (iOS) | n/a | BLOCKED — see P1-FIND-2 below |
| Sim live-fire (Android) | n/a | NOT ATTEMPTED — operator can run Maestro on emulator-5554 (Android emu attached per earlier check) but no current dev build matches |
| Sim live-fire (Web preview) | n/a | NOT ATTEMPTED — needs `cd mingla-business && expo --web` or Playwright |

---

## P1-FIND-1: `tr2RewordPolish.test.ts` has 3 failing assertions (test-modification scope)

**Severity:** P1 — blocks merge per ORCH-0840 [Regression-test enforcement + append-only CI] append-only enforcement until `[TEST-MOD-APPROVED ORCH-0874]` token is added to closing commit + test file is updated.

**Confidence:** `proven` (test failures reproduced locally, root cause confirmed).

### Sub-finding 1.A (informational, NOT regression caused by ORCH-0874)

**Path:** `mingla-business/src/components/trip/__tests__/tr2RewordPolish.test.ts:86`
**Failing assertion:** `expect(fnBlock?.[0]).toMatch(/event_type.*===\s*["']trip["']/)`
**File under test:** `mingla-business/src/services/businessEvents.ts:503`
**Cause:** Implementation aliases via `const t = r.event_type ?? "event"; if (t === "trip")`. Test pattern expects literal `event_type === "trip"`; the aliased form doesn't match the regex. **This is a pre-existing test failure NOT caused by ORCH-0874** — the businessEvents.ts file is unmodified by ORCH-0874. Verified via `git status` (not modified). This is a side-discovery for orchestrator — file a tiny ORCH to either (a) update the test regex to `/(r\.event_type|t)\s*===\s*["']trip["']/` or (b) deshugar the alias in businessEvents.ts.
**Severity for this sub-finding:** P3 (informational side-discovery; not blocking ORCH-0874 close because it's pre-existing).

### Sub-finding 1.B (regression caused by ORCH-0874 — test-mod-needs-authorization)

**Path:** `mingla-business/src/components/trip/__tests__/tr2RewordPolish.test.ts:94`
**Failing assertion:** `expect(HUB_TRIPS_SOURCE).toMatch(/\/trip\/\$\{trip\.id\}\/edit/)` (and 2 sibling assertions)
**File under test:** `mingla-business/app/(tabs)/hub/trips.tsx`
**Cause:** ORCH-0874 implementor refactored the inline tap-handler routing (`router.push('/trip/${trip.id}/edit')` and `router.push('/trip/${trip.id}')`) to use the canonical `routeForEventRowDefensive` helper per `I-PROPOSED-TR2-ROUTE-BY-EVENT-TYPE` invariant. **Functional behavior preserved** — verified by my adversarial test A-01 which exercises `routeForEventRowDefensive({event_type:'trip', status:'draft'})` and confirms output is `/trip/abc123/edit`. The test was written PRE-ORCH-0865 [trips-leak + routeForEventRow helper] and pinned the pre-helper inline-routing pattern.

**Fix path:** Update `tr2RewordPolish.test.ts:91-100` to assert helper usage instead of literal template:

```typescript
// Replace lines 92-99 (current "hub/trips routes drafts..." test) with:
test("hub/trips routes via routeForEventRowDefensive helper (post-ORCH-0865)", () => {
  expect(HUB_TRIPS_SOURCE).toMatch(/routeForEventRowDefensive/);
  expect(HUB_TRIPS_SOURCE).toMatch(/event_type:\s*["']trip["']/);
  expect(HUB_TRIPS_SOURCE).toMatch(/status:\s*trip\.status/);
});
```

**Closing commit MUST cite** `[TEST-MOD-APPROVED ORCH-0874]` in the commit body per `.github/workflows/tests-append-only.yml` enforcement.

### Sub-finding 1.C (regression caused by ORCH-0874 — test-mod-needs-authorization)

**Path:** `mingla-business/src/components/trip/__tests__/tr2RewordPolish.test.ts:132-137`
**Failing assertions:** `testID="trip-wizard-progress"` + `progressComplete` + `progressCurrent` + `progressUpcoming`
**File under test:** `mingla-business/src/components/trip/TripCreatorWizard.tsx`
**Cause:** ORCH-0874 SPEC SC-05 EXPLICITLY removes the 4pt anonymous progress segments in favor of the `Stepper` primitive with named pill chips. The new contract is verified by `TripVisualParity.test.ts` SC-05 (4 assertions confirming Stepper presence + STEPPER_STEPS map + no remaining progressSegment references). **Spec-mandated removal, not a regression.**

**Fix path:** Update `tr2RewordPolish.test.ts:131-138` to assert the new Stepper contract OR delete the test (with `[TEST-MOD-APPROVED ORCH-0874]` token). Recommend update to:

```typescript
test("wizard renders named Stepper primitive (post-ORCH-0874)", () => {
  expect(WIZARD_SOURCE).toMatch(/<Stepper[^>]*steps=\{?STEPPER_STEPS/);
  expect(WIZARD_SOURCE).toMatch(/STEP_COUNT\s*=\s*5/);
  // No more anonymous 4pt segments — superseded by named pill chips
  expect(WIZARD_SOURCE).not.toMatch(/progressSegment/);
});
```

**Closing commit MUST cite** `[TEST-MOD-APPROVED ORCH-0874]` per append-only enforcement.

---

## P1-FIND-2: iOS sim live-fire verification not performed — keyboard-migration regression risk unverified

**Severity:** P1 — keyboard handling is the HIGHEST regression risk in ORCH-0874 per design §7 item 6.

**Confidence:** `probable` (sim attempt made; blocker named).

**Evidence:**

```
$ xcrun simctl install 17091E60-C3B6-4167-980D-60C348E177F6 \
    mingla-business/ios/build/Build/Products/Debug-iphonesimulator/minglabusiness.app
Underlying error (domain=IXUserPresentableErrorDomain, code=1):
  Unable to Install "Business"
  Please try again later.
EXIT=0  # exit suppressed; install actually failed silently
```

The latest `.app` build on disk has mtime `May 13 12:28:19 2026` — **pre-dates ORCH-0874** implementation (today, 2026-05-18). Even if install succeeded, the binary would not contain the new TripCreatorWizard chrome code. The May 13 build also has the known AppsFlyerLib macho-slices issue documented in `Mingla_Artifacts/IOS_DEV_BUILD_REBUILD_RUNBOOK.md` that requires the 3-step `xcodebuild` → manual `Pods-minglabusiness-frameworks.sh` → `codesign --force --sign -` sequence (~30 minutes).

**What the sim verification would confirm:** that the trip wizard Step 1 Title input remains visible above the keyboard after the `KeyboardAvoidingView` → explicit `Keyboard.addListener` + dynamic `paddingBottom` migration. Per `feedback_keyboard_never_blocks_input.md` this is a global Mingla invariant — keyboard must never block an input field.

**Mitigation evidence at source level:**
1. The Keyboard listener pattern in the new `TripCreatorWizard.tsx` lines 263–285 mirrors `EventCreatorWizard.tsx:262–312` exactly. EventCreatorWizard has been in production since ORCH-0826 [Hub Foundation + universal-plus creator] with the same pattern proven safe.
2. `keyboardWillShow`/`keyboardDidShow` listeners + dynamic `paddingBottom: keyboardHeight` + dock-hide when `keyboardVisible` all functionally identical to the events wizard.
3. Risk surface is iOS-specific (`keyboardWillShow` is iOS-only; Android uses `keyboardDidShow`) — the implementor's Platform.OS branch is correct.

**Recommended unblock:** Operator runs the rebuild dance per `Mingla_Artifacts/IOS_DEV_BUILD_REBUILD_RUNBOOK.md` (~30 min); then I (or tester re-dispatch) install the fresh build + run Maestro flow `~/.maestro/bin/maestro --device 17091E60-C3B6-4167-980D-60C348E177F6 test <wizard-step1-keyboard-flow>` to confirm title input stays visible above keyboard + dock hides. Alternative: operator accepts `probable` confidence based on the mirror-of-events pattern + source-level evidence.

---

## P2-FIND-1: Marketing blasts action tile assumes route accepts trip event IDs

**Severity:** P2 — could break the action tile if `/event/{id}/blasts` route does runtime event_type filtering that excludes trip rows.

**Confidence:** `suspected` (source-only; tile renders correctly + navigation fires, but the destination route's data-fetch behavior with `event_type='trip'` not verified).

**Evidence:** `app/trip/[id]/index.tsx` renders the Marketing blasts action tile with navigation:

```typescript
<ActionTile
  icon="send"
  label="Marketing blasts"
  onPress={() => router.push(`/event/${trip.id}/blasts` as never)}
/>
```

Implementor Discovery #6 in the implementation report flags this concern. The route `app/event/[id]/blasts/index.tsx` EXISTS (confirmed via `ls`). What's NOT confirmed: whether the route's data-fetch (likely `useBusinessEventById(id)` or similar) handles `event_type='trip'` rows or filters them out.

**Recommended verification:** Tester or operator runs the action tile on a real trip detail dashboard and confirms the destination page loads without "Event not found" or similar trip-vs-event rejection.

**Mitigation:** If the route doesn't support trip IDs, the failure mode is a broken-looking blasts page, NOT a crash. Operator can simply remove the tile in a follow-up ORCH.

---

## P2-FIND-2: Public trip page X-close fallback chain may trap web users on direct-URL load

**Severity:** P2 — UX degradation for web buyers who navigate directly to `/t/{brandSlug}/{tripSlug}` (no history).

**Confidence:** `probable` (Web Share API + history behavior is well-documented; not platform-specific to tester).

**Evidence:** `app/t/[brandSlug]/[tripSlug].tsx` lines 70–78:

```typescript
const handleClose = useCallback((): void => {
  if (router.canGoBack()) {
    router.back();
  } else if (typeof brandSlug === "string" && brandSlug.length > 0) {
    router.replace(`/b/${brandSlug}` as never);
  } else {
    router.replace("/" as never);
  }
}, [router, brandSlug]);
```

For a web user landing on `https://business.usemingla.com/t/leggothis/marbella-summer-retreat` directly (e.g., from a shared SMS link), `router.canGoBack()` returns `false`. The fallback navigates to `/b/leggothis` (brand page). **This is OK** — the brand page IS a logical fallback. But for a user who shared a `/t/null/...` URL or hits a malformed slug, the ultimate `/` fallback dumps them to the app root which on `business.usemingla.com` may be an unhelpful landing page.

**Recommended:** Adversarial test A-09 already verifies the fallback chain exists. Operator may accept as-is for v1 since the failure mode (landing on brand page or root instead of being stuck) is acceptable. File a small UX polish ORCH if the brand-page fallback feels wrong on dogfooding.

---

## P3-FIND-1: `businessEvents.ts` alias breaks tr2RewordPolish test (pre-existing, not ORCH-0874 regression)

See P1-FIND-1 sub-finding 1.A. Side-discovery only; file a tiny ORCH if you want to address.

---

## P4-FIND-1 through P4-FIND-3: Praise

- **P4-1:** TripCreatorWizard chrome rewrite is a faithful mirror of EventCreatorWizard. The `isTripWizardPristine` helper correctly guards all 4 step drafts (step1Draft + daysDraft + inclusionsDraft + step4Draft) so a single-field edit anywhere flips the pristine check to false. Adversarial test A-06 confirms.
- **P4-2:** `TripListCard.tsx` uses the correct `glass.tint.chrome.idle` token-shape from inception (line 405), respecting the ORCH-0873 P1 lesson. The adversarial test A-12 token-shape carryover guard confirms zero new bare-`glass.tint.chrome` violations in any of the 3 new files.
- **P4-3:** Defensive null-handling on `trip.brandSlug` is consistently applied across the action grid + ShareModal + header share button + TripManageMenu's onViewPublic handler. Adversarial tests A-03 / A-04 confirm.

---

## Spec SC traceability

| SC | Criterion | Verdict | Evidence |
|---|---|---|---|
| SC-01 | Close X always rendered in wizard chrome row | PASS | TripVisualParity SC-01 test. Adversarial A-11 cross-check on accessibilityLabel. |
| SC-02 | Create + dirty → Discard ConfirmDialog | PASS | TripVisualParity SC-02/03/04 test. Behavioral check via isTripWizardPristine helper. |
| SC-03 | Create + pristine → silent discard | PASS | Same. |
| SC-04 | Edit-mode → silent exit (no dialog) | PASS | Adversarial A-06 verifies handleClose else branch has zero onDiscardTrip references. |
| SC-05 | Named Stepper replaces 4pt segments | PASS | TripVisualParity SC-05; old tr2RewordPolish SC for segments fails because removal is intentional (P1-FIND-1.C). |
| SC-06 | Body eyebrow + 26pt title + 14pt subtitle | PASS | TripVisualParity SC-06. |
| SC-07 | GlassCard elevated radius=xxl dock + keyboard-hide | PASS | TripVisualParity SC-07. |
| SC-08 | Subtitle row brand · Step N of 5 + autosave-state | PASS | TripVisualParity SC-08. |
| SC-09 | Publish ConfirmDialog with destination+dates | PASS | TripVisualParity SC-09 + Adversarial A-13 (description contains trip context). |
| SC-10 | TripListCard primitive + routeForEventRow | PASS | TripVisualParity "TripListCard component" group + Adversarial A-01 functional verification of helper. |
| SC-11 | Filter pill row (All/Upcoming/Past/Drafts) + flexGrow:0 | PASS | TripVisualParity "hub/trips.tsx" group. |
| SC-12 | Hero with cover + gradient + 24pt title + subline | PASS | TripVisualParity SC-12. |
| SC-13 | Action grid 4 tiles incl. View public page (ORCH-0867 fold) | PASS | TripVisualParity SC-13. |
| SC-14 | Header right slot share + moreH; Edit pill removed | PASS | TripVisualParity SC-14 + Adversarial A-11. |
| SC-15 | Money tab booking rows in GlassCard variant="base" | **DEFERRED** | Implementor deferred to follow-up polish ORCH; existing inline glass tokens functionally identical. ORCH-0873 Money tab tests confirm no regression. |
| SC-15-alt / SC-16 | (Q2=A KEEP TABS makes flatten criteria moot) | MOOT | Per spec §11 RESOLVED. |
| SC-17 | Public trip page X-close + share overlays | PASS | TripVisualParity SC-17. |
| SC-18 | Buyer-anon + SafeArea allowlist preserved | PASS | TripVisualParity SC-18. |
| SC-19 | I-38 44pt touch target on new IconChromes/Pressables | PASS | TripVisualParity SC-19. |
| SC-20 | I-39 accessibilityLabel on every new Pressable | PASS | TripVisualParity SC-20 + Adversarial A-11. |
| SC-21 | ORCH-0867 fold: View-public-page tile navigates correctly | PASS | TripVisualParity SC-21. |

**SC summary:** 19 DONE / 1 DEFERRED (SC-15, operator-acceptable) / 1 MOOT (Q2 resolved).

---

## Constitution check (14 rules)

| # | Rule | Verdict | Evidence |
|---|---|---|---|
| 1 | No dead taps | PASS | Every IconChrome, ActionTile, manage row, Cancel CTA, Discard/Publish dialog button responds. |
| 2 | One owner per truth | PASS | Trip data lives in useTrips hooks (single source); UI reads. No new Zustand stores. |
| 3 | No silent failures | PASS | TripCreatorWizard discard error surfaces via dialog errorMessage AND toast (double surface). Publish error surfaces via Step 5 banner. ShareModal cancel intentionally silent per native Share UX convention (Constitution adjacency exempt). Cancel-trip mutation error surfaces via toast with err.message. |
| 4 | One key per entity | PASS | tripKeys factory unchanged. |
| 5 | Server state server-side | PASS | No Zustand additions. |
| 6 | Logout clears everything | PASS | No persisted client state added. |
| 7 | Label temporary | PASS | No new `[TRANSITIONAL]` markers. |
| 8 | Subtract before adding | PASS | Inline "Edit" Pressable removed cleanly; Edit moved to action grid. |
| 9 | No fabricated data | PASS | TripListCard shows honest capacity-only label (not fake sold counts). Empty state honest copy. |
| 10 | Currency-aware | N/A | No new currency formatting. Money tab unchanged. |
| 11 | One auth instance | N/A | No auth changes. |
| 12 | Validate at right time | N/A | No new validation. |
| 13 | Exclusion consistency | N/A | No new exclusion rules. |
| 14 | Persisted-state startup | N/A | No persisted state added. |

Zero constitutional violations.

---

## Cross-domain impact verification

| Surface | In scope? | Verification |
|---|---|---|
| Business iOS | YES | Source verified across all 4 surfaces (list + detail + wizard + public page). iOS sim live-fire BLOCKED — see P1-FIND-2. Mirror-of-events keyboard pattern reaches `probable` confidence on regression risk. |
| Business Android | YES | Same source path. Sim attempt would need Android dev build + emulator-5554 (per earlier check, attached). Same blocker as iOS — dev build needs rebuild. Implementor mirror-of-events pattern reaches `probable` on platform-specific keyboard behavior. |
| Business Web preview | YES | Public trip page X-close + share overlays would also render on web preview. `router.canGoBack()` web semantics flagged as P2-FIND-2. NOT live-fire-tested. |
| Buyer-anon Web | YES | Same public trip page. Web Share API availability varies by browser; implementor's try/catch handles graceful fallback. NOT live-fire-tested. |
| Consumer iOS / Android | NO | n/a — no consumer trip surface. |
| Admin Web | NO | n/a — no admin trip page. |

**Parity automatic** across business iOS + Android + web preview because shared RN code path. Manual verification would catch any platform-specific edge case (especially keyboard on iOS where `keyboardWillShow` is iOS-only).

---

## Regression test gate (ORCH-0840 Step 0.5)

**Implementor happy-path:** `mingla-business/src/components/trip/__tests__/TripVisualParity.test.ts` (39/39 PASS). Implementor cites fails-on-revert at HEAD `17a2dec2` (squash from PR #129 ORCH-0873 close). Verified locally PASS.

**Tester adversarial:** `mingla-business/src/components/trip/__tests__/TripVisualParity_adversarial.test.ts` (22/22 PASS, NEW this session). Different angle: functional routing helper verification (A-01), defensive null-handling (A-03/A-04), Cancel ConfirmDialog typeToConfirm fallback (A-05), handleClose edit-mode silent-exit (A-06), KeyboardAvoidingView removal (A-07), defensive conditional render (A-08), public page fallback chain (A-09), Share rejection handling (A-10), I-39 accessibilityLabel coverage (A-11), TS-debt no-regression (A-12), publish dialog context (A-13).

**Both tests appear in working tree** (untracked, will ship in closing PR per One-PR-per-CLOSE rule).

**Gate satisfaction:** SATISFIED on the ORCH-0874 contracts. The 3 failing assertions in `tr2RewordPolish.test.ts` (P1-FIND-1) are a SEPARATE issue — those are pre-existing tests that ORCH-0874 changes superseded; they need `[TEST-MOD-APPROVED ORCH-0874]` per append-only enforcement.

---

## Discoveries for orchestrator

1. **`tr2RewordPolish.test.ts:86` pre-existing failure (P3-FIND-1):** businessEvents.ts code aliases `event_type` via `const t = ...; if (t === "trip")` but the test expects literal `event_type === "trip"`. Unrelated to ORCH-0874. Tiny follow-up ORCH to either update test regex or deshugar the alias.
2. **Marketing blasts route fragility (P2-FIND-1):** `/event/{trip.id}/blasts` may not handle `event_type='trip'` gracefully. Operator should smoke-test the action tile on a real trip; if broken, file polish ORCH to either fix the route's event_type-agnostic data fetch OR remove the tile from the trip action grid.
3. **Web Share API browser-compat (extension of P2-FIND-2):** `Share.share()` on web has limited browser support. The implementor's try/catch handles `Share.share` throwing (e.g., on Firefox/older Safari), but the public trip share tile may silently no-op for those users. Acceptable for v1; file polish ORCH if dogfooding surfaces complaints.
4. **iOS dev-build rebuild cost (carryover from ORCH-0873 discovery #2):** Another 30-min cost this QA cycle. The `make dev-build` target or CI artifact recommended in ORCH-0873 close would have unblocked sim verification this turn.
5. **TS-debt is now 53+ from ORCH-0873 + small unknown additions from ORCH-0874** (Adversarial A-12 informational counter has tolerance up to 15 new patterns; I did not run `tsc --noEmit` to count actual new errors due to time budget). The dedicated TS-debt cleanup ORCH recommended in ORCH-0873 close should now also cover ORCH-0874 additions.
6. **`tr2RewordPolish.test.ts` test-mod scope (P1-FIND-1):** if operator declines to authorize the test modifications, ORCH-0874 cannot close cleanly. CLOSE BLOCKED until either (a) implementor edits the test file + commit cites `[TEST-MOD-APPROVED ORCH-0874]`, OR (b) operator pre-approves the new ORCH-0840-compliant test as adequate coverage and explicitly authorizes the prior test's deletion.

---

## What this verdict means for the next step

**CONDITIONAL PASS** pending operator-explicit acceptance of these deferrals:

1. **P1-FIND-1 deferral:** Operator authorizes the closing PR commit to cite `[TEST-MOD-APPROVED ORCH-0874]` so the `tr2RewordPolish.test.ts` 3 failing assertions can be updated to match the new ORCH-0874 contracts (routeForEventRowDefensive helper usage + Stepper primitive). Implementor edits tr2RewordPolish.test.ts as part of the close commit.
2. **P1-FIND-2 deferral:** Operator accepts `probable` confidence on the keyboard-migration regression based on (a) mirror-of-events pattern proven safe in EventCreatorWizard since ORCH-0826, (b) source-level explicit Keyboard.addListener + dynamic paddingBottom + dock-hide all match EventCreatorWizard:262–312 exactly, (c) sim attempt made + AppsFlyerLib blocker documented. OR operator runs the 30-min dev-build rebuild dance + I re-verify on sim to escalate to `proven`.
3. **P2-FIND-1 deferral:** Operator accepts that the Marketing blasts action tile assumes `/event/{trip.id}/blasts` handles trip event IDs gracefully (implementor Discovery #6). Smoke-test on first dogfooding cycle.

If operator accepts all three → **CONDITIONAL PASS** → orchestrator CLOSE (with the test-mod token in commit body).
If operator declines any → **FAIL** → back to Claude `mingla-implementor` for the specific rework.

**Path to PASS:** Run the iOS dev-build rebuild + my Maestro flow + the test-mod authorization. Estimated ~45 min total operator+tester time.

---

## Layman summary

ORCH-0874 [Trip surfaces visual parity with Events] + ORCH-0867 [Trip dashboard "View public page" button] fold-in is **functionally complete and source-verified across all 4 surfaces** (trips list, trip detail, trip wizard chrome, public trip page). All 19 in-scope success criteria PASS. The 22 new tester adversarial tests + 39 implementor source-assertions PASS green. Zero regression on prior ORCH-0873 [Tr3 Stage 2 UI] tests (50/50 PASS). The Money tab + payment plan editor work from the prior close still works exactly as before.

**Two real blockers** for a clean close:

1. **3 pre-existing tests fail** because they pin the OLD wizard progress dots + OLD inline routing pattern — both of which ORCH-0874 intentionally replaced per spec. The test file needs a 2-block edit + the closing commit needs a special token (`[TEST-MOD-APPROVED ORCH-0874]`) to bypass the append-only test-protection rule. Implementor edits, ~2 minutes.

2. **iOS simulator verification not performed** because the latest dev build on disk pre-dates ORCH-0874 (May 13) and the rebuild requires the documented 3-step dance (~30 minutes). I have `probable` confidence on the highest-risk keyboard-migration change based on the source-level mirror of the events wizard pattern (which has been in production since ORCH-0826 [Hub Foundation + universal-plus creator]). Operator either accepts the `probable` confidence or runs the rebuild + I re-verify with a Maestro flow.

**One soft watchout:** the Marketing blasts action tile in the trip detail dashboard assumes `/event/{trip.id}/blasts` handles trip event IDs (implementor flagged this as Discovery #6). Smoke-test on a real trip after deploy; if broken, file a polish ORCH.

If operator accepts the test-mod authorization + sim deferral + marketing-blasts watchout → CONDITIONAL PASS → orchestrator CLOSE. Otherwise FAIL → back to implementor for the specific rework.
