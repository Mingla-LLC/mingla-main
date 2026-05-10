# Production Verification Protocol

How to verify implementations against actual runtime behavior and persisted data,
not just code reading. Code can look correct and still fail in production.

---

## When to Use

- After every TARGETED test that touches data flow
- When implementation claims "tested on device" without evidence
- When the change involves cache, persistence, or state management
- When the change touches auth, payments, or notification paths
- When production data might differ from development assumptions

---

## Database Verification

### Schema Validation
```sql
-- Verify table exists with expected columns
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = '[table]'
ORDER BY ordinal_position;

-- Verify constraints
SELECT constraint_name, constraint_type
FROM information_schema.table_constraints
WHERE table_name = '[table]';

-- Verify indexes
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = '[table]';
```

### RLS Verification
```sql
-- Verify RLS is enabled
SELECT relname, relrowsecurity
FROM pg_class
WHERE relname = '[table]';

-- List all policies
SELECT policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies
WHERE tablename = '[table]';
```

### Data Integrity Spot Checks
- [ ] Query for NULL in NOT NULL columns (migration might not have backfilled)
- [ ] Query for orphaned foreign keys (FK added but old data not cleaned)
- [ ] Query for duplicate unique violations (constraint added but duplicates exist)
- [ ] Query for enum values outside CHECK constraint (data predates constraint)
- [ ] Count rows to verify expected data volume (empty table = seeding issue)

---

## Edge Function Verification

### Request/Response Validation
For each edge function changed, construct test requests:

```bash
# Success case
curl -X POST https://[project].supabase.co/functions/v1/[function] \
  -H "Authorization: Bearer [user_token]" \
  -H "Content-Type: application/json" \
  -d '{"valid": "input"}'

# Missing auth
curl -X POST https://[project].supabase.co/functions/v1/[function] \
  -H "Content-Type: application/json" \
  -d '{"valid": "input"}'
# Expected: 401

# Malformed input
curl -X POST https://[project].supabase.co/functions/v1/[function] \
  -H "Authorization: Bearer [user_token]" \
  -H "Content-Type: application/json" \
  -d '{"invalid": true}'
# Expected: 400

# Wrong user (IDOR check)
curl -X POST https://[project].supabase.co/functions/v1/[function] \
  -H "Authorization: Bearer [other_user_token]" \
  -H "Content-Type: application/json" \
  -d '{"target_user_id": "[victim_id]"}'
# Expected: 403 or 404
```

### Response Shape Verification
- [ ] Success response matches the TypeScript interface in the service?
- [ ] Error response matches the structured error format?
- [ ] No unexpected fields in response?
- [ ] No sensitive fields in response (internal IDs, admin flags)?

---

## Cache & State Verification

### React Query Cache
Mentally trace the cache lifecycle:

1. **Initial load:** What query key is used? What data is fetched?
2. **After mutation:** Which keys are invalidated? Does the UI refresh?
3. **After navigation away and back:** Is stale data shown or fresh data fetched?
4. **After background → foreground:** Does `useForegroundRefresh` fire? What refreshes?
5. **After preference change:** Does the deck reset? Are old cards purged?

### Zustand Persistence
- [ ] After killing and reopening the app, does Zustand hydrate correctly?
- [ ] Does `_hasHydrated` gate prevent rendering before hydration?
- [ ] If Zustand schema changed, does the version migration handle old data?

### AsyncStorage
- [ ] What happens if AsyncStorage has data from a previous app version?
- [ ] What happens if AsyncStorage is empty (fresh install)?
- [ ] What happens if AsyncStorage has corrupt data?

---

## Auth State Verification

### Token Lifecycle
1. Sign in → verify token exists and is valid
2. Wait for expiry → verify refresh fires automatically
3. Background app → foreground → verify session restored
4. Kill app → reopen → verify session survives
5. Sign out → verify ALL state cleared
6. Sign in as different user → verify NO data from previous user

### Edge Case: Expired Token Mid-Operation
1. Start a mutation (save card)
2. Simulate token expiry during mutation
3. Verify: retry with refreshed token or graceful error (not crash)

---

## Realtime Verification

If the change involves Supabase Realtime:
- [ ] Subscription established on mount?
- [ ] Subscription removed on unmount?
- [ ] Events received update the correct cache/state?
- [ ] Reconnection after network loss works?
- [ ] Duplicate events handled (idempotent processing)?
- [ ] Wrong-user events filtered out?

---

## Notification Verification

If the change involves notifications:
- [ ] Push delivery confirmed on both iOS and Android?
- [ ] Deep link from notification opens correct screen?
- [ ] Notification for deleted content handled gracefully?
- [ ] Notification preferences respected (type toggled off = no send)?
- [ ] Quiet hours enforced?
- [ ] Badge count updates correctly?

---

## Payment Verification

If the change involves subscriptions/payments:
- [ ] Free → Pro upgrade reflects immediately?
- [ ] Pro → Free downgrade locks features immediately?
- [ ] Trial expiry locks features correctly?
- [ ] Restore purchases works?
- [ ] RevenueCat entitlement matches DB state?
- [ ] Admin override takes precedence?

---

## Cross-Device Verification

- [ ] Same account on iOS and Android shows same data?
- [ ] Action on one device reflects on other device (within staleTime)?
- [ ] Sign out on one device doesn't crash the other?

---

## Offline Verification

- [ ] App opens without network (persisted state)?
- [ ] Clear error message when attempting mutations offline?
- [ ] Mutations retry when network returns (or user retries manually)?
- [ ] No crash on airplane mode toggle?
- [ ] Location features degrade gracefully without GPS?

---

## How to Report Production Verification

In the QA report, add a section:

```
## Production Verification

| Check | Method | Result | Evidence |
|-------|--------|--------|----------|
| [what was verified] | [SQL query / curl / mental trace] | PASS/FAIL | [output or finding] |
```
