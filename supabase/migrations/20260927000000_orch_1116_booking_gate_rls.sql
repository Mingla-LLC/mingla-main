-- ===========================================================================
-- ORCH-1116 — Public paid-event booking gate false-positive (booking-gate-RLS)
-- ---------------------------------------------------------------------------
-- PROVEN ROOT CAUSE (forensics, live DB evidence): the shared buyer-readiness
-- predicate public.pg_brand_can_charge(uuid) was SECURITY INVOKER and read the
-- RLS-protected public.stripe_connect_accounts table, whose only SELECT-capable
-- policy is scoped to {authenticated} brand-payments-admins. When a logged-out
-- (anon) or non-owner authenticated BUYER calls the RPC, RLS hides the row, the
-- inner EXISTS sees 0 rows, and the function returns FALSE for a brand that can
-- demonstrably charge -> the public event/experience/trip page shows "Booking
-- unavailable right now — this organizer is finishing their payment setup" with
-- a dead Get-Tickets CTA. Revenue-blocking false positive. The batched sibling
-- public.pg_brands_can_charge(uuid[]) inherited the defect (it called the inner
-- predicate per element under the same caller context).
--
-- THE ONLY CHANGE in this migration: convert BOTH predicates from
-- SECURITY INVOKER -> SECURITY DEFINER with SET search_path = '' (every
-- identifier schema-qualified). The boolean logic is BYTE-IDENTICAL to today
-- (EXISTS attached row with non-null stripe_account_id AND
-- charges_enabled IS DISTINCT FROM false). No signature change, no RETURNS
-- change, no row data ever crosses to the caller (the functions still return
-- only the single boolean / the subset of brand-ids the caller already passed).
-- A genuinely not-ready brand still returns false (true-negative preserved).
-- This matches the established pattern: every publish guard
-- (business_publish_event_draft, biz_publish_experience, ...) and every
-- buyer-supply RPC (pg_eligible_experiences_for_deck, ...) that already calls
-- pg_brand_can_charge is SECURITY DEFINER and reads the row under elevated
-- privilege. The function owner is `postgres`, which is RLS-exempt on
-- public.stripe_connect_accounts (no FORCE ROW LEVEL SECURITY on that table) —
-- the same privilege those RPCs already rely on.
--
-- WHY SET search_path = '' : a SECURITY DEFINER function with a mutable
-- search_path is a privilege-escalation vector (a caller could shadow
-- stripe_connect_accounts / unnest with a temp object). Locking search_path to
-- '' and schema-qualifying every identifier (public.stripe_connect_accounts,
-- pg_catalog.unnest) closes that vector. This is strictly safer than the
-- existing supply RPCs' `search_path = public, pg_temp`.
--
-- D-2 COMMENT CORRECTION (forward, not by rewriting applied history): the prior
-- migration 20260917000000_orch_1076_paid_supply_requires_charges_enabled.sql
-- comment claimed pg_brand_can_charge "exposes NO row data ... (mirrors the
-- anon-safe posture of the SECURITY-DEFINER supply RPCs)". That was the
-- load-bearing error — the function was actually SECURITY INVOKER, so granting
-- EXECUTE to anon did NOT make it anon-safe. THIS migration makes that posture
-- true. The applied 20260917000000 migration is immutable and is NOT edited;
-- the corrected COMMENT ON FUNCTION below records the real security posture.
--
-- NO DROP is needed: neither signature nor RETURNS changes, so
-- CREATE OR REPLACE FUNCTION suffices and is idempotent + safe to re-run.
-- (DROP would only be required when widening a RETURNS TABLE.)
--
-- Bodies use the $function$ dollar-tag (NOT $$) so the trailing GRANT / COMMENT
-- statements parse cleanly per the safe-migration protocol ($function$; before
-- any GRANT).
--
-- MONOTONIC VERSION: 20260927000000 is strictly greater than the current max
-- migration prefix across anchor main + all sibling worktrees, which is
-- 20260926000000 (orch_1111_oauth_null_email_accept.sql). Re-confirmed at
-- IMPLEMENT by scanning supabase/migrations/ and ~/Desktop/mingla-orchs/*/.
--
-- DO NOT run `supabase db push` from the implementor. The orchestrator applies
-- this migration via the Supabase Management API after REVIEW (the CLI is
-- drift-wedged; MCP apply_migration / Management API is the apply path).
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Function A — pg_brand_can_charge(uuid): the buyer-readiness predicate.
-- INVOKER -> DEFINER + SET search_path = ''. Boolean logic byte-identical.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pg_brand_can_charge(p_brand_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
      FROM public.stripe_connect_accounts s
     WHERE s.brand_id = p_brand_id
       AND s.detached_at IS NULL
       AND s.stripe_account_id IS NOT NULL
       AND s.charges_enabled IS DISTINCT FROM false  -- true only
  );
$function$;

-- Re-assert the existing grants (ORCH-1075 granted authenticated; ORCH-1076
-- extended to anon). SECURITY DEFINER does not change WHO may CALL, only the
-- privilege the body runs under.
GRANT EXECUTE ON FUNCTION public.pg_brand_can_charge(uuid) TO anon, authenticated;

COMMENT ON FUNCTION public.pg_brand_can_charge(uuid) IS
  'ORCH-1116 (was ORCH-1075): canonical buyer-readiness predicate. SECURITY DEFINER with SET search_path = '''' — reads public.stripe_connect_accounts under definer (postgres, RLS-exempt) privilege so anon / non-owner authenticated BUYERS get the correct answer WITHOUT any row exposure. Returns ONLY a boolean (true iff the brand has an attached, non-detached stripe_connect_accounts row with a non-null stripe_account_id and charges_enabled IS DISTINCT FROM false). No stripe_account_id / charges_enabled / payouts_enabled value ever crosses to the caller. Corrects the 20260917000000 comment that wrongly called the (then INVOKER) function anon-safe.';

-- ---------------------------------------------------------------------------
-- Function B — pg_brands_can_charge(uuid[]): batched readiness resolver.
-- INVOKER -> DEFINER + SET search_path = ''. pg_catalog.unnest qualified.
-- Defense-in-depth: it reads correctly under any caller regardless of the inner
-- predicate's security mode; it still delegates to pg_brand_can_charge(bid) for
-- single-source-of-truth on the predicate logic. Returns only the subset of the
-- input brand-ids the caller already supplied (never a stripe_connect_accounts
-- field).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pg_brands_can_charge(p_brand_ids uuid[])
RETURNS TABLE (brand_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT bid
  FROM pg_catalog.unnest(p_brand_ids) AS bid
  WHERE public.pg_brand_can_charge(bid);
$function$;

-- Re-assert the existing grants (ORCH-1076 granted anon, authenticated, service_role).
GRANT EXECUTE ON FUNCTION public.pg_brands_can_charge(uuid[]) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.pg_brands_can_charge(uuid[]) IS
  'ORCH-1116 (was ORCH-1076) I-PAID-SUPPLY-REQUIRES-CHARGES-ENABLED: batched readiness resolver. SECURITY DEFINER with SET search_path = '''' — returns the subset of p_brand_ids whose brand can charge (pg_brand_can_charge=true), readable correctly by anon / non-owner authenticated buyers without row exposure. Delegates to public.pg_brand_can_charge for the predicate; the outer DEFINER + pg_catalog.unnest guarantee correctness under any caller. Used by discover-merged-events (service-role) + buyer-side post-fetch filters to gate paid buyer-supply in one round-trip.';

COMMIT;
