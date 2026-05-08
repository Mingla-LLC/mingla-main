# Implementation Report: ORCH-0760 Mingla Roadmap Population

> Date: 2026-05-08
> Skill: `$pmm-mingla`
> Dispatch: `Mingla_Artifacts/prompts/PMM_ORCH-0760_POPULATE_MINGLA_ROADMAP.md`
> Scope: first evidence-backed population of `Mingla_Roadmap/`.

## Summary

Populated the first real Mingla Roadmap layer from existing product, strategy, GTM, founder-feedback, lifecycle, and business roadmap evidence.

The output is intentionally a planning system, not a claim that every roadmap item is ready. Current lifecycle truth remains in `Mingla_Artifacts/`; roadmap docs summarize product/market intent and mirror active artifact state when linked to `FEAT-*` rows.

## Files Changed

| Path | Change |
|---|---|
| `Mingla_Roadmap/FEATURE_REGISTRY.md` | Replaced placeholder with 17 first-pass `FEAT-*` rows. |
| `Mingla_Roadmap/HIGH_LEVEL_ROADMAP.md` | Populated strategic themes and Now/Next/Later/Shipped roadmap views. |
| `Mingla_Roadmap/CURRENT_BUILD.md` | Populated active build/test planning mirror from current ORCH lifecycle evidence. |
| `Mingla_Roadmap/NEXT_UP.md` | Populated ranked next-up sequence with why-now logic. |
| `Mingla_Roadmap/living/PRODUCT_STRATEGY.md` | Populated current product strategy synthesis. |
| `Mingla_Roadmap/living/GTM_AND_POSITIONING.md` | Populated GTM and positioning synthesis. |
| `Mingla_Roadmap/living/CUSTOMER_AND_ICP.md` | Populated customer map and JTBD view. |
| `Mingla_Roadmap/living/FEATURE_PORTFOLIO.md` | Populated portfolio balance and recommendation. |
| `Mingla_Roadmap/source-summaries/*.md` | Added 8 source summaries with staleness, decision overrides, extracted claims, feature IDs, and open questions. |

## Source Docs Summarized

| Summary | Source docs |
|---|---|
| `business-prd-summary.md` | `Mingla_Artifacts/BUSINESS_PRD.md` |
| `business-strategic-plan-summary.md` | `Mingla_Artifacts/BUSINESS_STRATEGIC_PLAN.md` |
| `frontend-journey-roadmap-summary.md` | `SPEC_BIZ_FRONTEND_JOURNEY_BUILD_ROADMAP.md`, `AUDIT_BIZ_JOURNEY_GAPS.md`, `github/PLAN.md`, `github/epics/*.md` |
| `product-competitive-analysis-summary.md` | `MINGLA_PRODUCT_COMPETITIVE_ANALYSIS.md` |
| `positioning-gtm-summary.md` | `POSITIONING_AND_GTM_STRATEGY.md` |
| `marketing-hub-summary.md` | `MINGLA_BUSINESS_MARKETING_HUB_STRATEGY.md` |
| `brain-agent-summary.md` | `MINGLA_BRAIN_AGENT_STRATEGY.md` |
| `founder-feedback-and-lifecycle-summary.md` | `FOUNDER_FEEDBACK.md`, `PRIORITY_BOARD.md`, `WORLD_MAP.md`, `OPEN_INVESTIGATIONS.md`, `PRODUCT_SNAPSHOT.md` |

## Feature Count Created

17 feature rows:

1. `FEAT-0001` Business account, auth, brand, and team foundation
2. `FEAT-0002` Business Home truthful operational dashboard
3. `FEAT-0003` Server-backed business event drafts and recovery
4. `FEAT-0004` Manual event creator and ticket setup wedge
5. `FEAT-0005` Public event, brand, checkout, and share URL authority
6. `FEAT-0006` Rich cover media for event/public tickets and brand/profile surfaces
7. `FEAT-0007` Live checkout, orders, ticket issuance, and payment finalization
8. `FEAT-0008` Stripe Connect brand payouts and finance foundation
9. `FEAT-0009` Scanner, door sales, and in-person payments
10. `FEAT-0010` End-of-night reconciliation and finance audit
11. `FEAT-0011` Account settings, profile, and compliant deletion
12. `FEAT-0012` Cross-cutting offline, error, permission, splash, and web parity states
13. `FEAT-0013` Organiser-facing marketing site and cold acquisition page
14. `FEAT-0014` Marketing Hub: blasts, CRM, consent, tracking, managed ads
15. `FEAT-0015` Mingla Brain AI agent across consumer, business, admin
16. `FEAT-0016` Consumer vibe discovery, planning, and collaboration core
17. `FEAT-0017` Consumer subscription and Mingla+ monetization

## Roadmap Buckets Populated

| Bucket | Feature IDs |
|---|---|
| Now | `FEAT-0002`, `FEAT-0003`, `FEAT-0005`, `FEAT-0006` |
| Next | `FEAT-0007`, `FEAT-0008`, `FEAT-0009`, `FEAT-0010`, `FEAT-0011` |
| Later | `FEAT-0012`, `FEAT-0013`, `FEAT-0014`, `FEAT-0015` |
| Shipped / Recently Launched | `FEAT-0001`, `FEAT-0002`, `FEAT-0004`, `FEAT-0016`, `FEAT-0017` |

## Key Assumptions

- Current active ORCH lifecycle evidence outranks older strategy docs.
- Business public web references to a separate `mingla-web` are stale unless superseded by newer domain/marketing decisions.
- Cycle epics are useful planning evidence but must not be treated as proof of current runtime readiness.
- Marketing Hub and Mingla Brain remain strategic/post-MVP until prerequisite chains close.
- Consumer launch/readiness metrics from 2026-04-06 need revalidation before external GTM use.

## Stale Claims Preserved

- `mingla-web` / Next.js references preserved as stale-source context, not current implementation truth.
- Raleigh launch-readiness numbers from 2026-04-06 preserved as older GTM context, not current launch evidence.
- Imported GitHub cycle plans preserved as roadmap context, not standalone source of truth.
- Marketing Hub and Brain strategy preserved as locked brainstorm/pre-spec strategy, not implementation authorization.

## Open PMM / Product Questions

- Which organiser segment should anchor private beta?
- Which consumer positioning wedge wins now: vibe, dates, friend plans, or new-city discovery?
- Should ORCH-0758B brand media and ORCH-0758D provider picker become separate feature IDs after ORCH-0758A closes?
- Should brand delete become its own `FEAT-*` row or remain under account/compliance?
- What business pricing metric should Mingla test first: monthly brand plan, take rate, per-ticket fee, marketing add-on, or hybrid?
- Which current active fixes deserve customer-facing release notes versus internal trust/QA notes?

## Verification

Passed:

```bash
python3 scripts/docs/check_artifact_placement.py
python3 scripts/docs/check_readme_snapshot.py
```

Inherited link baseline remains unchanged in class and source:

```bash
python3 scripts/docs/check_links.py --baseline-file scripts/docs/link_baseline.json
```

Output:

```text
files_checked=549
total_links=1801
missing_links=4

missing_by_classification:
  TRUE_MISSING_REFERENCE: 3
  MOVED_OR_ARCHIVED_CANDIDATE: 1

top_sources:
  2 Mingla_Artifacts/prompts/B2A_PATH_C_V3_SUB_B_COMPLETION.md
  2 Mingla_Artifacts/prompts/B2A_PATH_C_V3_SUB_C_DISPATCH.md
```

The missing links are inherited prompt-file debt, not links introduced by the new roadmap files.

## Recommended Next Orchestrator Review

Review this population pass for:

1. Whether the 17 `FEAT-*` rows are the right first taxonomy.
2. Whether active ORCH state should be synced into `PRIORITY_BOARD.md` to reflect ORCH-0760 scaffold/population completion.
3. Whether a follow-on cleanup/archive spec should move stale strategy docs or the tracked `ORCH-0729_PROD_MIGRATION_HISTORY_CLEANUP.sql`.
4. Whether `$pmm-mingla` should next create launch/release-note templates for `FEAT-0003`, `FEAT-0005`, and `FEAT-0006` once their lifecycle gates close.
