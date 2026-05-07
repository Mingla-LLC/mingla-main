# ORCH-0750A Link Audit

> Date: 2026-05-07  
> Commit: `8168cf16`  
> Command: `python3 scripts/docs/check_links.py`  
> Script: `scripts/docs/check_links.py`  
> Scope: README/app READMEs, `docs/`, `Mingla_Artifacts/`, `outputs/`, `clade transfer/`, and selected tooling READMEs.  
> Status: current ORCH-0750A baseline. Missing links remain intentionally unhidden.

## Summary

| Metric | Count |
|---|---:|
| Files checked | 411 |
| Total links | 2,363 |
| Missing links | 1,195 |

## Counts By Classification

| Classification | Count | Meaning |
|---|---:|---|
| `MOVED_OR_ARCHIVED_CANDIDATE` | 600 | The target basename exists elsewhere or likely needs manifest/readonly archive redirection before any move. |
| `PROMPT_PRIVATE_OR_IGNORED` | 452 | The target is under `prompts/` or `Mingla_Artifacts/prompts/`, which is ignored/private in this repo state. |
| `TRUE_MISSING_REFERENCE` | 126 | No plausible target found. These need later rewrite, replacement, or removal. |
| `HISTORICAL_SOURCE_MISSING` | 13 | Historical report/spec/handoff points at a source path absent from this tree. |
| `GENERATED_OR_IGNORED_TARGET` | 4 | Target is generated or ignored material and should not be treated as durable documentation evidence. |

## Top 25 Source Files

| Missing | Source |
|---:|---|
| 225 | `Mingla_Artifacts/AGENT_HANDOFFS.md` |
| 199 | `Mingla_Artifacts/MASTER_BUG_LIST.md` |
| 172 | `Mingla_Artifacts/WORLD_MAP.md` |
| 80 | `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0670_RENDERED_SURFACE_AUDIT.md` |
| 57 | `Mingla_Artifacts/OPEN_INVESTIGATIONS.md` |
| 37 | `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0700_MOVIES_CHIP_LEAK.md` |
| 35 | `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0702_PLACE_INTELLIGENCE_AUDIT.md` |
| 28 | `Mingla_Artifacts/PRIORITY_BOARD.md` |
| 18 | `Mingla_Artifacts/INVARIANT_REGISTRY.md` |
| 15 | `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0721_MIGRATION_PIPELINE_TIME_BOMB.md` |
| 13 | `Mingla_Artifacts/specs/SPEC_ORCH-0670_SLICE_A_USER_VISIBLE_BREAKAGE.md` |
| 12 | `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-BIZ-CYCLE-0a-001.md` |
| 12 | `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0708_SCORING_SYSTEM_AUDIT.md` |
| 12 | `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0713_PIPELINE_AUDIT.md` |
| 12 | `clade transfer/HANDOFF_PLACE_POOL_PRICE_FIELDS_INVESTIGATION.md` |
| 11 | `Mingla_Artifacts/reports/SPEC_ORCH-0708_PHOTO_AESTHETIC_SCORING_INTEGRATION.md` |
| 9 | `Mingla_Artifacts/reports/INVESTIGATION_B2A_PATH_C_V3_E2E_PIPELINE.md` |
| 7 | `Mingla_Artifacts/reports/TEST_BIZ_CYCLE_11_QR_SCANNER_REPORT.md` |
| 5 | `Mingla_Artifacts/reports/INVESTIGATION_BIZ_CYCLE_12_DOOR_SALES.md` |
| 5 | `Mingla_Artifacts/reports/INVESTIGATION_ORCH-BIZ-CYCLE-2-J-A9.md` |
| 4 | `Mingla_Artifacts/ROOT_CAUSE_REGISTER.md` |
| 4 | `Mingla_Artifacts/reports/IMPLEMENTATION_BIZ_CYCLE_2_J_A10_PAYMENTS_SHELL.md` |
| 4 | `Mingla_Artifacts/reports/IMPLEMENTATION_BIZ_CYCLE_8b_PAYMENT_3DS_CONFIRM.md` |
| 4 | `Mingla_Artifacts/reports/IMPLEMENTATION_BIZ_CYCLE_9b1_LIFECYCLE_ACTIONS_PARTIAL.md` |
| 4 | `Mingla_Artifacts/reports/IMPLEMENTATION_BIZ_CYCLE_9b2_EDIT_AFTER_PUBLISH.md` |

## Top 25 Missing Targets

| Missing | Target |
|---:|---|
| 7 | `Mingla_Artifacts/specs/SPEC_ORCH-0685_EXPANDED_CARD_MODAL.md` |
| 7 | `Mingla_Artifacts/specs/SPEC_ORCH-0684_PAIRED_VIEW_REWIRE.md` |
| 6 | `Mingla_Artifacts/prompts/SPEC_ORCH-0700_DISPATCH.md` |
| 6 | `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0685_cycle2_SAVE_DEAD_TAP.md` |
| 6 | `Mingla_Artifacts/prompts/FORENSICS_ORCH-0685_cycle2_SAVE_DEAD_TAP.md` |
| 6 | `Mingla_Artifacts/prompts/SPEC_ORCH-0688_COACH_MARK_ANDROID_OFFSET.md` |
| 6 | `app-mobile/src/hooks/useCoachMark.ts#L32` |
| 5 | `Mingla_Artifacts/reports/INVESTIGATION_ORCH-BIZ-CYCLE-6-FX3_WEB_PARITY_AUDIT.md` |
| 5 | `app-mobile/src/components/GlassBottomNav.tsx#L60` |
| 5 | `Mingla_Artifacts/prompts/IMPL_ORCH-0688_COACH_MARK_ANDROID_OFFSET.md` |
| 5 | `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0685_v2_EXPANDED_CARD_MODAL.md` |
| 5 | `Mingla_Artifacts/prompts/FORENSICS_ORCH-0688_COACH_MARK_ANDROID_OFFSET.md` |
| 5 | `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0684_PAIRED_VIEW_CARDS_NOT_REAL.md` |
| 5 | `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0686_PHOTO_BACKFILL_CREATE_RUN_500.md` |
| 5 | `Mingla_Artifacts/prompts/SPEC_ORCH-0686_PHOTO_BACKFILL_MODE_CONSTRAINT.md` |
| 5 | `supabase/functions/generate-curated-experiences/index.ts#L815` |
| 5 | `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0678_LAGOS_BOUNCER_MASS_REJECT.md` |
| 5 | `../prompts/IMPLEMENTOR_BIZ_CYCLE_12_DOOR_SALES.md` |
| 5 | `supabase/migrations/20260424220003_orch_0634_query_servable_places_by_signal_photo_gate.sql` |
| 4 | `prompts/FORENSICS_BIZ_CYCLE_13_PERMISSIONS_UI.md` |
| 4 | `Mingla_Artifacts/prompts/FORENSICS_ORCH-0700_AI_CATEGORIES_DECOMMISSION_AUDIT.md` |
| 4 | `Mingla_Artifacts/specs/SPEC_ORCH-BIZ-CYCLE-7.md` |
| 4 | `Mingla_Artifacts/reports/INVESTIGATION_ORCH-BIZ-CYCLE-7.md` |
| 4 | `Mingla_Artifacts/reports/IMPLEMENTATION_BIZ_CYCLE_6_FX1_HEAD_WEB_ONLY.md` |
| 4 | `Mingla_Artifacts/reports/IMPLEMENTATION_BIZ_CYCLE_6_FX2_PUBLIC_PAGE_CLOSE_CHROME.md` |

## Top 50 Representative Examples

| # | Source | Line | Target | Classification |
|---:|---|---:|---|---|
| 1 | `Mingla_Artifacts/AGENT_HANDOFFS.md` | 11 | `prompts/FORENSICS_CYCLE_B2_STRIPE_CONNECT_STUB.md` | `PROMPT_PRIVATE_OR_IGNORED` |
| 2 | `Mingla_Artifacts/AGENT_HANDOFFS.md` | 11 | `prompts/FORENSICS_CYCLE_B2_STRIPE_CONNECT_STUB.md` | `PROMPT_PRIVATE_OR_IGNORED` |
| 3 | `Mingla_Artifacts/AGENT_HANDOFFS.md` | 17 | `prompts/IMPL_BIZ_CYCLE_17D_STAGE2_LOC_DECOMPOSE.md` | `PROMPT_PRIVATE_OR_IGNORED` |
| 4 | `Mingla_Artifacts/AGENT_HANDOFFS.md` | 17 | `prompts/QA_BIZ_CYCLE_17D_STAGE2_LOC_DECOMPOSE.md` | `PROMPT_PRIVATE_OR_IGNORED` |
| 5 | `Mingla_Artifacts/AGENT_HANDOFFS.md` | 19 | `prompts/FORENSICS_BIZ_CYCLE_17D_PERF_PASS.md` | `PROMPT_PRIVATE_OR_IGNORED` |
| 6 | `Mingla_Artifacts/AGENT_HANDOFFS.md` | 19 | `prompts/SPEC_BIZ_CYCLE_17D_PERF_PASS.md` | `PROMPT_PRIVATE_OR_IGNORED` |
| 7 | `Mingla_Artifacts/AGENT_HANDOFFS.md` | 19 | `prompts/IMPL_BIZ_CYCLE_17D_PERF_PASS.md` | `PROMPT_PRIVATE_OR_IGNORED` |
| 8 | `Mingla_Artifacts/AGENT_HANDOFFS.md` | 19 | `prompts/TEST_BIZ_CYCLE_17D_PERF_PASS.md` | `PROMPT_PRIVATE_OR_IGNORED` |
| 9 | `Mingla_Artifacts/AGENT_HANDOFFS.md` | 21 | `prompts/FORENSICS_BIZ_CYCLE_17C_WCAG_AUDIT.md` | `PROMPT_PRIVATE_OR_IGNORED` |
| 10 | `Mingla_Artifacts/AGENT_HANDOFFS.md` | 21 | `prompts/SPEC_BIZ_CYCLE_17C_WCAG_AUDIT.md` | `PROMPT_PRIVATE_OR_IGNORED` |
| 11 | `Mingla_Artifacts/AGENT_HANDOFFS.md` | 21 | `prompts/IMPL_BIZ_CYCLE_17C_WCAG_AUDIT.md` | `PROMPT_PRIVATE_OR_IGNORED` |
| 12 | `Mingla_Artifacts/AGENT_HANDOFFS.md` | 21 | `prompts/TEST_BIZ_CYCLE_17C_WCAG_AUDIT.md` | `PROMPT_PRIVATE_OR_IGNORED` |
| 13 | `Mingla_Artifacts/AGENT_HANDOFFS.md` | 23 | `prompts/FORENSICS_BIZ_CYCLE_17B_TOPBAR_IA_RESET.md` | `PROMPT_PRIVATE_OR_IGNORED` |
| 14 | `Mingla_Artifacts/AGENT_HANDOFFS.md` | 23 | `prompts/SPEC_BIZ_CYCLE_17B_TOPBAR_IA_RESET.md` | `PROMPT_PRIVATE_OR_IGNORED` |
| 15 | `Mingla_Artifacts/AGENT_HANDOFFS.md` | 23 | `prompts/IMPLEMENTATION_BIZ_CYCLE_17B_TOPBAR_IA_RESET.md` | `PROMPT_PRIVATE_OR_IGNORED` |
| 16 | `Mingla_Artifacts/AGENT_HANDOFFS.md` | 23 | `prompts/TEST_BIZ_CYCLE_17B_TOPBAR_IA_RESET.md` | `PROMPT_PRIVATE_OR_IGNORED` |
| 17 | `Mingla_Artifacts/AGENT_HANDOFFS.md` | 25 | `prompts/FORENSICS_BIZ_CYCLE_17_REFINEMENT_PASS.md` | `PROMPT_PRIVATE_OR_IGNORED` |
| 18 | `Mingla_Artifacts/AGENT_HANDOFFS.md` | 25 | `prompts/FORENSICS_BIZ_CYCLE_17A_QUICK_WINS.md` | `PROMPT_PRIVATE_OR_IGNORED` |
| 19 | `Mingla_Artifacts/AGENT_HANDOFFS.md` | 25 | `prompts/SPEC_BIZ_CYCLE_17A_QUICK_WINS.md` | `PROMPT_PRIVATE_OR_IGNORED` |
| 20 | `Mingla_Artifacts/AGENT_HANDOFFS.md` | 25 | `prompts/IMPLEMENTATION_BIZ_CYCLE_17A_QUICK_WINS.md` | `PROMPT_PRIVATE_OR_IGNORED` |
| 21 | `Mingla_Artifacts/AGENT_HANDOFFS.md` | 25 | `prompts/TEST_BIZ_CYCLE_17A_QUICK_WINS.md` | `PROMPT_PRIVATE_OR_IGNORED` |
| 22 | `Mingla_Artifacts/AGENT_HANDOFFS.md` | 27 | `prompts/FORENSICS_BIZ_CYCLE_16_CROSS_CUTTING_POLISH.md` | `PROMPT_PRIVATE_OR_IGNORED` |
| 23 | `Mingla_Artifacts/AGENT_HANDOFFS.md` | 27 | `prompts/SPEC_BIZ_CYCLE_16A_QUICK_WINS.md` | `PROMPT_PRIVATE_OR_IGNORED` |
| 24 | `Mingla_Artifacts/AGENT_HANDOFFS.md` | 27 | `prompts/IMPLEMENTOR_BIZ_CYCLE_16A_QUICK_WINS.md` | `PROMPT_PRIVATE_OR_IGNORED` |
| 25 | `Mingla_Artifacts/AGENT_HANDOFFS.md` | 29 | `prompts/FORENSICS_BIZ_CYCLE_15_ORGANISER_LOGIN.md` | `PROMPT_PRIVATE_OR_IGNORED` |
| 26 | `Mingla_Artifacts/AGENT_HANDOFFS.md` | 29 | `prompts/IMPLEMENTOR_BIZ_CYCLE_15_ORGANISER_LOGIN.md` | `PROMPT_PRIVATE_OR_IGNORED` |
| 27 | `Mingla_Artifacts/AGENT_HANDOFFS.md` | 29 | `prompts/IMPLEMENTOR_BIZ_CYCLE_15_GUESTCSVEXPORT_HOTFIX.md` | `PROMPT_PRIVATE_OR_IGNORED` |
| 28 | `Mingla_Artifacts/AGENT_HANDOFFS.md` | 29 | `prompts/IMPLEMENTOR_BIZ_CYCLE_15_REWORK_v2.md` | `PROMPT_PRIVATE_OR_IGNORED` |
| 29 | `Mingla_Artifacts/AGENT_HANDOFFS.md` | 31 | `prompts/FORENSICS_BIZ_CYCLE_14_ACCOUNT.md` | `PROMPT_PRIVATE_OR_IGNORED` |
| 30 | `Mingla_Artifacts/AGENT_HANDOFFS.md` | 31 | `prompts/SPEC_BIZ_CYCLE_14_ACCOUNT.md` | `PROMPT_PRIVATE_OR_IGNORED` |
| 31 | `Mingla_Artifacts/AGENT_HANDOFFS.md` | 31 | `prompts/IMPLEMENTOR_BIZ_CYCLE_14_ACCOUNT.md` | `PROMPT_PRIVATE_OR_IGNORED` |
| 32 | `Mingla_Artifacts/AGENT_HANDOFFS.md` | 31 | `prompts/IMPLEMENTOR_BIZ_CYCLE_14_MIGRATION_FIX.md` | `PROMPT_PRIVATE_OR_IGNORED` |
| 33 | `Mingla_Artifacts/AGENT_HANDOFFS.md` | 31 | `prompts/IMPLEMENTOR_BIZ_CYCLE_14_DELETE_FLOW_REWORK.md` | `PROMPT_PRIVATE_OR_IGNORED` |
| 34 | `Mingla_Artifacts/AGENT_HANDOFFS.md` | 33 | `prompts/FORENSICS_BIZ_CYCLE_13_END_OF_NIGHT_RECONCILIATION.md` | `PROMPT_PRIVATE_OR_IGNORED` |
| 35 | `Mingla_Artifacts/AGENT_HANDOFFS.md` | 33 | `prompts/SPEC_BIZ_CYCLE_13_END_OF_NIGHT_RECONCILIATION.md` | `PROMPT_PRIVATE_OR_IGNORED` |
| 36 | `Mingla_Artifacts/AGENT_HANDOFFS.md` | 33 | `prompts/IMPLEMENTOR_BIZ_CYCLE_13_END_OF_NIGHT_RECONCILIATION.md` | `PROMPT_PRIVATE_OR_IGNORED` |
| 37 | `Mingla_Artifacts/AGENT_HANDOFFS.md` | 33 | `prompts/IMPLEMENTOR_BIZ_CYCLE_13_REWORK_v2_HONEST_EXPORT_TOAST.md` | `PROMPT_PRIVATE_OR_IGNORED` |
| 38 | `Mingla_Artifacts/AGENT_HANDOFFS.md` | 35 | `prompts/FORENSICS_BIZ_CYCLE_13B_PERMISSIONS_DEPTH.md` | `PROMPT_PRIVATE_OR_IGNORED` |
| 39 | `Mingla_Artifacts/AGENT_HANDOFFS.md` | 35 | `prompts/SPEC_BIZ_CYCLE_13B_PERMISSIONS_DEPTH.md` | `PROMPT_PRIVATE_OR_IGNORED` |
| 40 | `Mingla_Artifacts/AGENT_HANDOFFS.md` | 35 | `prompts/IMPLEMENTOR_BIZ_CYCLE_13B_PERMISSIONS_DEPTH.md` | `PROMPT_PRIVATE_OR_IGNORED` |
| 41 | `Mingla_Artifacts/AGENT_HANDOFFS.md` | 37 | `prompts/FORENSICS_BIZ_CYCLE_13_PERMISSIONS_UI.md` | `PROMPT_PRIVATE_OR_IGNORED` |
| 42 | `Mingla_Artifacts/AGENT_HANDOFFS.md` | 37 | `prompts/SPEC_BIZ_CYCLE_13A_PERMISSIONS_FOUNDATIONS.md` | `PROMPT_PRIVATE_OR_IGNORED` |
| 43 | `Mingla_Artifacts/AGENT_HANDOFFS.md` | 37 | `prompts/IMPLEMENTOR_BIZ_CYCLE_13A_PERMISSIONS_FOUNDATIONS.md` | `PROMPT_PRIVATE_OR_IGNORED` |
| 44 | `Mingla_Artifacts/AGENT_HANDOFFS.md` | 39 | `prompts/FORENSICS_BIZ_CYCLE_12_DOOR_SALES.md` | `PROMPT_PRIVATE_OR_IGNORED` |
| 45 | `Mingla_Artifacts/AGENT_HANDOFFS.md` | 39 | `prompts/IMPLEMENTOR_BIZ_CYCLE_12_DOOR_SALES.md` | `PROMPT_PRIVATE_OR_IGNORED` |
| 46 | `Mingla_Artifacts/AGENT_HANDOFFS.md` | 39 | `prompts/TESTER_BIZ_CYCLE_12_DOOR_SALES.md` | `PROMPT_PRIVATE_OR_IGNORED` |
| 47 | `Mingla_Artifacts/AGENT_HANDOFFS.md` | 39 | `prompts/IMPLEMENTOR_BIZ_CYCLE_12_REWORK_EDITPUBLISHED.md` | `PROMPT_PRIVATE_OR_IGNORED` |
| 48 | `Mingla_Artifacts/AGENT_HANDOFFS.md` | 39 | `prompts/IMPLEMENTOR_BIZ_CYCLE_12_REWORK_BUNDLE_3FIX.md` | `PROMPT_PRIVATE_OR_IGNORED` |
| 49 | `Mingla_Artifacts/AGENT_HANDOFFS.md` | 43 | `Mingla_Artifacts/reports/INVESTIGATION_BIZ_CYCLE_11_QR_SCANNER.md` | `MOVED_OR_ARCHIVED_CANDIDATE` |
| 50 | `Mingla_Artifacts/AGENT_HANDOFFS.md` | 43 | `Mingla_Artifacts/specs/SPEC_BIZ_CYCLE_11_QR_SCANNER.md` | `MOVED_OR_ARCHIVED_CANDIDATE` |

## Safe To Fix In ORCH-0750A

None by direct link rewrite. ORCH-0750A establishes the checker and manifest only. The safe work in this phase is classification, not repair.

## Must Wait For ORCH-0750B README Rebuild

- Root/app README stale counts and ecosystem map.
- `docs/TRANSITIONAL_ITEMS_REGISTRY.md` references to missing tracker material if README becomes the new front door.
- Any README-facing artifact map links.

## Must Wait For ORCH-0750C Archive Move

- `outputs/` legacy B2 material.
- `clade transfer/` handoffs.
- Deprecated queue files if they are moved out of top-level artifact space.
- Old `PRODUCT_SNAPSHOT.md` operational alert blocks and old `PRIORITY_BOARD.md` Top 20 blocks.

## Prompt / Private Exceptions

The audit classified 452 missing links as `PROMPT_PRIVATE_OR_IGNORED`. These should not be treated as durable public evidence until one of these happens:

1. the prompt is versioned;
2. the link is replaced by a report/spec/implementation/test artifact;
3. the manifest marks it as `PRIVATE_PROMPT_NOT_VERSIONED`.

## Current Verdict

The link system is **not green**, but it is now measurable. ORCH-0750A passes if this report, the checker, and the manifest are accepted; zero missing links is deferred.
