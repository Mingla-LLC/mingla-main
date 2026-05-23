# Implementation Report: Profile Circle Event Connection Mapping

> Date: 2026-05-23  
> Mode: Spec Execute  
> Spec: `Mingla_Artifacts/reports/INVESTIGATION_PROFILE_CIRCLE_EVENT_CONNECTION_MAPPING.md`  
> Status: implemented, partially verified

## 1. Layman Summary

Profile `Your Circle` now has a backend-owned relationship-source contract. Instead of the app guessing with generic copy like `Mingla connection`, the Circle RPC returns safe labels such as `Friend of Maya`, `Also going to Supper Club`, or `Also attended Supper Club`, and the mobile UI renders that label beside each avatar.

## 2. Request And Context

- **Request:** Implement the event/friend source mapping so Circle explains why each avatar appears.
- **Source:** User-dispatched `$implementor` handoff after `INVESTIGATION_PROFILE_CIRCLE_EVENT_CONNECTION_MAPPING.md`.
- **Affected surfaces:** Supabase RPC migration, app-mobile Circle types/service/UI, purchase/order cache invalidation, Circle regression tests.
- **Related artifacts:** `Mingla_Artifacts/reports/INVESTIGATION_PROFILE_CIRCLE_EVENT_CONNECTION_MAPPING.md`.

## 3. Scope

- **In scope:** Extend `get_user_circle`, preserve privacy boundaries, render backend-provided relationship labels, invalidate Circle after ticket/order changes, update regression tests.
- **Out of scope:** Applying the migration to remote Supabase, changing ticket transfer semantics, adding partial-refund eligibility, building multi-source `+N more` UI.
- **Assumptions:** Confirmed `orders.payment_status = 'paid'` remains the v1 event-attendance signal for both free and paid tickets.

## 4. Files Read

| File | Why | Relevant finding |
|---|---|---|
| `Mingla_Artifacts/reports/INVESTIGATION_PROFILE_CIRCLE_EVENT_CONNECTION_MAPPING.md` | Implementation contract | RPC already maps co-attendees but drops source context. |
| `supabase/migrations/20260724000003_orch_0933_get_user_circle_rpc_ambiguity_fix.sql` | Current Circle RPC | Latest old function returned only tier/profile/sort fields. |
| `app-mobile/src/types/circle.ts` | Mobile data contract | No relationship fields existed. |
| `app-mobile/src/services/circleService.ts` | RPC mapper | App consumed only current RPC fields and deduped tiers. |
| `app-mobile/src/components/profile/circle/CircleAvatarTile.tsx` | UI label render | UI generated generic `Mingla connection` locally. |
| `app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx` | Purchase invalidation | Success path invalidated only business-event orders. |
| `app-mobile/src/hooks/useCalendarEntries.ts` | Order realtime invalidation | Orders realtime invalidated only business-event orders. |

## 5. Blast Radius

- **Direct changes:** `get_user_circle` return shape, Circle mobile model, Circle tile relationship text.
- **Cascade changes:** Service mapper now preserves legacy extended rows as `Friend of a friend` until the new RPC metadata is live.
- **Parity surfaces:** Business/admin/public surfaces unchanged.
- **Cache impact:** Ticket purchase success and order realtime now invalidate `circleKeys.all`.
- **State boundaries:** React Query remains server-state owner; no Zustand/AsyncStorage changes.
- **Auth/RLS/security:** RPC retains `auth.uid() = p_viewer_user_id`, excludes anonymous buyers, excludes viewer-blocked and reverse-blocked users, and does not return buyer/order/ticket/payment fields.
- **Deploy path:** Requires operator-run Supabase migration push before the new mobile fields are available from the backend.

## 6. Old To New Receipts

### `supabase/migrations/20260724000004_profile_circle_relationship_source.sql`

- **Before:** `get_user_circle` returned only tier/profile/sort fields and collapsed friend-of-friend plus co-attendee sources into `extended`.
- **After:** The RPC returns `relationship_source`, `relationship_label`, context fields, source count, and preserves co-attendee/friend-of-friend source metadata.
- **Why:** The app cannot truthfully say why a user appears without backend-owned source context.
- **Approx lines changed:** New migration, 340 lines.

### `app-mobile/src/types/circle.ts`

- **Before:** `CirclePerson` had no relationship source or label fields.
- **After:** Added `CircleRelationshipSource`, `CircleRelationshipContextType`, and relationship fields on `CirclePerson`.
- **Why:** Mobile needs a typed contract for backend-provided labels.
- **Approx lines changed:** 13.

### `app-mobile/src/services/circleService.ts`

- **Before:** Mapper consumed only tier/profile/sort fields and could not carry context to UI.
- **After:** Mapper validates relationship sources, maps labels/context fields, and keeps legacy extended rows visible as `Friend of a friend`.
- **Why:** Prevents `Mingla connection` while avoiding a migration-window regression where existing friend-of-friend rows disappear.
- **Approx lines changed:** 68.

### `app-mobile/src/components/profile/circle/CircleAvatarTile.tsx`

- **Before:** Tile generated local labels by tier and used `Mingla connection` for extended users.
- **After:** Tile renders `person.relationshipLabel`.
- **Why:** Display copy must come from the backend source contract.
- **Approx lines changed:** Small targeted replacement.

### `app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx`

- **Before:** Purchase success invalidated only `["businessEventOrders", userId]`.
- **After:** Purchase success and paid-path polling also invalidate `circleKeys.all`.
- **Why:** New co-attendees should refresh in Circle after ticket purchase/finalize.
- **Approx lines changed:** 3.

### `app-mobile/src/hooks/useCalendarEntries.ts`

- **Before:** Order realtime invalidated only business-event orders.
- **After:** Order realtime also invalidates `circleKeys.all`.
- **Why:** Confirmed order INSERT/UPDATE/DELETE changes Circle membership/source eligibility.
- **Approx lines changed:** 8.

### Circle regression tests

- **Before:** Tests allowed local generic extended labels.
- **After:** Tests assert backend-provided labels, no `Mingla connection`, safe RPC source fields, anonymous buyer exclusion shape, reverse-block exclusion, and Circle invalidation.
- **Why:** Lock the new product contract against regressions.
- **Approx lines changed:** 160.

## 7. Implementation Details

- **Architecture decisions:** Kept one authoritative RPC; no client-side joins into private order/ticket tables.
- **Data flow:** `orders.event_id + orders.buyer_user_id` creates eligible shared event context; RPC picks the best safe source label; service maps it; tile renders it.
- **Mutation/query behavior:** Ticket purchase and order realtime invalidate Circle in addition to ticket calendar data.
- **State handling:** No persisted client state added.
- **Error handling:** Invalid tier still throws; legacy extended rows without new RPC metadata remain visible as `Friend of a friend`.
- **Copy/accessibility:** Accessibility label now includes the backend relationship label.
- **Analytics/notifications/realtime:** No analytics change; order realtime freshness extended to Circle.

## 8. Spec / Goal Traceability

| Criterion / goal | Implemented | Verification | Status |
|---|---|---|---|
| Add safe relationship metadata to RPC | Yes | Static regression in adversarial test | Pass |
| Render concrete labels instead of generic `Mingla connection` | Yes | Happy/adversarial Circle tests | Pass |
| Preserve friend-of-friend rows before migration rollout | Yes | Adversarial Circle test | Pass |
| Preserve private buyer/order/ticket/payment data | Yes | Static regression asserts no returned private columns | Pass |
| Include free and paid confirmed orders | Yes | RPC still uses `payment_status = 'paid'`, which includes finalized free orders | Pass |
| Invalidate Circle after purchase/order changes | Yes | Static regression in adversarial test | Pass |
| Runtime DB execution of migration | Not run | Operator must run `supabase db push` | Not verified |

## 9. Invariant Verification

| Invariant | Relevant | Preserved | Notes |
|---|---|---|---|
| One owner per truth | Yes | Yes | RPC owns relationship source; mobile renders. |
| No fabricated data | Yes | Yes | Generic fallback removed for extended rows. |
| React Query owns server state | Yes | Yes | Only invalidations added. |
| Auth/RLS boundary | Yes | Yes | RPC caller gate retained. |
| Privacy by design | Yes | Yes | No order/ticket/buyer/payment fields returned. |

## 10. Parity Check

- **Mobile:** Updated.
- **Business app:** Unchanged; source data already comes from business event orders.
- **Admin:** Unchanged.
- **Public/web:** Unchanged.
- **Solo/collab:** Not applicable.
- **Gaps:** Remote migration application and live DB verification still required.

## 11. Cache And Persisted State Safety

- **Query keys changed:** None.
- **Invalidations added:** `circleKeys.all` in purchase success and `useOrdersRealtimeSubscription`.
- **Data shape changes:** `CirclePerson` now includes relationship source/label/context fields.
- **AsyncStorage/Zustand impact:** None.
- **Cold start behavior:** Circle refetch receives richer rows after migration; before migration, legacy extended rows remain visible as `Friend of a friend`.

## 12. Verification

| Check | Command / method | Result | Notes |
|---|---|---|---|
| Circle happy regression | `node app-mobile/src/components/profile/circle/__tests__/YourCircleSection.happy.test.tsx` | PASS | Updated for backend-provided labels. |
| Circle adversarial regression | `node app-mobile/src/components/profile/circle/__tests__/YourCircleSection.adversarial.test.tsx` | PASS | Covers service mapping, RPC source contract, privacy, invalidation. |
| Scoped ESLint | `cd app-mobile && npx eslint src/components/profile/circle/CircleAvatarTile.tsx src/components/profile/circle/CircleGrid.tsx src/components/profile/circle/CircleSkeleton.tsx src/components/profile/circle/CircleEmptyState.tsx src/components/profile/circle/YourCircleSection.tsx src/services/circleService.ts src/hooks/useCalendarEntries.ts src/components/expandedCard/ExpandedBusinessEventSheet.tsx` | PASS with warnings | No errors; two pre-existing warnings in `ExpandedBusinessEventSheet.tsx`. |
| Whitespace check | `git diff --check` | PASS | No whitespace errors. |
| Full app-mobile typecheck | `cd app-mobile && npx tsc --noEmit --pretty false` | FAIL unrelated | Existing branch errors in `BoardDiscussion`, `LockedPlanBanner`, `TicketCartSheet`, `nativeCheckoutFlow`, and workspace packages. |

## 13. Regression Surface

1. Profile Circle rendering: legacy extended rows are visible as `Friend of a friend` until the backend migration returns richer labels.
2. Event purchase freshness: invalidation now touches Circle and can cause an extra refetch after orders update.
3. SQL function deployment: changed return type required dropping/recreating the RPC.

## 14. Risks, Limitations, Transition Items

| Item | Risk / temporary state | Exit condition | Location |
|---|---|---|---|
| Migration not applied | Mobile uses temporary `Friend of a friend` labels for legacy extended rows | Operator runs `supabase db push` successfully | `supabase/migrations/20260724000004_profile_circle_relationship_source.sql` |
| SQL not runtime-executed locally | Static tests passed, but DB parser/runtime not proven | QA/operator validates migration on Supabase dev DB | Supabase dev |
| Full typecheck remains noisy | Cannot claim repo-wide TS clean | Separate cleanup of unrelated branch errors | app-mobile/packages |

## 15. Discoveries For Orchestrator

- Full `app-mobile` typecheck remains blocked by unrelated pre-existing errors outside this feature slice.
- Existing `ExpandedBusinessEventSheet.tsx` has two ESLint warnings unrelated to this change.

## 16. Deploy Notes

- **Migrations:** Operator must apply `supabase/migrations/20260724000004_profile_circle_relationship_source.sql`.
- **Edge functions:** None.
- **Mobile OTA/native:** Mobile app update needed for new labels and invalidation.
- **Business/admin web:** None.
- **Env vars/secrets:** None.

## Suggested Commit Message

```text
profile: add circle relationship source labels

Evidence: Circle happy/adversarial tests, scoped ESLint, git diff --check
Deploy: apply Supabase migration 20260724000004 before relying on extended source labels
```

## Ready-To-Test Checklist

1. Apply the migration on the dev Supabase project.
2. Seed or use two consumer users with confirmed orders for the same public event.
3. Open Profile > Your Circle and confirm the other attendee appears with `Also going to {event}` or `Also attended {event}`.
4. Confirm direct friends still show `Friend`, close pairings show `Close friend`, and no row shows `Mingla connection`.
5. Buy or claim a free ticket from the app and confirm Circle refreshes after order finalize/realtime.
