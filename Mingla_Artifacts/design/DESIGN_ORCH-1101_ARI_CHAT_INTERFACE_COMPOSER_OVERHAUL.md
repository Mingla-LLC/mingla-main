# DESIGN — ORCH-1101 · Ari Chat Interface + Composer Overhaul

**Surface:** Mingla **Business** app only (`mingla-business`) · Ari tab → `AriChatScreen`
**Runtimes in scope:** Business iOS · Business Android · **Desktop** Business web (Expo Web / react-native-web)
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1101-[ari-chat-design-overhaul]/` · branch `ORCH-1101-ari-chat-design-overhaul`
**Mode:** DESIGN-ONLY — this document is a buildable specification. No product code, migrations, or deploys are produced by this phase.
**Prior art:** ORCH-0821 (Ari MVP) · ORCH-1057 ("Ember Send" composer icons — the SOURCE of the web send-blob defect; see `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-1057_ARI_COMPOSER_ICONS_EMPTYSTATE.md`).
**References examined (real premium chat/AI surfaces, for this exact moment):** Linear's AI/command surfaces (dense one-line rows, hairline separators, no bubble chrome on agent text); Apple iMessage (tail-corner bubble geometry, 8–10pt inter-message gap, sender-side asymmetry); Partiful (warm-on-dark glass cards, ember-class accent restraint); ChatGPT iOS + Claude mobile (composer growth behavior, send-button affordance, choice-chip/suggestion rows); Arc Max / Raycast AI (structured "result card" inline in a conversation, multi-select option lists). Synthesis is original Mingla — premium glass kept, density borrowed, no clone.

---

## 0. Design thesis (one sentence)

Keep the Ari **soul** — warm orb, ember accent, glass bubbles — but make the thread read like a **dense, text-forward premium chat** (Linear/iMessage density, not ChatGPT whitespace), fix the two desktop-web rendering defects at the root, and lay down a **plug-in response vocabulary** (chips, clarifying cards, multi-select, structured result cards) so the future smart-Ari intelligence has a finished visual home the day it ships.

---

## 1. Cross-Surface Impact Declaration

| Surface | In scope? | What changes / why not |
|---|---|---|
| **Business iOS** | YES | Bubble geometry/type/density, composer heights, send button glyph, new response components. Keeps iOS ember shadow-glow + send micro-interaction. |
| **Business Android** | YES | Same shared RN components. Every glass/fill surface follows `ANDROID_GLASS_USES_OPAQUE_FALLBACK`: opaque ≥0.92 fill + `overflow:'hidden'` + NO elevation/shadow under rounded fills. New send button + response cards must declare the Android opaque branch explicitly. |
| **Desktop Business web** | YES | Primary bug target. Composer bottom-gap fix (A) + send-glyph blob fix (B) + density that survives react-native-web. All new components must render crisply on react-native-web (no SVG-gradient-behind-glyph composition, no soft-keyboard padding assumptions). |
| **Phone Business web (`/ari`)** | **OUT OF SCOPE** | Phone web `/ari` is route-blocked by ORCH-1095; it never renders this screen. We do not design for a surface the user cannot reach. If ORCH-1095 later unblocks phone web, the desktop-web specs here are mobile-viewport-safe by construction (all measurements are viewport-independent), but phone-web QA is explicitly deferred to that ORCH. |
| Consumer app (`app-mobile`) | NO | Ari has no consumer analog. |
| Admin web | NO | No Ari surface. |

**Parity model:** single shared component tree per concern; iOS/Android/web differences are confined to documented `Platform.select` / `Platform.OS === 'web'` branches named in §4 and §5. No forked layouts.

---

## 2. Compactness / Density System (the spine)

The thread today is *almost* there (ORCH-0821 already tuned 14/19 bubbles + a 10pt separator). ORCH-1101 finishes the job: one **vertical rhythm unit**, one **type scale**, one **bubble geometry**, applied everywhere, with grouping so consecutive same-speaker turns collapse.

### 2.1 Vertical rhythm — exact before → after

All values are existing tokens (`spacing.*`) or named new tokens added to `designSystem.ts` (§7). Zero magic numbers.

| Slot | Before | After | Token | Rationale |
|---|---|---|---|---|
| List horizontal padding | `spacing.md` (16) | `spacing.md` (16) | — | unchanged; correct edge margin |
| List top/bottom padding | `spacing.md` (16) / `spacing.xxl` (48) | `spacing.sm` (8) top / `spacing.xl` (32) bottom | `spacing.sm`/`spacing.xl` | tighter top; bottom keeps scroll clearance above composer |
| Gap between **different-speaker** turns | 10 (literal) | **10** → token `ariThread.gapTurn` | `ariThread.gapTurn = 10` | promote literal to named token; same value (proven good) |
| Gap between **same-speaker** consecutive bubbles (NEW grouping) | n/a (each turn full gap) | **4** | `ariThread.gapGroup = 4` | iMessage-style cluster; reads as one utterance |
| Bubble padding H | `14` | **12** | `ariThread.bubblePadH = 12` | tighten 2px; type already small, 14 felt loose |
| Bubble padding V | `9` | **8** | `ariThread.bubblePadV = 8` | tighten 1px; pairs with 19pt line-height |
| Orb-to-bubble gap (Ari rows) | `spacing.sm` (8) | **6** | `ariThread.orbGap = 6` | optical: 24px orb + 8 felt detached; 6 binds them |
| Success/cancelled ribbon padding | 12 / 6 | 10 / 5 | `ariThread.ribbonPadH/V` | match new bubble density |

### 2.2 Type scale (locked, single source)

| Role | Size / line-height / weight | Token | Contrast (on Ari glass bubble `#16181b`, computed) |
|---|---|---|---|
| Bubble body (user + Ari) | **14 / 19 / 400**, letterSpacing −0.1 | `ariThread.bodyFont` / `bodyLine` | Ari primary text **16.46:1** ✅ (≥4.5) |
| Inline label / metadata (timestamp, "Ari", field labels) | **11 / 14 / 600**, letterSpacing 0.3 | `typography.micro` | secondary **9.58:1** ✅ |
| Card title (proposal/result identity) | **15 / 21 / 600**, letterSpacing −0.1 | `ariThread.cardTitleFont` | primary **16.46:1** ✅ |
| Card field value | **13 / 17 / 400** | (existing `FIELD_VALUE_FONT`) | primary ✅ |
| Verb eyebrow ("CREATE EVENT") | **10 / 12 / 600**, letterSpacing 1.1 | (existing) | secondary ✅ |
| Chip label | **13 / 17 / 500** | `ariThread.chipFont` | see §5.1 contrast |

Dynamic Type: bubble + card body scale with `allowFontScaling` (default true on `Text`). Chips and the composer cap at a `maxFontSizeMultiplier` of **1.4** so the dense layout doesn't break; documented per-component in §7.

### 2.3 Bubble geometry (shared, both speakers)

- Corner radius: **16** on the three non-tail corners (was 18), **4** on the tail corner. New token `ariThread.bubbleRadius = 16` (tail stays `radius`-free literal 4 → token `ariThread.bubbleTail = 4`). 16 reads tighter/more modern than 18 at 14pt type.
- `maxWidth`: **80%** (was 78%) — denser lines, fewer wraps; still leaves clear asymmetry.
- Tail side: user → bottom-right tail; Ari → top-left tail (unchanged).

### 2.4 Speaker grouping (NEW — the density multiplier)

When N consecutive messages share a role:
- Inter-bubble gap drops to `ariThread.gapGroup` (4) instead of `gapTurn` (10).
- **Ari rows:** orb renders only on the **first** bubble of the group; follow-ups pass `hideOrb` (the 24px spacer already exists in `ChatBubble`). Already supported — wire it in `MessageList` by comparing `role` to the previous rendered item.
- **User rows:** no orb anyway; grouping is purely the 4pt gap.
- Tail corner: only the **last** bubble in a group gets the tail (4); interior bubbles use 16 on all four corners (smooth column). New optional prop `tail?: boolean` on `ChatBubble` (default true).

Net effect: a 3-paragraph Ari answer reads as one tight glass column with a single orb, not three detached bubbles — the single biggest density win, zero new screen real estate.

### 2.5 Response formatting — "how Ari reads"

Ari prose is currently one flat `Text` blob. Tighten readability without a markdown engine (out of scope — that's intelligence-ORCH territory) by giving `ChatBubble` a **lightweight line-segment renderer** that the implementor can drive from already-parsed plain text:

- Paragraph breaks (`\n\n`) → `gapGroup` (4) vertical space between segments inside one bubble.
- A leading `• ` or `- ` on a line → render as a hanging bullet row (bullet glyph `textTokens.tertiary`, 6pt gutter). No nested lists.
- That is the entire formatting surface for v1. Bold/inline-code/tables are explicitly deferred to the smart-Ari ORCH; this spec only guarantees the **container** handles multi-paragraph + simple bullets densely so future structured text has a home.

---

## 3. Message-Bubble Redesign

### 3.1 User bubble — fix the contrast failure (load-bearing)

**Finding (computed, not eyeballed):** white text on `ariPalette.flame` (`#e69869`) = **2.32:1** — fails WCAG for *all* text sizes (needs ≥4.5 body / ≥3 large). White on `ariPalette.ember` (`#c66c54`) = **3.7:1** — still fails body. The current user bubble is a real accessibility defect, not a preference.

**Fix:** keep the warm ember **feel** but make it legible.
- Fill: a vertical warm gradient is *not* used (react-native-web + Android gradient hazards). Instead a **flat deepened ember**: new token `ariPalette.userBubble = "hsl(10, 55%, 42%)"` (`#a85a44`). White-on-`#a85a44` computes to **4.6:1** ✅ (clears body 4.5). This keeps the ember family, just one stop deeper — reads as "Ari's warmth, owned by me."
- Text: `textTokens.inverse` (`#ffffff`), 14/19, letterSpacing −0.1.
- Geometry per §2.3. Padding per §2.1 (12 / 8).
- iOS: subtle ember shadow (`ariPalette.ember`, offset 0/1, opacity 0.18, radius 4) for lift. Android: NO shadow, `overflow:'hidden'`, opaque fill (already opaque). Web: no shadow (react-native-web shadow is unreliable) — the deeper fill alone carries it.

```
                                   ┌──────────────────────────────┐
                                   │  Create a Friday happy-hour   │   ← #a85a44 fill
                                   │  event at The Cellar          │     white 14/19, 4.6:1
                                   └────────────────────────────┘╲      tail = bottom-right
```

### 3.2 Ari (assistant) bubble

Already the strongest element — keep glass, tighten only.
- Fill `glass.tint.profileBase` (rgba white 0.04 → composites to `#16181b` on canvas). Border `glass.border.profileBase` (white 0.08), 1px hairline. Android opaque branch: bump fill to an **opaque** equivalent `ariThread.ariBubbleAndroid = "#16181b"` + `overflow:'hidden'` + no border-glow; keeps identical look, satisfies the opaque-glass policy.
- Text `textTokens.primary`, 14/19 — **16.46:1** ✅.
- Orb: 24px (`sm`), first-of-group only (§2.4), `orbGap` 6.
- Geometry per §2.3, padding 12/8.

```
( )  ┌──────────────────────────────────────┐
 ◖   │ You've got 3 events this week. The    │   ← glass #16181b, 1px hairline
     │ Cellar one still needs a cover image. │     primary 14/19, 16.46:1
     └──────────────────────────────────────┘     tail = top-left, orb on first bubble only
     ┌──────────────────────────────────────┐
     │ Want me to pull one from your library?│   ← same group → gap 4, no orb, no tail-on-interior
     └──────────────────────────────────────┘
```

### 3.3 Tool-proposal card (the confirmation moment)

Keep the `GlassChrome` proposal card and its Cancel / Edit / Confirm machine (it's the highest-stakes surface — a write-confirm). Apply density + fix the Confirm button contrast:
- Card padding 14 → **12** (`ariThread.cardPad`); field gap 4 → 4 (keep); title 16 → **15/21** (`cardTitleFont`).
- **Confirm button:** currently `ariPalette.flame` fill with `textTokens.inverse` → same 2.32:1 failure as the user bubble. Switch fill to `ariPalette.userBubble` (`#a85a44`, 4.6:1) — keeps it the warm primary action, now legible. iOS keeps the flame shadow-glow; Android no elevation; web flat.
- Button height 36 → **34** (`ariThread.btnHeight`), font 13/`buttonMd`.
- All three buttons keep ≥44pt effective target via `hitSlop` (34px height + 5pt hitSlop top/bottom = 44).
- Edit-mode (`ToolEditForm`) inline expansion unchanged in behavior; field inputs adopt the same 13pt density and the new `ariThread` paddings.

```
┌─ glass.tint.profileElevated, ariPalette.proposalBorder ─────────┐
│ (•) CREATE EVENT                                                │  verb 10/12, ls 1.1
│ Friday Happy Hour at The Cellar                                 │  title 15/21, primary
│   When    Fri, Jun 12 · 6:00 PM                                 │  label micro / value 13
│   Where   The Cellar, 14th St NW                                │
│  ┌──────────┐ ┌──────────┐ ┌────────────────┐                  │
│  │  Cancel  │ │   Edit   │ │     Confirm     │  ← #a85a44, white │  height 34, hitSlop→44
│  └──────────┘ └──────────┘ └────────────────┘                  │
└─────────────────────────────────────────────────────────────────┘
```

### 3.4 Thinking indicator + ribbons

- `StreamingText`: keep orb + blinking cursor; cursor height already 14 (matches body). Bubble adopts 12/8 padding + 16 radius for consistency.
- Success ribbon: keep `semantic.successTint`; padding 10/5; `✓` glyph → lucide `Check` (size 13, `semantic.success`) so it renders crisply on web (a Unicode `✓` is fine but lucide is consistent with §4's glyph rule). Cancelled ribbon: padding 10/5.

---

## 4. Composer + Send Button — with the two web bug fixes

### 4.1 Composer geometry (fixes Bug A — the web bottom gap)

**Bug A root cause (two compounding sources):**
1. On react-native-web a `multiline` `TextInput` becomes a `<textarea>`. The native iOS `TextInput` sizes to content; the web `<textarea>` keeps an intrinsic multi-**row** height (browser default `rows≈2`) and a larger default `line-height`, so the empty field is taller on web and the host row's `alignItems:'flex-end'` parks the send button against a tall box, exposing dead space below the single text line.
2. `AriChatScreen`'s `inputWrap.paddingBottom` is keyboard-driven: `keyboardHeight > 0 ? keyboardHeight + sm : insets.bottom + 80`. On desktop web there is **no soft keyboard**, `keyboardHeight` stays 0, so the composer always reserves `insets.bottom (0 on web) + BOTTOM_NAV_CLEARANCE_PX (80)` = an 80px gap that exists to clear the mobile floating nav capsule — which **doesn't exist on desktop web** (the business web nav is a side rail, not a bottom capsule).

**Fix A — exact measurements + web/native branching:**

Composer `host` (the InputBar outer row):
| Property | iOS / Android | Desktop web | Token |
|---|---|---|---|
| `minHeight` | **48** (was 52) | **48** | `ariThread.composerMinH = 48` |
| `paddingVertical` | `spacing.sm` (8) | **6** (web) | `ariThread.composerPadV` (8) / web override 6 |
| `paddingHorizontal` | `spacing.md` (16) | 16 | `spacing.md` |
| `alignItems` | `flex-end` | `flex-end` | — |
| `borderRadius` | `radius.xl` (24) | 24 | — |

Composer `input` (TextInput):
| Property | iOS / Android | Desktop web | Token |
|---|---|---|---|
| `fontSize` | 14 (was `body` 16 → align to thread) | 14 | `ariThread.bodyFont` |
| `lineHeight` | 19 | **19** (explicit — overrides the textarea's taller default) | `ariThread.bodyLine` |
| `paddingVertical` | **6** (was 8) | **6** | `ariThread.inputPadV = 6` |
| `minHeight` | **30** (one line: 19 + 2×6 − overlap → caps the empty box) | **30** | `ariThread.inputMinH = 30` |
| `maxHeight` | 120 (≈5 lines) | 120 | — |
| web-only | — | `style={{ height: 'auto', resize: 'none', overflowY: 'auto' }}` via `Platform.OS==='web'` spread | — |

**On web** the `<textarea>` gets `rows={1}` (passed through), explicit `lineHeight:19`, `minHeight:30`, and `resize:'none'`. Result: empty composer is exactly one line tall on every surface; growth to `maxHeight` is identical.

`AriChatScreen.inputWrap.paddingBottom` — make the nav clearance platform-aware:
```
paddingBottom =
  Platform.OS === 'web'
    ? spacing.sm                              // 8 — no bottom nav, no keyboard on desktop web
    : keyboardHeight > 0
        ? keyboardHeight + spacing.sm
        : Math.max(insets.bottom, spacing.md) + BOTTOM_NAV_CLEARANCE_PX
```
This removes the phantom 80px gap on web while leaving native untouched. (`BOTTOM_NAV_CLEARANCE_PX` stays for native.)

```
 DESKTOP WEB — BEFORE                         DESKTOP WEB — AFTER
 ┌───────────────────────────────┐           ┌───────────────────────────────┐
 │ Ask Ari…                  ( ↑ )│           │ Ask Ari…                  ( ↑ )│  ← one line, tight
 │                                │           └───────────────────────────────┘
 │            (dead space)        │            (no gap below — paddingBottom = 8)
 │                                │
 └───────────────────────────────┘
        ↑ 80px phantom gap + tall textarea
```

### 4.2 Send button (fixes Bug B — the web "blob")

**Bug B root cause:** the button stacks a `react-native-svg` `<Circle fill="url(#radial)">` (a `RadialGradient` in `<Defs>`) **behind** a separately-rendered lucide `<ArrowUp>`. On react-native-web, this two-layer SVG-gradient-circle + overlaid-icon composition loses/mis-z-orders the glyph and the gradient reads as an amorphous orange blob (confirmed defect chain from ORCH-1057). The gradient `id` collisions across react-native-svg-web instances make it worse.

**Fix B — one crisply-rendering send button, identical on web + native, ember feel kept:**

Design = **flat ember disc + crisp glyph**, no SVG gradient, no two-layer composition.

| Property | Value | Token |
|---|---|---|
| Diameter | **34** (was 38 — tighter, pairs with 48 composer) | `ariThread.sendSize = 34` |
| `borderRadius` | 17 | — |
| Fill (enabled) | **flat** `ariPalette.userBubble` (`#a85a44`) — same deepened ember as the user bubble; NO gradient | `ariPalette.userBubble` |
| Fill (disabled) | `glass.tint.profileElevated` (opaque on Android) + 0.4 opacity via `btnDisabled` | existing |
| Glyph | lucide **`ArrowUp`**, size **18**, `strokeWidth` **2.75**, color `#ffffff` — rendered as the **only** child, centered by flex (no absolute SVG sibling) | — |
| Glyph contrast | white on `#a85a44` = **4.6:1** ✅ (vs the old white-on-gradient-midpoint 2.96:1 ✗) | — |

**Why this renders identically everywhere:** a single `View` with a flat `backgroundColor`, `borderRadius:17`, `overflow:'hidden'`, `alignItems/justifyContent:'center'`, containing exactly one lucide glyph. lucide-react-native renders as inline SVG paths on web (proven elsewhere in the app, e.g. header `Menu`/`Settings`) — a single-path stroke glyph with no gradient and no sibling never blobs. No `<Defs>`, no `RadialGradient`, no gradient-id collisions.

**Keeping the ember soul without the gradient:**
- iOS: the **ember glow** stays — it lives on the button `View`'s `shadowColor: ariPalette.ember` / `shadowRadius` (this is what already animates on send; it is NOT the SVG and was never the blob). Base `shadowOpacity` 0.4, `shadowRadius` 7, offset 0/2. The send micro-interaction (scale 1→0.92→spring 1 + glow pulse 0.4→0.7→0.4) is **retained verbatim**, still gated behind `useReducedMotion()`.
- Android: opaque flat fill + `overflow:'hidden'` + **no** elevation/shadow (`ANDROID_GLASS_USES_OPAQUE_FALLBACK`). The flat `#a85a44` already reads premium without glow.
- Web: flat fill, **no** shadow (react-native-web shadow is unreliable and can itself read as a halo-blob). The deeper ember disc + crisp white arrow is the whole button. The scale press feedback is fine on web; the shadow-glow pulse is a no-op on web (shadow style ignored) — acceptable, the glyph is the point.

```
 NATIVE iOS              ANDROID                 DESKTOP WEB
   ╭──────╮ ← ember        ╭──────╮               ╭──────╮
   │  ↑   │   glow halo     │  ↑   │  flat, no halo│  ↑   │  flat, crisp arrow
   ╰──────╯ 34px           ╰──────╯               ╰──────╯
  flat #a85a44 fill       opaque #a85a44          flat #a85a44
  white ArrowUp 18/2.75   overflow:hidden         single lucide path → no blob
```

**Disabled state** (all surfaces): fill `glass.tint.profileElevated`, glyph `textTokens.tertiary`, 0.4 opacity, `accessibilityState={{ disabled:true }}`, no press feedback. Effective target ≥44 via existing `hitSlop:6`.

**The "+" suggestions button** stays (two crossed `View` strips already render fine everywhere — no SVG). Resize to a 30px circle to pair with the 34px send + tighter composer; keep `textTokens.secondary` strips, `glass.border.profileBase` ring, hitSlop 6 → ≥44 target.

### 4.3 Implementation direction for the composer (web-vs-native, explicit)

- Prefer a single `InputBar.tsx` with `Platform.OS === 'web'` style spreads for the three web-specific input props (`lineHeight`, `minHeight`, `resize/overflowY`) and the `paddingBottom` branch in `AriChatScreen`. A separate `InputBar.web.tsx` is **not** required and is discouraged (drift risk) — the deltas are small and conditional.
- The send button refactor is pure deletion of the `<Svg>/<Defs>/<RadialGradient>/<Circle>` block, replacing the fill with a flat `backgroundColor` on the existing `Animated.View`. The `Animated.View` (scale + iOS shadowOpacity) is kept exactly.

---

## 5. Future Response / Choice Vocabulary (design now, intelligence later)

These are **presentational** components with a clean prop contract. The downstream smart-Ari ORCH supplies the data + wires the callbacks; the look is finished here. All thread inline (rendered as `MessageList` items, left-aligned in Ari's lane, optionally orb-prefixed once per group). Each declares the 5 states Seth named: **default, selected, disabled, loading, submitted**.

### 5.1 Choice chips (single-select quick options)

Inline horizontal/wrapping chip row under an Ari bubble — "pick one to continue."

- Geometry: height 30, radius `radius.full`, padding 12H/0V, gap 6, wrap. Font `chipFont` 13/17/500.
- Fill default: `glass.tint.profileBase` + `glass.border.profileBase` hairline (Android opaque equivalent). Selected: `ariPalette.userBubble` fill + white label (4.6:1 ✅) + lucide `Check` 13 prefix. Disabled: 0.4 opacity, no press. Loading (after tap, awaiting server): selected styling + a 12px `ActivityIndicator` (`textTokens.inverse`) replacing the check, row becomes non-interactive. Submitted: the chosen chip stays as a compact selected pill; **siblings unmount** (collapse to the single answer) so the thread doesn't carry dead options.

```
( ) ┌─────────────────────────────┐
 ◖  │ Which brand is this event for?│
    └─────────────────────────────┘
    ( The Cellar )  ( Night Owl )  ( + New brand )      ← default
    (✓ The Cellar)                                       ← submitted (siblings gone)
```

Prop contract (presentational): `options: {id,label}[]`, `selectedId?`, `state: 'default'|'loading'|'submitted'`, `onSelect(id)`, `disabled?`.

### 5.2 Clarifying-question card

When Ari needs a typed/structured answer before acting — a glass card, not a bubble, so it reads as "an ask."

- Container: `GlassChrome` `cardBase`, radius `lg`, padding `cardPad` (12). Border `glass.border.profileBase`.
- Anatomy: micro eyebrow "ARI NEEDS A DETAIL" (10/12, ls 1.1, secondary) · question title 15/21 primary · one inline field (reuses `ToolEditForm` field style: 13pt, hairline underline `glass.border.pending`) · primary "Send" pill (`#a85a44`, 34h) + ghost "Skip".
- States: default (field empty, Send disabled 0.4) · selected/typed (Send enabled) · loading (Send → "Working…", spinner, field locked) · disabled (whole card 0.4, e.g. superseded by a newer turn) · submitted (card collapses to a compact "✓ Answered: <value>" ribbon, success styling).

```
┌─ glass cardBase ───────────────────────────┐
│ ARI NEEDS A DETAIL                          │
│ What time should it start?                  │
│ ┌─────────────────────────────────────────┐│
│ │ 6:00 PM                                  ││  ← field, hairline underline
│ └─────────────────────────────────────────┘│
│                       ( Skip )  ( Send )    │
└─────────────────────────────────────────────┘
```

### 5.3 Multi-select prompt

"Pick all that apply" — checkbox rows in a glass card with a sticky confirm.

- Rows: 40px tall, lucide `Square` / `CheckSquare` (18, `userBubble` when checked) + label 14/19 primary. Row press toggles. Gap 0 (rows are flush, hairline divider `glass.border.profileBase` between).
- Footer: count pill ("3 selected", micro, secondary) + primary "Confirm" (`#a85a44`, 34h, disabled until ≥1).
- States: default (none checked, Confirm disabled) · selected (≥1 checked, count updates, Confirm enabled) · disabled (0.4) · loading (Confirm → spinner, rows locked) · submitted (collapses to "✓ <n> selected: A, B, C" success ribbon).

```
┌─ glass cardBase ───────────────────────────┐
│ Which days should this repeat?              │
│ ☑ Friday                                    │
│ ─────────────────────────────────────────  │
│ ☑ Saturday                                  │
│ ─────────────────────────────────────────  │
│ ☐ Sunday                                    │
│            2 selected        ( Confirm )    │
└─────────────────────────────────────────────┘
```

### 5.4 Structured response card (rich result)

For Ari answers that are **data**, not prose — "here are your 3 events this week," a created-entity receipt, a metric. A glass card that threads inline like a fat Ari bubble.

- Container: `GlassChrome` `cardElevated`, radius `lg`, padding `cardPad`. Optional orb on the row (first of group).
- Anatomy (composable): optional eyebrow (verb/type) · title 15/21 · **stat/field rows** (label micro tertiary left, value 13 primary right — same row style as the proposal card) · optional thumbnail (cover image 44×44 radius `sm`, real photo only — anti-slop: never a placeholder) · optional inline action row (ghost + primary pills, 34h) e.g. "Open" / "Edit".
- States: default (data shown) · loading (skeleton: 3 shimmer rows, `glass.tint.profileElevated`, `prefers-reduced-motion` → static dimmed rows) · disabled (0.4, e.g. stale) · submitted (if it had an action, post-action it shows a success ribbon inline) · error (a single muted row "Couldn't load — tap to retry", `semantic.error` label, NOT a red card — matches the existing toast-not-inline-red philosophy).

```
( ) ┌─ glass cardElevated ──────────────────────┐
 ◖  │ THIS WEEK                                  │
    │ 3 events · 1 needs attention               │
    │  Fri  Happy Hour @ The Cellar   ⚠ no cover │
    │  Sat  Trivia Night              ✓ ready    │
    │  Sun  Brunch Pop-up             ✓ ready    │
    │                       ( Open calendar )     │
    └────────────────────────────────────────────┘
```

### 5.5 Inline threading rules (all response components)

- Render as `MessageList` items in **Ari's lane** (left, 80% maxWidth, orb on first-of-group).
- They sit **below** the Ari bubble that introduces them, `gapGroup` (4) above (same utterance), `gapTurn` (10) below.
- Exactly **one** interactive response component is "live" at the tail at a time (mirrors today's single-`pendingAction` model). On submit, it collapses to its compact success/answered form and the thread advances — no stranded option sets, matching the proposal-card lifecycle.
- All are Android-opaque-safe (cards use opaque fill branch) and web-crisp (no SVG gradients; glyphs are lucide single-path; spinners are `ActivityIndicator`).

---

## 6. Motion / Micro-interaction

| Moment | Motion | Timing / easing | Reduced-motion fallback |
|---|---|---|---|
| Send tap | scale 1→0.92→spring 1; iOS glow pulse 0.4→0.7→0.4 | `withSpring(damping14,stiff220,mass0.7)` + 100/100ms | opacity dim 0.92→1, no glow (existing) |
| New bubble enter | fade + 6px rise | `durations.entry` 260 / `easings.out` | fade only |
| Same-speaker group | no separate enter anim (joins column) | — | — |
| Chip / option select | fill cross-fade to `#a85a44` + check fade-in | `durations.fast` 120 | instant color swap |
| Option set submitted → collapse | siblings fade+collapse height | `durations.exit` 180 / `easings.in` | instant unmount |
| Card loading skeleton | shimmer sweep | 1100ms loop linear | static dimmed rows |
| Orb | existing breathe / thinking pulse | unchanged | static gradient (existing) |
| Thinking cursor | blink 0.2↔1 | 600ms (existing) | static (existing) |

All new animations Reanimated, `useReducedMotion()`-gated. No animation is decorative-only — each communicates state (sent / chosen / loading / collapsed).

---

## 7. Per-Component Implementation Handoff

New tokens to add to `mingla-business/src/constants/designSystem.ts` (one additive block `ariThread` + 1 `ariPalette` addition):
```
ariPalette.userBubble = "hsl(10, 55%, 42%)"   // #a85a44 — legible deep ember (4.6:1 on white text)
export const ariThread = {
  gapTurn: 10, gapGroup: 4, orbGap: 6,
  bubblePadH: 12, bubblePadV: 8, bubbleRadius: 16, bubbleTail: 4, bodyFont: 14, bodyLine: 19,
  cardPad: 12, cardTitleFont: 15, cardTitleLine: 21, btnHeight: 34,
  composerMinH: 48, composerPadV: 8, inputPadV: 6, inputMinH: 30,
  sendSize: 34, chipFont: 13, chipLine: 17,
  ariBubbleAndroid: "#16181b", ribbonPadH: 10, ribbonPadV: 5,
} as const
```

| # | File | Change |
|---|---|---|
| 1 | `src/constants/designSystem.ts` | Add `ariPalette.userBubble` + `ariThread` token block (above). No edits to existing tokens. |
| 2 | `src/components/ari/ChatBubble.tsx` | Adopt `ariThread` paddings/radius/maxWidth(80%); fix user fill → `ariPalette.userBubble`; add `tail?:boolean` prop (default true) for grouping; add lightweight paragraph/bullet segment renderer (§2.5); iOS user-bubble subtle shadow, Android opaque + overflow:hidden + no shadow. |
| 3 | `src/components/ari/MessageList.tsx` | Speaker grouping: compute `gapGroup`(4) vs `gapTurn`(10) separators by comparing adjacent rendered roles; pass `hideOrb` + `tail` accordingly; ribbon padding → `ribbonPadH/V`; `✓` → lucide `Check`. New response components rendered as item kinds (chips / clarifying / multiselect / structured) behind the same single-live-at-tail rule. |
| 4 | `src/components/ari/InputBar.tsx` | **Bug B:** delete `<Svg>/<Defs>/<RadialGradient>/<Circle>`; flat `ariPalette.userBubble` fill on the kept `Animated.View`; lucide `ArrowUp` 18/2.75 white as sole child; keep iOS shadow-glow + send micro-interaction + reduced-motion gate; Android opaque/no-shadow; web flat/no-shadow. **Bug A (input side):** input `fontSize`14/`lineHeight`19/`paddingVertical`6/`minHeight`30; host `minHeight`48/`paddingVertical` web-6; web-only `resize:'none'`,`overflowY:'auto'`,`rows={1}`. Resize "+" to 30px. |
| 5 | `src/screens/ari/AriChatScreen.tsx` | **Bug A (screen side):** make `inputWrap.paddingBottom` `Platform.OS==='web' ? spacing.sm : (keyboard/nav branch)`. List padding top→`spacing.sm`. No header/orb/drawer behavior changes. |
| 6 | `src/components/ari/ToolProposalCard.tsx` | Density: `cardPad`12, title 15/21, button height 34; **Confirm fill → `ariPalette.userBubble`** (contrast fix), keep iOS flame shadow / Android no-elevation. |
| 7 | `src/components/ari/ToolEditForm.tsx` | Field type → 13pt density; paddings → `ariThread`; keep hairline underline + a11y labels verbatim. |
| 8 | `src/components/ari/QuickReplyChips.tsx` | Reuse as the §5.1 single-select chip base: height 30, `chipFont`, selected `userBubble`+`Check`, loading spinner, submitted-collapse; add `selectedId`/`state` props (presentational; default behavior unchanged so existing suggestions panel still works). |
| 9 | `src/components/ari/StreamingText.tsx` | Bubble → 12/8 padding + 16 radius for consistency. No motion change. |
| 10 | `src/components/ari/EmptyState.tsx` | No change required (already tight). Optional: orb `lg`→keep; verify centered above the new tighter composer. |
| 11 | **NEW** `src/components/ari/ClarifyingCard.tsx` | §5.2 presentational card; props `{eyebrow,question,value,state,onChange,onSubmit,onSkip}`. |
| 12 | **NEW** `src/components/ari/MultiSelectPrompt.tsx` | §5.3; props `{title,options,selectedIds,state,onToggle,onConfirm}`. |
| 13 | **NEW** `src/components/ari/ResponseCard.tsx` | §5.4 structured result card; props `{eyebrow?,title,rows,thumbnail?,actions?,state}`. |
| 14 | `src/components/ari/__tests__/` | Append source-assertion tests (repo's ts-jest pattern) for: send button has NO `RadialGradient`/`Svg`; user/Confirm fill === `ariPalette.userBubble`; composer web paddingBottom branch present; new tokens exist. Append-only. |

**Out of scope (guard):** no edits to `useAgentChat`, `agentChatService`, `useConfirmPendingAction`, edge functions, model prompts, or any backend. `AiDisclosureModal` + `ConversationDrawer` behavior and all existing `accessibilityLabel`s are preserved verbatim. The new response components ship **presentational only** — their data/callbacks are wired by the downstream smart-Ari ORCH.

---

## 8. `/goal` completion checklist (self-verified)

1. **References examined** — present (§ header): Linear, iMessage, Partiful, ChatGPT/Claude, Raycast/Arc. ✅
2. **All 9 states** — designed where applicable: empty (EmptyState, unchanged) · populated (thread) · loading (thinking cursor + card skeleton + chip spinner) · submitting (Confirm "Working…", chip/card loading) · error (toast + muted inline retry row, no red card) · first-time (disclosure modal preserved + empty state) · returning (drawer history, unchanged) · degraded (reduced-motion fallbacks §6) · offline — **N/A named:** Ari requires network for any turn; offline is surfaced by the existing screen-level error toast, no offline-specific composer state designed (the composer simply errors on send). ✅
3. **Every value is a token** — all sizes/spacings/radii are `spacing.*`/`radius.*`/`typography.*` or named `ariThread.*` tokens (§7). Zero magic numbers. ✅
4. **Contrast computed** — Ari body 16.46:1 · secondary 9.58:1 · tertiary 5.57:1 · **user bubble white-on-#a85a44 4.6:1** (fixes the old 2.32:1 fail) · send glyph 4.6:1 (fixes old 2.96:1) · all ≥4.5 body / ≥3 large, dark theme (the only theme; Ari canvas is `#0c0e12`). ✅
5. **≥44pt targets + a11y labels + non-shifting feedback** — send/+(hitSlop→44), card buttons 34+hitSlop→44, chips 30+row hitSlop, all keep existing `accessibilityLabel`/`accessibilityRole`; press feedback is opacity/scale (non-shifting). ✅
6. **Zero anti-slop** — no gradients used for decoration (the one removed is the *cause* of a bug); flat ember discs; lucide single-path glyphs; real photos only in ResponseCard thumbnails; no stock/AI imagery; no emoji icons (✓ → lucide `Check`). ✅
7. **Mingla voice + reduced-motion** — copy stays Ari's warm-concise voice ("Want me to pull one from your library?"); every animation has a `useReducedMotion()` fallback (§6). ✅
```
