# QA RETEST — ORCH-0789 + ORCH-0790: Cart state survives Stripe Checkout redirect

**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`.
**Mode:** Claude `mingla-tester` (parity mirror) · RETEST sub-mode.
**Predecessors:** initial QA FAIL + implementor rework at `Mingla_Artifacts/reports/QA_ORCH-0789_AND_0790_*.md` + `Mingla_Artifacts/reports/IMPLEMENTATION_REWORK_ORCH-0789_AND_0790_*.md`.
**Disclosure:** I am also the implementor and the previous tester for this dispatch. Per discipline rules I'm treating every implementor claim as worthless; the findings below come from an independent code re-read and gate re-run.
**Retest cycle:** 1 of 2 (well under the stuck-in-loop threshold).

---

## Verdict

**PASS** (code-side). All three P1 findings resolved; P2-B rolled in; no new defects introduced; all code gates green.

| Severity | Count this retest |
|----------|-------------------|
| P0 — CRITICAL | 0 |
| P1 — HIGH | 0 |
| P2 — MEDIUM | 1 (P2-A — deferred; documented in initial QA) |
| P3 — LOW | 1 (Toast Pressable bubble — documented in initial QA) |
| P4 — NOTE | 4 |

Live-fire smoke on iPhone simulator + web browser (SPEC §5 T-20, T-21, T-22) is still owed to the operator after the four deploy gates (migration push, web base URL secret, Stripe RAK scope check, edge function deploys). Those are runtime verifications no static analysis can substitute for.

---

## Previous FAIL findings — fix verification

For each previous FAIL finding, I verified (a) the fix exists in code, (b) the fix actually resolves the issue, (c) no regression introduced.

### P1-A — Web /confirm hero shows "Sent to  and "

**Fix exists in code:**
- `mingla-business/app/checkout/[eventId]/confirm.tsx:188-191` — resume effect now calls `setBuyer(payload.buyer)` when `buyer.email.length === 0 && buyer.phone.length === 0`.
- Persistence side: `mingla-business/app/checkout/[eventId]/payment.tsx:235-241` — `writeCheckoutResumePayload(storage, eventId, {..., buyer})` includes the buyer.

**Fix actually resolves the issue:** verified by tracing the state machine on a Stripe-success cold reload at `/confirm?cs=...`:
1. Mount with `INITIAL_STATE` (`buyer = EMPTY_BUYER`: name/email/phone are empty strings, marketingOptIn false).
2. Resume effect: `Platform.OS === "web"` AND `eventId !== null` AND `result === null` AND `/[?&]cs=/.test(search)` AND `readCheckoutResumePayload` returns the payload → enters body.
3. Empty-check `buyer.email.length === 0 && buyer.phone.length === 0` is true → `setBuyer(payload.buyer)` dispatched.
4. After commit, hero line `Sent to {buyer.email} and {buyer.phone}` renders with real data.

**No regression introduced:** native flow short-circuits at the first `if (Platform.OS !== "web") return;` line. The `setBuyer` is wrapped in `useCallback([])` so its identity is stable — no re-render storm. Reducer's `SET_BUYER` merges patches (`{ ...state.buyer, ...action.patch }`) so future patches still work. ✓

### P1-B — Web /confirm order summary shows zero line items

**Fix exists in code:** `mingla-business/app/checkout/[eventId]/confirm.tsx:175-187` — resume effect iterates `payload.lines` and replays each via `setLineQuantity({...})` when `lines.length === 0`.

**Fix actually resolves the issue:** verified by tracing reducer behaviour:
1. Resume reads `payload = { lines: [{ticketTypeId: "tt_1", ticketName: "GA", quantity: 2, ...}], ... }`.
2. For-loop dispatches one `SET_LINE_QUANTITY` per line.
3. Reducer (`CartContext.tsx:128-174`) sees no existing line with this ticketTypeId → appends to state.lines. Idempotent: a second dispatch for the same id with the same quantity SETs (line 168-173 maps over and replaces the matching line), it does NOT append twice.
4. After commit, `confirm.tsx:280-290` (`lines.map((l) => <View ... />`) renders the rows.

**No regression introduced — verified two specific risks:**

1. **React strict-mode double-invocation.** Strict mode dev fires effects twice. Second invocation has same closure (`lines=[]` initially before commit). But: `setLineQuantity` is in a `useCallback([])`, identity stable. Second dispatch: reducer finds the line by id (added in first dispatch's commit, even though closure hasn't re-rendered yet — React processes dispatches synchronously within a render commit cycle) → matches existing line → re-sets same quantity. Idempotent. No duplicates. ✓
2. **Currency-mixing guard.** Reducer line 134-141: if a new SET_LINE_QUANTITY arrives with a currency different from `state.lines[0]?.currency`, throws "Cart cannot mix currencies." For the restore, all persisted lines came from the same event (same currency by construction). No throw. ✓

### P1-C — Web Stripe cancel bounces buyer through three screens

**Fix exists in code:**
- `mingla-business/app/checkout/[eventId]/payment.tsx:63-69` — new `restoreChecked` state initialised `true` on native, `false` on web.
- `mingla-business/app/checkout/[eventId]/payment.tsx:95-119` — restore-on-mount useEffect that reads sessionStorage and replays lines + buyer when web AND cart empty AND payload exists. Sets `restoreChecked = true` after.
- `mingla-business/app/checkout/[eventId]/payment.tsx:126-128` — defensive bounce useEffect now gates on `restoreChecked` — does nothing until the restore check completes.

**Fix actually resolves the issue:** verified by tracing the state machine on a Stripe-cancel return at `/payment` cold reload:
1. Mount with `INITIAL_STATE` (lines=[], buyer empty). `restoreChecked` initial state = false (web).
2. Two effects fire on mount (React 18 may batch). Order matters:
   - Restore effect (line 95): `Platform.OS === "web"`, `eventId !== null`, `restoreChecked === false`, reads storage → payload found, `lines.length === 0` → for-loop dispatches setLineQuantity x N, setBuyer. Then `setRestoreChecked(true)`.
   - Defensive guard effect (line 126): `restoreChecked === false` (initial render) → SKIP (line 128). Defensive guard does NOT bounce on this render.
3. React commits all dispatches. Re-renders with `lines.length > 0`, `buyer` populated, `restoreChecked === true`.
4. Defensive guard effect fires (deps changed): `restoreChecked === true`, `lines.length !== 0`, `totals.isFree === false`, buyer details valid → all four bounce branches skip. ✓
5. Buyer sees `/payment` with original cart + buyer details. Pay button enabled. Can retry immediately. ✓

**No regression introduced — verified two specific risks:**

1. **Initial render race.** On the first render, the restore-effect's `useEffect` and the defensive-guard's `useEffect` are both registered to run after the commit. React runs them in declaration order (top to bottom). Restore-effect declared FIRST (line 95), defensive-guard SECOND (line 126). Restore dispatches state updates (queued), then `setRestoreChecked(true)` (also queued). All queued updates batched into one commit. NEXT render fires both effects again — but restore-effect short-circuits at `if (restoreChecked) return` (line 98). Defensive-guard now runs with `restoreChecked === true` and populated lines/buyer. ✓ No bounce-race.
2. **Empty storage on first-time visit.** Cold visit to `/payment` (cart populated in prior navigation, no Stripe redirect involved): restore effect runs, `readCheckoutResumePayload` returns null because no entry was ever written → body short-circuits, `setRestoreChecked(true)` fires. Defensive guard runs normally, sees populated cart, no bounce. Standard flow preserved. ✓
3. **Native first-mount.** `restoreChecked = useState(Platform.OS !== "web")` initialises to `true` on native. Restore effect's first line short-circuits on `Platform.OS !== "web"`. Defensive guard's `if (!restoreChecked) return` skip is never reached. Native behavior IDENTICAL to pre-rework. ✓

### P2-B — `processing` state stuck when `window.location.assign` unavailable

**Fix exists in code:** `mingla-business/app/checkout/[eventId]/payment.tsx:248-256` — `if (w.location?.assign) { w.location.assign(...) } else { setProcessing(false); setPaymentError("Couldn't redirect to Stripe. Please try again from a standard browser."); }`.

**Fix actually resolves the issue:** verified by reading. When `location.assign` is undefined (sandbox/test), the else branch resets `processing` and surfaces an inline error. Buyer is no longer stuck. ✓

**No regression introduced:** in real browsers `location.assign` is always available, so the if-branch fires identically to before. ✓

---

## SC-01..SC-14 re-traceability (post-rework)

| # | Criterion | Previous | This retest |
|---|-----------|----------|-------------|
| SC-01 | Cancel = silent return | PASS (code) | PASS (code) — unchanged |
| SC-02 | Decline toast dismissible | PASS | PASS — unchanged |
| SC-03 | Timeout distinct message | PASS (code) | PASS (code) — unchanged |
| SC-04 | Web redirect on Pay | PASS (code) | PASS (code) — `writeCheckoutResumePayload` now persists the full payload before redirect |
| SC-05 | Web success → /confirm with tickets | **PARTIAL** previously | **PASS (code) — UPGRADED.** Hero + summary now render with real data after restore + poll. Live browser smoke still owed. |
| SC-06 | Web cancel → /payment, no toast | **PARTIAL** previously | **PASS (code) — UPGRADED.** Cart + buyer preserved. No bounce. Live browser smoke still owed. |
| SC-07 | Native flow unchanged | PASS | PASS — full Jest suite 48/48, 303/303 still green |
| SC-08 | Error auto-dismiss at 12s | PASS | PASS — unchanged |
| SC-09 | Strict-grep gate works | PASS | PASS — `orch-0789-error-toast-dismissible` still exits 0 |
| SC-10 | No `useAuth` in buyer routes | PASS | PASS — confirmed by grep on payment.tsx + confirm.tsx (zero `useAuth` references) |
| SC-11 | Legacy "Business mobile app" copy removed | PASS | PASS — strict-grep §9 still enforces |
| SC-12 | Wrapper preserves Canceled | PASS | PASS — unchanged |
| SC-13 | Unknown code → Failed | PASS | PASS — unchanged |
| SC-14 | DB accepts `awaiting_web_redirect` | PASS (pending push) | PASS (pending push) — migration unchanged |

**Net change vs initial QA:** SC-05 and SC-06 upgrade from PARTIAL to PASS. The two FAIL findings P1-A/B/C are now PASS. All other criteria unchanged. Zero regressions.

---

## Independent re-read of the rework changes

I read each rework file with adversarial intent, hunting for bugs.

### `checkoutPersistence.ts` (NEW)

- **Pure data — no React, no RN.** Confirmed by reading the imports: only a type import from `CartContext`. ✓
- **Type guards are exhaustive.** `isCartLine` checks all six required fields with correct types. `isBuyerDetails` checks all four (name, email, phone, marketingOptIn). `isCheckoutResumePayload` requires checkoutSessionId AND buyerStatusToken to be non-empty strings, lines to be an array of valid CartLine, buyer to be valid BuyerDetails. ✓
- **JSON.parse wrapped in try/catch.** Returns null on malformed JSON, never throws. ✓
- **Storage = undefined gracefully handled.** All three operations short-circuit. Native callers can pass `undefined` without surfacing. ✓
- **No XSS risk introduced.** All values are JSON-stringified going in, JSON-parsed coming out. Storage values are sandboxed to same-origin same-tab. Stored values are buyer-self-entered, no rendering-as-HTML anywhere. ✓
- **No PII leak risk introduced.** sessionStorage is per-tab, never cross-tab. Cleared on success. Buyer's own data; same scope as the buyer screen they typed it into. ✓
- **Per-eventId scoping.** Key includes eventId so different events don't conflict. ✓

15 unit tests cover the full surface. All 15 PASS independently re-run via `npx jest checkoutPersistence.test` in this session.

### `payment.tsx` rework

- **`restoreChecked` initial value depends on Platform.OS.** Verified `Platform` is imported at the top of the file. The `Platform.OS !== "web"` evaluates at component init time, returns boolean. ✓
- **Restore effect deps `[eventId]`.** ESLint disabled with explicit comment justifying the choice (runs once per mount, intentional). The eslint-disable is targeted, not a blanket suppression. ✓
- **Effect body is idempotent.** `setRestoreChecked(true)` runs even if the restore body short-circuits, so the gate always lifts. ✓
- **Defensive guard deps include `restoreChecked`.** Line 152 verified. Without this, the guard wouldn't re-evaluate after restoration. ✓
- **`writeCheckoutResumePayload` called only inside `Platform.OS === "web"` branch.** Verified by reading the surrounding `if (Platform.OS === "web") { try { ... } }` block. Native flow never touches storage. ✓
- **Inline else for missing `location.assign`.** Reset processing + inline error. ✓ Same behavior in test environments where `location.assign` is shimmed out.

### `confirm.tsx` rework

- **`setLineQuantity`, `setBuyer` destructured from `useCart()`.** Both come from the existing context API. No new context surface added. ✓
- **Restore runs BEFORE the async poll.** Synchronous dispatches happen first; only after that does the `(async () => {...})()` IIFE fire. ✓
- **Restore uses the same empty-check guards as payment.tsx** (`lines.length === 0` and `buyer.email.length === 0 && buyer.phone.length === 0`). Defends against double-restore if effect re-runs. ✓
- **Storage cleared via `clearCheckoutResumePayload` only after `recordResult` succeeds.** Failure path leaves storage intact for retry. Verified by reading lines 217-223. ✓
- **Defensive bounce now skips when `webResumeError !== null`.** Lines 245 — keeps the "Payment received" fallback render visible. ✓
- **Cancel still flows through unchanged** — the new "skip bounce if resume-payload exists" predicate is a strict superset of the previous "skip if ?cs= + raw storage key exists" predicate. ✓

---

## Constitution check (re-verify all 14)

| # | Rule | Status this retest |
|---|------|-------------------|
| 1 | No dead taps | ✅ (unchanged) |
| 2 | One owner per truth | ✅ — `checkoutPersistence.ts` is the canonical persistence helper; CartContext remains the canonical cart-state authority |
| 3 | No silent failures | ✅ — malformed payloads return null (not throw + swallow); poll failure surfaces via `webResumeError` |
| 4 | One key per entity | N/A |
| 5 | Server state server-side | ✅ — sessionStorage stores buyer-typed inputs + opaque tokens, NOT server-fetched records. Server-issued tickets (`result.tickets`) still come fresh from `pollTicketCheckoutStatus`. |
| 6 | Logout clears everything | N/A (buyer flow anon) |
| 7 | Label temporary | ✅ — no new `[TRANSITIONAL]` markers |
| 8 | Subtract before adding | ✅ — replaced inline ad-hoc JSON parse + narrow type with the canonical helper |
| 9 | No fabricated data | ✅ — pre-resolve empty render is correct (better blank than fake); post-restore data is exactly what the buyer typed |
| 10 | Currency-aware | ✅ — currency in persisted CartLine is preserved |
| 11 | One auth instance | N/A |
| 12 | Validate at right time | ✅ — restore happens at mount, before defensive guard, before render |
| 13 | Exclusion consistency | N/A |
| 14 | Persisted-state startup | ✅ **NOW FULLY MET.** Previous QA flagged this as ⚠️ PARTIAL because cart state wasn't restored. This retest verifies the rework completes the persisted-state-startup story for the web buyer flow. |

Zero constitution violations.

---

## Cross-domain re-check

1. **`app-mobile/`** — untouched (no consumer-app changes).
2. **`mingla-admin/`** — untouched.
3. **`mingla-business/` organiser surfaces** — untouched. Verified by grep: the new `checkoutPersistence.ts` is imported only by `payment.tsx` and `confirm.tsx` (both buyer surfaces).
4. **`supabase/functions/`** — untouched by the rework (initial implementation's edge function changes are preserved; nothing in the rework modified them). Verified by `git diff` filename list: only `payment.tsx`, `confirm.tsx`, `checkoutPersistence.ts`, the new test file, and the rework report.
5. **Native iOS / Android flow** — verified short-circuit paths. Native is byte-for-byte unchanged at runtime.

---

## Independent code-gate runs (this retest, not relying on implementor claims)

| Gate | Command | Result |
|------|---------|--------|
| TypeScript | `cd mingla-business && npx tsc --noEmit` | PASS — exit 0 |
| Jest full suite | `npx jest` | PASS — **48/48 suites, 303/303 tests** in 14.2 s |
| Targeted Jest (the 4 ORCH-0789/0790 test files) | `npx jest --testPathPattern "(checkoutPersistence\|stripePaymentSheet\|Toast\|ticketCheckoutService)\.test\."` | PASS — 4 suites / 29 tests |
| ORCH-0789 strict-grep gate | `node .github/scripts/strict-grep/orch-0789-error-toast-dismissible.mjs` | PASS — exit 0 |
| ORCH-0778 strict-grep gate (cross-check no native Stripe leak) | `node .github/scripts/strict-grep/orch-0778-web-stripe-native-import-gate.mjs` | PASS |
| Full strict-grep sweep | `for f in .github/scripts/strict-grep/*.mjs; do node "$f"; done` | 1 PRE-EXISTING FAIL on `orch-0776a` (already flagged in DISC-IMPL-1; outside this dispatch's scope) |

---

## Findings this retest

### P2 (deferred, documented in initial QA — unchanged)

**P2-A:** Stripe Checkout line item still displays "Tickets — Tickets" because the RPC doesn't return `eventName`. Out of REWORK scope (requires RPC change). Recommend separate P3 sub-ORCH.

### P3 (documented in initial QA — unchanged)

**P3-1:** Toast outer Pressable + inner close-icon Pressable may double-fire `onDismiss` on react-native-web. Acceptable because `onDismiss` consumers are idempotent. Current Toast.tsx comment at line 252 documents the contract.

### P4 (praise — adding new ones from this retest)

**P4-1 (carried):** Clean wrapper-extraction pattern for `normalizePaymentSheetResult`.

**P4-2 (carried):** Defensive failure-classification reuse in `_shared/ticketCheckout.ts`.

**P4-3 (carried):** Webhook metadata-fallback path is a clean defensive add.

**P4-4 (new):** The rework's `checkoutPersistence.ts` follows the same extracted-helper pattern as `normalizePaymentSheetResult.ts` and `toastTimings.ts` — pure data helpers with no RN imports, unit-testable in the node-env Jest harness, single source of truth for both the producer and consumer. Worth replicating for any future buyer-flow surface that needs persistence.

---

## Regression surface re-check

Tested by code-tracing each adjacent feature:

1. **Native iOS PaymentSheet happy path** — restore effect short-circuits on `Platform.OS !== "web"`. `restoreChecked` initialises true. Defensive guard fires on first render exactly as before. ✓
2. **Native iOS error paths (Canceled / Failed / Timeout)** — `payment.tsx` error-code switch unchanged. ✓
3. **Web free-checkout flow** — `totals.isFree` defensive bounce at line 133 redirects to `/buyer` BEFORE `handlePay` is ever called. Free path never reaches the web persist code. ✓
4. **Web cancel → /payment** — verified by state-machine trace above (P1-C section). ✓
5. **Web success → /confirm** — verified by state-machine trace above (P1-A/B section). ✓
6. **Web hard refresh of /confirm after a successful poll** — storage cleared on success, so re-mount finds no payload, defensive bounce fires correctly. Acceptable (DISC-REWORK-3). ✓
7. **Mobile Jest suite** — 48/48 suites green, no regressions. ✓
8. **Edge function `surface: "web"` invocation** — service `createTicketCheckout({surface: "web"})` unchanged; edge function unchanged. ✓
9. **Currency-mixing guard in reducer** — restore preserves currency on each line (all from same event, same currency). No throw. ✓
10. **Stripe webhook flow** — webhook router unchanged in rework. ✓

---

## What still needs operator action (carried from initial QA, unchanged)

1. **`supabase db push --linked`** for `20260520000001_orch_0789_0790_web_checkout.sql`.
2. **Set Supabase function secret `MINGLA_PUBLIC_WEB_BASE_URL`** to the canonical Mingla Business web origin.
3. **Verify `STRIPE_RAK_TICKET_CHECKOUT` has `checkout_sessions:write` scope.**
4. **Deploy `ticket-checkout-create`** (`supabase functions deploy ticket-checkout-create --project-ref gqnoajqerqhnvulmnyvv`).
5. **Deploy `stripe-webhook`** (the function importing `_shared/stripeWebhookRouter.ts`).
6. **(Optional)** subscribe Stripe Dashboard webhook to `checkout.session.completed` for observability.

After the deploys, run the three live-fire smokes:

- **T-20 — iPhone simulator.** Cancel (close sheet without entering card) → silent return, no toast. Decline (4000…0002) → dismissible toast. Success (4242…4242) → /confirm with tickets.
- **T-21 — Web Safari success.** Build cart → tap Pay → complete on Stripe page with 4242…4242 → /confirm shows real email/phone in "Sent to" line, real summary card with line items, QR carousel populated.
- **T-22 — Web Safari cancel.** Build cart → tap Pay → tap Back on Stripe page → return to /payment with cart selections + buyer details preserved. Tap Pay again → can retry without rebuilding.

---

## Discoveries for orchestrator (this retest)

- **DISC-RETEST-1: SPEC §SC-06 wording** should be tightened at CLOSE to "buyer remains on /payment with cart selections + buyer details preserved" instead of "no toast and no error message." Already flagged as DISC-REWORK-1; reiterating for visibility.
- **DISC-RETEST-2: The `webResumeError` fallback render** in `confirm.tsx:227-243` uses the existing `hero`/`checkBadge`/`heroTitle`/`heroEmail` styles. Renders fine but does NOT include the order ID or any QR. Acceptable — the buyer's email/PDF carry the ticket. If the orchestrator wants a richer fallback later (e.g., "your order is 6ad119af-…"), pass `result.orderId` through the resume → fallback render path. Low priority.
- **DISC-RETEST-3: No new strict-grep gate added for the checkout-persistence pattern.** Same as DISC-REWORK-4. Optional structural enforcement at CLOSE.
- **DISC-RETEST-4: Test-infra gap (carried).** `@testing-library/react-native` still not installed. Live-fire simulator + browser smoke is the verification path. Recommend as a follow-up sub-ORCH after CLOSE.

---

## Net change vs initial QA

- **Verdict:** FAIL → PASS.
- **P0:** 0 → 0.
- **P1:** 2 → 0. (Three findings P1-A, P1-B, P1-C all resolved by one coordinated change.)
- **P2:** 2 → 1. (P2-A still deferred; P2-B fixed.)
- **P3:** 1 → 1. (Documented Pressable bubble; acceptable per QA's accept-as-noted.)
- **P4:** 3 → 4. (Added P4-4 praising the rework's pattern consistency.)
- **Constitution #14:** PARTIAL → FULLY MET.

CLOSE may proceed once the operator deploy gates complete and the three live-fire smokes pass. Code is ready.
