# DESIGN SPEC — ORCH-1057 · Ari composer + header icons + empty-state polish

**Surface:** Mingla **Business** app · Ari assistant (React Native / Expo · iOS + Android + web)
**Mode:** COMPONENT (×2) + SCREEN (empty state)
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1057-[ari-composer-icons-polish]/` · branch `ORCH-1057-ari-composer-icons-polish`
**Files in scope:**
- `mingla-business/src/components/ari/InputBar.tsx` — send button (Item A)
- `mingla-business/src/screens/ari/AriChatScreen.tsx` — header icons (Item B), empty-state mount + suggestions panel (Item C reference)
- `mingla-business/src/components/ari/EmptyState.tsx` — first-run screen (Item C)
- `mingla-business/src/constants/designSystem.ts` — token source (read-only reference)

**Design-only spec.** No product code here. Every value below maps to a token in `designSystem.ts` or a fixed pixel value justified inline. The implementor builds from this without guessing.

**Icon library (verified, do not re-investigate):** `lucide-react-native ^0.577.0` is installed. Use it for ALL icon work. Do NOT add `lucide-react` (that is the web package and is NOT a dependency). No new dependencies are introduced by this spec.

---

## References examined

Premium composers + assistant chrome studied for this moment (send affordance, icon-button chrome, sparse first-run):
- **Linear** — the in-app AI / command composer: monochrome lucide-grade glyphs, a single accent-filled send affordance, disabled state = reduced-opacity same shape (no shape swap). Bar = one rounded container, icon buttons are flat 28–32pt hit-expanded to ≥44.
- **Arc / Arc Search** — assistant send button as a small solid accent circle with an up-arrow glyph; press = quick scale-down + subtle glow, never a shape change.
- **Things 3** — header icon buttons: thin-stroke monochrome glyphs at one consistent stroke weight on a flat chrome bar; tap targets generous, glyphs optically centered.
- **Partiful / Timeleft** — warm, personality-forward empty states: a single hero mark + one line of headline + one line of body, NO chip wall. First-run guidance is a single quiet hint, never a grid of buttons. This is the bar for Item C.
- **iMessage / WhatsApp composer** — the up-arrow / send glyph living inside a brand-colored circle is the universally-legible "send" mental model; the arrow points UP for a vertical-scroll chat. Confirms `ArrowUp` over `Send` (paper-plane) for a chat that scrolls vertically.
- **ChatGPT / Claude mobile composers** — `ArrowUp` in a filled circle is now the category-standard send glyph; disabled = same circle dimmed, enabled = full-strength fill. Confirms the recommended direction below.

Synthesis: the category has converged on **up-arrow-in-a-circle** for vertical chat send, monochrome single-stroke lucide glyphs for header chrome, and a calm single-hint first run. Mingla's differentiator is the **warm Ari ember light** — so the send button earns uniqueness through a warm radial fill + a press-moment ember flicker that echoes the orb, not through a novelty shape.

---

## 0. Design context — the moment

The user is on the Ari chat screen in the Business app. The canvas is dark (`canvas.discover` `#0c0e12`). Ari's identity is the warm peach→coral→ember orb (`ariPalette.gold/flame/ember`). The composer sits at the bottom in a glass-tinted rounded bar. Three jobs this turn:

- **A — Send button** feels generic (a CSS-border triangle on a flat coral circle). Make it premium + unmistakably Ari.
- **B — Header icons** are Unicode glyphs (`≡`, `⚙`) rendered as text — an instant amateur tell and a cross-platform render risk. Swap to lucide.
- **C — Empty state** carries an always-on 3-chip wall that duplicates the `+` suggestions entry point. Remove it; protect first-run guidance.

---

## ITEM A — Send button redesign

### Current state (what we're replacing)
`InputBar.tsx` lines 79–92 + styles 119–173: a `36×36` circle (`borderRadius 18`) filled flat with `ariPalette.flame`, containing a `sendArrow` built from CSS border tricks (`borderBottomColor:'#ffffff'` triangle). iOS-only flame shadow. Disabled = `opacity 0.4`; pressed = `opacity 0.8`. The triangle is geometrically a "play" mark, not a send mark, and reads generic.

### Contrast note (load-bearing — drives the icon choice)
`ariPalette.flame` = `hsl(20,72%,64%)` ≈ `#e69869`, relative luminance ≈ **0.355**.
- Pure white `#ffffff` glyph on `#e69869`: ratio ≈ **2.55:1** — **FAILS** the 3:1 non-text-graphic minimum (WCAG 1.4.11). The current white triangle is technically under-contrast against the flame fill.
- **Fix applied in all three directions below:** the glyph sits on a **deepened warm fill** (a flame→ember radial or the solid `ariPalette.ember` `hsl(10,55%,50%)` ≈ `#c66c54`, luminance ≈ 0.21) so a white glyph clears **≥3:1**: white on `#c66c54` ≈ **3.5:1 PASS**. Where a direction keeps the lighter flame top stop, the glyph is white at full strength AND the fill's *bottom* stop is ember, so the glyph's lower half always sits on ≥3:1; we additionally specify a `strokeWidth` heavy enough to read. Every direction's enabled-state contrast ratio is written in its spec block.

---

### Direction A1 — "Ember Send" (RECOMMENDED)

Up-arrow lucide glyph inside a warm **flame→ember vertical radial** circle that visually rhymes with the Ari orb. Premium through material + a send-moment ember flicker, not through a novelty shape. This is the category-correct mark (ArrowUp in a circle) elevated with Ari's signature warm light.

```
        ╭───────╮
       │    ▲    │      ← lucide ArrowUp, white, strokeWidth 2.5
       │    │    │
        ╰───────╯
   38pt circle, warm radial (gold-tinted top → ember bottom),
   soft ember glow ring (iOS), opaque on Android
```

**Anatomy + exact specs**
- **Container:** `Pressable`, `38 × 38`, `borderRadius 19` (full circle). Bumped from 36→38 so the glyph + ring read crisp; still inside the `minHeight 52` bar with `alignItems:'flex-end'`.
- **Tap target:** wrap retains `hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}` to reach **≥44pt** effective. (Current code has no hitSlop on the send button — ADD it.)
- **Fill (enabled):** a **2-stop vertical radial** echoing the orb, implemented with `react-native-svg` `<RadialGradient>` (already a dependency, used by `AriOrb`):
  - center offset toward top (`cx 50, cy 36` in a `0 0 100 100` viewBox, matching the orb's "lit from above" language)
  - stop 0% `ariPalette.flame` (`#e69869`)
  - stop 100% `ariPalette.ember` (`#c66c54`)
  - Rationale: the glyph's lower half sits on ember (≥3:1); the top warm stop ties it to the orb. **If the implementor prefers to avoid an SVG fill in the button, the approved flat fallback is solid `ariPalette.ember`** (`#c66c54`) — white glyph ratio **3.5:1 PASS**, and it still differs from the old flat-flame look.
- **Glyph:** `import { ArrowUp } from "lucide-react-native"`. `<ArrowUp size={20} color="#ffffff" strokeWidth={2.5} />`. Optically centered (lucide ArrowUp is already centered on its 24-grid; no manual offset). Heavier `strokeWidth 2.5` (vs lucide default 2) so the mark reads bold and premium at 20pt.
- **Glow (enabled, iOS only):** `shadowColor: ariPalette.ember`, `shadowOffset {0,2}`, `shadowOpacity 0.4`, `shadowRadius 7`. This is a *purposeful* depth/brand glow (echoes orb halo), not decoration — it earns its place. **Android:** NO shadow (Android elevation draws a hard rectangle through rounded fills — see `designSystem.ts` `androidSafeElevation`). Honor `ANDROID_GLASS_USES_OPAQUE_FALLBACK`: Android fill is fully opaque (the SVG radial / solid ember is opaque by construction; no translucent fill), and the circle uses `overflow:'hidden'` to clip the SVG to the round shape.
- **Enabled contrast:** white glyph on ember region = **3.5:1 PASS** (graphic ≥3:1). Circle vs `glass.tint.profileBase` bar = ember `#c66c54` (lum 0.21) vs bar≈`#0e1014` (lum ~0.006) → **~4.3:1**, button clearly separates from the bar.

**Send-moment micro-interaction (the signature)**
On a successful send (`handleSend` fires with non-empty text):
1. **Press-down:** scale `1 → 0.92` over `durations.instant` (80ms), `easings.press`. No layout shift (transform only).
2. **Release / send:** **ember flicker + lift** — scale springs `0.92 → 1.06 → 1.0` (Reanimated `withSpring`, damping 14, stiffness 220, mass 0.7 — same family as `AriOrb` entrance) while the glow `shadowOpacity` pulses `0.4 → 0.7 → 0.4` over `durations.normal` (200ms). Reads as the orb's warm light "breathing out" the message. iOS gets the glow pulse; Android gets the scale spring only (no shadow).
3. **Haptic:** `Haptics.impactAsync(Light)` on send (if `expo-haptics` is already imported in the app; if not, omit — do not add a dependency).
4. **`prefers-reduced-motion`:** skip the scale spring + flicker entirely; the button simply dims-to-pressed and restores (opacity 0.92 → 1 over 80ms). Use `useReducedMotion()` (already used by `AriOrb`).

**Disabled state (`canSend === false`)**
- Fill: same radial/ember but at `opacity 0.4` (keep the existing `btnDisabled` token approach).
- Glyph: white at the fill's reduced opacity (inherits).
- No glow, no press feedback, no micro-interaction. `accessibilityState={{ disabled: true }}` (already present — keep).
- This is the most-common state on first load (empty input) so it must look intentionally quiet, not broken: 0.4 opacity on a warm fill still reads as "a button, waiting."

**Why recommended:** it is the category-correct, instantly-legible send mark (ArrowUp-in-circle, validated across ChatGPT/Claude/Arc/iMessage), it fixes the real 3:1 contrast failure, AND it earns uniqueness the *Mingla* way — the warm radial + ember-flicker micro-interaction make the send feel like Ari's light responding, not a generic FAB. It reuses `react-native-svg` and `useReducedMotion` already in the Ari module, so build cost is low and it stays consistent with `AriOrb`.

---

### Direction A2 — "Glass Capsule Send"

A wider rounded **capsule** (pill) instead of a circle, lucide `SendHorizontal` glyph, frosted-glass body with a warm border. More "tool/composer" than "FAB."

```
   ╭──────────────╮
  │   ➤  Send       │   ← optional label; or glyph-only ╭────╮│➤ │╰────╯
   ╰──────────────╯
   glass fill + ariPalette.flame border, SendHorizontal glyph
```

**Anatomy + exact specs**
- **Container:** glyph-only capsule `44 × 32`, `borderRadius radius.full` (999). (Hits 44pt width target natively.)
- **Fill:** `glass.tint.profileElevated` (`rgba(255,255,255,0.06)`) on iOS. **Android opaque fallback:** `Platform.select` → Android fill `#1b1d22` (≥0.92-equivalent opaque dark, derived from canvas + 6% white), `overflow:'hidden'`, NO elevation. Honors `ANDROID_GLASS_USES_OPAQUE_FALLBACK`.
- **Border (enabled):** `1pt`, `ariPalette.proposalBorder` (`hsla(20,72%,64%,0.45)`) — the warm border IS the accent here, not a fill.
- **Glyph:** `<SendHorizontal size={18} color={ariPalette.flame} strokeWidth={2.25} />`. Flame glyph on dark glass = `#e69869` (lum 0.355) on `#1b1d22` (lum ~0.012) → **~7.4:1 PASS**.
- **Glow:** none (glass + warm border carries it). Keeps the bar calm.
- **Disabled:** border drops to `glass.border.profileBase`, glyph to `textTokens.tertiary`, `opacity 0.5`.
- **Micro-interaction:** glyph slides right `0 → 3pt → 0` (`translateX`, 180ms `easings.out`) + border flares to `ariPalette.proposalShadow`-lit for 200ms on send. Reduced-motion: opacity dim/restore only.

**Trade-off:** elegant + restful, reads "composer tool." But a horizontal send glyph is slightly less universal for a vertical-scroll chat than ArrowUp, and the glass capsule is quieter — less of a confident "primary action" anchor than A1. Better if Seth wants the bar to feel like one continuous glass tool.

---

### Direction A3 — "Live Ember Mark" (elevate the custom mark)

Keep a **custom** (non-lucide) mark but make it intentional: a small **filled chevron-up "spark"** rendered in SVG with the orb's exact radial, sitting on a near-black circle so the warm mark glows. This is the "elevate the custom mark" option.

```
        ╭───────╮
       │    ◆    │   ← warm-radial chevron/spark on near-black circle
        ╰───────╯
   the GLYPH is warm, the circle is dark → inverts A1
```

**Anatomy + exact specs**
- **Container:** `38 × 38`, `borderRadius 19`. Fill `canvas.depth` (`#08090c`) — near-black. `1pt` border `ariPalette.proposalBorder`.
- **Glyph:** a custom SVG up-chevron/4-point spark (`react-native-svg <Path>`), filled with the SAME orb `RadialGradient` (gold→flame→ember). Glyph footprint ~18×18 centered.
- **Contrast:** warm gradient glyph (lightest stop `#f7d09a` lum 0.66, darkest `#c66c54` lum 0.21) on `#08090c` (lum 0.004) → midtone `#e69869` gives **~7:1 PASS**; the mark glows against black.
- **Glow (iOS):** `shadowColor ariPalette.flame`, opacity 0.5, radius 8 — the warm glyph + ring reads "lit from within," matching the orb. Android: opaque dark fill, no shadow.
- **Disabled:** glyph gradient → flat `textTokens.tertiary`, border → `glass.border.profileBase`, `opacity 0.4`.
- **Micro-interaction:** the gradient glyph does a 1-cycle "flicker brighten" (glyph opacity `1 → 0.7 → 1` + scale `1 → 1.08 → 1`, 220ms) on send — literally the orb's pulse, miniaturized. Reduced-motion: static.

**Trade-off:** most uniquely-Mingla and most premium-feeling (the send mark IS a tiny Ari orb), but it's a custom glyph (more build + maintenance than dropping in lucide `ArrowUp`), and a non-standard send mark carries a small learnability cost vs the universal up-arrow. Choose if Seth wants maximum brand signature over convention.

---

### RECOMMENDATION (Item A): **A1 "Ember Send."**
It satisfies the "feel more unique + premium" goal through material and motion (warm radial + ember flicker echoing the orb) while staying on the universally-legible ArrowUp-in-circle mark, fixes the genuine 3:1 contrast failure of the current white-on-flame triangle, uses only already-installed deps (`lucide-react-native` + `react-native-svg` + `useReducedMotion`), and honors the Android opaque-glass policy. A3 is the fallback if Seth wants more brand signature and accepts the custom-glyph build cost.

---

## ITEM B — Header icons: Unicode → lucide

### Current state
`AriChatScreen.tsx` line 139 conversations button = `<Text style={styles.iconText}>≡</Text>`; line 151 settings = `<Text style={styles.iconText}>⚙</Text>`. `styles.iconText` = `fontSize 22, color textTokens.primary`. Buttons are `44×44` (`styles.iconBtn`). Unicode glyphs render inconsistently across iOS/Android/web fonts and are an anti-slop tell.

### Spec

**Conversations / "more" button (left, line 133–140):**
- Component: **`Menu`** from `lucide-react-native`. (Rationale: this button opens `ConversationDrawer` — a left-side list overlay. `Menu` is the universal "open the list/drawer" affordance and matches the `≡` it replaces 1:1. `PanelLeft` was the runner-up but reads as an IDE/sidebar metaphor; `History`/`MessageSquare` over-specify "conversations" when the drawer is really the nav menu.)
- Render: `<Menu size={24} color={textTokens.primary} strokeWidth={2} />`
- `color`: `textTokens.primary` = `rgba(255,255,255,0.96)` — matches the current `iconText` color exactly.
- `strokeWidth`: `2` (lucide default; consistent stroke across both header icons + the send glyph family).
- Tap target: keep `styles.iconBtn` `44 × 44` — **preserved**.
- `accessibilityRole="button"` + `accessibilityLabel="Show conversations"` — **unchanged** (keep the Pressable + its a11y props; only swap the `<Text>≡</Text>` child for `<Menu .../>`).

**Settings button (right, line 145–152):**
- Component: **`Settings`** from `lucide-react-native`. (Rationale: the literal gear, 1:1 replacement for `⚙`, universally understood. `Settings2`/`SlidersHorizontal` imply "filters/sliders," which mis-describes the Ari settings route `/ari/settings`.)
- Render: `<Settings size={22} color={textTokens.primary} strokeWidth={2} />`
- `size`: `22` (the gear has more internal detail than the menu bars; 22 keeps optical weight equal to the 24pt Menu — optical alignment beats mathematical here).
- `color`: `textTokens.primary`. `strokeWidth`: `2`.
- Tap target: keep `44 × 44` — **preserved**.
- `accessibilityRole="button"` + `accessibilityLabel="Open Ari settings"` — **unchanged**.

**Contrast (both icons):** `textTokens.primary` `rgba(255,255,255,0.96)` ≈ `#f5f5f5` effective on `canvas.discover` `#0c0e12` (lum 0.006) → **~17.9:1 PASS** (graphic ≥3:1, far exceeds). Identical to the Unicode glyphs they replace — no contrast regression.

**Cleanup:** `styles.iconText` (lines 258–261) becomes unused after both swaps — remove it to avoid dead style (implementor's call; flagged here).

**Press feedback:** keep existing `pressed && styles.pressed` (`opacity 0.7`) — non-shifting, applies to the whole 44×44 Pressable. No change needed.

**Imports:** `import { Menu, Settings } from "lucide-react-native";` at the top of `AriChatScreen.tsx`.

---

## ITEM C — Empty state: remove the chip wall, protect first-run

### Current state
`EmptyState.tsx`: orb (lg) + headline "Hi, I'm Ari." + body + a `QuickReplyChips` stack of 3 hardcoded `EXAMPLES` (lines 21–25, 36–38). The SAME 3 strings also live in the `+`-triggered suggestions panel in `AriChatScreen.tsx` (lines 196–211). Seth's directive: the always-on chips go because the `+` button already handles examples.

### The UX flag (must be addressed, not ignored)
Removing the chips removes the only first-run guidance. A brand-new business user would land on: an orb, a headline, a body line, and a text field — with NO visible hint that examples exist behind the `+`. The `+` button is a small unlabeled control to the left of send; a first-timer will not reliably discover it. **Stranding the first-run user is a worse outcome than a little duplication.** So we remove the chip *wall* but keep ONE quiet, single-line affordance that points at the existing `+` entry point.

### Spec — new EmptyState

**Layout (unchanged skeleton, chips removed):**
- `orbWrap` → `AriOrb size="lg" thinking` (unchanged; the orb is the hero).
- `headline` → "Hi, I'm Ari." (unchanged, `typography.h2`, `textTokens.primary`, centered).
- `body` → unchanged copy: "I can create events, manage brands, and answer questions about your business." (`typography.body`, `textTokens.secondary`, `maxWidth 280`, centered).
- **REMOVE:** `chipsWrap` View + the `QuickReplyChips` import + the `EXAMPLES` const + the `onChipSelect` prop usage for chips.

**First-run guidance (the kept affordance) — RECOMMENDED:**
A single quiet **hint row** in place of the chip wall: a small inline `Plus` lucide glyph + one line of text, NOT a tappable button (it's a pointer, not an action — the real action is the `+` in the composer).

- Position: where `chipsWrap` was — `marginTop: spacing.xl` below the body, centered, `flexDirection:'row'`, `alignItems:'center'`, `gap: spacing.xs`.
- Glyph: `<Plus size={14} color={textTokens.tertiary} strokeWidth={2} />` (from `lucide-react-native`). Using the real `Plus` icon makes the hint visually match the composer's `+` button — closing the loop "the thing in this hint is the thing down there."
- Text: `<Text>` `typography.caption` (`fontSize 12, lineHeight 16, letterSpacing 0.2, fontWeight 500`), `color: textTokens.tertiary` (`rgba(255,255,255,0.52)`).
- **Copy (Mingla voice — friendly, light, not instructional-robotic):** **"Tap + for things to try"**. (Alternatives considered: "Need ideas? Tap +" / "Not sure where to start? Tap +" — the chosen line is the shortest, reads as a gentle nudge not a manual.)
- Contrast: `textTokens.tertiary` `rgba(255,255,255,0.52)` on `canvas.discover` → effective `#888` (lum ~0.25)... computed: 0.52-alpha white over `#0c0e12` ≈ `#7d7e80` (lum ~0.226) → **~5.0:1 PASS** for the caption text (≥4.5:1 body min); the 14pt glyph as graphic clears 3:1. The hint is deliberately low-emphasis (it must not compete with the orb/headline) but stays legible.
- NOT a `Pressable` — it carries no tap target and no `accessibilityRole="button"`. It's read by screen readers as static text. (If Seth later wants it tappable to open the suggestions panel, that's a follow-up; for now the single source of truth for opening suggestions stays the composer `+`, per the directive.)
- Reduced motion: static (no animation on the hint).

**Prop cleanup:** `EmptyState`'s `onChipSelect` prop becomes unused once chips are removed. Two options for the implementor (flagged, not decided here):
- (a) Drop the `onChipSelect` prop entirely and update the `<EmptyState onChipSelect={handleSend} />` call site in `AriChatScreen.tsx` line 169 to `<EmptyState />`. **Preferred** — cleanest, no dead prop.
- (b) Keep the prop for future use. Not recommended (dead interface).

**DO NOT TOUCH:** the `+`-triggered `suggestionsPanel` in `AriChatScreen.tsx` lines 196–211 (the `QuickReplyChips` with the 3 examples that appears when `suggestionsOpen`). That is the intended single entry point for examples and STAYS exactly as-is. `QuickReplyChips` the component is still used there — only `EmptyState`'s import of it is removed.

### Empty-state visual after change
```
            ◯            ← AriOrb lg, breathing (thinking)
       (warm halo)

       Hi, I'm Ari.       ← h2, white

   I can create events, manage
   brands, and answer questions    ← body, 72% white, maxWidth 280
      about your business.

        +  Tap + for things to try  ← caption, 52% white, lucide Plus 14pt
```
Calm, premium, single hero + one nudge — matches the Partiful/Timeleft sparse-first-run bar. No chip wall, no duplication, no stranded first-timer.

---

## All-9-states coverage

This ORCH touches three small surfaces; states mapped per surface:

| State | Send button (A) | Header icons (B) | Empty state (C) |
|---|---|---|---|
| **Loading** | n/a (button is static; chat-send in-flight = `disabled` via `chat.isSending`, covered by Disabled) | n/a (static chrome) | n/a (empty state IS the pre-content state; orb breathes) |
| **Error** | n/a (send errors surface in the screen-level `Toast`, not the button) | n/a | n/a (errors → Toast above the list) |
| **Empty** | Disabled state (no input text) — quiet 0.4-opacity warm fill | Always rendered | THIS surface (the spec above) |
| **Populated** | Enabled state — full radial + glow + micro-interaction on send | Always rendered | Replaced by `MessageList` once messages exist |
| **Submitting** | Disabled (`disabled={chat.isSending}` already wired at call site) — no double-send | Always rendered | n/a |
| **Offline** | Same as Submitting/Disabled while a send is in-flight; failure → Toast. Button itself unchanged | Always rendered | Orb + copy unchanged (no network needed to render) |
| **First-time** | Disabled (empty input) | Always rendered | THIS surface + the kept `+ Tap for things to try` hint = the deliberate first-run guidance |
| **Returning** | Enabled/Disabled per input | Always rendered | If a returning user has a fresh/empty conversation they see the same empty state; hint still helps |
| **Degraded** (no reduced-motion / low-end) | Reduced-motion path: no spring/flicker, opacity dim only | Static (no motion to degrade) | Orb already has reduced-motion fallback (`AriOrb`); hint is static |

---

## Pre-delivery craft checklist

- [x] **References examined** line present (Linear, Arc, Things, Partiful, Timeleft, iMessage, ChatGPT/Claude composers).
- [x] Zero anti-slop violations: no generic gradient (the warm radial is the brand orb material, purposeful depth, not a tech-blob); no stock/AI imagery; **emoji icons removed** (Unicode `≡`/`⚙` → lucide); glow/shadow each earns its place (echoes orb, iOS-only, Android opaque per policy).
- [x] Every spacing/size value is a token or an inline-justified pixel (`38pt` circle, `20pt`/`24pt`/`22pt`/`14pt` icon sizes are intentional optical sizes, justified inline; all gaps/margins use `spacing.*`; radii use `radius.full`/circle math).
- [x] Alignment: lucide glyphs optically centered on their 24-grid; Settings sized 22 (not 24) to optically match Menu's weight; send glyph centered in circle.
- [x] Hierarchy one-glance: send button is the brightest warm element in the bar; orb is the hero of the empty state; hint is deliberately low-emphasis.
- [x] All 9 states designed (table above) — inapplicable ones named with reason.
- [x] Contrast computed + written: send glyph ≥3:1 (3.5:1 on ember; the 2.55:1 flat-flame failure is explicitly fixed), header icons ~17.9:1, hint caption ~5.0:1, body unchanged. Dark mode is the only mode for this dark Ari surface (the Business app's Ari canvas is fixed dark `#0c0e12` — there is no light variant of this screen; noted so the "both modes" clause is satisfied by stating the surface is single-mode-dark by design).
- [x] Every interactive element ≥44pt + `accessibilityLabel` + non-shifting feedback: send button gains `hitSlop` to reach 44 and keeps `accessibilityLabel="Send message to Ari"`; header buttons stay 44×44 with unchanged labels; the hint is intentionally non-interactive (static text).
- [x] Motion has purpose + `prefers-reduced-motion` fallback: send micro-interaction echoes the orb's breath and has a reduced-motion opacity-only path via `useReducedMotion()`.
- [x] Copy in Mingla voice per state: "Tap + for things to try" (friendly nudge, not a manual); existing headline/body retained.
- [x] Would sit next to Linear / Arc / Partiful: yes — universal send mark + warm signature, monochrome lucide chrome, calm sparse first-run.

---

## Implementor handoff notes (build order, no guessing)

1. **Imports:** `lucide-react-native` → `ArrowUp` (InputBar), `Menu` + `Settings` (AriChatScreen header), `Plus` (EmptyState). `react-native-svg` `RadialGradient`/`Circle`/`Defs`/`Stop` already used by `AriOrb` — reuse the pattern for the A1 send fill (or use the approved solid `ariPalette.ember` fallback).
2. **Item A (InputBar.tsx):** replace `styles.sendArrow` View (line 91) + the `sendArrow` style (162–173) with the A1 button. Container 38×38 / radius 19, warm radial or solid `ariPalette.ember` fill, `<ArrowUp size={20} color="#ffffff" strokeWidth={2.5} />`, iOS-only ember glow, Android opaque + `overflow:'hidden'` + no elevation, `hitSlop` 6 all sides, send-moment spring + glow pulse gated behind `useReducedMotion()`. Disabled keeps `btnDisabled` 0.4 opacity. (The `+` suggest button at 62–78 is OUT of scope — leave it.)
3. **Item B (AriChatScreen.tsx):** swap line 139 `<Text>≡</Text>` → `<Menu size={24} color={textTokens.primary} strokeWidth={2} />`; line 151 `<Text>⚙</Text>` → `<Settings size={22} color={textTokens.primary} strokeWidth={2} />`. Remove now-dead `styles.iconText`. Keep both 44×44 Pressables + their a11y labels verbatim.
4. **Item C (EmptyState.tsx):** delete `EXAMPLES`, the `QuickReplyChips` import, the `chipsWrap` View; add the centered hint row (`Plus` 14pt + caption "Tap + for things to try"). Drop the `onChipSelect` prop and update the call site `AriChatScreen.tsx:169` to `<EmptyState />`. Do NOT touch the `suggestionsPanel` (196–211) or `QuickReplyChips` component itself.
5. **Cross-platform:** verify on iOS sim + Android emu + web. Specifically confirm: lucide glyphs render on web (lucide-react-native supports web via react-native-web), the Android send button has NO rectangular shadow artifact, and the send micro-interaction respects reduced-motion.

---

## /goal completion check (this spec)

1. References examined line — present. ✓
2. All 9 states — mapped per surface, inapplicable named. ✓
3. Every value a token / inline-justified pixel — yes. ✓
4. Contrast computed both-mode (single-mode-dark surface, stated) with numeric ratios — yes (3.5:1 send, 17.9:1 chrome, 5.0:1 hint). ✓
5. Every interactive element ≥44pt + label + non-shifting feedback — yes. ✓
6. Zero anti-slop violations — yes (emoji icons removed is a net anti-slop WIN). ✓
7. Copy in Mingla voice + reduced-motion fallback — yes. ✓

Spec is build-ready.
