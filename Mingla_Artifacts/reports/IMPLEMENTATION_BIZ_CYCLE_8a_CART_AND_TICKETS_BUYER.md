# Implementation — BIZ Cycle 8a — Cart Context + entry edit + J-C1 Tickets + J-C2 Buyer Details

**Status:** implemented, partially verified
**Verification:** tsc PASS · grep PASS · runtime UNVERIFIED (awaits user smoke web + iOS)
**Scope:** 7 files NEW · 1 file MOD · ~+850 LOC delta · 0 schema bumps · 0 new deps · 1 TRANSITIONAL (Cycle 8a/8b boundary toast)
**Spec:** [Mingla_Artifacts/specs/SPEC_BIZ_CYCLE_8_CHECKOUT.md](Mingla_Artifacts/specs/SPEC_BIZ_CYCLE_8_CHECKOUT.md) §4.1, 4.2, 4.3, 4.4, 4.5, 4.11
**Investigation:** [Mingla_Artifacts/reports/INVESTIGATION_BIZ_CYCLE_8_CHECKOUT.md](Mingla_Artifacts/reports/INVESTIGATION_BIZ_CYCLE_8_CHECKOUT.md)
**Dispatch:** [Mingla_Artifacts/prompts/IMPLEMENTOR_BIZ_CYCLE_8a_CART_AND_TICKETS_BUYER.md](Mingla_Artifacts/prompts/IMPLEMENTOR_BIZ_CYCLE_8a_CART_AND_TICKETS_BUYER.md)

---

## 1 — Mission summary

First half of Cycle 8 checkout flow:
1. PublicEventPage "Get tickets" CTA wires to `/checkout/{eventId}` (replaces TRANSITIONAL toast from Cycle 6)
2. Cart Context provider (in-memory, no persistence)
3. J-C1 Tickets screen with quantity steppers + sticky subtotal + Continue
4. J-C2 Buyer Details screen with name/email/phone/marketing-opt-in + inline validation + keyboard-aware ScrollView

Continue button on J-C2 fires a TRANSITIONAL toast pointing at Cycle 8b. Same pattern Cycle 6 used to hand off to Cycle 8.

## 2 — `/ui-ux-pro-max` pre-flight notes

Ran `python "c:\\Users\\user\\Desktop\\mingla-main\\.claude\\skills\\ui-ux-pro-max\\scripts\\search.py" "mobile checkout ticket quantity buyer dark glass" --domain ux -n 6`. 6 results returned covering: mobile keyboards (use appropriate keyboard type — already covered by Input variant=email), mobile-first responsive (default mobile + breakpoints — N/A here, RN), pull-to-refresh (disable where not needed — checkout doesn't use), table handling (N/A), back-button predictability (preserve nav history — Cycle 8a uses native router.back which preserves), mobile typography. NO contradictions with the spec. Spec §4.4 / §4.5 visual contracts retained verbatim.

## 3 — Old → New Receipts

### `mingla-business/src/components/event/PublicEventPage.tsx` (MOD)
- **Before:** `handleBuyerAction` switch — `case "buy"` and `case "free"` both showed TRANSITIONAL toasts ("Online checkout lands Cycle 8...").
- **After:** `case "buy" | "free"` falls through to `router.push(\`/checkout/${event.id}\`)`. Approval / waitlist / password cases unchanged. useCallback deps now include `router` and `event.id`.
- **Why:** Spec §4.1 entry-point edit — Cycle 8 contract.
- **Lines changed:** ~+5 / -8.

### `mingla-business/src/components/checkout/CartContext.tsx` (NEW, ~225 LOC)
- React Context + useReducer; NO Zustand, NO persistence.
- Exports: `CartProvider`, `useCart`, `useCartTotals` (derived hook), types `CartLine`, `BuyerDetails`, `CheckoutPaymentMethod`, `OrderResult`, `CartState`, `CartContextValue`, `CartTotals`.
- Reducer actions: `SET_LINE_QUANTITY` (with quantity ≤ 0 → remove line), `SET_BUYER` (partial patch), `RECORD_RESULT` (8b), `RESET`.
- Strict types throughout; exhaustive switch with `never` default.
- **Why:** Spec §4.3 — single source of truth for the 5 checkout screens.

### `mingla-business/app/checkout/[eventId]/_layout.tsx` (NEW, ~30 LOC)
- Stack provider wrapped in CartProvider.
- Lives outside `(tabs)` so tab bar suppression is automatic.
- No `useAuth` — anon-tolerant per Q-C1.
- **Why:** Spec §4.2.

### `mingla-business/src/components/checkout/CheckoutHeader.tsx` (NEW, ~95 LOC)
- Shared header for J-C1 / J-C2 / J-C3.
- Layout: safe-area inset spacer + horizontal row [back IconChrome `arrowL` | center title | step Pill `info` variant] + 1px divider.
- Web-only `position: sticky` for desktop scroll behaviour.
- **Why:** Spec §4.11.

### `mingla-business/src/components/checkout/QuantityRow.tsx` (NEW, ~280 LOC)
- Per-ticket-type row inside J-C1.
- Composed quantity stepper inline (Pressable + Text "−" U+2212 + Pressable with `Icon name="plus"`). Touch targets 44×44.
- Haptics: `Haptics.selectionAsync()` on each tap (web no-op; Android emulator catch-swallow).
- Sale-window state: `saleStartAt > now` → row disabled with banner "Sales open {date}". `saleEndAt < now` → "Sales ended". `visibility === "disabled"` → "Sales paused".
- Sold-out state: capacity 0 (and not isUnlimited) → "Sold out" badge.
- "X left" caption when capacity ≤ 5 AND !isUnlimited.
- Ticket description (when present) max 2 lines.
- **Why:** Spec §4.4.

### `mingla-business/app/checkout/[eventId]/index.tsx` (NEW, ~265 LOC)
- J-C1 Tickets screen.
- Reads `eventId` from `useLocalSearchParams`; resolves LiveEvent from store.
- Filters `visibility !== "hidden"`, sorts by `displayOrder`.
- Renders event mini-card (cover hue band 64px + name + brand · date line) + section label + QuantityRow list.
- Sticky bottom bar: subtotal label + value (`formatGbp` or "Free" or "—") + Continue Button (disabled when cart empty).
- Continue label: "Continue" (paid) or "Reserve free ticket" (free).
- Empty states: event not found, sold out, past/cancelled.
- Cover band uses `hsl(${event.coverHue}, 60%, 45%)` (RN color-format memory rule).
- **Why:** Spec §4.4.

### `mingla-business/app/checkout/[eventId]/buyer.tsx` (NEW, ~470 LOC)
- J-C2 Buyer Details screen.
- Order summary recap GlassCard (lines + total) — tappable to go back.
- 3 Inputs: Name (variant=text), Email (variant=email — auto keyboardType + lowercase + autoComplete), Phone (variant=text, optional).
- Marketing opt-in checkbox (default UNCHECKED).
- Validation: name length ≥ 2, email regex, phone length ≥ 7 if present. Per-field errors render in `semantic.error` only AFTER first blur (touched flag).
- Continue Button disabled until `validation.isValid`.
- Continue tap fires TRANSITIONAL Toast — Cycle 8a/8b boundary. Toast copy varies for free vs paid.
- Defensive guard: cart empty / event missing → router.replace to `/checkout/{eventId}` or render empty shell.
- **Keyboard handling:** lifted from `EventCreatorWizard.tsx:165-237` pattern verbatim (Keyboard listener + `keyboardHeight` state + dynamic ScrollView paddingBottom + deferred `requestAnimationFrame` scrollToEnd via `pendingScrollToBottomRef`). Bottom bar `transform: translateY(200)` when keyboard up, so it doesn't hover between focused input and keyboard.
- **Why:** Spec §4.5 + memory rule "keyboard never blocks input."

---

## 4 — Spec traceability

| AC | Implementation | Status |
|----|----------------|--------|
| AC#1 — Tap "Get tickets" → /checkout/{eventId} | PublicEventPage edit | UNVERIFIED — needs runtime smoke |
| AC#2 — J-C1 renders visible+enabled tickets as QuantityRows | index.tsx filter + sort + map | PASS by construction |
| AC#3 — Quantity stepper clamps to [0, effectiveMax]; respects min/max/capacity | QuantityRow `effectiveMax` calc | PASS by construction |
| AC#4 — "X left" caption ≤ 5 AND !isUnlimited | QuantityRow `showXLeft` | PASS by construction |
| AC#5 — Subtotal updates live via formatGbp | useCartTotals + bottom bar | PASS by construction |
| AC#6 — Continue disabled when cart empty | `disabled={totals.isEmpty}` | PASS by construction |
| AC#7 — Tap Continue → /checkout/{eventId}/buyer; cart survives | router.push within CartProvider | UNVERIFIED — needs runtime smoke |
| AC#8 — J-C2 inline validation in semantic.danger | visibleErrors + Text style | PASS by construction |
| AC#9 — Inputs scroll into view above keyboard | EventCreatorWizard pattern | UNVERIFIED — needs runtime smoke (KEY) |
| AC#10 — Marketing opt-in defaults UNCHECKED | INITIAL_STATE in CartContext + checkbox state | PASS by construction |
| AC#11 — Continue disabled until name + email valid | validation.isValid | PASS by construction |
| AC#12 — Tap Continue (paid OR free) → TRANSITIONAL toast | handleContinue + Toast component | UNVERIFIED — needs runtime smoke |
| AC#13 — Native back from J-C2 → J-C1 cart intact | router.back + Context survives | UNVERIFIED — needs runtime smoke |
| AC#14 — Tab bar SUPPRESSED on /checkout/... routes | route lives outside (tabs) | PASS by construction |
| AC#15 — Buyer NOT prompted to sign in | _layout.tsx does not call useAuth | PASS by construction |
| AC#16 — TypeScript strict EXIT=0 | `cd mingla-business && npx tsc --noEmit` | **PASS** |
| AC#17 — grep oklch in src/components/checkout returns 0 | grep `oklch\(` | **PASS** (also 0 in app/checkout) |
| AC#18 — Cart state does NOT persist across browser tab close | Context only, no AsyncStorage | PASS by construction |
| AC#19 — NO regression on Cycle 6 PublicEventPage 7 variants | Only handleBuyerAction edit; variant logic untouched | PASS by construction |
| AC#20 — NO regression on Cycle 7 brand page or share modal | Untouched | PASS by construction |

---

## 5 — Verification output

### tsc strict
```
$ pwd && npx tsc --noEmit; echo "EXIT=$?"
/c/Users/user/Desktop/mingla-main/mingla-business
EXIT=0
```

### grep oklch
```
$ grep -rn "oklch(" mingla-business/src/components/checkout
(no matches)
$ grep -rn "oklch(" mingla-business/app/checkout
(no matches)
```

Clean.

---

## 6 — Invariant Verification

| Invariant | Status |
|-----------|--------|
| I-11 Format-agnostic ID | PRESERVED — eventId is opaque string from route param |
| I-12 Host-bg cascade | PRESERVED — `flex: 1, backgroundColor: "#0c0e12"` matches Cycle 6 host |
| I-13 Overlay-portal contract | N/A this cycle (3DS sheet lands in 8b) |
| I-14 Date-display single source | PRESERVED — uses `formatDraftDateLine` from utils/eventDateDisplay |
| I-15 Ticket-display single source | PRESERVED — uses `formatGbp` from utils/currency |
| I-16 Live-event ownership separation | PRESERVED — buyer never granted brand ownership |
| I-17 Brand-slug stability | PRESERVED — empty-state "Back to event" uses event.brandSlug + event.eventSlug (frozen) |
| Const #1 No dead taps | PRESERVED — all buttons wire (Continue → toast; minus/plus → cart dispatch; checkbox → toggle) |
| Const #2 One owner per truth | PRESERVED — cart owned exclusively by CartContext |
| Const #3 No silent failures | PRESERVED — validation errors surface inline; Haptics catch is documented "selection haptics throw on Android emulator" |
| Const #6 Logout clears | N/A — buyer is anon |
| Const #7 TRANSITIONAL labels | HONORED — Cycle 8a/8b boundary toast labelled in code |
| Const #8 Subtract before adding | HONORED — old TRANSITIONAL toast in handleBuyerAction REMOVED before router.push added |
| Const #9 No fabricated data | PRESERVED — cart values are real (no fake stats/prices); only the validation regex is loose for stub mode |
| Const #10 Currency-aware UI | PRESERVED — formatGbp everywhere |
| Const #11 One auth instance | PRESERVED — checkout doesn't touch auth |
| Const #14 Persisted-state startup | PRESERVED — cart in-memory only |

---

## 7 — Cache Safety

No query keys changed. No Zustand stores touched. No AsyncStorage paths changed. Cart Context is purely runtime React state — cold start has no stale cart.

---

## 8 — Regression Surface

5 features most likely to break (tester should manually verify):

1. **Cycle 6 PublicEventPage 7 variants** — only `handleBuyerAction` edited. Verify cancelled / past / password-gate / pre-sale / sold-out / published / approval-required all still render correctly.
2. **Cycle 7 PublicBrandPage + share modal** — orthogonal, untouched. Verify no breakage.
3. **Tab bar appearance on `(tabs)` routes** — checkout lives outside tabs; verify tab bar still renders normally on Home / Events / Account.
4. **iOS native swipe-back from J-C1 → PublicEventPage** — verify cart-empty state when buyer comes back to event page (cart Context unmounts on layout exit).
5. **Cold start (AsyncStorage clear)** — clear, reload, open event, tap Get Tickets — confirm cart is fresh empty (no stale values from any cache).

---

## 9 — Discoveries for Orchestrator

**D-IMPL-CYCLE8a-1 (Note severity)** — Icon set lacks "minus" glyph. QuantityRow composes its decrement button locally with `Pressable` + Text "−" (Unicode U+2212). The plus side uses the existing `"plus"` Icon. This is a one-off composition — NOT a new primitive. If 3+ surfaces end up needing a minus glyph, recommend adding "minus" to the Icon set additively per DEC-082 precedent. Not blocking.

**D-IMPL-CYCLE8a-2 (Note severity)** — `Toast` component visibility lifecycle: in 8a's J-C2, the Cycle 8a/8b boundary toast is the only path off the screen. Tester should verify Toast auto-dismisses (per its own `AUTO_DISMISS` config) AND can be manually dismissed. If Toast doesn't fire on iOS web (Safari), surface the runtime gap — not seen yet.

**D-IMPL-CYCLE8a-3 (Note severity)** — 8a's J-C2 keyboard pattern hides the absolute-positioned bottom bar via `transform: translateY(200)` when `keyboardHeight > 0`. This works because the dynamic `paddingBottom: keyboardHeight + 140` on the ScrollView reserves space for the keyboard plus form-room above. If iOS soft-keyboard transition feels janky in smoke, consider switching from translate to opacity 0 + pointerEvents none. Not blocking.

**D-IMPL-CYCLE8a-4 (Note severity)** — `EmptyState` API uses `illustration` + `description`, NOT `icon` + `body` (corrected mid-build). For Cycle 8b implementor: same primitive shape applies to confirmation screen empty states.

**D-IMPL-CYCLE8a-5 (Low severity)** — Phone validation is intentionally lax (length ≥ 7 OR empty). E.164 normalization happens at B3 wire. No regex constraint in 8a — buyers in different countries enter different formats. Documented stub behavior.

**D-IMPL-CYCLE8a-6 (Low severity)** — `useLocalSearchParams<{ eventId: string }>()` returns `string | string[]`. We narrow with `typeof params.eventId === "string" ? params.eventId : null`. Defensive against the array case (which shouldn't happen for a single dynamic segment, but type system forces the guard). Pattern used in both J-C1 and J-C2.

**No other side issues.**

---

## 10 — Transition Items

**TRANSITIONAL — Cycle 8a/8b boundary**
- **What:** J-C2 Buyer Details "Continue to payment" button fires a Toast instead of routing to /payment.
- **Why:** Cycle 8 was split into 8a (cart + tickets + buyer) and 8b (payment + 3DS + confirmation) for review-size reasons. Same pattern Cycle 6 used to hand off to Cycle 8.
- **Where:** `app/checkout/[eventId]/buyer.tsx:handleContinue` — `setToastVisible(true)` line + `Toast` component near bottom of JSX.
- **Exit condition:** Cycle 8b implementor dispatch lands. Replace `setToastVisible(true)` with:
  - For paid orders: `router.push(\`/checkout/${eventId}/payment\`)`
  - For free orders: synchronous OrderResult generation + `router.replace(\`/checkout/${eventId}/confirm\`)`
  Per spec §4.5 + §4.7. Remove the Toast component.

---

## 11 — Files Touched

| File | Type | LOC delta |
|------|------|-----------|
| `mingla-business/src/components/event/PublicEventPage.tsx` | MOD | ~+5 / -8 |
| `mingla-business/app/checkout/[eventId]/_layout.tsx` | NEW | +30 |
| `mingla-business/app/checkout/[eventId]/index.tsx` | NEW | +265 |
| `mingla-business/app/checkout/[eventId]/buyer.tsx` | NEW | +470 |
| `mingla-business/src/components/checkout/CartContext.tsx` | NEW | +225 |
| `mingla-business/src/components/checkout/CheckoutHeader.tsx` | NEW | +95 |
| `mingla-business/src/components/checkout/QuantityRow.tsx` | NEW | +280 |

Totals: 7 NEW + 1 MOD · ~+1,365 / -8 (net ~+1,357).

(Note: forensics estimated 600–800 LOC; actual landed higher due to defensive empty-state branches in J-C1, comprehensive validation + keyboard pattern in J-C2, and order summary recap GlassCard. All scope-aligned, no creep.)

---

## 12 — Cycle 8b handoff notes

- **Cart Context shape is locked.** Cycle 8b reads `useCart()` (lines, buyer, recordResult) and `useCartTotals()` (totalGbp, isFree, isEmpty). No reducer changes needed — `RECORD_RESULT` + `OrderResult` + `CheckoutPaymentMethod` types already defined.
- **TRANSITIONAL toast removal**: 1 site in `buyer.tsx:handleContinue` — replace `setToastVisible(true)` with paid/free branch (see §10).
- **Continue label** already correct: "Continue to payment" (paid) / "Reserve free ticket" (free) — Cycle 8b doesn't need to change copy.
- **Stub helpers needed:** `src/utils/stubOrderId.ts` per spec §4.12 (orderId + ticketId + QR payload generators).
- **Net-new in 8b:** PaymentElementStub, ThreeDSStubSheet, J-C3 payment.tsx, J-C5 confirm.tsx + native back guard + `usePreventRemove` (or expo-router equivalent).

---

## 13 — Smoke priorities (what user should test first)

1. **Web Chrome — happy path** — `cd mingla-business && npx expo start --web --clear`. Sunday Languor brand → published event → Get Tickets → /checkout/{id} → add 1 General → Continue → /buyer → fill name/email → Continue → TRANSITIONAL toast appears. PASS.
2. **iOS sim — same** — covers Haptics + native swipe-back.
3. **Keyboard (KEY)** — focus email Input on J-C2, confirm Input scrolls above keyboard (no occlusion). Memory rule explicit.
4. **Validation edge cases** — email "abc" → error "Enter a valid email" appears AFTER blur. Phone "123" → error "Enter a valid phone or leave blank" after blur. Empty phone → no error.
5. **Cart edge cases** — quantity stepper clamp at capacity = 3, sold-out tickets show badge, sale-not-open shows banner, free tickets show "Reserve free ticket" continue label.
6. **Regression** — Cycle 6 PublicEventPage 7 variants still render. Cycle 7 brand page + share modal still work.
