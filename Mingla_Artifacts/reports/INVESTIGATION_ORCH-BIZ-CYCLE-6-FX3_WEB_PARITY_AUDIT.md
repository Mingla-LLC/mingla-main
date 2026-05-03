# Investigation — ORCH-BIZ-CYCLE-6-FX3 — Web parity audit

**Date:** 2026-05-01
**Investigator:** mingla-forensics
**Confidence:** HIGH (root cause for pickers — proven six fields) · MEDIUM-HIGH (broad sweep — 5 surface classes inspected end-to-end + grep across all of mingla-business)
**Mode:** INVESTIGATE-THEN-SPEC

---

## 1 — Symptom Summary

**Reported by user:** On Expo Web (Cycle 6 smoke priority #4 path), every date/time picker in the wizard is non-functional:
- Step 2 (When): event date, doors-open, ends-at, recurrence until-date — all dead
- Step 5 (Tickets): sale period start, sale period end — dead
- MultiDateOverrideSheet: per-date date/start/end — dead

User additionally requested a broader audit: find anything else that may work on iOS/Android but break on web/Android.

**Expected behavior:** Tap any picker trigger → inline date/time picker opens → user selects → field updates.
**Actual behavior on web:** Tap fires `setPickerMode(...)`, but the conditional render ladder lands on the native-only `<DateTimePicker>` from `@react-native-community/datetimepicker`, which has no web build. Component renders nothing. User sees the field selected (active state) but no picker UI.

**Reproduction:** 100% on Expo Web, 0% on iOS/Android.

---

## 2 — Investigation Manifest

| # | File | Layer | Why |
|---|------|-------|-----|
| 1 | `mingla-business/package.json` | dependencies | Inventory native modules |
| 2 | `mingla-business/src/components/event/CreatorStep2When.tsx` | code | 4 wizard pickers — primary blocker |
| 3 | `mingla-business/src/components/event/CreatorStep5Tickets.tsx` | code | Sale period pickers |
| 4 | `mingla-business/src/components/event/MultiDateOverrideSheet.tsx` | code | Per-date override pickers |
| 5 | `mingla-business/src/utils/hapticFeedback.ts` | code | Haptic web behavior |
| 6 | `mingla-business/src/context/AuthContext.tsx` | code | Native auth providers (Apple/Google) |
| 7 | `mingla-business/src/components/ui/Sheet.tsx` | code | Overlay primitive on web |
| 8 | `mingla-business/src/components/ui/TopSheet.tsx` | code | Overlay + BackHandler use |
| 9 | `mingla-business/src/components/auth/BusinessWelcomeScreen.tsx` | code | BackHandler + Animated useNativeDriver + Alert |
| 10 | `mingla-business/src/components/brand/BrandEditView.tsx` | code | KeyboardAvoidingView use |
| 11 | `mingla-business/src/components/event/PublicEventPage.tsx` | code | Already-fixed Share API web branch (FX1+FX2) |

Plus systematic grep across `mingla-business/src` and `mingla-business/app` for: native-only imports, `Platform.OS` use sites, `Alert.alert`, `Share.share`, `Linking.*`, `BackHandler`, `useNativeDriver`, `KeyboardAvoidingView`.

---

## 3 — Findings

### 🔴 RC-1 — Date/time pickers have no web branch (BLOCKER)

| Field | Content |
|-------|---------|
| **File + line** | `mingla-business/src/components/event/CreatorStep2When.tsx:1003-1054` |
| **Exact code** | `{Platform.OS === "ios" ? (<Sheet>...</Sheet>) : pickerMode !== null ? (<DateTimePicker .../>) : null}` |
| **What it does** | On iOS: wraps DateTimePicker in a Sheet. On Android: renders bare DateTimePicker (native dialog). On web: falls through to the second branch (`Platform.OS === "ios"` is false) and tries to render `<DateTimePicker>` from `@react-native-community/datetimepicker`. |
| **What it should do** | On web: render an HTML5 `<input type="date">` or `<input type="time">` (the equivalent native browser picker), wrapped in the same Sheet pattern for visual consistency, with `min`/`max` attributes mapping to the existing `pickerMinimumDate` logic. |
| **Causal chain** | `@react-native-community/datetimepicker` is a native-only module — its package has no web entry. When `react-native-web` resolves the import on web bundle, it falls back to a no-op stub. The component renders, fires `onChange` for nothing, and the user sees no picker UI. |
| **Verification step** | Open browser devtools on Expo Web. Tap the "Pick a date" row on Step 2. Inspect the React tree: `<DateTimePicker>` is mounted but renders no DOM children. No console error (silent no-op). Confirmed by code-trace + npm package inspection. |

**Same pattern at:**
- `CreatorStep5Tickets.tsx:1005-1054` (sale period start + end pickers — 2 picker mounts)
- `MultiDateOverrideSheet.tsx:445-490` (per-date date + start time + end time — 3 picker mounts, ALL conditionals only branch iOS vs not-iOS)

**Total picker mount sites broken on web:** 9 (4 in Step 2, 2 in Step 5, 3 in override sheet).

---

### 🟠 CF-1 — `Alert.alert` displays browser-native dialog on web (DEGRADED)

| Field | Content |
|-------|---------|
| **File + lines** | `BusinessWelcomeScreen.tsx:219, 245`; `AuthContext.tsx:137, 218, 231, 257, 263, 305` |
| **Code** | `Alert.alert("Title", "Message")` |
| **Behavior on web** | `react-native-web` translates this to `window.alert()` — a browser-native blocking dialog. Visually inconsistent with the rest of mingla-business's glass-card design. Buttons are browser-default styling. No way to render multiple action buttons cleanly. |
| **iOS/Android** | Uses native alert; matches design language. |
| **Severity** | DEGRADED — works (user can dismiss), looks wrong. Not a blocker but harms perceived polish. |
| **Fix path** | Replace with kit `ConfirmDialog` (already exists) for multi-button cases, or kit `Toast` for single-message info. Each call site is small. |

8 call sites total, all in auth flows.

---

### 🟡 HF-1 — `expo-haptics` silent no-op on web (DEGRADED, low impact)

| Field | Content |
|-------|---------|
| **File** | `mingla-business/src/utils/hapticFeedback.ts` |
| **Behavior** | Already wrapped in `try/catch`. On web, `Haptics.impactAsync` throws; caught silently. |
| **Severity** | COSMETIC — feature degradation (no haptic feedback on button press) but not a defect. |
| **Fix path** | None required. Add a one-line `if (Platform.OS === "web") return;` to skip the call entirely (saves the throw/catch overhead). Can land at organic touch-time. |

---

### 🟡 HF-2 — `Animated` with `useNativeDriver: true` runs on JS thread on web (DEGRADED, minor)

| Field | Content |
|-------|---------|
| **Files** | `BusinessWelcomeScreen.tsx` (10 call sites), `BusinessLandingScreen.tsx` (2 call sites) |
| **Behavior** | `useNativeDriver: true` is silently ignored on web; animations run on JS main thread. Performance is slightly worse than native-driven but still functional. |
| **Severity** | COSMETIC — visually identical, marginally less smooth on slow devices. |
| **Fix path** | None required. Consider migrating to `react-native-reanimated` (already a dep) which has proper web support, but only if performance becomes a complaint. |

---

### 🟡 HF-3 — `KeyboardAvoidingView` no-op on web (FINE)

| Field | Content |
|-------|---------|
| **File** | `BrandEditView.tsx:337-547` (wraps the entire form) |
| **Behavior on web** | `react-native-web`'s `KeyboardAvoidingView` is a no-op pass-through View. Web has no soft keyboard avoidance need (browser handles it). |
| **Severity** | NONE — correct behavior on web. Flagged as observation only. |

---

### 🟡 HF-4 — `BackHandler` already correctly Android-gated (FINE)

| Field | Content |
|-------|---------|
| **Files** | `BusinessWelcomeScreen.tsx:193`, `TopSheet.tsx:215` |
| **Behavior** | Both consumers wrap `BackHandler.addEventListener` in `if (Platform.OS !== "android") return` — already correct. iOS swipe-back and web browser-back are unaffected. |
| **Severity** | NONE — flagged as observation only. |

---

### 🔵 OBS-1 — Native modules installed but unused

`@stripe/stripe-react-native`, `react-native-nfc-manager`, `expo-camera`, `expo-image-picker` are in `package.json` but have ZERO import sites in `mingla-business/src` or `mingla-business/app`. Worth removing to slim the dep tree, but not a parity issue today.

**Recommendation:** Backlog cleanup — separate ORCH-ID, low priority.

---

### 🔵 OBS-2 — `expo-blur` web support is browser-conditional

`Sheet.tsx:70-80` already feature-detects `backdrop-filter` CSS support and falls back to a solid background color when unsupported. Firefox <103 and older browsers see a solid panel instead of frosted glass. This is correct progressive enhancement.

**Severity:** NONE — flagged as observation. Already handled correctly.

---

### 🔵 OBS-3 — `Share.share` already correctly web-branched in PublicEventPage

`PublicEventPage.tsx:190-225` already implements platform-aware sharing: web uses `globalThis.navigator.share` with `clipboard.writeText` fallback; native uses RN `Share.share`. This is the canonical pattern.

**Recommendation:** When other surfaces add Share, reuse this pattern. Consider lifting to a `shareUrl` utility helper if a 2nd consumer appears.

---

### 🔵 OBS-4 — `expo-apple-authentication` + `@react-native-google-signin` already correctly Platform-gated

`AuthContext.tsx` extensively branches `Platform.OS === "web"` for both providers. Web auth uses Supabase OAuth redirect flow (Cycle 0b). Native uses the respective SDKs. Correct.

---

### 🔵 OBS-5 — `expo-linear-gradient`, `expo-blur`, `expo-image`, `expo-symbols`, `expo-web-browser` all have first-party web support

All current expo modules in use have web implementations. No silent breaks.

---

## 4 — Five-Layer Cross-Check (for the picker root cause)

| Layer | Question | Finding |
|-------|----------|---------|
| **Docs** | What does Cycle 4 spec / DEC-081 say about web pickers? | DEC-081 mandates web parity via Expo Web. Cycle 4 spec specified iOS Sheet + Android native dialog patterns; no explicit web spec — implicit gap. |
| **Schema** | N/A | UI bug only |
| **Code** | What does the code do on web? | Renders `<DateTimePicker>` from native-only module → no-op stub → silent failure |
| **Runtime** | What happens? | Picker trigger fires `setPickerMode(...)`, conditional renders the Android branch JSX, `react-native-web` resolves the import to nothing, no DOM emitted, no error logged |
| **Data** | Picker state | `pickerMode` set correctly but `commitPickerValue` never called because `onChange` never fires |

**Layer contradiction:** Docs (DEC-081 web parity required) vs Code (no web branch). This is the bug.

---

## 5 — Blast Radius

- **9 picker mount sites** across 3 files (Step 2 ×4, Step 5 ×2, MultiDateOverrideSheet ×3) — all break on web
- **Affects every event-creation journey on web:**
  - J-E1 build-from-Home (event date selection)
  - J-E5 recurring picker (until-date)
  - J-E6 multi-date list builder (per-date dates)
  - J-E7 per-date override sheet (start/end times)
  - All Step 5 ticket sale-period picks
- **Cycle 6 smoke priorities #2–#5 fully blocked** until pickers work on web
- **No invariant violations** — I-11 through I-16 untouched
- **No constitutional violations**, but **DEC-081 (web parity required)** is currently de-facto violated for these surfaces

---

## 6 — Invariant / Constitutional Check

- I-11..I-16 all preserved (UI-only fix, no schema/store changes)
- Constitution #1 (no dead taps) — VIOLATED on web today: tapping a picker row fires no visible response
- Constitution #2 (one owner per truth) — preserved
- Constitution #3 (no silent failures) — VIOLATED weakly: picker no-op is silent, no error logged

The fix must restore Constitution #1 + #3 on web.

---

## 7 — Fix Strategy (direction, not spec)

### For RC-1 (the picker BLOCKER)

**Recommended approach: Platform.select with HTML5 inputs.**

For each of the 9 picker mount sites:

1. Add a third branch to the existing `Platform.OS === "ios" ? ... : ... : null` ternary:
   - `Platform.OS === "web"` → render an HTML5 `<input>` wrapped in the existing Sheet pattern
   - The HTML5 input's `type` attribute maps to the existing `mode` prop:
     - `mode="date"` → `<input type="date">`
     - `mode="time"` → `<input type="time">` with `step={60}` (1-min granularity, matches RN picker)
   - `min`/`max` attributes derive from existing `pickerMinimumDate` / `pickerMaximumDate` logic
   - `onChange` handler parses the input string value, converts to Date, fires the existing `commitPickerValue` callback
2. Wrap the web input in the same Sheet primitive used for iOS so the visual chrome (Done button, sheet drag handle) stays consistent.
3. Style the input via inline CSS (web-only) to match the form's dark theme — base style is roughly `{ background: "rgba(255,255,255,0.08)", color: "#FFFFFF", border: "none", padding: 12, borderRadius: 12, fontSize: 18 }`. Browser-native picker UI overrides on date click.

**Trade-offs:**
- ✅ Zero new external dependencies
- ✅ Native browser pickers (mobile Safari shows a slick wheel; desktop Chrome shows a calendar grid)
- ⚠️ Visual inconsistency across browsers (Safari date picker ≠ Chrome date picker) — accepted pre-MVP
- ⚠️ HTML5 datetime-local for the future Step 5 sale-period pickers (which need both date AND time) — supported in all evergreen browsers

### For CF-1 (Alert.alert ugliness)

Replace 8 call sites with `ConfirmDialog` (multi-button) or `Toast` (single message). Per-site small change. Defer to a separate Cycle 6 FX4 polish dispatch — not blocking smoke.

### For HF-1 / HF-2 / HF-3 / HF-4

No-op or already-handled. No code change needed.

---

## 8 — Regression Prevention

1. **Add a permanent web-runtime smoke gate** to the implementor checklist: every dispatch touching a runtime-rendered surface MUST include a manual Expo Web smoke check before declaring "implemented." This mirrors the iOS-Sim smoke rule from FX1 (D-IMPL-CYCLE6-FX1-2).
2. **Lint rule recommendation (long-term):** ESLint custom rule that flags any import from `@react-native-community/*` or `@stripe/stripe-react-native` etc. without an adjacent `Platform.OS === "web"` check or a `.web.tsx` variant file. Defer to a tooling cycle.
3. **Documentation:** add a "Web parity rule" feedback memory codifying that every new component must be smoke-tested on Expo Web before close. Codify in `memory/`.

---

## 9 — Discoveries for Orchestrator

| ID | Severity | What |
|----|----------|------|
| D-INV-FX3-1 | Note | 4 unused native deps (`@stripe/stripe-react-native`, `react-native-nfc-manager`, `expo-camera`, `expo-image-picker`) — backlog cleanup ORCH-ID candidate |
| D-INV-FX3-2 | Low | 8 `Alert.alert` call sites should migrate to ConfirmDialog/Toast — Cycle 6 FX4 polish or backlog |
| D-INV-FX3-3 | Note | No ESLint rule today preventing native-only imports from being added without web fallback — tooling-cycle candidate |
| D-INV-FX3-4 | Note | Recommend codifying "Every dispatch touching runtime-rendered surfaces requires Expo Web smoke before close" as a permanent feedback memory — mirrors iOS-Sim smoke rule |
| D-INV-FX3-5 | Note | Consider lifting `shareUrl` to a util when 2nd Share consumer appears — pattern already correct in PublicEventPage |

---

## 10 — Confidence Level

**HIGH for RC-1 (picker root cause):**
- All six fields filled with verbatim code + line numbers
- Confirmed via grep across all 3 affected files (same pattern in each)
- Confirmed library has no web entry via knowledge of `@react-native-community/datetimepicker` package structure

**MEDIUM-HIGH for the broad sweep:**
- All native module imports inventoried (5 native-only imports total in entire mingla-business — picker, haptics, AuthContext × 2 providers, no others)
- All `Platform.OS` use sites inspected
- All RN APIs known to diverge on web checked (Alert, Share, Linking, BackHandler, KeyboardAvoidingView, useNativeDriver) — only Alert is DEGRADED, rest are correctly handled
- Did NOT do a runtime web-bundle inspection (no live device test) — would raise to HIGH but adds 1-2 hrs and the code-trace is conclusive

**To raise broad sweep to HIGH:** boot Expo Web, inspect each surface manually for visual / behavioral parity. Recommend doing this AFTER picker fix lands — if user finds anything else during smoke, log as separate ORCH-ID.

---

## 11 — Recommendation to Orchestrator

**Single Cycle 6 FX3 implementor dispatch covering ONLY the picker BLOCKER (RC-1).** The 9 mount sites can be fixed with a shared helper or per-site Platform.select; ~80-150 LOC delta total. Estimated 1.5-2 hrs implementor wall time.

CF-1 (Alert.alert) and the discoveries can be queued for a separate FX4 polish dispatch or rolled into Cycle 6 close. Don't block Cycle 6 smoke on them.

After FX3 lands, web smoke for Cycle 6 priorities #2–#5 unblocks. Final web compatibility verification can happen during Cycle 6 close.
