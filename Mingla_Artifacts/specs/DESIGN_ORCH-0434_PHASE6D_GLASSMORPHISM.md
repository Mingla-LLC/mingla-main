# DESIGN SPEC: ORCH-0434 Phase 6D — Glassmorphism Preferences Sheet

**Version:** 1.0
**Date:** 2026-04-15
**Supersedes:** DESIGN_ORCH-0434_PHASE6_PREFERENCES_SHEET.md (flat layout)
**Design system source:** `app-mobile/src/constants/designSystem.ts` — `glass` tokens

---

## Design Philosophy

The Preferences Sheet is where users tell Mingla who they are. It should feel like
crafting something personal — not filling out a form. Each section is a floating glass
card with one clear, conversational question. The user answers by tapping glowing pills
that feel tangible, responsive, alive.

The glass creates depth without weight. The warm background anchors everything.
The orange accent is the pulse — it activates when the user decides.

---

## 1. Sheet Background

The glass cards need a surface to float above. Pure white is flat. The warm glow gives depth.

| Property | Value | Token |
|----------|-------|-------|
| Background color | `#fff9f5` | `backgroundWarmGlow` |
| Extends | Full sheet height behind scroll content | — |

**Implementation note:** Set the `ScrollView` / `KeyboardAwareScrollView` background to
`backgroundWarmGlow`. The header area stays `#ffffff` with its bottom border to ground it.

---

## 2. Glass Card (universal section container)

Every section is wrapped in this card. No exceptions.

### Glass Surface

| Property | Value | Token Reference |
|----------|-------|----------------|
| Background | `rgba(255, 255, 255, 0.70)` | `glass.surfaceElevated.backgroundColor` |
| Border | `1px solid rgba(255, 255, 255, 0.45)` | `glass.surfaceElevated.borderColor` |
| Border top | `0.5px` (subtle top highlight) | `glass.surfaceElevated.borderTopWidth` |
| Border radius | `24px` | `radius.xl` |
| Padding | `20px` | — |
| Margin horizontal | `16px` | `spacing.md` |
| Shadow | `glass.shadow` (see below) | — |

### Glass Shadow

| Property | Value |
|----------|-------|
| shadowColor | `rgba(0, 0, 0, 0.08)` |
| shadowOffset | `{ width: 0, height: 8 }` |
| shadowOpacity | `1` |
| shadowRadius | `24` |
| elevation | `6` (Android) |

### Spacing Between Cards

| Property | Value |
|----------|-------|
| Gap between cards | `16px` |
| First card marginTop | `16px` (from header border) |
| Last card marginBottom | `120px` (space for Lock In button) |

---

## 3. Question Text (card header)

Each card has ONE question — bold, conversational, direct.

| Property | Value | Token |
|----------|-------|-------|
| Font size | `17px` | `taglineTypography.fontSize` |
| Line height | `26px` | `taglineTypography.lineHeight` |
| Font weight | `700` | `fontWeights.bold` |
| Color | `#111827` | `colors.text.primary` |
| Margin bottom | `16px` (to content below) | `spacing.md` |

### The 6 Questions

| Card | Question |
|------|----------|
| 1 | "Where should we start looking?" |
| 2 | "When are you heading out?" |
| 3 | "See curated experiences?" |
| 4 | "See popular options?" |
| 5 | "How are you rolling?" |
| 6 | "How far?" |

Cards 3 & 4 have the toggle switch to the right of the question text.

---

## 4. Pills (universal system)

Pills live inside glass cards. They have two visual treatments: glass-unselected and
solid-selected.

### Unselected Pill (glass treatment)

| Property | Value |
|----------|-------|
| Background | `rgba(255, 255, 255, 0.55)` |
| Border | `1px solid rgba(255, 255, 255, 0.35)` |
| Border radius | `16px` (`radius.lg`) |
| Shadow | `shadowColor: rgba(0,0,0,0.04), offset: {0,2}, radius: 6, elevation: 1` |
| Text color | `#4b5563` (`colors.text.secondary`) |
| Text weight | `500` (`fontWeights.medium`) |
| Text size | `14px` (`typography.sm.fontSize`) |
| Icon color | `#6b7280` (`colors.text.tertiary`) |
| Icon size | `18px` |

### Selected Pill (solid accent)

| Property | Value |
|----------|-------|
| Background | `#eb7825` (`colors.accent`) |
| Border | `none` (or `1px solid #eb7825` for consistency) |
| Border radius | `16px` (`radius.lg`) |
| Shadow | `shadowColor: #eb7825, shadowOpacity: 0.3, shadowRadius: 8, offset: {0,4}, elevation: 4` |
| Text color | `#ffffff` (`colors.text.inverse`) |
| Text weight | `600` (`fontWeights.semibold`) |
| Icon color | `#ffffff` |

### Pill Dimensions by Type

| Type | Height | Layout | Notes |
|------|--------|--------|-------|
| **Date pills** (card 2) | `44px` | 3 equal width, `gap: 10` | Fill container width |
| **Intent pills** (card 3) | `48px` | `flexWrap`, `gap: 10` | 2-3 per row, content-sized |
| **Category pills** (card 4) | `48px` | 2-column grid, `width: '48%'`, `gap: 10` | Icon + text |
| **Travel mode pills** (card 5) | `52px` | 4 equal width, `gap: 10` | Icon stacked above text |
| **Time preset pills** (card 6) | `40px` | Row, `gap: 8` | "15 min", "30 min", etc. |

### Pill Press Feedback

| Action | Feedback |
|--------|----------|
| Press in | Scale to `0.96`, opacity `0.8` (Animated.spring) |
| Select | Scale bounce back to `1.0` + light haptic |
| Release without selecting | Scale back to `1.0`, no haptic |

---

## 5. Card 1: "Where should we start looking?"

### GPS Toggle Row (inside card)

| Property | Value |
|----------|-------|
| Row background | `rgba(255, 255, 255, 0.55)` (inner glass) |
| Row border radius | `12px` (`radius.md`) |
| Row padding | `14px` horizontal, `12px` vertical |
| Row border | `1px solid rgba(255, 255, 255, 0.35)` |
| GPS icon | `#eb7825` (`colors.accent`) |
| Label | `14px`, `500`, `#111827` |
| Switch track ON | `#eb7825` |
| Switch track OFF | `#d1d5db` |

### Helper Text (below toggle)

| Property | Value |
|----------|-------|
| Text | "We've got you pinned. Chill." |
| Font | `12px`, `400`, `#6b7280` |
| Icon | info circle, `14px`, `#9ca3af` |
| Margin top | `8px` |

### Custom Search Input (when GPS off, Pro feature)

| Property | Value |
|----------|-------|
| Background | `rgba(255, 255, 255, 0.55)` |
| Border | `1px solid rgba(255, 255, 255, 0.35)` |
| Border (focused) | `1.5px solid #eb7825` |
| Border radius | `12px` |
| Height | `48px` |
| Placeholder color | `#9ca3af` |
| Input text | `14px`, `#111827` |

---

## 6. Card 2: "When are you heading out?"

Three equal-width pills: **Today** | **This Weekend** | **Pick Date(s)**

Use universal pill system from §4 with date pill dimensions.

### Weekend Info Card (shown when "This Weekend" selected)

| Property | Value |
|----------|-------|
| Background | `rgba(255, 247, 237, 0.80)` (warm peach glass) |
| Border | `1px solid rgba(253, 186, 116, 0.30)` (orange tint) |
| Border radius | `12px` |
| Padding | `14px` |
| Margin top | `12px` |
| Calendar icon | `20px`, `#ea580c` |
| Title | `14px`, `600`, `#111827` |
| Description | `13px`, `400`, `#6b7280` |

### Multi-Day Calendar (shown when "Pick Date(s)" selected)

| Property | Value |
|----------|-------|
| Container | Same glass card treatment as parent, but nested |
| Background | `rgba(255, 255, 255, 0.60)` |
| Border | `1px solid rgba(255, 255, 255, 0.40)` |
| Border radius | `16px` |
| Margin top | `14px` |
| Internal padding | `16px` |
| Shadow | `glass.shadow` (same as section cards — depth) |

Selected date circles use the same accent orange treatment as selected pills.

---

## 7. Cards 3 & 4: Toggle Cards

### Toggle Header Row

| Property | Value |
|----------|-------|
| Layout | `row`, `space-between`, `center` |
| Question text | As defined in §3 (17px bold) |
| Switch | Right-aligned |
| Switch track ON | `#eb7825` |
| Switch track OFF | `#d1d5db` |
| Thumb | `#ffffff` |

**The question IS the toggle label.** No separate subtitle needed. The question is
self-explanatory: "See curated experiences?" — yes (ON) or no (OFF). Clean.

### Collapsed State (toggle OFF)

- Card shrinks to just the question + switch (no pills)
- `LayoutAnimation.easeInEaseOut`
- Card maintains glass treatment — doesn't disappear, just gets shorter

### Expanded State (toggle ON)

- Pills appear below the question with `16px` gap
- Same pill system from §4

---

## 8. Card 5: "How are you rolling?"

Four equal-width travel mode pills with icon ABOVE text:

| Layout | Value |
|--------|-------|
| Grid | 4 columns, equal width |
| Gap | `10px` |
| Pill height | `52px` |
| Icon size | `20px` |
| Icon margin bottom | `4px` |
| Label size | `12px`, `500` |
| Icon + label stacked vertically, centered |

Labels: **Walk** | **Bike** | **Bus** | **Drive**

---

## 9. Card 6: "How far?"

### Time Preset Pills

| Layout | Value |
|--------|-------|
| Row | 4 pills + custom toggle |
| Pill height | `40px` |
| Pill border radius | `999px` (full rounded) |
| Gap | `8px` |
| Labels | "15 min", "30 min", "45 min", "60 min" |

### Custom Input (when "Set your own" toggled ON)

Same glass input style as the address search in Card 1.

---

## 10. Lock In Button

Floating at the bottom, above safe area. **Not glass — solid accent orange.**
The button is the decision point — it should feel definitive, not ethereal.

### Enabled State

| Property | Value |
|----------|-------|
| Background | `#eb7825` (`colors.accent`) |
| Height | `56px` (`touchTargets.large`) |
| Border radius | `16px` (`radius.lg`) |
| Text | "Lock It In" — `16px`, `700`, `#ffffff` |
| Shadow | `shadowColor: #eb7825, shadowOpacity: 0.35, shadowRadius: 12, offset: {0,6}` |
| Container background | `rgba(255, 249, 245, 0.95)` (warm glow, slightly translucent) |
| Container border top | `1px solid rgba(255, 255, 255, 0.50)` |
| Container padding | `12px` horizontal, `12px` vertical |

### Disabled State

| Property | Value |
|----------|-------|
| Background | `rgba(255, 255, 255, 0.40)` (glass disabled) |
| Text color | `#9ca3af` |
| Shadow | none |
| Border | `1px solid rgba(255, 255, 255, 0.30)` |

### "Start Over" Link

| Property | Value |
|----------|-------|
| Text | "Start Over" — `13px`, `500`, `#eb7825` |
| Position | Right of Lock In, or below it |
| Tap area | `44px` height minimum |

---

## 11. Stagger Animation

Same 5-section stagger from Phase 6B, but now 6 cards:

| Card | Delay | Duration |
|------|-------|----------|
| 1 | `0ms` | `300ms` |
| 2 | `70ms` | `300ms` |
| 3 | `140ms` | `300ms` |
| 4 | `210ms` | `300ms` |
| 5 | `280ms` | `300ms` |
| 6 | `350ms` | `300ms` |

Animation: `opacity: 0→1`, `translateY: 16→0`, `Easing.out(Easing.cubic)`.

Stagger is now 70ms (was 80ms) — 6 cards at 80ms = 400ms delay on last card which
feels sluggish. 70ms keeps the total under 350ms.

Reduced motion: all cards visible immediately, no animation.

---

## 12. Haptic Feedback

| Action | Feedback |
|--------|----------|
| Pill select | `ImpactFeedbackStyle.Light` |
| Pill deselect | None |
| Toggle ON/OFF | `ImpactFeedbackStyle.Light` |
| Toggle guard (both OFF) | `ImpactFeedbackStyle.Medium` + toast |
| Calendar date tap | `ImpactFeedbackStyle.Light` |
| Lock In press | `ImpactFeedbackStyle.Medium` + scale `0.97` → `1.0` |
| Disabled Lock In tap | None |
| Month nav arrow | `ImpactFeedbackStyle.Light` |

---

## 13. Color Usage Summary

| Element | Color | Source |
|---------|-------|--------|
| Sheet background | `#fff9f5` | `backgroundWarmGlow` |
| Glass card bg | `rgba(255,255,255,0.70)` | `glass.surfaceElevated` |
| Glass card border | `rgba(255,255,255,0.45)` | `glass.surfaceElevated` |
| Unselected pill bg | `rgba(255,255,255,0.55)` | `glass.surface` |
| Unselected pill border | `rgba(255,255,255,0.35)` | `glass.surface` |
| Selected pill bg | `#eb7825` | `colors.accent` |
| Selected pill shadow | `#eb7825` at 0.3 opacity | — |
| Question text | `#111827` | `colors.text.primary` |
| Pill text unselected | `#4b5563` | `colors.text.secondary` |
| Pill text selected | `#ffffff` | `colors.text.inverse` |
| Switch ON | `#eb7825` | `colors.accent` |
| Switch OFF | `#d1d5db` | `colors.gray[300]` |
| Lock In enabled | `#eb7825` | `colors.accent` |
| Lock In disabled | `rgba(255,255,255,0.40)` | glass treatment |
| Helper text | `#6b7280` | `colors.text.tertiary` |
| Calendar selected | `#eb7825` | `colors.accent` |
| Calendar today | `#fff7ed` bg, `#ea580c` text | `colors.primary[50]`, `[600]` |
| Weekend info bg | `rgba(255,247,237,0.80)` | warm peach glass |

**No blues, greens, purples on any structural element.** Orange accent is the only
warm color. Everything else is white glass or grayscale.

---

## 14. React Native Implementation Notes

### Glassmorphism in RN

React Native does NOT support CSS `backdrop-filter: blur()`. The glass effect is achieved
through:

1. **Solid translucent backgrounds** — `rgba(255,255,255,0.70)` gives the frosted appearance
   when layered over the warm `#fff9f5` background. No blur needed — the opacity contrast
   creates the glass illusion.

2. **Subtle borders** — `rgba(255,255,255,0.45)` border creates the edge highlight that
   makes glass feel tangible.

3. **Deep, soft shadows** — `glass.shadow` with `shadowRadius: 24` creates the floating
   effect.

4. **expo-blur `BlurView`** is available if true blur is desired, but it's expensive on
   low-end devices and creates scroll performance issues. **Do NOT use `BlurView` for
   scroll content.** The solid translucent approach performs identically on all devices.

### StyleSheet Approach

Create a `glassCard` style in the StyleSheet:

```typescript
glassCard: {
  backgroundColor: 'rgba(255, 255, 255, 0.70)',
  borderWidth: 1,
  borderTopWidth: 0.5,
  borderColor: 'rgba(255, 255, 255, 0.45)',
  borderRadius: 24,
  padding: 20,
  marginHorizontal: 16,
  shadowColor: 'rgba(0, 0, 0, 0.08)',
  shadowOffset: { width: 0, height: 8 },
  shadowOpacity: 1,
  shadowRadius: 24,
  elevation: 6,
},
glassPill: {
  backgroundColor: 'rgba(255, 255, 255, 0.55)',
  borderWidth: 1,
  borderColor: 'rgba(255, 255, 255, 0.35)',
  borderRadius: 16,
  shadowColor: 'rgba(0, 0, 0, 0.04)',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 1,
  shadowRadius: 6,
  elevation: 1,
},
glassPillSelected: {
  backgroundColor: '#eb7825',
  borderColor: '#eb7825',
  shadowColor: '#eb7825',
  shadowOpacity: 0.3,
  shadowRadius: 8,
  shadowOffset: { width: 0, height: 4 },
  elevation: 4,
},
```

---

## 15. What NOT to Do

1. **Don't use `BlurView` for cards.** Performance killer on scroll. The translucent bg IS the glass.
2. **Don't add gradients to pills.** Solid colors only — glass bg for unselected, accent for selected.
3. **Don't add shadows to every element.** Cards have shadows. Pills have subtle shadows. Text does not.
4. **Don't use rounded corners > 24px on cards.** 24px is the sweet spot — feels intentional without looking like a bubble.
5. **Don't animate card backgrounds.** The stagger is opacity + translateY only. Background stays constant.
6. **Don't make the Lock In button glass.** It's the decision point — it should be solid, definitive, grounded.
