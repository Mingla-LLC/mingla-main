# Investigation — BIZ Cycle 8 — Checkout flow (J-C1 → J-C5)

**Date:** 2026-05-01
**Author:** mingla-forensics
**Mode:** INVESTIGATE-THEN-SPEC (this report; spec ships alongside as `SPEC_BIZ_CYCLE_8_CHECKOUT.md`)
**Dispatch:** [Mingla_Artifacts/prompts/FORENSICS_BIZ_CYCLE_8_CHECKOUT.md](Mingla_Artifacts/prompts/FORENSICS_BIZ_CYCLE_8_CHECKOUT.md)
**Confidence:** HIGH

---

## 1 — Build context (this cycle is GREENFIELD)

5 net-new screens. DESIGN-PACKAGE-SILENT (confirmed). Lives in `mingla-business`
Expo Web only per DEC-081 + DEC-086. Stub Stripe (B3 wires live). Stub email
(B-cycle wires Resend). Stub Apple/Google Wallet add intents.

Cycle 8 is the buyer-facing payment journey — the second-most commercially
important flow after "organiser publishes event." Buyers are anonymous (per
recommendation Q-C1 below), pay GBP, walk away with a QR code. No real money
moves in this cycle. No real Supabase rows get created.

Roadmap authority: `Mingla_Artifacts/specs/SPEC_BIZ_FRONTEND_JOURNEY_BUILD_ROADMAP.md`
§Cycle 8 (line 497) + §3.5 (line 143).

---

## 2 — Investigation Manifest (every file read)

| # | File | Why |
|---|------|-----|
| 1 | `Mingla_Artifacts/prompts/FORENSICS_BIZ_CYCLE_8_CHECKOUT.md` | The dispatch — scope, hard constraints, 12 open Q-C questions |
| 2 | `Mingla_Artifacts/specs/SPEC_BIZ_FRONTEND_JOURNEY_BUILD_ROADMAP.md` | §Cycle 8 + §3.5 — journey IDs and target paths |
| 3 | `Mingla_Artifacts/reports/IMPLEMENTATION_BIZ_CYCLE_5_TICKET_TYPES.md` | Cycle 5 ticket-type model lineage |
| 4 | `Mingla_Artifacts/reports/IMPLEMENTATION_BIZ_CYCLE_6_PUBLIC_EVENT_PAGE.md` | Public event page — entry point for checkout |
| 5 | `Mingla_Artifacts/reports/IMPLEMENTATION_BIZ_CYCLE_7_PUBLIC_BRAND.md` | Sister surface; visual language reference |
| 6 | `Mingla_Artifacts/reports/IMPLEMENTATION_BIZ_CYCLE_7_FX3.md` | RN color-format constraint codified — applies to checkout color choices |
| 7 | `Mingla_Artifacts/DECISION_LOG.md` (DEC-071, DEC-072, DEC-074, DEC-076, DEC-079, DEC-081, DEC-086) | Frontend-first / producer model / no onboarding / web auth / kit-closure / mingla-web discontinued / workstream split |
| 8 | `Mingla_Artifacts/INVARIANT_REGISTRY.md` (selectors I-11..I-17) | Invariants checkout must preserve |
| 9 | `mingla-business/src/components/event/PublicEventPage.tsx` (lines 1–340) | Entry-point CTA `handleBuyerAction` |
| 10 | `mingla-business/src/store/liveEventStore.ts` (full) | LiveEvent shape — what cart can read |
| 11 | `mingla-business/src/store/draftEventStore.ts` (lines 60–130) | TicketStub shape (visibility, capacity, isFree, isUnlimited, password, approval, sale window, min/maxPurchaseQty) |
| 12 | `mingla-business/src/utils/currency.ts` | `formatGbp` (£12.50) + `formatGbpRound` (£12) |
| 13 | `mingla-business/src/components/ui/ShareModal.tsx` (line 30, 244) | Existing `react-native-qrcode-svg` consumer — proven pattern |
| 14 | `mingla-business/src/components/ui/` (full listing) | 27 kit primitives available — no new ones needed |
| 15 | `mingla-business/app/_layout.tsx` | Root Stack provider — checkout screens slot in here |
| 16 | `mingla-business/app/(tabs)/_layout.tsx`, `home.tsx`, `events.tsx`, `account.tsx` | Tab structure — checkout MUST suppress tab bar |
| 17 | `Mingla_Artifacts/design-package/` (grep CheckoutScreen / BuyerScreen / PaymentScreen / ConfirmationScreen / WalletScreen) | DESIGN-PACKAGE-SILENT confirmed — zero hits |
| 18 | PR #59 description (`gh pr view 59`) | §B.4 Tickets & Orders schema — `orders`, `order_line_items`, `tickets`, `waitlist_entries` — for forward-compat |

---

## 3 — Findings

### 🔵 OBS-1 — Entry-point CTA today is a TRANSITIONAL toast (Cycle 6)
**File:** `mingla-business/src/components/event/PublicEventPage.tsx:256-281`
**Code:**
```tsx
const handleBuyerAction = useCallback(
  (action: "buy" | "free" | "approval" | "password" | "waitlist"): void => {
    // [TRANSITIONAL] All buyer-flow actions stub to toasts in Cycle 6.
    switch (action) {
      case "buy":
        showToast("Online checkout lands Cycle 8. Your card won't be charged yet.");
        return;
      case "free":
        showToast("Free ticket flow lands Cycle 8.");
        return;
      ...
    }
  },
  [showToast],
);
```
**What it does:** Every "Get tickets" tap shows a toast pointing at Cycle 8.
**What Cycle 8 must do:** Replace `case "buy":` and `case "free":` with router push to `/checkout/{eventId}` (route-shape TBD per spec). `case "approval"` stays toast (Cycle 10 + B4). `case "password"` stays inline (gate flow). `case "waitlist"` stays toast (B5). The TRANSITIONAL comment is the Cycle 8 entry contract — cite this line in implementor dispatch.
**Causal chain:** Buyer taps Get Tickets → handleBuyerAction → toast. Cycle 8 redirects to checkout flow.
**Verification:** Grep `Online checkout lands Cycle 8` returns this single hit.

### 🔵 OBS-2 — TicketStub model is rich enough; no schema change needed
**File:** `mingla-business/src/store/draftEventStore.ts:65-129`
**Fields the cart must read:** `id`, `name`, `priceGbp` (nullable), `capacity` (nullable), `isFree`, `isUnlimited`, `visibility`, `displayOrder`, `minPurchaseQty`, `maxPurchaseQty`, `description`, `saleStartAt`, `saleEndAt`. (Tickets with `visibility = "hidden"` already filtered by PublicEventPage Cycle 6 contract.)
**What Cycle 8 must do:** Cart respects `minPurchaseQty` (default 1), `maxPurchaseQty` (null = no cap), and `capacity` (when not isUnlimited). Quantity stepper enforces these clamps inline.
**Causal chain:** Cart shape derives entirely from existing `LiveEvent.tickets[]` — no new ticket fields needed.
**Verification:** Grep `interface TicketStub` returns single definition at line 65.

### 🔵 OBS-3 — Currency utility is single-source-of-truth
**File:** `mingla-business/src/utils/currency.ts`
**Code:** `formatGbp(value)` → `£12.50`, `formatGbpRound(value)` → `£12`.
**What Cycle 8 must do:** All checkout prices via `formatGbp` (pence-precision matters in cart subtotals + payment confirmation). Constitution #10 enforced.
**Verification:** No `Intl.NumberFormat` outside `currency.ts` — proven by Cycle 2 J-A12 polish (see file header docstring).

### 🔵 OBS-4 — QR rendering is proven cross-platform
**File:** `mingla-business/src/components/ui/ShareModal.tsx:30,244`
**Code:** `import QRCode from "react-native-qrcode-svg";` + `<QRCode value={...} size={...} />`
**What Cycle 8 must do:** Confirmation screen mirrors ShareModal's QR pattern. Stub QR encodes the deterministic order ID (recommended Q-C6 below).
**Verification:** ShareModal already renders cross-platform; QR is verified working.

### 🟡 HF-1 — Zero `mingla-business/app/checkout/` route exists yet
**File:** `mingla-business/app/` directory listing
**Existing:** `(tabs)/`, `auth/`, `b/[brandSlug]/`, `brand/[id]/`, `e/[brandSlug]/[eventSlug]/`, `event/[id]/`, `_layout.tsx`, `__styleguide.tsx`, `index.tsx`.
**What Cycle 8 must do:** Create `app/checkout/[eventId]/` directory with 5 sibling routes: `index.tsx` (Tickets), `buyer.tsx`, `payment.tsx`, `confirm.tsx`, plus a `_layout.tsx` to suppress tab bar and stack the screens with native swipe-back.
**Why hidden flaw, not root cause:** No bug today — just net-new work to scaffold.
**Verification:** `ls mingla-business/app/checkout` returns "no such directory."

### 🟡 HF-2 — No checkout-cart Zustand store exists
**Search:** `grep -rn "checkout\|Cart\|order" mingla-business/src` returns ZERO checkout/cart-related store files.
**What Cycle 8 must do:** Decision per Q-C3 (recommended below): **NO Zustand persistence for cart.** React state + URL-based event id is enough. The checkout flow's lifetime is the buyer's session in this single tab — closing the tab abandons the cart, which is correct for stub mode. Live (B3) wires server-side payment intent + ephemeral session table.
**Why hidden flaw:** If implementor reaches for Zustand-with-persist by reflex (Cycle 5/6 pattern), checkout cart would survive across all events forever — a worse UX. The spec must be explicit.
**Verification:** `ls mingla-business/src/store/` shows draftEventStore, liveEventStore, currentBrandStore, brandList — no cart store.

### 🟡 HF-3 — No `useAuth` anonymous-tolerance test
**File:** `mingla-business/src/context/AuthContext.tsx`
**Concern:** `useAuth().user === null` is the buyer's state. Cycle 8 routes must NOT be wrapped by `app/(tabs)/_layout.tsx`'s tab requirement (which assumes signed-in user). Checkout routes must live OUTSIDE the `(tabs)` group — at `app/checkout/...` — so the AuthProvider's null state is tolerated.
**What Cycle 8 must do:** Routes live OUTSIDE `(tabs)`; checkout layout does its own absent-auth handling (no redirect to sign-in). Bottom tab bar suppressed via `app/checkout/_layout.tsx` not being in `(tabs)` group.
**Why hidden flaw:** A reflexive scaffolding inside `(tabs)` would gate the buyer at sign-in (DEC-074 says no onboarding for organisers, but says NOTHING about buyers). Confirm explicitly.
**Verification:** `app/(tabs)/_layout.tsx` content (Read for explicit confirmation that it doesn't gate auth — spec authors next).

### 🔵 OBS-5 — `react-native-qrcode-svg` package install confirmed
**Verification:** Cycle 7 FX2 implementation report mentions adding `react-native-qrcode-svg`. Single import in ShareModal proves runtime works. Cycle 8 confirmation screen reuses without new package.

### 🔵 OBS-6 — PR #59 forward-compat note (informational only)
**Source:** `gh pr view 59` description §B.4.
PR #59's `orders` table fields (likely): `id`, `account_id` (nullable for anon), `event_id`, `total_gbp_pence`, `status`, `stripe_payment_intent_id`, `created_at`. `order_line_items`: `order_id`, `ticket_type_id`, `quantity`, `unit_price_gbp_pence`, `subtotal_gbp_pence`. `tickets`: `order_id`, `qr_code`, `redeemed_at`.
**Implication for Cycle 8:** Cart shape MUST be compatible. Recommendation: cart line items shape `{ ticketTypeId, quantity, unitPriceGbp, isFree }` — direct map to PR #59 `order_line_items` minus the `_pence` integer conversion which can happen at the live-wire boundary in B3. Account_id == null for anon checkout — matches PR #59 anon-friendly schema.
**Why observation, not blocker:** We're not wiring the DB this cycle. We just want stable field names.

### 🔵 OBS-7 — RN color-format rule applies (memory rule)
**Source:** `feedback_rn_color_formats.md` (codified 2026-05-01).
**What Cycle 8 must do:** ALL checkout screen colors via `designSystem` tokens (`accent.*`, `semantic.*`, `text.*`) or `hsl()` / `rgba()` / hex. NO `oklch`. NO `lab`. The visual language for checkout MUST mirror the dark-glass kit Cycles 6+7 used.
**Verification:** `feedback_rn_color_formats.md` exists in memory.

### 🔵 OBS-8 — Kit closure rule (DEC-079) — no new primitives
**What Cycle 8 must do:** Compose checkout screens entirely from the 27 existing primitives: `GlassCard`, `Button`, `Input`, `Stepper` (quantity!), `Sheet` (3DS sheet), `Spinner`, `Toast`, `IconChrome`, `EmptyState`, `Skeleton`, `Modal`, etc. If something genuinely doesn't compose, raise a DEC entry per DEC-079 carve-out rule — do NOT silently add new primitives.
**Verification:** Scrolled `mingla-business/src/components/ui/` — Stepper.tsx exists (perfect for quantity).

---

## 4 — Five-Layer Cross-Check

| Layer | State |
|-------|-------|
| **Docs** | Roadmap §Cycle 8 + §3.5 + dispatch prompt — clear scope. PRD §E.2 "Attendee Buys Online" — narrative happy-path only, no field-level contract. |
| **Schema (future)** | PR #59 §B.4 defines `orders`, `order_line_items`, `tickets`, `waitlist_entries`. Forward-compat must hold. Cycle 8 NOT wired against this — schema is a future contract. |
| **Code (current)** | PublicEventPage CTA stubbed with toast (OBS-1). LiveEvent.tickets[] shape complete (OBS-2). currency utils ready (OBS-3). QR proven (OBS-4). NO checkout routes exist (HF-1). NO cart store exists (HF-2). |
| **Runtime** | Cycle 8 is greenfield — no runtime contradictions. |
| **Data** | No persisted checkout state in AsyncStorage today. Recommendation: keep it that way (Q-C3). |

No contradictions between layers. Cycle 8 is GREENFIELD with stable inputs.

---

## 5 — Resolved product questions (Q-C1 → Q-C12)

The dispatch surfaced 12 strategic questions. All resolve with HIGH confidence on the recommended answers. Detailed rationales follow; the spec encodes these as binding decisions.

### Q-C1 — Auth requirement: **GUEST CHECKOUT (no sign-in)**
**Why:** Buyers are anonymous to Mingla. DEC-074 killed onboarding for organisers; buyers never had one. PR #59 schema accepts `account_id` nullable. Force-signing-in pre-purchase is friction that kills conversion. Email collected at J-C2 is enough for ticket delivery + future account-claim flow ("we sent your ticket — claim it to manage").
**Spec encodes:** No auth gate on `/checkout/...`. Email is the buyer identity.

### Q-C2 — Multi-ticket-type per order: **YES**
**Why:** PR #59 `order_line_items` table is a row-per-(order, ticket_type, qty) — explicitly multi-line. Real events frequently have General + VIP + Press tiers. Single-line cart would force buyers to do separate checkouts for each tier — bad UX, double-Stripe-fee in live mode.
**Spec encodes:** Cart is `{ lines: [{ ticketTypeId, quantity, unitPriceGbp, isFree }] }`.

### Q-C3 — Cart persistence: **IN-MEMORY ONLY (React state, no Zustand, no AsyncStorage)**
**Why:** Cart lifetime = single browser tab session. Closing the tab = abandoned cart, which is the correct semantic — restoring stale cart on a future visit is creepy + wrong (prices may have changed, tickets may have sold out). HF-2 flags the reflex. Real (B3) cycle introduces server-side payment intents that survive tabs in their own session.
**Spec encodes:** Cart lives in `app/checkout/[eventId]/_layout.tsx` `useState` + Context — not a store.

### Q-C4 — Sold-out + capacity UI: **DISABLE +; SHOW "X LEFT" WHEN ≤5**
**Why:** Capacity (when not isUnlimited) is real — going over corrupts the stub. "X left" surfaces scarcity at the right moment (≤5) without crying wolf at every event with 200 capacity. minPurchaseQty + maxPurchaseQty also clamped per ticket-type.
**Spec encodes:** Stepper `min={minPurchaseQty}`, `max={Math.min(remainingCapacity, maxPurchaseQty ?? Infinity)}`. "X left" caption when `remainingCapacity <= 5` AND `!isUnlimited`.

### Q-C5 — Free-ticket flow: **SKIP J-C3 PAYMENT + J-C4 3DS**
**Why:** Charging a card for a £0 order is absurd. Free orders go Buyer Details → Confirmation directly. Stripe doesn't process £0 orders anyway.
**Spec encodes:** After J-C2 buyer details, if cart total === 0, skip to J-C5 confirmation. The "Continue to payment" CTA on J-C2 reads "Reserve free ticket" when cart is free.

### Q-C6 — QR contents: **Stub deterministic ID `mingla:order:{orderId}:ticket:{ticketId}`**
**Why:** Stub mode needs SOMETHING to encode. A deterministic format the eventual scanner code (Cycle 11) can parse for stub-mode testing is more useful than a UUID. Live (B3) swaps to a signed JWT — different shape, but the QR rendering code path stays identical.
**Spec encodes:** orderId = `ord_<ts36>_<rand4>`, ticketId = `tkt_<ord-suffix>_<lineIdx>_<seatIdx>`. QR encodes `mingla:order:{orderId}:ticket:{ticketId}`. Spec includes copy-paste reminder for B3 to swap encoder.

### Q-C7 — Wallet add intents: **Toast "Coming soon — saved to your account" both platforms**
**Why:** Real `.pkpass` requires Apple Developer signing cert + a backend service. Real Google Wallet pass requires service account JSON + JWT issuance. Neither exists at this stage. Faking either degrades trust ("Add to Wallet" → nothing happens). Honest "Coming soon" is correct.
**Spec encodes:** Both buttons render. Both fire toast on tap. Buttons stay enabled (it's NOT a dead tap — the toast IS the feedback per Constitution #1). Document as TRANSITIONAL with B-cycle exit.

### Q-C8 — 3DS frequency in stub: **Toggle on the Payment screen — "Test 3DS challenge" checkbox**
**Why:** 3DS happens in real life. We need a way to test that path WITHOUT randomness (random would make smoke tests flaky). A visible checkbox on the Payment screen is honest — the buyer (smoke tester) opts in. In real Stripe (B3), 3DS triggers via Stripe's risk engine; the checkbox UI is removed at that point.
**Spec encodes:** J-C3 Payment has a hidden-by-default `__DEV__` checkbox: "Test 3DS challenge (stub only)". When ticked, payment stub returns `requiresAction` → opens J-C4 3DS sheet. Default unticked → straight-through to J-C5 confirmation. Removed in production stub builds via `__DEV__` gate.

### Q-C9 — Currency: **GBP only, single-event cart enforces single currency**
**Why:** No multi-event cart in scope. One event = one currency. Mingla is GBP-only at MVP per BUSINESS_PRD.md. No reason to over-engineer multi-currency now.
**Spec encodes:** Cart total in GBP. `formatGbp` everywhere.

### Q-C10 — Email confirmation copy: **SHOW "Sent to {email}" — flag TRANSITIONAL**
**Why:** Buyers expect to see confirmation copy. Showing "Sent to {email}" in stub mode where no email actually sends is a small honesty cost — but adding "(stub mode — no email actually sent)" copy would degrade the smoke-test fidelity. The screen mirrors what live mode will show. The TRANSITIONAL comment in code keeps a paper trail for B3 wire-up.
**Spec encodes:** Confirmation screen shows "Sent to {email} — check your spam folder if you don't see it in 5 min." Code comment: `// [TRANSITIONAL] Email send is a no-op in stub mode — wires to Resend in B3.`

### Q-C11 — Back-button behavior: **Cart survives back from J-C2; cannot back out of J-C5**
**Why:** Buyer fills out details, hits back to revise quantity, expects same cart. Buyer completes purchase, "back" from confirmation doesn't make sense (purchase already happened in stub world; in real world, back is a refund-flow concern, not nav). Native swipe-back / browser back disabled on J-C5 — replaced with explicit "Back to event" button.
**Spec encodes:** J-C5 wraps in a navigation guard (Expo Router's `usePreventRemove` or custom). J-C5 renders explicit "Back to event" CTA.

### Q-C12 — Race conditions: **DOCUMENTED KNOWN-STUB-BEHAVIOR — both buyers get fake "you're in"**
**Why:** Stub mode has no backend concurrency control. Two buyers grabbing the last ticket both succeed in fake mode. This is honest fakery — no money moves. B3 + Supabase RLS + DB CHECK constraints resolve real contention.
**Spec encodes:** Documented in spec §10 PR #59 forward-compat appendix.

---

## 6 — Blast Radius

| Surface | Impact | Action |
|---------|--------|--------|
| `PublicEventPage.tsx` | Entry CTA wires from toast → router push | Edit `handleBuyerAction` cases `"buy"` and `"free"` |
| `liveEventStore.ts` | NO change — read-only consumer | None |
| `currentBrandStore.ts` | OPTIONAL: increment `stats.attendees` on stub purchase. **Recommended NO** — fake stats lie to the founder during smoke. | None |
| `app/_layout.tsx` | NO change — root Stack accommodates checkout group naturally | None |
| `app/(tabs)/_layout.tsx` | NO change — checkout lives outside tabs | None |
| `useAuth` | NO change — checkout routes do NOT call `useAuth` | None |
| `AuthContext` | NO change | None |
| `currency.ts` | NO change — `formatGbp` already exists | None |
| `ShareModal.tsx` | NO change — exists as QR reference pattern only | None |
| Cycle 9 (Event Management) | Future-facing — this cycle's stub orders array stays empty in liveEventStore.orders. Cycle 9 reads the future `orders` table. | None this cycle |
| Cycle 11 (Scanner) | Forward-facing — stub QR format `mingla:order:{ord}:ticket:{tkt}` parseable by Cycle 11 scanner | Document QR format in spec §10 |
| PR #59 backend | Forward-compat: `cart.lines` → `order_line_items` rows (1:1 map) at B3 wire | Document in spec §10 |

---

## 7 — Invariant compliance plan

| ID | Invariant | How Cycle 8 preserves it |
|----|-----------|--------------------------|
| I-11 | Format-agnostic ID | orderId / ticketId are opaque strings (no UUID assumption) |
| I-12 | Host-bg cascade | Checkout uses same `host` style as Cycle 6 — `flex: 1, backgroundColor: "#0c0e12"` |
| I-13 | Overlay-portal contract | 3DS sheet uses `Sheet` primitive — already portal-correct (DEC-085) |
| I-14 | Date-display single source | N/A — checkout doesn't render event dates beyond the event-name confirmation line, which uses `formatDraftDateLine` |
| I-15 | Ticket-display single source | Cart line items use `formatGbp` from currency.ts |
| I-16 | Live-event ownership separation | Buyer is NEVER granted brand ownership — `addLiveEvent` not called from checkout |
| I-17 | Brand-slug stability | Confirmation screen "Back to event" uses FROZEN `event.brandSlug` + `event.eventSlug` |
| Const #1 | No dead taps | All buttons wire (incl. wallet-add → toast; toast IS the feedback) |
| Const #3 | No silent failures | Stub Stripe decline path explicit; cart-empty submit blocked; quantity 0 blocked |
| Const #7 | TRANSITIONAL labels | Stub Stripe / stub email / stub wallet ALL labeled with B-cycle exit |
| Const #8 | Subtract before add | Existing toast removed before checkout route added |
| Const #9 | No fabricated data | QR encodes real stub orderId; email shown is buyer's typed email; no fake stats incremented |
| Const #10 | Currency-aware UI | `formatGbp` everywhere |
| Const #14 | Persisted-state startup | Cart in-memory only — cold start has no stale cart |

No invariants violated by this cycle's plan.

---

## 8 — Discoveries for orchestrator

**D-INV-CYCLE8-1 (Note severity)** — `useAuth().user === null` is the explicit "buyer state" semantic and not previously codified. Recommend memory rule: `feedback_anon_buyer_routes.md` documenting that `app/checkout/...`, `app/e/...`, `app/b/...` are anon-tolerant routes that MUST NOT be wrapped in tab-auth gates.

**D-INV-CYCLE8-2 (Note severity)** — The Cycle 6 PublicEventPage `handleBuyerAction` switch statement has 5 cases; only 2 ("buy", "free") become live in Cycle 8. The other 3 ("approval" → Cycle 10/B4, "password" → inline already, "waitlist" → B5) remain TRANSITIONAL toasts. Spec calls this out so implementor doesn't accidentally rewire them.

**D-INV-CYCLE8-3 (Low severity)** — PR #59 schema uses `_pence` integer storage convention (e.g. `unit_price_gbp_pence`). Cycle 8 stores `priceGbp` as a whole-units number (per existing TicketStub model). The pence-conversion happens at the live-wire boundary in B3, NOT at the cart layer. Document so B3 implementor doesn't expect cart to pre-convert.

**D-INV-CYCLE8-4 (Note severity)** — Wallet-add intents (`Add to Apple Wallet` / `Add to Google Wallet`) — Apple `.pkpass` requires Apple Developer signing certificate (not Sign in with Apple JWT — separate cert). Document as a real future cost: when wallet-add ships in B-cycle, allocate ~1 day for cert provisioning + pass template design + Resend-style email-attachment fallback.

**D-INV-CYCLE8-5 (Low severity)** — The Cycle 6 PublicEventPage J-P5 password-gate variant unlocks the page to render its full ticket-purchase UI; checkout flow needs to consume the unlocked state (i.e., the buyer who unlocked CAN proceed to checkout). Verify implementor passes the unlock token through the route param or context.

**D-INV-CYCLE8-6 (Low severity)** — `RN-Stepper` primitive exists at `mingla-business/src/components/ui/Stepper.tsx`. Cycle 8 cart Quantity uses it. Confirm Stepper accepts `min` + `max` props (forensics did not read Stepper.tsx in detail; spec's implementor reads + verifies before using).

**No other side issues.**

---

## 9 — Confidence Level

**HIGH.** Reasoning:
- Cycle is well-bounded (5 screens, no schema, no API)
- Inputs are stable (Cycle 5 ticket model, Cycle 6 entry point, Cycle 7 visual language)
- All 12 strategic questions resolve at HIGH on a single recommendation each
- Forward-compat with PR #59 schema validated
- DESIGN-PACKAGE-SILENT confirmed by grep (forensics has to design AND spec, but the visual contract is set by Cycle 6+7's dark-glass language)
- No invariant conflicts
- No new primitives needed (kit-closure DEC-079 honored)

**Risk:** the only material risk is if PR #59 review surfaces schema changes that affect cart shape (e.g., `order_line_items` adds a `seat_assignment` field). The spec's §10 forward-compat appendix documents the assumed shape so any drift is visible. If that drift exceeds the 1:1 line-item map, we re-spec; otherwise it's a B3 implementor concern.

---

## 10 — Fix Strategy / Direction

(Detailed contract is in `SPEC_BIZ_CYCLE_8_CHECKOUT.md`.)

1. **Wire entry-point CTA.** Edit PublicEventPage's `handleBuyerAction` to push to `/checkout/{eventId}` instead of toast (cases `"buy"` + `"free"` only).
2. **Scaffold `app/checkout/[eventId]/`.** Five files: `index.tsx` (Tickets), `buyer.tsx`, `payment.tsx`, `confirm.tsx`, plus `_layout.tsx` for cart Context + tab-bar suppression.
3. **Build cart Context.** In-memory React state. Single source of truth for the 5 screens. No persistence.
4. **Build screens 1–5** in roadmap order, reusing kit primitives. DESIGN-PACKAGE-SILENT — visual language mirrors Cycle 6/7 dark-glass.
5. **Stub Stripe Element.** A `<PaymentElementStub>` component that renders the four payment-method tabs (Card / Apple Pay / Google Pay / 3DS-Test) and resolves a fake `paymentResult` after 1.2s.
6. **Stub QR.** Deterministic format. Render in confirmation. Confirm cross-platform.
7. **Write implementation report + tester report.**

---

## 11 — Regression Prevention

1. **TRANSITIONAL labels** on all stubs (Stripe / email / wallet) — exit-conditioned to B3 / B-cycle.
2. **Memory rule candidate** D-INV-CYCLE8-1 — codify anon-tolerant route pattern.
3. **Forward-compat appendix** in spec §10 — names every cart field that maps to PR #59 schema rows.
4. **Inline code comments** at stub boundaries explaining WHY the stub exists and what unblocks the live wire.
5. **Tester regression list** — checkout entry from event page, tab-bar suppression, tab-bar restoration on exit, anon-route tolerance, free-ticket skip-payment path, sold-out path, password-gate path.

---

End of investigation. Spec follows.
