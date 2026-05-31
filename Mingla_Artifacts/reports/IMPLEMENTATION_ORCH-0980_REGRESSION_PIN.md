# IMPLEMENTATION — ORCH-0980 [Silent-save-failure bug class — regression pin]

**Mode:** IMPLEMENT (regression-pin only — no behavior change).
**Implementor:** Claude `mingla-implementor`
**Date:** 2026-05-31
**Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/ORCH-0980-[silent-save-rehome]` on branch `ORCH-0980-silent-save-rehome` (base `7cc339bed`).
**Surfaces:** Business iOS + Business Android (shared `mingla-business` RN — `handleConfirmSave`/`handleSavePress` have no per-platform branch, so both inherit identically). No consumer/admin/buyer-web touch.
**Comms ledger:** read on entry. COMMS-0006 (BLOCK → ORCH-0980) is the live-fire data blocker — informational for this phase; this work is unit-test-only, no live-fire. No new cross-ORCH discovery to write.

---

## 1 — Scope executed (exactly the dispatch)

Per investigation `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0980_REHOME_CURRENT_MAIN.md` §6.3: both original silent-save bugs are already fixed-by-construction on current main. There is NO bug to fix and NO patch to port. This phase delivered ONLY the regression pin:

1. ONE new test file: `mingla-business/src/components/event/__tests__/EditPublishedScreen_silent_save_signals.test.ts` — implements T-01..T-04 (plus two defensive companions T-03b/T-04b) that LOCK the now-correct behavior: every terminal save path surfaces a visible toast or dialog — no terminal path is silent.
2. Fails-on-revert proof per test (Step 0.5 happy-path requirement) — captured below with exact reverted lines + commit hashes.
3. P2 doc-note (`refunded_partial` client vs `partial_refund` RPC string-drift): SKIPPED to avoid scope creep — the dispatch marked it optional and "skip if it risks scope creep." It touches no terminal-signal path; the investigation already records it (§2 status-string mismatch + Discoveries #2).

### Hard guards honored
- NO new helper utils (no `localSaveRejectionSignal.ts` / `publishedEventWhenRefresh.ts` / `patchKeyFilters.ts`).
- NO migrations, edge-fn, testID changes.
- NO behavior change to `EditPublishedScreen.tsx` — the file is byte-unchanged when finished (SHA-256 `8653114b0cff9d88483961d5bcafa53f7826665b17652095432425d5a7cb3e52` before and after the proof). `publishedEventEditGuards.ts` likewise byte-restored.
- The 5 AD-* sibling surfaces (marketing/hub/ExperienceCreatorWizard) NOT touched — they are ORCH-0981.

---

## 2 — The test file (Old → New receipt)

### `mingla-business/src/components/event/__tests__/EditPublishedScreen_silent_save_signals.test.ts` (NEW, 251 lines)

**What it did before:** did not exist.
**What it does now:** a regression pin with two `describe` blocks (6 tests total). Uses the established sibling seam approach (source-text needle assertions for the screen's structural terminal signals, matching `EditPublishedScreen.coverPersistence.test.tsx` + `EditPublishedScreen_when_save_gate.test.ts`; pure behavioral unit test for the client guard, matching `publishedEventEditGuards.test.ts`). No RN render tree.
**Why:** investigation §6.3 — pin the fixed-by-construction "no silent terminal save path" contract so a future refactor cannot silently re-open the class.
**Lines added:** 251.

### The 4 tests' intent (T-01..T-04, per §6.3)

| Test | Scenario | Asserts (signal locked) | Seam |
|---|---|---|---|
| **T-01** (happy) | Server-editable-only patch on a server-loaded event reaches the unified clean-termination fast-path | the fast-path is gated on `disableLocalSaveReason !== undefined && isServerEditableOnlyPatch(patch)` and terminates with `showToast("Saved. Live now.")` + `router.back()` + `return` — success is never silent | source-text slice of the ORCH-0824 unified early-return block |
| **T-02** (adversarial server fail) | When-RPC rejects (e.g. `multi_date_remove_with_sales`) | the When-block `catch` maps the code to the "This change would drop a date with active tickets…" copy and surfaces it via `showToast(message)` then `return` — server failure is never silent | source-text slice of the `patchPublishedEventWhen` block |
| **T-03** (up-front block) | A patch touching a non-server-editable field on a server-loaded event hits `handleSavePress` | the up-front guard (`disableLocalSaveReason !== undefined && !isServerEditableOnlyPatch(patch)`) fires `showToast(disableLocalSaveReason)` + `return` before the modal ever opens — the block is never silent | source-text slice of `handleSavePress` |
| **T-04** (client guard) | Single-mode date change on an event with sold tickets | `validateLiveEventFieldUpdate` returns a structured `{ok:false, reason:"multi_date_remove_with_sales", affectedOrderCount:3, droppedDates:["2026-06-10"]}` — which `handleConfirmSave` renders as a visible reject dialog (`buildRejectDialog` → `<ConfirmDialog>`), never a silent pass | pure behavioral unit test on the guard |

**Defensive companions (belt-and-braces, not in the §6.3 four but reinforcing the contract):**
- **T-03b** — the residual local `updateLiveEventFields` `{ok:false}` branch opens `setRejectDialog(buildRejectDialog(result))` (visible dialog), with `if (result.ok)` → `showToast("Saved. Live now.")` on success.
- **T-04b** — the same date change with zero sales returns `{ok:true}` (proves the guard is not over-broad — guards against a future "always reject" regression that would also pin falsely).

---

## 3 — Passing run (final, at byte-restored state)

```
PASS src/components/event/__tests__/EditPublishedScreen_silent_save_signals.test.ts (9.662 s)
  ORCH-0980 — EditPublishedScreen save paths are never silent
    ✓ T-01: clean server-editable success fast-path shows the 'Saved. Live now.' toast (no silent success)
    ✓ T-02: When-block RPC rejection shows the active-tickets toast (no silent server failure)
    ✓ T-03: up-front non-server-editable block shows the disableLocalSaveReason toast (no silent block)
    ✓ T-03b: local-store rejection opens a visible reject dialog (no silent local reject)
    ✓ T-04: single-mode date change on an event with sold tickets returns multi_date_remove_with_sales
    ✓ T-04b: the same date change with zero sales passes (guard is not over-broad)

Test Suites: 1 passed, 1 total
Tests:       6 passed, 6 total
```

Command: `npx jest EditPublishedScreen_silent_save_signals --runInBand` (from `mingla-business/`).
Typecheck: `npx tsc --noEmit` → no errors referencing the new test file (file type-clean).

---

## 4 — Fails-on-revert proof (CLOSE Step 0.5)

Baseline: test file committed at **`9f94be02e`** (`ORCH-0980-silent-save-rehome`). Each proof temporarily broke ONE signal in source, confirmed the matching test FAILED, then `git checkout --` restored the source to byte-identical (SHA verified). The screen file SHA-256 was `8653114b0cff9d88483961d5bcafa53f7826665b17652095432425d5a7cb3e52` before the first revert and identical after every restore.

| Test | Reverted line (in source, temporary) | Result | Restore verified |
|---|---|---|---|
| **T-01** | `EditPublishedScreen.tsx` unified fast-path: removed `showToast("Saved. Live now.");` | FAIL at test L84 `expect(fastPath).toContain('showToast("Saved. Live now.");')` | screen SHA back to `8653114b…` |
| **T-02** | `EditPublishedScreen.tsx` When-block catch: removed `showToast(message);` | FAIL at test L107 `expect(whenCatch).toContain("showToast(message);")` | screen SHA back to `8653114b…` |
| **T-03** | `EditPublishedScreen.tsx` `handleSavePress` up-front block: removed `showToast(disableLocalSaveReason);` | FAIL at test L126 `expect(handleSavePress).toContain("showToast(disableLocalSaveReason);")` | screen SHA back to `8653114b…` |
| **T-04** | `publishedEventEditGuards.ts` L55: changed `if (droppedDates.length > 0 && soldCountForEvent > 0)` → `if (false && …)` (disables the sold-date rejection) | FAIL at test L229 `expect(result.ok).toBe(false)` — guard returned `ok:true` | guard byte-restored |

Each FAIL was run scoped (`-t "T-01"` / `"T-02"` / `"T-03:"` / `"T-04:"`), confirming the OTHER tests stay skipped, not co-failing. All four are genuinely fails-on-revert: each pins a distinct terminal-signal mechanism and breaks when that mechanism is removed.

After all four restores, the full-file run is 6/6 green (§3) and `git status --short` shows no source diffs (only the committed test file + this report).

---

## 5 — Cross-surface impact (Step 3.5)

| Surface | Affected? | Why |
|---|---|---|
| Consumer iOS | No | consumer app has no published-event-edit flow |
| Consumer Android | No | same |
| Buyer/anon Web | No | buyer-anon routes don't render the business edit screen |
| Business iOS | Yes (test-only) | pins the shared `EditPublishedScreen` save contract; no runtime change |
| Business Android | Yes (test-only) | same shared code path; parity automatic |
| Admin Web | No | admin doesn't render this screen |
| Business Web preview | No | edit screen is native-only |

Parity is automatic (single shared `mingla-business` RN code path; the test reads that one file). No manual-parity drift to register.

---

## 6 — Completion gate

| Clause | Status |
|---|---|
| 1. Scope (regression pin per §6.3) implemented + demonstrated | PASS — 6/6 tests, §3 |
| 2. Tests green AND fails-on-revert verified at cited hashes | PASS — §4 (baseline `9f94be02e`; per-test reverts proven) |
| 3. `tsc --noEmit` clean on the touched file | PASS — §3 (no errors referencing the new file) |
| 4. Constitution: #3 No silent failures — the whole point of the pin; SATISFIED on this screen and now locked. Others N/A (no behavior change) | PASS / N/A |
| 5. Edge-function deploy | N/A — no edge functions touched |

No migrations, no edge functions, no deploy. Nothing for the operator to `db push` or `functions deploy`.

---

## 7 — Regression Test section (mandatory gate)

- **Test path:** `mingla-business/src/components/event/__tests__/EditPublishedScreen_silent_save_signals.test.ts`
- **Passing run:** §3 (6/6).
- **Fails-on-revert verified:** §4 — at test-baseline commit `9f94be02e`, each of T-01..T-04 fails when its corresponding source signal is removed; source byte-restored after each (screen SHA `8653114b…`).
- **Shipped in the same branch as the pin:** yes — the test file is the deliverable; it is committed on `ORCH-0980-silent-save-rehome`.

---

## 8 — Discoveries for orchestrator

1. **P2 string-drift (carried from investigation, NOT fixed here):** client order-store status set (`refunded_partial`) vs RPC (`partial_refund`) are equivalent today but undocumented. Non-silent (server catch covers it). Left as the investigation's Discovery #2 — optional tighten, no current ORCH owns it.
2. **5 AD-* siblings persist** (marketing compose / campaigns / templates / hub draft-delete / ExperienceCreatorWizard) → ORCH-0981, REPORT-ONLY, untouched here.
3. **COMMS-0006 still OPEN** — the clean-success date-change live-fire remains data-blocked; this regression pin does not require it (source disproof + the pin cover the silent-failure class). If the orchestrator wants the live-fire leg promoted from `probable` to `proven`, §7 of the investigation lists the three unblock options.
4. ORCH-0980 can likely CLOSE as "fixed-by-construction + regression-pinned" per investigation Discovery #1.
