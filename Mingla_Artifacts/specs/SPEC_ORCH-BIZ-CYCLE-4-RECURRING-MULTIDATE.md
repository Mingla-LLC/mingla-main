# Spec — ORCH-BIZ-CYCLE-4-RECURRING-MULTIDATE

**ORCH-ID:** ORCH-BIZ-CYCLE-4-RECURRING-MULTIDATE
**Cycle:** 4 (Refine wedge — Step 2 expansion)
**Pairs with:** [`reports/INVESTIGATION_ORCH-BIZ-CYCLE-4-RECURRING-MULTIDATE.md`](../reports/INVESTIGATION_ORCH-BIZ-CYCLE-4-RECURRING-MULTIDATE.md)
**Mode:** Frontend-only (DEC-071). No backend, no real publish.
**Pace:** Sequential. Implementor confirms scope before writing the first line.

---

## 1. Layman summary

Step 2 of the wizard becomes a 3-mode picker:

1. **Single** — what we already have (date + doors + ends + timezone)
2. **Recurring** — repeats automatically (5 presets: daily / weekly / every 2 weeks / monthly-by-day-of-month / monthly-by-weekday) with a termination (count or end-date)
3. **Multi-date** — a manual list of 2–24 dates, each individually editable for title / description / location

Preview shows the right picture per mode. Publish gate blocks invalid recurrence/multi-date setups. Backend lands Cycle 9.

---

## 2. Scope (locked) and non-goals

### In scope

| Area | Deliverable |
|------|-------------|
| **Persistence** | DraftEvent schema v2 → v3 (rename `repeats` → `whenMode`, add `recurrenceRule`, `multiDates`); migrator |
| **Validation** | Branched `validateWhen` + `validatePublish` per mode |
| **Step 2 body** | 3-segment control + 3 mode bodies + mode-switch handlers (with confirm dialogs for lossy switches) |
| **Recurring picker (J-E5)** | Preset row → preset sheet (5 options) · Termination row → termination sheet (count input OR end-date picker) |
| **Multi-date list builder (J-E6)** | Add-date sheet · per-row edit pencil · per-row delete with ConfirmDialog |
| **Per-date override sheet (J-E7)** | 4 inputs (title, description, venue+address [or onlineUrl per format], optional) · inheritance placeholders |
| **Display helpers** | New `eventDateDisplay.ts` consolidating 3 existing copies + N-date formatters |
| **Recurrence helpers** | New `recurrenceRule.ts` (preset → display label · expand to dates · RRULE string emitter for Cycle 9) |
| **Preview integration (J-E8 read)** | Mini card + PreviewEventView N-date pill + accordion expand |
| **Publish gate (J-E8)** | New error keys `recurrence.invalid`, `multiDates.invalid` · publish modal copy variants |

### Non-goals (DO NOT DO)

- ❌ Backend (DEC-071) — no Supabase migrations, no edge functions, no real publish
- ❌ Per-date cover image / per-date tickets / per-date timezone (Cycle 5+)
- ❌ Manual reordering of multi-dates (auto-sorted chronologically)
- ❌ Full RFC 5545 RRULE editor (presets only)
- ❌ "No end date" infinite recurrence
- ❌ Exception dates / EXDATE
- ❌ Calendar-grid multi-date picker (defer to B-cycle if user pressure; one-at-a-time only)
- ❌ Web parity (DEC-071 — mobile only)
- ❌ Public preview page changes (Cycle 6)
- ❌ External libs — DO NOT introduce `rrule.js` (~20 KB; we emit ~5 RRULE strings by hand)
- ❌ New design tokens or kit primitives
- ❌ Analytics events
- ❌ AI agent surfaces

### Assumptions

- Cycle 3 baseline is the working tree at commit `6efc57ac` (verified 2026-04-30)
- DEC-084 (Sheet numeric snap) and DEC-085 (Modal native portal) are merged and stable
- IANA timezone enumeration via `Intl.supportedValuesOf` is available on Hermes (verified Cycle 3 rework v2 Fix #4)
- `formatGbpRound`, `Sheet`, `Input`, `Pill`, `ConfirmDialog`, `IconChrome`, `Toast`, `DateTimePicker` work as Cycle 3 documented

---

## 3. Layer-by-layer specification

### 3.1 Persistence layer — `mingla-business/src/store/draftEventStore.ts`

#### 3.1.1 New types

```ts
// New v3 types — append, do not delete v1/v2 type aliases (used by migrators)

export type WhenMode = "single" | "recurring" | "multi_date";

export type RecurrencePreset =
  | "daily"
  | "weekly"
  | "biweekly"
  | "monthly_dom"   // monthly by day-of-month (e.g., "every 15th")
  | "monthly_dow"; // monthly by weekday (e.g., "every 1st Monday")

export type Weekday =
  | "MO" | "TU" | "WE" | "TH" | "FR" | "SA" | "SU";

export interface RecurrenceRule {
  preset: RecurrencePreset;
  /** Required for weekly, biweekly, monthly_dow. */
  byDay?: Weekday;
  /** Required for monthly_dom (1-31, clamped to 28 to avoid Feb-30 weirdness). */
  byMonthDay?: number;
  /** Required for monthly_dow: 1=first, 2=second, 3=third, 4=fourth, -1=last. */
  bySetPos?: 1 | 2 | 3 | 4 | -1;
  termination:
    | { kind: "count"; count: number }   // 1..52
    | { kind: "until"; until: string };  // ISO YYYY-MM-DD (max 1 year from first occurrence)
}

export interface MultiDateEntry {
  id: string;            // generated via generateDraftId() (reuse the d_<ts36> generator)
  date: string;          // ISO YYYY-MM-DD
  startTime: string;     // HH:MM
  endTime: string;       // HH:MM
  overrides: {
    title: string | null;        // null/empty = inherit parent draft.name
    description: string | null;
    venueName: string | null;
    address: string | null;
    onlineUrl: string | null;
  };
}
```

#### 3.1.2 DraftEvent v3 shape (REPLACE current v2 shape)

```ts
export interface DraftEvent {
  id: string;
  brandId: string;
  // Step 1 — Basics (UNCHANGED)
  name: string;
  description: string;
  format: DraftEventFormat;
  category: string | null;
  // Step 2 — When (CHANGED in v3)
  whenMode: WhenMode;                              // NEW (replaces `repeats`)
  /** ISO YYYY-MM-DD. In single mode: the event date. In recurring mode: first occurrence. In multi_date mode: ignored (multiDates[0] holds the first date). */
  date: string | null;
  doorsOpen: string | null;
  endsAt: string | null;
  timezone: string;
  /** Non-null only when whenMode === "recurring". */
  recurrenceRule: RecurrenceRule | null;            // NEW
  /** Non-null only when whenMode === "multi_date". Length 0..24 (validation enforces ≥2 to publish). */
  multiDates: MultiDateEntry[] | null;              // NEW
  // Step 3 — Where (UNCHANGED)
  venueName: string | null;
  address: string | null;
  onlineUrl: string | null;
  hideAddressUntilTicket: boolean;
  // Step 4 — Cover (UNCHANGED)
  coverHue: number;
  // Step 5 — Tickets (UNCHANGED)
  tickets: TicketStub[];
  // Step 6 — Settings (UNCHANGED)
  visibility: DraftEventVisibility;
  requireApproval: boolean;
  allowTransfers: boolean;
  hideRemainingCount: boolean;
  passwordProtected: boolean;
  // Meta (UNCHANGED)
  lastStepReached: number;
  status: DraftEventStatus;
  createdAt: string;
  updatedAt: string;
}
```

**Field removed:** `repeats: "once"` — was unused outside Step 2's placeholder Sheet (verified). Migration drops it silently.

#### 3.1.3 Migration v2 → v3

```ts
type V2DraftEvent = Omit<DraftEvent, "whenMode" | "recurrenceRule" | "multiDates"> & {
  repeats?: "once"; // present in v2, absent in v3
};

const upgradeV2DraftToV3 = (d: V2DraftEvent): DraftEvent => {
  // Strip repeats; default whenMode to "single"; null both recurring and multi-date arrays.
  const { repeats: _drop, ...rest } = d;
  return {
    ...rest,
    whenMode: "single",
    recurrenceRule: null,
    multiDates: null,
  };
};

// In persistOptions.migrate:
const persistOptions: PersistOptions<DraftEventState, PersistedState> = {
  name: "mingla-business.draftEvent.v1",  // STORE NAME UNCHANGED
  storage: createJSONStorage(() => AsyncStorage),
  partialize: (state) => ({ drafts: state.drafts }),
  version: 3,                              // BUMP from 2 → 3
  migrate: (persistedState, version) => {
    if (version < 1) return { drafts: [] };
    if (version === 1) {
      // v1 → v3 chain: run v1→v2 then v2→v3
      const v1 = persistedState as { drafts: V1DraftEvent[] };
      const v2Drafts = v1.drafts.map(upgradeV1DraftToV2);
      return { drafts: v2Drafts.map(upgradeV2DraftToV3 as (d: V2DraftEvent) => DraftEvent) };
    }
    if (version === 2) {
      const v2 = persistedState as { drafts: V2DraftEvent[] };
      return { drafts: v2.drafts.map(upgradeV2DraftToV3) };
    }
    return persistedState as PersistedState;
  },
};
```

**DEFAULT_DRAFT_FIELDS update:**
- Remove `repeats: "once"` line
- Add `whenMode: "single"`, `recurrenceRule: null`, `multiDates: null`

**Constitutional check:** Constitution #6 (logout clears) — no change to `clearAllStores()` wiring; the `reset()` already nukes `drafts[]`.

#### 3.1.4 No new selectors

`useDraftsForBrand`, `useDraftById` work unchanged (mode-agnostic).

---

### 3.2 Validation layer — `mingla-business/src/utils/draftEventValidation.ts`

#### 3.2.1 Branched `validateWhen`

```ts
const validateWhen = (d: DraftEvent): ValidationError[] => {
  switch (d.whenMode) {
    case "single":
      return validateWhenSingle(d);
    case "recurring":
      return validateWhenRecurring(d);
    case "multi_date":
      return validateWhenMultiDate(d);
  }
};

const validateWhenSingle = (d: DraftEvent): ValidationError[] => {
  // EXISTING Cycle 3 logic — extracted, no change to behavior
  const errs: ValidationError[] = [];
  if (d.date === null) errs.push({ fieldKey: "date", step: 1, message: "Set the event date." });
  else if (parseDateString(d.date) < startOfToday())
    errs.push({ fieldKey: "date", step: 1, message: "Date can't be in the past." });
  if (d.doorsOpen === null) errs.push({ fieldKey: "doorsOpen", step: 1, message: "Set the door-open time." });
  if (d.endsAt === null) errs.push({ fieldKey: "endsAt", step: 1, message: "Set the end time." });
  return errs;
};

const validateWhenRecurring = (d: DraftEvent): ValidationError[] => {
  const errs: ValidationError[] = [];
  // First occurrence (uses parent date field)
  if (d.date === null) errs.push({ fieldKey: "date", step: 1, message: "Set the first occurrence date." });
  else if (parseDateString(d.date) < startOfToday())
    errs.push({ fieldKey: "date", step: 1, message: "First occurrence can't be in the past." });
  if (d.doorsOpen === null) errs.push({ fieldKey: "doorsOpen", step: 1, message: "Set the door-open time." });
  if (d.endsAt === null) errs.push({ fieldKey: "endsAt", step: 1, message: "Set the end time." });
  // Recurrence rule
  if (d.recurrenceRule === null) {
    errs.push({ fieldKey: "recurrence", step: 1, message: "Pick a repeat pattern." });
  } else {
    const r = d.recurrenceRule;
    // Preset-specific param checks
    if ((r.preset === "weekly" || r.preset === "biweekly" || r.preset === "monthly_dow") && r.byDay === undefined) {
      errs.push({ fieldKey: "recurrence.byDay", step: 1, message: "Pick a day of the week." });
    }
    if (r.preset === "monthly_dom" && (r.byMonthDay === undefined || r.byMonthDay < 1 || r.byMonthDay > 28)) {
      errs.push({ fieldKey: "recurrence.byMonthDay", step: 1, message: "Pick a valid day (1–28)." });
    }
    if (r.preset === "monthly_dow" && r.bySetPos === undefined) {
      errs.push({ fieldKey: "recurrence.bySetPos", step: 1, message: "Pick which week (1st, 2nd, etc.)." });
    }
    // Day-of-week match check (REVISED 2026-04-30 — replaces auto-snap UX).
    // When byDay is set, the first occurrence date MUST be that weekday.
    // User fixes manually (no silent snap).
    if (
      (r.preset === "weekly" || r.preset === "biweekly" || r.preset === "monthly_dow")
      && r.byDay !== undefined
      && d.date !== null
    ) {
      const dowOfDate = weekdayOfIso(d.date); // helper in recurrenceRule.ts
      if (dowOfDate !== r.byDay) {
        errs.push({
          fieldKey: "recurrence.dayMismatch",
          step: 1,
          message: `First occurrence is ${formatWeekdayLong(dowOfDate)} but pattern is ${formatWeekdayLong(r.byDay)}. Pick a matching date or change the day.`,
        });
      }
    }
    // Termination check
    if (r.termination.kind === "count") {
      if (!Number.isFinite(r.termination.count) || r.termination.count < 1 || r.termination.count > 52) {
        errs.push({ fieldKey: "recurrence.count", step: 1, message: "Number of occurrences must be 1–52." });
      }
    } else {
      // until kind
      const untilDate = parseDateString(r.termination.until);
      if (d.date !== null) {
        const firstDate = parseDateString(d.date);
        if (untilDate <= firstDate) {
          errs.push({ fieldKey: "recurrence.until", step: 1, message: "End date must be after the first occurrence." });
        }
      }
      const oneYearOut = new Date();
      oneYearOut.setFullYear(oneYearOut.getFullYear() + 1);
      if (untilDate > oneYearOut) {
        errs.push({ fieldKey: "recurrence.until", step: 1, message: "End date can't be more than 1 year out." });
      }
    }
  }
  return errs;
};

const validateWhenMultiDate = (d: DraftEvent): ValidationError[] => {
  const errs: ValidationError[] = [];
  const dates = d.multiDates ?? [];
  if (dates.length < 2) {
    errs.push({ fieldKey: "multiDates.minCount", step: 1, message: "Add at least 2 dates." });
    return errs;
  }
  if (dates.length > 24) {
    errs.push({ fieldKey: "multiDates.maxCount", step: 1, message: "Maximum is 24 dates." });
    return errs;
  }
  // No past dates
  const today = startOfToday();
  for (let i = 0; i < dates.length; i++) {
    const e = dates[i];
    if (parseDateString(e.date) < today) {
      errs.push({
        fieldKey: `multiDates[${i}].date`,
        step: 1,
        message: `Date ${i + 1} (${e.date}) is in the past.`,
      });
    }
  }
  // No duplicate date+startTime
  const seen = new Set<string>();
  for (let i = 0; i < dates.length; i++) {
    const key = `${dates[i].date}T${dates[i].startTime}`;
    if (seen.has(key)) {
      errs.push({
        fieldKey: `multiDates[${i}].duplicate`,
        step: 1,
        message: `Date ${i + 1} duplicates an earlier date+time. Remove or change it.`,
      });
    }
    seen.add(key);
  }
  // Timezone shared from parent — no per-entry validation needed
  return errs;
};
```

**Note:** the existing single-mode logic is preserved verbatim under `validateWhenSingle` (extract refactor only). Existing T-CYCLE-3-* tests for Step 2 still pass.

#### 3.2.2 `computePublishability` no change

`computePublishability` calls `validatePublish` which calls `validateStep(1, draft)` which now branches via `validateWhen`. No code change required to `computePublishability`. ✅

---

### 3.3 Display helper — NEW `mingla-business/src/utils/eventDateDisplay.ts`

Consolidates the 3 duplicate `formatDateLine` / `formatDateLabel` copies (HIDDEN-2 in investigation). Add N-date formatters.

```ts
/**
 * Centralised date-display helpers for event surfaces. Replaces the
 * duplicated `formatDateLine` / `formatDateLabel` copies in:
 *   - CreatorStep2When.tsx
 *   - CreatorStep7Preview.tsx
 *   - PreviewEventView.tsx
 *
 * Per Cycle 4 spec §3.3 + investigation HIDDEN-2.
 */

import type { DraftEvent, MultiDateEntry, RecurrenceRule } from "../store/draftEventStore";
import { expandRecurrenceToDates, formatRecurrenceLabel } from "./recurrenceRule";

/** "Mon 12 May" — short weekday + day + month abbreviated. */
export const formatShortDate = (iso: string): string => { /* impl */ };

/** "Monday 12 May 2026" — full weekday + day + month + year. */
export const formatLongDate = (iso: string): string => { /* impl */ };

/** "Mon 12 May · 21:00" — for mini-card / hero / preview eyebrow */
export const formatSingleDateLine = (date: string | null, doorsOpen: string | null): string => { /* impl */ };

/** "Repeats every Mon · 12 dates" — for recurring mini-card sub-line. */
export const formatRecurringSummary = (rule: RecurrenceRule, firstDate: string): string => { /* impl */ };

/** "5 dates · first Fri 12 May" — for multi-date mini-card sub-line. */
export const formatMultiDateSummary = (dates: MultiDateEntry[]): string => { /* impl */ };

/** Returns formatted strings for accordion expand list. */
export const formatRecurringDatesList = (rule: RecurrenceRule, firstDate: string): string[] => {
  const dates = expandRecurrenceToDates(rule, firstDate);
  return dates.map((d) => formatLongDate(toIso(d)));
};

/** Returns the first/eyebrow date+time line for a draft regardless of mode. */
export const formatDraftDateLine = (draft: DraftEvent): string => {
  if (draft.whenMode === "single") {
    return formatSingleDateLine(draft.date, draft.doorsOpen);
  }
  if (draft.whenMode === "recurring" && draft.date !== null) {
    return formatSingleDateLine(draft.date, draft.doorsOpen);
  }
  if (draft.whenMode === "multi_date" && draft.multiDates !== null && draft.multiDates.length > 0) {
    return formatSingleDateLine(draft.multiDates[0].date, draft.multiDates[0].startTime);
  }
  return "Date TBD";
};

/** Returns the secondary "pill" sub-line for recurring/multi-date modes. Empty for single. */
export const formatDraftDateSubline = (draft: DraftEvent): string | null => {
  if (draft.whenMode === "single") return null;
  if (draft.whenMode === "recurring" && draft.recurrenceRule !== null && draft.date !== null) {
    return formatRecurringSummary(draft.recurrenceRule, draft.date);
  }
  if (draft.whenMode === "multi_date" && draft.multiDates !== null) {
    return formatMultiDateSummary(draft.multiDates);
  }
  return null;
};
```

**Implementor responsibility:** flesh out `formatShortDate`, `formatLongDate`, `formatSingleDateLine` from the existing copies (verbatim port; preserve `en-GB` locale + `weekday: "short"` etc.).

---

### 3.4 Recurrence helper — NEW `mingla-business/src/utils/recurrenceRule.ts`

```ts
/**
 * Recurrence-rule helpers — preset → display label, expansion to dates,
 * and RFC 5545 RRULE string emitter (consumed by Cycle 9 publish edge fn).
 *
 * Per Cycle 4 spec §3.4. RFC 5545 emit is unused in Cycle 4 (frontend-only)
 * but exported so Cycle 9 backend integration is one import away.
 */

import type { RecurrenceRule, Weekday } from "../store/draftEventStore";

/** Display label per preset. Used by the preset-row Pressable + Preview pill. */
export const formatRecurrenceLabel = (rule: RecurrenceRule, firstDate: string): string => {
  // Examples:
  //   daily               → "Every day"
  //   weekly + MO         → "Every Monday"
  //   biweekly + MO       → "Every other Monday"
  //   monthly_dom + 15    → "Monthly on the 15th"
  //   monthly_dow + 1·MO  → "Monthly on the 1st Monday"
};

/** Expand a recurrence rule starting from firstDate to a Date[]. Capped at 52 occurrences. */
export const expandRecurrenceToDates = (rule: RecurrenceRule, firstDate: string): Date[] => {
  // Walk forward from firstDate emitting dates per preset shape until termination is reached.
  // Termination kind="count": emit exactly count dates.
  // Termination kind="until": emit dates until date > until.
  // Hard cap 52 occurrences (matches recurrence.count max).
};

/** RFC 5545 RRULE string. Format: "FREQ=...;BYDAY=...;UNTIL=YYYYMMDDTHHMMSSZ" or "FREQ=...;COUNT=N". */
export const recurrenceRuleToRfc5545 = (rule: RecurrenceRule, firstDate: string): string => {
  // [TRANSITIONAL] consumed by Cycle 9 publish edge function. Unused in Cycle 4.
};

/** Returns the weekday code (MO/TU/...) for an ISO YYYY-MM-DD date. */
export const weekdayOfIso = (iso: string): Weekday => {
  // parseDateString → getDay() → map [SU,MO,TU,WE,TH,FR,SA] index → Weekday code
};

/** Long human label for a weekday code. Used in error messages. */
export const formatWeekdayLong = (w: Weekday): string => {
  // MO → "Monday", TU → "Tuesday", etc.
};
```

**Test cases the implementor must hand-verify:**
- `daily` from 2026-05-12 + count=4 → [05-12, 05-13, 05-14, 05-15]
- `weekly` BYDAY=MO from 2026-05-12 (Tue) + count=3 → snaps to 2026-05-18 then [05-18, 05-25, 06-01]
- `biweekly` BYDAY=FR from 2026-05-15 + count=4 → [05-15, 05-29, 06-12, 06-26]
- `monthly_dom` BYMONTHDAY=15 from 2026-05-12 + count=3 → [05-15, 06-15, 07-15]
- `monthly_dow` BYDAY=MO BYSETPOS=1 from 2026-05-12 + until=2026-08-31 → [06-01, 07-06, 08-03]

**No Cycle 4 runtime calls `recurrenceRuleToRfc5545`** — it's dead-but-exported per spec contract. Add `// [TRANSITIONAL] Cycle 9 backend consumes — do not remove` above the export.

---

### 3.5 Step 2 component — `mingla-business/src/components/event/CreatorStep2When.tsx`

#### 3.5.1 Top-level structure

```
<View>
  ┌─────────────────────────────────────────────┐
  │ Segmented control: Single | Recurring | Multi-date │ ← NEW (replaces Repeats Pressable)
  └─────────────────────────────────────────────┘
  
  {whenMode === "single" ? <SingleModeBody /> : null}
  {whenMode === "recurring" ? <RecurringModeBody /> : null}
  {whenMode === "multi_date" ? <MultiDateModeBody /> : null}

  {/* Timezone always shown — applies to all modes */}
  <TimezoneRow />
  
  {/* DateTimePicker (existing iOS Sheet wrap + Android dialog) */}
  {/* Existing pickers reused — no change */}
</View>
```

#### 3.5.2 Segmented control (replace lines 264–276 + delete 441–463)

```tsx
<View style={styles.segmentRow}>
  <Pressable
    onPress={() => handleModeSwitch("single")}
    accessibilityRole="button"
    accessibilityState={{ selected: draft.whenMode === "single" }}
    style={[styles.segment, draft.whenMode === "single" && styles.segmentActive]}
  >
    <Text style={[styles.segmentLabel, draft.whenMode === "single" && styles.segmentLabelActive]}>
      Single
    </Text>
  </Pressable>
  <Pressable
    onPress={() => handleModeSwitch("recurring")}
    accessibilityRole="button"
    accessibilityState={{ selected: draft.whenMode === "recurring" }}
    style={[styles.segment, draft.whenMode === "recurring" && styles.segmentActive]}
  >
    <Text style={[styles.segmentLabel, draft.whenMode === "recurring" && styles.segmentLabelActive]}>
      Recurring
    </Text>
  </Pressable>
  <Pressable
    onPress={() => handleModeSwitch("multi_date")}
    accessibilityRole="button"
    accessibilityState={{ selected: draft.whenMode === "multi_date" }}
    style={[styles.segment, draft.whenMode === "multi_date" && styles.segmentActive]}
  >
    <Text style={[styles.segmentLabel, draft.whenMode === "multi_date" && styles.segmentLabelActive]}>
      Multi-date
    </Text>
  </Pressable>
</View>
```

**Style tokens:** reuse glass.tint.profileBase + glass.border.profileBase for inactive; accent.tint + accent.warm for active. Match Step 1 format-pill visual treatment for consistency (verify against `CreatorStep1Basics.tsx`).

#### 3.5.3 Mode-switch handler (Q-2 implementation)

```tsx
const [pendingMode, setPendingMode] = useState<WhenMode | null>(null);

const handleModeSwitch = useCallback((target: WhenMode): void => {
  if (target === draft.whenMode) return;

  const isLossy =
    (draft.whenMode === "multi_date" && (draft.multiDates?.length ?? 0) > 1)
    && (target === "single" || target === "recurring");

  if (isLossy) {
    setPendingMode(target);
    return; // ConfirmDialog will handle.
  }
  applyModeSwitch(draft.whenMode, target);
}, [draft]);

const applyModeSwitch = useCallback((from: WhenMode, to: WhenMode): void => {
  // Build patch per the table in investigation Q-2.
  let patch: Partial<DraftEvent> = { whenMode: to };
  if (from === "single" && to === "recurring") {
    // Preserve date/doors/ends; init recurrenceRule with sensible default.
    const dow = draft.date !== null ? weekdayOfIso(draft.date) : "MO";
    patch.recurrenceRule = { preset: "weekly", byDay: dow, termination: { kind: "count", count: 4 } };
    patch.multiDates = null;
  } else if (from === "single" && to === "multi_date") {
    // Preserve date/doors/ends as multiDates[0]; require user to add 2nd before publish.
    if (draft.date !== null) {
      patch.multiDates = [{
        id: generateDraftId(),
        date: draft.date,
        startTime: draft.doorsOpen ?? "21:00",
        endTime: draft.endsAt ?? "03:00",
        overrides: { title: null, description: null, venueName: null, address: null, onlineUrl: null },
      }];
    } else {
      patch.multiDates = [];
    }
    patch.recurrenceRule = null;
  } else if (from === "recurring" && to === "single") {
    patch.recurrenceRule = null;
    patch.multiDates = null;
  } else if (from === "recurring" && to === "multi_date") {
    if (draft.date !== null) {
      patch.multiDates = [{
        id: generateDraftId(),
        date: draft.date,
        startTime: draft.doorsOpen ?? "21:00",
        endTime: draft.endsAt ?? "03:00",
        overrides: { title: null, description: null, venueName: null, address: null, onlineUrl: null },
      }];
    } else {
      patch.multiDates = [];
    }
    patch.recurrenceRule = null;
  } else if (from === "multi_date" && to === "single") {
    const first = draft.multiDates?.[0];
    if (first !== undefined) {
      patch.date = first.date;
      patch.doorsOpen = first.startTime;
      patch.endsAt = first.endTime;
    }
    patch.recurrenceRule = null;
    patch.multiDates = null;
  } else if (from === "multi_date" && to === "recurring") {
    const first = draft.multiDates?.[0];
    if (first !== undefined) {
      patch.date = first.date;
      patch.doorsOpen = first.startTime;
      patch.endsAt = first.endTime;
      const dow = weekdayOfIso(first.date);
      patch.recurrenceRule = { preset: "weekly", byDay: dow, termination: { kind: "count", count: 4 } };
    } else {
      patch.recurrenceRule = { preset: "weekly", byDay: "MO", termination: { kind: "count", count: 4 } };
    }
    patch.multiDates = null;
  }
  updateDraft(patch);
}, [draft, updateDraft]);

// ConfirmDialog at root JSX of Step 2
<ConfirmDialog
  visible={pendingMode !== null}
  onClose={() => setPendingMode(null)}
  onConfirm={() => {
    if (pendingMode !== null) applyModeSwitch(draft.whenMode, pendingMode);
    setPendingMode(null);
  }}
  title="Switch mode?"
  description={pendingMode === "single"
    ? `You'll keep date 1 and lose ${(draft.multiDates?.length ?? 0) - 1} other date(s).`
    : `You'll keep date 1, lose ${(draft.multiDates?.length ?? 0) - 1} other date(s), and convert to a recurring pattern.`
  }
  confirmLabel="Switch"
  destructive
/>
```

#### 3.5.4 Recurring mode body

```
<RecurringModeBody>
  • Date row              ← uses existing date picker (= first occurrence)
    + sub-caption: "Snapped to {dow}" if auto-snap fired (pure display, no state)
  • Doors open / Ends row ← existing
  • Repeat row            ← preset Pressable → opens RecurrencePresetSheet
    Display: formatRecurrenceLabel(rule, date)
  • Termination row       ← Pressable → opens TerminationSheet
    Display: "{count} occurrences" OR "Until {date}"
</RecurringModeBody>
```

**RecurrencePresetSheet:**
- 5 rows: Daily / Weekly / Every 2 weeks / Monthly (by day-of-month) / Monthly (by weekday)
- For Weekly, Biweekly, Monthly-by-weekday: also show a sub-row "On {day-picker}" (wraps to a weekday picker — 7 Pressables)
- For Monthly-by-day-of-month: sub-row "Day {day-of-month-picker}" (numeric stepper 1–28)
- For Monthly-by-weekday: sub-row "Which week? 1st / 2nd / 3rd / 4th / Last" (5 Pressables)

**TerminationSheet:**
- Toggle: "End after N occurrences" OR "End on date"
- If count: numeric Input (1–52)
- If until: date Pressable → opens DateTimePicker (existing iOS Sheet wrap)
- Footer caption: "Recurring events must end. We support up to 52 occurrences or 1 year out."

**Day-of-week mismatch (REVISED 2026-04-30 — no auto-snap):**
- When user picks a `byDay` weekday that doesn't match `draft.date`'s actual weekday: do NOT auto-update the date. Instead, validation pushes `recurrence.dayMismatch` error (see §3.2.1).
- Inline rendering: red border on the Date row + helper-error text "First occurrence is Tuesday but pattern is Monday. Pick a matching date or change the day."
- Continue button blocked until either (a) the user picks a Monday date OR (b) the user changes `byDay` to match the date.
- Rationale: silent state mutation surprises users; explicit fix preserves trust.

#### 3.5.5 Multi-date mode body

```
<MultiDateModeBody>
  • Pressable "+ Add date" → opens AddDateSheet
  • List of MultiDateEntry rows (auto-sorted ascending):
    ┌───────────────────────────────────────────┐
    │  Mon 12 May 21:00 → 03:00                 │  ← formatted by helper
    │  + override pencil  + delete trash        │
    └───────────────────────────────────────────┘
  • Footer caption: "{N} of 24 dates added · need at least 2 to publish"
  
  AddDateSheet (Sheet snapPoint="half"):
    • Date picker (DateTimePicker reused)
    • Start time picker  ← defaults to first row's start, or 21:00 if first
    • End time picker    ← defaults to first row's end, or 03:00
    • [Cancel] [Add date] dock
    • Add validates: not in past, not duplicate of existing date+startTime
  
  PerDateOverrideSheet (Sheet snapPoint="full"):
    • Title input    placeholder: parent draft.name
    • Description input (multiline) placeholder: parent draft.description
    • Venue name + address inputs (in_person/hybrid only)
    • Online URL input (online/hybrid only)
    • [Cancel] [Save changes] dock
    • All fields optional (empty = inherit parent)
  
  Per-row delete: ConfirmDialog "Remove this date? You'll lose any overrides for it."
  Cannot delete if multiDates.length === 2 (would drop below min) → toast "Multi-date events need at least 2 dates."
</MultiDateModeBody>
```

**Per-row sort:** auto-sort ascending by date+startTime on every add/edit. Implementor: use `multiDates.sort((a, b) => (a.date+a.startTime).localeCompare(b.date+b.startTime))` after each mutation.

#### 3.5.6 Existing single-mode body extracted into a sub-component (refactor)

The existing date/doors/ends/timezone JSX (lines 278–379) wraps into `<SingleModeBody draft={draft} updateDraft={updateDraft} ... />`. **Behavior unchanged.** Doors/ends/timezone stay shared across all modes (Recurring also uses them; Multi-date inherits timezone but uses per-row startTime/endTime).

---

### 3.6 Per-date override sheet — NEW `mingla-business/src/components/event/MultiDateOverrideSheet.tsx`

```tsx
/**
 * MultiDateOverrideSheet — edit overrides for one MultiDateEntry.
 *
 * Inputs:
 *   - title (single-line, optional)
 *   - description (multiline, optional)
 *   - venueName (single-line, conditional on draft.format)
 *   - address (multiline, conditional on draft.format)
 *   - onlineUrl (single-line with URL validation, conditional)
 *
 * Empty/whitespace-only = inherit parent draft. Placeholders show
 * parent value so user sees what they'd inherit.
 *
 * Per Cycle 4 spec §3.6.
 */

interface MultiDateOverrideSheetProps {
  visible: boolean;
  onClose: () => void;
  onSave: (overrides: MultiDateEntry["overrides"]) => void;
  entry: MultiDateEntry | null;
  parentDraft: DraftEvent; // for placeholder inheritance
}
```

- Sheet primitive (DEC-085 portal-respecting)
- snapPoint="full" (4+ inputs)
- Keyboard handling: same pattern as Cycle 3 ticket sheet — Keyboard listener + dynamic `paddingBottom`
- Action dock at bottom (Cancel ghost + Save primary), matching Cycle 3 dock pattern (GlassCard variant="elevated" radius="xxl" padding=0 + inner View row)
- Title: "Edit date {N}" where N = 1-indexed position in multiDates list

**Validation:** none on overrides (parent fields hold validation). Save is always enabled.

---

### 3.7 Preview integration

#### 3.7.1 `CreatorStep7Preview.tsx` (Step 7 mini card)

Replace `formatDateLine` import with new helpers. Mini card body becomes:

```tsx
<View style={styles.miniBody}>
  <Text style={styles.miniDate}>{formatDraftDateLine(draft)}</Text>
  <Text style={styles.miniTitle} numberOfLines={1}>{titleLine}</Text>
  <Text style={styles.miniVenue} numberOfLines={1}>
    {venueLine} · {priceLine}
  </Text>
  {/* NEW — N-date pill for non-single modes */}
  {formatDraftDateSubline(draft) !== null ? (
    <View style={styles.recurrencePillRow}>
      <Pill variant="info">{formatDraftDateSubline(draft)}</Pill>
    </View>
  ) : null}
</View>
```

**Pill variant:** if `Pill` doesn't have an `info` variant, reuse `draft` variant (gray background, primary text). Implementor verifies + adds variant if needed (but only if minor; otherwise just use existing variant).

#### 3.7.2 `PreviewEventView.tsx` (full preview)

Replace single-line `dateLine` rendering with:

```tsx
<View style={styles.titleBlockText}>
  <Text style={styles.dateLine}>{formatDraftDateLine(draft)}</Text>
  <Text style={styles.titleLine}>{titleLine}</Text>
  
  {/* NEW — N-date pill + accordion expand */}
  {formatDraftDateSubline(draft) !== null ? (
    <View style={styles.previewRecurrencePillRow}>
      <Pressable
        onPress={() => setShowAllDates((s) => !s)}
        accessibilityRole="button"
        accessibilityLabel={showAllDates ? "Collapse date list" : "Show all dates"}
      >
        <Pill variant="info">
          {formatDraftDateSubline(draft)} · {showAllDates ? "Hide" : "Show all"}
        </Pill>
      </Pressable>
    </View>
  ) : null}
  
  {/* Accordion expand */}
  {showAllDates ? (
    <View style={styles.expandedDatesList}>
      {expandedDates.slice(0, expandedDates.length > 20 && !showAll20 ? 10 : expandedDates.length).map((dateLine, i) => (
        <View key={i} style={styles.expandedDateRow}>
          <Text style={styles.expandedDateText}>{dateLine}</Text>
          {/* multi_date mode: show row pencil; routes to /event/{id}/edit?step=1 */}
          {draft.whenMode === "multi_date" ? (
            <Pressable onPress={() => onEditStep(1)} accessibilityLabel={`Edit date ${i + 1}`}>
              <Icon name="edit" size={14} color={textTokens.tertiary} />
            </Pressable>
          ) : null}
        </View>
      ))}
      {expandedDates.length > 20 && !showAll20 ? (
        <Pressable onPress={() => setShowAll20(true)}>
          <Text>Show all {expandedDates.length}</Text>
        </Pressable>
      ) : null}
    </View>
  ) : null}
</View>
```

**Where `expandedDates` comes from:**
- `recurring`: `formatRecurringDatesList(draft.recurrenceRule, draft.date)`
- `multi_date`: `draft.multiDates.map(e => formatLongDate(e.date) + " · " + e.startTime)`

#### 3.7.3 Preview accordion override-sheet entry (REVISED 2026-04-30)

Per orchestrator+user steering on Q-5: Preview's accordion row pencils (multi-date mode only) **open `MultiDateOverrideSheet` directly** — same sheet used in Step 2's MultiDateModeBody. No route-back-to-Step-2 indirection.

**Wiring:**
- `PreviewEventView` accepts a new prop `onEditMultiDateOverride: (entryId: string) => void` (alongside existing `onEditStep`).
- The route handler `app/event/[id]/preview.tsx` owns sheet state for the override sheet (so the sheet renders ABOVE Preview's portal context — I-13 compliance).
- Sheet save fires `updateDraft({ multiDates: <patched array> })` directly via `useDraftEventStore.updateDraft`.
- After save, sheet closes and Preview re-renders with the override applied.

**Reused entry points (already in spec §3.5.5):** Step 2 multi-date row pencil also opens this same sheet. Both call sites use `MultiDateOverrideSheet` with the same props contract.

**Recurring mode accordion rows:** read-only — no pencil. Rationale: recurring is a generated pattern, not user-curated dates; per-occurrence overrides aren't supported (per cycle scope).

---

### 3.8 Publish gate (J-E8)

#### 3.8.1 New error keys (already covered in §3.2)

`PublishErrorsSheet` is field-key-driven; no code change. Verify the existing sheet correctly maps `step: 1` to a Fix-jump back to Step 2 (read `PublishErrorsSheet.tsx` to confirm).

#### 3.8.2 Publish modal copy variants — `EventCreatorWizard.tsx` line 613–620

```tsx
<ConfirmDialog
  visible={publishConfirmVisible}
  onClose={() => setPublishConfirmVisible(false)}
  onConfirm={handleConfirmPublish}
  title={publishModalTitle}
  description={publishModalDescription}
  confirmLabel="Publish"
/>
```

Where:

```ts
const publishModalTitle = useMemo<string>(() => {
  switch (liveDraft.whenMode) {
    case "single": return "Publish event?";
    case "recurring": {
      const count = liveDraft.recurrenceRule !== null && liveDraft.date !== null
        ? expandRecurrenceToDates(liveDraft.recurrenceRule, liveDraft.date).length
        : 0;
      return `Publish recurring event? ${count} occurrences will be created.`;
    }
    case "multi_date": return `Publish event with ${liveDraft.multiDates?.length ?? 0} dates?`;
  }
}, [liveDraft]);
```

Description stays "Public sale starts immediately. You can edit details after publishing." for all variants.

---

### 3.9 Routes — UNCHANGED

`mingla-business/app/event/create.tsx`, `mingla-business/app/event/[id]/edit.tsx`, `mingla-business/app/event/[id]/preview.tsx` — **no changes**. The wizard handles mode internally.

---

## 4. Success criteria (numbered, observable, testable)

1. **AC-1** Step 2 renders a 3-segment control labelled "Single | Recurring | Multi-date"
2. **AC-2** Tapping "Recurring" hides the (no-longer-existing) Cycle-3 "Repeats" sheet — sheet is removed entirely
3. **AC-3** Tapping "Recurring" shows: date row + doors row + ends row + Repeat row + Termination row + Timezone row (in that order)
4. **AC-4** Recurrence preset sheet shows 5 rows in order: Daily / Weekly / Every 2 weeks / Monthly (by day) / Monthly (by weekday)
5. **AC-5** Selecting "Weekly" in preset sheet auto-sets `byDay` to the weekday of `draft.date` (or "MO" if date null)
6. **AC-6** Picking `byDay=MO` with `draft.date=Tue 12 May 2026` does NOT mutate the date. Date row shows red border + helper "First occurrence is Tuesday but pattern is Monday. Pick a matching date or change the day." Continue/publish blocked until resolved.
7. **AC-7** Termination sheet shows toggle "End after N" / "End on date"; default is `count: 4`; max count 52; max until 1 year out
8. **AC-8** Tapping "Multi-date" segment with no prior multiDates shows empty list + "+ Add date" button + caption "0 of 24 dates added · need at least 2 to publish"
9. **AC-9** "+ Add date" sheet has date picker + start/end time pickers; defaults pull from existing first row (or 21:00 / 03:00 fallback)
10. **AC-10** Adding a date that duplicates `existingDate+existingStartTime` shows error toast "Already added that date+time"; entry not added
11. **AC-11** Adding a past date shows error toast "Can't add past dates"; entry not added
12. **AC-12** Multi-date list auto-sorts chronologically after every add/edit
13. **AC-13** Per-row edit pencil opens MultiDateOverrideSheet; placeholders show parent draft values
14. **AC-14** Per-row delete shows ConfirmDialog; deleting when length=2 shows toast "Multi-date events need at least 2 dates"; deletion blocked
15. **AC-15** Switching from `multi_date` (with 3+ dates) to `single` shows ConfirmDialog "You'll keep date 1 and lose 2 other date(s)"
16. **AC-16** Switching from `multi_date` (with 3+ dates) to `recurring` shows ConfirmDialog "You'll keep date 1, lose 2 other date(s), and convert to a recurring pattern"
17. **AC-17** Switching from `single` → `recurring` preserves date+doors+ends; recurrenceRule defaults to weekly + count 4 + byDay = weekday-of-date
18. **AC-18** Switching from `single` → `multi_date` with `draft.date` set creates multiDates[0] from date+doors+ends
19. **AC-19** Step 7 mini card shows recurring summary pill: "Repeats every Monday · 4 dates"
20. **AC-20** Step 7 mini card shows multi-date summary pill: "5 dates · first Fri 12 May"
21. **AC-21** PreviewEventView hero shows N-date pill below title block; tapping pill expands accordion list of formatted dates
22. **AC-22** Accordion expanded list caps at 10 rows for >20-date events; "Show all (N)" button reveals full list
23. **AC-23** In multi_date mode, accordion rows show an edit pencil that opens `MultiDateOverrideSheet` directly (same sheet as Step 2's row pencil). Recurring-mode rows have NO pencil (read-only).
24. **AC-24** Publish modal title for recurring: "Publish recurring event? {N} occurrences will be created."
25. **AC-25** Publish modal title for multi-date: "Publish event with {N} dates?"
26. **AC-26** Validation blocks publish for recurring with `until <= firstDate`
27. **AC-27** Validation blocks publish for multi_date with `length < 2`
28. **AC-28** Validation blocks publish for multi_date with two entries having identical `date+startTime`
29. **AC-29** Schema v2 → v3 migration: existing single-mode draft loads as `whenMode="single"` with `recurrenceRule=null` and `multiDates=null`; user can resume normally
30. **AC-30** `repeats` field is removed from DraftEvent type and from migrated drafts
31. **AC-31** Logout via `clearAllStores()` wipes all drafts including recurring + multi-date drafts
32. **AC-32** Three duplicate `formatDateLine` / `formatDateLabel` copies are removed from CreatorStep2When/CreatorStep7Preview/PreviewEventView; all use new `eventDateDisplay.ts` helper
33. **AC-33** TypeScript strict mode: zero new `any`, zero new `@ts-ignore`, all functions have explicit return types
34. **AC-34** No new external libs added (verify package.json delta = 0 lines added)

---

## 5. Test matrix

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| T-01 | Single mode unchanged | Existing v2 draft loads | Renders date/doors/ends as Cycle 3 did | Migration + Step 2 |
| T-02 | Switch single → recurring | Tap "Recurring" segment | Body shows recurring mode; rule = weekly+count=4+byDay=weekday-of-date | Component + State |
| T-03 | Switch single → multi-date | Tap "Multi-date" segment with date set | multiDates=[entry-from-date]; UI shows 1 row | Component + State |
| T-04 | Switch multi-date (3+) → single | Tap "Single" with 3 dates | ConfirmDialog appears; confirm → multiDates=null, date=multiDates[0].date | Component + ConfirmDialog |
| T-05 | Recurrence preset selection | Open preset sheet, tap "Weekly" | rule.preset="weekly"; byDay defaults to weekday-of-firstDate | Component + helper |
| T-06 | Day mismatch error | Pick byDay=MO with date=Tue | Validation pushes `recurrence.dayMismatch`; date row shows red border + helper text; Continue blocked. No silent date mutation. | Validator + Component |
| T-06b | Day mismatch resolved by date change | After T-06, change date to next Monday | Error clears; Continue unblocked | Validator + Component |
| T-06c | Day mismatch resolved by byDay change | After T-06, change byDay to TU | Error clears; Continue unblocked | Validator + Component |
| T-07 | Termination count | Set count=4 | rule.termination={kind:"count",count:4}; expandRecurrenceToDates returns 4 dates | Helper |
| T-08 | Termination until | Set until=2026-08-31 | rule.termination={kind:"until",until:"2026-08-31"}; expand returns dates ≤ until | Helper |
| T-09 | Multi-date add | Open AddDateSheet, pick 12 May 21:00, confirm | multiDates appended; sorted | Component |
| T-10 | Multi-date duplicate add | Add 12 May 21:00 when already exists | Toast "Already added that date+time"; entry not added | Component + validation |
| T-11 | Multi-date past add | Add 1 Jan 2025 | Toast "Can't add past dates"; entry not added | Component + validation |
| T-12 | Multi-date min delete | Delete row with multiDates.length=2 | Toast "Multi-date events need at least 2 dates"; deletion blocked | Component |
| T-13 | Override save | Open override sheet, type title="Special" | multiDates[i].overrides.title="Special" | Component + Sheet |
| T-14 | Override empty | Save sheet with all fields empty | overrides remain null (inherit) | Component |
| T-15 | Step 7 mini-card recurring | recurring + 4 dates | Pill shows "Repeats every {dow} · 4 dates" | Component + helper |
| T-16 | Step 7 mini-card multi-date | multi_date + 5 entries | Pill shows "5 dates · first {short-date}" | Component + helper |
| T-17 | Preview hero recurring expand | Tap "Show all" pill | Accordion shows formatted list of all dates | Component |
| T-18 | Preview hero multi-date 25 entries | Cap behavior | List shows 10 + "Show all (25)" button | Component |
| T-19 | Preview accordion edit pencil (multi) | Tap row pencil in PreviewEventView's expanded list | Opens `MultiDateOverrideSheet` directly; saving updates the entry in-place; Preview re-renders with override applied | Component + Sheet |
| T-19b | Preview accordion edit pencil parity | Verify Step 2 row pencil + Preview row pencil open the SAME sheet with SAME contract | Both call sites identical; sheet behavior identical | Component |
| T-20 | Preview accordion edit pencil (recurring) | Inspect rendered rows in recurring-mode preview accordion | NO pencil — recurring rows are read-only (no per-occurrence overrides) | Component |
| T-21 | Validation: recurring no rule | whenMode="recurring", rule=null | Error "Pick a repeat pattern."; publish blocked | Validator |
| T-22 | Validation: recurring count=0 | count=0 | Error "Number of occurrences must be 1–52."; publish blocked | Validator |
| T-23 | Validation: recurring until before first | until < date | Error "End date must be after first occurrence."; publish blocked | Validator |
| T-24 | Validation: multi-date 1 entry | multiDates.length=1 | Error "Add at least 2 dates."; publish blocked | Validator |
| T-25 | Validation: multi-date 25 entries | length=25 | Error "Maximum is 24 dates."; publish blocked | Validator |
| T-26 | Validation: multi-date past | one entry in past | Error "Date {N} ({iso}) is in the past."; publish blocked | Validator |
| T-27 | Validation: multi-date dup | two entries same date+startTime | Error "Date {N} duplicates an earlier date+time."; publish blocked | Validator |
| T-28 | Publish modal copy single | publish single | Title "Publish event?" (UNCHANGED) | Component |
| T-29 | Publish modal copy recurring | publish weekly + count=4 | Title "Publish recurring event? 4 occurrences will be created." | Component |
| T-30 | Publish modal copy multi-date | publish 5 dates | Title "Publish event with 5 dates?" | Component |
| T-31 | v2→v3 migration | Force-quit with v2 draft, restart | Draft loads with whenMode="single"; works in single mode | Persistence |
| T-32 | v1→v3 migration chain | Force-quit with legacy v1 draft, restart | Draft loads with hideAddressUntilTicket=true + isUnlimited=false + whenMode="single" | Persistence |
| T-33 | Logout clears multi-date draft | Create multi-date with 5 entries; logout | drafts=[] after auth wipe | Constitution #6 |
| T-34 | Constitution #2 — display helpers | grep for `formatDateLine` / `formatDateLabel` in CreatorStep2/CreatorStep7/PreviewEventView | Zero hits (consolidated to eventDateDisplay.ts) | Code review |
| T-35 | Constitution #8 — placeholder removed | grep "More repeat options coming Cycle 4" | Zero hits | Code review |

---

## 6. Invariants

### Preserved (verify at implementation completion)

| ID | Description | Verification |
|----|-------------|--------------|
| I-11 | Format-agnostic ID resolver | `useDraftById(id)` works regardless of mode (test via T-31, T-32) |
| I-12 | Host-bg cascade | Step 2 mode bodies inherit `canvas.discover` via wizard root (visual check) |
| I-13 | Overlay-portal contract | MultiDateOverrideSheet uses Sheet primitive (DEC-085); RecurrencePresetSheet, TerminationSheet, AddDateSheet all use Sheet (visual + code review) |
| Constitution #1 | No dead taps | Every "+", pencil, trash, segment fires correctly (T-09, T-12, T-13, T-19, AC-1) |
| Constitution #2 | One owner per truth | New helper `eventDateDisplay.ts` deduplicates 3 copies (T-34) |
| Constitution #6 | Logout clears | T-33 |
| Constitution #7 | TRANSITIONAL labels | `recurrenceRuleToRfc5545` export labelled; per-date covers / per-date tickets / calendar-grid / RRULE-editor placeholders all labelled in copy |
| Constitution #8 | Subtract before adding | Cycle 3 "Repeats" sheet body removed (T-35) |
| Constitution #10 | Currency-aware | N/A (no money UI changed) |

### New invariants established (for INVARIANT_REGISTRY)

| ID | Description | Why |
|----|-------------|-----|
| **I-14 (proposed)** | **Date-display single source** — All date/time formatting for event surfaces flows through `mingla-business/src/utils/eventDateDisplay.ts`. No component implements its own ISO-to-label formatter. | Prevents the HIDDEN-2 pattern from recurring (3 copies → 4 copies → drift). Constitution #2 enforcement at structural level. Add to INVARIANT_REGISTRY post-Cycle-4. |

---

## 7. Implementation order (numbered, sequential)

1. **Schema v3 + migrator** (`draftEventStore.ts`)
   - Add new types (WhenMode, RecurrencePreset, Weekday, RecurrenceRule, MultiDateEntry)
   - Update DraftEvent interface (add whenMode, recurrenceRule, multiDates; remove repeats)
   - Update DEFAULT_DRAFT_FIELDS
   - Add `upgradeV2DraftToV3` migrator
   - Bump persistOptions.version 2 → 3
   - Update v1→v2→v3 chain in migrate fn
   - **Verify:** TypeScript compiles; existing Cycle 3 tests still pass (run `npm run typecheck` if available)

2. **Recurrence helper** (`recurrenceRule.ts`)
   - `formatRecurrenceLabel`, `expandRecurrenceToDates`, `recurrenceRuleToRfc5545`, `snapDateToWeekday`
   - **Verify:** hand-test the 5 cases listed in §3.4

3. **Display helper** (`eventDateDisplay.ts`)
   - Port `formatShortDate`, `formatLongDate`, `formatSingleDateLine` from existing copies
   - Add `formatRecurringSummary`, `formatMultiDateSummary`, `formatRecurringDatesList`
   - Add `formatDraftDateLine`, `formatDraftDateSubline`
   - **Verify:** existing single-mode behavior unchanged (visual check Step 2 + Step 7 + Preview)

4. **Validation branching** (`draftEventValidation.ts`)
   - Extract single-mode logic to `validateWhenSingle`
   - Add `validateWhenRecurring`, `validateWhenMultiDate`
   - Wire branched dispatch in `validateWhen`
   - **Verify:** all existing T-CYCLE-3-* When tests still pass

5. **Step 2 segmented control + mode dispatch** (`CreatorStep2When.tsx`)
   - Add segmented control component
   - Add `handleModeSwitch` + `applyModeSwitch` + ConfirmDialog for lossy switches
   - Extract existing date/doors/ends/timezone JSX into a `<SingleModeBody>` sub-component
   - Replace "Repeats" Pressable + Sheet with segmented control
   - **DELETE** old Repeats Sheet body (lines 264–276 row + 441–463 sheet)
   - **Verify:** Single mode behaves identically to Cycle 3

6. **Recurring mode body** (continue in `CreatorStep2When.tsx`)
   - Add `<RecurringModeBody>` sub-component
   - Recurrence preset Pressable + RecurrencePresetSheet
   - Termination Pressable + TerminationSheet
   - Auto-snap caption + 3s fade
   - **Verify:** all 5 presets + both termination kinds + auto-snap work

7. **Multi-date mode body** (continue in `CreatorStep2When.tsx`)
   - Add `<MultiDateModeBody>` sub-component
   - + Add date Pressable → AddDateSheet
   - List rendering with edit pencil + delete trash + ConfirmDialog
   - Empty state + min-2 caption + max-24 enforcement
   - Auto-sort on every mutation
   - **Verify:** add/edit/delete/dup/past flows match T-09 through T-12

8. **Per-date override sheet** (`MultiDateOverrideSheet.tsx`)
   - Build sheet per §3.6
   - Wire from MultiDateModeBody row pencil
   - Inheritance placeholders
   - Keyboard handling (Cycle 3 pattern)
   - **Verify:** save populates entry.overrides; empty save → null fields

9. **Step 7 mini card recurrence pill** (`CreatorStep7Preview.tsx`)
   - Replace `formatDateLine` import with `formatDraftDateLine`
   - Add subline pill
   - **Verify:** all 3 modes render correctly in Step 7

10. **PreviewEventView N-date integration** (`PreviewEventView.tsx`)
    - Replace local `formatDateLine` with `formatDraftDateLine`
    - Add subline pill + accordion expand
    - Wire row pencil → `onEditStep(1)` for multi-date mode
    - **Verify:** AC-21 through AC-23

11. **Publish modal copy** (`EventCreatorWizard.tsx`)
    - Add `publishModalTitle` useMemo
    - Wire into ConfirmDialog
    - **Verify:** all 3 mode titles render correctly

12. **Final scan** (no specific file)
    - grep for `formatDateLine`, `formatDateLabel` outside `eventDateDisplay.ts` → must be 0 hits
    - grep "More repeat options coming Cycle 4" → must be 0 hits
    - grep `repeats:` in `draftEventStore.ts` → must be 0 hits
    - TypeScript strict compile check
    - **/ui-ux-pro-max** consultation (per persistent feedback memory) for visual review of segmented control + mode bodies + sheets before reporting "verified"

13. **Implementation report**
    - Write `Mingla_Artifacts/reports/IMPLEMENTATION_BIZ_CYCLE_4_RECURRING_MULTIDATE.md`
    - 35 ACs mapped to verification status
    - 35 Ts mapped to PASS / UNVERIFIED (manual smoke needed)
    - Discoveries section for any side issues

---

## 8. Regression prevention

### Cycle 3 invariants — implementor verifies all preserved

After each major step (5, 6, 7), implementor must:
- Open existing single-mode draft (created pre-Cycle-4) → confirm renders identically
- Run through Cycle 3 J-E1, J-E2, J-E12 happy paths in single mode → all still work
- Confirm clearAllStores() wipes drafts after logout

### New invariant (for INVARIANT_REGISTRY post-Cycle-4)

**I-14: Date-display single source.** All event date/time formatting flows through `mingla-business/src/utils/eventDateDisplay.ts`. Future authors editing event surfaces must reuse helpers, not implement local formatters.

**Protective comment in `eventDateDisplay.ts` head:**
```
/**
 * Centralised event date/time display helpers (I-14 — single source).
 * NEVER implement local ISO-to-label formatters in event components.
 * Reuse the helpers below or extend this file with new ones.
 */
```

### Failure-pattern guard

The most likely regression: **mode-switch silently corrupts state.** Mitigation: `applyModeSwitch` is the SINGLE entry point that touches `draft.whenMode`. The implementor must ensure no other code path writes `whenMode` directly. Add a code-comment guardrail:
```
// Mode is owned by handleModeSwitch — never set whenMode directly.
// Always go through handleModeSwitch / applyModeSwitch so confirm dialog
// + data-preservation logic runs. (I-14 cousin.)
```

---

## 9. Open Questions — orchestrator must confirm before implementor dispatch

These six questions surfaced in the investigation. The recommendations are **the spec's working assumption**. If the user disagrees, the spec gets a single-edit revision before implementor takes over. **DO NOT dispatch the implementor until orchestrator confirms.**

| Q | Question | Spec assumption |
|---|----------|-----------------|
| Q-1 | Step 2 layout — segmented control above + body switches per mode? | YES |
| Q-2 | Mode-switch data behavior? | Preserve where lossless; ConfirmDialog for lossy multi→single and multi→recurring |
| Q-3 | Store derived RFC 5545 string OR compute lazily? | Compute lazily; helper exists but unused in Cycle 4 |
| Q-4 | Preview expand pattern — inline OR Sheet? | Inline accordion; cap 10+show-all for >20 dates |
| Q-5 | Per-date override entry points — multi-date row pencil only OR also Preview pencil? | **REVISED 2026-04-30 by orchestrator+user:** Multi-date row pencil AND Preview accordion row pencil both open `MultiDateOverrideSheet` directly. See §3.7.2 + §3.7.3 for entry-point wiring. |
| Q-6 | Multi-date count cap — 24? | 24 confirmed |
| **Auto-snap (D-FOR-CYCLE4-5)** | **REVISED 2026-04-30 by orchestrator+user:** Auto-snap is removed. When `byDay` doesn't match `draft.date`'s actual weekday, push validation error `recurrence.dayMismatch` blocking continue/publish. User fixes manually by re-picking the date. See §3.2.1 + §3.5.4. |

---

## 10. Discoveries for orchestrator

(Repeated from investigation §8 for spec self-containment)

- **D-FOR-CYCLE4-1:** `repeats: "once"` literal in DraftEvent removed in v3 — verified zero external readers
- **D-FOR-CYCLE4-2:** New helper `eventDateDisplay.ts` consolidates 3 duplicate formatter copies (Constitution #2)
- **D-FOR-CYCLE4-3:** Cycle 9 backend must reckon with "1 event = N event_date rows" for finance reports — `BrandEventStub.eventCount` semantics need clarity
- **D-FOR-CYCLE4-4:** New invariant I-14 (date-display single source) for INVARIANT_REGISTRY post-Cycle-4 close
- **D-FOR-CYCLE4-5:** Auto-snap UX — silent snap forward with 3s caption (vs warn + confirm) — orchestrator may revise to "warn first" if user prefers stricter

---

## 11. End conditions

A passing Cycle 4 implementation:

- ✅ All 35 ACs verified (manually or via TypeScript)
- ✅ All 35 Ts pass (manual smoke or unit-equivalent)
- ✅ Zero new TypeScript errors / warnings
- ✅ Zero new external libs
- ✅ All 3 deduplicated formatter copies removed
- ✅ Cycle 3 single-mode behavior unchanged (regression-checked)
- ✅ `/ui-ux-pro-max` consulted for visual review of segmented control, both new mode bodies, three new sheets, and Preview accordion
- ✅ Implementation report written with 15-section template
- ✅ Discoveries logged

---

**End of spec.**
