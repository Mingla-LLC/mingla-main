# REVIEW_META-ORCH-0972_PHASE_2_DESIGN

**ORCH:** META-ORCH-0972 [brand-kind decommission + universal feature access + data-driven hub/public tabs]
**Phase reviewed:** 2 of 4 — USER JOURNEY DESIGN (`ui-ux-pro-max` skill output)
**Reviewer:** Claude `mingla-orchestrator`
**Date:** 2026-05-25
**Commit reviewed:** `35c94d7c2`
**Verdict:** **NEEDS WORK — narrow gap in SCREEN_INVENTORY coverage; design intent itself is sound**

---

## Reviewer transparency

Same-session bias risk applies — same Claude session produced both the Phase 2 design (as `ui-ux-pro-max` skill) and this REVIEW (as `mingla-orchestrator`). Operator previously authorized one extra Codex pass for the Phase 1 audit; same option available here if Phase 2 design needs second-set-of-eyes parity after the targeted gap is closed.

---

## Commit-hash verification

All 4 design deliverables tracked at commit `35c94d7c2`:

- `Mingla_Artifacts/design/PHASE_2_DESIGN_META-ORCH-0972_USER_JOURNEYS.md` (45626 bytes) ✓
- `Mingla_Artifacts/design/PHASE_2_DESIGN_META-ORCH-0972_SCREEN_INVENTORY.md` (17656 bytes) ✓
- `Mingla_Artifacts/design/PHASE_2_DESIGN_META-ORCH-0972_COPY_INVENTORY.md` (14270 bytes) ✓
- `Mingla_Artifacts/design/PHASE_2_DESIGN_META-ORCH-0972_HANDOFF_TO_SPEC.md` (9460 bytes) ✓

`git log --oneline 35c94d7c2 -- Mingla_Artifacts/design/` confirms all 4 files committed in that single commit. Zero uncommitted modifications.

---

## Dependency walk for config-layer changes

**N/A — Phase 2 design touched zero config files.** No edits to `app.json`, `app.config.ts`, `vercel.json`, `package.json`, `tsconfig*.json`, `expo.json`, `metro.config.*`, `babel.config.*`, `next.config.*`, `.github/workflows/**`, or `.github/scripts/**`. Design phase outputs markdown documentation only.

---

## Five REVIEW criteria

### (a) Q1–Q11 alignment vs OPEN_QUESTIONS — **PASS**

Master USER_JOURNEYS doc references 14 distinct Q1–Q15 mentions (Q1–Q11 operator-answered + Q12–Q15 newly-surfaced). Spot-checked alignment on Q1 (free-vs-paid → Design Area 3 rung 1 demotion), Q2 (hub empty → Design Area 4 placeholder tab), Q4 (experiences IN Upcoming → Design Area 5 ExperienceMiniCard), Q6 (combined ask → Design Area 1 Step 2 + Design Area 6 fallback), Q7 (pre-fill venue → Design Area 6 useExperienceVenueDefault), Q9 (JSON sub-fields → respected; no DB column add proposed), Q10 (admin tabs → Design Area 8 3-tab structure), Q11 (kill persona picker → Design Area 1 DELETE). Every operator-answered Q has a direct design implication.

### (b) No scope drift into Phase 3 — **PASS WITH MINOR NOTE**

- Zero explicit TS interface definitions (`interface X { ... }`) in design docs (grep returned 0 hits).
- Zero RPC function definitions (`CREATE FUNCTION pg_public_...`) in design docs.
- 2 SQL-keyword hits in HANDOFF_TO_SPEC, both inside the "Phase 3 spec must define" cross-reference table — that's the correct framing (handoff doc telling spec writer what to cover, not the design defining it). No drift.
- HANDOFF_TO_SPEC explicitly enumerates what design locks vs what spec defines.
- Master USER_JOURNEYS uses "Phase 3 spec defines X" framing for every implementation detail (RPC SQL, RLS predicate rewrites, hook signatures, migration ordering).

### (c) Cross-surface parity coverage — **PASS**

SCREEN_INVENTORY uses dedicated columns per platform (iOS-business / Android-business / business-web-preview / buyer-web / admin-web). 7 distinct platform-reference rows. Each design area's "Cross-surface parity" subsection in USER_JOURNEYS explicitly declares per-surface status. Consumer iOS + Android explicitly out-of-scope per audit Dim 12 (brand-kind-agnostic confirmed).

### (d) Every Phase 1 audit Dimension 1–12 finding addressed in SCREEN_INVENTORY — **FAIL (NEEDS WORK)**

Coverage map per dimension:

| Audit Dim | Subject | Screen inventory coverage | Status |
|---|---|---|---|
| D1 | Brand creation cluster (22 surfaces per audit) | 2 rows (BrandSwitcherSheet + TripBrandWizard); rolls multiple files into "Files" column inline but **does NOT list** brandsService.ts (CreateBrandInput change), brandMapping.ts (5 line edits), brandPatch.ts:38-40 (Codex G2 finding), useBrands hook, 5 test deletions | **GAP — expand D1 rows** |
| D2 | BrandEditView SECTION B-2 + address conditional | 3 rows (SECTION B-2, address input, Claim-a-venue affordance) | ✅ |
| D3 | Authoring gate (`brandAuthoringGate.ts` + 2 callsites) | **0 rows** — captured only in HANDOFF_TO_SPEC cross-reference table | **GAP — add D3 row(s)** |
| D4 | Address handling (6 surfaces) | 1 explicit row + cross-refs in D1/D2 rows | ⚠ minor — could be more explicit but acceptable since address is mostly covered via D1/D2 rows |
| D5 | Home dashboard rungs | 5 rows | ✅ |
| D6 | Hub tabs (5 distinct kind gates in experiences.tsx) | 6 rows | ✅ |
| D7 | Offering creation (incl. trip/[id]/edit.tsx:67 + UniversalCreatorSheet:79-80) | 5 rows | ✅ |
| D8 | AI experience generators | 1 row (covered fully in Backend section + USER_JOURNEYS Design Area 9; could be more explicit in inventory) | ⚠ minor |
| D9 | Public brand page | 9 rows (heaviest section) | ✅ |
| D10 | Venue claim | 3 rows | ✅ |
| D11 | Backend (DB + edge fns + strict-grep gates) | 16+ rows across "Backend — Database", "Backend — Edge functions", "Strict-grep CI gates" sections | ✅ (not tagged with literal "D11" label but content is complete) |
| D12 | Admin Venue Claims `adminClaimsService.js:37` | 1 row tagged "D12 (Codex P1)" | ✅ |

**The two real gaps:**

1. **D3 (authoring gate) has no row in SCREEN_INVENTORY.** Phase 4 implementor scoping from the screen inventory alone would miss the delete-brandAuthoringGate.ts task + the 2 callsite removals. Captured in HANDOFF_TO_SPEC but the inventory should be self-contained.

2. **D1 (brand creation cluster) is under-rowed.** 2 rows for 22 audit-catalogued surfaces. Rolling files into a single "Files" column is defensible, but missing entirely: `brandsService.ts:93-128` (CreateBrandInput interface change), `brandMapping.ts:47-48/91-92/240-243/311/395` (5 line edits), `brandPatch.ts:38-40` (Codex G2 dirty-patch block), `useBrands` hook (createBrand kind input), 5 test-file deletions. These are real files Phase 4 must touch.

### (e) Q12–Q15 newly-surfaced questions flagged not silently chosen — **PASS**

All 4 found at lines 782 (Q12 recurrence), 792 (Q13 past-tab structure), 796 (Q14 Upcoming cap), 800 (Q15 venueCategory inference) in USER_JOURNEYS doc. Each labeled "newly-surfaced" with designer recommendation, NOT presented as a final choice. Phase 3 spec writer is the resolver.

---

## Verdict and rework scope

**NEEDS WORK** with two narrow, mechanical gaps in SCREEN_INVENTORY. Design intent is sound; flow + copy + cross-surface parity + Q1–Q15 alignment all check out. Only the inventory artifact needs targeted expansion.

**Rework scope:**

1. **Add D3 (authoring gate) row to "Business app — Brand creation + edit" or a new "Business app — Authoring gate" section.** Row should cover `brandAuthoringGate.ts` whole-file delete + `eventDrafts.ts:172` callsite removal + `tripsService.ts:441` callsite removal. ~3 files, ~1 row with all 3 files in the Files column.

2. **Expand D1 (brand creation) "Files" columns or add separate rows for:**
   - `brandsService.ts:93-128` (CreateBrandInput interface change)
   - `brandMapping.ts:47-48/91-92/240-243/311/395` (5 line edits)
   - `brandPatch.ts:38-40` (Codex G2 dirty-patch block delete)
   - `useBrands` hook (createBrand kind input change)
   - 5 test file deletions (`BrandSwitcherSheet.personaFork.test.ts` + ve1 + ve2 variants, `TripBrandWizard.test.ts`, `brandsService.tripPlannerKind.test.ts`)

Mechanical work — same-session orchestrator can do this directly in 1 turn, faster than a designer rework cycle. Recommend operator authorizes orchestrator-direct fix rather than designer round-trip.

3. **Optional: independent Codex review parity** — same pattern as Phase 1 audit got (Codex re-review APPROVED HIGH confidence). Operator's call whether Phase 2 design warrants the same.

---

## What's good

- All 5 cross-cutting themes (A–E) explicitly addressed in USER_JOURNEYS Themes section.
- COPY_INVENTORY is exhaustive — every CTA / label / empty / error / toast / comment with before-after. Implementor-ready.
- HANDOFF_TO_SPEC cleanly enumerates what design locks vs what Phase 3 spec defines. The "Recommended Phase 3 spec structure" suggesting 4 sub-specs (Sub-A/B/C/D) aligns with audit's safety-plan staging.
- ui-ux-pro-max cross-cutting rules (44pt touch, 150–300ms motion, contrast 4.5:1, prefers-reduced-motion, no emojis as icons, content-jumping prevention via shimmer placeholders, button-disable-during-async) explicitly enforced at top of USER_JOURNEYS doc.
- Existing Mingla primitives (GlassCard, Icon, Button, TopSheet, BrandCoverPickerSheet, EventMiniCard, TripMiniCard, Haptics) explicitly preserved. New primitives bounded to: OfferingChooser + ExperienceMiniCard + BrandCreationFlow + ExperienceCreatorWizard + ~5 hooks. No design-system bloat.
- I-TRIP-SPOTS-MIRRORS-CAPACITY-GATE + I-PROPOSED-TR2-ROUTE-BY-EVENT-TYPE invariants explicitly preserved.

---

End of REVIEW.
