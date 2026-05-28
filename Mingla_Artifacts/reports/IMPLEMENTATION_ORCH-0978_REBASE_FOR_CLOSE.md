# IMPLEMENTATION — ORCH-0978 [video upload polish + Cloudinary lifecycle] — REBASE-FOR-CLOSE

**Date:** 2026-05-28
**Skill:** Claude `mingla-implementor` (operator "take over")
**Worktree:** `~/Desktop/mingla-orchs/ORCH-0978-[video-upload-polish-and-cloudinary-lifecycle]/`
**Branch:** `ORCH-0978-video-upload-polish-and-cloudinary-lifecycle`
**Status:** implemented and verified (integration pass; no new feature code)
**Dispatch:** `Mingla_Artifacts/prompts/IMPLEMENTOR_ORCH-0978_REBASE_FOR_CLOSE.md`

## Summary

Rebase/integration pass to make the branch cleanly mergeable. Strategy: **merged `origin/main` into the branch** (single conflict-resolution pass; the close squash-merge collapses history). Branch was 35 ahead / 55 behind; now **0 behind**. PR scope vs main: **122 files**. No `supabase db push`, no edge redeploy (production already on canonical versions).

## Conflicts resolved (6)

| File | Resolution | Rationale |
|---|---|---|
| `packages/event-rendering/EventCoverMedia.tsx` (add/add) | **Took main's launch version** (462 lines) | Both branches independently created the shared file; main's is the live v1.1.0 launch renderer (PR #228) and already renders image+GIF+video (web `<video>` iOS muted-autoplay + expo-video native). |
| `mingla-business/src/components/ui/EventCoverMedia.tsx` | **Took main's re-export shim** | Maintenance rule [[eventcovermedia-shared-package]] — business side is a thin shim; edit the shared package. |
| `app-mobile/app.json` plugins | **Union** (`react-native-compressor` + `expo-video`) | compressor is a real dep imported by `eventCoverVideoProcessingService.ts`; main needs expo-video. |
| `packages/event-rendering/package.json` | **Took main's deps** (expo-image/linear-gradient/video) | Required by the adopted shared renderer. |
| `.github/workflows/strict-grep-mingla-business.yml` | **Union** (3 ORCH-0978 jobs + 1 ORCH-0986 job) | Independent gates; both must run. |
| `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` | **Union** (`...ORCH_0977` + `...ORCH_0978` allowlists) | COMMS-0002 backend allowlist; both ORCHs touch backend. |

### EventCoverMedia decision — validated, not guessed

The branch's 561-line `EventCoverMedia` was a *divergent, more-featured* renderer (`posterUri`, `onFirstFrameRender`, `video_still` reduce-motion mode). Decision check: **no ORCH-0978 product consumer references those props** — `git grep posterUri|onFirstFrameRender|video_still` hits ONLY planning docs under `Mingla_Artifacts/`, never `*/src/*` feature code. Consumers use the standard prop set main's renderer supports. After adopting main's version, **all 4 ORCH-0978 strict-grep gates still PASS** (incl. autoplay-muted-contract) — proving zero gate regression. The branch's renderer polish (poster/reduce-motion-still) was not required for trim→upload→render (sim-proven) and is a documented follow-up.

## Migration reconciliation (averted an accidental deletion)

At dispatch time COMMS-0008 said ORCH-0986 PR #235 owned landing the two ORCH-0978 video-cap migrations and the branch should not carry divergent copies. **By the time this pass ran, PR #235 had merged** — `origin/main` now carries all five `2026073000000{0..4}` migrations (ORCH-0978 ×2 + ORCH-0986 ×3). I initially `git rm`'d the two 0978 migrations, then caught that they now live on main and **restored them from `origin/main`** so the branch matches main exactly. **Net PR migration diff: ZERO.** No migration is added or deleted by this PR.

## Lockfiles

`mingla-business/package-lock.json` reconciled via `npm install --package-lock-only` (84-line cleanup of stale merge entries); `react-native-video-trim@^8.1.0` present. `app-mobile/package-lock.json` already consistent (no-op). No `npm ci` job exists in CI.

## Verification (all CI-gating checks green)

- **Strict-grep (CI-gated):** `orch-0978-video-cap-29s` C1–C12, `orch-0978-video-upload-optimistic-preview`, `orch-0978-video-cancel-aborts-upload`, `orch-0978-video-autoplay-muted-contract`, `orch-0863-marketing-hub-phase-b` (C1–C7) — **all PASS**.
- **Deno (CI-gated via `supabase-migrations-and-stripe-deno.yml`):** webhook + upload-intent + `_shared` — **25 passed / 0 failed**.
- **Webhook 200-not-400 regression (dispatch item 6):** ALREADY EXISTS — `event-cover-video-webhook/__tests__/job-id-recovery.test.ts:119` feeds the exact `event-covers/raw/{brand}/{event}/{job}` eager `public_id` and asserts 200 + `ready` (committed IMPLEMENT-3 `313146000`). The stranding incident was deploy-drift, not a source gap; this test covers the contract. No redundant test added.
- **Regression gate (Step 0.5):** T-AMEND9-01 (`CoverPicker.dedicatedTrimmer.test.ts`) PASS + **fails-on-revert verified** — reverting `endTime − startTime` → `durationMs` 29000 (expected 25000) → test FAILS; restored → PASS. T-AMEND9-02 is a source-presence/ordering test (cancel-guard before upload-start; revert-sensitive by construction). Tester adversarial: `job-id-recovery-adversarial.test.ts` (Deno) ships in the same diff.

## Discoveries for Orchestrator

- **DISC-1 (pre-existing, NOT introduced here) — 14 failing jest tests across 4 suites** (`eventCoverMedia.test.ts`, `eventCoverMediaService.test.ts`, `eventCoverVideoProcessingService.compression.test.ts`, `serverDraftLifecycleGuards.test.ts`). Proven pre-existing: the pre-merge tip `1744305a5` had **16** failures in these suites; post-merge has **14** (the merge reduced them). These are largely **stale source-inspection tests** asserting the branch's pre-shared-package renderer/source patterns that no longer exist after the renderer consolidated into `@mingla/event-rendering`. **jest is NOT a CI gate** (no jest job in `.github/workflows/`), and the feature is sim-proven end-to-end (QA RETEST #2), so they neither block the PR nor indicate a runtime regression. **Recommend a follow-up cleanup ORCH** to update/remove the obsolete source-inspection assertions (some are append-only-locked → needs `[TEST-MOD-APPROVED]`).
- **DISC-2 — native rebuild required to ship to users.** `react-native-video-trim` is a native module; the feature reaches real devices only via a full `mingla-business` native build (the separately-blocked EAS device-signing task), NOT an OTA.
- **DISC-3 — ORCH-0978 edge source lands on main via this PR** to match what's already deployed to production (webhook v125 / upload-intent v100 / +4). The branch source equals the deployed bundles; this PR reconciles main's source-of-truth. No redeploy needed.

## Hard guards honored

No `supabase db push`; no edge-function redeploy; migrations match main (zero diff); scoped to ORCH-0978; live v1.1.0 launch rendering preserved (adopted main's renderer verbatim).

## Next

Route to Claude `mingla-orchestrator` for PR (`[deploy]` tag — `mingla-business/src` is a Vercel build input) + pre-merge gate + merge + CLOSE artifacts.
