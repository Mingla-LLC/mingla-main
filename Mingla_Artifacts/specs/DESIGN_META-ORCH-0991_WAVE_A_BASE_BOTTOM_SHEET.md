# DESIGN — META-ORCH-0991 [Consumer-app modals → slide-down bottom sheets] — **WAVE A**

**Mode:** DESIGN (no product code; no `.tsx`/runtime edits; design contract only — exact token values + motion/a11y decisions the implementor pastes in)
**Scope:** Wave A `BaseBottomSheet` primitive — the **🎨 OPEN polish items** enumerated in `SPEC_META-ORCH-0991_WAVE_A_BASE_BOTTOM_SHEET.md` §14. This doc resolves all 5 OPEN items to buildable values and ships two literal `designSystem.ts` token additions.
**Surface:** `app-mobile/` (consumer iOS + Android) ONLY.
**Worktree:** `~/Desktop/mingla-orchs/META-ORCH-0991-[consumer-modals-to-sheets]/` on branch `META-ORCH-0991-consumer-modals-to-sheets` (Metro :8087).
**Author:** mingla-designer
**Date:** 2026-05-29
**Source of truth (read in order):** SPEC `Mingla_Artifacts/specs/SPEC_META-ORCH-0991_WAVE_A_BASE_BOTTOM_SHEET.md` (`ec3329471`) §14 + §6 + §7; INVESTIGATION `Mingla_Artifacts/reports/INVESTIGATION_META-ORCH-0991_CONSUMER_MODALS_TO_SHEETS.md`; tokens `app-mobile/src/constants/designSystem.ts:274-344`.

---

## ⚠ REWORK SUPERSESSION — STOCK gorhom default motion (operator decision 2026-05-29)

> **Seth rejected the custom-motion version.** The `BaseBottomSheet` primitive must feel **EXACTLY** like
> `app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx` — which uses the **stock
> `@gorhom/bottom-sheet` DEFAULT spring** (passes **NO** `animationConfigs`). That default ("rolls up and
> closes") IS the feel Seth wants.
>
> **What this supersedes in the sections below:**
> - **§3 (OPEN #2 — Snap spring feel) — SUPERSEDED / REJECTED.** The custom `SHEET_SPRING`
>   (`damping 50 / stiffness 320 / overshootClamping / ReduceMotion.System` via `useBottomSheetSpringConfigs`)
>   is **REMOVED** from `BaseBottomSheet.tsx`. The primitive passes **no** `animationConfigs`; gorhom's
>   default spring carries open/snap/snap-snap/dismiss-settle for all consumers, byte-equivalent to the
>   reference sheet. gorhom's default already honors OS reduce-motion internally, so the Reanimated
>   `ReduceMotion` import is gone too.
> - **§2 (OPEN #1 — Handle resting vs active treatment) — REJECTED for Wave A.** The handle is **STATIC**,
>   matching `ExpandedBusinessEventSheet`'s static `handleIndicatorStyle`. The custom pan-engage
>   brighten/widen/scale (`handleActive`) micro-interaction is **NOT wired** into the primitive. The
>   `glass.bottomSheet.handleActive` / `glass.notificationsSheet.handleActive` tokens remain **defined-but-unused**
>   in `designSystem.ts` (kept to avoid touching other refs; the primitive does NOT animate the handle).
>
> **What still stands (NOT motion — preserved):** the declarative `index={visible ? initialIndex : -1}`
> open/close, `enablePanDownToClose`, `snapPoints` from `glass.bottomSheet.snapPoints` (`['50%','90%']`),
> `BottomSheetBackdrop`, the static handle/background tokens, top-radius 28, handle 36×4, the inline-vanilla
> `<BottomSheet>` architecture, `wrapInRNModal` z-stacking, keyboard-aware text input, and the scrollMode
> variants. §4 (flat backdrop), §5 (`center-dialog` — which is RN-Modal `animationType="fade"`, never used
> the custom spring), and §6.2 (reduce-transparency backdrop floor) all stand. Only the custom MOTION
> (§3 spring) and the handle-active animation (§2) are reverted to stock.
>
> Implemented in the Wave A REWORK commit; see `Mingla_Artifacts/reports/IMPLEMENTATION_META-ORCH-0991_WAVE_A_BASE_BOTTOM_SHEET.md` §REWORK.

---

## 0. Comms ledger + lock acknowledgment

- **COMMS_LEDGER scanned** (`/Users/sethogieva/Desktop/mingla-main/COMMS_LEDGER.md`). No OPEN `BLOCK` row targets `mingla-designer`, `META-ORCH-0991`, or `ALL`. **COMMS-0003** (`ALL`/WARN — external-API params doc-cited inline) is factored: this DESIGN introduces **no new external API surface** — gorhom's `animationConfigs`, `useBottomSheetSpringConfigs`, and Reanimated's `ReduceMotion` enum are each cited inline below against the provider typings/docs. **COMMS-0002** (ORCH-0863 backend allowlist) is **N/A** — this is a docs-only artifact + a future `designSystem.ts` change; zero `supabase/functions/` or `supabase/migrations/` touch. No new cross-ORCH discovery to write.

- **🔒 LOCKED items I did NOT touch** (per SPEC §14 "LOCKED for the designer"): the two existing token sets (`glass.bottomSheet`, `glass.notificationsSheet`), top-radius **28**, handle **36×4** + radius 2 + marginTop 8 / marginBottom 12, the safe-area floor `Math.max(insets.bottom, 16)`, the per-sheet parity colors (§7), the no-AI-slop bans (§6.5), the inline-vanilla `<BottomSheet>` architecture, the `wrapInRNModal` mechanism, the `snapPoints` values, and the dismiss/pan-down thresholds. **None of my additions mutate an existing key** — they are strictly additive (`glass.bottomSheet.handleActive` is a NEW sibling key inside the existing block; `glass.centerDialog` is a NEW top-level `glass.*` block).

- **References examined** (premium-craft §3, real apps studied for THIS moment — a calm modal sheet's handle/motion/dialog/a11y): **Apple iOS `UISheetPresentationController`** (grabber resting/active states, the system detent spring, `prefersReducedMotion`/`prefersReducedTransparency` UIAccessibility behavior), **Linear iOS** (handle widens + brightens on grab; snappy critically-near-damped spring), **Things 3** (calm flat-tint light backdrop, no blur — confirms the flat-tint floor for our light theme), **Airbnb iOS** (centered confirm dialog dimensions + scrim), **Stripe/Linear destructive confirm dialogs** (center-dialog radius + shadow + entry scale). The primitive does NOT invent a new look — it consolidates the look ORCH-0696/0975 already shipped and adds only the missing active/dialog/a11y states.

---

## 1. The five 🎨 OPEN items — resolved (summary table)

| # | OPEN item (SPEC §14) | Resolution (exact) | Lands in |
|---|----------------------|--------------------|----------|
| 1 | Handle resting vs active (drag) treatment | Resting = locked token color. Active = NEW `handleActive` token: **brighter color + widen 36→44 + 1.06 scale**, driven by a 160 ms timing crossfade tied to the sheet's drag/settle gesture. | `glass.bottomSheet.handleActive` (NEW key) §2 |
| 2 | Snap spring feel | gorhom `animationConfigs` = a **Reanimated spring**, `damping 50 / stiffness 320 / mass 1 / overshootClamping true`. Same spring for snap + dismiss-settle. Does NOT change snapPoints or dismiss thresholds. | Motion spec §3 (value lives in `BaseBottomSheet.tsx`, not a token — see §3.4) |
| 3 | Light-theme backdrop blur vs flat | **FLAT tint, no blur.** Reuse locked `glass.notificationsSheet.backdropTint` (`rgba(0,0,0,0.32)`). Matches the locked dark scrim semantics + Things 3 reference. No new token. | Decision §4 |
| 4 | `center-dialog` variant visual | NEW `glass.centerDialog` block: canvas/radius/shadow/backdrop/margins/maxWidth + entry/exit motion, dark+light. | `glass.centerDialog` (NEW block) §5 |
| 5 | Reduced-motion + reduce-transparency fallbacks | `prefersReducedMotion` → swap spring for an 200 ms `linear`-ish ease + `ReduceMotion.System` on the handle/dialog animations; backdrop appears instantly (no fade). `prefersReducedTransparency` → backdrop opacity floored UP to 0.6 (dark) / 0.45 (light) flat, never blur. Encoded as token sub-keys so the implementor reads them, not invents them. | `a11y` sub-keys on both new tokens §6 |

All five are pinned to exact hex / px / ms / easing below. Nothing is left to implementor guess.

---

## 2. OPEN #1 — Handle resting vs active (drag) treatment

> **🚫 REJECTED (REWORK 2026-05-29).** The handle is STATIC in the shipped primitive — see the REWORK
> supersession banner at the top. Section retained for history only; do NOT implement the active-handle
> animation in Wave A. The `handleActive` tokens stay defined-but-unused.

### 2.1 Design rationale

The locked handle (36×4, radius 2) is the resting affordance. Today it is **static** — it gives no feedback when grabbed, so a drag-to-dismiss feels like nothing is "in hand." Every premium reference (iOS grabber, Linear) brightens and slightly enlarges the grabber the instant the pan engages, then settles it back on release/settle. This is the single highest-value micro-interaction in the whole primitive: it confirms "I have the sheet" at the exact moment of intent.

The treatment is **restrained** (premium-craft §2 anti-slop): no glow, no color shift to brand-orange, no pulsing. Only (a) the handle gets brighter within its own neutral family, (b) it widens slightly, (c) a sub-perceptible scale. It reads as "the handle woke up," not "a thing is animating."

### 2.2 Exact values — DARK theme active handle

Resting (LOCKED, unchanged): `color rgba(255,255,255,0.30)`, `width 36`, `height 4`.

Active (NEW):
- **color** `rgba(255,255,255,0.55)` — same white family, opacity 0.30 → 0.55 (a clear but calm brighten; not full-opacity which would read as a different element).
- **width** `44` (36 → 44; +8px, an 8-on-the-4px-grid step; height stays 4, radius stays 2).
- **scale** `1.06` (applied via transform on the handle indicator wrapper; sub-perceptible enlargement that reads as "lift").

### 2.3 Exact values — LIGHT theme active handle

Resting (LOCKED, unchanged): `color rgba(0,0,0,0.18)`, `width 36`, `height 4`.

Active (NEW):
- **color** `rgba(0,0,0,0.34)` — same black family, opacity 0.18 → 0.34 (proportional brighten matching the dark theme's ratio).
- **width** `44`.
- **scale** `1.06`.

### 2.4 Transition (resting ↔ active)

- **Trigger:** active state engages when the sheet's pan gesture is in progress OR the sheet is between snap points (i.e. `animatedIndex` is non-integer / the gesture handler is active). Resting returns when the sheet settles on a snap (integer index) or closes.
- **Curve:** `timing`, **duration 160 ms**, easing **`Easing.out(Easing.cubic)`** on engage, **`Easing.inOut(Easing.cubic)`** on release. (160 ms = the SPEC's "micro" band; fast enough to feel attached, slow enough not to flicker on a tap.)
- **Reduced motion:** when `prefersReducedMotion` is on, the color still changes (it's information, not decoration) but width + scale do NOT animate — they snap. See §6.
- **Implementor note (mechanism, not a token):** drive the active state from gorhom's `animatedIndex` (a Reanimated shared value exposed by the sheet) inside a `useAnimatedStyle` on the custom `handleComponent`, OR a `handleIndicatorStyle` interpolation. The token below supplies the target values; the wiring is implementor craft. [gorhom: `handleComponent` / `handleIndicatorStyle` props — https://gorhom.dev/react-native-bottom-sheet/props ; `animatedIndex` shared value — https://gorhom.dev/react-native-bottom-sheet/props]

### 2.5 Token to paste — `glass.bottomSheet.handleActive`

Add this as a NEW sibling key **inside** the existing `glass.bottomSheet` block (do NOT alter the existing `handle` key). Place it directly after the `handle` key, matching the existing comment style:

```ts
    // META-ORCH-0991 (DESIGN) — Active (mid-drag / between-snap) handle treatment.
    // Resting handle stays glass.bottomSheet.handle (LOCKED). On pan-engage the
    // handle brightens + widens + lifts; returns to resting on snap-settle/close.
    // Drive from gorhom animatedIndex via useAnimatedStyle. 160ms cubic crossfade.
    handleActive: {
      color: 'rgba(255, 255, 255, 0.55)', // resting 0.30 → active 0.55 (same family)
      width: 44,                            // resting 36 → active 44 (+8, 4px grid)
      scale: 1.06,                          // sub-perceptible lift
      transitionMs: 160,                    // engage/release crossfade duration
    },
```

And the LIGHT-theme active handle goes as a NEW sibling key inside `glass.notificationsSheet` (after its `handle` key):

```ts
    // META-ORCH-0991 (DESIGN) — Active handle for the light canvas. Mirrors
    // glass.bottomSheet.handleActive ratios in the black family.
    handleActive: {
      color: 'rgba(0, 0, 0, 0.34)', // resting 0.18 → active 0.34 (same family)
      width: 44,
      scale: 1.06,
      transitionMs: 160,
    },
```

> The primitive's `theme` prop already selects `glass.bottomSheet` vs `glass.notificationsSheet`; `handleActive` rides that same selection so dark/light each get the correct active handle with zero extra prop plumbing.

---

## 3. OPEN #2 — Snap spring feel

> **🚫 SUPERSEDED / REJECTED (REWORK 2026-05-29).** The custom `SHEET_SPRING` was REMOVED. The primitive
> passes NO `animationConfigs` and uses gorhom's DEFAULT spring, cloned from `ExpandedBusinessEventSheet`.
> See the REWORK supersession banner at the top. Section retained for history only.

### 3.1 Constraint

The `snapPoints` values and the pan-down dismiss thresholds are **LOCKED** (SPEC §7). I am ONLY specifying the *spring that carries the sheet between* states — the feel of the settle, not where it settles. gorhom drives all of (open→snap, snap→snap, drag-release→settle, drag-past-threshold→dismiss) with a single `animationConfigs` value, so one spring governs all transitions. [gorhom prop `animationConfigs?: WithSpringConfig | WithTimingConfig` — verified in `node_modules/@gorhom/bottom-sheet/lib/typescript/components/bottomSheet/types.d.ts:337`; docs https://gorhom.dev/react-native-bottom-sheet/props]

### 3.2 Design rationale

Default gorhom v5 uses a fairly bouncy spring; on a content-heavy sheet (ExpandedCardModal, NotificationsSheet section list) a visible overshoot/bounce reads as "toy-like" and fights the calm, premium tone (premium-craft §2 — no decorative bounce). The reference apps (iOS detents, Linear) use a **critically-near-damped** spring: fast arrival, **no overshoot**, settles in ~300–350 ms. That is the feel we want — decisive, quiet, expensive.

### 3.3 Exact spring config

A Reanimated `WithSpringConfig`:

| Field | Value | Why |
|-------|-------|-----|
| `damping` | **50** | Near-critical for `stiffness 320 / mass 1` (critical ≈ 2·√(320)·1 ≈ 35.8; 50 is over-damped → guarantees ZERO overshoot). |
| `stiffness` | **320** | Arrival in ~320–360 ms — matches the SPEC "standard" band and the iOS detent settle. |
| `mass` | **1** | Default; keeps the math predictable. |
| `overshootClamping` | **true** | Hard guarantee of no bounce even if a future tuner lowers damping. |
| `restDisplacementThreshold` | **0.01** | Settles crisply (sheet position is a 0..1 fraction). |
| `restSpeedThreshold` | **2** | Stops the animation promptly; no long tail. |
| `reduceMotion` | **`ReduceMotion.System`** | Honors OS reduce-motion automatically (see §6). [Reanimated enum verified `node_modules/react-native-reanimated/lib/typescript/commonTypes.d.ts:291` — `System | Always | Never`; docs https://docs.swmansion.com/react-native-reanimated/docs/guides/accessibility] |

### 3.4 Where this lives (NOT a designSystem token)

Per the SPEC's no-magic-numbers discipline, but also because this is an *animation-engine* config (not a visual chrome value like a color/radius), the implementor should define it as a **named const inside `BaseBottomSheet.tsx`** built with gorhom's `useBottomSheetSpringConfigs` hook (verified present: `node_modules/@gorhom/bottom-sheet/lib/typescript/hooks/useBottomSheetSpringConfigs.d.ts`), and pass it to the `<BottomSheet animationConfigs={...}>` prop:

```ts
// META-ORCH-0991 (DESIGN) — Snap/settle spring. Critically-near-damped,
// zero overshoot, ~320ms arrival. Governs open/snap/snap-snap/dismiss-settle.
// Does NOT change snapPoints or dismiss thresholds (those are gesture, not spring).
const SHEET_SPRING = useBottomSheetSpringConfigs({
  damping: 50,
  stiffness: 320,
  mass: 1,
  overshootClamping: true,
  restDisplacementThreshold: 0.01,
  restSpeedThreshold: 2,
  reduceMotion: ReduceMotion.System,
});
```

> Rationale for not putting this in `designSystem.ts`: `designSystem.ts` holds visual chrome tokens (color/spacing/radius/shadow), not Reanimated runtime config objects, and no existing token block carries spring fields. Co-locating the spring const in the primitive (with the comment above) keeps it discoverable for the one file that owns motion, and keeps `designSystem.ts` to pure-visual tokens. If the orchestrator prefers a token, the values above are the literal contents — but the recommendation is the named const.

### 3.5 Parity guard

Because today's 5 sheets pass **no** `animationConfigs` (verified by grep — they ride gorhom's default spring), introducing `SHEET_SPRING` is a *deliberate, uniform* feel change applied to all 5 at once via the primitive. This is acceptable and desirable (it's the polish this DESIGN owns), but the tester must eyeball that the new settle reads as "calmer, no bounce" and not as "slower/laggy." If on-device the 320-stiffness reads sluggish, the single safe tuning knob is **stiffness only, within 300–360**; damping stays ≥ 2·√(stiffness) to preserve zero-overshoot. Do NOT touch snapPoints/thresholds to chase feel.

---

## 4. OPEN #3 — Light-theme backdrop: blur vs flat

**Decision: FLAT tint. No blur.**

- **Value:** reuse the LOCKED `glass.notificationsSheet.backdropTint` = `rgba(0,0,0,0.32)`, rendered through the standard `BottomSheetBackdrop` (SPEC §3.2). No new token, no `expo-blur` layer.
- **Why flat, not blur:**
  1. **Parity floor (LOCKED):** the current 5 sheets render a flat tint backdrop (the dark theme's `glass.bottomSheet.scrim` is a flat color with an *unused-in-sheet* `blurIntensity` field; the light theme is flat `backdropTint`). "Current behavior is the floor" (SPEC §2 assumptions). A blur would be a *regression from parity*, not polish.
  2. **Reference confirmation:** Things 3 + iOS form sheets use a flat dim scrim for content sheets; reserve blur for system control centers, not content dialogs. A blur behind a content sheet muddies the deck/list underneath and reads as heavier, not lighter.
  3. **Cost/risk:** a live `BlurView` behind every sheet is a real GPU cost on Android and a known crash/flicker surface; the no-AI-slop ban (§6.5) explicitly forbids "decorative blur beyond the existing scrim/backdropTint." Flat tint is correct AND cheaper AND safer.
- **Dark theme (already locked):** flat `glass.bottomSheet.scrim.color` at the per-sheet opacity (ExpandedCardModal 0.55, etc.). Unchanged; documented here only for completeness.
- **Reduce-transparency interaction:** see §6 — when `prefersReducedTransparency` is on, the flat tint opacity is floored UP (more opaque), still flat, never blur.

No token addition for this item. The decision is "keep the locked flat tint; do not add blur."

---

## 5. OPEN #4 — `center-dialog` variant visual

### 5.1 Context

The `center-dialog` variant (SPEC §3.1 `variant`) is the centered confirm-card look for Wave-B consumers (BlockUserModal, IncomingPairRequestCard, PairingInfoCard, AccountSettings delete-confirm). It does **NOT** use gorhom — it reuses the RN-Modal + centered `Animated.View` pattern already in `IncomingPairRequestCard`. Wave A only types the `variant` prop and may stub the body (SPEC §2 non-goal); this DESIGN supplies the exact `glass.centerDialog` token block so that whenever the body lands (Wave A stub or Wave B) the implementor pastes values, never guesses.

### 5.2 Design rationale

A confirm dialog is a *different moment* from a sheet: it interrupts to ask a yes/no, it must NOT be flick-dismissable (a confirm you can swipe away is a footgun — INVESTIGATION §2), and it sits in the optical center. The visual must read as "a decision," distinct from the calm slide-up sheet: smaller, fully-rounded card, a slightly heavier scrim (because it's a hard interrupt), a confident but quick scale-in entry. References: Airbnb / Stripe / Linear destructive-confirm dialogs — ~28px radius card, ~340pt max width, generous internal padding, a scale-from-0.96 + fade entry.

### 5.3 Exact values

**Card (dark + light):**
- **radius** `28` (matches the sheet `topRadius` 28 → same rounding language across the family; all four corners).
- **maxWidth** `340` (caps width on tablets/large phones; reads as a card, not a band).
- **horizontalMargin** `24` (= `spacing.lg`; the card never touches the screen edge on small phones — width = `min(340, screenWidth - 48)`).
- **paddingVertical** `24` (`spacing.lg`), **paddingHorizontal** `24` (`spacing.lg`) — internal content inset.
- **dark canvas** `rgba(12,14,18,1)` (matches ExpandedCardModal's dark sheet canvas — same family).
- **light canvas** `#FFFFFF` (matches `notificationsSheet.canvas`).
- **dark hairline** `rgba(255,255,255,0.08)` (= the locked sheet hairline), **light hairline** `rgba(0,0,0,0.06)` (= `notificationsSheet.cardBorder`) — 1×`StyleSheet.hairlineWidth` border so the card edge reads on either canvas.

**Shadow (the card floats above the scrim):**
- Reuse the elevation language of the existing sheet shadow but tuned for a centered card (shadow on all sides, not just top):
  - `shadowColor '#000'`, `shadowOffset { width: 0, height: 12 }`, `shadowOpacity 0.32`, `shadowRadius 28`, `elevation 24`.
  - Rationale: a centered dialog needs an even, deep drop to lift off the scrim; height 12 / radius 28 / opacity 0.32 reads as "elevated decision card" without a glow. (Heavier than `shadows.xl` height-20 because that token is for full-width surfaces; a small card needs a tighter, deeper pool.)

**Backdrop (scrim behind the dialog):**
- **dark** `rgba(0,0,0,0.62)`, **light** `rgba(0,0,0,0.45)`.
- Rationale: a confirm interrupt warrants a *heavier* scrim than a sheet (sheet dark 0.55 / light 0.32) so the dialog reads as a hard modal stop and the background recedes fully. Flat tint, no blur (same rule as §4).
- `pressBehavior`: backdrop press = **no-op by default** for destructive confirms (the dialog must be answered, not dismissed by an accidental tap). A non-destructive info dialog (PairingInfoCard) MAY opt backdrop-press → close via a prop on the variant. Pan-down is FORCED OFF (`enablePanDownToClose=false`, SPEC §3.1). The only guaranteed dismiss is an explicit button.

**Entry / exit motion:**
- **Entry:** `opacity 0 → 1` over **180 ms** `Easing.out(Easing.cubic)`, simultaneously `scale 0.96 → 1.0` with the §3.3 spring (`damping 50 / stiffness 320`, zero overshoot) so the card "arrives and sets" rather than springs. Scrim fades `0 → target opacity` over the same 180 ms.
- **Exit:** `opacity 1 → 0` + `scale 1.0 → 0.97` over **140 ms** `Easing.in(Easing.cubic)`; scrim fades out over 140 ms. Slightly faster out than in (standard: dismissals feel snappier than entrances).
- **Reduced motion:** no scale, no fade — the dialog + scrim appear/disappear instantly. See §6.

### 5.4 Token to paste — NEW `glass.centerDialog` block

Add as a NEW top-level key inside the `glass` object (a sibling to `bottomSheet` and `notificationsSheet`), placed directly AFTER the `notificationsSheet` block, matching the ORCH-comment convention:

```ts
  // META-ORCH-0991 (DESIGN) — Center-dialog variant chrome. Centered confirm
  // card (NOT gorhom — RN Modal + centered Animated.View). NO pan-down; the
  // only guaranteed dismiss is an explicit button. Flat scrim, no blur.
  // First consumers are Wave-B confirm dialogs (BlockUser / IncomingPairRequest
  // / PairingInfo / AccountSettings delete-confirm). Wave A types the variant
  // prop; the body may stub. Radius 28 matches the sheet family.
  centerDialog: {
    radius: 28,
    maxWidth: 340,
    horizontalMargin: 24,   // spacing.lg — card never touches screen edge
    paddingVertical: 24,    // spacing.lg
    paddingHorizontal: 24,  // spacing.lg
    dark: {
      canvas: 'rgba(12, 14, 18, 1)',   // matches ExpandedCardModal dark sheet canvas
      hairline: 'rgba(255, 255, 255, 0.08)',
      backdropTint: 'rgba(0, 0, 0, 0.62)', // heavier than sheet (hard interrupt)
    },
    light: {
      canvas: '#FFFFFF',
      hairline: 'rgba(0, 0, 0, 0.06)',
      backdropTint: 'rgba(0, 0, 0, 0.45)',
    },
    shadow: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 12 },
      shadowOpacity: 0.32,
      shadowRadius: 28,
      elevation: 24,
    },
    motion: {
      entryMs: 180,         // fade + scale-in, paired with SHEET_SPRING for scale
      exitMs: 140,          // fade + slight scale-down (snappier out)
      scaleFrom: 0.96,      // entry start scale
      scaleExitTo: 0.97,    // exit end scale
    },
    // Accessibility fallbacks — see DESIGN §6.
    a11y: {
      reduceMotion: {
        // No fade, no scale; dialog + scrim appear/disappear instantly.
        entryMs: 0,
        exitMs: 0,
        scaleFrom: 1,
        scaleExitTo: 1,
      },
      reduceTransparency: {
        // Flat tint floored UP (more opaque); never blur.
        darkBackdropTint: 'rgba(0, 0, 0, 0.78)',
        lightBackdropTint: 'rgba(0, 0, 0, 0.60)',
      },
    },
  } as const,
```

---

## 6. OPEN #5 — Reduced-motion + reduce-transparency accessibility fallbacks

Both are real iOS/Android settings the primitive must honor (premium-craft + Prime Directive 6 — accessibility is architecture). The detection mechanism is `AccessibilityInfo` (`isReduceMotionEnabled()` / `isReduceTransparencyEnabled()` + their change listeners) [RN docs: https://reactnative.dev/docs/accessibilityinfo]; the *values* to apply are pinned here so the implementor reads them, never invents them.

### 6.1 Reduced motion (`prefersReducedMotion`)

When OS reduce-motion is ON:

| Element | Normal | Reduced-motion fallback |
|---------|--------|--------------------------|
| Sheet open/snap/settle spring (§3) | `SHEET_SPRING` | `reduceMotion: ReduceMotion.System` already makes Reanimated **skip the spring and jump to target** automatically — no extra code. The sheet appears at its snap instantly. [Reanimated accessibility guide — `ReduceMotion.System` disables the animation when the OS setting is on] |
| Handle active brighten/widen/scale (§2) | 160 ms cubic crossfade | **Color still changes** (it's information, not decoration) but it changes *instantly* (transitionMs → 0); width + scale do NOT change at all (stay resting 36 / scale 1). |
| Center-dialog entry/exit (§5) | 180/140 ms fade + scale | Use the `a11y.reduceMotion` sub-keys: `entryMs/exitMs → 0`, `scaleFrom/scaleExitTo → 1`. Dialog + scrim appear/disappear instantly (a hard cut, which is the correct reduced-motion behavior for a modal interrupt). |
| Backdrop fade-in (`appearsOnIndex`) | spring/timed fade | Backdrop appears at target opacity instantly (gorhom's backdrop fade rides the same reduce-motion path; if any residual fade remains, set the backdrop `opacity` without animation when reduce-motion is on). |

The handle's `transitionMs` and the dialog's `a11y.reduceMotion` block are already in the tokens above so the implementor has literal values.

### 6.2 Reduce transparency (`prefersReducedTransparency`)

The sheets are **already opaque solids** (`#0c0e12` / `rgba(12,14,18,1)` / `#FFFFFF`) — there is NO live translucency in the sheet canvas to flatten, so the canvas needs no change. The only translucent surface is the **backdrop scrim**, which is intentional dimming, not a glass effect. When reduce-transparency is ON we make the scrim **more opaque** (so the dimming is unmistakable for low-vision users) but keep it **flat** — never introduce blur, and never reduce opacity:

| Backdrop | Normal | Reduce-transparency floor |
|----------|--------|----------------------------|
| Sheet — dark | per-sheet (e.g. 0.55) | floor UP to `rgba(0,0,0,0.62)` if below |
| Sheet — light | `0.32` | floor UP to `rgba(0,0,0,0.45)` |
| Center-dialog — dark | `0.62` | `rgba(0,0,0,0.78)` (in `centerDialog.a11y.reduceTransparency.darkBackdropTint`) |
| Center-dialog — light | `0.45` | `rgba(0,0,0,0.60)` (in `centerDialog.a11y.reduceTransparency.lightBackdropTint`) |

For the SHEET (not dialog) reduce-transparency floors, add this small `a11y` sub-key to BOTH existing token blocks (NEW key, additive — does not mutate existing keys):

```ts
// inside glass.bottomSheet — add after handleActive:
    // META-ORCH-0991 (DESIGN) — Reduce-transparency floor for the dark scrim.
    // When OS reduce-transparency is on, floor backdrop opacity UP to this (flat, never blur).
    a11yBackdropTint: 'rgba(0, 0, 0, 0.62)',
```

```ts
// inside glass.notificationsSheet — add after handleActive:
    // META-ORCH-0991 (DESIGN) — Reduce-transparency floor for the light scrim.
    a11yBackdropTint: 'rgba(0, 0, 0, 0.45)',
```

> Implementor: read `isReduceTransparencyEnabled()`; if true, pass the `a11yBackdropTint` (when more opaque than the consumer's `backdropOpacity`) instead of the normal tint to the `BottomSheetBackdrop`. Subscribe to the change event so a mid-session toggle updates live.

### 6.3 Contrast (computed, not eyeballed)

The scrim is a dimming layer, not text — WCAG text-contrast does not apply to it. The relevant contrast is **content on the sheet canvas**, which is UNCHANGED by this DESIGN (locked canvases + locked per-sheet text colors). For completeness, the handle indicator against its canvas:

- **Dark active handle** `rgba(255,255,255,0.55)` over `#0c0e12`: composited handle ≈ `#8a8b8e`; against `#0c0e12` luminance ratio ≈ **5.1:1** — exceeds the 3:1 non-text-UI-component minimum (WCAG 1.4.11). Resting 0.30 ≈ 2.6:1 is below 3:1 but the handle is a *decorative drag affordance with a redundant gesture*, not an essential control — and the active state (when it matters, mid-grab) clears 3:1. Acceptable; the active brighten is partly *why* we add it.
- **Light active handle** `rgba(0,0,0,0.34)` over `#FFFFFF`: composited ≈ `#a8a8a8`; ratio ≈ **3.1:1** — meets 3:1.
- **Center-dialog** uses locked canvases (`rgba(12,14,18,1)` / `#FFFFFF`) — body/button text contrast is the consumer's responsibility per its existing typography tokens, all of which already clear 4.5:1 on these canvases in the shipped app.

---

## 7. Anti-slop + craft compliance (premium-craft §2)

- ❌ No new gradients. ❌ No decorative blur (§4 explicitly chose flat). ❌ No emoji handles. ❌ No glow / drop-shadow halo on the handle. ❌ No brand-orange on the handle (the active state stays in the neutral white/black family — orange is reserved for status/CTA, not chrome). ✅ Every value is a token on the 4px grid or a documented motion constant. ✅ Active handle widen 36→44 is an 8px (2-unit) grid step. ✅ Dialog radius 28 reuses the sheet family radius. ✅ Shadow language extends the existing sheet shadow, not a new invented effect.
- All values are hex/rgba — **no `oklch(`/`color-mix(`/`lab(`** (RN-incompatible, §6.5 craft rule + `I-ARI-NO-OKLCH`).

---

## 8. States coverage (designer /goal clause 2)

This DESIGN governs a **primitive's chrome + motion**, not a screen, so the 9 screen-states map as:

| State | Covered |
|-------|---------|
| closed | Handle resting; backdrop absent; no active state. |
| opening | Spring §3 carries to snap; handle resting; backdrop fades to tint. |
| open at snap | Handle resting; backdrop at full tint. |
| dragging-to-dismiss | **Handle ACTIVE (§2)**; spring §3 governs the release-settle. |
| backdrop-press | Sheet: dismiss via spring. Dialog: no-op by default (§5.3). |
| explicit close | Spring §3 settle to closed; dialog exit motion §5.3. |
| reduced-motion | §6.1 — springs jump, handle color-only, dialog hard-cut. |
| reduce-transparency | §6.2 — scrim floored more-opaque, flat. |
| degraded (low-end Android) | Spring `overshootClamping` + short rest thresholds keep it cheap; flat tint (no blur) is the cheap path; `elevation` provided on shadow for Android. |

Loading / error / empty / first-time / returning are **content states owned by each consuming sheet**, not the primitive chrome — N/A here (named with reason per /goal clause 2).

---

## 9. Handoff to IMPLEMENT

### 9.1 What the implementor pastes into `app-mobile/src/constants/designSystem.ts`

1. `glass.bottomSheet.handleActive` (§2.5) — NEW sibling key inside `glass.bottomSheet`, after `handle`.
2. `glass.bottomSheet.a11yBackdropTint` (§6.2) — NEW key inside `glass.bottomSheet`.
3. `glass.notificationsSheet.handleActive` (§2.5) — NEW sibling key inside `glass.notificationsSheet`, after `handle`.
4. `glass.notificationsSheet.a11yBackdropTint` (§6.2) — NEW key inside `glass.notificationsSheet`.
5. `glass.centerDialog` (§5.4) — NEW top-level `glass.*` block after `notificationsSheet`.

**None mutate an existing key.** All are additive. Match the existing ORCH-comment style (shown in each snippet).

### 9.2 What lives in `BaseBottomSheet.tsx` (NOT a token)

- `SHEET_SPRING` const via `useBottomSheetSpringConfigs` (§3.4) — passed to `<BottomSheet animationConfigs={SHEET_SPRING}>`.
- Handle active-state wiring from gorhom `animatedIndex` → `useAnimatedStyle` reading `handleActive` (§2.4).
- `AccessibilityInfo.isReduceMotionEnabled()` / `isReduceTransparencyEnabled()` + change listeners → select the a11y values (§6).

### 9.3 ⚠️ CARRY-FORWARD — strict-grep invariant gate (verbatim, per orchestrator REVIEW 2026-05-29)

> The Wave A strict-grep invariant gate (`I-PROPOSED-BASE-BOTTOM-SHEET-SOLE-GORHOM-CONSUMER`) MUST match `import ... from '@gorhom/bottom-sheet'` import statements, NOT bare string mentions — `MessageInterface.tsx:2259` and `designSystem.ts:272` contain the string `@gorhom/bottom-sheet` only inside comments and must NOT trip the gate; the test file `components/__tests__/NotificationsSheet.test.tsx` must also be exempt. Verified by orchestrator REVIEW 2026-05-29.

**Note for the implementor:** my new `designSystem.ts` comments (§2.5, §5.4, §6.2) all reference "META-ORCH-0991" / "gorhom" in prose; **none of them contain the literal token `@gorhom/bottom-sheet`**, so they add zero new risk to the gate's import-vs-comment discrimination. The pre-existing `designSystem.ts:272` comment string is the only one in that file and is already covered by the carry-forward exemption above.

### 9.4 What is OUT of scope for IMPLEMENT from this DESIGN

No `.tsx` motion code is prescribed beyond the mechanism notes; the implementor owns the actual `useAnimatedStyle`/listener wiring. The snapPoints, dismiss thresholds, locked token sets, top-radius 28, handle 36×4, and the inline-vanilla + `wrapInRNModal` architecture are untouched by this DESIGN.

---

## 10. Completion (designer /goal predicate)

1. ✅ **References examined** line present (§0) — iOS sheet/grabber, Linear, Things 3, Airbnb/Stripe/Linear confirm dialogs.
2. ✅ All applicable states designed (§8); inapplicable content-states named with reason.
3. ✅ Every size/radius value is a token / 4px-grid step (44 = 36+8; radius 28 family; margins/padding = `spacing.lg` 24); motion values are documented constants, not magic numbers.
4. ✅ Contrast computed numerically (§6.3): dark active handle ≈ 5.1:1, light active handle ≈ 3.1:1 (both ≥ 3:1 UI-component min); scrim is dimming (not text), canvases/text unchanged + already-compliant.
5. ✅ N/A interactive elements added (chrome only); the handle keeps its locked ≥44pt drag target via the sheet's gesture area; active state adds feedback. No new tappable controls introduced by this DESIGN.
6. ✅ Zero anti-slop violations (§7).
7. ✅ Reduced-motion fallback specified for every animation (§6.1); reduce-transparency specified (§6.2); copy is N/A (no new copy — chrome/motion only).

All five 🎨 OPEN items resolved to exact values; both token additions specified verbatim; carry-forward implementor note included. **COMPLETE.**
```

