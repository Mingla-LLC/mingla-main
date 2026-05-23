# QA ORCH-0931 — Realtime Broadcast `session_updated`

**Mode:** TARGETED / SPEC-COMPLIANCE QA via Codex `tester-mingla` parity mirror  
**Date:** 2026-05-23  
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`  
**Verdict:** **FAIL**

## Executive Verdict

ORCH-0931 is **not ready to close**. The database migration is applied in the linked Supabase project, the local code-level regression tests pass, and anonymous private-channel access is denied. However, the required live proof is missing for the actual release gate: there is no controlled two-device iOS + Android evidence that a qualifying preference/session update emits and delivers `broadcast session_updated`, triggers `onSessionUpdated`, refreshes `useBoardSession`, invalidates/refetches deck cards, and preserves chat/presence/message flows.

This is a release-gate FAIL for two independent reasons:

1. **P1 — SC-1/SC-2/SC-10/SC-12 live proof is absent.** Current Metro evidence has `0` `broadcast session_updated` logs and `0` `onSessionUpdated fired` logs. `adb devices -l` returned no attached Android device, so Android parity could not be tested.
2. **P1 — SC-8 CI wiring is incomplete.** The new strict-grep script and test exist and pass locally, but `.github/workflows/strict-grep-mingla-business.yml` does not register the ORCH-0931 job. A future PR can bypass the invariant in CI.

Hard guards held: I did not push, open a PR, merge, apply a migration, weaken tests, or directly mutate the protected `daadd454-35a8-487d-ab25-bb595abc4635` session via SQL. The only live Supabase action beyond read-only inspection was an anonymous private-channel subscribe attempt, which is non-mutating and returned `CHANNEL_ERROR`.

## P1 Findings

| ID | Severity | Finding | Evidence | Required rework |
|---|---:|---|---|---|
| F-1 | P1 | Live broadcast receipt is not proven. | `/tmp/expo_metro.log` counts: `broadcast session_updated=0`, `onSessionUpdated fired=0`, `collab params changed=28`, `success deck-cards.collab=50`, `CHANNEL_ERROR=2`. Supabase read-only query returned `[]` for latest `realtime.messages` rows where `topic like 'board_session:%' and event='session_updated'`. | Run a controlled post-migration live test on fresh or approved session data: two participants subscribed, one participant changes prefs through app UI/RPC path, other receives `broadcast session_updated` within 2s and logs `onSessionUpdated fired`. |
| F-2 | P1 | Android parity cannot pass because no Android device/emulator was attached. | `adb devices -l` output: `List of devices attached` with no rows. | Provide/signon an Android AVD or physical Android test device, then run SC-1..SC-12 on Android as well as iOS. |
| F-3 | P1 | The ORCH-0931 strict-grep gate is not wired into CI. | `.github/scripts/strict-grep/i-proposed-orch-0931-no-pk-filter-realtime.mjs` exists and passes locally, but `rg -n "orch-0931|i-proposed-orch-0931" .github/workflows/strict-grep-mingla-business.yml` has no workflow job/registry entry. Workflow lines 27-30 explicitly say adding a new gate requires adding one script plus one job. | Add a workflow job for `i-proposed-orch-0931-no-pk-filter-realtime.mjs` and, preferably, a job/step for its `.test.mjs`. |
| F-4 | P1 | SC-10 no-regression for chat/presence/messages is unverified live. | Code preserves existing handlers in `app-mobile/src/services/realtimeService.ts`, but no controlled two-device smoke evidence was produced for board messages, typing, presence, saved cards, votes, RSVPs, or card messages after the channel became private. | Run two-device smoke on the same private `board_session:<id>` channel after broadcast receipt is proven. |

## What Was Verified

| Area | Result | Evidence |
|---|---|---|
| Migration applied remotely | PASS | `/Users/sethogieva/bin/supabase migration list --linked` shows local and remote `20260724000001`. Supabase read-only `supabase_migrations.schema_migrations` query returned `orch_0931_realtime_broadcast_session_updated`. |
| Trigger function exists | PASS | Read-only `pg_proc` query found `public.notify_session_updated_via_broadcast()` with `SECURITY DEFINER`, guarded `deck_version` / `deck_params_hash` / `participant_prefs` checks, and `realtime.send(..., 'session_updated', 'board_session:' || NEW.id, true)`. |
| Trigger exists | PASS | Read-only `pg_trigger` query found `tr_collaboration_sessions_broadcast_session_updated AFTER UPDATE OF deck_version, deck_params_hash, participant_prefs ON public.collaboration_sessions`. |
| Participant-only RLS policy exists | PASS structural | Read-only `pg_policies` query found `session_participants_can_receive_board_session_broadcasts` on `realtime.messages`, `FOR SELECT TO authenticated`, with `extension='broadcast'`, `topic LIKE 'board_session:%'`, and `is_session_participant(..., auth.uid())`. |
| Anonymous denial | PASS live | Anonymous `@supabase/supabase-js` private subscribe to `board_session:daadd454-...` returned `CHANNEL_ERROR` with `Unauthorized: You do not have permissions to read from this Channel topic...`, then `CLOSED`. |
| Client uses private broadcast | PASS structural | `app-mobile/src/services/realtimeService.ts:414-415` constructs `supabase.channel(channelName, { config: { private: true } })`; lines 727-737 register `.on("broadcast", { event: "session_updated" }, ...)` and dispatch `onSessionUpdated`. |
| Client reloads session after signal | PASS structural | `app-mobile/src/hooks/useBoardSession.ts:331-343` logs `onSessionUpdated`, merges payload, then calls `void loadSession(capturedSessionId)`. |
| Local service regression tests | PASS | Focused compile/run passed T-IMP-1..4: private channel, broadcast replacement, payload dispatch, `loadSession` contract. |
| Strict-grep script local run | PASS local only | `node .github/scripts/strict-grep/i-proposed-orch-0931-no-pk-filter-realtime.mjs` scanned `958 files`, `64 postgres_changes listeners`, `0 violations`. |
| Strict-grep self-test | PASS local only | `node --test .github/scripts/strict-grep/i-proposed-orch-0931-no-pk-filter-realtime.test.mjs` passed 2/2 tests. |
| Scoped lint | PASS with warnings | `npx eslint src/services/realtimeService.ts src/hooks/useBoardSession.ts src/services/__tests__/realtimeService.orch-0931.test.ts` exited 0 with 4 pre-existing warnings in `useBoardSession.ts`. |
| Full app typecheck | FAIL unrelated/pre-existing | `npx tsc --noEmit` still fails in unrelated `BoardDiscussion.tsx`, `LockedPlanBanner.tsx`, `TicketCartSheet.tsx`, `nativeCheckoutFlow.ts`, and package typings. |

## SC-1..SC-12 Matrix

| SC | Verdict | Evidence / gap |
|---|---|---|
| SC-1 broadcast receipt within 2s | FAIL / unverified | No controlled post-migration two-device event. Current Metro: `0` `broadcast session_updated`, `0` `onSessionUpdated fired`. |
| SC-2 cache invalidation + refetch after broadcast | FAIL / unverified | Metro has invalidation/refetch logs, but none are causally tied to `broadcast session_updated` because broadcast/onSessionUpdated logs are absent. |
| SC-3 dead-end heals when aggregation non-empty | NOT VERIFIED | No controlled before/after UI run after migration. |
| SC-4 anon denial | PASS | Anonymous private subscribe returned `CHANNEL_ERROR Unauthorized`. |
| SC-5 non-participant denial | PARTIAL | RLS policy is structurally correct; no third authenticated non-participant live attempt was run. |
| SC-6 no noise broadcast | NOT VERIFIED | Would require a controlled non-deck UPDATE. I did not mutate live data via SQL. |
| SC-7 payload shape | PARTIAL | Function builds required payload shape; no actual `realtime.messages` `session_updated` row was available to inspect. |
| SC-8 strict-grep CI gate | FAIL | Script/test pass locally but workflow job is missing. |
| SC-9 implementor regression test | PASS | Focused T-IMP-1..4 run passed. |
| SC-10 chat/presence/messages no regression | FAIL / unverified | No two-device smoke after channel privacy change; Android unavailable. |
| SC-11 DELETE TODO | PASS structural | `app-mobile/src/services/realtimeService.ts:746-748` documents the known-dead PK-filter DELETE binding pending follow-up. |
| SC-12 migration applied cleanly | PASS | Linked migration history includes `20260724000001` locally and remotely. |

## Command Evidence

```text
node .github/scripts/strict-grep/i-proposed-orch-0931-no-pk-filter-realtime.mjs
I-PROPOSED-ORCH-0931-NO-PK-FILTER-REALTIME: scanned 958 files, 64 postgres_changes listeners, 0 violations
```

```text
node --test .github/scripts/strict-grep/i-proposed-orch-0931-no-pk-filter-realtime.test.mjs
2 tests passed, 0 failed
```

```text
npx tsc /tmp/orch-0931-globals.d.ts src/services/realtimeService.ts src/services/__tests__/realtimeService.orch-0931.test.ts ... && node ...
PASS T-IMP-1 - board_session channel is private
PASS T-IMP-2 - broadcast replaces PK-filtered session UPDATE
PASS T-IMP-3 - broadcast dispatches payload
PASS T-IMP-4 - useBoardSession reloads session after broadcast
```

```text
adb devices -l
List of devices attached
```

```text
/tmp/expo_metro.log counts
broadcast session_updated: 0
onSessionUpdated fired: 0
collab params changed, invalidating deck-cards: 28
success deck-cards.collab: 50
CHANNEL_ERROR: 2
```

## Rework Requirements

1. Add ORCH-0931 strict-grep workflow registration in `.github/workflows/strict-grep-mingla-business.yml`.
2. Produce controlled live-fire evidence after the migration is applied:
   - iOS participant A and iOS participant B on the same session.
   - Android participant A and Android participant B, or at minimum Android as receiver on the same session.
   - A qualifying UI/RPC preference change that bumps `deck_version` / `deck_params_hash`.
   - Receiver logs within 2s: `broadcast session_updated`, `onSessionUpdated fired`, `collab params changed, invalidating deck-cards`, and a subsequent `success deck-cards.collab.<sessionId>.<position>`.
3. Verify a third authenticated non-participant cannot receive the private broadcast.
4. Verify chat/presence/message smoke on the same private channel: `board_message`, typing start/stop, presence update, saved card/vote/RSVP/card-message delivery.
5. If direct DB adversarial checks are needed for SC-6/SC-7, use a fresh approved test fixture session, not the protected `daadd454-...` session, and record the exact operator approval path.

## Next Handoff

NEXT HANDOFF — paste into Codex `implementor-mingla`:

Codex `tester-mingla` returned **FAIL** for ORCH-0931 in `Mingla_Artifacts/reports/QA_ORCH-0931_REALTIME_BROADCAST_SESSION_UPDATED.md`; rework on the implementor side must add the missing `.github/workflows/strict-grep-mingla-business.yml` job for `.github/scripts/strict-grep/i-proposed-orch-0931-no-pk-filter-realtime.mjs` and then prepare/run the controlled live-fire proof for SC-1..SC-12. Inputs are `Mingla_Artifacts/specs/SPEC_ORCH-0931_REALTIME_BROADCAST_SESSION_UPDATED.md`, `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0931_REALTIME_BROADCAST_SESSION_UPDATED.md`, and this QA report; hard guards remain: do not weaken tests, do not mutate live `daadd454-35a8-487d-ab25-bb595abc4635` directly via SQL, do not push/open PR/merge, and do not apply migrations unless the operator explicitly owns the `supabase db push --linked` step. Expected output is a rework report with CI wiring evidence plus live iOS/Android broadcast receipt, cache invalidation/refetch, anon/non-participant denial, and chat/presence/message no-regression evidence. Downstream routing after rework is back to Codex `tester-mingla` for RETEST; Working tree: `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`.
