# Implementation Rework Report: Profile Circle Event Connection Mapping

> Date: 2026-05-23  
> Working tree: `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`  
> Mode: REWORK after FAIL verdict  
> QA input: `Mingla_Artifacts/reports/QA_PROFILE_CIRCLE_EVENT_CONNECTION_MAPPING.md`  
> Prior implementation: `Mingla_Artifacts/reports/IMPLEMENTATION_PROFILE_CIRCLE_EVENT_CONNECTION_MAPPING.md`  
> Investigation: `Mingla_Artifacts/reports/INVESTIGATION_PROFILE_CIRCLE_EVENT_CONNECTION_MAPPING.md`  
> Status: implemented, partially verified

## Summary

The rework fixes both QA release blockers. The relationship-source migration now uses a deploy-safe local version after the linked remote head, and the mobile legacy fallback no longer fabricates `Friend of a friend` for source-less old `extended` rows that may actually be shared-event co-attendees.

Runtime database execution is still not claimed because Codex did not apply migrations to the linked Supabase project. The operator still needs to run `supabase db push`, then Tester should perform runtime QA against the deployed RPC.

## Rework Scope

| QA finding | Rework | Status |
|---|---|---|
| P1-001 migration version collides with remote `20260724000004` | Replaced `supabase/migrations/20260724000004_profile_circle_relationship_source.sql` with `supabase/migrations/20260724000005_profile_circle_relationship_source.sql` | Fixed locally |
| P1-002 legacy `extended` fallback falsely labels ambiguous rows as friend-of-friend | Changed source-less legacy `extended` rows to `relationshipSource = mixed` and `relationshipLabel = Connected through Mingla`; `Friend of a friend` fallback is now gated behind proven `relationship_source = friend_of_friend` | Fixed |

## Files Changed

| File | Change |
|---|---|
| `supabase/migrations/20260724000005_profile_circle_relationship_source.sql` | Same relationship-source RPC body moved to a monotonic migration version greater than linked remote head `20260724000004`. |
| `app-mobile/src/services/circleService.ts` | Replaced legacy `extended -> friend_of_friend/Friend of a friend` fallback with ambiguous `mixed/Connected through Mingla` unless the backend row explicitly proves `relationship_source = friend_of_friend`. |
| `app-mobile/src/components/profile/circle/__tests__/YourCircleSection.adversarial.test.tsx` | Updated static migration path, changed legacy fallback expectation, and added a migration-version regression asserting `20260724000005` exists and colliding `20260724000004` does not. |

## Old-To-New Receipts

### Migration filename

- **Before:** Local branch had `supabase/migrations/20260724000004_profile_circle_relationship_source.sql`, but linked remote already recorded migration version `20260724000004`.
- **After:** Local branch has `supabase/migrations/20260724000005_profile_circle_relationship_source.sql`; linked remote still has `20260724000004`; normal migration push can see `20260724000005` as pending.
- **Regression guard:** Adversarial Circle test now asserts the colliding filename is absent and the post-remote-head filename is present.

### Legacy extended fallback

- **Before:** A source-less old RPC row with `tier = extended` mapped to `relationshipSource = friend_of_friend` and `relationshipLabel = Friend of a friend`.
- **After:** A source-less old RPC row with `tier = extended` maps to `relationshipSource = mixed` and `relationshipLabel = Connected through Mingla`.
- **Friend-of-friend exception:** The generic `Friend of a friend` fallback remains available only when the row already provides `relationship_source = friend_of_friend`.

## Verification

| Check | Command | Result | Evidence |
|---|---|---|---|
| Circle happy regression | `node app-mobile/src/components/profile/circle/__tests__/YourCircleSection.happy.test.tsx` | PASS | `PASS ORCH-0933 YourCircleSection happy-path regression` |
| Circle adversarial regression | `node app-mobile/src/components/profile/circle/__tests__/YourCircleSection.adversarial.test.tsx` | PASS | Covers source mapping, legacy fallback, static RPC contract, privacy guards, cache invalidation, and migration-version guard. |
| Scoped ESLint | `cd app-mobile && npx eslint src/components/profile/circle/CircleAvatarTile.tsx src/components/profile/circle/CircleGrid.tsx src/components/profile/circle/CircleSkeleton.tsx src/components/profile/circle/CircleEmptyState.tsx src/components/profile/circle/YourCircleSection.tsx src/services/circleService.ts src/hooks/useCalendarEntries.ts src/components/expandedCard/ExpandedBusinessEventSheet.tsx` | PASS with warnings | No errors; existing warnings in `ExpandedBusinessEventSheet.tsx` for `import/no-named-as-default` and unnecessary hook deps. |
| Whitespace | `git diff --check` | PASS | No output. |
| Local migration tail | `ls supabase/migrations | tail -8` | PASS | Tail ends at `20260724000005_profile_circle_relationship_source.sql`; colliding `20260724000004_profile_circle_relationship_source.sql` absent. |
| Origin/main migration tail | `git ls-tree origin/main supabase/migrations/ \| tail -8` | PASS | Origin/main ends at `20260724000003_orch_0933_get_user_circle_rpc_ambiguity_fix.sql` for this area; no profile-circle `20260724000004` file. |
| Linked migration list | `/Users/sethogieva/bin/supabase migration list --linked` | PASS for version shape | Output shows remote-only `20260724000004` and local-only `20260724000005`. |
| App typecheck | `cd app-mobile && npx tsc --noEmit --pretty false` | FAIL unrelated | Existing branch errors remain in `LockedPlanBanner`, `BoardDiscussion`, `CollabDeckSheet.providerWrap.test`, `TicketCartSheet`, `nativeCheckoutFlow`, and workspace packages. |

## Security And Privacy Check

- The SQL body remains server-owned in `get_user_circle`; no client joins into orders, tickets, pairings, or friends were added.
- The RPC still returns safe relationship metadata only and does not add order IDs, ticket IDs, buyer contact fields, Stripe fields, or QR payloads.
- Anonymous buyers remain excluded through `o2.buyer_user_id IS NOT NULL`.
- Viewer-blocked and reverse-blocked exclusions remain in the migration.
- The fallback copy is now ambiguity-preserving during the migration window and does not invent a friend-of-friend relationship for shared-event people.

## Deployment Notes

- Operator migration action remains required: run `supabase db push` from `/Users/sethogieva/Desktop/mingla-main` after review.
- Expected pending migration is `20260724000005_profile_circle_relationship_source.sql`.
- No edge functions changed in this rework; no Deno gate applies.
- Mobile update is still required for the relationship label mapper and Circle invalidation behavior from the prior implementation.

## Tester Retest Focus

1. Confirm no local `supabase/migrations/20260724000004_profile_circle_relationship_source.sql` exists and `20260724000005_profile_circle_relationship_source.sql` is pending after remote head `20260724000004`.
2. Confirm source-less legacy `extended` service rows map to `Connected through Mingla`, not `Friend of a friend`.
3. Confirm explicit backend `friend_of_friend` and `co_attendee` rows still map to `Friend of Maya` and `Also going to Supper Club` style labels.
4. After operator applies the migration, runtime-test two confirmed co-attendees on the same event and verify event labels appear without exposing private order/ticket/payment data.

## Suggested Commit Message

```text
profile: rework circle relationship source migration

Evidence: Circle happy/adversarial tests, scoped ESLint, migration-list gate, git diff --check
Deploy: apply Supabase migration 20260724000005 before runtime QA
```
