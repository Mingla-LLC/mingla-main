# FORENSIC REPORT: ORCH-0372 — Price Tier Restructure Blast Radius

**Date:** 2026-04-10
**Investigator:** Forensics Agent
**Confidence:** HIGH (every file read, every line number verified)
**Classification:** Architecture change — not a bug fix

---

## Layman Summary

Mingla's entire subscription system — from the database that stores what tier you're on, to the server functions that check if you're allowed to pair or create sessions, to every screen in the app that shows a lock icon or an upgrade button — is built around three tiers: Free, Pro, and Elite. You're collapsing that to two: Free and Mingla+.

This touches ~35 files across all three codebases. Most changes are renames ("pro"/"elite" → "mingla_plus"), but four changes are structural: swipes become unlimited for free users, pairing changes from a binary gate to a count-based gate, curated cards change from fully locked to view-only for free users, and the trial model shifts from automatic to contextual.

---

## File-by-File Inventory

### Domain 1: Database (supabase/migrations/) — 10 files

#### F-01: `20260309000001_subscriptions.sql`
- **Lines 12:** `tier TEXT NOT NULL DEFAULT 'free' CHECK (tier IN ('free', 'pro', 'elite'))`
- **Lines 59-87:** `get_effective_tier()` — first version (superseded by later migrations but defines the table)
- **Lines 93-109:** `create_subscription_on_onboarding_complete()` — sets `trial_ends_at = NOW() + '7 days'`
- **Current behavior:** Table accepts only 'free', 'pro', 'elite'. Trigger grants 7-day trial at onboarding completion.
- **Required change:** CHECK constraint → `('free', 'mingla_plus')`. Trial duration → TBD (14 days contextual).
- **Risk:** HIGH — this is the foundational table. Must migrate existing data.
- **Confidence:** H

#### F-02: `20260315000007_tier_gating_infrastructure.sql`
- **Lines 4-12:** `daily_swipe_counts` table (tracks per-day swipe usage)
- **Lines 42-73:** `increment_daily_swipe_count()` — Line 54: `IF v_tier IN ('pro', 'elite') THEN v_limit := -1`
- **Lines 79-113:** `get_remaining_swipes()` — Line 89: `IF v_tier IN ('pro', 'elite') THEN remaining := -1`
- **Lines 118-155:** `get_tier_limits()` — CASE with three branches:
  - `'free'`: dailySwipes=20, maxPairings=0, maxSessions=1, maxSessionMembers=5, curatedCards=false, customStart=false
  - `'pro'`: dailySwipes=-1, maxPairings=0, maxSessions=3, maxSessionMembers=5, curatedCards=true, customStart=true
  - `'elite'`: dailySwipes=-1, maxPairings=-1, maxSessions=-1, maxSessionMembers=15, curatedCards=true, customStart=true
- **Current behavior:** Three-way CASE statement. Free users get 20 swipes/day.
- **Required change:** Collapse to two branches. New free limits: dailySwipes=-1, maxPairings=2, maxSessions=1, maxSessionMembers=3, curatedCards=**TBD** (viewable but not saveable — needs new field?), customStart=false. New mingla_plus: dailySwipes=-1, maxPairings=-1, maxSessions=-1, maxSessionMembers=15, curatedCards=true, customStart=true.
- **Risk:** HIGH — single source of truth for all feature limits.
- **Confidence:** H

#### F-03: `20260315000008_session_creation_limits.sql`
- **Lines 4-36:** `check_session_creation_allowed()` — Uses `get_tier_limits()`, no direct tier string references. Will work once `get_tier_limits` is updated.
- **Lines 41-54:** `check_pairing_allowed()` — Line 50: `allowed := (v_tier = 'elite')` — BINARY gate.
- **Lines 59-70:** `get_session_member_limit()` — Uses `get_tier_limits()`, no direct tier strings.
- **Current behavior:** Pairing is elite-only (boolean). Session/member limits read from `get_tier_limits`.
- **Required change:** `check_pairing_allowed` must change from binary to count-based: free gets 2 active pairings, mingla_plus gets unlimited. Needs to return `{ allowed, current_count, max_allowed, tier }` like session gate does. Also needs a `max_pairings` field in `get_tier_limits` that's > 0 for free.
- **Risk:** HIGH — structural change from binary to count-based gate.
- **Confidence:** H

#### F-04: `20260315000009_session_creation_trigger.sql`
- **Lines 10-28:** `enforce_session_creation_limit()` — DB trigger that calls `check_session_creation_allowed()`.
- **Current behavior:** Blocks INSERT on collaboration_sessions if limit reached.
- **Required change:** None — it delegates to the RPC which delegates to `get_tier_limits`. Cascading fix.
- **Risk:** LOW
- **Confidence:** H

#### F-05: `20260315000021_fix_trial_timing_for_onboarding.sql`
- **Lines 16-23:** `create_subscription_on_signup()` — inserts `tier='free', trial_ends_at=NULL`
- **Lines 32-55:** `create_subscription_on_onboarding_complete()` — stamps `trial_ends_at = NOW() + '7 days'`
- **Lines 60-101:** `get_effective_tier()` — trial resolution:
  - Line 78-79: active trial → `'elite'`
  - Line 84-91: onboarding trial (NULL trial_ends_at + not onboarded) → `'elite'`
  - Line 95-96: referral bonus → `'elite'`
- **Current behavior:** Auto-trial at onboarding completion, 7 days, grants elite.
- **Required change:** All `'elite'` returns → `'mingla_plus'`. Trial duration → 14 days (if keeping auto-start). If contextual trigger, the `create_subscription_on_onboarding_complete` trigger changes significantly.
- **Risk:** HIGH — trial model architectural decision pending.
- **Confidence:** H

#### F-06: `20260317100001_create_admin_subscription_overrides.sql`
- **Line 11:** `tier TEXT NOT NULL CHECK (tier IN ('free', 'pro', 'elite'))`
- **Line 104:** `CASE tier WHEN 'elite' THEN 3 WHEN 'pro' THEN 2 ELSE 1 END DESC` (priority ordering)
- **Lines 85-147:** `get_effective_tier()` — admin override version:
  - Line 121: `IF v_sub.tier IN ('pro', 'elite')` — paid sub check
  - Line 133: onboarding trial → `'elite'`
  - Line 137: active trial → `'elite'`
  - Line 142: referral bonus → `'pro'` (BUG — fixed in later migration to 'elite')
- **Lines 153-224:** `admin_list_subscriptions()` — Line 210: tier priority ORDER BY with 'elite'/'pro'
- **Lines 230-284:** `admin_grant_override()` — Line 253: `IF p_tier NOT IN ('free', 'pro', 'elite')`
- **Current behavior:** Admin overrides table and RPCs hardcoded to 3-tier model.
- **Required change:** CHECK constraint → `('free', 'mingla_plus')`. Tier validation → `('free', 'mingla_plus')`. Priority ordering → single non-free tier. All 'elite'/'pro' returns → 'mingla_plus'.
- **Risk:** MEDIUM — admin-facing, not user-facing. Can deploy independently.
- **Confidence:** H

#### F-07: `20260317210001_admin_analytics_rpcs.sql`
- **Lines 8-24:** `admin_subscription_stats()`:
  - Line 16: `'pro', (SELECT count(*) ... get_effective_tier(p.id) = 'pro')`
  - Line 17: `'elite', (SELECT count(*) ... get_effective_tier(p.id) = 'elite')`
- **Current behavior:** Returns counts for free/pro/elite.
- **Required change:** Replace `'pro'` and `'elite'` keys with single `'mingla_plus'` count.
- **Risk:** LOW — analytics only.
- **Confidence:** H

#### F-08: `20260320000002_fix_admin_subscription_stats.sql`
- **Lines 4-22:** Corrected `admin_subscription_stats()` — same tier references as F-07.
- **Required change:** Same as F-07 — this is the ACTIVE version (supersedes F-07).
- **Risk:** LOW
- **Confidence:** H

#### F-09: `20260331000001_fix_referral_tier_elite.sql`
- **Lines 6-68:** `get_effective_tier()` — fixes referral bonus to return `'elite'` (was `'pro'`).
  - Line 25: `CASE tier WHEN 'elite' THEN 3 WHEN 'pro' THEN 2 ELSE 1 END`
  - Line 42: `IF v_sub.tier IN ('pro', 'elite')`
  - Line 54: onboarding trial → `'elite'`
  - Line 58: active trial → `'elite'`
  - Line 63: referral bonus → `'elite'`
- **Current behavior:** Superseded by F-10.
- **Required change:** Will be superseded by new migration.
- **Risk:** LOW — not the active version.
- **Confidence:** H

#### F-10: `20260331000002_referral_bonus_expiry.sql` (ACTIVE VERSION of get_effective_tier)
- **Lines 131-196:** `get_effective_tier()` — THE AUTHORITATIVE VERSION:
  - Line 150: `CASE tier WHEN 'elite' THEN 3 WHEN 'pro' THEN 2 ELSE 1 END` (admin override ordering)
  - Line 167: `IF v_sub.tier IN ('pro', 'elite')` (paid sub check)
  - Line 179: onboarding trial → `'elite'`
  - Line 183: active trial → `'elite'`
  - Line 191: referral bonus → `'elite'`
- **Lines 30-126:** `credit_referral_on_friend_accepted()` — no tier strings, just increments months.
- **Current behavior:** Returns 'elite' for all non-free states. Priority: admin override > paid > onboarding trial > active trial > referral > free.
- **Required change:** All `'elite'`/`'pro'` → `'mingla_plus'`. Admin override ordering simplified to `CASE tier WHEN 'mingla_plus' THEN 2 ELSE 1 END`.
- **Risk:** HIGH — this is the authoritative tier resolution function.
- **Confidence:** H

#### F-11: `20260331000003_trial_abuse_prevention.sql`
- **Lines 87-133:** `create_subscription_on_onboarding_complete()` with phone hash check.
  - Line 109: `trial_ends_at = NOW() + INTERVAL '7 days'` (first-time user)
  - Line 103: `trial_ends_at = NOW()` (repeat user — immediate expiry)
- **Current behavior:** 7-day trial for first-time users, blocked for repeat.
- **Required change:** Duration → 14 days (if keeping auto-start). If contextual trial, this trigger changes significantly — it may no longer stamp trial_ends_at on onboarding completion at all.
- **Risk:** HIGH — trial model decision required.
- **Confidence:** H

---

### Domain 2: Edge Functions (supabase/functions/) — 3 files

#### F-12: `send-pair-request/index.ts`
- **Line 76:** `// --- TIER GATING: Pairing is Elite-only ---`
- **Line 78:** `supabase.rpc('check_pairing_allowed', { p_user_id: senderId })`
- **Line 82:** `error: 'elite_required'`
- **Line 84:** `message: 'Pairing is an Elite feature. Upgrade to connect with people.'`
- **Current behavior:** Returns 403 with `elite_required` error code.
- **Required change:** Error code → `'upgrade_required'` (or `'mingla_plus_required'`). Copy → `'Pairing with more than 2 people is a Mingla+ feature.'` But also: free users CAN pair (up to 2), so the gate logic must change — only block when they exceed 2 active pairings.
- **Risk:** HIGH — behavioral change, not just rename.
- **Confidence:** H

#### F-13: `process-referral/index.ts`
- **Line 185:** `title: "You earned Elite time!"`
- **Line 186:** `body: \`${referredName} joined Mingla! You earned 1 month of Elite.\``
- **Current behavior:** Push notification with "Elite" copy.
- **Required change:** Copy → "You earned Mingla+ time!" / "1 month of Mingla+."
- **Risk:** LOW — cosmetic.
- **Confidence:** H

#### F-14: `discover-cards/index.ts`
- **Line 536:** `supabase.rpc('get_effective_tier', { p_user_id: userId })`
- **Line 535:** `supabase.rpc('get_remaining_swipes', { p_user_id: userId })`
- **Current behavior:** Fetches tier and swipe data to include in response.
- **Required change:** None directly — it reads whatever the RPC returns. But if swipe limits are removed for free users, the `get_remaining_swipes` call may become unnecessary.
- **Risk:** LOW
- **Confidence:** H

---

### Domain 3: Mobile App (app-mobile/src/) — 18 files

#### F-15: `types/subscription.ts`
- **Line 8:** `export type SubscriptionTier = 'free' | 'pro' | 'elite'`
- **Lines 56-61:** `getEffectiveTierFromRC()` — checks `hasEliteEntitlement` then `hasProEntitlement`
- **Lines 81-125:** `getEffectiveTierFromSupabase()` — returns `'elite'` for trial/referral
- **Lines 143-152:** `getEffectiveTier()` — combines RC + Supabase
- **Lines 195-197:** `hasElevatedAccess()` — `tier === 'pro' || tier === 'elite'`
- **Required change:** Type → `'free' | 'mingla_plus'`. All `'elite'`/`'pro'` → `'mingla_plus'`. `hasElevatedAccess` → `tier === 'mingla_plus'`. Must map BOTH old RC entitlements to `'mingla_plus'`.
- **Risk:** HIGH — cascading type change.
- **Confidence:** H

#### F-16: `constants/tierLimits.ts`
- **Lines 16-41:** `TIER_LIMITS` Record with three entries.
- **Line 60:** `canPair(tier)` → `return tier === 'elite'`
- **Required change:** Collapse to two entries. Free: dailySwipes=-1, maxPairings=2, maxSessions=1, maxSessionMembers=3, curatedCards=**TBD**, customStart=false. MinglaPlus: dailySwipes=-1, maxPairings=-1, maxSessions=-1, maxSessionMembers=15, curatedCards=true, customStart=true. `canPair` → needs nuance (free can pair up to 2).
- **Risk:** HIGH — single source of truth client-side.
- **Confidence:** H

#### F-17: `services/revenueCatService.ts`
- **Line 22:** `RC_PRO_ENTITLEMENT_ID = 'Mingla Pro'`
- **Line 23:** `RC_ELITE_ENTITLEMENT_ID = 'Mingla Elite'`
- **Lines 84-93:** `hasProEntitlement()`, `hasEliteEntitlement()`
- **Lines 98-99:** `hasAnyEntitlement()` — checks both
- **Lines 106-120:** `getProExpirationDate()`, `getEliteExpirationDate()`
- **Line 222:** `presentPaywallIfNeeded()` — uses `RC_PRO_ENTITLEMENT_ID`
- **Required change:** Add `RC_MINGLA_PLUS_ENTITLEMENT_ID = 'Mingla Plus'` (must match RC dashboard). Keep old IDs for backward compat. Create `hasMinglaPlus()` that checks new + both old entitlements. Update `presentPaywallIfNeeded` to use new entitlement.
- **Risk:** HIGH — RC entitlement ID must match dashboard exactly.
- **Confidence:** H

#### F-18: `services/subscriptionService.ts`
- **Line 4:** imports `hasProEntitlement, hasEliteEntitlement, getProExpirationDate, getEliteExpirationDate`
- **Line 152:** `tier: isElite ? 'elite' : isPro ? 'pro' : 'free'`
- **Required change:** `tier: hasMinglaPlus ? 'mingla_plus' : 'free'` (where hasMinglaPlus = hasElite || hasPro || hasNewEntitlement).
- **Risk:** HIGH — writes tier to Supabase.
- **Confidence:** H

#### F-19: `hooks/useFeatureGate.ts`
- **Lines 30-36:** `FEATURE_TIER_MAP`:
  - `curated_cards: 'pro'`
  - `custom_starting_point: 'pro'`
  - `pairing: 'elite'`
  - `session_creation: 'free'`
  - `unlimited_swipes: 'pro'`
- **Line 62:** `return tier === 'elite'` (pairing gate)
- **Required change:** All `'pro'`/`'elite'` → `'mingla_plus'`. Pairing: `tier === 'elite'` → needs nuance (free can pair up to 2, so `canAccess('pairing')` should return true for everyone; the LIMIT is what differs). `unlimited_swipes` → becomes `'free'` (everyone has unlimited now).
- **Risk:** HIGH — controls all feature gates.
- **Confidence:** H

#### F-20: `hooks/useSubscription.ts`
- **Line 85:** Comment: `Hierarchy: elite > pro > free`
- **Line 117-118:** `serverTier as SubscriptionTier` — trusts server string
- **Line 135:** `hasElevatedAccess(tier)` — delegates to type helper
- **Required change:** Comments update. Type cast will work once `SubscriptionTier` type changes. `useIsUpgraded` → works via `hasElevatedAccess`.
- **Risk:** LOW — mostly passthrough.
- **Confidence:** H

#### F-21: `hooks/useSwipeLimit.ts`
- **Line 43:** Comment: `Pro/Elite users are unlimited`
- **Lines 45-161:** Full swipe tracking hook with AsyncStorage + RPC.
- **Current behavior:** Tracks daily swipes for free users (limit 20).
- **Required change:** With free swipes now unlimited, this hook's limiting logic becomes dead code. The hook still works (limit=-1 → isUnlimited=true → `recordSwipe` always returns allowed), but the local storage tracking, server sync, and hydration logic run for no purpose.
- **Risk:** LOW — functionally harmless once tier limits set free to -1.
- **Confidence:** H

#### F-22: `hooks/useSessionCreationGate.ts`
- **Lines 18-52:** Calls `check_session_creation_allowed` RPC.
- **Required change:** None directly — reads from RPC. Will work once server-side limits updated.
- **Risk:** LOW
- **Confidence:** H

#### F-23: `hooks/useCreatorTier.ts`
- **Lines 16-30:** Calls `get_effective_tier` RPC, casts to `SubscriptionTier`.
- **Required change:** Type cast will work once type changes.
- **Risk:** LOW
- **Confidence:** H

#### F-24: `components/LockedCuratedCard.tsx`
- **Line 93:** `<Text style={styles.ctaText}>Unlock with Pro</Text>`
- **Lines 39-97:** Full blurred/locked overlay component.
- **Current behavior:** Shows blurred card with "Unlock with Pro" CTA. Free users cannot see the card content.
- **Required change:** Copy → "Unlock with Mingla+". BUT: new model says free users CAN see curated cards, just can't save them. This component's entire purpose changes — it may need to become a "save gate" rather than a "view gate". The blur overlay should be removed; instead, the save/bookmark button should be gated.
- **Risk:** HIGH — behavioral change, not just rename.
- **Confidence:** H

#### F-25: `components/profile/BillingSheet.tsx`
- **Lines 41-75:** `TIERS` Record with free/pro/elite configs (name, icon, description, perks)
- **Lines 77-79:** `TIER_ORDER: ["free", "pro", "elite"]`, `TIER_RANK: { free: 0, pro: 1, elite: 2 }`
- **Lines 83-87:** `getCtaLabel()` — references "Pro" and "Elite" by name
- **Line 113:** `paywallTier` state: `"pro" | "elite"`
- **Line 121:** `setPaywallTier(tier as "pro" | "elite")`
- **Line 331:** `Elite trial` (trial progress label)
- **Required change:** Collapse to two tiers. Remove pro config. Rename elite to mingla_plus. Update TIER_ORDER, TIER_RANK, CTA labels, perks text, trial label.
- **Risk:** MEDIUM — UI-only, but significant rewrite.
- **Confidence:** H

#### F-26: `components/CustomPaywallScreen.tsx`
- **Line 35:** `initialTier?: 'pro' | 'elite'`
- **Lines 56-67:** `FEATURE_CHECKLIST` with pro/elite boolean columns
- **Line 73:** `type TierKey = 'pro' | 'elite'`
- **Lines 143-152:** `proPackages` / `elitePackages` filtering by product ID substring
- **Lines 248-268:** Pro/Elite tab selector UI
- **Lines 273, 296, 324:** Conditional styling based on `selectedTier === 'pro'`
- **Current behavior:** Two-tab paywall comparing Pro vs Elite features.
- **Required change:** Complete redesign — single Mingla+ tier, no tabs. Show Free vs Mingla+ comparison instead. Remove TierKey type, simplify to single package list. Product ID filtering → match new RC product IDs.
- **Risk:** HIGH — major UI rewrite.
- **Confidence:** H

#### F-27: `components/SwipeableCards.tsx`
- **Line 1086:** `canAccess('curated_cards')` check for curated cards
- **Line 1836:** `canAccess('curated_cards')` — shows LockedCuratedCard or real card
- **Line 2042:** `initialTier={paywallFeature === 'pairing' ? 'elite' : 'pro'}`
- **Required change:** `initialTier` → no longer needed (single paid tier). Curated card gate logic changes — free users see the card but can't save it.
- **Risk:** MEDIUM
- **Confidence:** H

#### F-28: `components/DiscoverScreen.tsx`
- **Lines 3366-3383:** `canAccess('pairing')` checks for pair button UI (locked icon, opacity)
- **Line 3715:** `canAccess('pairing')` — conditional render
- **Line 4055:** `initialTier={paywallFeature === 'pairing' ? 'elite' : 'pro'}`
- **Required change:** Pairing gate changes — free users CAN pair (up to 2), so the lock icon should only show when at max pairings. `initialTier` → remove (single tier).
- **Risk:** MEDIUM — behavioral change in pairing UI.
- **Confidence:** H

#### F-29: `components/activity/SavedTab.tsx`
- **Line 1667:** `if (!canAccess('curated_cards'))` — gates curated card viewing
- **Line 2173:** `initialTier="pro"`
- **Required change:** Curated card gate changes — free users can view but not save. `initialTier` → remove.
- **Risk:** MEDIUM
- **Confidence:** H

#### F-30: `components/activity/CalendarTab.tsx`
- **Line 1257:** `const isEntryLocked = isEntryCurated && !canAccess('curated_cards')`
- **Line 1904:** `initialTier="pro"`
- **Required change:** Same as SavedTab — view unlocked, save gated. `initialTier` → remove.
- **Risk:** MEDIUM
- **Confidence:** H

#### F-31: `components/PreferencesSheet.tsx`
- **Line 228:** `if (!canAccess('custom_starting_point') && !useGpsLocation)`
- **Line 932:** `isCuratedLocked={!canAccess('curated_cards')}`
- **Line 1050:** `isLocked={!canAccess('custom_starting_point')}`
- **Line 1132:** `initialTier="pro"`
- **Required change:** Lock logic flows through hooks — will update when hooks change. `initialTier` → remove.
- **Risk:** LOW
- **Confidence:** H

#### F-32: `components/CollaborationSessions.tsx`
- **Line 950:** `initialTier="pro"`
- **Required change:** `initialTier` → remove.
- **Risk:** LOW
- **Confidence:** H

#### F-33: `components/profile/ViewFriendProfileScreen.tsx`
- **Lines 21-25:** `TIER_LABEL: { free: 'Free', pro: 'Pro', elite: 'Elite' }`
- **Lines 27-34:** `TIER_BADGE_STYLES: { free: {...}, pro: {...}, elite: {...} }`
- **Lines 169-170:** Display logic using these maps
- **Required change:** Remove `pro`/`elite` entries → add `mingla_plus` with appropriate styling.
- **Risk:** LOW — display only.
- **Confidence:** H

---

### Domain 4: Admin Dashboard (mingla-admin/src/) — 2 files

#### F-34: `pages/SubscriptionManagementPage.jsx`
- **Line 39:** `TIER_CONFIG = { free: {...}, pro: {...}, elite: {...} }`
- **Line 67:** `tierFilter` state
- **Line 72:** `stats: { total: 0, free: 0, pro: 0, elite: 0, overrides: 0 }`
- **Line 81:** `grantForm: { tier: "pro", ... }`
- **Line 170:** `elite: s.elite ?? 0`
- **Lines 196-198:** `free/pro/elite` filter counts
- **Line 523:** `StatCard label="Elite"`
- **Line 540:** `[null, "free", "pro", "elite"].map(...)` — filter buttons
- **Lines 609-623:** Grant modal tier selection buttons
- **Line 650:** Warning for free override
- **Required change:** TIER_CONFIG → `{ free: {...}, mingla_plus: {...} }`. Stats → `{ free, mingla_plus, overrides }`. Filter buttons → `[null, "free", "mingla_plus"]`. Grant form default → `"mingla_plus"`.
- **Risk:** MEDIUM
- **Confidence:** H

#### F-35: `pages/EmailPage.jsx`
- **Lines 44-47:** `TIER_OPTIONS = [{ value: "free", label: "Free" }, { value: "pro", label: "Pro" }, { value: "elite", label: "Elite" }]`
- **Line 164:** Segment state with `tier` field
- **Lines 595-600:** Tier selection buttons in email composer
- **Required change:** `TIER_OPTIONS` → `[{ value: "free", label: "Free" }, { value: "mingla_plus", label: "Mingla+" }]`.
- **Risk:** LOW
- **Confidence:** H

---

## Trial System — Complete Flow Map

### Current Flow
1. **Signup** → `create_subscription_on_signup()` trigger → inserts subscription row with `tier='free', trial_ends_at=NULL`
2. **During onboarding** → `get_effective_tier()` sees `trial_ends_at=NULL` + `has_completed_onboarding=false` → returns `'elite'` (full access during onboarding)
3. **Onboarding complete** → `create_subscription_on_onboarding_complete()` trigger → stamps `trial_ends_at = NOW() + 7 days`
4. **Post-onboarding 7 days** → `get_effective_tier()` sees `trial_ends_at > NOW()` → returns `'elite'`
5. **Trial expires** → `get_effective_tier()` falls through → returns `'free'`
6. **Trial expiry tracking** → `useTrialExpiryTracking()` hook fires `trial_expired_no_conversion` AppsFlyer event exactly once
7. **Trial abuse prevention** → `used_trial_phones` table + `phone_has_used_trial()` → repeat signups get `trial_ends_at = NOW()` (immediate expiry)

### Key Files
- `20260315000021_fix_trial_timing_for_onboarding.sql` — trial timing logic
- `20260331000003_trial_abuse_prevention.sql` — phone hash prevention
- `20260331000002_referral_bonus_expiry.sql` — authoritative `get_effective_tier()`
- `app-mobile/src/types/subscription.ts` — client-side trial resolution
- `app-mobile/src/hooks/useSubscription.ts` — `useTrialExpiryTracking()`, `useTrialDaysRemaining()`
- `app-mobile/src/components/profile/BillingSheet.tsx` — trial progress bar UI

### What Must Change
The new model: **14-day trial triggered contextually when user hits a free-tier limit**, not automatically on onboarding completion. This means:
- The `create_subscription_on_onboarding_complete` trigger may stop setting `trial_ends_at`
- A new mechanism is needed: "start trial" RPC called when user hits a limit
- `get_effective_tier()` trial logic stays the same (checks `trial_ends_at > NOW()`)
- The 14-day duration replaces 7-day
- Trial abuse prevention stays — just the trigger point changes

---

## Referral System — Complete Flow Map

### Current Flow
1. User A refers User B via referral code
2. User B signs up → `referral_credits` row created (status='pending')
3. User B accepts friend request from A → `credit_referral_on_friend_accepted()` trigger fires
4. Trigger: increments `subscriptions.referral_bonus_months`, sets/preserves `referral_bonus_started_at`
5. `get_effective_tier()` checks: `referral_bonus_months > 0 AND started_at + (months * 30 days) > NOW()` → returns `'elite'`
6. `process-referral` edge function sends push: "You earned Elite time!"

### Key Files
- `20260309000003_referral_credits.sql` — table + trigger
- `20260331000002_referral_bonus_expiry.sql` — date-based expiry, trigger update
- `supabase/functions/process-referral/index.ts` — notification copy
- `app-mobile/src/types/subscription.ts` — `getReferralDaysRemaining()`
- `app-mobile/src/hooks/useSubscription.ts` — `useReferralDaysRemaining()`

### What Must Change
- `get_effective_tier()` referral branch: `'elite'` → `'mingla_plus'`
- `process-referral` notification copy: "Elite" → "Mingla+"
- Client-side: type changes cascade automatically

---

## Behavioral Change Matrix

| Feature | Old Free | New Free | Change Type |
|---------|----------|----------|-------------|
| **Daily swipes** | 20/day (limited, tracked) | Unlimited | Removal of limiting — `daily_swipe_counts` infrastructure becomes dormant |
| **Pairing** | Blocked (0 allowed) | Up to 2 active pairings | Binary gate → count-based gate. `check_pairing_allowed` must be rewritten. |
| **Curated cards** | Blurred + locked (can't see content) | Viewable but can't save | `LockedCuratedCard` component purpose changes entirely. Gate moves from view to save action. |
| **Session members** | 5 max | 3 max | **REDUCTION** — existing free users with 4-5 member sessions will be over limit. Need migration strategy. |
| **Trial trigger** | Auto on onboarding (7 days) | Contextual on limit-hit (14 days) | Architectural shift in trigger mechanism |

| Feature | Old Pro | Old Elite | New Mingla+ | Notes |
|---------|---------|-----------|-------------|-------|
| Swipes | Unlimited | Unlimited | Unlimited | No change |
| Pairings | 0 | Unlimited | Unlimited | Pro couldn't pair — absorbed by Mingla+ |
| Sessions | 3 | Unlimited | Unlimited | Takes Elite's unlimited |
| Members | 5 | 15 | 15 | Takes Elite's 15 |
| Curated | Yes | Yes | Full + save | No change |
| Custom start | Yes | Yes | Yes | No change |

---

## Dead Code Identification

| Code | Status After Migration |
|------|----------------------|
| `daily_swipe_counts` table | Dormant — still works but free=-1 means no rows hit the limit |
| `increment_daily_swipe_count()` RPC | Still called but v_limit=-1 for all users → always returns is_limited=false |
| `get_remaining_swipes()` RPC | Returns remaining=-1 for all users |
| `useSwipeLimit` hook — AsyncStorage tracking | Still runs but isUnlimited=true for all → early-returns everywhere |
| `discover-cards` get_remaining_swipes call | Returns -1 for everyone |
| Pro/Elite tab switcher in CustomPaywallScreen | Dead — only one paid tier |
| `FEATURE_CHECKLIST` with pro/elite columns | Dead — replaced by Free/Mingla+ comparison |
| `filterPackagesByTier('pro')` / `filterPackagesByTier('elite')` | Dead — single product line |

---

## Backward Compatibility Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Existing Pro/Elite subscribers in RevenueCat still have old entitlements | Users could lose access if code only checks new entitlement ID | `hasMinglaPlus()` must check new ID AND both old IDs (`'Mingla Pro'` + `'Mingla Elite'`) |
| `syncSubscriptionFromRC()` writes tier to Supabase | If old entitlement → writes 'pro'/'elite' → CHECK constraint rejects | CHECK must accept old values OR sync must map old entitlements to 'mingla_plus' before writing |
| Cached `serverTier` returns old strings | React Query cache may hold 'pro'/'elite' for up to 60s | Type cast `as SubscriptionTier` will break if type excludes old values. Need transitional type or cache invalidation on deploy. |
| Free users with 4-5 member sessions | Session member limit dropping from 5 to 3 | Existing sessions must be grandfathered — don't eject members, just prevent adding new ones beyond 3 |
| Admin overrides with 'pro'/'elite' tier | Data in `admin_subscription_overrides` table | Data migration: UPDATE all to 'mingla_plus' |

---

## Open Questions (Decisions Required Before Spec)

1. **Trial trigger model:** Auto-start on onboarding (current, just extend to 14 days) vs. contextual trigger when user hits a limit? The latter requires a new "start trial" RPC and client-side trigger logic.

2. **Tier string in DB:** `'mingla_plus'` (SQL-safe) or `'plus'` (shorter)? Must match RevenueCat entitlement ID convention.

3. **Curated cards "see but can't save":** What exactly changes? Options:
   - (A) Remove blur/lock overlay, show full card, disable save button with "Upgrade to save" tooltip
   - (B) Show card with save button that opens paywall on tap
   - (C) Something else?

4. **Swipe tracking infrastructure:** Keep dormant (set free limit to -1, table/RPCs still exist) or remove entirely (drop table, remove RPCs, remove hook)?

5. **Pairing "up to 2 people":** 2 simultaneous active pairings, or 2 pair requests lifetime? (Assuming simultaneous.)

6. **Free session members reduction 5→3:** Grandfather existing sessions with >3 members? Or hard-enforce on next session modification?

7. **RevenueCat entitlement ID:** What is the exact entitlement identifier configured in the RC dashboard for Mingla+?

8. **CHECK constraint strategy:** Option A: new migration with `ALTER TABLE subscriptions DROP CONSTRAINT, ADD CONSTRAINT ('free', 'mingla_plus')` (requires data migration first). Option B: widen to `('free', 'pro', 'elite', 'mingla_plus')` temporarily, data-migrate, then tighten.

---

## Dependency Graph

```
Phase 1 (MUST be first):
  New SQL migration:
    1a. Data migration: pro/elite → mingla_plus (both tables)
    1b. ALTER CHECK constraints
    1c. Recreate get_effective_tier() with mingla_plus returns
    1d. Recreate get_tier_limits() with new free/mingla_plus limits
    1e. Rewrite check_pairing_allowed() to count-based
    1f. Recreate admin RPCs (stats, grant, list)
    1g. Update trial trigger (duration + possibly trigger mechanism)

Phase 2 (after DB migration applied):
  Edge functions:
    2a. send-pair-request — error code + copy
    2b. process-referral — notification copy

Phase 3 (after Phase 1, can parallel with Phase 2):
  Mobile type system + constants:
    3a. subscription.ts — SubscriptionTier type
    3b. tierLimits.ts — TIER_LIMITS record
    3c. revenueCatService.ts — entitlement IDs + helpers

Phase 4 (after Phase 3):
  Mobile hooks:
    4a. useFeatureGate.ts — FEATURE_TIER_MAP
    4b. useSubscription.ts — comments
    4c. useSwipeLimit.ts — update or leave dormant
    4d. subscriptionService.ts — syncSubscriptionFromRC

Phase 5 (after Phase 4):
  Mobile UI:
    5a. CustomPaywallScreen.tsx — major rewrite
    5b. BillingSheet.tsx — collapse to 2 tiers
    5c. LockedCuratedCard.tsx — rename or redesign
    5d. ViewFriendProfileScreen.tsx — tier labels
    5e. All components with initialTier props

Phase 6 (can parallel with Phase 5):
  Admin dashboard:
    6a. SubscriptionManagementPage.jsx — tier config
    6b. EmailPage.jsx — tier options
```

---

## Discoveries for Orchestrator

1. **Stripe integration is a dead placeholder.** `stripe_customer_id` and `stripe_subscription_id` columns exist but no webhook handler, no payment processing. Safe to ignore for this migration.

2. **Duplicate ORCH IDs in World Map.** ORCH-0143 through ORCH-0149 appear both in Section 11 (Payments) and Section 12 (Calendar) with different content. The Calendar entries are orphaned — different issues reusing the same IDs.

3. **`referral_bonus_used_months` is deprecated** (marked by COMMENT in migration) but column still exists. Consider dropping in this migration as a cleanup.

---

## Summary

- **35 files** across 4 domains need changes
- **4 structural changes** (swipe limits, pairing gate, curated card behavior, trial model)
- **8 open decisions** before implementation can begin
- **5 backward compatibility risks** requiring specific mitigations
- **Confidence: HIGH** — every file read, every line verified
