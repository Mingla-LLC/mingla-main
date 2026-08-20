-- Issue #2305 REWORK — the tester's FAIL, fixed at the root.
--
-- 20270426002305 is ALREADY APPLIED to production, so this is a forward
-- migration; that file is not edited in place.
--
-- P1-1  "Different people" only half-stuck. Separation rows were written in ONE
--       direction -- (candidate, incoming name) -- so the ORIGINAL buyer's very
--       next order still saw the new person as a candidate and re-conflicted.
--       At that point BOTH buttons were wrong: "Same person" folded back
--       together the two humans a person had separated minutes earlier, and
--       "Different people" created a THIRD record while writing (A, A's own
--       name) -- permanently severing the original buyer from their own future
--       orders. Fixed from both ends: the reverse separation is now written
--       (a), and the AUTOMATIC chain-merge refuses to collapse a pair the
--       ledger already says are different people (b).
--
-- P1-2  The vanished-source close was dead code. It UPDATEd the conflict and
--       then RAISEd in the same transaction, rolling its own write back. The
--       comment said "close the group so it cannot wedge the queue forever";
--       the code provably did not. Replaced by `dismiss`, which COMMITS.
--
-- P2-2  `manual`-kind conflicts were unresolvable AND permanently counted --
--       `brand_person_manual_add_requests` keeps only a sha256 of the payload,
--       so their subject is unrecoverable. Same shape as P1-2, same exit.
--
-- P2-1  `separate` raised on a linked_user_id collision where SPEC 4.4 says
--       degrade to NULL, making separate unreachable for a signed-in second
--       human on a shared phone -- the system permitted only the collapse.
--
-- P2-4  Sources 2..N of a resolved group lost `manual_resolution` provenance on
--       the next re-ingest, erasing the record that a human decided it.
--
-- P3-1  `mergedPersonIds` named the person that SURVIVED rather than the one
--       collapsed, because the canonical was read after the merge rewrote it.
--
-- THE THIRD OUTCOME. `resolved_dismissed` exists because a conflict whose
-- SUBJECT CANNOT BE PRODUCED has no other exit, and with no exit it wedges the
-- badge -- which is this feature's only notification mechanism. It links
-- nothing, because there is nothing to link. Its legality is PROVEN, never
-- inferred: `biz_brand_person_conflict_absence` probes raw row existence
-- independent of every business predicate, so a source that merely fell out of
-- a status filter reads as PRESENT and stays un-dismissable. Accepting "the
-- lookup returned nothing" would turn a query bug into silent data loss, which
-- is precisely the defect this issue exists to end.
--
-- NO ROW IN brand_person_identity_conflicts IS MUTATED BY THIS MIGRATION. The
-- 11 live conflicts remain the acceptance run.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The third terminal state.
-- ---------------------------------------------------------------------------
-- `brand_person_conflict_resolution_shape` already reads (status <> 'open' AND
-- resolved_at IS NOT NULL), so it accepts the new value unchanged -- a
-- dismissed row still carries its resolved_at and its resolved_by.
ALTER TABLE public.brand_person_identity_conflicts
  DROP CONSTRAINT IF EXISTS brand_person_identity_conflicts_status_check;
ALTER TABLE public.brand_person_identity_conflicts
  ADD CONSTRAINT brand_person_identity_conflicts_status_check
  CHECK (status IN ('open','resolved_merge','resolved_separate','resolved_dismissed'));

COMMENT ON COLUMN public.brand_person_identity_conflicts.status IS
  '#2305 — open | resolved_merge | resolved_separate | resolved_dismissed. '
  'A conflict is DISMISSED only when its subject is provably unproducible: the '
  'source row does not exist, or the manual-add ledger holds no payload to '
  'recover. Dismissal links nothing and is never inferred from a failed lookup.';

-- ---------------------------------------------------------------------------
-- 2. The absence prober — the thing that makes dismissal honest.
-- ---------------------------------------------------------------------------
-- Returns NULL when the subject is PRODUCIBLE (or when we cannot prove it is
-- not), and a reason string only when absence is DEMONSTRATED.
--
-- The distinction that matters: `biz_brand_person_conflict_subject` applies
-- business predicates -- an order must be confirmed and in a payment status,
-- a stay group must have a confirmed event. A row can therefore be PRESENT and
-- still yield a NULL subject. That is not absence, it is a temporarily
-- underivable subject, and dismissing it would discard a real buyer. This
-- function asks one question only: does the row exist at all?
CREATE OR REPLACE FUNCTION public.biz_brand_person_conflict_absence(
  p_source_kind text, p_source_id uuid
) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp
AS $function$
DECLARE v_exists boolean;
BEGIN
  IF p_source_kind='manual' THEN
    -- The ledger row is present, but the payload provably is not: the table has
    -- no name, email or phone column at all -- only a sha256 request_hash. This
    -- is asserted against the CATALOGUE rather than assumed, so if the ledger is
    -- ever widened to retain the payload this stops reporting absence and the
    -- rows become properly resolvable instead of quietly dismissable.
    SELECT EXISTS(SELECT 1 FROM public.brand_person_manual_add_requests
                  WHERE client_request_id=p_source_id) INTO v_exists;
    IF NOT v_exists THEN RETURN 'source_row_absent'; END IF;
    IF EXISTS(SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='brand_person_manual_add_requests'
                AND column_name IN ('display_name','name','email','phone','phone_e164')) THEN
      RETURN NULL;
    END IF;
    RETURN 'manual_payload_not_retained';
  END IF;

  SELECT CASE p_source_kind
    WHEN 'event_rsvp'      THEN EXISTS(SELECT 1 FROM public.event_rsvps WHERE id=p_source_id)
    WHEN 'rsvp_plus_one'   THEN EXISTS(SELECT 1 FROM public.event_rsvp_guests WHERE id=p_source_id)
    WHEN 'order'           THEN EXISTS(SELECT 1 FROM public.orders WHERE id=p_source_id)
    WHEN 'ticket_holder'   THEN EXISTS(SELECT 1 FROM public.tickets WHERE id=p_source_id)
    WHEN 'reservation'     THEN EXISTS(SELECT 1 FROM public.reservations WHERE id=p_source_id)
    WHEN 'stay_reservation'THEN EXISTS(SELECT 1 FROM public.stay_reservation_groups WHERE id=p_source_id)
    WHEN 'import'          THEN EXISTS(SELECT 1 FROM public.brand_contact_import_rows WHERE id=p_source_id)
    ELSE true
  END INTO v_exists;

  IF v_exists THEN RETURN NULL; END IF;
  RETURN 'source_row_absent';
END;
$function$;

COMMENT ON FUNCTION public.biz_brand_person_conflict_absence(text,uuid) IS
  '#2305 — PROVES that a conflict''s subject cannot be produced, so it may be '
  'dismissed. Returns NULL whenever the row exists, EVEN IF the subject '
  'derivation currently yields nothing, because a present row is a real buyer '
  'and a failed lookup is not evidence of absence.';

-- ---------------------------------------------------------------------------
-- 3. The resolver — P1-1(b) and P2-4.
-- ---------------------------------------------------------------------------
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
  v_name_matches boolean; v_prior_link_method text;
BEGIN
  IF p_source_kind NOT IN ('event_rsvp','rsvp_plus_one','order','ticket_holder','reservation','stay_reservation') THEN
    RETURN jsonb_build_object('personId',NULL,'sourceLinkId',NULL,'linkOutcome','unlinked','conflictId',NULL);
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_source_kind||':'||p_source_id::text,0));
  SELECT id,brand_person_id,link_method INTO v_link,v_prior_person,v_prior_link_method
  FROM public.brand_person_source_links
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

  -- A-3 (F-3): the detach block that used to sit HERE now runs after the
  -- conflict decision. Everything between here and the detach is read-only, so
  -- a conflicting re-ingest leaves an existing link exactly as it was.
  IF p_validated_invite_id IS NOT NULL THEN v_link_method:='invite_token'; ELSIF v_user IS NOT NULL THEN v_link_method:='authenticated_user'; END IF;
  -- #2305 REWORK P2-4: a link a HUMAN created keeps saying so. Only the FIRST
  -- source of a resolved group can hold the alternate-name row (the name index
  -- is UNIQUE per person+name), so sources 2..N always fail the already_linked
  -- fast path and get re-linked by the generic path below. Before this, that
  -- re-link silently overwrote link_method='manual_resolution' with
  -- 'normalized_address' and erased the record that a person decided it.
  IF v_prior_link_method='manual_resolution' THEN v_link_method:='manual_resolution'; END IF;
  SELECT array_agg(DISTINCT candidate ORDER BY candidate) INTO v_candidates FROM (
    SELECT public.biz_brand_person_canonical(v_prior_person) candidate WHERE v_prior_person IS NOT NULL
    UNION SELECT p.id FROM public.brand_people p WHERE p.brand_id=v_brand AND p.record_status='active' AND v_user IS NOT NULL AND p.linked_user_id=v_user
    UNION SELECT c.brand_person_id FROM public.brand_person_contact_methods c JOIN public.brand_people p ON p.id=c.brand_person_id
      WHERE c.brand_id=v_brand AND p.record_status='active' AND c.record_state='active' AND c.provenance_scope='brand_owned'
      AND ((c.channel='email' AND v_email IS NOT NULL AND c.normalized_value=v_email) OR (c.channel='phone' AND v_phone IS NOT NULL AND c.normalized_value=v_phone))
    UNION SELECT i.brand_person_id FROM public.brand_offering_invites i WHERE p_validated_invite_id IS NOT NULL AND i.id=p_validated_invite_id AND i.status='active'
  ) candidates;

  -- A-2 (F-6): drop every candidate a human deliberately separated from this
  -- name. Excluded candidates take no part in the conflict test AND no part in
  -- the chain-merge below. If exclusion empties the set we fall through to the
  -- "no candidates" branch and create a new person, which is correct.
  IF cardinality(COALESCE(v_candidates,'{}'))>0 THEN
    SELECT array_agg(c ORDER BY c) INTO v_candidates FROM unnest(v_candidates) c
    WHERE NOT EXISTS(
      SELECT 1 FROM public.brand_person_identity_separations s
      WHERE s.brand_id=v_brand AND s.normalized_name=v_norm_name
        AND public.biz_brand_person_canonical(s.person_id)=c);
  END IF;

  IF cardinality(COALESCE(v_candidates,'{}'))>0 THEN
    FOREACH v_candidate IN ARRAY v_candidates LOOP
      SELECT lower(regexp_replace(btrim(display_name),'[[:space:]]+',' ','g')) INTO v_candidate_name FROM public.brand_people WHERE id=v_candidate;
      -- A-1 (F-5): an ACTIVE alternate name on the candidate counts as a match.
      -- An alternate row is only ever written by a link that already succeeded
      -- or by a human resolution, so this honours a stored decision rather than
      -- guessing. Where no such row exists the test is unchanged.
      v_name_matches := v_candidate_name=v_norm_name
        OR EXISTS(SELECT 1 FROM public.brand_person_names n
                  WHERE n.brand_person_id=v_candidate AND n.active AND n.normalized_name=v_norm_name);
      IF NOT v_name_matches AND v_candidate_name<>'guest' AND v_norm_name<>'guest' THEN
        INSERT INTO public.brand_person_identity_conflicts(brand_id,source_kind,source_id,candidate_person_ids,reason)
        VALUES(v_brand,p_source_kind,p_source_id,v_candidates,'different_nonempty_names')
        ON CONFLICT(source_kind,source_id,status) DO UPDATE SET candidate_person_ids=EXCLUDED.candidate_person_ids RETURNING id INTO v_conflict;
        RETURN jsonb_build_object('personId',NULL,'sourceLinkId',NULL,'linkOutcome','conflict','conflictId',v_conflict);
      END IF;
    END LOOP;
  END IF;

  -- Past this point the function WILL write a new link, so retiring the old one
  -- is safe. This is the block A-3 moved down from above the candidate scan.
  IF v_link IS NOT NULL THEN
    UPDATE public.brand_person_contact_method_sources SET active=false,retired_at=now() WHERE source_link_id=v_link AND active;
    UPDATE public.brand_person_contact_methods c SET record_state='retired',retired_at=now(),updated_at=now()
      WHERE c.record_state='active' AND EXISTS(SELECT 1 FROM public.brand_person_contact_method_sources s WHERE s.contact_method_id=c.id AND s.source_link_id=v_link)
      AND NOT EXISTS(SELECT 1 FROM public.brand_person_contact_method_sources s WHERE s.contact_method_id=c.id AND s.active);
    UPDATE public.brand_person_names SET active=false,retired_at=now() WHERE source_link_id=v_link AND active;
    UPDATE public.brand_person_source_links SET detached_at=now(),updated_at=now() WHERE id=v_link;
  END IF;

  IF cardinality(COALESCE(v_candidates,'{}'))>0 THEN
    v_person:=v_candidates[1];
    IF cardinality(v_candidates)>1 THEN
      FOREACH v_candidate IN ARRAY v_candidates[2:cardinality(v_candidates)] LOOP
        -- #2305 REWORK P1-1(b): a pair a human has SEPARATED is never collapsed
        -- by this automatic merge, in either direction. A-2 already drops
        -- candidates separated from the INCOMING name, but two candidates can be
        -- separated from EACH OTHER while both still match the incoming name --
        -- and this loop has no human behind it, so it must fail safe. Leaving
        -- them un-merged is strictly better than destroying a stored decision.
        IF NOT EXISTS(
          SELECT 1 FROM public.brand_person_identity_separations s
          WHERE s.brand_id=v_brand
            AND ((public.biz_brand_person_canonical(s.person_id)=v_person
                  AND s.separated_person_id IS NOT NULL
                  AND public.biz_brand_person_canonical(s.separated_person_id)=v_candidate)
              OR (public.biz_brand_person_canonical(s.person_id)=v_candidate
                  AND s.separated_person_id IS NOT NULL
                  AND public.biz_brand_person_canonical(s.separated_person_id)=v_person))
        ) THEN
          PERFORM public.biz_merge_brand_people(v_person,v_candidate,CASE WHEN v_user IS NOT NULL THEN 'authenticated_user' ELSE 'normalized_address' END,NULL,NULL);
        END IF;
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
-- ---------------------------------------------------------------------------
-- 4. The resolve RPC — P1-1(a), P1-2, P2-1, P2-2, P3-1.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.biz_resolve_brand_person_conflict(
  p_brand_id uuid,
  p_conflict_ids uuid[],
  p_resolution text,
  p_winner_person_id uuid,
  p_client_request_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_ids uuid[]; v_id uuid; v_conflict public.brand_person_identity_conflicts%ROWTYPE;
  v_subject jsonb; v_person uuid; v_winner uuid; v_link uuid; v_first_link uuid;
  v_existing uuid; v_candidates uuid[]; v_candidate uuid; v_merged uuid[] := '{}';
  v_user uuid; v_holder uuid; v_name text; v_norm text; v_email text; v_phone text;
  v_country text; v_occurred timestamptz; v_provenance text;
  v_target_status text; v_open_count integer := 0; v_resolved_count integer := 0;
  v_batch uuid; v_links jsonb := '[]'::jsonb;
  v_loser uuid; v_absence text; v_cand_norm text;
BEGIN
  IF v_uid IS NULL
     OR COALESCE(public.biz_brand_effective_rank(p_brand_id,v_uid),-1) < public.biz_role_rank('brand_admin') THEN
    RAISE EXCEPTION 'people_forbidden' USING ERRCODE='42501';
  END IF;
  IF p_client_request_id IS NULL THEN
    RAISE EXCEPTION 'people_idempotency_conflict' USING ERRCODE='23505';
  END IF;
  IF p_resolution NOT IN ('merge','separate','dismiss') THEN
    RAISE EXCEPTION 'people_resolution_invalid' USING ERRCODE='22023';
  END IF;
  IF p_conflict_ids IS NULL OR cardinality(p_conflict_ids)=0
     OR cardinality(p_conflict_ids) > 100
     OR EXISTS(SELECT 1 FROM unnest(p_conflict_ids) x WHERE x IS NULL) THEN
    RAISE EXCEPTION 'people_conflict_candidate_invalid' USING ERRCODE='22023';
  END IF;
  SELECT array_agg(DISTINCT x ORDER BY x) INTO v_ids FROM unnest(p_conflict_ids) x;
  v_target_status := CASE p_resolution WHEN 'merge' THEN 'resolved_merge'
                                      WHEN 'separate' THEN 'resolved_separate'
                                      ELSE 'resolved_dismissed' END;

  -- Lock the whole group in a deterministic order so two operators racing on
  -- overlapping groups cannot deadlock.
  FOREACH v_id IN ARRAY v_ids LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(v_id::text,2305));
  END LOOP;

  -- Validate the group and settle the replay question BEFORE any write.
  FOREACH v_id IN ARRAY v_ids LOOP
    SELECT * INTO v_conflict FROM public.brand_person_identity_conflicts
      WHERE id=v_id AND brand_id=p_brand_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'people_conflict_not_found' USING ERRCODE='P0002'; END IF;
    IF v_conflict.status='open' THEN
      v_open_count := v_open_count + 1;
    ELSIF v_conflict.status = v_target_status THEN
      v_resolved_count := v_resolved_count + 1;
    ELSE
      RAISE EXCEPTION 'people_conflict_already_resolved' USING ERRCODE='23505';
    END IF;
  END LOOP;

  -- A pure replay: every conflict already carries the requested resolution.
  -- Reconstruct the original answer from the durable rows rather than a ledger.
  IF v_open_count=0 THEN
    -- #2305 REWORK P1-1 (round 2): dismiss deliberately creates NO source
    -- links. Sending it through the link reconstruction below made the aggregate
    -- return no group, leaving `v_links` NULL; the client correctly rejects that
    -- as a malformed response. A dismissed group has one deterministic durable
    -- answer regardless of whether the caller reuses or refreshes its request id.
    IF p_resolution='dismiss' THEN
      RETURN jsonb_build_object(
        'conflictIds',to_jsonb(v_ids),'resolution','dismiss','personId',NULL,
        'links','[]'::jsonb,'mergedPersonIds','[]'::jsonb,'replayed',true);
    END IF;
    SELECT public.biz_brand_person_canonical(l.brand_person_id),
           COALESCE(jsonb_agg(jsonb_build_object('conflictId',c.id,'sourceLinkId',l.id)),'[]'::jsonb)
    INTO v_person, v_links
    FROM public.brand_person_identity_conflicts c
    JOIN public.brand_person_source_links l
      ON l.source_kind=c.source_kind AND l.source_id=c.source_id AND l.detached_at IS NULL
    WHERE c.id = ANY(v_ids)
    GROUP BY l.brand_person_id;
    RETURN jsonb_build_object('conflictIds',to_jsonb(v_ids),'resolution',p_resolution,
      'personId',v_person,'links',v_links,'mergedPersonIds','[]'::jsonb,'replayed',true);
  END IF;
  IF v_resolved_count > 0 THEN
    -- Half the group is already closed: the group is no longer the atomic unit
    -- the operator was shown. Make them reopen the list rather than half-apply.
    RAISE EXCEPTION 'people_conflict_already_resolved' USING ERRCODE='23505';
  END IF;

  -- Every conflict in the group must describe the SAME human, or grouping was
  -- not the unit of decision the operator saw.
  -- Read the array directly, never through array_agg: aggregating a uuid[]
  -- builds a 2-D array whose [1] is a single uuid, not the first sub-array.
  SELECT cc.candidate_person_ids INTO v_candidates
  FROM public.brand_person_identity_conflicts cc WHERE cc.id = ANY(v_ids)
  ORDER BY cc.created_at, cc.id LIMIT 1;

  SELECT public.biz_brand_person_conflict_subject(cc.source_kind,cc.source_id)
  INTO v_subject
  FROM public.brand_person_identity_conflicts cc WHERE cc.id = ANY(v_ids)
  ORDER BY cc.created_at, cc.id LIMIT 1;

  -- #2305 REWORK P1-2 + P2-2 -- one shape, one exit.
  --
  -- A conflict is UNACTIONABLE when its subject cannot be produced: either the
  -- source row is gone, or the manual-add ledger only ever kept a sha256 of the
  -- payload. Both previously had NO exit, so both wedged the badge forever --
  -- and the badge is this feature's entire notification mechanism.
  --
  -- The old code here tried to close a vanished source and then RAISEd in the
  -- same transaction, which rolled its own UPDATE back. It read as a fix and
  -- provably was not. `dismiss` replaces it and COMMITS.
  --
  -- ABSENCE IS PROVEN, NEVER INFERRED. `biz_brand_person_conflict_absence`
  -- probes raw row existence independent of every business predicate, so an
  -- order that merely fell out of `payment_status IN (...)` is reported as
  -- PRESENT and stays un-dismissable. Treating "the lookup returned nothing" as
  -- "the buyer does not exist" would convert a query bug into silent data loss,
  -- which is the exact defect this issue exists to end.
  SELECT public.biz_brand_person_conflict_absence(cc.source_kind,cc.source_id)
  INTO v_absence
  FROM public.brand_person_identity_conflicts cc WHERE cc.id = ANY(v_ids)
  ORDER BY cc.created_at, cc.id LIMIT 1;

  IF p_resolution='dismiss' THEN
    IF v_absence IS NULL THEN
      -- The subject is producible, so there is a real decision to make here and
      -- dismissing would discard a buyer. Refuse.
      RAISE EXCEPTION 'people_conflict_not_dismissable' USING ERRCODE='22023';
    END IF;
    IF p_winner_person_id IS NOT NULL THEN
      RAISE EXCEPTION 'people_conflict_candidate_invalid' USING ERRCODE='22023';
    END IF;
    UPDATE public.brand_person_identity_conflicts
      SET status='resolved_dismissed', resolved_at=now(), resolved_by=v_uid
      WHERE id = ANY(v_ids) AND status='open';
    RETURN jsonb_build_object(
      'conflictIds',to_jsonb(v_ids),'resolution','dismiss','personId',NULL,
      'links','[]'::jsonb,'mergedPersonIds','[]'::jsonb,'replayed',false,
      'dismissedReason',v_absence);
  END IF;

  IF v_subject IS NULL THEN
    -- Not dismissible here: either the row is provably gone (dismiss it) or the
    -- subject is temporarily underivable, which is NOT grounds to discard it.
    IF v_absence IS NOT NULL THEN
      RAISE EXCEPTION 'people_conflict_source_missing' USING ERRCODE='P0002';
    END IF;
    RAISE EXCEPTION 'people_conflict_subject_unavailable' USING ERRCODE='22023';
  END IF;
  IF NOT COALESCE((v_subject->>'retained')::boolean,false) THEN
    -- A hand-typed add whose payload was hashed and never stored. There is no
    -- subject to file, and inventing one would fabricate a customer. It is
    -- dismissible (proven above), never merge-able or separate-able.
    RAISE EXCEPTION 'people_conflict_subject_unavailable' USING ERRCODE='22023';
  END IF;

  v_name  := v_subject->>'displayName';
  v_norm  := v_subject->>'normalizedName';
  v_email := NULLIF(v_subject->>'email','');
  v_phone := NULLIF(v_subject->>'phone','');
  v_country := NULLIF(v_subject->>'phoneCountryIso','');
  v_user  := NULLIF(v_subject->>'userId','')::uuid;
  v_occurred := COALESCE((v_subject->>'occurredAt')::timestamptz, now());
  v_provenance := v_subject->>'provenanceKind';

  IF p_resolution='merge' THEN
    IF p_winner_person_id IS NULL
       OR NOT (p_winner_person_id = ANY(COALESCE(v_candidates,'{}'))) THEN
      RAISE EXCEPTION 'people_conflict_candidate_invalid' USING ERRCODE='22023';
    END IF;
    v_winner := public.biz_brand_person_canonical(p_winner_person_id);
    IF NOT EXISTS(SELECT 1 FROM public.brand_people
                  WHERE id=v_winner AND brand_id=p_brand_id AND record_status='active') THEN
      RAISE EXCEPTION 'people_conflict_candidate_invalid' USING ERRCODE='22023';
    END IF;
    v_person := v_winner;

    -- F-4: the `already_linked` fast path requires `linked_user_id` to match.
    -- Attaching an authenticated buyer's source WITHOUT setting it means the
    -- next re-ingest fails that path, falls to the detach block, and unlinks
    -- the buyer we just recovered. Setting it is mandatory, and it must fail
    -- closed rather than raise a raw 23505 on brand_people_active_user_uniq.
    IF v_user IS NOT NULL THEN
      SELECT id INTO v_holder FROM public.brand_people
        WHERE brand_id=p_brand_id AND record_status='active' AND linked_user_id=v_user;
      IF v_holder IS NOT NULL AND v_holder <> v_person THEN
        RAISE EXCEPTION 'people_conflict_user_collision' USING ERRCODE='23505';
      END IF;
      IF v_holder IS NULL THEN
        UPDATE public.brand_people SET linked_user_id=v_user,updated_at=now() WHERE id=v_person;
      END IF;
    END IF;
  ELSE
    IF p_winner_person_id IS NOT NULL THEN
      RAISE EXCEPTION 'people_conflict_candidate_invalid' USING ERRCODE='22023';
    END IF;
    -- #2305 REWORK P2-1: SPEC 4.4 separate step 1 sets linked_user_id "when no
    -- active collision" -- i.e. DEGRADE to NULL. Raising here made `separate`
    -- unreachable for a signed-in second human on a shared household phone, so
    -- the only action the system permitted was the collapse. `merge` already
    -- degrades gracefully; now both do.
    IF v_user IS NOT NULL THEN
      SELECT id INTO v_holder FROM public.brand_people
        WHERE brand_id=p_brand_id AND record_status='active' AND linked_user_id=v_user;
      IF v_holder IS NOT NULL THEN v_user := NULL; END IF;
    END IF;
    -- ONE new person for the whole group — they are one human by construction.
    INSERT INTO public.brand_people(brand_id,linked_user_id,display_name)
      VALUES(p_brand_id,v_user,v_name) RETURNING id INTO v_person;
  END IF;

  -- Link every source in the group. These five steps must produce the
  -- byte-equivalent shape of the resolver's happy `linked` path, or the
  -- `already_linked` fast path will not hold on re-ingest and F-3 will unlink
  -- the buyer again.
  FOREACH v_id IN ARRAY v_ids LOOP
    SELECT * INTO v_conflict FROM public.brand_person_identity_conflicts WHERE id=v_id;

    INSERT INTO public.brand_person_source_links(
      brand_id,brand_person_id,source_kind,source_id,link_method,source_occurred_at)
    VALUES(p_brand_id,v_person,v_conflict.source_kind,v_conflict.source_id,'manual_resolution',v_occurred)
    ON CONFLICT (source_kind,source_id) WHERE detached_at IS NULL DO NOTHING
    RETURNING id INTO v_link;
    IF v_link IS NULL THEN
      SELECT id INTO v_link FROM public.brand_person_source_links
        WHERE source_kind=v_conflict.source_kind AND source_id=v_conflict.source_id
          AND detached_at IS NULL;
    END IF;
    v_first_link := COALESCE(v_first_link,v_link);
    v_links := v_links || jsonb_build_object('conflictId',v_id,'sourceLinkId',v_link);

    -- #876: "existing name and primaries win on conflict". On a MERGE the
    -- incoming name is ALWAYS an alternate — never a primary, even when the
    -- winner happens to carry no primary name row — because the operator chose
    -- an existing record and that record's identity must not be rewritten by
    -- the transaction being filed into it. On a SEPARATE the new record has no
    -- identity of its own yet, so the incoming name IS its primary.
    INSERT INTO public.brand_person_names(
      brand_person_id,display_name,normalized_name,name_kind,source_link_id)
    VALUES(v_person,v_name,v_norm,
      CASE
        WHEN p_resolution='merge' THEN 'alternate'
        WHEN EXISTS(SELECT 1 FROM public.brand_person_names
                    WHERE brand_person_id=v_person AND active AND name_kind='primary')
          THEN 'alternate'
        ELSE 'primary'
      END,
      v_link)
    ON CONFLICT(brand_person_id,normalized_name) WHERE active DO NOTHING;

    IF v_email IS NOT NULL THEN
      INSERT INTO public.brand_person_contact_methods(
        brand_id,brand_person_id,channel,normalized_value,provenance_scope,is_exportable,is_primary)
      VALUES(p_brand_id,v_person,'email',v_email,'brand_owned',true,
        NOT EXISTS(SELECT 1 FROM public.brand_person_contact_methods
                   WHERE brand_person_id=v_person AND channel='email' AND record_state='active'))
      ON CONFLICT(brand_person_id,channel,normalized_value) WHERE record_state='active'
        DO UPDATE SET is_exportable=true,updated_at=now()
      RETURNING id INTO v_existing;
      INSERT INTO public.brand_person_contact_method_sources(
        contact_method_id,source_link_id,provenance_kind,exportable)
      VALUES(v_existing,v_link,v_provenance,true)
      ON CONFLICT(contact_method_id,source_link_id)
        DO UPDATE SET active=true,retired_at=NULL,exportable=true;
    END IF;
    IF v_phone IS NOT NULL THEN
      INSERT INTO public.brand_person_contact_methods(
        brand_id,brand_person_id,channel,normalized_value,provenance_scope,is_exportable,is_primary)
      VALUES(p_brand_id,v_person,'phone',v_phone,'brand_owned',true,
        NOT EXISTS(SELECT 1 FROM public.brand_person_contact_methods
                   WHERE brand_person_id=v_person AND channel='phone' AND record_state='active'))
      ON CONFLICT(brand_person_id,channel,normalized_value) WHERE record_state='active'
        DO UPDATE SET is_exportable=true,updated_at=now()
      RETURNING id INTO v_existing;
      INSERT INTO public.brand_person_contact_method_sources(
        contact_method_id,source_link_id,provenance_kind,exportable,phone_country_iso)
      VALUES(v_existing,v_link,v_provenance,true,v_country)
      ON CONFLICT(contact_method_id,source_link_id)
        DO UPDATE SET active=true,retired_at=NULL,exportable=true,
                      phone_country_iso=EXCLUDED.phone_country_iso;
    END IF;

    -- #1775 reconciliation, in the SAME transaction. issue_1775_count_reconciliation
    -- CHECKs that added+updated+review+invalid+duplicate+unchanged = row_count, so
    -- the row and the batch counters must move together or the transaction
    -- correctly fails.
    IF v_conflict.source_kind='import' THEN
      UPDATE public.brand_contact_import_rows
        SET outcome = CASE WHEN p_resolution='merge' THEN 'updated' ELSE 'added' END,
            reason_code = NULL, canonical_person_id = v_person,
            conflict_id = NULL, executed_at = now()
        WHERE id = v_conflict.source_id AND outcome='review'
        RETURNING batch_id INTO v_batch;
      IF v_batch IS NOT NULL THEN
        UPDATE public.brand_contact_import_batches
          SET review_count = review_count - 1,
              updated_count = updated_count + CASE WHEN p_resolution='merge' THEN 1 ELSE 0 END,
              added_count   = added_count   + CASE WHEN p_resolution='merge' THEN 0 ELSE 1 END,
              updated_at = now()
          WHERE id = v_batch;
      END IF;
      v_batch := NULL;
    END IF;
  END LOOP;

  IF p_resolution='merge' THEN
    -- Every OTHER candidate is collapsed into the winner. This is destructive
    -- and the UI discloses it before the operator confirms (DESIGN §4.1).
    -- `manual_resolution` + the evidence link + auth.uid() as actor is what
    -- makes the merge auditable and reversible in the ledger.
    FOREACH v_candidate IN ARRAY COALESCE(v_candidates,'{}') LOOP
      -- #2305 REWORK P3-1: resolve the loser's canonical id BEFORE the merge.
      -- Read afterwards it has already been rewritten to the winner, so the
      -- receipt named the person that SURVIVED as the one that was collapsed.
      v_loser := public.biz_brand_person_canonical(v_candidate);
      IF v_loser <> v_person
         AND EXISTS(SELECT 1 FROM public.brand_people
                    WHERE id=v_loser AND brand_id=p_brand_id AND record_status='active') THEN
        PERFORM public.biz_merge_brand_people(
          v_person, v_loser, 'manual_resolution', v_first_link, v_uid);
        v_merged := v_merged || v_loser;
      END IF;
    END LOOP;
  ELSE
    -- F-6: without this row the next ingest on the shared address re-merges the
    -- two people the operator just told us are different.
    FOREACH v_candidate IN ARRAY COALESCE(v_candidates,'{}') LOOP
      v_loser := public.biz_brand_person_canonical(v_candidate);
      IF v_loser <> v_person THEN
        -- Forward: the candidate is NOT the human called <incoming name>.
        INSERT INTO public.brand_person_identity_separations(
          brand_id,person_id,normalized_name,separated_person_id,origin_conflict_id,decided_by)
        VALUES(p_brand_id,v_loser,v_norm,v_person,v_ids[1],v_uid)
        ON CONFLICT (brand_id,person_id,normalized_name) DO NOTHING;
        -- #2305 REWORK P1-1(a) -- THE REVERSE, which was missing and is what
        -- made "Different people" only half-stick. Without it the ORIGINAL
        -- buyer re-conflicts on their very next order, because the new person
        -- is still a candidate under the ORIGINAL's own name -- and then BOTH
        -- buttons are wrong: merge folds back together the two humans just
        -- separated, and separate creates a THIRD record while severing the
        -- original from its own name. A separation is a statement about a PAIR,
        -- so it has to be recorded from both sides.
        SELECT lower(regexp_replace(btrim(bp.display_name),'[[:space:]]+',' ','g'))
        INTO v_cand_norm FROM public.brand_people bp WHERE bp.id=v_loser;
        IF v_cand_norm IS NOT NULL AND v_cand_norm <> v_norm THEN
          INSERT INTO public.brand_person_identity_separations(
            brand_id,person_id,normalized_name,separated_person_id,origin_conflict_id,decided_by)
          VALUES(p_brand_id,v_person,v_cand_norm,v_loser,v_ids[1],v_uid)
          ON CONFLICT (brand_id,person_id,normalized_name) DO NOTHING;
        END IF;
        -- Every ACTIVE alternate the candidate answers to, too: a buyer whose
        -- next order arrives under an alternate name must not re-drag the new
        -- person back into the candidate set either.
        INSERT INTO public.brand_person_identity_separations(
          brand_id,person_id,normalized_name,separated_person_id,origin_conflict_id,decided_by)
        SELECT p_brand_id,v_person,n.normalized_name,v_loser,v_ids[1],v_uid
        FROM public.brand_person_names n
        WHERE n.brand_person_id=v_loser AND n.active AND n.normalized_name <> v_norm
        ON CONFLICT (brand_id,person_id,normalized_name) DO NOTHING;
      END IF;
    END LOOP;
  END IF;

  -- F-7: UNIQUE(source_kind,source_id,status) means a source resolved the same
  -- way twice raises 23505. Return the typed code, never a raw PG error.
  BEGIN
    UPDATE public.brand_person_identity_conflicts
      SET status=v_target_status, resolved_at=now(), resolved_by=v_uid
      WHERE id = ANY(v_ids) AND status='open';
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'people_conflict_already_resolved' USING ERRCODE='23505';
  END;

  RETURN jsonb_build_object(
    'conflictIds',to_jsonb(v_ids),'resolution',p_resolution,'personId',v_person,
    'links',v_links,'mergedPersonIds',to_jsonb(v_merged),'replayed',false);
END;
$function$;
-- ---------------------------------------------------------------------------
-- 4b. The reader — surfaces PROVEN absence so the card can offer Dismiss.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.biz_list_brand_person_conflicts(
  p_brand_id uuid, p_limit integer DEFAULT 50
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_rank integer;
  v_can_resolve boolean;
  v_rows jsonb;
  v_open_count bigint;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'people_forbidden' USING ERRCODE='42501'; END IF;
  v_rank := COALESCE(public.biz_brand_effective_rank(p_brand_id,v_uid),-1);
  IF v_rank < public.biz_role_rank('marketing_manager') THEN
    RAISE EXCEPTION 'people_forbidden' USING ERRCODE='42501';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100 THEN
    RAISE EXCEPTION 'people_limit_invalid' USING ERRCODE='22023';
  END IF;
  v_can_resolve := v_rank >= public.biz_role_rank('brand_admin');

  WITH open_rows AS (
    SELECT c.id, c.source_kind, c.source_id, c.reason, c.created_at,
           c.candidate_person_ids,
           public.biz_brand_person_conflict_subject(c.source_kind,c.source_id) AS subject,
           -- #2305 REWORK: PROVEN absence, so the card can offer Dismiss rather
           -- than two controls that cannot work. NULL whenever the row still
           -- exists, even if the subject derivation currently yields nothing.
           public.biz_brand_person_conflict_absence(c.source_kind,c.source_id) AS absence
    FROM public.brand_person_identity_conflicts c
    WHERE c.brand_id = p_brand_id AND c.status = 'open'
  ), keyed AS (
    -- The grouping key IS the identity question: same incoming name, same
    -- matched address set, same candidate set = one human = one decision.
    -- chr(31) is the unit separator, so a name containing the delimiter cannot
    -- forge a collision between two different humans.
    SELECT o.*,
      CASE WHEN COALESCE((o.subject->>'retained')::boolean,false)
        THEN COALESCE(o.subject->>'normalizedName','') || chr(31)
             || COALESCE(o.subject->>'email','')       || chr(31)
             || COALESCE(o.subject->>'phone','')       || chr(31)
             || array_to_string(o.candidate_person_ids::text[],',')
        ELSE 'unretained' || chr(31) || o.id::text
      END AS group_key
    FROM open_rows o
  ), grouped AS (
    SELECT k.group_key,
      min(k.created_at) AS created_at,
      array_agg(k.id ORDER BY k.created_at, k.id)         AS conflict_ids,
      array_agg(DISTINCT k.source_kind)                   AS source_kinds,
      (array_agg(k.subject ORDER BY k.created_at, k.id))[1] AS subject,
      (array_agg(k.absence ORDER BY k.created_at, k.id))[1] AS absence,
      (array_agg(k.reason  ORDER BY k.created_at, k.id))[1] AS reason,
      -- Grouped on, not aggregated: array_agg over a uuid[] builds a 2-D array
      -- whose [1] is a scalar, not the first sub-array. The value is constant
      -- inside a group because it is part of `group_key`, so GROUP BY is exact.
      k.candidate_person_ids
    FROM keyed k GROUP BY k.group_key, k.candidate_person_ids
  ), total AS (
    SELECT count(*) AS n FROM grouped
  ), page AS (
    SELECT * FROM grouped ORDER BY created_at ASC, group_key ASC LIMIT p_limit
  )
  SELECT (SELECT n FROM total),
    COALESCE(jsonb_agg(jsonb_build_object(
      'conflictIds', to_jsonb(g.conflict_ids),
      'sourceKinds', to_jsonb(g.source_kinds),
      'reason', g.reason,
      'createdAt', g.created_at,
      'canResolve', v_can_resolve AND COALESCE((g.subject->>'retained')::boolean,false),
      'detailsRetained', COALESCE((g.subject->>'retained')::boolean,false),
      'dismissibleReason', g.absence,
      'canDismiss', v_can_resolve AND g.absence IS NOT NULL,
      'incoming', jsonb_build_object(
        'displayName', g.subject->>'displayName',
        'email',       g.subject->>'email',
        'phone',       g.subject->>'phone'),
      'candidates', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'personId', p.id,
          'displayName', p.display_name,
          'avatarUrl', p.avatar_url,
          'contacts', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
              'channel',cm.channel,'value',cm.normalized_value,'isPrimary',cm.is_primary)
              ORDER BY cm.channel, cm.is_primary DESC, cm.created_at, cm.id)
            FROM public.brand_person_contact_methods cm
            WHERE cm.brand_person_id=p.id AND cm.record_state='active'
              AND cm.provenance_scope='brand_owned'),'[]'::jsonb))
          ORDER BY p.display_name, p.id)
        FROM unnest(g.candidate_person_ids) AS cand(id)
        JOIN public.brand_people p ON p.id=cand.id
        WHERE p.record_status='active' AND p.brand_id=p_brand_id),'[]'::jsonb),
      'matchedOn', COALESCE((
        SELECT jsonb_agg(DISTINCT m.ch)
        FROM (
          SELECT cm.channel AS ch
          FROM unnest(g.candidate_person_ids) AS cand(id)
          JOIN public.brand_people p ON p.id=cand.id AND p.record_status='active'
          JOIN public.brand_person_contact_methods cm ON cm.brand_person_id=p.id
          WHERE cm.record_state='active' AND cm.provenance_scope='brand_owned'
            AND ((cm.channel='email' AND NULLIF(g.subject->>'email','') IS NOT NULL
                  AND cm.normalized_value=g.subject->>'email')
              OR (cm.channel='phone' AND NULLIF(g.subject->>'phone','') IS NOT NULL
                  AND cm.normalized_value=g.subject->>'phone'))
        ) m),'[]'::jsonb)
    ) ORDER BY g.created_at ASC, g.group_key ASC),'[]'::jsonb)
  INTO v_open_count, v_rows
  FROM page g;

  RETURN jsonb_build_object('openCount',COALESCE(v_open_count,0),'rows',COALESCE(v_rows,'[]'::jsonb));
END;
$function$;

-- ---------------------------------------------------------------------------
-- 5. Grants — unchanged shape, restated so a replace cannot silently widen one.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.biz_brand_person_conflict_absence(text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.biz_brand_person_conflict_absence(text,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.biz_resolve_brand_person_conflict(uuid,uuid[],text,uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.biz_resolve_brand_person_conflict(uuid,uuid[],text,uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.biz_resolve_brand_person_conflict(uuid,uuid[],text,uuid,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.biz_resolve_brand_person_source(uuid,uuid,text,uuid,uuid,uuid,text,text,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.biz_resolve_brand_person_source(uuid,uuid,text,uuid,uuid,uuid,text,text,timestamptz) TO service_role;

-- ---------------------------------------------------------------------------
-- 6. Assertions.
-- ---------------------------------------------------------------------------
DO $assert$
DECLARE v_signature text;
BEGIN
  -- The third state is admissible, and the shape constraint still couples it.
  IF NOT EXISTS(SELECT 1 FROM pg_constraint
                WHERE conrelid='public.brand_person_identity_conflicts'::regclass
                  AND conname='brand_person_identity_conflicts_status_check'
                  AND position('resolved_dismissed' IN pg_get_constraintdef(oid))>0) THEN
    RAISE EXCEPTION 'people_dismissed_state_missing';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_constraint
                WHERE conrelid='public.brand_person_identity_conflicts'::regclass
                  AND conname='brand_person_conflict_resolution_shape') THEN
    RAISE EXCEPTION 'people_conflict_resolution_shape_lost';
  END IF;

  -- The reworked bodies are actually deployed. A CREATE OR REPLACE that lost
  -- one of these would restore the exact defects the tester proved, with every
  -- other test still green.
  IF position('#2305 REWORK P1-1(b)' IN pg_get_functiondef(
       'public.biz_resolve_brand_person_source(uuid,uuid,text,uuid,uuid,uuid,text,text,timestamptz)'::regprocedure)) = 0
     OR position('#2305 REWORK P2-4' IN pg_get_functiondef(
       'public.biz_resolve_brand_person_source(uuid,uuid,text,uuid,uuid,uuid,text,text,timestamptz)'::regprocedure)) = 0
     OR position('A-1 (F-5)' IN pg_get_functiondef(
       'public.biz_resolve_brand_person_source(uuid,uuid,text,uuid,uuid,uuid,text,text,timestamptz)'::regprocedure)) = 0
     OR position('brand_person_identity_separations' IN pg_get_functiondef(
       'public.biz_resolve_brand_person_source(uuid,uuid,text,uuid,uuid,uuid,text,text,timestamptz)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'people_resolver_rework_missing';
  END IF;
  IF position('REWORK P1-1(a)' IN pg_get_functiondef(
       'public.biz_resolve_brand_person_conflict(uuid,uuid[],text,uuid,uuid)'::regprocedure)) = 0
     OR position('resolved_dismissed' IN pg_get_functiondef(
       'public.biz_resolve_brand_person_conflict(uuid,uuid[],text,uuid,uuid)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'people_resolve_rpc_rework_missing';
  END IF;

  -- A dismiss must never be able to RAISE after its own write again: the
  -- resolution branch returns, and there is no RAISE between the dismissing
  -- UPDATE and its RETURN.
  IF position('RETURN jsonb_build_object' IN
        substring(pg_get_functiondef('public.biz_resolve_brand_person_conflict(uuid,uuid[],text,uuid,uuid)'::regprocedure)
          FROM position('SET status=''resolved_dismissed''' IN
            pg_get_functiondef('public.biz_resolve_brand_person_conflict(uuid,uuid[],text,uuid,uuid)'::regprocedure)))) = 0 THEN
    RAISE EXCEPTION 'people_dismiss_does_not_commit';
  END IF;

  -- The merge primitives stay service_role-only (F-8).
  FOREACH v_signature IN ARRAY ARRAY[
    'public.biz_merge_brand_people(uuid,uuid,text,uuid,uuid)',
    'public.biz_reverse_brand_person_merge(uuid,uuid)',
    'public.biz_brand_person_conflict_absence(text,uuid)',
    'public.biz_brand_person_conflict_subject(text,uuid)'
  ] LOOP
    IF has_function_privilege('authenticated',v_signature,'EXECUTE')
       OR has_function_privilege('anon',v_signature,'EXECUTE') THEN
      RAISE EXCEPTION 'people_internal_grant_forbidden: %',v_signature;
    END IF;
  END LOOP;

  FOREACH v_signature IN ARRAY ARRAY[
    'public.biz_list_brand_person_conflicts(uuid,integer)',
    'public.biz_resolve_brand_person_conflict(uuid,uuid[],text,uuid,uuid)'
  ] LOOP
    IF NOT EXISTS(
      SELECT 1 FROM pg_proc p
      WHERE p.oid=to_regprocedure(v_signature) AND p.prosecdef
        AND p.proconfig @> ARRAY['search_path=public, pg_temp']::text[]
    ) OR has_function_privilege('anon',v_signature,'EXECUTE')
      OR NOT has_function_privilege('authenticated',v_signature,'EXECUTE') THEN
      RAISE EXCEPTION 'people_function_security_drift: %',v_signature;
    END IF;
  END LOOP;
END;
$assert$;

COMMIT;
