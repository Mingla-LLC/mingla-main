# Static Analysis Checklist

Run these checks on every meaningful file read during investigation. Critical and high flags should become findings when they affect production risk.

## Type Safety

| Flag | Pattern | Severity |
|---|---|---|
| `any` / `as any` | Disables checking | High |
| `@ts-ignore` | Suppresses errors | High |
| `@ts-expect-error` | Masks known issue | Medium |
| `as unknown as X` | Unsafe cast | High |
| Missing return type on exported function | Ambiguous contract | Medium |
| Non-null assertion | Crash risk | Medium |
| Implicit any | Type hole | High |

## Error Handling

| Flag | Pattern | Severity |
|---|---|---|
| Empty catch | `catch {}` | Critical |
| Console-only catch | Logs but does not surface | High |
| Return fallback catch | `return null/[]/true` | High |
| Missing mutation `onError` | Invisible failure | High |
| Unhandled promise | Async rejection risk | High |
| Ignored Supabase `error` | DB failure hidden | Critical |

## Query And Cache

| Flag | Pattern | Severity |
|---|---|---|
| Hardcoded query key | Cache drift | High |
| Missing key parameter | Stale/wrong data | High |
| Unstable array/object key | Refetch churn | Medium |
| Raw GPS key | Location drift churn | Medium |
| Missing `enabled` | Query fires too early | High |
| Inline invalidation race | Stale/racy UI | High |
| Missing invalidation/update | Stale UI | High |

## Data Integrity

| Flag | Pattern | Severity |
|---|---|---|
| `.single()` on optional row | Crash | High |
| Fabricated data fallback | Fake user-visible truth | High |
| Missing NOT NULL/check/FK | Data corruption | Medium/High |
| Missing RLS | Data exposure | Critical |
| Permissive RLS | Wrong actor access | Critical |
| `select('*')` | Overfetch/privacy risk | Low/Medium |

## State Boundaries

| Flag | Pattern | Severity |
|---|---|---|
| Server data in Zustand | Ownership conflict | High |
| New persisted state not cleared on logout | Privacy leak | High |
| AsyncStorage schema drift | Cold-start break | High |
| Duplicate state owners | Contradictory UI | High |

## UI And UX

| Flag | Pattern | Severity |
|---|---|---|
| Missing loading/error/empty state | Blank/stuck UI | Medium/High |
| Dead tap | No response | Medium/High |
| Hardcoded currency | Locale bug | Medium |
| Slug/internal enum in UI | Broken copy | Medium |
| Text/layout overflow risk | Broken presentation | Medium |
| Inline mobile styles | Pattern violation | Low |

## Security

| Flag | Pattern | Severity |
|---|---|---|
| No edge auth check | Unauthenticated access | Critical |
| No input validation | Injection/crash/wrong write | High |
| Frontend direct third-party call | Key/rate-limit exposure | High |
| Service-role overuse | Over-privilege | Medium/High |
| Path traversal risk | Storage/data access issue | High |
| Sensitive logging | Secret/PII exposure | High |

## Reporting

For each flag, capture:

`Flag | File:line | Evidence | User/production risk | Classification | Fix direction`
