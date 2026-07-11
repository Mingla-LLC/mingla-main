# INVESTIGATION — ORCH-1355 [RSVP create wizard focus / toggle-snap-back]

- **Surface:** mingla-business — RSVP creator wizard (shared RN; business iOS / Android / web).
- **Worktree:** `~/Desktop/mingla-orchs/orch-1355-[rsvp-wizard-focus-bug]/` on branch `orch-1355-rsvp-wizard-focus-bug` (rebased on `origin/main`, clean).
- **Phase:** INVESTIGATE (no fix proposed here; the SPEC defines the fix).
- **Confidence:** Symptom 2 = **root cause PROVEN** (deterministic RTL repro, 4/4 green). Symptom 1 = **leading hypothesis REFUTED**; actual cause **inconclusive** (native keyboard-layer, not reproducible at component level; needs a sim drive).

---

## 1. Symptom summary (expected vs actual)

| # | Reporter (Seth, verbatim) | Expected | Actual |
|---|---|---|---|
| 1 | "when you START TYPING in the NAME field, it automatically deselects like there is a focus issue" — the TextInput loses focus / drops the keyboard after a keystroke. | Typing keeps the field focused. | (Reported) keyboard drops after a keystroke on the RSVP Step-1 name field. |
| 2 | "STEP 5 (guest limit): when you select 'limit guest', you CANNOT deselect it — it keeps reselecting (the toggle snaps back ON)." | Turning "Limit the guest list" OFF stays OFF. | Toggle re-selects (snaps back ON) shortly after turning it off. |

---

## 2. Investigation manifest (every file read, in trace order)

| # | File | Why |
|---|---|---|
| 1 | `mingla-business/src/components/rsvp/RsvpCreatorWizard.tsx` | Container: `liveDraft`, `handleUpdate`, `queueAutosave`, `baseProps`, `renderStepBody`. |
| 2 | `mingla-business/src/components/event/CreatorStep1Basics.tsx` | Step-0 body (shared w/ event wizard): the NAME `Input` wiring. |
| 3 | `mingla-business/src/components/ui/Input.tsx` | The NAME field primitive (variant="text"); effects/focus state. |
| 4 | `mingla-business/src/components/rsvp/RsvpStep5Setup.tsx` | Step-5 body: `toggleCapacity` + all toggles. |
| 5 | `mingla-business/src/store/draftEventStore.ts` | `updateDraft` merge semantics; revision guard? immutability? |
| 6 | `mingla-business/src/wrappers/SmartScrollView.tsx` / `.native.tsx` | Body scroll container — remount-on-keyboard suspect. |
| 7 | `mingla-business/src/wrappers/useKeyboardIsVisible.ts` / `.native.ts` | Parent re-render source on keyboard show/hide. |
| 8 | `mingla-business/src/components/event/types.ts` | `StepBodyProps` contract. |
| 9 | `mingla-business/src/utils/serverDraftAutosaveGuards.ts` | `shouldApplyServerDraft` — the echo-apply gate. |
| 10 | `mingla-business/app/rsvp/[id]/edit.tsx` | Route: `handleAutosaveDraft`, `d_*`→server migration, wizard mount (no `key`). |
| 11 | `mingla-business/src/components/event/EventCreatorWizard.tsx` | Differential: does the event wizard share the same unstable `handleUpdate`? |

---

## 3. Q-scorecard

- **Q1 — Does the store `updateDraft` drop or reject patches (revision guard)?**
  **Verdict:** NO. `updateDraft` (draftEventStore.ts:990-997) is a clean immutable per-key merge with no revision guard. Client state is always correct after a write. *(proven — source + repro)*
- **Q2 — Does the NAME field (or an ancestor) REMOUNT on keystroke (the leading focus-drop hypothesis)?**
  **Verdict:** NO. The deterministic repro measures `inputMounts=1` across 3 keystrokes (no remount); the field re-renders (`inputRenders 1→4`) but is never unmounted. Route mounts the wizard with no `key`; the switch renders step bodies with no `key`; `SmartScrollView.native` is a stable `forwardRef` wrapper that does not remount children. **Leading hypothesis REFUTED.** *(proven-negative — RTL repro)*
- **Q3 — What makes the capacity toggle snap back ON?**
  **Verdict:** `toggleCapacity` issues TWO sequential `updateDraft` calls when turning capacity OFF; the parent `handleUpdate` rebuilds the debounced autosave payload from a STALE captured `liveDraft`, so the `rsvpCapacity:null` write is DROPPED from the payload that reaches the server; the server echo re-applies the old capacity → toggle re-selects. **CONFIRMED root cause.** *(proven — RTL repro, 4/4)*
- **Q4 — Is the defect RSVP-specific?**
  **Verdict:** The stale-autosave mechanism is generic (`handleUpdate` is byte-identical in `EventCreatorWizard`); it only manifests on toggles that issue MULTIPLE `updateDraft` calls per tap. In the RSVP wizard those are `toggleCapacity`-OFF and the visibility="private" pick. Symptom-1's scroll/keyboard config is byte-identical between the RSVP and event wizards. *(proven — source differential)*
- **Q5 — What is the actual cause of symptom 1?**
  **Verdict:** UNPROVEN. Not a remount (Q2). Native keyboard focus/blur is not observable in jsdom. Leading native suspects (unconfirmed): the per-keystroke re-render churn agitating `KeyboardAwareScrollView`'s focused-input worklet, and `keyboardDismissMode="on-drag"` (RsvpCreatorWizard.tsx:812) dismissing on a programmatic auto-scroll. **Requires a sim/device drive to confirm the exact trigger.** *(inconclusive)*

---

## 4. Findings (six-field evidence)

### F-1 — Capacity toggle snap-back: double `updateDraft` + stale-closure autosave drops the OFF write. **CONFIRMED ROOT CAUSE** (symptom 2)

1. **Symptom:** Turning "Limit the guest list" OFF re-selects (snaps back ON).
2. **Layer:** Code (component + container) → Data (autosave payload / server echo).
3. **Probe:** `npx jest --config jest.orch1355.render.cjs --runInBand` → `RsvpWizardToggleSnapback.orch1355.render.test.tsx` (REAL `RsvpStep5Setup` + REAL `draftEventStore` + a VERBATIM copy of the wizard's `handleUpdate`/`queueAutosave`, RsvpCreatorWizard.tsx:194-386).
4. **Evidence (verbatim mechanism):**
   - `RsvpStep5Setup.tsx:175-179` — `toggleCapacity` fires TWO writes when OFF:
     ```
     updateDraft({ rsvpCapacity: capacityOn ? null : Math.max(...) });
     if (capacityOn) updateDraft({ rsvpWaitlistEnabled: false });
     ```
   - `RsvpCreatorWizard.tsx:377-383` — `handleUpdate` rebuilds the autosave payload from the CAPTURED `liveDraft`:
     ```
     const nextDraft = { ...liveDraft, ...revisionedPatch, updatedAt: ... };
     latestDraftRef.current = nextDraft;
     queueAutosave(nextDraft);
     ```
   - Both writes run in one synchronous handler → both use the SAME `handleUpdate` closure (same captured `liveDraft`, `rsvpCapacity` = old number). The SECOND write's patch is `{rsvpWaitlistEnabled:false}` (no `rsvpCapacity`), so `{...liveDraft(cap=OLD), ...patch}` re-introduces the OLD capacity; `queueAutosave` (700ms debounce) overwrites the first timer, so the payload that fires is the STALE one.
   - **Test output:** after ON→OFF, `getDraft().rsvpCapacity === null` (store correct) but the autosaved payload `rsvpCapacity === 1` (STALE). Feeding that payload back through the REAL `upsertServerDraft` echo (`shouldApplyServerDraft` returns true, equal revision) flips `getDraft().rsvpCapacity` back to `1` → **snap-back reproduced end-to-end**. CONTROL (single-write plus-ones toggle) autosaves the correct value.
5. **Mechanism:** The OFF write reaches the client store but is dropped from the persisted/echoed payload → the server keeps the old capacity → the next server hydration re-selects the toggle.
6. **Severity:** CONFIRMED ROOT CAUSE.

### F-2 — Name-field focus drop: leading remount hypothesis REFUTED. **SUSPECTED (cause unproven)** (symptom 1)

1. **Symptom:** NAME field drops the keyboard after a keystroke.
2. **Layer:** Runtime (native keyboard) — not observable in jsdom.
3. **Probe:** `RsvpWizardNameFocus.orch1355.render.test.tsx` — REAL `CreatorStep1Basics` + VERBATIM parent `handleUpdate`/`baseProps`; a mount-counting probe occupies the name-`Input` reconciliation slot.
4. **Evidence:** `console.log [ORCH-1355 symptom1] inputMounts=1 inputRenders=4 (initial 1) harnessRenders=4 (initial 1)`. Field mounted exactly ONCE across 3 keystrokes; value accumulated to `"Set"`. No `key` on the wizard mount (`app/rsvp/[id]/edit.tsx:702-731`) or on `renderStepBody` (RsvpCreatorWizard.tsx:592-614); `SmartScrollView.native.tsx:33-39` is a stable `forwardRef`. `CreatorStep1Basics.tsx` has NO effect/ref/autoFocus/blur; the name field is a plain controlled `Input` (CreatorStep1Basics.tsx:175-182). `Keyboard.dismiss`/`.blur()` are never called in the render path.
5. **Mechanism:** The dispatch's leading hypothesis (unstable `handleUpdate` → child effect/remount → blur) does NOT hold: `CreatorStep1Basics`/`Input` have no callback-keyed effect, and no remount occurs. A controlled TextInput re-rendering per keystroke does not drop focus by itself. The real trigger is at the native keyboard layer and was not reproduced.
6. **Severity:** SUSPECTED CONTRIBUTOR (cause unproven; leading hypothesis refuted).

### F-3 — Unstable `handleUpdate` (`liveDraft` in deps) is the churn engine AND the direct stale-write mechanism. **SECONDARY ROOT CAUSE**

1. **Symptom:** Whole Step-1/Step-5 subtree re-renders on every keystroke/tap; autosave payload rebuilt from a stale draft.
2. **Layer:** Code (container).
3. **Probe:** Same suite (measured `inputRenders`/`harnessRenders` grow per keystroke; F-1 proves the stale write).
4. **Evidence:** `RsvpCreatorWizard.tsx:194-196` (`liveDraft` new identity per store patch) + `:385` dep array `[liveDraft, markDraftDirty, queueAutosave, updateDraft]` → `handleUpdate` new identity every render; `:377-383` rebuilds `nextDraft` from the captured `liveDraft` rather than the fresh store state. `EventCreatorWizard.tsx` carries the byte-identical pattern.
5. **Mechanism:** `handleUpdate` closing over `liveDraft` makes it unstable AND makes multi-write handlers compute from a stale base. This is the shared root behind F-1 (stale autosave) and the measured re-render churn (the leading native suspect for F-2).
6. **Severity:** SECONDARY ROOT CAUSE.

### F-4 — Second latent instance of the F-1 class: the visibility="private" pick. **SUSPECTED CONTRIBUTOR**

1. **Symptom:** (latent) picking "Private" then changing away could drop the forced `rsvpDiscoverable:false` from autosave.
2. **Layer:** Code.
3. **Probe:** Source read (not separately repro'd).
4. **Evidence:** `RsvpStep5Setup.tsx:370-373` — the private pick issues TWO writes: `updateDraft({ visibility: opt.id })` then `if (opt.id === "private") updateDraft({ rsvpDiscoverable: false })` — the identical double-write-through-`handleUpdate` shape as `toggleCapacity`-OFF.
5. **Mechanism:** Same stale-autosave class as F-1; the second write's value is dropped from the persisted payload.
6. **Severity:** SUSPECTED CONTRIBUTOR (same fix as F-1 resolves it).

---

## 5. Five-Truth-Layer reconciliation

| Layer | Finding | Contradiction? |
|---|---|---|
| **Docs** | RsvpStep5Setup docstring: `validateRsvpStep(4)` returns `[]`; toggles are UI-enforced. No mention of multi-write autosave hazard. | — |
| **Schema** | `DraftEvent.rsvpCapacity: number | null`; store `updateDraft` merges per-key immutably; `clientRevision` monotonic. | — |
| **Code** | `toggleCapacity` double-write + `handleUpdate` rebuilds autosave from captured `liveDraft`. | **CONTRADICTION vs Runtime** — the code path that updates the store is correct, but the code path that builds the *autosave* payload diverges from it. |
| **Runtime** | Client store ends at `rsvpCapacity=null` (correct); autosave payload carries `rsvpCapacity=OLD`; echo re-applies OLD → snap-back. | **The gap between client store (null) and autosave payload (OLD) IS the bug.** |
| **Data** | Server persists the stale payload; on hydration the draft carries the old capacity. | Consistent with Runtime. |

For symptom 1: Docs/Schema/Code show no remount or blur; Runtime (native) could not be exercised (jsdom). The gap is a Runtime-only unknown → sim required.

---

## 6. Repro evidence

- **Config:** `mingla-business/jest.orch1355.render.cjs` (RN preset + babel-jest; RTL 14.0.1 + react-test-renderer 19.1.0 from the per-worktree `.orch1118-testdeps` overlay — provisioned this session).
- **Command:** `cd mingla-business && npx jest --config jest.orch1355.render.cjs --runInBand` → **Test Suites: 2 passed; Tests: 4 passed.**
- **`RsvpWizardToggleSnapback.orch1355.render.test.tsx`** (3 tests):
  - "turning capacity OFF autosaves a STALE rsvpCapacity" — store `null`, autosave payload `rsvpCapacity===1`. **PASS (bug fingerprint).**
  - "the stale autosave, once echoed by the server, SNAPS THE TOGGLE BACK ON" — after `upsertServerDraft(stalePayload)`, `getDraft().rsvpCapacity===1`. **PASS (end-to-end snap-back).**
  - CONTROL "single-write plus-ones toggle autosaves the CORRECT value" — payload correct. **PASS (isolates the double-write class).**
- **`RsvpWizardNameFocus.orch1355.render.test.tsx`** (1 test): `inputMounts=1`, `inputRenders=4`, `harnessRenders=4`; value accumulated "Set". **PASS → no remount; leading hypothesis refuted.**
- **Sim/device:** NOT run. The wizard sits behind business auth (long authed flow to reach RSVP-create); the dispatch designated the RTL repro as PRIMARY proof. Symptom-1's native trigger remains to be confirmed on a device.

---

## 7. Blast radius / cross-surface map

- **In-scope (shared RN — business iOS / Android / web):** `RsvpCreatorWizard.tsx` (`handleUpdate`), `RsvpStep5Setup.tsx` (`toggleCapacity`, private-visibility pick), `CreatorStep1Basics.tsx` (symptom-1 field), the wizard body `ScrollView` config.
- **Latent same-class (NOT in this ORCH's fix unless trivially shared):** `EventCreatorWizard.tsx` carries the byte-identical unstable `handleUpdate` — any event-wizard step that issues >1 `updateDraft` per action has the same stale-autosave bug. `CreatorStep2When`/`CreatorStep3Where`/`CreatorStep4Cover` are shared and thread the same `updateDraft` — fixing `handleUpdate` at the RSVP container fixes RSVP; the event container needs the same fix (register as follow-on).
- **Not covered:** Consumer app (no RSVP creator), Admin web, backend (no schema/RPC change — client-only). Buyer/anonymous web (no wizard).

---

## 8. Invariant impact

- No existing invariant governs wizard `updateDraft` callback stability or multi-write autosave integrity (registry grep: 0 hits).
- **Proposed (DRAFT — orchestrator flips ACTIVE on CLOSE):**
  - `I-PROPOSED-1355-WIZARD-UPDATE-CALLBACK-STABLE` — the wizard's `updateDraft`/`handleUpdate` MUST read the freshest draft (store `getState()`/`latestDraftRef`) and MUST NOT close over `liveDraft` for building the autosave payload, so sequential writes in one handler compound instead of clobbering.
  - `I-PROPOSED-1355-TOGGLE-SINGLE-PATCH` — a single user toggle/select action MUST persist via ONE combined `updateDraft` patch (no sequential dependent writes that a stale closure can drop).

---

## 9. Discoveries for orchestrator

- **D-1:** `EventCreatorWizard.tsx` has the identical unstable `handleUpdate` + stale-autosave hazard (F-3). Any multi-write step there (e.g., ticket edits) can silently drop the second write from autosave. Recommend a follow-on ORCH to apply the same `handleUpdate` fix to the event wizard.
- **D-2:** Symptom 1 (name focus drop) is unconfirmed at root cause. Recommend a short sim/device drive dispatch to observe the exact native trigger before any symptom-1 code change ships (candidates: `keyboardDismissMode="on-drag"` × `KeyboardAwareScrollView` auto-scroll; per-keystroke re-render churn).
- **D-3:** The NAME field (`Input`, variant="text") does NOT carry the ORCH-0823 `autoCorrect={false}`/`autoCapitalize="none"` hardening the sibling Description field got — unrelated to focus but worth noting if a text-substitution artifact is later reported.

---

## 10. Confidence & recommended next phase

- **Symptom 2:** root cause PROVEN (deterministic repro). Ready for SPEC → IMPLEMENT.
- **Symptom 1:** leading hypothesis REFUTED; actual cause inconclusive — needs a sim drive. The SPEC fixes symptom 2 bindingly and scopes symptom 1 as a confirm-then-fix gate (no blind code change).
- **Recommended next phase:** SPEC (this dispatch's IA mode). Scope: mingla-business RSVP wizard + steps only; no backend, no migration. Symptom-1 code changes gated on device confirmation.
