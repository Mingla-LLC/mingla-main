# Source Summary: Frontend Journey Roadmap And Gap Audit

> Source paths: `Mingla_Artifacts/specs/SPEC_BIZ_FRONTEND_JOURNEY_BUILD_ROADMAP.md`, `Mingla_Artifacts/reports/AUDIT_BIZ_JOURNEY_GAPS.md`, `Mingla_Artifacts/github/PLAN.md`, `Mingla_Artifacts/github/epics/*.md`
> Source date: 2026-04-28 with later epic status backfills
> Summary date: 2026-05-08
> Owner: `$pmm-mingla`
> Confidence: Medium. Useful cycle map, but partially superseded and mixed with stale `mingla-web` assumptions.

## Staleness

The original roadmap is explicitly partially superseded by DEC-081. Cycle epics are more current for statuses than the roadmap master table. The roadmap should be used as journey coverage and sequencing evidence, not current implementation truth.

## Decision Overrides

- DEC-081: web = `mingla-business` Expo Web, not separate `mingla-web`.
- DEC-086: public share pages vs marketing website ownership split.
- Later ORCH work updated active lifecycle state for Home, drafts, public URLs, cover media, and Stripe/domain issues.

## Extracted Product Claims

- Business UI was planned as 17 UI cycles and B1-B6 backend cycles.
- Cycles 0a-12 have many done statuses in GitHub epics.
- Cycle 13 reconciliation, Cycle 14 account deletion/settings, Cycle 15 marketing landing, Cycle 16 cross-cutting, Cycle 17 refinement remain planned/placeholder in the imported epic set.
- B2 Connect, B3 live checkout, B4 scanner/door payments are the MVP backend chain.
- B5 Marketing Hub and B6 Brain are post-MVP and gated.

## Extracted GTM / Positioning Claims

- Public event and brand pages, checkout, and marketing landing are the conversion surfaces.
- Greenfield/silent design areas are PMM-relevant because they need clearer narrative, copy, and customer proof.

## Affected Feature IDs

`FEAT-0001` through `FEAT-0015`.

## Open Questions

- Which cycle completion claims should be verified against current code before public launch.
- Whether Cycle 13/14/15/16 should remain roadmap labels or be decomposed into ORCH-specific current work.
- Which shipped UI foundations are ready for sales/demo assets vs still transitional.
