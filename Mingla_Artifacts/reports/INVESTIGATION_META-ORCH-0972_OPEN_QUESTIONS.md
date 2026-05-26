# INVESTIGATION_META-ORCH-0972_OPEN_QUESTIONS

**ORCH:** META-ORCH-0972 [brand-kind decommission + universal feature access]
**Phase:** 1 of 4 — AUDIT (Final answered-state record)
**Mode:** INVESTIGATE (read-only)
**Author:** Claude `mingla-forensics`
**Date:** 2026-05-25
**Status:** **ALL 11 QUESTIONS ANSWERED.** This file is now the canonical record of what the operator decided. No remaining open questions block Phase 2.

---

## Reconciliation note (this rewrite supersedes the prior draft)

The first version of this report (committed at `b493df198`) catalogued Q1–Q11 with recommended defaults but kept several questions marked as "Open" because they had not yet been answered at audit-write time. The operator subsequently answered all 11 in two batches (Q1/Q4/Q6/Q8 batch one; Q2/Q3/Q7/Q9/Q10 batch two; Q5/Q11 were resolved by audit findings + operator confirmation). Codex `forensic-mingla` REVIEW flagged the stale "Open" state as a P1 cross-reference defect (Report 1 supplemental + WORLD_MAP said Q4/Q9 were resolved while this report still said Open with a contradicting recommendation). This rewrite reconciles every Q to its actually-decided state. The recommended-default language has been removed where the operator's answer matched it (no information loss — Phase 3 spec can still read the recommendation rationale from the original draft via git history at commit `b493df198`).

---

## Final answered state — Q1 through Q11

### Q1 — Free vs paid contract: when is Stripe required to publish?

**Answered 2026-05-25 — batch 1.** Operator chose **per-offering price gate at publish**: Stripe-active is required when publishing any offering with `max(tier.price) > 0`. Free offerings (all tiers price=0, RSVP-only) publish without Stripe. RSVP-with-deposit counts as paid. The gate fires at publish time, not at draft creation — users can draft freely. **Phase 3 spec scope:** translate this into the exact predicate in `homeNextAction.ts` rung 1 and in the publish-flow validator.

### Q2 — Hub empty state when a brand has zero offerings

**Answered 2026-05-25 — batch 2.** Operator chose **placeholder "Get started" tab with 3-button chooser**. When all 3 hub tabs would be hidden by the data-driven rule, a single placeholder tab labeled "Get started" renders the same Event / Trip / Experience chooser as the home empty state. Mirrors the home pattern.

### Q3 — Default hub tab when multiple are visible

**Answered 2026-05-25 — batch 2.** Operator chose **sticky last-visited tab, default Events on first ever visit**. Hub remembers what the user opened last; on the very first Hub visit ever, defaults to Events.

### Q4 — Experiences in the public-page Upcoming tab?

**Answered 2026-05-25 — batch 1.** Operator chose **IN — with new occurrence-date field**. Experiences interleave chronologically with events + trips in the Upcoming tab. This cascades into Q9 (experience schema enrichment) because experiences currently have no occurrence-date column.

### Q5 — TripBrandWizard collapse target

**Answered 2026-05-25.** Operator chose **collapse confirmed — clean delete and unify** into the universal brand-creation flow. Audit (Report 1 Dimension 1) proved this is mechanically clean: the wizard's 6-step flow (name → bio → cover → set default → set current → route to Stripe) maps 1:1 onto a unified flow, and the only "unique" UX was the hardcoded `address: null` which becomes the universal default in the new model. No unique safety behavior to preserve.

### Q6 — Where in the brand-creation flow do we ask for address?

**Answered 2026-05-25 — batch 1.** Operator chose **combined ask: brand-creation (optional, skippable) + first-experience (re-ask)**. Address is an optional input during brand creation; if skipped, the system asks again at first experience-creation time (since experiences need a venue per Q7). From then on, downstream offerings pre-fill from the brand address.

### Q7 — Experience-creation venue field defaulting behaviour

**Answered 2026-05-25 — batch 2.** Operator chose **always ask + pre-fill from brand address if present**. Experience creation form has a Venue field that is always visible. If the brand has an address, the field is pre-filled (user sees the value and can override per-experience — supports touring chefs / mobile vendors). If the brand has no address, the field is blank and the user types one in. Low friction + auditable.

### Q8 — Rebase decision: rebase the META-ORCH-0972 worktree onto origin/main now?

**Answered 2026-05-25 — batch 1.** Operator chose **yes, rebase now**. Executed during the same orchestrator turn that captured the batch-1 answers. Worktree is now 4 commits above origin/main (rebased onto `dd49d6d2b`), and the ORCH-0963 surfaces (`isTripBrand`, `<TripMiniCard>`, `<NextEventTeaser>`, `pg_public_trips_by_brand` RPC, ORCH-0963 strict-grep gate) are now in scope. The post-rebase Dimension 9 supplemental in Report 1 verified all pre-rebase predictions held.

### Q9 — Experience data-model enrichment path

**Answered 2026-05-25 — batch 2.** Operator chose **JSON sub-fields in `theme.experience_meta`**. Add `theme.experience_meta.next_occurrence_at` and `theme.experience_meta.venue_text` to experience rows. No DB column add. Tradeoff accepted: JSONB queries for chronological sort in the Upcoming tab; Phase 3 spec decides indexing strategy (functional GIN index on the JSON paths if performance demands it). The dedicated `experience_instances` table option is explicitly NOT chosen — overkill for the META-ORCH-0972 scope.

### Q10 — Admin Venue Claims queue filter replacement

**Answered 2026-05-25 — batch 2.** Operator chose **pending-review queue + separate verified/rejected view**. Default Claims page filters to `claim_status = 'pending_review'` (work-to-do queue). A separate "All Claims" tab/view surfaces verified + rejected history. Replaces the current `mingla-admin/src/services/adminClaimsService.js:37` `.eq("kind", "physical")` filter once `brands.kind` is dropped.

### Q11 — Persona picker fate (kill or repurpose?)

**Answered 2026-05-25 — batch 1.** Operator chose **kill it**. `PersonaPickerCards.tsx`, `PersonaForkSheet.tsx`, and the BrandSwitcherSheet persona-fork mode are deleted in Phase 4 Sub-B. The 3-button chooser (Event / Trip / Experience) on the home empty state (Q2 also) and on the hub "Get started" placeholder tab (Q2) takes the educational role the persona picker used to play.

---

## Phase 2 designer dispatch readiness

All 11 operator questions are answered. The Phase 2 (designer skill — user-journey redesign) dispatch is unblocked. Inputs for the designer:

- This report (final answered state)
- [INVESTIGATION_META-ORCH-0972_USER_JOURNEY_GAPS.md](./INVESTIGATION_META-ORCH-0972_USER_JOURNEY_GAPS.md) — 8 journeys + 5 themes
- [INVESTIGATION_META-ORCH-0972_BRAND_KIND_GAP_AUDIT.md](./INVESTIGATION_META-ORCH-0972_BRAND_KIND_GAP_AUDIT.md) — 12-dimension catalogue + post-rebase supplemental
- [INVESTIGATION_META-ORCH-0972_DATA_MODEL_AUDIT.md](./INVESTIGATION_META-ORCH-0972_DATA_MODEL_AUDIT.md) — schema + RLS + RPCs + 30-step DROP COLUMN safety plan
- [REVIEW_META-ORCH-0972_AUDIT.md](./REVIEW_META-ORCH-0972_AUDIT.md) — same-session Claude REVIEW
- [CODEX_INDEPENDENT_REVIEW_META-ORCH-0972_AUDIT.md](./CODEX_INDEPENDENT_REVIEW_META-ORCH-0972_AUDIT.md) — Codex independent REVIEW (NEEDS WORK → addressed by this supplemental + sibling edits)
- This supplemental change-log: [SUPPLEMENTAL_META-ORCH-0972_AUDIT_REVIEW_FIXES.md](./SUPPLEMENTAL_META-ORCH-0972_AUDIT_REVIEW_FIXES.md) — what changed in response to Codex REVIEW

End of report.
