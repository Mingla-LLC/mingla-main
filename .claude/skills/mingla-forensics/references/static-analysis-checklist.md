# Static Analysis Checklist

Run against EVERY file read during investigation. These are defects that tests
often miss but cause production failures.

---

## TypeScript Safety

| Flag | Pattern | Severity | Why It Matters |
|------|---------|----------|---------------|
| `any` type | `variable: any`, `as any` | High | Disables type checking, hides bugs |
| `@ts-ignore` | `// @ts-ignore` | High | Suppresses errors instead of fixing them |
| `@ts-expect-error` | `// @ts-expect-error` | Medium | Slightly better than ignore but still masking |
| Unsafe cast | `as unknown as X` | High | Bypasses type system entirely |
| Missing return type | `function foo() {` (no `: ReturnType`) | Medium | Caller can't rely on shape |
| Non-null assertion | `value!.property` | Medium | Crashes if value is actually null |
| Unused variable | Declared but never read | Low | Dead code, confusion risk |
| Implicit any | Function params without types | High | Silent type hole |

## Error Handling

| Flag | Pattern | Severity | Why It Matters |
|------|---------|----------|---------------|
| Empty catch | `catch () {}` or `catch (e) {}` | Critical | Error swallowed, user thinks success |
| Console-only catch | `catch (e) { console.log(e) }` | High | Error logged but user not informed |
| Return-fallback catch | `catch () { return null/[]/true }` | High | Silent failure, wrong state |
| Missing onError | `useMutation({ mutationFn, onSuccess })` no `onError` | High | Mutation failure invisible |
| Unhandled promise | `someAsyncFn()` without `.catch()` or `try/catch` | High | Unhandled rejection crash risk |
| Swallowed Supabase error | `const { data } = await supabase...` (ignoring error) | Critical | DB failure invisible |

## Query & Cache Safety

| Flag | Pattern | Severity | Why It Matters |
|------|---------|----------|---------------|
| Hardcoded query key | `queryKey: ['my-data', id]` | High | Cache drift, stale data |
| Missing key parameter | Key doesn't include filter that affects results | High | Stale data across filter changes |
| Unserialized array in key | `queryKey: [...base, arrayValue]` | Medium | Reference identity = infinite refetch |
| Raw GPS in key | `queryKey: [...base, latitude]` | Medium | Key churn from GPS drift |
| Missing `enabled` | Query fires without required dependencies | High | Crash or wrong data |
| Inline invalidation | `await mutation(); invalidateQueries()` | High | Race condition |
| Missing invalidation | Mutation with no cache update | High | Stale UI after mutation |

## Data Integrity

| Flag | Pattern | Severity | Why It Matters |
|------|---------|----------|---------------|
| `.single()` risk | `.single()` on potentially empty result | High | Crash on no rows |
| Fabricated data | `rating ?? 4.0`, `price ?? '$$'` | High | User sees fake data |
| Missing NOT NULL | Column without NOT NULL that should require data | Medium | Silent data corruption |
| Missing RLS | Table without row-level security | Critical | Data exposure |
| Overly permissive RLS | `USING (true)` on user data | Critical | Anyone can read |
| `select('*')` | Selecting all columns unnecessarily | Low | Over-fetching, performance |

## State Boundaries

| Flag | Pattern | Severity | Why It Matters |
|------|---------|----------|---------------|
| Server data in Zustand | Zustand store holding API responses | High | Ownership conflict with RQ |
| Missing sign-out cleanup | New persistent state not cleared on logout | High | Data leak between users |
| Schema drift | AsyncStorage shape changed without version bump | High | Cold start crash |
| Duplicate state | Same data in RQ cache AND Zustand AND Context | High | Contradictions, stale data |

## UI / UX

| Flag | Pattern | Severity | Why It Matters |
|------|---------|----------|---------------|
| Missing loading state | No skeleton/spinner during async load | Medium | Blank screen flash |
| Missing error state | No error UI when query/mutation fails | High | User stuck with no feedback |
| Missing empty state | No message when data is legitimately empty | Medium | Confused user |
| Dead tap | Button/link with no handler or disabled without feedback | Medium | User frustration |
| Inline styles | `style={{ margin: 10 }}` in mobile | Low | Pattern violation |
| Hardcoded currency | `$` instead of user's locale currency | Medium | Wrong for non-US users |
| Slug in UI | `fine_dining` displayed instead of `Fine Dining` | Medium | Broken display |

## Security

| Flag | Pattern | Severity | Why It Matters |
|------|---------|----------|---------------|
| No auth check | Edge function without auth validation | Critical | Unauthenticated access |
| No input validation | Edge function trusting request body | High | Injection / crash risk |
| Direct API call | Frontend calling third-party API directly | High | Key exposure, no rate limiting |
| Service role overuse | Using service role when user role works | Medium | Over-privilege |
| Path traversal | User input in file/storage paths unsanitized | High | Data access violation |

---

## How to Report Flags

In the investigation report, Section 6 (Static Analysis Flags):

```
| Flag | File | Issue | Severity |
|------|------|-------|----------|
| Empty catch | src/services/saveService.ts:42 | catch block returns empty array | Critical |
| Hardcoded key | src/hooks/useSavedCards.ts:15 | queryKey: ['saved', userId] | High |
```

Every Critical and High flag should also appear in Findings as 🟡 Hidden Flaw
(or 🟠 Contributing Factor if it contributes to the current symptom).
