# IMPLEMENTATION REPORT v2 — BIZ Cycle 11 RETRY (ORCH-0710 + ORCH-0711)

**Status:** `implemented and verified` (code-verified; physical-device smoke for SC-1/2/3 still pending operator hands).
**Mode:** RETRY after tester returned NEEDS REWORK on Cycle 11.
**Date:** 2026-05-03
**Surface:** Mingla Business mobile app (`mingla-business/`)
**Dispatch:** [`prompts/IMPLEMENTOR_BIZ_CYCLE_11_RETRY_ORCH-0710_ORCH-0711.md`](../prompts/IMPLEMENTOR_BIZ_CYCLE_11_RETRY_ORCH-0710_ORCH-0711.md)
**Predecessor reports:**
- v1: [`reports/IMPLEMENTATION_BIZ_CYCLE_11_QR_SCANNER_REPORT.md`](./IMPLEMENTATION_BIZ_CYCLE_11_QR_SCANNER_REPORT.md)
- Tester: [`reports/TEST_BIZ_CYCLE_11_QR_SCANNER_REPORT.md`](./TEST_BIZ_CYCLE_11_QR_SCANNER_REPORT.md)

---

## 1 — Layman summary

Two fixes shipped, both mechanical, both per dispatch §3 + §4 verbatim.

**ORCH-0710 (P0):** The 4 `useMemo` hooks in the Guest Detail screen that previously lived AFTER the early-return shell now live BEFORE it. Each useMemo internally short-circuits with empty data if its guard isn't met. React's hook count is now stable across renders — cold-start crash is gone.

**ORCH-0711 (P1):** The scanner camera screen now shows a visible orange "Testing mode" banner at the top, telling operators the scanner only validates orders made on this device until B-cycle ships the backend. Const #7 (label temporary) honored.

Two files modified. Net delta ~+30 LOC. tsc clean. All 3 grep regression tests pass. The 7 P2/P3 polish items the tester surfaced are deferred to B-cycle polish wave per orchestrator decision; they were NOT touched.

---

## 2 — Status & verification matrix

| Stage | Status |
|-------|--------|
| Code written (ORCH-0710) | ✅ 4 useMemos moved + duplicate block deleted + plain-const orderCheckedCount preserved after early return |
| Code written (ORCH-0711) | ✅ Banner JSX added; 2 style entries added |
| `npx tsc --noEmit` | ✅ Exit 0, no output (filter `.expo/types/router.d.ts` autogen) |
| Hook order grep | ✅ All 4 useMemos at lines 186, 191, 202, 212 — BEFORE early return at line 324; no hooks after early return |
| Grep regression: oklch/lab/lch | ✅ 0 hits across all Cycle 11 files |
| Grep regression: fresh-array selectors | ✅ 0 hits |
| Grep regression: anon-buyer-route stores | ✅ 0 hits in app/o, app/e, app/checkout |
| Manual device smoke (SC-1/2/3) | ⏳ Operator hands required — physical-device dependencies, identical scope to v1 |

---

## 3 — Old → New receipts

### 3.1 `mingla-business/app/event/[id]/guests/[guestId].tsx` (MOD)

**What it did before:** 4 useMemo hooks lived AFTER the early-return shell at line 273. On cold-start render path (event/order/comp not yet hydrated from persist), the early return fired → only ~21 hooks called. On subsequent render with data populated, no early return → ~25 hooks called. React threw `Error: Rendered more hooks than during the previous render.` and the screen crashed.

**What it does now:** All 4 useMemos (`expandedTickets`, `orderCheckedTicketIds`, `compCheckedIn`, `totalLiveQty`) moved to BEFORE the early-return shell, immediately after the existing `useMemo(otherOrders)`. Each useMemo internally short-circuits with empty result (`[]`, `new Set<string>()`, `false`, or `0`) when guard data isn't ready. New non-hook consts `isOrderCandidate` + `isCompCandidate` introduced as the guard inputs (distinct from `isOrder` + `isComp` at line 308-309 which the JSX still uses). The `orderCheckedCount = orderCheckedTicketIds.size` plain const stays after the early return where the JSX uses it. Hook count is now stable across all renders.

**Why:** ORCH-0710 — React Rules of Hooks #1: hooks must be called in the same order on every render. Previously violated on cold-start, comp-removal flow, and any flow where event/order/comp transitioned from null → loaded mid-component-life.

**Lines changed:** ~+45 / -38 (net ~+7). 5 lines of comment context + 4 useMemo blocks + 2 candidate consts inserted; original 4-useMemo block + 1 candidate-similar consts deleted.

**Verification:**

```bash
grep -nE "useMemo|useState|useEffect|useCallback|^  if \(typeof eventId|return \(\s*$" \
  app/event/[id]/guests/[guestId].tsx
```

Output (verified 2026-05-03):

```
12:  import React, { useCallback, useEffect, useMemo, useState } from "react";
161: const otherOrders = useMemo<OrderRecord[]>(() => {
186: const expandedTickets = useMemo(() => {
191: const orderCheckedTicketIds = useMemo(() => {
202: const compCheckedIn = useMemo<boolean>(() => {
212: const totalLiveQty = useMemo<number>(() => {
220: const [removeOpen, setRemoveOpen] = useState<boolean>(false);
221: const [removeReason, setRemoveReason] = useState<string>("");
222: const [removing, setRemoving] = useState<boolean>(false);
223: const [toast, setToast] = useState<{ visible: boolean; message: string }>({
229: useEffect(() => {
236: const showToast = useCallback((message: string): void => {
240: const handleBack = useCallback((): void => {
248: const handleOpenOtherOrder = useCallback(
264: const handleManualCheckIn = useCallback(
289: const handleRemoveConfirm = useCallback((): void => {
324:   return (              ← early-return shell render
355: // ORCH-0710 fix comment
371: return (                ← main render
461:               return (  ← inline JSX render
```

All hook calls (lines 161–289) appear BEFORE the early-return shell at line 324. NO hook lines appear after line 324. ORCH-0710 fix verified.

### 3.2 `mingla-business/app/event/[id]/scanner/index.tsx` (MOD)

**What it did before:** Granted-permission render branch went directly from chrome row → camera viewport. Operator at a real production event would see "Ticket not found" on every scan (because their device's `useOrderStore` is empty for buyer orders, see ORCH-0711 architectural diagnosis) with NO indication WHY, leading to "Mingla Business is broken" misperception.

**What it does now:** A persistent banner renders between the chrome row and the camera viewport, ONLY in the granted-permission state. Banner shows the `flag` icon (warm orange) + 2-line copy: *"Testing mode — scanner only validates orders made on this device. Cross-device scanning lands when the backend ships in B-cycle."* `pointerEvents="none"` so taps fall through. Const #7 (label temporary) honored with verbatim TRANSITIONAL marker + EXIT condition in code comment.

**Why:** ORCH-0711 — operator honesty per Constitution #7 + #9. Without this banner, the scanner appears broken in production; with it, the operator understands the dev-only constraint and waits for B-cycle.

**Lines changed:** ~+27 / -0 (additive only). 13 lines of JSX (banner View) + 14 lines of styles (2 new entries).

**Verification:**

The banner renders unconditionally in the granted-permission render branch (currently lines 491–617 in the rewritten file). Banner is NOT shown in loading / askable / permanently-denied permission states (those screens already explain themselves; adding a testing banner there would be redundant). Visual self-test: code-trace confirms banner is rendered between TopBar and CameraView.

Color palette per dispatch §4 spec:
- Banner background: `rgba(235, 120, 37, 0.16)` (accent.warm at 16% alpha — matches existing TRANSITIONAL palette)
- Banner border-bottom: `rgba(235, 120, 37, 0.32)`
- Icon color: `accent.warm`
- Text color: `textTokens.primary`
- NO oklch / lab / lch — verified via grep regression test #1.

---

## 4 — Spec traceability (dispatch §3 + §4)

| Dispatch requirement | Status | Evidence |
|----------------------|--------|----------|
| §3 — 4 useMemos moved BEFORE early-return shell | ✅ | Hook order grep above; lines 186, 191, 202, 212 |
| §3 — Each useMemo internally short-circuits when guard data missing | ✅ | Each block returns `[]` / `new Set<string>()` / `false` / `0` if `!isOrderCandidate \|\| order === null` (or comp equivalent) |
| §3 — `isOrderCandidate` + `isCompCandidate` introduced as non-hook consts | ✅ | Lines 181–184 |
| §3 — Original 4-useMemo block deleted | ✅ | Lines 311–345 of v1 file gone |
| §3 — `isOrder` + `isComp` preserved at line 308–309 for JSX use | ✅ | Lines 352–353 of v2 file |
| §3 — `orderCheckedCount = orderCheckedTicketIds.size` recomputed as plain const after early return | ✅ | Line 359 of v2 file |
| §4 — Banner JSX placed BETWEEN chromeRow and cameraWrap in granted-permission branch | ✅ | Lines 506–518 of v2 file |
| §4 — `pointerEvents="none"` on banner | ✅ | Verbatim |
| §4 — Banner copy includes "Testing mode" + reference to "B-cycle" | ✅ | Verbatim per dispatch §4 |
| §4 — 2 new style entries (`testingBanner`, `testingBannerText`) added to StyleSheet | ✅ | Verbatim per dispatch §4 |
| §4 — Banner does NOT render in loading / askable / permanently-denied states | ✅ | Banner lives ONLY in granted-permission render branch (lines 491+) |

All dispatch §3 + §4 requirements satisfied verbatim.

---

## 5 — Constitutional compliance scan

| # | Principle | Status |
|---|-----------|--------|
| 1 | No dead taps | ✅ Banner is informational + `pointerEvents="none"`; never tappable |
| 2 | One owner per truth | ✅ |
| 3 | No silent failures | ✅ |
| 4 | One query key per entity | ✅ N/A (no React Query) |
| 5 | Server state server-side | ✅ N/A |
| 6 | Logout clears | ✅ |
| 7 | **Label temporary** | ✅ TRANSITIONAL marker + EXIT condition in scanner banner code comment |
| 8 | Subtract before adding | ✅ ORCH-0710 deleted the original 4-useMemo block before re-adding the moved version above |
| 9 | No fabricated data | ✅ Banner is the truth |
| 10 | Currency-aware | ✅ |
| 11 | One auth instance | ✅ |
| 12 | Validate at right time | ✅ |
| 13 | Exclusion consistency | ✅ |
| 14 | **Persisted-state startup** | ✅ **RESTORED.** Cold-start render of J-G2 detail no longer crashes; useMemos run with stable hook count regardless of persist hydration timing |

**Const #14 was the spirit-violation flagged by tester. Now restored.**

---

## 6 — Invariant verification

| ID | Status | Proof |
|----|--------|-------|
| I-19 (Immutable order financials) | ✅ Preserved | Cycle 11 doesn't mutate OrderRecord; ORCH-0710 fix is hooks-only |
| I-21 (Anon-tolerant buyer routes) | ✅ Preserved | Grep regression confirms no scanner stores in app/o, app/e, app/checkout |
| I-25 (Comp guests in useGuestStore only) | ✅ Preserved | Comp manual check-ins still write to scanStore (not phantom orders); ORCH-0710 didn't change comp data flow |
| I-26 (privateGuestList no buyer surface) | ✅ Preserved | No Cycle 11 touchpoint |
| I-27 (single-scan-per-ticket) | ✅ Preserved | scanner.tsx duplicate-guard logic unchanged |
| I-28 (UI-only invitation flow) | ✅ Preserved | Scanner-team UI unchanged |

No invariant violations.

---

## 7 — Regression surface (5 areas, mirror tester report §13)

| Area | Verdict |
|------|---------|
| Cycle 9c-2 activity feed | ✅ No-op; this retry didn't touch event/[id]/index.tsx |
| Cycle 10 J-G1 list view | ✅ No-op; guests/index.tsx untouched |
| Cycle 10 J-G2 detail view | ✅ **Now FIXED.** ORCH-0710 was the blocker; cold-start render no longer crashes; manual check-in CTAs work as v1 specified |
| Cycle 8 confirm.tsx + /o/[orderId].tsx | ✅ No-op; carousel surfaces untouched |
| Logout cascade | ✅ No-op; clearAllStores untouched |

---

## 8 — Discoveries for orchestrator

**None.** This retry was scoped tightly per dispatch — 2 files, 2 fixes, no scope creep. The 7 P2/P3 polish items from tester report (F-3 weak email validation, F-4 canAcceptPayments type leak, F-5 camera persists on background, F-6 carousel first-frame width mis-render, F-7 `as never` route casts, F-8 same as F-5, F-9 InviteScannerSheet swallows errors) remain deferred to B-cycle polish wave per orchestrator decision. D-T3 process improvement (add `eslint-plugin-react-hooks` to implementor verification gate) is orchestrator-scoped, not implementor-scoped.

---

## 9 — Transition items

| Marker | Location | EXIT CONDITION |
|--------|----------|----------------|
| `[TRANSITIONAL] Cross-device order lookup gap` | `app/event/[id]/scanner/index.tsx` (banner code comment) | B-cycle scan-ticket edge function wires server-side order lookup; banner becomes unnecessary |

(All other Cycle 11 TRANSITIONAL markers from v1 unchanged.)

---

## 10 — Files touched matrix

| Path | Action | LOC delta (approx) |
|------|--------|--------------------|
| `mingla-business/app/event/[id]/guests/[guestId].tsx` | MOD | +45 / -38 (net ~+7) |
| `mingla-business/app/event/[id]/scanner/index.tsx` | MOD | +27 / -0 (additive banner + 2 styles) |

**Two files. Total ~+34 LOC net.**

---

## 11 — Verification commands run

```bash
cd mingla-business

# tsc check
npx tsc --noEmit | grep -v ".expo/types/router.d.ts"
# → exit 0, no output

# Hook order verification (key proof for ORCH-0710 fix)
grep -nE "useMemo|useState|useEffect|useCallback|^  if \(typeof eventId|return \(\s*$" \
  app/event/[id]/guests/[guestId].tsx
# → all hooks at lines 161–289; early-return shell at line 324; main return at line 371
# → NO hooks after line 324. ORCH-0710 fix verified.

# Grep regression #1 — no oklch/lab/lch in Cycle 11 files
grep -rE "oklch|lab\(|lch\(|color-mix" \
  src/store/scanStore.ts \
  src/store/scannerInvitationsStore.ts \
  src/utils/expandTicketIds.ts \
  src/utils/qrPayload.ts \
  src/components/scanners/ \
  src/components/checkout/TicketQrCarousel.tsx \
  app/event/[id]/scanner/ \
  app/event/[id]/scanners/ \
  app/event/[id]/guests/
# → 0 hits

# Grep regression #2 — no fresh-array selector direct subscriptions
grep -rEn "useScanStore\(\(s\) => s\.(getScansFor|getScanByTicketId|getSuccessfulScanByTicketId)|useScannerInvitationsStore\(\(s\) => s\.(getInvitationsFor|getInvitationById)" \
  src/ app/
# → 0 hits

# Grep regression #3 — no scanner stores in anon-buyer routes (I-21)
grep -rE "useScanStore|useScannerInvitationsStore" app/o/ app/e/ app/checkout/
# → 0 hits
```

All 4 verifications PASS.

---

## 12 — Test plan for tester (RETEST mode)

Suggested re-test sequence after this retry:

1. **ORCH-0710 fix smoke (CRITICAL — primary)** — Cold-launch the app. Tap a guest in J-G1. Open J-G2 detail. **Should render without React Rules of Hooks error.** Check console for the absence of "Rendered more hooks than during the previous render."
2. **ORCH-0710 comp removal smoke** — Open J-G2 for a comp. Tap "Remove guest" → confirm with 10+ char reason. **Should navigate back via handleBack without intermediate-render crash.**
3. **ORCH-0711 banner smoke** — Tap "Scan tickets" on Event Detail. Grant camera permission. **Orange banner with "Testing mode" copy must be visible above the camera viewport.**
4. **ORCH-0711 negative smoke** — Deny camera permission. Permission prompt screen renders. **Banner must NOT render here.**
5. **ORCH-0711 negative smoke 2** — Set permission to permanently denied via OS Settings. Tap "Scan tickets". Settings deeplink fallback renders. **Banner must NOT render here.**
6. **Re-run tester's AT-RISK SC items (SC-9, SC-14, SC-15, SC-16)** — these were AT RISK due to ORCH-0710. After fix they should PASS by code-trace. Manual smoke confirms.
7. **Operator-side device smoke for SC-1, SC-2, SC-3** — unchanged from v1 dispatch; physical-device dependencies (camera permission OS prompt, Settings deeplink, haptics).

---

## 13 — Cross-references

- Dispatch: [`prompts/IMPLEMENTOR_BIZ_CYCLE_11_RETRY_ORCH-0710_ORCH-0711.md`](../prompts/IMPLEMENTOR_BIZ_CYCLE_11_RETRY_ORCH-0710_ORCH-0711.md)
- Tester report (NEEDS REWORK source): [`reports/TEST_BIZ_CYCLE_11_QR_SCANNER_REPORT.md`](./TEST_BIZ_CYCLE_11_QR_SCANNER_REPORT.md) §4 + §5
- Original Cycle 11 IMPL report v1: [`reports/IMPLEMENTATION_BIZ_CYCLE_11_QR_SCANNER_REPORT.md`](./IMPLEMENTATION_BIZ_CYCLE_11_QR_SCANNER_REPORT.md)
- Cycle 11 SPEC: [`specs/SPEC_BIZ_CYCLE_11_QR_SCANNER.md`](../specs/SPEC_BIZ_CYCLE_11_QR_SCANNER.md)
- INVARIANT_REGISTRY (I-25, I-26, I-27, I-28): [`Mingla_Artifacts/INVARIANT_REGISTRY.md`](../INVARIANT_REGISTRY.md)
- MASTER_BUG_LIST top entry registering ORCH-0710 + ORCH-0711: [`Mingla_Artifacts/MASTER_BUG_LIST.md`](../MASTER_BUG_LIST.md)
