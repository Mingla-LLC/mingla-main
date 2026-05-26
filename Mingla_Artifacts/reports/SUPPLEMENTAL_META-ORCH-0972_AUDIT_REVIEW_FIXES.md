# SUPPLEMENTAL_META-ORCH-0972_AUDIT_REVIEW_FIXES

**ORCH:** META-ORCH-0972 [brand-kind decommission + universal feature access + data-driven hub/public tabs]
**Phase:** 1 of 4 — AUDIT (targeted supplemental in response to Codex independent REVIEW)
**Mode:** INVESTIGATE (read-only audit updates only — no implementation, no new solution design)
**Author:** Claude `mingla-forensics`
**Date:** 2026-05-25
**Trigger:** [CODEX_INDEPENDENT_REVIEW_META-ORCH-0972_AUDIT.md](./CODEX_INDEPENDENT_REVIEW_META-ORCH-0972_AUDIT.md) returned `NEEDS WORK` with 4 specific gaps (G1–G4) + 4 solution-drift line flags. Operator dispatched this targeted supplemental to address the deltas before Phase 2 designer dispatch.

This report is the change-log for what was modified across the existing audit artifacts. No new catalogue findings beyond what Codex flagged. After this supplemental commits, Codex re-reviews only the changed sections.

---

## Comms-ledger acknowledgements

No new ledger entries needed. Prior 5 WARN entries (COMMS-0001 through COMMS-0005) were already factored at the original audit; no new cross-ORCH discovery during this supplemental work.

---

## Codex REVIEW gaps addressed

### G1 — Missed `trip/[id]/edit.tsx:67` brand-kind early-return

**Verified independently (read the file).** The exact code at [mingla-business/app/trip/[id]/edit.tsx:67](mingla-business/app/trip/%5Bid%5D/edit.tsx#L67):

```tsx
if (currentBrand.kind !== "trip_planner") return;
```

…inside a `useEffect` that migrates client-only trip IDs (e.g., `draft-xyz`) to server drafts via `createTripDraftMutation`. Today: non-trip-planner brands silently skip the migration. Under META-ORCH-0972 model: universal trip authoring means the migration must run for any brand.

**Action:** Added a new catalogue row to Report 1 Dimension 7 [Offering creation flows] with classification `DELETE` (early-return gate; universal authoring removes the predicate entirely). Added a corresponding step `18.a` to the Report 2 DROP COLUMN safety plan Stage 1 sequence.

### G2 — Missed `brandPatch.ts:38-40` dirty-field kind block

**Verified independently.** The exact code at [mingla-business/src/utils/brandPatch.ts:38-40](mingla-business/src/utils/brandPatch.ts#L38-L40):

```ts
if (draft.kind !== original.kind) {
  patch.kind = draft.kind;
}
```

…inside `computeBrandPatch(draft, original)` which builds a `Partial<Brand>` of dirty fields for the update mutation. Today: when the BrandEditView kind picker (D2) sets a new kind, this block ensures `patch.kind` is included in the update payload.

**Action:** Added a new catalogue row to Report 1 Dimension 1 [Brand creation flow] (the patch helper sits alongside `brandMapping.ts` in the create+edit cluster) with classification `DELETE` (entire 3-line block goes; no kind field to dirty-patch once `brands.kind` and the BrandEditView SECTION B-2 kind picker are removed). Added step `18.b` to the safety plan.

### G3 — Stale OPEN_QUESTIONS report contradicting later operator-decided state

**Verified.** The pre-supplemental [INVESTIGATION_META-ORCH-0972_OPEN_QUESTIONS.md](./INVESTIGATION_META-ORCH-0972_OPEN_QUESTIONS.md) was written before operator answered the questions. Q4 (experiences in Upcoming) was marked `Open` with recommended default = "Out — Experiences tab only, not Upcoming." The operator subsequently chose `IN — with new occurrence-date field`. Q9 (experience schema) was marked `Open` with recommended default = "JSON sub-fields (Path B)"; operator's answer matched. Q1, Q2, Q3, Q6, Q7, Q8, Q10 also had stale Open states. Q5 and Q11 were marked answered.

**Action:** Rewrote the entire OPEN_QUESTIONS report as a final answered-state record. Every Q now has a definitive "Answered 2026-05-25" line with the operator's exact choice, removing the recommended-default-as-pending language. The reconciliation note at the top of the rewrite cites the git-history of the original draft (commit `b493df198`) for anyone who wants to recover the original recommendation rationale.

### G4 — Stale `UniversalCreatorSheet.tsx:79-80` comment referencing the deleted gate

**Verified independently.** Lines 79–80 of [mingla-business/src/components/ui/UniversalCreatorSheet.tsx](mingla-business/src/components/ui/UniversalCreatorSheet.tsx#L79-L80) contain a comment in the trip-persona definition:

```tsx
// ORCH-0859 (Tr2): wired from /trip/coming-soon stub to real wizard.
// /trip/create gates on currentBrand.kind === "trip_planner" — non-trip-planner
// brands see an explainer (Tr2 §8 hard guard).
```

This is comment-only — no runtime behavior — but becomes stale once `trip/create.tsx:52` gate is deleted (D7 catalogue).

**Action:** Added a new catalogue row to Report 1 Dimension 7 with classification `UPDATE-COPY`. Added step `18.c` to the safety plan.

---

## Solution-drift reframes (4 lines, all reworded to catalogue-only language)

### Drift 1 — Report 1 line 156 (Dimension 6 trailing paragraph)

**Before:** "Hub tabs become data-driven — show only tabs whose bucket (events/trips/experiences) has content. Need new `useHubTabVisibility()` hook reading offering counts. Default-tab-when-multiple rule still open (Q3)."

**After:** "Current state (catalogue note): Hub tab visibility is static — `_layout.tsx` mounts the 3-tab shell regardless of offering counts. No offering-count-aware visibility hook exists today. The operator-locked new model (data-driven visibility, tabs hidden when their bucket is empty) is a Phase 2/3 design problem, not a catalogue claim. Default-tab-when-multiple rule resolved post-audit (Q3 answered: sticky last-visited, Events on first ever visit)."

**Rationale:** "Need new hook X" is design talk; audit should only document the current absence of such a hook.

### Drift 2 — Report 1 Dimension 9 post-rebase RPC entry

**Before:** "RPC PRESERVED but rewritten: REMOVE the `WHERE b.kind = 'trip_planner'` brand-kind guard so it returns trip rows for ANY brand that has trips. New parallel RPC `pg_public_experiences_by_brand` (or unified `pg_public_brand_upcoming`) needed for Upcoming tab."

**After:** "REPURPOSE (drop the single-line brand-kind guard so trip rows return for any brand). Note: there is NO public-read RPC for experiences today; the absence is a Phase 3 spec-scope finding, not a Phase 1 design proposal."

**Rationale:** naming a hypothetical RPC by exact identifier is Phase 3 spec design. The audit only catalogues the absence.

### Drift 3 — Report 2 §A.1 Disposition block

**Before:** Phase 4 Sub-C migration 1 + migration 2 with inline `ALTER TABLE ... DROP CONSTRAINT` + `DROP COLUMN` SQL.

**After:** "Disposition (current-state catalogue): the `brands_kind_check` constraint and the `brands.kind` column are both removable once every code surface that reads `kind` is dropped or regated (Stage-1 surfaces enumerated below in the safety plan). Phase 3 spec defines the exact migration sequence and SQL; Phase 1 audit catalogues the dependency chain only. The default value (`'popup'`) is not a blocker — no rows require backfill because the column itself is removed, not transformed."

**Rationale:** explicit migration SQL belongs in the SPEC artifact, not the AUDIT artifact. The disposition note preserves the dependency-chain meaning without prescribing exact DDL.

### Drift 4 — Report 2 DROP COLUMN safety plan step 24

**Before:** "Phase 4 Sub-C migration — Create new RPC `pg_public_experiences_by_brand(p_brand_slug)` if experiences are to appear on public page (pending Q4)"

**After:** "(catalogue gap, not a plan step) — No public-read RPC for experiences exists today. Operator answered Q4 = experiences IN Upcoming and Q9 = JSON sub-fields in `theme.experience_meta`; Phase 3 spec defines the exact new read path (RPC name, contract, JSON-field indexing strategy). Phase 1 audit only documents the current absence."

**Rationale:** plan step format implies a designed step; reframed as a catalogue gap deferred to Phase 3.

---

## Catalogue completeness check (Codex flagged this FAIL)

Re-ran targeted greps after adding the 3 missed surfaces:

| Grep target | Result | Status |
|---|---|---|
| `grep -rn "brand\.kind\|brands\.kind\|currentBrand\.kind" mingla-business/ supabase/functions/ mingla-admin/` | All hits now accounted for in catalogue (including newly-added rows for `trip/[id]/edit.tsx:67`, `brandPatch.ts:38-40`, `UniversalCreatorSheet.tsx:79-80`) | RECONCILED |
| `grep -rn "brand\.kind\|brands\.kind\|currentBrand\.kind" app-mobile/` | Zero hits (consumer app brand-kind-agnostic — confirmed by Dimension 12 + spot-verified by Codex spot-checks 11+12) | NO CHANGE |
| `grep -rn "brand\.kind\|brands\.kind\|currentBrand\.kind" packages/` | Zero hits (shared packages don't read brand.kind) | NO CHANGE |

No further missed surfaces. Catalogue is now complete to the best of independent-grep-able knowledge.

---

## Files modified by this supplemental

1. [`INVESTIGATION_META-ORCH-0972_BRAND_KIND_GAP_AUDIT.md`](./INVESTIGATION_META-ORCH-0972_BRAND_KIND_GAP_AUDIT.md) — Dimension 1 (+1 row brandPatch.ts), Dimension 6 (paragraph reframed), Dimension 7 (+2 rows: trip/[id]/edit.tsx, UniversalCreatorSheet), Dimension 9 post-rebase RPC entry (REPURPOSE language reframed).
2. [`INVESTIGATION_META-ORCH-0972_DATA_MODEL_AUDIT.md`](./INVESTIGATION_META-ORCH-0972_DATA_MODEL_AUDIT.md) — §A.1 Disposition block reframed, Stage 1 safety plan +3 steps (18.a, 18.b, 18.c), Stage 2 step 24 reframed as catalogue gap.
3. [`INVESTIGATION_META-ORCH-0972_OPEN_QUESTIONS.md`](./INVESTIGATION_META-ORCH-0972_OPEN_QUESTIONS.md) — rewritten end-to-end as final answered-state record for all 11 questions.
4. This supplemental change-log: new file.

No other report files modified. [USER_JOURNEY_GAPS.md](./INVESTIGATION_META-ORCH-0972_USER_JOURNEY_GAPS.md) and [REVIEW_META-ORCH-0972_AUDIT.md](./REVIEW_META-ORCH-0972_AUDIT.md) were not flagged by Codex and remain unchanged.

---

## Verdict on each Codex REVIEW item

| Codex finding | Status |
|---|---|
| G1: trip/[id]/edit.tsx:67 missed surface | RESOLVED (added to D7 + safety plan 18.a) |
| G2: brandPatch.ts:38-40 missed surface | RESOLVED (added to D1 + safety plan 18.b) |
| G3: OPEN_QUESTIONS stale on Q4/Q9/Q10 | RESOLVED (full rewrite as answered-state record) |
| G4: UniversalCreatorSheet:79-80 stale copy | RESOLVED (added to D7 + safety plan 18.c) |
| Drift 1 (Report 1 line 156 — useHubTabVisibility hook) | REFRAMED to catalogue-only |
| Drift 2 (Report 1 line 215 — pg_public_experiences_by_brand) | REFRAMED to catalogue-only |
| Drift 3 (Report 2 line 29-31 — explicit migration SQL) | REFRAMED to catalogue-only |
| Drift 4 (Report 2 line 349 — RPC plan step) | REFRAMED to catalogue-only |
| Checklist FAIL: Catalogue completeness | RESOLVED (3 surfaces added; greps reconciled) |
| Checklist FAIL: No solution drift | RESOLVED (4 lines reframed) |
| Checklist FAIL: Cross-references consistent (Q4/Q9 contradiction) | RESOLVED (OPEN_QUESTIONS rewritten to match WORLD_MAP) |
| Checklist FAIL: Open questions actionable | RESOLVED (all 11 explicitly answered) |
| Checklist PASS-WITH-GAP: DROP COLUMN safety plan ordering | RESOLVED (18.a/18.b/18.c inserted before Stage 4) |
| Checklist PASS-WITH-STALE-Q-CAVEAT: 8 user journeys | UNCHANGED (caveat removed once OPEN_QUESTIONS rewritten — journey-level content is still accurate) |
| All other PASS items | UNCHANGED |

---

## Confidence

**HIGH** that the targeted supplemental addresses every Codex-flagged delta. No new catalogue findings beyond Codex's gaps. All edits stay within read-only audit-update scope per the dispatch hard constraint.

Ready for focused Codex re-review of the changed sections only.

End of supplemental.
