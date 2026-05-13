# QA — ORCH-0815-A2 RETEST — Phase A buyer layer P1 rework

**Verdict:** PASS.
**Date:** 2026-05-12.
**Owner:** Claude `mingla-tester` (RETEST mode, operator-redirected; canonical TEST owner is Claude `mingla-forensics` per DEC-133).
**Working tree:** /Users/sethogieva/Desktop/mingla-main on branch Seth (synced to origin/Seth at 64918a62).
**Prior verdict:** CONDITIONAL PASS (`QA_ORCH-0815_A2_COMBINED_REPORT.md`, 2 P1 findings).
**Rework commit:** `b8d8b6f7` — "ORCH-0815-A2-B — close the 2 P1s from the A2 QA report".
**Retest cycle:** 1 (not stuck-in-loop).

---

## 1. Severity counts

| Severity | Count | Notes |
|---|---|---|
| P0 — CRITICAL | 0 | |
| P1 — HIGH | **0** (was 2 in prior report; both resolved) | |
| P2 — MEDIUM | 1 (carryover) | P2-1 setTimeout-unmount from prior report — not in rework scope; was accepted-as-deferred |
| P3 — LOW | 2 (carryover) | P3-1 fixed-clock for formatRelativeDate, P3-2 router.replace vs push doc |
| P4 — NOTE | 1 new + 4 prior | New praise: clean UUID guard with explicit rationale + filter-injection comment block |

---

## 2. P1 findings — verification matrix

### P1-1 — BuyerRow dead-tap (Constitution #1 violation)

| Field | Evidence |
|---|---|
| Prior status | FAIL — Pressable wrapper rendered with no `onPress`, lying about tappability |
| Rework target | `mingla-business/src/components/marketing/BuyerRow.tsx` |
| Fix verified at | [BuyerRow.tsx:130-162](mingla-business/src/components/marketing/BuyerRow.tsx#L130-L162) |
| Exact code | `if (onPress === undefined) { return (<View … accessibilityRole="none" … />); } return (<Pressable onPress={…} accessibilityRole="button" … />);` |
| Branch semantics | View branch: no Pressable, no press feedback, `accessibilityRole="none"`. Pressable branch: real onPress invocation, `pressed` style, `accessibilityRole="button"`, hitSlop 4. |
| Caller audit | `app/brand/[id]/blasts.tsx:183` passes `<BuyerRow buyer={buyer} />` (no onPress → View branch). `app/event/[id]/blasts/index.tsx:167` same shape. Both Phase A surfaces correctly render the non-interactive branch. |
| Regression check | Future ORCH wiring real navigation just starts passing `onPress` — row auto-upgrades to Pressable. No render-branch drift risk. |
| Status | ✅ **RESOLVED** |

### P1-2 — PostgREST filter-injection vector in `.or()` clause

| Field | Evidence |
|---|---|
| Prior status | HIGH — bare ID concatenation into `.or()` raw-filter string was a corruption vector (CAN-SPAM over/under-suppress risk; RLS prevented exfiltration but not corruption) |
| Rework target | `mingla-business/src/services/marketing/marketingAudienceService.ts` |
| Fix verified at | [marketingAudienceService.ts:40-59](mingla-business/src/services/marketing/marketingAudienceService.ts#L40-L59) (helper) + [:107](mingla-business/src/services/marketing/marketingAudienceService.ts#L107), [:158](mingla-business/src/services/marketing/marketingAudienceService.ts#L158), [:194](mingla-business/src/services/marketing/marketingAudienceService.ts#L194) (call sites) |
| Regex | `UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i` — strict 8-4-4-4-12 hex with hyphens, case-insensitive. Correctly rejects commas, parens, single quotes, partial UUIDs, empty strings. |
| `assertUuid` shape | Throws `Error("<label>: expected UUID, got <JSON.stringify(value)>")` — clear blame string for ops/debug; no silent failure (Constitution #3 preserved). |
| Coverage | (a) `resolveBrandBuyers(brandId)` user-input guard; (b) `resolveEventBuyers(eventId)` user-input guard; (c) `resolveEventBuyers` derived `brandId` from `orders[0].events.brand_id` revalidated before unsub `.or()` — defense in depth even though the source is RLS-gated server data. Every `.or()` builder call now sits behind a guard. |
| Existing `.eq()` calls | Correctly left unguarded — PostgREST `.eq()` is parameterized and not a string-injection surface. |
| Test coverage | New jest case "throws when brandId is not a valid UUID (PostgREST filter-injection guard)" — verifies guard rejects injection-style strings AND plain non-UUID strings, AND that a valid UUID passes. |
| Status | ✅ **RESOLVED** |

---

## 3. Independent gates

```bash
# TypeScript
cd mingla-business && npx tsc --noEmit
# Exit 0. No errors.

# Marketing service tests
npx jest src/services/marketing
# Test Suites: 1 passed, 1 total
# Tests:       19 passed, 19 total
# (was 18 in prior CONDITIONAL — +1 for the new UUID-guard test)
```

Verified by this skill, not by implementor claim. Commit message claim of "19/19 PASS, was 18" is accurate.

Pre-existing failing `publicEventsService.test.ts` (2 date-assertion failures) remain — confirmed baseline by the ORCH-0816 QA cycle; out of scope for ORCH-0815 retest. Registered separately as ORCH-0819.

---

## 4. Constitution check — focused on the prior FAIL rule

| # | Rule | Prior | Now | Evidence |
|---|---|---|---|---|
| 1 | No dead taps | **FAIL** (BuyerRow Pressable without onPress) | **PASS** | Conditional render: View branch when no onPress, Pressable only with handler. No fake tap affordance in Phase A routes. |
| 2 | One owner per truth | PASS | PASS | Unchanged. |
| 3 | No silent failures | PASS | PASS (reinforced) | `assertUuid` throws with diagnostic label rather than silently sanitizing or returning empty. React Query surfaces as `isError`. |
| 4 | One key per entity | PASS | PASS | `brandCustomersKeys` / `eventBuyersKeys` factories unchanged. |
| 5 | Server state server-side | PASS | PASS | Service is owner; hooks consume. |
| 6 | Logout clears | N/A | N/A | No persisted state. |
| 7 | Label temporary | N/A | N/A | |
| 8 | Subtract before adding | PASS | PASS | Rework replaced the Pressable wrapper with a conditional, didn't layer a "deprecated Pressable" branch. |
| 9 | No fabricated data | PASS | PASS | |
| 10 | Currency-aware | PASS | PASS | |
| 11 | One auth | N/A | N/A | |
| 12 | Validate at right time | PASS | **PASS (reinforced)** | UUID validation at service boundary — the right time. |
| 13 | Exclusion consistency | PASS | PASS | |
| 14 | Persisted-state startup | N/A | N/A | |

**Net change:** prior 1 FAIL + 9 PASS + 4 N/A → **0 FAIL + 10 PASS + 4 N/A.** Both reinforced rules (#3, #12) gain explicit defensive coverage.

---

## 5. Cross-domain regression check

| Surface | Impact | Status |
|---|---|---|
| `mingla-business` mobile | BuyerRow + audience service used in 2 routes | ✅ both routes render View branch correctly; no onPress regressions |
| `mingla-business` web | Same code path; RN core View + Pressable both web-compatible | ✅ no issue |
| `app-mobile` | Untouched | ✅ N/A |
| `mingla-admin` | Untouched | ✅ N/A |
| Edge functions | Untouched | ✅ N/A |
| Tests for sibling services | None touched | ✅ |

Hook-layer downstream: `useBrandCustomers` / `useEventBuyers` both gate on `typeof xxx === "string" && xxx.length > 0` ([useBrandCustomers.ts:41](mingla-business/src/hooks/marketing/useBrandCustomers.ts#L41), [useEventBuyers.ts:40](mingla-business/src/hooks/marketing/useEventBuyers.ts#L40)). If a non-UUID string slips past the enabled gate (e.g., malformed route param), `assertUuid` now surfaces as `isError` on the React Query result rather than corrupting a filter — strictly safer behavior. No new failure mode in production paths.

---

## 6. New observations

### 🟢 P4 — UUID guard design

The `UUID_RE` + `assertUuid` pair at [marketingAudienceService.ts:40-59](mingla-business/src/services/marketing/marketingAudienceService.ts#L40-L59) is the right shape for this class of fix:

- Strict regex (no liberal partial matches that would let `a, b, c` slip through).
- Throws rather than silently sanitizing — Constitution #3 compatible.
- Diagnostic label included in the error so operators see which call site fired.
- Comment block explicitly states why `.eq()` calls are unguarded (parameterized) and why `.or()` calls aren't (raw string). Future engineers can extend the same pattern when adding new `.or()` builders without rediscovering the rationale.

This is a worth-replicating pattern for any service that interpolates user-controllable IDs into PostgREST filter strings.

---

## 7. Carryover items (not in retest scope)

| ID | From prior report | Status |
|---|---|---|
| P2-1 | `setTimeout` not cleared on unmount in customers + buyers routes | Carries over. Acceptable for the unconditional close per prior operator stance; register as a follow-up if it surfaces in real-world testing. |
| P3-1 | `formatRelativeDate` uses `Date.now()` (test stability) | Carries over. |
| P3-2 | `router.replace` vs `push` doc note | Carries over. |
| P4 prior | 4 praise items in original report (good patterns) | Still valid. |

None block PASS.

---

## 8. Spec compliance — re-verified for affected criteria

| SC | Criterion | Prior status | Retest status |
|---|---|---|---|
| SC-4 | Brand Customers tab — sticky CTA + buyer list | PASS (with P1-1 caveat) | **PASS (no caveat)** |
| SC-5 | Event Buyers tab — buyer list | PASS (with P1-1 caveat) | **PASS (no caveat)** |
| SC-20 | Mingla design tokens, ≥44pt, accessibilityLabel | PASS | PASS — BuyerRow View branch retains `accessibilityLabel`; Pressable branch retains 44pt + label per pattern |

Other SCs unchanged from prior PASS.

---

## 9. Discoveries for orchestrator

- None new. Carryover P2/P3 items already registered.

---

## 10. Verdict and routing

**PASS.** Zero P0, zero P1, both prior P1s independently verified resolved with code-level evidence + new test coverage. The CONDITIONAL stamp from the prior cycle is lifted.

**CLOSE may proceed.** Codex `orchestrator-mingla` should run the standard CLOSE protocol (artifact sync, DIAG reap for ORCH-0815-A2 + ORCH-0815-A2-B markers, commit-message presentation, EAS OTA, next dispatch). No outstanding gates.

If retest cycle counter is tracked: this is cycle 1, well within healthy bounds.

---

## 11. Rework instructions (if FAIL)

N/A — no FAIL findings.
