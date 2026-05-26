# CODEX_RE_REVIEW_META-ORCH-0972_AUDIT

**ORCH:** META-ORCH-0972 [brand-kind decommission + universal feature access + data-driven hub/public tabs]  
**Reviewer:** Codex `forensic-mingla`  
**Mode:** Focused delta-only re-review of targeted supplemental  
**Date:** 2026-05-25  
**Working tree:** `~/Desktop/mingla-orchs/meta-orch-0972-[brand-kind-decommission-universal-features]/` on branch `meta-orch-0972-brand-kind-decommission-universal-features`  
**Reviewed commit:** `5545427d3` (`META-ORCH-0972 Phase 1 AUDIT: targeted supplemental addressing Codex REVIEW`)

---

## Verdict

**VERDICT: APPROVED**

The targeted supplemental resolves the prior Codex `NEEDS WORK` items. I verified the changed sections directly: the missed surfaces are now catalogued, the DROP COLUMN safety plan includes the new Stage 1 steps, the four solution-drift lines were reframed to catalogue-only language, and the Open Questions report now records all 11 operator answers as final state.

This re-review intentionally did not re-audit the unchanged 12-dimension catalogue or redo prior spot-checks that already matched source.

---

## Prior-Finding Resolution Table

| Prior item | Re-review result | Evidence |
|---|---|---|
| G1 — `trip/[id]/edit.tsx:67` missed surface | **RESOLVED** | Added to Report 1 Dimension 7 as a hard early-return gate with DELETE classification; added to Report 2 Stage 1 as step `18.a`. |
| G2 — `brandPatch.ts:38-40` missed surface | **RESOLVED** | Added to Report 1 Dimension 1 as dirty-patch kind handling with DELETE classification; added to Report 2 Stage 1 as step `18.b`. |
| G3 — Open Questions stale/contradictory | **RESOLVED** | `INVESTIGATION_META-ORCH-0972_OPEN_QUESTIONS.md` is rewritten as final answered-state record; Q1-Q11 each say `Answered 2026-05-25`, and Q4/Q9 now match the operator-decided Upcoming + JSON-subfield model. |
| G4 — `UniversalCreatorSheet.tsx:79-80` stale comment | **RESOLVED** | Added to Report 1 Dimension 7 as comment-only UPDATE-COPY; added to Report 2 Stage 1 as step `18.c`. |
| Drift 1 — `useHubTabVisibility()` hook language | **RESOLVED** | Report 1 Dimension 6 now states current static tab visibility and absence of an offering-count-aware hook, leaving design to Phase 2/3. |
| Drift 2 — named experience RPC / unified RPC proposal | **RESOLVED** | Report 1 Dimension 9 now says no public-read RPC for experiences exists and leaves exact read path to Phase 3 spec. |
| Drift 3 — explicit §A.1 drop-constraint/drop-column SQL | **RESOLVED** | Report 2 §A.1 now frames `brands_kind_check` and `brands.kind` as removable only after dependencies are cleared; exact SQL is deferred to Phase 3 spec. |
| Drift 4 — Step 24 as designed RPC plan step | **RESOLVED** | Report 2 Step 24 is now labelled a catalogue gap, not a plan step, and defers RPC name/contract/indexing to Phase 3 spec. |

---

## Supplemental Cross-Reference Check

No material new cross-reference issue blocks approval.

One minor residual wording note remains in Report 1 Dimension 9: the paragraph at line 224 still says "Phase 2 designer must decide" whether experiences appear in Upcoming, then immediately states Q4 is resolved with experiences IN and Q9 JSON sub-fields. Because the rewritten Open Questions report and the same paragraph's final sentence both carry the correct decided state, this is not a blocker for Phase 2. It can be cleaned opportunistically if another audit-polish commit happens.

---

## Recommendation

Proceed to Phase 2 designer dispatch.

Phase 2 should use:

- `INVESTIGATION_META-ORCH-0972_OPEN_QUESTIONS.md` as the canonical final answered-state record.
- `SUPPLEMENTAL_META-ORCH-0972_AUDIT_REVIEW_FIXES.md` as the delta log for the Codex review fixes.
- `INVESTIGATION_META-ORCH-0972_BRAND_KIND_GAP_AUDIT.md` and `INVESTIGATION_META-ORCH-0972_DATA_MODEL_AUDIT.md` as the updated catalogue and safety-plan inputs.

---

## Confidence

**Confidence: HIGH.**

I read the supplemental change-log, the prior Codex review, the actual changed sections in Report 1 and Report 2, and the full rewritten Open Questions report. The remaining issue is a non-blocking wording artifact, not a substantive unresolved audit defect.

End of focused re-review.
