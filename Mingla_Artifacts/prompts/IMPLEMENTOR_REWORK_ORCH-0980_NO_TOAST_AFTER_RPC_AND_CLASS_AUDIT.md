# REWORK DISPATCH — ORCH-0980 [Silent-save-failure bug class] — no-toast-after-modal-confirm + class-of-bug audit

**Dispatched:** 2026-05-26 by Claude `mingla-orchestrator` after operator retest FAIL
**Target skill:** Codex `implementor-mingla` (same session as prior ORCH-0980 fix)
**Trigger:** operator retested the date-save fix on iPhone after EAS Update group `6705fa4b-f322-4fab-856d-63918f7a8534` published. Result: reason modal appears + operator types valid reason + confirms → **NO toast appears at all** (neither success nor error) → operator lands back on Edit screen with stale data shown. Different symptom than the H3 bug we just fixed. Operator confirmed force-quit + reopen happened.
**Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/ORCH-0980-[silent-save-failure-bug-class]/`
**Branch:** `ORCH-0980-silent-save-failure-bug-class` (HEAD `5f2b062c0` — REVIEW APPROVED that just landed)

---

## 1. Critical context — prior fix was correct but incomplete

Your H3 fix (canonical refresh + cache write + draft reseed at `EditPublishedScreen.tsx:805-811`) is mechanically correct AND verified by Step 0.5 fails-on-revert. Don't undo it. The reason operator still sees the bug is a **separate downstream issue in the fall-through path AFTER your fix completes successfully**.

## 2. The new bug — traced

Reading `EditPublishedScreen.tsx` save chain after operator confirms the reason modal:

1. **Lines 803-809 — When-RPC + your refresh helper** — succeeds, draft reseeded.
2. **Line 810 — `invalidateServerEventCaches()`** — fires.
3. **Lines 812-840 — try/catch** — neither success nor error toast fires HERE. Catch block fires error toast only on RPC failure.
4. **Lines 849-867 — `if (disableLocalSaveReason !== undefined && isServerEditableOnlyPatch(patch))` block** — fires success toast `"Saved. Live now."` + navigates back. **BUT this block is gated by `disableLocalSaveReason !== undefined`** which is set ONLY when `liveEvent === null` at the route layer (server-loaded events without local Zustand counterpart). Most published events HAVE a local Zustand row → `disableLocalSaveReason` is `undefined` → **THIS BLOCK DOESN'T FIRE FOR THE OPERATOR'S TEST EVENT**.
5. **Lines 870-891 — fall-through to local Zustand mutation `updateLiveEventFields(liveEvent.id, patch, ...)`**:
   - If `result.ok` → success toast + navigate (line 879)
   - **Else → `setRejectDialog(buildRejectDialog(result))` at line 891 — NO TOAST**

**The silent-no-toast outcome is line 891 firing.** `updateLiveEventFields` rejects, the code opens a reject dialog, and the dialog is either invisible / off-screen / blank-content / not rendered at all. Operator sees: modal closes (line 813 setModal visible:false fires somewhere), reason text gone, no toast, lands on Edit screen.

### Why might `updateLiveEventFields` reject on a date change that the server just accepted?

Three suspects to verify in order:

**S1 (most likely):** Local Zustand `updateLiveEventFields` has its own buyer-protection that rejects date change when active tickets exist, while the server-side `business_patch_event_when` RPC has more permissive rules (per docstring at `businessEvents.ts:818`: "Time-only edits always succeed regardless of sold count; server rejects whenMode/recurrence/multi-date structural changes when sold>0"). Date isn't time-only, so server allows it on sold>0 sold events, but local Zustand store applies stricter rule and rejects. Result: server-DB has new date, local Zustand keeps old date, reject dialog opens silently.

**S2:** After your refresh helper's `setEditState(liveEventToEditableDraft(refreshedDetail.event))` at line 809, the LOCAL EDIT STATE is now the canonical server state. But the `patch` variable on line 872 was computed BEFORE the refresh — it carries the OLD diff against pre-refresh local state. When `updateLiveEventFields` applies that patch against the now-already-refreshed Zustand row, it sees no actual delta on `date` (it's already up to date because cache write at line 810 + setEditState at line 809 propagated to whatever drives the Zustand store) and returns `{ ok: false, reason: "no_change_detected" }` or similar.

**S3:** Some other local-validation rule in `updateLiveEventFields` is rejecting (e.g., timezone consistency, multi-date logic if the event was migrated, etc.).

## 3. Required deliverable for THIS rework

### Fix 1 — make the save handler fire EXACTLY ONE toast/dialog on every code path

The current handler can land in line 891 (reject dialog) without ANY toast. That's a contract violation: every save attempt MUST surface a signal to the user. Choose the right fix based on the actual cause:

- **If S1 (Zustand stricter than server):** the local rule is wrong — server-side `business_patch_event_when` is the canonical authority. Local Zustand should ACCEPT what server accepted. Either remove the Zustand rejection for date changes (treat server-success as final authority), OR keep the rejection but ALSO fire a toast + open the reject dialog (so user gets a signal).
- **If S2 (patch-vs-refreshed-state mismatch):** the post-refresh patch is now stale. Skip `updateLiveEventFields` entirely if your refresh helper already wrote canonical state to cache + reseeded local state. Either short-circuit after refresh-success on the When-RPC path, OR rebuild the patch against the refreshed state before calling `updateLiveEventFields`. Prefer short-circuit.
- **If S3 (other validation):** identify the specific rule + decide whether to relax it or fire a toast/dialog.

**In all cases:** the reject-dialog path at line 891 MUST also fire a toast (`showToast("Couldn't save locally — your changes are on the server but the app couldn't reflect them. Reopen the event.")` or similar) so the user has a visible signal even if the dialog itself doesn't render. The reject dialog should NEVER be the ONLY signal.

### Fix 2 — class-of-bug audit (REPORT-ONLY, do NOT fix all in same PR)

Operator explicitly asked for the audit. The class is: **"Save handler completes without surfacing EXACTLY ONE visible signal (success toast OR error toast OR visible dialog) on every code path."**

Audit every save handler in `mingla-business/src/components/` + `mingla-business/app/` — for each, walk every code path from `onSave` / `handleSave` / `onConfirm` to terminal `return`. Flag any path that doesn't terminate with a `showToast()` call OR a visible dialog mount OR an explicit `router` navigation. Specific surfaces to audit:

- `EditPublishedScreen.tsx` — the offending file. Audit ALL fall-through paths (we know line 891 is broken; check the other early-return paths at lines 596, 611, 649, 676, 717, 761, 856, 877).
- `BrandEditView.tsx` — the F-A surface (already fixed for one specific bug; verify NO silent paths).
- Any other Edit* screen — published trip edit, ticket types edit, marketing composer, etc.
- Any sheet/modal with a "save" or "send" or "submit" button — TicketCartSheet, MarketingComposer, etc.

**Report format:** for each audited file, list every save code path + whether it fires a toast/dialog/nav at the terminal. Flag silent paths as P1. Do NOT fix the silent paths in this PR — that's a separate ORCH or follow-up SPEC. Just enumerate them with file:line.

### Fix 3 — Step 0.5 regression (extend existing file)

Append to `mingla-business/src/components/event/__tests__/EditPublishedScreen_event_date_round_trip.test.ts`:
- A new `it()` block that simulates `updateLiveEventFields` returning `{ok: false}` AND asserts a toast fires (NOT just a reject-dialog mount). This is the missing contract.
- Capture `fails-on-revert verified at <commit>` proof: revert your Fix 1 → test fails → restore → test passes.

## 4. Hard guards — DO NOT (cumulative with original ORCH-0980 dispatch)

- DO NOT undo the H3 fix you just shipped. Canonical refresh + cache write + draft reseed stay.
- DO NOT touch ORCH-0964 guarded files (`packages/brand-rendering/`, `packages/event-rendering/`, `packages/theme-animations/`, `mingla-business/src/components/theme/`, `mingla-business/src/components/brand/PublicBrandPage.tsx`).
- DO NOT add a new database migration.
- DO NOT redeploy META-ORCH-0972 Sub-D edge functions.
- DO NOT fix all class-of-bug audit findings in this PR — audit reporting-only.
- DO NOT change `testID` strings.
- DO NOT weaken or modify existing tests.

## 5. Verification before pushing

1. **Reproduce on iOS sim first** using your environment from prior ORCH-0980 work (sim UDID `F7ECAC25-2A98-4002-AD17-85AED17AB752`, Metro port 8093). The address-validation block you hit before can be sidestepped by using an ONLINE event or an event with a previously-Google-validated address. If sim repro is impossible, document why + rely on source proof + Step 0.5.
2. **After fix:** confirm modal confirm → success toast `"Saved. Live now."` fires → navigate back works → reopen Edit event → date shows new value.
3. **Step 0.5:** new test PASSES + fails-on-revert proof captured with exact commit hashes.
4. **Audit report** committed to `IMPLEMENTATION_ORCH-0980_EVENT_DATE_SAVE_AND_PATCH_KEY_AUDIT.md` as appended "Rework Audit" section.

## 6. Expected output

- 2-3 scoped commits on `ORCH-0980-silent-save-failure-bug-class` branch (one for the fall-through fix, one for the regression test, one for the appended audit section + report update).
- Push.
- Updated implementation report appending:
  - Which suspect (S1/S2/S3) was the real cause + how proven.
  - The diff + 1-sentence rationale per file.
  - Class-of-bug audit results.
  - New regression test path + `fails-on-revert verified at <commit hash>` phrase.

## 7. Downstream routing

After Codex pushes + reports:
1. Claude `mingla-orchestrator` re-REVIEWS.
2. Orchestrator publishes a FRESH business-app EAS Update.
3. Operator force-quits + reopens iPhone business app.
4. Operator retests date-save round-trip with a clean test event (online or pre-validated address).
5. If PASS → operator returns to ORCH-0964 smoke-test (unblocked) → orchestrator CLOSE on ORCH-0964 → then CLOSE on ORCH-0980.
6. If still broken → next dispatch with even narrower repro.

## 8. Comms ledger

Read `/Users/sethogieva/Desktop/mingla-main/COMMS_LEDGER.md` on entry. Acknowledge any rows where `to` matches ORCH-0980 or ALL.
