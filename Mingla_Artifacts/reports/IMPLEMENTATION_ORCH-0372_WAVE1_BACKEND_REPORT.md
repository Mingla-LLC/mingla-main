# Implementation Report: ORCH-0372 Wave 1 — Backend

**Date:** 2026-04-11
**Status:** Implemented, unverified (requires migration application + edge function deploy)

---

## Changes Summary

4 files changed. 1 file created, 3 files modified.

---

## Old → New Receipts

### supabase/migrations/20260411000001_price_tier_restructure.sql [CREATED]
**What it did before:** N/A (new file)
**What it does now:** 12-step migration that restructures the entire tier system:
- Migrates data from pro/elite → mingla_plus
- Tightens CHECK constraints to only allow free/mingla_plus
- Drops daily_swipe_counts table and swipe tracking functions
- Replaces get_tier_limits(), get_effective_tier(), check_pairing_allowed(), get_session_member_limit()
- Replaces all admin RPCs (stats, grant, list, revoke)
- Deactivates trial grants (create_subscription_on_onboarding_complete → no-op)
- Drops deprecated referral_bonus_used_months column
**Why:** Spec Layer 1, Steps 1-12
**Lines:** 285

### supabase/functions/send-pair-request/index.ts
**What it did before:** Returned 403 with `error: 'elite_required'` and message "Pairing is an Elite feature" when non-elite user tried to pair.
**What it does now:** Returns 403 with `error: 'pairing_limit_reached'`, message about free pairing limit, plus `currentCount` and `maxAllowed` fields. Comment updated from "Elite-only" to "Pairing limit check".
**Why:** Spec Layer 2, F-12. check_pairing_allowed now returns count-based data.
**Lines changed:** 8

### supabase/functions/process-referral/index.ts
**What it did before:** Push notification said "You earned Elite time!" / "1 month of Elite."
**What it does now:** Push notification says "You earned Mingla+ time!" / "1 month of Mingla+."
**Why:** Spec Layer 2, F-13
**Lines changed:** 2

### supabase/functions/discover-cards/index.ts
**What it did before:** Called get_remaining_swipes RPC in parallel with get_effective_tier. Returned early with `limited: true` if swipes exhausted. Had `swipeInfoPayload()` helper that added swipe data to responses. Had `applyTierGating()` helper that stripped curated card details (title, stops) for free users and added `_locked: true`.
**What it does now:** Only calls get_effective_tier (no swipe check). No swipe limit early return. No swipe info in responses. Curated cards served in full to all tiers — save-gating is client-side. The `applyTierGating` function is removed; `scoredPoolCards` passed directly to response.
**Why:** Spec Layer 2, F-14. Swipe tracking infrastructure dropped in migration. Curated cards now viewable by free users (spec decision #3).
**Lines changed:** ~40 removed

---

## Spec Traceability

| Success Criterion | Status | Evidence |
|---|---|---|
| SC-1: Migration applies cleanly | UNVERIFIED | SQL follows spec exactly, ordering is safe (data → constraint) |
| SC-2: subscriptions has only free/mingla_plus | UNVERIFIED | Step 1 migrates data, Step 2 adds CHECK |
| SC-3: admin_subscription_overrides has only free/mingla_plus | UNVERIFIED | Same as SC-2 |
| SC-4: get_effective_tier returns only free/mingla_plus | UNVERIFIED | All RETURN statements verified in SQL |
| SC-5: get_tier_limits('free') correct | UNVERIFIED | SQL has exact values from spec |
| SC-6: get_tier_limits('mingla_plus') correct | UNVERIFIED | SQL has exact values from spec |
| SC-7: check_pairing_allowed returns count-based | UNVERIFIED | New function signature matches spec |
| SC-8: daily_swipe_counts table gone | UNVERIFIED | DROP TABLE in Step 3 |
| SC-9: swipe functions gone | UNVERIFIED | DROP FUNCTION in Step 3 |
| SC-10: referral_bonus_used_months gone | UNVERIFIED | DROP COLUMN in Step 12 |
| SC-11: send-pair-request returns pairing_limit_reached | PASS | Code verified in file |
| SC-12: process-referral says Mingla+ | PASS | Code verified in file |
| SC-13: discover-cards no longer calls get_remaining_swipes | PASS | grep confirms 0 references |

---

## Spec Deviation: applyTierGating removal

The spec dispatch for Wave 1 did not explicitly mention removing `applyTierGating()` from discover-cards. However, the spec's decision #3 states: "Full card visible, save button gated. No blur, no lock overlay. Free users see the complete curated experience card."

The `applyTierGating()` function was stripping curated card data server-side (replacing titles with teasers, removing stop details, adding `_locked: true`). This directly contradicts decision #3. If left in place, free users would never receive the full card data from the API, making client-side "full card visible" impossible.

**Action taken:** Removed `applyTierGating()` and replaced `applyTierGating(scoredPoolCards)` with `scoredPoolCards` in the response. This is necessary and correct per the spec intent.

---

## Regression Surface

1. **Curated card rendering on mobile** — cards now arrive without `_locked: true` flag. The mobile `SwipeableCards.tsx` component checks this flag to decide whether to show `LockedCuratedCard`. After Wave 2 removes `LockedCuratedCard`, this is fine. BUT: between Wave 1 deploy and Wave 2 deploy, free users will see full curated cards on the existing app (the `_locked` check will be false, so the regular card renders). This is actually the desired behavior — just noting the transition window.

2. **Swipe limit on mobile** — the mobile `useSwipeLimit` hook calls `get_remaining_swipes` and `increment_daily_swipe_count` RPCs which no longer exist. Between Wave 1 and Wave 2, these RPC calls will fail silently (the hook wraps them in `.catch(() => {})`). The hook's `isUnlimited` flag depends on tier, and with the new `get_tier_limits('free')` returning `daily_swipes: -1`, the hook will see unlimited and skip tracking. Safe transition.

3. **Admin subscription stats** — returns `mingla_plus` key instead of `pro`/`elite`. Admin dashboard code still expects `pro`/`elite` until Wave 2. Stats will show 0 for Pro/Elite, and the `mingla_plus` count will be ignored. Non-critical — admin-only, fixed in Wave 2.

4. **Pairing during onboarding** — onboarding users are now Free (not Elite). Free users can pair with 1 person. If an onboarding user tries to accept a second pair request, `check_pairing_allowed` will return `allowed: false`. The mobile onboarding component should handle this gracefully (it shows pair request cards — accepting one succeeds, second would fail). Wave 2 should verify this flow.

---

## Discoveries for Orchestrator

1. **`applyTierGating` was not in the spec dispatch** but had to be removed for correctness. The spec should have included this. No harm done — the change is clearly implied by decision #3.

2. **Transition window risk is low.** Between Wave 1 and Wave 2 deploy, the existing mobile app code will encounter: (a) full curated cards (good — just renders normally since `_locked` won't be set), (b) failed swipe RPC calls (silent — hook catches errors), (c) wrong admin stats display (cosmetic). All benign.
