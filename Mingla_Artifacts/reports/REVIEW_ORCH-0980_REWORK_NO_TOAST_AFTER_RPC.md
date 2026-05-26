# IMPLEMENTATION REVIEW — ORCH-0980 REWORK — no-toast-after-RPC fall-through

**Reviewed by:** Claude `mingla-orchestrator` (REVIEW mode, post-operator-retest)
**Reviewed:** 2026-05-26
**Implementor:** Codex `implementor-mingla` (parallel session)
**Rework commits under review:** `25683db1c` (fix), `f62be42d6` (regression extension), `51c285330` (audit append) — all on top of prior `5f2b062c0` (REVIEW APPROVED H3 baseline)
**Branch HEAD:** `51c285330`
**Verdict:** **APPROVED — publish business-app EAS Update for operator iPhone retest, then unblock ORCH-0964 smoke-test, then CLOSE in sequence (ORCH-0964 first, then ORCH-0980).**

---

## Verdict at a glance

| Gate | Status |
|---|---|
| Hard guard — no migrations | **PASS** (zero diff in `supabase/migrations/`) |
| Hard guard — no edge functions | **PASS** (zero diff in `supabase/functions/`) |
| Hard guard — no ORCH-0964 guarded files | **PASS** (zero diff in `packages/brand-rendering/`, `packages/event-rendering/`, `packages/theme-animations/`, `mingla-business/src/components/theme/`, `mingla-business/src/components/brand/PublicBrandPage.tsx`) |
| Hard guard — no testID changes | **PASS** (zero `testID` diff in `*.ts`/`*.tsx`) |
| Hard guard — audit reporting-only (no widened fixes) | **PASS** (5 P1 silent-signal surfaces in marketing flagged as report-only; no fix applied) |
| Hard guard — H3 fix not undone | **PASS** (refresh helper + canonical write + draft reseed still in place) |
| DEC-179 commit-hash verification | **PASS** (3 scoped commits pushed; clean tree minus expected spawn.sh node_modules symlinks) |
| Step 0.5 fails-on-revert proof phrase | **PASS** (impl-report rework section: `Fails-on-revert verified at f62be42d6 by temporarily reverting fix commit 25683db1c`) |
| Suspect disambiguation | **PASS** (S3 confirmed as direct root cause via source; S2 explicitly disproved — refresh helper does not write Zustand and `updateLiveEventFields` has no no-change rejection; S1 remains a class risk but not the direct defect this turn) |

## Root cause as confirmed

**S3 — Server-owned When edits fell through into a local-only save/validation path after the RPC and canonical refresh had already succeeded.** The server-editable-only fast-path at `EditPublishedScreen.tsx:852` was gated by `disableLocalSaveReason !== undefined` (true only when `liveEvent === null`), so most published events with a local Zustand row skipped it and landed at the local `updateLiveEventFields` call at line 870. The local Zustand path could return `{ ok: false }` which opened a reject dialog at line 891 — with NO toast contract fulfillment. Operator saw: reason modal confirms → modal closes → no toast → lands on Edit screen.

Codex's fix:
1. **Server-editable-only patches now terminate cleanly post-RPC** — close modal, fire `"Saved. Live now."` toast, navigate back, return BEFORE the local Zustand step. Server is the authority.
2. **The remaining local reject path** now calls `surfaceLocalSaveRejection(...)` (new helper at `mingla-business/src/utils/localSaveRejectionSignal.ts`) BEFORE opening the reject dialog — guarantees a visible toast even if the dialog itself fails to render.

## Diff per file

| File | Lines | Purpose |
|---|---|---|
| `mingla-business/src/components/event/EditPublishedScreen.tsx` | +22 / -1 | Post-RPC server-editable-only termination + local-reject toast surfacing. |
| `mingla-business/src/utils/localSaveRejectionSignal.ts` | +16 (NEW) | Pure unit-testable signal helper + toast constant. Avoids importing full RN screen into Jest. |
| `mingla-business/src/components/event/__tests__/EditPublishedScreen_event_date_round_trip.test.ts` | +30 (APPENDED to existing file, not modified) | New `it()` block simulating `updateLiveEventFields` `{ ok: false }` + asserting `showToast(...)` fires once before reject dialog mounts. Append-only — no `[TEST-MOD-APPROVED]` tag needed. |
| `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0980_EVENT_DATE_SAVE_AND_PATCH_KEY_AUDIT.md` | +84 (APPENDED) | "Rework Audit" section covering S1/S2/S3 disambiguation, diff rationale, regression test verification, and the class-of-bug audit findings. |

Net: 4 files, 151 insertions, 1 deletion. Tight scope, no creep.

## Class-of-bug audit findings (REPORT-ONLY per dispatch §3 — surfaced for follow-up routing)

Codex walked 14 save/send/submit/confirm surfaces. **9 PASS, 5 flagged P1 silent-signal violations.** Carry these into ORCH-0980 CLOSE banner as Discoveries for downstream routing:

| # | Surface | Severity | Finding | Recommended action |
|---|---|---|---|---|
| AD-01 | `mingla-business/app/(tabs)/marketing/campaigns/compose.tsx:286` + `:479` | **P1** | Manual "Save draft" calls `flushDraft()` and returns with no success toast/nav/dialog. `flushDraft()` can also return silently when account/brand/audience is missing. Error path uses error toast. | Register follow-up ORCH or fold into a META silent-save-class fix. |
| AD-02 | `mingla-business/app/(tabs)/marketing/campaigns/index.tsx:73` + `:85` | **P1** | Cancel-scheduled-campaign + delete-draft successes refetch with no toast/dialog/nav. Failures show `Alert.alert`. | Follow-up. |
| AD-03 | `mingla-business/app/(tabs)/marketing/templates/[id].tsx:114` / `:147` / `:169` | **P1** | Existing-template save success returns updated id with no toast/nav/dialog. `handleSave` does NOT catch mutation rejection. | Follow-up. |
| AD-04 | `mingla-business/app/(tabs)/hub/events.tsx:467` | **P1** | Stale draft-delete confirm closes dialog silently when target draft is missing. | Follow-up. |
| AD-05 | `mingla-business/src/components/experience/ExperienceCreatorWizard.tsx:140-144` | **P1** (defensive) | Early returns on missing brand/user or invalid date have NO signal. Currently button-gated upstream but defensive miss. | Follow-up. |

**Recommendation:** at ORCH-0980 CLOSE, register a single follow-up ORCH-0981 [Silent-save-signal class fix across 5 surfaces] for the AD-01..AD-05 findings, OR fold them into ORCH-0978's broader audit scope. Decision can wait until CLOSE banner.

**9 surfaces audited PASS:** BrandEditView, EditPublishedTripScreen, marketing send/schedule, EventCreatorWizard, TripCreatorWizard, VenueCreatorWizard, door/brand/order sheets, JoinWaitlistSheet, account screens, checkout/payment.

## Residual risk acknowledged

**R-01 — Sim live-fire not completed this rework turn.** Codex explicitly notes Metro wasn't running on port 8093 + no clean online/pre-validated-event session was executed after the fix. Same residual risk shape as the prior ORCH-0980 review. Mitigations:
- Source-level proof of correct wiring (server-editable-only path now terminates cleanly; local-reject path now fires toast first).
- Step 0.5 regression passes 3/3 with fails-on-revert proof at exact commits.
- The combined contract (server authoritative for When + toast-before-dialog for local reject) is the standard pattern for server-mutated state with client guard-rails.

Acceptable grade: **PASS with mandatory operator iPhone retest as the final end-to-end proof.**

**R-02 — Pre-existing repo tsc red.** Codex notes broader workspace tsc fails on unrelated debt (`home.tsx` comparisons, checkout buyer implicit anys, ComposerV2 typings, missing `@mingla/payments-native`, legacy DraftEvent test fixtures, package-level RN types). Same broader-debt acceptance pattern as ORCH-0950 / ORCH-0964 closes. Not ORCH-0980's regression.

## Dependency walk (DEC-179)

Config-layer files touched: **NONE**. No `package.json`, `tsconfig*.json`, `app.json`, `app.config.ts`, `vercel.json`, `metro.config.*`, `babel.config.*`, `.github/workflows/**`, `.github/scripts/**` modifications. Pure source + test + report.

## Behind-main analysis

Branch is **2 commits behind `origin/main`** — both pure comms-ledger acks since prior REVIEW. Clean fast-forward at PR time.

## Decision tree fired

| Outcome | Path |
|---|---|
| **REVIEW APPROVED** (this verdict) | Orchestrator publishes business-app EAS Update to development channel → operator force-quits + reopens Mingla Business → retests event-date save on a clean test event (online or pre-validated address) → operator confirms PASS → ORCH-0964 smoke-test unblocks → operator returns to ORCH-0964 thumbs-up → orchestrator runs CLOSE on ORCH-0964 first, then CLOSE on ORCH-0980 (carrying the 5 P1 audit findings forward as either ORCH-0981 or folded into ORCH-0978). |
| Operator retest still fails | Re-dispatch with even narrower repro details. |

## Verdict

**APPROVED.** All hard guards PASS. S3 root cause confirmed via source (S2 explicitly disproved). Fix is mechanistically sound + minimally invasive. Step 0.5 regression PASS 3/3 with fails-on-revert proof at exact commits. Class-of-bug audit covers 14 surfaces with 5 P1 silent-signal violations flagged for follow-up routing. Residual risk on sim live-fire is acceptable + mitigated by source + Step 0.5 + standard-pattern adherence. Ready for business-app EAS Update publish + operator iPhone retest.

## Next-Handoff target

Orchestrator next move: publish business-app EAS Update via `eas update --branch development --platform ios` from the ORCH-0980 worktree's `mingla-business/` directory, then notify operator to force-quit + reopen the business app on their iPhone and retest event-date save on a clean test event (online OR pre-validated address). Operator-thumbs-up unblocks the parked ORCH-0964 close protocol.
