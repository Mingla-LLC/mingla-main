# Implementation Rework Report: ORCH-0931 Realtime Broadcast `session_updated`

> Date: 2026-05-23  
> Mode: Rework after tester FAIL  
> Source QA: `Mingla_Artifacts/reports/QA_ORCH-0931_REALTIME_BROADCAST_SESSION_UPDATED.md`  
> Status: implemented, partially verified

## 1. Summary

This rework fixes the concrete implementation blocker from QA: the ORCH-0931 strict-grep gate now has a real GitHub Actions job in `.github/workflows/strict-grep-mingla-business.yml`. The job runs both the gate self-test and the gate itself, so future PRs cannot silently bypass `I-PROPOSED-ORCH-0931-NO-PK-FILTER-REALTIME`.

The live SC-1..SC-12 matrix is still **not fully verified** in this pass. Two iOS simulators are available, but Android remains unavailable: `Pixel_8_Pro` exists as an AVD, the boot attempt exited without attaching, and `adb devices -l` stayed empty. I did not mutate the protected `daadd454-35a8-487d-ab25-bb595abc4635` session directly via SQL, did not push, did not open a PR, and did not apply any migration.

## 2. Rework Inputs

| Artifact | Use |
|---|---|
| `Mingla_Artifacts/reports/QA_ORCH-0931_REALTIME_BROADCAST_SESSION_UPDATED.md` | Tester FAIL report and rework contract. |
| `Mingla_Artifacts/specs/SPEC_ORCH-0931_REALTIME_BROADCAST_SESSION_UPDATED.md` | SC-1..SC-12 and CI-gate requirements. |
| `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0931_REALTIME_BROADCAST_SESSION_UPDATED.md` | Original implementation claims and verification baseline. |

## 3. Files Changed

| File | Change |
|---|---|
| `.github/workflows/strict-grep-mingla-business.yml` | Added registry line and job `i-proposed-orch-0931-no-pk-filter-realtime`. The job uses Node 20, runs `node --test .github/scripts/strict-grep/i-proposed-orch-0931-no-pk-filter-realtime.test.mjs`, then runs `node .github/scripts/strict-grep/i-proposed-orch-0931-no-pk-filter-realtime.mjs`. |
| `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0931_REALTIME_BROADCAST_SESSION_UPDATED_REWORK.md` | This rework report. |

Note: the workflow already had unrelated ORCH-0933 Circle gate edits in the working tree before this rework pass. I preserved them and added only the ORCH-0931 registry/job lines.

## 4. Old To New Receipt

### Strict-grep CI registration

- **Before:** `.github/scripts/strict-grep/i-proposed-orch-0931-no-pk-filter-realtime.mjs` and `.test.mjs` existed and passed locally, but `.github/workflows/strict-grep-mingla-business.yml` did not mention ORCH-0931. QA correctly found that CI would not run the new invariant gate.
- **After:** `.github/workflows/strict-grep-mingla-business.yml` registers `I-PROPOSED-ORCH-0931-NO-PK-FILTER-REALTIME` in the comments and adds a dedicated job that runs the self-test and gate.
- **Why:** Satisfies SC-8 and closes QA F-3.

## 5. Verification

| Check | Command | Result |
|---|---|---|
| Workflow YAML parses | `ruby -e 'require "yaml"; YAML.load_file(".github/workflows/strict-grep-mingla-business.yml"); puts "workflow yaml parse ok"'` | PASS |
| ORCH-0931 strict-grep self-test | `node --test .github/scripts/strict-grep/i-proposed-orch-0931-no-pk-filter-realtime.test.mjs` | PASS, 2/2 tests |
| ORCH-0931 strict-grep gate | `node .github/scripts/strict-grep/i-proposed-orch-0931-no-pk-filter-realtime.mjs` | PASS, scanned 966 files, 64 listeners, 0 violations |
| ORCH-0931 focused service regression | `cd app-mobile && npx tsc /tmp/orch-0931-globals.d.ts src/services/realtimeService.ts src/services/__tests__/realtimeService.orch-0931.test.ts --target es2020 --module commonjs --jsx react-jsx --esModuleInterop --skipLibCheck --outDir /tmp/orch-0931-test && node /tmp/orch-0931-test/services/__tests__/realtimeService.orch-0931.test.js` | PASS, T-IMP-1..4 |
| Diff whitespace | `git diff --check -- .github/workflows/strict-grep-mingla-business.yml app-mobile/src/services/realtimeService.ts app-mobile/src/hooks/useBoardSession.ts app-mobile/src/services/__tests__/realtimeService.orch-0931.test.ts .github/scripts/strict-grep/i-proposed-orch-0931-no-pk-filter-realtime.mjs .github/scripts/strict-grep/i-proposed-orch-0931-no-pk-filter-realtime.test.mjs` | PASS |
| Migration presence | `/Users/sethogieva/bin/supabase migration list --linked \| tail -12` | PASS for ORCH-0931: local and remote both include `20260724000001`. Unrelated local-only `20260724000002` is present for ORCH-0933. |
| Android availability | `emulator -list-avds`; `adb devices -l`; attempted `emulator -avd Pixel_8_Pro -no-snapshot-load` and polled `adb devices -l` | BLOCKED: AVD exists, but no device attached; boot attempt exited with empty emulator log and `adb devices` stayed empty. |
| Current Metro evidence scan | counted `/tmp/expo_metro.log` | Still no controlled proof: `broadcast session_updated=0`, `onSessionUpdated fired=0`, `collab params changed=28`, `success deck-cards.collab=50`, `CHANNEL_ERROR=2`. |

## 6. SC-1..SC-12 Status After Rework

| SC | Status |
|---|---|
| SC-1 broadcast receipt | Still unverified live. No controlled post-rework two-device event was produced. |
| SC-2 cache invalidation/refetch after broadcast | Still unverified live. Existing invalidation/refetch logs are not causally tied to `broadcast session_updated`. |
| SC-3 dead-end heal | Still unverified live. |
| SC-4 anon denial | Previously verified by tester; no product-code change in this rework affects it. |
| SC-5 non-participant denial | Still requires tester/live third-account proof. |
| SC-6 no noise broadcast | Still requires approved fresh fixture or operator-owned data mutation path; not run against protected session. |
| SC-7 payload shape | Structurally implemented; live row inspection still needs a real trigger event. |
| SC-8 strict-grep CI gate | **Implemented and verified locally.** |
| SC-9 implementor regression test | PASS. |
| SC-10 chat/presence/messages no regression | Still requires live iOS/Android smoke. |
| SC-11 DELETE TODO | Previously implemented; unchanged. |
| SC-12 migration applied | PASS for ORCH-0931 remote history. |

## 7. Risks And Remaining Manual Gates

1. **Live broadcast path remains the critical unverified gate.** The DB objects and client path are present, but a tester still needs a controlled event that proves `realtime.send` writes/delivers and that mobile receives it as `broadcast session_updated`.
2. **Android fixture is unavailable in this environment.** `Pixel_8_Pro` is listed but did not attach to ADB. Tester/operator must either repair the AVD, provide a physical Android device, or explicitly accept an iOS-only temporary manual gate.
3. **No direct SQL mutation of `daadd454-...` was performed.** If SC-6/SC-7 need direct DB adversarial checks, use a fresh approved fixture session or an operator-owned mutation path.

## 8. Ready For Retest

Retest should focus on the remaining live gates:

1. Confirm the workflow job exists and can run the ORCH-0931 gate.
2. Run two-device iOS broadcast receipt and cache-refetch proof.
3. Run Android parity once an Android fixture is attached and signed in.
4. Run anon and non-participant denial.
5. Run chat/presence/message smoke on the now-private `board_session:<sessionId>` channel.

## 9. Next Handoff

NEXT HANDOFF — paste into Codex `tester-mingla`:

Retest ORCH-0931 on the tester side using `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0931_REALTIME_BROADCAST_SESSION_UPDATED_REWORK.md`, `Mingla_Artifacts/reports/QA_ORCH-0931_REALTIME_BROADCAST_SESSION_UPDATED.md`, `Mingla_Artifacts/specs/SPEC_ORCH-0931_REALTIME_BROADCAST_SESSION_UPDATED.md`, and `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0931_REALTIME_BROADCAST_SESSION_UPDATED.md`; the goal is to verify the CI workflow wiring plus the remaining live SC-1..SC-12 broadcast matrix. Hard guards: do not weaken tests, do not mutate live `daadd454-35a8-487d-ab25-bb595abc4635` directly via SQL, do not push/open PR/merge, and do not apply migrations except through an operator-owned `supabase db push --linked` step if explicitly confirmed. Expected output is `Mingla_Artifacts/reports/QA_ORCH-0931_REALTIME_BROADCAST_SESSION_UPDATED_RETEST.md` with PASS / CONDITIONAL PASS / FAIL and evidence for live broadcast receipt, cache invalidation/refetch, anon/non-participant denial, and no regression to chat/presence/message flows. After PASS route to Codex `orchestrator-mingla` for CLOSE; after FAIL route back to Codex `implementor-mingla` for REWORK; Working tree: `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`.
