# Mingla Roadmap

Mingla Roadmap is the product, marketing, GTM, launch, research, and sales enablement planning system.

It answers:

- What are we building?
- Why does it matter to customers?
- How does it support the business?
- What is current, next, exploring, shipped, deferred, or obsolete?
- Which `Mingla_Artifacts/` evidence proves the lifecycle state?

## Authority Boundary

| Question | Authority |
|---|---|
| Product and market intent | `Mingla_Roadmap/` |
| Feature registry and roadmap buckets | `Mingla_Roadmap/FEATURE_REGISTRY.md`, `Mingla_Roadmap/HIGH_LEVEL_ROADMAP.md` |
| Current lifecycle status, ORCH state, specs, reports, QA, bugs, root causes, decisions | `Mingla_Artifacts/` |
| Architecture, source code, schema, and runtime truth | Repo source, migrations, tests, and verified runtime evidence |

Roadmap docs may summarize artifact evidence, but they must not replace the evidence trail. If roadmap state conflicts with `Mingla_Artifacts/`, the artifacts win until the roadmap is explicitly synced.

## Folder Map

```text
Mingla_Roadmap/
  README.md                  Front door and update rules
  ROADMAP_MANIFEST.md        Roadmap document classification and archive policy
  FEATURE_REGISTRY.md        Canonical feature/product-market registry
  HIGH_LEVEL_ROADMAP.md      Outcome-driven Now/Next/Later/Exploring view
  CURRENT_BUILD.md           Active build/test planning mirror
  NEXT_UP.md                 Sequenced upcoming work and why-now logic
  living/                    Current product, GTM, ICP, and portfolio truth
  features/                  One durable feature brief per complex feature
  launch/                    Launch plans, release notes, announcements
  research/                  Research plans, synthesis, JTBD
  enablement/                Sales enablement, battlecards, objection handling
  source-summaries/          Curated summaries of source artifacts
  templates/                 Reusable PMM templates
  drafts/                    Working drafts, not current authority
  archive/                   Superseded roadmap material with replacement links
```

## Update Rules

1. Every feature with meaningful roadmap weight gets a stable `FEAT-0001` style ID.
2. Every feature row must include source artifacts, linked ORCH IDs if any, confidence, staleness, and success metrics.
3. `Now` and `Current Build` must mirror active `Mingla_Artifacts/` status, not wishful planning.
4. Launch readiness requires linked implementation/test evidence or an explicit accepted condition.
5. Drafts must graduate into `living/`, `features/`, `launch/`, `research/`, or `enablement/` before being cited as current truth.
6. Superseded roadmap documents move to `archive/` only after `ROADMAP_MANIFEST.md` names the replacement authority.
7. Do not link directly to ignored private prompts. Link to durable reports, specs, decisions, or source summaries instead.

## Current Entrypoints

| Need | Link |
|---|---|
| Roadmap document authority and archive policy | [`ROADMAP_MANIFEST.md`](ROADMAP_MANIFEST.md) |
| Feature registry | [`FEATURE_REGISTRY.md`](FEATURE_REGISTRY.md) |
| High-level roadmap | [`HIGH_LEVEL_ROADMAP.md`](HIGH_LEVEL_ROADMAP.md) |
| Active build mirror | [`CURRENT_BUILD.md`](CURRENT_BUILD.md) |
| Next-up sequencing | [`NEXT_UP.md`](NEXT_UP.md) |
| Product strategy | [`living/PRODUCT_STRATEGY.md`](living/PRODUCT_STRATEGY.md) |
| GTM and positioning | [`living/GTM_AND_POSITIONING.md`](living/GTM_AND_POSITIONING.md) |
| Customer and ICP | [`living/CUSTOMER_AND_ICP.md`](living/CUSTOMER_AND_ICP.md) |
| Feature portfolio | [`living/FEATURE_PORTFOLIO.md`](living/FEATURE_PORTFOLIO.md) |
