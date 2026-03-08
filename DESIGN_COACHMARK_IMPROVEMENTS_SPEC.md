# Design Spec: Coachmark System Overhaul
**Date:** 2026-03-07
**Designer:** UX Designer (AI)
**Status:** Ready for Engineering

---

## 1. Overview

The coachmark education system has 9 identified bugs that collectively make it unreliable, screen-unaware, and frustrating. Users accidentally dismiss coachmarks they never read, tooltips clip off-screen because placement uses a hardcoded height guess instead of measuring themselves, and there's no way to recover from any of this. This spec fixes every issue with surgical precision while preserving the existing architecture.

**Core behavioral principle:** A coachmark the user never reads is worse than no coachmark at all --- it wastes a teaching moment and creates confusion. Every fix in this spec serves one goal: **ensure the user actually reads and acknowledges each tip before it's marked complete.**

---

## 2. Success Metrics

| Metric | Type | Current (Estimated) | Target |
|--------|------|---------------------|--------|
| Coachmark read-through rate (Got It / Shown) | Primary | ~40% (many accidental dismissals) | >85% |
| Coachmark completion rate per group | Secondary | Low (session limit + accidental dismissal) | >60% in first 3 sessions |
| User complaints about "tips I can't read" | Guardrail | Nonzero | Zero |
| Onboarding drop-off rate | Guardrail | Current baseline | Must not increase |

---

## 3. Bug-by-Bug Fix Specifications

### Fix 1: Backdrop Tap Does Nothing (Critical)

**Current behavior:** Tapping the dark backdrop calls `handleGotIt()` which permanently marks the coachmark as completed.

**New behavior:** Tapping the dark backdrop does **absolutely nothing**. The overlay absorbs the touch (preventing interaction with underlying UI) but produces no dismissal, no animation, no state change. The user MUST press one of the explicit buttons on the tooltip card to dismiss.

**Files changed:**
- `CoachMarkOverlay.tsx`

**Exact changes:**

```
COMPONENT: CoachMarkOverlay (Modified)

INTERACTION: Backdrop tap
TRIGGER: tap on dark overlay area (outside tooltip and spotlight)
FEEDBACK:
  - Haptic: none
  - Visual: none --- the backdrop simply absorbs the touch
  - Timing: n/a
RESULT: Nothing. Touch is consumed to prevent pass-through to underlying UI.

IMPLEMENTATION:
- Remove `onPress={handleOverlayPress}` from the backdrop Pressable
- Keep the Pressable wrapper (it must still block touches to underlying UI)
- Delete the `handleOverlayPress` callback entirely
- The Pressable becomes a touch-absorbing shield, not a dismiss trigger
```

**Rationale (Fogg Behavior Model):** The user's Ability to accidentally dismiss drops to zero. The Prompt (the "Got it" button) is the only path forward. This guarantees Motivation has time to form --- the user reads the content because there's no shortcut past it.

---

### Fix 2: Self-Measuring Tooltip with Dynamic Positioning (High)

**Current behavior:** `getTooltipTop()` uses a hardcoded `300` as the tooltip height. Tooltips clip off-screen or flip incorrectly.

**New behavior:** The tooltip measures its own rendered height via `onLayout`, then positions itself using the actual measured value. Positioning runs in two phases: render invisibly, measure, then animate into the correct position.

**Files changed:**
- `CoachMarkTooltip.tsx`

**Exact changes:**

```
COMPONENT: CoachMarkTooltip (Modified)

NEW STATE:
  - measuredHeight: number | null (starts null, set by onLayout)

POSITIONING LOGIC (replaces getTooltipTop):

  Phase 1 --- Invisible render:
    - Tooltip renders with opacity: 0 and position off-screen (top: -9999)
    - onLayout fires, captures actual rendered height
    - Sets measuredHeight state

  Phase 2 --- Position calculation (runs when measuredHeight is set):
    - Inputs: targetLayout, measuredHeight, screenHeight, safeAreaTop, safeAreaBottom
    - For position === 'center':
        top = (screenHeight - measuredHeight) / 2
    - For position === 'above':
        candidateTop = target.y - GAP - measuredHeight
        if candidateTop < safeAreaTop + STATUS_BAR_CLEARANCE:
          flip to below: top = target.y + target.height + GAP
        else:
          top = candidateTop
    - For position === 'below':
        candidateTop = target.y + target.height + GAP
        if candidateTop + measuredHeight > screenHeight - safeAreaBottom - TAB_BAR_HEIGHT:
          flip to above: top = target.y - GAP - measuredHeight
        else:
          top = candidateTop
    - Final clamp: top = clamp(top, safeAreaTop + 8, screenHeight - safeAreaBottom - TAB_BAR_HEIGHT - measuredHeight)

  Phase 3 --- Animate in:
    - Once position is calculated, set the real top value
    - Run the existing entrance animation (translateY + opacity)

CONSTANTS:
  - GAP: 16 (unchanged)
  - TOOLTIP_MARGIN: 24 (unchanged, horizontal)
  - STATUS_BAR_CLEARANCE: 8 (extra breathing room below safe area top)
  - TAB_BAR_HEIGHT: 80 (approximate, accounts for tab bar + home indicator)

SAFE AREA:
  - Use react-native-safe-area-context's useSafeAreaInsets()
  - safeAreaTop = insets.top
  - safeAreaBottom = insets.bottom
```

**Design token references:**
- GAP: `spacing.md` (16)
- TOOLTIP_MARGIN: `spacing.lg` (24)
- STATUS_BAR_CLEARANCE: `spacing.sm` (8)

---

### Fix 3: Safe Area Awareness (High)

**Current behavior:** Magic numbers `60` (top) and `screenHeight - 40` (bottom).

**New behavior:** All boundary calculations use actual device safe area insets from `react-native-safe-area-context`.

**Files changed:**
- `CoachMarkTooltip.tsx` (integrated into Fix 2)
- `CoachMarkOverlay.tsx` (pass insets down)
- `CoachMarkProvider.tsx` (must be inside SafeAreaProvider --- verify)

**Exact changes:**

```
DEPENDENCY: react-native-safe-area-context (already in project via Expo)

CoachMarkOverlay changes:
  - Import useSafeAreaInsets
  - Pass insets to CoachMarkTooltip as a prop

CoachMarkTooltip changes:
  - Accept insets prop: { top: number, bottom: number }
  - Replace hardcoded 60 with: insets.top + STATUS_BAR_CLEARANCE
  - Replace hardcoded screenHeight - 40 with: screenHeight - insets.bottom - TAB_BAR_HEIGHT

CoachMarkProvider verification:
  - Confirm it renders inside <SafeAreaProvider> (from app entry point)
  - If not, wrap or move --- insets won't work without the provider
```

---

### Fix 4: Re-measure Target at Show Time + Scroll Guard (High)

**Current behavior:** Targets measured once on `onLayout`. If the user scrolls, the measurement is stale. `showNext()` re-measures via `measureInWindow`, but if the target scrolled off-screen, it gets silently dropped from the queue and never returns.

**New behavior:**
1. `showNext()` still re-measures (good --- keep this)
2. If `measureInWindow` returns zero dimensions, the mark stays in the queue instead of being removed --- it gets retried next time `showNext()` runs
3. Add a visibility check: only show coachmarks for targets that are within the visible viewport

**Files changed:**
- `coachMarkStore.ts`

**Exact changes:**

```
showNext() changes:

CURRENT (line 124-133):
  if (width <= 0 || height <= 0) {
    // Target is off-screen or collapsed --- skip to next
    set({ isMeasuring: false, queue: s.queue.filter(m => m.id !== candidate.id) });
    setTimeout(() => get().showNext(), 16);
    return;
  }

NEW:
  if (width <= 0 || height <= 0) {
    // Target not measurable --- keep in queue, try next candidate
    set({ isMeasuring: false });
    // Don't remove from queue --- it may become visible later
    setTimeout(() => get().showNext(), 16);
    return;
  }

  // Viewport bounds check (screen-aware)
  // If the target center is off-screen, skip but keep in queue
  const centerY = y + height / 2;
  if (centerY < 0 || centerY > SCREEN_HEIGHT) {
    set({ isMeasuring: false });
    // Target scrolled off --- retry later, don't drop
    return;
  }
```

**Additional change --- re-evaluate queue on scroll:**
- This is NOT recommended as a scroll listener (performance cost)
- Instead, when `showNext()` is called and finds no visible targets, it simply stops
- The next trigger (tab visit, action, cooldown expiry) will call `showNext()` again
- Targets that become visible will be found at that point

---

### Fix 5: Entrance Animation Protection (Critical)

**Current behavior:** The backdrop `Pressable` is active from frame 1 of the entrance animation, when the overlay is still invisible. A mid-flight tap dismisses the coachmark.

**New behavior:** Touch interaction on the entire overlay is disabled during the entrance animation. Only after the animation completes do the buttons become tappable.

**Files changed:**
- `CoachMarkOverlay.tsx`

**Exact changes:**

```
NEW STATE:
  - isEntranceComplete: boolean (starts false, set true after animation .start() callback)

ANIMATION CHANGE:
  - In the entrance Animated.parallel().start() callback:
    setIsEntranceComplete(true)

RENDER CHANGE:
  - The outer View gets: pointerEvents={isEntranceComplete ? 'auto' : 'none'}
  - During entrance animation, ALL touches pass through (the user can still interact
    with the app --- the overlay is transparent anyway)
  - Once animation completes, the overlay captures touches

  Wait --- this conflicts with the backdrop needing to block touches.
  Better approach:

  - The outer View: pointerEvents="box-none" (unchanged)
  - The backdrop Pressable: pointerEvents={isEntranceComplete ? 'auto' : 'none'}
    During animation: touches pass through backdrop (overlay still fading in, user
    shouldn't be blocked by something they can't see)
    After animation: backdrop absorbs touches (prevents underlying interaction)
  - The tooltip buttons: disabled={!isEntranceComplete}
    During animation: buttons not pressable (prevents accidental tap)
    After animation: buttons active

RESET:
  - When isVisible becomes false or currentMark changes, reset isEntranceComplete to false
```

**Rationale (Cognitive Load Theory):** The user's brain needs ~500ms to register the overlay appearing and shift attention. Protecting the entrance window respects this cognitive processing time.

---

### Fix 6: Smarter Session Management (Medium)

**Current behavior:** Hard cap of 3 marks per session. No user communication about remaining tips. Sequential learning breaks across sessions.

**New behavior:** Increase to 5 marks per session. Add a subtle progress indicator to the tooltip showing position in the current group sequence.

**Files changed:**
- `coachMarkStore.ts`
- `CoachMarkTooltip.tsx`

**Exact changes:**

```
coachMarkStore.ts:
  - Change MAX_MARKS_PER_SESSION from 3 to 5
  - Rationale: the explore tab has 9 marks. 5 per session means the user sees
    the core experience (welcome + swipe right + swipe left + tap + solo mode)
    in one sitting, with the rest on return. 3 was too aggressive.

CoachMarkTooltip.tsx:
  - Add a step indicator below the body text, above the action buttons
  - Format: "3 of 9" (current position in the group's total marks)
  - Only show for groups with > 1 mark
  - Style: typography.xs, color: colors.gray.400, textAlign: center

COMPONENT: Step Indicator
  TYPE: Inline element within CoachMarkTooltip
  STYLE:
    - fontSize: 12 (typography.xs)
    - lineHeight: 16
    - color: colors.gray.400 (#9ca3af)
    - textAlign: center
    - marginBottom: spacing.md (16)

CALCULATION:
  - Total marks in group: count of COACH_MARKS where group === currentMark.group
  - Current position: count of completedIds that belong to this group + 1
  - Display: "{position} of {total}"
```

---

### Fix 7: Cooldown Respects Navigation (Medium)

**Current behavior:** Cooldown blocks `showNext()` for 5 seconds. If the user navigates to a new tab during cooldown, coachmarks for that tab don't show until cooldown fires its own `showNext()` --- by which time context may have changed.

**New behavior:** Reduce cooldown to 3 seconds. When a new `tab_first_visit` trigger fires during cooldown, clear the cooldown and apply the new trigger's delay instead.

**Files changed:**
- `coachMarkStore.ts`
- `useCoachMarkEngine.ts`

**Exact changes:**

```
coachMarkStore.ts:
  - Change COOLDOWN_MS from 5000 to 3000
  - Add new action: clearCooldown()
    set({ cooldownActive: false })
    (Also clear the pending cooldown timeout --- store the timeout ID)

  - Store the cooldown timeout ID:
    cooldownTimerId: ReturnType<typeof setTimeout> | null (transient state)

  - In dismiss():
    const timerId = setTimeout(() => { ... }, COOLDOWN_MS);
    set({ cooldownTimerId: timerId });

  - In clearCooldown():
    const state = get();
    if (state.cooldownTimerId) clearTimeout(state.cooldownTimerId);
    set({ cooldownActive: false, cooldownTimerId: null });

useCoachMarkEngine.ts:
  - In the tab_first_visit effect, before scheduling showNext():
    if (state.cooldownActive) {
      state.clearCooldown();
    }
    // Then proceed with the normal delay-based showNext()
```

---

### Fix 8: Spotlight Tracks Target Position (Medium)

**Current behavior:** Spotlight and glow are positioned once using `measureInWindow` at show time. If content shifts, they drift.

**New behavior:** Lock scrolling on the underlying content while a coachmark is visible. This is simpler and more reliable than trying to track a moving target.

**Files changed:**
- `CoachMarkOverlay.tsx` (or parent component)

**Exact changes:**

```
APPROACH: Scroll lock while coachmark is visible

When isVisible === true:
  - The overlay already covers the full screen
  - The backdrop Pressable already absorbs touches (after Fix 1)
  - Since backdrop absorbs all touches, the user CANNOT scroll underlying content
  - The spotlight position stays accurate because nothing moved
  - No additional scroll lock code needed --- Fix 1 implicitly solves this

VERIFICATION:
  - With Fix 1 in place (backdrop absorbs touches, no dismiss on tap),
    the user cannot interact with underlying scrollable content
  - The spotlight remains aligned because the content is static
  - When the coachmark dismisses, scrolling resumes naturally

This is the simplest correct solution. No scroll listeners, no position tracking,
no performance overhead.
```

**Note:** This works because with Fix 1 + Fix 5, the overlay becomes a proper modal --- it blocks all interaction until explicitly dismissed. This is intentional and correct behavior for educational tooltips.

---

### Fix 9: "Replay Tips" in Profile Settings (High)

**Current behavior:** No way to re-read dismissed coachmarks. Ever.

**New behavior:** Add a "Replay Tips" option in the Profile settings section. Tapping it resets all coachmark progress, allowing the user to see every tip again from scratch.

**Files changed:**
- `ProfilePage.tsx` (add the setting row)
- `coachMarkStore.ts` (add resetAllProgress action)
- `coachMarkService.ts` (add deleteAllProgress method)

**Exact changes:**

```
COMPONENT: Replay Tips Row (New --- inline in ProfilePage settings section)

LOCATION: Inside the existing settings section, after the activity status toggle,
before any destructive actions (logout, delete account).

LAYOUT:
  - Standard settings row matching existing pattern in ProfilePage
  - Left: Ionicons "refresh-outline" icon, size 22, color: colors.primary.500
  - Center: "Replay Tips" label
  - Right: Chevron or nothing (single-action row)

INTERACTION:
  TRIGGER: tap
  FEEDBACK:
    - Haptic: Haptics.impactAsync(ImpactFeedbackStyle.Light)
    - Visual: opacity press feedback (matching existing settings rows)
  RESULT:
    1. Show confirmation alert: "Replay all tips? You'll see every tutorial tip again
       as if it's your first time."
       - "Replay" button (destructive style --- though it's not truly destructive)
       - "Cancel" button
    2. On confirm:
       - Call coachMarkStore.resetAllProgress()
       - Call coachMarkService.deleteAllProgress(userId)
       - Show brief success toast or inline confirmation

coachMarkStore.ts:
  NEW ACTION: resetAllProgress()
    set({
      completedIds: [],
      sessionCount: 0,
      cooldownActive: false,
      queue: [],
      currentMark: null,
      currentTargetLayout: null,
      isVisible: false,
      visitedTabs: [],
      firedActions: [],
    });

coachMarkService.ts:
  NEW METHOD: async deleteAllProgress(userId: string): Promise<void>
    const { error } = await supabase
      .from('coach_mark_progress')
      .delete()
      .eq('user_id', userId);
    if (error) console.error('Failed to reset coach mark progress:', error);

ACCESSIBILITY:
  - accessibilityLabel: "Replay Tips"
  - accessibilityRole: "button"
  - accessibilityHint: "Resets all tutorial tips so you can see them again"
  - Touch target: minimum 44pt height (matching existing rows)

COPY:
  - Row label: "Replay Tips"
  - Alert title: "Replay all tips?"
  - Alert body: "You'll see every tutorial tip again as if it's your first time."
  - Confirm button: "Replay"
  - Cancel button: "Cancel"
```

---

## 4. Updated Component Specifications

### 4.1 CoachMarkOverlay (Modified)

```
COMPONENT: CoachMarkOverlay
TYPE: Modified
LOCATION: components/education/CoachMarkOverlay.tsx

PROPS: (unchanged --- reads from store)

NEW STATE:
  - isEntranceComplete: boolean

BEHAVIOR CHANGES:
  1. Backdrop tap does nothing (touch absorbed, no callback)
  2. Entrance animation sets isEntranceComplete = true on completion
  3. Buttons disabled during entrance animation
  4. Safe area insets passed to tooltip

STATES:
  - hidden: returns null (unchanged)
  - animating-in: overlay fading in, buttons disabled, touches pass through
  - visible: overlay fully shown, buttons active, backdrop absorbs touches
  - animating-out: overlay fading out (triggered only by button press)

ACCESSIBILITY:
  - accessibilityViewIsModal: true (when visible)
  - Backdrop: accessibilityLabel "Tutorial tip overlay"
  - Focus should move to the tooltip when it appears
```

### 4.2 CoachMarkTooltip (Modified)

```
COMPONENT: CoachMarkTooltip
TYPE: Modified
LOCATION: components/education/CoachMarkTooltip.tsx

PROPS:
  - mark: CoachMarkDefinition (unchanged)
  - targetLayout: TargetLayout (unchanged)
  - translateY: Animated.Value (unchanged)
  - opacity: Animated.Value (unchanged)
  - onGotIt: () => void (unchanged)
  - onSkipAll: () => void (unchanged)
  - insets: { top: number; bottom: number } (NEW)
  - isInteractive: boolean (NEW --- controls button disabled state)
  - groupProgress: { current: number; total: number } (NEW)

NEW STATE:
  - measuredHeight: number | null

POSITIONING:
  - Two-phase: invisible measure, then position + animate
  - Uses measuredHeight instead of hardcoded 300
  - Uses insets instead of magic numbers
  - Clamps to safe viewport bounds

NEW ELEMENT: Step indicator
  - Renders between body text and action buttons
  - Shows "{current} of {total}" for multi-mark groups
  - Hidden for single-mark groups

STYLE TOKENS USED:
  - background: colors.primary.50 (#fff7ed) --- replaces hardcoded #fdf6f0
  - title text: colors.text.primary (#111827)
  - body text: colors.text.secondary (#4b5563)
  - step indicator: colors.gray.400 (#9ca3af)
  - Got It button background: colors.primary.500 (#f97316)
  - Got It button text: colors.text.inverse (#ffffff)
  - Skip All text: colors.gray.400 (#9ca3af)
  - accent line: colors.primary.500 (#f97316)
  - shadow: shadows.lg token
  - padding: spacing.lg (24)
  - border radius: radius.xl (24)
  - button border radius: radius.lg (16)
  - button paddingVertical: 14
  - button paddingHorizontal: spacing.xl (32)
  - gap between buttons: spacing.md (16)
  - illustration margin bottom: spacing.md (16)
  - title margin bottom: spacing.sm (8)
  - body margin bottom: spacing.sm (8)
  - step indicator margin bottom: spacing.lg (24) --- was body's old marginBottom

BUTTON STATES:
  - Got It:
    - default: colors.primary.500 background, white text
    - pressed: scale 0.95 (existing animation), slight darken via opacity
    - disabled (during entrance): opacity 0.5, no press response
  - Skip All:
    - default: transparent background, colors.gray.400 text
    - pressed: colors.gray.500 text
    - disabled (during entrance): opacity 0.5, no press response
```

---

## 5. Interaction & Animation Specifications

### 5.1 Entrance Animation (Modified)

```
INTERACTION: Coachmark entrance
TRIGGER: isVisible becomes true + currentMark set + currentTargetLayout set
FEEDBACK:
  - Haptic: ImpactFeedbackStyle.Light (unchanged)
  - Visual: Phased animation (unchanged timing, new protection)
  - Timing:
    Phase 1 (invisible measure): ~16ms (one frame for onLayout)
    Phase 2 (animate in):
      Mask opacity: 0 -> 1, 400ms, ease-out
      Glow scale: 0.9 -> 1, spring (tension 100, friction 8)
      Glow opacity: 0 -> 1, 300ms
      Tooltip translateY: 30 -> 0, 500ms, ease-out
      Tooltip opacity: 0 -> 1, 300ms
    Phase 3 (interactive): buttons become active after animation .start() callback

RESULT: Coachmark fully visible and interactive. isEntranceComplete = true.

PROTECTION:
  - All touch targets disabled until Phase 3 completes
  - pointerEvents on backdrop: 'none' during Phase 1+2, 'auto' during Phase 3+
```

### 5.2 Dismissal Animation (Modified --- trigger only)

```
INTERACTION: Got It button press
TRIGGER: tap on "Got It" button (only when isEntranceComplete === true)
FEEDBACK:
  - Haptic: Haptics.selectionAsync() (unchanged)
  - Visual: All elements animate out over 300ms (unchanged)
RESULT: dismiss() called after animation completes. Mark completed permanently.

INTERACTION: Skip All button press
TRIGGER: tap on "Skip All" (only when isEntranceComplete === true)
FEEDBACK:
  - Haptic: ImpactFeedbackStyle.Light (unchanged)
  - Visual: Same 300ms exit animation
RESULT: skipGroup() called after animation completes. All group marks completed.

INTERACTION: Backdrop tap
TRIGGER: tap on dark overlay area
FEEDBACK: NONE
RESULT: NOTHING. Touch absorbed silently.
```

---

## 6. Behavioral Design

### 6.1 The Corrected Hook Cycle

```
HOOK CYCLE: Coachmark Education

TRIGGER:
  External: Coachmark overlay appears on tab visit / action / element visibility
  Internal (target): User anticipates tips on new features, actively looks for them

ACTION:
  Read the tip content -> Press "Got it" (single deliberate tap)
  Friction audit: 1 tap to dismiss (down from potential 0 --- accidental tap)
  The friction is INTENTIONAL here --- we want cognitive engagement, not speed

VARIABLE REWARD:
  Type: Self (mastery)
  What varies: Different tip content per screen, progress indicator shows advancement
  Example rewards: "3 of 9" -> sense of progression, milestone celebrations at group completion

INVESTMENT:
  The user's growing familiarity with the app IS the investment.
  Each completed tip makes the next session more valuable because they know more features.
  Replay Tips option = safety net that removes fear of missing out.
```

### 6.2 Friction Map (Post-Fix)

| Step | Cognitive Load (1-5) | Physical Effort (1-5) | Time Cost (sec) | Notes |
|------|---------------------|----------------------|-----------------|-------|
| Coachmark appears | 2 | 0 | 0.5 (animation) | Low --- attention captured by spotlight |
| Read title + body | 2 | 0 | 3-5 | Appropriate --- this is the learning moment |
| Check step indicator | 1 | 0 | 0.5 | Quick context on progress |
| Press "Got it" | 1 | 1 | 0.3 | Deliberate acknowledgment |
| **Total** | **~2 avg** | **1** | **~4-6** | Appropriate for education |

### 6.3 Delight Moment

```
DELIGHT MOMENT: Step Indicator Progress
WHERE: Every coachmark tooltip, below body text
WHAT: User sees "3 of 9" and realizes they're making progress through the tutorial
WHY: Zeigarnik Effect --- incomplete sequences create psychological drive to complete.
     Seeing progress builds momentum. Combined with milestone celebrations at group
     completion, this creates a satisfying mastery arc.
IMPLEMENTATION:
  - Visual: Small text, colors.gray.400, centered
  - Haptic: none (delight comes from information, not feedback)
  - Copy: "{n} of {total}"
```

---

## 7. Design Token Changes

### 7.1 Tooltip Background Color Correction

**Current:** Hardcoded `#fdf6f0` in CoachMarkTooltip styles
**Proposed:** Use `colors.primary.50` (`#fff7ed`) from the design system

These are nearly identical warm whites, but the spec should reference the token, not a custom hex. The visual difference is imperceptible.

### 7.2 No New Tokens Required

All other values map to existing tokens:
- Glow border color: `colors.primary.500` (#f97316)
- Backdrop: `rgba(0, 0, 0, 0.72)` (custom --- overlay opacity is not a reusable token)
- All typography maps to existing scale
- All spacing maps to existing scale
- All radii map to existing scale

---

## 8. Accessibility Notes

- **accessibilityViewIsModal: true** on the overlay when visible --- screen readers should focus only on the tooltip, not underlying content
- **Focus management:** When coachmark appears, focus should move to the tooltip title. When dismissed, focus returns to the spotlighted element.
- **Button touch targets:** "Got it" button is already well-sized (paddingVertical: 14 + text height > 44pt). "Skip all" has `hitSlop={8}` --- verify total tappable area >= 44pt.
- **Reduced motion:** If `AccessibilityInfo.isReduceMotionEnabled()`, skip all entrance/exit animations --- show/hide instantly. The two-phase measure-then-position still applies (just without animation).
- **Dynamic type:** Tooltip text should scale with accessibility font size. The self-measuring tooltip (Fix 2) naturally handles this --- taller text = taller measured height = correct positioning.
- **Color contrast:** Title (#111827 on #fff7ed) = 15.4:1 ratio. Body (#4b5563 on #fff7ed) = 6.8:1 ratio. Both pass WCAG AAA.

---

## 9. Copy Deck

All existing coachmark copy (titles and bodies in `constants/coachMarks.ts`) remains unchanged. New copy only:

| Location | Element | Copy |
|----------|---------|------|
| CoachMarkTooltip | Step indicator | "{n} of {total}" |
| ProfilePage | Settings row label | "Replay Tips" |
| ProfilePage | Alert title | "Replay all tips?" |
| ProfilePage | Alert body | "You'll see every tutorial tip again as if it's your first time." |
| ProfilePage | Alert confirm button | "Replay" |
| ProfilePage | Alert cancel button | "Cancel" |

---

## 10. Edge Cases & Open Questions

### Edge Cases Handled
1. **User rotates device mid-coachmark:** `useWindowDimensions` updates, but the tooltip position was already calculated. The coachmark should dismiss and re-queue on orientation change. (Low priority --- Mingla likely locks to portrait.)
2. **User backgrounds app during coachmark:** The `AppState` listener in CoachMarkProvider handles this. The coachmark's `isVisible` state persists, so it reappears on foreground. No change needed.
3. **Target unmounts while coachmark is showing:** `unregisterTarget` fires, but the coachmark is already displayed with a snapshot of the layout. The coachmark shows to completion --- no issue.
4. **Replay Tips during an active coachmark:** `resetAllProgress()` sets `isVisible: false` and clears `currentMark`, so the active coachmark disappears immediately. Clean.

### Open Questions for Product
1. **Should "Skip all" skip just the current group or ALL remaining coachmarks?** Currently it skips the group. This spec preserves that behavior. Confirm this is desired.
2. **Should there be a brief delay before "Replay Tips" triggers the first new coachmark?** Recommend yes --- 2 second delay after reset before the engine starts evaluating triggers, so the user has time to navigate away from profile settings.

---

## 11. Implementation Notes for Engineer

### Priority Order
Implement in this order (each fix is independently shippable):
1. **Fix 1 (backdrop tap)** + **Fix 5 (entrance protection)** --- These two together eliminate the critical accidental-dismissal problem. Ship these first.
2. **Fix 2 (self-measuring tooltip)** + **Fix 3 (safe area)** --- These fix the placement bugs. Naturally coupled.
3. **Fix 4 (scroll guard)** --- Keeps marks in queue instead of dropping them.
4. **Fix 7 (cooldown)** --- Small store change.
5. **Fix 6 (session limit + progress)** --- UI addition to tooltip.
6. **Fix 9 (replay tips)** --- New feature, lowest urgency.
7. **Fix 8 (spotlight drift)** --- Already solved by Fix 1 implicitly.

### Existing Patterns to Follow
- `useSafeAreaInsets()` is used elsewhere in the app (check imports) --- follow the same pattern
- Settings rows in ProfilePage follow a consistent pattern --- match the existing row style exactly
- Store actions follow the `get()` + `set()` pattern with no async --- keep `resetAllProgress` synchronous (the Supabase call is fire-and-forget in the provider)

### Testing Checklist
- [ ] Tap backdrop 100 times --- coachmark must never dismiss
- [ ] Tap rapidly during entrance animation --- no dismissal
- [ ] Verify tooltip never clips off-screen on: iPhone SE, iPhone 15 Pro Max, iPhone 16 Pro (Dynamic Island)
- [ ] Verify "above" -> "below" flip works with actual measured height
- [ ] Verify "below" -> "above" flip works for bottom-of-screen targets (tab bar items)
- [ ] Navigate between tabs during cooldown --- verify new tab's coachmarks appear after delay
- [ ] Replay Tips: verify all progress reset, tips show again on tab visit
- [ ] Verify step indicator shows correct "n of total" for each group
- [ ] Verify milestone celebrations still trigger after all group marks completed
- [ ] Verify coachmarks for scrolled-off targets stay in queue and show when user returns
