> Parity note: ported from `.claude/skills/mingla-tester/references/ux-coherence-protocol.md` during META-ORCH-0755-B and canonicalized as the shared tester UX reference filename. Codex’s former `ux-accessibility-protocol.md` content was merged below under Accessibility Audit Notes.

# UX Coherence Protocol

Testing that goes beyond "does it render" into "does it work for humans."

---

## The Core Question

For every screen, state, and interaction: would a real person — not a developer,
not someone who knows the codebase — understand what's happening and what to do?

---

## Screen-Level Audit

### First Impression (< 3 seconds)
- [ ] Can you tell what this screen is for within 3 seconds?
- [ ] Is there a clear primary action (what the user is supposed to DO)?
- [ ] Is the visual hierarchy correct? (most important thing = most prominent)
- [ ] Does it feel like it belongs in the same app as neighboring screens?

### Loading State
- [ ] Something visible within 100ms (persisted state or skeleton)?
- [ ] Loading indicator communicates "data is coming" (not blank screen)?
- [ ] If loading takes >2s, is there additional feedback (progress, message)?
- [ ] Can the user navigate away during loading?

### Error State
- [ ] Error message tells the user WHAT happened?
- [ ] Error message tells the user WHAT TO DO (retry, go back, contact support)?
- [ ] Retry action is accessible (button, pull-to-refresh)?
- [ ] Error doesn't look like the empty state (user can distinguish)?
- [ ] Error doesn't blame the user ("Something went wrong" not "You broke it")?

### Empty State
- [ ] Explains WHY it's empty ("Save experiences to see them here")?
- [ ] Provides an ACTION to fix the empty state ("Start exploring" button)?
- [ ] Doesn't look like a bug (clearly intentional empty, not broken)?
- [ ] Doesn't show "No results" when the real problem was an API error?

### Populated State
- [ ] Data is formatted for humans (currency, dates, distances in user's locale)?
- [ ] No raw data visible (slugs, UUIDs, timestamps, JSON)?
- [ ] Long text is truncated or wrapped (no overflow)?
- [ ] Images have fallback for failed loads?
- [ ] Numbers are real (not fabricated defaults like "4.0" rating)?

### Submitting State
- [ ] Button shows loading indicator during submission?
- [ ] Double-tap prevented (button disabled while pending)?
- [ ] User can't navigate away mid-mutation without confirmation?
- [ ] Success gives clear feedback (toast, haptic, visual change)?
- [ ] Failure gives clear feedback AND path to retry?

---

## Interaction Audit

### Tap Targets
- [ ] Every tappable element is at least 44x44pt (iOS) / 48x48dp (Android)?
- [ ] No tap targets overlapping or too close together?
- [ ] Every tap produces visible/haptic feedback?
- [ ] No dead taps (elements that look tappable but do nothing)?

### Swipe/Gesture
- [ ] Swipe direction matches mental model (right = positive, left = dismiss)?
- [ ] Swipe has haptic feedback at threshold?
- [ ] Accidental swipe can be undone (or has undo toast)?
- [ ] Swipe doesn't conflict with system gestures (back swipe, notification pull)?

### Forms / Input
- [ ] Keyboard type matches input (number pad for phone, email for email)?
- [ ] Auto-focus on first field on mount?
- [ ] Next/Done button on keyboard works correctly?
- [ ] Keyboard doesn't cover the active input field?
- [ ] Validation feedback appears at the right time (on blur, not on every keystroke)?
- [ ] Error messages are specific ("Phone must be 10 digits" not "Invalid input")?
- [ ] Required fields are marked (or all fields are required and it's obvious)?

### Destructive Actions
- [ ] Delete/leave/block actions have confirmation dialog?
- [ ] Confirmation dialog clearly states what will happen?
- [ ] Destructive button is red or visually distinct (not same as "OK")?
- [ ] Can undo within a reasonable window? (or is permanent clearly stated?)

---

## Accessibility Audit

### Screen Reader
- [ ] Every interactive element has an accessibility label?
- [ ] Labels describe the ACTION, not the visual ("Save this experience" not "Heart icon")?
- [ ] Reading order makes logical sense (top to bottom, left to right)?
- [ ] Decorative images marked as such (not read by screen reader)?
- [ ] State changes announced (toast/alert accessible)?

### Dynamic Type
- [ ] Text scales with accessibility font size (up to 200%)?
- [ ] Layout doesn't break at large text sizes?
- [ ] No text truncated to invisibility at large sizes?

### Color
- [ ] Information not conveyed by color alone (icons/text supplement)?
- [ ] Text contrast ≥ 4.5:1 (WCAG AA)?
- [ ] Large text contrast ≥ 3:1?
- [ ] Interactive elements distinguishable from static content?

### Motion
- [ ] Animations respect "reduce motion" setting?
- [ ] No essential information conveyed only through animation?
- [ ] No autoplay video/audio without user consent?

---

## Copy Audit

- [ ] All text grammatically correct?
- [ ] Tone consistent with app personality (friendly, clear, concise)?
- [ ] No technical jargon visible to users?
- [ ] No placeholder text ("Lorem ipsum", "TODO", test strings)?
- [ ] Error messages are helpful, not scary?
- [ ] Success messages confirm what happened?
- [ ] Button labels describe the action ("Save" not "OK", "Cancel" not "No")?
- [ ] No blame language ("We couldn't save" not "You failed to save")?
- [ ] Currency, dates, times, distances formatted per user locale?
- [ ] No slugs visible in UI (`Fine Dining` not `fine_dining`)?

---

## Cross-Screen Consistency

- [ ] Same spacing/padding as neighboring screens?
- [ ] Same font sizes and weights as similar content elsewhere?
- [ ] Same color palette and hierarchy?
- [ ] Same animation patterns as similar transitions?
- [ ] Same error/loading/empty patterns as similar screens?
- [ ] Same button styles for same types of actions?
- [ ] Back navigation works and returns to expected screen?

---

## Platform-Specific

### iOS
- [ ] Safe areas respected (Dynamic Island, home bar)?
- [ ] Haptic feedback on key interactions?
- [ ] Swipe-back gesture works for dismissal?
- [ ] Pull-to-refresh where expected?

### Android
- [ ] Hardware back button works on every screen?
- [ ] Material-style feedback (ripple on tap)?
- [ ] Status bar color matches screen?
- [ ] Keyboard input mode correct (`adjustResize` vs `adjustPan`)?

---

## Severity Guide for UX Findings

| Issue | Severity |
|-------|----------|
| Dead tap (element does nothing) | P0 — constitutional violation |
| Blank screen on load/error/empty | P1 — feature broken |
| Fabricated data visible | P0 — constitutional violation |
| Slug visible instead of display name | P1 — data display broken |
| Missing accessibility label | P2 — pattern deviation |
| Inconsistent spacing vs neighbors | P3 — minor inconsistency |
| Copy could be clearer | P3 — improvement |
| Exemplary state handling | P4 — praise |

---

## Accessibility Audit Notes From Former Codex `ux-accessibility-protocol.md`

The former Codex tester file emphasized these accessibility and platform checks; keep them as part of UX coherence review rather than a separate filename:

- Interactive elements have accessibility labels that describe the action, not the icon shape.
- Reading/focus order is logical.
- Color is not the only signal.
- Text contrast meets WCAG AA where practical.
- Dynamic text does not break critical layouts.
- Motion is not the only way information appears.
- Mobile checks include safe areas, keyboard obstruction, small screens, large phones, Android hardware back, and iOS gestures/home bar/Dynamic Island.
- Business/admin/web checks include responsive breakpoints, coherent table/card overflow, local design-system loading/error/empty states, and dark/light mode when supported.
