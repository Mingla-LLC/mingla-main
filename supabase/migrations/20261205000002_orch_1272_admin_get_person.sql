-- ORCH-1272 [Admin Identity console — READ-ONLY] — unified Person read-RPC.
--
-- admin_get_person(p_user_id uuid) RETURNS jsonb — the single atomic read behind
-- the admin console's "unified Person" view. It joins a user's BOTH halves —
-- consumer profile (profiles) + business account (creator_accounts, shared PK) +
-- brands owned / member-of + subscription (effective tier + active override) +
-- support tickets — in one round-trip.
--
-- Why an RPC (not browser RLS): the bundle crosses the sensitive
-- subscriptions / admin_subscription_overrides tables (which have NO admin
-- browser RLS by design) and derives the effective tier + segment. SECURITY
-- DEFINER + a guard-FIRST is_admin_user() check keeps that data server-side and
-- admin-only. Precedent: admin_get_claim_review_bundle.
--
-- READ-ONLY: performs no mutation → it is NOT in the i-admin-write-audited
-- write-RPC registry and does NOT call admin_write_audit. It IS appended to the
-- i-admin-gate-first-statement registry (the guard must be the first statement).
--
-- Shared-PK facts (verified live): profiles.id = creator_accounts.id = auth.uid();
-- brands.account_id → creator_accounts.id (owner); brand_team_members.user_id,
-- subscriptions.user_id, admin_subscription_overrides.user_id,
-- support_tickets.requester_user_id all = the same uid. Reuses the existing
-- SECURITY DEFINER helpers get_effective_tier(uuid) + derive_user_segment(uuid).
--
-- Enforces: I-PROPOSED-1272-IDENTITY-ADMIN-READ,
--           I-PROPOSED-1271-ADMIN-GATE-FIRST-STATEMENT.

CREATE OR REPLACE FUNCTION public.admin_get_person(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_out jsonb; v_ov RECORD;
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;  -- (I-ADMIN-GATE-FIRST-STATEMENT)
  SELECT to_jsonb(p) INTO v_out FROM public.profiles p WHERE p.id = p_user_id;
  IF v_out IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  v_out := jsonb_build_object(
    'person',  v_out || jsonb_build_object('segment', public.derive_user_segment(p_user_id)),
    'account', (SELECT to_jsonb(a) FROM public.creator_accounts a WHERE a.id = p_user_id),
    'brands_owned', COALESCE((SELECT jsonb_agg(to_jsonb(b) ORDER BY b.created_at DESC)
                              FROM public.brands b WHERE b.account_id = p_user_id), '[]'::jsonb),
    'brands_member', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                                 'brand_id', b.id, 'brand_name', b.name, 'brand_slug', b.slug,
                                 'role', m.role, 'accepted_at', m.accepted_at, 'removed_at', m.removed_at))
                              FROM public.brand_team_members m JOIN public.brands b ON b.id = m.brand_id
                              WHERE m.user_id = p_user_id), '[]'::jsonb),
    'subscription', jsonb_build_object(
        'effective_tier', public.get_effective_tier(p_user_id),
        'raw', (SELECT to_jsonb(s) FROM public.subscriptions s WHERE s.user_id = p_user_id)),
    'active_override', (SELECT to_jsonb(o) FROM public.admin_subscription_overrides o
                        WHERE o.user_id = p_user_id AND o.revoked_at IS NULL
                          AND o.starts_at <= now() AND o.expires_at > now()
                        ORDER BY o.expires_at DESC LIMIT 1),
    'tickets', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                            'id', t.id, 'subject', t.subject, 'status', t.status, 'priority', t.priority,
                            'brand_id', t.brand_id, 'created_at', t.created_at, 'last_message_at', t.last_message_at)
                            ORDER BY t.last_message_at DESC)
                         FROM public.support_tickets t WHERE t.requester_user_id = p_user_id), '[]'::jsonb));
  RETURN v_out;
END; $$;

--------------------------------------------------------------------------------
-- Least-privilege (ORCH-1271 P0 golden template — now MANDATORY for every admin
-- RPC): functions default to PUBLIC EXECUTE. admin_get_person is a user-JWT admin
-- read (the admin UI calls it via the anon key + an authenticated admin JWT; the
-- internal is_admin_user() guard is the real gate). Lock EXECUTE to authenticated
-- ONLY; anon / PUBLIC get nothing. Defense-in-depth behind the guard-first check.
--------------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.admin_get_person(uuid) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_get_person(uuid) TO authenticated;

--------------------------------------------------------------------------------
-- Self-assert: apply FAILS unless the privilege lockdown holds (anon cannot
-- execute; authenticated can). Runtime-proves the containment at apply time.
--------------------------------------------------------------------------------
DO $$
BEGIN
  IF has_function_privilege('anon', 'public.admin_get_person(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ORCH-1272: admin_get_person still EXECUTE-able by anon';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.admin_get_person(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ORCH-1272: authenticated lost EXECUTE on admin_get_person (admin UI would break)';
  END IF;
END $$;
