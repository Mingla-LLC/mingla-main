-- issue #3827 — private ticket links.
--
-- A private link belongs to exactly one ticket type. Free ticket types issue
-- one guest-list order and ticket per named person; paid ticket types unlock
-- their hidden tier for the ordinary checkout path. Link secrets are resolved
-- only by service-role edge functions. Public readers never receive hidden
-- tiers, and password protection is retired at the database boundary.
--
-- BEFORE MERGE: apply this migration to production before the edge functions
-- deploy. The operator must compare the governed function bodies named in the
-- PR precheck and stop on any drift.

BEGIN;
SET LOCAL lock_timeout = '10s';

-- ---------------------------------------------------------------------------
-- Schema
-- ---------------------------------------------------------------------------

CREATE TABLE public.ticket_type_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  ticket_type_id uuid NOT NULL REFERENCES public.ticket_types(id) ON DELETE CASCADE,
  event_date_id uuid NULL REFERENCES public.event_dates(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('guest_list', 'private_ticket')),
  label text NOT NULL CHECK (char_length(btrim(label)) BETWEEN 1 AND 60),
  max_uses integer NULL CHECK (max_uses BETWEEN 1 AND 5000),
  party_max smallint NOT NULL DEFAULT 1 CHECK (party_max BETWEEN 1 AND 10),
  approval_mode text NOT NULL DEFAULT 'auto' CHECK (approval_mode IN ('auto', 'host')),
  expires_at timestamptz NULL,
  revoked_at timestamptz NULL,
  revoked_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  token_nonce bytea NOT NULL CHECK (octet_length(token_nonce) = 16),
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  token_version smallint NOT NULL DEFAULT 1 CHECK (token_version = 1),
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ticket_type_links_kind_shape CHECK (
    kind = 'guest_list'
    OR (party_max = 1 AND approval_mode = 'auto')
  )
);

CREATE INDEX ticket_type_links_event_idx
  ON public.ticket_type_links(event_id, created_at DESC);
CREATE INDEX ticket_type_links_ticket_type_idx
  ON public.ticket_type_links(ticket_type_id);

CREATE TABLE public.ticket_link_signups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  link_id uuid NOT NULL REFERENCES public.ticket_type_links(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('pending', 'issued', 'declined', 'duplicate')),
  member_count smallint NOT NULL CHECK (member_count BETWEEN 1 AND 10),
  event_date_id uuid NULL REFERENCES public.event_dates(id) ON DELETE SET NULL,
  lead_order_id uuid NULL REFERENCES public.orders(id) ON DELETE SET NULL,
  client_request_id uuid NOT NULL,
  ip_hash text NULL CHECK (ip_hash IS NULL OR ip_hash ~ '^[0-9a-f]{64}$'),
  decided_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(link_id, client_request_id)
);

CREATE INDEX ticket_link_signups_link_idx
  ON public.ticket_link_signups(link_id, created_at DESC);
CREATE INDEX ticket_link_signups_pending_idx
  ON public.ticket_link_signups(event_id, created_at)
  WHERE status = 'pending';

CREATE TABLE public.ticket_link_signup_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  signup_id uuid NOT NULL REFERENCES public.ticket_link_signups(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  position smallint NOT NULL CHECK (position BETWEEN 0 AND 9),
  name text NULL CHECK (name IS NULL OR char_length(btrim(name)) BETWEEN 1 AND 120),
  email text NULL CHECK (email IS NULL OR char_length(email) <= 200),
  phone_e164 text NULL CHECK (phone_e164 IS NULL OR phone_e164 ~ '^\+[1-9][0-9]{1,14}$'),
  status text NOT NULL CHECK (status IN ('pending', 'issued', 'declined', 'duplicate')),
  order_id uuid NULL REFERENCES public.orders(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(signup_id, position),
  CONSTRAINT ticket_link_member_live_pii CHECK (
    status IN ('declined', 'duplicate')
    OR (name IS NOT NULL AND email IS NOT NULL AND phone_e164 IS NOT NULL)
  )
);

CREATE UNIQUE INDEX ticket_link_members_pending_email_uidx
  ON public.ticket_link_signup_members(event_id, lower(email))
  WHERE status = 'pending' AND email IS NOT NULL;
CREATE INDEX ticket_link_members_email_idx
  ON public.ticket_link_signup_members(event_id, lower(email));
CREATE INDEX ticket_link_members_phone_idx
  ON public.ticket_link_signup_members(event_id, phone_e164);

ALTER TABLE public.ticket_type_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_link_signups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_link_signup_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY ticket_type_links_team_read ON public.ticket_type_links
  FOR SELECT TO authenticated
  USING (
    public.biz_brand_effective_rank(brand_id, auth.uid())
      >= public.biz_role_rank('event_manager')
  );

REVOKE ALL ON TABLE public.ticket_type_links FROM anon, authenticated;
GRANT SELECT (
  id, event_id, brand_id, ticket_type_id, event_date_id, kind, label,
  max_uses, party_max, approval_mode, expires_at, revoked_at, created_at,
  updated_at
) ON public.ticket_type_links TO authenticated;
REVOKE ALL ON TABLE public.ticket_link_signups FROM anon, authenticated;
REVOKE ALL ON TABLE public.ticket_link_signup_members FROM anon, authenticated;
GRANT ALL ON TABLE public.ticket_type_links TO service_role;
GRANT ALL ON TABLE public.ticket_link_signups TO service_role;
GRANT ALL ON TABLE public.ticket_link_signup_members TO service_role;

ALTER TABLE public.orders
  ADD COLUMN ticket_link_signup_id uuid NULL
  REFERENCES public.ticket_link_signups(id) ON DELETE SET NULL;
CREATE INDEX orders_ticket_link_signup_idx ON public.orders(ticket_link_signup_id)
  WHERE ticket_link_signup_id IS NOT NULL;

ALTER TABLE public.orders DROP CONSTRAINT orders_comp_fields_only_on_comp;
ALTER TABLE public.orders
  ADD CONSTRAINT orders_comp_fields_only_on_comp CHECK (
    source = 'comp'
    OR (
      comp_issued_by IS NULL AND comp_reason IS NULL AND comp_request_key IS NULL
      AND comp_party_lead_order_id IS NULL AND ticket_link_signup_id IS NULL
    )
  ) NOT VALID;
ALTER TABLE public.orders VALIDATE CONSTRAINT orders_comp_fields_only_on_comp;

ALTER TABLE public.ticket_checkout_sessions
  ADD COLUMN ticket_link_id uuid NULL
    REFERENCES public.ticket_type_links(id) ON DELETE SET NULL,
  ADD COLUMN ticket_link_units integer NULL
    CHECK (ticket_link_units IS NULL OR ticket_link_units > 0),
  ADD CONSTRAINT ticket_checkout_session_link_shape CHECK (
    (ticket_link_id IS NULL) = (ticket_link_units IS NULL)
  );
CREATE INDEX ticket_checkout_sessions_link_idx
  ON public.ticket_checkout_sessions(ticket_link_id)
  WHERE ticket_link_id IS NOT NULL;

COMMENT ON TABLE public.ticket_type_links IS
  'issue #3827: host-managed bearer links for one ticket type.';
COMMENT ON TABLE public.ticket_link_signups IS
  'issue #3827: one guest-list link submission (a group).';
COMMENT ON TABLE public.ticket_link_signup_members IS
  'issue #3827: one named person in a guest-list link submission.';
COMMENT ON COLUMN public.orders.ticket_link_signup_id IS
  'issue #3827: the guest-list link submission that issued this comp order.';

-- Enforce cross-table ownership and immutable link identity even for service
-- callers outside the host RPCs.
CREATE OR REPLACE FUNCTION public.issue_3827_ticket_link_row_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_brand uuid;
  v_tier_event uuid;
  v_date_event uuid;
BEGIN
  SELECT e.brand_id INTO v_brand FROM public.events e WHERE e.id = NEW.event_id;
  SELECT tt.event_id INTO v_tier_event FROM public.ticket_types tt WHERE tt.id = NEW.ticket_type_id;
  IF v_brand IS NULL OR v_brand <> NEW.brand_id OR v_tier_event IS NULL OR v_tier_event <> NEW.event_id THEN
    RAISE EXCEPTION 'ticket_link_scope_invalid';
  END IF;
  IF NEW.event_date_id IS NOT NULL THEN
    SELECT d.event_id INTO v_date_event FROM public.event_dates d WHERE d.id = NEW.event_date_id;
    IF v_date_event IS NULL OR v_date_event <> NEW.event_id THEN
      RAISE EXCEPTION 'ticket_link_date_invalid';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND (
    NEW.event_id <> OLD.event_id OR NEW.brand_id <> OLD.brand_id
    OR NEW.ticket_type_id <> OLD.ticket_type_id OR NEW.kind <> OLD.kind
  ) THEN
    RAISE EXCEPTION 'ticket_link_identity_immutable';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER issue_3827_ticket_link_row_guard
BEFORE INSERT OR UPDATE ON public.ticket_type_links
FOR EACH ROW EXECUTE FUNCTION public.issue_3827_ticket_link_row_guard();

-- ---------------------------------------------------------------------------
-- State and accounting helpers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.issue_3827_link_uses_taken(p_link_id uuid)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_kind text;
  v_used integer;
BEGIN
  SELECT l.kind INTO v_kind FROM public.ticket_type_links l WHERE l.id = p_link_id;
  IF v_kind = 'guest_list' THEN
    SELECT count(t.id)::integer INTO v_used
      FROM public.orders o
      JOIN public.tickets t ON t.order_id = o.id
     WHERE o.ticket_link_id = p_link_id
       AND o.source = 'comp'
       AND o.payment_status IN ('paid', 'partial_refund')
       AND t.status IN ('valid', 'used');
  ELSIF v_kind = 'private_ticket' THEN
    SELECT COALESCE(sum(s.ticket_link_units), 0)::integer INTO v_used
      FROM public.ticket_checkout_sessions s
     WHERE s.ticket_link_id = p_link_id
       AND (
         (s.expires_at > now() AND s.status IN (
           'pending_free', 'requires_payment', 'processing_payment', 'awaiting_web_redirect'
         ))
         OR EXISTS (
           SELECT 1 FROM public.orders o
            WHERE o.checkout_session_id = s.id
              AND o.payment_status IN ('paid', 'partial_refund')
         )
       );
  ELSE
    v_used := 0;
  END IF;
  RETURN COALESCE(v_used, 0);
END;
$$;

CREATE OR REPLACE FUNCTION public.issue_3827_link_state(
  p_link public.ticket_type_links,
  p_now timestamptz DEFAULT now()
) RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_event record;
  v_tier record;
BEGIN
  IF p_link.revoked_at IS NOT NULL THEN RETURN 'revoked'; END IF;
  IF p_link.expires_at IS NOT NULL AND p_link.expires_at <= p_now THEN RETURN 'expired'; END IF;

  SELECT e.status, e.visibility, e.deleted_at INTO v_event
    FROM public.events e WHERE e.id = p_link.event_id;
  IF NOT FOUND OR v_event.deleted_at IS NOT NULL
     OR v_event.status NOT IN ('scheduled', 'live')
     OR v_event.visibility NOT IN ('public', 'hidden') THEN
    RETURN 'event_unavailable';
  END IF;
  IF EXISTS (SELECT 1 FROM public.event_dates d WHERE d.event_id = p_link.event_id)
     AND NOT EXISTS (
       SELECT 1 FROM public.event_dates d
        WHERE d.event_id = p_link.event_id AND d.end_at > p_now
     ) THEN
    RETURN 'event_ended';
  END IF;

  SELECT tt.deleted_at, tt.is_disabled, tt.available_online INTO v_tier
    FROM public.ticket_types tt WHERE tt.id = p_link.ticket_type_id;
  IF NOT FOUND OR v_tier.deleted_at IS NOT NULL OR COALESCE(v_tier.is_disabled, false)
     OR (p_link.kind = 'private_ticket' AND NOT COALESCE(v_tier.available_online, false)) THEN
    RETURN 'tier_unavailable';
  END IF;
  IF p_link.max_uses IS NOT NULL
     AND public.issue_3827_link_uses_taken(p_link.id) >= p_link.max_uses THEN
    RETURN 'full';
  END IF;
  RETURN 'active';
END;
$$;

CREATE OR REPLACE FUNCTION public.issue_3827_link_unlocks_tier(p_ticket_type_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_link public.ticket_type_links;
  v_setting text := current_setting('mingla.ticket_link_id', true);
BEGIN
  IF v_setting IS NULL OR v_setting = '' THEN RETURN false; END IF;
  BEGIN
    SELECT * INTO v_link FROM public.ticket_type_links l WHERE l.id = v_setting::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN false;
  END;
  RETURN FOUND
    AND v_link.ticket_type_id = p_ticket_type_id
    AND v_link.kind = 'private_ticket'
    AND public.issue_3827_link_state(v_link, now()) IN ('active', 'full');
END;
$$;

REVOKE ALL ON FUNCTION public.issue_3827_ticket_link_row_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_3827_link_uses_taken(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_3827_link_state(public.ticket_type_links, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_3827_link_unlocks_tier(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3827_ticket_link_row_guard() TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_3827_link_uses_taken(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_3827_link_state(public.ticket_type_links, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_3827_link_unlocks_tier(uuid) TO service_role;

-- Paid orders inherit their attribution from the checkout session. No finalize
-- function needs another re-emit.
CREATE OR REPLACE FUNCTION public.issue_3827_order_link_from_session()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.checkout_session_id IS NOT NULL AND NEW.ticket_link_id IS NULL THEN
    SELECT s.ticket_link_id INTO NEW.ticket_link_id
      FROM public.ticket_checkout_sessions s WHERE s.id = NEW.checkout_session_id;
  END IF;
  RETURN NEW;
END;
$$;

-- Named trg_orders_* so it sorts after trg_biz_trip_order_delete_lock: same-timing
-- triggers fire in name order and the trip guard must reject a row first (#1971 X-08).
CREATE TRIGGER trg_orders_ticket_link_from_session
BEFORE INSERT ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.issue_3827_order_link_from_session();

REVOKE ALL ON FUNCTION public.issue_3827_order_link_from_session() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3827_order_link_from_session() TO service_role;

-- ---------------------------------------------------------------------------
-- Host link management
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.biz_ticket_link_create(
  p_actor_id uuid,
  p_event_id uuid,
  p_ticket_type_id uuid,
  p_event_date_id uuid,
  p_label text,
  p_max_uses integer,
  p_party_max integer,
  p_approval_mode text,
  p_expires_at timestamptz,
  p_link_id uuid,
  p_nonce bytea,
  p_token_hash text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_event record;
  v_tier record;
  v_kind text;
  v_link public.ticket_type_links;
BEGIN
  IF p_actor_id IS NULL OR p_event_id IS NULL OR p_ticket_type_id IS NULL
     OR p_link_id IS NULL OR octet_length(p_nonce) <> 16
     OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid_request';
  END IF;
  SELECT e.id, e.brand_id, e.status, e.visibility, e.deleted_at, e.event_type
    INTO v_event FROM public.events e WHERE e.id = p_event_id FOR UPDATE;
  IF NOT FOUND OR v_event.deleted_at IS NOT NULL OR v_event.status NOT IN ('scheduled', 'live')
     OR v_event.visibility NOT IN ('public', 'hidden') THEN
    RAISE EXCEPTION 'event_unavailable';
  END IF;
  IF v_event.event_type IN ('trip', 'experience', 'rsvp') THEN
    RAISE EXCEPTION 'event_type_unsupported';
  END IF;
  IF EXISTS (SELECT 1 FROM public.event_dates d WHERE d.event_id = p_event_id)
     AND NOT EXISTS (SELECT 1 FROM public.event_dates d WHERE d.event_id = p_event_id AND d.end_at > now()) THEN
    RAISE EXCEPTION 'event_ended';
  END IF;
  IF public.biz_brand_effective_rank(v_event.brand_id, p_actor_id)
      < public.biz_role_rank('event_manager') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  SELECT tt.id, tt.event_id, tt.is_free, tt.price_cents, tt.is_disabled,
         tt.is_hidden, tt.available_online, tt.deleted_at
    INTO v_tier FROM public.ticket_types tt
   WHERE tt.id = p_ticket_type_id FOR UPDATE;
  IF NOT FOUND OR v_tier.deleted_at IS NOT NULL OR v_tier.event_id <> p_event_id THEN
    RAISE EXCEPTION 'ticket_type_not_found';
  END IF;
  v_kind := CASE WHEN COALESCE(v_tier.is_free, false) OR COALESCE(v_tier.price_cents, 0) = 0
                 THEN 'guest_list' ELSE 'private_ticket' END;
  IF v_kind = 'private_ticket'
     AND (COALESCE(v_tier.is_disabled, false) OR NOT COALESCE(v_tier.available_online, false)) THEN
    RAISE EXCEPTION 'tier_not_sellable_online';
  END IF;
  IF v_kind = 'private_ticket' AND NOT COALESCE(v_tier.is_hidden, false) THEN
    RAISE EXCEPTION 'paid_tier_must_be_hidden';
  END IF;
  IF p_event_date_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.event_dates d
     WHERE d.id = p_event_date_id AND d.event_id = p_event_id AND d.end_at > now()
  ) THEN
    RAISE EXCEPTION 'occurrence_not_available';
  END IF;
  IF p_expires_at IS NOT NULL AND p_expires_at <= now() THEN
    RAISE EXCEPTION 'expiry_in_past';
  END IF;
  IF char_length(btrim(COALESCE(p_label, ''))) NOT BETWEEN 1 AND 60
     OR p_max_uses IS NOT NULL AND p_max_uses NOT BETWEEN 1 AND 5000
     OR COALESCE(p_party_max, 1) NOT BETWEEN 1 AND 10
     OR COALESCE(p_approval_mode, 'auto') NOT IN ('auto', 'host') THEN
    RAISE EXCEPTION 'invalid_request';
  END IF;
  IF v_kind = 'private_ticket'
     AND (COALESCE(p_party_max, 1) <> 1 OR COALESCE(p_approval_mode, 'auto') <> 'auto') THEN
    RAISE EXCEPTION 'invalid_request';
  END IF;
  IF (SELECT count(*) FROM public.ticket_type_links l
       WHERE l.event_id = p_event_id AND l.revoked_at IS NULL) >= 100 THEN
    RAISE EXCEPTION 'too_many_links';
  END IF;

  INSERT INTO public.ticket_type_links(
    id, event_id, brand_id, ticket_type_id, event_date_id, kind, label,
    max_uses, party_max, approval_mode, expires_at, token_nonce, token_hash,
    created_by
  ) VALUES (
    p_link_id, p_event_id, v_event.brand_id, p_ticket_type_id, p_event_date_id,
    v_kind, btrim(p_label), p_max_uses,
    CASE WHEN v_kind = 'private_ticket' THEN 1 ELSE COALESCE(p_party_max, 1) END,
    CASE WHEN v_kind = 'private_ticket' THEN 'auto' ELSE COALESCE(p_approval_mode, 'auto') END,
    p_expires_at, p_nonce, p_token_hash, p_actor_id
  ) RETURNING * INTO v_link;

  RETURN jsonb_build_object(
    'id', v_link.id, 'eventId', v_link.event_id,
    'ticketTypeId', v_link.ticket_type_id, 'eventDateId', v_link.event_date_id,
    'kind', v_link.kind, 'label', v_link.label, 'maxUses', v_link.max_uses,
    'partyMax', v_link.party_max, 'approvalMode', v_link.approval_mode,
    'expiresAt', v_link.expires_at, 'revokedAt', v_link.revoked_at,
    'createdAt', v_link.created_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.biz_ticket_link_update(
  p_actor_id uuid,
  p_link_id uuid,
  p_patch jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_link public.ticket_type_links;
  v_used integer;
  v_key text;
  v_max integer;
  v_party integer;
  v_approval text;
  v_expiry timestamptz;
  v_label text;
BEGIN
  SELECT l.* INTO v_link FROM public.ticket_type_links l WHERE l.id = p_link_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'link_not_found'; END IF;
  IF public.biz_brand_effective_rank(v_link.brand_id, p_actor_id)
      < public.biz_role_rank('event_manager') THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF v_link.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'link_revoked'; END IF;
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN RAISE EXCEPTION 'invalid_request'; END IF;
  FOR v_key IN SELECT jsonb_object_keys(p_patch) LOOP
    IF v_key NOT IN ('label', 'maxUses', 'partyMax', 'approvalMode', 'expiresAt') THEN
      RAISE EXCEPTION 'invalid_request';
    END IF;
  END LOOP;

  v_label := CASE WHEN p_patch ? 'label' THEN btrim(COALESCE(p_patch ->> 'label', '')) ELSE v_link.label END;
  v_max := CASE WHEN p_patch ? 'maxUses' AND p_patch -> 'maxUses' <> 'null'::jsonb
                THEN (p_patch ->> 'maxUses')::integer
                WHEN p_patch ? 'maxUses' THEN NULL ELSE v_link.max_uses END;
  v_party := CASE WHEN p_patch ? 'partyMax' THEN (p_patch ->> 'partyMax')::integer ELSE v_link.party_max END;
  v_approval := CASE WHEN p_patch ? 'approvalMode' THEN p_patch ->> 'approvalMode' ELSE v_link.approval_mode END;
  v_expiry := CASE WHEN p_patch ? 'expiresAt' AND p_patch -> 'expiresAt' <> 'null'::jsonb
                   THEN (p_patch ->> 'expiresAt')::timestamptz
                   WHEN p_patch ? 'expiresAt' THEN NULL ELSE v_link.expires_at END;

  IF char_length(v_label) NOT BETWEEN 1 AND 60
     OR v_max IS NOT NULL AND v_max NOT BETWEEN 1 AND 5000
     OR v_party NOT BETWEEN 1 AND 10 OR v_approval NOT IN ('auto', 'host')
     OR v_expiry IS NOT NULL AND v_expiry <= now()
     OR v_link.kind = 'private_ticket' AND (v_party <> 1 OR v_approval <> 'auto') THEN
    RAISE EXCEPTION 'invalid_request';
  END IF;
  v_used := public.issue_3827_link_uses_taken(v_link.id);
  IF v_max IS NOT NULL AND v_max < v_used THEN
    RAISE EXCEPTION 'max_below_used' USING HINT = jsonb_build_object('used', v_used)::text;
  END IF;

  UPDATE public.ticket_type_links SET
    label = v_label, max_uses = v_max, party_max = v_party,
    approval_mode = v_approval, expires_at = v_expiry
  WHERE id = v_link.id RETURNING * INTO v_link;

  RETURN jsonb_build_object(
    'id', v_link.id, 'label', v_link.label, 'maxUses', v_link.max_uses,
    'partyMax', v_link.party_max, 'approvalMode', v_link.approval_mode,
    'expiresAt', v_link.expires_at, 'updatedAt', v_link.updated_at
  );
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
  RAISE EXCEPTION 'invalid_request';
END;
$$;

CREATE OR REPLACE FUNCTION public.biz_ticket_link_revoke(
  p_actor_id uuid,
  p_link_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_link public.ticket_type_links;
BEGIN
  SELECT l.* INTO v_link FROM public.ticket_type_links l WHERE l.id = p_link_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'link_not_found'; END IF;
  IF public.biz_brand_effective_rank(v_link.brand_id, p_actor_id)
      < public.biz_role_rank('event_manager') THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF v_link.revoked_at IS NULL THEN
    UPDATE public.ticket_type_links
       SET revoked_at = now(), revoked_by = p_actor_id WHERE id = p_link_id;
    UPDATE public.ticket_link_signups
       SET status = 'declined', decided_by = p_actor_id, decided_at = now()
     WHERE link_id = p_link_id AND status = 'pending';
    UPDATE public.ticket_link_signup_members m
       SET status = 'declined'
      FROM public.ticket_link_signups s
     WHERE m.signup_id = s.id AND s.link_id = p_link_id AND m.status = 'pending';
  END IF;
  RETURN jsonb_build_object('status', 'revoked');
END;
$$;

CREATE OR REPLACE FUNCTION public.biz_ticket_link_reset(
  p_actor_id uuid,
  p_link_id uuid,
  p_nonce bytea,
  p_token_hash text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_link public.ticket_type_links;
BEGIN
  SELECT l.* INTO v_link FROM public.ticket_type_links l WHERE l.id = p_link_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'link_not_found'; END IF;
  IF public.biz_brand_effective_rank(v_link.brand_id, p_actor_id)
      < public.biz_role_rank('event_manager') THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF v_link.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'link_revoked'; END IF;
  IF octet_length(p_nonce) <> 16 OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid_request';
  END IF;
  UPDATE public.ticket_type_links
     SET token_nonce = p_nonce, token_hash = p_token_hash
   WHERE id = p_link_id;
  RETURN jsonb_build_object('id', p_link_id, 'tokenNonce', encode(p_nonce, 'hex'));
END;
$$;

CREATE OR REPLACE FUNCTION public.biz_ticket_link_list(
  p_actor_id uuid,
  p_event_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_brand uuid; v_rows jsonb;
BEGIN
  SELECT e.brand_id INTO v_brand FROM public.events e WHERE e.id = p_event_id AND e.deleted_at IS NULL;
  IF NOT FOUND OR public.biz_brand_effective_rank(v_brand, p_actor_id)
      < public.biz_role_rank('event_manager') THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', l.id, 'eventId', l.event_id, 'ticketTypeId', l.ticket_type_id,
    'ticketTypeName', tt.name, 'eventDateId', l.event_date_id,
    'kind', l.kind, 'label', l.label, 'maxUses', l.max_uses,
    'partyMax', l.party_max, 'approvalMode', l.approval_mode,
    'expiresAt', l.expires_at, 'revokedAt', l.revoked_at,
    'createdAt', l.created_at, 'tokenNonce', encode(l.token_nonce, 'hex'),
    'state', public.issue_3827_link_state(l, now()),
    'usesTaken', public.issue_3827_link_uses_taken(l.id),
    'usesLeft', CASE WHEN l.max_uses IS NULL THEN NULL
      ELSE GREATEST(l.max_uses - public.issue_3827_link_uses_taken(l.id), 0) END,
    'pendingCount', (SELECT count(*) FROM public.ticket_link_signups s
      WHERE s.link_id = l.id AND s.status = 'pending'),
    'pendingPeople', (SELECT count(*) FROM public.ticket_link_signup_members m
      JOIN public.ticket_link_signups s ON s.id = m.signup_id
      WHERE s.link_id = l.id AND m.status = 'pending'),
    'issuedPeople', CASE WHEN l.kind = 'guest_list' THEN public.issue_3827_link_uses_taken(l.id) ELSE 0 END,
    'paidOrders', (SELECT count(*) FROM public.orders o
      WHERE o.ticket_link_id = l.id AND o.source <> 'comp'
        AND o.payment_status IN ('paid', 'partial_refund')),
    'paidTickets', (SELECT count(t.id) FROM public.orders o JOIN public.tickets t ON t.order_id = o.id
      WHERE o.ticket_link_id = l.id AND o.source <> 'comp'
        AND o.payment_status IN ('paid', 'partial_refund') AND t.status IN ('valid', 'used'))
  ) ORDER BY l.created_at DESC), '[]'::jsonb) INTO v_rows
  FROM public.ticket_type_links l
  JOIN public.ticket_types tt ON tt.id = l.ticket_type_id
  WHERE l.event_id = p_event_id;
  RETURN v_rows;
END;
$$;

REVOKE ALL ON FUNCTION public.biz_ticket_link_create(uuid,uuid,uuid,uuid,text,integer,integer,text,timestamptz,uuid,bytea,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.biz_ticket_link_update(uuid,uuid,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.biz_ticket_link_revoke(uuid,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.biz_ticket_link_reset(uuid,uuid,bytea,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.biz_ticket_link_list(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.biz_ticket_link_create(uuid,uuid,uuid,uuid,text,integer,integer,text,timestamptz,uuid,bytea,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.biz_ticket_link_update(uuid,uuid,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.biz_ticket_link_revoke(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.biz_ticket_link_reset(uuid,uuid,bytea,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.biz_ticket_link_list(uuid,uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- Group issuance and public guest-list submission
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.issue_3827_issue_link_signup(
  p_signup_id uuid,
  p_issued_by uuid,
  p_qr_token_pepper text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_signup public.ticket_link_signups;
  v_link public.ticket_type_links;
  v_event record;
  v_tier record;
  v_choice jsonb;
  v_member record;
  v_existing uuid;
  v_new integer := 0;
  v_used integer;
  v_held integer := 0;
  v_remaining integer;
  v_lead_order uuid;
  v_one jsonb;
  v_orders jsonb := '[]'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
  v_state text;
BEGIN
  SELECT s.* INTO v_signup FROM public.ticket_link_signups s WHERE s.id = p_signup_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'signup_not_found'; END IF;
  IF v_signup.status NOT IN ('pending', 'issued', 'duplicate') THEN
    RETURN jsonb_build_object('status', v_signup.status, 'idempotentReplay', true,
      'leadOrderId', v_signup.lead_order_id, 'emailQueuedOrderIds', '[]'::jsonb,
      'issuedCount', 0, 'skippedNames', '[]'::jsonb);
  END IF;
  IF v_signup.status IN ('issued', 'duplicate') THEN
    RETURN jsonb_build_object('status', v_signup.status, 'idempotentReplay', true,
      'leadOrderId', v_signup.lead_order_id, 'emailQueuedOrderIds', '[]'::jsonb,
      'issuedCount', 0, 'skippedNames', '[]'::jsonb);
  END IF;

  SELECT l.* INTO v_link FROM public.ticket_type_links l WHERE l.id = v_signup.link_id FOR UPDATE;
  SELECT e.id, e.brand_id, e.status, e.visibility, e.deleted_at, e.event_type
    INTO v_event FROM public.events e WHERE e.id = v_signup.event_id FOR UPDATE;
  PERFORM 1 FROM public.brands b WHERE b.id = v_event.brand_id FOR UPDATE;
  SELECT tt.id, tt.name, tt.quantity_total, COALESCE(tt.is_unlimited, false) AS is_unlimited,
         tt.sold_count
    INTO v_tier FROM public.ticket_types tt WHERE tt.id = v_link.ticket_type_id FOR UPDATE;

  v_state := public.issue_3827_link_state(v_link, now());
  IF v_state NOT IN ('active', 'full') THEN
    RAISE EXCEPTION '%', CASE v_state
      WHEN 'revoked' THEN 'link_revoked' WHEN 'expired' THEN 'link_expired'
      ELSE v_state END;
  END IF;

  -- Re-classify under the event lock. A host may have added somebody while the
  -- request waited; that person is skipped without blocking the group.
  FOR v_member IN
    SELECT m.* FROM public.ticket_link_signup_members m
     WHERE m.signup_id = v_signup.id ORDER BY m.position FOR UPDATE
  LOOP
    SELECT o.id INTO v_existing FROM public.orders o
     WHERE o.event_id = v_signup.event_id AND o.source = 'comp'
       AND o.payment_status IN ('paid', 'partial_refund')
       AND lower(o.buyer_email) = lower(v_member.email)
     ORDER BY o.created_at, o.id LIMIT 1;
    IF v_existing IS NOT NULL THEN
      UPDATE public.ticket_link_signup_members
         SET status = 'duplicate', order_id = v_existing WHERE id = v_member.id;
      v_skipped := v_skipped || jsonb_build_array(v_member.name);
      IF v_member.position = 0 THEN v_lead_order := v_existing; END IF;
      INSERT INTO public.ticket_order_notifications(
        order_id, event_id, channel, recipient, idempotency_key, payload
      ) VALUES (
        v_existing, v_signup.event_id, 'email', v_member.email,
        'ticket_link_resend:' || v_existing::text || ':' || to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD'),
        jsonb_build_object('source', 'comp', 'resend', true)
      ) ON CONFLICT (idempotency_key) DO NOTHING;
    ELSE
      UPDATE public.ticket_link_signup_members
         SET status = 'pending', order_id = NULL WHERE id = v_member.id;
      v_new := v_new + 1;
    END IF;
  END LOOP;

  v_used := public.issue_3827_link_uses_taken(v_link.id);
  IF v_link.max_uses IS NOT NULL AND v_used + v_new > v_link.max_uses THEN
    RAISE EXCEPTION 'link_full' USING HINT = jsonb_build_object(
      'remaining', GREATEST(v_link.max_uses - v_used, 0), 'needed', v_new
    )::text;
  END IF;

  v_choice := public.issue_3313_event_day_choice(v_signup.event_id);
  IF NOT v_tier.is_unlimited AND v_tier.quantity_total IS NOT NULL THEN
    IF COALESCE((v_choice ->> 'perOccurrenceCapacity')::boolean, false)
       AND v_signup.event_date_id IS NOT NULL THEN
      v_remaining := v_tier.quantity_total
        - public.issue_3313_ticket_type_occurrence_taken(v_tier.id, v_signup.event_date_id);
    ELSE
      SELECT COALESCE(sum(i.quantity), 0)::integer INTO v_held
        FROM public.ticket_checkout_session_items i
        JOIN public.ticket_checkout_sessions s ON s.id = i.checkout_session_id
       WHERE i.ticket_type_id = v_tier.id AND s.expires_at > now()
         AND s.status IN ('pending_free', 'requires_payment', 'processing_payment', 'awaiting_web_redirect');
      v_remaining := v_tier.quantity_total - COALESCE(v_tier.sold_count, 0) - v_held;
    END IF;
    IF v_new > v_remaining THEN
      RAISE EXCEPTION 'ticket_capacity_exceeded' USING HINT = jsonb_build_object(
        'remaining', GREATEST(v_remaining, 0), 'needed', v_new,
        'ticketName', v_tier.name
      )::text;
    END IF;
  END IF;

  -- Lead first, then guests. Exceptions are deliberately not caught:
  -- I-3827-LINK-GROUP-ATOMIC rolls the entire group back.
  FOR v_member IN
    SELECT m.* FROM public.ticket_link_signup_members m
     WHERE m.signup_id = v_signup.id ORDER BY m.position
  LOOP
    IF v_member.status = 'duplicate' THEN CONTINUE; END IF;
    v_one := public.issue_3827_comp_issue_one(
      v_signup.event_id, v_event.brand_id, v_link.ticket_type_id,
      v_signup.event_date_id, v_member.name, v_member.email, v_member.phone_e164,
      1, 'link:' || v_signup.id::text || ':' || v_member.position::text,
      p_qr_token_pepper, p_issued_by, v_link.id, NULL,
      CASE WHEN v_member.position = 0 THEN NULL ELSE v_lead_order END,
      CASE WHEN v_member.position = 0 THEN NULL ELSE (
        SELECT m0.name FROM public.ticket_link_signup_members m0
         WHERE m0.signup_id = v_signup.id AND m0.position = 0
      ) END,
      CASE WHEN v_member.position = 0 THEN NULL ELSE 'link' END,
      jsonb_build_object(
        'marketing_opt_in', true, 'via_link', true,
        'ticket_link_signup_id', v_signup.id
      )
    );
    v_existing := (v_one ->> 'orderId')::uuid;
    UPDATE public.orders SET ticket_link_signup_id = v_signup.id WHERE id = v_existing;
    UPDATE public.ticket_link_signup_members
       SET status = 'issued', order_id = v_existing WHERE id = v_member.id;
    IF v_member.position = 0 THEN v_lead_order := v_existing; END IF;
    IF COALESCE((v_one ->> 'emailQueued')::boolean, false) THEN
      v_orders := v_orders || jsonb_build_array(v_existing);
    END IF;
  END LOOP;

  UPDATE public.ticket_link_signups
     SET status = CASE WHEN v_new = 0 THEN 'duplicate' ELSE 'issued' END,
         lead_order_id = v_lead_order,
         decided_by = p_issued_by,
         decided_at = CASE WHEN p_issued_by IS NULL THEN decided_at ELSE now() END
   WHERE id = v_signup.id;

  RETURN jsonb_build_object(
    'status', CASE WHEN v_new = 0 THEN 'duplicate' ELSE 'issued' END,
    'leadOrderId', v_lead_order, 'emailQueuedOrderIds', v_orders,
    'issuedCount', v_new, 'skippedNames', v_skipped
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.pg_ticket_link_signup(
  p_token_hash text,
  p_members jsonb,
  p_event_date_id uuid,
  p_client_request_id uuid,
  p_ip_hash text,
  p_qr_token_pepper text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_link public.ticket_type_links;
  v_event record;
  v_tier record;
  v_choice jsonb;
  v_existing_signup public.ticket_link_signups;
  v_signup_id uuid := gen_random_uuid();
  v_date_id uuid;
  v_item jsonb;
  v_members jsonb := '[]'::jsonb;
  v_emails text[] := ARRAY[]::text[];
  v_i integer;
  v_name text;
  v_email text;
  v_phone text;
  v_existing_order uuid;
  v_pending boolean;
  v_status text;
  v_email_hits integer;
  v_phone_hits integer;
  v_result jsonb;
  v_people jsonb;
BEGIN
  IF p_token_hash !~ '^[0-9a-f]{64}$' OR p_client_request_id IS NULL
     OR p_ip_hash IS NOT NULL AND p_ip_hash !~ '^[0-9a-f]{64}$'
     OR p_members IS NULL OR jsonb_typeof(p_members) <> 'array'
     OR jsonb_array_length(p_members) NOT BETWEEN 1 AND 10 THEN
    RAISE EXCEPTION 'invalid_request';
  END IF;

  FOR v_i IN 0 .. jsonb_array_length(p_members) - 1 LOOP
    v_item := p_members -> v_i;
    v_name := btrim(COALESCE(v_item ->> 'name', ''));
    v_email := lower(btrim(COALESCE(v_item ->> 'email', '')));
    v_phone := btrim(COALESCE(v_item ->> 'phoneE164', ''));
    IF jsonb_typeof(v_item) <> 'object' OR v_item - ARRAY['name','email','phoneE164'] <> '{}'::jsonb
       OR char_length(v_name) NOT BETWEEN 1 AND 120 THEN
      RAISE EXCEPTION 'invalid_request' USING HINT = jsonb_build_object(
        'field', 'members.' || v_i || '.name', 'reason', 'missing'
      )::text;
    END IF;
    IF char_length(v_email) > 200 OR v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
      RAISE EXCEPTION 'invalid_request' USING HINT = jsonb_build_object(
        'field', 'members.' || v_i || '.email', 'reason', 'format'
      )::text;
    END IF;
    IF v_email = ANY(v_emails) THEN
      RAISE EXCEPTION 'invalid_request' USING HINT = jsonb_build_object(
        'field', 'members.' || v_i || '.email', 'reason', 'duplicate_in_request'
      )::text;
    END IF;
    v_emails := v_emails || v_email;
    IF v_phone !~ '^\+[1-9][0-9]{1,14}$' THEN
      RAISE EXCEPTION 'invalid_request' USING HINT = jsonb_build_object(
        'field', 'members.' || v_i || '.phone', 'reason', 'format'
      )::text;
    END IF;
    v_members := v_members || jsonb_build_array(jsonb_build_object(
      'position', v_i, 'name', v_name, 'email', v_email, 'phoneE164', v_phone
    ));
  END LOOP;

  SELECT l.* INTO v_link FROM public.ticket_type_links l WHERE l.token_hash = p_token_hash FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'link_not_found'; END IF;
  SELECT s.* INTO v_existing_signup FROM public.ticket_link_signups s
   WHERE s.link_id = v_link.id AND s.client_request_id = p_client_request_id;
  IF FOUND THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'position', m.position, 'name', m.name,
      'maskedEmail', CASE WHEN position('@' IN m.email) < 2 THEN '***'
        ELSE left(split_part(m.email, '@', 1), LEAST(2, char_length(split_part(m.email, '@', 1))))
          || '***@' || split_part(m.email, '@', 2) END
    ) ORDER BY m.position), '[]'::jsonb) INTO v_people
    FROM public.ticket_link_signup_members m WHERE m.signup_id = v_existing_signup.id;
    RETURN jsonb_build_object('status', CASE WHEN v_existing_signup.status = 'duplicate' THEN 'issued'
      ELSE v_existing_signup.status END, 'people', v_people, 'emailQueuedOrderIds', '[]'::jsonb);
  END IF;

  SELECT e.id, e.brand_id, e.status, e.visibility, e.deleted_at, e.event_type
    INTO v_event FROM public.events e WHERE e.id = v_link.event_id FOR UPDATE;
  PERFORM 1 FROM public.brands b WHERE b.id = v_event.brand_id FOR UPDATE;
  SELECT tt.id, tt.deleted_at INTO v_tier FROM public.ticket_types tt
   WHERE tt.id = v_link.ticket_type_id FOR UPDATE;
  v_status := public.issue_3827_link_state(v_link, now());
  -- A full link may still be replaying a request whose people already have
  -- tickets. Let the locked issuer distinguish that harmless replay from a
  -- new person who would exceed the link's limit.
  IF v_status NOT IN ('active', 'full') THEN
    RAISE EXCEPTION '%', CASE v_status WHEN 'revoked' THEN 'link_revoked'
      WHEN 'expired' THEN 'link_expired' WHEN 'full' THEN 'link_full' ELSE v_status END;
  END IF;
  IF v_link.kind <> 'guest_list' THEN RAISE EXCEPTION 'not_a_guest_list_link'; END IF;
  IF jsonb_array_length(v_members) > v_link.party_max THEN
    RAISE EXCEPTION 'invalid_request' USING HINT = jsonb_build_object(
      'field', 'members', 'reason', 'too_many'
    )::text;
  END IF;

  v_choice := public.issue_3313_event_day_choice(v_link.event_id);
  IF v_link.event_date_id IS NOT NULL THEN
    v_date_id := v_link.event_date_id;
  ELSIF p_event_date_id IS NOT NULL THEN
    v_date_id := p_event_date_id;
  ELSIF (v_choice ->> 'soleOccurrenceId') IS NOT NULL THEN
    v_date_id := (v_choice ->> 'soleOccurrenceId')::uuid;
  ELSIF COALESCE((v_choice ->> 'requiresChoice')::boolean, false) THEN
    RAISE EXCEPTION 'event_date_choice_required';
  END IF;
  IF v_date_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.event_dates d
     WHERE d.id = v_date_id AND d.event_id = v_link.event_id AND d.end_at > now()
  ) THEN RAISE EXCEPTION 'occurrence_not_available'; END IF;

  -- Rate gates fail closed and count every person in the group.
  IF p_ip_hash IS NOT NULL AND (
    SELECT count(*) FROM public.ticket_link_signups s
     WHERE s.ip_hash = p_ip_hash AND s.created_at > now() - interval '1 hour'
  ) >= 20 THEN RAISE EXCEPTION 'rate_limited'; END IF;
  IF (
    SELECT COALESCE(sum(s.member_count), 0) FROM public.ticket_link_signups s
     WHERE s.link_id = v_link.id AND s.created_at > now() - interval '1 hour'
  ) + jsonb_array_length(v_members) > 300 THEN RAISE EXCEPTION 'rate_limited'; END IF;
  IF (
    SELECT count(*) FROM public.ticket_link_signup_members m
    JOIN public.ticket_link_signups s ON s.id = m.signup_id
    WHERE s.link_id = v_link.id AND m.status = 'pending'
  ) + jsonb_array_length(v_members) > 500 THEN RAISE EXCEPTION 'rate_limited'; END IF;

  FOR v_i IN 0 .. jsonb_array_length(v_members) - 1 LOOP
    v_item := v_members -> v_i;
    v_email := v_item ->> 'email';
    v_phone := v_item ->> 'phoneE164';
    SELECT count(*) INTO v_email_hits FROM public.ticket_link_signup_members m
    JOIN public.ticket_link_signups s ON s.id = m.signup_id
    WHERE s.link_id = v_link.id AND lower(m.email) = v_email
      AND m.created_at > now() - interval '1 hour';
    SELECT count(*) INTO v_phone_hits FROM public.ticket_link_signup_members m
    JOIN public.ticket_link_signups s ON s.id = m.signup_id
    WHERE s.link_id = v_link.id AND m.phone_e164 = v_phone
      AND m.created_at > now() - interval '1 hour';
    IF v_email_hits >= 3 OR v_phone_hits >= 3 OR (
      SELECT count(*) FROM public.ticket_link_signup_members m
       WHERE m.event_id = v_link.event_id AND m.phone_e164 = v_phone
         AND m.created_at > now() - interval '1 hour'
    ) >= 10 THEN RAISE EXCEPTION 'rate_limited'; END IF;
  END LOOP;

  -- Classify before insert. The lead already pending returns the same pending
  -- state without creating a second group.
  FOR v_i IN 0 .. jsonb_array_length(v_members) - 1 LOOP
    v_item := v_members -> v_i;
    v_existing_order := NULL;
    SELECT o.id INTO v_existing_order FROM public.orders o
     WHERE o.event_id = v_link.event_id AND o.source = 'comp'
       AND o.payment_status IN ('paid', 'partial_refund')
       AND lower(o.buyer_email) = v_item ->> 'email'
     ORDER BY o.created_at, o.id LIMIT 1;
    SELECT EXISTS(
      SELECT 1 FROM public.ticket_link_signup_members m
       WHERE m.event_id = v_link.event_id AND m.status = 'pending'
         AND lower(m.email) = v_item ->> 'email'
    ) INTO v_pending;
    IF v_i = 0 AND v_existing_order IS NULL AND v_pending THEN
      RETURN jsonb_build_object('status', 'pending', 'alreadyPending', true,
        'people', jsonb_build_array(jsonb_build_object(
          'position', 0, 'name', v_item ->> 'name', 'maskedEmail', NULL
        )), 'emailQueuedOrderIds', '[]'::jsonb);
    END IF;
    v_members := jsonb_set(v_members, ARRAY[v_i::text], v_item || jsonb_build_object(
      'status', CASE WHEN v_existing_order IS NOT NULL OR v_pending THEN 'duplicate' ELSE 'pending' END,
      'orderId', v_existing_order
    ));
  END LOOP;

  INSERT INTO public.ticket_link_signups(
    id, link_id, event_id, status, member_count, event_date_id,
    client_request_id, ip_hash
  ) VALUES (
    v_signup_id, v_link.id, v_link.event_id, 'pending', jsonb_array_length(v_members),
    v_date_id, p_client_request_id, p_ip_hash
  );
  FOR v_i IN 0 .. jsonb_array_length(v_members) - 1 LOOP
    v_item := v_members -> v_i;
    INSERT INTO public.ticket_link_signup_members(
      signup_id, event_id, position, name, email, phone_e164, status, order_id
    ) VALUES (
      v_signup_id, v_link.event_id, v_i, v_item ->> 'name', v_item ->> 'email',
      v_item ->> 'phoneE164', v_item ->> 'status', (v_item ->> 'orderId')::uuid
    );
  END LOOP;

  IF v_link.approval_mode = 'auto' THEN
    v_result := public.issue_3827_issue_link_signup(v_signup_id, NULL, p_qr_token_pepper);
  ELSE
    v_result := jsonb_build_object('status', 'pending', 'emailQueuedOrderIds', '[]'::jsonb);
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'position', m.position, 'name', m.name,
    'maskedEmail', left(split_part(m.email, '@', 1), LEAST(2, char_length(split_part(m.email, '@', 1))))
      || '***@' || split_part(m.email, '@', 2)
  ) ORDER BY m.position), '[]'::jsonb) INTO v_people
  FROM public.ticket_link_signup_members m WHERE m.signup_id = v_signup_id;
  RETURN v_result || jsonb_build_object(
    'status', CASE WHEN v_result ->> 'status' = 'duplicate' THEN 'issued' ELSE v_result ->> 'status' END,
    'people', v_people
  );
END;
$$;

REVOKE ALL ON FUNCTION public.issue_3827_issue_link_signup(uuid,uuid,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pg_ticket_link_signup(text,jsonb,uuid,uuid,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3827_issue_link_signup(uuid,uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.pg_ticket_link_signup(text,jsonb,uuid,uuid,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.pg_ticket_link_resolve(p_token_hash text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_link public.ticket_type_links;
  v_state text;
  v_result jsonb;
  v_remaining integer;
BEGIN
  IF p_token_hash !~ '^[0-9a-f]{64}$' THEN RETURN jsonb_build_object('state', 'not_found'); END IF;
  SELECT l.* INTO v_link FROM public.ticket_type_links l WHERE l.token_hash = p_token_hash;
  IF NOT FOUND THEN RETURN jsonb_build_object('state', 'not_found'); END IF;
  v_state := public.issue_3827_link_state(v_link, now());

  SELECT CASE
    WHEN COALESCE(tt.is_unlimited, false) OR tt.quantity_total IS NULL THEN NULL
    ELSE GREATEST(tt.quantity_total - COALESCE(tt.sold_count, 0) - COALESCE((
      SELECT sum(i.quantity)::integer FROM public.ticket_checkout_session_items i
      JOIN public.ticket_checkout_sessions s ON s.id = i.checkout_session_id
      WHERE i.ticket_type_id = tt.id AND s.expires_at > now()
        AND s.status IN ('pending_free', 'requires_payment', 'processing_payment', 'awaiting_web_redirect')
    ), 0), 0) END INTO v_remaining
  FROM public.ticket_types tt WHERE tt.id = v_link.ticket_type_id;

  SELECT jsonb_build_object(
    'state', CASE WHEN v_state = 'active' AND v_remaining = 0 THEN 'sold_out' ELSE v_state END,
    'kind', v_link.kind,
    'linkId', v_link.id,
    'eventId', e.id,
    'guestsMax', GREATEST(v_link.party_max - 1, 0),
    'approvalRequired', v_link.approval_mode = 'host',
    'eventDateId', v_link.event_date_id,
    'hideRemaining', COALESCE((e.theme #>> '{business_event,settings,hideRemainingCount}')::boolean, false),
    'event', jsonb_build_object(
      'title', e.title, 'brandName', b.name, 'brandSlug', b.slug,
      'eventSlug', e.slug, 'visibility', e.visibility,
      'coverUrl', e.cover_media_url, 'startAt', ed.start_at,
      'endAt', ed.end_at, 'timezone', COALESCE(ed.timezone, e.timezone),
      'venueLine', CASE WHEN public.issue_2489_address_withheld(e.theme)
        THEN NULLIF(e.theme #>> '{business_event,location,venueName}', '')
        ELSE COALESCE(NULLIF(e.theme #>> '{business_event,location,venueName}', ''), e.location_text) END,
      'currency', COALESCE(b.pricing_currency, tt.currency, e.currency, 'GBP'),
      'themeColor', COALESCE(e.theme_color_override, b.theme_color),
      'themeFont', COALESCE(e.theme_font_override, b.theme_font)
    ),
    'tier', CASE WHEN v_link.kind = 'guest_list'
      THEN jsonb_build_object('id', tt.id, 'name', tt.name)
      ELSE jsonb_build_object(
        'id', tt.id, 'name', tt.name, 'description', tt.description,
        'priceCents', tt.price_cents,
        'allInCents', CASE WHEN COALESCE(tt.is_free, false) OR COALESCE(tt.price_cents, 0) = 0 THEN 0
          ELSE public.compute_all_in_cents(
            tt.price_cents, COALESCE(e.pass_mingla_fee, b.default_pass_mingla_fee),
            COALESCE(e.pass_service_fee, b.default_pass_service_fee),
            (SELECT r.effective_take_rate_bps FROM public.resolve_effective_take_rate_bps(b.id) r)
          ) END,
        'currency', COALESCE(b.pricing_currency, tt.currency, e.currency, 'GBP'),
        'minPurchaseQty', COALESCE(tt.min_purchase_qty, 1),
        'maxPurchaseQty', tt.max_purchase_qty,
        'isUnlimited', COALESCE(tt.is_unlimited, false),
        'waitlistEnabled', COALESCE(tt.waitlist_enabled, false),
        'remaining', CASE WHEN COALESCE((e.theme #>> '{business_event,settings,hideRemainingCount}')::boolean, false)
          THEN NULL ELSE v_remaining END,
        'saleStartAt', tt.sale_start_at, 'saleEndAt', tt.sale_end_at
      ) END,
    'dates', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', d.id, 'startAt', d.start_at, 'endAt', d.end_at, 'timezone', d.timezone
      ) ORDER BY d.start_at)
      FROM public.event_dates d
      WHERE d.event_id = e.id AND d.end_at > now()
        AND v_link.event_date_id IS NULL
        AND COALESCE((public.issue_3313_event_day_choice(e.id) ->> 'requiresChoice')::boolean, false)
    ), '[]'::jsonb)
  ) INTO v_result
  FROM public.events e
  JOIN public.brands b ON b.id = e.brand_id
  JOIN public.ticket_types tt ON tt.id = v_link.ticket_type_id
  LEFT JOIN public.event_dates ed ON ed.event_id = e.id AND ed.is_master = true
  WHERE e.id = v_link.event_id;
  RETURN COALESCE(v_result, jsonb_build_object('state', 'not_found'));
END;
$$;

CREATE OR REPLACE FUNCTION public.biz_ticket_link_requests(
  p_actor_id uuid,
  p_event_id uuid,
  p_link_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_brand uuid; v_rows jsonb;
BEGIN
  SELECT e.brand_id INTO v_brand FROM public.events e WHERE e.id = p_event_id AND e.deleted_at IS NULL;
  IF NOT FOUND OR public.biz_brand_effective_rank(v_brand, p_actor_id)
      < public.biz_role_rank('event_manager') THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', s.id, 'linkId', l.id, 'linkLabel', l.label,
    'ticketTypeName', tt.name, 'createdAt', s.created_at,
    'eventDateId', s.event_date_id, 'memberCount', s.member_count,
    'members', (
      SELECT jsonb_agg(jsonb_build_object(
        'position', m.position, 'name', m.name, 'email', m.email,
        'phone', m.phone_e164,
        'alreadyOnList', EXISTS (
          SELECT 1 FROM public.orders o
           WHERE o.event_id = s.event_id AND o.source = 'comp'
             AND o.payment_status IN ('paid', 'partial_refund')
             AND lower(o.buyer_email) = lower(m.email)
        )
      ) ORDER BY m.position)
      FROM public.ticket_link_signup_members m WHERE m.signup_id = s.id
    )
  ) ORDER BY s.created_at), '[]'::jsonb) INTO v_rows
  FROM public.ticket_link_signups s
  JOIN public.ticket_type_links l ON l.id = s.link_id
  JOIN public.ticket_types tt ON tt.id = l.ticket_type_id
  WHERE s.event_id = p_event_id AND s.status = 'pending'
    AND (p_link_id IS NULL OR s.link_id = p_link_id)
  LIMIT 200;
  RETURN v_rows;
END;
$$;

CREATE OR REPLACE FUNCTION public.biz_ticket_link_decide(
  p_actor_id uuid,
  p_signup_id uuid,
  p_decision text,
  p_client_request_id uuid,
  p_qr_token_pepper text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_signup public.ticket_link_signups;
  v_link public.ticket_type_links;
  v_result jsonb;
BEGIN
  IF p_decision NOT IN ('approve', 'decline') OR p_client_request_id IS NULL THEN
    RAISE EXCEPTION 'invalid_request';
  END IF;
  SELECT s.* INTO v_signup FROM public.ticket_link_signups s WHERE s.id = p_signup_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'signup_not_found'; END IF;
  SELECT l.* INTO v_link FROM public.ticket_type_links l WHERE l.id = v_signup.link_id FOR UPDATE;
  IF public.biz_brand_effective_rank(v_link.brand_id, p_actor_id)
      < public.biz_role_rank('event_manager') THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF v_signup.status <> 'pending' THEN
    RETURN jsonb_build_object('status', v_signup.status, 'idempotentReplay', true,
      'leadOrderId', v_signup.lead_order_id, 'emailQueuedOrderIds', '[]'::jsonb,
      'issuedCount', 0, 'skippedNames', '[]'::jsonb);
  END IF;
  IF p_decision = 'decline' THEN
    UPDATE public.ticket_link_signups
       SET status = 'declined', decided_by = p_actor_id, decided_at = now()
     WHERE id = p_signup_id;
    UPDATE public.ticket_link_signup_members
       SET status = 'declined' WHERE signup_id = p_signup_id AND status = 'pending';
    RETURN jsonb_build_object('status', 'declined', 'emailQueuedOrderIds', '[]'::jsonb,
      'issuedCount', 0, 'skippedNames', '[]'::jsonb);
  END IF;
  v_result := public.issue_3827_issue_link_signup(p_signup_id, p_actor_id, p_qr_token_pepper);
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.pg_ticket_link_resolve(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.biz_ticket_link_requests(uuid,uuid,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.biz_ticket_link_decide(uuid,uuid,text,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pg_ticket_link_resolve(text) TO service_role;

-- pg_ticket_link_resolve withholds the venue through the #2489 address gate,
-- so it is a gate carrier (#3081: one row, in the migration that adds the object).
INSERT INTO public.issue_2489_gate_carriers (object_name, object_kind)
VALUES ('pg_ticket_link_resolve', 'function') ON CONFLICT (object_name) DO NOTHING;
GRANT EXECUTE ON FUNCTION public.biz_ticket_link_requests(uuid,uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.biz_ticket_link_decide(uuid,uuid,text,uuid,text) TO service_role;

-- ---------------------------------------------------------------------------
-- Paid private-ticket checkout
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.biz_ticket_link_checkout_create_session(
  p_token_hash text,
  p_event_id uuid,
  p_buyer_user_id uuid,
  p_buyer_name text,
  p_buyer_email text,
  p_buyer_phone_e164 text,
  p_marketing_opt_in boolean,
  p_lines jsonb,
  p_idempotency_key text,
  p_expires_at timestamptz,
  p_application_fee_amount_cents integer DEFAULT 0,
  p_payment_plan_choice text DEFAULT 'auto',
  p_event_date_ids uuid[] DEFAULT NULL,
  p_booked_start_at timestamptz DEFAULT NULL,
  p_booked_end_at timestamptz DEFAULT NULL,
  p_booked_party_size integer DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_link public.ticket_type_links;
  v_line jsonb;
  v_units integer := 0;
  v_state text;
  v_result jsonb;
  v_session_id uuid;
BEGIN
  SELECT l.* INTO v_link FROM public.ticket_type_links l WHERE l.token_hash = p_token_hash FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'link_not_found'; END IF;
  IF v_link.event_id <> p_event_id OR v_link.kind <> 'private_ticket' THEN
    RAISE EXCEPTION 'not_a_private_ticket_link';
  END IF;
  v_state := public.issue_3827_link_state(v_link, now());
  IF v_state <> 'active' THEN
    RAISE EXCEPTION '%', CASE v_state WHEN 'revoked' THEN 'link_revoked'
      WHEN 'expired' THEN 'link_expired' WHEN 'full' THEN 'link_full' ELSE v_state END;
  END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'invalid_request';
  END IF;
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    IF (v_line ->> 'ticketTypeId')::uuid <> v_link.ticket_type_id THEN
      RAISE EXCEPTION 'link_tier_mismatch';
    END IF;
    v_units := v_units + COALESCE((v_line ->> 'quantity')::integer, 0);
  END LOOP;
  IF v_units <= 0 THEN RAISE EXCEPTION 'invalid_request'; END IF;
  IF v_link.max_uses IS NOT NULL
     AND public.issue_3827_link_uses_taken(v_link.id) + v_units > v_link.max_uses THEN
    RAISE EXCEPTION 'link_full';
  END IF;

  PERFORM set_config('mingla.ticket_link_id', v_link.id::text, true);
  v_result := public.biz_ticket_checkout_create_session(
    p_event_id, p_buyer_user_id, p_buyer_name, p_buyer_email,
    p_buyer_phone_e164, p_marketing_opt_in, p_lines, p_idempotency_key,
    p_expires_at, p_application_fee_amount_cents, p_payment_plan_choice,
    p_event_date_ids, p_booked_start_at, p_booked_end_at, p_booked_party_size
  );
  v_session_id := (v_result ->> 'checkoutSessionId')::uuid;
  UPDATE public.ticket_checkout_sessions
     SET ticket_link_id = v_link.id, ticket_link_units = v_units
   WHERE id = v_session_id AND ticket_link_id IS NULL;
  PERFORM set_config('mingla.ticket_link_id', '', true);
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.biz_ticket_link_checkout_create_session(text,uuid,uuid,text,text,text,boolean,jsonb,text,timestamptz,integer,text,uuid[],timestamptz,timestamptz,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.biz_ticket_link_checkout_create_session(text,uuid,uuid,text,text,text,boolean,jsonb,text,timestamptz,integer,text,uuid[],timestamptz,timestamptz,integer) TO service_role;

-- Current governed functions have moved since the private design was written.
-- Each is re-emitted in full from its latest defining migration with exactly one
-- #3827 change; CREATE OR REPLACE keeps the existing owner and grants.

-- Checkout base: a hidden tier is admitted only through the transaction-local private-link guard.
-- Re-emitted verbatim from 20271123003281_issue_3281_r3_spacing_spots.sql (the live definition) with only the
-- #3827 change applied, so the DDL stays readable by the migration gates.
CREATE OR REPLACE FUNCTION public.issue_1930_ticket_checkout_create_session_base(p_event_id uuid, p_buyer_user_id uuid, p_buyer_name text, p_buyer_email text, p_buyer_phone_e164 text, p_marketing_opt_in boolean, p_lines jsonb, p_idempotency_key text, p_expires_at timestamp with time zone, p_application_fee_amount_cents integer DEFAULT 0, p_payment_plan_choice text DEFAULT 'auto'::text, p_event_date_ids uuid[] DEFAULT NULL::uuid[], p_booked_start_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_booked_end_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_booked_party_size integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_existing record;
  v_event record;
  v_session_id uuid;
  v_status text;
  v_currency character(3);
  v_total integer := 0;
  v_line jsonb;
  v_ticket_type record;
  v_qty integer;
  v_sold integer;
  v_reserved integer;
  v_items jsonb := '[]'::jsonb;
  v_stripe_account_id text;
  v_is_trip boolean := false;
  v_line_count int := 0;
  -- META-ORCH-1174 B1: per-line installment locals. v_first_ticket_type_id is
  -- retained for compatibility but the schedule is now computed PER LINE in a
  -- second loop, not off the first tier only.
  v_first_ticket_type_id uuid := NULL;
  v_tier_metadata jsonb;
  v_installments_input jsonb;
  v_deposit_pct numeric;
  v_inst_array jsonb;
  v_inst_count int;
  v_inst_item jsonb;
  v_inst_ord int;
  v_inst_pct numeric;
  v_inst_days int;
  v_inst_fixed text;
  v_pct_sum numeric := 0;
  v_line_total bigint;          -- THIS line's total (price_cents × qty)
  v_line_deposit_cents bigint;  -- THIS line's deposit
  v_line_running bigint;        -- THIS line's running installment total
  v_inst_amount bigint;
  v_inst_due timestamptz;
  v_now timestamptz := now();
  v_i int;
  -- Aggregate accumulators across all lines:
  v_due_today_cents bigint := 0;          -- Σ deposits + Σ non-plan full
  v_any_installments boolean := false;    -- did ANY line produce a schedule?
  v_unioned jsonb := '[]'::jsonb;         -- all lines' raw installment entries
  v_full_price_cents bigint := 0;         -- Σ of all line totals (the trip total)
  v_unit_price bigint;
  v_admits integer;
  v_basis text;
  v_blocks integer;
  -- issue #1014: a NULL-currency (free-only) event's tickets carry NULL
  -- currency; track whether the cart saw one so mixing raises ONLY on money.
  v_saw_null_currency boolean := false;
  -- issue #2160 DELTA 2 of 6 — the day set, the mode, and the multiplier.
  v_day_ids uuid[];
  v_day_count integer := 0;
  v_pricing_mode text := 'per_day';
  v_day_multiplier integer := 1;
  v_qty_raw integer;
  v_cart_qty_for_type integer;
  v_day_id uuid;
  -- issue #3313: whether a day must be chosen, and capacity per night.
  v_day_choice jsonb;
  v_per_occurrence boolean := false;
  v_night_taken integer;
  -- issue #3281 R3 — effective booked window (may bind fixed-slot opening).
  v_booked_start timestamptz := p_booked_start_at;
  v_booked_end timestamptz := p_booked_end_at;
  v_open_daily boolean := false;
BEGIN
  IF COALESCE(p_payment_plan_choice, '') NOT IN ('auto', 'full', 'installments') THEN
    RAISE EXCEPTION 'payment_plan_choice_invalid';
  END IF;

  IF p_buyer_phone_e164 IS NULL OR p_buyer_phone_e164 !~ '^\+[1-9][0-9]{1,14}$' THEN
    RAISE EXCEPTION 'buyer_phone_required';
  END IF;

  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'ticket_lines_required';
  END IF;

  SELECT *
    INTO v_existing
    FROM public.ticket_checkout_sessions
   WHERE idempotency_key = p_idempotency_key;

  IF FOUND THEN
    IF v_existing.status IN ('paid_completed','free_completed','failed','expired')
       OR v_existing.expires_at < now() THEN
      UPDATE public.ticket_checkout_sessions
         SET idempotency_key = idempotency_key || ':tombstone:' || id::text,
             status = CASE
               WHEN status IN ('paid_completed','free_completed','failed','expired') THEN status
               ELSE 'expired'
             END,
             failed_at = CASE
               WHEN status IN ('paid_completed','free_completed','failed','expired') THEN failed_at
               WHEN status IN ('pending_free','requires_payment','processing_payment','awaiting_web_redirect')
                 AND expires_at < now() THEN now()
               ELSE failed_at
             END,
             updated_at = now()
       WHERE id = v_existing.id;
    ELSE
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'ticketTypeId', i.ticket_type_id,
        'ticketName', i.ticket_name_at_purchase,
        'quantity', i.quantity,
        'unitPriceCents', i.unit_price_cents,
        'totalCents', i.total_cents
      ) ORDER BY i.created_at), '[]'::jsonb)
        INTO v_items
        FROM public.ticket_checkout_session_items i
       WHERE i.checkout_session_id = v_existing.id;

      RETURN jsonb_build_object(
        'checkoutSessionId', v_existing.id,
        'eventId', v_existing.event_id,
        'brandId', v_existing.brand_id,
        'status', v_existing.status,
        'totalCents', v_existing.total_cents,
        'subtotalCents', v_existing.total_cents,
        'currency', trim(v_existing.currency),
        'stripeAccountId', v_existing.stripe_account_id,
        'orderId', v_existing.order_id,
        'items', v_items,
        'lineItems', v_items,
        'installmentSchedule', v_existing.installment_schedule
      );
    END IF;
  END IF;

  SELECT e.id, e.brand_id, e.visibility, e.status, e.deleted_at, e.event_type,
         e.capacity_scope, e.booking_spacing_minutes, e.is_recurring, e.recurrence_rules,
         s.stripe_account_id, s.charges_enabled,
         b.payment_provider
    INTO v_event
    FROM public.events e
    JOIN public.brands b ON b.id = e.brand_id
    LEFT JOIN public.stripe_connect_accounts s
      ON s.brand_id = e.brand_id
     AND s.detached_at IS NULL
   WHERE e.id = p_event_id
   FOR SHARE OF e;

  IF NOT FOUND OR v_event.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'event_not_found';
  END IF;
  IF v_event.visibility NOT IN ('public', 'hidden') OR NOT (v_event.status = ANY (ARRAY['scheduled'::text, 'live'::text])) THEN
    RAISE EXCEPTION 'event_not_selling';
  END IF;

  -- ══ issue #2562 — AN EVENT THAT HAS ALREADY HAPPENED CANNOT BE SOLD ═══
  --
  -- Before this, NOTHING on the reservation path asked whether the event was
  -- over. `event_not_selling` above checks `events.status`, and a finished
  -- event is still `scheduled` — status describes the LISTING, not the clock.
  -- The only thing standing between a guest and paying for a past event was an
  -- OPTIONAL per-tier `sale_end_at`, and six live tiers do not have one.
  --
  -- Proven against production before this guard existed: a checkout session for
  -- FIFA Grill Night — last occurrence ended 2026-07-26 — came back
  -- `status=requires_payment total=2000 currency=USD`, a month after the event.
  -- The buyer web blocked it; the Explorer app offered "Buy ticket"; the server
  -- accepted. A guarantee cannot rest on an optional field being filled in.
  --
  -- SCOPE, and both halves are deliberate:
  --   * Only fires when the event HAS occurrences. No rows means we do not know
  --     when it is, and refusing on unknown would be a different bug — one live
  --     event legitimately carries none.
  --   * `end_at > now()` allows an event that is CURRENTLY RUNNING, so walk-up
  --     sales during the event still work. It refuses only once every occurrence
  --     has finished.
  --
  -- This is the EVENT-level backstop. #2160's `occurrence_not_available` already
  -- refuses an individual chosen day that has passed; that guard only runs when
  -- the guest sent a day set, which is exactly why this one is needed too.
  --
  -- DELETE THIS BLOCK and a past event becomes payable again.
  IF EXISTS (SELECT 1 FROM public.event_dates d WHERE d.event_id = p_event_id)
     AND NOT EXISTS (
       SELECT 1 FROM public.event_dates d
        WHERE d.event_id = p_event_id AND d.end_at > now()
     ) THEN
    RAISE EXCEPTION 'event_already_ended';
  END IF;

  v_is_trip := v_event.event_type = 'trip';
  v_session_id := gen_random_uuid();

  -- ══ issue #2160 DELTA 3 of 6 — VALIDATE THE DAY SET, READ THE MODE ════
  -- Distinct, ordered by start_at, and every id must be an occurrence OF
  -- THIS EVENT that has not already ended. A day the guest cannot attend is
  -- never allowed to become an entitlement.
  --
  -- DELETE THIS BLOCK and a guest can mint a pass for another event's
  -- occurrence, or for a day that is already over.
  IF p_event_date_ids IS NOT NULL AND array_length(p_event_date_ids, 1) > 0 THEN
    SELECT ARRAY(
             SELECT d.id FROM public.event_dates d
              WHERE d.event_id = p_event_id
                AND d.id = ANY (p_event_date_ids)
              ORDER BY d.start_at, d.id
           )
      INTO v_day_ids;
    IF COALESCE(array_length(v_day_ids, 1), 0)
       <> (SELECT count(DISTINCT x) FROM unnest(p_event_date_ids) AS x) THEN
      RAISE EXCEPTION 'occurrence_not_found';
    END IF;
    IF EXISTS (SELECT 1 FROM public.event_dates d
                WHERE d.id = ANY (v_day_ids) AND d.end_at <= now()) THEN
      RAISE EXCEPTION 'occurrence_not_available';
    END IF;
    v_day_count := COALESCE(array_length(v_day_ids, 1), 0);
  END IF;

  -- ══ issue #3313 — NO ORDER WITHOUT A NIGHT ═════════════════════════════
  -- A checkout on an event with more than one bookable date used to finish
  -- with NO day set: orders.event_date_id NULL, no ticket_event_dates, and a
  -- pass that admits on ANY night (I-PROPOSED-2160-A). One predicate decides,
  -- the same one the public reader turns into `isMultiDate`, so the chooser a
  -- guest sees and the refusal here cannot disagree:
  --   * a recurring event with exactly one upcoming date binds to it;
  --   * an event that requires a choice and received none is refused.
  -- Trips, experiences and single-date events: requiresChoice is false and
  -- there is no sole date, so this block is a no-op for them.
  -- DELETE THIS BLOCK and a no-night order is issued again.
  v_day_choice := public.issue_3313_event_day_choice(p_event_id);
  v_per_occurrence := COALESCE((v_day_choice ->> 'perOccurrenceCapacity')::boolean, false);
  IF v_day_count = 0 AND (v_day_choice ->> 'soleOccurrenceId') IS NOT NULL THEN
    v_day_ids := ARRAY[(v_day_choice ->> 'soleOccurrenceId')::uuid];
    v_day_count := 1;
  END IF;
  IF v_day_count = 0 AND COALESCE((v_day_choice ->> 'requiresChoice')::boolean, false) THEN
    RAISE EXCEPTION 'event_date_choice_required';
  END IF;
  -- issue #3281 R3 — scoped experiences always need a named occurrence.
  IF v_event.event_type = 'experience'
     AND COALESCE(v_event.capacity_scope, 'total') IN ('per_day', 'per_start')
     AND v_day_count = 0 THEN
    RAISE EXCEPTION 'event_date_choice_required';
  END IF;

  -- The organiser's choice. Read ONCE, here, so the whole function agrees.
  SELECT COALESCE(e.multi_date_pricing_mode, 'per_day')
    INTO v_pricing_mode
    FROM public.events e WHERE e.id = p_event_id;

  -- THE ONE MULTIPLIER, APPLIED IN ONE PLACE.
  --   per_day , D days -> D  (D admissions, D passes, D units of capacity)
  --   all_days, D days -> 1  (one pass sold once)
  --   no days chosen    -> 1  (byte-identical to pre-#2160)
  -- Because it multiplies the stored line QUANTITY, pricing, capacity and
  -- the mint loop all see the same number with no special-casing anywhere
  -- downstream (amendment §1 and §8).
  IF v_day_count > 0 AND v_pricing_mode = 'per_day' THEN
    v_day_multiplier := v_day_count;
  END IF;

  -- issue #3281 Round 1 — optional booked start (open-daily experiences).
  -- Required when experience_require_booked_start is on AND the experience is
  -- open-daily (date optional for the required check so no-start identity can
  -- keep an empty day set). Window validation still needs exactly one day when
  -- a start is supplied. Multi-date + start is refused so finalize/scan cannot
  -- apply the first day's instant to every pass.
  IF v_booked_start IS NOT NULL AND v_day_count <> 1 THEN
    RAISE EXCEPTION 'booked_start_invalid';
  END IF;
  v_open_daily := (
    COALESCE(v_event.is_recurring, false)
    AND jsonb_typeof(v_event.recurrence_rules) = 'object'
    AND v_event.recurrence_rules->>'preset' = 'daily'
    AND v_event.recurrence_rules->'termination'->>'kind' = 'never'
  );
  -- Fixed-slot per_start: bind the occurrence opening when the client omitted
  -- bookedStartAt (both pickers send only eventDateId in that mode).
  IF v_booked_start IS NULL
     AND v_event.event_type = 'experience'
     AND COALESCE(v_event.capacity_scope, 'total') = 'per_start'
     AND v_day_count = 1
     AND NOT v_open_daily THEN
    SELECT ed.start_at,
           ed.start_at + make_interval(
             mins => GREATEST(1, COALESCE(v_event.booking_spacing_minutes, 30))
           )
      INTO v_booked_start, v_booked_end
      FROM public.event_dates ed
     WHERE ed.id = v_day_ids[1];
  END IF;
  PERFORM public.issue_3281_validate_booked_start(
    p_event_id,
    CASE WHEN v_day_count = 1 THEN v_day_ids[1] ELSE NULL END,
    v_booked_start,
    v_booked_end
  );

  -- ══ issue #2462 — CANONICAL LOCK ORDER, TAKEN BEFORE PASS 1 ═══════════
  -- Pass 1 below takes `SELECT … FROM ticket_types … FOR UPDATE` once per
  -- line, in the order the CLIENT sent them, because
  -- `jsonb_array_elements(p_lines)` has no ORDER BY. The cart appends lines in
  -- the order the buyer TAPPED them (CartContext.tsx:290-292), so two guests
  -- who add the same two ticket types in opposite orders take the same two row
  -- locks in opposite orders and DEADLOCK. Postgres kills one; the RPC raises;
  -- the guest is told "Nothing was reserved — please try again". It can only
  -- happen under concurrency, on a multi-ticket-type cart, which is why it
  -- never reproduces in testing.
  --
  -- Proven on production: lines sent as [Day 2, Day 1] were processed
  -- [Day 2, Day 1] — lock order follows the client array verbatim.
  --
  -- Taking every lock ONCE here, ordered by primary key, makes the order
  -- total and identical for every caller. Pass 1's per-line FOR UPDATE then
  -- re-acquires a lock this transaction already holds, which is a no-op, so
  -- NOTHING below changes — including the order line items are inserted in,
  -- which the response's `items` array and its tests depend on.
  --
  -- DELETE THIS BLOCK and the deadlock returns under load.
  PERFORM 1
     FROM public.ticket_types tt
    WHERE tt.id IN (
            SELECT DISTINCT (l ->> 'ticketTypeId')::uuid
              FROM jsonb_array_elements(p_lines) AS l
             WHERE (l ->> 'ticketTypeId') IS NOT NULL
          )
      AND tt.event_id = p_event_id
      AND tt.deleted_at IS NULL
    ORDER BY tt.id
      FOR UPDATE;

  -- ---------------- Pass 1: validate lines + build line items (UNCHANGED). ----------------
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_line_count := v_line_count + 1;
    v_qty_raw := COALESCE((v_line ->> 'quantity')::integer, 0);
    v_qty := v_qty_raw;
    IF v_qty <= 0 THEN
      RAISE EXCEPTION 'ticket_quantity_invalid';
    END IF;

    SELECT *
      INTO v_ticket_type
      FROM public.ticket_types
     WHERE id = (v_line ->> 'ticketTypeId')::uuid
       AND event_id = p_event_id
       AND deleted_at IS NULL
     FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'ticket_type_not_found';
    END IF;
    IF (v_ticket_type.is_hidden AND NOT public.issue_3827_link_unlocks_tier(v_ticket_type.id))
       OR v_ticket_type.is_disabled OR NOT v_ticket_type.available_online THEN
      RAISE EXCEPTION 'ticket_type_unavailable';
    END IF;
    -- #2879 / #2947 slice 7 — pre-sale queue: an armed tier may mint an
    -- infinity hold before sale_start_at so rule 6's join can form. Ordinary
    -- (finite-expiry) creates still refuse until the sale opens.
    IF v_ticket_type.sale_start_at IS NOT NULL AND v_ticket_type.sale_start_at > now() THEN
      IF NOT (
        p_expires_at = 'infinity'::timestamptz
        AND EXISTS (
          SELECT 1 FROM public.ticket_queue_arming a
           WHERE a.ticket_type_id = v_ticket_type.id
             AND a.disarmed_at IS NULL
        )
      ) THEN
        RAISE EXCEPTION 'ticket_sales_not_started';
      END IF;
    END IF;
    IF v_ticket_type.sale_end_at IS NOT NULL AND v_ticket_type.sale_end_at <= now() THEN
      RAISE EXCEPTION 'ticket_sales_ended';
    END IF;
    IF v_qty < v_ticket_type.min_purchase_qty THEN
      RAISE EXCEPTION 'ticket_quantity_below_min';
    END IF;
    IF v_ticket_type.max_purchase_qty IS NOT NULL AND v_qty > v_ticket_type.max_purchase_qty THEN
      RAISE EXCEPTION 'ticket_quantity_above_max';
    END IF;

    -- ══ issue #2160 DELTA 4 of 6 — THE PER-DAY MULTIPLIER ═══════════════
    -- Applied AFTER min_purchase_qty / max_purchase_qty, which stay per LINE
    -- and therefore mean "per day" — an organiser capping a guest at 4
    -- tickets means 4 per day, not 4 across a three-day festival. Applied
    -- BEFORE capacity and pricing, which must both see the real number of
    -- admissions. v_day_multiplier is 1 on every pre-#2160 path.
    v_qty := v_qty_raw * v_day_multiplier;

    -- META-ORCH-1174 B1 — PER-PACKAGE capacity (DEC-1174-D): each ticket_type's
    -- own quantity_total is its own cap. This was already correct (per-line),
    -- and is the only capacity model multi-package needs.
    IF NOT v_ticket_type.is_unlimited THEN
      -- issue #2491 C2 step 3 — THE COUNTER, not the count.
      -- Was: COUNT(*) over public.tickets, measured at 18.71 ms per call once a
      -- ticket type holds 100k rows, executed INSIDE the serialized critical
      -- section so every other buyer waits behind it. Now a column read.
      -- sold_count is maintained by issue_2491_tickets_counters, which fires on
      -- INSERT, DELETE and UPDATE OF (status, ticket_type_id) — precisely the
      -- columns this formula reads — and RECOMPUTES from
      -- issue_2491_derived_sold rather than incrementing. Its only failure mode
      -- is structural (the trigger removed), never gradual, and 288 consecutive
      -- shadow observations over 77.7 h reported zero drift across 699 sales.
      -- ══ issue #3313 — CAPACITY PER NIGHT ON A RECURRING EVENT (Seth) ═══
      -- quantity_total is the capacity of EACH night, not of the whole run.
      -- For every chosen night: places already taken that night (sold + held,
      -- issue_3313_ticket_type_occurrence_taken — the ONE per-night counter,
      -- also used by the public reader's `remaining`) plus this cart's raw
      -- quantity of the type must fit. per_day stores quantity x D and mints q
      -- passes per night; all_days mints q passes valid on every chosen night;
      -- both consume q places per night. Every other event keeps the shared
      -- check below, verbatim.
      -- DELETE THIS BRANCH and a recurring event's 60 places are shared by
      -- every night of the run.
      IF v_per_occurrence AND v_day_count > 0 THEN
        SELECT COALESCE(SUM((l ->> 'quantity')::integer), 0)::integer
          INTO v_cart_qty_for_type
          FROM jsonb_array_elements(p_lines) AS l
         WHERE (l ->> 'ticketTypeId')::uuid = v_ticket_type.id;
        IF v_ticket_type.quantity_total IS NOT NULL THEN
          FOREACH v_day_id IN ARRAY v_day_ids LOOP
            v_night_taken := public.issue_3313_ticket_type_occurrence_taken(
              v_ticket_type.id, v_day_id
            );
            IF v_night_taken + v_cart_qty_for_type > v_ticket_type.quantity_total THEN
              RAISE EXCEPTION 'ticket_capacity_exceeded';
            END IF;
          END LOOP;
        END IF;
      ELSIF v_event.event_type = 'experience'
            AND COALESCE(v_event.capacity_scope, 'total') IN ('per_day', 'per_start') THEN
        -- Scoped counters are enforced in the R3 block below; skip lifetime.
        NULL;
      ELSE
      -- (the shared check, verbatim from 20270609002879)
      SELECT tt2.sold_count
        INTO v_sold
        FROM public.ticket_types tt2
       WHERE tt2.id = v_ticket_type.id;

      SELECT COALESCE(SUM(i.quantity), 0)::integer
        INTO v_reserved
        FROM public.ticket_checkout_session_items i
        JOIN public.ticket_checkout_sessions s ON s.id = i.checkout_session_id
       WHERE i.ticket_type_id = v_ticket_type.id
         AND s.expires_at > now()
         AND s.status IN ('pending_free', 'requires_payment', 'processing_payment', 'awaiting_web_redirect');

      -- ══ issue #2160 DELTA 5 of 6 — CAPACITY AGGREGATES PER TICKET TYPE ═
      -- THIS ONE PROTECTS MONEY. The pre-#2160 check compared
      -- `v_sold + v_reserved + v_qty` where v_qty is THIS LINE alone, and
      -- the current session's own items are inserted AFTER this loop — so a
      -- second line of the SAME ticket_type in the same cart was invisible
      -- to the first line's check and both passed independently.
      --
      -- Honest scoping: under the amendment's session-level day set, lines
      -- are never expanded, so multi-day does NOT create this shape. The
      -- hole is real but LATENT, exactly as it is today — this is hardening,
      -- not the load-bearing fix the pre-amendment spec described. It is
      -- kept because it is two lines inside a function being re-emitted
      -- anyway and any future feature that sends two lines of one type
      -- (bundles, add-ons) walks straight into it.
      --
      -- DELETE THE AGGREGATION and a cart with two lines of a
      -- quantity_total=1 ticket type mints 2 tickets against a cap of 1.
      SELECT COALESCE(SUM((l ->> 'quantity')::integer), 0)::integer * v_day_multiplier
        INTO v_cart_qty_for_type
        FROM jsonb_array_elements(p_lines) AS l
       WHERE (l ->> 'ticketTypeId')::uuid = v_ticket_type.id;

      IF v_ticket_type.quantity_total IS NOT NULL
         AND v_sold + v_reserved + v_cart_qty_for_type > v_ticket_type.quantity_total THEN
        RAISE EXCEPTION 'ticket_capacity_exceeded';
      END IF;
      END IF;
    END IF;

    -- issue #1014 delta (2): null-safe cart mixing. An all-NULL (all-free)
    -- cart never raises; two DIFFERENT non-null currencies always raise;
    -- null-vs-non-null mixing is checked AFTER the loop (raises only when
    -- the cart carries money — see the post-loop gate).
    IF v_ticket_type.currency IS NOT NULL THEN
      IF v_currency IS NULL THEN
        v_currency := v_ticket_type.currency;
      ELSIF v_currency IS DISTINCT FROM v_ticket_type.currency THEN
        RAISE EXCEPTION 'mixed_currency_cart';
      END IF;
    ELSE
      v_saw_null_currency := true;
    END IF;

    IF v_first_ticket_type_id IS NULL THEN
      v_first_ticket_type_id := v_ticket_type.id;
    END IF;

    -- #3281 R2 units: person = price×qty; group = price×groups (party does not
    -- multiply); block = (price×blocks)×qty with blocks from booked range.
    v_unit_price := v_ticket_type.price_cents;
    v_admits := 1;
    v_basis := COALESCE(v_ticket_type.price_basis, 'person');
    IF v_event.event_type = 'experience' AND v_basis = 'group' THEN
      IF p_booked_party_size IS NULL OR p_booked_party_size < 1
         OR v_ticket_type.group_max IS NULL
         OR p_booked_party_size > v_ticket_type.group_max THEN
        RAISE EXCEPTION 'booked_party_invalid';
      END IF;
      v_admits := v_ticket_type.group_max;
      -- unit stays option price; quantity is number of groups
    ELSIF v_event.event_type = 'experience' AND v_basis = 'block' THEN
      IF v_booked_start IS NULL OR v_booked_end IS NULL
         OR v_ticket_type.block_minutes IS NULL THEN
        RAISE EXCEPTION 'booked_length_invalid';
      END IF;
      IF v_booked_end <= v_booked_start THEN
        RAISE EXCEPTION 'booked_length_invalid';
      END IF;
      v_blocks := (EXTRACT(EPOCH FROM (v_booked_end - v_booked_start))
                   / (v_ticket_type.block_minutes::numeric * 60.0))::integer;
      IF v_blocks < COALESCE(v_ticket_type.min_blocks, 1)
         OR v_blocks > COALESCE(v_ticket_type.max_blocks, v_blocks) THEN
        RAISE EXCEPTION 'booked_length_invalid';
      END IF;
      v_unit_price := v_ticket_type.price_cents * v_blocks;
      v_admits := 1;
    END IF;

    -- issue #3281 R3 — capacity_scope counters (cart-aggregated like lifetime).
    IF v_event.event_type = 'experience'
       AND v_ticket_type.quantity_total IS NOT NULL THEN
      SELECT COALESCE(SUM((l ->> 'quantity')::integer), 0)::integer
        INTO v_cart_qty_for_type
        FROM jsonb_array_elements(p_lines) AS l
       WHERE (l ->> 'ticketTypeId')::uuid = v_ticket_type.id;
      IF COALESCE(v_event.capacity_scope, 'total') = 'per_start'
         AND v_booked_start IS NOT NULL THEN
        IF public.issue_3281_ticket_type_slot_taken(
             v_ticket_type.id,
             CASE WHEN v_day_count = 1 THEN v_day_ids[1] ELSE NULL END,
             v_booked_start,
             COALESCE(
               v_booked_end,
               v_booked_start + make_interval(
                 mins => GREATEST(1, COALESCE(v_event.booking_spacing_minutes, 30))
               )
             ),
             NULL
           ) + v_cart_qty_for_type > v_ticket_type.quantity_total THEN
          RAISE EXCEPTION 'slot_full';
        END IF;
      ELSIF COALESCE(v_event.capacity_scope, 'total') = 'per_day'
         AND v_day_count = 1 THEN
        IF public.issue_3313_ticket_type_occurrence_taken(
             v_ticket_type.id, v_day_ids[1]
           ) + v_cart_qty_for_type > v_ticket_type.quantity_total THEN
          RAISE EXCEPTION 'ticket_capacity_exceeded';
        END IF;
      ELSIF v_booked_start IS NOT NULL THEN
        IF public.issue_3281_ticket_type_slot_taken(
             v_ticket_type.id,
             CASE WHEN v_day_count = 1 THEN v_day_ids[1] ELSE NULL END,
             v_booked_start,
             COALESCE(
               v_booked_end,
               v_booked_start + make_interval(
                 mins => GREATEST(1, COALESCE(v_event.booking_spacing_minutes, 30))
               )
             ),
             NULL
           ) + v_cart_qty_for_type > v_ticket_type.quantity_total THEN
          RAISE EXCEPTION 'slot_full';
        END IF;
      END IF;
    END IF;

    v_total := v_total + (v_unit_price * v_qty);
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'ticketTypeId', v_ticket_type.id,
      'ticketName', v_ticket_type.name,
      'quantity', v_qty,
      'unitPriceCents', v_unit_price,
      'totalCents', v_unit_price * v_qty,
      'admitsCount', v_admits
    ));
  END LOOP;

  -- The full trip total (Σ all line totals) — used for the persisted schedule's
  -- fullPriceCents (informational; the buyer-facing receipt shows the trip total).
  v_full_price_cents := v_total;

  -- issue #1014 delta (2), post-loop leg: a cart mixing NULL-currency and
  -- currency-bearing tickets is legal ONLY when it carries no money (schema-
  -- impossible per-event today; defensive for cross-era rows).
  IF v_saw_null_currency AND v_currency IS NOT NULL AND v_total > 0 THEN
    RAISE EXCEPTION 'mixed_currency_cart';
  END IF;

  -- ---------------- Pass 2: per-line installment math (META-ORCH-1174 B1). ----------------
  -- For trips only, walk the BUILT line items (v_items carries the per-line
  -- totals). For each line, look up its package's tier_metadata.installments.
  -- A line with a plan (and not opted to pay-full) contributes its OWN deposit
  -- to "due today" + its OWN installment entries to the union; a line without a
  -- plan contributes its full total to "due today". The union is then re-
  -- numbered ordinal 1..M sorted by dueAt.
  --
  -- ORCH-0915 opt-out: p_payment_plan_choice='full' ⇒ NO line installments at
  -- all (every line pays full now). This is the session-wide pay-in-full path.
  IF v_is_trip AND p_payment_plan_choice <> 'full' THEN
    FOR v_line IN SELECT * FROM jsonb_array_elements(v_items)
    LOOP
      v_line_total := (v_line ->> 'totalCents')::bigint;
      v_tier_metadata := NULL;

      SELECT tpt.tier_metadata
        INTO v_tier_metadata
        FROM public.trip_pricing_tiers tpt
       WHERE tpt.event_id = p_event_id
         AND tpt.ticket_type_id = (v_line ->> 'ticketTypeId')::uuid;

      v_installments_input := CASE
        WHEN v_tier_metadata IS NOT NULL THEN v_tier_metadata -> 'installments'
        ELSE NULL
      END;

      IF v_installments_input IS NOT NULL
         AND jsonb_typeof(v_installments_input) = 'object' THEN
        -- This package carries a payment plan → compute its per-line schedule.
        v_deposit_pct := COALESCE((v_installments_input ->> 'deposit_pct')::numeric, 0);
        v_inst_array := v_installments_input -> 'installments';

        IF v_deposit_pct <= 0 OR v_deposit_pct > 100 THEN
          RAISE EXCEPTION 'installment_deposit_pct_out_of_range';
        END IF;
        IF v_inst_array IS NULL OR jsonb_typeof(v_inst_array) <> 'array' THEN
          RAISE EXCEPTION 'installment_schedule_malformed';
        END IF;

        v_inst_count := jsonb_array_length(v_inst_array);
        IF v_inst_count < 1 OR v_inst_count > 11 THEN
          RAISE EXCEPTION 'installment_count_out_of_range';
        END IF;

        -- First pass over THIS line's installments: validate + accumulate pct.
        v_pct_sum := v_deposit_pct;
        FOR v_i IN 0 .. v_inst_count - 1 LOOP
          v_inst_item := v_inst_array -> v_i;
          v_inst_ord := COALESCE((v_inst_item ->> 'ordinal')::int, -1);
          v_inst_pct := COALESCE((v_inst_item ->> 'pct')::numeric, 0);
          v_inst_days := NULLIF(v_inst_item ->> 'days_after_booking', '')::int;
          v_inst_fixed := NULLIF(v_inst_item ->> 'fixed_date', '');

          IF v_inst_ord <> v_i + 1 THEN
            RAISE EXCEPTION 'installment_ordinal_invalid';
          END IF;
          IF v_inst_pct <= 0 OR v_inst_pct >= 100 THEN
            RAISE EXCEPTION 'installment_pct_out_of_range';
          END IF;
          IF (v_inst_days IS NULL AND v_inst_fixed IS NULL)
             OR (v_inst_days IS NOT NULL AND v_inst_fixed IS NOT NULL) THEN
            RAISE EXCEPTION 'installment_due_mode_invalid';
          END IF;

          v_pct_sum := v_pct_sum + v_inst_pct;
        END LOOP;

        IF abs(v_pct_sum - 100) > 0.01 THEN
          RAISE EXCEPTION 'installment_pct_sum_mismatch';
        END IF;

        -- Second pass: amounts scaled by THIS LINE's total, last-absorbs-rounding.
        v_line_deposit_cents := floor(v_line_total::numeric * v_deposit_pct / 100)::bigint;
        v_line_running := 0;

        FOR v_i IN 0 .. v_inst_count - 1 LOOP
          v_inst_item := v_inst_array -> v_i;
          v_inst_ord := (v_inst_item ->> 'ordinal')::int;
          v_inst_pct := (v_inst_item ->> 'pct')::numeric;
          v_inst_days := NULLIF(v_inst_item ->> 'days_after_booking', '')::int;
          v_inst_fixed := NULLIF(v_inst_item ->> 'fixed_date', '');

          IF v_inst_days IS NOT NULL THEN
            IF v_inst_days < 1 THEN
              RAISE EXCEPTION 'installment_days_after_booking_invalid';
            END IF;
            v_inst_due := v_now + (v_inst_days || ' days')::interval;
          ELSE
            v_inst_due := (v_inst_fixed)::timestamptz;
          END IF;

          IF v_i = 0 AND v_inst_due <= v_now THEN
            RAISE EXCEPTION 'installment_schedule_past_due_at_booking';
          END IF;

          IF v_i < v_inst_count - 1 THEN
            v_inst_amount := floor(v_line_total::numeric * v_inst_pct / 100)::bigint;
            v_line_running := v_line_running + v_inst_amount;
          ELSE
            v_inst_amount := v_line_total - v_line_deposit_cents - v_line_running;
            IF v_inst_amount <= 0 THEN
              RAISE EXCEPTION 'installment_rounding_invalid';
            END IF;
          END IF;

          -- Append to the UNION with a sortable dueAt (ordinal re-numbered below).
          v_unioned := v_unioned || jsonb_build_array(jsonb_build_object(
            'pct', v_inst_pct,
            'amountCents', v_inst_amount,
            'dueAt', to_char(v_inst_due AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
            'sourceTicketTypeId', (v_line ->> 'ticketTypeId'),
            'sourceOrdinal', v_inst_ord
          ));
        END LOOP;

        v_due_today_cents := v_due_today_cents + v_line_deposit_cents;
        v_any_installments := true;
      ELSE
        -- No plan on this package → its full total is due today.
        v_due_today_cents := v_due_today_cents + v_line_total;
      END IF;
    END LOOP;
  END IF;

  -- ---------------- Finalize the schedule + the deposit override. ----------------
  -- When at least one line produced installments, override v_total to the summed
  -- "due today" (Σ deposits + Σ non-plan fulls) and build the unioned schedule
  -- with sequential ordinals 1..M sorted by dueAt (then stable source order). The
  -- persisted shape is byte-identical to the single-line ORCH-0869 schedule.
  IF v_any_installments THEN
    v_total := v_due_today_cents::integer;

    SELECT COALESCE(jsonb_agg(
             jsonb_build_object(
               'ordinal', rn,
               'pct', (elem ->> 'pct')::numeric,
               'amountCents', (elem ->> 'amountCents')::bigint,
               'dueAt', elem ->> 'dueAt'
             )
             ORDER BY rn
           ), '[]'::jsonb)
      INTO v_unioned
      FROM (
        SELECT elem,
               row_number() OVER (
                 ORDER BY (elem ->> 'dueAt') ASC, (elem ->> 'sourceOrdinal')::int ASC
               ) AS rn
        FROM jsonb_array_elements(v_unioned) AS elem
      ) ranked;
  END IF;

  v_status := CASE WHEN v_total = 0 THEN 'pending_free' ELSE 'requires_payment' END;
  IF v_total > 0 AND v_event.payment_provider = 'stripe'
     AND (v_event.stripe_account_id IS NULL OR v_event.charges_enabled IS DISTINCT FROM true) THEN
    RAISE EXCEPTION 'stripe_account_not_ready';
  END IF;
  v_stripe_account_id := CASE
    WHEN v_total > 0 AND v_event.payment_provider = 'stripe' THEN v_event.stripe_account_id
    ELSE NULL
  END;

  -- issue #1014 delta (3): belt-and-braces — money never enters a session
  -- without a currency (unreachable given the (a) CHECKs: paid tickets always
  -- carry currency — but the RPC stays self-defending).
  IF v_total > 0 AND v_currency IS NULL THEN
    RAISE EXCEPTION 'event_currency_required';
  END IF;

  INSERT INTO public.ticket_checkout_sessions (
    id, event_id, brand_id, buyer_user_id, buyer_name, buyer_email, buyer_phone_e164,
    marketing_opt_in, subtotal_cents, application_fee_amount_cents, total_cents,
    currency, status, idempotency_key, cart_fingerprint, expires_at,
    stripe_account_id, stripe_application_fee_amount_cents,
    installment_schedule,
    -- issue #2160 — the mode this reservation was PRICED under. Finalize mints
    -- under this value, never a fresh read (§A.7).
    multi_date_pricing_mode_snapshot,
    -- issue #3281 — guest-chosen start (open-daily); NULL = legacy / slots / flag-off.
    booked_start_at,
    booked_end_at,
    booked_party_size
  ) VALUES (
    v_session_id, p_event_id, v_event.brand_id, p_buyer_user_id, trim(p_buyer_name),
    lower(trim(p_buyer_email)), p_buyer_phone_e164, COALESCE(p_marketing_opt_in, false),
    v_total, COALESCE(p_application_fee_amount_cents, 0), v_total,
    v_currency, v_status, p_idempotency_key,
    md5(v_items::text), p_expires_at, v_stripe_account_id, COALESCE(p_application_fee_amount_cents, 0),
    CASE
      WHEN v_any_installments THEN
        jsonb_build_object(
          'fullPriceCents', v_full_price_cents,
          'depositCents', v_due_today_cents,
          'currency', trim(v_currency),
          'installments', v_unioned
        )
      ELSE NULL
    END,
    v_pricing_mode,
    v_booked_start,
    v_booked_end,
    p_booked_party_size
  );

  FOR v_line IN SELECT * FROM jsonb_array_elements(v_items)
  LOOP
    INSERT INTO public.ticket_checkout_session_items (
      checkout_session_id, ticket_type_id, ticket_name_at_purchase, quantity,
      unit_price_cents, total_cents
    ) VALUES (
      v_session_id,
      (v_line ->> 'ticketTypeId')::uuid,
      v_line ->> 'ticketName',
      (v_line ->> 'quantity')::integer,
      (v_line ->> 'unitPriceCents')::integer,
      (v_line ->> 'totalCents')::integer
    );
  END LOOP;

  -- ══ issue #2160 DELTA 6 of 6 — PERSIST THE CHOSEN DAY SET ═════════════
  -- The finalize base reads these rows to distribute ticket_event_dates
  -- entitlements. DELETE THIS LOOP and every pass mints with zero days, so
  -- a guest who chose Saturday is silently admitted on every day of the
  -- event — and a guest who paid for two days gets one pass, not two.
  IF v_day_count > 0 THEN
    FOREACH v_day_id IN ARRAY v_day_ids LOOP
      INSERT INTO public.ticket_checkout_session_event_dates (
        checkout_session_id, event_date_id
      ) VALUES (v_session_id, v_day_id)
      ON CONFLICT DO NOTHING;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'checkoutSessionId', v_session_id,
    'eventId', p_event_id,
    'brandId', v_event.brand_id,
    'status', v_status,
    'totalCents', v_total,
    'subtotalCents', v_total,
    'currency', trim(v_currency),
    'stripeAccountId', v_stripe_account_id,
    'orderId', NULL,
    'items', v_items,
    'lineItems', v_items,
    'installmentSchedule', CASE
      WHEN v_any_installments THEN
        jsonb_build_object(
          'fullPriceCents', v_full_price_cents,
          'depositCents', v_due_today_cents,
          'currency', trim(v_currency),
          'installments', v_unioned
        )
      ELSE NULL
    END
  );
END;
$function$;

-- Direct checkout bundle: hidden tiers are not listed.
-- Re-emitted verbatim from 20271124003281_issue_3281_many_dates_foundation.sql (the live definition) with only the
-- #3827 change applied, so the DDL stays readable by the migration gates.
CREATE OR REPLACE FUNCTION public.pg_direct_event_checkout_bundle(p_event_id uuid DEFAULT NULL::uuid, p_brand_slug text DEFAULT NULL::text, p_event_slug text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  WITH ev AS (
    SELECT
      e.id,
      e.brand_id,
      e.title,
      e.description,
      e.slug              AS event_slug,
      e.event_type,
      e.location_text,
      e.online_url,
      e.is_online,
      e.status,
      e.published_at,
      e.timezone,
      e.currency,
      -- issue #2160 DELTA 1 of 3. See the note above the appended keys.
      e.is_multi_date,
      e.is_recurring,
      e.multi_date_pricing_mode,
      e.refund_policy,
      -- issue #3313 — the stored rule, and the one day-choice predicate.
      e.recurrence_rules,
      public.issue_3313_event_day_choice(e.id) AS day_choice,
      e.cover_media_url,
      e.cover_media_type,
      e.cover_media_provider,
      e.cover_media_source_url,
      e.cover_media_credit,
      e.cover_media_credit_url,
      e.cover_media_alt,
      e.cover_media_gallery,
      e.party_types,
      e.vibe_tags,
      e.music_genres,
      e.city,
      e.location_geo,
      e.city_geo,
      e.theme_color_override,
      e.theme_font_override,
      e.theme_animation_override,
      public.issue_2489_public_theme(e.theme) AS public_theme,
      ed.start_at AS master_start_at,
      ed.end_at   AS master_end_at,
      ed.timezone AS master_timezone,
      -- hide_address_until_ticket lives in theme.business_event (jsonb), not a
      -- real column. Default TRUE when absent — mirrors the service mapper
      -- (publicEventViewRowToEvent: asBoolean(..., true)) so a legacy row never
      -- leaks the street.
      public.issue_2489_address_withheld(e.theme) AS hide_address_until_ticket,
      -- issue #3314 — the organiser's "Hide remaining count", read from the raw
      -- row (theme.business_event.settings), never from the public_theme above:
      -- a later tightening of that sanitiser must not quietly turn this into
      -- "show". Resolved to a boolean on the output key below.
      e.theme #>> '{business_event,settings,hideRemainingCount}' AS hide_remaining_count_setting,
      b.id            AS brand_id_b,
      b.slug          AS brand_slug,
      b.name          AS brand_name,
      b.address       AS brand_address,
      b.cover_media_url AS brand_cover_media_url,
      b.profile_photo_url AS brand_profile_photo_url,
      b.theme_color   AS brand_theme_color,
      b.theme_font    AS brand_theme_font,
      b.theme_animation AS brand_theme_animation,
      COALESCE(e.pass_mingla_fee,  b.default_pass_mingla_fee)  AS pass_mingla_fee,
      COALESCE(e.pass_service_fee, b.default_pass_service_fee) AS pass_service_fee,
      b.pricing_currency AS pricing_currency
    FROM public.events e
    JOIN public.brands b ON b.id = e.brand_id
    LEFT JOIN public.event_dates ed
           ON ed.event_id = e.id AND ed.is_master = true
    WHERE (
      (p_event_id IS NOT NULL AND p_brand_slug IS NULL AND p_event_slug IS NULL AND e.id = p_event_id)
      OR
      (p_event_id IS NULL
       AND NULLIF(pg_catalog.btrim(p_brand_slug), '') IS NOT NULL
       AND NULLIF(pg_catalog.btrim(p_event_slug), '') IS NOT NULL
       AND b.slug = p_brand_slug
       AND e.slug = p_event_slug)
    )
      AND e.event_type = 'event'
      -- issue #2160 DELTA 2 of 3 — WITHDRAWN. The literal predicate STAYS.
      --
      -- This clause was briefly `pg_offering_visibility_gate(e.visibility,
      -- e.deleted_at, 'direct')`, to make the SPEC's demanded end state
      -- (T-14 / I-PROPOSED-2117-ONE-OFFERING-VISIBILITY-GATE) true — the SPEC
      -- asserted the gate was ALREADY here and it was not. The substitution was
      -- behaviour-identical and proved so. It is withdrawn anyway, because it
      -- is STRUCTURALLY UNAVAILABLE to any migration that lands after #2117:
      --
      --   The #2117 offering-visibility-gate workflow under `.github/workflows/`
      --   (filename ends `issue-2117-offering-visibility-gate-tests`; the
      --   extension is omitted ON PURPOSE — `validate-manifest-v2.mjs:796`
      --   discovers CI dependencies by scanning EVERY non-workflow file for
      --   `/[A-Za-z0-9_.-]+\.ya?ml/`, comments included, so spelling it in full
      --   here registers this migration as a consumer of that workflow and
      --   drifts the reference inventory. It failed exactly that way in CI.
      --   This file is not a consumer of it; it only explains a decision.)
      --   applies THE WHOLE CHAIN EXCEPT #2117, captures the A-SC-9 baseline,
      --   then applies #2117. Calling the gate makes this file fail phase 1
      --   with "function public.pg_offering_visibility_gate(...) does not
      --   exist" — a `LANGUAGE sql` body is validated at CREATE time. Moving
      --   this file to phase 2 fixes that and then fails A-SC-9(a), because
      --   §H's `authenticated` grant is no longer in the BEFORE snapshot and
      --   is reported as having "arrived" with #2117.
      --
      -- Both constraints cannot hold at once, so the gate is not reusable by
      -- anything downstream of it until that lane's baseline capture is
      -- restructured. That is #2117's own decision to make, not this issue's,
      -- and it is recorded in the implementation report rather than worked
      -- around here: a payment-adjacent public reader is the wrong place to
      -- carry a CI-shaped compromise.
      --
      -- The literal below is what #1929/#1931 shipped and is byte-identical to
      -- what the gate would have returned for audience 'direct'.
      AND e.visibility IN ('public'::text, 'hidden'::text)
      AND e.deleted_at IS NULL
      AND b.deleted_at IS NULL
      AND e.status = ANY (ARRAY['scheduled'::text, 'live'::text, 'ended'::text, 'cancelled'::text])
      AND NOT public.issue_1931_event_ordinary_read_blocked(e.id)
    LIMIT 1
  ),
  tix AS (
    SELECT
      tt.id,
      tt.name,
      tt.description,
      tt.price_cents,
      tt.currency,
      tt.quantity_total,
      tt.is_unlimited,
      tt.is_free,
      tt.sale_start_at,
      tt.sale_end_at,
      tt.is_hidden,
      tt.is_disabled,
      tt.requires_approval,
      tt.password_protected,
      tt.available_online,
      tt.available_in_person,
      tt.waitlist_enabled,
      tt.display_order,
      -- issue #2462 — THE ORGANISER'S PURCHASE RULES. Absent from this reader
      -- since #1929, which is why `directBundleTicketToStub` fabricated
      -- `minPurchaseQty: 1, maxPurchaseQty: null, allowTransfers: true`: it had
      -- nothing to map. The server has always enforced them, so the cart let a
      -- guest pick a quantity the RPC then refused with
      -- `ticket_quantity_above_max` -> "Nothing was reserved - please try again",
      -- a permanent dead end. DELETE THESE THREE LINES and that returns.
      tt.min_purchase_qty,
      tt.max_purchase_qty,
      tt.allow_transfers,
      -- server all-in (WYSIWYP) — SAME compute_all_in_cents single owner as
      -- pg_public_event_tier_allin. Free / zero-price tier → 0.
      CASE
        WHEN COALESCE(tt.is_free, false) OR COALESCE(tt.price_cents, 0) = 0 THEN 0
        ELSE public.compute_all_in_cents(
               tt.price_cents,
               ev.pass_mingla_fee,
               ev.pass_service_fee,
               (SELECT r.effective_take_rate_bps
                  FROM public.resolve_effective_take_rate_bps(ev.brand_id) AS r)
             )
      END AS all_in_cents,
      -- remaining capacity (GREATEST(total - sold, 0)); NULL for unlimited.
      -- Sold formula matches pg_public_ticket_types_remaining (ORCH-0946) EXACTLY:
      -- COUNT of tickets rows with status IN ('valid','used','transferred').
      CASE
        WHEN COALESCE(tt.is_unlimited, false) THEN NULL
        WHEN tt.quantity_total IS NULL THEN NULL
        -- issue #3313 — per-night capacity: the most places any UPCOMING night
        -- still has, from the same per-night counter the checkout guard reads
        -- (ONE OWNER FOR CAPACITY). "Sold out" only when every night is full.
        WHEN COALESCE((ev.day_choice ->> 'perOccurrenceCapacity')::boolean, false)
             AND EXISTS (
               SELECT 1 FROM public.event_dates d
                WHERE d.event_id = ev.id AND d.end_at > now()
             )
          THEN (
            SELECT GREATEST(0, MAX(
                     tt.quantity_total
                     - public.issue_3313_ticket_type_occurrence_taken(tt.id, d.id)
                   ))
              FROM public.event_dates d
             WHERE d.event_id = ev.id AND d.end_at > now()
          )
        ELSE GREATEST(
          0,
          tt.quantity_total
            -- issue #2491 C2 step 4 — the same switch as the guard, on the READ
            -- path. This subquery ran once per ticket type PER PAGE VIEW, and at
            -- 100k sold that is ~18.7 ms of database time for every person merely
            -- LOOKING at the event. Page views arrive before reservations and
            -- outnumber them, so this is the larger volume problem of the two.
            -- Switched to the same column the guard now reads, so the advertised
            -- number and the enforced number remain ONE OWNER FOR CAPACITY (#2462).
            - COALESCE(tt.sold_count, 0)
            -- issue #2462 — IN-FLIGHT HOLDS COUNT. This subtrahend is byte-for-byte
            -- the `v_reserved` the capacity guard in
            -- issue_1930_ticket_checkout_create_session_base already applies. Without
            -- it the page advertises stock the server has committed: measured on
            -- production, 5 concurrent holds moved the guard by 5 and moved this
            -- number by 0 (229 -> 229). At low traffic v_reserved is ~0 so the two
            -- agree and the divergence is invisible; under load the guest reads
            -- "N available" and is refused as sold out. ONE OWNER FOR CAPACITY.
            - COALESCE((
                SELECT SUM(i.quantity)::integer
                FROM public.ticket_checkout_session_items i
                JOIN public.ticket_checkout_sessions s
                  ON s.id = i.checkout_session_id
                WHERE i.ticket_type_id = tt.id
                  AND s.expires_at > now()
                  AND s.status IN ('pending_free', 'requires_payment', 'processing_payment', 'awaiting_web_redirect')
              ), 0)
        )
      END AS remaining
    FROM public.ticket_types tt
    JOIN ev ON ev.id = tt.event_id
    WHERE tt.deleted_at IS NULL
      AND tt.available_online = true
      AND COALESCE(tt.is_hidden, false) = false
  )
  SELECT
    CASE WHEN ev.id IS NULL THEN NULL ELSE pg_catalog.json_build_object(
      'id', ev.id,
      'brandId', ev.brand_id,
      'brandSlug', ev.brand_slug,
      'eventSlug', ev.event_slug,
      'name', ev.title,
      'description', COALESCE(ev.description, ''),
      'masterStartAt', ev.master_start_at,
      'masterEndAt', ev.master_end_at,
      'timezone', COALESCE(ev.master_timezone, ev.timezone),
      'status', ev.status,
      'isOnline', ev.is_online,
      'onlineUrl', ev.online_url,
      'venueName', CASE
        WHEN ev.hide_address_until_ticket
          THEN NULLIF((ev.public_theme #>> '{business_event,location,venueName}'), '')
        ELSE COALESCE(NULLIF((ev.public_theme #>> '{business_event,location,venueName}'), ''), ev.location_text)
      END,
      -- PRIVACY: address + exact pin omitted (NULL) when the street is hidden.
      'address', CASE
        WHEN ev.hide_address_until_ticket THEN NULL
        ELSE COALESCE(NULLIF((ev.public_theme #>> '{business_event,location,address}'), ''), ev.location_text)
      END,
      'hideAddressUntilTicket', ev.hide_address_until_ticket,
      'format', (ev.public_theme #>> '{business_event,format}'),
      'city', ev.city,
      -- exact pin: NULL when hidden; else {lat,lng} from the point.
      'locationGeo', CASE
        WHEN ev.hide_address_until_ticket OR ev.location_geo IS NULL THEN NULL
        ELSE pg_catalog.json_build_object(
          'lat', public.ST_Y(ev.location_geo::public.geometry),
          'lng', public.ST_X(ev.location_geo::public.geometry)
        )
      END,
      -- city-level centroid: always returned when present (privacy-safe).
      'cityGeo', CASE
        WHEN ev.city_geo IS NULL THEN NULL
        ELSE pg_catalog.json_build_object(
          'lat', public.ST_Y(ev.city_geo),
          'lng', public.ST_X(ev.city_geo)
        )
      END,
      'coverMediaUrl', ev.cover_media_url,
      'coverMediaType', ev.cover_media_type,
      'coverGallery', COALESCE(ev.cover_media_gallery, '[]'::jsonb),
      'coverMediaProvider', ev.cover_media_provider,
      'coverMediaCredit', ev.cover_media_credit,
      'currency', COALESCE(ev.pricing_currency, ev.currency, 'usd'),
      'partyTypes', COALESCE(ev.party_types, ARRAY[]::text[]),
      'vibeTags', COALESCE(ev.vibe_tags, ARRAY[]::text[]),
      'musicGenres', COALESCE(ev.music_genres, ARRAY[]::text[]),
      'themeColorOverride', ev.theme_color_override,
      'themeFontOverride', ev.theme_font_override,
      'themeAnimationOverride', ev.theme_animation_override,
      'brand', pg_catalog.json_build_object(
        'id', ev.brand_id_b,
        'slug', ev.brand_slug,
        'name', ev.brand_name,
        'address', ev.brand_address,
        'coverMediaUrl', ev.brand_cover_media_url,
        'profilePhotoUrl', ev.brand_profile_photo_url,
        'themeColor', ev.brand_theme_color,
        'themeFont', ev.brand_theme_font,
        'themeAnimation', ev.brand_theme_animation
      ),
      'tickets', COALESCE((
        SELECT pg_catalog.json_agg(pg_catalog.json_build_object(
          'id', tix.id,
          'name', tix.name,
          'description', tix.description,
          'priceCents', tix.price_cents,
          'allInCents', tix.all_in_cents,
          'currency', tix.currency,
          'capacity', tix.quantity_total,
          'remaining', tix.remaining,
          'isUnlimited', tix.is_unlimited,
          'isFree', tix.is_free,
          'saleStartAt', tix.sale_start_at,
          'saleEndAt', tix.sale_end_at,
          'isHidden', tix.is_hidden,
          'isDisabled', tix.is_disabled,
          'requiresApproval', tix.requires_approval,
          'passwordProtected', tix.password_protected,
          'availableOnline', tix.available_online,
          'availableInPerson', tix.available_in_person,
          'waitlistEnabled', tix.waitlist_enabled,
          'displayOrder', tix.display_order,
          -- issue #2462 — APPENDED LAST so CREATE OR REPLACE preserves every
          -- pre-existing key name and order (house rule, …1931…:735-740).
          'minPurchaseQty', tix.min_purchase_qty,
          'maxPurchaseQty', tix.max_purchase_qty,
          'allowTransfers', tix.allow_transfers
        ) ORDER BY tix.display_order ASC)
        FROM tix
      ), '[]'::json),
      -- ══ issue #2160 DELTA 3 of 3 — APPENDED LAST ═══════════════════════
      -- Appended after every pre-existing key so CREATE OR REPLACE preserves
      -- each existing key's name AND order (the house rule at …1931…:735-740).
      --
      -- `occurrences` (SPEC §F / D-4, closes #2161). The occurrence list now
      -- travels on the SAME SECURITY DEFINER reader that served the event, so
      -- ONE authority decides who may see this event and its schedule. The
      -- direct `.from("event_dates")` read in publicEventOccurrencesService is
      -- deleted in the same change: a guest surface must never read that table
      -- again (I-PROPOSED-2160-D). Costs zero extra round trips.
      --
      -- NO `ticketsRemaining` KEY, DELIBERATELY. `event_dates` has no capacity
      -- column and capacity is authored event-level on ticket_types.quantity_
      -- total, so there is no honest per-day remaining. Stamping the
      -- event-level number onto each day would claim per-day availability that
      -- does not exist (Constitution #9).
      'occurrences', (
        SELECT COALESCE(pg_catalog.json_agg(pg_catalog.json_build_object(
                 'id',        d.id,
                 'startAt',   d.start_at,
                 'endAt',     d.end_at,
                 'timezone',  d.timezone,
                 'isMaster',  d.is_master,
                 -- issue #3281 many-dates — APPENDED LAST on each occurrence
                 'soldOut', CASE
                   WHEN NOT COALESCE(ev.is_recurring, false) THEN NULL
                   WHEN EXISTS (
                     SELECT 1 FROM public.ticket_types tt
                      WHERE tt.event_id = ev.id AND tt.deleted_at IS NULL
                       AND COALESCE(tt.available_online, false)
                       AND NOT COALESCE(tt.is_disabled, false)
                       AND NOT COALESCE(tt.is_hidden, false)
                        AND COALESCE(tt.is_unlimited, false)
                   ) THEN NULL
                   ELSE COALESCE((
                     SELECT bool_and(
                       tt.quantity_total IS NOT NULL
                       AND public.issue_3313_ticket_type_occurrence_taken(tt.id, d.id)
                             >= tt.quantity_total
                     )
                     FROM public.ticket_types tt
                     WHERE tt.event_id = ev.id AND tt.deleted_at IS NULL
                       AND COALESCE(tt.available_online, false)
                       AND NOT COALESCE(tt.is_disabled, false)
                       AND NOT COALESCE(tt.is_hidden, false)
                       AND NOT COALESCE(tt.is_unlimited, false)
                   ), false)
                 END,
                 'placesLeft', CASE
                   WHEN (CASE
                   WHEN ev.hide_remaining_count_setting IS NULL THEN false
                   WHEN pg_catalog.pg_input_is_valid(ev.hide_remaining_count_setting, 'boolean')
                     THEN ev.hide_remaining_count_setting::boolean
                   ELSE true
                 END) THEN NULL
                   WHEN NOT COALESCE(ev.is_recurring, false) THEN NULL
                   WHEN EXISTS (
                     SELECT 1 FROM public.ticket_types tt
                      WHERE tt.event_id = ev.id AND tt.deleted_at IS NULL
                       AND COALESCE(tt.available_online, false)
                       AND NOT COALESCE(tt.is_disabled, false)
                       AND NOT COALESCE(tt.is_hidden, false)
                        AND COALESCE(tt.is_unlimited, false)
                   ) THEN NULL
                   ELSE (
                     SELECT GREATEST(0, SUM(
                       GREATEST(0,
                         tt.quantity_total
                         - public.issue_3313_ticket_type_occurrence_taken(tt.id, d.id)
                       )
                     ))
                     FROM public.ticket_types tt
                     WHERE tt.event_id = ev.id AND tt.deleted_at IS NULL
                       AND COALESCE(tt.available_online, false)
                       AND NOT COALESCE(tt.is_disabled, false)
                       AND NOT COALESCE(tt.is_hidden, false)
                       AND NOT COALESCE(tt.is_unlimited, false)
                       AND tt.quantity_total IS NOT NULL
                   )
                 END,
                 'placesLeftByTicket', CASE
                   WHEN (CASE
                   WHEN ev.hide_remaining_count_setting IS NULL THEN false
                   WHEN pg_catalog.pg_input_is_valid(ev.hide_remaining_count_setting, 'boolean')
                     THEN ev.hide_remaining_count_setting::boolean
                   ELSE true
                 END) THEN NULL
                   WHEN NOT COALESCE(ev.is_recurring, false) THEN NULL
                   WHEN EXISTS (
                     SELECT 1 FROM public.ticket_types tt
                      WHERE tt.event_id = ev.id AND tt.deleted_at IS NULL
                       AND COALESCE(tt.available_online, false)
                       AND NOT COALESCE(tt.is_disabled, false)
                       AND NOT COALESCE(tt.is_hidden, false)
                        AND COALESCE(tt.is_unlimited, false)
                   ) THEN NULL
                   ELSE (
                     SELECT COALESCE(pg_catalog.json_object_agg(
                       tt.id::text,
                       GREATEST(0,
                         tt.quantity_total
                         - public.issue_3313_ticket_type_occurrence_taken(tt.id, d.id)
                       )
                     ), '{}'::json)
                     FROM public.ticket_types tt
                     WHERE tt.event_id = ev.id AND tt.deleted_at IS NULL
                       AND COALESCE(tt.available_online, false)
                       AND NOT COALESCE(tt.is_disabled, false)
                       AND NOT COALESCE(tt.is_hidden, false)
                       AND NOT COALESCE(tt.is_unlimited, false)
                       AND tt.quantity_total IS NOT NULL
                   )
                 END,
                 'overrideTitle', d.override_title,
                 'overrideLocation', d.override_location
               ) ORDER BY d.start_at, d.id), '[]'::json)
          FROM public.event_dates d
         WHERE d.event_id = ev.id
           -- issue #3313 — a recurring event offers only nights still ahead,
           -- which keeps `isMultiDate === (occurrences.length > 1)` true (the
           -- shipped native shape check). Multi-date events are unchanged
           -- (do NOT filter ended multi-date rows — F5 / many-dates picker).
           AND (NOT (COALESCE(ev.is_recurring, false) AND NOT COALESCE(ev.is_multi_date, false))
                OR d.end_at > now())
      ),
      -- THE MULTI-DATE SIGNAL. Without these two keys the day chooser is
      -- UNREACHABLE, and it was: `detailFromDirectBundle` hard-codes
      -- `is_multi_date: false`, this bundle is the FIRST reader consulted by
      -- both getPublicEventBySlug and getPublicEventById, and the bundle
      -- carried no multi-date key — so `asWhenMode` resolved every
      -- bundle-served ticketed event to 'single' and #2135's chooser never
      -- mounted, on PUBLIC events as well as unlisted ones. #2161 diagnosed
      -- this as "works for public, silently empty for unlisted"; measured on
      -- the full migration chain, it worked for neither. See the
      -- implementation report.
      --
      -- `isRecurring` rides along because the gate is `multi_date` ONLY —
      -- deriving multi-date from `occurrences.length > 1` would sweep in
      -- recurring events, which #2145 keeps out of scope.
      -- issue #3313 — `isMultiDate` now means "the guest must pick a day":
      -- unchanged for multi-date events, and true for a recurring event while
      -- more than one night is ahead. Every shipped client already mounts the
      -- day chooser from this key, so recurring events get it with no release.
      'isMultiDate', COALESCE((ev.day_choice ->> 'requiresChoice')::boolean, false),
      'isRecurring', COALESCE(ev.is_recurring, false),
      -- The organiser's pricing choice, so the page can say "per day" or
      -- "for all days" BEFORE the guest sees a total (amendment §7).
      'multiDatePricingMode', COALESCE(ev.multi_date_pricing_mode, 'per_day'),
      -- issue #3314 — the organiser's "Hide remaining count", so a guest page can
      -- decide from the SAME reader that served the event, public or unlisted.
      -- The social-proof read that carried it before answers for public events
      -- only, so an unlisted page could never learn the count was allowed.
      -- Same value as pg_public_social_proof: absent or JSON null is false (the
      -- organiser never turned it on). A value that is not a boolean, which
      -- makes that read raise, is true here: fail closed without breaking the page.
      -- Placed BEFORE recurrenceRule, not last: #3284's contract keeps
      -- recurrenceRule then refundPolicy as the final two keys.
      'hideRemainingCount', CASE
        WHEN ev.hide_remaining_count_setting IS NULL THEN false
        WHEN pg_catalog.pg_input_is_valid(ev.hide_remaining_count_setting, 'boolean')
          THEN ev.hide_remaining_count_setting::boolean
        ELSE true
      END,
      -- issue #3281 many-dates — before #3313 recurrenceRule / #3284 refundPolicy
      -- so R-16e still sees recurrenceRule immediately before refundPolicy.
      'allDaysPass', (
        COALESCE(ev.is_multi_date, false)
        AND NOT COALESCE(ev.is_recurring, false)
        AND COALESCE(ev.multi_date_pricing_mode, 'per_day') = 'all_days'
      ),
      'nextStartAt', (sched.schedule ->> 'nextStartAt')::timestamptz,
      'nextEndAt', (sched.schedule ->> 'nextEndAt')::timestamptz,
      'upcomingCount', COALESCE((sched.schedule ->> 'upcomingCount')::integer, 0),
      -- issue #3313 — APPENDED LAST. The stored repeat rule, so the public page
      -- can say "Every Tuesday" over the real dates instead of "Recurring
      -- (incomplete)".
      'recurrenceRule', CASE
        WHEN COALESCE(ev.is_recurring, false) AND jsonb_typeof(ev.recurrence_rules) = 'object'
          THEN ev.recurrence_rules
        ELSE NULL
      END,
      'refundPolicy', ev.refund_policy
    ) END
  FROM ev
  LEFT JOIN LATERAL (
    SELECT public.issue_3281_event_schedule(ev.id) AS schedule
  ) sched ON true;
$function$;

-- Public event page: hidden tiers are not listed.
-- Re-emitted verbatim from 20270607002774_issue_2774_public_hero_alt.sql (the live definition) with only the
-- #3827 change applied, so the DDL stays readable by the migration gates.
CREATE OR REPLACE FUNCTION public.pg_public_event_by_slug(p_brand_slug text, p_event_slug text)
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH ev AS (
    SELECT
      e.id,
      e.brand_id,
      e.title,
      e.description,
      e.slug              AS event_slug,
      e.event_type,
      e.location_text,
      e.online_url,
      e.is_online,
      e.status,
      e.published_at,
      e.timezone,
      e.currency,
      e.cover_media_url,
      e.cover_media_type,
      e.cover_media_provider,
      e.cover_media_source_url,
      e.cover_media_credit,
      e.cover_media_credit_url,
      e.cover_media_alt,
      e.cover_media_gallery,
      e.party_types,
      e.vibe_tags,
      e.music_genres,
      e.city,
      e.location_geo,
      e.city_geo,
      e.theme_color_override,
      e.theme_font_override,
      e.theme_animation_override,
      public.issue_2489_public_theme(e.theme) AS public_theme,
      ed.start_at AS master_start_at,
      ed.end_at   AS master_end_at,
      ed.timezone AS master_timezone,
      -- hide_address_until_ticket lives in theme.business_event (jsonb), not a
      -- real column. Default TRUE when absent — mirrors the service mapper
      -- (publicEventViewRowToEvent: asBoolean(..., true)) so a legacy row never
      -- leaks the street.
      public.issue_2489_address_withheld(e.theme) AS hide_address_until_ticket,
      b.id            AS brand_id_b,
      b.slug          AS brand_slug,
      b.name          AS brand_name,
      b.profile_photo_url AS brand_profile_photo_url,
      b.theme_color   AS brand_theme_color,
      b.theme_font    AS brand_theme_font,
      b.theme_animation AS brand_theme_animation,
      COALESCE(e.pass_mingla_fee,  b.default_pass_mingla_fee)  AS pass_mingla_fee,
      COALESCE(e.pass_service_fee, b.default_pass_service_fee) AS pass_service_fee,
      b.pricing_currency AS pricing_currency
    FROM public.events e
    JOIN public.brands b ON b.id = e.brand_id
    LEFT JOIN public.event_dates ed
           ON ed.event_id = e.id AND ed.is_master = true
    WHERE b.slug = p_brand_slug
      AND e.slug = p_event_slug
      AND e.event_type = 'event'           -- standard ticketed ONLY (SPEC scope)
      AND e.visibility = 'public'::text
      AND e.deleted_at IS NULL
      AND b.deleted_at IS NULL
      AND e.status = ANY (ARRAY['scheduled'::text, 'live'::text, 'ended'::text, 'cancelled'::text])
      AND NOT public.issue_1931_event_ordinary_read_blocked(e.id)
    LIMIT 1
  ),
  tix AS (
    SELECT
      tt.id,
      tt.name,
      tt.description,
      tt.price_cents,
      tt.currency,
      tt.quantity_total,
      tt.is_unlimited,
      tt.is_free,
      tt.sale_start_at,
      tt.sale_end_at,
      tt.is_hidden,
      tt.is_disabled,
      tt.requires_approval,
      tt.password_protected,
      tt.available_online,
      tt.available_in_person,
      tt.waitlist_enabled,
      tt.display_order,
      -- server all-in (WYSIWYP) — SAME compute_all_in_cents single owner as
      -- pg_public_event_tier_allin. Free / zero-price tier → 0.
      CASE
        WHEN COALESCE(tt.is_free, false) OR COALESCE(tt.price_cents, 0) = 0 THEN 0
        ELSE public.compute_all_in_cents(
               tt.price_cents,
               ev.pass_mingla_fee,
               ev.pass_service_fee,
               (SELECT r.effective_take_rate_bps
                  FROM public.resolve_effective_take_rate_bps(ev.brand_id) AS r)
             )
      END AS all_in_cents,
      -- remaining capacity (GREATEST(total - sold, 0)); NULL for unlimited.
      -- Sold formula matches pg_public_ticket_types_remaining (ORCH-0946) EXACTLY:
      -- COUNT of tickets rows with status IN ('valid','used','transferred').
      CASE
        WHEN COALESCE(tt.is_unlimited, false) THEN NULL
        WHEN tt.quantity_total IS NULL THEN NULL
        ELSE GREATEST(
          0,
          tt.quantity_total - COALESCE((
            SELECT COUNT(*)::integer
            FROM public.tickets t
            WHERE t.ticket_type_id = tt.id
              AND t.status IN ('valid', 'used', 'transferred')
          ), 0)
        )
      END AS remaining
    FROM public.ticket_types tt
    JOIN ev ON ev.id = tt.event_id
    WHERE tt.deleted_at IS NULL
      AND tt.available_online = true
      AND COALESCE(tt.is_hidden, false) = false
  )
  SELECT
    CASE WHEN ev.id IS NULL THEN NULL ELSE json_build_object(
      'id', ev.id,
      'brandId', ev.brand_id,
      'brandSlug', ev.brand_slug,
      'eventSlug', ev.event_slug,
      'name', ev.title,
      'description', COALESCE(ev.description, ''),
      'masterStartAt', ev.master_start_at,
      'masterEndAt', ev.master_end_at,
      'timezone', COALESCE(ev.master_timezone, ev.timezone),
      'status', ev.status,
      'isOnline', ev.is_online,
      'onlineUrl', ev.online_url,
      'venueName', CASE
        WHEN ev.hide_address_until_ticket
          THEN NULLIF((ev.public_theme #>> '{business_event,location,venueName}'), '')
        ELSE COALESCE(NULLIF((ev.public_theme #>> '{business_event,location,venueName}'), ''), ev.location_text)
      END,
      -- PRIVACY: address + exact pin omitted (NULL) when the street is hidden.
      'address', CASE
        WHEN ev.hide_address_until_ticket THEN NULL
        ELSE COALESCE(NULLIF((ev.public_theme #>> '{business_event,location,address}'), ''), ev.location_text)
      END,
      'hideAddressUntilTicket', ev.hide_address_until_ticket,
      'format', (ev.public_theme #>> '{business_event,format}'),
      'city', ev.city,
      -- exact pin: NULL when hidden; else {lat,lng} from the point.
      'locationGeo', CASE
        WHEN ev.hide_address_until_ticket OR ev.location_geo IS NULL THEN NULL
        ELSE json_build_object(
          'lat', ST_Y(ev.location_geo::geometry),
          'lng', ST_X(ev.location_geo::geometry)
        )
      END,
      -- city-level centroid: always returned when present (privacy-safe).
      'cityGeo', CASE
        WHEN ev.city_geo IS NULL THEN NULL
        ELSE json_build_object(
          'lat', ST_Y(ev.city_geo),
          'lng', ST_X(ev.city_geo)
        )
      END,
      'coverMediaUrl', ev.cover_media_url,
      'coverMediaType', ev.cover_media_type,
      'coverMediaAlt', ev.cover_media_alt,
      'coverGallery', COALESCE(ev.cover_media_gallery, '[]'::jsonb),
      'coverMediaProvider', ev.cover_media_provider,
      'coverMediaCredit', ev.cover_media_credit,
      'currency', COALESCE(ev.pricing_currency, ev.currency, 'usd'),
      'partyTypes', COALESCE(ev.party_types, ARRAY[]::text[]),
      'vibeTags', COALESCE(ev.vibe_tags, ARRAY[]::text[]),
      'musicGenres', COALESCE(ev.music_genres, ARRAY[]::text[]),
      'themeColorOverride', ev.theme_color_override,
      'themeFontOverride', ev.theme_font_override,
      'themeAnimationOverride', ev.theme_animation_override,
      'brand', json_build_object(
        'id', ev.brand_id_b,
        'slug', ev.brand_slug,
        'name', ev.brand_name,
        'profilePhotoUrl', ev.brand_profile_photo_url,
        'themeColor', ev.brand_theme_color,
        'themeFont', ev.brand_theme_font,
        'themeAnimation', ev.brand_theme_animation
      ),
      'tickets', COALESCE((
        SELECT json_agg(json_build_object(
          'id', tix.id,
          'name', tix.name,
          'description', tix.description,
          'priceCents', tix.price_cents,
          'allInCents', tix.all_in_cents,
          'currency', tix.currency,
          'capacity', tix.quantity_total,
          'remaining', tix.remaining,
          'isUnlimited', tix.is_unlimited,
          'isFree', tix.is_free,
          'saleStartAt', tix.sale_start_at,
          'saleEndAt', tix.sale_end_at,
          'isHidden', tix.is_hidden,
          'isDisabled', tix.is_disabled,
          'requiresApproval', tix.requires_approval,
          'passwordProtected', tix.password_protected,
          'availableOnline', tix.available_online,
          'availableInPerson', tix.available_in_person,
          'waitlistEnabled', tix.waitlist_enabled,
          'displayOrder', tix.display_order
        ) ORDER BY tix.display_order ASC)
        FROM tix
      ), '[]'::json)
    ) END
  FROM ev;
$function$
;

-- Public all-in prices: hidden tiers are not listed.
-- Re-emitted verbatim from 20270415002117_issue_2117_offering_visibility_gate.sql (the live definition) with only the
-- #3827 change applied, so the DDL stays readable by the migration gates.
CREATE OR REPLACE FUNCTION public.pg_public_event_tier_allin(p_event_id uuid)
 RETURNS TABLE(ticket_type_id uuid, base_cents integer, all_in_cents integer, currency text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    tt.id AS ticket_type_id,
    GREATEST(0, COALESCE(tt.price_cents, 0)) AS base_cents,
    -- Free tiers (is_free OR null/0 price) => 0, never NaN. compute_all_in_cents
    -- floors the base at 0 and only grosses up a positive base by the passed
    -- fees, so a free tier already returns 0; the CASE makes that explicit and
    -- short-circuits the take-rate subquery for free rows.
    CASE
      WHEN COALESCE(tt.is_free, false) OR COALESCE(tt.price_cents, 0) = 0 THEN 0
      ELSE public.compute_all_in_cents(
             tt.price_cents,
             COALESCE(e.pass_mingla_fee,  b.default_pass_mingla_fee),
             COALESCE(e.pass_service_fee, b.default_pass_service_fee),
             (SELECT r.effective_take_rate_bps
                FROM public.resolve_effective_take_rate_bps(b.id) AS r)
           )
    END AS all_in_cents,
    COALESCE(b.pricing_currency, tt.currency, 'usd') AS currency
  FROM public.ticket_types tt
  JOIN public.events e ON e.id = tt.event_id
  JOIN public.brands b ON b.id = e.brand_id
  WHERE tt.event_id = p_event_id
    AND tt.deleted_at IS NULL
    AND COALESCE(tt.is_hidden, false) = false
    AND e.deleted_at IS NULL
    AND b.deleted_at IS NULL
    -- issue #2117 -- the offering visibility rule is expressed ONLY through the
    -- Offering Visibility Gate. Do NOT write it locally here or anywhere else.
    -- Audience 'direct' by AR-2: this reader is dual-reach and its acquisition
    -- path is ITSELF UNAUTHENTICATED (the unlisted exact-link direct-checkout
    -- contract), while an already-narrow render reader exists to serve the
    -- render surface -- measured: it serves the publicly visible state only and
    -- carries both the all-in pricing and the remaining inventory. Assigning
    -- 'listing' here would strip pricing from the shipped anon acquisition
    -- surface for an unlisted offering and break the invariant SPEC §6 lists as
    -- PRESERVED. This reader has no status predicate today and none is added.
    AND public.pg_offering_visibility_gate(e.visibility, e.deleted_at, 'direct')
  ORDER BY GREATEST(0, COALESCE(tt.price_cents, 0)) ASC, tt.id ASC;
$function$;

-- Public remaining counts: hidden tiers are not listed.
-- Re-emitted verbatim from 20270415002117_issue_2117_offering_visibility_gate.sql (the live definition) with only the
-- #3827 change applied, so the DDL stays readable by the migration gates.
CREATE OR REPLACE FUNCTION public.pg_public_ticket_types_remaining(p_event_id uuid)
 RETURNS TABLE(ticket_type_id uuid, sold integer, remaining integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT
    tt.id AS ticket_type_id,
    COALESCE(s.sold, 0)::int AS sold,
    CASE
      WHEN tt.is_unlimited THEN NULL
      WHEN tt.quantity_total IS NULL THEN NULL
      ELSE GREATEST(tt.quantity_total - COALESCE(s.sold, 0), 0)::int
    END AS remaining
  FROM public.ticket_types tt
  LEFT JOIN (
    SELECT t.ticket_type_id, COUNT(*)::int AS sold
    FROM public.tickets t
    WHERE t.status IN ('valid', 'used', 'transferred')
    GROUP BY t.ticket_type_id
  ) s ON s.ticket_type_id = tt.id
  WHERE tt.event_id = p_event_id
    AND tt.deleted_at IS NULL
    AND COALESCE(tt.is_hidden, false) = false
    -- issue #2117 -- Class B (§4.3): this reader is keyed on an offering but
    -- NEVER resolves it -- which is exactly why the naive "does the body
    -- reference the offering table" test misses it -- so it gains ONE conjunct
    -- calling the identifier form of the gate. Nothing else in the body
    -- changes. Audience 'direct' by the same AR-2 derivation recorded on the
    -- per-tier pricing reader. Documented empty value: ZERO ROWS. It does NOT
    -- raise -- a raise would be an observable behavioural change and is out of
    -- contract.
    AND public.pg_offering_passes_visibility_gate(p_event_id, 'direct');
$function$;

-- ---------------------------------------------------------------------------
-- Host roster attribution and password retirement
-- ---------------------------------------------------------------------------

-- Guest roster: each row carries the label of the private link that brought it (viaLinkLabel).
-- Re-emitted verbatim from 20271128013827_issue_3827_guest_list_comps.sql (the live definition) with only the
-- #3827 change applied, so the DDL stays readable by the migration gates.
CREATE OR REPLACE FUNCTION public.biz_guest_roster_project(p_event_id uuid)
RETURNS TABLE(row_data jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp
AS $function$
WITH event_row AS (
  SELECT e.id,e.brand_id FROM public.events e
  WHERE e.id=p_event_id AND e.deleted_at IS NULL
), canonical_people AS (
  SELECT DISTINCT p.id,p.display_name,p.avatar_url,p.updated_at
  FROM event_row e
  JOIN public.brand_people p ON p.brand_id=e.brand_id AND p.record_status='active'
  WHERE EXISTS (SELECT 1 FROM public.brand_offering_invites i WHERE i.event_id=e.id AND i.brand_person_id=p.id)
     OR EXISTS (
       SELECT 1 FROM public.brand_person_source_links l
       LEFT JOIN public.event_rsvps r ON l.source_kind='event_rsvp' AND r.id=l.source_id
       LEFT JOIN public.orders o ON l.source_kind='order' AND o.id=l.source_id
       LEFT JOIN public.tickets t ON l.source_kind='ticket_holder' AND t.id=l.source_id
       WHERE l.brand_person_id=p.id AND l.detached_at IS NULL
         AND COALESCE(r.event_id,o.event_id,t.event_id)=e.id
     )
), projected AS (
  SELECT
    'person:'||p.id::text AS roster_key,
    p.id AS person_id,
    p.display_name,
    p.avatar_url,
    invite.id AS invite_id,
    invite.status AS invite_record_status,
    invite.invited_at,
    rsvp.id AS rsvp_id,
    rsvp.rsvp_status,
    rsvp.approval_status,
    rsvp.updated_at AS rsvp_at,
    COALESCE(1+rsvp.plus_count,0) AS rsvp_party_size,
    COALESCE(commerce.order_ids,'{}'::uuid[]) AS order_ids,
    COALESCE(commerce.active_tickets,0) AS active_tickets,
    COALESCE(commerce.comp_active_tickets,0) AS comp_active_tickets,
    COALESCE(commerce.refunded_tickets,0) AS refunded_tickets,
    COALESCE(commerce.transferred_tickets,0) AS transferred_tickets,
    GREATEST(COALESCE(commerce.checked_in,0),
      CASE WHEN rsvp.checked_in_at IS NOT NULL THEN 1 ELSE 0 END
        + COALESCE(rsvp_party.checked_in,0)) AS checked_in,
    COALESCE(commerce.has_buyer,false) AS has_buyer,
    COALESCE(commerce.has_refund,false) AS has_refund,
    COALESCE(commerce.has_cancel,false) AS has_cancel,
    COALESCE(commerce.has_transfer,false) AS has_transfer,
    COALESCE(delivery.accepted,false) AS accepted,
    COALESCE(delivery.has_inflight,false) AS has_inflight,
    COALESCE(delivery.has_failure,false) AS has_failure,
    COALESCE(delivery.all_policy_blocked,false) AS all_policy_blocked,
    COALESCE(delivery.retryable,false) AS retryable,
    COALESCE(delivery.attempts,'[]'::jsonb) AS attempts,
    delivery.last_contact_at,
    delivery.last_reminder_at,
    contact.contact_label,
    GREATEST(p.updated_at,invite.updated_at,rsvp.updated_at,commerce.activity_at,delivery.activity_at) AS activity_at
  FROM canonical_people p
  LEFT JOIN LATERAL (
    SELECT i.* FROM public.brand_offering_invites i
    WHERE i.event_id=p_event_id AND i.brand_person_id=p.id
    ORDER BY i.updated_at DESC,i.id DESC LIMIT 1
  ) invite ON true
  LEFT JOIN LATERAL (
    SELECT r.* FROM public.brand_person_source_links l
    JOIN public.event_rsvps r ON l.source_kind='event_rsvp' AND r.id=l.source_id
    WHERE l.brand_person_id=p.id AND l.detached_at IS NULL AND r.event_id=p_event_id
    ORDER BY r.updated_at DESC,r.id DESC LIMIT 1
  ) rsvp ON true
  LEFT JOIN LATERAL (
    SELECT count(*) FILTER (WHERE g.checked_in_at IS NOT NULL)::integer AS checked_in
    FROM public.event_rsvp_guests g WHERE g.rsvp_id=rsvp.id
  ) rsvp_party ON true
  LEFT JOIN LATERAL (
    WITH person_tickets AS (
      SELECT DISTINCT t.*,o.id AS linked_order_id,o.payment_status,o.updated_at AS order_updated_at
      FROM public.tickets t JOIN public.orders o ON o.id=t.order_id
      WHERE t.event_id=p_event_id AND (
        EXISTS (SELECT 1 FROM public.brand_person_source_links holder
          WHERE holder.brand_person_id=p.id AND holder.source_kind='ticket_holder'
            AND holder.source_id=t.id AND holder.detached_at IS NULL)
        OR (EXISTS (SELECT 1 FROM public.brand_person_source_links buyer
              WHERE buyer.brand_person_id=p.id AND buyer.source_kind='order'
                AND buyer.source_id=o.id AND buyer.detached_at IS NULL)
            AND NOT EXISTS (SELECT 1 FROM public.brand_person_source_links holder
              WHERE holder.source_kind='ticket_holder' AND holder.source_id=t.id
                AND holder.detached_at IS NULL))
      )
    )
    SELECT array_agg(DISTINCT t.linked_order_id ORDER BY t.linked_order_id) AS order_ids,
      count(t.id) FILTER (WHERE o.payment_status IN ('paid','partial_refund') AND t.status IN ('valid','used'))::integer AS active_tickets,
      count(t.id) FILTER (WHERE o.source='comp' AND o.payment_status IN ('paid','partial_refund') AND t.status IN ('valid','used'))::integer AS comp_active_tickets,
      count(t.id) FILTER (WHERE t.status='refunded')::integer AS refunded_tickets,
      count(t.id) FILTER (WHERE t.status='transferred')::integer AS transferred_tickets,
      count(t.id) FILTER (WHERE t.status='used' OR t.used_at IS NOT NULL)::integer AS checked_in,
      count(DISTINCT t.linked_order_id)>0 AS has_buyer,
      bool_or(o.payment_status IN ('refunded','partial_refund') OR t.status='refunded') AS has_refund,
      bool_or(o.payment_status='cancelled' OR t.status='void') AS has_cancel,
      bool_or(t.status='transferred') AS has_transfer,
      max(GREATEST(t.order_updated_at,t.created_at,COALESCE(t.used_at,t.created_at))) AS activity_at
    FROM person_tickets t JOIN public.orders o ON o.id=t.linked_order_id
  ) commerce ON true
  LEFT JOIN LATERAL (
    WITH latest_retryable_failure AS (
      SELECT a.*,row_number() OVER (
        PARTITION BY a.channel ORDER BY a.attempt_ordinal DESC,a.created_at DESC,a.id DESC
      ) AS channel_rank
      FROM public.brand_offering_invite_delivery_attempts a WHERE a.invite_id=invite.id
    ) SELECT
      bool_or(a.provider_accepted_at IS NOT NULL OR a.status IN ('sent','delivered')) AS accepted,
      bool_or(a.status IN ('queued','sending') AND a.provider_accepted_at IS NULL) AS has_inflight,
      bool_or(a.status='failed') AS has_failure,
      bool_and(a.status='suppressed') AS all_policy_blocked,
      bool_or(a.channel_rank=1 AND a.status='failed' AND a.is_retryable) AS retryable,
      max(COALESCE(a.delivered_at,a.sent_at,a.provider_accepted_at,a.failed_at,a.queued_at,a.created_at)) AS activity_at,
      max(COALESCE(a.delivered_at,a.sent_at,a.provider_accepted_at)) AS last_contact_at,
      max(COALESCE(a.delivered_at,a.sent_at,a.provider_accepted_at)) FILTER (
        WHERE a.attempt_kind='reminder'
          AND (a.provider_accepted_at IS NOT NULL OR a.status IN ('sent','delivered'))
      ) AS last_reminder_at,
      jsonb_agg(jsonb_build_object(
        'channel',a.channel,'status',a.status,
        'providerAccepted',(a.provider_accepted_at IS NOT NULL OR a.status IN ('sent','delivered')),
        'retryable',a.is_retryable,'reason',a.safe_reason_code,
        'occurredAt',COALESCE(a.delivered_at,a.sent_at,a.provider_accepted_at,a.failed_at,a.queued_at,a.created_at)
      ) ORDER BY a.created_at DESC,a.id DESC) AS attempts
    FROM latest_retryable_failure a
  ) delivery ON true
  LEFT JOIN LATERAL (
    SELECT c.normalized_value AS contact_label
    FROM public.brand_person_contact_methods c
    WHERE c.brand_person_id=p.id AND c.record_state='active'
      AND c.provenance_scope='brand_owned' AND c.is_exportable
    ORDER BY c.is_primary DESC,c.created_at,c.id LIMIT 1
  ) contact ON true
), classified AS (
  SELECT x.*,
    CASE
      WHEN x.active_tickets>0 THEN 'bought_ticket'
      WHEN x.rsvp_status='going' AND x.approval_status='approved' THEN 'going'
      WHEN x.rsvp_status='going' AND x.approval_status='pending' THEN 'awaiting_approval'
      WHEN x.approval_status='denied' THEN 'denied'
      WHEN x.rsvp_status='waitlisted' THEN 'waitlisted'
      WHEN x.rsvp_status='maybe' THEN 'maybe'
      WHEN x.rsvp_status='not_going' THEN 'declined'
      WHEN x.has_refund THEN 'refunded'
      WHEN x.has_cancel THEN 'cancelled'
      WHEN x.has_transfer THEN 'transferred'
      WHEN x.invite_record_status='removed' THEN 'removed'
      WHEN x.accepted THEN 'not_responded'
      WHEN x.invite_id IS NOT NULL AND x.has_inflight THEN 'sending'
      WHEN x.invite_id IS NOT NULL AND x.has_failure THEN 'invite_failed'
      WHEN x.invite_id IS NOT NULL AND x.all_policy_blocked THEN 'suppressed_or_skipped'
      WHEN x.invite_id IS NOT NULL THEN 'not_sent'
      WHEN x.rsvp_id IS NOT NULL THEN 'existing_rsvp'
      WHEN x.has_buyer THEN 'existing_buyer'
      ELSE 'unlinked_guest'
    END AS primary_status,
    CASE
      WHEN x.invite_record_status='removed' THEN 'removed'
      WHEN x.accepted THEN 'invited'
      WHEN x.has_inflight THEN 'sending'
      WHEN x.has_failure THEN 'failed'
      WHEN x.all_policy_blocked THEN 'suppressed_or_skipped'
      WHEN x.invite_id IS NOT NULL THEN 'not_sent'
      ELSE 'none'
    END AS invitation_status
  FROM projected x
), canonical_json AS (
  SELECT jsonb_build_object(
    'rosterKey',c.roster_key,'personId',c.person_id,'displayName',c.display_name,
    'avatarUrl',c.avatar_url,'contactLabel',c.contact_label,
    'primaryStatus',c.primary_status,'invitationStatus',c.invitation_status,
    'invitationLabel',NULL,'attempts',c.attempts,
    'party',jsonb_build_object('size',GREATEST(1,c.rsvp_party_size,c.active_tickets+c.refunded_tickets+c.transferred_tickets),
      'activeTickets',c.active_tickets,'refundedTickets',c.refunded_tickets,
      'transferredTickets',c.transferred_tickets,'checkedIn',c.checked_in),
    'rsvpId',c.rsvp_id,'rsvpStatus',c.rsvp_status,'rsvpApprovalStatus',c.approval_status,
    'orderIds',to_jsonb(c.order_ids),
    'latestActivityAt',COALESCE(c.activity_at,now()),'checkedIn',c.checked_in>0,
    'canRemind',c.primary_status IN ('not_responded','maybe')
      AND (c.last_reminder_at IS NULL OR c.last_reminder_at<=now()-interval '24 hours'),
    'canRetry',COALESCE(c.retryable,false),
    'canApprove',c.primary_status='awaiting_approval','canDeny',c.primary_status='awaiting_approval',
    'isExportable',c.person_id IS NOT NULL,
    'guestList',(c.active_tickets>0 AND c.comp_active_tickets=c.active_tickets),
    'viaLinkLabel',(SELECT l.label FROM public.orders o JOIN public.ticket_type_links l ON l.id=o.ticket_link_id WHERE o.id=ANY(c.order_ids) ORDER BY o.created_at LIMIT 1)
  ) AS row_data FROM classified c
), unlinked_rsvps AS (
  SELECT jsonb_build_object(
    'rosterKey','rsvp:'||r.id::text,'personId',NULL,'displayName',COALESCE(NULLIF(btrim(r.guest_name),''),'Unlinked guest'),
    'avatarUrl',NULL,'contactLabel',NULL,
    'primaryStatus','unlinked_guest','invitationStatus','none','invitationLabel',NULL,'attempts','[]'::jsonb,
    'party',jsonb_build_object('size',1+r.plus_count,'activeTickets',0,'refundedTickets',0,'transferredTickets',0,
      'checkedIn',(CASE WHEN r.checked_in_at IS NOT NULL THEN 1 ELSE 0 END)+(SELECT count(*) FROM public.event_rsvp_guests g WHERE g.rsvp_id=r.id AND g.checked_in_at IS NOT NULL)),
    'rsvpId',r.id,'rsvpStatus',r.rsvp_status,'rsvpApprovalStatus',r.approval_status,
    'orderIds','[]'::jsonb,'latestActivityAt',r.updated_at,
    'checkedIn',(r.checked_in_at IS NOT NULL OR EXISTS (SELECT 1 FROM public.event_rsvp_guests g WHERE g.rsvp_id=r.id AND g.checked_in_at IS NOT NULL)),
    'canRemind',false,'canRetry',false,'canApprove',false,'canDeny',false,'isExportable',false
  ) AS row_data
  FROM public.event_rsvps r WHERE r.event_id=p_event_id AND NOT EXISTS (
    SELECT 1 FROM public.brand_person_source_links l
    WHERE l.source_kind='event_rsvp' AND l.source_id=r.id AND l.detached_at IS NULL
  )
), unlinked_orders AS (
  SELECT jsonb_build_object(
    'rosterKey','order:'||o.id::text,'personId',NULL,'displayName',COALESCE(NULLIF(btrim(o.buyer_name),''),'Unlinked guest'),
    'avatarUrl',NULL,'contactLabel',NULL,'primaryStatus','unlinked_guest','invitationStatus','none',
    'invitationLabel',NULL,'attempts','[]'::jsonb,
    'party',jsonb_build_object('size',GREATEST(1,count(t.id)),'activeTickets',count(t.id) FILTER (WHERE o.payment_status IN ('paid','partial_refund') AND t.status IN ('valid','used')),
      'refundedTickets',count(t.id) FILTER (WHERE t.status='refunded'),'transferredTickets',count(t.id) FILTER (WHERE t.status='transferred'),
      'checkedIn',count(t.id) FILTER (WHERE t.status='used' OR t.used_at IS NOT NULL)),
    'rsvpId',NULL,'rsvpStatus',NULL,'rsvpApprovalStatus',NULL,
    'orderIds',jsonb_build_array(o.id),'latestActivityAt',o.updated_at,
    'checkedIn',bool_or(t.status='used' OR t.used_at IS NOT NULL),
    'canRemind',false,'canRetry',false,'canApprove',false,'canDeny',false,'isExportable',false,
    'guestList',o.source='comp',
    'viaLinkLabel',(SELECT l.label FROM public.ticket_type_links l WHERE l.id=o.ticket_link_id)
  ) AS row_data
  FROM public.orders o LEFT JOIN public.tickets t ON t.order_id=o.id
  WHERE o.event_id=p_event_id AND NOT EXISTS (
    SELECT 1 FROM public.brand_person_source_links l
    WHERE l.detached_at IS NULL AND l.source_kind='order' AND l.source_id=o.id
  ) GROUP BY o.id
)
SELECT row_data FROM canonical_json
UNION ALL SELECT row_data FROM unlinked_rsvps
UNION ALL SELECT row_data FROM unlinked_orders
$function$;

-- The door search contract deliberately has a frozen minimal field allowlist.
-- Resolve private-link attribution separately, after the authorised search,
-- so adding the label cannot widen that security boundary.
CREATE OR REPLACE FUNCTION public.biz_ticket_link_order_labels(
  p_actor_id uuid,
  p_event_id uuid,
  p_order_ids uuid[]
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_brand uuid;
  v_labels jsonb;
BEGIN
  IF COALESCE(cardinality(p_order_ids), 0) > 20 THEN
    RAISE EXCEPTION 'too_many_orders';
  END IF;

  SELECT e.brand_id INTO v_brand
    FROM public.events e
   WHERE e.id = p_event_id
     AND e.deleted_at IS NULL;
  IF NOT FOUND OR NOT (
    public.issue_3827_can_door_scan(p_event_id, p_actor_id)
    OR public.biz_brand_effective_rank(v_brand, p_actor_id) >= public.biz_role_rank('event_manager')
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT COALESCE(jsonb_object_agg(o.id::text, l.label), '{}'::jsonb)
    INTO v_labels
    FROM public.orders o
    JOIN public.ticket_type_links l ON l.id = o.ticket_link_id
   WHERE o.event_id = p_event_id
     AND o.id = ANY(COALESCE(p_order_ids, '{}'::uuid[]));

  RETURN v_labels;
END;
$$;

REVOKE ALL ON FUNCTION public.biz_ticket_link_order_labels(uuid, uuid, uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.biz_ticket_link_order_labels(uuid, uuid, uuid[]) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.biz_ticket_link_order_labels(uuid, uuid, uuid[]) TO service_role;

COMMENT ON FUNCTION public.biz_ticket_link_order_labels(uuid, uuid, uuid[]) IS
  'issue #3827: labels private-link orders already returned by the authorised door search without widening its frozen result contract.';

-- Event-level password protection lives in the event theme rather than a
-- relational column. Existing values are removed before the trigger is armed;
-- every future direct writer is refused if it tries to put the retired switch
-- back, while unrelated theme updates remain untouched.
UPDATE public.events
   SET theme = theme #- '{business_event,settings,passwordProtected}'::text[]
 WHERE theme #> '{business_event,settings,passwordProtected}' IS NOT NULL;

CREATE OR REPLACE FUNCTION public.issue_3827_retire_event_password()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.theme #> '{business_event,settings,passwordProtected}' = 'true'::jsonb THEN
    RAISE EXCEPTION 'password_protection_retired';
  END IF;
  -- #> is NULL for a scalar or missing path, so #- only runs when the key exists
  -- (a non-object theme must never block an unrelated write).
  IF NEW.theme #> '{business_event,settings,passwordProtected}' IS NOT NULL THEN
    NEW.theme := NEW.theme #- '{business_event,settings,passwordProtected}'::text[];
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.issue_3827_retire_event_password() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3827_retire_event_password() TO service_role;

CREATE TRIGGER issue_3827_retire_event_password
BEFORE INSERT OR UPDATE ON public.events
FOR EACH ROW EXECUTE FUNCTION public.issue_3827_retire_event_password();

CREATE OR REPLACE FUNCTION public.issue_3827_retire_tier_password()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF COALESCE(NEW.password_protected, false) OR NEW.password_hash IS NOT NULL THEN
    RAISE EXCEPTION 'password_protection_retired';
  END IF;
  NEW.password_protected := false;
  NEW.password_hash := NULL;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.issue_3827_retire_tier_password() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3827_retire_tier_password() TO service_role;

CREATE TRIGGER issue_3827_retire_tier_password
BEFORE INSERT OR UPDATE ON public.ticket_types
FOR EACH ROW EXECUTE FUNCTION public.issue_3827_retire_tier_password();

UPDATE public.ticket_types
   SET password_protected = false, password_hash = NULL
 WHERE password_protected OR password_hash IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Migration-time proof
-- ---------------------------------------------------------------------------

DO $postcheck$
BEGIN
  IF EXISTS (SELECT 1 FROM public.ticket_types WHERE password_protected OR password_hash IS NOT NULL) THEN
    RAISE EXCEPTION 'issue #3827 password retirement postcheck failed';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.events
     WHERE theme #> '{business_event,settings,passwordProtected}' IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'issue #3827 event password retirement postcheck failed';
  END IF;
  IF position('issue_3827_link_unlocks_tier' IN pg_get_functiondef(
    'public.issue_1930_ticket_checkout_create_session_base(uuid,uuid,text,text,text,boolean,jsonb,text,timestamptz,integer,text,uuid[],timestamptz,timestamptz,integer)'::regprocedure
  )) = 0 THEN
    RAISE EXCEPTION 'issue #3827 hidden-tier checkout gate is absent';
  END IF;
  IF position('COALESCE(tt.is_hidden, false) = false' IN pg_get_functiondef(
    'public.pg_direct_event_checkout_bundle(uuid,text,text)'::regprocedure
  )) = 0 OR position('COALESCE(tt.is_hidden, false) = false' IN pg_get_functiondef(
    'public.pg_public_event_by_slug(text,text)'::regprocedure
  )) = 0 THEN
    RAISE EXCEPTION 'issue #3827 public reader predicate is absent';
  END IF;
  IF has_table_privilege('anon', 'public.ticket_type_links', 'SELECT')
     OR has_table_privilege('anon', 'public.ticket_link_signups', 'SELECT')
     OR has_table_privilege('authenticated', 'public.ticket_link_signups', 'SELECT')
     OR has_column_privilege('authenticated', 'public.ticket_type_links', 'token_hash', 'SELECT')
     OR has_column_privilege('authenticated', 'public.ticket_type_links', 'token_nonce', 'SELECT') THEN
    RAISE EXCEPTION 'issue #3827 private-link ACL postcheck failed';
  END IF;
END;
$postcheck$;

COMMIT;
NOTIFY pgrst, 'reload schema';
