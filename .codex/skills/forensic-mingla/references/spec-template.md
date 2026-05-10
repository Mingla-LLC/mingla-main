# Spec Template

Use this when the user asks for a spec or when an investigation has enough evidence to define the fix. A launch-critical spec should be complete; a tiny fix can be shorter, but every included requirement must remain testable.

```markdown
# Spec: [Feature/Fix Name] ([ORCH-ID if any])

> Date: [YYYY-MM-DD]
> Investigation: [link or "User-directed"]
> Root cause: [finding/RC ID or N/A]
> Status: [ready for implementation | needs review | blocked]

## 1. Layman Summary

[What will change for users/business/admins and why it matters.]

## 2. User Story

As a [role], I want [action], so that [benefit].

## 3. Scope

- **In scope:**
- **Non-goals:**
- **Assumptions:**
- **Dependencies:**

## 4. Evidence Trace

| Requirement | Comes from finding / source | Confidence |
|---|---|---|

## 5. Success Criteria

1. [Observable and testable outcome.]
2. [Failure-path outcome.]
3. [Persistence/cache/RLS outcome.]

## 6. Invariants

### Must Preserve

| Invariant | Enforcement in this spec | Verification |
|---|---|---|

### New Invariants

| Invariant | Owner | Enforcement | Verification |
|---|---|---|---|

## 7. Database / RLS / Migration

```sql
-- Migration: [timestamp]_[descriptive_name].sql
-- Exact SQL here, or "None."
```

- RLS policies:
- Backfill/data migration:
- Indexes/constraints:
- Rollback:

## 8. Edge Functions / RPCs / Webhooks

### [function-name]

- **Path:**
- **Auth:**
- **Request schema:**
- **Success response:**
- **Error responses:**
- **External calls/timeouts/retries:**
- **Idempotency:**
- **Deploy notes:**

If none: "None."

## 9. Service Layer

### [service function]

- **Path:**
- **Signature:**
- **Query/client behavior:**
- **Error contract:**
- **Return type:**

If none: "None."

## 10. Hook / State / Cache Layer

### [hook/store]

- **Path:**
- **Query key:**
- **enabled/staleTime/retry:**
- **Mutation behavior:**
- **Optimistic update/rollback:**
- **Invalidation/update:**
- **Zustand/AsyncStorage/sign-out cleanup:**

If none: "None."

## 11. Component / Screen Layer

### [component]

- **Path:**
- **Props:**
- **States:**

| State | Condition | Renders |
|---|---|---|

- **Interactions:**

| Action | Handler | Effect |
|---|---|---|

- **Copy:**
- **Accessibility:**
- **Layout/design constraints:**

If none: "None."

## 12. Business / Admin / Public Parity

- Business app changes:
- Admin changes:
- Public/web changes:
- Operational dependency:

If none: "None."

## 13. Realtime / Notifications / Analytics

- Realtime:
- Notifications:
- Analytics:

If none: "None."

## 14. Implementation Order

1. [Exact file/layer step.]
2. [...]

## 15. Test Matrix

| ID | Scenario | Input/setup | Expected | Layer | Verification |
|---|---|---|---|---|---|

## 16. Regression Prevention

- **Structural safeguard:**
- **Test:**
- **Protective comment / documentation:**
- **Artifact update:**

## 17. Rollback And Deploy Safety

- **Migration order:**
- **Edge function deploy:**
- **Mobile OTA vs native build:**
- **Business/admin web deploy:**
- **Env vars/secrets:**
- **Partial rollback risk:**

## 18. Common Mistakes

1. [Pitfall and how to avoid it.]

## 19. Handoff To Implementor

[3-5 sentence TL;DR with exact build order and risks.]
```
