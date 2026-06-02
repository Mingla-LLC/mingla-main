# INVESTIGATION — ORCH-1037 [Coach-mark exact-target determinism]

**Mode:** INVESTIGATE (investigation only — NO fixes)
**Date:** 2026-06-01
**Investigator:** mingla-forensics (Claude)
**Symptom owner:** Seth — "7-step tour: multiple steps don't land on their exact element on Pixel 8 Pro + iOS; absolute determinism on all devices is required."
**Predecessor:** ORCH-1029 [Coach-mark fixes] (9→7 steps, deck-spotlight, Profile scroll, Android inset) — closed CONDITIONAL PASS; the "lands on exact element across devices" requirement was NOT met.
**Confidence:** **proven** (live-fire on Pixel 8 Pro emulator with per-step runtime rect measurements + screenshots; iOS step-1 confirmed live; remaining iOS parity inferred from shared cross-platform code — see §7 caveat).

---

## A. Symptom Summary

| | Expected | Actual (proven) |
|---|---|---|
| Step 2 "Your taste, your rules" | Cutout on the Explore Preferences/sliders icon (top-left) | Cutout **16px too high** on first show, **self-corrects ~2s later** (and on Back). |
| Step 4 "Events, near you" | Cutout on the **Events tab pill** only | Cutout covers the **entire Discover header panel** (title + Events/Trips tabs + Set-city/All/Tonight/Filter row). |
| Step 5 "Your people" | Cutout on the **Friends/people icon** | Cutout covers the **entire full-width Connections header row** (title + people icon). |
| Step 6 "Your rules" | Cutout on the **Account Settings row** | Cutout sits **~one row too low**, in the gap below Account Settings (above BETA TESTER). |
| Step 7 "Tell us what works" | Cutout on the **Share Feedback** button | Cutout sits on the **View History** button (one row too low) — "the feedback is off." |

Steps 1 and 3 land correctly (deck card; Likes bottom-nav tab).

---

## B. Investigation Manifest (files read in full)

| # | File | Why |
|---|---|---|
| 1 | `app-mobile/src/constants/coachMarkSteps.ts` | Step copy + intended targets + `bubblePosition`. |
| 2 | `app-mobile/src/hooks/useCoachMark.ts` | measureInWindow timing, Android Y-correction, re-measure triggers. |
| 3 | `app-mobile/src/contexts/CoachMarkContext.tsx` | step state machine, scroll-offset path, `registerTarget`, `scrollToKnownPosition`. |
| 4 | `app-mobile/src/components/SpotlightOverlay.tsx` | cutout math, `isPlausibleCutout` clamp, bubble positioning. |
| 5 | `app-mobile/src/components/HomePage.tsx` | step-1 (deck) + step-2 (prefs) call sites. |
| 6 | `app-mobile/src/components/GlassTopBar.tsx` | step-2 target wrapper + **entrance animation (translateY 16→0, native driver)**. |
| 7 | `app-mobile/src/components/DiscoverScreen.tsx` | step-4 ref attach point. |
| 8 | `app-mobile/src/components/ConnectionsPage.tsx` | step-5 ref attach point. |
| 9 | `app-mobile/src/components/ProfilePage.tsx` | step-6/7 scroll-offset registration + ref attach. |
| 10 | `app-mobile/src/constants/designSystem.ts` | `glass.chrome.motion.showTranslateY = 16` (timing-delta proof). |

External: React Native `measureInWindow` / `useNativeDriver` stale-coordinate behavior (see §6 sources).

---

## C. Per-Step Intended-vs-Actual Target Table (the headline deliverable)

Runtime rects are the **actual measured `TargetRect`** registered to `SpotlightOverlay`, captured live on the Pixel 8 Pro emulator (screen 448×~917 dp). `screenWidth = 448`.

| Step | Copy | INTENDED element (from copy) | ACTUAL ref attach (file:line) | Measured rect (live) | Verdict |
|---|---|---|---|---|---|
| 1 | "Meet your deck" | The deck card | `SwipeableCards.tsx:2298` `<View ref={coachDeckRef} …cardContainer>` (via `HomePage.tsx:147,203` `useCoachMark(1,36)`) | `{x:0,y:2,w:448,h:879}` (full-width card) | **MATCH** (intentional full-width deck) |
| 2 | "Your taste, your rules" | Explore Preferences/sliders icon (top-left) | `GlassTopBar.tsx:227` `<View ref={coachPrefsRef}>` wrapping `GlassIconButton iconName="options-outline"` (via `HomePage.tsx:148,163` `useCoachMark(2,20)`) | first `{x:16,**y:36.3**,w:44,h:44}` → settles `{x:16,**y:52.3**,w:44,h:44}` | **MISMATCH — timing** (right element, wrong Y on first show; Δ=16px) |
| 3 | "Where your saves live" | Likes bottom-nav tab | bottom-nav Likes (rect bottom-of-screen) | `{x:265,y:903,w:83,h:59}` | **MATCH** |
| 4 | "Events, near you" | **Events tab pill** only | `DiscoverScreen.tsx:1949-1957` `<View ref={coachDiscoverFeed.targetRef} …styles.headerPanel>` (via `:879` `useCoachMark(4,24)`) | `{x:0,**y:0**,**w:448**,**h:192**}` (whole header panel) | **MISMATCH — wrong/too-broad element** |
| 5 | "Your people" | **Friends/people icon** | `ConnectionsPage.tsx:3309-3311` `<View ref={coachChatHeader.targetRef} …styles.headerRowAbsolute>` (via `:572` `useCoachMark(5,0)`) | `{x:0,y:52,**w:448**,h:48}` (whole header row: title + icon) | **MISMATCH — too-broad element** |
| 6 | "Your rules" (Account Settings) | **Account Settings row** | `ProfilePage.tsx:509` `<View ref={accountSettingsRef} onLayout={handleAccountSettingsLayout}>` → `registerTargetScrollOffset(6,…)` (`:182`) | `{x:37,**y:399.4**,w:374,h:72}` — paints ~1 row too low | **MISMATCH — scroll-math/synthetic-measure** |
| 7 | "Tell us what works" | **Share Feedback** button | `ProfilePage.tsx:522` `<BetaFeedbackButton feedbackButtonRef={feedbackButtonRef} onCoachLayout={handleFeedbackButtonLayout}>` → `registerTargetScrollOffset(7,…)` (`:195`) | first `undefined` (~3-4s), then `{x:24,**y:399.4**,w:400,h:52}` — paints on View History, not Share Feedback | **MISMATCH — scroll-math/synthetic-measure** |

Note step 6 and step 7 both register **contentY = 399.3999987284342** (byte-identical) — a strong tell that the synthetic-measurement scroll math is not resolving each row's true content offset; both cutouts converge on the same wrong vertical band.

---

## D. ROOT CAUSE 1 — Step 2 off-then-correct-on-back (measurement-timing) 🔴

**Six-field evidence:**

- **File + line:** `app-mobile/src/components/GlassTopBar.tsx:106-133` (entrance animation) + `app-mobile/src/hooks/useCoachMark.ts:30-79` (measure timing).
- **Exact code (GlassTopBar):**
  ```ts
  const translateY = useRef(new Animated.Value(-c.motion.showTranslateY)).current; // -16
  Animated.timing(translateY, { toValue: 0, duration: c.motion.showDurationMs /*260*/, useNativeDriver: true }).start();
  ```
  The `<View ref={coachPrefsRef}>` is a child of this `Animated.View` (`showTranslateY = 16`, `designSystem.ts:692`).
- **What it does:** `useCoachMark.measure()` calls `node.measureInWindow(...)`. The measure fires (a) on callback-ref attach via `requestAnimationFrame` (`useCoachMark.ts:69`) and (b) 100ms after `isActive` flips (`useCoachMark.ts:76`). When step 2 first becomes active, `measureInWindow` returns the Preferences button's Y **before the native-driver translateY transform is reflected on the JS shadow tree** — i.e. as if the parent were still at/partway through `translateY = -16`. Registered rect = `y ≈ 36`.
- **What it should do:** measure the button at its settled, on-screen position (`y ≈ 52`) — only after the entrance transform has fully committed.
- **Causal chain (PROVEN with live runtime values):**
  1. Step 1→2 advances same-tab; step 2's `useCoachMark` measures while GlassTopBar's `Animated.View` (native-driver translateY −16→0, 260ms) is settling.
  2. First registered rect: `{x:16,y:36.33,w:44,h:44}` (captured live, logcat 11:54:55).
  3. ~2s later a re-measure registers `{x:16,**y:52.33**,w:44,h:44}` (logcat 11:54:57). **Δ = 16.00px = `showTranslateY`** — the exact entrance offset.
  4. The cutout is painted at the stale `y=36` first (16px too high → "off"), then corrects to `y=52`.
  5. Tapping **Back** re-enters step 2 long after the entrance animation is settled, so its measure returns `y=52` immediately → aligned. This is exactly the operator's "off on first show, correct after Back" report.
- **Verification step:** logcat `[Spotlight] Step 2` shows the two registrations differing by exactly 16 (= `showTranslateY`); the value is the GlassTopBar entrance offset, not a coincidental status-bar/inset value (Pixel 8 Pro `insets.top` is ~48-56dp, not 16). The re-measure is triggered because `useCoachMark.measure` depends on `insets.top`/identity and re-runs once the layout/transform settles.

**Disproven alternative:** "It's the Android `insets.top` double-count from ORCH-0688." Disproved — the delta is 16 (= showTranslateY), not the ~48dp status-bar inset; and the corrected value is the larger one, so the correction adds the entrance offset, not subtracts an inset.

**Why no stable-rect retry exists:** `useCoachMark` measures at most twice (rAF on attach + one 100ms timer on activation). There is **no measure-until-stable / settle-gated / `InteractionManager`-gated** loop and **no `onLayout`-driven re-measure** for the non-scroll steps. So whichever transient layout the measure happens to catch is what paints, until an unrelated dependency change forces a second measure. This is the systemic gap (see §F).

---

## E. ROOT CAUSE 2 — Steps 4 & 5 target the wrong (too-broad) container 🔴

**Six-field evidence:**

- **File + line:**
  - Step 4: `app-mobile/src/components/DiscoverScreen.tsx:1949-1957` — `coachDiscoverFeed.targetRef` is attached to the **entire `styles.headerPanel` View** (height `HEADER_PANEL_HEIGHT`, full width).
  - Step 5: `app-mobile/src/components/ConnectionsPage.tsx:3309-3311` — `coachChatHeader.targetRef` is attached to **`styles.headerRowAbsolute`** (full-width row: title + people icon).
- **Exact code (step 4):** `<View ref={coachDiscoverFeed.targetRef} … style={[styles.headerPanel, { height: HEADER_PANEL_HEIGHT, … }]}>` — and a stale comment at `:1947` still reads "coach-mark step **6** target — the header panel itself (title + filter bar)."
- **What it does:** registers a rect spanning the whole header (`{x:0,y:0,w:448,h:192}` for step 4; `{x:0,y:52,w:448,h:48}` for step 5), so the spotlight cutout encloses everything in the header.
- **What it should do:** step 4 should attach the ref to the **Events tab pill** (the `Pressable` for `tab.id === 'events'` at `DiscoverScreen.tsx:2011`, which already has an `onLayout`); step 5 should attach to the **people icon `Pressable`** (`ConnectionsPage.tsx:3317-3332`) — or to the bottom-nav people icon if that is the chosen referent (see §H open question).
- **Causal chain:** ref on broad container → `measureInWindow` returns the container bounds → SpotlightOverlay paints a cutout the size of the whole header → "highlights the entire header section" (operator findings #2 + #3). PROVEN by the live rects (full screenWidth=448 in both).
- **Verification step:** live screenshots `android_step4_events.png` (orange glow around the full Discover header) and `android_step5_people_settled.png` (orange glow around the full Friends header row); measured widths both = 448 = `screenWidth`.

**Note on `bubblePosition:'center'` (step 4):** the spec deliberately centers step 4's bubble *because* the cutout was designed to be the whole header (`coachMarkSteps.ts:56-59`). That is a band-aid for the too-broad target, not the target fix. If step 4 is re-pointed to the Events pill, the centered-bubble override should be reconsidered.

---

## F. ROOT CAUSE 3 — Steps 6 & 7 scroll-offset/synthetic-measure is racy AND mis-positioned 🔴

**Six-field evidence:**

- **File + line:** `app-mobile/src/contexts/CoachMarkContext.tsx:231-318` (`scrollToKnownPosition` + `performScrollAndMeasure`), fed by `ProfilePage.tsx:175-199` (`measureLayout` → `registerTargetScrollOffset(6|7,…)`).
- **Exact code:** `const exactScreenY = offset.contentY - scrollY; const correctedY = Platform.OS === 'android' ? exactScreenY + insets.top : exactScreenY;` then `registerTarget(step, { x: offset.contentX, y: correctedY, … })`.
- **What it does (two defects):**
  1. **Race / undefined window:** the offset registers via `onLayout`→`measureLayout`, polled up to 25×60ms. Live, step 6 sat at `target=undefined, hasPlausibleTarget=false` for **~8s** (logcat 12:04:47→12:04:55) before registering; step 7 sat undefined for **~3-4s** before registering. During that window the overlay shows the centered-bubble fallback with NO cutout (and a cross-tab fade), so the user sees the bubble before the spotlight lands.
  2. **Mis-position:** the synthetic `correctedY` lands the cutout ~1 row too low. Step 6's cutout sits in the empty gap below the Account Settings row; step 7's sits on **View History** instead of **Share Feedback**. Both register the **identical** `contentY = 399.3999987284342`, which is not plausible for two different rows — indicating `measureLayout(content,…)` is resolving against a content origin / scroll state that does not match the live scroll position used in the `contentY - scrollY` math, or the rows are being measured before their final layout (the `BetaFeedbackButton` conditionally renders Share Feedback + View History, shifting offsets).
- **What it should do:** the cutout must enclose the exact `Account Settings` row (step 6) and the exact `Share Feedback` button (step 7), deterministically, only after the scroll settles and the row's true post-scroll screen rect is known (ideally a real post-scroll `measureInWindow`, not a `contentY - scrollY` reconstruction).
- **Causal chain:** late/!stable offset + reconstructed (not directly measured) screen-Y → cutout painted at a wrong/low Y → "the feedback is off" (operator finding #4) and step 6 misalignment. PROVEN by live rects + screenshots `android_step6_accountsettings.png` (cutout below Account Settings) and `android_step7_feedback.png` (cutout on View History, not Share Feedback).
- **Verification step:** logcat shows `Step 6 target=undefined` for ~8s then `{…y:399.4…}`; `Step 7 target=undefined` then `{…y:399.4…}`; both screenshots show the orange glow one row below the intended row.

---

## G. SYSTEMIC ROOT CAUSE (what must change for "absolute determinism")

The cutouts are non-deterministic for **three compounding structural reasons**, all in shared cross-platform code:

1. **Refs on the wrong nodes (steps 4, 5).** The targets are attached to broad layout containers (`headerPanel`, `headerRowAbsolute`) rather than the specific affordance the copy promises. Determinism is impossible when the measured node isn't the intended node. Fix = move each `targetRef`/`coach*Ref` onto the exact leaf affordance (Events pill `Pressable`; people-icon `Pressable`).

2. **Measure-before-settle with no stable-rect guarantee (step 2, and latent everywhere).** `useCoachMark` measures on rAF-attach + a single 100ms timer, with **no wait for the entrance/transition animation to finish and no measure-until-stable retry.** Because GlassTopBar animates `translateY` with `useNativeDriver:true`, the first `measureInWindow` returns a pre-settle Y (16px high). There is no settle gate (`InteractionManager.runAfterInteractions`, animation-complete callback, or a "measure twice and only accept when two consecutive measures match" loop). Fix = gate the measure on layout+animation settle and re-measure until the rect is stable before painting the cutout.

3. **Synthetic reconstructed coordinates instead of real measured ones (steps 6, 7).** The Profile scroll steps compute `contentY - scrollY (+inset)` rather than performing a true `measureInWindow` of the row **after** the scroll completes. The reconstruction is fragile (depends on contentY being final, scrollY being exact, and conditional rows not shifting layout) and is racy (offset registers seconds late). Fix = after the programmatic scroll settles, measure the actual row node's window rect directly (the same primitive steps 1-5 use) instead of reconstructing it.

In one sentence: **the system measures the wrong nodes, at the wrong time, sometimes by reconstruction instead of direct measurement, with no stable-rect guarantee** — so the cutout that paints is whatever transient layout the single early measure happened to catch.

---

## H. Outcome & Journey Step-Back

- **User's goal:** in the first-run tour, understand *exactly* where each core affordance lives, by seeing a precise spotlight ring around it.
- **Journey:** launch → 1.5s → step 1 deck → "Got it" ×6 across Home/Discover/Friends/Profile → finish. Each step must spotlight one specific element with a ring that hugs it.
- **Divergence points:** step 2 ring is 16px high until it self-heals; step 4 ring engulfs the whole Discover header; step 5 ring engulfs the whole Friends header; steps 6/7 rings land a row low (and appear seconds late with a cross-tab flash of no-cutout).
- **Does fixing only the reported nodes deliver the outcome?** Partially. Re-pointing refs (steps 4/5) and fixing the scroll math (steps 6/7) addresses 4 of 5 symptoms, but **without the settle-gated stable re-measure (systemic cause #2), step 2 — and any future animated target — will remain non-deterministic across devices.** The SPEC must address all three systemic causes, not just re-point refs, to satisfy "absolute determinism on all devices."

**Open question for SPEC/operator (step 5 referent):** the dispatch says step 5 should hit "the Friends (people) icon in the bottom nav," but the current ref + copy ("everything social lives here") point at the in-page Friends header. The SPEC must pick ONE canonical referent (in-page people icon vs bottom-nav Friends tab) and align copy + ref accordingly.

---

## I. Five-Layer Cross-Check

| Layer | Finding |
|---|---|
| Docs/spec | `SPEC_ORCH-1029_COACH_MARK_FIXES.md` is referenced throughout but is NOT in the anchor checkout (lives in the reaped ORCH-1029 worktree). Comments claim F-1/F-3/F-4 fixes; live behavior shows the exact-target requirement unmet. |
| Schema | `profiles.coach_mark_step` integer; 0 starts tour, `COACH_STEP_COUNT+1`=8 completed. Confirmed live (read 7, set 0, restored 7 for both test users). |
| Code | Refs on broad containers (steps 4/5); single early measure, no settle gate (step 2); reconstructed scroll-Y (steps 6/7). All read in full. |
| Runtime | Pixel 8 Pro live: step-2 `y:36→52` (Δ16); step-4 `{0,0,448,192}`; step-5 `{0,52,448,48}`; step-6/7 `undefined`→`y:399.4` (identical). |
| Data | Both test users (`b17e3e15…` Android `sethogieva@gmail.com`; `c727d491…` iOS `sethogieva@icloud.com`) were at step 7; restored to 7 post-investigation. |

---

## J. Live Repro Evidence

Device: **Pixel 8 Pro emulator** (`emulator-5554`), consumer app `com.mingla.app.v2`, anchor Metro `:8109` (reused, not killed), `adb reverse 8109` confirmed. Tour forced via Management API (`coach_mark_step=0`), driven with Maestro / adb taps (no osascript). iOS: iPhone 17 Pro (`17091E60…`) confirmed step 1 live; further iOS steps blocked by a recurring in-app "Open Settings" notifications modal that sits above the coach overlay and intercepts taps (see Discoveries).

Screenshots in `Mingla_Artifacts/reports/orch1037_shots/`:
- `android_step1_after_delay.png` — step 1 deck cutout (MATCH).
- `android_step2_FIRST_SHOW.png` — step 2 first show (top-left icon); logcat proves `y:36→52` Δ16.
- `android_step3_likes.png` — step 3 Likes tab (MATCH).
- `android_step4_events.png` — step 4 **whole Discover header** highlighted (MISMATCH).
- `android_step5_people.png` / `android_step5_people_settled.png` — step 5 **whole Friends header row** highlighted (MISMATCH).
- `android_step6_accountsettings.png` — step 6 cutout **below** Account Settings row (MISMATCH).
- `android_step7_feedback.png` — step 7 cutout on **View History**, not Share Feedback (MISMATCH).
- `ios_step1.png` / `ios_step1_clean.png` — iOS step 1 deck cutout (MATCH).

---

## K. Blast Radius

- All consumer first-run users, iOS + Android (shared code). Returning users (`coach_mark_step != 0`) unaffected.
- No backend/RLS/edge/business/admin impact — purely `app-mobile` presentation.
- The `bubblePosition:'center'` override on step 4 is coupled to the too-broad target; revisit if step 4 is re-pointed.

---

## L. Fix Strategy (direction only — for SPEC)

1. **Re-point refs to leaf affordances:** step 4 → Events tab `Pressable` (`DiscoverScreen.tsx:2011`); step 5 → people-icon `Pressable` (`ConnectionsPage.tsx:3317`) OR bottom-nav Friends tab (operator decision §H). Remove the stale "step 6" comment at `DiscoverScreen.tsx:1947`.
2. **Settle-gated, measure-until-stable measurement in `useCoachMark`:** gate the first measure behind animation/interaction settle (e.g. `InteractionManager.runAfterInteractions` + a short re-measure loop that only accepts a rect when two consecutive `measureInWindow` results match within ~1px). This kills the step-2 16px and any future animated-target drift on ALL devices.
3. **Direct post-scroll measurement for steps 6/7:** after the programmatic scroll settles, `measureInWindow` the actual row node (same primitive as steps 1-5) instead of reconstructing `contentY - scrollY (+inset)`; remove the identical-contentY reconstruction. Tighten the offset-registration so the cutout never shows a multi-second `undefined` window.
4. **Re-evaluate step 4's `bubblePosition:'center'`** once it targets a small pill.

(Per Prime Directive — NO fixes applied. This is direction for the SPEC phase.)

---

## M. Regression Prevention (for SPEC)

- A dev-time assertion (extend the existing `useCoachMark.ts:83-95` orphan warning) that a registered rect is NOT ≥ ~90% of `screenWidth`/`screenHeight` unless explicitly whitelisted (step 1 deck) — catches "ref on a too-broad container" regressions.
- A "stable rect" invariant: the painted cutout must derive from a measurement taken after interactions settle (mechanically testable by asserting two consecutive equal measures).

---

## N. Discoveries for Orchestrator

1. **iOS recurring "Open Settings" notifications modal** (consumer app, `requestPostTourPermissions` path) re-presents on every relaunch when notifications are denied on the sim, sits above the coach overlay, and intercepts taps — it blocked automated iOS tour driving this session. Possibly a real UX nuisance for users who deny notifications during the tour (modal nags repeatedly). Worth a separate INTAKE.
2. **Coach overlay cutout pass-through lets taps reach app content underneath** (a "Cancel"-by-point tap fell through the cutout and opened a card detail). Expected by design (the cutout has no scrim), but during the tour it means a mis-aimed tap can navigate away mid-step. Note for SPEC/UX.
3. **Stale comment** `DiscoverScreen.tsx:1947` still says "coach-mark step 6 target" (should be step 4 post-ORCH-1029 renumber).
4. `SPEC_ORCH-1029_COACH_MARK_FIXES.md` is not present in the anchor checkout (reaped worktree) — link it from the ORCH-1037 SPEC for the F-1/F-3/F-4 history.

---

## O. Completion Condition Check

1. Root causes proven with six fields + alternatives disproven — ✅ (3 root causes).
2. Pipeline traced backward + forward to terminal user state — ✅.
3. Journey mapped + divergences named + "does fixing the node deliver the outcome?" answered — ✅ (§H: no, needs systemic settle-gate).
4. External research (RN measureInWindow + useNativeDriver) cited — ✅ (§ Sources).
5. Every pertinent file read in full — ✅.
6. DB-object latest-migration check — N/A (no DB object is a root cause; only `coach_mark_step` read/restore).
7. Live repro on simulator — ✅ Pixel 8 Pro all 7 steps with runtime rects; iOS step 1 live; iOS-full blocked by a named blocker (recurring modal) → step-2/4-7 iOS confidence is inferred from shared code, capped honestly (see §7 caveat) but the Android proof is `proven`.

### §7 caveat
iOS steps 4-7 were not driven to completion (recurring permission modal intercepted taps). The wrong-element (4/5) and scroll-math (6/7) causes are in platform-agnostic JSX/JS, so they reproduce identically on iOS by construction; the step-2 timing has an Android-specific inset branch but the underlying native-driver measure-before-settle is cross-platform. Android findings are `proven`; iOS parity for 4-7 is `probable` (shared-code inference + iOS step-1 live confirmation).

---

## Sources (external)
- React Native — measureInWindow / Animated `useNativeDriver` stale-coordinate behavior: https://reactnative.dev/docs/animations ; facebook/react-native#14219 (native-driver re-render/position reset); microsoft/react-native-windows#4313 (Animated.View pre/post-animation position).
