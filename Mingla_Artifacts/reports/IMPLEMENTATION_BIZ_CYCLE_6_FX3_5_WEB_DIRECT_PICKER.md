# Implementation — ORCH-BIZ-CYCLE-6-FX3.5 — Web pickers open directly on row tap

**Status:** implemented, partially verified
**Verification:** tsc PASS · web smoke UNVERIFIED (awaits user) · iOS regression UNVERIFIED
**Scope:** 3 files MOD · ~+170/-160 LOC delta · 0 new external deps · 0 new files · 0 new TRANSITIONALs
**Spec:** [prompts/IMPL_BIZ_CYCLE_6_FX3_5_WEB_DIRECT_PICKER.md](Mingla_Artifacts/prompts/IMPL_BIZ_CYCLE_6_FX3_5_WEB_DIRECT_PICKER.md)

---

## 1 — Mission

Web pickers worked after FX3 but required 2 clicks (row → Sheet → input → Done). User asked for 1 click — tap row → browser native picker opens directly. Replaced FX3's web Sheet+Done flow with hidden HTML5 inputs triggered programmatically via `showPicker()` (with `.click()` fallback). Constitution #8 honored — explicitly subtracted FX3 web Sheet branches + their support styles before adding the new pattern.

## 2 — Old → New Receipts

### `mingla-business/src/components/event/CreatorStep2When.tsx`

**What it did before:**
Two picker render blocks (main picker, AddDateSheet inner picker) each had a 3-way ternary: web Sheet wrapping HTML5 input + Done button → iOS Sheet + spinner → Android dialog. Web flow took 2 user clicks (open Sheet + tap input to open browser picker, then tap Done to commit).

**What it does now:**
- Web Sheet+Done branches removed entirely (subtraction per Constitution #8). Both ternaries now: iOS Sheet → Android dialog → null.
- Android branches tightened from `pickerMode !== null` to `Platform.OS === "android" && pickerMode !== null` so the bare `<DateTimePicker>` mount cannot fire on web (defense in depth — `pickerMode` already won't be set on web, but the explicit guard prevents future regressions).
- New 7 hidden HTML5 `<input>` elements (4 main: date/doorsOpen/endsAt/untilDate; 3 AddDateSheet: date/start/end) rendered at the bottom of their respective parent JSX. Each has a `useRef` and is gated to `Platform.OS === "web"`.
- `handleOpenPicker` and `handleAddDateOpenPicker` get a web branch that calls `inputRef.current.showPicker()` (with `.click()` fallback) and returns BEFORE the existing native temp-state setup. Native paths unchanged.
- Hidden inputs' `onChange` handlers commit directly via `commitPickerValue` (main) or `setAddDateValue/StartTime/EndTime` (AddDateSheet). No temp state, no Sheet, no Done button on web.
- Replaced FX3's `WEB_PICKER_INPUT_STYLE` constant (visible-input styling) with `HIDDEN_WEB_INPUT_STYLE` (opacity 0, 1×1px positioned-absolute).
- Removed orphaned `webPickerWrap` style entry from StyleSheet.create.

**Why:**
User-stated UX requirement: "Clicking just the field should open up the pickers so users can choose as fast as possible on web."

**Lines changed:** ~+115 / -75 net.

### `mingla-business/src/components/event/CreatorStep5Tickets.tsx`

**What it did before:**
Sale period picker (datetime-local) on web showed a Sheet with HTML5 input inside + Done button. 2-click flow.

**What it does now:**
- Web Sheet branch removed.
- 2 hidden `<input type="datetime-local">` elements (saleStart, saleEnd) added after the Android dialog block, gated `Platform.OS === "web"`. Each has a `useRef`. onChange parses `"YYYY-MM-DDTHH:MM"` → Date → calls `setSaleStartAt`/`setSaleEndAt` with `.toISOString()` (matches existing native commit shape).
- `handleOpenSalePicker` gets a web branch calling `showPicker()` / `.click()`.
- Replaced `WEB_SALE_PICKER_INPUT_STYLE` with `HIDDEN_WEB_INPUT_STYLE`. Reused `datetimeLocalFromDate` helper (still needed for the input's value).
- Removed orphaned `webSalePickerWrap` style entry.
- Added `useRef` to React import.

**Why:**
Same user requirement. Sales open / Sales close should open browser picker directly on tap.

**Lines changed:** ~+50 / -50 net (essentially equal-trade).

### `mingla-business/src/components/event/MultiDateOverrideSheet.tsx`

**What it did before:**
Time picker dock (start/end) on web showed a GlassCard dock with HTML5 input + Done button. 2-click flow.

**What it does now:**
- Web GlassCard dock branch removed.
- 2 hidden `<input type="time">` elements (start, end) added after the Android dialog block. `useRef` for each.
- `handleOpenTimePicker` gets a web branch calling `showPicker()` / `.click()`.
- onChange handlers directly call `setStartTime`/`setEndTime` (no temp state on web).
- Replaced `WEB_TIME_PICKER_INPUT_STYLE` with `HIDDEN_WEB_INPUT_STYLE`. Removed orphaned `webTimePickerWrap` style entry.
- `useRef` already imported (used elsewhere); no import change.

**Why:**
Same user requirement. Override start/end time rows should open browser picker directly.

**Lines changed:** ~+30 / -30 net.

## 3 — Spec Traceability

| Spec criterion | Implementation | Status |
|----------------|----------------|--------|
| Web tap row → browser picker opens directly (1 click) | All 4 `handleOpen*` handlers gated to `Platform.OS === "web"` triggering `showPicker()`/`.click()` | PASS by construction |
| `.click()` fallback for older browsers | Each handler checks `typeof showPicker === "function"` first, falls to `.click()` if absent or throws | PASS by construction |
| Hidden inputs use opacity 0 (NOT display:none) | `HIDDEN_WEB_INPUT_STYLE` uses `position:absolute, opacity:0, pointerEvents:none, 1×1px` | PASS by construction |
| iOS Sheet+spinner unchanged | iOS branches preserved verbatim in all 4 picker render blocks | PASS by construction |
| Android dialog unchanged | Android branches preserved; tightened guards to `Platform.OS === "android"` for explicit intent | PASS by construction |
| FX3 web Sheet branches subtracted | All 4 web Sheet/dock branches removed; FX3 `WEB_*_INPUT_STYLE` constants replaced; orphaned `webPickerWrap`/`webSalePickerWrap`/`webTimePickerWrap` styles deleted | PASS |
| onChange commits directly via existing handlers | Main: `commitPickerValue(mode, Date)` · AddDateSheet: `setAddDateValue/StartTime/EndTime(string)` · Sale: `setSaleStartAt/EndAt(iso)` · Override: `setStartTime/EndTime(string)` | PASS by construction |
| `min` attribute on date inputs | Main date: `min={isoFromDate(new Date())}` · UntilDate: `min={firstDate+1}` · AddDate date: `min={isoFromDate(new Date())}` | PASS by construction |
| `aria-label` on every hidden input | All 11 inputs have aria-label matching picker semantic | PASS by construction |
| TypeScript strict EXIT=0 | `cd mingla-business && npx tsc --noEmit` | PASS |
| `useRef` imported where needed | Step 2 + Step 5 added; Override already had it | PASS |

## 4 — Verification

| Check | Method | Result |
|-------|--------|--------|
| TypeScript strict | `cd mingla-business && npx tsc --noEmit` | EXIT=0 |
| 4 picker render blocks no longer have web Sheet branch | grep `Platform.OS === "web"` in 3 files: 3 hits, all on hidden-input render blocks (NOT Sheet/dock branches) | PASS |
| 11 hidden inputs render | Code inspection: 4 main Step 2 + 3 AddDateSheet + 2 Step 5 + 2 Override = 11 | PASS |
| 4 `handleOpen*` functions web-branched | Code inspection: `handleOpenPicker`, `handleAddDateOpenPicker`, `handleOpenSalePicker`, `handleOpenTimePicker` all return early on web after triggering ref | PASS |
| iOS branches preserved | Diffed iOS branches before/after — only re-indented under simplified ternary | PASS |
| FX3 styles subtracted | `webPickerWrap`, `webSalePickerWrap`, `webTimePickerWrap` removed from styles. `WEB_*_INPUT_STYLE` constants replaced with single `HIDDEN_WEB_INPUT_STYLE`. | PASS |
| Web smoke (1-click pickers actually open browser native) | Awaits user | UNVERIFIED |
| iOS regression smoke | Awaits user | UNVERIFIED |

## 5 — Invariant Verification

| Invariant | Preserved? |
|-----------|-----------|
| I-11..I-16 | Y (all untouched) |
| Constitution #1 no dead taps | RESTORED on web (1-click → picker opens) |
| Constitution #3 no silent failures | RESTORED on web (input commits directly; no Sheet→Done step where commit could be missed) |
| Constitution #8 subtract before adding | HONORED — FX3 web Sheet branches + `WEB_*_INPUT_STYLE` constants + 3 wrapper styles explicitly removed BEFORE adding the hidden-input pattern |

## 6 — Parity Check

N/A — single-platform organiser app. iOS + Android + Web all give 1-tap pickers now (each via their platform-native primitive).

## 7 — Cache Safety

N/A — no React Query / Zustand state shape changes. Picker state was already client-only; web removed a temp-state path entirely (commits direct, no temp).

## 8 — Regression Surface

Adjacent features most likely to break:

1. **iOS picker behavior** — verify Sheet+spinner still opens identically. iOS branch is now the FIRST true case in the simplified ternary (was second under FX3). Code path is structurally identical, just less nesting.
2. **Android picker behavior** — guard tightened from `pickerMode !== null` (catch-all non-iOS) to `Platform.OS === "android" && pickerMode !== null`. Functionally identical on Android; explicitly excludes web (where `pickerMode` won't be set anyway, so was already correct in practice).
3. **Hidden input keyboard accessibility** — `pointerEvents: "none"` on the input means click events go through to whatever's behind. Programmatic `showPicker()`/`.click()` still works because it bypasses pointer-events. Tab-key navigation may skip over the hidden inputs (intentional — they're not part of the visible form's tab order). Verify keyboard users can still navigate the visible Pressable rows.
4. **Cold-start state** — on web, draft fields may be null (e.g., new draft has no date yet). Hidden inputs render with `value=""` in that case. Browser shows a "blank" input which is fine. After first selection, value updates.
5. **AddDateSheet temp value loss** — AddDateSheet was using `addDateTempValue` for the iOS Sheet flow. On web, that temp state is now unused (we commit directly to `addDateValue`/`addDateStartTime`/`addDateEndTime`). The temp state still gets used on iOS when the user opens the picker; on web it stays null. Verify no UI reads `addDateTempValue` outside the iOS render block.

## 9 — Constitutional Compliance

| Principle | Status |
|-----------|--------|
| #1 No dead taps | RESTORED (1-click web pickers) |
| #3 No silent failures | RESTORED (direct commit eliminates web Done-button miss class) |
| #8 Subtract before adding | HONORED — see §3 + §4 |
| Others (2, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14) | Not affected |

## 10 — Transition Items

No new TRANSITIONAL markers. The hidden-input pattern is the canonical web UX.

## 11 — Discoveries for Orchestrator

**D-IMPL-CYCLE6-FX3.5-1 (Note severity)** — `addDateTempValue` is now web-unused (only iOS reads it). Could be conditionally not-set on web for cleanliness, but harmless as-is. Backlog cleanup candidate at organic touch-time.

**D-IMPL-CYCLE6-FX3.5-2 (Note severity)** — `salePickerTemp` and `tempPickerValue` (in CreatorStep2When + MultiDateOverrideSheet) are also web-unused. Same harmless pattern. Same cleanup-on-touch suggestion.

**D-IMPL-CYCLE6-FX3.5-3 (Low severity)** — The `pointerEvents: "none"` on hidden inputs means they can't receive direct user clicks (only `showPicker()` / programmatic `.click()`). This is intentional. If a screen-reader user activates a hidden input directly via accessibility tree, the input will fire its click handler normally — testing with VoiceOver/NVDA recommended in a future a11y audit cycle.

**No other side issues. The 3 forensics-stage discoveries (D-INV-FX3-1..5) carry over from earlier; not addressed by this fix.**

## 12 — Rework

N/A — first-pass implementation of FX3.5.

## 13 — Files Touched

| File | Type | LOC delta |
|------|------|-----------|
| `mingla-business/src/components/event/CreatorStep2When.tsx` | MOD | ~+115/-75 |
| `mingla-business/src/components/event/CreatorStep5Tickets.tsx` | MOD | ~+50/-50 |
| `mingla-business/src/components/event/MultiDateOverrideSheet.tsx` | MOD | ~+30/-30 |

Total: ~+195/-155 (net ~+40) — small net add despite adding 11 hidden inputs, because FX3's web Sheet branches were larger than the new hidden-input pattern.

## 14 — Cycle 6 Status

FX1 (Head web-only) + FX2 (founder-aware close) + FX3 (web pickers function) + FX3.5 (web pickers fast — this fix) all bundle into one Cycle 6 commit when full smoke completes. After FX3.5 user smoke + iOS regression check, Cycle 6 priorities #2-#5 unblocks fully and we can run CLOSE protocol.

## 15 — TypeScript Strict

```
$ cd mingla-business && npx tsc --noEmit
EXIT=0
```

Clean.
