# Source Summary: Business Strategic Plan

> Source path: `Mingla_Artifacts/BUSINESS_STRATEGIC_PLAN.md`
> Source date: started 2026-04-28
> Summary date: 2026-05-08
> Owner: `$pmm-mingla`
> Confidence: High for strategic sequence; medium for stale stack references.

## Staleness

The doc warns that any separate `mingla-web` / two-codebase stack references are stale. The strategic sequence remains useful, but web-surface implementation references must be mapped to `mingla-business` Expo Web or the separate `mingla-marketing` workstream.

## Decision Overrides

- DEC-081/086 supersede old public-web codebase assumptions.
- DEC-112: Stripe Connect type = Express.
- DEC-113: billing/account routing = brand-level Connect accounts.

## Extracted Product Claims

- North Star for Business: monthly GMV processed through Mingla Business.
- MVP done means organiser can sign up, create brand, create event, sell paid ticket, sell in-person ticket, scan both, view payout, and delete account.
- Marketing, attribution, full analytics, and chat agent are post-MVP.
- Build order: front-end/UI cycles first, then backend cycles B1-B6 light everything up.
- B4 is the MVP/private-beta cutline; B5 marketing and B6 agent are post-launch enhancements.

## Extracted GTM / Positioning Claims

- Mingla Business is the operating system for live experiences.
- Differentiated wedge is demand-graph integration: business supply connects to consumer discovery/planning demand.
- The product should not mix organiser and attendee needs inside one consumer app.

## Affected Feature IDs

`FEAT-0001`, `FEAT-0003`, `FEAT-0004`, `FEAT-0007`, `FEAT-0008`, `FEAT-0009`, `FEAT-0010`, `FEAT-0011`, `FEAT-0012`, `FEAT-0014`, `FEAT-0015`.

## Open Questions

- Exact private beta cutline once current ORCH-0756/0758/0759 blockers close.
- Whether B1 schema/RLS has already been partially superseded by newer implemented backend work and migrations.
- Which metrics should be implemented first: GMV, organiser activation, draft recovery, or public-link conversion.
