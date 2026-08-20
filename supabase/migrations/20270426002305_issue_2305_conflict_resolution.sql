-- Issue #2305 — the identity-conflict review queue and the resolve path.
--
-- `brand_person_identity_conflicts` shipped in 20270305001770 with ten INSERT
-- sites across four ingest paths, a three-state CHECK, a `resolved_by` FK, and
-- `brand_person_conflict_resolution_shape` coupling `status` to `resolved_at`.
-- Nothing ever read it, nothing ever advanced it, and the conflict branch of
-- `biz_resolve_brand_person_source` returns WITHOUT writing a source link — so a
-- paying buyer whose name differs from a record already holding their email or
-- phone is filed into a landfill and dropped from the brand's contact book.
--
-- This migration builds the missing half:
--   1. `brand_person_identity_separations` — the durable record of a human's
--      "these are different people" decision (F-6).
--   2. Four localized amendments to `biz_resolve_brand_person_source`
--      (A-1..A-4 below) so a resolved conflict STAYS resolved.
--   3. `biz_brand_person_conflict_subject` — the shared derivation of the
--      incoming identity, so what the operator compares is what the matcher
--      compared.
--   4. `biz_list_brand_person_conflicts` (rank 20) — the reader.
--   5. `biz_resolve_brand_person_conflict` (rank 50) — the writer that ADVANCES
--      the status AND links the source.
--
-- The refusal to auto-merge two different names is #876's contract and is NOT
-- weakened here. A-1 only teaches the matcher to honour a decision a human
-- already made and stored; where no such decision exists the behaviour is
-- byte-identical to today.
--
-- `biz_merge_brand_people` and `biz_reverse_brand_person_merge` keep their
-- bodies and their `service_role`-only grants. Both take `p_actor` as a
-- PARAMETER and perform no authorization of their own, so granting either to
-- `authenticated` would let any user merge any two people in any brand while
-- attributing it to someone else. The new resolve RPC is the gated wrapper.
--
-- NO ROW IN `brand_person_identity_conflicts` IS MUTATED BY THIS MIGRATION.
-- The live open conflicts are resolved by a human through the shipped UI; that
-- is the acceptance run, and `issue-2305-status-table-has-a-resolver.mjs` G-3
-- fails the build if any migration ever tries to resolve them as data.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The separation ledger (F-6).
-- ---------------------------------------------------------------------------
-- Semantics: "person `person_id` is known NOT to be the human who calls
-- themselves `normalized_name`, despite sharing an email or phone with them."
--
-- Without this, `resolved_separate` undoes itself: once two people share an
-- address every later ingest returns BOTH as candidates, and if their names
-- match the chain-merge at the end of `biz_resolve_brand_person_source` folds
-- them back together silently, destroying the human's decision with no prompt.

CREATE TABLE IF NOT EXISTS public.brand_person_identity_separations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE RESTRICT,
  person_id uuid NOT NULL REFERENCES public.brand_people(id) ON DELETE RESTRICT,
  normalized_name text NOT NULL CHECK (length(btrim(normalized_name)) > 0),
  separated_person_id uuid NULL REFERENCES public.brand_people(id) ON DELETE RESTRICT,
  origin_conflict_id uuid NOT NULL REFERENCES public.brand_person_identity_conflicts(id) ON DELETE RESTRICT,
  decided_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT brand_person_separation_not_self
    CHECK (separated_person_id IS NULL OR separated_person_id <> person_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS brand_person_separations_uniq
  ON public.brand_person_identity_separations(brand_id, person_id, normalized_name);
CREATE INDEX IF NOT EXISTS brand_person_separations_person_idx
  ON public.brand_person_identity_separations(person_id);

ALTER TABLE public.brand_person_identity_separations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.brand_person_identity_separations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.brand_person_identity_separations TO service_role;

COMMENT ON TABLE public.brand_person_identity_separations IS
  '#2305 — a human decided these two are different humans despite a shared '
  'email or phone. Consulted by biz_resolve_brand_person_source before the '
  'conflict test AND before the chain-merge, so the decision is durable. RLS '
  'enabled with zero policies and zero client grants, matching every sibling '
  'People table: access is exclusively via SECURITY DEFINER RPC.';

-- ---------------------------------------------------------------------------
-- 2. `biz_resolve_brand_person_source` — four localized amendments.
-- ---------------------------------------------------------------------------
-- Replacement is based on the LIVE production body, which is 20270327001773's
-- definition (the one carrying `phone_country_iso`), NOT 20270305001770's.
--
--   A-1 (F-5) the name test consults ACTIVE ALTERNATE NAMES, not just
--       `brand_people.display_name`. Resolving `Seth O` -> `Seth Nosakhare
--       Ogieva` writes `Seth O` as an alternate; without A-1 the buyer's NEXT
--       order sees `display_name` still differing and conflicts AGAIN, forever.
--       One queue item per order. This is why the queue would never empty.
--
--   A-2 (F-6) candidates a human SEPARATED from this name are dropped BEFORE
--       the conflict test and before the chain-merge. The second half is the
--       point: the chain-merge would otherwise silently re-merge two people a
--       human deliberately separated.
--
--   A-3 (F-3) the detach block no longer runs on the way INTO a conflict.
--       Candidates and the conflict decision are computed FIRST; the old link is
--       retired only once the function is committed to writing a new one. Before
--       this, a re-ingested conflicting source was first UNLINKED from its
--       person and then abandoned — a buyer already in the book could be
--       REMOVED from it by a later ingest of their own order. That path is
--       dormant today only because no two people have been merged yet; the
--       merge button #2305 builds is exactly what arms it.
--
--   A-4 order of operations: A-2, then A-1, then the existing test; A-3
--       restructures around them. No other statement in the function changes.

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
  v_name_matches boolean;
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

  -- A-3 (F-3): the detach block that used to sit HERE now runs after the
  -- conflict decision. Everything between here and the detach is read-only, so
  -- a conflicting re-ingest leaves an existing link exactly as it was.
  IF p_validated_invite_id IS NOT NULL THEN v_link_method:='invite_token'; ELSIF v_user IS NOT NULL THEN v_link_method:='authenticated_user'; END IF;
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

-- ---------------------------------------------------------------------------
-- 3. The shared subject derivation.
-- ---------------------------------------------------------------------------
-- The list RPC and the resolve RPC BOTH derive the incoming identity through
-- this one function, using the same expressions `biz_resolve_brand_person_source`
-- uses, so what the operator compares is exactly what the matcher compared.
--
-- `retained=false` is returned for `source_kind='manual'`. That is not a bug in
-- this function: `brand_person_manual_add_requests` persists only a sha256
-- `request_hash` of the payload — it has no name, email or phone column — so the
-- incoming identity of a hand-typed add is UNRECOVERABLE. SPEC §4.3 assumed
-- otherwise. A manual conflict is therefore surfaced honestly (it is not hidden)
-- and marked unresolvable rather than described with invented values.

CREATE OR REPLACE FUNCTION public.biz_brand_person_conflict_subject(
  p_source_kind text, p_source_id uuid
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp
AS $function$
DECLARE
  v_brand uuid; v_user uuid; v_name text; v_email text; v_phone text;
  v_country text; v_occurred timestamptz; v_provenance text;
BEGIN
  IF p_source_kind='event_rsvp' THEN
    SELECT e.brand_id,r.user_id,COALESCE(NULLIF(btrim(r.guest_name),''),'Guest'),
      public.issue_1770_normalize_email(r.guest_email),public.issue_1770_normalize_phone(r.guest_phone),
      r.guest_phone_country_iso,r.created_at,'rsvp'
    INTO v_brand,v_user,v_name,v_email,v_phone,v_country,v_occurred,v_provenance
    FROM public.event_rsvps r JOIN public.events e ON e.id=r.event_id WHERE r.id=p_source_id;
  ELSIF p_source_kind='rsvp_plus_one' THEN
    SELECT e.brand_id,g.matched_user_id,btrim(g.name),public.issue_1770_normalize_email(g.email),
      public.issue_1770_normalize_phone(g.phone),g.phone_country_iso,g.created_at,'rsvp'
    INTO v_brand,v_user,v_name,v_email,v_phone,v_country,v_occurred,v_provenance
    FROM public.event_rsvp_guests g JOIN public.event_rsvps r ON r.id=g.rsvp_id
    JOIN public.events e ON e.id=r.event_id WHERE g.id=p_source_id;
  ELSIF p_source_kind='order' THEN
    SELECT e.brand_id,o.buyer_user_id,COALESCE(NULLIF(btrim(o.buyer_name),''),'Guest'),
      public.issue_1770_normalize_email(o.buyer_email),
      public.issue_1770_normalize_phone(COALESCE(o.buyer_phone_e164,o.buyer_phone)),NULL,o.created_at,'order'
    INTO v_brand,v_user,v_name,v_email,v_phone,v_country,v_occurred,v_provenance
    FROM public.orders o JOIN public.events e ON e.id=o.event_id
    WHERE o.id=p_source_id AND o.confirmed_at IS NOT NULL
      AND o.payment_status IN ('paid','partial_refund','refunded','cancelled');
  ELSIF p_source_kind='ticket_holder' THEN
    SELECT e.brand_id,o.buyer_user_id,COALESCE(NULLIF(btrim(o.buyer_name),''),'Guest'),
      public.issue_1770_normalize_email(o.buyer_email),
      public.issue_1770_normalize_phone(COALESCE(o.buyer_phone_e164,o.buyer_phone)),NULL,o.created_at,'ticket'
    INTO v_brand,v_user,v_name,v_email,v_phone,v_country,v_occurred,v_provenance
    FROM public.tickets t JOIN public.orders o ON o.id=t.order_id JOIN public.events e ON e.id=t.event_id
    WHERE t.id=p_source_id AND o.confirmed_at IS NOT NULL
      AND o.payment_status IN ('paid','partial_refund','refunded','cancelled');
  ELSIF p_source_kind='reservation' THEN
    SELECT r.brand_id,r.consumer_user_id,COALESCE(NULLIF(btrim(r.guest_name),''),'Guest'),
      public.issue_1770_normalize_email(r.guest_email),
      public.issue_1770_normalize_phone(NULLIF(btrim(r.guest_phone_e164),'')),
      r.guest_phone_country_iso,r.created_at,'reservation'
    INTO v_brand,v_user,v_name,v_email,v_phone,v_country,v_occurred,v_provenance
    FROM public.reservations r WHERE r.id=p_source_id;
  ELSIF p_source_kind='stay_reservation' THEN
    SELECT g.brand_id,g.user_id,COALESCE(NULLIF(btrim(g.guest_snapshot->>'name'),''),'Guest'),
      public.issue_1770_normalize_email(g.guest_snapshot->>'email'),
      public.issue_1770_normalize_phone(NULLIF(btrim(g.guest_snapshot->>'phone'),'')),
      NULLIF(g.guest_snapshot->>'phoneCountryIso',''),min(e.created_at),'reservation'
    INTO v_brand,v_user,v_name,v_email,v_phone,v_country,v_occurred,v_provenance
    FROM public.stay_reservation_groups g JOIN public.stay_reservation_events e ON e.group_id=g.id
    WHERE g.id=p_source_id AND e.event_type='stay_reservation_confirmed'
    GROUP BY g.id,g.brand_id,g.user_id,g.guest_snapshot;
  ELSIF p_source_kind='import' THEN
    SELECT b.brand_id,NULL::uuid,COALESCE(NULLIF(btrim(r.name),''),'Guest'),
      public.issue_1770_normalize_email(r.email),public.issue_1770_normalize_phone(r.phone_e164),
      r.phone_country,r.created_at,'import'
    INTO v_brand,v_user,v_name,v_email,v_phone,v_country,v_occurred,v_provenance
    FROM public.brand_contact_import_rows r
    JOIN public.brand_contact_import_batches b ON b.id=r.batch_id
    WHERE r.id=p_source_id;
  ELSIF p_source_kind='manual' THEN
    -- The payload was hashed, never stored. Report the row, describe nothing.
    SELECT m.brand_id,m.actor_user_id,m.created_at INTO v_brand,v_user,v_occurred
    FROM public.brand_person_manual_add_requests m WHERE m.client_request_id=p_source_id;
    IF v_brand IS NULL THEN RETURN NULL; END IF;
    RETURN jsonb_build_object(
      'retained',false,'brandId',v_brand,'displayName',NULL,'normalizedName',NULL,
      'email',NULL,'phone',NULL,'phoneCountryIso',NULL,'userId',NULL,
      'occurredAt',v_occurred,'provenanceKind','manual');
  ELSE
    RETURN NULL;
  END IF;

  IF v_brand IS NULL THEN RETURN NULL; END IF;
  RETURN jsonb_build_object(
    'retained',true,'brandId',v_brand,'displayName',v_name,
    'normalizedName',lower(regexp_replace(btrim(v_name),'[[:space:]]+',' ','g')),
    'email',v_email,'phone',v_phone,'phoneCountryIso',v_country,'userId',v_user,
    'occurredAt',v_occurred,'provenanceKind',v_provenance);
END;
$function$;

COMMENT ON FUNCTION public.biz_brand_person_conflict_subject(text,uuid) IS
  '#2305 — the incoming identity behind a conflict, derived with the SAME '
  'expressions biz_resolve_brand_person_source uses so the operator compares '
  'what the matcher compared. Returns retained=false for source_kind=manual: '
  'brand_person_manual_add_requests stores only a sha256 of the payload, so a '
  'hand-typed add''s identity is unrecoverable and must never be invented.';

-- ---------------------------------------------------------------------------
-- 4. The reader — rank 20.
-- ---------------------------------------------------------------------------
-- GROUPED, per the orchestrator's DESIGN REVIEW decision 1. One card per human,
-- one decision. Production carries 11 open conflicts resolving to just 3
-- distinct candidate sets, and one buyer accounts for 5 rows alone; listing per
-- source would ask an operator the identical identity question five times with
-- nothing preventing five different answers. The end state that produces — one
-- human simultaneously filed under an existing person, duplicated as a new one,
-- AND carrying a separation row that permanently blocks the correct future link
-- — is worse than the bug this issue fixes. Grouping makes it impossible by
-- construction.
--
-- Read sits at rank 20 because `biz_get_brand_person` already returns a
-- person's full email and phone at rank 20; putting the queue at 50 would mean
-- a marketing_manager can see every contact in the book but not see WHICH buyer
-- is missing from it.

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
           public.biz_brand_person_conflict_subject(c.source_kind,c.source_id) AS subject
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

COMMENT ON FUNCTION public.biz_list_brand_person_conflicts(uuid,integer) IS
  '#2305 — the READER that brand_person_identity_conflicts never had. Groups '
  'open conflicts into one row per human (same incoming name, same matched '
  'address set, same candidate set) so one decision closes all of that buyer''s '
  'sources at once. openCount counts GROUPS, not rows: the strip says "buyers". '
  'Candidate contacts are filtered to brand_owned + active — the identical '
  'Ring-1 filter biz_get_brand_people_book uses, so graph-only data can never '
  'surface here. Rank 20 (marketing_manager).';

-- ---------------------------------------------------------------------------
-- 5. The writer — rank 50.
-- ---------------------------------------------------------------------------
-- Resolves a GROUP of conflicts in ONE transaction: all of them, or none.
--
-- Rank 50 (brand_admin) because this is the only client-reachable path to
-- `biz_merge_brand_people`, and collapsing two full records is a superset of
-- the rank-50 export action.
--
-- The source link written in step 3 is the whole point. A conflict marked
-- `resolved_*` with no active source link is a FALSE RESOLUTION: the queue
-- empties, the operator believes the buyer is filed, and the buyer is still
-- gone. That is invariant I-PROPOSED-2305-RESOLUTION-MUST-LINK-THE-SOURCE.

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
BEGIN
  IF v_uid IS NULL
     OR COALESCE(public.biz_brand_effective_rank(p_brand_id,v_uid),-1) < public.biz_role_rank('brand_admin') THEN
    RAISE EXCEPTION 'people_forbidden' USING ERRCODE='42501';
  END IF;
  IF p_client_request_id IS NULL THEN
    RAISE EXCEPTION 'people_idempotency_conflict' USING ERRCODE='23505';
  END IF;
  IF p_resolution NOT IN ('merge','separate') THEN
    RAISE EXCEPTION 'people_resolution_invalid' USING ERRCODE='22023';
  END IF;
  IF p_conflict_ids IS NULL OR cardinality(p_conflict_ids)=0
     OR cardinality(p_conflict_ids) > 100
     OR EXISTS(SELECT 1 FROM unnest(p_conflict_ids) x WHERE x IS NULL) THEN
    RAISE EXCEPTION 'people_conflict_candidate_invalid' USING ERRCODE='22023';
  END IF;
  SELECT array_agg(DISTINCT x ORDER BY x) INTO v_ids FROM unnest(p_conflict_ids) x;
  v_target_status := CASE WHEN p_resolution='merge' THEN 'resolved_merge' ELSE 'resolved_separate' END;

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

  IF v_subject IS NULL THEN
    -- The source row vanished. Close the group so it cannot wedge the queue
    -- forever, and tell the caller what happened.
    UPDATE public.brand_person_identity_conflicts
      SET status='resolved_separate',resolved_at=now(),resolved_by=v_uid
      WHERE id = ANY(v_ids) AND status='open';
    RAISE EXCEPTION 'people_conflict_source_missing' USING ERRCODE='P0002';
  END IF;
  IF NOT COALESCE((v_subject->>'retained')::boolean,false) THEN
    -- A hand-typed add whose payload was hashed and never stored. There is no
    -- subject to file, and inventing one would fabricate a customer.
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
    IF v_user IS NOT NULL THEN
      SELECT id INTO v_holder FROM public.brand_people
        WHERE brand_id=p_brand_id AND record_status='active' AND linked_user_id=v_user;
      IF v_holder IS NOT NULL THEN
        RAISE EXCEPTION 'people_conflict_user_collision' USING ERRCODE='23505';
      END IF;
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
      IF public.biz_brand_person_canonical(v_candidate) <> v_person
         AND EXISTS(SELECT 1 FROM public.brand_people
                    WHERE id=public.biz_brand_person_canonical(v_candidate)
                      AND brand_id=p_brand_id AND record_status='active') THEN
        PERFORM public.biz_merge_brand_people(
          v_person, public.biz_brand_person_canonical(v_candidate),
          'manual_resolution', v_first_link, v_uid);
        v_merged := v_merged || public.biz_brand_person_canonical(v_candidate);
      END IF;
    END LOOP;
  ELSE
    -- F-6: without this row the next ingest on the shared address re-merges the
    -- two people the operator just told us are different.
    FOREACH v_candidate IN ARRAY COALESCE(v_candidates,'{}') LOOP
      IF public.biz_brand_person_canonical(v_candidate) <> v_person THEN
        INSERT INTO public.brand_person_identity_separations(
          brand_id,person_id,normalized_name,separated_person_id,origin_conflict_id,decided_by)
        VALUES(p_brand_id,public.biz_brand_person_canonical(v_candidate),v_norm,v_person,v_ids[1],v_uid)
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

COMMENT ON FUNCTION public.biz_resolve_brand_person_conflict(uuid,uuid[],text,uuid,uuid) IS
  '#2305 — advances brand_person_identity_conflicts out of ''open'' AND writes '
  'the source link that makes "resolved" mean something. Takes an ARRAY: one '
  'human''s conflicts resolve together in one transaction, all or none, so an '
  'operator cannot answer the same identity question two different ways. Rank '
  '50 (brand_admin). Calls biz_merge_brand_people internally passing auth.uid() '
  'as the actor; that function performs NO authorization of its own and must '
  'never be granted to authenticated.';

-- ---------------------------------------------------------------------------
-- 6. Grants.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.biz_brand_person_conflict_subject(text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.biz_brand_person_conflict_subject(text,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.biz_list_brand_person_conflicts(uuid,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.biz_list_brand_person_conflicts(uuid,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.biz_list_brand_person_conflicts(uuid,integer) TO service_role;
REVOKE ALL ON FUNCTION public.biz_resolve_brand_person_conflict(uuid,uuid[],text,uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.biz_resolve_brand_person_conflict(uuid,uuid[],text,uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.biz_resolve_brand_person_conflict(uuid,uuid[],text,uuid,uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 7. Assertions — the shape this migration promises, checked at apply time.
-- ---------------------------------------------------------------------------
DO $assert$
DECLARE v_signature text;
BEGIN
  IF EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='brand_person_identity_separations') THEN
    RAISE EXCEPTION 'people_separation_policy_forbidden';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.brand_person_identity_separations'::regclass) THEN
    RAISE EXCEPTION 'people_separation_rls_required';
  END IF;
  IF EXISTS(SELECT 1 FROM information_schema.role_table_grants
            WHERE table_schema='public' AND table_name='brand_person_identity_separations'
              AND grantee IN ('PUBLIC','anon','authenticated')) THEN
    RAISE EXCEPTION 'people_separation_client_grant_forbidden';
  END IF;

  -- Client-reachable, rank-gated in-function.
  FOREACH v_signature IN ARRAY ARRAY[
    'public.biz_list_brand_person_conflicts(uuid,integer)',
    'public.biz_resolve_brand_person_conflict(uuid,uuid[],text,uuid,uuid)'
  ] LOOP
    IF NOT EXISTS(
      SELECT 1 FROM pg_proc p
      WHERE p.oid=to_regprocedure(v_signature)
        AND p.prosecdef
        AND p.proconfig @> ARRAY['search_path=public, pg_temp']::text[]
    ) OR has_function_privilege('anon',v_signature,'EXECUTE')
      OR NOT has_function_privilege('authenticated',v_signature,'EXECUTE') THEN
      RAISE EXCEPTION 'people_function_security_drift: %',v_signature;
    END IF;
  END LOOP;

  -- The two merge primitives stay service_role-only. Granting either to
  -- `authenticated` is a privilege-escalation hole: both take p_actor as a
  -- parameter and neither checks auth.uid() or any rank (F-8).
  FOREACH v_signature IN ARRAY ARRAY[
    'public.biz_merge_brand_people(uuid,uuid,text,uuid,uuid)',
    'public.biz_reverse_brand_person_merge(uuid,uuid)'
  ] LOOP
    IF has_function_privilege('authenticated',v_signature,'EXECUTE')
       OR has_function_privilege('anon',v_signature,'EXECUTE') THEN
      RAISE EXCEPTION 'people_merge_primitive_grant_forbidden: %',v_signature;
    END IF;
  END LOOP;

  -- The subject derivation is internal only.
  IF has_function_privilege('authenticated','public.biz_brand_person_conflict_subject(text,uuid)','EXECUTE')
     OR has_function_privilege('anon','public.biz_brand_person_conflict_subject(text,uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'people_subject_helper_grant_forbidden';
  END IF;

  -- 20270329001774's assertion, re-asserted with the new table included.
  IF EXISTS(
    SELECT 1 FROM unnest(ARRAY[
      'brand_people','brand_person_source_links','brand_person_names','brand_person_contact_methods',
      'brand_person_contact_method_sources','brand_person_identity_conflicts',
      'brand_person_channel_suppressions','brand_person_identity_separations'
    ]) AS touched(table_name)
    JOIN pg_class c ON c.oid=to_regclass('public.'||touched.table_name)
    WHERE NOT c.relrowsecurity
  ) THEN RAISE EXCEPTION 'people_touched_table_rls_required'; END IF;

  -- The four amendments are actually present in the deployed body. A silent
  -- CREATE OR REPLACE that lost one of them would leave the queue refilling
  -- forever with every test still green.
  IF position('A-1 (F-5)' IN pg_get_functiondef(
       'public.biz_resolve_brand_person_source(uuid,uuid,text,uuid,uuid,uuid,text,text,timestamptz)'::regprocedure)) = 0
     OR position('brand_person_identity_separations' IN pg_get_functiondef(
       'public.biz_resolve_brand_person_source(uuid,uuid,text,uuid,uuid,uuid,text,text,timestamptz)'::regprocedure)) = 0
     OR position('phone_country_iso' IN pg_get_functiondef(
       'public.biz_resolve_brand_person_source(uuid,uuid,text,uuid,uuid,uuid,text,text,timestamptz)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'people_resolver_amendments_missing';
  END IF;
END;
$assert$;

COMMIT;
