# DESIGN SPEC: ORCH-0434 Phase 6 — Preferences Sheet Visual Design

**Version:** 1.0
**Date:** 2026-04-15
**Companion to:** SPEC_ORCH-0434_PHASE6_PREFERENCES_SHEET.md (functional spec)
**Design system source:** `app-mobile/src/constants/designSystem.ts`

---

## Design Philosophy

This sheet is the user's command center — the single place they tell Mingla what they
want. It must feel premium, intentional, and warm. Not clinical. Not cluttered.
Every section breathes. Every interaction confirms. The user should feel like they're
curating something personal, not filling out a form.

**Visual rhythm:** Spacious sections, consistent pill sizing, warm orange as the
single accent color against a clean neutral canvas. No competing colors on structural
elements. Category pills get their own personality colors — everything else speaks Mingla
orange.

---

## 1. Sheet Container

| Property | Value | Token |
|----------|-------|-------|
| Background | `#ffffff` | `colors.background.primary` |
| Full screen overlay | `true` | — |
| Safe area | Top + bottom insets | `useSafeAreaInsets()` |
| StatusBar | `dark-content` | — |
| Bottom padding | `120px` (space for Lock In button + safe area) | — |

---

## 2. Header

| Property | Value | Token |
|----------|-------|-------|
| Height | `56px` | — |
| Padding horizontal | `20px` | `spacing.xl - 12` |
| Background | `#ffffff` | `colors.background.primary` |
| Border bottom | `1px solid #e5e7eb` | `colors.gray[200]` |

### Title (solo mode)

| Property | Value | Token |
|----------|-------|-------|
| Text | "Your Vibe" | `t('preferences:sheet.title')` |
| Font size | `20px` | `typography.xl.fontSize` |
| Font weight | `700` | `fontWeights.bold` |
| Color | `#111827` | `colors.text.primary` |

### Title (collab mode)

| Property | Value | Token |
|----------|-------|-------|
| Text | "{name} Vibes" | `t('preferences:sheet.session_vibes')` |
| Font size | `18px` | `typography.lg.fontSize` |
| Font weight | `600` | `fontWeights.semibold` |
| Color | `#111827` | `colors.text.primary` |
| adjustsFontSizeToFit | `true`, min scale `0.75` | — |

---

## 3. Section Layout (universal)

Every section follows this vertical rhythm:

| Property | Value | Token |
|----------|-------|-------|
| Padding horizontal | `20px` | `spacing.xl - 12` (match header) |
| Margin top (between sections) | `28px` | — |
| Section title font size | `16px` | `typography.md.fontSize` |
| Section title font weight | `600` | `fontWeights.semibold` |
| Section title color | `#111827` | `colors.text.primary` |
| Section title margin bottom | `4px` | `spacing.xs` |
| Section subtitle font size | `14px` | `typography.sm.fontSize` |
| Section subtitle font weight | `400` | `fontWeights.regular` |
| Section subtitle color | `#6b7280` | `colors.text.tertiary` |
| Section subtitle margin bottom | `14px` | — |

First section (Starting Point) has `marginTop: 20px` instead of 28.

---

## 4. Pill System (universal)

All pills across the sheet share these dimensions for visual consistency:

### Standard Pill (Date options, Travel modes)

| Property | Value | Token |
|----------|-------|-------|
| Height | `40px` | — |
| Padding horizontal | `16px` | `spacing.md` |
| Border radius | `16px` | `radius.lg` |
| Min width | `0` (content-sized) | — |
| Gap between pills | `10px` | — |
| Container | `flexDirection: 'row', flexWrap: 'wrap'` | — |

### Pill States

| State | Background | Text Color | Text Weight | Border |
|-------|-----------|------------|-------------|--------|
| **Unselected** | `#f3f4f6` | `#4b5563` | `500` | none |
| **Selected** | `#eb7825` | `#ffffff` | `600` | none |
| **Disabled** | `#f3f4f6` | `#d1d5db` | `400` | none |

Token refs: `colors.background.tertiary`, `colors.text.secondary`, `colors.accent`, `colors.text.inverse`, `colors.gray[300]`

Pill text: `typography.sm` (14px)

### Intent Pill (larger — emotional, descriptive)

| Property | Value | Token |
|----------|-------|-------|
| Height | `48px` | `touchTargets.comfortable` |
| Padding horizontal | `16px` | `spacing.md` |
| Border radius | `16px` | `radius.lg` |
| Icon size | `18px` | — |
| Icon margin right | `8px` | `spacing.sm` |
| Label font size | `14px` | `typography.sm.fontSize` |
| Gap between pills | `10px` | — |
| Layout | `flexWrap: 'wrap'` 2-3 per row | — |

Same state colors as Standard Pill.

When selected, the icon and text both turn white.

### Category Pill (2-column grid)

| Property | Value | Token |
|----------|-------|-------|
| Height | `48px` | `touchTargets.comfortable` |
| Padding horizontal | `14px` | — |
| Border radius | `16px` | `radius.lg` |
| Icon size | `18px` | — |
| Icon margin right | `8px` | `spacing.sm` |
| Label font size | `13px` | — |
| Layout | 2-column grid, `gap: 10px` | — |
| Column width | `(SCREEN_WIDTH - 40 - 10) / 2` | 50% minus padding and gap |

Same state colors as Standard Pill.

---

## 5. Section 1: Starting Point

No visual changes from current implementation. Moves to position 1.

### GPS Toggle Row

| Property | Value | Token |
|----------|-------|-------|
| Height | `48px` | — |
| Background | `#f3f4f6` | `colors.background.tertiary` |
| Border radius | `12px` | `radius.md` |
| Padding horizontal | `14px` | — |
| Label font size | `14px` | `typography.sm.fontSize` |
| Label color | `#111827` | `colors.text.primary` |
| GPS icon color | `#eb7825` | `colors.accent` |
| Helper text color | `#6b7280` | `colors.text.tertiary` |
| Helper text size | `12px` | `typography.xs.fontSize` |

### Search Input

| Property | Value | Token |
|----------|-------|-------|
| Height | `48px` | — |
| Background | `#f9fafb` | `colors.background.secondary` |
| Border | `1px solid #e5e7eb` | `colors.gray[200]` |
| Border (focused) | `1.5px solid #eb7825` | `colors.accent` |
| Border radius | `12px` | `radius.md` |
| Placeholder color | `#9ca3af` | `colors.gray[400]` |
| Input text color | `#111827` | `colors.text.primary` |

---

## 6. Section 2: When

### Date Option Pills

Three pills in a horizontal row, equal width, filling the container:

| Property | Value |
|----------|-------|
| Layout | `flexDirection: 'row'`, `gap: 10px` |
| Each pill width | `(containerWidth - 20) / 3` |
| Text alignment | `center` |

Use standard pill dimensions and states from §4.

### Weekend Info Card (shown when "This Weekend" selected)

| Property | Value | Token |
|----------|-------|-------|
| Background | `#fff7ed` | `colors.primary[50]` |
| Border radius | `12px` | `radius.md` |
| Padding | `14px` | — |
| Margin top | `12px` | — |
| Icon | `calendar`, 20px, `#ea580c` | `colors.primary[600]` |
| Title | "This Weekend" — `14px`, `600`, `#111827` | — |
| Description | "Friday through Sunday" — `13px`, `400`, `#6b7280` | — |

### Multi-Day Calendar (shown when "Pick Date(s)" selected)

Appears inline below the pills with `marginTop: 14px`. Animates in with `LayoutAnimation`.

#### Calendar Container

| Property | Value | Token |
|----------|-------|-------|
| Background | `#ffffff` | `colors.background.primary` |
| Border | `1px solid #e5e7eb` | `colors.gray[200]` |
| Border radius | `16px` | `radius.lg` |
| Padding | `16px` | `spacing.md` |
| Shadow | `shadows.sm` | subtle lift |

#### Month Header Row

| Property | Value | Token |
|----------|-------|-------|
| Height | `44px` | `touchTargets.minimum` |
| Layout | `row`, `space-between`, `center` |
| Month/Year text | `18px`, `600`, `#111827` | `typography.lg`, `fontWeights.semibold` |
| Arrow buttons | `24px` icon, `44x44` touch target | `touchTargets.minimum` |
| Arrow color | `#4b5563` | `colors.text.secondary` |
| Arrow disabled | `#d1d5db` | `colors.gray[300]` |
| Margin bottom | `8px` | `spacing.sm` |

#### Day-of-Week Headers

| Property | Value | Token |
|----------|-------|-------|
| Layout | 7 equal columns |
| Text | `12px`, `500`, `#6b7280` | `typography.xs`, `fontWeights.medium`, `colors.text.tertiary` |
| Text align | `center` |
| Height | `28px` |

#### Day Grid

| Property | Value | Token |
|----------|-------|-------|
| Layout | 7 columns, 6 rows max |
| Cell size | `40px × 40px` | — |
| Cell touch target | `44px × 44px` (padding) | `touchTargets.minimum` |
| Row height | `44px` | — |
| Text alignment | `center` |

#### Day Cell States (detailed)

**Normal (future, not selected):**
| Property | Value |
|----------|-------|
| Background | transparent |
| Text | `14px`, `400`, `#111827` |

**Today (not selected):**
| Property | Value | Token |
|----------|-------|-------|
| Background | `#fff7ed` (subtle warm glow) | `colors.primary[50]` |
| Border radius | `999px` | `radius.full` |
| Text | `14px`, `600`, `#ea580c` | `fontWeights.semibold`, `colors.primary[600]` |

**Selected:**
| Property | Value | Token |
|----------|-------|-------|
| Background | `#eb7825` | `colors.accent` |
| Border radius | `999px` | `radius.full` |
| Width/Height | `36px` (centered in 40px cell) | — |
| Text | `14px`, `600`, `#ffffff` | `fontWeights.semibold`, `colors.text.inverse` |
| Shadow | `shadowColor: '#eb7825', shadowOpacity: 0.25, shadowRadius: 4, shadowOffset: {0, 2}` | warm glow |

**Today + Selected:**
| Property | Value |
|----------|-------|
| Same as Selected | — |

**Disabled (past):**
| Property | Value | Token |
|----------|-------|-------|
| Background | transparent |
| Text | `14px`, `400`, `#d1d5db` | `colors.gray[300]` |
| Opacity | `0.4` |

**Outside current month:**
Not rendered (empty cell).

#### Selected dates count badge

Below the calendar grid, when dates are selected:

| Property | Value | Token |
|----------|-------|-------|
| Text | "{n} date(s) selected" | — |
| Font | `12px`, `500`, `#eb7825` | `typography.xs`, `fontWeights.medium`, `colors.accent` |
| Margin top | `8px` | `spacing.sm` |
| Alignment | `center` |

---

## 7. Sections 3 & 4: Toggle Sections (Intents & Categories)

### Toggle Header Row

| Property | Value | Token |
|----------|-------|-------|
| Layout | `row`, `space-between`, `center` |
| Padding horizontal | `0` (inherits section padding) |
| Margin bottom | `14px` (when open) / `0` (when closed) | — |

#### Left side (title + subtitle)

| Property | Value | Token |
|----------|-------|-------|
| Title | `16px`, `600`, `#111827` | `typography.md`, `fontWeights.semibold`, `colors.text.primary` |
| Subtitle | `13px`, `400`, `#6b7280` | — |
| Title-subtitle gap | `2px` | `spacing.xxs` |

#### Right side (switch)

React Native `Switch` component:

| Property | Value | Token |
|----------|-------|-------|
| trackColor (true) | `#eb7825` | `colors.accent` |
| trackColor (false) | `#d1d5db` | `colors.gray[300]` |
| thumbColor (iOS) | `#ffffff` | — |
| ios_backgroundColor | `#d1d5db` | `colors.gray[300]` |

### Collapsible Content

| Property | Value |
|----------|-------|
| Animation | `LayoutAnimation.Presets.easeInEaseOut` |
| Overflow | `hidden` |
| When OFF | height `0`, `opacity: 0` (use `LayoutAnimation`, not manual animated value) |
| When ON | natural height, `opacity: 1` |

---

## 8. Section 5: Getting There

Travel mode pills + travel limit input grouped in one section.

### Travel Mode Pills

4 pills in a row, equal width:

| Property | Value |
|----------|-------|
| Layout | `flexDirection: 'row'`, `gap: 10px` |
| Each pill | icon + label stacked vertically |
| Icon size | `20px` |
| Label | `12px`, `500` |
| Pill height | `52px` |
| Pill width | `(containerWidth - 30) / 4` |
| Border radius | `12px` | `radius.md` |

Same selected/unselected color system as Standard Pills.

### Travel Limit Input

| Property | Value | Token |
|----------|-------|-------|
| Layout | section subtitle "Set your travel radius" + horizontal row of preset chips + custom input |
| Preset chips | `15`, `30`, `45`, `60` min — small pill style |
| Chip height | `36px` |
| Chip border radius | `999px` | `radius.full` |
| Chip text | `14px`, `500` |
| Custom input | same as search input style (§5) |
| Spacing between chips | `8px` | `spacing.sm` |

---

## 9. Lock In Button (CTA)

Floating at the bottom of the sheet, above safe area.

### Container

| Property | Value | Token |
|----------|-------|-------|
| Position | Absolute bottom | — |
| Background | `#ffffff` with top border | `colors.background.primary` |
| Border top | `1px solid #e5e7eb` | `colors.gray[200]` |
| Padding horizontal | `20px` | — |
| Padding vertical | `12px` | — |
| Safe area bottom | `insets.bottom` | — |

### Button (enabled)

| Property | Value | Token |
|----------|-------|-------|
| Background | `#eb7825` | `colors.accent` |
| Height | `52px` | — |
| Border radius | `16px` | `radius.lg` |
| Text | "Lock It In" or "Lock It In (N)" | `t('preferences:sheet.lock_it_in')` |
| Text size | `16px` | `typography.md.fontSize` |
| Text weight | `700` | `fontWeights.bold` |
| Text color | `#ffffff` | `colors.text.inverse` |
| Shadow | `shadowColor: '#eb7825', shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: {0, 4}` | warm glow |
| Active opacity | `0.9` |

### Button (disabled)

| Property | Value | Token |
|----------|-------|-------|
| Background | `#e5e7eb` | `colors.gray[200]` |
| Text color | `#9ca3af` | `colors.gray[400]` |
| Shadow | none |

### Hint Text (below disabled button)

| Property | Value | Token |
|----------|-------|-------|
| Text | context-dependent hint | `ctaHintText` |
| Font | `12px`, `400`, `#6b7280` | `typography.xs`, `colors.text.tertiary` |
| Alignment | `center` |
| Margin top | `6px` |

### Start Over link (above button, right-aligned)

| Property | Value | Token |
|----------|-------|-------|
| Text | "Start Over" | `t('preferences:sheet.start_over')` |
| Font | `13px`, `500`, `#eb7825` | `colors.accent` |
| Tap area | `44px` height | `touchTargets.minimum` |

---

## 10. Sequential Section Animation

### Stagger Timing

| Section | Delay | Duration |
|---------|-------|----------|
| Starting Point | `0ms` | `300ms` |
| When | `80ms` | `300ms` |
| Intents | `160ms` | `300ms` |
| Categories | `240ms` | `300ms` |
| Getting There | `320ms` | `300ms` |

### Animation Properties

| Property | From | To | Config |
|----------|------|----|--------|
| `opacity` | `0` | `1` | `Animated.timing`, `duration: 300`, `useNativeDriver: true` |
| `translateY` | `12` | `0` | same timing, same driver |
| Easing | — | — | `Easing.out(Easing.cubic)` — starts fast, decelerates |

### Reduced Motion

If `AccessibilityInfo.isReduceMotionEnabled()` is true:
- Skip all stagger delays
- Set all sections visible immediately
- Toggle animations become instant (no LayoutAnimation)

---

## 11. Interaction Feedback

### Pill Press

| Action | Feedback |
|--------|----------|
| Press in | `opacity: 0.7` (activeOpacity) |
| Select | Light haptic: `Haptics.impactAsync(ImpactFeedbackStyle.Light)` |
| Deselect | No haptic |

### Toggle Switch

| Action | Feedback |
|--------|----------|
| Toggle ON | Light haptic |
| Toggle OFF | Light haptic |
| Guard block (both OFF) | Medium haptic + toast warning |

### Calendar Date Tap

| Action | Feedback |
|--------|----------|
| Select date | Light haptic, selected circle scales in (`Animated.spring`, `tension: 200, friction: 12`) |
| Deselect date | No haptic, circle fades out |
| Tap past date | No-op, no haptic |

### Lock In Button

| Action | Feedback |
|--------|----------|
| Press | Scale down to `0.97` (Animated.spring) |
| Release | Scale back to `1.0` + medium haptic |
| Disabled tap | No-op, no haptic |

### Month Navigation

| Action | Feedback |
|--------|----------|
| Tap arrow | Light haptic, calendar grid cross-fades to new month (`opacity: 0 → 1`, `200ms`) |
| Tap disabled arrow | No-op |

---

## 12. Loading State

When preferences are loading (`preferencesLoading === true`):

| Property | Value |
|----------|-------|
| Show shimmer placeholders | 5 section-shaped blocks |
| Shimmer color | `#f3f4f6` → `#e5e7eb` → `#f3f4f6` pulse |
| Section shimmer height | Starting Point: `80px`, When: `60px`, Intents: `120px`, Categories: `160px`, Getting There: `100px` |
| Border radius | `12px` | `radius.md` |
| Stagger | Same 80ms stagger as section reveal |
| Lock In button | Disabled state |

---

## 13. Color Usage Summary

| Element | Color | Token | Hex |
|---------|-------|-------|-----|
| Sheet background | `background.primary` | — | `#ffffff` |
| Section titles | `text.primary` | — | `#111827` |
| Section subtitles | `text.tertiary` | — | `#6b7280` |
| Pill unselected bg | `background.tertiary` | — | `#f3f4f6` |
| Pill unselected text | `text.secondary` | — | `#4b5563` |
| Pill selected bg | `accent` | — | `#eb7825` |
| Pill selected text | `text.inverse` | — | `#ffffff` |
| Toggle track ON | `accent` | — | `#eb7825` |
| Toggle track OFF | `gray[300]` | — | `#d1d5db` |
| Calendar selected | `accent` | — | `#eb7825` |
| Calendar today bg | `primary[50]` | — | `#fff7ed` |
| Calendar today text | `primary[600]` | — | `#ea580c` |
| Calendar disabled | `gray[300]` | — | `#d1d5db` |
| Lock In enabled bg | `accent` | — | `#eb7825` |
| Lock In disabled bg | `gray[200]` | — | `#e5e7eb` |
| Weekend info bg | `primary[50]` | — | `#fff7ed` |
| Borders | `gray[200]` | — | `#e5e7eb` |
| Input focused border | `accent` | — | `#eb7825` |
| GPS icon | `accent` | — | `#eb7825` |
| Start Over link | `accent` | — | `#eb7825` |

**Rule:** No blue, green, purple, or red on structural elements. Orange accent is the
only warm color. Everything else is grayscale. Category pills in their selected state
use the universal `accent` orange — NOT per-category colors (those are for card display
elsewhere in the app, not for the preference sheet).

---

## 14. Notes for Implementor

1. **All spacing values are absolute** — don't use `responsiveSpacing` for this sheet.
   The sheet is a modal overlay, consistent across devices. Use raw pixel values.

2. **Calendar cell math:** 7 columns × cell width must equal `containerWidth - 32`
   (16px padding on each side). Calculate `cellWidth = Math.floor((SCREEN_WIDTH - 40 - 32) / 7)`.

3. **Selected date circle:** Center a `36px` circle inside the `cellWidth` cell.
   If cell is 44px, the circle has `(44-36)/2 = 4px` margin on each side.

4. **Month transition:** When navigating months, the grid should cross-fade (opacity 0→1,
   200ms). Do NOT slide left/right — it implies horizontal pagination, which is wrong for
   a calendar.

5. **Keyboard handling:** When the location search input is focused, the
   `KeyboardAwareScrollView` scrolls to keep it visible. The Lock In button should remain
   visible above the keyboard.

6. **Dark mode:** NOT in scope for Phase 6. All values are light mode. Dark mode is a
   separate initiative.
