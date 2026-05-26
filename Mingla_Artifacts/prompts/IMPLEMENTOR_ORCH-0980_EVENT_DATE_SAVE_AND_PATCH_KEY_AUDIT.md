# IMPLEMENTOR DISPATCH — ORCH-0980 [Silent-save-failure bug class — event-date no-persist + patch-key-set audit]

**Dispatched:** 2026-05-26 by Claude `mingla-orchestrator`
**Target skill:** Codex `implementor-mingla` (combined INVESTIGATE + IMPLEMENT pass per operator urgency — operator is blocked from end-to-end smoke testing ORCH-0964 until date save persists)
**Severity:** S1-high (data-integrity grade — success toast lies; users believe edits saved when they didn't)
**Working tree:** `~/Desktop/mingla-orchs/ORCH-0980-[silent-save-failure-bug-class]/`
**Branch:** `ORCH-0980-silent-save-failure-bug-class` (just spawned from `main`)
**Metro port:** 8093

---

## 1. Why this is urgent

Operator is mid-smoke-test on ORCH-0964 [Public-page theme customization]. They installed dev builds for both apps at ORCH-0964 commit `cabff9c02`. To test the consumer-app event-detail theming (which renders themed cover + theme prop + Lottie entrance animation), they need to update the date of a published event so the consumer app's Discover surface picks it up. **They edit the date, see "saved" toast, but on re-entry the date is unchanged.** They cannot proceed with ORCH-0964 consumer-side smoke-test until this is fixed.

ORCH-0964 close is parked until this fix lands. Both ORCHs ship in parallel — ORCH-0980 is mechanically independent of ORCH-0964 (no file overlap).

## 2. Background — the parent pattern (ORCH-0964 F-A)

The same orchestrator + operator discovered F-A on ORCH-0964: `mingla-business/src/utils/brandPatch.ts` had `computeDirtyFieldsPatch` with explicit per-field `if (JSON.stringify(draft.X) !== JSON.stringify(original.X)) patch.X = draft.X;` comparisons. It was missing the line for `theme` — so theme changes silently dropped from the save patch, DB write completed with success (incomplete patch), and the success toast showed but the value never persisted. Codex fixed it in commit `a71648342` by adding the missing comparison.

**ORCH-0980 is a related-but-distinct bug class:** explicit-key-set / explicit-field-list patch builders that gate which draft fields flow into save paths. When the explicit list is incomplete, fields are silently dropped without warning. The success toast lies.

## 3. The specific bug — event-date save

**Reproducer:** business app → published event → Edit → change date → Save → toast says success → re-open event → date unchanged.

**Save chain traced:**
1. `mingla-business/src/components/event/EditPublishedScreen.tsx:803-819` — builds full `whenPayload` with `finalDate = patch.date ?? liveEvent.date`, calls `patchPublishedEventWhen(...)`.
2. `mingla-business/src/services/businessEvents.ts:858-877` — calls `supabase.rpc("business_patch_event_when", {...})`. RPC error map at line 824-846 covers 14 error codes; non-error response returns success.
3. `EditPublishedScreen.tsx:820` — `invalidateServerEventCaches()` fires post-success.

**Patch-key Sets that gate which fields flow into the When save path:**
- `EditPublishedScreen.tsx:153-206` declares 5 hardcoded Sets: `COVER_MEDIA_PATCH_KEYS`, `ORCH_0824_PATCH_KEYS`, `ORCH_0877_WHEN_PATCH_KEYS`, `ORCH_0964_THEME_PATCH_KEYS`, `SERVER_EDITABLE_PATCH_KEYS`.
- `ORCH_0877_WHEN_PATCH_KEYS` (line 187-195) already INCLUDES `date` — so this isn't a missing-key bug like F-A.

**Therefore the date-save bug is mechanistically distinct from F-A.** Investigate these 3 hypotheses in order — start with H1 because it's cheapest to disprove:

### H1 — Date-picker UI doesn't call `setPatch({ date: ... })` on change

Find the date-picker component or input that the When section mounts. Trace what happens when the user picks a new date. If the handler updates LOCAL state (e.g., a `selectedDate` useState) but never calls the screen's `setPatch` (or whatever the parent state-update fn is), then `patch.date === undefined` at save time. The save handler at `EditPublishedScreen.tsx:789` then falls through: `finalDate = patch.date !== undefined ? patch.date : liveEvent.date` → `finalDate = liveEvent.date` (the OLD date). RPC is called with the OLD date, returns success, DB is unchanged.

**Likely files:** `mingla-business/src/components/event/EditPublishedWhen*.tsx`, `EditPublishedSchedule*.tsx`, or wherever the When section's UI lives. Grep `EditPublishedScreen.tsx` for the When-section import.

**Repro proof (if H1 is real):** add a `console.log("setPatch called with", { date })` in the date-change handler. Edit date in UI. If the log never fires, H1 confirmed.

### H2 — RPC `business_patch_event_when` silently no-ops date changes

Docstring at `businessEvents.ts:818-820` says "Time-only edits (endsAt, doorsOpen, timezone) always succeed regardless of sold count" + "server rejects whenMode/recurrence/multi-date structural changes when sold>0". The `date` field is in NEITHER group — possibly falling into a silent-reject gap where the RPC returns success but doesn't update the row.

**Investigation path:** read the migration that defines `business_patch_event_when` (grep `supabase/migrations/` for `business_patch_event_when`). Find the date-handling branch. Look for guards like `IF sold_count > 0 AND date_changed THEN RETURN ...` that return without raising an error.

**Repro proof (if H2 is real):** before/after Mgmt API SQL probe — `SELECT date FROM event_dates WHERE event_id = '<ID>' ORDER BY date DESC LIMIT 1;` before the operator saves, then again after. If unchanged despite operator picking a new date, H2 confirmed.

### H3 — Cache invalidation doesn't refresh the screen's local state

RPC writes to DB successfully + `invalidateServerEventCaches()` fires + React Query refetches the event row → but the Edit screen's local `draft` state was initialized from the OLD event and isn't re-initialized post-save. User sees screen showing old date even though DB has new date.

**Investigation path:** read `EditPublishedScreen.tsx` initial draft seed logic. Check whether `liveEvent` re-renders propagate into `draft` via `useEffect` with `[liveEvent]` dependency, OR whether the screen mounts once with seeded draft and never re-syncs.

**Repro proof (if H3 is real):** after operator saves, exit the Edit screen entirely (back out to event detail), reopen Edit. If date NOW shows new value, H3 confirmed (DB had the update; local state was stale). If date STILL shows old value, H3 disproved — DB write didn't happen.

## 4. Required deliverable (combined investigate + fix)

1. **Identify which hypothesis (H1/H2/H3) is the actual root cause** via live-fire repro on business iOS sim (operator has the build installed at commit `cabff9c02` — same as the EAS Update bundle currently published to the development channel).
2. **Fix the root cause.** Scope strictly bounded — fix the date-save path only; do NOT touch theme save (already fixed by F-A), do NOT touch ticket save (different RPC), do NOT touch the broader audit yet.
3. **In the SAME PR, audit but do NOT fix** the patch-key Set drift across these surfaces — report findings in implementation report (do not silently fix; orchestrator will route audit fixes to a follow-up SPEC if scope warrants):
   - `EditPublishedScreen.tsx` patch-key Sets vs `EditableLiveEventFields` interface — any interface field NOT in any Set is a candidate silent-drop.
   - `mingla-business/src/utils/brandPatch.ts` `computeDirtyFieldsPatch` vs `Brand` interface — F-A might not be the only missing field.
   - `mingla-business/src/services/tripsService.ts` for equivalent diff/patch builders — any trip-side field that silently drops?
   - `mingla-business/src/services/marketing/marketingCampaignService.ts` + `marketingTemplateService.ts` for the same pattern.
4. **Add a Step 0.5 happy-path regression test** at `mingla-business/src/components/event/__tests__/` (or equivalent) that exercises the date-save round-trip. Test must FAIL when the fix is reverted. Record `fails-on-revert verified at <commit hash>` phrase in the implementation report.
5. **Do NOT add a structural prevention CI gate yet** — that requires forensics SPEC and is out of scope for this dispatch. Just flag the recommendation in the implementation report's "Follow-up" section.

## 5. Hard guards — DO NOT

- DO NOT add a new database migration unless H2 turns out to be a real RPC bug AND the RPC needs schema-level changes (almost certainly not — most likely the RPC needs a body-level conditional fix).
- DO NOT touch ORCH-0964 files (`packages/brand-rendering/`, `packages/event-rendering/`, `packages/theme-animations/`, `mingla-business/src/components/theme/`, `mingla-business/src/components/brand/PublicBrandPage.tsx`, etc.). ORCH-0964 is parked at APPROVED REVIEW awaiting smoke-test thumbs-up; touching its files would invalidate the REVIEW.
- DO NOT modify the patch-key Sets in `EditPublishedScreen.tsx:153-206` unless H1 turns out to be a missing key (it isn't — `date` is already in `ORCH_0877_WHEN_PATCH_KEYS`).
- DO NOT redeploy META-ORCH-0972 Sub-D edge functions (parse-restaurant-menu v39, parse-play-activities v38, agent-chat v72, agent-confirm-action v67).
- DO NOT widen scope to fix all audit findings in the same PR. Audit is reporting-only this turn.
- DO NOT change `testID` strings anywhere.
- DO NOT silently fix a test to make it pass. If you discover an existing test that was passing for the wrong reason, surface it as a P1 finding instead.

## 6. Expected output

- Commits on `ORCH-0980-silent-save-failure-bug-class` branch — segmented per logical change (one commit for the date-save fix, one for the regression test, one for the implementation report). Push when done.
- Implementation report at `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0980_EVENT_DATE_SAVE_AND_PATCH_KEY_AUDIT.md` containing:
  - Which hypothesis was the real root cause + how you proved it (logs, SQL probe, exit/re-enter test, whichever applies).
  - The diff applied + 1-sentence explanation per file touched.
  - Step 0.5 regression test path + `fails-on-revert verified at <commit hash>` phrase.
  - Audit findings: list of patch-key Set drifts and diff-builder missing fields found in the 4 surface scan. For each, classify as P0/P1/P2/P3 and recommend whether to fix now or open follow-up ORCHs.
  - Recommended structural prevention CI gate options (3 in the WORLD_MAP banner).
- Verify business app smoke-test passes end-to-end on iOS sim: edit a published event date, save, exit-and-reopen → date shows new value. Capture screenshot.
- EAS Update push request: orchestrator will publish the business-app dev bundle after REVIEW APPROVED so operator can re-test on installed iPhone build.

## 7. Downstream routing

After Codex pushes + reports completion:
1. Claude `mingla-orchestrator` REVIEW (commit-hash verify + Step 0.5 phrase + dependency walk + audit finding triage).
2. If APPROVED → orchestrator publishes business-app EAS Update to development channel.
3. Operator re-tests event-date save on installed iPhone build.
4. Operator confirms PASS → operator returns to ORCH-0964 smoke-test (now unblocked) → confirms ORCH-0964 → orchestrator CLOSE on ORCH-0964 first, then ORCH-0980.
5. If FAIL → re-dispatch with specific findings.

## 8. Comms ledger note

Read `/Users/sethogieva/Desktop/mingla-main/COMMS_LEDGER.md` on entry. Acknowledge any rows where `to` includes ORCH-0980 or ALL.

## 9. Context summary

- Tester verdict on ORCH-0964: PASS (P0:0 P1:0 P2:0 P3:0 P4:3) — that ORCH is unrelated to this bug.
- Operator on iOS dev build at commit `cabff9c02`.
- Business-app EAS Update group `c6362d0a-045f-42e9-b28f-5174766a268e` published 2026-05-26.
- ORCH-0964 worktree just received a `[deploy]` empty commit (`a1e318268`) to trigger Vercel preview deploy for the buyer-web — that's a separate orchestrator action, not your concern.
