# Investigation — ORCH-BIZ-CYCLE-4-RECURRING-MULTIDATE

**ORCH-ID:** ORCH-BIZ-CYCLE-4-RECURRING-MULTIDATE
**Cycle:** 4 (Refine wedge — Step 2 expansion + Preview/publish-gate adaptation)
**Journeys:** J-E5 (recurring picker) · J-E6 (multi-date list builder) · J-E7 (per-date override editor) · J-E8 (publish flow handling N dates)
**Mode:** INVESTIGATE (Phase 0–7 complete) — paired with `SPEC_ORCH-BIZ-CYCLE-4-RECURRING-MULTIDATE.md`
**Confidence:** **High** — Cycle 3 codebase is fresh (commit 6efc57ac), patterns are well-documented, no contradictions across layers.

---

## Layman summary

Step 2 of the wizard currently only supports "Once" — the "Repeats" sheet is a placeholder that says "More repeat options coming Cycle 4." Cycle 4 replaces that placeholder with a real 3-mode segmented control: **Single | Recurring | Multi-date**. Recurring uses 5 presets (no full RRULE complexity). Multi-date lets the organiser pick 2–24 dates manually, each editable for its own title/description/location.

The rest of the wizard (Where, Cover, Tickets, Settings) stays untouched. Preview's mini-card and PreviewEventView need light extensions to render N-date events. The publish gate (J-E8) extends `validatePublish` with two new error keys.

The codebase is well-prepared: every place that touches "the event date" is centralised in three files (`draftEventStore.ts`, `draftEventValidation.ts`, two formatter helpers). Cycle 4 is **additive** — no breaking changes, schema migrates v2→v3 with passthrough.

---

## Phase 0 — Context Ingest

### Prior artifacts read
- `reports/IMPLEMENTATION_BIZ_CYCLE_3_EVENT_CREATOR.md` — Cycle 3 baseline
- `specs/SPEC_ORCH-BIZ-CYCLE-3-EVENT-CREATOR.md` — invariants + token usage
- `prompts/FORENSICS_BIZ_CYCLE_4_RECURRING_MULTIDATE.md` — this cycle's dispatch
- `DECISION_LOG.md` — DEC-071 (frontend-first), DEC-079 (kit closure), DEC-084 (Sheet numeric snap), DEC-085 (Modal native portal)
- `INVARIANT_REGISTRY.md` — I-11 (format-agnostic ID), I-12 (host-bg cascade), I-13 (overlay-portal contract)
- `BUSINESS_PRD.md` §3.1 (recurring/multi-date listed in U.5.1) + §U.0 chat-agent goal

### Memory checked
- "Sequential — One Step at a Time" — applied: 4 journeys grouped because they share Step 2 + publish gate
- "Implementor uses /ui-ux-pro-max for UI" — flagged in spec for implementor pre-flight
- "Confirm UX Semantics Before Dispatch" — Q-1 through Q-6 below are flagged for orchestrator+user confirmation
- "Solo + Collab Parity" — N/A (Cycle 4 has no collab modes)

### Migration chain
N/A — Cycle 4 is frontend-only (DEC-071). No SQL migrations. AsyncStorage schema v2 → v3 (additive, in-app migrator only).

### Sub-agent findings
None delegated — all reads first-hand.

---

## Phase 1 — Symptom / scope

This is **build, not break** — Cycle 4 implements the placeholder "More repeat options coming Cycle 4" copy that Cycle 3 left as TRANSITIONAL (TRANS-CYCLE-3-5 in `CreatorStep2When.tsx` line 460). No symptoms to reproduce; instead, the dispatch defines what must exist.

**Expected after Cycle 4:**
- Step 2 has a Single/Recurring/Multi-date segmented control replacing the "Repeats" picker row
- Recurring mode renders preset picker + termination picker
- Multi-date mode renders a list builder + add-date button
- Per-date override sheet (J-E7) accessible from multi-date rows
- Preview shows N occurrences (recurring: computed list; multi-date: actual list)
- Publish gate handles new error paths

---

## Phase 2 — Investigation Manifest

| File | Why read | Layer |
|------|----------|-------|
| `mingla-business/src/components/event/EventCreatorWizard.tsx` | Wizard root — does step nav assume single date? | Component |
| `mingla-business/src/components/event/CreatorStep2When.tsx` | The body to refine | Component |
| `mingla-business/src/components/event/CreatorStep1Basics.tsx` | Sibling — no Step-2 dependency expected | Component |
| `mingla-business/src/components/event/CreatorStep3Where.tsx` | Per-date override needs venue/address fields | Component |
| `mingla-business/src/components/event/CreatorStep4Cover.tsx` | Sibling — confirm no date dependency | Component |
| `mingla-business/src/components/event/CreatorStep5Tickets.tsx` | Sibling — confirm no date dependency | Component |
| `mingla-business/src/components/event/CreatorStep6Settings.tsx` | Sibling — confirm no date dependency | Component |
| `mingla-business/src/components/event/CreatorStep7Preview.tsx` | Mini-card + status — needs N-date variant | Component |
| `mingla-business/src/components/event/PreviewEventView.tsx` | Public preview — needs N-date rendering | Component |
| `mingla-business/src/components/event/types.ts` | StepBodyProps contract | Type |
| `mingla-business/src/store/draftEventStore.ts` | Schema v2 — needs v3 extension | Store |
| `mingla-business/src/utils/draftEventValidation.ts` | validateWhen / validatePublish — needs branches | Util |
| `mingla-business/app/event/create.tsx` | Route — confirm no scaffolding needed | Route |
| `mingla-business/app/event/[id]/edit.tsx` | Route — confirm no changes needed | Route |
| `mingla-business/app/event/[id]/preview.tsx` | Route — confirm no changes needed | Route |
| `BUSINESS_PRD.md` §3.1 / §U.5.1 | Authoritative product contract | Docs |
| `BUSINESS_PROJECT_PLAN.md` §B.3 (events table) | Future backend target — informs draft shape | Docs |

---

## Phase 3 — Findings (classified)

### 🔵 OBS-1 — Step 2 "Repeats" sheet is a clean placeholder ready for replacement

**File:** `mingla-business/src/components/event/CreatorStep2When.tsx` lines 264–276 (Pressable row), 441–463 (Sheet body)
**Current:** `repeats` field hardcoded to `"once"` literal in DraftEvent type. Sheet shows a single "Once" row with a check + footer caption "More repeat options coming Cycle 4."
**Cycle 4 action:** Replace the `Repeats` Pressable row with a 3-segment control (Single / Recurring / Multi-date). Delete the single-row sheet entirely (Constitution #8 — subtract before adding).
**Risk:** Low. The field is isolated; no other component reads `draft.repeats`.

### 🔵 OBS-2 — DraftEvent.repeats has a single-literal union waiting for expansion

**File:** `mingla-business/src/store/draftEventStore.ts` line 92–93
**Current:**
```ts
/** Locked to "once" in Cycle 3; Cycle 4 expands the union for recurrence. */
repeats: "once";
```
**Cycle 4 action:** Spec recommends INSTEAD adding a new `whenMode: "single" | "recurring" | "multi_date"` field. Reasons:
- "Repeats" is a poor label for "multi-date" (those aren't repeating, they're a list)
- Renaming `repeats` to `whenMode` and expanding makes search/grep cleaner
- The existing `repeats: "once"` literal is read NOWHERE outside the store and the placeholder sheet — zero reference cost
**Decision:** Spec uses `whenMode` (not `repeats`). The `repeats` field is REMOVED in v3 migration (or preserved as `"once"` literal for back-compat — implementor decides; spec recommends remove since nothing reads it).

### 🟡 HIDDEN-1 — `validateWhen` assumes single-date shape

**File:** `mingla-business/src/utils/draftEventValidation.ts` lines 97–119
**Current code:**
```ts
const validateWhen = (d: DraftEvent): ValidationError[] => {
  const errs: ValidationError[] = [];
  if (d.date === null) {
    errs.push({ fieldKey: "date", step: 1, message: "Set the event date." });
  } else if (parseDateString(d.date) < startOfToday()) {
    errs.push(...);
  }
  if (d.doorsOpen === null) {...}
  if (d.endsAt === null) {...}
  return errs;
};
```
**What it does:** Validates `date`, `doorsOpen`, `endsAt` regardless of mode.
**What it should do:** Branch on `whenMode`:
- `single` → existing logic (UNCHANGED)
- `recurring` → validate `date` (first occurrence) + `doorsOpen` + `endsAt` + `recurrenceRule.termination` (count >= 1 OR until > date)
- `multi_date` → validate `multiDates.length >= 2` + every date is in the future + no two entries collide on `date+startTime`. The parent `date`/`doorsOpen`/`endsAt` fields are ignored in this mode (each multiDate has its own startTime/endTime).

**Causal chain:** without branching, existing validator throws "Set the event date" for a multi-date draft because `draft.date` will be null in multi-date mode. Spec defines the branching contract.

**Verification:** add a unit test fixture for each mode; confirm error shape.

### 🟡 HIDDEN-2 — `formatDateLine` and `formatDateLabel` are duplicated across three files with single-date assumption

**Files:**
- `CreatorStep2When.tsx` lines 47–62 (`formatDateLabel`)
- `CreatorStep7Preview.tsx` lines 50–69 (`formatDateLine`)
- `PreviewEventView.tsx` lines 64–83 (`formatDateLine`)

**What it is:** Three near-identical functions formatting an ISO date string + optional doorsOpen into a human label. Each only handles single ISO date.

**Cycle 4 action:** Spec introduces a new helper `mingla-business/src/utils/eventDateDisplay.ts` exporting:
- `formatSingleDateLine(date, doorsOpen)` — current single-date behavior (extract from one of the existing copies)
- `formatRecurringSummary(rule, firstDate)` — "Every Mon · 12 dates"
- `formatMultiDateSummary(multiDates)` — "5 dates · first Fri 12 May"
- `formatRecurringDatesList(rule, firstDate)` — array of formatted strings for expand-list rendering
- `expandRecurrenceToDates(rule, firstDate)` — pure function returning Date[] (capped at 52 occurrences for safety)

The three call sites get refactored to use the new helper (Constitution #2 — one owner per truth).

**Classification reasoning:** This is a 🟡 Hidden Flaw because **today**, the duplication isn't causing a bug — but expanding three copies of the same function into N-date-aware versions is the kind of task where one copy gets missed.

### 🟡 HIDDEN-3 — Preview mini-card uses a hardcoded single-line date display

**File:** `CreatorStep7Preview.tsx` lines 96–102, 115–123
**Current:** `dateLine = formatDateLine(draft.date, draft.doorsOpen)` rendered as `<Text style={miniDate}>{dateLine}</Text>` directly in the mini card.
**Cycle 4 action:** Mini card shows:
- Single mode: UNCHANGED line
- Recurring mode: line 1 = first occurrence date+time; line 2 = "Repeats every Mon · 12 dates" pill
- Multi-date mode: line 1 = first date+time; line 2 = "5 dates" pill
**Risk:** Low — `miniDate` style accepts a single Text node, but a wrapping View can hold the pill below. No layout regression to existing single-mode users.

### 🟡 HIDDEN-4 — `PreviewEventView` heroDate currently single-date only

**File:** `PreviewEventView.tsx` lines 64–83 (`formatDateLine`), 119 (consumed)
**Current:** `dateLine = formatDateLine(draft.date, draft.doorsOpen)` shown as single eyebrow above the title.
**Cycle 4 action:** Same pattern as Step 7 mini-card — eyebrow + N-dates pill; tap pill to expand a list. Per dispatch Q-4 recommendation: **inline expand** (accordion), not Sheet. Reason: PreviewEventView is already a long-scroll view; opening a Sheet on top of a Sheet/Modal feels heavy.

### 🔵 OBS-3 — DraftEvent type is the single source of truth — schema bump is well-anchored

**File:** `draftEventStore.ts` lines 83–134
**Current:** v2 schema with `repeats: "once"` literal + `hideAddressUntilTicket` + tickets array. Persist version=2.
**Cycle 4 action:** v3 schema additive (rename + 3 new fields):
```ts
// Replaces repeats:
whenMode: "single" | "recurring" | "multi_date";
// New (v3):
recurrenceRule: RecurrenceRule | null;
multiDates: MultiDateEntry[] | null;
```
**Migration:** v2→v3 sets `whenMode = "single"`, `recurrenceRule = null`, `multiDates = null`. Existing v2 drafts continue to work as single-mode.

### 🔵 OBS-4 — `EventCreatorWizard` step nav is mode-agnostic

**File:** `EventCreatorWizard.tsx` lines 339–348 (handleContinue), 352–376 (handlePublishTap)
**Current:** Step nav uses `validateStep(currentStep, draft)`. Publish uses `validatePublish(draft, stripeStatus)`.
**Cycle 4 action:** **No change to wizard nav.** The mode-branched `validateStep` / `validatePublish` (HIDDEN-1) handles all three modes transparently. The wizard stays oblivious to whenMode.
**Significance:** This is GOOD architecture — the change is contained to Step 2 + validators + display helpers. No wizard-root touchups needed.

### 🔵 OBS-5 — `EventCreatorWizard.brand subtitle` includes step counter

**File:** `EventCreatorWizard.tsx` line 470
**Current:** `"{brand?.displayName ?? "Brand"} · Step {currentStep + 1} of {TOTAL_STEPS}"`
**Cycle 4 action:** UNCHANGED. TOTAL_STEPS stays at 7 (no new step added — multi-date stays inside Step 2).

### 🔵 OBS-6 — Sheet primitive supports DEC-084 numeric snap (multi-date list might need full snap)

**File:** `mingla-business/src/components/ui/Sheet.tsx`
**Current:** Snap = "peek" | "half" | "full" | number (px).
**Cycle 4 action:** Per-date override sheet (J-E7) likely needs `snapPoint="full"` since it has 4 long-text inputs. Add-date sheet uses `snapPoint="half"` (just a date picker). Both well within DEC-084's contract — no new primitive work.

### 🔵 OBS-7 — Constitution #8 (subtract before adding) — the placeholder "Repeats" sheet must be removed

**File:** `CreatorStep2When.tsx` lines 264–276 (row) + 441–463 (sheet)
**Cycle 4 action:** DELETE both. Replace with segmented control. Constitution #8 explicit — "subtract before adding."

### 🟡 HIDDEN-5 — `BrandEventStub` / brand event count for J-A12 finance reports may need recurring-event awareness

**File:** Cycle 2 introduced `currentBrandStore.BrandEventStub` for finance report tile counts. Cycle 4 doesn't touch finance reports, but a **future Cycle 9** real publish pipeline will create N event-date rows for one logical event.
**Cycle 4 action:** **No change** — this is a Cycle 9 backend concern. Logged as discovery for orchestrator.
**Classification reasoning:** Hidden because it doesn't affect Cycle 4 today, but future authors must remember "1 event != 1 row in events table when recurring."

### 🔵 OBS-8 — `mingla-business/src/utils/timezones.ts` already supports per-zone metadata for any IANA zone

**Confirmed:** existing `formatTimezoneLabel`, `formatTimezoneOffset`, `getAllTimezones` will work for both modes. Multi-date inherits the parent draft's timezone (per dispatch — no per-date timezone overrides).

---

## Phase 4 — Five-Layer Cross-Check

| Layer | Source of truth | Cycle 4 finding |
|-------|-----------------|-----------------|
| **Docs** | BUSINESS_PRD §3.1 | "Create recurring events (RFC 5545 RRULE-based)" + "Create multiple-date events" + "Edit details per event date." Cycle 4 honors all three. |
| **Schema** (target backend) | BUSINESS_PROJECT_PLAN §B.3 lines 362–370 | `events.is_recurring`, `events.is_multi_date`, `events.recurrence_rules JSONB`, `event_dates` table with overrides. Cycle 4 draft shape **flattens cleanly** into these fields when backend lands (Cycle 9). No schema-vs-draft contradiction. |
| **Code** (Cycle 3 baseline) | Source files read in Phase 3 | All Step 2 paths use a single `date/doorsOpen/endsAt`. validateWhen + 3 formatter copies + Preview hero/mini all assume single. Findings HIDDEN-1, HIDDEN-2, HIDDEN-3, HIDDEN-4 capture every contradiction. |
| **Runtime** | N/A — frontend-only, no API | No runtime contradictions to check. |
| **Data** (AsyncStorage) | Persist v2 with `repeats: "once"` | v2 → v3 migration is purely additive; existing drafts continue as `whenMode = "single"`. Verified by inspection of `migrate` function pattern (line 204–216). |

**No layers disagree.** Cycle 4 is an extension; not a fix.

---

## Phase 5 — Blast Radius Map

| Surface | Affected? | How |
|---------|-----------|-----|
| Step 2 body | ✅ | Replace "Repeats" row with segmented control + recurring/multi-date bodies |
| Step 1, 3, 4, 5, 6 bodies | ❌ | No changes (verified — none read `draft.repeats` or `draft.date`-only logic) |
| Step 7 Preview | ✅ light | Mini card shows N-date pill |
| `PreviewEventView` | ✅ light | Hero date line + N-date pill + expand list |
| Wizard chrome / dock | ❌ | UNCHANGED |
| Publish gate (`validatePublish`) | ✅ | New error keys: `recurrence.invalid`, `multiDates.invalid` |
| Publish modal | ✅ light | Copy variant: "Publish recurring event? {N} occurrences" |
| `PublishErrorsSheet` | ❌ | Existing pattern handles new error keys via fieldKey + step → Fix-jump (no code change required, just register new keys with appropriate `step: 1` mapping) |
| Routes (`create.tsx`, `[id]/edit.tsx`, `[id]/preview.tsx`) | ❌ | UNCHANGED — wizard handles mode internally |
| `useDraftsForBrand` / `useDraftById` | ❌ | UNCHANGED — selector-stable, mode-agnostic |
| `clearAllStores` (logout) | ❌ | UNCHANGED — clears `drafts[]` regardless of mode (Constitution #6) |
| Events tab list | ❌ | UNCHANGED — drafts list shows `name + step + relativeTime`, mode-agnostic. **Optional:** show "Recurring" / "{N} dates" sub-line — defer to Cycle 5+ polish |
| Currency / Stripe gate | ❌ | UNCHANGED — paid-ticket logic doesn't depend on mode |
| Brand store / brand list | ❌ | UNCHANGED |
| `BrandEventStub` (finance reports) | ❌ | Cycle 4 — no real events created. Cycle 9 backend must reckon with N-date counting (HIDDEN-5) |

**Total LOC estimate:** ~600–800 net new + ~150 modified across:
- New file: `eventDateDisplay.ts` (~100 LOC)
- New file: `recurrenceRule.ts` (~80 LOC — preset → display + first-N expansion + RRULE string emit)
- Modified: `draftEventStore.ts` (~80 LOC for schema + migrator)
- Modified: `draftEventValidation.ts` (~120 LOC for branched validators)
- Modified: `CreatorStep2When.tsx` (~250 LOC — segmented control + recurring picker + multi-date list builder; replace ~40 LOC of "Repeats" sheet)
- New file: `MultiDateOverrideSheet.tsx` (~150 LOC — J-E7 sheet)
- Modified: `CreatorStep7Preview.tsx` (~30 LOC — mini-card pill)
- Modified: `PreviewEventView.tsx` (~50 LOC — hero pill + expand list)

---

## Phase 6 — Invariant Violations

| Invariant | Status |
|-----------|--------|
| **I-11 (format-agnostic ID resolver)** | ✅ Preserved — `useDraftById(id)` works regardless of mode |
| **I-12 (host-bg cascade)** | ✅ Preserved — segmented control + new sheets inherit `canvas.discover` from wizard root |
| **I-13 (overlay-portal contract)** | ✅ Preserved — per-date override sheet uses Sheet primitive (DEC-085 native portal already enforced) |
| **Constitution #1 (no dead taps)** | Must hold — every "+", pencil, trash actively works |
| **Constitution #2 (one owner per truth)** | Must hold — drafts owned by `draftEventStore` only; new helper `eventDateDisplay.ts` deduplicates the 3 formatter copies (HIDDEN-2) |
| **Constitution #6 (logout clears)** | ✅ Preserved — `clearAllStores()` already wipes `drafts[]` regardless of internal shape |
| **Constitution #7 (TRANSITIONAL labels)** | Must hold — every deferred surface (per-date covers, per-date tickets, calendar grid picker, RRULE editor) gets a label with exit-condition |
| **Constitution #8 (subtract before adding)** | Must hold — DELETE the Cycle-3 "Repeats" sheet body BEFORE adding the segmented control. Don't layer |
| **Constitution #10 (currency-aware)** | N/A — Cycle 4 has no money UI |

**No violations introduced** by the dispatch's locked scope.

---

## Phase 7 — Open Questions for Orchestrator + User

These six questions surfaced in the dispatch. The investigation produced recommended answers — but per memory rule "Confirm UX Semantics Before Dispatch", the **orchestrator must confirm with the user before implementor dispatch.**

### Q-1 — Step 2 layout: segmented control above body, body switches per mode?

**Recommendation:** **YES.**
- Top of Step 2: 3-segment control (Single | Recurring | Multi-date)
- Below it: the body switches based on `draft.whenMode`:
  - `single` → existing date/doors/ends/timezone fields (UNCHANGED from Cycle 3)
  - `recurring` → date (= first occurrence) + doors/ends/timezone + recurrence picker rows (preset + termination)
  - `multi_date` → date list builder + add-date button (parent doors/ends used as default for new entries; timezone shared)

**Reason:** keeps single-mode muscle memory; recurring/multi-date are clearly different bodies (no surprise inputs).

### Q-2 — Mode-switch data preservation?

**Recommendation:** **Preserve where lossless; warn where lossy.**

| From → To | Behavior |
|-----------|----------|
| Single → Recurring | Preserve `date` as first occurrence. Doors/ends/timezone preserved. recurrenceRule = preset default (`weekly` BYDAY=<day-of-week-of-date>, count=4). |
| Single → Multi-date | Preserve `date+doorsOpen+endsAt` as multiDates[0]. Add a UI affordance "Add another date" — multi-date mode requires ≥2 dates to publish (validation), but the user can accumulate up to that gradually. |
| Recurring → Single | Preserve `date` (first occurrence). recurrenceRule discarded silently (lossy but obvious — user is leaving recurring intentionally). No warning. |
| Recurring → Multi-date | Preserve `date+doorsOpen+endsAt` as multiDates[0]. recurrenceRule discarded. No warning. |
| Multi-date → Single | Preserve multiDates[0] as `date+doorsOpen+endsAt`. multiDates discarded. **WARN with ConfirmDialog** if multiDates.length > 1: "You'll lose {N-1} other dates. Continue?" |
| Multi-date → Recurring | Preserve multiDates[0] as first occurrence. multiDates[1..N] discarded. **WARN with ConfirmDialog** if multiDates.length > 1: "You'll lose {N-1} other dates. They'll be replaced with a recurrence rule. Continue?" |

**Reason:** silent data loss is a Constitution #1 cousin (dead-tap-equivalent). Where preservation isn't possible, ask first.

### Q-3 — Store derived RFC 5545 RRULE string OR compute lazily?

**Recommendation:** **Compute lazily at publish time** (not stored on draft).

**Reason:**
- Draft state churns; storing the RRULE string requires recomputing on every preset change — duplicate state-of-truth (Constitution #2 violation if drift)
- Cycle 4 has no backend — RRULE string never leaves the client
- Cycle 9 backend creation can compute RRULE at the publish-edge-function moment from `recurrenceRule` shape
- Saves ~40 LOC of "stay-in-sync" code

**Helper:** `recurrenceRuleToRfc5545(rule)` lives in `recurrenceRule.ts`, called only by future publish edge function (Cycle 9). For Cycle 4, it's unused but exported (lint-allowed via `// [TRANSITIONAL] consumed by Cycle 9 publish edge fn`).

### Q-4 — Preview expand pattern: inline OR Sheet?

**Recommendation:** **Inline expand (accordion-style)** below the mini card / hero date line.

**Reason:** Preview surfaces are already long-scroll. Opening a Sheet over Preview (which on Step 7 is itself rendered inside the wizard ScrollView) creates Sheet-over-ScrollView visual noise. Accordion is lighter. State: simple boolean `showAllDates` per Preview surface.

**Cap:** if N > 20 dates, show first 10 + "Show all (N)" button → expands all. Prevents 50-row inline blast.

### Q-5 — Per-date override entry points: multi-date row pencil only OR also Preview pencil?

**Recommendation:** **Multi-date row pencil ONLY for Cycle 4.**

**Reason:**
- Defer Preview's per-date pencil to **Cycle 9 J-E11** (full inline-edit-in-preview)
- Single entry point keeps the surface tight; testing matrix smaller; less rework risk
- Memory rule: "Sequential — One Step at a Time" applies — over-shipping J-E11 inside Cycle 4 violates the cadence

**Spec captures this as a TRANSITIONAL** — Preview's expanded multi-date list shows per-date entries as **read-only** rows (each with a "Tap row to edit" affordance routing to Step 2 with the date row pre-selected → opens override sheet). Cycle 9 swaps the route-back-to-step-2 for direct in-Preview editing.

### Q-6 — Multi-date count cap: 24?

**Recommendation:** **24 confirmed.**

**Reason:**
- 24 = ~6 months of weekly events, reasonable upper bound for a manually-built list
- Eventbrite's recurring-event UI caps multi-date at ~30
- Cap can lift to 52 in B-cycle if user pressure (sentinel: a TRANSITIONAL caveat in the spec naming the cap as a soft guardrail)

---

## Phase 8 — Discoveries for Orchestrator

| Discovery | Severity | Action |
|-----------|----------|--------|
| **D-FOR-CYCLE4-1:** `repeats: "once"` literal in DraftEvent is unused outside Step 2's placeholder Sheet — safe to remove on v3 migration | Low (housekeeping) | Spec includes removal in v3 schema |
| **D-FOR-CYCLE4-2:** `formatDateLine` / `formatDateLabel` duplicated across 3 files — Cycle 4 consolidates into `eventDateDisplay.ts` (Constitution #2 lift) | Medium | Spec includes the consolidation as a parallel deliverable |
| **D-FOR-CYCLE4-3:** Cycle 9 backend will need to handle "1 event = N event_date rows" for finance reports — `BrandEventStub.eventCount` semantics need clarity (count events or count occurrences?) | Cycle 9 concern | Add to PRIORITY_BOARD as Cycle 9 prep note |
| **D-FOR-CYCLE4-4:** `Sheet snapPoint="full"` for per-date override sheet may need keyboard-aware paddingBottom (Cycle 3 J-A8 pattern) | Low | Spec inherits the pattern — no new work |
| **D-FOR-CYCLE4-5:** Recurring mode's "first occurrence" is the existing `draft.date`. If user picks `weekly BYDAY=MO` but `draft.date` is a Tuesday — UX choice: silently auto-snap forward to next Monday OR show inline warning "First occurrence Tue 12 May doesn't match selected day Monday — snap forward?" | UX decision | Spec recommends auto-snap forward with a small "Snapped to {dow}" caption below the date row. User can override the snap by going back to Single mode. |

---

## Phase 9 — Confidence + Verification Notes

**Confidence: HIGH.**

- Every claim about current code in this report was verified by reading the file first-hand (no sub-agent delegation).
- Schema migration approach mirrors the existing v1→v2 migrator (line 204–216 of `draftEventStore.ts`) — proven pattern.
- DEC-084 (Sheet numeric snap) and DEC-085 (Modal native portal) already shipped — Cycle 4 needs no new kit primitives.
- The dispatch's "frontend-only" constraint (DEC-071) means no Supabase migrations to verify against — the only "data layer" is AsyncStorage, which we control.

**Spec next.** See `specs/SPEC_ORCH-BIZ-CYCLE-4-RECURRING-MULTIDATE.md` for the layer-by-layer contract.

---

**End of investigation.**
