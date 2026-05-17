# IMPLEMENTATION — ORCH-0853 [Calendar Active/Archive partition uses event end_at for business-event tickets]

**ORCH-ID:** ORCH-0853 (renamed from ORCH-0852 during implementation due to ID collision with a pre-existing `INVESTIGATION_ORCH-0852_BUYER_WEB_CONFIRMATION_BROKEN.md` artifact in the working tree).
**Phase:** IMPLEMENT — single-session Claude pipeline (orchestrator INTAKE → forensics SPEC → Claude implementor (this report) → next phase: tester).
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`.
**SPEC:** `Mingla_Artifacts/specs/SPEC_ORCH-0853_BUSINESS_TICKET_CALENDAR_END_NOT_START.md`.

---

## 0. ID rename note

The orchestrator initially registered ORCH-0852 for this bug. During implementation a pre-existing unrelated investigation artifact `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0852_BUYER_WEB_CONFIRMATION_BROKEN.md` was discovered in the working tree (untracked), already using ORCH-0852. To avoid collision the Calendar end-not-start ORCH was renumbered to **ORCH-0853**:

- WORLD_MAP.md row updated (line 1224: `ORCH-0852` → `ORCH-0853`).
- Dispatch + SPEC + regression check + CI gate + invariant entry all carry the new ID.
- All inline code comments, CI gate filenames, and npm script names reflect `0853`.

The pre-existing ORCH-0852 (Buyer-web confirmation QR clipped + wallet passes inert + in-app-browser stuck) remains untouched and will follow its own independent pipeline.

---

## 1. Files touched (ORCH-0853 scope only)

| File | Change | LOC |
|---|---|---|
| `app-mobile/src/services/calendarService.ts` | Added `masterDateEndUtc: string \| null` to `BusinessEventCalendarRow` interface; added `masterDateEndUtc: masterDate?.end_at ?? null` propagation line in `fetchUserBusinessEventOrders` mapper. | +7 |
| `app-mobile/src/components/activity/CalendarTab.tsx` | Replaced `activeBusinessOrders / archiveBusinessOrders` `useMemo` body with effective-end logic (`effectiveEndTs = endTs ?? startTs ?? NaN`); pending-payment short-circuit preserved verbatim. | +24/-15 |
| `app-mobile/scripts/ci/orch-0853-regression-check.mjs` | New — implementor happy-path regression check (10 source-level structural assertions). | +175 |
| `app-mobile/package.json` | Added `"test:orch-0853"` npm script. | +1 |
| `.github/scripts/strict-grep/i-calendar-business-ticket-end-not-start.mjs` | New — strict-grep CI gate with `--self-test` mode. | +175 |
| `.github/workflows/strict-grep-mingla-business.yml` | Added `i-calendar-business-ticket-end-not-start` job. | +13 |
| `Mingla_Artifacts/INVARIANT_REGISTRY.md` | New invariant `I-CALENDAR-BUSINESS-TICKET-END-NOT-START` (DRAFT, flips ACTIVE on CLOSE). | +18 |
| `Mingla_Artifacts/WORLD_MAP.md` | Row 1224 ORCH-ID rename (0852 → 0853). | +1/-1 |
| `Mingla_Artifacts/specs/SPEC_ORCH-0853_BUSINESS_TICKET_CALENDAR_END_NOT_START.md` | SPEC artifact (written by forensics SPEC mode earlier in this session). | new file |
| `Mingla_Artifacts/prompts/SPEC_ORCH-0853_BUSINESS_TICKET_CALENDAR_END_NOT_START.md` | SPEC dispatch (written by orchestrator earlier in this session). | new file |
| `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0853_BUSINESS_TICKET_CALENDAR_END_NOT_START.md` | This report. | new file |

**Not touched (pre-existing dirty in working tree, unrelated to ORCH-0853):**
- `app-mobile/src/components/activity/BusinessEventCalendarRow.tsx`
- `supabase/functions/ticket-confirmation-dispatch/index.ts`
- `supabase/migrations/20260606000000_orch_0842_ticket_pdf_storage.sql` (ORCH-0842 work)
- `app-mobile/src/services/ticketService.ts` (ORCH-0842 work)
- `app-mobile/src/components/activity/TicketPdfSheet.tsx` (ORCH-0842 work)
- `supabase/functions/ticket-pdf-fetch/` (ORCH-0842 work)
- `app-mobile/scripts/ci/orch-0842-regression-check.mjs` (ORCH-0842 work)
- `.github/scripts/strict-grep/i-ticket-pdf-*.mjs` (ORCH-0842 work)
- `app-mobile/package-lock.json` (ORCH-0842 dep adds — pre-session)

These are visible in `git status` but the commit for ORCH-0853 must be scoped to only the 11 files in the table above (per one-PR-per-CLOSE + don't-bundle rules).

---

## 2. Receipts — old vs new

### 2.1 `app-mobile/src/services/calendarService.ts`

**Interface (before — line 71-72 region):**
```ts
coverMediaUrl: string | null;
masterDateUtc: string | null;
timezone: string;
```

**Interface (after — line 80-87):**
```ts
coverMediaUrl: string | null;
masterDateUtc: string | null;
// ORCH-0853: ISO-8601 UTC end timestamp of the master event date.
// Sourced from `event_dates.end_at` where `is_master = true`. Active/Archive
// partition uses this; pre-0853 used `masterDateUtc` (start_at) only and
// archived in-progress events the moment they STARTED.
masterDateEndUtc: string | null;
timezone: string;
```

**Mapper (before — line 411 region):**
```ts
masterDateUtc: masterDate?.start_at ?? null,
timezone: event?.timezone ?? "UTC",
```

**Mapper (after — line 416-419):**
```ts
masterDateUtc: masterDate?.start_at ?? null,
// ORCH-0853: end-of-event timestamp used by consumer Calendar partition.
masterDateEndUtc: masterDate?.end_at ?? null,
timezone: event?.timezone ?? "UTC",
```

The `event_dates.end_at` column is already selected at line 328 (`event_dates!left ( id, start_at, end_at, is_master )`); the previous mapper simply discarded it. Type extraction at line 365 already declares `end_at: string | null` so no type-system change was needed.

### 2.2 `app-mobile/src/components/activity/CalendarTab.tsx`

**Partition useMemo (before — lines 371-390):**
```tsx
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

**Partition useMemo (after):**
```tsx
// ORCH-0853: partition business orders into active vs archive using
// EFFECTIVE END time (event_dates.end_at when present; start_at fallback
// when null — defensive). Mirrors the scheduled-card effectiveEnd logic
// at the useMemo above. Pre-fix this used start-only `masterDateUtc < now`
// and archived in-progress events the moment they STARTED — e.g. The
// Reckoning (10pm-to-3am) flipped to Archive at 10:01pm while still 5
// hours from ending. See I-CALENDAR-BUSINESS-TICKET-END-NOT-START.
// Sibling fix to ORCH-0850; this is the fifth surface that the systemic
// sweep's `scheduled_at` grep scope did not catch. Pending-payment orders
// always stay Active.
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

Semantic changes:
- Reads `masterDateEndUtc` first; falls back to `masterDateUtc` only when end is null/NaN.
- Pending-payment short-circuit preserved bit-for-bit.
- Orders with both timestamps null land in Active (`Number.isFinite(NaN) === false`, predicate short-circuits to else branch).
- Dependency array unchanged.

---

## 3. Verification

### 3.1 TypeScript
`npx tsc --noEmit` from repo root: **zero errors** matching `calendarService` or `CalendarTab`. Pre-existing `packages/phone-input/` errors are unrelated workspace drift.

### 3.2 Regression check (happy-path) — `orch-0853-regression-check.mjs`

**On fixed tree (HEAD):**
```
PASS  S-01 BusinessEventCalendarRow declares `masterDateEndUtc: string | null`
PASS  S-02 fetchUserBusinessEventOrders mapper propagates event_dates.end_at
PASS  S-03 event_dates select clause includes end_at (regression guard)
PASS  P-01 partition block defines `effectiveEndTs` (SPEC §3.5.1 canonical name)
PASS  P-02 partition reads `order.masterDateEndUtc` (end-of-event field)
PASS  P-03 partition computes end-with-start-fallback (Number.isFinite chain)
PASS  P-04 forbidden pre-fix predicate `ts < now` on bare masterDateUtc-derived var is GONE
PASS  P-05 pending-payment short-circuit preserved
PASS  P-06 partition still finalizes with effectiveEndTs < now comparison
PASS  G-01 scheduled-card `computeEntryEffectiveEnd` helper still present (ORCH-0850 preserved)

orch-0853-regression-check: all 10 checks PASSED.
```

### 3.3 Fails-on-revert proof

**Procedure:** `git stash push` of both touched files at commit `4f1bab8b31eaa42b60fe4f2eb13e13bebf9e984a` (pre-fix HEAD). Re-ran the regression check against the stashed-out (i.e., reverted) tree.

**Result — 8 of 10 checks FAILED on revert:**
```
FAIL  S-01 BusinessEventCalendarRow declares `masterDateEndUtc: string | null`
FAIL  S-02 fetchUserBusinessEventOrders mapper propagates event_dates.end_at
PASS  S-03 event_dates select clause includes end_at (regression guard)
FAIL  P-01 partition block defines `effectiveEndTs` (SPEC §3.5.1 canonical name)
FAIL  P-02 partition reads `order.masterDateEndUtc` (end-of-event field)
FAIL  P-03 partition computes end-with-start-fallback (Number.isFinite chain)
FAIL  P-04 forbidden pre-fix predicate `ts < now` on bare masterDateUtc-derived var is GONE
FAIL  P-05 pending-payment short-circuit preserved (regex partitionBlock anchor mismatch on pre-fix shape)
FAIL  P-06 partition still finalizes with effectiveEndTs < now comparison
PASS  G-01 scheduled-card `computeEntryEffectiveEnd` helper still present (ORCH-0850 preserved)

orch-0853-regression-check: 8 of 10 check(s) FAILED.
```

**Coverage:** the test catches reverts at both the service layer (S-01/S-02 — interface field + mapper line) AND the partition layer (P-01..P-04, P-06 — canonical variable names, end-with-fallback computation, forbidden pre-fix predicate, terminal compare). Even an attacker who only reverts the partition (keeping the service layer fix) would fail 5+ partition-layer checks. Even an attacker who only reverts the service layer would fail 2 service-layer checks plus P-02. The fix is fails-on-revert proven from multiple independent angles.

**Fix restoration:** stash popped successfully; all 10 checks pass on restored tree.

### 3.4 Strict-grep CI gate — `i-calendar-business-ticket-end-not-start.mjs`

**Self-test mode:**
```
$ node .github/scripts/strict-grep/i-calendar-business-ticket-end-not-start.mjs --self-test
i-calendar-business-ticket-end-not-start self-test PASSED
```
Validates: (a) `const ts = order.masterDateUtc ? ... : NaN; ... ts < now` multi-line regex matches the pre-fix fixture, (b) `Date.parse(order.masterDateUtc) < now` direct regex matches its fixture, (c) the end-based fix fixture does NOT match either forbidden pattern (false-positive guard).

**Live scan on fixed tree:**
```
$ node .github/scripts/strict-grep/i-calendar-business-ticket-end-not-start.mjs
i-calendar-business-ticket-end-not-start PASSED
```

### 3.5 git diff --stat (ORCH-0853-scoped paths only)

```
.github/scripts/strict-grep/i-calendar-business-ticket-end-not-start.mjs  | +175
.github/workflows/strict-grep-mingla-business.yml                         | +13
Mingla_Artifacts/INVARIANT_REGISTRY.md                                    | +18
Mingla_Artifacts/WORLD_MAP.md                                             |  +1/-1
Mingla_Artifacts/prompts/SPEC_ORCH-0853_BUSINESS_TICKET_CALENDAR_END_NOT_START.md  | new
Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0853_BUSINESS_TICKET_CALENDAR_END_NOT_START.md | new (this file)
Mingla_Artifacts/specs/SPEC_ORCH-0853_BUSINESS_TICKET_CALENDAR_END_NOT_START.md | new
app-mobile/package.json                                                   |  +1
app-mobile/scripts/ci/orch-0853-regression-check.mjs                      | +175 (new)
app-mobile/src/components/activity/CalendarTab.tsx                        |  +24/-15
app-mobile/src/services/calendarService.ts                                |  +7
```

Per I-PROPOSED-IMPL-DIFF-STAT-AT-CLOSE (ORCH-0850 close discovery): captured above.

---

## 4. SPEC success-criteria mapping

| SC | Status | Evidence |
|---|---|---|
| SC-1 (end_at > now → Active) | proven via mechanism | `effectiveEndTs = endTs ?? startTs ?? NaN`; when `endTs > now`, predicate `effectiveEndTs < now` is false → else branch → `active.push`. Independent sim live-fire deferred to tester. |
| SC-2 (end_at < now → Archive) | proven via mechanism | Same logic; `endTs < now` → archive branch. |
| SC-3 (pending → Active) | proven via mechanism | Pending short-circuit preserved at lines 376-378 of new useMemo. |
| SC-4 (both null → Active) | proven via mechanism | Both null → `effectiveEndTs = NaN` → `Number.isFinite(NaN) === false` → else branch → `active.push`. |
| SC-5 (live-fire sim repro of Reckoning scenario on iOS sim + Android emu) | **deferred to tester** | Source-only implementation; live-fire is Claude `mingla-tester` Phase 0.A gate per Prime Directive #7. |
| SC-6 (`masterDateEndUtc` present on every row when master `end_at` populated) | proven via mechanism | Mapper line `masterDateEndUtc: masterDate?.end_at ?? null` runs unconditionally for every row in the `.map()` return. |
| SC-7 (CI gate registered + passes on fixed + fails-on-revert) | proven | Self-test PASS, live PASS on fixed tree, workflow job wired at `strict-grep-mingla-business.yml`. Fails-on-revert proven via stash test in §3.3. |

---

## 5. Constitution compliance (14 rules — PASS/FAIL/N/A)

| # | Rule | Status | Notes |
|---|---|---|---|
| 1 | No dead taps | N/A | No new interactive elements. |
| 2 | One owner per truth | PASS | `BusinessEventCalendarRow` remains the single shape owner; React Query continues to own server state. |
| 3 | No silent failures | PASS | Mapper logs were unchanged; partition is pure. |
| 4 | One key per entity | PASS | `["businessEventOrders", userId]` unchanged. |
| 5 | Server state server-side | PASS | No Zustand touch. |
| 6 | Logout clears everything | PASS | No persistence change. |
| 7 | Label temporary | N/A | No `[TRANSITIONAL]` adds. |
| 8 | Subtract before adding | PASS | Replaced the buggy useMemo body — did not layer alongside. |
| 9 | No fabricated data | PASS | `end_at` is real DB data; fallback to `start_at` is documented, never `Date.now() + 24h` or any synthetic value. |
| 10 | Currency-aware | N/A | No money-display change. |
| 11 | One auth instance | N/A | No auth touch. |
| 12 | Validate at right time | PASS | Partition runs at render time against `Date.now()`; timestamps compared as UTC epoch ms. |
| 13 | Exclusion consistency | PASS | Generation (calendar service) and serving (CalendarTab partition) now agree on end-not-start. |
| 14 | Persisted-state startup | N/A | No persistence change. |

---

## 6. Out-of-scope confirmations

- No SQL, no migration, no `supabase db push`.
- No edge function deploy.
- No `mingla-business/`, `mingla-admin/`, `supabase/`, buyer-web touch.
- No refactor of `BusinessEventCalendarRow` beyond the single new field.
- No change to scheduled-card partition at `CalendarTab.tsx:254-270` (ORCH-0850 preserved).
- No change to React Query keys, realtime subscription, or polling fallback.
- No DIAG markers introduced (`grep -rn "\[ORCH-0853-DIAG\]"` returns zero).

---

## 7. Open follow-ups (for tester + orchestrator CLOSE)

| ID | Type | Who | Action |
|---|---|---|---|
| F-1 | Tester adversarial test | Claude `mingla-tester` | Write `app-mobile/scripts/ci/orch-0853-adversarial-check.mjs` per SPEC §6.1(b) — different angle from happy-path (malformed ISO, double-null, DST boundary, Y10K, corrupt `end_at < start_at`); capture fails-on-revert SHA. |
| F-2 | Live-fire sim repro | Claude `mingla-tester` | iOS sim + Android emu — verify SC-5 (The Reckoning scenario: paid order with `end_at > now`, `start_at < now` lands in Active accordion on both platforms). |
| F-3 | EAS OTA after CLOSE | Operator | `cd app-mobile && eas update --branch production --platform ios --message "ORCH-0853: business-event ticket end-not-start"`, then again with `--platform android`. JS-only change, no native dependency drift. |
| F-4 | Invariant flip | Orchestrator | At CLOSE, flip `I-CALENDAR-BUSINESS-TICKET-END-NOT-START` from DRAFT to ACTIVE. |
| F-5 | Process discovery follow-up | Orchestrator | Register META-ORCH-NEW [Systemic-sweep methodology: enumerate row types, not field names] per SPEC §11 D-1. |

---

## 8. Final verification — `git diff --stat HEAD` (ORCH-0853 paths only)

Already captured in §3.5. Pre-existing dirty files outside ORCH-0853 scope (ORCH-0842 work-in-progress, `package-lock.json` drift) are NOT included in the planned commit per one-PR-per-CLOSE + don't-bundle rules.
