# DESIGN — ORCH-1123 [Hub multi-select draft delete]

**Mode:** mingla-designer (pixel-precise build contract for the visual / interaction / motion layer)
**App:** mingla-business (React Native / Expo, dark glass system)
**Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1123-[hub-multiselect-draft-delete]` (branch `ORCH-1123-hub-multiselect-draft-delete`)
**Date:** 2026-06-11
**Pairs with:** `SPEC_ORCH-1123_HUB_MULTISELECT_DRAFT_DELETE.md` — DESIGN owns ONLY visual/interaction/motion. Every locked engineering decision (data contract, scope, RPC, partition logic, copy strings) is honored verbatim; nothing here changes scope or the data contract.
**COMMS_LEDGER:** read on entry. No `BLOCK`/`WARN` row targets ORCH-1123 or `mingla-designer`. COMMS-0003 (ALL/WARN, external-API docs) read — not applicable (a soft-delete feature, no external-API integration). No new cross-ORCH discovery → no ledger write.

This spec is buildable without guessing. Every value is a token from `mingla-business/src/constants/designSystem.ts` or an explicit px/ms/easing. Tokens referenced: `spacing`, `radius`, `text`, `glass`, `accent`, `semantic`, `typography`, `durations`, `easings`, `shadows`, `colors`. Two new components (`DraftSelectCheckbox`, `DraftSelectBar`) and one new haptic helper are fully tokenized below — the implementor builds them once.

---

## 0. Design thesis (the moment)

The founder is scanning a Hub tab full of unfinished drafts and wants several gone at once. Today each delete is a 3-dot → menu → confirm slog. The moment we design for: **"I see junk, I want it gone, fast, without fear."**

Three design pressures drive every decision:

1. **Discoverability of a hidden gesture.** Long-press is the SOLE entry (Q7, locked). A hidden gesture that nobody finds is a dead feature. Solution = a *persistent, low-cost affordance* (a one-line caption under the Drafts list) PLUS a *press-and-hold ring* that makes the gesture teach itself the instant a thumb rests on a card. No coachmark modal (intrusive, one-shot, easily dismissed-and-forgotten).
2. **Reversibility anxiety.** Delete is destructive and there is no undo (locked OUT of scope). The design must make the *count* unmissable at every step (bar label, dialog title, dialog button, toast) so the founder always knows exactly how many things are about to vanish.
3. **Consistency over novelty.** This rides on top of the existing list cards — it must feel like the same app putting on a "select mode hat," not a new screen. Reuse the host glass, the cover geometry, the accent warm, the ConfirmDialog, the Toast. The ONLY net-new primitives are the checkbox and the bottom bar.

---

## 1. IA & flow

### 1.1 State machine (per tab — selection never crosses tabs)

```
BROWSE (default)
  │  long-press a DRAFT row  ──────────────────────────────►  SELECT (count = 1)
  │      (non-draft row long-press = no-op, brief shake-null)
  │
SELECT (count = N ≥ 0)
  │  tap a draft row            → toggle that row (count ±1)
  │  long-press another row     → toggle that row (same as tap; no re-entry needed)
  │  tap Cancel                 → BROWSE  (clear selection)
  │  switch filter pill ≠ Draft → BROWSE  (forced exit, §3.6)
  │  tap Delete (N)  [N ≥ 1]    → CONFIRM
  │  count drops to 0           → stay in SELECT, Delete disabled (bar stays)
  │
CONFIRM (ConfirmDialog over SELECT)
  │  Keep / dismiss             → back to SELECT (selection preserved)
  │  Delete                     → DELETING
  │
DELETING (dialog confirm spinner + bar disabled)
  │  success (all/partial)      → toast + BROWSE (selection cleared, list re-renders)
  │  throw (network/auth)       → dialog stays open, inline errorMessage, back to actionable CONFIRM
```

### 1.2 Information hierarchy in SELECT mode

1. **The selection state of each row** (checkbox + selected treatment) — primary, the thing the user is manipulating.
2. **The running count** (bottom bar `Delete (N)`) — the consequence meter, always in the thumb zone.
3. **The escape hatch** (Cancel) — equal-weight with Delete in placement, lower visual weight in color.
4. **Everything else dims back** — manage 3-dot hidden, non-draft rows dimmed and inert, revenue/metrics recede. The screen narrows to one job.

### 1.3 Edge cases (all designed below)

- Long-press on a non-draft row under an "All" filter → no-op + a 1-cycle null-shake on that row (§5.1) so the gesture isn't a silent dead-tap.
- Toggling the last selected row off (N→0) → bar stays, Delete disabled (not hidden — hiding would feel like a crash). §4.5.
- All drafts deleted → each tab's existing empty state renders (reused verbatim). §6.3.
- Partial failure → `warn` toast with the exact tally. §6.2.

---

## 2. Layout & spacing grid

Mingla-business is on a **4 / 8 pt grid** (`spacing.xxs 2 · xs 4 · sm 8 · md 16 · lg 24 · xl 32`). Every value below resolves to a token or an explicit multiple.

### 2.1 The list card host is UNCHANGED in geometry

The card stays exactly as `EventListCard` / `OfferingListCard` / `TripListCard` render today: host `radius.lg` (16), border `glass.border.profileBase`, fill `glass.tint.profileBase` (iOS) / `rgba(20,22,26,0.92)` (Android), `overflow:'hidden'`, `cardBody` padding `spacing.sm` (8), cover 76×92 at `radius.md` (12). **Select mode adds overlays and a host style — it never reflows the card body.** Rationale: zero layout shift between BROWSE and SELECT (priority-3 perf rule, no content jumping). The checkbox sits OVER the cover; the selected ring sits ON the host border; the manage button simply hides in place.

### 2.2 New surface — `DraftSelectBar` footprint

The bar floats above the existing floating BottomNav capsule. From `app/(tabs)/_layout.tsx`: the nav lives in `navWrap` (absolute, `bottom:0`, `paddingHorizontal:16`, `paddingTop:spacing.sm` (8), `paddingBottom:max(insets.bottom, 8)`), and the capsule itself is `NAV_HEIGHT = 64`. So the nav's visual top edge sits at:

```
navTopFromBottom = max(insets.bottom, 8) + 64 + 8(paddingTop)   // ≈ 34 + 64 + 8 = 106 on a notch phone
```

The bar must clear that. **Bar anchoring (in each tab host, rendered as the last sibling of the list ScrollView):**

```
position: 'absolute'
left: spacing.md (16)        // align to the same 16pt gutter as the nav capsule
right: spacing.md (16)
bottom: bottomInset + 64 + spacing.sm + spacing.sm
       = props.bottomInset (= insets.bottom) + 64 + 8 + 8
```

Plain English: the bar's bottom edge sits `8pt` above the BottomNav capsule's top edge, both inside the same 16pt side gutters, so the bar reads as a sibling capsule stacked above the nav — not glued to it, not floating in dead center. The `+8` paddingTop of the navWrap is absorbed by our `+8` gap so the visual breathing space is one `spacing.sm` clean.

> Implementor note: the tab passes `bottomInset={insets.bottom}` (from `useSafeAreaInsets`) into `DraftSelectBar`; the bar computes `bottom` internally as `bottomInset + 64 + 16`. The `64` and the two `8`s are the spec's load-bearing constants — comment them as "clear floating BottomNav (NAV_HEIGHT 64) + 8 gap above + 8 nav paddingTop".

### 2.3 `DraftSelectBar` internal layout

```
height: 56                                    // ≥44 hit + 6/6 vertical breathing
paddingHorizontal: spacing.md (16)
flexDirection: 'row'
alignItems: 'center'
gap: spacing.sm (8)
borderRadius: radius.full (999)               // capsule, matches BottomNav language
overflow: 'hidden'                            // REQUIRED for Android opaque clip (§7)

Children, left→right:
  [Cancel button]   flexShrink:0, minWidth 88, height 40, centered label
  [spacer]          flex:1
  [Delete (N) btn]  flexShrink:0, minHeight 40, paddingHorizontal spacing.md (16)
```

Cancel left / Delete right mirrors the ConfirmDialog 50/50 action row's left-cancel / right-confirm convention, so muscle memory transfers. Delete is right-side (thumb-dominant for right-handed reach) — destructive action gets the strong position, but the count + the confirm dialog are the friction guard, so right-thumb reach is acceptable here (the irreversible commit is still gated behind the dialog).

---

## 3. Type scale

| Element | Token | Resolved | Notes |
|---|---|---|---|
| Bar `Cancel` label | `typography.buttonMd` | 14 / 20, w600, ls 0.2 | `text.secondary` color |
| Bar `Delete (N)` label | `typography.buttonMd` | 14 / 20, w600, ls 0.2 | `text.inverse` (#fff) on warm fill |
| Discoverability caption | `typography.caption` | 12 / 16, w500, ls 0.2 | `text.tertiary` |
| Confirm dialog title | `typography.h3` (reused) | 20 / 32, w600 | unchanged — ConfirmDialog owns it |
| Confirm dialog body | `typography.body` (reused) | 16 / 24, w400 | unchanged |
| Toast message | `typography.body` (reused) | 16 / 24, w500 | unchanged — Toast owns it |
| Checkmark glyph | n/a (vector `Icon name="check"`) | size 14 stroke | inside 24pt circle |

**Dynamic Type:** the bar label and caption use the system scale (RN default text scaling is on). The bar `height:56` and button `minHeight:40` are fixed; at the largest accessibility text sizes the labels are single words ("Cancel", "Delete (12)") and fit without truncation — but set `numberOfLines={1}` + `adjustsFontSizeToFit` (minimumFontScale 0.85) on the Delete label so a 3-digit count never clips. The checkbox circle is a fixed 24pt (icon-not-text) so it does not scale.

---

## 4. Color & token mapping (light is N/A — business app is dark-only)

All surfaces are the existing dark glass system; there is no light variant in mingla-business.

### 4.1 Checkbox

| State | Fill | Border | Glyph | Contrast |
|---|---|---|---|---|
| **Unchecked** | `rgba(12,14,18,0.55)` (matches DRAFT overlay floor, reads on any cover) | `rgba(255,255,255,0.85)` 1.5px | none | ring-on-cover ≥3:1 (non-text UI, AA) |
| **Checked** | `accent.warm` (#eb7825) | `accent.warm` 1.5px | `Icon check` #fff, size 14, stroke 2.5 | check #fff on #eb7825 ≈ 2.9:1 — the established app-wide white-on-warm action pairing (see `ariPalette.userBubble` note); paired with the shape change (filled circle) so color is NOT the only indicator ✔ |
| **Pressed** (transient, during the row tap) | unchecked→ darken to `rgba(12,14,18,0.7)`; checked→ `#d96c1f` (accent −8% L) | same | same | press feedback only |

**Why color is not the only indicator:** unchecked = hollow dark ring with no glyph; checked = SOLID warm circle WITH a white checkmark. A colorblind or low-vision user reads the fill+glyph shape difference, not the hue. ✔ (priority-1 a11y rule).

### 4.2 Selected-row treatment (the host)

| State | Host border | Host fill overlay | Elevation |
|---|---|---|---|
| Unselected (in SELECT mode) | unchanged `glass.border.profileBase` | none | none |
| **Selected** | `accent.border` (rgba(235,120,37,0.55)) at `borderWidth:1.5` | a `accent.tint` (rgba(235,120,37,0.28)) wash applied as an absolute-fill overlay child INSIDE the host (so `overflow:'hidden'` clips it to the radius) | none added (no shadow — keeps Android clean per §7) |
| Non-draft row, SELECT active (`selectable={false}`) | unchanged | host `opacity: 0.4` + `pointerEvents:'none'` | none |

The selected wash is an **overlay View**, not a `backgroundColor` swap, because the host fill is platform-split (iOS translucent / Android opaque) and we must not fork the selected color per platform. One `accent.tint` overlay reads correctly over both bases. Border bumps from 1→1.5px and recolors warm — a calm, premium "this one's chosen" that matches the BottomNav spotlight's `accent.tint` + `accent.border` language exactly. No scale, no shadow (motion is reserved for the checkbox + bar; a scaling card list would feel jittery during rapid multi-tap).

### 4.3 Bar

| Element | Fill | Border | Text |
|---|---|---|---|
| Bar surface (iOS) | `rgba(12,14,18,0.72)` translucent over a `BlurView`/glass — match the BottomNav capsule tint family (`rgba(12,14,18,0.55)`), slightly denser so it reads as the *active* layer above the nav | `glass.border.chrome` (rgba(255,255,255,0.14)) 1px | — |
| Bar surface (Android) | **opaque `#16181b`** (the codebase's canonical Android opaque-glass value, == `ariThread.ariBubbleAndroid`) | `glass.border.chrome` 1px | — |
| Cancel button | transparent | `glass.border.chrome` 1px | `text.secondary` |
| Cancel pressed | `rgba(255,255,255,0.06)` | same | same |
| Delete (N) enabled | `accent.warm` (#eb7825) | none | `text.inverse` #fff |
| Delete (N) pressed | `#d96c1f` | none | #fff |
| Delete (N) **disabled** (N=0 or deleting) | `rgba(235,120,37,0.32)` | none | `rgba(255,255,255,0.5)` |

Delete uses the **brand warm**, not `semantic.error` red. Rationale: the *commit* of destruction is gated behind the ConfirmDialog (which DOES use the red destructive Button). The bar's Delete is "proceed to confirm," a brand action, not the irreversible act — coloring it red here would over-alarm during routine multi-select and clash with the warm-glass app language. The red lives where the irreversible decision lives (the dialog). This is a deliberate two-tier destructive escalation: warm "Delete (N)" → red "Delete N" in the dialog.

### 4.4 Discoverability caption

Caption text `text.tertiary` (rgba(255,255,255,0.52)) on the dark canvas (`canvas.discover` #0c0e12) → ≈ 5.3:1, passes AA for the 12pt caption. ✔

### 4.5 N=0 disabled-but-present

When the user toggles the last row off, the bar does NOT hide. Delete goes to its disabled token (above), Cancel stays fully enabled. Hiding the bar on N=0 would read as a crash/glitch and strand the user (no visible way back except the now-gone bar). Keeping it present with a dimmed Delete is honest and recoverable.

---

## 5. Every interactive state + the long-press discoverability solution

### 5.1 Long-press affordance — the press-and-hold ring (the discoverability core)

This is the marquee interaction. Long-press is invisible by default, so we make the gesture **teach itself the moment a thumb lingers**, and we add a **persistent caption** so the user knows it exists before they ever try.

**A. Persistent caption (knowing it exists).** Under the Drafts list header / above the first draft row in each tab (only when ≥1 draft row is present AND not already in SELECT mode), render one line:

```
Text: "Press and hold a draft to select multiple"
style: typography.caption, color text.tertiary, textAlign 'left'
paddingHorizontal: spacing.md (16), paddingBottom: spacing.sm (8)
```

It's cheap, always-there, non-modal, and self-explaining. It vanishes in SELECT mode (the bar is the new context) and when there are zero drafts. This is the primary discoverability mechanism — no coachmark modal, no one-shot tooltip that gets dismissed and forgotten.

**B. Press-and-hold ring (learning the gesture by doing).** On `onPressIn` of a draft row's body, start a radial "fill ring" that completes at the `delayLongPress` threshold (350ms, locked in SPEC §3.7.1). The ring is the affordance that says "keep holding, something is about to happen":

- A thin arc/ring overlay on the card, `accent.warm` at `borderWidth: 2`, drawn as a `radius.lg` rounded-rect stroke that animates its opacity 0→1 AND a subtle inset scale.
- Implementation (Reanimated, no SVG needed): an absolute-fill `Animated.View` child of the host with `borderColor: accent.warm`, `borderWidth: 2`, `borderRadius: radius.lg`, `opacity` driven 0→0.9 over 350ms `easings.out`, plus a `transform:[{scale}]` from 1.02→1.0 (a gentle "settling in" press). On `onPressOut` before threshold → opacity withTiming 0 over `durations.fast` (120ms). On threshold reached → the ring flashes to full then hands off to SELECT entry (the checkbox slides in, §5.2).
- This makes the FIRST long-press legible: the user feels the card "charging up." Combined with the caption, discoverability is solved without a modal.

**C. Entry haptic.** At the `delayLongPress` fire (mode enters), trigger a haptic. Today only `HapticFeedback.buttonPress()` (Light) and `.success()` exist. **Add one helper** `HapticFeedback.selectionEnter()` → `Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)` (additive, mirrors the existing safe-wrap; native-only, no-ops on web). Medium impact = "you grabbed something" — distinct from the Light tab-press. (Full token spec in §9.)

**D. Non-draft long-press = honest no-op.** A long-press on a `selectable={false}` row (a Live/Upcoming/Past row visible under "All") does NOT enter select mode (locked: drafts only). To avoid a silent dead-tap (Constitution #1), the row plays a **null-shake**: `translateX` 0 → −4 → +4 → 0 over `durations.normal` (200ms) `easings.inOut`, no haptic. It reads "not this one" without an error. (Reduced-motion: skip the shake, do nothing — acceptable, it's a negative affordance.)

### 5.2 Checkbox slide-in (transition INTO select mode)

When mode enters (or a row becomes visible in SELECT mode), the `DraftSelectCheckbox` animates in:

- Position: **top-left of the cover**, inset `spacing.xs` (4) from the cover's top + left edges, ON TOP of the cover (and on top of the DRAFT overlay — z-order above it). It does NOT collide with the DRAFT overlay text (centered) or the manage 3-dot (top-right, and hidden in select mode anyway).
- Enter motion: `opacity` 0→1 + `transform` `scale` 0.6→1 + `translateX` −6→0, over `durations.entry` (260ms) `easings.out`, staggered by row index ×16ms (cap 120ms total) so the list "ripples" into select mode rather than popping all at once. Stagger is capped so long lists don't feel laggy.
- Exit motion (Cancel / after delete): reverse — `opacity`→0 + `scale`→0.6 over `durations.exit` (180ms) `easings.in`, no stagger (fast clean exit).
- Reduced-motion: opacity-only fade, no scale/translate/stagger, `durations.fast` (120ms).

### 5.3 Checkbox tap (toggle) feedback

The CARD body owns the press (SPEC §3.5: "the whole row is the hit target"). On tap of a selectable row in SELECT mode:
- The checkbox does a **bounce-confirm**: `scale` 1 → 1.18 → 1 over `durations.normal` (200ms) with a spring (`damping: 12, stiffness: 320, mass: 0.7`) — a tactile "click" on check; on uncheck, `scale` 1 → 0.85 → 1 (a softer "release").
- Haptic: `HapticFeedback.buttonPress()` (Light) on every toggle.
- The selected-row wash (§4.2) cross-fades in/out over `durations.fast` (120ms) `easings.inOut` in lockstep.
- The bar count updates instantly (no animation on the number — it must read as a live counter; animating digits would slow perceived responsiveness).

### 5.4 The manage 3-dot in SELECT mode

The 3-dot manage trigger is **hidden** while `selectionMode === true` (SPEC §3.7.1: "no managing during selection"). Visual: it fades out (`opacity` 1→0 over `durations.fast` 120ms) AND `pointerEvents:'none'` so it can't be tapped mid-fade. On exit it fades back. This keeps the right rail clean — the only per-row control in select mode is the checkbox.

### 5.5 Bar enter / exit

- **Enter:** when `selectionMode` flips true, the bar slides up + fades: `translateY` `+24` → `0` + `opacity` 0→1 over `durations.entry` (260ms) `easings.out`. Mirrors the Toast's slide-in language (entrance from off-axis).
- **Exit:** `translateY` 0→`+24` + `opacity`→0 over `durations.exit` (180ms) `easings.in`, then unmount.
- Reduced-motion: opacity-only, `durations.fast` (120ms), no translate.

### 5.6 Bar Delete loading state

While `deleting` (mutation pending): both buttons disabled; Delete swaps its label for an inline spinner (reuse the `Button` `loading` prop if the bar's Delete is built on the kit `Button`; otherwise an `ActivityIndicator` color `#fff` size small replaces the label). Cancel goes to disabled token. (The ConfirmDialog also shows its own `confirmLoading` spinner — the bar is behind the dialog so its spinner is rarely seen, but specified for completeness / dialog-dismiss races.)

### 5.7 ConfirmDialog (reused, no visual change)

Reuse `ConfirmDialog` `variant="simple"` `destructive` exactly as the events single-delete (SPEC §3.8). No new styling. Copy strings are §6.1. The red destructive `Button` + the title/body are the existing tokens (h3 title, body description, error red `accent.warm` for the inline `errorMessage`). The dialog's left-Cancel ("Keep") / right-Delete layout already matches the bar's Cancel/Delete spatial convention.

---

## 6. Copy (Mingla voice — plain, calm, never cute about destruction)

### 6.1 ConfirmDialog (verbatim, matches SPEC §3.8)

| count | title | description | confirmLabel | cancelLabel |
|---|---|---|---|---|
| 1 | `Delete this draft?` | `This draft will be permanently removed. This can't be undone.` | `Delete draft` | `Keep` |
| N>1 | `Delete ${N} drafts?` | `These ${N} drafts will be permanently removed. This can't be undone.` | `Delete ${N}` | `Keep` |

"Keep" (not "Cancel") on the safe action — warmer, action-framed, reduces the chance of a panicked mis-tap; it tells the user what the safe choice *does*. The destructive confirm carries the count so the irreversible button itself names the magnitude.

### 6.2 Toast (verbatim, matches SPEC §3.8) + kind mapping (DESIGN's call)

| outcome | message | **kind** |
|---|---|---|
| all deleted | `Deleted ${deleted} draft${deleted === 1 ? "" : "s"}.` | `success` |
| partial (some failed, some ok) | `Deleted ${deleted}, ${failed} couldn't be deleted.` | `warn` |
| all failed | `Couldn't delete ${failed} draft${failed === 1 ? "" : "s"}. You may not have permission.` | `error` |

**Kind mapping rationale:** success → warm glass + check icon (2600ms). Partial → `warn` (warm glass + flag icon, 6000ms — longer dwell so the founder reads the tally and notices something didn't go through; warn stays warm-glass, not red, because the *primary intent succeeded*). All-failed → `error` (red glass + close icon, 12000ms, fully dismissible) because nothing the user asked for happened and they need the explanation time.

### 6.3 Empty-after-delete (reused, confirm renders)

When the last draft is removed, each tab's EXISTING empty copy renders (no new copy authored):
- events / trips: `No drafts in progress. Tap + to build one.`
- experiences: the existing `No experiences yet` / restaurant-play empty list state.
DESIGN requirement: confirm the empty state mounts correctly AFTER a batch (the list re-render must drop to zero rows and show the empty block, not a blank gap) — this is a tester runtime check, not a new design.

### 6.4 Discoverability caption (§5.1A)

`Press and hold a draft to select multiple`

---

## 7. Per-platform deltas

| Concern | iOS | Android | Web |
|---|---|---|---|
| **Bar fill** | translucent `rgba(12,14,18,0.72)` over BlurView (denser than the nav's 0.55 so it reads as the active layer) | **opaque `#16181b`** via `Platform.select`, NO BlurView, `overflow:'hidden'` to clip the capsule, **no shadow** under the rounded fill (Android elevation draws a hard rectangle — forbidden by policy) | translucent w/ `backdrop-filter` only ≥768px (mobile-web falls back to opaque `#16181b`, same as Android) — match the Toast's `shouldUseRealBlur` width rule |
| **Checkbox fill** | as §4.1 | identical (the unchecked `rgba(12,14,18,0.55)` + checked `accent.warm` are already opaque-safe; no translucent leak) | identical |
| **Selected wash** | `accent.tint` overlay | identical (overlay over the opaque host base reads the same warm) | identical |
| **Entry haptic** | `Medium` impact (`selectionEnter`) | `Medium` impact (Android supports `ImpactFeedbackStyle.Medium` via expo-haptics) | no-op (safeHaptic) |
| **Toggle haptic** | `Light` (`buttonPress`) | `Light` | no-op |
| **Press feedback on the row** | opacity press (existing `cardBodyPressed` 0.85) + the hold-ring | same; the existing card uses opacity not ripple, keep it (do NOT introduce a TouchableNativeFeedback ripple — the cards are `Pressable` opacity app-wide; consistency wins) | hover: subtle `opacity:0.92` on the row in SELECT mode (web only); cursor `pointer` |
| **Null-shake (non-draft)** | translateX shake | identical | identical |
| **Bar shadow** | `shadows.glassChrome` (iOS shadow only; the token already zeroes Android elevation via `androidSafeElevation`) | none (token auto-zeroes) | CSS `box-shadow` ok |

**ANDROID_GLASS_USES_OPAQUE_FALLBACK invariant (hard constraint):** the bar fill is opaque `#16181b` on Android with `overflow:'hidden'` and zero elevation/shadow. The checkbox and selected wash are already opaque-safe. This satisfies the shared gate exactly as the cards do.

---

## 8. Accessibility

| Element | role | label | state | target |
|---|---|---|---|---|
| Draft row (SELECT mode) | `checkbox` | `${title}` | `accessibilityState={{ checked: selected }}` | whole row ≥44pt (cover is 92 tall) ✔ |
| Draft row (BROWSE) | `button` | `Open ${title}` (existing) + `accessibilityHint="Double tap and hold to select multiple"` | — | ≥44 ✔ |
| `DraftSelectCheckbox` | none (decorative — the ROW carries the checkbox role) | — | — | n/a (presentational; SPEC §3.5) |
| Bar `Cancel` | `button` | `Cancel selection` | `disabled` when deleting | 88×40, hitSlop to 44 ✔ |
| Bar `Delete (N)` | `button` | `Delete ${N} selected draft${N===1?"":"s"}` (SPEC §3.4) | `accessibilityState={{ disabled: N===0 \|\| deleting }}` | minHeight 40 + hitSlop 4 → ≥44 ✔ |
| Non-draft row (SELECT) | none | hidden from a11y tree (`accessibilityElementsHidden` iOS / `importantForAccessibility="no-hide-descendants"` Android) while inert | — | — |
| Mode-enter announcement | — | on entering SELECT: `AccessibilityInfo.announceForAccessibility("Selection mode. 1 draft selected.")` | — | — |
| Count change | the bar label IS live; with VoiceOver, set `accessibilityLiveRegion="polite"` (Android) on the count text + re-announce count on toggle for iOS parity | — | — | — |

**Role choice:** in SELECT mode each draft row becomes `role="checkbox"` with `accessibilityState.checked` — this is the correct semantic (a togglable selectable item), and it overrides the BROWSE `role="button"`. The implementor switches the row's `accessibilityRole` based on `selectionMode && selectable`.

**Dynamic Type:** §3 — bar/caption scale; checkbox circle fixed; Delete label `adjustsFontSizeToFit minimumFontScale 0.85` so `Delete (128)` never clips.

**Reduced motion:** every animation has a fallback (§5.2/5.3/5.5 opacity-only; §5.1 hold-ring keeps opacity, drops scale; null-shake skipped). The hold-ring's opacity fade is retained even in reduced-motion because it is *load-bearing affordance* (it teaches the gesture), but its scale component is dropped.

**Color independence:** checked vs unchecked differ by FILL + GLYPH (shape), not only hue (§4.1). Selected row differs by border weight + warm wash. ✔

**Contrast (text-on-surface):**
- Cancel label `text.secondary` (0.72 white) on `#16181b`/translucent dark → ≈ 9:1 ✔
- Delete label #fff on `#eb7825` → ≈ 2.9:1 (established app-wide action pairing, shape/position reinforce; matches `ariPalette.userBubble` precedent) — accepted per existing brand pairing
- Caption `text.tertiary` (0.52) on `canvas.discover` → ≈ 5.3:1 ✔ (AA for 12pt)
- Toast / dialog inherit their shipped, already-passing contrast.

---

## 9. Build-ready handoff — net-new primitives (full token spec)

### 9.1 `DraftSelectCheckbox.tsx` (NEW — SPEC §3.5)

Purely presentational (no own press). Props `{ selected: boolean; testID?: string }`.

```
Container (Animated.View):
  width: 24, height: 24, borderRadius: 12
  alignItems: 'center', justifyContent: 'center'
  borderWidth: 1.5
  // unchecked
  backgroundColor: 'rgba(12,14,18,0.55)'
  borderColor: 'rgba(255,255,255,0.85)'
  // selected (toggle these)
  backgroundColor: accent.warm        // #eb7825
  borderColor: accent.warm
Glyph (when selected): <Icon name="check" size={14} color="#ffffff" />  // stroke ~2.5 via Icon default
Position when placed by the card: absolute, top: spacing.xs (4), left: spacing.xs (4), zIndex above cover+DRAFT overlay
Bounce on toggle: scale spring {damping:12, stiffness:320, mass:0.7}, check 1→1.18→1, uncheck 1→0.85→1
Enter: opacity 0→1 + scale 0.6→1 + translateX -6→0, durations.entry (260) easings.out
Reduced-motion: opacity-only, durations.fast (120)
a11y: presentational (no role); the row owns role="checkbox"
testID: `draft-select-checkbox` (+ optional suffix from caller)
```

### 9.2 `DraftSelectBar.tsx` (NEW — SPEC §3.4)

Props (from SPEC, unchanged): `{ count, deleting, onCancel, onDelete, bottomInset }`. Shown only when `selectionMode===true` (the tab gates the mount; the bar animates its own enter/exit).

```
Outer Animated.View (the capsule):
  position: 'absolute', left: spacing.md (16), right: spacing.md (16)
  bottom: bottomInset + 64 + spacing.sm + spacing.sm   // = bottomInset + 80  (clear NAV_HEIGHT 64 + 8 gap + 8)
  height: 56, borderRadius: radius.full (999), overflow: 'hidden'
  flexDirection: 'row', alignItems: 'center'
  paddingHorizontal: spacing.md (16), gap: spacing.sm (8)
  // fill — Platform.select:
  ios:     translucent rgba(12,14,18,0.72) over a <BlurView intensity={blurIntensity.chrome (28)} tint="dark" absoluteFill/>
  android: opaque '#16181b' (no BlurView), no elevation
  web:     blurOk(width)? translucent : '#16181b'
  border: 1px glass.border.chrome (rgba(255,255,255,0.14))
  shadow (iOS only): shadows.glassChrome  (token auto-zeroes Android elevation)
  enter: translateY +24→0 + opacity 0→1, durations.entry (260) easings.out
  exit:  translateY 0→+24 + opacity→0, durations.exit (180) easings.in
  reduced-motion: opacity-only, durations.fast (120)

Cancel (left):
  Pressable, minWidth 88, height 40, borderRadius radius.full, borderWidth 1 glass.border.chrome
  bg transparent; pressed rgba(255,255,255,0.06); disabled when `deleting`
  label "Cancel", typography.buttonMd, color text.secondary
  testID 'draft-select-cancel', role button, label "Cancel selection"

spacer: flex 1

Delete (right):
  Pressable (or kit Button variant primary with loading), minHeight 40, paddingHorizontal spacing.md (16), borderRadius radius.full
  enabled bg accent.warm, label `Delete (${count})` typography.buttonMd color #fff
  pressed bg #d96c1f
  disabled (count===0 || deleting) bg rgba(235,120,37,0.32), label color rgba(255,255,255,0.5)
  deleting: spinner #fff replaces label
  Delete label: numberOfLines 1, adjustsFontSizeToFit minimumFontScale 0.85
  testID 'draft-select-delete', role button
  accessibilityLabel `Delete ${count} selected draft${count===1?"":"s"}`
  accessibilityState {disabled: count===0 || deleting}
```

### 9.3 New haptic helper — `HapticFeedback.selectionEnter()` (additive)

```ts
// add to mingla-business/src/utils/hapticFeedback.ts (mirrors existing safe-wrap)
static selectionEnter() {
  HapticFeedback.safeHaptic(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  });
}
```
Called once at the `delayLongPress` fire (mode enter). `buttonPress()` (Light) is reused for every per-row toggle. `success()` is NOT used here (the toast is the success signal; a success haptic on delete would feel celebratory about destruction — avoid).

### 9.4 Card prop additions are visual-only consumers

The card prop additions (`selectionMode`, `selected`, `selectable`, `onLongPress`) are defined in SPEC §3.7.1. DESIGN's contribution to the cards:
- Add the hold-ring overlay (§5.1B) as an absolute-fill `Animated.View` child of the host, driven by the body Pressable's `onPressIn`/`onPressOut` (only when `selectable`).
- Add the selected wash overlay (§4.2) as an absolute-fill child, gated by `selected`.
- Place `<DraftSelectCheckbox selected={selected} />` top-left of the cover when `selectionMode && selectable`.
- Bump host border to `accent.border` @1.5px when `selected`.
- Apply `opacity:0.4` + `pointerEvents:'none'` when `selectionMode && !selectable`.
- Fade/hide the manage 3-dot when `selectionMode` (§5.4).
- Swap row `accessibilityRole` to `checkbox` + set `accessibilityState.checked` when `selectionMode && selectable` (§8).

All overlays are children INSIDE the `overflow:'hidden'` host so they clip to `radius.lg` on every platform — no platform fork needed for the wash or ring.

---

## 10. Motion table (consolidated)

| # | Trigger | Property | From→To | Curve | Duration | Reduced-motion |
|---|---|---|---|---|---|---|
| M1 | row `onPressIn` (selectable) | hold-ring opacity + scale | 0→0.9 / 1.02→1.0 | `easings.out` | 350 (= delayLongPress) | opacity only |
| M2 | press released < threshold | hold-ring opacity | →0 | `easings.in` | `durations.fast` 120 | same |
| M3 | long-press fires (mode enter) | checkbox in (staggered) | opacity 0→1, scale 0.6→1, tx −6→0 | `easings.out` | `durations.entry` 260 (+16ms/row, cap 120) | opacity only, no stagger, 120 |
| M4 | mode enter | bar slide-up | translateY +24→0, opacity 0→1 | `easings.out` | `durations.entry` 260 | opacity only 120 |
| M5 | row tap (check) | checkbox bounce | scale 1→1.18→1 | spring d12/s320/m0.7 | ~200 | none (instant) |
| M6 | row tap (uncheck) | checkbox dip | scale 1→0.85→1 | spring d12/s320/m0.7 | ~200 | none |
| M7 | toggle | selected wash | opacity in/out | `easings.inOut` | `durations.fast` 120 | instant |
| M8 | non-draft long-press | row null-shake | translateX 0/−4/+4/0 | `easings.inOut` | `durations.normal` 200 | skip |
| M9 | Cancel / post-delete | checkbox + bar exit | reverse of M3/M4 | `easings.in` | `durations.exit` 180 | opacity only 120 |
| M10 | mode enter/exit | manage 3-dot fade | opacity 1↔0 | `easings.inOut` | `durations.fast` 120 | instant |

All durations/easings resolve to `durations` / `easings` tokens in `designSystem.ts`. The two spring configs (M5/M6 checkbox, and the kit BottomNav spring it echoes) are inline literals matching the codebase's existing spring style.

---

## 11. What is deliberately NOT designed (honoring scope)

- No coachmark/onboarding modal (caption + hold-ring is enough; modals get dismissed-and-forgotten).
- No header "Select" button (Q7 — long-press is sole entry).
- No new filter pills / "Drafts" filter on experiences (Q2).
- No undo/trash/restore UI (out of scope).
- No drag-select / select-all (out of scope; the count + per-row toggle is the whole interaction).
- No animated count digits (the count must read as an instant live counter).
- No card scale on selection (jittery during rapid multi-tap; wash+border is calmer and matches the BottomNav spotlight language).
- No red on the bar Delete (red is reserved for the irreversible dialog confirm — deliberate two-tier escalation).

---

## Summary

Long-press multi-select for drafts gets a **two-part discoverability solution** — a persistent `text.tertiary` caption ("Press and hold a draft to select multiple") above the drafts list, plus a **press-and-hold accent-warm ring** that charges over the 350ms `delayLongPress` so the gesture teaches itself, with a **Medium-impact entry haptic** (new `selectionEnter` helper). The **checkbox** is a 24pt circle, top-left over the cover: unchecked = `rgba(12,14,18,0.55)` fill + `rgba(255,255,255,0.85)` 1.5px ring; checked = solid `accent.warm` + white `check` glyph (shape change, not hue-only), with a spring bounce on toggle. **Selected rows** get an `accent.tint` wash overlay + `accent.border` 1.5px border (matching the BottomNav spotlight language); non-draft rows dim to 0.4 + inert. The **`DraftSelectBar`** is a `radius.full` capsule floating `bottomInset + 80pt` up (clearing the 64pt BottomNav + 8 + 8): left `Cancel` (secondary), right `Delete (N)` in brand warm (NOT red — red is reserved for the dialog's irreversible confirm; two-tier escalation), disabled-but-present at N=0, slide-up entry. **Copy** is verbatim per SPEC: dialog `Delete this draft?` / `Delete ${N} drafts?` with `Keep` / `Delete ${N}`; toasts `Deleted N drafts.` (success) / `Deleted N, M couldn't be deleted.` (**warn**, 6s dwell) / `Couldn't delete N drafts. You may not have permission.` (**error**, 12s). Android opaque-glass policy honored (bar `#16181b` opaque, `overflow:'hidden'`, no shadow). Full a11y: row becomes `role="checkbox"` with `checked` state, ≥44pt targets, mode-enter announcement, every animation has a reduced-motion fallback. Net-new primitives (`DraftSelectCheckbox`, `DraftSelectBar`, `selectionEnter` haptic) are fully tokenized in §9 for one-time build.

**Artifact:** `Mingla_Artifacts/specs/DESIGN_ORCH-1123_HUB_MULTISELECT_DRAFT_DELETE.md`
