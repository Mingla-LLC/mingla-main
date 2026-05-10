# Spec Template

Every spec produces this file. All sections mandatory.
A spec is a contract — precise enough that the implementor cannot misinterpret.

---

```markdown
# Spec: [Feature/Fix Name] ([ORCH-ID])

> Date: [date]
> Investigation: [link to investigation report, or "User-directed"]
> Root cause: [RC-ID from investigation, or "N/A — new feature"]
> Status: [ready for implementation | needs review | blocked on [what]]

---

## 1. Layman Summary

[2-4 sentences. What will change for the user. Why it matters.
No jargon. Same text as chat response.]

---

## 2. User Story

As a [role], I want [action], so that [benefit].

---

## 3. Scope

- **In scope:** [Exactly what this spec covers]
- **Non-goals:** [What this spec explicitly does NOT address]
- **Assumptions:** [Anything assumed that isn't proven]

---

## 4. Success Criteria

Every criterion is observable, testable, and unambiguous.

1. [When X happens, the user sees Y]
2. [When A fails, the user sees B and can do C]
3. [Data is persisted in table T with columns C1, C2]
4. ...

---

## 5. Invariants

### Must Preserve
| Invariant | How Implementation Preserves It |
|-----------|-------------------------------|
| [INV-ID: description] | [specific mechanism] |

### New Invariants Established
| Invariant | Enforcement | Test |
|-----------|-------------|------|
| [new rule] | [how it's enforced in code/DB] | [how to verify] |

---

## 6. Database Changes

[Exact SQL. Not pseudocode. Not "add a column." The actual migration.]

```sql
-- Migration: [timestamp]_[name].sql

[CREATE TABLE / ALTER TABLE / CREATE POLICY / CREATE INDEX]
```

If no database changes: "None."

---

## 7. Edge Functions

### [function-name]
- **Method:** [GET/POST/PUT/DELETE]
- **Route:** [/function-name]
- **Auth:** [Required — validates at entry]
- **Request:**
```typescript
interface Request {
  field: type; // required — [validation rule]
}
```
- **Response (success):**
```typescript
interface SuccessResponse {
  data: { ... };
}
// Status: 200
```
- **Response (errors):**
```typescript
// 400: { error: "message", code: "VALIDATION_ERROR" }
// 401: { error: "Unauthorized", code: "AUTH_REQUIRED" }
// 404: { error: "Not found", code: "NOT_FOUND" }
// 500: { error: "Something went wrong", code: "INTERNAL_ERROR" }
```
- **External calls:** [API name, timeout, error handling, caching]

If no edge function changes: "None."

---

## 8. Service Layer

### [serviceName.ts] — [functionName]
- **Path:** [exact file path]
- **Signature:** `async function name(params): Promise<ReturnType>`
- **Query:** [Supabase query construction]
- **Error contract:** [throws on error | transitional fallback]
- **Return type:** [exact type]

If no service changes: "None."

---

## 9. Hook Layer

### [useHookName.ts]
- **Path:** [exact file path]
- **Query key:** `factoryName.method(param1, param2, ...)`
- **staleTime:** [value + reasoning]
- **enabled:** [condition]
- **Mutations:**
  - [mutationName]: calls [service function]
    - `onSuccess`: invalidates [key factory.method]
    - `onError`: shows [exact toast message]
- **Return type:** [exact type]

If no hook changes: "None."

---

## 10. Component Layer

### [ComponentName.tsx]
- **Path:** [exact file path]
- **Props:**
```typescript
interface Props {
  field: type;
}
```
- **States:**

| State | Condition | Renders |
|-------|-----------|---------|
| Loading | `isLoading` | [skeleton/spinner description] |
| Error | `isError` | [error message + retry button] |
| Empty | `!data?.length` | [empty message + action] |
| Populated | data exists | [the actual UI] |
| Submitting | `mutation.isPending` | [disabled controls + indicator] |

- **Interactions:**

| Action | Handler | Effect |
|--------|---------|--------|
| [tap/swipe/input] | [handlerName] | [what happens: mutation, navigation, state change] |

- **Copy:**
  - Loading: "[text]"
  - Error: "[text]"
  - Empty: "[text]"
  - Success toast: "[text]"
  - Error toast: "[text]"

- **Haptics:** [which interactions get haptic feedback, which type]
- **Accessibility:** [labels on interactive elements]

If no component changes: "None."

---

## 11. Realtime (if applicable)

- **Channel:** [name]
- **Filter:** [table, event, filter condition]
- **On event:** [what cache/state to update]
- **Cleanup:** [useEffect cleanup removes subscription]

If not applicable: "None."

---

## 12. Implementation Order

1. [Step 1: exact file, what to do]
2. [Step 2: ...]
3. ...

Database always first. Edge functions second. Services, hooks, components follow.

---

## 13. Test Cases

| ID | Scenario | Input | Expected | Layer |
|----|----------|-------|----------|-------|
| T-01 | [happy path] | [input] | [output] | [stack layer] |
| T-02 | [error path] | [input] | [output] | [stack layer] |
| T-03 | [edge case] | [input] | [output] | [stack layer] |
| T-04 | [parity: solo] | [input] | [output] | [stack layer] |
| T-05 | [parity: collab] | [input] | [output] | [stack layer] |

---

## 14. Regression Prevention

- **Structural safeguard:** [architecture change preventing recurrence]
- **Test:** [specific test that catches regression]
- **Protective comment:** [comment to add explaining "why"]

---

## 15. Common Mistakes

[Specific pitfalls for THIS implementation, based on Mingla patterns]

1. [Mistake: what could go wrong. Avoidance: what to do instead.]
2. ...

---

## 16. Rollback Safety

[What happens if this needs to be reverted?]
- **Database:** [Is migration reversible? Does data need backfill?]
- **Code:** [Can code be reverted independently of DB?]
- **Risk:** [What breaks if partially reverted?]

---

## 17. Handoff to Implementor

[3-5 sentences: what to build, in what order, what to watch out for.
This is the implementor's TL;DR.]
```
