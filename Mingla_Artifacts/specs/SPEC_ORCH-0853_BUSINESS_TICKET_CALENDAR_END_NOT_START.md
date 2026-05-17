# SPEC — ORCH-0853 [Calendar Active/Archive partition uses event end_at for business-event tickets]

**Mode:** SPEC (no INVESTIGATE phase — root cause proven by orchestrator forensics 2026-05-17; this artifact is the binding contract for Codex `implementor-mingla`).
**Severity:** S1-high (operator-reproduced data corruption of buyer UX — purchased ticket for in-progress event lands in Archive).
**Sibling-pattern reference:** ORCH-0850 [End-not-start parity systemic — four surfaces] — `Mingla_Artifacts/specs/SPEC_ORCH-0850_END_NOT_START_SYSTEMIC.md`. This SPEC is the fifth-surface extension that ORCH-0850's grep-bounded sweep did not catch.
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`.

---

## 0. Phase 0 ingest summary

Loaded before drafting:

- **Dispatch:** `Mingla_Artifacts/prompts/SPEC_ORCH-0853_BUSINESS_TICKET_CALENDAR_END_NOT_START.md` (orchestrator-authored, root cause already proven this session — no separate investigation artifact exists by design).
- **Live source — partition logic:** `app-mobile/src/components/activity/CalendarTab.tsx:371-390` — the broken bucket; `app-mobile/src/components/activity/CalendarTab.tsx:248-270` — the canonical end-not-start mirror to copy from (`computeEntryEffectiveEnd`).
- **Live source — row shape + mapper:** `app-mobile/src/services/calendarService.ts:75-100` (interface), `app-mobile/src/services/calendarService.ts:316-424` (`CalendarService.fetchUserBusinessEventOrders` — select at line 322-331 already returns `event_dates.end_at`; mapper at line 379-424; line 411 sets `masterDateUtc` from `start_at` only — the omission).
- **Prior systemic CLOSE:** `Mingla_Artifacts/specs/SPEC_ORCH-0850_END_NOT_START_SYSTEMIC.md` (vocabulary, invariant naming convention, CI-gate pattern). New invariants `I-PROPOSED-EVENT-LIFECYCLE-SINGLE-HELPER` + `I-PROPOSED-CONSUMER-CALENDAR-USES-END-NOT-START` are ACTIVE post-ORCH-0850; this SPEC introduces `I-CALENDAR-BUSINESS-TICKET-END-NOT-START` as the row-type-aware sibling.
- **Existing CI gate:** `.github/scripts/strict-grep/i-consumer-calendar-uses-end-not-start.mjs` (pattern reference — same scaffolding shape, different forbidden regexes and required symbols).
- **WORLD_MAP entry:** `Mingla_Artifacts/WORLD_MAP.md` ORCH-0853 row, registered 2026-05-17, Affected Surfaces: `[iOS-consumer, Android-consumer]`.
- **Operator reproducer:** event "The Reckoning" — `event_dates.end_at` ~3am next day, ticket purchased and observed in Archive accordion immediately on purchase. Reproducer-bound dispatch ⇒ Prime Directive #7 applies at TEST time; this SPEC mandates live-fire sim repro as part of SC-5 gate.

Migration chain check: no migration is being added; `event_dates.end_at` exists since the original event_dates schema (predates ORCH-0828). No SQL touch in this SPEC.

---

## 1. Symptom & root cause (one-paragraph restatement for implementor)

A paid `orders` row whose joined `event_dates.end_at` is in the future but whose `event_dates.start_at` is in the past (any event currently running — typical case: late-night event 10pm–3am) appears under **Archive** on the consumer Calendar tab instead of **Active**. Mechanism: [`CalendarTab.tsx:371-390`](../../app-mobile/src/components/activity/CalendarTab.tsx#L371-L390) partitions `businessOrders` using `Date.parse(order.masterDateUtc) < now`, and `masterDateUtc` is wired from `event_dates.start_at` at [`calendarService.ts:411`](../../app-mobile/src/services/calendarService.ts#L411). `event_dates.end_at` is selected at line 328 but discarded by the mapper. Fix: propagate `end_at` to a new sibling field on `BusinessEventCalendarRow` and switch the partition to effective-end (end_at when present; start_at fallback when null) — mirror of [`CalendarTab.tsx:254-270`](../../app-mobile/src/components/activity/CalendarTab.tsx#L254-L270).

---

## 2. Scope & non-goals

### Scope (this SPEC covers exactly these changes)
- `app-mobile/src/services/calendarService.ts` — add `masterDateEndUtc: string | null` to `BusinessEventCalendarRow`; populate from `masterDate?.end_at ?? null` in the mapper.
- `app-mobile/src/components/activity/CalendarTab.tsx` — replace the `activeBusinessOrders / archiveBusinessOrders` `useMemo` body to compute `effectiveEndTs = endTs ?? startTs ?? NaN` and partition on that.
- New invariant entry in `Mingla_Artifacts/INVARIANT_REGISTRY.md`: `I-CALENDAR-BUSINESS-TICKET-END-NOT-START`.
- New strict-grep CI gate `.github/scripts/strict-grep/i-calendar-business-ticket-end-not-start.mjs` registered in `.github/workflows/strict-grep-mingla-business.yml` per the registry pattern.
- New regression tests (one happy-path implementor-authored, one adversarial tester-authored) — paths in §6.

### Non-goals (do NOT do these)
- No SQL, no migration, no RLS change (`end_at` is already selected and authorized to the buyer via existing orders/events RLS).
- No edge function deploy.
- No refactor of `BusinessEventCalendarRow` beyond the single new field; do NOT collapse it into a class, do NOT add timezone-aware helpers, do NOT add computed getters.
- No change to the scheduled-card partition at `CalendarTab.tsx:254-270` (already correct post-ORCH-0850).
- No change to pending-payment short-circuit at `CalendarTab.tsx:376-378` — preserved verbatim.
- No change to React Query keys, the realtime subscription, or the explicit-polling success branch in `ExpandedBusinessEventSheet.handleBuy`.
- No change to `mingla-business/`, `mingla-admin/`, edge functions, or buyer-web routes.
- No retro-audit of the four ORCH-0850 surfaces — verified at that close.

### Assumptions
- `event_dates.is_master = true` row exists for every business event surfaced in the calendar (current invariant — orders cannot be created against an event without a master date; checkout creates one when missing).
- `end_at` is populated whenever `is_master = true` for every event currently in production. Defensive null-fallback to `start_at` is included for resilience; should never fire in practice. Implementor adds a one-line dev-only warning when `endTs` is NaN AND `startTs` is finite (i.e., `end_at` was null but `start_at` was set) — `console.warn` only, no Sentry/analytics.

---

## 2.5 Cross-Surface Impact (mandatory, codified 2026-05-15)

| Surface | Covered | Notes |
|---|---|---|
| 1. Consumer iOS (`app-mobile/` on iOS) | YES | Primary surface — partition runs in `CalendarTab.tsx`. |
| 2. Consumer Android (`app-mobile/` on Android) | YES | Same source file, single shared codepath. Parity is **automatic** (one code path) — single success criterion per SC, tested on both sim AND emu per Prime Directive #7. |
| 3. Buyer / anonymous Web (`mingla-business/` buyer routes) | NO | No consumer Calendar tab; anon buyers don't have a tickets list. |
| 4. Business iOS (`mingla-business/` on iOS) | NO | Creator side reads `events`-shaped Hub feed, not `BusinessEventCalendarRow`; ORCH-0850 already fixed Hub Past tab via `isEventPast`. |
| 5. Business Android (`mingla-business/` on Android) | NO | Same as business iOS. |
| 6. Admin Web (`mingla-admin/`) | NO | No consumer-calendar UI in admin. |
| 7. Business Web preview (`mingla-business/` web dev) | NO | Same as buyer web — no consumer Calendar tab. |

Parity is automatic (shared `app-mobile/` source). No per-surface success criteria split required.

---

## 3. Per-layer specification

### 3.1 Database layer
**No change.** `event_dates.end_at` already exists, is selected, and is RLS-permitted to the buyer via the existing `orders.buyer_user_id = auth.uid()` chain that grants read on the joined `events → event_dates` rows.

### 3.2 Edge function layer
**No change.**

### 3.3 Service layer — `app-mobile/src/services/calendarService.ts`

#### 3.3.1 Interface extension
Add field to `BusinessEventCalendarRow` (after `masterDateUtc` for locality):

```ts
export interface BusinessEventCalendarRow {
  // … existing fields …
  masterDateUtc: string | null;
  /**
   * ORCH-0853: ISO-8601 UTC end timestamp of the master event date.
   * Sourced from `event_dates.end_at` where `is_master = true`.
   * Null only when the master row lacks `end_at` (defensive — should not
   * occur in production). Active/Archive partition uses this; start-only
   * partition was the ORCH-0853 bug.
   */
  masterDateEndUtc: string | null;
  // … existing fields …
}
```

#### 3.3.2 Mapper change
In `CalendarService.fetchUserBusinessEventOrders` at the return-object site (currently lines 404-424), add ONE field directly below `masterDateUtc`:

```ts
masterDateUtc: masterDate?.start_at ?? null,
// ORCH-0853: end-of-event timestamp used by consumer Calendar partition.
masterDateEndUtc: masterDate?.end_at ?? null,
```

No other field changes. No type-system widening. No new SELECT — the `event_dates.end_at` column is already in the select string at line 328.

#### 3.3.3 No other callers update needed
Grep verification expected by implementor before commit: `rg "masterDateUtc" app-mobile/src/` should return ONLY the existing references (interface + mapper + CalendarTab partition + business-event card sort/display). Anywhere `masterDateUtc` is read for display/sort stays unchanged — display uses start-of-event (correct). `masterDateEndUtc` is read ONLY by the new partition logic in 3.4.

### 3.4 Hook layer — `app-mobile/src/hooks/useCalendarEntries.ts`
**No change.** The hook returns rows verbatim; widening the row shape with one field is transparent to React Query cache, query keys, and the realtime subscription.

### 3.5 Component layer — `app-mobile/src/components/activity/CalendarTab.tsx`

#### 3.5.1 Partition useMemo replacement
Replace lines 371-390 verbatim. Before:

```ts
// ORCH-0842: partition business orders into active vs archive using
// masterDateUtc (no scheduled-card duration concept; the event itself
// is the unit). Pending-payment orders always stay Active.
const { activeBusinessOrders, archiveBusinessOrders } = useMemo(() => {
  const now = Date.now();
  const active: BusinessEventRow[] = [];
  const archive: BusinessEventRow[] = [];
  for (const order of businessOrders) {
    if (order.paymentStatus === "pending") {
      active.push(order);
      continue;
    }
    const ts = order.masterDateUtc
      ? Date.parse(order.masterDateUtc)
      : Number.NaN;
    if (Number.isFinite(ts) && ts < now) {
      archive.push(order);
    } else {
      active.push(order);
    }
  }
  return { activeBusinessOrders: active, archiveBusinessOrders: archive };
}, [businessOrders]);
```

After:

```ts
// ORCH-0853: partition business orders into active vs archive using
// EFFECTIVE END time (event_dates.end_at when present; start_at fallback
// when null — defensive). Mirrors the scheduled-card effectiveEnd logic
// at the useMemo above. Pre-fix this used start-only `masterDateUtc < now`
// and archived in-progress events the moment they STARTED — e.g. The
// Reckoning (10pm-to-3am) flipped to Archive at 10:01pm while still 5
// hours from ending. See I-CALENDAR-BUSINESS-TICKET-END-NOT-START.
// Sibling fix to ORCH-0850; this is the fifth surface that the systemic
// sweep's `scheduled_at` grep scope did not catch.
const { activeBusinessOrders, archiveBusinessOrders } = useMemo(() => {
  const now = Date.now();
  const active: BusinessEventRow[] = [];
  const archive: BusinessEventRow[] = [];
  for (const order of businessOrders) {
    if (order.paymentStatus === "pending") {
      active.push(order);
      continue;
    }
    const endTs = order.masterDateEndUtc
      ? Date.parse(order.masterDateEndUtc)
      : Number.NaN;
    const startTs = order.masterDateUtc
      ? Date.parse(order.masterDateUtc)
      : Number.NaN;
    const effectiveEndTs = Number.isFinite(endTs)
      ? endTs
      : Number.isFinite(startTs)
        ? startTs
        : Number.NaN;
    if (Number.isFinite(effectiveEndTs) && effectiveEndTs < now) {
      archive.push(order);
    } else {
      active.push(order);
    }
  }
  return { activeBusinessOrders: active, archiveBusinessOrders: archive };
}, [businessOrders]);
```

Rules:
- `end_at` is authoritative; `start_at` is fallback ONLY when `end_at` is null.
- Pending-payment short-circuit (lines 376-378 equivalent) preserved bit-for-bit.
- Orders with both `endTs` AND `startTs` null land in **Active** (matches scheduled-card behaviour at line 264 — "no parseable date → stays Active").
- Dependency array remains `[businessOrders]` — no new deps.

### 3.6 Realtime / cache / persistence
**No change.** `["businessEventOrders", userId]` cache key, realtime subscription on `orders` table, `staleTime: 60_000`, and `refetchOnWindowFocus: true` all preserved.

---

## 4. Success criteria

| ID | Criterion | Observable | Testable |
|---|---|---|---|
| SC-1 | A paid order whose `event_dates.end_at` > now appears in Active accordion regardless of `start_at`. | Operator opens Calendar tab on iOS sim mid-event window → ticket card visible in Active, not in Archive. | Maestro flow + unit test feeding `endTs = now+2h, startTs = now-2h, paymentStatus = "paid"` → asserts `activeBusinessOrders` contains the row and `archiveBusinessOrders` does not. |
| SC-2 | A paid order whose `event_dates.end_at` < now appears in Archive accordion. | Operator opens Calendar tab after event end → ticket card visible in Archive, not in Active. | Unit test feeding `endTs = now-1h, startTs = now-3h, paymentStatus = "paid"` → asserts row in `archiveBusinessOrders`. |
| SC-3 | Pending-payment orders stay in Active regardless of timestamps. | Pre-Stripe-confirmation ticket card appears in Active even if event timestamps are in the past (e.g. stale checkout attempt on yesterday's event). | Unit test feeding `paymentStatus = "pending"` + any timestamp combo → always in `activeBusinessOrders`. |
| SC-4 | Orders with `masterDateEndUtc` null AND `masterDateUtc` null land in Active (defensive). | Defensive — matches scheduled-card line 264 behaviour. | Unit test feeding both null → row in `activeBusinessOrders`. |
| SC-5 | Live-fire sim repro of The Reckoning scenario: a buyer's ticket for an event whose `end_at` > now and `start_at` < now appears in **Active** on iOS sim AND Android emu. | Tester runs Maestro / device-flow on both platforms; screenshots show Active accordion contains the row. Prime Directive #7 satisfied. | Maestro flow capturing screenshots before/after expanding Active accordion. |
| SC-6 | `masterDateEndUtc` is present on `BusinessEventCalendarRow` for every order returned by `fetchUserBusinessEventOrders` whose joined master `event_dates` row has `end_at` populated. | Service-layer assertion. | Service unit test mocking Supabase response → verifies the field is propagated. |
| SC-7 | Strict-grep CI gate `i-calendar-business-ticket-end-not-start.mjs` is registered in `.github/workflows/strict-grep-mingla-business.yml`, passes on the fixed tree, and FAILS on a synthetic revert (line 371-390 reverted to `masterDateUtc < now`). | CI log shows green on `main` HEAD post-merge; manual revert-and-run shows red. | Self-test mode (`--self-test`) + fails-on-revert capture in implementation report. |

---

## 5. Invariants

### 5.1 Invariants preserved (must not break)
- **I-PROPOSED-CONSUMER-CALENDAR-USES-END-NOT-START** (ORCH-0850, ACTIVE) — scheduled-card partition stays end-based. This SPEC does NOT touch lines 254-270.
- **I-PROPOSED-EVENT-LIFECYCLE-SINGLE-HELPER** (ORCH-0850, ACTIVE) — `mingla-business/src/utils/eventLifecycle.ts` `isEventPast` remains the single helper for `mingla-business/` consumers. This SPEC's `app-mobile/` partition does NOT depend on that helper (different row shape, different module boundary).
- **I-NO-FABRICATED-DATA** (Constitution #9) — null `end_at` falls back to `start_at` explicitly; never to `Date.now() + 24h` or any synthetic value.
- **I-PROPOSED-ZUSTAND-NO-SERVER-SNAPSHOTS** (ORCH-0742, ACTIVE) — `BusinessEventCalendarRow` is React Query server state, not Zustand-persisted. Adding `masterDateEndUtc` does not touch any Zustand store.

### 5.2 New invariant established by this SPEC

**I-CALENDAR-BUSINESS-TICKET-END-NOT-START** — register in `Mingla_Artifacts/INVARIANT_REGISTRY.md` (status: ACTIVE post-CLOSE).

> Every consumer-calendar Active/Archive partition decision — whether on `CalendarEntry` (scheduled-card) or `BusinessEventCalendarRow` (business-event ticket) — MUST use the row's effective END timestamp, never its start timestamp. New row types added to the unified calendar feed MUST declare an end-or-fallback semantic at the row-shape layer (`*EndUtc` sibling field next to the start field) and MUST be added to the strict-grep gate's required-presence + forbidden-pattern scans before merge.
>
> Codified after ORCH-0853: the ORCH-0850 four-surface sweep missed `BusinessEventCalendarRow` because its start field is `masterDateUtc` (not `scheduled_at`), placing it outside the original grep scope. Future row types in `app-mobile/src/services/calendarService.ts` must be enumerated by name in the CI gate.

---

## 6. Test cases & regression-test seeds (Step 0.5 gate)

### 6.1 Required regression tests for CLOSE

#### (a) Implementor happy-path test
**Path:** `app-mobile/src/components/activity/__tests__/CalendarTab.businessOrderPartition.test.ts` (NEW file).
**Strategy:** Extract the partition logic into a pure helper for testability, OR test via the rendered component with React Testing Library. Preferred = pure-helper extraction:

```ts
// In CalendarTab.tsx — extract above the component:
export function partitionBusinessOrders(
  orders: BusinessEventRow[],
  nowMs: number,
): { active: BusinessEventRow[]; archive: BusinessEventRow[] } { /* … */ }
```

Then the useMemo calls `partitionBusinessOrders(businessOrders, Date.now())`. The helper is exported and unit-tested directly.

**Tests (minimum 6 cases):**

| Test ID | Input | Expected |
|---|---|---|
| T-01 | `endTs = now+2h, startTs = now-2h, paid` | active |
| T-02 | `endTs = now-1h, startTs = now-3h, paid` | archive |
| T-03 | `endTs = null, startTs = now-3h, paid` (fallback path) | archive |
| T-04 | `endTs = null, startTs = null, paid` (defensive) | active |
| T-05 | `paymentStatus = "pending"`, any timestamps | active |
| T-06 | Boundary: `endTs = now` (equal, not strictly less) | active |

**Fails-on-revert verification:** implementor MUST revert lines 371-390 to the pre-fix start-only predicate, run `npm test app-mobile/src/components/activity/__tests__/CalendarTab.businessOrderPartition.test.ts`, capture T-01 + T-03 FAILING, restore the fix, capture all 6 PASSING. Cite both commit SHAs in the implementation report under §"Fails-on-revert".

#### (b) Tester adversarial test
**Path:** `app-mobile/src/components/activity/__tests__/CalendarTab.businessOrderPartition.adversarial.test.ts` (NEW file).
**Different angle from happy-path:** attack the row-shape contract and timezone parsing, not the partition algebra. Required angles (tester picks at least 2 distinct ones — the test MUST fail-on-revert from an angle the happy-path test does NOT cover):

| Adversarial vector | Attack | Expected behaviour |
|---|---|---|
| A-1 | `endTs` is a malformed ISO string ("not-a-date") + `startTs` finite | falls back to `startTs` |
| A-2 | Both `endTs` and `startTs` are malformed strings | lands in Active (NaN-NaN-NaN path) |
| A-3 | DST-boundary `endTs` (spring-forward / fall-back day in caller's local tz; UTC parse must remain stable) | partition still uses UTC ms compare correctly |
| A-4 | `endTs` is in the far future (`9999-12-31T23:59:59Z`) | active (defends against Y10K overflow regressions) |
| A-5 | `endTs < startTs` (corrupt `event_dates` row where end is before start) | uses `endTs` as authoritative — lands in archive if `endTs < now` |

**Fails-on-revert verification:** tester reverts the fix, runs the adversarial suite, captures FAILures at A-1 and A-5 (those exercise the end-vs-start primacy). Tester captures both commit SHAs.

### 6.2 Append-only enforcement
Both test files are immutable post-merge per `.github/workflows/tests-append-only.yml`. Modifications require a new ORCH-ID with `[TEST-MOD-APPROVED ORCH-NNNN]` in the commit body.

---

## 7. CI gate — `.github/scripts/strict-grep/i-calendar-business-ticket-end-not-start.mjs`

### 7.1 Scaffold (mirrors `i-consumer-calendar-uses-end-not-start.mjs`)

```js
#!/usr/bin/env node
/**
 * Strict-grep gate for I-CALENDAR-BUSINESS-TICKET-END-NOT-START.
 *
 * Enforces ORCH-0853:
 *   Any client-side partition of `BusinessEventCalendarRow` into past-vs-
 *   upcoming buckets in `app-mobile/` MUST evaluate effectiveEnd against
 *   `masterDateEndUtc` (with `masterDateUtc` fallback), NOT start-only.
 */

const TARGETS = [
  "app-mobile/src/components/activity/CalendarTab.tsx",
];
const ROW_SHAPE = "app-mobile/src/services/calendarService.ts";

// Forbidden: any start-only partition predicate on order.masterDateUtc.
const FORBIDDEN = [
  // Direct start-only Date.parse < now pattern.
  /Date\.parse\(\s*order\.masterDateUtc\s*\)\s*<\s*now\b/,
  // Variable form: const ts = order.masterDateUtc ? Date.parse(...) : NaN; … ts < now
  // Caught by a 2-line scan in the partition useMemo block — see below.
];

// Required tokens in CalendarTab.tsx partition block:
const REQUIRED_CALENDAR_TAB = [
  "masterDateEndUtc",      // the new sibling field must be read
  "effectiveEndTs",        // canonical variable name from SPEC §3.5.1
];

// Required tokens in calendarService.ts:
const REQUIRED_ROW_SHAPE = [
  "masterDateEndUtc",                  // interface field present
  /end_at\s*\?\?\s*null/,              // mapper line propagating end_at
];

// Whitelist: `// SPEC ORCH-0853 OK:` exempts a line.
const WHITELIST = /\/\/\s*SPEC\s+ORCH-0853\s+OK\s*:/;
```

### 7.2 Required-presence checks
- `CalendarTab.tsx` MUST contain `masterDateEndUtc` AND `effectiveEndTs` (the SPEC-canonical variable name).
- `calendarService.ts` MUST contain `masterDateEndUtc` in the interface AND `end_at ?? null` somewhere in the mapper.

### 7.3 Negative-control (fails-on-revert)
Reverting the partition block to use `order.masterDateUtc < now` (and removing `effectiveEndTs`) MUST cause the gate to exit 1 on the required-presence check (`effectiveEndTs` missing) AND on the forbidden-pattern check.

### 7.4 Self-test mode
`--self-test` flag — inline fixture with the forbidden pattern; regex must match; exit 0 on success, 1 on failure.

### 7.5 Workflow wiring
Add a job to `.github/workflows/strict-grep-mingla-business.yml` per the registry pattern (`feedback_strict_grep_registry_pattern.md`): one script + one job, NO parallel workflow file. Job name suggestion: `i-calendar-business-ticket-end-not-start`. Include the `--self-test` invocation as a prior step.

---

## 8. Implementation order (numbered sequence for Codex implementor)

1. **Branch / sync** — confirm working tree is `/Users/sethogieva/Desktop/mingla-main` on `Seth`, clean of unrelated WIP per §10 hard guards. `git fetch origin && git pull --ff-only origin Seth`.
2. **Service layer** — `app-mobile/src/services/calendarService.ts`:
   - Add `masterDateEndUtc: string | null` to `BusinessEventCalendarRow` interface (§3.3.1).
   - Add `masterDateEndUtc: masterDate?.end_at ?? null` in the mapper return object (§3.3.2).
   - Run `npx tsc --noEmit` from `app-mobile/`; confirm clean.
3. **Component layer** — `app-mobile/src/components/activity/CalendarTab.tsx`:
   - Extract pure helper `partitionBusinessOrders(orders, nowMs)` (§6.1 (a) — required for unit-testability of the partition logic in isolation).
   - Replace lines 371-390 with the SPEC §3.5.1 body, delegating to the helper.
   - Run `npx tsc --noEmit` from `app-mobile/`; confirm clean.
4. **Implementor happy-path test** — write `app-mobile/src/components/activity/__tests__/CalendarTab.businessOrderPartition.test.ts` per §6.1 (a). Run `npm test -- CalendarTab.businessOrderPartition` and confirm 6/6 green.
5. **Fails-on-revert proof** — temporarily revert §3.5.1 to start-only, rerun test, capture T-01 + T-03 FAILing, restore fix, capture all PASS. Record both git SHAs in the implementation report `§Fails-on-revert` section.
6. **CI gate** — write `.github/scripts/strict-grep/i-calendar-business-ticket-end-not-start.mjs` per §7. Run `node .github/scripts/strict-grep/i-calendar-business-ticket-end-not-start.mjs --self-test` → PASS. Run without flag → PASS on fixed tree.
7. **Workflow wiring** — append job to `.github/workflows/strict-grep-mingla-business.yml` per §7.5.
8. **Invariant registry** — add `I-CALENDAR-BUSINESS-TICKET-END-NOT-START` entry to `Mingla_Artifacts/INVARIANT_REGISTRY.md` per §5.2, ACTIVE-on-close.
9. **Implementation report** — write `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0853_BUSINESS_TICKET_CALENDAR_END_NOT_START.md` with old→new receipts for each touched file, fails-on-revert SHAs, `git diff --stat HEAD` capture (per I-PROPOSED-IMPL-DIFF-STAT-AT-CLOSE from ORCH-0850 close), test logs.
10. **Hand to tester** — Claude `mingla-tester` for adversarial test + iOS sim + Android emu live-fire repro per SC-5.

**Implementor must NOT:**
- Run `supabase db push`.
- Deploy any edge function.
- Touch `mingla-business/`, `mingla-admin/`, or `supabase/`.
- Touch any file outside the four named above (`calendarService.ts`, `CalendarTab.tsx`, the new test file, the new CI gate script, the workflow file, the invariant registry).
- Refactor unrelated code "while we're at it."

---

## 9. Regression prevention summary

| Mechanism | What it catches |
|---|---|
| Pure helper `partitionBusinessOrders` + unit tests | Algorithmic regressions in the partition logic. |
| CI gate `i-calendar-business-ticket-end-not-start.mjs` | Any code revert that drops `masterDateEndUtc` from the interface or partition; any reintroduction of `Date.parse(order.masterDateUtc) < now`. |
| Adversarial test (tester-authored) | Null-fallback paths, malformed input, end-vs-start primacy. |
| Append-only test workflow | Future agents cannot weaken either regression test without an ORCH-tagged override. |
| Invariant `I-CALENDAR-BUSINESS-TICKET-END-NOT-START` | Future row types added to the unified calendar feed MUST declare a `*EndUtc` field and be enumerated in the CI gate. Procedural lock-in. |

---

## 10. Hard guards & out-of-scope (do NOT expand)

- No re-audit of ORCH-0850's four original surfaces.
- No timezone-display refactor (display continues to use `masterDateUtc` for "starts at 10pm" rendering — correct).
- No change to the unified Active/Archive accordion sort order beyond what the partition naturally implies (already sorts on `scheduledAt` which is `masterDateUtc ?? new Date(0).toISOString()` per `calendarService.ts:457` — preserved).
- No change to the realtime subscription, optimistic update behaviour, or polling fallback.
- No change to `BusinessEventCard`-shaped Discover-feed types (different surface — Discover does its own ended-event filter via `discover-merged-events` edge function per ORCH-0845).
- No new SQL probes against production; the live-fire repro is mobile-side only.

---

## 11. Discoveries for orchestrator (registered now, not deferred to CLOSE)

- **D-1 (process, P3):** the ORCH-0850 systemic-sweep methodology (grep `scheduled_at` consumers) is row-shape-blind. Future "systemic" ORCHs touching calendar logic should enumerate row types by name (`CalendarEntry`, `BusinessEventCalendarRow`, plus any future siblings) rather than greppping field names. Suggest meta-ORCH-NEW [Systemic sweep methodology: enumerate row types, not field names] queued for orchestrator triage post-ORCH-0853 close.
- **D-2 (data integrity, P3):** the codebase has no SQL-side CHECK constraint asserting `event_dates.end_at IS NOT NULL WHERE is_master = true`. Production data is currently clean (orchestrator probe at INTAKE time observed all live master rows have end_at populated), but the constraint would make the §3.3.2 null-fallback strictly defensive. Suggest follow-up ORCH-NEW [event_dates master-row end_at NOT NULL constraint] for later cycle.
- **D-3 (observation, P4):** the partition useMemo is at component-scope and recomputes on every `businessOrders` array identity change. React Query already memoises the array reference by default; no perf concern. Noted for completeness only.

---

## 12. Confidence

**Confidence: HIGH (proven).** Root cause is six-field-evidenced in the dispatch and verified by me at the source level (lines, code, mechanism, causal chain, verification step all confirmed in §1 + §0). Live-fire repro deferred to TEST phase per Prime Directive #7 — SC-5 is the gate.

---
