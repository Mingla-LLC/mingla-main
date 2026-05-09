# Investigation: ORCH-0760 Mingla Roadmap Product/Marketing System

> Date: 2026-05-08
> Source: Orchestrator dispatch `Mingla_Artifacts/prompts/FORENSICS_ORCH-0760_MINGLA_ROADMAP_PRODUCT_MARKETING_SYSTEM.md`
> Confidence: H for documentation architecture and current artifact classification; M for exact first-version roadmap contents until `$pmm-mingla` synthesizes feature rows from the classified sources.
> Status: root cause proven; implementation/spec handoff ready after orchestrator review.

## Verdict

Create a separate product/marketing planning root, but make it a **planning mirror**, not a second operating system.

Recommended path name: `Mingla_Roadmap/` with display name **Mingla Roadmap**. The underscore matches the existing `Mingla_Artifacts/` convention and avoids shell/Markdown friction from spaces. If the operator strongly prefers the literal folder name, `Mingla Roadmap/` is workable, but every tooling/script/link pass must handle spaces deliberately.

`Mingla_Artifacts/` should remain the authority for lifecycle status, ORCH IDs, investigations, specs, implementation reports, QA, root causes, decisions, invariants, archives, and evidence. `Mingla_Roadmap/` should become the authority for product/market intent: feature registry, high-level roadmap, PMM/GTM strategy, launch planning, research, and sales enablement, with each feature linking back to artifact evidence.

Do not move existing strategy docs into the new folder in the first pass. Instead, create current summaries and backlink every summary to its source artifact. Several source docs are explicitly stale, partially superseded, or manifest-classified as archive-only; moving them wholesale would launder stale content into apparent current truth.

## Plain-English Impact

Today, a founder or PMM can see a lot of truth, but not the clean product story:

- execution status lives in ledgers and ORCH banners;
- feature intent lives across PRD, strategy, business roadmap, GitHub epics, founder feedback, and competitive docs;
- some roadmap docs are useful but stale;
- some strategy docs are historical but still strategically valuable;
- a tracked SQL runbook sits at the top level of `Mingla_Artifacts/`;
- README says it is a snapshot, not the truth system.

The result is decision friction: "What are we building?", "Why?", "What is current?", "What is next?", and "Which ORCH proves the state?" require cross-reading many artifacts. A dedicated roadmap root fixes this if it is designed as a curated planning layer tied to evidence.

## Current-State Evidence

| Layer | Evidence | Finding |
|---|---|---|
| Repo front door | `README.md:17-32` says README is a snapshot and points to `ARTIFACT_MANIFEST`, `WORLD_MAP`, `PRODUCT_SNAPSHOT`, `PRIORITY_BOARD`, decisions, invariants, link audit, and archive. | README must not become the roadmap truth database. It can link to a roadmap front door later. |
| Repo map | `README.md:80-95` lists `Mingla_Artifacts/` as the program operating system and evidence trail. | `Mingla_Artifacts` is already the evidence system, not the product-planning UI. |
| Constitution | `README.md:55-64` requires one owner per truth, no fabricated data, and subtract before adding. | A new roadmap must not duplicate lifecycle/status authority or fabricate feature state. |
| Artifact system | `.codex/skills/orchestrator-mingla/references/artifact-system.md:3-35` defines `Mingla_Artifacts/` as durable program memory and says reports/specs/archive/prompts each have specific roles. | The new folder needs a separate role: planning/current product intent. |
| Artifact sync | `.codex/skills/orchestrator-mingla/references/artifact-system.md:128-139` defines when program ledgers update. | Closed ORCHs should sync roadmap views only through a defined contract, not ad hoc edits. |
| Evidence rules | `.codex/skills/orchestrator-mingla/references/artifact-system.md:141-146` says code/schema/tests with current dates beat old reports and conflicts must be preserved. | Roadmap summaries must label stale or historical sources. |
| PMM skill | `.codex/skills/pmm-mingla/SKILL.md:8-20` defines PMM as product + product marketing + GTM + sales enablement partner. | `$pmm-mingla` is the right owner to create product/market artifacts after forensics/spec. |
| PMM roadmap rule | `.codex/skills/pmm-mingla/SKILL.md:107-118` says roadmaps should be outcome-driven and distinguish `Committed`, `Planned`, and `Exploring`. | High-level roadmap should use outcomes and confidence/status buckets, not raw issue lists. |
| Product operating context | `AGENTS.md:3-17` says product/GTM/sales enablement are first-class, and product work must start from customer pain, tie to outcomes, and produce usable artifacts. | `AGENTS.md` supports a first-class planning folder, but the file is currently untracked in this worktree. |
| Tooling gates | `scripts/docs/check_artifact_placement.py:72-75` requires `.claude/`, `.codex/`, `outputs/`, and `Mingla_Artifacts/prompts/` to stay ignored/private. | Roadmap docs should be tracked; prompts stay private. |
| README gate | `scripts/docs/check_readme_snapshot.py:29-39` requires README snapshot language and manifest/archive links. | README update must remain a front-door link, not a second manifest. |
| Current check | `python3 scripts/docs/check_artifact_placement.py` and `python3 scripts/docs/check_readme_snapshot.py` both PASS on 2026-05-08. | Current docs lock-in is healthy before ORCH-0760 changes. |

## Existing Roadmap/Product/Marketing Artifact Inventory

| Path | Current role | Current authority status | Problem | Recommended destination/action | Evidence |
|---|---|---|---|---|---|
| `Mingla_Artifacts/BUSINESS_PRD.md` | Business founding PRD and feature inventory | Partial current authority | It has useful MVP/product inventory, but header warns `mingla-web` references are stale. | `MIGRATE_SUMMARY_TO_ROADMAP_KEEP_SOURCE`; link from feature registry and product strategy. | Manifest says `CURRENT_AUTHORITY` but `current_authority = partial` at `ARTIFACT_MANIFEST.md:56`; stale banner at `BUSINESS_PRD.md:3-11`; feature inventory starts at `BUSINESS_PRD.md:59`. |
| `Mingla_Artifacts/BUSINESS_PROJECT_PLAN.md` | Granular business execution plan | Historical evidence | It translates PRD into execution tasks but includes stale `mingla-web` layout and is manifest-classified archive-only. | `KEEP_AS_HISTORICAL_EVIDENCE`; summarize only where needed. | `ARTIFACT_MANIFEST.md:57`; stale banner at `BUSINESS_PROJECT_PLAN.md:3-15`; old repo layout at `BUSINESS_PROJECT_PLAN.md:108-116`. |
| `Mingla_Artifacts/BUSINESS_STRATEGIC_PLAN.md` | Business strategy, MVP scope, milestones | Historical/partial strategic source | Header marks stale web assumptions; manifest says archive-only, but it still contains MVP, goals, risks, and milestones. | `MIGRATE_SUMMARY_TO_ROADMAP_KEEP_SOURCE`; use as historical strategy source with staleness labels. | `ARTIFACT_MANIFEST.md:58`; stale banner at `BUSINESS_STRATEGIC_PLAN.md:3-11`; MVP definition at `BUSINESS_STRATEGIC_PLAN.md:61-89`; milestones at `BUSINESS_STRATEGIC_PLAN.md:102-150`. |
| `Mingla_Artifacts/MINGLA_BRAIN_AGENT_STRATEGY.md` | Brain/agent brainstorm strategy | Historical strategic source | Status says no implementation dispatched; references a missing/old Launch Readiness Tracker. | `MIGRATE_SUMMARY_TO_ROADMAP_KEEP_SOURCE`; create a future bet entry only. | `ARTIFACT_MANIFEST.md:65`; status at `MINGLA_BRAIN_AGENT_STRATEGY.md:3`; conversion path at `MINGLA_BRAIN_AGENT_STRATEGY.md:256`; launch tracker reference at `MINGLA_BRAIN_AGENT_STRATEGY.md:289`. |
| `Mingla_Artifacts/MINGLA_BUSINESS_MARKETING_HUB_STRATEGY.md` | Marketing hub/Cycle B5 strategy | Strong historical strategy source for post-MVP | Manifest says archive-only, but doc itself claims long-lived strategic context for B5. Needs reconciliation. | `MIGRATE_SUMMARY_TO_ROADMAP_KEEP_SOURCE`; make B5 marketing infrastructure a roadmap feature group with prerequisites. | `ARTIFACT_MANIFEST.md:66`; status and B5 claim at `MINGLA_BUSINESS_MARKETING_HUB_STRATEGY.md:3-16`; prerequisite chain at `MINGLA_BUSINESS_MARKETING_HUB_STRATEGY.md:20-34`; conversion path at `MINGLA_BUSINESS_MARKETING_HUB_STRATEGY.md:799`. |
| `Mingla_Artifacts/MINGLA_PRODUCT_COMPETITIVE_ANALYSIS.md` | Product and competitive analysis | Historical/partial product strategy source | Valuable feature inventory and competitive positioning, but manifest says not current product contract. | `MIGRATE_SUMMARY_TO_ROADMAP_KEEP_SOURCE`; extract current feature inventory and future expansion hypotheses with assumptions. | `ARTIFACT_MANIFEST.md:67`; consumer/business feature inventories at `MINGLA_PRODUCT_COMPETITIVE_ANALYSIS.md:72` and `:148`; features to build at `:277`, `:305`, `:326`, `:346`. |
| `Mingla_Artifacts/POSITIONING_AND_GTM_STRATEGY.md` | Consumer positioning, pricing, launch playbook | Historical/partial GTM source | It is dated 2026-04-06 and includes live readiness numbers that are now likely stale. | `MIGRATE_SUMMARY_TO_ROADMAP_KEEP_SOURCE`; revalidate before current GTM use. | `ARTIFACT_MANIFEST.md:69`; last updated at `POSITIONING_AND_GTM_STRATEGY.md:3`; launch readiness audit at `:429`; pre-launch checklist at `:524`; North Star at `:558`. |
| `Mingla_Artifacts/FOUNDER_FEEDBACK.md` | Founder feedback intake log | Historical/active signal ledger | Manifest says archive-only, but current entries are active roadmap inputs. Needs status reconciliation. | `LINK_FROM_ROADMAP`; roadmap should pull open/triaged feedback into feature registry, not move the log. | `ARTIFACT_MANIFEST.md:61`; append-only format at `FOUNDER_FEEDBACK.md:1-3`; active media/delete feedback at `FOUNDER_FEEDBACK.md:18-29`. |
| `Mingla_Artifacts/RETENTION_REMINDERS.md` | Operator cleanup reminders | Operational runbook | Not product/marketing roadmap. | `KEEP_IN_ARTIFACTS`; no roadmap migration. | `ARTIFACT_MANIFEST.md:72`; operator cleanup purpose at `RETENTION_REMINDERS.md:1-3`. |
| `Mingla_Artifacts/specs/SPEC_BIZ_FRONTEND_JOURNEY_BUILD_ROADMAP.md` | Business frontend journey/cycle roadmap spec | Partial current authority / partially superseded | It is the richest roadmap artifact, but its own header says Cycles 6+ need re-spec and many `mingla-web` references are stale. | `MIGRATE_SUMMARY_TO_ROADMAP_KEEP_SOURCE`; create a `roadmap-source` appendix and current cycle map from it. | Status at `SPEC_BIZ_FRONTEND_JOURNEY_BUILD_ROADMAP.md:13-18`; stale web banner at `:3-11`; journey table starts at `:72`; cycle sequencing at `:264`; confidence/open uncertainty at `:716-750`. |
| `Mingla_Artifacts/reports/AUDIT_BIZ_JOURNEY_GAPS.md` | Coverage audit for business journeys | Historical evidence | Useful for feature completeness but shares stale web caveat. | `LINK_FROM_ROADMAP`; use as evidence for missing design/product detail. | Header at `AUDIT_BIZ_JOURNEY_GAPS.md:3-12`; silent journeys section at `:147-187`; risks at `:257`. |
| `Mingla_Artifacts/specs/SPEC_BIZ_DEPENDENCY_MANIFEST.md` | Dependency roadmap/spec | Partially superseded technical spec | Includes obsolete Next.js `mingla-web` deps. | `KEEP_AS_HISTORICAL_EVIDENCE`; link only from technical dependency notes if needed. | Status at `SPEC_BIZ_DEPENDENCY_MANIFEST.md:3-14`; obsolete web deps at `:167-178`. |
| `Mingla_Artifacts/github/PLAN.md` and `github/epics/*.md` | GitHub project sync plan and cycle epics | Historical/project sync source | Manifest says `github/` is archive-later; still contains cycle/phase structure that can seed roadmap. | `LINK_FROM_ROADMAP`; keep as project-sync historical evidence, not roadmap authority. | Manifest row at `ARTIFACT_MANIFEST.md:128`; project structure at `github/PLAN.md:5-35`; just-in-time decomposition policy at `github/PLAN.md:37-44`; maintenance at `github/PLAN.md:127-130`. |
| `Mingla_Artifacts/DECISION_LOG.md` | Binding decision authority | Current authority | Several roadmap docs are superseded by decisions, especially DEC-081/086/100. | `KEEP_IN_ARTIFACTS`; roadmap must link decisions per feature. | Manifest says decision authority at `ARTIFACT_MANIFEST.md:60`; DEC-081 at `DECISION_LOG.md:49`; DEC-086 at `:45`; DEC-100 at `:32`. |
| `Mingla_Artifacts/WORLD_MAP.md`, `PRIORITY_BOARD.md`, `MASTER_BUG_LIST.md`, `OPEN_INVESTIGATIONS.md`, `AGENT_HANDOFFS.md`, `PRODUCT_SNAPSHOT.md`, `COVERAGE_MAP.md`, `ROOT_CAUSE_REGISTER.md` | ORCH lifecycle and evidence ledgers | Current/partial ledgers | They are execution truth, not product strategy docs. | `KEEP_IN_ARTIFACTS`; roadmap links these for lifecycle state. | Authority map at `ARTIFACT_MANIFEST.md:36-48`; ledger rows at `:54`, `:64`, `:68`, `:70-71`, `:78`. |

## Homeless/Dirty Artifact Findings

Top-level `Mingla_Artifacts/` currently has 27 files:

| Path | Classification | Action |
|---|---|---|
| `.transitional-baseline.txt` | `KEEP_IN_ARTIFACTS` | Keep as tooling/support file unless future manifest pass classifies it. |
| `AGENT_HANDOFFS.md` | `KEEP_IN_ARTIFACTS` | Current lifecycle handoff ledger. |
| `ARTIFACT_MANIFEST.md` | `KEEP_IN_ARTIFACTS` | Artifact classification authority. |
| `BUSINESS_PRD.md` | `MIGRATE_SUMMARY_TO_ROADMAP_KEEP_SOURCE` | Keep source; summarize feature inventory into roadmap. |
| `BUSINESS_PROJECT_PLAN.md` | `KEEP_AS_HISTORICAL_EVIDENCE` | Keep source for provenance; do not treat as current dashboard. |
| `BUSINESS_STRATEGIC_PLAN.md` | `MIGRATE_SUMMARY_TO_ROADMAP_KEEP_SOURCE` | Extract MVP/post-MVP strategy with stale labels. |
| `COVERAGE_MAP.md` | `KEEP_IN_ARTIFACTS` | Lifecycle/coverage evidence. |
| `DECISION_LOG.md` | `KEEP_IN_ARTIFACTS` | Binding decision authority. |
| `FOUNDER_FEEDBACK.md` | `LINK_FROM_ROADMAP` | Keep as feedback log; roadmap should consume open/triaged items. |
| `HANDOFF_META_ORCH_0744_PROCESS_BLOCKED_ON_LETTER_W.md` | `MOVE_TO_ARCHIVE_WITH_MANIFEST` | Manifest already says archive-later. |
| `INVARIANT_REGISTRY.md` | `KEEP_IN_ARTIFACTS` | Current invariant authority. |
| `MASTER_BUG_LIST.md` | `KEEP_IN_ARTIFACTS` | Issue ledger. |
| `MINGLA_BRAIN_AGENT_STRATEGY.md` | `MIGRATE_SUMMARY_TO_ROADMAP_KEEP_SOURCE` | Future-bet summary only; no implementation claim. |
| `MINGLA_BUSINESS_MARKETING_HUB_STRATEGY.md` | `MIGRATE_SUMMARY_TO_ROADMAP_KEEP_SOURCE` | B5 strategy summary; preserve prerequisites. |
| `MINGLA_PRODUCT_COMPETITIVE_ANALYSIS.md` | `MIGRATE_SUMMARY_TO_ROADMAP_KEEP_SOURCE` | Extract current feature inventory and positioning hypotheses. |
| `OPEN_INVESTIGATIONS.md` | `KEEP_IN_ARTIFACTS` | Active investigation ledger. |
| `ORCH-0729_PROD_MIGRATION_HISTORY_CLEANUP.sql` | `CLEANUP_REQUIRED` | Tracked executable SQL runbook belongs under `Mingla_Artifacts/backups/`, `archive/migration_history/`, or `Mingla_Artifacts/reports/` as evidence, after manifest/link rewrite. Do not move until orchestrator spec verifies links. |
| `POSITIONING_AND_GTM_STRATEGY.md` | `MIGRATE_SUMMARY_TO_ROADMAP_KEEP_SOURCE` | Extract GTM/positioning with revalidation warnings. |
| `PRIORITY_BOARD.md` | `KEEP_IN_ARTIFACTS` | Execution priority, not roadmap promise. |
| `PRODUCT_SNAPSHOT.md` | `KEEP_IN_ARTIFACTS` | Current product state ledger, not roadmap. |
| `RETENTION_REMINDERS.md` | `KEEP_IN_ARTIFACTS` | Operator cleanup runbook. |
| `RETEST_LEDGER.md` | `KEEP_IN_ARTIFACTS` | Deprecated breadcrumb; keep per docs gate. |
| `ROOT_CAUSE_REGISTER.md` | `KEEP_IN_ARTIFACTS` | Root cause authority. |
| `SPEC_QUEUE.md` | `KEEP_IN_ARTIFACTS` | Deprecated breadcrumb; keep per docs gate. |
| `TEST_QUEUE.md` | `KEEP_IN_ARTIFACTS` | Deprecated breadcrumb; keep per docs gate. |
| `TEST_REPORT_OTP_MULTI_CHANNEL.md` | `MOVE_TO_ARCHIVE_WITH_MANIFEST` | Historical root-level test report; manifest says archive-later. |
| `WORLD_MAP.md` | `KEEP_IN_ARTIFACTS` | Program map/evidence ledger. |

Confirmed cleanup issues:

1. **Top-level SQL runbook is tracked and executable.** `git ls-files` confirms `Mingla_Artifacts/ORCH-0729_PROD_MIGRATION_HISTORY_CLEANUP.sql` is tracked. The file says it mutates `supabase_migrations.schema_migrations`, gives Dashboard/CLI run instructions, and creates a pre-cleanup snapshot (`ORCH-0729_PROD_MIGRATION_HISTORY_CLEANUP.sql:5-31`, `:43-78`). This is not product roadmap material and not ordinary report/spec evidence.
2. **Deprecated queues are intentionally breadcrumbs.** `SPEC_QUEUE.md`, `TEST_QUEUE.md`, and `RETEST_LEDGER.md` say deprecated as of 2026-04-11 and point to `AGENT_HANDOFFS.md` plus archived copies (`SPEC_QUEUE.md:1-9`, `TEST_QUEUE.md:1-9`, `RETEST_LEDGER.md:1-9`). `check_artifact_placement.py:78-92` enforces this.
3. **Historical root test report remains top-level.** `TEST_REPORT_OTP_MULTI_CHANNEL.md` is a historical ORCH-0370 report at root (`TEST_REPORT_OTP_MULTI_CHANNEL.md:1-12`) and manifest says archive-later (`ARTIFACT_MANIFEST.md:77`).
4. **Several strategy docs are intentionally not README surfaces.** Manifest rows `not_yet` / `archive_later` cover strategy docs that may be useful to roadmap but are not current README truth (`ARTIFACT_MANIFEST.md:57-69`, `:155-164`).

## Proposed Folder Architecture

Recommended tracked folder:

```text
Mingla_Roadmap/
  README.md
  FEATURE_REGISTRY.md
  HIGH_LEVEL_ROADMAP.md
  CURRENT_BUILD.md
  NEXT_UP.md
  PRODUCT_STRATEGY.md
  GTM_AND_POSITIONING.md
  FEATURE_TEMPLATES/
    feature-brief-template.md
    launch-plan-template.md
    research-plan-template.md
  feature-briefs/
  launch-plans/
  research/
  archive/
```

| File/folder | Purpose | Owner/skill | Update cadence | Artifact link contract | Authority |
|---|---|---|---|---|---|
| `README.md` | Front door explaining roadmap vs artifacts, status taxonomy, and how to update. | `$pmm-mingla` drafts; `$orchestrator` reviews placement. | On structure changes. | Links to `Mingla_Artifacts/ARTIFACT_MANIFEST.md`, `WORLD_MAP.md`, `PRIORITY_BOARD.md`, and source docs. | Current roadmap navigation only. |
| `FEATURE_REGISTRY.md` | Canonical product/market feature list across surfaces. | `$pmm-mingla`; lifecycle fields reconciled by `$orchestrator`. | Every feature intake/spec/close. | Each feature links ORCH IDs, specs, reports, decisions, source docs. | Current product intent; lifecycle status mirrored from artifacts. |
| `HIGH_LEVEL_ROADMAP.md` | Outcome-driven Now/Next/Later/Exploring roadmap. | `$pmm-mingla`; `$orchestrator` validates artifact state. | Weekly or after material close/steering. | Each roadmap row links one or more `FEAT-*` IDs and evidence refs. | Current product roadmap view. |
| `CURRENT_BUILD.md` | What is actively being built/tested right now. | `$orchestrator` + `$pmm-mingla`. | Each active ORCH state change. | Mirrors `PRIORITY_BOARD`, `OPEN_INVESTIGATIONS`, `AGENT_HANDOFFS`. | Planning view; artifacts remain status authority. |
| `NEXT_UP.md` | Sequenced upcoming work with why-now logic and dependencies. | `$pmm-mingla`; `$orchestrator` validates priority evidence. | Weekly or after priority changes. | Links to `PRIORITY_BOARD.md`, decisions, blockers. | Product planning view. |
| `PRODUCT_STRATEGY.md` | Current product thesis, ICPs, surfaces, bets, non-goals. | `$pmm-mingla`. | After major strategy decisions. | Summarizes PRD/strategic plan/competitive docs with source links and stale labels. | Current product strategy summary. |
| `GTM_AND_POSITIONING.md` | Current positioning, audience, launch motion, packaging/pricing hypotheses. | `$pmm-mingla`. | Before launches or GTM decisions. | Links to GTM strategy, competitive analysis, launch plans, decisions. | Current GTM summary; source claims require revalidation. |
| `FEATURE_TEMPLATES/` | Reusable PMM templates. | `$pmm-mingla`. | Rarely. | May derive from `.codex/skills/pmm-mingla/assets/`. | Template library. |
| `feature-briefs/` | One brief per complex feature or product bet. | `$pmm-mingla`. | When feature enters Exploring/Spec Needed. | Must include `source_artifacts` and `linked_orch_ids`. | Feature-level product intent. |
| `launch-plans/` | Launch tiers, assets, channels, owners, readiness. | `$pmm-mingla`. | Per launch. | Links to feature rows, specs, implementation/test reports, support risks. | Launch planning, not proof of readiness. |
| `research/` | Research plans, JTBD, interview synthesis. | `$pmm-mingla` or `$forensics` depending task. | Per research cycle. | Links to feature/strategy rows and source evidence. | Research artifacts. |
| `archive/` | Superseded roadmap views only. | `$orchestrator` approves archive moves. | When roadmap docs are superseded. | Archive index must say replacement current source. | Historical roadmap evidence. |

## Feature Registry Contract

Use independent feature IDs: `FEAT-0001`, `FEAT-0002`, etc.

Rationale:

- A single product feature can require many ORCH IDs across investigation, spec, implementation, tester retest, runtime smoke, PMM launch, and follow-on hardening.
- Some ORCH IDs are bugs or lifecycle repairs, not product features.
- Some roadmap features begin before an ORCH exists.
- ORCH IDs should remain evidence/lifecycle IDs; feature IDs should remain product intent IDs.

Required row schema:

| Field | Contract |
|---|---|
| `Feature ID` | Stable `FEAT-0001` style ID. |
| `Feature` | Human-readable name. |
| `Surface` | One of `app-mobile`, `mingla-business`, `mingla-admin`, `mingla-marketing`, `supabase`, `cross-surface`. |
| `Customer/User` | Primary user; include buyer/decision-maker where relevant. |
| `Pain / Job` | Customer pain or JTBD. |
| `Business Outcome` | Revenue, retention, activation, conversion, trust, efficiency, differentiation, etc. |
| `Product Status` | `Idea`, `Exploring`, `Spec Needed`, `Ready for Build`, `Building`, `Testing`, `Launched`, `Deferred`, `Archived`. |
| `Roadmap Bucket` | `Now`, `Next`, `Later`, `Exploring`. |
| `PMM/GTM Status` | `None`, `Positioning Needed`, `Launch Plan Needed`, `Enablement Needed`, `Ready`, `Launched`. |
| `Linked ORCH IDs` | One or more ORCH IDs, or `None yet`. |
| `Evidence Links` | Specs, reports, decisions, source docs. |
| `Dependencies` | Feature, technical, operational, or external dependencies. |
| `Risks` | User, business, technical, GTM, legal, operational risks. |
| `Success Metrics` | Observable product/GTM metrics. |
| `Launch Tier` | Tier 1-4 per `pmm-mingla`. |
| `Owner` | PMM/product/orchestrator/operator role. |
| `Last Updated` | ISO date. |

Status rules:

- `Product Status` may be set by roadmap only when no ORCH exists yet.
- Once an ORCH exists, lifecycle status mirrors `Mingla_Artifacts`.
- `Launched` requires closed implementation/test evidence or explicit accepted conditional evidence.
- `Deferred` must cite a decision, dependency, or operator note.
- `Archived` must name replacement or reason.

## High-Level Roadmap Contract

Roadmap should be outcome-driven:

| Timeframe | Strategic Theme | Customer Outcome | Product Bets / Feature IDs | Artifact Evidence | Success Metric | Confidence | Status |
|---|---|---|---|---|---|---|---|

Recommended sections:

1. **Now:** active build/test/runtime proof. Mirrors `PRIORITY_BOARD` and `OPEN_INVESTIGATIONS`.
2. **Next:** sequenced feature bets with dependencies and why-now rationale.
3. **Later:** post-MVP or lower-confidence bets.
4. **Exploring:** research/strategy hypotheses not yet ready for ORCH/spec.
5. **Shipped / Recently Launched:** closed features with proof and launch/PMM state.

The roadmap must not imply delivery certainty unless the linked artifact state supports it. Use `Committed`, `Planned`, `Exploring`, and `Deferred`, matching `pmm-mingla` rules.

## Artifact Linking Contract

| Question | Contract |
|---|---|
| Which side is authoritative for lifecycle status? | `Mingla_Artifacts/` is authoritative. `WORLD_MAP`, `OPEN_INVESTIGATIONS`, `PRIORITY_BOARD`, `AGENT_HANDOFFS`, reports, specs, and QA decide lifecycle state. |
| Which side is authoritative for product/market intent? | `Mingla_Roadmap/` is authoritative after creation for current feature intent, PMM framing, roadmap buckets, GTM readiness, launch plans, and sales enablement. |
| How does a feature point at multiple ORCH IDs? | Feature row has `Linked ORCH IDs` plus typed links: `investigation`, `spec`, `implementation`, `test`, `runtime`, `decision`, `launch`. |
| How should a closed ORCH update roadmap? | Orchestrator close should trigger a roadmap sync only when the ORCH is tied to a `FEAT-*`. Update product status, evidence links, shipped/recently launched section, and PMM/GTM status if needed. |
| How should stale strategy docs be summarized? | Summaries must include `source`, `source_date`, `staleness`, and `current_decision_overrides`. Example: "Source says mingla-web; DEC-081/086/100 supersede this." |
| How should `ARTIFACT_MANIFEST.md` classify the new folder? | Add `Mingla_Roadmap/` as external artifact root, kind `roadmap`, domain `product`, role `planning_authority`, status `CURRENT_AUTHORITY`, current_authority `yes`, archive_policy `keep_current`, README_surface `root_snapshot` or new `roadmap_map`. |
| What README changes are needed? | Add one `Source Of Truth` row: "What is the current product roadmap?" -> `Mingla_Roadmap/README.md`. Add `Mingla_Roadmap/` to Repo Map. Do not duplicate feature tables in README. |
| What should not link to private prompts? | Roadmap docs may mention prompt-derived work only through durable reports/specs, because `.gitignore:39-41` keeps `Mingla_Artifacts/prompts/` ignored. |

## Cleanup Plan

Phase 1, before building roadmap:

1. Add manifest rows for `Mingla_Roadmap/` and its first files.
2. Update README snapshot gate to require the roadmap link once README changes.
3. Keep existing strategy docs in place.
4. Create roadmap summaries that cite source docs and decisions.

Phase 2, after roadmap exists and links are proven:

1. Reclassify top-level strategy docs in `ARTIFACT_MANIFEST.md` with `superseded_by` pointing to current roadmap summaries where appropriate.
2. Decide whether `BUSINESS_PROJECT_PLAN.md`, `BUSINESS_STRATEGIC_PLAN.md`, `MINGLA_*_STRATEGY.md`, `POSITIONING_AND_GTM_STRATEGY.md`, `TEST_REPORT_OTP_MULTI_CHANNEL.md`, and `HANDOFF_META_ORCH_0744_PROCESS_BLOCKED_ON_LETTER_W.md` should move to archive.
3. For each move, follow `ARTIFACT_MANIFEST.md:147-153`: manifest row before move, preserve old/new path/reason/supersession/replacement authority, and prove link safety.
4. Move or reclassify `ORCH-0729_PROD_MIGRATION_HISTORY_CLEANUP.sql` only after a spec verifies current references. Recommended destination if moved: `Mingla_Artifacts/archive/migration_history/ORCH-0729_PROD_MIGRATION_HISTORY_CLEANUP.sql` or `Mingla_Artifacts/backups/ORCH-0729_PROD_MIGRATION_HISTORY_CLEANUP.sql`. It should not live under `Mingla_Roadmap/`.
5. Run `python3 scripts/docs/check_links.py --baseline-file scripts/docs/link_baseline.json`, `check_artifact_placement.py`, and `check_readme_snapshot.py` after any move.

Do not move deprecated queue breadcrumbs. The current placement gate explicitly requires them at top-level with archived copies.

## README / Manifest / Tooling Implications

Required spec work:

- `README.md`: add `Mingla_Roadmap/` to `Source Of Truth` and `Repo Map`, keeping the snapshot language intact.
- `Mingla_Artifacts/ARTIFACT_MANIFEST.md`: add external root rows for `Mingla_Roadmap/`, classify first docs, and add a README surface rule for roadmap docs.
- `scripts/docs/check_readme_snapshot.py`: require `Mingla_Roadmap/README.md` once created.
- `scripts/docs/check_artifact_placement.py`: optionally enforce that product/roadmap current docs do not get added under root `outputs/` or stale artifact locations. Existing gate already guards prompts/private roots.
- Link baseline: update only after running link check and documenting any intentional new missing/private paths.
- `.gitignore`: no change recommended; roadmap docs should be tracked, unlike prompts and skill roots.

## Risks And Open Decisions

| Decision | Recommendation | Risk / tradeoff |
|---|---|---|
| Folder name | Use `Mingla_Roadmap/` as path, display as "Mingla Roadmap". | Literal `Mingla Roadmap/` matches user wording but creates shell/link friction. |
| Track in Git? | Yes. | Roadmap is company/product truth and should be durable. |
| Move old strategy docs now? | No. Summarize first, keep sources. | Moving first risks broken links and stale truth laundering. |
| Feature IDs | Use independent `FEAT-*` IDs. | Adds one more ID system, but avoids overloading ORCH IDs. |
| PMM ownership | `$pmm-mingla` owns product/GTM docs; `$orchestrator` owns lifecycle sync and artifact boundaries. | Requires sync discipline at close/intake. |
| First version scope | Build README, feature registry, high-level roadmap, current build, next up, product strategy, GTM positioning, templates. | Launch-plans/research folders can exist empty or with templates only. |
| Current business roadmap | Summarize and supersession-map it; do not make it the new roadmap unchanged. | Requires PMM synthesis from stale and current sources. |
| SQL cleanup | Treat as separate docs/archive cleanup task, not roadmap build. | Cleanup may need its own ORCH/spec if link risk is high. |

## Recommended Spec Scope

Next lifecycle gate should be SPEC mode, not implementation:

`Mingla_Artifacts/specs/SPEC_ORCH-0760_MINGLA_ROADMAP_PRODUCT_MARKETING_SYSTEM.md`

Spec should authorize `$pmm-mingla` to create the first tracked roadmap system, and should require:

1. Create `Mingla_Roadmap/` with `README.md`, `FEATURE_REGISTRY.md`, `HIGH_LEVEL_ROADMAP.md`, `CURRENT_BUILD.md`, `NEXT_UP.md`, `PRODUCT_STRATEGY.md`, `GTM_AND_POSITIONING.md`, `FEATURE_TEMPLATES/`, `feature-briefs/`, `launch-plans/`, `research/`, and `archive/`.
2. Populate first-version feature registry from these sources only: `BUSINESS_PRD.md`, current active ORCH rows in `WORLD_MAP`/`PRIORITY_BOARD`/`OPEN_INVESTIGATIONS`, business roadmap cycle docs, founder feedback, competitive analysis, marketing hub strategy, brain strategy, and current decisions.
3. Every feature row must include source links and confidence/staleness.
4. Do not move existing artifacts in this spec.
5. Update `ARTIFACT_MANIFEST.md` and `README.md` minimally to expose the new roadmap root.
6. Update doc gates if README changes require it.
7. Run documentation gates: `check_artifact_placement.py`, `check_readme_snapshot.py`, and link baseline check.
8. Produce an implementation report under `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0760_MINGLA_ROADMAP_PRODUCT_MARKETING_SYSTEM.md`.

Out of scope for first spec:

- moving/archiving existing top-level strategy docs;
- moving `ORCH-0729_PROD_MIGRATION_HISTORY_CLEANUP.sql`;
- changing product code;
- changing Supabase;
- syncing GitHub project issues;
- broad link-debt cleanup beyond links introduced by ORCH-0760.

## Sources Reviewed

- `Mingla_Artifacts/prompts/FORENSICS_ORCH-0760_MINGLA_ROADMAP_PRODUCT_MARKETING_SYSTEM.md`
- `README.md`
- `AGENTS.md`
- `.codex/skills/forensic-mingla/SKILL.md`
- `.codex/skills/forensic-mingla/references/forensic-checklist.md`
- `.codex/skills/forensic-mingla/references/report-template.md`
- `.codex/skills/orchestrator-mingla/SKILL.md`
- `.codex/skills/orchestrator-mingla/references/artifact-system.md`
- `.codex/skills/pmm-mingla/SKILL.md`
- `scripts/docs/check_artifact_placement.py`
- `scripts/docs/check_readme_snapshot.py`
- `.gitignore`
- `Mingla_Artifacts/ARTIFACT_MANIFEST.md`
- `Mingla_Artifacts/WORLD_MAP.md`
- `Mingla_Artifacts/PRIORITY_BOARD.md`
- `Mingla_Artifacts/PRODUCT_SNAPSHOT.md`
- `Mingla_Artifacts/MASTER_BUG_LIST.md`
- `Mingla_Artifacts/OPEN_INVESTIGATIONS.md`
- `Mingla_Artifacts/DECISION_LOG.md`
- `Mingla_Artifacts/ROOT_CAUSE_REGISTER.md`
- `Mingla_Artifacts/COVERAGE_MAP.md`
- `Mingla_Artifacts/AGENT_HANDOFFS.md`
- `Mingla_Artifacts/BUSINESS_PRD.md`
- `Mingla_Artifacts/BUSINESS_PROJECT_PLAN.md`
- `Mingla_Artifacts/BUSINESS_STRATEGIC_PLAN.md`
- `Mingla_Artifacts/MINGLA_BRAIN_AGENT_STRATEGY.md`
- `Mingla_Artifacts/MINGLA_BUSINESS_MARKETING_HUB_STRATEGY.md`
- `Mingla_Artifacts/MINGLA_PRODUCT_COMPETITIVE_ANALYSIS.md`
- `Mingla_Artifacts/POSITIONING_AND_GTM_STRATEGY.md`
- `Mingla_Artifacts/FOUNDER_FEEDBACK.md`
- `Mingla_Artifacts/RETENTION_REMINDERS.md`
- `Mingla_Artifacts/specs/SPEC_BIZ_FRONTEND_JOURNEY_BUILD_ROADMAP.md`
- `Mingla_Artifacts/reports/AUDIT_BIZ_JOURNEY_GAPS.md`
- `Mingla_Artifacts/specs/SPEC_BIZ_DEPENDENCY_MANIFEST.md`
- `Mingla_Artifacts/github/PLAN.md`
- `Mingla_Artifacts/github/epics/*.md`
- `Mingla_Artifacts/ORCH-0729_PROD_MIGRATION_HISTORY_CLEANUP.sql`

Verification commands run:

```bash
python3 scripts/docs/check_artifact_placement.py
python3 scripts/docs/check_readme_snapshot.py
find Mingla_Artifacts -maxdepth 1 -type f | sort
git ls-files Mingla_Artifacts/ORCH-0729_PROD_MIGRATION_HISTORY_CLEANUP.sql Mingla_Artifacts/*.md
```
