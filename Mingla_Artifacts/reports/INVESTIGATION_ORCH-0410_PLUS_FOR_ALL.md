# INVESTIGATION: ORCH-0410 — Make All Users Plus Members

**Investigator:** Forensics Agent
**Date:** 2026-04-14
**Confidence:** HIGH — every file read, every function traced, all five layers verified

---

## Layman Summary

The tier system is **fully unified** on `free`/`mingla_plus` across all layers. Migration `20260411000001_price_tier_restructure.sql` already converted everything — DB constraints, server functions, admin RPCs, mobile types. There are NO contradictions between layers.

The reason users are currently Free (not Plus) is simple: the `get_effective_tier()` function only returns `'mingla_plus'` if one of four conditions is met — active admin override, active paid RC subscription, active legacy trial, or active referral bonus. For everyone else, it returns `'free'`. There is no "global Plus" switch yet.

To make everyone Plus, we need to either (a) add a global override flag to `get_effective_tier()`, or (b) hardcode the return, or (c) bulk-update subscription rows. Each has different revert characteristics.

---

## Layer 1: Schema (Database Truth)

### subscriptions table
- **CHECK constraint:** `tier IN ('free', 'mingla_plus')` — updated by migration `20260411000001` line 22-27
- **Default:** `tier = 'free'` on INSERT (from `create_subscription_on_signup()`, migration `20260315000021` line 18-19)
- **No trials for new users:** `create_subscription_on_onboarding_complete()` is now a NO-OP (migration `20260411000001` line 333-342)

### admin_subscription_overrides table
- **CHECK constraint:** `tier IN ('free', 'mingla_plus')` — updated by migration `20260411000001` line 29-34

### get_effective_tier(p_user_id UUID) — AUTHORITATIVE VERSION
**File:** `supabase/migrations/20260411000001_price_tier_restructure.sql:79-135`

Returns only `'free'` or `'mingla_plus'`. Resolution priority:
1. **Admin override** (active, non-revoked, within date window) → returns override tier
2. **Paid subscription** (`tier = 'mingla_plus' AND is_active = true AND current_period_end > now()`) → `'mingla_plus'`
3. **Legacy trial** (`trial_ends_at > now()`) → `'mingla_plus'` (backward compat — no new trials granted)
4. **Referral bonus** (date-based, 30 days per referral) → `'mingla_plus'`
5. **Fallback** → `'free'`

### get_tier_limits(p_tier TEXT)
**File:** `supabase/migrations/20260411000001_price_tier_restructure.sql:45-71`

| Tier | daily_swipes | max_pairings | max_sessions | max_session_members | curated_cards | custom_start |
|------|-------------|-------------|-------------|-------------------|--------------|-------------|
| free | -1 (unlimited) | 1 | 1 | -1 (unlimited) | false | false |
| mingla_plus | -1 | -1 | -1 | -1 | true | true |

### check_pairing_allowed()
**File:** `supabase/migrations/20260411000001_price_tier_restructure.sql:140-170`
- Count-based. Uses `get_tier_limits(get_effective_tier(user))`. Free = 1, Plus = unlimited.

### check_session_creation_allowed()
**File:** `supabase/migrations/20260315000008_session_creation_limits.sql:4-36`
- Same pattern: `get_tier_limits(get_effective_tier(user))`. Free = 1, Plus = unlimited.

### Signup trigger
**File:** `supabase/migrations/20260315000021_fix_trial_timing_for_onboarding.sql:15-29`
- `create_subscription_on_signup()` → inserts `(user_id, 'free', NULL)` on profile creation

### Onboarding trigger
**File:** `supabase/migrations/20260411000001_price_tier_restructure.sql:333-342`
- `create_subscription_on_onboarding_complete()` → **NO-OP**. Trials disabled.

### app_config table
**File:** `supabase/migrations/20260317200000_admin_critical_fixes.sql:141-175`
- EXISTS. Columns: `config_key`, `config_value`, `value_type`, `description`
- RLS: authenticated users can read, admins can write
- Currently has NO global Plus flag — this is where we'd add one

### admin_grant_override()
**File:** `supabase/migrations/20260411000001_price_tier_restructure.sql:206-255`
- Validates `tier IN ('free', 'mingla_plus')` — aligned

### admin_subscription_stats()
**File:** `supabase/migrations/20260411000001_price_tier_restructure.sql:185-202`
- Returns `{ total, free, mingla_plus, overrides, expiring_soon }` — aligned

---

## Layer 2: Code (Mobile App Truth)

### Type definition
**File:** `app-mobile/src/types/subscription.ts:8`
```typescript
export type SubscriptionTier = 'free' | 'mingla_plus'
```
**Aligned** with DB CHECK constraint.

### hasElevatedAccess()
**File:** `app-mobile/src/types/subscription.ts:156-158`
```typescript
export function hasElevatedAccess(tier: SubscriptionTier): boolean {
  return tier === 'mingla_plus'
}
```
**Aligned** — checks for `'mingla_plus'`, which is what the DB now returns.

### useEffectiveTier()
**File:** `app-mobile/src/hooks/useSubscription.ts:97-125`
- Calls server RPC `get_effective_tier()` → gets `'free'` or `'mingla_plus'`
- Server tier is authoritative when available (line 118-119)
- Falls back to client-side tier (RC + Supabase) while loading
- **Aligned** — server returns values the client understands

### syncSubscriptionFromRC()
**File:** `app-mobile/src/services/subscriptionService.ts:136-162`
- Writes `tier: 'mingla_plus'` or `'free'` to DB
- **Aligned** — CHECK constraint now accepts `'mingla_plus'`

### Feature gates
**File:** `app-mobile/src/hooks/useFeatureGate.ts:29-34`
- `curated_cards` → requires `'mingla_plus'`
- `custom_starting_point` → requires `'mingla_plus'`
- `pairing` / `session_creation` → `'free'` (count-limited server-side)

### Tier limits
**File:** `app-mobile/src/constants/tierLimits.ts:16-33`
- Keys: `free`, `mingla_plus` — **aligned** with DB

### Paywall
**File:** `app-mobile/src/components/CustomPaywallScreen.tsx:55-61`
- Comparison shows Free vs Mingla+ — **aligned**

### BillingSheet
**File:** `app-mobile/src/components/profile/BillingSheet.tsx:42-66`
- Tier config keyed on `'free'` and `'mingla_plus'` — **aligned**

### RevenueCat
**File:** `app-mobile/src/services/revenueCatService.ts:22-25`
- Primary entitlement: `'Mingla Plus'`
- Legacy: `'Mingla Pro'`, `'Mingla Elite'` (backward compat in `hasMinglaPlus`)
- `hasMinglaPlus()` checks all three — returns true for any active entitlement
- `getEffectiveTierFromRC()` returns `'mingla_plus'` or `'free'` — **aligned**

---

## Layer 3: Edge Functions (Server Logic Truth)

### discover-cards/index.ts
**File:** `supabase/functions/discover-cards/index.ts:529-536`
- Calls `get_effective_tier(userId)` → receives `'free'` or `'mingla_plus'`
- No tier-based filtering on card discovery (curated cards visible to all, just not saveable)

### send-pair-request/index.ts
**File:** `supabase/functions/send-pair-request/index.ts:78`
- Calls `check_pairing_allowed(senderId)` → aligned (count-based)

### send-collaboration-invite/index.ts
**File:** `supabase/functions/send-collaboration-invite/index.ts:91-93`
- References `check_session_creation_allowed` in comments, limits enforced by trigger
- **Aligned**

---

## Layer 4: Admin Dashboard Truth

### SubscriptionManagementPage.jsx
**File:** `mingla-admin/src/pages/SubscriptionManagementPage.jsx`

- **TIER_CONFIG** (line 39-42): `{ free, mingla_plus }` — **aligned**
- **Stats** (line 166-170): Reads `s.mingla_plus` — **aligned** with RPC return
- **Tier filters** (line 536): Sends `'mingla_plus'` to RPC — **aligned**
- **Grant modal** (line 80): Defaults to `tier: "mingla_plus"` — **aligned** with validation
- **Grant RPC** (line 241-248): Sends `p_tier: grantForm.tier` — **aligned**

---

## Layer 5: Data Truth

Based on migration `20260411000001`:
- All existing `'pro'`/`'elite'` rows were converted to `'mingla_plus'` (lines 12-18)
- CHECK constraints enforce only `'free'`/`'mingla_plus'` going forward
- New signups get `tier = 'free'`, `trial_ends_at = NULL`
- Onboarding no longer grants trials

**Possible current tier values in `subscriptions`:** `'free'` or `'mingla_plus'`
**Possible current tier values in `admin_subscription_overrides`:** `'free'` or `'mingla_plus'`

---

## Contradictions Found

**NONE.** All five layers are aligned on the `free`/`mingla_plus` two-tier model. Migration `20260411000001_price_tier_restructure.sql` was comprehensive and updated every function, constraint, and RPC.

---

## Answer: How to Make Everyone Plus

### Q1: What single change would make `get_effective_tier()` return `'mingla_plus'` for every user?

Three options, ranked:

**Option A: Global flag in app_config (RECOMMENDED)**
- Insert `global_plus_access = 'true'` into `app_config`
- Add a check at the TOP of `get_effective_tier()`:
  ```sql
  -- Priority -1: Global override (pre-launch promotional access)
  IF EXISTS (
    SELECT 1 FROM app_config
    WHERE config_key = 'global_plus_access'
      AND config_value = 'true'
  ) THEN
    RETURN 'mingla_plus';
  END IF;
  ```
- **Revert:** Change the config value to `'false'`. Instant. No migration.
- **New signups:** Automatically Plus via the same check.
- **RevenueCat sync:** Unaffected — sync writes happen independently.
- **Admin dashboard:** Shows everyone as Mingla+ (accurate).

**Option B: Hardcode return**
- Replace entire `get_effective_tier()` body with `RETURN 'mingla_plus';`
- Revert requires a new migration to restore the original function.
- Blunt but effective.

**Option C: Bulk update + change signup trigger**
- `UPDATE subscriptions SET tier = 'mingla_plus', is_active = true, current_period_end = '2099-12-31';`
- Change `create_subscription_on_signup()` to insert `'mingla_plus'` instead of `'free'`
- Revert requires mass-updating rows back to `'free'` and restoring the trigger. Messy.

### Q2: What value should it be?

**`'mingla_plus'`** — this is the only elevated tier the full stack understands.

### Q3: Where would new signups need to change?

**Option A requires NO signup changes** — `get_effective_tier()` returns `'mingla_plus'` for everyone regardless of what's in the subscription row. The signup trigger continues inserting `'free'` (correct — the row reflects the user's actual subscription state, the function applies the business rule).

Option C would require changing `create_subscription_on_signup()` to insert `'mingla_plus'`.

### Q4: What breaks?

**Option A:**
- RevenueCat sync: Still works. RC writes are independent of the global flag.
- Admin dashboard: Shows everyone as Mingla+ (correct behavior).
- Feature gates: All return `canAccess = true` (intended).
- Paywall: Users can still see it, but they already have Plus. Consider hiding the paywall entirely while the flag is on (client-side check).
- Analytics: Trial/referral tracking continues to work on the subscription row level. The `useTrialExpiryTracking` hook checks `tier !== 'free'` — since everyone is Plus, it won't fire trial expiry events (correct — no one is "expiring").
- **One consideration:** The app_config query adds one DB call per `get_effective_tier()` invocation. For `admin_list_subscriptions()` which calls it per-user, this could be slow on large user counts. Mitigate by caching the config value in a session variable or checking it once in the RPC.

---

## Side Findings for Orchestrator

### 🟡 Hidden Flaw: app_config query per get_effective_tier() call
If we add the global flag check to `get_effective_tier()`, every call to the function executes an extra query against `app_config`. Functions like `admin_list_subscriptions()` and `admin_subscription_stats()` call `get_effective_tier()` once per user — this could significantly slow the admin dashboard on large user bases.

**Mitigation:** Use a PL/pgSQL session variable or `SET LOCAL` to cache the config value per transaction, or pre-read it once in the admin RPCs and pass it through.

### 🔵 Observation: Onboarding trial is dead code
`create_subscription_on_onboarding_complete()` is a no-op (line 336). The trigger itself still fires on every profile update where `has_completed_onboarding` flips to true. Not harmful (no-op is fast) but dead code. The `used_trial_phones` table and `phone_has_used_trial()` function are also dormant.

### 🔵 Observation: Legacy RevenueCat entitlements
`revenueCatService.ts` still checks for `'Mingla Pro'` and `'Mingla Elite'` entitlements (backward compat). These are dormant unless someone has an old subscription. Not a problem, just technical debt.
