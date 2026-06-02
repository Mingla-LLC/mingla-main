# INVESTIGATION — ORCH-1029 [Coach-mark cross-device preventative QA]

**Mode:** INVESTIGATE (forensics) · **Type:** preventative cross-device QA audit (no operator-reported break)
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1029-[coach-mark-cross-device-qa]/` · **Branch:** `ORCH-1029-coach-mark-cross-device-qa`
**Date:** 2026-05-31 · **Author:** Claude `mingla-forensics`
**Confidence:** HIGH (`proven` — live-fire on 4 devices across 2 platforms with logged target measurements + screenshots)

---

## 0. Comms ledger

Read `COMMS_LEDGER.md` on entry. No OPEN `BLOCK`/`WARN` rows are addressed to ORCH-1029, `mingla-forensics`, or `ALL`. Only BLOCK row (COMMS-0006 → ORCH-0980) is already `ACKNOWLEDGED`. Nothing to ack. No cross-ORCH discovery requiring a new COMMS row (all findings are self-contained in this coach-mark surface).

---

## 1. Symptom summary

This is **preventative** QA — no specific break was reported. Goal: prove that every consumer coach-mark step lands on its intended target with a correctly positioned/clamped bubble across a device-size matrix on both platforms, and find any drift / off-by-status-bar / clipping / mis-targeting / unmounted-target failures.

**Headline correction to the dispatch:** the tour is **9 steps, not 8.** `COACH_STEP_COUNT = 9`; `coachMarkSteps.ts` defines ids 1–9; every bubble renders "N of 9". The dispatch's "8 steps" is stale (the file header says "8-step variant" but the array has 9 entries — a comment/data mismatch, see Finding F-6).

---

## 2. Device matrix actually exercised

| Device | Logical size | Status bar / cutout | Platform | Account | Coverage |
|--------|--------------|---------------------|----------|---------|----------|
| iPhone 17 Pro Max | 430pt | Dynamic Island | iOS 26.4 | c727d491 | **All 9 steps**, step-by-step, with logged `measureInWindow` rects + screenshots |
| iPhone 17e | 390pt | notch | iOS 26.4 | c727d491 | Steps 1–2 (step-1 fallback reproduced; step-2 target registered) |
| iPhone SE 3rd gen | **375pt (smallest supported)** | classic 20pt status bar, no notch | iOS | b17e3e15 | Steps 1, 2, 3, 6, 7 (warm deck) |
| Pixel (sdk_gphone64) | 448dp | **Android 15 edge-to-edge**, `edgeToEdgeEnabled:true` | Android 15 | c727d491 | Steps 1, 2 (status-bar-correction verification) |

Driver: Maestro (`~/.maestro/bin/maestro --device <udid>`) + coordinate taps (the overlay's TouchableOpacity nodes are NOT in the iOS accessibility tree — `tapOn: text/id` fails; see F-7), `adb input tap` on Android. Tour forced by setting `profiles.coach_mark_step = 0` via the Supabase Management API, then relaunch. All test accounts restored to `coach_mark_step = 10` (completed) afterward.

Sim blockers resolved (not noted): worktree symlinked `node_modules` broke the Metro resolver (`Unable to resolve ./mingla-main/app-mobile/node_modules/expo-router/entry`) → Metro re-run from the **anchor checkout** `~/Desktop/mingla-main/app-mobile` (HEAD == worktree HEAD `5cf059fe9`, byte-identical coach-mark code, verified via `git diff`). Android "System UI isn't responding" ANR (resource contention) → freed iOS sims, force-restarted the app.

Evidence screenshots: `Mingla_Artifacts/reports/orch_1029_screenshots/` (18 files).

---

## 3. Target-wiring map (source of truth)

Every step's target registration, enumerated across `app/` + `src/`:

| Step | Tab | Copy | Target wiring | Registered? |
|------|-----|------|---------------|-------------|
| 1 | home | "Meet your deck" | `useCoachMark(1)` → `coachDeckRef` → `SwipeableCards` cardContainer (`SwipeableCards.tsx:2298`) | YES, but **only in the populated render path** (F-1) |
| 2 | home | "Your taste, your rules" | `useCoachMark(2)` → `coachPrefsRef` → `GlassTopBar` Preferences btn (`GlassTopBar.tsx:227`) | YES |
| 3 | home | "Where your saves live" | `useCoachMark(3)` → `coachLikesRef` → `GlassBottomNav` Likes tab, via `GlassBottomNavWithCoach` wrapper (`app/index.tsx:142`) | YES |
| 4 | home | "Better together" | **NONE** | **NO — orphaned (F-2)** |
| 5 | home | "Back to solo" | **NONE** | **NO — orphaned (F-2)** |
| 6 | discover | "Events, near you" | `useCoachMark(6)` → header panel (`DiscoverScreen.tsx:1949`), `bubblePosition:'center'` | YES |
| 7 | connections | "Your people" | `useCoachMark(7,0)` → header row (`ConnectionsPage.tsx:3309`) | YES |
| 8 | profile | "Your rules" | `registerTargetScrollOffset(8)` via `measureLayout` (`ProfilePage.tsx:173`) | YES on paper, **fails at runtime (F-3)** |
| 9 | profile | "Tell us what works" | `registerTargetScrollOffset(9)` via `measureLayout` (`ProfilePage.tsx:182`) | YES |

`grep -rnoE "useCoachMark\([0-9]+"` across `app/ src/` returns exactly {1,2,3,6,7}; `registerTargetScrollOffset` returns {8,9}. **Steps 4 and 5 have zero target registration anywhere in the codebase.**

---

## 4. Per-step cross-device verdict

| Step | Target | Pro Max 430 | SE 375 | 17e 390 | Android 15 | Verdict |
|------|--------|-------------|--------|---------|-----------|---------|
| 1 "Meet your deck" | deck card | `target=undefined` → centered fallback, NO cutout | `target=undefined` (even warm deck) | `target=undefined` | target=full screen `{0,2,448,879}` → cutout = whole screen, no real spotlight, bubble crammed at top over status bar | **DRIFT (F-1)** |
| 2 "Your taste" | Prefs btn | SOLID — cutout on btn (y=48) | SOLID (y=22) | target ok (y=33) | cutout ~14dp too high, top half in status bar, icon low in cutout | **iOS SOLID / Android RISK (F-4)** |
| 3 "Where saves live" | Likes tab | SOLID — cutout on Likes tab, bubble above | SOLID | — | — | **SOLID** |
| 4 "Better together" | (none) | `target=undefined` → centered fallback, NO cutout | — (centered fallback) | — | — | **DRIFT — orphaned (F-2)** |
| 5 "Back to solo" | (none) | `target=undefined` → centered fallback, NO cutout | — | — | — | **DRIFT — orphaned (F-2)** |
| 6 "Events near you" | Discover header | SOLID — header spotlit, centered bubble | SOLID (375 clamps clean) | — | — | **SOLID** |
| 7 "Your people" | Friends header | SOLID — header row spotlit, bubble below | SOLID | — | — | **SOLID** |
| 8 "Your rules" | Account Settings row | `target=undefined` → centered fallback + **over-scrolled to page footer** | — | — | — | **DRIFT (F-3)** |
| 9 "Tell us what works" | Share Feedback btn | SOLID — cutout on btn, bubble below, scrolled to 35% | — | — | — | **SOLID** |

**Net: 5 SOLID (3, 6, 7, 9, and step 2 on iOS) · 4 DRIFT/RISK (1, 4, 5, 8) + 1 platform-specific RISK (2 on Android).**

---

## 5. Findings (classified, six-field where root cause)

### 🔴 F-1 — Step 1 deck spotlight is broken on every device (two distinct mechanisms)

- **File+line:** `app-mobile/src/components/SwipeableCards.tsx:2288–2298` (ref attach), `app-mobile/src/hooks/useCoachMark.ts:32–33` (zero-size early-return).
- **Exact code:** `coachDeckRef` is attached at line 2298 `<View ref={coachDeckRef} ... style={styles.cardContainer}>` — which is **after** the `if (!currentRec) return null;` guard at 2288 and after all loading/empty/error early-returns above it. In `useCoachMark.ts:33`: `if (width === 0 && height === 0) return;`.
- **Current behavior:**
  - iOS cold/curating deck (the normal first-run state — tour fires on `coach_mark_step=0`, i.e. brand-new user whose deck is still fetching): `coachDeckRef` is never attached (component is in loading branch) → no `measureInWindow` → `target=undefined` → SpotlightOverlay renders the centered-bubble fallback with **no deck cutout**. Reproduced on Pro Max, SE, and 17e (`[Spotlight] Step 1: target=undefined, hasTarget=undefined` repeated across renders; SE reproduced it even with a card already rendered → the rAF+100ms re-measure does not reliably catch it).
  - Android warm deck: ref attaches, `measureInWindow` returns `{x:0, y:2, width:448, height:879}` — essentially the **entire screen**. The SVG cutout then carves a hole the size of the whole screen → no meaningful dark scrim, no "spotlight" on the card, and the bubble's above/below math crams it against the top edge overlapping the status bar.
- **Correct behavior:** step 1 should spotlight the actual card with surrounding scrim. Either the deck card target must register a card-sized rect reliably regardless of deck-load timing, OR step 1 should adopt a deliberate `bubblePosition:'center'` + no-cutout treatment (like step 6) instead of accidentally falling back to it.
- **Causal chain:** tour starts at first-run → deck still curating (cold network) → ref unattached → undefined target → centered fallback. The user's **only** exposure to step 1 (first run) is precisely the worst-case timing.
- **Verification:** Metro logs show `target=undefined` for step 1 on 3 iOS devices; Android logs show a full-screen rect; screenshots `promax_step1_deck_no_cutout.png`, `se3_step1_deck_no_cutout.png`, `e17_step1_deck_no_cutout.png`, `android15_step1_fullscreen_cutout.png`.
- **The `ORCH-0635` dev-warning at `useCoachMark.ts:69–81` ("Step 1 targetRef never attached") fired on every launch** — the codebase already self-reports this regression; it just isn't acted on.

### 🔴 F-2 — Steps 4 & 5 are orphaned: they describe deleted UI and spotlight nothing

- **File+line:** `app-mobile/src/constants/coachMarkSteps.ts:43–56` (step 4 "Better together", step 5 "Back to solo"); no `useCoachMark(4)`/`useCoachMark(5)` anywhere.
- **Exact code:** step 4 copy = "Start a session, invite your crew, swipe the same deck together"; step 5 copy = "Your deck, your rules. Tap Solo to switch back anytime."
- **Current behavior:** both render the centered-bubble fallback (`target=undefined`, proven live on Pro Max — `promax_step4_orphan.png`, `promax_step5_orphan.png`) with no cutout. They point at a Solo/Together **session switcher that no longer exists.**
- **Correct behavior:** copy that references a real, present affordance — or removal of these two steps.
- **Causal chain (root cause class):** **META-ORCH-0929** ([Collab decks live in group chat, Home is solo-only], per MEMORY.md) **DELETED** `GlassSessionSwitcher.tsx` + `CollaborationSessions.tsx` and made Home solo-only. The coach steps that pointed at that switcher were left behind (`sessionSwitcher={null}` is now hard-wired at `HomePage.tsx:174`). Confirmed: `find ... -name '*.tsx' | xargs grep -lE "GlassSessionSwitcher|CollaborationSessions"` → empty (deleted).
- **Verification:** zero `useCoachMark(4|5)` call sites; switcher files absent; live `target=undefined` + screenshots showing copy over a feature-less dimmed Home.
- **Severity:** highest product impact — first-run users are told about a "start a session / Solo toggle" that isn't in the app.

### 🟠 F-3 — Step 8 (Account Settings) loses its target to a scroll-offset race + over-scrolls to the footer

- **File+line:** `app-mobile/src/contexts/CoachMarkContext.tsx:202–259` (`scrollToKnownPosition`), `ProfilePage.tsx:166–189` (800ms `measureLayout` registration).
- **Current behavior:** when step 8 activates it calls `scrollToKnownPosition(8)`, which after `TAB_NAVIGATE_DELAY` reads `scrollTargetOffsetsRef.get(8)`. ProfilePage registers that offset only **800ms after Profile mounts** (the single `setTimeout(…, 800)` effect). Profile mounts during the step-7→8 cross-tab transition, so for the FIRST profile step the offset is often not yet present → the `if (!scrollRef?.current || !offset)` branch (line 214) fires `scrollToEnd()` and **registers no synthetic measurement** → `target=undefined` → centered fallback AND the page is scrolled all the way to the footer (Share Feedback / Sign Out / v1.0.0), not the Account Settings row. Reproduced live on Pro Max: `[Spotlight] Step 8: target=undefined` persisting + `promax_step8_overscroll_no_cutout.png` shows the footer.
- **Why step 9 is fine:** step 9 is reached after Profile has been mounted and settled for several seconds, so the 800ms registration has long completed → `registerTargetScrollOffset(9)` is available → step 9 scrolls to 35% and spotlights the Share Feedback button correctly (`promax_step9_feedback.png`, target `{24,334.6,392,52}`). The step-8 vs step-9 asymmetry in the same session **is** the proof the failure is a mount-timing race, not a missing ref (both refs attach; no `measureLayout failed` warning fired).
- **Correct behavior:** the offset must be guaranteed present before `scrollToKnownPosition` reads it (e.g. await registration, or re-measure on demand), so step 8 scrolls to the Account Settings row and spotlights it.
- **Verification:** live logs + screenshots; both `accountSettingsRef` (`ProfilePage.tsx:499`) and `feedbackButtonRef` (`:512`) are attached and neither error-callback fired.

### 🟠 F-4 — Android status-bar correction slightly over-compensates on Android 15 edge-to-edge (cutout ~14dp too high)

- **File+line:** `useCoachMark.ts:46` `const correctedY = Platform.OS === 'android' ? y + (StatusBar.currentHeight ?? 0) : y;` (ORCH-0688). Same correction at `CoachMarkContext.tsx:246`.
- **Current behavior:** on the Android-15 emulator (`edgeToEdgeEnabled:true`), step 2's cutout registered `y:14` and renders with its **top ~40% overlapping the status-bar zone** (the "8:50" clock sits inside/beside the cutout) and the Preferences icon sitting low in the cutout — see zoom `android15_step2_cutout_highdrift_zoom.png`. The button IS covered (not the gross "cutout on the system clock" pre-ORCH-0688 failure), but alignment is cosmetically off (cutout center ~14dp high).
- **Likely cause:** `StatusBar.currentHeight` on Android 15 edge-to-edge is known to return values that don't match the inset the SVG mask actually needs (RN/Expo SDK 54 edge-to-edge interaction). The additive correction is slightly wrong for THIS config — not absent, just imprecise. iOS is unaffected (correction is a no-op; iOS cutouts landed precisely at y=48/22/33 across devices).
- **Correct behavior:** cutout centered on the button on Android 15 the same way it is on iOS. Confidence on root cause: `probable` (the over-high render is proven; the exact `StatusBar.currentHeight` value vs. the needed inset on this emulator was not numerically isolated — flagged for SPEC to pin with `useSafeAreaInsets().top` comparison).
- **Severity:** P2 — cosmetic drift, button still spotlit; only one device class affected.

### 🟡 F-5 — Step 1 / step 8 fallbacks expose the scrim-coverage gap on near-fullscreen or undefined targets

- When `target` is undefined OR near-fullscreen, the overlay shows a centered bubble but the **app content behind is not meaningfully dimmed/spotlit** (step 1 Android: whole-screen cutout = no scrim; step 1 iOS / step 8: centered bubble over a uniformly dim screen with nothing highlighted). Not a crash, but the "spotlight" affordance silently degrades to "modal over dim". Hidden flaw because any future step whose target fails to measure will silently look like this rather than erroring.

### 🔵 F-6 — `coachMarkSteps.ts` header comment says "8-step variant" but the array is 9 steps

- `coachMarkSteps.ts:2` header: "ORCH-0635 refresh (Pass 2, 8-step variant)"; the array has ids 1–9 and `COACH_STEP_COUNT=9`. The dispatch inherited the stale "8 steps". Observation only — the runtime is correctly 9 (every bubble shows "N of 9").

### 🔵 F-7 — Coach-mark bubble buttons are not in the iOS accessibility tree (VoiceOver / automation gap)

- Maestro `tapOn: { text: "Got it" }` and `tapOn: { id: "Go to next step" }` both FAIL with "element not found" — the overlay's `Animated.View` (root `accessibilityRole="none"`) + react-native-svg layers collapse the bubble's TouchableOpacity nodes out of the iOS a11y tree. Coordinate taps work. Implication: the tour's Got it / Back / Skip buttons may not be reachable by VoiceOver. Worth a a11y follow-up (not in this scope).

---

## 6. Five-layer cross-check

| Layer | Finding |
|-------|---------|
| Docs | `coachMarkSteps.ts` header ("8-step") contradicts the 9-step array (F-6). ORCH-0688 spec referenced in code comments but not present in worktree. |
| Schema | `profiles.coach_mark_step` int; `TOUR_COMPLETED = COACH_STEP_COUNT+1 = 10`; legacy values normalized. Consistent. No schema bug. |
| Code | Target wiring exists for 1,2,3,6,7,8,9; **absent for 4,5** (F-2). Step-1 ref behind populated-only guard (F-1). Step-8 offset behind an 800ms race (F-3). |
| Runtime | Live `[Spotlight]` logs: steps 4,5 `undefined`; step 1 `undefined` (iOS) / full-screen (Android); step 8 `undefined`+over-scroll; steps 2,3,6,7,9 register correct rects. |
| Data | Forced tour via `coach_mark_step=0`; observed persistence advancing 0→1→2→… as expected; restored to 10. Persistence layer is sound. |

Contradictions concentrate in the **code↔runtime** layer for steps 1/4/5/8 — exactly the DRIFT set.

---

## 7. Blast radius

- **Surfaces affected:** Consumer iOS + Consumer Android (`app-mobile/`) — the only surfaces with the coach tour. Business apps, buyer-web, admin-web have no coach marks (correctly out of scope).
- **Users affected:** every **first-run** consumer (tour fires once, at `coach_mark_step=0`). The broken steps (1,4,5,8) are the user's first impression of the app's onboarding. Steps 4/5 actively misinform about a removed feature.
- **Cross-mode:** solo only (Home is solo-only post-META-ORCH-0929). No collab interaction.
- **Not a crash / data-loss / security issue** — graceful degradation throughout (centered fallback). Severity is product/onboarding quality, not stability.

---

## 8. Outcome & journey step-back

**User goal:** a brand-new consumer wants a 30-second orientation that points at the real things they'll use (deck, preferences, likes, discover, friends, settings, feedback).
**Journey reality:** step 1 fails to highlight the deck (the single most important object); steps 4–5 describe a Solo/Together session feature that was deleted, confusing the user; step 8 dumps them at the footer instead of Account Settings. Steps 2,3,6,7,9 deliver. So **4 of 9 first-impression beats miss**, and 2 of those actively describe non-existent UI.
**Does fixing the reported node deliver the outcome?** There was no single reported node — this is preventative. To deliver the onboarding outcome, SPEC must address F-1 (deck spotlight), F-2 (remove/repurpose steps 4–5), F-3 (step-8 scroll race), and F-4 (Android cutout drift). Fixing only one leaves the first-run tour partially broken.

---

## 9. Fix strategy (direction only — NOT a spec)

1. **F-2 (steps 4/5):** product decision — either delete steps 4 & 5 (tour becomes 7 steps) or rewrite them to point at present Home affordances. Coordinate with the META-ORCH-0929 solo-only contract. *Highest priority — misinformation.*
2. **F-1 (step 1):** make the deck target register reliably regardless of load state (e.g. measure the deck wrapper that's always mounted, or gate step-1 activation on deck-ready), OR convert step 1 to an explicit centered/no-cutout treatment so it's intentional rather than an accidental fallback.
3. **F-3 (step 8):** eliminate the mount-timing race — guarantee the scroll offset is registered before `scrollToKnownPosition` reads it (await/retry), so step 8 lands on Account Settings, not the footer.
4. **F-4 (Android):** re-derive the Android cutout Y from `useSafeAreaInsets().top` (or measure-relative-to-window) instead of `StatusBar.currentHeight` on Android 15 edge-to-edge; verify on a real Android 15 device.
5. **F-7 (a11y):** make the bubble buttons reachable by VoiceOver/TalkBack (separate a11y ORCH if descoped).

## 10. Regression prevention

- The existing dev-warning (`useCoachMark.ts:69`) already catches orphaned targets — wire a **test/CI assertion** that every `COACH_STEPS` id (except deliberate centered/no-cutout steps) has a `useCoachMark(<id>)` or `registerTargetScrollOffset(<id>)` call site, so a future deletion (like META-ORCH-0929) can't silently orphan a step again.
- A coach-mark snapshot/e2e on one small + one large device per platform that asserts `hasTarget=true` for cutout steps would have caught all of F-1/F-3/F-4 mechanically.

---

## 11. Completion-condition self-check

1. Root causes proven w/ six fields + ≥2 candidates disproven (e.g. step-8: ref-missing vs race — disproved ref-missing via attach sites + no measureLayout error). ✅
2. Pipeline traced backward (symptom→ref wiring) AND forward (first-run journey→terminal onboarding state). ✅
3. Journey mapped, divergences named, confirmed fixing one node ≠ full outcome. ✅
4. External: Android 15 `StatusBar.currentHeight` edge-to-edge quirk cited as `probable` cause for F-4 (flagged for numeric pin at SPEC). iOS notch/island handling verified by on-device measurement. ✅
5. Every pertinent file read in full (useCoachMark, coachMarkSteps, SpotlightOverlay, CoachMarkContext, HomePage region, ProfilePage region, DiscoverScreen/ConnectionsPage attach sites, SwipeableCards render). ✅
6. No DB-object root cause (coach_mark_step schema confirmed current via code; not migration-dependent). ✅
7. Live-fire on 4 devices / 2 platforms with screenshots → `proven`. ✅

**Confidence: HIGH (proven).** Exception: F-4 root cause = `probable` (over-high render proven; exact inset-vs-currentHeight delta to be pinned at SPEC).
