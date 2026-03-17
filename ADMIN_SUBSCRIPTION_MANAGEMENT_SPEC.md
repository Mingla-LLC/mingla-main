# Admin Subscription Management Spec

## Summary

Give the Mingla admin team the ability to view every user's subscription status and grant/revoke tier overrides for arbitrary time periods. Admin overrides take precedence over all other tier sources (RevenueCat, trials, referrals) and are resolved server-side so the mobile app requires zero changes.

## Context for Admin Team

You work in a separate repo but share the same Supabase project. This spec gives you everything you need — SQL migrations to run, RLS policies, and RPC functions to call from your admin UI. **The mobile app needs no changes.**

---

## How Tier Resolution Currently Works

The SQL function `get_effective_tier(p_user_id)` resolves a user's tier using this priority:

1. Active paid subscription (`tier = 'pro'|'elite'` + `is_active = true` + `current_period_end > now()`)
2. Active trial (`trial_ends_at > now()` → returns `'elite'`)
3. Referral bonus months (`referral_bonus_months > referral_bonus_used_months` → returns `'pro'`)
4. Default → `'free'`

RevenueCat is the **mobile-side** authority for paid tiers, but the DB function doesn't query RC — it reads the `subscriptions` table (synced from RC via `syncSubscriptionFromRC()`).

**Your admin overrides will be inserted as priority #0 — checked first, before everything else.**

---

## Database Changes

### Migration: `create_admin_subscription_overrides.sql`

```sql
-- =============================================================
-- Admin Subscription Overrides
-- =============================================================

-- Table: admin_subscription_overrides
-- Stores tier overrides granted by admins. When active, these
-- take absolute precedence over RevenueCat, trials, and referrals.
CREATE TABLE IF NOT EXISTS admin_subscription_overrides (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tier        TEXT NOT NULL CHECK (tier IN ('free', 'pro', 'elite')),
  reason      TEXT NOT NULL,               -- why the override was granted (for audit)
  granted_by  UUID NOT NULL REFERENCES auth.users(id), -- admin user who granted it
  starts_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL,        -- when the override ends
  revoked_at  TIMESTAMPTZ,                 -- non-null = manually revoked early
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for fast lookup during tier resolution
CREATE INDEX idx_admin_overrides_user_active
  ON admin_subscription_overrides (user_id, expires_at)
  WHERE revoked_at IS NULL;

-- Index for admin browsing
CREATE INDEX idx_admin_overrides_granted_by
  ON admin_subscription_overrides (granted_by);

-- Auto-update updated_at
CREATE TRIGGER set_admin_overrides_updated_at
  BEFORE UPDATE ON admin_subscription_overrides
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- =============================================================
-- RLS Policies
-- =============================================================
ALTER TABLE admin_subscription_overrides ENABLE ROW LEVEL SECURITY;

-- Regular users can read their own overrides (so mobile can display "gifted by admin" badge)
CREATE POLICY "Users can read own overrides"
  ON admin_subscription_overrides FOR SELECT
  USING (auth.uid() = user_id);

-- Admin operations go through service_role key (bypasses RLS).
-- Your admin app should use the service_role key for all write operations.
-- No INSERT/UPDATE/DELETE policies needed for regular users.

-- =============================================================
-- Update get_effective_tier() to check admin overrides FIRST
-- =============================================================
CREATE OR REPLACE FUNCTION get_effective_tier(p_user_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
  v_sub RECORD;
  v_override_tier TEXT;
  v_has_completed_onboarding BOOLEAN;
BEGIN
  -- Priority 0: Active admin override (highest priority)
  SELECT tier INTO v_override_tier
  FROM admin_subscription_overrides
  WHERE user_id = p_user_id
    AND revoked_at IS NULL
    AND starts_at <= now()
    AND expires_at > now()
  ORDER BY
    CASE tier WHEN 'elite' THEN 3 WHEN 'pro' THEN 2 ELSE 1 END DESC
  LIMIT 1;

  IF v_override_tier IS NOT NULL THEN
    RETURN v_override_tier;
  END IF;

  -- Priority 1+: existing logic (unchanged)
  SELECT * INTO v_sub
  FROM subscriptions
  WHERE user_id = p_user_id;

  IF NOT FOUND THEN
    RETURN 'free';
  END IF;

  -- Active paid subscription
  IF v_sub.tier IN ('pro', 'elite')
     AND v_sub.is_active = true
     AND v_sub.current_period_end > now() THEN
    RETURN v_sub.tier;
  END IF;

  -- Trial (during onboarding: trial_ends_at is NULL, user is not onboarded → elite)
  SELECT has_completed_onboarding INTO v_has_completed_onboarding
  FROM profiles
  WHERE user_id = p_user_id;

  IF v_sub.trial_ends_at IS NULL AND v_has_completed_onboarding IS NOT TRUE THEN
    RETURN 'elite';  -- onboarding trial
  END IF;

  IF v_sub.trial_ends_at IS NOT NULL AND v_sub.trial_ends_at > now() THEN
    RETURN 'elite';  -- active post-onboarding trial
  END IF;

  -- Referral bonus
  IF v_sub.referral_bonus_months > v_sub.referral_bonus_used_months THEN
    RETURN 'pro';
  END IF;

  RETURN 'free';
END;
$$;

-- =============================================================
-- Admin RPC: List all users with subscription status
-- =============================================================
CREATE OR REPLACE FUNCTION admin_list_subscriptions(
  p_search TEXT DEFAULT NULL,        -- search by name, phone, or email
  p_tier_filter TEXT DEFAULT NULL,   -- filter by effective tier
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
  referral_bonus_used_months INTEGER,
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
  RETURN QUERY
  SELECT
    p.user_id,
    p.first_name || ' ' || COALESCE(p.last_name, '') AS display_name,
    p.phone_number AS phone,
    get_effective_tier(p.user_id) AS effective_tier,
    COALESCE(s.tier, 'free') AS raw_tier,
    COALESCE(s.is_active, false) AS is_active,
    s.trial_ends_at,
    s.current_period_end,
    COALESCE(s.referral_bonus_months, 0) AS referral_bonus_months,
    COALESCE(s.referral_bonus_used_months, 0) AS referral_bonus_used_months,
    (ao.id IS NOT NULL) AS has_admin_override,
    ao.tier AS admin_override_tier,
    ao.expires_at AS admin_override_expires_at,
    p.created_at
  FROM profiles p
  LEFT JOIN subscriptions s ON s.user_id = p.user_id
  LEFT JOIN LATERAL (
    SELECT o.id, o.tier, o.expires_at
    FROM admin_subscription_overrides o
    WHERE o.user_id = p.user_id
      AND o.revoked_at IS NULL
      AND o.starts_at <= now()
      AND o.expires_at > now()
    ORDER BY CASE o.tier WHEN 'elite' THEN 3 WHEN 'pro' THEN 2 ELSE 1 END DESC
    LIMIT 1
  ) ao ON true
  WHERE
    (p_search IS NULL OR (
      p.first_name ILIKE '%' || p_search || '%'
      OR p.last_name ILIKE '%' || p_search || '%'
      OR p.phone_number ILIKE '%' || p_search || '%'
    ))
    AND (p_tier_filter IS NULL OR get_effective_tier(p.user_id) = p_tier_filter)
  ORDER BY p.created_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;

-- =============================================================
-- Admin RPC: Grant a tier override
-- =============================================================
CREATE OR REPLACE FUNCTION admin_grant_override(
  p_user_id    UUID,
  p_tier       TEXT,
  p_reason     TEXT,
  p_granted_by UUID,
  p_starts_at  TIMESTAMPTZ DEFAULT now(),
  p_expires_at TIMESTAMPTZ DEFAULT NULL,   -- NULL = 30 days from now
  p_duration_days INTEGER DEFAULT 30       -- used if p_expires_at is NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_override_id UUID;
  v_expires TIMESTAMPTZ;
BEGIN
  -- Validate tier
  IF p_tier NOT IN ('free', 'pro', 'elite') THEN
    RAISE EXCEPTION 'Invalid tier: %. Must be free, pro, or elite.', p_tier;
  END IF;

  -- Validate user exists
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'User % does not exist.', p_user_id;
  END IF;

  -- Calculate expiry
  v_expires := COALESCE(p_expires_at, p_starts_at + (p_duration_days || ' days')::INTERVAL);

  -- Validate dates
  IF v_expires <= p_starts_at THEN
    RAISE EXCEPTION 'expires_at must be after starts_at';
  END IF;

  -- Revoke any existing active overrides for this user (only one active at a time)
  UPDATE admin_subscription_overrides
  SET revoked_at = now(), updated_at = now()
  WHERE user_id = p_user_id
    AND revoked_at IS NULL
    AND expires_at > now();

  -- Insert new override
  INSERT INTO admin_subscription_overrides (user_id, tier, reason, granted_by, starts_at, expires_at)
  VALUES (p_user_id, p_tier, p_reason, p_granted_by, p_starts_at, v_expires)
  RETURNING id INTO v_override_id;

  RETURN v_override_id;
END;
$$;

-- =============================================================
-- Admin RPC: Revoke an override early
-- =============================================================
CREATE OR REPLACE FUNCTION admin_revoke_override(
  p_override_id UUID,
  p_revoked_by  UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE admin_subscription_overrides
  SET revoked_at = now(), updated_at = now()
  WHERE id = p_override_id
    AND revoked_at IS NULL;

  RETURN FOUND;
END;
$$;

-- =============================================================
-- Admin RPC: View override history for a user
-- =============================================================
CREATE OR REPLACE FUNCTION admin_get_override_history(
  p_user_id UUID
)
RETURNS TABLE (
  id          UUID,
  tier        TEXT,
  reason      TEXT,
  granted_by  UUID,
  starts_at   TIMESTAMPTZ,
  expires_at  TIMESTAMPTZ,
  revoked_at  TIMESTAMPTZ,
  is_active   BOOLEAN,
  created_at  TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
BEGIN
  RETURN QUERY
  SELECT
    o.id,
    o.tier,
    o.reason,
    o.granted_by,
    o.starts_at,
    o.expires_at,
    o.revoked_at,
    (o.revoked_at IS NULL AND o.starts_at <= now() AND o.expires_at > now()) AS is_active,
    o.created_at
  FROM admin_subscription_overrides o
  WHERE o.user_id = p_user_id
  ORDER BY o.created_at DESC;
END;
$$;
```

---

## How to Use from Admin App

### Authentication

All admin RPC calls must use the **Supabase service_role key** (not the anon key). This bypasses RLS and gives full access. Store it server-side only — never expose in a browser client.

```typescript
import { createClient } from '@supabase/supabase-js'

const adminSupabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)
```

### List All Users with Subscription Status

```typescript
const { data, error } = await adminSupabase.rpc('admin_list_subscriptions', {
  p_search: 'John',        // optional: search by name/phone
  p_tier_filter: 'free',   // optional: filter by effective tier
  p_limit: 50,
  p_offset: 0,
})
// Returns array of user rows with effective_tier, override status, trial info, etc.
```

### Grant a Tier Override

```typescript
// Grant "pro" for 30 days
const { data: overrideId, error } = await adminSupabase.rpc('admin_grant_override', {
  p_user_id: '550e8400-e29b-41d4-a716-446655440000',
  p_tier: 'pro',
  p_reason: 'Beta tester reward',
  p_granted_by: adminUserId,  // the admin's auth.users ID
  p_duration_days: 30,
})

// Grant "elite" for a specific date range
const { data: overrideId, error } = await adminSupabase.rpc('admin_grant_override', {
  p_user_id: '550e8400-e29b-41d4-a716-446655440000',
  p_tier: 'elite',
  p_reason: 'Influencer partnership - March campaign',
  p_granted_by: adminUserId,
  p_starts_at: '2026-03-20T00:00:00Z',
  p_expires_at: '2026-04-20T00:00:00Z',
})
```

### Revoke an Override Early

```typescript
const { data: wasRevoked, error } = await adminSupabase.rpc('admin_revoke_override', {
  p_override_id: '...',
  p_revoked_by: adminUserId,
})
```

### View Override History for a User

```typescript
const { data: history, error } = await adminSupabase.rpc('admin_get_override_history', {
  p_user_id: '550e8400-e29b-41d4-a716-446655440000',
})
```

### Force Downgrade (Set to Free)

To force a user to free tier regardless of their payment status:

```typescript
await adminSupabase.rpc('admin_grant_override', {
  p_user_id: targetUserId,
  p_tier: 'free',
  p_reason: 'Abuse - forced downgrade',
  p_granted_by: adminUserId,
  p_duration_days: 365,  // 1 year
})
```

This works because admin overrides are checked **before** RevenueCat/trial/referral logic.

---

## Tier Resolution After This Change

```
1. Active admin override?        → return override tier
2. Active paid subscription?     → return subscription tier
3. In onboarding (trial)?        → return 'elite'
4. Active post-onboarding trial? → return 'elite'
5. Unused referral months?       → return 'pro'
6. Default                       → return 'free'
```

---

## Important Notes

1. **Mobile app needs zero changes.** The mobile app calls `get_effective_tier()` — the updated function automatically checks admin overrides first. Users will see their tier change in real-time (within React Query's 5-minute stale window).

2. **Only one active override per user.** Granting a new override auto-revokes the previous one. This prevents conflicts.

3. **Overrides auto-expire.** No cleanup jobs needed — `expires_at` is checked at query time.

4. **Audit trail built in.** Every override records who granted it, why, and when. Revocations are tracked. Full history is queryable.

5. **Use service_role key.** All admin writes bypass RLS via service_role. Regular users can only read their own overrides (for potential UI display).

6. **RevenueCat is still active.** If a user has a RC subscription AND an admin override, the admin override wins. When the override expires, they fall back to their RC tier automatically.

---

## Schema Summary

| Object | Type | Purpose |
|--------|------|---------|
| `admin_subscription_overrides` | Table | Stores tier overrides with audit trail |
| `get_effective_tier()` | Function (updated) | Now checks admin overrides first |
| `admin_list_subscriptions()` | RPC | List all users with full subscription status |
| `admin_grant_override()` | RPC | Grant a tier for a time period |
| `admin_revoke_override()` | RPC | Revoke an override early |
| `admin_get_override_history()` | RPC | View all overrides for a user |

---

## Test Cases

| Scenario | Action | Expected Result |
|----------|--------|-----------------|
| Free user, no override | Call `get_effective_tier` | Returns `'free'` |
| Free user, admin grants pro for 30d | Call `get_effective_tier` | Returns `'pro'` |
| Pro user (RC), admin grants free | Call `get_effective_tier` | Returns `'free'` (override wins) |
| Override expires | Call `get_effective_tier` after expiry | Falls back to RC/trial/referral tier |
| Admin revokes override | Call `admin_revoke_override` | `get_effective_tier` returns underlying tier |
| Grant new override while one active | Call `admin_grant_override` | Old one revoked, new one active |
| Search users by name | Call `admin_list_subscriptions` with search | Filtered results returned |
| Filter by tier | Call `admin_list_subscriptions` with tier_filter | Only matching tiers returned |
