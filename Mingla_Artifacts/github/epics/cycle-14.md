# Cycle 14 — Account: edit profile, settings, delete-flow, sign out

**Phase:** Phase 5 — Account + Polish
**Estimated effort:** ~48 hrs
**Status:** ⬜ PLACEHOLDER
**Codebase:** `mingla-business/`

## Scope

Account tab fleshed out: edit personal profile (name, photo, email — through OAuth provider), notification settings, security settings (sign out everywhere), 4-step delete-account flow with cascade preview + 30-day soft-delete + final confirmation.

## Journeys (to refine)

- J-A1 — Edit profile (name + photo)
- J-A2 — Notification settings (push / email toggles per category)
- J-A3 — Security (sign out everywhere; delete account)
- J-A4 — Delete-account 4-step flow (warn → list cascading effects → type to confirm → soft-delete + audit)
- J-A5 — Sign out (single device)

## References

- BUSINESS_PRD §1
- Strategic Plan R4 (account-deletion completeness — GDPR)
- Strategic Plan §4 MVP "done" criterion 2

## Notes

Account deletion is critical-path for GDPR. UI plus the cascade preview ships here; the actual cascade edge function lands in B1/B2.
