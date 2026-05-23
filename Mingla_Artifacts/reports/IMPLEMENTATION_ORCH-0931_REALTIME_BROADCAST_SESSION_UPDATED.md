# Implementation Report: Realtime Broadcast `session_updated` (ORCH-0931)

> Date: 2026-05-23
> Mode: Spec Execute
> Spec: `Mingla_Artifacts/specs/SPEC_ORCH-0931_REALTIME_BROADCAST_SESSION_UPDATED.md`
> Status: implemented, partially verified

## 1. Layman Summary

Mingla now has the scoped ORCH-0931 broadcast path for collab session deck updates. Instead of relying on the silently-dropped `postgres_changes` primary-key filter, Postgres will broadcast a small `session_updated` signal to `board_session:<sessionId>`, mobile clients subscribe to that private broadcast, and `useBoardSession` reloads the session so participant prefs and deck hash changes propagate.

## 2. Request And Context

- **Request:** Implement the ORCH-0931 SPEC after mandatory ingest, without applying the migration, pushing, opening PRs, or mutating the live `daadd454-...` test session.
- **Source:** `Mingla_Artifacts/specs/SPEC_ORCH-0931_REALTIME_BROADCAST_SESSION_UPDATED.md` and `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0931_REALTIME_POSTGRES_CHANGES_SILENT_BINDING_DROP.md`.
- **Affected surfaces:** Consumer mobile iOS/Android shared realtime path; Postgres migration/RLS; strict-grep CI gate script.
- **Related artifacts:** `Mingla_Artifacts/PRODUCT_DIRECTION_COLLAB_SESSIONS_IN_CHAT.md` Contract-5 carve-out note.

## 3. Scope

- **In scope:** One migration, `realtimeService.ts` board-session subscription surgery, `useBoardSession.ts` reload dispatch, one ORCH-0931 service regression test file, one strict-grep gate plus test.
- **Out of scope:** Applying migrations, live SQL mutation, EAS deploy, PR/push/merge, migrating other known `id=eq.*` filters.
- **Assumptions:** Operator will apply the migration later with `supabase db push --linked`; tester will run live two-device iOS/Android SC-1..SC-12.

## 4. Files Read

| File | Why | Relevant finding |
|---|---|---|
| `SPEC_ORCH-0931_REALTIME_BROADCAST_SESSION_UPDATED.md` | Contract | Requires broadcast replacement, private channel, migration, tests, strict-grep, report. |
| `INVESTIGATION_ORCH-0931_REALTIME_POSTGRES_CHANGES_SILENT_BINDING_DROP.md` | Root cause | `id=eq.<UUID>` realtime bindings are silently not persisted. |
| `PRODUCT_DIRECTION_COLLAB_SESSIONS_IN_CHAT.md` | Product carve-out | Contract 5 normally avoids backend changes; this SPEC is a justified carve-out. |
| `app-mobile/src/services/realtimeService.ts` | Service owner | Board-session UPDATE used broken PK filter; other PK filters are explicit non-goals. |
| `app-mobile/src/hooks/useBoardSession.ts` | Consumer owner | Old callback expected full `participant_prefs`; broadcast payload is intentionally small. |
| `.github/scripts/strict-grep/*` | Gate pattern | Repo uses standalone Node gates plus companion Node tests. |

## 5. Blast Radius

- **Direct changes:** `board_session:<sessionId>` subscription now joins private channel and listens for `broadcast/session_updated`.
- **Cascade changes:** `onSessionUpdated` still fires, then `useBoardSession` calls `loadSession(capturedSessionId)` to refresh prefs from Postgres.
- **Parity surfaces:** iOS and Android share the same React Native service/hook path.
- **Cache impact:** No query keys changed. Existing ORCH-0923 params-change invalidation should fire after `loadSession` updates session hash/version state.
- **State boundaries:** Server truth remains in Postgres; broadcast payload is not persisted to Zustand/AsyncStorage.
- **Auth/RLS/security:** Migration enables SELECT-only participant RLS on `realtime.messages` for private broadcasts.
- **Deploy path:** Operator applies migration first; client update ships after close via normal mobile release path.

## 6. Old To New Receipts

### `supabase/migrations/20260724000001_orch_0931_realtime_broadcast_session_updated.sql`

- **Before:** No trigger-driven broadcast path for `collaboration_sessions` deck-affecting updates.
- **After:** Adds `notify_session_updated_via_broadcast()`, trigger `tr_collaboration_sessions_broadcast_session_updated`, RLS policy `session_participants_can_receive_board_session_broadcasts`, and comments.
- **Why:** Bypasses the broken realtime subscription persistence path for PK filters.
- **Migration ordering receipt:** Local max and remote max were both `20260724000000`; new file uses monotonic `20260724000001`.

### `app-mobile/src/services/realtimeService.ts`

- **Before:** `subscribeToBoardSession` registered `postgres_changes` UPDATE on `collaboration_sessions` with `filter: id=eq.${sessionId}`.
- **After:** The same channel is private and registers `.on("broadcast", { event: "session_updated" }, ...)`, dispatching `onSessionUpdated(data)`.
- **Why:** The old binding reaches SUBSCRIBED but delivers no events.
- **Residual:** The DELETE `id=eq.${sessionId}` binding remains with a TODO because the SPEC explicitly made it a follow-up.

### `app-mobile/src/hooks/useBoardSession.ts`

- **Before:** `onSessionUpdated` attempted to read full `updatedSession.participant_prefs`.
- **After:** It merges the small payload and calls `void loadSession(capturedSessionId)` to fetch fresh `participant_prefs`.
- **Why:** Broadcast payload intentionally excludes full JSONB prefs.

### `app-mobile/src/services/__tests__/realtimeService.orch-0931.test.ts`

- **Before:** No ORCH-0931 regression coverage.
- **After:** Adds T-IMP-1..4 for private channel config, broadcast registration, dispatch payload, and hook reload contract.

### `.github/scripts/strict-grep/i-proposed-orch-0931-no-pk-filter-realtime.mjs` + `.test.mjs`

- **Before:** No CI guard for PK-filter realtime regressions.
- **After:** Adds a strict-grep gate that fails new PK-filter `postgres_changes` subscriptions and tests two positive fixtures plus non-PK/broadcast negative fixture.
- **Note:** The gate baselines current non-goal PK filters because this dispatch explicitly forbade migrating them in this PR.

## 7. Implementation Details

- **Architecture decisions:** Use private broadcast on existing topic `board_session:<sessionId>`; keep other channel bindings unchanged.
- **Data flow:** DB UPDATE -> trigger guard -> `realtime.send(payload, 'session_updated', topic, true)` -> mobile broadcast handler -> `onSessionUpdated` -> `loadSession`.
- **State handling:** `setSession` receives the small payload immediately; full prefs refresh comes from `loadSession`.
- **Error handling:** Trigger relies on `realtime.send` warning behavior so realtime outages do not block the source UPDATE.
- **Realtime:** No `createClient({ accessToken })` introduced.

## 8. Spec / Goal Traceability

| Criterion / goal | Implemented | Verification | Status |
|---|---|---|---|
| §3.1 migration function/trigger/RLS | Yes | File inspection + monotonic migration check | Implemented, not applied |
| §3.2.1 replace UPDATE binding | Yes | T-IMP-2, fails-on-revert | Verified locally |
| §3.2.2 loadSession after broadcast | Yes | T-IMP-4 structural regression | Verified locally |
| §3.2.3 private channel | Yes | T-IMP-1 | Verified locally |
| §3.2.4 DELETE TODO only | Yes | Diff inspection | Verified locally |
| §5 strict-grep gate | Yes | Gate + Node test pass | Verified locally |
| §6 T-IMP-1..4 | Yes | Focused compiled Node run | Verified locally |
| SC-1..SC-12 live behavior | No | Requires operator migration apply + tester sims | Pending tester |

## 9. Invariant Verification

| Invariant | Relevant | Preserved | Notes |
|---|---|---|---|
| I-PROPOSED-J | Yes | Yes | Broadcast carries IDs/metadata only; no persisted full row. |
| ORCH-0902 deterministic deck | Yes | Yes | Trigger fires downstream of deck hash/version updates. |
| ORCH-0909 positional shared deck | Yes | Yes | Deck data still refetched from existing paths. |
| Constitutional #3 no silent failures | Yes | Partial | Delivery silent-drop fixed; realtime outage remains warning-only by design. |
| Constitutional #6 logout clears everything | Yes | Yes | Existing channel teardown unchanged. |
| I-AUTH-CB-01 | Yes | Yes | No auth callback changes. |
| I-PROPOSED-ORCH-0931-NO-PK-FILTER-REALTIME | New | Yes | Gate added with baseline for explicit non-goal residuals. |

## 10. Parity Check

- **Mobile:** Shared iOS/Android TS path updated.
- **Business app:** No code changed; strict-grep baseline notes one existing business PK filter outside this SPEC.
- **Admin:** No code changed.
- **Public/web:** No code changed.
- **Solo/collab:** Collab board session only; solo unchanged.
- **Gaps:** Live two-device verification pending migration apply.

## 11. Cache And Persisted State Safety

- **Query keys changed:** None.
- **Invalidations added:** None directly; existing ORCH-0923 invalidation should fire after session state refresh.
- **Data shape changes:** `onSessionUpdated` now receives `{ session_id, deck_version, deck_params_hash, updated_at }` instead of a full row for this path.
- **AsyncStorage/Zustand impact:** None.
- **Cold start behavior:** Initial `loadSession` path unchanged.

## 12. Verification

| Check | Command / method | Result | Notes |
|---|---|---|---|
| Migration ordering local | `ls supabase/migrations \| tail -8` | PASS | Local max before new file: `20260724000000`. |
| Migration ordering remote | `/Users/sethogieva/bin/supabase migration list --linked` | PASS | Remote max: `20260724000000`; no migration applied. |
| ORCH-0931 focused test | `cd app-mobile && npx tsc /tmp/orch-0931-globals.d.ts src/services/realtimeService.ts src/services/__tests__/realtimeService.orch-0931.test.ts --target es2020 --module commonjs --jsx react-jsx --esModuleInterop --skipLibCheck --outDir /tmp/orch-0931-test && node /tmp/orch-0931-test/services/__tests__/realtimeService.orch-0931.test.js` | PASS | T-IMP-1..4 all passed. |
| Fails-on-revert | Change event line to `session_update`, rerun focused test | PASS | Failed at T-IMP-2 with `expected broadcast session_updated registration`; HEAD hash `daee4cdcf2ff2a52f7a23d2b422f3c3affd8c7fa`. Restored. |
| Strict-grep gate | `node .github/scripts/strict-grep/i-proposed-orch-0931-no-pk-filter-realtime.mjs` | PASS | `958 files`, `64 postgres_changes listeners`, `0 violations`. |
| Strict-grep test | `node --test .github/scripts/strict-grep/i-proposed-orch-0931-no-pk-filter-realtime.test.mjs` | PASS | 2/2 tests passed. |
| Scoped lint | `cd app-mobile && npx eslint src/services/realtimeService.ts src/hooks/useBoardSession.ts src/services/__tests__/realtimeService.orch-0931.test.ts` | PASS with warnings | 0 errors; 4 existing warnings in `useBoardSession.ts`. |
| Full app typecheck | `cd app-mobile && npx tsc --noEmit` | FAIL unrelated | Existing errors in `BoardDiscussion.tsx`, `LockedPlanBanner.tsx`, packages path typings, Stripe PaymentSheet type. |
| Diff whitespace | `git diff --check -- <scoped files>` | PASS | No whitespace errors. |

## 13. Regression Surface

1. Board-session chat/presence/messages: same channel is now private; tester must verify SC-10.
2. Participant prefs refresh timing: `loadSession` round-trip replaces full-row realtime payload.
3. Private realtime auth: RLS policy must be live before client release.
4. Residual PK filters: follow-up ORCHs needed for `subscribeToSession`, `subscribeToBoard`, board-session DELETE, and business checkout status.

## 14. Risks, Limitations, Transition Items

| Item | Risk / temporary state | Exit condition | Location |
|---|---|---|---|
| Migration unapplied | Client broadcast path needs DB trigger/RLS live | Operator runs `supabase db push --linked` | `supabase/migrations/20260724000001_orch_0931_realtime_broadcast_session_updated.sql` |
| Gate baseline | Spec wanted empty allowlist, but hard guards forbade migrating known residuals | Follow-up ORCH migrates residual PK filters and removes baselines | strict-grep script |
| Workflow not edited | User hard "named files only" list did not include `.github/workflows/strict-grep-mingla-business.yml` | Orchestrator/operator approves a tiny workflow registration edit | CI wiring |
| Full typecheck red | Repo has unrelated pre-existing TS errors | Separate cleanup ORCH | app-mobile/packages |

## 15. Discoveries For Orchestrator

- The SPEC and dispatch conflict on strict-grep: SPEC §5 says scan app-mobile/business/admin with empty allowlist, while the dispatch forbids migrating known residual PK filters. I implemented a gate with explicit baseline for those residuals and documented this as a transition item.
- The workflow registration requested in SPEC §5 was not edited because the operator's file scope did not name `.github/workflows/strict-grep-mingla-business.yml`.

## 16. Deploy Notes

- **Migrations:** Operator-owned. Run `supabase db push --linked` from `/Users/sethogieva/Desktop/mingla-main` after review/close approval. Do not mutate the live `daadd454-...` test session directly.
- **Edge functions:** None changed; no deploy required.
- **Mobile OTA/native:** After migration apply and tester PASS, ship client via standard EAS update/release process.
- **Business/admin web:** None.
- **Env vars/secrets:** None.

## Suggested Commit Message

```text
realtime: broadcast collab session deck updates

Resolves: ORCH-0931
Evidence: IMPLEMENTATION_ORCH-0931_REALTIME_BROADCAST_SESSION_UPDATED.md
Deploy: operator runs supabase db push --linked before mobile release
```

## Ready-To-Test Checklist

1. Operator applies `supabase db push --linked`; confirm migration history includes `20260724000001`.
2. Tester runs two-device iOS + Android SC-1..SC-12, especially broadcast receipt within 2 seconds and cache invalidation/refetch.
3. Tester verifies anon/non-participant private channel denial.
4. Tester smoke-tests board-session chat, presence, saved cards, votes, RSVPs, and card messages on the same private channel.
