# CLOSE NOTE — ORCH-1022 DM Shared Card Freeze + Single-Card Buttons

Date: 2026-05-31
Owner: Codex `orchestrator-mingla`
Worktree: `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1022-[dm-shared-card-freeze-policies-reservations]`
Branch: `ORCH-1022-dm-shared-card-freeze-policies-reservations`

## Verdict

CLOSED PASS Grade A.

Users can expand DM-shared single cards and use single-card Policies & Reservations, reservation links, and Schedule without freezing the expanded-card sheet.

## Evidence

- `npm run test:orch-1022` passed 8/8.
- Fail-on-revert against the prior implementation failed 5/8.
- `npm run test:orch-0908-chat` passed 6/6.
- Tester retest report: `Mingla_Artifacts/reports/TEST_REPORT_ORCH-1022_DM_SHARED_CARD_FREEZE_POLICIES_RESERVATIONS_RETEST.md`.
- Seth manually smoke-tested the worktree dev build at `exp://172.20.9.90:8084` and reported "passes".
- DIAG reap: zero `[ORCH-1022-DIAG]` matches.
- `git diff --check` passed.
- Scoped ESLint remains blocked by the pre-existing `@/src/services/deviceCalendarService` import resolver error in `ActionButtons.tsx`; the remaining scoped output is warnings only.

## Deploy Notes

- No Supabase migration.
- No edge function deploy.
- No Vercel `[deploy]` tag.
- App-mobile OTA is deferred under `project_ota_deferred_until_new_build`; this change rides the next native build unless Seth explicitly reopens OTA publishing.

## Residuals

- Optional Android manual smoke remains low-risk and non-blocking.
- ORCH-0910 curated chat payload failures remain separate and out of ORCH-1022 scope.

## Close Commit Message

```text
Close ORCH-1022: DM shared card freeze
```
