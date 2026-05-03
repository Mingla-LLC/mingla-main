# Spec — ORCH-BIZ-CYCLE-6-FX3 — Web date/time picker parity

**Date:** 2026-05-01
**Author:** mingla-forensics
**Investigation:** [reports/INVESTIGATION_ORCH-BIZ-CYCLE-6-FX3_WEB_PARITY_AUDIT.md](Mingla_Artifacts/reports/INVESTIGATION_ORCH-BIZ-CYCLE-6-FX3_WEB_PARITY_AUDIT.md)
**Severity:** S1-high (blocks Cycle 6 web smoke entirely)
**Estimated effort:** 1.5–2 hrs implementor wall time

---

## 1 — Scope

This spec covers ONLY the **date/time picker BLOCKER** identified in RC-1 of the investigation. It addresses 9 picker mount sites across 3 files in the wizard surface so the wizard works end-to-end on Expo Web.

### Files affected (3 MOD)

1. `mingla-business/src/components/event/CreatorStep2When.tsx` (4 picker mounts: event date, doors-open, ends-at, recurrence until-date)
2. `mingla-business/src/components/event/CreatorStep5Tickets.tsx` (2 picker mounts: sale period start, sale period end)
3. `mingla-business/src/components/event/MultiDateOverrideSheet.tsx` (3 picker mounts: per-date date, start time, end time)

### Optional shared helper

If `Platform.select` blocks become repetitive across 9 sites, the implementor MAY extract a thin `WebDateTimePicker` component to `mingla-business/src/components/ui/WebDateTimePicker.tsx`. Per existing precedent (Cycle 4 `eventDateDisplay.ts`, Cycle 5 `ticketDisplay.ts`), shared helpers are encouraged when 3+ inline copies appear.

This spec **recommends** the shared component approach but does NOT mandate it — the implementor decides based on whether the abstraction adds clarity or noise.

## 2 — Non-Goals

- 🚫 NOT addressing `Alert.alert` ugliness on web (CF-1) — separate FX4 dispatch.
- 🚫 NOT migrating `Animated` to Reanimated for web perf (HF-2) — no user complaint, no measurable issue.
- 🚫 NOT removing unused native deps (D-INV-FX3-1) — separate backlog ORCH.
- 🚫 NOT adding ESLint rules to prevent future native-only imports (D-INV-FX3-3) — tooling cycle.
- 🚫 NOT changing iOS or Android picker behavior in any way. Web is purely additive.
- 🚫 NOT introducing a third-party date-picker library. Zero new external deps.

## 3 — Layer Specification

### 3.1 Component layer — the web picker variant

For each of the 9 picker mount sites, modify the existing `Platform.OS === "ios" ? ... : ...` ternary to include a web branch.

**Before (canonical pattern from CreatorStep2When.tsx:1003-1054):**

```tsx
{Platform.OS === "ios" ? (
  <Sheet visible={pickerMode !== null} onClose={handleClosePicker} snapPoint="half">
    <View style={styles.iosPickerSheet}>
      <View style={styles.iosPickerDoneRow}>
        <Button label="Done" variant="primary" size="md" onPress={handleClosePicker} />
      </View>
      {pickerMode !== null && tempPickerValue !== null ? (
        <View style={styles.iosPickerWrap}>
          <DateTimePicker
            value={tempPickerValue}
            mode={pickerMode === "date" || pickerMode === "untilDate" ? "date" : "time"}
            display="spinner"
            onChange={handlePickerChange}
            minimumDate={pickerMinimumDate}
            is24Hour
            textColor="#FFFFFF"
            themeVariant="dark"
            style={styles.iosPicker}
          />
        </View>
      ) : null}
    </View>
  </Sheet>
) : pickerMode !== null ? (
  <DateTimePicker
    value={...}
    mode={...}
    display="default"
    onChange={handlePickerChange}
    minimumDate={pickerMinimumDate}
    is24Hour
  />
) : null}
```

**After (canonical pattern):**

```tsx
{Platform.OS === "web" ? (
  <Sheet visible={pickerMode !== null} onClose={handleClosePicker} snapPoint="half">
    <View style={styles.iosPickerSheet}>
      <View style={styles.iosPickerDoneRow}>
        <Button label="Done" variant="primary" size="md" onPress={handleClosePicker} />
      </View>
      {pickerMode !== null && tempPickerValue !== null ? (
        <View style={styles.webPickerWrap}>
          <input
            type={pickerMode === "date" || pickerMode === "untilDate" ? "date" : "time"}
            value={
              pickerMode === "date" || pickerMode === "untilDate"
                ? isoFromDate(tempPickerValue) // "YYYY-MM-DD"
                : hhmmFromDate(tempPickerValue) // "HH:MM"
            }
            min={
              pickerMinimumDate !== undefined && (pickerMode === "date" || pickerMode === "untilDate")
                ? isoFromDate(pickerMinimumDate)
                : undefined
            }
            onChange={(e) => {
              const v = (e.target as HTMLInputElement).value;
              if (v.length === 0) return;
              let next: Date;
              if (pickerMode === "date" || pickerMode === "untilDate") {
                const [y, m, d] = v.split("-").map(Number);
                next = new Date(y, m - 1, d, 0, 0, 0, 0);
              } else {
                const [h, mm] = v.split(":").map(Number);
                next = new Date();
                next.setHours(h, mm, 0, 0);
              }
              setTempPickerValue(next);
            }}
            style={webPickerInputStyle}
            aria-label={
              pickerMode === "date" ? "Event date"
                : pickerMode === "untilDate" ? "Recurrence until date"
                : pickerMode === "doorsOpen" ? "Doors open time"
                : "Event end time"
            }
          />
        </View>
      ) : null}
    </View>
  </Sheet>
) : Platform.OS === "ios" ? (
  /* ...existing iOS branch unchanged... */
) : pickerMode !== null ? (
  /* ...existing Android branch unchanged... */
) : null}
```

### 3.2 The `webPickerInputStyle` constant

Define ONCE per file (or share via the optional `WebDateTimePicker` helper) at the module top:

```tsx
const webPickerInputStyle = {
  background: "rgba(255,255,255,0.08)",
  color: "#FFFFFF",
  border: "none",
  borderRadius: 12,
  padding: 12,
  fontSize: 18,
  fontFamily: "inherit",
  width: "100%",
  colorScheme: "dark", // Hints browser to render dark-mode picker UI
} as const;
```

This is a plain JS object, NOT a `StyleSheet.create` entry — HTML elements take CSS-style props directly on web (RN-Web bridges them).

### 3.3 Handler bridging

The existing `commitPickerValue(pickerMode, tempPickerValue)` and `handleClosePicker` flow remains identical. The ONLY change is `onChange` → `setTempPickerValue` (instead of the native module's `onChange(event, selected)` shape).

The "Done" button on the Sheet still calls `handleClosePicker` which calls `commitPickerValue(pickerMode, tempPickerValue)` — same path as iOS today.

### 3.4 Minimum date enforcement

Today's `pickerMinimumDate` is enforced via the native module's `minimumDate` prop. On web, it maps to the HTML5 `min` attribute (date inputs only).

For time-mode pickers (`doorsOpen`, `endsAt`, override start/end times): HTML5 time inputs do NOT support `min`/`max` cross-day reliably. The validation already exists in `draftEventValidation.ts` — the blocker for the spec is that the picker isn't rendering at all. Past-time prevention will work via the validator after publish; this is acceptable per Cycle 5 precedent (validator is the source of truth, picker is the input affordance).

### 3.5 Keyboard interaction on web

HTML5 `<input type="date">` opens the browser's native date picker on click in Chrome/Edge/Safari. Firefox renders an in-input editor. Both work. No additional code needed.

### 3.6 Per-file delta

Each of the 3 files needs:
1. The web branch added (see §3.1)
2. The `webPickerInputStyle` constant added once at module top
3. (Optional) `webPickerWrap` style added to the StyleSheet — `{ paddingHorizontal: spacing.lg, paddingVertical: spacing.md }`

`CreatorStep5Tickets.tsx` uses `mode="datetime"` on iOS (combined date+time spinner). On web, use `<input type="datetime-local">` with value format `"YYYY-MM-DDTHH:MM"`. The conversion helper:

```tsx
const datetimeLocalFromIso = (iso: string): string => {
  // iso is full ISO; output "YYYY-MM-DDTHH:MM"
  const d = new Date(iso);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
};
```

## 4 — Success Criteria

| AC | Criterion |
|----|-----------|
| AC#1 | Tap "Pick a date" row on Step 2 (Single mode) on Expo Web → Sheet opens with HTML5 date input. Pick a date → input updates → tap Done → row label updates to selected date. |
| AC#2 | Tap "Doors open" row on Step 2 → Sheet opens with HTML5 time input. Pick a time → tap Done → row updates. |
| AC#3 | Tap "Ends at" row on Step 2 → same as AC#2. |
| AC#4 | Step 2 Recurring mode → tap "Until" date row → Sheet opens with HTML5 date input + `min` attribute set to first-occurrence + 1 day. |
| AC#5 | Step 5 Tickets → tap "Sales open" → Sheet opens with HTML5 datetime-local input. Pick → Done → row updates. |
| AC#6 | Step 5 Tickets → tap "Sales close" → same as AC#5. |
| AC#7 | MultiDateOverrideSheet (opened from Step 2 multi-date row pencil OR Preview accordion) → all 3 pickers (date / start / end) work on web. |
| AC#8 | iOS native behavior unchanged — the iOS Sheet wrapper + DateTimePicker spinner still renders identically. |
| AC#9 | Android native behavior unchanged — bare DateTimePicker still mounts, fires `onChange`, advances `pickerMode`. |
| AC#10 | tsc strict (`cd mingla-business && npx tsc --noEmit`) exits 0 after all edits. |
| AC#11 | `pickerMinimumDate` enforced on web for date-mode pickers via HTML5 `min` attribute (matches iOS/Android `minimumDate` prop). |
| AC#12 | All web inputs have `aria-label` matching the picker semantic (event date, doors open, etc.). |
| AC#13 | Web picker visual styling matches the form's dark theme: dark background, white text, no default browser border. |
| AC#14 | Web `onChange` correctly converts string value → Date → existing `setTempPickerValue` callback. |
| AC#15 | "Done" button on web Sheet correctly calls `handleClosePicker` → `commitPickerValue(pickerMode, tempPickerValue)` → field updates. |

## 5 — Invariants Preserved

| Invariant | How |
|-----------|-----|
| I-11 format-agnostic ID resolver | UI-only change, no IDs touched |
| I-12 host-bg cascade | UI-only change, no canvas changes |
| I-13 overlay-portal contract | Web Sheet still uses the same Sheet primitive (already overlay-portal compliant) |
| I-14 date-display single source | All formatting still routed through `eventDateDisplay.ts` helpers |
| I-15 ticket-display single source | Untouched |
| I-16 live-event ownership separation | Untouched |
| Constitution #1 no dead taps | RESTORED on web (was violated by silent picker no-op) |
| Constitution #3 no silent failures | RESTORED on web (was violated by silent picker no-op) |
| Constitution #8 subtract before adding | Honored — adding new branch, not layering on broken native call |

## 6 — Test Cases

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| T-01 | Single date pick on web | Tap "Pick a date" → web date input → select 2026-06-15 → Done | Row reads "Mon 15 Jun" | Web component |
| T-02 | Time pick on web | Tap "Doors open" → web time input → select 21:30 → Done | Row reads "21:30" | Web component |
| T-03 | Recurring until-date min enforcement | First-occurrence = 2026-06-15. Open Until picker → confirm `min=2026-06-16` HTML attribute via devtools | Min set to firstDate+1 | Web component |
| T-04 | iOS Sheet wrap unchanged | Run on iOS sim → tap "Pick a date" → Sheet opens with spinner picker | iOS unchanged | Native iOS |
| T-05 | Android dialog unchanged | Run on Android emulator → tap "Pick a date" → native date dialog | Android unchanged | Native Android |
| T-06 | Step 5 datetime-local | Tap "Sales open" on web → pick a date+time | Saved as combined ISO | Web component |
| T-07 | MultiDate override sheet on web | Open override sheet from Step 2 multi-date row pencil → tap any picker | Picker opens, value commits | Web component |
| T-08 | tsc strict | `cd mingla-business && npx tsc --noEmit` | EXIT=0 | Type system |
| T-09 | Empty input handling | Web input cleared (user deletes value) → onChange fires with empty string | Handler returns early without calling setTempPickerValue (no NaN dates) | Web component |
| T-10 | Constitution #1 restored | Tap any picker on web | Picker UI appears (no silent no-op) | Visual smoke |
| T-11 | Web picker dismisses via Done | Open web picker → Done | Sheet closes, field updates | Web component |
| T-12 | Web picker dismisses via Sheet drag | Open web picker → drag Sheet down 80px | Sheet closes, field NOT committed (uncommitted state preserved per existing iOS pattern) | Web component |

## 7 — Implementation Order

Recommended sequence (top-down by file complexity):

1. **CreatorStep2When.tsx** — 4 picker mounts. Largest blast radius. Implement web branch, verify tsc, manually smoke 4 picker types in browser.
2. **MultiDateOverrideSheet.tsx** — 3 picker mounts. Apply same pattern.
3. **CreatorStep5Tickets.tsx** — 2 picker mounts. Uses `datetime-local` instead of `date`/`time`. Apply pattern with the datetime-local conversion helper.
4. **(Optional) Extract WebDateTimePicker.tsx helper** — only if the implementor judges the inline blocks repetitive enough to lift. Lift criteria: 3+ near-identical inline copies of 30+ LOC each. If lifted, all 3 files import the helper and pass `pickerMode`, `value`, `onChange`, `minimumDate`, `accessibilityLabel`.
5. **Verification matrix** — run tsc, smoke each picker on iOS sim (regression check), web (new functionality), Android emulator (regression check).
6. **Implementation report** — write to `Mingla_Artifacts/reports/IMPLEMENTATION_BIZ_CYCLE_6_FX3_WEB_PICKERS.md`.

## 8 — Regression Prevention

1. **Web-runtime smoke gate** — recommend codifying as feedback memory: "Every dispatch touching a runtime-rendered surface MUST include a manual Expo Web smoke check before declaring 'implemented.'" Mirrors the iOS-Sim smoke rule from FX1. Add to `memory/` after FX3 closes.
2. **Inline `[TRANSITIONAL]` comment NOT needed** — this fix is permanent. The native pickers are the canonical native UX; the web HTML5 inputs are the canonical web UX. No exit condition.
3. **Sentinel grep for future drift** — recommend a comment in each file at the top of the picker block: `// Web: HTML5 input. iOS: Sheet+spinner. Android: native dialog. NEVER add a picker without all 3.` Helps future devs not regress.

## 9 — Forward-Compat Note

If a 4th picker mount appears in a future cycle (likely, e.g., events Library timestamp filters, payout schedule pickers), the optional shared `WebDateTimePicker.tsx` helper becomes mandatory per the Cycle 4/5 single-source pattern. Forensics flags the threshold for the orchestrator to watch.

## 10 — Hard Constraints (re-stated)

- ❌ No new external libraries (no `react-datepicker`, no `react-native-web-datepicker`)
- ❌ No new kit primitives unless DEC-079-style carve-out is documented (the optional shared helper is judgment-call additive style)
- ✅ Preserve iOS + Android behavior exactly (lines NOT in the conditional ladder must NOT change)
- ✅ TypeScript strict must compile clean
- ✅ Implementor MUST run web smoke before declaring "implemented" (per recommendation §8.1)

## 11 — Estimated Scope

- **CreatorStep2When.tsx:** ~50 LOC delta (web branch + handler bridging + style)
- **CreatorStep5Tickets.tsx:** ~40 LOC delta (web datetime-local branch)
- **MultiDateOverrideSheet.tsx:** ~50 LOC delta (3 web branches share a wrapper if helper extracted)
- **(Optional) WebDateTimePicker.tsx:** ~80 LOC NEW (shared helper)
- **Total without helper:** ~140 LOC delta across 3 files
- **Total with helper:** ~170 LOC (+80 NEW, -50 inline net) across 4 files

Estimated wall time: **1.5–2 hrs** implementor + **30 min** web smoke verification.

## 12 — Open Questions for Orchestrator (none blocking)

- **OQ-1** — Lift to shared `WebDateTimePicker.tsx` helper now or wait for 4th mount? **Default-yes recommendation:** lift now since 9 mounts × 3 files = enough surface to justify. Implementor can decide based on actual code shape.
- **OQ-2** — Add the regression-prevention feedback memory in this cycle, or wait for the next implementor return? **Default-yes recommendation:** orchestrator codifies after FX3 closes (avoids parallel doc churn).

Both have safe defaults; no blocking direction needed.
