# QA Report: ORCH-0372 — Price Tier Restructure

**Date:** 2026-04-11
**Verdict: CONDITIONAL PASS** (1 P1 defect found — fix required before production)
**Defects:** P0: 0 | P1: 1 | P2: 0 | P3: 0 | P4: 1

---

## Pre-Test: TypeScript Compilation

**Result: PASS (no new errors)**

272 pre-existing TypeScript errors in the codebase. **Zero** are from tier-restructured files. Filtered by every tier-related file — only `SavedTab.tsx` has errors, all about `openingHours` property (pre-existing, unrelated).

---

## Database Layer (T-01 to T-09)

| # | Test | Result | Evidence |
|---|------|--------|----------|
| T-01 | Tier values in subscriptions | **PASS** | `SELECT DISTINCT tier FROM subscriptions` → `[{tier: "free"}]` |
| T-02 | Tier values in admin overrides | **PASS** | `SELECT DISTINCT tier FROM admin_subscription_overrides` → `[{tier: "mingla_plus"}]` |
| T-03 | get_effective_tier returns valid tiers | **PASS** | `SELECT DISTINCT get_effective_tier(id) FROM profiles` → `free`, `mingla_plus` only |
| T-04 | get_tier_limits('free') | **PASS** | Returns `max_pairings=1, max_sessions=1, daily_swipes=-1, max_session_members=-1, curated_cards_access=false, custom_starting_point=false` |
| T-05 | get_tier_limits('mingla_plus') | **PASS** | Returns all `-1` / `true` |
| T-06 | daily_swipe_counts table gone | **PASS** | `swipe_table_exists = false` |
| T-07 | referral_bonus_used_months column gone | **PASS** | `col_exists = false` |
| T-08 | check_pairing_allowed count-based | **PASS** | Returns `{allowed: true, current_count: 0, max_allowed: -1, tier: "mingla_plus"}` |
| T-09 | CHECK constraint blocks invalid tier | **PASS** | `check_violation` exception raised when attempting `tier = 'pro'` |

**9/9 PASS**

---

## Edge Functions (T-10 to T-13)

| # | Test | Result | Evidence |
|---|------|--------|----------|
| T-10 | send-pair-request error code | **PASS** | Code has `error: 'pairing_limit_reached'`, zero references to `elite_required` |
| T-11 | process-referral notification copy | **PASS** | Code has `"You earned Mingla+ time!"`, zero references to `"Elite"` |
| T-12 | discover-cards no swipe gating | **PASS** | grep confirms zero references to `get_remaining_swipes`, `swipeData`, `swipeInfoPayload` |
| T-13 | discover-cards curated cards ungated | **PASS** | grep confirms zero references to `_locked`, `applyTierGating` |

**4/4 PASS**

---

## Code-Level Verification (T-14 to T-18)

| # | Test | Result | Evidence |
|---|------|--------|----------|
| T-14 | TypeScript compiles (no new errors) | **PASS** | 0 new errors from tier files |
| T-15 | No old tier string literals | **PASS** | grep `'pro'\|'elite'` → 0 matches in .ts/.tsx |
| T-16 | No deleted file imports | **PASS** | grep `useSwipeLimit\|LockedCuratedCard` → 0 matches |
| T-17 | No initialTier prop | **PASS** | grep `initialTier` → 0 matches |
| T-18 | No unlimited_swipes | **PASS** | grep `unlimited_swipes` → 0 matches |

**5/5 PASS**

---

## Mobile — Free User Flows (T-19 to T-28)

| # | Test | Result | Evidence |
|---|------|--------|----------|
| T-19 | Free user swipes unlimited | **UNVERIFIED** | Needs device. Code: no swipe limit hook, no counter UI, no limit RPC calls. |
| T-20 | Free user sees curated cards fully | **UNVERIFIED** | Needs device. Code: LockedCuratedCard deleted, applyTierGating removed from API. |
| T-21 | Free user can't save curated card | **UNVERIFIED** | Needs device. Code: save gating via `canAccess('curated_cards')` → false for free. |
| T-22 | Free user creates 1 session | **UNVERIFIED** | Needs device. DB: `check_session_creation_allowed` returns `max_allowed=1` for free. |
| T-23 | Free user blocked on 2nd session | **UNVERIFIED** | Needs device. DB trigger `enforce_session_creation_limit` fires with new limits. |
| T-24 | Free user pairs with 1 person | **UNVERIFIED** | Needs device. DB: `check_pairing_allowed` returns `max_allowed=1` for free. |
| T-25 | Free user blocked on 2nd pairing | **UNVERIFIED** | Needs device. Edge function returns `pairing_limit_reached`. |
| T-26 | Free user unpairs, then pairs again | **UNVERIFIED** | Needs device. DB: count-based, unpair reduces count. |
| T-27 | Free user can't set custom starting point | **UNVERIFIED** | Needs device. Code: `canAccess('custom_starting_point')` → false for free. |
| T-28 | Free user curated preferences unlocked | **PASS** | Code: `isCuratedLocked={false}` confirmed at line 932 of PreferencesSheet.tsx |

**1/10 PASS, 9/10 UNVERIFIED (need device)**

---

## Mobile — UI Components (T-36 to T-41)

| # | Test | Result | Evidence |
|---|------|--------|----------|
| T-36 | BillingSheet shows 2 tiers | **UNVERIFIED** | Code: `TIER_ORDER = ['free', 'mingla_plus']`, 2 entries in TIERS. |
| T-37 | BillingSheet trial label | **UNVERIFIED** | Code: trial label reads "Trial" not "Elite trial". |
| T-38 | CustomPaywallScreen single plan | **UNVERIFIED** | Code: no tab UI, single package list, Free vs Mingla+ checklist. |
| T-39 | Friend profile tier badge | **UNVERIFIED** | Code: `TIER_LABEL = { free: 'Free', mingla_plus: 'Mingla+' }` |
| T-40 | Pair button always active | **UNVERIFIED** | Code: lock icon and opacity logic removed from DiscoverScreen. |
| T-41 | Preferences curated unlocked | **PASS** | Code: `isCuratedLocked={false}`. |

**1/6 PASS, 5/6 UNVERIFIED (need device)**

---

## Admin Dashboard (T-42 to T-45)

| # | Test | Result | Evidence |
|---|------|--------|----------|
| T-42 | Subscription page tier filters | **PASS** | Code: `[null, "free", "mingla_plus"]`, grep confirms zero `"pro"`/`"elite"` |
| T-43 | Subscription page stats | **PASS** | Code: stats object has `free` and `mingla_plus` keys |
| T-44 | Grant override with mingla_plus | **PASS** | Code: grant buttons are `["free", "mingla_plus"]` |
| T-45 | Email page tier segmentation | **PASS** | Code: `TIER_OPTIONS` has `free` and `mingla_plus` only |

**4/4 PASS**

---

## DEFECTS FOUND

### P1-001: Curated card expand blocked for free users in SwipeableCards

**File:** `app-mobile/src/components/SwipeableCards.tsx`
**Lines:** 981-984 (swipe-up gesture) and 1064-1068 (tap handler)
**Severity:** P1 — feature broken

**What's wrong:** Two code paths still block card expansion (tap-to-expand and swipe-up-to-expand) for curated cards when `!canAccess('curated_cards')`. Since free users have `curatedCardsAccess = false`, they can't expand curated cards to see details — contradicting the spec that says "free users see full curated cards."

**Expected:** Free users should be able to tap/swipe-up to expand any card, including curated cards. Only the **save action** should be gated, not viewing.

**Exact code (line 1064-1068):**
```typescript
// Block expand for locked curated cards — open paywall instead
if ((currentRec as any).cardType === 'curated' && !canAccess('curated_cards')) {
  setPaywallFeature('curated_cards');
  setShowPaywall(true);
  return;
}
```

**Exact code (line 981-984):**
```typescript
if (cardToRemove && !(
  (cardToRemove as any)?.cardType === 'curated' &&
  !canAccessRef.current('curated_cards')
)) {
```

**Fix:** Remove both blocks. Let curated cards expand for all users. The save gate already exists at the save action level.

---

### P4-001: Clean implementation pattern (praise)

The subscription type system, tier limits, and feature gate hook are exceptionally clean. Two-entry records, clear docstrings, correct semantic naming (`curatedCardsAccess` meaning "can save"), and backward compat maintained without spaghetti. Good work.

---

## Regression Checks

| # | Check | Result | Evidence |
|---|-------|--------|----------|
| R-1 | Onboarding pairing | **UNVERIFIED** | Needs device. Code: free tier allows 1 pairing, sufficient for onboarding Step 5. |
| R-2 | Session creation trigger | **PASS** | DB trigger `enforce_session_creation_limit` delegates to `check_session_creation_allowed` which reads from `get_tier_limits` — cascading fix confirmed. |
| R-3 | Session member limits | **PASS** | `get_session_member_limit` returns -1 for all. No cap. |
| R-4 | Referral bonus flow | **PASS** | `get_effective_tier` checks referral_bonus_months + started_at → returns 'mingla_plus'. |
| R-5 | RevenueCat purchase flow | **UNVERIFIED** | Needs device. Code: `syncSubscriptionFromRC` writes `'mingla_plus'` via `hasMinglaPlus()`. |

---

## Verdict

**CONDITIONAL PASS**

- **19/23 code-verifiable tests PASS** (DB, edge functions, greps, admin)
- **14 tests UNVERIFIED** (need device for runtime validation)
- **1 P1 defect** must be fixed: curated card expand is blocked for free users in SwipeableCards.tsx (2 locations)

**Blocking for production:** Fix P1-001 (remove curated card expand blockers). After that fix, all code-verifiable tests pass and the implementation is ready for device testing.
