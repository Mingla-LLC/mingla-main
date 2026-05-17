# SPEC — ORCH-0851 [Consumer Tickets tab post-purchase realtime freshness]

**Mode:** SPEC (post-INVESTIGATE, narrowed)
**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0851_CONSUMER_TICKET_ORDER_VISIBILITY_AND_AUTH_EMAIL.md` (see "Reframe 2026-05-17" section)
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Date:** 2026-05-17 (rewritten — supersedes the 2026-05-16 draft)

---

## Layman summary

When you buy a ticket in the Mingla consumer app, the new ticket can take 1–5 seconds to appear on the Tickets/Calendar tab. Sometimes you have to background and re-foreground the app to see it. That's because the app polls instead of being notified by the database. This spec adds a live subscription on the `orders` table so the moment a new order is created for you (the signed-in buyer), the Tickets tab refreshes immediately — no waiting, no app-switching.

All other findings from the investigation (no separate Orders view, free-text buyer form on the public event page, no cc-to-auth-email safety net) were reviewed by the operator on 2026-05-17 and ruled NOT BUGS / BY DESIGN. They are out of scope here. See the investigation's Reframe section.

---

## Scope

In scope (single item):

1. **Consumer-app Supabase realtime subscription on `orders`.** Add a hook that subscribes to `postgres_changes` events on the `orders` table filtered by `buyer_user_id=eq.<userId>` for the signed-in consumer user. On any INSERT/UPDATE/DELETE event, invalidate the existing `["businessEventOrders", userId]` React Query cache so `CalendarTab` re-renders with the fresh order list within ~1 second of the database write.

Non-goals (explicitly out of scope):

- Any change to `mingla-business/app/checkout/[eventId]/buyer.tsx` (public event page form is by design — operator ruling 2026-05-17).
- Any change to `supabase/functions/ticket-confirmation-dispatch/index.ts` (typed email is the intended recipient — operator ruling 2026-05-17).
- Any separate Orders/Receipts/Purchases surface in the consumer app (Tickets tab IS the order view — operator ruling 2026-05-17).
- Any backfill, schema change, RLS change, or migration.
- Any change to the existing 3-attempt-over-3-seconds invalidate loop in `ExpandedBusinessEventSheet.tsx` — it remains as a fallback for cases where realtime fails to connect.

Assumptions:

- The `orders` table is included in the `supabase_realtime` publication. If not, the implementor flags this as a one-click operator-side Dashboard toggle and pauses; implementation cannot ship without it.
- The mobile Supabase client (`app-mobile/src/lib/supabase.ts` or wherever the project's client lives) supports `supabase.channel(...).on('postgres_changes', ...)` per supabase-js v2 standard API. This is the default; verify during Step 1.

---

## Cross-Surface Impact (mandatory per Phase 2.5)

| # | Surface | Covered? | What changes here |
|---|---------|----------|-------------------|
| 1 | Consumer iOS (`app-mobile/` on iOS) | YES | New realtime subscription hook is called from `CalendarTab`. Tickets surface within ~1s of order creation. |
| 2 | Consumer Android (`app-mobile/` on Android) | YES (parity automatic) | Same shared code path as iOS. |
| 3 | Buyer/anonymous Web (`mingla-business/` `/checkout/{eventId}`) | NO | Unchanged. Public event page is by design. |
| 4 | Business iOS (`mingla-business/` on iOS) | NO | Unchanged. Business app does not render `CalendarTab`. |
| 5 | Business Android (`mingla-business/` on Android) | NO | Unchanged. |
| 6 | Admin Web (`mingla-admin/`) | NO | Unchanged. |
| 7 | Business Web preview | NO | Unchanged. |

Parity is **automatic** across surfaces 1+2 (shared `app-mobile` code). No other surface is touched.

---

## Architecture (target state)

### `useOrdersRealtimeSubscription(userId)` (NEW hook)

**File:** `app-mobile/src/hooks/useCalendarEntries.ts` (added to the existing file alongside `useBusinessEventOrders`).

**Signature:**

```ts
export const useOrdersRealtimeSubscription = (userId: string | undefined): void;
```

**Behavior:**

- Returns `void`. Side effect: maintains a Supabase realtime channel for the lifetime of the hook.
- If `userId` is `undefined` or empty, no channel is opened (early return).
- On mount with a valid `userId`:
  1. Open `supabase.channel(\`orders:buyer_user_id=eq.${userId}\`)`.
  2. Register a `postgres_changes` listener for `event: '*'` (INSERT, UPDATE, DELETE) on `schema: 'public', table: 'orders', filter: \`buyer_user_id=eq.${userId}\``.
  3. On any event payload, call `queryClient.invalidateQueries({ queryKey: ["businessEventOrders", userId] })`.
  4. Call `channel.subscribe()`.
- On unmount or when `userId` changes:
  1. `supabase.removeChannel(channel)`.
  2. New `userId` triggers a fresh channel via the effect's re-run.

**Failure mode:** if the channel fails to subscribe (network down, realtime disabled, RLS denies), the hook silently no-ops. The existing 3-attempt-over-3-seconds invalidate loop in `ExpandedBusinessEventSheet.tsx:264-286` and the existing `refetchOnWindowFocus: true` config in `useBusinessEventOrders` remain in place as fallbacks — there is no regression even if realtime is unavailable.

### `CalendarTab.tsx` (one-line modification)

**File:** `app-mobile/src/components/activity/CalendarTab.tsx`.

**Change:** add one line inside the component body, alongside the existing `useBusinessEventOrders(user?.id)` call:

```tsx
useOrdersRealtimeSubscription(user?.id);
```

Plus the import:

```tsx
import { useOrdersRealtimeSubscription } from "../../hooks/useCalendarEntries";
```

No render change. No prop change.

---

## Database layer

No schema changes. No RLS changes. No migrations.

**Realtime publication check (Step 1, mandatory):**

```sql
SELECT tablename FROM pg_publication_tables
WHERE pubname = 'supabase_realtime' AND tablename = 'orders';
```

- **If 1 row returns:** proceed with implementation.
- **If 0 rows return:** implementor flags this in the report as a blocker. Operator enables the `orders` table for realtime via Supabase Dashboard (Database → Replication → toggle `orders` ON for `supabase_realtime`) before the implementor's PR can ship. R-1 and R-2 do not exist anymore so there is no parallel work to ship in the meantime — the implementor pauses cleanly and waits.

---

## Edge function layer

No changes. No edge function deploys required for this ORCH.

---

## Service layer

No changes in `app-mobile/src/services/`. The realtime subscription is hook-layer only.

---

## Hook layer

### `useOrdersRealtimeSubscription` (NEW)

Detailed contract above under "Architecture." Query key touched: `["businessEventOrders", userId]` (existing, defined in `useBusinessEventOrders` at `app-mobile/src/hooks/useCalendarEntries.ts:56-71`).

### `useBusinessEventOrders` (existing)

UNCHANGED. The new realtime hook invalidates this hook's cache via `queryClient.invalidateQueries`; no internal modification of `useBusinessEventOrders` is needed.

---

## Component layer

### `CalendarTab.tsx` (MODIFIED)

One import + one hook call. Detailed contract above under "Architecture."

---

## Realtime channel contract

- **Channel name:** `orders:buyer_user_id=eq.<userId>` — colon-prefixed scope per Supabase convention; uniquely keyed per user so multiple devices/sessions of the same user reuse the same channel name, and different users get isolated channels.
- **Filter:** `buyer_user_id=eq.<userId>` on the `orders` table.
- **Events subscribed:** `INSERT`, `UPDATE`, `DELETE` (use `event: "*"`).
- **Payload handling:** payload is not inspected — the hook invalidates the cache unconditionally on any event. The existing `useBusinessEventOrders` query then re-runs and re-fetches the canonical list. This avoids drift between optimistic patches and server truth.
- **Cleanup:** `supabase.removeChannel(channel)` on unmount or `userId` change.

---

## Success criteria

| # | Criterion | Verifies |
|---|-----------|----------|
| **SC-1** | After a successful PaymentIntent finalize on the consumer iOS app, the new ticket appears on the Tickets tab within 2 seconds without backgrounding+foregrounding the app. The 3-attempt-over-3-seconds invalidate loop remains as a fallback (not the primary mechanism). | H-1 iOS |
| **SC-1-Android** | Same as SC-1 but on the consumer Android app. Parity is automatic (shared code path); duplicated for tester unambiguity. | H-1 Android |
| **SC-2** | When the consumer app starts up without a signed-in user (`user?.id` undefined), the `useOrdersRealtimeSubscription` hook opens NO Supabase channel. Verified by inspecting `supabase.getChannels()` length before vs after mounting `CalendarTab` while unauthenticated. | safe-when-anonymous |
| **SC-3** | When the signed-in user logs out (`user?.id` transitions from defined to undefined), the previously-opened orders channel is removed. Verified by `supabase.getChannels()` length returning to baseline post-logout. | cleanup |
| **SC-4** | If the `orders` table is NOT in the `supabase_realtime` publication, the implementor reports this as a blocker before code ships. (Tested by the Step 1 SQL probe.) | publication gate |

---

## Invariants

### Preserved invariants

- **One owner per truth** — `["businessEventOrders", userId]` remains the single React Query key for consumer-side order state. The realtime hook does NOT create a parallel cache; it only triggers invalidation of the existing one.
- **No silent failures** — realtime subscription failure falls back to existing `refetchOnWindowFocus` + 3-attempt invalidate loop; nothing breaks if realtime is unavailable.
- **Logout clears everything** — channel removal on `userId` change ensures no stale subscription survives a sign-out.

### NEW invariant

None. This spec is a narrowly-scoped UX freshness improvement; it does not establish new system rules.

---

## Test cases

### Implementor happy-path test (required by ORCH-0840 Step 0.5 gate)

| ID | Test path | Scenario | Layer |
|---|-----------|----------|-------|
| T-IMPL-1 | `app-mobile/src/hooks/__tests__/useOrdersRealtimeSubscription.test.ts` | Mock `supabase.channel` + `queryClient`. Mount the hook with `userId='u1'`. Simulate a `postgres_changes` INSERT event payload. Assert: `queryClient.invalidateQueries` is called exactly once with `{ queryKey: ["businessEventOrders", "u1"] }`. Unmount the hook. Assert: `supabase.removeChannel` is called exactly once with the channel returned by the mock. | Hook |

Must pass on the fixed code AND fail when the hook body is reverted to a no-op. Cite `fails-on-revert verified at <commit hash>` in the implementation report.

### Tester adversarial test (required by ORCH-0840 Step 0.5 gate)

| ID | Test path | Adversarial angle | Layer |
|---|-----------|-------------------|-------|
| T-ADV-1 | `app-mobile/src/hooks/__tests__/useOrdersRealtimeSubscription_lifecycle.test.ts` | Unmount the hook BEFORE the mocked `channel.subscribe()` promise resolves. Then resolve it. Assert: no `queryClient.invalidateQueries` call fires after unmount AND no "channel still open" reference leak (verified by tracking `removeChannel` call count). Also tests the `userId` change path: mount with `userId='u1'`, then re-render with `userId='u2'`. Assert: `removeChannel` called for u1's channel, new channel opened for u2, events fired on u2's channel invalidate `["businessEventOrders","u2"]` not `["businessEventOrders","u1"]`. | Lifecycle / cleanup |

Adversarial angle differs from T-IMPL-1: T-IMPL-1 covers the happy-path mount→event→invalidate→unmount; T-ADV-1 covers the timing edge cases (unmount-before-subscribe, userId-change-mid-flight) where lifecycle bugs typically hide.

---

## Implementation order

1. **Publication check (read-only SQL probe via Management API).** Run the SQL above. If `orders` is not in `supabase_realtime`, write the implementation report's "Blockers" section citing this, stop, and surface to operator. Do NOT write code until the publication is enabled.

2. **`app-mobile/src/hooks/useCalendarEntries.ts` — add `useOrdersRealtimeSubscription`.** Implement per the contract above. Verify the Supabase client import path matches the project's existing usage (grep for `supabase.channel(` or `from "@supabase/supabase-js"` to confirm).

3. **`app-mobile/src/hooks/__tests__/useOrdersRealtimeSubscription.test.ts` — add T-IMPL-1.** Mock supabase + queryClient. Run via the project's existing Jest config (`cd app-mobile && yarn test useOrdersRealtimeSubscription`). Cite passing run + `fails-on-revert verified at <commit hash>` in the implementation report.

4. **`app-mobile/src/components/activity/CalendarTab.tsx` — add one import + one hook call.** No render change.

5. **TypeScript check.** Run `cd app-mobile && npx tsc --noEmit` (or the project's standard typecheck command). Cite passing run.

6. **Implementation report.** Write at `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0851_CONSUMER_TICKET_ORDER_VISIBILITY_AND_AUTH_EMAIL.md` with:
   - Step 1 SQL probe result (publication check).
   - Old→new receipts for `useCalendarEntries.ts` and `CalendarTab.tsx`.
   - T-IMPL-1 passing run output and `fails-on-revert verified at <commit>` line.
   - Typecheck passing run output.
   - Any blockers (or "none").

7. **No deploy step.** Pure client-side change. Ships via the next EAS update on the dev/production branch after CLOSE.

---

## Regression prevention

- **Three fallback layers remain intact** so a realtime regression cannot silently break post-purchase freshness: (1) the new realtime sub, (2) the existing `refetchOnWindowFocus: true` on `useBusinessEventOrders`, (3) the existing 3-attempt-over-3-seconds invalidate loop in `ExpandedBusinessEventSheet.tsx`.
- **Two regression tests** — T-IMPL-1 (happy-path) and T-ADV-1 (lifecycle) — land in the append-only test ledger per ORCH-0840.
- **No new CI gate / strict-grep rule** needed; the realtime sub is a single hook in a single file, and the fallback layers protect against regressions of the realtime path itself.

---

## Discoveries deferred (recorded for posterity)

- **O-1** — no separate Orders view in consumer app. Operator ruled by design 2026-05-17.
- **R-1** — public event page free-text form. Operator ruled by design 2026-05-17.
- **R-2** — cc safety net to auth_email. Operator ruled by design 2026-05-17 (the typed email is the intended recipient; an unsolicited cc would contradict the design).
- **D-1** — business app post-Apple-Pay navigation stall (from prior investigation). Register as separate ORCH if it resurfaces.
- **D-2** — web Apple Pay Vercel deploy (ORCH-0849 round 3). Tracked separately.
- **D-4** — buyer name/phone divergence on public-page purchases. By design per R-1's ruling.
- **Real gifting** (recipient owns the ticket in their own Mingla account, claim flow, "from <buyer>" branding) — separate future product question. Not registered.

---

## Confidence

**High.** Single contained hook + single-line component touch + one publication check. Three existing fallback layers protect against regression. No schema, no edge function, no migration, no UX change visible to the buyer. Implementor can ship this in one short pass.

Working tree: `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`.
