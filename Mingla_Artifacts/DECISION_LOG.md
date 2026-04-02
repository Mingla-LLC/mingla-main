# Decision Log

> Last updated: 2026-03-30

| ID | Date | Decision | Context | Alternatives Rejected | Tradeoff Accepted | Exit Condition |
|----|------|---------|---------|----------------------|-------------------|----------------|
| DEC-001 | 2026-03-20 | Pool-first card serving — all card-serving functions use card_pool only, zero Google/OpenAI at serve time | Performance + cost + reliability. 1,463 lines removed. | Keep Google fallback for cache misses | No real-time data freshness (hours, prices from generation time) | When real-time enrichment pipeline exists |
| DEC-002 | 2026-03-21 | AI validation as sole quality gate — remove all SQL type-exclusion blocks | Type exclusions were too coarse (blocked entire categories). AI gives per-card judgment. | Keep SQL exclusions as safety net | Unvalidated cards hidden instead of shown with bad data | Never — AI gate is permanent |
| DEC-003 | 2026-03-22 | OneSignal android_channel_id disabled — was killing all push delivery | Root cause: channel not configured in OneSignal dashboard → 400 error | Configure the channel properly | No Android notification channel customization | When OneSignal dashboard is properly configured |
| DEC-004 | 2026-03-23 | Single entry point for collaboration (pill → SessionViewModal) | CollaborationModule + BoardViewScreen were redundant code paths causing confusion | Keep both paths with shared state | More complex modal, but single code path | Permanent |
| DEC-005 | 2026-03-23 | Service error contract deferred — TRANSITIONAL logging instead | ~60+ call sites need ServiceResult<T>. Too much blast radius now. | Fix all 60+ sites immediately | Silent failures still possible in ~4 services | Next hardening cycle |
| DEC-006 | 2026-03-24 | Remove invalidateQueries from preference save — use prefsHash matching | invalidateQueries caused race condition with batch fetch | Keep invalidation with delay/debounce | Slightly more complex batch validation logic | Permanent |
| DEC-007 | 2026-03-25 | Constitution principles (14 rules) locked into README | Prevent regression of hard-won fixes | Informal guidelines without enforcement | Protective comments in code may slow development | Permanent — can add, not remove |
