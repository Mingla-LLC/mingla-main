# Spec Layer Guide

A spec must remove ambiguity. Include every affected layer; write "None" only when you can explain why the layer is unaffected.

## Database And RLS

Include:

- Migration filename and order.
- Exact SQL for tables, columns, constraints, indexes, triggers, functions, views, and policies.
- RLS enabled for user data.
- CRUD policy coverage for each actor.
- Backfill, data migration, and rollback plan.
- Latest-migration/decommissioning conflicts checked.

Checklist:

- Required fields have `NOT NULL`.
- Enum/status values have checks or canonical lookup.
- FK and cascade/restrict behavior match product intent.
- Indexes cover filters, joins, ordering, and uniqueness.
- Wrong actor cannot read/write.

## Edge Functions, RPCs, Webhooks

Include:

- Function/RPC/webhook name and route.
- Auth/role check at entry.
- Request schema and validation rules.
- Success response schema.
- Error response schema with status codes and stable codes.
- External API calls, timeouts, retries, idempotency, caching.
- Service-role justification if used.
- Deploy command or deploy note.

Checklist:

- Money/order/ticket writes are idempotent.
- Webhook signature verification is named.
- Errors are structured and not reported as success.
- No secrets in responses/logs.

## Service Layer

Include:

- Exact file path and function signature.
- Supabase/client query shape.
- Return type.
- Error contract: throws, returns `Result`, or transitional fallback with exit condition.
- Actor and permission assumptions.

Checklist:

- Select only needed fields.
- Use `.maybeSingle()` where zero rows are valid.
- Caller can distinguish empty from error.

## Hook, State, And Cache

Include:

- Hook name and path.
- Query key from canonical factory or registry, with every parameter listed.
- `enabled`, `staleTime`, retry behavior, and offline behavior.
- Mutation service call.
- Optimistic update and rollback.
- `onSuccess` invalidation/update via factory.
- `onError` user-facing feedback.
- Zustand/AsyncStorage changes, hydration, versioning, sign-out cleanup.

Checklist:

- No duplicate server-state owner.
- Stale cache cannot display after mutation.
- Cold start and background/foreground behavior defined.

## Component And Screen

Include:

- Component/screen path and props.
- State machine table: loading, error, empty, populated, submitting, offline/permission if relevant.
- Exact user-facing copy where material.
- Interactions and handlers.
- Accessibility labels.
- Haptics where product convention expects them.
- Layout constraints for mobile and web.

Checklist:

- No dead taps.
- No fabricated data.
- Error includes recovery path.

## Business, Admin, Public Web

Include:

- Any organiser/admin/public surface changes.
- Field/status/permission parity with mobile/backend.
- Operational workflow needed to support the feature.
- Admin-only dependency, moderation, support, or reconciliation path.

Checklist:

- Admin cannot create impossible states.
- Business/public flow agrees with DB and edge contracts.
- Finance/order/ticket states are auditable.

## Realtime, Notifications, Analytics

Include:

- Channel names, filters, event types, and cleanup behavior.
- Notification trigger, preference checks, quiet hours, deleted-content behavior.
- Analytics event names, firing point, properties, and failure behavior.

Checklist:

- Subscriptions clean up on unmount/sign-out.
- Notifications respect preferences and actor visibility.
- Analytics does not block user-visible actions.

## Test Matrix

Every spec should include at least:

- Happy path.
- Error path.
- Empty/no-data path.
- Wrong actor/RLS path if data is user-scoped.
- Stale cache/cold start path if client state is involved.
- Solo/collab or business/admin/public parity when relevant.
- Migration/rollback verification if schema changes.

Format:

`ID | Scenario | Input/setup | Expected | Layer | Verification command/manual check`

## Implementation Order

Default order:

1. Database/migrations.
2. Edge/RPC/webhook.
3. Services/client contracts.
4. Hooks/state/cache.
5. Components/screens.
6. Business/admin/public parity.
7. Tests and fixtures.
8. Artifact updates and deploy notes.

For tiny fixes, compress the order but keep dependency order intact.
