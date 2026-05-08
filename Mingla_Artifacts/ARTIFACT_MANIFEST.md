# Mingla Artifact Manifest

> Updated: 2026-05-07  
> Verification commit: `8168cf16`  
> Source investigation: `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0750_DOCUMENTATION_ARTIFACTS_TOTAL_SWEEP.md`  
> Source spec: `Mingla_Artifacts/specs/SPEC_ORCH-0750A_ARTIFACT_MANIFEST_LINK_INTEGRITY.md`  
> Archive implementation spec: `Mingla_Artifacts/specs/SPEC_ORCH-0750C_ARCHIVE_DELETE_PASS.md`  
> Documentation lock-in spec: `Mingla_Artifacts/specs/SPEC_ORCH-0750D_DOCUMENTATION_SYSTEM_LOCK_IN.md`  
> Scope note: this manifest classifies artifacts, records ORCH-0750C archive moves/copies, and records ORCH-0750D documentation regression gates.  
> Maintenance note: this version is manually curated with script-assisted link evidence. Later passes may automate population.

## How To Read This Manifest

This file is the first-pass map of Mingla's documentation and artifact truth system.

- `current_authority = yes` means the artifact can be cited as current truth for its domain.
- `current_authority = partial` means the artifact contains useful current truth but also contains stale or historical sections that must be handled carefully.
- `archive_policy = archived` means the historical artifact now lives under `Mingla_Artifacts/archive/`.
- `archive_policy = archive_later` means keep the file where it is for now; a later pass may move it after breadcrumbs and links are safe.
- `README_surface` controls how README may reference the artifact in ORCH-0750B.

## Status Taxonomy

| Status | Plain-English meaning | Mingla example |
|---|---|---|
| `CURRENT_AUTHORITY` | Use this for current product/program truth. | `Mingla_Artifacts/INVARIANT_REGISTRY.md` |
| `CURRENT_LEDGER` | Ongoing chronology; useful but not a clean dashboard. | `Mingla_Artifacts/AGENT_HANDOFFS.md` |
| `HISTORICAL_AUTHORITY` | Historical evidence that remains important and authoritative for provenance. | `Mingla_Artifacts/migrations_archive_orch_0729_2026-05-05/` |
| `SUPERSEDED_KEEP` | Replaced by a newer artifact, but retained for proof. | `Mingla_Artifacts/archive/outputs_legacy/SPEC_B2_PATH_C_V2.md` |
| `ARCHIVE_ONLY` | Keep for provenance; do not use as current instructions. | `Mingla_Artifacts/archive/handoffs_legacy/clade_transfer/HANDOFF_ORCH_0737_V6_PIPELINE_REDESIGN.md` |
| `DELETE_CANDIDATE_AFTER_LINK_REWRITE` | Possibly removable only after replacement and green link proof. | generated `.vercel/README.txt` if tracked later |
| `GENERATED_IGNORE` | Generated/local output that should not inform docs. | ignored `dist/`, `.expo/`, `.vercel/` material |
| `PRIVATE_PROMPT_NOT_VERSIONED` | Prompt reference exists only in ignored/private prompt storage. | missing links into `Mingla_Artifacts/prompts/` |
| `MISSING_REFERENCE_NEEDS_REWRITE` | Link target is absent and needs replacement, archive lookup, or textual citation. | missing `LAUNCH_READINESS_TRACKER.md` references |

## Current Authority Map

| Authority area | Current source | Caveat |
|---|---|---|
| Program operating state | `Mingla_Artifacts/OPEN_INVESTIGATIONS.md` | Ledger, not clean dashboard |
| Work handoffs | `Mingla_Artifacts/AGENT_HANDOFFS.md` | Link-broken; prompt paths need classification |
| Product/invariant truth | `Mingla_Artifacts/INVARIANT_REGISTRY.md` | Current authority |
| Decisions | `Mingla_Artifacts/DECISION_LOG.md` | Current authority |
| Root causes | `Mingla_Artifacts/ROOT_CAUSE_REGISTER.md` | Current authority |
| Priorities | `Mingla_Artifacts/PRIORITY_BOARD.md` | Partial; old Top 20 remains |
| Product snapshot | `Mingla_Artifacts/PRODUCT_SNAPSHOT.md` | Partial; old operational alerts remain |
| Historical migration truth | `Mingla_Artifacts/migrations_archive_orch_0729_2026-05-05/` | Preserve; do not delete |
| README truth | `README.md` | Snapshot front door; rebuilt in ORCH-0750B and archive-aware in ORCH-0750C |

## Top-Level Mingla_Artifacts

| artifact_id | path | kind | domain | role | status | supersedes | superseded_by | current_authority | archive_policy | last_verified_commit | README_surface | notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ART-TOP-AGENT-HANDOFFS | `Mingla_Artifacts/AGENT_HANDOFFS.md` | ledger | program | ledger | `CURRENT_LEDGER` | None | None | partial | keep_current | `8168cf16` | artifact_map | Pipeline chronology; 225 missing links in current audit. |
| ART-TOP-ARTIFACT-MANIFEST | `Mingla_Artifacts/ARTIFACT_MANIFEST.md` | ledger | docs | authority | `CURRENT_AUTHORITY` | None | None | yes | keep_current | `8168cf16` | artifact_map | Canonical ORCH-0750A artifact authority map. |
| ART-TOP-BUSINESS-PRD | `Mingla_Artifacts/BUSINESS_PRD.md` | strategy | business | authority | `CURRENT_AUTHORITY` | None | None | partial | keep_current | `8168cf16` | artifact_map | Business product requirements; date/version should be reverified before README summary. |
| ART-TOP-BUSINESS-PROJECT-PLAN | `Mingla_Artifacts/BUSINESS_PROJECT_PLAN.md` | strategy | business | historical_evidence | `ARCHIVE_ONLY` | None | None | no | archive_later | `8168cf16` | not_yet | Planning artifact; not current operating dashboard. |
| ART-TOP-BUSINESS-STRATEGIC-PLAN | `Mingla_Artifacts/BUSINESS_STRATEGIC_PLAN.md` | strategy | business | historical_evidence | `ARCHIVE_ONLY` | None | None | no | archive_later | `8168cf16` | not_yet | Strategy artifact; preserve until ORCH-0750C classification deepens. |
| ART-TOP-COVERAGE-MAP | `Mingla_Artifacts/COVERAGE_MAP.md` | dashboard | program | dashboard | `CURRENT_LEDGER` | None | None | partial | keep_current | `8168cf16` | artifact_map | Current close banners plus historical coverage notes. |
| ART-TOP-DECISION-LOG | `Mingla_Artifacts/DECISION_LOG.md` | ledger | program | authority | `CURRENT_AUTHORITY` | None | None | yes | keep_current | `8168cf16` | artifact_map | Decision authority. |
| ART-TOP-FOUNDER-FEEDBACK | `Mingla_Artifacts/FOUNDER_FEEDBACK.md` | ledger | program | historical_evidence | `ARCHIVE_ONLY` | None | None | no | archive_later | `8168cf16` | not_yet | Founder notes; not current source of truth without revalidation. |
| ART-TOP-HANDOFF-META-ORCH-0744 | `Mingla_Artifacts/HANDOFF_META_ORCH_0744_PROCESS_BLOCKED_ON_LETTER_W.md` | handoff | program | historical_evidence | `ARCHIVE_ONLY` | None | None | no | archive_later | `8168cf16` | not_yet | Specific historical handoff. |
| ART-TOP-INVARIANT-REGISTRY | `Mingla_Artifacts/INVARIANT_REGISTRY.md` | ledger | program | authority | `CURRENT_AUTHORITY` | None | None | yes | keep_current | `8168cf16` | artifact_map | Invariant authority. |
| ART-TOP-MASTER-BUG-LIST | `Mingla_Artifacts/MASTER_BUG_LIST.md` | ledger | program | ledger | `CURRENT_LEDGER` | None | None | partial | keep_current | `8168cf16` | artifact_map | Large historical/current issue ledger; 199 missing links in current audit. |
| ART-TOP-MINGLA-BRAIN-AGENT-STRATEGY | `Mingla_Artifacts/MINGLA_BRAIN_AGENT_STRATEGY.md` | strategy | cross-cutting | historical_evidence | `ARCHIVE_ONLY` | None | None | no | archive_later | `8168cf16` | not_yet | Strategy artifact, not current implementation truth. |
| ART-TOP-BUSINESS-MARKETING-HUB | `Mingla_Artifacts/MINGLA_BUSINESS_MARKETING_HUB_STRATEGY.md` | strategy | marketing | historical_evidence | `ARCHIVE_ONLY` | None | None | no | archive_later | `8168cf16` | not_yet | Marketing hub strategy; preserve. |
| ART-TOP-PRODUCT-COMPETITIVE | `Mingla_Artifacts/MINGLA_PRODUCT_COMPETITIVE_ANALYSIS.md` | strategy | marketing | historical_evidence | `ARCHIVE_ONLY` | None | None | no | archive_later | `8168cf16` | not_yet | Competitive analysis; not current product contract. |
| ART-TOP-OPEN-INVESTIGATIONS | `Mingla_Artifacts/OPEN_INVESTIGATIONS.md` | ledger | program | ledger | `CURRENT_LEDGER` | None | None | partial | keep_current | `8168cf16` | artifact_map | Active intake/dispatch ledger; 57 missing links in current audit. |
| ART-TOP-POSITIONING-GTM | `Mingla_Artifacts/POSITIONING_AND_GTM_STRATEGY.md` | strategy | marketing | historical_evidence | `ARCHIVE_ONLY` | None | None | no | archive_later | `8168cf16` | not_yet | GTM strategy; data claims require revalidation before current README use. |
| ART-TOP-PRIORITY-BOARD | `Mingla_Artifacts/PRIORITY_BOARD.md` | dashboard | program | dashboard | `CURRENT_AUTHORITY` | None | None | partial | keep_current | `8168cf16` | artifact_map | Current banners plus old Top 20; ORCH-0750B/0750C must split. |
| ART-TOP-PRODUCT-SNAPSHOT | `Mingla_Artifacts/PRODUCT_SNAPSHOT.md` | dashboard | program | dashboard | `CURRENT_AUTHORITY` | None | None | partial | keep_current | `8168cf16` | artifact_map | Current banners plus old alerts/readiness; not clean snapshot yet. |
| ART-TOP-RETENTION-REMINDERS | `Mingla_Artifacts/RETENTION_REMINDERS.md` | runbook | mobile | historical_evidence | `ARCHIVE_ONLY` | None | None | no | archive_later | `8168cf16` | not_yet | Historical feature notes; preserve. |
| ART-TOP-RETEST-LEDGER | `Mingla_Artifacts/RETEST_LEDGER.md` | ledger | program | breadcrumb | `ARCHIVE_ONLY` | None | `Mingla_Artifacts/AGENT_HANDOFFS.md` | no | keep_breadcrumb | `8168cf16` | archive_index | Deprecated 2026-04-11; full copy archived at `Mingla_Artifacts/archive/old_trackers/RETEST_LEDGER.md`. |
| ART-TOP-ROOT-CAUSE-REGISTER | `Mingla_Artifacts/ROOT_CAUSE_REGISTER.md` | ledger | program | authority | `CURRENT_AUTHORITY` | None | None | yes | keep_current | `8168cf16` | artifact_map | Root cause authority. |
| ART-TOP-SPEC-QUEUE | `Mingla_Artifacts/SPEC_QUEUE.md` | ledger | program | breadcrumb | `ARCHIVE_ONLY` | None | `Mingla_Artifacts/AGENT_HANDOFFS.md` | no | keep_breadcrumb | `8168cf16` | archive_index | Deprecated 2026-04-11; full copy archived at `Mingla_Artifacts/archive/old_trackers/SPEC_QUEUE.md`. |
| ART-TOP-TEST-QUEUE | `Mingla_Artifacts/TEST_QUEUE.md` | ledger | program | breadcrumb | `ARCHIVE_ONLY` | None | `Mingla_Artifacts/AGENT_HANDOFFS.md` | no | keep_breadcrumb | `8168cf16` | archive_index | Deprecated 2026-04-11; full copy archived at `Mingla_Artifacts/archive/old_trackers/TEST_QUEUE.md`. |
| ART-TOP-OTP-TEST-REPORT | `Mingla_Artifacts/TEST_REPORT_OTP_MULTI_CHANNEL.md` | report | mobile | historical_evidence | `ARCHIVE_ONLY` | None | None | no | archive_later | `8168cf16` | archive_index | Historical test report. |
| ART-TOP-WORLD-MAP | `Mingla_Artifacts/WORLD_MAP.md` | dashboard | program | dashboard | `CURRENT_LEDGER` | None | None | partial | keep_current | `8168cf16` | artifact_map | Program index but link-broken; 172 missing links in current audit. |

## Reports And Specs

| artifact_id | path | kind | domain | role | status | supersedes | superseded_by | current_authority | archive_policy | last_verified_commit | README_surface | notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ART-DIR-REPORTS | `Mingla_Artifacts/reports/` | report | program | historical_evidence | `CURRENT_LEDGER` | None | None | partial | keep_current | `8168cf16` | artifact_map | Directory contains 209 report files at ORCH-0750A implementation time. Individual latest reports remain evidence. |
| ART-DIR-SPECS | `Mingla_Artifacts/specs/` | spec | program | historical_evidence | `CURRENT_LEDGER` | None | None | partial | keep_current | `8168cf16` | artifact_map | Directory contains 67 spec files at ORCH-0750A implementation time. |
| ART-REPORT-ORCH-0750 | `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0750_DOCUMENTATION_ARTIFACTS_TOTAL_SWEEP.md` | report | docs | authority | `CURRENT_AUTHORITY` | None | None | yes | keep_current | `8168cf16` | artifact_map | Source investigation for documentation cleanup project. |
| ART-SPEC-ORCH-0750A | `Mingla_Artifacts/specs/SPEC_ORCH-0750A_ARTIFACT_MANIFEST_LINK_INTEGRITY.md` | spec | docs | authority | `CURRENT_AUTHORITY` | None | None | yes | keep_current | `8168cf16` | artifact_map | Implementation contract for this manifest/link phase. |
| ART-REPORT-ORCH-0750A-LINK-AUDIT | `Mingla_Artifacts/reports/ORCH-0750A_LINK_AUDIT.md` | report | docs | authority | `CURRENT_AUTHORITY` | None | None | yes | keep_current | `8168cf16` | artifact_map | Current reproducible link audit for ORCH-0750A. |
| ART-SPEC-ORCH-0750D | `Mingla_Artifacts/specs/SPEC_ORCH-0750D_DOCUMENTATION_SYSTEM_LOCK_IN.md` | spec | docs | authority | `CURRENT_AUTHORITY` | None | None | yes | keep_current | `8168cf16` | artifact_map | Contract for documentation placement, skill alignment, README snapshot, and CI lock-in. |
| ART-REPORT-ORCH-0750D-IMPLEMENTATION | `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0750D_DOCUMENTATION_SYSTEM_LOCK_IN.md` | report | docs | implementation_evidence | `CURRENT_LEDGER` | None | None | partial | keep_current | `8168cf16` | artifact_map | Implementation evidence for the documentation-system lock-in. |

## External Artifact Roots

| artifact_id | path | kind | domain | role | status | supersedes | superseded_by | current_authority | archive_policy | last_verified_commit | README_surface | notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ART-DOC-DOMAIN-ADRS | `docs/DOMAIN_ADRS.md` | runbook | docs | authority | `CURRENT_AUTHORITY` | None | None | yes | keep_current | `8168cf16` | root_snapshot | Domain architecture decisions. |
| ART-DOC-IMPLEMENTATION-GATES | `docs/IMPLEMENTATION_GATES.md` | runbook | docs | authority | `CURRENT_AUTHORITY` | None | None | yes | keep_current | `8168cf16` | root_snapshot | Implementation gates. |
| ART-DOC-MUTATION-CONTRACT | `docs/MUTATION_CONTRACT.md` | runbook | docs | authority | `CURRENT_AUTHORITY` | None | None | yes | keep_current | `8168cf16` | root_snapshot | Mutation contract. |
| ART-DOC-QUERY-KEY-REGISTRY | `docs/QUERY_KEY_REGISTRY.md` | runbook | docs | authority | `CURRENT_AUTHORITY` | None | None | yes | keep_current | `8168cf16` | root_snapshot | Query key registry. |
| ART-DOC-TRANSITIONAL-ITEMS | `docs/TRANSITIONAL_ITEMS_REGISTRY.md` | runbook | docs | ledger | `CURRENT_LEDGER` | None | None | partial | keep_current | `8168cf16` | artifact_map | References missing launch tracker; needs ORCH-0750B/C rewrite decision. |
| ART-SCRIPT-CHECK-ARTIFACT-PLACEMENT | `scripts/docs/check_artifact_placement.py` | script | docs | regression_gate | `CURRENT_AUTHORITY` | None | None | yes | keep_current | `8168cf16` | root_snapshot | Enforces current artifact placement, legacy root, generated-output, breadcrumb, archive-index, and skill-output rules. |
| ART-SCRIPT-CHECK-README-SNAPSHOT | `scripts/docs/check_readme_snapshot.py` | script | docs | regression_gate | `CURRENT_AUTHORITY` | None | None | yes | keep_current | `8168cf16` | root_snapshot | Enforces README snapshot/front-door rules and required docs gate references. |
| ART-WORKFLOW-DOCS-ARTIFACT-REGRESSION | `.github/workflows/docs-artifact-regression.yml` | workflow | docs | regression_gate | `CURRENT_AUTHORITY` | None | None | yes | keep_current | `8168cf16` | root_snapshot | Runs link baseline, artifact placement, and README snapshot checks on docs/artifact changes. |
| ART-ARCHIVE-ROOT | `Mingla_Artifacts/archive/README.md` | archive | docs | index | `HISTORICAL_AUTHORITY` | None | None | no | keep_current | `8168cf16` | archive_index | ORCH-0750C archive front door. |
| ART-ARCHIVE-OUTPUTS-LEGACY | `Mingla_Artifacts/archive/outputs_legacy/` | archive | business | historical_evidence | `HISTORICAL_AUTHORITY` | `outputs/` | None | no | archived | `8168cf16` | archive_index | Durable copy of ignored historical `outputs/` material. |
| ART-ARCHIVE-HANDOFFS-LEGACY | `Mingla_Artifacts/archive/handoffs_legacy/` | archive | program | historical_evidence | `HISTORICAL_AUTHORITY` | `clade transfer/` | None | no | archived | `8168cf16` | archive_index | Historical transfer handoff archive. |
| ART-ARCHIVE-OLD-TRACKERS | `Mingla_Artifacts/archive/old_trackers/` | archive | program | historical_evidence | `HISTORICAL_AUTHORITY` | `Mingla_Artifacts/SPEC_QUEUE.md; Mingla_Artifacts/TEST_QUEUE.md; Mingla_Artifacts/RETEST_LEDGER.md` | `Mingla_Artifacts/AGENT_HANDOFFS.md` | no | archived | `8168cf16` | archive_index | Full copies of deprecated queue files; top-level files are breadcrumbs. |
| ART-OUTPUT-B2-PREFLIGHT | `Mingla_Artifacts/archive/outputs_legacy/B2_PATH_C_PRE_FLIGHT_INVESTIGATION.md` | report | business | historical_evidence | `ARCHIVE_ONLY` | None | None | no | archived | `8168cf16` | archive_index | B2 Path C historical stack. |
| ART-OUTPUT-B2-RECONCILIATION | `Mingla_Artifacts/archive/outputs_legacy/B2_RECONCILIATION_REPORT.md` | report | business | historical_evidence | `ARCHIVE_ONLY` | None | None | no | archived | `8168cf16` | archive_index | B2 reconciliation history. |
| ART-OUTPUT-B2-FULL-DISPATCH | `Mingla_Artifacts/archive/outputs_legacy/FORENSICS_AND_SPEC_DISPATCH_B2_FULL.md` | report | business | historical_evidence | `ARCHIVE_ONLY` | None | None | no | archived | `8168cf16` | archive_index | Historical dispatch bundle. |
| ART-OUTPUT-B2-AUDIT | `Mingla_Artifacts/archive/outputs_legacy/FORENSICS_B2_PATH_C_AUDIT.md` | report | business | historical_evidence | `ARCHIVE_ONLY` | None | None | no | archived | `8168cf16` | archive_index | Historical forensics audit. |
| ART-OUTPUT-B2A-HANDOFF | `Mingla_Artifacts/archive/outputs_legacy/HANDOFF_B2a_PATH_C_V3_POST_PHASE_0PP.md` | handoff | business | historical_evidence | `ARCHIVE_ONLY` | None | None | no | archived | `8168cf16` | archive_index | Historical B2a handoff. |
| ART-OUTPUT-B2-IMPL-DISPATCH | `Mingla_Artifacts/archive/outputs_legacy/IMPL_DISPATCH_B2_PATH_C.md` | prompt | business | historical_evidence | `SUPERSEDED_KEEP` | None | `Mingla_Artifacts/archive/outputs_legacy/IMPL_DISPATCH_B2_PATH_C_V3.md` | no | archived | `8168cf16` | archive_index | Earlier implementation dispatch superseded by V3. |
| ART-OUTPUT-B2-IMPL-DISPATCH-V3 | `Mingla_Artifacts/archive/outputs_legacy/IMPL_DISPATCH_B2_PATH_C_V3.md` | prompt | business | historical_evidence | `ARCHIVE_ONLY` | `Mingla_Artifacts/archive/outputs_legacy/IMPL_DISPATCH_B2_PATH_C.md` | None | no | archived | `8168cf16` | archive_index | Historical V3 implementation dispatch. |
| ART-OUTPUT-B2-SPEC-V1 | `Mingla_Artifacts/archive/outputs_legacy/SPEC_B2_PATH_C_AMENDMENT.md` | spec | business | historical_evidence | `SUPERSEDED_KEEP` | None | `Mingla_Artifacts/archive/outputs_legacy/SPEC_B2_PATH_C_V3.md` | no | archived | `8168cf16` | archive_index | Header marks superseded by V3. |
| ART-OUTPUT-B2-SPEC-V2 | `Mingla_Artifacts/archive/outputs_legacy/SPEC_B2_PATH_C_V2.md` | spec | business | historical_evidence | `SUPERSEDED_KEEP` | `Mingla_Artifacts/archive/outputs_legacy/SPEC_B2_PATH_C_AMENDMENT.md` | `Mingla_Artifacts/archive/outputs_legacy/SPEC_B2_PATH_C_V3.md` | no | archived | `8168cf16` | archive_index | Header marks superseded by V3. |
| ART-OUTPUT-B2-SPEC-V3 | `Mingla_Artifacts/archive/outputs_legacy/SPEC_B2_PATH_C_V3.md` | spec | business | historical_evidence | `ARCHIVE_ONLY` | `Mingla_Artifacts/archive/outputs_legacy/SPEC_B2_PATH_C_AMENDMENT.md; Mingla_Artifacts/archive/outputs_legacy/SPEC_B2_PATH_C_V2.md` | None | no | archived | `8168cf16` | archive_index | Historical V3 contract; current authority must be rechecked against Mingla_Artifacts specs/reports. |
| ART-CLADE-ANDROID-GLASS | `Mingla_Artifacts/archive/handoffs_legacy/clade_transfer/ANDROID_GLASS_OPACITY_HANDOFF.md` | handoff | mobile | historical_evidence | `ARCHIVE_ONLY` | None | None | no | archived | `8168cf16` | archive_index | Transfer handoff. |
| ART-CLADE-B2A-STRIPE | `Mingla_Artifacts/archive/handoffs_legacy/clade_transfer/HANDOFF_B2A_STRIPE_CONNECT_2026_05_06.md` | handoff | business | historical_evidence | `ARCHIVE_ONLY` | None | None | no | archived | `8168cf16` | archive_index | B2a Stripe transfer handoff. |
| ART-CLADE-ORCH-0737-V6 | `Mingla_Artifacts/archive/handoffs_legacy/clade_transfer/HANDOFF_ORCH_0737_V6_PIPELINE_REDESIGN.md` | handoff | admin | historical_evidence | `ARCHIVE_ONLY` | None | None | no | archived | `8168cf16` | archive_index | ORCH-0737 v6 transfer handoff. |
| ART-CLADE-ORCH-0742 | `Mingla_Artifacts/archive/handoffs_legacy/clade_transfer/HANDOFF_ORCH_0742_PHASE_2.md` | handoff | business | historical_evidence | `ARCHIVE_ONLY` | None | None | no | archived | `8168cf16` | archive_index | ORCH-0742 transfer handoff. |
| ART-CLADE-PLACE-POOL-PRICE | `Mingla_Artifacts/archive/handoffs_legacy/clade_transfer/HANDOFF_PLACE_POOL_PRICE_FIELDS_INVESTIGATION.md` | handoff | admin | historical_evidence | `ARCHIVE_ONLY` | None | None | no | archived | `8168cf16` | archive_index | Historical place-pool price-field handoff; 7 residual missing historical links after ORCH-0750C path normalization. |
| ART-DIR-PROMPTS | `Mingla_Artifacts/prompts/` | prompt | program | private_prompt | `PRIVATE_PROMPT_NOT_VERSIONED` | None | None | no | not_applicable | `8168cf16` | do_not_link | Directory is ignored; README must not depend on prompt files as durable evidence. |
| ART-DIR-BACKUPS | `Mingla_Artifacts/backups/` | backup | archive | historical_evidence | `HISTORICAL_AUTHORITY` | None | None | no | preserve_historical | `8168cf16` | archive_index | Preserve rollback/provenance material. |
| ART-DIR-MIGRATION-ARCHIVE-0729 | `Mingla_Artifacts/migrations_archive_orch_0729_2026-05-05/` | archive | supabase | historical_evidence | `HISTORICAL_AUTHORITY` | None | None | no | preserve_historical | `8168cf16` | archive_index | Pre-squash migration history; preservation material, not junk. |
| ART-DIR-HANDOFFS | `Mingla_Artifacts/handoffs/` | handoff | program | historical_evidence | `ARCHIVE_ONLY` | None | None | no | archive_later | `8168cf16` | archive_index | Directory-level handoff root. |
| ART-DIR-DESIGN-PACKAGE | `Mingla_Artifacts/design-package/` | generated | business | historical_evidence | `ARCHIVE_ONLY` | None | None | no | archive_later | `8168cf16` | archive_index | Design package material; classify deeper in ORCH-0750C if moved. |
| ART-DIR-GITHUB | `Mingla_Artifacts/github/` | ledger | program | historical_evidence | `ARCHIVE_ONLY` | None | None | no | archive_later | `8168cf16` | archive_index | Imported GitHub planning artifacts. |
| ART-DIR-SIGNAL-LAB | `Mingla_Artifacts/signal-lab/` | report | admin | historical_evidence | `ARCHIVE_ONLY` | None | None | no | archive_later | `8168cf16` | archive_index | Signal-lab artifacts. |

## Archive Policy

Current archive root:

`Mingla_Artifacts/archive/`

Planned internal categories:

- `outputs_legacy/`
- `handoffs_legacy/`
- `superseded_specs/`
- `superseded_reports/`
- `old_trackers/`
- `migration_history/`
- `generated_or_transient/`

Rules:

1. ORCH-0750C created the first archive structure and moved/copied only the approved candidates.
2. A future move requires a manifest row before the move.
3. A future move must preserve old path, new path, reason, supersession, and replacement current authority.
4. README links to archive material only through this manifest or `Mingla_Artifacts/archive/README.md`.
5. Deletion requires `DELETE_CANDIDATE_AFTER_LINK_REWRITE`, a link audit proving safety, and orchestrator approval.

## README Surface Map

| README surface | May link directly to | Must avoid |
|---|---|---|
| `root_snapshot` | Current setup/runbook docs and live source inventory | stale hand-maintained counts |
| `artifact_map` | Current authority/ledger artifacts through this manifest | ignored/private prompts |
| `app_specific` | app README setup and local commands | global function/migration counts duplicated in each app README |
| `archive_index` | archive sections via this manifest | random direct links to old transfer files |
| `do_not_link` | None | generated, ignored, private, or transient artifacts |
| `not_yet` | None until revalidated | historical strategy or stale data claims |

## Known Broken Link Classes

Source: `Mingla_Artifacts/reports/ORCH-0750A_LINK_AUDIT.md`.

| Class | Current count | Meaning |
|---|---:|---|
| `MOVED_OR_ARCHIVED_CANDIDATE` | 600 | A same-basename target exists elsewhere or should be redirected through manifest before moves. |
| `PROMPT_PRIVATE_OR_IGNORED` | 452 | Prompt target is under ignored/private prompt storage. |
| `TRUE_MISSING_REFERENCE` | 126 | No plausible target found; needs rewrite or replacement. |
| `HISTORICAL_SOURCE_MISSING` | 13 | Historical report/spec points at missing source path. |
| `GENERATED_OR_IGNORED_TARGET` | 4 | Target is generated/ignored material and should not be durable evidence. |

## ORCH-0750B/0750C Deferrals

### ORCH-0750B - README Snapshot Rebuild

Closed PASS under DEC-125:

- root README rewritten as a snapshot of live source inventory plus artifact map;
- app-mobile README rewritten as app-local documentation;
- stale function and migration counts removed;
- snapshot command/commit metadata added;
- implementation report: `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0750B_README_SNAPSHOT_REBUILD.md`;
- tester report: `Mingla_Artifacts/reports/TEST_REPORT_ORCH-0750B_README_SNAPSHOT_REBUILD.md`;
- decision: `DEC-125`.

### ORCH-0750C - Archive And Delete Pass

Closed PASS under DEC-126:

- copied ignored `outputs/` material into `Mingla_Artifacts/archive/outputs_legacy/`;
- moved tracked `clade transfer/` handoffs into `Mingla_Artifacts/archive/handoffs_legacy/clade_transfer/`;
- archived full deprecated tracker files under `Mingla_Artifacts/archive/old_trackers/`;
- replaced top-level deprecated trackers with breadcrumbs;
- deleted three tracked generated `mingla-admin/dist` assets after reference checks;
- final tester link audit: 449 files, 2,460 links, 1,190 missing links;
- implementation report: `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0750C_ARCHIVE_DELETE_PASS.md`;
- tester report: `Mingla_Artifacts/reports/TEST_REPORT_ORCH-0750C_ARCHIVE_DELETE_PASS.md`;
- decision: `DEC-126`.

### ORCH-0750D - Documentation System Lock-In

Closed CONDITIONAL PASS under DEC-128:

- aligned Mingla Codex skills and approved Mingla Claude skills to the current documentation placement map;
- added `scripts/docs/check_artifact_placement.py`;
- added `scripts/docs/check_readme_snapshot.py`;
- added `.github/workflows/docs-artifact-regression.yml`;
- kept the link debt measured at the ORCH-0750A/0750C baseline instead of pretending it is clean;
- new invariants: `I-DOC-ARTIFACT-PLACEMENT-LOCKED` and `I-README-SNAPSHOT-NOT-MANIFEST`;
- implementation report: `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0750D_DOCUMENTATION_SYSTEM_LOCK_IN.md`;
- tester report: `Mingla_Artifacts/reports/TEST_REPORT_ORCH-0750D_DOCUMENTATION_SYSTEM_LOCK_IN.md`;
- decision: `DEC-128`;
- accepted condition: GitHub can enforce skill rules only for skill roots present/versioned in checkout because `.codex/` and `.claude/` remain ignored/private tool roots; local placement checks enforce the ignored skill roots in this workspace.
