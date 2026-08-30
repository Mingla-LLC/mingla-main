-- Issue #2794 — private, bounded Business Recent pointer authority.
-- Presentation truth remains on events/venue_listings; this table stores only
-- the successful-open pointer and reconciliation receipt.

BEGIN;

CREATE TABLE public.business_recent_entity_opens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  entity_type text NOT NULL CONSTRAINT business_recent_entity_type_check
    CHECK (entity_type IN ('venue','event','rsvp','experience','trip')),
  entity_id uuid NOT NULL,
  last_opened_at timestamptz NOT NULL,
  server_received_at timestamptz NOT NULL DEFAULT now(),
  idempotency_operation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT business_recent_entity_unique
    UNIQUE (user_id, brand_id, entity_type, entity_id),
  CONSTRAINT business_recent_operation_unique
    UNIQUE (user_id, brand_id, idempotency_operation_id)
);

CREATE INDEX business_recent_scope_order_idx
  ON public.business_recent_entity_opens
  (user_id, brand_id, last_opened_at DESC, id DESC);

ALTER TABLE public.business_recent_entity_opens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_recent_entity_opens FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.business_recent_entity_opens FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.business_recent_entity_opens TO service_role;

CREATE TABLE public.business_recent_operation_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  operation_id uuid NOT NULL,
  entity_type text NOT NULL CONSTRAINT business_recent_receipt_entity_type_check
    CHECK (entity_type IN ('venue','event','rsvp','experience','trip')),
  entity_id uuid NOT NULL,
  accepted_opened_at timestamptz NOT NULL,
  retained boolean NOT NULL,
  server_received_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT business_recent_receipt_operation_unique
    UNIQUE (user_id, brand_id, operation_id)
);

CREATE INDEX business_recent_receipt_scope_order_idx
  ON public.business_recent_operation_receipts
  (user_id, brand_id, server_received_at DESC, id DESC);

ALTER TABLE public.business_recent_operation_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_recent_operation_receipts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.business_recent_operation_receipts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.business_recent_operation_receipts TO service_role;

CREATE FUNCTION public.biz_record_recent_entity_open(
  p_brand_id uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_opened_at timestamptz,
  p_operation_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_received_at timestamptz := clock_timestamp();
  v_accepted timestamptz;
  v_existing public.business_recent_entity_opens%ROWTYPE;
  v_receipt public.business_recent_operation_receipts%ROWTYPE;
  v_pointer_id uuid;
  v_retained boolean;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'recent_auth_required'; END IF;
  IF p_brand_id IS NULL OR p_entity_id IS NULL OR p_operation_id IS NULL OR p_opened_at IS NULL THEN
    RAISE EXCEPTION 'recent_invalid_arguments';
  END IF;
  IF p_entity_type NOT IN ('venue','event','rsvp','experience','trip') THEN
    RAISE EXCEPTION 'recent_invalid_entity_type';
  END IF;
  IF COALESCE(public.biz_brand_effective_rank(p_brand_id, v_uid), 0)
       < public.biz_role_rank('event_manager') THEN
    RAISE EXCEPTION 'recent_brand_forbidden';
  END IF;
  -- Serialize the complete read/upsert/prune transaction for one private scope.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_uid::text || ':' || p_brand_id::text, 2794));

  SELECT * INTO v_receipt
    FROM public.business_recent_operation_receipts
   WHERE user_id = v_uid AND brand_id = p_brand_id
     AND operation_id = p_operation_id;
  IF FOUND THEN
    IF v_receipt.entity_type <> p_entity_type OR v_receipt.entity_id <> p_entity_id THEN
      RAISE EXCEPTION 'recent_operation_mismatch';
    END IF;
    RETURN jsonb_build_object(
      'acceptedOpenedAt', v_receipt.accepted_opened_at,
      'retained', v_receipt.retained
    );
  END IF;

  IF p_entity_type = 'venue' THEN
    PERFORM 1 FROM public.venue_listings v
     WHERE v.id = p_entity_id AND v.brand_id = p_brand_id
       AND v.claim_status <> 'revoked';
  ELSE
    PERFORM 1 FROM public.events e
     WHERE e.id = p_entity_id AND e.brand_id = p_brand_id
       AND e.deleted_at IS NULL AND e.event_type = p_entity_type;
  END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'recent_entity_forbidden'; END IF;

  v_accepted := CASE
    WHEN p_opened_at > v_received_at + interval '5 minutes' THEN v_received_at
    ELSE p_opened_at
  END;

  SELECT * INTO v_existing
    FROM public.business_recent_entity_opens
   WHERE user_id = v_uid AND brand_id = p_brand_id
     AND idempotency_operation_id = p_operation_id;
  IF FOUND THEN
    IF v_existing.entity_type <> p_entity_type OR v_existing.entity_id <> p_entity_id THEN
      RAISE EXCEPTION 'recent_operation_mismatch';
    END IF;
    RETURN jsonb_build_object(
      'acceptedOpenedAt', v_existing.last_opened_at,
      'retained', EXISTS (
        SELECT 1 FROM public.business_recent_entity_opens r WHERE r.id = v_existing.id
      )
    );
  END IF;

  INSERT INTO public.business_recent_entity_opens (
    user_id, brand_id, entity_type, entity_id, last_opened_at,
    server_received_at, idempotency_operation_id
  ) VALUES (
    v_uid, p_brand_id, p_entity_type, p_entity_id, v_accepted,
    v_received_at, p_operation_id
  )
  ON CONFLICT (user_id, brand_id, entity_type, entity_id) DO UPDATE
    SET last_opened_at = GREATEST(
          public.business_recent_entity_opens.last_opened_at,
          EXCLUDED.last_opened_at
        ),
        server_received_at = v_received_at,
        idempotency_operation_id = EXCLUDED.idempotency_operation_id,
        updated_at = now()
  RETURNING id, last_opened_at INTO v_pointer_id, v_accepted;

  WITH pruned AS (
    DELETE FROM public.business_recent_entity_opens r
     WHERE r.user_id = v_uid AND r.brand_id = p_brand_id
       AND r.id IN (
         SELECT doomed.id
           FROM public.business_recent_entity_opens doomed
          WHERE doomed.user_id = v_uid AND doomed.brand_id = p_brand_id
          ORDER BY doomed.last_opened_at DESC, doomed.id DESC
          OFFSET 200
       )
    RETURNING r.entity_type, r.entity_id
  )
  UPDATE public.business_recent_operation_receipts receipt
     SET retained = false
    FROM pruned
   WHERE receipt.user_id = v_uid AND receipt.brand_id = p_brand_id
     AND receipt.entity_type = pruned.entity_type
     AND receipt.entity_id = pruned.entity_id;

  SELECT EXISTS (
    SELECT 1 FROM public.business_recent_entity_opens r WHERE r.id = v_pointer_id
  ) INTO v_retained;

  INSERT INTO public.business_recent_operation_receipts (
    user_id, brand_id, operation_id, entity_type, entity_id,
    accepted_opened_at, retained, server_received_at
  ) VALUES (
    v_uid, p_brand_id, p_operation_id, p_entity_type, p_entity_id,
    v_accepted, v_retained, v_received_at
  );

  DELETE FROM public.business_recent_operation_receipts receipt
   WHERE receipt.user_id = v_uid AND receipt.brand_id = p_brand_id
     AND receipt.id IN (
       SELECT doomed.id
         FROM public.business_recent_operation_receipts doomed
        WHERE doomed.user_id = v_uid AND doomed.brand_id = p_brand_id
        ORDER BY doomed.server_received_at DESC, doomed.id DESC
        OFFSET 400
     );
  RETURN jsonb_build_object('acceptedOpenedAt', v_accepted, 'retained', v_retained);
END;
$function$;

CREATE FUNCTION public.biz_list_recent_entity_index(p_brand_id uuid)
RETURNS TABLE (
  pointer_id uuid,
  entity_type text,
  entity_id uuid,
  last_opened_at timestamptz,
  raw_status text,
  starts_at timestamptz,
  ends_at timestamptz,
  ended_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'recent_auth_required'; END IF;
  IF COALESCE(public.biz_brand_effective_rank(p_brand_id, v_uid), 0)
       < public.biz_role_rank('event_manager') THEN
    RAISE EXCEPTION 'recent_brand_forbidden';
  END IF;
  RETURN QUERY
  SELECT r.id, r.entity_type, r.entity_id, r.last_opened_at,
         CASE WHEN r.entity_type = 'venue' THEN v.claim_status ELSE e.status END,
         CASE WHEN r.entity_type = 'venue' THEN NULL ELSE ed.start_at END,
         CASE WHEN r.entity_type = 'venue' THEN NULL ELSE ed.end_at END,
         CASE WHEN r.entity_type = 'venue' THEN NULL ELSE e.ended_at END
    FROM public.business_recent_entity_opens r
    LEFT JOIN public.events e
      ON r.entity_type <> 'venue' AND e.id = r.entity_id
     AND e.brand_id = p_brand_id AND e.deleted_at IS NULL
     AND e.event_type = r.entity_type
    LEFT JOIN LATERAL (
      SELECT d.start_at, d.end_at FROM public.event_dates d
       WHERE d.event_id = e.id AND d.is_master = true
       ORDER BY d.start_at ASC LIMIT 1
    ) ed ON true
    LEFT JOIN public.venue_listings v
      ON r.entity_type = 'venue' AND v.id = r.entity_id
     AND v.brand_id = p_brand_id AND v.claim_status <> 'revoked'
   WHERE r.user_id = v_uid AND r.brand_id = p_brand_id
     AND ((r.entity_type = 'venue' AND v.id IS NOT NULL)
       OR (r.entity_type <> 'venue' AND e.id IS NOT NULL))
   ORDER BY r.last_opened_at DESC, r.id DESC
   LIMIT 200;
END;
$function$;

CREATE FUNCTION public.biz_hydrate_recent_entities(p_brand_id uuid, p_refs jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_count integer;
  v_distinct integer;
  v_arbitrary integer;
  v_items jsonb;
  v_omitted jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'recent_auth_required'; END IF;
  IF COALESCE(public.biz_brand_effective_rank(p_brand_id, v_uid), 0)
       < public.biz_role_rank('event_manager') THEN
    RAISE EXCEPTION 'recent_brand_forbidden';
  END IF;
  IF jsonb_typeof(p_refs) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'recent_refs_invalid';
  END IF;

  SELECT count(*), count(DISTINCT (x->>'entityType', x->>'entityId'))
    INTO v_count, v_distinct
    FROM jsonb_array_elements(p_refs) x;
  IF v_count > 25 OR v_count <> v_distinct THEN
    RAISE EXCEPTION 'recent_refs_invalid';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_refs) x
     WHERE x->>'entityType' NOT IN ('venue','event','rsvp','experience','trip')
        OR COALESCE(x->>'entityId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ) THEN RAISE EXCEPTION 'recent_refs_invalid'; END IF;

  SELECT count(*) INTO v_arbitrary
    FROM jsonb_array_elements(p_refs) x
   WHERE NOT EXISTS (
     SELECT 1 FROM public.business_recent_entity_opens r
      WHERE r.user_id = v_uid AND r.brand_id = p_brand_id
        AND r.entity_type = x->>'entityType'
        AND r.entity_id = (x->>'entityId')::uuid
   );
  IF v_arbitrary > 0 THEN RAISE EXCEPTION 'recent_refs_forbidden'; END IF;

  WITH refs AS (
    SELECT x->>'entityType' AS entity_type,
           (x->>'entityId')::uuid AS entity_id, ordinality AS ord
      FROM jsonb_array_elements(p_refs) WITH ORDINALITY AS a(x, ordinality)
  ), visible AS (
    SELECT refs.ord, refs.entity_type, refs.entity_id,
           r.last_opened_at,
           CASE WHEN refs.entity_type = 'venue' THEN v.name ELSE e.title END AS title,
           CASE WHEN refs.entity_type = 'venue' THEN v.cover_media_url ELSE e.cover_media_url END AS cover_url,
           CASE WHEN refs.entity_type = 'venue' THEN v.cover_media_poster_url ELSE e.cover_media_poster_url END AS cover_poster_url,
           CASE WHEN refs.entity_type = 'venue' THEN v.cover_media_type ELSE e.cover_media_type END AS cover_type,
           CASE WHEN refs.entity_type = 'venue' THEN v.claim_status ELSE e.status END AS status,
           ed.start_at, ed.end_at
      FROM refs
      JOIN public.business_recent_entity_opens r
        ON r.user_id = v_uid AND r.brand_id = p_brand_id
       AND r.entity_type = refs.entity_type AND r.entity_id = refs.entity_id
      LEFT JOIN public.events e
        ON refs.entity_type <> 'venue' AND e.id = refs.entity_id
       AND e.brand_id = p_brand_id AND e.deleted_at IS NULL
       AND e.event_type = refs.entity_type
      LEFT JOIN LATERAL (
        SELECT d.start_at, d.end_at FROM public.event_dates d
         WHERE d.event_id = e.id AND d.is_master = true
         ORDER BY d.start_at ASC LIMIT 1
      ) ed ON true
      LEFT JOIN public.venue_listings v
        ON refs.entity_type = 'venue' AND v.id = refs.entity_id
       AND v.brand_id = p_brand_id AND v.claim_status <> 'revoked'
     WHERE (refs.entity_type = 'venue' AND v.id IS NOT NULL)
        OR (refs.entity_type <> 'venue' AND e.id IS NOT NULL)
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'entityType', entity_type, 'entityId', entity_id,
      'lastOpenedAt', last_opened_at, 'title', title,
      'coverUrl', cover_url, 'coverPosterUrl', cover_poster_url,
      'coverType', cover_type, 'status', status,
      'startsAt', start_at, 'endsAt', end_at
    ) ORDER BY ord), '[]'::jsonb)
    INTO v_items FROM visible;

  WITH refs AS (
    SELECT x->>'entityType' AS entity_type,
           (x->>'entityId')::uuid AS entity_id, ordinality AS ord
      FROM jsonb_array_elements(p_refs) WITH ORDINALITY AS a(x, ordinality)
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'entityType', refs.entity_type, 'entityId', refs.entity_id
    ) ORDER BY refs.ord), '[]'::jsonb)
    INTO v_omitted
    FROM refs
   WHERE NOT EXISTS (
     SELECT 1 FROM public.events e
      WHERE refs.entity_type <> 'venue' AND e.id = refs.entity_id
        AND e.brand_id = p_brand_id AND e.deleted_at IS NULL
        AND e.event_type = refs.entity_type
   ) AND NOT EXISTS (
     SELECT 1 FROM public.venue_listings v
      WHERE refs.entity_type = 'venue' AND v.id = refs.entity_id
        AND v.brand_id = p_brand_id AND v.claim_status <> 'revoked'
   );

  RETURN jsonb_build_object('items', v_items, 'omitted', v_omitted);
END;
$function$;

ALTER FUNCTION public.biz_record_recent_entity_open(uuid,text,uuid,timestamptz,uuid) OWNER TO postgres;
ALTER FUNCTION public.biz_list_recent_entity_index(uuid) OWNER TO postgres;
ALTER FUNCTION public.biz_hydrate_recent_entities(uuid,jsonb) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.biz_record_recent_entity_open(uuid,text,uuid,timestamptz,uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.biz_list_recent_entity_index(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.biz_hydrate_recent_entities(uuid,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.biz_record_recent_entity_open(uuid,text,uuid,timestamptz,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.biz_list_recent_entity_index(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.biz_hydrate_recent_entities(uuid,jsonb) TO authenticated;

COMMENT ON TABLE public.business_recent_entity_opens IS
  'Issue #2794: RPC-only private successful-open pointers, capped at 200 per user and brand.';
COMMENT ON TABLE public.business_recent_operation_receipts IS
  'Issue #2794: bounded user-effect receipts for idempotent Recent retries, capped at 400 per user and brand.';

COMMIT;
NOTIFY pgrst, 'reload schema';
