# Implementation Gates

> Every Implementor MUST answer these questions before writing code.
> If any answer is "I don't know," stop and investigate first.
> These gates are referenced by the Implementor skill and enforced
> by the Launch Hardener during review.
>
> Established: 2026-03-23 (Launch Hardening Program)

---

## Pre-Code Checklist

### 1. Ownership
- [ ] What is the source of truth for the data I'm touching?
- [ ] Is this local UI state, shared client state, or server state?
- [ ] Does this change introduce a second owner for any existing truth?
- [ ] If yes: which owner am I removing, or what sync contract am I documenting?
- [ ] Have I checked `docs/DOMAIN_ADRS.md` for this domain?

### 2. Failure
- [ ] What happens if the network call fails?
- [ ] What happens if it times out?
- [ ] Does the user see the failure, or is it silent?
- [ ] Is there a rollback path for optimistic updates?
- [ ] Am I following `docs/MUTATION_CONTRACT.md`?

### 3. Lifecycle
- [ ] What happens on app background (30+ seconds)?
- [ ] What happens on app resume?
- [ ] What happens on logout?
- [ ] What happens on user switch (logout → different login)?
- [ ] Is any persisted data cleared when it should be?

### 4. Subtraction
- [ ] What old code path must be removed?
- [ ] What duplicate ownership must be removed?
- [ ] What dead fields/hooks/stores must be removed?
- [ ] Am I layering new logic on bad architecture? (If yes, stop.)

### 5. Classification
- [ ] Is this fix permanent, transitional, or deferred?
- [ ] If transitional: is it labeled `[TRANSITIONAL]` with a registry entry in `docs/TRANSITIONAL_ITEMS_REGISTRY.md`?
- [ ] If deferred: is the remaining risk documented?

### 6. Query Keys (if touching React Query)
- [ ] Am I using an existing factory from `queryKeys.ts`? (Check `docs/QUERY_KEY_REGISTRY.md`)
- [ ] If creating a new query: does a factory already exist for this entity?
- [ ] What invalidation rule applies when this data changes?
- [ ] Am I invalidating via the factory's `all` prefix?
- [ ] Am I creating any inline query key string arrays? (If yes, stop — use a factory.)

### 7. Mutations (if adding/changing state-changing operations)
- [ ] Does the mutation have `onError`?
- [ ] Does it have `onSuccess` with appropriate invalidation?
- [ ] Is it wrapped in `withTimeout` if near a user action?
- [ ] Is there a `.catch(() => {})` anywhere? (If yes, replace with logging.)
- [ ] Does it follow `docs/MUTATION_CONTRACT.md`?
