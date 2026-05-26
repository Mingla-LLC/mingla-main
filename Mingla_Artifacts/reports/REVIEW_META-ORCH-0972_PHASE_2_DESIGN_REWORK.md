# REVIEW_META-ORCH-0972_PHASE_2_DESIGN_REWORK

**ORCH:** META-ORCH-0972 [brand-kind decommission + universal feature access + data-driven hub/public tabs]
**Phase reviewed:** 2 of 5 — USER JOURNEY DESIGN, REWORK pass (`ui-ux-pro-max` skill output)
**Reviewer:** Claude `mingla-orchestrator`
**Date:** 2026-05-25
**Commits reviewed:** `84577657d` (prior NEEDS WORK baseline) → `8311fa89b` (REWORK)
**Prior verdict:** NEEDS WORK — criterion (d) Dimension-coverage gaps on D3 (authoring gate) + D1 (brand creation cluster under-rowed)
**This verdict:** **APPROVED**

---

## Scope of this re-review

Per operator dispatch, this pass reviews ONLY the SCREEN_INVENTORY delta between `84577657d` and `8311fa89b`. USER_JOURNEYS, COPY_INVENTORY, and HANDOFF_TO_SPEC are NOT re-opened unless the delta introduces a contradiction. They were already PASS on the prior REVIEW criteria (a)/(b)/(c)/(e).

---

## Commit-hash verification

`git diff 84577657d 8311fa89b --stat` reports one file changed:

- `Mingla_Artifacts/design/PHASE_2_DESIGN_META-ORCH-0972_SCREEN_INVENTORY.md` — 6 insertions, 0 deletions, 0 modifications

`git log --oneline 8311fa89b -- Mingla_Artifacts/design/PHASE_2_DESIGN_META-ORCH-0972_SCREEN_INVENTORY.md` shows commit `8311fa89b` on top of `35c94d7c2`. Zero uncommitted modifications (`git status --short` shows only one untracked file `CODEX_RE_REVIEW_META-ORCH-0972_AUDIT.md` which is a Phase 1 carry-over, not in scope).

---

## Dependency walk for config-layer changes

**N/A — REWORK touched zero config files.** Single-file edit to a design markdown. No edits to `app.json`, `app.config.ts`, `vercel.json`, `package.json`, `tsconfig*.json`, `expo.json`, `metro.config.*`, `babel.config.*`, `next.config.*`, `.github/workflows/**`, or `.github/scripts/**`.

---

## Gap closure verification — point-by-point against prior REVIEW lines 92–99

### Gap 1 — D3 (authoring gate) row missing

**Prior scope (line 92):** "Add D3 (authoring gate) row to 'Business app — Brand creation + edit' or a new section. Row should cover `brandAuthoringGate.ts` whole-file delete + `eventDrafts.ts:172` callsite removal + `tripsService.ts:441` callsite removal. ~3 files, ~1 row with all 3 files in the Files column."

**Delta:** New row added immediately above the `BrandEditView` SECTION B-2 row:

```
| `brandAuthoringGate.ts` + draft callsites | Blocks event/trip draft creation when `kind='physical' && claim_status !== 'verified'`; popup + trip_planner brands already pass | DELETE entire gate file + both callsites; universal authoring per Q11 + I-BRAND-UNIVARSAL-AUTHORING | D3: brandAuthoringGate.ts (whole-file delete), eventDrafts.ts:172 (callsite delete), tripsService.ts:441 (callsite delete) | YES | YES | YES |
```

- Files cited: 3 (matches the prior scope) ✓
- Line numbers cited: `eventDrafts.ts:172` ✓ + `tripsService.ts:441` ✓ — both match the prior REVIEW + DATA_MODEL_AUDIT lines 318–319 catalogue
- Dimension tag: D3 ✓
- Affected Surfaces (iOS-business / Android-business / web-business): YES / YES / YES ✓ — gate is in shared service layer, applies everywhere
- Invariant reference: I-BRAND-UNIVERSAL-AUTHORING (typo "UNIVARSAL" in source; flagged below)

**Verdict:** ✅ closed.

### Gap 2 — D1 (brand creation cluster) under-rowed — 5 expansion items

**Prior scope (lines 94–99):** add separate rows or expand "Files" columns for: `brandsService.ts:93-128`, `brandMapping.ts:47-48/91-92/240-243/311/395`, `brandPatch.ts:38-40` (Codex G2), `useBrands` hook, 5 test file deletions.

**Delta:** 5 new rows added in the D1 cluster, between the existing `TripBrandWizard` row and the new `BrandCreationFlow (NEW)` row:

| # | New row subject | File:lines cited | Matches prior scope? |
|---|---|---|---|
| 1 | `brandsService.ts` create contract | `brandsService.ts` lines 93–128 (`CreateBrandInput` kind field delete) | ✓ exact |
| 2 | `brandMapping.ts` brand-kind plumbing | `brandMapping.ts` lines 47–48, 91–92, 240–243, 311, 395 | ✓ exact (all 5 line ranges) |
| 3 | `brandPatch.ts` dirty patch | `brandPatch.ts` lines 38–40 (dirty-patch delete; Codex G2) | ✓ exact, Codex G2 attribution preserved |
| 4 | `useBrands` create mutation | `useBrands.ts` (`useCreateBrand` input kind delete) | ✓ exact |
| 5 | D1 obsolete persona/kind tests | 5 files: `BrandSwitcherSheet.personaFork.test.ts`, `BrandSwitcherSheet.personaFork.ve1.test.ts`, `BrandSwitcherSheet.personaFork.ve2.test.ts`, `TripBrandWizard.test.ts`, `brandsService.tripPlannerKind.test.ts` | ✓ exact (all 5 test files) |

All 5 rows tagged `D1` in the Audit-source-row column. All 5 rows declare Affected Surfaces YES/YES/YES (iOS-business / Android-business / web-business) — correct since these are shared TS service/hook layers, not platform-specific.

**Verdict:** ✅ closed.

### Cross-check against original Dim coverage table (prior REVIEW line 61)

The prior REVIEW table line 61 enumerated the D1 missing surfaces inline: "brandsService.ts (CreateBrandInput change), brandMapping.ts (5 line edits), brandPatch.ts:38-40 (Codex G2 finding), useBrands hook, 5 test deletions" — exactly 5 items. Delta added exactly 5 rows. No items missed, no items added beyond scope.

---

## Contradiction sweep against USER_JOURNEYS, COPY_INVENTORY, HANDOFF_TO_SPEC

Per dispatch hard-constraint, I did NOT re-open these docs for general re-review. I DID grep them for any reference that the 6 new rows might contradict.

- `brandAuthoringGate.ts` — referenced in HANDOFF_TO_SPEC cross-reference table (Phase 3 spec scope) and USER_JOURNEYS Design Area 1. Delta is consistent — inventory now self-contains the surfaces HANDOFF_TO_SPEC already flagged.
- `brandsService.ts` + `CreateBrandInput` — referenced in DATA_MODEL_AUDIT Sub-A enumeration line 320–325. Delta consistent.
- `brandMapping.ts` line ranges — referenced in INVESTIGATION_META-ORCH-0972_BRAND_KIND_GAP_AUDIT D1 catalogue + DATA_MODEL_AUDIT. Delta consistent.
- `brandPatch.ts:38-40` — referenced in REWORK prompt `DESIGNER_PHASE_2_REWORK_META-ORCH-0972_SCREEN_INVENTORY_GAPS.md:39` (Codex G2 finding from supplemental review). Delta consistent.
- 5 test file deletions — referenced in DATA_MODEL_AUDIT Sub-A test cleanup. Delta consistent.

**No contradictions surfaced.** The delta strictly closes the inventory gap; design intent (USER_JOURNEYS), copy (COPY_INVENTORY), and spec-handoff structure (HANDOFF_TO_SPEC) are unchanged and remain approved.

---

## One trivial finding (informational, NOT a block)

Row 1 (D3 authoring gate row) cites invariant name `I-BRAND-UNIVARSAL-AUTHORING` — typo, should be `I-BRAND-UNIVERSAL-AUTHORING`. The invariant itself is the "Invariants META-ORCH-0972 will INTRODUCE on CLOSE" entry in HANDOFF_TO_SPEC. This is a 1-character fix that Phase 3 SPEC writer or Phase 4 implementor can correct in passing; not large enough to bounce back to designer.

---

## Final verdict

**APPROVED.** Both prior NEEDS WORK gaps are closed, mechanically and exactly to the rework-scope text. No contradictions introduced. SCREEN_INVENTORY is now self-contained — a Phase 4 implementor reading the inventory alone has every surface the audit catalogued, with line numbers, dimension tags, and platform parity.

Phase 2 USER JOURNEY DESIGN is fully closed at commit `8311fa89b`. Phase 3 SPEC may dispatch.

---

## Inputs for Phase 3 SPEC dispatch

Phase 3 SPEC writer (Claude `mingla-forensics`, SPEC mode) reads:

1. `Mingla_Artifacts/design/PHASE_2_DESIGN_META-ORCH-0972_USER_JOURNEYS.md` — flow + visual design
2. `Mingla_Artifacts/design/PHASE_2_DESIGN_META-ORCH-0972_SCREEN_INVENTORY.md` — every file/screen touched (at `8311fa89b`)
3. `Mingla_Artifacts/design/PHASE_2_DESIGN_META-ORCH-0972_COPY_INVENTORY.md` — every label/CTA/empty/error before-after
4. `Mingla_Artifacts/design/PHASE_2_DESIGN_META-ORCH-0972_HANDOFF_TO_SPEC.md` — what design locks vs what spec defines
5. `Mingla_Artifacts/reports/INVESTIGATION_META-ORCH-0972_OPEN_QUESTIONS.md` — 11 operator-answered design questions (Q1–Q11) + 4 newly-surfaced (Q12–Q15) that Phase 3 must resolve
6. `Mingla_Artifacts/reports/INVESTIGATION_META-ORCH-0972_BRAND_KIND_GAP_AUDIT.md` — full audit + RLS predicate analysis + invariant proposals
7. `Mingla_Artifacts/reports/INVESTIGATION_META-ORCH-0972_DATA_MODEL_AUDIT.md` — Sub-A through Sub-D execution order

Hard guards on Phase 3 SPEC:
- Do not redesign — design is locked at `8311fa89b`.
- Do define exact migration sequence, RPC SQL, prop interfaces, hook signatures, success criteria per surface, regression test cases (T-01..T-NN), and Cross-Surface Impact section (Phase 2.5).
- Resolve Q12–Q15 (recurrence, past-tab structure, Upcoming cap, venueCategory inference) with explicit decisions.
- Define exact Sub-A/B/C/D file-level scoping (mechanical, derived from SCREEN_INVENTORY rows).
- Cite Stripe/Supabase docs URLs inline per COMMS-0003 if any external API surfaces touched (DB-only + UI-only scope expected → likely N/A).
- Cite the `brandAuthoringGate.ts` row's invariant as `I-BRAND-UNIVERSAL-AUTHORING` (fix the SCREEN_INVENTORY typo while you're there, or note it in the spec).

Output filename: `Mingla_Artifacts/specs/SPEC_META-ORCH-0972_BRAND_KIND_DECOMMISSION.md` (single spec OR 4 sub-specs Sub-A/B/C/D per HANDOFF_TO_SPEC §"Recommended Phase 3 spec structure" — Phase 3 writer's call).

Downstream after SPEC return: REVIEW (orchestrator) → IMPLEMENT (Codex `implementor-mingla` or Claude `mingla-implementor`, Sub-A/B/C/D phased) → REVIEW → DEPLOY (orchestrator owns edge fn deploys; operator owns `supabase db push --linked`) → TEST (Claude `mingla-tester`, iOS-business + Android-business + buyer-web parity per Affected Surfaces) → CLOSE.
