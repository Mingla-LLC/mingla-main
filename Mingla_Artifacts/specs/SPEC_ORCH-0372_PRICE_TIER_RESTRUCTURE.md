# SPEC: ORCH-0372 — Price Tier Restructure (Free / Mingla+)

**Date:** 2026-04-11
**Author:** Forensics Agent (Spec Mode)
**Status:** Ready for implementation
**Forensic Report:** `Mingla_Artifacts/reports/FORENSIC_ORCH-0372_PRICE_TIER_BLAST_RADIUS.md`

---

## Layman Summary

Mingla is moving from three subscription tiers (Free, Pro, Elite) to two (Free, Mingla+).
Free becomes genuinely useful — unlimited swipes, 1 pairing, 1 session, full curated card
viewing. Mingla+ unlocks everything without limits. There is no trial period — the paywall
appears naturally when a free user hits a limit. This spec covers every file change across
the database, edge functions, mobile app, and admin dashboard.

---

## Scope

**In scope:**
- Database migration: tier data, CHECK constraints, all RPC functions
- Drop swipe tracking infrastructure entirely
- Deactivate trial system (keep columns, stop granting)
- Rewrite pairing gate from binary to count-based
- Update all mobile types, constants, services, hooks, UI components
- Update admin dashboard tier displays
- Backward compatibility for existing Pro/Elite/trial users

**Non-goals:**
- Redesigning the paywall visual layout (structure changes, not pixel design)
- Changing the referral bonus duration (stays at 30 days per referral)
- Touching place price tiers (chill/comfy/bougie/lavish) — completely separate system
- Stripe integration (dead placeholder, not in use)

**Assumptions:**
- Apple App Store products and RevenueCat entitlements are already configured
- RC entitlement identifier is exactly `Mingla Plus`
- No users currently have `tier = 'pro'` via RevenueCat (Pro was never purchasable separately from Elite in production). If any exist, they map to `mingla_plus`.

---

## Onboarding Decision

**During onboarding, users currently get Elite access** via `get_effective_tier()` returning
`'elite'` when `trial_ends_at IS NULL AND has_completed_onboarding = false`.

**Decision: Remove the onboarding trial grant. Users are Free during onboarding.**

Rationale: Free users can still pair with 1 person and create 1 session — this is sufficient
for the onboarding Step 5 (friends_and_pairing). The onboarding experience is not degraded
because the free tier now includes pairing (1 active). Previously pairing was elite-only,
so the onboarding grant was necessary. Now it's not.

The `get_effective_tier()` function will NO LONGER return `'mingla_plus'` for onboarding
users. The NULL-trial-ends-at-during-onboarding branch is removed.

---

## Final Tier Matrix

| Feature | Free | Mingla+ | DB field in `get_tier_limits` |
|---------|------|---------|------|
| Daily swipes | Unlimited | Unlimited | `daily_swipes = -1` |
| Active pairings | 1 | Unlimited | `max_pairings`: 1 / -1 |
| Active sessions | 1 | Unlimited | `max_sessions`: 1 / -1 |
| Session members | Unlimited | Unlimited | `max_session_members = -1` |
| Curated cards | View only | Full + save | `curated_cards_access`: false / true |
| Custom starting point | No | Yes | `custom_starting_point`: false / true |

---

## Layer 1: Database Migration

**File:** `supabase/migrations/20260411000001_price_tier_restructure.sql`

### Exact SQL

```sql
-- ============================================================
-- ORCH-0372: Price Tier Restructure
-- Migrates from 3 tiers (free/pro/elite) to 2 tiers (free/mingla_plus).
-- Removes swipe tracking infrastructure.
-- Deactivates trial grants (existing trials expire naturally).
--
-- MUST be applied BEFORE deploying updated mobile/admin code.
-- ============================================================

-- ─── Step 1: Data migration ─────────────────────────────────────────────────

UPDATE subscriptions
SET tier = 'mingla_plus', updated_at = now()
WHERE tier IN ('pro', 'elite');

UPDATE admin_subscription_overrides
SET tier = 'mingla_plus', updated_at = now()
WHERE tier IN ('pro', 'elite');

-- ─── Step 2: Tighten CHECK constraints ──────────────────────────────────────

ALTER TABLE subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_tier_check;

ALTER TABLE subscriptions
  ADD CONSTRAINT subscriptions_tier_check
  CHECK (tier IN ('free', 'mingla_plus'));

ALTER TABLE admin_subscription_overrides
  DROP CONSTRAINT IF EXISTS admin_subscription_overrides_tier_check;

ALTER TABLE admin_subscription_overrides
  ADD CONSTRAINT admin_subscription_overrides_tier_check
  CHECK (tier IN ('free', 'mingla_plus'));

-- ─── Step 3: Drop swipe tracking infrastructure ────────────────────────────

DROP TRIGGER IF EXISTS set_daily_swipe_counts_updated_at ON daily_swipe_counts;
DROP TABLE IF EXISTS daily_swipe_counts;
DROP FUNCTION IF EXISTS increment_daily_swipe_count(UUID);
DROP FUNCTION IF EXISTS get_remaining_swipes(UUID);

-- ─── Step 4: Replace get_tier_limits() ──────────────────────────────────────

CREATE OR REPLACE FUNCTION get_tier_limits(p_tier TEXT)
RETURNS JSONB
LANGUAGE plpgsql STABLE AS $$
BEGIN
  CASE p_tier
    WHEN 'mingla_plus' THEN
      RETURN jsonb_build_object(
        'daily_swipes', -1,
        'max_pairings', -1,
        'max_sessions', -1,
        'max_session_members', -1,
        'curated_cards_access', true,
        'custom_starting_point', true
      );
    ELSE
      -- Free (default)
      RETURN jsonb_build_object(
        'daily_swipes', -1,
        'max_pairings', 1,
        'max_sessions', 1,
        'max_session_members', -1,
        'curated_cards_access', false,
        'custom_starting_point', false
      );
  END CASE;
END;
$$;

-- ─── Step 5: Replace get_effective_tier() ───────────────────────────────────
-- Authoritative version. Supersedes all prior definitions.
-- Priority: admin override > paid sub > referral bonus > free
-- Trial branches KEPT for backward compat (existing active trials expire naturally)
-- but NO NEW trials are granted.

CREATE OR REPLACE FUNCTION get_effective_tier(p_user_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
  v_sub RECORD;
  v_override_tier TEXT;
BEGIN
  -- Priority 0: Active admin override (highest priority)
  SELECT tier INTO v_override_tier
  FROM admin_subscription_overrides
  WHERE user_id = p_user_id
    AND revoked_at IS NULL
    AND starts_at <= now()
    AND expires_at > now()
  ORDER BY
    CASE tier WHEN 'mingla_plus' THEN 2 ELSE 1 END DESC
  LIMIT 1;

  IF v_override_tier IS NOT NULL THEN
    RETURN v_override_tier;
  END IF;

  -- Priority 1+: subscription-based logic
  SELECT * INTO v_sub
  FROM subscriptions
  WHERE user_id = p_user_id;

  IF NOT FOUND THEN
    RETURN 'free';
  END IF;

  -- Active paid subscription
  IF v_sub.tier = 'mingla_plus'
     AND v_sub.is_active = true
     AND v_sub.current_period_end > now() THEN
    RETURN 'mingla_plus';
  END IF;

  -- Backward compat: active trial (existing users only — no new trials granted)
  IF v_sub.trial_ends_at IS NOT NULL AND v_sub.trial_ends_at > now() THEN
    RETURN 'mingla_plus';
  END IF;

  -- Referral bonus (date-based expiry, 30 days per referral from start date)
  IF v_sub.referral_bonus_months > 0
     AND v_sub.referral_bonus_started_at IS NOT NULL
     AND v_sub.referral_bonus_started_at
         + (v_sub.referral_bonus_months * INTERVAL '30 days') > now() THEN
    RETURN 'mingla_plus';
  END IF;

  RETURN 'free';
END;
$$;

-- ─── Step 6: Replace check_pairing_allowed() ────────────────────────────────
-- Changed from binary (elite-only) to count-based (free=1, mingla_plus=unlimited)

CREATE OR REPLACE FUNCTION check_pairing_allowed(p_user_id UUID)
RETURNS TABLE(allowed BOOLEAN, current_count INTEGER, max_allowed INTEGER, tier TEXT)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_tier TEXT;
  v_limits JSONB;
  v_max INTEGER;
  v_count INTEGER;
BEGIN
  v_tier := get_effective_tier(p_user_id);
  v_limits := get_tier_limits(v_tier);
  v_max := (v_limits->>'max_pairings')::INTEGER;

  -- Count active pairings for this user
  SELECT COUNT(*) INTO v_count
  FROM pairings
  WHERE user_a_id = p_user_id OR user_b_id = p_user_id;

  -- -1 means unlimited
  IF v_max = -1 THEN
    allowed := true;
  ELSE
    allowed := (v_count < v_max);
  END IF;

  current_count := v_count;
  max_allowed := v_max;
  tier := v_tier;
  RETURN NEXT;
END;
$$;

-- ─── Step 7: Simplify get_session_member_limit() ────────────────────────────
-- Now returns -1 for everyone. Kept for API compatibility.

CREATE OR REPLACE FUNCTION get_session_member_limit(p_user_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN -1;
END;
$$;

-- ─── Step 8: Replace admin_subscription_stats() ─────────────────────────────

CREATE OR REPLACE FUNCTION admin_subscription_stats()
RETURNS JSONB AS $$
DECLARE result JSONB;
BEGIN
  IF NOT is_admin_user() THEN RAISE EXCEPTION 'Not authorized'; END IF;
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM profiles),
    'free', (SELECT count(*) FROM profiles p WHERE get_effective_tier(p.id) = 'free'),
    'mingla_plus', (SELECT count(*) FROM profiles p WHERE get_effective_tier(p.id) = 'mingla_plus'),
    'overrides', (SELECT count(*) FROM admin_subscription_overrides
      WHERE revoked_at IS NULL AND starts_at <= now() AND expires_at > now()),
    'expiring_soon', (SELECT count(*) FROM admin_subscription_overrides
      WHERE revoked_at IS NULL AND starts_at <= now() AND expires_at > now()
      AND expires_at <= now() + interval '7 days')
  ) INTO result;
  RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─── Step 9: Replace admin_grant_override() ─────────────────────────────────

CREATE OR REPLACE FUNCTION admin_grant_override(
  p_user_id    UUID,
  p_tier       TEXT,
  p_reason     TEXT,
  p_granted_by UUID,
  p_starts_at  TIMESTAMPTZ DEFAULT now(),
  p_expires_at TIMESTAMPTZ DEFAULT NULL,
  p_duration_days INTEGER DEFAULT 30
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_override_id UUID;
  v_expires TIMESTAMPTZ;
BEGIN
  IF NOT is_admin_user() THEN
    RAISE EXCEPTION 'Unauthorized: admin access required';
  END IF;

  -- Validate tier (2-tier model)
  IF p_tier NOT IN ('free', 'mingla_plus') THEN
    RAISE EXCEPTION 'Invalid tier: %. Must be free or mingla_plus.', p_tier;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'User % does not exist.', p_user_id;
  END IF;

  v_expires := COALESCE(p_expires_at, p_starts_at + (p_duration_days || ' days')::INTERVAL);

  IF v_expires <= p_starts_at THEN
    RAISE EXCEPTION 'expires_at must be after starts_at';
  END IF;

  -- Revoke any existing active overrides for this user
  UPDATE admin_subscription_overrides
  SET revoked_at = now(), updated_at = now()
  WHERE user_id = p_user_id
    AND revoked_at IS NULL
    AND expires_at > now();

  INSERT INTO admin_subscription_overrides (user_id, tier, reason, granted_by, starts_at, expires_at)
  VALUES (p_user_id, p_tier, p_reason, p_granted_by, p_starts_at, v_expires)
  RETURNING id INTO v_override_id;

  RETURN v_override_id;
END;
$$;

-- ─── Step 10: Replace admin_list_subscriptions() ────────────────────────────

CREATE OR REPLACE FUNCTION admin_list_subscriptions(
  p_search TEXT DEFAULT NULL,
  p_tier_filter TEXT DEFAULT NULL,
  p_limit INTEGER DEFAULT 50,
  p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
  user_id         UUID,
  display_name    TEXT,
  phone           TEXT,
  effective_tier  TEXT,
  raw_tier        TEXT,
  is_active       BOOLEAN,
  trial_ends_at   TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  referral_bonus_months INTEGER,
  has_admin_override BOOLEAN,
  admin_override_tier TEXT,
  admin_override_expires_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
BEGIN
  IF NOT is_admin_user() THEN
    RAISE EXCEPTION 'Unauthorized: admin access required';
  END IF;

  RETURN QUERY
  SELECT
    p.id AS user_id,
    p.first_name || ' ' || COALESCE(p.last_name, '') AS display_name,
    p.phone AS phone,
    get_effective_tier(p.id) AS effective_tier,
    COALESCE(s.tier, 'free') AS raw_tier,
    COALESCE(s.is_active, false) AS is_active,
    s.trial_ends_at,
    s.current_period_end,
    COALESCE(s.referral_bonus_months, 0) AS referral_bonus_months,
    (ao.id IS NOT NULL) AS has_admin_override,
    ao.tier AS admin_override_tier,
    ao.expires_at AS admin_override_expires_at,
    p.created_at
  FROM profiles p
  LEFT JOIN subscriptions s ON s.user_id = p.id
  LEFT JOIN LATERAL (
    SELECT o.id, o.tier, o.expires_at
    FROM admin_subscription_overrides o
    WHERE o.user_id = p.id
      AND o.revoked_at IS NULL
      AND o.starts_at <= now()
      AND o.expires_at > now()
    ORDER BY CASE o.tier WHEN 'mingla_plus' THEN 2 ELSE 1 END DESC
    LIMIT 1
  ) ao ON true
  WHERE
    (p_search IS NULL OR (
      p.first_name ILIKE '%' || p_search || '%'
      OR p.last_name ILIKE '%' || p_search || '%'
      OR p.phone ILIKE '%' || p_search || '%'
    ))
    AND (p_tier_filter IS NULL OR get_effective_tier(p.id) = p_tier_filter)
  ORDER BY p.created_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;

-- ─── Step 11: Deactivate trial grants ───────────────────────────────────────
-- create_subscription_on_onboarding_complete no longer sets trial_ends_at.
-- Existing trials expire naturally via get_effective_tier() backward compat.

CREATE OR REPLACE FUNCTION public.create_subscription_on_onboarding_complete()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- No-op: trials are no longer granted.
  -- The subscription row is created at signup via create_subscription_on_signup().
  -- Existing users with active trials retain them (get_effective_tier checks trial_ends_at).
  -- The trial abuse phone-hash system stays dormant as a safety net.
  RETURN NEW;
END;
$$;

-- ─── Step 12: Drop deprecated referral_bonus_used_months column ─────────────
-- Deprecated in migration 20260331000002 (replaced by date-based expiry via
-- referral_bonus_started_at). No code reads this column. Safe to drop.

ALTER TABLE public.subscriptions
  DROP COLUMN IF EXISTS referral_bonus_used_months;
```

### What stays untouched
- `subscriptions` table structure (columns stay, just different values)
- `trial_ends_at` column (kept for backward compat — existing active trials expire naturally)
- `referral_bonus_months`, `referral_bonus_started_at` columns (referral system unchanged, just returns 'mingla_plus' now)
- Note: `referral_bonus_used_months` column is DROPPED in Step 12 (deprecated since 20260331000002). Remove corresponding field from mobile `Subscription` interface and `SubscriptionRow` interface in `subscriptionService.ts`, and from `admin_list_subscriptions()` return type.
- `used_trial_phones` table + functions (dormant safety net)
- `create_subscription_on_signup()` function (already inserts tier='free', trial_ends_at=NULL)
- `check_session_creation_allowed()` function (reads from `get_tier_limits` — works automatically)
- `enforce_session_creation_limit()` trigger (delegates to `check_session_creation_allowed`)
- `credit_referral_on_friend_accepted()` trigger (no tier strings, just increments months)
- All pairing tables (pair_requests, pairings, pending_pair_invites) — schema unchanged

---

## Layer 2: Edge Functions

### F-12: `supabase/functions/send-pair-request/index.ts`

**Changes:**
- `check_pairing_allowed` RPC now returns `{ allowed, current_count, max_allowed, tier }` (was `{ allowed, tier }`)
- Read `pairingAllowed?.[0]?.allowed` — still works (same field name)
- Change error response (lines 81-86):
  - `error`: `'pairing_limit_reached'` (was `'elite_required'`)
  - `feature`: `'pairing'` (unchanged)
  - `message`: `'You\'ve reached your free pairing limit. Upgrade to Mingla+ for unlimited pairings.'`
  - `currentTier`: `pairingAllowed?.[0]?.tier ?? 'free'` (unchanged)
  - Add: `currentCount: pairingAllowed?.[0]?.current_count ?? 0`
  - Add: `maxAllowed: pairingAllowed?.[0]?.max_allowed ?? 1`
- Update comment (line 76): `// --- TIER GATING: Pairing limit check ---` (was "Elite-only")

### F-13: `supabase/functions/process-referral/index.ts`

**Changes (lines 185-186):**
- `title`: `"You earned Mingla+ time!"`
- `body`: `` `${referredName} joined Mingla! You earned 1 month of Mingla+.` ``

### F-14: `supabase/functions/discover-cards/index.ts`

**Changes:**
- **Remove** the `get_remaining_swipes` RPC call (lines 534-535). The function no longer exists.
- **Remove** `swipeData` variable and all references (lines 530, 539-540, 544-551, 578-585)
- **Remove** the swipe-limit early return (lines 544-553) — no user is ever limited
- **Remove** `swipeInfoPayload()` helper function (lines 578-587)
- **Remove** any spread of `...swipeInfoPayload()` in response objects
- **Keep** the `get_effective_tier` RPC call (line 536) and `effectiveTier` variable — still needed for curated card filtering
- The `limited: true` response shape is dead — remove entirely

---

## Layer 3: Mobile — Type System & Constants

### F-15: `app-mobile/src/types/subscription.ts`

**Changes:**
- Line 2: Remove imports of `hasProEntitlement`, `hasEliteEntitlement` → import `hasMinglaPlus`
- Line 8: `export type SubscriptionTier = 'free' | 'mingla_plus'`
- `getEffectiveTierFromRC()`:
  - `if (hasMinglaPlus(customerInfo)) return 'mingla_plus'`
  - Remove separate Pro/Elite checks
- `getEffectiveTierFromSupabase()`:
  - Trial check (backward compat): keep — returns `'mingla_plus'` (was `'elite'`)
  - Onboarding trial (NULL trial_ends_at + not onboarded): **REMOVE this branch** — new users are free during onboarding
  - Referral bonus: returns `'mingla_plus'` (was `'elite'`)
  - Legacy tier column check: `sub.tier !== 'free'` → returns `sub.tier` (now always 'mingla_plus' if not free)
- `getEffectiveTier()`: no structural change, just delegates
- `hasElevatedAccess()`: `return tier === 'mingla_plus'`
- All docstrings: replace Pro/Elite references with Free/Mingla+
- `getTrialDaysRemaining()`, `getTrialTotalDays()`, `getReferralDaysRemaining()`: **keep unchanged** (backward compat for existing trial/referral users)

### F-16: `app-mobile/src/constants/tierLimits.ts`

**Changes:**
- `TIER_LIMITS` Record — two entries:
  ```
  free: { dailySwipes: -1, maxPairings: 1, maxSessions: 1, maxSessionMembers: -1, curatedCardsAccess: false, customStartingPoint: false }
  mingla_plus: { dailySwipes: -1, maxPairings: -1, maxSessions: -1, maxSessionMembers: -1, curatedCardsAccess: true, customStartingPoint: true }
  ```
- `canPair()`: change to `return getTierLimits(tier).maxPairings !== 0` (was `tier === 'elite'`)
- **Remove** `getSwipeLimit()` function (no swipe limits)
- Keep `getTierLimits()`, `canAccessCuratedCards()`, `canSetCustomStartingPoint()`, `getSessionLimit()`

---

## Layer 4: Mobile — RevenueCat & Services

### F-17: `app-mobile/src/services/revenueCatService.ts`

**Changes:**
- Add constant: `export const RC_MINGLA_PLUS_ENTITLEMENT_ID = 'Mingla Plus'`
- Keep (backward compat): `RC_PRO_ENTITLEMENT_ID = 'Mingla Pro'`, `RC_ELITE_ENTITLEMENT_ID = 'Mingla Elite'`
- New function:
  ```
  export function hasMinglaPlus(customerInfo: CustomerInfo): boolean {
    return (
      customerInfo.entitlements.active[RC_MINGLA_PLUS_ENTITLEMENT_ID] !== undefined ||
      customerInfo.entitlements.active[RC_PRO_ENTITLEMENT_ID] !== undefined ||
      customerInfo.entitlements.active[RC_ELITE_ENTITLEMENT_ID] !== undefined
    )
  }
  ```
- `hasAnyEntitlement()`: delegate to `hasMinglaPlus()`
- Keep `hasProEntitlement()`, `hasEliteEntitlement()` (used by `hasMinglaPlus` and backward compat)
- New function to get expiration from any active entitlement:
  ```
  export function getMinglaPlus ExpirationDate(customerInfo: CustomerInfo): Date | null {
    const entitlement =
      customerInfo.entitlements.active[RC_MINGLA_PLUS_ENTITLEMENT_ID] ??
      customerInfo.entitlements.active[RC_ELITE_ENTITLEMENT_ID] ??
      customerInfo.entitlements.active[RC_PRO_ENTITLEMENT_ID]
    if (!entitlement?.expirationDate) return null
    return new Date(entitlement.expirationDate)
  }
  ```
- `presentPaywallIfNeeded()`: `requiredEntitlementIdentifier: RC_MINGLA_PLUS_ENTITLEMENT_ID`

### F-18: `app-mobile/src/services/subscriptionService.ts`

**Changes:**
- Line 4: import `hasMinglaPlus, getMinglaPlus ExpirationDate` (replace individual imports)
- `syncSubscriptionFromRC()` (line 143-155):
  ```
  const isActive = hasMinglaPlus(customerInfo)
  const expirationDate = getMinglaPlus ExpirationDate(customerInfo)
  const updates = {
    tier: isActive ? 'mingla_plus' : 'free',
    is_active: isActive,
    current_period_end: expirationDate ? expirationDate.toISOString() : null,
    updated_at: new Date().toISOString(),
  }
  ```

---

## Layer 5: Mobile — Hooks

### F-19: `app-mobile/src/hooks/useFeatureGate.ts`

**Changes:**
- `GatedFeature` type: remove `'unlimited_swipes'`. New type:
  `'curated_cards' | 'custom_starting_point' | 'pairing' | 'session_creation'`
- `FEATURE_TIER_MAP`:
  ```
  curated_cards: 'mingla_plus',
  custom_starting_point: 'mingla_plus',
  pairing: 'free',           // everyone can pair; count limit is server-side
  session_creation: 'free',   // everyone can create; count limit is server-side
  ```
- `canAccess()` switch:
  - `curated_cards`: `return limits.curatedCardsAccess` (semantically means "can save")
  - `custom_starting_point`: `return limits.customStartingPoint`
  - `pairing`: `return true` (access is universal; limit checked by `check_pairing_allowed` RPC on the actual pair request)
  - `session_creation`: `return true`

**Important semantic note:** `canAccess('curated_cards')` now means "can SAVE curated cards" (not "can VIEW"). All consumers use this to gate the save action, not the view. No rename needed — the existing call sites already check this before the save/bookmark action.

### F-20: `app-mobile/src/hooks/useSubscription.ts`

**Changes:**
- Update hierarchy comment (line 85): `Hierarchy: mingla_plus > free`
- `useTrialExpiryTracking()`: **keep unchanged** — fires for existing trial users whose trial already expired. Won't fire for new users (no trial_ends_at set).
- `useTrialDaysRemaining()`, `useTrialTotalDays()`, `useReferralDaysRemaining()`: **keep unchanged** — backward compat.

### F-21: `app-mobile/src/hooks/useSwipeLimit.ts`

**DELETE THIS FILE ENTIRELY.**

Remove all imports of `useSwipeLimit` from consumers:
- `app-mobile/src/components/SwipeableCards.tsx`
- Any other file that imports from this hook

### F-22: `app-mobile/src/hooks/useSessionCreationGate.ts`

**No changes.** Reads from `check_session_creation_allowed` RPC which reads from `get_tier_limits` — cascading fix from DB layer.

### F-23: `app-mobile/src/hooks/useCreatorTier.ts`

**No changes.** Returns `SubscriptionTier` from RPC — type change cascades automatically.

---

## Layer 6: Mobile — UI Components

### F-24: `app-mobile/src/components/LockedCuratedCard.tsx`

**DELETE THIS FILE.** Free users now see full curated cards. The save-gating logic moves to the save action in `SwipeableCards.tsx` (see F-27 below).

Remove all imports of `LockedCuratedCard` from consumers.

### F-26: `app-mobile/src/components/CustomPaywallScreen.tsx`

**Major changes:**
- Props: remove `initialTier` prop. New interface:
  ```
  interface CustomPaywallScreenProps {
    isVisible: boolean
    onClose: () => void
    userId: string
    feature?: GatedFeature
  }
  ```
- Remove `TierKey` type
- Remove `filterPackagesByTier()` helper — no longer splitting by tier
- Remove Pro/Elite tab selector UI entirely
- Package list: show ALL packages from offering (no tier filtering). The RC dashboard controls what packages appear.
- `FEATURE_CHECKLIST`: replace with Free vs Mingla+ comparison:
  ```
  { label: 'Unlimited swipes', free: true, minglaPlus: true },
  { label: '1 pairing', free: true, minglaPlus: false },
  { label: 'Unlimited pairings', free: false, minglaPlus: true },
  { label: '1 session', free: true, minglaPlus: false },
  { label: 'Unlimited sessions', free: false, minglaPlus: true },
  { label: 'View curated experiences', free: true, minglaPlus: true },
  { label: 'Save curated experiences', free: false, minglaPlus: true },
  { label: 'Custom starting point', free: false, minglaPlus: true },
  ```
- Single accent color: `colors.primary[500]` (Mingla orange) for all CTA elements
- Remove tier-switching state, `selectedTier`, `handleTierSwitch`
- Pairing-specific header: `'Connect with Your People'` → keep but add `'Save This Experience'` for curated_cards feature

### F-25: `app-mobile/src/components/profile/BillingSheet.tsx`

**Changes:**
- `TIERS` Record (two entries):
  ```
  free: {
    name: 'Free Plan',
    icon: 'person-outline',
    description: 'The essentials to start exploring.',
    perks: [
      'Unlimited swipes',
      '1 active pairing',
      '1 board session',
      'View curated experiences',
    ],
  },
  mingla_plus: {
    name: 'Mingla+',
    icon: 'diamond',
    description: 'Everything unlocked. No limits.',
    perks: [
      'Unlimited swipes',
      'Unlimited pairings',
      'Unlimited board sessions',
      'Save curated experiences',
      'Set your own starting point',
    ],
  },
  ```
- `TIER_ORDER`: `['free', 'mingla_plus']`
- `TIER_RANK`: `{ free: 0, mingla_plus: 1 }`
- `getCtaLabel()`: simplify — `tier === 'free' ? 'Manage Subscription' : 'Upgrade to Mingla+'` when upgrade, `''` otherwise
- Remove `paywallTier` state and `setPaywallTier`. The `handleChangePlan` just opens the paywall (no tier selection needed):
  ```
  const handleChangePlan = () => { setShowPaywall(true) }
  ```
- `CustomPaywallScreen`: remove `initialTier` prop
- `CurrentPlanCard`:
  - Remove "Elite trial" label → trial section still shows if `trialDays > 0` (backward compat for existing trial users) but label says "Trial" not "Elite trial"
  - Referral section: no changes (still shows bonus days)

### F-27: `app-mobile/src/components/SwipeableCards.tsx`

**Changes:**
- Remove `useSwipeLimit` import and all usage
- Remove `canAccess('unlimited_swipes')` checks — no swipe gating exists
- Curated card rendering (line 1086, 1836):
  - Remove the `LockedCuratedCard` branch — always render the full curated card
  - Remove `LockedCuratedCard` import
  - Gate the **save/bookmark action** instead: when user taps save on a curated card and `!canAccess('curated_cards')`, open the paywall
- Remove `initialTier` prop from CustomPaywallScreen usage (line 2042)
- Swipe paywall trigger: **remove entirely** — no swipe limit means no swipe-limit paywall

### F-28: `app-mobile/src/components/DiscoverScreen.tsx`

**Changes:**
- `canAccess('pairing')` returns true for all users now → remove lock icon, remove opacity styling, remove locked state on pair button (lines 3366-3383)
- The pair button always looks active/tappable
- When user taps pair and the RPC returns `allowed: false`, show the paywall:
  - The edge function `send-pair-request` returns 403 with `pairing_limit_reached`
  - Client catches this → opens CustomPaywallScreen with `feature="pairing"`
- Remove `initialTier` prop from paywall (line 4055)

### F-29: `app-mobile/src/components/activity/SavedTab.tsx`

**Changes:**
- Remove `canAccess('curated_cards')` gate for **viewing** saved curated entries (line 1667) — free users can view saved items
- The save action itself is gated at the point of saving (in SwipeableCards), not here
- Remove `initialTier="pro"` from paywall (line 2173)

### F-30: `app-mobile/src/components/activity/CalendarTab.tsx`

**Changes:**
- `isEntryLocked` (line 1257): remove — curated entries are never locked for viewing
- Remove `initialTier="pro"` from paywall (line 1904)

### F-31: `app-mobile/src/components/PreferencesSheet.tsx`

**Changes:**
- `isCuratedLocked` (line 932): set to `false` always (or remove the prop entirely if the child component doesn't need it)
- Custom starting point lock (line 1050): unchanged — still gated to `canAccess('custom_starting_point')` which requires mingla_plus
- Remove `initialTier="pro"` from paywall (line 1132)

### F-32: `app-mobile/src/components/CollaborationSessions.tsx`

**Changes:**
- Remove `initialTier="pro"` from paywall (line 950)

### F-33: `app-mobile/src/components/profile/ViewFriendProfileScreen.tsx`

**Changes:**
- `TIER_LABEL` (lines 21-25):
  ```
  { free: 'Free', mingla_plus: 'Mingla+' }
  ```
- `TIER_BADGE_STYLES` (lines 27-34):
  ```
  {
    free: { bg: '#f3f4f6', text: '#4b5563', border: '#e5e7eb' },
    mingla_plus: { bg: '#fff7ed', text: '#c2410c', border: '#fed7aa' },
  }
  ```

---

## Layer 7: Admin Dashboard

### F-34: `mingla-admin/src/pages/SubscriptionManagementPage.jsx`

**Changes:**
- `TIER_CONFIG` (line 39):
  ```
  { free: { label: "Free", variant: "default", icon: User }, mingla_plus: { label: "Mingla+", variant: "warning", icon: Crown } }
  ```
- `stats` state (line 72): `{ total: 0, free: 0, mingla_plus: 0, overrides: 0 }`
- Stats unpacking (line 170): `mingla_plus: s.mingla_plus ?? 0`
- Fallback stats (lines 196-198): filter by `effective_tier === "mingla_plus"`
- `grantForm` default (line 81): `{ tier: "mingla_plus", ... }`
- Reset (line 255, 471): `{ tier: "mingla_plus", ... }`
- Filter buttons (line 540): `[null, "free", "mingla_plus"]`
- Stat card (line 523): label `"Mingla+"`, value `stats.mingla_plus`
- Grant tier buttons (line 609): `["free", "mingla_plus"]`
- Warning text (line 650): update to reference Mingla+ (not Pro/Elite)
- Revoke warning (line 673): update copy

### F-35: `mingla-admin/src/pages/EmailPage.jsx`

**Changes:**
- `TIER_OPTIONS` (lines 44-47):
  ```
  [{ value: "free", label: "Free" }, { value: "mingla_plus", label: "Mingla+" }]
  ```

---

## Layer 8: App Initialization

### `app/index.tsx`

**Changes:**
- `useTrialExpiryTracking`: **keep** (backward compat)
- Verify no `useSwipeLimit` import exists here — if it does, remove it

---

## Backward Compatibility

| Scenario | Handling |
|----------|---------|
| User with active RC "Mingla Pro" entitlement | `hasMinglaPlus()` checks all 3 entitlement IDs → returns true → tier = mingla_plus |
| User with active RC "Mingla Elite" entitlement | Same as above |
| User with active trial (trial_ends_at > now) | `get_effective_tier()` still checks trial_ends_at → returns 'mingla_plus' |
| User mid-onboarding (trial_ends_at IS NULL) | No longer gets elevated access — stays 'free'. Can still pair (1 allowed) and create session (1 allowed). |
| DB rows with tier='pro' or tier='elite' | Migrated to 'mingla_plus' in Step 1 of migration |
| React Query cache with stale 'pro'/'elite' | Server RPC returns 'free' or 'mingla_plus'. Client `useEffectiveTier` trusts server when available. Stale client cache resolves in ≤60s (staleTime). |
| Admin overrides with 'pro'/'elite' | Migrated in Step 1. CHECK constraint prevents new ones. |

---

## Implementation Order

```
Phase 1: Apply DB migration (BEFORE any code deploy)
  → supabase/migrations/20260411000001_price_tier_restructure.sql

Phase 2: Deploy edge functions (AFTER migration)
  → send-pair-request/index.ts
  → process-referral/index.ts
  → discover-cards/index.ts

Phase 3: Mobile types + constants + services
  → types/subscription.ts
  → constants/tierLimits.ts
  → services/revenueCatService.ts
  → services/subscriptionService.ts

Phase 4: Mobile hooks
  → hooks/useFeatureGate.ts
  → hooks/useSubscription.ts
  → DELETE hooks/useSwipeLimit.ts

Phase 5: Mobile UI components
  → DELETE components/LockedCuratedCard.tsx
  → components/CustomPaywallScreen.tsx
  → components/profile/BillingSheet.tsx
  → components/SwipeableCards.tsx
  → components/DiscoverScreen.tsx
  → components/activity/SavedTab.tsx
  → components/activity/CalendarTab.tsx
  → components/PreferencesSheet.tsx
  → components/CollaborationSessions.tsx
  → components/profile/ViewFriendProfileScreen.tsx

Phase 6: Admin dashboard (can parallel with Phase 5)
  → pages/SubscriptionManagementPage.jsx
  → pages/EmailPage.jsx
```

---

## Success Criteria

| # | Criterion | How to Verify |
|---|-----------|---------------|
| SC-01 | `get_effective_tier()` returns only 'free' or 'mingla_plus' for all users | Run `SELECT DISTINCT get_effective_tier(id) FROM profiles` in Supabase |
| SC-02 | Free users swipe unlimited — no paywall on swipe, no limit counter | Swipe 50+ cards as free user — no interruption |
| SC-03 | Free users create 1 session, paywall on 2nd attempt | Create session → success. Create 2nd → paywall appears |
| SC-04 | Free users pair with 1 person, paywall on 2nd attempt | Send pair request → success. Try 2nd while 1st active → 403 + paywall |
| SC-05 | Free users see full curated cards (no blur/lock) | Curated card appears in deck without LockedCuratedCard overlay |
| SC-06 | Free users get paywall when saving curated card | Tap save/bookmark on curated card → paywall opens |
| SC-07 | Free users cannot set custom starting point | Toggle custom start → paywall opens |
| SC-08 | Mingla+ users have zero limits | All features work without any paywall trigger |
| SC-09 | Existing Pro RC subscriber → mingla_plus with no disruption | User with "Mingla Pro" entitlement → `hasMinglaPlus` returns true → tier = mingla_plus |
| SC-10 | Existing Elite RC subscriber → mingla_plus with no disruption | Same as SC-09 for "Mingla Elite" |
| SC-11 | Existing trial user keeps trial until expiry | User with trial_ends_at in future → tier = mingla_plus until expiry |
| SC-12 | New user gets no trial | Sign up → complete onboarding → tier stays 'free' |
| SC-13 | Referral bonus grants mingla_plus | Refer a friend → friend accepts → referrer gets mingla_plus for 30 days |
| SC-14 | Admin dashboard shows Free/Mingla+ stats | SubscriptionManagementPage shows 2-tier stats, not 3 |
| SC-15 | Admin can grant mingla_plus override | Grant override → user's effective tier = mingla_plus |
| SC-16 | Billing sheet shows 2 tiers | Open billing → see Free and Mingla+ cards only |
| SC-17 | Custom paywall shows single plan | Open paywall → see Mingla+ plan, no Pro/Elite tabs |
| SC-18 | `daily_swipe_counts` table is gone | `SELECT * FROM daily_swipe_counts` → relation does not exist |
| SC-19 | Pairing during onboarding works for free users | Complete onboarding Step 5 → can accept 1 pair request |

---

## Test Cases

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| T-01 | Free user swipes unlimited | Swipe 100 cards | All swipes succeed, no paywall | Full stack |
| T-02 | Free user creates 1 session | Create session | Success | DB + Mobile |
| T-03 | Free user creates 2nd session | Attempt 2nd | Paywall appears, session not created | DB + Mobile |
| T-04 | Free user sends 1st pair request | Send to friend | Success (or 403 if friend limit, but not tier limit) | Edge + DB |
| T-05 | Free user sends 2nd pair request (1st active) | Send while paired | 403 with `pairing_limit_reached` + paywall | Edge + DB + Mobile |
| T-06 | Free user unpairs, then sends new request | Unpair → new request | Success (slot freed) | Edge + DB |
| T-07 | Free user views curated card | Curated card in deck | Full card visible, no blur/lock | Mobile |
| T-08 | Free user saves curated card | Tap save/bookmark | Paywall opens, card NOT saved | Mobile |
| T-09 | Mingla+ user saves curated card | Tap save/bookmark | Card saved successfully | Mobile |
| T-10 | Mingla+ user creates unlimited sessions | Create 5 sessions | All succeed | DB + Mobile |
| T-11 | Existing Pro subscriber loads app | Open app | Tier = mingla_plus, all features unlocked | RC + Mobile |
| T-12 | Existing Elite subscriber loads app | Open app | Tier = mingla_plus, all features unlocked | RC + Mobile |
| T-13 | Existing trial user (3 days left) | Open app | Tier = mingla_plus, trial badge shows 3 days | DB + Mobile |
| T-14 | New user completes onboarding | Finish onboarding | Tier = free, no trial badge | DB + Mobile |
| T-15 | Referral credited | Friend accepts invite | Referrer gets 30 days mingla_plus, notification says "Mingla+" | DB + Edge |
| T-16 | Admin grants mingla_plus override | Grant in admin panel | User's tier = mingla_plus | Admin + DB |
| T-17 | Admin grants free override to Mingla+ user | Grant free override | User's tier = free (override wins) | Admin + DB |
| T-18 | Custom starting point blocked for free | Toggle custom start | Paywall appears | Mobile |
| T-19 | Billing sheet displays correctly | Open billing | 2 tier cards (Free, Mingla+), correct perks | Mobile |
| T-20 | Paywall displays correctly | Trigger any paywall | Single Mingla+ plan, Free vs Mingla+ comparison, no tabs | Mobile |
| T-21 | Friend profile shows correct tier badge | View friend with mingla_plus | Badge shows "Mingla+" with orange styling | Mobile |
| T-22 | Admin email segmentation works | Compose email, filter by mingla_plus | Only mingla_plus users shown in preview | Admin |

---

## Invariants

### Preserved
- **One owner per truth:** `get_effective_tier()` remains the single authority for tier resolution (server-side). `useEffectiveTier()` remains the single authority client-side.
- **Server state stays server-side:** Tier is resolved via React Query hook, not Zustand.
- **No fabricated data:** No fake tier badges, no hardcoded "Pro" strings for non-Pro users.

### New
- **INV-TIER-01:** The system recognizes exactly two tier values: `'free'` and `'mingla_plus'`. CHECK constraints enforce this at the DB level.
- **INV-TIER-02:** `canAccess('curated_cards')` means "can save" not "can view." All curated cards are viewable by all tiers.
- **INV-TIER-03:** Pairing limits are enforced server-side via `check_pairing_allowed()` RPC, never client-side only.

---

## Regression Prevention

1. **CHECK constraints** on both `subscriptions` and `admin_subscription_overrides` prevent any code from writing an invalid tier string to the DB.
2. **TypeScript union type** `'free' | 'mingla_plus'` prevents compile-time use of old tier strings in the mobile codebase.
3. The `get_tier_limits()` ELSE clause defaults to free — any unexpected tier string gets free limits, never elevated access.
4. `hasMinglaPlus()` checking all 3 RC entitlement IDs ensures no existing subscriber loses access even if their RC entitlement hasn't been migrated.

---

## Discoveries for Orchestrator

1. **Onboarding pairing works for free users** — free tier allows 1 active pairing, which is sufficient for onboarding Step 5. No onboarding redesign needed.
2. **`discover-cards` swipe data is deeply integrated** — the swipe limit early-return, `swipeInfoPayload()` helper, and response shape all need cleanup. This is more than a one-liner.
3. **`referral_bonus_used_months` column** — now dropped in Step 12 of the migration. Mobile types and admin RPC return types must remove this field.
