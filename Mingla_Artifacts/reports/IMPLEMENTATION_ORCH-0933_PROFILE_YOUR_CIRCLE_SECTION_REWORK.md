# Implementation Report: Profile "Your Circle" Rework (ORCH-0933)

> Date: 2026-05-23
> Mode: Rework
> Spec: `Mingla_Artifacts/specs/SPEC_ORCH-0933_PROFILE_YOUR_CIRCLE_SECTION.md`
> QA source: `Mingla_Artifacts/reports/QA_ORCH-0933_PROFILE_YOUR_CIRCLE_SECTION.md`
> Status: implemented, partially verified

## 1. Layman Summary

The rework fixes the two QA-blocking defects in source: the `get_user_circle` SQL no longer collides with the `RETURNS TABLE user_id` output column, and Circle avatar taps now use the app-level friend-profile overlay so the profile Message button performs the canonical DM handoff into Connections. Runtime is still blocked until the operator applies the new monotonic migration `20260724000003_orch_0933_get_user_circle_rpc_ambiguity_fix.sql`; the linked DB already has the bad `20260724000002` migration marked applied, so editing that file alone cannot repair live.

## 2. Request And Context

- **Request:** Rework ORCH-0933 QA FAIL without weakening happy tests, strict-grep, or adding duplicate state owners.
- **Source:** User-dispatched `$implementor` rework prompt from `QA_ORCH-0933_PROFILE_YOUR_CIRCLE_SECTION.md`.
- **Affected surfaces:** Consumer mobile Profile/Circle section, app-level friend profile overlay handoff, Supabase RPC migration chain, adversarial regression.
- **Related artifacts:** Original implementation report `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0933_PROFILE_YOUR_CIRCLE_SECTION.md`; iOS runtime screenshot `/Users/sethogieva/Desktop/Simulator Screenshot - iPhone 17 - 2026-05-23 at 06.38.48.png`; Android runtime screenshot `/Users/sethogieva/Desktop/Screenshot_1779532772.png`.

## 3. Scope

- **In scope:** Fix ambiguous SQL, add deployable follow-up migration because `0002` is already applied, route Circle avatar profile opens through the canonical app owner, harden adversarial test, rerun focused gates.
- **Out of scope:** Running `supabase db push`, mutating live DB directly, fixing purchase-to-circle invalidation P2, closing invariant registry entries, broad app lint debt.
- **Assumptions:** Operator deploy authority remains explicit; Codex must not apply the migration unless reassigned with deploy permission.

## 4. Files Read

| File | Why | Relevant finding |
|---|---|---|
| `Mingla_Artifacts/reports/QA_ORCH-0933_PROFILE_YOUR_CIRCLE_SECTION.md` | Rework source | P1 SQL ambiguity and P1 local modal Message behavior were the blockers. |
| `Mingla_Artifacts/specs/SPEC_ORCH-0933_PROFILE_YOUR_CIRCLE_SECTION.md` | Contract | Avatar tap must open existing `ViewFriendProfileScreen` mechanism; DB owns graph truth. |
| `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0933_PROFILE_YOUR_CIRCLE_SECTION.md` | Prior implementation | Noted local modal assumption and no DB push. |
| `app-mobile/app/index.tsx` | Canonical handoff | Existing overlay closes profile, sets `pendingOpenDmUserId`, switches to Connections. |
| `app-mobile/src/components/ProfilePage.tsx` | Circle mount/caller | Needed a callback prop to app-level owner. |
| `app-mobile/src/components/profile/circle/YourCircleSection.tsx` | Local state owner | Local modal owned profile state and only dismissed on Message. |
| `supabase/migrations/20260724000002_orch_0933_get_user_circle_rpc.sql` | Failed RPC | `SELECT user_id FROM consumer_users/dual_app_users` collided with output `user_id`. |
| `app-mobile/src/components/profile/circle/__tests__/YourCircleSection.adversarial.test.tsx` | Tester regression | Needed to pass after SQL fix and guard app-level profile ownership. |

## 5. Blast Radius

- **Direct changes:** `get_user_circle` SQL body, new monotonic replacement migration, `YourCircleSection`, `ProfilePage`, `app/index.tsx`, adversarial test, Maestro launch probe.
- **Cascade changes:** Circle avatar taps now enter the already-existing `viewingFriendProfileId` overlay; Message inherits the existing DM handoff.
- **Parity surfaces:** Shared RN path for iOS/Android; iOS launch saw `Your Circle`, Android Maestro driver remains unavailable.
- **Cache impact:** None beyond prior ORCH-0933 `circleKeys` work.
- **State boundaries:** Removed duplicate local profile state owner from Circle; app-level overlay owns friend-profile truth.
- **Auth/RLS/security:** RPC still rejects caller mismatch with `42501`; ambiguity fix does not weaken auth.
- **Deploy path:** Operator must apply `20260724000003_orch_0933_get_user_circle_rpc_ambiguity_fix.sql`; no edge deploy.

## 6. Old To New Receipts

### `supabase/migrations/20260724000002_orch_0933_get_user_circle_rpc.sql`

- **Before:** Final select used unqualified `SELECT user_id FROM dual_app_users` and `SELECT user_id FROM consumer_users`.
- **After:** Both CTE references are qualified as `dau.user_id` and `cu.user_id`.
- **Why:** PL/pgSQL output columns are variables; unqualified `user_id` was ambiguous.
- **Approx lines changed:** 2.

### `supabase/migrations/20260724000003_orch_0933_get_user_circle_rpc_ambiguity_fix.sql`

- **Before:** Linked DB migration list already showed `20260724000002` applied, so source-only edits to `0002` would not reach live.
- **After:** Added monotonic `CREATE OR REPLACE FUNCTION public.get_user_circle(...)` with the qualified CTE references.
- **Why:** Gives the operator-controlled migration path a real pending migration to apply.
- **Approx lines changed:** New 179-line migration.

### `app-mobile/src/components/profile/circle/YourCircleSection.tsx`

- **Before:** Owned `selectedUserId`, rendered a local full-screen `Modal`, and passed `onMessage={() => setSelectedUserId(null)}`.
- **After:** Accepts `onViewProfile`, calls it from avatar press, and no longer imports/renders `ViewFriendProfileScreen` or `Modal`.
- **Why:** Prevents a duplicate profile state owner and allows Message to use the canonical app-level DM handoff.
- **Approx lines changed:** 20.

### `app-mobile/src/components/ProfilePage.tsx`

- **Before:** Circle section had no way to bubble avatar taps to app-level overlay owner.
- **After:** Adds `onViewFriendProfile?: (userId: string) => void` and passes it into `YourCircleSection`.
- **Why:** Keeps Profile page as a pass-through, not a new state owner.
- **Approx lines changed:** 3 in rework plus prior ORCH-0933 mount.

### `app-mobile/app/index.tsx`

- **Before:** Canonical profile overlay existed, but Profile/Circle did not use it.
- **After:** Both ProfilePage render paths pass `onViewFriendProfile={handleViewFriendProfile}`.
- **Why:** Circle avatar tap now opens the same overlay whose Message action closes profile, sets `pendingOpenDmUserId`, and navigates to Connections.
- **Approx lines changed:** 2.

### `app-mobile/src/components/profile/circle/__tests__/YourCircleSection.adversarial.test.tsx`

- **Before:** Covered SQL ambiguity and service invariants, but not the modal Message regression.
- **After:** Also asserts Circle does not import/render local `ViewFriendProfileScreen`/`Modal`, passes through `onViewProfile`, and app-level Message handoff remains present.
- **Why:** Regression test would fail on the shipped Message bug.
- **Approx lines changed:** 23.

## 7. Implementation Details

- **Architecture decisions:** The DB remains the sole graph owner. The app-level overlay remains the sole friend-profile owner.
- **Data flow:** Avatar press -> `YourCircleSection.onViewProfile` -> `ProfilePage.onViewFriendProfile` -> `app/index.tsx handleViewFriendProfile` -> canonical `ViewFriendProfileScreen`.
- **Mutation/query behavior:** No query-key changes in rework.
- **State handling:** Removed Circle-local profile modal state.
- **Error handling:** The screenshot confirms live still errors until migration `0003` is applied; no client-side masking was added.
- **Copy/accessibility:** No copy changes.
- **Analytics/notifications/realtime:** Not touched.

## 8. Spec / Goal Traceability

| Criterion / goal | Implemented | Verification | Status |
|---|---|---|---|
| Fix SQLSTATE `42702` source cause | Yes | Local migration source and adversarial test confirm no unqualified CTE `user_id` remains | PASS source |
| Make fix deployable after `0002` applied | Yes | New monotonic `20260724000003` migration exists after remote-applied `0002` | PASS source |
| Preserve `42501` impersonation guard | Yes | Live mismatched caller direct query returned `42501`; migration source unchanged | PASS |
| Blocked/business-only/dual-app/tier precedence live proof | Source-ready | Blocked by no deploy authority and live DB still on old function | BLOCKED pending operator migration |
| Fix Circle avatar Message behavior | Yes | Circle routes to app-level overlay; adversarial test guards no local modal owner | PASS source |
| Do not weaken happy test | Yes | Happy test unchanged; `git diff -- happy.test.tsx` empty | PASS |
| Do not bypass strict grep | Yes | Both strict-grep scripts pass | PASS |
| Do not add duplicate state owners | Yes | Removed local modal/profile state from Circle | PASS |

## 9. Invariant Verification

| Invariant | Relevant | Preserved | Notes |
|---|---|---|---|
| RPC-SOLE-OWNER | Yes | Yes | Strict grep passed; service still calls only `get_user_circle`. |
| NO-IMPERSONATION | Yes | Yes | Live mismatch returned SQLSTATE `42501`. |
| BLOCKED-EXCLUDED | Yes | Source yes | Live proof blocked until `0003` is applied. |
| BADGE-MEANS-DUAL-APP | Yes | Yes | Strict grep and adversarial test pass. |
| TIER-DETERMINISTIC | Yes | Yes | Service adversarial duplicate-tier test passes. |
| ONE-OWNER-PER-TRUTH | Yes | Yes | App overlay owns friend profile; Circle only emits intent. |

## 10. Parity Check

- **Mobile:** iOS launch probe passed and hierarchy showed `Your Circle`; Android operator screenshot shows Profile renders `Your Circle` and the in-card error state/toast from the same live RPC ambiguity; Android Maestro still fails before app interaction with `io.grpc.StatusRuntimeException: UNAVAILABLE` / `tcp:7001 closed`.
- **Business app:** Not touched.
- **Admin:** Not touched.
- **Public/web:** Not touched.
- **Solo/collab:** Consumer Profile only; no collab state touched.
- **Gaps:** iOS and Android end-to-end avatar -> profile -> Message parity requires migration `0003` applied first. Android also needs Maestro driver repair.

## 11. Cache And Persisted State Safety

- **Query keys changed:** None in rework.
- **Invalidations added:** None in rework.
- **Data shape changes:** None.
- **AsyncStorage/Zustand impact:** None.
- **Cold start behavior:** Unchanged from prior ORCH-0933 implementation.

## 12. Verification

| Check | Command / method | Result | Notes |
|---|---|---|---|
| Happy regression | `node app-mobile/src/components/profile/circle/__tests__/YourCircleSection.happy.test.tsx` | PASS | Printed `PASS ORCH-0933 YourCircleSection happy-path regression`. |
| Adversarial regression | `node app-mobile/src/components/profile/circle/__tests__/YourCircleSection.adversarial.test.tsx` | PASS | Now also covers app-level profile owner handoff. |
| Happy fails-on-revert | `ORCH0933_SIMULATE_ROW_MAJOR=1 node app-mobile/src/components/profile/circle/__tests__/YourCircleSection.happy.test.tsx` | FAIL as expected | Asserted row-major order mismatch. |
| Strict grep RPC owner | `bash .github/scripts/strict-grep/circle-rpc-sole-owner.sh` | PASS | Printed `PASS: G-CIRCLE-RPC-SOLE-OWNER`. |
| Strict grep badge | `bash .github/scripts/strict-grep/circle-badge-dual-app.sh` | PASS | Printed `PASS: G-CIRCLE-BADGE-DUAL-APP`. |
| Focused lint | `npx eslint src/components/profile/circle src/hooks/useUserCircle.ts src/services/circleService.ts --max-warnings=0` | PASS | Circle-owned lint gate clean. |
| Focused TypeScript filter | `npx tsc --noEmit --pretty false 2>&1 \| rg "circle\|useUserCircle\|circleService\|ProfilePage\|app/index\|queryKeys" \|\| true` | PASS filter | No filtered ORCH-0933 output. |
| Broader lint including app/index/ProfilePage | `npx eslint src/components/profile/circle src/hooks/useUserCircle.ts src/services/circleService.ts src/components/ProfilePage.tsx app/index.tsx --max-warnings=0` | FAIL baseline warnings | 0 errors, 62 warnings in legacy large files; scoped circle lint passed. |
| Live function definition | `supabase db query --linked "select pg_get_functiondef(...get_user_circle...)"` | FAIL live state confirmed | Live body still has unqualified `SELECT user_id`; expected until `0003` is applied. |
| Live `42501` mismatch | Direct linked query with caller `ac7f...` and requested `c727...` | PASS | Returned `ERROR: 42501 get_user_circle: unauthorized`. |
| Live authorized call | Direct linked query with caller/requested `ac7f...`; iOS/Android runtime screenshots | BLOCKED/FAIL live state | iOS screenshot shows `column reference "user_id" is ambiguous`; Android screenshot shows Circle error card/toast for the same query path; linked DB auth later rate-limited temp-role connections. |
| iOS Maestro launch | `maestro --device F7ECAC25... test orch0933_launch_probe.yaml` + hierarchy grep | PARTIAL PASS | App launched; hierarchy included `Your Circle`, but live RPC redbox remains until migration. |
| Android Maestro launch | `maestro --device emulator-5554 test orch0933_launch_probe.yaml` | BLOCKED | Fails before app interaction with `tcp:7001 closed`, even after `adb kill-server && adb start-server`. |
| Android operator screenshot | `/Users/sethogieva/Desktop/Screenshot_1779532772.png` | PARTIAL PASS / FAIL live state | Confirms Android Profile reaches Your Circle and displays the expected error state while live RPC remains unpatched. |

## 13. Regression Surface

1. Friend-profile overlay entry points: Circle now uses the app-level owner already used by Discover/Connections.
2. Supabase migration sequencing: remote already has `0002`; `0003` must be included in any deploy/retest.
3. Runtime Profile visibility: while live DB is unpatched, Circle still redboxes in development instead of rendering content.

## 14. Risks, Limitations, Transition Items

| Item | Risk / temporary state | Exit condition | Location |
|---|---|---|---|
| `0003` not applied | Runtime continues to fail exactly as screenshot shows | Operator applies migration, then live authorized/blocked/business-only/dual-app/tier checks pass | `supabase/migrations/20260724000003_orch_0933_get_user_circle_rpc_ambiguity_fix.sql` |
| Android Maestro driver unavailable | Cannot prove Android parity/perf | Fix Maestro/ADB driver `tcp:7001 closed`, rerun parity | Emulator `emulator-5554` |
| Supabase CLI temp-role auth rate limit | Authorized linked query could not be rerun after retries | Wait for circuit breaker to clear and/or set correct `SUPABASE_DB_PASSWORD` | Linked Supabase CLI |
| Purchase invalidation P2 | Not fixed in this rework | Operator follow-up decision | Checkout/native purchase paths |

## 15. Discoveries For Orchestrator

- Linked dev DB already lists `20260724000002` as applied, so the rework necessarily needs a follow-up `20260724000003` migration. This is why the iOS and Android screenshots still show the old live error after source edits.
- Maestro Android remains blocked by the same driver-level `tcp:7001 closed` failure found by tester.

## 16. Deploy Notes

- **Migrations:** Apply `supabase/migrations/20260724000003_orch_0933_get_user_circle_rpc_ambiguity_fix.sql`. Codex did not run `supabase db push`.
- **Post-migration live checks:** Rerun authorized viewer, mismatched `42501`, blocked exclusion, business-only exclusion, dual-app truth, and tier precedence against linked DB.
- **Edge functions:** None.
- **Mobile OTA/native:** JS/TS only; no native dependency change.
- **Business/admin web:** Not touched.
- **Env vars/secrets:** Supabase CLI reported temp-role auth failures after several linked DB attempts; ensure `SUPABASE_DB_PASSWORD` is correct if using direct linked CLI queries.

## Suggested Commit Message

```text
profile: rework your circle rpc and profile handoff

Resolves: ORCH-0933 rework
Evidence: happy/adversarial circle tests, strict-grep gates, focused lint
Deploy: operator applies 20260724000003 Supabase migration before live RPC retest
```

## Ready-To-Test Checklist

1. Operator applies `20260724000003_orch_0933_get_user_circle_rpc_ambiguity_fix.sql`.
2. Rerun direct live RPC checks for authorized call, mismatched `42501`, blocked exclusion, business-only exclusion, dual-app truth, and tier precedence.
3. On iOS, dismiss the current redbox after migration, open Profile, confirm Your Circle loads, tap avatar, tap Message, and confirm Connections DM opens.
4. On Android, after migration, reopen Profile and confirm the current error card/toast in `/Users/sethogieva/Desktop/Screenshot_1779532772.png` is replaced by loaded Circle avatars; tap avatar -> Message and verify Connections DM opens.
5. Repair Android Maestro driver, then run automated Profile -> Your Circle -> avatar -> Message parity plus 60+ avatar horizontal scroll.
