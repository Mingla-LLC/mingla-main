# Cycle 11 — Scanner mode: camera, states, manual lookup, activity log

**Phase:** Phase 4 — Event Management
**Estimated effort:** ~40 hrs
**Status:** ⬜ PLACEHOLDER
**Codebase:** `mingla-business/`

## Scope

Scanner mode is mobile-only (camera). UI for the camera view + 6 result states (idle / success / duplicate / wrong-event / void / not-found), manual lookup fallback, activity log, offline scan queue with sync-on-reconnect.

## Journeys (to refine)

- J-S1 — Scanner camera + permission flow
- J-S2 — Scan result states (success / dup / wrong-event / void / not-found)
- J-S3 — Manual lookup (search by name/email/last-4-of-QR)
- J-S4 — Offline scan queue (validate locally + queue + sync)
- J-S5 — Activity log (last N scans with timestamps)
- J-S6 — Multiple-scanner setup + permissions (event manager invites scanners)

## References

- BUSINESS_PRD §6.1
- Web fallback: manual lookup only (camera API patchy on web; document the gap)

## Notes

Offline-first design is non-trivial — local QR validation needs the public key embedded. Spec carefully.
