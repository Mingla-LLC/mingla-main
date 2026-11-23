-- Issue #4571 (Work pipeline redesign), wave W6b: email logged against cards,
-- a reply that suggests Replied, the weekly numbers from the data, and the
-- connector's log_activity answer carrying suggest_stage (W2 carry-over).
--
-- NO SECRET KEYS (Seth, hard rule, decision Q2): Mingla stores no Google
-- service-account key, no Gmail token and no mail secret anywhere on the
-- server. Mail reaches this table only through the mingla connector's
-- log_emails tool, called by an agent run that already has Gmail access.
--
--   1. crm_email_log: one row per (Gmail message id, matched card). The
--      subject (at most 500 characters), the first 300 characters of the
--      snippet, inbound or outbound, the From address, the mailbox, the time,
--      the address that matched, and the card's stage at that time (stage_at,
--      for the W6c sweep's decision 8). Nothing that matches no card is
--      stored. No client can read or write it.
--   2. crm_email_log_ingest(p_mailbox, p_messages): the ingestion function.
--      Idempotent by message id (a repeat logs nothing twice). Outbound mail
--      matches its To and Cc addresses, inbound mail its From address,
--      against email identifiers of live, not archived host and creator
--      cards. 1 to 50 messages; each gets its own answer.
--   3. team_agent_call gains log_emails (mailbox, messages, request_key), a
--      write tool counted against the key's daily limit, and log_activity's
--      answer carries the suggest_stage crm_record_log already computes.
--   4. The card shape (crm_4571_w6_json) gains suggest_replied: when a card
--      in Prospect or Contacted (Identified or Contacted for a creator) has an
--      inbound email or inbound touch newer than its last stage move, the
--      time and subject. Never applied: one click moves it through
--      crm_record_move_stage.
--   5. crm_outreach_numbers(p_from, p_to): per rep per Lagos day, calls made,
--      outcomes, connected (Demo booked, Spoke - follow up, Call back, Not
--      interested), demos booked, demos linked, emails sent (outbound mail by
--      From address) and replies (inbound mail by mailbox), with the connect
--      rate (connected / calls) and demo rate (demos booked / connected),
--      null when there is nothing to divide by. Emails and replies read
--      crm_email_log only. The tracking Work cards keep targets only.
--
-- WHO FEEDS IT: the "Mail logging" agent run (a Claude chat with the Gmail
-- connector, signed in as info@usemingla.com, on a mingla connector key). Each
-- weekday evening, before the 9 PM Lagos sweep, it searches info@'s Sent and
-- Inbox since its last run (metadata and snippet only, never bodies or
-- attachments) and sends them in batches of 50 with log_emails. See the
-- comment on crm_email_log_ingest.
--
-- INVARIANT crm-mail-touch-once: gate crm_email_log_once (message_id,
-- record_id) unique; test
-- supabase/migrations/__tests__/issue_4571_w6b_email_log.implementor.pg17.test.sql
--
-- ROLLBACK (no down file): drop crm_outreach_numbers(date, date),
-- crm_email_log_ingest(text, jsonb) and the table crm_email_log; restore
-- crm_4571_w6_json from 20281126064571 and team_agent_call from
-- 20281126034571 (the log_emails tool then answers unknown_tool; remove it
-- from the connector's tool list in the same revert).

BEGIN;

SET LOCAL lock_timeout = '10s';

CREATE TABLE public.crm_email_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id      text NOT NULL,
  record_id       uuid NOT NULL REFERENCES public.crm_records(id) ON DELETE CASCADE,
  matched_address text NOT NULL,
  direction       text NOT NULL,
  mailbox         text NOT NULL,
  from_address    text NOT NULL,
  subject         text,
  snippet         text,
  sent_at         timestamptz NOT NULL,
  stage_at        text NOT NULL,
  logged_by       text NOT NULL,
  logged_via      text,
  created_at      timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT crm_email_log_message_id_check CHECK (message_id ~ '^[A-Za-z0-9_.:@<>+=-]{1,200}$'),
  CONSTRAINT crm_email_log_direction_check CHECK (direction IN ('inbound', 'outbound')),
  CONSTRAINT crm_email_log_addresses_check CHECK (
    matched_address = lower(matched_address) AND mailbox = lower(mailbox) AND from_address = lower(from_address)
    AND char_length(matched_address) BETWEEN 3 AND 254 AND char_length(mailbox) BETWEEN 3 AND 254
    AND char_length(from_address) BETWEEN 3 AND 254),
  CONSTRAINT crm_email_log_subject_check CHECK (char_length(COALESCE(subject, '')) <= 500),
  CONSTRAINT crm_email_log_snippet_check CHECK (char_length(COALESCE(snippet, '')) <= 300),
  CONSTRAINT crm_email_log_stage_at_check CHECK (char_length(stage_at) BETWEEN 1 AND 40),
  CONSTRAINT crm_email_log_via_check CHECK (logged_via IS NULL OR logged_via ~ '^[a-z0-9_-]{1,40}$')
);
-- INVARIANT crm-mail-touch-once: one row per message per card, whatever runs twice.
CREATE UNIQUE INDEX crm_email_log_once ON public.crm_email_log (message_id, record_id);
CREATE INDEX crm_email_log_by_record ON public.crm_email_log (record_id, direction, sent_at DESC);
CREATE INDEX crm_email_log_by_day ON public.crm_email_log (sent_at, direction);
ALTER TABLE public.crm_email_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_email_log FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.crm_email_log TO service_role;
COMMENT ON TABLE public.crm_email_log IS
  'Issue #4571 W6b. Email matched to host and creator cards: one row per (Gmail message id, card), with the subject, the first 300 characters of the snippet, direction, From, mailbox, time and the card''s stage at that time. Written only by crm_email_log_ingest (the connector''s log_emails); read by crm_outreach_numbers, the card''s suggest_replied and the W6c cadence. No client access. Mingla stores no mail key.';

-- The email address inside "Name <a@b.c>", lower-cased, or null.
CREATE FUNCTION public.crm_4571_email_of(p text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $function$
  SELECT lower((regexp_match(COALESCE(p, ''), '([A-Za-z0-9._%+''-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+)'))[1])
$function$;
REVOKE ALL ON FUNCTION public.crm_4571_email_of(text) FROM PUBLIC, anon, authenticated;

-- A card's stage at a moment: the stage its last move before then went to,
-- else the stage its first later move left from, else where it is now.
CREATE FUNCTION public.crm_4571_stage_at(p_record_id uuid, p_at timestamptz) RETURNS text
LANGUAGE sql STABLE SET search_path = ''
AS $function$
  SELECT COALESCE(
    (SELECT a.to_stage FROM public.crm_activity a
      WHERE a.record_id = p_record_id AND a.kind = 'stage_move' AND a.occurred_at <= p_at
      ORDER BY a.occurred_at DESC, a.created_at DESC LIMIT 1),
    (SELECT a.from_stage FROM public.crm_activity a
      WHERE a.record_id = p_record_id AND a.kind = 'stage_move' AND a.occurred_at > p_at
      ORDER BY a.occurred_at, a.created_at LIMIT 1),
    (SELECT c.stage FROM public.crm_records c WHERE c.id = p_record_id))
$function$;
REVOKE ALL ON FUNCTION public.crm_4571_stage_at(uuid, timestamptz) FROM PUBLIC, anon, authenticated;

-- FED BY: the "Mail logging" agent run. An agent with its own Gmail access
-- (the Gmail connector, signed in as info@usemingla.com) reads Sent and Inbox
-- since its last run, metadata and snippet only, and calls the mingla
-- connector's log_emails with {mailbox, messages: [{id, direction, from, to,
-- cc, at, subject, snippet}], request_key}. team_agent_call hands the list
-- here. Mingla holds no Gmail or service-account key (Seth, decision Q2).
CREATE FUNCTION public.crm_email_log_ingest(p_mailbox text, p_messages jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  v record; v_mailbox text; v_idx integer; m jsonb; v_dir text; v_from text; v_at timestamptz;
  v_addrs text[]; v_subject text; v_snippet text; v_mid text; v_rows jsonb := '[]'::jsonb; v_row jsonb;
  v_new integer; v_old integer; v_cards uuid[];
  c_logged integer := 0; c_already integer := 0; c_none integer := 0; c_bad integer := 0;
  v_now timestamptz := clock_timestamp();
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  v_mailbox := public.crm_4571_email_of(p_mailbox);
  IF v_mailbox IS NULL OR v_mailbox <> lower(btrim(p_mailbox)) THEN
    RAISE EXCEPTION 'invalid_mailbox: Send the address of the mailbox you read, such as info@usemingla.com.' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_messages) IS DISTINCT FROM 'array' OR jsonb_array_length(p_messages) NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION 'invalid_arguments: Send 1 to 50 messages.' USING ERRCODE = '22023';
  END IF;
  FOR v_idx IN 0 .. jsonb_array_length(p_messages) - 1 LOOP
    m := p_messages->v_idx;
    BEGIN
      IF jsonb_typeof(m) IS DISTINCT FROM 'object' THEN
        RAISE EXCEPTION 'invalid_message: Send each message as an object.' USING ERRCODE = '22023';
      END IF;
      IF EXISTS (SELECT 1 FROM jsonb_object_keys(m) k WHERE k NOT IN ('id', 'direction', 'from', 'to', 'cc', 'at', 'subject', 'snippet')) THEN
        RAISE EXCEPTION 'unknown_field: A message takes id, direction, from, to, cc, at, subject and snippet, nothing else.' USING ERRCODE = '22023';
      END IF;
      v_mid := m->>'id';
      IF jsonb_typeof(m->'id') IS DISTINCT FROM 'string' OR v_mid !~ '^[A-Za-z0-9_.:@<>+=-]{1,200}$' THEN
        RAISE EXCEPTION 'invalid_id: Send the Gmail message id as id.' USING ERRCODE = '22023';
      END IF;
      v_dir := m->>'direction';
      IF v_dir IS NULL OR v_dir NOT IN ('inbound', 'outbound') THEN
        RAISE EXCEPTION 'invalid_direction: Use outbound (sent from the mailbox) or inbound (received).' USING ERRCODE = '22023';
      END IF;
      v_from := public.crm_4571_email_of(m->>'from');
      IF v_from IS NULL THEN
        RAISE EXCEPTION 'invalid_from: Send the From address.' USING ERRCODE = '22023';
      END IF;
      IF (m ? 'to' AND jsonb_typeof(m->'to') <> 'array') OR (m ? 'cc' AND jsonb_typeof(m->'cc') <> 'array')
         OR jsonb_array_length(COALESCE(m->'to', '[]')) + jsonb_array_length(COALESCE(m->'cc', '[]')) > 100 THEN
        RAISE EXCEPTION 'invalid_recipients: Send to and cc as lists of at most 100 addresses in all.' USING ERRCODE = '22023';
      END IF;
      BEGIN
        v_at := (m->>'at')::timestamptz;
      EXCEPTION WHEN others THEN
        v_at := NULL;
      END;
      IF v_at IS NULL OR v_at > v_now + interval '1 day' OR v_at < v_now - interval '400 days' THEN
        RAISE EXCEPTION 'invalid_at: Send when the message was sent, such as 2026-11-23T09:00:00Z, within the last 400 days.' USING ERRCODE = '22023';
      END IF;
      v_subject := left(regexp_replace(COALESCE(m->>'subject', ''), '[[:cntrl:]]', ' ', 'g'), 500);
      v_snippet := left(regexp_replace(COALESCE(m->>'snippet', ''), '[[:cntrl:]]', ' ', 'g'), 300);
      -- Outbound: the people it went to. Inbound: the person it came from.
      IF v_dir = 'outbound' THEN
        SELECT COALESCE(array_agg(DISTINCT a), ARRAY[]::text[]) INTO v_addrs
          FROM (SELECT public.crm_4571_email_of(e #>> '{}') AS a
                  FROM jsonb_array_elements(COALESCE(m->'to', '[]') || COALESCE(m->'cc', '[]')) e) x
         WHERE a IS NOT NULL AND a <> v_mailbox;
      ELSE
        v_addrs := ARRAY[v_from];
      END IF;
      WITH hits AS (
        SELECT DISTINCT ON (c.id) c.id, lower(i.value_key) AS addr
          FROM public.crm_record_identifiers i
          JOIN public.crm_records c ON c.id = i.record_id
         WHERE i.kind = 'email' AND i.value_key = ANY (SELECT public.crm_ident_key('email', a) FROM unnest(v_addrs) a)
           AND c.deleted_at IS NULL AND c.archived_at IS NULL
         ORDER BY c.id, i.value_key),
      ins AS (
        INSERT INTO public.crm_email_log (message_id, record_id, matched_address, direction, mailbox, from_address,
                                          subject, snippet, sent_at, stage_at, logged_by, logged_via)
        SELECT v_mid, h.id, h.addr, v_dir, v_mailbox, v_from, NULLIF(v_subject, ''), NULLIF(v_snippet, ''), v_at,
               public.crm_4571_stage_at(h.id, v_at), v.actor_email, v.via
          FROM hits h
        ON CONFLICT (message_id, record_id) DO NOTHING
        RETURNING record_id)
      SELECT (SELECT count(*) FROM ins)::integer, (SELECT count(*) FROM hits)::integer - (SELECT count(*) FROM ins)::integer,
             (SELECT array_agg(h.id ORDER BY h.id) FROM hits h)
        INTO v_new, v_old, v_cards;
      IF v_cards IS NULL THEN
        v_row := jsonb_build_object('index', v_idx, 'id', v_mid, 'status', 'no_card');
        c_none := c_none + 1;
      ELSIF v_new = 0 THEN
        v_row := jsonb_build_object('index', v_idx, 'id', v_mid, 'status', 'already_logged', 'records', to_jsonb(v_cards));
        c_already := c_already + 1;
      ELSE
        v_row := jsonb_build_object('index', v_idx, 'id', v_mid, 'status', 'logged', 'records', to_jsonb(v_cards));
        c_logged := c_logged + 1;
      END IF;
    EXCEPTION WHEN invalid_parameter_value THEN
      v_row := jsonb_build_object('index', v_idx, 'id', left(COALESCE(m->>'id', ''), 200), 'status', 'error',
        'error', jsonb_build_object('token', COALESCE((regexp_match(SQLERRM, '^([a-z_]+): '))[1], 'refused'),
                                    'message', regexp_replace(SQLERRM, '^[a-z_]+: ', '')));
      c_bad := c_bad + 1;
    END;
    v_rows := v_rows || jsonb_build_array(v_row);
  END LOOP;
  RETURN jsonb_build_object('mailbox', v_mailbox, 'results', v_rows,
    'counts', jsonb_build_object('logged', c_logged, 'already_logged', c_already, 'no_card', c_none, 'error', c_bad));
END;
$function$;
COMMENT ON FUNCTION public.crm_email_log_ingest(text, jsonb) IS
  'Issue #4571 W6b. Log 1 to 50 emails against host and creator cards: outbound by To and Cc, inbound by From, matched to email identifiers of live, not archived cards. Idempotent by (message id, card). Keeps the subject and the first 300 characters of the snippet. Mail that matches no card is not stored. Fed by the "Mail logging" agent run through the connector''s log_emails; Mingla stores no mail key. crm_ctx(): the Hosts and Creators area, agents included.';
REVOKE ALL ON FUNCTION public.crm_email_log_ingest(text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_email_log_ingest(text, jsonb) TO authenticated, service_role;

CREATE FUNCTION public.crm_4571_suggest_replied(r public.crm_records) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = ''
AS $function$
  WITH since AS (
    SELECT COALESCE((SELECT max(a.occurred_at) FROM public.crm_activity a
                      WHERE a.record_id = r.id AND a.kind = 'stage_move'), r.created_at) AS at
  ),
  replies AS (
    SELECT e.sent_at AS at, e.subject, 'email'::text AS channel
      FROM public.crm_email_log e WHERE e.record_id = r.id AND e.direction = 'inbound'
    UNION ALL
    SELECT a.occurred_at, NULL, a.channel
      FROM public.crm_activity a WHERE a.record_id = r.id AND a.kind = 'touch' AND a.direction = 'inbound'
  )
  SELECT CASE WHEN r.archived_at IS NULL AND r.deleted_at IS NULL
                AND ((r.pipeline = 'hosts' AND r.stage IN ('prospect', 'contacted'))
                     OR (r.pipeline = 'creators' AND r.stage IN ('identified', 'contacted')))
         THEN (SELECT jsonb_build_object('at', x.at, 'subject', x.subject, 'channel', x.channel)
                 FROM replies x, since s WHERE x.at > s.at ORDER BY x.at DESC LIMIT 1) END
$function$;
REVOKE ALL ON FUNCTION public.crm_4571_suggest_replied(public.crm_records) FROM PUBLIC, anon, authenticated;

-- From 20281126064571 (crm_4571_w6_json). #4571 W6b: suggest_replied.
CREATE OR REPLACE FUNCTION public.crm_4571_w6_json(r public.crm_records) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = ''
AS $function$
  SELECT jsonb_build_object(
    'archived_at', r.archived_at, 'archived_by', r.archived_by, 'archived_reason', r.archived_reason,
    'merged_into', CASE WHEN r.merged_into_id IS NULL THEN NULL ELSE
      (SELECT jsonb_build_object('id', m.id, 'name', m.name) FROM public.crm_records m WHERE m.id = r.merged_into_id) END,
    'suggest_replied', public.crm_4571_suggest_replied(r))
$function$;


-- The weekly numbers. Lagos days (the team's day). At most 92 days.
CREATE FUNCTION public.crm_outreach_numbers(p_from date, p_to date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE v record; v_lo timestamptz; v_hi timestamptz; v_days jsonb; v_reps jsonb; v_tot jsonb;
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from OR p_to - p_from > 91 THEN
    RAISE EXCEPTION 'invalid_window: Pick a window of 1 to 92 days.' USING ERRCODE = '22023';
  END IF;
  v_lo := p_from::timestamp AT TIME ZONE 'Africa/Lagos';
  v_hi := (p_to + 1)::timestamp AT TIME ZONE 'Africa/Lagos';
  WITH calls AS (
    SELECT a.actor_email AS rep, (a.occurred_at AT TIME ZONE 'Africa/Lagos')::date AS day, a.call_outcome
      FROM public.crm_activity a
     WHERE a.kind = 'touch' AND a.channel = 'phone' AND a.direction = 'outbound'
       AND a.actor_email IS NOT NULL AND a.occurred_at >= v_lo AND a.occurred_at < v_hi
  ),
  call_days AS (
    SELECT c.rep, c.day, count(*)::integer AS calls,
           count(*) FILTER (WHERE c.call_outcome IN ('demo_booked', 'spoke_follow_up', 'call_back', 'not_interested'))::integer AS connected,
           count(*) FILTER (WHERE c.call_outcome = 'demo_booked')::integer AS demos_booked,
           jsonb_build_object(
             'demo_booked', count(*) FILTER (WHERE c.call_outcome = 'demo_booked'),
             'spoke_follow_up', count(*) FILTER (WHERE c.call_outcome = 'spoke_follow_up'),
             'call_back', count(*) FILTER (WHERE c.call_outcome = 'call_back'),
             'no_answer', count(*) FILTER (WHERE c.call_outcome = 'no_answer'),
             'not_interested', count(*) FILTER (WHERE c.call_outcome = 'not_interested'),
             'wrong_number', count(*) FILTER (WHERE c.call_outcome = 'wrong_number'),
             'no_outcome', count(*) FILTER (WHERE c.call_outcome IS NULL)) AS outcomes
      FROM calls c GROUP BY c.rep, c.day
  ),
  linked AS (
    SELECT d.linked_by AS rep, (d.linked_at AT TIME ZONE 'Africa/Lagos')::date AS day, count(*)::integer AS demos_linked
      FROM public.crm_record_demos d
     WHERE d.linked_by IS NOT NULL AND d.linked_at >= v_lo AND d.linked_at < v_hi
     GROUP BY 1, 2
  ),
  mail AS (
    SELECT CASE WHEN e.direction = 'outbound' THEN e.from_address ELSE e.mailbox END AS rep,
           (e.sent_at AT TIME ZONE 'Africa/Lagos')::date AS day,
           count(DISTINCT e.message_id) FILTER (WHERE e.direction = 'outbound')::integer AS emails_sent,
           count(DISTINCT e.message_id) FILTER (WHERE e.direction = 'inbound')::integer AS replies
      FROM public.crm_email_log e
     WHERE e.sent_at >= v_lo AND e.sent_at < v_hi
     GROUP BY 1, 2
  ),
  keys AS (
    SELECT rep, day FROM call_days UNION SELECT rep, day FROM linked UNION SELECT rep, day FROM mail
  ),
  daily AS (
    SELECT k.rep, k.day,
           COALESCE(c.calls, 0) AS calls, COALESCE(c.connected, 0) AS connected, COALESCE(c.demos_booked, 0) AS demos_booked,
           COALESCE(c.outcomes, '{}'::jsonb) AS outcomes, COALESCE(l.demos_linked, 0) AS demos_linked,
           COALESCE(m.emails_sent, 0) AS emails_sent, COALESCE(m.replies, 0) AS replies
      FROM keys k
      LEFT JOIN call_days c ON c.rep = k.rep AND c.day = k.day
      LEFT JOIN linked l ON l.rep = k.rep AND l.day = k.day
      LEFT JOIN mail m ON m.rep = k.rep AND m.day = k.day
  )
  SELECT COALESCE(jsonb_agg(r.j ORDER BY r.calls DESC, r.emails_sent DESC, r.rep), '[]'::jsonb) INTO v_reps
    FROM (
      SELECT d.rep, sum(d.calls) AS calls, sum(d.emails_sent) AS emails_sent,
             jsonb_build_object(
               'rep', d.rep, 'name', public.ops_name(d.rep),
               'is_team', EXISTS (SELECT 1 FROM public.admin_team_directory() t WHERE t.email = d.rep),
               'totals', public.crm_4571_numbers_row(sum(d.calls)::integer, sum(d.connected)::integer, sum(d.demos_booked)::integer,
                                                   sum(d.demos_linked)::integer, sum(d.emails_sent)::integer, sum(d.replies)::integer)
                         || jsonb_build_object('outcomes', (SELECT jsonb_object_agg(o.key, o.n) FROM (
                              SELECT e.key, sum((e.value #>> '{}')::integer) AS n
                                FROM daily dd, jsonb_each(dd.outcomes) e WHERE dd.rep = d.rep GROUP BY e.key) o)),
               'days', jsonb_agg(public.crm_4571_numbers_row(d.calls, d.connected, d.demos_booked, d.demos_linked, d.emails_sent, d.replies)
                                 || jsonb_build_object('day', d.day, 'outcomes', d.outcomes) ORDER BY d.day)) AS j
        FROM daily d GROUP BY d.rep) r;
  SELECT public.crm_4571_numbers_row(
           COALESCE(sum((x->'totals'->>'calls')::integer), 0)::integer, COALESCE(sum((x->'totals'->>'connected')::integer), 0)::integer,
           COALESCE(sum((x->'totals'->>'demos_booked')::integer), 0)::integer, COALESCE(sum((x->'totals'->>'demos_linked')::integer), 0)::integer,
           COALESCE(sum((x->'totals'->>'emails_sent')::integer), 0)::integer, COALESCE(sum((x->'totals'->>'replies')::integer), 0)::integer)
    INTO v_tot FROM jsonb_array_elements(v_reps) x;
  RETURN jsonb_build_object('from', p_from, 'to', p_to, 'time_zone', 'Africa/Lagos', 'reps', v_reps, 'totals', v_tot,
    'mail_last_logged_at', (SELECT max(e.created_at) FROM public.crm_email_log e));
END;
$function$;

CREATE FUNCTION public.crm_4571_numbers_row(p_calls integer, p_connected integer, p_demos integer, p_linked integer,
                                            p_emails integer, p_replies integer) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $function$
  SELECT jsonb_build_object('calls', p_calls, 'connected', p_connected, 'demos_booked', p_demos, 'demos_linked', p_linked,
    'emails_sent', p_emails, 'replies', p_replies,
    -- Never 0% for nothing: a rate with nothing to divide by is null.
    'connect_rate', CASE WHEN p_calls > 0 THEN round(p_connected::numeric / p_calls, 4) END,
    'demo_rate', CASE WHEN p_connected > 0 THEN round(p_demos::numeric / p_connected, 4) END)
$function$;
REVOKE ALL ON FUNCTION public.crm_4571_numbers_row(integer, integer, integer, integer, integer, integer) FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public.crm_outreach_numbers(date, date) IS
  'Issue #4571 W6b. The Team dashboard''s weekly numbers, per rep per Lagos day: calls (outbound phone touches) and their outcomes, connected (demo_booked, spoke_follow_up, call_back, not_interested), demos booked (outcome demo_booked), demos linked (W4, by who linked), emails sent (outbound crm_email_log by From) and replies (inbound by mailbox), with connect_rate = connected / calls and demo_rate = demos booked / connected, null when the divisor is 0. Window 1 to 92 days. crm_ctx().';
REVOKE ALL ON FUNCTION public.crm_outreach_numbers(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_outreach_numbers(date, date) TO authenticated, service_role;

-- From 20281126034571 (team_agent_call). #4571 W6b: log_emails, and
-- log_activity's answer carries suggest_stage.
CREATE OR REPLACE FUNCTION public.team_agent_call(p_key_hash text, p_tool text, p_args jsonb, p_client text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET statement_timeout TO '25s'
AS $function$
DECLARE
  c_tools constant text[] := ARRAY[
    'get_started', 'my_day', 'find_records', 'get_record', 'check_names',
    'find_mingla_link', 'check_contactable', 'list_beta_leads', 'team_summary',
    'add_records', 'upsert_record', 'update_records',
    'move_stage', 'set_owners', 'log_activity', 'record_reply', 'log_emails',
    'save_drafts', 'update_draft', 'list_drafts', 'withdraw_drafts'];
  c_writes constant text[] := ARRAY[
    'add_records', 'upsert_record', 'update_records',
    'move_stage', 'set_owners', 'log_activity', 'record_reply', 'log_emails',
    'save_drafts', 'update_draft', 'withdraw_drafts'];
  c_plumbing constant text[] := ARRAY[
    'mcp:initialize', 'mcp:ping', 'mcp:tools/list', 'mcp:resources/list', 'mcp:resources/read',
    'mcp:prompts/list', 'mcp:prompts/get', 'mcp:notification', 'mcp:other'];
  c_uuid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  c_rk constant text := '^[A-Za-z0-9_-]{8,70}$';
  -- The argument that holds the list, for each tool that takes one.
  c_lists constant jsonb := '{"add_records": "records", "update_records": "updates", "move_stage": "moves",
                              "set_owners": "items", "log_activity": "entries", "record_reply": "replies", "log_emails": "messages",
                              "save_drafts": "drafts", "withdraw_drafts": "ids"}';
  v_auth    jsonb;
  v_key     uuid;
  v_owner   text;
  v_uid     uuid;
  v_agent   text;
  v_me      jsonb;
  v_lim     jsonb := public.team_agent_limits();
  v_args    jsonb := CASE WHEN jsonb_typeof(p_args) = 'object' THEN p_args ELSE '{}'::jsonb END;
  v_tool    text;
  v_started timestamptz := clock_timestamp();
  v_day     timestamptz := date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  v_n       bigint;
  v_oldest  timestamptz;
  v_retry   integer;
  v_token   text;
  v_words   text;
  v_call    uuid;
  v_client  text;
  v_result  jsonb;
  v_ok      boolean := false;
  v_m       text[];
  v_g       jsonb;
  v_date    date;
  v_int     integer;
  v_bool    boolean;
  v_name    jsonb;
  v_rows    jsonb;
  v_utc     date := (now() AT TIME ZONE 'UTC')::date;
  v_zone    text;
  v_zfrom   text;
  v_dfrom   text;
  v_dates   jsonb;
  v_lock_before text;
  v_field   text;
  v_list    jsonb;
  v_item    jsonb;
  v_idx     integer;
  v_id      uuid;
  v_one     jsonb;
  v_two     jsonb;
  v_row     jsonb;
  v_touch   jsonb;
  v_rk      text;
  v_stage   text;
  v_pipe    text;
  v_to      text;
  v_note    text;
  v_moved   text;
  v_replay  boolean;
  v_items   integer := 0;
  v_sum     jsonb := '{}'::jsonb;
  v_c1      integer := 0;
  v_c2      integer := 0;
  v_c3      integer := 0;
  v_c4      integer := 0;
  v_c5      integer := 0;
  v_want    integer := 0;
  v_cand    jsonb;
  v_chk     jsonb;
BEGIN
  -- A setup code, not a key: handed straight on. Nothing else here runs.
  IF p_tool = 'setup:redeem' THEN
    RETURN public.team_agent_setup_redeem(p_key_hash, p_client);
  END IF;

  v_auth := public.team_agent_resolve(p_key_hash);
  IF v_auth->>'auth' IS DISTINCT FROM 'ok' THEN
    RETURN '{"auth":"invalid"}'::jsonb;
  END IF;
  v_key   := (v_auth->>'key_id')::uuid;
  v_owner := v_auth->>'owner_email';
  v_uid   := (v_auth->>'uid')::uuid;
  v_agent := v_auth->>'agent';
  v_me    := jsonb_build_object('role', v_auth->>'role', 'agent', v_agent);
  -- Only a name from the fixed lists is ever stored.
  v_tool  := CASE WHEN p_tool = ANY (c_tools) OR p_tool = ANY (c_plumbing) THEN p_tool ELSE 'unknown' END;

  -- Limits. A refused request is recorded and does not count against the key.
  -- One request at a time per key from here to the end of the transaction, so
  -- the count below and the row written after it are one step: two requests
  -- arriving together can never both be "the last one allowed". A request
  -- waits for its turn for a bounded time only.
  v_lock_before := current_setting('lock_timeout');
  BEGIN
    PERFORM set_config('lock_timeout', (v_lim->>'key_wait_ms') || 'ms', true);
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('team_agent_limit:' || v_key::text, 0));
    PERFORM set_config('lock_timeout', v_lock_before, true);
  EXCEPTION WHEN lock_not_available THEN
    PERFORM set_config('lock_timeout', v_lock_before, true);
    INSERT INTO public.team_agent_calls (key_id, owner_email, actor_uid, agent, tool, xact_id, started_at, duration_ms, outcome)
    VALUES (v_key, v_owner, v_uid, v_agent, v_tool, pg_current_xact_id(), v_started,
            LEAST(2147483647, GREATEST(0, round(extract(epoch FROM (clock_timestamp() - v_started)) * 1000)))::integer,
            'limited');
    RETURN jsonb_build_object('limited',
      jsonb_build_object('retry_after_s', 2, 'token', 'busy',
        'message', 'Another request from your agent is still running. Wait 2 seconds, then send this one again. Nothing was lost.'),
      'me', v_me);
  END;
  SELECT count(*), min(c.started_at) INTO v_n, v_oldest
  FROM public.team_agent_calls c
  WHERE c.key_id = v_key AND c.started_at > v_started - interval '60 seconds' AND c.outcome <> 'limited';
  IF v_n >= (v_lim->>'requests_per_minute')::integer THEN
    v_retry := GREATEST(1, LEAST(60, ceil(60 - extract(epoch FROM (v_started - v_oldest)))::integer));
    v_token := 'rate_limited';
    v_words := format('Your agent has made a lot of requests in the last minute. Wait %s seconds, then carry on. Nothing was lost.', v_retry);
  ELSIF v_tool NOT LIKE 'mcp:%' THEN
    SELECT count(*) INTO v_n
    FROM public.team_agent_calls c
    WHERE c.key_id = v_key AND c.started_at >= v_day AND c.outcome <> 'limited' AND c.tool NOT LIKE 'mcp:%';
    IF v_n >= (v_lim->>'tool_calls_per_day')::integer THEN
      v_retry := GREATEST(1, ceil(extract(epoch FROM (v_day + interval '1 day' - v_started)))::integer);
      v_token := 'daily_limit';
      v_words := format('Your agent reached today''s limit of %s requests. It resets at midnight UTC. Ask the owner if you need more.', v_lim->>'tool_calls_per_day');
    ELSIF v_tool = ANY (c_writes) THEN
      SELECT COALESCE(sum(c.items), 0) INTO v_n
      FROM public.team_agent_calls c
      WHERE c.key_id = v_key AND c.started_at >= v_day AND c.outcome <> 'limited';
      -- The most this request could write, counted before it writes anything,
      -- so the day's limit is never passed part-way through a request.
      v_list := v_args->COALESCE(c_lists->>v_tool, 'record');
      v_want := CASE
        WHEN v_tool = 'upsert_record' THEN 1 + COALESCE((jsonb_typeof(v_args->'touch') = 'object')::integer, 0)
        WHEN jsonb_typeof(v_list) IS DISTINCT FROM 'array' THEN 1
        WHEN v_tool = 'add_records' THEN jsonb_array_length(v_list)
          + (SELECT count(*)::integer FROM jsonb_array_elements(v_list) AS e
              WHERE jsonb_typeof(e) = 'object' AND jsonb_typeof(e->'first_touch') = 'object')
        ELSE jsonb_array_length(v_list) END;
      v_list := NULL;
      IF v_n >= (v_lim->>'records_written_per_day')::integer THEN
        v_retry := GREATEST(1, ceil(extract(epoch FROM (v_day + interval '1 day' - v_started)))::integer);
        v_token := 'daily_limit';
        v_words := format('Your agent reached today''s limit of %s records written. It resets at midnight UTC. Ask the owner if you need more.', v_lim->>'records_written_per_day');
      ELSIF v_n + v_want > (v_lim->>'records_written_per_day')::integer THEN
        v_retry := GREATEST(1, ceil(extract(epoch FROM (v_day + interval '1 day' - v_started)))::integer);
        v_token := 'daily_limit';
        v_words := format('This request could write %s records and your agent has %s left of today''s %s. Nothing was written. Send fewer in one request, or wait: the count starts again at midnight UTC.',
          v_want, (v_lim->>'records_written_per_day')::integer - v_n, v_lim->>'records_written_per_day');
      END IF;
    END IF;
  END IF;
  IF v_token IS NOT NULL THEN
    INSERT INTO public.team_agent_calls (key_id, owner_email, actor_uid, agent, tool, xact_id, started_at, duration_ms, outcome)
    VALUES (v_key, v_owner, v_uid, v_agent, v_tool, pg_current_xact_id(), v_started, 0, 'limited');
    RETURN jsonb_build_object('limited',
      jsonb_build_object('retry_after_s', v_retry, 'token', v_token, 'message', v_words), 'me', v_me);
  END IF;

  -- The request row. From here on, crm_ctx() answers "via" this agent for
  -- this person, in this transaction only.
  INSERT INTO public.team_agent_calls (key_id, owner_email, actor_uid, agent, tool, xact_id, started_at)
  VALUES (v_key, v_owner, v_uid, v_agent, v_tool, pg_current_xact_id(), v_started)
  RETURNING id INTO v_call;

  v_client := NULLIF(left(regexp_replace(COALESCE(p_client, ''), '[[:cntrl:]]', '', 'g'), 120), '');
  UPDATE public.team_agent_keys
     SET last_used_at = v_started, last_used_client = v_client
   WHERE id = v_key AND (last_used_at IS NULL OR last_used_at < v_started - interval '60 seconds');

  BEGIN
    IF v_tool LIKE 'mcp:%' THEN
      v_result := CASE
        WHEN v_tool IN ('mcp:resources/read', 'mcp:prompts/list', 'mcp:prompts/get') THEN public.team_agent_guide()
        ELSE '{}'::jsonb
      END;
    ELSE
      -- The gate, before anything else: the person must hold the crm area.
      PERFORM 1 FROM public.crm_ctx();

      -- "Today", for the tools that depend on a date: the date the request
      -- names, else today in the zone the request names, else today in the
      -- zone the key remembers, else today in UTC. The answer says which.
      IF v_tool IN ('my_day', 'team_summary', 'find_records') THEN
        v_zone := v_auth->>'time_zone';
        v_zfrom := 'your key';
        IF v_args ? 'time_zone' AND jsonb_typeof(v_args->'time_zone') <> 'null' THEN
          IF jsonb_typeof(v_args->'time_zone') <> 'string' OR (v_args->>'time_zone') !~ '^[A-Za-z0-9_+/-]{1,64}$'
             OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names z WHERE z.name = v_args->>'time_zone') THEN
            RAISE EXCEPTION 'invalid_arguments: "time_zone" is missing or the wrong kind. Send a zone name such as America/New_York.' USING ERRCODE = '22023';
          END IF;
          v_zone := v_args->>'time_zone';
          v_zfrom := 'this request';
        END IF;
        BEGIN
          v_date := (clock_timestamp() AT TIME ZONE COALESCE(v_zone, 'UTC'))::date;
        EXCEPTION WHEN others THEN
          v_zone := NULL;      -- a remembered zone this server no longer knows
          v_date := v_utc;
        END;
        IF v_zone IS NULL THEN
          v_zone := 'UTC';
          v_zfrom := 'no zone is recorded for your key, so UTC';
        END IF;
        v_dfrom := 'the clock';
        IF v_args ? 'today' AND jsonb_typeof(v_args->'today') <> 'null' THEN
          BEGIN
            IF jsonb_typeof(v_args->'today') <> 'string' OR (v_args->>'today') !~ '^\d{4}-\d{2}-\d{2}$' THEN
              RAISE EXCEPTION 'bad' USING ERRCODE = '22007';
            END IF;
            v_date := (v_args->>'today')::date;
          EXCEPTION WHEN others THEN
            RAISE EXCEPTION 'invalid_arguments: "today" is missing or the wrong kind. Send a date such as 2026-10-13.' USING ERRCODE = '22023';
          END;
          IF v_date NOT BETWEEN v_utc - 1 AND v_utc + 1 THEN
            RAISE EXCEPTION 'invalid_arguments: "today" is missing or the wrong kind. Send your person''s own date today (it is within a day of the date in UTC), or leave it out.' USING ERRCODE = '22023';
          END IF;
          v_dfrom := 'this request';
        END IF;
        v_dates := jsonb_build_object('today', v_date, 'time_zone', v_zone, 'zone_from', v_zfrom, 'date_from', v_dfrom);
      END IF;

      -- A tool that takes a list: the list is there, holds 1 to 50 objects.
      v_field := c_lists->>v_tool;
      IF v_field IS NOT NULL THEN
        v_list := v_args->v_field;
        IF jsonb_typeof(v_list) IS DISTINCT FROM 'array' OR jsonb_array_length(v_list) < 1
           OR (v_tool = 'withdraw_drafts' AND EXISTS (SELECT 1 FROM jsonb_array_elements(v_list) AS e
                 WHERE jsonb_typeof(e) <> 'string' OR (e #>> '{}') !~* c_uuid))
           OR (v_tool <> 'withdraw_drafts' AND EXISTS (SELECT 1 FROM jsonb_array_elements(v_list) AS e WHERE jsonb_typeof(e) <> 'object')) THEN
          RAISE EXCEPTION '%', format('invalid_arguments: "%s" is missing or the wrong kind. Send a list of 1 to 50 valid items.', v_field)
            USING ERRCODE = '22023';
        END IF;
        IF jsonb_array_length(v_list) > (v_lim->>'items_per_request')::integer THEN
          RAISE EXCEPTION 'too_many_items: Send at most 50 items in one request. Split the rest into another request.' USING ERRCODE = '22023';
        END IF;
      END IF;
      -- A tool that adds or logs: the request key that makes a repeat safe.
      IF v_tool IN ('add_records', 'upsert_record', 'log_activity', 'record_reply', 'save_drafts', 'log_emails') THEN
        IF jsonb_typeof(v_args->'request_key') IS DISTINCT FROM 'string' OR (v_args->>'request_key') !~ c_rk THEN
          RAISE EXCEPTION 'request_key_required: Send a request_key (8 to 70 letters, digits, - or _) with this request, and the same one if you repeat it, so a repeat changes nothing.'
            USING ERRCODE = '22023';
        END IF;
        v_rk := v_args->>'request_key';
        -- The key belongs to this tool and these arguments. Another use of it
        -- stops here, before anything is written.
        PERFORM public.crm_request_claim(v_rk || '-claim', 'agent:' || v_tool, v_args);
      END IF;

      CASE v_tool
        WHEN 'get_started' THEN
          v_g := public.team_agent_guide();
          v_result := jsonb_build_object(
            'me', (v_g->'config'->'me') - 'can_delete' - 'can_add_region',
            'role', v_auth->>'role',
            'agent', v_agent,
            'can', jsonb_build_object('delete', false,
                                      'set_targets', public.is_admin_user(),
                                      'see_team_dashboard', public.is_admin_user()),
            'status', v_g->'guide'->'status',
            'pipelines', v_g->'config'->'pipelines',
            'channels', v_g->'config'->'channels',
            'sources', v_g->'config'->'sources',
            'reply_classes', v_g->'config'->'reply_classes',
            'agreements', v_g->'config'->'agreements',
            'regions', v_g->'config'->'regions',
            'team', v_g->'config'->'team',
            'limits', v_g->'limits',
            'rules', v_g->'guide'->'rules',
            'routines', v_g->'guide'->'routines',
            'coming_next', v_g->'guide'->'coming_next');

        WHEN 'my_day', 'team_summary' THEN
          v_result := CASE v_tool WHEN 'my_day' THEN public.crm_home_summary(v_date) || jsonb_build_object('drafts_waiting', public.team_draft_counts()->'waiting')
                                                       || jsonb_build_object('calls_due', public.crm_calls_queue(v_date)->'count')  -- #4571 W3
                                  ELSE public.crm_team_summary(v_date) END;

        WHEN 'find_records' THEN
          v_result := public.team_agent_records_find((v_args - 'time_zone') || jsonb_build_object('today', v_date));

        WHEN 'get_record' THEN
          IF jsonb_typeof(v_args->'id') IS DISTINCT FROM 'string' OR (v_args->>'id') !~* c_uuid THEN
            RAISE EXCEPTION '%', format('invalid_id: "%s" is not a record id. Use an id returned by find_records.',
              left(COALESCE(v_args->>'id', ''), 60)) USING ERRCODE = '22023';
          END IF;
          v_int := (v_lim->>'record_log_default')::integer;
          IF v_args ? 'activity_limit' AND jsonb_typeof(v_args->'activity_limit') <> 'null' THEN
            IF jsonb_typeof(v_args->'activity_limit') <> 'number' OR (v_args->>'activity_limit') !~ '^\d{1,3}$'
               OR (v_args->>'activity_limit')::integer NOT BETWEEN 1 AND (v_lim->>'record_log_max')::integer THEN
              RAISE EXCEPTION '%', format('invalid_arguments: "activity_limit" is missing or the wrong kind. Send a whole number from 1 to %s.',
                v_lim->>'record_log_max') USING ERRCODE = '22023';
            END IF;
            v_int := (v_args->>'activity_limit')::integer;
          END IF;
          v_g := public.crm_record_get((v_args->>'id')::uuid);
          v_result := jsonb_build_object(
            'record', v_g->'record',
            'links', v_g->'links',
            'demos', COALESCE(v_g->'demos', '[]'::jsonb),  -- #4571 W4: call_at, status, link source; never an email or the token
            'activity', COALESCE((SELECT jsonb_agg(e ORDER BY ord)
                                    FROM jsonb_array_elements(v_g->'activity') WITH ORDINALITY AS t(e, ord)
                                   WHERE ord <= v_int), '[]'::jsonb),
            'activity_shown', LEAST(v_int, jsonb_array_length(v_g->'activity')),
            'more_activity', jsonb_array_length(v_g->'activity') > v_int);

        WHEN 'check_names' THEN
          IF jsonb_typeof(v_args->'names') IS DISTINCT FROM 'array'
             OR jsonb_array_length(v_args->'names') < 1
             OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_args->'names') e
                         WHERE jsonb_typeof(e) <> 'string' OR char_length(e #>> '{}') > 160) THEN
            RAISE EXCEPTION 'invalid_arguments: "names" is missing or the wrong kind. Send a list of 1 to 50 names, each at most 160 characters.' USING ERRCODE = '22023';
          END IF;
          IF jsonb_array_length(v_args->'names') > (v_lim->>'items_per_request')::integer THEN
            RAISE EXCEPTION 'too_many_items: Send at most 50 items in one request. Split the rest into another request.' USING ERRCODE = '22023';
          END IF;
          v_rows := '[]'::jsonb;
          FOR v_name IN SELECT e FROM jsonb_array_elements(v_args->'names') WITH ORDINALITY AS t(e, ord) ORDER BY ord LOOP
            v_rows := v_rows || jsonb_build_array(
              jsonb_build_object('name', v_name #>> '{}')
              || public.crm_duplicate_check(v_args->>'pipeline', v_name #>> '{}', NULL));
          END LOOP;
          v_result := jsonb_build_object('pipeline', v_args->>'pipeline', 'names', v_rows);

        WHEN 'find_mingla_link' THEN
          IF jsonb_typeof(v_args->'query') IS DISTINCT FROM 'string' OR char_length(v_args->>'query') > 160 THEN
            RAISE EXCEPTION 'invalid_arguments: "query" is missing or the wrong kind. Send at least 2 and at most 160 characters of a name.' USING ERRCODE = '22023';
          END IF;
          v_result := public.crm_link_search(v_args->>'kind', v_args->>'query');

        WHEN 'list_beta_leads' THEN
          v_bool := true;
          IF v_args ? 'only_new' AND jsonb_typeof(v_args->'only_new') <> 'null' THEN
            IF jsonb_typeof(v_args->'only_new') <> 'boolean' THEN
              RAISE EXCEPTION 'invalid_arguments: "only_new" is missing or the wrong kind. Send true or false.' USING ERRCODE = '22023';
            END IF;
            v_bool := (v_args->>'only_new')::boolean;
          END IF;
          v_int := (v_lim->>'find_page_default')::integer;
          IF v_args ? 'limit' AND jsonb_typeof(v_args->'limit') <> 'null' THEN
            IF jsonb_typeof(v_args->'limit') <> 'number' OR (v_args->>'limit') !~ '^\d{1,3}$'
               OR (v_args->>'limit')::integer NOT BETWEEN 1 AND (v_lim->>'find_page_max')::integer THEN
              RAISE EXCEPTION '%', format('invalid_arguments: "limit" is missing or the wrong kind. Send a whole number from 1 to %s.',
                v_lim->>'find_page_max') USING ERRCODE = '22023';
            END IF;
            v_int := (v_args->>'limit')::integer;
          END IF;
          v_g := public.crm_beta_leads_list();
          SELECT COALESCE(jsonb_agg(e ORDER BY ord), '[]'::jsonb) INTO v_rows
          FROM (SELECT e, ord FROM jsonb_array_elements(v_g->'leads') WITH ORDINALITY AS t(e, ord)
                 WHERE NOT v_bool OR jsonb_typeof(e->'host') IS DISTINCT FROM 'object'
                 ORDER BY ord LIMIT v_int) s;
          v_result := jsonb_build_object('leads', v_rows, 'total', v_g->'total', 'new_count', v_g->'new_count',
                                         'only_new', v_bool, 'shown', jsonb_array_length(v_rows));

        WHEN 'check_contactable' THEN
          v_result := public.crm_contact_check(v_args->>'pipeline', v_args->'candidates');

        WHEN 'log_emails' THEN
          -- #4571 W6b: mail an agent read with its own Gmail access, matched
          -- to cards by email address. Mingla stores no mail key.
          IF jsonb_typeof(v_args->'mailbox') IS DISTINCT FROM 'string' THEN
            RAISE EXCEPTION 'invalid_arguments: "mailbox" is missing or the wrong kind. Send the address of the mailbox you read, such as info@usemingla.com.' USING ERRCODE = '22023';
          END IF;
          IF EXISTS (SELECT 1 FROM jsonb_object_keys(v_args) AS k WHERE k NOT IN ('mailbox', 'messages', 'request_key')) THEN
            RAISE EXCEPTION 'unknown_field: log_emails takes mailbox, messages and request_key, nothing else.' USING ERRCODE = '22023';
          END IF;
          v_result := public.crm_email_log_ingest(v_args->>'mailbox', v_list);
          v_items := COALESCE((v_result->'counts'->>'logged')::integer, 0);
          v_sum := v_result->'counts';

        WHEN 'add_records' THEN
          -- The bulk add the browser uses, then one log entry for each new
          -- record that came with a first touch.
          v_g := public.crm_records_bulk_create(
            v_args->>'pipeline',
            (SELECT jsonb_agg(t.e - 'first_touch' ORDER BY t.ord) FROM jsonb_array_elements(v_list) WITH ORDINALITY AS t(e, ord)),
            v_rk || '-a');
          v_replay := COALESCE((v_g->>'replayed')::boolean, false);
          v_rows := '[]'::jsonb;
          FOR v_idx IN 0 .. jsonb_array_length(v_list) - 1 LOOP
            v_item := v_list->v_idx;
            v_touch := NULL;
            SELECT e INTO v_one FROM jsonb_array_elements(v_g->'created') AS e WHERE (e->>'index')::integer = v_idx;
            IF FOUND THEN
              v_c1 := v_c1 + 1;
              v_row := jsonb_build_object('index', v_idx, 'status', 'created', 'record', v_one->'record');
              IF v_item ? 'first_touch' AND jsonb_typeof(v_item->'first_touch') <> 'null' THEN
                BEGIN
                  IF jsonb_typeof(v_item->'first_touch') <> 'object' THEN
                    RAISE EXCEPTION 'invalid_entry: Send first_touch as one object with a channel, a direction and the message.' USING ERRCODE = '22023';
                  END IF;
                  v_two := public.crm_record_log((v_one->'record'->>'id')::uuid,
                             (v_item->'first_touch') || jsonb_build_object('kind', 'touch'),
                             v_rk || '-t' || v_idx);
                  IF COALESCE((v_two->>'replayed')::boolean, false) THEN
                    v_touch := jsonb_build_object('status', 'replayed', 'activity', v_two->'activity');
                  ELSE
                    v_touch := jsonb_build_object('status', 'logged', 'activity', v_two->'activity');
                    v_c4 := v_c4 + 1;
                  END IF;
                  v_row := v_row || jsonb_build_object('record', v_two->'record');
                EXCEPTION
                  WHEN invalid_parameter_value OR no_data_found OR insufficient_privilege THEN
                    v_m := regexp_match(SQLERRM, '^([a-z_]+): (.+)$');
                    v_touch := jsonb_build_object('status', 'refused', 'error', jsonb_build_object(
                      'token', COALESCE(v_m[1], 'refused'), 'message', COALESCE(v_m[2], 'That touch could not be logged.')));
                    v_c5 := v_c5 + 1;
                  WHEN others THEN
                    RAISE WARNING 'team_agent_call: add_records item % stopped the request (% %)', v_idx, SQLSTATE, SQLERRM;
                    RAISE EXCEPTION '%', format('try_again: Something went wrong on our side at item %s, so nothing in this request was saved. Send the same request again.', v_idx + 1)
                      USING ERRCODE = 'PT409';
                END;
              END IF;
            ELSE
              SELECT e INTO v_one FROM jsonb_array_elements(v_g->'skipped') AS e WHERE (e->>'index')::integer = v_idx;
              IF FOUND THEN
                v_c2 := v_c2 + 1;
                v_row := jsonb_build_object('index', v_idx, 'status', 'exists', 'existing', v_one->'existing',
                  'reason', CASE WHEN public.crm_name_key(regexp_replace(btrim(COALESCE(v_item->>'name', '')), '\s+', ' ', 'g'))
                                      = public.crm_name_key(COALESCE(v_one->'existing'->>'name', ''))
                                 THEN 'name' ELSE 'identifier' END);
                -- Every record this one matches is weighed: the strictest
                -- contact rule on any of them is the verdict.
                v_chk := NULL;
                BEGIN
                  v_chk := public.crm_contact_check(v_args->>'pipeline', jsonb_build_array(jsonb_strip_nulls(
                             jsonb_build_object('name', v_item->'name', 'identifiers', v_item->'identifiers'))))->'results'->0;
                EXCEPTION WHEN invalid_parameter_value THEN
                  v_chk := NULL;
                END;
                IF v_chk->>'verdict' IN ('exists', 'do_not_contact', 'warm_intro_only') THEN
                  v_row := v_row || jsonb_build_object('verdict', v_chk->'verdict', 'matches', v_chk->'matches');
                  IF v_row->>'reason' = 'identifier' THEN
                    v_row := v_row || jsonb_build_object('matched_on', (
                      SELECT m->'matched_on' FROM jsonb_array_elements(v_chk->'matches') AS m
                       WHERE m->'record'->>'id' = v_one->'existing'->>'id'));
                  END IF;
                END IF;
                IF v_item ? 'first_touch' AND jsonb_typeof(v_item->'first_touch') <> 'null' THEN
                  v_touch := jsonb_build_object('status', 'refused', 'error', jsonb_build_object('token', 'exists',
                    'message', 'This record was already there, so the touch was not logged. Use upsert_record or log_activity if it still applies.'));
                  v_c5 := v_c5 + 1;
                END IF;
              ELSE
                SELECT e INTO v_one FROM jsonb_array_elements(v_g->'invalid') AS e WHERE (e->>'index')::integer = v_idx;
                v_c3 := v_c3 + 1;
                v_m := regexp_match(COALESCE(v_one->>'error', ''), '^([a-z_]+): (.+)$');
                v_row := jsonb_build_object('index', v_idx, 'status', 'invalid', 'error', jsonb_build_object(
                  'token', COALESCE(v_m[1], 'invalid'), 'message', COALESCE(v_m[2], 'That record could not be added.')));
              END IF;
            END IF;
            IF v_touch IS NOT NULL THEN
              v_row := v_row || jsonb_build_object('touch', v_touch);
            END IF;
            v_rows := v_rows || jsonb_build_array(v_row);
          END LOOP;
          v_result := jsonb_build_object('results', v_rows,
            'counts', jsonb_build_object('created', v_c1, 'exists', v_c2, 'invalid', v_c3,
                                         'touches_logged', v_c4, 'touches_refused', v_c5),
            'replayed', v_replay);
          v_items := CASE WHEN v_replay THEN 0 ELSE v_c1 END + v_c4;
          v_sum := jsonb_build_object('created', CASE WHEN v_replay THEN 0 ELSE v_c1 END, 'exists', v_c2,
                                      'refused', v_c3 + v_c5, 'logged', v_c4, 'replayed', v_replay::integer);

        WHEN 'upsert_record' THEN
          -- Add it, or find it, and log this touch on it. A record that is
          -- already there is never changed by this tool.
          IF jsonb_typeof(v_args->'record') IS DISTINCT FROM 'object' THEN
            RAISE EXCEPTION 'invalid_arguments: "record" is missing or the wrong kind. Send one record as an object with at least a name.' USING ERRCODE = '22023';
          END IF;
          v_g := public.crm_record_create(v_args->>'pipeline', v_args->'record', v_rk || '-c');
          v_replay := COALESCE((v_g->>'replayed')::boolean, false);
          IF v_g->>'status' = 'created' THEN
            v_id := (v_g->'record'->>'id')::uuid;
            v_result := jsonb_build_object('status', 'created', 'record', v_g->'record', 'moved_to', v_g->'moved_to');
            v_c1 := CASE WHEN v_replay THEN 0 ELSE 1 END;
          ELSE
            v_id := (v_g->'existing'->>'id')::uuid;
            v_result := jsonb_strip_nulls(jsonb_build_object('reason', v_g->'reason', 'matched_on', v_g->'matched_on'))
                        || jsonb_build_object('status', 'exists', 'record', public.crm_record_get(v_id)->'record');
            v_c2 := 1;
            -- Every record this one matches is weighed: the strictest contact
            -- rule on any of them is the verdict.
            BEGIN
              v_chk := public.crm_contact_check(v_args->>'pipeline', jsonb_build_array(jsonb_strip_nulls(
                         jsonb_build_object('name', v_args->'record'->'name', 'identifiers', v_args->'record'->'identifiers'))))->'results'->0;
            EXCEPTION WHEN invalid_parameter_value THEN
              v_chk := NULL;
            END;
            IF v_chk->>'verdict' IN ('exists', 'do_not_contact', 'warm_intro_only') THEN
              v_result := v_result || jsonb_build_object('verdict', v_chk->'verdict', 'matches', v_chk->'matches');
            END IF;
          END IF;
          IF v_args ? 'touch' AND jsonb_typeof(v_args->'touch') <> 'null' THEN
            BEGIN
              IF jsonb_typeof(v_args->'touch') <> 'object' THEN
                RAISE EXCEPTION 'invalid_entry: Send touch as one object with a channel, a direction and the message.' USING ERRCODE = '22023';
              END IF;
              -- A first message is not logged when any record this one
              -- matches carries a contact rule.
              IF v_chk->>'verdict' IN ('do_not_contact', 'warm_intro_only')
                 AND (v_args->'touch'->>'direction') IS DISTINCT FROM 'inbound' THEN
                RAISE EXCEPTION '%', format('%s: "%s" is marked %s: %s. Nothing was logged. %s',
                    v_chk->>'verdict', v_chk->'record'->>'name',
                    CASE v_chk->>'verdict' WHEN 'do_not_contact' THEN 'Do not contact' ELSE 'Warm intro only' END,
                    v_chk->'record'->>'contact_rule_reason',
                    CASE v_chk->>'verdict' WHEN 'do_not_contact' THEN 'Do not message them; tell your person.'
                                           ELSE 'Ask your person to make the introduction.' END)
                  USING ERRCODE = '42501';
              END IF;
              v_two := public.crm_record_log(v_id, (v_args->'touch') || jsonb_build_object('kind', 'touch'), v_rk || '-u');
              IF COALESCE((v_two->>'replayed')::boolean, false) THEN
                v_touch := jsonb_build_object('status', 'replayed', 'activity', v_two->'activity');
              ELSE
                v_touch := jsonb_build_object('status', 'logged', 'activity', v_two->'activity');
                v_c4 := 1;
              END IF;
              v_result := v_result || jsonb_build_object('record', v_two->'record');
            EXCEPTION
              WHEN invalid_parameter_value OR no_data_found OR insufficient_privilege THEN
                v_m := regexp_match(SQLERRM, '^([a-z_]+): (.+)$');
                v_touch := jsonb_build_object('status', 'refused', 'error', jsonb_build_object(
                  'token', COALESCE(v_m[1], 'refused'), 'message', COALESCE(v_m[2], 'That touch could not be logged.')));
                v_c5 := 1;
            END;
            v_result := v_result || jsonb_build_object('touch', v_touch);
          END IF;
          v_result := v_result || jsonb_build_object('replayed', v_replay);
          v_items := v_c1 + v_c4;
          v_sum := jsonb_build_object('created', v_c1, 'exists', v_c2, 'logged', v_c4, 'refused', v_c5,
                                      'replayed', v_replay::integer);

        WHEN 'save_drafts' THEN
          v_result := public.team_draft_save(v_args->'drafts', v_rk);
          v_items := (SELECT count(*) FROM jsonb_array_elements(v_result->'results') e WHERE e->>'status' = 'saved');
          v_sum := jsonb_build_object('saved', v_items,
            'refused', jsonb_array_length(v_result->'results') - v_items);

        WHEN 'update_draft' THEN
          IF jsonb_typeof(v_args->'id') IS DISTINCT FROM 'string' OR (v_args->>'id') !~* c_uuid
             OR jsonb_typeof(v_args->'changes') IS DISTINCT FROM 'object' THEN
            RAISE EXCEPTION 'invalid_arguments: Send a draft id and a changes object.' USING ERRCODE = '22023';
          END IF;
          v_result := public.team_draft_update((v_args->>'id')::uuid, v_args->'changes');
          v_items := CASE WHEN COALESCE((v_result->>'changed')::boolean, false) THEN 1 ELSE 0 END;
          v_sum := jsonb_build_object('updated', v_items);

        WHEN 'list_drafts' THEN
          v_result := public.team_draft_list(v_args);

        WHEN 'withdraw_drafts' THEN
          v_result := public.team_draft_discard(ARRAY(SELECT (e #>> '{}')::uuid FROM jsonb_array_elements(v_args->'ids') e));
          v_items := (SELECT count(*) FROM jsonb_array_elements(v_result->'results') e WHERE e->>'status' = 'discarded');
          v_sum := jsonb_build_object('discarded', v_items);

        WHEN 'update_records', 'move_stage', 'set_owners', 'log_activity', 'record_reply' THEN
          v_rows := '[]'::jsonb;
          FOR v_idx IN 0 .. jsonb_array_length(v_list) - 1 LOOP
            v_item := v_list->v_idx;
            BEGIN
              IF jsonb_typeof(v_item->'id') IS DISTINCT FROM 'string' OR (v_item->>'id') !~* c_uuid THEN
                RAISE EXCEPTION '%', format('invalid_id: "%s" is not a record id. Use an id returned by find_records.',
                  left(COALESCE(v_item->>'id', ''), 60)) USING ERRCODE = '22023';
              END IF;
              v_id := (v_item->>'id')::uuid;
              v_row := jsonb_build_object('index', v_idx, 'id', v_id);

              IF v_tool = 'update_records' THEN
                  IF EXISTS (SELECT 1 FROM jsonb_object_keys(v_item) AS k WHERE k NOT IN ('id', 'changes')) THEN
                    RAISE EXCEPTION 'unknown_field: An update takes id and changes, nothing else.' USING ERRCODE = '22023';
                  END IF;
                  v_one := public.crm_record_update(v_id, v_item->'changes');
                  IF COALESCE((v_one->>'changed')::boolean, false) THEN
                    v_row := v_row || jsonb_build_object('status', 'updated', 'record', v_one->'record', 'moved_to', v_one->'moved_to');
                    v_c1 := v_c1 + 1;
                  ELSE
                    v_row := v_row || jsonb_build_object('status', 'unchanged', 'record', v_one->'record');
                    v_c2 := v_c2 + 1;
                  END IF;

                ELSIF v_tool = 'move_stage' THEN
                  IF EXISTS (SELECT 1 FROM jsonb_object_keys(v_item) AS k WHERE k NOT IN ('id', 'to', 'expected_from', 'reason')) THEN
                    RAISE EXCEPTION 'unknown_field: A move takes id, to, expected_from and reason, nothing else.' USING ERRCODE = '22023';
                  END IF;
                  IF jsonb_typeof(v_item->'expected_from') IS DISTINCT FROM 'string' OR btrim(v_item->>'expected_from') = '' THEN
                    RAISE EXCEPTION '%', format('invalid_arguments: "moves[%s].expected_from" is missing or the wrong kind. Send the stage you saw the card in.', v_idx)
                      USING ERRCODE = '22023';
                  END IF;
                  v_one := public.crm_record_move_stage(v_id, v_item->>'to', v_item->>'reason', v_item->>'expected_from');
                  IF COALESCE((v_one->>'changed')::boolean, false) THEN
                    v_row := v_row || jsonb_build_object('status', 'moved', 'record', v_one->'record', 'activity_id', v_one->'activity_id');
                    v_c1 := v_c1 + 1;
                  ELSE
                    v_row := v_row || jsonb_build_object('status', 'already_there', 'record', v_one->'record');
                    v_c2 := v_c2 + 1;
                  END IF;

                ELSIF v_tool = 'set_owners' THEN
                  IF EXISTS (SELECT 1 FROM jsonb_object_keys(v_item) AS k WHERE k NOT IN ('id', 'owner_emails', 'watcher_emails'))  -- #4571 W3
                     OR jsonb_typeof(v_item->'owner_emails') IS DISTINCT FROM 'array'
                     OR jsonb_array_length(v_item->'owner_emails') > 10
                     OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_item->'owner_emails') AS e WHERE jsonb_typeof(e) <> 'string') THEN
                    RAISE EXCEPTION 'invalid_owners: Send owner_emails as a list of at most 10 team email addresses. An empty list means unassigned.' USING ERRCODE = '22023';
                  END IF;
                  -- #4571 W3: watcher_emails (optional, 0 to 10) is the whole watcher list; both lists are written in one step.
                  IF v_item ? 'watcher_emails' AND (jsonb_typeof(v_item->'watcher_emails') IS DISTINCT FROM 'array'
                     OR jsonb_array_length(v_item->'watcher_emails') > 10
                     OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_item->'watcher_emails') AS e WHERE jsonb_typeof(e) <> 'string')) THEN
                    RAISE EXCEPTION 'invalid_watchers: Send watcher_emails as a list of at most 10 team email addresses. An empty list means nobody watches.' USING ERRCODE = '22023';
                  END IF;
                  v_one := CASE WHEN v_item ? 'watcher_emails'
                    THEN public.crm_record_set_people(v_id, ARRAY(SELECT jsonb_array_elements_text(v_item->'owner_emails')),
                                                     ARRAY(SELECT jsonb_array_elements_text(v_item->'watcher_emails')), NULL)
                    ELSE public.crm_record_set_owners(v_id, ARRAY(SELECT jsonb_array_elements_text(v_item->'owner_emails'))) END;
                  IF COALESCE((v_one->>'changed')::boolean, false) THEN
                    v_row := v_row || jsonb_build_object('status', 'updated', 'record', v_one->'record');
                    v_c1 := v_c1 + 1;
                  ELSE
                    v_row := v_row || jsonb_build_object('status', 'unchanged', 'record', v_one->'record');
                    v_c2 := v_c2 + 1;
                  END IF;

                ELSIF v_tool = 'log_activity' THEN
                  v_one := public.crm_record_log(v_id, v_item - 'id', v_rk || '-l' || v_idx);
                  IF COALESCE((v_one->>'replayed')::boolean, false) THEN
                    v_row := v_row || jsonb_build_object('status', 'replayed', 'activity', v_one->'activity', 'record', v_one->'record');
                    v_c3 := v_c3 + 1;
                  ELSE
                    v_row := v_row || jsonb_build_object('status', 'logged', 'activity', v_one->'activity', 'record', v_one->'record');
                    v_c1 := v_c1 + 1;
                  END IF;
                  -- #4571 W6b (carry-over from W2): the next stage crm_record_log
                  -- suggests goes back to the agent. It is never applied.
                  v_row := v_row || jsonb_strip_nulls(jsonb_build_object('suggest_stage', v_one->'suggest_stage'));

                ELSE
                  -- record_reply: the inbound touch, then the card moves to
                  -- Replied (or to the stage asked for) when that applies.
                  IF EXISTS (SELECT 1 FROM jsonb_object_keys(v_item) AS k
                              WHERE k NOT IN ('id', 'channel', 'body', 'occurred_at', 'reply_class', 'message_ref', 'move_to', 'reason')) THEN
                    RAISE EXCEPTION 'unknown_field: A reply takes id, channel, body, occurred_at, reply_class, message_ref, move_to and reason, nothing else.' USING ERRCODE = '22023';
                  END IF;
                  IF jsonb_typeof(v_item->'body') IS DISTINCT FROM 'string' OR btrim(v_item->>'body') = '' THEN
                    RAISE EXCEPTION 'invalid_body: Record what they said, word for word.' USING ERRCODE = '22023';
                  END IF;
                  v_one := public.crm_record_log(v_id,
                    jsonb_strip_nulls(jsonb_build_object(
                      'kind', 'touch', 'direction', 'inbound', 'channel', v_item->'channel', 'body', v_item->'body',
                      'occurred_at', v_item->'occurred_at', 'reply_class', v_item->'reply_class',
                      'message_ref', v_item->'message_ref')),
                    v_rk || '-r' || v_idx);
                  v_moved := NULL;
                  v_note := NULL;
                  IF COALESCE((v_one->>'replayed')::boolean, false) THEN
                    v_row := v_row || jsonb_build_object('status', 'replayed', 'activity', v_one->'activity',
                                                         'record', v_one->'record', 'moved_to', NULL);
                    v_c3 := v_c3 + 1;
                  ELSE
                    v_pipe  := v_one->'record'->>'pipeline';
                    v_stage := v_one->'record'->>'stage';
                    v_to    := NULLIF(btrim(COALESCE(v_item->>'move_to', '')), '');
                    IF v_to IS NULL THEN
                      IF COALESCE((public.crm_stage_def(v_pipe, v_stage)->>'terminal')::boolean, false) THEN
                        v_note := format('This card is in %s, so it stayed there. Move it yourself if they are back.',
                                         public.crm_stage_def(v_pipe, v_stage)->>'label');
                      ELSIF (public.crm_stage_def(v_pipe, v_stage)->>'pos')::integer
                              < (public.crm_stage_def(v_pipe, 'replied')->>'pos')::integer THEN
                        v_to := 'replied';
                      ELSIF v_stage <> 'replied' THEN
                        v_note := format('Already in %s, so the card stayed where it is.',
                                         public.crm_stage_def(v_pipe, v_stage)->>'label');
                      END IF;
                    END IF;
                    v_two := NULL;
                    IF v_to IS NOT NULL THEN
                      BEGIN
                        v_two := public.crm_record_move_stage(v_id, v_to, v_item->>'reason', v_stage);
                        IF COALESCE((v_two->>'changed')::boolean, false) THEN
                          v_moved := v_to;
                          v_c2 := v_c2 + 1;
                        END IF;
                      EXCEPTION WHEN invalid_parameter_value OR no_data_found OR insufficient_privilege THEN
                        v_two := NULL;
                        v_note := SQLERRM;
                      END;
                    END IF;
                    v_row := v_row || jsonb_build_object('status', 'logged', 'activity', v_one->'activity',
                      'record', COALESCE(v_two->'record', v_one->'record'), 'moved_to', v_moved)
                      || jsonb_strip_nulls(jsonb_build_object('move_note', v_note));
                    v_c1 := v_c1 + 1;
                  END IF;
              END IF;
            EXCEPTION
              WHEN invalid_parameter_value OR no_data_found OR insufficient_privilege THEN
                v_m := regexp_match(SQLERRM, '^([a-z_]+): (.+)$');
                v_row := jsonb_build_object('index', v_idx, 'id', v_item->'id', 'status', 'error',
                  'error', jsonb_build_object('token', COALESCE(v_m[1], 'refused'),
                                              'message', COALESCE(v_m[2], 'That item was refused.')));
                v_c4 := v_c4 + 1;
              WHEN others THEN
                RAISE WARNING 'team_agent_call: % item % stopped the request (% %)', v_tool, v_idx, SQLSTATE, SQLERRM;
                RAISE EXCEPTION '%', format('try_again: Something went wrong on our side at item %s, so nothing in this request was saved. Send the same request again.', v_idx + 1)
                  USING ERRCODE = 'PT409';
            END;
            v_rows := v_rows || jsonb_build_array(v_row);
          END LOOP;
          v_result := jsonb_build_object('results', v_rows, 'counts', CASE v_tool
            WHEN 'update_records' THEN jsonb_build_object('updated', v_c1, 'unchanged', v_c2, 'error', v_c4)
            WHEN 'move_stage'     THEN jsonb_build_object('moved', v_c1, 'already_there', v_c2, 'error', v_c4)
            WHEN 'set_owners'     THEN jsonb_build_object('updated', v_c1, 'unchanged', v_c2, 'error', v_c4)
            WHEN 'log_activity'   THEN jsonb_build_object('logged', v_c1, 'replayed', v_c3, 'error', v_c4)
            ELSE jsonb_build_object('logged', v_c1, 'moved', v_c2, 'replayed', v_c3, 'error', v_c4) END);
          v_items := v_c1;
          v_sum := CASE v_tool
            WHEN 'update_records' THEN jsonb_build_object('updated', v_c1, 'unchanged', v_c2, 'refused', v_c4)
            WHEN 'move_stage'     THEN jsonb_build_object('moved', v_c1, 'unchanged', v_c2, 'refused', v_c4)
            WHEN 'set_owners'     THEN jsonb_build_object('updated', v_c1, 'unchanged', v_c2, 'refused', v_c4)
            WHEN 'log_activity'   THEN jsonb_build_object('logged', v_c1, 'replayed', v_c3, 'refused', v_c4)
            ELSE jsonb_build_object('logged', v_c1, 'moved', v_c2, 'replayed', v_c3, 'refused', v_c4) END;

        ELSE
          RAISE EXCEPTION 'unknown_tool: That tool does not exist. Call tools/list to see what is available.' USING ERRCODE = '22023';
      END CASE;
    END IF;
    v_ok := true;
  EXCEPTION WHEN others THEN
    v_items := 0;
    v_sum := '{}'::jsonb;
    v_m := regexp_match(SQLERRM, '^([a-z_]+): (.+)$');
    IF v_m IS NOT NULL THEN
      v_token := v_m[1];
      v_words := v_m[2];
    ELSE
      v_token := 'server_error';
      v_words := 'Something went wrong on our side. Nothing was saved. Send the same request again.';
      RAISE WARNING 'team_agent_call: tool % ended with an unexpected error (% %)', v_tool, SQLSTATE, SQLERRM;
    END IF;
  END;

  -- Counts only: never a name, an argument or a result.
  UPDATE public.team_agent_calls
     SET outcome = CASE WHEN v_ok THEN 'ok' ELSE left(v_token, 60) END,
         items = v_items,
         summary = v_sum,
         duration_ms = LEAST(2147483647, GREATEST(0, round(extract(epoch FROM (clock_timestamp() - v_started)) * 1000)))::integer
   WHERE id = v_call;

  IF v_ok THEN
    -- "dates" is there for a tool that depends on a date: the date and the
    -- time zone that answer was worked out for.
    RETURN jsonb_strip_nulls(jsonb_build_object('dates', v_dates))
           || jsonb_build_object('ok', true, 'result', v_result, 'me', v_me);
  END IF;
  RETURN jsonb_build_object('ok', false, 'error', jsonb_build_object('token', v_token, 'message', v_words), 'me', v_me);
END;
$function$;

COMMIT;
