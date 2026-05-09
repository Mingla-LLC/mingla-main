# Mingla Roadmap System

Use this reference before creating or updating durable product, PMM, GTM, launch, research, sales enablement, roadmap, or source-summary documents.

## Authority Boundary

`Mingla_Roadmap/` owns product and market intent:

- feature registry;
- high-level roadmap;
- current build planning mirror;
- next-up sequencing;
- product strategy;
- GTM and positioning;
- feature briefs;
- launch plans and release notes;
- research and JTBD;
- sales enablement;
- source summaries.

`Mingla_Artifacts/` remains authoritative for:

- ORCH lifecycle state;
- investigations;
- specs;
- implementation reports;
- QA/test reports;
- bugs;
- root causes;
- decisions;
- invariants;
- historical artifact archives;
- private specialist prompts.

If roadmap state conflicts with `Mingla_Artifacts/`, treat the roadmap as stale and sync it to artifact evidence.

## Folder Contract

| Destination | Use for |
|---|---|
| `Mingla_Roadmap/FEATURE_REGISTRY.md` | Canonical `FEAT-*` feature rows. |
| `Mingla_Roadmap/HIGH_LEVEL_ROADMAP.md` | Outcome-driven Now/Next/Later/Exploring roadmap. |
| `Mingla_Roadmap/CURRENT_BUILD.md` | Product-market mirror of active ORCH/build/test work. |
| `Mingla_Roadmap/NEXT_UP.md` | Sequenced upcoming work and why-now logic. |
| `Mingla_Roadmap/living/` | Current product strategy, GTM, ICP, and portfolio docs. |
| `Mingla_Roadmap/features/` | One feature brief per complex feature or product bet. |
| `Mingla_Roadmap/launch/` | Launch plans, release notes, announcements, retrospectives. |
| `Mingla_Roadmap/research/` | Research plans, interview synthesis, JTBD, win/loss, competitive research. |
| `Mingla_Roadmap/enablement/` | Sales one-pagers, battlecards, objection handling, talk tracks. |
| `Mingla_Roadmap/source-summaries/` | Curated summaries of `Mingla_Artifacts/` source docs with staleness labels. |
| `Mingla_Roadmap/templates/` | Reusable templates. |
| `Mingla_Roadmap/drafts/` | Working drafts only; not current authority. |
| `Mingla_Roadmap/archive/` | Superseded roadmap material after manifest update. |

## Required Metadata

Every durable PMM document should include:

- status;
- owner or owning skill;
- last updated date;
- source artifacts;
- confidence;
- staleness assessment;
- linked feature IDs or ORCH IDs when applicable;
- open questions.

Every feature row should include:

- stable `FEAT-*` ID;
- customer/user;
- pain or job;
- business outcome;
- product status;
- roadmap bucket;
- PMM/GTM status;
- linked ORCH IDs;
- evidence links;
- dependencies;
- risks;
- success metrics;
- launch tier;
- owner;
- confidence;
- staleness;
- last updated date.

## Status Rules

- Use independent `FEAT-*` IDs. Do not use ORCH IDs as feature IDs.
- `Now` and `Current Build` must mirror current artifact evidence.
- `Launched` requires implementation/test evidence or accepted conditional evidence.
- `Deferred` requires a decision, dependency, or operator note.
- `Archived` requires a replacement, reason, and manifest update.
- Drafts cannot be cited as current truth.

## Source Summary Rules

When summarizing existing Mingla docs, do not move the source doc first. Create a summary in `Mingla_Roadmap/source-summaries/` that includes:

- source path;
- source date if known;
- stale assumptions;
- current decision overrides;
- extracted product claims;
- extracted GTM/positioning claims;
- affected feature IDs;
- open questions.

## Do Not

- Do not create current PMM work under root `outputs/`.
- Do not put specialist prompts in `Mingla_Roadmap/`; prompts remain under `Mingla_Artifacts/prompts/`.
- Do not move `Mingla_Artifacts/` strategy docs into the roadmap folder without an orchestrator-approved archive/link spec.
- Do not claim launch readiness without linked implementation/test evidence.
- Do not duplicate lifecycle truth that belongs in `Mingla_Artifacts/`.
