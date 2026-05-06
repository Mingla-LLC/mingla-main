# Cycle 6 — Public event page + variants

**Phase:** Phase 3 — Public Surfaces
**Estimated effort:** ~40 hrs
**Status:** ✅ DONE

## What shipped

- Public event page route + variant states (published / sold-out / past-event / pre-sale / password-required / approval-required / cancelled)
- Web-platform parity (Expo Web datetime-local pickers + HIDDEN_WEB_INPUT_STYLE pattern for direct-tap)
- 4 follow-up FX reworks: FX1 (head/web-only), FX2 (close chrome), FX3 (web pickers), FX3.5 (web direct-tap fix)
- Implementation reports: `IMPLEMENTATION_BIZ_CYCLE_6_PUBLIC_EVENT_PAGE.md` + `_FX1_HEAD_WEB_ONLY.md` + `_FX2_PUBLIC_PAGE_CLOSE_CHROME.md` + `_FX3_WEB_PICKERS.md` + `_FX3_5_WEB_DIRECT_PICKER.md`

## Closing notes

The HIDDEN_WEB_INPUT_STYLE pattern (opacity:0 + 1×1px positioned-absolute hidden input that triggers showPicker on tap) is the canonical mobile-web direct-picker pattern; reused in Cycle 5 + Cycle 12 (sale-window picker on TicketStubSheet).

---

(Original `Status: ⬜ PLACEHOLDER` flipped to `✅ DONE` 2026-05-04 during epic-status backfill audit.)
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
