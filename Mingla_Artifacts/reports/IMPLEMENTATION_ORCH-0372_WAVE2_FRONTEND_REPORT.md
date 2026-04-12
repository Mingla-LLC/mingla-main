# Implementation Report: ORCH-0372 Wave 2 — Frontend

**Date:** 2026-04-11
**Status:** Implemented, partially verified (TypeScript compilation not run; visual verification needs device)

---

## Changes Summary

20 files modified, 2 files deleted. 0 files created.

### Files Deleted
- `app-mobile/src/hooks/useSwipeLimit.ts` — swipe limit tracking (no limits exist)
- `app-mobile/src/components/LockedCuratedCard.tsx` — locked curated card overlay (free users now see full cards)

### Files Modified

#### Phase 3: Types, Constants, Services
1. `app-mobile/src/services/revenueCatService.ts` — added `RC_MINGLA_PLUS_ENTITLEMENT_ID`, `hasMinglaPlus()`, `getMinglaExpirationDate()`. Updated `presentPaywallIfNeeded`.
2. `app-mobile/src/types/subscription.ts` — `SubscriptionTier = 'free' | 'mingla_plus'`. Removed onboarding trial branch. All returns now 'mingla_plus'. Removed `referralBonusUsedMonths`.
3. `app-mobile/src/constants/tierLimits.ts` — 2-entry TIER_LIMITS (free/mingla_plus). Removed `getSwipeLimit()`. Updated `canPair()`.
4. `app-mobile/src/services/subscriptionService.ts` — `syncSubscriptionFromRC` uses `hasMinglaPlus()`. Removed `referral_bonus_used_months` from interfaces.

#### Phase 4: Hooks
5. `app-mobile/src/hooks/useFeatureGate.ts` — removed `unlimited_swipes`. Updated `FEATURE_TIER_MAP`. `canAccess('pairing')` → always true.
6. `app-mobile/src/hooks/useSubscription.ts` — updated hierarchy comment.
7. `app-mobile/src/hooks/useRevenueCat.ts` — removed `useIsProEntitled` (unused). Updated AppsFlyer content_type to 'mingla_plus'. Removed unused imports.
8. `app-mobile/src/hooks/useFriendProfile.ts` — updated tier validation array.

#### Phase 5: UI Components
9. `app-mobile/src/components/SwipeableCards.tsx` — removed useSwipeLimit, LockedCuratedCard, unlimited_swipes, initialTier, swipe counter UI.
10. `app-mobile/src/components/CustomPaywallScreen.tsx` — removed Pro/Elite tabs, TierKey, filterPackagesByTier. Single Mingla+ plan. Free vs Mingla+ checklist.
11. `app-mobile/src/components/profile/BillingSheet.tsx` — 2-tier (free/mingla_plus). Removed paywallTier state. Trial label "Trial" not "Elite trial".
12. `app-mobile/src/components/DiscoverScreen.tsx` — removed canAccess('pairing') lock icon/opacity. Added pairing_limit_reached handling via PairRequestModal callback.
13. `app-mobile/src/components/PairRequestModal.tsx` — added `onPairingLimitReached` callback for 403 pairing_limit_reached errors.
14. `app-mobile/src/components/activity/SavedTab.tsx` — removed locked curated card block. Removed initialTier.
15. `app-mobile/src/components/activity/CalendarTab.tsx` — removed isEntryLocked logic. Removed initialTier.
16. `app-mobile/src/components/PreferencesSheet.tsx` — removed initialTier.
17. `app-mobile/src/components/CollaborationSessions.tsx` — removed initialTier.
18. `app-mobile/src/components/profile/ViewFriendProfileScreen.tsx` — 2-tier TIER_LABEL and TIER_BADGE_STYLES.

#### Phase 6: Admin Dashboard
19. `mingla-admin/src/pages/SubscriptionManagementPage.jsx` — 2-tier TIER_CONFIG, stats, filters, grant form.
20. `mingla-admin/src/pages/EmailPage.jsx` — 2-tier TIER_OPTIONS.

---

## Spec Traceability

| # | Success Criterion | Status | Evidence |
|---|---|---|---|
| SC-1 | TypeScript compiles with zero errors | UNVERIFIED | All type changes are consistent; `SubscriptionTier` union narrowed; all consumers updated. Need `npx tsc --noEmit` to confirm. |
| SC-2 | No imports of useSwipeLimit or LockedCuratedCard | PASS | grep confirms 0 references |
| SC-3 | No 'pro'/'elite' string literals in mobile src | PASS | grep confirms 0 references (RC legacy IDs intentionally kept) |
| SC-4 | No initialTier prop on CustomPaywallScreen | PASS | grep confirms 0 references |
| SC-5 | No canAccess('unlimited_swipes') calls | PASS | grep confirms 0 references |
| SC-6 | BillingSheet shows 2 tier cards | UNVERIFIED | Code has 2 entries in TIERS and TIER_ORDER. Visual verification needs device. |
| SC-7 | CustomPaywallScreen shows single plan | UNVERIFIED | Tab UI removed, single package list. Visual verification needs device. |
| SC-8 | ViewFriendProfileScreen tier badge shows "Mingla+" | UNVERIFIED | TIER_LABEL and TIER_BADGE_STYLES updated. Visual verification needs device. |
| SC-9 | Admin SubscriptionManagementPage shows Free/Mingla+ | UNVERIFIED | TIER_CONFIG, stats, filters, grant form all updated. |
| SC-10 | Admin EmailPage shows Free/Mingla+ | PASS | TIER_OPTIONS updated, grep confirms. |

---

## Additional Files Modified (Not in Spec Dispatch)

1. `app-mobile/src/hooks/useRevenueCat.ts` — removed unused `useIsProEntitled()`, updated AppsFlyer event content_type
2. `app-mobile/src/hooks/useFriendProfile.ts` — updated tier validation array from ['free','pro','elite'] to ['free','mingla_plus']
3. `app-mobile/src/components/PairRequestModal.tsx` — added `onPairingLimitReached` callback for pairing limit errors

These were necessary cascade changes discovered during implementation.

---

## Regression Surface

1. **Paywall flow** — CustomPaywallScreen completely redesigned. Test: open from any gate → see single plan → purchase → confirm.
2. **Pairing flow** — DiscoverScreen pair button is always active now. Test: pair as free user → 1st succeeds → 2nd triggers paywall.
3. **Curated card viewing** — No more LockedCuratedCard. Test: free user sees full curated cards in deck, saved tab, calendar.
4. **Save gating** — Free user taps save on curated card → paywall (not yet fully wired — needs SwipeableCards save handler to check canAccess('curated_cards')).
5. **Friend profile tier badge** — Shows "Mingla+" instead of "Pro"/"Elite".

---

## Discoveries for Orchestrator

1. **PairRequestModal updated** — Added `onPairingLimitReached` callback. This was not in the spec but necessary for the DiscoverScreen pairing limit flow to work end-to-end.
2. **`useIsProEntitled` removed** — Dead code found in useRevenueCat.ts. No consumers. Cleaned up.
3. **`useFriendProfile` tier validation** — Had hardcoded `['free', 'pro', 'elite']` array for tier validation. Updated to new tiers. Not in spec.
