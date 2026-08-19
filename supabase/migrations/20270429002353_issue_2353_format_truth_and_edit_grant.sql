-- Issue #2353 — format truth, and the edit grant that #2089's revoke outran.
--
-- Fix-forward on 20270422001972 (#1972 / #2089), which is MERGED and must not
-- be edited. Five changes, one file:
--
--   S0  apply-order guard. MANDATORY, and the first statement in the file.
--   S1  [TRANSITIONAL] restore EXECUTE to `authenticated` on the two patch
--       leaves so 20270422001972 is safe to apply before the business OTA
--       carrying #2089's client half has reached devices. anon stays revoked.
--   S2  business_event_draft_payload_from_graph — read the stored format enum
--       instead of deriving it from is_online.
--   S3  business_update_live_event — project is_online as
--       format IN ('online','hybrid') AND persist the supplied format into
--       theme.business_event.format. Both halves are ONE change.
--   S4  ari_execute_event_operation — accept a `format` argument at all three
--       derivation sites on the create and LIVE-update arms, and keep
--       is_online in agreement with it.
--   S6  ari_execute_event_operation — the DRAFT-update arm, which S4 missed.
--       It accepted a `format` and silently discarded it, and it wrote
--       is_online without its source of truth so a hybrid draft could be
--       published as `format=hybrid, is_online=false`. Both closed, with the
--       create arm's precedence.
--
-- ONE CANONICAL-MEMBERSHIP TEST, WRITTEN THE SAME WAY EVERYWHERE. Every site
-- above decides whether a format value is usable with the SAME expression —
-- `lower(btrim(COALESCE(<expr>,''), E' \t\n\r\f\v'||chr(160)))
--  IN ('in_person','online','hybrid')` — and emits the SAME normalised value.
-- The second `btrim` argument is NOT decoration: one-argument `btrim(text)`
-- strips ASCII SPACE ONLY. Measured on the harness rather than assumed —
-- `sp_stripped=true`, `tab_stripped=false`, `nl_stripped=false`,
-- `cr_stripped=false`, `nbsp_stripped=false` — so a tab-, newline-, CR- or
-- U+00A0-padded `hybrid` fell straight through the canonical list and
-- reproduced the whole escalation below verbatim: `stored=<TAB>hybrid,
-- broadcast=f` became `stored=online, broadcast=t` after one round trip. The
-- explicit character set closes that class. This supersedes the
-- SPEC's §9 instruction to use a bare `IN (…)` with no `lower()`/`btrim()`.
-- §9's premise was that "every writer emits a bare literal". That is true of
-- the shipped TypeScript client and FALSE of the server contract:
-- `business_create_event_draft` and `business_update_event_draft` both hold
-- `authenticated=X` and neither validates `theme.business_draft.format`, so an
-- event_manager calling PostgREST directly can store `'Hybrid'` — the exact
-- word the app's own UI shows a host. Under a bare `IN (…)` that row misses
-- the canonical list, falls through to the `is_online` derivation, and one
-- Unpublish/re-publish rewrites it to `'online'` (the theme write is a
-- WHOLESALE replace, so the original is gone) — at which point #2333's
-- discovery carve-out, which tests `lower(format)='online'`, broadcasts a
-- venue-backed Lagos event into every market. Normalising makes a `'Hybrid'`
-- row behave identically to a `'hybrid'` one at every site, and aligns this
-- migration with #2333's `lower(...)` reads.
--
-- S5 — DROPPED, and deliberately. An earlier revision of this migration added
-- a conjunct to `business_guard_event_publish_visibility` exempting a row with
-- no stored `business_event.requestedVisibility` from the publish-visibility
-- backstop. It was measured to buy nothing and to cost something. Nothing:
-- every product path runs `business_assert_event_visibility` BEFORE the
-- trigger — S2 raises for a draft with no stored choice, so the editor cannot
-- load it and Ari's `publish_event` arm cannot build a payload — so the only
-- statement class the conjunct changed is a direct table UPDATE, which #2009's
-- write guard already refuses for `authenticated` and `anon`. Something: the
-- conjunct tested ONE path (`NEW.theme#>'{business_event,…}'`) against a
-- FOUR-way scope test (`business_event` OR `business_draft`, in NEW OR OLD),
-- so a private intent stored only in `business_draft`, or one dropped from
-- NEW.theme by the same statement, stopped being refused. Two statements that
-- raised `event_visibility_invalid` before it began succeeding after it.
-- Production exposure of the drafts it was meant to rescue is ZERO (0 of 11
-- business event drafts lack the key, re-measured read-only at rework). A
-- change with a measured zero benefit and a measured non-zero cost is removed,
-- not defended. The guard from 20270422001972:428-458 stands untouched.
--
-- No client change. `asFormat` (businessEvents.ts:267-272) and `asDraftFormat`
-- (serverDraftEventMapper.ts:252-257) already read the stored enum first, and
-- EditPublishedScreen has been on business_update_live_event_atomic since
-- 0d9476573. The server is being brought to the client's model.
BEGIN;

-- ---------------------------------------------------------------------------
-- S0. APPLY-ORDER GUARD. This must stay the first executable statement.
--
--     Production's applied migration head is 20270423002290, which is HIGHER
--     than 20270422001972 — so #1972 is applied SURGICALLY (its own header
--     says so, COMMS-0034) while THIS migration, at 20270429002353, runs down
--     the normal `migration up` path. If the normal path reaches here before
--     #1972 has been applied surgically, every CREATE OR REPLACE below
--     installs a corrected function that #1972 then OVERWRITES with the buggy
--     one, and #1972's REVOKE re-removes the grant S1 restores. The result is
--     a silent, complete reversal of this entire migration, with both files
--     recorded as applied and no error anywhere.
--
--     Fail loud beats reverse silently.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regprocedure('public.business_update_live_event_atomic(uuid,jsonb,text,integer)') IS NULL
     OR to_regprocedure('public.business_event_draft_payload_from_graph(uuid)') IS NULL THEN
    RAISE EXCEPTION
      'issue_2353_requires_20270422001972_applied_first';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- S1. Restore the edit grant, transitionally.
-- ---------------------------------------------------------------------------
-- [TRANSITIONAL] issue #2353 — remove under the contract migration tracked by
-- OQ-1, once the business OTA carrying #2089's client half is confirmed on
-- devices. #2089 revoked these two leaves from `authenticated` and moved the
-- editor onto business_update_live_event_atomic in the SAME commit
-- (0d9476573) — the architecture is right and this grant is meant to end. But
-- the CREATE of the new owner and the REVOKE of these leaves are in the same
-- migration, while the client half lands by OTA, so applying 20270422001972
-- before the OTA reaches a device returns `permission denied for function
-- business_patch_event_taxonomy` to every host editing any published event.
-- This grant decouples the two so the migration is safe to apply on its own.
-- anon is deliberately NOT re-granted: business_patch_event_when carries a
-- real stray anon=X in deployed schema and that revoke is a genuine fix.
--
-- EXIT CONDITION, written down so it cannot be lost: this grant is removed by
-- the follow-on contract migration for issue #2353, which may be applied only
-- after the business OTA carrying commit 0d9476573's client half is confirmed
-- adopted on devices (issue #2107 owns the enforceable-update gate that makes
-- that confirmable). Until then, removing this grant re-arms the platform-wide
-- published-event edit outage this migration exists to remove.
GRANT EXECUTE ON FUNCTION
  public.business_patch_event_when(uuid,jsonb,text,integer),
  public.business_patch_event_taxonomy(
    uuid,text,text[],text[],text[],numeric,numeric,text,text
  ) TO authenticated;

-- ---------------------------------------------------------------------------
-- S2. business_event_draft_payload_from_graph — stored format wins.
--     Body reproduced from 20270422001972:502-640, one hunk changed (line 601).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.business_event_draft_payload_from_graph(
  p_event_id uuid
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_event public.events%ROWTYPE;
  v_business jsonb;
  v_tickets jsonb;
  v_dates jsonb;
  v_when_mode text;
  v_when jsonb;
  v_multi jsonb;
  v_requested_visibility text;
BEGIN
  SELECT * INTO v_event FROM public.events
   WHERE id = p_event_id AND deleted_at IS NULL;
  IF NOT FOUND OR v_event.event_type <> 'event' THEN
    RAISE EXCEPTION 'event_not_found';
  END IF;
  IF public.biz_brand_effective_rank(v_event.brand_id, auth.uid())
       < public.biz_role_rank('scanner') THEN
    RAISE EXCEPTION 'insufficient_event_permission';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', tt.id::text,
    'name', tt.name,
    'description', tt.description,
    'priceGbp', CASE WHEN tt.price_cents IS NULL THEN NULL ELSE tt.price_cents / 100.0 END,
    'currency', btrim(tt.currency::text),
    'capacity', tt.quantity_total,
    'isFree', tt.is_free,
    'isUnlimited', tt.is_unlimited,
    'visibility', CASE WHEN tt.is_disabled THEN 'disabled' WHEN tt.is_hidden THEN 'hidden' ELSE 'public' END,
    'displayOrder', tt.display_order,
    'approvalRequired', tt.requires_approval,
    'passwordProtected', tt.password_protected,
    'passwordConfigured', tt.password_hash IS NOT NULL,
    'password', NULL,
    'waitlistEnabled', tt.waitlist_enabled,
    'minPurchaseQty', tt.min_purchase_qty,
    'maxPurchaseQty', tt.max_purchase_qty,
    'allowTransfers', tt.allow_transfers,
    'saleStartAt', tt.sale_start_at,
    'saleEndAt', tt.sale_end_at,
    'availableAt', CASE WHEN tt.available_online AND tt.available_in_person THEN 'both'
      WHEN tt.available_online THEN 'online' ELSE 'door' END
  ) ORDER BY tt.display_order, tt.created_at), '[]'::jsonb)
  INTO v_tickets FROM public.ticket_types tt
  WHERE tt.event_id = p_event_id AND tt.deleted_at IS NULL;
  IF v_event.status='draft' THEN
    v_tickets:=COALESCE(v_event.theme#>'{business_draft,tickets}',v_tickets);
  END IF;

  -- Draft schedule topology is typed but deliberately not materialized in
  -- event_dates until publish. Preserve that canonical payload byte-for-byte.
  IF v_event.status = 'draft' THEN
    v_when_mode := COALESCE(v_event.theme#>>'{business_draft,whenMode}', 'single');
    v_when := v_event.theme#>'{business_draft,when}';
    v_multi := v_event.theme#>'{business_draft,multiDates}';
  ELSE
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'date', to_char(ed.start_at AT TIME ZONE v_event.timezone, 'YYYY-MM-DD'),
      'startTime', to_char(ed.start_at AT TIME ZONE v_event.timezone, 'HH24:MI'),
      'endTime', to_char(ed.end_at AT TIME ZONE v_event.timezone, 'HH24:MI')
    ) ORDER BY ed.start_at), '[]'::jsonb)
    INTO v_dates FROM public.event_dates ed WHERE ed.event_id = p_event_id;

    v_when_mode := CASE WHEN v_event.is_multi_date THEN 'multi_date'
      WHEN v_event.is_recurring THEN 'recurring' ELSE 'single' END;
    SELECT jsonb_build_object(
      'date', to_char(ed.start_at AT TIME ZONE v_event.timezone, 'YYYY-MM-DD'),
      'doorsOpen', to_char(ed.start_at AT TIME ZONE v_event.timezone, 'HH24:MI'),
      'endsAt', to_char(ed.end_at AT TIME ZONE v_event.timezone, 'HH24:MI'),
      'timezone', v_event.timezone
    ) INTO v_when FROM public.event_dates ed
    WHERE ed.event_id = p_event_id AND ed.is_master ORDER BY ed.start_at LIMIT 1;
    v_multi := CASE WHEN v_when_mode = 'multi_date' THEN v_dates ELSE NULL END;
  END IF;

  IF v_event.status='draft' THEN
    v_requested_visibility:=public.business_assert_event_visibility(
      v_event.theme#>'{business_draft,requestedVisibility}'
    );
  ELSIF v_event.visibility='public' THEN
    v_requested_visibility:='public';
  ELSIF v_event.visibility='hidden' THEN
    v_requested_visibility:='unlisted';
  ELSIF v_event.visibility='private' THEN
    v_requested_visibility:='private';
  ELSE
    RAISE EXCEPTION 'event_visibility_invalid';
  END IF;

  v_business := COALESCE(v_event.theme->'business_draft', v_event.theme->'business_event', '{}'::jsonb)
    || jsonb_build_object(
      'schemaVersion', 1,
      'legacyLocalDraftId', NULL,
      -- issue #2353 — is_online is a TWO-valued projection of a THREE-valued
      -- enum (serverDraftEventMapper.ts:708 writes
      -- `format === "online" || format === "hybrid"`), so deriving format from
      -- it cannot distinguish online from hybrid and makes 'hybrid'
      -- unreachable as an output. business_unpublish_event_to_draft:979
      -- installs this payload with `theme = v_payload->'theme'`, a WHOLESALE
      -- replace, so the stored value was overwritten and unrecoverable — a
      -- host tapping Duplicate or Unpublish on a hybrid event got it back
      -- relabelled Online. Read the stored enum first, exactly as the client's
      -- asFormat/asDraftFormat already do; fall back to the is_online
      -- derivation ONLY when nothing valid is stored, which is the pre-#2089
      -- behaviour and never a fabricated 'hybrid'.
      'format', CASE
        WHEN lower(btrim(COALESCE(v_event.theme#>>'{business_event,format}',
                                  v_event.theme#>>'{business_draft,format}',''), E' \t\n\r\f\v'||chr(160)))
             IN ('in_person','online','hybrid')
        THEN lower(btrim(COALESCE(v_event.theme#>>'{business_event,format}',
                                  v_event.theme#>>'{business_draft,format}'), E' \t\n\r\f\v'||chr(160)))
        WHEN v_event.is_online THEN 'online'
        ELSE 'in_person'
      END,
      'partyTypes', to_jsonb(COALESCE(v_event.party_types, ARRAY[]::text[])),
      'vibeTags', to_jsonb(COALESCE(v_event.vibe_tags, ARRAY[]::text[])),
      'musicGenres', to_jsonb(COALESCE(v_event.music_genres, ARRAY[]::text[])),
      'city', v_event.city,
      'locationGeo', CASE WHEN v_event.location_geo IS NULL THEN NULL ELSE
        jsonb_build_object('lng', (v_event.location_geo)[0], 'lat', (v_event.location_geo)[1]) END,
      'requestedVisibility', v_requested_visibility,
      'coverHue', COALESCE((v_event.theme->>'coverHue')::numeric, 25),
      'coverProvider', jsonb_build_object(
        'provider', v_event.cover_media_provider,
        'sourceUrl', v_event.cover_media_source_url,
        'credit', v_event.cover_media_credit,
        'creditUrl', v_event.cover_media_credit_url,
        'alt', v_event.cover_media_alt),
      'currency', btrim(v_event.currency::text),
      'whenMode', v_when_mode,
      'when', v_when,
      'recurrenceRule', CASE WHEN v_event.status='draft'
        THEN v_event.theme#>'{business_draft,recurrenceRule}'
        ELSE v_event.recurrence_rules END,
      'multiDates', v_multi,
      'location', CASE WHEN v_event.status='draft' THEN
        COALESCE(v_event.theme#>'{business_draft,location}',
          jsonb_build_object('venueName',v_event.location_text,'address',NULL))
        ELSE jsonb_build_object('venueName',v_event.location_text,'address',NULL) END,
      'tickets', v_tickets,
      'lastStepReached', 6,
      'clientRevision', COALESCE(
        (v_event.theme#>>'{business_draft,clientRevision}')::integer,
        (v_event.theme#>>'{business_event,clientRevision}')::integer,0)
    );

  RETURN to_jsonb(v_event) || jsonb_build_object(
    'theme', (COALESCE(v_event.theme, '{}'::jsonb) - 'business_event' - 'business_draft')
      || jsonb_build_object('business_draft', v_business),
    'visibility', 'draft', 'status', 'draft'
  );
END;
$fn$;

-- ---------------------------------------------------------------------------
-- S3. business_update_live_event — is_online is a PROJECTION, and the format
--     it projects from is PERSISTED. (a) and (b) are one change.
--     Body reproduced from 20270422001972:841-942, two hunks changed
--     (line 882 and the theme assignment immediately below it).
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
  IF p_patch ? 'hideAddressUntilTicket' THEN v_settings:=jsonb_set(v_settings,'{hideAddressUntilTicket}',p_patch->'hideAddressUntilTicket',true);END IF;
  IF p_patch ? 'requireApproval' THEN v_settings:=jsonb_set(v_settings,'{requireApproval}',p_patch->'requireApproval',true);END IF;
  IF p_patch ? 'allowTransfers' THEN v_settings:=jsonb_set(v_settings,'{allowTransfers}',p_patch->'allowTransfers',true);END IF;
  IF p_patch ? 'passwordProtected' THEN v_settings:=jsonb_set(v_settings,'{passwordProtected}',p_patch->'passwordProtected',true);END IF;
  IF p_patch ? 'inPersonPaymentsEnabled' THEN v_settings:=jsonb_set(v_settings,'{inPersonPaymentsEnabled}',p_patch->'inPersonPaymentsEnabled',true);END IF;

  UPDATE public.events SET
    title=CASE WHEN p_patch ? 'name' THEN NULLIF(btrim(p_patch->>'name'),'') ELSE title END,
    description=CASE WHEN p_patch ? 'description' THEN NULLIF(p_patch->>'description','') ELSE description END,
    location_text=CASE WHEN p_patch ? 'address' THEN NULLIF(p_patch->>'address','') WHEN p_patch ? 'venueName' THEN NULLIF(p_patch->>'venueName','') ELSE location_text END,
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
    theme=jsonb_set(
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
-- S4. ari_execute_event_operation — accept a `format` argument.
--     Body reproduced from 20270422001972:1268-1496, three hunks changed
--     (lines 1374, 1400 and 1453). Inert until something sends `format`:
--     absent, the output is bit-identical to the pre-fix behaviour.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ari_execute_event_operation(
  p_operation_id uuid,p_tool_name text,p_args jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE
  v_begin jsonb;
  v_result jsonb;
  v_event_id uuid;
  v_payload jsonb;
  v_business jsonb;
  v_timezone text;
  v_start timestamptz;
  v_end timestamptz;
  v_revision integer;
  v_event_status text;
  v_when_mode text;
  v_multi_dates jsonb;
  v_recurrence_rule jsonb;
  v_date_item jsonb;
  v_date_index integer:=0;
  v_date_text text;
  v_start_text text;
  v_end_text text;
  v_draft_format text;   -- issue #2353, S6
  v_draft_online boolean;-- issue #2353, S6
BEGIN
  IF p_tool_name NOT IN('create_event','update_event','publish_event','unpublish_event','cancel_event',
    'end_event_sales','duplicate_event','patch_event_when','set_event_cover','set_event_guest_privacy','discard_event_draft')
  THEN RAISE EXCEPTION 'unsupported_event_operation';END IF;
  v_begin:=public.agent_operation_receipt_begin(p_operation_id,p_tool_name,p_args);
  IF COALESCE((v_begin->>'replay')::boolean,false) THEN RETURN v_begin->'result';END IF;
  v_event_id:=NULLIF(p_args->>'event_id','')::uuid;
  CASE p_tool_name
    WHEN 'create_event' THEN
      PERFORM public.business_assert_event_visibility(p_args->'visibility');
      v_timezone:=COALESCE(NULLIF(p_args->>'timezone',''),'UTC');
      IF NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=v_timezone) THEN
        RAISE EXCEPTION 'event_timezone_invalid';
      END IF;
      v_when_mode:=COALESCE(NULLIF(p_args->>'when_mode',''),'single');
      IF v_when_mode NOT IN('single','multi_date','recurring') THEN
        RAISE EXCEPTION 'event_when_mode_invalid';
      END IF;
      v_recurrence_rule:=p_args->'recurrence_rule';
      v_multi_dates:=NULL;
      IF v_when_mode IN('single','recurring') THEN
        IF NULLIF(p_args->>'start_at','') IS NULL THEN RAISE EXCEPTION 'event_start_required';END IF;
        v_start:=(p_args->>'start_at')::timestamptz;
        v_end:=COALESCE(NULLIF(p_args->>'end_at','')::timestamptz,v_start+interval '2 hours');
        IF v_start<=now() OR v_end<=v_start THEN RAISE EXCEPTION 'event_date_invalid';END IF;
        IF v_when_mode='recurring' AND (
          jsonb_typeof(v_recurrence_rule) IS DISTINCT FROM 'object'
          OR COALESCE(v_recurrence_rule->>'preset','') NOT IN(
            'daily','weekly','biweekly','monthly_dom','monthly_dow')
          OR jsonb_typeof(v_recurrence_rule->'termination') IS DISTINCT FROM 'object'
          OR COALESCE(v_recurrence_rule#>>'{termination,kind}','') NOT IN('count','until')
          OR (v_recurrence_rule#>>'{termination,kind}'='count' AND (
            COALESCE(v_recurrence_rule#>>'{termination,count}','') !~ '^[0-9]+$'
            OR (v_recurrence_rule#>>'{termination,count}')::integer NOT BETWEEN 1 AND 52))
          OR (v_recurrence_rule#>>'{termination,kind}'='until' AND (
            COALESCE(v_recurrence_rule#>>'{termination,until}','') !~ '^\d{4}-\d{2}-\d{2}$'
            OR (v_recurrence_rule#>>'{termination,until}')::date < (v_start AT TIME ZONE v_timezone)::date
            OR (v_recurrence_rule#>>'{termination,until}')::date > (v_start AT TIME ZONE v_timezone)::date+366))
          OR (v_recurrence_rule->>'preset' IN('weekly','biweekly','monthly_dow')
            AND COALESCE(v_recurrence_rule->>'byDay','') NOT IN('MO','TU','WE','TH','FR','SA','SU'))
          OR (v_recurrence_rule->>'preset'='monthly_dom' AND (
            COALESCE(v_recurrence_rule->>'byMonthDay','') !~ '^[0-9]+$'
            OR (v_recurrence_rule->>'byMonthDay')::integer NOT BETWEEN 1 AND 28))
          OR (v_recurrence_rule->>'preset'='monthly_dow' AND
            COALESCE(v_recurrence_rule->>'bySetPos','') NOT IN('1','2','3','4','-1'))
        ) THEN RAISE EXCEPTION 'event_recurrence_invalid';END IF;
      ELSE
        IF jsonb_typeof(p_args->'multi_dates') IS DISTINCT FROM 'array'
           OR jsonb_array_length(p_args->'multi_dates') NOT BETWEEN 2 AND 24 THEN
          RAISE EXCEPTION 'event_multi_dates_invalid';
        END IF;
        v_multi_dates:='[]'::jsonb;
        FOR v_date_item IN SELECT value FROM jsonb_array_elements(p_args->'multi_dates') LOOP
          v_date_index:=v_date_index+1;
          v_date_text:=NULLIF(v_date_item->>'date','');
          v_start_text:=NULLIF(v_date_item->>'start_time','');
          v_end_text:=NULLIF(v_date_item->>'end_time','');
          IF v_date_text IS NULL OR v_start_text IS NULL OR v_end_text IS NULL THEN
            RAISE EXCEPTION 'event_multi_date_fields_required';
          END IF;
          v_start:=public.business_resolve_event_local_datetime(
            v_date_text,v_start_text,v_timezone
          );
          v_end:=public.business_resolve_event_local_datetime(
            v_date_text,v_end_text,v_timezone
          );
          IF v_end<=v_start THEN v_end:=v_end+interval '1 day';END IF;
          IF v_start<=now() OR v_end<=v_start THEN RAISE EXCEPTION 'event_date_invalid';END IF;
          v_multi_dates:=v_multi_dates||jsonb_build_array(jsonb_build_object(
            'id',COALESCE(NULLIF(v_date_item->>'id',''),'ari-'||v_date_index::text),
            'date',v_date_text,'startTime',v_start_text,'endTime',v_end_text,
            'overrides',COALESCE(v_date_item->'overrides','{}'::jsonb)));
        END LOOP;
        v_date_item:=v_multi_dates->0;
        v_start:=public.business_resolve_event_local_datetime(
          v_date_item->>'date',v_date_item->>'startTime',v_timezone
        );
        v_end:=public.business_resolve_event_local_datetime(
          v_date_item->>'date',v_date_item->>'endTime',v_timezone
        );
        IF v_end<=v_start THEN v_end:=v_end+interval '1 day';END IF;
      END IF;
      v_business:=jsonb_build_object(
        'schemaVersion',1,'legacyLocalDraftId',NULL,
        -- issue #2353 — accept the caller's format enum when it is one of the
        -- three canonical values; fall back to the is_online derivation only
        -- when it is absent or unrecognised, which reproduces the pre-fix
        -- output bit for bit and never fabricates 'hybrid'.
        'format',CASE
          WHEN lower(btrim(COALESCE(p_args->>'format',''), E' \t\n\r\f\v'||chr(160))) IN ('in_person','online','hybrid')
            THEN lower(btrim(p_args->>'format', E' \t\n\r\f\v'||chr(160)))
          WHEN COALESCE((p_args->>'is_online')::boolean,false) THEN 'online'
          ELSE 'in_person' END,
        'partyTypes',COALESCE(p_args->'party_types','[]'::jsonb),
        'vibeTags',COALESCE(p_args->'vibe_tags','[]'::jsonb),
        'musicGenres',COALESCE(p_args->'music_genres','[]'::jsonb),
        'city',p_args->'city','locationGeo',NULL,
        'requestedVisibility',p_args->>'visibility',
        'coverHue',25,'coverProvider',jsonb_build_object(
          'provider',p_args->'cover_media_provider','sourceUrl',p_args->'cover_media_source_url',
          'credit',p_args->'cover_media_credit','creditUrl',p_args->'cover_media_credit_url','alt',p_args->'cover_media_alt'),
        'currency',p_args->'currency','whenMode',v_when_mode,
        'when',jsonb_build_object('date',to_char(v_start AT TIME ZONE v_timezone,'YYYY-MM-DD'),
          'doorsOpen',to_char(v_start AT TIME ZONE v_timezone,'HH24:MI'),
          'endsAt',to_char(v_end AT TIME ZONE v_timezone,'HH24:MI'),'timezone',v_timezone),
        'recurrenceRule',CASE WHEN v_when_mode='recurring' THEN v_recurrence_rule ELSE NULL END,
        'multiDates',CASE WHEN v_when_mode='multi_date' THEN v_multi_dates ELSE NULL END,
        'location',jsonb_build_object('venueName',p_args->'location_text','address',NULL),
        'hideAddressUntilTicket',false,'tickets',COALESCE(p_args->'tickets','[]'::jsonb),
        'settings',jsonb_build_object('requireApproval',false,'allowTransfers',true,
          'hideRemainingCount',false,'passwordProtected',false,'privateGuestList',false,
          'inPersonPaymentsEnabled',false),
        'isRsvp',false,'rsvpCapacity',NULL,'rsvpAllowPlusOnes',false,'rsvpPlusOnesMax',0,
        'rsvpWaitlistEnabled',false,'rsvpApprovalMode','auto','rsvpDiscoverable',false,
        'rsvpContributionEnabled',false,'rsvpContributionSuggestedCents',NULL,
        'rsvpContributionMinCents',NULL,'lastStepReached',0,'clientRevision',0);
      v_payload:=jsonb_build_object(
        'title',p_args->>'title','description',p_args->'description','location_text',p_args->'location_text',
        'online_url',p_args->'online_url',
        -- issue #2353 — is_online is a PROJECTION of format, so the pair
        -- cannot be allowed to disagree: a hybrid create must set is_online
        -- true. With no format argument this is the previous expression
        -- exactly.
        'is_online',to_jsonb(CASE
          WHEN lower(btrim(COALESCE(p_args->>'format',''), E' \t\n\r\f\v'||chr(160))) IN ('in_person','online','hybrid')
            THEN lower(btrim(p_args->>'format', E' \t\n\r\f\v'||chr(160))) IN ('online','hybrid')
          ELSE COALESCE((p_args->>'is_online')::boolean,false) END),
        'is_recurring',v_when_mode='recurring','is_multi_date',v_when_mode='multi_date',
        'recurrence_rules',CASE WHEN v_when_mode='recurring' THEN v_recurrence_rule ELSE NULL END,
        'timezone',v_timezone,
        'cover_media_url',p_args->'cover_media_url','cover_media_type',p_args->'cover_media_type',
        'cover_media_poster_url',p_args->'cover_media_poster_url','cover_media_provider',p_args->'cover_media_provider',
        'cover_media_source_url',p_args->'cover_media_source_url','cover_media_credit',p_args->'cover_media_credit',
        'cover_media_credit_url',p_args->'cover_media_credit_url','cover_media_alt',p_args->'cover_media_alt',
        'currency',p_args->'currency','party_types',COALESCE(p_args->'party_types','[]'::jsonb),
        'vibe_tags',COALESCE(p_args->'vibe_tags','[]'::jsonb),'music_genres',COALESCE(p_args->'music_genres','[]'::jsonb),
        'city',p_args->'city','theme',jsonb_build_object('coverHue',25,'business_draft',v_business));
      v_result:=public.business_create_event_draft((p_args->>'brand_id')::uuid,v_payload);
    WHEN 'update_event' THEN
      SELECT status INTO v_event_status FROM public.events WHERE id=v_event_id AND event_type='event' AND deleted_at IS NULL;
      IF NOT FOUND THEN RAISE EXCEPTION 'event_not_found';END IF;
      IF v_event_status='draft' THEN
        v_payload:=public.business_event_draft_payload_from_graph(v_event_id);
        v_business:=COALESCE(v_payload#>'{theme,business_draft}','{}'::jsonb);
        v_revision:=NULLIF(p_args->>'client_revision','')::integer;
        IF p_args ? 'title' THEN v_payload:=jsonb_set(v_payload,'{title}',p_args->'title',true);END IF;
        IF p_args ? 'description' THEN v_payload:=jsonb_set(v_payload,'{description}',p_args->'description',true);END IF;
        IF p_args ? 'location_text' THEN
          v_payload:=jsonb_set(v_payload,'{location_text}',p_args->'location_text',true);
          v_business:=jsonb_set(v_business,'{location,venueName}',p_args->'location_text',true);
        END IF;
        IF p_args ? 'is_online' THEN v_payload:=jsonb_set(v_payload,'{is_online}',p_args->'is_online',true);END IF;
        -- issue #2353 S6 — the DRAFT arm. `update_event` has TWO arms and S4
        -- taught only the LIVE one; this arm was in nobody's site list. The
        -- tester drove the two holes that left open:
        --
        --   * a supplied `format` was accepted, reported SUCCESSFUL, and
        --     silently DISCARDED. The host is told the edit landed and it did
        --     not — Constitution rule 3, and this whole work item began with a
        --     publish that failed silently. The asymmetry is CREATED by this
        --     migration: before S4, neither arm accepted `format`, so the two
        --     agreed by both refusing.
        --   * a supplied `is_online` moved the DERIVED column and left the
        --     SOURCE OF TRUTH stale, so a hybrid draft became
        --     `format=hybrid, is_online=false` and the disagreement SURVIVED
        --     publish into a live row. This needs no out-of-schema key:
        --     `is_online` is an ADVERTISED parameter of the tool
        --     (agentTools.ts:753), so a host saying "this one isn't online any
        --     more" reaches it directly. It is the same "derived column written
        --     without its source of truth" defect the investigation's F-9 found
        --     on business_update_live_event, on a sixth site nobody enumerated.
        --
        -- Precedence matches the create arm (S4a/S4b): a usable `format` WINS
        -- and is_online is projected from it. A bare `is_online` moves `format`
        -- only when the two would otherwise DISAGREE — `is_online=true` on a
        -- stored `hybrid` already agrees, so hybrid is PRESERVED rather than
        -- flattened to `online`, which is the entire point of a three-valued
        -- enum. An unrecognised `format` with no `is_online` stays a no-op,
        -- exactly as on the live arm. Same canonical-membership test, written
        -- the same way, as every other site in this file.
        IF lower(btrim(COALESCE(p_args->>'format',''), E' \t\n\r\f\v'||chr(160)))
             IN ('in_person','online','hybrid') THEN
          v_draft_format:=lower(btrim(p_args->>'format', E' \t\n\r\f\v'||chr(160)));
          v_business:=jsonb_set(v_business,'{format}',to_jsonb(v_draft_format),true);
          v_payload:=jsonb_set(v_payload,'{is_online}',
            to_jsonb(v_draft_format IN ('online','hybrid')),true);
        ELSIF p_args ? 'is_online' THEN
          v_draft_online:=COALESCE((v_payload->>'is_online')::boolean,false);
          v_draft_format:=lower(btrim(COALESCE(v_business->>'format',''), E' \t\n\r\f\v'||chr(160)));
          IF v_draft_format NOT IN ('in_person','online','hybrid')
             OR (v_draft_format IN ('online','hybrid')) IS DISTINCT FROM v_draft_online THEN
            v_business:=jsonb_set(v_business,'{format}',
              to_jsonb(CASE WHEN v_draft_online THEN 'online' ELSE 'in_person' END),true);
          END IF;
        END IF;
        IF p_args ? 'online_url' THEN v_payload:=jsonb_set(v_payload,'{online_url}',p_args->'online_url',true);END IF;
        IF p_args ? 'visibility' THEN
          PERFORM public.business_assert_event_visibility(p_args->'visibility');
          v_business:=jsonb_set(v_business,'{requestedVisibility}',p_args->'visibility',true);
        END IF;
        IF p_args ? 'start_at' THEN
          v_timezone:=COALESCE(NULLIF(p_args->>'timezone',''),v_payload->>'timezone','UTC');
          v_start:=(p_args->>'start_at')::timestamptz;
          v_end:=COALESCE(NULLIF(p_args->>'end_at','')::timestamptz,v_start+interval '2 hours');
          IF v_start<=now() OR v_end<=v_start THEN RAISE EXCEPTION 'event_date_invalid';END IF;
          v_business:=jsonb_set(v_business,'{whenMode}','"single"'::jsonb,true);
          v_business:=jsonb_set(v_business,'{when}',jsonb_build_object(
            'date',to_char(v_start AT TIME ZONE v_timezone,'YYYY-MM-DD'),
            'doorsOpen',to_char(v_start AT TIME ZONE v_timezone,'HH24:MI'),
            'endsAt',to_char(v_end AT TIME ZONE v_timezone,'HH24:MI'),'timezone',v_timezone),true);
          v_payload:=jsonb_set(v_payload,'{timezone}',to_jsonb(v_timezone),true);
        END IF;
        v_business:=jsonb_set(v_business,'{clientRevision}',to_jsonb(v_revision),true);
        v_payload:=jsonb_set(v_payload,'{theme,business_draft}',v_business,true);
        v_result:=public.business_update_event_draft(v_event_id,v_payload,v_revision);
      ELSE
        IF p_args ? 'start_at' OR p_args ? 'end_at' OR p_args ? 'timezone' THEN RAISE EXCEPTION 'live_schedule_requires_patch_event_when';END IF;
        v_business:='{}'::jsonb;
        IF p_args ? 'title' THEN v_business:=v_business||jsonb_build_object('name',p_args->'title');END IF;
        IF p_args ? 'description' THEN v_business:=v_business||jsonb_build_object('description',p_args->'description');END IF;
        IF p_args ? 'location_text' THEN v_business:=v_business||jsonb_build_object('address',p_args->'location_text');END IF;
        IF p_args ? 'online_url' THEN v_business:=v_business||jsonb_build_object('onlineUrl',p_args->'online_url');END IF;
        -- issue #2353 — this feeds business_update_live_event_atomic's `core`,
        -- which S3 now both projects to is_online and PERSISTS into
        -- theme.business_event.format. Accept an explicit format; keep the
        -- is_online derivation for legacy callers.
        -- ENTRY IS THE MEMBERSHIP TEST ITSELF, not `p_args ? 'format'`. The
        -- key-presence form was a REGRESSION this migration introduced and the
        -- tester caught by execution: with an unrecognised `format` present and
        -- `is_online` absent, the CASE's is_online fallback reads a key that is
        -- not there, so the ELSE resolved to a definite 'in_person' and S3
        -- faithfully applied it — a live hybrid event silently relabelled
        -- In person with is_online false, on a call that PRE-FIX did nothing at
        -- all. `p_args` is forwarded verbatim from the tool call
        -- (agentTools.ts:888) and neither create_event nor update_event
        -- declares top-level `additionalProperties: false`, so a model reaching
        -- for the UI's own word "Hybrid" gets there. Entering only on a value
        -- the CASE can honour restores the pre-fix no-op exactly, and is the
        -- same canonical-membership test used at every other site in this file.
        IF lower(btrim(COALESCE(p_args->>'format',''), E' \t\n\r\f\v'||chr(160))) IN ('in_person','online','hybrid')
           OR p_args ? 'is_online' THEN
          v_business:=v_business||jsonb_build_object('format',CASE
            WHEN lower(btrim(COALESCE(p_args->>'format',''), E' \t\n\r\f\v'||chr(160))) IN ('in_person','online','hybrid')
              THEN lower(btrim(p_args->>'format', E' \t\n\r\f\v'||chr(160)))
            WHEN COALESCE((p_args->>'is_online')::boolean,false) THEN 'online'
            ELSE 'in_person' END);
        END IF;
        IF p_args ? 'visibility' THEN v_business:=v_business||jsonb_build_object('visibility',p_args->'visibility');END IF;
        v_result:=public.business_update_live_event_atomic(
          v_event_id,jsonb_build_object('core',v_business),p_args->>'reason',
          NULLIF(p_args->>'client_revision','')::integer
        );
      END IF;
    WHEN 'publish_event' THEN
      v_payload:=public.business_event_draft_payload_from_graph(v_event_id);
      IF p_args ? 'visibility' THEN
        PERFORM public.business_assert_event_visibility(p_args->'visibility');
        v_payload:=jsonb_set(v_payload,'{visibility}',p_args->'visibility',true);
        v_payload:=jsonb_set(
          v_payload,'{theme,business_draft,requestedVisibility}',
          p_args->'visibility',true
        );
      END IF;
      v_result:=public.issue_1719_publish_event_with_poster(v_event_id,v_payload,
        COALESCE(NULLIF(p_args->>'client_revision','')::integer,(v_payload#>>'{theme,business_draft,clientRevision}')::integer));
    WHEN 'unpublish_event' THEN v_result:=public.business_unpublish_event_to_draft(v_event_id);
    WHEN 'cancel_event' THEN v_result:=public.business_cancel_event(v_event_id);
    WHEN 'end_event_sales' THEN v_result:=public.business_end_event_ticket_sales(v_event_id);
    WHEN 'duplicate_event' THEN v_result:=public.business_duplicate_event_as_draft(v_event_id);
    WHEN 'patch_event_when' THEN
      v_result:=public.business_update_live_event_atomic(
        v_event_id,
        jsonb_build_object('core','{}'::jsonb,'when',p_args->'when_payload'),
        p_args->>'reason',
        NULLIF(p_args->>'client_revision','')::integer
      );
    WHEN 'set_event_cover' THEN
      IF COALESCE((p_args->>'clear_cover')::boolean,false) THEN
        v_result:=public.business_clear_event_cover_media(v_event_id);
      ELSE
        v_result:=public.business_set_event_cover_media(v_event_id,p_args->>'selection_ref',
          p_args->>'cover_media_url',p_args->>'cover_media_type',p_args->>'cover_media_poster_url',p_args->>'cover_media_provider',
          p_args->>'cover_media_source_url',p_args->>'cover_media_credit',p_args->>'cover_media_credit_url',p_args->>'cover_media_alt');
      END IF;
    WHEN 'set_event_guest_privacy' THEN v_result:=public.biz_set_event_guest_privacy(v_event_id,
      (p_args->>'private_guest_list')::boolean,(p_args->>'hide_remaining_count')::boolean);
    WHEN 'discard_event_draft' THEN v_result:=public.business_discard_event_draft(v_event_id);
  END CASE;
  RETURN public.agent_operation_receipt_complete(p_operation_id,p_tool_name,p_args,v_result);
END;$fn$;

COMMENT ON FUNCTION public.business_event_draft_payload_from_graph(uuid) IS
  '#2353 rebuilds the editable draft payload; format is READ from theme.business_event/business_draft, with the is_online derivation only as a fallback.';
COMMENT ON FUNCTION public.business_update_live_event(uuid,jsonb,text,integer) IS
  '#2353 core live-event leaf; a supplied format both projects to is_online (online|hybrid) and is persisted to theme.business_event.format.';

COMMIT;
NOTIFY pgrst, 'reload schema';
