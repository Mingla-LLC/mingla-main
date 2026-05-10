# Error, Query, And State Contracts

## Golden Error Flow

`Database enforces -> Edge/RPC validates -> Service throws/Result -> Hook catches -> Component renders/toasts`

Every layer may add context. No layer may pretend failure is success.

## Database / RLS

- Constraint errors become validation/conflict errors.
- FK errors become "item no longer exists" style errors.
- Unique conflicts are idempotent when product intent allows; otherwise clear conflict errors.
- RLS denials are permission errors, not empty states.

## Edge Functions

Response shape:

```typescript
type Success<T> = { data: T };
type Failure = {
  error: string;
  code: string;
  details?: Record<string, unknown>;
};
```

Status codes:

- `400`: validation.
- `401`: missing/invalid auth.
- `403`: wrong actor/permission.
- `404`: target missing.
- `409`: conflict/invalid state transition.
- `422`: valid shape but invalid business rule.
- `500`: unexpected internal error.
- `502/504`: upstream failure/timeout.

Rules:

- Auth check at entry.
- Input validation before DB writes.
- No SQL/stack/secrets in response.
- Timeouts for external calls.
- Idempotency for retries on money/order/ticket/notification writes.

## Services

Rules:

- Supabase `error` is checked.
- Throw errors with enough context for hooks/logs, not raw secret data.
- Use `.maybeSingle()` if no row is acceptable.
- Do not swallow failures as empty arrays.

## Hooks

Rules:

- Mutations define `onError` and `onSuccess`.
- Optimistic updates define rollback.
- Invalidation uses canonical keys.
- Queries have `enabled` gates and intentional freshness.
- Hook return type gives components enough status to render states.

## Components

Render:

- Loading: skeleton/spinner appropriate to surface.
- Error: clear message plus retry/recovery.
- Empty: honest guidance, not fake data.
- Populated: real data.
- Submitting: disable double-submit and show progress.
- Offline/permission: explicit reason and recovery.

## Query Key Discipline

Checklist:

- Key from factory/registry.
- Includes all filters, actor IDs, session IDs, locale/currency/time/location inputs that affect result.
- Stable serialization for arrays/objects.
- Rounded GPS if used.
- Invalidation in `onSuccess`.
- Cross-entity invalidation documented.

## State Ownership

Authority map:

- DB: persisted truth.
- Edge/RPC: trusted business transition.
- React Query: server state cache.
- Zustand: client-only UI/nav/local or documented startup/offline state.
- AsyncStorage: persisted client cache with versioning and logout cleanup.
- Admin/business direct Supabase calls: must match RLS and domain contracts.

If two owners disagree, remove the competing owner or document the transitional bridge.
