# INVESTIGATE — ORCH-1122: Trip-edit "Change cover" is a RUNTIME-PROVEN DEAD TAP

**Status:** INVESTIGATE complete. Root cause **PROVEN at source** by a deterministic React stale-closure mechanism that exactly matches the operator's runtime evidence (press-feedback fires, no sheet opens).
**Confidence:** **proven** (code layer; the React `useCallback` stale-closure trap is unambiguous and the operator's device repro is the runtime confirmation — see §Repro). One residual item: an on-device tap-fire screenshot is owed for a tester PASS, but the operator runtime fact + the proven gating condition together establish the dead tap and its cause.
**Owner:** mingla-forensics. **Date:** 2026-06-12. **Surfaces:** business iOS + business Android (mingla-business).
**Comms ledger:** read on entry. **COMMS-0024 (WARN, OPEN)** factored — confirms this trip-edit-cover investigation is ORCH-1122 (renumbered off the three-way ORCH-1116 stale-anchor collision). No BLOCK rows addressed to forensics / ORCH-1122 / ALL.

> **This SUPERSEDES the prior source-only conclusion** in `INVESTIGATE_ORCH-1122_TRIP_EDIT_COVER_PICKER_DUP.md` (and its ORCH-1122 appendix) that "the button + sheet co-mount, NOT a dead tap." That conclusion was WRONG. It read the JSX (`onPress → setCoverPickerVisible(true)` next to `<CoverPickerSheet visible={coverPickerVisible}>`) and stopped — it never noticed that this JSX is **produced by a `useCallback` whose dependency array omits `coverPickerVisible`**, so the rendered sheet reads a stale `false`. Seth's runtime proof is correct; the prior source read missed the memoization boundary.

---

## 1. Symptom summary (expected vs actual)

**Operator report (verbatim, device screenshot, iOS business dev build, runtime-1.0.0 OTA, 2026-06-12):** On the **Edit trip** screen, the **Cover** accordion section is expanded and shows the current cover image + a "Change cover" button (upload icon). "clicking change cover clicks but opens up nothing." Press feedback fires; NO sheet/modal appears. CONFIRMED DEAD TAP.

**Expected:** Tap "Change cover" → the unified `CoverPickerSheet` bottom sheet slides up (Library / GIFs / Photos tabs).

**Actual:** The button registers the press (visual feedback) but the sheet never mounts. Dead tap.

This is a **distinct, primary bug** from the GIF-tab env-key defect (the GIF-key ORCH). The GIF tab is never reached because the sheet never opens.

---

## 2. The button + sheet ARE in the same JSX — but that JSX comes from a memoized callback

`mingla-business/src/components/trip/EditPublishedTripScreen.tsx`:

- **Open-state declaration:** line **601** `const [coverPickerVisible, setCoverPickerVisible] = useState<boolean>(false);` — `useState`, initial `false`, stable setter.
- **The "cover" body** is produced by `renderSectionBody` — a `useCallback` opened at line **1097**:
  - Button: line **1336–1350**, `onPress={() => setCoverPickerVisible(true)}` (line 1347).
  - Sheet: line **1351–1372**, `<CoverPickerSheet visible={coverPickerVisible} … />` (line 1352).
- **The callback's dependency array:** lines **1441–1454**:
  ```
  [ editState, showEditAddressErrors, updateBasics, handleDaysChange,
    handleInclusionsChange, handlePricingChange, handleCoverChange,
    submitting, totalConfirmedOrders, soldCountByTier, trip, showToast ]
  ```
  **`coverPickerVisible` is NOT in this list.**
- **Invocation:** line **1522** `{renderSectionBody(sec.key)}`, inside `{isOpen ? (<View style={styles.sectionBody}>…</View>) : null}` (line 1520), inside `SECTIONS.map` (line 1490). The accordion expands fine (operator sees the cover image + button), so `renderSectionBody("cover")` IS being called.

---

## 3. Q-scorecard

**Q1 — Why does the sheet not open when the button is pressed? (the dead-tap mechanism)**
Verdict: **PROVEN — React `useCallback` stale-closure trap.** The chain:
1. Tap → `onPress` runs `setCoverPickerVisible(true)` (the setter is stable, so the press genuinely fires; state becomes `true`; component re-renders). This is why Seth sees press feedback.
2. On re-render, `renderSectionBody("cover")` is called again at line 1522 — but `renderSectionBody` is the **memoized** callback. React only re-creates it when a value in its dependency array (lines 1441–1454) changes. Pressing "Change cover" changes ONLY `coverPickerVisible`, which is **not in the deps**. None of the listed deps (`editState`, `submitting`, `trip`, the handlers…) changed. So React returns the **same cached callback instance**, carrying the **closure captured at its last memoization — where `coverPickerVisible === false`.**
3. That stale closure renders `<CoverPickerSheet visible={false} … />` → `<Sheet visible={false}>` → `mounted` stays `false` → the native `Modal` never mounts → **no sheet, dead tap.**
The state IS `true` in the component, but the JSX that reads it is frozen at `false`. **The button can never open the sheet on this screen.**

**Q2 — Does the CREATE path work, and why? (isolate the divergence)**
Verdict: **YES — create works because it renders the sheet INLINE, not through a memoized callback.** `TripCreatorStep1Basics.tsx` declares `coverPickerVisible` (line 204) and renders `<CoverPickerSheet visible={coverPickerVisible} … />` **directly in the component's top-level `return` JSX** (line 525–527, inside `return (` at line 279). Every re-render re-executes the component body and reads the fresh `coverPickerVisible`, so `setCoverPickerVisible(true)` → `visible={true}` → sheet opens. There is NO `useCallback` boundary between the state and the JSX. This is the exact divergence: **edit funnels the same JSX through a deps-incomplete `renderSectionBody`; create does not.**

**Q3 — Is this the same control as the create wizard, or a divergent one?**
Verdict: **Same shared `CoverPickerSheet` → same `Sheet` → same `CoverPicker`.** (The prior DUP investigation proved the component parity correctly.) The bug is NOT in the shared sheet — it is in HOW `EditPublishedTripScreen` HOSTS it (inside a memoized render-callback with a stale closure). The `Sheet` primitive (`SheetMobile.tsx`) is robust and identical everywhere; it never receives `visible={true}` on this path.

**Q4 — Pre-existing or recent regression?**
Verdict: **PRE-EXISTING since the unified-cover migration (2026-05-29), never caught.** `git blame`: the `renderSectionBody` `useCallback` wrapper + its deps array are from `3189a6b107` (2026-05-19, original screen construction). The `<CoverPickerSheet visible={coverPickerVisible}>` line was placed inside it at `f09494612a` (2026-05-29, ORCH-0989/0992 unified-cover migration). From that 2026-05-29 commit onward, the edit-path cover button has been a dead tap. It survived because every prior check was source-only / login-gated and the deps array *looks* plausible — `editState` being present masks the omission, since a reader assumes "the body re-renders." It does, but `coverPickerVisible` is not what triggers the re-memoization.

**Q5 — Did a live runtime repro confirm it?**
Verdict: **CONFIRMED by the operator's device repro** (press feedback, no sheet — exactly what the stale-closure mechanism predicts). A forensics on-device tap-fire is still login-gated in this environment (same sign-in wall as the prior pass), so the report's runtime confirmation is the operator's screenshot + statement, not a forensics-captured screenshot. The mechanism is deterministic at source, so confidence is **proven** rather than "probable."

---

## 4. Findings (six-field)

### F-1 — `renderSectionBody` useCallback omits `coverPickerVisible` from its deps → the rendered sheet reads a stale `false` → dead tap (CONFIRMED ROOT CAUSE)
- **Symptom:** "Change cover" shows press feedback; no sheet appears (operator device repro).
- **Layer:** code (React state/memoization).
- **Probe:** Read `EditPublishedTripScreen.tsx` lines 601 (state), 1097 (`useCallback` open), 1347 (setter call), 1352 (`visible={coverPickerVisible}`), 1441–1454 (deps array), 1522 (invocation). Compared to `TripCreatorStep1Basics.tsx:204,279,525`.
- **Evidence:** `const [coverPickerVisible, setCoverPickerVisible] = useState<boolean>(false);` (601). `const renderSectionBody = useCallback((key) => { … <CoverPickerSheet visible={coverPickerVisible} … /> … }, [editState, showEditAddressErrors, updateBasics, handleDaysChange, handleInclusionsChange, handlePricingChange, handleCoverChange, submitting, totalConfirmedOrders, soldCountByTier, trip, showToast]);` — deps span lines 1441–1454, **no `coverPickerVisible`**. The setter is invoked at 1347; the value is read at 1352 inside the same callback.
- **Mechanism:** Press fires `setCoverPickerVisible(true)` (stable setter) → re-render → React returns the cached `renderSectionBody` (no listed dep changed) whose closure has `coverPickerVisible === false` → `<CoverPickerSheet visible={false}>` → `<Sheet>` `mounted` never flips → Modal never mounts → dead tap.
- **Severity:** **CONFIRMED ROOT CAUSE.**

### F-2 — Trip CREATE works because the sheet is rendered inline, outside any memoized callback (CONTROL / divergence proof)
- **Symptom:** N/A (create cover opens normally).
- **Layer:** code.
- **Probe:** Read `TripCreatorStep1Basics.tsx:204,279,517,525–527`.
- **Evidence:** `<CoverPickerSheet visible={coverPickerVisible} … />` sits in the component's top-level `return` (line 525) — re-evaluated with the live state every render; no `useCallback` interposed.
- **Mechanism:** Fresh `coverPickerVisible` read each render → `setCoverPickerVisible(true)` → `visible={true}` → sheet opens.
- **Severity:** RULED OUT (as broken); this is the working reference that isolates F-1.

### F-3 — Event-edit is immune because it delegates cover to a self-contained component that owns its own state (blast-radius bound)
- **Symptom:** N/A (event-edit cover opens normally).
- **Layer:** code.
- **Probe:** Read `event/EditPublishedScreen.tsx:1176–1177,1196–1208` + `event/CreatorStep4Cover.tsx:42,109,118–120`.
- **Evidence:** Event-edit `renderSectionBody` `case "cover"` returns `<CreatorStep4Cover {...stepBodyProps} />` (line 1177) — and `CreatorStep4Cover` owns `const [pickerVisible, setPickerVisible] = useState(false)` (line 42), with button (`onPress={() => setPickerVisible(true)}`, 109) AND `<CoverPickerSheet visible={pickerVisible}>` (118–120) both inside ITS own render. The parent's memoized callback never closes over the open-state.
- **Mechanism:** Because the open-state lives inside the leaf component that re-renders on its own state change, there is no stale-closure boundary; the sheet opens. `coverPickerVisible` is not even referenced by the event-edit parent's deps.
- **Severity:** RULED OUT for event-edit (the trip-edit bug does NOT exist there).

### F-4 — Experience-edit is immune (routes to the creator wizard, not the accordion host)
- **Symptom:** N/A.
- **Layer:** code.
- **Probe:** Read `app/experience/[id]/edit.tsx` (routes `scheduled|live` → `ExperienceCreatorWizard` in live-edit mode, line ~303).
- **Evidence:** Experience edit reuses the create wizard (`ExperienceCreatorWizard` / `ExperienceCoverStep`), a self-contained step component — NOT the `renderSectionBody`-accordion pattern that traps trip-edit.
- **Mechanism:** Same as F-3 — the cover open-state lives in the leaf step, no stale-closure host boundary.
- **Severity:** RULED OUT for experience-edit.

---

## 5. Five-truth-layer reconciliation

| Layer | Finding | Contradiction? |
|-------|---------|----------------|
| Docs | I-NO-DEAD-TAPS forbids exactly this; ORCH-1103 precedent (a sheet that can't open from its trigger) is the canonical analog. | Corroborates F-1 (this is a new *flavor* of the ORCH-1103 dead-tap: not "sheet unmounted" but "sheet frozen at visible=false"). |
| Schema | N/A — pure client state bug; no DB/RPC involvement. | — |
| Code | `renderSectionBody` deps array omits `coverPickerVisible`; sheet reads the stale closure. | This IS the bug. |
| Runtime | Operator device repro: press feedback, no sheet. Matches the predicted stale-closure behavior exactly. | None — runtime confirms code. (Prior source-only pass contradicted runtime; it was wrong, now corrected.) |
| Data | N/A. | — |

**The prior investigation's contradiction (source said "works", runtime said "dead") is resolved here: the source read missed the `useCallback` memoization boundary. The runtime holds the truth; the code mechanism (F-1) explains it.**

---

## 6. Repro evidence

- **Operator (authoritative):** device screenshot + statement, iOS business dev build, runtime-1.0.0 OTA, 2026-06-12 — Edit trip → Cover expanded → "Change cover" press feedback, no sheet. This is the live-fire confirmation.
- **Forensics on-device tap-fire:** login-gated (same sign-in wall as the prior pass; reaching a real published trip's edit screen needs Seth's auth). NOT independently screenshotted by forensics this session. Honesty note: the root cause is proven at code by a deterministic mechanism that *predicts exactly* the operator's symptom, so confidence is `proven`; a forensics/tester device tap-fire is owed only as the standard pre-PASS gate, not to establish the cause.

---

## 7. Blast radius / cross-surface map

| Surface | Affected by F-1 (cover dead tap)? | Why |
|---------|-----------------------------------|-----|
| Business iOS — **trip EDIT (published: scheduled/live)** | **YES — DEAD TAP** | `EditPublishedTripScreen` renders the sheet via `renderSectionBody` with deps missing `coverPickerVisible`. |
| Business Android — trip EDIT (published) | **YES — DEAD TAP** | Same component; platform-agnostic React bug. |
| Business iOS/Android — trip CREATE (draft wizard, `TripCreatorStep1Basics`) | NO | Sheet rendered inline in `return` (F-2). |
| Business iOS/Android — trip EDIT **(draft)** → `TripCreatorWizard`/`TripCreatorStep1Basics` | NO | Draft edit routes to the create wizard (inline render), not the accordion host. |
| Business iOS/Android — **event** create + edit (`CreatorStep4Cover`) | NO | Self-contained leaf owns its state (F-3). |
| Business iOS/Android — **experience** create + edit (`ExperienceCreatorWizard`/`ExperienceCoverStep`) | NO | Wizard/leaf pattern (F-4). |
| Business iOS/Android — **brand** cover (`BrandEditView`, `BrandCreationFlow`) | NO (verify on fix) | Out of immediate scope; brand hosts render their own picker — not the trip accordion. Recommend a quick confirm during SPEC that no other host repeats the "sheet inside a memoized render-callback that omits the visible-state dep" anti-pattern. |
| Consumer / admin-web / buyer-web | N/A | No authoring CoverPicker. |

**The dead tap is SPECIFIC to the published-trip-edit host.** Trip create, draft-edit, event create/edit, and experience create/edit all open the cover sheet correctly. The unifying anti-pattern to grep for: a `CoverPickerSheet` (or any `Sheet`) rendered *inside a `useCallback`/`useMemo` body* whose dependency array omits the `visible` boolean state it reads.

---

## 8. Invariant impact

- **I-NO-DEAD-TAPS** — **VIOLATED** on the published-trip-edit cover control. This is the canonical violation: a control that shows press feedback but whose target never appears. (New sub-flavor vs ORCH-1103: there the sheet was conditionally *unmounted*; here it is *mounted but frozen at `visible=false`* via a stale `useCallback` closure.)
- **I-SUB-SHEET-INSIDE-PARENT** — still satisfied structurally (the sheet IS a JSX child of the host), but the memoization boundary defeats it functionally. Worth flagging for the SPEC that "JSX child of the host" is necessary but not sufficient when the host wraps the render in a deps-incomplete callback.
- **Proposed (DRAFT, orchestrator owns the flip):** `I-PROPOSED-OVERLAY-VISIBLE-STATE-IN-DEPS` — any overlay primitive (`Sheet`/`Modal`/`CoverPickerSheet`) rendered inside a `useCallback`/`useMemo` MUST list the `visible`/open boolean in that hook's dependency array (or be rendered inline). A fails-on-revert ESLint `react-hooks/exhaustive-deps` gate or a targeted unit test that flips state and asserts the sheet renders `visible={true}` would catch recurrence.

---

## 9. Discoveries for orchestrator

1. **The prior `INVESTIGATE_ORCH-1122_TRIP_EDIT_COVER_PICKER_DUP.md` Q1/F-2 "ruled out by source (dead tap does not hold)" verdict is FALSIFIED** and should be marked superseded by this report. The source read stopped at the JSX adjacency and missed the `useCallback` deps omission. Lesson reinforces the memory rule "wired in source ≠ fires at runtime" (ORCH-1103) — *especially across a `useCallback` boundary, where adjacency in JSX hides a stale-closure read.*
2. **`react-hooks/exhaustive-deps` is evidently not failing CI on this file** (or is disabled/warn-only) — a deps array that omits a read state variable shipped to prod. Worth an orchestrator note: enabling exhaustive-deps as an error would have caught this at lint time. (Flag only — not this ORCH's scope to change CI.)
3. **`tripToLocalEditState` provider/attribution nit** carried from the prior report (EditPublishedTripScreen seeds provider/source/credit/alt to `null` on load) — still latent, still not this bug. Re-flagged.
4. **The GIF-key defect (the other ORCH-1122 thread / GIF-key ORCH) is downstream of this dead tap** — until the sheet opens, no one reaches the GIF tab. Sequence the dead-tap fix FIRST, then validate the GIF tab on the now-openable trip-edit sheet.

---

## 10. Confidence + recommended next phase

**Confidence: PROVEN** (code-layer deterministic mechanism + operator runtime repro that matches it). Residual: a forensics/tester on-device tap-fire screenshot is owed as the standard pre-PASS gate (login-gated for forensics this session), but it does not change the root cause.

**Recommended next phase — SPEC, then IMPLEMENT (direction only — NOT a fix):**
1. **Scope:** restore the trip-edit cover button so the sheet opens at runtime. The narrow, lowest-risk shape is to make the rendered sheet read the LIVE `coverPickerVisible` — either by (a) adding `coverPickerVisible` (and `setCoverPickerVisible`) to the `renderSectionBody` deps array, or (b) extracting the cover body to a self-contained leaf component that owns its own open-state (the event-edit `CreatorStep4Cover` pattern — F-3), which is the more durable fix and matches the rest of the app. SPEC should choose between (a) the minimal deps-fix and (b) the structural extraction.
2. **Regression gate (fails-on-revert):** a unit/RTL test that mounts `EditPublishedTripScreen` (or the extracted leaf), expands the Cover section, fires the "Change cover" press, and asserts the `CoverPickerSheet` renders with `visible={true}` (e.g. the Modal/`testID` mounts). Must FAIL on revert. Optionally turn `react-hooks/exhaustive-deps` to error for this file.
3. **Then** revalidate the GIF-key thread on the now-openable sheet.
4. **Blast-radius confirm in SPEC:** grep for any other `Sheet`/overlay rendered inside a `useCallback`/`useMemo` whose deps omit the visible-state (brand hosts especially) and bind the do-not-regress.

*ORCH-1122 INVESTIGATE only — no fix implemented, no code/config edited, all probes read-only against `/Users/sethogieva/Desktop/mingla-main`.*
