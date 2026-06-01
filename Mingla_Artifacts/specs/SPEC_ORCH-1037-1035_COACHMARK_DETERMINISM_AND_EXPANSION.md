# SPEC — ORCH-1037 [Coach-mark exact-target determinism FIX] + ORCH-1035 [Coach-mark content EXPANSION]

**Mode:** SPEC (no code; contract for the implementor)
**Date:** 2026-06-01
**Author:** mingla-forensics (Claude)
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1037-[coachmark-exact-target-determinism]/` on branch `ORCH-1037-coachmark-exact-target-determinism`
**Surface:** Consumer `app-mobile/` only — iOS + Android. NO deploy.
**Bundle:** Operator-approved single branch / single PR covering BOTH ORCHs.
**Input investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-1037_COACHMARK_EXACT_TARGET_DETERMINISM.md` (root causes proven on Pixel 8 Pro; iOS parity by shared-code inference).
**History:** `SPEC_ORCH-1029_COACH_MARK_FIXES.md` (9→7 steps, deck-spotlight hold, Profile scroll, Android inset) — lives in the reaped ORCH-1029 worktree; referenced for F-1/F-3 lineage only.
**Comms ledger:** Read on entry. No OPEN BLOCK/WARN row is addressed to `mingla-forensics`, this ORCH-ID, or `ALL` that bears on coach-marks. COMMS-0003 (external-API docs) is N/A — this spec touches no external API. No new cross-ORCH discovery to write.

---

## 0. CRITICAL PRE-WORK — WORKTREE IS STALE (HARD GATE, do this FIRST)

**Finding (proven this turn):** the branch `ORCH-1037-coachmark-exact-target-determinism` HEAD is `e944b0b20`, which equals the worktree's *local* `main` — but local `main` is **7 commits behind `origin/main` (`f4b3498c3`)**. The branch was cut from a pre-ORCH-1029 `main`, so its working tree carries the **stale 9-step** `coachMarkSteps.ts` and `SCROLL_STEPS = new Set([8, 9])`. The investigation, and this entire spec, are written against the **current `origin/main` 7-step state** (8 `id:` matches; `SCROLL_STEPS = new Set([6, 7])`; `targetVersion` present in `SpotlightOverlay`/`CoachMarkContext`), which is what the anchor checkout `~/Desktop/mingla-main` carries.

**Mandatory first implementor action (🔒 LOCKED):**
1. `git fetch origin && git rebase origin/main` (or merge) so the worktree picks up the ORCH-1029 7-step baseline BEFORE any edit. Resolve nothing by hand on coach-mark files — they should fast-forward cleanly (the branch has no coach-mark commits of its own).
2. After rebase, assert the baseline is the 7-step state:
   - `coachMarkSteps.ts` `COACH_STEPS.length === 7`, last id `7`, step 4 `tab:'discover'` `title:'Events, near you'` `bubblePosition:'center'`, step 5 `tab:'connections'`, steps 6/7 `tab:'profile'`.
   - `CoachMarkContext.tsx` `const SCROLL_STEPS = new Set([6, 7])`.
   - `SpotlightOverlay.tsx` consumes `targetVersion`.
3. If the rebase does NOT yield the 7-step baseline, STOP and flag the orchestrator — do not implement against the 9-step file.

All file:line references below are against the **current `origin/main`** (= anchor `~/Desktop/mingla-main`) tree.

---

## 1. Scope / Non-Goals / Assumptions

### Scope
- **Part A — Determinism FIX (ORCH-1037):** make every coach-mark cutout land on the EXACT intended element on every device, deterministically.
  - A-1: Settle-gated, measure-until-stable measurement in `useCoachMark.ts` (core systemic fix; applies to ALL non-scroll steps).
  - A-2: Re-point step 4 → Events tab `Pressable`; step 5 → people-icon `Pressable`.
  - A-3: Steps 6/7 — replace `contentY − scrollY` reconstruction with a real post-scroll `measureInWindow` of the actual row node; apply the same stable-gate.
  - A-4: Remove the stale "step 6" comment at `DiscoverScreen.tsx:1947`.
- **Part B — Content EXPANSION (ORCH-1035):** add 4 new steps (Trips, the + button, Your interests, Your circle), each with an exact ref + in-voice copy + tour position, using the SAME stable-measure mechanism. Final tour = 7 → **11 steps**.

### Non-Goals
- No redesign of the bubble, progress bar, or overlay scrim. (Progress bar + "N of M" derive automatically from `COACH_STEP_COUNT` — see §6.)
- No change to tour start/skip/persist logic, Mixpanel events, or the `coach_mark_step` DB column (other than the count growing 7→11, which `TOUR_COMPLETED = COACH_STEP_COUNT + 1` absorbs automatically).
- No change to the cutout pass-through tap behavior (Discovery #2 in the investigation; out of scope, register separately if desired).
- No fix for the iOS "Open Settings" notifications modal (investigation Discovery #1 — separate INTAKE).
- No backend / RLS / edge / business / admin work.

### Assumptions
- The 5 surfaces the new steps target (Trips tab, + button, Interests card, Your Circle card, plus the existing re-pointed Events tab + people icon) are all present on the current `origin/main` tree — verified file:line in §4.
- `measureInWindow` (used by steps 1-3, and the new mechanism) returns window-frame coordinates; the existing `ORCH-0688` Android `+ StatusBar.currentHeight` correction stays (it is correct for window-frame SVG mask painting).
- React Query / Zustand / navigation untouched.

---

## 2. Cross-Surface Impact (MANDATORY)

| # | Surface | Covered? | Behavior demanded | Files | Parity |
|---|---|---|---|---|---|
| 1 | Consumer iOS (`app-mobile/` iOS) | **YES** | All 11 steps land on the exact element; screenshot-verified on iOS small + iOS large. | All files in §7 | Shared code → automatic, but **each platform has its own success criterion** (SC-*-iOS / SC-*-Android) because the stable-measure timing + Android inset branch differ at runtime. |
| 2 | Consumer Android (`app-mobile/` Android) | **YES** | Same; screenshot-verified on Pixel 8 Pro. | All files in §7 | Manual per-platform verification required. |
| 3 | Buyer/anonymous Web | NO | Coach-mark tour is consumer-app-only; no web analog. |  |  |
| 4 | Business iOS | NO | No coach-mark tour in `mingla-business/`. |  |  |
| 5 | Business Android | NO | Same. |  |  |
| 6 | Admin Web | NO | No coach-mark tour. |  |  |
| 7 | Business Web preview | NO | Same. |  |  |

**Manual-parity note:** because the determinism bug manifests differently per platform (step-2 native-driver timing is cross-platform; the Android `StatusBar.currentHeight` inset branch is Android-only; scroll-settle timing varies by device), every success criterion in §8 is split SC-N-iOS / SC-N-Android, and the tester must screenshot **every step on iOS small + iOS large + Android** — NO sampling (operator-locked bar).

---

## 3. THE STABLE-MEASURE MECHANISM (core of Part A; consumed by Part B)

### 3.1 Problem recap (from investigation §D/§G)
`useCoachMark` measures at most twice — once on callback-ref attach via `requestAnimationFrame` (`useCoachMark.ts:55`) and once 100ms after `isActive` flips (`useCoachMark.ts:62`). Neither waits for animation/interaction settle, and neither re-measures until the rect is stable. Step 2's target (`GlassTopBar` Preferences icon) is a child of an `Animated.View` running `translateY −16 → 0` over 260ms with `useNativeDriver:true` (`GlassTopBar.tsx:107,127-131`; `designSystem.ts:690 showDurationMs:260, :692 showTranslateY:16`). The first measure catches `y ≈ 36`; a later incidental re-measure catches the settled `y ≈ 52` (Δ = 16 = `showTranslateY`). So the cutout paints 16px high, then self-heals — non-deterministic.

### 3.2 Design — `useCoachMark.ts` (🔒 LOCKED behavior; 🎨 OPEN tuning bands noted)

Replace the two-shot measure with a **settle-gated, measure-until-stable loop**. When a step becomes active (or its ref attaches while active), run this sequence inside `useCoachMark`:

**Step 1 — Interaction/animation settle gate (🔒 LOCKED).**
Before the first accepted measure, wait for interactions to finish:
```
InteractionManager.runAfterInteractions(() => { startStableMeasureLoop(); });
```
`runAfterInteractions` resolves only after running `Animated` interactions (including the GlassTopBar native-driver entrance) complete, so the first measure already lands post-settle in the common case. This is the gate, not the whole fix — the loop below guarantees stability even if a layout shifts after interactions resolve.

**Step 2 — Measure-until-stable loop (🔒 LOCKED).**
Poll `node.measureInWindow` and accept a rect ONLY when **two consecutive reads match within an epsilon**:
- `STABLE_EPSILON_PX = 1` (🔒 — a rect is "equal" to the previous when `|Δx| ≤ 1 && |Δy| ≤ 1 && |Δw| ≤ 1 && |Δh| ≤ 1`; sub-pixel measure jitter is tolerated, the 16px drift is not).
- Poll interval `STABLE_POLL_MS = 50` (🎨 OPEN: implementor may use 33–60ms; must be ≤ 60).
- On two consecutive matching reads → call `registerTarget(stepId, rect)` with the **stable** rect and STOP.
- A measure returning `width === 0 && height === 0` is treated as "not ready" (does NOT count toward the consecutive-match pair) — keep polling. (Current code early-returns on 0×0 at `useCoachMark.ts:33`; preserve that, but it must not terminate the loop.)
- Apply the existing `ORCH-0688` Android correction to the accepted rect: `y: Platform.OS === 'android' ? y + (StatusBar.currentHeight ?? 0) : y` (`useCoachMark.ts:46`). Keep verbatim — the comment block `:35-45` must stay.

**Step 3 — Timeout fallback (🔒 LOCKED, no infinite loop).**
- `STABLE_TIMEOUT_MS = 1200` (🎨 OPEN: 1000–1500 acceptable; must be ≥ 1000 to outlast the 260ms entrance + a slow device, and ≤ 1500 so a genuinely-unmeasurable target degrades fast).
- If the loop has not achieved two consecutive matches by `STABLE_TIMEOUT_MS`, register the **last non-zero rect measured** (best-effort) so the step still shows a cutout rather than hanging on the centered-bubble fallback. If NO non-zero rect was ever obtained, register nothing (the existing orphan-warning path at `useCoachMark.ts:69-81` and the SpotlightOverlay centered-bubble fallback handle it).
- The loop MUST cancel cleanly on unmount and on `isActive` flipping false (clear all timers/handles).

**Step 4 — Re-arm on re-entry (🔒 LOCKED).**
The loop re-runs every time `isActive` transitions to true (forward AND Back navigation) and every time the callback-ref re-attaches while active. This preserves the "Back lands correctly" behavior and makes first-show identical to post-Back.

**Determinism invariant (the whole point):** the cutout is painted from a rect that was confirmed stable across two consecutive post-settle measures (or the timeout best-effort). No step can paint from a single pre-settle/transient measure. This applies to EVERY non-scroll step — existing (1,2,3) AND new (Trips, + button) — so no current or future animated target can drift.

**🎨 OPEN (implementor craft):** the exact loop structure (recursive `setTimeout` vs `setInterval` vs rAF chain), whether to fold the existing 100ms activation timer into the loop or remove it, and the internal helper naming. The LOCKED contract is: settle-gate → two-consecutive-match within `STABLE_EPSILON_PX` → register stable rect; bounded by `STABLE_TIMEOUT_MS`; re-arm on re-entry; clean cancel.

### 3.3 Design — scroll steps (6, 7, and new Interests + Circle), `CoachMarkContext.tsx` + `ProfilePage.tsx`

**Problem recap (investigation §F):** `scrollToKnownPosition` (`CoachMarkContext.tsx:231-318`) reconstructs the screen-Y as `exactScreenY = offset.contentY − scrollY` then `+ insets`/`StatusBar` correction, where `offset` came from `measureLayout(content,…)` in `ProfilePage`. Live, steps 6 & 7 registered the **identical** `contentY = 399.3999987284342` and the cutout landed ~1 row low (step 7 on "View History" instead of "Share Feedback"). The reconstruction is fragile (depends on contentY being final, scrollY exact, conditional rows not shifting) and races (offset registered seconds late).

**New design (🔒 LOCKED):**
1. Keep the `onLayout → registerTargetScrollOffset` path ONLY as the signal that the row is mountable and to drive the programmatic scroll (we still need `contentY` to compute *how far* to scroll). Keep `scrollRef.current.scrollTo({ y: scrollY, animated: true })` to bring the row into view at ~35% from top (`CoachMarkContext.tsx:227-230`).
2. **After the scroll settles, do NOT reconstruct** `contentY − scrollY`. Instead perform a **real `measureInWindow` of the actual row node** (the same primitive steps 1-3 use), then feed that window rect through the SAME two-consecutive-match stable loop from §3.2 before `registerTarget`. This requires the row node ref to be reachable at the context layer; the implementor passes the node (or a measure callback) alongside the existing offset registration. **Mechanism choice (🎨 OPEN):** either (a) `ProfilePage` registers a `() => measureInWindow` thunk per scroll step that the context calls post-scroll-settle, or (b) the context holds the row `ref` (already available via `accountSettingsRef` / `feedbackButtonRef`) and measures it directly. Either way the registered rect MUST come from a post-scroll `measureInWindow` of the leaf row node, gated by the stable loop — NOT from arithmetic.
3. Drop the identical-`contentY` reconstruction math (`CoachMarkContext.tsx:245-246` `const exactScreenY = …; const correctedY = …`). The `ORCH-0688` Android window-frame correction is now applied by `measureInWindow`'s own window-frame result + the existing `useCoachMark`-style `+ StatusBar.currentHeight` branch (keep the branch on the measured Y, mirroring §3.2). The big comment block `:239-244` must be replaced with a comment explaining the new direct-measure approach + the retained Android branch.
4. **Tighten the registration window (🔒 LOCKED):** the multi-second `target=undefined` window (investigation: step 6 sat undefined ~8s, step 7 ~3-4s) must not recur. The overlay must not show a step's bubble before its cutout for a scroll step. Acceptance: from the moment a scroll step becomes active to the moment its stable cutout registers, the elapsed time on a warm device is ≤ `SCROLL_SETTLE_MS + STABLE_TIMEOUT_MS` and the overlay stays hidden (`setOverlayVisible(true)` fires only AFTER the stable rect registers — already the structure at `:255-256`, preserve and ensure the measure precedes the `setOverlayVisible(true)`).
5. `SCROLL_STEPS` grows from `{6,7}` to include the two NEW scroll steps (Interests + Circle) — see §5 for final numbering. The Set membership, the `scrollToKnownPosition` dispatch (`:183`, `:305`, `:370`), and the per-step offset registration must all be updated in lockstep (this is the exact failure ORCH-1029's header comment warns about).

**🎨 OPEN:** scroll target vertical placement (the `desiredScreenY = screenHeight * 0.35` factor may be tuned per-row so a tall card centers nicely vs a short row), and `SCROLL_SETTLE_MS` (currently 500; 400–600 acceptable).

---

## 4. EXACT TARGET ELEMENTS (file:line, against current `origin/main`)

### Existing (re-pointed or confirmed)
| Step intent | Current ref attach | NEW ref attach (LOCKED) | Notes |
|---|---|---|---|
| Deck (step 1) | `SwipeableCards` `cardContainer` via `HomePage.tsx:147,203` | unchanged | Full-width deck is intentional; `isPlausibleCutout` whitelists it. |
| Preferences icon (step 2) | `GlassTopBar.tsx:227` `<View ref={coachPrefsRef}>` wrapping `GlassIconButton iconName="options-outline"` via `HomePage.tsx:148,163` | unchanged ref; **fixed by stable-measure** | The element is correct; only the timing was wrong. |
| Likes tab (step 3) | bottom-nav Likes | unchanged | MATCH. |
| **Events tab (step 4)** | `DiscoverScreen.tsx:1949-1957` `coachDiscoverFeed.targetRef` on the whole `styles.headerPanel` | **the Events tab `Pressable` at `DiscoverScreen.tsx:2011`** (`tab.id === 'events'`) | Attach a per-tab coach ref to the Events `Pressable` only. Remove the ref from the header panel View (`:1950`). |
| **People icon (step 5)** | `ConnectionsPage.tsx:3309-3311` `coachChatHeader.targetRef` on the whole `styles.headerRowAbsolute` | **the people-icon `Pressable` at `ConnectionsPage.tsx:3317-3332`** (`onPress={openFriendsModal}`, `Icon name="people-outline"`) | **Operator-LOCKED:** step 5 = the in-page people icon, NOT the bottom-nav tab. Move the ref from `:3310` (header row) to the `Pressable` at `:3317`. |
| Account Settings (step 6) | `ProfilePage.tsx:509` `<View ref={accountSettingsRef} onLayout>` wrapping the Account Settings `SettingsRow` | unchanged ref node; **fixed by direct post-scroll measure** | The ref already wraps exactly the Account Settings row (`:510-517`). The node is correct; only the reconstruction math was wrong. |
| Share Feedback (step 7) | `ProfilePage.tsx:522` `BetaFeedbackButton` `feedbackButtonRef` → attached at `BetaFeedbackButton.tsx:52` on the **Share Feedback `TouchableOpacity`** (`:51-63`) | unchanged ref node; **fixed by direct post-scroll measure** | Confirmed: `feedbackButtonRef` is on the Share-Feedback button, NOT View History (`:65-72`). The "lands on View History" symptom is the reconstruction math, not a wrong node. Direct `measureInWindow` of this node fixes it. |

### New (Part B) — exact elements located this turn
| New step intent | EXACT target element (file:line) | Ref attach plan | Confidence |
|---|---|---|---|
| **Trips** | The Trips tab `Pressable` at `DiscoverScreen.tsx:2011` for `tab.id === 'trips'` (`TABS_1016` entry at `:933` `{ id:"trips", label: trips_tab "Trips", icon:"paper-plane-outline" }`) | Attach a per-tab coach ref to the Trips `Pressable` (sibling of the Events ref). Both tab `Pressable`s are rendered by the same `.map` at `:2008-2040`, so the implementor wires a small helper that attaches the right coach ref by `tab.id`. | **High** — exact element confirmed. |
| **The + button** | The + `Pressable` at `ConnectionsPage.tsx:3341-3355` (`styles.addButtonGlass`, `Icon name="add"`, `onPress → setShowFriendsActionChooser(true)`, a11y `friendsActionChooserPlusButtonA11y`). It opens `FriendsActionChooserSheet` (`:3871`) — the chooser that pairs a friend AND creates a group chat. The hint text "Tap + to pair" sits beside it (`:3375`). | Wrap the `Pressable` in `<View ref={coach…targetRef} collapsable={false}>` OR attach the coach ref to the `Pressable` directly. | **High** — exact element confirmed; this is the only + affordance on Connections (the relocated ORCH-0990 button). See §H product flag for tour-position nuance. |
| **Your interests** | The Interests `GlassCard` at `ProfilePage.tsx:466-473` (`<GlassCard variant="base"><ProfileInterestsSection …/></GlassCard>`). | `GlassCard` is a plain `React.FC` (no `forwardRef`), so wrap it in `<View ref={interestsRef} collapsable={false} onLayout={handleInterestsLayout}>` — the SAME pattern as `accountSettingsRef` at `:509`. Scroll step. | **High** — exact card confirmed. |
| **Your circle** | The Your-Circle `GlassCard` at `ProfilePage.tsx:476-478` (`<GlassCard variant="base"><YourCircleSection …/></GlassCard>`; section title "Your Circle" at `YourCircleSection.tsx:56`). | Wrap in `<View ref={circleRef} collapsable={false} onLayout={handleCircleLayout}>` (same pattern). Scroll step. | **High** — exact card confirmed. |

---

## 5. FINAL TOUR — step count, order, copy

**Final count: 11 steps (was 7).** Order is driven by tab (Home → Discover → Connections → Profile) and within-screen reading order, minimizing cross-tab fades. `COACH_STEP_COUNT` becomes 11; `TOUR_COMPLETED = 12` automatically.

| # | tab | title | description (Mingla voice) | buttonLabel | target (file:line) | mechanism | bubblePosition |
|---|---|---|---|---|---|---|---|
| 1 | home | Meet your deck | Swipe right to save, left to pass. Tap any card for the full story. | Got it | deck `cardContainer` | stable-measure | auto |
| 2 | home | Your taste, your rules | Dial in your vibe — categories, budget, distance. It's all here. | Got it | Prefs icon `GlassTopBar.tsx:227` | stable-measure | auto |
| 3 | home | Where your saves live | Every card you save lands in Likes. Scheduled plans too. | Got it | Likes bottom-nav tab | stable-measure | auto |
| 4 | discover | Events, near you | Concerts, shows, experiences — all within reach. | Got it | **Events tab `Pressable` `DiscoverScreen.tsx:2011`** | stable-measure | **auto** (was `center`; see §5.1) |
| 5 | discover | Trips, ready when you are | Weekend escapes, big adventures — plan the whole thing here. | Got it | **Trips tab `Pressable` `DiscoverScreen.tsx:2011` (`tab.id==='trips'`)** | stable-measure | auto |
| 6 | connections | Your people | Friends, requests, blocks — everything social lives here. | Got it | **people-icon `Pressable` `ConnectionsPage.tsx:3317`** | stable-measure | auto |
| 7 | connections | Pair up, plan together | Tap + to pair with a friend and start a shared group chat. | Got it | **+ button `ConnectionsPage.tsx:3341`** | stable-measure | auto |
| 8 | profile | Your interests | Tell us what you're into — your deck gets sharper every time. | Got it | **Interests card `ProfilePage.tsx:466`** | scroll + direct measure | auto |
| 9 | profile | Your circle | The people you plan with, all in one place. | Got it | **Your Circle card `ProfilePage.tsx:476`** | scroll + direct measure | auto |
| 10 | profile | Your rules | Privacy, notifications, language — all in Account Settings. | Got it | Account Settings row `ProfilePage.tsx:509` | scroll + direct measure | auto |
| 11 | profile | Tell us what works | Love something? Spot a bug? Tap here — we read every one. | You're set | Share Feedback button `BetaFeedbackButton.tsx:52` | scroll + direct measure | auto |

`SCROLL_STEPS` final = `new Set([8, 9, 10, 11])`.

**Order rationale:** Discover gets Events then Trips (left-to-right reading of the pill). Connections gets the people icon (top header) then the + button (below search) — top-to-bottom reading. Profile reads top-to-bottom of the bento stack: Interests (card 2) → Circle (card 3) → Account (card 5) → Share Feedback (card 6). This keeps each tab's steps in visual order so the spotlight walks down the screen naturally and no scroll jumps backward.

**Copy constraints (🔒 LOCKED — voice):** short headline + one supporting line; experience-app voice; em-dash cadence matching the existing steps; **NO dating language** (`.claude/skills/mingla-product/references/canonical-voice.md`). "Trips" copy frames travel/adventure (matches ORCH-1016's `paper-plane` travel reframing). "+ button" copy names BOTH outcomes the operator specified (pair a friend + start a shared group chat) without promising a feature that doesn't exist — the chooser does exactly this. **🎨 OPEN:** the implementor/operator may swap a synonym for tone, but the headline must stay ≤ 28 chars and the description ≤ ~70 chars to fit the bubble (existing steps fit this).

### 5.1 Step-4 `bubblePosition` (🔒 LOCKED decision)
The investigation (§E note) flagged that step-4's `bubblePosition:'center'` (`coachMarkSteps.ts:59`) is a band-aid for the too-broad header target. Now that step 4 targets the small Events pill, **remove the `center` override → `auto`**, so the bubble hugs the pill like every other small target. Delete the 3-line comment block at `coachMarkSteps.ts:56-58`. None of the 4 new steps use `center`.

---

## 6. Progress bar / "N of M" — auto-derivation (CONFIRMED)
- `SpotlightOverlay.tsx:378-388` renders the progress bar by `Array.from({ length: COACH_STEP_COUNT })` and the counter via `t('modals:spotlight.step_counter', { current: currentStep, total: COACH_STEP_COUNT })`. Growing `COACH_STEPS` to 11 makes `COACH_STEP_COUNT === 11` and both the 11-segment bar and "N of 11" counter update with **zero** further code change. (i18n key confirmed present in `app-mobile/src/i18n/locales/en|de/modals.json`.) No new translation keys needed (titles/descriptions are literals in `coachMarkSteps.ts`, consistent with existing steps).
- The accessibility label `guided_tour_label` also interpolates `{total}` → auto-updates.

---

## 7. Implementation Order (files, in sequence)
0. **Rebase onto `origin/main`** (§0) — HARD GATE.
1. `app-mobile/src/constants/coachMarkSteps.ts` — extend `COACH_STEPS` to the 11-step array in §5 order; remove step-4 `center` + its comment.
2. `app-mobile/src/hooks/useCoachMark.ts` — implement the settle-gated measure-until-stable loop (§3.2). This is the core, do it before re-pointing refs so every step inherits it.
3. `app-mobile/src/contexts/CoachMarkContext.tsx` — update `SCROLL_STEPS` to `{8,9,10,11}`; rewrite `scrollToKnownPosition` to direct post-scroll `measureInWindow` + stable loop (§3.3); update the same-tab/cross-tab `SCROLL_STEPS.has(...)` branches (`:183,:305,:370`).
4. `app-mobile/src/components/DiscoverScreen.tsx` — move the step-4 coach ref off the header panel (`:1950`) onto the Events `Pressable` (`:2011`); add the step-5 (now Trips) coach ref onto the Trips `Pressable`; wire a per-`tab.id` ref helper inside the `.map`. Remove the stale "step 6" comment at `:1947` (A-4).
5. `app-mobile/src/components/ConnectionsPage.tsx` — move the step-6 (people-icon) coach ref off `headerRowAbsolute` (`:3310`) onto the people `Pressable` (`:3317`); add the step-7 (+ button) coach ref onto the + `Pressable` (`:3341`). Update the `useCoachMark(5, 0)` call (`:572`) → new step number 6, and add a `useCoachMark(7, …)` for the + button (`targetRadius` ≈ 8 for the round button).
6. `app-mobile/src/components/HomePage.tsx` — step ids 1/2/3 unchanged (no renumber on Home).
7. `app-mobile/src/components/ProfilePage.tsx` — add `interestsRef` + `circleRef` with `onLayout` handlers (mirroring `handleAccountSettingsLayout` `:175`); wrap the Interests card (`:466`) and Your Circle card (`:476`) in measuring Views; renumber the existing Account Settings registration 6→10 and Feedback 7→11; register the two new scroll offsets for steps 8/9; supply the row node / measure thunk to the context per §3.3.
8. `app-mobile/src/components/BetaFeedbackButton.tsx` — only if the §3.3 mechanism choice needs the node exposed differently; otherwise unchanged (ref already on the Share-Feedback button).
9. Tests (§9): implementor happy-path + tester adversarial.

**Renumbering discipline (🔒 LOCKED):** because Home steps 1-3 keep their ids and Discover/Connections/Profile steps shift, EVERY `useCoachMark(stepId, …)` call site, every `SCROLL_STEPS` member, every `registerTargetScrollOffset(stepId, …)` arg, and every `COACH_STEPS` id must move in lockstep. Mismatched ids are the exact orphan-bug class ORCH-1029's comment warns about; the dev-time orphan warning (`useCoachMark.ts:69-81`) + the happy-path test (§9 T-01) catch a miss.

---

## 8. Success Criteria (observable, testable, per-platform)

Per-step exact-bounds criterion (operator-locked bar): **the painted cutout bounds match the EXACT target element's on-screen bounds (within `CUTOUT_PADDING`=4px + `STABLE_EPSILON_PX`=1px), verified by SCREENSHOT on iOS small + iOS large + Android (Pixel 8 Pro), for EVERY step — no sampling.**

- **SC-1 (stable measure):** For each of steps 1-7 (non-scroll), the registered rect equals two consecutive `measureInWindow` reads within 1px; step 2's rect is the SETTLED Preferences-icon rect (the `y≈52` value, NOT `y≈36`) on first show with no self-heal flash. _SC-1-iOS / SC-1-Android._
- **SC-2 (step 4 Events pill):** cutout hugs the Events tab `Pressable` only (width ≈ pill width, NOT `screenWidth`); bubble auto-positions (no `center`). _SC-2-iOS / SC-2-Android._
- **SC-3 (step 5 Trips pill):** cutout hugs the Trips tab `Pressable` only. _SC-3-iOS / SC-3-Android._
- **SC-4 (step 6 people icon):** cutout hugs the people-icon `Pressable` (`~22px` icon + hit area), NOT the full header row, NOT the bottom-nav tab. _SC-4-iOS / SC-4-Android._
- **SC-5 (step 7 + button):** cutout hugs the round + `Pressable`. _SC-5-iOS / SC-5-Android._
- **SC-6 (step 8 Interests):** after scroll-settle, cutout hugs the Interests card; registered from a post-scroll `measureInWindow`, not reconstruction; no multi-second no-cutout window. _SC-6-iOS / SC-6-Android._
- **SC-7 (step 9 Your Circle):** cutout hugs the Your Circle card. _SC-7-iOS / SC-7-Android._
- **SC-8 (step 10 Account Settings):** cutout hugs the Account Settings row (NOT one row low, NOT the gap below it). _SC-8-iOS / SC-8-Android._
- **SC-9 (step 11 Share Feedback):** cutout hugs the Share Feedback button (NOT View History). _SC-9-iOS / SC-9-Android._
- **SC-10 (count + progress):** progress bar shows 11 segments; counter reads "N of 11"; `TOUR_COMPLETED` writes 12 to `coach_mark_step` at finish; tour completes from step 1 → 11 → done. _SC-10-iOS / SC-10-Android._
- **SC-11 (Back parity):** tapping Back into any step re-runs the stable loop and lands on the same exact bounds as first show. _SC-11-iOS / SC-11-Android._
- **SC-12 (no regression):** returning users (`coach_mark_step != 0`) never see the tour; legacy-value normalization (`CoachMarkContext.tsx:113-132`) still maps to `TOUR_COMPLETED`=12.

---

## 9. Step-0.5 Test Requirements (BOTH mandatory; both fail-on-revert)

### (a) Implementor happy-path test (LOCKED)
A jest/RTL or mechanism test asserting:
- `COACH_STEPS.length === 11` and ids are contiguous `1..11`; each step's `tab` matches §5.
- The ref-target wiring is correct: a guard that each `useCoachMark(stepId,…)` call site uses the step id matching `coachMarkSteps.ts` (e.g. assert `DiscoverScreen` attaches step-4 ref to the Events `Pressable` and step-5 ref to the Trips `Pressable`; `ConnectionsPage` step-6 → people icon, step-7 → + button; `ProfilePage` steps 8/9/10/11 → Interests/Circle/Account/Feedback). Where a full render is impractical, a structural assertion (ref attached to the leaf affordance node, not a header container) plus a `SCROLL_STEPS` equality assertion (`=== new Set([8,9,10,11])`).
- The **two-consecutive-match stable-measure logic**: a unit test of the stable loop that feeds a mocked `measureInWindow` returning `{y:36}` then `{y:36}` → accepts `36`; returning `{y:36}` then `{y:52}` then `{y:52}` → accepts `52` (rejects the transient first read); returning only `{y:52}` once before timeout → accepts `52` via best-effort fallback.

### (b) Tester adversarial test (LOCKED)
- **Animation-mid-flight rect rejected:** mock the GlassTopBar entrance so the first `measureInWindow` returns the `−16` mid-slide Y and the second returns the settled Y; assert the registered rect is the SETTLED one (no 16px drift). Fails on revert to the two-shot measure.
- **Scroll-row measurement (not reconstruction):** assert steps 8-11 register a rect sourced from a post-scroll `measureInWindow` of the row node, and that two DIFFERENT scroll steps do NOT register the identical `contentY` (the investigation's `399.39999…` tell). Fails on revert to `contentY − scrollY`.
- **Wrong-node guard:** assert no step's registered rect has `width >= screenWidth * 0.98` except step 1 (deck) — catches a ref re-attached to a full-width header container. Extends the investigation's §M recommendation. Fails if step 4/5/6 are re-pointed back to a header container.

**Live-fire (tester, LOCKED bar):** screenshot every one of the 11 steps on iOS small + iOS large + Android (Pixel 8 Pro), driving the tour via Maestro/adb (Management API to set `coach_mark_step=0`), per the operator's no-sampling rule. Source-only PASS forbidden.

---

## 10. Invariants

**Preserved:**
- `I-COACH-DECK-HOLD` (ORCH-1029 F-1): step 1 holds until the deck measures a plausible rect; the stable loop must still release it (the loop registers a stable plausible rect → `targetVersion` bumps → overlay re-renders → hold releases). Verify step 1 still releases deterministically.
- `ORCH-0688` Android window-frame Y-correction: retained on every measured rect (non-scroll via `useCoachMark.ts:46`; scroll via the new direct-measure branch).
- One-owner-per-truth: `targetMeasurements` Map remains the single cutout-rect authority; `registerTarget` the single writer.

**New (DRAFT → ACTIVE on CLOSE):**
- `I-COACH-STABLE-MEASURE`: every painted cutout derives from a rect confirmed stable across two consecutive post-settle `measureInWindow` reads within `STABLE_EPSILON_PX` (or the bounded best-effort fallback). Mechanically tested by §9(b) animation-mid-flight test.
- `I-COACH-LEAF-TARGET`: each step's coach ref attaches to the specific leaf affordance the copy names, never a broad layout container (except step 1 deck). Tested by §9(b) wrong-node guard.
- `I-COACH-SCROLL-DIRECT-MEASURE`: Profile scroll steps register a post-scroll `measureInWindow` of the row node, never a `contentY − scrollY` reconstruction. Tested by §9(b) scroll-row test.

---

## 11. Regression Prevention
- The §9(b) wrong-node guard (`width < screenWidth*0.98` except step 1) is the structural safeguard against the steps-4/5 too-broad-container class.
- The §9(b) animation-mid-flight test is the structural safeguard against the step-2 measure-before-settle class.
- The §9(b) distinct-`contentY` assertion is the safeguard against the steps-6/7 reconstruction class.
- Protective comments: the new stable-loop in `useCoachMark.ts` carries a comment naming the step-2 16px drift + this ORCH; the rewritten `scrollToKnownPosition` carries a comment naming the identical-`contentY` symptom + the direct-measure replacement; the `coachMarkSteps.ts` header gains the 7→11 expansion note + the lockstep-renumber warning.

---

## 12. Product Flags for Operator (defaults proposed so implement isn't blocked)

1. **Step-7 "+ button" tour position (LOW ambiguity, default chosen):** the + button sits BELOW the search bar in the Connections content (`:3340`), which may be below the fold on first paint. **Default:** treat step 7 as a normal `useCoachMark` (non-scroll) step — the + row is near the top of the content (directly above search) and is typically on-screen when Connections mounts. IF live-fire shows it off-screen on a small device, promote it to a scroll step (add `7` to `SCROLL_STEPS`, register an offset). Implementor: verify on iOS small first; flag if it needs the scroll path. **No operator decision required unless live-fire shows it off-screen.**
2. **"Your interests" vs "Your circle" copy emphasis (LOW):** proposed copy in §5. Default stands; operator may tweak tone within the LOCKED length/voice limits.
3. **Trips copy (LOW):** "Trips, ready when you are / Weekend escapes, big adventures — plan the whole thing here." Default stands; matches ORCH-1016 travel framing.
4. **Step-5 referent (RESOLVED, no flag):** operator LOCKED step "people icon" → in-page people `Pressable` at `ConnectionsPage.tsx:3317`. NOT the bottom-nav tab. Encoded above.
5. **Step count growth 7→11 (FYI):** `coach_mark_step` semantics absorb it automatically; returning users unaffected. No migration.

---

## 13. References examined (premium-craft / voice)
- Mingla canonical voice: `.claude/skills/mingla-product/references/canonical-voice.md` (signature cadence, no-dating-language rule).
- Existing in-product coach copy (the 7 current steps) as the tone anchor.
- React Native `measureInWindow` + `Animated useNativeDriver` stale-coordinate behavior + `InteractionManager.runAfterInteractions` settle semantics: https://reactnative.dev/docs/interactionmanager , https://reactnative.dev/docs/animations (cited in the investigation §Sources).
