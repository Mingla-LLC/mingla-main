-- Issue #3524 — "option B, small": a host's marketing permission becomes a
-- separate, recorded thing from a guest's attendance.
--
-- WHAT WAS WRONG.
--
-- (1) CONSENT WAS RECORDED MINGLA-GLOBALLY. `consent_records` had no brand_id,
--     so there was no way to record "consented to THIS host, on THIS order".
-- (2) THE DISCLOSURE VERSION WAS COLLECTED AND DISCARDED. The checkout sends
--     it (`mingla-business/src/constants/consentDisclosure.ts` ->
--     `buyer.tsx`), and `record-consent` silently dropped it. A legal record
--     without the wording version shown is a weaker record than it looks.
-- (3) ATTENDANCE AND MARKETING PERMISSION WERE THE SAME ROW. Withdrawing
--     marketing would have destroyed the event's attendee list — the thing the
--     host needs to actually run the event.
--
-- SETH'S DECISION 6, VERBATIM IN EFFECT: record which brand, keep the
-- disclosure version, keep a marketing permission distinct from attendance, and
-- make "no recorded consent -> attendance only" expressible and fail-closed.
--
-- THREE ROWS, DELIBERATELY:
--   attendance   -> brand_people + brand_person_source_links
--   permission   -> brand_person_contact_methods.marketing_consent_state
--   withdrawal   -> brand_person_channel_suppressions / marketing_unsubscribes
-- The host-visible roster is a projection over the FIRST and must never read
-- the second or the third. That is why a per-host unsubscribe already cannot
-- remove anyone from a roster, and it must stay that way.
--
-- NO BACKFILL. Per Seth (2026-09-21): existing contacts stay exactly as they
-- are, and only orders ingested AFTER this ships get the stricter treatment.
-- `marketing_consent_state` therefore defaults to 'unknown', which behaves
-- exactly as today, and no row in this database is re-graded by this file.
-- The SPEC's R-65 grading backfill and R-66 ingest re-enqueue are deliberately
-- NOT here; D-1 (13 of 295 'done'-with-no-link order ingests) stays open for the
-- orchestrator.
--
-- No production row is created, modified or deleted by this file.

BEGIN;

-- ===========================================================================
-- (1) consent_records learns WHO the consent was given to, and UNDER WHICH
--     WORDING. Still append-only; nothing existing is rewritten.
-- ===========================================================================
ALTER TABLE public.consent_records
  ADD COLUMN IF NOT EXISTS brand_id uuid NULL
    REFERENCES public.brands(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS event_id uuid NULL
    REFERENCES public.events(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS disclosure_version text NULL,
  ADD COLUMN IF NOT EXISTS brand_attribution text NULL;

ALTER TABLE public.consent_records
  DROP CONSTRAINT IF EXISTS consent_records_brand_attribution_check;
ALTER TABLE public.consent_records
  ADD CONSTRAINT consent_records_brand_attribution_check CHECK (
    brand_attribution IS NULL OR brand_attribution IN ('captured', 'derived'));

CREATE INDEX IF NOT EXISTS consent_records_brand_contact_idx
  ON public.consent_records (brand_id, contact, channel, scope, created_at DESC)
  WHERE brand_id IS NOT NULL;

COMMENT ON COLUMN public.consent_records.brand_id IS
  '#3524: WHICH host the consent was given to. Resolved server-side from event_id by record-consent; a client-supplied brand id is never accepted.';
COMMENT ON COLUMN public.consent_records.event_id IS
  '#3524: the offering the grant happened on. This is what makes brand_id derivable server-side without trusting the caller.';
COMMENT ON COLUMN public.consent_records.disclosure_version IS
  '#3524: the version of the wording ACTUALLY SHOWN at the grant. Collected by the checkout since #2689 and silently dropped until now. NOT backfilled: every row written before this migration genuinely has no recorded version, and a retrofitted guess would falsify a legal record. disclosure_text is present on those rows and is the stronger artifact anyway (same reasoning as country_code in the #1529 migration).';
COMMENT ON COLUMN public.consent_records.brand_attribution IS
  '#3524: captured = the brand was known at the moment of the grant. derived = a later process attributed it from an order. A reader can always tell which. Nothing in this release writes derived.';

-- RLS: `consent_records` already has RLS enabled with exactly one policy,
-- `consent_records_read_own` (user_id = auth.uid(), SELECT, authenticated).
-- Writes are service-role only. NO NEW POLICY IS ADDED, and in particular brand
-- staff must NOT gain read access to this table through brand_id.
--
-- IF YOU ARE HERE TO "COMPLETE" THIS FEATURE BY ADDING A BRAND-READ POLICY:
-- don't. The host-facing answer to "may I market to this person" is
-- `brand_person_contact_methods.marketing_consent_state`, which brand staff
-- already reach through the existing biz_list_brand_people authorisation. This
-- table is the LEGAL AUDIT TRAIL and it is not a host-facing surface.

-- ===========================================================================
-- (2) The marketing permission, on the contact method — distinct from the
--     attendance record, and a THIRD value rather than a boolean.
--
--     'granted'  — a consent_records row for this brand + contact + channel +
--                  scope='marketing' + action='granted' is on file, and
--                  marketing_consent_record_id points at it.
--     'withheld' — the order/ticket rail graded this contact and found NO such
--                  row. THIS IS THE FAIL-CLOSED STATE and the only value that
--                  blocks anything.
--     'unknown'  — never graded by the order/ticket rail. Every other writer
--                  (CSV import #1775, digest #1774, reservation/stay #1773,
--                  manual add) leaves this value, and 'unknown' behaves exactly
--                  as today. This is what keeps the blast radius to the one
--                  rail Seth's decision is about — a boolean failing closed
--                  everywhere would have silently emptied every host's book on
--                  the day of this migration.
-- ===========================================================================
ALTER TABLE public.brand_person_contact_methods
  ADD COLUMN IF NOT EXISTS marketing_consent_state text NOT NULL
    DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS marketing_consent_record_id uuid NULL
    REFERENCES public.consent_records(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS marketing_consent_graded_at timestamptz NULL;

ALTER TABLE public.brand_person_contact_methods
  DROP CONSTRAINT IF EXISTS brand_person_contact_methods_marketing_consent_state_check;
ALTER TABLE public.brand_person_contact_methods
  ADD CONSTRAINT brand_person_contact_methods_marketing_consent_state_check CHECK (
    marketing_consent_state IN ('granted', 'withheld', 'unknown'));

CREATE INDEX IF NOT EXISTS brand_person_contact_methods_marketing_state_idx
  ON public.brand_person_contact_methods (brand_person_id, channel)
  WHERE marketing_consent_state = 'withheld';

COMMENT ON COLUMN public.brand_person_contact_methods.marketing_consent_state IS
  '#3524: the marketing PERMISSION, separate from the attendance record and separate from any withdrawal. Only the order/ticket ingest rail grants or withholds it; every other writer leaves unknown, which behaves as it always has. `is_exportable` is NOT repurposed for this — it has six independent writers across five migrations and keeps its current meaning.';

COMMENT ON COLUMN public.brand_person_contact_methods.marketing_consent_record_id IS
  '#3524: the consent_records row that granted this permission. NULL on withheld and unknown.';

-- ===========================================================================
-- (3) The grader. ONE lookup, one owner.
--
--     THE RULE KEYS ON THE CONSENT ROW, NEVER ON `marketing_opt_in`.
--     `mingla-business/app/checkout/[eventId]/buyer.tsx:302-309` binds
--     `marketingOptIn` to the MANDATORY `termsAccepted`, so `marketing_opt_in`
--     is structurally `true` on every completed ticket order and carries no
--     discriminating signal whatsoever. If you are reading this because you
--     want to "simplify" the predicate back onto that flag: that is the bug.
--
--     A REVOCATION IS NOT AN UNGRANT. This looks only for action='granted'
--     rows and ignores action='revoked' entirely, because a withdrawal is
--     expressed as a SUPPRESSION (a separate row, already consulted by the
--     authorisers) and not by erasing the record that a grant happened. That is
--     also why a re-ingest can only ever move 'withheld' -> 'granted' and never
--     the other way.
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.issue_3524_grade_marketing_consent(
  p_source_kind text,
  p_brand_id uuid,
  p_channel text,
  p_contact text
)
RETURNS TABLE (state text, record_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT
    CASE
      -- Only the order and ticket_holder arms are graded. event_rsvp,
      -- rsvp_plus_one, reservation and stay_reservation have a different consent
      -- story and are deliberately left 'unknown'.
      WHEN p_source_kind NOT IN ('order', 'ticket_holder') THEN 'unknown'
      WHEN r.id IS NOT NULL THEN 'granted'
      ELSE 'withheld'
    END,
    r.id
  FROM (SELECT 1) one
  LEFT JOIN LATERAL (
    SELECT c.id
      FROM public.consent_records c
     WHERE p_brand_id IS NOT NULL
       AND btrim(coalesce(p_contact, '')) <> ''
       AND c.brand_id = p_brand_id
       AND c.contact = p_contact
       AND c.channel = CASE WHEN p_channel = 'phone' THEN 'sms' ELSE p_channel END
       AND c.scope = 'marketing'
       AND c.action = 'granted'
     ORDER BY c.created_at DESC, c.id DESC
     LIMIT 1
  ) r ON true;
$function$;

COMMENT ON FUNCTION public.issue_3524_grade_marketing_consent(text, uuid, text, text) IS
  '#3524: grades a contact method the order/ticket ingest rail just wrote. granted when a consent_records row for this brand + contact + channel + marketing + granted is on file, withheld when none is, unknown for every other source kind. Keys on the consent ROW, never on orders.marketing_opt_in, which is structurally true on every ticket order.';

REVOKE ALL ON FUNCTION public.issue_3524_grade_marketing_consent(text, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3524_grade_marketing_consent(text, uuid, text, text)
  TO service_role;

-- ===========================================================================
-- (4) Grading AT INGEST, inside biz_resolve_brand_person_source.
--
--     WHY THIS IS A DYNAMIC pg_get_functiondef PATCH AND NOT A STATIC
--     CREATE OR REPLACE: `biz_resolve_brand_person_source`'s live body is
--     #2305's source with #1772's `s.superseded_at IS NULL` separation patch
--     already string-replaced into it (see
--     20270612001772_issue_1772_brand_person_maintenance.sql). A static
--     replacement written from #2305's file would SILENTLY REVERT that patch.
--     So this follows the file's own convention: take the live definition, inject
--     exactly what is new, and RAISE if the injection did not land — a loud
--     failure instead of a silent regression.
--
--     The injection is PURELY ADDITIVE: two UPDATE statements appended after the
--     existing contact-method writes. No existing statement is modified. The
--     `state <> 'unknown'` guard means every non-order arm updates zero rows, so
--     CSV imports, digests, reservations and manual adds are byte-identical.
-- ===========================================================================
DO $grade_patch$
DECLARE
  v_def text;
  v_before text;
  v_email_anchor text;
  v_phone_anchor text;
BEGIN
  SELECT pg_get_functiondef(
    'public.biz_resolve_brand_person_source(uuid,uuid,text,uuid,uuid,uuid,text,text,timestamptz)'::regprocedure)
    INTO v_def;
  v_before := v_def;

  -- #3524 — IDEMPOTENCE, AND WHY IT IS NOT OPTIONAL HERE.
  --
  -- This block APPENDS the grading UPDATE after an anchor that survives its own
  -- edit. Re-running it therefore appended a SECOND copy, then a third, without
  -- limit — a tester produced five by accident. The operator applies migrations,
  -- and a migration the operator cannot safely re-run is a trap laid for the
  -- person holding it.
  --
  -- The guard is a RETURN, not a silent skip: the notice says what happened.
  -- Following #1772's own precedent in this file's ancestor — take the live
  -- definition, look before you inject, and be loud either way.
  IF position('issue_3524_grade_marketing_consent' in v_def) > 0 THEN
    RAISE NOTICE
      '#3524: biz_resolve_brand_person_source already carries the marketing '
      'consent grading; leaving it exactly as it is.';
    RETURN;
  END IF;

  v_email_anchor :=
    '    INSERT INTO public.brand_person_contact_method_sources(contact_method_id,source_link_id,provenance_kind,exportable)
    VALUES(v_existing,v_link,v_provenance,true) ON CONFLICT DO NOTHING;';
  v_phone_anchor :=
    '    INSERT INTO public.brand_person_contact_method_sources(contact_method_id,source_link_id,provenance_kind,exportable,phone_country_iso)
    VALUES(v_existing,v_link,v_provenance,true,v_phone_country_iso)
    ON CONFLICT(contact_method_id,source_link_id) DO UPDATE SET active=true,retired_at=NULL,phone_country_iso=EXCLUDED.phone_country_iso;';

  IF position(v_email_anchor in v_def) = 0
     OR position(v_phone_anchor in v_def) = 0 THEN
    RAISE EXCEPTION 'issue_3524_grade_patch_anchor_missing';
  END IF;

  v_def := replace(v_def, v_email_anchor, v_email_anchor || '
    -- #3524: grade the marketing permission this ingest just created. Additive:
    -- a non-order source kind grades ''unknown'' and updates zero rows. A grant
    -- is never downgraded to ''withheld'' by a re-ingest.
    UPDATE public.brand_person_contact_methods c
       SET marketing_consent_state=g.state,marketing_consent_record_id=g.record_id,
           marketing_consent_graded_at=now(),updated_at=now()
      FROM public.issue_3524_grade_marketing_consent(p_source_kind,v_brand,''email'',v_email) g
     WHERE c.id=v_existing AND g.state<>''unknown''
       AND NOT (c.marketing_consent_state=''granted'' AND g.state=''withheld'');');

  v_def := replace(v_def, v_phone_anchor, v_phone_anchor || '
    -- #3524: same grading for the phone method. ''phone'' maps to the ''sms''
    -- consent channel inside the grader.
    UPDATE public.brand_person_contact_methods c
       SET marketing_consent_state=g.state,marketing_consent_record_id=g.record_id,
           marketing_consent_graded_at=now(),updated_at=now()
      FROM public.issue_3524_grade_marketing_consent(p_source_kind,v_brand,''phone'',v_phone) g
     WHERE c.id=v_existing AND g.state<>''unknown''
       AND NOT (c.marketing_consent_state=''granted'' AND g.state=''withheld'');');

  IF v_def = v_before
     OR v_def NOT LIKE '%issue_3524_grade_marketing_consent(p_source_kind,v_brand,''email''%'
     OR v_def NOT LIKE '%issue_3524_grade_marketing_consent(p_source_kind,v_brand,''phone''%'
     OR v_def NOT LIKE 'CREATE OR REPLACE FUNCTION public.biz_resolve_brand_person_source%'
     -- #1772's separation patch must still be present in what we re-declare.
     OR v_def NOT LIKE '%s.superseded_at IS NULL%' THEN
    RAISE EXCEPTION 'issue_3524_grade_patch_failed';
  END IF;

  EXECUTE format('CREATE OR REPLACE FUNCTION public.biz_resolve_brand_person_source%s',
    substr(v_def, length('CREATE OR REPLACE FUNCTION public.biz_resolve_brand_person_source') + 1));
END
$grade_patch$;

REVOKE ALL ON FUNCTION public.biz_resolve_brand_person_source(
  uuid,uuid,text,uuid,uuid,uuid,text,text,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.biz_resolve_brand_person_source(
  uuid,uuid,text,uuid,uuid,uuid,text,text,timestamptz) TO service_role;

-- ===========================================================================
-- (5) THE FAIL-CLOSED RULE, in the three readers that can act on it.
--
--     Exactly three function bodies change, and all three change only their
--     MARKETING arm. `offering_invitation` and `transactional` are untouched:
--     the host still needs to reach their attendee to RUN the event, and that
--     was never the thing consent gates.
--
--     `biz_brand_person_authorized_contact_v1` is a pure shim over
--     `biz_brand_person_authorized_contact` and inherits the rule without being
--     re-declared. No fourth reader is introduced.
-- ===========================================================================

-- (5a) The v2 authoriser — marketing_blast only.
CREATE OR REPLACE FUNCTION public.biz_brand_person_authorized_contact_v2(
  p_brand_id uuid,p_brand_person_id uuid,p_channel text,p_category_key text
) RETURNS TABLE(contact_method_id uuid,recipient_user_id uuid,normalized_contact text,allowed boolean,reason text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $f$
DECLARE v_person uuid; v_method public.brand_person_contact_methods%ROWTYPE; v_linked_user uuid; v_suppressed boolean; v_can_send boolean;
  v_consent_blocked boolean;
BEGIN
 IF p_channel NOT IN ('email','sms','push') OR p_category_key NOT IN ('offering_invitation','marketing_blast') THEN
   RETURN QUERY SELECT NULL::uuid,NULL::uuid,NULL::text,false,'invalid_request'::text; RETURN;
 END IF;
 v_person:=public.biz_brand_person_canonical(p_brand_person_id);
 SELECT linked_user_id INTO v_linked_user FROM public.brand_people
 WHERE id=v_person AND brand_id=p_brand_id AND record_status='active';
 IF NOT FOUND OR v_person<>p_brand_person_id THEN
   RETURN QUERY SELECT NULL::uuid,NULL::uuid,NULL::text,false,'person_not_in_brand'::text; RETURN;
 END IF;
 IF p_channel='push' THEN
   v_can_send:=v_linked_user IS NOT NULL AND public.can_send(v_linked_user,p_category_key,'push',NULL);
   RETURN QUERY SELECT NULL::uuid,v_linked_user,NULL::text,v_can_send,
     CASE WHEN v_linked_user IS NULL THEN 'channel_unavailable' WHEN NOT v_can_send THEN 'can_send_denied' ELSE 'allowed' END; RETURN;
 END IF;
 SELECT * INTO v_method FROM public.brand_person_contact_methods
 WHERE brand_person_id=v_person AND brand_id=p_brand_id
   AND channel=CASE WHEN p_channel='sms' THEN 'phone' ELSE 'email' END
   AND record_state='active' AND provenance_scope='brand_owned' AND is_exportable
   -- #3524: marketing_blast additionally requires a permission that is not
   -- withheld. 'unknown' passes, so nothing the order/ticket rail never graded
   -- changes behaviour.
   AND (p_category_key<>'marketing_blast' OR marketing_consent_state<>'withheld')
 ORDER BY is_primary DESC,created_at,id LIMIT 1;
 IF NOT FOUND THEN
   -- #3524: distinguish "there is no such channel at all" from "there IS one and
   -- the ONLY thing that excluded it was the missing consent record". A host
   -- reading 'channel_unavailable' would go looking for a contact that exists.
   SELECT EXISTS(
     SELECT 1 FROM public.brand_person_contact_methods
      WHERE brand_person_id=v_person AND brand_id=p_brand_id
        AND channel=CASE WHEN p_channel='sms' THEN 'phone' ELSE 'email' END
        AND record_state='active' AND provenance_scope='brand_owned' AND is_exportable
        AND marketing_consent_state='withheld'
   ) INTO v_consent_blocked;
   RETURN QUERY SELECT NULL::uuid,NULL::uuid,NULL::text,false,
     CASE WHEN p_category_key='marketing_blast' AND v_consent_blocked
       THEN 'consent_missing' ELSE 'channel_unavailable' END; RETURN;
 END IF;
 SELECT EXISTS(
   SELECT 1 FROM public.brand_person_channel_suppressions s WHERE s.brand_person_id=v_person
    AND s.channel=p_channel AND s.lifted_at IS NULL AND s.scope IN ('marketing','all')
   UNION ALL
   SELECT 1 FROM public.channel_suppressions s WHERE s.channel=p_channel AND s.scope IN ('marketing','all')
    AND (s.contact=v_method.normalized_value OR (v_linked_user IS NOT NULL AND s.user_id=v_linked_user))
 ) INTO v_suppressed;
 v_can_send:=public.can_send(v_linked_user,p_category_key,p_channel,v_method.normalized_value);
 RETURN QUERY SELECT v_method.id,v_linked_user,v_method.normalized_value,NOT v_suppressed AND v_can_send,
   CASE WHEN v_suppressed THEN 'suppressed' WHEN NOT v_can_send THEN 'can_send_denied' ELSE 'allowed' END;
END $f$;

COMMENT ON FUNCTION public.biz_brand_person_authorized_contact_v2(uuid,uuid,text,text) IS
  '#1995 + #3524: marketing_blast additionally requires marketing_consent_state <> withheld, and answers consent_missing rather than channel_unavailable when that predicate is the only thing that excluded an existing contact. offering_invitation is NOT marketing and is unaffected — the host still needs to reach their attendee to run the event. A granted permission does not override a suppression, and a suppression does not erase the record of the grant.';

REVOKE ALL ON FUNCTION public.biz_brand_person_authorized_contact_v2(uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.biz_brand_person_authorized_contact_v2(uuid,uuid,text,text) TO service_role;

-- (5b) The purpose-shaped authoriser — 'marketing' only.
CREATE OR REPLACE FUNCTION public.biz_brand_person_authorized_contact(
 p_brand_id uuid,p_brand_person_id uuid,p_channel text,p_purpose text
) RETURNS TABLE(contact_method_id uuid,recipient_user_id uuid,normalized_contact text,allowed boolean,reason text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $f$
DECLARE v_person uuid; v_method public.brand_person_contact_methods%ROWTYPE; v_linked_user uuid; v_suppressed boolean; v_can_send boolean;
  v_consent_blocked boolean;
BEGIN
  IF p_channel NOT IN ('email','sms','push') OR p_purpose NOT IN ('marketing','transactional') THEN
    RETURN QUERY SELECT NULL::uuid,NULL::uuid,NULL::text,false,'invalid_request'::text; RETURN;
  END IF;
  v_person := public.biz_brand_person_canonical(p_brand_person_id);
  SELECT linked_user_id INTO v_linked_user FROM public.brand_people WHERE id=v_person AND brand_id=p_brand_id AND record_status='active';
  IF NOT FOUND THEN RETURN QUERY SELECT NULL::uuid,NULL::uuid,NULL::text,false,'person_not_in_brand'::text; RETURN; END IF;
  IF p_channel='push' THEN
    v_can_send := v_linked_user IS NOT NULL AND public.can_send(v_linked_user,'offering_invitation','push',NULL);
    RETURN QUERY SELECT NULL::uuid,v_linked_user,NULL::text,v_can_send,
      CASE WHEN v_linked_user IS NULL THEN 'channel_unavailable' WHEN NOT v_can_send THEN 'can_send_denied' ELSE 'allowed' END;
    RETURN;
  END IF;
  SELECT * INTO v_method FROM public.brand_person_contact_methods
    WHERE brand_person_id=v_person AND channel=CASE WHEN p_channel='sms' THEN 'phone' ELSE 'email' END
      AND record_state='active' AND provenance_scope='brand_owned' AND is_exportable
      -- #3524: marketing only. 'transactional' is unaffected.
      AND (p_purpose<>'marketing' OR marketing_consent_state<>'withheld')
    ORDER BY is_primary DESC,created_at,id LIMIT 1;
  IF NOT FOUND THEN
    SELECT EXISTS(
      SELECT 1 FROM public.brand_person_contact_methods
       WHERE brand_person_id=v_person AND channel=CASE WHEN p_channel='sms' THEN 'phone' ELSE 'email' END
         AND record_state='active' AND provenance_scope='brand_owned' AND is_exportable
         AND marketing_consent_state='withheld'
    ) INTO v_consent_blocked;
    RETURN QUERY SELECT NULL::uuid,NULL::uuid,NULL::text,false,
      CASE WHEN p_purpose='marketing' AND v_consent_blocked
        THEN 'consent_missing' ELSE 'channel_unavailable' END;
    RETURN;
  END IF;
  SELECT EXISTS(
    SELECT 1 FROM public.brand_person_channel_suppressions s
      WHERE s.brand_person_id=v_person AND s.channel=p_channel AND s.lifted_at IS NULL
        AND s.scope IN (CASE WHEN p_purpose='marketing' THEN 'marketing' ELSE 'all' END,'all')
    UNION ALL
    SELECT 1 FROM public.channel_suppressions s
      WHERE s.channel=p_channel AND s.scope IN (CASE WHEN p_purpose='marketing' THEN 'marketing' ELSE 'transactional' END,'all')
        AND (s.contact=v_method.normalized_value OR (v_linked_user IS NOT NULL AND s.user_id=v_linked_user))
  ) INTO v_suppressed;
  v_can_send := public.can_send(v_linked_user,'offering_invitation',p_channel,v_method.normalized_value);
  RETURN QUERY SELECT v_method.id,v_linked_user,v_method.normalized_value,NOT v_suppressed AND v_can_send,
    CASE WHEN v_suppressed THEN 'suppressed' WHEN NOT v_can_send THEN 'can_send_denied' ELSE 'allowed' END;
END;
$f$;

-- (5c) The brand_book export arm. The offering_guest_roster arm delegates to
--      biz_offering_guest_roster_export_rows and is UNTOUCHED: that is the
--      ATTENDEE list and it must keep every attendee, suppressed or not,
--      graded or not. That separation is the whole point of Seth's decision 6
--      point 3.
CREATE OR REPLACE FUNCTION public.biz_brand_people_export_rows(p_job_id uuid)
RETURNS TABLE(row_data jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE v_job public.brand_people_export_jobs%ROWTYPE;
BEGIN
  SELECT * INTO v_job FROM public.brand_people_export_jobs WHERE id=p_job_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'export_job_not_found' USING ERRCODE='P0002'; END IF;
  IF v_job.export_kind='offering_guest_roster' THEN
    RETURN QUERY SELECT * FROM public.biz_offering_guest_roster_export_rows(p_job_id); RETURN;
  END IF;
  RETURN QUERY
  WITH people AS (
    SELECT p.id,p.display_name,
      (SELECT c.normalized_value FROM public.brand_person_contact_methods c WHERE c.brand_person_id=p.id AND c.channel='email' AND c.record_state='active' AND c.provenance_scope='brand_owned' AND c.is_exportable AND c.marketing_consent_state<>'withheld' ORDER BY c.is_primary DESC,c.created_at,c.id LIMIT 1) primary_email,
      COALESCE((SELECT jsonb_agg(c.normalized_value ORDER BY c.normalized_value) FROM public.brand_person_contact_methods c WHERE c.brand_person_id=p.id AND c.channel='email' AND c.record_state='active' AND c.provenance_scope='brand_owned' AND c.is_exportable AND c.marketing_consent_state<>'withheld' AND NOT c.is_primary),'[]'::jsonb) alternate_emails,
      (SELECT c.normalized_value FROM public.brand_person_contact_methods c WHERE c.brand_person_id=p.id AND c.channel='phone' AND c.record_state='active' AND c.provenance_scope='brand_owned' AND c.is_exportable AND c.marketing_consent_state<>'withheld' ORDER BY c.is_primary DESC,c.created_at,c.id LIMIT 1) primary_phone,
      COALESCE((SELECT jsonb_agg(c.normalized_value ORDER BY c.normalized_value) FROM public.brand_person_contact_methods c WHERE c.brand_person_id=p.id AND c.channel='phone' AND c.record_state='active' AND c.provenance_scope='brand_owned' AND c.is_exportable AND c.marketing_consent_state<>'withheld' AND NOT c.is_primary),'[]'::jsonb) alternate_phones,
      (SELECT min(source_occurred_at) FROM public.brand_person_source_links l WHERE l.brand_person_id=p.id) first_source,
      (SELECT max(source_occurred_at) FROM public.brand_person_source_links l WHERE l.brand_person_id=p.id) last_source,
      COALESCE((SELECT jsonb_agg(DISTINCT source_kind ORDER BY source_kind) FROM public.brand_person_source_links l WHERE l.brand_person_id=p.id),'[]'::jsonb) source_types,
      EXISTS(SELECT 1 FROM public.brand_person_channel_suppressions s WHERE s.brand_person_id=p.id AND s.channel='email' AND s.lifted_at IS NULL) suppressed_email,
      EXISTS(SELECT 1 FROM public.brand_person_channel_suppressions s WHERE s.brand_person_id=p.id AND s.channel='sms' AND s.lifted_at IS NULL) suppressed_sms
    FROM public.brand_people p WHERE p.brand_id=v_job.brand_id AND p.record_status='active'
  ), filtered AS (
    SELECT * FROM people x
    WHERE (v_job.filter_json->>'filter'='all'
      OR (v_job.filter_json->>'filter'='suppressed' AND (x.suppressed_email OR x.suppressed_sms))
      OR (v_job.filter_json->>'filter'='reachable' AND
        ((x.primary_email IS NOT NULL AND NOT x.suppressed_email) OR (x.primary_phone IS NOT NULL AND NOT x.suppressed_sms))))
      AND (v_job.filter_json->>'search'=''
        OR strpos(lower(x.display_name),v_job.filter_json->>'search')>0
        OR EXISTS(SELECT 1 FROM public.brand_person_contact_methods c
          WHERE c.brand_person_id=x.id AND c.record_state='active' AND c.provenance_scope='brand_owned'
            AND c.is_exportable AND c.marketing_consent_state<>'withheld'
            AND strpos(lower(c.normalized_value),v_job.filter_json->>'search')>0))
  )
  SELECT jsonb_build_object(
    'personId',x.id,'name',x.display_name,'primaryEmail',x.primary_email,'alternateEmails',x.alternate_emails,
    'primaryPhone',x.primary_phone,'alternatePhones',x.alternate_phones,'firstSource',x.first_source,'lastSource',x.last_source,
    'sourceTypes',x.source_types,'suppressedEmail',x.suppressed_email,'suppressedSms',x.suppressed_sms)
  FROM filtered x
  ORDER BY
    CASE WHEN v_job.filter_json->>'sort'='action_priority' THEN (x.suppressed_email OR x.suppressed_sms)::integer END DESC,
    CASE WHEN v_job.filter_json->>'sort'='recent_first' THEN x.last_source END DESC NULLS LAST,
    CASE WHEN v_job.filter_json->>'sort' IN ('action_priority','name_asc') THEN lower(x.display_name) END ASC,
    CASE WHEN v_job.filter_json->>'sort'='name_desc' THEN lower(x.display_name) END DESC,
    x.id;
END;
$function$;

COMMENT ON FUNCTION public.biz_brand_people_export_rows(uuid) IS
  '#1770 + #3524: the brand_book arm omits contact methods whose marketing permission is withheld. The offering_guest_roster arm delegates untouched — that is the attendee list and every attendee stays on it. biz_guest_roster_project likewise reads only brand_people.record_status and brand_person_source_links, never contact-method permission or suppression, which is exactly why a per-host unsubscribe cannot remove anyone from a roster.';

COMMIT;
