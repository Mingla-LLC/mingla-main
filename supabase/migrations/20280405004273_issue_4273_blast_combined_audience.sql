-- #4273 wave B — a Blast picks several audiences and several methods.
--
-- One new audience shape, one new sealed lane. Nothing old changes:
--
--   combined_sources  A system audience whose query_definition names a sorted
--                     list of source keys: book, followers, extended,
--                     group:<uuid>, brand_buyers, event:<uuid>. One row per
--                     distinct source set per brand.
--   identities        Every source row becomes a node; nodes that share a
--                     Mingla account, an email or a phone are one person, so
--                     each person counts once across every group and method.
--   candidates        One row per person per method, carrying the quote's
--                     delivery identity. Graph-only contact details stay in
--                     the service-only candidate list; the host sees names and
--                     totals.
--   decision          The strictest wins: any identity of a person that is
--                     opted out, muted or denied blocks that person on that
--                     method, whichever group brought them in.
--   confirm / send    biz_confirm_marketing_combined_send_v1 seals the same set
--                     the quote priced; biz_marketing_combined_send_audience_v1
--                     re-decides each sealed person at send time.
--   push              biz_marketing_push_quote_candidates_v1 gains a combined
--                     branch. A buyer list stays refused for push: the rule is
--                     unchanged, it never silently pushes to a subset.
--
-- Backward compatibility: the book, people, circle and push lanes, their
-- payloads and every scheduled campaign keep their shapes. Older installed
-- apps never create a combined audience; if one reopens a combined draft, the
-- guard below refuses to schedule it without a sealed execution rather than
-- leaving it stuck.
--
-- Static SQL only; conflicts raise PT409 (never 40001).
--
-- Invariants (declared in the pg17 test): I-4273-BLAST-PERSON-COUNTS-ONCE and
-- I-4273-BLAST-QUOTE-EQUALS-SEALED-SET.

BEGIN;

-- ── Audience shape ──────────────────────────────────────────────────────────
ALTER TABLE public.marketing_audiences
  DROP CONSTRAINT IF EXISTS marketing_audiences_query_kind_valid;
ALTER TABLE public.marketing_audiences
  ADD CONSTRAINT marketing_audiences_query_kind_valid CHECK (
    jsonb_typeof(query_definition)='object' AND (
      (query_definition->>'kind') IN ('brand_buyers','event_buyers','custom_segment','offering_send_group')
      OR (query_definition->>'kind' IN ('all_brand_people','brand_followers','brand_circle_extended')
        AND query_definition-ARRAY['kind','brand_id']='{}'::jsonb
        AND query_definition->>'brand_id'=brand_id::text
        AND is_system_generated)
      OR (query_definition='{"kind":"manual_group"}'::jsonb
        AND brand_id IS NOT NULL AND NOT is_system_generated)
      OR (query_definition->>'kind'='combined_sources'
        AND query_definition-ARRAY['kind','brand_id','sources']='{}'::jsonb
        AND query_definition->>'brand_id'=brand_id::text
        AND jsonb_typeof(query_definition->'sources')='array'
        AND jsonb_array_length(query_definition->'sources')>=1
        AND is_system_generated)
    )
  );
CREATE UNIQUE INDEX issue_4273_one_combined_audience_per_source_set
  ON public.marketing_audiences(brand_id, md5((query_definition->'sources')::text))
  WHERE is_system_generated AND query_definition->>'kind'='combined_sources';

-- ── Sealed targets gain a third subject: a buyer known only from orders ─────
ALTER TABLE public.marketing_book_send_targets
  ADD COLUMN buyer_contact_key text
    CHECK (buyer_contact_key IS NULL OR buyer_contact_key ~ '^[0-9a-f]{64}$');
ALTER TABLE public.marketing_book_send_targets
  DROP CONSTRAINT issue_1778_target_subject,
  DROP CONSTRAINT issue_1778_target_delivery_shape;
ALTER TABLE public.marketing_book_send_targets
  ADD CONSTRAINT issue_1778_target_subject CHECK(
    (brand_person_id IS NOT NULL AND recipient_user_id IS NULL AND ring IS NULL
      AND circle_snapshot_version IS NULL AND buyer_contact_key IS NULL)
    OR
    (brand_person_id IS NULL AND recipient_user_id IS NOT NULL AND ring IN('follower','extended')
      AND circle_snapshot_version IS NOT NULL AND buyer_contact_key IS NULL)
    OR
    (brand_person_id IS NULL AND recipient_user_id IS NULL AND ring IS NULL
      AND circle_snapshot_version IS NULL AND buyer_contact_key IS NOT NULL)
  ),
  ADD CONSTRAINT issue_1778_target_delivery_shape CHECK(
    (outcome='unavailable' AND contact_method_id IS NULL AND contact_value_digest IS NULL)
    OR
    (outcome<>'unavailable' AND contact_value_digest IS NOT NULL AND
      (contact_method_id IS NOT NULL OR recipient_user_id IS NOT NULL OR buyer_contact_key IS NOT NULL))
  );
CREATE UNIQUE INDEX issue_4273_one_buyer_target_per_execution
  ON public.marketing_book_send_targets(execution_id, buyer_contact_key, channel)
  WHERE buyer_contact_key IS NOT NULL;

-- ── Source keys ─────────────────────────────────────────────────────────────
-- Sorted, distinct, and proven to belong to this brand.
CREATE OR REPLACE FUNCTION public.issue_4273_normalize_sources(p_brand_id uuid, p_sources jsonb)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_key text; v_keys text[] := '{}'; v_id uuid;
BEGIN
  IF jsonb_typeof(p_sources) <> 'array' OR jsonb_array_length(p_sources) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'book_blast_audience_not_found' USING ERRCODE = 'P0002';
  END IF;
  FOR v_key IN SELECT DISTINCT x FROM jsonb_array_elements_text(p_sources) x ORDER BY x LOOP
    IF v_key IN ('book', 'followers', 'extended', 'brand_buyers') THEN
      v_keys := v_keys || v_key;
    ELSIF v_key ~ '^group:[0-9a-f-]{36}$' THEN
      v_id := substr(v_key, 7)::uuid;
      IF NOT EXISTS (SELECT 1 FROM public.marketing_audiences a
                      WHERE a.id = v_id AND a.brand_id = p_brand_id AND a.deleted_at IS NULL
                        AND NOT a.is_system_generated
                        AND a.query_definition = '{"kind":"manual_group"}'::jsonb) THEN
        RAISE EXCEPTION 'book_blast_audience_not_found' USING ERRCODE = 'P0002';
      END IF;
      v_keys := v_keys || v_key;
    ELSIF v_key ~ '^event:[0-9a-f-]{36}$' THEN
      v_id := substr(v_key, 7)::uuid;
      IF NOT EXISTS (SELECT 1 FROM public.events e WHERE e.id = v_id AND e.brand_id = p_brand_id) THEN
        RAISE EXCEPTION 'book_blast_audience_not_found' USING ERRCODE = 'P0002';
      END IF;
      v_keys := v_keys || v_key;
    ELSE
      RAISE EXCEPTION 'book_blast_audience_not_found' USING ERRCODE = 'P0002';
    END IF;
  END LOOP;
  RETURN to_jsonb(v_keys);
END;
$fn$;

-- The host-facing name of one source. Names only, never a contact.
CREATE OR REPLACE FUNCTION public.issue_4273_source_name(p_brand_id uuid, p_key text)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
  SELECT CASE
    WHEN p_key = 'book' THEN 'Your Book'
    WHEN p_key = 'followers' THEN 'Followers'
    WHEN p_key = 'extended' THEN 'Friends of followers'
    WHEN p_key = 'brand_buyers' THEN
      'All buyers of ' || COALESCE((SELECT b.name FROM public.brands b WHERE b.id = p_brand_id), 'this brand')
    WHEN p_key LIKE 'group:%' THEN
      COALESCE((SELECT a.name FROM public.marketing_audiences a
                 WHERE a.id = substr(p_key, 7)::uuid AND a.brand_id = p_brand_id), 'Saved group')
    ELSE
      'Buyers of ' || COALESCE((SELECT e.title FROM public.events e
                                 WHERE e.id = substr(p_key, 7)::uuid AND e.brand_id = p_brand_id), 'Untitled event')
  END
$fn$;

CREATE OR REPLACE FUNCTION public.issue_4273_sources_name(p_brand_id uuid, p_sources jsonb)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
  -- Your Book first, then the design's section order, then by name.
  SELECT left(string_agg(n.name, ' + ' ORDER BY n.rank, n.name), 180)
  FROM (
    SELECT public.issue_4273_source_name(p_brand_id, k) AS name,
      CASE WHEN k = 'book' THEN 0 WHEN k = 'followers' THEN 1 WHEN k = 'extended' THEN 2
           WHEN k LIKE 'group:%' THEN 3 WHEN k = 'brand_buyers' THEN 4 ELSE 5 END AS rank
    FROM jsonb_array_elements_text(p_sources) k
  ) n
$fn$;

-- ── Identities: every source row, joined into one person ────────────────────
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
), buyer_orders AS MATERIALIZED (
  SELECT 'brand_buyers'::text AS source_key, o.buyer_email, o.buyer_phone_e164, o.buyer_name, o.buyer_user_id, o.created_at
    FROM public.orders o JOIN public.events e ON e.id = o.event_id
   WHERE EXISTS (SELECT 1 FROM keys WHERE k = 'brand_buyers')
     AND e.brand_id = p_brand_id AND o.payment_status IN ('paid', 'partial_refund')
     AND btrim(COALESCE(o.buyer_email, '')) <> ''
  UNION ALL
  SELECT 'event:' || o.event_id::text, o.buyer_email, o.buyer_phone_e164, o.buyer_name, o.buyer_user_id, o.created_at
    FROM public.orders o JOIN public.events e ON e.id = o.event_id
   WHERE ('event:' || o.event_id::text) IN (SELECT k FROM keys)
     AND e.brand_id = p_brand_id AND o.payment_status IN ('paid', 'partial_refund')
     AND btrim(COALESCE(o.buyer_email, '')) <> ''
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
  SELECT b.* FROM (
    SELECT DISTINCT ON (o.source_key, lower(btrim(o.buyer_email)))
      'buyer:' || encode(extensions.digest(convert_to(lower(btrim(o.buyer_email)), 'UTF8'), 'sha256'), 'hex') AS node,
      o.source_key, 'buyer'::text AS subject, NULL::uuid AS brand_person_id, o.buyer_user_id AS user_id, NULL::text AS ring,
      encode(extensions.digest(convert_to(lower(btrim(o.buyer_email)), 'UTF8'), 'sha256'), 'hex') AS buyer_key,
      lower(btrim(o.buyer_email)) AS buyer_email, o.buyer_phone_e164 AS buyer_phone, o.buyer_name AS display_name
      FROM buyer_orders o
     ORDER BY o.source_key, lower(btrim(o.buyer_email)), o.created_at DESC
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
  UNION
  -- Stays inside this function: only the person_key leaves, never the contact.
  SELECT n.node, CASE i.kind WHEN 'email' THEN 'e:' || lower(i.value) ELSE 'p:' || i.value END
    FROM nodes n CROSS JOIN LATERAL public.verified_account_identifiers(n.user_id) i
   WHERE n.user_id IS NOT NULL AND n.brand_person_id IS NULL AND i.kind IN ('email', 'phone')
), key_roots AS MATERIALIZED (
  SELECT nk.key, min(nk.node) AS root FROM node_keys nk GROUP BY nk.key
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
FROM raw r JOIN components c ON c.node = r.node
$fn$;

-- ── Per-source totals (names and counts only) ───────────────────────────────
CREATE OR REPLACE FUNCTION public.issue_4273_source_totals(p_brand_id uuid, p_sources jsonb)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
  WITH ids AS MATERIALIZED (
    SELECT i.person_key, i.source_key FROM public.issue_4273_combined_identities(p_brand_id, p_sources) i
  ), per AS (
    SELECT k AS source_key,
      (SELECT count(DISTINCT x.person_key) FROM ids x WHERE x.source_key = k)::integer AS people,
      (SELECT count(DISTINCT x.person_key) FROM ids x
        WHERE x.source_key = k AND k <> 'book'
          AND EXISTS (SELECT 1 FROM ids b WHERE b.source_key = 'book' AND b.person_key = x.person_key))::integer AS also_in_book
    FROM jsonb_array_elements_text(p_sources) k
  )
  SELECT jsonb_build_object(
    'peopleCount', (SELECT count(DISTINCT person_key) FROM ids),
    'sources', COALESCE(jsonb_agg(jsonb_build_object(
      'key', per.source_key,
      'name', public.issue_4273_source_name(p_brand_id, per.source_key),
      'count', per.people,
      'alsoInBookCount', per.also_in_book
    ) ORDER BY
      CASE WHEN per.source_key = 'book' THEN 0 WHEN per.source_key = 'followers' THEN 1
           WHEN per.source_key = 'extended' THEN 2 WHEN per.source_key LIKE 'group:%' THEN 3
           WHEN per.source_key = 'brand_buyers' THEN 4 ELSE 5 END,
      public.issue_4273_source_name(p_brand_id, per.source_key)), '[]'::jsonb))
  FROM per
$fn$;

-- ── Role and switch gates for a source set ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.issue_4273_assert_sources_allowed(
  p_actor_id uuid, p_brand_id uuid, p_sources jsonb
) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_only_book boolean;
BEGIN
  v_only_book := NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(p_sources) k WHERE k <> 'book');
  IF public.biz_brand_effective_rank(p_brand_id, p_actor_id) <
     public.biz_role_rank(CASE WHEN v_only_book THEN 'event_manager' ELSE 'marketing_manager' END) THEN
    RAISE EXCEPTION 'book_blast_forbidden' USING ERRCODE = '42501';
  END IF;
  IF NOT public.issue_1995_flags_enabled()
     OR (EXISTS (SELECT 1 FROM jsonb_array_elements_text(p_sources) k WHERE k LIKE 'group:%')
         AND NOT public.issue_2395_feature_enabled()) THEN
    RAISE EXCEPTION 'book_blast_flag_disabled' USING ERRCODE = '55000';
  END IF;
END;
$fn$;

-- A follower's own switches apply to everyone who follows, whichever group
-- brought them in (the same rule the push lane already has).
CREATE OR REPLACE FUNCTION public.issue_4273_follow_gate_ok(
  p_user_id uuid, p_brand_id uuid, p_channel text
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
  SELECT p_user_id IS NULL
    OR NOT EXISTS (SELECT 1 FROM public.brand_follows bf
                    WHERE bf.brand_id = p_brand_id AND bf.user_id = p_user_id)
    OR public.biz_brand_follow_channel_ok(p_user_id, p_brand_id, p_channel)
$fn$;

-- A buyer known only from orders: same ledgers the buyer resolver reads, plus
-- can_send. A phone that is not E.164 cannot be priced or sent, so it is absent.
CREATE OR REPLACE FUNCTION public.issue_4273_buyer_contact_decision(
  p_brand_id uuid, p_email text, p_phone text, p_channel text
) RETURNS TABLE(normalized_contact text, allowed boolean, reason text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_contact text; v_blocked boolean; v_can_send boolean;
BEGIN
  v_contact := CASE p_channel
    WHEN 'email' THEN lower(btrim(p_email))
    WHEN 'sms' THEN CASE WHEN btrim(COALESCE(p_phone, '')) ~ '^\+[1-9][0-9]{6,14}$' THEN btrim(p_phone) END
  END;
  IF v_contact IS NULL OR v_contact = '' THEN
    RETURN QUERY SELECT NULL::text, false, 'channel_unavailable'::text; RETURN;
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM public.marketing_unsubscribes u
     WHERE u.channel IN (p_channel, 'all')
       AND (lower(u.contact_email) = lower(btrim(p_email))
            OR (p_channel = 'sms' AND u.contact_phone = v_contact))
       AND (u.scope = 'global' OR (u.scope = 'brand' AND u.brand_id = p_brand_id))
    UNION ALL
    SELECT 1 FROM public.channel_suppressions s
     WHERE s.channel = p_channel AND s.scope IN ('marketing', 'all')
       AND lower(s.contact) = lower(v_contact)
  ) INTO v_blocked;
  v_can_send := public.can_send(NULL::uuid, 'marketing_blast', p_channel, v_contact);
  RETURN QUERY SELECT v_contact, NOT v_blocked AND v_can_send,
    CASE WHEN v_blocked THEN 'suppressed' WHEN NOT v_can_send THEN 'can_send_denied' ELSE 'allowed' END;
END;
$fn$;

-- One row per person for one email or SMS method. The strictest identity wins:
-- a blocked identity blocks the person, otherwise Book contact, then account,
-- then buyer, so the host's own contact is used first.
CREATE OR REPLACE FUNCTION public.issue_4273_decided_people(
  p_actor_id uuid, p_brand_id uuid, p_sources jsonb, p_channel text
) RETURNS TABLE(
  person_key text, subject text, brand_person_id uuid, user_id uuid, ring text,
  buyer_key text, contact_method_id uuid, normalized_contact text, allowed boolean, reason text
)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
  WITH identities AS MATERIALIZED (
    SELECT DISTINCT ON (i.node) i.* FROM public.issue_4273_combined_identities(p_brand_id, p_sources) i
     ORDER BY i.node, i.source_key
  ), decided AS MATERIALIZED (
    SELECT i.person_key, i.node, i.subject, i.brand_person_id, i.user_id, i.ring, i.buyer_key,
      d.contact_method_id, d.normalized_contact,
      COALESCE(d.allowed, false)
        AND public.issue_4273_follow_gate_ok(i.user_id, p_brand_id, p_channel) AS allowed,
      CASE
        WHEN d.normalized_contact IS NULL THEN 'channel_unavailable'
        WHEN NOT public.issue_4273_follow_gate_ok(i.user_id, p_brand_id, p_channel) THEN 'suppressed'
        WHEN d.reason IN ('allowed', 'suppressed', 'can_send_denied', 'channel_unavailable', 'delivery_denied') THEN d.reason
        ELSE 'suppressed'
      END AS reason
    FROM identities i
    LEFT JOIN LATERAL (
      SELECT a.contact_method_id, a.normalized_contact, a.allowed, a.reason
        FROM public.biz_brand_person_authorized_contact_v2(p_brand_id, i.brand_person_id, p_channel, 'marketing_blast') a
       WHERE i.subject = 'book'
      UNION ALL
      SELECT NULL::uuid, c.normalized_contact, c.allowed, c.reason
        FROM public.issue_1778_circle_authorized_contact(p_brand_id, i.user_id, p_channel) c
       WHERE i.subject = 'circle'
      UNION ALL
      SELECT NULL::uuid, b.normalized_contact, b.allowed, b.reason
        FROM public.issue_4273_buyer_contact_decision(p_brand_id, i.buyer_email, i.buyer_phone, p_channel) b
       WHERE i.subject = 'buyer'
    ) d ON true
    WHERE NOT EXISTS (SELECT 1 FROM public.blocked_users bu WHERE i.user_id IS NOT NULL AND
      ((bu.blocker_id = p_actor_id AND bu.blocked_id = i.user_id) OR
       (bu.blocker_id = i.user_id AND bu.blocked_id = p_actor_id)))
  )
  SELECT DISTINCT ON (d.person_key)
    d.person_key, d.subject, d.brand_person_id, d.user_id, d.ring, d.buyer_key,
    CASE WHEN d.normalized_contact IS NULL THEN NULL ELSE d.contact_method_id END,
    d.normalized_contact, d.allowed, d.reason
  FROM decided d
  ORDER BY d.person_key,
    (d.normalized_contact IS NOT NULL AND NOT d.allowed) DESC,
    (d.normalized_contact IS NOT NULL) DESC,
    CASE d.subject WHEN 'book' THEN 0 WHEN 'circle' THEN 1 ELSE 2 END,
    d.node
$fn$;

-- ── Host calls ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.biz_get_or_create_marketing_combined_audience_v1(
  p_actor_id uuid, p_brand_id uuid, p_sources jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp
AS $fn$
DECLARE v_sources jsonb; v_definition jsonb; v_id uuid; v_name text;
BEGIN
  IF auth.uid() IS DISTINCT FROM p_actor_id THEN
    RAISE EXCEPTION 'book_blast_forbidden' USING ERRCODE = '42501';
  END IF;
  v_sources := public.issue_4273_normalize_sources(p_brand_id, p_sources);
  PERFORM public.issue_4273_assert_sources_allowed(p_actor_id, p_brand_id, v_sources);
  v_definition := jsonb_build_object('kind', 'combined_sources', 'brand_id', p_brand_id::text, 'sources', v_sources);
  v_name := public.issue_4273_sources_name(p_brand_id, v_sources);
  SELECT a.id INTO v_id FROM public.marketing_audiences a
   WHERE a.brand_id = p_brand_id AND a.is_system_generated AND a.query_definition = v_definition;
  IF v_id IS NULL THEN
    INSERT INTO public.marketing_audiences(account_id, brand_id, name, query_definition, is_system_generated)
    VALUES (p_actor_id, p_brand_id, v_name, v_definition, true)
    ON CONFLICT DO NOTHING;
    SELECT a.id INTO v_id FROM public.marketing_audiences a
     WHERE a.brand_id = p_brand_id AND a.is_system_generated AND a.query_definition = v_definition;
  ELSE
    -- A saved group or event may have been renamed since this set was first used.
    UPDATE public.marketing_audiences a SET name = v_name
     WHERE a.id = v_id AND a.name IS DISTINCT FROM v_name;
  END IF;
  RETURN jsonb_build_object('audienceId', v_id, 'name', v_name, 'sources', v_sources);
END;
$fn$;

-- The de-duplicated total behind "Done · {n} people", plus the follower truth
-- behind "{n} followers · also in Your Book". Totals only.
CREATE OR REPLACE FUNCTION public.biz_marketing_combined_audience_summary_v1(
  p_actor_id uuid, p_brand_id uuid, p_sources jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp
AS $fn$
DECLARE v_sources jsonb; v_totals jsonb; v_followers integer; v_also integer;
BEGIN
  IF auth.uid() IS DISTINCT FROM p_actor_id
     OR public.biz_brand_effective_rank(p_brand_id, p_actor_id) < public.biz_role_rank('event_manager') THEN
    RAISE EXCEPTION 'book_blast_forbidden' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_sources) = 'array' AND jsonb_array_length(p_sources) = 0 THEN
    v_totals := jsonb_build_object('peopleCount', 0, 'sources', '[]'::jsonb);
  ELSE
    v_sources := public.issue_4273_normalize_sources(p_brand_id, p_sources);
    PERFORM public.issue_4273_assert_sources_allowed(p_actor_id, p_brand_id, v_sources);
    IF EXISTS (SELECT 1 FROM jsonb_array_elements_text(v_sources) k WHERE k IN ('followers', 'extended'))
       AND EXISTS (
         SELECT 1 FROM jsonb_array_elements_text(v_sources) k
         CROSS JOIN LATERAL public.issue_1777_brand_reach_scope_status(
           p_brand_id, CASE k WHEN 'followers' THEN 'follower' ELSE 'extended' END) s
          WHERE k IN ('followers', 'extended') AND s.scope_state IS DISTINCT FROM 'ready') THEN
      RAISE EXCEPTION 'circle_blast_snapshot_stale' USING ERRCODE = 'PT409';
    END IF;
    v_totals := public.issue_4273_source_totals(p_brand_id, v_sources);
  END IF;
  IF public.biz_brand_effective_rank(p_brand_id, p_actor_id) >= public.biz_role_rank('marketing_manager') THEN
    SELECT count(*)::integer,
      count(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM public.brand_people bp
         WHERE bp.brand_id = p_brand_id AND bp.linked_user_id = bf.user_id
           AND bp.record_status = 'active' AND bp.deleted_at IS NULL))::integer
      INTO v_followers, v_also
      FROM public.brand_follows bf
      JOIN public.profiles p ON p.id = bf.user_id
     WHERE bf.brand_id = p_brand_id AND p.active IS TRUE AND p.explorer_deleted_at IS NULL
       AND p.has_completed_onboarding IS TRUE
       AND p.visibility_mode IS NOT NULL AND p.visibility_mode <> 'private'
       AND NOT EXISTS (SELECT 1 FROM public.brand_circle_exits bx
                        WHERE bx.brand_id = p_brand_id AND bx.user_id = bf.user_id
                          AND bx.visibility_exited_at IS NOT NULL);
  END IF;
  RETURN v_totals || jsonb_build_object('followersTotal', v_followers, 'followersAlsoInBook', v_also);
END;
$fn$;

-- ── Quote candidates ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.biz_marketing_combined_quote_candidates_v1(
  p_actor_id uuid, p_campaign_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_campaign public.marketing_campaigns%ROWTYPE; v_audience public.marketing_audiences%ROWTYPE;
  v_sources jsonb; v_rows jsonb; v_selected integer; v_snapshot bigint; v_version bigint; v_key text;
BEGIN
  SELECT * INTO v_campaign FROM public.marketing_campaigns WHERE id = p_campaign_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'book_blast_audience_not_found' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO v_audience FROM public.marketing_audiences
   WHERE id = v_campaign.audience_id AND brand_id = v_campaign.brand_id;
  IF NOT FOUND OR v_audience.deleted_at IS NOT NULL OR NOT v_audience.is_system_generated
     OR v_audience.query_definition ->> 'kind' IS DISTINCT FROM 'combined_sources' THEN
    RAISE EXCEPTION 'book_blast_audience_not_found' USING ERRCODE = 'P0002';
  END IF;
  v_sources := public.issue_4273_normalize_sources(v_campaign.brand_id, v_audience.query_definition -> 'sources');
  IF v_campaign.status <> 'draft' OR v_campaign.channel NOT IN ('email', 'sms') THEN
    RAISE EXCEPTION 'book_blast_forbidden' USING ERRCODE = '42501';
  END IF;
  PERFORM public.issue_4273_assert_sources_allowed(p_actor_id, v_campaign.brand_id, v_sources);
  FOR v_key IN SELECT k FROM jsonb_array_elements_text(v_sources) k WHERE k IN ('followers', 'extended') LOOP
    IF NOT public.issue_1778_ring_channel_enabled(
         CASE v_key WHEN 'followers' THEN 'brand_followers' ELSE 'brand_circle_extended' END, v_campaign.channel) THEN
      RAISE EXCEPTION 'book_blast_flag_disabled' USING ERRCODE = '55000';
    END IF;
    IF (SELECT s.scope_state FROM public.issue_1777_brand_reach_scope_status(
          v_campaign.brand_id, CASE v_key WHEN 'followers' THEN 'follower' ELSE 'extended' END) s)
       IS DISTINCT FROM 'ready' THEN
      RAISE EXCEPTION 'circle_blast_snapshot_stale' USING ERRCODE = 'PT409';
    END IF;
  END LOOP;
  SELECT snapshot_version INTO v_snapshot FROM public.brand_reach_refresh_state WHERE brand_id = v_campaign.brand_id;
  IF v_snapshot IS NULL AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(v_sources) k WHERE k IN ('followers', 'extended')) THEN
    RAISE EXCEPTION 'circle_blast_snapshot_stale' USING ERRCODE = 'PT409';
  END IF;
  SELECT COALESCE(v_snapshot, 0) + COALESCE(sum(a.membership_version), 0) INTO v_version
    FROM public.marketing_audiences a
   WHERE ('group:' || a.id::text) IN (SELECT k FROM jsonb_array_elements_text(v_sources) k);

  SELECT count(*)::integer,
    COALESCE(jsonb_agg(jsonb_build_object(
      'personKey', d.person_key,
      'brandPersonId', COALESCE(d.brand_person_id::text, d.person_key),
      'targetBrandPersonId', d.brand_person_id,
      'recipientUserId', CASE WHEN d.subject = 'circle' THEN d.user_id END,
      'ring', d.ring,
      'snapshotVersion', CASE WHEN d.subject = 'circle' THEN v_snapshot END,
      'buyerContactKey', d.buyer_key,
      'contactMethodId', d.contact_method_id,
      'normalizedContact', d.normalized_contact,
      'allowed', d.allowed,
      'safeReasonCode', d.reason
    ) ORDER BY d.person_key), '[]'::jsonb)
    INTO v_selected, v_rows
    FROM public.issue_4273_decided_people(p_actor_id, v_campaign.brand_id, v_sources, v_campaign.channel) d;

  RETURN jsonb_build_object(
    'brandId', v_campaign.brand_id, 'channel', v_campaign.channel, 'selectedCount', v_selected,
    'content', v_campaign.channel_payload, 'candidates', v_rows,
    'audienceId', v_audience.id, 'audienceKind', 'combined_sources',
    'audienceVersion', v_version, 'audienceName', v_audience.name,
    'audienceSources', public.issue_4273_source_totals(v_campaign.brand_id, v_sources) -> 'sources'
  );
END;
$fn$;

-- ── Confirm: seals exactly the set the quote priced ─────────────────────────
CREATE OR REPLACE FUNCTION public.biz_confirm_marketing_combined_send_v1(
  p_actor_id uuid, p_campaign_id uuid, p_client_request_id uuid,
  p_quote_snapshot jsonb, p_scheduled_for timestamptz
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp
AS $fn$
DECLARE
  v_campaign public.marketing_campaigns%ROWTYPE;
  v_existing public.marketing_book_send_executions%ROWTYPE;
  v_execution uuid; v_live jsonb; v_row jsonb; v_now timestamptz := now();
  v_stored_reason text;
BEGIN
  IF jsonb_typeof(p_quote_snapshot) <> 'object'
     OR (p_quote_snapshot ->> 'quoteVersion') IS DISTINCT FROM '1'
     OR COALESCE(p_quote_snapshot ->> 'quoteHash', '') !~ '^[0-9a-f]{64}$'
     OR COALESCE(p_quote_snapshot ->> 'contentHash', '') !~ '^[0-9a-f]{64}$'
     OR jsonb_typeof(p_quote_snapshot -> 'content') <> 'object'
     OR jsonb_typeof(p_quote_snapshot -> 'candidates') <> 'array'
     OR (p_quote_snapshot ->> 'quotedAt')::timestamptz < v_now - interval '5 minutes' THEN
    RAISE EXCEPTION 'book_blast_preview_stale' USING ERRCODE = 'PT409';
  END IF;

  SELECT * INTO v_existing FROM public.marketing_book_send_executions
   WHERE campaign_id = p_campaign_id
      OR (brand_id = (p_quote_snapshot ->> 'brandId')::uuid AND client_request_id = p_client_request_id)
   ORDER BY (campaign_id = p_campaign_id) DESC LIMIT 1;
  IF FOUND THEN
    IF v_existing.actor_id = p_actor_id AND v_existing.campaign_id = p_campaign_id
       AND v_existing.client_request_id = p_client_request_id
       AND v_existing.quote_hash = p_quote_snapshot ->> 'quoteHash' THEN
      RETURN jsonb_build_object('executionId', v_existing.id, 'campaignId', p_campaign_id,
        'scheduledFor', v_existing.scheduled_for, 'replay', true);
    END IF;
    RAISE EXCEPTION 'book_blast_idempotency_conflict' USING ERRCODE = 'PT409';
  END IF;

  v_live := public.biz_marketing_combined_quote_candidates_v1(p_actor_id, p_campaign_id);
  SELECT * INTO v_campaign FROM public.marketing_campaigns WHERE id = p_campaign_id FOR UPDATE;
  IF v_campaign.channel_payload IS DISTINCT FROM p_quote_snapshot -> 'content'
     OR v_live ->> 'audienceId' IS DISTINCT FROM p_quote_snapshot ->> 'audienceId'
     OR p_quote_snapshot ->> 'audienceKind' IS DISTINCT FROM 'combined_sources'
     OR (v_live ->> 'audienceVersion')::bigint IS DISTINCT FROM (p_quote_snapshot ->> 'audienceVersion')::bigint
     OR (v_live ->> 'selectedCount')::integer IS DISTINCT FROM (p_quote_snapshot ->> 'selectedCount')::integer
     OR (
       SELECT jsonb_agg(jsonb_build_object(
         'personKey', x ->> 'personKey', 'targetBrandPersonId', x ->> 'targetBrandPersonId',
         'recipientUserId', x ->> 'recipientUserId', 'ring', x ->> 'ring',
         'buyerContactKey', x ->> 'buyerContactKey', 'contactMethodId', x ->> 'contactMethodId',
         'normalizedContact', x ->> 'normalizedContact', 'allowed', x ->> 'allowed',
         'safeReasonCode', x ->> 'safeReasonCode') ORDER BY x ->> 'personKey')
       FROM jsonb_array_elements(v_live -> 'candidates') x
     ) IS DISTINCT FROM (
       SELECT jsonb_agg(jsonb_build_object(
         'personKey', x ->> 'personKey', 'targetBrandPersonId', x ->> 'targetBrandPersonId',
         'recipientUserId', x ->> 'recipientUserId', 'ring', x ->> 'ring',
         'buyerContactKey', x ->> 'buyerContactKey', 'contactMethodId', x ->> 'contactMethodId',
         'normalizedContact', x ->> 'normalizedContact', 'allowed', x ->> 'allowed',
         'safeReasonCode', x ->> 'safeReasonCode') ORDER BY x ->> 'personKey')
       FROM jsonb_array_elements(p_quote_snapshot -> 'candidates') x
     ) THEN
    RAISE EXCEPTION 'book_blast_preview_stale' USING ERRCODE = 'PT409';
  END IF;
  IF COALESCE((p_quote_snapshot ->> 'reachableCount')::integer, 0) = 0 THEN
    RAISE EXCEPTION 'book_blast_zero_recipients' USING ERRCODE = 'PT409';
  END IF;

  PERFORM public.biz_assert_brand_blast_allowance_v1(
    v_campaign.brand_id, v_campaign.channel, (p_quote_snapshot ->> 'reachableCount')::integer);

  INSERT INTO public.marketing_book_send_executions(
    brand_id, campaign_id, actor_id, client_request_id, quote_version, quote_hash, content_hash,
    selected_count, reachable_count, suppressed_count, unavailable_count, sms_segment_count,
    estimated_cost_minor, currency, cost_kind, ratebook_ids, source_references, quoted_at,
    scheduled_for, send_mode
  ) VALUES (
    v_campaign.brand_id, p_campaign_id, p_actor_id, p_client_request_id, 1,
    p_quote_snapshot ->> 'quoteHash', p_quote_snapshot ->> 'contentHash',
    (p_quote_snapshot ->> 'selectedCount')::integer,
    (p_quote_snapshot ->> 'reachableCount')::integer,
    (p_quote_snapshot ->> 'suppressedCount')::integer,
    (p_quote_snapshot ->> 'unavailableCount')::integer,
    (p_quote_snapshot ->> 'smsSegments')::integer,
    NULLIF(p_quote_snapshot ->> 'estimatedCostMinor', '')::bigint,
    NULLIF(p_quote_snapshot ->> 'currency', ''),
    p_quote_snapshot ->> 'costKind',
    COALESCE(p_quote_snapshot -> 'rateIds', '[]'),
    COALESCE(p_quote_snapshot -> 'sourceReferences', '[]'),
    (p_quote_snapshot ->> 'quotedAt')::timestamptz,
    COALESCE(p_scheduled_for, v_now),
    CASE WHEN p_scheduled_for IS NULL THEN 'now' ELSE 'scheduled' END
  ) RETURNING id INTO v_execution;

  FOR v_row IN SELECT * FROM jsonb_array_elements(p_quote_snapshot -> 'candidates') LOOP
    v_stored_reason := COALESCE(v_row ->> 'safeReasonCode', 'allowed');
    INSERT INTO public.marketing_book_send_targets(
      execution_id, brand_person_id, recipient_user_id, ring, circle_snapshot_version, buyer_contact_key,
      contact_method_id, contact_value_digest, channel, outcome, reason, segment_count, allocated_cost_minor
    ) VALUES (
      v_execution,
      NULLIF(v_row ->> 'targetBrandPersonId', '')::uuid,
      NULLIF(v_row ->> 'recipientUserId', '')::uuid,
      v_row ->> 'ring',
      NULLIF(v_row ->> 'snapshotVersion', '')::bigint,
      v_row ->> 'buyerContactKey',
      NULLIF(v_row ->> 'contactMethodId', '')::uuid,
      CASE WHEN v_row ->> 'normalizedContact' IS NULL THEN NULL
        ELSE encode(extensions.digest(convert_to(v_row ->> 'normalizedContact', 'UTF8'), 'sha256'), 'hex') END,
      v_campaign.channel,
      CASE
        WHEN v_row ->> 'normalizedContact' IS NULL THEN 'unavailable'
        WHEN (v_row ->> 'allowed')::boolean THEN 'queued'
        ELSE 'suppressed'
      END,
      v_stored_reason,
      COALESCE((v_row ->> 'segments')::integer, 0),
      NULLIF(v_row ->> 'allocatedCostMinor', '')::bigint
    );
  END LOOP;

  UPDATE public.marketing_campaigns
     SET status = 'scheduled',
         scheduled_for = COALESCE(p_scheduled_for, v_now),
         audience_name_snapshot = v_live ->> 'audienceName',
         updated_at = v_now
   WHERE id = p_campaign_id AND status = 'draft';

  RETURN jsonb_build_object('executionId', v_execution, 'campaignId', p_campaign_id,
    'scheduledFor', COALESCE(p_scheduled_for, v_now), 'replay', false);
END;
$fn$;

-- ── Send: re-decides each sealed person ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.biz_marketing_combined_send_audience_v1(p_campaign_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp
AS $fn$
DECLARE v_campaign public.marketing_campaigns%ROWTYPE; v_actor uuid; v_rows jsonb;
BEGIN
  SELECT * INTO v_campaign FROM public.marketing_campaigns WHERE id = p_campaign_id;
  SELECT e.actor_id INTO v_actor FROM public.marketing_book_send_executions e WHERE e.campaign_id = p_campaign_id;
  IF v_campaign.id IS NULL OR v_actor IS NULL THEN
    RAISE EXCEPTION 'book_blast_unconfirmed' USING ERRCODE = '42501';
  END IF;

  WITH sealed AS MATERIALIZED (
    SELECT t.* FROM public.marketing_book_send_targets t
      JOIN public.marketing_book_send_executions e ON e.id = t.execution_id
     WHERE e.campaign_id = p_campaign_id AND t.outcome = 'queued'
  ), buyers AS MATERIALIZED (
    SELECT DISTINCT ON (lower(btrim(o.buyer_email)))
      encode(extensions.digest(convert_to(lower(btrim(o.buyer_email)), 'UTF8'), 'sha256'), 'hex') AS buyer_key,
      lower(btrim(o.buyer_email)) AS email, o.buyer_phone_e164 AS phone, o.buyer_name, o.buyer_user_id,
      o.event_id, e.title AS event_title
      FROM public.orders o JOIN public.events e ON e.id = o.event_id
     WHERE e.brand_id = v_campaign.brand_id AND o.payment_status IN ('paid', 'partial_refund')
       AND btrim(COALESCE(o.buyer_email, '')) <> ''
       AND EXISTS (SELECT 1 FROM sealed s WHERE s.buyer_contact_key IS NOT NULL)
     ORDER BY lower(btrim(o.buyer_email)), o.created_at DESC
  ), people AS (
    SELECT t.brand_person_id::text AS contact_key, p.display_name AS name, a.normalized_contact,
      NULL::uuid AS event_id, NULL::text AS event_title, 'added'::text AS receive_reason
      FROM sealed t
      JOIN public.brand_people p ON p.id = t.brand_person_id
      JOIN LATERAL public.biz_brand_person_authorized_contact_v2(
        v_campaign.brand_id, t.brand_person_id, t.channel, 'marketing_blast'
      ) a ON a.contact_method_id = t.contact_method_id AND a.allowed
     WHERE t.brand_person_id IS NOT NULL
       AND t.contact_value_digest = encode(extensions.digest(convert_to(a.normalized_contact, 'UTF8'), 'sha256'), 'hex')
       AND public.issue_4273_follow_gate_ok(p.linked_user_id, v_campaign.brand_id, t.channel)
       AND NOT EXISTS (SELECT 1 FROM public.blocked_users b WHERE p.linked_user_id IS NOT NULL AND
         ((b.blocker_id = v_actor AND b.blocked_id = p.linked_user_id) OR
          (b.blocker_id = p.linked_user_id AND b.blocked_id = v_actor)))
    UNION ALL
    SELECT t.recipient_user_id::text, COALESCE(NULLIF(btrim(pr.display_name), ''), NULLIF(btrim(pr.first_name), ''), 'Mingla member'),
      a.normalized_contact, NULL, NULL,
      CASE t.ring WHEN 'follower' THEN 'follows' ELSE 'friend_of_follower' END
      FROM sealed t
      JOIN public.profiles pr ON pr.id = t.recipient_user_id AND pr.active IS TRUE AND pr.explorer_deleted_at IS NULL
      JOIN LATERAL public.issue_1778_circle_authorized_contact(
        v_campaign.brand_id, t.recipient_user_id, t.channel
      ) a ON a.allowed
     WHERE t.recipient_user_id IS NOT NULL
       AND t.contact_value_digest = encode(extensions.digest(convert_to(a.normalized_contact, 'UTF8'), 'sha256'), 'hex')
       AND public.issue_1995_flags_enabled()
       AND public.issue_1778_ring_channel_enabled(
         CASE t.ring WHEN 'follower' THEN 'brand_followers' ELSE 'brand_circle_extended' END, t.channel)
       AND (
         (t.ring = 'follower' AND EXISTS (SELECT 1 FROM public.brand_follows bf
            WHERE bf.brand_id = v_campaign.brand_id AND bf.user_id = t.recipient_user_id))
         OR (t.ring = 'extended' AND private.issue_3682_extended_reach_live() AND EXISTS (
           SELECT 1 FROM public.issue_1777_resolve_brand_circle_members(
             v_campaign.brand_id, 'extended', ARRAY[t.recipient_user_id]) r
            WHERE r.user_id = t.recipient_user_id))
       )
       AND public.issue_4273_follow_gate_ok(t.recipient_user_id, v_campaign.brand_id, t.channel)
       AND NOT EXISTS (SELECT 1 FROM public.blocked_users b WHERE
         (b.blocker_id = v_actor AND b.blocked_id = t.recipient_user_id) OR
         (b.blocker_id = t.recipient_user_id AND b.blocked_id = v_actor))
    UNION ALL
    SELECT t.buyer_contact_key, b.buyer_name, d.normalized_contact, b.event_id, b.event_title, 'bought'
      FROM sealed t
      JOIN buyers b ON b.buyer_key = t.buyer_contact_key
      JOIN LATERAL public.issue_4273_buyer_contact_decision(
        v_campaign.brand_id, b.email, b.phone, t.channel
      ) d ON d.allowed
     WHERE t.contact_value_digest = encode(extensions.digest(convert_to(d.normalized_contact, 'UTF8'), 'sha256'), 'hex')
       AND public.issue_4273_follow_gate_ok(b.buyer_user_id, v_campaign.brand_id, t.channel)
       AND NOT EXISTS (SELECT 1 FROM public.blocked_users bu WHERE b.buyer_user_id IS NOT NULL AND
         ((bu.blocker_id = v_actor AND bu.blocked_id = b.buyer_user_id) OR
          (bu.blocker_id = b.buyer_user_id AND bu.blocked_id = v_actor)))
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'contact_key', x.contact_key,
    'display_name', COALESCE(NULLIF(btrim(x.name), ''), 'there'),
    'first_name', COALESCE(NULLIF(split_part(btrim(COALESCE(x.name, '')), ' ', 1), ''), 'there'),
    'raw_email', CASE WHEN v_campaign.channel = 'email' THEN x.normalized_contact END,
    'raw_phone', CASE WHEN v_campaign.channel = 'sms' THEN x.normalized_contact END,
    'order_count', 0, 'total_spend_minor', 0, 'total_spend_currency', 'USD',
    'last_event_id', x.event_id, 'last_event_name', x.event_title, 'last_purchase_at', NULL,
    'email_marketing_ok', v_campaign.channel = 'email',
    'sms_marketing_ok', v_campaign.channel = 'sms',
    'receive_reason', x.receive_reason
  ) ORDER BY x.contact_key), '[]'::jsonb) INTO v_rows
  FROM people x;

  RETURN jsonb_build_object('rows', v_rows, 'brand_id', v_campaign.brand_id, 'reach', jsonb_build_object(
    'total', jsonb_array_length(v_rows),
    'reachable_email', CASE WHEN v_campaign.channel = 'email' THEN jsonb_array_length(v_rows) ELSE 0 END,
    'reachable_sms', CASE WHEN v_campaign.channel = 'sms' THEN jsonb_array_length(v_rows) ELSE 0 END));
END;
$fn$;

-- ── Push: the 20280401043682 body + a combined branch ───────────────────────
CREATE OR REPLACE FUNCTION public.biz_marketing_push_quote_candidates_v1(
  p_actor_id uuid, p_campaign_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_campaign public.marketing_campaigns%ROWTYPE; v_audience public.marketing_audiences%ROWTYPE;
  v_kind text; v_rows jsonb; v_selected integer; v_version bigint; v_sources jsonb;
BEGIN
  SELECT * INTO v_campaign FROM public.marketing_campaigns WHERE id = p_campaign_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'book_blast_audience_not_found' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO v_audience FROM public.marketing_audiences
   WHERE id = v_campaign.audience_id AND brand_id = v_campaign.brand_id;
  IF NOT FOUND OR v_audience.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'book_blast_audience_not_found' USING ERRCODE = 'P0002';
  END IF;
  v_kind := v_audience.query_definition ->> 'kind';
  IF v_kind = 'combined_sources' THEN
    IF NOT v_audience.is_system_generated THEN
      RAISE EXCEPTION 'book_blast_audience_not_found' USING ERRCODE = 'P0002';
    END IF;
    v_sources := public.issue_4273_normalize_sources(v_campaign.brand_id, v_audience.query_definition -> 'sources');
    -- Unchanged rule: buyer lists hold contacts with no Mingla account guarantee,
    -- so a set that includes one is refused for push, never pushed to a subset.
    IF EXISTS (SELECT 1 FROM jsonb_array_elements_text(v_sources) k
                WHERE k = 'brand_buyers' OR k LIKE 'event:%') THEN
      RAISE EXCEPTION 'book_blast_audience_not_found' USING ERRCODE = 'P0002';
    END IF;
    IF v_campaign.status <> 'draft' OR v_campaign.channel <> 'push' THEN
      RAISE EXCEPTION 'book_blast_forbidden' USING ERRCODE = '42501';
    END IF;
    PERFORM public.issue_4273_assert_sources_allowed(p_actor_id, v_campaign.brand_id, v_sources);
    IF (EXISTS (SELECT 1 FROM jsonb_array_elements_text(v_sources) k WHERE k = 'followers')
        AND NOT COALESCE((SELECT count(*) = 1 AND bool_and(f.is_enabled)
          FROM public.feature_flags f WHERE f.flag_key = 'brand_circle_followers_v1'), false))
       OR (EXISTS (SELECT 1 FROM jsonb_array_elements_text(v_sources) k WHERE k = 'extended')
        AND NOT private.issue_3682_extended_reach_live()) THEN
      RAISE EXCEPTION 'book_blast_flag_disabled' USING ERRCODE = '55000';
    END IF;
    WITH members AS (
      SELECT i.person_key, i.user_id,
        CASE WHEN i.subject = 'book' THEN 'book' ELSE i.ring END AS reason
        FROM public.issue_4273_combined_identities(v_campaign.brand_id, v_sources) i
       WHERE i.user_id IS NOT NULL
    ), deduped AS (
      -- Follower first: unfollowing stops this push even for someone in the Book.
      SELECT DISTINCT ON (m.user_id) m.person_key, m.user_id, m.reason FROM members m
       WHERE NOT EXISTS (SELECT 1 FROM public.blocked_users b WHERE
         (b.blocker_id = p_actor_id AND b.blocked_id = m.user_id) OR
         (b.blocker_id = m.user_id AND b.blocked_id = p_actor_id))
       ORDER BY m.user_id, CASE m.reason WHEN 'follower' THEN 0 WHEN 'book' THEN 1 ELSE 2 END
    ), decided AS (
      SELECT d.person_key, d.user_id, d.reason,
        public.issue_3682_campaign_push_reason(v_campaign.brand_id, d.user_id, d.reason) AS code
      FROM deduped d
    )
    SELECT count(*)::integer,
      COALESCE(jsonb_agg(jsonb_build_object(
        'recipientUserId', user_id, 'reason', reason, 'personKey', person_key,
        'allowed', code = 'allowed', 'safeReasonCode', code) ORDER BY user_id), '[]'::jsonb)
      INTO v_selected, v_rows
    FROM decided;
    RETURN jsonb_build_object(
      'brandId', v_campaign.brand_id, 'channel', 'push', 'selectedCount', v_selected,
      'content', v_campaign.channel_payload, 'candidates', v_rows,
      'audienceId', v_audience.id, 'audienceKind', v_kind,
      'audienceVersion', 0, 'audienceName', v_audience.name,
      'campaignGroupId', COALESCE(v_campaign.campaign_group_id, v_campaign.id),
      'audienceSources', public.issue_4273_source_totals(v_campaign.brand_id, v_sources) -> 'sources'
    );
  END IF;
  IF v_audience.query_definition = '{"kind":"manual_group"}'::jsonb THEN
    v_kind := 'manual_group';
  ELSIF v_kind IN ('all_brand_people', 'brand_followers', 'brand_circle_extended') THEN
    IF NOT v_audience.is_system_generated
       OR v_audience.query_definition IS DISTINCT FROM
          jsonb_build_object('kind', v_kind, 'brand_id', v_campaign.brand_id::text) THEN
      RAISE EXCEPTION 'book_blast_audience_not_found' USING ERRCODE = 'P0002';
    END IF;
  ELSE
    -- Contact-list audiences (automatic buyer lists) have no Mingla account
    -- guarantee: push is offered only for people Mingla can reach by account.
    RAISE EXCEPTION 'book_blast_audience_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_campaign.status <> 'draft' OR v_campaign.channel <> 'push'
     OR public.biz_brand_effective_rank(v_campaign.brand_id, p_actor_id) <
        public.biz_role_rank(CASE WHEN v_kind = 'all_brand_people' THEN 'event_manager' ELSE 'marketing_manager' END) THEN
    RAISE EXCEPTION 'book_blast_forbidden' USING ERRCODE = '42501';
  END IF;
  IF (v_kind IN ('all_brand_people', 'manual_group') AND NOT public.issue_1995_flags_enabled())
     OR (v_kind = 'brand_followers' AND NOT COALESCE((SELECT count(*) = 1 AND bool_and(f.is_enabled)
           FROM public.feature_flags f WHERE f.flag_key = 'brand_circle_followers_v1'), false))
     OR (v_kind = 'brand_circle_extended' AND NOT COALESCE((SELECT count(*) = 3 AND bool_and(f.is_enabled)
           FROM public.feature_flags f WHERE f.flag_key IN ('brand_circle_extended_v1',
             'brand_circle_extended_controls_ios_v1', 'brand_circle_extended_controls_android_v1')), false)) THEN
    RAISE EXCEPTION 'book_blast_flag_disabled' USING ERRCODE = '55000';
  END IF;
  v_version := CASE WHEN v_kind = 'manual_group' THEN v_audience.membership_version ELSE 0 END;

  WITH members AS (
    SELECT bf.user_id, 'follower'::text AS reason
      FROM public.brand_follows bf
      JOIN public.profiles p ON p.id = bf.user_id AND p.active IS TRUE AND p.explorer_deleted_at IS NULL
     WHERE v_kind = 'brand_followers' AND bf.brand_id = v_campaign.brand_id
    UNION
    SELECT r.user_id, 'extended'
      FROM public.issue_1777_resolve_brand_circle_members(v_campaign.brand_id, 'extended', NULL) r
     WHERE v_kind = 'brand_circle_extended'
    UNION
    SELECT bp.linked_user_id, 'book'
      FROM public.brand_people bp
     WHERE v_kind IN ('all_brand_people', 'manual_group')
       AND bp.brand_id = v_campaign.brand_id AND bp.record_status = 'active'
       AND bp.linked_user_id IS NOT NULL
       AND (v_kind = 'all_brand_people' OR EXISTS (
         SELECT 1 FROM public.marketing_manual_group_memberships m
          WHERE m.audience_id = v_audience.id AND m.brand_person_id = bp.id AND m.state = 'active'))
  ), deduped AS (
    SELECT DISTINCT ON (m.user_id) m.user_id, m.reason FROM members m
     WHERE NOT EXISTS (SELECT 1 FROM public.blocked_users b WHERE
       (b.blocker_id = p_actor_id AND b.blocked_id = m.user_id) OR
       (b.blocker_id = m.user_id AND b.blocked_id = p_actor_id))
     ORDER BY m.user_id, m.reason
  ), decided AS (
    SELECT d.user_id, d.reason,
      public.issue_3682_campaign_push_reason(v_campaign.brand_id, d.user_id, d.reason) AS code
    FROM deduped d
  )
  SELECT count(*)::integer,
    COALESCE(jsonb_agg(jsonb_build_object(
      'recipientUserId', user_id, 'reason', reason,
      'allowed', code = 'allowed', 'safeReasonCode', code) ORDER BY user_id), '[]'::jsonb)
    INTO v_selected, v_rows
  FROM decided;

  RETURN jsonb_build_object(
    'brandId', v_campaign.brand_id, 'channel', 'push', 'selectedCount', v_selected,
    'content', v_campaign.channel_payload, 'candidates', v_rows,
    'audienceId', v_audience.id, 'audienceKind', v_kind,
    'audienceVersion', v_version, 'audienceName', v_audience.name,
    'campaignGroupId', COALESCE(v_campaign.campaign_group_id, v_campaign.id)
  );
END;
$fn$;

-- Push worklist: the 20280401043682 body + the optional title (the email subject).
CREATE OR REPLACE FUNCTION public.biz_marketing_push_send_worklist_v1(p_campaign_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_campaign public.marketing_campaigns%ROWTYPE; v_work jsonb; v_event jsonb;
BEGIN
  SELECT * INTO v_campaign FROM public.marketing_campaigns WHERE id = p_campaign_id;
  IF NOT FOUND OR v_campaign.channel <> 'push' THEN
    RAISE EXCEPTION 'book_blast_audience_not_found' USING ERRCODE = 'P0002';
  END IF;
  UPDATE public.marketing_push_messages m SET
    status = 'skipped', failure_reason = d.code, updated_at = now()
  FROM (
    SELECT q.id, public.issue_3682_campaign_push_reason(v_campaign.brand_id, q.user_id, q.reason) AS code
      FROM public.marketing_push_messages q
     WHERE q.campaign_id = p_campaign_id AND q.status = 'queued'
  ) d
  WHERE m.id = d.id AND d.code <> 'allowed';
  SELECT jsonb_build_object('eventSlug', e.slug) INTO v_event
    FROM public.events e
   WHERE e.id = NULLIF(v_campaign.channel_payload ->> 'event_id', '')::uuid
     AND e.brand_id = v_campaign.brand_id AND e.deleted_at IS NULL;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('messageId', m.id, 'userId', m.user_id,
           'reason', m.reason) ORDER BY m.user_id), '[]'::jsonb)
    INTO v_work
    FROM public.marketing_push_messages m
   WHERE m.campaign_id = p_campaign_id AND m.status = 'queued';
  RETURN jsonb_build_object(
    'brandName', (SELECT b.name FROM public.brands b WHERE b.id = v_campaign.brand_id),
    'brandSlug', (SELECT b.slug FROM public.brands b WHERE b.id = v_campaign.brand_id),
    'eventSlug', v_event ->> 'eventSlug',
    'body', v_campaign.channel_payload ->> 'body',
    'title', v_campaign.channel_payload ->> 'title',
    'work', v_work);
END;
$fn$;

-- ── Claim: a combined campaign is claimable only with a sealed execution ────
-- The 20270627001778 body + the new kind.
CREATE OR REPLACE FUNCTION public.mkt_claim_campaigns(p_limit integer DEFAULT 10,p_campaign_id uuid DEFAULT NULL)
RETURNS TABLE(id uuid,account_id uuid,brand_id uuid,audience_id uuid,channel text,channel_payload jsonb,name text,scheduled_for timestamptz)
LANGUAGE plpgsql SET search_path=public,pg_temp AS $function$
BEGIN
  RETURN QUERY UPDATE public.marketing_campaigns mc SET status='sending',updated_at=now() WHERE mc.id IN(
    SELECT c.id FROM public.marketing_campaigns c JOIN public.marketing_audiences a ON a.id=c.audience_id
    WHERE c.status='scheduled' AND c.scheduled_for<=now() AND (p_campaign_id IS NULL OR c.id=p_campaign_id)
      AND (a.query_definition->>'kind' NOT IN('all_brand_people','manual_group','brand_followers','brand_circle_extended','combined_sources')
        OR EXISTS(SELECT 1 FROM public.marketing_book_send_executions e WHERE e.campaign_id=c.id))
    ORDER BY c.scheduled_for LIMIT p_limit FOR UPDATE OF c SKIP LOCKED)
  RETURNING mc.id,mc.account_id,mc.brand_id,mc.audience_id,mc.channel,mc.channel_payload,mc.name,mc.scheduled_for;
END;
$function$;

-- An older installed app that reopens a combined draft knows only the plain
-- schedule path; it would leave the campaign stuck, so it is refused out loud.
CREATE OR REPLACE FUNCTION public.issue_4273_combined_requires_execution()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF EXISTS (SELECT 1 FROM public.marketing_audiences a
              WHERE a.id = NEW.audience_id AND a.query_definition ->> 'kind' = 'combined_sources')
     AND NOT EXISTS (SELECT 1 FROM public.marketing_book_send_executions e WHERE e.campaign_id = NEW.id) THEN
    RAISE EXCEPTION 'book_blast_preview_stale' USING ERRCODE = 'PT409';
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.issue_4273_combined_requires_execution() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER issue_4273_combined_requires_execution
BEFORE UPDATE OF status ON public.marketing_campaigns
FOR EACH ROW WHEN (NEW.status = 'scheduled' AND OLD.status = 'draft')
EXECUTE FUNCTION public.issue_4273_combined_requires_execution();

-- ── Grants ──────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.issue_4273_normalize_sources(uuid, jsonb),
  public.issue_4273_source_name(uuid, text),
  public.issue_4273_sources_name(uuid, jsonb),
  public.issue_4273_combined_identities(uuid, jsonb),
  public.issue_4273_source_totals(uuid, jsonb),
  public.issue_4273_assert_sources_allowed(uuid, uuid, jsonb),
  public.issue_4273_follow_gate_ok(uuid, uuid, text),
  public.issue_4273_buyer_contact_decision(uuid, text, text, text),
  public.issue_4273_decided_people(uuid, uuid, jsonb, text),
  public.biz_marketing_combined_quote_candidates_v1(uuid, uuid),
  public.biz_confirm_marketing_combined_send_v1(uuid, uuid, uuid, jsonb, timestamptz),
  public.biz_marketing_combined_send_audience_v1(uuid),
  public.biz_marketing_push_quote_candidates_v1(uuid, uuid),
  public.biz_marketing_push_send_worklist_v1(uuid),
  public.mkt_claim_campaigns(integer, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.biz_marketing_combined_quote_candidates_v1(uuid, uuid),
  public.biz_confirm_marketing_combined_send_v1(uuid, uuid, uuid, jsonb, timestamptz),
  public.biz_marketing_combined_send_audience_v1(uuid),
  public.biz_marketing_push_quote_candidates_v1(uuid, uuid),
  public.biz_marketing_push_send_worklist_v1(uuid),
  public.mkt_claim_campaigns(integer, uuid)
  TO service_role;
REVOKE ALL ON FUNCTION public.biz_get_or_create_marketing_combined_audience_v1(uuid, uuid, jsonb),
  public.biz_marketing_combined_audience_summary_v1(uuid, uuid, jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.biz_get_or_create_marketing_combined_audience_v1(uuid, uuid, jsonb),
  public.biz_marketing_combined_audience_summary_v1(uuid, uuid, jsonb)
  TO authenticated;

ALTER FUNCTION public.biz_marketing_combined_quote_candidates_v1(uuid, uuid) OWNER TO postgres;
ALTER FUNCTION public.biz_confirm_marketing_combined_send_v1(uuid, uuid, uuid, jsonb, timestamptz) OWNER TO postgres;
ALTER FUNCTION public.biz_marketing_combined_send_audience_v1(uuid) OWNER TO postgres;

COMMIT;
