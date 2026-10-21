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
  ADD CONSTRAINT orders_ticket_link_id_fkey
  FOREIGN KEY (ticket_link_id) REFERENCES public.ticket_type_links(id) ON DELETE SET NULL;
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

-- I-3827-COMP-HAS-ORIGIN: every comp is attributable to a team member or link.
ALTER TABLE public.orders
  ADD CONSTRAINT orders_comp_origin_check CHECK (
    source <> 'comp' OR comp_issued_by IS NOT NULL OR ticket_link_id IS NOT NULL
  ) NOT VALID;
ALTER TABLE public.orders VALIDATE CONSTRAINT orders_comp_origin_check;

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

CREATE TRIGGER issue_3827_order_link_from_session
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
-- Each transformation asserts its one exact source fragment, changes only that
-- fragment, and refuses migration replay if a later migration has drifted it.
DO $guarded_reemit$
DECLARE
  v_def text;
  v_next text;
  v_old text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef(
    'public.issue_1930_ticket_checkout_create_session_base(uuid,uuid,text,text,text,boolean,jsonb,text,timestamptz,integer,text,uuid[],timestamptz,timestamptz,integer)'::regprocedure
  );
  v_old := 'IF v_ticket_type.is_hidden OR v_ticket_type.is_disabled OR NOT v_ticket_type.available_online THEN';
  v_new := 'IF (v_ticket_type.is_hidden AND NOT public.issue_3827_link_unlocks_tier(v_ticket_type.id))'
    || E'\n       OR v_ticket_type.is_disabled OR NOT v_ticket_type.available_online THEN';
  v_next := replace(v_def, v_old, v_new);
  IF v_next = v_def OR position(v_old IN v_next) > 0 THEN
    RAISE EXCEPTION 'issue #3827 checkout-base one-hunk guard failed';
  END IF;
  EXECUTE v_next;

  v_def := pg_get_functiondef('public.pg_direct_event_checkout_bundle(uuid,text,text)'::regprocedure);
  v_old := E'    WHERE tt.deleted_at IS NULL\n      AND tt.available_online = true';
  v_new := v_old || E'\n      AND COALESCE(tt.is_hidden, false) = false';
  v_next := replace(v_def, v_old, v_new);
  IF v_next = v_def OR length(v_next) - length(v_def) <> length(v_new) - length(v_old) THEN
    RAISE EXCEPTION 'issue #3827 direct-bundle one-predicate guard failed';
  END IF;
  EXECUTE v_next;

  v_def := pg_get_functiondef('public.pg_public_event_by_slug(text,text)'::regprocedure);
  v_old := E'    WHERE tt.deleted_at IS NULL\n      AND tt.available_online = true';
  v_new := v_old || E'\n      AND COALESCE(tt.is_hidden, false) = false';
  v_next := replace(v_def, v_old, v_new);
  IF v_next = v_def OR length(v_next) - length(v_def) <> length(v_new) - length(v_old) THEN
    RAISE EXCEPTION 'issue #3827 public-event one-predicate guard failed';
  END IF;
  EXECUTE v_next;

  v_def := pg_get_functiondef('public.pg_public_event_tier_allin(uuid)'::regprocedure);
  v_old := E'  WHERE tt.event_id = p_event_id\n    AND tt.deleted_at IS NULL';
  v_new := v_old || E'\n    AND COALESCE(tt.is_hidden, false) = false';
  v_next := replace(v_def, v_old, v_new);
  IF v_next = v_def THEN RAISE EXCEPTION 'issue #3827 tier-allin guard failed'; END IF;
  EXECUTE v_next;

  v_def := pg_get_functiondef('public.pg_public_ticket_types_remaining(uuid)'::regprocedure);
  v_old := E'  WHERE tt.event_id = p_event_id\n    AND tt.deleted_at IS NULL';
  v_new := v_old || E'\n    AND COALESCE(tt.is_hidden, false) = false';
  v_next := replace(v_def, v_old, v_new);
  IF v_next = v_def THEN RAISE EXCEPTION 'issue #3827 tier-remaining guard failed'; END IF;
  EXECUTE v_next;
END;
$guarded_reemit$;

-- ---------------------------------------------------------------------------
-- Host roster attribution and password retirement
-- ---------------------------------------------------------------------------

DO $roster_reemit$
DECLARE v_def text; v_next text; v_old text; v_new text;
BEGIN
  v_def := pg_get_functiondef('public.biz_door_guest_search(uuid,uuid,text,integer)'::regprocedure);
  v_old := '           ''tickets'', COALESCE((';
  v_new := E'           ''viaLinkLabel'', (SELECT l.label FROM public.ticket_type_links l WHERE l.id = p.ticket_link_id),\n'
    || '           ''tickets'', COALESCE((';
  -- The picked CTE must carry the two ids used by the correlated projections.
  v_next := replace(v_def,
    E'SELECT o.id, o.buyer_name, o.buyer_email, o.source, o.metadata, o.created_at,\n',
    E'SELECT o.id, o.buyer_name, o.buyer_email, o.source, o.metadata, o.created_at, o.ticket_link_id,\n');
  v_next := replace(v_next, v_old, v_new);
  IF v_next = v_def OR position('viaLinkLabel' IN v_next) = 0
     OR position('o.ticket_link_id' IN v_next) = 0 THEN
    RAISE EXCEPTION 'issue #3827 door-search attribution guard failed';
  END IF;
  EXECUTE v_next;

  v_def := pg_get_functiondef('public.biz_guest_roster_project(uuid)'::regprocedure);
  v_old := E'    ''guestList'',(c.active_tickets>0 AND c.comp_active_tickets=c.active_tickets)\n  ) AS row_data';
  v_new := E'    ''guestList'',(c.active_tickets>0 AND c.comp_active_tickets=c.active_tickets),\n'
    || E'    ''viaLinkLabel'',(SELECT l.label FROM public.orders o JOIN public.ticket_type_links l ON l.id=o.ticket_link_id WHERE o.id=ANY(c.order_ids) ORDER BY o.created_at LIMIT 1)\n'
    || '  ) AS row_data';
  v_next := replace(v_def, v_old, v_new);
  v_old := E'    ''guestList'',o.source=''comp''\n  ) AS row_data';
  v_new := E'    ''guestList'',o.source=''comp'',\n'
    || E'    ''viaLinkLabel'',(SELECT l.label FROM public.ticket_type_links l WHERE l.id=o.ticket_link_id)\n'
    || '  ) AS row_data';
  v_next := replace(v_next, v_old, v_new);
  IF v_next = v_def OR (length(v_next) - length(replace(v_next, 'viaLinkLabel', ''))) <> 2 * length('viaLinkLabel') THEN
    RAISE EXCEPTION 'issue #3827 roster attribution guard failed';
  END IF;
  EXECUTE v_next;
END;
$roster_reemit$;

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
  IF NEW.theme IS NOT NULL THEN
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
