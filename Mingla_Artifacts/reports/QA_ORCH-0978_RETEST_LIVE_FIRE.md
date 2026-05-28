# QA ORCH-0978 RETEST LIVE-FIRE

Verdict: **BLOCKED/UNVERIFIED**

Date: 2026-05-27
Tester side: Codex `tester-mingla`
Worktree: `/Users/sethogieva/Desktop/mingla-orchs/ORCH-0978-[video-upload-polish-and-cloudinary-lifecycle]/`
Branch: `ORCH-0978-video-upload-polish-and-cloudinary-lifecycle`
Starting HEAD: `4d2896d3293fcc2767a4729d94f462cd709efa10`
Tester test commit: `313146000b4e78a64ec08a5193f8e21e582c2868`

## Executive Finding

The v121 webhook deployment itself is present, but the required simulator live-fire could not be completed because the Mingla Business dev build could not load the ORCH-0978 bundle from Metro. The simulator was driven only through Maestro for the app/dev-launcher steps; Metro repeatedly listened on `localhost:8090` but then deadlocked mid-bundle, leaving the app on React Native's red "Could not connect to development server" screen. Because T-1 did not run, I did not ask Seth to run physical-iPhone T-1/T-2/T-3.

This is not a PASS. The previous stuck job `dde19eac-9810-4e0d-b8f6-63fe235fc5af` remains `source_uploaded` with `processed_url = null`, and no fresh superseding job was created during this retest.

## Required Evidence Matrix

| Requirement | Result | Evidence |
|---|---:|---|
| Webhook v121 deployed | PASS | `mcp__supabase__list_edge_functions` showed `event-cover-video-webhook` version `121`, `verify_jwt=false`, status `ACTIVE`, `updated_at=1779904585551`. The other event-cover-video functions were also at the deployed versions from the deploy report: upload-intent v95, source-uploaded v82, status v94, apply v92, cancel v92. |
| iOS Simulator T-1 through T-5 via Maestro | BLOCKED | Maestro launched `com.sethogieva.minglabusiness`, opened the `Business, http://localhost:8090` dev server entry, and tapped reload by coordinate. Metro then stalled and the app showed the red development-server error. Evidence artifacts: `Mingla_Artifacts/reports/qa-orch-0978-runtime/retest-live-fire-2026-05-27/maestro-00-launch.yaml`, `maestro-02-open-8090-point.yaml`, `maestro-04-reload-point.yaml`, `sim-bundle-progress.png`, `sim-after-restart.png`. |
| Rainbow 0:12 reaches `status=ready` with non-null `processed_url` within 30s | UNVERIFIED | T-1 never reached the app flow. No fresh job was created. |
| Job `dde19eac-...` transitions to ready or is superseded | FAIL for current DB state | Supabase SQL after retest: `dde19eac-9810-4e0d-b8f6-63fe235fc5af` remains `status='source_uploaded'`, `processed_url=null`, `processed_duration_ms=null`, `failure_code=null`, `completed_at=null`. Query over the same event for the last 6 hours returned only that job. |
| v121 dashboard happy-path log: `webhook_received`, no `job_id_extraction_failed` | UNVERIFIED | No happy-path Cloudinary callback occurred because T-1 did not upload. The only v121 webhook request visible in edge request logs during this window was the deploy verify-first-call `POST 403`, not a happy-path callback. |
| Adversarial public_id fallback test with context omitted | PASS | Added tester-owned Deno test `supabase/functions/event-cover-video-webhook/__tests__/job-id-recovery-adversarial.test.ts`; it verifies `recoverJobIdFromPayload` recovers the UUID last segment when `context` is omitted and the `public_id` has an extra folder prefix. |
| Physical iPhone human-in-loop T-1/T-2/T-3 | NOT REQUESTED | Per dispatch, physical testing comes after simulator T-1/T-2/T-3 is runnable. The simulator was blocked before upload flow entry, so Seth was not asked to spend physical-device time on an unproven build. |

## Simulator / Metro Evidence

Maestro-only driver evidence:

- `maestro-00-launch.yaml`: launched `com.sethogieva.minglabusiness`.
- `maestro-01-open-8090.yaml`: attempted text selector `Business, http://localhost:8090`.
- `maestro-02-open-8090-point.yaml`: successfully tapped the 8090 recent-server row by coordinate.
- `maestro-04-reload-point.yaml`: tapped the React Native red-screen reload affordance by coordinate.

Metro attempts:

1. `RCT_METRO_PORT=8090 npx expo start --port 8090 --dev-client` initially produced no listener for several minutes.
2. `CI=1 EXPO_DEBUG=1 ... expo start --port 8090 --dev-client --clear` reached Metro config output but did not serve `/status`.
3. `expo start --port 8090 --dev-client --localhost` served the dev launcher URL, then hung mid-bundle. `/status` and the bundle URL timed out while transformer worker processes sat idle.
4. Restart with `--max-workers 1` still stalled mid-bundle.

Key screenshots:

- `sim-open-8090.png`: dev launcher before opening 8090.
- `sim-after-open-point.png`: Mingla Business splash after Maestro tapped the 8090 row.
- `sim-bundle-progress.png` and `sim-after-restart.png`: React Native red screen, URL `http://127.0.0.1:8090/index.bundle?...`.

No `osascript`, CoreDevice, or `xctrace` physical-device control was used.

## Adversarial Regression Test

Commit:

```text
313146000b4e78a64ec08a5193f8e21e582c2868 ORCH-0978 QA adversarial regression: public_id fallback without context (fails-on-revert verified at 4d2896d32)
```

Files:

- `supabase/functions/event-cover-video-webhook/__tests__/job-id-recovery-adversarial.test.ts`
- `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` allowlist update

Run results:

| Phase | Command | Result |
|---|---|---|
| PASS on fixed code | `/Users/sethogieva/.deno/bin/deno test --allow-env supabase/functions/event-cover-video-webhook/__tests__/job-id-recovery-adversarial.test.ts` | PASS, 1/1 |
| FAIL with public_id fallback removed locally | Same command after temporarily replacing the fallback branch with `return null` | FAIL: expected `dde19eac-...`, received `null` |
| PASS after restore | Same command after restoring `public_id.split("/").at(-1)` fallback | PASS, 1/1 |

Broader gates run after adding the test:

```text
/Users/sethogieva/.deno/bin/deno check supabase/functions/event-cover-video-webhook/index.ts supabase/functions/event-cover-video-webhook/__tests__/job-id-recovery.test.ts supabase/functions/event-cover-video-webhook/__tests__/job-id-recovery-adversarial.test.ts
PASS

/Users/sethogieva/.deno/bin/deno test --allow-env supabase/functions/event-cover-video-webhook/__tests__/job-id-recovery.test.ts supabase/functions/event-cover-video-webhook/__tests__/job-id-recovery-adversarial.test.ts
PASS: 6 passed, 0 failed

node .github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs
PASS

node .github/scripts/strict-grep/orch-0978-video-cap-29s.mjs
PASS
```

## T-1 Through T-5

| Test | Result | Evidence |
|---|---:|---|
| T-1 success path | BLOCKED | Could not enter loaded business app due Metro bundle deadlock. No upload-intent call was made from the simulator. |
| T-2 trim-cap boundary | BLOCKED | Same bundle blocker. |
| T-3 rollback path | BLOCKED | Same bundle blocker. |
| T-4 Save gate non-regression | PARTIAL STATIC ONLY | No retained diff in `mingla-business/src/components/event/EditPublishedScreen.tsx`; runtime Save behavior unverified. |
| T-5 live edge 29251 validation | NOT RERUN | Prior live-fire already had T-5 PASS on v95; this retest did not reach session-token extraction because the app did not load. |

## Supabase State

Post-retest query for the prior stuck job:

```text
id=dde19eac-9810-4e0d-b8f6-63fe235fc5af
status=source_uploaded
processed_url=null
processed_duration_ms=null
failure_code=null
failure_message=null
created_at=2026-05-27 16:10:33.082496+00
updated_at=2026-05-27 16:10:34.716281+00
completed_at=null
cancelled_at=null
```

Query over event `09b4ece6-eabc-4734-8ce3-3a25d90417e4` for the last 6 hours returned only the same stuck job, so no superseding fresh job exists from this retest.

## Constitutional Check

| Rule | Result |
|---|---:|
| Read comms ledger before work | PASS |
| Use per-ORCH worktree | PASS |
| No product-code modifications retained | PASS |
| Tester writes test only | PASS |
| No SPEC modifications | PASS |
| No Save-gate widening | PASS |
| No `supabase db push` | PASS |
| No edge redeploy | PASS |
| Maestro default sim driver | PASS |
| No `osascript` | PASS |
| No CoreDevice / xctrace physical control | PASS |
| Regression test included | PASS |
| Live-fire evidence-backed verdict | PASS for BLOCKED |
| Physical iPhone human-in-loop | NOT REACHED |

## Verdict

**BLOCKED/UNVERIFIED.** The deployed backend fix and tester adversarial regression are green, but the live-fire release gate remains open because the simulator could not load the ORCH-0978 bundle and therefore could not create a fresh Cloudinary callback against webhook v121. Do not CLOSE ORCH-0978 from this report.

## Required Unblock / Retest

1. Stabilize Mingla Business dev-client bundle loading on the iOS simulator, or provide a known-good already-loaded business dev build for this worktree.
2. Rerun T-1 through T-5 via Maestro.
3. Confirm a fresh rainbow `0:12` job reaches `ready` with non-null `processed_url` within 30 seconds, and re-query `dde19eac-...` for ready or supersession.
4. Capture the v121 happy-path dashboard log with `stage: "webhook_received"` and no `job_id_extraction_failed`.
5. Only after simulator T-1/T-2/T-3 pass, pause for Seth's physical iPhone T-1/T-2/T-3.
