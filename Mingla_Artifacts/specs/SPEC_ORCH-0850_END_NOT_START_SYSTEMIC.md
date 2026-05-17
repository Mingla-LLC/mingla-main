# SPEC — ORCH-0850 (REVISED) End-not-start parity across consumer Activity + business Hub Past tab + public brand page + ticket checkout

**Mode:** SPEC (no INVESTIGATE — root cause already proven across all four surfaces)
**Skill:** Claude `mingla-forensics`
**Date:** 2026-05-15
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Investigation:** [`reports/INVESTIGATION_ORCH-0850_END_NOT_START_SYSTEMIC.md`](../reports/INVESTIGATION_ORCH-0850_END_NOT_START_SYSTEMIC.md)
**Supersedes:** `specs/SPEC_ORCH-0850_CALENDAR_ARCHIVE_USES_END_NOT_START.md` (consumer-only). The prior spec is folded in as §3.5 below; the rest is new business-side scope discovered after the operator reported additional broken surfaces.
**Bundle authorization:** Operator pre-approved bundling four surfaces per Working-Branch Discipline rule 5 narrow exception ("we'll do them together" — operator directive 2026-05-15 selecting Option A from forensics scope-decision turn).
**Confidence:** High — investigation `root cause proven` across all four surfaces with six-field evidence + live Supabase Management API probe.

---

## 1. Summary (layman first)

Four surfaces show "Another Tested Event" (3am-9pm Raleigh, currently still happening) as past:

1. **Consumer Activity → Calendar tab** — entry sits in Archive instead of Active.
2. **Business Hub → Events → Past tab** — brand sees their own live event listed under Past.
3. **Business public brand page → Past tab** — buyers visiting the brand profile see the live event under Past AND missing from Upcoming.
4. **Business ticket checkout** — buyer taps "Buy tickets" → sees "this event isn't taking new tickets" empty state. **S0 revenue impact**.

All four share a root-cause class (asking "did it start yet?" instead of "is it over yet?") with two distinct shapes:
- **Business shape (surfaces 2-4):** local copies of past-decision logic in `mingla-business` that use `new Date(event.date).getTime()` — parses `LiveEvent.date` (a `YYYY-MM-DD` string) as UTC midnight, then adds a fixed +24h window. Returns "past" for any US-Eastern event after ~8pm local on its start day. ORCH-0828 [Consumer Discover timezone + sheet bugs] fixed the canonical helper at `eventLifecycle.ts:deriveLiveStatus` but missed these three sites — each has its own local copy.
- **Consumer shape (surface 1):** different shape, same class. `CalendarTab.tsx:197` uses `scheduled_at < now` (start-only) on `calendar_entries` rows (which don't have an FK to `events` so end_at can't be projected).

This SPEC fixes all four atomically: single-source-of-truth canonical helpers in `eventLifecycle.ts` + `eventDateMath.ts`, delete the three local business copies and route through the canonical helper, plus the consumer-side `effectiveEnd = scheduled_at + duration_minutes` fix from the prior SPEC_ORCH-0850. One PR, one CLOSE, single revert blast radius.

---

## 2. Scope, Non-Goals, Assumptions

### 2.1 Scope (locked, 4 sub-specs)

**§3.1 — Data hydration: add `masterEndAtUtc` to LiveEvent shape**
- `mingla-business/src/utils/eventDateMath.ts` — add sibling helper `computeMasterEndAtUtc(event: LiveEvent): string | null` mirroring the existing `computeMasterStartAtUtc`.
- All sites that currently populate `event.masterStartAtUtc` (via hydration from `event_dates.start_at`) MUST also populate `event.masterEndAtUtc` from `event_dates.end_at`. Implementor enumerates every hit in the implementation report.
- LiveEvent interface gets `masterEndAtUtc?: string | null` typed as an optional addendum field, mirroring the current `masterStartAtUtc` pattern (per eventDateMath.ts:121 — typed as `(event as LiveEvent & { masterStartAtUtc?: string | null })` not on the canonical interface). Keeps backward-compat with persisted Zustand state per `feedback_zustand_persist_no_server_snapshots.md` (allowed: this is an immutable property of event identity, not mutable list data).

**§3.2 — Canonical helper extension: `isEventPast(event, masterEndAtUtc)`**
- `mingla-business/src/utils/eventLifecycle.ts` — add new exported function `isEventPast(event: LiveEvent, masterEndAtUtc: string | null): boolean` returning true iff the event is genuinely past (cancelled, status='ended', endedAt set, OR `now > masterEndAtUtc`).
- Existing `deriveLiveStatus(event, masterStartAtUtc)` is UNCHANGED (already correct post-ORCH-0828 for the live/upcoming/past trichotomy on the start-instant axis). The new `isEventPast` is the canonical past-only check used by the three business surfaces that don't need the full trichotomy.

**§3.3 — Hub Past tab fix (RC #1)**
- `mingla-business/app/(tabs)/hub/events.tsx` — DELETE the local `deriveLiveStatus` at lines 87-99. Import the canonical one from `../../../src/utils/eventLifecycle`. Pass `computeMasterStartAtUtc(event)` as the second arg at the callsite (line 180). The Past pill / filter is unaffected by `masterEndAtUtc` because the trichotomy uses start-instant for the live-window math; the bug here is the BROKEN local `new Date(event.date)` parse, not the start-vs-end question.

**§3.4 — Checkout `computeIsPast` + Public brand page `pastEvents`/`upcomingEvents` (RC #2, RC #3)**
- `mingla-business/app/checkout/[eventId]/index.tsx:59-67` — replace `computeIsPast` body with `isEventPast(event, computeMasterEndAtUtc(event))`. Inline the existing import.
- `mingla-business/src/components/brand/PublicBrandPage.tsx:125-148` — replace both `upcomingEvents` and `pastEvents` memo filter bodies. Upcoming = `!isEventPast(event, masterEndAtUtc) && status !== 'cancelled'`. Past = `isEventPast(event, masterEndAtUtc) || status === 'ended'`.

**§3.5 — Consumer Activity CalendarTab (RC #4 — folded in from prior SPEC)**
- `app-mobile/src/components/activity/CalendarTab.tsx:184-207` — bucket predicate via `effectiveEnd = scheduled_at + (duration_minutes ?? 120 min)` per the prior SPEC_ORCH-0850_CALENDAR_ARCHIVE_USES_END_NOT_START.md §3.2.1-3.2.2. Implementor follows the exact helper + predicate spec from the prior doc; nothing new.

**§3.6 — Invariants (2 new, 1 strengthened)**
- New `I-PROPOSED-EVENT-LIFECYCLE-SINGLE-HELPER`: every past/upcoming/live decision in `mingla-business/` MUST route through `eventLifecycle.ts`. Local copies are forbidden.
- New `I-PROPOSED-CONSUMER-CALENDAR-USES-END-NOT-START`: per prior SPEC (folded in).
- Strengthen `I-PROPOSED-LIVE-STATUS-UTC-INPUT` (ACTIVE post-ORCH-0828): existing text already forbids `new Date(event.date)` for live-status math; this SPEC adds an addendum clause covering past-decision math too.

**§3.7 — CI gate strengthening**
- New `.github/scripts/strict-grep/i-event-lifecycle-single-helper.mjs` — scans `mingla-business/` for `new Date\(\w+\.date\)` (variable form, not just literals) outside `eventLifecycle.ts` / `eventDateMath.ts`. Catches the bug pattern that ORCH-0828's literal-only gate missed.
- New `.github/scripts/strict-grep/i-consumer-calendar-uses-end-not-start.mjs` — per prior SPEC.
- Both registered as separate jobs in `.github/workflows/strict-grep-mingla-business.yml`.

**§3.8 — Tests (Step 0.5 gate per ORCH-0840)**
- Four happy-path test files (one per surface), implementor-written.
- Four adversarial test files, tester-written.
- All append-only, fails-on-revert proven.

### 2.2 Non-Goals (explicitly out of scope)

NG-1. **No DB migration.** `event_dates.end_at` already exists. No schema change.

NG-2. **No edge-function change.** `discover-merged-events` already correct per ORCH-0845.

NG-3. **No `events.status='ended'` auto-transition.** Stays operator-set only per ORCH-0845 close notes.

NG-4. **No mingla-business `accountDeletionPreview.ts` change.** Already routes through canonical helper (proven correct post-ORCH-0828). UNCHANGED.

NG-5. **No `brandEventSummary.ts` / `event/[id]/index.tsx` / `event/[id]/reconciliation.tsx` change.** Same — all three already route through canonical helper. UNCHANGED.

NG-6. **No `useBusinessEventOrders` / `BusinessEventCalendarRow` Tickets-accordion past split** on consumer Activity. Out of scope per prior SPEC NG-3; registered as §9 followup.

NG-7. **No time-ticker / setInterval.** Per prior SPEC NG-6. React Query refresh + window-focus + pull-to-refresh are the reconciliation cadence on all surfaces.

NG-8. **No PublicBrandPage Upcoming-tab "today and forward" UX redesign.** Fix the bug (use canonical helper), don't re-litigate whether the tab should include today-only-future events. Per discoveries §9.4 in investigation.

NG-9. **No retroactive sweep of mingla-admin/ for the same pattern.** Admin doesn't render past/upcoming buckets to end users for events; only internal stats screens use status counts derived from canonical `events.status`. If a future audit finds an admin past/upcoming bucket, file a new ORCH.

### 2.3 Assumptions

A-1. `event_dates.end_at` is `NOT NULL` with `CHECK (end_at > start_at)`. Verified live 2026-05-15.

A-2. Every `events` row with `status IN ('scheduled','live')` has at least one master `event_dates` row per `I-PROPOSED-AX EVENT_HAS_MASTER_DATE` (ORCH-0792) + trigger `biz_enforce_event_has_master_date`. So `computeMasterEndAtUtc` returns a non-null string for every legitimate row.

A-3. The hydration sites that currently populate `masterStartAtUtc` from a Supabase query also have access to `event_dates.end_at` in the same query — if not, the implementor extends the SELECT to project it. Implementor enumerates and confirms.

A-4. `LiveEvent.endedAt: string | null` (line 155 of liveEventStore.ts) is operator-set, not an automatic mirror of `event_dates.end_at`. Confirmed via ORCH-0845 close notes. The new `isEventPast` checks `endedAt !== null` as a short-circuit AND `now > masterEndAtUtc` as the time-based check — both. Per `feedback_no_fabricated_data` the user-visible past state must match reality regardless of which signal fired.

A-5. The 120-minute default for `app-mobile` `calendar_entries.duration_minutes ?? 120` is established prior art across four same-codebase sites. Per prior SPEC A-2; not re-litigated here.

---

## 3. Per-layer specification

### 3.1 Data hydration — `mingla-business/src/utils/eventDateMath.ts`

#### 3.1.1 New function `computeMasterEndAtUtc`

Add after the existing `computeMasterStartAtUtc` (line 118 onward). Mirror the same shape: prefer the direct hydrated field, fall back to `event.date + event.endsAt` parsed in `event.timezone`, fall back to `event.date + "T23:59:59"` parsed in `event.timezone` (event-day end), fall back to null.

```ts
/**
 * Compute the master END instant of a LiveEvent as a UTC ISO timestamp.
 *
 * Sources, in order of preference:
 *   1. `event.masterEndAtUtc` if hydrated from `event_dates.end_at`
 *      (preferred — exact authoritative value)
 *   2. `event.date + event.endsAt` parsed in `event.timezone`
 *      (best-effort from display fields when hydrated field absent)
 *   3. `event.date + "T23:59:59"` parsed in `event.timezone` (last-resort
 *      fallback; assumes event runs until end of its local calendar day)
 *
 * Returns null when the event has no date at all (unscheduled draft) or
 * when timezone parsing fails. Callers treat null as "unknown — do not
 * declare past on the time-axis alone" (the canonical helper isEventPast
 * separately short-circuits on status='ended' / endedAt !== null).
 *
 * Mirrors I-PROPOSED-LIVE-STATUS-UTC-INPUT for the end-instant case.
 * Established by ORCH-0850 [End-not-start parity systemic].
 */
export function computeMasterEndAtUtc(event: LiveEvent): string | null {
  const direct = (event as LiveEvent & { masterEndAtUtc?: string | null })
    .masterEndAtUtc;
  if (typeof direct === "string" && direct.length > 0) {
    return direct;
  }
  if (event.date === null) return null;
  const tz = event.timezone || "UTC";
  if (typeof event.endsAt === "string" && event.endsAt.length > 0) {
    const endsTime = event.endsAt.length === 5 ? `${event.endsAt}:00` : event.endsAt;
    const candidate = parseLocalToUtcIso(`${event.date}T${endsTime}`, tz);
    if (candidate !== null) return candidate;
  }
  return parseLocalToUtcIso(`${event.date}T23:59:59`, tz);
}
```

(Implementor reuses the existing private `parseLocalToUtcIso` / `getTzOffsetMs` helpers in the same file — DO NOT duplicate the DST-aware parsing logic.)

#### 3.1.2 Hydration sites

Grep `mingla-business/` for every site that sets `masterStartAtUtc` on a LiveEvent (the implementor will find these via `grep -rn "masterStartAtUtc" mingla-business/src/`). Every such site MUST also set `masterEndAtUtc` from the corresponding `event_dates.end_at`. If the SELECT does not currently project `end_at`, extend the SELECT. Enumerate every hit in the implementation report.

Per RLS — `event_dates.end_at` is on the same row as `start_at` (already-readable by every caller); no new RLS surface.

### 3.2 Canonical helper — `mingla-business/src/utils/eventLifecycle.ts`

#### 3.2.1 New function `isEventPast`

Add as a sibling export after `deriveLiveStatus`. Required body:

```ts
/**
 * Single-source-of-truth past check. Returns true iff the event is genuinely
 * over (cancelled, operator-ended, endedAt set, OR master end_at has passed).
 *
 * Replaces the local copies at:
 *   - mingla-business/app/(tabs)/hub/events.tsx (Past pill via deriveLiveStatus)
 *   - mingla-business/app/checkout/[eventId]/index.tsx (computeIsPast → SOLD-OUT empty state)
 *   - mingla-business/src/components/brand/PublicBrandPage.tsx (Past tab memo)
 *
 * Pair with deriveLiveStatus when the caller needs the live/upcoming/past
 * trichotomy. Use isEventPast alone when the caller only needs the past gate
 * (e.g., "should we hide ticket-purchase CTA?").
 *
 * Established by ORCH-0850 [End-not-start parity systemic]. Enforces
 * I-PROPOSED-EVENT-LIFECYCLE-SINGLE-HELPER + I-PROPOSED-LIVE-STATUS-UTC-INPUT.
 */
export const isEventPast = (
  event: LiveEvent,
  masterEndAtUtc: string | null,
): boolean => {
  if (event.status === "cancelled" || event.status === "ended") return true;
  if (event.endedAt !== null) return true;
  if (masterEndAtUtc === null) return false;
  const endTime = Date.parse(masterEndAtUtc);
  if (!Number.isFinite(endTime)) return false;
  return Date.now() > endTime;
};
```

#### 3.2.2 `deriveLiveStatus` extension (optional, decision needed)

The current `deriveLiveStatus(event, masterStartAtUtc)` returns `"past"` based on `start + LIVE_WINDOW_AFTER_MS`. This is the LIVE-window upper bound, not the actual event end — works correctly for the trichotomy as long as `LIVE_WINDOW_AFTER_MS` is set conservatively. The Hub Past tab fix (§3.3) routes through this function. **Decision: leave `deriveLiveStatus` UNCHANGED.** The Hub fix only needs the broken local copy deleted; the canonical version works because its `LIVE_WINDOW_AFTER_MS` is a proper UTC-instant offset (not a date-only-string parse).

If a future need arises for `deriveLiveStatus` to be more precise about the past boundary (e.g., using `masterEndAtUtc` directly instead of `start + window`), file a follow-up ORCH. NOT in this scope.

### 3.3 Hub Past tab — `mingla-business/app/(tabs)/hub/events.tsx`

#### 3.3.1 Delete the local `deriveLiveStatus`

Lines 87-99 — DELETE in full. Replace with imports at the top of the file (sibling to the existing imports around line 70):

```ts
import { deriveLiveStatus } from "../../../src/utils/eventLifecycle";
import { computeMasterStartAtUtc } from "../../../src/utils/eventDateMath";
```

#### 3.3.2 Update the callsite at line 180

```ts
return liveEvents.map((e) => ({
  event: e,
  status: deriveLiveStatus(e, computeMasterStartAtUtc(e)),
}));
```

#### 3.3.3 No other change required

The Past pill counter (line 189), Past sort logic (line 251), and Past pill label (line 277) all consume `status === "past"` from the map output — UNCHANGED.

### 3.4 Checkout + Public brand page

#### 3.4.1 Checkout — `mingla-business/app/checkout/[eventId]/index.tsx`

Lines 59-67 — DELETE the local `computeIsPast` function in full. Add imports at the top:

```ts
import { isEventPast } from "../../../src/utils/eventLifecycle";
import { computeMasterEndAtUtc } from "../../../src/utils/eventDateMath";
```

Replace the callsite at line 174:

```ts
const isPast = isEventPast(event, computeMasterEndAtUtc(event));
```

Line 189 (`if (isPast || visibleTickets.length === 0 || allSoldOut || allUnavailable)`) UNCHANGED. The truth-shape of `isPast` is the same boolean.

#### 3.4.2 Public brand page — `mingla-business/src/components/brand/PublicBrandPage.tsx`

Lines 125-148 — REPLACE both memos. Required new body:

```ts
const upcomingEvents = useMemo<LiveEvent[]>(() => {
  return events
    .filter((e) => !isEventPast(e, computeMasterEndAtUtc(e)))
    .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
}, [events]);

const pastEvents = useMemo<LiveEvent[]>(() => {
  return events
    .filter((e) => isEventPast(e, computeMasterEndAtUtc(e)))
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))
    .slice(0, PAST_EVENT_CAP);
}, [events]);
```

Add the imports at the top of the file:

```ts
import { isEventPast } from "../../utils/eventLifecycle";
import { computeMasterEndAtUtc } from "../../utils/eventDateMath";
```

Note semantics change: previously the `+ 24h cutoff` was a band-aid that included "today's events" in upcoming even after their date had passed UTC-midnight (because the band-aid offset partially compensated for the UTC-midnight bug). After the fix, an event is in `upcomingEvents` until its actual `end_at` (or local-end-of-day fallback per `computeMasterEndAtUtc`), then moves to `pastEvents` cleanly. No 24h grace window — the event itself defines its window.

### 3.5 Consumer Activity CalendarTab — `app-mobile/src/components/activity/CalendarTab.tsx`

Per prior SPEC_ORCH-0850_CALENDAR_ARCHIVE_USES_END_NOT_START.md §3.2.1, §3.2.2, §3.2.3, §3.2.4. Folded in by reference. Implementor follows that section verbatim. Key points:

- Add `DEFAULT_CALENDAR_DURATION_MIN = 120` constant + `computeEntryEffectiveEnd(entry)` helper between lines 97 and 99.
- Replace lines 184-207 useMemo per prior SPEC §3.2.2.
- All hard rules from prior SPEC §3.2.4 (no time-ticker, no shared util extraction, no BusinessEventCalendarRow touch) preserved.
- ORCH-0848 merge note: working tree currently has uncommitted edits at CalendarTab.tsx:117-120 and 1751-1796 from the Tickets-accordion work. Implementor confirms those edits are untouched by this fix.

### 3.6 Invariants

#### 3.6.1 New invariants — add to `Mingla_Artifacts/INVARIANT_REGISTRY.md`

**I-PROPOSED-EVENT-LIFECYCLE-SINGLE-HELPER.** Add after the existing `I-PROPOSED-LIVE-STATUS-UTC-INPUT` entry. Exact text:

> **I-PROPOSED-EVENT-LIFECYCLE-SINGLE-HELPER.** Every past/upcoming/live decision in `mingla-business/` MUST route through the canonical helpers in `mingla-business/src/utils/eventLifecycle.ts` (`deriveLiveStatus` for the trichotomy, `isEventPast` for the past-gate). Local re-implementations are FORBIDDEN. Date instants flowing into these helpers MUST be UTC ISO timestamps produced by `mingla-business/src/utils/eventDateMath.ts` (`computeMasterStartAtUtc`, `computeMasterEndAtUtc`) — never `new Date(event.date)` or equivalent date-only-string parses. Established by ORCH-0850 [End-not-start parity systemic] after ORCH-0828 [Consumer Discover timezone + sheet bugs] fixed the canonical helper but left three local copies broken at: `app/(tabs)/hub/events.tsx` (deleted in ORCH-0850), `app/checkout/[eventId]/index.tsx` (deleted in ORCH-0850), `src/components/brand/PublicBrandPage.tsx` (inlined memos replaced in ORCH-0850). Enforced by CI gate `.github/scripts/strict-grep/i-event-lifecycle-single-helper.mjs`.

**I-PROPOSED-CONSUMER-CALENDAR-USES-END-NOT-START.** Per prior SPEC §6.2. Folded in verbatim.

#### 3.6.2 Strengthened — `I-PROPOSED-LIVE-STATUS-UTC-INPUT`

Existing entry already forbids `new Date(event.date)` for live-status math. Append clause: "The same prohibition applies to past-decision math and any other event-time question. The CI gate strengthening from ORCH-0850 catches the variable form `new Date(<var>.date)`, not just the literal `new Date(\"YYYY-MM-DD\")` form."

### 3.7 CI gates

#### 3.7.1 New gate — `.github/scripts/strict-grep/i-event-lifecycle-single-helper.mjs`

**Detection rule:** Scan every `.ts` / `.tsx` file under `mingla-business/src/` and `mingla-business/app/` excluding `**/__tests__/**`. For each non-comment line, FAIL if any of the following patterns match outside the canonical helper files (`eventLifecycle.ts`, `eventDateMath.ts`):

- `new Date\(\s*\w+\.date\s*\)` (variable date-only parse — the bug pattern that hit RC #1, #2, #3)
- `new Date\(\s*\w+\.\w+Date\s*\)` (e.g., `event.startDate`, `event.endDate` — defensive catch)
- A local function named `deriveLiveStatus`, `computeIsPast`, `isEventPast`, `computeIsEnded` OUTSIDE the canonical helper file (presence-check for local re-implementations)

**Whitelist:** `// SPEC ORCH-0850 OK:` comment on the line exempts it.

**Negative-control rule:** Self-test mode (`--self-test` flag) re-runs against an inlined fixture `const x = new Date(event.date)` and exits 1 if the regex does NOT match — proves the gate isn't a no-op.

**Reference pattern:** model on `.github/scripts/strict-grep/i-discover-excludes-ended-master-date.mjs` (multi-file regex scan with comment exclusion).

**Exit codes:** 0 / 1 / 2 per the ORCH-0845 gate convention.

#### 3.7.2 New gate — `.github/scripts/strict-grep/i-consumer-calendar-uses-end-not-start.mjs`

Per prior SPEC §7. Folded in verbatim.

#### 3.7.3 Workflow registration

`.github/workflows/strict-grep-mingla-business.yml` — register BOTH new gates as separate jobs per `feedback_strict_grep_registry_pattern.md` (one script + one job per gate; do NOT combine).

### 3.8 Test contract (Step 0.5 gate per ORCH-0840)

Four surfaces → four happy-path tests + four adversarial tests. All real paths, all append-only, all fails-on-revert verified.

#### 3.8.1 Implementor-written happy-path tests (S-8a × 4)

**File 1 (RC #1 — Hub):** `mingla-business/app/(tabs)/hub/__tests__/events.pastTab.test.tsx`
- T-01: in-progress event (start 3am EDT, end 9pm EDT) at simulated time 8:10pm Raleigh → status === "upcoming" or "live" (per LIVE_WINDOW), NOT "past"
- T-02: ended event (end 6h ago) → status === "past"
- T-03: future event (start tomorrow) → status === "upcoming"
- T-04: cancelled event → status === "past" (short-circuit)

**File 2 (RC #2 — Checkout):** `mingla-business/app/checkout/[eventId]/__tests__/computeIsPast.test.tsx`
- T-05: in-progress event → isPast === false → ticket-selection UI rendered, NOT empty state
- T-06: ended event → isPast === true → empty state rendered
- T-07: cancelled event → isPast === true (short-circuit)

**File 3 (RC #3 — Public brand page):** `mingla-business/src/components/brand/__tests__/PublicBrandPage.pastEvents.test.tsx`
- T-08: in-progress event in Upcoming memo, NOT Past memo
- T-09: ended event in Past memo (capped at PAST_EVENT_CAP), NOT Upcoming
- T-10: PAST_EVENT_CAP slice still applied

**File 4 (RC #4 — Consumer Activity):** `app-mobile/src/components/activity/__tests__/calendarTab.archivePartition.test.tsx`
- Per prior SPEC §8.1 verbatim. Six `it` blocks.

**Fails-on-revert proof:** implementor records a real revert+restore commit hash for the bug-exercise test in each file (T-01, T-05, T-08, prior-SPEC T-01).

#### 3.8.2 Tester-written adversarial tests (S-8b × 4)

One per surface, attacking different angles than the happy-path:

**File 1 adversarial:** `mingla-business/app/(tabs)/hub/__tests__/events.pastTab.adversarial.test.tsx`
- DST boundary (March/November)
- Event with `endedAt !== null` but `masterEndAtUtc` is null (short-circuit must win)
- Event with `cancelled` status but `endedAt === null`
- Event with malformed `event.date` (e.g., empty string)

**File 2 adversarial:** `mingla-business/app/checkout/[eventId]/__tests__/computeIsPast.adversarial.test.tsx`
- Boundary equality: end_at exactly equal to now (must NOT be past — `>` not `>=`)
- Boundary 1ms after: must be past
- Multi-date event where only non-master date is ended (must use master, not first row)
- Event where `masterEndAtUtc` is missing — falls back to `event.date + event.endsAt + tz`

**File 3 adversarial:** `mingla-business/src/components/brand/__tests__/PublicBrandPage.pastEvents.adversarial.test.tsx`
- Brand with > PAST_EVENT_CAP past events: order preserved (newest first), cap holds
- Event with null `event.date` (unscheduled drafts shouldn't appear here, but if they do, behavior must be deterministic — drop, NOT crash)
- Event with cancelled status: in Past per RC #3 §3.4.2 spec, NOT Upcoming

**File 4 adversarial:** `app-mobile/src/components/activity/__tests__/calendarTab.archivePartition.adversarial.test.tsx`
- Per prior SPEC §8.2 verbatim. Four-cluster adversarial vectors.

**Fails-on-revert proof:** tester records revert+restore hash for the bug-exercise case in each adversarial file. Each adversarial file must break ≥ 1 test on §3.X revert, distinct angle from the happy-path.

---

## 4. Five-truth-layer audit

| Layer | Current | After spec |
|---|---|---|
| Docs | Investigation report + ORCH-0828 spec partially-completed; this SPEC closes the gap | Updated invariant entries + this SPEC are canonical |
| Schema | `event_dates.end_at` already authoritative (timestamptz NOT NULL CHECK) | Unchanged |
| Code | 3 local copies of broken past-decision + 1 consumer-side wrong predicate | All 4 fixed; canonical helpers expanded with `isEventPast` + `computeMasterEndAtUtc` |
| Runtime | LiveEvent state hydration in mingla-business currently does NOT carry `masterEndAtUtc`; helper fallbacks must cover that gap until hydration sites populate it | Hydration sites updated AND fallback path covers persisted older state |
| Data | Live "Another Tested Event" row correct + all event_dates correct | Unchanged |

---

## 5. Solo + collab parity

| Site | In scope? | Note |
|---|---|---|
| Consumer CalendarTab | Yes — solo+collab entries pass through one useMemo (entry.source field) | §3.5 |
| Mingla-business is single-user surfaces (brand-side); collab semantics N/A | — | — |
| SavedTab.tsx:275 ("upcoming" filter on dateAdded) | No — different question (save timestamp, not scheduled time) per prior SPEC §5 | unchanged |
| MultiDayCalendar.tsx:108 ("date in past" for picker disable) | No — different question (can user pick this date) | unchanged |

---

## 6. Hard guards (implementor cannot violate)

- Do NOT touch `accountDeletionPreview.ts`, `brandEventSummary.ts`, `event/[id]/index.tsx`, `event/[id]/reconciliation.tsx`. All four already route through canonical helper.
- Do NOT touch `BusinessEventCalendarRow` / `useBusinessEventOrders` / Tickets accordion in CalendarTab.tsx (lines 1751-1796). Registered as §9 followup.
- Do NOT touch `events.status` value or any auto-transition logic. Per NG-3.
- Do NOT add any DB migration. Per NG-1.
- Do NOT add or modify any edge function. Per NG-2.
- Do NOT add a setInterval / time-ticker on any surface. Per NG-7.
- Do NOT extract `computeEntryEffectiveEnd` into a shared util module (consumer side); keep co-located per prior SPEC §3.2.4.
- Do NOT change the semantics of `deriveLiveStatus` (start-based trichotomy). The new `isEventPast` is additive. Per §3.2.2.
- Do NOT change ticket checkout copy ("not taking new tickets" or whatever the empty state actually says) — fix the predicate; the copy is correct for actually-past events. UX redesign is its own concern.
- Do NOT publish the EAS OTA or deploy edge functions. Those are orchestrator+operator steps post-tester-PASS.

---

## 7. Success criteria

| # | Criterion | Verification | Layer |
|---|---|---|---|
| SC-01 | Hub Past tab: in-progress event NOT in Past list | Jest §3.8.1 File 1 T-01 + operator live-fire on dev build | Component |
| SC-02 | Checkout: in-progress event shows ticket-selection UI, NOT empty state | Jest §3.8.1 File 2 T-05 + operator live-fire (tap Buy tickets on "Another Tested Event") | Component |
| SC-03 | Public brand page: in-progress event in Upcoming, NOT Past | Jest §3.8.1 File 3 T-08 + visit brand profile in browser | Component |
| SC-04 | Consumer Activity Calendar: in-progress entry in Active, NOT Archive | Jest prior-SPEC T-01 + operator live-fire | Component |
| SC-05 | Discover/Activity/Business parity: "Another Tested Event" visible AND active in ALL four surfaces simultaneously at 8:10pm Raleigh local | Operator manual smoke across the four surfaces, screenshots in QA report | Cross-surface |
| SC-06 | All four CI gates green on head; each gate fails 1 on synthetic revert; self-test exits 1 on intentional broken regex | Implementor captures all 12 outcomes (4 gates × 3 states) | CI |
| SC-07 | `git diff Seth...HEAD` files-changed list matches the scope (see §11 for the exact list); NO migration, NO edge function, NO mingla-admin | git diff review at orchestrator REVIEW | Scope |
| SC-08 | TypeScript strict mode: `cd mingla-business && npx tsc --noEmit && cd app-mobile && npx tsc --noEmit` both exit 0 | Implementor captures both outputs | Type |
| SC-09 | NO local function named `deriveLiveStatus` / `computeIsPast` / `isEventPast` exists outside `eventLifecycle.ts` in mingla-business | strict-grep gate §3.7.1 enforces; implementor confirms via post-fix grep | Architecture |
| SC-10 | LiveEvent shape has `masterEndAtUtc?: string | null` documented in JSDoc on the addendum-field pattern matching `masterStartAtUtc` | Code review of `liveEventStore.ts` and `eventDateMath.ts` | Type |
| SC-11 | All eight regression tests pass (4 happy + 4 adversarial); fails-on-revert proven for each surface | Implementor + tester reports | Tests |
| SC-12 | Operator post-deploy smoke: live event currently broken on all 4 surfaces becomes correct on all 4 surfaces after EAS OTA + (no edge deploy needed) | Operator confirmation | Live-fire |

---

## 8. Implementation order (binding)

1. Pre-flight: `git status` clean except for ORCH-0848 edits at CalendarTab.tsx:117-120 / 1751-1796. Confirm working tree state.
2. Pre-flight grep: enumerate ALL hydration sites populating `masterStartAtUtc` in mingla-business. Document the list in implementation report.
3. Add `computeMasterEndAtUtc` to `eventDateMath.ts` per §3.1.1. Run `npx tsc --noEmit` — must pass.
4. Update hydration sites to populate `masterEndAtUtc` from `event_dates.end_at`. Same list as step 2. Run tsc again.
5. Add `isEventPast` to `eventLifecycle.ts` per §3.2.1. Run tsc.
6. Apply §3.3 Hub fix (delete local + import canonical). Run tsc.
7. Apply §3.4.1 Checkout fix. Run tsc.
8. Apply §3.4.2 Public brand page fix. Run tsc.
9. Apply §3.5 Consumer Activity fix per prior SPEC §11 steps 2-3 verbatim. Run tsc on app-mobile.
10. Write four happy-path Jest test files per §3.8.1. Run `yarn test` in both apps. All passing.
11. For each happy-path file, perform revert+restore on the §3 fix that file exercises; capture FAIL output + commit hashes; restore; record in implementation report as `fails-on-revert verified at <revert-hash>; restored at <restore-hash>` per file.
12. Add `I-PROPOSED-EVENT-LIFECYCLE-SINGLE-HELPER` + `I-PROPOSED-CONSUMER-CALENDAR-USES-END-NOT-START` to `INVARIANT_REGISTRY.md` per §3.6. Append strengthening clause to `I-PROPOSED-LIVE-STATUS-UTC-INPUT`.
13. Create both CI gates per §3.7.1 + §3.7.2. Run each: head exit 0; `--self-test` exit 0; synthetic revert exit 1. Capture all six outcomes.
14. Register both new jobs in `.github/workflows/strict-grep-mingla-business.yml` per §3.7.3.
15. Run ALL existing strict-grep gates locally to confirm no regressions.
16. Write `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0850_END_NOT_START_SYSTEMIC.md` with: old→new diff receipts for every changed file, hydration-site enumeration, test output captures, gate output captures, fails-on-revert proofs (4 per surface), files-changed list matching §11 SC-07 exactly.

Tester writes the four adversarial test files per §3.8.2 AFTER implementor returns, NOT before.

**Deploy notes:** Client-only changes across `mingla-business` + `app-mobile`. NO `supabase db push`. NO edge-function deploy. Two-platform EAS Update OTA per `feedback_eas_update_no_web.md` after tester PASS (orchestrator+operator step):

```bash
cd app-mobile && eas update --branch production --platform ios --message "ORCH-0850: end-not-start parity"
cd app-mobile && eas update --branch production --platform android --message "ORCH-0850: end-not-start parity"
cd mingla-business && eas update --branch production --platform ios --message "ORCH-0850: end-not-start parity"
cd mingla-business && eas update --branch production --platform android --message "ORCH-0850: end-not-start parity"
```

(Four invocations total — two apps × two platforms. Per memory: never combine platforms with comma, never use `--platform all` due to web bundle failures.)

---

## 9. Regression prevention

R-1. CI gate `i-event-lifecycle-single-helper.mjs` blocks `new Date(<var>.date)` outside canonical helper files AND blocks local function names that re-implement past/live decisions. Forces every future developer to either route through the canonical helper or open an ORCH to extend it.

R-2. CI gate `i-consumer-calendar-uses-end-not-start.mjs` per prior SPEC §7.

R-3. Eight regression tests (4 happy + 4 adversarial) all append-only per ORCH-0840 [Regression-test enforcement + append-only CI]. Cannot be deleted without `[TEST-MOD-APPROVED ORCH-NNNN]`.

R-4. Invariant `I-PROPOSED-EVENT-LIFECYCLE-SINGLE-HELPER` is a public registry entry. Phase-0 ingest of any future Hub / Brand / Checkout / past-decision ORCH MUST check the registry and inherit the contract.

R-5. ORCH-0828 close gap discovered in §9.1 of investigation: implementation report MUST list every grep result for `masterStartAtUtc` and confirm parity-update for `masterEndAtUtc` — this catches the next "missed callsite" before close, not after.

---

## 10. Discoveries for orchestrator (followups; NOT in this ORCH)

- §9.1 from investigation: ORCH-0828 close was incomplete. Worth a META-ORCH or META_LEARNING entry codifying "spec author must require codebase-wide grep evidence as a close gate."
- §9.2 from investigation: this fix STOPS THE BLEEDING on revenue. Worth quantifying tickets-lost-to-bug post-fix via Mixpanel or order-attempt funnel.
- §9.3, §9.4: deferred.
- BusinessEvent Tickets-accordion past split on consumer Activity (per prior SPEC §9.1). HIGH-VALUE future ORCH.
- SavedTab "upcoming" filter audit (per prior SPEC §9.2). LOW PRIORITY.

---

## 11. Files changed (binding scope contract)

The implementor's `git diff Seth...HEAD` will touch exactly these files (no more, no less, plus the implementation report):

1. `mingla-business/src/utils/eventDateMath.ts` — add `computeMasterEndAtUtc`
2. `mingla-business/src/utils/eventLifecycle.ts` — add `isEventPast`
3. (1-N) Hydration sites for `masterStartAtUtc` — exact list enumerated in step 2 pre-flight grep, then projected in implementation report
4. `mingla-business/app/(tabs)/hub/events.tsx` — delete local helper + reroute
5. `mingla-business/app/checkout/[eventId]/index.tsx` — delete local helper + reroute
6. `mingla-business/src/components/brand/PublicBrandPage.tsx` — replace memo bodies
7. `app-mobile/src/components/activity/CalendarTab.tsx` — helper + predicate per prior SPEC
8. `mingla-business/app/(tabs)/hub/__tests__/events.pastTab.test.tsx` — NEW
9. `mingla-business/app/checkout/[eventId]/__tests__/computeIsPast.test.tsx` — NEW
10. `mingla-business/src/components/brand/__tests__/PublicBrandPage.pastEvents.test.tsx` — NEW
11. `app-mobile/src/components/activity/__tests__/calendarTab.archivePartition.test.tsx` — NEW
12. `Mingla_Artifacts/INVARIANT_REGISTRY.md` — 2 new invariants + 1 strengthening clause
13. `.github/scripts/strict-grep/i-event-lifecycle-single-helper.mjs` — NEW
14. `.github/scripts/strict-grep/i-consumer-calendar-uses-end-not-start.mjs` — NEW
15. `.github/workflows/strict-grep-mingla-business.yml` — 2 new jobs
16. `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0850_END_NOT_START_SYSTEMIC.md` — implementation report

Adversarial test files (×4) are added by the tester in a separate commit during QA, not by the implementor.

---

## 12. Rollback plan

**Trigger:** Operator reports legitimate live events have disappeared OR new error rates on any of the four surfaces.

**Procedure:**
1. Revert OTA: re-run all four EAS update invocations from the commit BEFORE the ORCH-0850 close. Per memory: never combine platforms with comma.
2. Keep CI gates, invariants, regression tests — they stay. Only the source rolls back. Gates fail CI signaling known-broken state pending corrected fix.
3. Open ORCH-0850-A hot-fix.

**Recovery time objective:** < 10 minutes (four EAS update invocations).
**Data integrity:** No DB rollback. Read-side client predicates only.

---

## 13. Cross-references

- Investigation: [`reports/INVESTIGATION_ORCH-0850_END_NOT_START_SYSTEMIC.md`](../reports/INVESTIGATION_ORCH-0850_END_NOT_START_SYSTEMIC.md)
- Prior single-surface SPEC (folded in): `specs/SPEC_ORCH-0850_CALENDAR_ARCHIVE_USES_END_NOT_START.md`
- Predecessor: `specs/SPEC_ORCH-0828_CONSUMER_DISCOVER_TIMEZONE_AND_SHEET_BUGS.md` — this ORCH completes the fan-out
- Parity reference: `specs/SPEC_ORCH-0845_DISCOVER_EXCLUDES_ENDED_EVENTS.md` — server-side analogue
- WORLD_MAP entry: `WORLD_MAP.md:1221` (ORCH-0850) — needs scope update to reflect revised bundle
- Memory: `feedback_strict_grep_registry_pattern.md`, `feedback_eas_update_no_web.md`, `feedback_no_fabricated_data` (general), `feedback_solo_collab_parity.md`, `feedback_zustand_persist_no_server_snapshots.md`, `feedback_verify_db_column_names_before_writing_queries.md`, `feedback_forensic_thoroughness.md`

End of spec.
