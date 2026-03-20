# Forensic Investigation Reference

## Table of Contents
1. Five Truth Layers
2. Layer-by-Layer Inspection Checklist
3. Forensic Domain Checklist
4. Hidden Issue Hunting
5. Failure Classes
6. Common Mingla Failure Patterns

---

## 1. Five Truth Layers

Weak reviewers stop at docs and code. Inspect all five and look for contradictions:

| Layer | What It Is | What It Tells You |
|-------|-----------|-------------------|
| **Docs** | README, architecture doc, comments | What someone CLAIMS the system does |
| **Schema** | Tables, columns, constraints, RLS, indexes | What the database ENFORCES |
| **Code** | Services, hooks, edge functions, components | What the application EXECUTES |
| **Runtime** | Request traces, console logs, network calls | What ACTUALLY HAPPENS end to end |
| **Data** | Actual rows, nulls, orphans, duplicates | What REALLY EXISTS in production |

When layers contradict each other:
- Data beats everything (it's the ground truth)
- Schema beats code (constraints enforce what code may forget)
- Code beats docs (execution is behavior, docs are claims)
- Runtime beats static analysis (timing, ordering, concurrency are only visible at runtime)

---

## 2. Layer-by-Layer Inspection Checklist

### Component Layer
- Data access without null checks?
- Loading/error/empty states all handled?
- Stale closure capturing old values?
- Key prop missing or duplicated on list items?
- Conditional rendering (`&&` / ternary) hiding content silently?
- Re-renders causing flicker or layout thrash?
- Haptic feedback wired to interactions?
- StyleSheet.create() used (not inline styles)?

### Hook Layer
- Query key includes ALL filter params that affect the result?
- queryFn calls the right service with right arguments?
- staleTime appropriate? (5min user data, 24h place details, 0 real-time)
- `enabled` accidentally false? (`enabled: !!userId` when userId is undefined)
- `select` transform silently dropping or reshaping data?
- onError swallowing errors silently?
- Mutation invalidating ALL the right query keys?
- Optimistic update shape matching real server response shape?
- Infinite query: getNextPageParam returning undefined when more pages exist?

### Service Layer
- `.select('*')` pulling nonexistent or renamed columns?
- `.single()` on a query that can return 0 or 2+ rows?
- Error destructuring: checking `{ data, error }` from Supabase, not assuming `data` exists?
- Return type matching what Supabase actually returns?
- `await` on every async call? (missing await = promise object treated as data)
- Response from edge function: `await response.json()` with the `await`?

### Edge Function Layer
- CORS headers on BOTH success AND error responses?
- OPTIONS preflight handler present?
- Input validation on every field before processing?
- Auth: creating Supabase client with user's JWT, not service key?
- Error status codes: 400/401/500, NOT all 200s?
- JSON parsing: `await req.json()` inside try/catch?
- External API: correct URL, correct headers, correct field mask?
- Timeout handling for external API calls?
- Idempotent: safe if called twice?

### Google Places API
- Using New API (`places.googleapis.com/v1/`), NOT legacy (`maps.googleapis.com/maps/api/place/`)?
- Auth via `X-Goog-Api-Key` header, NOT query param?
- `X-Goog-FieldMask` present and matching what code reads from response?
- Price level: enum string (`PRICE_LEVEL_MODERATE`), NOT number (`2`)?
- `displayName` is `{ text: string, languageCode: string }`, NOT flat string?
- `location` is `{ latitude: number, longitude: number }`, NOT `{ lat, lng }`?
- `places` array may be ABSENT from response (not empty array — literally missing key)?
- Distance Matrix called AFTER type/price filtering, NOT before?

### Database & RLS
- RLS policy column names matching actual table column names?
- No policy using `USING (true)` without good reason?
- Policies exist for EVERY operation the app performs (SELECT, INSERT, UPDATE, DELETE)?
- Column types matching what code sends (UUID string vs number, TIMESTAMPTZ vs TEXT)?
- NOT NULL columns have DEFAULT values?
- Foreign keys with explicit ON DELETE (CASCADE where appropriate)?
- Indexes on columns used in WHERE clauses and JOINs?
- Uniqueness constraints where business logic requires uniqueness?
- Check constraints where values have bounded valid ranges?

### State & Cache
- Zustand persisted shape matching current TypeScript interface?
- Server-derived data stored in Zustand instead of React Query?
- Two hooks using the same query key for different data (collision)?
- AsyncStorage containing cached data from old schema version?
- Stale closures in useCallback/useMemo capturing old state?

---

## 3. Forensic Domain Checklist

Run on every investigation and every feature design.

### Domain Truth
- What is the source of truth for this data?
- What is derived and regeneratable?
- What is cached? With what TTL? What invalidates it?
- What is user-generated vs machine-generated?
- What can be safely rebuilt vs must be preserved?

### Data Integrity
- Can orphaned references exist?
- Are constraints in schema or only in application code?
- Are deletions consistent across all referencing tables?
- Are counters derived from source or maintained independently? Can they drift?
- What tables grow forever without retention policy?
- Arrays stored where relational tables should exist?
- Nullable fields that violate business truth?

### Lifecycle
- Who creates this entity? Who updates it? Who deactivates it? Who deletes it?
- Who cleans up old/stale rows?
- What runs on schedule? How is the schedule monitored?
- Is there a creation path without a corresponding cleanup path?

### Reliability
- What if this job never runs?
- What if it runs twice?
- What if it partially succeeds?
- What if it runs out of order?
- What if refresh keeps failing?
- What if deletion happens during generation?
- What if a scheduler silently stops?

### Product Impact
- Can this serve broken data to users?
- Can this show stale content?
- Can this corrupt analytics?
- Can this create hidden performance degradation?
- Trace the full chain: schema flaw → runtime behavior → user impact → business risk

### Operability
- How do we detect this failure?
- How do we repair it?
- How do we backfill if data is corrupted?
- How do we verify correctness after deploy?

---

## 4. Hidden Issue Hunting

Actively hunt for these — they survive code review because nobody looks for them:

- Functions that exist but are never called
- Columns that exist but aren't documented or read
- Fields written but never read
- Fields read but never maintained
- Soft deletes inconsistently filtered (some queries filter, others don't)
- Counters denormalized but never reconciled with source
- Migrations that changed shape but not the assumptions depending on the old shape
- Cron-dependent logic with no scheduler actually calling it
- Backfills that were planned but never executed
- Invariants enforced in one code path but not another
- Stale caches with no invalidation trigger
- Logical resets that filter but never physically delete
- Status flags with no authoritative lifecycle definition
- "Cleanup" functions that exist but nothing invokes them

---

## 5. Failure Classes

Probe every system under investigation for these:

| Class | What to Look For |
|-------|-----------------|
| Integrity | Orphaned rows, broken FKs, constraint violations, duplicate IDs |
| Lifecycle | Created never cleaned, deactivated still referenced, deleted still cached |
| Scheduler | Jobs that should run but don't, run but aren't monitored, run twice |
| Data drift | Source and derived disagreeing, counters out of sync, stale aggregates |
| Orphaning | Records referencing deleted parents, cached data for removed entities |
| Stale state | React Query serving old data, Zustand persisting outdated shapes |
| Concurrency | Two mutations same row, optimistic update conflicting with server |
| Observability | Errors swallowed, 200s hiding failures, no logging on critical paths |
| Performance | Unbounded table growth, missing indexes, N+1 queries, full scans |
| Migration | Irreversible schema changes, data loss on rollback, dual-schema gaps |
| Rollback | New code depending on new schema, old code breaking on new data shape |
| Ownership | No clear owner for a table, edge function, or scheduled job |

---

## 6. Common Mingla Failure Patterns

Check these first on any investigation — they cover 80% of Mingla bugs:

| # | Pattern | Symptom | Where to Look |
|---|---------|---------|--------------|
| 1 | RLS policy mismatch | Empty screen / "no data" | Table RLS — column names match? |
| 2 | Query key missing param | Stale data after filter change | Hook — key includes all filters? |
| 3 | Missing cache invalidation | "Saved but nothing changed" | Mutation onSuccess — right keys? |
| 4 | CORS on error path only | Opaque network error | Edge function catch — CORS headers? |
| 5 | `.single()` on 0-or-many | Random crashes | Service — can return ≠1 rows? |
| 6 | Field mask gap | `undefined` in place data | Edge function — mask includes field? |
| 7 | Missing `await` | `[object Promise]` in UI | Service/hook — all async awaited? |
| 8 | Zustand stale shape | Crash on app open | Store — shape matches interface? |
| 9 | staleTime too long | Data doesn't update | Hook — cached data stale? |
| 10 | Edge returns 200 on error | Error treated as data | Edge function — status codes? |
| 11 | Optional chaining mask | Silent wrong behavior | Any layer — `?.` hiding undefined? |
| 12 | Missing ON DELETE CASCADE | Orphaned rows | Migration — FK cascade? |