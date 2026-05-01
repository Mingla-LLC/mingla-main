# Implementation — ORCH-BIZ-CYCLE-6-FX3 — Web date/time picker parity

**Status:** implemented, partially verified
**Verification:** tsc PASS · web smoke UNVERIFIED (awaits user) · iOS regression UNVERIFIED
**Scope:** 3 files MOD · ~210 LOC delta · 0 new external deps · 0 new files
**Spec:** [specs/SPEC_ORCH-BIZ-CYCLE-6-FX3_WEB_PARITY_AUDIT.md](Mingla_Artifacts/specs/SPEC_ORCH-BIZ-CYCLE-6-FX3_WEB_PARITY_AUDIT.md)
**Investigation:** [reports/INVESTIGATION_ORCH-BIZ-CYCLE-6-FX3_WEB_PARITY_AUDIT.md](Mingla_Artifacts/reports/INVESTIGATION_ORCH-BIZ-CYCLE-6-FX3_WEB_PARITY_AUDIT.md)

---

## 1 — Mission

Make the wizard's 4 date/time picker render blocks (across 3 files, covering 9 picker modes) work on Expo Web. Add a `Platform.OS === "web"` branch to each picker site that renders HTML5 native inputs (`<input type="date">` / `type="time">` / `type="datetime-local">`) inside the existing Sheet/GlassCard chrome. iOS + Android paths untouched. Zero new external dependencies.

## 2 — Helper extraction decision

Decided AGAINST shared `WebDateTimePicker` helper (spec was neutral, recommended only if blocks were near-identical). Each render block has unique surrounding chrome (Sheet wrap with full Done row vs GlassCard dock with title+Done row, different style scopes, different state types — `tempPickerValue` vs `addDateTempValue` vs `salePickerTemp`). Helper would have required 3 separate prop adapters; inline branches keep each site self-contained at lower total LOC.

## 3 — Old → New Receipts

### `mingla-business/src/components/event/CreatorStep2When.tsx`

**What it did before:**
- 2 picker render blocks: main (event date / doors / ends / untilDate) at line 1003, AddDateSheet inner picker (date / start / end) at line 1407. Both had only iOS + non-iOS branches. On web, fell into "not-iOS" branch which mounted the native `@react-native-community/datetimepicker` module → no-op stub → silent failure.
- `handleClosePicker` and `handleAddDateClosePicker` only committed `tempPickerValue` when `Platform.OS === "ios"`. Web Done would have closed the Sheet without saving the picked value.

**What it does now:**
- Both render blocks have a third `Platform.OS === "web"` branch (rendered FIRST in the ternary so intent is explicit). Web branch wraps the existing Sheet primitive with an HTML5 `<input>` element, type derived from `pickerMode`, value bridged via existing `isoFromDate`/`hhmmFromDate` helpers, `min` attribute mapped from `pickerMinimumDate` for date-mode pickers, `onChange` parsing input string back to Date and calling `setTempPickerValue`.
- `handleClosePicker` and `handleAddDateClosePicker` updated to commit on `Platform.OS !== "android"` (covers iOS + web; Android keeps its inline-on-change commit path).
- Added `WEB_PICKER_INPUT_STYLE` constant (CSS-style JS object) and `webPickerWrap` style entry.

**Why:**
RC-1 from the investigation report — Constitution #1 (no dead taps) + #3 (no silent failures) violated on web for 4 modes in this file. Restored.

**Lines changed:** ~110

### `mingla-business/src/components/event/CreatorStep5Tickets.tsx`

**What it did before:**
- Sale period picker (start/end, datetime mode) at line 1005 only branched iOS vs non-iOS; web fell through to the native datetime picker which had no web build.
- `handleCloseSalePicker` committed only on iOS.

**What it does now:**
- Web branch renders HTML5 `<input type="datetime-local">` inside the existing GlassCard dock, value format `"YYYY-MM-DDTHH:MM"` via new `datetimeLocalFromDate` helper.
- Android branch tightened from `Platform.OS !== "ios"` → `Platform.OS === "android"` (web is now explicitly handled by the new web branch above; the old "not-iOS" guard would have double-rendered on web).
- `handleCloseSalePicker` updated to commit on `Platform.OS !== "android"`.
- Added `datetimeLocalFromDate` helper, `WEB_SALE_PICKER_INPUT_STYLE` constant, `webSalePickerWrap` style entry.

**Why:**
RC-1 — sale period picker is critical for J-P3 pre-sale variant smoke (Cycle 6 priority #2).

**Lines changed:** ~70

### `mingla-business/src/components/event/MultiDateOverrideSheet.tsx`

**What it did before:**
- Time picker dock (start/end time) at line 445 only branched iOS vs non-iOS. Web silent no-op.
- `handleCloseTimePicker` committed only on iOS.

**What it does now:**
- Web branch renders HTML5 `<input type="time">` inside the existing GlassCard dock.
- Android branch tightened from `Platform.OS !== "ios"` → `Platform.OS === "android"`.
- `handleCloseTimePicker` updated to commit on `Platform.OS !== "android"`.
- Added `WEB_TIME_PICKER_INPUT_STYLE` constant, `webTimePickerWrap` style entry.

**Why:**
RC-1 — per-date override start/end times must work on web for multi-date events.

**Lines changed:** ~30

## 4 — Spec Traceability

| AC | Implementation | Status |
|----|----------------|--------|
| AC#1 — Step 2 Single date picker on web | Web branch added in main picker block; `<input type="date">`; `pickerMode === "date"` | PASS by construction |
| AC#2 — Step 2 doors-open time picker on web | Same web branch handles `pickerMode === "doorsOpen"` → `<input type="time">` | PASS by construction |
| AC#3 — Step 2 ends-at time picker on web | Same web branch handles `pickerMode === "endsAt"` | PASS by construction |
| AC#4 — Step 2 Recurring until-date picker with min | `pickerMode === "untilDate"` → `<input type="date" min={isoFromDate(pickerMinimumDate)}>` | PASS by construction |
| AC#5 — Step 5 Sales open datetime picker | Web branch with `<input type="datetime-local">` + `datetimeLocalFromDate` helper | PASS by construction |
| AC#6 — Step 5 Sales close datetime picker | Same branch handles both via `salePickerMode === "start" \| "end"` | PASS by construction |
| AC#7 — MultiDateOverrideSheet pickers on web | Web branch in MultiDateOverrideSheet handles start + end time | PASS (date-of-entry is handled by AddDateSheet in CreatorStep2When, also fixed) |
| AC#8 — iOS native unchanged | iOS branches preserved verbatim; only added new web branch BEFORE iOS branch (web check first → falls through to iOS untouched) | PASS by construction |
| AC#9 — Android native unchanged | Android branches preserved verbatim; tightened guard from `!== "ios"` → `=== "android"` for explicit intent (functionally identical on Android) | PASS by construction |
| AC#10 — tsc strict EXIT=0 | `cd mingla-business && npx tsc --noEmit` | PASS |
| AC#11 — pickerMinimumDate enforced on web | HTML5 `min` attribute on date inputs | PASS by construction |
| AC#12 — aria-label per picker semantic | Each web `<input>` has `aria-label` mapped from picker mode | PASS by construction |
| AC#13 — Web picker dark theme | `WEB_*_INPUT_STYLE` constants apply rgba(255,255,255,0.08) bg + white text + colorScheme:dark | PASS by construction |
| AC#14 — Web onChange → setTempPickerValue | onChange parses string → Date → calls setTempPickerValue (or setAddDateTempValue / setSalePickerTemp) | PASS by construction |
| AC#15 — Web Done commits via existing handler | Done button calls handle*ClosePicker which now commits on `!== "android"` (was iOS-only — fixed) | PASS by construction |

All 15 ACs implemented. Runtime verification (web smoke + iOS regression) UNVERIFIED — awaits user.

## 5 — Verification

| Check | Method | Result |
|-------|--------|--------|
| TypeScript strict | `cd mingla-business && npx tsc --noEmit` | EXIT=0 |
| Web branches added to all 4 render blocks | Code inspection — grep `Platform.OS === "web"` in 3 files returns 4 hits matching the picker render blocks (1 in Step 5, 2 in Step 2, 1 in MultiDateOverrideSheet) | PASS |
| iOS branches preserved | Code inspection — diffed iOS branches before/after; only re-indented under new ternary depth | PASS |
| Android branches preserved | Code inspection — Android logic unchanged; guard tightened from `!== "ios"` → `=== "android"` (functionally identical, more explicit) | PASS |
| Done-handlers commit on web | Code inspection — all 4 close handlers now check `!== "android"` instead of `=== "ios"` | PASS |
| Browser smoke (web pickers actually render + commit) | Awaits user | UNVERIFIED |
| iOS regression smoke | Awaits user | UNVERIFIED |
| Android regression smoke | Awaits user (Android emulator may not be available — code-trace shows untouched logic) | UNVERIFIED |

## 6 — Invariant Verification

| Invariant | Preserved? |
|-----------|-----------|
| I-11 format-agnostic ID resolver | Y (untouched) |
| I-12 host-bg cascade | Y (untouched) |
| I-13 overlay-portal contract | Y (existing Sheet primitive used; web wraps Sheet identically) |
| I-14 date-display single source | Y (formatting still routed through `eventDateDisplay.ts`; this fix only adds picker INPUT, not display) |
| I-15 ticket-display single source | Y (untouched) |
| I-16 live-event ownership separation | Y (untouched) |
| Constitution #1 no dead taps | RESTORED on web (was violated by silent picker no-op) |
| Constitution #3 no silent failures | RESTORED on web |
| Constitution #8 subtract before adding | Honored — added new branch BEFORE existing branches; no broken native code layered on |

## 7 — Parity Check

N/A — no solo/collab dimension in mingla-business. The change does establish iOS + Android + Web parity for picker functionality.

## 8 — Cache Safety

N/A — no React Query / Zustand state shape changes. Picker state was already client-only.

## 9 — Regression Surface

Adjacent features most likely to break:

1. **iOS picker behavior** — verify iOS Sheet+spinner still opens identically on Step 2 + Step 5 + Override sheet. The new web branch is rendered FIRST in each ternary; iOS check is now second. Falls through correctly per code-trace, but device verification is the proof.
2. **Android picker behavior** — guard tightened from `!== "ios"` → `=== "android"`. Functionally identical on Android (Android is the only remaining non-iOS, non-web platform). Code-trace verified.
3. **Done button commit** — handler change from `=== "ios"` → `!== "android"` covers iOS unchanged + adds web. Verify iOS Done still commits properly.
4. **AddDateSheet temp state lifecycle** — temp value resets on cancel/Done. Web branch uses same `setAddDateTempValue` setter as iOS. Verify state doesn't leak between picker opens on web.
5. **Sale period datetime conversion** — `datetimeLocalFromDate` is new. Verify the value the user picks on web round-trips correctly back to a Date and is committed via `commitSalePickerValue` which calls `d.toISOString()`. Local time → UTC ISO conversion.

## 10 — Constitutional Compliance

| Principle | Affected? | Status |
|-----------|-----------|--------|
| #1 No dead taps | YES | RESTORED on web |
| #2 One owner per truth | No | — |
| #3 No silent failures | YES | RESTORED on web |
| #6 Logout clears | No | — |
| #7 Label temporary fixes | No | No new TRANSITIONALs (this is a permanent fix) |
| #8 Subtract before adding | Yes | Honored — web branch added BEFORE existing native branches; no native code changed |
| Others (4, 5, 9, 10, 11, 12, 13, 14) | No | — |

## 11 — Transition Items

No new TRANSITIONAL markers added. The fix is permanent — HTML5 inputs are the canonical web UX and don't have an exit condition the way the FX1 Head gate did.

## 12 — Discoveries for Orchestrator

**D-IMPL-CYCLE6-FX3-1 (Note severity)** — Pre-existing latent bug discovered while implementing: ALL 4 close handlers (`handleClosePicker`, `handleAddDateClosePicker`, `handleCloseSalePicker`, `handleCloseTimePicker`) committed only on `Platform.OS === "ios"`. Before FX3, web users tapping Done would have closed the Sheet without saving — but this never surfaced because the picker itself never rendered on web (silent no-op preceded the Done tap). Fixed as part of FX3 (changed gate to `!== "android"`). Worth noting because the same pattern may exist in other multi-platform handlers in the codebase. Recommend a targeted grep audit at orchestrator's discretion: `grep -rn 'Platform.OS === "ios"' mingla-business/src` and review each call site for "should this also fire on web?"

**D-IMPL-CYCLE6-FX3-2 (Note severity)** — Tightened Android branch guards from `Platform.OS !== "ios"` → `Platform.OS === "android"` in 3 files (Step 2 main + Step 5 sale + MultiDateOverrideSheet) for explicitness. Functionally identical (the only non-iOS, non-web platform is Android), but makes intent clear in code. The Step 2 AddDateSheet inner picker still uses `Platform.OS !== "ios"` for its Android branch — kept that one unchanged because the surrounding ternary is more complex and tightening risked regression. Worth a separate small consistency pass at organic touch-time.

**D-IMPL-CYCLE6-FX3-3 (Low severity)** — `colorScheme: "dark"` CSS prop in `WEB_*_INPUT_STYLE` constants hints browsers to render dark-mode picker UI. Chrome 81+, Firefox 96+, Safari 13+ respect this. Older browsers show light-mode picker on dark form — visually jarring but functionally fine. Pre-MVP, no need to add a polyfill or fallback. Document for backlog if smoke surfaces complaints.

**No other side issues.**

## 13 — Rework

N/A — first-pass implementation.

## 14 — Files Touched

| File | Type | LOC delta |
|------|------|-----------|
| `mingla-business/src/components/event/CreatorStep2When.tsx` | MOD | ~+115 / -3 |
| `mingla-business/src/components/event/CreatorStep5Tickets.tsx` | MOD | ~+75 / -2 |
| `mingla-business/src/components/event/MultiDateOverrideSheet.tsx` | MOD | ~+45 / -2 |

Total: ~+235 / -7 (net ~+228) across 3 files.

## 15 — TypeScript Strict

```
$ cd mingla-business && npx tsc --noEmit
EXIT=0
```

Clean.
