# SPEC — ORCH-1314 [preferences-sheet-curated-paywall-dead-gate]

- **ORCH-ID:** ORCH-1314
- **Worktree:** `~/Desktop/mingla-orchs/orch-1314-[preferences-curated-paywall-dead-gate]/` on branch `orch-1314-preferences-curated-paywall-dead-gate`
- **Investigation:** `Mingla_Artifacts/investigations/INVESTIGATION_ORCH-1314_PREFERENCES_CURATED_PAYWALL.md` (root cause PROVEN by source)
- **Author:** mingla-forensics · **Date:** 2026-07-05
- **Depends on OQ-1 resolution** (free-user interaction model) — see §10. A safe, unambiguous MINIMUM is fully specified so IMPLEMENT can proceed even if OQ-1 lands on the minimum.

---

## 1. Executive summary

The "See curated experiences?" section in the consumer preferences sheet is a Mingla+-only feature, but its paywall is **unreachable**: the one element wired to open it (the curated lock banner) is hidden behind a hardcoded `isCuratedLocked={false}`, and the section's interactive controls have no gate. A free user sees the section fully unlocked and can toggle/select with no paywall. This fix wires the gate to the real signal (`!canAccess('curated_cards')` — the exact pattern already live in 5 other surfaces) so a free user's interaction with the curated section presents the Mingla+ paywall. It does **not** change what is gated (curated stays Mingla+-only) and does **not** touch the already-correct GPS/`custom_starting_point` gate.

---

## 2. Scope & non-goals

**In scope:**
- `app-mobile/src/components/PreferencesSheet.tsx` — replace the dead `isCuratedLocked={false}` with `isCuratedLocked={!canAccess('curated_cards')}`; gate the curated-section interaction handler(s) so a locked free-user tap presents the paywall.
- One new regression test proving the gate is reachable + fails-on-revert.
- (If OQ-1 = "gate pills") `app-mobile/src/components/PreferencesSheet/PreferencesSections.tsx` — route a locked pill tap to the paywall.

**Non-goals (explicitly OUT):**
- Do NOT change the `custom_starting_point` / GPS path (F-3: already correct).
- Do NOT change deck-level `curated_cards` gates (SwipeableCards / DiscoverScreen / SavedTab / CalendarTab) — all correct.
- Do NOT change the gate policy (`tierLimits.ts`, `useFeatureGate.ts`, `useSubscription.ts`). Curated stays Mingla+-only.
- Do NOT alter the `intentToggle` default (stays `true`) or the mutual-exclusion min-selection logic.
- Do NOT touch business apps, buyer-web, or admin-web.
- Do NOT present the paywall in read-only participant-view (`isEditable=false`) — preserve the existing `if (!isEditable) return` guard.

**Assumptions:** `canAccess('curated_cards')` returns `false` for free and `true` for Mingla+ (proven, tierLimits.ts:22/30). The paywall (`CustomPaywallScreen`, feature `curated_cards`) renders correctly (CustomPaywallScreen.tsx:138).

---

## 3. Cross-Surface Impact Declaration

| # | Surface | Covered? | User-visible behavior demanded | Files touched here | Parity |
|---|---|---|---|---|---|
| 1 | Consumer iOS (`app-mobile/` iOS) | **YES** | Free user interacting with the curated section sees the lock banner + gets the Mingla+ paywall | `PreferencesSheet.tsx` (+ `PreferencesSections.tsx` if OQ-1=pills) | Automatic (shared JS) |
| 2 | Consumer Android (`app-mobile/` Android) | **YES** | Identical to iOS | same | Automatic (shared JS — no per-platform branch in affected code) |
| 3 | Buyer/anon Web (`mingla-business/`) | NO | Does not render the consumer preferences sheet | — | — |
| 4 | Business iOS | NO | Consumer-only component | — | — |
| 5 | Business Android | NO | Consumer-only component | — | — |
| 6 | Admin Web (`mingla-admin/`) | NO | No consumer feature-gate | — | — |
| 7 | Business Web preview | NO | Consumer-only component | — | — |

Parity is AUTOMATIC across iOS + Android (single shared file, no platform fork), so success criteria are NOT split per-platform — but the TEST phase must still verify on both an iOS sim and an Android emulator/device (Prime Directive live-fire).

---

## 4. Layered specification

Only the Component layer is touched. No DB / edge / service / hook / realtime change.

### 4.A Component — `PreferencesSheet.tsx` (MANDATORY, unambiguous)

**Change 1 — wire the gate (fixes F-1). Line 1279.**
```
- isCuratedLocked={false}
+ isCuratedLocked={!canAccess('curated_cards')}
```
Effect: for a free user (`canAccess('curated_cards') === false`), `isCuratedLocked` becomes `true` → the lock banner (`PreferencesSections.tsx:57-68`) renders → its existing `onPress={onLockedTap}` (already wired to `setPaywallFeature('curated_cards'); setShowPaywall(true)`, lines 1280-1284) becomes reachable. For Mingla+, `isCuratedLocked` is `false` — banner hidden, section fully interactive (unchanged from today). `ExperienceTypesSection`'s memo comparator already includes `prev.isCuratedLocked === next.isCuratedLocked` (PreferencesSections.tsx:118), so tier changes re-render correctly.

**Change 2 — gate the intent Switch handler (fixes F-2), respecting the default-ON wrinkle (F-4). `handleIntentToggleChange`, lines 610-617.** When the section is locked, a Switch tap must present the paywall instead of mutating state:
```
const handleIntentToggleChange = useCallback((newValue: boolean) => {
  if (!isEditable) return;
  if (!canAccess('curated_cards')) {          // ORCH-1314: locked free user → paywall, never silent flip
    setPaywallFeature('curated_cards');
    setShowPaywall(true);
    return;
  }
  if (!newValue && !categoryToggle) {
    toastManager.warning(t('preferences:experience_types.min_message'), 2000);
    return;
  }
  setIntentToggle(newValue);
}, [categoryToggle, isEditable, t, canAccess]);
```
Add `canAccess` to the dependency array. (This makes the Switch itself a paywall entry point in addition to the banner — important because the section is ON by default, so the banner + a tap on the always-visible Switch are the reachable entry points.)

**Change 3 (CONDITIONAL on OQ-1 = "gate pills"; RECOMMENDED default) — gate experience-type pill taps.** Pass the locked state down and route a locked pill tap to the paywall rather than selecting. Preferred implementation: intercept in the parent handler `handleIntentToggle` (lines 556-575) so the child stays presentational:
```
const handleIntentToggle = useCallback((id: string) => {
  if (!isEditable) return;
  if (!canAccess('curated_cards')) {          // ORCH-1314: locked pill tap → paywall
    setPaywallFeature('curated_cards');
    setShowPaywall(true);
    return;
  }
  ... existing select/deselect logic ...
}, [categoryToggle, isEditable, canAccess]);
```
If OQ-1 resolves to "banner-only" (minimum), Change 3 is omitted.

**DO NOT** modify the `custom_starting_point` block (lines 1181-1206, 293-299) or any deck gate.

### 4.B Component — `PreferencesSections.tsx` (only if OQ-1 = "gate pills" AND the implementor chooses the child-side variant)

If gating is done in the child instead of the parent, guard `handlePress` (lines 46-49) on a new `isCuratedLocked` check that calls `onLockedTap?.()` and returns. The parent-side variant in 4.A Change 3 is preferred (keeps the child presentational, no new prop). Pick ONE, not both.

---

## 5. Success criteria (numbered, observable, testable)

- **SC-1:** Given a **free-tier** user with the preferences sheet open, the "See curated experiences?" section renders the lock banner with text `experience_types.curated_locked` ("Curated cards are locked on Free — upgrade to explore them"). *(Wired by Change 1.)*
- **SC-2:** Given a **free-tier** user, tapping the curated lock banner presents `CustomPaywallScreen` with `feature='curated_cards'` (header "Unlock Curated Experiences"). *(Already wired; reachable after Change 1.)*
- **SC-3:** Given a **free-tier** user, tapping the "See curated experiences?" **Switch** presents the `curated_cards` paywall and does NOT mutate `intentToggle`. *(Change 2.)*
- **SC-4 (conditional, OQ-1=pills):** Given a **free-tier** user, tapping any experience-type pill (Romantic, First Date, …) presents the `curated_cards` paywall and does NOT add/remove the intent. *(Change 3.)*
- **SC-5:** Given a **Mingla+** user, the curated section shows NO lock banner and the Switch + pills behave exactly as today (toggle flips, pills select, no paywall). *(Regression guard — `isCuratedLocked=false` for Mingla+.)*
- **SC-6:** Given **read-only participant view** (`isEditable=false`, viewing another user's picks), NO paywall is presented on any curated interaction. *(Existing `if (!isEditable) return` guard preserved.)*
- **SC-7:** The `custom_starting_point` / GPS gate behavior is byte-unchanged (paywall still presents on GPS-off for free users). *(Non-regression of F-3.)*

---

## 6. Invariants

**Preserves:** no existing invariant is touched.

**Establishes (NEW — DRAFT; orchestrator flips ACTIVE at CLOSE):**

### I-PROPOSED-1314-PREFERENCES-PAYWALL-GATE-REACHABLE (DRAFT)
- **Rule:** Every paywall-gated toggle/section in `app-mobile/src/components/PreferencesSheet.tsx` MUST route a locked free-user interaction to `setShowPaywall(true)` via the real `!canAccess(<feature>)` signal. No paywall trigger in the sheet may be wired to a hardcoded `false` or otherwise-dead condition. Specifically: the curated section's `isCuratedLocked` prop MUST be `!canAccess('curated_cards')` (never the literal `false`), and `handleIntentToggleChange` MUST short-circuit to the `curated_cards` paywall when `!canAccess('curated_cards')`. The read-only (`!isEditable`) guard MUST be preserved so participant-view never triggers the paywall.
- **Enforcement:** the regression test in §9 (source-structure + behavioral-model, `--self-test`), wired into the app-mobile test suite. (A strict-grep gate is optional; the §9 test is the required fails-on-revert safeguard.)
- **Fails-on-revert:** reverting line 1279 to `isCuratedLocked={false}`, or removing the `!canAccess('curated_cards')` short-circuit from `handleIntentToggleChange`, fails the §9 test (exit 1).
- **Established:** DRAFT at SPEC; flips ACTIVE at ORCH-1314 CLOSE.

---

## 7. Test cases

| Test | Scenario | Input | Expected | Layer |
|---|---|---|---|---|
| T-1 (happy) | Free user, banner reachable | `canAccess('curated_cards')=false` | `isCuratedLocked` resolves `true` → banner renders; source pins `isCuratedLocked={!canAccess('curated_cards')}` | Component/source |
| T-2 (happy) | Free user taps Switch | `canAccess=false`, tap toggle | decision model returns `{showPaywall:true, feature:'curated_cards'}`; `intentToggle` unchanged | Behavior model |
| T-3 (error/guard) | Read-only participant view | `isEditable=false`, tap | NO paywall (`showPaywall:false`) | Behavior model |
| T-4 (edge) | Mingla+ user | `canAccess=true`, tap toggle | no paywall; `intentToggle` flips normally; `isCuratedLocked=false` | Behavior model |
| T-5 (conditional) | Free user taps a pill (if OQ-1=pills) | `canAccess=false`, tap pill | `{showPaywall:true, feature:'curated_cards'}`; intents unchanged | Behavior model |
| T-6 (non-regression) | GPS gate intact | `canAccess('custom_starting_point')=false`, tap GPS-off | paywall `custom_starting_point` still presents | Source (untouched) |

---

## 8. Implementation order

1. `PreferencesSheet.tsx` line 1279 — Change 1 (wire `isCuratedLocked`).
2. `PreferencesSheet.tsx` lines 610-617 — Change 2 (gate `handleIntentToggleChange` + add `canAccess` dep).
3. (If OQ-1=pills) `PreferencesSheet.tsx` lines 556-575 — Change 3 (gate `handleIntentToggle`).
4. Add the regression test (§9).
5. Run typecheck + the new test; prove fails-on-revert (§9).

---

## 9. Regression prevention (fails-on-revert contract)

**Structural safeguard:** a single Node-assert test file, following the two live conventions — `orch-0943-prefs-apply-coord-coherence.test.tsx` (source-structure `readSource` + `assert.match`) and `PairingPaywall.orch1239.test.tsx` (behavioral decision-model harness). File: **`app-mobile/src/components/__tests__/orch-1314-preferences-curated-paywall-gate.test.tsx`** (append-only; new file).

**Part A — source-structure pins (catch the exact revert):**
- `assert.match(prefsSrc, /isCuratedLocked=\{!canAccess\('curated_cards'\)\}/)` — the gate is wired.
- `assert.doesNotMatch(prefsSrc, /isCuratedLocked=\{false\}/)` — the dead literal is gone.
- Assert `handleIntentToggleChange`'s body contains a `!canAccess('curated_cards')` short-circuit that calls `setShowPaywall(true)` with `setPaywallFeature('curated_cards')` BEFORE `setIntentToggle`.

**Part B — behavioral decision-model (mirrors the fixed handler logic):**
```
function resolveCuratedToggleTap({ isEditable, canAccessCurated }) {
  if (!isEditable) return { showPaywall: false };
  if (!canAccessCurated) return { showPaywall: true, feature: 'curated_cards' };
  return { showPaywall: false, mutated: true };
}
```
Asserts T-2 (free → paywall, not mutated), T-3 (read-only → no paywall), T-4 (Mingla+ → mutated, no paywall). If OQ-1=pills, add the symmetric `resolveCuratedPillTap` for T-5.

**Fails-on-revert requirement (MANDATORY):** the implementor MUST demonstrate the test **FAILS** when line 1279 is reverted to `isCuratedLocked={false}` (Part A `assert.match` fails / `doesNotMatch` fails) AND when the `handleIntentToggleChange` short-circuit is removed (Part A body assert + Part B T-2 fail), and **PASSES** when restored. Include a protective comment at the top naming ORCH-1314 and the "why" (dead `isCuratedLocked={false}` made the curated paywall unreachable).

**`--self-test`:** the file runs standalone via `require.main === module` (matching both templates) so CI can invoke it directly.

---

## 10. Open questions (need Seth / DESIGN — do NOT silently resolve)

- **OQ-1 (product/UX — the free-user interaction model):** The curated section is **ON by default** (`intentToggle=true`), so there is no "turn-on → paywall" moment; the built-but-disconnected design used a persistent lock banner. Choose the intended free-user experience:
  - **(a) Banner-only (MINIMUM):** wire `isCuratedLocked` (Change 1) + gate the Switch (Change 2). Banner + Switch tap open the paywall; the pills stay tappable (informational upsell, consistent with "free users can VIEW curated cards"). Smallest change.
  - **(b) Banner + pills-gated (RECOMMENDED):** (a) plus Change 3 — any tap on the section (banner, Switch, or a pill) opens the paywall. Most closely matches "when a user clicks the toggle, the paywall does not show up" → after fix, every interaction shows it.
  - **(c) Locked-switch visual:** additionally render the Switch in a visibly-locked state (lock glyph, like the GPS row). Pure DESIGN polish — route through mingla-designer if Seth wants it.
  Forensics recommends **(b)**. This is a real product call because free users are documented to VIEW curated cards (they only hit the paywall on SAVE at the deck level) — so whether the preferences section should hard-block interaction or merely upsell is Seth's decision.
- **OQ-2 (which toggle Seth meant):** Evidence overwhelmingly points to Toggle A (curated). Toggle B (GPS) is proven correct. If Seth actually meant the GPS toggle, re-open — but source shows GPS already presents the paywall.

---

## 11. Downstream routing

- **Allowlist (implementor may modify ONLY):** `app-mobile/src/components/PreferencesSheet.tsx`; `app-mobile/src/components/PreferencesSheet/PreferencesSections.tsx` (only if OQ-1=pills AND child-side variant chosen); new test `app-mobile/src/components/__tests__/orch-1314-preferences-curated-paywall-gate.test.tsx`.
- **DO-NOT-TOUCH:** `PreferencesSectionsAdvanced.tsx`, `ToggleSection.tsx`, `useFeatureGate.ts`, `useSubscription.ts`, `tierLimits.ts`, `CustomPaywallScreen.tsx`, `SwipeableCards.tsx`, `DiscoverScreen.tsx`, `SavedTab.tsx`, `CalendarTab.tsx`, all i18n files, the `custom_starting_point` code paths. Anything outside the allowlist → stop-and-amend (SPEC amendment), never silently widen.
- **Next phase:** orchestrator REVIEW → **DESIGN only if OQ-1 needs a visual decision (option c)** → IMPLEMENT (mingla-implementor) → TEST (mingla-tester — free-tier live-fire on iOS sim + Android, verify SC-1..SC-7) → CLOSE (flip I-PROPOSED-1314 ACTIVE, reap worktree).
- **Working tree:** `~/Desktop/mingla-orchs/orch-1314-[preferences-curated-paywall-dead-gate]/` on branch `orch-1314-preferences-curated-paywall-dead-gate`.
