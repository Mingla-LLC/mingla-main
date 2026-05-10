# Invariants And Constitution

Use current `README.md` as authority. This reference condenses the implementation check.

## Constitutional Quick Check

For each touched area ask:

1. **No dead taps:** did every added/changed interaction respond visibly?
2. **One owner per truth:** did data ownership remain singular?
3. **No silent failures:** did every state-changing failure surface?
4. **One key per entity:** did React Query use canonical keys?
5. **Server state stays server-side:** did Zustand avoid server truth unless documented?
6. **Logout clears everything:** did new private/persisted state clear on sign-out?
7. **Label temporary:** did every workaround get `[TRANSITIONAL]`, owner, and exit condition?
8. **Subtract before adding:** did the fix remove/replace the broken path?
9. **No fabricated data:** did UI avoid fake ratings/prices/times/statuses?
10. **Currency-aware:** did price surfaces use locale/currency contracts?
11. **One auth instance:** did auth flow use centralized state?
12. **Validate at the right time:** did validation match the user's chosen action/time?
13. **Exclusion consistency:** did card filters remain consistent generation/serving?
14. **Persisted startup:** did cold start handle old persisted shapes?

Any "no" is a blocker unless the user explicitly accepts the violation with rationale.

## Common Invariant Families

Data:

- Required DB fields are constrained.
- Displayed data is real or clearly unavailable.
- Money/currency/order/ticket state is auditable.
- Block/friend/permission visibility is bidirectional and RLS-backed.

State:

- React Query owns server state.
- Query keys include all result-affecting parameters.
- Optimistic updates rollback on failure.
- Persisted state is versioned.

Auth/Security:

- Edge functions validate auth.
- User tables have RLS.
- Wrong actor paths fail safely.
- Service-role use is guarded.

UI:

- Loading/error/empty/populated/submitting states exist.
- Copy is truthful and actionable.
- No fabricated comfort values.

Realtime/Notifications:

- Subscriptions clean up.
- Preferences and quiet hours respected.
- Deleted/stale content does not crash.

Pipeline:

- Serving functions do not bypass quality gates.
- Decommissioned systems are not resurrected.

## Implementation Gate

Before reporting success, confirm:

- Relevant invariants checked.
- Verification run or limitations named.
- Transition items documented.
- Deploy/migration requirements named.
- Side discoveries recorded.
