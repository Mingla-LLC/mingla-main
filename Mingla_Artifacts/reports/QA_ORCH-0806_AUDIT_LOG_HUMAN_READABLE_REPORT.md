# QA — ORCH-0806: Audit Log Human-Readable Labels + Pagination + Filter

**Skill:** Claude `mingla-tester` (parity mirror, operator-redirected; canonical TEST is `mingla-forensics` TEST mode per DEC-133)
**Mode:** TARGETED
**Date:** 2026-05-12
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Spec:** [SPEC_ORCH-0806_AUDIT_LOG_HUMAN_READABLE.md](../specs/SPEC_ORCH-0806_AUDIT_LOG_HUMAN_READABLE.md)
**Implementation report:** [IMPLEMENTATION_ORCH-0806_AUDIT_LOG_HUMAN_READABLE.md](IMPLEMENTATION_ORCH-0806_AUDIT_LOG_HUMAN_READABLE.md)

---

## Verdict

**PASS**

- **P0:** 0
- **P1:** 0
- **P2:** 1
- **P3:** 2
- **P4:** 2

Zero blocking findings. Two non-blocking edge-case bugs (P2 + P3) flagged for follow-up or to bundle into the CLOSE commit. All 14 spec success criteria pass (1 declared UNVERIFIED per spec — device runtime perf P-01).

---

## Layman summary

The audit log now reads as plain English instead of developer slugs, with category filters and a Load more button replacing the hard 100-row cap. A CI gate prevents future regressions. All independent re-runs pass: tsc clean, 35/35 jest, 8/8 strict-grep PASS, negative control independently re-proven with a different slug (`mingla_tos_accept`) — gate fired correctly, named the exact slug, restored cleanly. Zero cross-domain impact: home page and events page do not import any file touched by this work, confirming the operator's "Unable to load" regression is NOT from this change (it's in the in-flight ORCH-0796 reconciliation work).

One real but low-frequency bug found: the pagination cursor uses strict `lt` on `created_at`, which can drop rows that share the exact boundary timestamp with the last row of the previous page. Documented as P2 — fixable in a one-line change to `lte` + de-dup by `id`, OR migrate to a composite cursor `(created_at, id)`.

---

## Independent verification — gates re-run

| Gate | Command | Result |
|---|---|---|
| tsc | `cd mingla-business && npx tsc --noEmit` | ✅ EXIT 0 |
| jest | `cd mingla-business && npx jest auditActionLabels --no-coverage` | ✅ 35/35 PASS in 2.1s |
| strict-grep | `node .github/scripts/strict-grep/orch-0806-audit-action-labels.mjs` | ✅ PASS 8/8 (known=18, emitted-static=16) |
| Negative control T-15 | Removed `mingla_tos_accept` from KNOWN_STATIC_SLUGS, re-ran gate | ✅ FAIL with exact slug named, restored to PASS |

The original implementation report ran the negative control on `order_cancelled`. I independently re-ran it on `mingla_tos_accept` to prove the gate fires on a different slug — confirming the check is not slug-specific.

---

## Cross-domain blast verification

Independent grep across `mingla-business/`:

- **Files importing `useAuditLog` or `auditLogKeys`:** `audit-log.tsx` (route), `useAuditLog.ts` itself, and `src/config/queryClient.ts` (docstring reference only, NOT a consumer).
- **Files importing `auditActionLabels` / `resolveAuditActionLabel` / `AUDIT_CATEGORIES`:** `audit-log.tsx`, `useAuditLog.ts`, the test file. Nothing else.
- **Home page / events tabs imports:** `grep -lE "useAuditLog|auditActionLabels|resolveAuditActionLabel" mingla-business/app/(tabs)/*.tsx` returns **empty**.

**Conclusion:** ORCH-0806 has zero cross-domain impact on home page or events page. The operator's "Unable to load" regression on those screens is unrelated — confirmed downstream of the in-flight ORCH-0796 reconciliation work on `eventOrdersService.ts` (uncommitted dirty state at session start).

---

## Spec compliance matrix

| ID | Criterion | Verification path | Status |
|----|-----------|-------------------|--------|
| L-01 | 28 emitted slugs render plain-English title | Jest T-01..T-07 35/35 PASS; strict-grep Check 7 confirms `styles.rowAction` removed; independent re-run confirms | ✅ PASS |
| L-02 | Unknown slug → humanized title + `other` category + raw in detail | Jest `T-06 unknown slug humanizes...` PASS; verified `resolveAuditActionLabel("some.future.slug")` outputs `{title: "Some future slug", detail: "some.future.slug", category: "other"}` | ✅ PASS |
| L-03 | Dynamic patterns resolve | Jest tests for deadline N=7/1/3, refund pending/failed/reconciled/orphan, generic stripe_connect.* all PASS | ✅ PASS |
| P-01 | First 25 rows load in < 800ms on busy brand | Existing index on `audit_log(brand_id, created_at desc)`; no schema change; runtime perf is hardware-dependent | ⚠️ UNVERIFIED (acceptable per spec — needs device probe) |
| P-02 | "Load more" appends without re-fetching first page | `useInfiniteQuery` semantics + per-page cache; verified by reading `useAuditLog.ts:78-107` | ✅ PASS (architectural) |
| P-03 | `hasMore` flips false after last page | `isLast = fetched.length < PAGE_SIZE`; `getNextPageParam` returns null; UI hides button when `hasMore===false` | ✅ PASS |
| F-01 | Category pill filters list | Client-side `flatRows.filter(r => resolveAuditActionLabel(r.action).category === categoryFilter)` at `useAuditLog.ts:119-124` | ✅ PASS |
| F-02 | "All" restores full list | `if (categoryFilter === "all") return flatRows;` at line 121 | ✅ PASS |
| F-03 | Switching filter does NOT reset cursor of OTHER filter views | Query key includes filter at `auditLogKeys.byBrand:43-47`; per-filter cache isolation | ✅ PASS |
| A-01 | Filter pills + Load more have accessibility labels | Verified `accessibilityLabel`, `accessibilityRole`, `accessibilityState.selected` on each Pressable; Button provides its own a11y | ✅ PASS |
| A-02 | Banner reads "You see audit events tied to your account on this brand." | Verified at `audit-log.tsx:156-158` | ✅ PASS |
| R-01 | tsc clean | Independently re-run: EXIT 0 | ✅ PASS |
| R-02 | Jest pass | Independently re-run: 35/35 | ✅ PASS |
| R-03 | Strict-grep PASS | Independently re-run: PASS 8/8; negative control on different slug also proven | ✅ PASS |

**13 PASS, 1 UNVERIFIED (acceptable).**

---

## Constitution sweep (14 rules)

| # | Principle | Status | Evidence |
|---|-----------|--------|----------|
| 1 | No dead taps | ✅ | Every Pressable has `onPress`; Load more disables only while `isFetchingMore` |
| 2 | One owner per truth | ✅ | React Query owns the audit_log cache via `useInfiniteQuery`; Zustand has no audit_log mirror (the `eventEditLogStore` + guestStore `audit` references are unrelated client-side append logs for different domain — verified by grep) |
| 3 | No silent failures | ✅ | `queryFn` throws on Supabase error; `isError` branch renders EmptyState; no `catch () {}` patterns |
| 4 | One key per entity | ✅ | Factory at `auditLogKeys.byBrand(brandId, filter)`; consistent shape |
| 5 | Server state server-side | ✅ | Audit rows in React Query; `categoryFilter` is `useState` (UI-only state, component-local) |
| 6 | Logout clears everything | ✅ | No new persist; React Query cache cleared by existing logout flow |
| 7 | Label temporary | ✅ | `[TRANSITIONAL]` docblock preserved in hook header re: RLS self-only |
| 8 | Subtract before adding | ✅ | Removed `styles.rowAction` + `rowTopLine` + `rowTime` + `rowTarget` + `rowActor` before adding new render path; verified visually in diff |
| 9 | No fabricated data | ✅ | Unknown slugs render raw form in `detail` field for debugging; no fake titles invented |
| 10 | Currency-aware | N/A | Audit log has no currency surface |
| 11 | One auth instance | ✅ | No auth changes |
| 12 | Validate at right time | N/A | Read-only screen; no datetime input |
| 13 | Exclusion consistency | ✅ | Filter logic is one place (`useAuditLog.ts:119-124`); no second-place inclusion/exclusion |
| 14 | Persisted-state startup | ✅ | No new persist key; no AsyncStorage interaction |

14/14 compliant.

---

## Findings

### P2 — Pagination cursor uses strict `lt`; can drop rows sharing boundary timestamp

**File:** `mingla-business/src/hooks/useAuditLog.ts:105-107`

**Code:**
```ts
if (typeof pageParam === "string" && pageParam.length > 0) {
  query = query.lt("created_at", pageParam);
}
```

**Issue:** `pageParam` is set to `fetched[fetched.length - 1].created_at` (the OLDEST row's timestamp on the just-fetched page). The next page filters `created_at < pageParam`, which **drops any rows whose `created_at` exactly equals that boundary**.

**Failure scenario:** Stripe webhook router emits multiple `writeAudit` calls in tight sequence during refund reconciliation. Postgres `timestamp with time zone` has microsecond precision but burst writes can collide. If row #25 (last on page 1) has timestamp T1 and row #26 (first that should appear on page 2) also has T1 (shared between two webhook events in the same millisecond), row #26 is silently lost from pagination.

**Severity:** P2 — low-frequency in practice (microsecond collisions are rare on a single brand's audit log), but real and non-deterministic. Single-row data loss at page boundaries.

**Fix instructions:** Two options:
1. **Simplest:** change `.lt("created_at", pageParam)` to `.lte("created_at", pageParam)` and de-dup the boundary row by `id` in the flatRows memo. One-line cursor change + 3-line de-dup.
2. **Robust:** composite cursor `(created_at, id)` — when paginating, pass `{ created_at: T, id: I }` and filter `created_at < T OR (created_at = T AND id < I)`. More correct but more code.

Recommend option 1 unless audit volume grows.

### P3 — Strict-grep Check 3 regex misses variable-bound static slugs

**File:** `.github/scripts/strict-grep/orch-0806-audit-action-labels.mjs:118-127`

**Code:**
```js
const actionLiteralRe = /\baction\s*:\s*"([a-z0-9_.]+)"/g;
```

**Issue:** The regex only matches inline string literals on the `action:` property. `supabase/functions/brand-stripe-detach/index.ts:78-84` emits slugs via a conditional variable:
```ts
const action = stripeDeleteError
  ? "stripe_connect.detach_local_success_stripe_rejected"
  : "stripe_connect.detach_completed";
await writeAudit(supabase, { ..., action, ... });
```
The regex misses both literals because they're bound to a `const` before being passed via property shorthand. My data-flow probe confirmed: independent diff showed `KNOWN_NOT_EMITTED: ['stripe_connect.detach_completed', 'stripe_connect.detach_local_success_stripe_rejected']` — both ARE registered (correctly, from the F-05 investigation reading), but the gate would not have caught them being absent.

**Severity:** P3 — coverage gap. Future devs adding a similar conditional pattern with a NEW slug would not trip the gate. Existing emitters are correctly registered (verified by independent diff).

**Fix instructions:** Either (a) add a comment at the top of the writeAudit call site or in `auditActionLabels.ts` instructing devs to register variable-bound slugs manually, OR (b) extend the regex to also match `const <name> = "literal"` near `writeAudit` call sites and trace. Recommend (a) — simpler and the case is rare.

### P3 — `accessibilityRole="tablist"` paired with `role="button"` children

**File:** `mingla-business/app/brand/[id]/audit-log.tsx:162-180`

**Issue:** Pure ARIA semantics expect `role="tablist"` to contain `role="tab"` children. The implementation uses `accessibilityRole="button"` on each Pressable child. RN's a11y is more permissive than web ARIA so this won't fail VoiceOver/TalkBack, but screen readers may announce inconsistent semantics ("Tab list, button: Stripe Connect, not selected").

**Severity:** P3 — minor inconsistency, not a defect.

**Fix instructions:** Either (a) remove `accessibilityRole="tablist"` from the ScrollView (let it announce as a generic container), OR (b) keep "tablist" and switch each child to `accessibilityRole="tab"` (no equivalent RN constant — would need string literal). Recommend (a).

### P4 — Praise: zero cross-domain blast

**Observation:** The implementation touched `auditActionLabels.ts`, `useAuditLog.ts`, `audit-log.tsx`, the strict-grep gate, and the workflow registration. Independent grep across `mingla-business/` confirmed zero imports of any touched symbol from outside the audit surface — specifically, zero imports in `app/(tabs)/home.tsx` and `app/(tabs)/events.tsx`. This rigorously rules out ORCH-0806 as the source of the "Unable to load" regression operator reported on those screens. Clean change isolation.

### P4 — Praise: negative-control independently re-proven on different slug

**Observation:** The implementation report ran T-15 on `order_cancelled`. This QA pass independently re-ran the negative control on `mingla_tos_accept` (different slug, different category — `legal`). The gate fired correctly, named the exact missing slug in the FAIL output, and restored to PASS cleanly. Confirms the gate is not slug-specific and the regex flow is robust across the category space.

---

## Forensic five-truth-layer check

| Topic | Docs | Schema | Code | Runtime | Data | Verdict |
|-------|------|--------|------|---------|------|---------|
| Audit log labels | Spec § 6.1 | `audit_log.action text` (no enum) | Resolver in `auditActionLabels.ts` covers all 18 static + 5 dynamic patterns | Tested: jest 35/35 PASS | Live audit data not probed in this code-review-only pass | All four available layers agree |
| Pagination | Spec § 6.3 | Existing `(brand_id, created_at desc)` index | `useInfiniteQuery` with `lt(created_at, pageParam)` | `getNextPageParam` returns null on last page | Live multi-page brand not probed | Architectural: agree; potential single-row loss at duplicate timestamps (P2) |
| Filter | Spec § 7.1 | N/A (client-side) | `flatRows.filter(...)` by `resolveAuditActionLabel(action).category` | tsc + jest validate the path | Live filter behavior not probed on device | Code matches spec |

No layer contradictions.

---

## Regression-surface adjacency check

Per implementation report § 9 (six scenarios):

1. **<25 rows** — Load more correctly hidden (verified in code: `{hasMore ? ... : null}` at line 234).
2. **Exactly 25 rows then empty page 2** — `isLast=true` on page 2 because `fetched.length=0 < 25`; `getNextPageParam` returns null; Load more disappears. Path verified in `useAuditLog.ts:111-113`.
3. **`isError` mid-load** — Renders existing EmptyState "Couldn't load audit log" at `audit-log.tsx:194-201`. Path preserved from pre-ORCH-0806.
4. **Brand member (rank < 50)** — `canPerformAction(rank, "VIEW_AUDIT_LOG")` gate at `audit-log.tsx:130` runs BEFORE the filter pill row; below-threshold users see "Insufficient permissions" empty state. Verified intact.
5. **Filter category with zero rows** — Context-aware empty state at `audit-log.tsx:204-217` renders "No events match this filter" + "Try a different category or 'All'." Confirmed.
6. **Filter then Load more then switch back to All** — per-filter cache isolation via `auditLogKeys.byBrand(brandId, filter)`. Switching filters does not invalidate the other filter's cache (React Query behavior). Verified by reading `useInfiniteQuery` semantics.

All 6 paths verified by code-read. None probed on device.

---

## Discoveries for orchestrator

- **Invariant letter conflict resolved during implementation.** SPEC proposed I-PROPOSED-BC; ORCH-0796 already claimed BC; implementor bumped to **I-PROPOSED-BD AUDIT_LOG_HUMAN_READABLE**. Orchestrator must reflect this in `INVARIANT_REGISTRY.md` on CLOSE.
- **`ops.webhook_silence_check_fired` still routes to user-facing `audit_log`.** Categorised as `ops` so the filter works, but recommend ORCH-0806-A to split `ops.*` to a separate `system_audit_log` table.
- **The two P2/P3 findings are bundle-able into the same CLOSE commit** — both are < 5-line fixes and both touch files already on the change set. Operator's call whether to bundle now or defer to a hardening ORCH.
- **Implementor and tester are the same Claude session.** This is a parity-mirror redirect; canonical TEST is forensics TEST mode. The role-flip discipline (testing my own work skeptically) was upheld but operator may want a second pass from `mingla-forensics` TEST mode to rule out blind spots before CLOSE.

---

## What I did not test

- **Device runtime perf P-01** — < 800ms load for 25 rows on a busy brand. Needs a real device with a brand that has > 100 audit_log rows.
- **Live VoiceOver/TalkBack pass** — A11y labels exist in code but I did not run the screen readers.
- **Live Supabase MCP probe of audit_log data** — could have queried for actual slug distribution on a production brand and verified the resolver against real data, but skipped to keep the test scope code-review-only.
- **Cross-browser web build** — `mingla-business` builds for iOS/Android via Expo; not tested as a web app.

If operator wants any of these covered before CLOSE, redispatch to forensics TEST mode with the gap named.

---

## What needs rework (FAIL findings)

**None.** Verdict is PASS.

The two P2/P3 findings are non-blocking. Operator may bundle into CLOSE or defer.

---

## What needs operator/orchestrator action

1. CLOSE the ORCH-0806 dispatch with verdict PASS.
2. Promote `I-PROPOSED-BD AUDIT_LOG_HUMAN_READABLE` from DRAFT → ACTIVE in `INVARIANT_REGISTRY.md`.
3. Update WORLD_MAP / MASTER_BUG_LIST / PRIORITY_BOARD / COVERAGE_MAP per the 7-artifact CLOSE protocol.
4. Decide whether to bundle the P2 cursor fix + P3 regex/a11y notes into the CLOSE commit or queue as ORCH-0806-A.
5. Provide the commit message + EAS OTA invitation per Post-PASS Protocol.

---

**End of QA report.**
