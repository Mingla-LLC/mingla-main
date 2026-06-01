# SPEC — ORCH-1019 [Curated-card scheduling: false "could not verify opening hours" warning + missing per-stop addresses in calendar]

- **Mode:** SPEC (contract only — no product code changed here)
- **Date:** 2026-05-30
- **Worktree:** `~/Desktop/mingla-orchs/ORCH-1019-[curated-schedule-hours-calendar-notes]/` on branch `ORCH-1019-curated-schedule-hours-calendar-notes`
- **Investigation (input, PROVEN):** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-1019_CURATED_SCHEDULE_HOURS_AND_CALENDAR_ADDRESSES.md` (committed `69c94d990`)
- **Affected surfaces:** Consumer iOS + Consumer Android (`app-mobile/`, shared code → automatic parity). NOT business / admin / buyer-web.
- **Comms ledger:** read on entry. No BLOCK/WARN entry targets ORCH-1019, `mingla-forensics`, or actionable `ALL` this turn. COMMS-0003 is **N/A** — no external API enum/payload/endpoint is introduced or modified by this spec (the one external-data dependency, `place_pool.utc_offset_minutes` from Google Places v1, is read-only and already wired through `signalRankFetch.ts`; see §B-F2 + §11).
- **Client-only:** No backend / edge / migration / RLS change is REQUIRED. One OPTIONAL generator enhancement is flagged in §11 and explicitly deferred.

---

## 1. Layman summary

When you put a curated multi-stop plan on your calendar, the app today (a) tells you "All Stops Are Open!" even when a stop is actually closed at your arrival time — sending you to a shut venue; and (b) when you reschedule that plan from the Calendar tab, it scares you with "We couldn't verify this place's hours" even though the hours are right there on the card. It also only shows you the FIRST stop's address in the calendar, so you can't see where stops 2, 3, … actually are without digging. This spec fixes all of that: every curated availability check is routed through Mingla's one correct hours reader, the reschedule path is taught that the plan is curated, the device calendar keeps every stop's address on reschedule, and the in-app calendar surfaces every stop's address. The visual layout of that last item (F-5) is handed to a required `mingla-designer` pass; everything else is fully specified here.

---

## 2. Scope & Non-Goals

### In scope (F-1 … F-7 exactly — no more)
- **F-1** 🔴 — Calendar-tab reschedule must recognise curated entries: `entryToCard` carries `stops` + curated fields; the reschedule `<ProposeDateTimeModal>` receives `isCurated`. Kills the false "couldn't verify" warning.
- **F-2** 🔴 — Delete SavedTab's bespoke `checkSingleStopOpen`/`checkAllStopsOpen` day-name parser; route curated all-stops validation through canonical `extractWeekdayText` + `isPlaceOpenAt`. Kills the false "All Stops Are Open!".
- **F-3** 🟠 — `LockedCardSchedulingSheet` passes `isCurated` to the modal (collab parity).
- **F-4** 🟠 — Calendar-tab reschedule device-calendar recreate branch uses `createEventFromCuratedCard` when `stops?.length > 0` (per-stop addresses survive reschedule).
- **F-5** 🟠 — In-app Mingla Calendar entry surfaces EVERY stop's address without extra taps. **Functional/data contract LOCKED here; visual presentation DEFERRED to a required `mingla-designer` pass.**
- **F-6** 🔵 — Fix the doubled/malformed warning copy in `ProposeDateTimeModal`.
- **F-7** 🔵 — Correct `CuratedStop.openingHours` type to the real Google-v1 object shape.
- **Regression invariant + strict-grep gate** forbidding direct day-name key lookups on `openingHours` in `app-mobile`.
- **Two regression tests** (one implementor happy-path, one tester adversarial) that fail-on-revert.

### Non-Goals (explicitly OUT)
- Re-investigating root cause — the investigation is PROVEN; this spec builds the fix.
- Any change to the canonical reader `openingHoursUtils.ts` (it is the reference-correct implementation; do NOT touch it).
- Any change to `ActionButtons.tsx` (ExpandedCardModal scheduling) — already routes through the canonical reader correctly; it is the pattern to copy, not modify.
- Any backend / edge / migration / RLS change. The OPTIONAL per-stop `utcOffsetMinutes` generator enhancement (§11) is **deferred**, NOT in this ORCH.
- The exact visual layout/typography/spacing of the F-5 calendar address presentation — that is the `mingla-designer` pass's deliverable (this spec pins the data + acceptance bar only).
- Regular (single-place) card scheduling behaviour — unchanged. The `null → advisory warning` behaviour for genuine single-place cards is by-design and stays.

### Assumptions (stated, proven in investigation)
- A curated card/entry is identified by `Array.isArray(x.stops) && x.stops.length > 0` (the exact predicate already used at SavedTab.tsx:1229-1231, 1338-1339, ActionButtons.tsx:479, calendarService.ts:247). This is the canonical curated-detection predicate and this spec reuses it verbatim.
- `card_data.stops` (and the curated fields) survive the save→calendar round-trip — confirmed: `calendarService.ts:158-168` allowlist includes `stops`, `cardType`, `tagline`, `totalPriceMin/Max`, `estimatedDurationMinutes`, `experienceType`, `pairingKey`; and `AppStateManager.tsx:587-590` maps `experience: { ...cardData, id }`, so `entry.experience.stops` is present at the reschedule call-site.
- Each `CuratedStop` carries a real `address` string and per-stop `openingHours` (Google-v1 object) — confirmed in DB + generator (`generate-curated-experiences/index.ts:557,567`).

---

## 2.5 Cross-Surface Impact

| # | Surface | Covered? | User-visible behaviour demanded | Files touched | Parity |
|---|---------|----------|----------------------------------|---------------|--------|
| 1 | **Consumer iOS** (`app-mobile/` iOS) | ✅ YES | Curated schedule honestly reports open/closed; reschedule shows the curated flow (no false "couldn't verify"); calendar shows every stop's address; device calendar keeps every stop address on reschedule. | All F-1…F-7 files below | Shared RN code |
| 2 | **Consumer Android** (`app-mobile/` Android) | ✅ YES | Identical to iOS. | Same files | **Automatic** — single shared RN code path. No Android-specific branch in any touched file. |
| 3 | Buyer/anon Web (`mingla-business/`) | ❌ NO | — | — | No curated-card scheduling exists on buyer-web. |
| 4 | Business iOS (`mingla-business/`) | ❌ NO | — | — | No curated-card scheduling in business app. |
| 5 | Business Android | ❌ NO | — | — | Same as #4. |
| 6 | Admin Web (`mingla-admin/`) | ❌ NO | — | — | Admin does not render curated scheduling. |
| 7 | Business Web preview | ❌ NO | — | — | No analog. |

Parity for #1 vs #2 is **automatic** (one shared RN file per finding, no `Platform.select`, no `.ios.tsx`/`.android.tsx` split in any touched file). Per the Phase 2.5 rule, success criteria are written once and apply to both; the tester verifies on iOS Simulator AND Android Emulator (the device-calendar permission flow for F-4 differs per OS at the OS layer, not the app layer — see SC-4 notes).

---

## 3. Layer-by-layer contract

This change touches the **type**, **service**, **component**, and **copy/i18n** layers. No DB / edge / hook / realtime layer is touched.

### 🔒 LOCKED — Canonical-reader rule (governs F-1, F-2, F-3)

All curated availability checks MUST flow through the canonical pair in `app-mobile/src/utils/openingHoursUtils.ts`:
- `extractWeekdayText(openingHours)` — tolerant reader handling Google-v1 (`weekdayDescriptions`), legacy (`weekday_text`), `{lines}`, lowercase day-record, `string[]`, and JSON-string shapes.
- `isPlaceOpenAt(weekdayText, targetDate, utcOffsetMinutes?)` — returns `true | false | null`.

No code under `app-mobile/` may perform a direct day-name key lookup on an `openingHours` value (e.g. `openingHours[dayName]`, `openingHours?.["Saturday"]`, `openingHours[weekday]`). Enforced by the strict-grep gate in §8.

---

### F-7 (do this FIRST — it unmasks F-2 at compile time) 🔵 → 🔒 LOCKED

**Layer:** type.
**File:** `app-mobile/src/types/curatedExperience.ts:18`.

- **Before:** `openingHours: Record<string, string>;`
- **After (🔒 LOCKED exact shape):**
  ```ts
  // ORCH-1019 F-7: runtime value is the raw Google Places v1 object passed
  // through verbatim by generate-curated-experiences (index.ts:567) →
  // signalRankFetch. The old Record<string,string> was a type lie that let
  // SavedTab's bespoke openingHours[dayName] lookup typecheck while missing
  // at runtime. Read ONLY via extractWeekdayText() (openingHoursUtils.ts) —
  // never index a day key directly. Union also admits legacy persisted shapes.
  openingHours:
    | {
        openNow?: boolean;
        periods?: unknown[];
        weekdayDescriptions?: string[];
        nextOpenTime?: string;
        nextCloseTime?: string;
      }
    | Record<string, string>   // legacy lowercase-day-record rows still in prod data
    | string[]
    | string
    | null;
  ```
- **Why this union (not a single shape):** the investigation proved BOTH shapes exist in persisted production rows (current generator → Google-v1 object; older rows → lowercase day record). The union matches `extractWeekdayText`'s accepted input so the canonical reader is the only thing that consumes it.
- **Success criterion:** SC-7.
- **Note:** after this change, the deleted `checkSingleStopOpen` would no longer typecheck (`stop.openingHours?.[dayName]` on a union that no longer guarantees a string-indexable record) — which is the point. F-2's deletion removes it entirely, so no compile error remains.

---

### F-2 🔴 ROOT (most dangerous — false-OK) → 🔒 LOCKED

**Layer:** component (SavedTab scheduling logic).
**File:** `app-mobile/src/components/activity/SavedTab.tsx`.

**Delete entirely:**
- `to24Hour` helper (lines 1086-1090) — only used by `checkSingleStopOpen`.
- `checkSingleStopOpen` (lines 1092-1157).
- `checkAllStopsOpen` (lines 1159-1183).
- The `StopAvailability` interface (lines 1080-1084) is REPLACED (see below) — keep a shaped result, but it is now produced by the canonical path.

**Replace with** a single canonical-reader validator that PRESERVES the existing cumulative-arrival-time logic and the existing alert UX, but produces a CORRECT verdict. Exact contract (🔒 LOCKED behaviour; 🎨 OPEN internal structure):

```ts
// ORCH-1019 F-2: canonical curated all-stops validator. Mirrors the
// reference-correct ActionButtons.tsx:479-511 pattern. NO bespoke day-key
// lookup — extractWeekdayText + isPlaceOpenAt handle every openingHours shape.
interface StopAvailability {
  stopName: string;
  isOpen: boolean;       // true ONLY when isPlaceOpenAt === true OR === null (honest-unknown → advisory, not blocking)
  reason?: string;       // present only when isOpen === false
}

const checkAllStopsOpen = (
  stops: CuratedStop[],
  startTime: Date,
): { allOpen: boolean; results: StopAvailability[] } => {
  let cumulativeMinutes = 0;
  const results: StopAvailability[] = stops.map((stop, idx) => {
    const arrivalTime = new Date(startTime.getTime() + cumulativeMinutes * 60_000);
    const weekdayText = extractWeekdayText(stop.openingHours);
    // Per-stop venue offset if present; else canonical reader's documented
    // device-local fallback (same as ActionButtons reference — see §B-F2).
    const utcOffset = (stop as any).utcOffsetMinutes ?? (stop as any).utc_offset_minutes ?? null;
    const openAtArrival = isPlaceOpenAt(weekdayText, arrivalTime, utcOffset);

    // PRESERVE existing cumulative model (SavedTab.tsx:1170-1174):
    cumulativeMinutes += (stop.estimatedDurationMinutes ?? 45);
    if (idx < stops.length - 1 && stops[idx + 1]?.travelTimeFromPreviousStopMin) {
      cumulativeMinutes += stops[idx + 1].travelTimeFromPreviousStopMin!;
    }

    if (openAtArrival === false) {
      const timeStr = arrivalTime.toLocaleTimeString(getUserLocale(), { hour: 'numeric', minute: '2-digit', hour12: true });
      return { stopName: stop.placeName, isOpen: false, reason: `May be closed at ${timeStr}` };
    }
    // true OR null → not blocking (null = honest-unknown; advisory only,
    // mirrors regular-card null→advisory at ProposeDateTimeModal.tsx:282-284).
    return { stopName: stop.placeName, isOpen: true };
  });
  return { allOpen: results.every((r) => r.isOpen), results };
};
```

**Verdict-semantics 🔒 LOCKED (Constitution #9 — no fabricated availability):**
- `isPlaceOpenAt === false` → stop is CLOSED → counts toward "Some Stops Are Closed".
- `isPlaceOpenAt === true` → OPEN.
- `isPlaceOpenAt === null` (no parseable hours) → treated as OPEN-but-unknown (does NOT block), consistent with the regular-card advisory path and the reference `ActionButtons` (which only flags `=== false`). Rationale: we may NOT fabricate "closed" any more than "open"; honest-unknown is non-blocking everywhere else in the codebase.

**The existing alert UX (lines 1237-1276) is PRESERVED unchanged in copy/structure:**
- `allOpen === true` → `Alert.alert('All Stops Are Open!', 'All N stops are open at <time>. …', [...])` — same buttons/handlers.
- `allOpen === false` → `Alert.alert('Some Stops Are Closed', '… <bulleted closed list> …', [...])` — same buttons/handlers.
The ONLY change is that the verdict is now correct; the closed-list now reads e.g. `• Rey's Restaurant — May be closed at 3:07 PM`.

- **Time basis 🔒 LOCKED:** `isPlaceOpenAt` is given the per-stop `utcOffsetMinutes` when available (so the check uses venue-local time per Constitution #12). When absent it uses the canonical reader's documented device-local fallback — identical to the reference `ActionButtons` call (which passes no offset today). See §B-F2 for the data-source decision and why no backend change is required.
- **Success criterion:** SC-2.

---

### F-1 🔴 ROOT (operator-reported false warning) → 🔒 LOCKED

**Layer:** component (CalendarTab reschedule wiring).
**File:** `app-mobile/src/components/activity/CalendarTab.tsx`.

**(a) `entryToCard` (lines 1948-1971)** — add the curated fields. After the existing keys, append (🔒 LOCKED — every listed field, sourced from `entry.experience` first, falling back to top-level `entry`):

```ts
// ORCH-1019 F-1: carry curated payload so the reschedule modal routes the
// curated flow (canonical per-stop hours) instead of the regular single-place
// flow. entry.experience is { ...card_data, id } (AppStateManager.tsx:587),
// and card_data carries these via the calendarService allowlist (L158-168).
const exp = entry.experience || ({} as any);
return {
  ...existingMappedFields,           // unchanged: id, title, category, …, openingHours, …
  stops: exp.stops,                  // ← presence of this drives isCurated downstream
  cardType: exp.cardType,
  tagline: exp.tagline,
  pairingKey: exp.pairingKey,
  experienceType: exp.experienceType,
  totalPriceMin: exp.totalPriceMin,
  totalPriceMax: exp.totalPriceMax,
  estimatedDurationMinutes: exp.estimatedDurationMinutes,
};
```

**(b) reschedule `<ProposeDateTimeModal>` render (lines 2142-2158)** — add the `isCurated` prop derived from the SAME canonical predicate (🔒 LOCKED):

```tsx
<ProposeDateTimeModal
  …existing props…
  card={entryToCard(entryToReschedule)}
  isCurated={
    Array.isArray((entryToReschedule.experience as any)?.stops) &&
    (entryToReschedule.experience as any).stops.length > 0
  }
/>
```

**(c) The reschedule `onProposeDateTime` handler (CalendarTab `handleProposeDateTime` / the reschedule submit at ~line 599)** must run the curated all-stops validation for curated entries before committing the reschedule, mirroring SavedTab's F-2 validator. 🔒 LOCKED behaviour:
- If the rescheduled entry is curated (`stops?.length > 0`): run the SAME canonical `checkAllStopsOpen` logic (extract a shared helper — see §B-F1) at the chosen datetime. On `allOpen === false`, show the SAME "Some Stops Are Closed" alert and do NOT silently commit. On `allOpen === true`, proceed with the reschedule.
- If regular: unchanged (existing single-place advisory path).
- **Net effect:** the reschedule modal opens with `isCurated=true`, shows the curated footer/header (no "Check Availability" regular path → no `isPlaceOpenAt(null)` → no "couldn't verify" banner), and curated validation is honest.
- **Success criterion:** SC-1.

---

### F-3 🟠 collab parity → 🔒 LOCKED

**Layer:** component (collab lock-in sheet).
**File:** `app-mobile/src/components/session/LockedCardSchedulingSheet.tsx:194-201`.

- **Before:** `<ProposeDateTimeModal visible … card={cardForModal} onProposeDateTime={handleDatePicked} />` (no `isCurated`).
- **After (🔒 LOCKED):**
  ```tsx
  <ProposeDateTimeModal
    visible={visible}
    onClose={resetAndClose}
    card={cardForModal}
    onProposeDateTime={handleDatePicked}
    isCurated={
      Array.isArray((cardData as any)?.stops) &&
      (cardData as any).stops.length > 0
    }
  />
  ```
- `cardForModal` already spreads `...cardData` (line 192), so `stops` is present in the card object; only the `isCurated` prop is missing. This is the minimal correct fix.
- **Success criterion:** SC-3.

---

### F-4 🟠 reschedule device-calendar address loss → 🔒 LOCKED

**Layer:** component (CalendarTab reschedule device-calendar fallback).
**File:** `app-mobile/src/components/activity/CalendarTab.tsx:649-651`.

- **Before:** `const deviceEvent = DeviceCalendarService.createEventFromCard(cardData, date, entryToReschedule.duration_minutes || 120);`
- **After (🔒 LOCKED):**
  ```ts
  // ORCH-1019 F-4: curated reschedule must rebuild with the multi-stop builder
  // so every stop's "Stop N / Address: …" line survives (createEventFromCard
  // emits only the first stop's address). Mirrors the initial-schedule branch
  // at SavedTab.tsx:1415-1420.
  const isCuratedEntry = Array.isArray(cardData.stops) && cardData.stops.length > 0;
  const deviceEvent = isCuratedEntry
    ? DeviceCalendarService.createEventFromCuratedCard(
        cardData,
        date,
        cardData.estimatedDurationMinutes || entryToReschedule.duration_minutes || 120,
      )
    : DeviceCalendarService.createEventFromCard(
        cardData,
        date,
        entryToReschedule.duration_minutes || 120,
      );
  ```
- `cardData` here = `entryToReschedule.experience || entryToReschedule` (line 623), which carries `stops` + `estimatedDurationMinutes`. `createEventFromCuratedCard` (deviceCalendarService.ts:218-255) emits per-stop `Stop N: name / Address: …` lines — exactly the data the operator needs.
- **Scope note 🔒 LOCKED:** only the delete-then-recreate fallback branch (no stored `device_calendar_event_id`) is touched. The primary branch (line 625-631, stored ID present) only patches start/end dates and preserves the original notes — it never loses addresses and is NOT modified.
- **Success criterion:** SC-4.

---

### F-6 🔵 doubled warning copy → 🔒 LOCKED

**Layer:** copy (component JSX + i18n).
**File:** `app-mobile/src/components/activity/ProposeDateTimeModal.tsx:618-633`.

- **Root of the bug:** the JSX hardcodes `{availabilityAssumption}. Please verify opening hours before scheduling.` where `availabilityAssumption` is already the i18n string `proposeDateTimeModal.hoursUnknown` = `"We couldn't verify this place's hours. Please double-check before scheduling."` → on screen the user sees a double period AND a duplicated trailing clause.
- **After (🔒 LOCKED):** render the assumption string verbatim, with NO appended clause:
  ```tsx
  <Text style={styles.assumptionWarningText}>
    {availabilityAssumption}
  </Text>
  ```
- **Corrected single-sentence on-screen copy (🔒 LOCKED):** `We couldn't verify this place's hours. Please double-check before scheduling.` (the existing `hoursUnknown` value, unchanged).
- **i18n note 🔒 LOCKED:** do NOT use the `proposeDateTimeModal.assumptionWarning` key (`'{{assumption}}. Please verify opening hours before scheduling.'`) — it bakes in the same duplication. Leave that key in the file (it may have other historical consumers) but the warning banner must render `availabilityAssumption` alone. Do not change `hoursUnknown`'s value.
- **Success criterion:** SC-6.
- **Note:** this banner only appears on the regular-card advisory path. After F-1/F-3, curated cards no longer route here, so the user-facing impact is the rare genuine single-place card with unparseable hours — the copy must still be correct.

---

## 4. F-5 — In-app calendar surfaces every stop's address (functional contract LOCKED; presentation DEFERRED to designer)

**Layer:** component (CalendarTab entry row + ExpandedCardModal curated detail).
**Files:** `app-mobile/src/components/activity/CalendarTab.tsx:1583-1590` (entry row location line) and/or `app-mobile/src/components/ExpandedCardModal.tsx:1243-1256` (per-stop address, currently `{isExpanded && …}`-gated).

### 🔒 LOCKED — Data & behaviour contract (acceptance bar)
1. **From the calendar, a user can read the address of every stop needed to execute the plan, without opening a second screen and without tapping to expand each stop individually.** This is the binding acceptance criterion.
2. The data is already present: `entry.experience.stops[]`, each with `stopNumber`, `stopLabel`, `placeName`, `address`. No new data fetch, no new service call, no schema change.
3. For a curated entry (`stops?.length > 0`), every stop's **{stop number/label + place name + address}** MUST be readable. For a single-place (non-curated) entry, behaviour is unchanged (single address line).
4. No fabricated addresses (Constitution #9): if a stop's `address` is empty/missing, show the existing TBD fallback (`t('activity:calendarTab.locationTBD')`) for that stop — never invent one.
5. Must not regress the existing single-location row for non-curated entries, and must not break the row's existing tap-to-expand (`handleCardExpand`) affordance.

### 🎨 OPEN / DESIGNER PASS REQUIRED — presentation
> **DESIGNER PASS REQUIRED for F-5 presentation.** The exact visual layout, typography, spacing, truncation/wrapping, progressive-disclosure choice (always-visible per-stop address list on the entry row vs. an always-expanded curated address block in the detail vs. a compact multi-line location summary), icon treatment, light/dark tokens, and motion are the deliverable of a `mingla-designer` DESIGN pass for this surface. The designer must satisfy the §4 LOCKED acceptance bar above and produce the granular visual contract (color tokens light+dark with computed contrast, typography roles, 4px-grid spacing, safe-area/edge, all relevant states, no-AI-slop bans, "References examined") per the spec-granularity protocol. The implementor builds to the designer's contract; this forensics spec owns the functional/data contract + acceptance bar only.

### Cross-Surface Impact note for F-5
F-5 renders only on Consumer iOS + Consumer Android (shared RN). No business/admin/buyer-web analog. The designer pass and implementation are single-code-path → parity automatic; tester verifies the address-visibility acceptance bar on BOTH iOS sim and Android emulator.

- **Success criterion:** SC-5 (functional) + SC-5-DESIGN (designer contract exists and is satisfied).

---

## 5. Success Criteria

Each is observable, testable, unambiguous. Surfaces are shared RN → one criterion covers iOS + Android (tester verifies both).

- **SC-1 (F-1):** Rescheduling a curated calendar entry opens the modal in the CURATED flow (curated header + stop count, NOT "Schedule Experience"/"Check Availability"), and NO "We couldn't verify this place's hours…" banner appears. If a stop is closed at the chosen arrival time, the "Some Stops Are Closed" alert appears with the offending stop named; otherwise the reschedule commits. (Repro: Likes → Calendar → curated entry → Reschedule.)
- **SC-2 (F-2):** Scheduling a curated plan from Saved whose stop is closed at its estimated arrival time produces the "Some Stops Are Closed" alert naming that stop — it MUST NOT say "All Stops Are Open!". The proven adversarial fixture: a 2-stop plan where the dinner stop's Saturday hours are "5:00 – 10:00 PM" scheduled "Now" at ~3:07 PM Sat → arrival before open → "Some Stops Are Closed", listing the dinner stop. (Repro: Likes → Saved → curated card → Schedule Plan → Now.)
- **SC-3 (F-3):** Locking in a curated plan from a collab session opens the date/time modal in the curated flow (no false "couldn't verify" warning), same as SC-1.
- **SC-4 (F-4):** After rescheduling a curated entry via the recreate-fallback branch (entry without a stored `device_calendar_event_id`), the recreated device-calendar event's notes contain a "Stop N: <name> / Address: <address>" line for EVERY stop (not just the first). The primary reschedule branch (stored ID present) is unchanged and still preserves notes. *(OS-layer note: requires device-calendar permission granted; the app-layer builder choice is what this SC verifies — tester may verify the builder output unit-level + one live grant per platform.)*
- **SC-5 (F-5, functional):** From the Calendar tab, for a multi-stop curated entry, the address of every stop is readable without opening a second screen and without expanding each stop individually. Missing-address stops show the TBD fallback, never a fabricated address.
- **SC-5-DESIGN (F-5, presentation):** A `mingla-designer` DESIGN contract for the F-5 surface exists, satisfies the §4 LOCKED acceptance bar, and the implementation matches it (tokens, typography, spacing, states, a11y ≥44pt + labels, no-AI-slop).
- **SC-6 (F-6):** The advisory warning banner reads exactly `We couldn't verify this place's hours. Please double-check before scheduling.` — one sentence, one trailing period, no duplicated clause.
- **SC-7 (F-7):** `CuratedStop.openingHours` is typed as the Google-v1-object-or-legacy union (§F-7); after the F-2 deletion the project type-checks with zero `any`-cast added solely to silence a day-key index.
- **SC-8 (invariant + gate):** A strict-grep gate fails CI if any `app-mobile/src` file introduces a direct day-name key lookup on an `openingHours` value; it passes on the post-fix tree.

---

## 6. Invariants

### NEW — `I-CURATED-HOURS-VIA-CANONICAL-READER` (DRAFT → ACTIVE on ORCH-1019 CLOSE)
- **Statement:** Every opening-hours / availability check in `app-mobile/` MUST read hours via `extractWeekdayText(openingHours)` and evaluate open/closed via `isPlaceOpenAt(weekdayText, date, utcOffsetMinutes?)` from `openingHoursUtils.ts`. No code may index an `openingHours` value by a weekday name (`openingHours[dayName]`, `openingHours?.["Saturday"]`, `oh[weekday]`, etc.).
- **Preserved by:** F-2 deletion of the bespoke parser + the §3 LOCKED rule; all curated call-sites route through the canonical pair.
- **Verified by:** strict-grep gate `i-curated-hours-via-canonical-reader.mjs` (§8) + the two regression tests (§7).
- **Registry style entry** (to be added to `Mingla_Artifacts/INVARIANT_REGISTRY.md` at CLOSE):
  ```
  ### I-CURATED-HOURS-VIA-CANONICAL-READER (DRAFT post ORCH-1019 SPEC; flips ACTIVE on CLOSE)
  All app-mobile opening-hours/availability checks read via extractWeekdayText +
  isPlaceOpenAt (openingHoursUtils.ts). No direct openingHours[dayName] lookup
  anywhere under app-mobile/src. Gate: i-curated-hours-via-canonical-reader.mjs.
  Established after ORCH-1019: SavedTab's bespoke day-key parser returned false-OK
  ("All Stops Are Open!") on the Google-v1 weekdayDescriptions shape.
  ```

### Constitution rules touched (must stay satisfied — verify at TEST)
- **#9 No fabricated data:** F-2 stops fabricating "open" for closed venues; F-5 stops fabricating/omitting addresses (TBD fallback, never invented).
- **#12 Validate at the right time:** F-2/F-1 validation uses the selected/estimated-arrival datetime (not `new Date()`), and passes per-stop `utcOffsetMinutes` when present (venue-local). The device-local fallback is the canonical reader's documented behaviour when offset is absent.
- **#2 One owner per truth:** the canonical reader is the single hours authority; the bespoke parser (a competing authority) is deleted.

---

## 7. Test cases

| Test | Owner | Scenario | Input | Expected | Layer | Fail-on-revert |
|------|-------|----------|-------|----------|-------|----------------|
| **T-01 (happy, implementor-owned)** | implementor | Curated all-stops validator, Google-v1 shape, stop closed at arrival | 2-stop curated card; stop 2 `weekdayDescriptions` "Saturday: 5:00 – 10:00 PM"; start Sat 15:07 | `checkAllStopsOpen` returns `allOpen:false`, results[1].isOpen=false, reason mentions a time | unit (SavedTab validator extracted helper) | YES — reverting to `openingHours[dayName]` returns `allOpen:true` |
| **T-02 (adversarial, tester-owned)** | tester | (a) Curated card whose stop is closed at arrival MUST NOT say "All Stops Are Open!"; (b) curated entry rescheduled from Calendar MUST NOT show "couldn't verify" | (a) the T-01 fixture via SavedTab Schedule Plan → Now on sim; (b) curated calendar entry → Reschedule on sim | (a) "Some Stops Are Closed" alert naming the stop; (b) curated flow, no warning banner | runtime (iOS sim + Android emu) | YES |
| **T-03 (happy)** | tester | Curated plan all stops open at chosen time | all stops' hours cover the chosen time | "All Stops Are Open!" alert; schedule proceeds | runtime | — |
| **T-04 (edge — null hours)** | implementor | Stop with no parseable hours | stop.openingHours = `{}` or missing | that stop is non-blocking (isOpen:true), no fabricated "closed" | unit | — |
| **T-05 (F-4)** | tester | Reschedule curated entry via recreate fallback | curated entry, no stored device_calendar_event_id | device event notes contain "Stop N / Address" for every stop | unit (builder) + 1 live grant/platform | YES |
| **T-06 (F-6)** | tester | Advisory banner copy on a single-place card with unparseable hours | regular card, unparseable hours, Check Availability | banner shows exactly one sentence, one period | runtime | — |
| **T-07 (F-5)** | tester | Calendar shows every stop address | multi-stop curated entry | every stop's address readable without per-stop expansion; missing → TBD | runtime (iOS + Android) | — |
| **T-08 (SC-8 gate)** | implementor | strict-grep gate | post-fix tree + a planted `oh["Monday"]` fixture in --self-test | passes clean tree; fails on planted lookup | CI | YES (gate IS the revert guard) |

Both T-01 (happy, implementor) and T-02 (adversarial, tester) are CLOSE Step-0.5 gates and MUST fail when their respective fix is reverted.

---

## 8. Regression prevention — strict-grep gate

**New gate:** `.github/scripts/strict-grep/i-curated-hours-via-canonical-reader.mjs` (model on `i-ari-no-oklch.mjs`).
- **Scope dirs:** `app-mobile/src` (`.ts` + `.tsx`), skipping `__tests__`, `node_modules`, and `openingHoursUtils.ts` itself (the canonical reader legitimately maps day records internally).
- **Forbidden patterns (regex, on non-comment lines):** a member/computed access on an identifier ending in `openingHours`/`opening_hours` keyed by a weekday or a weekday-typed variable, e.g.:
  - `/\bopening_?[Hh]ours\s*\??\.\s*\[\s*[A-Za-z]/` (computed key) and
  - `/\bopening_?[Hh]ours\s*\?\.\s*(Monday|Tuesday|…|Sunday)\b/i` (literal day prop)
  - plus a guard for `[dayName]`/`[weekday]`/`[day]` variable indexing on an `openingHours`-named receiver.
- **Self-test (`--self-test`):** plant a fixture string `openingHours["Monday"]` → gate must exit 1; remove → exit 0. (Follows the META-ORCH-0991 / ORCH-1001 self-test pattern already in the workflow.)
- **Workflow registration:** add one job to `.github/workflows/strict-grep-mingla-business.yml` (the `app-mobile/**` path filter already triggers it), modeled on the `orch-0975-notifications-sheet` job block:
  ```yaml
  orch-1019-curated-hours-canonical-reader:
    name: "ORCH-1019: curated hours via canonical reader (I-CURATED-HOURS-VIA-CANONICAL-READER)"
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "20" }
      - name: Self-test the gate
        run: node .github/scripts/strict-grep/i-curated-hours-via-canonical-reader.mjs --self-test
      - name: Run ORCH-1019 canonical-reader gate
        run: node .github/scripts/strict-grep/i-curated-hours-via-canonical-reader.mjs
  ```
- **Backend allowlist note (COMMS-0002):** this gate adds a `.github/scripts/strict-grep/*.mjs` file. It does NOT add a `supabase/functions/` file, so the ORCH-0863 C7 `no-new-backend-files` gate is not implicated. No allowlist edit needed.

---

## 9. Implementation order

1. **F-7** — correct `CuratedStop.openingHours` type (unmasks F-2 at compile time).
2. **F-2** — delete bespoke parser; add canonical `checkAllStopsOpen` in SavedTab. Extract the validator into a small shared helper if F-1(c) will reuse it (see §B-F1).
3. **F-1** — `entryToCard` carries curated fields; reschedule modal gets `isCurated`; reschedule handler runs curated validation.
4. **F-3** — `LockedCardSchedulingSheet` passes `isCurated`.
5. **F-4** — reschedule device-cal fallback branches to `createEventFromCuratedCard`.
6. **F-6** — fix the warning banner copy.
7. **DESIGNER PASS (F-5)** — `mingla-designer` produces the F-5 presentation contract; then implement F-5 to that contract.
8. **Gate + invariant** — add `i-curated-hours-via-canonical-reader.mjs` + workflow job; register `I-CURATED-HOURS-VIA-CANONICAL-READER` in INVARIANT_REGISTRY at CLOSE.
9. **Tests** — T-01 (implementor happy), T-08 (gate self-test); tester adds T-02..T-07 at TEST.

---

## 10. Open / flexible (🎨 implementor's craft)

- 🎨 Whether F-1(c) and F-2's validator are factored into one shared helper (e.g. `validateCuratedStopsOpen(stops, startTime)`) or kept as two call-sites — implementor's call, as long as both route through the canonical reader and the §3 rule + gate hold. A shared helper is encouraged (DRY) but not mandated.
- 🎨 The exact wording of the per-stop closed reason beyond the LOCKED requirement that it name a time (e.g. "May be closed at 3:07 PM" vs "Opens after your arrival (3:07 PM)") — implementor's tasteful choice in Mingla voice.
- 🎨 F-5 presentation entirely (within the §4 LOCKED acceptance bar) — owned by the designer pass.
- 🎨 Internal structure / variable naming / memoization of the touched functions.

---

## 11. Backend dependency discovered (flagged, DEFERRED — NOT in this ORCH)

**Discovery:** the per-stop `utcOffsetMinutes` needed for strictly-correct venue-local validation (Constitution #12) is available in `place_pool.utc_offset_minutes` and is already SELECTed + returned by `signalRankFetch.ts` (lines 62, 321, 381), but `generate-curated-experiences/index.ts` does NOT carry it onto the built `CuratedStop` (the stop builder at lines 547-592 sets `openingHours`, `address`, etc. but no offset field; `CuratedStop` has no `utcOffsetMinutes` field either).

**Decision (🔒 LOCKED for this ORCH):** F-2 mirrors the reference-correct `ActionButtons.tsx` validator, which today passes NO offset and relies on the canonical reader's documented device-local fallback (correct when user and venue share a timezone — the common case for a location-based experience app). The F-2 code reads `(stop as any).utcOffsetMinutes ?? (stop as any).utc_offset_minutes ?? null` so it is forward-compatible the day the generator starts emitting it, with ZERO client change required then. **No backend/edge/migration change is required to ship F-1..F-7.**

**Deferred follow-up (register with orchestrator, do NOT do here):** a tiny generator enhancement to add `utcOffsetMinutes: card.utc_offset_minutes ?? null` to the curated-stop builder (`generate-curated-experiences/index.ts:~567`) + add the optional field to `CuratedStop` — would make curated validation venue-local for cross-timezone plans and also upgrade the already-correct `ActionButtons` path for free. This is an OPTIONAL hardening, not a fix-blocker, and is explicitly out of ORCH-1019 scope. Source for the field: `place_pool.utc_offset_minutes` (Google Places v1 `utcOffsetMinutes`), already in `signalRankFetch.ts`. COMMS-0003 N/A — this introduces no new external-API enum/payload/endpoint (the value is already fetched).

---

## 12. Granularity completion gate (self-check)

- [x] Functional contract complete for every touched layer (type, service-adjacent component logic, component, copy/i18n). DB/edge/hook/realtime genuinely untouched (stated).
- [x] The one UI surface needing visual design (F-5) has a LOCKED data/behaviour/acceptance contract here AND a REQUIRED `mingla-designer` pass explicitly flagged; all other changes are logic/copy with exact before/after.
- [x] No-AI-slop bans + "References examined" are delegated to the F-5 designer pass (the only net-new visual surface); the rest add no new visuals.
- [x] Every requirement tagged 🔒 LOCKED or 🎨 OPEN; OPEN section present and generous (§10).
- [x] Success criteria observable/testable/unambiguous; cross-surface parity automatic (single shared RN path) and stated per Phase 2.5.
- [x] Invariant named (`I-CURATED-HOURS-VIA-CANONICAL-READER`, registry-style); test cases happy/adversarial/edge per criterion; implementation order; regression gate.
- [x] Zero hand-wave: every fix carries exact file:line, before/after, and a success criterion.
