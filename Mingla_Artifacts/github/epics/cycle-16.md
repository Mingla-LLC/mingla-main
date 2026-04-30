# Cycle 16 — Cross-cutting: offline, force-update, error, 404, splash, permission-denied

**Phase:** Phase 5 — Account + Polish
**Estimated effort:** ~36 hrs
**Status:** ⬜ PLACEHOLDER
**Codebase:** Both (`mingla-business/` mobile + web)

## Scope

The states every screen needs but no single screen owns: offline banner + retry, force-update prompt (when EAS detects breaking version), generic error boundary, 404, splash screen polish, permission-denied state (location, camera, notifications).

## Journeys (to refine)

- J-X1 — Offline detection + banner + retry pattern
- J-X2 — Force-update prompt (EAS Update + native version checks)
- J-X3 — Error boundary + reporting (Sentry-style hookup later)
- J-X4 — 404 / unknown-route
- J-X5 — Splash screen polish + Mingla brand reveal
- J-X6 — Permission-denied state (location, camera, notifications)

## References

- BUSINESS_STRATEGIC_PLAN §6 (R12 — UI cycles defer test rigs)
- Constitution #1 (no dead taps), Constitution #3 (no silent failures)

## Notes

Cross-cutting work is hard to estimate. Decompose carefully — some items are 1-hour patches, others (offline) are multi-day with edge cases.
