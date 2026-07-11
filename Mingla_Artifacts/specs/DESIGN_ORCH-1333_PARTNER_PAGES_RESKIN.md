# DESIGN — ORCH-1333 Partner Pages Re-Skin (Brands + Earnings)

**Phase:** DESIGN (pixel-precise, implementor-ready)
**Surfaces:** `mingla-business` iOS + Android ONLY. NOT consumer / admin / buyer-web.
**Files re-skinned:** `mingla-business/app/partner/brands.tsx`, `mingla-business/app/partner/earnings.tsx`
**Latent 1-line swaps (no redesign):** `mingla-business/src/components/trip/TripManageMenu.tsx:119`, `mingla-business/src/components/venue/VenueCreatorWizard.tsx:579`
**Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1332-[partner-brand-fixes]` on branch `ORCH-1332-partner-brand-fixes`
**Coordination:** ORCH-1332 forensics owns the "Set up your first partner brand" CTA **route target** (`onPress`). This spec touches only the CTA's **visual treatment**. See §12.

Goal: make both partner pages "feel like the same app." NOT a novel look — bring them onto the exact header, button, card, canvas, and close-glyph patterns the rest of the Mingla Business account section already uses. Every value below is a real token quoted from `mingla-business/src/constants/designSystem.ts` or a real component API. **No new tokens are proposed. Nothing is missing.**

---

## 1. Reference-pattern findings — what is off-brand, and why (the audit)

I read the design system and 4 canonical business-app screens: `app/account/edit-profile.tsx`, `app/account/notifications.tsx`, `app/booking/[orderId]/cancel.tsx`, and the wizard `src/components/venue/VenueCreatorWizard.tsx`. The partner pages diverge on **five** concrete axes, each measured against the rest of the app:

| # | Off-brand on partner pages | The canonical app pattern | Evidence (prevalence) |
|---|---|---|---|
| 1 | **Close glyph is `icon="x"`** — a SOLID FILLED letterform-X (`M4 4l7 9-7 9…`, the Twitter/X social glyph, `Icon.tsx:387`). Reads as "a letter X," not a close control. | **`icon="close"`** — the thin two-stroke ✕ (`M18 6L6 18M6 6l12 12`, `Icon.tsx:130`). | `icon="close"` = **53** usages app-wide. `icon="x"` = **4** usages, and all 4 are exactly the in-scope files (2 partner + 2 latent). Partner is the anomaly. |
| 2 | **Close sits on the RIGHT**, paired with a left-aligned eyebrow + big `h1` (a "modal hero" header). | **Close on the LEFT**, centered chrome title, empty right spacer to balance. (`ChromeRow` in edit-profile / notifications; `chrome` in VenueCreatorWizard.) | Every account-launched full-screen route (edit-profile, notifications, delete, support) and the venue wizard put close on the LEFT. |
| 3 | **Orange `MINGLA PARTNER` eyebrow** (`typography.labelCap` in `accent.warm`) above the title. | **No eyebrow.** The title alone (`Brands` / `Earnings`), centered, 16–17px. | The `MINGLA PARTNER` eyebrow literal exists on **only these two files**. No other operator screen uses a header eyebrow. It is the single loudest "different brand" signal. |
| 4 | **Screen canvas = `canvas.profile` (#141113)**, a warmer near-black. | **`canvas.discover` (#0c0e12)**, the app's cool near-black. | `canvas.discover` = **48** screen files (incl. EVERY sibling `app/account/*` screen). `canvas.profile` = **3** files (the 2 partner pages + 1 brand screen). Partner is the outlier. |
| 5 | **Hand-rolled orange buttons** — bespoke `primaryBtn` (solid `accent.warm`, rectangular `radius.md`) and `secondaryBtn` Pressables, inconsistent between the two files (brands uses `buttonMd`, earnings uses `buttonLg` + `shadows.md`). | **The shared `<Button>` primitive** — `primary` = `accent.warm` fill + white label, **pill** (`radius.full`), with built-in press-scale, haptic, disabled, loading, reduced-motion. | edit-profile uses `<Button>`. The partner pages reimplement a worse, non-pill, inconsistent version. |

**Also noted, kept as-is (already on-brand, do NOT churn):** the status-indicator dot+label rows, the currency/split rows, filter chips (`radius.full`, active = `accent.warm`), `StatusBadge` semantic-tint pills, the `PortfolioWelcomeToast` (`accent.tint` celebratory card), the `BrandStripeCountryPicker` (shared component), the `mailto` link style, and the `ActivityIndicator color={accent.warm}` loaders. These already use real tokens and match the app.

---

## 2. Global redesign decisions (apply to BOTH files)

**D1 — Close glyph.** `IconChrome icon="x"` → **`icon="close"`**. Keep `size={36}` (→ 44pt effective target via IconChrome's baked `hitSlop:{4,4,4,4}`, satisfies I-38). Keep the existing `accessibilityLabel` and `testID` verbatim (§3).

**D2 — Header → canonical `ChromeRow`.** Replace the eyebrow+h1+right-X header with the venue-wizard `chrome` pattern: **close (LEFT) → centered title column (`chromeMid`) → empty right spacer (width 36)**. Drop the `MINGLA PARTNER` eyebrow entirely. Title is the plain page name. `brands.tsx` keeps its count meta as a **sub-line under the centered title** (the wizard's title+sub precedent). `earnings.tsx` has no sub-line (title only).

**D3 — Canvas.** `backgroundColor: canvas.profile` → **`canvas.discover`** on the `safe` style in both files. (GlassCard tints are white-alpha and read identically on both; safe change.)

**D4 — Buttons.** Delete every bespoke `primaryBtn` / `secondaryBtn` Pressable + their styles; render the shared `<Button>` (import `../../src/components/ui/Button`). Mapping in §5–§6. Default `size="md"` (44pt height), default `shape="pill"`, `fullWidth`.

**D5 — Card radius (polish).** Add `radius="md"` to every `GlassCard variant="elevated"` in both files, matching the sibling settings screen `notifications.tsx` (which passes `radius="md"` on its elevated list cards). Today the partner cards inherit the elevated default `xl` (24); `md` (12) reads as the same "settings list" family. Keep `variant="elevated"` and existing `padding`.

**Priority for the implementor:** D1–D4 are the redesign (they fix Seth's two complaints + the "different feel"). D5 + the `thumbFallback` color (§5) are polish — apply them, but if a merge conflict with forensics forces triage, D1–D4 are non-negotiable and D5 is deferrable.

---

## 3. Canonical close-button directive (both partner pages)

Exact element, both files (only `icon`, and its position in the row, change; `size`/`accessibilityLabel`/`testID`/`onPress` are preserved verbatim):

**brands.tsx** (was lines 118–124, moves to the LEFT of the header row):
```tsx
<IconChrome
  icon="close"                              // was "x"
  size={36}
  onPress={handleClose}
  accessibilityLabel="Close partner brands"  // PRESERVE verbatim
  testID="partner-brands-close-button"        // PRESERVE verbatim
/>
```

**earnings.tsx** (was lines 201–207, moves to the LEFT of the header row):
```tsx
<IconChrome
  icon="close"                                 // was "x"
  size={36}
  onPress={handleClose}
  accessibilityLabel="Close partner earnings"   // PRESERVE verbatim
  testID="partner-earnings-close-button"         // PRESERVE verbatim
/>
```

`IconChrome` already enforces I-39 (accessibilityLabel required) and I-38 (44pt target). No other props change.

---

## 4. Shared `ChromeRow` header — exact layout, tokens, styles

Structure (identical to `VenueCreatorWizard` `chrome`, which is itself a close-left dismiss screen):

```
[ IconChrome close ]  [ chromeMid: title (+ optional sub) ]  [ spacer w=36 ]
   36×36, left            flex:1, centered                       balances close
```

### 4.1 brands.tsx header JSX (replaces current lines 108–125)
```tsx
<View style={styles.header}>
  <IconChrome
    icon="close"
    size={36}
    onPress={handleClose}
    accessibilityLabel="Close partner brands"
    testID="partner-brands-close-button"
  />
  <View style={styles.headerMid}>
    <Text style={styles.headerTitle}>Brands</Text>
    {(activeCount > 0 || pendingCount > 0) ? (
      <Text style={styles.headerSub}>
        {activeCount} active · {pendingCount} pending
      </Text>
    ) : null}
  </View>
  <View style={styles.headerRightSlot} />
</View>
```

### 4.2 earnings.tsx header JSX (replaces current lines 196–208)
```tsx
<View style={styles.header}>
  <IconChrome
    icon="close"
    size={36}
    onPress={handleClose}
    accessibilityLabel="Close partner earnings"
    testID="partner-earnings-close-button"
  />
  <View style={styles.headerMid}>
    <Text style={styles.headerTitle}>Earnings</Text>
  </View>
  <View style={styles.headerRightSlot} />
</View>
```

### 4.3 Header styles (both files — replaces `header` / `headerTextCol` / `eyebrow` / `h1` / `headerMeta`)
```ts
header: {
  flexDirection: "row",
  alignItems: "center",
  paddingHorizontal: spacing.md,   // 16
  paddingVertical: spacing.sm,     // 8  (was paddingTop sm / paddingBottom md)
  gap: spacing.sm,                 // 8
},
headerMid: {
  flex: 1,
  alignItems: "center",
},
headerTitle: {
  fontSize: typography.body.fontSize,   // 16
  fontWeight: "700",
  color: textTokens.primary,            // rgba(255,255,255,0.96)
},
headerSub: {                            // brands.tsx only
  fontSize: typography.caption.fontSize, // 12
  color: textTokens.tertiary,           // rgba(255,255,255,0.52)
  marginTop: 2,
},
headerRightSlot: {
  width: 36,                            // mirrors the 36×36 close → true centering
},
```
**DELETE** the old `eyebrow`, `h1`, `headerMeta`, `headerTextCol` styles. The `SafeAreaView edges={["top","bottom"]}` wrapper stays (it already supplies the top inset; only the row inside changes).

> Design note / trade-off: this drops the 26px left-aligned `h1` "hero" title for the 16px centered chrome title. That is the intended loss — the sibling account screens do not use a hero title, so matching them is the whole point. `brands.tsx` retains its count via `headerSub`.

---

## 5. brands.tsx — full redesigned spec, every state

Import add: `import { Button } from "../../src/components/ui/Button";` (alongside existing UI imports). Keep `GlassCard`, `IconChrome`, `Icon`-family tokens.

### 5.1 Loading state (linksQuery.isLoading) — UNCHANGED
`<ActivityIndicator color={accent.warm} />` centered in `styles.center`. On-brand; keep.

### 5.2 Error state (linksQuery.error)
`GlassCard variant="elevated" radius="md" padding={spacing.lg}` →
- `Text style={cardTitle}` "Couldn't load your brands" — `typography.h3`, `textTokens.primary`. Keep.
- `Text style={cardBody}` `{error.message}` — `typography.body`, `textTokens.secondary`. Keep.
- Retry button — **replace** the `secondaryBtn` Pressable (lines 135–141) with:
```tsx
<View style={{ marginTop: spacing.md }}>
  <Button variant="secondary" size="md" label="Retry" onPress={() => linksQuery.refetch()} />
</View>
```

### 5.3 Empty state (sortedRows.length === 0)
`GlassCard variant="elevated" radius="md" padding={spacing.lg}` →
- `cardTitle` "No partner brands yet". Keep.
- `cardBody` "Brands you set up for clients show up here. You'll see them go from invite-sent to live to earning." Keep verbatim.
- CTA — **replace** the `primaryBtn` Pressable (lines 150–158) with:
```tsx
<View style={{ marginTop: spacing.md }}>
  <Button
    variant="primary"
    size="md"
    fullWidth
    label="Set up your first partner brand"
    trailingIcon="chevR"
    onPress={handleSetUpFirst}   // ⚠ PRESERVE handler ref — forensics owns its target (§12)
    accessibilityLabel="Set up your first partner brand"
  />
</View>
```
Copy change justified: the literal `→` in the old label becomes the canonical `chevR` forward-chevron icon (used app-wide for "go forward"); the words are otherwise unchanged. If the implementor prefers ZERO copy change, keep `label="Set up your first partner brand →"` and drop `trailingIcon` — either is acceptable; the icon version is preferred.

### 5.4 Populated state — `BrandLinkRow` list
Each row = `Pressable` → `GlassCard variant="elevated" radius="md" padding={spacing.md}` (add `radius="md"`; keep `variant`/`padding`). Row internals (`rowOuter`, `thumbWrap`, `thumb`, `rowBody`, `brandName`, `statusRow`, `dot`, `statusLabel`, `subText`) are on-brand — **keep all**.

One polish change — `thumbFallback` (letter-avatar when no still cover), to match the `edit-profile` avatar-fallback treatment (softer, not a full-orange disc):
```ts
thumbFallback: {
  backgroundColor: accent.tint,   // was accent.warm  → rgba(235,120,37,0.28)
  alignItems: "center",
  justifyContent: "center",
},
thumbFallbackText: {
  fontSize: 22,
  fontWeight: "800",
  color: accent.warm,             // was "#FFFFFF"  → matches edit-profile initials
},
```
`StatusDot` colors (success/warning/`accent.warm`/tertiary) — keep. `statusLabel`/`subTextFor`/`timeAgo` — keep (pure logic + copy).

### 5.5 brands.tsx style deletions/edits summary
- `safe.backgroundColor`: `canvas.profile` → **`canvas.discover`**.
- DELETE: `eyebrow`, `h1`, `headerMeta`, `headerTextCol`, `primaryBtn`, `primaryBtnText`, `secondaryBtn`, `secondaryBtnText`.
- REPLACE `header` + ADD `headerMid`/`headerTitle`/`headerSub`/`headerRightSlot` per §4.3.
- EDIT `thumbFallback` + `thumbFallbackText` per §5.4.
- KEEP everything else (`scroll`, `center`, `cardTitle`, `cardBody`, `rowOuter`, `thumbWrap`, `thumb`, `rowBody`, `brandName`, `statusRow`, `dot`, `statusLabel`, `subText`).

---

## 6. earnings.tsx — full redesigned spec, every state

Import add: `import { Button } from "../../src/components/ui/Button";`.

### 6.1 Header — per §4.2 / §4.3.

### 6.2 Loading (statusQuery.isLoading) — UNCHANGED
`<ActivityIndicator color={accent.warm} />` in `styles.center`. Keep.

### 6.3 Status-error (statusQuery.error)
`GlassCard variant="elevated" radius="md" padding={spacing.lg}` → title "Couldn't load partner status" + body `{error.message}` (keep). Retry — **replace** `secondaryBtn` Pressable (lines 224–230):
```tsx
<View style={{ marginTop: spacing.md }}>
  <Button variant="secondary" size="md" label="Retry" onPress={() => statusQuery.refetch()} />
</View>
```

### 6.4 Not-a-partner (partner_enabled === false) — UNCHANGED
`GlassCard` "Not a Mingla partner yet" + body with inline `mailto` `link`. Keep (add `radius="md"`).

### 6.5 `StatusBlock` — all 4 Stripe states (add `radius="md"` to each GlassCard; keep the dot+label indicator rows verbatim)

Button mapping — every `Pressable` → `<Button>`; the status-indicator rows, titles, bodies, and `inlineError` pill are **kept**:

| State | Old element | New element |
|---|---|---|
| `active` | `primaryBtn` "Manage Stripe account" (`managing` label swap + `primaryBtnDisabled`) | `<Button variant="primary" size="md" fullWidth label={managing ? "Opening…" : "Manage Stripe account"} loading={managing} disabled={managing || disconnecting} onPress={onManage} accessibilityLabel="Manage Stripe account" />` |
| `active` | `secondaryBtn` + `secondaryBtnTextDanger` "Disconnect Stripe" | `<Button variant="secondary" size="md" fullWidth label={disconnecting ? "Disconnecting…" : "Disconnect Stripe"} labelStyle={{ color: semantic.error }} loading={disconnecting} disabled={disconnecting || managing} onPress={onDisconnect} accessibilityLabel="Disconnect Stripe" />` |
| `restricted` | `primaryBtn` "Resume onboarding" | `<Button variant="primary" size="md" fullWidth label={starting ? "Opening…" : "Resume onboarding"} loading={starting} disabled={starting} onPress={onStart} accessibilityLabel="Resume Stripe onboarding" />` |
| `onboarding` | `primaryBtn` "Resume onboarding" | same as `restricted` row above |
| `not_connected` | `primaryBtn` "Connect bank" / "Pick a country first" | `<Button variant="primary" size="md" fullWidth label={starting ? "Opening…" : selectedCountry === null ? "Pick a country first" : "Connect bank"} loading={starting} disabled={connectDisabled} onPress={onStart} accessibilityLabel="Connect bank" />` |

Notes:
- `loading` renders the built-in `<Spinner>` (layout-stable) — this **replaces** the manual "Opening…"/"Disconnecting…" label swap visually, but keep the ternary labels too (they read under the spinner as the busy label; harmless and preserves copy). Simpler alternative accepted: keep the ternary label, omit `loading`, keep `disabled` — but `loading` is preferred (matches the app's busy affordance).
- `Button`'s `disabled` state renders the muted-grey fill + tertiary label (better than the old `opacity:0.5`). The `connectDisabled` / `managing` / `disconnecting` gating logic is **unchanged** — just fed into `disabled`.
- The "Disconnect" secondary keeps `semantic.error` text via `labelStyle` (mirrors the old `secondaryBtnTextDanger` intent) on the glass `secondary` chrome — no loud solid-red `destructive` fill under the primary action.
- `BrandStripeCountryPicker` in `countryPickerWrap` — **unchanged** (shared component).
- `inlineError` pill (`semantic.errorTint` bg + `semantic.error` border) — **keep verbatim**.

### 6.6 `ReadyToEarnNudge` (active + zero links)
`GlassCard variant="elevated" radius="md" padding={spacing.lg}`. Keep the `nudgeEyebrow` ("✨ READY TO START EARNING?", `accent.warm labelCap`), `cardTitle`, `cardBody`, and the three `nudgeStep` lines (①②③) — this is card-level promotional personality, acceptable and distinct from the removed screen-chrome eyebrow. CTA — **replace** the `primaryBtn` Pressable (lines 298–306):
```tsx
<View style={{ marginTop: spacing.md }}>
  <Button
    variant="primary" size="md" fullWidth
    label="Set up your first partner brand"
    trailingIcon="chevR"
    onPress={() => router.push("/brand/new?partner_mode=client" as never)}  // ⚠ forensics-owned target (§12)
    accessibilityLabel="Set up your first partner brand"
  />
</View>
```

### 6.7 `PortfolioWelcomeToast` — UNCHANGED
`accent.tint` bg + `accent.border` celebratory tap-to-dismiss card, 🎉 copy. On-brand (real accent tokens); keep verbatim.

### 6.8 `PartnerSplitsSection` — cards get `radius="md"`, everything else UNCHANGED
- Loading / error / empty `GlassCard`s → add `radius="md"`.
- "Earnings by currency" card, `currencyRow`s, `filterRow`/`filterChip`(+active `accent.warm`), "Recent splits" card, `SplitRow`, `StatusBadge` (semantic-tint pills) — all keep verbatim. No bespoke buttons here.

### 6.9 earnings.tsx style deletions/edits summary
- `safe.backgroundColor`: `canvas.profile` → **`canvas.discover`**.
- DELETE: `eyebrow`, `h1`, `headerTextCol`, `primaryBtn`, `primaryBtnText`, `primaryBtnDisabled`, `secondaryBtn`, `secondaryBtnText`, `secondaryBtnTextDanger`. (`countryPickerWrap` KEEP.)
- REPLACE `header` + ADD `headerMid`/`headerTitle`/`headerRightSlot` per §4.3 (no `headerSub` needed).
- KEEP: all status-dot/label styles, `cardTitle`, `cardBody`, `link`, `inlineError*`, `currency*`, `filter*`, `split*`, `badge*`, `nudge*`, `welcomeToast*`.
- `shadows` import may become unused after `primaryBtn` deletion — remove from the import if so (TS strict-build will flag).

---

## 7. Two-file latent close swap (in ORCH-1333 scope; NO visual redesign)

Simple glyph correction only — the filled letterform-X is wrong wherever it stands in for a close/cancel ✕. **Change only the `icon` value; touch nothing else.**

**A. `src/components/trip/TripManageMenu.tsx:119`** — the destructive "Cancel trip" menu `Row`:
```tsx
<Row icon="close" label="Cancel trip" destructive … />   // was icon="x"
```

**B. `src/components/venue/VenueCreatorWizard.tsx:579`** — the wizard header close (already the canonical close-left ChromeRow, already has `accessibilityLabel="Close venue setup"`):
```tsx
<IconChrome icon="close" accessibilityLabel="Close venue setup" onPress={onClose} />  // was icon="x"
```
No style, prop, label, or layout change in either file.

---

## 8. Type scale + color token map (redesigned surfaces)

| Element | Type token | Value | Color token | Notes |
|---|---|---|---|---|
| Header title | `typography.body` size + `700` | 16 / 24 lh / 700 | `text.primary` (rgba 255×.96) | centered in `headerMid` |
| Header sub (brands) | `typography.caption` size | 12 | `text.tertiary` (rgba 255×.52) | "N active · M pending" |
| Card title | `typography.h3` | 20 / 32 / 600 | `text.primary` | unchanged |
| Card body | `typography.body` | 16 / 24 / 400 | `text.secondary` (rgba 255×.72) | unchanged |
| Button label (md) | `typography.buttonMd` | 14 / 20 / 600 / +0.2 | `text.inverse` (primary) / `text.primary` (secondary) / `semantic.error` (disconnect) | from `Button` primitive |
| Status label (caps) | `typography.labelCap` | 12 / 16 / 600 / +1.4 | `semantic.*` / `text.tertiary` | unchanged |
| Nudge eyebrow | `typography.labelCap` | 12 / 16 / 600 / +1.4 | `accent.warm` (#eb7825) | card-level, kept |
| Status/split rows | `typography.bodyLg`/`caption`/`micro` | as-is | `text.*` / `semantic.*` | unchanged |

**Screen bg:** `canvas.discover` **#0c0e12** (both). **Cards:** `GlassCard elevated` (white-alpha tint `glass.tint.profileElevated` rgba 255×.06, border `glass.border.profileElevated` rgba 255×.12) — dark theme only (business app is dark-only; no light variant required).

**Contrast (WCAG AA, text on #0c0e12):** primary `rgba(255,255,255,.96)` ≈ 19:1 ✓; secondary `.72` ≈ 10.5:1 ✓; tertiary `.52` ≈ 5.7:1 ✓ (≥4.5 for its ≥12px use). `semantic.success/warning/error/info` caps on dark ✓. **Button primary** = white on `accent.warm` #eb7825 ≈ 2.9:1 — this is the **established, intentional app-wide action pairing** (documented in `designSystem.ts` `ariPalette.userBubble` comment: "brand consistency chosen over the Ari-only 4.5:1 target; white-on-#eb7825 is the established app-wide action pairing"). The partner buttons now **inherit** that exact pairing via the shared `<Button>` — not a new decision, and identical to every other primary CTA in the app. No regression; do not "fix" it.

---

## 9. Motion

All motion is inherited from the shared primitives — **no bespoke animation to author.**
- **Close button** (`IconChrome`): press-in scale → 0.96 over `durations.fast` (120ms) `easings.press`; press-out → 1.0. Light haptic on native press-down. Reduced-motion fallback: opacity → 0.7 (no scale). Built-in.
- **`<Button>`**: identical press-scale 0.96 / 120ms; haptic (native); reduced-motion → opacity 0.7; `loading` swaps leading content for `<Spinner>` (layout-stable); disabled = no motion/haptic.
- **Web hover** (`Button`): bg +6% toward white; `:focus-visible` → 2px `accent.warm` outline, offset 2.
- No content-jump: `fullWidth` buttons and layout-stable loading prevent reflow. GlassCard entry is static (no mount animation today — do not add one).

---

## 10. Accessibility (WCAG AA; invariants I-38 / I-39)

- **I-39** (IconChrome requires `accessibilityLabel`): both close buttons keep their descriptive labels ("Close partner brands" / "Close partner earnings"). Preserved — do not blank them.
- **I-38** (≥44pt target): close `size={36}` + IconChrome's baked `hitSlop {4,4,4,4}` = 44×44 effective. `<Button size="md">` = 44pt height. Both meet the floor.
- **Reading order:** close → title → content (LTR); the `headerRightSlot` is an empty non-focusable spacer (no role). Screen readers announce close as a `button` (IconChrome sets `accessibilityRole="button"`).
- **Buttons:** `<Button>` sets `accessibilityRole="button"` + `accessibilityState={{disabled, busy}}`; explicit `accessibilityLabel` supplied on each CTA above.
- **Color-not-sole-indicator:** status is always dot **+** text label (e.g. "Awaiting Owner", "PAYOUTS READY"); split state is badge text, not color alone. Preserved.
- **One-handed reach:** primary CTAs sit inside cards low in the scroll; close is top-left (natural left-thumb/back position, matching the app's other dismiss screens).
- **Dynamic Type:** all type via tokens; no fixed heights on text rows (card content grows). `Button` label is `numberOfLines={1}` (app-standard) — acceptable at default+large sizes for these short labels.

---

## 11. Per-platform deltas

| Concern | iOS | Android | Web (biz-web, secondary) |
|---|---|---|---|
| GlassCard material | Real `BlurView` (expo-blur), intensity `cardElevated` 34 | `BlurView` renders; **`elevation` zeroed** via `androidSafeElevation` (no hard rectangle bleed) — honors `ANDROID_GLASS_USES_OPAQUE_FALLBACK` | `<768px`: blur killed → opaque fallback `rgba(20,22,26,0.92)` (`GlassChrome.FALLBACK_BACKGROUND`), never see-through |
| Close/Button haptic | Light haptic press-down | Light haptic press-down | none |
| Button hover/focus | n/a | n/a | hover +6% bg; focus-visible `accent.warm` 2px ring |
| Press motion | scale 0.96 | scale 0.96 | scale 0.96 |

**Android glass policy compliance:** the redesign uses **only** `GlassCard`/`IconChrome` (which wrap `GlassChrome`) and introduces **no raw translucent `View` fills**. The opaque-fallback + zeroed-elevation behavior is already encapsulated in the shared components — the invariant is satisfied by construction. Do not add ad-hoc `rgba(...)` backgrounds to any new element.

---

## 12. Coordination guard — forensics ORCH-1332 (route fix) merge safety

Forensics owns the **navigation target** of the "Set up your first partner brand" CTA (today it dead-ends on "Brand not found"). This spec changes only that CTA's **visual shell** (Pressable+Text → `<Button>`), in the SAME two files. To merge both cleanly:

- **Do NOT touch the `onPress` body / handler reference.** In `brands.tsx` keep `onPress={handleSetUpFirst}`; in `earnings.tsx` `ReadyToEarnNudge` keep `onPress={() => router.push("/brand/new?partner_mode=client" as never)}`. Forensics may repoint what those do — leave the handler wiring to them; this spec only reskins the button element around it.
- All redesign edits are **JSX-element + StyleSheet** level (header row, button primitives, canvas token, card radius). They do not overlap the route/handler logic. If forensics edits the same handler line, the two diffs are on different concerns (visual vs navigation) and reconcile trivially.

---

## 13. Files / lines the implementor touches (map)

**`app/partner/brands.tsx`**
- L45: keep `GlassCard` import; **ADD** `Button` import.
- L108–125: **REPLACE** header block → §4.1 ChromeRow (`icon="x"`→`"close"`, close moves left).
- L131–142 (error card): **ADD** `radius="md"`; swap Retry Pressable → `<Button variant="secondary">` (§5.2).
- L143–159 (empty card): **ADD** `radius="md"`; swap CTA Pressable → `<Button variant="primary" trailingIcon="chevR">`, preserve `handleSetUpFirst` (§5.3).
- L194 (`BrandLinkRow` GlassCard): **ADD** `radius="md"`.
- L293 `safe.backgroundColor`: `canvas.profile` → `canvas.discover`.
- L310–322: DELETE `eyebrow`/`h1`/`headerMeta`; REPLACE `header`; ADD `headerMid`/`headerTitle`/`headerSub`/`headerRightSlot`; DELETE `headerTextCol`.
- L333–358: DELETE `primaryBtn`/`primaryBtnText`/`secondaryBtn`/`secondaryBtnText`.
- L374–383: EDIT `thumbFallback` bg → `accent.tint`, `thumbFallbackText` color → `accent.warm` (§5.4).

**`app/partner/earnings.tsx`**
- L62/63: keep `GlassCard`/`IconChrome`; **ADD** `Button` import. (Check `shadows` import — remove if unused after button deletion.)
- L196–208: **REPLACE** header block → §4.2 ChromeRow (`icon="x"`→`"close"`, close moves left).
- L221–231 (status-error card): `radius="md"`; Retry → `<Button variant="secondary">`.
- L233–246 (not-a-partner card): `radius="md"` (else unchanged).
- L289 (nudge card): `radius="md"`; CTA Pressable → `<Button variant="primary" trailingIcon="chevR">`, preserve `router.push` target (§6.6, §12).
- L428/437/462 (splits cards): `radius="md"`.
- L643/682/713/744 (`StatusBlock` cards): `radius="md"`; swap all `primaryBtn`/`secondaryBtn` Pressables → `<Button>` per §6.5 table.
- L790 `safe.backgroundColor`: `canvas.profile` → `canvas.discover`.
- L800–816: DELETE `eyebrow`/`h1`/`headerTextCol`; REPLACE `header`; ADD `headerMid`/`headerTitle`/`headerRightSlot`.
- L870–905: DELETE `primaryBtn`/`primaryBtnText`/`primaryBtnDisabled`/`secondaryBtn`/`secondaryBtnText`/`secondaryBtnTextDanger`. KEEP `countryPickerWrap`.

**`src/components/trip/TripManageMenu.tsx`** — L119: `icon="x"` → `icon="close"` (only).
**`src/components/venue/VenueCreatorWizard.tsx`** — L579: `icon="x"` → `icon="close"` (only).

(Line numbers are as-read on the freshly-rebased branch; treat as anchors, match on content.)

---

## 14. ASCII mockups (before → after)

### brands.tsx — header + empty state
```
BEFORE                                   AFTER
┌──────────────────────────────┐        ┌──────────────────────────────┐
│ MINGLA PARTNER          ✕(X) │        │   (✕)      Brands        · ·  │   ← close LEFT, thin ✕,
│ Brands                       │        │           1 active · 2 pend   │     centered 16/700 title
│ 1 active · 2 pending         │        ├──────────────────────────────┤     + 12px tertiary sub
├──────────────────────────────┤        │ ╭──────────────────────────╮ │
│ ╭──────────────────────────╮ │        │ │ No partner brands yet    │ │
│ │ No partner brands yet    │ │        │ │ Brands you set up for    │ │
│ │ Brands you set up for …  │ │        │ │ clients show up here …   │ │
│ │ ┌──────────────────────┐ │ │        │ │ ┌──────────────────────┐ │ │
│ │ │ Set up your first  → │ │ │        │ │ │ Set up your first  › │ │ │   ← shared <Button> pill,
│ │ └──────────────────────┘ │ │        │ │ └──────────────────────┘ │ │     chevR icon
│ ╰──────────────────────────╯ │        │ ╰──── radius md ──────────╯ │
└── canvas.profile #141113 ────┘        └── canvas.discover #0c0e12 ──┘
   X = filled letterform glyph              ✕ = thin two-stroke close glyph
```

### earnings.tsx — header + not_connected
```
BEFORE                                   AFTER
┌──────────────────────────────┐        ┌──────────────────────────────┐
│ MINGLA PARTNER          ✕(X) │        │   (✕)      Earnings          │
│ Earnings                     │        ├──────────────────────────────┤
├──────────────────────────────┤        │ ╭──────────────────────────╮ │
│ ╭──────────────────────────╮ │        │ │ ● NOT CONNECTED          │ │  ← dot+label kept
│ │ ● NOT CONNECTED          │ │        │ │ Connect partner Stripe   │ │
│ │ Connect partner Stripe   │ │        │ │ Mingla pays partners …   │ │
│ │ [ country picker ]       │ │        │ │ [ country picker ]       │ │  ← unchanged
│ │ ┌──────────────────────┐ │ │        │ │ ┌──────────────────────┐ │ │
│ │ │  Pick a country first│ │ │        │ │ │  Pick a country first│ │ │  ← <Button> disabled
│ │ └── orange rect ───────┘ │ │        │ │ └── pill, muted-grey ─┘ │ │     = grey, not dim-orange
│ ╰──────────────────────────╯ │        │ ╰──── radius md ──────────╯ │
└──────────────────────────────┘        └──────────────────────────────┘
```

---

## 15. Missing tokens / blockers

**None.** Every value resolves to an existing token or a real component prop. No new token is required; `chevR` and `close` glyphs both exist in `Icon.tsx`; the shared `Button` and `IconChrome` cover all button/close needs. The redesign is fully buildable as specified.
