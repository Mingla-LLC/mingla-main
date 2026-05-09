# Source Summary: Business PRD

> Source path: `Mingla_Artifacts/BUSINESS_PRD.md`
> Source date: started 2026-04-28; last updated 2026-04-29 with DEC-081 banner
> Summary date: 2026-05-08
> Owner: `$pmm-mingla`
> Confidence: Medium/high for feature inventory; medium for stack-specific claims.

## Staleness

The PRD explicitly warns that `mingla-web/` references are stale. Web product truth is now `mingla-business` Expo Web per DEC-081/DEC-086. Product requirements remain valuable; stack/location claims about Next.js public pages must be reinterpreted.

## Decision Overrides

- DEC-081: separate `mingla-web` discontinued for business web surfaces.
- DEC-086: front-facing marketing website is a separate founder-owned workstream; public share pages live in `mingla-business` Expo Web.
- DEC-092: six-role permissions enum supersedes some older role wording.

## Extracted Product Claims

- Mingla Business is for event organisers first.
- MVP vertical: account -> brand -> event -> ticket -> checkout -> scan -> payout -> account deletion.
- Business app uses 3 fixed tabs: Home, Events, Account; Marketing appears later.
- Scan is contextual, not a bottom-nav tab.
- Event creation is a 7-step wizard: Basics, When, Where, Cover, Tickets, Settings, Preview.
- Public brand/event pages and checkout are part of the business flow.
- Marketing, attribution, full analytics, AI guest psychology, and chat agent are post-MVP.
- AI agent must sit on structured event creation and database truth; it is not the source of truth.

## Extracted GTM / Positioning Claims

- Business product must serve the broader Mingla promise: experiences/date-planning/social experiences, never dating-app framing.
- Organiser value comes from creating, managing, listing, marketing, and monetising events.
- Future marketing and AI become meaningful only after the event/ticket/payment foundation works.

## Affected Feature IDs

`FEAT-0001`, `FEAT-0004`, `FEAT-0005`, `FEAT-0006`, `FEAT-0007`, `FEAT-0008`, `FEAT-0009`, `FEAT-0010`, `FEAT-0011`, `FEAT-0014`, `FEAT-0015`.

## Open Questions

- Which event organiser segment is the private beta ICP?
- Which public-page host/canonical URL contract survives ORCH-0759?
- Which PRD line items should be deferred until after B4 private beta?
