# Layer Inspection Guide

What to check at every layer during investigation. Do not skim. Read the actual code.

---

## Layer 1: Components

| Check | What You're Looking For |
|-------|------------------------|
| Props | Missing types, `any`, unused props, wrong prop names |
| States | Are loading/error/empty/populated ALL handled? Is there a blank screen path? |
| Conditional rendering | Is `&&` short-circuiting hiding errors? Is falsy `0` showing as text? |
| Stale closures | Are callbacks capturing stale state? Check `useCallback` deps. |
| Event handlers | Do async handlers catch errors? Do they show feedback to users? |
| Navigation | Uses `setCurrentPage` (Mingla), NOT React Navigation |
| Style | `StyleSheet.create` only (mobile). Tailwind classes (admin). No inline objects. |
| Accessibility | Labels on all interactive elements? Roles correct? |
| Haptics | Appropriate feedback on swipe, save, error? |
| Layout | Does it handle safe areas? Keyboard avoidance? Long text overflow? |

**Red flags:**
- `data && <Component />` where data could be `[]` (empty = no render, no empty state)
- Missing `isLoading` / `isError` checks before rendering data
- `onPress={() => someAsyncThing()}` with no error handling
- Hardcoded strings that should be localized or from constants

---

## Layer 2: Hooks

| Check | What You're Looking For |
|-------|------------------------|
| Query key | From factory? Contains ALL parameters that affect result? |
| `enabled` | Gates on required dependencies? Doesn't fire with undefined params? |
| `staleTime` | Intentional? Matches data freshness requirements? |
| Mutations | Every mutation has `onError`? Shows user-facing feedback? |
| Invalidation | `onSuccess` invalidates correct keys via factory? No inline invalidation? |
| Race conditions | Any `invalidateQueries` in same async block as mutation call? |
| Return type | Explicit? Matches what components expect? |
| Optimistic updates | If present: do they rollback on error? |
| Dependencies | `useEffect` deps complete? Missing deps = stale closures. |
| Data transformation | Happens in hook or component? Is it memoized if expensive? |

**Red flags:**
- Hardcoded query key: `['my-data', id]`
- Missing `enabled: !!userId` → fires with undefined, gets wrong/empty data
- `onSuccess` calls `invalidateQueries` with string key instead of factory
- `useEffect` with missing dependencies
- Multiple hooks fetching the same data with different keys

---

## Layer 3: Services

| Check | What You're Looking For |
|-------|------------------------|
| Error handling | Does it throw on error or silently return fallback? |
| `.single()` vs `.maybeSingle()` | `.single()` on potentially empty result = crash |
| Select fields | `select('*')` when only 3 fields needed? Over-fetching? |
| Filters | Correct column names? Correct operators? Missing filters? |
| Return types | Explicit? Match what hooks expect? |
| Null handling | What happens if Supabase returns null? Does caller handle it? |
| Transitional markers | Are fallback returns marked `[TRANSITIONAL]`? |

**Red flags:**
- `catch () { return null }` — silent failure, caller shows empty instead of error
- `catch () { return [] }` — silent failure, caller shows "nothing here" instead of error
- `catch () { return true }` — silent failure, caller thinks operation succeeded
- `.single()` without guarantee that row exists
- Missing `.eq('user_id', userId)` filter → data leak

---

## Layer 4: Edge Functions

| Check | What You're Looking For |
|-------|------------------------|
| Auth | Validates auth at entry? Gets user from token? |
| Input validation | Checks required fields? Validates types? Rejects malformed? |
| Response shape | Consistent success/error structure? Correct status codes? |
| Error handling | External API failures caught? Timeouts? Structured error response? |
| Third-party calls | Use `withTimeout`? Handle rate limits? Cache where appropriate? |
| RLS bypass | Using service role? Is that intentional and safe? |
| Idempotency | Safe to retry? Or could double-execution cause damage? |

**Red flags:**
- No auth check at function entry
- `const { data } = await req.json()` with no validation
- External API call with no timeout
- Catch block that returns 200 with error in body (masks failure)
- Service role used when user role would work (over-privilege)

---

## Layer 5: Database / RLS / Migrations

| Check | What You're Looking For |
|-------|------------------------|
| RLS enabled | `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` present? |
| Policy coverage | SELECT, INSERT, UPDATE, DELETE policies for all needed operations? |
| Policy correctness | `auth.uid() = user_id`? No overly permissive `USING (true)`? |
| Constraints | NOT NULL on required fields? CHECK constraints on enums? |
| Foreign keys | Correct references? CASCADE behavior intentional? |
| Indexes | On frequently queried columns? On foreign keys? |
| Defaults | Sensible? `gen_random_uuid()` for PKs? `now()` for timestamps? |
| Migration ordering | Timestamp-based? Dependencies in correct order? |

**Red flags:**
- Table without `ENABLE ROW LEVEL SECURITY`
- Policy with `USING (true)` on user data table → anyone can read
- Missing FK constraint → orphaned records possible
- Missing NOT NULL → silent data corruption
- Index missing on join column → slow queries at scale

---

## Layer 6: State Boundaries (Cross-Layer)

| Check | What You're Looking For |
|-------|------------------------|
| React Query vs Zustand | Is server-fetched data in Zustand? (violation) |
| Zustand vs Context | Is ephemeral UI state in Zustand? (usually should be Context or local) |
| AsyncStorage shape | Has the persisted shape changed? Is there a version migration? |
| Cache consistency | After a mutation, do ALL cached queries reflect the change? |
| Sign-out cleanup | Does sign-out clear this state? All of it? |

**Red flags:**
- Zustand store with `userProfile`, `savedCards`, or any API response
- AsyncStorage key without schema versioning
- Mutation that changes data but doesn't invalidate the query that reads it
- New persistent state that isn't cleared on sign-out

---

## Cross-Domain Checks

Always verify when a change spans domains:

| Change In | Also Check |
|-----------|-----------|
| Database schema | All edge functions that query this table |
| Edge function response shape | All services that call this function |
| Service return type | All hooks that call this service |
| Hook data shape | All components that consume this hook |
| Query key structure | All invalidations that target this key |
| RLS policy | All edge functions using user role (not service role) |
| Admin dashboard | Mobile equivalent of same feature |
| Mobile feature | Admin dashboard management of same data |
