-- Issue #3827 — on a live event the location has ONE owner, and a reason is
-- only owed when there are buyers to give it to.
--
-- WHAT WAS BROKEN.
--   1. A host changed the address of a published event and it came back as the
--      old one. A live event keeps its location twice: the structured halves in
--      theme.business_event.location {venueName, address}, which the editor and
--      the public page read first, and the label events.location_text, composed
--      as "venue · address". Publish writes both. The live-edit functions wrote
--      the label only, and wrote one half over the whole of it, so the label
--      lost the venue and the structured address never moved.
--   2. Switching "hide address until ticket" off on a live event did nothing.
--      business_update_live_event wrote theme.business_event.settings.
--      hideAddressUntilTicket; every reader uses the direct child
--      theme.business_event.hideAddressUntilTicket.
--   3. Any save that touched the categories wiped the pin's precision. The
--      editor sends the stored pin on every taxonomy save, and the function
--      treated a pin with no precision token as a new coordinate.
--   4. A reason of 10 to 200 characters was demanded for every live edit, with
--      copy promising it would be sent to buyers, on events nobody has bought.
--
-- WHAT THIS DOES.
--   - Four helpers: the label composer, the theme merge that sets either half,
--     the single definition of "this event has buyers", and the reason resolver.
--   - business_patch_event_taxonomy: p_location_text is the structured address.
--     It sets the address half and the label is derived from both halves. The
--     same pin keeps its stored precision unless a valid token is sent.
--   - business_update_live_event: venueName sets the venue half; the label is
--     derived. hideAddressUntilTicket is written to the direct child and the
--     stale settings copy is removed.
--   - business_update_live_event_atomic: the reason goes through the resolver.
--   - biz_update_live_rsvp: the reason goes through the resolver, and an
--     optional `location` payload key writes both halves and derives the label.
--   Old clients are corrected the moment this applies: the payloads they
--   already send are read as described above. No stored row is rewritten.
--
-- NOT TOUCHED. business_update_rsvp_graph, business_set_event_visibility,
-- business_patch_offering_refund_policy, business_patch_event_when and
-- business_patch_event_ticket_tiers keep their own unconditional reason check.
-- The atomic owner hands the last two the resolved reason, which satisfies it.
--
-- WHERE THE BODIES CAME FROM. Each function is re-emitted verbatim from its
-- latest definition in this repository (named above each one) with only the
-- hunks marked `issue #3827` changed. Each source range was re-applied to a
-- full local replay of the chain and left md5(prosrc) unchanged, so each is
-- the last definition. Signatures are unchanged, so no DROP is needed and every
-- existing GRANT, REVOKE and COMMENT survives CREATE OR REPLACE.

BEGIN;

-- ---------------------------------------------------------------------------
-- Helper 1. The label composer. Same rule as the Host app's draft composer
-- (`locationTextForDraft`, mingla-business/src/utils/serverDraftEventMapper.ts):
-- drop a half that is NULL or only whitespace, join what is left exactly as
-- stored with " · ", NULL when nothing is left. "Whitespace" is the set
-- JavaScript's String.prototype.trim removes, so the two composers agree on
-- which halves are blank; a shared fixture table pins that in both suites.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.business_event_location_label(
  p_venue text,
  p_address text
) RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $fn$
  SELECT NULLIF(concat_ws(' · ',
    CASE WHEN btrim(p_venue, ws.chars) <> '' THEN p_venue END,
    CASE WHEN btrim(p_address, ws.chars) <> '' THEN p_address END), '')
  FROM (SELECT E' \t\n\r\f\v' || chr(160) || chr(5760)
    || chr(8192) || chr(8193) || chr(8194) || chr(8195) || chr(8196) || chr(8197)
    || chr(8198) || chr(8199) || chr(8200) || chr(8201) || chr(8202)
    || chr(8232) || chr(8233) || chr(8239) || chr(8287) || chr(12288) || chr(65279) AS chars) AS ws
$fn$;

REVOKE ALL ON FUNCTION public.business_event_location_label(text, text)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.business_event_location_label(text, text) IS
  '#3827 the one composer of events.location_text for live edits: non-blank venue and address joined with " · ", NULL when neither.';

-- ---------------------------------------------------------------------------
-- Helper 2. Set either half of theme.business_event.location and return the
-- whole theme. The namespace is MERGED, not jsonb_set: jsonb_set creates only
-- the final path element, so on a theme with no business_event (or no
-- location) object it would be a silent no-op (the #2353 lesson,
-- 20270429002353:371-377). Every sibling key is preserved.
--
-- A theme holding neither half has only the label to go on, so the label is
-- seeded into venueName first (the same fallback the public page uses,
-- packages/offering-rendering/publicEventLocation.ts); setting one half then
-- never discards the other. A blank value clears that half to JSON null.
-- With neither flag set the theme is returned exactly as given.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.business_event_theme_with_location(
  p_theme jsonb,
  p_location_text text,
  p_set_venue boolean,
  p_venue text,
  p_set_address boolean,
  p_address text
) RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_theme jsonb;
  v_business_event jsonb;
  v_location jsonb;
BEGIN
  IF NOT COALESCE(p_set_venue, false) AND NOT COALESCE(p_set_address, false) THEN
    RETURN p_theme;
  END IF;
  v_theme := CASE WHEN jsonb_typeof(p_theme) = 'object' THEN p_theme ELSE '{}'::jsonb END;
  v_business_event := CASE WHEN jsonb_typeof(v_theme->'business_event') = 'object'
    THEN v_theme->'business_event' ELSE '{}'::jsonb END;
  v_location := CASE WHEN jsonb_typeof(v_business_event->'location') = 'object'
    THEN v_business_event->'location' ELSE '{}'::jsonb END;

  IF public.business_event_location_label(v_location->>'venueName', v_location->>'address') IS NULL
     AND public.business_event_location_label(p_location_text, NULL) IS NOT NULL THEN
    v_location := v_location || jsonb_build_object('venueName', p_location_text);
  END IF;

  IF COALESCE(p_set_venue, false) THEN
    v_location := v_location || jsonb_build_object(
      'venueName', public.business_event_location_label(p_venue, NULL));
  END IF;
  IF COALESCE(p_set_address, false) THEN
    v_location := v_location || jsonb_build_object(
      'address', public.business_event_location_label(NULL, p_address));
  END IF;

  RETURN v_theme || jsonb_build_object(
    'business_event', v_business_event || jsonb_build_object('location', v_location));
END;
$fn$;

REVOKE ALL ON FUNCTION public.business_event_theme_with_location(jsonb, text, boolean, text, boolean, text)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.business_event_theme_with_location(jsonb, text, boolean, text, boolean, text) IS
  '#3827 merges a venue and/or address into theme.business_event.location, creating the namespace when absent and seeding venueName from the label when the theme holds neither half.';

-- ---------------------------------------------------------------------------
-- Helper 3. The single definition of "this event has buyers". Only zero versus
-- non-zero is contractual; an order and its tickets both count.
--   - orders that are paid or partly refunded and not cancelled
--   - tickets that are valid, used, transferred or awaiting a refund
--   - RSVPs that are going and approved
-- A fully refunded or cancelled order, a void or refunded ticket, and a
-- declined, waitlisted or pending RSVP are not buyers.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.business_event_buyer_count(
  p_event_id uuid
) RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_brand_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  SELECT e.brand_id INTO v_brand_id
    FROM public.events AS e
   WHERE e.id = p_event_id AND e.deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'event_not_found';
  END IF;
  IF public.biz_brand_effective_rank(v_brand_id, v_uid)
       < public.biz_role_rank('event_manager'::text) THEN
    RAISE EXCEPTION 'insufficient_event_permission';
  END IF;
  RETURN (
    (SELECT count(*) FROM public.orders AS o
      WHERE o.event_id = p_event_id
        AND o.payment_status IN ('paid', 'partial_refund')
        AND o.cancelled_at IS NULL)
    + (SELECT count(*) FROM public.tickets AS t
        WHERE t.event_id = p_event_id
          AND t.status IN ('valid', 'used', 'transferred', 'refund_pending'))
    + (SELECT count(*) FROM public.event_rsvps AS r
        WHERE r.event_id = p_event_id
          AND r.rsvp_status = 'going'
          AND r.approval_status = 'approved')
  )::integer;
END;
$fn$;

REVOKE ALL ON FUNCTION public.business_event_buyer_count(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.business_event_buyer_count(uuid) TO authenticated;

COMMENT ON FUNCTION public.business_event_buyer_count(uuid) IS
  '#3827 how many buyers an event has (paid orders + live tickets + going RSVPs), for event managers and above. Only zero versus non-zero is contractual.';

-- ---------------------------------------------------------------------------
-- Helper 4. The reason a live edit is recorded with, or NULL when it must be
-- refused. A 10 to 200 character reason is returned trimmed and the buyer
-- count is never consulted. A blank reason is accepted only for an event with
-- no buyers, and is recorded as the constant below so the unchanged leaves
-- still receive a reason they accept and the log never shows an invented one.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.business_resolve_edit_reason(
  p_event_id uuid,
  p_reason text
) RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_reason text := btrim(COALESCE(p_reason, ''));
BEGIN
  IF length(v_reason) BETWEEN 10 AND 200 THEN
    RETURN v_reason;
  END IF;
  IF v_reason = '' AND public.business_event_buyer_count(p_event_id) = 0 THEN
    RETURN 'No buyers at time of edit; no reason given';
  END IF;
  RETURN NULL;
END;
$fn$;

REVOKE ALL ON FUNCTION public.business_resolve_edit_reason(uuid, text)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.business_resolve_edit_reason(uuid, text) IS
  '#3827 returns the trimmed 10 to 200 character reason, the no-buyers constant for a blank reason on an event with no buyers, or NULL when the edit must be refused.';


-- ---------------------------------------------------------------------------
-- business_patch_event_taxonomy
--   Body: 20270427002334_issue_2333_patch_taxonomy_online_city_optional.sql:49-194.
--   Hunks: the same-pin precision keep, and the address set + label derivation.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.business_patch_event_taxonomy(p_event_id uuid, p_city text, p_party_types text[], p_vibe_tags text[], p_music_genres text[], p_location_lat numeric DEFAULT NULL::numeric, p_location_lng numeric DEFAULT NULL::numeric, p_location_text text DEFAULT NULL::text, p_coordinate_precision text DEFAULT ''::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id uuid;
  v_event public.events%ROWTYPE;
  v_now timestamptz := now();
  v_city text;
  v_party_types text[];
  v_vibe_tags text[];
  v_music_genres text[];
  v_location_geo point;
  v_location_text text;
  v_coordinate_precision text;   -- issue #1363 G2
  v_theme jsonb;                 -- issue #3827
  v_updated public.events%ROWTYPE;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT *
  INTO v_event
  FROM public.events
  WHERE id = p_event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'event_not_found';
  END IF;

  IF v_event.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'event_deleted';
  END IF;

  IF v_event.status NOT IN ('scheduled', 'live') THEN
    RAISE EXCEPTION 'event_not_editable_status';
  END IF;

  IF public.biz_brand_effective_rank(v_event.brand_id, v_user_id)
       < public.biz_role_rank('event_manager'::text) THEN
    RAISE EXCEPTION 'insufficient_event_permission';
  END IF;

  v_city := NULLIF(btrim(COALESCE(p_city, '')), '');
  -- issue #2333 — this RPC has no format argument, so the online test reads the
  -- durable signal off the row already locked in v_event. publish writes
  -- business_draft.format through to theme.business_event.format (it is NOT in
  -- the strip list) and the only post-publish theme writer for a standard event,
  -- biz_set_event_guest_privacy, deep-merges via jsonb_set. Without this the
  -- relax in 20270427002333 soft-bricks editing: EditPublishedScreen.tsx:1162
  -- sends city as "", this NULLIFs it back to NULL, and an online event could
  -- never have its party types, vibes, genres or cover changed again.
  -- is_online is deliberately NOT the test — it is TRUE for hybrid.
  IF v_city IS NULL
     AND lower(btrim(
       COALESCE(v_event.theme->'business_event'->>'format', ''),
       E' \t\n\r\f\v' || chr(160)
     )) <> 'online' THEN
    RAISE EXCEPTION 'city_required';
  END IF;

  v_party_types  := COALESCE(p_party_types,  ARRAY[]::text[]);
  v_vibe_tags    := COALESCE(p_vibe_tags,    ARRAY[]::text[]);
  v_music_genres := COALESCE(p_music_genres, ARRAY[]::text[]);

  IF array_length(v_party_types, 1) IS NULL THEN
    RAISE EXCEPTION 'party_types_required';
  END IF;

  IF NOT (v_party_types <@ ARRAY[
    'birthday-party','rooftop-party','club-night','house-party','warehouse-party',
    'beach-party','pool-party','boat-party','themed-party','corporate-event',
    'graduation-party','holiday-party','networking-event','rave','festival'
  ]::text[]) THEN
    RAISE EXCEPTION 'party_types_not_canonical';
  END IF;

  IF NOT (v_vibe_tags <@ ARRAY[
    'energetic','chill','intimate','wild','classy','casual','upscale','underground',
    'mainstream','artsy','social','exclusive','laid-back','vibrant','retro','futuristic'
  ]::text[]) THEN
    RAISE EXCEPTION 'vibe_tags_not_canonical';
  END IF;

  IF NOT (v_music_genres <@ ARRAY[
    'electronic-edm','hiphop-rap','pop','rock','latin','afrobeats','rnb-soul',
    'disco-funk','reggae-dancehall','indie','country','jazz','classical','mixed-variety'
  ]::text[]) THEN
    RAISE EXCEPTION 'music_genres_not_canonical';
  END IF;

  IF p_location_lat IS NOT NULL AND p_location_lng IS NOT NULL THEN
    v_location_geo := point(p_location_lng, p_location_lat);
    -- issue #1363 G2: a NEW coordinate carries its precision. Normalize the
    -- token: empty/blank/unrecognised → NULL so the coordinate_precision CHECK
    -- only ever sees 'exact' | 'approximate' | NULL (a stale client can never
    -- break the patch).
    v_coordinate_precision := NULLIF(btrim(COALESCE(p_coordinate_precision, '')), '');
    IF v_coordinate_precision IS NOT NULL
       AND v_coordinate_precision NOT IN ('exact', 'approximate') THEN
      v_coordinate_precision := NULL;
    END IF;
    -- issue #3827 — the editor sends the STORED pin on every taxonomy save and
    -- (before this fix) never a precision, so the branch above wiped the
    -- stored precision on a save that moved nothing. The same pin with no
    -- valid token keeps what is stored; a valid token still wins, and a pin
    -- that actually moved behaves exactly as before.
    IF v_coordinate_precision IS NULL
       AND v_event.location_geo IS NOT NULL
       AND v_event.location_geo ~= v_location_geo THEN
      v_coordinate_precision := v_event.coordinate_precision;
    END IF;
  ELSE
    v_location_geo := v_event.location_geo;
    -- issue #1363 G2: no new coordinate → preserve the existing precision
    -- unchanged (mirrors location_geo above). An unrelated taxonomy edit never
    -- wipes a previously stored precision.
    v_coordinate_precision := v_event.coordinate_precision;
  END IF;

  -- ORCH-0824 hotfix-5: accept + write location_text (formatted address
  -- from Google Places). When null, leave the existing value unchanged.
  v_location_text := NULLIF(btrim(COALESCE(p_location_text, '')), '');
  IF v_location_text IS NULL THEN
    v_location_text := v_event.location_text;
    v_theme := v_event.theme;   -- issue #3827: NULL leaves both copies untouched
  ELSE
    -- issue #3827 — p_location_text is the STRUCTURED ADDRESS, not the label.
    -- It used to be written straight into location_text, which dropped the
    -- venue from the label and left theme.business_event.location.address
    -- (what the editor and the public page read first) holding the old
    -- address. Set the address half, then derive the label from both halves.
    v_theme := public.business_event_theme_with_location(
      v_event.theme, v_event.location_text, false, NULL, true, v_location_text);
    v_location_text := public.business_event_location_label(
      v_theme #>> '{business_event,location,venueName}',
      v_theme #>> '{business_event,location,address}');
  END IF;

  UPDATE public.events
  SET
    city = v_city,
    party_types = v_party_types,
    vibe_tags = v_vibe_tags,
    music_genres = v_music_genres,
    location_geo = v_location_geo,
    location_text = v_location_text,
    theme = v_theme,                                 -- issue #3827
    coordinate_precision = v_coordinate_precision,   -- issue #1363 G2
    updated_at = v_now
  WHERE id = p_event_id
    AND status IN ('scheduled', 'live')
    AND deleted_at IS NULL
  RETURNING * INTO v_updated;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'event_not_editable_race';
  END IF;

  RETURN jsonb_build_object(
    'event', to_jsonb(v_updated),
    'updated_at', v_now
  );
END;
$function$;


-- ---------------------------------------------------------------------------
-- business_update_live_event
--   Body: 20270429002353_issue_2353_format_truth_and_edit_grant.sql:298-434.
--   Hunks: the location resolution and derived label, and hideAddressUntilTicket
--   written to the direct child. Every #2353 format hunk is carried unchanged.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.business_update_live_event(
  p_event_id uuid,
  p_patch jsonb,
  p_reason text,
  p_client_revision integer DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE
  v_uid uuid:=auth.uid();
  v_event public.events%ROWTYPE;
  v_ticket jsonb;
  v_ticket_id uuid;
  v_sold integer;
  v_seen uuid[]:=ARRAY[]::uuid[];
  v_settings jsonb;
  v_tickets jsonb;
  v_stored_revision integer;
  -- issue #3827 — the structured location this patch resolves to.
  v_set_venue boolean:=false;
  v_set_address boolean:=false;
  v_venue text;
  v_address text;
  v_location_theme jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated';END IF;
  IF length(btrim(COALESCE(p_reason,''))) NOT BETWEEN 10 AND 200 THEN RAISE EXCEPTION 'invalid_edit_reason';END IF;
  SELECT * INTO v_event FROM public.events WHERE id=p_event_id FOR UPDATE;
  IF NOT FOUND OR v_event.deleted_at IS NOT NULL OR v_event.event_type<>'event' THEN RAISE EXCEPTION 'event_not_found';END IF;
  IF v_event.status NOT IN('scheduled','live') THEN RAISE EXCEPTION 'event_not_editable_status';END IF;
  IF public.biz_brand_effective_rank(v_event.brand_id,v_uid)<public.biz_role_rank('event_manager') THEN RAISE EXCEPTION 'insufficient_event_permission';END IF;
  v_stored_revision:=COALESCE((v_event.theme#>>'{business_event,clientRevision}')::integer,0);
  IF p_client_revision IS NULL OR p_client_revision<>v_stored_revision+1 THEN
    RAISE EXCEPTION 'stale_client_revision';
  END IF;

  v_settings:=COALESCE(v_event.theme#>'{business_event,settings}','{}'::jsonb);
  -- issue #3827 — hideAddressUntilTicket is a DIRECT child of business_event:
  -- every reader looks there and none reads settings. This line used to write
  -- the settings child, so a host switching the toggle changed nothing. The
  -- direct child is written in the UPDATE below; the stale settings copy is
  -- dropped here so the two can never disagree again.
  IF p_patch ? 'hideAddressUntilTicket' THEN v_settings:=v_settings-'hideAddressUntilTicket';END IF;
  IF p_patch ? 'requireApproval' THEN v_settings:=jsonb_set(v_settings,'{requireApproval}',p_patch->'requireApproval',true);END IF;
  IF p_patch ? 'allowTransfers' THEN v_settings:=jsonb_set(v_settings,'{allowTransfers}',p_patch->'allowTransfers',true);END IF;
  IF p_patch ? 'passwordProtected' THEN v_settings:=jsonb_set(v_settings,'{passwordProtected}',p_patch->'passwordProtected',true);END IF;
  IF p_patch ? 'inPersonPaymentsEnabled' THEN v_settings:=jsonb_set(v_settings,'{inPersonPaymentsEnabled}',p_patch->'inPersonPaymentsEnabled',true);END IF;

  -- issue #3827 — ONE owner for the location. The row is locked above, so
  -- v_event is the row this UPDATE writes.
  --   venueName only      : set the venue half; the stored address is kept.
  --   address only (Ari)  : whole-location replace, venueName = the text and
  --                         address = NULL, the shape Ari create writes.
  --   both                : structured, each half as given.
  IF p_patch ? 'venueName' THEN
    v_set_venue:=true;
    v_venue:=p_patch->>'venueName';
    IF p_patch ? 'address' THEN
      v_set_address:=true;
      v_address:=p_patch->>'address';
    END IF;
  ELSIF p_patch ? 'address' THEN
    v_set_venue:=true;
    v_venue:=p_patch->>'address';
    v_set_address:=true;
    v_address:=NULL;
  END IF;
  v_location_theme:=public.business_event_theme_with_location(
    v_event.theme,v_event.location_text,v_set_venue,v_venue,v_set_address,v_address);

  UPDATE public.events SET
    title=CASE WHEN p_patch ? 'name' THEN NULLIF(btrim(p_patch->>'name'),'') ELSE title END,
    description=CASE WHEN p_patch ? 'description' THEN NULLIF(p_patch->>'description','') ELSE description END,
    -- issue #3827 — the label is DERIVED from the two stored halves, never
    -- assigned from one of them (that dropped the other half on every save).
    location_text=CASE WHEN v_set_venue OR v_set_address
      THEN public.business_event_location_label(
        v_location_theme#>>'{business_event,location,venueName}',
        v_location_theme#>>'{business_event,location,address}')
      ELSE location_text END,
    online_url=CASE WHEN p_patch ? 'onlineUrl' THEN NULLIF(p_patch->>'onlineUrl','') ELSE online_url END,
    -- issue #2353 — `= 'online'` set is_online FALSE for a hybrid patch,
    -- contradicting the client's own contract (is_online = online||hybrid).
    -- The client ships `format` on EVERY core patch
    -- (ISSUE_1972_CORE_PATCH_KEYS, EditPublishedScreen.tsx:231-246), so this
    -- fired on every hybrid save. Unrecognised values leave both columns
    -- untouched rather than resolving to a guess.
    is_online=CASE
      WHEN lower(btrim(COALESCE(p_patch->>'format',''), E' \t\n\r\f\v'||chr(160))) IN ('in_person','online','hybrid')
      THEN lower(btrim(p_patch->>'format', E' \t\n\r\f\v'||chr(160))) IN ('online','hybrid')
      ELSE is_online END,
    visibility=CASE WHEN p_patch ? 'visibility' THEN CASE p_patch->>'visibility' WHEN 'unlisted' THEN 'hidden' WHEN 'private' THEN 'private' ELSE 'public' END ELSE visibility END,
    -- issue #3827 — the #2353/#1972 theme expression is unchanged and is now
    -- the INPUT (t.x) of two additions: the location halves, and the
    -- hideAddressUntilTicket direct child. Both merge a rebuilt namespace, so
    -- neither is a silent no-op on a row with no business_event object.
    theme=(SELECT CASE WHEN p_patch ? 'hideAddressUntilTicket'
        THEN t.x || jsonb_build_object(
               'business_event',
               CASE WHEN jsonb_typeof(t.x->'business_event')='object'
                 THEN t.x->'business_event' ELSE '{}'::jsonb END
               || jsonb_build_object('hideAddressUntilTicket',p_patch->'hideAddressUntilTicket'))
        ELSE t.x END
      FROM (SELECT public.business_event_theme_with_location(
    jsonb_set(
      jsonb_set(
        jsonb_set(
          -- issue #2353 — this function wrote the DERIVED column (is_online)
          -- and never its SOURCE OF TRUTH. An in_person -> hybrid change
          -- updated is_online and left theme.business_event.format stale, so
          -- S2's stored-first read would faithfully return the STALE value and
          -- the format change would vanish on the next Unpublish/Duplicate.
          -- Fixing S2 without this converts a wrong-derivation bug into a
          -- stale-data bug. The two move together.
          -- issue #2353 — and jsonb_set creates only the FINAL element of a
          -- path, so on a live row whose theme carries no `business_event`
          -- object at all the format write was a SILENT NO-OP while the
          -- is_online projection above still fired: the host set Hybrid,
          -- is_online flipped true, nothing was stored, and S2's stored-first
          -- read reported `online` on the very next load. That is the original
          -- defect, intact, on that one row shape. Merging a rebuilt namespace
          -- onto the theme creates it when absent and preserves every sibling
          -- key when present. Scoped to the format arm on purpose: the
          -- {business_event,settings} and {business_event,clientRevision}
          -- jsonb_set calls below are #1972's and are left exactly as written.
          CASE WHEN lower(btrim(COALESCE(p_patch->>'format',''), E' \t\n\r\f\v'||chr(160))) IN ('in_person','online','hybrid')
            THEN COALESCE(theme,'{}'::jsonb) || jsonb_build_object(
                   'business_event',
                   CASE WHEN jsonb_typeof(theme->'business_event')='object'
                     THEN theme->'business_event' ELSE '{}'::jsonb END
                   || jsonb_build_object('format',lower(btrim(p_patch->>'format', E' \t\n\r\f\v'||chr(160)))))
            ELSE COALESCE(theme,'{}'::jsonb) END,
          '{business_event,settings}',v_settings,true),
        '{business_event,clientRevision}',to_jsonb(p_client_revision),true),
      '{coverHue}',COALESCE(p_patch->'coverHue',theme->'coverHue','25'::jsonb),true),
      location_text,v_set_venue,v_venue,v_set_address,v_address) AS x) AS t),   -- issue #3827
    updated_at=now()
  WHERE id=p_event_id RETURNING * INTO v_event;

  IF p_patch ? 'tickets' THEN
    IF jsonb_typeof(p_patch->'tickets') IS DISTINCT FROM 'array' OR jsonb_array_length(p_patch->'tickets')=0 THEN RAISE EXCEPTION 'event_ticket_required';END IF;
    FOR v_ticket IN SELECT value FROM jsonb_array_elements(p_patch->'tickets') LOOP
      v_ticket_id:=CASE WHEN COALESCE(v_ticket->>'id','')~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN (v_ticket->>'id')::uuid ELSE gen_random_uuid() END;
      SELECT count(*) INTO v_sold FROM public.tickets WHERE ticket_type_id=v_ticket_id AND status NOT IN('void','refunded');
      IF EXISTS(SELECT 1 FROM public.ticket_types WHERE id=v_ticket_id AND event_id=p_event_id AND deleted_at IS NULL) THEN
        IF v_sold>0 AND EXISTS(SELECT 1 FROM public.ticket_types tt WHERE tt.id=v_ticket_id AND (tt.price_cents IS DISTINCT FROM round(COALESCE((v_ticket->>'priceGbp')::numeric,0)*100)::integer OR COALESCE((v_ticket->>'capacity')::integer,tt.quantity_total)<v_sold)) THEN RAISE EXCEPTION 'ticket_change_with_sales';END IF;
        UPDATE public.ticket_types SET
          name=COALESCE(NULLIF(btrim(v_ticket->>'name'),''),name), description=NULLIF(v_ticket->>'description',''),
          price_cents=round(COALESCE((v_ticket->>'priceGbp')::numeric,0)*100)::integer,
          quantity_total=CASE WHEN COALESCE((v_ticket->>'isUnlimited')::boolean,false) THEN NULL ELSE (v_ticket->>'capacity')::integer END,
          is_unlimited=COALESCE((v_ticket->>'isUnlimited')::boolean,false),is_free=COALESCE((v_ticket->>'isFree')::boolean,false),
          is_hidden=COALESCE(v_ticket->>'visibility','public')='hidden',is_disabled=COALESCE(v_ticket->>'visibility','public')='disabled',
          requires_approval=COALESCE((v_ticket->>'approvalRequired')::boolean,false),allow_transfers=COALESCE((v_ticket->>'allowTransfers')::boolean,true),
          password_protected=COALESCE((v_ticket->>'passwordProtected')::boolean,false),waitlist_enabled=COALESCE((v_ticket->>'waitlistEnabled')::boolean,false),
          min_purchase_qty=COALESCE((v_ticket->>'minPurchaseQty')::integer,1),max_purchase_qty=NULLIF(v_ticket->>'maxPurchaseQty','')::integer,
          sale_start_at=NULLIF(v_ticket->>'saleStartAt','')::timestamptz,sale_end_at=NULLIF(v_ticket->>'saleEndAt','')::timestamptz,
          available_online=COALESCE(v_ticket->>'availableAt','both') IN('online','both'),available_in_person=COALESCE(v_ticket->>'availableAt','both') IN('door','both'),
          display_order=COALESCE((v_ticket->>'displayOrder')::integer,0),updated_at=now()
        WHERE id=v_ticket_id;
      ELSE
        INSERT INTO public.ticket_types(id,event_id,name,description,price_cents,currency,quantity_total,is_unlimited,is_free,is_hidden,is_disabled,
          requires_approval,allow_transfers,password_protected,waitlist_enabled,min_purchase_qty,max_purchase_qty,sale_start_at,sale_end_at,
          available_online,available_in_person,display_order)
        VALUES(v_ticket_id,p_event_id,COALESCE(NULLIF(btrim(v_ticket->>'name'),''),'Ticket'),NULLIF(v_ticket->>'description',''),
          round(COALESCE((v_ticket->>'priceGbp')::numeric,0)*100)::integer,v_event.currency,
          CASE WHEN COALESCE((v_ticket->>'isUnlimited')::boolean,false) THEN NULL ELSE (v_ticket->>'capacity')::integer END,
          COALESCE((v_ticket->>'isUnlimited')::boolean,false),COALESCE((v_ticket->>'isFree')::boolean,false),
          COALESCE(v_ticket->>'visibility','public')='hidden',COALESCE(v_ticket->>'visibility','public')='disabled',
          COALESCE((v_ticket->>'approvalRequired')::boolean,false),COALESCE((v_ticket->>'allowTransfers')::boolean,true),
          COALESCE((v_ticket->>'passwordProtected')::boolean,false),COALESCE((v_ticket->>'waitlistEnabled')::boolean,false),
          COALESCE((v_ticket->>'minPurchaseQty')::integer,1),NULLIF(v_ticket->>'maxPurchaseQty','')::integer,
          NULLIF(v_ticket->>'saleStartAt','')::timestamptz,NULLIF(v_ticket->>'saleEndAt','')::timestamptz,
          COALESCE(v_ticket->>'availableAt','both') IN('online','both'),COALESCE(v_ticket->>'availableAt','both') IN('door','both'),
          COALESCE((v_ticket->>'displayOrder')::integer,0));
      END IF;
      v_seen:=array_append(v_seen,v_ticket_id);
    END LOOP;
    IF EXISTS(SELECT 1 FROM public.ticket_types tt JOIN public.tickets t ON t.ticket_type_id=tt.id WHERE tt.event_id=p_event_id AND tt.deleted_at IS NULL AND NOT(tt.id=ANY(v_seen)) AND t.status NOT IN('void','refunded')) THEN RAISE EXCEPTION 'ticket_delete_with_sales';END IF;
    UPDATE public.ticket_types SET deleted_at=now(),is_disabled=true,updated_at=now() WHERE event_id=p_event_id AND deleted_at IS NULL AND NOT(id=ANY(v_seen));
  END IF;

  IF p_patch ? 'privateGuestList' OR p_patch ? 'hideRemainingCount' THEN
    PERFORM public.biz_set_event_guest_privacy(p_event_id,
      COALESCE((p_patch->>'privateGuestList')::boolean,(v_settings->>'privateGuestList')::boolean,false),
      COALESCE((p_patch->>'hideRemainingCount')::boolean,(v_settings->>'hideRemainingCount')::boolean,false));
    SELECT * INTO v_event FROM public.events WHERE id=p_event_id;
  END IF;
  SELECT COALESCE(jsonb_agg(to_jsonb(tt) ORDER BY tt.display_order,tt.created_at),'[]'::jsonb) INTO v_tickets FROM public.ticket_types tt WHERE tt.event_id=p_event_id AND tt.deleted_at IS NULL;
  RETURN jsonb_build_object('event',to_jsonb(v_event),'tickets',v_tickets,'client_revision',p_client_revision);
END;$fn$;


-- ---------------------------------------------------------------------------
-- business_update_live_event_atomic
--   Body: 20270701003288_issue_3288_gallery_absent_key_preserves.sql:1124-1258.
--   Hunks: the resolved reason, handed to the three unchanged leaves.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.business_update_live_event_atomic(
  p_event_id uuid,p_patch jsonb,p_reason text,p_client_revision integer
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE
  v_core jsonb:=COALESCE(p_patch->'core','{}'::jsonb);
  v_core_without_tickets jsonb:=COALESCE(p_patch->'core','{}'::jsonb)-'tickets';
  v_taxonomy jsonb:=p_patch->'taxonomy';
  v_when jsonb:=p_patch->'when';
  v_cover jsonb:=p_patch->'cover';
  v_selection public.event_cover_selections%ROWTYPE;
  v_event public.events%ROWTYPE;
  v_tickets jsonb;
  v_item jsonb;
  v_mode text;
  v_timezone text;
  v_local_when jsonb;
  v_pricing_patch jsonb:='{}'::jsonb;
  v_reason text;   -- issue #3827
BEGIN
  -- issue #3827 — a reason is owed to BUYERS. With none, a blank reason is
  -- recorded as the stated constant; with one or more it is still refused.
  -- The core, tier and when leaves below are unchanged and still validate
  -- what they are handed, which is now the resolved reason.
  v_reason:=public.business_resolve_edit_reason(p_event_id,p_reason);
  IF v_reason IS NULL THEN RAISE EXCEPTION 'invalid_edit_reason';END IF;
  IF v_core ? 'visibility'
     AND COALESCE(v_core->>'visibility','') NOT IN('public','unlisted','private') THEN
    RAISE EXCEPTION 'event_visibility_invalid';
  END IF;
  PERFORM public.business_update_live_event(
    p_event_id,v_core_without_tickets,v_reason,p_client_revision   -- issue #3827
  );
  IF v_core ? 'tickets' THEN
    PERFORM public.business_patch_event_ticket_tiers(
      p_event_id,v_core->'tickets',NULL,NULL,NULL,v_reason   -- issue #3827
    );
  END IF;

  IF v_taxonomy IS NOT NULL THEN
    PERFORM public.business_patch_event_taxonomy(
      p_event_id,
      v_taxonomy->>'city',
      ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_taxonomy->'partyTypes','[]'::jsonb))),
      ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_taxonomy->'vibeTags','[]'::jsonb))),
      ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_taxonomy->'musicGenres','[]'::jsonb))),
      NULLIF(v_taxonomy#>>'{locationGeo,lat}','')::numeric,
      NULLIF(v_taxonomy#>>'{locationGeo,lng}','')::numeric,
      NULLIF(v_taxonomy->>'locationText',''),
      COALESCE(v_taxonomy->>'coordinatePrecision','')
    );
  END IF;

  IF v_when IS NOT NULL THEN
    v_mode:=COALESCE(NULLIF(v_when->>'whenMode',''),'single');
    v_timezone:=COALESCE(NULLIF(v_when->>'timezone',''),
      (SELECT timezone FROM public.events WHERE id=p_event_id),'UTC');
    IF v_mode IN('single','recurring') THEN
      v_local_when:=v_when->'when';
      PERFORM public.business_resolve_event_local_datetime(
        v_local_when->>'date',COALESCE(NULLIF(v_local_when->>'doorsOpen',''),'00:00'),v_timezone
      );
      PERFORM public.business_resolve_event_local_datetime(
        v_local_when->>'date',COALESCE(NULLIF(v_local_when->>'endsAt',''),
          COALESCE(NULLIF(v_local_when->>'doorsOpen',''),'00:00')),v_timezone
      );
    ELSIF v_mode='multi_date' THEN
      FOR v_item IN SELECT value FROM jsonb_array_elements(COALESCE(v_when->'multiDates','[]'::jsonb)) LOOP
        PERFORM public.business_resolve_event_local_datetime(
          v_item->>'date',COALESCE(NULLIF(v_item->>'startTime',''),'00:00'),v_timezone
        );
        PERFORM public.business_resolve_event_local_datetime(
          v_item->>'date',COALESCE(NULLIF(v_item->>'endTime',''),
            COALESCE(NULLIF(v_item->>'startTime',''),'00:00')),v_timezone
        );
      END LOOP;
    END IF;
    PERFORM public.business_patch_event_when(
      p_event_id,v_when,v_reason,p_client_revision   -- issue #3827
    );
  END IF;

  IF p_patch ? 'theme' THEN
    UPDATE public.events SET
      theme_color_override=NULLIF(p_patch#>>'{theme,color}',''),
      theme_font_override=NULLIF(p_patch#>>'{theme,font}',''),
      theme_animation_override=NULLIF(p_patch#>>'{theme,animation}',''),
      updated_at=now()
    WHERE id=p_event_id;
  END IF;

  IF p_patch ? 'pricing' THEN
    IF p_patch->'pricing' ? 'passTax' THEN
      v_pricing_patch:=v_pricing_patch || jsonb_build_object('pass_tax',p_patch#>'{pricing,passTax}');
    END IF;
    IF p_patch->'pricing' ? 'passMinglaFee' THEN
      v_pricing_patch:=v_pricing_patch || jsonb_build_object('pass_mingla_fee',p_patch#>'{pricing,passMinglaFee}');
    END IF;
    IF p_patch->'pricing' ? 'passServiceFee' THEN
      v_pricing_patch:=v_pricing_patch || jsonb_build_object('pass_service_fee',p_patch#>'{pricing,passServiceFee}');
    END IF;
    PERFORM public.business_patch_pricing_switches(p_event_id,v_pricing_patch);
  END IF;

  IF v_cover IS NOT NULL THEN
    IF COALESCE((v_cover->>'clear')::boolean,false) THEN
      PERFORM public.business_clear_event_cover_media(p_event_id);
    ELSE
      SELECT * INTO v_selection FROM public.event_cover_selections
      WHERE selection_ref=v_cover->>'selectionRef'
        AND user_id=auth.uid() AND event_id=p_event_id
        AND consumed_at IS NULL AND expires_at>now() FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'cover_selection_unverified';END IF;
      PERFORM public.business_set_event_cover_media(
        p_event_id,v_selection.selection_ref,v_selection.media_url,
        v_selection.media_type,v_selection.poster_url,v_selection.provider,
        v_selection.source_url,v_selection.credit,v_selection.credit_url,
        v_selection.alt
      );
    END IF;
  END IF;

  -- issue #3288 — the additional photos. AFTER the cover block, so a save that
  -- removes the cover and edits the gallery keeps the new gallery. The caller
  -- is already authenticated, role-checked and revision-checked by
  -- business_update_live_event above; the column CHECK enforces the array shape.
  IF p_patch ? 'gallery' THEN
    UPDATE public.events SET
      cover_media_gallery=COALESCE(p_patch->'gallery','[]'::jsonb),
      updated_at=now()
    WHERE id=p_event_id;
  END IF;

  SELECT * INTO v_event FROM public.events WHERE id=p_event_id;
  SELECT COALESCE(jsonb_agg(to_jsonb(tt) ORDER BY tt.display_order,tt.created_at),'[]'::jsonb)
    INTO v_tickets FROM public.ticket_types tt
    WHERE tt.event_id=p_event_id AND tt.deleted_at IS NULL;
  RETURN jsonb_build_object(
    'event',to_jsonb(v_event),'tickets',v_tickets,
    'client_revision',p_client_revision
  );
END;$fn$;


-- ---------------------------------------------------------------------------
-- biz_update_live_rsvp
--   Body: 20261222000000_orch_1296_rsvp_edit_chip_in.sql:47-317.
--   Hunks: the reason resolver, and the optional structured `location` key.
--   The (uuid, jsonb, text) signature and the stripe_charges_disabled refusal
--   that business_update_rsvp_graph delegates to are untouched.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.biz_update_live_rsvp(
  p_event_id uuid,
  p_payload jsonb,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_user_id        uuid;
  v_existing       public.events%ROWTYPE;
  v_brand          record;
  v_now            timestamptz := now();
  v_trimmed_reason text;
  v_title          text;
  v_description    text;
  v_location_text  text;
  v_online_url     text;
  v_timezone       text;
  v_visibility     text;
  v_when           jsonb;
  v_date_iso       text;
  v_doors          text;
  v_ends           text;
  v_new_start      timestamptz;
  v_new_end        timestamptz;
  v_old_start      timestamptz;
  v_rsvp_capacity  integer;
  v_rsvp_allow_plus_ones boolean;
  v_rsvp_plus_ones_max integer;
  v_rsvp_waitlist_enabled boolean;
  v_rsvp_approval_mode text;
  v_rsvp_discoverable boolean;
  v_material_change boolean := false;
  v_going_count    integer;
  v_notified_count integer := 0;
  v_event          public.events%ROWTYPE;
  v_guest          record;
  -- ORCH-1172 — theme.business_event.settings privacy toggles.
  v_private_guest_list boolean;
  v_hide_remaining_count boolean;
  -- ORCH-1172 R2 — theme.business_event.hideAddressUntilTicket (direct child).
  v_hide_address boolean;
  v_theme          jsonb;
  v_settings       jsonb;
  -- ORCH-1296 [chip-in-edit-published-gap] — voluntary chip-in config on EDIT.
  v_rsvp_contribution_enabled boolean;
  v_rsvp_contribution_suggested_cents integer;
  v_rsvp_contribution_min_cents integer;
  -- issue #3827 — structured location (optional `location` payload key).
  v_location_structured boolean := false;
  v_location_venue text;
  v_location_address text;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  v_trimmed_reason := btrim(COALESCE(p_reason, ''));
  -- issue #3827 — the reason check is the shared resolver: a 10 to 200
  -- character reason passes as before (business_update_rsvp_graph always
  -- hands one over), a blank reason passes only when nobody has RSVP'd or
  -- paid, and both refusals keep their existing answers.
  IF public.business_resolve_edit_reason(p_event_id, p_reason) IS NULL THEN
    IF v_trimmed_reason = '' THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'missing_edit_reason');
    END IF;
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_edit_reason');
  END IF;

  SELECT * INTO v_existing FROM public.events
   WHERE id = p_event_id AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'rsvp_not_found';
  END IF;
  IF v_existing.event_type <> 'rsvp' THEN
    RAISE EXCEPTION 'event_not_an_rsvp'
      USING HINT = 'biz_update_live_rsvp only handles event_type=rsvp rows.';
  END IF;
  IF v_existing.status NOT IN ('scheduled', 'live') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'rsvp_not_editable_status');
  END IF;
  IF public.biz_brand_effective_rank(v_existing.brand_id, v_user_id) < public.biz_role_rank('event_manager'::text) THEN
    RAISE EXCEPTION 'insufficient_event_permission';
  END IF;

  SELECT id, slug, name INTO v_brand FROM public.brands
   WHERE id = v_existing.brand_id AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'brand_not_found';
  END IF;

  v_title := NULLIF(btrim(COALESCE(p_payload->>'title', '')), '');
  IF v_title IS NULL THEN
    RAISE EXCEPTION 'rsvp_title_required';
  END IF;
  v_description := NULLIF(p_payload->>'description', '');
  v_location_text := NULLIF(p_payload->>'location_text', '');
  -- issue #3827 — this function wrote the label only, while the editor and
  -- the public page read theme.business_event.location first, so an edited
  -- venue or address came straight back as the old one. When the payload
  -- carries `location` as an object, both halves are written (below) and the
  -- label is DERIVED from them here, ahead of the material-change compare.
  -- Without the key (an older client) the behaviour is exactly as before.
  IF jsonb_typeof(p_payload->'location') = 'object' THEN
    v_location_structured := true;
    v_location_venue := p_payload #>> '{location,venueName}';
    v_location_address := p_payload #>> '{location,address}';
    v_location_text := public.business_event_location_label(v_location_venue, v_location_address);
  END IF;
  v_online_url := NULLIF(p_payload->>'online_url', '');
  v_timezone := COALESCE(NULLIF(p_payload->>'timezone', ''), v_existing.timezone, 'UTC');

  v_visibility := CASE COALESCE(p_payload->>'requestedVisibility', NULL)
    WHEN 'private' THEN 'private'
    WHEN 'unlisted' THEN 'hidden'
    WHEN 'public' THEN 'public'
    ELSE v_existing.visibility
  END;

  -- RSVP host-control (default to existing when key absent).
  v_rsvp_capacity := CASE WHEN p_payload ? 'rsvpCapacity'
    THEN NULLIF(p_payload->>'rsvpCapacity', '')::integer ELSE v_existing.rsvp_capacity END;
  v_rsvp_allow_plus_ones := COALESCE((p_payload->>'rsvpAllowPlusOnes')::boolean, v_existing.rsvp_allow_plus_ones);
  v_rsvp_plus_ones_max := COALESCE(NULLIF(p_payload->>'rsvpPlusOnesMax', '')::integer, v_existing.rsvp_plus_ones_max);
  v_rsvp_waitlist_enabled := COALESCE((p_payload->>'rsvpWaitlistEnabled')::boolean, v_existing.rsvp_waitlist_enabled);
  v_rsvp_approval_mode := COALESCE(NULLIF(p_payload->>'rsvpApprovalMode', ''), v_existing.rsvp_approval_mode);
  IF v_rsvp_approval_mode NOT IN ('auto', 'manual') THEN
    RAISE EXCEPTION 'rsvp_approval_mode_invalid';
  END IF;
  v_rsvp_discoverable := COALESCE((p_payload->>'rsvpDiscoverable')::boolean, v_existing.rsvp_discoverable);
  IF v_visibility = 'private' THEN
    v_rsvp_discoverable := false;
  END IF;

  -- ORCH-1296 [chip-in-edit-published-gap] — voluntary chip-in config reads.
  -- Default each to the currently STORED value when the key is ABSENT: the client
  -- sends a diff payload (a chip-in field only when the organiser changed it), so
  -- an unrelated edit must keep the stored config untouched (mirrors the rsvp_*
  -- COALESCE-to-existing pattern above). enabled is a NOT NULL column; the two
  -- amount columns are nullable (present-but-null clears them).
  v_rsvp_contribution_enabled := COALESCE(
    (p_payload->>'rsvpContributionEnabled')::boolean,
    v_existing.rsvp_contribution_enabled,
    false);
  v_rsvp_contribution_suggested_cents := CASE
    WHEN p_payload ? 'rsvpContributionSuggestedCents'
      THEN NULLIF(p_payload->>'rsvpContributionSuggestedCents', '')::integer
    ELSE v_existing.rsvp_contribution_suggested_cents END;
  v_rsvp_contribution_min_cents := CASE
    WHEN p_payload ? 'rsvpContributionMinCents'
      THEN NULLIF(p_payload->>'rsvpContributionMinCents', '')::integer
    ELSE v_existing.rsvp_contribution_min_cents END;

  -- ORCH-1296 — CONDITIONAL PROVIDER-AWARE bank-gate on EDIT (mirrors
  -- business_publish_rsvp_draft, ORCH-1291). Enabling chip-in flips the RSVP into
  -- a money-collector → the brand MUST be able to collect on EITHER rail.
  -- pg_brand_can_collect is provider-aware (Stripe charges_enabled OR Paystack
  -- subaccount) — reusing the Stripe-only pg_brand_can_charge here would wrongly
  -- block every NGN brand. The gate is CONDITIONAL: when chip-in resolves OFF it
  -- NEVER fires (an organiser can always turn chip-in off; free RSVPs stay
  -- ungated). Raises the ORCH-1075-recognized 'stripe_charges_disabled' reason.
  IF v_rsvp_contribution_enabled AND NOT public.pg_brand_can_collect(v_existing.brand_id) THEN
    RAISE EXCEPTION 'stripe_charges_disabled'
      USING HINT = 'RSVP chip-in is enabled but the brand cannot collect (no connected bank / subaccount).';
  END IF;

  -- Single-date when (optional in payload; default to existing master).
  SELECT start_at INTO v_old_start FROM public.event_dates
   WHERE event_id = p_event_id AND is_master = true LIMIT 1;

  v_when := p_payload->'when';
  IF v_when IS NOT NULL AND NULLIF(v_when->>'date', '') IS NOT NULL THEN
    v_date_iso := NULLIF(v_when->>'date', '');
    v_doors := COALESCE(NULLIF(v_when->>'doorsOpen', ''), '00:00');
    v_ends := COALESCE(NULLIF(v_when->>'endsAt', ''), v_doors);
    v_new_start := (v_date_iso || ' ' || v_doors || ':00')::timestamp AT TIME ZONE v_timezone;
    v_new_end := (v_date_iso || ' ' || v_ends || ':00')::timestamp AT TIME ZONE v_timezone;
    IF v_new_end <= v_new_start THEN
      v_new_end := v_new_end + INTERVAL '1 day';
    END IF;
    DELETE FROM public.event_dates WHERE event_id = p_event_id;
    INSERT INTO public.event_dates (event_id, start_at, end_at, timezone, is_master)
    VALUES (p_event_id, v_new_start, v_new_end, v_timezone, true);
    IF v_old_start IS DISTINCT FROM v_new_start THEN
      v_material_change := true;
    END IF;
  END IF;

  -- Material change = date/time OR venue/location text changed.
  IF v_location_text IS DISTINCT FROM v_existing.location_text THEN
    v_material_change := true;
  END IF;

  -- ORCH-1172 — deep-merge the two privacy toggles into
  -- theme.business_event.settings, PRESERVING every other theme key and every
  -- other settings key. jsonb_set with create_missing=true builds the nested
  -- path if it doesn't exist yet (e.g. a legacy row that never had a settings
  -- object), and only ever replaces the two leaf keys we own.
  v_theme := COALESCE(v_existing.theme, '{}'::jsonb);
  v_private_guest_list := COALESCE(
    (p_payload->>'privateGuestList')::boolean,
    (v_theme #>> '{business_event,settings,privateGuestList}')::boolean,
    false);
  v_hide_remaining_count := COALESCE(
    (p_payload->>'hideRemainingCount')::boolean,
    (v_theme #>> '{business_event,settings,hideRemainingCount}')::boolean,
    false);
  -- ORCH-1172 R2 — hideAddressUntilTicket lives at
  -- theme.business_event.hideAddressUntilTicket (a DIRECT child of
  -- business_event, NOT under settings). Same default-to-existing pattern.
  v_hide_address := COALESCE(
    (p_payload->>'hideAddressUntilTicket')::boolean,
    (v_theme #>> '{business_event,hideAddressUntilTicket}')::boolean,
    false);

  v_settings := COALESCE(v_theme #> '{business_event,settings}', '{}'::jsonb);
  v_settings := jsonb_set(v_settings, '{privateGuestList}', to_jsonb(v_private_guest_list), true);
  v_settings := jsonb_set(v_settings, '{hideRemainingCount}', to_jsonb(v_hide_remaining_count), true);
  -- Ensure the business_event container exists before writing into it.
  IF v_theme -> 'business_event' IS NULL OR jsonb_typeof(v_theme -> 'business_event') <> 'object' THEN
    v_theme := jsonb_set(v_theme, '{business_event}', '{}'::jsonb, true);
  END IF;
  v_theme := jsonb_set(v_theme, '{business_event,settings}', v_settings, true);
  -- ORCH-1172 R2 — write the hideAddressUntilTicket leaf directly under
  -- business_event (NOT under settings). The container guard above already ran,
  -- so business_event is a guaranteed object; this replaces ONLY that one leaf
  -- and leaves settings + every other business_event/theme key untouched.
  v_theme := jsonb_set(v_theme, '{business_event,hideAddressUntilTicket}', to_jsonb(v_hide_address), true);
  -- issue #3827 — write both structured halves beside the derived label.
  IF v_location_structured THEN
    v_theme := public.business_event_theme_with_location(
      v_theme, v_existing.location_text, true, v_location_venue, true, v_location_address);
  END IF;

  UPDATE public.events
  SET
    title = v_title,
    description = v_description,
    location_text = v_location_text,
    online_url = v_online_url,
    cover_media_url = NULLIF(p_payload->>'cover_media_url', ''),
    cover_media_type = NULLIF(p_payload->>'cover_media_type', ''),
    visibility = v_visibility,
    timezone = v_timezone,
    rsvp_capacity = v_rsvp_capacity,
    rsvp_allow_plus_ones = v_rsvp_allow_plus_ones,
    rsvp_plus_ones_max = CASE WHEN v_rsvp_allow_plus_ones THEN GREATEST(v_rsvp_plus_ones_max, 0) ELSE 0 END,
    rsvp_waitlist_enabled = v_rsvp_waitlist_enabled,
    rsvp_approval_mode = v_rsvp_approval_mode,
    rsvp_discoverable = v_rsvp_discoverable,
    -- ORCH-1296 — persist the voluntary chip-in config on EDIT.
    rsvp_contribution_enabled = v_rsvp_contribution_enabled,
    rsvp_contribution_suggested_cents = v_rsvp_contribution_suggested_cents,
    rsvp_contribution_min_cents = v_rsvp_contribution_min_cents,
    theme = v_theme,
    updated_at = v_now
  WHERE id = p_event_id;

  -- Enqueue rsvp_event_updated for every going+approved guest on material change.
  IF v_material_change THEN
    FOR v_guest IN
      SELECT r.id FROM public.event_rsvps r
       WHERE r.event_id = p_event_id
         AND r.rsvp_status = 'going' AND r.approval_status = 'approved'
    LOOP
      INSERT INTO public.rsvp_notifications
        (event_id, rsvp_id, channel, recipient, status, template_key, payload,
         idempotency_key, attempt_count)
      VALUES
        (p_event_id, v_guest.id, NULL, NULL, 'pending', 'rsvp_event_updated',
         jsonb_build_object('template_key', 'rsvp_event_updated',
                            'rsvp_id', v_guest.id, 'event_id', p_event_id),
         'rsvp_update:' || p_event_id::text || ':' || extract(epoch FROM v_now)::bigint::text
           || ':' || v_guest.id::text,
         0)
      ON CONFLICT (idempotency_key) DO NOTHING;
      v_notified_count := v_notified_count + 1;
    END LOOP;
  END IF;

  SELECT * INTO v_event FROM public.events WHERE id = p_event_id;
  SELECT COALESCE(SUM(1 + plus_count), 0) INTO v_going_count
    FROM public.event_rsvps
   WHERE event_id = p_event_id AND rsvp_status = 'going' AND approval_status = 'approved';

  RETURN jsonb_build_object(
    'ok', true,
    'event', to_jsonb(v_event),
    'going_count', v_going_count,
    'notified_count', v_notified_count
  );
END;
$$;


-- Fail the migration, not a later save, if a body is not what was meant.
DO $verify$
DECLARE
  v_src text;
BEGIN
  -- The composer agrees with the Host app's on the cases that matter.
  IF public.business_event_location_label('Lantern Room', '61 Wythe Avenue') IS DISTINCT FROM 'Lantern Room · 61 Wythe Avenue'
     OR public.business_event_location_label('  ', '61 Wythe Avenue') IS DISTINCT FROM '61 Wythe Avenue'
     OR public.business_event_location_label('Lantern Room', NULL) IS DISTINCT FROM 'Lantern Room'
     OR public.business_event_location_label(NULL, E' \t' || chr(160)) IS NOT NULL THEN
    RAISE EXCEPTION 'issue_3827_verify: business_event_location_label does not compose the label as specified';
  END IF;
  IF public.business_event_theme_with_location(NULL, 'Old label', false, NULL, true, 'New address')
       #> '{business_event,location}'
     IS DISTINCT FROM jsonb_build_object('venueName', 'Old label', 'address', 'New address') THEN
    RAISE EXCEPTION 'issue_3827_verify: business_event_theme_with_location does not create the namespace and seed the venue';
  END IF;

  -- Who may call the helpers.
  IF pg_catalog.has_function_privilege('anon', 'public.business_event_buyer_count(uuid)', 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('authenticated', 'public.business_event_buyer_count(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'issue_3827_verify: business_event_buyer_count must be callable by authenticated and not by anon';
  END IF;
  IF pg_catalog.has_function_privilege('authenticated', 'public.business_resolve_edit_reason(uuid, text)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', 'public.business_resolve_edit_reason(uuid, text)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', 'public.business_event_theme_with_location(jsonb, text, boolean, text, boolean, text)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', 'public.business_event_location_label(text, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'issue_3827_verify: an internal helper is callable by a client role';
  END IF;

  -- business_patch_event_taxonomy: the label is derived, the address is stored.
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc AS p
   WHERE p.oid = 'public.business_patch_event_taxonomy(uuid, text, text[], text[], text[], numeric, numeric, text, text)'::pg_catalog.regprocedure;
  IF pg_catalog.strpos(v_src, 'business_event_theme_with_location') = 0
     OR pg_catalog.strpos(v_src, 'business_event_location_label') = 0
     OR pg_catalog.strpos(v_src, 'theme = v_theme') = 0
     OR pg_catalog.strpos(v_src, 'v_event.location_geo ~= v_location_geo') = 0 THEN
    RAISE EXCEPTION 'issue_3827_verify: business_patch_event_taxonomy does not derive the label or keep the precision of an unmoved pin';
  END IF;

  -- business_update_live_event: derived label, direct hide-address child, and
  -- the #2353 format hunks still in place.
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc AS p
   WHERE p.oid = 'public.business_update_live_event(uuid, jsonb, text, integer)'::pg_catalog.regprocedure;
  IF pg_catalog.strpos(v_src, 'NULLIF(p_patch->>''address'','''')') > 0
     OR pg_catalog.strpos(v_src, 'NULLIF(p_patch->>''venueName'','''')') > 0 THEN
    RAISE EXCEPTION 'issue_3827_verify: business_update_live_event still assigns the label from one half';
  END IF;
  IF pg_catalog.strpos(v_src, 'business_event_location_label') = 0
     OR pg_catalog.strpos(v_src, 'business_event_theme_with_location') = 0 THEN
    RAISE EXCEPTION 'issue_3827_verify: business_update_live_event does not derive the label from the stored halves';
  END IF;
  IF pg_catalog.strpos(v_src, 'jsonb_set(v_settings,''{hideAddressUntilTicket}''') > 0
     OR pg_catalog.strpos(v_src, 'jsonb_build_object(''hideAddressUntilTicket'',p_patch->''hideAddressUntilTicket'')') = 0 THEN
    RAISE EXCEPTION 'issue_3827_verify: business_update_live_event does not write hideAddressUntilTicket to the direct child';
  END IF;
  IF pg_catalog.strpos(v_src, 'IN (''online'',''hybrid'')') = 0
     OR pg_catalog.strpos(v_src, 'jsonb_build_object(''format'',lower(btrim(p_patch->>''format''') = 0 THEN
    RAISE EXCEPTION 'issue_3827_verify: business_update_live_event lost the #2353 format projection or persist';
  END IF;

  -- business_update_live_event_atomic: the reason goes through the resolver.
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc AS p
   WHERE p.oid = 'public.business_update_live_event_atomic(uuid, jsonb, text, integer)'::pg_catalog.regprocedure;
  IF pg_catalog.strpos(v_src, 'business_resolve_edit_reason') = 0
     OR pg_catalog.strpos(v_src, 'invalid_edit_reason') = 0
     OR pg_catalog.strpos(v_src, 'v_core_without_tickets,p_reason') > 0
     OR pg_catalog.strpos(v_src, 'NULL,p_reason') > 0
     OR pg_catalog.strpos(v_src, 'v_when,p_reason') > 0 THEN
    RAISE EXCEPTION 'issue_3827_verify: business_update_live_event_atomic does not resolve the reason, or still hands a leaf the raw one';
  END IF;

  -- biz_update_live_rsvp: resolver and structured location in, and the chip-in
  -- refusal business_update_rsvp_graph relies on still there.
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc AS p
   WHERE p.oid = 'public.biz_update_live_rsvp(uuid, jsonb, text)'::pg_catalog.regprocedure;
  IF pg_catalog.strpos(v_src, 'business_resolve_edit_reason') = 0
     OR pg_catalog.strpos(v_src, 'business_event_theme_with_location') = 0 THEN
    RAISE EXCEPTION 'issue_3827_verify: biz_update_live_rsvp does not resolve the reason or write the structured location';
  END IF;
  IF pg_catalog.strpos(v_src, 'pg_brand_can_collect') = 0
     OR pg_catalog.strpos(v_src, 'stripe_charges_disabled') = 0 THEN
    RAISE EXCEPTION 'issue_3827_verify: biz_update_live_rsvp no longer refuses chip-ins for a brand that cannot collect';
  END IF;
END
$verify$;

COMMIT;

NOTIFY pgrst, 'reload schema';
