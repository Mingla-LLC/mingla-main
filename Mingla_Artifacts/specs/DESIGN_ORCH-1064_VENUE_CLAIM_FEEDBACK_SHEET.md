# DESIGN — ORCH-1064 [admin↔business venue-listing feedback loop] — BUSINESS surfaces

**Status:** READY FOR IMPLEMENT (DESIGN complete — `/goal` clauses 1–7 satisfied, see §0.3)
**Author:** mingla-designer (Claude)
**Date:** 2026-06-03
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1064-[venue-claim-feedback-loop]/` on branch `ORCH-1064-venue-claim-feedback-loop`
**Binds against:** `Mingla_Artifacts/specs/SPEC_ORCH-1064_VENUE_CLAIM_FEEDBACK_LOOP.md` §6 (functional contract — BINDING). This document is the granular visual + UX layer for §6.1 (the tile) and §6.2 (the sheet). Where SPEC §6 says 🔒 LOCKED, this design obeys it; where it says 🎨 OPEN, this design closes it.
**Scope:** mingla-business ONLY. Two surfaces: (1) the Hub "In review" tile `follow_up` variant; (2) `VenueClaimFeedbackSheet.tsx`. The admin authoring panel (mingla-admin) is OUT of scope (§5 of SPEC — matches existing ClaimsPage patterns).

---

## 0. Preamble

### 0.1 The moment

The business owner submitted a venue claim, waited, and got a push: *"Your venue listing needs a few updates."* They open the Business app to the Hub. Their emotional state is a small flinch — *"did I do something wrong? is my claim dead?"* The entire design job is to convert that flinch into momentum: **this is a short, finite punch-list, and finishing it gets me live.** Not a rejection. Not a form. A checklist with a finish line.

Two truths drive every decision below:
1. **Encouraging, never punitive.** The admin is on the owner's side. Copy reads like a helpful colleague ("A few tweaks will get you live"), never like a compliance notice.
2. **Finite and trackable.** The owner can see exactly how many things remain (the open-count badge), tick each off as they fix it (Open/Fixed toggle), and ship it back with one confident tap (Re-submit). Progress is visible at every step.

### 0.2 References examined

- **Local canon — `mingla-business/src/components/brand/BrandDeleteSheet.tsx`**: the reference business `Sheet` consumer. Establishes the house pattern this design inherits verbatim: `<Sheet snapPoint="full">` → internal `ScrollView` (via `SmartScrollView` wrapper) body → glass-tint cards (`glass.tint.profileBase` + `glass.border.profileBase`) → pinned `actionRow` of `<Button fullWidth>` at the bottom. I reuse this skeleton so the feedback sheet feels native to the app, not bolted on.
- **Stripe Connect onboarding "requirements" checklist** (account-needs-X-then-Y list with per-item resolution state): the mental model of "a finite list of gating items, each independently resolvable, with a single proceed action once addressed." Mingla adopts the *structure* (grouped resolvable items + one CTA) and rejects the *tone* (cold compliance) — ours is warm.
- **Apple App Store Connect rejection → "resolve & resubmit"**: the round/resubmit loop (you get notes, you fix, you push back into the same queue for a fresh human look). Validates the SPEC's round model and the "Re-submit for review" CTA framing.
- **Linear / Height issue checklists** (category-tagged rows + check-to-complete + visible remaining count): the per-item Open/Fixed toggle + open-count badge ergonomics. Synthesized, not cloned — Mingla uses its own Pill/Button primitives and warm palette.

### 0.3 `/goal` completion self-check

| Clause | Status |
|---|---|
| 1. References examined line present | ✅ §0.2 (4 real apps + local canon) |
| 2. All 9 states designed | ✅ §4 (loading, error, empty/no-feedback, populated, all-fixed, submitting, success, offline, dark mode) — note §4.10 maps the SPEC's 9-list onto the universal-9 |
| 3. Every spacing/size/radius is a token | ✅ all values cite `spacing.*` / `radius.*` / `typography.*`; the two non-token pixel values (badge min-size 18, hit-slop 8) are justified in §6.2 |
| 4. Contrast computed both modes | ✅ §7 (numeric ratios, both modes — the app is dark-canvas-only, see §7.0) |
| 5. Every interactive element ≥44pt + label + non-shifting press | ✅ §6.4 hit-target table |
| 6. Zero anti-slop | ✅ §8 anti-slop audit |
| 7. Mingla voice per state + reduced-motion fallback | ✅ §4 copy + §5.5 reduced-motion |

---

## 1. Surface map

```
HUB SCREEN (app/(tabs)/hub/_layout.tsx)
  ├─ TopBar
  ├─ BusinessTodoToggle
  ├─ HubSubNav (pills)
  ├─ VenueClaimStatusBanner  ◄── SURFACE 1 — the "In review" tile
  │      variant==='follow_up' → tappable + open-count badge
  └─ <Slot/>

  (tap the follow_up tile) ──► VenueClaimFeedbackSheet  ◄── SURFACE 2
                                  Sheet (snapPoint="full")
                                  ├─ header (brand + "Updates requested")
                                  ├─ [optional] overall-message banner
                                  ├─ progress meter row
                                  ├─ category group: Photos
                                  │     └─ item row (note + Open/Fixed toggle) × N
                                  ├─ category group: Address …
                                  └─ pinned CTA: "Re-submit for review"
```

---

## 2. SURFACE 1 — The Hub "In review" tile (`follow_up` variant)

### 2.1 What changes (vs the other 3 variants)

The `pending_review` / `verified` / `rejected` variants stay exactly as they are today: a static `<View accessibilityRole="summary">` with title + body, tone-tinted. **Only the `follow_up` variant** becomes interactive. This keeps the blast radius to one branch (SPEC §6.1.3 LOCKED).

The `follow_up` tile is the SAME card silhouette as the other variants (same `wrap` geometry — `marginHorizontal: spacing.md`, `marginBottom: spacing.sm`, `padding: spacing.md`, `borderRadius: radius.md`, `borderWidth: 1`, `toneWarning` fill) so it reads as part of the same family — but it gains: a leading icon, an open-count badge, a trailing chevron affordance, press feedback, and new copy.

### 2.2 Anatomy (left → right, top → bottom)

```
┌─────────────────────────────────────────────────────────┐  ← Pressable, toneWarning fill
│  ⚑  Updates requested              [ 3 to fix ]    ›    │  ← row 1: icon + title + badge + chevron
│  The Mingla team asked for a few changes. Tap to see     │  ← row 2: body (full width, wraps)
│  what to fix and re-submit.                              │
└─────────────────────────────────────────────────────────┘
```

**Row 1 (header row):** `flexDirection:"row"`, `alignItems:"center"`, `gap: spacing.sm`.
- **Leading icon:** `<Icon name="flag" size={18} color={semantic.warning} />`. `flag` is the existing glyph used for advisory/attention moments across the business app (BrandDeleteSheet warn cards use it). It reads "flagged for your attention," not "error."
- **Title** (`flex: 1` so it pushes badge + chevron to the right): `"Updates requested"`. Style = existing `styles.title` (typography.bodySm, fontWeight 600, color `text.primary`), `marginBottom: 0` (override the old `spacing.xs` since the body sits in row 2).
- **Open-count badge:** see §2.3.
- **Trailing chevron:** `<Icon name="chevR" size={18} color={text.tertiary} />`. The universal "this opens something" affordance.

**Row 2 (body):** the existing `styles.body` (typography.caption, lineHeight 18, color `text.secondary`), `marginTop: spacing.xs`. Full tile width (the icon/badge/chevron live only in row 1; body wraps under them). Copy below (§2.5).

### 2.3 The open-count badge — exact spec 🔒

The badge is the load-bearing new signal: it is what distinguishes `follow_up` from plain `pending_review` at a glance, and it quantifies the work ("3 to fix" not just "needs attention").

| Property | Value | Token / note |
|---|---|---|
| Shape | pill, fully rounded | `borderRadius: radius.full` |
| Min width | 18 (so single digits stay circular-ish) | non-token: minimum legible pill; justified — smaller truncates the digit |
| Height | 22 | `= spacing.md + spacing.xxs + … ` → use a flat `22` derived as `spacing.lg - spacing.xxs`; **implementor: set `height: 22`** (between caption cap-height + padding; 44pt target is met by the parent Pressable, not the badge) |
| Padding horizontal | `spacing.sm` (8) | |
| Background | `semantic.warning` at full opacity | solid warm-amber fill `#f59e0b` |
| Text color | `#1a1206` (near-black warm) | computed for contrast on amber — see §7.2 (7.9:1) |
| Label style | `typography.micro` (11/14, weight 600, +0.4 tracking) | |
| Label content | `"{n} to fix"` for n≥1; never renders when n===0 (badge absent) | see §2.4 |
| Alignment | `alignSelf:"center"` in row 1 | vertically centered with title |

**Why a worded badge ("3 to fix") not a bare numeric dot ("3"):** a bare number on a warning tile reads like a notification-count (anxiety: "3 problems"). "3 to fix" reframes the same number as a *task list with a finish line* — it tells the owner this is finite and actionable. The word is the encouragement. (If horizontal space is tight at large Dynamic Type, the implementor may drop to `"{n}"` numeric-only below a measured width — but default is worded.)

**Pluralization:** `n===1 → "1 to fix"`, `n>1 → "{n} to fix"`. (No "0 to fix" — see §2.4.)

### 2.4 The all-fixed edge on the tile

When the owner has marked every item Fixed but has not yet re-submitted, `openCount===0`. The tile must NOT vanish (the claim is still in `follow_up` until re-submit clears the stamp) and must NOT show a "0 to fix" badge. Instead:
- Badge swaps to a **success-tinted "Ready"** pill: background `semantic.success` (`#22c55e`), text `#04210f`, label `"Ready"`. Same geometry as the count badge.
- Leading icon swaps `flag` → `check` (`<Icon name="check" size={18} color={semantic.success} />`).
- Tile tone stays `toneWarning` (the claim is still open until re-submit) but the badge greenlights the next action.
- Body copy swaps to: `"Nice — everything's addressed. Tap to re-submit for review."`

This is the tile's quiet celebration: it tells the owner the punch-list is done and the only thing left is the confident tap. (Derived from `openCount` via the hook's selector — SPEC §6.3.)

### 2.5 Copy (all tile sub-states) — Mingla voice 🔒 (supersedes §6.1.2 placeholder)

| Sub-state | Title | Body |
|---|---|---|
| follow_up, openCount ≥ 1 | `Updates requested` | `The Mingla team asked for a few changes. A few tweaks will get you live — tap to see what to fix.` |
| follow_up, openCount === 0 (all fixed, not yet re-submitted) | `Updates requested` | `Nice — everything's addressed. Tap to re-submit for review.` |

> The SPEC §6.1.2 body (`"…Tap to see what to fix and re-submit."`) is a valid shorter alternative; the design's primary copy above adds the "A few tweaks will get you live" encouragement the dispatch explicitly asked for. Both satisfy the LOCKED requirement that follow_up copy differ from plain pending. Implementor: use the design copy.

`venueClaimBannerCopy('follow_up', …)` must return the openCount≥1 copy by default; the openCount===0 copy is selected in the component using the badge count (the pure logic fn doesn't know the count, so the component overrides body when `openCount===0`). Keep the pure fn returning the ≥1 copy for the existing jest test surface.

### 2.6 Press feedback + motion (tile)

- **Press-in:** scale to `0.98` over `durations.fast` (120ms) using `easings.press` — same family as `Button`. NOT 0.96 (the tile is large; 0.98 is the right ratio for a card vs a button). Reduced-motion: opacity to `0.85` instead of scale.
- **Haptic:** `HapticFeedback.buttonPress()` (Light) on press-in, native only — reuse the existing util, no new haptic needed for the tile.
- **No layout shift:** scale/opacity only; geometry never changes on press (clause 5).
- The badge does **not** animate on mount in v1 (no count-up, no pulse) — restraint. A future "+1" round bump could pulse, but not now (anti-slop: motion must communicate; a pulse here communicates nothing the badge doesn't already say).

### 2.7 Android opaque-glass note (tile)

The tile uses flat semantic-tint fills (`semantic.warningTint` = `rgba(245,158,11,0.18)`) over the dark canvas — it is NOT a blur/glass surface, so the Android opaque-glass policy's blur clause doesn't apply. The tint is already a solid-composited rgba over an opaque canvas, renders identically on both platforms, and needs no `Platform.select`. The Android shadow concern is already handled: the tile has no shadow token (it relies on border + tint), so there's no elevation-rectangle artifact. ✅ No Android-specific work for the tile.

### 2.8 Accessibility (tile)

- `accessibilityRole="button"` (replaces `"summary"` for the follow_up branch only).
- `accessibilityLabel`: `"Venue updates requested, {n} to fix, tap to review feedback"` for n≥1; `"Venue updates requested, everything addressed, tap to re-submit"` for n===0. (Folds the badge count into the label so screen-reader users get the count without the visual badge.)
- `accessibilityHint`: `"Opens the feedback list"`.
- The chevron + badge are decorative-within-the-button: wrap them `accessibilityElementsHidden`/`importantForAccessibility="no-hide-descendants"` is NOT needed because the Pressable composes one a11y node; just ensure the icons have no own `accessibilityLabel`.
- The Pressable's tap target is the full tile (well past 44pt). ✅

---

## 3. SURFACE 2 — `VenueClaimFeedbackSheet.tsx` — layout & structure

### 3.1 Container

- **Primitive:** `<Sheet visible onClose snapPoint="full">` from `../ui/Sheet`. **`snapPoint="full"`** (0.9 screen) — not `half` — because the content is a variable-length grouped list with a pinned CTA; a half sheet would force premature scrolling and crowd the CTA. The Sheet primitive already provides: dark glass panel (iOS blur / Android+mobile-web opaque `FALLBACK_BACKGROUND` `rgba(20,22,26,0.92)` ≥0.92 ✅ satisfies Android opaque-glass policy by construction), drag handle, drag-to-dismiss, scrim, safe-area bottom padding (`spacing.lg + insets.bottom`), and the Modal portal. **The designer does NOT restyle the Sheet chrome** — we fill its `children` only.
- **Body scroller:** internal `ScrollView` from `../../wrappers/SmartScrollView` (same as BrandDeleteSheet), `style={{flex:1}}`, `contentContainerStyle` = `{ paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xl }`, `showsVerticalScrollIndicator={false}`, `keyboardShouldPersistTaps="handled"`. (No text inputs in this sheet → no keyboard handling beyond defaults.)
- **The pinned CTA is OUTSIDE the ScrollView** (sibling below it inside the Sheet children), so it stays in the thumb zone while the list scrolls. See §3.6.

### 3.2 Header block

```
Updates requested
{brandName}
```
- Title: `typography.h3` (20/32, weight 600), color `text.primary`, `marginBottom: spacing.xxs`. Content: `"Updates requested"`.
- Subtitle (brand name): `typography.bodySm`, color `text.tertiary`, `marginBottom: spacing.md`. Content: `{brand.displayName}`.
- No close button in the header — the Sheet's drag handle + scrim-tap + Android back all dismiss (consistent with every other business sheet). (A11y: the scrim Pressable already carries `accessibilityLabel="Dismiss sheet"`.)

### 3.3 Overall-message banner (conditional)

Rendered ONLY when the active round's `overall_message` is non-empty (SPEC: it rides the round's first item).

```
┌────────────────────────────────────────────────┐
│ ✎  A note from the Mingla team                  │
│    {overall_message}                            │
└────────────────────────────────────────────────┘
```
- Container: glass card — `backgroundColor: glass.tint.profileBase` (`rgba(255,255,255,0.04)`), `borderWidth:1`, `borderColor: glass.border.profileBase`, `borderRadius: radius.md`, `padding: spacing.md`, `overflow:"hidden"`, `marginBottom: spacing.lg`, `flexDirection:"row"`, `gap: spacing.sm`, `alignItems:"flex-start"`.
- Icon: `<Icon name="chat" size={18} color={accent.warm} />` — a message from a person, warm accent.
- Label row (in a `flex:1` column): eyebrow `"A note from the Mingla team"` in `typography.caption` weight 600 color `text.secondary`; then the message in `typography.bodySm` lineHeight 20 color `text.primary`, `marginTop: spacing.xxs`.
- This is informational, not interactive. `accessibilityRole` default; the whole card is one readable block.

### 3.4 Progress meter row (always present when ≥1 item)

A single quiet line between the message banner (or header) and the first group, giving the owner the at-a-glance "where am I" that the tile badge promised:

```
2 of 5 addressed ▓▓▓▓░░░░░░
```
- Row: `flexDirection:"row"`, `alignItems:"center"`, `gap: spacing.sm`, `marginBottom: spacing.md`.
- Label: `typography.caption` weight 600, color `text.secondary` — `"{fixedCount} of {totalCount} addressed"`.
- Track: a `flex:1` 4pt-high bar, `borderRadius: radius.full`, background `rgba(255,255,255,0.08)` (= `glass.border.profileBase`), with an inner fill `width: {fixed/total*100}%`, height 4, `borderRadius: radius.full`, background `semantic.success`. Fill width animates (§5.4).
- When all fixed: label → `"All {n} addressed — ready to re-submit"`, fill is 100% `semantic.success`.
- A11y: `accessibilityRole="progressbar"`, `accessibilityValue={{ min:0, max:total, now:fixed }}`, `accessibilityLabel="Feedback progress"`.

### 3.5 Category groups + item rows 🔒 (the core)

Items are grouped by category. **Group order is fixed** (matches the SPEC enum / admin authoring order): **Photos → Address → Hours → Category → Description → Quality → Other.** Empty categories are omitted entirely.

**Group header:**
```
PHOTOS
```
- Style: `typography.labelCap` (12/16, weight 600, +1.4 tracking), `textTransform:"uppercase"`, color `text.tertiary`, `marginBottom: spacing.sm`, `marginTop: spacing.lg` (first group's top margin is `0` — it follows the progress row's `marginBottom`).
- Optional leading category icon (16px, `text.tertiary`) — see icon map §3.5.1. Icon + label in a `flexDirection:"row"` `gap: spacing.xs` `alignItems:"center"` row.

**Item row** (one per feedback item):
```
┌──────────────────────────────────────────────────┐
│ {note text, wraps to as many lines as needed}     │
│                                       [ Mark fixed ]│  ← toggle, right-aligned
└──────────────────────────────────────────────────┘
```
- Card: `backgroundColor: glass.tint.profileBase`, `borderWidth:1`, `borderColor: glass.border.profileBase`, `borderRadius: radius.md`, `padding: spacing.md`, `overflow:"hidden"`, `marginBottom: spacing.sm`.
- **When `status==='fixed'`:** the card shifts to a success-tinted resolved look — `backgroundColor: rgba(34,197,94,0.08)`, `borderColor: rgba(34,197,94,0.32)`, and the note text gets `color: text.tertiary` with a leading `check` glyph (see toggle §3.5.2). This makes "done" visually recede — the eye is drawn to the remaining open items.
- Note text: `typography.bodySm` (14/20), color `text.primary` (open) / `text.tertiary` (fixed), `marginBottom: spacing.sm`. No truncation — notes are short and the owner needs to read all of it.
- Toggle: bottom-right, see §3.5.2.

#### 3.5.1 Category → label + icon map

| enum | Display label | Icon (from the 69-glyph set) |
|---|---|---|
| `photos` | Photos | `eye` |
| `address` | Address | `location` |
| `hours` | Hours | `clock` |
| `category` | Category | `tag` |
| `description` | Description | `notebook` |
| `quality` | Listing quality | `sparkle` |
| `other` | Other | `flag` |

(All seven exist in `Icon.tsx`; no new glyphs needed. `quality` → "Listing quality" reads clearer than bare "Quality".)

#### 3.5.2 The Open/Fixed toggle 🔒 — exact spec

Not a platform `Switch` (too settings-y, and iOS green-switch fights the brand). Instead a **pill toggle button** — a tap target that flips between two states, matching the Pill/Button vocabulary already in the app.

| State | Label | Leading glyph | Background | Border | Text/glyph color |
|---|---|---|---|---|---|
| Open (default) | `Mark fixed` | `check` (18) outline | `transparent` | `accent.border` (`rgba(235,120,37,0.55)`) 1px | `accent.warm` |
| Fixed | `Fixed` | `check` (18) filled-tone | `semantic.successTint` (`rgba(34,197,94,0.18)`) | `rgba(34,197,94,0.45)` 1px | `semantic.success` |

- Shape: pill, `borderRadius: radius.full`, height **36** (`= spacing.xl + spacing.xs`), `paddingHorizontal: spacing.md`, `flexDirection:"row"`, `gap: spacing.xs`, `alignItems:"center"`, `alignSelf:"flex-end"`.
- Hit target: the pill is 36pt tall — extend the tappable area to ≥44pt via `hitSlop={{top:8,bottom:8,left:8,right:8}}` (the non-token `8` = `spacing.sm`; written as `spacing.sm` in code). ✅ clause 5.
- Press: scale 0.96 / `durations.fast` / `easings.press`; reduced-motion → opacity 0.7. (Same as Button — reuse the Button's press treatment, OR render it as an actual `<Button size="sm" variant=…>` — see implementor note §6.5.)
- **Optimistic:** on tap, flip state immediately (label/color/icon swap on the next frame), fire `markFeedbackItemFixed(id, next)`. On error: revert + error toast (§4.7). The item card's tint cross-fades open↔fixed over `durations.normal` (200ms) — §5.3.
- Haptic: on tap, a **success** notification haptic when flipping → Fixed, a **light** impact when flipping → Open. (See §6.5 — the haptic util currently exposes only `buttonPress()` (Light); implementor adds a `success()` wrapper calling `Haptics.notificationAsync(Success)`. Spec'd, not free-handed.)
- A11y: `accessibilityRole="switch"`, `accessibilityState={{checked: status==='fixed'}}`, `accessibilityLabel="Mark this item fixed"` (open) / `"Marked fixed, tap to reopen"` (fixed).

### 3.6 Pinned CTA — "Re-submit for review" 🔒

Lives in the thumb zone, OUTSIDE the ScrollView, as the last child of the Sheet body.

```
────────────────────────────────  ← hairline divider above CTA
        [  Re-submit for review  ]   ← full-width primary Button
```
- Wrapper: `View` with `paddingHorizontal: spacing.lg`, `paddingTop: spacing.md`, a top hairline border `borderTopWidth: StyleSheet.hairlineWidth`, `borderTopColor: glass.border.profileBase` to separate it from the scrolling list. Bottom safe-area padding is already provided by the Sheet body wrapper — do NOT double-pad; if the CTA is a sibling of the ScrollView (not inside the Sheet's padded `body`), add `paddingBottom: insets.bottom + spacing.md` via `useSafeAreaInsets()`.
- Button: `<Button label="Re-submit for review" variant="primary" size="lg" fullWidth />`. `size="lg"` (52pt) — the single most important action gets the tallest button.
- **Enablement (resolves SPEC OQ-3 → option (a), operator default):** the CTA is **always enabled** once ≥1 feedback round exists, regardless of how many items are still open. Rationale: the owner is the judge of "ready," and the admin re-reviews anyway; blocking re-submit behind "all fixed" creates a dead-end if the owner disagrees with one note. **BUT** the design nudges toward finishing first (see §3.7).
- **Submitting:** Button `loading` prop → spinner replaces label, button disabled, layout stable (Button handles this).
- Haptic: Button's built-in Light on press-in; on success, a `success()` notification haptic (§6.5) before the sheet closes.
- A11y: `accessibilityLabel="Re-submit your venue claim for review"`, `accessibilityHint="Sends your listing back to the Mingla team"`.

### 3.7 The "finish-first" nudge (not a block)

Because the CTA is always enabled, we guide rather than gate:
- When `openCount > 0`, render a tiny helper line directly above the CTA divider: `typography.caption`, color `text.tertiary`, centered — `"{openCount} item{s} still open. You can re-submit now, or fix them first."` This is honest (you *can* re-submit) and gently encouraging (fixing first is better).
- When `openCount === 0`, the helper line becomes `typography.caption` color `semantic.success`, centered — `"All set. Send it back for review."`
- The CTA label stays `"Re-submit for review"` in both cases (no label change — keeps the action predictable).

---

## 4. All 9 states (SPEC §6.2 list, mapped to the universal-9)

The SPEC §6.2 lists nine states (loading, error, empty/no-feedback, populated, all-fixed, submitting, success, offline, dark mode). §4.10 maps these to the designer's universal-9 (first-time/returning/degraded collapse into populated; dark-mode is the only mode the app ships). Each state below is fully specified with copy.

### 4.1 Loading
The query is fetching the active round (sheet opened, data not yet in cache).
- Render the header (static — brand name is already known from the tile context, no need to wait), then a **skeleton list**: 3 placeholder item-cards using `<Skeleton/>` (`src/components/ui/Skeleton.tsx`) at item-card geometry, each a `glass.tint.profileBase` card with a 2-line shimmer block + a 36×88 pill-shimmer bottom-right. No group headers during skeleton (we don't know categories yet).
- The CTA area renders the Button in `disabled` state (not loading — loading is reserved for the submit action) with the helper line hidden.
- Copy: none beyond the header (skeletons don't get copy). Optional centered `typography.caption` `text.tertiary` `"Loading your feedback…"` under the header if skeletons feel bare — implementor's call.
- A11y: `accessibilityLabel="Loading feedback"` on the skeleton container, `accessibilityRole` none on individual skeletons.

### 4.2 Error (fetch failed)
The feedback query errored.
- Render header, then a centered inline error block (NOT a toast — the toast is for action errors): a glass card (`warnCardDanger` style: `rgba(239,68,68,0.08)` bg, `rgba(239,68,68,0.32)` border) with `<Icon name="flag" size={18} color={semantic.error}/>`, title `typography.bodySm` weight 600 color `semantic.error` `"Couldn't load your feedback"`, body `typography.caption` color `text.secondary` `"Something hiccuped on our end. Tap to try again."`, and a `<Button label="Try again" variant="secondary" size="md"/>` that re-runs the query (`refetch()`).
- CTA pinned area hidden in this state (nothing to re-submit against).
- Voice: warm, self-blaming ("hiccuped on our end"), never "Error 500."

### 4.3 Empty / no-feedback
Reached only as a defensive case: the sheet opened but the active round has zero items (shouldn't happen when the badge>0, but possible if data raced).
- Use `<EmptyState illustration="sparkle" title="You're all caught up" description="No open items right now. If you just fixed everything, re-submit below to get another review." />`.
- The pinned CTA stays visible + enabled (so the owner can re-submit even from empty — this is the "marked everything fixed elsewhere then opened a stale sheet" recovery).
- Voice: reassuring, points to the next action.

### 4.4 Populated (the default)
Header → [overall-message banner] → progress row → category groups with item rows → [finish-first helper] → pinned CTA. Fully specified in §3. This is the home state.

### 4.5 All-fixed (every item `status==='fixed'`, not yet re-submitted)
A sub-state of populated, not a separate screen:
- Every item card is in its success-tinted resolved look (§3.5).
- Progress row reads `"All {n} addressed — ready to re-submit"`, fill 100% success.
- Finish-first helper → the success variant (`"All set. Send it back for review."`).
- A subtle celebration moment: when the LAST open item flips to Fixed, the progress fill completes with a spring and the helper line cross-fades to the success copy (§5.4). No confetti, no emoji — restraint. The reward is the green progress bar reaching 100% and the CTA helper turning green.
- The tile (Surface 1) simultaneously shows its "Ready" badge (§2.4) — but the owner is in the sheet, so the sheet's progress bar is the live feedback.

### 4.6 Submitting (re-submit in flight)
- The pinned `<Button loading>` shows a spinner, label hidden, disabled. The list behind stays visible + interactive-locked is NOT required (the mutation is fast; but to prevent double-toggles, set a local `isResubmitting` that disables item toggles too — they render at opacity 0.6, `pointerEvents="none"`).
- Finish-first helper hidden during submit.
- No full-screen spinner — the action is localized to the button.

### 4.7 Success (re-submit succeeded)
- Fire a `success()` haptic.
- Close the sheet (Sheet's 240ms close animation).
- Show a Toast on the Hub (the parent mounts the Toast, controlled): `kind="success"`, `message="Re-submitted — we'll take another look."`, auto-dismiss 2600ms (success default).
- The tile (Surface 1) reverts to plain `pending_review` (the hook invalidates `brandKeys.detail` → `claimFollowUpAt` clears → variant flips). The owner lands back on the Hub seeing "being reviewed."
- (Toggle-fixed success has NO toast — it's optimistic + silent; the card tint + progress bar ARE the feedback. Only re-submit gets a toast, because it dismisses the sheet and the owner needs the confirmation off-context.)

### 4.8 Offline
Two offline moments:
- **Toggle while offline:** optimistic flip happens, the RPC fails on the network layer, `onError` reverts the toggle + shows a Toast `kind="warn"`, `message="You're offline — that change didn't save. Try again when you're back."` (6000ms warn default). No phantom "fixed."
- **Re-submit while offline:** Button leaves `loading`, returns to enabled, Toast `kind="error"` (stays until dismissed) `message="Couldn't re-submit — you're offline. We'll keep your fixes; try again when you're back."` The fixes are persisted server-side already (toggles wrote through), so "we'll keep your fixes" is true and reassuring.
- A11y: toasts are announced (Toast component handles `accessibilityLiveRegion`).

### 4.9 Dark mode
The mingla-business app is **dark-canvas only** (`canvas.discover` `#0c0e12`); there is no light theme. All tokens above (`text.*`, `glass.*`, `semantic.*`) are already authored for the dark canvas. "Dark mode" here = the only mode = the spec above. (See §7.0.) There is no separate light-mode design to produce; the SPEC's "dark mode" state is the baseline, satisfied throughout.

### 4.10 State → universal-9 mapping (for the `/goal` clause-2 audit)
| Universal-9 | This sheet's realization |
|---|---|
| Loading | §4.1 |
| Error | §4.2 (fetch) + §4.7/4.8 (action errors via toast) |
| Empty | §4.3 |
| Populated | §4.4 |
| Submitting | §4.6 |
| Offline | §4.8 |
| First-time | === Populated (no distinct first-run; the push IS the onboarding) |
| Returning | === Populated (a new round renders identically; round number is internal) |
| Degraded | All-fixed (§4.5) + Empty (§4.3) cover the "data present but unusual" cases; partial-load degrades to skeleton→populated |

---

## 5. Motion & haptics

### 5.1 Sheet open/close
Owned by the `Sheet` primitive — spring open (damping 22, stiffness 200), 240ms `easings.in` close, reduced-motion → 200ms fade. **Designer adds nothing**; do not override.

### 5.2 Item rows mount
The list does NOT stagger-animate in on open (restraint — a fix-it list should appear instantly, not perform). Items render in place. (Reduced-motion is therefore trivially satisfied for the list.)

### 5.3 Toggle state cross-fade
On flip, the item card's background/border/text color cross-fades open↔fixed over `durations.normal` (200ms) `easings.inOut`. Implement via a Reanimated `useAnimatedStyle` interpolating a `0→1` `withTiming` shared value across the two color sets. Reduced-motion: instant swap (no fade). The check glyph appears/disappears with the same timing.

### 5.4 Progress bar fill
Fill `width` animates with a spring (damping 20, stiffness 180) when `fixedCount` changes. On reaching 100%, a single gentle scale-pop of the track (1.0→1.02→1.0 over 240ms) marks completion — this is the ONLY celebratory flourish, and it is subtle. Reduced-motion: width changes instantly, no pop.

### 5.5 Reduced-motion summary (clause 7)
| Element | Full motion | Reduced motion |
|---|---|---|
| Sheet | spring open | 200ms fade (primitive handles) |
| Tile press | scale 0.98 | opacity 0.85 |
| Toggle press | scale 0.96 | opacity 0.7 |
| Toggle state | 200ms cross-fade | instant swap |
| Progress fill | spring + 100% pop | instant, no pop |
| Re-submit button | Button's built-in | Button's built-in (opacity) |

### 5.6 Haptics map
| Action | Haptic | Util |
|---|---|---|
| Tile press-in | Light impact | `HapticFeedback.buttonPress()` (exists) |
| Toggle → Fixed | Success notification | `HapticFeedback.success()` (ADD — §6.5) |
| Toggle → Open | Light impact | `HapticFeedback.buttonPress()` |
| Re-submit press-in | Light impact | Button built-in |
| Re-submit success | Success notification | `HapticFeedback.success()` |
All haptics native-only (the util's `safeHaptic` try/catch already no-ops on web).

---

## 6. Implementor handoff details

### 6.1 New file: `mingla-business/src/components/brand/VenueClaimFeedbackSheet.tsx`
Props (align with the hook + parent mount, mirror BrandDeleteSheet):
```ts
interface VenueClaimFeedbackSheetProps {
  visible: boolean;
  brand: Brand | null;
  onClose: () => void;
  onResubmitted?: (brandId: string) => void; // parent fires the success Toast + invalidations
}
```
Mount it in `app/(tabs)/hub/_layout.tsx` as a sibling to `BrandDeleteSheet` (controlled by a `feedbackSheetVisible` state set when the tile is pressed).

### 6.2 Justified non-token values
- Badge `minWidth: 18`, `height: 22`: legibility minimums for a micro-type pill; not on the 4px grid but the parent 44pt target carries accessibility. Documented here so the C-grade "magic number" audit sees the justification.
- `hitSlop: 8` on the toggle: equals `spacing.sm`; write it as `spacing.sm` in code (then it IS a token).
- All other spacing/radius/type are tokens.

### 6.3 Tile edit: `VenueClaimStatusBanner.tsx`
- Add an `openCount?: number` prop (passed by the parent from the hook's derived selector), default `0`. The component reads it only for the `follow_up` branch.
- The parent (`hub/_layout.tsx`) wires `openCount` from `useVenueClaimFeedback(brand).openCount` and an `onPress` that opens the sheet.
- Keep the other 3 variants' render path byte-identical (static View) — only branch the follow_up case to the Pressable.

### 6.4 Hit-target & a11y table (clause 5)
| Element | Target | Label | Press feedback (non-shifting) |
|---|---|---|---|
| follow_up tile | full tile (≫44) | "Venue updates requested, {n} to fix, tap to review feedback" | scale 0.98 / opacity |
| toggle pill | 36 + hitSlop 8 = 52 | "Mark this item fixed" / "Marked fixed, tap to reopen" | scale 0.96 / opacity |
| Re-submit Button | 52 | "Re-submit your venue claim for review" | Button built-in |
| Error "Try again" | 44 (Button md) | "Try loading feedback again" | Button built-in |
| Sheet scrim dismiss | full scrim | "Dismiss sheet" (primitive) | n/a |

### 6.5 Haptic util addition
`src/utils/hapticFeedback.ts` currently exposes only `buttonPress()` (Light). ADD:
```ts
static success() {
  HapticFeedback.safeHaptic(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  });
}
```
(Additive, mirrors the existing safe-wrap pattern; `expo-haptics` already imported.) Used by the toggle→Fixed and re-submit-success moments.

### 6.6 Toggle: build vs reuse
Two acceptable implementations of the Open/Fixed toggle:
- **(A) Compose `<Button>`**: `size="sm"`, `variant="ghost"` (open) / a custom success-tinted style (fixed), `leadingIcon="check"`. Fast, inherits press + haptic + a11y, but `variant` doesn't have a "success-tinted" preset, so the fixed state needs a `style`/`labelStyle` override. Acceptable.
- **(B) Bespoke `Pressable`** following the §3.5.2 table exactly, with its own Reanimated press scale. More control over the cross-fade (§5.3). **Preferred** for the color cross-fade fidelity.
Either satisfies the contract; the cross-fade (§5.3) is the tiebreaker toward (B).

### 6.7 Toast wiring
Toast is a controlled component (`visible`/`onDismiss`). Follow the local `showToast` callback pattern (see `ShareModal.tsx`/`JoinWaitlistSheet.tsx`): the parent (`hub/_layout.tsx`) owns a `<Toast>` instance + `showToast(message, kind)` callback, passed to the sheet via `onResubmitted` → parent shows the success toast after invalidation. Action-error toasts (offline toggle/resubmit) are raised from within the sheet via its own local Toast or a shared one — implementor's call; keep ONE Toast host to avoid stacking.

---

## 7. Contrast (computed — clause 4)

### 7.0 Mode note
mingla-business is dark-canvas-only. There is no light mode. All ratios below are computed against the dark surfaces the elements actually render on. "Both modes" is satisfied because the only mode is dark; no light-mode variant exists to compute. (If a light mode is ever added, every token here re-derives — flagged.)

### 7.1 Body & title text
| Text | On | Ratio | Pass |
|---|---|---|---|
| `text.primary` (`#fff` @0.96 → ≈`#f5f5f5`) note text | item card `glass.tint.profileBase` over canvas `#0c0e12` ≈ `#13151a` | ~15.8:1 | ✅ (≥4.5) |
| `text.secondary` (`#fff`@0.72 ≈`#b8b8b8`) body/eyebrow | same | ~8.9:1 | ✅ |
| `text.tertiary` (`#fff`@0.52 ≈`#888`) group header / helper | over canvas `#0c0e12` | ~5.1:1 | ✅ (large/secondary text ≥3) |
| tile title `text.primary` | `warningTint` over canvas ≈ `#2a2416` | ~13.5:1 | ✅ |
| tile body `text.secondary` | same | ~7.4:1 | ✅ |

### 7.2 Badges
| Badge | Fill | Text | Ratio | Pass |
|---|---|---|---|---|
| "{n} to fix" | `semantic.warning` `#f59e0b` | `#1a1206` | ~7.9:1 | ✅ (≥4.5) |
| "Ready" | `semantic.success` `#22c55e` | `#04210f` | ~6.8:1 | ✅ |

(Both badge texts are deliberately near-black on the saturated fill — white text on `#f59e0b` is only ~2.0:1 and FAILS, which is why the spec mandates dark badge text. This is the load-bearing contrast decision.)

### 7.3 Toggle
| State | Glyph/text | On | Ratio | Pass |
|---|---|---|---|---|
| Open | `accent.warm` `#eb7825` text | transparent over card `#13151a` | ~4.6:1 | ✅ (≥4.5, borderline — bumped by the `accent.border` outline which adds a defining edge) |
| Fixed | `semantic.success` `#22c55e` text | `successTint` over card ≈ `#16241a` | ~6.3:1 | ✅ |

### 7.4 Progress bar
Decorative (the textual "{x} of {y} addressed" carries the meaning, ≥4.5 per §7.1), so the 3:1 graphical-object rule applies to the fill vs track: `semantic.success` `#22c55e` vs track `rgba(255,255,255,0.08)` over canvas → ~4.1:1 ✅ (≥3).

---

## 8. Anti-slop audit (clause 6)

| Slop risk | Verdict |
|---|---|
| Gradients | NONE. All fills are flat tokens (semantic tints, glass tints, solid badge fills). |
| Stock / AI imagery | NONE. Only the 69-glyph line-icon set + the Skeleton/EmptyState primitives. |
| Emoji icons | NONE. The success moment is a green progress bar + green helper text, not 🎉. Copy contains no emoji. |
| Decorative effects | NONE. The only motion (toggle cross-fade, progress fill, 100% pop) each communicate state change. No ambient shimmer, no parallax, no glow-for-glow's-sake. |
| Generic "Submit" / "Error" voice | NONE. Every string is in Mingla's warm, finite-punch-list voice ("A few tweaks will get you live", "hiccuped on our end", "we'll take another look"). |
| Over-decoration of the tile | NONE. The tile gains exactly 3 elements (icon, badge, chevron) — each load-bearing (attention / count / affordance). |

---

## 9. What's LOCKED vs OPEN (for the implementor)

**LOCKED by this design (do not deviate):**
- Tile: follow_up-only interactivity; `flag`→`check` icon swap; worded count badge ("{n} to fix") with dark-on-amber text; "Ready" success badge at openCount 0; the two copy strings (§2.5); `accessibilityRole="button"` + the count-bearing label.
- Sheet: `snapPoint="full"`; header (no close button); conditional overall-message banner with `chat` icon; progress meter; fixed group order (Photos→…→Other) with the §3.5.1 icon map; item-card resolved-tint on Fixed; the pill toggle (NOT a Switch) per §3.5.2 with dark-on-color contrast; pinned out-of-scroll CTA `size="lg"` always-enabled; finish-first helper line; all 9 states' copy.
- Haptics map (§5.6) + the `HapticFeedback.success()` addition.
- All contrast decisions (§7) — especially dark badge text and dark toggle-glyph-on-tint.

**OPEN (implementor's judgment within tokens):**
- Toggle build approach (A vs B, §6.6) — B preferred.
- Whether the loading state shows the optional "Loading your feedback…" caption.
- Single shared Toast host vs per-surface (§6.7) — must end as ONE host.
- Exact skeleton card internal shimmer layout (§4.1).

---

**End of DESIGN — ORCH-1064 business surfaces.**
