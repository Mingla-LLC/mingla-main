# Cycle 7 — Public brand + organiser page + share modal

**Phase:** Phase 3 — Public Surfaces
**Estimated effort:** ~24 hrs
**Status:** ✅ DONE
**Codebase:** `mingla-business/` (Expo Web variant)

## What shipped

- Public brand page route at `/b/{brand-slug}` (Linktree-style redesign per FX2)
- ShareModal primitive (link + native share + copy + social-link router) used across Step 7 wizard preview + public event page + brand page
- Brand cover hue editing (FX2) — 6-swatch picker mirroring Cycle 3 hue array; persistent on Brand.coverHue (currentBrandStore v10→v11 migration)
- Verified-host-since-YYYY pill (suppressed in Cycle 13b post J-A9 subtract; restoration deferred to B-cycle)
- 3 follow-up FX reworks: FX1 (retire brand-profile TRANSITIONALs), FX2 (brand page redesign + cover editing), FX3 (final polish)
- Implementation reports: `IMPLEMENTATION_BIZ_CYCLE_7_PUBLIC_BRAND.md` + `_FX1_RETIRE_BRAND_PROFILE_TRANSITIONALS.md` + `_FX2_BRAND_PAGE_REDESIGN.md` + `_FX3.md`

## Closing notes

DEC-086 (workstream split: front-facing marketing website is founder-owned separate workstream) was operator-locked during Cycle 7 — public share pages live in `mingla-business` Expo Web; SSR-grade marketing site deferred. ShareModal social-link routing (instagram / tiktok / x / facebook / youtube / linkedin / threads / website / custom) became the canonical pattern for any future link-out modal.

---

(Original `Status: ⬜ PLACEHOLDER` flipped to `✅ DONE` 2026-05-04 during epic-status backfill audit.)

## Scope

Public-facing brand page at `business.mingla.com/{brand-slug}` — bio, photo, social links, upcoming events list. Public organiser profile if account-level public profile is shipped. Share modal (link + native share sheet + copy + QR code) used from Step 7 of the wizard, public event page, and the brand page.

## Journeys (to refine)

- J-P8 — Public brand page (events grid + bio)
- J-P9 — Public organiser page (optional MVP feature; PRD §1)
- J-P10 — Share modal (canonical URL, native share, QR, copy)

## References

- BUSINESS_PRD §2.2 (brand profile fields), §11 (public organiser profile if shipped)
- Cycle 3 left a Share modal as TRANSITIONAL toast pointing here

## Notes

Decompose at kickoff. Watch for SEO (canonical URL, OG tags, twitter card metadata) — all need user stories.
