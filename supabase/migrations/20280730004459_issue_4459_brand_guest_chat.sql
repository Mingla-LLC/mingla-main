-- #4459 — one brand-wide Guest chat per brand (SPEC v2, Seth approved
-- 2026-11-16 with every default).
--
-- Every brand gets exactly one `brand_guests` conversation. Anyone with a
-- qualifying booking with the brand (a paid ticket, trip or experience order,
-- a comp, a door sale, an approved "going" RSVP, a matched plus-one, or a
-- claimed pending chat claim) is a member; the brand team is mirrored in and
-- posts as the brand. It is a different chat from the team-only Brand group
-- (`linked_entity_type = 'brand'`, #3720) and the two are never merged.
--
-- Membership is written ONLY by the issue_4459_* SECURITY DEFINER functions
-- below: one helper (`issue_4459_sync_brand_guest`) called by
-- `add_buyer_to_event_chat` (5 booking rails) and by triggers on the source
-- tables (RSVPs, plus-ones, orders, brand team). Leave and host removal are
-- sticky (`brand_guest_chat_exclusions`). Sends are RPC-only.
--
-- The per-listing event and trip chats (115 + 39 on production, 1 message in
-- total) are retired: their guests move here, then they are disabled (rows are
-- kept) and no new ones are created.
--
-- INVARIANT issue-4459-brand-guests: one brand_guests conversation per brand; membership = brand team ∪ eligible guests − exclusions; written only by issue_4459_* definer functions; never merged with linked_entity_type='brand'; Explorer renders it as the only brand_channel row (no client fold).
-- INVARIANT issue-4459-no-cap: any future cap on conversation_participants must exempt linked_entity_type='brand_guests' (the #4435 15-member cap lives on session_participants only).

BEGIN;

-- ── 1. The conversation kind ────────────────────────────────────────────────
ALTER TABLE public.conversations DROP CONSTRAINT IF EXISTS conversations_linked_entity_type_check;
ALTER TABLE public.conversations ADD CONSTRAINT conversations_linked_entity_type_check
  CHECK (linked_entity_type IN ('direct','session','trip','event','support','brand','brand_enquiry','brand_guests'));

ALTER TABLE public.conversations DROP CONSTRAINT IF EXISTS conversations_linked_entity_coherent;
ALTER TABLE public.conversations ADD CONSTRAINT conversations_linked_entity_coherent CHECK (
  (linked_entity_type = 'direct'        AND session_id IS NULL     AND event_id IS NULL     AND brand_id IS NULL) OR
  (linked_entity_type = 'session'       AND session_id IS NOT NULL AND event_id IS NULL     AND brand_id IS NULL) OR
  (linked_entity_type = 'trip'          AND event_id   IS NOT NULL AND session_id IS NULL   AND brand_id IS NULL) OR
  (linked_entity_type = 'event'         AND event_id   IS NOT NULL AND session_id IS NULL   AND brand_id IS NULL) OR
  (linked_entity_type = 'support'       AND session_id IS NULL     AND event_id IS NULL     AND brand_id IS NULL) OR
  (linked_entity_type = 'brand'         AND brand_id   IS NOT NULL AND session_id IS NULL   AND event_id IS NULL) OR
  (linked_entity_type = 'brand_enquiry' AND brand_id   IS NOT NULL AND session_id IS NULL   AND event_id IS NULL) OR
  (linked_entity_type = 'brand_guests'  AND brand_id   IS NOT NULL AND session_id IS NULL   AND event_id IS NULL
     AND type = 'group' AND program_kind IS NULL)
);

-- INVARIANT issue-4459-brand-guests: one brand_guests conversation per brand.
CREATE UNIQUE INDEX IF NOT EXISTS conversations_unique_brand_guests
  ON public.conversations(brand_id)
  WHERE linked_entity_type = 'brand_guests';

-- ── 2. Sticky leave and removal ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.brand_guest_chat_exclusions (
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reason text NOT NULL CHECK (reason IN ('left', 'removed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  -- A removed guest's "Remove from chat list" (design v2): the Removed row is
  -- no longer listed. The removal itself stays.
  dismissed_at timestamptz,
  PRIMARY KEY (brand_id, user_id)
);
CREATE INDEX IF NOT EXISTS brand_guest_chat_exclusions_user_idx
  ON public.brand_guest_chat_exclusions(user_id);
CREATE INDEX IF NOT EXISTS brand_guest_chat_exclusions_created_by_idx
  ON public.brand_guest_chat_exclusions(created_by);
ALTER TABLE public.brand_guest_chat_exclusions ENABLE ROW LEVEL SECURITY;
-- No client policies: read and written only through the issue_4459_* RPCs.
REVOKE ALL ON TABLE public.brand_guest_chat_exclusions FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.brand_guest_chat_exclusions TO service_role;

-- Who on the team wrote a brand post. Brand posts store sender_id NULL; this
-- table is the only place the author lives, and only the brand team reads it.
CREATE TABLE IF NOT EXISTS public.brand_guest_post_authors (
  message_id uuid PRIMARY KEY REFERENCES public.messages(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  author_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS brand_guest_post_authors_conversation_idx
  ON public.brand_guest_post_authors(conversation_id);
CREATE INDEX IF NOT EXISTS brand_guest_post_authors_author_idx
  ON public.brand_guest_post_authors(author_id);
ALTER TABLE public.brand_guest_post_authors ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.brand_guest_post_authors FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.brand_guest_post_authors TO authenticated;
GRANT ALL ON TABLE public.brand_guest_post_authors TO service_role;

-- ── 3. Helpers ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.issue_4459_is_brand_guests_conversation(p_conversation_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.conversations c
     WHERE c.id = p_conversation_id AND c.linked_entity_type = 'brand_guests'
  );
$function$;
REVOKE ALL ON FUNCTION public.issue_4459_is_brand_guests_conversation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_4459_is_brand_guests_conversation(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.issue_4459_is_brand_team(p_brand_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT p_brand_id IS NOT NULL AND p_user_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.brand_team_members m
     WHERE m.brand_id = p_brand_id AND m.user_id = p_user_id
       AND m.accepted_at IS NOT NULL AND m.removed_at IS NULL
  );
$function$;
REVOKE ALL ON FUNCTION public.issue_4459_is_brand_team(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4459_is_brand_team(uuid, uuid) TO service_role;

-- Team rights in a Guest chat. Deliberately NOT is_conversation_brand_team_member
-- (that one is joined through events and serves the per-listing chats).
CREATE OR REPLACE FUNCTION public.issue_4459_is_brand_guest_team(p_conversation_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.conversations c
      JOIN public.brand_team_members m ON m.brand_id = c.brand_id
     WHERE c.id = p_conversation_id AND c.linked_entity_type = 'brand_guests'
       AND m.user_id = p_user_id AND m.accepted_at IS NOT NULL AND m.removed_at IS NULL
  );
$function$;
REVOKE ALL ON FUNCTION public.issue_4459_is_brand_guest_team(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_4459_is_brand_guest_team(uuid, uuid) TO authenticated, service_role;

-- Eligibility, from the source rows only (past events count; a deleted listing
-- does not). (d) is the email-claim rail: a guest checkout claimed through
-- claim-pending-trip-chat-participation on a still-paid order.
CREATE OR REPLACE FUNCTION public.issue_4459_brand_guest_eligible(p_brand_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT p_brand_id IS NOT NULL AND p_user_id IS NOT NULL AND (
    EXISTS (
      SELECT 1 FROM public.orders o JOIN public.events e ON e.id = o.event_id
       WHERE e.brand_id = p_brand_id AND e.deleted_at IS NULL
         AND o.buyer_user_id = p_user_id
         AND o.payment_status IN ('paid', 'partial_refund')
    ) OR EXISTS (
      SELECT 1 FROM public.event_rsvps r JOIN public.events e ON e.id = r.event_id
       WHERE e.brand_id = p_brand_id AND e.deleted_at IS NULL
         AND r.user_id = p_user_id
         AND r.rsvp_status = 'going' AND r.approval_status = 'approved'
    ) OR EXISTS (
      SELECT 1 FROM public.event_rsvp_guests g
        JOIN public.event_rsvps r ON r.id = g.rsvp_id
        JOIN public.events e ON e.id = r.event_id
       WHERE e.brand_id = p_brand_id AND e.deleted_at IS NULL
         AND g.matched_user_id = p_user_id
         AND r.rsvp_status = 'going' AND r.approval_status = 'approved'
    ) OR EXISTS (
      SELECT 1 FROM public.pending_trip_chat_claims pc
        JOIN public.orders o ON o.id = pc.order_id
        JOIN public.events e ON e.id = pc.event_id
       WHERE e.brand_id = p_brand_id AND e.deleted_at IS NULL
         AND pc.claimed_by_user_id = p_user_id AND pc.claimed_at IS NOT NULL
         AND o.payment_status IN ('paid', 'partial_refund')
    )
  );
$function$;
REVOKE ALL ON FUNCTION public.issue_4459_brand_guest_eligible(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4459_brand_guest_eligible(uuid, uuid) TO service_role;

-- The brand's Guest chat: created on first need, named after the brand,
-- disabled while the brand is deleted, with the accepted team mirrored in.
CREATE OR REPLACE FUNCTION public.issue_4459_ensure_brand_guest_chat(p_brand_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_brand public.brands%ROWTYPE;
  v_conversation_id uuid;
BEGIN
  SELECT * INTO v_brand FROM public.brands WHERE id = p_brand_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  INSERT INTO public.conversations(
    type, linked_entity_type, brand_id, name, created_by, is_enabled, is_broadcast_only
  ) VALUES (
    'group', 'brand_guests', v_brand.id,
    COALESCE(NULLIF(btrim(v_brand.name), ''), 'Guests'),
    NULL, v_brand.deleted_at IS NULL, false
  )
  ON CONFLICT (brand_id) WHERE linked_entity_type = 'brand_guests'
  DO UPDATE SET
    name = EXCLUDED.name,
    is_enabled = EXCLUDED.is_enabled,
    updated_at = now()
  WHERE public.conversations.name IS DISTINCT FROM EXCLUDED.name
     OR public.conversations.is_enabled IS DISTINCT FROM EXCLUDED.is_enabled
  RETURNING id INTO v_conversation_id;

  IF v_conversation_id IS NULL THEN
    SELECT id INTO v_conversation_id FROM public.conversations
     WHERE brand_id = p_brand_id AND linked_entity_type = 'brand_guests';
  END IF;

  INSERT INTO public.conversation_participants(conversation_id, user_id)
  SELECT v_conversation_id, m.user_id
    FROM public.brand_team_members m
   WHERE m.brand_id = p_brand_id AND m.accepted_at IS NOT NULL AND m.removed_at IS NULL
   ORDER BY m.user_id
  ON CONFLICT (conversation_id, user_id) DO NOTHING;

  RETURN v_conversation_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4459_ensure_brand_guest_chat(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4459_ensure_brand_guest_chat(uuid) TO service_role;

-- The one helper every rail calls. Idempotent. Returns the person's status.
CREATE OR REPLACE FUNCTION public.issue_4459_sync_brand_guest(p_brand_id uuid, p_user_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_conversation_id uuid;
BEGIN
  IF p_brand_id IS NULL OR p_user_id IS NULL THEN RETURN 'not_eligible'; END IF;
  v_conversation_id := public.issue_4459_ensure_brand_guest_chat(p_brand_id);
  IF v_conversation_id IS NULL THEN RETURN 'not_eligible'; END IF;

  -- Team membership comes from the team mirror (ensure, above).
  IF public.issue_4459_is_brand_team(p_brand_id, p_user_id) THEN
    RETURN 'member';
  END IF;

  IF public.issue_4459_brand_guest_eligible(p_brand_id, p_user_id)
     AND NOT EXISTS (
       SELECT 1 FROM public.brand_guest_chat_exclusions x
        WHERE x.brand_id = p_brand_id AND x.user_id = p_user_id
     ) THEN
    INSERT INTO public.conversation_participants(conversation_id, user_id)
    VALUES (v_conversation_id, p_user_id)
    ON CONFLICT (conversation_id, user_id) DO NOTHING;
    RETURN 'member';
  END IF;

  DELETE FROM public.conversation_participants
   WHERE conversation_id = v_conversation_id AND user_id = p_user_id;
  RETURN COALESCE(
    (SELECT x.reason FROM public.brand_guest_chat_exclusions x
      WHERE x.brand_id = p_brand_id AND x.user_id = p_user_id),
    'not_eligible');
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4459_sync_brand_guest(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4459_sync_brand_guest(uuid, uuid) TO service_role;

-- Triggers never fail the booking write: an unexpected error is logged as a
-- warning (Postgres log, SQLSTATE and context only, no personal data) and the
-- source write commits.
CREATE OR REPLACE FUNCTION public.issue_4459_safe_sync(p_brand_id uuid, p_user_id uuid, p_source text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF p_brand_id IS NULL OR p_user_id IS NULL THEN RETURN; END IF;
  BEGIN
    PERFORM public.issue_4459_sync_brand_guest(p_brand_id, p_user_id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[issue_4459] brand guest chat sync failed source=% sqlstate=% brand=%',
      p_source, SQLSTATE, p_brand_id;
  END;
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4459_safe_sync(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4459_safe_sync(uuid, uuid, text) TO service_role;

-- ── 4. Source-table triggers ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.issue_4459_tg_event_rsvps()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    PERFORM public.issue_4459_safe_sync(
      (SELECT e.brand_id FROM public.events e WHERE e.id = OLD.event_id), OLD.user_id, 'rsvp');
    PERFORM public.issue_4459_safe_sync(
      (SELECT e.brand_id FROM public.events e WHERE e.id = OLD.event_id), g.matched_user_id, 'rsvp_party')
      FROM public.event_rsvp_guests g WHERE g.rsvp_id = OLD.id AND g.matched_user_id IS NOT NULL;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    PERFORM public.issue_4459_safe_sync(
      (SELECT e.brand_id FROM public.events e WHERE e.id = NEW.event_id), NEW.user_id, 'rsvp');
    IF TG_OP = 'UPDATE' THEN
      PERFORM public.issue_4459_safe_sync(
        (SELECT e.brand_id FROM public.events e WHERE e.id = NEW.event_id), g.matched_user_id, 'rsvp_party')
        FROM public.event_rsvp_guests g WHERE g.rsvp_id = NEW.id AND g.matched_user_id IS NOT NULL;
    END IF;
  END IF;
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4459_tg_event_rsvps() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS issue_4459_brand_guest_chat_rsvp ON public.event_rsvps;
CREATE TRIGGER issue_4459_brand_guest_chat_rsvp
AFTER INSERT OR UPDATE OF rsvp_status, approval_status, user_id, event_id OR DELETE
ON public.event_rsvps
FOR EACH ROW EXECUTE FUNCTION public.issue_4459_tg_event_rsvps();

CREATE OR REPLACE FUNCTION public.issue_4459_tg_event_rsvp_guests()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.matched_user_id IS NOT NULL THEN
    PERFORM public.issue_4459_safe_sync(
      (SELECT e.brand_id FROM public.event_rsvps r JOIN public.events e ON e.id = r.event_id WHERE r.id = OLD.rsvp_id),
      OLD.matched_user_id, 'rsvp_party');
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.matched_user_id IS NOT NULL THEN
    PERFORM public.issue_4459_safe_sync(
      (SELECT e.brand_id FROM public.event_rsvps r JOIN public.events e ON e.id = r.event_id WHERE r.id = NEW.rsvp_id),
      NEW.matched_user_id, 'rsvp_party');
  END IF;
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4459_tg_event_rsvp_guests() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS issue_4459_brand_guest_chat_rsvp_party ON public.event_rsvp_guests;
CREATE TRIGGER issue_4459_brand_guest_chat_rsvp_party
AFTER INSERT OR UPDATE OF matched_user_id, rsvp_id OR DELETE
ON public.event_rsvp_guests
FOR EACH ROW EXECUTE FUNCTION public.issue_4459_tg_event_rsvp_guests();

CREATE OR REPLACE FUNCTION public.issue_4459_tg_orders()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.buyer_user_id IS NOT NULL THEN
    PERFORM public.issue_4459_safe_sync(
      (SELECT e.brand_id FROM public.events e WHERE e.id = OLD.event_id), OLD.buyer_user_id, 'order');
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.buyer_user_id IS NOT NULL THEN
    PERFORM public.issue_4459_safe_sync(
      (SELECT e.brand_id FROM public.events e WHERE e.id = NEW.event_id), NEW.buyer_user_id, 'order');
  END IF;
  -- An email-claimed guest checkout (pending_trip_chat_claims) follows its order.
  IF TG_OP = 'UPDATE' THEN
    PERFORM public.issue_4459_safe_sync(
      (SELECT e.brand_id FROM public.events e WHERE e.id = NEW.event_id), pc.claimed_by_user_id, 'order_claim')
      FROM public.pending_trip_chat_claims pc
     WHERE pc.order_id = NEW.id AND pc.claimed_by_user_id IS NOT NULL
       AND pc.claimed_by_user_id IS DISTINCT FROM NEW.buyer_user_id;
  END IF;
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4459_tg_orders() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS issue_4459_brand_guest_chat_order ON public.orders;
CREATE TRIGGER issue_4459_brand_guest_chat_order
AFTER INSERT OR UPDATE OF payment_status, buyer_user_id, event_id OR DELETE
ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.issue_4459_tg_orders();

CREATE OR REPLACE FUNCTION public.issue_4459_tg_pending_chat_claims()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NEW.claimed_by_user_id IS NOT NULL THEN
    PERFORM public.issue_4459_safe_sync(
      (SELECT e.brand_id FROM public.events e WHERE e.id = NEW.event_id), NEW.claimed_by_user_id, 'chat_claim');
  END IF;
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4459_tg_pending_chat_claims() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS issue_4459_brand_guest_chat_claim ON public.pending_trip_chat_claims;
CREATE TRIGGER issue_4459_brand_guest_chat_claim
AFTER UPDATE OF claimed_by_user_id, claimed_at ON public.pending_trip_chat_claims
FOR EACH ROW EXECUTE FUNCTION public.issue_4459_tg_pending_chat_claims();

-- Brand rename / soft delete renames or disables the chat.
CREATE OR REPLACE FUNCTION public.issue_4459_tg_brands()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  BEGIN
    PERFORM public.issue_4459_ensure_brand_guest_chat(NEW.id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[issue_4459] brand guest chat ensure failed sqlstate=% brand=%', SQLSTATE, NEW.id;
  END;
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4459_tg_brands() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS issue_4459_brand_guest_chat_brand ON public.brands;
CREATE TRIGGER issue_4459_brand_guest_chat_brand
AFTER INSERT OR UPDATE OF name, deleted_at ON public.brands
FOR EACH ROW EXECUTE FUNCTION public.issue_4459_tg_brands();

-- The team mirror: joining the team adds; leaving the team removes, unless
-- the person holds their own booking (then they stay as a guest).
CREATE OR REPLACE FUNCTION public.issue_4459_tg_brand_team()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    PERFORM public.issue_4459_safe_sync(OLD.brand_id, OLD.user_id, 'team');
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    PERFORM public.issue_4459_safe_sync(NEW.brand_id, NEW.user_id, 'team');
  END IF;
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4459_tg_brand_team() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS issue_4459_brand_guest_chat_team ON public.brand_team_members;
CREATE TRIGGER issue_4459_brand_guest_chat_team
AFTER INSERT OR UPDATE OF accepted_at, removed_at, user_id, brand_id OR DELETE
ON public.brand_team_members
FOR EACH ROW EXECUTE FUNCTION public.issue_4459_tg_brand_team();

-- ── 5. History from join time (backfilled guests see everything) ────────────
-- A sibling BEFORE INSERT trigger, not an edit of tg_4261_set_history_visible_from
-- (several lane suites re-apply the #4261 / #4435 migrations that own that
-- body). Triggers fire by name, so tg_4459_* runs after tg_4261_* and wins for
-- brand_guests rows only.
CREATE OR REPLACE FUNCTION public.issue_4459_tg_guest_history_from()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF public.issue_4459_is_brand_guests_conversation(NEW.conversation_id) THEN
    IF COALESCE(current_setting('issue_4459.backfill', true), '') = 'on' THEN
      NEW.history_visible_from := NULL;
    ELSE
      NEW.history_visible_from := COALESCE(NEW.joined_at, now());
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4459_tg_guest_history_from() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS tg_4459_guest_history_from ON public.conversation_participants;
CREATE TRIGGER tg_4459_guest_history_from
BEFORE INSERT ON public.conversation_participants
FOR EACH ROW EXECUTE FUNCTION public.issue_4459_tg_guest_history_from();

-- Membership rows of a Guest chat never move between chats or people.
CREATE OR REPLACE FUNCTION public.issue_4459_tg_participant_identity_guard()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF (NEW.conversation_id IS DISTINCT FROM OLD.conversation_id
      OR NEW.user_id IS DISTINCT FROM OLD.user_id)
     AND (public.issue_4459_is_brand_guests_conversation(OLD.conversation_id)
          OR public.issue_4459_is_brand_guests_conversation(NEW.conversation_id)) THEN
    RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4459_tg_participant_identity_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS issue_4459_participant_identity_guard ON public.conversation_participants;
CREATE TRIGGER issue_4459_participant_identity_guard
BEFORE UPDATE OF conversation_id, user_id ON public.conversation_participants
FOR EACH ROW EXECUTE FUNCTION public.issue_4459_tg_participant_identity_guard();

-- ── 6. RLS: RPC-only writes and roster privacy ──────────────────────────────
DROP POLICY IF EXISTS conversations_brand_guests_rpc_only ON public.conversations;
CREATE POLICY conversations_brand_guests_rpc_only ON public.conversations
  AS RESTRICTIVE FOR INSERT
  WITH CHECK (linked_entity_type IS DISTINCT FROM 'brand_guests');

DROP POLICY IF EXISTS conversations_brand_guests_no_client_update ON public.conversations;
CREATE POLICY conversations_brand_guests_no_client_update ON public.conversations
  AS RESTRICTIVE FOR UPDATE
  USING (linked_entity_type IS DISTINCT FROM 'brand_guests')
  WITH CHECK (linked_entity_type IS DISTINCT FROM 'brand_guests');

DROP POLICY IF EXISTS conversation_participants_brand_guests_rpc_only_insert ON public.conversation_participants;
CREATE POLICY conversation_participants_brand_guests_rpc_only_insert ON public.conversation_participants
  AS RESTRICTIVE FOR INSERT
  WITH CHECK (NOT public.issue_4459_is_brand_guests_conversation(conversation_id));

DROP POLICY IF EXISTS conversation_participants_brand_guests_rpc_only_delete ON public.conversation_participants;
CREATE POLICY conversation_participants_brand_guests_rpc_only_delete ON public.conversation_participants
  AS RESTRICTIVE FOR DELETE
  USING (NOT public.issue_4459_is_brand_guests_conversation(conversation_id));

-- A guest reads only their own row and the brand team's rows; the team reads all.
DROP POLICY IF EXISTS conversation_participants_brand_guests_roster ON public.conversation_participants;
CREATE POLICY conversation_participants_brand_guests_roster ON public.conversation_participants
  AS RESTRICTIVE FOR SELECT
  USING (
    NOT public.issue_4459_is_brand_guests_conversation(conversation_id)
    OR user_id = (SELECT auth.uid())
    OR public.issue_4459_is_brand_guest_team(conversation_id, (SELECT auth.uid()))
    OR public.issue_4459_is_brand_guest_team(conversation_id, user_id)
  );

DROP POLICY IF EXISTS brand_guest_post_authors_team_read ON public.brand_guest_post_authors;
CREATE POLICY brand_guest_post_authors_team_read ON public.brand_guest_post_authors
  FOR SELECT TO authenticated
  USING (public.issue_4459_is_brand_guest_team(conversation_id, (SELECT auth.uid())));

DROP POLICY IF EXISTS messages_brand_guests_rpc_only ON public.messages;
CREATE POLICY messages_brand_guests_rpc_only ON public.messages
  AS RESTRICTIVE FOR INSERT
  WITH CHECK (NOT public.issue_4459_is_brand_guests_conversation(conversation_id));

-- ── 7. The booking rails ────────────────────────────────────────────────────
-- add_buyer_to_event_chat keeps its signature (5 rails call it) and now lands
-- every listing type (event, trip, experience, RSVP) in the brand's Guest
-- chat. The per-listing find-or-create is gone. A buyer without an account
-- still gets a pending chat claim, now for every listing type.
CREATE OR REPLACE FUNCTION public.add_buyer_to_event_chat(
  p_event_id uuid,
  p_buyer_user_id uuid,
  p_order_id uuid,
  p_buyer_email text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_brand_id uuid;
  v_claim_token text;
  v_user uuid;
BEGIN
  SELECT e.brand_id INTO v_brand_id FROM public.events e WHERE e.id = p_event_id;
  IF v_brand_id IS NULL THEN RETURN; END IF;

  IF p_order_id IS NOT NULL THEN
    SELECT buyer_user_id INTO v_user
      FROM public.orders
     WHERE id = p_order_id;
    IF NOT FOUND THEN v_user := p_buyer_user_id; END IF;
  ELSE
    v_user := p_buyer_user_id;
  END IF;

  IF v_user IS NOT NULL THEN
    -- #4459: never fails the booking (safe_sync logs and returns).
    PERFORM public.issue_4459_safe_sync(v_brand_id, v_user, 'add_buyer');
    RETURN;
  END IF;

  IF p_buyer_email IS NOT NULL AND length(trim(p_buyer_email)) > 0 THEN
    v_claim_token := translate(
      encode(extensions.gen_random_bytes(24), 'base64'), '+/', '-_'
    );
    INSERT INTO public.pending_trip_chat_claims (
      order_id, event_id, buyer_email, claim_token
    ) VALUES (
      p_order_id, p_event_id, lower(trim(p_buyer_email)), v_claim_token
    )
    ON CONFLICT (order_id) WHERE claimed_at IS NULL DO NOTHING;
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.add_buyer_to_event_chat(uuid, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.add_buyer_to_event_chat(uuid, uuid, uuid, text)
  TO service_role;

-- Per-listing chats are retired: none are created for new listings.
DROP TRIGGER IF EXISTS ensure_group_conversation_on_event_create ON public.events;
DROP FUNCTION IF EXISTS public.ensure_group_conversation_on_event_create();

-- The claim rails report the brand Guest chat (unchanged apart from the
-- conversation lookup).
CREATE OR REPLACE FUNCTION public.claim_attendance_internal_v2(p_user_id uuid, p_kind text, p_event_id uuid, p_source_id uuid, p_current_proof_digest bytea, p_legacy_proof_digest bytea DEFAULT NULL::bytea)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_event public.events%ROWTYPE;
  v_owner uuid;
  v_current bytea;
  v_legacy bytea;
  v_generation text;
  v_eligible boolean := false;
  v_current_match boolean := false;
  v_legacy_match boolean := false;
  v_resolved text;
  v_minted_at timestamptz;
  v_buyer_email text;
  v_buyer_phone text;
  v_channel text;
  v_masked text;
  v_conv uuid;
BEGIN
  IF p_user_id IS NULL OR p_event_id IS NULL OR p_source_id IS NULL
     OR p_current_proof_digest IS NULL
     OR octet_length(p_current_proof_digest) <> 32
     OR (p_legacy_proof_digest IS NOT NULL
       AND octet_length(p_legacy_proof_digest) <> 32)
     OR p_kind NOT IN ('rsvp', 'order') THEN
    RAISE EXCEPTION 'invalid_claim';
  END IF;

  SELECT e.* INTO v_event
    FROM public.events e JOIN public.brands b ON b.id = e.brand_id
   WHERE e.id = p_event_id AND e.deleted_at IS NULL
     AND b.deleted_at IS NULL AND e.status IN ('scheduled', 'live');
  IF NOT FOUND THEN RETURN jsonb_build_object('result', 'ineligible'); END IF;
  IF (p_kind = 'rsvp' AND v_event.event_type <> 'rsvp')
     OR (p_kind = 'order'
       AND v_event.event_type NOT IN ('event', 'trip', 'experience')) THEN
    RETURN jsonb_build_object('result', 'invalid');
  END IF;

  IF p_kind = 'rsvp' THEN
    SELECT r.user_id,
           CASE WHEN r.pass_recovery_token_hash ~ '^[0-9a-fA-F]{64}$'
             THEN decode(r.pass_recovery_token_hash, 'hex') END,
           r.rsvp_status = 'going' AND r.approval_status = 'approved',
           r.guest_email, r.guest_phone
      INTO v_owner, v_current, v_eligible, v_buyer_email, v_buyer_phone
      FROM public.event_rsvps r
     WHERE r.id = p_source_id AND r.event_id = p_event_id FOR UPDATE;
  ELSE
    SELECT o.buyer_user_id, o.attendance_claim_token_digest,
           o.attendance_claim_legacy_token_digest,
           o.attendance_claim_token_generation,
           o.payment_status IN ('paid', 'partial_refund') AND EXISTS (
             SELECT 1 FROM public.tickets t
              WHERE t.order_id = o.id
                AND t.approval_status IN ('auto', 'approved')
                AND ((v_event.status = 'scheduled' AND t.status = 'valid')
                  OR (v_event.status = 'live'
                    AND t.status IN ('valid', 'used')))
           ),
           coalesce(o.attendance_claim_token_created_at,
                    o.attendance_claim_legacy_token_created_at),
           o.buyer_email, o.buyer_phone_e164
      INTO v_owner, v_current, v_legacy, v_generation, v_eligible,
           v_minted_at, v_buyer_email, v_buyer_phone
      FROM public.orders o
     WHERE o.id = p_source_id AND o.event_id = p_event_id FOR UPDATE;
  END IF;

  IF NOT FOUND THEN RETURN jsonb_build_object('result', 'invalid'); END IF;
  IF v_owner = p_user_id THEN
    RETURN jsonb_build_object('result', 'invalid');
  END IF;
  IF v_owner IS NOT NULL THEN RETURN jsonb_build_object('result', 'conflict'); END IF;
  IF p_kind = 'order' AND v_legacy IS NOT NULL
     AND p_legacy_proof_digest IS NULL THEN
    RETURN jsonb_build_object('result', 'secret_unavailable');
  END IF;

  v_current_match := v_current IS NOT NULL
    AND CASE
      -- Pre-governance orders keep their legacy proof in the active slot. Once
      -- the governed reader is live, the Edge function supplies that proof in
      -- the legacy argument rather than the governed/current argument.
      WHEN p_kind = 'order' AND v_generation = 'legacy_v1' THEN
        p_legacy_proof_digest IS NOT NULL
          AND public.fixed_digest_equal(v_current, p_legacy_proof_digest)
      ELSE public.fixed_digest_equal(v_current, p_current_proof_digest)
    END;
  v_legacy_match := v_legacy IS NOT NULL
    AND p_legacy_proof_digest IS NOT NULL
    AND public.fixed_digest_equal(v_legacy, p_legacy_proof_digest);
  IF NOT v_current_match AND NOT v_legacy_match THEN
    RETURN jsonb_build_object('result', 'invalid');
  END IF;

  -- #3524 — THE EXPIRY. Order arm only. A token with no recorded mint time
  -- cannot be aged and is not expired; every token minted by
  -- `issue_order_attendance_claim_proof_v2` records one.
  IF p_kind = 'order' AND v_minted_at IS NOT NULL
     AND v_minted_at < now() - public.attendance_claim_token_ttl() THEN
    RETURN jsonb_build_object('result', 'expired');
  END IF;

  IF NOT v_eligible THEN RETURN jsonb_build_object('result', 'ineligible'); END IF;

  -- Preserve the established RSVP duplicate-owner contract before asking
  -- whether this account owns the guest contact. A claimant who already owns
  -- another RSVP for this event can never take this row; returning conflict
  -- here keeps the refusal deterministic while still validating the proof,
  -- event, source, and eligibility first.
  IF p_kind = 'rsvp' AND EXISTS (
    SELECT 1 FROM public.event_rsvps other
     WHERE other.event_id = p_event_id AND other.user_id = p_user_id
       AND other.id <> p_source_id
  ) THEN RETURN jsonb_build_object('result', 'conflict'); END IF;

  -- #4063: both order and RSVP links use the single raw-contact predicate.
  -- A refusal returns before any owner, token, delivery, or chat write.
  IF NOT public.account_owns_contact(
       p_user_id, v_buyer_email, v_buyer_phone
     ) THEN
    IF btrim(coalesce(v_buyer_email, '')) <> '' THEN
      v_channel := 'email';
      v_masked := public.mask_contact_for_claim(v_buyer_email, 'email');
    ELSIF coalesce(v_buyer_phone, '') ~ '^\+[1-9][0-9]{1,14}$' THEN
      v_channel := 'phone';
      v_masked := public.mask_contact_for_claim(v_buyer_phone, 'phone');
    END IF;
    -- Email only: a matching account address gets the actionable
    -- contact_unproved result. Phone contacts keep identity_mismatch because a
    -- genuine owner already passes one of the two received-code proof arms.
    IF v_channel = 'email'
       AND public.account_carries_email(p_user_id, v_buyer_email) THEN
      RETURN jsonb_build_object(
        'result', 'contact_unproved',
        'contactMasked', v_masked,
        'contactChannel', v_channel);
    END IF;
    RETURN jsonb_build_object(
      'result', 'identity_mismatch',
      'contactMasked', v_masked,
      'contactChannel', v_channel);
  END IF;

  IF p_kind = 'rsvp' THEN
    UPDATE public.event_rsvps SET user_id = p_user_id WHERE id = p_source_id;
    RETURN jsonb_build_object('result', 'claimed', 'eventId', p_event_id);
  END IF;

  v_resolved := CASE
    WHEN v_current_match AND v_generation = 'governed_v2'
      THEN 'governed_token'
    WHEN v_legacy_match THEN 'legacy_token'
    ELSE 'legacy_token' END;
  UPDATE public.orders
     SET buyer_user_id = p_user_id,
         attendance_claim_token_digest = NULL,
         attendance_claim_token_generation = NULL,
         attendance_claim_legacy_token_digest = NULL,
         attendance_claim_legacy_token_created_at = NULL,
         attendance_claim_token_consumed_at = now()
   WHERE id = p_source_id;
  UPDATE public.attendance_claim_recovery_items
     SET state = 'claimed', resolved_via = v_resolved,
         reconciled_at = now(), updated_at = now()
   WHERE order_id = p_source_id;
  UPDATE public.attendance_claim_deliveries
     SET status = 'failed_terminal', next_attempt_at = NULL,
         lease_id = NULL, lease_expires_at = NULL,
         provider_attempt_started_at = NULL,
         last_error_code = 'claim_resolved', updated_at = now()
   WHERE source_id = p_source_id
     AND kind IN ('order_recovery_email', 'order_recovery_sms')
     AND status IN ('pending', 'processing', 'failed_retryable');

  -- #3524 F-7 — the group chat is the second half of what the buyer was
  -- promised. Reuse the SAME helper the identity rail and the paid finalize
  -- path use, never a second writer. It returns silently when the event type
  -- has no chat (an `experience` legitimately has none), which is why the
  -- caller reads the membership back below instead of assuming it.
  PERFORM public.add_buyer_to_event_chat(p_event_id, p_user_id, p_source_id, NULL);
  UPDATE public.pending_trip_chat_claims
     SET claimed_at = now(), claimed_by_user_id = p_user_id
   WHERE order_id = p_source_id AND claimed_at IS NULL;

  SELECT c.id INTO v_conv
    FROM public.conversations c
    JOIN public.conversation_participants cp
      ON cp.conversation_id = c.id AND cp.user_id = p_user_id
   WHERE c.linked_entity_type = 'brand_guests'
     AND c.brand_id = (SELECT e4459.brand_id FROM public.events e4459 WHERE e4459.id = p_event_id)
   LIMIT 1;

  RETURN jsonb_build_object(
    'result', 'claimed',
    'eventId', p_event_id,
    'chatJoined', v_conv IS NOT NULL,
    'conversationId', v_conv);
END;
$function$;

CREATE OR REPLACE FUNCTION public.claim_attendance_by_verified_identity(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_emails text[];
  v_phones text[];
  v_row record;
  v_claimed jsonb := '[]'::jsonb;
  v_conv uuid;
  v_more boolean := false;
  v_pass_count integer;
BEGIN
  IF p_user_id IS NULL THEN RAISE EXCEPTION 'invalid_claim'; END IF;

  SELECT
    coalesce(array_agg(DISTINCT value) FILTER (WHERE kind = 'email'), '{}'::text[]),
    coalesce(array_agg(DISTINCT value) FILTER (WHERE kind = 'phone'), '{}'::text[])
    INTO v_emails, v_phones
    FROM (
      SELECT kind, value
        FROM public.verified_account_identifiers(p_user_id)
      UNION
      SELECT 'phone'::text, phone_e164
        FROM public.verified_phone_identities
       WHERE user_id = p_user_id
      UNION
      SELECT channel, value
        FROM public.account_claim_contacts
       WHERE user_id = p_user_id AND revoked_at IS NULL
    ) identifiers;

  IF coalesce(array_length(v_emails, 1), 0) = 0
     AND coalesce(array_length(v_phones, 1), 0) = 0 THEN
    RETURN jsonb_build_object(
      'claimed', v_claimed, 'count', 0, 'more', false
    );
  END IF;

  -- Orders, including used door receipts on recently ended events.
  v_pass_count := 0;
  FOR v_row IN
    SELECT o.id, o.event_id, o.source, o.door_payment_method, e.event_type, e.title,
           coalesce(o.booked_start_at, chosen.start_at, master.start_at) AS starts_at,
           coalesce(chosen.timezone, master.timezone, e.timezone) AS timezone,
           (SELECT count(*)::integer FROM public.tickets t
             WHERE t.order_id = o.id AND t.status IN ('valid', 'used')) AS quantity
      FROM public.orders o
      JOIN public.events e ON e.id = o.event_id
      JOIN public.brands b ON b.id = e.brand_id
      LEFT JOIN public.event_dates chosen ON chosen.id = o.event_date_id
      LEFT JOIN LATERAL (
        SELECT d.start_at, d.timezone
          FROM public.event_dates d
         WHERE d.event_id = e.id AND d.is_master IS TRUE
         ORDER BY d.start_at, d.id LIMIT 1
      ) master ON true
     WHERE o.buyer_user_id IS NULL
       AND o.attendance_identity_claim_armed_at IS NOT NULL
       AND (lower(btrim(o.buyer_email)) = ANY(v_emails)
         OR o.buyer_phone_e164 = ANY(v_phones))
       AND public.account_owns_contact(
         p_user_id, o.buyer_email, o.buyer_phone_e164
       )
       AND o.payment_status IN ('paid', 'partial_refund')
       AND e.event_type IN ('event', 'trip', 'experience')
       AND e.deleted_at IS NULL AND b.deleted_at IS NULL
       AND (
         (public.issue_4271_is_door_order(o.source, o.door_payment_method)
           AND e.status IN ('scheduled', 'live', 'ended')
           AND o.created_at >= now() - interval '30 days')
         OR
         (NOT public.issue_4271_is_door_order(o.source, o.door_payment_method)
           AND e.status IN ('scheduled', 'live')
           AND EXISTS (
             SELECT 1 FROM public.tickets t
              WHERE t.order_id = o.id
                AND t.approval_status IN ('auto', 'approved')
                AND ((e.status = 'scheduled' AND t.status = 'valid')
                  OR (e.status = 'live' AND t.status IN ('valid', 'used')))
           ))
       )
     ORDER BY o.created_at, o.id
     LIMIT 25
     FOR UPDATE OF o SKIP LOCKED
  LOOP
    UPDATE public.orders o
       SET buyer_user_id = p_user_id,
           attendance_claim_token_digest = NULL,
           attendance_claim_token_generation = NULL,
           attendance_claim_legacy_token_digest = NULL,
           attendance_claim_legacy_token_created_at = NULL,
           attendance_claim_token_consumed_at = CASE
             WHEN o.attendance_claim_token_created_at IS NOT NULL
               THEN coalesce(o.attendance_claim_token_consumed_at, now())
             ELSE o.attendance_claim_token_consumed_at END
     WHERE o.id = v_row.id AND o.buyer_user_id IS NULL;
    IF NOT FOUND THEN CONTINUE; END IF;
    v_pass_count := v_pass_count + 1;

    UPDATE public.attendance_claim_recovery_items
       SET state = 'claimed', resolved_via = 'verified_identity',
           reconciled_at = now(), updated_at = now()
     WHERE order_id = v_row.id;
    UPDATE public.attendance_claim_deliveries
       SET status = 'failed_terminal', next_attempt_at = NULL,
           lease_id = NULL, lease_expires_at = NULL,
           provider_attempt_started_at = NULL,
           last_error_code = 'claim_resolved', updated_at = now()
     WHERE source_id = v_row.id
       AND kind IN ('order_recovery_email', 'order_recovery_sms')
       AND status IN ('pending', 'processing', 'failed_retryable');
    PERFORM public.add_buyer_to_event_chat(
      v_row.event_id, p_user_id, v_row.id, NULL
    );
    UPDATE public.pending_trip_chat_claims
       SET claimed_at = now(), claimed_by_user_id = p_user_id
     WHERE order_id = v_row.id AND claimed_at IS NULL;

    v_conv := NULL;
    SELECT c.id INTO v_conv
      FROM public.conversations c
      JOIN public.conversation_participants cp
        ON cp.conversation_id = c.id AND cp.user_id = p_user_id
     WHERE c.linked_entity_type = 'brand_guests'
       AND c.brand_id = (SELECT e4459.brand_id FROM public.events e4459 WHERE e4459.id = v_row.event_id)
     LIMIT 1;

    v_claimed := v_claimed || jsonb_build_array(jsonb_build_object(
      'kind', 'order', 'id', v_row.id,
      'orderId', v_row.id, 'eventId', v_row.event_id,
      'routeKind', 'order', 'routeId', v_row.id,
      'offeringType', v_row.event_type,
      'noun', CASE
        WHEN public.issue_4271_is_door_order(v_row.source, v_row.door_payment_method)
          THEN 'receipt'
        WHEN v_row.event_type = 'event' THEN 'ticket'
        ELSE 'booking' END,
      'title', v_row.title, 'orderLabel', NULL,
      'startsAt', v_row.starts_at, 'timezone', v_row.timezone,
      'venueLine', NULL, 'quantity', v_row.quantity,
      'source', CASE
        WHEN v_row.source = 'comp'
          OR public.issue_4271_is_door_order(v_row.source, v_row.door_payment_method)
          THEN 'door'
        ELSE 'purchase' END,
      'sentByFirstName', NULL,
      'chatJoined', v_conv IS NOT NULL, 'conversationId', v_conv
    ));
  END LOOP;
  v_more := v_more OR v_pass_count = 25;

  -- Anonymous RSVP primaries.
  v_pass_count := 0;
  FOR v_row IN
    SELECT r.id, r.event_id, e.title, 1 + coalesce(r.plus_count, 0) AS quantity,
           master.start_at, coalesce(master.timezone, e.timezone) AS timezone
      FROM public.event_rsvps r
      JOIN public.events e ON e.id = r.event_id
      JOIN public.brands b ON b.id = e.brand_id
      LEFT JOIN LATERAL (
        SELECT d.start_at, d.timezone
          FROM public.event_dates d
         WHERE d.event_id = e.id AND d.is_master IS TRUE
         ORDER BY d.start_at, d.id LIMIT 1
      ) master ON true
     WHERE r.user_id IS NULL
       AND (lower(btrim(r.guest_email)) = ANY(v_emails)
         OR r.guest_phone = ANY(v_phones))
       AND public.account_owns_contact(
         p_user_id, r.guest_email, r.guest_phone
       )
       AND e.event_type = 'rsvp' AND e.deleted_at IS NULL
       AND b.deleted_at IS NULL AND e.status IN ('scheduled', 'live')
       AND r.rsvp_status <> 'not_going'
       AND r.approval_status <> 'denied'
       AND NOT EXISTS (
         SELECT 1 FROM public.event_rsvps x
          WHERE x.event_id = r.event_id AND x.user_id = p_user_id
       )
     ORDER BY r.created_at, r.id
     LIMIT 25
     FOR UPDATE OF r SKIP LOCKED
  LOOP
    UPDATE public.event_rsvps
       SET user_id = p_user_id
     WHERE id = v_row.id AND user_id IS NULL;
    IF NOT FOUND THEN CONTINUE; END IF;
    v_pass_count := v_pass_count + 1;
    v_claimed := v_claimed || jsonb_build_array(jsonb_build_object(
      'kind', 'rsvp', 'id', v_row.id,
      'routeKind', 'rsvp', 'routeId', v_row.id,
      'offeringType', 'rsvp', 'noun', 'pass',
      'title', v_row.title, 'orderLabel', NULL,
      'startsAt', v_row.start_at, 'timezone', v_row.timezone,
      'venueLine', NULL, 'quantity', v_row.quantity,
      'source', 'rsvp', 'sentByFirstName', NULL,
      'chatJoined', NULL, 'conversationId', NULL
    ));
  END LOOP;
  v_more := v_more OR v_pass_count = 25;

  -- RSVP plus-ones that did not have an account at RSVP time.
  v_pass_count := 0;
  FOR v_row IN
    SELECT g.id, g.rsvp_id, r.event_id, e.title, master.start_at,
           coalesce(master.timezone, e.timezone) AS timezone
      FROM public.event_rsvp_guests g
      JOIN public.event_rsvps r ON r.id = g.rsvp_id
      JOIN public.events e ON e.id = r.event_id
      JOIN public.brands b ON b.id = e.brand_id
      LEFT JOIN LATERAL (
        SELECT d.start_at, d.timezone
          FROM public.event_dates d
         WHERE d.event_id = e.id AND d.is_master IS TRUE
         ORDER BY d.start_at, d.id LIMIT 1
      ) master ON true
     WHERE g.matched_user_id IS NULL
       AND (lower(btrim(g.email)) = ANY(v_emails) OR g.phone = ANY(v_phones))
       AND public.account_owns_contact(p_user_id, g.email, g.phone)
       AND e.event_type = 'rsvp' AND e.deleted_at IS NULL
       AND b.deleted_at IS NULL AND e.status IN ('scheduled', 'live')
       AND r.rsvp_status <> 'not_going' AND r.approval_status <> 'denied'
       AND r.user_id IS DISTINCT FROM p_user_id
       AND NOT EXISTS (
         SELECT 1 FROM public.event_rsvps owned
          WHERE owned.event_id = r.event_id AND owned.user_id = p_user_id
       )
       AND NOT EXISTS (
         SELECT 1
           FROM public.event_rsvp_guests other
           JOIN public.event_rsvps other_rsvp ON other_rsvp.id = other.rsvp_id
          WHERE other_rsvp.event_id = r.event_id
            AND other.matched_user_id = p_user_id
       )
     ORDER BY g.created_at, g.id
     LIMIT 25
     FOR UPDATE OF g SKIP LOCKED
  LOOP
    UPDATE public.event_rsvp_guests
       SET matched_user_id = p_user_id
     WHERE id = v_row.id AND matched_user_id IS NULL;
    IF NOT FOUND THEN CONTINUE; END IF;
    v_pass_count := v_pass_count + 1;
    v_claimed := v_claimed || jsonb_build_array(jsonb_build_object(
      'kind', 'rsvp_guest', 'id', v_row.id,
      'routeKind', 'rsvp', 'routeId', v_row.rsvp_id,
      'offeringType', 'rsvp', 'noun', 'pass',
      'title', v_row.title, 'orderLabel', NULL,
      'startsAt', v_row.start_at, 'timezone', v_row.timezone,
      'venueLine', NULL, 'quantity', 1,
      'source', 'rsvp', 'sentByFirstName', NULL,
      'chatJoined', NULL, 'conversationId', NULL
    ));
  END LOOP;
  v_more := v_more OR v_pass_count = 25;

  -- Venue reservations.
  v_pass_count := 0;
  FOR v_row IN
    SELECT r.id, r.venue_id, r.reserved_for, r.party_size,
           vl.name AS title,
           CASE WHEN vac.iana_timezone_source = 'default' THEN NULL
             ELSE vac.iana_timezone END AS timezone
      FROM public.reservations r
      LEFT JOIN public.venue_listings vl ON vl.id = r.venue_id
      LEFT JOIN public.venue_availability_config vac ON vac.venue_id = r.venue_id
     WHERE r.consumer_user_id IS NULL
       AND (lower(btrim(r.guest_email)) = ANY(v_emails)
         OR r.guest_phone_e164 = ANY(v_phones))
       AND public.account_owns_contact(
         p_user_id, r.guest_email, r.guest_phone_e164
       )
       AND r.reserved_for >= now() - interval '30 days'
     ORDER BY r.reserved_for, r.id
     LIMIT 25
     FOR UPDATE OF r SKIP LOCKED
  LOOP
    UPDATE public.reservations
       SET consumer_user_id = p_user_id
     WHERE id = v_row.id AND consumer_user_id IS NULL;
    IF NOT FOUND THEN CONTINUE; END IF;
    v_pass_count := v_pass_count + 1;
    v_claimed := v_claimed || jsonb_build_array(jsonb_build_object(
      'kind', 'reservation', 'id', v_row.id,
      'routeKind', 'reservation', 'routeId', v_row.id,
      'offeringType', 'venue', 'noun', 'booking',
      'title', coalesce(v_row.title, 'Reservation'), 'orderLabel', NULL,
      'startsAt', v_row.reserved_for, 'timezone', v_row.timezone,
      'venueLine', v_row.title, 'quantity', v_row.party_size,
      'source', 'booking', 'sentByFirstName', NULL,
      'chatJoined', NULL, 'conversationId', NULL
    ));
  END LOOP;
  v_more := v_more OR v_pass_count = 25;

  -- Stay groups. These tables are intentionally small; the contact prefilter
  -- is still present so a future volume increase cannot turn this into a scan.
  v_pass_count := 0;
  FOR v_row IN
    SELECT g.id, g.venue_id, vl.name AS title
      FROM public.stay_reservation_groups g
      LEFT JOIN public.venue_listings vl ON vl.id = g.venue_id
     WHERE g.user_id IS NULL
       AND (lower(btrim(g.guest_snapshot->>'email')) = ANY(v_emails)
         OR g.guest_snapshot->>'phone' = ANY(v_phones))
       AND public.account_owns_contact(
         p_user_id, g.guest_snapshot->>'email', g.guest_snapshot->>'phone'
       )
     ORDER BY g.created_at, g.id
     LIMIT 25
     FOR UPDATE OF g SKIP LOCKED
  LOOP
    UPDATE public.stay_reservation_groups
       SET user_id = p_user_id, updated_at = now()
     WHERE id = v_row.id AND user_id IS NULL;
    IF NOT FOUND THEN CONTINUE; END IF;
    v_pass_count := v_pass_count + 1;
    v_claimed := v_claimed || jsonb_build_array(jsonb_build_object(
      'kind', 'stay_group', 'id', v_row.id,
      'routeKind', 'stay', 'routeId', v_row.id,
      'offeringType', 'stay', 'noun', 'booking',
      'title', coalesce(v_row.title, 'Stay'), 'orderLabel', NULL,
      'startsAt', NULL, 'timezone', NULL,
      'venueLine', v_row.title, 'quantity', NULL,
      'source', 'booking', 'sentByFirstName', NULL,
      'chatJoined', NULL, 'conversationId', NULL
    ));
  END LOOP;
  v_more := v_more OR v_pass_count = 25;

  -- Paid Mingla food and drink orders.
  v_pass_count := 0;
  FOR v_row IN
    SELECT vo.id, vo.venue_id, vo.created_at, vo.pickup_code,
           vl.name AS title,
           coalesce((SELECT sum(i.quantity)::integer
             FROM public.venue_order_items i
            WHERE i.venue_order_id = vo.id), 0) AS quantity
      FROM public.venue_orders vo
      JOIN public.venue_listings vl ON vl.id = vo.venue_id
     WHERE vo.buyer_user_id IS NULL
       AND vo.money_path = 'mingla'
       AND vo.payment_status IN ('paid', 'partial_refund', 'refunded')
       AND vo.created_at >= now() - interval '90 days'
       AND (lower(btrim(vo.buyer_email)) = ANY(v_emails)
         OR vo.buyer_phone_e164 = ANY(v_phones))
       AND public.account_owns_contact(
         p_user_id, vo.buyer_email, vo.buyer_phone_e164
       )
     ORDER BY vo.created_at, vo.id
     LIMIT 25
     FOR UPDATE OF vo SKIP LOCKED
  LOOP
    UPDATE public.venue_orders
       SET buyer_user_id = p_user_id
     WHERE id = v_row.id AND buyer_user_id IS NULL;
    IF NOT FOUND THEN CONTINUE; END IF;
    v_pass_count := v_pass_count + 1;
    v_claimed := v_claimed || jsonb_build_array(jsonb_build_object(
      'kind', 'venue_order', 'id', v_row.id,
      'routeKind', 'venue_order', 'routeId', v_row.id,
      'offeringType', 'food', 'noun', 'receipt',
      'title', v_row.title,
      'orderLabel', CASE WHEN btrim(coalesce(v_row.pickup_code, '')) <> ''
        THEN 'Order #' || v_row.pickup_code
        ELSE 'Order ' || upper(substr(replace(v_row.id::text, '-', ''), 1, 8))
        END,
      'startsAt', v_row.created_at, 'timezone', NULL,
      'venueLine', v_row.title, 'quantity', v_row.quantity,
      'source', 'food', 'sentByFirstName', NULL,
      'chatJoined', NULL, 'conversationId', NULL
    ));
  END LOOP;
  v_more := v_more OR v_pass_count = 25;

  RETURN jsonb_build_object(
    'claimed', v_claimed,
    'count', jsonb_array_length(v_claimed),
    'more', v_more
  );
END;
$function$;

-- #4459: the brand team removes guests' messages in a Guest chat (kind 'host').
CREATE OR REPLACE FUNCTION public.unsend_messages(p_message_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_ids uuid[];
  v_found integer;
  v_conversations integer;
  v_conversation uuid;
  v_linked text;
  v_own integer;
  v_kind text;
  v_pending uuid[];
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;
  SELECT COALESCE(array_agg(DISTINCT x), ARRAY[]::uuid[]) INTO v_ids
    FROM unnest(COALESCE(p_message_ids, ARRAY[]::uuid[])) AS x WHERE x IS NOT NULL;
  IF cardinality(v_ids) < 1 OR cardinality(v_ids) > 10
     OR cardinality(v_ids) <> cardinality(COALESCE(p_message_ids, ARRAY[]::uuid[])) THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
  END IF;

  SELECT count(*), count(DISTINCT m.conversation_id), min(m.conversation_id::text)::uuid
    INTO v_found, v_conversations, v_conversation
    FROM public.messages m WHERE m.id = ANY(v_ids);
  IF v_conversations > 1 THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
  END IF;
  IF v_found < cardinality(v_ids) THEN
    -- PT404: PostgREST answers 404 (P0002 came back as a 500).
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'PT404';
  END IF;
  IF NOT public.is_message_conversation_participant(v_conversation, v_uid) THEN
    RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
  END IF;
  SELECT c.linked_entity_type INTO v_linked FROM public.conversations c WHERE c.id = v_conversation;
  IF v_linked IN ('brand_enquiry', 'support') THEN
    RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
  END IF;

  -- Messages already removed (by anyone) count as done.
  SELECT COALESCE(array_agg(m.id), ARRAY[]::uuid[]) INTO v_pending
    FROM public.messages m WHERE m.id = ANY(v_ids) AND m.deleted_at IS NULL;
  IF EXISTS (
    SELECT 1 FROM public.messages m
    WHERE m.id = ANY(v_pending) AND NOT public.issue_4456_is_unsendable_type(m.message_type)
  ) THEN
    RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
  END IF;

  SELECT count(*) INTO v_own FROM public.messages m
   WHERE m.id = ANY(v_ids) AND m.sender_id IS NOT DISTINCT FROM v_uid;
  IF v_own = cardinality(v_ids) THEN
    v_kind := 'sender';
  ELSIF v_own = 0 AND v_linked = 'brand_guests' THEN
    -- #4459: in a brand Guest chat only the brand team removes others'
    -- messages; the line reads "Message removed by <Brand>" (kind 'host').
    IF NOT public.issue_4459_is_brand_guest_team(v_conversation, v_uid) THEN
      RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
    END IF;
    v_kind := 'host';
  ELSIF v_own = 0 THEN
    -- Group admins only (session or plain friend groups), never on view-once.
    IF NOT public.chat_group_is_admin(v_conversation, v_uid) THEN
      RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
    END IF;
    IF EXISTS (SELECT 1 FROM public.messages m WHERE m.id = ANY(v_pending) AND m.view_once) THEN
      RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
    END IF;
    v_kind := 'admin';
  ELSE
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
  END IF;

  IF cardinality(v_pending) > 0 THEN
    PERFORM set_config('issue_4456.unsend_kind', v_kind, true);
    UPDATE public.messages SET deleted_at = now()
     WHERE id = ANY(v_pending) AND deleted_at IS NULL;
    PERFORM set_config('issue_4456.unsend_kind', '', true);
  END IF;

  RETURN jsonb_build_object('unsent', to_jsonb(v_ids), 'kind', v_kind);
END;
$function$;

-- #4459: the tombstone accepts the brand team removing a Guest chat message (kind host).
CREATE OR REPLACE FUNCTION public.issue_4456_tombstone_on_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_client boolean := COALESCE(auth.role(), '') IN ('authenticated', 'anon');
  v_uid uuid := auth.uid();
  v_requested text := NULLIF(current_setting('issue_4456.unsend_kind', true), '');
  v_kind text;
  v_becomes boolean;
BEGIN
  -- I-4456-UNSEND-FINAL: a tombstone stays a tombstone, with nothing put back.
  IF OLD.unsent_at IS NOT NULL THEN
    IF NEW.deleted_at IS NULL THEN
      RAISE EXCEPTION 'unsend_is_final' USING ERRCODE = '23514';
    END IF;
    NEW.deleted_at := OLD.deleted_at;
    NEW.unsent_at := OLD.unsent_at;
    -- unsent_by may only go to NULL (its user was deleted: ON DELETE SET NULL).
    NEW.unsent_by := CASE WHEN NEW.unsent_by IS NULL THEN NULL ELSE OLD.unsent_by END;
    NEW.unsent_kind := OLD.unsent_kind;
    NEW.content := '';
    NEW.file_url := NULL;
    NEW.thumb_path := NULL;
    NEW.file_name := NULL;
    NEW.file_size := NULL;
    NEW.card_payload := NULL;
    NEW.card_tags := '[]'::jsonb;
    NEW.mentions := '[]'::jsonb;
    NEW.media_duration_ms := NULL;
    NEW.media_width := NULL;
    NEW.media_height := NULL;
    RETURN NEW;
  END IF;

  -- App clients never bring a removed message back.
  IF v_client AND OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
    RAISE EXCEPTION 'unsend_is_final' USING ERRCODE = '23514';
  END IF;

  v_becomes := NEW.deleted_at IS NOT NULL AND (
    OLD.deleted_at IS NULL
    -- U8 backfill (server only): an already-removed row is tombstoned when the
    -- server stamps unsent_at on it.
    OR (NOT v_client AND NEW.unsent_at IS NOT NULL)
  );
  IF NOT v_becomes THEN
    IF NOT v_client THEN
      RETURN NEW;
    END IF;
    -- Clients never set the tombstone columns themselves (also refused by grants).
    NEW.unsent_at := OLD.unsent_at;
    NEW.unsent_by := OLD.unsent_by;
    NEW.unsent_kind := OLD.unsent_kind;
    RETURN NEW;
  END IF;

  IF NOT public.issue_4456_is_unsendable_type(OLD.message_type) THEN
    IF v_client AND OLD.message_type IS DISTINCT FROM 'plan' THEN
      RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
    END IF;
    -- Plan rows: tg_4261_guard_plan_messages refuses clients; the server's own
    -- removals of server-owned rows stay plain hides.
    NEW.unsent_at := NULL;
    NEW.unsent_by := NULL;
    NEW.unsent_kind := NULL;
    RETURN NEW;
  END IF;

  IF v_client THEN
    IF v_uid IS NULL THEN
      RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
    END IF;
    IF v_requested = 'admin' THEN
      IF OLD.sender_id IS NOT DISTINCT FROM v_uid
         OR OLD.view_once
         OR NOT public.chat_group_is_admin(OLD.conversation_id, v_uid) THEN
        RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
      END IF;
      v_kind := 'admin';
    ELSIF OLD.sender_id IS NOT DISTINCT FROM v_uid THEN
      v_kind := 'sender';
    ELSIF public.is_conversation_brand_team_member(OLD.conversation_id, v_uid)
       OR public.issue_4459_is_brand_guest_team(OLD.conversation_id, v_uid) THEN
      v_kind := 'host';
    ELSE
      RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
    END IF;
  ELSE
    v_kind := COALESCE(NULLIF(NEW.unsent_kind, ''), v_requested, 'server');
    IF v_kind NOT IN ('sender', 'admin', 'host', 'server', 'legacy') THEN
      v_kind := 'server';
    END IF;
  END IF;

  INSERT INTO public.message_unsend_evidence(
    message_id, conversation_id, sender_id, unsent_by, unsent_kind, original,
    file_path, thumb_path, unsent_at, purge_after
  ) VALUES (
    OLD.id, OLD.conversation_id, OLD.sender_id, v_uid, v_kind,
    jsonb_build_object(
      'content', OLD.content,
      'message_type', OLD.message_type,
      'file_url', OLD.file_url,
      'thumb_path', OLD.thumb_path,
      'file_name', OLD.file_name,
      'file_size', OLD.file_size,
      'card_payload', OLD.card_payload,
      'card_tags', OLD.card_tags,
      'mentions', OLD.mentions,
      'reply_to_id', OLD.reply_to_id,
      'view_once', OLD.view_once,
      'media_album_id', OLD.media_album_id,
      'media_duration_ms', OLD.media_duration_ms,
      'media_width', OLD.media_width,
      'media_height', OLD.media_height,
      'created_at', OLD.created_at,
      'deleted_at', OLD.deleted_at
    ),
    public.issue_4456_object_path(OLD.file_url),
    public.issue_4456_object_path(OLD.thumb_path),
    now(),
    now() + public.issue_4456_evidence_retention()
  )
  ON CONFLICT (message_id) DO NOTHING;

  -- I-4456-UNSEND-SCRUBS.
  NEW.content := '';
  NEW.file_url := NULL;
  NEW.thumb_path := NULL;
  NEW.file_name := NULL;
  NEW.file_size := NULL;
  NEW.card_payload := NULL;
  NEW.card_tags := '[]'::jsonb;
  NEW.mentions := '[]'::jsonb;
  NEW.media_duration_ms := NULL;
  NEW.media_width := NULL;
  NEW.media_height := NULL;
  NEW.unsent_at := now();
  -- #4459: a brand removal in its Guest chat names the brand, never a team member.
  NEW.unsent_by := CASE
    WHEN v_kind = 'host' AND public.issue_4459_is_brand_guests_conversation(OLD.conversation_id) THEN NULL
    ELSE v_uid END;
  NEW.unsent_kind := v_kind;
  IF OLD.deleted_at IS NULL AND v_client THEN
    NEW.deleted_at := now();
  END IF;
  RETURN NEW;
END;
$function$;

-- #4459: the Chats list access includes the caller's Guest chats.
CREATE OR REPLACE FUNCTION public.list_connection_conversation_access()
 RETURNS TABLE(conversation_id uuid, archived_at timestamp with time zone, pinned_at timestamp with time zone, marked_unread_at timestamp with time zone, live_session_id uuid, live_session_status text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH access AS (
    SELECT DISTINCT c.conversation_id,lifecycle.archived_at,lifecycle.pinned_at,lifecycle.marked_unread_at
    FROM public.content_share_recipient_candidates(auth.uid(),true,false) c
    LEFT JOIN public.conversation_participant_lifecycle lifecycle
      ON lifecycle.conversation_id=c.conversation_id AND lifecycle.user_id=auth.uid()
    WHERE c.target_kind IN ('direct','group') AND c.conversation_id IS NOT NULL
    UNION
    SELECT conversation.id,lifecycle.archived_at,lifecycle.pinned_at,lifecycle.marked_unread_at
    FROM public.conversation_participants mine
    JOIN public.conversations conversation ON conversation.id=mine.conversation_id
    JOIN public.collaboration_sessions session ON session.id=conversation.session_id
    LEFT JOIN public.conversation_participant_lifecycle lifecycle
      ON lifecycle.conversation_id=mine.conversation_id AND lifecycle.user_id=mine.user_id
    WHERE mine.user_id=auth.uid() AND lifecycle.hidden_at IS NULL
      AND conversation.type='group' AND conversation.linked_entity_type='session'
      AND conversation.is_enabled IS TRUE AND session.created_by=auth.uid()
      AND session.is_active IS TRUE AND session.archived_at IS NULL
      AND session.status='pending'
    UNION
    SELECT conversation.id,lifecycle.archived_at,lifecycle.pinned_at,lifecycle.marked_unread_at
    FROM public.conversation_participants mine
    JOIN public.conversations conversation ON conversation.id=mine.conversation_id
    LEFT JOIN public.conversation_participant_lifecycle lifecycle
      ON lifecycle.conversation_id=mine.conversation_id AND lifecycle.user_id=mine.user_id
    WHERE mine.user_id=auth.uid() AND lifecycle.hidden_at IS NULL
      AND conversation.program_kind IN ('local','creator')
      AND conversation.program_target_user_id=auth.uid()
      AND conversation.type='group' AND conversation.linked_entity_type='direct'
      AND conversation.is_enabled IS TRUE
    UNION
    -- #4459: the brand Guest chat (one per brand) for its members.
    SELECT conversation.id,lifecycle.archived_at,lifecycle.pinned_at,lifecycle.marked_unread_at
    FROM public.conversation_participants mine
    JOIN public.conversations conversation ON conversation.id=mine.conversation_id
    LEFT JOIN public.conversation_participant_lifecycle lifecycle
      ON lifecycle.conversation_id=mine.conversation_id AND lifecycle.user_id=mine.user_id
    WHERE mine.user_id=auth.uid() AND lifecycle.hidden_at IS NULL
      AND conversation.linked_entity_type='brand_guests'
      AND conversation.type='group'
      AND conversation.is_enabled IS TRUE
  )
  SELECT access.conversation_id,access.archived_at,access.pinned_at,access.marked_unread_at,
    live.id,live.status
  FROM access
  LEFT JOIN LATERAL (
    SELECT cs.id,cs.status
    FROM public.collaboration_sessions cs
    WHERE cs.conversation_id=access.conversation_id
      AND cs.status IN ('pending','active','voting','locked')
    ORDER BY cs.created_at DESC
    LIMIT 1
  ) live ON true;
$function$;

-- ── 8. Guest chat RPCs ──────────────────────────────────────────────────────
-- Send (RPC-only). Team members post as the brand; guests post as themselves.
-- Text only in v1. A block between two guests never stops either from posting
-- (the client hides a blocked person's messages; no push crosses a block).
CREATE OR REPLACE FUNCTION public.issue_4459_send_brand_guest_message(
  p_conversation_id uuid,
  p_content text,
  p_reply_to_id uuid DEFAULT NULL,
  p_client_id uuid DEFAULT NULL,
  p_mentions jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_conversation public.conversations%ROWTYPE;
  v_team boolean;
  v_content text := btrim(COALESCE(p_content, ''));
  v_mentions jsonb := COALESCE(p_mentions, '[]'::jsonb);
  v_brand_name text;
  v_display text;
  v_row public.messages%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;
  SELECT * INTO v_conversation FROM public.conversations
   WHERE id = p_conversation_id AND linked_entity_type = 'brand_guests';
  IF NOT FOUND OR NOT public.is_conversation_participant(p_conversation_id, v_uid) THEN
    RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
  END IF;
  IF v_conversation.is_enabled IS NOT TRUE THEN
    RAISE EXCEPTION 'chat_disabled' USING ERRCODE = '42501';
  END IF;
  v_team := public.issue_4459_is_brand_guest_team(p_conversation_id, v_uid);
  IF v_conversation.is_broadcast_only AND NOT v_team THEN
    RAISE EXCEPTION 'announcements_only' USING ERRCODE = '42501';
  END IF;
  IF char_length(v_content) < 1 OR char_length(v_content) > 4000 THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023', DETAIL = 'content';
  END IF;
  IF jsonb_typeof(v_mentions) <> 'array' OR jsonb_array_length(v_mentions) > 10 THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023', DETAIL = 'mentions';
  END IF;
  -- Mentions name only current members; across a block they are dropped.
  SELECT COALESCE(jsonb_agg(m.value ORDER BY m.ordinality), '[]'::jsonb) INTO v_mentions
    FROM jsonb_array_elements(v_mentions) WITH ORDINALITY AS m(value, ordinality)
   WHERE CASE
     WHEN jsonb_typeof(m.value) = 'object'
          AND (m.value->>'userId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       THEN public.is_conversation_participant(p_conversation_id, (m.value->>'userId')::uuid)
            AND NOT public.has_block_between(v_uid, (m.value->>'userId')::uuid)
     ELSE false END;
  IF p_reply_to_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.messages r
     WHERE r.id = p_reply_to_id AND r.conversation_id = p_conversation_id
  ) THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023', DETAIL = 'reply_to';
  END IF;

  -- Idempotent retry: the same client id returns the stored row.
  IF p_client_id IS NOT NULL THEN
    SELECT m.* INTO v_row FROM public.messages m
     WHERE m.conversation_id = p_conversation_id AND m.client_id = p_client_id
       AND (m.sender_id = v_uid OR EXISTS (
         SELECT 1 FROM public.brand_guest_post_authors a
          WHERE a.message_id = m.id AND a.author_id = v_uid));
    IF FOUND THEN
      RETURN to_jsonb(v_row) || CASE WHEN v_team THEN jsonb_build_object('author_id', v_uid) ELSE '{}'::jsonb END;
    END IF;
  END IF;

  -- Guests: at most 20 messages per 10 minutes.
  IF NOT v_team THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('issue_4459_rate:' || p_conversation_id::text || ':' || v_uid::text, 0));
    IF (SELECT count(*) FROM public.messages m
         WHERE m.conversation_id = p_conversation_id AND m.sender_id = v_uid
           AND m.created_at > now() - interval '10 minutes') >= 20 THEN
      RAISE EXCEPTION 'rate_limited' USING ERRCODE = 'PT409';
    END IF;
  END IF;

  SELECT b.name INTO v_brand_name FROM public.brands b WHERE b.id = v_conversation.brand_id;
  IF v_team THEN
    v_display := COALESCE(NULLIF(btrim(v_brand_name), ''), v_conversation.name);
  ELSE
    SELECT COALESCE(NULLIF(btrim(p.display_name), ''),
                    NULLIF(btrim(concat_ws(' ', p.first_name, p.last_name)), ''),
                    NULLIF(btrim(p.username), ''))
      INTO v_display FROM public.profiles p WHERE p.id = v_uid;
  END IF;

  -- A brand post carries the brand only: sender_id stays NULL on the message
  -- (every guest read path: rows, realtime, previews, list RPCs) and the
  -- author is kept in brand_guest_post_authors, which only the team reads.
  INSERT INTO public.messages(
    conversation_id, sender_id, content, message_type, reply_to_id, client_id,
    mentions, sender_kind, sender_display_name_snapshot, sender_role_snapshot
  ) VALUES (
    p_conversation_id, CASE WHEN v_team THEN NULL ELSE v_uid END, v_content, 'text', p_reply_to_id, p_client_id,
    v_mentions, CASE WHEN v_team THEN 'brand' ELSE 'guest' END, v_display,
    CASE WHEN v_team THEN 'brand' ELSE NULL END
  )
  RETURNING * INTO v_row;
  IF v_team THEN
    INSERT INTO public.brand_guest_post_authors(message_id, conversation_id, author_id)
    VALUES (v_row.id, p_conversation_id, v_uid);
    RETURN to_jsonb(v_row) || jsonb_build_object('author_id', v_uid);
  END IF;
  RETURN to_jsonb(v_row);
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4459_send_brand_guest_message(uuid, text, uuid, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_4459_send_brand_guest_message(uuid, text, uuid, uuid, jsonb) TO authenticated;

-- Leave (sticky). The team cannot leave; leave_group_conversation keeps
-- refusing brand_guests.
CREATE OR REPLACE FUNCTION public.issue_4459_leave_brand_guest_chat(p_conversation_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_brand_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;
  SELECT c.brand_id INTO v_brand_id FROM public.conversations c
   WHERE c.id = p_conversation_id AND c.linked_entity_type = 'brand_guests';
  IF v_brand_id IS NULL OR NOT public.is_conversation_participant(p_conversation_id, v_uid) THEN
    RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
  END IF;
  IF public.issue_4459_is_brand_team(v_brand_id, v_uid) THEN
    RAISE EXCEPTION 'team_member' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.brand_guest_chat_exclusions(brand_id, user_id, reason, created_by)
  VALUES (v_brand_id, v_uid, 'left', v_uid)
  ON CONFLICT (brand_id, user_id) DO NOTHING;
  DELETE FROM public.conversation_participants
   WHERE conversation_id = p_conversation_id AND user_id = v_uid;
  RETURN jsonb_build_object('status', 'left', 'brandId', v_brand_id, 'conversationId', p_conversation_id);
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4459_leave_brand_guest_chat(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_4459_leave_brand_guest_chat(uuid) TO authenticated;

-- Rejoin from a booking: only after leaving (never after a host removal) and
-- only while still eligible. History restarts at the rejoin.
CREATE OR REPLACE FUNCTION public.issue_4459_rejoin_brand_guest_chat(p_brand_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_reason text;
  v_status text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;
  SELECT x.reason INTO v_reason FROM public.brand_guest_chat_exclusions x
   WHERE x.brand_id = p_brand_id AND x.user_id = v_uid FOR UPDATE;
  IF v_reason = 'removed' THEN
    RAISE EXCEPTION 'removed' USING ERRCODE = '42501';
  END IF;
  IF NOT public.issue_4459_brand_guest_eligible(p_brand_id, v_uid)
     AND NOT public.issue_4459_is_brand_team(p_brand_id, v_uid) THEN
    RAISE EXCEPTION 'not_eligible' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.brand_guest_chat_exclusions
   WHERE brand_id = p_brand_id AND user_id = v_uid AND reason = 'left';
  v_status := public.issue_4459_sync_brand_guest(p_brand_id, v_uid);
  RETURN jsonb_build_object(
    'status', v_status,
    'conversationId', (SELECT c.id FROM public.conversations c
                        WHERE c.brand_id = p_brand_id AND c.linked_entity_type = 'brand_guests'));
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4459_rejoin_brand_guest_chat(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_4459_rejoin_brand_guest_chat(uuid) TO authenticated;

-- Host removal (sticky; posts no chat notice) and restore. Team only.
CREATE OR REPLACE FUNCTION public.issue_4459_remove_brand_guest(p_conversation_id uuid, p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_brand_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;
  IF NOT public.issue_4459_is_brand_guest_team(p_conversation_id, v_uid) THEN
    RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
  END IF;
  SELECT c.brand_id INTO v_brand_id FROM public.conversations c WHERE c.id = p_conversation_id;
  IF p_user_id IS NULL OR public.issue_4459_is_brand_team(v_brand_id, p_user_id) THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023', DETAIL = 'user';
  END IF;
  INSERT INTO public.brand_guest_chat_exclusions(brand_id, user_id, reason, created_by)
  VALUES (v_brand_id, p_user_id, 'removed', v_uid)
  ON CONFLICT (brand_id, user_id) DO UPDATE
    SET reason = 'removed', created_by = EXCLUDED.created_by, created_at = now(), dismissed_at = NULL;
  DELETE FROM public.conversation_participants
   WHERE conversation_id = p_conversation_id AND user_id = p_user_id;
  RETURN jsonb_build_object('status', 'removed', 'userId', p_user_id);
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4459_remove_brand_guest(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_4459_remove_brand_guest(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.issue_4459_restore_brand_guest(p_conversation_id uuid, p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_brand_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;
  IF NOT public.issue_4459_is_brand_guest_team(p_conversation_id, v_uid) THEN
    RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
  END IF;
  SELECT c.brand_id INTO v_brand_id FROM public.conversations c WHERE c.id = p_conversation_id;
  DELETE FROM public.brand_guest_chat_exclusions
   WHERE brand_id = v_brand_id AND user_id = p_user_id AND reason = 'removed';
  RETURN jsonb_build_object('status', public.issue_4459_sync_brand_guest(v_brand_id, p_user_id), 'userId', p_user_id);
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4459_restore_brand_guest(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_4459_restore_brand_guest(uuid, uuid) TO authenticated;

-- Announcements only (team only). Rename is not offered: the name follows the brand.
CREATE OR REPLACE FUNCTION public.issue_4459_set_brand_guest_announcements_only(p_conversation_id uuid, p_value boolean)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;
  IF p_value IS NULL OR NOT public.issue_4459_is_brand_guest_team(p_conversation_id, v_uid) THEN
    RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
  END IF;
  UPDATE public.conversations SET is_broadcast_only = p_value, updated_at = now()
   WHERE id = p_conversation_id AND linked_entity_type = 'brand_guests';
  RETURN jsonb_build_object('announcementsOnly', p_value);
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4459_set_brand_guest_announcements_only(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_4459_set_brand_guest_announcements_only(uuid, boolean) TO authenticated;

-- A person's own state in a brand's Guest chat: member, left, removed or
-- not_eligible. Only ever about the caller.
CREATE OR REPLACE FUNCTION public.issue_4459_my_brand_guest_status(p_brand_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_conversation_id uuid;
  v_reason text;
  v_status text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;
  SELECT c.id INTO v_conversation_id FROM public.conversations c
   WHERE c.brand_id = p_brand_id AND c.linked_entity_type = 'brand_guests';
  SELECT x.reason INTO v_reason FROM public.brand_guest_chat_exclusions x
   WHERE x.brand_id = p_brand_id AND x.user_id = v_uid;
  v_status := CASE
    WHEN v_conversation_id IS NOT NULL AND public.is_conversation_participant(v_conversation_id, v_uid) THEN 'member'
    WHEN v_reason IS NOT NULL THEN v_reason
    ELSE 'not_eligible'
  END;
  RETURN jsonb_build_object(
    'status', v_status,
    'conversationId', CASE WHEN v_status = 'member' THEN v_conversation_id END,
    'canRejoin', v_status = 'left' AND public.issue_4459_brand_guest_eligible(p_brand_id, v_uid));
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4459_my_brand_guest_status(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_4459_my_brand_guest_status(uuid) TO authenticated;

-- The caller's removed Guest chats (design v2 "Removed" row), until they
-- remove the row from their chat list.
CREATE OR REPLACE FUNCTION public.issue_4459_my_removed_brand_guest_chats()
RETURNS TABLE(brand_id uuid, brand_name text, brand_slug text, brand_logo_url text, brand_account_id uuid, removed_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT b.id, b.name, b.slug, b.profile_photo_url, b.account_id, x.created_at
    FROM public.brand_guest_chat_exclusions x
    JOIN public.brands b ON b.id = x.brand_id AND b.deleted_at IS NULL
   WHERE x.user_id = auth.uid() AND x.reason = 'removed' AND x.dismissed_at IS NULL
   ORDER BY x.created_at DESC;
$function$;
REVOKE ALL ON FUNCTION public.issue_4459_my_removed_brand_guest_chats() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_4459_my_removed_brand_guest_chats() TO authenticated;

CREATE OR REPLACE FUNCTION public.issue_4459_dismiss_removed_brand_guest_chat(p_brand_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;
  UPDATE public.brand_guest_chat_exclusions SET dismissed_at = now()
   WHERE brand_id = p_brand_id AND user_id = auth.uid() AND reason = 'removed' AND dismissed_at IS NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4459_dismiss_removed_brand_guest_chat(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_4459_dismiss_removed_brand_guest_chat(uuid) TO authenticated;

-- The member sheet. The team sees everyone; a guest sees the team, guests who
-- chose "show me as going" on a booking with this brand, themselves, and the
-- total count.
CREATE OR REPLACE FUNCTION public.issue_4459_list_brand_guest_members(p_conversation_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_brand_id uuid;
  v_team boolean;
  v_members jsonb;
  v_total integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;
  SELECT c.brand_id INTO v_brand_id FROM public.conversations c
   WHERE c.id = p_conversation_id AND c.linked_entity_type = 'brand_guests';
  IF v_brand_id IS NULL OR NOT public.is_conversation_participant(p_conversation_id, v_uid) THEN
    RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
  END IF;
  v_team := public.issue_4459_is_brand_team(v_brand_id, v_uid);
  SELECT count(*)::integer INTO v_total FROM public.conversation_participants
   WHERE conversation_id = p_conversation_id;

  WITH roster AS (
    SELECT cp.user_id, cp.joined_at,
      public.issue_4459_is_brand_team(v_brand_id, cp.user_id) AS is_team,
      (EXISTS (
         SELECT 1 FROM public.orders o JOIN public.events e ON e.id = o.event_id
          WHERE e.brand_id = v_brand_id AND o.buyer_user_id = cp.user_id
            AND o.payment_status IN ('paid', 'partial_refund') AND o.show_me_as_going IS TRUE)
       OR EXISTS (
         SELECT 1 FROM public.event_rsvps r JOIN public.events e ON e.id = r.event_id
          WHERE e.brand_id = v_brand_id AND r.user_id = cp.user_id
            AND r.rsvp_status = 'going' AND r.approval_status = 'approved'
            AND r.show_me_as_going IS TRUE)) AS shown_as_going
      FROM public.conversation_participants cp
     WHERE cp.conversation_id = p_conversation_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'userId', r.user_id,
           'displayName', COALESCE(NULLIF(btrim(p.display_name), ''),
                                   NULLIF(btrim(concat_ws(' ', p.first_name, p.last_name)), ''),
                                   NULLIF(btrim(p.username), ''), 'Guest'),
           'avatarUrl', p.avatar_url,
           'isTeam', r.is_team,
           'shownAsGoing', r.shown_as_going,
           'joinedAt', r.joined_at)
         ORDER BY r.is_team DESC, r.joined_at, r.user_id), '[]'::jsonb)
    INTO v_members
    FROM roster r LEFT JOIN public.profiles p ON p.id = r.user_id
   WHERE v_team OR r.is_team OR r.shown_as_going OR r.user_id = v_uid;

  RETURN jsonb_build_object('total', v_total, 'isTeam', v_team, 'members', v_members);
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4459_list_brand_guest_members(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_4459_list_brand_guest_members(uuid) TO authenticated;

-- The brand Guest chats a team member runs (Host app list).
CREATE OR REPLACE FUNCTION public.issue_4459_list_my_brand_guest_chats()
RETURNS TABLE(conversation_id uuid, brand_id uuid, brand_name text, brand_logo_url text,
              is_broadcast_only boolean, member_count integer, last_message_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT c.id, b.id, b.name, b.profile_photo_url, c.is_broadcast_only,
    (SELECT count(*)::integer FROM public.conversation_participants cp WHERE cp.conversation_id = c.id),
    c.last_message_at
    FROM public.conversations c
    JOIN public.brands b ON b.id = c.brand_id AND b.deleted_at IS NULL
   WHERE c.linked_entity_type = 'brand_guests' AND c.is_enabled IS TRUE
     AND public.issue_4459_is_brand_team(c.brand_id, auth.uid())
   ORDER BY c.last_message_at DESC NULLS LAST, b.name;
$function$;
REVOKE ALL ON FUNCTION public.issue_4459_list_my_brand_guest_chats() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_4459_list_my_brand_guest_chats() TO authenticated;


-- ── 9. Backfill (deterministic; a re-run changes nothing; no pushes) ────────
-- A function so the pg17 suite can prove a second run is a zero diff.
CREATE OR REPLACE FUNCTION public.issue_4459_backfill_brand_guest_chats()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_guests integer := 0;
  v_retired integer := 0;
BEGIN
  PERFORM public.issue_4459_ensure_brand_guest_chat(b.id)
     FROM public.brands b
    WHERE b.deleted_at IS NULL
    ORDER BY b.id;

PERFORM set_config('issue_4459.backfill', 'on', true);

WITH candidates AS (
  SELECT e.brand_id, o.buyer_user_id AS user_id
    FROM public.orders o JOIN public.events e ON e.id = o.event_id
   WHERE o.buyer_user_id IS NOT NULL AND o.payment_status IN ('paid', 'partial_refund')
  UNION
  SELECT e.brand_id, r.user_id
    FROM public.event_rsvps r JOIN public.events e ON e.id = r.event_id
   WHERE r.user_id IS NOT NULL AND r.rsvp_status = 'going' AND r.approval_status = 'approved'
  UNION
  SELECT e.brand_id, g.matched_user_id
    FROM public.event_rsvp_guests g
    JOIN public.event_rsvps r ON r.id = g.rsvp_id
    JOIN public.events e ON e.id = r.event_id
   WHERE g.matched_user_id IS NOT NULL
  UNION
  SELECT e.brand_id, pc.claimed_by_user_id
    FROM public.pending_trip_chat_claims pc JOIN public.events e ON e.id = pc.event_id
   WHERE pc.claimed_by_user_id IS NOT NULL
)
INSERT INTO public.conversation_participants(conversation_id, user_id)
SELECT c.id, cand.user_id
  FROM candidates cand
  JOIN public.brands b ON b.id = cand.brand_id AND b.deleted_at IS NULL
  JOIN public.conversations c ON c.brand_id = cand.brand_id AND c.linked_entity_type = 'brand_guests'
  JOIN auth.users u ON u.id = cand.user_id
 WHERE NOT public.issue_4459_is_brand_team(cand.brand_id, cand.user_id)
   AND public.issue_4459_brand_guest_eligible(cand.brand_id, cand.user_id)
   AND NOT EXISTS (
     SELECT 1 FROM public.brand_guest_chat_exclusions x
      WHERE x.brand_id = cand.brand_id AND x.user_id = cand.user_id)
 ORDER BY c.id, cand.user_id
ON CONFLICT (conversation_id, user_id) DO NOTHING;
  GET DIAGNOSTICS v_guests = ROW_COUNT;
  PERFORM set_config('issue_4459.backfill', '', true);

-- Carry Explorer state over from the folded per-listing chats: muted there
-- means muted here; a pin moves here (the per-listing pin is cleared first so
-- the 3-pin rule never trips). Marked-unread, archive and clear are not carried.
UPDATE public.conversation_participants gp
   SET notifications_muted = true
  FROM public.conversations gc
 WHERE gp.conversation_id = gc.id AND gc.linked_entity_type = 'brand_guests'
   AND gp.notifications_muted IS FALSE
   AND NOT public.issue_4459_is_brand_team(gc.brand_id, gp.user_id)
   AND EXISTS (
     SELECT 1 FROM public.conversation_participants lp
       JOIN public.conversations lc ON lc.id = lp.conversation_id
       JOIN public.events e ON e.id = lc.event_id
      WHERE lc.linked_entity_type IN ('event', 'trip')
        AND e.brand_id = gc.brand_id AND lp.user_id = gp.user_id
        AND lp.notifications_muted IS TRUE);

DROP TABLE IF EXISTS pg_temp.issue_4459_pin_carry;
  CREATE TEMP TABLE issue_4459_pin_carry ON COMMIT DROP AS
SELECT gc.id AS conversation_id, l.user_id, min(l.pinned_at) AS pinned_at
  FROM public.conversation_participant_lifecycle l
  JOIN public.conversations lc ON lc.id = l.conversation_id AND lc.linked_entity_type IN ('event', 'trip')
  JOIN public.events e ON e.id = lc.event_id
  JOIN public.conversations gc ON gc.brand_id = e.brand_id AND gc.linked_entity_type = 'brand_guests'
  JOIN public.conversation_participants gp ON gp.conversation_id = gc.id AND gp.user_id = l.user_id
 WHERE l.pinned_at IS NOT NULL
   AND NOT public.issue_4459_is_brand_team(gc.brand_id, l.user_id)
 GROUP BY gc.id, l.user_id;

UPDATE public.conversation_participant_lifecycle l
   SET pinned_at = NULL
  FROM public.conversations lc, public.events e, issue_4459_pin_carry pin
 WHERE lc.id = l.conversation_id AND lc.linked_entity_type IN ('event', 'trip')
   AND e.id = lc.event_id AND l.pinned_at IS NOT NULL
   AND pin.user_id = l.user_id
   AND pin.conversation_id = (SELECT gc.id FROM public.conversations gc
                               WHERE gc.brand_id = e.brand_id AND gc.linked_entity_type = 'brand_guests');

INSERT INTO public.conversation_participant_lifecycle(conversation_id, user_id, pinned_at)
SELECT pin.conversation_id, pin.user_id, pin.pinned_at
  FROM issue_4459_pin_carry pin
 ORDER BY pin.user_id, pin.pinned_at, pin.conversation_id
ON CONFLICT (conversation_id, user_id) DO UPDATE
  SET pinned_at = COALESCE(public.conversation_participant_lifecycle.pinned_at, EXCLUDED.pinned_at);

-- Retire the per-listing chats (rows and their one message stay).
UPDATE public.conversations
     SET is_enabled = false
   WHERE linked_entity_type IN ('event', 'trip') AND is_enabled IS TRUE;
  GET DIAGNOSTICS v_retired = ROW_COUNT;

  RETURN jsonb_build_object('guestsAdded', v_guests, 'perListingRetired', v_retired);
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4459_backfill_brand_guest_chats() FROM PUBLIC, anon, authenticated, service_role;

SELECT public.issue_4459_backfill_brand_guest_chats();

DO $assert$
DECLARE v_bad integer;
BEGIN
  SELECT count(*) INTO v_bad FROM public.brands b
   WHERE b.deleted_at IS NULL
     AND (SELECT count(*) FROM public.conversations c
           WHERE c.brand_id = b.id AND c.linked_entity_type = 'brand_guests') <> 1;
  ASSERT v_bad = 0, format('#4459: %s non-deleted brands without exactly one Guest chat', v_bad);

  SELECT count(*) INTO v_bad
    FROM public.conversation_participants cp
    JOIN public.conversations c ON c.id = cp.conversation_id AND c.linked_entity_type = 'brand_guests'
   WHERE NOT public.issue_4459_is_brand_team(c.brand_id, cp.user_id)
     AND (NOT public.issue_4459_brand_guest_eligible(c.brand_id, cp.user_id)
          OR EXISTS (SELECT 1 FROM public.brand_guest_chat_exclusions x
                      WHERE x.brand_id = c.brand_id AND x.user_id = cp.user_id));
  ASSERT v_bad = 0, format('#4459: %s Guest chat members without eligibility or team status', v_bad);

  SELECT count(*) INTO v_bad
    FROM public.brand_team_members m
    JOIN public.brands b ON b.id = m.brand_id AND b.deleted_at IS NULL
    JOIN public.conversations c ON c.brand_id = m.brand_id AND c.linked_entity_type = 'brand_guests'
   WHERE m.accepted_at IS NOT NULL AND m.removed_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.conversation_participants cp
                      WHERE cp.conversation_id = c.id AND cp.user_id = m.user_id);
  ASSERT v_bad = 0, format('#4459: %s brand team members missing from their Guest chat', v_bad);

  SELECT count(*) INTO v_bad FROM public.conversations
   WHERE linked_entity_type IN ('event', 'trip') AND is_enabled IS TRUE;
  ASSERT v_bad = 0, format('#4459: %s per-listing chats still enabled', v_bad);
END;
$assert$;

COMMIT;
