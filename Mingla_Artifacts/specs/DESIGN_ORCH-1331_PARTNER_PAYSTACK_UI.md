# DESIGN — ORCH-1331 [partner program Nigeria/Paystack payout rail] — Nigeria partner-onboarding UI

- **Date:** 2026-07-11
- **Mode:** DESIGN (pixel-precise UI contract; binds the client leg of `Mingla_Artifacts/specs/SPEC_ORCH-1331_PARTNER_PAYSTACK_RAIL.md` §4.9 — that SPEC's copy strings and component contract are the floor; this document is the finished surface)
- **Worktree:** `~/Desktop/mingla-orchs/orch-1331-[partner-paystack-rail]/` on branch `orch-1331-partner-paystack-rail`
- **Surfaces:** business iOS + business Android + business web preview (one RN codebase — `mingla-business/`)
- **Post-ORCH-1344 base (`dd10e8308`):** this design extends the CURRENT re-skinned `app/partner/earnings.tsx` — shared `<Button>` pills, close-left ChromeRow header, `canvas.discover`, `GlassCard` sections. Nothing removed by 1344 (hero/eyebrow) is reintroduced.

Every token cited below is read from `mingla-business/src/constants/designSystem.ts` (values quoted inline once for the implementor's convenience). No new tokens are required. No new one-off styles where a kit piece exists.

---

## 1. IA & flow

### 1.1 The user's moment

A flagged Nigerian partner opens **Earnings** expecting to get paid. Today the screen offers only Stripe countries — a dead end. The design's single job: make "I'm in Nigeria → my bank is connected → I can see my splits" feel like one continuous, obvious path, indistinguishable in quality from the Stripe path beside it.

### 1.2 Information hierarchy (earnings screen, unchanged skeleton)

1. ChromeRow header (close-left, centered "Earnings") — UNCHANGED.
2. `StatusBlock` card — the payout-rail state machine. THIS is where all new NG states live.
3. Ready-to-earn nudge (active partners, zero links) — UNCHANGED.
4. Splits ledger (totals → filter chips → rows) — gains ONE new badge mapping.

### 1.3 Flow (happy path + branches)

```
/partner/earnings  (partner_enabled = true, stripe not_connected, paystack not connected)
 │
 ├─ StatusBlock [NOT CONNECTED] card: copy + BrandStripeCountryPicker + "Pick a country first" Button
 │
 ├─ tap picker → Sheet (snapPoint="full"): 34 Stripe countries + "Nigeria · Paystack · NGN"
 │    interleaved alphabetically (extraOptions slot — picker component FROZEN, consumed as-is)
 │
 ├─ pick a Stripe country ──────────────► existing Stripe path (UNCHANGED)
 │
 └─ pick Nigeria (NG)
      │  success haptic (picker built-in) + sheet closes
      ▼
    StatusBlock [NG fork] — the card content is REPLACED by <PartnerPaystackOnboardForm/>
    (picker unmounts; way back = "‹ Choose a different country" ghost button — §1.4)
      │
      ├─ banks loading → spinner row inside form
      ├─ banks error → inline error + Retry (secondary Button)
      │
      ├─ pick bank (modal sheet, search, dedupe) + type 10-digit account number
      │     └─ CTA "Verify account" enables only when bank picked AND 10 digits
      ▼
    RESOLVE (Paystack account-resolve)
      ├─ fail (422 / network) → inline error caption, stay editable
      └─ success → CONFIRM-NAME step: resolved holder name block appears,
                   CTA swaps to "Connect bank & get paid"
                   (editing any digit or re-picking the bank CLEARS the name — re-verify)
      ▼
    SUBMIT (create recipient)
      ├─ 409 stripe_already_connected → mapped inline error (see copy table)
      ├─ 5xx/network → generic inline error, confirm state retained
      └─ success → CTA holds its loading spinner until the status query flips
                   (no flash of the picker state), then the card swaps to:
      ▼
    StatusBlock [PAYOUTS READY — Paystack]: bank + masked digits + holder name
      └─ "Disconnect bank" (secondary, error-tinted label) → Alert confirm →
         detach → card returns to [NOT CONNECTED] with the picker (fresh choice)
```

Failure points and recovery are all in-card and inline — no navigation is ever forced by an error.

### 1.4 Binding flow resolution — picker visibility in the NG fork (ambiguity resolved)

SPEC §4.9.3 says "the picker stays mounted above the form". Doing that literally renders a **broken trigger label**: the frozen `BrandStripeCountryPicker` resolves its trigger text via `getStripeSupportedCountry(code)` and falls back to the string `Country: NG` for any non-allowlist code (`BrandStripeCountryPicker.tsx:142-144`) — debug-grade copy on a money screen. The picker is DO-NOT-TOUCH, so the label cannot be fixed there.

**Resolution (BINDING for this design):** mirror the shipped brand-side precedent (`BrandOnboardView.tsx:543-569`): when `selectedCountry === "NG"`, the not-connected card renders `<PartnerPaystackOnboardForm/>` and the picker is NOT rendered. The form's top-left ghost button "‹ Choose a different country" (`onCancel`) clears `selectedCountry` **and sets a `reopenPickerOnReturn` flag** that is passed to the picker's existing `defaultOpen` prop, so the country sheet re-opens immediately — the exact return-to-re-pick affordance `defaultOpen` was built for (`BrandStripeCountryPicker.tsx:72-74`). SPEC intent is fully preserved: NG rides `extraOptions`, `onCancel` clears `selectedCountry`, the user can always switch back. The NG `currencyHelper` string moves INTO the form (§3.2 row 4) since the picker that would have carried it is hidden in this state.

---

## 2. Earnings screen — country/provider entry (deltas only)

The `not_connected` Stripe card (`earnings.tsx:755-801`) is the host. Changes:

| # | Delta | Exact spec |
|---|---|---|
| 1 | Picker gains Nigeria | `extraOptions={[{ code: "NG", name: "Nigeria", currency: "NGN", sublabel: "Paystack" }]}` on the existing mount (`earnings.tsx:769-776`). Renders in the sheet as: `rowCode` "NG" (caption 12/700, `text.tertiary`, letterSpacing 1.2) · `rowName` "Nigeria" (body 16/500, `text.primary`) · `rowSublabel` "Paystack" (caption 12/500, `text.tertiary`, marginTop 1) · `rowRight` "NGN" (caption 12/700, `text.secondary`, letterSpacing 0.8). Row minHeight 56, padding `spacing.md` (16) both axes, radius `radius.md` (12). All styling comes from the frozen picker — zero new styles. Search matches "nigeria" / "ng" / "ngn" for free. |
| 2 | NG fork | `selectedCountry === "NG" && stripeStatus === "not_connected" && !paystackConnected` → render `<PartnerPaystackOnboardForm onConnected={…} onCancel={…}/>` in the card slot INSTEAD of the not-connected GlassCard (§1.4). |
| 3 | Paystack connected | `paystackStatus.connected && detached_at === null` → render the PAYOUTS READY (Paystack) card (§4.2) in the same slot as the Stripe `active` card. Takes precedence over every Stripe branch except a genuinely active Stripe account (mutually exclusive by backend 409s; if both ever read true, Stripe card wins and Paystack card is suppressed — defensive, should be unreachable). |
| 4 | Country lock | `countryLocked = stripeAccountStatus !== "not_connected" || paystackConnected` (SPEC §4.9.4 formula, replaces `earnings.tsx:91`). |
| 5 | Copy generalization | Welcome toast `earnings.tsx:394-396`: "…once they connect **Stripe** and sell their first ticket." → "…once they connect **payouts** and sell their first ticket." Splits empty state `:464`: "…as soon as their **Stripe is** connected and tickets sell." → "…as soon as their **payouts are** connected and tickets sell." (SPEC-bound strings.) |
| 6 | Badge map | `StatusBadge` map (`earnings.tsx:578-586`) adds `blocked_no_paystack: { label: "Blocked — Paystack", color: semantic.error, bg: semantic.errorTint }` (SPEC-bound). Pill geometry unchanged: paddingV `spacing.xs` (4), paddingH `spacing.sm + 2` (10), radius `radius.full`, text `typography.micro` (11/14, 600, ls 0.4). |
| 7 | Keyboard host | The screen gains its first text input, so the `<ScrollView contentContainerStyle={styles.scroll}>` (`earnings.tsx:215`) is wrapped in `KeyboardAvoidingView` from `react-native-keyboard-controller` (house primitive per ORCH-0892 — same import as `BrandPaystackOnboardView.tsx:24`): `behavior={Platform.OS === "ios" ? "padding" : undefined}`, `keyboardVerticalOffset={0}`, `style={{flex: 1}}`. Android relies on `adjustResize` + the ScrollView. Add `keyboardShouldPersistTaps="handled"` and `keyboardDismissMode="on-drag"` to the ScrollView so the Verify CTA fires on first tap with the keyboard up, and a drag dismisses. This satisfies the house invariant: the account-number input and its CTA are NEVER covered by the keyboard (`feedback_keyboard_never_blocks_input`). |

NGN amounts in the ledger need **zero work**: `formatCents` (`earnings.tsx:595-605`) already renders kobo→`₦1,500.00` via `Intl` narrowSymbol.

---

## 3. `PartnerPaystackOnboardForm` — component spec (NEW, `src/components/partner/PartnerPaystackOnboardForm.tsx`)

Partner-scoped twin of `BrandPaystackOnboardView.tsx` — same interaction contract, same field anatomy, same bank-picker sheet, re-skinned only where the earnings card system differs from the brand card system.

### 3.1 Anatomy (top → bottom; container = GlassCard)

**Container:** `GlassCard variant="elevated" radius="md" padding={spacing.lg}` — matches every StatusBlock card on this screen (the brand twin uses default radius `xl`; on earnings, card-system consistency wins). The form self-hosts its card exactly like the brand twin; the StatusBlock NG branch returns it directly. **Never nest it inside another GlassCard** (no double glass).

| Row | Element | Spec |
|---|---|---|
| 1 | Back (ghost) | `Button variant="ghost" size="sm"` label `‹ Choose a different country`, wrapped `alignItems:"flex-start"`, `marginBottom: spacing.xs` (4), `marginLeft: -spacing.xs` (−4, optical left-align of the ghost pill's padding) — verbatim `BrandPaystackOnboardView.tsx:332-336`. Ghost text = `accent.warm` #eb7825, 14/20 600. Height 36; total touch extent with text row ≥44 via the pill's vertical hit area + surrounding spacing — acceptable per kit (`Button` sm is the established ghost-back size app-wide; it also carries `accessibilityRole="button"`). |
| 2 | Status eyebrow | Muted dot + label, reusing the screen's existing pattern verbatim: `statusIndicatorRow` (row, gap `spacing.xs` 4) with `statusDotMuted` (8×8, radius 4, `text.tertiary`) + `statusLabelMuted` text `NOT CONNECTED` (`typography.labelCap` 12/16 600 ls 1.4, `text.tertiary`). Keeps the state-system continuity — every StatusBlock card variant opens with a dot+eyebrow. |
| 3 | Title | `Get paid in Nigeria` — `typography.h3` (20/32 600), `text.primary`, `marginTop: spacing.xs` (4). |
| 4 | Subtitle | `Connect your bank account to receive your partner earnings. Splits are paid in NGN directly to this account.` — `typography.bodySm` (14/20 400), `text.secondary`, `marginTop: spacing.xs` (4). Followed by the NGN-constraint caption (relocated `currencyHelper`, §1.4): `Paystack will settle you in NGN. You'll only be able to partner with brands that sell in NGN.` — `typography.caption` (12/16 500 ls 0.2), `text.tertiary`, `marginTop: spacing.sm` (8), `marginBottom: spacing.sm` (8). |
| 5 | Bank field | Label `Bank` — `typography.caption`, `text.tertiary`, `marginTop: spacing.md` (16), `marginBottom: spacing.xs` (4). Field = Pressable, height **48**, `justifyContent:"center"`, paddingH 14, radius `radius.md` (12), border 1 `rgba(255, 255, 255, 0.12)`, background `rgba(255, 255, 255, 0.04)` — verbatim brand `pickerField` (these two literals ARE the kit Input field chrome: `Input.tsx:409-410`). Value text `typography.body` `text.primary`; placeholder `Choose your bank` in `text.quaternary`. Opens the bank sheet (§3.3). |
| 6 | Account field | Label `Account number` — same label style. `<Input variant="number" maxLength={10} placeholder="10-digit account number" accessibilityLabel="Bank account number" returnKeyType="done"/>` — kit Input, height 48, numeric keypad, autoCorrect off (kit variant table). onChange strips non-digits, clamps to 10, clears any resolved name + error (verbatim `onAccountChange`, brand twin `:118-123`). Below it, privacy caption: `We keep only the last 4 digits of your account number.` — `typography.caption`, `text.tertiary`, `marginTop: spacing.xs` (4). (Honest per I-PROPOSED-1331-NUBAN-NEVER-PERSISTED — do NOT copy the Stripe card's "never to Mingla" claim; the number transits our edge fn and only last4 persists.) |
| 7 | Confirm-name block (verified state only) | View: `marginTop: spacing.md` (16), padding `spacing.md` (16), radius `radius.md` (12), background `rgba(255, 255, 255, 0.04)`. Inside: label `Account name` (`typography.caption`, `text.tertiary`) → resolved name (`typography.bodyLg` 18/28 500, `text.primary`, `marginTop: spacing.xxs` 2) → hint `Make sure this is you — payouts go to this account.` (`typography.caption`, `text.tertiary`, `marginTop: spacing.xs` 4). `accessibilityLiveRegion="polite"` on the block so screen readers announce the resolved name. |
| 8 | Inline error (error states only) | Text, `typography.caption`, `semantic.error` #ef4444, `marginTop: spacing.md` (16). `accessibilityLiveRegion="polite"`. (Caption-weight inline error matches the brand twin; the earnings screen's boxed `inlineError` pill stays reserved for the Stripe branch it already owns.) |
| 9 | Primary CTA | `marginTop: spacing.lg` (24). ONE `Button variant="primary" size="lg" fullWidth` (52 high, pill, `accent.warm` bg, white label 16/24 600) whose label/handler swaps by state — layout never shifts: pre-verify `Verify account` / `Verifying…`; post-verify `Connect bank & get paid` / `Connecting…`. Disabled styling comes from the kit (bg `rgba(255,255,255,0.06)`, border 1 `rgba(255,255,255,0.10)`, label `text.tertiary`). |

Props: `{ onConnected?: () => void; onCancel?: () => void }` (SPEC §4.9). No `mode` prop — partners have no "update bank" flow in this ORCH (deliberate cut, §8).

### 3.2 State machine (the exact state list)

| # | State | Entry condition | What renders / changes | Exit |
|---|---|---|---|---|
| 1 | `banks_loading` | banks query pending (query mounts with the form) | Rows 1–6 render; bank field disabled (opacity 0.5); small `<Spinner size={24} color={accent.warm}/>` inline right of the Bank label | banks resolve/fail |
| 2 | `banks_error` | banks query error | Inline error (row 8): `Couldn't load the bank list. Check your connection and try again.` + `Button variant="secondary" size="md" label="Retry"` (`marginTop: spacing.sm`) → refetch | retry |
| 3 | `idle_incomplete` | no bank OR <10 digits | CTA `Verify account` **disabled** | fields complete |
| 4 | `ready_to_verify` | bank picked AND 10 digits AND not resolving | CTA `Verify account` enabled | tap Verify |
| 5 | `resolving` | resolve mutation pending | CTA `Verifying…`, `loading` (kit spinner replaces leading slot, label dims 0.7), both fields non-editable (`editable={false}` on Input, bank field disabled) | resolve settles |
| 6 | `resolve_error` | resolve rejected | Inline error (copy table §7, rows E1/E2); fields editable again; CTA back to `Verify account` | edit / retry |
| 7 | `confirm_name` | resolve succeeded | Confirm-name block appears (motion §6.2); CTA swaps to `Connect bank & get paid`; **any** edit to digits or bank clears the name → back to 3/4 (invalidation contract) | tap Connect / edit |
| 8 | `connecting` | submit mutation pending **or succeeded-awaiting-flip** | CTA `Connecting…` loading. BINDING: `loading = submitMutation.isPending \|\| submitMutation.isSuccess` — after success the spinner HOLDS until the parent's `usePartnerPaystackStatus` refetch flips `connected` and the card swaps. No flash back to an enabled form, no flash of the picker state. | status flips → unmount |
| 9 | `connect_error` | submit rejected | Inline error (copy table §7, rows E3–E5); confirm-name block RETAINED (the resolution is still valid); CTA re-enabled | retry / edit |
| 10 | `connected` | parent sees `connected === true` | Form unmounts; PAYOUTS READY card renders (§4.2). Fire `Haptics.notificationAsync(Success)` (native only) in `onConnected`. | — |

"Pending-verification" from the dispatch's state list **does not exist on this rail** — Paystack recipient creation is synchronous (no KYC wait, unlike Stripe `onboarding`/`restricted`). Its UX role is absorbed by state 8's post-success hold. Documented so nobody invents a phantom waiting screen.

### 3.3 Bank-picker sheet (inside the form)

Mirror `BrandPaystackOnboardView.tsx:266-326` **verbatim** — it is the proven, keyboard-hardened pattern (ORCH-1165 DISC-1165-T3):

- RN `Modal transparent animationType="slide"`, wrapped in `KeyboardAvoidingView` from `react-native-keyboard-controller`, `behavior={Platform.OS==="ios" ? "padding" : undefined}`, `keyboardVerticalOffset={42}`.
- Backdrop Pressable `rgba(0, 0, 0, 0.5)`, `accessibilityLabel="Close bank picker"`.
- Sheet: `height:"64%"`, padding `spacing.lg` (24), top radii `radius.xl` (24), background **`#14110f` (opaque — satisfies ANDROID_GLASS_USES_OPAQUE_FALLBACK by construction; no translucent Android fill, no Android shadow under the rounded fill)**.
- Title `Choose your bank` — `typography.bodyLg`, `text.primary`, `marginBottom: spacing.md`.
- `<Input variant="search" placeholder="Search banks" clearable autoFocus accessibilityLabel="Search banks"/>`.
- List: ScrollView `keyboardShouldPersistTaps="handled"`; **Android-only** `contentContainerStyle={{paddingBottom: 42}}` while the keyboard is open (`useKeyboardIsVisible()` house primitive) — the 42dp Done-bar clearance, keyed on keyboard-open so no permanent dead gap.
- Rows: paddingV `spacing.md` (16) + body 16/24 text = 56px effective ≥44; hairline bottom border `rgba(255, 255, 255, 0.08)`; text `typography.body` `text.primary`; `accessibilityRole="button"`, `accessibilityLabel={bank.name}`.
- Dedupe by `code` before render (Paystack returns duplicate codes under different slugs — brand twin `:96-106`); React keys `${code}-${i}`.
- Empty search: `No banks match "<query>".` — `typography.caption`, `text.tertiary`, centered, `marginTop: spacing.lg`.
- Loading: `<ActivityIndicator color={accent.warm}/>` `marginTop: spacing.lg`.
- Picking a bank closes the sheet, clears search, invalidates any resolved name.

This Modal is a root-level RN Modal hosted by a full screen (not a Sheet-in-Sheet), so the sub-sheet-inside-parent rule is not in play; on business web the identical Modal already ships in the brand flow.

Bank-field a11y upgrade over the brand twin (cheap, do it): when a bank is selected, `accessibilityLabel` = `` `Bank: ${bankName}, tap to change` `` (unselected: `Choose your bank`).

---

## 4. Status-card states on earnings (complete matrix)

### 4.1 Existing states — UNTOUCHED
`active` (Stripe) / `restricted` / `onboarding` / `not_connected` (non-NG) render exactly as today (`earnings.tsx:646-801`). Screen-level `isLoading` (centered `ActivityIndicator color={accent.warm}`) and status-error card ("Couldn't load partner status" + secondary Retry) already cover both rails — `usePartnerPaystackStatus` errors join the same screen-level error branch.

### 4.2 NEW — `paystack_active` (PAYOUTS READY, Paystack)

Same slot, same card grammar as the Stripe active card:

```
GlassCard variant="elevated" radius="md" padding={spacing.lg}
├─ statusIndicatorRow: statusDotSuccess (8×8, semantic.success #22c55e)
│    + "PAYOUTS READY" (typography.labelCap, semantic.success)
├─ Title: "You're earning" (typography.h3, text.primary, marginTop spacing.xs)
├─ Body: "Your partner payouts go to {bank_name} ••••{last4} (NGN)."
│    (typography.body 16/24, text.secondary, marginTop spacing.xs)
├─ Holder row: "Account holder: {account_name}"
│    (typography.caption, text.tertiary, marginTop spacing.xs)
└─ marginTop spacing.md → Button variant="secondary" size="md" fullWidth
     label "Disconnect bank" (loading label "Disconnecting…")
     labelStyle={{ color: semantic.error }}
     accessibilityLabel="Disconnect Nigerian bank account"
```

No primary "Manage" button — there is no Paystack-hosted dashboard session to open (asymmetry with Stripe is honest, not an omission). Detach parity: same secondary+error-label treatment as `Disconnect Stripe` (`earnings.tsx:673-685`).

**Disconnect confirm (Alert.alert, mirrors `handleDisconnectStripe` `:148-169`):**
- Title: `Disconnect bank?`
- Body: `Your bank account will be unlinked from Mingla partner payouts. Splits already paid stay in your bank. You can reconnect anytime — with the same or a different account.`
- Buttons: `Cancel` (style cancel) / `Disconnect` (style destructive) → detach mutation → refetch → card returns to `not_connected` (picker available again; `selectedCountry` reset to null so the choice is explicit).
- Failure: `Alert.alert("Couldn't disconnect", <message>)` — Stripe-parity.

### 4.3 NEW — NG fork states
`ng_form` (form states 1–9, §3.2) and `disconnecting` (button loading + disabled during detach). Full card-level state list: `loading` / `status_error` / `not_a_partner` / `not_connected` / `ng_form` / `stripe_onboarding` / `stripe_restricted` / `stripe_active` / `paystack_active` / `disconnecting`.

---

## 5. `/partner/brands` — label deltas (labels ONLY; `deriveLinkStatus` + timestamp columns FROZEN)

| Site | Today | Ships as |
|---|---|---|
| `brands.tsx:248-249` `statusLabel("awaiting_stripe")` | `Awaiting Stripe` | `Awaiting payouts` |
| `brands.tsx:270` `subTextFor` active fallback | `Stripe connected` | `Payouts connected` |
| `brands.tsx:7-8` doc comment | "awaiting_stripe" wording | mention labels are provider-neutral |

Everything else — `STATUS_RANK`, `StatusDot` colors (`awaiting_stripe` → `semantic.warning` dot), chip typography (`typography.micro` 700 ls 0.5 `text.secondary`), row layout — byte-identical. The internal status VALUE `awaiting_stripe` never changes (client contract, I-PROPOSED-1331-LINK-COLUMNS-FROZEN).

---

## 6. Motion spec

| Animation | Trigger | Property | Curve / duration | Reduced-motion fallback |
|---|---|---|---|---|
| Button press | press-in on any Button | scale → 0.96 | `easings.press` timing, `durations.fast` (120ms) | opacity → 0.7 (kit built-in) |
| Country/bank sheet in-out | open/close | translateY | kit `Sheet`: 320ms entry `easings.out` / 240ms exit `easings.in`; bank Modal: RN `animationType="slide"` | Sheet: 200ms fade (kit built-in); Modal: acceptable as-is |
| Confirm-name block entrance | resolve success | opacity 0→1, translateY 6→0 | `withTiming`, `durations.normal` (200ms), `easings.out` | render instantly (gate on `useReducedMotion()`) |
| CTA label swap (Verify→Connect) | resolve success | none (re-render) | — layout is stable by construction (same size lg fullWidth pill) | — |
| Card swap (form → PAYOUTS READY) | status flip | none — state re-render | — (screen-level change; no bespoke choreography, matches every other StatusBlock transition) | — |
| Success haptic | recipient created | `Haptics.notificationAsync(Success)` | native only (`Platform.OS !== "web"`) | fires regardless (non-visual) |

Nothing else animates. Every animation above communicates a state change; anything more is decoration and is cut.

---

## 7. Copy master table (exact final strings — Mingla voice, layman-first, zero "NUBAN"/"recipient"/"resolve" in UI)

| ID | Where | String |
|---|---|---|
| C1 | Picker row | `Nigeria` / sublabel `Paystack` / currency `NGN` |
| C2 | Form title | `Get paid in Nigeria` |
| C3 | Form subtitle | `Connect your bank account to receive your partner earnings. Splits are paid in NGN directly to this account.` |
| C4 | NGN note | `Paystack will settle you in NGN. You'll only be able to partner with brands that sell in NGN.` |
| C5 | Back button | `‹ Choose a different country` |
| C6 | Bank label / placeholder | `Bank` / `Choose your bank` |
| C7 | Account label / placeholder | `Account number` / `10-digit account number` |
| C8 | Privacy caption | `We keep only the last 4 digits of your account number.` |
| C9 | CTA pre-verify / busy | `Verify account` / `Verifying…` |
| C10 | Confirm block | `Account name` → `{resolved name}` → `Make sure this is you — payouts go to this account.` |
| C11 | CTA post-verify / busy | `Connect bank & get paid` / `Connecting…` |
| C12 | Bank sheet | `Choose your bank` / `Search banks` / `No banks match "{query}".` |
| C13 | Connected card | eyebrow `PAYOUTS READY` · title `You're earning` · body `Your partner payouts go to {bank_name} ••••{last4} (NGN).` · caption `Account holder: {account_name}` |
| C14 | Disconnect button / busy | `Disconnect bank` / `Disconnecting…` |
| C15 | Disconnect alert | title `Disconnect bank?` · body `Your bank account will be unlinked from Mingla partner payouts. Splits already paid stay in your bank. You can reconnect anytime — with the same or a different account.` · `Cancel` / `Disconnect` |
| C16 | Ledger badge | `Blocked — Paystack` |
| C17 | Brands labels | `Awaiting payouts` · `Payouts connected` |
| C18 | Toast/empty generalizations | `…once they connect payouts and sell their first ticket.` · `…as soon as their payouts are connected and tickets sell.` |

**Error taxonomy → user strings** (map on the edge fn's `detail` via the service's `unwrapError`; anything unmapped falls to the generic for that step):

| ID | Backend condition | Inline string |
|---|---|---|
| E1 | `account_unresolved` (422) — wrong number/bank | `We couldn't verify that account. Check the number and bank, then try again.` |
| E2 | resolve network / 5xx / timeout | `We couldn't reach the bank check right now. Give it a second and try again.` |
| E3 | `stripe_already_connected` (409) | `You already have a Stripe payout account. Disconnect it first, then connect your Nigerian bank.` |
| E4 | `recipient_create_failed` (502) / `internal_error` (500) / network on submit | `We couldn't connect this bank account. Please try again in a moment.` |
| E5 | `banks_unavailable` (502) / banks network | `Couldn't load the bank list. Check your connection and try again.` |
| E6 | Resolve-name mismatch ("that's not me") | Not an error state — the user edits the number/bank; C10's hint carries the instruction. No extra copy. |
| E7 | `account_number_must_be_10_digits` (400) | Unreachable from UI (input clamps to 10 digits and the CTA gates on length); if it ever surfaces, falls to E1. |

---

## 8. Deliberate cuts (justified)

1. **No "Change bank" for partners** (brand side has `mode="update"`): not in the SPEC contract or allowlist; disconnect → reconnect covers it with Stripe-rail parity. Revisit only on real partner demand.
2. **No Paystack "Manage" CTA**: nothing to manage externally; a dead button is worse than an honest absence.
3. **No new hero/eyebrow art in the NG card**: ORCH-1344 removed decoration from this screen; the form earns trust with clarity, not chrome.
4. **No bespoke success screen/confetti on connect**: the card flip to PAYOUTS READY + success haptic IS the confirmation; the first-split push (backend) delivers the real celebration later.

---

## 9. Color & contrast (WCAG AA audit; effective backgrounds composited over `canvas.discover` #0c0e12; elevated-card surface ≈ #1b1d20)

| Pairing | Effective fg / bg | Ratio | Verdict |
|---|---|---|---|
| `text.primary` on elevated card | ~#f6f6f7 / #1b1d20 | ~15.7:1 | PASS |
| `text.secondary` on elevated card | ~#bfbfc1 / #1b1d20 | ~9.2:1 | PASS |
| `text.tertiary` (labels, captions) on card | ~#919293 / #1b1d20 | ~5.4:1 | PASS |
| `semantic.success` eyebrow on card | #22c55e / #1b1d20 | ~7.4:1 | PASS |
| `semantic.error` inline error on card | #ef4444 / #1b1d20 | ~4.5:1 | PASS (at the AA line; on flat canvas ~5.2:1) |
| `accent.warm` ghost label on card | #eb7825 / #1b1d20 | ~5.8:1 | PASS |
| White label on `accent.warm` primary pill | #ffffff / #eb7825 | ~2.9:1 | Accepted app-wide exception — operator decision 2026-06-08, documented at `designSystem.ts:207-214`; this design introduces no new instance class |
| `text.quaternary` placeholders | ~#646567 / #1b1d20 | ~2.9:1 | Kit-wide placeholder token; fields always carry a visible label above (the label, not the placeholder, is the accessible name) |
| Badge `semantic.error` on `errorTint` over card | #ef4444 / ~#412426 | ~3.7:1 | Matches the entire shipped badge family (`blocked_no_stripe`, `failed`); intentionally NOT forked for one badge — flagged as a kit-wide badge-contrast follow-up candidate, out of ORCH-1331 scope |

Color is never the only status indicator: every dot/badge pairs with a text label; the confirm block announces via live region.

---

## 10. Accessibility (I-38 / I-39 compliance)

- **Touch targets:** primary CTA 52; disconnect/retry 44; bank field 48; Input 48; bank rows 56; country rows 56 (frozen picker); IconChrome close 36 + hitSlop 4 = 44 effective (kit-baked). Nothing under 44 effective.
- **Labels (I-39):** every Pressable carries `accessibilityRole="button"` + label — back (`Choose a different country` via Button label), bank field (`Bank: {name}, tap to change` / `Choose your bank`), account input (`Bank account number`), search (`Search banks`), bank rows (`{bank.name}`), backdrop (`Close bank picker`), CTAs (labels), disconnect (`Disconnect Nigerian bank account`).
- **Announcements:** confirm-name block + inline-error text get `accessibilityLiveRegion="polite"` (RN maps to aria-live on web). CTA loading states expose `accessibilityState={{busy:true}}` via the kit Button.
- **Reading order** matches visual order (single column): back → status → title → subtitle → NGN note → bank → account → privacy → confirm → error → CTA.
- **Dynamic Type:** all text uses token type ramps with RN font scaling on; layouts are min-height based (no fixed text-box heights), so scaling grows cards vertically. `numberOfLines={1}` only on the Button label (kit) and brand-name rows (existing).
- **Reduced motion:** every bespoke animation gates on `useReducedMotion()` (§6); kit Button/Sheet fallbacks built-in.
- **Keyboard (web):** kit Button shows the 2px `accent.warm` `:focus-visible` ring; Input focus border flips to `accent.warm`; Modal search autoFocuses.

---

## 11. Per-platform deltas

| Concern | iOS | Android | Business web |
|---|---|---|---|
| Screen keyboard avoidance | KAV `behavior="padding"` (r-n-keyboard-controller) | `adjustResize` + ScrollView (no KAV behavior) | Browser-native; KAV inert |
| Numeric keypad dismissal | Number pad has no return key → `keyboardDismissMode="on-drag"` + persistTaps make the CTA reachable regardless | `returnKeyType="done"` honored; 42dp Done-bar clearance in the bank sheet (keyboard-open keyed) | n/a |
| Bank sheet fill | `#14110f` opaque | Same opaque fill → ANDROID_GLASS_USES_OPAQUE_FALLBACK satisfied; zero elevation under rounded fills (`androidSafeElevation` already zeroes it) | Same; kit Sheet/GlassChrome already handle the <768px backdrop-filter kill (ORCH-0964/1100) |
| Haptics | selection (picker, kit-baked) + success on connect | same | none (Platform-guarded) |
| Hover/focus | n/a | n/a | Button hover +6% alpha, focus ring; picker/bank rows show pressed-state bg on click (kit) |
| Disconnect confirm | `Alert.alert` native | `Alert.alert` native | RN-web Alert renders as window.confirm-grade fallback — acceptable (Stripe disconnect already ships this exact pattern on web) |

---

## 12. Build-ready handoff

- **New file:** `src/components/partner/PartnerPaystackOnboardForm.tsx` — RN primitives + kit only: `GlassCard`, `Button`, `Input`, `Spinner`, `Modal`, `KeyboardAvoidingView` (react-native-keyboard-controller), `useKeyboardIsVisible`, `expo-haptics`. Props `{onConnected?, onCancel?}`.
- **Modified:** `app/partner/earnings.tsx` (§2 rows 2–7 + KAV wrap + `reopenPickerOnReturn` → picker `defaultOpen`), `app/partner/brands.tsx` (§5 strings only), `src/services/partnerSplitsService.ts` (type additions per SPEC §4.8).
- **Tokens:** all existing — `spacing`, `radius`, `typography`, `text`, `semantic`, `accent`, `glass`, `canvas`, `durations`, `easings`. **Zero new tokens.** The only raw literals permitted are the ones already canonized by the kit and cited here: field chrome `rgba(255,255,255,0.12)` / `rgba(255,255,255,0.04)` (= `Input.tsx:409-410`), backdrop `rgba(0,0,0,0.5)`, sheet fill `#14110f`, Android clearance `42`.
- **Do not touch:** `BrandStripeCountryPicker.tsx`, `BrandPaystackOnboardView.tsx`, `partnerBrandLinksService.ts` (`deriveLinkStatus`), `stripeSupportedCountries.ts` — per the SPEC allowlist. NG never enters `STRIPE_SUPPORTED_COUNTRIES` (strict-grep gate stands).
- **Test hooks:** `testID`s — `partner-paystack-form`, `partner-paystack-bank-field`, `partner-paystack-account-input`, `partner-paystack-verify-cta`, `partner-paystack-connect-cta`, `partner-paystack-confirm-name`, `partner-paystack-disconnect`, `partner-paystack-ready-card` (supports SPEC T-15/T-16).
