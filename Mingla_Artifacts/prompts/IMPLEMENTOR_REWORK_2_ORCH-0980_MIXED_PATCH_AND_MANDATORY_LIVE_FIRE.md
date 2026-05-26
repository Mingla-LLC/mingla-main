# REWORK #2 DISPATCH — ORCH-0980 [Silent-save-failure bug class] — MIXED-PATCH no-persist + MANDATORY live-fire end-to-end

**Dispatched:** 2026-05-26 by Claude `mingla-orchestrator` after THIRD operator retest FAIL
**Target skill:** Codex `implementor-mingla` (same session)
**Trigger severity:** S0-critical for this dispatch — this is the third failed retest cycle on the same bug. Operator is blocked from final smoke-test on ORCH-0964. Codex shipped TWO prior "fixes" that passed unit tests but failed on actual device because **Codex did not complete live-fire end-to-end on the sim either time** and Step 0.5 unit tests alone do NOT prove the persistence contract.

**This dispatch removes that escape valve. No PASS verdict without live-fire end-to-end completion + DB-level proof.**

**Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/ORCH-0980-[silent-save-failure-bug-class]/`
**Branch:** `ORCH-0980-silent-save-failure-bug-class` (HEAD `f40b95412`)

---

## 1. What you shipped twice and why it still fails

**Rework #1 (commit `0bca51f33`):** added `refreshPublishedEventWhenAfterSave` helper. Verified by Step 0.5 unit test. Operator retest: success toast fires but date doesn't persist on re-open. FAIL.

**Rework #2 (commit `25683db1c`):** server-editable-only fast-path terminates clean post-RPC with `"Saved. Live now."` toast; local-reject path got toast-before-dialog. Verified by Step 0.5 unit test extension. Operator retest: still does not work. FAIL.

**Both reworks SKIPPED live-fire end-to-end on the sim** and punted that to "operator/EAS retest is the required end-to-end gate." That punt is now banned for this dispatch.

## 2. The bug your two fixes didn't catch — the MIXED-PATCH scenario

**Operator's actual repro that broke your fixes:** edit the published event "vibes and stuff" → change date to **26 May 2026 15:45**, change end to **next day 15:45** (so it becomes a 24-hour event with midnight-cross), AND change venue location to **700 Corporate Center Dr, Raleigh 27607**. Tap Save. Confirm reason modal. Result: no signal OR success toast that lies — date + location don't persist.

**The bug shape:** Codex's "server-editable-only fast-path termination" at `EditPublishedScreen.tsx` only fires when `isServerEditableOnlyPatch(patch) === true`. That predicate returns TRUE only when EVERY key in the patch is in `SERVER_EDITABLE_PATCH_KEYS` (= COVER_MEDIA + ORCH_0824 + ORCH_0877_WHEN + ORCH_0964_THEME).

**Operator's patch includes BOTH date (When-section, server-editable) AND venue/address (Where-section, NOT in any server-editable Set).** So:
- `isServerEditableOnlyPatch(patch)` returns FALSE.
- Server-editable-only fast-path is SKIPPED.
- Execution still falls through to `updateLiveEventFields(liveEvent.id, full-patch, ...)` at `EditPublishedScreen.tsx:870`.
- The full patch still contains `date` — which has ALREADY been written by the RPC + reseeded into local state via your refresh helper. The local Zustand path either rejects (silent dialog) OR partially-applies + reports `{ok: false}` for some other reason.

**This is a class-of-mixed-patch bug. Your prior fix only handles PURE When patches. You need to handle MIXED.**

## 3. Required deliverable — non-negotiable

### Fix A — split the patch at the boundary

After the When-RPC succeeds + canonical refresh + state reseed (existing code), STRIP the When-section keys from the patch BEFORE passing it to `updateLiveEventFields`. That way:
- Server-owned fields (When/Theme/Cover/Taxonomy) are committed via RPC + cache write — done.
- Local-owned fields (Where/Tickets/Settings/Basics) flow through `updateLiveEventFields` with ONLY those keys — clean.
- The two paths don't fight over the same field.

Concretely: build a `nonServerPatch` by filtering `patch` to remove keys in `ORCH_0877_WHEN_PATCH_KEYS` (and any other server-side keys that have already been written via RPC). Pass `nonServerPatch` to `updateLiveEventFields`. If `Object.keys(nonServerPatch).length === 0` after stripping, that means the patch was server-only after all → terminate with success toast + navigate (same as the current server-editable-only fast-path).

**Apply the same pattern for Cover-media and ORCH-0824 taxonomy RPC blocks above** — anywhere a server RPC has already committed a field, strip that field from the patch before the local Zustand step.

### Fix B — guarantee exactly one signal on EVERY code path (no exceptions)

Walk every terminal `return` in `handleConfirmSave` (the modal confirm handler). For each, confirm:
- A `showToast(...)` fired, OR
- A `setRejectDialog(...)` fired AND a `showToast(...)` fired first (per your prior fix), OR
- An explicit navigation (`router.back()` / `router.replace()`) fired.

ANY return without one of those three is a P0 — fix it before push.

### Fix C — DB-level persistence probe in the test suite

Step 0.5 unit tests are necessary but NOT sufficient — they passed twice while the bug was live. Add a **DB-level integration check** to the Step 0.5 regression. Either:
- Mock `supabase.from('events').update(...)` AND `event_dates` writes AND verify the mock was called with the correct payload after the modal confirm completes, OR
- Use the existing test scaffolding to assert that after `handleConfirmSave` runs to completion, the next `fetchBusinessEventById(eventId)` call returns the updated event (proves the cache + DB path round-tripped).

Don't ship a "passing test" that doesn't prove DB persistence.

### Fix D — MANDATORY live-fire end-to-end on iOS sim BEFORE you push

**This is non-negotiable for this dispatch.** No source-proof punt. No "operator/EAS retest is the required end-to-end gate" deferral.

**The exact reproducer to run on your iOS sim:**
1. Boot sim `F7ECAC25-2A98-4002-AD17-85AED17AB752`. Start Metro on port 8093 from the ORCH-0980 worktree.
2. Open Mingla Business. Sign in as Seth's test account.
3. Find an event titled like "vibes and stuff" (operator's specific test event) OR pick any published event with a venue address already validated.
4. Tap Edit Event.
5. Change date to **26 May 2026**. Doors open **15:45**. Ends **15:45** (next-day cross — should show "24h event" badge).
6. Change the Where venue/address to **"700 Corporate Center Dr, Raleigh 27607"**. Pick from Google Places suggestions to satisfy address-validation gate.
7. Tap Save changes.
8. Reason modal appears. Type at least 10 characters. Confirm.
9. **MUST OBSERVE:** success toast fires (or clear error toast if validation rejects). Screen navigates back to event detail.
10. **MUST OBSERVE:** re-open the event Edit screen. Date shows 26 May 2026 / 15:45 / 15:45-next-day. Address shows 700 Corporate Center Dr.
11. **MUST RUN a DB probe immediately after step 9** confirming `event_dates` row for that event has the new date + `events.location_text` (or equivalent) contains "700 Corporate Center Dr".

**Capture:** screenshot of step 9 toast, screenshot of step 10 persisted values, DB probe output. All three go in the implementation report's "Live-Fire End-to-End Proof" section.

**If you cannot complete the live-fire end-to-end for any reason — DO NOT push the fix. ASK the operator to unblock you specifically. Do not declare PASS based on source proof + Step 0.5 unit tests alone.** Both prior reworks did exactly that and shipped broken code.

## 4. Hard guards (cumulative, unchanged)

- DO NOT undo prior fixes — H3 refresh + server-editable-only fast-path termination + toast-before-dialog all stay.
- DO NOT touch ORCH-0964 guarded files (`packages/brand-rendering/`, `packages/event-rendering/`, `packages/theme-animations/`, `mingla-business/src/components/theme/`, `mingla-business/src/components/brand/PublicBrandPage.tsx`).
- DO NOT add a new migration.
- DO NOT redeploy META-ORCH-0972 Sub-D edge functions.
- DO NOT fix the 5 P1 audit findings from prior REVIEW (`marketing/campaigns/compose.tsx`, `marketing/campaigns/index.tsx`, `marketing/templates/[id].tsx`, `(tabs)/hub/events.tsx`, `ExperienceCreatorWizard.tsx`) — those become ORCH-0981 at ORCH-0980 CLOSE.
- DO NOT change `testID` strings.
- DO NOT modify existing tests — append only.

## 5. Expected output

- 2-3 scoped commits on `ORCH-0980-silent-save-failure-bug-class` branch.
- Updated `IMPLEMENTATION_ORCH-0980_EVENT_DATE_SAVE_AND_PATCH_KEY_AUDIT.md` appending "Rework #2 — Mixed-Patch Fix + Live-Fire Proof" section with:
  - Diff per file + rationale (especially the patch-stripping logic + the every-terminal-return signal audit).
  - DB-level test addition + how it's wired.
  - Step 0.5 regression: PASS commit hash + fails-on-revert proof at exact commits.
  - **Live-Fire End-to-End Proof section** with all 3 required artifacts (toast screenshot, persisted-values screenshot, DB probe output for the 24h event + new address).
  - Confirmation that you completed the exact operator repro (vibes and stuff event, 26 May 15:45→15:45 next day, 700 Corporate Center Dr Raleigh 27607) and it persisted end-to-end.

## 6. If any of these are true, ask operator BEFORE attempting the fix

- You cannot boot sim `F7ECAC25-2A98-4002-AD17-85AED17AB752` or start Metro on port 8093.
- You cannot find a published event suitable for the repro (need: writable, has dates, has venue address that can be edited).
- You cannot sign in to Seth's test account on the sim.
- The Mgmt API SQL access (per `feedback_supabase_mcp_workaround.md`) is unavailable for the DB probe.

Don't silently work around any of those. Stop and ask.

## 7. Comms ledger

Read `/Users/sethogieva/Desktop/mingla-main/COMMS_LEDGER.md` on entry. Acknowledge any rows where `to` matches ORCH-0980 or ALL.

## 8. Why this is brutal

Two prior reworks shipped "PASS at REVIEW" verdicts based on:
- ✓ Source-level proof
- ✓ Step 0.5 unit tests with fails-on-revert
- ✗ NO live-fire end-to-end (punted to operator iPhone retest)
- ✗ NO DB-level persistence verification

The pattern: unit tests pass, source looks right, REVIEW approves, operator retests on real device, bug is still there, cycle restarts. The bug each time was something the unit tests couldn't catch because they didn't exercise the actual mixed-patch flow against a real backend.

**Acceptable proof for this dispatch:**
1. Step 0.5 unit test PASSING with fails-on-revert ← necessary but NOT sufficient
2. **Live-fire end-to-end on sim with exact operator repro completed** ← REQUIRED
3. **DB probe showing the row updated** ← REQUIRED
4. Screenshots of toast + persisted values ← REQUIRED

Without (2) (3) (4), the orchestrator REVIEW returns NEEDS WORK. No exceptions this turn.

## 9. Downstream routing

After Codex pushes + reports completion WITH all 4 proof gates above:
1. Claude `mingla-orchestrator` REVIEW — verifies all 4 proof gates exist + cite-able.
2. If APPROVED → orchestrator publishes business-app EAS Update.
3. Operator iPhone retest on the exact same repro (vibes and stuff, 26 May 15:45→15:45, 700 Corporate Center Dr).
4. Operator PASS → ORCH-0964 smoke-test unblocks → CLOSE ORCH-0964 first, then CLOSE ORCH-0980.
5. Operator FAIL → escalation. Cannot afford a fourth retest cycle on the same bug.

This is the path. Execute it without shortcuts.
