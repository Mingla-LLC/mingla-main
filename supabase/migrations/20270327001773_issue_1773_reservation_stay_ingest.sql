-- Issue #1773: extend the sole #1770 Brand People ingest rail to venue
-- reservations and historically confirmed Stay reservation groups.
BEGIN;

DO $preflight$
DECLARE v_definition text;
BEGIN
  IF to_regprocedure('public.biz_resolve_brand_person_source(uuid,uuid,text,uuid,uuid,uuid,text,text,timestamptz)') IS NULL
     OR to_regprocedure('public.biz_resolve_brand_person_source_derived(text,uuid)') IS NULL
     OR to_regprocedure('public.issue_1770_enqueue_source()') IS NULL
     OR to_regclass('public.reservations') IS NULL
     OR to_regclass('public.stay_reservation_groups') IS NULL
     OR to_regclass('public.stay_reservation_events') IS NULL THEN
    RAISE EXCEPTION 'issue_1773_required_owner_missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='issue_1770_event_rsvp_ingest' AND NOT tgisinternal)
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='issue_1770_rsvp_plus_one_ingest' AND NOT tgisinternal)
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='issue_1770_order_ingest' AND NOT tgisinternal)
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='issue_1770_ticket_ingest' AND NOT tgisinternal)
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='reservations' AND column_name='guest_phone_country_iso')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='brand_person_contact_method_sources' AND column_name='phone_country_iso') THEN
    RAISE EXCEPTION 'issue_1773_trigger_or_phone_authority_drift';
  END IF;
  SELECT pg_get_functiondef('public.issue_1770_enqueue_source()'::regprocedure) INTO v_definition;
  IF position('EXCEPTION WHEN OTHERS' IN v_definition)=0
     OR position('ON CONFLICT DO NOTHING' IN v_definition)=0
     OR position('phoneCountryIso' IN v_definition)=0 THEN
    RAISE EXCEPTION 'issue_1773_enqueue_owner_drift';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace
    WHERE n.nspname='public' AND r.relname='brand_person_ingest_outbox'
      AND c.contype='c' AND pg_get_constraintdef(c.oid,true) LIKE '%event_rsvp%rsvp_plus_one%order%ticket_holder%'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace
    WHERE n.nspname='public' AND r.relname='brand_person_source_links'
      AND c.contype='c' AND pg_get_constraintdef(c.oid,true) LIKE '%reservation%manual%import%'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace
    WHERE n.nspname='public' AND r.relname='brand_person_identity_conflicts'
      AND c.contype='c' AND pg_get_constraintdef(c.oid,true) LIKE '%reservation%manual%import%'
  ) THEN
    RAISE EXCEPTION 'issue_1773_source_kind_constraint_drift';
  END IF;
END;
$preflight$;

DO $constraints$
DECLARE v_constraint text;
BEGIN
  SELECT c.conname INTO STRICT v_constraint
  FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace
  WHERE n.nspname='public' AND r.relname='brand_person_ingest_outbox'
    AND c.contype='c' AND pg_get_constraintdef(c.oid,true) LIKE '%source_kind%event_rsvp%';
  EXECUTE format('ALTER TABLE public.brand_person_ingest_outbox DROP CONSTRAINT %I',v_constraint);
  EXECUTE format('ALTER TABLE public.brand_person_ingest_outbox ADD CONSTRAINT %I CHECK (source_kind IN (''event_rsvp'',''rsvp_plus_one'',''order'',''ticket_holder'',''reservation'',''stay_reservation''))',v_constraint);

  SELECT c.conname INTO STRICT v_constraint
  FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace
  WHERE n.nspname='public' AND r.relname='brand_person_source_links'
    AND c.contype='c' AND pg_get_constraintdef(c.oid,true) LIKE '%source_kind%reservation%';
  EXECUTE format('ALTER TABLE public.brand_person_source_links DROP CONSTRAINT %I',v_constraint);
  EXECUTE format('ALTER TABLE public.brand_person_source_links ADD CONSTRAINT %I CHECK (source_kind IN (''event_rsvp'',''rsvp_plus_one'',''order'',''ticket_holder'',''reservation'',''stay_reservation'',''manual'',''import''))',v_constraint);

  SELECT c.conname INTO STRICT v_constraint
  FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace
  WHERE n.nspname='public' AND r.relname='brand_person_identity_conflicts'
    AND c.contype='c' AND pg_get_constraintdef(c.oid,true) LIKE '%source_kind%reservation%';
  EXECUTE format('ALTER TABLE public.brand_person_identity_conflicts DROP CONSTRAINT %I',v_constraint);
  EXECUTE format('ALTER TABLE public.brand_person_identity_conflicts ADD CONSTRAINT %I CHECK (source_kind IN (''event_rsvp'',''rsvp_plus_one'',''order'',''ticket_holder'',''reservation'',''stay_reservation'',''manual'',''import''))',v_constraint);
END;
$constraints$;

CREATE OR REPLACE FUNCTION public.biz_resolve_brand_person_source(
  p_brand_id uuid,p_event_id uuid,p_source_kind text,p_source_id uuid,
  p_authenticated_user_id uuid DEFAULT NULL,p_validated_invite_id uuid DEFAULT NULL,
  p_normalized_email text DEFAULT NULL,p_normalized_phone_e164 text DEFAULT NULL,
  p_source_occurred_at timestamptz DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
AS $function$
DECLARE
  v_brand uuid; v_event uuid; v_user uuid; v_name text; v_email text; v_phone text; v_phone_country_iso text;
  v_raw_phone text; v_strict_phone text; v_occurred timestamptz; v_existing uuid; v_prior_person uuid;
  v_person uuid; v_link uuid; v_conflict uuid; v_candidates uuid[]; v_candidate uuid;
  v_candidate_name text; v_norm_name text; v_link_method text:='normalized_address'; v_provenance text;
BEGIN
  IF p_source_kind NOT IN ('event_rsvp','rsvp_plus_one','order','ticket_holder','reservation','stay_reservation') THEN
    RETURN jsonb_build_object('personId',NULL,'sourceLinkId',NULL,'linkOutcome','unlinked','conflictId',NULL);
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_source_kind||':'||p_source_id::text,0));
  SELECT id,brand_person_id INTO v_link,v_prior_person FROM public.brand_person_source_links
  WHERE source_kind=p_source_kind AND source_id=p_source_id AND detached_at IS NULL;

  IF p_source_kind='event_rsvp' THEN
    SELECT e.brand_id,r.event_id,r.user_id,COALESCE(NULLIF(btrim(r.guest_name),''),'Guest'),
      public.issue_1770_normalize_email(r.guest_email),public.issue_1770_normalize_phone(r.guest_phone),r.guest_phone_country_iso,r.created_at
    INTO v_brand,v_event,v_user,v_name,v_email,v_phone,v_phone_country_iso,v_occurred
    FROM public.event_rsvps r JOIN public.events e ON e.id=r.event_id WHERE r.id=p_source_id;
    v_provenance:='rsvp';
  ELSIF p_source_kind='rsvp_plus_one' THEN
    SELECT e.brand_id,r.event_id,g.matched_user_id,btrim(g.name),public.issue_1770_normalize_email(g.email),
      public.issue_1770_normalize_phone(g.phone),g.phone_country_iso,g.created_at
    INTO v_brand,v_event,v_user,v_name,v_email,v_phone,v_phone_country_iso,v_occurred
    FROM public.event_rsvp_guests g JOIN public.event_rsvps r ON r.id=g.rsvp_id
    JOIN public.events e ON e.id=r.event_id WHERE g.id=p_source_id;
    v_provenance:='rsvp';
  ELSIF p_source_kind='order' THEN
    SELECT e.brand_id,o.event_id,o.buyer_user_id,COALESCE(NULLIF(btrim(o.buyer_name),''),'Guest'),
      public.issue_1770_normalize_email(o.buyer_email),public.issue_1770_normalize_phone(COALESCE(o.buyer_phone_e164,o.buyer_phone)),o.created_at
    INTO v_brand,v_event,v_user,v_name,v_email,v_phone,v_occurred
    FROM public.orders o JOIN public.events e ON e.id=o.event_id
    WHERE o.id=p_source_id AND o.confirmed_at IS NOT NULL AND o.payment_status IN ('paid','partial_refund','refunded','cancelled');
    v_provenance:='order';
  ELSIF p_source_kind='ticket_holder' THEN
    SELECT e.brand_id,t.event_id,o.buyer_user_id,COALESCE(NULLIF(btrim(o.buyer_name),''),'Guest'),
      public.issue_1770_normalize_email(o.buyer_email),public.issue_1770_normalize_phone(COALESCE(o.buyer_phone_e164,o.buyer_phone)),o.created_at
    INTO v_brand,v_event,v_user,v_name,v_email,v_phone,v_occurred
    FROM public.tickets t JOIN public.orders o ON o.id=t.order_id JOIN public.events e ON e.id=t.event_id
    WHERE t.id=p_source_id AND o.confirmed_at IS NOT NULL AND o.payment_status IN ('paid','partial_refund','refunded','cancelled');
    v_provenance:='ticket';
  ELSIF p_source_kind='reservation' THEN
    SELECT r.brand_id,NULL::uuid,r.consumer_user_id,COALESCE(NULLIF(btrim(r.guest_name),''),'Guest'),
      public.issue_1770_normalize_email(r.guest_email),NULLIF(btrim(r.guest_phone_e164),''),r.guest_phone_country_iso,r.created_at
    INTO v_brand,v_event,v_user,v_name,v_email,v_raw_phone,v_phone_country_iso,v_occurred
    FROM public.reservations r WHERE r.id=p_source_id;
    v_provenance:='reservation';
  ELSE
    SELECT g.brand_id,NULL::uuid,g.user_id,COALESCE(NULLIF(btrim(g.guest_snapshot->>'name'),''),'Guest'),
      public.issue_1770_normalize_email(g.guest_snapshot->>'email'),NULLIF(btrim(g.guest_snapshot->>'phone'),''),
      NULLIF(g.guest_snapshot->>'phoneCountryIso',''),min(e.created_at)
    INTO v_brand,v_event,v_user,v_name,v_email,v_raw_phone,v_phone_country_iso,v_occurred
    FROM public.stay_reservation_groups g JOIN public.stay_reservation_events e ON e.group_id=g.id
    WHERE g.id=p_source_id AND e.event_type='stay_reservation_confirmed'
    GROUP BY g.id,g.brand_id,g.user_id,g.guest_snapshot;
    v_provenance:='reservation';
  END IF;

  IF v_brand IS NULL THEN
    UPDATE public.brand_person_contact_method_sources SET active=false,retired_at=now()
      WHERE source_link_id=v_link AND active;
    UPDATE public.brand_person_contact_methods c SET record_state='retired',retired_at=now(),updated_at=now()
      WHERE c.record_state='active' AND EXISTS(SELECT 1 FROM public.brand_person_contact_method_sources s WHERE s.contact_method_id=c.id AND s.source_link_id=v_link)
        AND NOT EXISTS(SELECT 1 FROM public.brand_person_contact_method_sources s WHERE s.contact_method_id=c.id AND s.active);
    UPDATE public.brand_person_names SET active=false,retired_at=now() WHERE source_link_id=v_link AND active;
    UPDATE public.brand_person_source_links SET detached_at=COALESCE(detached_at,now()),updated_at=now()
      WHERE source_kind=p_source_kind AND source_id=p_source_id AND detached_at IS NULL;
    RETURN jsonb_build_object('personId',NULL,'sourceLinkId',NULL,'linkOutcome','retired','conflictId',NULL);
  END IF;

  IF p_source_kind IN ('reservation','stay_reservation') THEN
    v_strict_phone:=public.issue_1770_normalize_phone(v_raw_phone);
    IF v_raw_phone IS NULL THEN
      IF p_normalized_phone_e164 IS NOT NULL THEN RETURN jsonb_build_object('personId',NULL,'sourceLinkId',NULL,'linkOutcome','unlinked','conflictId',NULL); END IF;
      v_phone:=NULL;
    ELSIF v_strict_phone IS NOT NULL THEN
      IF p_normalized_phone_e164 IS DISTINCT FROM v_strict_phone THEN RETURN jsonb_build_object('personId',NULL,'sourceLinkId',NULL,'linkOutcome','unlinked','conflictId',NULL); END IF;
      v_phone:=v_strict_phone;
    ELSE
      IF p_normalized_phone_e164 IS NOT NULL AND
         (v_phone_country_iso IS NULL OR v_phone_country_iso !~ '^[A-Z]{2}$'
          OR v_phone_country_iso NOT IN ('US','CA','GB','NG','FR','DE','BE','ES','PT')
          OR public.issue_1770_normalize_phone(p_normalized_phone_e164) IS DISTINCT FROM p_normalized_phone_e164) THEN
        RETURN jsonb_build_object('personId',NULL,'sourceLinkId',NULL,'linkOutcome','unlinked','conflictId',NULL);
      END IF;
      v_phone:=public.issue_1770_normalize_phone(p_normalized_phone_e164);
    END IF;
  END IF;

  IF v_brand IS DISTINCT FROM p_brand_id OR v_event IS DISTINCT FROM p_event_id
     OR v_user IS DISTINCT FROM p_authenticated_user_id
     OR v_email IS DISTINCT FROM public.issue_1770_normalize_email(p_normalized_email)
     OR v_phone IS DISTINCT FROM public.issue_1770_normalize_phone(p_normalized_phone_e164)
     OR v_occurred IS DISTINCT FROM p_source_occurred_at THEN
    RETURN jsonb_build_object('personId',NULL,'sourceLinkId',NULL,'linkOutcome','unlinked','conflictId',NULL);
  END IF;
  IF p_validated_invite_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.brand_offering_invites WHERE id=p_validated_invite_id AND brand_id=v_brand AND event_id=v_event AND status='active') THEN
    RETURN jsonb_build_object('personId',NULL,'sourceLinkId',NULL,'linkOutcome','unlinked','conflictId',NULL);
  END IF;
  v_norm_name:=lower(regexp_replace(btrim(v_name),'[[:space:]]+',' ','g'));
  IF v_link IS NOT NULL
     AND EXISTS(SELECT 1 FROM public.brand_people p WHERE p.id=public.biz_brand_person_canonical(v_prior_person) AND p.brand_id=v_brand AND p.record_status='active' AND (v_user IS NULL OR p.linked_user_id=v_user))
     AND EXISTS(SELECT 1 FROM public.brand_person_names n WHERE n.source_link_id=v_link AND n.active AND n.normalized_name=v_norm_name)
     AND ((v_email IS NULL AND NOT EXISTS(SELECT 1 FROM public.brand_person_contact_method_sources s JOIN public.brand_person_contact_methods c ON c.id=s.contact_method_id WHERE s.source_link_id=v_link AND s.active AND c.channel='email' AND c.record_state='active'))
       OR EXISTS(SELECT 1 FROM public.brand_person_contact_method_sources s JOIN public.brand_person_contact_methods c ON c.id=s.contact_method_id WHERE s.source_link_id=v_link AND s.active AND c.channel='email' AND c.normalized_value=v_email AND c.record_state='active'))
     AND ((v_phone IS NULL AND NOT EXISTS(SELECT 1 FROM public.brand_person_contact_method_sources s JOIN public.brand_person_contact_methods c ON c.id=s.contact_method_id WHERE s.source_link_id=v_link AND s.active AND c.channel='phone' AND c.record_state='active'))
       OR EXISTS(SELECT 1 FROM public.brand_person_contact_method_sources s JOIN public.brand_person_contact_methods c ON c.id=s.contact_method_id WHERE s.source_link_id=v_link AND s.active AND c.channel='phone' AND c.normalized_value=v_phone AND c.record_state='active')) THEN
    UPDATE public.brand_person_contact_method_sources s SET phone_country_iso=v_phone_country_iso
      FROM public.brand_person_contact_methods c WHERE s.source_link_id=v_link AND s.active AND c.id=s.contact_method_id
      AND c.channel='phone' AND s.phone_country_iso IS DISTINCT FROM v_phone_country_iso;
    RETURN jsonb_build_object('personId',public.biz_brand_person_canonical(v_prior_person),'sourceLinkId',v_link,'linkOutcome','already_linked','conflictId',NULL);
  END IF;
  IF v_link IS NOT NULL THEN
    UPDATE public.brand_person_contact_method_sources SET active=false,retired_at=now() WHERE source_link_id=v_link AND active;
    UPDATE public.brand_person_contact_methods c SET record_state='retired',retired_at=now(),updated_at=now()
      WHERE c.record_state='active' AND EXISTS(SELECT 1 FROM public.brand_person_contact_method_sources s WHERE s.contact_method_id=c.id AND s.source_link_id=v_link)
      AND NOT EXISTS(SELECT 1 FROM public.brand_person_contact_method_sources s WHERE s.contact_method_id=c.id AND s.active);
    UPDATE public.brand_person_names SET active=false,retired_at=now() WHERE source_link_id=v_link AND active;
    UPDATE public.brand_person_source_links SET detached_at=now(),updated_at=now() WHERE id=v_link;
  END IF;
  IF p_validated_invite_id IS NOT NULL THEN v_link_method:='invite_token'; ELSIF v_user IS NOT NULL THEN v_link_method:='authenticated_user'; END IF;
  SELECT array_agg(DISTINCT candidate ORDER BY candidate) INTO v_candidates FROM (
    SELECT public.biz_brand_person_canonical(v_prior_person) candidate WHERE v_prior_person IS NOT NULL
    UNION SELECT p.id FROM public.brand_people p WHERE p.brand_id=v_brand AND p.record_status='active' AND v_user IS NOT NULL AND p.linked_user_id=v_user
    UNION SELECT c.brand_person_id FROM public.brand_person_contact_methods c JOIN public.brand_people p ON p.id=c.brand_person_id
      WHERE c.brand_id=v_brand AND p.record_status='active' AND c.record_state='active' AND c.provenance_scope='brand_owned'
      AND ((c.channel='email' AND v_email IS NOT NULL AND c.normalized_value=v_email) OR (c.channel='phone' AND v_phone IS NOT NULL AND c.normalized_value=v_phone))
    UNION SELECT i.brand_person_id FROM public.brand_offering_invites i WHERE p_validated_invite_id IS NOT NULL AND i.id=p_validated_invite_id AND i.status='active'
  ) candidates;
  IF cardinality(COALESCE(v_candidates,'{}'))>0 THEN
    FOREACH v_candidate IN ARRAY v_candidates LOOP
      SELECT lower(regexp_replace(btrim(display_name),'[[:space:]]+',' ','g')) INTO v_candidate_name FROM public.brand_people WHERE id=v_candidate;
      IF v_candidate_name<>v_norm_name AND v_candidate_name<>'guest' AND v_norm_name<>'guest' THEN
        INSERT INTO public.brand_person_identity_conflicts(brand_id,source_kind,source_id,candidate_person_ids,reason)
        VALUES(v_brand,p_source_kind,p_source_id,v_candidates,'different_nonempty_names')
        ON CONFLICT(source_kind,source_id,status) DO UPDATE SET candidate_person_ids=EXCLUDED.candidate_person_ids RETURNING id INTO v_conflict;
        RETURN jsonb_build_object('personId',NULL,'sourceLinkId',NULL,'linkOutcome','conflict','conflictId',v_conflict);
      END IF;
    END LOOP;
    v_person:=v_candidates[1];
    IF cardinality(v_candidates)>1 THEN
      FOREACH v_candidate IN ARRAY v_candidates[2:cardinality(v_candidates)] LOOP
        PERFORM public.biz_merge_brand_people(v_person,v_candidate,CASE WHEN v_user IS NOT NULL THEN 'authenticated_user' ELSE 'normalized_address' END,NULL,NULL);
      END LOOP;
    END IF;
  ELSE
    IF v_user IS NULL AND v_email IS NULL AND v_phone IS NULL THEN RETURN jsonb_build_object('personId',NULL,'sourceLinkId',NULL,'linkOutcome','unlinked','conflictId',NULL); END IF;
    INSERT INTO public.brand_people(brand_id,linked_user_id,display_name) VALUES(v_brand,v_user,v_name) RETURNING id INTO v_person;
  END IF;
  INSERT INTO public.brand_person_source_links(brand_id,brand_person_id,source_kind,source_id,offering_invite_id,link_method,source_occurred_at)
  VALUES(v_brand,v_person,p_source_kind,p_source_id,p_validated_invite_id,v_link_method,v_occurred) RETURNING id INTO v_link;
  INSERT INTO public.brand_person_names(brand_person_id,display_name,normalized_name,name_kind,source_link_id)
  VALUES(v_person,v_name,v_norm_name,CASE WHEN EXISTS(SELECT 1 FROM public.brand_person_names WHERE brand_person_id=v_person AND active AND name_kind='primary') THEN 'alternate' ELSE 'primary' END,v_link)
  ON CONFLICT(brand_person_id,normalized_name) WHERE active DO NOTHING;
  IF v_email IS NOT NULL THEN
    INSERT INTO public.brand_person_contact_methods(brand_id,brand_person_id,channel,normalized_value,provenance_scope,is_exportable,is_primary)
    VALUES(v_brand,v_person,'email',v_email,'brand_owned',true,NOT EXISTS(SELECT 1 FROM public.brand_person_contact_methods WHERE brand_person_id=v_person AND channel='email' AND record_state='active'))
    ON CONFLICT(brand_person_id,channel,normalized_value) WHERE record_state='active' DO UPDATE SET is_exportable=true,updated_at=now() RETURNING id INTO v_existing;
    INSERT INTO public.brand_person_contact_method_sources(contact_method_id,source_link_id,provenance_kind,exportable)
    VALUES(v_existing,v_link,v_provenance,true) ON CONFLICT DO NOTHING;
  END IF;
  IF v_phone IS NOT NULL THEN
    INSERT INTO public.brand_person_contact_methods(brand_id,brand_person_id,channel,normalized_value,provenance_scope,is_exportable,is_primary)
    VALUES(v_brand,v_person,'phone',v_phone,'brand_owned',true,NOT EXISTS(SELECT 1 FROM public.brand_person_contact_methods WHERE brand_person_id=v_person AND channel='phone' AND record_state='active'))
    ON CONFLICT(brand_person_id,channel,normalized_value) WHERE record_state='active' DO UPDATE SET is_exportable=true,updated_at=now() RETURNING id INTO v_existing;
    INSERT INTO public.brand_person_contact_method_sources(contact_method_id,source_link_id,provenance_kind,exportable,phone_country_iso)
    VALUES(v_existing,v_link,v_provenance,true,v_phone_country_iso)
    ON CONFLICT(contact_method_id,source_link_id) DO UPDATE SET active=true,retired_at=NULL,phone_country_iso=EXCLUDED.phone_country_iso;
  END IF;
  RETURN jsonb_build_object('personId',v_person,'sourceLinkId',v_link,'linkOutcome','linked','conflictId',NULL);
END;
$function$;

-- Only the worker may supply the normalized E.164 value.  This overload
-- reloads every other identity input from source truth before resolving.
CREATE OR REPLACE FUNCTION public.biz_resolve_brand_person_source_derived(
  p_source_kind text,
  p_source_id uuid,
  p_normalized_phone_e164 text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_brand uuid;
  v_user uuid;
  v_email text;
  v_phone text;
  v_occurred timestamptz;
  v_result jsonb;
  v_suppression public.channel_suppressions%ROWTYPE;
  v_unsubscribe public.marketing_unsubscribes%ROWTYPE;
BEGIN
  IF p_source_kind='reservation' THEN
    SELECT r.brand_id,r.consumer_user_id,
           public.issue_1770_normalize_email(r.guest_email),
           public.issue_1770_normalize_phone(r.guest_phone_e164),r.created_at
      INTO v_brand,v_user,v_email,v_phone,v_occurred
      FROM public.reservations r WHERE r.id=p_source_id;
  ELSIF p_source_kind='stay_reservation' THEN
    SELECT g.brand_id,g.user_id,
           public.issue_1770_normalize_email(g.guest_snapshot->>'email'),
           public.issue_1770_normalize_phone(g.guest_snapshot->>'phone'),
           min(e.created_at)
      INTO v_brand,v_user,v_email,v_phone,v_occurred
      FROM public.stay_reservation_groups g
      JOIN public.stay_reservation_events e ON e.group_id=g.id
       AND e.event_type='stay_reservation_confirmed'
     WHERE g.id=p_source_id
     GROUP BY g.id,g.brand_id,g.user_id,g.guest_snapshot;
  ELSE
    RETURN jsonb_build_object('personId',NULL,'sourceLinkId',NULL,'linkOutcome','unlinked','conflictId',NULL);
  END IF;

  v_result:=public.biz_resolve_brand_person_source(
    v_brand,NULL,p_source_kind,p_source_id,v_user,NULL,
    v_email,p_normalized_phone_e164,v_occurred
  );

  IF v_result->>'linkOutcome' IN ('linked','already_linked') THEN
    FOR v_suppression IN
      SELECT s.* FROM public.channel_suppressions s
       WHERE s.channel IN ('email','sms') AND s.scope IN ('marketing','all')
         AND (s.brand_id IS NULL OR s.brand_id=v_brand)
         AND ((v_user IS NOT NULL AND s.user_id=v_user)
           OR (s.channel='email' AND v_email IS NOT NULL
             AND public.issue_1770_normalize_email(s.contact)=v_email)
           OR (s.channel='sms' AND p_normalized_phone_e164 IS NOT NULL
             AND public.issue_1770_normalize_phone(s.contact)=p_normalized_phone_e164))
    LOOP
      PERFORM public.biz_record_brand_person_suppression(
        v_suppression.channel,v_suppression.scope,v_suppression.contact,
        v_suppression.user_id,v_suppression.brand_id,v_suppression.reason,
        'channel_suppressions',v_suppression.id
      );
    END LOOP;
    FOR v_unsubscribe IN
      SELECT m.* FROM public.marketing_unsubscribes m
       WHERE (m.brand_id IS NULL OR m.brand_id=v_brand)
         AND ((m.channel IN ('email','all') AND v_email IS NOT NULL
               AND public.issue_1770_normalize_email(m.contact_email)=v_email)
           OR (m.channel IN ('sms','all') AND p_normalized_phone_e164 IS NOT NULL
               AND public.issue_1770_normalize_phone(m.contact_phone)=p_normalized_phone_e164))
    LOOP
      IF v_unsubscribe.channel IN ('email','all') AND v_unsubscribe.contact_email IS NOT NULL THEN
        PERFORM public.biz_record_brand_person_suppression(
          'email','marketing',v_unsubscribe.contact_email,NULL,v_unsubscribe.brand_id,
          COALESCE(v_unsubscribe.reason,'unsubscribe'),'marketing_unsubscribes',v_unsubscribe.id
        );
      END IF;
      IF v_unsubscribe.channel IN ('sms','all') AND v_unsubscribe.contact_phone IS NOT NULL THEN
        PERFORM public.biz_record_brand_person_suppression(
          'sms','marketing',v_unsubscribe.contact_phone,NULL,v_unsubscribe.brand_id,
          COALESCE(v_unsubscribe.reason,'unsubscribe'),'marketing_unsubscribes',v_unsubscribe.id
        );
      END IF;
    END LOOP;
  END IF;
  RETURN v_result;
END;
$function$;

-- One enqueue owner for the original four sources plus venue reservations.
CREATE OR REPLACE FUNCTION public.issue_1770_enqueue_source()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_id uuid;
  v_operation text;
  v_old_state jsonb;
  v_new_state jsonb;
  v_revision text;
BEGIN
  v_id:=COALESCE(NEW.id,OLD.id);
  v_operation:=CASE WHEN TG_OP='DELETE' THEN 'retire' ELSE 'upsert' END;
  IF TG_ARGV[0]='event_rsvp' THEN
    IF TG_OP<>'INSERT' THEN v_old_state:=jsonb_build_object('eventId',to_jsonb(OLD)->>'event_id','userId',to_jsonb(OLD)->>'user_id','name',lower(regexp_replace(btrim(COALESCE(to_jsonb(OLD)->>'guest_name','')),'[[:space:]]+',' ','g')),'email',public.issue_1770_normalize_email(to_jsonb(OLD)->>'guest_email'),'phone',public.issue_1770_normalize_phone(to_jsonb(OLD)->>'guest_phone'),'phoneCountryIso',to_jsonb(OLD)->>'guest_phone_country_iso','rsvpStatus',to_jsonb(OLD)->>'rsvp_status','approvalStatus',to_jsonb(OLD)->>'approval_status'); END IF;
    IF TG_OP<>'DELETE' THEN v_new_state:=jsonb_build_object('eventId',to_jsonb(NEW)->>'event_id','userId',to_jsonb(NEW)->>'user_id','name',lower(regexp_replace(btrim(COALESCE(to_jsonb(NEW)->>'guest_name','')),'[[:space:]]+',' ','g')),'email',public.issue_1770_normalize_email(to_jsonb(NEW)->>'guest_email'),'phone',public.issue_1770_normalize_phone(to_jsonb(NEW)->>'guest_phone'),'phoneCountryIso',to_jsonb(NEW)->>'guest_phone_country_iso','rsvpStatus',to_jsonb(NEW)->>'rsvp_status','approvalStatus',to_jsonb(NEW)->>'approval_status'); END IF;
  ELSIF TG_ARGV[0]='rsvp_plus_one' THEN
    IF TG_OP<>'INSERT' THEN v_old_state:=jsonb_build_object('rsvpId',to_jsonb(OLD)->>'rsvp_id','userId',to_jsonb(OLD)->>'matched_user_id','name',lower(regexp_replace(btrim(COALESCE(to_jsonb(OLD)->>'name','')),'[[:space:]]+',' ','g')),'email',public.issue_1770_normalize_email(to_jsonb(OLD)->>'email'),'phone',public.issue_1770_normalize_phone(to_jsonb(OLD)->>'phone'),'phoneCountryIso',to_jsonb(OLD)->>'phone_country_iso'); END IF;
    IF TG_OP<>'DELETE' THEN v_new_state:=jsonb_build_object('rsvpId',to_jsonb(NEW)->>'rsvp_id','userId',to_jsonb(NEW)->>'matched_user_id','name',lower(regexp_replace(btrim(COALESCE(to_jsonb(NEW)->>'name','')),'[[:space:]]+',' ','g')),'email',public.issue_1770_normalize_email(to_jsonb(NEW)->>'email'),'phone',public.issue_1770_normalize_phone(to_jsonb(NEW)->>'phone'),'phoneCountryIso',to_jsonb(NEW)->>'phone_country_iso'); END IF;
  ELSIF TG_ARGV[0]='order' THEN
    IF TG_OP<>'INSERT' THEN v_old_state:=jsonb_build_object('eventId',to_jsonb(OLD)->>'event_id','userId',to_jsonb(OLD)->>'buyer_user_id','name',lower(regexp_replace(btrim(COALESCE(to_jsonb(OLD)->>'buyer_name','')),'[[:space:]]+',' ','g')),'email',public.issue_1770_normalize_email(to_jsonb(OLD)->>'buyer_email'),'phone',public.issue_1770_normalize_phone(COALESCE(to_jsonb(OLD)->>'buyer_phone_e164',to_jsonb(OLD)->>'buyer_phone')),'confirmedAt',to_jsonb(OLD)->>'confirmed_at','paymentStatus',to_jsonb(OLD)->>'payment_status'); END IF;
    IF TG_OP<>'DELETE' THEN v_new_state:=jsonb_build_object('eventId',to_jsonb(NEW)->>'event_id','userId',to_jsonb(NEW)->>'buyer_user_id','name',lower(regexp_replace(btrim(COALESCE(to_jsonb(NEW)->>'buyer_name','')),'[[:space:]]+',' ','g')),'email',public.issue_1770_normalize_email(to_jsonb(NEW)->>'buyer_email'),'phone',public.issue_1770_normalize_phone(COALESCE(to_jsonb(NEW)->>'buyer_phone_e164',to_jsonb(NEW)->>'buyer_phone')),'confirmedAt',to_jsonb(NEW)->>'confirmed_at','paymentStatus',to_jsonb(NEW)->>'payment_status'); END IF;
  ELSIF TG_ARGV[0]='ticket_holder' THEN
    IF TG_OP<>'INSERT' THEN v_old_state:=jsonb_build_object('eventId',to_jsonb(OLD)->>'event_id','orderId',to_jsonb(OLD)->>'order_id'); END IF;
    IF TG_OP<>'DELETE' THEN v_new_state:=jsonb_build_object('eventId',to_jsonb(NEW)->>'event_id','orderId',to_jsonb(NEW)->>'order_id'); END IF;
  ELSIF TG_ARGV[0]='reservation' THEN
    IF TG_OP<>'INSERT' THEN v_old_state:=jsonb_build_object('sourceKind','reservation','sourceId',OLD.id,'brandId',OLD.brand_id,'userId',OLD.consumer_user_id,'name',lower(regexp_replace(btrim(COALESCE(OLD.guest_name,'')),'[[:space:]]+',' ','g')),'email',public.issue_1770_normalize_email(OLD.guest_email),'rawPhone',NULLIF(btrim(OLD.guest_phone_e164),''),'phoneCountryIso',OLD.guest_phone_country_iso,'createdAt',OLD.created_at); END IF;
    IF TG_OP<>'DELETE' THEN v_new_state:=jsonb_build_object('sourceKind','reservation','sourceId',NEW.id,'brandId',NEW.brand_id,'userId',NEW.consumer_user_id,'name',lower(regexp_replace(btrim(COALESCE(NEW.guest_name,'')),'[[:space:]]+',' ','g')),'email',public.issue_1770_normalize_email(NEW.guest_email),'rawPhone',NULLIF(btrim(NEW.guest_phone_e164),''),'phoneCountryIso',NEW.guest_phone_country_iso,'createdAt',NEW.created_at); END IF;
  ELSE
    RETURN COALESCE(NEW,OLD);
  END IF;
  IF TG_OP='UPDATE' AND v_old_state IS NOT DISTINCT FROM v_new_state THEN RETURN NEW; END IF;
  v_revision:=md5(COALESCE(v_new_state,v_old_state,'{}'::jsonb)::text);
  INSERT INTO public.brand_person_ingest_outbox(source_kind,source_id,operation,revision_key)
  VALUES(TG_ARGV[0],v_id,v_operation,v_revision) ON CONFLICT DO NOTHING;
  RETURN COALESCE(NEW,OLD);
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'issue_1773_ingest_enqueue_failed source=% table=%',TG_ARGV[0],TG_TABLE_NAME;
  RETURN COALESCE(NEW,OLD);
END;
$function$;

DROP TRIGGER IF EXISTS issue_1773_reservation_ingest ON public.reservations;
CREATE TRIGGER issue_1773_reservation_ingest
AFTER INSERT OR UPDATE OR DELETE ON public.reservations
FOR EACH ROW EXECUTE FUNCTION public.issue_1770_enqueue_source('reservation');

CREATE OR REPLACE FUNCTION public.issue_1773_stay_identity_revision(p_group_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT md5(jsonb_build_object(
    'sourceKind','stay_reservation','sourceId',g.id,'brandId',g.brand_id,
    'userId',g.user_id,'name',lower(regexp_replace(btrim(COALESCE(g.guest_snapshot->>'name','')),'[[:space:]]+',' ','g')),
    'email',public.issue_1770_normalize_email(g.guest_snapshot->>'email'),
    'rawPhone',NULLIF(btrim(g.guest_snapshot->>'phone'),''),
    'phoneCountryIso',NULLIF(btrim(g.guest_snapshot->>'phoneCountryIso'),''),
    'createdAt',g.created_at,
    'confirmedAt',min(e.created_at)
  )::text)
  FROM public.stay_reservation_groups g
  JOIN public.stay_reservation_events e ON e.group_id=g.id AND e.event_type='stay_reservation_confirmed'
  WHERE g.id=p_group_id
  GROUP BY g.id,g.brand_id,g.user_id,g.guest_snapshot,g.created_at
$function$;

CREATE OR REPLACE FUNCTION public.issue_1773_enqueue_confirmed_stay()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE v_revision text;
BEGIN
  IF NEW.event_type<>'stay_reservation_confirmed' THEN RETURN NEW; END IF;
  v_revision:=public.issue_1773_stay_identity_revision(NEW.group_id);
  IF v_revision IS NOT NULL THEN
    INSERT INTO public.brand_person_ingest_outbox(source_kind,source_id,operation,revision_key)
    VALUES('stay_reservation',NEW.group_id,'upsert',v_revision) ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'issue_1773_ingest_enqueue_failed source=stay_reservation table=%',TG_TABLE_NAME;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS issue_1773_confirmed_stay_ingest ON public.stay_reservation_events;
CREATE TRIGGER issue_1773_confirmed_stay_ingest
AFTER INSERT ON public.stay_reservation_events
FOR EACH ROW EXECUTE FUNCTION public.issue_1773_enqueue_confirmed_stay();

-- Deterministic, idempotent historical coverage.
INSERT INTO public.brand_person_ingest_outbox(source_kind,source_id,operation,revision_key)
SELECT 'reservation',r.id,'upsert',md5(jsonb_build_object(
  'sourceKind','reservation','sourceId',r.id,'brandId',r.brand_id,'userId',r.consumer_user_id,
  'name',lower(regexp_replace(btrim(COALESCE(r.guest_name,'')),'[[:space:]]+',' ','g')),
  'email',public.issue_1770_normalize_email(r.guest_email),'rawPhone',NULLIF(btrim(r.guest_phone_e164),''),
  'phoneCountryIso',r.guest_phone_country_iso,'createdAt',r.created_at)::text)
FROM public.reservations r ON CONFLICT DO NOTHING;

INSERT INTO public.brand_person_ingest_outbox(source_kind,source_id,operation,revision_key)
SELECT 'stay_reservation',g.id,'upsert',public.issue_1773_stay_identity_revision(g.id)
FROM public.stay_reservation_groups g
WHERE EXISTS(SELECT 1 FROM public.stay_reservation_events e WHERE e.group_id=g.id AND e.event_type='stay_reservation_confirmed')
ON CONFLICT DO NOTHING;

REVOKE ALL ON FUNCTION public.biz_resolve_brand_person_source(uuid,uuid,text,uuid,uuid,uuid,text,text,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.biz_resolve_brand_person_source(uuid,uuid,text,uuid,uuid,uuid,text,text,timestamptz) TO service_role;
REVOKE ALL ON FUNCTION public.biz_resolve_brand_person_source_derived(text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.biz_resolve_brand_person_source_derived(text,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.biz_resolve_brand_person_source_derived(text,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.biz_resolve_brand_person_source_derived(text,uuid,text) TO service_role;
REVOKE ALL ON FUNCTION public.biz_claim_brand_person_ingest(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.biz_claim_brand_person_ingest(integer) TO service_role;
REVOKE ALL ON FUNCTION public.biz_finish_brand_person_ingest(uuid,boolean,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.biz_finish_brand_person_ingest(uuid,boolean,text) TO service_role;
REVOKE ALL ON FUNCTION public.biz_record_brand_person_suppression(text,text,text,uuid,uuid,text,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.biz_record_brand_person_suppression(text,text,text,uuid,uuid,text,text,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.issue_1770_enqueue_source() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_1770_enqueue_source() TO service_role;
REVOKE ALL ON FUNCTION public.issue_1773_stay_identity_revision(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_1773_stay_identity_revision(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.issue_1773_enqueue_confirmed_stay() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_1773_enqueue_confirmed_stay() TO service_role;

DO $rls$
DECLARE v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'brand_people','brand_person_names','brand_person_source_links',
    'brand_person_contact_methods','brand_person_contact_method_sources',
    'brand_person_identity_conflicts','brand_person_merge_events',
    'brand_person_channel_suppressions','brand_person_ingest_outbox'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',v_table);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',v_table);
  END LOOP;
END;
$rls$;

DO $post$
DECLARE v_definition text;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='public.biz_resolve_brand_person_source_derived(text,uuid)'::regprocedure)
     OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='public.biz_resolve_brand_person_source_derived(text,uuid,text)'::regprocedure) THEN
    RAISE EXCEPTION 'issue_1773_postcondition_resolver_overloads';
  END IF;
  IF has_function_privilege('anon','public.biz_resolve_brand_person_source_derived(text,uuid,text)','EXECUTE')
     OR has_function_privilege('authenticated','public.biz_resolve_brand_person_source_derived(text,uuid,text)','EXECUTE')
     OR NOT has_function_privilege('service_role','public.biz_resolve_brand_person_source_derived(text,uuid,text)','EXECUTE') THEN
    RAISE EXCEPTION 'issue_1773_postcondition_acl';
  END IF;
  IF EXISTS(
    SELECT 1 FROM (VALUES
      ('brand_people'),('brand_person_names'),('brand_person_source_links'),
      ('brand_person_contact_methods'),('brand_person_contact_method_sources'),
      ('brand_person_identity_conflicts'),('brand_person_merge_events'),
      ('brand_person_channel_suppressions'),('brand_person_ingest_outbox')
    ) expected(table_name)
    LEFT JOIN pg_class c ON c.oid=to_regclass('public.'||expected.table_name)
    WHERE NOT COALESCE(c.relrowsecurity,false) OR NOT COALESCE(c.relforcerowsecurity,false)
  ) THEN RAISE EXCEPTION 'issue_1773_postcondition_rls'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.reservations'::regclass AND tgname='issue_1773_reservation_ingest' AND NOT tgisinternal)
     OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.stay_reservation_events'::regclass AND tgname='issue_1773_confirmed_stay_ingest' AND NOT tgisinternal)
     OR EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.stay_reservation_groups'::regclass AND tgname LIKE '%1773%' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'issue_1773_postcondition_trigger_topology';
  END IF;
  SELECT pg_get_constraintdef(oid) INTO v_definition FROM pg_constraint WHERE conrelid='public.brand_person_ingest_outbox'::regclass AND conname='brand_person_ingest_outbox_source_kind_check';
  IF v_definition NOT LIKE '%reservation%' OR v_definition NOT LIKE '%stay_reservation%' THEN RAISE EXCEPTION 'issue_1773_postcondition_outbox_domain'; END IF;
  SELECT pg_get_constraintdef(oid) INTO v_definition FROM pg_constraint WHERE conrelid='public.brand_person_contact_method_sources'::regclass AND conname='brand_person_contact_method_sources_provenance_kind_check';
  IF v_definition LIKE '%stay_reservation%' THEN RAISE EXCEPTION 'issue_1773_postcondition_semantic_provenance_drift'; END IF;
END;
$post$;

COMMIT;
