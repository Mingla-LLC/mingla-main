# IMPLEMENTATION — ORCH-1355 [RSVP create wizard toggle-snap-back] FIX

- **Worktree:** `~/Desktop/mingla-orchs/orch-1355-[rsvp-wizard-focus-bug]/` on branch `orch-1355-rsvp-wizard-focus-bug`.
- **Spec:** `Mingla_Artifacts/specs/SPEC_ORCH-1355_RSVP_WIZARD_FOCUS_FIX.md` (binding).
- **Investigation:** `Mingla_Artifacts/investigations/INVESTIGATION_ORCH-1355_RSVP_WIZARD_FOCUS.md`.
- **Scope shipped:** Symptom 2 only (guest-limit toggle snap-back) + its root cause. Symptom 1 (name-field keyboard drop) NOT touched — OQ-1 device gate, out of scope.
- **Status:** implemented and verified (client-only, shared RN; runtime RTL repro green + fails-on-revert proven both vectors + both strict-grep gates self-tested & live-green + product-file tsc clean).

---

## 1. Summary (plain English)

In the business RSVP creator, Step 5 "Limit the guest list" could not be turned off — it snapped back ON a moment later. Root cause: turning it off fired two separate saves, and the wizard's auto-save built its payload from a stale snapshot, so the "off" value was dropped before it reached the server; the server then echoed the old value back and re-selected the toggle. Fix: the wizard's update handler now reads the store's fresh post-write state for the auto-save payload (so two writes in one action compound instead of clobbering), and the Step-5 capacity toggle + the "Private" visibility pick each now save as ONE combined write. The name-field focus issue (symptom 1) was deliberately left alone.

---

## 2. SPEC success-criteria coverage

| SC | Criterion | How verified | Status |
|----|-----------|--------------|--------|
| SC-1 | Capacity ON→OFF stays OFF (`rsvpCapacity===null`), no snap-back after echo | RTL test "turning capacity OFF autosaves rsvpCapacity=null…" + echo test (real `upsertServerDraft`/`shouldApplyServerDraft`) | ✓ PASS |
| SC-2 | Autosave payload after ON→OFF carries `rsvpCapacity===null` (OFF write not dropped) | RTL test asserts `lastAutosave.rsvpCapacity === null` + C-1 isolation test | ✓ PASS |
| SC-3 | Capacity OFF also persists `rsvpWaitlistEnabled===false` in the SAME write | RTL test asserts `lastAutosave.rsvpWaitlistEnabled === false` (C-2) | ✓ PASS |
| SC-4 | "Private" persists `visibility==="private"` AND `rsvpDiscoverable===false` in one write; autosave carries both | RTL test "picking Private persists…" (store + autosave payload) (C-3) | ✓ PASS |
| SC-5 | Single-write toggles + name/desc typing still autosave correctly; `clientRevision` monotonic; `lastStepReached` effect unaffected | CONTROL plus-ones test + clientRevision-monotonic test; `lastStepReached` effect (lines 313-343) reads `getState()`/`latestDraftRef` — UNCHANGED | ✓ PASS |
| SC-6 | Symptom 1 (name keyboard) — gated on OQ-1 device drive | NOT touched (deferred); NameFocus no-remount guard unchanged | ✓ (deferred as specified) |

All satisfied at working-tree state on base commit `ac217d21e` (to be committed on this branch).

---

## 3. Files changed

| File | Δ | Change |
|------|---|--------|
| `mingla-business/src/components/rsvp/RsvpCreatorWizard.tsx` | ~+18/−6 | C-1: `handleUpdate` fresh-read + stable (drop `liveDraft` dep) |
| `mingla-business/src/components/rsvp/RsvpStep5Setup.tsx` | ~+22/−5 | C-2 + C-3: single combined patches |
| `mingla-business/src/components/rsvp/__tests__/RsvpWizardToggleSnapback.orch1355.render.test.tsx` | ~+167/−58 | flip 2 assertions to FIXED; mirror C-1 into harness; add C-1-isolation / Private / revision guards `[TEST-MOD-APPROVED ORCH-1355]` |
| `.github/scripts/strict-grep/orch-1355-wizard-update-callback-stable.mjs` | NEW 245 | I-PROPOSED-1355-WIZARD-UPDATE-CALLBACK-STABLE gate |
| `.github/scripts/strict-grep/orch-1355-toggle-single-patch.mjs` | NEW 256 | I-PROPOSED-1355-TOGGLE-SINGLE-PATCH gate |
| `.github/workflows/strict-grep-mingla-business.yml` | +26 | register both gates (self-test + live) |
| `.github/scripts/strict-grep/README.md` | +2 | registry rows for both gates |

DO-NOT-TOUCH honored: `EventCreatorWizard.tsx`, `CreatorStep1Basics.tsx`, `Input.tsx`, `draftEventStore.ts`, `serverDraftAutosaveGuards.ts`, `app/rsvp/[id]/edit.tsx`, all backend — untouched. Symptom-1 `keyboardDismissMode` line (RsvpCreatorWizard.tsx:812) untouched (OQ-1 gate).

---

## 4. Data-model / edge functions

None. Client-only. No migration, no edge function, no RPC, no schema change. No `db push`, no deploy required.

---

## 5. Regression tests + fails-on-revert

**Runtime suite (worktree-local, RN preset + RTL overlay):** `npx jest --config jest.orch1355.render.cjs --runInBand` → **2 suites, 7 tests PASS** (6 in the flipped toggle-snapback file, 1 unchanged NameFocus guard).

Tests in `RsvpWizardToggleSnapback.orch1355.render.test.tsx` (real `RsvpStep5Setup` + real `draftEventStore` + a mirror of the FIXED `handleUpdate`):
1. capacity ON→OFF autosaves `rsvpCapacity=null` + `rsvpWaitlistEnabled=false` (T-1/T-3).
2. OFF autosave echoed by server does NOT snap back (T-2, real `upsertServerDraft`).
3. **C-1 isolation** — `handleUpdate` compounds two sequential dependent raw writes into the payload (dedicated handleUpdate fresh-read guard).
4. Private pick persists `visibility=private` + `rsvpDiscoverable=false` in one write (T-4).
5. CONTROL — single-write plus-ones autosaves correctly (T-5).
6. `clientRevision` strictly monotonic across writes (T-6 / SC-5).

**Fails-on-revert — TWO vectors, true line deletion (not comment-out):**

- **Vector A (orchestrator's asked vector — handleUpdate fresh-read):** deleting the fresh-read lines in the harness `handleUpdate` (revert to `{ ...liveDraft, ...revisionedPatch }`) → the **C-1 isolation test FAILS** (`Received: 5`, the stale capacity), while the real-toggle test still passes because C-2's single-patch compensates (defense-in-depth). Restored → PASS.
- **Vector B (SPEC §9 — C-1 + C-2 both reverted):** restoring the ORIGINAL unstable `handleUpdate` (`liveDraft` in deps + `{ ...liveDraft, ...patch }`) AND reverting `RsvpStep5Setup.toggleCapacity` to the two-write form → **3 tests FAIL**: real OFF-autosave (`Received: 1`), echo snap-back (`Received: 1`), C-1 isolation (`Received: 5`) — the full end-to-end ORCH-1355 bug reproduced. Restored → 7/7 PASS.

`fails-on-revert verified at base commit ac217d21e` (working tree; will carry into the branch commit).

**Strict-grep gate self-tests (product-source fails-on-revert, CI-enforced):**
- `orch-1355-wizard-update-callback-stable.mjs --self-test` → **PASS 4/4** (fixed shape passes; `liveDraft`-in-deps, spread-`liveDraft`, no-fresh-read each fail). Live scan of `RsvpCreatorWizard.tsx` → PASS.
- `orch-1355-toggle-single-patch.mjs --self-test` → **PASS 3/3** (single-patch passes; capacity two-write + visibility two-write each fail). Live scan of `RsvpStep5Setup.tsx` → PASS.

**Sibling regression (no-break) — under default `jest.config.cjs`:** `RsvpStep5Setup.chipInBanner.test.ts`, `RsvpStep5Setup.chipInWiring.tester.test.ts`, `orch_1339_trip_guest_privacy.test.ts` (CI-run by META-ORCH-1337), `rsvpEvents.orch1150.test.ts` → **4 suites, 28 tests PASS**. `jest.orch1335.render.cjs` (mounts real `RsvpStep5Setup`) → **3 PASS**.

**tsc:** `npx tsc --noEmit` — the two PRODUCT files (`RsvpCreatorWizard.tsx`, `RsvpStep5Setup.tsx`) have **zero errors**. The flipped test file's only remaining error is `TS2307 Cannot find module '@testing-library/react-native'` — the shared baseline across all 17 render tests (RTL lives in the gitignored `.orch1118-testdeps` overlay tsc cannot resolve); not a regression. Project baseline is ~790 pre-existing errors (package `react` resolution + overlay), none introduced by this change.

---

## 6. Old → New receipts

### RsvpCreatorWizard.tsx — `handleUpdate` (C-1)
- **Before:** `useCallback` deps `[liveDraft, …]`; built `nextDraft = { ...liveDraft, ...revisionedPatch, updatedAt }` from the CAPTURED `liveDraft`. Two writes in one handler both closed over the same stale draft → the second dropped the first field from the debounced autosave payload.
- **After:** stable deps `[draftId, markDraftDirty, queueAutosave, updateDraft]` (using `const draftId = initialDraft.id`); after the synchronous `updateDraft`, reads `useDraftEventStore.getState().getDraft(draftId) ?? latestDraftRef.current` and builds `nextDraft = { ...fresh, updatedAt }`. Sequential writes compound; `latestDraftRef` still tracked for publish. `clientRevisionRef` +1-per-write unchanged.
- **Why:** SC-1/SC-2/SC-3/SC-4 + I-PROPOSED-1355-WIZARD-UPDATE-CALLBACK-STABLE.
- **Lines:** ~24 changed.

### RsvpStep5Setup.tsx — `toggleCapacity` (C-2) + visibility pick (C-3)
- **Before (C-2):** `updateDraft({ rsvpCapacity: … })` THEN `if (capacityOn) updateDraft({ rsvpWaitlistEnabled: false })` — two writes. **Before (C-3):** `updateDraft({ visibility: opt.id })` THEN `if (opt.id === "private") updateDraft({ rsvpDiscoverable: false })` — two writes.
- **After (C-2):** ONE `updateDraft(capacityOn ? { rsvpCapacity: null, rsvpWaitlistEnabled: false } : { rsvpCapacity: Math.max(draft.rsvpCapacity ?? 1, 1) })`. **After (C-3):** ONE `updateDraft(opt.id === "private" ? { visibility: opt.id, rsvpDiscoverable: false } : { visibility: opt.id })`.
- **Why:** SC-3/SC-4 + I-PROPOSED-1355-TOGGLE-SINGLE-PATCH. All `testID`s, copy, layout, a11y preserved.
- **Lines:** ~30 changed.

---

## 7. Cross-surface impact

| Surface | Affected | Note |
|---------|----------|------|
| Consumer iOS | No | No RSVP creator on consumer. |
| Consumer Android | No | " |
| Buyer/anonymous Web | No | No wizard on buyer web. |
| **Business iOS** | **Yes** | Guest-limit toggle turns OFF and stays OFF; capacity/waitlist/visibility persist. Parity automatic (shared RN). |
| **Business Android** | **Yes** | Same. Parity automatic. |
| Admin Web | No | N/A. |
| **Business Web preview** | **Yes** | Same toggle behavior; autosave persists correct capacity. Parity automatic. |

---

## 8. Smoke result

Runtime proof is the RTL render suite (deterministic, mounts the real `RsvpStep5Setup` + real `draftEventStore` + the real echo path). No sim/device drive run this phase — the wizard sits behind business auth; the SPEC designates the RTL repro as PRIMARY proof for symptom 2, and the OQ-1 device drive (symptom 1) belongs to the tester.

---

## 9. Known issues / deferred

- **Symptom 1 (name-field keyboard drop):** deliberately NOT touched. Gated on OQ-1 device confirmation. `keyboardDismissMode="on-drag"` (RsvpCreatorWizard.tsx:812) left as-is; `CreatorStep1Basics.tsx`/`Input.tsx` untouched. The NameFocus no-remount guard remains green (`inputMounts=1`) as a regression guard. Tester records symptom 1 as "unverified / pending device drive."
- No `[TRANSITIONAL]` code introduced.

---

## 10. Operator action required

- **None for deploy.** Client-only; no migration, no edge function, no `db push`, no OTA.
- Route back to orchestrator for REVIEW → tester dispatch (adversarial SC-1..SC-6 + OQ-1 device drive for symptom 1). On CLOSE: flip `I-PROPOSED-1355-WIZARD-UPDATE-CALLBACK-STABLE` + `I-PROPOSED-1355-TOGGLE-SINGLE-PATCH` ACTIVE.

---

## 11. Discoveries for Orchestrator

- **D-1 / OQ-2 (portability of the C-1 fix to `EventCreatorWizard`):** `EventCreatorWizard.tsx` carries the byte-identical unstable `handleUpdate` (captured `liveDraft` + `liveDraft` in deps). The C-1 fix pattern here — `const draftId = initialDraft.id` + `getState().getDraft(draftId)` fresh-read + drop `liveDraft` from deps — is **directly portable** to it (same store, same `getDraft`, same `latestDraftRef`/`clientRevisionRef` shape). It was NOT applied here (out of scope per SPEC §2 / DO-NOT-TOUCH). Recommend a follow-on ORCH to apply the identical fix to the event wizard (any event-wizard step issuing >1 `updateDraft` per action has the same latent stale-autosave drop). The `orch-1355-wizard-update-callback-stable.mjs` gate is trivially extendable to also scan `EventCreatorWizard.tsx` when that ORCH lands.
- **D-2 (symptom 1):** unconfirmed at root cause; needs the sim/device drive (candidates: `keyboardDismissMode="on-drag"` × KAS auto-scroll; per-keystroke re-render churn). The C-1 stability fix reduces per-keystroke churn (handleUpdate is now stable), which MAY incidentally help symptom 1 — but this is unproven and must be confirmed on device, not assumed.
- **CI note:** the ORCH-1355 render suite (like the orch1335/orch1143/orch1147r2/orch1152 render suites) is a worktree-local runtime guard resolved via the gitignored `.orch1118-testdeps` overlay; CI runs jest only for explicitly-named per-ORCH paths and never the default full suite, so it does not execute these render tests. The CI-enforced ORCH-1355 guards are the two registered strict-grep gates.
