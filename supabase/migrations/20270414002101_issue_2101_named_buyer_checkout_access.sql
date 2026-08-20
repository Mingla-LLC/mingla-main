-- Issue #2101 — optional event-scoped authenticated named-buyer ticket checkout.
-- Additive and default-unrestricted. No provider, capability, worker, or visibility change.

DO $preflight$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE username IS NOT NULL
    GROUP BY lower(btrim(username))
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'profiles_username_canonical_collision';
  END IF;
END
$preflight$;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_username_canonical_unique
  ON public.profiles (lower(btrim(username)))
  WHERE username IS NOT NULL;

CREATE TABLE public.event_ticket_checkout_access (
  event_id uuid PRIMARY KEY REFERENCES public.events(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE RESTRICT,
  mode text NOT NULL DEFAULT 'unrestricted'
    CHECK (mode IN ('unrestricted','named_buyers')),
  config_revision bigint NOT NULL DEFAULT 0 CHECK (config_revision >= 0),
  restrictive_epoch bigint NOT NULL DEFAULT 0 CHECK (restrictive_epoch >= 0),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.event_ticket_checkout_allowed_buyers (
  membership_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  buyer_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  membership_epoch bigint NOT NULL DEFAULT 1 CHECK (membership_epoch > 0),
  added_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  added_at timestamptz NOT NULL DEFAULT now(),
  removed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  removed_at timestamptz,
  UNIQUE(event_id,buyer_user_id)
);

CREATE INDEX event_ticket_checkout_allowed_buyers_active_idx
  ON public.event_ticket_checkout_allowed_buyers(event_id,buyer_user_id)
  WHERE removed_at IS NULL;

CREATE TABLE public.event_ticket_checkout_access_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL UNIQUE,
  payload_fingerprint text NOT NULL CHECK (payload_fingerprint ~ '^[0-9a-f]{64}$'),
  event_id uuid NOT NULL,
  brand_id uuid NOT NULL,
  actor_user_id uuid,
  action text NOT NULL CHECK (action IN ('add_self','add_username','remove','set_mode')),
  target_buyer_user_id uuid,
  before_mode text CHECK (before_mode IN ('unrestricted','named_buyers')),
  after_mode text NOT NULL CHECK (after_mode IN ('unrestricted','named_buyers')),
  before_config_revision bigint,
  after_config_revision bigint NOT NULL,
  before_restrictive_epoch bigint,
  after_restrictive_epoch bigint NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('changed','noop')),
  result_snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.event_ticket_checkout_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_ticket_checkout_allowed_buyers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_ticket_checkout_access_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.event_ticket_checkout_access FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON public.event_ticket_checkout_allowed_buyers FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON public.event_ticket_checkout_access_audit FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.issue_2101_access_row_brand_guard()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=public,pg_temp AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id=NEW.event_id AND e.brand_id=NEW.brand_id
  ) THEN
    RAISE EXCEPTION 'event_brand_binding_invalid';
  END IF;
  RETURN NEW;
END
$function$;

CREATE TRIGGER issue_2101_access_row_brand_guard
BEFORE INSERT OR UPDATE OF event_id,brand_id ON public.event_ticket_checkout_access
FOR EACH ROW EXECUTE FUNCTION public.issue_2101_access_row_brand_guard();

CREATE OR REPLACE FUNCTION public.issue_2101_audit_immutable_guard()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=public,pg_temp AS $function$
BEGIN
  RAISE EXCEPTION 'ticket_checkout_access_audit_immutable';
END
$function$;

CREATE TRIGGER issue_2101_audit_immutable_guard
BEFORE UPDATE OR DELETE ON public.event_ticket_checkout_access_audit
FOR EACH ROW EXECUTE FUNCTION public.issue_2101_audit_immutable_guard();

REVOKE ALL ON FUNCTION public.issue_2101_access_row_brand_guard() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.issue_2101_audit_immutable_guard() FROM PUBLIC,anon,authenticated,service_role;

ALTER TABLE public.ticket_checkout_sessions
  ADD COLUMN checkout_access_mode_snapshot text NOT NULL DEFAULT 'unrestricted'
    CHECK (checkout_access_mode_snapshot IN ('unrestricted','named_buyers')),
  ADD COLUMN checkout_access_restrictive_epoch_snapshot bigint NOT NULL DEFAULT 0
    CHECK (checkout_access_restrictive_epoch_snapshot >= 0),
  ADD COLUMN checkout_access_membership_id_snapshot uuid,
  ADD COLUMN checkout_access_membership_epoch_snapshot bigint
    CHECK (checkout_access_membership_epoch_snapshot IS NULL OR checkout_access_membership_epoch_snapshot > 0);

ALTER TABLE public.ticket_checkout_provider_attempts
  ADD COLUMN checkout_access_mode_snapshot text NOT NULL DEFAULT 'unrestricted'
    CHECK (checkout_access_mode_snapshot IN ('unrestricted','named_buyers')),
  ADD COLUMN checkout_access_restrictive_epoch_snapshot bigint NOT NULL DEFAULT 0
    CHECK (checkout_access_restrictive_epoch_snapshot >= 0),
  ADD COLUMN checkout_access_membership_id_snapshot uuid,
  ADD COLUMN checkout_access_membership_epoch_snapshot bigint
    CHECK (checkout_access_membership_epoch_snapshot IS NULL OR checkout_access_membership_epoch_snapshot > 0);

CREATE OR REPLACE FUNCTION public.issue_2101_user_is_eligible(p_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=public,auth,pg_temp AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM auth.users u
    JOIN public.profiles p ON p.id=u.id
    WHERE u.id=p_user_id
      AND u.deleted_at IS NULL
      AND COALESCE(u.is_anonymous,false)=false
      AND (u.banned_until IS NULL OR u.banned_until<=now())
      AND u.confirmed_at IS NOT NULL
      AND p.active IS TRUE
  )
$function$;

CREATE OR REPLACE FUNCTION public.issue_2101_event_has_active_ticket_checkout(p_event_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=public,pg_temp AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.ticket_checkout_sessions s
    WHERE s.event_id=p_event_id AND s.order_id IS NULL AND (
      (s.revoked_at IS NULL AND s.expires_at>now() AND s.status IN
        ('pending_free','requires_payment','processing_payment','awaiting_web_redirect'))
      OR s.reversal_state IN ('neutralization_pending','paid_reversal_pending')
    )
    UNION ALL
    SELECT 1 FROM public.ticket_checkout_provider_attempts a
    JOIN public.ticket_checkout_sessions s ON s.id=a.checkout_session_id
    WHERE a.event_id=p_event_id AND s.order_id IS NULL
      AND a.state IN ('claimed','provider_unknown','ready','neutralization_pending','paid_reversal_pending')
    UNION ALL
    SELECT 1 FROM public.checkout_sale_revocation_outbox o
    WHERE o.event_id=p_event_id AND o.subject_type='ticket_checkout_session'
      AND o.state IN ('queued','leased','provider_unknown','paid_reversal_pending','failed_retryable')
  )
$function$;

CREATE OR REPLACE FUNCTION public.issue_2101_brand_has_active_named_ticket_checkout(p_brand_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=public,pg_temp AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.events e
    JOIN public.event_ticket_checkout_access a
      ON a.event_id=e.id AND a.brand_id=e.brand_id AND a.mode='named_buyers'
    WHERE e.brand_id=p_brand_id
      AND public.issue_2101_event_has_active_ticket_checkout(e.id)
  )
$function$;

CREATE OR REPLACE FUNCTION public.issue_2101_guard_brand_owner_transfer()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=public,pg_temp AS $function$
BEGIN
  IF OLD.account_id IS DISTINCT FROM NEW.account_id
     AND public.issue_2101_brand_has_active_named_ticket_checkout(OLD.id) THEN
    RAISE EXCEPTION 'ACTIVE_CHECKOUTS_BLOCK_OWNER_TRANSFER';
  END IF;
  RETURN NEW;
END
$function$;

CREATE TRIGGER issue_2101_guard_brand_owner_transfer
BEFORE UPDATE OF account_id ON public.brands
FOR EACH ROW EXECUTE FUNCTION public.issue_2101_guard_brand_owner_transfer();

REVOKE ALL ON FUNCTION public.issue_2101_user_is_eligible(uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.issue_2101_event_has_active_ticket_checkout(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_2101_event_has_active_ticket_checkout(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.issue_2101_brand_has_active_named_ticket_checkout(uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.issue_2101_guard_brand_owner_transfer() FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.issue_2101_ticket_checkout_access_decision(
  p_event_id uuid,
  p_buyer_user_id uuid,
  p_snapshot_mode text DEFAULT NULL,
  p_snapshot_restrictive_epoch bigint DEFAULT NULL,
  p_snapshot_membership_id uuid DEFAULT NULL,
  p_snapshot_membership_epoch bigint DEFAULT NULL
) RETURNS text LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=public,auth,pg_temp AS $function$
DECLARE
  v_event public.events%ROWTYPE;
  v_brand public.brands%ROWTYPE;
  v_access public.event_ticket_checkout_access%ROWTYPE;
  v_membership public.event_ticket_checkout_allowed_buyers%ROWTYPE;
BEGIN
  SELECT * INTO v_event FROM public.events WHERE id=p_event_id FOR UPDATE;
  IF NOT FOUND OR v_event.deleted_at IS NOT NULL THEN RETURN 'event_unavailable'; END IF;
  SELECT * INTO v_brand FROM public.brands
    WHERE id=v_event.brand_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN 'event_unavailable'; END IF;
  SELECT * INTO v_access FROM public.event_ticket_checkout_access
    WHERE event_id=p_event_id FOR UPDATE;

  IF NOT FOUND OR v_access.mode='unrestricted' THEN
    IF p_snapshot_mode='named_buyers' THEN RETURN 'snapshot_stale'; END IF;
    RETURN 'allowed_unrestricted';
  END IF;
  IF p_buyer_user_id IS NULL THEN RETURN 'sign_in_required'; END IF;
  IF NOT public.issue_2101_user_is_eligible(p_buyer_user_id)
     OR NOT public.issue_2101_user_is_eligible(v_brand.account_id)
     OR NOT EXISTS (SELECT 1 FROM public.creator_accounts c
                    WHERE c.id=v_brand.account_id AND c.deleted_at IS NULL)
     OR EXISTS (
       SELECT 1 FROM public.blocked_users bu
       WHERE (bu.blocker_id=v_brand.account_id AND bu.blocked_id=p_buyer_user_id)
          OR (bu.blocker_id=p_buyer_user_id AND bu.blocked_id=v_brand.account_id)
     ) THEN
    RETURN 'checkout_restricted';
  END IF;
  SELECT * INTO v_membership
  FROM public.event_ticket_checkout_allowed_buyers
  WHERE event_id=p_event_id AND buyer_user_id=p_buyer_user_id AND removed_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN RETURN 'checkout_restricted'; END IF;
  IF p_snapshot_mode IS NOT NULL AND (
      p_snapshot_mode<>'named_buyers'
      OR p_snapshot_restrictive_epoch IS DISTINCT FROM v_access.restrictive_epoch
      OR p_snapshot_membership_id IS DISTINCT FROM v_membership.membership_id
      OR p_snapshot_membership_epoch IS DISTINCT FROM v_membership.membership_epoch
    ) THEN
    RETURN 'snapshot_stale';
  END IF;
  RETURN 'allowed_named';
END
$function$;

REVOKE ALL ON FUNCTION public.issue_2101_ticket_checkout_access_decision(uuid,uuid,text,bigint,uuid,bigint)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_2101_ticket_checkout_access_decision(uuid,uuid,text,bigint,uuid,bigint)
  TO service_role;

CREATE OR REPLACE FUNCTION public.pg_public_ticket_checkout_access_state(p_event_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=public,auth,pg_temp AS $function$
DECLARE v_mode text; v_uid uuid:=auth.uid(); v_allowed boolean:=false;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.events e WHERE e.id=p_event_id
    AND e.deleted_at IS NULL AND e.visibility IN ('public','hidden')
    AND e.status IN ('scheduled','live')) THEN RETURN NULL; END IF;
  SELECT mode INTO v_mode FROM public.event_ticket_checkout_access WHERE event_id=p_event_id;
  v_mode:=COALESCE(v_mode,'unrestricted');
  IF v_mode='unrestricted' THEN
    RETURN jsonb_build_object('schemaVersion',1,'mode','unrestricted','state','unrestricted');
  END IF;
  IF v_uid IS NOT NULL THEN
    SELECT public.issue_2101_user_is_eligible(v_uid)
      AND m.membership_id IS NOT NULL AND m.removed_at IS NULL
      AND public.issue_2101_user_is_eligible(b.account_id)
      AND NOT EXISTS (SELECT 1 FROM public.blocked_users bu
        WHERE (bu.blocker_id=b.account_id AND bu.blocked_id=v_uid)
           OR (bu.blocker_id=v_uid AND bu.blocked_id=b.account_id))
    INTO v_allowed
    FROM public.events e JOIN public.brands b ON b.id=e.brand_id
    LEFT JOIN public.event_ticket_checkout_allowed_buyers m
      ON m.event_id=e.id AND m.buyer_user_id=v_uid
    WHERE e.id=p_event_id;
  END IF;
  RETURN jsonb_build_object('schemaVersion',1,'mode','named_buyers','state',
    CASE WHEN v_uid IS NULL THEN 'sign_in_required'
         WHEN v_allowed THEN 'allowed' ELSE 'restricted' END);
END
$function$;
REVOKE ALL ON FUNCTION public.pg_public_ticket_checkout_access_state(uuid) FROM PUBLIC,service_role;
GRANT EXECUTE ON FUNCTION public.pg_public_ticket_checkout_access_state(uuid) TO anon,authenticated;

CREATE OR REPLACE FUNCTION public.issue_2101_business_policy_snapshot(p_event_id uuid,p_actor uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=public,auth,pg_temp AS $function$
DECLARE v_event public.events%ROWTYPE; v_access public.event_ticket_checkout_access%ROWTYPE;
  v_members jsonb;
BEGIN
  SELECT * INTO v_event FROM public.events WHERE id=p_event_id FOR UPDATE;
  IF NOT FOUND OR NOT public.issue_2101_user_is_eligible(p_actor)
     OR public.biz_brand_effective_rank_for_caller(v_event.brand_id)<public.biz_role_rank('brand_owner') THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  PERFORM 1 FROM public.brands WHERE id=v_event.brand_id AND deleted_at IS NULL FOR UPDATE;
  SELECT * INTO v_access FROM public.event_ticket_checkout_access WHERE event_id=p_event_id FOR UPDATE;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'membershipId',m.membership_id,
    'label',CASE WHEN m.buyer_user_id=p_actor THEN 'My account'
      WHEN p.visibility_mode='public' AND p.active IS TRUE
       AND NOT EXISTS (SELECT 1 FROM public.blocked_users bu
         WHERE (bu.blocker_id=p_actor AND bu.blocked_id=m.buyer_user_id)
            OR (bu.blocker_id=m.buyer_user_id AND bu.blocked_id=p_actor))
      THEN COALESCE(NULLIF(p.display_name,''),p.username,'Approved account')
      ELSE 'Approved private account' END,
    'isSelf',m.buyer_user_id=p_actor,
    'username',CASE WHEN p.visibility_mode='public' AND p.active IS TRUE THEN p.username ELSE NULL END,
    'displayName',CASE WHEN p.visibility_mode='public' AND p.active IS TRUE THEN p.display_name ELSE NULL END,
    'avatarUrl',CASE WHEN p.visibility_mode='public' AND p.active IS TRUE THEN p.avatar_url ELSE NULL END
  ) ORDER BY m.added_at),'[]'::jsonb) INTO v_members
  FROM public.event_ticket_checkout_allowed_buyers m
  JOIN public.profiles p ON p.id=m.buyer_user_id
  WHERE m.event_id=p_event_id AND m.removed_at IS NULL;
  RETURN jsonb_build_object('schemaVersion',1,'eventId',p_event_id,
    'mode',COALESCE(v_access.mode,'unrestricted'),
    'configRevision',COALESCE(v_access.config_revision,0),
    'restrictiveEpoch',COALESCE(v_access.restrictive_epoch,0),
    'maxActiveBuyers',20,'members',v_members);
END
$function$;

CREATE OR REPLACE FUNCTION public.biz_event_ticket_checkout_access_get(p_event_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=public,auth,pg_temp AS $function$
BEGIN
  RETURN public.issue_2101_business_policy_snapshot(p_event_id,auth.uid());
END
$function$;

CREATE OR REPLACE FUNCTION public.issue_2101_access_mutate(
  p_event_id uuid,p_action text,p_expected_config_revision bigint,p_request_id uuid,
  p_target_user_id uuid DEFAULT NULL,p_mode text DEFAULT NULL,p_membership_id uuid DEFAULT NULL,
  p_username text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=public,auth,extensions,pg_temp AS $function$
DECLARE v_actor uuid:=auth.uid(); v_event public.events%ROWTYPE; v_access public.event_ticket_checkout_access%ROWTYPE;
  v_member public.event_ticket_checkout_allowed_buyers%ROWTYPE; v_target uuid:=p_target_user_id;
  v_fingerprint text; v_existing public.event_ticket_checkout_access_audit%ROWTYPE;
  v_before_mode text; v_before_revision bigint; v_before_epoch bigint;
  v_outcome text:='changed'; v_result jsonb; v_restrictive boolean:=false;
BEGIN
  IF p_request_id IS NULL OR p_expected_config_revision IS NULL THEN RAISE EXCEPTION 'invalid_request'; END IF;
  SELECT * INTO v_event FROM public.events WHERE id=p_event_id FOR UPDATE;
  IF NOT FOUND OR NOT public.issue_2101_user_is_eligible(v_actor)
     OR public.biz_brand_effective_rank_for_caller(v_event.brand_id)<public.biz_role_rank('brand_owner') THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  PERFORM 1 FROM public.brands WHERE id=v_event.brand_id AND deleted_at IS NULL FOR UPDATE;
  v_fingerprint:=encode(digest(jsonb_build_object('schemaVersion',1,'actor',v_actor,'event',p_event_id,
    'action',p_action,'mode',p_mode,'username',p_username,'membershipId',p_membership_id,
    'expectedConfigRevision',p_expected_config_revision)::text,'sha256'),'hex');
  SELECT * INTO v_existing FROM public.event_ticket_checkout_access_audit WHERE request_id=p_request_id;
  IF FOUND THEN
    IF v_existing.actor_user_id=v_actor AND v_existing.event_id=p_event_id
       AND v_existing.action=p_action AND v_existing.payload_fingerprint=v_fingerprint THEN
      RETURN v_existing.result_snapshot;
    END IF;
    RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';
  END IF;
  INSERT INTO public.event_ticket_checkout_access(event_id,brand_id,mode,created_by,updated_by)
  VALUES(p_event_id,v_event.brand_id,'unrestricted',v_actor,v_actor)
  ON CONFLICT(event_id) DO NOTHING;
  SELECT * INTO v_access FROM public.event_ticket_checkout_access WHERE event_id=p_event_id FOR UPDATE;
  IF v_access.config_revision<>p_expected_config_revision THEN RAISE EXCEPTION 'STALE_ACCESS_POLICY'; END IF;
  v_before_mode:=v_access.mode; v_before_revision:=v_access.config_revision; v_before_epoch:=v_access.restrictive_epoch;

  IF p_action='add_username' THEN
    SELECT p.id INTO v_target FROM public.profiles p JOIN auth.users u ON u.id=p.id
    WHERE lower(btrim(p.username))=lower(btrim(p_username)) AND p.visibility_mode='public'
      AND public.issue_2101_user_is_eligible(p.id)
      AND NOT EXISTS (SELECT 1 FROM public.blocked_users bu
        WHERE (bu.blocker_id=v_actor AND bu.blocked_id=p.id)
           OR (bu.blocker_id=p.id AND bu.blocked_id=v_actor));
    IF v_target IS NULL THEN RAISE EXCEPTION 'BUYER_NOT_AVAILABLE'; END IF;
  ELSIF p_action='add_self' THEN
    v_target:=v_actor;
    IF NOT public.issue_2101_user_is_eligible(v_target) THEN RAISE EXCEPTION 'BUYER_NOT_AVAILABLE'; END IF;
  END IF;

  IF p_action IN ('add_self','add_username') THEN
    IF (SELECT count(*) FROM public.event_ticket_checkout_allowed_buyers
        WHERE event_id=p_event_id AND removed_at IS NULL)>=20
       AND NOT EXISTS (SELECT 1 FROM public.event_ticket_checkout_allowed_buyers
        WHERE event_id=p_event_id AND buyer_user_id=v_target AND removed_at IS NULL) THEN
      RAISE EXCEPTION 'MAX_ACTIVE_BUYERS';
    END IF;
    SELECT * INTO v_member FROM public.event_ticket_checkout_allowed_buyers
      WHERE event_id=p_event_id AND buyer_user_id=v_target FOR UPDATE;
    IF FOUND AND v_member.removed_at IS NULL THEN v_outcome:='noop';
    ELSIF FOUND THEN
      UPDATE public.event_ticket_checkout_allowed_buyers SET removed_at=NULL,removed_by=NULL,
        membership_epoch=membership_epoch+1,added_by=v_actor,added_at=now()
      WHERE membership_id=v_member.membership_id RETURNING * INTO v_member;
    ELSE
      INSERT INTO public.event_ticket_checkout_allowed_buyers(event_id,buyer_user_id,added_by)
      VALUES(p_event_id,v_target,v_actor) RETURNING * INTO v_member;
    END IF;
  ELSIF p_action='remove' THEN
    SELECT * INTO v_member FROM public.event_ticket_checkout_allowed_buyers
      WHERE event_id=p_event_id AND membership_id=p_membership_id FOR UPDATE;
    IF NOT FOUND OR v_member.removed_at IS NOT NULL THEN v_outcome:='noop';
    ELSE
      v_target:=v_member.buyer_user_id;
      v_restrictive:=v_access.mode='named_buyers';
      IF v_restrictive AND public.issue_2101_event_has_active_ticket_checkout(p_event_id) THEN
        RAISE EXCEPTION 'ACTIVE_CHECKOUTS_BLOCK_ACCESS_CHANGE';
      END IF;
      UPDATE public.event_ticket_checkout_allowed_buyers SET removed_at=now(),removed_by=v_actor,
        membership_epoch=membership_epoch+1 WHERE membership_id=v_member.membership_id RETURNING * INTO v_member;
    END IF;
  ELSIF p_action='set_mode' THEN
    IF p_mode NOT IN ('unrestricted','named_buyers') THEN RAISE EXCEPTION 'invalid_access_mode'; END IF;
    IF p_mode=v_access.mode THEN v_outcome:='noop';
    ELSE
      v_restrictive:=v_access.mode='unrestricted' AND p_mode='named_buyers';
      IF v_restrictive AND public.issue_2101_event_has_active_ticket_checkout(p_event_id) THEN
        RAISE EXCEPTION 'ACTIVE_CHECKOUTS_BLOCK_ACCESS_CHANGE';
      END IF;
      UPDATE public.event_ticket_checkout_access SET mode=p_mode,
        restrictive_epoch=restrictive_epoch+CASE WHEN v_restrictive THEN 1 ELSE 0 END,
        updated_by=v_actor,updated_at=now() WHERE event_id=p_event_id RETURNING * INTO v_access;
    END IF;
  ELSE
    RAISE EXCEPTION 'invalid_access_action';
  END IF;

  IF v_outcome='changed' THEN
    UPDATE public.event_ticket_checkout_access SET config_revision=config_revision+1,
      updated_by=v_actor,updated_at=now() WHERE event_id=p_event_id RETURNING * INTO v_access;
  ELSE
    SELECT * INTO v_access FROM public.event_ticket_checkout_access WHERE event_id=p_event_id;
  END IF;
  v_result:=jsonb_build_object('schemaVersion',1,'outcome',v_outcome,'eventId',p_event_id,
    'mode',v_access.mode,'configRevision',v_access.config_revision,
    'restrictiveEpoch',v_access.restrictive_epoch)
    || CASE WHEN v_member.membership_id IS NOT NULL
      THEN jsonb_build_object('membershipId',v_member.membership_id) ELSE '{}'::jsonb END;
  INSERT INTO public.event_ticket_checkout_access_audit(request_id,payload_fingerprint,event_id,brand_id,
    actor_user_id,action,target_buyer_user_id,before_mode,after_mode,before_config_revision,
    after_config_revision,before_restrictive_epoch,after_restrictive_epoch,outcome,result_snapshot)
  VALUES(p_request_id,v_fingerprint,p_event_id,v_event.brand_id,v_actor,p_action,v_target,
    v_before_mode,v_access.mode,v_before_revision,v_access.config_revision,v_before_epoch,
    v_access.restrictive_epoch,v_outcome,v_result);
  RETURN v_result;
END
$function$;

CREATE OR REPLACE FUNCTION public.biz_event_ticket_checkout_access_add_self(
  p_event_id uuid,p_expected_config_revision bigint,p_request_id uuid
) RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=public,auth,pg_temp AS $function$
  SELECT public.issue_2101_access_mutate(p_event_id,'add_self',p_expected_config_revision,p_request_id)
$function$;
CREATE OR REPLACE FUNCTION public.biz_event_ticket_checkout_access_add_username(
  p_event_id uuid,p_username text,p_expected_config_revision bigint,p_request_id uuid
) RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=public,auth,pg_temp AS $function$
  SELECT public.issue_2101_access_mutate(p_event_id,'add_username',p_expected_config_revision,p_request_id,
    NULL,NULL,NULL,lower(btrim(p_username)))
$function$;
CREATE OR REPLACE FUNCTION public.biz_event_ticket_checkout_access_remove(
  p_event_id uuid,p_membership_id uuid,p_expected_config_revision bigint,p_request_id uuid
) RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=public,auth,pg_temp AS $function$
  SELECT public.issue_2101_access_mutate(p_event_id,'remove',p_expected_config_revision,p_request_id,
    NULL,NULL,p_membership_id,NULL)
$function$;
CREATE OR REPLACE FUNCTION public.biz_event_ticket_checkout_access_set_mode(
  p_event_id uuid,p_mode text,p_expected_config_revision bigint,p_request_id uuid
) RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=public,auth,pg_temp AS $function$
  SELECT public.issue_2101_access_mutate(p_event_id,'set_mode',p_expected_config_revision,p_request_id,
    NULL,p_mode,NULL,NULL)
$function$;

REVOKE ALL ON FUNCTION public.issue_2101_business_policy_snapshot(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.issue_2101_access_mutate(uuid,text,bigint,uuid,uuid,text,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.biz_event_ticket_checkout_access_get(uuid) FROM PUBLIC,anon,service_role;
REVOKE ALL ON FUNCTION public.biz_event_ticket_checkout_access_add_self(uuid,bigint,uuid) FROM PUBLIC,anon,service_role;
REVOKE ALL ON FUNCTION public.biz_event_ticket_checkout_access_add_username(uuid,text,bigint,uuid) FROM PUBLIC,anon,service_role;
REVOKE ALL ON FUNCTION public.biz_event_ticket_checkout_access_remove(uuid,uuid,bigint,uuid) FROM PUBLIC,anon,service_role;
REVOKE ALL ON FUNCTION public.biz_event_ticket_checkout_access_set_mode(uuid,text,bigint,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.biz_event_ticket_checkout_access_get(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.biz_event_ticket_checkout_access_add_self(uuid,bigint,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.biz_event_ticket_checkout_access_add_username(uuid,text,bigint,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.biz_event_ticket_checkout_access_remove(uuid,uuid,bigint,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.biz_event_ticket_checkout_access_set_mode(uuid,text,bigint,uuid) TO authenticated;

-- Preserve every current #1930/#2079 body behind a narrow access wrapper.
ALTER FUNCTION public.issue_1930_ticket_session_authorized(uuid,uuid)
  RENAME TO issue_2101_ticket_session_authorized_base;
CREATE OR REPLACE FUNCTION public.issue_1930_ticket_session_authorized(p_session_id uuid,p_event_id uuid)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $function$
DECLARE v_session public.ticket_checkout_sessions%ROWTYPE; v_decision text;
BEGIN
  SELECT * INTO v_session FROM public.ticket_checkout_sessions WHERE id=p_session_id;
  IF NOT FOUND OR v_session.event_id<>p_event_id THEN RETURN false; END IF;
  v_decision:=public.issue_2101_ticket_checkout_access_decision(p_event_id,v_session.buyer_user_id,
    v_session.checkout_access_mode_snapshot,v_session.checkout_access_restrictive_epoch_snapshot,
    v_session.checkout_access_membership_id_snapshot,v_session.checkout_access_membership_epoch_snapshot);
  RETURN v_decision IN ('allowed_unrestricted','allowed_named')
    AND public.issue_2101_ticket_session_authorized_base(p_session_id,p_event_id);
END
$function$;

ALTER FUNCTION public.biz_ticket_checkout_create_session(uuid,uuid,text,text,text,boolean,jsonb,text,timestamptz,integer,text)
  RENAME TO issue_2101_ticket_checkout_create_session_base;
CREATE OR REPLACE FUNCTION public.biz_ticket_checkout_create_session(
  p_event_id uuid,p_buyer_user_id uuid,p_buyer_name text,p_buyer_email text,p_buyer_phone_e164 text,
  p_marketing_opt_in boolean,p_lines jsonb,p_idempotency_key text,p_expires_at timestamptz,
  p_application_fee_amount_cents integer DEFAULT 0,p_payment_plan_choice text DEFAULT 'auto'
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $function$
DECLARE v_existing public.ticket_checkout_sessions%ROWTYPE; v_result jsonb; v_decision text;
  v_access public.event_ticket_checkout_access%ROWTYPE;
  v_member public.event_ticket_checkout_allowed_buyers%ROWTYPE; v_session_id uuid;
BEGIN
  SELECT * INTO v_existing FROM public.ticket_checkout_sessions WHERE idempotency_key=p_idempotency_key;
  IF FOUND THEN
    IF v_existing.buyer_user_id IS DISTINCT FROM p_buyer_user_id THEN RAISE EXCEPTION 'checkout_restricted'; END IF;
    v_decision:=public.issue_2101_ticket_checkout_access_decision(p_event_id,p_buyer_user_id,
      v_existing.checkout_access_mode_snapshot,v_existing.checkout_access_restrictive_epoch_snapshot,
      v_existing.checkout_access_membership_id_snapshot,v_existing.checkout_access_membership_epoch_snapshot);
  ELSE
    v_decision:=public.issue_2101_ticket_checkout_access_decision(p_event_id,p_buyer_user_id);
  END IF;
  IF v_decision='sign_in_required' THEN RAISE EXCEPTION 'sign_in_required'; END IF;
  IF v_decision NOT IN ('allowed_unrestricted','allowed_named') THEN RAISE EXCEPTION 'checkout_restricted'; END IF;
  v_result:=public.issue_2101_ticket_checkout_create_session_base(p_event_id,p_buyer_user_id,p_buyer_name,
    p_buyer_email,p_buyer_phone_e164,p_marketing_opt_in,p_lines,p_idempotency_key,p_expires_at,
    p_application_fee_amount_cents,p_payment_plan_choice);
  v_session_id:=(v_result->>'checkoutSessionId')::uuid;
  IF NOT FOUND THEN NULL; END IF;
  IF v_existing.id IS NULL THEN
    SELECT * INTO v_access FROM public.event_ticket_checkout_access WHERE event_id=p_event_id;
    IF COALESCE(v_access.mode,'unrestricted')='named_buyers' THEN
      SELECT * INTO v_member FROM public.event_ticket_checkout_allowed_buyers
       WHERE event_id=p_event_id AND buyer_user_id=p_buyer_user_id AND removed_at IS NULL;
      UPDATE public.ticket_checkout_sessions SET checkout_access_mode_snapshot='named_buyers',
        checkout_access_restrictive_epoch_snapshot=v_access.restrictive_epoch,
        checkout_access_membership_id_snapshot=v_member.membership_id,
        checkout_access_membership_epoch_snapshot=v_member.membership_epoch
      WHERE id=v_session_id;
    END IF;
  END IF;
  RETURN v_result;
END
$function$;

ALTER FUNCTION public.issue_1930_claim_ticket_provider_attempt(uuid,uuid,text,text,text)
  RENAME TO issue_2101_claim_ticket_provider_attempt_base;
CREATE OR REPLACE FUNCTION public.issue_1930_claim_ticket_provider_attempt(
  p_checkout_session_id uuid,p_event_id uuid,p_provider text,p_flow text,p_request_fingerprint text
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $function$
DECLARE v_result jsonb; v_session public.ticket_checkout_sessions%ROWTYPE; v_attempt_id uuid;
BEGIN
  PERFORM public.issue_2101_ticket_checkout_access_decision(p_event_id,NULL);
  SELECT * INTO v_session FROM public.ticket_checkout_sessions WHERE id=p_checkout_session_id;
  IF NOT public.issue_1930_ticket_session_authorized(p_checkout_session_id,p_event_id) THEN
    RETURN jsonb_build_object('outcome','revoked');
  END IF;
  IF EXISTS (SELECT 1 FROM public.ticket_checkout_provider_attempts a WHERE a.checkout_session_id=p_checkout_session_id
    AND (a.checkout_access_mode_snapshot,a.checkout_access_restrictive_epoch_snapshot,
         a.checkout_access_membership_id_snapshot,a.checkout_access_membership_epoch_snapshot)
      IS DISTINCT FROM (v_session.checkout_access_mode_snapshot,v_session.checkout_access_restrictive_epoch_snapshot,
         v_session.checkout_access_membership_id_snapshot,v_session.checkout_access_membership_epoch_snapshot)) THEN
    RETURN jsonb_build_object('outcome','revoked');
  END IF;
  v_result:=public.issue_2101_claim_ticket_provider_attempt_base(p_checkout_session_id,p_event_id,p_provider,p_flow,p_request_fingerprint);
  v_attempt_id:=(v_result->>'attemptId')::uuid;
  IF v_attempt_id IS NOT NULL THEN
    UPDATE public.ticket_checkout_provider_attempts SET
      checkout_access_mode_snapshot=v_session.checkout_access_mode_snapshot,
      checkout_access_restrictive_epoch_snapshot=v_session.checkout_access_restrictive_epoch_snapshot,
      checkout_access_membership_id_snapshot=v_session.checkout_access_membership_id_snapshot,
      checkout_access_membership_epoch_snapshot=v_session.checkout_access_membership_epoch_snapshot
    WHERE id=v_attempt_id;
  END IF;
  RETURN v_result;
END
$function$;

ALTER FUNCTION public.issue_1930_commit_ticket_provider_attempt(uuid,bigint,text,text,text,text)
  RENAME TO issue_2101_commit_ticket_provider_attempt_base;
CREATE OR REPLACE FUNCTION public.issue_1930_commit_ticket_provider_attempt(
  p_attempt_id uuid,p_claimed_epoch bigint,p_provider_object_id text,p_provider_checkout_id text,
  p_provider_reference text,p_continuation_fingerprint text
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $function$
DECLARE v_mismatch boolean;
BEGIN
  SELECT (a.checkout_access_mode_snapshot,a.checkout_access_restrictive_epoch_snapshot,
      a.checkout_access_membership_id_snapshot,a.checkout_access_membership_epoch_snapshot)
    IS DISTINCT FROM (s.checkout_access_mode_snapshot,s.checkout_access_restrictive_epoch_snapshot,
      s.checkout_access_membership_id_snapshot,s.checkout_access_membership_epoch_snapshot)
  INTO v_mismatch FROM public.ticket_checkout_provider_attempts a
  JOIN public.ticket_checkout_sessions s ON s.id=a.checkout_session_id WHERE a.id=p_attempt_id;
  RETURN public.issue_2101_commit_ticket_provider_attempt_base(p_attempt_id,
    CASE WHEN COALESCE(v_mismatch,false) THEN -1 ELSE p_claimed_epoch END,
    p_provider_object_id,p_provider_checkout_id,p_provider_reference,p_continuation_fingerprint);
END
$function$;

ALTER FUNCTION public.issue_1930_ticket_checkout_preflight(uuid,text)
  RENAME TO issue_2101_ticket_checkout_preflight_base;
CREATE OR REPLACE FUNCTION public.issue_1930_ticket_checkout_preflight(
  p_checkout_session_id uuid,p_buyer_status_token_hash text
) RETURNS text LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $function$
BEGIN
  IF EXISTS (SELECT 1 FROM public.ticket_checkout_provider_attempts a
    JOIN public.ticket_checkout_sessions s ON s.id=a.checkout_session_id
    WHERE s.id=p_checkout_session_id AND
      (a.checkout_access_mode_snapshot,a.checkout_access_restrictive_epoch_snapshot,
       a.checkout_access_membership_id_snapshot,a.checkout_access_membership_epoch_snapshot)
      IS DISTINCT FROM (s.checkout_access_mode_snapshot,s.checkout_access_restrictive_epoch_snapshot,
       s.checkout_access_membership_id_snapshot,s.checkout_access_membership_epoch_snapshot)) THEN
    RETURN 'unavailable';
  END IF;
  RETURN public.issue_2101_ticket_checkout_preflight_base(p_checkout_session_id,p_buyer_status_token_hash);
END
$function$;

ALTER FUNCTION public.biz_ticket_checkout_finalize(uuid,text,text,text,text,text,text,boolean)
  RENAME TO issue_2101_ticket_checkout_finalize_base;
CREATE OR REPLACE FUNCTION public.biz_ticket_checkout_finalize(
  p_checkout_session_id uuid,p_stripe_payment_intent_id text,p_stripe_charge_id text,
  p_stripe_payment_method_type text,p_qr_token_pepper text,
  p_stripe_customer_id_on_connected_account text DEFAULT NULL,
  p_saved_payment_method_id text DEFAULT NULL,p_installment_plan_root boolean DEFAULT false
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $function$
DECLARE v_session public.ticket_checkout_sessions%ROWTYPE; v_attempt public.ticket_checkout_provider_attempts%ROWTYPE;
  v_allowed boolean; v_provider text; v_reversal jsonb;
BEGIN
  SELECT * INTO v_session FROM public.ticket_checkout_sessions WHERE id=p_checkout_session_id;
  SELECT * INTO v_attempt FROM public.ticket_checkout_provider_attempts WHERE id=v_session.provider_attempt_id;
  v_allowed:=public.issue_1930_ticket_session_authorized(v_session.id,v_session.event_id)
    AND (v_attempt.id IS NULL OR
      (v_attempt.checkout_access_mode_snapshot,v_attempt.checkout_access_restrictive_epoch_snapshot,
       v_attempt.checkout_access_membership_id_snapshot,v_attempt.checkout_access_membership_epoch_snapshot)
      IS NOT DISTINCT FROM (v_session.checkout_access_mode_snapshot,v_session.checkout_access_restrictive_epoch_snapshot,
       v_session.checkout_access_membership_id_snapshot,v_session.checkout_access_membership_epoch_snapshot));
  IF NOT v_allowed THEN
    v_provider:=CASE WHEN v_attempt.id IS NOT NULL THEN v_attempt.provider
      WHEN COALESCE(p_stripe_payment_intent_id,'') ~ '^pi_[A-Za-z0-9]+$'
       AND COALESCE(p_stripe_charge_id,'') ~ '^ch_[A-Za-z0-9]+$' THEN 'stripe'
      WHEN COALESCE(p_stripe_payment_intent_id,'')<>'' AND COALESCE(p_stripe_charge_id,'') ~ '^[0-9]+$' THEN 'paystack'
      ELSE NULL END;
    v_reversal:=public.issue_1930_mint_ticket_late_reversal(v_session.id,v_provider,p_stripe_payment_intent_id,
      CASE WHEN v_provider='paystack' THEN p_stripe_charge_id ELSE NULL END,
      CASE WHEN v_provider='stripe' THEN p_stripe_charge_id ELSE NULL END);
    RETURN jsonb_build_object('outcome','paid_reversal_pending',
      'reversalReason',COALESCE(v_reversal->>'reason',v_reversal->>'outcome'));
  END IF;
  RETURN public.issue_2101_ticket_checkout_finalize_base(p_checkout_session_id,p_stripe_payment_intent_id,
    p_stripe_charge_id,p_stripe_payment_method_type,p_qr_token_pepper,
    p_stripe_customer_id_on_connected_account,p_saved_payment_method_id,p_installment_plan_root);
END
$function$;

REVOKE ALL ON FUNCTION public.issue_2101_ticket_session_authorized_base(uuid,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.issue_2101_ticket_checkout_create_session_base(uuid,uuid,text,text,text,boolean,jsonb,text,timestamptz,integer,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.issue_2101_claim_ticket_provider_attempt_base(uuid,uuid,text,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.issue_2101_commit_ticket_provider_attempt_base(uuid,bigint,text,text,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.issue_2101_ticket_checkout_preflight_base(uuid,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.issue_2101_ticket_checkout_finalize_base(uuid,text,text,text,text,text,text,boolean) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.issue_1930_ticket_session_authorized(uuid,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.biz_ticket_checkout_create_session(uuid,uuid,text,text,text,boolean,jsonb,text,timestamptz,integer,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.issue_1930_claim_ticket_provider_attempt(uuid,uuid,text,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.issue_1930_commit_ticket_provider_attempt(uuid,bigint,text,text,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.issue_1930_ticket_checkout_preflight(uuid,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.biz_ticket_checkout_finalize(uuid,text,text,text,text,text,text,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_2101_ticket_session_authorized_base(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_2101_ticket_checkout_create_session_base(uuid,uuid,text,text,text,boolean,jsonb,text,timestamptz,integer,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_2101_claim_ticket_provider_attempt_base(uuid,uuid,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_2101_commit_ticket_provider_attempt_base(uuid,bigint,text,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_2101_ticket_checkout_preflight_base(uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_2101_ticket_checkout_finalize_base(uuid,text,text,text,text,text,text,boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_1930_ticket_session_authorized(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.biz_ticket_checkout_create_session(uuid,uuid,text,text,text,boolean,jsonb,text,timestamptz,integer,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_1930_claim_ticket_provider_attempt(uuid,uuid,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_1930_commit_ticket_provider_attempt(uuid,bigint,text,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_1930_ticket_checkout_preflight(uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.biz_ticket_checkout_finalize(uuid,text,text,text,text,text,text,boolean) TO service_role;

COMMENT ON TABLE public.event_ticket_checkout_access IS
  '#2101: optional event-scoped checkout eligibility; absence and unrestricted preserve legacy checkout.';
COMMENT ON TABLE public.event_ticket_checkout_access_audit IS
  '#2101: immutable, bounded mutation replay and audit evidence; contains no contact or token data.';
