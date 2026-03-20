# Mingla Reliability Reference

## Table of Contents
1. The Mingla Stack — Reliability View
2. Five Truth Layers
3. Failure Patterns Catalog
4. Review Checklist
5. Layer-by-Layer Reliability Inspection
6. Common Mingla Production Issues

---

## 1. The Mingla Stack — Reliability View

**Mobile:** React Native (Expo), TypeScript strict, React Query (server state), Zustand
(client state only), StyleSheet.create, custom state-driven navigation, expo-haptics,
expo-location, expo-calendar.

**Backend:** Supabase (Postgres + Auth + Realtime + Storage), 25 Deno Edge Functions,
OpenAI GPT-4o-mini.

**External APIs:** Google Places API (New), Distance Matrix, OpenWeatherMap, BestTime.app,
Resend, Expo Push, Stripe Connect, OpenTable, Eventbrite, Viator.

**Hard rules (violations are frequent root causes):**
- All third-party API calls through edge functions — never from mobile
- RLS enforces all database access — no exceptions
- React Query for server state; Zustand for client-only state
- AsyncStorage persists both React Query cache and Zustand
- TypeScript strict — no `any`, no `@ts-ignore`
- Google Places: v1 endpoints only, field masks, 24h caching, batched distance

**Key file locations:**
```
app-mobile/
├── components/    # ~80+ UI components
├── hooks/         # ~28 React Query hooks
├── services/      # ~53 service files
├── store/         # Zustand (1 file)
├── types/         # TypeScript types
├── constants/     # Design tokens, config
supabase/
├── functions/     # 25 Deno edge functions
├── migrations/    # 30+ SQL migrations
```

---

## 2. Five Truth Layers

Inspect all five on every audit. Weak reviewers stop at docs and code.

| Layer | What It Is | What It Tells You |
|-------|-----------|-------------------|
| **Docs** | README, architecture doc, comments | What someone CLAIMS |
| **Schema** | Tables, constraints, RLS, indexes | What the database ENFORCES |
| **Code** | Services, hooks, edge functions | What the application EXECUTES |
| **Runtime** | Request traces, logs, network calls | What ACTUALLY HAPPENS |
| **Data** | Actual rows, nulls, orphans, dupes | What REALLY EXISTS |

When layers contradict: Data > Runtime > Schema > Code > Docs.

---

## 3. Failure Patterns Catalog

### The Lying UI
Screen shows stale data, fake empty state, or "success" when mutation failed. Caused by:
wrong React Query key, missing cache invalidation after mutation, swallowed error in service.

**How to detect:** Compare what the UI shows vs what the database contains after the action.
**How to fix:** Make the UI truthful — show the real state, even if it's ugly.

### The Silent Crash
App crashes under specific conditions. Caused by: `.single()` on 0-or-many, missing null
check on optional data, unhandled promise rejection in async callback.

**How to detect:** Test with empty data, missing data, multiple rows, network failure.
**How to fix:** Replace `.single()` with `.maybeSingle()`, add null checks, catch rejections.

### The Race Condition
Two operations interfere. Common: rapid navigation causing stale query callbacks, optimistic
updates conflicting with server, multiple Realtime subscriptions on same cache key.

**How to detect:** Rapid-fire the action (tap fast, navigate fast, submit twice).
**How to fix:** Debounce, cancel stale callbacks, use idempotency keys, mutex patterns.

### The Stale Cache
Data updated but UI shows old state. Caused by: mutation not invalidating right keys, query
key missing a parameter that affects results, staleTime too long.

**How to detect:** Mutate data, then immediately check the UI that reads it.
**How to fix:** Verify invalidation keys match query keys exactly. Check staleTime.

### The Auth Gap
Edge function missing auth check, or RLS policy with gap invisible in dev but exposed in prod.

**How to detect:** Call edge function without auth token. Query table as different user.
**How to fix:** Add auth verification. Test RLS as non-owner. Test as unauthenticated.

### The Masked Error
Catch block swallows real error and returns fallback. UI looks fine but action didn't persist.
**Most dangerous pattern** because it looks like working code.

**How to detect:** Intentionally cause the error (kill network, corrupt input). Does the UI
acknowledge the failure, or does it pretend everything is fine?
**How to fix:** Remove catch-all fallbacks. Let errors surface. Make failure visible.

### The Orphaned Data
Records that reference deleted parents. Cached data for removed entities. Counters out of
sync with source.

**How to detect:** Query for references to non-existent IDs. Check cascading deletes.
**How to fix:** FK with ON DELETE CASCADE. Verify referential integrity with SQL queries.

### The Scheduler Ghost
Logic that depends on a scheduled job, but nothing actually invokes the job. Cleanup
functions that exist but never run.

**How to detect:** Search for function definitions that have no callers.
**How to fix:** Add scheduled invocation. Add monitoring. Add retention policy.

### The Schema Drift
Migration changed table shape, but code still assumes old shape. Types say one thing,
database says another.

**How to detect:** Compare TypeScript interfaces with actual table columns.
**How to fix:** Regenerate types from schema. Fix all consumers.

---

## 4. Review Checklist

Run this on every fix, every implementation, every claim of "done":

### Root Cause
- [ ] Is the root cause **proven**, or just plausible?
- [ ] Is there evidence (code, logs, data) confirming the diagnosis?

### Scope
- [ ] Is the scope too broad? Could this be narrower and still solve it?
- [ ] Does the fix touch only what the spec says?

### Hidden Paths
- [ ] Is there a hidden fallback path that masks the real failure?
- [ ] Is there a stale cache path that could serve old data after the fix?
- [ ] Is the warm-pool / live path inconsistent with cold start?
- [ ] Could a user hit this from a different entry point?

### Truthfulness
- [ ] Is the response shape truthful in ALL states? (loading, error, empty, populated)
- [ ] Is this a real fix, or does it mask the problem?
- [ ] If the fix fails, does the user see the failure, or is it hidden?

### Durability
- [ ] Could a future AI working on nearby code accidentally break this?
- [ ] Does the fix need a protective comment explaining why it exists?
- [ ] Is there a test or verification query that would catch a regression?

### Documentation
- [ ] Does the main README need updating?
- [ ] Does the LAUNCH_READINESS_TRACKER need updating?
- [ ] Is the tracker entry backed by evidence (not just claims)?

If any answer is "I'm not sure," the work is NOT done.

---

## 5. Layer-by-Layer Reliability Inspection

### Component Reliability
- Loading state renders correctly (skeleton, not flash of empty)?
- Error state renders correctly (message + retry, not blank screen)?
- Empty state renders correctly (illustration + CTA, not "no data")?
- Populated state handles missing optional fields without crashing?
- Rapid navigation: does unmounting cancel pending operations?

### Hook Reliability
- Query key includes ALL parameters that affect the result?
- staleTime appropriate for the data's rate of change?
- `enabled` condition correct (not accidentally disabled)?
- Mutation invalidation covers ALL affected query keys?
- Error state propagated to component (not swallowed)?

### Service Reliability
- Supabase error checked: `if (error) throw` pattern used?
- `.single()` only where exactly one row is guaranteed?
- `await` on every async call?
- Return type matches what Supabase actually returns?

### Edge Function Reliability
- CORS on success AND error responses?
- Input validation before processing?
- Auth verification (JWT, not service key)?
- Error status codes (400/401/500, not all 200)?
- External API timeout handling?
- Idempotent: safe if called twice?

### Database Reliability
- RLS policies on every table for every operation?
- Foreign keys with ON DELETE CASCADE where needed?
- NOT NULL constraints on required fields?
- Indexes on columns used in WHERE/JOIN?
- No unbounded growth without retention policy?

---

## 6. Common Mingla Production Issues

| # | Pattern | Symptom | Quick Check |
|---|---------|---------|------------|
| 1 | RLS mismatch | Empty screen | Policy column name = table column name? |
| 2 | Query key gap | Stale after filter | Key includes all filter values? |
| 3 | Missing invalidation | "Saved but no change" | Mutation onSuccess invalidates right keys? |
| 4 | CORS error path | Opaque network error | Catch block has CORS headers? |
| 5 | `.single()` crash | Random failures | Can query return 0 or 2+ rows? |
| 6 | Field mask gap | `undefined` in data | Mask includes the field code reads? |
| 7 | Missing `await` | `[object Promise]` | All async calls awaited? |
| 8 | Zustand stale shape | Crash on open | Persisted shape = current interface? |
| 9 | staleTime too long | Data won't update | Cache serving old data? |
| 10 | 200 on error | Error treated as data | Edge function status codes correct? |
| 11 | Optional chain mask | Silent wrong behavior | `?.` hiding real undefined? |
| 12 | Missing CASCADE | Orphaned rows | FK has ON DELETE? |