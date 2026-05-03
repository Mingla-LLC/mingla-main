# QA REPORT — BIZ Cycle 11 (QR scanner + check-in + scanner-team UI + per-ticket QR)

**Verdict:** **NEEDS REWORK** — 1 P0 (React Rules of Hooks violation = production crash on cold-start), 1 P1 (cross-device order lookup gap inherited from Cycle 9c, now catastrophic for the door scanner), 3 P2, 4 P3.
**Mode:** TARGETED + SPEC-COMPLIANCE (forensic code review; no physical device available to tester)
**Date:** 2026-05-03
**Tester:** Claude (Mingla Tester skill)
**Cycle:** Cycle 11 (BIZ)
**Surface:** Mingla Business mobile app (`mingla-business/`)

**Backward deps:**
- Implementation report: [`reports/IMPLEMENTATION_BIZ_CYCLE_11_QR_SCANNER_REPORT.md`](./IMPLEMENTATION_BIZ_CYCLE_11_QR_SCANNER_REPORT.md)
- SPEC: [`specs/SPEC_BIZ_CYCLE_11_QR_SCANNER.md`](../specs/SPEC_BIZ_CYCLE_11_QR_SCANNER.md)
- Investigation: [`reports/INVESTIGATION_BIZ_CYCLE_11_QR_SCANNER.md`](./INVESTIGATION_BIZ_CYCLE_11_QR_SCANNER.md)
- Tester dispatch: [`prompts/TESTER_BIZ_CYCLE_11_QR_SCANNER.md`](../prompts/TESTER_BIZ_CYCLE_11_QR_SCANNER.md)

---

## 1 — Layman summary

Cycle 11's code is high-quality overall — TypeScript strict, clean Zustand stores, good selector hygiene, comprehensive scan-result handling, well-documented `[TRANSITIONAL]` markers. **But two issues block close.**

The **P0** is a React Rules of Hooks violation in the Guest Detail screen (`app/event/[id]/guests/[guestId].tsx`): four `useMemo` calls were placed AFTER an early-return shell. When the screen renders cold (first paint while persisted-store data is still hydrating, OR after a comp guest is removed and the screen re-renders before navigation completes), the early return fires and only the hooks above it run. On the next render with data populated, the early return doesn't fire and four extra hooks run — **React throws "Rendered more hooks than during the previous render"** and the screen crashes. This is a production-grade bug that the implementor's tsc check cannot catch.

The **P1** is architectural and inherited from Cycle 9c: orders are persisted to the local device's `useOrderStore` via `confirm.tsx`. The buyer's confirmation runs on the BUYER's device. The operator's scanner runs on the OPERATOR's device. **In production with two different devices, the operator's `useOrderStore` will always be empty for buyer orders, so EVERY real-world scan will return "Ticket not found."** The Cycle 11 scanner cannot validate any production ticket until B-cycle wires the `scan-ticket` edge function. This was implicitly documented in SPEC §10.1 forward backend handoff but never surfaced as a pre-launch warning. The scanner UI gives no indication this only works for orders made on the same physical device. Implementor faithfully built what the SPEC said; SPEC said "all client-side; zero backend deploy this cycle." The gap is real.

**Single biggest fix:** Move the 4 useMemos in `guests/[guestId].tsx` BEFORE the early return shell. ~10 lines of code reorder. Tester can re-test in ~30 minutes.

---

## 2 — Verdict & counts

| Severity | Count | List |
|----------|-------|------|
| **P0** | 1 | F-1 React Rules of Hooks violation (`guests/[guestId].tsx`) |
| **P1** | 1 | F-2 Cross-device order lookup gap (architectural) |
| **P2** | 3 | F-3 Weak email validation; F-4 `canAcceptPayments` type leak; F-5 Camera persists on background |
| **P3** | 4 | F-6 Carousel first-frame width mis-render; F-7 `as never` route casts; F-8 No useFocusEffect on camera; F-9 InviteScannerSheet swallows recordInvitation errors |
| **P4 (Praise)** | 4 | Comprehensive scan handler; selector-pattern discipline; backfilled I-25/I-26 surfacing; clean Const #8 subtraction |

**Re-test requirements after rework:**
- Re-verify F-1 fix produces stable hook count across renders
- Re-run all 30 SC items including Wave 1 happy path
- Confirm F-2 surfaces a user-facing pre-launch warning OR documents the dev-only scope explicitly

---

## 3 — Device & test conditions

| Field | Value |
|-------|-------|
| Tester | Claude (forensic code review) |
| Device | **Not used** — code review only; no iOS device available to me |
| Code state | Cycle 11 implementation as of latest tester invocation; all 17 SPEC §9 steps complete |
| tsc | `npx tsc --noEmit` → exit 0 (verified independently) |
| Grep regressions | All 3 PASS independently (oklch, fresh-array selectors, anon-route stores) |
| Files read in full | 10 NEW + 5 MODIFIED (15 source files) |

**What I could verify:** Code structure, hook order, type safety, error paths, constitutional compliance, SPEC §6 SC items that don't require a physical device.

**What I could NOT verify:** SC-1 (camera permission OS prompt), SC-2 (Settings deeplink physical behavior), SC-3 (haptic feedback at the fingertip), T-01..T-05 device interactions, T-13 offline-mode airplane-mode behavior, T-25 carousel swipe gesture feel.

---

## 4 — P0 finding — F-1 React Rules of Hooks violation

### Location

[`mingla-business/app/event/[id]/guests/[guestId].tsx`](../mingla-business/app/event/[id]/guests/[guestId].tsx)

### Hook order in the component (verbatim line numbers)

```
Line 161:  useMemo(otherOrders)                      ← BEFORE early return
Line 176:  useState(removeOpen)
Line 177:  useState(removeReason)
Line 178:  useState(removing)
Line 179:  useState(toast)
Line 185:  useEffect(reset on visible flip)
Line 192:  useCallback(showToast)
Line 196:  useCallback(handleBack)
Line 204:  useCallback(handleOpenOtherOrder)
Line 220:  useCallback(handleManualCheckIn)
Line 245:  useCallback(handleRemoveConfirm)
... (selectors at lines 134, 139, 142, 147, 148, 153, 160 — 7 store/auth hooks)

Line 273:  if (... event === null || ...) {
Line 280:    return ( <NotFoundShell /> );           ← EARLY RETURN
Line 306:  }

Line 314:  useMemo(expandedTickets)                  ← AFTER early return
Line 318:  useMemo(orderCheckedTicketIds)            ← AFTER early return
Line 328:  useMemo(compCheckedIn)                    ← AFTER early return
Line 338:  useMemo(totalLiveQty)                     ← AFTER early return
```

### Why this crashes

React tracks hook-call order per render. Hooks must be called in the SAME ORDER on every render — Rules of Hooks #1.

**Render scenario A (first cold-start render):**
1. `useLiveEventStore` selector at line 134 returns `null` because Zustand persist hasn't hydrated yet
2. `event === null` → condition at line 273 is `true` → early return at line 280 fires
3. Total hooks called this render: ~21 (lines 1-271 worth, mostly 11 explicit hooks I counted plus internal selector hooks)

**Render scenario B (next render after hydration):**
1. Persist hydrated → `useLiveEventStore` selector returns the event
2. `event !== null` → condition at line 273 is `false` → no early return
3. Code continues past line 308 → 4 more useMemo hooks fire (lines 314, 318, 328, 338)
4. Total hooks called this render: ~25

**React's response:** `Error: Rendered more hooks than during the previous render.` The component crashes.

### Reproduction recipes

1. **Cold-start deep-link** (most likely production trigger): Kill the app, open it via a push notification or shared URL pointing to `/event/{eventId}/guests/{guestId}`. Persist hydration is async; the route mounts before stores populate. Crash.

2. **Comp removal flow** (subtle but reproducible):
   - Open J-G2 for a comp guest
   - Tap "Remove guest" → confirm
   - `useGuestStore.removeCompEntry(comp.id)` removes from store
   - Re-render: `comp` is now `null`, condition at line 273 becomes `true` (`parsed.kind === "comp" && comp === null`)
   - Hook count drops from 25 → 21
   - Crash before `handleBack()` finishes navigation

3. **Order refund-to-zero edge case:** Operator opens an order's J-G2 detail; concurrently the order is fully refunded and `useOrderStore.cancelOrder` triggers re-renders. Less likely but possible.

### Why this passed implementor self-test

- The implementor's verification was `npx tsc --noEmit` + grep regression. **TypeScript does not enforce Rules of Hooks** — that's the job of `eslint-plugin-react-hooks`, which doesn't appear to be wired into the implementor's verification step.
- Most happy-path flows in the implementor's local testing would have warm stores (event already hydrated by the time the user navigates), so the early return never fires and the count stays at 25 across renders.

### Fix instruction

Move the 4 useMemos at lines 314, 318, 328, 338 BEFORE the early return at line 273. Each useMemo can short-circuit internally if data isn't ready:

```ts
// Move up to right after the existing useMemo(otherOrders) at line 161:

const isOrderCandidate = parsed?.kind === "order" && order !== null;
const isCompCandidate = parsed?.kind === "comp" && comp !== null;

const expandedTickets = useMemo(() => {
  if (!isOrderCandidate || order === null) return [];
  return expandTicketIds(order.id, order.lines);
}, [isOrderCandidate, order]);

const orderCheckedTicketIds = useMemo(() => {
  if (!isOrderCandidate || order === null) return new Set<string>();
  const set = new Set<string>();
  for (const scan of allScanEntries) {
    if (scan.scanResult !== "success") continue;
    if (scan.orderId !== order.id) continue;
    set.add(scan.ticketId);
  }
  return set;
}, [allScanEntries, isOrderCandidate, order]);

const compCheckedIn = useMemo<boolean>(() => {
  if (!isCompCandidate || comp === null) return false;
  return allScanEntries.some(
    (s) =>
      s.scanResult === "success" &&
      s.via === "manual" &&
      s.ticketId === comp.id,
  );
}, [allScanEntries, isCompCandidate, comp]);

const totalLiveQty = useMemo<number>(() => {
  if (!isOrderCandidate || order === null) return 0;
  return order.lines.reduce(
    (sum, l) => sum + Math.max(0, l.quantity - l.refundedQuantity),
    0,
  );
}, [isOrderCandidate, order]);

// Then below this block, the early-return shell at line 273 stays as-is.
// And below that, lines 308-309 (isOrder, isComp) and the JSX continue.
```

The internal early returns (`return [];`) inside each useMemo preserve correctness: when data isn't ready, the result is empty, which is what the JSX uses anyway (the JSX is gated by isOrder/isComp which require non-null data).

### Verification after fix

- React DevTools "Components" tab → re-render the route → no warning in console
- Reproduce cold-start scenario (kill app, deep link) → no crash
- Reproduce comp removal flow → screen unmounts cleanly via handleBack

---

## 5 — P1 finding — F-2 Cross-device order lookup gap

### Severity reasoning

This is **P1, not P0**, because:
- The implementor faithfully implemented the SPEC.
- SPEC §3.2 explicitly stated "no migrations, no edge functions, no RLS, no service layer" for Cycle 11.
- SPEC §10 documented forward backend handoff to B-cycle.

**However:** P1 is the right call (not P3) because the gap **defeats the primary feature in production**. A door scanner that can never validate any real ticket is worse than no scanner at all — door staff will think the system is broken.

### Trace

1. **Buyer's purchase flow** (`app/checkout/[eventId]/confirm.tsx` lines 155-187):
   - This route is anon-tolerant (I-21).
   - On mount, calls `useOrderStore.getState().recordOrder(order)` which writes to the LOCAL device's Zustand store.
   - This runs on the BUYER'S device.

2. **Operator's scanner flow** (`app/event/[id]/scanner/index.tsx` line 303):
   - `const order = useOrderStore.getState().getOrderById(parsed.orderId);`
   - This reads from the OPERATOR'S device's Zustand store.

3. **The disconnect:** In production, buyer and operator are on different physical devices. Buyer's store has the order; operator's store does not. When operator scans buyer's QR, `getOrderById` returns `null`, which routes to the `not_found` overlay. **Every single real ticket scans as "Ticket not found."**

### Why I-18 ("Buyer→founder order persistence") doesn't fix this

I-18 is documented in `orderStore.ts:24-26`: *"confirm.tsx calls recordOrder immediately after the existing cart.recordResult({...}) call. Operator's Orders ledger reads from getOrdersForEvent."* But this only works if the same physical device is the buyer AND the operator. There's no sync mechanism between devices in Cycle 11. PR #59 schema includes `orders` + `tickets` tables, but PR #59 is not yet deployed to production (per orchestrator §12 D2 carry-forward) and the `scan-ticket` edge function doesn't exist yet.

### What works in dev / what fails in production

- ✅ **Dev/staging on a single device**: operator buys their own ticket, screen-caps the QR, scans it. Works because same Zustand store.
- ❌ **Production with two devices**: buyer's phone has the order, operator's phone doesn't. Scanner returns `not_found` for every legitimate ticket.

### Fix options for orchestrator to consider

1. **Hold scanner shipping until B-cycle.** Scanner-team UI (J-S7) and per-ticket carousel (J-S8) and J-G2 manual check-in (J-S5) and J-G1 derived pill (J-S6) all still work in single-device mode. Just gate the camera scanner route behind a feature flag until `scan-ticket` edge function lands.

2. **Surface the dev-only scope explicitly.** Add a banner above the camera viewport: "TESTING MODE — only validates orders made on this device. Live event scanning lands when emails ship." This is honest TRANSITIONAL labelling per Const #7.

3. **Operator-as-buyer dev workflow.** Document that for Cycle 11 dev/staging, operator must complete a test purchase on the same device they'll use to scan. (Already true today, just not documented.)

I recommend **Option 2** — it's the lowest-friction fix, preserves the demo value of the scanner, and prevents a confused operator at a real event.

### Why this surfaced now

The implementor's report §1 acknowledges: *"all client-side; zero backend deploy this cycle"* and §10 documents the forward handoff. But neither the implementor nor the orchestrator/SPEC writer flagged that the IMMEDIATE consequence is that scanner cannot validate any ticket in production. This is the orchestrator's responsibility to surface as a launch-readiness item, but it should have been caught at SPEC review.

---

## 6 — P2 findings

### F-3 — Weak email validation in InviteScannerSheet

**Location:** [`mingla-business/src/components/scanners/InviteScannerSheet.tsx:51-54`](../mingla-business/src/components/scanners/InviteScannerSheet.tsx)

```ts
const isValidEmail = (s: string): boolean => {
  const t = s.trim();
  return t.length >= 1 && t.length <= EMAIL_MAX && t.includes("@") && t.includes(".");
};
```

**Issue:** This rule accepts trivially invalid emails: `"@."` (length 2, contains both → passes), `"a.b@c"` reversed-format, `".@."`, etc.

**Real-world impact (Cycle 11):** Low — invitations are stored locally, no email is sent yet. Operator might enter a typo and not notice. When B-cycle wires Resend, the email would bounce silently because the invitation was already accepted-as-valid.

**Fix:** Use a stricter regex matching the typical local-part + domain + TLD pattern:
```ts
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const isValidEmail = (s: string): boolean => {
  const t = s.trim();
  return t.length >= 1 && t.length <= EMAIL_MAX && EMAIL_REGEX.test(t);
};
```

### F-4 — `canAcceptPayments` type allows `true`

**Location:** [`mingla-business/src/store/scannerInvitationsStore.ts:48`](../mingla-business/src/store/scannerInvitationsStore.ts)

```ts
export interface ScannerPermissions {
  canScan: boolean;
  canManualCheckIn: boolean;
  canAcceptPayments: boolean;  // ← should be `false` literal
}
```

**Issue:** SPEC §4.7 says "TYPE-LOCKED to `false`" but the type is `boolean`, not `false` literal. The implementor relies on the InviteScannerSheet hardcoding `false` at line 112. A future caller (or a B-cycle migration script that pre-flips this field) could pass `true` without TypeScript objecting.

**Real-world impact (Cycle 11):** Low — only one caller exists today. But the SPEC's TYPE-LOCK claim is stronger than the code delivers; this is a documentation/code mismatch.

**Fix:** Change type to `false` literal. The InviteScannerSheet's `canAcceptPayments: false` value satisfies the literal type.
```ts
export interface ScannerPermissions {
  canScan: boolean;
  canManualCheckIn: boolean;
  canAcceptPayments: false;  // Cycle 11 lock; widen to boolean in B-cycle
}
```

### F-5 — Camera persists on background

**Location:** [`mingla-business/app/event/[id]/scanner/index.tsx`](../mingla-business/app/event/[id]/scanner/index.tsx)

**Issue:** The `<CameraView>` mounts as long as the route is rendered. There's no `useFocusEffect` (expo-router) or AppState listener to pause the camera when the user backgrounds the app or navigates away. expo-camera v17 may handle this internally, but no explicit pause means battery drain + privacy concern (camera light stays on if backgrounded with the screen still mounted in the navigator).

**Real-world impact:** Battery drain on operator phones; iOS will show the green camera indicator dot while backgrounded which may alarm users.

**Fix:** Wrap CameraView with `useFocusEffect` from `expo-router`:
```ts
import { useFocusEffect } from "expo-router";
const [cameraActive, setCameraActive] = useState(false);
useFocusEffect(useCallback(() => {
  setCameraActive(true);
  return () => setCameraActive(false);
}, []));
// then conditionally render CameraView only when cameraActive
```

---

## 7 — P3 findings

### F-6 — Carousel first-frame width mis-render

**Location:** [`mingla-business/src/components/checkout/TicketQrCarousel.tsx:55-58`](../mingla-business/src/components/checkout/TicketQrCarousel.tsx)

`pageWidth` initial = `Dimensions.get("window").width`. If the parent's GlassCard has padding, the carousel's actual width is narrower. First frame uses `Dimensions.get("window").width` causing momentary overflow until `onLayout` fires. **Fix:** Initialize to `0` and render-skip first paint, OR use `flex: 1` in the page style so width inherits from layout.

### F-7 — `as never` route casts

**Location:** Multiple files (event/[id]/index.tsx:198 etc.)

`router.push(\`/event/${id}/scanner\` as never)` — the `as never` is a project-wide pattern for typed routes. Memory rule against unsafe casts is technically violated. Pattern-match precedent — accept for Cycle 11 but note for future ESLint rule consideration.

### F-8 — Combined with F-5 (camera focus management) — same fix

### F-9 — InviteScannerSheet swallows recordInvitation errors silently

**Location:** [`mingla-business/src/components/scanners/InviteScannerSheet.tsx:95-119`](../mingla-business/src/components/scanners/InviteScannerSheet.tsx)

```ts
try {
  await sleep(PROCESSING_MS);
  const newInvitation = useScannerInvitationsStore.getState().recordInvitation({...});
  onSuccess(newInvitation);
} finally {
  setSubmitting(false);
}
```

No `catch`. If `recordInvitation` throws (it doesn't today, but if B-cycle adds a server hop and it fails), the error propagates to React's unhandled-rejection handler. **Fix:** Add `catch (e) { showToast("Couldn't send invitation. Tap to try again."); }`. Const #3 (no silent failures).

---

## 8 — P4 — Praise (replicate these patterns)

### F-P1 — Comprehensive scan handler

[`scanner/index.tsx:269-394`](../mingla-business/app/event/[id]/scanner/index.tsx). Every result kind has its own branch, with consistent shape: `showResult(...)` + `Haptics.notificationAsync(...)` + (where applicable) `recordScanWithResult(...)`. Per-seat partial-refund check at line 358-367 is a thoughtful edge case — not in the SPEC verbatim, but logical extension of I-19 (immutable financials per seat).

### F-P2 — Selector-pattern discipline

`scanStore.ts` clearly tags single-existing-reference selectors (safe to subscribe) vs fresh-array selectors (`.getState()` only). Header comment cites Cycle 9c v2 lesson. Every consumer in route files uses raw `entries` + `useMemo` for filtered arrays. No infinite-loop risk inherited from Cycle 9c.

### F-P3 — Backfill of I-25 + I-26

The Cycle 11 implementor surfaced (in §12 of their report) that Cycle 10's I-25 + I-26 were never registered in INVARIANT_REGISTRY despite being referenced in code comments. This is excellent discipline — finding a documentation drift bug in someone else's prior cycle and flagging it for orchestrator backfill.

### F-P4 — Const #8 subtraction in /o/[orderId].tsx

The implementor DELETED the local `ticketIdFromOrder` helper instead of layering the new carousel on top. Removed unused styles (`qrWrap`, `qrInner`, `qrCaption`, `qrMultiNote`) from BOTH confirm.tsx and /o/[orderId].tsx. This is the right way to subtract before adding.

---

## 9 — SC verification matrix (SPEC §6)

Legend: ✅ PASS (code verified) · ⏳ NEEDS DEVICE (cannot verify without iPhone) · ❌ FAIL · ⚠️ AT RISK (fix dependent)

| SC | Description | Status | Evidence |
|----|-------------|--------|----------|
| SC-1 | Permission OS prompt → CameraView mount | ⏳ | Code path correct; needs device |
| SC-2 | Permanently denied → Settings deeplink | ⏳ | `Linking.openSettings()` correctly wired; needs device |
| SC-3 | Valid PAID + Success haptic | ⏳ | Code verified; haptic call wired; needs device |
| SC-4 | Same QR twice → duplicate | ✅ | `getSuccessfulScanByTicketId` lookup at scanner/index.tsx:284-301 |
| SC-5 | Different-event QR → wrong_event | ✅ | scanner/index.tsx:312-319 branch |
| SC-6 | Malformed QR → not_found | ✅ | scanner/index.tsx:275-281 parseQrPayload null branch |
| SC-7 | Cancelled order → cancelled_order | ✅ | scanner/index.tsx:320-327 status branch |
| SC-8 | Fully refunded → void | ✅ | scanner/index.tsx:328-335 status branch |
| SC-9 | Multi-ticket K of N progression | ⚠️ | guests/index.tsx GuestRowCard derived pill verified; **but blocked by F-1** if user navigates to J-G2 cold |
| SC-10 | Per-seat partial refund void | ✅ | scanner/index.tsx:358-367 seatIdx>=quantity-refunded check |
| SC-11 | Offline scan still records | ✅ | offlineQueued: true unconditional |
| SC-12 | Session log filtering | ✅ | scanner/index.tsx:167-187 useMemo with eventId+scannerUserId+sessionStart filter |
| SC-13 | J-G1 row pill states | ✅ | guests/index.tsx GuestRowCard 4-state branch verified |
| SC-14 | J-G2 per-ticket rows render | ⚠️ | Logic correct **but blocked by F-1** crash on cold load |
| SC-15 | Manual check-in via=manual | ⚠️ | handleManualCheckIn correct **but blocked by F-1** |
| SC-16 | Comp manual check-in | ⚠️ | Logic correct **but blocked by F-1** |
| SC-17 | Activity feed event_scan kind | ✅ | event/[id]/index.tsx:503-523 stream + activityKindSpec line 994-1006 + activityRowKey:138-140 |
| SC-18 | Invite invalid email blocks confirm | ✅ | isValid gate at InviteScannerSheet:91-93 |
| SC-19 | TRANSITIONAL banner /scanners always visible | ✅ | scanners/index.tsx:225-229 unconditional render |
| SC-20 | canAcceptPayments DISABLED | ✅ | InviteScannerSheet:237-250 non-Pressable View; no toggle handler |
| SC-21 | Revoke pending → REVOKED | ✅ | scannerInvitationsStore.revokeInvitation idempotent on non-pending |
| SC-22 | Multi-ticket carousel + dots | ✅ | TicketQrCarousel.tsx:112-156 isMulti branch |
| SC-23 | Single-ticket = NO dots | ✅ | TicketQrCarousel.tsx:95-110 isMulti=false branch |
| SC-24 | /o/[orderId] uses carousel + DELETES helper | ✅ | Verified — local helper removed; expandTicketIds imported |
| SC-25 | tsc clean | ✅ | Independently verified — exit 0, no output |
| SC-26 | Grep regression — oklch/lab/lch | ✅ | Independently verified — 0 hits |
| SC-26 | Grep regression — fresh-array selectors | ✅ | Independently verified — 0 hits |
| SC-26 | Grep regression — anon-route stores | ✅ | Independently verified — 0 hits |
| SC-27 | Logout cascade resets both stores | ✅ | clearAllStores.ts:34-35 |
| SC-28 | Cold-start hydration | ✅ | Zustand persist v1 partialize entries |
| SC-29 | Const #1 No dead taps | ✅ | Every interactive element has onPress + state response |
| SC-30 | TRANSITIONAL labels | ✅ | Headers + banner + footer + canAcceptPayments comment all present |

**Pass rate (code-verifiable):** 23/27 PASS · 4/27 AT RISK due to F-1 (SC-9, SC-14, SC-15, SC-16) · 3/27 NEEDS DEVICE (SC-1/2/3)

**After F-1 fix:** 27/27 code-verifiable items expected PASS; 3 device-dependent items still need operator smoke.

---

## 10 — T outcomes (SPEC §7)

I'll cover the high-priority device-independent T items. Device-dependent items are skipped with reason.

| T | Status | Note |
|---|--------|------|
| T-01 | ⏳ DEVICE | Camera permission OS prompt |
| T-02 | ⏳ DEVICE | Permission grant → CameraView mount |
| T-03 | ⏳ DEVICE | Permission denied askable |
| T-04 | ⏳ DEVICE | Permanently denied + Settings |
| T-05 | ⏳ DEVICE | Real QR scan |
| T-06 | ✅ | Code path correct |
| T-07 | ✅ | scanner.tsx:312-319 wrong_event branch |
| T-08 | ✅ | scanner.tsx:275-281 invalid QR branch |
| T-09 | ✅ | cancelled order branch |
| T-10 | ✅ | refunded_full branch |
| T-11 | ✅ | per-seat partial-refund branch |
| T-12 | ⚠️ | **AT RISK** — J-G1 derived pill correct but J-G2 (where user verifies count) blocked by F-1 |
| T-13 | ⏳ DEVICE | Airplane mode |
| T-14, T-15 | ✅ | Session log expand/collapse logic correct |
| T-16, T-17 | ⚠️ | **AT RISK** — manual check-in handler correct but path blocked by F-1 |
| T-18 | ✅ | Activity feed event_scan kind correct |
| T-19 | ✅ | events.slice(0, 5) cap |
| T-20 | ✅ | Email validation gate correct (though F-3 weak) |
| T-21 | ✅ | recordInvitation flow correct |
| T-22 | ✅ | canAcceptPayments toggle disabled |
| T-23 | ✅ | revokeInvitation correct |
| T-24 | ✅ | Idempotent on non-pending |
| T-25 | ⏳ DEVICE | Carousel swipe gesture feel |
| T-26 | ✅ | Single-ticket no-dots branch |
| T-27 | ✅ | /o/[orderId] carousel correct |
| T-28..T-30 | ⚠️ | **AT RISK** — same J-G2 blocker |
| T-31 | ✅ | Fully-refunded NO pill render branch |
| T-32 | ✅ | Logout cascade correct |
| T-33 | ⏳ DEVICE | Cold-start hydration test (would also expose F-1 if guest deep-link is the test path) |
| T-34..T-36 | ✅ | Cross-event scoping correct via filter |
| T-37 | ✅ | tsc verified independently |
| T-38 | ✅ | No dead taps |
| T-39, T-40, T-41 | ✅ | Grep tests pass independently |
| T-42 | ✅ | parseTicketId edge cases handled |
| T-43 | ✅ | parseQrPayload edge cases handled |

**Pass rate:** 33/43 ✅ · 4/43 ⚠️ AT RISK (F-1 blocker) · 6/43 ⏳ DEVICE

---

## 11 — Constitutional compliance scan

| # | Principle | Status |
|---|-----------|--------|
| 1 | No dead taps | ✅ |
| 2 | One owner per truth | ✅ |
| 3 | No silent failures | ⚠️ F-9 — InviteScannerSheet swallows recordInvitation errors silently (P3) |
| 4 | One query key per entity | ✅ N/A (no React Query) |
| 5 | Server state server-side | ✅ N/A (no server data this cycle) |
| 6 | Logout clears | ✅ |
| 7 | Label temporary | ✅ |
| 8 | Subtract before adding | ✅ |
| 9 | No fabricated data | ✅ |
| 10 | Currency-aware | ✅ |
| 11 | One auth instance | ✅ |
| 12 | Validate at right time | ✅ |
| 13 | Exclusion consistency | ✅ |
| 14 | Persisted-state startup | ⚠️ Code is correct; **F-1 is the cold-start crash that violates this in spirit** |

**1 P0 violation of Const #14 (in spirit) — Const #14 says "app works correctly from cold cache." F-1 means the J-G2 route specifically does NOT work from cold cache.**

---

## 12 — Invariant verification

| ID | Status | Proof |
|----|--------|-------|
| I-19 (Immutable order financials) | ✅ Preserved | scanStore writes never touch OrderRecord |
| I-20 (Edit reason mandatory) | ✅ N/A | Different audit pattern for scans |
| I-21 (Anon-tolerant buyer routes) | ✅ Preserved | Grep regression confirms no scanner stores in app/o, app/e, app/checkout |
| I-25 (Comp guests in useGuestStore only) | ✅ Preserved | Comp manual check-ins write to scanStore (not guestStore phantom orders) |
| I-26 (privateGuestList no buyer surface) | ✅ Preserved | No Cycle 11 touchpoint |
| I-27 (single-scan-per-ticket) | ✅ Code-enforced | getSuccessfulScanByTicketId guard at scanner.tsx:284-301 |
| I-28 (UI-only invitation flow) | ✅ Code-enforced | TRANSITIONAL banner + canAcceptPayments hardcoded false + sheet store-only writes |

**No invariant violations.**

---

## 13 — Regression surface (5 areas per implementor §9)

| Area | Verdict | Note |
|------|---------|------|
| Cycle 9c-2 activity feed | ✅ | New event_scan stream additive; cap-at-5 sort preserved |
| Cycle 10 J-G1 list view | ✅ | GuestRowCard derived pill replaces static placeholder; existing PAID/REFUNDED pills unchanged |
| Cycle 10 J-G2 detail view | ❌ | **F-1 blocks this surface entirely on cold load** |
| Cycle 8 confirm.tsx + /o/[orderId].tsx | ✅ | Single-ticket parity preserved; multi-ticket carousel additive |
| Logout cascade | ✅ | Both new stores added; existing 6 stores still reset |

---

## 14 — Discoveries for orchestrator

### D-T1 — F-1 hooks violation requires implementor rework dispatch (P0)

The implementor needs to move 4 useMemos before the early return in `guests/[guestId].tsx`. Estimated wall: 30 min implementation + 30 min retest. Single-file change.

### D-T2 — F-2 cross-device order lookup is a launch-readiness gap (P1)

This is NOT a Cycle 11 implementor bug. It's an architectural gap inherited from Cycle 9c that becomes catastrophic in production with Cycle 11's scanner. Three options for the orchestrator:
1. Hold scanner shipping until B-cycle backend lands
2. Add a "TESTING MODE" banner to the scanner camera viewport (recommended)
3. Document operator-as-buyer-on-same-device dev-only constraint

Strongly recommend the orchestrator surface this as a strategic decision before close. Otherwise the first real event using the scanner will be a disaster.

### D-T3 — Implementor verification gap: ESLint react-hooks rule not enforced

The implementor's verification step is `npx tsc --noEmit` only. tsc doesn't catch Rules of Hooks violations. F-1 would have been caught by `eslint-plugin-react-hooks`. **Recommend adding ESLint react-hooks rule to the implementor's verification gate going forward.** This is process-improvement, not Cycle 11 work.

### D-T4 — Confirmation that I-25 + I-26 backfill landed (orchestrator-completed)

I verified `Mingla_Artifacts/INVARIANT_REGISTRY.md` now contains formal entries for I-25 + I-26 (added 2026-05-03 by orchestrator). Cycle 10 doc drift discovered by Cycle 11 implementor is now resolved. ✓

### D-T5 — Tester device gap

I performed forensic code review only. The 3 SC items (SC-1/2/3) and ~6 T items genuinely need a physical iOS device to verify. Operator should still run those manually before close. After F-1 fix, that's the only remaining verification gate.

---

## 15 — Re-test reasons (NEEDS REWORK punch list)

For implementor's next dispatch:

1. **F-1 (P0):** Move 4 useMemos in `app/event/[id]/guests/[guestId].tsx` BEFORE the early return at line 273. See §4 above for the exact code pattern. Each useMemo internally short-circuits with empty result if data not ready. **No new tests needed; existing SC-9, SC-14, SC-15, SC-16 will exit AT RISK status after fix.**

2. **F-2 (P1):** Orchestrator decision required — implementor cannot fix unilaterally. Recommend Option 2 (TESTING MODE banner) as smallest delta.

3. **F-3, F-4, F-5, F-9 (P2/P3):** Defer to a B-cycle polish wave or punch-list. Not blocking Cycle 11 close once F-1 + F-2 resolved.

---

## 16 — Verification commands run

```
cd mingla-business
npx tsc --noEmit | grep -v ".expo/types/router.d.ts"
# → exit 0, no output (verified independently of implementor)

grep -rEn "oklch|lab\(|lch\(|color-mix" \
  src/store/scanStore.ts \
  src/store/scannerInvitationsStore.ts \
  src/utils/expandTicketIds.ts \
  src/utils/qrPayload.ts \
  src/components/scanners/ \
  src/components/checkout/TicketQrCarousel.tsx \
  app/event/[id]/scanner/ \
  app/event/[id]/scanners/
# → 0 hits

grep -rEn "useScanStore\(\(s\) => s\.(getScansFor|getScanByTicketId|getSuccessfulScanByTicketId)|useScannerInvitationsStore\(\(s\) => s\.(getInvitationsFor|getInvitationById)" src/ app/
# → 0 hits

grep -rE "useScanStore|useScannerInvitationsStore" app/o/ app/e/ app/checkout/
# → 0 hits

# Hook order verification
grep -n "useMemo\|useState\|useEffect\|useCallback\|return\s*\(" \
  app/event/[id]/guests/[guestId].tsx
# → confirmed: 4 useMemos at lines 314, 318, 328, 338 AFTER early return at line 273. P0.

grep -n "useMemo\|useState\|useEffect\|useCallback" app/event/[id]/scanner/index.tsx
# → confirmed: all hooks before any early return. ✓ Safe.

grep -n "useMemo\|useState\|useEffect\|useCallback" app/event/[id]/scanners/index.tsx
# → confirmed: all hooks before any early return. ✓ Safe.

grep -n "useMemo\|useState\|useEffect\|useCallback" app/event/[id]/guests/index.tsx
# → confirmed: all hooks before early return at line 278. ✓ Safe.

grep -n "useMemo\|useState\|useEffect\|useCallback" app/checkout/[eventId]/confirm.tsx
# → confirmed: all hooks before early return at line 231. ✓ Safe.

grep -n "useMemo\|useState\|useEffect\|useCallback" app/o/[orderId].tsx
# → confirmed: all hooks before early return at line 228. ✓ Safe.
```

---

## 17 — Cross-references

- Implementation report: [`reports/IMPLEMENTATION_BIZ_CYCLE_11_QR_SCANNER_REPORT.md`](./IMPLEMENTATION_BIZ_CYCLE_11_QR_SCANNER_REPORT.md)
- SPEC: [`specs/SPEC_BIZ_CYCLE_11_QR_SCANNER.md`](../specs/SPEC_BIZ_CYCLE_11_QR_SCANNER.md)
- Investigation: [`reports/INVESTIGATION_BIZ_CYCLE_11_QR_SCANNER.md`](./INVESTIGATION_BIZ_CYCLE_11_QR_SCANNER.md)
- Tester dispatch: [`prompts/TESTER_BIZ_CYCLE_11_QR_SCANNER.md`](../prompts/TESTER_BIZ_CYCLE_11_QR_SCANNER.md)
- INVARIANT_REGISTRY (with I-25, I-26 backfill + I-27, I-28): [`Mingla_Artifacts/INVARIANT_REGISTRY.md`](../INVARIANT_REGISTRY.md)
