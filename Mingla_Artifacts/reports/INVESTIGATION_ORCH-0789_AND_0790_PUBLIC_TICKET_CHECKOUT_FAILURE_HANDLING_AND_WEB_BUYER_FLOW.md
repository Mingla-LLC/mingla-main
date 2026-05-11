# INVESTIGATION — ORCH-0789 + ORCH-0790: Public Ticket Checkout Failure-Handling (mobile) + Web Buyer Payment Flow

**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`.
**Mode:** INVESTIGATE only. No fixes proposed.
**Dispatched from:** `Mingla_Artifacts/prompts/FORENSICS_ORCH-0789_AND_0790_PUBLIC_TICKET_CHECKOUT_FAILURE_HANDLING_AND_WEB_BUYER_FLOW.md`.

## Symptom summary

Operator-witnessed on the production Mingla Business app:

1. **ORCH-0789 (iPhone, public buyer flow):** opening the Party Block public event page, tapping "Pay", tapping ANY action in the Stripe payment sheet (including the close affordance to back out) returns a red "Card declined — try another payment method." toast at the top of the screen. The toast does not auto-dismiss, there is no tap/swipe/close to dismiss it, and the underlying screen feels frozen because the buyer can neither dismiss the error nor recover.
2. **ORCH-0790 (web browser, public buyer flow):** any attempt to pay for any event in a desktop or mobile web browser hits an inline error reading "Ticket payments are not available on web yet. Please complete checkout in the Mingla Business mobile app." Web buyers cannot complete purchase at all.

Both surfaces are buyer-visible on share links right now.

## Phase 0 ingestion log

Read in this order before forming any hypothesis:

1. `Mingla_Artifacts/specs/SPEC_ORCH-0777_PRODUCTION_TICKET_CHECKOUT_SALES_AND_BUYER_NOTIFICATIONS.md` (parent checkout spec — defines the J-C1/J-C2/J-C3 buyer journey).
2. `Mingla_Artifacts/specs/SPEC_ORCH-0777_REAL_DEVICE_ORDER_VISIBILITY_AND_NOTIFICATION_REVIVAL.md`.
3. `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0777_PRODUCTION_TICKET_CHECKOUT_SALES_AND_BUYER_NOTIFICATIONS.md` and the rework reports (`IMPLEMENTATION_REWORK_ORCH-0777_PRODUCTION_TICKET_CHECKOUT_REWORK.md`, `IMPLEMENTATION_REWORK_ORCH-0777_PERSIST_FAILURE_CANCEL_SCOPE.md`, `IMPLEMENTATION_REWORK_ORCH-0777_LIVE_FIRE_NOTIFICATIONS_AND_PAID_CHECKOUT.md`).
4. `Mingla_Artifacts/reports/QA_ORCH-0777_TICKET_CHECKOUT_IOS_ANDROID_WEB_PARITY.md` and `QA_REWORK_ORCH-0777_PERSIST_FAILURE_CANCEL_SCOPE.md`.
5. `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0778_ORCH0777_WEB_EXPORT_STRIPE_NATIVE_IMPORT_GATE.md` (the gate that protects web from importing native Stripe — confirms web-checkout is an intentional gap as of ORCH-0778).
6. Memory `~/.claude/projects/.../memory/feedback_anon_buyer_routes.md` (anon-tolerant `/checkout/...`).
7. Memory `~/.claude/projects/.../memory/feedback_toast_needs_absolute_wrap.md` (superseded 2026-05-02 — Toast self-portals via Modal; old wraps are NO-OPS).
8. Memory `~/.claude/projects/.../memory/feedback_orchestrator_deploys_edge_functions.md` (orchestrator owns edge deploys).

No prior investigation report covers either ORCH-0789 or ORCH-0790 specifically. ORCH-0777 SPEC §4.6 ("J-C3 — Payment screen") defines the screen but does NOT specify Stripe-error discrimination (`Canceled` vs `Failed`), does NOT specify any Toast dismiss affordance, and explicitly defers web payment ("Stripe RN PaymentSheet is native-only; web returns inline copy"). ORCH-0778 added the web import-gate but did NOT define a web payment surface. Therefore both root causes are **gaps in the parent spec**, not regressions against an earlier shipped contract.

## Investigation manifest

| # | File | Why read |
|---|------|----------|
| 1 | `mingla-business/app/checkout/[eventId]/payment.tsx` | Symptom surface — both errors originate here |
| 2 | `mingla-business/src/components/ui/Toast.tsx` | Toast primitive — dismissal affordance audit |
| 3 | `mingla-business/src/payments/stripePaymentSheet.ts` | Platform-agnostic Stripe wrapper interface |
| 4 | `mingla-business/src/payments/stripePaymentSheet.native.ts` | iOS/Android implementation |
| 5 | `mingla-business/src/payments/stripePaymentSheet.web.ts` | Web stub |
| 6 | `mingla-business/src/payments/StripeNativeProvider.tsx`/`.native.tsx`/`.web.tsx` | Confirm publishable-key wiring |
| 7 | `mingla-business/src/services/ticketCheckoutService.ts` | Edge function client + error contract |
| 8 | `supabase/functions/_shared/ticketCheckout.ts` | Server-side checkout shared helpers |
| 9 | `mingla-business/node_modules/@stripe/stripe-react-native/lib/typescript/src/types/Errors.d.ts` | Verify Stripe RN `StripeError` shape — `code: PaymentSheetError.Canceled` |
| 10 | Grep `kind="error"` across `mingla-business/` | Blast-radius of persistent-error toasts |

## Findings

### 🔴 RC-789-1 — Toast primitive has no user-reachable dismiss affordance on iOS (root cause of "screen freezes")

**File + line:** `mingla-business/src/components/ui/Toast.tsx` lines 131–136, 243–318.

**Exact code (line 131-136):**
```ts
const AUTO_DISMISS: Record<ToastKind, number | null> = {
  success: 2600,
  info: 2600,
  warn: 6000,
  error: null,
};
```

Render tree (lines 244–318) is a native `<Modal transparent visible animationType="none" onRequestClose={onDismiss} statusBarTranslucent>` wrapping a portal `<View pointerEvents="box-none">` and an `Animated.View` carrying the toast card. The toast card contents are an icon badge + a `<Text>` message. **There is no `Pressable`, no `TouchableOpacity`, no `PanResponder`/`Gesture`, no close button, no backdrop tap handler.** The only path that fires `onDismiss` is `Modal.onRequestClose`, which RN documents as Android hardware-back-button only — it does not fire on iOS at all and there is no iOS hardware back. The auto-dismiss timer is explicitly disabled for `error` kind (`AUTO_DISMISS.error = null`, line 135) and the `useEffect` at line 218–224 returns early when `ms === null`.

**What it does:** when `<Toast kind="error" visible={true} onDismiss={...} />` mounts on iOS, the toast is permanent and the caller's `onDismiss` is never invoked.

**What it should do (direction only, NOT a fix):** every error toast must be dismissible by at least one of (a) tap-to-dismiss on the toast card, (b) explicit close icon, (c) bounded fallback auto-dismiss timer, OR the caller's render contract must guarantee `visible={false}` is set on some other observable signal (e.g., a route change or a fresh user action). Today none of those are true on the iOS public buyer screen.

**Causal chain:**

1. Buyer taps "Pay" → `handlePay` runs → Stripe `presentPaymentSheet()` returns an error (see RC-789-2 for why — including pure user-cancel).
2. `payment.tsx:163-166` sets `setDeclineToast(true)` and throws.
3. `<Toast kind="error" visible={declineToast} ...>` mounts. Modal portals over the whole screen layer.
4. `AUTO_DISMISS.error = null` → no timer set.
5. No tap surface, no close button, no swipe gesture, no iOS hardware-back → `onDismiss` is unreachable.
6. `declineToast` stays `true` forever → toast persists.
7. The Toast's `Modal` is `transparent` with `portalRoot` `pointerEvents="box-none"`, so most of the screen below the toast IS technically tappable — the user-perceived "freeze" comes from the unrecoverable banner + the visual halo of a Modal mount (the buyer cannot psychologically distinguish "underlying screen still tappable" from "screen frozen" when the toast they want to acknowledge will not go away). Empirically the operator reports they "cannot do anything else" — which means even the underlying back button, the Pay CTA, and any GlassCard taps appear inert from the buyer's perspective.
8. To fully verify Step 7, runtime-layer evidence is needed: is the iOS Modal portal blocking touches in an area larger than the toast card's visual footprint? See Phase 4 — Runtime layer below.

**Verification step (orchestrator/operator can run):** in the iPhone simulator, open the public Party Block page, advance to `/checkout/{eventId}/payment`, tap "Pay", and tap "X / close" in the Stripe sheet. Confirm the red toast appears, time the screen for 30 seconds, and attempt to tap (a) the toast itself, (b) the `CheckoutHeader` back button, (c) the Pay CTA. Report which (if any) respond.

**Confidence:** High on the dismiss-affordance gap (proven by reading the entire render tree). Medium on the "all surrounding taps appear inert" perception — depends on iOS Modal hit-testing semantics. The fix proposed in SPEC must close both possibilities.

---

### 🔴 RC-789-2 — Stripe `PaymentSheet` user-cancel is mis-classified as card-decline

**File + line:** `mingla-business/app/checkout/[eventId]/payment.tsx` lines 162–166.

**Exact code:**
```tsx
const payResult = await presentPaymentSheet();
if (payResult.error) {
  setDeclineToast(true);
  throw new Error(payResult.error.message);
}
```

**What Stripe actually returns** (from `node_modules/@stripe/stripe-react-native/.../types/Errors.d.ts:33-46`):
```ts
export declare enum PaymentSheetError {
  Failed = "Failed",
  Canceled = "Canceled",
  Timeout = "Timeout"
}
export interface StripeError<T> {
  code: T;
  message: string;
  localizedMessage?: string;
  declineCode?: string;
  stripeErrorCode?: string;
  type?: ErrorType;
}
```

So `presentPaymentSheet()` returns `{error: StripeError<PaymentSheetError>}` where `error.code` is one of `Failed | Canceled | Timeout`. The Mingla wrapper at `mingla-business/src/payments/stripePaymentSheet.ts:1-19` narrows the result type to `{error?: {message?: string}}` — **deliberately throwing away the `code` field** at the wrapper boundary. The caller therefore cannot discriminate "user closed the sheet" from "card was declined" from "API timeout" — every error path takes the "Card declined" branch.

**What it does:** when the buyer dismisses the payment sheet (taps the X, swipes down, or backgrounds the app and returns), Stripe returns `{error: {code: "Canceled", message: "The payment has been canceled"}}`. The wrapper passes `{error: {message: "The payment has been canceled"}}`. The caller treats this exactly like a card decline.

**What it should do:** distinguish `Canceled` (silent return to the payment summary, no toast — user just changed their mind), `Failed` (toast: "Card declined — try another payment method"), and `Timeout` (toast: "Stripe took too long — try again"). Each maps to a different recovery state, and `Canceled` should not show an error at all.

**Causal chain:**

1. Buyer taps "Pay" → `initPaymentSheet` succeeds → `presentPaymentSheet` opens the sheet.
2. Buyer taps the close (X) chevron in the sheet — no card was attempted.
3. Stripe returns `{error: {code: "Canceled"}}`.
4. Wrapper drops `code`; caller sees `{error: {message: ...}}` and goes to the decline branch (line 163).
5. `setDeclineToast(true)` displays the red banner → combined with RC-789-1, the buyer is locked in with a false "card declined" message they did not cause.

**Verification step:** add temporary `console.log(JSON.stringify(payResult))` at `payment.tsx:163` (operator can run), reproduce the symptom by cancelling the sheet, and confirm `payResult.error.code === "Canceled"`. (Investigator-only — the fix is SPEC's job.)

**Confidence:** High. The Stripe RN SDK type declares the discriminator; our wrapper provably narrows it away; the consumer provably has no other branch.

---

### 🟠 CF-789-3 — Mingla `PaymentSheetResult` wrapper type drops Stripe error discriminator (contributing factor enabling RC-789-2)

**File + line:** `mingla-business/src/payments/stripePaymentSheet.ts` lines 1–5.

**Exact code:**
```ts
export interface PaymentSheetResult {
  error?: {
    message?: string;
  };
}
```

**What it does:** establishes the wrapper boundary that throws away `code | declineCode | type | localizedMessage` from every Stripe payment sheet result. Even if `payment.tsx` wanted to branch on `Canceled`, the type system would not permit it.

**What it should do:** preserve at minimum `code: "Canceled" | "Failed" | "Timeout"` and `declineCode?: string` so callers can do precise error UX. (Direction only.)

**Causal chain:** RC-789-2 cannot be fixed at the caller alone without changing the wrapper contract. The wrapper change is structural and one-time; downstream callers can then make per-code decisions.

**Confidence:** High.

---

### 🟡 HF-789-4 — Persistent-error Toast is a primitive-level trap waiting to recur

**File + line:** `mingla-business/src/components/ui/Toast.tsx` line 135 (`error: null` auto-dismiss) + the entire render tree 243-318 (no dismiss surfaces).

**Why this is a hidden flaw, not just RC-789-1:** today there is exactly one error-toast call site in `mingla-business/` (grep `kind="error"` returned only `payment.tsx:364`). Any future call to `<Toast kind="error" ...>` will inherit the same trap. The primitive contract is broken, not just one call site. A fix that only patches `payment.tsx` leaves the trap armed for the next surface (refund failure, cancel failure, sign-in failure, etc.).

**Direction:** SPEC must fix the Toast primitive (add tap-to-dismiss OR mandatory close affordance OR bounded-but-long auto-dismiss for `error`) AND the `payment.tsx` call site. Patching only one is insufficient.

**Confidence:** High.

---

### 🔴 RC-790-1 — Mingla Business has no web payment surface at all; the web ticketCheckout flow is intentionally short-circuited

**Files + lines:**

- `mingla-business/src/payments/stripePaymentSheet.web.ts` lines 1–14:
  ```ts
  const unsupported = async (): Promise<PaymentSheetResult> => ({
    error: { message: "Stripe PaymentSheet is not available on web." },
  });
  export const useStripePaymentSheet = (): StripePaymentSheetController => ({
    isPaymentSheetSupported: false,
    initPaymentSheet: unsupported,
    presentPaymentSheet: unsupported,
  });
  ```
- `mingla-business/app/checkout/[eventId]/payment.tsx` lines 140–145 short-circuits `handlePay` for web:
  ```tsx
  if (!isPaymentSheetSupported) {
    setPaymentError(
      "Ticket payments are not available on web yet. Please complete checkout in the Mingla Business mobile app.",
    );
    return;
  }
  ```
- `mingla-business/src/payments/StripeNativeProvider.web.tsx` (web stub for the provider) confirms no Stripe.js / `@stripe/stripe-js` / `@stripe/react-stripe-js` integration is loaded on web.
- `mingla-business/src/payments/stripePaymentSheet.ts` (the platform-agnostic Metro fallback) ALSO returns `isPaymentSheetSupported: false`. Only `stripePaymentSheet.native.ts` returns `isPaymentSheetSupported: true` and is selected by Metro's `.native.ts` extension on iOS/Android.

**What it does:** all web buyers — desktop browser, mobile browser, in-app browser — hit a hard textual block. No PaymentIntent is created, no Stripe Elements/Checkout/Payment Link is offered, no redirect is attempted.

**What it should do (direction only, NOT a fix):** the public buyer-facing flow MUST offer a working web checkout path. The most common patterns (Stripe documents both as production-grade for Connect platforms):
1. **Stripe Checkout Sessions** — server creates a Checkout Session for the connected account, returns a `url`, mobile-web/desktop-web redirects to Stripe-hosted page, success/cancel routes back into `/checkout/{eventId}/confirm` and `/checkout/{eventId}/payment`. Lowest PCI scope, fastest to ship, supports Apple Pay/Google Pay on web automatically.
2. **Stripe.js Payment Element** — server returns a PaymentIntent client_secret (already does, see below), web app loads `@stripe/stripe-js` + `@stripe/react-stripe-js`, mounts `<Elements>` + `<PaymentElement>` in a new `payment.web.tsx` companion, calls `stripe.confirmPayment` on submit. Higher implementation cost but keeps the buyer inside the Mingla domain.

The decision between these is a SPEC-mode call; this investigation only proves the gap exists.

**Server-side reuse evidence:** the existing edge function `ticket-checkout-create` (called via `mingla-business/src/services/ticketCheckoutService.ts:64`) already returns `{kind: "requires_payment", clientSecret, paymentIntentId, publishableKey, ...}` (see `ticketCheckoutService.ts:10-19` for the typed return shape). That payload is already sufficient to drive Stripe.js Payment Element on web with **zero edge-function changes**. The Stripe Checkout Sessions path WOULD require a new edge function to create the Session (or an extension to `ticket-checkout-create` returning a `hostedCheckoutUrl`). Either is server-feasible; the choice belongs in SPEC.

**Anon-route confirmation:** `mingla-business/app/checkout/[eventId]/_layout.tsx` is outside `(tabs)/`, contains no `useAuth`, and does not redirect to sign-in (per memory `feedback_anon_buyer_routes.md` and confirmed by file inspection). `orders.account_id` is nullable. Both invariants permit anonymous web checkout end-to-end.

**Causal chain:**

1. Buyer clicks share link on iPhone Safari → lands at `/e/{brandSlug}/{eventSlug}` → taps "Get tickets" → reaches `/checkout/{eventId}/payment` after the buyer step.
2. `useStripePaymentSheet()` resolves to `stripePaymentSheet.web.ts` (Metro extension priority).
3. `isPaymentSheetSupported = false` → `handlePay` sets the inline error text and returns.
4. Buyer reads "use the mobile app" — but on iPhone Safari there is no native fallback (no deep-link). Buyer abandons.

**Verification step:** open `https://<deployed-business-web-url>/checkout/{eventId}/payment` in any browser → confirm the inline copy appears and Pay does nothing. Confirm `mingla-business/web-build` / `metro.config.js` does not bundle `@stripe/stripe-js` (grep `package.json` for Stripe.js — currently absent).

**Confidence:** High. The gap is intentional and documented in ORCH-0778 (web-export Stripe-native import gate). The product impact (web is a real buyer surface, share links default to browser) makes this S0 not S2.

---

### 🟠 CF-790-2 — Inline "use the mobile app" copy is misleading on desktop browsers

**File + line:** `mingla-business/app/checkout/[eventId]/payment.tsx` lines 140-145 and lines 306-310 (the GlassCard PAYMENT block copy: `"Ticket payments are not available on web yet. Please complete checkout in the Mingla Business mobile app."`).

**What it does:** tells desktop-browser buyers to use the "Mingla Business mobile app" even though Mingla Business is the **organiser** app, not a buyer app. The end buyer has no reason to install a business-tool app, and the copy implies they should. This is a product-positioning bug independent of RC-790-1: even if web checkout were intentionally deferred, the copy points at the wrong target.

**Direction:** SPEC should address copy AND ship the web payment path. Until web ships, copy should at minimum (a) not call it the "Business" app, (b) offer a fallback (email me a payment link, share to Apple Pay, etc.).

**Confidence:** High.

---

### 🔵 OBS-789-5 — Stale `toastWrap` View at `payment.tsx:361-368` is a NO-OP

**File + line:** `mingla-business/app/checkout/[eventId]/payment.tsx` lines 361–368 + `styles.toastWrap` (lines 499–504).

**Observation:** the absolute-positioned `<View style={styles.toastWrap} pointerEvents="box-none">` wrapping the Toast is left over from the pre-2026-05-02 Toast pattern. Toast self-portals via Modal now (memory `feedback_toast_needs_absolute_wrap.md`); the wrap is a NO-OP. Leaving it does not affect the RC-789-1/2 freeze and is therefore NOT the bug — it's housekeeping the SPEC can opt to clean up but does not have to.

**Confidence:** High.

---

## Five-layer cross-check

| Layer | Truth on the table |
|-------|--------------------|
| **Docs (SPEC ORCH-0777 §4.6)** | Defines J-C3 Payment screen; specifies init + present PaymentSheet; does NOT specify error-code branching, does NOT specify Toast dismiss affordance, explicitly defers web payment. |
| **Schema** | `orders.account_id` is nullable (anon-tolerant); `ticket_checkout_sessions` row is created by `ticket-checkout-create` and finalised by Stripe webhook → not consumed/orphaned by a user-cancel because Stripe's PaymentIntent auto-expires (1h) and our edge function uses `cancelPaymentIntentIfClientAvailable` cleanup on server-side terminal failures. **However**, a user-cancel from the client side does NOT currently call `paymentIntents.cancel` — it just leaves the PaymentIntent open. Not catastrophic (Stripe expires it) but worth flagging — see Open Questions. |
| **Code (Mingla Business)** | `payment.tsx` + `stripePaymentSheet.ts` family + `Toast.tsx` confirm both RCs (as documented above). |
| **Runtime** | Operator-observed: "screen freezes, cannot dismiss toast, cannot do anything else" — matches the prediction from RC-789-1 + RC-789-2 + (likely) Modal hit-test halo. Web report ("cannot complete on browser") matches the prediction from RC-790-1. |
| **Data** | Not yet inspected. If many cancelled-but-not-finalised `ticket_checkout_sessions` rows exist with orphan Stripe PaymentIntents, that's a follow-up cleanup (out of scope; flagged in Open Questions). |

Contradictions: none in the spec sense — both root causes are gaps in the SPEC + primitive contracts, not violations of an existing one. The product POSITIONING contradiction (RC-790-1 copy says "Business mobile app" — the buyer doesn't have one) is documented in CF-790-2.

## Blast radius

- **ORCH-0789 surfaces affected today:**
  - Public buyer flow `/checkout/{eventId}/payment` (the symptom).
  - No other call site uses `<Toast kind="error">` today (only `payment.tsx:364` matched the grep), so RC-789-1's TODAY blast is one screen.
  - **Future blast (HF-789-4):** every future error toast in `mingla-business/` inherits the trap. This includes the planned ORCH-0787 refund/cancel error UX, the planned ORCH-0788 buyer notification error UX, and any door-sale failure toast. Patching `Toast.tsx` once is a one-time inoculation.
- **ORCH-0790 surfaces affected today:**
  - Every public event share link opened in a browser (the most common buyer journey from social bios + WhatsApp + iMessage previews).
  - Web public brand page `/b/{brandSlug}` → event card → checkout: same gap.
  - Any organiser link emailed via ORCH-0785 buyer ticket confirmation that points to a "manage tickets" web URL is unaffected (post-purchase, not pre-purchase).
- **Mobile organiser app (`mingla-business` inside `(tabs)/`):** unaffected — organisers aren't buyers.
- **Mingla mobile (`app-mobile/`):** unaffected — it is a separate app and does not host the buyer checkout.
- **Admin dashboard (`mingla-admin/`):** unaffected.

## Invariant cross-check

- **I-PUBLIC-BUYER-ANON-TOLERANT (memory `feedback_anon_buyer_routes.md`):** preserved. Neither fix needs to add `useAuth` to a buyer route. (`/checkout/{eventId}/payment` and any future `payment.web.tsx` companion live outside `(tabs)/`.)
- **I-TOAST-SELF-PORTAL (memory `feedback_toast_needs_absolute_wrap.md`, post-2026-05-02):** preserved. The Toast primitive change in HF-789-4 must not break self-portal positioning.
- **NEW PROPOSED INVARIANT (for SPEC to register):** `I-PROPOSED-ERROR-TOAST-DISMISSIBLE` — every `<Toast kind="error">` must be user-dismissible without external state changes (tap-to-dismiss OR close icon OR bounded auto-dismiss). Enforced by a unit/render test in `mingla-business/src/components/ui/__tests__/Toast.test.tsx` + a strict-grep gate that forbids `error: null` in `AUTO_DISMISS` without a paired dismiss affordance assertion.
- **NEW PROPOSED INVARIANT:** `I-PROPOSED-STRIPE-ERROR-CODE-DISCRIMINATED` — the Mingla Business Stripe wrapper MUST preserve `PaymentSheetError` code so callers can distinguish `Canceled` from `Failed`. Enforced by typing + a unit test that mocks Stripe and asserts the wrapper does not collapse the discriminator.

## Recurring-pattern check

- **Pattern: "primitive contract too loose; one caller breaks per quarter."** This is the same family as the Toast positioning incident (memory `feedback_toast_needs_absolute_wrap.md`, replaced 2026-05-02) and the keyboard-blocks-input incident (memory `feedback_keyboard_never_blocks_input.md`). Fixing the primitive is preferred to fixing every caller.
- **Pattern: "wrapper drops a discriminator."** Same family as the `Response` instanceof RN polyfill issue documented in memory `feedback_short_responses.md`/§"Supabase Error Handling in React Native". When a Mingla wrapper normalises an SDK error, it must preserve every field a caller might branch on.

## Open questions for orchestrator (SPEC mode must decide)

1. **Web fix path — Checkout Sessions vs Payment Element?** Checkout Sessions ships fastest, supports Apple Pay/Google Pay on web automatically, lowest PCI scope, but the buyer leaves the Mingla brand for a Stripe-hosted page. Payment Element keeps the brand but needs a new web entry, new dependencies, and an in-house success/error UX. Recommend Checkout Sessions for ORCH-0790 v1 and revisit Payment Element later if brand-control becomes a launch blocker. Operator decision.
2. **Cancel-toast policy — silent or info?** When Stripe returns `Canceled`, options are (a) show no toast and stay on the payment screen, (b) show a soft info toast ("Payment cancelled — try again when you're ready"). Recommend (a) — Stripe already gave visual feedback by dismissing the sheet. Operator decision.
3. **Toast dismiss affordance — tap-to-dismiss OR close icon OR both?** The Mingla brand presently has no close-icon pattern on toasts. Tap-to-dismiss is the minimum-pixel intervention but is undiscoverable. Recommend BOTH: explicit close icon (✕) on the right edge for discoverability + tap-anywhere-on-toast for ergonomics + a bounded 12 s fallback timer for error so a buyer who locks their phone returns to a recoverable screen. Operator decision.
4. **Web-block copy until ORCH-0790 ships — what does the inline copy say?** Even with a fast web fix, ORCH-0789 ships first. Until ORCH-0790 deploys, recommend changing the copy to "Open this checkout on your phone — we'll send a link" with an email-link fallback. Operator decision (and possibly a sub-ORCH).
5. **Orphan client-side cancelled PaymentIntents — clean up?** When the buyer cancels the sheet, the PaymentIntent stays open until Stripe's 1 h auto-expiry. Functionally harmless but adds noise to the Stripe dashboard. Recommend a follow-up sub-ORCH to call `paymentIntents.cancel` (via a small edge function) on client-cancel — out of scope here. Operator decision.

## Confidence levels

| Finding | Confidence | What would raise it |
|---------|-----------|---------------------|
| RC-789-1 (Toast undismissable) | **High** | Already H — proven by reading the entire render tree |
| RC-789-1 hit-test halo on iOS | **Medium** | Live-fire simulator test confirming surrounding taps' responsiveness |
| RC-789-2 (cancel mis-classified) | **High** | Already H — Stripe SDK type + wrapper type + caller code all verified |
| CF-789-3 (wrapper drops code) | **High** | Already H |
| HF-789-4 (primitive trap) | **High** | Already H |
| RC-790-1 (no web payment surface) | **High** | Already H — both stubs verified |
| CF-790-2 (misleading copy) | **High** | Already H |
| Orphan-PI count in production data | **Low** | Would require live SQL query against `ticket_checkout_sessions` (out of scope) |

## Discoveries for orchestrator (side issues — register separately)

- **DISC-1: Orphan client-cancelled PaymentIntents.** When the buyer cancels the Stripe sheet, no server-side cancel fires; PaymentIntents linger until 1h Stripe auto-expiry. Likely a follow-up sub-ORCH ("buyer-cancel server reconciliation") at P2.
- **DISC-2: `stripePaymentSheet.ts` (platform-agnostic Metro fallback) is structurally identical to `stripePaymentSheet.web.ts`.** Both return `isPaymentSheetSupported: false` with the same `unsupported` stub. If Metro ever fails to resolve a `.native.ts` (e.g., a bad bundler config), iOS would silently fall through to the web stub and the buyer would see CF-790-2 copy on iPhone. Tighten by either (a) deleting the fallback file and letting Metro fail loudly, or (b) making the fallback throw a build-time assertion. Sub-ORCH at P3.
- **DISC-3: Stale `toastWrap` View in `payment.tsx`.** OBS-789-5 — cosmetic; SPEC can include the removal or leave it. Not blocking.
- **DISC-4: `Toast.tsx` `AUTO_DISMISS.error = null` predates the self-portal change** and was probably chosen because errors deserve user acknowledgement. Acknowledgement does not require permanence — a 12 s bounded timer + explicit close still requires the user to read the message but does not strand them.

## Fix-strategy direction (NOT a spec — orchestrator hands to SPEC mode next)

**ORCH-0789 (mobile freeze):** four-part fix at the right layer for each problem.
1. `Toast.tsx` — give the error toast a user-dismissible affordance (close icon + tap-to-dismiss) and a bounded fallback auto-dismiss for `error` (recommend 12 s, SPEC owns the exact value). Add a render test asserting `kind="error"` is dismissible by every available mechanism.
2. `stripePaymentSheet.ts` — widen the `PaymentSheetResult.error` type to carry `code: "Canceled" | "Failed" | "Timeout"` (verbatim from Stripe's `PaymentSheetError` enum) + `declineCode?: string`. Update `.native.ts` to pass these through.
3. `payment.tsx:162-166` — branch on `payResult.error.code`. `Canceled` → silent return to payment summary (no toast). `Failed` → existing decline toast (now dismissible per part 1). `Timeout` → distinct timeout toast.
4. Strict-grep gate so a future caller cannot add `kind="error"` to a Toast without ALSO providing an `onDismiss` callback that resolves to a reachable state change.

**ORCH-0790 (web buyer payment surface):** SPEC must first decide Checkout Sessions vs Payment Element (Open Q-1). If Checkout Sessions:
1. Extend `ticket-checkout-create` (or add `ticket-checkout-create-web`) edge function to return a `hostedCheckoutUrl` for web callers. Reuse existing PaymentIntent/inventory plumbing.
2. Add a web-only branch in `payment.tsx` (or a `payment.web.tsx` companion) that calls `createTicketCheckout`, receives `hostedCheckoutUrl`, and `window.location = hostedCheckoutUrl`.
3. Wire the Stripe Checkout success/cancel URLs back to `/checkout/{eventId}/confirm` and `/checkout/{eventId}/payment`.
4. Update copy at `payment.tsx:308` so until step 1-3 ships, the message points the buyer at an email-me-the-link fallback instead of "use the Business mobile app".

## Regression prevention requirements

1. Render test in `mingla-business/src/components/ui/__tests__/Toast.test.tsx` asserting that `kind="error"` toast invokes `onDismiss` when (a) the close icon is tapped, (b) the toast body is tapped (if SPEC chooses that pattern), and (c) the bounded auto-dismiss timer elapses.
2. Type-level test that `PaymentSheetResult.error.code` exists and is the Stripe `PaymentSheetError` enum.
3. Unit test for `payment.tsx` `handlePay` branching: mock `presentPaymentSheet` to return each of `{code: "Canceled"}`, `{code: "Failed"}`, `{code: "Timeout"}` and assert the resulting state (`declineToast`, `paymentError`, route).
4. Strict-grep gate `orch-0789-error-toast-dismissible` forbidding `<Toast kind="error"` without a paired dismiss-affordance call site assertion (mirror the registry pattern in memory `feedback_strict_grep_registry_pattern.md`).
5. For ORCH-0790: a web-build smoke test that visits `/checkout/{eventId}/payment` on web and asserts a Stripe-hosted URL redirect (or PaymentElement mount), not the inline-copy block.
