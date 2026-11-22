-- Issue #4541 M-A: brand forms live fixes, operations and access hardening.
-- Spec: "#4541 build spec: everything left on custom forms" (approved 21 Nov 2026),
-- wave 1 (server). Parts 1, 6 (server), 7 (server) and 8.
--
-- What this file does:
--   R1.1  checkout answers are insert-only per order (finalize trigger, check, read)
--   R1.2  "not asked yet" count (brand_form_not_asked_count, biz_brand_form_counts.notAsked)
--   R1.3  the after-RSVP hand-off link (brand_form_rsvp_handoff_link)
--   R1.4  one current-holder rule (brand_form_subject_current) in every reader,
--         approved Maybe RSVPs count like Going; pending, denied, waitlisted,
--         Can't go, refunded and cancelled do not
--   R1.5  comp orders are added by the host, like door sales
--   R1.6  erasure (brand_form_erase_person) and retention (brand_form_retention_purge,
--         one appended line in the #4452 daily job)
--   R1.7  finalize retry sweep (brand_form_promote_stash, brand_form_checkout_answers_retry)
--   R1.8  the off switch stops request enqueue, claim and the automatic reminder
--   R1.9  answers on guest and order detail (biz_brand_form_guest_answers)
--   R1.10 duplicating an event copies its form attachment
--   R7.1  admin support read (admin_brand_forms_support), counts and switches only
--   R7.2  ops alert ledger and queue health
--   R8.1  signed-in answers follow the read rule; RSVP credentials must be current
--   R8.2  issuing a personal link revokes the same person's earlier links
--   R8.3  door full answers: team / invited staff scope, per-subject cap, host log
--   R8.4  atomic per-address submit admission (brand_form_attempt_admit)
--
-- Coordination (#4522): never redefines issue_3872_ticket_quote,
-- issue_1930_ticket_checkout_create_session_base, issue_1930_ticket_checkout_finalize_base,
-- refund_preview, biz_refund_order or admin_refund_order. Finalize stays the existing
-- AFTER UPDATE OF order_id trigger on ticket_checkout_sessions.
--
-- Lock rule: no function here takes a lock that submit_event_rsvp_with_delivery
-- takes. The finalize trigger takes only non-waiting locks (NOWAIT, try-locks)
-- and never raises into the order transaction.
--
-- Every function: SECURITY DEFINER SET search_path = '' (or IMMUTABLE pure).
-- Nothing new is granted to anon. Stale writes raise PT409, never 40001.
--
-- READ-ONLY PROBE (run right before applying; 21 Nov 2026 returned
-- 20281121004541, 0, 1, 0, 0):
--   SELECT (SELECT max(version) FROM supabase_migrations.schema_migrations),
--     (SELECT count(*) FROM public.brand_form_attachments a JOIN public.events e
--        ON e.id = a.event_id WHERE e.event_type = 'rsvp' AND a.detached_at IS NULL),
--     (SELECT count(*) FROM public.brand_form_responses),
--     (SELECT count(*) FROM public.brand_form_request_sends),
--     (SELECT count(*) FROM public.brand_form_door_reads);
--
-- ROLLBACK (manual):
--   FIRST take the retention line back out of the #4452 job:
--     SELECT cron.alter_job(jobid, command := replace(command,
--       E'\n    SELECT public.brand_form_retention_purge();', ''))
--       FROM cron.job WHERE jobname = 'issue_4452_forms_retention';
--   Re-run the replaced function bodies from git: brand_form_submit_core,
--     brand_form_link_issue, brand_form_request_guests, brand_form_request_audience,
--     brand_form_request_enqueue, brand_form_request_claim_batch,
--     brand_form_auto_reminders_due, brand_form_door_answers,
--     brand_form_door_full_answers, brand_form_unanswered_count,
--     brand_form_my_response, brand_forms_my_pending from 20281121004541;
--     brand_form_finalize_checkout_answers, brand_form_checkout_check_session,
--     brand_form_checkout_form, brand_form_event_responses, biz_brand_form_responses,
--     biz_brand_form_counts, biz_brand_form_attach, brand_form_roster_export_answers
--     from 20281120034514; business_duplicate_event_as_draft from 20280430011023.
--   DROP FUNCTION the functions this file creates (section 2 to 9 headers name them);
--   DROP TABLE public.brand_form_ops_alerts;
--   ALTER TABLE public.brand_form_checkout_answers DROP COLUMN retry_count, DROP COLUMN last_error;
--   ALTER TABLE public.brand_forms DROP COLUMN door_full_answers_invited;
--   DELETE FROM public.brand_form_submit_attempts WHERE outcome = 'admitted';
--   ALTER TABLE public.brand_form_submit_attempts DROP COLUMN bucket,
--     DROP CONSTRAINT brand_form_submit_attempts_outcome_check,
--     ADD CONSTRAINT brand_form_submit_attempts_outcome_check
--       CHECK (outcome IN ('accepted', 'rejected', 'rate_limited', 'paused'));
--   Erased answers cannot be restored (by design).

BEGIN;
SET LOCAL lock_timeout = '10s';

-- ---------------------------------------------------------------------------
-- 0. Drift guard: every body this file replaces must be the one in the repo.
-- ---------------------------------------------------------------------------
DO $drift_guard$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public.brand_form_submit_core(jsonb)', '27f5d5e10149f254db75971fdd3c4cde'),
      ('public.brand_form_link_issue(uuid,uuid,jsonb,uuid,integer)', 'e128d3080d995f8f2faace583ed68f82'),
      ('public.brand_form_request_guests(uuid,uuid,jsonb)', '5c13bb5c0359c29089016e89eae81112'),
      ('public.brand_form_request_audience(uuid,uuid,uuid,text,jsonb,text[])', '93820d9f961fedf47982a6fb7a6f6183'),
      ('public.brand_form_request_enqueue(uuid,uuid,uuid,text,text,jsonb,text[])', '09975cba549332c8e3afec823750360c'),
      ('public.brand_form_request_claim_batch(integer,uuid,uuid)', 'bbc97e863f0cd7905e1c35c264ecd40c'),
      ('public.brand_form_auto_reminders_due()', 'c103610d9b14c42f283603d763e8637f'),
      ('public.brand_form_door_answers(uuid,uuid,jsonb)', '38905b97786921e06aa1888133e9112b'),
      ('public.brand_form_door_full_answers(uuid,uuid,jsonb,text)', '055bdb3d9551cc06f3554c895150c7ca'),
      ('public.brand_form_unanswered_count(uuid,uuid)', '6f22cd0508228fbb19d93314ca04c975'),
      ('public.brand_form_my_response(uuid,uuid,text,uuid)', 'a9a417d4caf31243295505421c35fc46'),
      ('public.brand_forms_my_pending()', '75497dbfc68c62575f3a6d3efcba8e5f'),
      ('public.brand_form_finalize_checkout_answers()', '97bcee2808d76c9ac05ab199b6794ab0'),
      ('public.brand_form_checkout_check_session(uuid,boolean,jsonb,uuid,text,uuid)', '58fe2a28e0b0ee27709fc2490c524a0f'),
      ('public.brand_form_checkout_form(uuid,uuid,text)', '879dd8e857dc0c7381815a5b9c8f697f'),
      ('public.brand_form_event_responses(uuid,uuid)', '4d1b0781d3c30156b4e347a42820671f'),
      ('public.biz_brand_form_responses(uuid,uuid,text,integer,integer)', '2fcd26d2d3dd3f2f87a0ad4f9b5650d4'),
      ('public.biz_brand_form_counts(uuid)', '237360b58e4ecdc9b39fce3737ab2c1f'),
      ('public.biz_brand_form_attach(uuid,uuid,text,boolean,uuid)', '2d68b83b8f1d150647a7233ad34314f5'),
      ('public.brand_form_roster_export_answers(uuid)', '13aed02c36172524c8276cdbf7156bb3'),
      ('public.business_duplicate_event_as_draft(uuid)', 'b3288e7011b07a006381befad849224d')
    ) AS v(sig, expected_md5)
  LOOP
    IF (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = r.sig::regprocedure)
       IS DISTINCT FROM r.expected_md5 THEN
      RAISE EXCEPTION 'issue #4541 M-A drift: % no longer matches its repository definition', r.sig;
    END IF;
  END LOOP;
END;
$drift_guard$;

-- ---------------------------------------------------------------------------
-- 1. Schema
-- ---------------------------------------------------------------------------
-- R1.7: the retry sweep records each attempt.
ALTER TABLE public.brand_form_checkout_answers
  ADD COLUMN retry_count integer NOT NULL DEFAULT 0 CHECK (retry_count BETWEEN 0 AND 1000),
  ADD COLUMN last_error text CHECK (last_error IS NULL OR char_length(last_error) <= 300);

-- R8.4: one atomic admission row per request, per bucket.
ALTER TABLE public.brand_form_submit_attempts
  DROP CONSTRAINT brand_form_submit_attempts_outcome_check,
  ADD CONSTRAINT brand_form_submit_attempts_outcome_check
    CHECK (outcome IN ('accepted', 'rejected', 'rate_limited', 'paused', 'admitted')),
  ADD COLUMN bucket text NOT NULL DEFAULT 'submit' CHECK (bucket IN ('submit', 'read', 'unknown'));
CREATE INDEX brand_form_submit_attempts_bucket_idx
  ON public.brand_form_submit_attempts (ip_hash, bucket, created_at DESC);

-- R8.3: invited scan-only staff read full answers only when the host allows it.
ALTER TABLE public.brand_forms
  ADD COLUMN door_full_answers_invited boolean NOT NULL DEFAULT false;

CREATE INDEX brand_form_door_reads_event_idx
  ON public.brand_form_door_reads (event_id, created_at DESC);
CREATE INDEX brand_form_door_reads_subject_idx
  ON public.brand_form_door_reads (actor_id, subject_id, created_at DESC);

-- R7.2: one ops alert per kind per day.
CREATE TABLE public.brand_form_ops_alerts (
  kind    text NOT NULL CHECK (kind ~ '^[a-z0-9_]{1,64}$'),
  day     date NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (kind, day)
);
ALTER TABLE public.brand_form_ops_alerts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.brand_form_ops_alerts FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON public.brand_form_ops_alerts TO service_role;

-- ---------------------------------------------------------------------------
-- 2. Shared helpers (R1.1, R1.4, R1.5, R8.3)
-- ---------------------------------------------------------------------------
-- R1.4: the one current-holder rule. An approved Going or Maybe RSVP, a claimed
-- plus-one of one, or a paid or partly refunded order, at this event.
CREATE FUNCTION public.brand_form_subject_current(p_kind text, p_id uuid, p_event_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
  SELECT COALESCE(CASE p_kind
    WHEN 'rsvp' THEN EXISTS (
      SELECT 1 FROM public.event_rsvps r
       WHERE r.id = p_id AND r.event_id = p_event_id
         AND r.rsvp_status IN ('going', 'maybe') AND r.approval_status = 'approved')
    WHEN 'rsvp_guest' THEN EXISTS (
      SELECT 1 FROM public.event_rsvp_guests g JOIN public.event_rsvps r ON r.id = g.rsvp_id
       WHERE g.id = p_id AND g.claimed_at IS NOT NULL AND g.matched_user_id IS NOT NULL
         AND r.event_id = p_event_id
         AND r.rsvp_status IN ('going', 'maybe') AND r.approval_status = 'approved')
    WHEN 'order' THEN EXISTS (
      SELECT 1 FROM public.orders o
       WHERE o.id = p_id AND o.event_id = p_event_id
         AND o.payment_status IN ('paid', 'partial_refund'))
    WHEN 'user' THEN p_id IS NOT NULL AND (
      EXISTS (SELECT 1 FROM public.event_rsvps r
               WHERE r.user_id = p_id AND r.event_id = p_event_id
                 AND r.rsvp_status IN ('going', 'maybe') AND r.approval_status = 'approved')
      OR EXISTS (SELECT 1 FROM public.event_rsvp_guests g JOIN public.event_rsvps r ON r.id = g.rsvp_id
                  WHERE g.matched_user_id = p_id AND g.claimed_at IS NOT NULL
                    AND r.event_id = p_event_id
                    AND r.rsvp_status IN ('going', 'maybe') AND r.approval_status = 'approved')
      OR EXISTS (SELECT 1 FROM public.orders o
                  WHERE o.buyer_user_id = p_id AND o.event_id = p_event_id
                    AND o.payment_status IN ('paid', 'partial_refund')))
    ELSE false END, false);
$fn$;

-- R1.5: a guest the host added (door sale, manual import or comp) is never chased.
CREATE FUNCTION public.brand_form_added_by_host(p_kind text, p_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
  SELECT p_kind = 'order' AND COALESCE((
    SELECT o.source IN ('door_sale', 'manual_import', 'comp') OR COALESCE(o.is_door_sale, false)
      FROM public.orders o WHERE o.id = p_id), false);
$fn$;

-- R1.1: the person's response "at this event" for a signed-in user: their
-- account-level row (any page), or a row on their RSVP, order or claimed
-- plus-one at this event. The same rules submit_event_rsvp_with_form uses.
CREATE FUNCTION public.brand_form_person_row_at_event(p_form_id uuid, p_user_id uuid, p_event_id uuid)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
  SELECT r.id FROM public.brand_form_responses r
   WHERE p_user_id IS NOT NULL AND r.form_id = p_form_id
     AND (r.user_id = p_user_id
       OR EXISTS (SELECT 1 FROM public.event_rsvps x
                   WHERE x.id = r.rsvp_id AND x.event_id = p_event_id AND x.user_id = p_user_id)
       OR EXISTS (SELECT 1 FROM public.orders o
                   WHERE o.id = r.order_id AND o.event_id = p_event_id AND o.buyer_user_id = p_user_id)
       OR EXISTS (SELECT 1 FROM public.event_rsvp_guests g JOIN public.event_rsvps x ON x.id = g.rsvp_id
                   WHERE g.id = r.rsvp_guest_id AND x.event_id = p_event_id
                     AND g.matched_user_id = p_user_id AND g.claimed_at IS NOT NULL))
   ORDER BY r.updated_at DESC, r.id
   LIMIT 1;
$fn$;

-- No question carries a non-null, non-blank value (the RSVP wrapper's test).
CREATE FUNCTION public.brand_form_answers_empty(p_answers jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $fn$
  SELECT NOT EXISTS (
    SELECT 1 FROM jsonb_each(CASE WHEN jsonb_typeof(p_answers) = 'object' THEN p_answers ELSE '{}'::jsonb END) a
     WHERE jsonb_typeof(a.value) <> 'null'
       AND NOT (jsonb_typeof(a.value) = 'string' AND btrim(a.value #>> '{}') = '')
       AND NOT (jsonb_typeof(a.value) = 'array' AND jsonb_array_length(a.value) = 0)
       AND NOT (jsonb_typeof(a.value) = 'object' AND a.value = '{}'::jsonb));
$fn$;

-- R8.3: who may open one guest's full answers at the door, or null (line only).
--   manager: event manager and up (always);
--   team:    any brand role (scanner included) when the form allows full answers;
--   invited: no brand role, an event_scanners row, and both form switches on.
CREATE FUNCTION public.brand_form_door_full_scope(
  p_actor_id uuid, p_event_id uuid, p_rank integer, p_full boolean, p_invited boolean
) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
  SELECT CASE
    WHEN COALESCE(p_rank, 0) >= public.biz_role_rank('event_manager') THEN 'manager'
    WHEN COALESCE(p_rank, 0) > 0 AND COALESCE(p_full, false) THEN 'team'
    WHEN COALESCE(p_rank, 0) <= 0 AND COALESCE(p_full, false) AND COALESCE(p_invited, false)
         AND EXISTS (SELECT 1 FROM public.event_scanners s
                      WHERE s.event_id = p_event_id AND s.user_id = p_actor_id AND s.removed_at IS NULL)
      THEN 'invited'
    ELSE NULL END;
$fn$;

-- ---------------------------------------------------------------------------
-- 3. R1.4 / R1.5: readers apply the current-holder rule
-- ---------------------------------------------------------------------------
-- Responses that belong to one event. An RSVP, order or plus-one row counts only
-- while its subject is current; an account-level row counts for a page it was
-- given on or a current holder of the page. All pages (null): each subject row
-- is judged at its own event.
CREATE OR REPLACE FUNCTION public.brand_form_event_responses(p_form_id uuid, p_event_id uuid)
RETURNS SETOF public.brand_form_responses
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
  SELECT r.* FROM public.brand_form_responses r
   WHERE r.form_id = p_form_id
     AND CASE
       WHEN r.rsvp_id IS NOT NULL THEN public.brand_form_subject_current('rsvp', r.rsvp_id,
              COALESCE(p_event_id, public.brand_form_subject_event('rsvp', r.rsvp_id)))
       WHEN r.order_id IS NOT NULL THEN public.brand_form_subject_current('order', r.order_id,
              COALESCE(p_event_id, public.brand_form_subject_event('order', r.order_id)))
       WHEN r.rsvp_guest_id IS NOT NULL THEN public.brand_form_subject_current('rsvp_guest', r.rsvp_guest_id,
              COALESCE(p_event_id, public.brand_form_subject_event('rsvp_guest', r.rsvp_guest_id)))
       WHEN r.user_id IS NOT NULL THEN p_event_id IS NULL OR r.event_id = p_event_id
              OR public.brand_form_subject_current('user', r.user_id, p_event_id)
       ELSE p_event_id IS NULL OR r.event_id = p_event_id
     END;
$fn$;

CREATE OR REPLACE FUNCTION public.brand_form_unanswered_count(
  p_form_id uuid, p_event_id uuid
) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
  SELECT
    (SELECT count(*) FROM public.event_rsvps x
      WHERE x.event_id = p_event_id AND public.brand_form_subject_current('rsvp', x.id, p_event_id)
        AND (public.brand_form_find_response(p_form_id, 'rsvp', x.id)).id IS NULL)::integer
  + (SELECT count(*) FROM public.event_rsvp_guests g
       JOIN public.event_rsvps x ON x.id = g.rsvp_id
      WHERE x.event_id = p_event_id AND public.brand_form_subject_current('rsvp_guest', g.id, p_event_id)
        AND (public.brand_form_find_response(p_form_id, 'rsvp_guest', g.id)).id IS NULL)::integer
  + (SELECT count(*) FROM public.orders o
      WHERE o.event_id = p_event_id AND public.brand_form_subject_current('order', o.id, p_event_id)
        AND NOT public.brand_form_added_by_host('order', o.id)
        AND (public.brand_form_find_response(p_form_id, 'order', o.id)).id IS NULL)::integer;
$fn$;

-- R1.2: current holders with no response and no form request ever queued for them.
CREATE FUNCTION public.brand_form_not_asked_count(p_form_id uuid, p_event_id uuid) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
  SELECT
    (SELECT count(*) FROM public.event_rsvps x
      WHERE x.event_id = p_event_id AND public.brand_form_subject_current('rsvp', x.id, p_event_id)
        AND (public.brand_form_find_response(p_form_id, 'rsvp', x.id)).id IS NULL
        AND NOT EXISTS (SELECT 1 FROM public.brand_form_request_sends s
                         WHERE s.form_id = p_form_id AND s.event_id = p_event_id AND s.rsvp_id = x.id))::integer
  + (SELECT count(*) FROM public.event_rsvp_guests g
       JOIN public.event_rsvps x ON x.id = g.rsvp_id
      WHERE x.event_id = p_event_id AND public.brand_form_subject_current('rsvp_guest', g.id, p_event_id)
        AND (public.brand_form_find_response(p_form_id, 'rsvp_guest', g.id)).id IS NULL
        AND NOT EXISTS (SELECT 1 FROM public.brand_form_request_sends s
                         WHERE s.form_id = p_form_id AND s.event_id = p_event_id AND s.rsvp_guest_id = g.id))::integer
  + (SELECT count(*) FROM public.orders o
      WHERE o.event_id = p_event_id AND public.brand_form_subject_current('order', o.id, p_event_id)
        AND NOT public.brand_form_added_by_host('order', o.id)
        AND (public.brand_form_find_response(p_form_id, 'order', o.id)).id IS NULL
        AND NOT EXISTS (SELECT 1 FROM public.brand_form_request_sends s
                         WHERE s.form_id = p_form_id AND s.event_id = p_event_id AND s.order_id = o.id))::integer;
$fn$;

CREATE OR REPLACE FUNCTION public.biz_brand_form_counts(p_brand_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_pages jsonb;
  v_forms jsonb;
BEGIN
  PERFORM public.brand_form_require_rank(p_brand_id, 'marketing_manager');
  WITH pages AS (
    SELECT a.event_id, a.form_id, f.status AS form_status,
           (SELECT count(*) FROM public.brand_form_event_responses(a.form_id, a.event_id) r WHERE r.verified)::integer AS answered,
           CASE WHEN f.status = 'live' THEN public.brand_form_unanswered_count(a.form_id, a.event_id) ELSE 0 END AS to_answer,
           CASE WHEN f.status = 'live' THEN public.brand_form_not_asked_count(a.form_id, a.event_id) END AS not_asked
      FROM public.brand_form_attachments a
      JOIN public.brand_forms f ON f.id = a.form_id
      JOIN public.events e ON e.id = a.event_id AND e.deleted_at IS NULL
     WHERE a.brand_id = p_brand_id AND a.detached_at IS NULL AND f.brand_id = p_brand_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('eventId', p.event_id, 'formId', p.form_id,
           'formStatus', p.form_status, 'answered', p.answered, 'toAnswer', p.to_answer)
           || CASE WHEN p.not_asked IS NULL THEN '{}'::jsonb
                   ELSE jsonb_build_object('notAsked', p.not_asked) END
           ORDER BY p.event_id), '[]'::jsonb)
    INTO v_pages FROM pages p;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('formId', f.id,
           'answered', (SELECT count(*) FROM public.brand_form_event_responses(f.id, NULL) r WHERE r.verified)::integer,
           'toAnswer', COALESCE((SELECT sum((pg->>'toAnswer')::integer) FROM jsonb_array_elements(v_pages) pg
                                  WHERE (pg->>'formId')::uuid = f.id), 0)::integer,
           'pages', (SELECT count(*) FROM jsonb_array_elements(v_pages) pg WHERE (pg->>'formId')::uuid = f.id)::integer)
           ORDER BY f.id), '[]'::jsonb)
    INTO v_forms
    FROM public.brand_forms f WHERE f.brand_id = p_brand_id AND f.status <> 'archived';
  RETURN jsonb_build_object('forms', v_forms, 'pages', v_pages);
END;
$fn$;

-- Responses page (marketing_manager+). Rows come from brand_form_event_responses
-- (current holders only). Not answered: current RSVPs, claimed plus-ones of them
-- and current orders with no response; comps are "added by you" like door sales.
CREATE OR REPLACE FUNCTION public.biz_brand_form_responses(
  p_form_id uuid, p_event_id uuid DEFAULT NULL, p_filter text DEFAULT 'all',
  p_limit integer DEFAULT 50, p_offset integer DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_f record;
  v_rows jsonb;
  v_counts jsonb;
  v_total integer;
  v_versions jsonb;
  v_not jsonb := '[]'::jsonb;
BEGIN
  SELECT f.id, f.name, f.status, f.brand_id, f.live_version_id, f.door_full_answers INTO v_f
    FROM public.brand_forms f WHERE f.id = p_form_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'form_not_found' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.brand_form_require_rank(v_f.brand_id, 'marketing_manager');
  IF p_event_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.events e WHERE e.id = p_event_id AND e.brand_id = v_f.brand_id) THEN
    RAISE EXCEPTION 'brand_form_forbidden' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(p_filter, 'all') NOT IN ('all', 'earlier_version') THEN
    RAISE EXCEPTION 'filter_invalid' USING ERRCODE = '22023';
  END IF;

  SELECT count(*) INTO v_total
    FROM public.brand_form_event_responses(p_form_id, p_event_id) r
   WHERE COALESCE(p_filter, 'all') = 'all' OR r.version_id IS DISTINCT FROM v_f.live_version_id;

  SELECT COALESCE(jsonb_object_agg(q.qid, q.opts), '{}'::jsonb) INTO v_counts
    FROM (
      SELECT c.qid, jsonb_object_agg(c.oid, c.n) AS opts
        FROM (
          SELECT a.key AS qid, x.oid, count(*) AS n
            FROM (SELECT x.* FROM public.brand_form_event_responses(p_form_id, p_event_id) x WHERE COALESCE(p_filter, 'all') = 'all' OR x.version_id IS DISTINCT FROM v_f.live_version_id) r
            CROSS JOIN LATERAL jsonb_each(r.answers) a
            CROSS JOIN LATERAL (
              SELECT a.value #>> '{}' AS oid WHERE jsonb_typeof(a.value) = 'string'
              UNION ALL
              SELECT e.value #>> '{}' FROM jsonb_array_elements(CASE WHEN jsonb_typeof(a.value) = 'array' THEN a.value ELSE '[]'::jsonb END) e
            ) x
            JOIN public.brand_form_versions v ON v.id = r.version_id
           WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(v.definition->'questions') q
                          WHERE q.value->>'id' = a.key AND q.value->>'type' IN ('single_choice', 'multi_choice'))
           GROUP BY a.key, x.oid
        ) c GROUP BY c.qid
    ) q;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'responseId', r.id, 'versionId', r.version_id, 'version', v.version,
           'earlierVersion', r.version_id IS DISTINCT FROM v_f.live_version_id,
           'answers', r.answers, 'source', r.source, 'verified', r.verified, 'viaLink', r.via_link,
           'editCount', r.edit_count, 'submittedAt', r.submitted_at, 'updatedAt', r.updated_at,
           'subject', CASE
              WHEN r.rsvp_id IS NOT NULL THEN jsonb_build_object('kind', 'rsvp', 'id', r.rsvp_id,
                     'name', (SELECT x.guest_name FROM public.event_rsvps x WHERE x.id = r.rsvp_id))
              WHEN r.order_id IS NOT NULL THEN jsonb_build_object('kind', 'order', 'id', r.order_id,
                     'name', (SELECT o.buyer_name FROM public.orders o WHERE o.id = r.order_id))
              WHEN r.user_id IS NOT NULL THEN jsonb_build_object('kind', 'user', 'id', r.user_id)
              WHEN r.rsvp_guest_id IS NOT NULL THEN jsonb_build_object('kind', 'rsvp_guest', 'id', r.rsvp_guest_id)
              ELSE jsonb_build_object('kind', 'contact', 'name', r.contact_name) END,
           'holder', CASE WHEN p_event_id IS NOT NULL AND r.user_id IS NOT NULL THEN jsonb_build_object(
              'rsvpId', (SELECT x.id FROM public.event_rsvps x WHERE x.event_id = p_event_id AND x.user_id = r.user_id
                          ORDER BY x.created_at DESC LIMIT 1),
              'orderIds', COALESCE((SELECT jsonb_agg(o.id ORDER BY o.created_at) FROM public.orders o
                          WHERE o.event_id = p_event_id AND o.buyer_user_id = r.user_id
                            AND o.payment_status IN ('paid', 'partial_refund')), '[]'::jsonb)) END
         ) ORDER BY r.updated_at DESC, r.id), '[]'::jsonb) INTO v_rows
    FROM (SELECT * FROM (SELECT x.* FROM public.brand_form_event_responses(p_form_id, p_event_id) x WHERE COALESCE(p_filter, 'all') = 'all' OR x.version_id IS DISTINCT FROM v_f.live_version_id) s ORDER BY updated_at DESC, id
           LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200) OFFSET GREATEST(COALESCE(p_offset, 0), 0)) r
    JOIN public.brand_form_versions v ON v.id = r.version_id;

  IF p_event_id IS NOT NULL THEN
    SELECT COALESCE(jsonb_agg(n.item ORDER BY n.at), '[]'::jsonb) INTO v_not
      FROM (
        SELECT jsonb_build_object('kind', 'rsvp', 'id', x.id, 'name', x.guest_name, 'addedByHost', false) AS item, x.created_at AS at
          FROM public.event_rsvps x
         WHERE x.event_id = p_event_id AND public.brand_form_subject_current('rsvp', x.id, p_event_id)
           AND (public.brand_form_find_response(p_form_id, 'rsvp', x.id)).id IS NULL
        UNION ALL
        SELECT jsonb_build_object('kind', 'rsvp_guest', 'id', g.id,
                 'name', COALESCE(NULLIF(btrim(g.name), ''),
                   NULLIF(btrim(concat_ws(' ', pr.first_name, pr.last_name)), ''), pr.display_name),
                 'addedByHost', false), g.claimed_at
          FROM public.event_rsvp_guests g
          JOIN public.event_rsvps x ON x.id = g.rsvp_id
          LEFT JOIN public.profiles pr ON pr.id = g.matched_user_id
         WHERE x.event_id = p_event_id AND public.brand_form_subject_current('rsvp_guest', g.id, p_event_id)
           AND (public.brand_form_find_response(p_form_id, 'rsvp_guest', g.id)).id IS NULL
        UNION ALL
        SELECT jsonb_build_object('kind', 'order', 'id', o.id, 'name', o.buyer_name,
                 'addedByHost', public.brand_form_added_by_host('order', o.id)), o.created_at
          FROM public.orders o
         WHERE o.event_id = p_event_id AND public.brand_form_subject_current('order', o.id, p_event_id)
           AND (public.brand_form_find_response(p_form_id, 'order', o.id)).id IS NULL
      ) n;
  END IF;

  SELECT COALESCE(jsonb_object_agg(v.id, jsonb_build_object('version', v.version, 'definition', v.definition)), '{}'::jsonb)
    INTO v_versions FROM public.brand_form_versions v WHERE v.form_id = p_form_id;

  RETURN jsonb_build_object(
    'form', jsonb_build_object('id', v_f.id, 'name', v_f.name, 'status', v_f.status,
              'liveVersionId', v_f.live_version_id, 'doorFullAnswers', v_f.door_full_answers),
    'mode', (SELECT a.mode FROM public.brand_form_attachments a
              WHERE a.form_id = p_form_id AND a.event_id = p_event_id AND a.detached_at IS NULL),
    'versions', v_versions, 'total', v_total, 'answeredCount', v_total,
    'counts', v_counts, 'rows', v_rows, 'notAnswered', v_not);
END;
$fn$;

-- Attach: unchanged except "existing guests" counts current holders (R1.4).
CREATE OR REPLACE FUNCTION public.biz_brand_form_attach(
  p_form_id uuid, p_event_id uuid, p_mode text, p_auto_remind boolean DEFAULT false,
  p_expected_attachment_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_f record;
  v_e record;
  v_current uuid;
  v_id uuid;
  v_guests integer;
BEGIN
  SELECT e.id, e.brand_id, e.event_type, e.deleted_at INTO v_e FROM public.events e WHERE e.id = p_event_id FOR UPDATE;
  IF NOT FOUND OR v_e.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'event_not_found' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.brand_form_require_rank(v_e.brand_id, 'event_manager');
  SELECT f.id, f.brand_id, f.status INTO v_f FROM public.brand_forms f WHERE f.id = p_form_id;
  IF NOT FOUND OR v_f.brand_id <> v_e.brand_id THEN RAISE EXCEPTION 'form_not_found' USING ERRCODE = 'P0002'; END IF;
  IF v_f.status = 'archived' THEN RAISE EXCEPTION 'form_archived' USING ERRCODE = '22023'; END IF;
  IF p_mode IS NULL OR p_mode NOT IN ('optional_on_page', 'required_step', 'after_purchase') THEN
    RAISE EXCEPTION 'mode_invalid' USING ERRCODE = '22023';
  END IF;
  IF v_e.event_type = 'trip' AND p_mode IN ('optional_on_page', 'required_step') THEN
    RAISE EXCEPTION 'trip_uses_intake' USING ERRCODE = '22023';
  END IF;
  SELECT a.id INTO v_current FROM public.brand_form_attachments a
   WHERE a.event_id = p_event_id AND a.detached_at IS NULL FOR UPDATE;
  IF v_current IS DISTINCT FROM p_expected_attachment_id THEN
    RAISE EXCEPTION 'attachment_conflict' USING ERRCODE = 'PT409',
      DETAIL = jsonb_build_object('attachmentId', v_current)::text;
  END IF;
  IF v_current IS NOT NULL THEN
    UPDATE public.brand_form_attachments SET detached_at = now(), detached_by = auth.uid() WHERE id = v_current;
  END IF;
  INSERT INTO public.brand_form_attachments (form_id, brand_id, event_id, mode, auto_remind, created_by)
  VALUES (p_form_id, v_e.brand_id, p_event_id, p_mode, COALESCE(p_auto_remind, false), auth.uid())
  RETURNING id INTO v_id;
  -- For the "Ask earlier guests?" prompt: current holders of the page.
  SELECT (SELECT count(*) FROM public.event_rsvps r
           WHERE r.event_id = p_event_id AND public.brand_form_subject_current('rsvp', r.id, p_event_id))
       + (SELECT count(*) FROM public.orders o
           WHERE o.event_id = p_event_id AND public.brand_form_subject_current('order', o.id, p_event_id))
    INTO v_guests;
  RETURN jsonb_build_object('attachmentId', v_id, 'mode', p_mode, 'autoRemind', COALESCE(p_auto_remind, false),
    'autoRemindChannels', (SELECT to_jsonb(a.auto_remind_channels) FROM public.brand_form_attachments a WHERE a.id = v_id),
    'formStatus', v_f.status, 'replacedAttachmentId', v_current, 'existingGuests', v_guests,
    'earlierGuests', CASE WHEN v_f.status = 'live'
                          THEN COALESCE((SELECT (g->>'count')::integer FROM jsonb_array_elements(
                                 public.brand_form_earlier_guests(p_form_id, p_event_id)) g), 0)
                          ELSE 0 END);
END;
$fn$;

-- The roster export's answer columns: a person whose source link points at a
-- non-current RSVP or order gets no answer columns (R1.4).
CREATE OR REPLACE FUNCTION public.brand_form_roster_export_answers(p_job_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_event uuid;
  v_brand uuid;
  v_form uuid;
  v_multi boolean;
  v_cols jsonb;
  v_rows jsonb;
BEGIN
  SELECT j.scope_id, j.brand_id INTO v_event, v_brand
    FROM public.brand_people_export_jobs j
   WHERE j.id = p_job_id AND j.export_kind = 'offering_guest_roster';
  IF v_event IS NULL THEN RETURN jsonb_build_object('columns', '[]'::jsonb, 'rows', '{}'::jsonb); END IF;
  SELECT a.form_id INTO v_form FROM public.brand_form_active_for_event(v_event) a WHERE a.brand_id = v_brand;
  IF v_form IS NULL THEN RETURN jsonb_build_object('columns', '[]'::jsonb, 'rows', '{}'::jsonb); END IF;
  SELECT count(*) > 1 INTO v_multi FROM public.brand_form_versions v WHERE v.form_id = v_form;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('key', v.version || ':' || (q.value->>'id'),
           'header', CASE WHEN v_multi THEN (q.value->>'label') || ' (v' || v.version || ')' ELSE q.value->>'label' END)
           ORDER BY v.version, (q.value->>'position')::integer), '[]'::jsonb)
    INTO v_cols
    FROM public.brand_form_versions v
    CROSS JOIN LATERAL jsonb_array_elements(v.definition->'questions') q
   WHERE v.form_id = v_form;
  WITH people AS (
    SELECT l.brand_person_id AS person_id,
           (array_agg(l.source_id ORDER BY l.linked_at) FILTER (WHERE l.source_kind = 'event_rsvp'
              AND public.brand_form_subject_current('rsvp', l.source_id, v_event)))[1] AS rsvp_id,
           (array_agg(l.source_id ORDER BY l.linked_at) FILTER (WHERE l.source_kind = 'order'
              AND public.brand_form_subject_current('order', l.source_id, v_event)))[1] AS order_id
      FROM public.brand_person_source_links l
     WHERE l.brand_id = v_brand AND l.detached_at IS NULL AND l.source_kind IN ('event_rsvp', 'order')
     GROUP BY l.brand_person_id
  ), answered AS (
    SELECT p.person_id,
           CASE WHEN (public.brand_form_find_response(v_form, 'rsvp', p.rsvp_id)).id IS NOT NULL
                THEN public.brand_form_find_response(v_form, 'rsvp', p.rsvp_id)
                ELSE public.brand_form_find_response(v_form, 'order', p.order_id) END AS r
      FROM people p
     WHERE p.rsvp_id IS NOT NULL OR p.order_id IS NOT NULL
  )
  SELECT COALESCE(jsonb_object_agg(a.person_id, (
           SELECT COALESCE(jsonb_object_agg(v.version || ':' || (q.value->>'id'),
                    public.brand_form_answer_text(q.value, (a.r).answers->(q.value->>'id'))), '{}'::jsonb)
             FROM public.brand_form_versions v
             CROSS JOIN LATERAL jsonb_array_elements(v.definition->'questions') q
            WHERE v.id = (a.r).version_id AND (a.r).answers ? (q.value->>'id'))), '{}'::jsonb)
    INTO v_rows
    FROM answered a
   WHERE (a.r).id IS NOT NULL AND (a.r).verified;
  RETURN jsonb_build_object('formId', v_form, 'columns', v_cols, 'rows', v_rows);
END;
$fn$;

-- The signed-in form view: approved Going and Maybe holders, claimed plus-ones
-- of them, paid orders and valid tickets may open the page's form (R1.4).
CREATE OR REPLACE FUNCTION public.brand_form_my_response(
  p_form_id uuid, p_event_id uuid DEFAULT NULL, p_token text DEFAULT NULL, p_challenge_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_f record;
  v_link record;
  v_subject jsonb;
  v_resp record;
  v_def jsonb;
  v_state text;
  v_identity text;
  v_uid uuid := auth.uid();
  v_event uuid := p_event_id;
BEGIN
  SELECT f.id, f.name, f.status, f.brand_id, f.live_version_id, f.door_full_answers INTO v_f
    FROM public.brand_forms f WHERE f.id = p_form_id AND f.status IN ('live', 'closed');
  IF NOT FOUND THEN RAISE EXCEPTION 'form_not_found' USING ERRCODE = 'P0002'; END IF;
  SELECT v.definition INTO v_def FROM public.brand_form_versions v WHERE v.id = v_f.live_version_id;

  IF p_token IS NOT NULL THEN
    SELECT l.id, l.form_id, l.revoked_at, l.expires_at, l.event_id,
           public.brand_form_link_subject(l) AS subject
      INTO v_link FROM public.brand_form_link_by_token(p_token) l;
    IF v_link.id IS NULL OR v_link.form_id <> p_form_id THEN
      RAISE EXCEPTION 'link_invalid' USING ERRCODE = '42501';
    END IF;
    IF v_link.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'link_revoked' USING ERRCODE = '42501'; END IF;
    v_subject := v_link.subject;
    IF v_subject IS NULL THEN RAISE EXCEPTION 'link_invalid' USING ERRCODE = '42501'; END IF;
    SELECT r.id, r.version_id, r.answers, r.edit_count, r.updated_at INTO v_resp
      FROM public.brand_form_person_response(
        p_form_id, v_subject->>'kind', (v_subject->>'id')::uuid, v_link.event_id) r;
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
    SELECT r.id, r.version_id, r.answers, r.edit_count, r.updated_at INTO v_resp
      FROM public.brand_form_person_response(p_form_id, 'user', v_uid, v_event) r;
    IF v_resp.id IS NULL AND NOT (v_event IS NOT NULL AND EXISTS (
         SELECT 1 FROM public.brand_form_attachments a
          WHERE a.event_id = v_event AND a.form_id = p_form_id AND a.detached_at IS NULL
            AND (public.brand_form_subject_current('user', v_uid, v_event)
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

-- The "to answer" cards: approved Going and Maybe RSVPs, claimed plus-ones of
-- them, and paid orders. Ended and cancelled events stay for 30 days after
-- they end (design v10 B: "Answers closed · View"), with their status.
CREATE OR REPLACE FUNCTION public.brand_forms_my_pending() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE v_uid uuid := auth.uid(); v_out jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_signed_in' USING ERRCODE = '42501'; END IF;
  IF public.brand_forms_switched_off() THEN RETURN '[]'::jsonb; END IF;
  WITH held AS (
    SELECT r.event_id, 'rsvp'::text AS kind, r.id AS subject_id
      FROM public.event_rsvps r
     WHERE r.user_id = v_uid AND public.brand_form_subject_current('rsvp', r.id, r.event_id)
    UNION ALL
    SELECT r.event_id, 'rsvp_guest', g.id
      FROM public.event_rsvp_guests g JOIN public.event_rsvps r ON r.id = g.rsvp_id
     WHERE g.matched_user_id = v_uid AND g.claimed_at IS NOT NULL
       AND public.brand_form_subject_current('rsvp_guest', g.id, r.event_id)
    UNION ALL
    SELECT o.event_id, 'order', o.id FROM public.orders o
     WHERE o.buyer_user_id = v_uid AND o.payment_status IN ('paid', 'partial_refund')
  ), items AS (
    SELECT h.event_id, h.kind, h.subject_id, e.status AS event_status, a.*
      FROM held h
      JOIN public.events e ON e.id = h.event_id AND e.deleted_at IS NULL
       AND (e.status IN ('scheduled', 'live')
         OR (e.status IN ('ended', 'cancelled')
             AND COALESCE((SELECT max(d.end_at) FROM public.event_dates d WHERE d.event_id = e.id),
                          e.updated_at) > now() - interval '30 days'))
      CROSS JOIN LATERAL public.brand_form_active_for_event(h.event_id) a
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'eventId', i.event_id, 'eventTitle', (SELECT e.title FROM public.events e WHERE e.id = i.event_id),
           'eventStatus', i.event_status,
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

-- ---------------------------------------------------------------------------
-- 4. Form requests: current holders (R1.4), comps (R1.5), the off switch (R1.8)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.brand_form_request_guests(
  p_form_id uuid, p_event_id uuid, p_subjects jsonb DEFAULT NULL
) RETURNS TABLE (g_kind text, g_id uuid, g_user_id uuid, g_name text, g_answered boolean,
                 g_phone text, g_email text, g_person_key text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
  WITH guests AS (
    SELECT 'rsvp'::text AS kind, x.id, x.user_id, x.guest_name AS name,
           (public.brand_form_find_response(p_form_id, 'rsvp', x.id)).id IS NOT NULL AS answered
      FROM public.event_rsvps x
     WHERE x.event_id = p_event_id AND public.brand_form_subject_current('rsvp', x.id, p_event_id)
    UNION ALL
    SELECT 'rsvp_guest', g.id, g.matched_user_id,
           COALESCE(NULLIF(btrim(g.name), ''),
             NULLIF(btrim(concat_ws(' ', pr.first_name, pr.last_name)), ''), pr.display_name),
           (public.brand_form_find_response(p_form_id, 'rsvp_guest', g.id)).id IS NOT NULL
      FROM public.event_rsvp_guests g
      JOIN public.event_rsvps x ON x.id = g.rsvp_id
      LEFT JOIN public.profiles pr ON pr.id = g.matched_user_id
     WHERE x.event_id = p_event_id AND public.brand_form_subject_current('rsvp_guest', g.id, p_event_id)
    UNION ALL
    SELECT 'order', o.id, o.buyer_user_id, o.buyer_name,
           (public.brand_form_find_response(p_form_id, 'order', o.id)).id IS NOT NULL
      FROM public.orders o
     WHERE o.event_id = p_event_id AND public.brand_form_subject_current('order', o.id, p_event_id)
  ), picked AS (
    SELECT g.*, public.brand_form_subject_contact(g.kind, g.id) AS contact FROM guests g
     WHERE p_subjects IS NULL OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_subjects) s
                                          WHERE s->>'kind' = g.kind AND lower(s->>'id') = g.id::text)
  )
  SELECT p.kind, p.id, p.user_id, p.name, p.answered, p.contact->>'phone', p.contact->>'email',
         public.brand_form_person_key(p.user_id, p.kind, p.id)
    FROM picked p;
$fn$;

-- "Hasn't answered" leaves out guests the host added (door sale, import, comp);
-- "Everyone going" keeps them, so the host can ask them on purpose (R1.5).
CREATE OR REPLACE FUNCTION public.brand_form_request_audience(
  p_actor_id uuid, p_form_id uuid, p_event_id uuid, p_audience text DEFAULT 'unanswered',
  p_subjects jsonb DEFAULT NULL, p_channels text[] DEFAULT ARRAY['email', 'sms']
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_e record; v_f record; v_att uuid; v_rows jsonb; v_n integer;
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
  SELECT f.id, f.name, f.status INTO v_f FROM public.brand_forms f WHERE f.id = p_form_id AND f.brand_id = v_e.brand_id;
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
    SELECT p.* FROM people p
     WHERE p_audience = 'everyone'
        OR (NOT p.g_answered AND NOT public.brand_form_added_by_host(p.g_kind, p.g_id))
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
  -- R1.8: the off switch stops every new form request.
  IF public.brand_forms_switched_off() THEN
    RAISE EXCEPTION 'forms_paused' USING ERRCODE = '55000';
  END IF;
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
  -- R1.8: switched off, nothing is claimed and every row stays queued.
  IF public.brand_forms_switched_off() THEN RETURN '[]'::jsonb; END IF;
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
    -- R1.4: re-checked at claim; a guest who stopped being current is skipped.
    IF NOT public.brand_form_subject_current(v_subject_kind, v_subject_id, v_row.event_id) THEN
      UPDATE public.brand_form_request_sends
         SET status = 'skipped', safe_reason = 'not_current', settled_at = now() WHERE id = v_row.id;
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

CREATE OR REPLACE FUNCTION public.brand_form_auto_reminders_due() RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_a record; v_d record; v_run uuid; v_ch text[]; v_n integer; v_left integer;
  v_runs integer := 0; v_queued integer := 0; v_held integer := 0;
BEGIN
  -- R1.8: switched off, no automatic reminder is queued.
  IF public.brand_forms_switched_off() THEN RETURN '[]'::jsonb; END IF;
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
                           AND NOT public.brand_form_added_by_host(x.g_kind, x.g_id)
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

-- ---------------------------------------------------------------------------
-- 5. Links (R8.2) and the submit core (R1.4, R8.1)
-- ---------------------------------------------------------------------------
-- A new personal link switches off the same person's earlier links for this
-- form (and, for page links, this page). Recognition (expires_at) is unchanged.
CREATE OR REPLACE FUNCTION public.brand_form_link_issue(
  p_form_id uuid, p_event_id uuid, p_subject jsonb, p_created_by uuid DEFAULT NULL, p_ttl_days integer DEFAULT 30
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_f record; v_kind text := p_subject->>'kind'; v_id uuid; v_event uuid;
  v_token text; v_link uuid; v_exp timestamptz; v_att uuid;
BEGIN
  SELECT f.id, f.brand_id, f.status INTO v_f FROM public.brand_forms f
   WHERE f.id = p_form_id AND f.status IN ('live', 'closed');
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
  -- R8.2: the newest link is the only one that works.
  UPDATE public.brand_form_links l
     SET revoked_at = now()
   WHERE l.form_id = p_form_id AND l.id <> v_link AND l.revoked_at IS NULL AND l.kind = 'person'
     AND l.event_id IS NOT DISTINCT FROM p_event_id
     AND CASE v_kind
           WHEN 'rsvp' THEN l.rsvp_id = v_id
           WHEN 'rsvp_guest' THEN l.rsvp_guest_id = v_id
           WHEN 'order' THEN l.order_id = v_id
           ELSE l.user_id = v_id END;
  RETURN jsonb_build_object('linkId', v_link, 'token', v_token, 'expiresAt', v_exp, 'formId', p_form_id);
END;
$fn$;

-- p: {formId, versionId?, eventId?, answers, source, expectedEditCount?,
--     credential: {kind:'link', token, challengeId?} | {kind:'user', userId, rsvpId?, rsvpGuestId?, orderId?}}
-- R1.4: an RSVP, plus-one or order credential must be current (else not_current).
-- R8.1: a signed-in answer with no subject follows the read rule
-- (brand_form_my_response): an existing response, a current holder or valid
-- ticket at the page, or an optional form on a public page; else not_holder.
CREATE OR REPLACE FUNCTION public.brand_form_submit_core(p jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_form_id uuid; v_f record; v_cred jsonb := p->'credential';
  v_link record; v_kind text; v_sid uuid; v_user uuid; v_event uuid; v_att uuid; v_mode text;
  v_version uuid; v_check jsonb; v_ex record;
  v_source text := COALESCE(p->>'source', 'page'); v_via_link boolean := false;
  v_id uuid; v_edit integer; v_expected integer; v_link_id uuid; v_link_exp timestamptz;
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
  SELECT f.id, f.status, f.brand_id, f.live_version_id INTO v_f
    FROM public.brand_forms f WHERE f.id = v_form_id FOR SHARE;
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
    SELECT l.id, l.form_id, l.revoked_at, l.kind, l.event_id, l.expires_at,
           public.brand_form_link_subject(l) AS subject
      INTO v_link FROM public.brand_form_link_by_token(v_cred->>'token') l;
    IF v_link.id IS NULL THEN RAISE EXCEPTION 'link_invalid' USING ERRCODE = '42501'; END IF;
    IF v_link.form_id <> v_form_id THEN RAISE EXCEPTION 'link_wrong_form' USING ERRCODE = '42501'; END IF;
    IF v_link.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'link_revoked' USING ERRCODE = '42501'; END IF;
    IF v_link.kind <> 'person' THEN RAISE EXCEPTION 'subject_unavailable' USING ERRCODE = '22023'; END IF;
    v_kind := v_link.subject->>'kind';
    v_sid := (v_link.subject->>'id')::uuid;
    v_event := v_link.event_id;
    v_link_id := v_link.id; v_link_exp := v_link.expires_at;
    v_via_link := true;
  ELSIF v_cred->>'kind' = 'user' THEN
    IF (v_cred->>'userId') !~ v_uuid THEN RAISE EXCEPTION 'credential_invalid' USING ERRCODE = '22023'; END IF;
    v_user := (v_cred->>'userId')::uuid;
    IF (v_cred->>'rsvpGuestId') ~ v_uuid THEN
      v_kind := 'rsvp_guest'; v_sid := (v_cred->>'rsvpGuestId')::uuid;
      SELECT r.event_id INTO v_event
        FROM public.event_rsvp_guests g JOIN public.event_rsvps r ON r.id = g.rsvp_id
       WHERE g.id = v_sid AND g.matched_user_id = v_user AND g.claimed_at IS NOT NULL;
      IF NOT FOUND THEN RAISE EXCEPTION 'not_holder' USING ERRCODE = '42501'; END IF;
      IF NOT public.brand_form_subject_current('rsvp_guest', v_sid, v_event) THEN
        RAISE EXCEPTION 'not_current' USING ERRCODE = '42501';
      END IF;
    ELSIF (v_cred->>'rsvpId') ~ v_uuid THEN
      v_kind := 'rsvp'; v_sid := (v_cred->>'rsvpId')::uuid;
      SELECT r.event_id INTO v_event FROM public.event_rsvps r WHERE r.id = v_sid AND r.user_id = v_user;
      IF NOT FOUND THEN RAISE EXCEPTION 'not_holder' USING ERRCODE = '42501'; END IF;
      IF NOT public.brand_form_subject_current('rsvp', v_sid, v_event) THEN
        RAISE EXCEPTION 'not_current' USING ERRCODE = '42501';
      END IF;
    ELSIF (v_cred->>'orderId') ~ v_uuid THEN
      v_kind := 'order'; v_sid := (v_cred->>'orderId')::uuid;
      SELECT o.event_id INTO v_event FROM public.orders o WHERE o.id = v_sid AND o.buyer_user_id = v_user;
      IF NOT FOUND THEN RAISE EXCEPTION 'not_holder' USING ERRCODE = '42501'; END IF;
      IF NOT public.brand_form_subject_current('order', v_sid, v_event) THEN
        RAISE EXCEPTION 'not_current' USING ERRCODE = '42501';
      END IF;
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
    SELECT a.id, a.mode INTO v_att, v_mode FROM public.brand_form_attachments a
     WHERE a.event_id = v_event AND a.form_id = v_form_id AND a.detached_at IS NULL;
    IF v_att IS NULL THEN RAISE EXCEPTION 'form_not_on_event' USING ERRCODE = '42501'; END IF;
  END IF;

  PERFORM pg_advisory_xact_lock(public.brand_form_person_lock_key(v_form_id, v_kind, v_sid));
  SELECT r.id, r.edit_count INTO v_ex
    FROM public.brand_form_person_response(v_form_id, v_kind, v_sid, v_event) r;
  -- R8.1: the same rule the signed-in read applies.
  IF NOT v_via_link AND v_kind = 'user' AND v_ex.id IS NULL AND NOT (
       public.brand_form_subject_current('user', v_user, v_event)
    OR EXISTS (SELECT 1 FROM public.tickets t
                WHERE t.event_id = v_event AND t.holder_user_id = v_user AND t.status IN ('valid', 'used'))
    OR (v_mode = 'optional_on_page' AND public.brand_form_event_public(v_event))) THEN
    RAISE EXCEPTION 'not_holder' USING ERRCODE = '42501';
  END IF;
  IF v_via_link AND (v_ex.id IS NOT NULL OR v_link_exp <= now())
     AND NOT public.brand_form_code_grant_ok(v_link_id,
       CASE WHEN (v_cred->>'challengeId') ~ v_uuid THEN (v_cred->>'challengeId')::uuid END) THEN
    RAISE EXCEPTION 'code_required' USING ERRCODE = '42501';
  END IF;
  v_expected := CASE WHEN jsonb_typeof(p->'expectedEditCount') = 'number'
                          AND (p->>'expectedEditCount') ~ '^[0-9]{1,9}$'
                     THEN (p->>'expectedEditCount')::integer
                     WHEN jsonb_typeof(p->'expectedEditCount') = 'number' THEN -1 END;
  IF (v_expected IS NOT NULL AND (v_ex.id IS NULL OR v_ex.edit_count <> v_expected))
     OR (v_expected IS NULL AND v_ex.id IS NOT NULL) THEN
    RAISE EXCEPTION 'response_stale' USING ERRCODE = 'PT409',
      DETAIL = jsonb_build_object('editCount', v_ex.edit_count)::text;
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

  IF v_ex.id IS NULL THEN
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
     WHERE id = v_ex.id
    RETURNING id, edit_count INTO v_id, v_edit;
  END IF;
  IF v_via_link THEN
    UPDATE public.brand_form_links SET use_count = use_count + 1, last_used_at = now() WHERE id = v_link_id;
  END IF;
  RETURN jsonb_build_object('responseId', v_id, 'editCount', v_edit, 'versionId', v_version,
                            'created', v_ex.id IS NULL, 'eventId', v_event);
END;
$fn$;

-- ---------------------------------------------------------------------------
-- 6. The door (R1.4, R1.5, R8.3)
-- ---------------------------------------------------------------------------
-- The automatic line: never drawn for a guest who is not current, and a comp,
-- door sale or import is never "not answered".
CREATE OR REPLACE FUNCTION public.brand_form_door_answers(
  p_actor_id uuid, p_event_id uuid, p_subject jsonb
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_kind text := p_subject->>'kind'; v_sid uuid; v_ticket uuid; v_a record;
  v_rid uuid; v_rver uuid; v_rans jsonb;
  v_answered jsonb; v_live jsonb; v_items jsonb;
  v_from text; v_rank integer; v_invited boolean;
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
  -- R1.4: a guest who is not current has no door line at all.
  IF NOT public.brand_form_subject_current(v_kind, v_sid, p_event_id) THEN RETURN NULL; END IF;
  SELECT * INTO v_a FROM public.brand_form_active_for_event(p_event_id);
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT r.id, r.version_id, r.answers INTO v_rid, v_rver, v_rans
    FROM public.brand_form_find_response(v_a.form_id, v_kind, v_sid) r;
  IF v_ticket IS NOT NULL AND EXISTS (SELECT 1 FROM public.tickets t
       WHERE t.id = v_ticket AND (t.transferred_at IS NOT NULL OR t.status = 'transferred')) THEN
    v_rid := NULL;
  END IF;
  IF v_rid IS NULL THEN
    IF v_a.form_status = 'live' AND v_a.mode IN ('required_step', 'after_purchase')
       AND NOT public.brand_form_added_by_host(v_kind, v_sid) THEN
      RETURN jsonb_build_object('state', 'not_answered', 'formName', v_a.form_name);
    END IF;
    RETURN NULL;
  END IF;
  SELECT v.definition INTO v_answered FROM public.brand_form_versions v WHERE v.id = v_rver;
  SELECT v.definition INTO v_live FROM public.brand_form_versions v WHERE v.id = v_a.live_version_id;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'label', public.brand_form_cut(
             COALESCE(NULLIF(btrim(q.value->>'door_label'), ''), q.value->>'label'), 40),
           'value', public.brand_form_cut(
             public.brand_form_answer_text(q.value, v_rans->(q.value->>'id')), 60))
           ORDER BY (q.value->>'position')::integer), '[]'::jsonb)
    INTO v_items FROM jsonb_array_elements(v_answered->'questions') q
   WHERE COALESCE((q.value->>'show_at_door')::boolean, false)
     AND EXISTS (SELECT 1 FROM jsonb_array_elements(v_live->'questions') l
                  WHERE l.value->>'id' = q.value->>'id'
                    AND COALESCE((l.value->>'show_at_door')::boolean, false))
     AND public.brand_form_answer_text(q.value, v_rans->(q.value->>'id')) IS NOT NULL;
  IF jsonb_array_length(v_items) = 0 THEN RETURN NULL; END IF;
  IF v_ticket IS NOT NULL THEN v_from := public.brand_form_door_order_header(v_sid, v_ticket); END IF;
  SELECT f.door_full_answers_invited INTO v_invited FROM public.brand_forms f WHERE f.id = v_a.form_id;
  RETURN jsonb_strip_nulls(jsonb_build_object(
    'state', 'answered', 'formName', v_a.form_name, 'fromOrderOf', v_from,
    'fullAnswers', public.brand_form_door_full_scope(
                     p_actor_id, p_event_id, v_rank, v_a.door_full_answers, v_invited) IS NOT NULL,
    'items', (SELECT jsonb_agg(x.value) FROM jsonb_array_elements(v_items) WITH ORDINALITY x
               WHERE x.ordinality <= 3)));
END;
$fn$;

-- One current guest of this event per call, logged. R8.3: full answers for
-- event managers; for the brand's team when the form allows it; for invited
-- scan-only staff only when the host also turned "Invited door staff can too"
-- on. Everyone else gets the line. 60 reads per 10 minutes for managers, 20 for
-- everyone else, and at most 3 full reads of one guest per actor per day.
CREATE OR REPLACE FUNCTION public.brand_form_door_full_answers(
  p_actor_id uuid, p_event_id uuid, p_subject jsonb, p_via text DEFAULT 'scan'
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_kind text := p_subject->>'kind'; v_sid uuid; v_rank integer; v_a record; v_found boolean;
  v_rid uuid; v_rver uuid; v_rans jsonb; v_rat timestamptz;
  v_def jsonb; v_questions jsonb; v_result text;
  v_out jsonb; v_ticket uuid; v_from text; v_scope text; v_invited boolean;
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
  IF NOT public.brand_form_subject_current(v_kind, v_sid, p_event_id) THEN
    RAISE EXCEPTION 'subject_not_current' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('brand_form_door_reads:' || p_actor_id::text, 0));
  IF (SELECT count(*) FROM public.brand_form_door_reads d
       WHERE d.actor_id = p_actor_id AND d.created_at > now() - interval '10 minutes')
       >= (CASE WHEN v_rank >= public.biz_role_rank('event_manager') THEN 60 ELSE 20 END)
     OR (SELECT count(*) FROM public.brand_form_door_reads d
          WHERE d.actor_id = p_actor_id AND d.subject_id = v_sid AND d.result = 'full'
            AND d.created_at > now() - interval '24 hours') >= 3 THEN
    INSERT INTO public.brand_form_door_reads (
      actor_id, event_id, subject_kind, subject_id, via, result)
    VALUES (p_actor_id, p_event_id, v_kind, v_sid, p_via, 'rate_limited');
    RETURN jsonb_build_object('state', 'rate_limited');
  END IF;
  SELECT * INTO v_a FROM public.brand_form_active_for_event(p_event_id);
  v_found := FOUND;
  IF NOT v_found OR public.brand_forms_switched_off() THEN
    v_result := 'no_form'; v_out := jsonb_build_object('state', 'no_form');
  ELSE
    SELECT r.id, r.version_id, r.answers, r.updated_at INTO v_rid, v_rver, v_rans, v_rat
      FROM public.brand_form_find_response(v_a.form_id, v_kind, v_sid) r;
    IF v_ticket IS NOT NULL AND EXISTS (SELECT 1 FROM public.tickets t
         WHERE t.id = v_ticket AND (t.transferred_at IS NOT NULL OR t.status = 'transferred')) THEN
      v_rid := NULL;
    END IF;
    IF v_ticket IS NOT NULL THEN v_from := public.brand_form_door_order_header(v_sid, v_ticket); END IF;
    SELECT f.door_full_answers_invited INTO v_invited FROM public.brand_forms f WHERE f.id = v_a.form_id;
    v_scope := public.brand_form_door_full_scope(p_actor_id, p_event_id, v_rank, v_a.door_full_answers, v_invited);
    IF v_rid IS NULL THEN
      v_result := 'not_answered';
      v_out := jsonb_build_object('state', 'not_answered', 'formName', v_a.form_name,
                 'brand', public.brand_form_brand_header(v_a.brand_id));
    ELSIF v_scope IS NULL THEN
      v_result := 'line_only';
      v_out := jsonb_build_object('state', 'line_only', 'formName', v_a.form_name,
                 'line', public.brand_form_door_answers(p_actor_id, p_event_id, p_subject));
    ELSE
      v_result := 'full';
      SELECT v.definition INTO v_def FROM public.brand_form_versions v WHERE v.id = v_rver;
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'id', q.value->>'id', 'label', q.value->>'label', 'type', q.value->>'type',
               'value', public.brand_form_answer_text(q.value, v_rans->(q.value->>'id')))
               ORDER BY (q.value->>'position')::integer), '[]'::jsonb)
        INTO v_questions FROM jsonb_array_elements(v_def->'questions') q
       WHERE q.value->>'type' <> 'file_upload';
      v_out := jsonb_strip_nulls(jsonb_build_object(
        'state', 'answered', 'formName', v_a.form_name,
        'brand', public.brand_form_brand_header(v_a.brand_id), 'answeredAt', v_rat,
        'isCurrentVersion', v_rver = v_a.live_version_id, 'fromOrderOf', v_from,
        'questions', v_questions,
        'definition', jsonb_set(v_def, '{questions}', COALESCE((SELECT jsonb_agg(
          q.value ORDER BY (q.value->>'position')::integer)
          FROM jsonb_array_elements(v_def->'questions') q
          WHERE q.value->>'type' <> 'file_upload'), '[]'::jsonb)),
        'answers', COALESCE((SELECT jsonb_object_agg(a.key, a.value)
          FROM jsonb_each(v_rans) a WHERE EXISTS (
            SELECT 1 FROM jsonb_array_elements(v_def->'questions') q
             WHERE q.value->>'id' = a.key AND q.value->>'type' <> 'file_upload')), '{}'::jsonb)));
    END IF;
  END IF;
  INSERT INTO public.brand_form_door_reads (
    actor_id, event_id, form_id, subject_kind, subject_id, via, result)
  VALUES (p_actor_id, p_event_id, CASE WHEN v_found THEN v_a.form_id END, v_kind, v_sid, p_via, v_result);
  RETURN v_out;
END;
$fn$;

-- R8.3: the host switch for invited scan-only staff (event_manager+).
CREATE FUNCTION public.biz_brand_form_set_door_invited(p_form_id uuid, p_on boolean) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE v_brand uuid;
BEGIN
  SELECT f.brand_id INTO v_brand FROM public.brand_forms f WHERE f.id = p_form_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'form_not_found' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.brand_form_require_rank(v_brand, 'event_manager');
  IF p_on IS NULL THEN RAISE EXCEPTION 'value_required' USING ERRCODE = '22023'; END IF;
  UPDATE public.brand_forms SET door_full_answers_invited = p_on, updated_by = auth.uid(), updated_at = now()
   WHERE id = p_form_id;
  RETURN jsonb_build_object('doorFullAnswersInvited', p_on);
END;
$fn$;

-- R8.3: the host-readable door-read log for one page (event_manager+). Names only.
CREATE FUNCTION public.biz_brand_form_door_reads(
  p_event_id uuid, p_limit integer DEFAULT 50, p_before timestamptz DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE v_brand uuid;
BEGIN
  SELECT e.brand_id INTO v_brand FROM public.events e WHERE e.id = p_event_id AND e.deleted_at IS NULL;
  IF v_brand IS NULL THEN RAISE EXCEPTION 'event_not_found' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.brand_form_require_rank(v_brand, 'event_manager');
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'limit_invalid' USING ERRCODE = '22023';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'at', d.created_at,
             'actorName', public.brand_form_short_name(COALESCE(
               NULLIF(btrim(concat_ws(' ', pr.first_name, pr.last_name)), ''), pr.display_name)),
             'guestName', public.brand_form_short_name(
               public.brand_form_subject_contact(d.subject_kind, d.subject_id)->>'name'),
             'via', d.via, 'result', d.result)
           ORDER BY d.created_at DESC, d.id DESC)
      FROM (SELECT * FROM public.brand_form_door_reads d0
             WHERE d0.event_id = p_event_id AND (p_before IS NULL OR d0.created_at < p_before)
             ORDER BY d0.created_at DESC, d0.id DESC LIMIT p_limit) d
      LEFT JOIN public.profiles pr ON pr.id = d.actor_id), '[]'::jsonb);
END;
$fn$;

-- ---------------------------------------------------------------------------
-- 7. Checkout: insert-only finalize (R1.1), retry sweep (R1.7)
-- ---------------------------------------------------------------------------
-- I-4541-CHECKOUT-ANSWER-INSERT-ONLY: one stash becomes the order's response
-- only when the buyer has no response "at this event" (the five rules of
-- submit_event_rsvp_with_form, with the order in place of the RSVP). It never
-- updates a response. Non-waiting locks only: 'busy' when the stash row or the
-- person is locked; the stash then stays for the sweep.
CREATE FUNCTION public.brand_form_promote_stash(p_checkout_session_id uuid) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_s record;
  v_order uuid;
  v_buyer uuid;
  v_brand uuid;
  v_existing uuid;
  v_new uuid;
BEGIN
  BEGIN
    SELECT c.form_id, c.version_id, c.event_id, c.attachment_id, c.answers INTO v_s
      FROM public.brand_form_checkout_answers c
     WHERE c.checkout_session_id = p_checkout_session_id FOR UPDATE NOWAIT;
  EXCEPTION WHEN lock_not_available THEN
    RETURN 'busy';
  END;
  IF NOT FOUND THEN RETURN 'skipped'; END IF;
  SELECT s.order_id INTO v_order FROM public.ticket_checkout_sessions s WHERE s.id = p_checkout_session_id;
  IF v_order IS NULL THEN RETURN 'skipped'; END IF;
  -- Review fix 4: an order that is no longer paid (refunded or cancelled before
  -- the sweep reached it) never gains an answer row; its stash is dropped.
  IF NOT EXISTS (SELECT 1 FROM public.orders o
                  WHERE o.id = v_order AND o.payment_status IN ('paid', 'partial_refund')) THEN
    DELETE FROM public.brand_form_checkout_answers WHERE checkout_session_id = p_checkout_session_id;
    RETURN 'skipped';
  END IF;
  IF NOT pg_try_advisory_xact_lock(public.brand_form_person_lock_key(v_s.form_id, 'order', v_order)) THEN
    RETURN 'busy';
  END IF;
  SELECT o.buyer_user_id INTO v_buyer FROM public.orders o WHERE o.id = v_order;
  SELECT r.id INTO v_existing FROM public.brand_form_responses r
   WHERE r.form_id = v_s.form_id AND r.order_id = v_order;
  IF v_existing IS NULL THEN
    v_existing := public.brand_form_person_row_at_event(v_s.form_id, v_buyer, v_s.event_id);
  END IF;
  IF v_existing IS NULL AND NOT public.brand_form_answers_empty(v_s.answers) THEN
    SELECT f.brand_id INTO v_brand FROM public.brand_forms f WHERE f.id = v_s.form_id;
    INSERT INTO public.brand_form_responses (form_id, version_id, brand_id, attachment_id, event_id,
                                             order_id, answers, source)
    VALUES (v_s.form_id, v_s.version_id, v_brand, v_s.attachment_id, v_s.event_id,
            v_order, v_s.answers, 'page')
    ON CONFLICT (form_id, order_id) WHERE order_id IS NOT NULL DO NOTHING
    RETURNING id INTO v_new;
  END IF;
  DELETE FROM public.brand_form_checkout_answers WHERE checkout_session_id = p_checkout_session_id;
  RETURN CASE WHEN v_new IS NOT NULL THEN 'promoted' ELSE 'skipped' END;
END;
$fn$;

-- The promotion, in the transaction that sets the session's order (paid and
-- free). Only the null/unchanged guard sits outside the guarded block; every
-- lookup, lock and write is inside it, so a failure is a WARNING and the order
-- commits exactly as it would without this trigger. The stash row stays for
-- the retry sweep (brand_form_checkout_answers_retry).
CREATE OR REPLACE FUNCTION public.brand_form_finalize_checkout_answers() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_outcome text;
BEGIN
  IF NEW.order_id IS NULL OR NEW.order_id IS NOT DISTINCT FROM OLD.order_id THEN
    RETURN NEW;
  END IF;
  BEGIN
    -- One primary-key probe; no stash (every order of a page without a form): done.
    IF EXISTS (SELECT 1 FROM public.brand_form_checkout_answers WHERE checkout_session_id = NEW.id) THEN
      v_outcome := public.brand_form_promote_stash(NEW.id);
      IF v_outcome = 'busy' THEN
        RAISE WARNING '#4541 brand_form_finalize_checkout_answers busy for session % (order %): left for the sweep',
          NEW.id, NEW.order_id;
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '#4541 brand_form_finalize_checkout_answers skipped for session % (order %): % (%)',
      NEW.id, NEW.order_id, SQLERRM, SQLSTATE;
  END;
  RETURN NEW;
END;
$fn$;

-- R1.7: promote stash rows whose session got its order more than two minutes
-- ago and are still here (a busy lock or an error at finalize). One row per
-- sub-transaction; SKIP LOCKED and try-locks only, so the sweep never waits on
-- a live checkout or a guest's edit. stuck: rows tried 5 times or 30 minutes old.
-- Review fix 6: a short lock_timeout, so a row lock held by a refund (the
-- answer's foreign key reads the order row) is a "busy" retry, never a wait.
CREATE FUNCTION public.brand_form_checkout_answers_retry(p_limit integer DEFAULT 50) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' SET lock_timeout = '2s'
AS $fn$
DECLARE
  v_row record; v_outcome text;
  v_promoted integer := 0; v_skipped integer := 0; v_failed integer := 0; v_stuck integer;
BEGIN
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'limit_invalid' USING ERRCODE = '22023';
  END IF;
  FOR v_row IN
    SELECT c.checkout_session_id
      FROM public.brand_form_checkout_answers c
      JOIN public.ticket_checkout_sessions s ON s.id = c.checkout_session_id
     WHERE s.order_id IS NOT NULL AND c.updated_at < now() - interval '2 minutes'
     ORDER BY c.updated_at
     LIMIT p_limit
     FOR UPDATE OF c SKIP LOCKED
  LOOP
    BEGIN
      v_outcome := public.brand_form_promote_stash(v_row.checkout_session_id);
      IF v_outcome = 'promoted' THEN
        v_promoted := v_promoted + 1;
      ELSE
        v_skipped := v_skipped + 1;
        IF v_outcome = 'busy' THEN
          UPDATE public.brand_form_checkout_answers
             SET retry_count = LEAST(retry_count + 1, 1000), last_error = 'busy'
           WHERE checkout_session_id = v_row.checkout_session_id;
        END IF;
      END IF;
    EXCEPTION WHEN lock_not_available THEN
      v_skipped := v_skipped + 1;
      UPDATE public.brand_form_checkout_answers
         SET retry_count = LEAST(retry_count + 1, 1000), last_error = 'busy'
       WHERE checkout_session_id = v_row.checkout_session_id;
    WHEN OTHERS THEN
      v_failed := v_failed + 1;
      BEGIN
        UPDATE public.brand_form_checkout_answers
           SET retry_count = LEAST(retry_count + 1, 1000), last_error = left(SQLSTATE || ' ' || SQLERRM, 300)
         WHERE checkout_session_id = v_row.checkout_session_id;
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING '#4541 checkout answers retry could not record an error: %', SQLERRM;
      END;
    END;
  END LOOP;
  SELECT count(*)::integer INTO v_stuck
    FROM public.brand_form_checkout_answers c
    JOIN public.ticket_checkout_sessions s ON s.id = c.checkout_session_id
   WHERE s.order_id IS NOT NULL
     AND (c.retry_count >= 5 OR c.created_at < now() - interval '30 minutes');
  RETURN jsonb_build_object('promoted', v_promoted, 'skipped', v_skipped,
                            'failed', v_failed, 'stuck', v_stuck);
END;
$fn$;

-- The check (R1.1): a signed-in buyer who already answered for THIS event (their
-- account-level row, or a row on their RSVP, order or claimed plus-one here) is
-- 'answered' whatever answers were sent; nothing is kept. Answers given at
-- another event no longer count: the buyer is asked again, prefilled.
CREATE OR REPLACE FUNCTION public.brand_form_checkout_check_session(
  p_event_id uuid, p_capable boolean, p_form jsonb, p_buyer_user_id uuid, p_ticket_link_hash text,
  p_checkout_session_id uuid
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_a record;
  v_required boolean;
  v_check jsonb;
  v_has_answers boolean;
  v_here uuid;
BEGIN
  IF public.brand_forms_switched_off() THEN RETURN jsonb_build_object('outcome', 'off'); END IF;
  SELECT * INTO v_a FROM public.brand_form_active_for_event(p_event_id);
  IF NOT FOUND OR v_a.form_status <> 'live' OR v_a.mode NOT IN ('required_step', 'optional_on_page') THEN
    RETURN jsonb_build_object('outcome', 'none');
  END IF;
  v_required := v_a.mode = 'required_step';
  IF NOT public.brand_form_checkout_visible_session(p_event_id, p_buyer_user_id, p_ticket_link_hash,
                                                    p_checkout_session_id) THEN
    RETURN jsonb_build_object('outcome', CASE WHEN v_required THEN 'to_answer' ELSE 'none' END,
                              'formId', v_a.form_id, 'reason', 'not_visible');
  END IF;
  v_has_answers := COALESCE(jsonb_typeof(p_form) = 'object' AND jsonb_typeof(p_form->'answers') = 'object', false);
  IF p_buyer_user_id IS NOT NULL THEN
    v_here := public.brand_form_person_row_at_event(v_a.form_id, p_buyer_user_id, p_event_id);
  END IF;
  IF v_here IS NOT NULL THEN
    RETURN jsonb_build_object('outcome', 'answered', 'formId', v_a.form_id, 'responseId', v_here);
  END IF;
  IF NOT COALESCE(p_capable, false) THEN
    RETURN jsonb_build_object('outcome', CASE WHEN v_required THEN 'to_answer' ELSE 'none' END,
                              'formId', v_a.form_id);
  END IF;
  IF NOT v_has_answers THEN
    IF v_required THEN
      RAISE EXCEPTION 'form_answers_required' USING ERRCODE = '22023',
        DETAIL = jsonb_build_object('formId', v_a.form_id, 'versionId', v_a.live_version_id)::text;
    END IF;
    RETURN jsonb_build_object('outcome', 'none');
  END IF;
  IF (p_form->>'formId') IS DISTINCT FROM v_a.form_id::text
     OR (p_form->>'versionId') IS DISTINCT FROM v_a.live_version_id::text THEN
    IF v_required THEN
      RAISE EXCEPTION 'form_changed' USING ERRCODE = 'PT409',
        DETAIL = jsonb_build_object('formId', v_a.form_id, 'versionId', v_a.live_version_id)::text;
    END IF;
    RETURN jsonb_build_object('outcome', 'none', 'reason', 'form_changed');
  END IF;
  BEGIN
    v_check := public.brand_form_validate_answers(v_a.live_version_id, p_form->'answers');
  EXCEPTION WHEN data_exception THEN
    v_check := jsonb_build_object('ok', false,
      'errors', jsonb_build_array(jsonb_build_object('questionId', NULL, 'code', 'type')));
  END;
  IF NOT (v_check->>'ok')::boolean THEN
    RAISE EXCEPTION 'form_answers_invalid' USING ERRCODE = '22023', DETAIL = (v_check->'errors')::text;
  END IF;
  RETURN jsonb_build_object('outcome', 'stash', 'formId', v_a.form_id, 'versionId', v_a.live_version_id,
                            'attachmentId', v_a.attachment_id, 'answers', v_check->'answers');
END;
$fn$;

-- The checkout's form read (R1.1): answered here: answered + answeredHere + the
-- buyer's own answers read-only (prefill); answered only at another event:
-- answered false + an editable prefill. Only the bearer's own rows are read.
CREATE OR REPLACE FUNCTION public.brand_form_checkout_form(
  p_event_id uuid, p_buyer_user_id uuid, p_ticket_link_hash text
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_out jsonb;
  v_rid uuid;
  v_rver uuid;
  v_rans jsonb;
  v_here boolean := false;
  v_prefill jsonb;
BEGIN
  IF NOT public.brand_form_checkout_visible(p_event_id, p_buyer_user_id, p_ticket_link_hash) THEN
    RETURN jsonb_build_object('active', false);
  END IF;
  v_out := public.brand_form_page_form(p_event_id);
  IF (v_out->>'active')::boolean AND p_buyer_user_id IS NOT NULL THEN
    v_rid := public.brand_form_person_row_at_event((v_out->>'formId')::uuid, p_buyer_user_id, p_event_id);
    IF v_rid IS NOT NULL THEN
      v_here := true;
      SELECT r.version_id, r.answers INTO v_rver, v_rans FROM public.brand_form_responses r WHERE r.id = v_rid;
    ELSE
      SELECT r.id, r.version_id, r.answers INTO v_rid, v_rver, v_rans
        FROM public.brand_form_user_response((v_out->>'formId')::uuid, p_buyer_user_id) r;
    END IF;
    IF v_rid IS NOT NULL THEN
      v_out := v_out || jsonb_build_object('answered', v_here, 'answeredHere', v_here);
      IF jsonb_typeof(v_out->'definition'->'questions') = 'array' THEN
        SELECT COALESCE(jsonb_object_agg(a.key, a.value), '{}'::jsonb) INTO v_prefill
          FROM jsonb_each(COALESCE(v_rans, '{}'::jsonb)) a
         WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(v_out->'definition'->'questions') q
                        WHERE q->>'id' = a.key);
        v_out := v_out || jsonb_build_object('prefill',
          jsonb_build_object('answers', v_prefill, 'versionId', v_rver));
      END IF;
    END IF;
  END IF;
  RETURN v_out;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- 8. After-RSVP hand-off (R1.3), erasure and retention (R1.6), guest detail
--    answers (R1.9), duplicate (R1.10)
-- ---------------------------------------------------------------------------
-- A personal link for the RSVP the guest just made, when the page asks "after
-- they RSVP" and the RSVP is current (approved Going or Maybe). Runs in its own
-- call after the RSVP committed; takes no RSVP lock.
CREATE FUNCTION public.brand_form_rsvp_handoff_link(p_rsvp_id uuid, p_event_id uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_a record;
  v_user uuid;
  v_link jsonb;
BEGIN
  IF p_rsvp_id IS NULL OR p_event_id IS NULL OR public.brand_forms_switched_off() THEN
    RETURN jsonb_build_object('outcome', 'none');
  END IF;
  SELECT * INTO v_a FROM public.brand_form_active_for_event(p_event_id);
  IF NOT FOUND OR v_a.form_status <> 'live' OR v_a.mode <> 'after_purchase' THEN
    RETURN jsonb_build_object('outcome', 'none');
  END IF;
  IF NOT public.brand_form_subject_current('rsvp', p_rsvp_id, p_event_id) THEN
    RETURN jsonb_build_object('outcome', 'none');
  END IF;
  SELECT r.user_id INTO v_user FROM public.event_rsvps r WHERE r.id = p_rsvp_id;
  IF EXISTS (SELECT 1 FROM public.brand_form_responses r WHERE r.form_id = v_a.form_id AND r.rsvp_id = p_rsvp_id)
     OR public.brand_form_person_row_at_event(v_a.form_id, v_user, p_event_id) IS NOT NULL THEN
    RETURN jsonb_build_object('outcome', 'answered', 'formId', v_a.form_id);
  END IF;
  PERFORM pg_advisory_xact_lock(public.brand_form_person_lock_key(v_a.form_id, 'rsvp', p_rsvp_id));
  IF (SELECT count(*) FROM public.brand_form_links l
       WHERE l.form_id = v_a.form_id AND l.rsvp_id = p_rsvp_id AND l.created_by IS NULL
         AND l.created_at > now() - interval '24 hours') >= 10 THEN
    RAISE EXCEPTION 'rate_limited' USING ERRCODE = '54000';
  END IF;
  v_link := public.brand_form_link_issue(v_a.form_id, p_event_id,
              jsonb_build_object('kind', 'rsvp', 'id', p_rsvp_id), NULL, 30);
  RETURN jsonb_build_object('outcome', 'link', 'formId', v_a.form_id, 'token', v_link->>'token');
END;
$fn$;

-- R1.6 (default 2): deleting an account erases every answer of that person
-- (their own row, their orders, RSVPs and claimed plus-ones), those subjects'
-- links (codes cascade) and request sends, and checkout stash rows they made.
-- Never orders, RSVPs, tickets, plus-one rows, door reads or submit attempts.
-- Runs BEFORE the login is removed (buyer_user_id and user_id go null after).
CREATE FUNCTION public.brand_form_erase_person(p_user_id uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_responses integer; v_links integer; v_sends integer; v_stash integer;
BEGIN
  IF p_user_id IS NULL THEN RAISE EXCEPTION 'user_required' USING ERRCODE = '22023'; END IF;
  DELETE FROM public.brand_form_responses r
   WHERE r.user_id = p_user_id
      OR r.order_id IN (SELECT o.id FROM public.orders o WHERE o.buyer_user_id = p_user_id)
      OR r.rsvp_id IN (SELECT x.id FROM public.event_rsvps x WHERE x.user_id = p_user_id)
      OR r.rsvp_guest_id IN (SELECT g.id FROM public.event_rsvp_guests g WHERE g.matched_user_id = p_user_id);
  GET DIAGNOSTICS v_responses = ROW_COUNT;
  DELETE FROM public.brand_form_request_sends s
   WHERE s.order_id IN (SELECT o.id FROM public.orders o WHERE o.buyer_user_id = p_user_id)
      OR s.rsvp_id IN (SELECT x.id FROM public.event_rsvps x WHERE x.user_id = p_user_id)
      OR s.rsvp_guest_id IN (SELECT g.id FROM public.event_rsvp_guests g WHERE g.matched_user_id = p_user_id);
  GET DIAGNOSTICS v_sends = ROW_COUNT;
  DELETE FROM public.brand_form_links l
   WHERE l.user_id = p_user_id
      OR l.order_id IN (SELECT o.id FROM public.orders o WHERE o.buyer_user_id = p_user_id)
      OR l.rsvp_id IN (SELECT x.id FROM public.event_rsvps x WHERE x.user_id = p_user_id)
      OR l.rsvp_guest_id IN (SELECT g.id FROM public.event_rsvp_guests g WHERE g.matched_user_id = p_user_id);
  GET DIAGNOSTICS v_links = ROW_COUNT;
  DELETE FROM public.brand_form_checkout_answers c
   USING public.ticket_checkout_sessions t
   WHERE t.id = c.checkout_session_id AND t.buyer_user_id = p_user_id;
  GET DIAGNOSTICS v_stash = ROW_COUNT;
  RETURN jsonb_build_object('responses', v_responses, 'links', v_links,
                            'requestSends', v_sends, 'checkoutStash', v_stash);
END;
$fn$;

-- R1.6 (defaults 1 and 2, item R): daily retention. Each step is exception-safe
-- (-1 when it failed), so the #4452 job's own deletes always commit. "Ended" is
-- the event's last date end (event_dates.end_at); an event with no dates uses
-- its deletion time (events have no end column of their own).
CREATE FUNCTION public.brand_form_retention_purge() RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_out jsonb := '{}'::jsonb; v_n integer; v_m integer;
BEGIN
  BEGIN
    -- Review fix 2: an account-level answer (user_id) counts for the brand's
    -- later pages too, so it is never purged by its first page's end; it is
    -- purged 12 months after its last change, in the next step.
    DELETE FROM public.brand_form_responses r
     WHERE r.event_id IS NOT NULL AND r.user_id IS NULL
       AND COALESCE((SELECT max(d.end_at) FROM public.event_dates d WHERE d.event_id = r.event_id),
                    (SELECT e.deleted_at FROM public.events e WHERE e.id = r.event_id))
           < now() - interval '12 months';
    GET DIAGNOSTICS v_n = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '#4541 retention: ended-event responses failed: % (%)', SQLERRM, SQLSTATE; v_n := -1;
  END;
  v_out := v_out || jsonb_build_object('endedEventResponses', v_n);
  BEGIN
    DELETE FROM public.brand_form_responses r
     WHERE (r.event_id IS NULL OR r.user_id IS NOT NULL) AND r.updated_at < now() - interval '12 months';
    GET DIAGNOSTICS v_n = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '#4541 retention: page-less responses failed: % (%)', SQLERRM, SQLSTATE; v_n := -1;
  END;
  v_out := v_out || jsonb_build_object('pagelessResponses', v_n);
  BEGIN
    DELETE FROM public.brand_form_checkout_answers c
     USING public.ticket_checkout_sessions s
     WHERE s.id = c.checkout_session_id AND s.order_id IS NOT NULL
       AND c.created_at < now() - interval '30 days';
    GET DIAGNOSTICS v_n = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '#4541 retention: stuck stash failed: % (%)', SQLERRM, SQLSTATE; v_n := -1;
  END;
  v_out := v_out || jsonb_build_object('stuckStash', v_n);
  BEGIN
    DELETE FROM public.brand_form_responses x
     WHERE x.brand_id IN (SELECT b.id FROM public.brands b WHERE b.deleted_at IS NOT NULL);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    DELETE FROM public.brand_form_request_sends x
     WHERE x.brand_id IN (SELECT b.id FROM public.brands b WHERE b.deleted_at IS NOT NULL);
    GET DIAGNOSTICS v_m = ROW_COUNT; v_n := v_n + v_m;
    DELETE FROM public.brand_form_links x
     WHERE x.form_id IN (SELECT f.id FROM public.brand_forms f JOIN public.brands b ON b.id = f.brand_id
                          WHERE b.deleted_at IS NOT NULL);
    GET DIAGNOSTICS v_m = ROW_COUNT; v_n := v_n + v_m;
    DELETE FROM public.brand_form_checkout_answers x
     WHERE x.form_id IN (SELECT f.id FROM public.brand_forms f JOIN public.brands b ON b.id = f.brand_id
                          WHERE b.deleted_at IS NOT NULL);
    GET DIAGNOSTICS v_m = ROW_COUNT; v_n := v_n + v_m;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '#4541 retention: deleted brands failed: % (%)', SQLERRM, SQLSTATE; v_n := -1;
  END;
  v_out := v_out || jsonb_build_object('deletedBrands', v_n);
  BEGIN
    DELETE FROM public.brand_form_submit_attempts a WHERE a.created_at < now() - interval '30 days';
    GET DIAGNOSTICS v_n = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '#4541 retention: submit attempts failed: % (%)', SQLERRM, SQLSTATE; v_n := -1;
  END;
  v_out := v_out || jsonb_build_object('submitAttempts', v_n);
  BEGIN
    IF to_regclass('public.contact_challenges') IS NULL THEN
      v_n := 0;
    ELSE
      DELETE FROM public.contact_challenges c
       WHERE c.purpose = 'brand_form_access' AND c.created_at < now() - interval '30 days';
      GET DIAGNOSTICS v_n = ROW_COUNT;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '#4541 retention: form codes failed: % (%)', SQLERRM, SQLSTATE; v_n := -1;
  END;
  v_out := v_out || jsonb_build_object('formCodes', v_n);
  BEGIN
    DELETE FROM public.brand_form_links l WHERE l.expires_at < now() - interval '12 months';
    GET DIAGNOSTICS v_n = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '#4541 retention: expired links failed: % (%)', SQLERRM, SQLSTATE; v_n := -1;
  END;
  v_out := v_out || jsonb_build_object('expiredLinks', v_n);
  BEGIN
    DELETE FROM public.brand_form_request_sends s WHERE s.created_at < now() - interval '12 months';
    GET DIAGNOSTICS v_n = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '#4541 retention: request sends failed: % (%)', SQLERRM, SQLSTATE; v_n := -1;
  END;
  v_out := v_out || jsonb_build_object('requestSends', v_n);
  BEGIN
    DELETE FROM public.brand_form_door_reads d WHERE d.created_at < now() - interval '12 months';
    GET DIAGNOSTICS v_n = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '#4541 retention: door reads failed: % (%)', SQLERRM, SQLSTATE; v_n := -1;
  END;
  v_out := v_out || jsonb_build_object('doorReads', v_n);
  RETURN v_out;
END;
$fn$;

-- One appended line in the existing daily forms retention job; no new cron.
DO $cron$
DECLARE
  v_job bigint;
  v_cmd text;
BEGIN
  IF to_regnamespace('cron') IS NULL THEN
    RAISE NOTICE '#4541: pg_cron unavailable; brand form retention purge not hooked'; RETURN;
  END IF;
  SELECT jobid, command INTO v_job, v_cmd FROM cron.job WHERE jobname = 'issue_4452_forms_retention';
  IF v_job IS NULL THEN
    RAISE NOTICE '#4541: issue_4452_forms_retention missing; brand form retention purge not hooked'; RETURN;
  END IF;
  IF position('brand_form_retention_purge' IN v_cmd) = 0 THEN
    PERFORM cron.alter_job(v_job, command := rtrim(v_cmd, E' \n') || E'\n    SELECT public.brand_form_retention_purge();\n  ');
  END IF;
END;
$cron$;

-- R1.9: one guest's answers for the page's active form (marketing_manager+, the
-- Responses gate), selected exactly as brand_form_event_responses selects rows.
CREATE FUNCTION public.biz_brand_form_guest_answers(p_event_id uuid, p_subject jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_brand uuid; v_kind text := p_subject->>'kind'; v_sid uuid; v_a record;
  v_rid uuid; v_rver uuid; v_rans jsonb; v_rat timestamptz; v_def jsonb; v_label text;
BEGIN
  SELECT e.brand_id INTO v_brand FROM public.events e WHERE e.id = p_event_id AND e.deleted_at IS NULL;
  IF v_brand IS NULL THEN RAISE EXCEPTION 'event_not_found' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.brand_form_require_rank(v_brand, 'marketing_manager');
  IF jsonb_typeof(p_subject) IS DISTINCT FROM 'object'
     OR COALESCE(v_kind, '') NOT IN ('rsvp', 'rsvp_guest', 'order')
     OR COALESCE(p_subject->>'id', '') !~ '^[0-9a-fA-F-]{36}$' THEN
    RAISE EXCEPTION 'subject_invalid' USING ERRCODE = '22023';
  END IF;
  v_sid := (p_subject->>'id')::uuid;
  IF public.brand_form_subject_event(v_kind, v_sid) IS DISTINCT FROM p_event_id THEN
    RAISE EXCEPTION 'subject_other_event' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_a FROM public.brand_form_active_for_event(p_event_id);
  IF NOT FOUND THEN RETURN jsonb_build_object('state', 'none'); END IF;
  SELECT r.id, r.version_id, r.answers, r.updated_at INTO v_rid, v_rver, v_rans, v_rat
    FROM public.brand_form_find_response(v_a.form_id, v_kind, v_sid) r;
  IF v_rid IS NULL OR NOT EXISTS (
       SELECT 1 FROM public.brand_form_event_responses(v_a.form_id, p_event_id) x WHERE x.id = v_rid) THEN
    RETURN jsonb_build_object('state', 'not_answered', 'formName', v_a.form_name);
  END IF;
  SELECT v.definition, 'v' || v.version INTO v_def, v_label FROM public.brand_form_versions v WHERE v.id = v_rver;
  RETURN jsonb_build_object(
    'state', 'answered', 'formName', v_a.form_name, 'versionLabel', v_label,
    'answeredAt', v_rat, 'isCurrentVersion', v_rver = v_a.live_version_id,
    'items', COALESCE((SELECT jsonb_agg(jsonb_build_object(
               'label', q.value->>'label',
               'value', public.brand_form_answer_text(q.value, v_rans->(q.value->>'id')))
               ORDER BY (q.value->>'position')::integer)
          FROM jsonb_array_elements(v_def->'questions') q
         WHERE q.value->>'type' <> 'file_upload'
           AND public.brand_form_answer_text(q.value, v_rans->(q.value->>'id')) IS NOT NULL), '[]'::jsonb));
END;
$fn$;

-- R1.10: copy the source page's active attachment (form, mode, reminder) onto a
-- new page of the same brand, when the form is not archived and the new page
-- has none.
CREATE FUNCTION public.brand_form_copy_attachment(p_from_event uuid, p_to_event uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE v_a record;
BEGIN
  SELECT a.form_id, a.brand_id, a.mode, a.auto_remind, a.auto_remind_channels, a.created_by
    INTO v_a
    FROM public.brand_form_attachments a
    JOIN public.brand_forms f ON f.id = a.form_id AND f.status <> 'archived'
   WHERE a.event_id = p_from_event AND a.detached_at IS NULL;
  IF NOT FOUND THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.events e WHERE e.id = p_to_event AND e.brand_id = v_a.brand_id)
     OR EXISTS (SELECT 1 FROM public.brand_form_attachments a
                 WHERE a.event_id = p_to_event AND a.detached_at IS NULL) THEN
    RETURN;
  END IF;
  INSERT INTO public.brand_form_attachments (form_id, brand_id, event_id, mode, auto_remind,
                                             auto_remind_channels, created_by)
  VALUES (v_a.form_id, v_a.brand_id, p_to_event, v_a.mode, v_a.auto_remind,
          v_a.auto_remind_channels, COALESCE(auth.uid(), v_a.created_by));
END;
$fn$;

-- business_duplicate_event_as_draft: the body of 20280430011023, plus one line
-- that copies the form attachment (R1.10).
CREATE OR REPLACE FUNCTION public.business_duplicate_event_as_draft(p_event_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_uid uuid:=auth.uid();v_src public.events%ROWTYPE;v_new public.events%ROWTYPE;v_payload jsonb;v_title text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated';END IF;
  SELECT * INTO v_src FROM public.events WHERE id=p_event_id AND deleted_at IS NULL FOR SHARE;
  IF NOT FOUND OR v_src.event_type<>'event' THEN RAISE EXCEPTION 'event_not_found';END IF;
  IF public.biz_brand_effective_rank(v_src.brand_id,v_uid)<public.biz_role_rank('event_manager') THEN RAISE EXCEPTION 'insufficient_event_permission';END IF;
  v_payload:=public.business_event_draft_payload_from_graph(p_event_id);
  v_title:=left(v_src.title||' (copy)',120);
  INSERT INTO public.events(brand_id,created_by,event_type,title,slug,description,location_text,location_geo,online_url,is_online,
    is_recurring,is_multi_date,recurrence_rules,cover_media_url,cover_media_poster_url,cover_media_type,cover_media_provider,
    cover_media_source_url,cover_media_credit,cover_media_credit_url,cover_media_alt,cover_media_gallery,theme,currency,
    visibility,status,timezone,party_types,vibe_tags,music_genres,city,pass_tax,pass_mingla_fee,pass_service_fee,
    theme_color_override,theme_font_override,theme_animation_override,theme_gradient_override)
  VALUES(v_src.brand_id,v_uid,'event',v_title,'draft-'||substr(replace(gen_random_uuid()::text,'-',''),1,16),v_src.description,
    v_src.location_text,v_src.location_geo,v_src.online_url,v_src.is_online,v_src.is_recurring,v_src.is_multi_date,v_src.recurrence_rules,
    v_src.cover_media_url,v_src.cover_media_poster_url,v_src.cover_media_type,v_src.cover_media_provider,v_src.cover_media_source_url,
    v_src.cover_media_credit,v_src.cover_media_credit_url,v_src.cover_media_alt,v_src.cover_media_gallery,
    jsonb_set(v_payload->'theme','{business_draft,clientRevision}','0'::jsonb,true),v_src.currency,'draft','draft',v_src.timezone,
    v_src.party_types,v_src.vibe_tags,v_src.music_genres,v_src.city,v_src.pass_tax,v_src.pass_mingla_fee,v_src.pass_service_fee,
    v_src.theme_color_override,v_src.theme_font_override,v_src.theme_animation_override,v_src.theme_gradient_override)
  RETURNING * INTO v_new;
  PERFORM public.brand_form_copy_attachment(p_event_id, v_new.id);
  RETURN jsonb_build_object('event',to_jsonb(v_new),'client_revision',0);
END;$function$
;

-- ---------------------------------------------------------------------------
-- 9. Abuse limits (R8.4), operations (R7.1, R7.2)
-- ---------------------------------------------------------------------------
-- One admission per request, taken atomically under a per-address lock, BEFORE
-- any other database work. The row is written whether or not it is admitted,
-- so a refused or failed submit still counts. Buckets: submit 20 / 10 min and
-- 100 / 24 h; read 60 and 600; unknown (no platform address) 2,000 and 20,000.
CREATE FUNCTION public.brand_form_attempt_admit(p_ip_hash text, p_form_id uuid, p_bucket text)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_n10 integer; v_n24 integer; v_max10 integer; v_max24 integer; v_allowed boolean;
BEGIN
  IF p_ip_hash IS NULL OR p_ip_hash !~ '^[0-9a-f]{64}$'
     OR p_bucket IS NULL OR p_bucket NOT IN ('submit', 'read', 'unknown') THEN
    RAISE EXCEPTION 'attempt_invalid' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('brand_form_ip:' || p_ip_hash, 0));
  v_max10 := CASE p_bucket WHEN 'submit' THEN 20 WHEN 'read' THEN 60 ELSE 2000 END;
  v_max24 := CASE p_bucket WHEN 'submit' THEN 100 WHEN 'read' THEN 600 ELSE 20000 END;
  SELECT count(*) FILTER (WHERE a.created_at > now() - interval '10 minutes'),
         count(*)
    INTO v_n10, v_n24
    FROM public.brand_form_submit_attempts a
   WHERE a.ip_hash = p_ip_hash AND a.bucket = p_bucket
     AND a.outcome IN ('admitted', 'accepted', 'rejected')
     AND a.created_at > now() - interval '24 hours';
  v_allowed := v_n10 < v_max10 AND v_n24 < v_max24;
  INSERT INTO public.brand_form_submit_attempts (ip_hash, form_id, outcome, bucket)
  VALUES (p_ip_hash, p_form_id, CASE WHEN v_allowed THEN 'admitted' ELSE 'rate_limited' END, p_bucket);
  RETURN jsonb_build_object('allowed', v_allowed);
END;
$fn$;

-- R7.2: claim today's alert for one kind (true once per kind per day).
CREATE FUNCTION public.brand_form_ops_alert_claim(p_kind text) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE v_n integer;
BEGIN
  IF p_kind IS NULL OR p_kind NOT IN ('form_drain_error', 'form_sends_failing', 'form_queue_stuck',
                                      'checkout_answers_stuck') THEN
    RAISE EXCEPTION 'kind_invalid' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.brand_form_ops_alerts (kind, day)
  VALUES (p_kind, (now() AT TIME ZONE 'utc')::date)
  ON CONFLICT (kind, day) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n = 1;
END;
$fn$;

-- R7.2: the queue's health, counts only.
CREATE FUNCTION public.brand_form_queue_health() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
  SELECT jsonb_build_object(
    'stuckQueued', (SELECT count(*) FROM public.brand_form_request_sends s
                     WHERE s.status = 'queued' AND s.not_before < now() - interval '30 minutes')::integer,
    'failedLastHour', (SELECT count(*) FROM public.brand_form_request_sends s
                        WHERE s.status = 'failed' AND s.settled_at > now() - interval '1 hour')::integer,
    'stashStuck', (SELECT count(*) FROM public.brand_form_checkout_answers c
                     JOIN public.ticket_checkout_sessions t ON t.id = c.checkout_session_id
                    WHERE t.order_id IS NOT NULL
                      AND (c.retry_count >= 5 OR c.created_at < now() - interval '30 minutes'))::integer);
$fn$;

-- R7.1: the Admin support read for one brand (admins and support staff). Counts,
-- statuses, failures and switches only: never an answer value or a contact.
CREATE FUNCTION public.admin_brand_forms_support(p_brand_id uuid, p_event_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
BEGIN
  IF NOT (public.is_admin_user() OR public.is_support_staff(auth.uid())) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.brands b WHERE b.id = p_brand_id) THEN
    RAISE EXCEPTION 'brand_not_found' USING ERRCODE = 'P0002';
  END IF;
  RETURN jsonb_build_object(
    'forms', COALESCE((SELECT jsonb_agg(jsonb_build_object(
               'id', f.id, 'name', f.name, 'status', f.status,
               'liveVersion', (SELECT v.version FROM public.brand_form_versions v WHERE v.id = f.live_version_id),
               'doorFullAnswers', f.door_full_answers,
               'doorFullAnswersInvited', f.door_full_answers_invited) ORDER BY f.updated_at DESC, f.id)
             FROM public.brand_forms f WHERE f.brand_id = p_brand_id), '[]'::jsonb),
    'pages', COALESCE((SELECT jsonb_agg(jsonb_build_object(
               'eventId', a.event_id, 'eventTitle', e.title, 'formId', a.form_id, 'mode', a.mode,
               'autoRemind', a.auto_remind,
               'answered', (SELECT count(*) FROM public.brand_form_event_responses(a.form_id, a.event_id) r
                             WHERE r.verified)::integer,
               'toAnswer', CASE WHEN f.status = 'live'
                                THEN public.brand_form_unanswered_count(a.form_id, a.event_id) ELSE 0 END,
               'notAsked', CASE WHEN f.status = 'live'
                                THEN public.brand_form_not_asked_count(a.form_id, a.event_id) ELSE 0 END)
               ORDER BY e.title, a.event_id)
             FROM public.brand_form_attachments a
             JOIN public.brand_forms f ON f.id = a.form_id
             JOIN public.events e ON e.id = a.event_id AND e.deleted_at IS NULL
            WHERE a.brand_id = p_brand_id AND a.detached_at IS NULL
              AND (p_event_id IS NULL OR a.event_id = p_event_id)), '[]'::jsonb),
    'requestSends30d', COALESCE((SELECT jsonb_agg(jsonb_build_object(
               'status', x.status, 'reason', x.safe_reason, 'count', x.n) ORDER BY x.status, x.safe_reason)
             FROM (SELECT s.status, s.safe_reason, count(*)::integer AS n
                     FROM public.brand_form_request_sends s
                    WHERE s.brand_id = p_brand_id AND s.created_at > now() - interval '30 days'
                      AND (p_event_id IS NULL OR s.event_id = p_event_id)
                    GROUP BY s.status, s.safe_reason) x), '[]'::jsonb),
    'stuckCheckoutAnswers', (SELECT jsonb_build_object('count', count(*)::integer, 'oldest', min(c.created_at))
             FROM public.brand_form_checkout_answers c
             JOIN public.ticket_checkout_sessions t ON t.id = c.checkout_session_id
             JOIN public.brand_forms f ON f.id = c.form_id
            WHERE f.brand_id = p_brand_id AND t.order_id IS NOT NULL
              AND (c.retry_count >= 5 OR c.created_at < now() - interval '30 minutes')),
    'doorReads7d', (SELECT count(*)::integer FROM public.brand_form_door_reads d
                     JOIN public.events e ON e.id = d.event_id
                    WHERE e.brand_id = p_brand_id AND d.created_at > now() - interval '7 days'
                      AND (p_event_id IS NULL OR d.event_id = p_event_id)),
    'switches', jsonb_build_object(
      'BRAND_FORMS_KILL_SWITCH', public.brand_forms_switched_off(),
      'BRAND_FORMS_PUSH', (SELECT ff.is_enabled FROM public.feature_flags ff WHERE ff.flag_key = 'BRAND_FORMS_PUSH'),
      'BRAND_FORMS_PUSH_EMAIL_ALONGSIDE',
        (SELECT ff.is_enabled FROM public.feature_flags ff WHERE ff.flag_key = 'BRAND_FORMS_PUSH_EMAIL_ALONGSIDE')),
    -- Filled by M-B (R3.2) once the push-capable table exists.
    'formReadyAppShare14d', NULL::integer);
END;
$fn$;

-- ---------------------------------------------------------------------------
-- 10. Grants (nothing new for anon)
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION
  public.brand_form_subject_current(text, uuid, uuid),
  public.brand_form_added_by_host(text, uuid),
  public.brand_form_person_row_at_event(uuid, uuid, uuid),
  public.brand_form_answers_empty(jsonb),
  public.brand_form_door_full_scope(uuid, uuid, integer, boolean, boolean),
  public.brand_form_not_asked_count(uuid, uuid),
  public.biz_brand_form_set_door_invited(uuid, boolean),
  public.biz_brand_form_door_reads(uuid, integer, timestamptz),
  public.brand_form_promote_stash(uuid),
  public.brand_form_checkout_answers_retry(integer),
  public.brand_form_rsvp_handoff_link(uuid, uuid),
  public.brand_form_erase_person(uuid),
  public.brand_form_retention_purge(),
  public.biz_brand_form_guest_answers(uuid, jsonb),
  public.brand_form_copy_attachment(uuid, uuid),
  public.brand_form_attempt_admit(text, uuid, text),
  public.brand_form_ops_alert_claim(text),
  public.brand_form_queue_health(),
  public.admin_brand_forms_support(uuid, uuid)
FROM PUBLIC, anon, authenticated;

-- Host and Admin RPCs (each checks rank or admin inside).
GRANT EXECUTE ON FUNCTION
  public.biz_brand_form_set_door_invited(uuid, boolean),
  public.biz_brand_form_door_reads(uuid, integer, timestamptz),
  public.biz_brand_form_guest_answers(uuid, jsonb),
  public.admin_brand_forms_support(uuid, uuid)
TO authenticated, service_role;

-- Service role only.
GRANT EXECUTE ON FUNCTION
  public.brand_form_subject_current(text, uuid, uuid),
  public.brand_form_added_by_host(text, uuid),
  public.brand_form_person_row_at_event(uuid, uuid, uuid),
  public.brand_form_answers_empty(jsonb),
  public.brand_form_door_full_scope(uuid, uuid, integer, boolean, boolean),
  public.brand_form_not_asked_count(uuid, uuid),
  public.brand_form_promote_stash(uuid),
  public.brand_form_checkout_answers_retry(integer),
  public.brand_form_rsvp_handoff_link(uuid, uuid),
  public.brand_form_erase_person(uuid),
  public.brand_form_retention_purge(),
  public.brand_form_copy_attachment(uuid, uuid),
  public.brand_form_attempt_admit(text, uuid, text),
  public.brand_form_ops_alert_claim(text),
  public.brand_form_queue_health()
TO service_role;

COMMENT ON FUNCTION public.brand_form_subject_current(text, uuid, uuid) IS '#4541 R1.4: the one current-holder rule (approved Going or Maybe RSVP, claimed plus-one of one, paid or partly refunded order) at one event.';
COMMENT ON FUNCTION public.brand_form_promote_stash(uuid) IS '#4541 R1.1/R1.7: I-4541-CHECKOUT-ANSWER-INSERT-ONLY. Moves one checkout stash into the order''s response only when the buyer has none at this event; never updates a response; non-waiting locks only. Returns promoted | skipped | busy.';
COMMENT ON FUNCTION public.brand_form_door_full_answers(uuid, uuid, jsonb, text) IS '#4541 R8.3: one current guest of this event per call, logged in brand_form_door_reads. Full answers for event managers, for the brand team when door_full_answers is on, and for invited scan-only staff only when door_full_answers_invited is also on; 60 (managers) or 20 reads per actor per 10 minutes and 3 full reads of one guest per actor per 24 hours.';
COMMENT ON FUNCTION public.brand_form_submit_core(jsonb) IS '#4514/#4541: the only RPC writer of brand_form_responses (service role; brand-form-submit). #4541: RSVP, plus-one and order credentials must be current (not_current); a signed-in answer with no subject follows the brand_form_my_response read rule (not_holder).';

COMMIT;
