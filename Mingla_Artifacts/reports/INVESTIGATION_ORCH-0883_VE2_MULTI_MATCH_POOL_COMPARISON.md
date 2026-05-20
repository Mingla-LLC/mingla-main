# INVESTIGATION — ORCH-0883 [Ve2 Multi-Match Pool Comparison for Chain Venues]

**Status:** INVESTIGATION COMPLETE (single-session, claude `mingla-orchestrator`, 2026-05-19) — ready for SPEC dispatch.
**Severity:** S2 (degrades non-critical flow — chain/franchise venue claims; single-location venues unaffected).
**Affected Surfaces:** business-iOS, business-Android, business-web-preview. Not in scope: consumer iOS/Android (no operator-facing flow), buyer-web (anon checkout), admin-web (admin reviews claims, doesn't create them).
**Reporter:** Operator (Seth) during ve2 PR #142 smoke test, 2026-05-19.

## Plain-English problem

When an operator opens a venue claim via Brand Switcher → "A place" → types a brand name with multiple physical locations (e.g. "Perry's Steakhouse" — Houston, Austin, Dallas, San Antonio, etc.), they see **only ONE pool match** — the highest-`review_count` location, regardless of which city the operator actually intends to claim.

Three forced outcomes, all bad for chain venues:
1. **Tap "Yes, this is me"** → wizard prefills with the WRONG location's address/lat/lng/photo. Bad data on the new brand row.
2. **Tap "No, different business"** → falls through to ve1 manual entry. **Pool linkage lost.** The Austin Perry's becomes a manual brand record disconnected from the canonical place_pool row, breaking future analytics + admin moderation parity.
3. **Tap "Skip — create from scratch"** → same as #2 but explicit.

No path lets the operator say "Yes, but the Austin one, not the Houston one."

## Root cause — deliberate single-match design baked into 4 layers

Ve2 (per PR #142, ORCH-0100) was shipped with single-match semantics top to bottom:

| Layer | File | Single-match enforcement |
|---|---|---|
| Edge function | `supabase/functions/claim-search-pool/index.ts:23-24` | `const DEFAULT_LIMIT = 1;` (RPC itself accepts up to `MAX_LIMIT = 5`, but caller default is 1) |
| Service | `mingla-business/src/services/poolSearchService.ts` | Returns `Promise<PoolMatch[]>` — array shape, but… |
| Hook | `mingla-business/src/hooks/usePoolMatchSearch.ts:50` | `setMatch(matches[0] ?? null)` — discards `matches[1..n]` |
| UI component | `mingla-business/src/components/brand/PoolMatchCard.tsx:17-22` | Prop `match: PoolMatch` (singular). Renders ONE card, two CTAs ("Yes, this is me" / "No, different business") + one skip |
| Copy | Same | "We found **a** match in our directory" (singular eyebrow) |
| RPC ordering | `supabase/migrations/20260618000001_ve2_claim_search_rpc.sql` | `ORDER BY: prefix-match first, then review_count DESC, then name ASC` — gives the most-reviewed name-prefix match wins; ties broken by name |

The RPC's `p_limit int DEFAULT 5` and `LIMIT greatest(1, least(coalesce(p_limit, 5), 10))` already supports up to 10 results — the SQL layer is NOT the bottleneck. The bottleneck is the edge function + frontend client.

## Why single-match was probably chosen (design context)

Speculation, not verified with Taofeek: the design likely optimizes for the **majority case** — single-location independent venues — and treats chain disambiguation as a fall-through to manual entry. For non-chain venues this is a tight UX (no decision paralysis, one tap to accept the obvious match). For chains it fails as documented.

## Recommended fix scope (5 layers)

Estimated 1-2 day implementor effort + 1-day tester + 0.5-day SPEC:

1. **Edge function** (`claim-search-pool/index.ts`): change `DEFAULT_LIMIT = 1` → `DEFAULT_LIMIT = 5`. Keep `MAX_LIMIT = 5` (or bump to 10 if SPEC chooses).
2. **Service** (`poolSearchService.ts`): unchanged — already array-shaped.
3. **Hook** (`usePoolMatchSearch.ts`): return `matches: PoolMatch[]` instead of `match: PoolMatch`. Rename hook output type to `UsePoolMatchSearchResult.matches`. Reset to `[]` instead of `null` on empty.
4. **Component** (`PoolMatchCard.tsx`): redesign from one card to a vertical list/carousel of N cards (up to 5). Each card shows name + city + address + photo for disambiguation. Per-card "Yes, this is me" CTA. Bottom "None of these — different business" + "Skip — create from scratch" CTAs as before.
5. **Wizard wiring** (`mingla-business/app/venue/create.tsx`): adapt to receive a SELECTED pool match from the list rather than auto-accepting the single match. Prefill logic in `prefillDraftFromPoolMatch.ts` already takes a single `PoolMatch` arg, so no service-layer change.
6. **Copy**: "We found a match" → "We found **{N} possible matches** — which one are you?" (i18n key updates).
7. **Optional city-scoping** (nice-to-have, not blocker): if operator's brand context has a city, RPC could order by `WHERE city = ? OR true` to prefer city-local matches. This requires a SPEC decision — pass city to edge function? Or operator's current brand?

## Test scope additions

- New jest suite: `BrandSwitcherSheet.poolMultiMatch.test.ts` — covers "5 matches show 5 cards", "selection wires to wizard with chosen match's data"
- Existing `ve2PoolMatchFlow.test.ts` — extend to cover multi-match selection paths
- Existing `prefillDraftFromPoolMatch.test.ts` — no change (unit logic same)
- Manual smoke: search "Perry's Steakhouse" → 5 cards (Houston, Austin, Dallas, San Antonio, +1) → pick Austin → wizard prefilled with Austin data → submit → `place_pool_id` = Austin row's ID

## Append-only test gate (per [[regression-test-backfill]])

Two tests required at CLOSE:
- **Implementor happy-path:** `multiMatchSelection.test.ts` — render 3-match list, click match #2's "Yes this is me", assert prefilled draft uses match #2's data
- **Tester adversarial:** edge case — 0 matches returned (should hide card, show only ve1 fallback messaging); 1 match returned (should still render single card path)

## Invariants worth codifying (DRAFT, flip ACTIVE on CLOSE)

- **I-PROPOSED-VE2-MULTI-MATCH-NO-AUTO-PICK** — hook MUST NOT pre-select a match; operator must explicitly tap "Yes this is me" on the specific card they intend
- **I-PROPOSED-VE2-POOL-MATCH-LIMIT-RESPECTS-MAX** — edge function returns ≤ MAX_LIMIT matches; never exceeds the RPC's 10-row cap

## Recommendation

Dispatch a **forensics SPEC** session next (not investigation — diagnosis is already complete). Spec author should:
1. Confirm Taofeek's intent vs Seth's expectation for the chain case
2. Decide on the optional city-scoping question
3. Bound the redesign to the 5 layers above without scope creep into the full venue-claim flow
4. Specify the 5-card vertical list vs horizontal swipeable carousel
5. Lock the test scope per the regression-test backfill gate

After SPEC: dispatch implementor (Codex `implementor-mingla` default, or Claude `mingla-implementor` if operator delegates), then tester, then CLOSE.

## Cross-references

- PR #142 (ORCH-0100, ve2) — merged 2026-05-19 as `c07de2a4` on main, ships the single-match UX this ORCH amends
- PR #135 (ORCH-0099, ve1) — merged 2026-05-19 as `f21d6b4f` on main, ships the underlying venue-claim flow
- `feedback_taofeek_pr_merge_sop.md` — SOP for the merge-test-approve pattern used to land ve2; ORCH-0883 will be Mingla-internal work, not a contributor PR
- `place_pool` table schema — owned by Bouncer + signal scorer pipeline (post-ORCH-0700 Phase 3B); see `feedback_ai_categories_decommissioned.md`
