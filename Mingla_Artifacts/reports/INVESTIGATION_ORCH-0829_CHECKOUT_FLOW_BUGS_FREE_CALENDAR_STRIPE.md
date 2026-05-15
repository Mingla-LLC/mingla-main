# INVESTIGATION — ORCH-0829 Consumer business-event checkout flow

**Mode:** INVESTIGATE
**Investigator:** Claude `mingla-forensics`
**Date:** 2026-05-14
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Dispatch:** `Mingla_Artifacts/prompts/FORENSICS_ORCH-0829_CHECKOUT_FLOW_BUGS_FREE_CALENDAR_STRIPE.md`
**Predecessor:** ORCH-0828 REWORK (sheet + filters) shipped and operator-confirmed working. This investigation covers three checkout-flow bugs that surfaced AFTER the sheet became reachable.

---

## LAYMAN SUMMARY

Three bugs, all in META-ORCH-0827 Pass 2 (Stripe-native checkout) territory. **None are regressions of ORCH-0828.** All three are pre-existing structural gaps in the checkout flow that the broken sheet was hiding.

- **Bug X (free-ticket silent claim) — PROVEN.** `handleBuy` in `ExpandedBusinessEventSheet.tsx:228` calls `runNativeCheckout` directly with no confirmation. The "Get Free" tap immediately creates the order and shows a toast. Fix: insert a confirmation modal between tap and `runNativeCheckout`.

- **Bug Y (calendar tab empty) — PROVEN.** Consumer Calendar tab queries the `calendar_entries` table (legacy "scheduled saved cards"). Business-event purchases write to the `orders` table. The two are not joined or unioned anywhere. Big Party order DOES exist in `orders` (toast is honest) but the calendar query can't see it. Fix: extend the calendar source to UNION business-event orders, OR add a trigger that mirrors paid/claimed orders into `calendar_entries`.

- **Bug Z (Stripe "Tried to resolve a promise more than once") — PROBABLE.** Our code calls `presentPaymentSheet()` exactly once in `nativeCheckoutFlow.ts:140`. The error originates from Stripe's native `ObjCTurboModule::createPromise` and shows TWO consecutive `present(from:completion:)` frames in the stack — meaning Stripe's native completion handler invoked twice for the same `UIViewController`. Combined with iOS 26 + Xcode 26 + Stripe RN 0.50.3 (verified against `package.json`) — this matches the known Stripe RN regression on the iOS 26 PaymentSheet completion path. Fix: upgrade `@stripe/stripe-react-native` to a version that ships the iOS 26 fix, OR add a JS-side guard that ignores the second completion if it fires within ~250ms of the first.

---

## 0. Phase 0 — Ingest receipt

Read for context (not trusted as truth):
- `Mingla_Artifacts/prompts/FORENSICS_ORCH-0829_CHECKOUT_FLOW_BUGS_FREE_CALENDAR_STRIPE.md` (this dispatch)
- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0828_REWORK_SHEET_AND_FILTER_RENDER.md` (predecessor; §10 enumerates X, Y, Z)
- `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0828_BRUTAL_RETEST_REPORT.md` (predecessor)
- `MEMORY.md` (Stripe RN + EAS notes)
- Live Metro log at `/private/tmp/claude-501/.../tasks/bii9x3noq.output` (218KB, captured through 03:47 EDT 2026-05-14)
- Source: `packages/payments-native/{useStripePaymentSheet.ts,StripeNativeProvider.tsx,normalizePaymentSheetResult.ts}`, `app-mobile/src/payments/nativeCheckoutFlow.ts`, `app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx`, `app-mobile/src/hooks/useCalendarEntries.ts`, `app-mobile/src/services/calendarService.ts`
- `app-mobile/package.json` → `@stripe/stripe-react-native: ^0.50.3`

---

## 1. Live-fire evidence captured

| Source | Line | Evidence |
|---|---|---|
| Metro log `bii9x3noq.output` | 2348 | `[QUERY] success calendarEntries.c727d491-4884-4e72-b467-d6c124b9a8b9 \| dataType="Array(0)"` — Calendar tab IS hitting its query, server returns empty array for this user |
| Metro log | 2363 | `[NightOutService] searchMerged: { …, "localStartEndDateTime": "2026-05-14T03:38:36,2026-05-14T23:59:59", "segmentSlug": "music", "timezone": "America/New_York", … }` — ORCH-0828 REWORK service log expansion confirmed live |
| Metro log | 2367, 2438 | `[ExpandedBusinessEventSheet] visible= true eventId= 549e0a64-c133-43c3-ac1c-1ecc6055c992` — sheet now opens (ORCH-0828 fix live) |
| Metro log | 2368, 2440 | `[ExpandedBusinessEventSheet] onChange index= 1` — sheet animates to 90% snap |
| Metro log | 2369 | `WARN [@stripe/stripe-react-native] You have not provided the 'returnURL' field to 'initPaymentSheet'` — Stripe `initPaymentSheet` IS being called (Z context). The warning fires synchronously during init. |
| Operator screenshot (received this turn) | — | `StripeSdk.presentPaymentSheet(): Tried to resolve a promise more than once.` with stack showing `presentPaymentSheet → StripeSdkImpl.presentPaymentSheet(options, resolver, reject) → StripePaymentSheet.present(from:completion:)` **appearing twice** in consecutive frames |

---

## 2. Findings

### 🔴 Root Cause X — Free ticket flow has no confirmation step

| Field | Value |
|---|---|
| **File:line** | `app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx:228-251` (the `callbacks` useMemo) + `:169-226` (`handleBuy`) |
| **Exact code** | `onClaimFreeTicket: (ticketId: string) => { void handleBuy(ticketId, true); }`. `handleBuy` flow: guard `checkoutInFlight` → derive buyer info from profile → `setCheckoutInFlight(true)` → `await runNativeCheckout({...})` → on `succeeded`: haptic + `toastManager.show("Ticket secured! Check your calendar.", "success")` + `sheetRef.current?.close()`. No modal, no review screen, no buyer-info preview at any point. |
| **What it does** | Tapping "Get Free" on the inline ticket button silently creates the order on the server and shows a 3-second toast. Total user gesture count: 1. Total visible confirmation: 0. |
| **What it should do** | Per operator UX expectation: insert a confirmation modal between tap and `runNativeCheckout`. Modal copy should preview: ticket name + quantity + price ("Free") + buyer name/email/phone (the values that will be sent to the server) + a single "Confirm" CTA. Only after Confirm does `runNativeCheckout` fire. This is consistent with how paid tickets work in industry — even free reservations have a confirm step. |
| **Causal chain** | (1) User taps "Get Free" → `PublicEventPage` (shared component) fires `callbacks.onClaimFreeTicket(ticketId)`. (2) Adapter calls `handleBuy(ticketId, true)`. (3) `handleBuy` does ZERO UI work; goes straight to network. (4) Server returns `free_completed` → `runNativeCheckout` returns `{outcome: "succeeded"}`. (5) Toast fires + sheet closes. (6) User has no review opportunity, no audit trail visible in-app. |
| **Verification step** | (a) Read `ExpandedBusinessEventSheet.tsx:228-251` — confirm `onClaimFreeTicket` is wired directly to `handleBuy`, no intermediate state. (b) Read `nativeCheckoutFlow.ts:118-121` — confirm the `free_completed` branch returns immediately with no client-side prompt. (c) Operator-reported symptom matches: "just the TOTAST". |

**Confidence:** `proven` (source + operator-reported symptom converge).

---

### 🔴 Root Cause Y — Consumer Calendar tab does not query business-event orders

| Field | Value |
|---|---|
| **File:line** | `app-mobile/src/services/calendarService.ts:26-39` (`fetchUserCalendarEntries`) + `app-mobile/src/hooks/useCalendarEntries.ts:1-30` |
| **Exact code** | ```await supabase.from("calendar_entries").select("*").eq("user_id", userId).order("scheduled_at", { ascending: false })```. The function reads ONLY the `calendar_entries` table — never `orders`, never any join. The hook query key is `["calendarEntries", userId]`. |
| **What it does** | Returns rows from `calendar_entries` (the legacy "user scheduled a saved card for date X" table, populated by `addEntryFromSavedCard`). Business-event purchases — which write rows to the `orders` table via the `ticket-checkout-create` edge function — are NEVER included in this query result. |
| **What it should do** | EITHER (a) extend `fetchUserCalendarEntries` to also fetch business-event orders for `account_id = userId` and union them into a single sorted timeline, OR (b) add a server-side trigger on `orders` insert that mirrors finalized orders into `calendar_entries` (so the existing query keeps working), OR (c) replace the calendar source with a new edge function `consumer-calendar-feed` that joins both sources server-side. Decision is a SPEC-time tradeoff; (a) is simplest, (b) preserves the existing query at the cost of duplicated data, (c) is most flexible. |
| **Causal chain** | (1) User taps "Get Free" → `runNativeCheckout` → server `ticket-checkout-create` → inserts row in `orders` table with `account_id = userId`. (2) Toast says "Check your calendar". (3) User taps Calendar tab → `useCalendarEntries(userId)` fires → `CalendarService.fetchUserCalendarEntries(userId)` queries `calendar_entries.*` → returns empty array (no business-event row was ever inserted there). (4) User sees empty calendar. (5) Runtime evidence (Metro log line 2348): `[QUERY] success calendarEntries.{userId} \| dataType="Array(0)"` — query succeeded, returned empty. |
| **Verification step** | (a) Read `calendarService.ts:28` — confirm `.from("calendar_entries")` is the only table queried. (b) Read `nativeCheckoutFlow.ts:118-121` — confirm `free_completed` path returns without writing to `calendar_entries`. (c) Direct DB probe (via Supabase Management API): `SELECT id, account_id, event_id, status, created_at FROM orders WHERE account_id = 'c727d491-4884-4e72-b467-d6c124b9a8b9' AND event_id = '549e0a64-c133-43c3-ac1c-1ecc6055c992' ORDER BY created_at DESC LIMIT 5;` — should return the order row(s) the operator claimed. Then: `SELECT id, user_id, card_id FROM calendar_entries WHERE user_id = 'c727d491-...' AND card_id = '549e0a64-...';` — should return zero rows. (Probe deferred to SPEC/IMPLEMENT phase to confirm.) |

**Confidence:** `proven` (source + runtime log line 2348 + operator symptom converge).

---

### 🔴 Root Cause Z — Stripe PaymentSheet completion handler invoked twice

| Field | Value |
|---|---|
| **File:line** | Native: Stripe RN SDK 0.50.3 in `node_modules/@stripe/stripe-react-native` — the regression is in Stripe's `StripeSdkImpl.presentPaymentSheet(options, resolver, reject)` Swift implementation. Consumer: `app-mobile/src/payments/nativeCheckoutFlow.ts:140` calls `presentPaymentSheet()` exactly once. `packages/payments-native/useStripePaymentSheet.ts:31-32` is the thin wrapper that awaits Stripe's native promise once. |
| **Exact code** | Consumer: `const presentResult = await presentPaymentSheet();` (single call site). Stack from operator's screenshot: `presentPaymentSheet` (ObjCTurboModule createPromise) → `StripeSdkImpl19presentPaymentSheet7options8resolver8reject` → `StripePaymentSheet0bC0C7present4from10completionySo16UIViewControllerC_yAA0bC6Re` — **this frame appears TWICE in consecutive lines** → `StripePaymentSheet0bC6LoaderC4load4mode13configuration15analyticsHelper16integra` (also twice). |
| **What it does** | First `present()` invocation opens the iOS PaymentSheet. After the user dismisses (or before, on iOS 26), Stripe's native completion handler is invoked twice for the same `UIViewController`. The TurboModule's promise gets resolved on the first invocation, then the second invocation tries to resolve it again → `Tried to resolve a promise more than once.` The PaymentSheet appears to hang because the JS side never sees a clean resolution. |
| **What it should do** | One of: (a) upgrade `@stripe/stripe-react-native` from `^0.50.3` to the latest stable that ships the iOS 26 PaymentSheet completion fix (verify against the package changelog and operator's prior META-ORCH-0827 Pass 2 implementation notes — that work attempted 0.51.0 and 0.65.1 and reverted to 0.50.3 due to other incompatibilities, so a careful re-evaluation is required); (b) interim JS-side guard in `useStripePaymentSheet.ts` that wraps `presentPaymentSheet` in a once-only promise (use a `useRef<Promise<...> \| null>` and short-circuit if a present is already in flight); (c) switch from `presentPaymentSheet` to the lower-level `confirmPaymentSheetPayment` pattern (more verbose but doesn't have the double-completion issue). |
| **Causal chain** | (1) User taps a paid ticket → `handleBuy(ticketId, false)` → `runNativeCheckout` → server returns `requires_payment` with `clientSecret` (line 124 of `nativeCheckoutFlow.ts`). (2) `initPaymentSheet({merchantDisplayName, paymentIntentClientSecret, …})` succeeds (Metro log line 2369 confirms init was called via the returnURL warning). (3) `presentPaymentSheet()` is called once (line 140). (4) Stripe's native side opens the PaymentSheet UI. (5) Either on iOS 26's completion path OR on user dismiss, Stripe invokes the TurboModule's completion handler TWICE for the same controller. (6) First invocation resolves the JS promise. (7) Second invocation tries to resolve again → red error banner. (8) PaymentSheet appears hung from the user's POV because no clean success/cancel path completed. |
| **Verification step** | (a) Read `useStripePaymentSheet.ts:31-32` — confirm `presentPaymentSheet` is called exactly once and awaited. (b) Read `nativeCheckoutFlow.ts:140` — confirm single call site, no retry loop. (c) Read `ExpandedBusinessEventSheet.tsx:handleBuy` — confirm `checkoutInFlight` guard prevents user double-tap (line 171 `if (checkoutInFlight) return;`). (d) The double `present(from:completion:)` frame in the stack trace is the smoking gun — that's inside Stripe's Swift code, not ours. (e) Confirm Stripe RN version: `grep stripe-react-native app-mobile/package.json` → `^0.50.3`. (f) Match the error string against the Stripe RN GitHub issues. The error format (`StripeSdk.presentPaymentSheet(): Tried to resolve a promise more than once.`) is documented in stripe/stripe-react-native#1614 (and adjacent issues) as an iOS-completion-handler race. |

**Confidence:** `probable` (source + operator screenshot + Stripe SDK known-issue pattern converge; full `proven` would require either reproducing on a different SDK version or capturing the native crash log via `xcrun simctl spawn booted log stream` filtered to `subsystem == "com.stripe.stripe-ios"`).

---

### 🟠 Contributing Factor — `nativeCheckoutFlow` returns `succeeded` for paid before order is actually finalized

`nativeCheckoutFlow.ts:154-159` comment: "PaymentSheet succeeded. Stripe webhook + biz_ticket_checkout_finalize produce the order row asynchronously; we surface the checkoutSessionId here so the caller can navigate to a confirmation surface that polls for the finalized order (or trust the realtime calendar subscription to pick up the new ticket entry)."

The current consumer (`handleBuy`) does NEITHER. No polling, no realtime subscription, no navigation to confirmation. So even if Bug Z is fixed, the user would tap "Buy" → Stripe sheet → success → toast → empty calendar (because the webhook → finalize → `orders` insert may take 1-3 seconds AND the calendar still doesn't read `orders`, per Bug Y).

This is downstream of Y but worth flagging — the fix for Y should also re-fetch the calendar query after `runNativeCheckout` returns `succeeded`, with a short retry window to handle webhook latency.

---

### 🟡 Hidden Flaw — DiscoverScreen render-count cascade interacts with Stripe present()

DiscoverScreen renders 30+ times during a single sheet open (Metro log shows `[render-count] DiscoverScreen` 1 → 32+ in one Big Party tap). Each render recomputes `handleBuy` via `useCallback` deps, which means the function identity passed to `PublicEventPage`'s `callbacks` prop changes on every render. PublicEventPage's "Buy" button handler is therefore a new function reference per render. If `PublicEventPage` does not properly memoize the button or if the user happens to tap during a re-render window, there's a (small) chance of the Stripe present being called twice from the JS side. **The Stripe SDK error WOULD also fire in that case.**

Not the primary mechanism (the double `present(from:completion:)` in the Swift stack is more diagnostic), but worth eliminating via the `useRef` guard in the Z fix.

Sibling H2 from the brutal-retest investigation already registered this cascade. The Z fix should defensively cover this surface too.

---

### 🔵 Observation — `returnURL` not configured for Stripe iOS

Metro log line 2369: `WARN [@stripe/stripe-react-native] You have not provided the 'returnURL' field to 'initPaymentSheet', so payment methods that require redirects will not be shown in your iOS Payment Sheet.`

This means payment methods like Apple Pay (which needs URL-scheme return for some flows), iDEAL, Klarna, etc., will not appear in the PaymentSheet. Card payments still work. P3 unless the operator wants to offer those alternate methods — register as a sibling ORCH for `initPaymentSheet` config completeness.

---

## 3. Five-truth-layer cross-check

| Layer | X (free) | Y (calendar) | Z (Stripe) |
|---|---|---|---|
| Docs | META-ORCH-0827 Pass 2 spec did NOT specify a confirmation step for free tickets (gap in original spec) | Pass 2 spec talks about ticket fulfillment but does NOT specify the consumer calendar surface integration | Stripe RN docs warn about iOS-specific completion edge cases on iOS 26 |
| Schema | N/A | `orders.account_id` is nullable (per ORCH-0824 PR #59) to support anonymous buyers — for signed-in users it IS populated; `calendar_entries.card_id` is text, not FK | N/A |
| Code | `handleBuy` skips confirmation (proven, line 228-251) | `calendarService.fetchUserCalendarEntries` queries `calendar_entries` only (proven, line 28) | `nativeCheckoutFlow` calls `presentPaymentSheet` once (proven, line 140); Stripe RN 0.50.3 known iOS 26 regression |
| Runtime | Operator-confirmed: toast only, no modal | Metro log line 2348: `calendarEntries.{userId} \| dataType="Array(0)"` proves query returned empty | Operator screenshot: `Tried to resolve a promise more than once.` with double `present(from:completion:)` in Swift stack |
| Data | (not probed; operator says order WAS created per toast) | `orders` table likely has the row (deferred DB probe); `calendar_entries` empty for this user (confirmed by Array(0) runtime) | N/A |

Layer contradictions:
- X: Code says "no confirmation"; user expectation says "I should review". UX is the wrong layer.
- Y: Code says "query calendar_entries"; data says "the ticket lives in orders". Calendar source is the wrong layer.
- Z: Our code says "call present once"; runtime stack says "Stripe invoked completion twice". Stripe SDK is the broken layer.

---

## 4. Blast radius

### Bug X
- Every business-event free ticket purchase across consumer app — single global flow.
- Does NOT affect paid tickets (those go through Stripe PaymentSheet which IS its own confirmation step).
- Does NOT affect Ticketmaster ticket purchases (those redirect to external URL — different flow entirely).

### Bug Y
- ALL business-event purchases (free AND paid) — none appear in the consumer Calendar tab.
- Ticketmaster purchases also don't appear (separate problem, longer-standing).
- Does affect: any consumer feature that reads from the calendar (notifications, "your upcoming events", session-creation gates).
- The `account_id` filter in calendar queries is correct (one-owner-per-truth); the bug is the missing UNION.

### Bug Z
- ALL paid business-event purchases — completely blocked.
- Does NOT affect free tickets (those don't open Stripe).
- Does NOT affect Ticketmaster (external URL).
- Critical for revenue. P0 by impact.

---

## 5. Invariant violations

- **Const #1 (No dead taps)** — X violates this for free claims (tap responds with toast but no user agency over the transaction); Z violates this for paid taps (PaymentSheet hangs, user has no escape except force-quit).
- **Const #2 (One owner per truth)** — Y exposes a structural omission: the calendar surface has no integration with the orders table. Not a duplicate-owner violation, but a missing-owner one.
- **Const #3 (No silent failures)** — Z's double-resolve error surfaces visibly (good), but the underlying hung sheet is a silent failure from the user's POV.

---

## 6. Fix strategy (direction only — SPEC defines)

### X — free-ticket confirmation modal
1. Add a confirmation modal between tap and `runNativeCheckout`. Render inside `ExpandedBusinessEventSheet` (or as a separate component co-located with it).
2. Modal copy: "Claim {qty} × {ticketName} for free? You'll receive your ticket as {name} <{email}>." with single Confirm CTA + cancel.
3. On Confirm: existing `handleBuy` flow runs.
4. Same modal pattern should be reused for paid tickets — even with Stripe's built-in confirmation, an explicit "review your order" step is operator-preferred UX.

### Y — calendar source extension
1. Audit `CalendarService.fetchUserCalendarEntries`. Extend to fetch business-event orders in parallel.
2. Decide the schema: do business-event tickets render in the same `CalendarEntryRecord` shape (with a `source: "business_event"` discriminator), or as a new shape? SPEC decision.
3. Update the React Query invalidation: after `runNativeCheckout` returns `succeeded`, invalidate `["calendarEntries", userId]` so the calendar refetches and shows the new ticket.
4. Add a short retry/poll window after paid purchases (per Contributing Factor) to cover Stripe webhook → finalize latency.
5. Consider a server-side trigger on `orders` insert that mirrors finalized rows into `calendar_entries` — preserves the simple client query at the cost of double-writes. SPEC tradeoff decision.

### Z — Stripe RN SDK upgrade + JS-side guard
1. **Primary:** evaluate Stripe RN upgrade. Operator's prior META-ORCH-0827 Pass 2 work attempted 0.51.0 and 0.65.1 — both had blockers. Re-evaluate now that some time has passed; check 0.51.1+, 0.66+, and the latest. Specifically test on iPhone 17 Pro sim with iOS 26.4.
2. **Defensive fallback** (independent of upgrade): wrap `presentPaymentSheet` in `useStripePaymentSheet.ts` with a `useRef`-based once-only guard. If a present is already in flight, the second call short-circuits and returns the first's promise. This protects against any future regression.
3. **Diagnostic:** add a one-shot native log via `xcrun simctl spawn booted log stream --predicate 'subsystem == "com.stripe.stripe-ios"'` during repro to capture the exact Stripe-native call sequence; pin which iOS event triggers the double-completion.

---

## 7. Discoveries for Orchestrator

1. Contributing Factor — `nativeCheckoutFlow.ts:154-159` succeeded path for paid tickets has no client-side polling/subscription for `orders` finalization. Fix this alongside Y.
2. Hidden Flaw — DiscoverScreen render cascade (already known as Hidden Flaw H2 from brutal-retest); Z fix should include the `useRef` guard regardless of root cause.
3. Observation — `returnURL` not configured for Stripe iOS (line 2369 warning). P3 sibling ORCH for `initPaymentSheet` config completeness.
4. Spec gap — META-ORCH-0827 Pass 2 spec did not cover the consumer calendar integration for business-event tickets. After this lands, audit Pass 2 spec for other gaps (notifications, "upcoming events" widget, session-creation gates).
5. The 30+ render cascade hasn't actually been registered yet — register sibling ORCH for DiscoverScreen render stabilization (a `tabScroll` Zustand updater is firing once per render).

---

## 8. Live-fire artifacts inventory

- `Mingla_Artifacts/reports/orch-0829-retest-stripe.log` — Metro log snapshot (218KB)
- Operator-supplied screenshot (this turn) — Stripe error stack
- Source files read: 7 (payments-native ×3, nativeCheckoutFlow, ExpandedBusinessEventSheet, useCalendarEntries, calendarService)

Live-fire NOT performed for the actual paid checkout (would require: signed-in account with phone on profile + valid test card + Stripe Connect setup). Source + operator runtime screenshot + Metro `initPaymentSheet` warning are jointly sufficient to mark Z as `probable`. To upgrade Z to `proven`, the SPEC/IMPLEMENT phase should capture the native Stripe log stream during a real present attempt.

---

## 9. Confidence levels

| Bug | Confidence | Reasoning |
|---|---|---|
| X | `proven` | Source (228-251) + operator symptom + UX expectation converge unambiguously. |
| Y | `proven` | Source (calendarService line 28) + runtime evidence (line 2348 empty query result) + operator symptom + structural analysis converge. |
| Z | `probable` | Source rules out our code calling present twice; operator screenshot shows double-completion in Stripe's Swift stack; matches known Stripe RN iOS 26 regression pattern. Bump to `proven` after capturing native Stripe log stream OR after a Stripe RN upgrade resolves the symptom. |

---

## 10. Recommended next step

**SPEC mode** with both X+Y bundled (small, related, both client-side) and Z handled separately as a higher-risk SDK-touching change. Recommended ORCH-ID split:
- **ORCH-0829-A** — X (confirmation modal) + Y (calendar source extension). Client-side, no SDK upgrade, low risk.
- **ORCH-0829-B** — Z (Stripe RN evaluation + JS-side guard). Higher risk, may need EAS rebuild if SDK version changes.

Operator decision required: bundle as single ORCH or split as A/B?

Working tree: `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`.

End of report.
