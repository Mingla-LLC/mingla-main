# SPEC — ORCH-1355 [RSVP create wizard focus / toggle-snap-back] FIX

- **Source investigation:** `Mingla_Artifacts/investigations/INVESTIGATION_ORCH-1355_RSVP_WIZARD_FOCUS.md` (this worktree).
- **Worktree:** `~/Desktop/mingla-orchs/orch-1355-[rsvp-wizard-focus-bug]/` on branch `orch-1355-rsvp-wizard-focus-bug`.
- **Mode:** SPEC (binding contract). Symptom 2 fix is fully specified; symptom 1 is a confirm-then-fix gate.

---

## 1. Executive summary

Two reported defects in the RSVP creator wizard:

- **Symptom 2 (guest-limit toggle snaps back ON) — PROVEN, fixed here.** Turning "Limit the guest list" OFF fires two sequential `updateDraft` calls; the container's `handleUpdate` rebuilds the debounced autosave payload from a **stale captured `liveDraft`**, so the `rsvpCapacity:null` write is dropped from what reaches the server. The server echoes the old capacity back and the toggle re-selects. Fix: make `handleUpdate` read the **fresh post-write draft** (never a captured `liveDraft`) so sequential writes compound, and collapse each user toggle/select into a **single combined patch**.
- **Symptom 1 (name field drops keyboard) — leading hypothesis REFUTED (no remount).** The true cause is at the native keyboard layer and was not reproduced at the component level. This SPEC does **not** ship a blind symptom-1 code change; it defines a **device-confirmation gate** and the single low-risk candidate to test first.

No backend, schema, migration, or RPC change. Client-only, shared RN.

---

## 2. Scope & non-goals

**In scope**
- Fix the stale-autosave root cause in `RsvpCreatorWizard.tsx` `handleUpdate` (F-1/F-3).
- Collapse the two multi-write actions in `RsvpStep5Setup.tsx` (`toggleCapacity`-OFF, visibility="private" pick) into single combined patches (F-1/F-4).
- Convert the ORCH-1355 investigation repro into a fails-on-revert regression guard asserting the FIXED behavior.

**Non-goals (explicit)**
- **Symptom 1 code change** — gated on device confirmation (§10 Open Question OQ-1). No merge without it.
- **`EventCreatorWizard.tsx`** — carries the identical latent bug (Discovery D-1) but is a separate surface; register a follow-on ORCH. Do NOT edit it here.
- Backend / `business_publish_rsvp_draft` / autosave server / `shouldApplyServerDraft` — untouched.
- The store `updateDraft` merge semantics — correct as-is (do not change).
- The `d_*`→server migration (`app/rsvp/[id]/edit.tsx`) — correct as-is.

**Assumption:** shared RN → a single code path serves business iOS / Android / web; parity is automatic.

---

## 3. Cross-Surface Impact Declaration

| # | Surface | Covered | User-visible behavior demanded | Files touched | Parity |
|---|---------|---------|--------------------------------|---------------|--------|
| 1 | Consumer iOS (`app-mobile`) | No | No RSVP creator on consumer. | — | n/a |
| 2 | Consumer Android | No | " | — | n/a |
| 3 | Buyer/anonymous Web | No | No wizard on buyer web. | — | n/a |
| 4 | **Business iOS** | **Yes** | Guest-limit toggle turns OFF and STAYS OFF; capacity persists correctly. (Symptom 1 pending OQ-1.) | `RsvpCreatorWizard.tsx`, `RsvpStep5Setup.tsx` | Automatic (shared RN) |
| 5 | **Business Android** | **Yes** | Same as iOS. | same | Automatic |
| 6 | Admin Web | No | Not applicable. | — | n/a |
| 7 | **Business Web preview** | **Yes** | Same toggle behavior; autosave persists the correct capacity. | same | Automatic |

---

## 4. Layered specification

Only the **Component/Container** layer is affected. No DB / edge / service / hook / realtime changes.

### 4.1 Container — `mingla-business/src/components/rsvp/RsvpCreatorWizard.tsx`

**Change C-1 (BINDING) — make `handleUpdate` fresh-read + stable.** Replace the body + deps of `handleUpdate` (currently lines 367-386) so it (a) uses the stable `initialDraft.id`, (b) reads the FRESH post-write draft from the store for the autosave payload, and (c) drops `liveDraft` from its dependency array. Illustrative shape (≤ contract, not verbatim code):

```
const draftId = initialDraft.id;                       // stable
...increment clientRevisionRef; markDraftDirty(draftId, rev);
updateDraft(draftId, revisionedPatch);                 // synchronous store merge
const fresh = useDraftEventStore.getState().getDraft(draftId) ?? latestDraftRef.current;
const nextDraft = fresh ? { ...fresh, updatedAt: new Date().toISOString() } : latestDraftRef.current;
latestDraftRef.current = nextDraft; queueAutosave(nextDraft);
// deps: [initialDraft.id, markDraftDirty, queueAutosave, updateDraft]   // liveDraft REMOVED
```

Requirements:
- The autosave payload MUST be built from the store's post-write state (`getState().getDraft`), NEVER from a captured `liveDraft`. This is what makes two writes in one handler compound.
- `handleUpdate` MUST NOT list `liveDraft` in its deps (it must not be re-created per keystroke).
- `clientRevisionRef` increment semantics unchanged (monotonic, +1 per write).
- The `latestDraftRef` sync effect (lines 233-239) and the `lastStepReached` effect (lines 313-343) are UNCHANGED and MUST keep working (they read `getState()`/`latestDraftRef`, not `handleUpdate`).

### 4.2 Step body — `mingla-business/src/components/rsvp/RsvpStep5Setup.tsx`

**Change C-2 (BINDING) — single combined patch for capacity toggle.** `toggleCapacity` (lines 175-179) MUST issue exactly ONE `updateDraft` call:
```
updateDraft(
  capacityOn
    ? { rsvpCapacity: null, rsvpWaitlistEnabled: false }        // OFF also clears waitlist
    : { rsvpCapacity: Math.max(draft.rsvpCapacity ?? 1, 1) },   // ON
);
```

**Change C-3 (BINDING) — single combined patch for the private-visibility pick.** The visibility pill `onPress` (lines 370-373) MUST issue exactly ONE `updateDraft` call when the value is "private":
```
updateDraft(
  opt.id === "private"
    ? { visibility: "private", rsvpDiscoverable: false }
    : { visibility: opt.id },
);
```

No copy, layout, testID, or a11y changes. All existing `testID`s (`rsvp-capacity-toggle`, `rsvp-visibility-*`, etc.) MUST be preserved (the regression suite depends on them).

### 4.3 Symptom 1 — CONDITIONAL, gated on OQ-1 (NOT part of the binding merge)

If and only if the device drive (OQ-1) confirms the keyboard drop AND identifies `keyboardDismissMode="on-drag"` (RsvpCreatorWizard.tsx:812) as the trigger, change it to `keyboardDismissMode="none"` on the wizard body `ScrollView` and re-confirm on device. Any other confirmed trigger routes back to forensics for a scoped amendment. **Do not ship a symptom-1 change on source theory alone.**

---

## 5. Success criteria

- **SC-1 (all business surfaces):** In the RSVP wizard Step 5, tapping "Limit the guest list" ON then OFF leaves the toggle OFF and `draft.rsvpCapacity === null`, and it STAYS OFF after the autosave debounce + any server echo (no snap-back).
- **SC-2:** The autosave payload delivered after a capacity ON→OFF sequence carries `rsvpCapacity === null` (the OFF write is not dropped).
- **SC-3:** Turning capacity OFF also persists `rsvpWaitlistEnabled === false` in the same single write.
- **SC-4:** Picking visibility "Private" persists `visibility==="private"` AND `rsvpDiscoverable===false` in one write; the autosave payload carries both.
- **SC-5 (regression safety):** Single-write toggles (plus-ones, waitlist, contribution, private-guest-list, hide-count, discoverable) and Step-1 name/description typing continue to autosave the correct values; `clientRevision` stays monotonic; `lastStepReached` autosave (effect 313-343) is unaffected.
- **SC-6 (symptom 1, gated):** After OQ-1 confirmation + the confirmed fix, typing in the Step-1 name field keeps the keyboard up on device (business iOS + Android). Until confirmed, symptom 1 is explicitly deferred — the tester records it as "unverified / pending device drive," not "fixed."

---

## 6. Invariants

- **Preserve** `updateDraft` immutable per-key merge (draftEventStore.ts:990-997) — do not alter.
- **Preserve** `clientRevision` monotonicity (each write +1 via `clientRevisionRef`).
- **New (DRAFT — orchestrator flips ACTIVE on CLOSE):**
  - `I-PROPOSED-1355-WIZARD-UPDATE-CALLBACK-STABLE` — the RSVP wizard's `handleUpdate` MUST build the autosave payload from the store's fresh post-write state and MUST NOT close over `liveDraft` (no `liveDraft` in its dep array). Verified by the regression suite + a strict-grep gate (§9).
  - `I-PROPOSED-1355-TOGGLE-SINGLE-PATCH` — a single user toggle/select in the RSVP setup step MUST persist via ONE combined `updateDraft` patch (no sequential dependent writes). Verified by the regression suite + strict-grep.

---

## 7. Test cases

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| T-1 (happy) | Capacity ON→OFF autosave | tap toggle twice | autosave payload `rsvpCapacity===null` && `rsvpWaitlistEnabled===false` | container+step |
| T-2 (echo) | Server echoes the OFF autosave | `upsertServerDraft(payload)` | `getDraft().rsvpCapacity===null` (NO snap-back) | store echo |
| T-3 (adversarial) | Rapid ON/OFF/ON/OFF | 4 taps | final store + autosave agree; capacity OFF; no stale value | container+step |
| T-4 (private) | Pick Private then Public | two picks | Private write persists `rsvpDiscoverable:false`; autosave carries both | step |
| T-5 (control) | Single-write toggle (plus-ones) | one tap | payload correct (regression: unchanged) | step |
| T-6 (revision) | Multi toggles | several | `clientRevision` strictly increases; `lastStepReached` autosave unaffected | container |
| T-7 (name, gated) | Type in name field on device | keystrokes | keyboard stays up (OQ-1) | native/device |

---

## 8. Implementation order

1. **C-1** — `RsvpCreatorWizard.tsx` `handleUpdate` fresh-read + stable (remove `liveDraft` dep).
2. **C-2 / C-3** — `RsvpStep5Setup.tsx` single-patch capacity toggle + private-visibility pick.
3. Convert the ORCH-1355 repro suite (`jest.orch1355.render.cjs` + the two `__tests__/*.orch1355.render.test.tsx`) into the fails-on-revert regression guard — **flip the assertions from the current bug-fingerprint values to the FIXED expectations** (T-1..T-6) within the same ORCH files.
4. Add the strict-grep gate(s) (§9).
5. `npx jest --config jest.orch1355.render.cjs --runInBand` → green; `npx tsc --noEmit` (business).
6. **OQ-1** device drive for symptom 1 (tester/Seth); apply §4.3 only if confirmed.

---

## 9. Regression prevention (fails-on-revert contract)

- **Structural safeguard:** the ORCH-1355 render suite is the runtime guard. The implementor flips the toggle test's assertions to the FIXED behavior:
  - `RsvpWizardToggleSnapback.orch1355.render.test.tsx` → assert the last autosave payload `rsvpCapacity === null` (was `=== 1`), and the echo test → assert `getDraft().rsvpCapacity === null` (no snap-back).
  - **Fails-on-revert proof required:** with C-1/C-2 reverted, the payload reverts to `rsvpCapacity === 1` and these MUST FAIL; with the fix, they PASS. The implementor records both runs in the implementation report.
- **Strict-grep gate** `orch-1355-wizard-update-callback-stable.mjs` (self-test + repo scan): FAIL if `RsvpCreatorWizard.tsx`'s `handleUpdate` dependency array contains `liveDraft`, OR if its body spreads a captured `liveDraft` into the autosave payload (`{ ...liveDraft,`). Protective comment cites ORCH-1355 F-1.
- **Strict-grep gate** `orch-1355-toggle-single-patch.mjs`: FAIL if `RsvpStep5Setup.tsx` contains a `toggleCapacity`/visibility handler that issues two `updateDraft(` calls in one handler body.
- Wire both into the mingla-business strict-grep CI job (append-only registry).

---

## 10. Open questions

- **OQ-1 (BLOCKING for symptom 1 only):** The name-field keyboard-drop was NOT reproduced at the component level (remount refuted). A sim/device drive of the authed business RSVP-create wizard is required to observe the native trigger. Candidates to test in order: (1) `keyboardDismissMode="on-drag"` on the body ScrollView; (2) per-keystroke re-render churn × `KeyboardAwareScrollView`. Symptom 2 does not depend on OQ-1 and ships independently.
- **OQ-2 (non-blocking):** Register a follow-on ORCH to apply the C-1 fix to `EventCreatorWizard.tsx` (Discovery D-1) — the same latent stale-autosave bug on any event-wizard multi-write step.

---

## 11. Downstream routing

- **Next → mingla-implementor (business side):** implement C-1/C-2/C-3 in the worktree `~/Desktop/mingla-orchs/orch-1355-[rsvp-wizard-focus-bug]/` on `orch-1355-rsvp-wizard-focus-bug`; flip the ORCH-1355 render suite to the fixed expectations + prove fails-on-revert; add the two strict-grep gates; run `jest.orch1355.render.cjs` + `tsc`. Do NOT touch symptom 1 code (OQ-1 gate) or `EventCreatorWizard.tsx`.
- **Then → mingla-tester:** adversarial verification of SC-1..SC-6 (both the store AND the autosave payload AND the echo), the fails-on-revert gate, plus the **OQ-1 device drive** for symptom 1 (business iOS + Android) — report symptom 1 as verified/unverified, never assume.
- **Then → orchestrator CLOSE:** flip the two `I-PROPOSED-1355-*` invariants ACTIVE; register OQ-2 (event-wizard follow-on) and D-2 (symptom-1 device confirmation) if still open.

### Allowlist (implementor may modify ONLY these)
- `mingla-business/src/components/rsvp/RsvpCreatorWizard.tsx`
- `mingla-business/src/components/rsvp/RsvpStep5Setup.tsx`
- `mingla-business/src/components/rsvp/__tests__/RsvpWizardToggleSnapback.orch1355.render.test.tsx`
- `mingla-business/src/components/rsvp/__tests__/RsvpWizardNameFocus.orch1355.render.test.tsx`
- `mingla-business/jest.orch1355.render.cjs`
- NEW: `.github/scripts/strict-grep/orch-1355-wizard-update-callback-stable.mjs`, `.github/scripts/strict-grep/orch-1355-toggle-single-patch.mjs`
- CI workflow file to register the two gates (append-only).
- §4.3 `keyboardDismissMode` line — ONLY after OQ-1 confirmation.

### DO-NOT-TOUCH
- `EventCreatorWizard.tsx` and all `CreatorStep2When/3Where/4Cover` shared step files.
- `draftEventStore.ts`, `serverDraftAutosaveGuards.ts`, `app/rsvp/[id]/edit.tsx`.
- `CreatorStep1Basics.tsx` / `Input.tsx` (no symptom-1 change until OQ-1).
- Any backend / migration / edge / RPC.
