# Cycle 6 — Public event page + variants

**Phase:** Phase 3 — Public Surfaces
**Estimated effort:** ~40 hrs
**Status:** ⬜ PLACEHOLDER (decompose at active time)
**Codebase:** `mingla-business/` (Expo Web variant)

## Scope

The full public event page rendered at `business.mingla.com/e/{brand-slug}/{event-slug}`. Replaces the Cycle 3 in-app PreviewEventView for public consumption. Variant states: published / sold-out / past-event / pre-sale / password-required / approval-required / cancelled.

## Journeys (to refine)

- J-P1 — Public event page (default published state)
- J-P2 — Sold-out variant (waitlist CTA if enabled)
- J-P3 — Pre-sale variant (countdown timer + early-access)
- J-P4 — Past-event variant (read-only)
- J-P5 — Password-required gate
- J-P6 — Approval-required indication
- J-P7 — Cancelled-event variant

## References

- BUSINESS_PRD §3 (public page expectations)
- Decision log: DEC-081 (web = mingla-business Expo Web)
- Cycle 3 PreviewEventView is the in-app preview reference

## Notes

Decompose into user stories at cycle kickoff. SEO + OG tags + share-link canonicalization need a dedicated user story.
