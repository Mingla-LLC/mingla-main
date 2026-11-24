-- #4596 — an event audience is the event's paid buyers PLUS its going RSVP
-- guests, answered by ONE owner: the `event:<id>` source of
-- issue_4273_combined_identities.
--
--   identities   `event:<id>` now also yields the Book people linked to that
--                event's going + approved RSVPs (live link, active person,
--                this brand's event). Contacts and consent come from the Book
--                (biz_brand_person_authorized_contact_v2), never from
--                event_rsvps. Summary, reach, quote, confirm and the sealed
--                send all read identities, so they inherit it unchanged.
--   discovery    biz_marketing_event_audiences_v1: every event of the brand
--                with a paid buyer or a going RSVP guest, with its people,
--                buyer, guest and pending-duplicate-check counts.
--   event lane   biz_marketing_event_send_audience_v1: the legacy
--                `event_buyers` audience (older Host builds schedule it
--                without a quote) is resolved through the same owner and the
--                same send verdict as the combined lane (spec amendment A2,
--                Q4: the lane stays alive and delegates).
--   repair       failed campaigns that reached nobody and carry no reason are
--                given `no_recipients` (bounded).
--
-- Not shipped from amendment A1, by A2 Q4: the `event_buyers` schedule refusal
-- trigger and the in-flight precheck. Both would block the older builds A2
-- keeps working.
--
-- Invariants (declared in the pg17 test): I-4596-EVENT-AUDIENCE-ONE-OWNER.
-- Static SQL only; conflicts raise PT409 (never 40001).

BEGIN;

-- ── Identities: one owner for every event:<id> count and send ───────────────
CREATE OR REPLACE FUNCTION public.issue_4273_combined_identities(p_brand_id uuid, p_sources jsonb)
RETURNS TABLE(
  person_key text, node text, source_key text, subject text,
  brand_person_id uuid, user_id uuid, ring text, buyer_key text,
  buyer_email text, buyer_phone text, display_name text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, extensions, pg_temp
AS $fn$
WITH RECURSIVE keys AS MATERIALIZED (
  SELECT k FROM jsonb_array_elements_text(p_sources) k
), follower_scope AS MATERIALIZED (
  SELECT s.generation_id FROM public.issue_1777_brand_reach_scope_status(p_brand_id, 'follower') s
   WHERE EXISTS (SELECT 1 FROM keys WHERE k = 'followers') AND s.scope_state = 'ready'
), extended_scope AS MATERIALIZED (
  SELECT s.generation_id FROM public.issue_1777_brand_reach_scope_status(p_brand_id, 'extended') s
   WHERE EXISTS (SELECT 1 FROM keys WHERE k = 'extended') AND s.scope_state = 'ready'
), brand_orders AS MATERIALIZED (
  SELECT o.id, o.event_id, lower(btrim(o.buyer_email)) AS email, btrim(o.buyer_phone_e164) AS phone,
    o.buyer_name, o.buyer_user_id, o.created_at
    FROM public.orders o JOIN public.events e ON e.id = o.event_id
   WHERE EXISTS (SELECT 1 FROM keys WHERE k = 'brand_buyers' OR k LIKE 'event:%')
     AND e.brand_id = p_brand_id AND o.payment_status IN ('paid', 'partial_refund')
     AND btrim(COALESCE(o.buyer_email, '')) <> ''
), buyer_phone AS MATERIALIZED (
  -- A buyer's phone is the newest usable one on any of their orders with this
  -- brand, whichever list brought them in. Send accepts exactly what this sealed.
  SELECT DISTINCT ON (o.email) o.email, o.phone FROM brand_orders o
   WHERE o.phone ~ '^\+[1-9][0-9]{6,14}$'
   ORDER BY o.email, o.created_at DESC, o.id
), buyer_account AS MATERIALIZED (
  SELECT DISTINCT ON (o.email) o.email, o.buyer_user_id AS user_id FROM brand_orders o
   WHERE o.buyer_user_id IS NOT NULL
   ORDER BY o.email, o.created_at DESC, o.id
), buyer_orders AS MATERIALIZED (
  SELECT 'brand_buyers'::text AS source_key, o.email, o.buyer_name, o.created_at, o.id FROM brand_orders o
   WHERE EXISTS (SELECT 1 FROM keys WHERE k = 'brand_buyers')
  UNION ALL
  SELECT 'event:' || o.event_id::text, o.email, o.buyer_name, o.created_at, o.id FROM brand_orders o
   WHERE ('event:' || o.event_id::text) IN (SELECT k FROM keys)
), rsvp_people AS MATERIALIZED (
  -- #4596: the event's going + approved RSVP guests, as the Book people their
  -- RSVP is linked to (live link, active person, this brand's event). Their
  -- contacts and consent come from the Book, never from event_rsvps itself.
  SELECT DISTINCT 'event:' || r.event_id::text AS source_key, bp.id, bp.linked_user_id, bp.display_name
    FROM public.event_rsvps r
    JOIN public.events e ON e.id = r.event_id AND e.brand_id = p_brand_id
    JOIN public.brand_person_source_links l
      ON l.source_kind = 'event_rsvp' AND l.source_id = r.id
     AND l.brand_id = p_brand_id AND l.detached_at IS NULL
    JOIN public.brand_people bp ON bp.id = l.brand_person_id AND bp.brand_id = p_brand_id
   WHERE ('event:' || r.event_id::text) IN (SELECT k FROM keys)
     AND r.rsvp_status = 'going' AND r.approval_status = 'approved'
     AND bp.record_status = 'active' AND bp.deleted_at IS NULL
), raw AS MATERIALIZED (
  SELECT 'book:' || bp.id::text AS node, 'book'::text AS source_key, 'book'::text AS subject,
    bp.id AS brand_person_id, bp.linked_user_id AS user_id, NULL::text AS ring, NULL::text AS buyer_key,
    NULL::text AS buyer_email, NULL::text AS buyer_phone, bp.display_name
    FROM public.brand_people bp
   WHERE EXISTS (SELECT 1 FROM keys WHERE k = 'book')
     AND bp.brand_id = p_brand_id AND bp.record_status = 'active' AND bp.deleted_at IS NULL
  UNION ALL
  SELECT 'book:' || bp.id::text, 'group:' || gm.audience_id::text, 'book', bp.id, bp.linked_user_id,
    NULL, NULL, NULL, NULL, bp.display_name
    FROM public.marketing_manual_group_memberships gm
    JOIN public.brand_people bp ON bp.id = gm.brand_person_id AND bp.brand_id = gm.brand_id
   WHERE ('group:' || gm.audience_id::text) IN (SELECT k FROM keys)
     AND gm.brand_id = p_brand_id AND gm.state = 'active'
     AND bp.record_status = 'active' AND bp.deleted_at IS NULL
  UNION ALL
  -- Followers outside the Book, from the same ready snapshot the circle lane reads.
  SELECT 'user:' || rm.user_id::text, 'followers', 'circle', NULL, rm.user_id, 'follower',
    NULL, NULL, NULL, rm.display_name
    FROM follower_scope s JOIN public.brand_reach_members rm
      ON rm.brand_id = p_brand_id AND rm.ring = 'follower' AND rm.generation_id = s.generation_id
  UNION ALL
  -- Followers who are also in the Book. The reach snapshot leaves them out, which
  -- is why the picker used to say "No followers yet"; ticking Followers still
  -- means them. Same account checks as the #1777 resolver.
  SELECT 'user:' || bf.user_id::text, 'followers', 'circle', NULL, bf.user_id, 'follower',
    NULL, NULL, NULL, COALESCE(NULLIF(btrim(p.display_name), ''), NULLIF(btrim(p.first_name), ''))
    FROM follower_scope s
    JOIN public.brand_follows bf ON bf.brand_id = p_brand_id
    JOIN public.profiles p ON p.id = bf.user_id
   WHERE p.active IS TRUE AND p.explorer_deleted_at IS NULL AND p.has_completed_onboarding IS TRUE
     AND p.visibility_mode IS NOT NULL AND p.visibility_mode <> 'private'
     AND EXISTS (SELECT 1 FROM public.brand_people bp
                  WHERE bp.brand_id = p_brand_id AND bp.linked_user_id = bf.user_id
                    AND bp.record_status = 'active' AND bp.deleted_at IS NULL)
     AND NOT EXISTS (SELECT 1 FROM public.brand_circle_exits bx
                      WHERE bx.brand_id = p_brand_id AND bx.user_id = bf.user_id
                        AND bx.visibility_exited_at IS NOT NULL)
  UNION ALL
  SELECT 'user:' || rm.user_id::text, 'extended', 'circle', NULL, rm.user_id, 'extended',
    NULL, NULL, NULL, rm.display_name
    FROM extended_scope s JOIN public.brand_reach_members rm
      ON rm.brand_id = p_brand_id AND rm.ring = 'extended' AND rm.generation_id = s.generation_id
  UNION ALL
  -- #4596: RSVP guests of an event source are Book nodes under that event key.
  SELECT 'book:' || rp.id::text, rp.source_key, 'book', rp.id, rp.linked_user_id,
    NULL, NULL, NULL, NULL, rp.display_name
    FROM rsvp_people rp
  UNION ALL
  SELECT b.* FROM (
    SELECT DISTINCT ON (o.source_key, o.email)
      'buyer:' || encode(extensions.digest(convert_to(o.email, 'UTF8'), 'sha256'), 'hex') AS node,
      o.source_key, 'buyer'::text AS subject, NULL::uuid AS brand_person_id, ba.user_id, NULL::text AS ring,
      encode(extensions.digest(convert_to(o.email, 'UTF8'), 'sha256'), 'hex') AS buyer_key,
      o.email AS buyer_email, bp.phone AS buyer_phone, o.buyer_name AS display_name
      FROM buyer_orders o
      LEFT JOIN buyer_phone bp ON bp.email = o.email
      LEFT JOIN buyer_account ba ON ba.email = o.email
     ORDER BY o.source_key, o.email, o.created_at DESC, o.id
  ) b
), nodes AS MATERIALIZED (
  SELECT DISTINCT r.node, r.brand_person_id, r.user_id, r.buyer_email, r.buyer_phone FROM raw r
), node_keys AS MATERIALIZED (
  SELECT n.node, 'u:' || n.user_id::text AS key FROM nodes n WHERE n.user_id IS NOT NULL
  UNION
  SELECT n.node, 'e:' || n.buyer_email FROM nodes n WHERE n.buyer_email IS NOT NULL
  UNION
  SELECT n.node, 'p:' || n.buyer_phone FROM nodes n
   WHERE n.buyer_phone IS NOT NULL AND btrim(n.buyer_phone) <> ''
  UNION
  SELECT n.node, CASE m.channel WHEN 'email' THEN 'e:' || lower(m.normalized_value) ELSE 'p:' || m.normalized_value END
    FROM nodes n JOIN public.brand_person_contact_methods m
      ON m.brand_person_id = n.brand_person_id AND m.brand_id = p_brand_id
   WHERE m.record_state = 'active' AND m.channel IN ('email', 'phone')
), key_roots AS MATERIALIZED (
  -- An account always joins. A contact joins only when an order is involved: two
  -- Book rows the host keeps apart stay two people, even on one family phone.
  SELECT nk.key, min(nk.node) AS root FROM node_keys nk
   GROUP BY nk.key
  HAVING nk.key LIKE 'u:%' OR bool_or(nk.node NOT LIKE 'book:%')
), edges AS MATERIALIZED (
  SELECT DISTINCT nk.node AS a, kr.root AS b FROM node_keys nk JOIN key_roots kr USING (key) WHERE nk.node <> kr.root
  UNION
  SELECT DISTINCT kr.root, nk.node FROM node_keys nk JOIN key_roots kr USING (key) WHERE nk.node <> kr.root
), walk(root, node) AS (
  SELECT n.node, n.node FROM nodes n
  UNION
  SELECT w.root, e.b FROM walk w JOIN edges e ON e.a = w.node
), components AS MATERIALIZED (
  SELECT w.node, min(w.root) AS person_key FROM walk w GROUP BY w.node
)
SELECT c.person_key, r.node, r.source_key, r.subject, r.brand_person_id, r.user_id, r.ring,
  r.buyer_key, r.buyer_email, r.buyer_phone, r.display_name
FROM raw r JOIN components c ON c.node = r.node$fn$;

-- ── Discovery: every event a host can blast, with honest counts ─────────────
CREATE OR REPLACE FUNCTION public.biz_marketing_event_audiences_v1(p_actor_id uuid, p_brand_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp
AS $fn$
DECLARE
  v_event record; v_sources jsonb; v_people integer; v_buyers integer; v_guests integer;
  v_pending integer; v_out jsonb := '[]'::jsonb;
BEGIN
  IF auth.uid() IS DISTINCT FROM p_actor_id
     OR COALESCE(public.biz_brand_effective_rank(p_brand_id, p_actor_id), -1) < public.biz_role_rank('marketing_manager') THEN
    RAISE EXCEPTION 'book_blast_forbidden' USING ERRCODE = '42501';
  END IF;

  FOR v_event IN
    SELECT e.id, e.title, e.event_type,
      (SELECT min(d.start_at) FROM public.event_dates d WHERE d.event_id = e.id) AS starts_at
      FROM public.events e
     WHERE e.brand_id = p_brand_id AND e.deleted_at IS NULL
       AND (EXISTS (SELECT 1 FROM public.orders o
                     WHERE o.event_id = e.id AND o.payment_status IN ('paid', 'partial_refund'))
            OR EXISTS (SELECT 1 FROM public.event_rsvps r
                        WHERE r.event_id = e.id AND r.rsvp_status = 'going' AND r.approval_status = 'approved'))
     ORDER BY 4 DESC NULLS LAST, e.title, e.id
  LOOP
    v_sources := jsonb_build_array('event:' || v_event.id::text);
    v_people := COALESCE((public.issue_4273_source_totals(p_brand_id, v_sources) ->> 'peopleCount')::integer, 0);
    SELECT count(DISTINCT i.person_key) FILTER (WHERE i.subject = 'buyer')::integer,
           count(DISTINCT i.person_key) FILTER (WHERE i.subject = 'book')::integer
      INTO v_buyers, v_guests
      FROM public.issue_4273_combined_identities(p_brand_id, v_sources) i;
    -- A going guest whose RSVP is not (yet) linked to an active Book person:
    -- today these wait on the host's duplicate check, so they cannot be sent to.
    SELECT count(*)::integer INTO v_pending
      FROM public.event_rsvps r
     WHERE r.event_id = v_event.id AND r.rsvp_status = 'going' AND r.approval_status = 'approved'
       AND NOT EXISTS (
         SELECT 1 FROM public.brand_person_source_links l
           JOIN public.brand_people bp ON bp.id = l.brand_person_id
          WHERE l.source_kind = 'event_rsvp' AND l.source_id = r.id AND l.brand_id = p_brand_id
            AND l.detached_at IS NULL AND bp.brand_id = p_brand_id
            AND bp.record_status = 'active' AND bp.deleted_at IS NULL);
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'eventId', v_event.id, 'title', v_event.title, 'eventType', v_event.event_type,
      'startsAt', v_event.starts_at, 'buyerCount', v_buyers, 'guestCount', v_guests,
      'peopleCount', v_people, 'pendingReviewCount', v_pending));
  END LOOP;
  RETURN v_out;
END;
$fn$;

-- ── Legacy event_buyers lane: delegates to the same owner (A2 Q4) ───────────
-- Older Host builds schedule an `event_buyers` campaign directly, with no quote
-- or sealed execution. Its recipients are decided now, by the combined lane's
-- own rules: issue_4273_decided_people (consent, opt-outs, blocks, one row per
-- address) and then issue_4273_send_verdict (the send-time strictest rule).
-- Service-only; the edge resolves the rows it sends from this.
CREATE OR REPLACE FUNCTION public.biz_marketing_event_send_audience_v1(p_campaign_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp
AS $fn$
DECLARE
  v_campaign public.marketing_campaigns%ROWTYPE; v_definition jsonb; v_event_id uuid;
  v_event_brand uuid; v_event_title text; v_sources jsonb; v_rows jsonb;
BEGIN
  SELECT * INTO v_campaign FROM public.marketing_campaigns WHERE id = p_campaign_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'book_blast_audience_not_found' USING ERRCODE = 'P0002'; END IF;
  SELECT a.query_definition INTO v_definition FROM public.marketing_audiences a
   WHERE a.id = v_campaign.audience_id AND a.deleted_at IS NULL;
  IF v_definition IS NULL OR v_definition ->> 'kind' IS DISTINCT FROM 'event_buyers'
     OR COALESCE(v_definition ->> 'event_id', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'book_blast_audience_not_found' USING ERRCODE = 'P0002';
  END IF;
  v_event_id := (v_definition ->> 'event_id')::uuid;
  SELECT e.brand_id, e.title INTO v_event_brand, v_event_title FROM public.events e WHERE e.id = v_event_id;
  IF v_event_brand IS NULL OR v_event_brand IS DISTINCT FROM v_campaign.brand_id THEN
    RAISE EXCEPTION 'audience_brand_mismatch' USING ERRCODE = '42501';
  END IF;
  IF v_campaign.channel NOT IN ('email', 'sms') THEN
    RAISE EXCEPTION 'book_blast_audience_not_found' USING ERRCODE = 'P0002';
  END IF;
  v_sources := jsonb_build_array('event:' || v_event_id::text);

  WITH ids AS MATERIALIZED (
    SELECT i.* FROM public.issue_4273_combined_identities(v_event_brand, v_sources) i
  ), decided AS MATERIALIZED (
    SELECT d.* FROM public.issue_4273_decided_people(v_campaign.account_id, v_event_brand, v_sources, v_campaign.channel) d
     WHERE d.allowed AND d.normalized_contact IS NOT NULL
  ), named AS MATERIALIZED (
    SELECT d.*,
      (SELECT i.display_name FROM ids i
        WHERE i.person_key = d.person_key AND i.subject = d.subject
          AND (i.brand_person_id = d.brand_person_id OR i.buyer_key = d.buyer_key)
        ORDER BY i.node LIMIT 1) AS name,
      (SELECT i.buyer_email FROM ids i
        WHERE d.subject = 'buyer' AND i.buyer_key = d.buyer_key LIMIT 1) AS buyer_email
    FROM decided d
  ), judged AS MATERIALIZED (
    SELECT n.*, public.issue_4273_send_verdict(v_campaign.account_id, v_event_brand, v_campaign.channel,
      n.normalized_contact, n.brand_person_id, n.user_id, n.buyer_email) AS verdict
    FROM named n
  ), sendable AS MATERIALIZED (
    SELECT DISTINCT ON (lower(j.normalized_contact)) j.*
      FROM judged j WHERE j.verdict = 'send'
     ORDER BY lower(j.normalized_contact), CASE j.subject WHEN 'book' THEN 0 ELSE 1 END, j.person_key
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'contact_key', COALESCE(s.brand_person_id::text, s.buyer_key, s.person_key),
    'display_name', COALESCE(NULLIF(btrim(s.name), ''), 'there'),
    'first_name', COALESCE(NULLIF(split_part(btrim(COALESCE(s.name, '')), ' ', 1), ''), 'there'),
    'raw_email', CASE WHEN v_campaign.channel = 'email' THEN s.normalized_contact END,
    'raw_phone', CASE WHEN v_campaign.channel = 'sms' THEN s.normalized_contact END,
    'order_count', 0, 'total_spend_minor', 0, 'total_spend_currency', 'USD',
    'last_event_id', v_event_id, 'last_event_name', v_event_title, 'last_purchase_at', NULL,
    'email_marketing_ok', v_campaign.channel = 'email',
    'sms_marketing_ok', v_campaign.channel = 'sms',
    'receive_reason', CASE s.subject WHEN 'book' THEN 'rsvp' ELSE 'bought' END
  ) ORDER BY COALESCE(s.brand_person_id::text, s.buyer_key, s.person_key)), '[]'::jsonb) INTO v_rows
  FROM sendable s;

  RETURN jsonb_build_object('rows', v_rows, 'brand_id', v_event_brand, 'reach', jsonb_build_object(
    'total', jsonb_array_length(v_rows),
    'reachable_email', CASE WHEN v_campaign.channel = 'email' THEN jsonb_array_length(v_rows) ELSE 0 END,
    'reachable_sms', CASE WHEN v_campaign.channel = 'sms' THEN jsonb_array_length(v_rows) ELSE 0 END));
END;
$fn$;

-- ── Grants ──────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.biz_marketing_event_audiences_v1(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.biz_marketing_event_audiences_v1(uuid, uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.biz_marketing_event_send_audience_v1(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.biz_marketing_event_send_audience_v1(uuid) TO service_role;

-- ── Bounded repair: a failed campaign that reached nobody says why ──────────
DO $repair$
DECLARE v_count integer;
BEGIN
  SELECT count(*)::integer INTO v_count FROM public.marketing_campaigns
   WHERE status = 'failed' AND failure_reason IS NULL AND COALESCE(recipient_count, 0) = 0;
  IF v_count > 10 THEN
    RAISE EXCEPTION 'issue_4596_null_reason_repair_too_wide: % rows', v_count;
  END IF;
  UPDATE public.marketing_campaigns SET failure_reason = 'no_recipients'
   WHERE status = 'failed' AND failure_reason IS NULL AND COALESCE(recipient_count, 0) = 0;
END;
$repair$;

COMMIT;
