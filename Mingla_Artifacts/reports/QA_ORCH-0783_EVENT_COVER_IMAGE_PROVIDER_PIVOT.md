# QA ORCH-0783: Event Cover Image Provider Pivot

Date: 2026-05-11  
Mode: RETEST / SPEC-COMPLIANCE  
Skill: Codex `tester` parity mirror  
Working tree: `.worktrees/orch-0783-event-cover-image-provider-pivot/`  
Verdict: CONDITIONAL PASS

## Executive Verdict

CONDITIONAL PASS. The prior P1 blocker is resolved: published event cover-only edits now carry selected provider metadata through `editableDraftToPatch`, and `EditPublishedScreen` passes those values into `updatePublishedEventCoverMedia` instead of falling back to stale or null live-event metadata.

No P0/P1 blockers remain in the code/test gate retest. Release remains conditional on manual parity and deploy/config gates because TEST did not apply the migration, deploy the Edge Function, read provider secret values, or run iOS/Android/Web runtime provider flows with real configured provider access.

## Severity Counts

| Severity | Count |
|---|---:|
| P0 Critical | 0 |
| P1 High | 0 |
| P2 Medium | 2 |
| P3 Low | 0 |
| P4 Note | 2 |

## Retest Claim Table

| Claim | Result | Evidence |
|---|---|---|
| Published cover-only edit no longer drops provider metadata | VERIFIED | `mingla-business/src/utils/liveEventAdapter.ts:62-66` projects live provider metadata into edit state; `:225-239` emits changed provider/source/credit/creditUrl/alt into the patch. |
| Provider metadata changes are safe/additive edit fields | VERIFIED | `mingla-business/src/utils/liveEventAdapter.ts:108-112` labels provider fields; `:153-157` includes them in `SAFE_KEYS`; regression expects additive severity. |
| Published save passes selected metadata to persistence service | VERIFIED | `mingla-business/src/components/event/EditPublishedScreen.tsx:561-606` treats provider metadata fields as media patch fields and forwards each changed value to `updatePublishedEventCoverMedia`. |
| Regression covers original failure mode | VERIFIED | `mingla-business/src/utils/__tests__/liveEventAdapter.test.ts:83-108` proves selected Pexels metadata is emitted; `:110-132` proves stale provider metadata clears for uploaded covers. These assertions would fail against the prior patch builder that only emitted URL/type. |
| ORCH-0783 provider/image pivot gates still pass | VERIFIED | `npm run test:orch-0783` passed: 8 suites, 68 tests. |
| Legacy video/hue guards remain intact | VERIFIED | `npm run test:orch-0770` passed; `npm run test:orch-0776` passed on standalone rerun; `coverHue` and legacy video rendering were not removed. |
| Provider secrets remained protected in TEST | VERIFIED WITH LIMITS | TEST did not read or print provider secret values. Static review only confirmed runtime code uses env names/client proxy boundaries, not actual secret values. |

## Findings

### P2 - Manual iOS/Android/Web provider parity remains unverified

Evidence:
- Automated tests verify the data boundary, provider adapter behavior, public mapping, and renderer compatibility.
- TEST did not launch iOS Simulator, Android Emulator, or Web Browser flows with provider keys configured.
- Provider-key-backed Pexels behavior cannot be fully accepted without runtime environment configuration, and TEST must not read or print provider secret values.

Impact:
- A platform-specific picker, upload, attribution, cache, or navigation issue could still appear despite passing unit/static gates.

Required manual gate:
- Run the parity checklist below before CLOSE is treated as release-ready.

### P2 - Deploy/config sequencing remains operator-gated

Evidence:
- Migration `20260515000018_orch_0783_event_cover_provider_metadata.sql` is monotonic over `origin/main` max `20260515000017`, but TEST did not apply it.
- `event-cover-pexels-search` Deno check/test passed, but TEST did not deploy the Edge Function.
- Provider key values were intentionally not read, printed, or validated by TEST.

Impact:
- Production/provider runtime can fail if the migration, function deploy, or provider environment setup is skipped or misordered.

Required deploy gate:
- Operator applies the migration, configures provider env/secrets outside Git, deploys `event-cover-pexels-search`, and performs runtime smoke tests.

### P4 - ORCH-0776 parallel run produced one transient Jest mock failure, standalone rerun passed

Evidence:
- An initial `npm run test:orch-0776` run launched in parallel with `npm run test:orch-0770` failed one timeout test with `TypeError: Cannot destructure property 'data' ... undefined`.
- Immediate standalone rerun of `npm run test:orch-0776` passed 13/13 tests.

Assessment:
- Not counted as a release blocker for ORCH-0783 because the normal standalone gate passed. Keep an eye on this legacy test if future parallel QA runs repeat the same failure.

### P4 - Watchman recrawl warning appeared during Jest runs

Evidence:
- Jest emitted a Watchman recrawl warning during several test runs.

Assessment:
- Non-blocking local environment warning; tests still executed and passed.

## Required Verification Matrix

| # | Requirement | Result | Evidence |
|---:|---|---|---|
| 1 | Step 4 presents local image/GIF, GIPHY, and Pexels; no active video/hue creation UI | PASS | ORCH-0783 strict grep passed through `npm run test:orch-0783`; `CreatorStep4Cover.tsx` provider metadata selection remains present. |
| 2 | Local image/GIF sets provider `upload` and clears provider metadata | PASS | `CreatorStep4Cover.tsx` writes upload metadata; `liveEventAdapter.test.ts:110-132` covers stale metadata clearing for published upload replacement. |
| 3 | GIPHY result stores GIF URL and provider/source/credit/alt metadata | PASS | GIPHY adapter tests passed in `npm run test:orch-0783`; draft/publish/public mapper tests passed. |
| 4 | Pexels result stores landscape image URL and provider/source/credit/alt metadata | PASS | Pexels client tests and Edge Deno tests passed; `liveEventAdapter.test.ts:83-108` covers published Pexels metadata patch. |
| 5 | Public event, checkout, order/ticket, organiser card, and Step 7 preview render provider media without fallback regression | STATIC PASS / MANUAL GATE | Shared `EventCoverMedia` and public mapping tests passed; runtime parity surfaces were not manually exercised. |
| 6 | Existing `cover_media_type = 'video'` rows still render or safely fall back | PASS | `npm run test:orch-0770` and `npm run test:orch-0776` passed; strict grep confirms legacy video support remains. |
| 7 | Repo-running automated tests cover changed behavior in the scoped change | PASS | `npm run test:orch-0783` includes `liveEventAdapter.test`; focused `npx jest liveEventAdapter.test --runInBand` passed. |
| 8 | Published cover-only provider metadata persists through edit path | PASS | `liveEventAdapter.ts:225-239`, `EditPublishedScreen.tsx:561-606`, and `liveEventAdapter.test.ts:83-132`. |
| 9 | Provider secrets are not exposed | PASS WITH STATIC LIMITS | No provider secret values were read or printed by TEST; client Pexels adapter calls the Edge Function, and Edge tests use placeholders only. |
| 10 | Migration monotonic and non-destructive | PASS STATIC | `origin/main` max migration prefix `20260515000017`; local max `20260515000018`; no deleted files from `git diff --name-only --diff-filter=D origin/main --`. |

## Verification Commands

All commands were run from `.worktrees/orch-0783-event-cover-image-provider-pivot/` unless the command path says `mingla-business`.

| Command | Result |
|---|---|
| `cd mingla-business && npm run test:orch-0783` | PASS: strict grep passed; 8 suites, 68 tests passed. |
| `cd mingla-business && npx jest liveEventAdapter.test --runInBand` | PASS: 1 suite, 2 tests passed. |
| `cd mingla-business && npm run test:orch-0770` | PASS: strict grep passed; 3 suites, 26 tests passed; bundled TypeScript check completed successfully. |
| `cd mingla-business && npm run test:orch-0776` | PASS on standalone rerun: strict grep passed; 1 suite, 13 tests passed. Initial parallel run failed one legacy timeout test, then rerun passed. |
| `cd mingla-business && npm run tsc -- --noEmit` | PASS. |
| `/Users/sethogieva/.deno/bin/deno check supabase/functions/event-cover-pexels-search/index.ts` | PASS. |
| `/Users/sethogieva/.deno/bin/deno test --allow-env --allow-net supabase/functions/event-cover-pexels-search/index.test.ts` | PASS: 5 tests passed. |
| `node .github/scripts/strict-grep/orch-0783-event-cover-image-provider-pivot.mjs` | PASS. |
| `git diff --check` | PASS. |
| `git diff --name-only --diff-filter=D origin/main --` | PASS: no deleted files listed. |
| Migration max-prefix check against `origin/main` and local migrations | PASS: `origin/main` max `20260515000017`; local max `20260515000018`. |

## Manual Parity / Release Gates

Required before treating this as release-ready:

| Gate | Required check |
|---|---|
| iOS Business app | Local image/GIF upload, GIPHY search/select, Pexels search/select, remove cover, selected-cover preview, Step 7 preview, and published edit replacement all persist and render correct metadata/attribution. |
| Android Business app | Same parity as iOS, including provider error states and navigation after save. |
| Web/Browser Business app | Same parity as mobile, with public page attribution and no active Step 4 video/hue entry points. |
| Public/checkout/order/card surfaces | Provider/local covers render correctly; legacy safe videos still render; unsafe MOV/QuickTime public rows fall back. |
| Provider config | Public GIPHY env names and Supabase Edge Function secret `PEXELS_API_KEY` are configured outside Git; do not expose values in logs or artifacts. |
| Deploy order | Apply migration before app code depends on provider columns; deploy `event-cover-pexels-search` after Deno gates; then run provider-backed smoke tests. |

## Deploy Notes

- TEST did not apply migrations.
- TEST did not deploy Edge Functions.
- TEST did not read or print provider secret values.
- Do not delete or undeploy existing `event-cover-video-*` functions.
- Do not remove `coverHue`, `cover_media_type = 'video'`, video storage allowances, or legacy video render/fallback paths.

## Downstream Routing

Route to Codex `orchestrator-mingla` for CLOSE only after the operator accepts the listed P2 manual/deploy conditions as release gates. If those conditions are not accepted, route to Codex `implementor-mingla` only for a bounded follow-up that automates or operationalizes the missing parity/deploy checks.

## Next Handoff

NEXT HANDOFF — paste into Codex `orchestrator-mingla`:

Close ORCH-0783 in Working tree: `.worktrees/orch-0783-event-cover-image-provider-pivot/` only if the operator accepts QA verdict CONDITIONAL PASS in `Mingla_Artifacts/reports/QA_ORCH-0783_EVENT_COVER_IMAGE_PROVIDER_PIVOT.md`. The prior P1 published cover-only metadata blocker is resolved by `mingla-business/src/utils/liveEventAdapter.ts` and covered by `mingla-business/src/utils/__tests__/liveEventAdapter.test.ts`, with ORCH-0783/0770/0776, TypeScript, Deno, strict-grep, diff-check, no-deletion, and migration-monotonic gates passing. Hard guards remain: do not apply migrations from TEST, do not read or print provider secret values, do not delete migrations/functions, do not remove `coverHue`, and do not retire legacy video rendering. Expected output is CLOSE artifact sync with the P2 manual parity/deploy gates preserved for release operations; if the operator does not accept those conditions, route to Codex `implementor-mingla` for bounded follow-up automation or operational gate work.
