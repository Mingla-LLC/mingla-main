-- #4541 — RSVP forms on Explorer, passes and the door.
-- Depends on #4508 (claimed RSVP guests) and #4514 (brand forms).
--
-- I-4541-RSVP-FORM-ATOMIC: a capable RSVP client is checked and its valid
-- answer is persisted in the same transaction as the unchanged delivery RSVP
-- write. No RSVP/guest row is locked before submit_event_rsvp_with_delivery.
-- Older clients stay fail-open and leave the person in "to answer".

-- A claimed plus-one is their own subject. An unclaimed/matched-only row is
-- never an account relationship and never inherits the inviter's response.
CREATE OR REPLACE FUNCTION public.brand_form_subject_event(p_kind text, p_id uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
  SELECT CASE p_kind
    WHEN 'rsvp' THEN (SELECT r.event_id FROM public.event_rsvps r WHERE r.id = p_id)
    WHEN 'rsvp_guest' THEN (SELECT r.event_id FROM public.event_rsvp_guests g
                            JOIN public.event_rsvps r ON r.id = g.rsvp_id WHERE g.id = p_id)
    WHEN 'order' THEN (SELECT o.event_id FROM public.orders o WHERE o.id = p_id)
    ELSE NULL END;
$fn$;

CREATE OR REPLACE FUNCTION public.brand_form_user_response(p_form_id uuid, p_user_id uuid)
RETURNS public.brand_form_responses
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE v public.brand_form_responses;
BEGIN
  IF p_form_id IS NULL OR p_user_id IS NULL THEN RETURN v; END IF;
  SELECT * INTO v FROM public.brand_form_responses
   WHERE form_id = p_form_id AND user_id = p_user_id;
  IF FOUND THEN RETURN v; END IF;
  SELECT r.* INTO v FROM public.brand_form_responses r
    JOIN public.orders o ON o.id = r.order_id
   WHERE r.form_id = p_form_id AND o.buyer_user_id = p_user_id
   ORDER BY r.updated_at DESC, r.id LIMIT 1;
  IF FOUND THEN RETURN v; END IF;
  SELECT r.* INTO v FROM public.brand_form_responses r
    JOIN public.event_rsvps e ON e.id = r.rsvp_id
   WHERE r.form_id = p_form_id AND e.user_id = p_user_id
   ORDER BY r.updated_at DESC, r.id LIMIT 1;
  IF FOUND THEN RETURN v; END IF;
  SELECT r.* INTO v FROM public.brand_form_responses r
    JOIN public.event_rsvp_guests g ON g.id = r.rsvp_guest_id
   WHERE r.form_id = p_form_id AND g.matched_user_id = p_user_id
     AND g.claimed_at IS NOT NULL
   ORDER BY r.updated_at DESC, r.id LIMIT 1;
  RETURN v;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.brand_form_find_response(p_form_id uuid, p_kind text, p_id uuid)
RETURNS public.brand_form_responses
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE v public.brand_form_responses; v_user uuid;
BEGIN
  IF p_kind = 'rsvp' THEN
    SELECT * INTO v FROM public.brand_form_responses WHERE form_id = p_form_id AND rsvp_id = p_id;
    IF FOUND THEN RETURN v; END IF;
    SELECT r.user_id INTO v_user FROM public.event_rsvps r WHERE r.id = p_id;
  ELSIF p_kind = 'rsvp_guest' THEN
    SELECT * INTO v FROM public.brand_form_responses WHERE form_id = p_form_id AND rsvp_guest_id = p_id;
    IF FOUND THEN RETURN v; END IF;
    SELECT g.matched_user_id INTO v_user FROM public.event_rsvp_guests g
     WHERE g.id = p_id AND g.claimed_at IS NOT NULL;
  ELSIF p_kind = 'order' THEN
    SELECT * INTO v FROM public.brand_form_responses WHERE form_id = p_form_id AND order_id = p_id;
    IF FOUND THEN RETURN v; END IF;
    SELECT o.buyer_user_id INTO v_user FROM public.orders o WHERE o.id = p_id;
  ELSIF p_kind = 'user' THEN
    v_user := p_id;
  END IF;
  IF v_user IS NOT NULL THEN v := public.brand_form_user_response(p_form_id, v_user); END IF;
  RETURN v;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.brand_form_person_response(
  p_form_id uuid, p_kind text, p_id uuid, p_event_id uuid
) RETURNS public.brand_form_responses
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE v public.brand_form_responses; v_rsvp uuid; v_guest uuid; v_order uuid;
BEGIN
  IF p_kind <> 'user' OR p_event_id IS NULL THEN
    RETURN public.brand_form_find_response(p_form_id, p_kind, p_id);
  END IF;
  SELECT r.id INTO v_rsvp FROM public.event_rsvps r
   WHERE r.event_id = p_event_id AND r.user_id = p_id
   ORDER BY r.created_at DESC LIMIT 1;
  IF v_rsvp IS NOT NULL THEN
    SELECT * INTO v FROM public.brand_form_responses WHERE form_id = p_form_id AND rsvp_id = v_rsvp;
    IF FOUND THEN RETURN v; END IF;
  END IF;
  SELECT g.id INTO v_guest FROM public.event_rsvp_guests g
    JOIN public.event_rsvps r ON r.id = g.rsvp_id
   WHERE r.event_id = p_event_id AND g.matched_user_id = p_id AND g.claimed_at IS NOT NULL
   ORDER BY g.claimed_at DESC, g.id LIMIT 1;
  IF v_guest IS NOT NULL THEN
    SELECT * INTO v FROM public.brand_form_responses WHERE form_id = p_form_id AND rsvp_guest_id = v_guest;
    IF FOUND THEN RETURN v; END IF;
  END IF;
  SELECT o.id INTO v_order FROM public.orders o
   WHERE o.event_id = p_event_id AND o.buyer_user_id = p_id
     AND o.payment_status IN ('paid', 'partial_refund')
   ORDER BY o.created_at DESC LIMIT 1;
  IF v_order IS NOT NULL THEN
    SELECT * INTO v FROM public.brand_form_responses WHERE form_id = p_form_id AND order_id = v_order;
    IF FOUND THEN RETURN v; END IF;
  END IF;
  RETURN public.brand_form_find_response(p_form_id, 'user', p_id);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.brand_form_person_lock_key(
  p_form_id uuid, p_kind text, p_id uuid
) RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
  SELECT hashtextextended('brand_form_person:' || p_form_id::text || ':' || COALESCE(
    'user:' || (CASE p_kind
      WHEN 'user' THEN p_id
      WHEN 'rsvp' THEN (SELECT r.user_id FROM public.event_rsvps r WHERE r.id = p_id)
      WHEN 'rsvp_guest' THEN (SELECT g.matched_user_id FROM public.event_rsvp_guests g
                              WHERE g.id = p_id AND g.claimed_at IS NOT NULL)
      WHEN 'order' THEN (SELECT o.buyer_user_id FROM public.orders o WHERE o.id = p_id)
      ELSE NULL END)::text,
    p_kind || ':' || p_id::text), 0);
$fn$;

CREATE OR REPLACE FUNCTION public.brand_form_subject_contact(p_kind text, p_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
  SELECT CASE p_kind
    WHEN 'rsvp' THEN (SELECT jsonb_build_object('name', r.guest_name,
                         'email', NULLIF(lower(btrim(r.guest_email)), ''),
                         'phone', CASE WHEN btrim(r.guest_phone) ~ '^\+[1-9][0-9]{6,14}$' THEN btrim(r.guest_phone) END)
                        FROM public.event_rsvps r WHERE r.id = p_id)
    WHEN 'rsvp_guest' THEN (SELECT jsonb_build_object(
                         'name', COALESCE(NULLIF(btrim(g.name), ''),
                           NULLIF(btrim(concat_ws(' ', pr.first_name, pr.last_name)), ''), pr.display_name),
                         'email', NULLIF(lower(btrim(COALESCE(g.email, pr.email, u.email))), ''),
                         'phone', CASE WHEN btrim(COALESCE(g.phone, pr.phone)) ~ '^\+[1-9][0-9]{6,14}$'
                                       THEN btrim(COALESCE(g.phone, pr.phone)) END)
                        FROM public.event_rsvp_guests g
                        LEFT JOIN auth.users u ON u.id = g.matched_user_id
                        LEFT JOIN public.profiles pr ON pr.id = g.matched_user_id
                       WHERE g.id = p_id AND g.claimed_at IS NOT NULL AND g.matched_user_id IS NOT NULL)
    WHEN 'order' THEN (SELECT jsonb_build_object('name', o.buyer_name,
                         'email', NULLIF(lower(btrim(o.buyer_email)), ''),
                         'phone', CASE WHEN o.buyer_phone_e164 ~ '^\+[1-9][0-9]{6,14}$' THEN o.buyer_phone_e164 END)
                        FROM public.orders o WHERE o.id = p_id)
    WHEN 'user' THEN (SELECT jsonb_build_object(
                         'name', COALESCE(NULLIF(btrim(concat_ws(' ', pr.first_name, pr.last_name)), ''), pr.display_name),
                         'email', NULLIF(lower(btrim(COALESCE(pr.email, u.email))), ''),
                         'phone', CASE WHEN btrim(pr.phone) ~ '^\+[1-9][0-9]{6,14}$' THEN btrim(pr.phone) END)
                        FROM auth.users u LEFT JOIN public.profiles pr ON pr.id = u.id WHERE u.id = p_id)
    ELSE NULL END;
$fn$;

-- The signed-in form view recognizes a claimed RSVP guest as its own holder.
CREATE OR REPLACE FUNCTION public.brand_form_my_response(
  p_form_id uuid, p_event_id uuid DEFAULT NULL, p_token text DEFAULT NULL, p_challenge_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_f public.brand_forms;
  v_link public.brand_form_links;
  v_subject jsonb;
  v_resp public.brand_form_responses;
  v_def jsonb;
  v_state text;
  v_identity text;
  v_uid uuid := auth.uid();
  v_event uuid := p_event_id;
BEGIN
  SELECT * INTO v_f FROM public.brand_forms WHERE id = p_form_id AND status IN ('live', 'closed');
  IF NOT FOUND THEN RAISE EXCEPTION 'form_not_found' USING ERRCODE = 'P0002'; END IF;
  SELECT v.definition INTO v_def FROM public.brand_form_versions v WHERE v.id = v_f.live_version_id;

  IF p_token IS NOT NULL THEN
    v_link := public.brand_form_link_by_token(p_token);
    IF v_link.id IS NULL OR v_link.form_id <> p_form_id THEN
      RAISE EXCEPTION 'link_invalid' USING ERRCODE = '42501';
    END IF;
    IF v_link.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'link_revoked' USING ERRCODE = '42501'; END IF;
    v_subject := public.brand_form_link_subject(v_link);
    IF v_subject IS NULL THEN RAISE EXCEPTION 'link_invalid' USING ERRCODE = '42501'; END IF;
    v_resp := public.brand_form_person_response(
      p_form_id, v_subject->>'kind', (v_subject->>'id')::uuid, v_link.event_id);
    v_identity := public.brand_form_short_name(
      public.brand_form_subject_contact(v_subject->>'kind', (v_subject->>'id')::uuid)->>'name');
    v_event := COALESCE(v_link.event_id, v_event);
    IF (v_resp.id IS NOT NULL OR v_link.expires_at <= now())
       AND NOT public.brand_form_code_grant_ok(v_link.id, p_challenge_id) THEN
      RETURN jsonb_build_object('state', 'code_required', 'answered', v_resp.id IS NOT NULL,
        'recognized', v_link.expires_at > now(), 'identity', v_identity,
        'form', jsonb_build_object('id', v_f.id, 'name', v_f.name, 'status', v_f.status),
        'brand', public.brand_form_brand_header(v_f.brand_id));
    END IF;
  ELSIF v_uid IS NOT NULL THEN
    v_resp := public.brand_form_person_response(p_form_id, 'user', v_uid, v_event);
    IF v_resp.id IS NULL AND NOT (v_event IS NOT NULL AND EXISTS (
         SELECT 1 FROM public.brand_form_attachments a
          WHERE a.event_id = v_event AND a.form_id = p_form_id AND a.detached_at IS NULL
            AND (EXISTS (SELECT 1 FROM public.event_rsvps r
                          WHERE r.event_id = v_event AND r.user_id = v_uid AND r.rsvp_status = 'going')
              OR EXISTS (SELECT 1 FROM public.event_rsvp_guests g
                          JOIN public.event_rsvps r ON r.id = g.rsvp_id
                         WHERE r.event_id = v_event AND g.matched_user_id = v_uid
                           AND g.claimed_at IS NOT NULL AND r.rsvp_status = 'going')
              OR EXISTS (SELECT 1 FROM public.orders o
                          WHERE o.event_id = v_event AND o.buyer_user_id = v_uid
                            AND o.payment_status IN ('paid', 'partial_refund'))
              OR EXISTS (SELECT 1 FROM public.tickets t
                          WHERE t.event_id = v_event AND t.holder_user_id = v_uid AND t.status IN ('valid', 'used'))
              OR (a.mode = 'optional_on_page' AND public.brand_form_event_public(v_event))))) THEN
      RAISE EXCEPTION 'form_not_found' USING ERRCODE = 'P0002';
    END IF;
  ELSE
    RAISE EXCEPTION 'not_signed_in' USING ERRCODE = '42501';
  END IF;

  v_state := CASE WHEN v_resp.id IS NULL THEN 'unanswered' ELSE 'answered' END;
  RETURN jsonb_build_object(
    'state', v_state, 'identity', v_identity, 'recognized', true,
    'form', jsonb_build_object('id', v_f.id, 'name', v_f.name, 'status', v_f.status,
              'versionId', v_f.live_version_id, 'definition', v_def, 'doorFullAnswers', v_f.door_full_answers),
    'eventId', v_event,
    'brand', public.brand_form_brand_header(v_f.brand_id),
    'response', CASE WHEN v_resp.id IS NULL THEN NULL ELSE jsonb_build_object(
       'id', v_resp.id, 'versionId', v_resp.version_id,
       'definition', (SELECT v.definition FROM public.brand_form_versions v WHERE v.id = v_resp.version_id),
       'isCurrentVersion', v_resp.version_id = v_f.live_version_id,
       'answers', v_resp.answers, 'editCount', v_resp.edit_count, 'updatedAt', v_resp.updated_at) END);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.brand_forms_my_pending() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE v_uid uuid := auth.uid(); v_out jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_signed_in' USING ERRCODE = '42501'; END IF;
  IF public.brand_forms_switched_off() THEN RETURN '[]'::jsonb; END IF;
  WITH held AS (
    SELECT r.event_id, 'rsvp'::text AS kind, r.id AS subject_id
      FROM public.event_rsvps r WHERE r.user_id = v_uid AND r.rsvp_status = 'going'
    UNION ALL
    SELECT r.event_id, 'rsvp_guest', g.id
      FROM public.event_rsvp_guests g JOIN public.event_rsvps r ON r.id = g.rsvp_id
     WHERE g.matched_user_id = v_uid AND g.claimed_at IS NOT NULL AND r.rsvp_status = 'going'
    UNION ALL
    SELECT o.event_id, 'order', o.id FROM public.orders o
     WHERE o.buyer_user_id = v_uid AND o.payment_status IN ('paid', 'partial_refund')
  ), items AS (
    SELECT h.event_id, h.kind, h.subject_id, a.*
      FROM held h
      JOIN public.events e ON e.id = h.event_id AND e.deleted_at IS NULL AND e.status IN ('scheduled', 'live')
      CROSS JOIN LATERAL public.brand_form_active_for_event(h.event_id) a
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'eventId', i.event_id, 'eventTitle', (SELECT e.title FROM public.events e WHERE e.id = i.event_id),
           'subject', jsonb_build_object('kind', i.kind, 'id', i.subject_id),
           'attachmentId', i.attachment_id, 'mode', i.mode, 'required', i.mode = 'required_step',
           'formId', i.form_id, 'formName', i.form_name, 'formStatus', i.form_status,
           'versionId', i.live_version_id, 'doorFullAnswers', i.door_full_answers,
           'answered', resp.id IS NOT NULL, 'responseId', resp.id,
           'answeredVersionId', resp.version_id, 'answeredSource', resp.source,
           'brand', public.brand_form_brand_header(i.brand_id))
           ORDER BY i.event_id, i.kind, i.subject_id), '[]'::jsonb)
    INTO v_out
    FROM items i
    CROSS JOIN LATERAL (SELECT (public.brand_form_find_response(i.form_id, i.kind, i.subject_id)).*) resp
   WHERE i.form_status = 'live' OR resp.id IS NOT NULL;
  RETURN v_out;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.brand_form_link_issue(
  p_form_id uuid, p_event_id uuid, p_subject jsonb, p_created_by uuid DEFAULT NULL, p_ttl_days integer DEFAULT 30
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_f public.brand_forms; v_kind text := p_subject->>'kind'; v_id uuid; v_event uuid;
  v_token text; v_link uuid; v_exp timestamptz; v_att uuid;
BEGIN
  SELECT * INTO v_f FROM public.brand_forms WHERE id = p_form_id AND status IN ('live', 'closed');
  IF NOT FOUND THEN RAISE EXCEPTION 'form_not_found' USING ERRCODE = 'P0002'; END IF;
  IF COALESCE(v_kind, '') NOT IN ('rsvp', 'rsvp_guest', 'order', 'user')
     OR COALESCE(p_subject->>'id', '') !~ '^[0-9a-fA-F-]{36}$' THEN
    RAISE EXCEPTION 'subject_invalid' USING ERRCODE = '22023';
  END IF;
  v_id := (p_subject->>'id')::uuid;
  IF v_kind IN ('rsvp', 'rsvp_guest', 'order') THEN
    v_event := public.brand_form_subject_event(v_kind, v_id);
    IF v_event IS NULL OR v_event IS DISTINCT FROM p_event_id
       OR (v_kind = 'rsvp_guest' AND NOT EXISTS (
         SELECT 1 FROM public.event_rsvp_guests g
          WHERE g.id = v_id AND g.claimed_at IS NOT NULL AND g.matched_user_id IS NOT NULL)) THEN
      RAISE EXCEPTION 'subject_other_event' USING ERRCODE = '42501';
    END IF;
  ELSIF NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = v_id) THEN
    RAISE EXCEPTION 'subject_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_event_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.events e WHERE e.id = p_event_id AND e.brand_id = v_f.brand_id) THEN
      RAISE EXCEPTION 'form_not_on_event' USING ERRCODE = '42501';
    END IF;
    SELECT a.id INTO v_att FROM public.brand_form_attachments a
     WHERE a.event_id = p_event_id AND a.form_id = p_form_id AND a.detached_at IS NULL;
    IF v_att IS NULL THEN RAISE EXCEPTION 'form_not_on_event' USING ERRCODE = '42501'; END IF;
  END IF;
  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  v_exp := now() + make_interval(days => LEAST(GREATEST(COALESCE(p_ttl_days, 30), 1), 30));
  INSERT INTO public.brand_form_links (
    form_id, attachment_id, event_id, kind, rsvp_id, rsvp_guest_id, order_id, user_id,
    token_hash, expires_at, created_by)
  VALUES (p_form_id, v_att, p_event_id, 'person',
    CASE WHEN v_kind = 'rsvp' THEN v_id END,
    CASE WHEN v_kind = 'rsvp_guest' THEN v_id END,
    CASE WHEN v_kind = 'order' THEN v_id END,
    CASE WHEN v_kind = 'user' THEN v_id END,
    public.brand_form_token_hash(v_token), v_exp, p_created_by)
  RETURNING id INTO v_link;
  RETURN jsonb_build_object('linkId', v_link, 'token', v_token, 'expiresAt', v_exp, 'formId', p_form_id);
END;
$fn$;

-- The signup wrapper locks only the form/attachment authority before the inner
-- write. The #4508 RSVP and guest locks remain wholly owned by the inner RPC.
CREATE OR REPLACE FUNCTION public.submit_event_rsvp_with_form(
  p_event_id uuid,
  p_user_id uuid,
  p_guest_name text,
  p_guest_email text,
  p_guest_phone text,
  p_rsvp_status text,
  p_plus_count integer DEFAULT 0,
  p_guests jsonb DEFAULT '[]'::jsonb,
  p_qr_token_pepper text DEFAULT NULL,
  p_guest_phone_country_iso text DEFAULT NULL,
  p_capable boolean DEFAULT false,
  p_form jsonb DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_a record;
  v_existing_id uuid;
  v_check jsonb;
  v_write boolean := false;
  v_result jsonb;
  v_rsvp_id uuid;
  v_response_id uuid;
  v_uuid constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
BEGIN
  -- Can't-go never asks or writes questions. The kill switch likewise makes
  -- the wrapper indistinguishable from the unchanged delivery RPC.
  IF p_rsvp_status = 'not_going' OR public.brand_forms_switched_off() THEN
    RETURN public.submit_event_rsvp_with_delivery(
      p_event_id,p_user_id,p_guest_name,p_guest_email,p_guest_phone,p_rsvp_status,
      p_plus_count,p_guests,p_qr_token_pepper,p_guest_phone_country_iso);
  END IF;

  SELECT a.id AS attachment_id, a.mode, f.id AS form_id, f.brand_id,
         f.live_version_id, f.status
    INTO v_a
    FROM public.brand_form_attachments a
    JOIN public.brand_forms f ON f.id = a.form_id
    JOIN public.events e ON e.id = a.event_id AND e.brand_id = f.brand_id
   WHERE a.event_id = p_event_id AND a.detached_at IS NULL
     AND f.status IN ('live', 'closed') AND f.live_version_id IS NOT NULL
   FOR SHARE OF a, f;

  -- No form, a closed form, or an old client: RSVP first; answer later.
  IF NOT FOUND OR v_a.status <> 'live' OR NOT COALESCE(p_capable, false) THEN
    RETURN public.submit_event_rsvp_with_delivery(
      p_event_id,p_user_id,p_guest_name,p_guest_email,p_guest_phone,p_rsvp_status,
      p_plus_count,p_guests,p_qr_token_pepper,p_guest_phone_country_iso);
  END IF;

  IF p_user_id IS NOT NULL THEN
    v_existing_id := (public.brand_form_person_response(v_a.form_id, 'user', p_user_id, p_event_id)).id;
  END IF;

  IF p_form IS NULL OR jsonb_typeof(p_form) = 'null' THEN
    IF v_a.mode = 'required_step' AND v_existing_id IS NULL THEN
      RAISE EXCEPTION 'form_answers_required' USING ERRCODE = '22023',
        DETAIL = jsonb_build_object('formId', v_a.form_id, 'versionId', v_a.live_version_id)::text;
    END IF;
  ELSIF jsonb_typeof(p_form) <> 'object'
     OR COALESCE(p_form->>'formId', '') !~ v_uuid
     OR COALESCE(p_form->>'versionId', '') !~ v_uuid
     OR jsonb_typeof(p_form->'answers') IS DISTINCT FROM 'object'
     OR p_form - ARRAY['formId','versionId','answers'] <> '{}'::jsonb THEN
    IF v_a.mode = 'required_step' THEN
      RAISE EXCEPTION 'form_answers_invalid' USING ERRCODE = '22023',
        DETAIL = jsonb_build_array(jsonb_build_object('questionId', NULL, 'code', 'type'))::text;
    END IF;
  ELSIF (p_form->>'formId')::uuid IS DISTINCT FROM v_a.form_id
     OR (p_form->>'versionId')::uuid IS DISTINCT FROM v_a.live_version_id THEN
    IF v_a.mode = 'required_step' THEN
      RAISE EXCEPTION 'form_changed' USING ERRCODE = 'PT409',
        DETAIL = jsonb_build_object('formId', v_a.form_id, 'versionId', v_a.live_version_id)::text;
    END IF;
  ELSE
    BEGIN
      v_check := public.brand_form_validate_answers(v_a.live_version_id, p_form->'answers');
    EXCEPTION WHEN data_exception THEN
      v_check := jsonb_build_object('ok', false,
        'errors', jsonb_build_array(jsonb_build_object('questionId', NULL, 'code', 'type')));
    END;
    IF NOT COALESCE((v_check->>'ok')::boolean, false) THEN
      IF v_a.mode = 'required_step' THEN
        RAISE EXCEPTION 'form_answers_invalid' USING ERRCODE = '22023', DETAIL = (v_check->'errors')::text;
      END IF;
    ELSE
      v_write := true;
    END IF;
  END IF;

  v_result := public.submit_event_rsvp_with_delivery(
    p_event_id,p_user_id,p_guest_name,p_guest_email,p_guest_phone,p_rsvp_status,
    p_plus_count,p_guests,p_qr_token_pepper,p_guest_phone_country_iso);
  v_rsvp_id := NULLIF(v_result->>'rsvpId', '')::uuid;

  IF v_write AND v_rsvp_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(public.brand_form_person_lock_key(v_a.form_id, 'rsvp', v_rsvp_id));
    -- INSERT-ONLY. The wrapper never updates a stored answer: clients do not
    -- pre-fill, so a re-RSVP would wipe it with no stale-edit check (edits go
    -- through brand_form_submit_core and its expectedEditCount). A row is
    -- inserted for THIS RSVP id only when the answers are non-empty and none
    -- of these already exists for this form (the rows the host's responses
    -- read for this event would show for this person):
    --   1. a row on this exact RSVP id (anyone's);
    --   2. the caller's account-level row (user_id = caller), any page;
    --   3. a row on another RSVP of the caller at this event;
    --   4. a row on an order the caller bought at this event;
    --   5. a row on a plus-one the caller claimed at this event.
    -- The caller's plus-one or order answer at ANOTHER event does not block and
    -- is never touched or moved here.
    v_existing_id := NULL;
    SELECT r.id INTO v_existing_id FROM public.brand_form_responses r
     WHERE r.form_id = v_a.form_id
       AND (r.rsvp_id = v_rsvp_id
         OR (p_user_id IS NOT NULL AND (
              r.user_id = p_user_id
           OR EXISTS (SELECT 1 FROM public.event_rsvps x
                       WHERE x.id = r.rsvp_id AND x.event_id = p_event_id AND x.user_id = p_user_id)
           OR EXISTS (SELECT 1 FROM public.orders o
                       WHERE o.id = r.order_id AND o.event_id = p_event_id AND o.buyer_user_id = p_user_id)
           OR EXISTS (SELECT 1 FROM public.event_rsvp_guests g
                        JOIN public.event_rsvps x ON x.id = g.rsvp_id
                       WHERE g.id = r.rsvp_guest_id AND x.event_id = p_event_id
                         AND g.matched_user_id = p_user_id AND g.claimed_at IS NOT NULL))))
     ORDER BY (r.rsvp_id = v_rsvp_id) DESC NULLS LAST, r.updated_at DESC, r.id
     LIMIT 1;
    -- Empty: no question carries a non-null, non-blank value.
    IF v_existing_id IS NULL AND EXISTS (
         SELECT 1 FROM jsonb_each(COALESCE(v_check->'answers', '{}'::jsonb)) a
          WHERE jsonb_typeof(a.value) <> 'null'
            AND NOT (jsonb_typeof(a.value) = 'string' AND btrim(a.value #>> '{}') = '')
            AND NOT (jsonb_typeof(a.value) = 'array' AND jsonb_array_length(a.value) = 0)
            AND NOT (jsonb_typeof(a.value) = 'object' AND a.value = '{}'::jsonb)) THEN
      INSERT INTO public.brand_form_responses (
        form_id, version_id, brand_id, attachment_id, event_id, rsvp_id,
        answers, source, verified, via_link)
      VALUES (
        v_a.form_id, v_a.live_version_id, v_a.brand_id, v_a.attachment_id,
        p_event_id, v_rsvp_id, v_check->'answers', 'signup', true, false)
      RETURNING id INTO v_response_id;
    ELSE
      v_response_id := v_existing_id;
    END IF;
    v_result := v_result || jsonb_build_object('brandFormResponseId', v_response_id);
  END IF;
  RETURN v_result;
END;
$fn$;

-- Claimed RSVP guests submit with their exact pass id. A mere phone match is
-- never enough: claimed_at and matched_user_id must both name this caller.
CREATE OR REPLACE FUNCTION public.brand_form_submit_core(p jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_form_id uuid; v_f public.brand_forms; v_cred jsonb := p->'credential';
  v_link public.brand_form_links; v_kind text; v_sid uuid; v_user uuid; v_event uuid; v_att uuid;
  v_version uuid; v_check jsonb; v_existing public.brand_form_responses;
  v_source text := COALESCE(p->>'source', 'page'); v_via_link boolean := false;
  v_id uuid; v_edit integer; v_expected integer;
  v_uuid constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
BEGIN
  IF public.brand_forms_switched_off() THEN RAISE EXCEPTION 'forms_paused' USING ERRCODE = '55000'; END IF;
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR COALESCE(p->>'formId', '') !~ v_uuid
     OR jsonb_typeof(v_cred) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'credential_invalid' USING ERRCODE = '22023';
  END IF;
  IF v_source NOT IN ('signup', 'page', 'link', 'pass', 'purchase_redirect', 'blast') THEN
    RAISE EXCEPTION 'credential_invalid' USING ERRCODE = '22023';
  END IF;
  v_form_id := (p->>'formId')::uuid;
  SELECT * INTO v_f FROM public.brand_forms WHERE id = v_form_id FOR SHARE;
  IF NOT FOUND OR v_f.status = 'archived' THEN RAISE EXCEPTION 'form_not_found' USING ERRCODE = 'P0002'; END IF;
  IF v_f.status = 'draft' THEN RAISE EXCEPTION 'form_not_live' USING ERRCODE = '22023'; END IF;
  IF v_f.status = 'closed' THEN RAISE EXCEPTION 'form_closed' USING ERRCODE = '22023'; END IF;
  IF p ? 'versionId' AND jsonb_typeof(p->'versionId') <> 'null'
     AND (p->>'versionId') IS DISTINCT FROM v_f.live_version_id::text THEN
    RAISE EXCEPTION 'form_changed' USING ERRCODE = 'PT409',
      DETAIL = jsonb_build_object('versionId', v_f.live_version_id)::text;
  END IF;
  v_version := v_f.live_version_id;

  IF v_cred->>'kind' = 'link' THEN
    v_link := public.brand_form_link_by_token(v_cred->>'token');
    IF v_link.id IS NULL THEN RAISE EXCEPTION 'link_invalid' USING ERRCODE = '42501'; END IF;
    IF v_link.form_id <> v_form_id THEN RAISE EXCEPTION 'link_wrong_form' USING ERRCODE = '42501'; END IF;
    IF v_link.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'link_revoked' USING ERRCODE = '42501'; END IF;
    IF v_link.kind <> 'person' THEN RAISE EXCEPTION 'subject_unavailable' USING ERRCODE = '22023'; END IF;
    v_kind := public.brand_form_link_subject(v_link)->>'kind';
    v_sid := (public.brand_form_link_subject(v_link)->>'id')::uuid;
    v_event := v_link.event_id;
    v_via_link := true;
  ELSIF v_cred->>'kind' = 'user' THEN
    IF (v_cred->>'userId') !~ v_uuid THEN RAISE EXCEPTION 'credential_invalid' USING ERRCODE = '22023'; END IF;
    v_user := (v_cred->>'userId')::uuid;
    IF (v_cred->>'rsvpGuestId') ~ v_uuid THEN
      v_kind := 'rsvp_guest'; v_sid := (v_cred->>'rsvpGuestId')::uuid;
      SELECT r.event_id INTO v_event
        FROM public.event_rsvp_guests g JOIN public.event_rsvps r ON r.id = g.rsvp_id
       WHERE g.id = v_sid AND g.matched_user_id = v_user AND g.claimed_at IS NOT NULL
         AND r.rsvp_status = 'going';
      IF NOT FOUND THEN RAISE EXCEPTION 'not_holder' USING ERRCODE = '42501'; END IF;
    ELSIF (v_cred->>'rsvpId') ~ v_uuid THEN
      v_kind := 'rsvp'; v_sid := (v_cred->>'rsvpId')::uuid;
      SELECT r.event_id INTO v_event FROM public.event_rsvps r WHERE r.id = v_sid AND r.user_id = v_user;
      IF NOT FOUND THEN RAISE EXCEPTION 'not_holder' USING ERRCODE = '42501'; END IF;
    ELSIF (v_cred->>'orderId') ~ v_uuid THEN
      v_kind := 'order'; v_sid := (v_cred->>'orderId')::uuid;
      SELECT o.event_id INTO v_event FROM public.orders o
       WHERE o.id = v_sid AND o.buyer_user_id = v_user AND o.payment_status IN ('paid', 'partial_refund');
      IF NOT FOUND THEN RAISE EXCEPTION 'not_holder' USING ERRCODE = '42501'; END IF;
    ELSE
      v_kind := 'user'; v_sid := v_user;
      IF NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = v_user) THEN
        RAISE EXCEPTION 'credential_invalid' USING ERRCODE = '22023';
      END IF;
      IF (p->>'eventId') ~ v_uuid THEN v_event := (p->>'eventId')::uuid; END IF;
    END IF;
  ELSE
    RAISE EXCEPTION 'credential_invalid' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(v_kind, '') NOT IN ('rsvp', 'rsvp_guest', 'order', 'user') THEN
    RAISE EXCEPTION 'subject_unavailable' USING ERRCODE = '22023';
  END IF;
  IF NOT v_via_link AND v_event IS NULL THEN
    RAISE EXCEPTION 'form_not_on_event' USING ERRCODE = '42501';
  END IF;
  IF v_event IS NOT NULL THEN
    SELECT a.id INTO v_att FROM public.brand_form_attachments a
     WHERE a.event_id = v_event AND a.form_id = v_form_id AND a.detached_at IS NULL;
    IF v_att IS NULL THEN RAISE EXCEPTION 'form_not_on_event' USING ERRCODE = '42501'; END IF;
  END IF;

  PERFORM pg_advisory_xact_lock(public.brand_form_person_lock_key(v_form_id, v_kind, v_sid));
  v_existing := public.brand_form_person_response(v_form_id, v_kind, v_sid, v_event);
  IF v_via_link AND (v_existing.id IS NOT NULL OR v_link.expires_at <= now())
     AND NOT public.brand_form_code_grant_ok(v_link.id,
       CASE WHEN (v_cred->>'challengeId') ~ v_uuid THEN (v_cred->>'challengeId')::uuid END) THEN
    RAISE EXCEPTION 'code_required' USING ERRCODE = '42501';
  END IF;
  v_expected := CASE WHEN jsonb_typeof(p->'expectedEditCount') = 'number'
                          AND (p->>'expectedEditCount') ~ '^[0-9]{1,9}$'
                     THEN (p->>'expectedEditCount')::integer
                     WHEN jsonb_typeof(p->'expectedEditCount') = 'number' THEN -1 END;
  IF (v_expected IS NOT NULL AND (v_existing.id IS NULL OR v_existing.edit_count <> v_expected))
     OR (v_expected IS NULL AND v_existing.id IS NOT NULL) THEN
    RAISE EXCEPTION 'response_stale' USING ERRCODE = 'PT409',
      DETAIL = jsonb_build_object('editCount', v_existing.edit_count)::text;
  END IF;
  BEGIN
    v_check := public.brand_form_validate_answers(v_version, p->'answers');
  EXCEPTION WHEN data_exception THEN
    v_check := jsonb_build_object('ok', false,
      'errors', jsonb_build_array(jsonb_build_object('questionId', NULL, 'code', 'type')));
  END;
  IF NOT (v_check->>'ok')::boolean THEN
    RAISE EXCEPTION 'form_answers_invalid' USING ERRCODE = '22023', DETAIL = (v_check->'errors')::text;
  END IF;

  IF v_existing.id IS NULL THEN
    INSERT INTO public.brand_form_responses (
      form_id, version_id, brand_id, attachment_id, event_id,
      rsvp_id, rsvp_guest_id, order_id, user_id, answers, source, via_link)
    VALUES (v_form_id, v_version, v_f.brand_id, v_att, v_event,
      CASE WHEN v_kind = 'rsvp' THEN v_sid END,
      CASE WHEN v_kind = 'rsvp_guest' THEN v_sid END,
      CASE WHEN v_kind = 'order' THEN v_sid END,
      CASE WHEN v_kind = 'user' THEN v_sid END,
      v_check->'answers', v_source, v_via_link)
    RETURNING id, edit_count INTO v_id, v_edit;
  ELSE
    UPDATE public.brand_form_responses
       SET answers = v_check->'answers', version_id = v_version, edit_count = edit_count + 1,
           updated_at = now(), source = v_source, via_link = via_link OR v_via_link,
           attachment_id = COALESCE(v_att, attachment_id), event_id = COALESCE(event_id, v_event)
     WHERE id = v_existing.id
    RETURNING id, edit_count INTO v_id, v_edit;
  END IF;
  IF v_via_link THEN
    UPDATE public.brand_form_links SET use_count = use_count + 1, last_used_at = now() WHERE id = v_link.id;
  END IF;
  RETURN jsonb_build_object('responseId', v_id, 'editCount', v_edit, 'versionId', v_version,
                            'created', v_existing.id IS NULL, 'eventId', v_event);
END;
$fn$;

ALTER TABLE public.brand_form_request_sends
  ADD COLUMN rsvp_guest_id uuid REFERENCES public.event_rsvp_guests(id) ON DELETE CASCADE;
ALTER TABLE public.brand_form_request_sends
  DROP CONSTRAINT brand_form_request_sends_one_subject,
  ADD CONSTRAINT brand_form_request_sends_one_subject
    CHECK (num_nonnulls(rsvp_id, rsvp_guest_id, order_id) = 1);
CREATE INDEX brand_form_request_sends_rsvp_guest_idx
  ON public.brand_form_request_sends (form_id, rsvp_guest_id, created_at DESC)
  WHERE rsvp_guest_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.brand_form_request_guests(
  p_form_id uuid, p_event_id uuid, p_subjects jsonb DEFAULT NULL
) RETURNS TABLE (g_kind text, g_id uuid, g_user_id uuid, g_name text, g_answered boolean,
                 g_phone text, g_email text, g_person_key text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
  WITH guests AS (
    SELECT 'rsvp'::text AS kind, x.id, x.user_id, x.guest_name AS name,
           (public.brand_form_find_response(p_form_id, 'rsvp', x.id)).id IS NOT NULL AS answered
      FROM public.event_rsvps x WHERE x.event_id = p_event_id AND x.rsvp_status = 'going'
    UNION ALL
    SELECT 'rsvp_guest', g.id, g.matched_user_id,
           COALESCE(NULLIF(btrim(g.name), ''),
             NULLIF(btrim(concat_ws(' ', pr.first_name, pr.last_name)), ''), pr.display_name),
           (public.brand_form_find_response(p_form_id, 'rsvp_guest', g.id)).id IS NOT NULL
      FROM public.event_rsvp_guests g
      JOIN public.event_rsvps x ON x.id = g.rsvp_id
      LEFT JOIN public.profiles pr ON pr.id = g.matched_user_id
     WHERE x.event_id = p_event_id AND x.rsvp_status = 'going'
       AND g.claimed_at IS NOT NULL AND g.matched_user_id IS NOT NULL
    UNION ALL
    SELECT 'order', o.id, o.buyer_user_id, o.buyer_name,
           (public.brand_form_find_response(p_form_id, 'order', o.id)).id IS NOT NULL
      FROM public.orders o WHERE o.event_id = p_event_id AND o.payment_status IN ('paid', 'partial_refund')
  ), picked AS (
    SELECT g.*, public.brand_form_subject_contact(g.kind, g.id) AS contact FROM guests g
     WHERE p_subjects IS NULL OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_subjects) s
                                          WHERE s->>'kind' = g.kind AND lower(s->>'id') = g.id::text)
  )
  SELECT p.kind, p.id, p.user_id, p.name, p.answered, p.contact->>'phone', p.contact->>'email',
         public.brand_form_person_key(p.user_id, p.kind, p.id)
    FROM picked p;
$fn$;

CREATE OR REPLACE FUNCTION public.brand_form_request_audience(
  p_actor_id uuid, p_form_id uuid, p_event_id uuid, p_audience text DEFAULT 'unanswered',
  p_subjects jsonb DEFAULT NULL, p_channels text[] DEFAULT ARRAY['email', 'sms']
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_e record; v_f public.brand_forms; v_att uuid; v_rows jsonb; v_n integer;
  v_ch text[] := ARRAY(SELECT DISTINCT c FROM unnest(COALESCE(p_channels, ARRAY[]::text[])) c
                        WHERE c IN ('sms', 'email'));
  v_window timestamptz;
BEGIN
  IF p_audience IS NULL OR p_audience NOT IN ('unanswered', 'everyone') THEN
    RAISE EXCEPTION 'audience_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_subjects IS NOT NULL AND (jsonb_typeof(p_subjects) <> 'array'
     OR jsonb_array_length(p_subjects) NOT BETWEEN 1 AND 500
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_subjects) s
                 WHERE jsonb_typeof(s) <> 'object'
                    OR COALESCE(s->>'kind', '') NOT IN ('rsvp', 'rsvp_guest', 'order')
                    OR COALESCE(s->>'id', '') !~ '^[0-9a-fA-F-]{36}$')) THEN
    RAISE EXCEPTION 'subjects_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT e.id, e.brand_id, e.title, e.deleted_at, e.status, e.timezone
    INTO v_e FROM public.events e WHERE e.id = p_event_id;
  IF NOT FOUND OR v_e.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'event_not_found' USING ERRCODE = 'P0002'; END IF;
  IF p_actor_id IS NOT NULL
     AND public.biz_brand_effective_rank(v_e.brand_id, p_actor_id) < public.biz_role_rank('event_manager') THEN
    RAISE EXCEPTION 'brand_form_forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_f FROM public.brand_forms WHERE id = p_form_id AND brand_id = v_e.brand_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'form_not_found' USING ERRCODE = 'P0002'; END IF;
  SELECT a.id INTO v_att FROM public.brand_form_attachments a
   WHERE a.event_id = p_event_id AND a.form_id = p_form_id AND a.detached_at IS NULL;
  IF v_att IS NULL THEN RAISE EXCEPTION 'form_not_on_event' USING ERRCODE = '42501'; END IF;
  IF v_f.status <> 'live' THEN
    RAISE EXCEPTION '%', CASE WHEN v_f.status = 'draft' THEN 'form_not_live' ELSE 'form_closed' END
      USING ERRCODE = '22023';
  END IF;
  WITH people AS (
    SELECT DISTINCT ON (g.g_person_key) g.*
      FROM public.brand_form_request_guests(p_form_id, p_event_id, p_subjects) g
     ORDER BY g.g_person_key, g.g_answered DESC, g.g_kind, g.g_id
  ), picked AS (
    SELECT p.* FROM people p WHERE p_audience = 'everyone' OR NOT p.g_answered
  )
  SELECT count(*)::integer,
         COALESCE(jsonb_agg(jsonb_build_object(
           'kind', p.g_kind, 'id', p.g_id, 'userId', p.g_user_id,
           'name', public.brand_form_short_name(p.g_name), 'personKey', p.g_person_key,
           'email', p.g_email, 'phone', p.g_phone, 'answered', p.g_answered,
           'route', to_jsonb(public.brand_form_request_route(p.g_phone, p.g_email, v_ch)),
           'smsOptedOut', p.g_phone IS NOT NULL AND 'sms' = ANY (v_ch)
                          AND NOT public.can_send(NULL, 'brand_form_request', 'sms', p.g_phone),
           'throttled', EXISTS (SELECT 1 FROM public.brand_form_request_sends s
                                 WHERE s.form_id = p_form_id AND s.person_key = p.g_person_key
                                   AND s.status IN ('queued', 'claimed', 'sent')
                                   AND s.created_at > now() - interval '24 hours'))
           ORDER BY p.g_kind, p.g_id), '[]'::jsonb)
    INTO v_n, v_rows FROM picked p;
  IF v_n > 500 THEN RAISE EXCEPTION 'audience_too_large' USING ERRCODE = '22023'; END IF;
  v_window := public.brand_form_text_window(v_e.timezone, now());
  RETURN jsonb_build_object('formId', p_form_id, 'eventId', p_event_id, 'attachmentId', v_att,
    'brandId', v_e.brand_id, 'eventTitle', v_e.title, 'formName', v_f.name,
    'brandName', (SELECT b.name FROM public.brands b WHERE b.id = v_e.brand_id),
    'eventStartsAt', (SELECT min(d.start_at) FROM public.event_dates d
                       WHERE d.event_id = p_event_id AND d.start_at > now() AND d.cancelled_at IS NULL),
    'textsToday', public.brand_form_request_texts_today(v_e.brand_id),
    'textCap', public.brand_form_request_text_cap(),
    'textsWaitUntil', CASE WHEN v_window > now() THEN v_window END,
    'recipients', v_rows);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.brand_form_request_enqueue(
  p_actor_id uuid, p_form_id uuid, p_event_id uuid, p_kind text, p_audience text,
  p_subjects jsonb, p_channels text[]
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_aud jsonb; v_brand uuid; v_tz text; v_new_texts integer;
  v_queued integer := 0; v_unreachable integer := 0; v_throttled integer := 0;
  v_answered integer := 0; v_waiting integer := 0;
BEGIN
  IF p_kind IS NULL OR p_kind NOT IN ('ask', 'remind') THEN
    RAISE EXCEPTION 'kind_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_actor_id IS NULL THEN RAISE EXCEPTION 'brand_form_forbidden' USING ERRCODE = '42501'; END IF;
  v_aud := public.brand_form_request_audience(p_actor_id, p_form_id, p_event_id,
             CASE WHEN p_kind = 'remind' THEN 'unanswered' ELSE p_audience END, p_subjects, p_channels);
  v_brand := (v_aud->>'brandId')::uuid;
  PERFORM pg_advisory_xact_lock(hashtextextended('brand_form_request:' || v_brand::text, 4514));
  v_aud := public.brand_form_request_audience(p_actor_id, p_form_id, p_event_id,
             CASE WHEN p_kind = 'remind' THEN 'unanswered' ELSE p_audience END, p_subjects, p_channels);
  SELECT e.timezone INTO v_tz FROM public.events e WHERE e.id = p_event_id;
  SELECT count(*) FILTER (WHERE throttled),
         count(*) FILTER (WHERE NOT throttled AND answered AND p_kind = 'remind'),
         count(*) FILTER (WHERE NOT throttled AND NOT (answered AND p_kind = 'remind') AND route[1] = 'sms')
    INTO v_throttled, v_answered, v_new_texts
    FROM (SELECT r->>'kind' AS kind, (r->>'id')::uuid AS id, r->>'personKey' AS person_key,
                 (r->>'answered')::boolean AS answered, (r->>'throttled')::boolean AS throttled,
                 ARRAY(SELECT jsonb_array_elements_text(r->'route')) AS route,
                 (r->>'smsOptedOut')::boolean AS opted_out
            FROM jsonb_array_elements(v_aud->'recipients') r) x;
  IF v_new_texts > 0
     AND public.brand_form_request_texts_today(v_brand) + v_new_texts > public.brand_form_request_text_cap() THEN
    RAISE EXCEPTION 'form_request_text_cap' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO public.brand_form_request_sends (
    form_id, attachment_id, event_id, brand_id, rsvp_id, rsvp_guest_id, order_id,
    person_key, kind, route, status, safe_reason, not_before, created_by, settled_at)
  SELECT p_form_id, (v_aud->>'attachmentId')::uuid, p_event_id, v_brand,
         CASE WHEN x.kind = 'rsvp' THEN x.id END,
         CASE WHEN x.kind = 'rsvp_guest' THEN x.id END,
         CASE WHEN x.kind = 'order' THEN x.id END,
         x.person_key, p_kind, x.route,
         CASE WHEN cardinality(x.route) = 0 THEN 'unreachable' ELSE 'queued' END,
         CASE WHEN cardinality(x.route) > 0 THEN NULL WHEN x.opted_out THEN 'sms_opted_out' ELSE 'no_contact' END,
         CASE WHEN x.route[1] = 'sms' THEN public.brand_form_text_window(v_tz, now()) ELSE now() END,
         p_actor_id, CASE WHEN cardinality(x.route) = 0 THEN now() END
    FROM (SELECT r->>'kind' AS kind, (r->>'id')::uuid AS id, r->>'personKey' AS person_key,
                 (r->>'answered')::boolean AS answered, (r->>'throttled')::boolean AS throttled,
                 ARRAY(SELECT jsonb_array_elements_text(r->'route')) AS route,
                 (r->>'smsOptedOut')::boolean AS opted_out
            FROM jsonb_array_elements(v_aud->'recipients') r) x
   WHERE NOT x.throttled AND NOT (x.answered AND p_kind = 'remind');
  SELECT count(*) FILTER (WHERE NOT throttled AND NOT (answered AND p_kind = 'remind') AND cardinality(route) > 0),
         count(*) FILTER (WHERE NOT throttled AND NOT (answered AND p_kind = 'remind') AND cardinality(route) = 0),
         count(*) FILTER (WHERE NOT throttled AND NOT (answered AND p_kind = 'remind') AND route[1] = 'sms'
                            AND public.brand_form_text_window(v_tz, now()) > now())
    INTO v_queued, v_unreachable, v_waiting
    FROM (SELECT (r->>'answered')::boolean AS answered, (r->>'throttled')::boolean AS throttled,
                 ARRAY(SELECT jsonb_array_elements_text(r->'route')) AS route
            FROM jsonb_array_elements(v_aud->'recipients') r) x;
  RETURN jsonb_build_object('queued', v_queued, 'unreachable', v_unreachable,
    'throttled', v_throttled, 'answered', v_answered, 'textsQueued', v_new_texts,
    'waitingForMorning', v_waiting);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.brand_form_request_claim_batch(
  p_limit integer DEFAULT 25, p_form_id uuid DEFAULT NULL, p_event_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_row record; v_out jsonb := '[]'::jsonb; v_link jsonb; v_contact jsonb;
  v_subject_kind text; v_subject_id uuid; v_window timestamptz; v_starts timestamptz;
BEGIN
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'limit_invalid' USING ERRCODE = '22023';
  END IF;
  UPDATE public.brand_form_request_sends
     SET status = CASE WHEN attempts >= 3 THEN 'failed' ELSE 'queued' END,
         safe_reason = CASE WHEN attempts >= 3 THEN 'claim_expired' ELSE 'claim_retried' END,
         settled_at = CASE WHEN attempts >= 3 THEN now() END, not_before = now()
   WHERE status = 'claimed' AND claimed_at < now() - interval '10 minutes';
  UPDATE public.brand_form_request_sends
     SET status = 'failed', safe_reason = 'expired', settled_at = now()
   WHERE status = 'queued' AND created_at < now() - interval '24 hours';
  UPDATE public.brand_form_auto_reminder_runs r
     SET outcome = CASE WHEN EXISTS (SELECT 1 FROM public.brand_form_request_sends s
                                     WHERE s.run_id = r.id AND s.status = 'sent')
                          OR NOT EXISTS (SELECT 1 FROM public.brand_form_request_sends s
                                         WHERE s.run_id = r.id AND s.status = 'failed')
                        THEN 'sent' ELSE 'failed' END,
         settled_at = now()
   WHERE r.outcome = 'sending'
     AND NOT EXISTS (SELECT 1 FROM public.brand_form_request_sends s
                      WHERE s.run_id = r.id AND s.status IN ('queued', 'claimed'));

  FOR v_row IN
    SELECT s.id, s.form_id, s.event_id, s.rsvp_id, s.rsvp_guest_id, s.order_id,
           s.kind, s.route, s.created_by, s.starts_at,
           f.status AS form_status, e.timezone AS tz, e.title AS event_title, b.name AS brand_name
      FROM public.brand_form_request_sends s
      JOIN public.brand_forms f ON f.id = s.form_id
      JOIN public.events e ON e.id = s.event_id
      JOIN public.brands b ON b.id = s.brand_id
     WHERE s.status = 'queued' AND s.not_before <= now()
       AND (p_form_id IS NULL OR s.form_id = p_form_id)
       AND (p_event_id IS NULL OR s.event_id = p_event_id)
     ORDER BY s.not_before, s.created_at
     LIMIT p_limit FOR UPDATE OF s SKIP LOCKED
  LOOP
    v_subject_kind := CASE WHEN v_row.rsvp_id IS NOT NULL THEN 'rsvp'
                           WHEN v_row.rsvp_guest_id IS NOT NULL THEN 'rsvp_guest'
                           ELSE 'order' END;
    v_subject_id := COALESCE(v_row.rsvp_id, v_row.rsvp_guest_id, v_row.order_id);
    PERFORM pg_advisory_xact_lock(
      public.brand_form_person_lock_key(v_row.form_id, v_subject_kind, v_subject_id));
    IF v_row.form_status <> 'live' THEN
      UPDATE public.brand_form_request_sends
         SET status = 'skipped', safe_reason = 'form_closed', settled_at = now() WHERE id = v_row.id;
      CONTINUE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.event_rsvps x WHERE x.id = v_row.rsvp_id
                    AND x.event_id = v_row.event_id AND x.rsvp_status = 'going')
       AND NOT EXISTS (SELECT 1 FROM public.event_rsvp_guests g
                        JOIN public.event_rsvps x ON x.id = g.rsvp_id
                       WHERE g.id = v_row.rsvp_guest_id AND x.event_id = v_row.event_id
                         AND x.rsvp_status = 'going' AND g.claimed_at IS NOT NULL
                         AND g.matched_user_id IS NOT NULL)
       AND NOT EXISTS (SELECT 1 FROM public.orders o WHERE o.id = v_row.order_id
                        AND o.event_id = v_row.event_id
                        AND o.payment_status IN ('paid', 'partial_refund')) THEN
      UPDATE public.brand_form_request_sends
         SET status = 'skipped', safe_reason = 'not_a_guest', settled_at = now() WHERE id = v_row.id;
      CONTINUE;
    END IF;
    v_starts := COALESCE(v_row.starts_at,
      (SELECT max(d.at) FROM public.brand_form_guest_dates(
        v_subject_kind, v_subject_id, v_row.event_id) d(at)));
    IF v_starts IS NOT NULL AND v_starts <= now() THEN
      UPDATE public.brand_form_request_sends
         SET status = 'skipped', safe_reason = 'event_started', settled_at = now() WHERE id = v_row.id;
      CONTINUE;
    END IF;
    IF v_row.kind IN ('remind', 'auto')
       AND (public.brand_form_person_response(
         v_row.form_id, v_subject_kind, v_subject_id, v_row.event_id)).id IS NOT NULL THEN
      UPDATE public.brand_form_request_sends
         SET status = 'skipped', safe_reason = 'answered', settled_at = now() WHERE id = v_row.id;
      CONTINUE;
    END IF;
    IF v_row.route[1] = 'sms' THEN
      v_window := public.brand_form_text_window(v_row.tz, now());
      IF v_window > now() THEN
        UPDATE public.brand_form_request_sends SET not_before = v_window WHERE id = v_row.id;
        CONTINUE;
      END IF;
    END IF;
    v_contact := public.brand_form_subject_contact(v_subject_kind, v_subject_id);
    v_link := public.brand_form_link_issue(v_row.form_id, v_row.event_id,
      jsonb_build_object('kind', v_subject_kind, 'id', v_subject_id), v_row.created_by);
    UPDATE public.brand_form_request_sends
       SET status = 'claimed', claimed_at = now(), attempts = attempts + 1,
           link_id = (v_link->>'linkId')::uuid
     WHERE id = v_row.id;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'sendId', v_row.id, 'token', v_link->>'token', 'formId', v_row.form_id,
      'eventId', v_row.event_id, 'kind', v_row.kind,
      'subjectKind', v_subject_kind, 'subjectId', v_subject_id,
      'userId', COALESCE(
        (SELECT x.user_id FROM public.event_rsvps x WHERE x.id = v_row.rsvp_id),
        (SELECT g.matched_user_id FROM public.event_rsvp_guests g
          WHERE g.id = v_row.rsvp_guest_id AND g.claimed_at IS NOT NULL),
        (SELECT o.buyer_user_id FROM public.orders o WHERE o.id = v_row.order_id)),
      'route', to_jsonb(v_row.route), 'phone', v_contact->>'phone', 'email', v_contact->>'email',
      'brandName', v_row.brand_name, 'eventTitle', v_row.event_title, 'eventTimezone', v_row.tz,
      'startsAt', COALESCE(v_row.starts_at,
        (SELECT min(d.start_at) FROM public.event_dates d
          WHERE d.event_id = v_row.event_id AND d.start_at > now() AND d.cancelled_at IS NULL))));
  END LOOP;
  RETURN v_out;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.biz_brand_form_request_log(
  p_form_id uuid, p_event_id uuid, p_subject jsonb DEFAULT NULL, p_limit integer DEFAULT 100
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE v_brand uuid; v_kind text; v_id uuid;
BEGIN
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'limit_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_subject IS NOT NULL THEN
    IF jsonb_typeof(p_subject) <> 'object'
       OR COALESCE(p_subject->>'kind', '') NOT IN ('rsvp', 'rsvp_guest', 'order')
       OR COALESCE(p_subject->>'id', '') !~ '^[0-9a-fA-F-]{36}$' THEN
      RAISE EXCEPTION 'subject_invalid' USING ERRCODE = '22023';
    END IF;
    v_kind := p_subject->>'kind'; v_id := (p_subject->>'id')::uuid;
  END IF;
  v_brand := COALESCE((SELECT e.brand_id FROM public.events e WHERE e.id = p_event_id),
                      (SELECT f.brand_id FROM public.brand_forms f WHERE f.id = p_form_id));
  PERFORM public.brand_form_require_rank(v_brand, 'event_manager');
  IF NOT EXISTS (SELECT 1 FROM public.brand_forms f WHERE f.id = p_form_id AND f.brand_id = v_brand)
     OR NOT EXISTS (SELECT 1 FROM public.events e WHERE e.id = p_event_id AND e.brand_id = v_brand) THEN
    RAISE EXCEPTION 'form_not_found' USING ERRCODE = 'P0002';
  END IF;
  RETURN jsonb_build_object(
    'sends', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', s.id, 'kind', s.kind,
               'subjectKind', CASE WHEN s.rsvp_id IS NOT NULL THEN 'rsvp'
                                   WHEN s.rsvp_guest_id IS NOT NULL THEN 'rsvp_guest' ELSE 'order' END,
               'subjectId', COALESCE(s.rsvp_id, s.rsvp_guest_id, s.order_id),
               'name', public.brand_form_short_name(COALESCE(x.guest_name, g.name, o.buyer_name)),
               'channel', COALESCE(s.channel, s.route[1]), 'status', s.status, 'reason', s.safe_reason,
               'notBefore', s.not_before, 'createdAt', s.created_at, 'settledAt', s.settled_at)
             ORDER BY s.created_at DESC, s.id)
        FROM (SELECT * FROM public.brand_form_request_sends s0
               WHERE s0.form_id = p_form_id AND s0.event_id = p_event_id
                 AND (v_kind IS NULL
                   OR (v_kind = 'rsvp' AND s0.rsvp_id = v_id)
                   OR (v_kind = 'rsvp_guest' AND s0.rsvp_guest_id = v_id)
                   OR (v_kind = 'order' AND s0.order_id = v_id))
               ORDER BY s0.created_at DESC, s0.id LIMIT p_limit) s
        LEFT JOIN public.event_rsvps x ON x.id = s.rsvp_id
        LEFT JOIN public.event_rsvp_guests g ON g.id = s.rsvp_guest_id
        LEFT JOIN public.orders o ON o.id = s.order_id), '[]'::jsonb),
    'counts', (SELECT jsonb_build_object(
                 'queued', count(*) FILTER (WHERE s.status IN ('queued', 'claimed')),
                 'sent', count(*) FILTER (WHERE s.status = 'sent'),
                 'failed', count(*) FILTER (WHERE s.status = 'failed'),
                 'unreachable', count(*) FILTER (WHERE s.status = 'unreachable'),
                 'skipped', count(*) FILTER (WHERE s.status = 'skipped'))
                 FROM public.brand_form_request_sends s
                WHERE s.form_id = p_form_id AND s.event_id = p_event_id
                  AND (v_kind IS NULL
                    OR (v_kind = 'rsvp' AND s.rsvp_id = v_id)
                    OR (v_kind = 'rsvp_guest' AND s.rsvp_guest_id = v_id)
                    OR (v_kind = 'order' AND s.order_id = v_id))),
    'runs', CASE WHEN v_kind IS NOT NULL THEN '[]'::jsonb ELSE COALESCE((
      SELECT jsonb_agg(jsonb_build_object('startsAt', r.starts_at, 'outcome', r.outcome,
               'createdAt', r.created_at, 'settledAt', r.settled_at) ORDER BY r.starts_at DESC)
        FROM public.brand_form_auto_reminder_runs r
       WHERE r.form_id = p_form_id AND r.event_id = p_event_id), '[]'::jsonb) END);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.brand_form_auto_reminders_due() RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_a record; v_d record; v_run uuid; v_ch text[]; v_n integer; v_left integer;
  v_runs integer := 0; v_queued integer := 0; v_held integer := 0;
BEGIN
  FOR v_a IN
    SELECT a.id AS attachment_id, a.form_id, a.event_id, a.brand_id, a.auto_remind_channels,
           COALESCE(a.created_by, b.account_id) AS host_id,
           f.status AS form_status, f.name AS form_name, e.title AS event_title, e.timezone AS tz
      FROM public.brand_form_attachments a
      JOIN public.brand_forms f ON f.id = a.form_id
      JOIN public.events e ON e.id = a.event_id
      JOIN public.brands b ON b.id = a.brand_id
     WHERE a.detached_at IS NULL AND a.auto_remind
       AND e.deleted_at IS NULL AND e.status IN ('scheduled', 'live') AND f.status <> 'draft'
       AND EXISTS (SELECT 1 FROM public.event_dates d WHERE d.event_id = a.event_id
                    AND d.start_at > now() + interval '46 hours' AND d.start_at <= now() + interval '48 hours'
                   UNION ALL
                   SELECT 1 FROM public.orders o WHERE o.event_id = a.event_id
                    AND o.booked_start_at > now() + interval '46 hours'
                    AND o.booked_start_at <= now() + interval '48 hours')
     ORDER BY a.id FOR UPDATE OF a SKIP LOCKED
  LOOP
    v_ch := ARRAY(SELECT c FROM unnest(v_a.auto_remind_channels) c WHERE c IN ('sms', 'email'));
    FOR v_d IN
      SELECT DISTINCT d.at AS starts_at
        FROM public.brand_form_request_guests(v_a.form_id, v_a.event_id, NULL) g
        CROSS JOIN LATERAL public.brand_form_guest_dates(g.g_kind, g.g_id, v_a.event_id) d(at)
       WHERE d.at > now() + interval '46 hours' AND d.at <= now() + interval '48 hours'
       ORDER BY 1
    LOOP
      IF v_a.form_status <> 'live' THEN
        INSERT INTO public.brand_form_auto_reminder_runs (
          attachment_id, form_id, event_id, starts_at, outcome, settled_at)
        VALUES (v_a.attachment_id, v_a.form_id, v_a.event_id, v_d.starts_at, 'held_form_closed', now())
        ON CONFLICT (attachment_id, starts_at) DO NOTHING;
        IF FOUND THEN
          v_held := v_held + 1;
          IF v_a.host_id IS NOT NULL THEN
            INSERT INTO public.notification_outbox (
              category_key, user_id, brand_id, country_code, payload, idempotency_key)
            VALUES ('business.brand_form_reminder_held', v_a.host_id, v_a.brand_id, NULL,
                    jsonb_build_object('form_id', v_a.form_id, 'event_id', v_a.event_id,
                      'brand_id', v_a.brand_id, 'form_name', v_a.form_name,
                      'event_title', v_a.event_title,
                      'deep_link', 'mingla-business://marketing/forms/' || v_a.form_id::text || '/responses'),
                    'brand_form_reminder_held:' || v_a.attachment_id::text || ':'
                      || extract(epoch FROM v_d.starts_at)::bigint::text)
            ON CONFLICT (idempotency_key) DO NOTHING;
          END IF;
        END IF;
        CONTINUE;
      END IF;
      INSERT INTO public.brand_form_auto_reminder_runs (
        attachment_id, form_id, event_id, starts_at, outcome)
      VALUES (v_a.attachment_id, v_a.form_id, v_a.event_id, v_d.starts_at, 'sending')
      ON CONFLICT (attachment_id, starts_at) DO NOTHING RETURNING id INTO v_run;
      IF v_run IS NULL THEN
        SELECT r.id INTO v_run FROM public.brand_form_auto_reminder_runs r
         WHERE r.attachment_id = v_a.attachment_id AND r.starts_at = v_d.starts_at
           AND r.outcome <> 'held_form_closed';
        IF v_run IS NULL THEN CONTINUE; END IF;
      ELSE
        v_runs := v_runs + 1;
      END IF;
      PERFORM pg_advisory_xact_lock(
        hashtextextended('brand_form_request:' || v_a.brand_id::text, 4514));
      v_left := GREATEST(
        public.brand_form_request_text_cap() - public.brand_form_request_texts_today(v_a.brand_id), 0);
      WITH due AS (
        SELECT DISTINCT ON (g.g_person_key) g.*
          FROM public.brand_form_request_guests(v_a.form_id, v_a.event_id, NULL) g
         WHERE EXISTS (SELECT 1 FROM public.brand_form_guest_dates(g.g_kind, g.g_id, v_a.event_id) d(at)
                        WHERE d.at = v_d.starts_at)
         ORDER BY g.g_person_key, g.g_answered DESC, g.g_kind, g.g_id
      ), ins AS (
        INSERT INTO public.brand_form_request_sends (
          form_id, attachment_id, event_id, brand_id, rsvp_id, rsvp_guest_id, order_id,
          run_id, person_key, kind, route, status, safe_reason, starts_at, not_before, settled_at)
        SELECT v_a.form_id, v_a.attachment_id, v_a.event_id, v_a.brand_id,
               CASE WHEN y.g_kind = 'rsvp' THEN y.g_id END,
               CASE WHEN y.g_kind = 'rsvp_guest' THEN y.g_id END,
               CASE WHEN y.g_kind = 'order' THEN y.g_id END,
               v_run, y.g_person_key, 'auto',
               CASE WHEN cardinality(y.sent_route) = 0 THEN y.route ELSE y.sent_route END,
               CASE WHEN cardinality(y.route) = 0 THEN 'unreachable'
                    WHEN cardinality(y.sent_route) = 0 THEN 'skipped' ELSE 'queued' END,
               CASE WHEN cardinality(y.route) = 0 THEN 'no_contact' WHEN y.capped THEN 'text_cap' END,
               v_d.starts_at,
               CASE WHEN y.sent_route[1] = 'sms' THEN public.brand_form_text_window(v_a.tz, now()) ELSE now() END,
               CASE WHEN cardinality(y.sent_route) = 0 THEN now() END
          FROM (SELECT z.*, z.route[1] = 'sms' AND z.text_n > v_left AS capped,
                       CASE WHEN z.route[1] = 'sms' AND z.text_n > v_left THEN array_remove(z.route, 'sms')
                            ELSE z.route END AS sent_route
                  FROM (SELECT x.*, row_number() OVER (
                          PARTITION BY x.route[1] = 'sms' ORDER BY x.g_kind, x.g_id) AS text_n
                          FROM (SELECT due.*,
                                 public.brand_form_request_route(due.g_phone, due.g_email, v_ch) AS route
                                  FROM due) x
                         WHERE NOT x.g_answered
                           AND NOT EXISTS (SELECT 1 FROM public.brand_form_request_sends s
                            WHERE s.form_id = v_a.form_id AND s.person_key = x.g_person_key
                              AND s.status IN ('queued', 'claimed', 'sent')
                              AND s.created_at > now() - interval '24 hours')
                           AND NOT EXISTS (SELECT 1 FROM public.brand_form_request_sends s
                            WHERE s.run_id = v_run AND s.person_key = x.g_person_key)) z) y
        ON CONFLICT (run_id, person_key) WHERE run_id IS NOT NULL DO NOTHING
        RETURNING 1
      )
      SELECT count(*)::integer INTO v_n FROM ins;
      v_queued := v_queued + v_n;
      IF v_n > 0 THEN
        UPDATE public.brand_form_auto_reminder_runs SET outcome = 'sending', settled_at = NULL
         WHERE id = v_run AND outcome IN ('sent', 'failed');
      END IF;
      v_run := NULL;
    END LOOP;
  END LOOP;
  RETURN jsonb_build_object('runs', v_runs, 'queued', v_queued, 'held', v_held);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.brand_form_unanswered_count(
  p_form_id uuid, p_event_id uuid
) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
  SELECT
    (SELECT count(*) FROM public.event_rsvps x
      WHERE x.event_id = p_event_id AND x.rsvp_status = 'going'
        AND (public.brand_form_find_response(p_form_id, 'rsvp', x.id)).id IS NULL)::integer
  + (SELECT count(*) FROM public.event_rsvp_guests g
       JOIN public.event_rsvps x ON x.id = g.rsvp_id
      WHERE x.event_id = p_event_id AND x.rsvp_status = 'going'
        AND g.claimed_at IS NOT NULL AND g.matched_user_id IS NOT NULL
        AND (public.brand_form_find_response(p_form_id, 'rsvp_guest', g.id)).id IS NULL)::integer
  + (SELECT count(*) FROM public.orders o
      WHERE o.event_id = p_event_id AND o.payment_status IN ('paid', 'partial_refund')
        AND (public.brand_form_find_response(p_form_id, 'order', o.id)).id IS NULL)::integer;
$fn$;

ALTER TABLE public.brand_form_door_reads
  DROP CONSTRAINT brand_form_door_reads_subject_kind_check,
  ADD CONSTRAINT brand_form_door_reads_subject_kind_check
    CHECK (subject_kind IN ('rsvp', 'rsvp_guest', 'order'));

CREATE OR REPLACE FUNCTION public.brand_form_door_answers(
  p_actor_id uuid, p_event_id uuid, p_subject jsonb
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_kind text := p_subject->>'kind'; v_sid uuid; v_ticket uuid; v_a record;
  v_resp public.brand_form_responses; v_answered jsonb; v_live jsonb; v_items jsonb;
  v_added boolean := false; v_from text; v_rank integer;
  v_uuid constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
BEGIN
  v_rank := public.brand_form_door_authority(p_actor_id, p_event_id);
  IF COALESCE(v_kind, '') NOT IN ('rsvp', 'rsvp_guest', 'order')
     OR COALESCE(p_subject->>'id', '') !~ v_uuid
     OR (p_subject ? 'ticketId' AND jsonb_typeof(p_subject->'ticketId') <> 'null'
         AND (v_kind <> 'order' OR COALESCE(p_subject->>'ticketId', '') !~ v_uuid)) THEN
    RAISE EXCEPTION 'subject_invalid' USING ERRCODE = '22023';
  END IF;
  v_sid := (p_subject->>'id')::uuid;
  IF public.brand_form_subject_event(v_kind, v_sid) IS DISTINCT FROM p_event_id
     OR (v_kind = 'rsvp_guest' AND NOT EXISTS (
       SELECT 1 FROM public.event_rsvp_guests g
        WHERE g.id = v_sid AND g.claimed_at IS NOT NULL AND g.matched_user_id IS NOT NULL)) THEN
    RAISE EXCEPTION 'subject_other_event' USING ERRCODE = '42501';
  END IF;
  IF v_kind = 'order' AND (p_subject->>'ticketId') ~ v_uuid THEN
    v_ticket := (p_subject->>'ticketId')::uuid;
    IF NOT EXISTS (SELECT 1 FROM public.tickets t
                    WHERE t.id = v_ticket AND t.order_id = v_sid AND t.event_id = p_event_id) THEN
      RAISE EXCEPTION 'subject_other_event' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF public.brand_forms_switched_off() THEN RETURN NULL; END IF;
  SELECT * INTO v_a FROM public.brand_form_active_for_event(p_event_id);
  IF NOT FOUND THEN RETURN NULL; END IF;
  v_resp := public.brand_form_find_response(v_a.form_id, v_kind, v_sid);
  IF v_ticket IS NOT NULL AND EXISTS (SELECT 1 FROM public.tickets t
       WHERE t.id = v_ticket AND (t.transferred_at IS NOT NULL OR t.status = 'transferred')) THEN
    v_resp := NULL;
  END IF;
  IF v_resp.id IS NULL THEN
    IF v_kind = 'order' THEN
      SELECT o.source IN ('door_sale', 'manual_import') OR COALESCE(o.is_door_sale, false)
        INTO v_added FROM public.orders o WHERE o.id = v_sid;
    END IF;
    IF v_a.form_status = 'live' AND v_a.mode IN ('required_step', 'after_purchase')
       AND NOT COALESCE(v_added, false) THEN
      RETURN jsonb_build_object('state', 'not_answered', 'formName', v_a.form_name);
    END IF;
    RETURN NULL;
  END IF;
  SELECT v.definition INTO v_answered FROM public.brand_form_versions v WHERE v.id = v_resp.version_id;
  SELECT v.definition INTO v_live FROM public.brand_form_versions v WHERE v.id = v_a.live_version_id;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'label', public.brand_form_cut(
             COALESCE(NULLIF(btrim(q.value->>'door_label'), ''), q.value->>'label'), 40),
           'value', public.brand_form_cut(
             public.brand_form_answer_text(q.value, v_resp.answers->(q.value->>'id')), 60))
           ORDER BY (q.value->>'position')::integer), '[]'::jsonb)
    INTO v_items FROM jsonb_array_elements(v_answered->'questions') q
   WHERE COALESCE((q.value->>'show_at_door')::boolean, false)
     AND EXISTS (SELECT 1 FROM jsonb_array_elements(v_live->'questions') l
                  WHERE l.value->>'id' = q.value->>'id'
                    AND COALESCE((l.value->>'show_at_door')::boolean, false))
     AND public.brand_form_answer_text(q.value, v_resp.answers->(q.value->>'id')) IS NOT NULL;
  IF jsonb_array_length(v_items) = 0 THEN RETURN NULL; END IF;
  IF v_ticket IS NOT NULL THEN v_from := public.brand_form_door_order_header(v_sid, v_ticket); END IF;
  RETURN jsonb_strip_nulls(jsonb_build_object(
    'state', 'answered', 'formName', v_a.form_name, 'fromOrderOf', v_from,
    'fullAnswers', v_a.door_full_answers OR v_rank >= public.biz_role_rank('event_manager'),
    'items', (SELECT jsonb_agg(x.value) FROM jsonb_array_elements(v_items) WITH ORDINALITY x
               WHERE x.ordinality <= 3)));
END;
$fn$;

CREATE OR REPLACE FUNCTION public.brand_form_door_full_answers(
  p_actor_id uuid, p_event_id uuid, p_subject jsonb, p_via text DEFAULT 'scan'
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_kind text := p_subject->>'kind'; v_sid uuid; v_rank integer; v_a record;
  v_resp public.brand_form_responses; v_def jsonb; v_questions jsonb; v_result text;
  v_out jsonb; v_current boolean; v_ticket uuid; v_from text;
  v_uuid constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
BEGIN
  v_rank := public.brand_form_door_authority(p_actor_id, p_event_id);
  IF COALESCE(v_kind, '') NOT IN ('rsvp', 'rsvp_guest', 'order')
     OR COALESCE(p_subject->>'id', '') !~ v_uuid OR COALESCE(p_via, '') NOT IN ('scan', 'search')
     OR (p_subject ? 'ticketId' AND jsonb_typeof(p_subject->'ticketId') <> 'null'
         AND (v_kind <> 'order' OR COALESCE(p_subject->>'ticketId', '') !~ v_uuid)) THEN
    RAISE EXCEPTION 'subject_invalid' USING ERRCODE = '22023';
  END IF;
  v_sid := (p_subject->>'id')::uuid;
  IF public.brand_form_subject_event(v_kind, v_sid) IS DISTINCT FROM p_event_id THEN
    RAISE EXCEPTION 'subject_other_event' USING ERRCODE = '42501';
  END IF;
  IF v_kind = 'order' AND (p_subject->>'ticketId') ~ v_uuid THEN
    v_ticket := (p_subject->>'ticketId')::uuid;
    IF NOT EXISTS (SELECT 1 FROM public.tickets t
                    WHERE t.id = v_ticket AND t.order_id = v_sid AND t.event_id = p_event_id) THEN
      RAISE EXCEPTION 'subject_other_event' USING ERRCODE = '42501';
    END IF;
  END IF;
  v_current := CASE v_kind
    WHEN 'rsvp' THEN EXISTS (SELECT 1 FROM public.event_rsvps r WHERE r.id = v_sid
                              AND r.rsvp_status = 'going' AND r.approval_status = 'approved')
    WHEN 'rsvp_guest' THEN EXISTS (
      SELECT 1 FROM public.event_rsvp_guests g JOIN public.event_rsvps r ON r.id = g.rsvp_id
       WHERE g.id = v_sid AND g.claimed_at IS NOT NULL AND g.matched_user_id IS NOT NULL
         AND r.rsvp_status = 'going' AND r.approval_status = 'approved')
    ELSE EXISTS (SELECT 1 FROM public.orders o WHERE o.id = v_sid
                  AND o.payment_status IN ('paid', 'partial_refund')) END;
  IF NOT v_current THEN RAISE EXCEPTION 'subject_not_current' USING ERRCODE = '42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('brand_form_door_reads:' || p_actor_id::text, 0));
  IF (SELECT count(*) FROM public.brand_form_door_reads d
       WHERE d.actor_id = p_actor_id AND d.created_at > now() - interval '10 minutes') >= 60 THEN
    INSERT INTO public.brand_form_door_reads (
      actor_id, event_id, subject_kind, subject_id, via, result)
    VALUES (p_actor_id, p_event_id, v_kind, v_sid, p_via, 'rate_limited');
    RETURN jsonb_build_object('state', 'rate_limited');
  END IF;
  SELECT * INTO v_a FROM public.brand_form_active_for_event(p_event_id);
  IF NOT FOUND OR public.brand_forms_switched_off() THEN
    v_result := 'no_form'; v_out := jsonb_build_object('state', 'no_form');
  ELSE
    v_resp := public.brand_form_find_response(v_a.form_id, v_kind, v_sid);
    IF v_ticket IS NOT NULL AND EXISTS (SELECT 1 FROM public.tickets t
         WHERE t.id = v_ticket AND (t.transferred_at IS NOT NULL OR t.status = 'transferred')) THEN
      v_resp := NULL;
    END IF;
    IF v_ticket IS NOT NULL THEN v_from := public.brand_form_door_order_header(v_sid, v_ticket); END IF;
    IF v_resp.id IS NULL THEN
      v_result := 'not_answered';
      v_out := jsonb_build_object('state', 'not_answered', 'formName', v_a.form_name,
                 'brand', public.brand_form_brand_header(v_a.brand_id));
    ELSIF NOT v_a.door_full_answers AND v_rank < public.biz_role_rank('event_manager') THEN
      v_result := 'line_only';
      v_out := jsonb_build_object('state', 'line_only', 'formName', v_a.form_name,
                 'line', public.brand_form_door_answers(p_actor_id, p_event_id, p_subject));
    ELSE
      v_result := 'full';
      SELECT v.definition INTO v_def FROM public.brand_form_versions v WHERE v.id = v_resp.version_id;
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'id', q.value->>'id', 'label', q.value->>'label', 'type', q.value->>'type',
               'value', public.brand_form_answer_text(q.value, v_resp.answers->(q.value->>'id')))
               ORDER BY (q.value->>'position')::integer), '[]'::jsonb)
        INTO v_questions FROM jsonb_array_elements(v_def->'questions') q
       WHERE q.value->>'type' <> 'file_upload';
      v_out := jsonb_strip_nulls(jsonb_build_object(
        'state', 'answered', 'formName', v_a.form_name,
        'brand', public.brand_form_brand_header(v_a.brand_id), 'answeredAt', v_resp.updated_at,
        'isCurrentVersion', v_resp.version_id = v_a.live_version_id, 'fromOrderOf', v_from,
        'questions', v_questions,
        'definition', jsonb_set(v_def, '{questions}', COALESCE((SELECT jsonb_agg(
          q.value ORDER BY (q.value->>'position')::integer)
          FROM jsonb_array_elements(v_def->'questions') q
          WHERE q.value->>'type' <> 'file_upload'), '[]'::jsonb)),
        'answers', COALESCE((SELECT jsonb_object_agg(a.key, a.value)
          FROM jsonb_each(v_resp.answers) a WHERE EXISTS (
            SELECT 1 FROM jsonb_array_elements(v_def->'questions') q
             WHERE q.value->>'id' = a.key AND q.value->>'type' <> 'file_upload')), '{}'::jsonb)));
    END IF;
  END IF;
  INSERT INTO public.brand_form_door_reads (
    actor_id, event_id, form_id, subject_kind, subject_id, via, result)
  VALUES (p_actor_id, p_event_id, v_a.form_id, v_kind, v_sid, p_via, v_result);
  RETURN v_out;
END;
$fn$;

REVOKE ALL ON FUNCTION public.submit_event_rsvp_with_form(
  uuid,uuid,text,text,text,text,integer,jsonb,text,text,boolean,jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_event_rsvp_with_form(
  uuid,uuid,text,text,text,text,integer,jsonb,text,text,boolean,jsonb
) TO service_role;

REVOKE ALL ON FUNCTION public.brand_form_subject_event(text,uuid),
  public.brand_form_user_response(uuid,uuid),
  public.brand_form_find_response(uuid,text,uuid),
  public.brand_form_person_response(uuid,text,uuid,uuid),
  public.brand_form_person_lock_key(uuid,text,uuid),
  public.brand_form_subject_contact(text,uuid)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brand_form_subject_event(text,uuid),
  public.brand_form_user_response(uuid,uuid),
  public.brand_form_find_response(uuid,text,uuid),
  public.brand_form_person_response(uuid,text,uuid,uuid),
  public.brand_form_person_lock_key(uuid,text,uuid),
  public.brand_form_subject_contact(text,uuid)
TO service_role;
