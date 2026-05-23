# QA — ORCH-0909 [Collab Deck Positional Shared-Deck] + ORCH-0906 [Single↔Intent 1:1 Interleave] Bundle

**Verdict:** **FAIL**
**Severity counts:** P0=2 | P1=0 | P2=1 | P3=0 | P4=0
**Tester:** Claude `mingla-tester`
**Date:** 2026-05-21
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Bundle implementation commit:** `18e6b792` + receipts at `43c7aed0` / `0ed5bb09`
**Devices used (pre-test live-fire repro):** iPhone 17 (UDID `F7ECAC25-2A98-4002-AD17-85AED17AB752`, iOS 26.4), Mingla `com.mingla.app.v2` running, Metro `localhost:8081` serving latest JS
**Devices NOT used:** iPhone 17 Pro Max, iPhone 17 Pro, Pixel_8_Pro — preempted by P0 findings before formal SC-01..SC-18 dispatch
**Sim confidence:** `proven` for both P0 findings (operator-witnessed live repro on iPhone 17, screenshots provided)

---

## Layman Summary

The amendment ships the **server side** of curated multi-stop journeys into the positional shared deck correctly: the DB has the new columns, the edge function emits `card_type: 'curated'` and packs the journey into `curated_payload`. But the **client side** never reads any of it. The phone code that turns the server's response into a card object throws away `cardType`, `curated_payload`, `stops`, `tagline`, `totalPriceMin/Max`, and every other multi-stop field. So every curated card hits the screen as a broken single-place card with a stale fallback hero image — including the title in the "Place A → Place B" multi-stop format because that string survived, while everything around it didn't.

Separately, there's an empty-state flash on every single swipe in collab: "No spots match right now" briefly appears, then the next card arrives. Same class of race condition ORCH-0902 originally fixed for the prefs-sheet-close path, but it was never fixed for the steady-state swipe path in the positional rewrite.

The bundle's implementation report (`Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0909_COLLAB_POSITIONAL_SHARED_DECK.md`) under "Client" claims: *"Verified existing `SwipeableCards.tsx` routes `card.cardType === 'curated'` to `CuratedExperienceSwipeCard`; no renderer change needed."* This claim is materially false. The routing branch is dead code because the upstream mapper never sets `cardType` on the recommendation object. No on-device verification was ever performed.

---

## P0 Findings

### P0-1 — Client `unifiedCardToRecommendation` strips every curated-experience field; curated cards render as corrupt single-place cards

**Component:** `app-mobile/src/services/deckService.ts:169-235`
**Severity:** P0 (data fabrication + behavioral contract violation per Constitution rule 9)
**Confidence:** `proven` (operator screenshots + code trace)
**Affected surfaces:** Consumer iOS (witnessed), Consumer Android (by code parity — same mapper)

**The fact:**

Server response shape from `discover-cards/handleDeterministicV2` (verified at `supabase/functions/discover-cards/index.ts:945-970`):

```jsonc
{
  "success": true,
  "card": <curated_payload>,          // the multi-stop journey JSON, raw
  "cards": [<curated_payload>],
  "card_type": "curated",              // ← envelope-level, NOT inside `card`
  "pill_label": "group-fun",
  "degraded_from": null,
  // ...
}
```

The curated journey blob inside `card` per `app-mobile/src/types/curatedExperience.ts:47-66` is:

```ts
interface CuratedExperienceCard {
  id: string;
  cardType: 'curated';      // literal — DOES exist on curated_payload (see generate-curated-experiences pickedCard)
  experienceType: string;
  pairingKey: string;
  title: string;
  tagline: string;
  categoryLabel?: string;
  stops: CuratedStop[];
  totalPriceMin: number;
  totalPriceMax: number;
  estimatedDurationMinutes: number;
  matchScore: number;
  shoppingList?: string[];
  teaserText?: string | null;
  _locked?: boolean;
}
```

The client mapper at `deckService.ts:169` consumes each response card and returns a `Recommendation`. Its body (lines 184-234) reads only the SINGLE-card fields (`card.id`, `card.title`, `card.lat`, `card.lng`, `card.description`, `card.image`, etc.) and emits a SINGLE-card Recommendation. It DOES NOT read or pass through `cardType`, `stops`, `experienceType`, `pairingKey`, `tagline`, `categoryLabel`, `totalPriceMin`, `totalPriceMax`, `estimatedDurationMinutes`, `shoppingList`, `teaserText`, `_locked`. Result: for every curated row, the Recommendation that reaches the consumer has `cardType === undefined`.

**Downstream consequence:**

`SwipeableCards.tsx:2353` routes via `(currentRec as any).cardType === 'curated' ? <CuratedExperienceSwipeCard …> : <single-card hero …>`. Because the mapper strips `cardType`, the ternary is ALWAYS false for curated rows. The single-card branch reads `currentRec.image` (which is `undefined` because the curated_payload doesn't have a top-level `image`) and renders a fallback/cached hero. The title field survives because `curated_payload.title` IS shaped as `"Place A → Place B"` (multi-stop format synthesized server-side). So the user sees:

- A multi-stop title (because `title` survived the mapper)
- A wrong/fallback hero image (because `image` was never set)
- The SAME hero image across multiple curated cards (because the fallback is shared)
- No journey badge, no "Group Fun · 2 stops" chip, no stop-by-stop card body — because `CuratedExperienceSwipeCard` was never invoked

**Operator-witnessed repro on iPhone 17 (UDID `F7ECAC25-…`):** In collab session "Testing stuff", swiping through the deck:

- Screenshot 2 — "Burning Coal Theatre Company → Jolie" (curated, broken: retail-store fallback hero)
- Screenshot 3 — "Colletta" (single, correct: proper hero, distance, drive time, rating, pills)
- Screenshot 4 — "Coastal Credit Union Music Park → Woody's @ City Market" (curated, broken: SAME retail-store fallback hero as screenshot 2)
- (Screenshot 1 is the deck-exhausted state, unrelated)

The shared retail-store fallback across two unrelated curated cards is the smoking-gun proof that the curated render path was never taken — both fell into the single-card path and grabbed the same fallback.

**Constitutional violation:** Constitution rule 9 — No fabricated data. Showing a stale/wrong hero image and stripping multi-stop metadata while displaying a multi-stop title constitutes fabricated data presented to the user.

**False claim in implementation report:**

`Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0909_COLLAB_POSITIONAL_SHARED_DECK.md` under "Scope Implemented" → "Client" row says:

> "Verified existing `SwipeableCards.tsx` routes `card.cardType === 'curated'` to `CuratedExperienceSwipeCard`; no renderer change needed."

This is the verification gap. The routing IS in `SwipeableCards.tsx`, but the upstream mapper that's supposed to set `cardType` was not audited. The "Verified" was source-only reading of `SwipeableCards.tsx`, not a live-fire repro. Per Phase 0.A live-fire sim gate (codified 2026-05-13), this claim should have been `suspected`, not `verified`.

**Required fix (implementor scope):**

In `app-mobile/src/services/deckService.ts`, update the consumer flow so curated payloads pass through to `CuratedExperienceSwipeCard` intact:

Option A (preferred — envelope-aware): in the collab-v2 fetch path at line 828, check `data.card_type === 'curated'` (envelope) and skip `unifiedCardToRecommendation` for curated rows — pass the `curated_payload` straight through as the Recommendation, with `cardType: 'curated'` attached:

```ts
const isCurated = data?.card_type === 'curated';
const cards = ((data?.cards as any[]) ?? []).map(card => {
  if (isCurated || card?.cardType === 'curated') {
    return { ...card, cardType: 'curated' } as unknown as Recommendation;
  }
  return unifiedCardToRecommendation(card);
});
```

Option B (mapper-aware): extend `unifiedCardToRecommendation` to branch on `card.cardType === 'curated'` and preserve all curated fields when matched.

Apply the same logic to the solo fetch path at line 445 if curated mixing reaches solo (per ORCH-0906 D7 graceful degrade — confirm with implementor whether D7 degrade exists in solo too; if not, Option A scoped to collab v2 is enough).

**Regression-test gate (ORCH-0840):**

New happy-path implementor test (e.g., `app-mobile/src/services/__tests__/deckService.curated.test.ts`):

```ts
it('preserves cardType + stops + tagline when server marks envelope card_type=curated', () => {
  const response = {
    cards: [{
      id: 'exp-1',
      cardType: 'curated',
      stops: [{...}, {...}],
      title: 'A → B',
      tagline: 'Coffee then a walk',
      experienceType: 'group-fun',
      totalPriceMin: 20,
      totalPriceMax: 60,
    }],
    card_type: 'curated',
    pill_label: 'group-fun',
  };
  const result = deckService.fetchCollabDeckV2Result(response); // wherever the merge happens
  expect(result.cards[0].cardType).toBe('curated');
  expect(result.cards[0].stops).toHaveLength(2);
  expect(result.cards[0].tagline).toBe('Coffee then a walk');
});
```

With fails-on-revert verified at the new commit SHA: revert anchor = the new branch in the mapper, test must FAIL.

Tester (me) will author an adversarial that attacks the inverse: a SINGLE row in a mixed deck must NOT acquire `cardType='curated'` from a leaking envelope flag from a previous response in the same fetch.

---

### P0-2 — Brief "No spots match right now" empty-state flash on every swipe in collab

**Component:** `app-mobile/src/contexts/RecommendationsContext.tsx` (consumer) + `app-mobile/src/components/SwipeableCards.tsx` (empty-state render)
**Severity:** P0 (UX silent-failure class — same family as ORCH-0902, recurrence flagged in `feedback_collab_deck_determinism_contract.md`)
**Confidence:** `proven` (operator-witnessed live repro on iPhone 17)
**Affected surfaces:** Consumer iOS (witnessed), Consumer Android (by code parity)

**The fact:**

After each right/left swipe in a collab session, the screen momentarily renders the "You've seen everything available / Shift preferences / Review all cards" empty state (which is the deck-exhausted UI — Screenshot 1), then a fraction of a second later the next card pops in. Expected behavior: the next card slides in WITHOUT the empty state ever rendering.

**Likely cause:**

Race condition between two state updates that should be atomic but aren't:

1. Swipe gesture commits → cursor advances client-side (`currentPosition` increments)
2. Cards array hasn't yet been refilled with position N+1 (network fetch in flight)
3. Render between (1) and (2) sees `cards.length === 0` (or `currentIndex >= cards.length`) and renders the empty state
4. Fetch resolves → next card inserted → empty state replaced

This is the SAME class of bug ORCH-0902 originally fixed for the prefs-sheet-close path (`feedback_collab_deck_determinism_contract.md` mentions the prefs-close fix). The positional rewrite at ORCH-0909 likely reintroduced it for the steady-state swipe path because the empty-state gate doesn't distinguish "cards array temporarily empty between fetches" from "deck genuinely exhausted (server returned `dead_end: true`)."

**Required fix (implementor scope):**

Empty-state should ONLY render when the server has explicitly signaled exhaustion (`dead_end: true` or equivalent). A transiently empty `cards` array during a swipe-to-next-fetch cycle must render a loading/skeleton state (or simply hold the previous card frame) — not the exhausted empty state.

Audit the gate condition in SwipeableCards (likely an `else` clause on `cards.length === 0` or `currentIndex >= cards.length`). Add a guard: `isFetchingNext || cards.length > 0 || !deadEndReason ? <skeleton/hold> : <empty-state>`.

**Regression-test gate (ORCH-0840):**

Implementor test: simulate a swipe with the fetch promise unresolved; assert that empty-state UI is NOT rendered during the in-flight window. Tester adversarial: rapid double-swipe before first fetch resolves — verify no empty-state flicker either.

---

## P2 Finding

### P2-1 — Implementation report's "no renderer change needed" claim was source-only verification

**Component:** `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0909_COLLAB_POSITIONAL_SHARED_DECK.md` → "Scope Implemented" → "Client" row
**Severity:** P2 (process — for future implementor audits)
**Confidence:** `proven` (the claim sits at file:line above)

The implementation report states *"Verified existing `SwipeableCards.tsx` routes `card.cardType === 'curated'` to `CuratedExperienceSwipeCard`; no renderer change needed."* Per Phase 0.A live-fire sim gate, a claim of "Verified" against a runtime/UI behaviour requires `proven`-level live-fire. This was instead source-only reading. The implementor's runbook should require an iOS-sim curated-card render check before claiming any UI verification on the consumer side.

This is the process gap that let P0-1 ship as "PASS" in the implementation report despite being trivially observable on first swipe. Flag for the next implementor onboarding update.

---

## What Was NOT Tested

The bundle FAIL on P0-1 + P0-2 preempted SC-01..SC-18 dispatch. The following test scenarios remain unrun and are deferred to RETEST after implementor rework:

- SC-01..SC-13 (ORCH-0909 parent positional shared-deck scenarios)
- SC-14..SC-18 (ORCH-0906 amendment scenarios — D4 worked example, D7 graceful degrade, no-GPS banner, late join)
- Three-account collab (Account A iPhone 17, Account B iPhone 17 Pro Max, Account C iPhone 17 Pro) — three iOS sims booted and Metro-ready
- Android parity on Pixel_8_Pro — local EAS dev build was in flight when P0s surfaced; build artifact retained for retest pass
- D7 server-side graceful-degrade flags (`degraded_from_intent`, `degraded_from_single`, `exhausted_intent`, `all_pools_exhausted`) on the wire — code path reached for curated cards but consumer doesn't surface them yet (gated on P0-1 fix)
- No-GPS banner on Pixel_8_Pro / iOS — depends on collab v2 flow working end-to-end

## Receipts

All 21 regression tests at `0ed5bb09` are green. Step 0.5 gate is CLEARED at the SHA level (paperwork is right). The product behaviour gap is what failed — the tests as written assert SERVER emits the right shape, which it does; they do not assert CLIENT consumes that shape. That's a test-design gap that the implementor's new regression tests in the rework should close.

## Discoveries for Orchestrator

- `feedback_implementor_uses_ui_ux_pro_max.md` is relevant — the curated rendering on shared deck IS a visible UI change (introduces curated cards into a previously single-only deck). The implementor should have invoked `/ui-ux-pro-max` for the client integration. Was not invoked per the implementation report.
- `feedback_solo_collab_parity.md` — confirm in rework whether the same `unifiedCardToRecommendation` mapper is hit by the solo curated path (`generate-curated-experiences` direct invocation). If so, this same bug class affects solo, not just collab. Likely yes, since `deckService.ts:445` uses the same mapper.

## Next Handoff

NEXT HANDOFF — paste into Codex `implementor-mingla`:

> Re-open ORCH-0906 [Collab deck single↔intent 1:1 alternation with per-pill round-robin, server-side merge] for client-side rework. The bundle commit `18e6b792` shipped the server correctly but the consumer mapper `app-mobile/src/services/deckService.ts:169-235 (unifiedCardToRecommendation)` strips `cardType`, `stops`, `tagline`, `experienceType`, `pairingKey`, `categoryLabel`, `totalPriceMin`, `totalPriceMax`, `estimatedDurationMinutes`, `shoppingList`, `teaserText`, `_locked` from curated rows. As a result every curated card renders as a corrupt single-place card with a fallback hero. SwipeableCards.tsx:2353's `cardType === 'curated'` routing branch is dead code because the mapper never sets `cardType`. Operator-witnessed FAIL on iPhone 17 in collab session "Testing stuff". Full FAIL report at `Mingla_Artifacts/reports/QA_ORCH-0909_AMENDMENT_ORCH-0906_BUNDLE_REPORT.md` — read it first. Scope: (1) fix `deckService.ts` collab-v2 fetch path (line 828) AND solo fetch path (line 445) to envelope-detect `card_type === 'curated'` and pass `curated_payload` through as a Recommendation with `cardType: 'curated'` and all multi-stop fields preserved — Option A in the QA report is preferred; (2) fix the swipe-empty-state flash race per P0-2 — empty-state UI must only render on explicit `dead_end: true`, not on transiently-empty `cards[]` during fetch. Author a happy-path regression test (`app-mobile/src/services/__tests__/deckService.curated.test.ts` or similar) per the snippet in QA report P0-1 with fails-on-revert verified at the new SHA. Re-invoke `/ui-ux-pro-max` as the design pre-flight per `feedback_implementor_uses_ui_ux_pro_max.md` — this is a visible UI change. Working tree: `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`. Return implementation report at `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0906_REWORK_CLIENT_CURATED_PAYLOAD.md` with anchor reverts cited per test. Dispatch back to Claude `mingla-tester` for RETEST + SC-01..SC-18 live-fire after.
