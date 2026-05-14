# SPEC — META-ORCH-0827 PLATFORM STRUCTURE — Pass 1 (Recommendation)

> **Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_META-ORCH-0827_PLATFORM_STRUCTURE_PASS_1.md`
> **Type:** Decision-tree recommendation, NOT an implementation directive
> **Date:** 2026-05-13
> **Status:** Awaiting operator decision; the operator picks one of three branches (A, B, C) below

---

## 0. Layman Summary

The workspace-migration work that the prior orchestrator session proposed is **probably not worth doing** given what's actually been planned for the next 14 weeks. The persona expansion that triggered the platform-structure question is real, but the locked plan handles it through a single-app, single-data-model architecture that the existing monorepo supports cleanly. The workspace migration would deliver modest deduplication of constants and utilities, but its main value (sharing Stripe code across multiple business apps) doesn't apply because there's only ever going to be one business app.

This SPEC asks you to decide between three branches. The recommended one (Branch A) closes the workspace question, frees the ID, and lets the 1.2 build start.

---

## 1. The Decision

Pick one:

### Branch A (RECOMMENDED) — Defer workspace migration, proceed with 1.2

Accept the Pass 1 investigation's recommendation that workspace migration is not cost-justified under the locked 1.2 plan. Execute:

1. **Archive** the prior session's wrong-ID artifacts:
   - Move `Mingla_Artifacts/specs/SPEC_ORCH-0826_WORKSPACE_MIGRATION.md` → `Mingla_Artifacts/archive/superseded_specs/SPEC_ORCH-0826_WORKSPACE_MIGRATION_SUPERSEDED.md`
   - Move `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0826_WORKSPACE_MIGRATION.md` → `Mingla_Artifacts/archive/superseded_reports/INVESTIGATION_ORCH-0826_WORKSPACE_MIGRATION_SUPERSEDED.md`
   - Add a one-line breadcrumb to each archived file pointing to this Pass 1 report
2. **Confirm ORCH-0826 = M0 Hub Foundation** in WORLD_MAP / PRIORITY_BOARD (orchestrator task)
3. **Add a "deferred work" entry** to PRIORITY_BOARD: "Workspace migration evaluated and deferred per META-ORCH-0827 Pass 1; revisit if shared-code pain materializes during 1.2 build"
4. **Close META-ORCH-0827** as resolved after archives are made
5. **Dispatch M0** using the existing prompt at `Mingla_Artifacts/prompts/FORENSICS_ORCH-0826_M0_HUB_FOUNDATION_INVESTIGATE.md` (or, since M0 INVESTIGATE has already been produced, dispatch M0 SPEC if that hasn't been written yet — orchestrator to verify state)
6. **Acknowledge ORCH-0824-F closure status**: the Phase 2 (native checkout sheet parity) work may be partially or fully subsumed by Tr2 buyer checkout. Operator clarifies in a follow-up.

**Time to execute Branch A:** ~30 minutes of orchestrator file moves + WORLD_MAP/PRIORITY_BOARD updates + one operator confirmation.

**Outcome:** clean slate. ORCH-0826 = M0 unambiguously. 1.2 build proceeds against the current monorepo. Workspace migration parked as evaluated-and-deferred (not "TODO never done").

### Branch B — Run Pass 2 with live-fire verification before deciding

Operator wants concrete proof that the workspace-migration case is weak before deferring. Execute:

1. **Pass 2 forensics fires Phase 3 + Phase 4 from the dispatch:**
   - Run `expo export -p web` against `mingla-business/` and capture bundle composition, size, errors
   - Run `expo export -p web` against `app-mobile/` to confirm the documented react-native-maps web break
   - Run `npm ls @stripe/*` across all three apps; produce the platform availability matrix
   - Audit every candidate `@mingla/*` package extraction with bundle-size delta estimates
   - Spot-check the prior session's `INVESTIGATION_ORCH-0826_WORKSPACE_MIGRATION.md` for any finding this Pass missed
2. **Pass 2 SPEC** produces a quantitative recommendation: bundle-size delta if `@mingla/payments` extracted, dep-tree drift if `@mingla/event-taxonomy` extracted, etc.
3. **Operator picks Branch A or Branch C after seeing Pass 2 evidence.**

**Time to execute Branch B:** ~2 hours forensics + 30 min operator review of Pass 2 report.

**Outcome:** definitive answer. No reliance on Pass 1's synthesis-level claim that workspace migration adds nothing beyond Metro's file-extension resolution.

### Branch C — Proceed with workspace migration anyway

Operator believes the long-term shared-code value outweighs the short-term cost, regardless of Pass 1 findings. Execute:

1. **Rename** the prior session's artifacts: `SPEC_ORCH-0826_WORKSPACE_MIGRATION.md` → `SPEC_META-ORCH-0828_WORKSPACE_MIGRATION.md` (and same for the investigation report). Update internal cross-references.
2. **Confirm ORCH-0826 = M0** in indexes.
3. **Pass 2 forensics produces a fresh workspace-migration SPEC** (the prior session's SPEC was written under the wrong assumptions and against `app-mobile` having Stripe code, which it doesn't). Pass 2 SPEC must specifically address:
   - Whether to do workspace migration BEFORE M0 (delays 1.2 by 1.5–4 days) or AFTER 1.2 completes (defers the value but de-risks 1.2)
   - The actual `@mingla/payments` design when Stripe code lives only in mingla-business (intra-app, not cross-app — does it even need to be a workspace package, or just Metro file-extension resolution?)
   - Updated cost-benefit using the cross-app duplicate inventory from this Pass 1
4. **META-ORCH-0828 SPEC then becomes the migration implementation contract.**

**Time to execute Branch C:** ~2 hours forensics + ~4 days implementation when executed.

**Outcome:** workspace migration proceeds. 1.2 may or may not be delayed depending on when migration runs.

---

## 2. Why Branch A is Recommended

The recommendation chain, from facts to verdict:

1. **Persona expansion is locked single-app.** Per I-1.2-UNIFIED-EVENT-TYPE and I-1.2-BRAND-AS-CONTAINER, every persona lives in one mingla-business codebase with one `events` table + `brands.kind` discriminator. There is no "split per persona" outcome that workspaces enable.
2. **Stripe code is mingla-business + edge functions only.** Zero in app-mobile, zero in mingla-admin. The original ORCH-0826 SPEC's "Stripe triplicate" rationale is empirically wrong.
3. **Intra-mingla-business native/web sharing already works.** `StripeNativeProvider.native.tsx` uses Metro's `.native.tsx` resolution + `package.json` `"exports"` conditions. This pattern handles every native/web split inside the same codebase without workspaces.
4. **Cross-app duplicates are constants/utilities.** eventTaxonomy, designSystem, BrandIcons, priceTiers, stripeSupportedCountries, responsive, revenueCatService. Total: ~7 files. Drift risk is low; CI gates handle the highest-risk entry (eventTaxonomy triplicate via strict-grep).
5. **Edge functions already share via `_shared/`.** Deno can't consume pnpm workspaces. The 68 modules in `supabase/functions/_shared/` are the Deno-native equivalent of a workspace package.
6. **The 14-week 1.2 plan does not produce new shared-code needs.** Each milestone is mingla-business + supabase work. C1/C2 are consumer-side surfaces that consume via API, not shared code.
7. **Workspace migration cost is real**: 1.5–4 days of work, pnpm setup, Metro fragility, EAS iteration, Taofeek onboarding overhead. Any delay to the 14-week plan compounds.
8. **There is no benefit timeline where workspaces pay back faster than M0 → 1.2 build.** Deferring loses zero current value because zero in-flight work needs it.

If shared-code pain materializes during the 1.2 build (e.g., Tr6 discussion board genuinely needs to share rendering with consumer side, or Ve4 public venue page genuinely needs identical web + native renderers), the migration can be re-evaluated with concrete drivers rather than speculation.

---

## 3. What Branch A Does NOT Do

Important non-goals:

- Does NOT close ORCH-0824-F. That ORCH is paused per prior session; its closure status is a separate decision the operator should make after seeing the 1.2 Tr2 buyer-checkout scope.
- Does NOT amend the 1.2 working doc or project spec. Those are authoritative as written.
- Does NOT add any code changes. Branch A is artifact moves + index updates + one dispatch (M0 SPEC) only.
- Does NOT preclude future workspace migration. If shared-code pain emerges mid-1.2, META-ORCH-0828_WORKSPACE_MIGRATION can be re-opened with concrete drivers.
- Does NOT delete the prior session's workspace artifacts — they're archived (preserved as historical evidence per the archive policy).

---

## 4. Success Criteria for Branch A

| # | Criterion | Verifier |
|---|-----------|----------|
| 1 | Prior workspace SPEC + investigation moved to `Mingla_Artifacts/archive/superseded_specs/` and `superseded_reports/` with breadcrumb pointing to this Pass 1 report | `ls Mingla_Artifacts/archive/superseded_*` confirms; archived files contain a one-line "Superseded by META-ORCH-0827 Pass 1; see investigation/spec" header |
| 2 | WORLD_MAP.md and PRIORITY_BOARD.md reflect ORCH-0826 = M0 only (no workspace migration row) | Orchestrator update + spot-check |
| 3 | PRIORITY_BOARD.md "Deferred work" section contains one line: workspace migration evaluated and deferred per META-ORCH-0827 Pass 1 | Spot-check |
| 4 | META-ORCH-0827 marked closed in WORLD_MAP / OPEN_INVESTIGATIONS | Spot-check |
| 5 | M0 SPEC dispatch fires (or operator confirms M0 SPEC has already been produced and proceeds to IMPLEMENT) | Operator confirmation |
| 6 | ARTIFACT_MANIFEST.md updated to reflect the archive moves (per its own placement rules) | Orchestrator update |

---

## 5. Success Criteria for Branch B

| # | Criterion |
|---|-----------|
| 1 | Pass 2 investigation produced at `Mingla_Artifacts/reports/INVESTIGATION_META-ORCH-0827_PLATFORM_STRUCTURE_PASS_2.md` |
| 2 | Pass 2 contains live-fire `expo export -p web` output for mingla-business + app-mobile with full bundle composition |
| 3 | Pass 2 contains the cross-app dep platform matrix with cited per-cell evidence |
| 4 | Pass 2 contains a re-derived cost-benefit using empirical bundle-size and dep-tree data |
| 5 | Pass 2 SPEC presents a decision tree leading to either Branch A or Branch C |
| 6 | Operator selects A or C based on Pass 2 evidence |

---

## 6. Success Criteria for Branch C

| # | Criterion |
|---|-----------|
| 1 | Prior workspace artifacts renamed to `META-ORCH-0828_WORKSPACE_MIGRATION` (preserving content but updating IDs and internal references) |
| 2 | ORCH-0826 = M0 confirmed in WORLD_MAP / PRIORITY_BOARD |
| 3 | Pass 2 produces a fresh, accurate workspace-migration SPEC reflecting the Pass 1 findings (Stripe code reality, intra-app native/web pattern, Deno _shared/ centralization, etc.) |
| 4 | Pass 2 SPEC contains an explicit recommendation on migration timing (before M0 vs after 1.2 vs interleaved) with cost-benefit per option |
| 5 | Operator confirms timing choice before any implementation dispatches |

---

## 7. Hard Guards (Apply to All Branches)

1. **No code modifications in this dispatch.** Branch A is artifact moves only. Branch B is investigation only. Branch C produces a fresh SPEC but does not implement.
2. **No deletion of the prior session's artifacts.** Archive (Branch A) or rename (Branch C). Preserve for historical evidence per the archive policy.
3. **No ORCH-ID re-use.** ORCH-0826 belongs to M0. The workspace migration, if it ever proceeds, gets a new ID (proposed META-ORCH-0828).
4. **No silent assumption switching.** If during Pass 2 (Branch B or C) new evidence contradicts Pass 1's findings, the contradiction must be surfaced explicitly with file:line citations, not absorbed silently.
5. **No 1.2 milestone delays without operator approval.** Branch C's choice of "migrate before M0" requires operator-explicit acceptance of the schedule impact.

---

## 8. Open Unknowns This SPEC Does NOT Resolve

The Pass 1 investigation's Unknowns Register (§8 of the investigation) lists 10 UNKs. This SPEC resolves UNK-001 and UNK-002 if operator picks Branch A. UNK-003 (event-planner terminology), UNK-005 (Taofeek toolchain), UNK-007 (ORCH-0824-F closure), and UNK-008 (low-stakes constant deduplication) remain regardless of branch choice and should be addressed in a follow-up orchestrator session, not in this dispatch.

UNK-004 (mingla-business web bundling baseline), UNK-009 (live-fire necessity), and UNK-010 (prior session investigation contradictions) resolve only via Branch B or Branch C.

---

## 9. Recommended Next Handoff (Pending Operator Branch Choice)

If Branch A:

> NEXT HANDOFF — paste into Claude `mingla-orchestrator` (canonical CLOSE owner for META-ORCH-0827):
>
> Execute Branch A of `Mingla_Artifacts/specs/SPEC_META-ORCH-0827_PLATFORM_STRUCTURE_PASS_1.md`. Move the prior session's `SPEC_ORCH-0826_WORKSPACE_MIGRATION.md` and `INVESTIGATION_ORCH-0826_WORKSPACE_MIGRATION.md` to the appropriate `Mingla_Artifacts/archive/superseded_*/` directories with one-line breadcrumb headers pointing to the Pass 1 investigation report. Update WORLD_MAP.md, PRIORITY_BOARD.md, and ARTIFACT_MANIFEST.md to reflect ORCH-0826 = M0 Hub Foundation only and to add a "Deferred work" entry naming workspace migration as evaluated-and-deferred per META-ORCH-0827 Pass 1. Mark META-ORCH-0827 as closed in WORLD_MAP and OPEN_INVESTIGATIONS. Confirm M0 INVESTIGATE state (the investigation exists at `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0826_M0_HUB_FOUNDATION.md`; verify whether M0 SPEC has been produced, and if not, dispatch it via Claude `mingla-forensics` SPEC mode against that investigation). Working tree: `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`. No code changes in this dispatch; artifact moves and index updates only.

If Branch B:

> NEXT HANDOFF — paste into Claude `mingla-forensics` (META-ORCH-0827 Pass 2):
>
> Continue META-ORCH-0827 with Pass 2 per `Mingla_Artifacts/specs/SPEC_META-ORCH-0827_PLATFORM_STRUCTURE_PASS_1.md` Branch B. Execute Phase 3 (live-fire bundling baselines for mingla-business + app-mobile + mingla-admin) and Phase 4 (platform-conditional dep audit) from the original dispatch at `Mingla_Artifacts/prompts/FORENSICS_META-ORCH-0827_PLATFORM_STRUCTURE.md`. Capture all `expo export -p web` output to `Mingla_Artifacts/evidence/META-ORCH-0827/` and produce `Mingla_Artifacts/reports/INVESTIGATION_META-ORCH-0827_PLATFORM_STRUCTURE_PASS_2.md` and `Mingla_Artifacts/specs/SPEC_META-ORCH-0827_PLATFORM_STRUCTURE_PASS_2.md`. Also spot-check the prior session's `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0826_WORKSPACE_MIGRATION.md` for any finding Pass 1 may have missed and document any contradictions explicitly. Pass 2 SPEC must lead to a decision between Branch A (defer) and Branch C (proceed with workspace migration as META-ORCH-0828). Working tree: `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`.

If Branch C:

> NEXT HANDOFF — paste into Claude `mingla-orchestrator` (rename + new dispatch):
>
> Execute Branch C of `Mingla_Artifacts/specs/SPEC_META-ORCH-0827_PLATFORM_STRUCTURE_PASS_1.md`. Rename `Mingla_Artifacts/specs/SPEC_ORCH-0826_WORKSPACE_MIGRATION.md` to `Mingla_Artifacts/specs/SPEC_META-ORCH-0828_WORKSPACE_MIGRATION.md` and `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0826_WORKSPACE_MIGRATION.md` to `Mingla_Artifacts/reports/INVESTIGATION_META-ORCH-0828_WORKSPACE_MIGRATION.md`, updating internal cross-references. Confirm ORCH-0826 = M0 in WORLD_MAP / PRIORITY_BOARD. Then dispatch Claude `mingla-forensics` (SPEC mode) to produce a fresh `SPEC_META-ORCH-0828_WORKSPACE_MIGRATION_V2.md` that reflects the Pass 1 investigation findings (Stripe is mingla-business + edge-functions only, intra-app native/web split is solved by Metro, Deno cannot consume workspaces) and contains an explicit timing recommendation (before M0 vs after 1.2 vs interleaved) with cost-benefit per option. Working tree: `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`. No implementation until operator confirms timing choice.

End of Pass 1 SPEC.
