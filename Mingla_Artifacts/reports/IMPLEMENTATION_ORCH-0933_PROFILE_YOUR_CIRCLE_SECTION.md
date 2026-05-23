# Implementation Report: Profile "Your Circle" Social Graph Section (ORCH-0933)

> Date: 2026-05-23
> Mode: Spec Execute
> Spec: `Mingla_Artifacts/specs/SPEC_ORCH-0933_PROFILE_YOUR_CIRCLE_SECTION.md`
> Status: implemented, partially verified

## 1. Layman Summary

The Profile screen now has a fixed-height "Your Circle" card below "Your Interests" that shows people from the viewer's social graph in a 3-row, horizontally scrolling avatar grid. The section reads only from the new `get_user_circle` RPC, so friends, pairings, co-attendees, consumer-app filtering, blocked-user exclusion, and dual-app badge truth are owned by the database instead of client-side table stitching.

## 2. Request And Context

- **Request:** Implement ORCH-0933 per spec, keep circle data in React Query, add RPC + section + regression + strict-grep gates, and do not run `supabase db push`.
- **Source:** User-dispatched `$implementor` prompt against `SPEC_ORCH-0933_PROFILE_YOUR_CIRCLE_SECTION.md`.
- **Affected surfaces:** Consumer mobile Profile screen on iOS and Android; Supabase migration file; CI strict-grep workflow.
- **Related artifacts:** Spec path above; report path `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0933_PROFILE_YOUR_CIRCLE_SECTION.md`.

## 3. Scope

- **In scope:** RPC migration, React Query data path, Profile section UI, circle pagination, avatar rings, dual-app badge, social mutation invalidation, happy-path regression test, strict-grep gates.
- **Out of scope:** Applying migrations, deploying edge functions, business/admin/web parity, tester adversarial test, iOS/Android simulator parity, invariant registry update at CLOSE.
- **Assumptions:** Local/remote migration heads require a monotonic `20260724000002` prefix. The Profile screen can compose `ViewFriendProfileScreen` locally in a full-screen modal without adding a new route.

## 4. Files Read

| File | Why | Relevant finding |
|---|---|---|
| `app-mobile/src/components/ProfilePage.tsx` | Mount point | Interests card ends at the expected slot; circle card now mounts before stats. |
| `supabase/migrations/20260505000000_baseline_squash_orch_0729.sql` | Schema truth | `friends`, `pairings`, `orders`, `profiles`, `event_dates.start_at/end_at` confirmed. |
| `supabase/migrations/20260601000000_orch_0808_appsflyer_devices_app_discriminator.sql` | Consumer/business app signal | `appsflyer_devices.app` and `idx_appsflyer_devices_user_id_app` confirmed. |
| `supabase/migrations/20260605000000_orch_0826_events_event_type_discriminator.sql` | Event/trip discriminator | `events.event_type` confirmed; RPC filters co-attendance to `event` and `trip`. |
| `app-mobile/src/hooks/useFriends.ts`, `usePairings.ts`, `useNotifications.ts` | Invalidation owners | Friend/pair accept/remove/block paths now invalidate `circleKeys.all`. |
| `app-mobile/app/index.tsx` | Existing profile navigation | Existing caller composes `ViewFriendProfileScreen`; section uses the same screen, without adding a route. |
| `app-mobile/src/constants/designSystem.ts`, `colors.ts` | UI pre-flight | Ring tokens selected from existing palette only. |

## 5. Blast Radius

- **Direct changes:** One migration, Profile mount, new circle UI/service/hook/types, query key, social invalidations, CI gates, regression test.
- **Cascade changes:** Profile renders one extra `GlassCard`; social mutations refetch circle cache.
- **Parity surfaces:** Shared React Native path covers iOS and Android; no web/business/admin path touched.
- **Cache impact:** New `circleKeys` family, infinite query staleTime 5 min, gcTime 30 min.
- **State boundaries:** Circle people stay in React Query only. No Zustand or AsyncStorage server snapshot was added.
- **Auth/RLS/security:** RPC is `SECURITY DEFINER`, checks `auth.uid() = p_viewer_user_id`, excludes blocked users, filters consumer-app users.
- **Deploy path:** Operator must run migration push. No edge deploy required.

## 6. Old To New Receipts

### `supabase/migrations/20260724000002_orch_0933_get_user_circle_rpc.sql`

- **Before:** No RPC-owned circle graph path.
- **After:** Adds `get_user_circle(p_viewer_user_id, p_limit, p_offset)` plus missing `idx_friends_friend_user_id_status`.
- **Why:** RLS prevents client-side friends-of-friends and co-attendee composition.
- **Receipt:** Migration prefix is greater than local `20260724000001` and remote `20260724000000`; remote showed local `20260724000001` pending before this work.

### `app-mobile/src/components/ProfilePage.tsx`

- **Before:** Profile order was Hero -> Interests -> Stats -> Account.
- **After:** Profile order is Hero -> Interests -> Your Circle -> Stats -> Account.
- **Why:** SC-01 mount contract.

### `app-mobile/src/components/profile/circle/*`

- **Before:** No Profile circle section.
- **After:** Added `YourCircleSection`, `CircleGrid`, `CircleAvatarTile`, `CircleEmptyState`, `CircleSkeleton`, and happy-path test.
- **Why:** Fixed-height 3-row column-major grid, rings, empty/loading/error states, pagination, and avatar tap.

### `app-mobile/src/services/circleService.ts`, `app-mobile/src/hooks/useUserCircle.ts`, `app-mobile/src/types/circle.ts`

- **Before:** No typed circle data path.
- **After:** Thin RPC wrapper maps snake_case rows to `CirclePerson`; `useInfiniteQuery` paginates at `limit=60`.
- **Why:** Enforces RPC sole ownership and React Query server-state ownership.

### `app-mobile/src/hooks/queryKeys.ts`, `useFriends.ts`, `usePairings.ts`, `useNotifications.ts`

- **Before:** No circle query key; social mutations did not refresh circle cache.
- **After:** `circleKeys` added; friend accept/remove/block and pair accept/unpair paths invalidate `circleKeys.all`.
- **Why:** Circle graph changes after social mutations.

### `.github/scripts/strict-grep/*`, `.github/workflows/strict-grep-mingla-business.yml`

- **Before:** No ORCH-0933 invariant gates.
- **After:** Added `G-CIRCLE-RPC-SOLE-OWNER` and `G-CIRCLE-BADGE-DUAL-APP` jobs.
- **Why:** Prevent client-side graph composition and badge-condition drift.

## 7. Implementation Details

- **Architecture decisions:** DB computes tiers and sort precedence; client renders returned people only.
- **Data flow:** `YourCircleSection` reads viewer id from `useAppStore`, calls `useUserCircle`, which calls `circleService.fetchUserCircle`, which calls `supabase.rpc('get_user_circle', ...)`.
- **Mutation/query behavior:** Infinite query uses `initialPageParam=0`, `offset += 60`, and stops when a page returns fewer than 60 rows.
- **State handling:** Local state only for selected profile modal; no circle people in Zustand.
- **Error handling:** Initial error shows compact retry. Cached-populated error logs to Sentry and leaves cached avatars visible.
- **Copy/accessibility:** Avatar tiles are buttons with `View {name}'s profile` labels; empty copy matches spec exactly.
- **Navigation:** Avatar tap opens `ViewFriendProfileScreen` in a full-screen modal and uses light haptics.

## 8. Pre-Flight Design Notes

| Decision | Token / value | Source | Notes |
|---|---:|---|---|
| `circle.tier.close.ring` | `#f97316` (`colors.primary[500]`) | `designSystem.ts` | Warmest/most saturated, strongest bond. |
| `circle.tier.friend.ring` | `#22c55e` (`colors.success[500]`) | `designSystem.ts` | Mid-saturation, distinct from orange and neutral by hue/luminance. |
| `circle.tier.extended.ring` | `#6b7280` (`colors.gray[500]`) | `designSystem.ts` | Muted neutral for extended ties. |
| Avatar diameter | `44pt` | Mingla touch target lower bound | Keeps GlassCard total height at 220pt including existing 20pt vertical padding. |
| Ring thickness | `2.5pt` | Spec target | Visible on light/dark avatar imagery. |
| Briefcase badge | `16pt`, bottom-right, 2pt white outline, 10pt icon | Existing `briefcase-outline` icon | Badge renders only via `person.hasBusinessApp`. |

Color formats are hex only. No `oklch`, `lab`, `lch`, or `color-mix` were introduced.

## 9. Spec / Goal Traceability

| Criterion / goal | Implemented | Verification | Status |
|---|---|---|---|
| SC-01 to SC-05 | Section, fixed grid, tier rings, dual-app badge | Source review, strict grep, happy regression | PASS locally |
| SC-06 to SC-09 | Consumer filter, impersonation reject, tier precedence, blocked exclusion | Migration source + inline EXPLAIN body | Partially verified; requires migration push direct RPC tests |
| SC-10 | Avatar opens `ViewFriendProfileScreen` | Source review | Partially verified; device tap still needed |
| SC-11 to SC-14 | Empty state, pagination, sort formula | Source review + happy regression | PASS locally, DB direct tests pending |
| SC-15 | Strict-grep gates | Local gate commands pass | PASS locally |
| SC-16 | Implementor happy-path regression | Normal pass + simulated row-major failure | PASS locally; tester adversarial still downstream |
| SC-17 to SC-19 | iOS/Android parity and performance | Not run by implementor | Pending tester |
| SC-20 | Invariant registry at CLOSE | Out of implementor scope per spec | Pending orchestrator CLOSE |

## 10. Invariant Verification

| Invariant | Relevant | Preserved | Notes |
|---|---|---|---|
| CONSUMER-APP-FILTER | Yes | Yes | RPC final select requires consumer AppsFlyer row. |
| COLUMN-MAJOR-FILL | Yes | Yes | `Math.floor(index / 3)`, `index % 3`; simulated row-major fails test. |
| TIER-DETERMINISTIC | Yes | Yes | RPC excludes lower tiers; service defensively dedupes strongest tier. |
| BADGE-MEANS-DUAL-APP | Yes | Yes | RPC computes business row; render guard is `person.hasBusinessApp`. |
| RPC-SOLE-OWNER | Yes | Yes | Strict-grep forbids direct `friends`/`pairings`/`orders` reads in circle scope. |
| BLOCKED-EXCLUDED | Yes | Yes | Final RPC `NOT EXISTS` block filter. |
| NO-IMPERSONATION | Yes | Yes | RPC rejects caller mismatch with `42501`. |

## 11. RPC EXPLAIN ANALYZE Receipt

Because the operator owns `supabase db push`, I did not create or call the new function on the remote DB. I ran the RPC body as a read-only inline `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)` against linked remote data for sample viewer `ac7f00ee-b87f-4eb8-86ea-772b9fc88afa`.

```text
Limit  (actual time=2.353..2.375 rows=8 loops=1)
CTE tier_close -> Bitmap Index Scan on idx_pairings_user_a / idx_pairings_user_b
CTE viewer_events -> paid order/event filter returned 1 event
Dual-app lookup -> Index Only Scan using idx_appsflyer_devices_user_id_app
Planning Time: 28.094 ms
Execution Time: 3.264 ms
```

## 12. Cache And Persisted State Safety

- **Query keys changed:** Added `circleKeys.all`, `circleKeys.forUser`, `circleKeys.page`.
- **Invalidations added:** Friend accept/remove/block, pair accept/unpair, notification friend/pair accept shortcuts.
- **Data shape changes:** New typed `CirclePerson`; no existing API shape changed.
- **AsyncStorage/Zustand impact:** None for circle data.
- **Cold start behavior:** Circle fetch waits for hydrated auth user id and shows skeleton first.

## 13. Verification

| Check | Command / method | Result | Notes |
|---|---|---|---|
| Happy regression | `node app-mobile/src/components/profile/circle/__tests__/YourCircleSection.happy.test.tsx` | PASS | `PASS ORCH-0933 YourCircleSection happy-path regression` |
| Fails-on-revert | `ORCH0933_SIMULATE_ROW_MAJOR=1 node app-mobile/src/components/profile/circle/__tests__/YourCircleSection.happy.test.tsx` | FAIL as expected | fails-on-revert verified at `daee4cdc` working tree; assertion showed column 0 became `[Alice, Dan, Grace]`. |
| Strict grep: RPC sole owner | `bash .github/scripts/strict-grep/circle-rpc-sole-owner.sh` | PASS | Local gate passed. |
| Strict grep: badge dual app | `bash .github/scripts/strict-grep/circle-badge-dual-app.sh` | PASS | Local gate passed. |
| Focused lint | `npx eslint src/components/profile/circle src/hooks/useUserCircle.ts src/services/circleService.ts --max-warnings=0` | PASS | New circle files clean. |
| TypeScript filter | `npx tsc --noEmit --pretty false 2>&1 \| rg "circle\|useUserCircle\|circleService\|ProfilePage\|useFriends\|usePairings\|useNotifications\|queryKeys" \|\| true` | PASS filter | Full `tsc` still fails on pre-existing unrelated repo errors. |
| Full TypeScript | `npx tsc --noEmit --pretty false` | FAIL | Existing failures in `BoardDiscussion.tsx`, packages, Stripe PaymentSheet types; no ORCH-0933 path hits in filtered output. |
| Migration chain | `ls supabase/migrations`, `git ls-tree origin/main`, `supabase migration list --linked` | PASS | New prefix is monotonic after local and remote heads. |
| Remote EXPLAIN | `supabase db query --linked -f /tmp/orch_0933_circle_explain.sql` | PASS | Read-only inline RPC body, execution 3.264 ms. |

## 14. Regression Surface

1. Profile layout height: new GlassCard adds vertical content between Interests and Stats.
2. Social cache freshness: circle invalidates on friend/pair mutations, but successful ticket purchase invalidation was not wired because checkout handlers are outside the named product-code scope.
3. Profile navigation: local full-screen modal composes `ViewFriendProfileScreen`; tester should verify iOS/Android back and message behavior.

## 15. Risks, Limitations, Transition Items

| Item | Risk / temporary state | Exit condition | Location |
|---|---|---|---|
| DB not pushed | RPC cannot run in app until operator applies migration | Operator runs `supabase db push`; tester direct RPC checks pass | `supabase/migrations/20260724000002_orch_0933_get_user_circle_rpc.sql` |
| Purchase invalidation not wired | Co-attendee circle rows may wait for staleTime/refocus after purchase | Follow-up ORCH or tester-directed rework names checkout file scope | Checkout success handlers |
| Device parity not run | UI/perf SC-17..SC-19 unverified | Claude tester runs iOS + Android checklist | Profile screen |
| Full `tsc` red | Existing unrelated errors block full type gate signal | Separate cleanup or accepted baseline | See verification output |

## 16. Discoveries For Orchestrator

- The spec body referenced `events.start_at/end_at`, but latest schema stores event timing in `event_dates.start_at/end_at`. The migration uses `event_dates` and falls back to `orders.created_at`.
- The spec says new section mounts through existing profile-profile mechanism, but `ProfilePage.tsx` has no callback for `setViewingFriendProfileId`. To honor the product-code guard, this implementation composes `ViewFriendProfileScreen` locally instead of editing `app/index.tsx`.

## 17. Deploy Notes

- **Migrations:** Operator must apply `20260724000002_orch_0933_get_user_circle_rpc.sql`. Do not run from Codex.
- **Edge functions:** None.
- **Mobile OTA/native:** Consumer-only JS/TS changes; no native dependency change.
- **Business/admin web:** Not touched.
- **Env vars/secrets:** None.

## Suggested Commit Message

```text
profile: add Your Circle social graph section

Resolves: ORCH-0933
Evidence: YourCircleSection happy regression, strict-grep circle gates, inline RPC EXPLAIN
Deploy: operator applies Supabase migration; no edge deploy
```

## Ready-To-Test Checklist

1. Apply the migration in the operator-controlled DB path, then direct-call `get_user_circle` for a real viewer and verify impersonation, blocked-user, consumer-only, dual-app, and tier-precedence cases.
2. On iOS and Android, open Profile and verify Your Circle appears below Your Interests, scrolls horizontally, paginates, and keeps 3-row column-major order.
3. Tap an avatar and verify `ViewFriendProfileScreen` opens, back dismisses it, and message behavior is acceptable for v1.
4. Run tester adversarial regression file per spec §15.2 and add invariant registry entries during CLOSE.
