# Transitional Items Registry

> Temporary solutions that must not become permanent.
> Every item has an owner, a tracker link, and an exit condition.
> Review quarterly. If an item has no progress for 2 cycles, escalate.
>
> Established: 2026-03-23 (Launch Hardening Program)

---

| # | Item | Why Transitional | Owner | Tracker | Exit Condition |
|---|------|-----------------|-------|---------|----------------|
| 1 | Session expiry: toast + grace period | 401 counter heuristic remains — can misfire in edge cases | Next hardening cycle | LAUNCH_READINESS_TRACKER.md: Token refresh/expiry B | Server-pushed session expiry event replaces heuristic |
| 2 | Subscription tier: "take highest of 3" model | Multi-source authority confusion — 3 caches can disagree within 60s | Next hardening cycle | LAUNCH_READINESS_TRACKER.md: Subscription tier freshness B | Single server-authoritative tier RPC |
| 3 | Notification sends: withTimeout + warn | Still fire-and-forget, just observable — no retry queue | Next hardening cycle | LAUNCH_READINESS_TRACKER.md: Notification send observability B | Managed background job queue with retry |
| 4 | Service-layer masked errors: [TRANSITIONAL] logging | UI still shows empty for errors — consumers can't distinguish "no data" from "fetch failed" | Next hardening cycle | LAUNCH_READINESS_TRACKER.md: Service error contract F | ServiceResult<T> return type migration (~60+ call sites) |
| 5 | Offline queue: log discard, no user notification | Board actions silently dropped after 5 retries with console.error | Next hardening cycle | LAUNCH_READINESS_TRACKER.md: Offline queue observability B | Surface failed actions in board UI with retry affordance |

---

## How to Use This Registry

1. **Before removing a `[TRANSITIONAL]` tag:** Check this registry. Is the exit condition met?
2. **Before adding a transitional fix:** Add an entry here FIRST with owner and exit condition.
3. **Quarterly review:** For each item, ask: has progress been made? If not, why?
4. **Graduating an item:** When exit condition is met, remove from this registry, update the tracker grade, and remove the `[TRANSITIONAL]` tags from code.
5. **Finding all transitional code:** `grep -r "\[TRANSITIONAL\]" app-mobile/src/`
