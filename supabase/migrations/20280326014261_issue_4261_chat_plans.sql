-- Issue #4261 Wave A2 — friends plan together in the chat.
--
-- One entity, chat_plans, is every Matches / Plans card: a plan added in a
-- chat (1:1, collab-session group, plain user group) AND every deck match
-- (a board_saved_cards row gets its chat_plans row from a trigger, and all
-- existing saved cards are backfilled). Deck lock truth stays
-- board_saved_cards.is_locked + calendar_entries; it is never mirrored.
--
--   * time options + time votes (chat and deck), Going / Maybe / Can't and
--     thumbs (chat: own tables; deck: board_card_rsvps / board_votes);
--   * a chat plan posts one `plan` message (only the plan RPCs may write,
--     change or delete one); time votes, RSVPs and thumbs post nothing; a new
--     time, a lock-in and a cancel post one system line;
--   * a reply to a plan (or a message tagged with a plan) gets messages.plan_id
--     and a server-built plan_quote of the sender's own picks;
--   * a locked chat plan puts calendar_entries rows (source chat_plan) on the
--     calendars of the members who are Going;
--   * search_plan_places reads the Mingla place pool (active + servable).
--
-- All writes go through SECURITY DEFINER RPCs; the new tables carry SELECT
-- policies only. Application conflicts raise PT409, never 40001. Static SQL
-- only. Idempotent: safe to apply twice.

BEGIN;

-- ── chat_plans ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.chat_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  source text NOT NULL CONSTRAINT chat_plans_source_check CHECK (source IN ('chat', 'deck')),
  session_id uuid NULL REFERENCES public.collaboration_sessions(id) ON DELETE CASCADE,
  saved_card_id uuid NULL UNIQUE REFERENCES public.board_saved_cards(id) ON DELETE CASCADE,
  message_id uuid NULL UNIQUE REFERENCES public.messages(id) ON DELETE SET NULL,
  created_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  client_id uuid NULL,
  title text NOT NULL CONSTRAINT chat_plans_title_length CHECK (char_length(btrim(title)) BETWEEN 1 AND 80),
  where_kind text NOT NULL DEFAULT 'none'
    CONSTRAINT chat_plans_where_kind_check CHECK (where_kind IN ('place', 'address', 'link', 'none')),
  place_pool_id uuid NULL REFERENCES public.place_pool(id) ON DELETE SET NULL,
  mapbox_id text NULL CONSTRAINT chat_plans_mapbox_id_length CHECK (char_length(mapbox_id) <= 256),
  place_name text NULL CONSTRAINT chat_plans_place_name_length CHECK (char_length(place_name) BETWEEN 1 AND 120),
  place_address text NULL CONSTRAINT chat_plans_place_address_length CHECK (char_length(place_address) <= 240),
  place_lat double precision NULL,
  place_lng double precision NULL,
  place_photo_url text NULL
    CONSTRAINT chat_plans_place_photo_url_shape CHECK (char_length(place_photo_url) <= 1024 AND place_photo_url ~ '^https://'),
  link_url text NULL
    CONSTRAINT chat_plans_link_url_shape CHECK (char_length(link_url) <= 2048 AND link_url ~* '^https?://[^\s/]+\.[^\s/]+'),
  link_domain text NULL,
  when_mode text NOT NULL CONSTRAINT chat_plans_when_mode_check CHECK (when_mode IN ('set', 'poll', 'none')),
  open_times boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'deciding'
    CONSTRAINT chat_plans_status_check CHECK (status IN ('deciding', 'scheduled', 'cancelled')),
  scheduled_at timestamptz NULL,
  duration_minutes int NULL CONSTRAINT chat_plans_duration_range CHECK (duration_minutes BETWEEN 15 AND 1440),
  locked_at timestamptz NULL,
  locked_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  cancelled_at timestamptz NULL,
  note text NULL CONSTRAINT chat_plans_note_length CHECK (char_length(note) <= 280),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chat_plans_coordinates CHECK (
    (place_lat IS NULL AND place_lng IS NULL)
    OR (place_lat BETWEEN -90 AND 90 AND place_lng BETWEEN -180 AND 180)
  ),
  CONSTRAINT chat_plans_source_shape CHECK (
    (source = 'chat' AND session_id IS NULL AND saved_card_id IS NULL)
    OR (source = 'deck' AND session_id IS NOT NULL AND saved_card_id IS NOT NULL AND message_id IS NULL
        AND where_kind = 'none' AND status = 'deciding' AND scheduled_at IS NULL AND locked_at IS NULL)
  ),
  CONSTRAINT chat_plans_where_shape CHECK (
    (where_kind = 'place' AND place_name IS NOT NULL AND (place_pool_id IS NOT NULL OR mapbox_id IS NOT NULL)
       AND link_url IS NULL AND link_domain IS NULL)
    OR (where_kind = 'address' AND place_name IS NOT NULL AND place_pool_id IS NULL AND mapbox_id IS NULL
       AND link_url IS NULL AND link_domain IS NULL)
    OR (where_kind = 'link' AND link_url IS NOT NULL AND link_domain IS NOT NULL
       AND place_pool_id IS NULL AND mapbox_id IS NULL AND place_name IS NULL AND place_address IS NULL
       AND place_lat IS NULL AND place_lng IS NULL AND place_photo_url IS NULL)
    OR (where_kind = 'none' AND place_pool_id IS NULL AND mapbox_id IS NULL AND place_name IS NULL
       AND place_address IS NULL AND place_lat IS NULL AND place_lng IS NULL AND place_photo_url IS NULL
       AND link_url IS NULL AND link_domain IS NULL)
  ),
  CONSTRAINT chat_plans_scheduled_shape CHECK (
    status <> 'scheduled' OR (scheduled_at IS NOT NULL AND duration_minutes IS NOT NULL)
  ),
  CONSTRAINT chat_plans_set_mode CHECK (when_mode <> 'set' OR status IN ('scheduled', 'cancelled')),
  CONSTRAINT chat_plans_cancelled_shape CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS chat_plans_creator_client_id
  ON public.chat_plans (created_by, client_id) WHERE client_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS chat_plans_conversation_status_created_idx
  ON public.chat_plans (conversation_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS chat_plans_session_idx
  ON public.chat_plans (session_id) WHERE session_id IS NOT NULL;
ALTER TABLE public.chat_plans REPLICA IDENTITY FULL;

DROP TRIGGER IF EXISTS tg_4261_chat_plans_updated_at ON public.chat_plans;
CREATE TRIGGER tg_4261_chat_plans_updated_at
  BEFORE UPDATE ON public.chat_plans
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── Child tables ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.chat_plan_time_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES public.chat_plans(id) ON DELETE CASCADE,
  starts_at timestamptz NOT NULL,
  added_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chat_plan_time_options_plan_starts_key UNIQUE (plan_id, starts_at)
);
CREATE INDEX IF NOT EXISTS chat_plan_time_options_plan_idx ON public.chat_plan_time_options (plan_id);

CREATE TABLE IF NOT EXISTS public.chat_plan_time_votes (
  option_id uuid NOT NULL REFERENCES public.chat_plan_time_options(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL REFERENCES public.chat_plans(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (option_id, user_id)
);
CREATE INDEX IF NOT EXISTS chat_plan_time_votes_plan_idx ON public.chat_plan_time_votes (plan_id);

CREATE TABLE IF NOT EXISTS public.chat_plan_rsvps (
  plan_id uuid NOT NULL REFERENCES public.chat_plans(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL CONSTRAINT chat_plan_rsvps_status_check CHECK (status IN ('going', 'maybe', 'cant')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (plan_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.chat_plan_reactions (
  plan_id uuid NOT NULL REFERENCES public.chat_plans(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL CONSTRAINT chat_plan_reactions_kind_check CHECK (kind IN ('up', 'down')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (plan_id, user_id)
);

-- ── RLS + grants ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.chat_plan_visible(p_plan_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.chat_plans p
     WHERE p.id = p_plan_id
       AND public.is_conversation_participant(p.conversation_id, auth.uid())
  );
$function$;
REVOKE ALL ON FUNCTION public.chat_plan_visible(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_plan_visible(uuid) TO authenticated, service_role;

ALTER TABLE public.chat_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_plan_time_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_plan_time_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_plan_rsvps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_plan_reactions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.chat_plans FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.chat_plan_time_options FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.chat_plan_time_votes FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.chat_plan_rsvps FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.chat_plan_reactions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.chat_plans TO authenticated;
GRANT SELECT ON public.chat_plan_time_options TO authenticated;
GRANT SELECT ON public.chat_plan_time_votes TO authenticated;
GRANT SELECT ON public.chat_plan_rsvps TO authenticated;
GRANT SELECT ON public.chat_plan_reactions TO authenticated;
GRANT ALL ON public.chat_plans TO service_role;
GRANT ALL ON public.chat_plan_time_options TO service_role;
GRANT ALL ON public.chat_plan_time_votes TO service_role;
GRANT ALL ON public.chat_plan_rsvps TO service_role;
GRANT ALL ON public.chat_plan_reactions TO service_role;

DROP POLICY IF EXISTS chat_plans_member_read ON public.chat_plans;
CREATE POLICY chat_plans_member_read ON public.chat_plans
  FOR SELECT TO authenticated USING (public.is_conversation_participant(conversation_id, auth.uid()));
DROP POLICY IF EXISTS chat_plan_time_options_member_read ON public.chat_plan_time_options;
CREATE POLICY chat_plan_time_options_member_read ON public.chat_plan_time_options
  FOR SELECT TO authenticated USING (public.chat_plan_visible(plan_id));
DROP POLICY IF EXISTS chat_plan_time_votes_member_read ON public.chat_plan_time_votes;
CREATE POLICY chat_plan_time_votes_member_read ON public.chat_plan_time_votes
  FOR SELECT TO authenticated USING (public.chat_plan_visible(plan_id));
DROP POLICY IF EXISTS chat_plan_rsvps_member_read ON public.chat_plan_rsvps;
CREATE POLICY chat_plan_rsvps_member_read ON public.chat_plan_rsvps
  FOR SELECT TO authenticated USING (public.chat_plan_visible(plan_id));
DROP POLICY IF EXISTS chat_plan_reactions_member_read ON public.chat_plan_reactions;
CREATE POLICY chat_plan_reactions_member_read ON public.chat_plan_reactions
  FOR SELECT TO authenticated USING (public.chat_plan_visible(plan_id));

DO $realtime$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    RETURN;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'chat_plans'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_plans;
  END IF;
END;
$realtime$;

-- ── Changes to existing tables ──────────────────────────────────────────────
ALTER TABLE public.board_card_rsvps DROP CONSTRAINT IF EXISTS board_card_rsvps_rsvp_status_check;
ALTER TABLE public.board_card_rsvps ADD CONSTRAINT board_card_rsvps_rsvp_status_check
  CHECK (rsvp_status = ANY (ARRAY['attending'::text, 'not_attending'::text, 'maybe'::text]));

ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_message_type_check;
ALTER TABLE public.messages ADD CONSTRAINT messages_message_type_check
  CHECK ((message_type)::text = ANY (ARRAY['text'::text, 'image'::text, 'video'::text, 'file'::text,
    'card'::text, 'system'::text, 'brand_enquiry_card'::text, 'plan'::text]));

ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS plan_id uuid NULL;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS plan_quote jsonb NULL;
ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_plan_id_fkey;
ALTER TABLE public.messages ADD CONSTRAINT messages_plan_id_fkey
  FOREIGN KEY (plan_id) REFERENCES public.chat_plans(id) ON DELETE SET NULL;
ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_plan_quote_needs_plan;
ALTER TABLE public.messages ADD CONSTRAINT messages_plan_quote_needs_plan
  CHECK (plan_quote IS NULL OR plan_id IS NOT NULL);
ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_plan_shape;
ALTER TABLE public.messages ADD CONSTRAINT messages_plan_shape
  CHECK ((message_type)::text <> 'plan' OR (plan_id IS NOT NULL AND card_payload ->> 'kind' = 'plan'));
CREATE INDEX IF NOT EXISTS messages_plan_id_created_idx
  ON public.messages (plan_id, created_at) WHERE plan_id IS NOT NULL;

ALTER TABLE public.calendar_entries ADD COLUMN IF NOT EXISTS chat_plan_id uuid NULL;
ALTER TABLE public.calendar_entries DROP CONSTRAINT IF EXISTS calendar_entries_chat_plan_id_fkey;
ALTER TABLE public.calendar_entries ADD CONSTRAINT calendar_entries_chat_plan_id_fkey
  FOREIGN KEY (chat_plan_id) REFERENCES public.chat_plans(id) ON DELETE CASCADE;
ALTER TABLE public.calendar_entries DROP CONSTRAINT IF EXISTS calendar_entries_source_check;
ALTER TABLE public.calendar_entries ADD CONSTRAINT calendar_entries_source_check
  CHECK (source = ANY (ARRAY['solo'::text, 'collaboration'::text, 'chat_plan'::text]));
ALTER TABLE public.calendar_entries DROP CONSTRAINT IF EXISTS calendar_entries_chat_plan_shape;
ALTER TABLE public.calendar_entries ADD CONSTRAINT calendar_entries_chat_plan_shape
  CHECK ((source = 'chat_plan') = (chat_plan_id IS NOT NULL));
CREATE UNIQUE INDEX IF NOT EXISTS calendar_entries_user_chat_plan
  ON public.calendar_entries (user_id, chat_plan_id) WHERE chat_plan_id IS NOT NULL;

-- ── Internal helpers (service_role only) ───────────────────────────────────
-- Raises unless p_uid may act on plans in this chat: a plan chat, a member,
-- and no block with any other member.
CREATE OR REPLACE FUNCTION public.chat_plan_require_member(p_conversation_id uuid, p_uid uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
DECLARE
  v_kind text := public.chat_plan_chat_kind(p_conversation_id);
BEGIN
  IF v_kind IS NULL OR NOT public.is_conversation_participant(p_conversation_id, p_uid) THEN
    RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
  END IF;
  IF public.chat_member_blocked(p_conversation_id, p_uid) THEN
    RAISE EXCEPTION 'unavailable' USING ERRCODE = '42501';
  END IF;
  RETURN v_kind;
END;
$function$;
REVOKE ALL ON FUNCTION public.chat_plan_require_member(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.chat_plan_require_member(uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.chat_plan_can_lock(p_plan public.chat_plans, p_user uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
  SELECT CASE
    WHEN p_user IS NULL THEN false
    WHEN p_plan.source = 'deck' THEN EXISTS (
      SELECT 1 FROM public.collaboration_sessions cs
       WHERE cs.id = p_plan.session_id
         AND (cs.created_by = p_user OR EXISTS (
           SELECT 1 FROM public.session_participants sp
            WHERE sp.session_id = cs.id AND sp.user_id = p_user AND sp.is_admin IS TRUE
         ))
    )
    WHEN p_plan.created_by IS NOT NULL
         AND public.is_conversation_participant(p_plan.conversation_id, p_plan.created_by)
      THEN p_plan.created_by = p_user
    ELSE public.chat_group_is_admin(p_plan.conversation_id, p_user)
  END;
$function$;
REVOKE ALL ON FUNCTION public.chat_plan_can_lock(public.chat_plans, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.chat_plan_can_lock(public.chat_plans, uuid) TO service_role;

-- Effective status: a deck plan is scheduled once its saved card is locked.
CREATE OR REPLACE FUNCTION public.chat_plan_effective_status(p_plan public.chat_plans)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
  SELECT CASE
    WHEN p_plan.source = 'deck' THEN
      CASE WHEN COALESCE((SELECT bsc.is_locked FROM public.board_saved_cards bsc WHERE bsc.id = p_plan.saved_card_id), false)
           THEN 'scheduled' ELSE 'deciding' END
    ELSE p_plan.status
  END;
$function$;
REVOKE ALL ON FUNCTION public.chat_plan_effective_status(public.chat_plans) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.chat_plan_effective_status(public.chat_plans) TO service_role;

CREATE OR REPLACE FUNCTION public.chat_plan_post_event(
  p_conversation_id uuid, p_plan_id uuid, p_event text, p_actor uuid, p_extra jsonb, p_content text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.messages (conversation_id, sender_id, content, message_type, card_payload)
  VALUES (
    p_conversation_id, NULL, p_content, 'system',
    jsonb_build_object('kind', 'plan_event', 'event', p_event, 'planId', p_plan_id, 'actorId', p_actor)
      || COALESCE(p_extra, '{}'::jsonb)
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.chat_plan_post_event(uuid, uuid, text, uuid, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.chat_plan_post_event(uuid, uuid, text, uuid, jsonb, text) TO service_role;

-- The only writer of calendar_entries rows that carry chat_plan_id.
CREATE OR REPLACE FUNCTION public.chat_plan_sync_calendar(p_plan_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
DECLARE
  v_plan public.chat_plans%ROWTYPE;
  v_card jsonb;
BEGIN
  SELECT * INTO v_plan FROM public.chat_plans WHERE id = p_plan_id;
  IF NOT FOUND OR v_plan.source <> 'chat' THEN
    RETURN;
  END IF;

  IF v_plan.status <> 'scheduled' THEN
    DELETE FROM public.calendar_entries WHERE chat_plan_id = v_plan.id;
    RETURN;
  END IF;

  DELETE FROM public.calendar_entries ce
   WHERE ce.chat_plan_id = v_plan.id
     AND NOT EXISTS (
       SELECT 1 FROM public.chat_plan_rsvps r
        WHERE r.plan_id = v_plan.id AND r.user_id = ce.user_id AND r.status = 'going'
          AND public.is_conversation_participant(v_plan.conversation_id, r.user_id)
     );

  v_card := jsonb_build_object(
    'title', v_plan.title,
    'image', v_plan.place_photo_url,
    'address', v_plan.place_address,
    'placeName', v_plan.place_name,
    'linkUrl', v_plan.link_url,
    'planId', v_plan.id,
    'conversationId', v_plan.conversation_id,
    'source', 'chat_plan'
  );

  INSERT INTO public.calendar_entries (
    user_id, source, card_data, status, scheduled_at, duration_minutes, chat_plan_id
  )
  SELECT r.user_id, 'chat_plan', v_card, 'confirmed', v_plan.scheduled_at, v_plan.duration_minutes, v_plan.id
    FROM public.chat_plan_rsvps r
   WHERE r.plan_id = v_plan.id AND r.status = 'going'
     AND public.is_conversation_participant(v_plan.conversation_id, r.user_id)
  ON CONFLICT (user_id, chat_plan_id) WHERE chat_plan_id IS NOT NULL DO UPDATE
    SET scheduled_at = EXCLUDED.scheduled_at,
        duration_minutes = EXCLUDED.duration_minutes,
        card_data = EXCLUDED.card_data,
        status = 'confirmed',
        updated_at = now();
END;
$function$;
REVOKE ALL ON FUNCTION public.chat_plan_sync_calendar(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.chat_plan_sync_calendar(uuid) TO service_role;

-- Validates a timestamp for a plan time: in the future and within a year.
CREATE OR REPLACE FUNCTION public.chat_plan_check_time(p_at timestamptz, p_field text)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
BEGIN
  IF p_at IS NULL OR p_at <= now() OR p_at > now() + interval '1 year' THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023', DETAIL = p_field;
  END IF;
END;
$function$;
REVOKE ALL ON FUNCTION public.chat_plan_check_time(timestamptz, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.chat_plan_check_time(timestamptz, text) TO service_role;

-- ── Message triggers ────────────────────────────────────────────────────────
-- MINGLA-INVARIANT lives in the pg17 suite: I-4261-PLAN-MESSAGES-RPC-ONLY.
-- Only clients are guarded (the house pattern: auth.role() authenticated or
-- anon). The plan RPCs open the gate with a transaction-local setting and
-- close it again; foreign-key cascades (nested triggers) pass.
CREATE OR REPLACE FUNCTION public.tg_4261_guard_plan_messages()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
DECLARE
  v_client boolean := COALESCE(auth.role(), '') IN ('authenticated', 'anon');
BEGIN
  IF NOT v_client
     OR current_setting('issue_4261.plan_write', true) = 'on'
     OR pg_trigger_depth() > 1 THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    -- A deleted plan clears plan_id (ON DELETE SET NULL); its quote goes too,
    -- so messages_plan_quote_needs_plan holds.
    IF TG_OP = 'UPDATE' AND NEW.plan_id IS NULL AND NEW.plan_quote IS NOT NULL THEN
      NEW.plan_quote := NULL;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.message_type = 'plan' THEN
      RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.message_type = 'plan' THEN
      RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;

  -- UPDATE
  IF NEW.message_type = 'plan' AND OLD.message_type IS DISTINCT FROM 'plan' THEN
    RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
  END IF;
  IF OLD.message_type = 'plan' AND (
       NEW.message_type IS DISTINCT FROM OLD.message_type
    OR NEW.card_payload IS DISTINCT FROM OLD.card_payload
    OR NEW.plan_id IS DISTINCT FROM OLD.plan_id
    OR NEW.content IS DISTINCT FROM OLD.content
    OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at
    OR NEW.conversation_id IS DISTINCT FROM OLD.conversation_id
    OR NEW.sender_id IS DISTINCT FROM OLD.sender_id) THEN
    RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
  END IF;
  -- plan_id / plan_quote are server-owned on every message: a client edit
  -- keeps the stored values.
  NEW.plan_id := OLD.plan_id;
  NEW.plan_quote := OLD.plan_quote;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.tg_4261_guard_plan_messages() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS tg_4261_guard_plan_messages ON public.messages;
CREATE TRIGGER tg_4261_guard_plan_messages
  BEFORE INSERT OR UPDATE OR DELETE ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.tg_4261_guard_plan_messages();

-- Sets plan_id + plan_quote on every non-plan insert, from the server's view.
CREATE OR REPLACE FUNCTION public.tg_4261_plan_comment_fields()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
DECLARE
  v_plan public.chat_plans%ROWTYPE;
  v_reply_plan uuid;
  v_votes jsonb;
  v_rsvp text;
BEGIN
  IF NEW.message_type = 'plan' THEN
    RETURN NEW;
  END IF;

  IF NEW.reply_to_id IS NOT NULL THEN
    SELECT m.plan_id INTO v_reply_plan
      FROM public.messages m
     WHERE m.id = NEW.reply_to_id AND m.message_type = 'plan'
       AND m.conversation_id = NEW.conversation_id;
  END IF;

  IF v_reply_plan IS NOT NULL THEN
    NEW.plan_id := v_reply_plan;
  ELSIF NEW.plan_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.chat_plans p
       WHERE p.id = NEW.plan_id AND p.conversation_id = NEW.conversation_id AND p.status <> 'cancelled'
    ) THEN
      NEW.plan_id := NULL;
    END IF;
  ELSE
    NEW.plan_id := NULL;
  END IF;

  NEW.plan_quote := NULL;
  IF NEW.plan_id IS NOT NULL AND NEW.sender_id IS NOT NULL AND NEW.message_type <> 'system' THEN
    SELECT * INTO v_plan FROM public.chat_plans WHERE id = NEW.plan_id;
    SELECT COALESCE(jsonb_agg(to_jsonb(o.starts_at) ORDER BY o.starts_at), '[]'::jsonb) INTO v_votes
      FROM public.chat_plan_time_votes v
      JOIN public.chat_plan_time_options o ON o.id = v.option_id
     WHERE v.plan_id = v_plan.id AND v.user_id = NEW.sender_id;
    IF v_plan.source = 'chat' THEN
      SELECT r.status INTO v_rsvp FROM public.chat_plan_rsvps r
       WHERE r.plan_id = v_plan.id AND r.user_id = NEW.sender_id;
    ELSE
      SELECT CASE r.rsvp_status WHEN 'attending' THEN 'going' WHEN 'maybe' THEN 'maybe'
                                WHEN 'not_attending' THEN 'cant' END
        INTO v_rsvp
        FROM public.board_card_rsvps r
       WHERE r.session_id = v_plan.session_id AND r.saved_card_id = v_plan.saved_card_id
         AND r.user_id = NEW.sender_id;
    END IF;
    NEW.plan_quote := jsonb_build_object('title', v_plan.title, 'votedStartsAt', v_votes, 'rsvp', v_rsvp);
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.tg_4261_plan_comment_fields() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS tg_4261_plan_comment_fields ON public.messages;
CREATE TRIGGER tg_4261_plan_comment_fields
  BEFORE INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.tg_4261_plan_comment_fields();

CREATE OR REPLACE FUNCTION public.tg_4261_bump_plan_on_comment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
BEGIN
  UPDATE public.chat_plans SET updated_at = now() WHERE id = NEW.plan_id;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.tg_4261_bump_plan_on_comment() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS tg_4261_bump_plan_on_comment ON public.messages;
CREATE TRIGGER tg_4261_bump_plan_on_comment
  AFTER INSERT ON public.messages
  FOR EACH ROW WHEN (NEW.plan_id IS NOT NULL)
  EXECUTE FUNCTION public.tg_4261_bump_plan_on_comment();

-- ── Deck matches get their chat_plans row ──────────────────────────────────
-- MINGLA-INVARIANT lives in the pg17 suite: I-4261-ONE-PLAN-ENTITY.
CREATE OR REPLACE FUNCTION public.tg_4261_deck_plan_on_saved_card()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
DECLARE
  v_conversation_id uuid;
BEGIN
  BEGIN
    v_conversation_id := public.resolve_session_conversation(NEW.session_id);
    IF v_conversation_id IS NOT NULL THEN
      INSERT INTO public.chat_plans (
        conversation_id, source, session_id, saved_card_id, created_by, title, when_mode, open_times
      ) VALUES (
        v_conversation_id, 'deck', NEW.session_id, NEW.id, NEW.saved_by,
        left(COALESCE(NULLIF(btrim(NEW.card_data ->> 'title'), ''), 'Match'), 80),
        'none', true
      )
      ON CONFLICT (saved_card_id) DO NOTHING;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- Match promotion (check_mutual_like) must never fail because of plans.
    RAISE WARNING 'issue_4261 deck plan not created for saved card %: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.tg_4261_deck_plan_on_saved_card() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS tg_4261_deck_plan_on_saved_card ON public.board_saved_cards;
CREATE TRIGGER tg_4261_deck_plan_on_saved_card
  AFTER INSERT ON public.board_saved_cards
  FOR EACH ROW EXECUTE FUNCTION public.tg_4261_deck_plan_on_saved_card();

CREATE OR REPLACE FUNCTION public.tg_4261_bump_deck_plan()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
DECLARE
  v_saved_card_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_saved_card_id := OLD.saved_card_id;
  ELSIF TG_TABLE_NAME = 'board_saved_cards' THEN
    v_saved_card_id := NEW.id;
  ELSE
    v_saved_card_id := NEW.saved_card_id;
  END IF;
  IF v_saved_card_id IS NOT NULL THEN
    UPDATE public.chat_plans SET updated_at = now() WHERE saved_card_id = v_saved_card_id;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.tg_4261_bump_deck_plan() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS tg_4261_bump_deck_plan ON public.board_votes;
CREATE TRIGGER tg_4261_bump_deck_plan
  AFTER INSERT OR UPDATE OR DELETE ON public.board_votes
  FOR EACH ROW EXECUTE FUNCTION public.tg_4261_bump_deck_plan();
DROP TRIGGER IF EXISTS tg_4261_bump_deck_plan ON public.board_card_rsvps;
CREATE TRIGGER tg_4261_bump_deck_plan
  AFTER INSERT OR UPDATE OR DELETE ON public.board_card_rsvps
  FOR EACH ROW EXECUTE FUNCTION public.tg_4261_bump_deck_plan();
DROP TRIGGER IF EXISTS tg_4261_bump_deck_plan ON public.board_saved_cards;
CREATE TRIGGER tg_4261_bump_deck_plan
  AFTER UPDATE OF is_locked ON public.board_saved_cards
  FOR EACH ROW EXECUTE FUNCTION public.tg_4261_bump_deck_plan();

-- Backfill: one deck plan per existing saved card whose session has a chat.
INSERT INTO public.chat_plans (
  conversation_id, source, session_id, saved_card_id, created_by, title, when_mode, open_times, created_at
)
SELECT conv.id, 'deck', bsc.session_id, bsc.id, bsc.saved_by,
       left(COALESCE(NULLIF(btrim(bsc.card_data ->> 'title'), ''), 'Match'), 80),
       'none', true, COALESCE(bsc.saved_at, now())
  FROM public.board_saved_cards bsc
  CROSS JOIN LATERAL (SELECT public.resolve_session_conversation(bsc.session_id) AS id) conv
 WHERE conv.id IS NOT NULL
ON CONFLICT (saved_card_id) DO NOTHING;

-- ── Plan RPCs ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.plan_create(
  p_conversation_id uuid,
  p_client_id uuid,
  p_title text,
  p_where_kind text,
  p_place jsonb,
  p_link_url text,
  p_when_mode text,
  p_scheduled_at timestamptz,
  p_options timestamptz[],
  p_open_times boolean,
  p_note text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_existing public.chat_plans%ROWTYPE;
  v_place public.place_pool%ROWTYPE;
  v_where text := COALESCE(p_where_kind, 'none');
  v_when text := p_when_mode;
  v_title text := NULLIF(btrim(COALESCE(p_title, '')), '');
  v_note text := NULLIF(btrim(COALESCE(p_note, '')), '');
  v_open boolean := COALESCE(p_open_times, true);
  v_pool_id uuid;
  v_mapbox_id text;
  v_name text;
  v_address text;
  v_lat double precision;
  v_lng double precision;
  v_photo text;
  v_link text;
  v_domain text;
  v_options timestamptz[] := COALESCE(p_options, ARRAY[]::timestamptz[]);
  v_opt timestamptz;
  v_status text;
  v_plan_id uuid;
  v_message_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;
  PERFORM public.chat_plan_require_member(p_conversation_id, v_uid);

  -- Idempotency.
  IF p_client_id IS NOT NULL THEN
    SELECT * INTO v_existing FROM public.chat_plans
     WHERE created_by = v_uid AND client_id = p_client_id;
    IF FOUND THEN
      RETURN jsonb_build_object('planId', v_existing.id, 'messageId', v_existing.message_id, 'created', false);
    END IF;
  END IF;

  -- Rate.
  IF (SELECT count(*) FROM public.chat_plans
       WHERE created_by = v_uid AND source = 'chat' AND created_at > now() - interval '24 hours') >= 30 THEN
    RAISE EXCEPTION 'conflict_rate_limited' USING ERRCODE = 'PT409';
  END IF;

  -- Where.
  IF v_where NOT IN ('place', 'address', 'link', 'none') THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023', DETAIL = 'p_where_kind';
  END IF;
  IF v_where IN ('place', 'address') AND (p_place IS NULL OR jsonb_typeof(p_place) <> 'object') THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023', DETAIL = 'p_place';
  END IF;

  IF v_where = 'place' AND p_place ? 'poolId' AND p_place ->> 'poolId' IS NOT NULL THEN
    IF (p_place ->> 'poolId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023', DETAIL = 'p_place.poolId';
    END IF;
    SELECT * INTO v_place FROM public.place_pool
     WHERE id = (p_place ->> 'poolId')::uuid AND is_active IS TRUE AND is_servable IS TRUE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023', DETAIL = 'p_place.poolId';
    END IF;
    v_pool_id := v_place.id;
    v_name := left(btrim(v_place.name), 120);
    v_address := left(COALESCE(NULLIF(btrim(v_place.address), ''), NULLIF(btrim(v_place.city), '')), 240);
    v_lat := v_place.lat;
    v_lng := v_place.lng;
    v_photo := v_place.stored_photo_urls[1];
    IF v_photo IS NOT NULL AND (v_photo !~ '^https://' OR char_length(v_photo) > 1024) THEN
      v_photo := NULL;
    END IF;
  ELSIF v_where = 'place' THEN
    v_mapbox_id := NULLIF(btrim(COALESCE(p_place ->> 'mapboxId', '')), '');
    v_name := NULLIF(btrim(COALESCE(p_place ->> 'name', '')), '');
    v_address := NULLIF(btrim(COALESCE(p_place ->> 'address', '')), '');
    IF v_mapbox_id IS NULL OR char_length(v_mapbox_id) > 256 THEN
      RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023', DETAIL = 'p_place.mapboxId';
    END IF;
    IF v_name IS NULL OR char_length(v_name) > 120 THEN
      RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023', DETAIL = 'p_place.name';
    END IF;
    IF char_length(v_address) > 240 THEN
      RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023', DETAIL = 'p_place.address';
    END IF;
    IF jsonb_typeof(p_place -> 'lat') <> 'number' OR jsonb_typeof(p_place -> 'lng') <> 'number' THEN
      RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023', DETAIL = 'p_place.lat';
    END IF;
    v_lat := (p_place ->> 'lat')::double precision;
    v_lng := (p_place ->> 'lng')::double precision;
    IF v_lat NOT BETWEEN -90 AND 90 OR v_lng NOT BETWEEN -180 AND 180 THEN
      RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023', DETAIL = 'p_place.lat';
    END IF;
  ELSIF v_where = 'address' THEN
    v_name := NULLIF(btrim(COALESCE(p_place ->> 'name', '')), '');
    v_address := NULLIF(btrim(COALESCE(p_place ->> 'address', '')), '');
    IF v_name IS NULL OR char_length(v_name) > 120 THEN
      RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023', DETAIL = 'p_place.name';
    END IF;
    IF char_length(v_address) > 240 THEN
      RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023', DETAIL = 'p_place.address';
    END IF;
    IF jsonb_typeof(p_place -> 'lat') = 'number' AND jsonb_typeof(p_place -> 'lng') = 'number' THEN
      v_lat := (p_place ->> 'lat')::double precision;
      v_lng := (p_place ->> 'lng')::double precision;
      IF v_lat NOT BETWEEN -90 AND 90 OR v_lng NOT BETWEEN -180 AND 180 THEN
        RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023', DETAIL = 'p_place.lat';
      END IF;
    END IF;
  ELSIF v_where = 'link' THEN
    v_link := btrim(COALESCE(p_link_url, ''));
    IF char_length(v_link) > 2048 OR v_link !~* '^https?://[^\s/]+\.[^\s/]+' THEN
      RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023', DETAIL = 'p_link_url';
    END IF;
    v_domain := lower(substring(v_link from '^[A-Za-z]+://(?:[^/?#@]*@)?([^/?#:]+)'));
    v_domain := regexp_replace(COALESCE(v_domain, ''), '^www\.', '');
    IF v_domain = '' OR position('.' in v_domain) = 0 THEN
      RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023', DETAIL = 'p_link_url';
    END IF;
  END IF;

  -- Title.
  IF v_title IS NOT NULL AND char_length(v_title) > 80 THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023', DETAIL = 'p_title';
  END IF;
  v_title := left(btrim(COALESCE(v_title, v_name, v_domain, 'New plan')), 80);

  IF v_note IS NOT NULL AND char_length(v_note) > 280 THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023', DETAIL = 'p_note';
  END IF;

  -- When.
  IF v_when IS NULL OR v_when NOT IN ('set', 'poll', 'none') THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023', DETAIL = 'p_when_mode';
  END IF;
  IF v_when = 'set' THEN
    PERFORM public.chat_plan_check_time(p_scheduled_at, 'p_scheduled_at');
    v_status := 'scheduled';
  ELSIF v_when = 'poll' THEN
    IF cardinality(v_options) > 5
       OR (SELECT count(DISTINCT x) FROM unnest(v_options) x) <> cardinality(v_options)
       OR (NOT v_open AND cardinality(v_options) < 2) THEN
      RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023', DETAIL = 'p_options';
    END IF;
    FOREACH v_opt IN ARRAY v_options LOOP
      PERFORM public.chat_plan_check_time(v_opt, 'p_options');
    END LOOP;
    v_status := 'deciding';
  ELSE
    v_status := 'deciding';
  END IF;

  INSERT INTO public.chat_plans (
    conversation_id, source, created_by, client_id, title, where_kind,
    place_pool_id, mapbox_id, place_name, place_address, place_lat, place_lng, place_photo_url,
    link_url, link_domain, when_mode, open_times, status, scheduled_at, duration_minutes,
    locked_at, locked_by, note
  ) VALUES (
    p_conversation_id, 'chat', v_uid, p_client_id, v_title, v_where,
    v_pool_id, v_mapbox_id, v_name, v_address, v_lat, v_lng, v_photo,
    v_link, NULLIF(v_domain, ''), v_when, v_open, v_status,
    CASE WHEN v_when = 'set' THEN p_scheduled_at END,
    CASE WHEN v_when = 'set' THEN 120 END,
    CASE WHEN v_when = 'set' THEN now() END,
    CASE WHEN v_when = 'set' THEN v_uid END,
    v_note
  )
  RETURNING id INTO v_plan_id;

  IF v_when = 'poll' THEN
    INSERT INTO public.chat_plan_time_options (plan_id, starts_at, added_by)
    SELECT v_plan_id, x, v_uid FROM unnest(v_options) x;
  END IF;

  INSERT INTO public.chat_plan_rsvps (plan_id, user_id, status) VALUES (v_plan_id, v_uid, 'going');

  PERFORM set_config('issue_4261.plan_write', 'on', true);
  INSERT INTO public.messages (conversation_id, sender_id, content, message_type, card_payload, plan_id)
  VALUES (
    p_conversation_id, v_uid,
    public.issue_4114_first_name(v_uid) || ' added a plan: ' || v_title,
    'plan', jsonb_build_object('kind', 'plan', 'planId', v_plan_id), v_plan_id
  )
  RETURNING id INTO v_message_id;
  PERFORM set_config('issue_4261.plan_write', 'off', true);

  UPDATE public.chat_plans SET message_id = v_message_id WHERE id = v_plan_id;

  IF v_when = 'set' THEN
    PERFORM public.chat_plan_sync_calendar(v_plan_id);
  END IF;

  RETURN jsonb_build_object('planId', v_plan_id, 'messageId', v_message_id, 'created', true);
END;
$function$;
REVOKE ALL ON FUNCTION public.plan_create(uuid, uuid, text, text, jsonb, text, text, timestamptz, timestamptz[], boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.plan_create(uuid, uuid, text, text, jsonb, text, text, timestamptz, timestamptz[], boolean, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.plan_add_option(p_plan_id uuid, p_starts_at timestamptz)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_plan public.chat_plans%ROWTYPE;
  v_option_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;
  SELECT * INTO v_plan FROM public.chat_plans WHERE id = p_plan_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public.chat_plan_require_member(v_plan.conversation_id, v_uid);

  IF public.chat_plan_effective_status(v_plan) <> 'deciding' THEN
    RAISE EXCEPTION 'conflict_plan_not_deciding' USING ERRCODE = 'PT409';
  END IF;
  IF NOT v_plan.open_times AND v_plan.created_by IS DISTINCT FROM v_uid
     AND NOT public.chat_plan_can_lock(v_plan, v_uid) THEN
    RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
  END IF;
  PERFORM public.chat_plan_check_time(p_starts_at, 'p_starts_at');

  SELECT id INTO v_option_id FROM public.chat_plan_time_options
   WHERE plan_id = v_plan.id AND starts_at = p_starts_at;
  IF v_option_id IS NOT NULL THEN
    INSERT INTO public.chat_plan_time_votes (option_id, plan_id, user_id)
    VALUES (v_option_id, v_plan.id, v_uid)
    ON CONFLICT (option_id, user_id) DO NOTHING;
    UPDATE public.chat_plans SET updated_at = now() WHERE id = v_plan.id;
    RETURN jsonb_build_object('optionId', v_option_id, 'existed', true);
  END IF;

  IF (SELECT count(*) FROM public.chat_plan_time_options WHERE plan_id = v_plan.id) >= 8 THEN
    RAISE EXCEPTION 'conflict_too_many_times' USING ERRCODE = 'PT409';
  END IF;

  INSERT INTO public.chat_plan_time_options (plan_id, starts_at, added_by)
  VALUES (v_plan.id, p_starts_at, v_uid)
  RETURNING id INTO v_option_id;
  INSERT INTO public.chat_plan_time_votes (option_id, plan_id, user_id)
  VALUES (v_option_id, v_plan.id, v_uid);

  UPDATE public.chat_plans
     SET when_mode = CASE WHEN when_mode = 'none' THEN 'poll' ELSE when_mode END,
         updated_at = now()
   WHERE id = v_plan.id;

  IF NOT (v_plan.created_by IS NOT DISTINCT FROM v_uid AND v_plan.created_at > now() - interval '60 seconds') THEN
    PERFORM public.chat_plan_post_event(
      v_plan.conversation_id, v_plan.id, 'time_added', v_uid,
      jsonb_build_object('startsAt', p_starts_at),
      public.issue_4114_first_name(v_uid) || ' added a time to the vote on ' || v_plan.title
    );
  END IF;

  RETURN jsonb_build_object('optionId', v_option_id, 'existed', false);
END;
$function$;
REVOKE ALL ON FUNCTION public.plan_add_option(uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.plan_add_option(uuid, timestamptz) TO authenticated;

CREATE OR REPLACE FUNCTION public.plan_set_vote(p_option_id uuid, p_on boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_plan public.chat_plans%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;
  IF p_on IS NULL THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023', DETAIL = 'p_on';
  END IF;
  SELECT p.* INTO v_plan
    FROM public.chat_plan_time_options o
    JOIN public.chat_plans p ON p.id = o.plan_id
   WHERE o.id = p_option_id
   FOR UPDATE OF p;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public.chat_plan_require_member(v_plan.conversation_id, v_uid);
  IF public.chat_plan_effective_status(v_plan) <> 'deciding' THEN
    RAISE EXCEPTION 'conflict_plan_not_deciding' USING ERRCODE = 'PT409';
  END IF;

  IF p_on THEN
    INSERT INTO public.chat_plan_time_votes (option_id, plan_id, user_id)
    VALUES (p_option_id, v_plan.id, v_uid)
    ON CONFLICT (option_id, user_id) DO NOTHING;
  ELSE
    DELETE FROM public.chat_plan_time_votes WHERE option_id = p_option_id AND user_id = v_uid;
  END IF;
  UPDATE public.chat_plans SET updated_at = now() WHERE id = v_plan.id;
  RETURN jsonb_build_object('optionId', p_option_id, 'on', p_on);
END;
$function$;
REVOKE ALL ON FUNCTION public.plan_set_vote(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.plan_set_vote(uuid, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.plan_set_rsvp(p_plan_id uuid, p_status text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_plan public.chat_plans%ROWTYPE;
  v_deck text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;
  IF p_status IS NOT NULL AND p_status NOT IN ('going', 'maybe', 'cant') THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023', DETAIL = 'p_status';
  END IF;
  SELECT * INTO v_plan FROM public.chat_plans WHERE id = p_plan_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public.chat_plan_require_member(v_plan.conversation_id, v_uid);
  IF v_plan.status = 'cancelled' THEN
    RAISE EXCEPTION 'conflict_plan_cancelled' USING ERRCODE = 'PT409';
  END IF;

  IF v_plan.source = 'chat' THEN
    IF p_status IS NULL THEN
      DELETE FROM public.chat_plan_rsvps WHERE plan_id = v_plan.id AND user_id = v_uid;
    ELSE
      INSERT INTO public.chat_plan_rsvps (plan_id, user_id, status)
      VALUES (v_plan.id, v_uid, p_status)
      ON CONFLICT (plan_id, user_id) DO UPDATE SET status = EXCLUDED.status, updated_at = now();
    END IF;
    IF v_plan.status = 'scheduled' THEN
      PERFORM public.chat_plan_sync_calendar(v_plan.id);
    END IF;
  ELSE
    v_deck := CASE p_status WHEN 'going' THEN 'attending' WHEN 'maybe' THEN 'maybe' WHEN 'cant' THEN 'not_attending' END;
    IF v_deck IS NULL THEN
      DELETE FROM public.board_card_rsvps
       WHERE session_id = v_plan.session_id AND saved_card_id = v_plan.saved_card_id AND user_id = v_uid;
    ELSE
      INSERT INTO public.board_card_rsvps (session_id, saved_card_id, user_id, rsvp_status)
      VALUES (v_plan.session_id, v_plan.saved_card_id, v_uid, v_deck)
      ON CONFLICT (session_id, saved_card_id, user_id) DO UPDATE
        SET rsvp_status = EXCLUDED.rsvp_status, updated_at = now();
    END IF;
  END IF;

  UPDATE public.chat_plans SET updated_at = now() WHERE id = v_plan.id;
  RETURN jsonb_build_object('status', p_status);
END;
$function$;
REVOKE ALL ON FUNCTION public.plan_set_rsvp(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.plan_set_rsvp(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.plan_set_reaction(p_plan_id uuid, p_kind text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_plan public.chat_plans%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;
  IF p_kind IS NOT NULL AND p_kind NOT IN ('up', 'down') THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023', DETAIL = 'p_kind';
  END IF;
  SELECT * INTO v_plan FROM public.chat_plans WHERE id = p_plan_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public.chat_plan_require_member(v_plan.conversation_id, v_uid);
  IF v_plan.status = 'cancelled' THEN
    RAISE EXCEPTION 'conflict_plan_cancelled' USING ERRCODE = 'PT409';
  END IF;

  IF v_plan.source = 'chat' THEN
    IF p_kind IS NULL THEN
      DELETE FROM public.chat_plan_reactions WHERE plan_id = v_plan.id AND user_id = v_uid;
    ELSE
      INSERT INTO public.chat_plan_reactions (plan_id, user_id, kind)
      VALUES (v_plan.id, v_uid, p_kind)
      ON CONFLICT (plan_id, user_id) DO UPDATE SET kind = EXCLUDED.kind, updated_at = now();
    END IF;
  ELSE
    IF p_kind IS NULL THEN
      DELETE FROM public.board_votes
       WHERE session_id = v_plan.session_id AND saved_card_id = v_plan.saved_card_id AND user_id = v_uid;
    ELSE
      INSERT INTO public.board_votes (session_id, saved_card_id, user_id, vote_type)
      VALUES (v_plan.session_id, v_plan.saved_card_id, v_uid, p_kind)
      ON CONFLICT (session_id, saved_card_id, user_id) DO UPDATE
        SET vote_type = EXCLUDED.vote_type, updated_at = now();
    END IF;
  END IF;

  UPDATE public.chat_plans SET updated_at = now() WHERE id = v_plan.id;
  RETURN jsonb_build_object('kind', p_kind);
END;
$function$;
REVOKE ALL ON FUNCTION public.plan_set_reaction(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.plan_set_reaction(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.plan_lock(
  p_plan_id uuid,
  p_option_id uuid DEFAULT NULL,
  p_scheduled_at timestamptz DEFAULT NULL,
  p_duration_minutes int DEFAULT 120)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_plan public.chat_plans%ROWTYPE;
  v_at timestamptz;
  v_duration int := COALESCE(p_duration_minutes, 120);
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;
  SELECT * INTO v_plan FROM public.chat_plans WHERE id = p_plan_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public.chat_plan_require_member(v_plan.conversation_id, v_uid);
  IF NOT public.chat_plan_can_lock(v_plan, v_uid) THEN
    RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
  END IF;

  IF (p_option_id IS NULL) = (p_scheduled_at IS NULL) THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023', DETAIL = 'p_option_id';
  END IF;
  IF p_option_id IS NOT NULL THEN
    SELECT starts_at INTO v_at FROM public.chat_plan_time_options
     WHERE id = p_option_id AND plan_id = v_plan.id;
    IF v_at IS NULL THEN
      RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023', DETAIL = 'p_option_id';
    END IF;
  ELSE
    v_at := p_scheduled_at;
  END IF;
  PERFORM public.chat_plan_check_time(v_at, 'p_scheduled_at');
  IF v_duration < 15 OR v_duration > 1440 THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023', DETAIL = 'p_duration_minutes';
  END IF;

  IF v_plan.source = 'chat' THEN
    IF v_plan.status <> 'deciding' THEN
      RAISE EXCEPTION 'conflict_plan_not_deciding' USING ERRCODE = 'PT409';
    END IF;
    UPDATE public.chat_plans
       SET status = 'scheduled', scheduled_at = v_at, duration_minutes = v_duration,
           locked_at = now(), locked_by = v_uid, updated_at = now()
     WHERE id = v_plan.id;
    PERFORM public.chat_plan_sync_calendar(v_plan.id);
    PERFORM public.chat_plan_post_event(
      v_plan.conversation_id, v_plan.id, 'locked', v_uid,
      jsonb_build_object('scheduledAt', v_at),
      public.issue_4114_first_name(v_uid) || ' locked in ' || v_plan.title
    );
  ELSE
    IF public.chat_plan_effective_status(v_plan) <> 'deciding' THEN
      RAISE EXCEPTION 'conflict_plan_not_deciding' USING ERRCODE = 'PT409';
    END IF;
    PERFORM public.rpc_admin_lock_and_schedule_card(v_plan.session_id, v_plan.saved_card_id, v_at, v_duration);
    UPDATE public.chat_plans SET updated_at = now() WHERE id = v_plan.id;
  END IF;

  RETURN jsonb_build_object('planId', v_plan.id, 'scheduledAt', v_at);
END;
$function$;
REVOKE ALL ON FUNCTION public.plan_lock(uuid, uuid, timestamptz, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.plan_lock(uuid, uuid, timestamptz, int) TO authenticated;

CREATE OR REPLACE FUNCTION public.plan_update(p_plan_id uuid, p_title text, p_note text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_plan public.chat_plans%ROWTYPE;
  v_title text := NULLIF(btrim(COALESCE(p_title, '')), '');
  v_note text := NULLIF(btrim(COALESCE(p_note, '')), '');
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;
  SELECT * INTO v_plan FROM public.chat_plans WHERE id = p_plan_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public.chat_plan_require_member(v_plan.conversation_id, v_uid);
  IF v_plan.source <> 'chat' OR v_plan.created_by IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
  END IF;
  IF v_plan.status NOT IN ('deciding', 'scheduled') THEN
    RAISE EXCEPTION 'conflict_plan_cancelled' USING ERRCODE = 'PT409';
  END IF;
  IF v_title IS NOT NULL AND char_length(v_title) > 80 THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023', DETAIL = 'p_title';
  END IF;
  IF v_note IS NOT NULL AND char_length(v_note) > 280 THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023', DETAIL = 'p_note';
  END IF;

  UPDATE public.chat_plans
     SET title = COALESCE(v_title, title), note = v_note, updated_at = now()
   WHERE id = v_plan.id;
  IF v_plan.status = 'scheduled' THEN
    PERFORM public.chat_plan_sync_calendar(v_plan.id);
  END IF;
  RETURN jsonb_build_object('planId', v_plan.id);
END;
$function$;
REVOKE ALL ON FUNCTION public.plan_update(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.plan_update(uuid, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.plan_cancel(p_plan_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_plan public.chat_plans%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;
  SELECT * INTO v_plan FROM public.chat_plans WHERE id = p_plan_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public.chat_plan_require_member(v_plan.conversation_id, v_uid);
  IF v_plan.source <> 'chat' OR NOT public.chat_plan_can_lock(v_plan, v_uid) THEN
    RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
  END IF;
  IF v_plan.status = 'cancelled' THEN
    RAISE EXCEPTION 'conflict_plan_cancelled' USING ERRCODE = 'PT409';
  END IF;

  UPDATE public.chat_plans
     SET status = 'cancelled', cancelled_at = now(), updated_at = now()
   WHERE id = v_plan.id;
  PERFORM public.chat_plan_sync_calendar(v_plan.id);
  PERFORM public.chat_plan_post_event(
    v_plan.conversation_id, v_plan.id, 'cancelled', v_uid, '{}'::jsonb,
    public.issue_4114_first_name(v_uid) || ' cancelled ' || v_plan.title
  );
  RETURN jsonb_build_object('planId', v_plan.id);
END;
$function$;
REVOKE ALL ON FUNCTION public.plan_cancel(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.plan_cancel(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.chat_plans_for_conversation(p_conversation_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_from timestamptz;
  v_plans jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;
  PERFORM public.chat_plan_require_member(p_conversation_id, v_uid);

  SELECT cp.history_visible_from INTO v_from
    FROM public.conversation_participants cp
   WHERE cp.conversation_id = p_conversation_id AND cp.user_id = v_uid;

  WITH base AS (
    SELECT p.*,
           bsc.card_data AS deck_card_data,
           bsc.locked_at AS deck_locked_at,
           public.chat_plan_effective_status(p) AS eff_status,
           CASE WHEN p.source = 'deck' THEN (
             SELECT min(ce.scheduled_at) FROM public.calendar_entries ce WHERE ce.board_card_id = p.saved_card_id
           ) ELSE p.scheduled_at END AS eff_scheduled_at,
           public.chat_plan_can_lock(p, v_uid) AS can_lock,
           (SELECT count(*) FROM public.chat_plan_time_options o WHERE o.plan_id = p.id) AS option_count
      FROM public.chat_plans p
      LEFT JOIN public.board_saved_cards bsc ON bsc.id = p.saved_card_id
     WHERE p.conversation_id = p_conversation_id
       AND p.status <> 'cancelled'
  ), picked AS (
    SELECT * FROM base b
     WHERE b.eff_status = 'deciding'
        OR (b.eff_status = 'scheduled'
            AND COALESCE(b.eff_scheduled_at, b.deck_locked_at, b.locked_at, b.created_at) >= now() - interval '180 days')
     ORDER BY b.created_at DESC
     LIMIT 100
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', b.id,
      'source', b.source,
      'sessionId', b.session_id,
      'savedCardId', b.saved_card_id,
      'messageId', b.message_id,
      'messageVisible', EXISTS (
        SELECT 1 FROM public.messages m
         WHERE m.id = b.message_id AND m.deleted_at IS NULL
           AND (v_from IS NULL OR m.created_at >= v_from)
      ),
      'createdBy', b.created_by,
      'createdByName', CASE WHEN b.created_by IS NULL THEN NULL ELSE public.issue_4114_first_name(b.created_by) END,
      'title', b.title,
      'whereKind', b.where_kind,
      'place', CASE WHEN b.where_kind IN ('place', 'address') THEN jsonb_build_object(
        'poolId', b.place_pool_id, 'mapboxId', b.mapbox_id, 'name', b.place_name,
        'address', b.place_address, 'lat', b.place_lat, 'lng', b.place_lng, 'photoUrl', b.place_photo_url
      ) END,
      'link', CASE WHEN b.where_kind = 'link' THEN jsonb_build_object('url', b.link_url, 'domain', b.link_domain) END,
      'cardData', CASE WHEN b.source = 'deck' THEN b.deck_card_data END,
      'whenMode', b.when_mode,
      'openTimes', b.open_times,
      'status', b.eff_status,
      'scheduledAt', b.eff_scheduled_at,
      'durationMinutes', CASE WHEN b.source = 'deck' THEN (
        SELECT min(ce.duration_minutes) FROM public.calendar_entries ce WHERE ce.board_card_id = b.saved_card_id
      ) ELSE b.duration_minutes END,
      'lockedAt', CASE WHEN b.source = 'deck' THEN b.deck_locked_at ELSE b.locked_at END,
      'lockedBy', b.locked_by,
      'note', b.note,
      'createdAt', b.created_at,
      'updatedAt', b.updated_at,
      'options', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', o.id, 'startsAt', o.starts_at, 'addedBy', o.added_by,
          'voterIds', COALESCE((
            SELECT jsonb_agg(v.user_id ORDER BY v.created_at, v.user_id)
              FROM public.chat_plan_time_votes v WHERE v.option_id = o.id
          ), '[]'::jsonb)
        ) ORDER BY o.starts_at)
        FROM public.chat_plan_time_options o WHERE o.plan_id = b.id
      ), '[]'::jsonb),
      'rsvps', CASE WHEN b.source = 'chat' THEN jsonb_build_object(
        'going', COALESCE((SELECT jsonb_agg(r.user_id ORDER BY r.updated_at) FROM public.chat_plan_rsvps r WHERE r.plan_id = b.id AND r.status = 'going'), '[]'::jsonb),
        'maybe', COALESCE((SELECT jsonb_agg(r.user_id ORDER BY r.updated_at) FROM public.chat_plan_rsvps r WHERE r.plan_id = b.id AND r.status = 'maybe'), '[]'::jsonb),
        'cant', COALESCE((SELECT jsonb_agg(r.user_id ORDER BY r.updated_at) FROM public.chat_plan_rsvps r WHERE r.plan_id = b.id AND r.status = 'cant'), '[]'::jsonb)
      ) ELSE jsonb_build_object(
        'going', COALESCE((SELECT jsonb_agg(r.user_id ORDER BY r.updated_at) FROM public.board_card_rsvps r WHERE r.session_id = b.session_id AND r.saved_card_id = b.saved_card_id AND r.rsvp_status = 'attending'), '[]'::jsonb),
        'maybe', COALESCE((SELECT jsonb_agg(r.user_id ORDER BY r.updated_at) FROM public.board_card_rsvps r WHERE r.session_id = b.session_id AND r.saved_card_id = b.saved_card_id AND r.rsvp_status = 'maybe'), '[]'::jsonb),
        'cant', COALESCE((SELECT jsonb_agg(r.user_id ORDER BY r.updated_at) FROM public.board_card_rsvps r WHERE r.session_id = b.session_id AND r.saved_card_id = b.saved_card_id AND r.rsvp_status = 'not_attending'), '[]'::jsonb)
      ) END,
      'reactions', CASE WHEN b.source = 'chat' THEN jsonb_build_object(
        'up', COALESCE((SELECT jsonb_agg(x.user_id ORDER BY x.updated_at) FROM public.chat_plan_reactions x WHERE x.plan_id = b.id AND x.kind = 'up'), '[]'::jsonb),
        'down', COALESCE((SELECT jsonb_agg(x.user_id ORDER BY x.updated_at) FROM public.chat_plan_reactions x WHERE x.plan_id = b.id AND x.kind = 'down'), '[]'::jsonb)
      ) ELSE jsonb_build_object(
        'up', COALESCE((SELECT jsonb_agg(x.user_id ORDER BY x.updated_at) FROM public.board_votes x WHERE x.session_id = b.session_id AND x.saved_card_id = b.saved_card_id AND x.vote_type = 'up'), '[]'::jsonb),
        'down', COALESCE((SELECT jsonb_agg(x.user_id ORDER BY x.updated_at) FROM public.board_votes x WHERE x.session_id = b.session_id AND x.saved_card_id = b.saved_card_id AND x.vote_type = 'down'), '[]'::jsonb)
      ) END,
      'commentCount', (
        SELECT count(*) FROM public.messages m
         WHERE m.plan_id = b.id AND m.message_type NOT IN ('plan', 'system') AND m.deleted_at IS NULL
           AND (v_from IS NULL OR m.created_at >= v_from)
      ),
      'canLock', b.eff_status = 'deciding' AND b.can_lock,
      'canEdit', b.source = 'chat' AND b.created_by IS NOT DISTINCT FROM v_uid AND b.status IN ('deciding', 'scheduled'),
      'canCancel', b.source = 'chat' AND b.can_lock,
      'canAddTime', b.eff_status = 'deciding' AND (b.open_times OR b.can_lock OR b.created_by IS NOT DISTINCT FROM v_uid)
                    AND b.option_count < 8
    ) ORDER BY b.created_at DESC
  ), '[]'::jsonb) INTO v_plans
  FROM picked b;

  RETURN jsonb_build_object(
    'viewerId', v_uid,
    'memberCount', (SELECT count(*) FROM public.conversation_participants WHERE conversation_id = p_conversation_id),
    'historyVisibleFrom', v_from,
    'plans', v_plans
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.chat_plans_for_conversation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_plans_for_conversation(uuid) TO authenticated;

-- Place search: the Mingla pool, active + servable (the deck's exclusion
-- family), prefix matches first, then similarity, then distance.
CREATE OR REPLACE FUNCTION public.search_plan_places(
  p_query text,
  p_lat double precision DEFAULT NULL,
  p_lng double precision DEFAULT NULL,
  p_limit int DEFAULT 5)
 RETURNS TABLE (id uuid, name text, area text, lat double precision, lng double precision, photo_url text)
 LANGUAGE sql
 STABLE
 SET search_path = public, extensions, pg_temp
AS $function$
  WITH q AS (
    SELECT btrim(COALESCE(p_query, '')) AS raw,
           public.mingla_normalize_place_name(btrim(COALESCE(p_query, ''))) AS nq,
           LEAST(GREATEST(COALESCE(p_limit, 5), 1), 8) AS lim
  ), qq AS (
    SELECT q.*, replace(replace(replace(q.nq, '\', '\\'), '%', '\%'), '_', '\_') AS nq_like FROM q
  )
  SELECT pp.id, pp.name, COALESCE(pp.address, pp.city) AS area, pp.lat, pp.lng,
         pp.stored_photo_urls[1] AS photo_url
    FROM qq
    JOIN public.place_pool pp ON true
   WHERE char_length(qq.raw) BETWEEN 2 AND 80
     AND pp.is_active = true
     AND pp.is_servable IS TRUE
     AND (public.mingla_normalize_place_name(pp.name) OPERATOR(extensions.%) qq.nq
          OR public.mingla_normalize_place_name(pp.name) LIKE '%' || qq.nq_like || '%')
   ORDER BY (public.mingla_normalize_place_name(pp.name) LIKE qq.nq_like || '%') DESC,
            extensions.similarity(public.mingla_normalize_place_name(pp.name), qq.nq) DESC,
            CASE WHEN p_lat IS NOT NULL AND p_lng IS NOT NULL
                 THEN (pp.lat - p_lat) ^ 2 + ((pp.lng - p_lng) * cos(radians(p_lat))) ^ 2 END ASC NULLS LAST,
            pp.id
   LIMIT (SELECT lim FROM qq);
$function$;
REVOKE ALL ON FUNCTION public.search_plan_places(text, double precision, double precision, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_plan_places(text, double precision, double precision, int) TO authenticated;

COMMIT;
