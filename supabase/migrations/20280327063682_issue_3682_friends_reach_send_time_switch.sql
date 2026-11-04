-- #3682 closeout — Friends of followers switches are honoured at SEND time.
--
-- Found by the #3682 tester: the three extended switches
-- (brand_circle_extended_v1 + the iOS/Android controls switches) were checked
-- when a push campaign was quoted/confirmed and when an invite plan was saved,
-- but not when the push worklist or the account-invite worklist was built.
-- A scheduled push (or an invite published while the switches were on) still
-- reached friends of followers after ops switched the audience off. The
-- #1777 resolver does not read the switches, so the send-time re-check passed.
--
-- Fix: one helper reads the three switches (all must exist and be on), and
-- both per-recipient decisions return 'circle_switched_off' for a friend of a
-- follower while it is false. Followers and Book people are unaffected.
--
-- Invariant (declared in the tester pg17 suite): I-3682-EXTENDED-SWITCH-AT-SEND | issue #3682 | No push or account invite reaches a friend of a follower while any of the three extended switches is off, including sends confirmed before the switch went off.

BEGIN;

CREATE OR REPLACE FUNCTION private.issue_3682_extended_reach_live()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog
AS $fn$
  SELECT COALESCE((
    SELECT count(*) = 3 AND bool_and(f.is_enabled)
      FROM public.feature_flags f
     WHERE f.flag_key IN ('brand_circle_extended_v1',
       'brand_circle_extended_controls_ios_v1', 'brand_circle_extended_controls_android_v1')
  ), false)
$fn$;
REVOKE ALL ON FUNCTION private.issue_3682_extended_reach_live() FROM PUBLIC, anon, authenticated;

-- Push: the 20280327043682 body + the switch check for 'extended'.
CREATE OR REPLACE FUNCTION public.issue_3682_campaign_push_reason(
  p_brand_id uuid, p_user_id uuid, p_reason text
) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_follows boolean;
BEGIN
  SELECT true INTO v_follows FROM public.brand_follows bf
   WHERE bf.brand_id = p_brand_id AND bf.user_id = p_user_id;
  v_follows := COALESCE(v_follows, false);
  IF p_reason = 'follower' AND NOT v_follows THEN
    RETURN 'unfollowed';
  END IF;
  IF v_follows AND NOT public.biz_brand_follow_channel_ok(p_user_id, p_brand_id, 'push') THEN
    RETURN 'muted_or_off';
  END IF;
  IF p_reason = 'extended' AND NOT private.issue_3682_extended_reach_live() THEN
    RETURN 'circle_switched_off';
  END IF;
  IF p_reason = 'extended' AND NOT EXISTS (
    SELECT 1 FROM public.issue_1777_resolve_brand_circle_members(
      p_brand_id, 'extended', ARRAY[p_user_id]) r WHERE r.user_id = p_user_id) THEN
    RETURN 'left_circle';
  END IF;
  IF p_reason = 'book' AND NOT EXISTS (
    SELECT 1 FROM public.brand_people bp
     WHERE bp.brand_id = p_brand_id AND bp.linked_user_id = p_user_id
       AND bp.record_status = 'active') THEN
    RETURN 'left_book';
  END IF;
  IF EXISTS (SELECT 1 FROM public.brand_circle_exits bx
              WHERE bx.brand_id = p_brand_id AND bx.user_id = p_user_id
                AND (bx.visibility_exited_at IS NOT NULL OR bx.delivery_exited_at IS NOT NULL)) THEN
    RETURN 'delivery_denied';
  END IF;
  IF NOT public.can_send(p_user_id, 'brand_campaign_push', 'push', NULL) THEN
    RETURN 'can_send_denied';
  END IF;
  RETURN 'allowed';
END;
$fn$;
REVOKE ALL ON FUNCTION public.issue_3682_campaign_push_reason(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3682_campaign_push_reason(uuid, uuid, text) TO service_role;

-- Account invites: the 20280327033682 body + the switch check for ring 'extended'.
CREATE OR REPLACE FUNCTION private.issue_3682_account_invite_channel_reason(
  p_brand_id uuid, p_user_id uuid, p_ring text, p_channel text
) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog
AS $fn$
DECLARE v_contact text; v_allowed boolean; v_reason text;
BEGIN
  IF p_channel NOT IN ('push', 'email') OR p_ring NOT IN ('follower', 'extended') THEN
    RETURN 'channel_unavailable';
  END IF;
  IF p_ring = 'follower' THEN
    IF NOT EXISTS (SELECT 1 FROM public.brand_follows bf
                    WHERE bf.brand_id = p_brand_id AND bf.user_id = p_user_id) THEN
      RETURN 'unfollowed';
    END IF;
    IF NOT public.biz_brand_follow_channel_ok(p_user_id, p_brand_id, p_channel) THEN
      RETURN 'muted_or_off';
    END IF;
  ELSIF NOT private.issue_3682_extended_reach_live() THEN
    RETURN 'circle_switched_off';
  ELSIF NOT EXISTS (
    SELECT 1 FROM public.issue_1777_resolve_brand_circle_members(
      p_brand_id, 'extended', ARRAY[p_user_id]) r WHERE r.user_id = p_user_id) THEN
    RETURN 'left_circle';
  END IF;
  IF EXISTS (SELECT 1 FROM public.brand_circle_exits bx
              WHERE bx.brand_id = p_brand_id AND bx.user_id = p_user_id
                AND (bx.visibility_exited_at IS NOT NULL OR bx.delivery_exited_at IS NOT NULL)) THEN
    RETURN 'delivery_denied';
  END IF;
  IF p_channel = 'email' THEN
    SELECT a.normalized_contact, a.allowed, a.reason INTO v_contact, v_allowed, v_reason
      FROM public.issue_1778_circle_authorized_contact(p_brand_id, p_user_id, 'email') a;
    IF v_contact IS NULL THEN RETURN 'channel_unavailable'; END IF;
    IF v_allowed IS NOT TRUE THEN RETURN COALESCE(v_reason, 'can_send_denied'); END IF;
  END IF;
  IF NOT public.can_send(p_user_id, 'brand_offering_invite', p_channel, v_contact) THEN
    RETURN 'can_send_denied';
  END IF;
  RETURN 'allowed';
END;
$fn$;
REVOKE ALL ON FUNCTION private.issue_3682_account_invite_channel_reason(uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated;

COMMIT;
