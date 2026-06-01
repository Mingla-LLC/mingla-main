# SPEC — ORCH-1029 [Coach-mark cross-device fixes]

**Mode:** SPEC (forensics) · **Type:** targeting/sequence logic fixes (no visual redesign)
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1029-[coach-mark-cross-device-qa]/` · **Branch:** `ORCH-1029-coach-mark-cross-device-qa`
**Date:** 2026-05-31 · **Author:** Claude `mingla-forensics`
**Surfaces:** Consumer iOS + Consumer Android (`app-mobile/`) only.
**Input investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-1029_COACH_MARK_CROSS_DEVICE.md` (`proven`, 4 devices / 2 platforms) + `Mingla_Artifacts/reports/orch_1029_screenshots/`.

---

## 0. Comms ledger

Read `COMMS_LEDGER.md` on entry. No OPEN `BLOCK`/`WARN`/`FYI` row is addressed to ORCH-1029, `mingla-forensics`, or `ALL` that bears on this coach-mark surface. COMMS-0006 (the only BLOCK) is ACKNOWLEDGED and scoped to ORCH-0980. The standing `ALL` rows (COMMS-0003 external-API-docs, COMMS-0004 ID-double-book, COMMS-0002 backend strict-grep) are N/A here — this ORCH touches no external API, no new backend file/migration, and the ORCH-ID is already registered. Nothing to ack. No cross-ORCH discovery requiring a new COMMS row; all changes are self-contained in the consumer coach-mark module.

---

## 1. Scope, non-goals, assumptions

### Scope
Four targeting/sequence fixes to the consumer coach-mark tour:

- **F-2 (OPERATOR-LOCKED, do first):** delete steps 4 ("Better together") + 5 ("Back to solo"). Tour goes **9 → 7 steps**.
- **F-1:** make step 1 ("Meet your deck") deterministically spotlight the deck — gate step-1 activation on the deck target being measured/rendered, not a timer.
- **F-3:** make step 8 (now step 6, "Your rules"/Account Settings) deterministically land on the Account Settings row — measurement-gate the scroll-offset read, not a timer.
- **F-4:** correct the Android-15 edge-to-edge status-bar Y over-compensation (~14dp high) without regressing the ORCH-0688 case the correction exists for.

### Non-goals (explicitly NOT in this spec)
- **No visual redesign.** Bubble styling, scrim color, glow, typography, spacing tokens in `SpotlightOverlay.tsx` are untouched. This is positioning/sequence logic only. (Designer is NOT required — see §11.)
- **No copy rewrite.** Deleting steps 4/5 does not change any *remaining* step's copy (each remaining step's title/description is self-contained and references a present affordance — verified §4.F-2). If during implementation any remaining copy reads oddly post-renumber, **flag it for the orchestrator — do NOT rewrite it here.**
- **F-5 (scrim-coverage gap on undefined/fullscreen targets):** addressed *incidentally* by F-1 (step 1 will no longer fall through to the undefined/fullscreen path) but the generic "any future unmeasured target degrades silently" hardening is **deferred** — the F-1 deterministic gate + the §10 regression CI assertion cover the concrete recurrence vector.
- **F-7 (coach bubble buttons absent from the iOS a11y tree / VoiceOver):** **deferred to a separate a11y ORCH** (out of scope per dispatch; register follow-up).
- **F-6 (stale "8-step" header comment):** corrected as a free side-edit (the header comment is rewritten to "7-step variant" as part of F-2), but it is an observation, not a behavioral fix.
- No DB/schema/RLS/edge-function changes. `profiles.coach_mark_step` is untouched; `TOUR_COMPLETED` is *derived* from `COACH_STEP_COUNT` and self-adjusts (see §3.F-2).
- No new dependency.

### Assumptions
- A-1: The investigation's per-step verdict matrix is correct and `proven` (live-fire, 4 devices). This spec builds on it without re-deriving.
- A-2: The repo's component-test convention is the **node-runnable source-static-analysis `__tests__/*.test.tsx`** file (e.g. `app-mobile/src/components/__tests__/orch-0995-bottom-nav-spotlight-ui-thread.test.tsx`): `// @ts-nocheck`, `require('node:assert/strict')`, reads target source as a string, asserts structure, self-runs via `require.main === module`. ORCH-1029 tests follow this convention at `app-mobile/**/__tests__/**` paths (dispatch HARD GUARD).
- A-3: `node` (no jest in `app-mobile`; `package.json` has no `jest` key) executes these tests directly. The implementor registers each new test as a `package.json` script `test:orch-1029*` (matching the `test:orch-NNNN` pattern lines 18-56) and the tester runs them by path.
- A-4: The step-counter i18n key is `{{current}} of {{total}}` with `total = COACH_STEP_COUNT` (`modals.json:112`), so "N of 7" renders automatically once `COACH_STEP_COUNT` becomes 7 — **no i18n edit needed.** Same for `guided_tour_label` (`modals.json:119`).

---

## 2. Cross-Surface Impact (MANDATORY)

| # | Surface | Covered? | Behavior the spec demands / why not |
|---|---------|----------|-------------------------------------|
| 1 | **Consumer iOS** (`app-mobile/` iOS) | YES | All four fixes apply. F-1 (deck gate), F-2 (7 steps), F-3 (step-6 Account Settings) are platform-agnostic; F-4 is a no-op on iOS (must stay a no-op — that is a success criterion). |
| 2 | **Consumer Android** (`app-mobile/` Android) | YES | F-1/F-2/F-3 identical to iOS (shared code, automatic parity). **F-4 is Android-specific** and must be verified on Android 15 edge-to-edge AND a pre-edge-to-edge Android (One UI / API ≤ 33) to prove no ORCH-0688 regression. |
| 3 | Buyer/anon Web (`mingla-business/`) | NO | No coach-mark tour exists on buyer web. |
| 4 | Business iOS (`mingla-business/`) | NO | No consumer coach-mark tour; business app has no `useCoachMark`/`SpotlightOverlay`. |
| 5 | Business Android (`mingla-business/`) | NO | Same as #4. |
| 6 | Admin Web (`mingla-admin/`) | NO | No coach marks rendered. |
| 7 | Business Web preview | NO | Same as #4/#5. |

**Parity note:** Surfaces 1 & 2 share one code path for F-1/F-2/F-3 → parity is **automatic**; one success criterion each suffices. **F-4 is manual per-platform** (Android-only code branch) → it carries platform-split success criteria (SC-4-Android-15, SC-4-Android-legacy, SC-4-iOS-noop).

---

## 3. Per-fix specification

> Layer touched by every fix: **Component/hook/context only** (`app-mobile/src/`). No DB, edge, service, RQ-hook, or realtime layer is involved. The "layer" column is therefore client-render logic throughout.

---

### F-2 — DELETE steps 4 & 5 (tour 9 → 7) 🔒 LOCKED

**Root cause (investigation F-2):** steps 4/5 describe the Solo/Together session switcher deleted by META-ORCH-0929 (`Home is solo-only`, per MEMORY.md). They have **zero** `useCoachMark(4|5)` registration anywhere → render the centered fallback over feature-less Home and misinform first-run users.

**Files + exact edits:**

1. **`app-mobile/src/constants/coachMarkSteps.ts`**
   - **Delete** the step-4 object (lines 43-49, `id:4` "Better together") and the step-5 object (lines 50-56, `id:5` "Back to solo") from the `COACH_STEPS` array.
   - **Renumber** the remaining trailing steps so ids are a contiguous `1..7` with **no gap**:
     - old `id:6` "Events, near you" → **`id:4`** (keep `tab:'discover'`, keep `bubblePosition:'center'`)
     - old `id:7` "Your people" → **`id:5`** (keep `tab:'connections'`)
     - old `id:8` "Your rules" → **`id:6`** (keep `tab:'profile'`)
     - old `id:9` "Tell us what works" → **`id:7`** (keep `tab:'profile'`, keep `buttonLabel:"You're set"`)
   - **Header comment (line 1-8):** change "Pass 2, 8-step variant" → "Pass 3, 7-step variant (ORCH-1029: steps 4/5 'Better together'/'Back to solo' deleted — META-ORCH-0929 made Home solo-only, that session switcher no longer exists)." This resolves F-6.
   - `COACH_STEP_COUNT = COACH_STEPS.length` (line 91) is unchanged and now evaluates to **7** automatically.

2. **`app-mobile/src/contexts/CoachMarkContext.tsx`** — audit every step-index/sequence assumption against the new id set `{1,2,3 (home), 4 (discover), 5 (connections), 6,7 (profile)}`:
   - **Line 56** `const TOUR_COMPLETED = COACH_STEP_COUNT + 1;` → derives to **8** automatically. No edit. (Comment at line 55 says "tour shrank from 10 to 8 steps" — update the comment to "9 → 7 steps" to avoid leaving a second stale doc string; behavior unchanged.)
   - **Line 63** `const SCROLL_STEPS = new Set([8, 9]);` → **MUST become `new Set([6, 7])`** (the Profile scroll-offset steps are now ids 6 & 7). This is the one **hard-coded literal that does NOT self-adjust** and is the highest-risk renumber miss. (Stale comment line 62 "Account Settings row (8) + Beta Feedback (9)" → "(6) + (7)".)
   - **Lines 166, 326, 340, 358, 381** use `COACH_STEP_COUNT` and `currentStep` comparisons — all relative, self-adjust. No edit.
   - **Lines 304, 311-316** comments reference "steps 11-12 / step 11 → 12" (already stale from an earlier tour) — leave behavior; optionally correct the comment to "the Profile scroll steps (6 → 7)". Cosmetic.
   - **`COACH_STEPS[currentStep - 1]`** array-index lookups (lines 329, 364) remain valid because ids are contiguous `1..7` and array order matches id order — **the renumber MUST preserve `id === arrayIndex + 1`** (this is why the deletion renumbers ids rather than leaving a `{1,2,3,6,7,8,9}` gap).

3. **`app-mobile/src/components/SpotlightOverlay.tsx`** — no edit. `isLastStep = currentStep === COACH_STEP_COUNT` (line 140) self-adjusts to 7; progress segments `Array.from({length: COACH_STEP_COUNT})` (line 322) self-adjusts to 7; counter is i18n `total: COACH_STEP_COUNT`. Verify only.

4. **Dangling-target audit (must produce zero hits):**
   - `grep -rnoE "useCoachMark\((4|5)[,)]" app-mobile/app app-mobile/src` → already empty (steps 4/5 never had registrations). After the renumber, confirm the NEW ids resolve: `useCoachMark(4` must now be the Discover header (was `useCoachMark(6)` at `DiscoverScreen.tsx:878`), `useCoachMark(5` the Connections header (was `useCoachMark(7)` at `ConnectionsPage.tsx:571`), and `registerTargetScrollOffset(6|7)` the Profile rows (were `(8)`/`(9)` at `ProfilePage.tsx:173,182`).
   - **THEREFORE the renumber is NOT confined to `coachMarkSteps.ts`** — the call sites that bind a target to a numeric id must be repointed in lockstep:
     - `DiscoverScreen.tsx:878` `useCoachMark(6...)` → `useCoachMark(4...)`
     - `ConnectionsPage.tsx:571` `useCoachMark(7,0)` → `useCoachMark(5,0)`
     - `ProfilePage.tsx:173` `registerTargetScrollOffset(8,...)` → `registerTargetScrollOffset(6,...)`
     - `ProfilePage.tsx:182` `registerTargetScrollOffset(9,...)` → `registerTargetScrollOffset(7,...)`
     - `HomePage.tsx:147-148` `useCoachMark(1...)` + `useCoachMark(2...)` → **unchanged** (ids 1,2 keep their numbers).
     - `app/index.tsx:142` `useCoachMark(3...)` (Likes tab) → **unchanged** (id 3 keeps its number).
   - **Post-edit invariant:** the set of `useCoachMark(<id>)` ∪ `registerTargetScrollOffset(<id>)` call-site ids MUST equal exactly `{1,2,3,4,5,6,7}` with no id missing and no id beyond 7. (Encoded as test T-02 + the §10 CI assertion.)

**Success criteria:**
- SC-2.1 🔒 `COACH_STEPS.length === 7`; ids are exactly `[1,2,3,4,5,6,7]`; no object has title "Better together" or "Back to solo".
- SC-2.2 🔒 `SCROLL_STEPS` deep-equals `new Set([6,7])`.
- SC-2.3 🔒 Every step's `id` equals its array index + 1 (contiguous, ordered).
- SC-2.4 🔒 Each remaining step has a live target registration: ids {1,2,3,4,5} via `useCoachMark`, ids {6,7} via `registerTargetScrollOffset`; zero ids registered that aren't in `COACH_STEPS`.
- SC-2.5 🔒 Every bubble renders "N of 7" and the progress bar has 7 segments (consequence of `COACH_STEP_COUNT`).
- SC-2.6 🔒 No remaining step's `title`/`description` string is altered by this change (copy frozen — non-goal).

---

### F-1 — Step 1 deck spotlight: gate activation on a measured deck target (deterministic, not timer) 🔒 LOCKED mechanism / 🎨 OPEN signal-plumbing detail

**Root cause (investigation F-1):** `coachDeckRef` attaches at `SwipeableCards.tsx:2298`, which is **after** the `if (!currentRec) return null;` guard (line 2288) and after the `INITIAL_LOADING`/`MODE_TRANSITIONING` "Curating lineup" skeleton branch (lines 1924-1939). On first run the tour fires while the deck is still curating → ref unattached → `measureInWindow` never runs → `targetMeasurements.get(1) === undefined` → `SpotlightOverlay` renders the centered fallback with **no cutout** (iOS), or on a warm Android deck `measureInWindow` returns a near-fullscreen rect `{0,2,448,879}` → whole-screen cutout = no spotlight. The existing `rAF` (`useCoachMark.ts:55`) + `100ms` re-measure (`:62`) is a timer, and it does not reliably catch the cold-deck case (`proven` on 3 iOS devices + Android).

**Deterministic mechanism (LOCKED):** Step 1 must not present its cutout until the deck target has produced a **valid, non-fullscreen** measurement. Two parts:

**Part A — Surface a deterministic "deck measured" signal (not a timer).**
The deck wrapper at `SwipeableCards.tsx:2298` only mounts in the `LOADED`/`currentRec` render path. Add an explicit ready signal that fires the FIRST time `coachDeckRef`'s node measures a real card-sized rect:
- In **`useCoachMark.ts`**, the `measure()` callback already early-returns on `width===0 && height===0` (line 33). Extend it: when `stepId === 1` and a **valid** measurement is registered, the context is told "step-1 target is ready." Mechanism: `registerTarget(stepId, rect)` already writes the rect into `targetMeasurements` (a `Map`). Add a companion `targetReady` boolean per step (or reuse map presence) that `SpotlightOverlay` and the activation gate read. **The signal is the existence of a valid measured rect in `targetMeasurements`, not elapsed time.**

**Part B — Gate the step-1 overlay on that signal + reject the fullscreen rect.**
1. In **`SpotlightOverlay.tsx`**, the `hasTarget` test (line 142) currently accepts ANY `width>0 && height>0` — including the Android whole-screen rect. Add a **fullscreen-rejection clamp**: a target is only a valid cutout if it is meaningfully smaller than the screen. Define `isPlausibleCutout(target)` = `target.width <= screenWidth * 0.96 && target.height <= screenHeight * 0.85` (the deck card is a tall-but-not-full silhouette; these thresholds reject the `{0,2,448,879}` whole-screen rect while accepting a real card). For step 1 specifically, an *implausible* (fullscreen) measurement is treated as **not-yet-ready**, NOT as a centered fallback — the overlay holds (keeps `overlayVisible` but renders nothing / a hold state) until a plausible rect arrives.
   - 🎨 OPEN: the exact hold presentation while waiting (brief dim with no bubble vs. delayed bubble fade-in) is the implementor's craft call, provided it does NOT show a misleading no-cutout "spotlight" and resolves to the real cutout within one render of the deck measuring.
2. In **`CoachMarkContext.tsx`**, the tour-start effect (lines 146-162) sets `setCurrentStep(1)` + `setOverlayVisible(true)` after a fixed `START_DELAY_MS = 1500`. **Keep the 1500ms entry delay** (it is a deliberate first-impression beat, not the bug) BUT make step-1's *cutout presentation* gate on the deck-ready signal from Part A. If the deck is still curating at the 1500ms mark, the overlay may appear but step 1 holds its cutout until the deck measures (Part B.1). When the deck transitions `INITIAL_LOADING → LOADED` and the ref attaches + measures a plausible rect, the cutout resolves deterministically on that measurement.
3. **Re-measure on deck-state transition (the deterministic trigger):** `useCoachMark.ts`'s active-step effect (lines 60-65) re-measures on `isActive` change via a `100ms` timer. Add a deterministic re-measure that fires when the **callback ref re-attaches** (i.e. when `SwipeableCards` transitions from the skeleton branch to the `LOADED` branch and mounts the `coachDeckRef` view). The callback-ref body (line 52-57) already runs `requestAnimationFrame(() => measure())` when a node attaches — this is the deterministic hook: when the deck finally renders, the node attaches, `measure()` runs, a plausible rect registers, and the gate (Part B) releases. **The fix is to make the gate *consume* this existing attach-driven measurement instead of presenting before it exists.** Keep `rAF`; remove reliance on the 100ms timer as the *primary* path for step 1 (it stays only as a redundant safety re-measure).

**Acceptance bar (LOCKED):** On a COLD first-run deck (deck still curating when the tour starts) AND a warm deck, on iOS and Android, step 1's cutout lands on the actual deck card (a plausible, non-fullscreen rect) with surrounding scrim — never a centered no-cutout bubble, never a whole-screen cutout.

**Success criteria:**
- SC-1.1 🔒 `SpotlightOverlay` exposes a fullscreen-rejection predicate: a target whose width > 96% of screen width OR height > 85% of screen height is NOT treated as a valid cutout for step 1.
- SC-1.2 🔒 Step 1 does not present a "no-cutout centered bubble" as its resting state on either platform; if the deck target is unmeasured/fullscreen, step 1 holds until a plausible rect arrives (gated on measurement, not on a timer).
- SC-1.3 🔒 When the deck transitions to `LOADED` and `coachDeckRef` attaches, the attach-driven `rAF` measurement registers a plausible rect and the step-1 cutout resolves on that measurement (deterministic, no fixed delay drives correctness).
- SC-1.4 🔒 The ORCH-0688 Android Y-correction still applies to the step-1 rect (F-1 fix must not bypass `useCoachMark.ts:46`).
- SC-1.5 🎨 OPEN: hold-state presentation while waiting for the deck (within the LOCKED constraint of SC-1.2).

---

### F-3 — Step 6 (was 8, Account Settings): measurement-gate the scroll-offset read 🔒 LOCKED

**Root cause (investigation F-3):** When the first Profile step activates, `scrollToKnownPosition(step)` (`CoachMarkContext.tsx:202-259`) reads `scrollTargetOffsetsRef.get(step)` after a single `TAB_NAVIGATE_DELAY_MS = 400` timer. But `ProfilePage.tsx:166-189` registers that offset only **800ms after Profile mounts** (a `setTimeout(…, 800)`). Profile mounts during the step-5→6 cross-tab transition, so for the FIRST Profile step the offset is usually not yet present → the `if (!scrollRef?.current || !offset)` branch (line 214) fires `scrollToEnd()` + registers **no synthetic measurement** → `target=undefined` → centered fallback AND the page over-scrolls to the footer. Step 7 (was 9) works only because Profile has been settled for seconds by then — proving it's a **mount-timing race**, not a missing ref.

**Deterministic mechanism (LOCKED) — gate the read on registration, do not race a timer:**

1. **`ProfilePage.tsx:166-189`** — remove the dependency on a fixed `800ms` for *correctness*. Register each Profile scroll offset as soon as the target node can be measured against `contentRef`, driven by a deterministic signal, not a blind `setTimeout(…, 800)`:
   - Replace the single fixed `800ms` effect with an `onLayout`-driven registration on the `accountSettingsRef` and `feedbackButtonRef` rows (or their wrapping views): on each row's `onLayout`, call `measureLayout(contentRef.current, …)` and `registerTargetScrollOffset(6|7, …)`. `onLayout` fires deterministically when the row has real bounds — no guessed delay. (Keep a one-shot guard so it registers once per mount; re-register on remount.)
   - 🎨 OPEN: whether to attach `onLayout` to the row itself or a thin wrapper `View` is the implementor's structural call, provided the measured rect is the Account Settings row (step 6) / Share Feedback button (step 7), measured relative to `contentRef`.

2. **`CoachMarkContext.tsx:202-259` (`scrollToKnownPosition`)** — make the offset read **await registration** instead of reading once after `TAB_NAVIGATE_DELAY_MS`:
   - Replace the "read once, fall back to `scrollToEnd` on miss" logic with a **bounded retry that polls `scrollTargetOffsetsRef.get(step)` until present** (e.g. up to N attempts at a short interval, total budget ~1.5s) OR — preferred — have `registerTargetScrollOffset` notify a pending waiter so the scroll fires the instant the offset registers. **The scroll + synthetic-measurement path must only run once a real offset exists; the `scrollToEnd` no-cutout fallback must NOT fire just because registration hasn't completed yet.**
   - Only if the offset genuinely never registers within the budget (true error, not a race) may the existing graceful fallback run — and even then it should NOT `scrollToEnd` to the footer; it should leave the page at top with a centered bubble (less wrong than dumping at the footer). 🎨 OPEN: exact retry budget/interval within the stated band, provided correctness comes from the offset being present, not from the timer length.
   - The synthetic measurement that places the cutout (lines 245-254) — including the ORCH-0688 Android `correctedY` — is preserved; it just now runs against a guaranteed-present offset.

**Success criteria:**
- SC-3.1 🔒 Step 6 ("Your rules") scrolls to and spotlights the **Account Settings row** (cutout present, `hasTarget` true), not the page footer, on first Profile entry — on iOS and Android.
- SC-3.2 🔒 The scroll/synthetic-measurement path runs only after `scrollTargetOffsetsRef.get(6)` is present; it is gated on registration, not on `TAB_NAVIGATE_DELAY_MS` or `800ms` elapsing.
- SC-3.3 🔒 Profile offset registration is driven by a deterministic layout signal (`onLayout`/`measureLayout` success), not a fixed `setTimeout(…, 800)`.
- SC-3.4 🔒 Step 7 (Share Feedback) continues to land correctly (no regression of the previously-working step).
- SC-3.5 🔒 The fixed `800` magic delay is removed from `ProfilePage.tsx` as the correctness mechanism (a short safety re-measure is allowed, but correctness must not depend on it).

---

### F-4 — Android-15 edge-to-edge status-bar Y over-compensation 🔒 LOCKED

**Root cause (investigation F-4, confidence `probable` on the exact delta):** `useCoachMark.ts:46` and `CoachMarkContext.tsx:246` add `StatusBar.currentHeight` to the measured/synthetic Y on Android (ORCH-0688) to convert the application-content frame to the application-window frame. On **Android 15 edge-to-edge** (`edgeToEdgeEnabled:true`, Expo SDK 54), `measureInWindow` already returns Y in (or close to) the window frame, so adding the full `StatusBar.currentHeight` **double-counts** the inset → cutout ~14dp too high, top in the status bar (`proven` render; the exact `StatusBar.currentHeight`-vs-needed-inset delta was the one un-isolated number).

**External grounding (cite at SPEC per COMMS-0003 spirit — RN/Expo platform behavior, not a remote API):**
- React Native `StatusBar.currentHeight` (Android only) — height of the status bar, but its relationship to the content frame **changes under Android edge-to-edge**, where the app draws behind the system bars and the status-bar region is no longer subtracted from the content frame: https://reactnative.dev/docs/statusbar#currentheight
- Android 15 (API 35) **enforces edge-to-edge by default** for apps targeting SDK 35; the system bars become part of the app window and insets must come from `WindowInsets`, not from a fixed status-bar height: https://developer.android.com/about/versions/15/behavior-changes-15#edge-to-edge
- `react-native-safe-area-context` `useSafeAreaInsets()` returns the resolved top inset from `WindowInsets` and is the edge-to-edge-correct source of the status-bar inset (already imported + used in `CoachMarkContext.tsx:3,69`): https://github.com/th3rdwave/react-native-safe-area-context#usesafeareainsets

**Deterministic mechanism (LOCKED):** Derive the Android correction from the **resolved safe-area top inset**, which is correct under both edge-to-edge and legacy, instead of the raw `StatusBar.currentHeight`. Two call sites must change identically:

1. **`CoachMarkContext.tsx:246`** — `insets` (from `useSafeAreaInsets()`) is already in scope (line 69). Replace:
   ```
   const correctedY = Platform.OS === 'android' ? exactScreenY + (StatusBar.currentHeight ?? 0) : exactScreenY;
   ```
   with a correction that uses the **safe-area top inset** as the authoritative Android offset (the value `WindowInsets` actually applied), e.g. `Platform.OS === 'android' ? exactScreenY + insets.top : exactScreenY`. This is correct on Android 15 edge-to-edge (insets.top = the real status-bar inset, no double-count) AND on legacy Android (insets.top resolves to the same status-bar height ORCH-0688 was correcting for). iOS branch stays a literal no-op.

2. **`useCoachMark.ts:46`** — this hook does **not** currently consume safe-area insets (`useSafeAreaInsets` is not imported here). Add `import { useSafeAreaInsets } from 'react-native-safe-area-context';`, read `const insets = useSafeAreaInsets();` inside `useCoachMark`, and replace the `StatusBar.currentHeight` term with `insets.top` in the same way. (`StatusBar` import may then be removable from this file if unused elsewhere — verify before removing.)

3. **Do NOT regress ORCH-0688:** the original ORCH-0688 failure was the cutout sitting on the *system clock* on a legacy Samsung One UI device because NO correction was applied. The fix here **keeps a positive Android correction**; it only changes the *source* of that correction from `StatusBar.currentHeight` to `insets.top` (the edge-to-edge-aware value). On legacy Android these two are equal or near-equal, so the ORCH-0688 case stays corrected. The implementor MUST verify on a legacy (pre-edge-to-edge, API ≤ 33 / One UI) Android that the cutout still lands on the target, not above it.

**Success criteria (per-platform — manual parity):**
- SC-4-Android-15 🔒 On Android 15 edge-to-edge, step 2's cutout is vertically centered on the Preferences button (top edge NOT inside the status bar; the system clock is NOT inside/beside the cutout). The ~14dp over-compensation is gone.
- SC-4-Android-legacy 🔒 On a pre-edge-to-edge Android (API ≤ 33 / Samsung One UI), the ORCH-0688 case still holds — cutout on the target, NOT on the system clock (no regression).
- SC-4-iOS-noop 🔒 The Android branch remains a literal no-op on iOS; iOS cutouts continue to land at their measured Y (steps 2/3 unchanged on iOS).
- SC-4.4 🔒 Both correction sites (`useCoachMark.ts` + `CoachMarkContext.tsx`) use the SAME inset source (`insets.top`) — they cannot drift.

---

## 4. Five-layer cross-check (post-fix expectation)

| Layer | Post-fix state |
|-------|----------------|
| Docs | `coachMarkSteps.ts` header → "7-step variant"; `CoachMarkContext.tsx:55` comment → "9 → 7"; F-6 resolved. |
| Schema | `profiles.coach_mark_step` unchanged. `TOUR_COMPLETED` derives to 8 from `COACH_STEP_COUNT=7`. Legacy-value normalization (lines 113-132) unchanged and still idempotent. |
| Code | `COACH_STEPS` is 7 contiguous steps; `SCROLL_STEPS={6,7}`; target call-site ids = {1..7}; step-1 gated on plausible measurement; step-6 gated on registered offset; Android correction = `insets.top`. |
| Runtime | Step 1 cutout on deck (cold + warm, both platforms); steps 4/5 gone; step 6 on Account Settings; Android-15 step-2 cutout on the button. |
| Data | Forced-tour repro (`coach_mark_step=0`) advances 0→1→…→7→8(complete); restore test accounts to 8 afterward. |

---

## 5. Invariants

**Preserved:**
- I-ORCH-0688-ANDROID-COACH-CORRECTION — a positive Android status-bar Y-correction MUST remain on both coach-mark cutout sites. F-4 preserves it (changes source `StatusBar.currentHeight` → `insets.top`, does not remove it). Verified by SC-4-Android-legacy + SC-4.4.
- I-COACH-STEP-ID-EQ-INDEX — every `COACH_STEPS[i].id === i + 1` (contiguous, ordered). F-2 preserves it via renumber. Verified by SC-2.3 / T-02.
- I-COACH-COUNT-DERIVED — `COACH_STEP_COUNT`, `TOUR_COMPLETED`, progress segments, and the i18n counter are all derived from `COACH_STEPS.length`; no hard-coded step count anywhere except the (now-fixed) `SCROLL_STEPS` literal. Verified by SC-2.5.
- I-COACH-SOLO-ONLY (META-ORCH-0929) — Home is solo-only; no coach step may describe a session switcher. F-2 enforces it by deleting the offending steps. Verified by SC-2.1.

**New (proposed, DRAFT → ACTIVE on CLOSE):**
- **I-PROPOSED-COACH-STEP-TARGET-COVERAGE** — every `COACH_STEPS` id (except steps explicitly flagged `bubblePosition:'center'` AND intentionally cutout-less) MUST have a matching `useCoachMark(<id>)` or `registerTargetScrollOffset(<id>)` call site; and no registration may reference an id absent from `COACH_STEPS`. This is the structural safeguard that would have caught F-2 at the META-ORCH-0929 deletion. Encoded as the §10 CI assertion + test T-03.
- **I-PROPOSED-COACH-CUTOUT-MEASUREMENT-GATED** — a coach step that owns a cutout MUST NOT present its resting cutout state until a plausible (non-fullscreen, non-zero) target rect is measured; presentation is gated on measurement, never on a fixed timer. Covers F-1 + F-3. Encoded as T-04 / T-05.

---

## 6. Test cases (Step-0.5 regression gate — HARD)

Per the dispatch HARD GUARD, this ORCH ships **two** node-runnable source-static-analysis tests at `app-mobile/**/__tests__/**` (convention A-2), each `fails-on-revert` meaningful, attacking **different angles**:

### Test 1 — IMPLEMENTOR happy-path (`app-mobile/src/components/__tests__/orch-1029-coach-mark-fixes.test.tsx`)

Reads `coachMarkSteps.ts`, `CoachMarkContext.tsx`, `SpotlightOverlay.tsx`, `useCoachMark.ts`, and the four call-site files as strings; asserts:

| Test | Asserts | Fails-on-revert because |
|------|---------|--------------------------|
| T-01 | `COACH_STEPS` has exactly 7 step objects; ids parse to `[1,2,3,4,5,6,7]`; the strings "Better together" and "Back to solo" do NOT appear in `coachMarkSteps.ts`. | Re-adding steps 4/5 or failing to renumber breaks the count/id assertion. |
| T-02 | `id === arrayIndex + 1` for all 7 (contiguous/ordered). | A `{1,2,3,6,7,8,9}` gap (deletion without renumber) fails. |
| T-03 | Across the four call-site files, the set of `useCoachMark(<id>)` ∪ `registerTargetScrollOffset(<id>)` ids equals `{1,2,3,4,5,6,7}` — specifically `DiscoverScreen` uses `useCoachMark(4`, `ConnectionsPage` uses `useCoachMark(5`, `ProfilePage` uses `registerTargetScrollOffset(6` + `registerTargetScrollOffset(7`. | Missing a call-site renumber (e.g. leaving `useCoachMark(6`) orphans a step and fails. |
| T-04 | `CoachMarkContext.tsx` `SCROLL_STEPS` literal is `new Set([6, 7])` (regex on the source). | The highest-risk renumber miss (`[8,9]`) fails loudly. |
| T-05 | `SpotlightOverlay.tsx` contains a fullscreen-rejection predicate for the cutout (regex for a width/height-vs-screen ratio guard, e.g. `screenWidth * 0.9` / `screenHeight * 0.8` band). | Reverting F-1's plausibility clamp (accepting the Android whole-screen rect) fails. |
| T-06 | Both correction sites use `insets.top` for the Android branch and NEITHER uses `StatusBar.currentHeight` as the additive correction term; `useCoachMark.ts` imports `useSafeAreaInsets`. | Reverting F-4 to `StatusBar.currentHeight` fails. |
| T-07 | `ProfilePage.tsx` no longer registers the Profile offsets via a bare `setTimeout(…, 800)` as the sole mechanism (assert the `800` magic correctness-delay is gone / an `onLayout`-driven registration exists). | Reverting F-3 to the 800ms race fails. |

### Test 2 — TESTER adversarial (`app-mobile/src/contexts/__tests__/orch-1029-coach-mark-adversarial.test.tsx`)

Attacks a **different angle** — the measurement-gating mechanics and the unmeasured-target / Android-inset edge cases, not the step-count surface:

| Test | Adversarial scenario | Asserts | Fails-on-revert because |
|------|----------------------|---------|--------------------------|
| AT-01 | "Unmeasured/fullscreen target must NOT present a misleading spotlight." | `SpotlightOverlay.tsx`: the branch that renders a cutout requires BOTH non-zero AND the plausibility predicate; the centered-fallback branch is NOT reachable for step 1 as a resting state (assert step-1 hold logic / plausibility gate, not a bare `width>0 && height>0`). | If F-1 regresses to `hasTarget = width>0 && height>0`, the Android fullscreen rect (or undefined → centered) slips through. |
| AT-02 | "Step-6 scroll must be gated on offset registration, not a fixed delay." | `CoachMarkContext.tsx` `scrollToKnownPosition`: the `scrollToEnd` no-cutout fallback is NOT the first action on a missing offset; there is a wait/retry/notify on `scrollTargetOffsetsRef.get(step)` before scrolling, and `scrollToEnd`-to-footer is not the miss path. | Reverting to "read once after 400ms → `scrollToEnd` on miss" fails (footer over-scroll returns). |
| AT-03 | "Android inset correction must be edge-to-edge-correct AND legacy-safe AND drift-free." | Both sites add a positive Android offset sourced from `insets.top` (not `StatusBar.currentHeight`), and the iOS branch is a no-op; the two sites reference the identical source token. | Removing the correction entirely (re-break ORCH-0688) OR keeping `StatusBar.currentHeight` (re-break Android-15) both fail; drift between the two sites fails. |
| AT-04 | "No orphaned coach step." | Mirror of the §10 CI assertion: every `COACH_STEPS` id has a target call site and no call site references an id ∉ `COACH_STEPS`. | A future deletion that orphans a step (the META-ORCH-0929 class of bug) fails here. |

Both tests self-run via `require.main === module` and are registered as `package.json` scripts `test:orch-1029` + `test:orch-1029-adv` (pattern matches lines 18-56). Live-fire device verification (the `proven` bar) is the tester's separate TEST-phase obligation per the investigation's device matrix — these static tests are the mechanical fails-on-revert floor, not a substitute for sim repro.

---

## 7. Implementation order

1. **F-2 first (operator-locked, cleanest):** edit `coachMarkSteps.ts` (delete 4/5 + renumber + header); update `SCROLL_STEPS=[6,7]` + comments in `CoachMarkContext.tsx`; repoint the four call sites (`DiscoverScreen` 6→4, `ConnectionsPage` 7→5, `ProfilePage` 8→6 & 9→7); run the dangling-target audit (§3.F-2.4). Confirm tour is 7 steps end-to-end before touching anything else.
2. **F-4:** smallest isolated change — swap `StatusBar.currentHeight` → `insets.top` at both sites; add the import in `useCoachMark.ts`.
3. **F-3:** `ProfilePage.tsx` `onLayout`-driven offset registration; `CoachMarkContext.tsx` `scrollToKnownPosition` offset-gated read.
4. **F-1:** `useCoachMark.ts` measurement signal; `SpotlightOverlay.tsx` plausibility clamp + step-1 hold; `CoachMarkContext.tsx` step-1 cutout gate.
5. Write + run both `__tests__` tests (Test 1, Test 2); register package scripts.
6. Tester live-fire on the §2 device matrix (cold + warm deck, Android-15 + legacy Android, iOS small + large).

---

## 8. Regression prevention

- **CI assertion (the META-ORCH-0929 safeguard, §10):** the orphan-step check (I-PROPOSED-COACH-STEP-TARGET-COVERAGE) wired into the test suite — a future UI deletion can't silently orphan a coach step again (the exact F-2 failure mode).
- **Measurement-gate invariant (I-PROPOSED-COACH-CUTOUT-MEASUREMENT-GATED):** encoded in T-04/T-05/AT-01/AT-02 so a revert to timer-based presentation fails CI.
- **Single inset source (SC-4.4):** both Android correction sites read `insets.top`, removing the drift vector.
- **Protective comments:** keep/extend the ORCH-0688 comment block at both sites, now noting the F-4 source change and *why* `insets.top` is edge-to-edge-correct (so a future dev doesn't "simplify" back to `StatusBar.currentHeight`).

---

## 9. Step-1 / step-6 measurement-gate — restating the deterministic guarantee

Neither F-1 nor F-3 may use "add a delay" as the fix. The deterministic triggers are:
- **F-1:** the `coachDeckRef` **callback-ref attach** (fires exactly when the deck leaves the curating skeleton and mounts the card view) → `rAF` `measure()` → plausible rect in `targetMeasurements` → gate releases. Correctness is bound to the measurement event, not a timer.
- **F-3:** the Profile row **`onLayout`** → `measureLayout` success → `registerTargetScrollOffset(6|7)` → the scroll/synthetic-measurement waiter releases. Correctness is bound to registration, not `400ms`/`800ms`.

Any remaining `setTimeout` is a non-load-bearing safety/animation beat, never the thing that makes the cutout land.

---

## 10. CI orphan-step assertion (spec text for the implementor)

Add (inside Test 1 or as a shared helper) an assertion that:
1. Parses `COACH_STEPS` ids from `coachMarkSteps.ts`.
2. Greps `useCoachMark(<n>` and `registerTargetScrollOffset(<n>` across `app-mobile/app` + `app-mobile/src`.
3. Asserts: every `COACH_STEPS` id appears in the call-site id set, AND every call-site id appears in `COACH_STEPS` (bijection), with the only allowed exception being a step explicitly tagged as intentionally cutout-less (none today — step 4/discover uses `bubblePosition:'center'` but STILL registers `useCoachMark(4)`, so it is covered).

This is the structural test the investigation's §10 called for.

---

## 11. Designer / copy flag

- **Designer NOT required:** this is targeting/sequence logic; no token, layout, color, motion, or state-copy surface changes. Per dispatch, designer is invoked only if removing steps 4/5 forces a copy change — it does not (§3.F-2.6, SC-2.6: remaining copy frozen).
- **Copy flag:** if, during implementation, any *remaining* step's copy reads oddly after the 9→7 renumber (it should not — each is self-contained), **flag the orchestrator, do not rewrite.**

---

## 12. Completion-condition self-check

1. Functional contract complete for every touched layer (component/hook/context — no DB/edge/service/RQ/realtime involved; explicitly stated). ✅
2. UI surface visual contract: NOT a visual change — non-goal §1; existing `SpotlightOverlay` styling frozen; no new visible surface introduced. The only render-logic change (plausibility clamp / hold) is specified behaviorally with the OPEN hold-presentation handed to the implementor. ✅
3. No external remote API touched (RN/Expo/Android platform behavior cited with URLs for F-4). No-AI-slop N/A (no new visual surface). ✅
4. Every requirement tagged 🔒 LOCKED / 🎨 OPEN; OPEN ceilings present for F-1 hold-state, F-3 wrapper-structure + retry-budget. ✅
5. Cross-Surface Impact present (§2); success criteria observable/testable/unambiguous; F-4 split per-platform (manual parity). ✅
6. Invariants named (4 preserved + 2 proposed); test cases happy (T-01..T-07) + adversarial (AT-01..AT-04) + edge; implementation order; regression prevention. ✅
7. Zero hand-wave: every "fix" has an exact file+line target and a named deterministic mechanism. ✅

**Spec status: COMPLETE.** Tour is **7 steps**. Ready for implementor dispatch.
