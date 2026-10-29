-- Issue #4187 — Admin-to-Local / Admin-to-Creator program conversations.
--
-- Program messages live on the canonical conversations / participants /
-- messages rail.  A nullable subtype on conversations distinguishes these
-- managed team threads from ordinary direct-backed group chats without
-- widening linked_entity_type or creating a second inbox.

BEGIN;

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS program_kind text,
  ADD COLUMN IF NOT EXISTS program_target_user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.conversations
  DROP CONSTRAINT IF EXISTS conversations_program_context_coherent;
ALTER TABLE public.conversations
  ADD CONSTRAINT conversations_program_context_coherent CHECK (
    (program_kind IS NULL AND program_target_user_id IS NULL)
    OR
    (
      program_kind IN ('local', 'creator')
      AND program_target_user_id IS NOT NULL
      AND type = 'group'
      AND linked_entity_type = 'direct'
      AND session_id IS NULL
      AND event_id IS NULL
      AND brand_id IS NULL
      AND NULLIF(btrim(name), '') IS NOT NULL
      AND is_enabled IS TRUE
      AND is_broadcast_only IS FALSE
    )
  );

CREATE UNIQUE INDEX IF NOT EXISTS conversations_one_program_thread_per_person
  ON public.conversations(program_kind, program_target_user_id)
  WHERE program_kind IS NOT NULL AND program_target_user_id IS NOT NULL;

COMMENT ON COLUMN public.conversations.program_kind IS
  '#4187 managed Mingla program thread subtype. NULL for every ordinary chat; local or creator only for the one Admin-created team thread owned by program_target_user_id.';
COMMENT ON COLUMN public.conversations.program_target_user_id IS
  '#4187 recipient of a managed Local/Creator program thread. Conversation creation is Admin-only through the program messaging RPCs.';

-- The existing conversation INSERT policy permits ordinary signed-in people
-- to create their own chats. Program markers are privileged: without this
-- restrictive policy a client could squat the one-per-recipient unique key or
-- impersonate the official team. The SECURITY DEFINER Admin RPC below bypasses
-- RLS only after its Admin and target checks pass.
DROP POLICY IF EXISTS conversations_program_admin_rpc_only ON public.conversations;
CREATE POLICY conversations_program_admin_rpc_only
  ON public.conversations
  AS RESTRICTIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (program_kind IS NULL AND program_target_user_id IS NULL);

-- One private authority for target eligibility. It is intentionally not
-- callable by clients; both public RPCs below invoke it under their Admin gate.
CREATE OR REPLACE FUNCTION public.issue_4187_program_target_exists(
  p_program_kind text,
  p_target_user_id uuid
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT CASE p_program_kind
    WHEN 'creator' THEN EXISTS (
      SELECT 1
      FROM public.creator_accounts account
      WHERE account.id = p_target_user_id
        AND account.deleted_at IS NULL
    )
    WHEN 'local' THEN EXISTS (
      SELECT 1 FROM public.local_applications application
      WHERE application.user_id = p_target_user_id
    ) OR EXISTS (
      SELECT 1 FROM public.locals local_row
      WHERE local_row.user_id = p_target_user_id
    )
    ELSE false
  END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4187_program_target_exists(text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4187_program_target_exists(text, uuid)
  TO service_role;

-- Local messaging needs a durable directory that outlives the review queue:
-- applicants of every status plus seated Locals, deduped by account.
CREATE OR REPLACE FUNCTION public.admin_program_local_people()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'admin_only' USING ERRCODE = '42501';
  END IF;

  WITH latest_application AS (
    SELECT DISTINCT ON (application.user_id)
      application.user_id,
      application.status,
      application.city_id,
      application.created_at
    FROM public.local_applications application
    ORDER BY application.user_id, application.created_at DESC, application.id DESC
  ),
  latest_local AS (
    SELECT DISTINCT ON (local_row.user_id)
      local_row.user_id,
      local_row.status,
      local_row.city_id,
      local_row.created_at
    FROM public.locals local_row
    ORDER BY local_row.user_id,
      CASE WHEN local_row.status = 'active' THEN 0 ELSE 1 END,
      local_row.created_at DESC,
      local_row.id DESC
  ),
  candidate AS (
    SELECT user_id FROM latest_application
    UNION
    SELECT user_id FROM latest_local
  ),
  people AS (
    SELECT
      candidate.user_id AS target_user_id,
      COALESCE(
        NULLIF(btrim(profile.display_name), ''),
        NULLIF(btrim(profile.username), ''),
        NULLIF(btrim(concat_ws(' ', profile.first_name, profile.last_name)), ''),
        'Local'
      ) AS display_name,
      profile.avatar_url,
      city.name AS city,
      CASE
        WHEN local_row.user_id IS NOT NULL THEN local_row.status
        ELSE application.status
      END AS program_status,
      (local_row.user_id IS NOT NULL) AS has_local_record,
      conversation.id AS conversation_id,
      conversation.last_message_at
    FROM candidate
    JOIN public.profiles profile ON profile.id = candidate.user_id
    LEFT JOIN latest_application application ON application.user_id = candidate.user_id
    LEFT JOIN latest_local local_row ON local_row.user_id = candidate.user_id
    LEFT JOIN public.seeding_cities city
      ON city.id = COALESCE(local_row.city_id, application.city_id)
    LEFT JOIN public.conversations conversation
      ON conversation.program_kind = 'local'
     AND conversation.program_target_user_id = candidate.user_id
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'target_user_id', people.target_user_id,
        'display_name', people.display_name,
        'avatar_url', people.avatar_url,
        'city', people.city,
        'program_status', people.program_status,
        'has_local_record', people.has_local_record,
        'conversation_id', people.conversation_id,
        'last_message_at', people.last_message_at
      )
      ORDER BY people.last_message_at DESC NULLS LAST, lower(people.display_name), people.target_user_id
    ),
    '[]'::jsonb
  ) INTO v_result
  FROM people;

  RETURN v_result;
END;
$function$;

-- Opens the Admin view of an existing thread. No conversation is created by
-- merely opening a drawer. When a thread exists, the viewing Admin joins it so
-- ordinary RLS-filtered Realtime and reply notifications work for that person.
CREATE OR REPLACE FUNCTION public.admin_program_conversation_thread(
  p_program_kind text,
  p_target_user_id uuid
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_conversation public.conversations%ROWTYPE;
  v_recipient_name text;
  v_recipient_avatar text;
  v_messages jsonb;
BEGIN
  IF v_actor IS NULL OR NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'admin_only' USING ERRCODE = '42501';
  END IF;
  IF p_program_kind NOT IN ('local', 'creator')
     OR NOT public.issue_4187_program_target_exists(p_program_kind, p_target_user_id) THEN
    RAISE EXCEPTION 'program_recipient_unavailable' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_conversation
  FROM public.conversations conversation
  WHERE conversation.program_kind = p_program_kind
    AND conversation.program_target_user_id = p_target_user_id;

  IF FOUND THEN
    INSERT INTO public.conversation_participants(conversation_id, user_id)
    VALUES (v_conversation.id, v_actor)
    ON CONFLICT (conversation_id, user_id) DO NOTHING;
  END IF;

  SELECT
    COALESCE(
      NULLIF(btrim(profile.display_name), ''),
      NULLIF(btrim(profile.username), ''),
      NULLIF(btrim(concat_ws(' ', profile.first_name, profile.last_name)), ''),
      CASE p_program_kind WHEN 'local' THEN 'Local' ELSE 'Creator' END
    ),
    profile.avatar_url
  INTO v_recipient_name, v_recipient_avatar
  FROM public.profiles profile
  WHERE profile.id = p_target_user_id;

  IF v_conversation.id IS NOT NULL THEN
    WITH recent AS (
      SELECT message.*
      FROM public.messages message
      WHERE message.conversation_id = v_conversation.id
        AND message.deleted_at IS NULL
      ORDER BY message.created_at DESC, message.id DESC
      LIMIT 200
    )
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id', recent.id,
          'conversation_id', recent.conversation_id,
          'sender_id', recent.sender_id,
          'sender_name', CASE
            WHEN recent.sender_id = p_target_user_id THEN v_recipient_name
            ELSE COALESCE(
              NULLIF(btrim(recent.sender_display_name_snapshot), ''),
              CASE p_program_kind WHEN 'local' THEN 'Mingla Local team' ELSE 'Mingla Creator team' END
            )
          END,
          'is_from_recipient', recent.sender_id = p_target_user_id,
          'content', recent.content,
          'message_type', recent.message_type,
          'file_url', recent.file_url,
          'file_name', recent.file_name,
          'file_size', recent.file_size,
          'thumb_path', recent.thumb_path,
          'media_width', recent.media_width,
          'media_height', recent.media_height,
          'media_duration_ms', recent.media_duration_ms,
          'media_expired_at', recent.media_expired_at,
          'client_id', recent.client_id,
          'created_at', recent.created_at
        )
        ORDER BY recent.created_at, recent.id
      ),
      '[]'::jsonb
    ) INTO v_messages
    FROM recent;
  ELSE
    v_messages := '[]'::jsonb;
  END IF;

  RETURN jsonb_build_object(
    'conversation_id', v_conversation.id,
    'program_kind', p_program_kind,
    'target_user_id', p_target_user_id,
    'recipient_name', v_recipient_name,
    'recipient_avatar_url', v_recipient_avatar,
    'messages', v_messages
  );
END;
$function$;

-- Browser uploads need their canonical conversation folder before the message
-- row can be written. Preparing creates/reuses the conversation and adds only
-- the Admin actor as a participant, which authorizes the existing #4114
-- message-attachments INSERT policy. The recipient is not added until a
-- durable message is sent, so an abandoned upload never creates a visible
-- empty thread in Explorer.
CREATE OR REPLACE FUNCTION public.admin_program_media_prepare(
  p_program_kind text,
  p_target_user_id uuid
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_team_name text;
  v_conversation_id uuid;
BEGIN
  IF v_actor IS NULL OR NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'admin_only' USING ERRCODE = '42501';
  END IF;
  IF p_program_kind NOT IN ('local', 'creator')
     OR NOT public.issue_4187_program_target_exists(p_program_kind, p_target_user_id) THEN
    RAISE EXCEPTION 'program_recipient_unavailable' USING ERRCODE = '22023';
  END IF;

  v_team_name := CASE p_program_kind
    WHEN 'local' THEN 'Mingla Local team'
    ELSE 'Mingla Creator team'
  END;

  INSERT INTO public.conversations(
    type,
    linked_entity_type,
    name,
    created_by,
    is_enabled,
    is_broadcast_only,
    program_kind,
    program_target_user_id
  ) VALUES (
    'group',
    'direct',
    v_team_name,
    v_actor,
    true,
    false,
    p_program_kind,
    p_target_user_id
  )
  ON CONFLICT (program_kind, program_target_user_id)
    WHERE program_kind IS NOT NULL AND program_target_user_id IS NOT NULL
  DO UPDATE SET updated_at = public.conversations.updated_at
  RETURNING id INTO v_conversation_id;

  INSERT INTO public.conversation_participants(conversation_id, user_id)
  VALUES (v_conversation_id, v_actor)
  ON CONFLICT (conversation_id, user_id) DO NOTHING;

  RETURN jsonb_build_object(
    'ok', true,
    'conversation_id', v_conversation_id
  );
END;
$function$;

-- The first send atomically creates the managed group, adds the recipient and
-- sender, writes one idempotent message, and records the Admin actor in the
-- existing audit log. A retry with the same client id returns the first row.
DROP FUNCTION IF EXISTS public.admin_program_message_send(text, uuid, text, uuid);
CREATE OR REPLACE FUNCTION public.admin_program_message_send(
  p_program_kind text,
  p_target_user_id uuid,
  p_content text,
  p_client_id uuid,
  p_message_type text DEFAULT 'text',
  p_file_url text DEFAULT NULL,
  p_file_name text DEFAULT NULL,
  p_file_size bigint DEFAULT NULL,
  p_media_width integer DEFAULT NULL,
  p_media_height integer DEFAULT NULL,
  p_media_duration_ms integer DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_actor_email text := COALESCE(auth.jwt() ->> 'email', 'unknown-admin');
  v_team_name text;
  v_conversation_id uuid;
  v_message public.messages%ROWTYPE;
  v_storage_owner uuid;
  v_storage_mime text;
  v_storage_size bigint;
BEGIN
  IF v_actor IS NULL OR NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'admin_only' USING ERRCODE = '42501';
  END IF;
  IF p_program_kind NOT IN ('local', 'creator')
     OR NOT public.issue_4187_program_target_exists(p_program_kind, p_target_user_id) THEN
    RAISE EXCEPTION 'program_recipient_unavailable' USING ERRCODE = '22023';
  END IF;
  IF p_client_id IS NULL THEN
    RAISE EXCEPTION 'client_id_required' USING ERRCODE = '22023';
  END IF;
  p_content := btrim(COALESCE(p_content, ''));
  p_message_type := lower(btrim(COALESCE(p_message_type, 'text')));
  p_file_name := NULLIF(btrim(COALESCE(p_file_name, '')), '');
  IF char_length(p_content) > 4000 THEN
    RAISE EXCEPTION 'message_length_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_message_type = 'text' THEN
    IF char_length(p_content) < 1
       OR p_file_url IS NOT NULL
       OR p_file_name IS NOT NULL
       OR p_file_size IS NOT NULL
       OR p_media_width IS NOT NULL
       OR p_media_height IS NOT NULL
       OR p_media_duration_ms IS NOT NULL THEN
      RAISE EXCEPTION 'text_message_shape_invalid' USING ERRCODE = '22023';
    END IF;
  ELSIF p_message_type IN ('image', 'video') THEN
    IF p_file_url IS NULL
       OR p_file_name IS NULL
       OR char_length(p_file_name) > 255
       OR p_file_size IS NULL
       OR p_file_size < 1
       OR p_file_size > 26214400 THEN
      RAISE EXCEPTION 'media_message_shape_invalid' USING ERRCODE = '22023';
    END IF;
  ELSE
    RAISE EXCEPTION 'program_message_type_invalid' USING ERRCODE = '22023';
  END IF;

  v_team_name := CASE p_program_kind
    WHEN 'local' THEN 'Mingla Local team'
    ELSE 'Mingla Creator team'
  END;

  INSERT INTO public.conversations(
    type,
    linked_entity_type,
    name,
    created_by,
    is_enabled,
    is_broadcast_only,
    program_kind,
    program_target_user_id
  ) VALUES (
    'group',
    'direct',
    v_team_name,
    v_actor,
    true,
    false,
    p_program_kind,
    p_target_user_id
  )
  ON CONFLICT (program_kind, program_target_user_id)
    WHERE program_kind IS NOT NULL AND program_target_user_id IS NOT NULL
  DO UPDATE SET updated_at = public.conversations.updated_at
  RETURNING id INTO v_conversation_id;

  INSERT INTO public.conversation_participants(conversation_id, user_id)
  VALUES
    (v_conversation_id, p_target_user_id),
    (v_conversation_id, v_actor)
  ON CONFLICT (conversation_id, user_id) DO NOTHING;

  IF p_message_type IN ('image', 'video') THEN
    IF public.issue_4114_chat_attachment_conversation(p_file_url) IS DISTINCT FROM v_conversation_id THEN
      RAISE EXCEPTION 'attachment_path_outside_conversation' USING ERRCODE = '22023';
    END IF;

    SELECT
      object_row.owner,
      lower(COALESCE(object_row.metadata ->> 'mimetype', '')),
      CASE
        WHEN COALESCE(object_row.metadata ->> 'size', '') ~ '^[0-9]+$'
          THEN (object_row.metadata ->> 'size')::bigint
        ELSE NULL
      END
    INTO v_storage_owner, v_storage_mime, v_storage_size
    FROM storage.objects object_row
    WHERE object_row.bucket_id = 'message-attachments'
      AND object_row.name = p_file_url
    LIMIT 1;

    IF v_storage_owner IS DISTINCT FROM v_actor
       OR v_storage_size IS NULL
       OR v_storage_size IS DISTINCT FROM p_file_size
       OR v_storage_size > 26214400
       OR (p_message_type = 'image' AND v_storage_mime NOT IN (
         'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/heif'
       ))
       OR (p_message_type = 'video' AND v_storage_mime NOT IN (
         'video/mp4', 'video/quicktime', 'video/x-m4v', 'video/3gpp', 'video/webm'
       )) THEN
      RAISE EXCEPTION 'media_upload_unavailable' USING ERRCODE = '22023';
    END IF;
  END IF;

  INSERT INTO public.messages(
    conversation_id,
    sender_id,
    content,
    message_type,
    file_url,
    file_name,
    file_size,
    media_width,
    media_height,
    media_duration_ms,
    client_id,
    sender_display_name_snapshot,
    sender_role_snapshot
  ) VALUES (
    v_conversation_id,
    v_actor,
    p_content,
    p_message_type,
    p_file_url,
    p_file_name,
    p_file_size,
    p_media_width,
    p_media_height,
    p_media_duration_ms,
    p_client_id,
    v_team_name,
    'Mingla'
  )
  ON CONFLICT (conversation_id, client_id)
    WHERE client_id IS NOT NULL
  DO NOTHING
  RETURNING * INTO v_message;

  IF v_message.id IS NULL THEN
    SELECT * INTO v_message
    FROM public.messages message
    WHERE message.conversation_id = v_conversation_id
      AND message.client_id = p_client_id;
    IF v_message.id IS NULL
       OR v_message.sender_id IS DISTINCT FROM v_actor
       OR v_message.content IS DISTINCT FROM p_content
       OR v_message.message_type IS DISTINCT FROM p_message_type
       OR v_message.file_url IS DISTINCT FROM p_file_url THEN
      RAISE EXCEPTION 'message_idempotency_conflict' USING ERRCODE = '23505';
    END IF;
  ELSE
    INSERT INTO public.admin_audit_log(
      admin_email,
      action,
      target_type,
      target_id,
      metadata,
      actor_uid
    ) VALUES (
      v_actor_email,
      'program.message_sent',
      p_program_kind,
      p_target_user_id::text,
      jsonb_build_object(
        'conversation_id', v_conversation_id,
        'message_id', v_message.id,
        'message_type', p_message_type,
        'has_attachment', p_file_url IS NOT NULL,
        'character_count', char_length(p_content)
      ),
      v_actor
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'conversation_id', v_conversation_id,
    'message', jsonb_build_object(
      'id', v_message.id,
      'conversation_id', v_message.conversation_id,
      'sender_id', v_message.sender_id,
      'sender_name', v_team_name,
      'is_from_recipient', false,
      'content', v_message.content,
      'message_type', v_message.message_type,
      'file_url', v_message.file_url,
      'file_name', v_message.file_name,
      'file_size', v_message.file_size,
      'thumb_path', v_message.thumb_path,
      'media_width', v_message.media_width,
      'media_height', v_message.media_height,
      'media_duration_ms', v_message.media_duration_ms,
      'media_expired_at', v_message.media_expired_at,
      'client_id', v_message.client_id,
      'created_at', v_message.created_at
    )
  );
END;
$function$;

-- Managed program recipients can archive or mute their thread, but leaving it
-- would silently break Admin delivery. Preserve the canonical function and add
-- this one guard; every other group type keeps its existing behavior.
CREATE OR REPLACE FUNCTION public.leave_group_conversation(p_conversation_id uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_conversation public.conversations%ROWTYPE;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_conversation
  FROM public.conversations
  WHERE id = p_conversation_id AND type = 'group'
  FOR UPDATE;
  IF NOT FOUND OR NOT EXISTS (
    SELECT 1 FROM public.conversation_participants
    WHERE conversation_id = p_conversation_id AND user_id = v_user
  ) THEN
    RAISE EXCEPTION 'conversation_unavailable' USING ERRCODE = '42501';
  END IF;
  IF v_conversation.program_kind IS NOT NULL THEN
    RAISE EXCEPTION 'managed_conversation_cannot_be_left' USING ERRCODE = '42501';
  END IF;
  IF v_conversation.linked_entity_type NOT IN ('direct', 'session', 'trip', 'event') THEN
    RAISE EXCEPTION 'conversation_unavailable' USING ERRCODE = '42501';
  END IF;
  IF v_conversation.linked_entity_type = 'session' THEN
    DELETE FROM public.session_participants
    WHERE session_id = v_conversation.session_id AND user_id = v_user;
  END IF;
  DELETE FROM public.conversation_participants
  WHERE conversation_id = p_conversation_id AND user_id = v_user;
END;
$function$;

-- The canonical Explorer chat list intentionally keeps only rows returned by
-- list_connection_conversation_access(). Program threads are not friend,
-- content-share, or collaboration-session conversations, so teach that one
-- batch authority about the managed subtype instead of bypassing the access
-- filter in the client. The recipient retains the same private lifecycle
-- controls (archive, pin, mark unread, hide) as every other chat.
CREATE OR REPLACE FUNCTION public.list_connection_conversation_access()
RETURNS TABLE(
  conversation_id uuid,
  archived_at timestamptz,
  pinned_at timestamptz,
  marked_unread_at timestamptz,
  live_session_id uuid,
  live_session_status text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=public,pg_temp
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
REVOKE ALL ON FUNCTION public.list_connection_conversation_access() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.list_connection_conversation_access() TO authenticated,service_role;

REVOKE ALL ON FUNCTION public.admin_program_local_people() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_program_conversation_thread(text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_program_media_prepare(text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_program_message_send(text, uuid, text, uuid, text, text, text, bigint, integer, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_program_local_people() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_program_conversation_thread(text, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_program_media_prepare(text, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_program_message_send(text, uuid, text, uuid, text, text, text, bigint, integer, integer, integer) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
