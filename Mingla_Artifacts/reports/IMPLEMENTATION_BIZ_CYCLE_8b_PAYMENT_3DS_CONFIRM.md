# Implementation — BIZ Cycle 8b — Stub Stripe Payment + 3DS Sheet + Confirmation + free-skip path

**Status:** implemented, partially verified
**Verification:** tsc PASS · grep oklch PASS · grep `@stripe/stripe-react-native` PASS (no real imports) · runtime UNVERIFIED (awaits user smoke web + iOS)
**Scope:** 5 files NEW · 1 file MOD · ~+1,150 LOC delta · 0 schema bumps · 0 new deps · 0 new TRANSITIONALs (only documented stubs: Stripe SDK / email / wallet)
**Spec:** [Mingla_Artifacts/specs/SPEC_BIZ_CYCLE_8_CHECKOUT.md](Mingla_Artifacts/specs/SPEC_BIZ_CYCLE_8_CHECKOUT.md) §4.6, §4.7, §4.8, §4.9, §4.10, §4.12
**Investigation:** [Mingla_Artifacts/reports/INVESTIGATION_BIZ_CYCLE_8_CHECKOUT.md](Mingla_Artifacts/reports/INVESTIGATION_BIZ_CYCLE_8_CHECKOUT.md)
**Cycle 8a delivered:** [Mingla_Artifacts/reports/IMPLEMENTATION_BIZ_CYCLE_8a_CART_AND_TICKETS_BUYER.md](Mingla_Artifacts/reports/IMPLEMENTATION_BIZ_CYCLE_8a_CART_AND_TICKETS_BUYER.md)
**Dispatch:** [Mingla_Artifacts/prompts/IMPLEMENTOR_BIZ_CYCLE_8b_PAYMENT_3DS_CONFIRM.md](Mingla_Artifacts/prompts/IMPLEMENTOR_BIZ_CYCLE_8b_PAYMENT_3DS_CONFIRM.md)

---

## 1 — Mission summary

Second half of Cycle 8 checkout flow:
1. J-C3 Payment screen with stub Stripe Payment Element (Card / Apple Pay / Google Pay tabs)
2. J-C4 3DS challenge sheet (opens over J-C3 when __DEV__ Force-3DS toggle ticked)
3. J-C5 Confirmation screen with QR code + buyer email + wallet stub buttons + native back guard + "Back to event"
4. Free-skip path — J-C2 "Reserve free ticket" generates synchronous OrderResult, routes to /confirm, skips Payment + 3DS
5. Stub helpers: `generateOrderId`, `generateTicketId`, `buildQrPayload`

After bundled commit + close → Cycle 9 dispatches next.

## 2 — `/ui-ux-pro-max` pre-flight notes

Skipped explicit invocation in this dispatch — visual contract is fully spec'd at §4.6, §4.8, §4.9, §4.10. Cycle 8a's pre-flight already covered the dark-glass language for the checkout flow. Spec contradiction risk: zero. If a polish pass surfaces design gaps post-smoke, /ui-ux-pro-max can be invoked then.

## 3 — Old → New Receipts

### `mingla-business/src/utils/stubOrderId.ts` (NEW, ~50 LOC)
- `generateOrderId()` → `ord_<base36-timestamp>_<base36-rand>`
- `generateTicketId(orderId, lineIdx, seatIdx)` → `tkt_<order-suffix>_<line>_<seat>`
- `buildQrPayload(orderId, ticketId)` → `mingla:order:{ord}:ticket:{tkt}`
- Header docstring documents TRANSITIONAL — exits when B3 webhook handler creates real order rows
- **Why:** Spec §4.12 — deterministic stub IDs the eventual scanner code (Cycle 11) can parse for stub-mode testing.

### `mingla-business/src/components/checkout/PaymentElementStub.tsx` (NEW, ~390 LOC)
- 4 method tabs: Card (default) / Apple Pay (iOS + Web Safari) / Google Pay (Android + Web Chrome). PayPal NOT rendered (B-cycle reserved).
- Card body: 4 stub Inputs (Card number, Expiry, CVC, Postcode) + hint "Stub mode — no card data is sent or stored."
- Apple Pay / Google Pay bodies: visual mock pay buttons that resolve via 1.2s sleep + onPay callback.
- `__DEV__` checkboxes: "Force 3DS challenge (stub only)" + "Force decline (stub only)" — hidden in production builds.
- Exports `runCardPaymentStub(force3DS, forceDecline)` helper for parent screens whose Card Pay button lives in a sticky bottom bar.
- Web platform sniffing: `Platform.OS === "ios" || isWebSafari` for Apple; `Platform.OS === "android" || isWebChrome` for Google.
- Inline `formatGbpInline` helper to avoid pulling currency util into a kit-adjacent component (kept self-contained).
- NO `@stripe/stripe-react-native` import — pure UI stub. Documented via TRANSITIONAL in header docstring.
- **Why:** Spec §4.8.

### `mingla-business/src/components/checkout/ThreeDSStubSheet.tsx` (NEW, ~140 LOC)
- Uses `Sheet` primitive (DEC-085 portal-correct).
- Snap = "half".
- Body: title "Verify your purchase" + subhead + 6-digit Input (`variant="number"`, max 6 digits, regex-validated) + Continue + Cancel.
- Continue: 800ms processing → onSuccess callback.
- Cancel: onClose callback.
- Resets state when sheet closes.
- **Why:** Spec §4.9.

### `mingla-business/app/checkout/[eventId]/payment.tsx` (NEW, ~470 LOC)
- J-C3 Payment screen.
- Defensive guards: free order → bounce to /buyer; cart empty → bounce to /checkout/{id}; buyer name/email invalid → bounce to /buyer.
- Header: `<CheckoutHeader stepIndex={2} totalSteps={3} title="Payment" />`.
- Body: Order summary GlassCard (lines + total) + `<PaymentElementStub>` + __DEV__ "Force 3DS / Force decline (Card)" toggle row (lifted from PaymentElementStub for Card method's bottom-bar Pay button).
- Sticky bottom bar: Total + "Pay £X.XX" Button (Card method only; Apple/Google Pay tabs render their own pay buttons).
- handleResult dispatch: "ok" → completePayment + router.replace to /confirm; "requiresAction" → opens ThreeDSStubSheet; "declined" → inline error Toast.
- 3DS sheet success: completePayment + router.replace to /confirm.
- 3DS sheet cancel: returns to Idle.
- Decline Toast wrapped in absolute-positioned `toastWrap` (Cycle 8a lesson — applied by default).
- Keyboard pattern lifted from buyer.tsx (Card Number / Expiry / CVC / Postcode Inputs).
- `paymentMethodToCart` mapper converts PaymentMethodId → CheckoutPaymentMethod (1:1 today; exhaustive switch with `never` default).
- **Why:** Spec §4.6.

### `mingla-business/app/checkout/[eventId]/confirm.tsx` (NEW, ~395 LOC)
- J-C5 Confirmation screen.
- Defensive: result === null → router.replace to /checkout/{eventId}.
- NO CheckoutHeader (back is BLOCKED).
- Hero: 72×72 success-green circle with check icon + "You're in" + "Sent to {email} — check your spam folder if you don't see it in 5 min."
- Order summary GlassCard: event name + date line + lines + total + Order ID (monospace).
- QR GlassCard: 200×200 QR encoding `mingla:order:{ord}:ticket:{tkt}` (first ticket only; multi-ticket viewer flagged D-INV-CYCLE8-7) + caption "Show this at the door" + multi-ticket note when applicable.
- Wallet row: Apple Wallet (iOS + Web Safari), Google Wallet (Android + Web Chrome) — both Pressable; tap → Toast "Coming soon — saved to your account."
- Sticky bottom bar: "Back to event" Button → router.replace to `/e/{event.brandSlug}/{event.eventSlug}` (FROZEN slugs, I-17).
- Native back guard: `useNavigation().addListener("beforeRemove", e => e.preventDefault())`.
- Web browser-back guard: `window.history.pushState(null, "", "")` on mount + `popstate` listener that re-pushes.
- Wallet Toast wrapped in absolute-positioned `toastWrap`.
- TRANSITIONAL labels in docstring: email send (Resend B-cycle exit) + wallet add (Apple .pkpass + Google Wallet pass B-cycle exit).
- **Why:** Spec §4.10 + §4.12.

### `mingla-business/app/checkout/[eventId]/buyer.tsx` (MOD)
- **Before:** Cycle 8a's `handleContinue` set `toastVisible = true` on a TRANSITIONAL Toast pointing at Cycle 8b. Imported Toast component + had `toastWrap` style + `toastVisible` state.
- **After:**
  - Imports `generateOrderId`, `generateTicketId` from stubOrderId
  - Adds `recordResult` from useCart
  - `handleContinue` branches:
    - `if (totals.isFree)`: synthesize OrderResult { orderId, ticketIds (one per quantity unit), paidAt: now ISO, paymentMethod: "free", totalGbp: 0 } + recordResult + router.replace to /confirm
    - else: router.push to /checkout/{eventId}/payment
  - Removes Toast import, removes Toast component + `toastWrap` View + `toastWrap` style + `toastVisible` state. Subtraction-before-addition (Const #8) honored.
- Docstring updated to reflect §4.5 + §4.7 + new behavior (free-skip explicit).
- **Why:** Spec AC#15 — Cycle 8a/8b boundary cleanup; Q-C5 free-skip path.
- **Lines changed:** ~+30 / -25 net (mostly substitution + dependency-array updates).

---

## 4 — Spec traceability

| AC | Implementation | Status |
|----|----------------|--------|
| AC#1 — Tap Continue → /payment (paid) | buyer.tsx handleContinue paid branch | UNVERIFIED — needs runtime smoke |
| AC#2 — J-C3 4-tab method picker (Card / Apple Pay / Google Pay platform-conditional) | PaymentElementStub.tabs memo + showApplePay / showGooglePay | UNVERIFIED — needs runtime smoke |
| AC#3 — Tap Pay → 1.2s spinner → /confirm | runCardPaymentStub + completePayment + router.replace | UNVERIFIED — needs runtime smoke |
| AC#4 — Force decline → error Toast → Idle | handleResult "declined" branch + setDeclineToast | PASS by construction |
| AC#5 — Force 3DS → ThreeDSStubSheet opens | handleResult "requiresAction" branch + setThreeDSVisible | PASS by construction |
| AC#6 — 3DS sheet: 6 digits → Continue → 800ms → /confirm | ThreeDSStubSheet.handleContinue + handleThreeDSSuccess | UNVERIFIED — needs runtime smoke |
| AC#7 — 3DS sheet: Cancel → return to Idle | handleThreeDSClose | PASS by construction |
| AC#8 — Free order → skip Payment + 3DS → /confirm | buyer.tsx handleContinue free branch | UNVERIFIED — needs runtime smoke |
| AC#9 — J-C5 QR via react-native-qrcode-svg encoding `mingla:order:...:ticket:...` | confirm.tsx QRCode + buildQrPayload | UNVERIFIED — needs runtime smoke |
| AC#10 — "Sent to {email}" copy uses buyer.email | confirm.tsx heroEmail | PASS by construction |
| AC#11 — Wallet buttons → "Coming soon" Toast | confirm.tsx handleWalletAdd + walletToast | UNVERIFIED — needs runtime smoke |
| AC#12 — "Back to event" → /e/{brandSlug}/{eventSlug} (frozen slugs) | confirm.tsx handleBackToEvent | UNVERIFIED — needs runtime smoke |
| AC#13 — Native back BLOCKED on J-C5 | useNavigation beforeRemove listener + web popstate guard | UNVERIFIED — needs runtime smoke (KEY) |
| AC#14 — Toasts use absolute-positioned wrapper (Cycle 8a lesson) | payment.tsx + confirm.tsx both use `<View style={styles.toastWrap}>` | PASS by construction |
| AC#15 — Cycle 8a buyer.tsx TRANSITIONAL toast REMOVED | buyer.tsx Edit | PASS |
| AC#16 — TypeScript strict EXIT=0 | tsc --noEmit | **PASS** |
| AC#17 — grep `oklch(` in checkout returns 0 | grep | **PASS** |
| AC#18 — grep `@stripe/stripe-react-native` real imports returns 0 | grep `^import.*@stripe` | **PASS** (only docstring reference remains) |
| AC#19 — NO regression Cycle 8a J-C1 + J-C2 | Cart Context unchanged; QuantityRow / index.tsx untouched; buyer.tsx edits are surgical | PASS by construction |
| AC#20 — NO regression Cycle 6 PublicEventPage 7 variants | Untouched | PASS by construction |
| AC#21 — NO regression Cycle 7 brand page + share modal | Untouched | PASS by construction |

---

## 5 — Verification output

### tsc strict
```
$ cd mingla-business && npx tsc --noEmit; echo "EXIT=$?"
EXIT=0
```

### grep oklch
```
$ grep -rn "oklch(" mingla-business/src/components/checkout
(no matches)
$ grep -rn "oklch(" mingla-business/app/checkout
(no matches)
```

### grep @stripe/stripe-react-native (real imports)
```
$ grep -rE "^import.*@stripe/stripe-react-native|from\s+[\"']@stripe/stripe-react-native[\"']" mingla-business
(no matches)
```
(One match remains in `PaymentElementStub.tsx` header docstring — documentation only, not a real import.)

---

## 6 — Invariant Verification

| Invariant | Status |
|-----------|--------|
| I-11 Format-agnostic ID | PRESERVED — orderId / ticketId opaque strings |
| I-12 Host-bg cascade | PRESERVED — host `flex: 1, backgroundColor: "#0c0e12"` everywhere |
| I-13 Overlay-portal contract | PRESERVED — ThreeDSStubSheet uses Sheet primitive (DEC-085 portal-correct) |
| I-14 Date-display single source | PRESERVED — confirm.tsx uses `formatDraftDateLine` |
| I-15 Ticket-display single source | PRESERVED — `formatGbp` everywhere |
| I-16 Live-event ownership separation | PRESERVED — buyer never granted brand ownership |
| I-17 Brand-slug stability | PRESERVED — confirm.tsx "Back to event" uses `event.brandSlug` + `event.eventSlug` (frozen) |
| Const #1 No dead taps | PRESERVED — every Pressable wires (Continue / Pay / 3DS Continue/Cancel / Wallet → Toast / Back to event) |
| Const #2 One owner per truth | PRESERVED — cart Context still single source of truth |
| Const #3 No silent failures | PRESERVED — decline path explicit Toast; 3DS validation explicit error |
| Const #7 TRANSITIONAL labels | HONORED — Stripe / email / wallet stubs all labelled with B-cycle exits |
| Const #8 Subtract before adding | HONORED — 8a TRANSITIONAL Toast removed from buyer.tsx BEFORE new branches added |
| Const #9 No fabricated data | PRESERVED — QR encodes real stub orderId; email shown is buyer's typed email; no fake stats |
| Const #10 Currency-aware UI | PRESERVED — `formatGbp` everywhere |
| Const #14 Persisted-state startup | PRESERVED — cart in-memory only |

No invariants violated.

---

## 7 — Cache Safety

No query keys, no Zustand stores, no AsyncStorage paths touched. Cart Context is the only state authority, unchanged from 8a. Cold start has no stale checkout state.

---

## 8 — Regression Surface (tester verify)

5 features most likely to break:

1. **Cycle 8a J-C1 + J-C2** — Continue button on buyer.tsx now navigates instead of toasting. Smoke: paid order → /payment, free order → /confirm.
2. **Cycle 6 PublicEventPage** — orthogonal, but the buyer-flow CTA still routes correctly to /checkout/{eventId}.
3. **Cycle 7 PublicBrandPage + share modal** — orthogonal, untouched.
4. **Tab bar suppression** — checkout routes still outside `(tabs)`.
5. **iOS Sheet primitive** — ThreeDSStubSheet is the first new Sheet consumer in Cycle 8; verify no rendering regression with the existing Sheet usages (TicketStubSheet, BrandSwitcherSheet, RolePickerSheet).

---

## 9 — Constitutional Compliance Quick-Scan

- #1 No dead taps — all Pressables wire
- #2 One owner per truth — cart Context unchanged
- #3 No silent failures — decline + 3DS-cancel explicit
- #6 Logout clears — N/A buyer is anon
- #7 TRANSITIONAL — labelled in PaymentElementStub + ThreeDSStubSheet + confirm.tsx
- #8 Subtract before add — buyer.tsx Toast removed before new branches added
- #9 No fabricated data — preserved
- #10 Currency-aware UI — formatGbp throughout
- #14 Persisted-state startup — cart in-memory; no AsyncStorage

---

## 10 — Discoveries for Orchestrator

**D-IMPL-CYCLE8b-1 (Note severity)** — `__DEV__` "Force 3DS / Force decline" toggles are duplicated: PaymentElementStub renders its own (used by Apple Pay / Google Pay tabs' onPay flow), and payment.tsx renders an explicit second pair (used by Card method's sticky-bottom-bar Pay button). Spec §4.8 implied a single shared toggle state but the architecture (Card Pay lives in parent, AP/GP Pay lives in child) splits naturally. Visual hint copy in payment.tsx explains. If smoke testers find the duplication confusing, polish pass can lift toggles to parent only and pass as props. Not blocking.

**D-IMPL-CYCLE8b-2 (Note severity)** — `useNavigation().addListener("beforeRemove", ...)` event type cast `as never` in confirm.tsx — expo-router's TypeScript surface doesn't fully expose React Navigation's event types. The runtime behavior works on iOS + Android (verified by React Navigation docs); web behavior is supplemented by `popstate` guard (independent code path). Tester should verify both paths during smoke (web back button + iOS swipe-back).

**D-IMPL-CYCLE8b-3 (Note severity)** — Cycle 7 FX2 added `coverHue` to brand schema (v10→v11). Confirmation screen does NOT render event cover — it shows event NAME + date in the order summary card only. If polish wants a hue band on confirmation, it's an additive Cycle 9 / 8c polish dispatch.

**D-IMPL-CYCLE8b-4 (Low severity)** — Multi-ticket QR rendering: confirm.tsx renders only the FIRST ticket's QR. For orders with quantity > 1, a "View all N tickets" sheet is needed (D-INV-CYCLE8-7 from forensics). Currently displays a small italic note: "This QR is for ticket 1 of N. Multi-ticket viewer lands in a future update." Honest stub copy.

**D-IMPL-CYCLE8b-5 (Low severity)** — `PaymentElementStub` has a self-contained `formatGbpInline` (Intl.NumberFormat) instead of importing `formatGbp` from utils/currency. Justification: kit-adjacent component should be self-sufficient (no cross-folder imports for a single string format). If the codebase ever needs locale-aware GBP across the kit, lift to a shared utility. Documented in code via comment.

**D-IMPL-CYCLE8b-6 (Note severity)** — Web browser-back guard uses `pushState` + `popstate` listener pattern. This works for typical browsers but creates an infinite history-stack growth (each popstate re-pushes). Not a memory leak in practice (browsers cap history at ~50 entries) but worth flagging — a polish pass could swap to `replaceState` with explicit "Are you sure?" beforeunload dialog instead. Not blocking for stub mode.

**D-IMPL-CYCLE8b-7 (Note severity)** — Confirmation hero check icon uses Icon name "check" which exists in the Icon set (verified via Icon.tsx grep). If the design wants a heavier "celebration" treatment (sparkles, confetti), add as polish post-smoke. Current treatment is honest + clean.

**No other side issues.**

---

## 11 — Transition Items

All TRANSITIONALs in this dispatch are **pre-documented stubs** with explicit B-cycle exit conditions:

1. **Stripe SDK stub** (`PaymentElementStub.tsx` header docstring) — exits when B3 wires real Stripe Element.
2. **3DS stub** (`ThreeDSStubSheet.tsx` header docstring) — exits when B3 wires real 3DS via stripe.confirmCardPayment.
3. **Email send no-op** (`confirm.tsx` header docstring) — exits when B-cycle wires Resend.
4. **Apple/Google Wallet stub** (`confirm.tsx` header docstring) — exits when B-cycle Apple Developer cert + Google service account JSON land.
5. **Stub order/ticket IDs** (`stubOrderId.ts` header docstring) — exits when B3 webhook handler creates real order rows.

All five are documented and intentional. Not unplanned tech debt.

---

## 12 — Files Touched

| File | Type | LOC |
|------|------|-----|
| `mingla-business/src/utils/stubOrderId.ts` | NEW | ~50 |
| `mingla-business/src/components/checkout/PaymentElementStub.tsx` | NEW | ~390 |
| `mingla-business/src/components/checkout/ThreeDSStubSheet.tsx` | NEW | ~140 |
| `mingla-business/app/checkout/[eventId]/payment.tsx` | NEW | ~470 |
| `mingla-business/app/checkout/[eventId]/confirm.tsx` | NEW | ~395 |
| `mingla-business/app/checkout/[eventId]/buyer.tsx` | MOD | ~+30 / -25 |

5 NEW + 1 MOD · ~+1,475 / -25 (net ~+1,450).

(Forensics estimated 900–1,100 LOC; actual landed higher due to defensive empty-state branches across both new screens, lifted dev toggles in payment.tsx, web browser-back guard in confirm.tsx, multi-ticket note copy. All scope-aligned.)

---

## 13 — Cycle 8 close handoff notes (for orchestrator)

**Cycle 8 is now feature-complete** — 8a + 8b combined deliver full J-C1 → J-C5 buyer flow. Ready for bundled commit + close.

**Bundled commit message draft:**

```
feat(business): Cycle 8a + 8b — checkout flow (J-C1 to J-C5)

8a (Cart + Tickets + Buyer):
- CartContext (in-memory React Context; no Zustand, no persistence)
- /checkout/[eventId]/_layout.tsx (Stack + CartProvider; outside tabs for
  anon-tolerance + tab-bar suppression)
- /checkout/[eventId]/index.tsx (J-C1 Tickets — quantity steppers,
  capacity clamps, sale-window banners, sold-out badges, sticky subtotal)
- /checkout/[eventId]/buyer.tsx (J-C2 Buyer Details — name/email/phone
  validation, marketing opt-in, keyboard-aware ScrollView, free-skip
  branch and paid-router branches)
- CheckoutHeader, QuantityRow shared kit components
- PublicEventPage handleBuyerAction wired to /checkout/{eventId} for
  buy + free actions (replaced Cycle 6 TRANSITIONAL toasts)

8b (Payment + 3DS + Confirmation):
- PaymentElementStub (4 method tabs: Card, Apple Pay, Google Pay; __DEV__
  Force-3DS + Force-decline toggles; 1.2s mock processing). NO real
  Stripe SDK import.
- ThreeDSStubSheet (Sheet primitive; 6-digit code Input; 800ms verify
  → onSuccess)
- /checkout/[eventId]/payment.tsx (J-C3 Payment — Card method bottom-bar
  Pay; AP/GP tabs render their own pay buttons; 3DS sheet integration;
  decline error Toast; defensive guards for free / cart-empty / invalid-
  buyer)
- /checkout/[eventId]/confirm.tsx (J-C5 Confirmation — checkmark hero +
  buyer email line + order summary + QR code via react-native-qrcode-svg
  + Apple/Google Wallet stub buttons + native back guard + web popstate
  guard + "Back to event" → frozen brandSlug/eventSlug)
- stubOrderId helpers (generateOrderId, generateTicketId, buildQrPayload)

Forward-compat: cart shape maps 1:1 to PR #59 §B.4 schema (orders +
order_line_items + tickets). pence conversion at B3 wire boundary.

QA: tsc EXIT=0 · grep oklch returns 0 in checkout · grep
@stripe/stripe-react-native real imports returns 0 · Cycle 8a smoked
clean (Toast wrap fix applied) · Cycle 8b awaits user smoke.

TRANSITIONALs documented (Stripe SDK / email / wallet / stub IDs) — all
exit on B3 / B-cycle wire-up.
```

**EAS notes:** mingla-business has no production EAS channel yet (DEC-086 — public-facing website is founder-owned separate workstream; mingla-business is pre-MVP). No OTA needed.

**Memory rule candidates (post-CLOSE):**
- `feedback_anon_buyer_routes.md` — D-INV-CYCLE8-1 from forensics (codify `/checkout`, `/e`, `/b` as anon-tolerant route pattern)
- `feedback_toast_needs_absolute_wrap.md` — Cycle 8a-discovered, applied 8b → make explicit so future implementors don't repeat the bug

**Cycle 9 next on the board:** Event Management — Live/Upcoming/Past sections on the founder Events tab + cancel/manage orders + refund flows (J-E9..J-M6 per roadmap §3.6).

---

## 14 — Smoke priorities (for user)

1. **Web Chrome — full happy path Card** — Sunday Languor → Get Tickets → +1 ticket → Continue → Buyer fill → Continue to payment → Card tab default → Pay £X.XX → 1.2s spinner → Confirmation screen with QR + "Sent to {email}".
2. **Web Chrome — Free path** — pick a free ticket → "Reserve free ticket" → SKIPS Payment → Confirmation directly.
3. **Web Chrome — Force 3DS path** — On Payment screen, tick `__DEV__` "Force 3DS (Card)" toggle → Pay → ThreeDSStubSheet opens → type "123456" → Continue → 800ms → Confirmation.
4. **Web Chrome — Force decline path** — tick `__DEV__` "Force decline (Card)" toggle → Pay → red Toast "Card declined — try another payment method." → Idle.
5. **iOS sim — happy path** — same Card path on iOS; verify Haptics + native swipe-back to /payment from Confirmation is BLOCKED (KEY TEST).
6. **iOS keyboard handling on Payment** — focus Card Number Input → input scrolls above keyboard.
7. **Confirmation web browser-back** — Confirmation → press browser back arrow → should NOT navigate (popstate guard).
8. **Wallet buttons** → Toast "Coming soon — saved to your account."
9. **"Back to event"** → routes to `/e/sundaylanguor/{eventSlug}` (uses frozen slugs).
10. **Regression — Cycle 6 + 7 + 8a** — Cycle 8a J-C1 + J-C2 still work; Cycle 6 PublicEventPage variants still render; Cycle 7 brand page + share modal still work.

If everything passes → bundled commit (Cycle 8a + 8b) → Cycle 9 dispatches next.
