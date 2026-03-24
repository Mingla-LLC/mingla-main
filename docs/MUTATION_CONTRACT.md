# Mutation Contract Standard

> Every state-changing operation in the Mingla codebase must follow this contract.
> This applies to React Query `useMutation`, direct service calls that modify server
> state, and fire-and-forget operations.
>
> Established: 2026-03-23 (Launch Hardening Program)

---

## Required: Every useMutation

```typescript
useMutation({
  mutationFn: async (args) => { /* service call */ },

  // REQUIRED: Log errors at minimum. Show toast if user-initiated.
  onError: (error, args, context) => {
    console.error('[HookName] Operation failed:', error);
    // If user-initiated: showMutationError(error, 'description', showToast);
    // If has optimistic update: rollback from context
  },

  // REQUIRED if invalidating queries
  onSuccess: (data, args) => {
    queryClient.invalidateQueries({ queryKey: factory.all });
  },

  // OPTIONAL but recommended for optimistic updates
  onMutate: async (args) => {
    await queryClient.cancelQueries({ queryKey: specificKey });
    const previous = queryClient.getQueryData(specificKey);
    queryClient.setQueryData(specificKey, optimisticValue);
    return { previous }; // rollback context
  },

  // OPTIONAL: cleanup loading state
  onSettled: () => { /* cleanup */ },
})
```

---

## Required: Direct Service Calls (not in useMutation)

If a service call modifies server state and is NOT wrapped in `useMutation`:
- It MUST have a `.catch()` that logs the error
- It MUST NOT use `.catch(() => {})` (silent catch)
- If user-initiated: it MUST show error feedback (toast or Alert)
- If near a user action: it MUST be wrapped in `withTimeout()`

---

## Required: Fire-and-Forget Operations

Notifications, analytics, engagement counters:
- MUST have `.catch((e) => console.warn(...))` — never silent
- MUST be wrapped in `withTimeout(5000)` if invoked near user actions
- MAY be fire-and-forget (no await) if non-critical

---

## Shared Utilities

| Utility | Location | Purpose |
|---------|----------|---------|
| `withTimeout(promise, ms, label)` | `app-mobile/src/utils/withTimeout.ts` | Per-call timeout wrapper |
| `showMutationError(error, context, showToast)` | `app-mobile/src/utils/showMutationError.ts` | User-friendly error toast for mutations |

---

## Forbidden

- `.catch(() => {})` on any state-changing operation
- `catch {}` (empty catch block) on any state-changing operation
- `useMutation` without `onError`
- Service functions that return `false`/`null`/`[]` on error without `[TRANSITIONAL]` tag
- Awaiting non-critical network work before UI response
- Creating a new mutation without consulting this contract
