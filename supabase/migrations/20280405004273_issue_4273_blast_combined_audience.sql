-- #4273 wave B — a Blast picks several audiences and several methods.
--
-- One new audience shape, one new sealed lane. Nothing old changes:
--
--   combined_sources  A system audience whose query_definition names a sorted
--                     list of source keys: book, followers, extended,
--                     group:<uuid>, brand_buyers, event:<uuid>. One row per
--                     distinct source set per brand.
--   identities        Every source row becomes a node. Nodes that share a Mingla
--                     account are one person. A contact the brand itself holds
--                     (Book or order) also joins nodes, except two Book rows,
--                     which stay two people. A person known only through
--                     followers or friends of followers joins by account alone:
--                     everything the host can see is computed without their
--                     contact details.
--   candidates        One row per recipient per method, carrying the quote's
--                     delivery identity. Service-only; the host sees totals.
--   decision          The strictest wins: anything blocking any identity of a
--                     person stops that method for them.
--   confirm / send    biz_confirm_marketing_combined_send_v1 seals the set the
--                     quote priced. biz_marketing_combined_send_audience_v1
--                     re-decides at send, across every identity of each person
--                     including contact matches the quote never looks at, and
--                     sends once per address. The reachable count can therefore
--                     sit slightly above what is sent, never below; anything
--                     sealed and not sent is a recorded skip.
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
    ELSIF v_key ~ '^group:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      v_id := substr(v_key, 7)::uuid;
      IF NOT EXISTS (SELECT 1 FROM public.marketing_audiences a
                      WHERE a.id = v_id AND a.brand_id = p_brand_id AND a.deleted_at IS NULL
                        AND NOT a.is_system_generated
                        AND a.query_definition = '{"kind":"manual_group"}'::jsonb) THEN
        RAISE EXCEPTION 'book_blast_audience_not_found' USING ERRCODE = 'P0002';
      END IF;
      v_keys := v_keys || v_key;
    ELSIF v_key ~ '^event:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
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
DECLARE v_rank integer := public.biz_brand_effective_rank(p_brand_id, p_actor_id);
BEGIN
  -- Each source must be allowed for this role on its own. Adding a source never
  -- widens what the role can reach.
  IF v_rank IS NULL OR EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(p_sources) k
     WHERE v_rank < public.biz_role_rank(
       CASE WHEN k IN ('followers', 'extended') OR k LIKE 'group:%'
            THEN 'marketing_manager' ELSE 'event_manager' END)
  ) THEN
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

-- Every opt-out ledger for one address on one method.
CREATE OR REPLACE FUNCTION public.issue_4273_address_denied(
  p_brand_id uuid, p_channel text, p_address text, p_user_id uuid
) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM public.marketing_unsubscribes u
       WHERE u.channel IN (p_channel, 'all')
         AND ((p_channel = 'email' AND lower(u.contact_email) = lower(p_address))
              OR (p_channel = 'sms' AND u.contact_phone = p_address))
         AND (u.scope = 'global' OR (u.scope = 'brand' AND u.brand_id = p_brand_id)
              OR (u.scope = 'account' AND p_user_id IS NOT NULL AND u.account_id = p_user_id))
      UNION ALL
      SELECT 1 FROM public.channel_suppressions s
       WHERE s.channel = p_channel AND s.scope IN ('marketing', 'all')
         AND (lower(s.contact) = lower(p_address) OR (p_user_id IS NOT NULL AND s.user_id = p_user_id))
    ) THEN 'suppressed'
    WHEN NOT public.can_send(p_user_id, 'marketing_blast', p_channel, p_address) THEN 'can_send_denied'
  END
$fn$;

-- A buyer known only from orders. A phone that is not E.164 cannot be priced or
-- sent, so it is absent. A STOP on any phone on their orders stops the SMS.
CREATE OR REPLACE FUNCTION public.issue_4273_buyer_contact_decision(
  p_brand_id uuid, p_email text, p_phone text, p_channel text
) RETURNS TABLE(normalized_contact text, allowed boolean, reason text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_contact text; v_denied text;
BEGIN
  v_contact := CASE p_channel
    WHEN 'email' THEN lower(btrim(p_email))
    WHEN 'sms' THEN CASE WHEN btrim(COALESCE(p_phone, '')) ~ '^\+[1-9][0-9]{6,14}$' THEN btrim(p_phone) END
  END;
  IF v_contact IS NULL OR v_contact = '' THEN
    RETURN QUERY SELECT NULL::text, false, 'channel_unavailable'::text; RETURN;
  END IF;
  v_denied := public.issue_4273_address_denied(p_brand_id, p_channel, v_contact, NULL);
  IF v_denied IS NULL AND EXISTS (
    SELECT 1 FROM public.marketing_unsubscribes u
     WHERE u.channel IN (p_channel, 'all') AND lower(u.contact_email) = lower(btrim(p_email))
       AND (u.scope = 'global' OR (u.scope = 'brand' AND u.brand_id = p_brand_id))
  ) THEN
    v_denied := 'suppressed';
  END IF;
  IF v_denied IS NULL AND p_channel = 'sms' AND EXISTS (
    SELECT 1 FROM public.orders o JOIN public.events e ON e.id = o.event_id
     WHERE e.brand_id = p_brand_id AND lower(btrim(o.buyer_email)) = lower(btrim(p_email))
       AND o.payment_status IN ('paid', 'partial_refund')
       AND btrim(COALESCE(o.buyer_phone_e164, '')) <> '' AND btrim(o.buyer_phone_e164) <> v_contact
       AND public.issue_4273_address_denied(p_brand_id, 'sms', btrim(o.buyer_phone_e164), NULL) = 'suppressed'
  ) THEN
    v_denied := 'suppressed';
  END IF;
  RETURN QUERY SELECT v_contact, v_denied IS NULL, COALESCE(v_denied, 'allowed');
END;
$fn$;

-- One row per recipient for one email or SMS method, for what the host can see.
-- The strictest identity wins: a person with any blocked identity is one blocked
-- row. Otherwise each Book row with a contact is its own recipient, then the
-- account, then the buyer. Two brand-held rows on one address are one recipient.
-- Graph-only people are never compared to a contact here; send does that.
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
      d.contact_method_id, d.normalized_contact, d.reason AS raw_reason,
      public.issue_4273_follow_gate_ok(i.user_id, p_brand_id, p_channel) AS follow_ok,
      COALESCE(d.allowed, false) AS contact_ok,
      CASE WHEN i.subject = 'book' THEN 0 WHEN i.subject = 'circle' THEN 1 ELSE 2 END AS subject_rank,
      i.user_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.blocked_users bu WHERE
        (bu.blocker_id = p_actor_id AND bu.blocked_id = i.user_id) OR
        (bu.blocker_id = i.user_id AND bu.blocked_id = p_actor_id)) AS blocked
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
  ), marked AS MATERIALIZED (
    SELECT d.*,
      (d.normalized_contact IS NOT NULL AND NOT d.contact_ok)
        OR d.raw_reason = 'consent_missing' OR NOT d.follow_ok AS denied,
      bool_or((d.normalized_contact IS NOT NULL AND NOT d.contact_ok)
        OR d.raw_reason = 'consent_missing' OR NOT d.follow_ok) OVER w AS person_denied,
      bool_or(d.blocked) OVER w AS person_blocked,
      count(*) FILTER (WHERE d.subject = 'book' AND d.normalized_contact IS NOT NULL) OVER w AS book_contacts,
      row_number() OVER (PARTITION BY d.person_key ORDER BY
        (d.normalized_contact IS NOT NULL AND ((NOT d.contact_ok) OR NOT d.follow_ok)) DESC,
        (d.normalized_contact IS NOT NULL) DESC, d.subject_rank, d.node) AS rn
    FROM decided d
    WINDOW w AS (PARTITION BY d.person_key)
  ), recipients AS MATERIALIZED (
    SELECT m.*, NOT m.person_denied AND m.contact_ok AND m.normalized_contact IS NOT NULL AS final_allowed
      FROM marked m
     WHERE NOT m.person_blocked
       AND (CASE WHEN m.person_denied OR m.book_contacts = 0 THEN m.rn = 1
                 ELSE m.subject = 'book' AND m.normalized_contact IS NOT NULL END)
  )
  SELECT DISTINCT ON (
    CASE WHEN r.subject <> 'circle' AND r.normalized_contact IS NOT NULL
         THEN 'a:' || lower(r.normalized_contact) ELSE 'n:' || r.node END)
    r.person_key, r.subject, r.brand_person_id, r.user_id, r.ring, r.buyer_key,
    CASE WHEN r.normalized_contact IS NULL THEN NULL ELSE r.contact_method_id END,
    r.normalized_contact, r.final_allowed,
    CASE
      WHEN r.normalized_contact IS NULL THEN 'channel_unavailable'
      WHEN r.final_allowed THEN 'allowed'
      WHEN r.raw_reason IN ('suppressed', 'can_send_denied', 'delivery_denied') THEN r.raw_reason
      ELSE 'suppressed'
    END
  FROM recipients r
  ORDER BY
    CASE WHEN r.subject <> 'circle' AND r.normalized_contact IS NOT NULL
         THEN 'a:' || lower(r.normalized_contact) ELSE 'n:' || r.node END,
    r.final_allowed, r.subject_rank, r.node
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
     OR COALESCE(public.biz_brand_effective_rank(p_brand_id, p_actor_id), -1) < public.biz_role_rank('marketing_manager') THEN
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
  BEGIN
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
  END;
  RETURN v_totals || jsonb_build_object('followersTotal', v_followers, 'followersAlsoInBook', v_also);
END;
$fn$;

-- How many of these groups one method can reach, for the composer's card. A server
-- total computed the way the preview is: no graph-only contact is compared.
CREATE OR REPLACE FUNCTION public.biz_marketing_combined_audience_reach_v1(
  p_actor_id uuid, p_brand_id uuid, p_sources jsonb, p_channel text
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp
AS $fn$
DECLARE v_sources jsonb; v_reachable integer;
BEGIN
  IF auth.uid() IS DISTINCT FROM p_actor_id OR p_channel NOT IN ('email', 'sms') THEN
    RAISE EXCEPTION 'book_blast_forbidden' USING ERRCODE = '42501';
  END IF;
  v_sources := public.issue_4273_normalize_sources(p_brand_id, p_sources);
  PERFORM public.issue_4273_assert_sources_allowed(p_actor_id, p_brand_id, v_sources);
  SELECT count(*) FILTER (WHERE d.allowed AND d.normalized_contact IS NOT NULL)::integer INTO v_reachable
    FROM public.issue_4273_decided_people(p_actor_id, p_brand_id, v_sources, p_channel) d;
  RETURN v_reachable;
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
    ) ORDER BY d.person_key, d.brand_person_id, d.normalized_contact), '[]'::jsonb)
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
         'safeReasonCode', x ->> 'safeReasonCode')
         ORDER BY x ->> 'personKey', x ->> 'targetBrandPersonId', x ->> 'normalizedContact')
       FROM jsonb_array_elements(v_live -> 'candidates') x
     ) IS DISTINCT FROM (
       SELECT jsonb_agg(jsonb_build_object(
         'personKey', x ->> 'personKey', 'targetBrandPersonId', x ->> 'targetBrandPersonId',
         'recipientUserId', x ->> 'recipientUserId', 'ring', x ->> 'ring',
         'buyerContactKey', x ->> 'buyerContactKey', 'contactMethodId', x ->> 'contactMethodId',
         'normalizedContact', x ->> 'normalizedContact', 'allowed', x ->> 'allowed',
         'safeReasonCode', x ->> 'safeReasonCode')
         ORDER BY x ->> 'personKey', x ->> 'targetBrandPersonId', x ->> 'normalizedContact')
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
-- Anything sealed and not sent is recorded here. host_visible = false marks a
-- difference that exists only because a contact matched someone the host knows
-- only through their circle, so it must never surface as a skipped count.
CREATE TABLE public.marketing_combined_send_skips(
  execution_id uuid NOT NULL REFERENCES public.marketing_book_send_executions(id) ON DELETE RESTRICT,
  target_id uuid NOT NULL REFERENCES public.marketing_book_send_targets(id) ON DELETE RESTRICT,
  reason text NOT NULL CHECK (reason IN (
    'no_longer_eligible', 'identity_blocked', 'contact_match_blocked', 'address_duplicate')),
  host_visible boolean NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (execution_id, target_id)
);
ALTER TABLE public.marketing_combined_send_skips ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.marketing_combined_send_skips FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.marketing_combined_send_skips TO service_role;

-- Every account that has verified this address. Service-only.
CREATE OR REPLACE FUNCTION public.issue_4273_accounts_holding(p_channel text, p_address text)
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, auth, pg_temp
AS $fn$
  SELECT v.user_id FROM public.verified_phone_identities v
   WHERE p_channel = 'sms' AND v.phone_e164 = p_address
  UNION
  SELECT u.id FROM auth.users u
   WHERE p_channel = 'email' AND u.email = lower(btrim(p_address))
     AND EXISTS (SELECT 1 FROM public.verified_account_identifiers(u.id) i
                  WHERE i.kind = 'email' AND i.value = lower(btrim(p_address)))
$fn$;

-- The whole strictest rule, at send. Known identities first (this Book row, its
-- linked account, this buyer's orders); then anyone matched only by contact.
CREATE OR REPLACE FUNCTION public.issue_4273_send_verdict(
  p_actor_id uuid, p_brand_id uuid, p_channel text, p_address text,
  p_brand_person_id uuid, p_user_id uuid, p_buyer_email text
) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_known uuid[]; v_matched uuid[]; v_contacts text[];
  v_method text := CASE p_channel WHEN 'sms' THEN 'phone' ELSE 'email' END;
BEGIN
  SELECT COALESCE(array_agg(DISTINCT x) FILTER (WHERE x IS NOT NULL), '{}') INTO v_known FROM (
    SELECT p_user_id AS x
    UNION ALL
    SELECT bp.linked_user_id FROM public.brand_people bp WHERE bp.id = p_brand_person_id
    UNION ALL
    SELECT o.buyer_user_id FROM public.orders o JOIN public.events e ON e.id = o.event_id
     WHERE p_buyer_email IS NOT NULL AND e.brand_id = p_brand_id
       AND lower(btrim(o.buyer_email)) = p_buyer_email
  ) a;

  -- Each contact, with the method it can identify someone on.
  SELECT array_agg(DISTINCT a.c || '|' || a.v) INTO v_contacts FROM (
    SELECT p_channel AS c, p_address AS v
    UNION ALL
    SELECT CASE m.channel WHEN 'phone' THEN 'sms' ELSE 'email' END, m.normalized_value
      FROM public.brand_person_contact_methods m
     WHERE m.brand_person_id = p_brand_person_id AND m.brand_id = p_brand_id
       AND m.record_state = 'active' AND m.channel IN ('phone', 'email')
    UNION ALL
    SELECT 'email', p_buyer_email WHERE p_buyer_email IS NOT NULL
    UNION ALL
    SELECT 'sms', btrim(o.buyer_phone_e164)
      FROM public.orders o JOIN public.events e ON e.id = o.event_id
     WHERE p_buyer_email IS NOT NULL AND e.brand_id = p_brand_id
       AND lower(btrim(o.buyer_email)) = p_buyer_email
       AND btrim(COALESCE(o.buyer_phone_e164, '')) <> ''
    UNION ALL
    SELECT CASE i.kind WHEN 'phone' THEN 'sms' ELSE 'email' END, i.value
      FROM unnest(v_known) ku CROSS JOIN LATERAL public.verified_account_identifiers(ku) i
     WHERE i.kind IN ('phone', 'email')
  ) a;

  -- ── Known identities ──
  IF EXISTS (SELECT 1 FROM public.blocked_users b, unnest(v_known) ku
              WHERE (b.blocker_id = p_actor_id AND b.blocked_id = ku)
                 OR (b.blocker_id = ku AND b.blocked_id = p_actor_id))
     OR EXISTS (SELECT 1 FROM unnest(v_known) ku
                 WHERE NOT public.issue_4273_follow_gate_ok(ku, p_brand_id, p_channel))
     OR EXISTS (SELECT 1 FROM public.brand_person_contact_methods m
                 WHERE m.brand_person_id = p_brand_person_id AND m.brand_id = p_brand_id
                   AND m.channel = v_method AND m.record_state = 'active'
                   AND m.marketing_consent_state = 'withheld')
     OR EXISTS (SELECT 1 FROM public.brand_person_channel_suppressions s
                 WHERE s.brand_person_id = p_brand_person_id AND s.channel = p_channel
                   AND s.lifted_at IS NULL AND s.scope IN ('marketing', 'all'))
     OR EXISTS (SELECT 1 FROM unnest(v_contacts) c
                 CROSS JOIN unnest(CASE WHEN cardinality(v_known) = 0 THEN ARRAY[NULL::uuid] ELSE v_known END) ku
                 WHERE split_part(c, '|', 1) = p_channel
                   AND public.issue_4273_address_denied(p_brand_id, p_channel, split_part(c, '|', 2), ku) IS NOT NULL) THEN
    RETURN 'identity_blocked';
  END IF;

  -- ── Anyone else holding one of these contacts ──
  SELECT COALESCE(array_agg(DISTINCT x) FILTER (WHERE x IS NOT NULL AND NOT x = ANY(v_known)), '{}') INTO v_matched FROM (
    SELECT h AS x FROM unnest(v_contacts) c
      CROSS JOIN LATERAL public.issue_4273_accounts_holding(split_part(c, '|', 1), split_part(c, '|', 2)) h
    UNION ALL
    SELECT bp.linked_user_id FROM unnest(v_contacts) c
      JOIN public.brand_person_contact_methods m ON m.brand_id = p_brand_id AND m.record_state = 'active'
        AND m.channel = CASE split_part(c, '|', 1) WHEN 'sms' THEN 'phone' ELSE 'email' END
        AND m.normalized_value = split_part(c, '|', 2)
      JOIN public.brand_people bp ON bp.id = m.brand_person_id
  ) a;
  IF EXISTS (SELECT 1 FROM public.blocked_users b, unnest(v_matched) mu
              WHERE (b.blocker_id = p_actor_id AND b.blocked_id = mu)
                 OR (b.blocker_id = mu AND b.blocked_id = p_actor_id))
     OR EXISTS (SELECT 1 FROM unnest(v_matched) mu
                 WHERE NOT public.issue_4273_follow_gate_ok(mu, p_brand_id, p_channel))
     OR EXISTS (SELECT 1 FROM unnest(v_matched) mu
                 CROSS JOIN LATERAL public.verified_account_identifiers(mu) i
                 WHERE i.kind = v_method
                   AND public.issue_4273_address_denied(p_brand_id, p_channel, i.value, mu) IS NOT NULL)
     OR EXISTS (SELECT 1 FROM public.brand_person_contact_methods m
                 WHERE m.brand_id = p_brand_id AND m.channel = v_method AND m.record_state = 'active'
                   AND m.normalized_value = p_address
                   AND (m.marketing_consent_state = 'withheld' OR EXISTS (
                     SELECT 1 FROM public.brand_person_channel_suppressions s
                      WHERE s.brand_person_id = m.brand_person_id AND s.channel = p_channel
                        AND s.lifted_at IS NULL AND s.scope IN ('marketing', 'all')))) THEN
    RETURN 'contact_match_blocked';
  END IF;
  RETURN 'send';
END;
$fn$;

CREATE OR REPLACE FUNCTION public.biz_marketing_combined_send_audience_v1(p_campaign_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp
AS $fn$
DECLARE v_campaign public.marketing_campaigns%ROWTYPE; v_actor uuid; v_execution uuid; v_rows jsonb;
BEGIN
  SELECT * INTO v_campaign FROM public.marketing_campaigns WHERE id = p_campaign_id;
  SELECT e.id, e.actor_id INTO v_execution, v_actor FROM public.marketing_book_send_executions e WHERE e.campaign_id = p_campaign_id;
  IF v_campaign.id IS NULL OR v_actor IS NULL THEN
    RAISE EXCEPTION 'book_blast_unconfirmed' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.marketing_combined_send_skips s WHERE s.execution_id = v_execution;

  WITH sealed AS MATERIALIZED (
    SELECT t.* FROM public.marketing_book_send_targets t
     WHERE t.execution_id = v_execution AND t.outcome = 'queued'
  ), buyers AS MATERIALIZED (
    SELECT DISTINCT ON (lower(btrim(o.buyer_email)))
      encode(extensions.digest(convert_to(lower(btrim(o.buyer_email)), 'UTF8'), 'sha256'), 'hex') AS buyer_key,
      lower(btrim(o.buyer_email)) AS email, o.buyer_name, o.buyer_user_id,
      o.event_id, e.title AS event_title
      FROM public.orders o JOIN public.events e ON e.id = o.event_id
     WHERE e.brand_id = v_campaign.brand_id AND o.payment_status IN ('paid', 'partial_refund')
       AND btrim(COALESCE(o.buyer_email, '')) <> ''
       AND EXISTS (SELECT 1 FROM sealed s WHERE s.buyer_contact_key IS NOT NULL)
     ORDER BY lower(btrim(o.buyer_email)), o.created_at DESC, o.id
  ), resolved AS MATERIALIZED (
    SELECT t.id AS target_id, 0 AS subject_rank, t.brand_person_id::text AS contact_key, p.display_name AS name,
      a.normalized_contact, NULL::uuid AS event_id, NULL::text AS event_title, 'added'::text AS receive_reason,
      t.brand_person_id, p.linked_user_id AS user_id, NULL::text AS buyer_email
      FROM sealed t
      JOIN public.brand_people p ON p.id = t.brand_person_id
      LEFT JOIN LATERAL (
        SELECT c.normalized_contact FROM public.biz_brand_person_authorized_contact_v2(
          v_campaign.brand_id, t.brand_person_id, t.channel, 'marketing_blast') c
         WHERE c.contact_method_id = t.contact_method_id AND c.allowed
           AND t.contact_value_digest = encode(extensions.digest(convert_to(c.normalized_contact, 'UTF8'), 'sha256'), 'hex')
      ) a ON true
     WHERE t.brand_person_id IS NOT NULL
    UNION ALL
    SELECT t.id, 1, t.recipient_user_id::text, COALESCE(NULLIF(btrim(pr.display_name), ''), NULLIF(btrim(pr.first_name), ''), 'Mingla member'),
      a.normalized_contact, NULL, NULL,
      CASE t.ring WHEN 'follower' THEN 'follows' ELSE 'friend_of_follower' END,
      NULL, t.recipient_user_id, NULL
      FROM sealed t
      LEFT JOIN public.profiles pr ON pr.id = t.recipient_user_id AND pr.active IS TRUE AND pr.explorer_deleted_at IS NULL
      LEFT JOIN LATERAL (
        SELECT c.normalized_contact FROM public.issue_1778_circle_authorized_contact(
          v_campaign.brand_id, t.recipient_user_id, t.channel) c
         WHERE c.allowed AND pr.id IS NOT NULL
           AND t.contact_value_digest = encode(extensions.digest(convert_to(c.normalized_contact, 'UTF8'), 'sha256'), 'hex')
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
      ) a ON true
     WHERE t.recipient_user_id IS NOT NULL
    UNION ALL
    -- The sealed phone is the one on the orders whose digest matches, so seal and
    -- send cannot disagree. If that order is gone, this is a recorded skip.
    SELECT t.id, 2, t.buyer_contact_key, b.buyer_name, d.normalized_contact, b.event_id, b.event_title, 'bought',
      NULL, b.buyer_user_id, b.email
      FROM sealed t
      LEFT JOIN buyers b ON b.buyer_key = t.buyer_contact_key
      LEFT JOIN LATERAL (
        SELECT c.normalized_contact FROM public.issue_4273_buyer_contact_decision(
          v_campaign.brand_id, b.email,
          (SELECT btrim(o.buyer_phone_e164) FROM public.orders o JOIN public.events e ON e.id = o.event_id
            WHERE t.channel = 'sms' AND e.brand_id = v_campaign.brand_id
              AND o.payment_status IN ('paid', 'partial_refund')
              AND lower(btrim(o.buyer_email)) = b.email
              AND btrim(COALESCE(o.buyer_phone_e164, '')) <> ''
              AND t.contact_value_digest = encode(extensions.digest(convert_to(btrim(o.buyer_phone_e164), 'UTF8'), 'sha256'), 'hex')
            LIMIT 1),
          t.channel) c
         WHERE c.allowed
           AND t.contact_value_digest = encode(extensions.digest(convert_to(c.normalized_contact, 'UTF8'), 'sha256'), 'hex')
      ) d ON b.buyer_key IS NOT NULL
     WHERE t.buyer_contact_key IS NOT NULL
  ), judged AS MATERIALIZED (
    SELECT r.*,
      CASE WHEN r.normalized_contact IS NULL THEN 'no_longer_eligible'
        ELSE public.issue_4273_send_verdict(v_actor, v_campaign.brand_id, v_campaign.channel,
          r.normalized_contact, r.brand_person_id, r.user_id, r.buyer_email) END AS verdict
    FROM resolved r
  ), ranked AS MATERIALIZED (
    SELECT j.*, CASE WHEN j.verdict = 'send' THEN
        row_number() OVER (PARTITION BY j.verdict, lower(j.normalized_contact) ORDER BY j.subject_rank, j.target_id)
      END AS address_rank
    FROM judged j
  ), recorded AS (
    INSERT INTO public.marketing_combined_send_skips(execution_id, target_id, reason, host_visible)
    SELECT v_execution, x.target_id,
      CASE WHEN x.verdict = 'send' THEN 'address_duplicate' ELSE x.verdict END,
      x.verdict IN ('no_longer_eligible', 'identity_blocked')
    FROM ranked x WHERE x.verdict <> 'send' OR x.address_rank > 1
    RETURNING 1
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
  FROM ranked x WHERE x.verdict = 'send' AND x.address_rank = 1;

  RETURN jsonb_build_object('rows', v_rows, 'brand_id', v_campaign.brand_id, 'reach', jsonb_build_object(
    'total', jsonb_array_length(v_rows),
    'reachable_email', CASE WHEN v_campaign.channel = 'email' THEN jsonb_array_length(v_rows) ELSE 0 END,
    'reachable_sms', CASE WHEN v_campaign.channel = 'sms' THEN jsonb_array_length(v_rows) ELSE 0 END));
END;
$fn$;

-- How many sealed-and-unsent targets must stay out of the host's skipped count.
CREATE OR REPLACE FUNCTION public.biz_marketing_combined_hidden_skips_v1(p_campaign_id uuid)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
  SELECT count(*)::integer FROM public.marketing_combined_send_skips s
    JOIN public.marketing_book_send_executions e ON e.id = s.execution_id
   WHERE e.campaign_id = p_campaign_id AND NOT s.host_visible
$fn$;

-- ── What a host reads back ──────────────────────────────────────────────────
-- A sealed campaign's message row shows its contact only when the brand itself
-- held that contact: a sealed Book row or a sealed buyer. Everything else fails
-- closed. A campaign with no sealed execution is a buyer list: brand-held.
CREATE INDEX issue_4273_target_contact_digest
  ON public.marketing_book_send_targets(execution_id, contact_value_digest)
  WHERE brand_person_id IS NOT NULL OR buyer_contact_key IS NOT NULL;

CREATE OR REPLACE FUNCTION public.issue_4273_host_may_read_message_contact(
  p_campaign_id uuid, p_phone text, p_email text
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, extensions, pg_temp
AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.marketing_campaigns c
     WHERE c.id = p_campaign_id
       AND (c.account_id = auth.uid() OR public.mkt_brand_min_rank(c.brand_id, 'brand_member'))
  ) AND (
    (p_phone IS NULL AND p_email IS NULL)
    OR NOT EXISTS (SELECT 1 FROM public.marketing_book_send_executions e WHERE e.campaign_id = p_campaign_id)
    OR EXISTS (
      SELECT 1 FROM public.marketing_book_send_targets t
        JOIN public.marketing_book_send_executions e ON e.id = t.execution_id
       WHERE e.campaign_id = p_campaign_id
         AND (t.brand_person_id IS NOT NULL OR t.buyer_contact_key IS NOT NULL)
         AND t.contact_value_digest IN (
           encode(extensions.digest(convert_to(p_phone, 'UTF8'), 'sha256'), 'hex'),
           encode(extensions.digest(convert_to(lower(btrim(p_email)), 'UTF8'), 'sha256'), 'hex'))
    )
  )
$fn$;

-- [TRANSITIONAL] Older installed apps still read this table directly: they lose
-- circle rows from their list and counts rather than break. Exit: when no
-- supported build reads marketing_messages directly, revoke the read outright.
DROP POLICY IF EXISTS marketing_messages_select ON public.marketing_messages;
CREATE POLICY marketing_messages_select ON public.marketing_messages
  FOR SELECT TO authenticated
  USING (public.issue_4273_host_may_read_message_contact(campaign_id, recipient_phone, recipient_email));

-- Every Host read of messages (Campaign detail, Overview): every row the campaign
-- owner may see, so totals stay whole, with the contact and any provider text
-- blanked on rows the brand did not hold.
CREATE OR REPLACE FUNCTION public.biz_marketing_campaign_messages_v1(
  p_campaign_ids uuid[], p_since timestamptz DEFAULT NULL, p_from integer DEFAULT 0,
  p_limit integer DEFAULT 500, p_newest_first boolean DEFAULT false
) RETURNS TABLE(
  id uuid, recipient_email text, status text, sent_at timestamptz, click_count integer,
  failure_reason text, delivered_at timestamptz, opened_at timestamptz,
  delivery_tracking_eligible_at timestamptz, open_tracking_eligible_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
  SELECT m.id,
    CASE WHEN v.ok THEN m.recipient_email END,
    m.status::text, m.sent_at, m.click_count,
    CASE WHEN v.ok OR m.failure_reason IS NULL THEN m.failure_reason ELSE 'not_delivered' END,
    m.delivered_at, m.opened_at, m.delivery_tracking_eligible_at, m.open_tracking_eligible_at
  FROM public.marketing_messages m
  JOIN public.marketing_campaigns c ON c.id = m.campaign_id
  CROSS JOIN LATERAL (SELECT public.issue_4273_host_may_read_message_contact(
    m.campaign_id, m.recipient_phone, m.recipient_email) AS ok) v
  WHERE m.campaign_id = ANY(p_campaign_ids)
    AND (c.account_id = auth.uid() OR public.mkt_brand_min_rank(c.brand_id, 'brand_member'))
    AND (p_since IS NULL OR m.created_at >= p_since)
  ORDER BY
    CASE WHEN p_newest_first THEN m.sent_at END DESC NULLS LAST,
    m.id
  OFFSET GREATEST(COALESCE(p_from, 0), 0)
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 500), 1), 500)
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

-- ── Claim: #2509 reclaim + #1778 sealed gate + the new kind ──────────────────
-- 20270627001778 replaced 20270525002509's body and lost the reclaim. All three
-- rules live here now. The reclaim window is longer than the runtime's own
-- ceiling and the dispatcher heartbeats updated_at, so a healthy run is never
-- stolen from itself; resume skips every address already handled, and the sealed
-- execution is never rewritten, so a reclaim cannot send or count anything twice.
CREATE OR REPLACE FUNCTION public.mkt_claim_campaigns(p_limit integer DEFAULT 10,p_campaign_id uuid DEFAULT NULL)
RETURNS TABLE(id uuid,account_id uuid,brand_id uuid,audience_id uuid,channel text,channel_payload jsonb,name text,scheduled_for timestamptz)
LANGUAGE plpgsql SET search_path=public,pg_temp AS $function$
DECLARE
  -- 10 minutes: ~3x the observed ~196s death point (#2509).
  v_stale interval := interval '10 minutes';
BEGIN
  RETURN QUERY UPDATE public.marketing_campaigns mc SET status='sending',updated_at=now() WHERE mc.id IN(
    SELECT c.id FROM public.marketing_campaigns c
    WHERE ((c.status='scheduled' AND c.scheduled_for<=now())
           OR (c.status='sending' AND c.updated_at<now()-v_stale))
      AND (p_campaign_id IS NULL OR c.id=p_campaign_id)
      AND EXISTS(SELECT 1 FROM public.marketing_audiences a WHERE a.id=c.audience_id AND (
        a.query_definition->>'kind' NOT IN('all_brand_people','manual_group','brand_followers','brand_circle_extended','combined_sources')
        OR EXISTS(SELECT 1 FROM public.marketing_book_send_executions e WHERE e.campaign_id=c.id)))
    ORDER BY c.scheduled_for ASC NULLS LAST LIMIT p_limit FOR UPDATE SKIP LOCKED)
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
  public.issue_4273_address_denied(uuid, text, text, uuid),
  public.issue_4273_buyer_contact_decision(uuid, text, text, text),
  public.issue_4273_decided_people(uuid, uuid, jsonb, text),
  public.issue_4273_accounts_holding(text, text),
  public.issue_4273_send_verdict(uuid, uuid, text, text, uuid, uuid, text),
  public.biz_marketing_combined_hidden_skips_v1(uuid),
  public.biz_marketing_combined_quote_candidates_v1(uuid, uuid),
  public.biz_confirm_marketing_combined_send_v1(uuid, uuid, uuid, jsonb, timestamptz),
  public.biz_marketing_combined_send_audience_v1(uuid),
  public.biz_marketing_push_quote_candidates_v1(uuid, uuid),
  public.biz_marketing_push_send_worklist_v1(uuid),
  public.mkt_claim_campaigns(integer, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.biz_marketing_combined_hidden_skips_v1(uuid),
  public.biz_marketing_combined_quote_candidates_v1(uuid, uuid),
  public.biz_confirm_marketing_combined_send_v1(uuid, uuid, uuid, jsonb, timestamptz),
  public.biz_marketing_combined_send_audience_v1(uuid),
  public.biz_marketing_push_quote_candidates_v1(uuid, uuid),
  public.biz_marketing_push_send_worklist_v1(uuid),
  public.mkt_claim_campaigns(integer, uuid)
  TO service_role;
REVOKE ALL ON FUNCTION public.biz_get_or_create_marketing_combined_audience_v1(uuid, uuid, jsonb),
  public.biz_marketing_combined_audience_summary_v1(uuid, uuid, jsonb),
  public.biz_marketing_combined_audience_reach_v1(uuid, uuid, jsonb, text),
  public.biz_marketing_campaign_messages_v1(uuid[], timestamptz, integer, integer, boolean),
  public.issue_4273_host_may_read_message_contact(uuid, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.biz_get_or_create_marketing_combined_audience_v1(uuid, uuid, jsonb),
  public.biz_marketing_combined_audience_summary_v1(uuid, uuid, jsonb),
  public.biz_marketing_combined_audience_reach_v1(uuid, uuid, jsonb, text),
  public.biz_marketing_campaign_messages_v1(uuid[], timestamptz, integer, integer, boolean),
  public.issue_4273_host_may_read_message_contact(uuid, text, text)
  TO authenticated;

ALTER FUNCTION public.biz_marketing_combined_quote_candidates_v1(uuid, uuid) OWNER TO postgres;
ALTER FUNCTION public.biz_confirm_marketing_combined_send_v1(uuid, uuid, uuid, jsonb, timestamptz) OWNER TO postgres;
ALTER FUNCTION public.biz_marketing_combined_send_audience_v1(uuid) OWNER TO postgres;

COMMIT;
