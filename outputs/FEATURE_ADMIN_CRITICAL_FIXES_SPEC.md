# Feature Spec: Admin Critical Fixes

## Summary

Five critical security and integration issues were found during the admin panel forensic audit.
This spec defines the exact fixes for: (1) privilege escalation via `admin_users` RLS, (2) mobile
blindness to admin subscription overrides, (3) missing admin auth on `admin-place-search` edge
function, (4) silent failure of `place_pool` UPDATE from admin, and (5) four missing tables and
one missing edge function that render AppConfigPage and EmailPage non-functional.

## User Stories

- As an admin, I want only active admins to be able to modify the `admin_users` table, so that
  mobile users cannot escalate their privileges.
- As a user who received an admin subscription override, I want to see my upgraded tier in the
  mobile app, so that I can access the features the admin granted me.
- As an admin, I want the `admin-place-search` edge function to reject non-admin callers, so that
  mobile users cannot burn Google API quota or manipulate the place pool.
- As an admin, I want to toggle place active/inactive status from the admin dashboard, so that
  the update actually persists instead of silently failing.
- As an admin, I want AppConfigPage and EmailPage to be functional, so that I can manage feature
  flags, app config, integrations, and send emails.

## Success Criteria

1. A mobile user calling `supabase.from('admin_users').insert(...)` receives an RLS error.
2. A mobile user calling `supabase.from('admin_users').update(...)` receives an RLS error.
3. A mobile user calling `supabase.from('admin_users').delete(...)` receives an RLS error.
4. An active admin can still INSERT/UPDATE/DELETE on `admin_users` from the admin dashboard.
5. When an admin grants an Elite override via the admin dashboard, the mobile app shows the
   user's tier as `elite` within one React Query refetch cycle (≤5 minutes or on next app open).
6. The mobile paywall correctly reflects the overridden tier — feature gates open for the user.
7. A mobile user calling the `admin-place-search` edge function receives a 403 Forbidden.
8. An active admin calling `admin-place-search` succeeds as before.
9. Toggling a place active/inactive in PlacePoolBuilderPage persists the change to the database.
10. Bulk deactivation in PlacePoolBuilderPage persists correctly.
11. AppConfigPage's Feature Flags tab loads, creates, toggles, and deletes flags.
12. AppConfigPage's App Config tab loads, creates, edits, and deletes config entries.
13. AppConfigPage's Integrations tab loads, adds, edits, and removes integrations.
14. EmailPage's Compose tab sends emails via the `admin-send-email` edge function.
15. EmailPage's History tab loads sent email logs.

## Affected Domains

**Cross-domain.** All three domains are affected:
- **Backend (supabase/):** 1 new migration, 1 new edge function, 1 modified edge function
- **Mobile (app-mobile/):** Modified subscription hook and types
- **Admin (mingla-admin/):** Modified PlacePoolBuilderPage (route updates through RPC)

---

## §1 — Database Changes

### Migration file: `supabase/migrations/20260317200000_admin_critical_fixes.sql`

```sql
-- =============================================================
-- CRIT-1: Fix admin_users RLS — restrict mutations to active admins
-- =============================================================

-- Drop the overly permissive policies
DROP POLICY IF EXISTS "Allow authenticated insert" ON public.admin_users;
DROP POLICY IF EXISTS "Allow authenticated update" ON public.admin_users;
DROP POLICY IF EXISTS "Allow authenticated delete" ON public.admin_users;

-- New: Only active admins can INSERT
CREATE POLICY "admin_insert_admin_users" ON public.admin_users
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.admin_users au
      WHERE au.email = auth.email()
        AND au.status = 'active'
    )
  );

-- New: Only active admins can UPDATE
CREATE POLICY "admin_update_admin_users" ON public.admin_users
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.admin_users au
      WHERE au.email = auth.email()
        AND au.status = 'active'
    )
  );

-- New: Only active admins can DELETE
CREATE POLICY "admin_delete_admin_users" ON public.admin_users
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.admin_users au
      WHERE au.email = auth.email()
        AND au.status = 'active'
    )
  );

-- =============================================================
-- CRIT-4: Fix place_pool RLS — add admin-restricted UPDATE policy
-- =============================================================

CREATE POLICY "admin_update_place_pool" ON public.place_pool
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.admin_users au
      WHERE au.email = auth.email()
        AND au.status = 'active'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.admin_users au
      WHERE au.email = auth.email()
        AND au.status = 'active'
    )
  );

-- =============================================================
-- CRIT-5a: Create feature_flags table
-- =============================================================

CREATE TABLE IF NOT EXISTS public.feature_flags (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flag_key    TEXT UNIQUE NOT NULL,
  is_enabled  BOOLEAN NOT NULL DEFAULT false,
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.feature_flags ENABLE ROW LEVEL SECURITY;

-- Any authenticated user can read flags (mobile may need to check flags)
CREATE POLICY "authenticated_read_feature_flags" ON public.feature_flags
  FOR SELECT TO authenticated USING (true);

-- Only admins can mutate
CREATE POLICY "admin_insert_feature_flags" ON public.feature_flags
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.admin_users WHERE email = auth.email() AND status = 'active'));

CREATE POLICY "admin_update_feature_flags" ON public.feature_flags
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.admin_users WHERE email = auth.email() AND status = 'active'));

CREATE POLICY "admin_delete_feature_flags" ON public.feature_flags
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.admin_users WHERE email = auth.email() AND status = 'active'));

CREATE TRIGGER set_feature_flags_updated_at
  BEFORE UPDATE ON public.feature_flags
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =============================================================
-- CRIT-5b: Create app_config table
-- (NOT the same as admin_config — this is for the AppConfigPage)
-- =============================================================

CREATE TABLE IF NOT EXISTS public.app_config (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  config_key   TEXT UNIQUE NOT NULL,
  config_value TEXT NOT NULL DEFAULT '',
  value_type   TEXT NOT NULL DEFAULT 'string' CHECK (value_type IN ('string', 'number', 'boolean', 'json')),
  description  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_read_app_config" ON public.app_config
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "admin_insert_app_config" ON public.app_config
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.admin_users WHERE email = auth.email() AND status = 'active'));

CREATE POLICY "admin_update_app_config" ON public.app_config
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.admin_users WHERE email = auth.email() AND status = 'active'));

CREATE POLICY "admin_delete_app_config" ON public.app_config
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.admin_users WHERE email = auth.email() AND status = 'active'));

CREATE TRIGGER set_app_config_updated_at
  BEFORE UPDATE ON public.app_config
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =============================================================
-- CRIT-5c: Create integrations table
-- =============================================================

CREATE TABLE IF NOT EXISTS public.integrations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_name    TEXT UNIQUE NOT NULL,
  display_name    TEXT NOT NULL,
  description     TEXT,
  is_enabled      BOOLEAN NOT NULL DEFAULT true,
  api_key_preview TEXT,          -- last 4 chars only, never full key
  config_data     JSONB DEFAULT '{}'::jsonb,
  last_checked_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.integrations ENABLE ROW LEVEL SECURITY;

-- Only admins can read integrations (contains sensitive API key previews)
CREATE POLICY "admin_all_integrations" ON public.integrations
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.admin_users WHERE email = auth.email() AND status = 'active'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.admin_users WHERE email = auth.email() AND status = 'active'));

CREATE TRIGGER set_integrations_updated_at
  BEFORE UPDATE ON public.integrations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =============================================================
-- CRIT-5d: Create admin_email_log table
-- =============================================================

CREATE TABLE IF NOT EXISTS public.admin_email_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject         TEXT NOT NULL,
  body            TEXT NOT NULL,
  from_name       TEXT,
  from_email      TEXT,
  recipient_type  TEXT NOT NULL CHECK (recipient_type IN ('individual', 'bulk')),
  recipient_email TEXT,            -- for individual sends
  segment_filter  JSONB,           -- for bulk sends
  recipient_count INTEGER NOT NULL DEFAULT 0,
  sent_count      INTEGER NOT NULL DEFAULT 0,
  failed_count    INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'sent', 'partial', 'failed')),
  template_used   TEXT,
  sent_by         UUID REFERENCES auth.users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_admin_email_log_created ON public.admin_email_log (created_at DESC);

ALTER TABLE public.admin_email_log ENABLE ROW LEVEL SECURITY;

-- Only admins can read/write email logs
CREATE POLICY "admin_all_email_log" ON public.admin_email_log
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.admin_users WHERE email = auth.email() AND status = 'active'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.admin_users WHERE email = auth.email() AND status = 'active'));
```

---

## §2 — Edge Functions

### §2.1 — Fix `admin-place-search` (CRIT-3)

**File:** `supabase/functions/admin-place-search/index.ts`

**Change:** After the `getUser(token)` check (line 269-275), add an admin authorization check
before processing any action.

**Insert after line 275** (after the `if (authError || !user)` block, before `const body = await req.json()`):

```typescript
    // ── ADMIN CHECK ──────────────────────────────────────────────────
    const { data: adminRow } = await supabase
      .from("admin_users")
      .select("id")
      .eq("email", user.email)
      .eq("status", "active")
      .maybeSingle();

    if (!adminRow) {
      return new Response(
        JSON.stringify({ error: "Forbidden: admin access required" }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }
    // ── END ADMIN CHECK ──────────────────────────────────────────────
```

**Why `maybeSingle()` and not `single()`:** If the email doesn't exist in `admin_users`, `.single()` throws. `.maybeSingle()` returns null, which we check.

**Note:** The `supabase` client here uses `SUPABASE_SERVICE_ROLE_KEY` (line 264), so it bypasses
RLS on `admin_users`. This is correct — we need to read the admin table to verify the caller.

### §2.2 — Create `admin-send-email` edge function (CRIT-5)

**File:** `supabase/functions/admin-send-email/index.ts`

```typescript
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function sendViaResend(
  to: string,
  subject: string,
  body: string,
  fromName: string,
  fromEmail: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `${fromName} <${fromEmail}>`,
        to: [to],
        subject,
        text: body,
      }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      return { ok: false, error: `Resend ${res.status}: ${errBody}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Auth
    const authHeader = req.headers.get("authorization");
    if (!authHeader) return jsonResponse({ error: "No authorization header" }, 401);

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return jsonResponse({ error: "Unauthorized" }, 401);

    // Admin check
    const { data: adminRow } = await supabase
      .from("admin_users")
      .select("id")
      .eq("email", user.email)
      .eq("status", "active")
      .maybeSingle();
    if (!adminRow) return jsonResponse({ error: "Forbidden: admin access required" }, 403);

    const body = await req.json();
    const { action } = body;

    if (action === "check_provider") {
      // EmailPage calls this on mount to verify Resend is configured
      return jsonResponse({
        provider: "resend",
        configured: !!RESEND_API_KEY,
        from_domain: body.fromEmail || "noreply@usemingla.com",
      });
    }

    if (action === "estimate") {
      // Estimate recipient count for a segment
      const { segment } = body;
      let query = supabase.from("profiles").select("id", { count: "exact", head: true });

      if (segment?.type === "country") {
        query = query.eq("country", segment.country);
      } else if (segment?.type === "onboarding") {
        query = query.eq("has_completed_onboarding", segment.onboarding === "completed");
      } else if (segment?.type === "status") {
        if (segment.status === "banned") query = query.eq("is_banned", true);
        else if (segment.status === "active") query = query.eq("is_banned", false);
      }

      const { count, error } = await query;
      if (error) return jsonResponse({ error: error.message }, 400);
      return jsonResponse({ will_receive: count || 0 });
    }

    if (action === "send") {
      // Individual email
      const { to, subject, body: emailBody, fromName, fromEmail } = body;
      if (!to || !subject || !emailBody) {
        return jsonResponse({ error: "to, subject, body are required" }, 400);
      }

      const result = await sendViaResend(
        to,
        subject,
        emailBody,
        fromName || "Mingla",
        fromEmail || "noreply@usemingla.com"
      );

      return jsonResponse({
        sent: result.ok ? 1 : 0,
        failed: result.ok ? 0 : 1,
        errors: result.error ? [result.error] : [],
      });
    }

    if (action === "send_bulk") {
      // Bulk email to segment
      const { segment, subject, body: emailBody, fromName, fromEmail } = body;
      if (!subject || !emailBody) {
        return jsonResponse({ error: "subject, body are required" }, 400);
      }

      // Fetch recipients
      let query = supabase.from("profiles").select("id, email, first_name").not("email", "is", null);

      if (segment?.type === "country") {
        query = query.eq("country", segment.country);
      } else if (segment?.type === "onboarding") {
        query = query.eq("has_completed_onboarding", segment.onboarding === "completed");
      } else if (segment?.type === "status") {
        if (segment.status === "banned") query = query.eq("is_banned", true);
        else if (segment.status === "active") query = query.eq("is_banned", false);
      }

      const { data: recipients, error } = await query.limit(500);
      if (error) return jsonResponse({ error: error.message }, 400);

      let sent = 0;
      let failed = 0;
      const errors: string[] = [];

      for (const r of recipients || []) {
        if (!r.email) { failed++; continue; }
        const personalizedBody = emailBody.replace(/{name}/g, r.first_name || "there");
        const result = await sendViaResend(
          r.email,
          subject,
          personalizedBody,
          fromName || "Mingla",
          fromEmail || "noreply@usemingla.com"
        );
        if (result.ok) sent++;
        else {
          failed++;
          if (errors.length < 10) errors.push(`${r.email}: ${result.error}`);
        }
      }

      return jsonResponse({ sent, failed, errors });
    }

    return jsonResponse({ error: `Unknown action: ${action}` }, 400);

  } catch (err) {
    return jsonResponse({ error: err.message }, 500);
  }
});
```

**Environment variable required:** `RESEND_API_KEY` must be set in Supabase Edge Function secrets.

---

## §3 — Mobile Implementation (CRIT-2)

### §3.1 — Service: Add `getEffectiveTierFromServer`

**File:** `app-mobile/src/services/subscriptionService.ts`

**Add this function** at the end of the file:

```typescript
/**
 * Calls the server-side get_effective_tier() RPC which checks admin overrides
 * as Priority 0, then RevenueCat sync, then trial/referral.
 * Returns the tier string or 'free' on error.
 */
export async function getEffectiveTierFromServer(userId: string): Promise<string> {
  const { data, error } = await supabase.rpc('get_effective_tier', {
    p_user_id: userId,
  })

  if (error) {
    console.warn('getEffectiveTierFromServer failed, falling back to free:', error.message)
    return 'free'
  }

  return data ?? 'free'
}
```

### §3.2 — Hook: Add `useServerTier` and integrate into `useEffectiveTier`

**File:** `app-mobile/src/hooks/useSubscription.ts`

**Add import** at top:

```typescript
import { getEffectiveTierFromServer } from '../services/subscriptionService'
```

**Add new query key:**

```typescript
export const subscriptionKeys = {
  all: ['subscription'] as const,
  detail: (userId: string) => [...subscriptionKeys.all, userId] as const,
  referrals: (userId: string) => [...subscriptionKeys.all, 'referrals', userId] as const,
  referralStats: (userId: string) => [...subscriptionKeys.all, 'referral-stats', userId] as const,
  serverTier: (userId: string) => [...subscriptionKeys.all, 'server-tier', userId] as const,
}
```

**Add new hook** after `useSubscription`:

```typescript
/**
 * Fetches the authoritative tier from the server-side get_effective_tier() RPC.
 * This includes admin subscription overrides which the client-side logic cannot see.
 * staleTime matches useSubscription (5 min) — admin overrides are not time-critical.
 */
export function useServerTier(userId: string | undefined) {
  return useQuery({
    queryKey: subscriptionKeys.serverTier(userId ?? ''),
    queryFn: () => getEffectiveTierFromServer(userId!),
    enabled: !!userId,
    staleTime: 5 * 60 * 1000,
  })
}
```

**Modify `useEffectiveTier`** to incorporate server tier:

```typescript
export function useEffectiveTier(userId: string | undefined): SubscriptionTier {
  const { data: customerInfo } = useCustomerInfo()
  const { data: subscription } = useSubscription(userId)
  const { data: serverTier } = useServerTier(userId)
  const profile = useAppStore((s) => s.profile)

  // Client-side tier (RevenueCat + Supabase subscriptions table)
  const clientTier = getEffectiveTier(
    customerInfo ?? null,
    subscription ?? null,
    profile?.has_completed_onboarding ?? undefined,
  )

  // Server tier includes admin overrides — take the higher of the two
  if (serverTier && serverTier !== 'free') {
    const tierRank: Record<string, number> = { free: 0, pro: 1, elite: 2 }
    const serverRank = tierRank[serverTier] ?? 0
    const clientRank = tierRank[clientTier] ?? 0
    if (serverRank > clientRank) {
      return serverTier as SubscriptionTier
    }
  }

  return clientTier
}
```

**Why take the higher of client and server:** RevenueCat entitlements may not be reflected
server-side immediately (SDK latency). Admin overrides are only server-side. Taking the max
ensures neither source can downgrade the user.

### §3.3 — Types: No changes needed

`subscription.ts` types file does not need modification. The server tier is a simple string
returned by the RPC, cast to `SubscriptionTier` in the hook.

---

## §4 — Admin Implementation

### §4.1 — No changes needed for PlacePoolBuilderPage

The CRIT-4 fix is entirely in the RLS policy (§1). The admin page's `.update()` calls at
lines 773-776 and 864-867 will work once the `admin_update_place_pool` policy exists,
because the admin user's JWT contains their email, and the policy checks that email against
`admin_users`. No code changes needed.

### §4.2 — No changes needed for AppConfigPage or EmailPage

Both pages are already fully built with correct table names and column schemas. The CRIT-5
fix creates the tables they expect. Once the migration runs, these pages become functional
with zero code changes.

---

## §5 — Implementation Order

| Step | What | Domain | Depends On |
|------|------|--------|-----------|
| 1 | Apply migration `20260317200000_admin_critical_fixes.sql` | Backend | Nothing |
| 2 | Deploy `admin-send-email` edge function | Backend | Step 1 (needs RESEND_API_KEY secret) |
| 3 | Modify `admin-place-search` edge function — add admin check | Backend | Step 1 |
| 4 | Add `getEffectiveTierFromServer` to `subscriptionService.ts` | Mobile | Step 1 |
| 5 | Add `useServerTier` hook and modify `useEffectiveTier` | Mobile | Step 4 |
| 6 | Verify admin dashboard pages work | Admin | Steps 1-3 |

Steps 2, 3, 4 can run in parallel after Step 1.

---

## §6 — Test Cases

### CRIT-1: admin_users RLS

| # | Scenario | Input | Expected | Layer |
|---|----------|-------|----------|-------|
| 1 | Mobile user inserts into admin_users | `supabase.from('admin_users').insert({email:'attacker@evil.com'})` with mobile JWT | RLS error, row NOT inserted | DB |
| 2 | Mobile user updates admin_users | `.update({status:'active'}).eq('email','seth@usemingla.com')` with mobile JWT | RLS error, 0 rows affected | DB |
| 3 | Mobile user deletes from admin_users | `.delete().eq('email','seth@usemingla.com')` with mobile JWT | RLS error, 0 rows affected | DB |
| 4 | Active admin inserts | Same insert with admin JWT | Row inserted successfully | DB |
| 5 | Active admin updates | Same update with admin JWT | Row updated successfully | DB |
| 6 | Revoked admin inserts | Insert with revoked admin JWT | RLS error | DB |

### CRIT-2: Mobile tier resolution with admin overrides

| # | Scenario | Input | Expected | Layer |
|---|----------|-------|----------|-------|
| 7 | User has admin elite override | `get_effective_tier(user_id)` RPC | Returns 'elite' | DB |
| 8 | useServerTier returns 'elite' | userId with active override | Hook returns 'elite' | Mobile |
| 9 | useEffectiveTier picks higher | Client='free', server='elite' | Returns 'elite' | Mobile |
| 10 | useEffectiveTier respects RC | Client='elite' (RC), server='pro' (override) | Returns 'elite' (client wins) | Mobile |
| 11 | No override, no RC | Client='free', server='free' | Returns 'free' | Mobile |
| 12 | RPC fails | Network error | Falls back to client-side tier | Mobile |

### CRIT-3: admin-place-search auth

| # | Scenario | Input | Expected | Layer |
|---|----------|-------|----------|-------|
| 13 | Mobile user calls search | Valid JWT, non-admin email | 403 Forbidden | Edge fn |
| 14 | Active admin calls search | Valid JWT, admin email | 200 + results | Edge fn |
| 15 | No auth header | No Authorization header | 401 Unauthorized | Edge fn |

### CRIT-4: place_pool UPDATE

| # | Scenario | Input | Expected | Layer |
|---|----------|-------|----------|-------|
| 16 | Admin toggles active | `.update({is_active: false}).eq('id', placeId)` with admin JWT | Row updated, is_active = false | DB |
| 17 | Mobile user attempts update | Same update with mobile JWT | 0 rows affected (no UPDATE policy for non-admins) | DB |
| 18 | Admin bulk deactivate | Multiple `.update()` calls with admin JWT | All rows updated | DB |

### CRIT-5: Missing tables + edge function

| # | Scenario | Input | Expected | Layer |
|---|----------|-------|----------|-------|
| 19 | Feature flags loads | `supabase.from('feature_flags').select('*')` | Returns rows (or empty array) | DB |
| 20 | Admin creates flag | `.insert({flag_key:'test', is_enabled:false})` | Row created | DB |
| 21 | App config loads | `supabase.from('app_config').select('*')` | Returns rows (or empty array) | DB |
| 22 | Integrations loads | `supabase.from('integrations').select('*')` with admin JWT | Returns rows | DB |
| 23 | Non-admin reads integrations | Same select with mobile JWT | Returns 0 rows (RLS) | DB |
| 24 | Email send individual | POST admin-send-email `{action:'send', to:'x@y.com', subject:'Hi', body:'Test'}` | Returns `{sent:1, failed:0}` | Edge fn |
| 25 | Email estimate | POST admin-send-email `{action:'estimate', segment:{type:'all'}}` | Returns `{will_receive: N}` | Edge fn |
| 26 | Email log persists | After send, query admin_email_log | Row exists with correct data | DB |

---

## §7 — Common Mistakes

1. **Do NOT use `auth.uid()` in admin_users RLS policies.** The admin_users table stores emails,
   not UUIDs. Use `auth.email()` to match against the `email` column.

2. **Do NOT remove the anon SELECT policy on admin_users.** The admin login flow needs to check
   if an email is allowed BEFORE the user is authenticated. The `USING (true)` on SELECT is
   intentional for the login check.

3. **Do NOT make `useServerTier` the sole tier source.** RevenueCat entitlements must still be
   checked client-side for immediate feedback. The server RPC adds admin overrides as a
   supplementary source.

4. **Do NOT use `.single()` in the admin check query.** If the email is not in admin_users,
   `.single()` throws. Use `.maybeSingle()`.

5. **Do NOT store full API keys in the `integrations` table.** Only store `api_key_preview`
   (last 4 chars). Full keys go in Supabase Edge Function secrets.

6. **The `admin-send-email` function must have `RESEND_API_KEY` set** in Supabase secrets
   before deployment. Without it, the check_provider action returns `configured: false` and
   EmailPage shows the setup screen (this is correct graceful degradation).

---

## §8 — Regression Prevention

### Structural Safeguards

| Safeguard | What it prevents |
|-----------|-----------------|
| RLS policies check `admin_users.email = auth.email() AND status = 'active'` | Non-admin mutation of admin tables |
| `place_pool` UPDATE policy restricted to admins | Non-admin manipulation of place pool |
| `.maybeSingle()` in edge function admin check | Crash when non-admin calls the function |
| `max(clientTier, serverTier)` in `useEffectiveTier` | Admin override downgrading a paid RC user |

### Validation Safeguards

| Safeguard | What it validates |
|-----------|------------------|
| Edge function checks `adminRow` is not null before processing | Rejects non-admin callers with 403 |
| `getEffectiveTierFromServer` catches RPC errors and falls back to 'free' | Network failures don't crash tier resolution |
| Email edge function validates `to`, `subject`, `body` before sending | Prevents malformed Resend API calls |

### Regression Tests

| Test | Input | Expected Result |
|------|-------|-----------------|
| Mobile user INSERTs into admin_users | Authenticated mobile JWT | RLS policy violation error |
| Mobile user calls admin-place-search | Authenticated mobile JWT | 403 Forbidden |
| Admin toggles place_pool is_active | Authenticated admin JWT | Row updated successfully |
| useEffectiveTier with server='elite' | Server RPC returns 'elite', RC returns 'free' | Hook returns 'elite' |
| useEffectiveTier with RPC failure | Server RPC throws | Hook returns client-side tier (graceful fallback) |
| feature_flags SELECT by mobile user | Authenticated mobile JWT | Returns rows (read is allowed) |
| integrations SELECT by mobile user | Authenticated mobile JWT | Returns 0 rows (admin-only read) |

---

## §9 — Handoff to Implementor

**Priority order:** Run the migration first — it fixes 4 of 5 issues instantly (RLS fixes, missing
tables). Then deploy `admin-send-email` edge function (requires `RESEND_API_KEY` secret). Then
add the admin check to `admin-place-search`. Finally, modify the mobile subscription hook to
incorporate server-side tier resolution.

**What to watch out for:**
- The RLS policies use `auth.email()` not `auth.uid()` — this is intentional
- The `admin-send-email` function needs the `RESEND_API_KEY` environment secret configured
- The mobile tier hook change adds one RPC call per user session — it's cached for 5 minutes,
  so the cost is negligible
- Test with a non-admin mobile user to verify all 3 security fixes reject correctly
