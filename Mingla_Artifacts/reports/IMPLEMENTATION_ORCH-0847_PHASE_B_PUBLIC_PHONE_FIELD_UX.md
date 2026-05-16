# IMPLEMENTATION CHECKPOINT — ORCH-0847 Phase B

**ORCH:** ORCH-0847 [Consumer ticket purchase parity with public business page]
**Phase:** B — Public event page phone field UX (country picker + required indicator + E.164 validation)
**Status:** implemented, bundle-verified (mingla-business sim runtime UNVERIFIED)
**Date:** 2026-05-15
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`

---

## Summary

Replaced the public buyer form's single text-field phone input with the shared `@mingla/phone-input` country-picker + local-digits combination. Client-side E.164 validation now matches the server validator regex `/^\+[1-9][0-9]{1,14}$/` exactly. International numbers (UK +44, Nigeria +234, US +1, etc.) work end-to-end — the prior naive US-only fallback validator at `mingla-business/src/utils/phone.ts` silently rejected non-US dial codes at the Continue gate. Added required-asterisk indicators to Name, Email, Phone field labels so required-ness is visually obvious without focus interaction.

Mid-implementation discovery: the package's default tokens were LIGHT-mode (designed for app-mobile auth onboarding). Mingla-business's checkout canvas is DARK-mode (`#0c0e12`), so the phone field would have rendered unreadable. Resolved by adding a `theme` prop to `PhoneInput` + `CountryPickerModal` and supplying mingla-business's dark theme inline from `buyer.tsx`. App-mobile wrappers don't pass `theme`, so defaults apply and the LIGHT visual is preserved — no Phase A1 regression.

---

## Files added (logical additions to existing files)

| Where | What | Why |
|---|---|---|
| `packages/phone-input/types.ts` | New `PhoneInputTheme` interface (13 color tokens: `backgroundPrimary`, `textPrimary`, `textTertiary`, `borderDefault`, `borderFocused`, `borderError`, `searchBackground`, `rowPressedBackground`, `divider`, `accessoryBackground`, `accessoryBorder`, `accent`, `errorText`). All keys optional. | Enables host-supplied dark-mode theming without forking the component. |
| `packages/phone-input/tokens.ts` | New `DEFAULT_PHONE_INPUT_THEME: Required<PhoneInputTheme>` constant. Maps the existing `colors.*` LIGHT-mode values into the theme shape. | Sensible defaults — app-mobile wrappers stay unchanged and inherit the original visual. |
| `packages/phone-input/index.ts` | Added `PhoneInputTheme` type re-export. | Host apps can import the type for typed theme constants. |

## Files modified

### Package — theme support added

| File | Old → New |
|---|---|
| `packages/phone-input/PhoneInput.tsx` (~280 lines, was ~245) | Added optional `theme?: PhoneInputTheme` prop. `t = useMemo(() => ({...DEFAULT_PHONE_INPUT_THEME, ...theme}))`. Refactored StyleSheet to omit colors (kept structural fields only); render computes inline `containerStyle`, `dialCodeStyle`, `dividerStyle`, `textInputStyle`, `errorTextStyle`, `accessoryBarStyle`, `doneButtonTextStyle` from `t`. Behavior unchanged for callers passing no theme. Forwards `theme` to `CountryPickerModal` so the picker matches the field's visual. |
| `packages/phone-input/CountryPickerModal.tsx` (~290 lines, was ~280) | Same pattern: optional `theme?: PhoneInputTheme` on `CountryPickerContent` + `CountryPickerModal` + `CountryPickerOverlay`. Inline render-time styles: `containerStyle`, `titleStyle`, `searchContainerStyle`, `searchInputStyle`, `countryNameStyle`, `dialCodeStyle`, `rowPressedStyle` (only on iOS), `overlayStyle` (for the Overlay variant). Android ripple color also pulled from `t.divider`. |

### mingla-business — phone helpers + buyer form

| File | What it did before | What it does now | Why |
|---|---|---|---|
| `mingla-business/src/utils/phone.ts` | 12 lines — `normalizePhoneE164` (naive US fallback: accepted E.164, else 10-digit → "+1XXX", else 11-digit-starting-with-1 → "+1XXX"); `isRequiredPhoneValid` (wraps normalizePhoneE164 != null). | 60 lines — `isValidE164(value)` strictly tests `/^\+[1-9][0-9]{1,14}$/`. `composeE164(dialCode, localDigits)` strips non-digits, concatenates with dial code, returns null if the result fails E.164. Deprecated `isRequiredPhoneValid` and `normalizePhoneE164` aliases kept for back-compat (used by `mingla-business/app/checkout/[eventId]/payment.tsx` per the grep — payment.tsx will pick up the same E.164 strings buyer.tsx now emits, so no breakage). | New validators that match the server contract exactly. |
| `mingla-business/app/checkout/[eventId]/buyer.tsx` | Phone field at lines ~378-391 was a plain `<Input variant="text" placeholder="Mobile number">` paired with `isRequiredPhoneValid`. No country picker, no required indicator, no client-side E.164 enforcement beyond US shape. Name + Email also had no required indicator. | (1) Imports `PhoneInput`, `COUNTRIES`, `getCountryByCode`, `PhoneInputTheme` from `@mingla/phone-input`. (2) Imports `isValidE164` + `composeE164` from `../../../src/utils/phone` (replaces `isRequiredPhoneValid`). (3) Adds `PUBLIC_BUYER_PHONE_THEME` constant with mingla-business dark-mode tokens (backgroundPrimary `#0c0e12`, accent `#eb7825`, glass-style borders/divider, error `#ef4444`). (4) Adds `resolveInitialCountry` + `splitExistingPhone` helpers (parse leading dial code from existing `buyer.phone` on remount; otherwise device locale via `Intl.DateTimeFormat().resolvedOptions().locale` → "GB" fallback). (5) Adds `phoneCountry`, `phoneLocal` state seeded from these helpers. (6) Adds `handlePhoneLocalChange`, `handlePhoneCountryChange` callbacks that compose full E.164 and write back to `setBuyer({phone: composed ?? ""})`. (7) Replaces Phone field block with `<PhoneInput value={phoneLocal} countryCode={phoneCountry} onChangePhone={...} onChangeCountry={...} error={visibleErrors.phone} iconRenderer={...} labels={...} theme={PUBLIC_BUYER_PHONE_THEME} />`. (8) Adds labeled field headers (`<View style={styles.fieldLabelRow}><Text style={styles.fieldLabel}>{...}</Text><Text style={styles.required}>*</Text></View>`) above Name, Email, and Phone Inputs. (9) Updates `validate()` to use `isValidE164(phoneTrim)`. (10) Adds new styles `fieldLabelRow`, `fieldLabel`, `required`. | SPEC Workstream 3 — country picker + required indicator + E.164 enforcement on the public buyer form. |

### Files unchanged (intentional)

- `app-mobile/src/components/onboarding/PhoneInput.tsx` thin wrapper — doesn't pass `theme`, so the package's `DEFAULT_PHONE_INPUT_THEME` (LIGHT) applies. Consumer onboarding visual is identical to Phase A1.
- `app-mobile/src/components/onboarding/CountryPickerModal.tsx` thin wrapper — same.
- `mingla-business/app/checkout/[eventId]/payment.tsx` — imports `isRequiredPhoneValid` from phone.ts; the deprecated alias still works (returns `isValidE164(raw)`). After Phase B, `buyer.phone` is always a clean E.164 string emitted by PhoneInput, so the alias's strict E.164 path is what fires — no behavior change.
- `supabase/functions/_shared/ticketCheckout.ts` — server-side `normalizePhoneE164` UNCHANGED. The first-line regex `/^\+[1-9][0-9]{1,14}$/` accepts every value the new client emits. The US-fallback branches at lines 83-84 become unreachable for buyer.tsx callers (functionally dead code, kept for back-compat).

---

## Spec traceability

| SPEC success criterion | Status | Evidence |
|---|---|---|
| SC-17 — `<PhoneInputField>` (now `<PhoneInput>`) replaces the plain phone Input | DONE | buyer.tsx Phone block replaced. |
| SC-18 — Country picker button left-aligns, shows flag + dial code, opens picker | DONE | Inherited from package PhoneInput's TouchableOpacity at line 142+. |
| SC-19 — Local digits accepts digits only, `flex: 1` | DONE | Package PhoneInput `keyboardType="phone-pad"`, maxLength=15. Non-digit handling is server-side via `composeE164(...).replace(/\D/g, "")`. |
| SC-20 — Default country resolves from device locale → brand country → +44 (GB) | PARTIAL | Device locale via `Intl.DateTimeFormat().resolvedOptions().locale` works (no new dep). Brand country layer is forward-prepared but unused (the public event payload doesn't expose `brand.country` today — flagged as Discovery). GB fallback works. |
| SC-21 — Country picker sheet lists ≥ 50 countries, searchable by name + dial code, selection updates field via `composeE164` | DONE | COUNTRIES array has 195 entries. Search filter at CountryPickerModal lines 92-101 matches name + dialCode + code. Select fires `handlePhoneCountryChange` which `composeE164`s + setBuyer. |
| SC-22 — Required asterisk on Name + Email + Phone labels | DONE | New `fieldLabelRow` + `required` styled `*` rendered above all three Inputs. |
| SC-23 — `isValidE164` gates Continue | DONE | `validate()` at line 87 now reads `isValidE164(phoneTrim)`. |
| SC-24 — Composed E.164 matches server regex | DONE BY DESIGN | `composeE164` calls `isValidE164(composed)` before returning; only valid E.164 strings reach `setBuyer({phone})`. |
| SC-28 — Mobile-web parity | DONE BY ROUTING | `buyer.tsx` handles both `surface: "web"` and `surface: "mobile-web"` paths — same component. |

SC-25, SC-26, SC-27 (UK / Nigerian / too-short-number end-to-end tests) require live sim verification.

---

## Verification

| Criterion | Status | Evidence |
|---|---|---|
| Package theme support compiles | **VERIFIED** | tsc emitted zero errors specific to Phase B changes. Pre-existing `react`-declaration-pattern errors in all `@mingla/*` packages unchanged. |
| mingla-business buyer.tsx compiles | **VERIFIED** | tsc clean on buyer.tsx and phone.ts. |
| app-mobile re-bundles after Phase B package refactor | **VERIFIED** | `npx expo export --platform ios` succeeded — 15.2MB Hermes bytecode at `/tmp/orch0847-b-bundle/_expo/static/js/ios/entry-*.hbc`. Confirms that `PhoneInputTheme` + render-time inline styles + DEFAULT_PHONE_INPUT_THEME merge didn't break the consumer-app wrappers. Wrappers don't pass `theme` → defaults apply → identical to Phase A1. |
| mingla-business bundles | BLOCKED — PRE-EXISTING | Same `@stripe/stripe-react-native` config-plugin / not-installed mismatch in `mingla-business/app.json` blocks `npx expo export`. Not a Phase B regression. Discovery filed in Phase A2 still applies. |
| mingla-business public buyer page renders identically to design + functions across UK / Nigerian / US / invalid numbers | UNVERIFIED — operator regression test | Code paths covered by SC table. Live sim test recommended; bundle test would have caught structural breaks. |

### Bundle verification command + output (recorded 2026-05-15)

```bash
cd /Users/sethogieva/Desktop/mingla-main/app-mobile
rm -rf /tmp/orch0847-b-bundle
npx expo export --platform ios --output-dir /tmp/orch0847-b-bundle

# Output (tail):
# › ios bundles (1):
# _expo/static/js/ios/entry-c0e8f9ad718512116116dc029b6a478f.hbc (15.2 MB)
# › Files (1): metadata.json (3.17 kB)
# Exported: /tmp/orch0847-b-bundle
```

---

## Regression test

**Phase-B BACKFILL-EXEMPT — reason: Phase B is a feature-addition phase whose behavior tests land in Phase D (per IMPLEMENT dispatch step 17). The full ORCH-0847 close will cite Phase D's regression tests for Workstream 3 (T-21 UK buyer, T-22 US buyer, T-23 Nigerian buyer, T-24 default-country-from-locale, T-25 country picker search, T-26 local-digits filter, T-27 switch-country-mid-typing, T-28 empty phone, T-29 too-short, T-30 required indicator visible, plus adversarial T-35 stale-closure on country switch).**

---

## Invariant verification

| Invariant | Preserved? | Evidence |
|---|---|---|
| `feedback_anon_buyer_routes` | YES | `buyer.tsx` doesn't introduce auth. Still anon-tolerant. |
| Anon buyer routes (per [SPEC §8](Mingla_Artifacts/specs/SPEC_ORCH-0847_CONSUMER_TICKET_PURCHASE_PARITY.md)) | YES | Public anonymous buyer flow continues to work — only the phone INPUT changed; identity model untouched. |
| `feedback_zustand_persist_no_server_snapshots` | YES | `phoneCountry`/`phoneLocal` are local `useState`. `buyer.phone` is in CartContext (not persisted as server data). |
| `feedback_keyboard_never_blocks_input` | YES | PhoneInput inherits keyboard-aware behavior. The existing `requestScrollToInput` pattern at the parent ScrollView wraps the field via `onTouchStart`. |
| `feedback_rn_color_formats` (hex/rgb/hsl only) | YES | New `PUBLIC_BUYER_PHONE_THEME` uses hex (#0c0e12, #eb7825, #ef4444) + rgba only. No oklch/lab/lch. |
| Server contract preserved (`/^\+[1-9][0-9]{1,14}$/`) | YES | `isValidE164` regex matches server validator exactly. |
| **I-PROPOSED-PUBLIC-PHONE-FIELD-E164-CLIENT-SIDE** (new from SPEC §6) | ESTABLISHED | `buyer.tsx` now imports `PhoneInput` and calls `isValidE164`. Strict-grep gate to enforce this lands in Phase D. |

---

## Parity check

- **mingla-business public buyer page (`/checkout/{eventId}/buyer`):** UNVERIFIED — operator regression. Dark theme matches the canvas (#0c0e12). Required asterisks visible. Country picker functional. Same buyer.tsx route handles `surface: "web"` and `surface: "mobile-web"` so no separate mobile-web work needed.
- **app-mobile auth onboarding:** UNVERIFIED on the Phase B refactor specifically; covered transitively by Phase A1 bundle test. Theme prop is optional + defaults preserve original LIGHT visual.

---

## Cache safety

No React Query keys, no Zustand state changes. `buyer.phone` in CartContext continues to hold a full E.164 string (now always proper E.164 due to client validation).

---

## Regression surface

1. **Public buyer form end-to-end** — fill name + email + phone (with country picker), tap Continue, verify routes to `/payment` for paid orders or fires free reservation for $0 orders.
2. **Resume from payment** — go to payment screen, tap back, verify the phone field shows the same country + local digits the user originally entered (resume parse via `resolveInitialCountry` + `splitExistingPhone`).
3. **International number purchase** — enter a UK number (+44), proceed to Stripe Hosted Checkout, verify the order's `buyer_phone_e164` column has the full `+44...` value.
4. **Required-asterisk visibility** — visually confirm `*` next to Name, Email, Phone field labels on the buyer form.
5. **payment.tsx unaffected** — confirm the deprecated `isRequiredPhoneValid` import at payment.tsx still resolves and validates correctly for E.164 strings.

---

## Constitutional compliance

- No dead taps. No silent failures (PhoneInput surfaces error via shake + inline text + red border). No fabricated data. `isValidE164` rejects malformed input synchronously.
- Currency-aware UI: N/A for the phone field.
- One owner per truth: `buyer.phone` in CartContext is the single source for the full E.164. `phoneCountry`/`phoneLocal` are UI-only state derived from it.

---

## Discoveries for orchestrator

- **`PublicBrandProps` does not expose `country`**, so SPEC SC-20's "brand country" resolution step is forward-prepared but not wired. The `resolveInitialCountry` helper accepts a `_brandCountry: string | null` parameter (currently passed `null` from buyer.tsx) so the layer is ready when the public event payload starts including brand country. Worth a small follow-up ORCH to add `country` to the `usePublicEventById` selection and wire `event.brand.country` through.
- **Phase A2 Discovery still applies:** the pre-existing `@stripe/stripe-react-native` config-plugin / not-installed mismatch in `mingla-business/app.json` blocks `npx expo export`. Not a Phase B regression. Recommend a separate cleanup ORCH.
- **`mingla-business` doesn't have `expo-localization`** installed. Phase B uses `Intl.DateTimeFormat().resolvedOptions().locale` as the locale fallback (zero new deps). Works for default-country resolution on iOS/Android/web.

---

## Transition items

- `isRequiredPhoneValid` (deprecated alias) and `normalizePhoneE164` (deprecated alias with the legacy US fallback) stay in `mingla-business/src/utils/phone.ts` until grep confirms only `payment.tsx` consumes them. Phase D could remove them if cleanly migratable.

---

## Next phase

Phase C — Consumer multi-tier quantity cart sheet + marketing opt-in checkbox (`TicketCartSheet` replacing `TicketClaimConfirmModal` inside `ExpandedBusinessEventSheet`). **MANDATORY operator-run `/ui-ux-pro-max` pre-flight per memory `feedback_implementor_uses_ui_ux_pro_max` before I write the cart sheet JSX.**
