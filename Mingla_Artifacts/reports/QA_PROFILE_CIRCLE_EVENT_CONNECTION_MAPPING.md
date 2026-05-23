# QA Report: Profile Circle Event Connection Mapping

> Date: 2026-05-23  
> Mode: TARGETED + SECURITY/PRIVACY CHECK  
> Implementation report: `Mingla_Artifacts/reports/IMPLEMENTATION_PROFILE_CIRCLE_EVENT_CONNECTION_MAPPING.md`  
> Investigation: `Mingla_Artifacts/reports/INVESTIGATION_PROFILE_CIRCLE_EVENT_CONNECTION_MAPPING.md`  
> Verdict: **FAIL**

## Verdict Summary

The mobile/UI/service shape mostly matches the intended direction, and the scoped Circle regression tests pass. However, this cannot pass release QA because the new Supabase migration filename collides with a migration version already recorded on the linked remote database, so the backend contract may not deploy through normal `supabase db push`. That leaves the app in legacy-RPC mode, where the follow-up fallback labels every old `extended` row as `Friend of a friend`, even though the current old RPC also uses `extended` for shared-event co-attendees.

## Findings

### P1-001 — Migration version collides with linked remote head, so the new RPC may not deploy

- **Severity:** P1 HIGH
- **Status:** Release blocker
- **Evidence:** Local migration is `supabase/migrations/20260724000004_profile_circle_relationship_source.sql`.
- **Evidence:** `ls supabase/migrations | tail -8` shows local head `20260724000004_profile_circle_relationship_source.sql`.
- **Evidence:** `git ls-tree origin/main supabase/migrations/ | tail -8` does not include `20260724000004`, so this is new to the branch but not present on origin/main.
- **Evidence:** `/Users/sethogieva/bin/supabase migration list --linked` shows remote already has `20260724000004` recorded.
- **Why it matters:** Supabase migration tracking is version-based. A new local migration with the same version as a remote-applied migration is not a safe deploy artifact; normal push can treat that version as already applied and skip this SQL body. The new `relationship_source`/`relationship_label` RPC contract may never reach the linked DB.
- **User impact:** The app can keep receiving old `extended` rows without source metadata, so event/friend labels remain dependent on fallback behavior instead of the real mapping.
- **Required rework:** Create a new monotonic migration with a prefix greater than the linked remote head, e.g. `20260724000005_profile_circle_relationship_source.sql` or later, and remove/rename the colliding local migration. Re-run migration-list verification and update the implementation report.

### P1-002 — Legacy fallback fabricates `Friend of a friend` for old `extended` rows that can be co-attendees

- **Severity:** P1 HIGH
- **Status:** Release blocker until P1-001 is fixed or fallback copy is made truthful
- **Evidence:** Current old RPC `supabase/migrations/20260724000003_orch_0933_get_user_circle_rpc_ambiguity_fix.sql` collapses `tier_fof` and `tier_coattendee` into one `tier_extended` (`lines 118-126` in that migration).
- **Evidence:** New service fallback maps any missing-source `extended` row to `friend_of_friend` and `Friend of a friend` in `app-mobile/src/services/circleService.ts:49-60`.
- **Evidence:** The adversarial test explicitly expects a legacy extended row without `relationship_source` / `relationship_label` to become `Friend of a friend`.
- **Why it matters:** The investigation and user request require the connection to be defined truthfully: friend of who, which event, etc. Labeling all old `extended` users as friend-of-friend can mislabel a pure shared-event co-attendee.
- **User impact:** A user may see an event attendee described as a friend-of-friend, which is a false social relationship. That violates the no-fabricated-data invariant.
- **Required rework:** Prefer fixing P1-001 so the backend source metadata is actually deployed before relying on this UI. If a legacy fallback must remain, use copy that is truthful for both old `extended` sources, or gate the specific `Friend of a friend` fallback behind a proven `relationship_source = 'friend_of_friend'`.

## Verified Claims

| Claim | Result | Evidence |
|---|---|---|
| UI no longer renders `Mingla connection` | Verified | `CircleAvatarTile.tsx` renders `person.relationshipLabel`; tests assert absence of `Mingla connection`. |
| New mobile type includes relationship fields | Verified | `app-mobile/src/types/circle.ts` includes relationship source/context/label fields. |
| Service maps new RPC relationship fields | Verified | `app-mobile/src/services/circleService.ts:76-103`. |
| Purchase success invalidates Circle | Verified | `ExpandedBusinessEventSheet.tsx:267-280` invalidates `circleKeys.all`. |
| Order realtime invalidates Circle | Verified | `useCalendarEntries.ts:104-107` invalidates `circleKeys.all`. |
| RPC auth guard retained | Verified statically | New migration keeps `auth.uid()` equality check and SQLSTATE `42501` at lines 33-39. |
| RPC excludes anonymous buyers | Verified statically | New migration requires `o2.buyer_user_id IS NOT NULL` at line 160. |
| RPC avoids buyer/order/ticket fields in return signature | Verified statically | Return table lines 13-26 expose only profile/source/sort fields. |
| Migration is deploy-safe | Refuted | Remote already records version `20260724000004`. |

## Commands Run

| Command | Result | Notes |
|---|---|---|
| `node app-mobile/src/components/profile/circle/__tests__/YourCircleSection.happy.test.tsx` | PASS | Static/UI contract check. |
| `node app-mobile/src/components/profile/circle/__tests__/YourCircleSection.adversarial.test.tsx` | PASS | Includes source mapping, fallback, privacy/static migration checks. |
| `cd app-mobile && npx eslint src/components/profile/circle/CircleAvatarTile.tsx src/components/profile/circle/CircleGrid.tsx src/components/profile/circle/CircleSkeleton.tsx src/components/profile/circle/CircleEmptyState.tsx src/components/profile/circle/YourCircleSection.tsx src/services/circleService.ts src/hooks/useCalendarEntries.ts src/components/expandedCard/ExpandedBusinessEventSheet.tsx` | PASS with warnings | No errors; two warnings in `ExpandedBusinessEventSheet.tsx`. |
| `git diff --check` | PASS | No whitespace errors. |
| `cd app-mobile && npx tsc --noEmit --pretty false` | FAIL unrelated | Existing branch errors in `BoardDiscussion`, `LockedPlanBanner`, `TicketCartSheet`, `nativeCheckoutFlow`, and packages. |
| `/Users/sethogieva/bin/supabase migration list --linked` | FAIL gate | Shows remote already has `20260724000004`; local migration collides with remote version. |

## Security And Privacy Check

- The RPC remains `SECURITY DEFINER` with `auth.uid()` caller equality guard.
- The return signature does not include order IDs, ticket IDs, buyer contact fields, Stripe fields, or QR data.
- Anonymous buyers remain excluded from co-attendee mapping.
- Reverse-block exclusion was added in the new migration.
- Runtime DB validation was not performed because tester mode must not mutate Supabase and the migration deploy artifact is currently blocked by version collision.

## Regression Coverage Review

Coverage exists but is not sufficient for release because the core SQL is only statically inspected. The tests are useful as source-level guardrails, but they do not prove that the new SQL body applies to the linked DB or that the RPC executes successfully after deployment. The migration-version collision makes this more than a normal manual gate: it must be corrected before QA can produce PASS or CONDITIONAL PASS.

## Required Rework

1. Replace the colliding migration with a new monotonic filename greater than the linked remote head.
2. Re-run `/Users/sethogieva/bin/supabase migration list --linked` and confirm the new local migration version is greater than the highest remote version.
3. Reassess the legacy `extended` fallback so it does not falsely label shared-event co-attendees as `Friend of a friend`.
4. Re-run the Circle happy/adversarial tests, scoped ESLint, `git diff --check`, and the linked migration-list gate.
5. Update `Mingla_Artifacts/reports/IMPLEMENTATION_PROFILE_CIRCLE_EVENT_CONNECTION_MAPPING.md` with the corrected migration/deploy evidence.

## Retest Instructions

After rework, run:

```bash
node app-mobile/src/components/profile/circle/__tests__/YourCircleSection.happy.test.tsx
node app-mobile/src/components/profile/circle/__tests__/YourCircleSection.adversarial.test.tsx
cd app-mobile && npx eslint src/components/profile/circle/CircleAvatarTile.tsx src/components/profile/circle/CircleGrid.tsx src/components/profile/circle/CircleSkeleton.tsx src/components/profile/circle/CircleEmptyState.tsx src/components/profile/circle/YourCircleSection.tsx src/services/circleService.ts src/hooks/useCalendarEntries.ts src/components/expandedCard/ExpandedBusinessEventSheet.tsx
git diff --check
/Users/sethogieva/bin/supabase migration list --linked
```

Runtime QA remains required after the operator applies the corrected migration: verify two consumer users with confirmed orders for the same event see each other with `Also going to {event}` / `Also attended {event}`, and verify direct friends still show `Friend` while close pairings show `Close friend`.
