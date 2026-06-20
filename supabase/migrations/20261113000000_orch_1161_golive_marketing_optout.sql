-- META-ORCH-1161 go-live-prep (DEC-191 / Decision A) — marketing is ENROLLED-BY-
-- DEFAULT (opt-out), NOT opt-in.
--
-- Today (shipped Sub-A) marketing is opt-IN: can_send() denied a marketing
-- (is_transactional=false) category unless an explicit notification_channel_prefs
-- row with enabled=true existed, and the prefs UI defaulted marketing chips OFF.
-- That contradicts DEC-186/DEC-191 "everyone who signs up/checks out consents to
-- marketing → auto-enrolled." marketing-send/marketingAudience ALREADY behaved
-- opt-out (they blast every non-suppressed brand buyer). This migration closes the
-- gap on the can_send() side and adds the RLS-correct write path the consumer
-- prefs UI uses so a marketing opt-out lands in channel_suppressions — the SINGLE
-- source of truth for "opted out of marketing" honored by BOTH can_send() AND
-- marketing-send/marketingAudience.
--
-- TWO changes, both additive (no table/column/constraint change):
--   §1. CREATE OR REPLACE public.can_send(...) — marketing categories become
--       DEFAULT-ON: return true UNLESS an explicit per-(category,channel) pref
--       enabled=false OR a channel_suppressions row (scope ∈ {marketing,'all'}).
--       Transactional behavior is byte-identical to the prior version.
--   §2. NEW SECURITY DEFINER RPC public.set_marketing_suppression(channel, suppress)
--       — the authenticated consumer prefs UI cannot write channel_suppressions
--       directly (RLS: service-role writes only). This RPC resolves the CALLER's
--       own email + phone (auth.uid()) and inserts (opt-out) or deletes (opt-in)
--       channel_suppressions(scope='marketing') rows keyed by BOTH user_id AND
--       contact, so the round-trip is honored by can_send (user_id|contact match)
--       AND the contact-keyed audience resolver.
--
-- Cross-refs:
--   SPEC:  Mingla_Artifacts/specs/SPEC_META-ORCH-1161_NOTIFICATION_MESSAGING_SYSTEM.md
--          §5.3 (can_send), §10 (revocation via prefs UI → channel_suppressions).
--   Prior: 20261110000002_orch_1161_can_send_and_reservation_trigger.sql (replaced fn).
--   Email-resolution pattern mirrored from 20260926000000_orch_1111_oauth_null_email_accept.sql.

-- =============================================================
-- §1. can_send() — marketing default-ON (opt-out), suppressible.
-- =============================================================
-- Returns true iff:
--   category active
--   AND channel ∈ category.default_channels
--   AND NOT an explicit per-(category,channel) opt-out row (enabled=false)
--       -- DEC-191: marketing no longer requires enabled=true; default ON like
--       -- transactional. The ONLY pref that blocks is an explicit enabled=false.
--   AND no suppression for (user|contact, channel, scope ∈ {category_scope,'all'})
--       -- channel_suppressions stays the single opt-out authority for marketing.
CREATE OR REPLACE FUNCTION public.can_send(
  p_user_id uuid,
  p_category_key text,
  p_channel text,
  p_contact text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_cat            public.notification_categories%ROWTYPE;
  v_pref_enabled   boolean;
  v_category_scope text;
  v_suppressed     boolean;
BEGIN
  -- 1. Category must exist + be active.
  SELECT * INTO v_cat
    FROM public.notification_categories
   WHERE key = p_category_key;
  IF NOT FOUND OR v_cat.active IS NOT TRUE THEN
    RETURN false;
  END IF;

  -- 2. Channel must be in the category's default_channels.
  IF NOT (p_channel = ANY (v_cat.default_channels)) THEN
    RETURN false;
  END IF;

  -- 3. Pref gate. Look up the explicit per-(category,channel) pref (if any).
  --    DEC-191: BOTH transactional AND marketing are now on-by-default; the ONLY
  --    pref that opts a channel out is an EXPLICIT enabled=false. An absent pref
  --    row means ON for every category (auto-enrolled). This unifies the two
  --    branches that previously diverged (marketing was off-by-default).
  v_pref_enabled := NULL;
  IF p_user_id IS NOT NULL THEN
    SELECT enabled INTO v_pref_enabled
      FROM public.notification_channel_prefs
     WHERE user_id = p_user_id
       AND category_key = p_category_key
       AND channel = p_channel;
  END IF;

  -- DEC-191 default-ON: an explicit enabled=false opts out of THIS channel for
  -- BOTH transactional and marketing. (A NULL/absent pref = ON.) Marketing opt-out
  -- is canonically carried by channel_suppressions (§4 below) — written by the
  -- prefs UI via set_marketing_suppression() — so this enabled=false path is the
  -- secondary, per-category granularity rather than the primary opt-out authority.
  IF v_pref_enabled IS NOT NULL AND v_pref_enabled = false THEN
    RETURN false;
  END IF;

  -- 4. Suppression gate (only email/sms can be suppressed; inapp/push always pass step 4).
  IF p_channel IN ('email','sms') THEN
    v_category_scope := CASE WHEN v_cat.is_transactional
                             THEN 'transactional' ELSE 'marketing' END;
    SELECT EXISTS (
      SELECT 1 FROM public.channel_suppressions s
       WHERE s.channel = p_channel
         AND s.scope IN (v_category_scope, 'all')
         AND (
           (p_user_id IS NOT NULL AND s.user_id = p_user_id)
           OR (p_contact IS NOT NULL AND s.contact = lower(p_contact))
           OR (p_contact IS NOT NULL AND s.contact = p_contact)
         )
    ) INTO v_suppressed;
    IF v_suppressed THEN
      RETURN false;
    END IF;
  END IF;

  RETURN true;
END;
$function$;

-- SECURITY DEFINER auto-grant gotcha — REVOKE PUBLIC + anon explicitly.
REVOKE ALL ON FUNCTION public.can_send(uuid, text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.can_send(uuid, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.can_send(uuid, text, text, text) TO authenticated;

COMMENT ON FUNCTION public.can_send(uuid, text, text, text) IS
  'META-ORCH-1161 §5.3 (DEC-191) — single consent chokepoint, marketing default-ON '
  '(opt-out). On-by-default for ALL categories; the only blocks are an explicit '
  'enabled=false pref or a channel_suppressions row (scope marketing|all). Pure '
  'per-channel answer; the dispatcher fires every channel that returns true (DEC-185).';

-- =============================================================
-- §2. set_marketing_suppression(channel, suppress) — prefs-UI write path.
-- =============================================================
-- The authenticated consumer prefs UI calls this to opt OUT of (suppress=true) or
-- back IN to (suppress=false) marketing on a channel. channel_suppressions is
-- service-role-write-only under RLS, so this SECURITY DEFINER RPC is the ONLY
-- RLS-correct authenticated write path. It keeps channel_suppressions the single
-- source of truth (no parallel authority) and resolves the caller's own contacts
-- so the contact-keyed audience resolver honors the same opt-out.
--
-- suppress=true  → INSERT a channel_suppressions(scope='marketing', reason='unsubscribe',
--                  brand_id NULL=global) row for the caller (user_id = auth.uid())
--                  WITH the resolved contact (email for 'email', phone for 'sms')
--                  so BOTH can_send (user_id|contact) AND the audience resolver
--                  (contact) exclude the user. ON CONFLICT DO NOTHING (idempotent).
-- suppress=false → DELETE the caller's marketing suppression rows for that channel
--                  (both the user_id-keyed and any contact-keyed row this RPC wrote).
--                  Only scope='marketing' rows authored here are removed — a
--                  scope='all' STOP or a bounce/complaint suppression is NEVER
--                  cleared by a prefs re-opt-in (I-PROPOSED-1161-TRANSACTIONAL-VS-
--                  MARKETING-CONSENT-SEPARATED + compliance integrity).
--
-- Returns the number of channel_suppressions rows affected (inserted or deleted).
CREATE OR REPLACE FUNCTION public.set_marketing_suppression(
  p_channel text,
  p_suppress boolean
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_email   text;
  v_phone   text;
  v_contact text;
  v_affected integer := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;
  IF p_channel NOT IN ('email','sms') THEN
    RAISE EXCEPTION 'unsupported_channel:%', p_channel USING ERRCODE = 'P0001';
  END IF;
  IF p_suppress IS NULL THEN
    RAISE EXCEPTION 'suppress_required' USING ERRCODE = 'P0001';
  END IF;

  -- Resolve the caller's own contact for THIS channel. email → auth.users.email,
  -- falling back to a VERIFIED auth.identities OAuth email (ORCH-1111 pattern, for
  -- Google-OAuth NULL-email users). sms → auth.users.phone (E.164).
  IF p_channel = 'email' THEN
    SELECT lower(u.email) INTO v_email FROM auth.users u WHERE u.id = v_user_id;
    IF v_email IS NULL THEN
      SELECT lower(i.identity_data->>'email') INTO v_email
        FROM auth.identities i
       WHERE i.user_id = v_user_id
         AND (i.identity_data->>'email') IS NOT NULL
         AND lower(coalesce(i.identity_data->>'email_verified','')) IN ('true','t')
       ORDER BY i.last_sign_in_at DESC NULLS LAST
       LIMIT 1;
    END IF;
    v_contact := v_email;
  ELSE
    SELECT nullif(u.phone, '') INTO v_phone FROM auth.users u WHERE u.id = v_user_id;
    -- auth stores E.164 WITHOUT the leading '+'; normalize to '+E.164' so the
    -- contact matches orders.buyer_phone_e164 and the audience resolver keys.
    IF v_phone IS NOT NULL AND left(v_phone, 1) <> '+' THEN
      v_phone := '+' || v_phone;
    END IF;
    v_contact := v_phone;
  END IF;

  IF p_suppress THEN
    -- Opt OUT. Always write the user_id-keyed row (can_send honors it even when no
    -- contact is on file). Also write the contact-keyed row when a contact exists
    -- so the contact-keyed audience resolver excludes the user too.
    INSERT INTO public.channel_suppressions (user_id, contact, channel, scope, reason, brand_id)
    VALUES (v_user_id, NULL, p_channel, 'marketing', 'unsubscribe', NULL)
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS v_affected = ROW_COUNT;

    IF v_contact IS NOT NULL THEN
      INSERT INTO public.channel_suppressions (user_id, contact, channel, scope, reason, brand_id)
      VALUES (v_user_id, v_contact, p_channel, 'marketing', 'unsubscribe', NULL)
      ON CONFLICT DO NOTHING;
      GET DIAGNOSTICS v_affected = v_affected + ROW_COUNT;
    END IF;
  ELSE
    -- Opt back IN. Remove ONLY this caller's scope='marketing' rows for the
    -- channel (user_id-keyed and any contact-keyed row authored by this RPC).
    -- A scope='all' STOP or a bounce/complaint suppression is intentionally NOT
    -- cleared here — re-enrolling marketing must not resurrect a hard opt-out.
    DELETE FROM public.channel_suppressions s
     WHERE s.user_id = v_user_id
       AND s.channel = p_channel
       AND s.scope = 'marketing';
    GET DIAGNOSTICS v_affected = ROW_COUNT;
  END IF;

  RETURN v_affected;
END;
$function$;

REVOKE ALL ON FUNCTION public.set_marketing_suppression(text, boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_marketing_suppression(text, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_marketing_suppression(text, boolean) TO authenticated;

COMMENT ON FUNCTION public.set_marketing_suppression(text, boolean) IS
  'META-ORCH-1161 go-live-prep (DEC-191) — authenticated prefs-UI write path for '
  'marketing opt-out. suppress=true writes channel_suppressions(scope=marketing) for '
  'the caller (user_id + resolved contact); suppress=false removes the caller''s '
  'marketing rows only (never a scope=all STOP/bounce). Keeps channel_suppressions '
  'the single source of truth honored by can_send + marketingAudience.';
