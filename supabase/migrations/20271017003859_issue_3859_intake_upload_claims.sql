-- #3859 slice 6 — private, replay-safe intake upload claims.
--
-- This migration hardens the existing `trip_intake_files` rail. Files remain
-- in the same private bucket, but anonymous callers no longer receive broad
-- INSERT/SELECT policies. An edge-minted signed upload is represented by a
-- service-owned manifest and checkout may consume only an accepted manifest
-- bound to the same upload draft, buyer (when authenticated), event, tier,
-- question, and schema version.

CREATE TABLE public.trip_intake_upload_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  upload_session_id uuid NOT NULL,
  buyer_user_id uuid,
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  ticket_type_id uuid NOT NULL REFERENCES public.ticket_types(id) ON DELETE CASCADE,
  question_id uuid NOT NULL,
  schema_version_id uuid NOT NULL,
  object_path text NOT NULL UNIQUE,
  file_extension text NOT NULL CHECK (
    file_extension = ANY (ARRAY[
      '.jpg', '.jpeg', '.png', '.heic', '.webp', '.pdf', '.doc', '.docx', '.odt'
    ])
  ),
  declared_mime_type text NOT NULL,
  declared_size_bytes integer NOT NULL CHECK (
    declared_size_bytes > 0 AND declared_size_bytes <= 10485760
  ),
  verified_mime_type text,
  verified_size_bytes integer CHECK (
    verified_size_bytes IS NULL OR
    (verified_size_bytes > 0 AND verified_size_bytes <= 10485760)
  ),
  content_sha256 text CHECK (
    content_sha256 IS NULL OR content_sha256 ~ '^[0-9a-f]{64}$'
  ),
  state text NOT NULL DEFAULT 'issued' CHECK (
    state = ANY (ARRAY[
      'issued', 'uploaded', 'accepted', 'claimed', 'rejected', 'orphaned'
    ])
  ),
  replaces_claim_id uuid REFERENCES public.trip_intake_upload_claims(id) ON DELETE SET NULL,
  replaced_by_claim_id uuid REFERENCES public.trip_intake_upload_claims(id) ON DELETE SET NULL,
  checkout_claim_key text,
  checkout_attempt_id uuid,
  checkout_session_id uuid REFERENCES public.ticket_checkout_sessions(id) ON DELETE SET NULL,
  order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  claimed_at timestamptz,
  revoked_at timestamptz,
  finalized_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (object_path !~ '(^|/)\.\.?(/|$)'),
  CHECK (position('/' in object_path) > 0),
  CHECK (
    (state IN ('accepted', 'claimed') AND
      verified_mime_type IS NOT NULL AND
      verified_size_bytes IS NOT NULL AND
      content_sha256 IS NOT NULL AND
      accepted_at IS NOT NULL)
    OR state NOT IN ('accepted', 'claimed')
  )
);

CREATE INDEX trip_intake_upload_claims_scope_idx
  ON public.trip_intake_upload_claims (
    upload_session_id, event_id, ticket_type_id, question_id
  );
CREATE INDEX trip_intake_upload_claims_expiry_idx
  ON public.trip_intake_upload_claims (expires_at)
  WHERE state IN ('issued', 'uploaded', 'accepted');
CREATE INDEX trip_intake_upload_claims_checkout_idx
  ON public.trip_intake_upload_claims (checkout_claim_key)
  WHERE checkout_claim_key IS NOT NULL;

ALTER TABLE public.trip_intake_upload_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.trip_intake_upload_claims FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.trip_intake_upload_claims TO service_role;

CREATE POLICY trip_intake_upload_claims_service_role_all
  ON public.trip_intake_upload_claims
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- The old policies made every object in the bucket directly selectable by the
-- anonymous role and allowed arbitrary anonymous inserts beneath any two path
-- segments. Signed upload/download operations now own those capabilities.
DROP POLICY IF EXISTS "trip_intake_files_anon_buyer_insert" ON storage.objects;
DROP POLICY IF EXISTS "trip_intake_files_anon_buyer_select" ON storage.objects;

CREATE TABLE public.ticket_checkout_intake_snapshots (
  checkout_session_id uuid PRIMARY KEY
    REFERENCES public.ticket_checkout_sessions(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  intake_form_data jsonb NOT NULL CHECK (jsonb_typeof(intake_form_data) = 'array'),
  claim_count integer NOT NULL DEFAULT 0 CHECK (claim_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ticket_checkout_intake_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ticket_checkout_intake_snapshots FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.ticket_checkout_intake_snapshots TO service_role;

CREATE POLICY ticket_checkout_intake_snapshots_service_role_all
  ON public.ticket_checkout_intake_snapshots
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.issue_3859_mint_intake_upload_claim(
  p_claim_id uuid,
  p_upload_session_id uuid,
  p_buyer_user_id uuid,
  p_event_id uuid,
  p_ticket_type_id uuid,
  p_question_id uuid,
  p_schema_version_id uuid,
  p_object_path text,
  p_file_extension text,
  p_declared_mime_type text,
  p_declared_size_bytes integer,
  p_replaces_claim_id uuid,
  p_expires_at timestamptz,
  p_max_files integer
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_accepted_count integer;
  v_orphaned_paths jsonb;
  v_replacement public.trip_intake_upload_claims%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' OR
     p_max_files IS NULL OR p_max_files < 1 OR
     p_expires_at <= now() OR
     NOT EXISTS (
       SELECT 1 FROM public.ticket_types
       WHERE id = p_ticket_type_id AND event_id = p_event_id
     ) THEN
    RAISE EXCEPTION 'intake_upload_claim_invalid';
  END IF;

  -- A scope-wide transaction lock closes the zero-row race between parallel
  -- mints. Only this draft/question/buyer is serialized; unrelated uploads
  -- continue independently.
  PERFORM pg_advisory_xact_lock(hashtextextended(concat_ws(
    '|', p_upload_session_id::text, p_event_id::text,
    p_ticket_type_id::text, p_question_id::text,
    COALESCE(p_buyer_user_id::text, 'anonymous')
  ), 3859));

  -- A PUT that never reached accept is not a selected file. Retire all such
  -- attempts before counting the files that genuinely occupy the limit.
  WITH orphaned AS (
    UPDATE public.trip_intake_upload_claims
    SET state = 'orphaned', revoked_at = now(), updated_at = now()
    WHERE upload_session_id = p_upload_session_id
      AND event_id = p_event_id
      AND ticket_type_id = p_ticket_type_id
      AND question_id = p_question_id
      AND buyer_user_id IS NOT DISTINCT FROM p_buyer_user_id
      AND state = 'issued'
    RETURNING object_path
  )
  SELECT COALESCE(jsonb_agg(object_path), '[]'::jsonb)
  INTO v_orphaned_paths
  FROM orphaned;

  IF p_replaces_claim_id IS NOT NULL THEN
    SELECT * INTO v_replacement
    FROM public.trip_intake_upload_claims
    WHERE id = p_replaces_claim_id
      AND upload_session_id = p_upload_session_id
      AND event_id = p_event_id
      AND ticket_type_id = p_ticket_type_id
      AND question_id = p_question_id
      AND schema_version_id = p_schema_version_id
      AND buyer_user_id IS NOT DISTINCT FROM p_buyer_user_id
      AND state = 'accepted'
      AND expires_at > now()
    FOR UPDATE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object(
        'ok', false,
        'error', 'upload_replacement_invalid',
        'orphaned_paths', v_orphaned_paths
      );
    END IF;
  END IF;

  SELECT count(*)
  INTO v_accepted_count
  FROM public.trip_intake_upload_claims
  WHERE upload_session_id = p_upload_session_id
    AND event_id = p_event_id
    AND ticket_type_id = p_ticket_type_id
    AND question_id = p_question_id
    AND buyer_user_id IS NOT DISTINCT FROM p_buyer_user_id
    AND state = 'accepted'
    AND expires_at > now()
    AND id IS DISTINCT FROM p_replaces_claim_id;
  IF v_accepted_count >= p_max_files THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'upload_limit_reached',
      'orphaned_paths', v_orphaned_paths
    );
  END IF;

  INSERT INTO public.trip_intake_upload_claims(
    id, upload_session_id, buyer_user_id, event_id, ticket_type_id,
    question_id, schema_version_id, object_path, file_extension,
    declared_mime_type, declared_size_bytes, replaces_claim_id, expires_at
  ) VALUES (
    p_claim_id, p_upload_session_id, p_buyer_user_id, p_event_id,
    p_ticket_type_id, p_question_id, p_schema_version_id, p_object_path,
    p_file_extension, p_declared_mime_type, p_declared_size_bytes,
    p_replaces_claim_id, p_expires_at
  );

  RETURN jsonb_build_object(
    'ok', true,
    'claim_id', p_claim_id,
    'orphaned_paths', v_orphaned_paths
  );
END;
$$;

REVOKE ALL ON FUNCTION public.issue_3859_mint_intake_upload_claim(
  uuid, uuid, uuid, uuid, uuid, uuid, uuid, text, text, text, integer,
  uuid, timestamptz, integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3859_mint_intake_upload_claim(
  uuid, uuid, uuid, uuid, uuid, uuid, uuid, text, text, text, integer,
  uuid, timestamptz, integer
) TO service_role;

CREATE OR REPLACE FUNCTION public.issue_3859_accept_intake_upload_claim(
  p_claim_id uuid,
  p_upload_session_id uuid,
  p_buyer_user_id uuid,
  p_verified_mime_type text,
  p_verified_size_bytes integer,
  p_content_sha256 text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_claim public.trip_intake_upload_claims%ROWTYPE;
  v_replaced public.trip_intake_upload_claims%ROWTYPE;
  v_replaced_path text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'intake_upload_unauthorized';
  END IF;

  SELECT * INTO v_claim
  FROM public.trip_intake_upload_claims
  WHERE id = p_claim_id
  FOR UPDATE;

  IF NOT FOUND OR v_claim.upload_session_id IS DISTINCT FROM p_upload_session_id THEN
    RAISE EXCEPTION 'intake_upload_claim_invalid';
  END IF;
  IF v_claim.buyer_user_id IS NOT NULL AND
     v_claim.buyer_user_id IS DISTINCT FROM p_buyer_user_id THEN
    RAISE EXCEPTION 'intake_upload_claim_invalid';
  END IF;
  IF v_claim.expires_at <= now() THEN
    RAISE EXCEPTION 'intake_upload_claim_expired';
  END IF;
  IF p_verified_mime_type IS DISTINCT FROM v_claim.declared_mime_type OR
     p_verified_size_bytes IS DISTINCT FROM v_claim.declared_size_bytes OR
     p_verified_size_bytes <= 0 OR p_verified_size_bytes > 10485760 OR
     p_content_sha256 !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'intake_upload_content_mismatch';
  END IF;

  IF v_claim.state = 'accepted' AND
     v_claim.verified_mime_type IS NOT DISTINCT FROM p_verified_mime_type AND
     v_claim.verified_size_bytes IS NOT DISTINCT FROM p_verified_size_bytes AND
     v_claim.content_sha256 IS NOT DISTINCT FROM p_content_sha256 THEN
    RETURN jsonb_build_object(
      'claim_id', v_claim.id,
      'path', v_claim.object_path,
      'mime_type', v_claim.verified_mime_type,
      'size_bytes', v_claim.verified_size_bytes,
      'expires_at', v_claim.expires_at,
      'replaced_path', NULL
    );
  END IF;
  IF v_claim.state <> 'issued' THEN
    RAISE EXCEPTION 'intake_upload_claim_invalid';
  END IF;

  IF v_claim.replaces_claim_id IS NOT NULL THEN
    SELECT * INTO v_replaced
    FROM public.trip_intake_upload_claims
    WHERE id = v_claim.replaces_claim_id
    FOR UPDATE;
    IF NOT FOUND OR
       v_replaced.state <> 'accepted' OR
       v_replaced.upload_session_id IS DISTINCT FROM v_claim.upload_session_id OR
       v_replaced.event_id IS DISTINCT FROM v_claim.event_id OR
       v_replaced.ticket_type_id IS DISTINCT FROM v_claim.ticket_type_id OR
       v_replaced.question_id IS DISTINCT FROM v_claim.question_id OR
       v_replaced.schema_version_id IS DISTINCT FROM v_claim.schema_version_id OR
       v_replaced.buyer_user_id IS DISTINCT FROM v_claim.buyer_user_id THEN
      RAISE EXCEPTION 'intake_upload_replacement_invalid';
    END IF;
    v_replaced_path := v_replaced.object_path;
    UPDATE public.trip_intake_upload_claims
    SET state = 'orphaned',
        replaced_by_claim_id = v_claim.id,
        revoked_at = now(),
        updated_at = now()
    WHERE id = v_replaced.id;
  END IF;

  UPDATE public.trip_intake_upload_claims
  SET state = 'accepted',
      verified_mime_type = p_verified_mime_type,
      verified_size_bytes = p_verified_size_bytes,
      content_sha256 = p_content_sha256,
      accepted_at = now(),
      updated_at = now()
  WHERE id = v_claim.id
  RETURNING * INTO v_claim;

  RETURN jsonb_build_object(
    'claim_id', v_claim.id,
    'path', v_claim.object_path,
    'mime_type', v_claim.verified_mime_type,
    'size_bytes', v_claim.verified_size_bytes,
    'expires_at', v_claim.expires_at,
    'replaced_path', v_replaced_path
  );
END;
$$;

REVOKE ALL ON FUNCTION public.issue_3859_accept_intake_upload_claim(
  uuid, uuid, uuid, text, integer, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3859_accept_intake_upload_claim(
  uuid, uuid, uuid, text, integer, text
) TO service_role;

CREATE OR REPLACE FUNCTION public.issue_3859_revoke_intake_upload_claim(
  p_claim_id uuid,
  p_upload_session_id uuid,
  p_buyer_user_id uuid
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_claim public.trip_intake_upload_claims%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'intake_upload_unauthorized';
  END IF;
  SELECT * INTO v_claim
  FROM public.trip_intake_upload_claims
  WHERE id = p_claim_id
  FOR UPDATE;
  IF NOT FOUND OR v_claim.upload_session_id IS DISTINCT FROM p_upload_session_id OR
     (v_claim.buyer_user_id IS NOT NULL AND
       v_claim.buyer_user_id IS DISTINCT FROM p_buyer_user_id) THEN
    RAISE EXCEPTION 'intake_upload_claim_invalid';
  END IF;
  IF v_claim.state IN ('claimed') OR v_claim.checkout_claim_key IS NOT NULL OR
     v_claim.checkout_session_id IS NOT NULL OR v_claim.order_id IS NOT NULL THEN
    RAISE EXCEPTION 'intake_upload_claim_finalized';
  END IF;
  IF v_claim.state IN ('rejected', 'orphaned') THEN
    RETURN v_claim.object_path;
  END IF;
  UPDATE public.trip_intake_upload_claims
  SET state = 'orphaned', revoked_at = now(), updated_at = now()
  WHERE id = v_claim.id;
  RETURN v_claim.object_path;
END;
$$;

REVOKE ALL ON FUNCTION public.issue_3859_revoke_intake_upload_claim(
  uuid, uuid, uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3859_revoke_intake_upload_claim(
  uuid, uuid, uuid
) TO service_role;

CREATE OR REPLACE FUNCTION public.issue_3859_prepare_intake_upload_claims(
  p_event_id uuid,
  p_buyer_user_id uuid,
  p_upload_session_id uuid,
  p_checkout_claim_key text,
  p_checkout_attempt_id uuid,
  p_lines jsonb,
  p_intake_form_data jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_entry jsonb;
  v_ticket_type_id uuid;
  v_schema_version_id uuid;
  v_schema jsonb;
  v_current_schema_version_id uuid;
  v_answers jsonb;
  v_sanitized_answers jsonb;
  v_sanitized jsonb := '[]'::jsonb;
  v_question jsonb;
  v_question_id uuid;
  v_answer jsonb;
  v_file jsonb;
  v_files jsonb;
  v_claim_id uuid;
  v_claim public.trip_intake_upload_claims%ROWTYPE;
  v_seen_claim_ids uuid[] := ARRAY[]::uuid[];
  v_max_files integer;
  v_required boolean;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'intake_upload_unauthorized';
  END IF;
  IF p_checkout_claim_key IS NULL OR length(trim(p_checkout_claim_key)) < 8 OR
     jsonb_typeof(p_lines) <> 'array' OR
     jsonb_typeof(p_intake_form_data) <> 'array' THEN
    RAISE EXCEPTION 'intake_upload_claim_invalid';
  END IF;

  FOR v_entry IN SELECT value FROM jsonb_array_elements(p_intake_form_data)
  LOOP
    BEGIN
      v_ticket_type_id := (v_entry->>'ticket_type_id')::uuid;
      v_schema_version_id := (v_entry->>'schema_version_id')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'intake_upload_claim_invalid';
    END;
    IF NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_lines) line
      WHERE line->>'ticketTypeId' = v_ticket_type_id::text
    ) OR (
      SELECT count(*)
      FROM jsonb_array_elements(p_intake_form_data) duplicate
      WHERE duplicate->>'ticket_type_id' = v_ticket_type_id::text
    ) <> 1 THEN
      RAISE EXCEPTION 'intake_upload_claim_invalid';
    END IF;

    SELECT schema, schema_version_id
    INTO v_schema, v_current_schema_version_id
    FROM public.trip_intake_schemas
    WHERE event_id = p_event_id
      AND ticket_type_id = v_ticket_type_id;
    IF NOT FOUND OR v_current_schema_version_id IS DISTINCT FROM v_schema_version_id THEN
      RAISE EXCEPTION 'intake_schema_stale';
    END IF;

    v_answers := COALESCE(v_entry->'answers', '{}'::jsonb);
    IF jsonb_typeof(v_answers) <> 'object' THEN
      RAISE EXCEPTION 'intake_upload_claim_invalid';
    END IF;
    v_sanitized_answers := v_answers;

    IF jsonb_typeof(v_schema->'questions') <> 'array' THEN
      RAISE EXCEPTION 'intake_upload_claim_invalid';
    END IF;

    -- Unknown question ids are rejected instead of copied into the durable
    -- snapshot. This prevents stale/private fields from riding beside a valid
    -- file claim after a planner edits the schema.
    IF EXISTS (
      SELECT 1
      FROM jsonb_object_keys(v_answers) submitted_question_id
      WHERE NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(v_schema->'questions') schema_question
        WHERE schema_question->>'id' = submitted_question_id
      )
    ) THEN
      RAISE EXCEPTION 'intake_upload_claim_invalid';
    END IF;

    FOR v_question IN SELECT value FROM jsonb_array_elements(v_schema->'questions')
    LOOP
      IF v_question->>'type' <> 'file_upload' THEN
        CONTINUE;
      END IF;
      BEGIN
        v_question_id := (v_question->>'id')::uuid;
      EXCEPTION WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'intake_upload_claim_invalid';
      END;
      v_required := COALESCE((v_question->>'required')::boolean, false);
      v_max_files := COALESCE((v_question->>'max_files')::integer, 1);
      v_answer := v_answers->(v_question_id::text);
      IF v_answer IS NULL THEN
        v_answer := '[]'::jsonb;
      END IF;
      IF jsonb_typeof(v_answer) <> 'array' OR
         jsonb_array_length(v_answer) > v_max_files OR
         (v_required AND jsonb_array_length(v_answer) = 0) THEN
        RAISE EXCEPTION 'intake_upload_claim_invalid';
      END IF;
      v_files := '[]'::jsonb;
      FOR v_file IN SELECT value FROM jsonb_array_elements(v_answer)
      LOOP
        BEGIN
          v_claim_id := (v_file->>'claim_id')::uuid;
        EXCEPTION WHEN invalid_text_representation THEN
          RAISE EXCEPTION 'intake_upload_claim_invalid';
        END;
        IF v_claim_id = ANY (v_seen_claim_ids) THEN
          RAISE EXCEPTION 'intake_upload_claim_replayed';
        END IF;
        v_seen_claim_ids := array_append(v_seen_claim_ids, v_claim_id);

        SELECT * INTO v_claim
        FROM public.trip_intake_upload_claims
        WHERE id = v_claim_id
        FOR UPDATE;
        IF NOT FOUND OR
           v_claim.upload_session_id IS DISTINCT FROM p_upload_session_id OR
           v_claim.event_id IS DISTINCT FROM p_event_id OR
           v_claim.ticket_type_id IS DISTINCT FROM v_ticket_type_id OR
           v_claim.question_id IS DISTINCT FROM v_question_id OR
           v_claim.schema_version_id IS DISTINCT FROM v_schema_version_id OR
           (v_claim.buyer_user_id IS NOT NULL AND
             v_claim.buyer_user_id IS DISTINCT FROM p_buyer_user_id) OR
           v_claim.expires_at <= now() OR
           v_claim.verified_mime_type IS NULL OR
           v_claim.verified_size_bytes IS NULL OR
           v_claim.content_sha256 IS NULL OR
           v_claim.object_path !~ ('^' || p_event_id::text || '/[0-9a-f-]{36}/[0-9a-f-]{36}\.[a-z0-9]+$') THEN
          RAISE EXCEPTION 'intake_upload_claim_invalid';
        END IF;
        IF v_claim.state = 'claimed' THEN
          IF v_claim.checkout_claim_key IS DISTINCT FROM p_checkout_claim_key OR
             v_claim.checkout_attempt_id IS DISTINCT FROM p_checkout_attempt_id THEN
            RAISE EXCEPTION 'intake_upload_claim_replayed';
          END IF;
        ELSIF v_claim.state <> 'accepted' THEN
          RAISE EXCEPTION 'intake_upload_claim_invalid';
        END IF;

        -- The request-only claim id and buyer filename are stripped. The only
        -- locator retained is the server-generated, verified private object
        -- path required by the existing authorized Host viewer.
        v_files := v_files || jsonb_build_array(jsonb_build_object(
          'path', v_claim.object_path,
          'mime_type', v_claim.verified_mime_type,
          'size_bytes', v_claim.verified_size_bytes
        ));
      END LOOP;
      v_sanitized_answers := jsonb_set(
        v_sanitized_answers,
        ARRAY[v_question_id::text],
        v_files,
        true
      );
    END LOOP;

    v_sanitized := v_sanitized || jsonb_build_array(jsonb_build_object(
      'ticket_type_id', v_ticket_type_id,
      'schema_version_id', v_schema_version_id,
      'answers', v_sanitized_answers
    ));
  END LOOP;

  RETURN jsonb_build_object(
    'intake_form_data', v_sanitized,
    'claim_ids', to_jsonb(v_seen_claim_ids)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.issue_3859_prepare_intake_upload_claims(
  uuid, uuid, uuid, text, uuid, jsonb, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3859_prepare_intake_upload_claims(
  uuid, uuid, uuid, text, uuid, jsonb, jsonb
) TO service_role;

CREATE OR REPLACE FUNCTION public.issue_3859_attach_intake_snapshot(
  p_checkout_session_id uuid,
  p_event_id uuid,
  p_buyer_user_id uuid,
  p_upload_session_id uuid,
  p_checkout_claim_key text,
  p_checkout_attempt_id uuid,
  p_lines jsonb,
  p_intake_form_data jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_existing public.ticket_checkout_intake_snapshots%ROWTYPE;
  v_claim_count integer;
  v_bound_count integer;
  v_prepared jsonb;
  v_sanitized jsonb;
  v_claim_ids uuid[];
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' OR
     NOT EXISTS (
       SELECT 1 FROM public.ticket_checkout_sessions
       WHERE id = p_checkout_session_id
         AND event_id = p_event_id
         AND idempotency_key = p_checkout_claim_key
         AND buyer_user_id IS NOT DISTINCT FROM p_buyer_user_id
     ) THEN
    RAISE EXCEPTION 'intake_upload_claim_invalid';
  END IF;

  -- This call performs the full scope/schema/expiry/state validation and locks
  -- every exact claim row in this transaction. It is read-only by design: if
  -- session creation or this attach fails, accepted claims remain retryable.
  v_prepared := public.issue_3859_prepare_intake_upload_claims(
    p_event_id,
    p_buyer_user_id,
    p_upload_session_id,
    p_checkout_claim_key,
    p_checkout_attempt_id,
    p_lines,
    p_intake_form_data
  );
  v_sanitized := v_prepared->'intake_form_data';
  SELECT COALESCE(array_agg(value::text::uuid), ARRAY[]::uuid[])
  INTO v_claim_ids
  FROM jsonb_array_elements_text(v_prepared->'claim_ids');
  v_claim_count := cardinality(v_claim_ids);

  SELECT * INTO v_existing
  FROM public.ticket_checkout_intake_snapshots
  WHERE checkout_session_id = p_checkout_session_id
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing.event_id IS DISTINCT FROM p_event_id OR
       v_existing.intake_form_data IS DISTINCT FROM v_sanitized OR
       v_existing.claim_count IS DISTINCT FROM v_claim_count THEN
      RAISE EXCEPTION 'intake_upload_claim_replayed';
    END IF;
  ELSE
    INSERT INTO public.ticket_checkout_intake_snapshots (
      checkout_session_id, event_id, intake_form_data, claim_count
    ) VALUES (
      p_checkout_session_id, p_event_id, v_sanitized, v_claim_count
    );
  END IF;

  UPDATE public.trip_intake_upload_claims claim
  SET state = 'claimed',
      checkout_claim_key = p_checkout_claim_key,
      checkout_attempt_id = p_checkout_attempt_id,
      checkout_session_id = p_checkout_session_id,
      claimed_at = COALESCE(claim.claimed_at, now()),
      updated_at = now()
  WHERE claim.id = ANY(v_claim_ids)
    AND (
      claim.state = 'accepted'
      OR (
        claim.state = 'claimed'
        AND claim.checkout_claim_key = p_checkout_claim_key
        AND claim.checkout_attempt_id IS NOT DISTINCT FROM p_checkout_attempt_id
        AND claim.checkout_session_id = p_checkout_session_id
      )
    );
  GET DIAGNOSTICS v_bound_count = ROW_COUNT;
  IF v_bound_count <> v_claim_count THEN
    RAISE EXCEPTION 'intake_upload_claim_replayed';
  END IF;
  RETURN v_sanitized;
END;
$$;

REVOKE ALL ON FUNCTION public.issue_3859_attach_intake_snapshot(
  uuid, uuid, uuid, uuid, text, uuid, jsonb, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3859_attach_intake_snapshot(
  uuid, uuid, uuid, uuid, text, uuid, jsonb, jsonb
) TO service_role;

CREATE OR REPLACE FUNCTION public.issue_3859_finalize_intake_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_snapshot public.ticket_checkout_intake_snapshots%ROWTYPE;
BEGIN
  IF NEW.order_id IS NULL OR NEW.order_id IS NOT DISTINCT FROM OLD.order_id THEN
    RETURN NEW;
  END IF;
  SELECT * INTO v_snapshot
  FROM public.ticket_checkout_intake_snapshots
  WHERE checkout_session_id = NEW.id;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  UPDATE public.orders
  SET intake_form_data = v_snapshot.intake_form_data
  WHERE id = NEW.order_id
    AND event_id = NEW.event_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'intake_upload_order_link_failed';
  END IF;

  UPDATE public.trip_intake_upload_claims
  SET order_id = NEW.order_id,
      finalized_at = now(),
      updated_at = now()
  WHERE checkout_session_id = NEW.id
    AND state = 'claimed';
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS issue_3859_finalize_intake_snapshot
  ON public.ticket_checkout_sessions;
CREATE TRIGGER issue_3859_finalize_intake_snapshot
AFTER UPDATE OF order_id ON public.ticket_checkout_sessions
FOR EACH ROW
EXECUTE FUNCTION public.issue_3859_finalize_intake_snapshot();

REVOKE ALL ON FUNCTION public.issue_3859_finalize_intake_snapshot() FROM PUBLIC;

COMMENT ON TABLE public.trip_intake_upload_claims IS
  '#3859: service-owned private intake upload manifests. No filename, signed URL, token, contact field, or answer value is stored here.';
COMMENT ON TABLE public.ticket_checkout_intake_snapshots IS
  '#3859: server-sanitized canonical intake payload attached to one checkout session and copied to its finalized order.';
