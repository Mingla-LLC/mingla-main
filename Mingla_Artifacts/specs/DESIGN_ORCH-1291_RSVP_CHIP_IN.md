# DESIGN — ORCH-1291 [rsvp-chip-in]

Pixel-precise design contract for the RSVP voluntary chip-in feature. Binds the two UI surfaces the implementor builds in SPEC §8 steps 7–8:

1. **Guest chip-in** in the shared body `packages/offering-rendering/RsvpOfferingBody.tsx` (reaches all 5 surfaces).
2. **Business RSVP-wizard control** (toggle + suggested/min fields + inline provider-aware bank-connect) in `mingla-business/src/components/rsvp/RsvpStep5Setup.tsx`.

Phase: DESIGN. Author: mingla-designer (Claude). Date: 2026-07-03.
Contract chain: `INVESTIGATION_ORCH-1291_RSVP_CHIP_IN.md` → `SPEC_ORCH-1291_RSVP_CHIP_IN.md` (§4.6, §5) → **this doc** → IMPLEMENT.
Satisfies SPEC §5 UX-observable criteria SC-1, SC-2 (+iOS/Android/Web), SC-5, SC-6 (+Stripe/Paystack), SC-7.
COMMS acked: **COMMS-0021** (seller-surface copy neutralized "Connect Stripe"→"Connect bank") — the wizard connect flow uses "Connect bank" / "Set up bank transfer", never "Connect Stripe".

Product forks designed-around (do NOT block — conductor is getting Seth's answers):
- **Q-B fee incidence** — designed for the DEFAULT (organiser absorbs; guest charged EXACTLY the typed amount, WYSIWYG). The amount-confirmation is ONE swappable string (`§4.4 CONFIRM_LINE`). If Seth flips to guest-covers-fees it is a microcopy change only.
- **Q-D entry point** — PRIMARY flow is chip-in AFTER RSVP, linked to the guest's RSVP. The amount UI is a **self-contained `<RsvpChipInPanel>` block** so a future standalone "tip-jar" entry can reuse it verbatim (design annotation only — no second entry point built now).

---

## 0. Design intent (the moment)

The guest just committed — they tapped **Going** and saw *"You're going! 🎉"*. Emotionally they are *in, warm, and generous*. The chip-in is the **gift moment**, not a checkout. It must read as *"want to throw in for this?"* — light, optional, celebratory — NEVER as a paywall, ticket, cart, or tax invoice. The free RSVP is already locked; the chip-in can be ignored with zero cost.

Two hard emotional guardrails, enforced in copy + form:
- **No commerce language anywhere.** Banned strings: `buy`, `ticket`, `checkout`, `cart`, `purchase`, `order`, `price`, `tax`, `VAT`, `fee`, `total due`, `pay now`. Allowed: `chip in`, `give`, `contribution`, `gift`, `throw in`, `Secure payment` (web hosted-page label only).
- **Never a dead end.** The section only appears when it can succeed (config-enabled ⇒ brand passed the publish bank-gate). If the money rail dies mid-flow (live `brand_cannot_collect` 409) it degrades to a soft paused note, never a broken button.

---

## 1. IA & flow

### 1.1 Guest — where the affordance lives (two entry points, ONE panel)

The reusable `<RsvpChipInPanel>` (new component in `packages/offering-rendering/`) is mounted in **two** places, both reading ONE lifted chip-in state (added to `useRsvpOfferingState`, mirroring the existing RSVP state machine so the two mounts never diverge or double-charge):

| Entry point | Where | When it shows | Role |
|---|---|---|---|
| **A. Primary — success popup** | `RsvpSuccessPopup.tsx`, appended below the detail rows, above the Done button | `config.rsvp_contribution_enabled` AND resolved status ∈ {going, pending} | The high-intent "you're in — want to chip in?" moment |
| **B. Persistent — inline body section** | New `RsvpOfferingBody` section **§5.5**, between the §5 decision box and §6 Presented By | `config.rsvp_contribution_enabled` AND `guestStatus` ∈ {going, maybe, waitlisted, pending} | Lets a guest who dismissed the popup (or returns later, or came via web redirect) still chip in |

Both mounts share state → once one is `submitting`/`paid`, the other reflects it. On WEB redirect return the surface passes `contributionState='paid'` and both render the thank-you (SC-7).

**Canonical-order safety (build constraint):** §5.5 is inserted strictly *after* the `orch-1163-rsvp-inline-box` anchor and *before* the §6 brand `View` (`orch-1157-rsvp-brand`). It is gated so it renders `null` in the default free flow — the canonical-order gate's existing anchors keep their relative order. New anchor: `orch-1291-rsvp-chipin-section`.

### 1.2 Guest — state machine (the panel)

```
                config flag false / brand_cannot_collect (render gate)
                          │
                          ▼  (never mounts)               ┌──────── error ───────┐
   idle ──type/tap──▶ entering ──"Chip in £X"──▶ submitting ──resolve──▶ success  │
    ▲  preset preselected      │ below floor            │ (native sheet / web     │ │
    │  (live amount shown)     └─ blocked + hint        │  redirect / paystack)   │ │
    └──────────────── retry ◀──────────────────────────┴─────────────────────────┘ │
                                                          paused (live 409) ◀────────┘
```

- **idle** — panel visible, a preset preselected so the primary button shows a live amount immediately. Free-form input empty (mirrors the preset).
- **entering** — guest typing free-form or tapping a preset. Live amount drives the button label + CONFIRM_LINE.
- **below-floor (sub-state of entering)** — amount `< rsvp_contribution_min_cents`: primary DISABLED, floor hint turns danger.
- **submitting** — button → spinner + "Sending…", inputs locked, presets non-interactive.
- **success** — panel cross-fades to the thank-you state (heart pop + "Thank you 💛").
- **error** — inline danger line under the button; amount preserved; button re-enabled (retry).
- **paused** — only reachable if a live `brand_cannot_collect` 409 comes back mid-flow (brand disabled payouts after publish): panel body swaps to a one-line soft note "Chipping in is paused for this event." No input, no button.

### 1.3 Guest — payment hand-off contract (`onChipIn`)

The body is payment-SDK-agnostic (I-MOR-0827 package isolation). It calls a new prop:

```ts
onChipIn: (input: { amountCents: number }) => Promise<ChipInResult>;
type ChipInResult =
  | { kind: "paid" }         // native PaymentSheet completed OR paystack verified → show success
  | { kind: "redirecting" }; // web/mobile-web: surface is navigating to hosted page → hold "submitting"
// throws Error(code) on failure; body maps code → error copy (mapChipInError, §4.7)
```

- **Native (consumer iOS/Android, business iOS/Android):** surface handler opens Stripe PaymentSheet (Stripe brand) or `openBrowserAsync(authorization_url)` (Paystack). On completion resolves `{kind:'paid'}` → body shows **success**.
- **Web (buyer/anon):** handler returns `{kind:'redirecting'}` and navigates to hosted Stripe Checkout / Paystack `authorization_url`. Body holds **submitting** ("Opening secure payment…") until the redirect leaves. On return the surface re-mounts with `contributionState='paid'` → **success**.

New optional prop `contributionState?: 'idle' | 'paid'` (default `idle`) lets the web return + the business preview drive terminal state without a callback round-trip.

### 1.4 Business — wizard flow

`RsvpStep5Setup.tsx` gains a **"Contributions"** field block (placed after §4 Approvals, before §5 guest-list privacy — money settings cluster together). Flow:

```
toggle OFF ─tap─▶ toggle ON ──▶ reveal: [Suggested amount] [Minimum] 
                                   │
                         canCollect? ── yes ──▶ (ready — publish allowed)
                                   │
                                   └─ no ──▶ CONNECT CALLOUT
                                            connect-needed ─tap─▶ connecting ─return─▶ re-check
                                                                                    ├─ ok ─▶ connected ✓
                                                                                    └─ still no ─▶ connect-needed
```

Toggling ON is **never blocked** by missing bank (the guest can configure now, connect later). The hard block lives at PUBLISH (SPEC §4.1 gate → RsvpStep7Preview / publish shows the fail-close reason SC-6). The wizard callout is the *friendly early nudge* to connect.

---

## 2. Layout & spacing grid

Grid: the shared body uses a 4/8 rhythm with section `marginTop: 24`. The wizard uses the business `spacing` scale (`xxs2 / xs4 / sm8 / md16 / lg24 / xl32`). Every value below is exact.

### 2.1 Guest panel `<RsvpChipInPanel>` (themed palette)

Matches the momentum card's shell exactly (radius 20 / padding 18) so it reads as a sibling of the RSVP hero, not a bolted-on form.

| Element | Property | Value |
|---|---|---|
| Section wrapper (§5.5 inline) | `marginTop` | `24` (reuse `styles.section`) |
| Panel card | `borderRadius` / `borderWidth` / `padding` | `20` / `1` / `18`; `overflow:'hidden'` |
| Panel card | `backgroundColor` | `opaqueCardFill(palette)` (iOS `opaqueSurfaceColor`; Android `palette.page`) |
| Panel card | `borderColor` | `palette.panelBorder` |
| Heading → sub gap | `marginTop` | `4` |
| Sub → presets gap | `marginTop` | `14` |
| Presets row | `flexDirection:'row'`, `flexWrap:'wrap'`, `gap` | `8` |
| Preset chip | `minHeight` / `paddingH` / `paddingV` / `radius` / `borderWidth` | `44` / `16` / `11` / `999` / `1` |
| Presets → free-form gap | `marginTop` | `12` |
| Free-form field | `minHeight` / `paddingH` / `radius` / `borderWidth` | `52` / `14` / `14` / `1` |
| Field → floor-hint gap | `marginTop` | `6` |
| Floor-hint → confirm gap | `marginTop` | `10` |
| Confirm → primary button gap | `marginTop` | `12` |
| Primary button | `minHeight` / `radius` | `52` / `16`; `alignItems/justifyContent:'center'` |
| Web microcopy | `marginTop` | `10`, row `gap:6`, `alignItems:'center'` |
| Error line | `marginTop` | `10` |

### 2.2 Success (thank-you) sub-layout

Centered column inside the same card: heart glyph (28×28) → `marginTop 12` heading → `marginTop 6` body line → `marginTop 4` amount echo. `alignItems:'center'`, `paddingVertical:6`.

### 2.3 Wizard "Contributions" block (business `designSystem`)

| Element | Property | Value |
|---|---|---|
| Field block wrapper | `marginTop`/`marginBottom` | `spacing.sm(8)` / `spacing.md(16)` (reuse `styles.field`) |
| Field label "Contributions" | reuse `styles.fieldLabel` | `caption`, `text.secondary`, `marginBottom spacing.xs(4)` |
| Toggle row | reuse existing `ToggleRow` | full existing spec (row `paddingV/H spacing.md`, radius `radius.md(12)`) |
| Revealed money field row | `paddingV`/`paddingH`/`radius`/`borderWidth` | `spacing.sm(8)` / `spacing.md(16)` / `radius.md(12)` / `1`; `ROW_BG` bg; `overflow:'hidden'`; `marginBottom spacing.sm(8)` |
| Money field helper | reuse `styles.helper` | `caption`, `text.tertiary`, `marginTop spacing.sm` |
| Connect callout card | `padding`/`radius`/`borderWidth` | `spacing.md(16)` / `radius.lg(16)` / `1`; `marginTop spacing.sm(8)`; `overflow:'hidden'` |
| Callout heading → sub gap | `marginTop` | `spacing.xxs(2)` |
| Callout sub → button gap | `marginTop` | `spacing.md(16)` |
| Callout button | `minHeight`/`radius` | `48` / `radius.md(12)` |

---

## 3. Type scale

### 3.1 Guest panel (shared body — uses `boldFontFamily(theme)` for heavy text; RN inline colors are hex/rgba only)

| Text | size / lineHeight / weight / letterSpacing | Color token |
|---|---|---|
| Panel heading ("Chip in for {host}") | `17 / 22 / 900 / -0.2`, `fontFamily: boldFamily` | `palette.primaryText` |
| Panel sub ("Totally optional — …") | `13 / 18 / 700` | `palette.secondaryText` |
| Preset chip label | `15 / — / 800`, `fontFamily: boldFamily` | selected `palette.accentText` / else `palette.primaryText` |
| Currency prefix (free-form) | `20 / — / 900`, `fontFamily: boldFamily` | `palette.primaryText` |
| Free-form input text | `20 / — / 800` | `palette.primaryText`; placeholder `palette.tertiaryText` |
| Floor hint | `12 / 16 / 700` | ok: `palette.tertiaryText` · below: `#ef4444` |
| CONFIRM_LINE ("You'll give £10.00") | `13 / 18 / 700` | `palette.secondaryText` |
| Primary button label | `16 / — / 900`, `fontFamily: boldFamily` | enabled `palette.accentText` / disabled `palette.tertiaryText` |
| Web secure microcopy | `12 / 16 / 600` | `palette.tertiaryText` |
| Error line | `13 / 18 / 700` | `#ef4444` |
| Success heading ("Thank you 💛") | `18 / 24 / 900`, `fontFamily: boldFamily` | `palette.primaryText` |
| Success body + amount echo | `13 / 19 / 700` | `palette.secondaryText` |

Dynamic Type: all `<Text>` scale with the OS; the panel card has no fixed height (content-sized) and the presets `flexWrap` — larger type reflows, never clips. The free-form field `minHeight:52` grows if the input line wraps.

### 3.2 Wizard (business `typography` tokens)

| Text | token | Color |
|---|---|---|
| Block label "Contributions" | `caption` (12/16/500, +0.2) | `text.secondary` |
| Toggle label | `bodySm` (14/20) weight `500` | `text.primary` |
| Toggle sub | `caption` | `text.tertiary` |
| Money field label | `bodySm` weight `500` | `text.primary` |
| Currency prefix + input | `bodyLg` (18/28) weight `700`, `fontVariant:['tabular-nums']` | `text.primary`; placeholder `text.tertiary` |
| Money field helper / cross-field hint | `caption` | helper `text.tertiary` · hint-error `#f59e0b` |
| Callout heading | `bodySm` weight `600` | `text.primary` |
| Callout sub | `caption` | `text.secondary` |
| Callout button label | `buttonMd` (14/20/600, +0.2) | `#0b0b0d` on accent / `text.primary` on tint |

---

## 4. Color & token mapping

### 4.1 Guest panel — themed (derives from the brand accent; the palette engine already guarantees contrast)

The palette engine (`createThemePalette`) runs `contrastAdjustedForWhiteText(accent, 4.5)` so **`palette.accent` on `palette.accentText` (#ffffff) is ALWAYS ≥ 4.5:1** — the primary button + selected chip text pass WCAG AA by construction, for any brand color, light or dark theme. No raw hex accent in the panel — all accent comes from `palette`.

| Surface | Light theme (example accent #eb7825) | Dark theme | Contrast |
|---|---|---|---|
| Panel card fill | `opaqueSurfaceColor(palette)` ≈ near-white tinted | ≈ near-black tinted | body text `palette.primaryText` ≥ 7:1 (engine picks `#000`/`#fff` by luminance) |
| Preset chip (unselected) | `opaqueCardFill` + `palette.panelBorder` | same | primaryText ≥ 7:1 |
| Preset chip (selected) | `palette.accent` + accentText `#ffffff` | same | ≥ 4.5:1 (engine-guaranteed) |
| Free-form field | `palette.page` fill + `palette.panelBorder` | same | input ≥ 7:1 |
| Free-form field (below-floor) | border `#ef4444` | `#ef4444` | 3:1 non-text indicator + danger hint text |
| Primary button (enabled) | `palette.accent` / text `#ffffff` | same | ≥ 4.5:1 |
| Primary button (disabled) | `opaqueCardFill` / text `palette.tertiaryText` | same | dimmed by design; disabled state also announced via `accessibilityState` |
| Danger (error line, floor-fail, field border) | `#ef4444` | `#ef4444` | on card ≥ 4.5:1 both themes (matches existing `errorText`/`fieldError`) |
| Success heart / amount accent | `palette.accent` | same | decorative + text label (color not sole indicator) |

Reduced-motion + color-blind safety: every state carries a **non-color** signal too — below-floor shows the hint *text*, error shows the *message*, selected preset shows a *filled* shape (not just hue), success shows the *heart glyph + words*.

### 4.2 Wizard — business dark theme (`designSystem`)

| Surface | Token | Value |
|---|---|---|
| Money field row bg | `ROW_BG` | iOS `glass.tint.profileBase` / Android `#23262b` (opaque) |
| Money field border | `glass.border.profileBase` | `rgba(255,255,255,0.08)` |
| Currency prefix / input text | `text.primary` | `rgba(255,255,255,0.96)` — ≥ 12:1 on `#23262b` |
| Toggle track (on) | `accent.warm` | `#eb7825` |
| Cross-field hint (min>suggested) | warning | `#f59e0b` on `ROW_BG` ≥ 4.5:1 |
| Connect callout — **connect-needed** | bg `semantic.warningTint` `rgba(245,158,11,0.18)`; border `rgba(245,158,11,0.45)` | heading `text.primary` (white ≥ 4.5:1 on tint over dark canvas); a warning dot/icon `#f59e0b` |
| Connect callout — **connecting** | same warningTint; button → spinner | — |
| Connect callout — **connected** | bg `semantic.successTint` `rgba(34,197,94,0.18)`; border `rgba(34,197,94,0.45)`; check icon `#22c55e` | heading `text.primary` |
| Connect callout — **error** | bg `semantic.errorTint` `rgba(239,68,68,0.18)`; border `rgba(239,68,68,0.45)`; icon `#ef4444` | heading `text.primary` |
| Callout button (accent) | `accent.warm` `#eb7825`, label `#0b0b0d` | ≥ 7:1 |

Color is never the sole state signal: connect-needed vs connected also differ by **icon (warning triangle vs check)** and **copy** ("Connect your bank" vs "Bank connected").

### 4.3 Currency-aware formatting (both surfaces)

Reuse the package's proven `Intl.NumberFormat` pattern (with try/catch fallback, per `useTripOfferingState.formatTripPrice`). Two formatters:

```ts
// Presets + button + wizard fields → whole-number, symbol-prefixed.
const fmtWhole = (cents: number, currency: string) => {
  try { return new Intl.NumberFormat(undefined, {
    style: "currency", currency: currency || "USD", maximumFractionDigits: 0,
  }).format(cents / 100); } catch { return `${Math.round(cents / 100)} ${currency}`; }
};
// CONFIRM_LINE → standard fraction digits for the currency (GBP/USD=2, NGN=0 via Intl).
const fmtExact = (cents: number, currency: string) => {
  try { return new Intl.NumberFormat(undefined, {
    style: "currency", currency: currency || "USD",
  }).format(cents / 100); } catch { return `${(cents / 100).toFixed(2)} ${currency}`; }
};
```

`currency` = the brand settlement currency from `resolve_event_pricing_inputs` (surfaced to the body via the config; e.g. `GBP`, `USD`, `NGN`). Locale = `undefined` (device locale) so symbol placement + grouping follow the guest's locale. The free-form input is entered in **major units** (the field shows the symbol prefix; the guest types `10`), converted to `amountCents = Math.round(parseFloat(input) * 100)` before `onChipIn`.

### 4.4 CONFIRM_LINE (single swappable string — fee-incidence fork Q-B)

Default (organiser absorbs, WYSIWYG):
> **You'll give {fmtExact(amountCents, currency)}.**

This is the ONLY place the fee model is user-visible. If Seth flips to guest-covers-fees, swap this one string to `You'll pay {buyerTotal} — {amount} goes to {host}.` No layout change. Keep it as a named constant `CONFIRM_LINE(amountCents)` so the flip is one edit.

### 4.5 Preset ladder derivation (deterministic — no implementor guessing)

```
if rsvp_contribution_suggested_cents is set:
    presets = [1×, 2×, 5×] of suggested   // clean multiples stay clean
    preselect = the 1× (suggested) chip
else:
    presets by currency bucket (major units):
        NGN               → [1000, 2500, 5000]
        all others (GBP/USD/EUR/…) → [5, 10, 25]
    preselect = the middle chip
```
A trailing **"Other"** chip is ALWAYS present; tapping it clears the selection and focuses the free-form input. If a `min` floor is set and a derived preset falls below it, drop that preset (keep ≥1) so no preset is ever un-payable.

### 4.6 Copy deck (Mingla voice — final microcopy routes to mingla-product per SPEC §2.9, these are the design placeholders)

| Slot | String |
|---|---|
| Panel heading | `Chip in for {hostShortName}` (fallback `Chip in`) |
| Panel sub | `Totally optional — your RSVP's already locked in.` |
| "Other" chip | `Other` |
| Free-form placeholder | `0` |
| Floor hint (ok) | `Any amount helps.` (or `Minimum {fmtWhole(min)}` when a floor is set) |
| Floor hint (below) | `Add at least {fmtWhole(min)}.` |
| CONFIRM_LINE | `You'll give {fmtExact(amount)}.` |
| Primary button (idle/entering) | `Chip in {fmtWhole(amount)}` |
| Primary button (submitting) | `Sending…` |
| Web secure microcopy | `Secure payment — you'll finish on a secure page.` |
| Success heading | `Thank you 💛` |
| Success body | `You chipped in {fmtExact(amount)} to {hostShortName}.` |
| Paused note | `Chipping in is paused for this event.` |
| Wizard toggle label | `Let guests chip in` |
| Wizard toggle sub | `Guests can add a voluntary gift after they RSVP. Their RSVP stays free.` |
| Wizard suggested label | `Suggested amount (optional)` |
| Wizard min label | `Minimum contribution (optional)` |
| Wizard min helper | `Guests can't chip in less than this.` |
| Cross-field hint | `Minimum can't be more than the suggested amount.` |
| Callout heading (needed) | `Connect your bank to collect contributions` |
| Callout sub (needed) | `Guests can chip in once your payouts are set up.` |
| Callout button (Stripe) | `Connect bank` |
| Callout button (Paystack/NG) | `Set up bank transfer` |
| Callout heading (connected) | `Bank connected` |
| Callout sub (connected) | `You're ready to collect contributions.` |
| Callout error | `Couldn't start bank setup. Try again.` |

### 4.7 Error mapping (`mapChipInError`, mirrors the body's existing `mapErrorCode`)

| Server code (SPEC §4.2) | Guest copy |
|---|---|
| `brand_cannot_collect` | → **paused** state, note `Chipping in is paused for this event.` |
| `amount_below_min` | `Add at least {fmtWhole(min)}.` (returns to entering, floor hint danger) |
| `amount_invalid` | `Enter an amount to chip in.` |
| network / unknown | `Couldn't process that. Try again.` |

---

## 5. Every interactive state (exhaustive)

### 5.1 Preset chip
- **default (unselected):** `opaqueCardFill` + `panelBorder`, primaryText.
- **selected:** `palette.accent` fill + accent border + accentText; scale-bounce on select (§6).
- **press (web hover):** opacity `0.9`; web `cursor:'pointer'`, outline on focus.
- **focus (keyboard/web):** 2px `palette.accent` focus ring (`outline`), offset 2px.
- **disabled (submitting):** `opacity:0.5`, non-interactive, `accessibilityState.disabled`.

### 5.2 Free-form input
- **default:** `palette.page` fill + `panelBorder`. Symbol prefix always visible.
- **focus:** border → `palette.accent`, 1.5px.
- **below-floor:** border → `#ef4444`; floor hint danger.
- **disabled (submitting):** `opacity:0.6`, `editable={false}`.
- keyboardType `decimal-pad` (iOS) / `numeric` (Android); `returnKeyType:'done'`; strips non-numeric on change.

### 5.3 Primary button
- **enabled:** `palette.accent` / accentText; press → `opacity:0.9` + `scale:0.98` (150ms).
- **disabled (no amount / below floor / paused):** `opaqueCardFill` / tertiaryText; `accessibilityState.disabled:true`.
- **submitting:** shows `<ActivityIndicator color={accentText}/>` + "Sending…"; whole panel inert.
- **web:** same, plus the secure microcopy row below.

### 5.4 Panel-level
- **idle / entering / submitting / success / error / paused** — per §1.2. `success` and `paused` REPLACE the input+button region (cross-fade), never stack a second CTA.

### 5.5 Wizard toggle + fields
- toggle **off:** revealed fields + callout NOT rendered.
- toggle **on:** fields slide in (LayoutAnimation), callout appears iff `!canCollect`.
- money field **empty:** placeholder; treated as "not set" (nullable).
- money field **cross-field invalid (min>suggested):** amber hint under the min field; does NOT block toggle or publish (soft), matches the wizard's existing soft cross-field pattern.

### 5.6 Connect callout
- **connect-needed:** warningTint card + button (idle).
- **connecting:** button → `<ActivityIndicator/>` + "Opening…"; card stays warningTint; the rest of the wizard remains scrollable.
- **connected:** card flips to successTint + check + connected copy; button removed. (Driven by re-checking `pg_brand_can_collect` on `openAuthSessionAsync` dismiss.)
- **error:** card → errorTint + error copy + button reverts to "Try again".

---

## 6. Motion spec

All motion uses RN `Animated` + `LayoutAnimation` (no new dep). Every animation has a `prefers-reduced-motion` fallback (read via `AccessibilityInfo.isReduceMotionEnabled()` — the app already has this utility path).

| # | Trigger | Property | Curve | Duration | Reduced-motion fallback |
|---|---|---|---|---|---|
| M1 | §5.5 inline section mounts (guest just went Going) | `opacity 0→1` + `translateY 8→0` | `Easing.out(Easing.cubic)` | `280ms` | opacity-only, `0ms` translate |
| M2 | Preset chip select | `scale 1→0.96→1` + haptic `selectionAsync` | spring `{tension:300,friction:12}` | ~`180ms` | no scale; keep haptic + fill |
| M3 | Below-floor → valid (button enables) | button bg cross-fade dim→accent | `Easing.inOut(Easing.ease)` | `160ms` | instant swap |
| M4 | Submit tap | button label → spinner | opacity `150ms` | `150ms` | instant |
| M5 | success cross-fade | panel body `opacity 1→0` then thank-you `opacity 0→1` | `Easing.inOut(Easing.ease)` | `200ms` each | instant swap |
| M6 | success heart pop | heart `scale 0→1` + `opacity 0→1` | spring `{tension:200,friction:10}` | ~`400ms` | render at `scale:1`, no pop |
| M7 | wizard fields reveal on toggle-on | height/opacity | `LayoutAnimation.easeInEaseOut` (matches the body's about-toggle 200ms) | `200ms` | `LayoutAnimation` still fine; if reduced-motion, skip `configureNext` |
| M8 | connect callout state flip (needed→connected) | bg color + icon cross-fade | `Easing.inOut(Easing.ease)` | `220ms` | instant swap |

No looping/attention motion in the panel (the momentum kicker already owns the one pulsing dot on the page — a second looping animation would compete). The chip-in is calm on purpose.

---

## 7. Accessibility

- **Contrast:** primary button + selected chip ≥ 4.5:1 (engine-guaranteed, §4.1); body/hint/error text ≥ 4.5:1 both themes; wizard white-on-tint ≥ 4.5:1. No text relies on color alone.
- **Touch targets:** preset chips `minHeight:44`; free-form field `52`; primary button `52`; callout button `48`; wizard toggle inherits the existing ≥44 row. All ≥ 44pt.
- **Roles & labels:**
  - Preset chip → `accessibilityRole="button"`, `accessibilityState={{selected}}`, label `Chip in {fmtWhole(amount)}`.
  - "Other" chip → label `Enter a custom amount`.
  - Free-form input → `accessibilityLabel="Contribution amount in {currencyName}"` (currency spoken, not just the symbol glyph).
  - Primary button → label `Chip in {fmtWhole(amount)}`; when disabled-below-floor, `accessibilityHint="Add at least {fmtWhole(min)}"`.
  - Success → `accessibilityLiveRegion="polite"` (Android) / `AccessibilityInfo.announceForAccessibility` (iOS) announces "Thank you, you chipped in {amount}".
  - Error → announced politely; focus moves to the error line.
  - Wizard toggle → existing `accessibilityRole="switch"` + `accessibilityState.checked`.
  - Callout button → `accessibilityRole="button"`, label per provider ("Connect bank" / "Set up bank transfer").
- **Reading order:** heading → sub → presets → amount input → floor hint → confirm line → button → (web) secure note. Matches visual order.
- **Reduced motion:** every M# has a fallback (§6).
- **One-handed reachability:** in the success popup (primary entry) the panel sits directly above the thumb-zone Done button; the inline §5.5 section is reachable by scroll. The primary "Chip in" button is the largest tap target and lives at the panel bottom (thumb zone within the card).
- **Keyboard (web):** all chips + input + button are tabbable with a visible 2px accent focus ring; Enter submits from the input.

---

## 8. Per-platform deltas (Cross-Surface Impact Declaration — MANDATORY, mirrors SPEC §3)

| # | Surface | Guest chip-in delta | Payment hand-off | Notes |
|---|---|---|---|---|
| 1 | **Consumer iOS** | Panel card = **translucent** `opaqueSurfaceColor(palette)` over the native blur; `decimal-pad` keyboard; `Haptics.selectionAsync` on preset select | Stripe → native **PaymentSheet**; Paystack → `openBrowserAsync` | AUTOMATIC via shared body + thin `onChipIn` handler in `ConsumerEventDetailScreen.tsx` |
| 2 | **Consumer Android** | Panel card = **OPAQUE** `palette.page` fill, `overflow:'hidden'`, **NO shadow under the rounded fill** (ANDROID_GLASS_USES_OPAQUE_FALLBACK); `numeric` keyboard; haptic ok | same as iOS | AUTOMATIC; `opaqueCardFill()` already branches on `Platform.OS==='android'` |
| 3 | **Buyer/anon Web** | Panel identical (react-native-web); **no native payment sheet** — button leads to a **redirect**; shows the **secure-payment microcopy** (`§4.6`); focus rings + `cursor:pointer` | `{kind:'redirecting'}` → hosted Stripe Checkout / Paystack `authorization_url`; return → `contributionState='paid'` → success | AUTOMATIC (shared body). SC-7 anon path |
| 4 | **Business iOS** (organiser) | Sees the guest panel in **preview** (inert — `preview` prop; tap shows "Preview — guests will pay here", no charge); AUTHORS via the wizard | wizard connect → `openAuthSessionAsync` (Stripe/Paystack) | Wizard = MANUAL business code (`RsvpStep5Setup.tsx`) |
| 5 | **Business Android** | same as business iOS; Android opaque fallback on both the preview panel AND the wizard rows (`ROW_BG` `#23262b`) | same | MANUAL (same codebase → parity) |
| 6 | **Admin Web** | NONE (authoring not in admin; read-only visibility is META-ORCH-1237) | — | out of scope |
| 7 | **Business Web preview** | Renders the shared body incl. §5.5 in preview mode (host preview) | inert | AUTOMATIC (inherits body) |

**iOS vs Android glass (explicit both-sides values):**
- iOS panel card: `backgroundColor: opaqueSurfaceColor(palette)` (composited-opaque; the R4 fix already removed see-through on web/iOS), border `palette.panelBorder`, no forced shadow.
- Android panel card: `backgroundColor: palette.page` (raw opaque), `overflow:'hidden'`, **no `elevation`/shadow** (a square halo would show under the rounded fill). This is exactly what `opaqueCardFill(palette)` returns — reuse it; do not hand-roll.
- Wizard rows: `ROW_BG = Platform.select({ ios: glass.tint.profileBase, android:'#23262b' })` — reuse the existing constant in `RsvpStep5Setup.tsx`.

**Native vs web:** native completes in-app (PaymentSheet/browser) and resolves `{kind:'paid'}`; web navigates away (`{kind:'redirecting'}`) and returns to `paid`. The ONLY visible difference is the web secure-microcopy line — same layout otherwise.

**Business vs consumer:** identical guest panel (shared body). Business surfaces additionally render it in `preview` (inert) and own the wizard. Consumer never sees the wizard.

---

## 9. Build-ready handoff

### 9.1 New component `packages/offering-rendering/RsvpChipInPanel.tsx`
Pure-presentational, props-only, package-isolated (no app `src/` import), renders on RN + react-native-web. Props:

```ts
export interface RsvpChipInPanelProps {
  palette: ThemePalette; theme: ResolvedTheme;
  currency: string;                       // brand settlement currency
  hostShortName: string;                  // brand display name (fallback "the host")
  suggestedCents: number | null;
  minCents: number | null;
  state: "idle" | "entering" | "submitting" | "success" | "error" | "paused";
  amountCents: number;                    // controlled by shared chip-in state
  onAmountChange: (cents: number) => void;
  onPreset: (cents: number) => void;      // preset tap (also sets amount)
  onSubmit: () => void;                   // → surface onChipIn
  onDismissSuccess?: () => void;
  errorText: string | null;
  isWeb?: boolean;                        // Platform.OS === 'web'
  preview?: boolean;                      // business preview → inert, "Preview" hint
  testID?: string;                        // default "orch-1291-rsvp-chipin-panel"
}
```
Reuse helpers already in the package: `boldFontFamily`, `opaqueSurfaceColor`, `opaqueAccentWashColor` (`themePalette.ts`); build `opaqueCardFill`/`opaqueAccentFill` locally the same way `RsvpMomentumDecision` does (or export them from `themePalette.ts` — an additive export, allowed).

### 9.2 Shared state — extend `useRsvpOfferingState` (in `RsvpOfferingBody.tsx`)
Add chip-in slice: `chipInState`, `chipAmountCents`, `chipError`, setters, and `runChipIn()` that calls the new `onChipIn` prop and maps result → `paid`/`error` (via `mapChipInError`). Expose `chipInPanelNode` OR render `<RsvpChipInPanel>` at both mounts reading this slice (mirror how `contactForm`/`successPopup` are exposed). Add `onChipIn` + `contributionState` to `RsvpOfferingBodyProps`, and `rsvp_contribution_enabled`, `rsvp_contribution_suggested_cents`, `rsvp_contribution_min_cents`, `settlementCurrency` to `RsvpOfferingConfig` (extend the interface; SPEC §4.6).

### 9.3 Success popup — `RsvpSuccessPopup.tsx`
Add an optional `chipInPanel?: React.ReactNode` prop; render it between the detail block and the Done button when present. No other change (keeps the GOING-only contract).

### 9.4 Inline §5.5 — `RsvpOfferingBody` render
Insert a new gated `<View style={styles.section} testID="orch-1291-rsvp-chipin-section">` between the §5 decision box and the §6 brand `View`, rendering `<RsvpChipInPanel>` only when `config.rsvp_contribution_enabled && guestStatus ∈ {going,maybe,waitlisted,pending}`. Wrap the mount in the M1 entrance animation.

### 9.5 Wizard — `RsvpStep5Setup.tsx`
Add a "Contributions" `styles.field` block after the Approvals block: reuse `ToggleRow` for the toggle; add a small `MoneyField` sub-component (currency-prefixed `TextInput`, `decimal-pad`, `ROW_BG` row) for suggested + min; add the connect callout sub-component. New draft fields on `draftEventStore`: `rsvpContributionEnabled: boolean`, `rsvpContributionSuggestedCents: number | null`, `rsvpContributionMinCents: number | null` (map to the SPEC §4.1 `events` columns at publish). Provider + `canCollect` come from the brand/status the wizard already has access to (SPEC assumptions).

### 9.6 Connect callout — reuse, do NOT fork onboarding
Key design decision: the callout's **Connect bank** button routes to the EXISTING proven onboarding UI rather than re-implementing it — `BrandOnboardView` (Stripe, which already handles country pick + ToS gate) / `BrandPaystackOnboardView` (NG subaccount form), opened as a sheet/screen, using their existing `useStartBrandStripeOnboarding()` + `openAuthSessionAsync(RETURN_DEEP_LINK)` path. On dismiss/return, re-run the `canCollect` check (invalidate `brandStripeStatusKeys` / re-read subaccount) and flip the callout to **connected**. This satisfies SPEC §4.6 "inline connect sub-flow" with zero onboarding-UI duplication and inherits every hardened edge case. Copy is neutral "Connect bank" / "Set up bank transfer" (COMMS-0021).

### 9.7 New tokens
None required — the design reuses the existing themed `palette`, the package opaque helpers, the business `designSystem` (`spacing`/`radius`/`accent`/`glass`/`semantic`/`text`/`typography`), and `Intl.NumberFormat`. The only additive exports are `opaqueCardFill`/`opaqueAccentFill` from `themePalette.ts` (optional convenience) and the new component + props. **No new dependency, no new asset host.**

---

## 10. Success-criteria trace (design ⇄ SPEC §5)

| SPEC SC | Design element that satisfies it |
|---|---|
| SC-1 (free RSVP never blocked) | Panel is a *second* action gated on a resolved positive RSVP; RSVP flow untouched; "your RSVP's already locked in" copy |
| SC-2 / -iOS/-Android/-Web | §5.5 + popup mount gated on `rsvp_contribution_enabled`; per-surface deltas §8 rows 1–3,7 |
| SC-5 (contribution, not a sale) | Banned-commerce-word list (§0); "chip in"/"give"/"gift" copy; CONFIRM_LINE "You'll give…"; no tax/fee/ticket/QR anywhere in the panel |
| SC-6 / -Stripe/-Paystack | Wizard connect callout + provider-aware button copy; hard block lives at publish (design surfaces the friendly nudge + the connected confirmation) |
| SC-7 (anon web end-to-end) | §8 row 3: `{kind:'redirecting'}` → hosted page → `contributionState='paid'` → success, no login |

---

## 11. Open design annotations (non-blocking)

- **Tip-jar reuse (Q-D):** `<RsvpChipInPanel>` is fully self-contained (props-only, no RSVP-state coupling beyond the passed slice) → a future standalone "tip jar" entry point mounts the same component with a different `onSubmit` wiring. No second entry built now.
- **Fee-incidence (Q-B):** the entire fee model surfaces through the single `CONFIRM_LINE` constant (§4.4). A flip to guest-covers-fees is one string edit; the button label already shows only the gift amount (`Chip in £10`), which stays correct under either model.
- **Copy finalization:** strings in §4.6 are design placeholders in Mingla voice; final microcopy routes to mingla-product (SPEC §2.9) — the layout tolerates ±1 line of copy growth (content-sized card, `flexWrap` presets).
