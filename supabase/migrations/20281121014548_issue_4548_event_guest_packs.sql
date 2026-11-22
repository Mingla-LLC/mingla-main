-- #4548 — Guest pack: a host's private note plus up to five labelled links for
-- the people who hold a ticket or a confirmed RSVP place. App-only delivery.
-- Depends on #4420/#4473 (issue_4420_caller_reads_exact_stops, shared holders),
-- #4459 (server-written RSVP approvals) and #4508 (claimed plus-ones).
--
-- I-4548-GUEST-PACK-APP-ONLY: public.event_guest_packs has no anon or
-- authenticated grant; only pg_my_event_guest_pack, biz_get_event_guest_pack,
-- biz_set_event_guest_pack and event_guest_pack_exists reference it; no view
-- reads it; and no edge function names it (emails call event_guest_pack_exists
-- only and never read the pack's content).
--
-- Readable by (issue_4548_caller_holds_event):
--   * everyone issue_4420_caller_reads_exact_stops admits: the brand team, a
--     paid / partially refunded buyer (an app purchase, or a web purchase once
--     the claim sweep set orders.buyer_user_id), a valid / used ticket holder,
--     and a live shared holder of a paid order;
--   * an RSVP owner whose RSVP is going + approved with a server-written
--     approval (#4459);
--   * a claimed (#4508 claimed_at) matched plus-one of such an RSVP;
--   * a live shared holder (#4473) of such an RSVP or plus-one.
-- Pending, waitlisted, refunded and cancelled bookings never read it.

-- ── 0. Whitespace trim ─────────────────────────────────────────────────────
-- btrim() strips only spaces. Guest pack text is trimmed of every leading and
-- trailing whitespace character: ASCII space, tab, CR, LF, VT, FF, and the
-- Unicode spaces (no-break, ogham, en..hair, zero-width, line/paragraph
-- separators, narrow no-break, medium mathematical, ideographic, BOM).
CREATE OR REPLACE FUNCTION public.issue_4548_trim(p text)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = ''
AS $fn$
  SELECT pg_catalog.regexp_replace(
    p,
    '^[\s\u00a0\u1680\u2000-\u200b\u2028\u2029\u202f\u205f\u3000\ufeff]+|[\s\u00a0\u1680\u2000-\u200b\u2028\u2029\u202f\u205f\u3000\ufeff]+$',
    '', 'g');
$fn$;

COMMENT ON FUNCTION public.issue_4548_trim(text) IS
  '#4548: trims all leading/trailing whitespace (ASCII and Unicode spaces) from guest pack text.';

-- ── 1. Link validator ──────────────────────────────────────────────────────
-- An array of 0..5 objects with exactly {label, url}; label trimmed of all
-- whitespace, 1..40 characters, no tab or line break inside; url trimmed, https
-- with a dotted host, no whitespace, at most 2048.
CREATE OR REPLACE FUNCTION public.event_guest_pack_items_valid(p jsonb)
RETURNS boolean
LANGUAGE sql IMMUTABLE
SET search_path = ''
AS $fn$
  SELECT CASE
    WHEN p IS NULL OR jsonb_typeof(p) <> 'array' THEN false
    WHEN jsonb_array_length(p) > 5 THEN false
    ELSE NOT EXISTS (
      SELECT 1
        FROM jsonb_array_elements(p) AS e(item)
       WHERE NOT CASE
         WHEN jsonb_typeof(e.item) <> 'object' THEN false
         WHEN (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(e.item) AS t(k))
              IS DISTINCT FROM ARRAY['label', 'url']::text[] THEN false
         WHEN jsonb_typeof(e.item -> 'label') <> 'string'
           OR jsonb_typeof(e.item -> 'url') <> 'string' THEN false
         ELSE (e.item ->> 'label') = public.issue_4548_trim(e.item ->> 'label')
          AND (e.item ->> 'label') !~ '[\t\n\r\v\f\u2028\u2029]'
          AND (e.item ->> 'url') = public.issue_4548_trim(e.item ->> 'url')
          AND char_length(e.item ->> 'label') BETWEEN 1 AND 40
          AND char_length(e.item ->> 'url') <= 2048
          AND (e.item ->> 'url') ~ '^https://[^\s/]+\.[^\s]+$'
       END
    )
  END;
$fn$;

COMMENT ON FUNCTION public.event_guest_pack_items_valid(jsonb) IS
  '#4548: guest pack links are an array of 0..5 {label, url} objects; label trimmed 1..40 chars; url https, dotted host, no whitespace, <= 2048.';

-- ── 2. The table (no client grants) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.event_guest_packs (
  event_id uuid PRIMARY KEY REFERENCES public.events(id) ON DELETE CASCADE,
  note text CHECK (note IS NULL OR (char_length(note) BETWEEN 1 AND 1000
                                    AND note = public.issue_4548_trim(note))),
  items jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (public.event_guest_pack_items_valid(items)),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT event_guest_packs_not_empty
    CHECK (note IS NOT NULL OR CASE WHEN jsonb_typeof(items) = 'array'
                                    THEN jsonb_array_length(items) > 0
                                    ELSE false END)
);

ALTER TABLE public.event_guest_packs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.event_guest_packs FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.event_guest_packs TO service_role;

COMMENT ON TABLE public.event_guest_packs IS
  '#4548 I-4548-GUEST-PACK-APP-ONLY: one private guest pack per event, rsvp or experience. No client grants and no policies. Guests read pg_my_event_guest_pack; the brand team reads biz_get_event_guest_pack and writes biz_set_event_guest_pack; emails call event_guest_pack_exists (service_role) only.';

-- ── 3. Holder predicate ────────────────────────────────────────────────────
-- plpgsql so the body binds at call time; it reads #4459 and #4508 objects.
CREATE OR REPLACE FUNCTION public.issue_4548_caller_holds_event(p_event_id uuid)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR p_event_id IS NULL THEN
    RETURN false;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.events e WHERE e.id = p_event_id AND e.deleted_at IS NULL
  ) THEN
    RETURN false;
  END IF;
  -- Brand team, paid buyers, ticket holders, live shared order holders.
  IF public.issue_4420_caller_reads_exact_stops(p_event_id) THEN
    RETURN true;
  END IF;
  -- A going + approved RSVP owner (server-written approval only).
  IF EXISTS (
    SELECT 1
      FROM public.event_rsvps r
      JOIN public.issue_4459_rsvp_server_approvals sa ON sa.rsvp_id = r.id
     WHERE r.event_id = p_event_id
       AND r.user_id = v_uid
       AND r.rsvp_status = 'going' AND r.approval_status = 'approved'
  ) THEN
    RETURN true;
  END IF;
  -- A claimed matched plus-one of such an RSVP.
  IF EXISTS (
    SELECT 1
      FROM public.event_rsvp_guests g
      JOIN public.event_rsvps r ON r.id = g.rsvp_id
      JOIN public.issue_4459_rsvp_server_approvals sa ON sa.rsvp_id = r.id
     WHERE r.event_id = p_event_id
       AND g.matched_user_id = v_uid
       AND g.claimed_at IS NOT NULL
       AND r.rsvp_status = 'going' AND r.approval_status = 'approved'
  ) THEN
    RETURN true;
  END IF;
  -- A live shared holder (#4473) of such an RSVP or plus-one, while the
  -- holder still proves the purchase contact.
  IF EXISTS (
    SELECT 1
      FROM public.purchase_shared_holders s
      JOIN public.event_rsvps r ON s.kind = 'rsvp' AND r.id = s.source_id
      JOIN public.issue_4459_rsvp_server_approvals sa ON sa.rsvp_id = r.id
     WHERE s.user_id = v_uid AND s.revoked_at IS NULL
       AND r.event_id = p_event_id
       AND r.rsvp_status = 'going' AND r.approval_status = 'approved'
       AND public.issue_4473_holder_proves('rsvp', r.id, v_uid)
  ) OR EXISTS (
    SELECT 1
      FROM public.purchase_shared_holders s
      JOIN public.event_rsvp_guests g ON s.kind = 'rsvp_guest' AND g.id = s.source_id
      JOIN public.event_rsvps r ON r.id = g.rsvp_id
      JOIN public.issue_4459_rsvp_server_approvals sa ON sa.rsvp_id = r.id
     WHERE s.user_id = v_uid AND s.revoked_at IS NULL
       AND r.event_id = p_event_id
       AND r.rsvp_status = 'going' AND r.approval_status = 'approved'
       AND public.issue_4473_holder_proves('rsvp_guest', g.id, v_uid)
  ) THEN
    RETURN true;
  END IF;
  RETURN false;
END;
$fn$;

COMMENT ON FUNCTION public.issue_4548_caller_holds_event(uuid) IS
  '#4548: true when the caller may read this event''s guest pack (brand team, paid buyer, ticket holder, live shared holder, going + approved RSVP owner, claimed plus-one). Internal: no client grant.';

-- ── 4. Guest read ──────────────────────────────────────────────────────────
-- {note, items, updatedAt}, or null when there is no pack or the caller does
-- not hold the event (the two are indistinguishable on purpose).
CREATE OR REPLACE FUNCTION public.pg_my_event_guest_pack(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v public.event_guest_packs;
BEGIN
  IF NOT public.issue_4548_caller_holds_event(p_event_id) THEN
    RETURN NULL;
  END IF;
  SELECT * INTO v FROM public.event_guest_packs WHERE event_id = p_event_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  RETURN jsonb_build_object(
    'note', v.note,
    'items', v.items,
    'updatedAt', v.updated_at
  );
END;
$fn$;

COMMENT ON FUNCTION public.pg_my_event_guest_pack(uuid) IS
  '#4548: the caller''s guest pack for an event they hold: {note, items[{label,url}], updatedAt} or null.';

-- ── 5. Brand team read ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.biz_get_event_guest_pack(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_brand uuid;
  v public.event_guest_packs;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501';
  END IF;
  SELECT e.brand_id INTO v_brand
    FROM public.events e
   WHERE e.id = p_event_id AND e.deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'event_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.biz_is_brand_member_for_read(v_brand, v_uid) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v FROM public.event_guest_packs WHERE event_id = p_event_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  RETURN jsonb_build_object(
    'note', v.note,
    'items', v.items,
    'updatedAt', v.updated_at
  );
END;
$fn$;

COMMENT ON FUNCTION public.biz_get_event_guest_pack(uuid) IS
  '#4548: the brand team''s read of an event''s guest pack: {note, items, updatedAt} or null when none.';

-- ── 6. Brand write (event_manager or above) ────────────────────────────────
-- Replaces the whole pack. The note is trimmed (empty = none); each link's
-- label and url are trimmed; order is the array order. An empty note with no
-- links deletes the pack and returns null.
CREATE OR REPLACE FUNCTION public.biz_set_event_guest_pack(
  p_event_id uuid, p_note text, p_items jsonb
)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_event record;
  v_note text;
  v_items jsonb;
  v public.event_guest_packs;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501';
  END IF;
  SELECT e.id, e.brand_id, e.event_type INTO v_event
    FROM public.events e
   WHERE e.id = p_event_id AND e.deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'event_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF public.biz_brand_effective_rank(v_event.brand_id, v_uid)
       < public.biz_role_rank('event_manager') THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF v_event.event_type IS NULL
     OR v_event.event_type NOT IN ('event', 'rsvp', 'experience') THEN
    RAISE EXCEPTION 'guest_pack_unsupported_event_type' USING ERRCODE = '22023';
  END IF;

  -- Every leading/trailing whitespace character goes; interior line breaks stay.
  v_note := NULLIF(public.issue_4548_trim(p_note), '');
  IF v_note IS NOT NULL AND char_length(v_note) > 1000 THEN
    RAISE EXCEPTION 'guest_pack_note_too_long' USING ERRCODE = '22023';
  END IF;

  v_items := COALESCE(p_items, '[]'::jsonb);
  IF jsonb_typeof(v_items) <> 'array' THEN
    RAISE EXCEPTION 'guest_pack_items_invalid' USING ERRCODE = '22023';
  END IF;
  -- Trim string labels and urls in place; anything else is left as sent so
  -- the validator rejects it (an extra key is never silently dropped).
  SELECT COALESCE(jsonb_agg(
           CASE WHEN jsonb_typeof(e.item) = 'object'
                 AND jsonb_typeof(e.item -> 'label') = 'string'
                 AND jsonb_typeof(e.item -> 'url') = 'string'
                THEN e.item || jsonb_build_object(
                       'label', public.issue_4548_trim(e.item ->> 'label'),
                       'url', public.issue_4548_trim(e.item ->> 'url'))
                ELSE e.item END
           ORDER BY e.ord), '[]'::jsonb)
    INTO v_items
    FROM jsonb_array_elements(v_items) WITH ORDINALITY AS e(item, ord);
  IF NOT public.event_guest_pack_items_valid(v_items) THEN
    RAISE EXCEPTION 'guest_pack_items_invalid' USING ERRCODE = '22023';
  END IF;

  IF v_note IS NULL AND jsonb_array_length(v_items) = 0 THEN
    DELETE FROM public.event_guest_packs WHERE event_id = p_event_id;
    RETURN NULL;
  END IF;

  INSERT INTO public.event_guest_packs AS p (event_id, note, items, updated_at, updated_by)
  VALUES (p_event_id, v_note, v_items, now(), v_uid)
  ON CONFLICT (event_id) DO UPDATE
    SET note = EXCLUDED.note,
        items = EXCLUDED.items,
        updated_at = EXCLUDED.updated_at,
        updated_by = EXCLUDED.updated_by
  RETURNING p.* INTO v;

  RETURN jsonb_build_object(
    'note', v.note,
    'items', v.items,
    'updatedAt', v.updated_at
  );
END;
$fn$;

COMMENT ON FUNCTION public.biz_set_event_guest_pack(uuid, text, jsonb) IS
  '#4548: replace an event''s guest pack (event_manager+; event, rsvp or experience). Empty note and no links deletes it and returns null.';

-- ── 7. Service-only existence check (emails) ───────────────────────────────
CREATE OR REPLACE FUNCTION public.event_guest_pack_exists(p_event_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.event_guest_packs p WHERE p.event_id = p_event_id
  );
$fn$;

COMMENT ON FUNCTION public.event_guest_pack_exists(uuid) IS
  '#4548: whether an event has a guest pack. service_role only: emails add a pointer line and never read the pack.';

-- ── 8. Grants ──────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.issue_4548_trim(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.event_guest_pack_items_valid(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_4548_caller_holds_event(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pg_my_event_guest_pack(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.biz_get_event_guest_pack(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.biz_set_event_guest_pack(uuid, text, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.event_guest_pack_exists(uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.issue_4548_trim(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.event_guest_pack_items_valid(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_4548_caller_holds_event(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.pg_my_event_guest_pack(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.biz_get_event_guest_pack(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.biz_set_event_guest_pack(uuid, text, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.event_guest_pack_exists(uuid) TO service_role;
