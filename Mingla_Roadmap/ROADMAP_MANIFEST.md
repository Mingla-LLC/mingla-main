# Mingla Roadmap Manifest

> Created: 2026-05-08
> Source investigation: `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0760_MINGLA_ROADMAP_PRODUCT_MARKETING_SYSTEM.md`
> Current scope: PMM-populated roadmap operating system. Keep this folder synced with active artifact lifecycle evidence.

## How To Read This Manifest

- `current_authority = yes` means the document is the current product/market planning source for its domain.
- `current_authority = partial` means useful planning context exists, but it must be reconciled against `Mingla_Artifacts/`.
- `archive_policy = keep_current` means keep the document in place and update it.
- `archive_policy = archive_when_superseded` means move to `archive/` only after replacement authority is named.
- `archive_policy = working_draft` means do not cite as current truth.

## Authority Map

| Authority area | Current source | Caveat |
|---|---|---|
| Roadmap system map | `Mingla_Roadmap/README.md` | Navigation and update rules only |
| Roadmap document classification | `Mingla_Roadmap/ROADMAP_MANIFEST.md` | Must stay aligned with root `Mingla_Artifacts/ARTIFACT_MANIFEST.md` |
| Feature/product-market registry | `Mingla_Roadmap/FEATURE_REGISTRY.md` | Lifecycle status mirrors `Mingla_Artifacts/` |
| High-level roadmap | `Mingla_Roadmap/HIGH_LEVEL_ROADMAP.md` | Outcome view; not an implementation promise |
| Current build planning mirror | `Mingla_Roadmap/CURRENT_BUILD.md` | `Mingla_Artifacts/PRIORITY_BOARD.md` and `OPEN_INVESTIGATIONS.md` remain status authority |
| Sequenced next work | `Mingla_Roadmap/NEXT_UP.md` | Must cite why-now evidence |
| Product strategy | `Mingla_Roadmap/living/PRODUCT_STRATEGY.md` | Summarized from current source docs and decisions |
| GTM and positioning | `Mingla_Roadmap/living/GTM_AND_POSITIONING.md` | Claims requiring market proof must be labeled |
| Customer and ICP | `Mingla_Roadmap/living/CUSTOMER_AND_ICP.md` | Research gaps must remain explicit |
| Feature portfolio | `Mingla_Roadmap/living/FEATURE_PORTFOLIO.md` | Rolls up feature briefs and registry rows |

## Roadmap Documents

| artifact_id | path | kind | domain | role | status | superseded_by | current_authority | archive_policy | notes |
|---|---|---|---|---|---|---|---|---|---|
| ROADMAP-README | `Mingla_Roadmap/README.md` | index | product | front_door | `CURRENT_AUTHORITY` | None | yes | keep_current | Roadmap navigation and update rules. |
| ROADMAP-MANIFEST | `Mingla_Roadmap/ROADMAP_MANIFEST.md` | manifest | product | authority | `CURRENT_AUTHORITY` | None | yes | keep_current | Roadmap document classification and archive authority. |
| ROADMAP-FEATURE-REGISTRY | `Mingla_Roadmap/FEATURE_REGISTRY.md` | registry | product | authority | `CURRENT_AUTHORITY` | None | yes | keep_current | Canonical feature registry; lifecycle state mirrors artifacts. |
| ROADMAP-HIGH-LEVEL | `Mingla_Roadmap/HIGH_LEVEL_ROADMAP.md` | roadmap | product | authority | `CURRENT_AUTHORITY` | None | yes | keep_current | Outcome-driven Now/Next/Later/Exploring roadmap. |
| ROADMAP-CURRENT-BUILD | `Mingla_Roadmap/CURRENT_BUILD.md` | dashboard | product | planning_mirror | `CURRENT_LEDGER` | None | partial | keep_current | Active build mirror; artifacts remain lifecycle authority. |
| ROADMAP-NEXT-UP | `Mingla_Roadmap/NEXT_UP.md` | dashboard | product | planning_queue | `CURRENT_AUTHORITY` | None | yes | keep_current | Sequenced upcoming work. |
| ROADMAP-LIVING | `Mingla_Roadmap/living/` | directory | product | living_docs | `CURRENT_AUTHORITY` | None | yes | keep_current | Current product, GTM, ICP, and portfolio docs. |
| ROADMAP-FEATURES | `Mingla_Roadmap/features/` | directory | product | feature_briefs | `CURRENT_LEDGER` | None | partial | archive_when_superseded | One brief per complex feature or bet. |
| ROADMAP-LAUNCH | `Mingla_Roadmap/launch/` | directory | marketing | launch_docs | `CURRENT_LEDGER` | None | partial | archive_when_superseded | Launch plans, release notes, announcements. |
| ROADMAP-RESEARCH | `Mingla_Roadmap/research/` | directory | research | research_docs | `CURRENT_LEDGER` | None | partial | archive_when_superseded | Plans, synthesis, JTBD. |
| ROADMAP-ENABLEMENT | `Mingla_Roadmap/enablement/` | directory | sales | enablement_docs | `CURRENT_LEDGER` | None | partial | archive_when_superseded | One-pagers, battlecards, objection handling. |
| ROADMAP-SOURCE-SUMMARIES | `Mingla_Roadmap/source-summaries/` | directory | product | source_summaries | `CURRENT_LEDGER` | None | partial | keep_current | Curated summaries of source artifacts with staleness labels. |
| ROADMAP-TEMPLATES | `Mingla_Roadmap/templates/` | directory | product | templates | `CURRENT_AUTHORITY` | None | yes | keep_current | Reusable PMM document templates. |
| ROADMAP-DRAFTS | `Mingla_Roadmap/drafts/` | directory | product | working_drafts | `DRAFT_ONLY` | None | no | working_draft | Not current authority. |
| ROADMAP-ARCHIVE | `Mingla_Roadmap/archive/` | archive | product | historical_evidence | `HISTORICAL_AUTHORITY` | None | no | keep_current | Superseded roadmap material. |

## Archive Rules

1. A roadmap document can move to `archive/` only after this manifest names the replacement authority.
2. Archived roadmap docs must keep old path, new path, reason, supersession, date, and replacement link.
3. Archived roadmap docs are evidence, not current operating instructions.
4. Source artifacts from `Mingla_Artifacts/` should not be moved into this archive. They remain governed by `Mingla_Artifacts/ARTIFACT_MANIFEST.md`.
5. Deletion requires explicit orchestrator approval and a link check proving safety.

## Draft Rules

Drafts are allowed for messy PMM thinking, but they are not source of truth.

Before a draft can be cited as current:

1. Move it into the appropriate current folder.
2. Add or update a manifest row.
3. Add source links and confidence/staleness labels.
4. Remove or archive the draft copy.
