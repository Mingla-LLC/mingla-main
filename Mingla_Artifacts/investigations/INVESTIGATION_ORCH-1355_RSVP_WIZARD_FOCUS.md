# INVESTIGATION — ORCH-1355 [RSVP create wizard focus / toggle-snap-back]

- **Surface:** mingla-business — RSVP creator wizard (shared RN; business iOS / Android / web).
- **Worktree:** `~/Desktop/mingla-orchs/orch-1355-[rsvp-wizard-focus-bug]/` on branch `orch-1355-rsvp-wizard-focus-bug` (rebased on `origin/main`, clean).
- **Phase:** INVESTIGATE (no fix proposed here; the SPEC defines the fix).
- **Confidence:** Symptom 2 = **root cause PROVEN** (deterministic RTL repro, 4/4 green) — SHIPPED (`5d7c8320b`). Symptom 1 = **REOPENED** (see §11 addendum): the component-level "no remount" verdict was correct but too narrow; the remount happens at the **route/navigator level** via the `d_*`→server draft-promotion `router.replace`. Root cause **CONFIRMED at the trigger level (source-proven) + strongly corroborated by an in-code prior-engineer observation**; the remount→focus-drop link is **PROBABLE** (runtime proof blocked; needs a sim drive).

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

---

## 11. ADDENDUM — Symptom 1 REOPENED: `d_*`→server draft-promotion route remount

Reopened on the orchestrator's traced lead (`app/rsvp/[id]/edit.tsx` promotion). The §4 F-2 verdict ("no component remount") stands but was scoped too narrowly: the remount is at the **route/navigator** level, not inside `CreatorStep1Basics`. My isolated RTL mount could not catch it because it had no route/`edit.tsx` wrapper.

### 11.1 The trigger — CONFIRMED (source-proven, deterministic)

The RSVP **create** flow starts on a client `d_<ts36>` draft:
- `app/rsvp/create.tsx:192-193` — `createRsvpDraft(brandId)` (mints `d_*`) → `router.replace('/rsvp/{d_id}/edit?step=0')`.

On the **first edit**, the draft promotes to a server draft (lazy, ORCH-0893). Path:
- First keystroke → `RsvpCreatorWizard.handleUpdate` → `queueAutosave` (700ms debounce) → `onAutosaveDraft` = `handleAutosaveDraft`.
- `app/rsvp/[id]/edit.tsx:450-533` `handleAutosaveDraft`: `if (incoming.id.startsWith("d_"))` and `isDraftDirty(incoming)` → `createServerDraft(...)` → on resolve: **`replaceDraft(d_*→serverDraft)` + `router.replace('/rsvp/<serverId>/edit?step=…')`** (lines 526-533).

`isDraftDirty` (`src/utils/draftDirtyCheck.ts`) returns `true` as soon as `name.trim().length > 0` → the promotion fires after the **first character** (＋ the 700ms debounce). `router.replace` changes the `[id]` dynamic segment — a real expo-router (6.0.23) navigation. Changing a dynamic route instance replaces the screen (new route key) → the screen component (and its name `TextInput`) **remounts** → keyboard drops. This matches all three of Seth's facts: first-character (promotion fires on first dirty edit), create-flow (the `d_*`→server promotion), and unreproducible in the isolated RTL mount (no navigator).

**Timing reconciliation:** the promotion is 700ms-debounced after the *first keystroke burst*. "After the first character" fits a user who types the name a character at a time / pauses (~700ms) — the drop lands while still focused in the name field.

### 11.2 In-code corroboration (the prior engineer saw this exact symptom)

`app/rsvp/[id]/edit.tsx:153-159` (ORCH-1150 D-1), verbatim: *"retain the last resolved draft so the `d_*`→server migration swap does NOT flash the `draft===null` Spinner (which **remounts the wizard, perceived as a 'refresh' while typing the name**). During an in-flight migration the resolved `draft` momentarily goes null between `replaceDraft(d_*→server) + router.replace(newId)` and `useDraftById(newId)` resolving."*

A prior engineer OBSERVED the identical symptom ("refresh while typing the name") from this exact swap and added the D-1 retention (`lastResolvedDraftRef` / `migrationInFlight` / `renderDraft`, lines 353-361) to mitigate it. **Seth still sees it** → D-1 is INCOMPLETE: it suppresses the intra-instance `draft===null` Spinner flash, but a `lastResolvedDraftRef` on the *unmounting* screen instance cannot survive a React-Navigation screen remount driven by `router.replace(newId)`.

### 11.3 The event-vs-RSVP asymmetry — NOT explained by code (create flow is byte-identical)

The orchestrator's must-answer question. Result: **the promotion path is symmetric between the event and RSVP create flows** — I could NOT find a code-level RSVP-only difference:
- `app/event/create.tsx:192-193` — `createDraft(brandId)` (`d_*`) → `router.replace('/event/{d_id}/edit?step=0')`. Identical shape to RSVP.
- `app/event/[id]/edit.tsx:388-478` `handleAutosaveDraft` — same `createServerDraft` → `replaceDraft` + `router.replace('/event/<serverId>/edit')` (lines 449-456).
- `isDraftDirty` + the 700ms `queueAutosave` debounce are shared/identical (both wizards, `src/utils/draftDirtyCheck.ts`).
- Structural diff of the two routes: the **only** create-path difference is the RSVP-only **D-1 retention** — which makes RSVP *strictly better* at focus-preservation, not worse.

Because the promotion is symmetric and the only difference protects RSVP, the promotion-remount **cannot, by code alone, explain "event fine, RSVP broken."** The most likely reconciliations (to confirm on-device):
1. **The event create wizard has the SAME latent focus-drop**, and "event is fine" reflects a different *test condition* — e.g. Seth resumed an existing **server-backed** event draft (id already a server uuid → NO promotion → no remount), or typed the event name in a continuous burst so the 700ms promotion fired *after* he left the name field.
2. A native-only factor outside these code paths that I could not isolate statically.

Either way, the bug is best characterized as **create-flow-wide (both event and RSVP fresh creates), not RSVP-specific** — so the fix must cover both routes.

### 11.4 Repro + honest cap

- **Trigger:** source-proven (deterministic code path above) + corroborated by the D-1 comment. This is not theory — it is the literal `replaceDraft` + `router.replace(newId)` call on first dirty edit.
- **Remount → focus-drop:** **PROBABLE, NOT runtime-proven here.** I attempted the decisive `expo-router/testing-library` `renderRouter` proof (`jest.orch1355.router.cjs` + `RsvpPromotionRemount.orch1355.router.test.tsx`) to show `router.replace` to a new `[id]` remounts the screen subtree. **Blocked** by a named environment issue: the worktree's **symlinked `node_modules`** (resolves to the anchor, outside `rootDir`) + jest-expo's overlay dependency duplication (expo/react/react-native) makes the full expo-router harness unstable (Flow-transform + duplicate-`expo` `Super expression must … be a function`). Fully resolving it needs a real `npm ci` in the worktree — disproportionate, and it would not resolve the §11.3 symmetry question anyway. The blocked config/test were removed.
- **DECISIVE proof = iOS sim drive** into the authed RSVP (and event) create wizard, instrumenting screen mount count on promotion. Blocked here by business auth (Seth credential/login). Confidence therefore capped at **PROBABLE**.

### 11.5 Discoveries update
- **D-4:** Symptom 1 is **create-flow-wide** — `app/event/[id]/edit.tsx` shares the identical `d_*`→server promotion `router.replace(newId)`; the fix should cover BOTH routes (event as a fast-follow if the sim confirms it there too).
- **D-5:** The ORCH-1150 D-1 retention is a **partial fix** for this exact symptom — it addresses the Spinner-flash but not the navigator remount. Do not delete it; the real fix supersedes its purpose.
