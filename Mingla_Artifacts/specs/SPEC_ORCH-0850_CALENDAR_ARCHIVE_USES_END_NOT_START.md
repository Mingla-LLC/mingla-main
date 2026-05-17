# SPEC — ORCH-0850 Activity Calendar buckets in-progress events into Archive at start-time instead of end-time

**Mode:** SPEC (no INVESTIGATE — root cause already proven in dispatch §1)
**Skill:** Claude `mingla-forensics`
**Date:** 2026-05-15
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Dispatch:** `Mingla_Artifacts/prompts/SPEC_ORCH-0850_CALENDAR_ARCHIVE_USES_END_NOT_START.md` (PRIVATE_PROMPT_NOT_VERSIONED)
**Confidence:** High — root cause `proven` via live Supabase Management API probe in orchestrator session 2026-05-15 + Phase-0 code trace; fix is one-file client-only, no DB, no edge, no native.

---

## 1. Summary (layman first)

The Activity → Calendar tab on the consumer app splits saved entries into "Active" and "Archive". The current check asks "did the event START already?" instead of "is the event OVER yet?" — so the moment a 3am-to-9pm event begins at 3am, it falls into Archive even though it's still happening for another 18 hours. Live repro 2026-05-15 8:10pm Raleigh: "Another Tested Event" (`d07824b2-7d39-46bc-b412-4ea6d4d3962a`, `event_dates.end_at = 2026-05-16 01:00:00Z`, ~50min in the future at observation time) was already in Archive.

This SPEC changes the bucket predicate from `start < now` to `effectiveEnd < now`, where `effectiveEnd = scheduled_at + (duration_minutes ?? 120 minutes)`. The 120-minute default mirrors the existing prior-art display contract used at three sites in the same codebase (`CalendarTab.tsx:391, 414`; `SavedTab.tsx:1422`; `ActionButtons.tsx:580`) for device-calendar event creation. Client-only fix, OTA-shippable, no DB push, no edge deploy, no migration.

---

## 2. Scope, Non-Goals, Assumptions

### 2.1 Scope (locked)

S-1. `app-mobile/src/components/activity/CalendarTab.tsx:184-207` — rewrite the `useMemo` Active vs Archive partition to use `effectiveEnd` instead of `scheduledDate` for the bucket predicate.

S-2. New pure helper `computeEntryEffectiveEnd(entry: CalendarEntry): Date | null` — colocated in the same file (do NOT create a new module). Encapsulates the start + duration arithmetic with the documented 120-minute default. Reusable inside the file for future predicates without duplicating the math.

S-3. `Mingla_Artifacts/INVARIANT_REGISTRY.md` — register new invariant **I-PROPOSED-CONSUMER-CALENDAR-USES-END-NOT-START**.

S-4. `.github/scripts/strict-grep/i-consumer-calendar-uses-end-not-start.mjs` — new CI gate enforcing the invariant by line-scan of the activity layer.

S-5. `.github/workflows/strict-grep-mingla-business.yml` — register the new gate per `feedback_strict_grep_registry_pattern.md` (one script + one job).

S-6. Two regression tests, both at real paths, append-only per ORCH-0840 [Regression-test enforcement + append-only CI] Step 0.5 gate:
- S-6a (implementor-written, happy-path): `app-mobile/src/components/activity/__tests__/calendarTab.archivePartition.test.tsx`
- S-6b (tester-written, adversarial): `app-mobile/src/components/activity/__tests__/calendarTab.archivePartition.adversarial.test.tsx`

### 2.2 Non-Goals (explicitly out of scope)

NG-1. **No DB migration.** `calendar_entries` schema unchanged. No new column. No FK to `events`/`event_dates`. (Proof Option A unbuildable: see §3.1.)

NG-2. **No edge-function change.** `discover-merged-events` already correctly applies `event_dates.end_at >= now` per ORCH-0845 [Discover excludes ended events]. Untouched here.

NG-3. **No business-event order Tickets-accordion past-bucket.** `BusinessEventCalendarRow` / `useBusinessEventOrders` render in their own Tickets section above Active/Archive (CalendarTab.tsx:1755-1796) and have no past split. Per dispatch hard guard. Registered as §9 followup.

NG-4. **No status-flip auto-transition.** `events.status='ended'` remains operator-set only per ORCH-0845 close notes.

NG-5. **No `calendar_entries.duration_minutes` schema change.** Column is already nullable per `CalendarEntryRecord` interface (calendarService.ts:22). Default fallback lives in the client predicate, not the DB.

NG-6. **No time-ticker / `setInterval` for live Active→Archive flipping.** See §3.2.5 — current React Query refresh (`staleTime: 5min`, `refetchOnMount: true`, `refetchOnReconnect: true`, plus pull-to-refresh) is the agreed reconciliation cadence. Documented limitation: an event mid-tab may take up to 5min after its `effectiveEnd` to flip into Archive without a window-focus or pull-to-refresh trigger. Acceptable per dispatch §3.2.

NG-7. **No SavedTab / collaboration-calendar predicate change.** Solo+collab parity audit (§3.3) found NO matching past-vs-future bucket bug in `SavedTab.tsx` or `useCollaborationCalendar.ts`. The `selectedWhen === "upcoming"` filter at `SavedTab.tsx:275-277` operates on `dateAdded` (save timestamp), not scheduled time — semantically a different question and not affected. Registered as §9 confirmation.

NG-8. **No `entry.suggestedDates` deprecation.** Field is still consumed in this file (lines 191-195, 229-235, 1185-1188, 1572-1597, 1908-1921). The predicate handles it as a fallback start source identical to today's behavior. Format / source-of-truth audit is a separate concern.

### 2.3 Assumptions

A-1. `calendar_entries.duration_minutes` semantics (when non-null) is "duration of the saved experience in minutes from `scheduled_at`". Validated by three existing same-codebase consumers (`CalendarTab.tsx:391`, `CalendarTab.tsx:414`, `ActionButtons.tsx:580`, `SavedTab.tsx:1422`) all treating it as additive minutes to `scheduled_at` for `DeviceCalendarService.createEventFromCard(card, startDate, durationMinutes)`.

A-2. The 120-minute default is the established display contract across the four prior-art sites listed in A-1. Adopting it for the bucket predicate is consistency, not fabrication. Documented in the helper's JSDoc and in the invariant text. Per `feedback_no_fabricated_data` ([Memory: No fabricated data]): the 120 default never reaches the user as a displayed time — it is purely the cutoff threshold for the past/future decision. The user-visible time strings on the card render from `entry.suggestedDates?.[0]` / `entry.date + entry.time`, NOT from `effectiveEnd`.

A-3. `entry.scheduled_at` (when present) is a UTC ISO string. Verified via `calendarService.ts:21` (`scheduled_at: string` populated from `supabase.from("calendar_entries").select("*")` where the column is `timestamptz`).

A-4. `entry.suggestedDates?.[0]` (when present) is a UTC ISO string the user picked through the propose-date flow. Verified by callsite `CalendarTab.tsx:1185-1188` parsing it via `new Date(entry.suggestedDates[0])` for display without explicit timezone handling — same parse semantics as `scheduled_at`.

A-5. React Query refresh on `["calendarEntries", userId]` (staleTime: 5min) is sufficient reconciliation cadence. Documented limitation per NG-6.

---

## 3. Decision matrix (FORCED — picks exactly one)

### 3.1 Three candidate fix shapes

| Option | Description | Verdict | Justification |
|---|---|---|---|
| **A** | Hydrate `event_dates.end_at` onto `CalendarEntry` via a calendar-service SELECT extension; predicate becomes `endAt < now`. | **DISALLOWED — Option A is unbuildable for the legacy saved-card flow.** | `calendar_entries.card_id` is `TEXT — can be UUID, Google Places ID, or any string identifier` per `calendarService.ts:16`. NO foreign key to `events`. A saved card may reference a Google Place (no `end_at` exists), a curated multi-stop experience (no `end_at`), a Mingla business event (would have `end_at` but the link is opaque), or an arbitrary user-saved card. There is no deterministic SQL join from `calendar_entries` to `event_dates`. Adding such a link would require a new nullable FK column + backfill + RLS audit + per-saved-card resolution logic — out of scope per NG-1, and would not even cover the non-event saved cards. |
| **B** | Compute end from `scheduled_at + duration_minutes` with a documented default. Predicate becomes `(scheduled_at + (duration_minutes ?? 120min)) < now`. | **CHOSEN.** | Three reasons: (1) Option A is unbuildable (above). (2) The 120-minute default is established prior art at four same-codebase sites (CalendarTab.tsx:391, CalendarTab.tsx:414, ActionButtons.tsx:580, SavedTab.tsx:1422) used for device-calendar event creation — adopting it for the bucket predicate is consistency, not fabrication. (3) The default never surfaces to the user as a displayed time; user-visible time strings continue to render from `entry.suggestedDates?.[0]` or `entry.date + entry.time` unchanged. Per A-2, this does not violate the no-fabricated-data invariant. |
| **C** | Server-side RPC `consumer_calendar_partition(now timestamptz)` returns `{active_ids, archive_ids}`. | **DISALLOWED.** | Adds a round trip per render of a tab the user already paid for an open with. Introduces RLS-RETURNING-OWNER-GAP risk per `feedback_rls_returning_owner_gap.md`. The math is trivial — three primitive ops — and does not need server authority. Option B is faster AND simpler. |

**Verdict: Option B.**

### 3.2 Implementation contract for Option B

#### 3.2.1 Helper

Add to `app-mobile/src/components/activity/CalendarTab.tsx`, between the `CalendarTab` props interface (line 97) and the `CalendarTab` function (line 99):

```ts
/**
 * ORCH-0850: derive the effective end-time of a calendar entry for past/future
 * bucket decisions. Returns null if no start time is parseable.
 *
 * Semantics: an entry is "past" if its effective end is before now, i.e.:
 *   effectiveEnd = scheduled_at + duration_minutes  (fallback 120 min)
 *
 * MUST NOT be used for displaying times to the user — display strings still
 * come from entry.suggestedDates[0] / entry.date+entry.time unchanged. The
 * 120-minute default mirrors existing prior art at CalendarTab.tsx:391,
 * CalendarTab.tsx:414, ActionButtons.tsx:580, SavedTab.tsx:1422 (device-
 * calendar event creation), so the bucket cutoff stays consistent with the
 * duration the user already saw at schedule time.
 *
 * Preserves invariant I-PROPOSED-CONSUMER-CALENDAR-USES-END-NOT-START.
 */
const DEFAULT_CALENDAR_DURATION_MIN = 120;

function computeEntryEffectiveEnd(entry: CalendarEntry): Date | null {
  const startIso =
    entry.scheduled_at ?? entry.suggestedDates?.[0] ?? null;
  if (startIso === null) return null;
  const startMs = Date.parse(startIso);
  if (!Number.isFinite(startMs)) return null;
  const durationMin =
    typeof entry.duration_minutes === "number" && entry.duration_minutes > 0
      ? entry.duration_minutes
      : DEFAULT_CALENDAR_DURATION_MIN;
  return new Date(startMs + durationMin * 60_000);
}
```

#### 3.2.2 Predicate rewrite

`CalendarTab.tsx:184-207` — replace verbatim with:

```ts
// Filter entries into Active and Archive based on EFFECTIVE END time.
// ORCH-0850: an entry is "past" only after its scheduled_at + duration has
// elapsed. Previously this used scheduledDate < now, which flipped events
// to Archive the moment they STARTED — e.g. a 3am-to-9pm event hit Archive
// at 3:01am while still 18 hours from ending. See I-PROPOSED-CONSUMER-
// CALENDAR-USES-END-NOT-START.
const { activeEntries, archiveEntries } = useMemo(() => {
  const now = Date.now();
  const active: CalendarEntry[] = [];
  const archive: CalendarEntry[] = [];

  calendarEntries.forEach((entry) => {
    const effectiveEnd = computeEntryEffectiveEnd(entry);
    if (effectiveEnd !== null && effectiveEnd.getTime() < now) {
      archive.push(entry);
    } else {
      // Future, in-progress, or no parseable date — stays Active.
      active.push(entry);
    }
  });

  return { activeEntries: active, archiveEntries: archive };
}, [calendarEntries]);
```

#### 3.2.3 Mandatory diff requirements

D-1. `computeEntryEffectiveEnd` and `DEFAULT_CALENDAR_DURATION_MIN` are added inside `CalendarTab.tsx` (NOT a new module). Co-located minimizes blast radius and keeps the prior-art sibling pattern (the file already has many local helpers).

D-2. The `useMemo` dependency array stays `[calendarEntries]` — no `now` dependency. Per NG-6, no time-ticker.

D-3. The replacement preserves the existing fallback for entries with no parseable date — they stay in **Active** (not Archive). The verbatim "no parseable date → Active" comment is mandatory.

D-4. The original code's `entry.suggestedDates?.[0]` fallback for `scheduled_at` is preserved inside `computeEntryEffectiveEnd`. No behavior change for entries without `scheduled_at`.

D-5. `Date.now()` is used instead of `new Date()` in the predicate scope for one-source-of-truth-per-render. Comparison uses `.getTime()` (epoch ms) instead of `Date < Date`. Equivalent behavior, more explicit type.

D-6. Imports, the rest of the file, and all other handlers are UNCHANGED. No incidental refactors.

#### 3.2.4 Forbidden refactors

- DO NOT rename `entry.scheduled_at` or `entry.suggestedDates`. The interface at lines 47-83 is consumed by AppStateManager → LikesPage → CalendarTab and any rename ripples upstream.
- DO NOT extract `computeEntryEffectiveEnd` into a shared util module. Co-located helper per D-1.
- DO NOT add `useEffect` / `setInterval` / `useState` for a time-ticker. Per NG-6.
- DO NOT touch `BusinessEventCalendarRow`, `useBusinessEventOrders`, `businessOrders` state, or the Tickets accordion (lines 1755-1796). Per NG-3.
- DO NOT modify the legacy `matchesWhen` filter at lines 238-272. It operates on the same scheduled date but for a different question (week / month membership) — orthogonal to the past/future bucket.

#### 3.2.5 Time-ticker decision (explicit)

Per dispatch §3.2 Layer 4 ticker question: **OUT of scope.** Rationale:

- `useCalendarEntries` query has `staleTime: 5min, refetchOnMount: true, refetchOnReconnect: true` (useCalendarEntries.ts:30-34). When the user returns to the tab, refetch happens.
- The CalendarTab also has pull-to-refresh wired via `handleRefresh` at line 145.
- Worst-case stale window: 5 minutes from `effectiveEnd` until automatic flip, IF the user keeps the tab mounted, focused, and idle for that entire span. Real-world: rare.
- A `setInterval` ticker would force a re-render every N seconds across all entries, adding battery cost for a low-probability UX gain.
- If operator post-deploy observes the stale window as user-visible (e.g., screenshots of "in Active" 4min past end), file a follow-up ORCH for ticker. Not gating launch.

#### 3.2.6 ORCH-0848 merge note

`CalendarTab.tsx` currently has uncommitted local changes from ORCH-0848 [Tickets accordion + Active toggle parity]: lines 117-120 (`expandedAccordionItems` default = `["tickets", "active"]`) and lines 1751-1796 (Tickets accordion). The ORCH-0850 diff touches lines 184-207 and the new helper insertion point (between lines 97 and 99). Implementor MUST verify the working tree is clean of conflicting edits in these ranges before applying, AND verify lines 117-120 and 1751-1796 still match ORCH-0848 post-merge. No coordination required beyond confirming git status.

---

## 4. Five-Truth-Layer Audit

| Layer | Current state | After spec |
|---|---|---|
| **Docs** | No public-facing documentation of Active/Archive semantics. README/PRODUCT_DOCUMENT do not mention the bucket predicate. | Unchanged. Invariant registry entry §6.2 becomes the canonical doc. |
| **Schema** | `calendar_entries.scheduled_at timestamptz NOT NULL`; `calendar_entries.duration_minutes int4 NULL`. No `end_at` column. No FK to `events`. | Unchanged. Per NG-1, NG-5. |
| **Code** | `CalendarTab.tsx:197` uses start-only predicate `scheduledDate < now`. | Replaced with `effectiveEnd < now` per §3.2.2. |
| **Runtime** | `useMemo` re-evaluates only on `[calendarEntries]` change. React Query refetches on staleTime expiry / focus / reconnect / pull-to-refresh. NO `setInterval` ticker. | Same shape; predicate now correct. Per NG-6, no ticker added. Worst-case stale window 5min. |
| **Data** | Live event `d07824b2-...` confirmed in `events` + `event_dates` with `is_master=true, end_at=2026-05-16 01:00:00Z`. At 2026-05-15 00:10:52Z (8:10pm Raleigh), end_at is 50min in the future. DB internally consistent. | Unchanged. Bug is purely client-side bucket math. |

Contradicting layers: **Code vs Data + Runtime**. Code asserted "past" while Data + Runtime asserted "still 50min until end". This SPEC reconciles Code to match Data + Runtime.

---

## 5. Solo + Collab Parity Audit

Per `feedback_solo_collab_parity.md`, traced every site in `app-mobile/` that buckets calendar / save entries into past vs future:

| Site | Predicate | Status | Action |
|---|---|---|---|
| `CalendarTab.tsx:197` | `scheduledDate < now` (start-only) | **Bug — same surface, both solo+collab entries flow through here via `entry.source: "solo" \| "collaboration"`** | In scope (S-1). One fix covers both. |
| `SavedTab.tsx:275-277` | `dateAdded >= now` (filter chip `selectedWhen === "upcoming"`) | NOT the same bug. Operates on `dateAdded` (save timestamp), not scheduled time. Semantically a different question (cards saved in the future, which is nonsensical and reduces to no-op). | NO change. Confirmed correct (or harmlessly always-true). |
| `useCollaborationCalendar.ts:89-95` | No past/future bucket — only computes `scheduledAt + durationMinutes` for `DeviceCalendarService.addEventToDeviceCalendar` (device sync, not UI bucket). | NOT a bucket predicate. | NO change. |
| `MultiDayCalendar.tsx:108` | "Check if date is in the past" — UI for the propose-date picker, disabling past calendar cells. | Different question (can the user pick this date), not bucket display. Out of scope. | NO change. |
| `parseEventDateTime.ts:54` | "If the inferred date is in the past, bump to next year" — utility for forward-looking event date inference. | Different question, out of scope. | NO change. |

Solo+collab parity: confirmed. Only one fix site. Both `source: "solo"` and `source: "collaboration"` CalendarEntry rows pass through the same `useMemo` and are fixed atomically by S-1.

---

## 6. Invariants

### 6.1 Preserved

| Invariant | How preserved |
|---|---|
| **I-PROPOSED-DISCOVER-EXCLUDES-ENDED-MASTER-DATE** (ACTIVE post-ORCH-0845) | Discover edge function unchanged. This SPEC extends the same end-not-start semantic to the consumer Activity surface. Cross-references in invariant text. |
| **Const #9 — No fabricated data** (Constitution) | The 120-minute default is a cutoff threshold for the past/future decision, NEVER a displayed time. User-visible time strings continue to render from `entry.suggestedDates?.[0]` / `entry.date+entry.time` unchanged. Per A-2. |
| **Const #2 — One owner per truth** | `calendar_entries.scheduled_at + duration_minutes` remains the single source. No duplicate authority introduced. |
| **I-PROPOSED-CONSUMER-CALENDAR-UNIONS-ORDERS** (ORCH-0829-A [business event tickets in consumer calendar]) | Tickets accordion (BusinessEventCalendarRow) and legacy Active/Archive are independent sections; this SPEC only touches the latter. Union semantics preserved. |

### 6.2 Newly established

**I-PROPOSED-CONSUMER-CALENDAR-USES-END-NOT-START.** Add to `Mingla_Artifacts/INVARIANT_REGISTRY.md` after the I-PROPOSED-DISCOVER-EXCLUDES-ENDED-MASTER-DATE entry. Exact text:

> **I-PROPOSED-CONSUMER-CALENDAR-USES-END-NOT-START.** Any client-side partition of consumer calendar / saved-card entries into past-vs-upcoming buckets MUST evaluate `effectiveEnd = scheduled_at + (duration_minutes ?? 120 minutes)`, NOT the start instant. In-progress entries (`scheduled_at <= now < effectiveEnd`) MUST remain in the Active bucket until their effective end has passed. Established by ORCH-0850 [Activity Calendar buckets in-progress events into Archive at start-time]. The 120-minute default mirrors prior art at `CalendarTab.tsx:391`, `CalendarTab.tsx:414`, `ActionButtons.tsx:580`, `SavedTab.tsx:1422` (device-calendar event creation) and never surfaces as a user-visible time string — it is solely the bucket cutoff. Parity-paired with `I-PROPOSED-DISCOVER-EXCLUDES-ENDED-MASTER-DATE` (the Discover read-side floor). Enforced by CI gate `.github/scripts/strict-grep/i-consumer-calendar-uses-end-not-start.mjs`.

---

## 7. Strict-grep CI gate

**Path:** `.github/scripts/strict-grep/i-consumer-calendar-uses-end-not-start.mjs`

**Detection rule:** Scan `app-mobile/src/components/activity/CalendarTab.tsx`, `app-mobile/src/components/activity/SavedTab.tsx`, `app-mobile/src/hooks/useCalendarEntries.ts`, and `app-mobile/src/hooks/useCollaborationCalendar.ts`. For each non-comment, non-test line, FAIL if any of the following forbidden patterns match:

- `scheduledDate\s*<\s*now` (the verbatim pre-0850 predicate)
- `new Date\(entry\.scheduled_at\)\s*<\s*new Date\(\)` (the start-only literal)
- `Date\.parse\(entry\.scheduled_at\)\s*<\s*Date\.now\(\)` (the start-only epoch form)
- `new Date\(entry\.suggestedDates\?\.\[0\]\)\s*<\s*new Date\(\)` (start-only via fallback)

PASS-required: `CalendarTab.tsx` MUST contain `computeEntryEffectiveEnd` AND `DEFAULT_CALENDAR_DURATION_MIN` on non-comment lines. The script's filename and its own comments are allowed to mention forbidden patterns — scan targets are the four source files only.

**Whitelist:** A line containing `// SPEC ORCH-0850 OK:` is exempt from the forbidden-pattern scan (escape hatch for legitimate start-time-only math, e.g. matchesWhen "today" date-membership which is orthogonal).

**Negative-control rule (anti-no-op proof):** The script MUST include a self-test mode that re-runs the scan against an inlined fixture string `const scheduledDate = entry.scheduled_at ? new Date(entry.scheduled_at) : null; if (scheduledDate < now) {}` and exit 1 if that fixture does NOT trigger a match — proving the regex actually catches the pattern. The self-test runs only when invoked with `node i-consumer-calendar-uses-end-not-start.mjs --self-test`; default invocation skips it.

**Reference pattern:** Modeled on `.github/scripts/strict-grep/i-discover-excludes-ended-master-date.mjs` from ORCH-0845 close (single-file/multi-file regex scan with comment exclusion).

**Exit codes:**
- `0` — all targets pass scan; required tokens present in CalendarTab.tsx
- `1` — at least one forbidden pattern matched OR required token missing OR self-test failed
- `2` — file system error reading a target file

---

## 8. Test contract (mandatory — Step 0.5 regression gate)

### 8.1 Implementor-written happy-path regression test — S-6a

**Path:** `app-mobile/src/components/activity/__tests__/calendarTab.archivePartition.test.tsx`

**Runtime:** Jest with `@testing-library/react-native` (existing harness; see `app-mobile/jest.config.js` for setup). Direct test of `computeEntryEffectiveEnd` + the `useMemo` bucket. Renders CalendarTab and asserts which section a given entry lands in.

**Required test cases (implementor may rephrase, must not weaken):**

```ts
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { render } from "@testing-library/react-native";
// ...standard CalendarTab harness imports

describe("ORCH-0850 — CalendarTab Active/Archive partition uses effective END not start", () => {
  beforeEach(() => {
    // Pin Date.now to 2026-05-15T20:10:00-04:00 = 2026-05-16T00:10:00Z
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-05-16T00:10:00Z"));
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it("T-01: in-progress entry (started past, ends future) appears in Active", () => {
    // Entry equivalent to "Another Tested Event":
    //   scheduled_at = 2026-05-15T07:00:00Z (3am EDT)
    //   duration_minutes = 18 * 60 = 1080 (3am → 9pm = 18h)
    //   effectiveEnd = 2026-05-16T01:00:00Z (9pm EDT) → 50min after now → ACTIVE
    // Render CalendarTab with this entry; assert it's NOT in archive section.
  });

  it("T-02: ended entry (end past) appears in Archive", () => {
    //   scheduled_at = 2026-05-14T22:00:00Z
    //   duration_minutes = 60
    //   effectiveEnd = 2026-05-14T23:00:00Z → past → ARCHIVE
  });

  it("T-03: future entry (start future) appears in Active", () => {
    //   scheduled_at = 2026-05-16T20:00:00Z (tomorrow)
    //   duration_minutes = 120
    //   effectiveEnd > now → ACTIVE
  });

  it("T-04: entry with no parseable date stays in Active", () => {
    //   scheduled_at = null, suggestedDates = null
    //   computeEntryEffectiveEnd → null → ACTIVE (per D-3)
  });

  it("T-05: entry with null duration_minutes uses 120-min default", () => {
    //   scheduled_at = 2026-05-15T23:00:00Z (75min before now)
    //   duration_minutes = null → fallback 120
    //   effectiveEnd = 2026-05-16T01:00:00Z (50min after now) → ACTIVE
  });

  it("T-06: entry with scheduled_at past + duration_minutes that makes end past = Archive", () => {
    //   scheduled_at = 2026-05-15T23:00:00Z, duration_minutes = 30
    //   effectiveEnd = 2026-05-15T23:30:00Z (40min before now) → ARCHIVE
  });
});
```

**Implementor responsibility:**
- All six `it` blocks REQUIRED. T-05 is the prior-art-default proof. T-06 is the "duration was set explicitly, still past" case — distinguishes Option B from a naive `start < now`.
- Implementation report MUST include: `fails-on-revert verified at <commit hash>` proving T-01 specifically FAILS when the predicate is reverted to `scheduledDate < now`. T-01 is the bug-exercise test; the others guard against over-correction.
- Wire harness via the existing CalendarTab test pattern if one exists; otherwise establish one. Document in implementation report.

### 8.2 Tester-written adversarial regression test — S-6b

**Path:** `app-mobile/src/components/activity/__tests__/calendarTab.archivePartition.adversarial.test.tsx`

**Attack vector (binding):** must attack a DIFFERENT angle than S-6a. The tester MAY NOT rename / re-skin S-6a's cases.

**Required adversarial vectors (tester picks ≥3, must include at least one from each cluster):**

**Cluster A — Boundary equality:**
- `effectiveEnd` exactly equal to `now` (boundary of the `<` vs `<=` decision)
- `effectiveEnd` 1 millisecond before `now`
- `effectiveEnd` 1 millisecond after `now`

**Cluster B — Timezone / DST hazards:**
- Entry with `scheduled_at` straddling a DST jump (March 8 2026 2am EST→EDT or November 1 2026 2am EDT→EST)
- Entry with `scheduled_at` ISO containing fractional seconds
- Entry with non-UTC-suffix ISO (e.g. `"2026-05-15T07:00:00"` no `Z`) — must be parsed deterministically OR fall back to null without throwing

**Cluster C — Malformed / edge data:**
- Entry with `duration_minutes = 0` (must NOT divide-by-zero or return null incorrectly; spec says > 0 falls back to 120, so 0 → 120)
- Entry with `duration_minutes = -60` (negative; spec says > 0 falls back, so -60 → 120)
- Entry with `duration_minutes = Number.MAX_SAFE_INTEGER` (overflow guard — must not throw)
- Entry with malformed `suggestedDates[0]` (e.g. `"not-a-date"`) — `Date.parse` returns NaN; `Number.isFinite` guard catches it → null → ACTIVE
- Entry with `scheduled_at = null, suggestedDates = []` (empty array, not undefined) — must fall to null → ACTIVE

**Cluster D — Cross-mode parity:**
- Entry with `source: "collaboration"` + ended `effectiveEnd` → ARCHIVE (proves solo+collab parity in test, not just by source-code inspection)

**Tester responsibility:**
- QA report MUST cite the file path + passing test run + `fails-on-revert verified at <commit hash>` line where reverting the §3.2.2 predicate (back to `scheduledDate < now`) breaks AT LEAST 3 of the adversarial cases (not the same 3 as S-6a). This proves the adversarial test attacks distinct angles.
- If tester finds a fourth dangerous angle not in the four clusters above, ADD it. MUST NOT replace the cluster minimums with weaker tests.

**Forbidden:** A renamed copy of S-6a's cases. Step 0.5 gate explicitly rejects this per ORCH-0840 close criteria.

---

## 9. Discoveries for orchestrator (followups; NOT in this ORCH)

### 9.1 BusinessEvent ticket past-bucket (HIGH-VALUE FOLLOWUP)

`BusinessEventCalendarRow` / `useBusinessEventOrders` render in the Tickets accordion (CalendarTab.tsx:1755-1796) with NO past split — every ticket purchase, including events that ended weeks ago, appears in one list. Out of scope per dispatch NG-3 + this SPEC NG-3. Future ORCH:

- Hydrate `event_dates.end_at` from the existing `orders.events.event_dates!left` SELECT in `calendarService.ts:284` (Option A IS available here — there's already a deterministic FK chain `orders.event_id → events.id → event_dates.event_id`).
- Add a past/active split to the Tickets accordion OR collapse past tickets into a "Past Tickets" sub-section.
- Decide UX: do users want ended ticket history accessible (likely yes, as proof of purchase) or hidden (cleaner)?

### 9.2 SavedTab.tsx:275 "upcoming" filter operates on dateAdded (CONFIRMED CORRECT)

Confirmed during §5 parity audit: `SavedTab.tsx:275-277` filters by save timestamp, not scheduled time. `dateAdded >= now` is almost always true (cards added "in the future" is nonsensical) — effectively a no-op for the filter. Either intentional UX (filter is vestigial) or a latent bug where it should be checking `entry.scheduled_at`. Operator decision needed; not blocking ORCH-0850.

### 9.3 React Query staleTime audit on useCalendarEntries (LOW PRIORITY)

Per NG-6 / §3.2.5: worst-case 5min stale before automatic Active→Archive flip. Lowering staleTime would reduce the window at the cost of more refetches. Operator may want to revisit if user observation shows visible stale state.

### 9.4 `entry.suggestedDates` data-shape audit (LOW PRIORITY)

`suggestedDates` is consumed at five sites in CalendarTab.tsx but the shape contract is undocumented. Post-onboarding rework status unclear. Worth a forensic pass to confirm it's still being populated and whether to deprecate / consolidate with `scheduled_at`.

### 9.5 Cross-platform parity check (DURING TESTER PHASE, not followup)

Tester must verify the fix on iOS Sim + Android Emu per `feedback_tester_canonical_and_platform_parity.md`. No platform-specific code paths here; should be uneventful. Web is not a Mingla consumer surface — N/A.

---

## 10. Success criteria

| ID | Criterion | Verification | Layer |
|---|---|---|---|
| **SC-01** | At simulated time 2026-05-15T20:10 EDT (2026-05-16T00:10:00Z), a CalendarEntry with `scheduled_at = 2026-05-15T07:00:00Z` + `duration_minutes = 1080` (or `null` + 18h via custom default override for the test) appears in **Active**, NOT Archive. | Jest S-6a T-01 | Component |
| **SC-02** | At simulated time advanced past `effectiveEnd`, the same entry transitions to **Archive** on next render (no time-ticker; relies on data refetch or remount). | Jest S-6a T-02 / T-06 | Component |
| **SC-03** | A purely-future entry (`scheduled_at > now`) appears in **Active**. | Jest S-6a T-03 | Component |
| **SC-04** | An entry with no parseable date (`scheduled_at = null, suggestedDates = null`) appears in **Active**, NOT Archive. | Jest S-6a T-04 | Component |
| **SC-05** | An entry with `duration_minutes = null` uses the 120-minute default. | Jest S-6a T-05 | Util |
| **SC-06** | Discover/Calendar parity: an event visible in Discover under "Tonight" (via ORCH-0845 `end_at >= now` floor) appears in CalendarTab's **Active**, never Archive. | Manual operator smoke on dev build with "Another Tested Event"; screenshot in QA report | Cross-surface |
| **SC-07** | Strict-grep CI gate exits 0 on the head commit AND exits 1 when D-3 is synthetically reverted (predicate restored to `scheduledDate < now`). Self-test exits 1 if the regex fails to match the fixture. | Implementor runs and captures both | CI |
| **SC-08** | `git diff Seth...HEAD` touches ONLY: `app-mobile/src/components/activity/CalendarTab.tsx`, `Mingla_Artifacts/INVARIANT_REGISTRY.md`, `.github/scripts/strict-grep/i-consumer-calendar-uses-end-not-start.mjs`, `.github/workflows/strict-grep-mingla-business.yml`, `app-mobile/src/components/activity/__tests__/calendarTab.archivePartition.test.tsx`, plus the implementation report. NO migration, NO edge function, NO mobile-business or admin files. | `git diff --stat` at REVIEW | Scope |
| **SC-09** | TypeScript strict mode passes on `app-mobile/`: `cd app-mobile && npx tsc --noEmit` exit 0. No new `any`, `@ts-ignore`, or `as unknown as` introduced. | Implementor captures `tsc` output | Type |
| **SC-10** | Solo entry (`source: "solo"`) and collab entry (`source: "collaboration"`) with identical `scheduled_at` + `duration_minutes` land in the same bucket. | Adversarial S-6b Cluster D | Parity |
| **SC-11** | No ticker / `setInterval` / new `useState` introduced (per NG-6). | Code review of diff | Behavior |
| **SC-12** | Operator post-deploy smoke: open Activity → Calendar with "Another Tested Event" saved at 2026-05-15 8:10pm Raleigh local — entry appears in **Active** section. Then advance device clock past 9pm + pull-to-refresh → entry moves to Archive. Screenshots in QA report. | Operator (after EAS Update OTA) | Live-fire |

---

## 11. Implementation order (binding)

1. Re-grep `app-mobile/src/components/activity/CalendarTab.tsx` to confirm lines 184-207 still match the SPEC's "current code" reference (no other in-flight edit overlapping). If not clean, ABORT and surface to orchestrator.

2. Add `DEFAULT_CALENDAR_DURATION_MIN` const and `computeEntryEffectiveEnd` helper per §3.2.1 between lines 97 and 99 of `CalendarTab.tsx`.

3. Replace lines 184-207 per §3.2.2.

4. Run `cd app-mobile && npx tsc --noEmit`. Must exit 0.

5. Create `app-mobile/src/components/activity/__tests__/calendarTab.archivePartition.test.tsx` per §8.1 with all six `it` blocks. Run `cd app-mobile && yarn test calendarTab.archivePartition` (or repo's equivalent). All six must pass.

6. Revert §3.2.2 D-1 (restore `scheduledDate < now`) locally, re-run T-01, capture the FAIL output + commit hash, then restore. Record both hashes in implementation report as `fails-on-revert verified at <revert-hash>; restored at <restore-hash>`.

7. Add `I-PROPOSED-CONSUMER-CALENDAR-USES-END-NOT-START` to `Mingla_Artifacts/INVARIANT_REGISTRY.md` per §6.2.

8. Create `.github/scripts/strict-grep/i-consumer-calendar-uses-end-not-start.mjs` per §7. Run `node .github/scripts/strict-grep/i-consumer-calendar-uses-end-not-start.mjs` → exit 0. Run with `--self-test` → exit 0 (proves regex catches fixture). Temporarily revert §3.2.2 D-1 locally → re-run gate → exit 1; restore. Capture all three in implementation report.

9. Register the new job in `.github/workflows/strict-grep-mingla-business.yml` per `feedback_strict_grep_registry_pattern.md` (one script + one job).

10. Run all existing strict-grep gates locally on the changed file: `node .github/scripts/strict-grep/i-ari-no-oklch.mjs` etc. — confirm zero regressions.

11. Write `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0850_CALENDAR_ARCHIVE_USES_END_NOT_START.md` with: old→new diff receipts (lines 97→insertion, 184→207), test output captures, gate output captures, fails-on-revert proof, files-changed list matching SC-08, ORCH-0848 merge note per §3.2.6.

The tester's adversarial test (S-6b) is written by the tester AFTER implementor returns, NOT by the implementor.

DB push: not required (no migrations). Edge deploy: not required (no edge changes). Native build: not required. EAS Update OTA: required (two-platform per `feedback_eas_update_no_web.md`: `--platform ios` then `--platform android` as two separate invocations, NOT `--platform ios,android`).

---

## 12. Regression prevention

R-1. **Structural safeguard:** Strict-grep gate `i-consumer-calendar-uses-end-not-start.mjs` blocks the four forbidden patterns from re-entering the four target files. A future contributor reintroducing `scheduledDate < now` (or any equivalent literal) gets a hard CI fail with an explanatory error message citing this ORCH and the invariant ID.

R-2. **Test safeguard:** S-6a's six Jest cases exercise the bug directly (T-01) plus five guard cases against over-correction. ORCH-0840 [Regression-test enforcement + append-only CI] forbids deletion; modifications require `[TEST-MOD-APPROVED ORCH-NNNN]`.

R-3. **Adversarial safeguard:** S-6b's tester-written attacks across four clusters (boundary, TZ/DST, malformed, parity) prevent a fix that passes the happy path but breaks edge cases.

R-4. **Documentation safeguard:** The §3.2.1 JSDoc on `computeEntryEffectiveEnd` carries the ORCH-ID, the bug class, the 120-min rationale, and the no-fabricated-data justification. Future readers see the full reasoning at the call site.

R-5. **Invariant safeguard:** `I-PROPOSED-CONSUMER-CALENDAR-USES-END-NOT-START` is a public, registered rule. Any future Activity / Calendar / Saved touching ORCH must check the invariant registry as part of Phase 0 ingestion.

R-6. **Pairing with Discover invariant:** The invariant text explicitly cross-references `I-PROPOSED-DISCOVER-EXCLUDES-ENDED-MASTER-DATE`, making the "end-not-start" semantic a paired contract across Discover read-side and Activity client-side. A future Discover-side change that violates the contract (e.g. revert to `start_at >= now`) will be visible in invariant search.

---

## 13. Rollback plan

**Trigger:** Operator reports that legitimate upcoming entries have disappeared from Active after the deploy, OR entries that should be Archive are stuck in Active for longer than the 5-min staleTime window.

**Procedure:**

1. Revert the OTA: re-run `eas update --branch production --platform ios` and `--platform android` from the commit immediately BEFORE the ORCH-0850 close. Two separate invocations per `feedback_eas_update_no_web.md`. Each command's `--message` cites "ORCH-0850 rollback".
2. Verify on a clean Expo Go reload + dev build that the prior bucket math is back.
3. Keep the invariant entry, the gate, and the regression tests — those stay. Only the function source is rolled back. The gate then fails CI, which is the correct signal: codebase is in a known-broken state pending a corrected fix.
4. Open hot-fix ORCH-0850-A with the regression evidence.

**Recovery time objective:** < 5 minutes (single EAS update per platform, OTA propagation ~30s).

**Data integrity:** No DB rollback needed. No data loss possible — read-side client predicate only.

---

## 14. Confidence

`High` — root cause `proven` in dispatch §1 via live Supabase Management API probe + Phase-0 code trace; fix is single-file client-only with no DB / no edge / no native; Option A unbuildable proven from schema constraints; Option B's 120-min default backed by four established prior-art sites in same codebase; solo+collab parity audited (single fix site); strict-grep gate models verbatim on ORCH-0845's pattern; rollback is one OTA per platform; both tests have explicit fails-on-revert verification.

---

## 15. Cross-references

- Dispatch: `Mingla_Artifacts/prompts/SPEC_ORCH-0850_CALENDAR_ARCHIVE_USES_END_NOT_START.md` (PRIVATE_PROMPT_NOT_VERSIONED)
- WORLD_MAP entry: `Mingla_Artifacts/WORLD_MAP.md:1221` (ORCH-0850 row, INTAKE registered 2026-05-15)
- Parity precedent (Discover read-side floor): `Mingla_Artifacts/specs/SPEC_ORCH-0845_DISCOVER_EXCLUDES_ENDED_EVENTS.md` + invariant `I-PROPOSED-DISCOVER-EXCLUDES-ENDED-MASTER-DATE` (ACTIVE post-2026-05-15)
- Timezone-bug class precedent: `Mingla_Artifacts/specs/SPEC_ORCH-0828_CONSUMER_DISCOVER_TIMEZONE_AND_SHEET_BUGS.md` + invariant `I-PROPOSED-LIVE-STATUS-UTC-INPUT`
- Tickets-accordion parity (ORCH-0848): currently in working tree at `CalendarTab.tsx:117-120, 1751-1796` — referenced in §3.2.6 merge note
- Memory: `feedback_strict_grep_registry_pattern.md` (one script + one job), `feedback_no_fabricated_data` (display-data integrity), `feedback_eas_update_no_web.md` (two-platform OTA), `feedback_solo_collab_parity.md` (audit pattern), `feedback_tester_canonical_and_platform_parity.md` (tester ownership)

End of spec.
