-- Issue #3802 (Wave 1) — Hosts and Creators pipelines on the server.
--
-- Two pipelines the whole team works: Hosts and Creators. Records, their
-- owners and a structured activity log live in four new tables. NOTHING reads
-- or writes those tables except the crm_* functions in this file:
--
--   * Every client function starts by checking the caller's team access
--     (public.crm_ctx(), which asks public.admin_team_can('crm')). Delete and
--     restore keep the full-admin gate (public.is_admin_user()).
--   * Every successful write adds a row to public.admin_audit_log with the
--     acting person's real email. Create, bulk create and log take a request
--     key, so a repeat changes nothing.
--   * Live is never set by a person: public.crm_reconcile_live() promotes a
--     host when its linked brand has a public listing. It runs on brand link
--     and every 10 minutes from pg_cron.
--   * A host is in Live only while it is linked to a brand that has a public
--     listing, checked on every write that touches the stage or the brand
--     link: changing or clearing the link of a Live host moves it back to
--     Onboarded unless the new brand has a public listing, and an undo cannot
--     put a host back into Live unless the rule holds at that moment. A
--     listing that goes away later, with the link unchanged, does not move a
--     Live host (Live is a milestone; only a person marking it Lost ends it).
--   * A creator is at Booked or later (Booked, Posted) only with the
--     agreement marked signed, by every route: a move from any stage, an
--     edit of the agreement, and an undo. New records, bulk add included,
--     always start in the first stage.
--   * A public listing is: a scheduled or live event, trip, experience or
--     RSVP page whose visibility is public or discover; a verified venue; a
--     bookable stay.
--   * Every value a caller sends is normalised and checked in ONE place,
--     public.crm_validate_fields(): invisible characters are removed, every
--     kind of blank space is trimmed, and a refusal is always one of these
--     functions' own plain-words messages. The table constraints repeat the
--     rules as a backstop and are never the message a caller sees.
--   * The agent connector (a later wave) calls these same functions. The one
--     seam it replaces is public.crm_ctx().
--
-- Also in this file:
--   * public.admin_team_role_areas(text) gains the areas 'crm' and
--     'beta_leads' (the only Wave 0 object replaced).
--   * public.admin_team_directory(): the one new reader of the two
--     membership tables (internal; not client-executable).
--   * public.admin_beta_leads_list() is now limited to full admins. Same
--     signature, return type and grants; one added first statement.
--
-- One transaction. NOT modified: is_admin_user(), admin_team_role(),
-- admin_team_can(), admin_team_my_access(), every membership writer, both
-- membership tables, and every policy on every table. No trigger, constraint
-- or foreign key is added to brands, events, place_pool, seeding_cities or
-- beta_access_leads: links to them are plain uuid columns validated on write.
--
-- Invariants (docs/INVARIANT_REGISTRY.md):
--   I-PROPOSED-3802-CRM-HAS-ONE-FUNCTION-WRITE-PATH
--   I-PROPOSED-3802-CRM-WRITES-ARE-AUDITED-AND-REPEAT-SAFE
--   I-PROPOSED-3802-CRM-LIVE-SETS-ITSELF
--   I-PROPOSED-3802-FULL-ADMIN-TABLE-HOLDS-ONLY-OWNER-AND-ADMIN (preserved)
--
-- ---------------------------------------------------------------------------
-- ROLLBACK (kept here as a comment; there is no down-migration file).
-- Roll the admin web client back FIRST (it calls these functions), then the
-- database. Records are lost when the tables are dropped; export them first.
--
--   BEGIN;
--   DO $$ BEGIN
--     IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
--       IF EXISTS (SELECT 1 FROM cron.job j WHERE j.jobname = 'crm_reconcile_live') THEN
--         PERFORM cron.unschedule('crm_reconcile_live');
--       END IF;
--     END IF;
--   END $$;
--   DROP FUNCTION IF EXISTS public.crm_record_restore(uuid);
--   DROP FUNCTION IF EXISTS public.crm_record_delete(uuid);
--   DROP FUNCTION IF EXISTS public.crm_record_log(uuid, jsonb, text);
--   DROP FUNCTION IF EXISTS public.crm_record_set_owners(uuid, text[]);
--   DROP FUNCTION IF EXISTS public.crm_record_undo_stage_move(uuid);
--   DROP FUNCTION IF EXISTS public.crm_record_move_stage(uuid, text, text);
--   DROP FUNCTION IF EXISTS public.crm_record_update(uuid, jsonb);
--   DROP FUNCTION IF EXISTS public.crm_records_bulk_create(text, jsonb, text);
--   DROP FUNCTION IF EXISTS public.crm_record_create(text, jsonb, text);
--   DROP FUNCTION IF EXISTS public.crm_link_search(text, text);
--   DROP FUNCTION IF EXISTS public.crm_duplicate_check(text, text, uuid);
--   DROP FUNCTION IF EXISTS public.crm_record_get(uuid);
--   DROP FUNCTION IF EXISTS public.crm_records_list(text);
--   DROP FUNCTION IF EXISTS public.crm_config();
--   DROP FUNCTION IF EXISTS public.crm_record_create_core(text, jsonb, text, text);
--   DROP FUNCTION IF EXISTS public.crm_apply_brand_link(uuid);
--   DROP FUNCTION IF EXISTS public.crm_reconcile_live(uuid);
--   DROP FUNCTION IF EXISTS public.crm_undoable_activity(uuid, text);
--   DROP FUNCTION IF EXISTS public.crm_request_finish(text, text, text, jsonb);
--   DROP FUNCTION IF EXISTS public.crm_request_begin(text, text, text);
--   DROP FUNCTION IF EXISTS public.crm_audit(text, text, text, text, jsonb);
--   DROP FUNCTION IF EXISTS public.crm_activity_json(public.crm_activity);
--   DROP FUNCTION IF EXISTS public.crm_record_lite_json(public.crm_records);
--   DROP FUNCTION IF EXISTS public.crm_record_json(public.crm_records);
--   DROP TABLE IF EXISTS public.crm_request_keys;
--   DROP TABLE IF EXISTS public.crm_activity;
--   DROP TABLE IF EXISTS public.crm_record_owners;
--   DROP TABLE IF EXISTS public.crm_records;
--   DROP FUNCTION IF EXISTS public.crm_validate_fields(text, jsonb, text);
--   DROP FUNCTION IF EXISTS public.crm_clean_owners(jsonb);
--   DROP FUNCTION IF EXISTS public.crm_brand_is_live(uuid);
--   DROP FUNCTION IF EXISTS public.crm_stage_def(text, text);
--   DROP FUNCTION IF EXISTS public.crm_vocab();
--   DROP FUNCTION IF EXISTS public.crm_pipeline_def(text);
--   DROP FUNCTION IF EXISTS public.crm_display_name(text);
--   DROP FUNCTION IF EXISTS public.crm_name_key(text);
--   DROP FUNCTION IF EXISTS public.crm_ctx();
--   DROP FUNCTION IF EXISTS public.admin_team_directory();
--   -- Restore the two replaced functions verbatim from
--   --   20270817003802_issue_3802_wave0_team_roles.sql   (admin_team_role_areas)
--   --   20261126000000_orch_1221_beta_access_brand_type_multi.sql (admin_beta_leads_list)
--   COMMIT;
-- ---------------------------------------------------------------------------

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Areas. The ONE place that maps a role to the areas it may use.
--
-- NEVER add 'admin_console' to a non-admin role — see
-- I-PROPOSED-3802-FULL-ADMIN-TABLE-HOLDS-ONLY-OWNER-AND-ADMIN. 'admin_console'
-- means every existing admin page, table and action, and must stay equivalent
-- to is_admin_user() for every caller. The order of the elements is part of
-- the contract (tests pin it).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_team_role_areas(p_role text) RETURNS text[]
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$
  SELECT CASE p_role
    WHEN 'owner'   THEN ARRAY['admin_console','team_manage','crm','beta_leads']
    WHEN 'admin'   THEN ARRAY['admin_console','crm','beta_leads']
    WHEN 'growth'  THEN ARRAY['role_home','crm','beta_leads']
    WHEN 'partner' THEN ARRAY['role_home','crm','beta_leads']
    ELSE ARRAY[]::text[]
  END
$$;
REVOKE EXECUTE ON FUNCTION public.admin_team_role_areas(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_team_role_areas(text) TO authenticated, service_role;
COMMENT ON FUNCTION public.admin_team_role_areas(text) IS
  'Issue #3802. The one role-to-areas map. NEVER add admin_console to a non-admin role: it must stay equivalent to is_admin_user() for every caller. Element order is pinned by tests.';

-- ---------------------------------------------------------------------------
-- 2. Team directory: every non-revoked person, one row each. Internal.
--
-- No gate inside because no client role can execute it. The crm_* functions
-- (which gate first) use it to validate owners and to name teammates.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.admin_team_directory()
RETURNS TABLE (email text, role text, status text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  WITH allrows AS (
    SELECT lower(btrim(au.email)) AS e,
           CASE WHEN au.role = 'owner' THEN 'owner' ELSE 'admin' END AS r,
           au.status AS s, au.accepted_at AS aa, au.created_at AS ca
    FROM public.admin_users au
    WHERE au.status <> 'revoked'
    UNION ALL
    SELECT m.email, m.role, m.status, m.accepted_at, m.created_at
    FROM public.admin_team_members m
    WHERE m.status <> 'revoked'
  ),
  ranked AS (
    SELECT a.e, a.r, a.s,
           row_number() OVER (PARTITION BY a.e
                              ORDER BY (a.s = 'active') DESC, a.aa DESC NULLS LAST, a.ca DESC) AS rn
    FROM allrows a
    WHERE a.e IS NOT NULL AND a.e <> ''
  )
  SELECT k.e, k.r, k.s
  FROM ranked k
  WHERE k.rn = 1
  ORDER BY (k.r = 'owner') DESC, k.e
$$;
REVOKE EXECUTE ON FUNCTION public.admin_team_directory() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_team_directory() TO service_role;
COMMENT ON FUNCTION public.admin_team_directory() IS
  'Issue #3802. Internal: every non-revoked team person (email, role, status). Not client-executable; read only through crm_* functions that gate first.';

-- ---------------------------------------------------------------------------
-- 3. Helpers (internal: service_role only; clients cannot execute them).
-- ---------------------------------------------------------------------------

-- Who is acting. The gate every client function runs FIRST.
CREATE FUNCTION public.crm_ctx()
RETURNS TABLE (actor_email text, via text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_email text;
BEGIN
  IF auth.uid() IS NULL OR NOT COALESCE(public.admin_team_can('crm'), false) THEN
    RAISE EXCEPTION 'forbidden: Your account cannot use Hosts and Creators. Ask the owner to give you team access.'
      USING ERRCODE = '42501';
  END IF;
  SELECT lower(btrim(u.email)) INTO v_email FROM auth.users u WHERE u.id = auth.uid();
  IF v_email IS NULL OR v_email = '' THEN
    RAISE EXCEPTION 'forbidden: Your account cannot use Hosts and Creators. Ask the owner to give you team access.'
      USING ERRCODE = '42501';
  END IF;
  actor_email := v_email;
  via := NULL;
  RETURN NEXT;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.crm_ctx() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_ctx() TO service_role;
COMMENT ON FUNCTION public.crm_ctx() IS
  'Issue #3802. Resolves (actor, via) and refuses anyone without the crm area. Wave 4 replaces this one function to resolve an agent key. No caller passes via: a browser cannot claim to be an agent.';

-- One name, one key: case, spacing, punctuation and characters nobody can
-- see do not make a new record. Every kind of blank space and every invisible
-- or control character is dropped first; '' means the name has nothing
-- visible in it, and such a name is refused (crm_validate_fields, and the
-- crm_records_name_check backstop).
CREATE FUNCTION public.crm_name_key(p_name text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT SET search_path = ''
AS $$
  SELECT CASE
    WHEN regexp_replace(v.seen, '[^[:alnum:]]+', '', 'g') = '' THEN v.seen
    ELSE regexp_replace(v.seen, '[^[:alnum:]]+', '', 'g')
  END
  FROM (SELECT lower(regexp_replace(p_name,
          '[\s\u0001-\u001F\u007F-\u00A0\u00AD\u034F\u061C\u115F\u1160\u1680\u17B4\u17B5\u180B-\u180F\u2000-\u200F\u2028-\u202F\u205F-\u206F\u3000\u3164\uFE00-\uFE0F\uFEFF\uFFA0\uFFF9-\uFFFB]+',
          '', 'g')) AS seen) v
$$;
REVOKE EXECUTE ON FUNCTION public.crm_name_key(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_name_key(text) TO service_role;

-- "tunde.a@usemingla.com" -> "Tunde". The team tables hold only addresses.
CREATE FUNCTION public.crm_display_name(p_email text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_email IS NULL OR btrim(p_email) = '' THEN NULL
    WHEN COALESCE((regexp_match(split_part(btrim(p_email), '@', 1), '^[^._+-]+'))[1], '') = '' THEN btrim(p_email)
    ELSE upper(left((regexp_match(split_part(btrim(p_email), '@', 1), '^[^._+-]+'))[1], 1))
         || substr((regexp_match(split_part(btrim(p_email), '@', 1), '^[^._+-]+'))[1], 2)
  END
$$;
REVOKE EXECUTE ON FUNCTION public.crm_display_name(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_display_name(text) TO service_role;

-- The ONE definition of stages and ICPs. The CHECK constraints on crm_records
-- repeat the ids; the self-check at the end proves the two agree.
CREATE FUNCTION public.crm_pipeline_def(p_pipeline text) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$
  SELECT CASE p_pipeline
    WHEN 'hosts' THEN $j${
      "id": "hosts", "label": "Hosts", "singular": "host",
      "stages": [
        {"id": "prospect",  "label": "Prospect",  "hint": "Not contacted yet"},
        {"id": "contacted", "label": "Contacted", "hint": "First message sent"},
        {"id": "replied",   "label": "Replied",   "hint": "They answered"},
        {"id": "meeting",   "label": "Meeting",   "hint": "Call or visit booked"},
        {"id": "onboarded", "label": "Onboarded", "hint": "Has a Mingla account"},
        {"id": "live",      "label": "Live",      "hint": "Has a public listing", "auto": true},
        {"id": "lost",      "label": "Lost",      "hint": "Not now, with a reason", "terminal": true}
      ],
      "icps": [
        {"id": "restaurant_bar",  "label": "Restaurant or bar"},
        {"id": "venue_gallery",   "label": "Venue or gallery"},
        {"id": "event_organizer", "label": "Event organizer"},
        {"id": "community_host",  "label": "Community host"},
        {"id": "trip_stay_host",  "label": "Trip or stay host"},
        {"id": "partner_org",     "label": "Partner org"}
      ],
      "reached_stages": ["onboarded", "live"]
    }$j$::jsonb
    WHEN 'creators' THEN $j${
      "id": "creators", "label": "Creators", "singular": "creator",
      "stages": [
        {"id": "identified",  "label": "Identified",  "hint": "Not contacted yet"},
        {"id": "contacted",   "label": "Contacted",   "hint": "First message sent"},
        {"id": "replied",     "label": "Replied",     "hint": "They answered"},
        {"id": "negotiating", "label": "Negotiating", "hint": "Talking terms"},
        {"id": "booked",      "label": "Booked",      "hint": "Agreement signed"},
        {"id": "posted",      "label": "Posted",      "hint": "First post is up"},
        {"id": "passed",      "label": "Passed",      "hint": "Not now, with a reason", "terminal": true}
      ],
      "icps": [
        {"id": "ambassador",  "label": "Ambassador"},
        {"id": "ugc_one_off", "label": "UGC one-off"}
      ],
      "reached_stages": ["booked", "posted"]
    }$j$::jsonb
    ELSE NULL
  END
$$;
REVOKE EXECUTE ON FUNCTION public.crm_pipeline_def(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_pipeline_def(text) TO service_role;

-- The other pick-lists (channel, source, reply classification, agreement).
CREATE FUNCTION public.crm_vocab() RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$
  SELECT $j${
    "channels": [
      {"id": "email",        "label": "Email"},
      {"id": "whatsapp",     "label": "WhatsApp"},
      {"id": "instagram_dm", "label": "Instagram DM"},
      {"id": "tiktok_dm",    "label": "TikTok DM"},
      {"id": "phone",        "label": "Phone"},
      {"id": "in_person",    "label": "In person"}
    ],
    "sources": [
      {"id": "place_pool", "label": "Mingla place pool"},
      {"id": "instagram",  "label": "Instagram"},
      {"id": "tiktok",     "label": "TikTok"},
      {"id": "referral",   "label": "Referral"},
      {"id": "event",      "label": "Event"},
      {"id": "inbound",    "label": "Inbound"}
    ],
    "reply_classes": [
      {"id": "interested",    "label": "Interested"},
      {"id": "question",      "label": "Question"},
      {"id": "not_now",       "label": "Not now"},
      {"id": "wrong_contact", "label": "Wrong contact"}
    ],
    "agreements": [
      {"id": "none",   "label": "None"},
      {"id": "sent",   "label": "Sent"},
      {"id": "signed", "label": "Signed"}
    ]
  }$j$::jsonb
$$;
REVOKE EXECUTE ON FUNCTION public.crm_vocab() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_vocab() TO service_role;

-- One stage of one pipeline, with its position ("pos", 1-based), or NULL.
CREATE FUNCTION public.crm_stage_def(p_pipeline text, p_stage text) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$
  SELECT s.def || jsonb_build_object('pos', s.ord)
  FROM jsonb_array_elements(public.crm_pipeline_def(p_pipeline)->'stages') WITH ORDINALITY AS s(def, ord)
  WHERE s.def->>'id' = p_stage
$$;
REVOKE EXECUTE ON FUNCTION public.crm_stage_def(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_stage_def(text, text) TO service_role;

-- "Does this brand have a public listing?" The three public views are
-- referenced, not copied, so the meaning of "public" stays in one place:
-- a scheduled or live public event, trip, experience or RSVP page; a verified
-- venue; a bookable stay.
--
-- A listing whose visibility is `discover` counts too (decision on #3802): a
-- brand's own site and its share pages present such a listing to anyone, the
-- same as a public one. No public view carries those rows, so that one leg
-- reads events with the same conditions the brand site's listing projection
-- uses (brand_site_commercial_projection): not deleted, scheduled or live.
CREATE FUNCTION public.crm_brand_is_live(p_brand_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT p_brand_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.brands b WHERE b.id = p_brand_id AND b.deleted_at IS NULL)
     AND (
          EXISTS (SELECT 1 FROM public.events_public_view e WHERE e.brand_id = p_brand_id)
       OR EXISTS (SELECT 1 FROM public.events d
                   WHERE d.brand_id = p_brand_id
                     AND d.deleted_at IS NULL
                     AND d.visibility = 'discover'
                     AND d.status IN ('scheduled', 'live'))
       OR EXISTS (SELECT 1 FROM public.claimed_venues_public_view v WHERE v.id = p_brand_id)
       OR EXISTS (SELECT 1 FROM public.ad_public_stay_destinations_view s WHERE s.brand_id = p_brand_id)
     )
$$;
REVOKE EXECUTE ON FUNCTION public.crm_brand_is_live(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_brand_is_live(uuid) TO service_role;

-- Owners: a JSON list of addresses -> normalised, de-duplicated, sorted.
-- NULL in -> NULL out (the caller decides the default).
CREATE FUNCTION public.crm_clean_owners(p_owners jsonb) RETURNS text[]
LANGUAGE plpgsql STABLE SET search_path = ''
AS $$
DECLARE
  v_out text[];
  v_bad text;
BEGIN
  IF p_owners IS NULL OR jsonb_typeof(p_owners) = 'null' THEN
    RETURN NULL;
  END IF;
  IF jsonb_typeof(p_owners) <> 'array' THEN
    RAISE EXCEPTION 'invalid_owners: Send owners as a list of team email addresses, for example ["name@usemingla.com"]. An empty list means unassigned.'
      USING ERRCODE = '22023';
  END IF;
  SELECT COALESCE(array_agg(DISTINCT x.e ORDER BY x.e), ARRAY[]::text[]) INTO v_out
  FROM (SELECT lower(btrim(t.v)) AS e FROM jsonb_array_elements_text(p_owners) AS t(v)) x
  WHERE x.e IS NOT NULL AND x.e <> '';
  IF cardinality(v_out) > 10 THEN
    RAISE EXCEPTION 'too_many_owners: A card can have at most 10 owners.' USING ERRCODE = '22023';
  END IF;
  SELECT o.e INTO v_bad
  FROM unnest(v_out) AS o(e)
  WHERE NOT EXISTS (SELECT 1 FROM public.admin_team_directory() d WHERE d.email = o.e)
  ORDER BY o.e
  LIMIT 1;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '%', format('unknown_owner: %s is not on the team. Use an address from crm_config().team.', v_bad)
      USING ERRCODE = '22023';
  END IF;
  RETURN v_out;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.crm_clean_owners(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_clean_owners(jsonb) TO service_role;

-- The ONE place a caller's values are normalised and checked. Used by create,
-- bulk create and update (the fields of a record), by a stage move (the
-- reason) and by the log (a note or a touch). Returns the cleaned values
-- (only the keys that were sent; JSON null = cleared) or raises one of these
-- functions' own messages (22023), each naming the valid values. No caller
-- reaches a table constraint: the constraints repeat these rules as a
-- backstop only.
--
-- p_mode: 'create' | 'update' (record fields), 'reason' (the one key
-- stage_reason, required, for a move into Lost or Passed), 'log' (one entry).
--
-- Text is normalised before any rule is applied:
--   * control characters and characters nobody can see (zero-width space,
--     direction marks, word joiner, byte-order mark, soft hyphen, blank
--     fillers) are removed;
--   * every kind of blank space, including the non-breaking and wide ones,
--     counts as a space: runs become one space and the ends are trimmed (a
--     note's text keeps its line breaks; only its ends are trimmed);
--   * a value with nothing visible left counts as not sent.
-- The joiners and variation marks that shape emoji and some scripts are kept
-- inside a value, but a value made only of them is nothing visible.
CREATE FUNCTION public.crm_validate_fields(p_pipeline text, p_fields jsonb, p_mode text) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = ''
AS $$
DECLARE
  c_hidden  constant text := '[\u0001-\u0008\u000E-\u001F\u007F-\u0084\u0086-\u009F\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180B-\u180F\u200B\u200E\u200F\u202A-\u202E\u2060-\u206F\u3164\uFEFF\uFFA0\uFFF9-\uFFFB]';
  c_space   constant text := '[\s\u0085\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]';
  c_shaping constant text := '[\u200C\u200D\uFE00-\uFE0F]';
  -- A logged time must be a real moment in this window (both ends included).
  c_earliest constant timestamptz := '2020-01-01 00:00:00+00';
  c_ahead    constant interval := interval '5 minutes';
  v_def     jsonb := public.crm_pipeline_def(p_pipeline);
  v_vocab   jsonb := public.crm_vocab();
  v_allowed text[];
  v_out     jsonb := '{}'::jsonb;
  v_key     text;
  v_val     jsonb;
  v_type    text;
  v_txt     text;
  v_list    text;
  v_uuid    uuid;
  v_date    date;
  v_when    timestamptz;
  v_max     integer;
BEGIN
  IF p_mode IS NULL OR p_mode NOT IN ('create', 'update', 'reason', 'log') THEN
    RAISE EXCEPTION 'invalid_mode: crm_validate_fields takes create, update, reason or log.' USING ERRCODE = '22023';
  END IF;
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'invalid_pipeline: Use hosts or creators.' USING ERRCODE = '22023';
  END IF;
  IF p_fields IS NULL OR jsonb_typeof(p_fields) <> 'object' THEN
    IF p_mode = 'log' THEN
      RAISE EXCEPTION 'invalid_entry: Send the entry as one JSON object, for example {"kind": "note", "body": "Called, no answer."}.'
        USING ERRCODE = '22023';
    END IF;
    RAISE EXCEPTION 'invalid_fields: Send the fields as one JSON object, for example {"name": "Palm Court Kitchen"}.'
      USING ERRCODE = '22023';
  END IF;
  v_allowed := CASE p_mode
    WHEN 'reason' THEN ARRAY['stage_reason']
    WHEN 'log'    THEN ARRAY['kind','body','channel','direction','message_ref','reply_class','occurred_at']
    ELSE ARRAY['name','icp','region_id','contact','channel','source','next_action',
               'due_on','brand_id','place_pool_id','followers','agreement','rate']
  END;
  IF p_mode = 'create' THEN
    v_allowed := v_allowed || ARRAY['owners'];
  END IF;

  FOR v_key, v_val IN SELECT e.key, e.value FROM jsonb_each(p_fields) e ORDER BY e.key LOOP
    IF NOT (v_key = ANY (v_allowed)) THEN
      IF p_mode = 'update' THEN
        RAISE EXCEPTION '%', format('unknown_field: "%s" cannot be changed here. Use crm_record_move_stage for stage and crm_record_set_owners for owners.', v_key)
          USING ERRCODE = '22023';
      ELSIF p_mode = 'log' THEN
        RAISE EXCEPTION '%', format('unknown_field: "%s" is not part of a log entry. Use any of: kind, body, channel, direction, message_ref, reply_class, occurred_at.', v_key)
          USING ERRCODE = '22023';
      ELSIF p_mode = 'reason' THEN
        RAISE EXCEPTION '%', format('unknown_field: "%s" is not part of a stage move.', v_key) USING ERRCODE = '22023';
      END IF;
      RAISE EXCEPTION '%', format('unknown_field: "%s" is not a field of a new record. A new record always starts in the first stage. Use any of: %s.', v_key, array_to_string(v_allowed, ', '))
        USING ERRCODE = '22023';
    END IF;

    IF v_key = 'owners' THEN
      v_out := v_out || jsonb_build_object('owners', to_jsonb(public.crm_clean_owners(v_val)));
      CONTINUE;
    END IF;

    IF p_mode IN ('create', 'update') THEN
      IF p_pipeline <> 'hosts' AND v_key IN ('brand_id','place_pool_id') THEN
        RAISE EXCEPTION '%', format('field_not_for_pipeline: "%s" only applies to Hosts. Leave it out for a creator.', v_key)
          USING ERRCODE = '22023';
      END IF;
      IF p_pipeline <> 'creators' AND v_key IN ('followers','agreement','rate') THEN
        RAISE EXCEPTION '%', format('field_not_for_pipeline: "%s" only applies to Creators. Leave it out for a host.', v_key)
          USING ERRCODE = '22023';
      END IF;
    END IF;

    v_type := jsonb_typeof(v_val);
    IF v_type IN ('array','object') THEN
      RAISE EXCEPTION '%', format('invalid_value: "%s" takes one value, not a list or an object.', v_key)
        USING ERRCODE = '22023';
    END IF;

    -- Normalise (see the comment above this function).
    v_txt := CASE WHEN v_type = 'null' THEN NULL
                  ELSE regexp_replace(v_val #>> '{}', c_hidden, '', 'g') END;
    IF v_key = 'body' THEN
      v_txt := regexp_replace(v_txt, '^' || c_space || '+|' || c_space || '+$', '', 'g');
    ELSE
      v_txt := btrim(regexp_replace(v_txt, c_space || '+', ' ', 'g'));
    END IF;
    IF v_txt IS NOT NULL AND regexp_replace(v_txt, c_shaping || '+', '', 'g') = '' THEN
      v_txt := NULL;
    END IF;

    IF p_mode = 'reason' THEN
      IF v_txt IS NULL THEN
        RAISE EXCEPTION 'reason_required: Add one line saying why, so the next person knows.' USING ERRCODE = '22023';
      END IF;
      IF char_length(v_txt) > 300 THEN
        RAISE EXCEPTION 'reason_required: Keep the reason to one line of 300 characters or fewer.' USING ERRCODE = '22023';
      END IF;
      v_out := v_out || jsonb_build_object('stage_reason', v_txt);

    ELSIF p_mode = 'log' THEN
      -- Cleaned here; the rules that span several keys follow the loop.
      v_out := v_out || jsonb_build_object(v_key, v_txt);

    ELSIF v_key = 'name' THEN
      IF v_txt IS NULL OR char_length(v_txt) > 160 OR public.crm_name_key(v_txt) = '' THEN
        RAISE EXCEPTION 'invalid_name: Add a name between 1 and 160 characters.' USING ERRCODE = '22023';
      END IF;
      v_out := v_out || jsonb_build_object('name', v_txt);

    ELSIF v_key = 'icp' THEN
      IF v_txt IS NOT NULL AND NOT EXISTS (
           SELECT 1 FROM jsonb_array_elements(v_def->'icps') i WHERE i->>'id' = v_txt) THEN
        SELECT string_agg(i->>'id', ', ') INTO v_list FROM jsonb_array_elements(v_def->'icps') i;
        RAISE EXCEPTION '%', format('invalid_icp: %s is not an ICP for %s. Use one of: %s.', v_txt, p_pipeline, v_list)
          USING ERRCODE = '22023';
      END IF;
      v_out := v_out || jsonb_build_object('icp', v_txt);

    ELSIF v_key IN ('channel','source','agreement') THEN
      IF v_txt IS NOT NULL AND NOT EXISTS (
           SELECT 1 FROM jsonb_array_elements(v_vocab->(v_key || 's')) i WHERE i->>'id' = v_txt) THEN
        SELECT string_agg(i->>'id', ', ') INTO v_list FROM jsonb_array_elements(v_vocab->(v_key || 's')) i;
        RAISE EXCEPTION '%', format('invalid_%s: %s is not a known %s. Use one of: %s.', v_key, v_txt, v_key, v_list)
          USING ERRCODE = '22023';
      END IF;
      v_out := v_out || jsonb_build_object(v_key, v_txt);

    ELSIF v_key IN ('contact','next_action','rate') THEN
      v_max := CASE v_key WHEN 'contact' THEN 300 WHEN 'next_action' THEN 200 ELSE 120 END;
      IF v_txt IS NOT NULL AND char_length(v_txt) > v_max THEN
        RAISE EXCEPTION '%', format('invalid_%s: Keep "%s" to %s characters or fewer.', v_key, v_key, v_max)
          USING ERRCODE = '22023';
      END IF;
      v_out := v_out || jsonb_build_object(v_key, v_txt);

    ELSIF v_key = 'due_on' THEN
      v_date := NULL;
      IF v_txt IS NOT NULL THEN
        IF v_txt !~ '^\d{4}-\d{2}-\d{2}$' THEN
          RAISE EXCEPTION 'invalid_due_on: Send the date as YYYY-MM-DD, for example 2026-10-31.' USING ERRCODE = '22023';
        END IF;
        BEGIN
          v_date := v_txt::date;
        EXCEPTION WHEN others THEN
          RAISE EXCEPTION 'invalid_due_on: Send the date as YYYY-MM-DD, for example 2026-10-31.' USING ERRCODE = '22023';
        END;
      END IF;
      v_out := v_out || jsonb_build_object('due_on', v_date);

    ELSIF v_key = 'followers' THEN
      IF v_txt IS NOT NULL AND v_txt !~ '^\d{1,9}$' THEN
        RAISE EXCEPTION 'invalid_followers: Followers must be a whole number, 0 or more.' USING ERRCODE = '22023';
      END IF;
      v_out := v_out || jsonb_build_object('followers', v_txt::integer);

    ELSE
      -- region_id, brand_id, place_pool_id: an id that must exist.
      v_uuid := NULL;
      IF v_txt IS NOT NULL THEN
        BEGIN
          v_uuid := v_txt::uuid;
        EXCEPTION WHEN others THEN
          v_uuid := NULL;
        END;
        IF v_key = 'region_id' AND (v_uuid IS NULL OR NOT EXISTS (
             SELECT 1 FROM public.seeding_cities c WHERE c.id = v_uuid)) THEN
          RAISE EXCEPTION 'invalid_region: That region is not in the Launch Cities list. Use an id from crm_config().regions.'
            USING ERRCODE = '22023';
        ELSIF v_key = 'brand_id' AND (v_uuid IS NULL OR NOT EXISTS (
             SELECT 1 FROM public.brands b WHERE b.id = v_uuid AND b.deleted_at IS NULL)) THEN
          RAISE EXCEPTION 'invalid_brand: That brand is not on Mingla, or was deleted. Pick one with crm_link_search(''brand'', name).'
            USING ERRCODE = '22023';
        ELSIF v_key = 'place_pool_id' AND (v_uuid IS NULL OR NOT EXISTS (
             SELECT 1 FROM public.place_pool p WHERE p.id = v_uuid)) THEN
          RAISE EXCEPTION 'invalid_place: That place is not in the Mingla place pool. Pick one with crm_link_search(''place'', name).'
            USING ERRCODE = '22023';
        END IF;
      END IF;
      v_out := v_out || jsonb_build_object(v_key, v_uuid);
    END IF;
  END LOOP;

  IF p_mode = 'create' AND NOT (v_out ? 'name') THEN
    RAISE EXCEPTION 'invalid_name: Add a name between 1 and 160 characters.' USING ERRCODE = '22023';
  END IF;
  IF p_mode = 'reason' AND NOT (v_out ? 'stage_reason') THEN
    RAISE EXCEPTION 'reason_required: Add one line saying why, so the next person knows.' USING ERRCODE = '22023';
  END IF;

  IF p_mode = 'log' THEN
    IF (v_out->>'kind') IS NULL OR (v_out->>'kind') NOT IN ('note', 'touch') THEN
      RAISE EXCEPTION 'invalid_kind: A log entry is a note or a touch. Send kind as note or touch.' USING ERRCODE = '22023';
    END IF;
    IF char_length(COALESCE(v_out->>'body', '')) > 4000 THEN
      RAISE EXCEPTION 'invalid_body: Keep the text to 4000 characters or fewer.' USING ERRCODE = '22023';
    END IF;

    IF (v_out->>'kind') = 'note' THEN
      IF (v_out->>'body') IS NULL THEN
        RAISE EXCEPTION 'invalid_body: Write what happened first.' USING ERRCODE = '22023';
      END IF;
      IF (v_out->>'channel') IS NOT NULL OR (v_out->>'direction') IS NOT NULL
         OR (v_out->>'message_ref') IS NOT NULL OR (v_out->>'reply_class') IS NOT NULL THEN
        RAISE EXCEPTION 'field_not_for_kind: channel, direction, message_ref and reply_class only apply to a touch. Send kind as touch, or leave them out.'
          USING ERRCODE = '22023';
      END IF;
    ELSE
      IF (v_out->>'channel') IS NULL OR NOT EXISTS (
           SELECT 1 FROM jsonb_array_elements(v_vocab->'channels') i WHERE i->>'id' = (v_out->>'channel')) THEN
        SELECT string_agg(i->>'id', ', ') INTO v_list FROM jsonb_array_elements(v_vocab->'channels') i;
        RAISE EXCEPTION '%', format('invalid_channel: A touch needs a channel. Use one of: %s.', v_list) USING ERRCODE = '22023';
      END IF;
      IF (v_out->>'direction') IS NULL OR (v_out->>'direction') NOT IN ('outbound', 'inbound') THEN
        RAISE EXCEPTION 'invalid_direction: A touch needs a direction. Use outbound (you reached out) or inbound (they replied).'
          USING ERRCODE = '22023';
      END IF;
      IF (v_out->>'reply_class') IS NOT NULL AND (v_out->>'direction') <> 'inbound' THEN
        RAISE EXCEPTION 'invalid_reply_class: A reply classification only applies to a message they sent you.' USING ERRCODE = '22023';
      END IF;
      IF (v_out->>'reply_class') IS NOT NULL AND NOT EXISTS (
           SELECT 1 FROM jsonb_array_elements(v_vocab->'reply_classes') i WHERE i->>'id' = (v_out->>'reply_class')) THEN
        SELECT string_agg(i->>'id', ', ') INTO v_list FROM jsonb_array_elements(v_vocab->'reply_classes') i;
        RAISE EXCEPTION '%', format('invalid_reply_class: %s is not a reply classification. Use one of: %s.', v_out->>'reply_class', v_list)
          USING ERRCODE = '22023';
      END IF;
      IF char_length(COALESCE(v_out->>'message_ref', '')) > 500 THEN
        RAISE EXCEPTION 'invalid_message_ref: Keep the message link or id to 500 characters or fewer.' USING ERRCODE = '22023';
      END IF;
    END IF;

    -- When it happened: a real moment, on or after 1 January 2020 (UTC) and
    -- no more than 5 minutes ahead of the server clock (room for a device
    -- whose clock runs fast). "infinity" and "-infinity" are not moments.
    IF (v_out->>'occurred_at') IS NOT NULL THEN
      BEGIN
        v_when := (v_out->>'occurred_at')::timestamptz;
      EXCEPTION WHEN others THEN
        RAISE EXCEPTION 'invalid_occurred_at: Send the time as an ISO timestamp, for example 2026-10-12T15:30:00Z.' USING ERRCODE = '22023';
      END;
      IF NOT isfinite(v_when) THEN
        RAISE EXCEPTION 'invalid_occurred_at: Send the time as an ISO timestamp, for example 2026-10-12T15:30:00Z.' USING ERRCODE = '22023';
      END IF;
      IF v_when > clock_timestamp() + c_ahead THEN
        RAISE EXCEPTION 'invalid_occurred_at: That time is in the future. Log it once it has happened.' USING ERRCODE = '22023';
      END IF;
      IF v_when < c_earliest THEN
        RAISE EXCEPTION 'invalid_occurred_at: That time is too far back. Send a time on or after 1 January 2020.' USING ERRCODE = '22023';
      END IF;
      v_out := v_out || jsonb_build_object('occurred_at', v_when);
    END IF;
  END IF;
  RETURN v_out;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.crm_validate_fields(text, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_validate_fields(text, jsonb, text) TO service_role;

-- ---------------------------------------------------------------------------
-- 4. Tables. Row security on, NO policies, no client privilege.
-- ---------------------------------------------------------------------------
CREATE TABLE public.crm_records (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline       text NOT NULL,
  name           text NOT NULL,
  name_key       text GENERATED ALWAYS AS (public.crm_name_key(name)) STORED,
  icp            text,
  region_id      uuid,                       -- seeding_cities.id, validated on write
  stage          text NOT NULL,
  stage_reason   text,
  contact        text,
  channel        text,
  source         text,
  next_action    text,
  due_on         date,
  brand_id       uuid,                       -- hosts only; validated on write
  -- A place_pool id. The column is NOT called place_pool_id on purpose: the
  -- venue-identity tooling inventories every table that has a column of that
  -- name, and a pipeline link is not part of a venue's identity. The functions
  -- still call the field place_pool_id.
  place_id       uuid,                       -- hosts only; validated on write
  beta_lead_id   uuid,                       -- hosts only; set by Add to Hosts
  followers      integer,                    -- creators only
  agreement      text,                       -- creators only
  rate           text,                       -- creators only
  went_live_at   timestamptz,
  created_by     text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     text NOT NULL,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  deleted_at     timestamptz,
  deleted_by     text,
  CONSTRAINT crm_records_pipeline_check CHECK (pipeline IN ('hosts','creators')),
  CONSTRAINT crm_records_name_check CHECK (name = btrim(name) AND char_length(name) BETWEEN 1 AND 160
                                           AND public.crm_name_key(name) <> ''),
  CONSTRAINT crm_records_stage_check CHECK (
    (pipeline = 'hosts'    AND stage IN ('prospect','contacted','replied','meeting','onboarded','live','lost')) OR
    (pipeline = 'creators' AND stage IN ('identified','contacted','replied','negotiating','booked','posted','passed'))),
  CONSTRAINT crm_records_icp_check CHECK (icp IS NULL OR
    (pipeline = 'hosts'    AND icp IN ('restaurant_bar','venue_gallery','event_organizer','community_host','trip_stay_host','partner_org')) OR
    (pipeline = 'creators' AND icp IN ('ambassador','ugc_one_off'))),
  CONSTRAINT crm_records_reason_check CHECK (
    (stage IN ('lost','passed') AND char_length(btrim(COALESCE(stage_reason,''))) BETWEEN 1 AND 300) OR
    (stage NOT IN ('lost','passed') AND stage_reason IS NULL)),
  CONSTRAINT crm_records_channel_check CHECK (channel IS NULL OR channel IN ('email','whatsapp','instagram_dm','tiktok_dm','phone','in_person')),
  CONSTRAINT crm_records_source_check CHECK (source IS NULL OR source IN ('place_pool','instagram','tiktok','referral','event','inbound')),
  CONSTRAINT crm_records_agreement_check CHECK (agreement IS NULL OR agreement IN ('none','sent','signed')),
  CONSTRAINT crm_records_followers_check CHECK (followers IS NULL OR followers >= 0),
  CONSTRAINT crm_records_text_lengths CHECK (
    char_length(COALESCE(contact,'')) <= 300 AND char_length(COALESCE(next_action,'')) <= 200 AND char_length(COALESCE(rate,'')) <= 120),
  CONSTRAINT crm_records_host_only CHECK (pipeline = 'hosts' OR (brand_id IS NULL AND place_id IS NULL AND beta_lead_id IS NULL AND went_live_at IS NULL)),
  CONSTRAINT crm_records_creator_only CHECK (pipeline = 'creators' OR (followers IS NULL AND agreement IS NULL AND rate IS NULL)),
  CONSTRAINT crm_records_deleted_pair CHECK ((deleted_at IS NULL) = (deleted_by IS NULL))
);
CREATE UNIQUE INDEX crm_records_live_name_key   ON public.crm_records (pipeline, name_key) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX crm_records_live_beta_lead  ON public.crm_records (beta_lead_id) WHERE beta_lead_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX crm_records_pipeline_stage ON public.crm_records (pipeline, stage) WHERE deleted_at IS NULL;
CREATE INDEX crm_records_due           ON public.crm_records (due_on) WHERE deleted_at IS NULL AND due_on IS NOT NULL;
CREATE INDEX crm_records_brand         ON public.crm_records (brand_id) WHERE brand_id IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE public.crm_record_owners (
  record_id   uuid NOT NULL REFERENCES public.crm_records(id) ON DELETE CASCADE,
  owner_email text NOT NULL,
  added_by    text NOT NULL,
  added_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (record_id, owner_email),
  CONSTRAINT crm_record_owners_email_normalised CHECK (owner_email = lower(btrim(owner_email)) AND owner_email <> '')
);
CREATE INDEX crm_record_owners_by_owner ON public.crm_record_owners (owner_email);

CREATE TABLE public.crm_activity (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  record_id    uuid NOT NULL REFERENCES public.crm_records(id) ON DELETE CASCADE,
  kind         text NOT NULL,
  actor_email  text,                         -- NULL only for the system
  via          text,                         -- NULL = a person; 'system'; later an agent name
  body         text,
  from_stage   text,
  to_stage     text,
  channel      text,
  direction    text,
  message_ref  text,
  reply_class  text,
  occurred_at  timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crm_activity_kind_check CHECK (kind IN ('created','note','stage_move','touch')),
  -- COALESCE and the IS NOT NULL tests below matter: a CHECK passes on NULL, so
  -- without them a line with no author, or a touch with no direction, would be
  -- accepted from a writer that skips the functions.
  CONSTRAINT crm_activity_actor_check CHECK (actor_email IS NOT NULL OR COALESCE(via = 'system', false)),
  CONSTRAINT crm_activity_via_check CHECK (via IS NULL OR via ~ '^[a-z0-9_-]{1,40}$'),
  CONSTRAINT crm_activity_body_check CHECK (char_length(COALESCE(body,'')) <= 4000),
  CONSTRAINT crm_activity_note_check CHECK (kind <> 'note' OR char_length(btrim(COALESCE(body,''))) >= 1),
  CONSTRAINT crm_activity_move_check CHECK ((kind = 'stage_move') = (from_stage IS NOT NULL AND to_stage IS NOT NULL)),
  CONSTRAINT crm_activity_touch_check CHECK (
    (kind = 'touch' AND channel IS NOT NULL AND direction IS NOT NULL
                    AND channel IN ('email','whatsapp','instagram_dm','tiktok_dm','phone','in_person')
                    AND direction IN ('outbound','inbound')) OR
    (kind <> 'touch' AND channel IS NULL AND direction IS NULL AND message_ref IS NULL AND reply_class IS NULL)),
  CONSTRAINT crm_activity_reply_check CHECK (reply_class IS NULL OR
    (direction = 'inbound' AND reply_class IN ('interested','question','not_now','wrong_contact'))),
  CONSTRAINT crm_activity_ref_check CHECK (char_length(COALESCE(message_ref,'')) <= 500)
);
CREATE INDEX crm_activity_by_record ON public.crm_activity (record_id, occurred_at DESC, created_at DESC);
CREATE INDEX crm_activity_by_actor  ON public.crm_activity (actor_email, occurred_at DESC);

CREATE TABLE public.crm_request_keys (
  actor_email text NOT NULL,
  request_key text NOT NULL,
  fn          text NOT NULL,
  response    jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (actor_email, request_key),
  CONSTRAINT crm_request_keys_format CHECK (request_key ~ '^[A-Za-z0-9_-]{8,80}$')
);

ALTER TABLE public.crm_records       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_record_owners ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_activity      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_request_keys  ENABLE ROW LEVEL SECURITY;
-- No policies on purpose: every read and write goes through the crm_* functions.
REVOKE ALL ON public.crm_records       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.crm_record_owners FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.crm_activity      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.crm_request_keys  FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.crm_records       TO service_role;
GRANT ALL ON public.crm_record_owners TO service_role;
GRANT ALL ON public.crm_activity      TO service_role;
GRANT ALL ON public.crm_request_keys  TO service_role;
COMMENT ON TABLE public.crm_records IS
  'Issue #3802. Hosts and Creators pipeline records. No client reads or writes: use crm_* functions. Links to brands, places, cities and beta leads are plain ids validated on write (no foreign keys on purpose).';
COMMENT ON TABLE public.crm_record_owners IS
  'Issue #3802. Who owns a pipeline record (normalised team email). No client reads or writes: use crm_* functions.';
COMMENT ON TABLE public.crm_activity IS
  'Issue #3802. Structured activity log for pipeline records (created, note, stage move, touch). via is NULL for a person, system for automatic entries, later an agent name. No client reads or writes: use crm_* functions.';
COMMENT ON TABLE public.crm_request_keys IS
  'Issue #3802. Request keys that make create, bulk create and log safe to repeat. Purged after 30 days by crm_reconcile_live(). No client reads or writes: use crm_* functions.';

-- ---------------------------------------------------------------------------
-- 5. Internal builders and writers (service_role only).
-- ---------------------------------------------------------------------------

-- The record shape every function returns.
CREATE FUNCTION public.crm_record_json(r public.crm_records) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'id', r.id, 'pipeline', r.pipeline, 'name', r.name, 'icp', r.icp, 'region_id', r.region_id,
    'stage', r.stage, 'stage_reason', r.stage_reason, 'contact', r.contact, 'channel', r.channel,
    'source', r.source, 'next_action', r.next_action, 'due_on', r.due_on,
    'owners', COALESCE((SELECT jsonb_agg(o.owner_email ORDER BY o.owner_email)
                          FROM public.crm_record_owners o WHERE o.record_id = r.id), '[]'::jsonb),
    'brand_id', r.brand_id,
    'brand_name', (SELECT b.name FROM public.brands b WHERE b.id = r.brand_id AND b.deleted_at IS NULL),
    'place_pool_id', r.place_id,
    'place_name', (SELECT p.name FROM public.place_pool p WHERE p.id = r.place_id AND p.deleted_at IS NULL),
    'beta_lead_id', r.beta_lead_id, 'followers', r.followers, 'agreement', r.agreement, 'rate', r.rate,
    'went_live_at', r.went_live_at,
    'last_touch_at', (SELECT max(a.occurred_at) FROM public.crm_activity a WHERE a.record_id = r.id AND a.kind = 'touch'),
    'touch_count', (SELECT count(*) FROM public.crm_activity a WHERE a.record_id = r.id AND a.kind = 'touch'),
    'created_by', r.created_by, 'created_at', r.created_at, 'updated_at', r.updated_at)
$$;
REVOKE EXECUTE ON FUNCTION public.crm_record_json(public.crm_records) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_record_json(public.crm_records) TO service_role;

CREATE FUNCTION public.crm_record_lite_json(r public.crm_records) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'id', r.id, 'name', r.name, 'stage', r.stage,
    'owners', COALESCE((SELECT jsonb_agg(o.owner_email ORDER BY o.owner_email)
                          FROM public.crm_record_owners o WHERE o.record_id = r.id), '[]'::jsonb))
$$;
REVOKE EXECUTE ON FUNCTION public.crm_record_lite_json(public.crm_records) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_record_lite_json(public.crm_records) TO service_role;

CREATE FUNCTION public.crm_activity_json(a public.crm_activity) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'id', a.id, 'kind', a.kind, 'actor_email', a.actor_email,
    'actor_name', CASE WHEN a.actor_email IS NULL THEN 'System' ELSE public.crm_display_name(a.actor_email) END,
    'via', a.via, 'body', a.body, 'from_stage', a.from_stage, 'to_stage', a.to_stage,
    'channel', a.channel, 'direction', a.direction, 'message_ref', a.message_ref,
    'reply_class', a.reply_class, 'occurred_at', a.occurred_at)
$$;
REVOKE EXECUTE ON FUNCTION public.crm_activity_json(public.crm_activity) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_activity_json(public.crm_activity) TO service_role;

-- One audit row. p_actor is the acting person's email, or 'system'.
CREATE FUNCTION public.crm_audit(p_actor text, p_action text, p_target_type text, p_target_id text, p_metadata jsonb)
RETURNS void
LANGUAGE sql VOLATILE SET search_path = ''
AS $$
  INSERT INTO public.admin_audit_log (admin_email, action, target_type, target_id, metadata, actor_uid, created_at)
  VALUES (p_actor, p_action, p_target_type, p_target_id, COALESCE(p_metadata, '{}'::jsonb),
          CASE WHEN p_actor = 'system' THEN NULL ELSE auth.uid() END, clock_timestamp())
$$;
REVOKE EXECUTE ON FUNCTION public.crm_audit(text, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_audit(text, text, text, text, jsonb) TO service_role;

-- Request keys. begin: NULL = run it; a JSON answer = this is a replay.
CREATE FUNCTION public.crm_request_begin(p_actor text, p_key text, p_fn text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SET search_path = ''
AS $$
DECLARE
  v_fn  text;
  v_res jsonb;
BEGIN
  IF p_key IS NULL OR p_key !~ '^[A-Za-z0-9_-]{8,80}$' THEN
    RAISE EXCEPTION 'request_key_required: Send a request key (8 to 80 letters, digits, - or _) so a repeat changes nothing.'
      USING ERRCODE = '22023';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('crm_req:' || p_actor || ':' || p_key, 0));
  SELECT k.fn, k.response INTO v_fn, v_res
  FROM public.crm_request_keys k
  WHERE k.actor_email = p_actor AND k.request_key = p_key;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  IF v_fn IS DISTINCT FROM p_fn THEN
    RAISE EXCEPTION 'request_key_reused: That request key was already used for a different action. Send a new key for each new request.'
      USING ERRCODE = '22023';
  END IF;
  RETURN v_res || jsonb_build_object('replayed', true);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.crm_request_begin(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_request_begin(text, text, text) TO service_role;

CREATE FUNCTION public.crm_request_finish(p_actor text, p_key text, p_fn text, p_response jsonb) RETURNS void
LANGUAGE sql VOLATILE SET search_path = ''
AS $$
  INSERT INTO public.crm_request_keys (actor_email, request_key, fn, response, created_at)
  VALUES (p_actor, p_key, p_fn, p_response, clock_timestamp())
$$;
REVOKE EXECUTE ON FUNCTION public.crm_request_finish(text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_request_finish(text, text, text, jsonb) TO service_role;

-- The activity row crm_record_undo_stage_move would accept right now for
-- this person, or NULL: their own stage move, the record's most recent entry,
-- under 60 seconds old, and the record still sits in the stage it moved to.
CREATE FUNCTION public.crm_undoable_activity(p_record_id uuid, p_actor text) RETURNS uuid
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT a.id
  FROM (SELECT x.* FROM public.crm_activity x
        WHERE x.record_id = p_record_id
        ORDER BY x.created_at DESC, x.id DESC
        LIMIT 1) a
  JOIN public.crm_records r ON r.id = a.record_id
  WHERE a.kind = 'stage_move'
    AND a.actor_email = p_actor
    AND a.created_at > statement_timestamp() - interval '60 seconds'
    AND r.stage = a.to_stage
    AND r.deleted_at IS NULL
$$;
REVOKE EXECUTE ON FUNCTION public.crm_undoable_activity(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_undoable_activity(uuid, text) TO service_role;

-- The ONLY function that promotes a host to Live. Never called with a stage
-- by a person: it promotes a host whose linked brand has a public listing.
-- A Lost host is never promoted; a host is never demoted here (a listing that
-- goes away later does not move a Live host; see crm_apply_brand_link for a
-- changed or cleared link).
--
-- Each host is handled on its own: if one cannot be promoted (any error), it
-- is skipped with a warning in the server log and the run carries on with the
-- rest. The result stays the number promoted; a run that skipped any host
-- also writes ONE audit row (crm.reconcile_failed) carrying how many were
-- skipped and how many were promoted, so a failure is never silent. The next
-- run tries the skipped hosts again.
-- With no argument (the scheduled call) it also purges old request keys.
CREATE FUNCTION public.crm_reconcile_live(p_record_id uuid DEFAULT NULL) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  c        record;
  r        public.crm_records;
  v_n      integer := 0;
  v_failed integer := 0;
  v_now    timestamptz;
  v_act    uuid;
BEGIN
  FOR c IN
    SELECT x.id, x.brand_id
    FROM public.crm_records x
    WHERE x.pipeline = 'hosts'
      AND x.deleted_at IS NULL
      AND x.brand_id IS NOT NULL
      AND x.stage NOT IN ('live', 'lost')
      AND (p_record_id IS NULL OR x.id = p_record_id)
    ORDER BY x.id
  LOOP
    BEGIN
      IF public.crm_brand_is_live(c.brand_id) THEN
        -- Lock the one host, then look again: it may have moved, been
        -- unlinked or been deleted since the list above was read.
        SELECT * INTO r FROM public.crm_records k WHERE k.id = c.id FOR UPDATE;
        IF FOUND AND r.deleted_at IS NULL AND r.stage NOT IN ('live', 'lost')
           AND public.crm_brand_is_live(r.brand_id) THEN
          v_now := clock_timestamp();
          UPDATE public.crm_records
             SET stage = 'live', went_live_at = COALESCE(went_live_at, v_now),
                 updated_by = 'system', updated_at = v_now
           WHERE id = r.id;
          INSERT INTO public.crm_activity (record_id, kind, actor_email, via, body, from_stage, to_stage, occurred_at, created_at)
          VALUES (r.id, 'stage_move', NULL, 'system',
                  'First listing went live. Stage moved to Live automatically.', r.stage, 'live', v_now, v_now)
          RETURNING id INTO v_act;
          PERFORM public.crm_audit('system', 'crm.stage_auto_live', 'crm_record', r.id::text,
            jsonb_build_object('from', r.stage, 'to', 'live', 'brand_id', r.brand_id, 'activity_id', v_act));
          v_n := v_n + 1;
        END IF;
      END IF;
    EXCEPTION WHEN others THEN
      -- Everything this host's block did is undone; the others are untouched.
      v_failed := v_failed + 1;
      RAISE WARNING 'crm_reconcile_live: host % was skipped and will be tried again on the next run (% %)',
        c.id, SQLSTATE, SQLERRM;
    END;
  END LOOP;

  IF v_failed > 0 THEN
    PERFORM public.crm_audit('system', 'crm.reconcile_failed', 'crm_pipeline', 'hosts',
      jsonb_build_object('failed', v_failed, 'promoted', v_n));
  END IF;

  IF p_record_id IS NULL THEN
    DELETE FROM public.crm_request_keys k WHERE k.created_at < clock_timestamp() - interval '30 days';
  END IF;
  RETURN v_n;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.crm_reconcile_live(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_reconcile_live(uuid) TO service_role;
COMMENT ON FUNCTION public.crm_reconcile_live(uuid) IS
  'Issue #3802. The ONLY function that promotes a host to Live, from the linked brand''s public listing. Runs on brand link and every 10 minutes (pg_cron job crm_reconcile_live). Never demotes; never promotes a Lost host. Each host is handled on its own: one that fails is skipped with a warning, the rest of the run completes, and the run writes one crm.reconcile_failed audit row with the number skipped. The scheduled call also purges request keys older than 30 days.';

-- Settles a host's stage after ANY change to its brand link (set, changed or
-- cleared). The rule it keeps: a host is in Live only while it is linked to a
-- brand that has a public listing.
--   * A Live host whose link now points at no brand, or at a brand with no
--     public listing, moves back to Onboarded, with a system log line saying
--     why. (Onboarded is the furthest stage a person can set by hand; the
--     time it first went Live is kept as history.) A Live host re-linked to
--     another brand that has a public listing stays Live.
--   * A newly linked host that sat before Onboarded moves to Onboarded, then
--     to Live when the brand already has a public listing.
--   * A Lost host is never moved here.
-- Not called when a listing merely goes away with the link unchanged: Live is
-- a milestone and stays until a person marks the host Lost.
-- Returns 'onboarded', 'live' or NULL (nothing moved).
CREATE FUNCTION public.crm_apply_brand_link(p_id uuid) RETURNS text
LANGUAGE plpgsql VOLATILE SET search_path = ''
AS $$
DECLARE
  r       public.crm_records;
  v_moved text;
  v_brand text;
  v_now   timestamptz := clock_timestamp();
BEGIN
  SELECT * INTO r FROM public.crm_records c WHERE c.id = p_id AND c.deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND OR r.pipeline <> 'hosts' THEN
    RETURN NULL;
  END IF;
  SELECT b.name INTO v_brand FROM public.brands b WHERE b.id = r.brand_id;

  IF r.stage = 'live' AND NOT public.crm_brand_is_live(r.brand_id) THEN
    UPDATE public.crm_records SET stage = 'onboarded', updated_at = v_now WHERE id = r.id;
    INSERT INTO public.crm_activity (record_id, kind, actor_email, via, body, from_stage, to_stage, occurred_at, created_at)
    VALUES (r.id, 'stage_move', NULL, 'system',
            CASE WHEN r.brand_id IS NULL
                 THEN 'Brand link removed. Stage moved back to Onboarded.'
                 ELSE 'Linked to ' || COALESCE(v_brand, 'a Mingla brand') || ', which has no public listing yet. Stage moved back to Onboarded.'
            END,
            'live', 'onboarded', v_now, v_now);
    RETURN 'onboarded';
  END IF;

  IF r.brand_id IS NULL THEN
    RETURN NULL;
  END IF;
  IF (public.crm_stage_def('hosts', r.stage)->>'pos')::integer
       < (public.crm_stage_def('hosts', 'onboarded')->>'pos')::integer THEN
    UPDATE public.crm_records SET stage = 'onboarded', updated_at = v_now WHERE id = r.id;
    INSERT INTO public.crm_activity (record_id, kind, actor_email, via, body, from_stage, to_stage, occurred_at, created_at)
    VALUES (r.id, 'stage_move', NULL, 'system',
            'Linked to ' || COALESCE(v_brand, 'a Mingla brand') || '. Stage moved to Onboarded.',
            r.stage, 'onboarded', v_now, v_now);
    v_moved := 'onboarded';
  END IF;
  IF public.crm_reconcile_live(p_id) > 0 THEN
    v_moved := 'live';
  END IF;
  RETURN v_moved;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.crm_apply_brand_link(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_apply_brand_link(uuid) TO service_role;

-- One new record (steps shared by create and bulk create). The caller has
-- already resolved who is acting.
CREATE FUNCTION public.crm_record_create_core(p_pipeline text, p_fields jsonb, p_actor text, p_via text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SET search_path = ''
AS $$
DECLARE
  v_clean    jsonb;
  v_owners   text[];
  v_key      text;
  v_existing public.crm_records;
  v_rec      public.crm_records;
  v_first    text;
  v_moved    text;
  v_now      timestamptz := clock_timestamp();
BEGIN
  v_clean := public.crm_validate_fields(p_pipeline, p_fields, 'create');
  v_owners := CASE
    WHEN jsonb_typeof(v_clean->'owners') = 'array'
      THEN ARRAY(SELECT jsonb_array_elements_text(v_clean->'owners'))
    ELSE ARRAY[p_actor]
  END;
  v_key := public.crm_name_key(v_clean->>'name');

  -- An exact duplicate is an answer, not an error. Nothing is written.
  SELECT * INTO v_existing FROM public.crm_records c
   WHERE c.pipeline = p_pipeline AND c.name_key = v_key AND c.deleted_at IS NULL;
  IF FOUND THEN
    RETURN jsonb_build_object('status', 'duplicate', 'existing', public.crm_record_lite_json(v_existing));
  END IF;

  v_first := public.crm_pipeline_def(p_pipeline)->'stages'->0->>'id';
  BEGIN
    INSERT INTO public.crm_records (
      pipeline, name, icp, region_id, stage, contact, channel, source, next_action, due_on,
      brand_id, place_id, followers, agreement, rate, created_by, created_at, updated_by, updated_at)
    VALUES (
      p_pipeline, v_clean->>'name', v_clean->>'icp', (v_clean->>'region_id')::uuid, v_first,
      v_clean->>'contact', v_clean->>'channel', v_clean->>'source', v_clean->>'next_action',
      (v_clean->>'due_on')::date, (v_clean->>'brand_id')::uuid, (v_clean->>'place_pool_id')::uuid,
      (v_clean->>'followers')::integer, v_clean->>'agreement', v_clean->>'rate',
      p_actor, v_now, p_actor, v_now)
    RETURNING * INTO v_rec;
  EXCEPTION WHEN unique_violation THEN
    -- Two people added the same name at the same moment: the second one gets
    -- the same "duplicate" answer.
    SELECT * INTO v_existing FROM public.crm_records c
     WHERE c.pipeline = p_pipeline AND c.name_key = v_key AND c.deleted_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'try_again: Another change to the same record happened at the same moment, so nothing was saved. Send the same request again.'
        USING ERRCODE = '40001';
    END IF;
    RETURN jsonb_build_object('status', 'duplicate', 'existing', public.crm_record_lite_json(v_existing));
  END;

  INSERT INTO public.crm_record_owners (record_id, owner_email, added_by, added_at)
  SELECT v_rec.id, o.e, p_actor, v_now FROM unnest(v_owners) AS o(e);

  INSERT INTO public.crm_activity (record_id, kind, actor_email, via, body, occurred_at, created_at)
  VALUES (v_rec.id, 'created', p_actor, p_via, 'Added to the pipeline.', v_now, v_now);

  IF v_rec.brand_id IS NOT NULL THEN
    v_moved := public.crm_apply_brand_link(v_rec.id);
  END IF;

  PERFORM public.crm_audit(p_actor, 'crm.record_create', 'crm_record', v_rec.id::text,
    jsonb_strip_nulls(jsonb_build_object('pipeline', p_pipeline, 'name', v_rec.name,
                                         'owners', to_jsonb(v_owners), 'moved_to', v_moved, 'via', p_via)));

  SELECT * INTO v_rec FROM public.crm_records c WHERE c.id = v_rec.id;
  RETURN jsonb_build_object('status', 'created', 'record', public.crm_record_json(v_rec), 'moved_to', v_moved);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.crm_record_create_core(text, jsonb, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_record_create_core(text, jsonb, text, text) TO service_role;

-- ---------------------------------------------------------------------------
-- 6. Client functions. authenticated may call each; each gates FIRST.
--
-- Errors start with a token and then say what to do, in plain words:
--   forbidden (42501) · not_found (P0002) · try_again (40001: nothing was
--   saved, send the same request again) · everything else (22023: change
--   what was sent).
-- A record is "live" here when deleted_at IS NULL; nothing below sees or
-- returns a deleted record except crm_record_restore.
-- ---------------------------------------------------------------------------

-- Everything a person (or, later, an agent) needs to use the pipelines.
CREATE FUNCTION public.crm_config() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v     record;
  v_voc jsonb;
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  v_voc := public.crm_vocab();
  RETURN jsonb_build_object(
    'me', jsonb_build_object(
      'email', v.actor_email,
      'display_name', public.crm_display_name(v.actor_email),
      'role', public.admin_team_role(),
      'can_delete', public.is_admin_user()),
    'pipelines', jsonb_build_object(
      'hosts', public.crm_pipeline_def('hosts'),
      'creators', public.crm_pipeline_def('creators')),
    'channels', v_voc->'channels',
    'sources', v_voc->'sources',
    'reply_classes', v_voc->'reply_classes',
    'agreements', v_voc->'agreements',
    'regions', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'country_code', c.country_code,
                                          'is_live', c.is_live_for_consumers)
                       ORDER BY c.is_live_for_consumers DESC, c.name, c.id)
      FROM public.seeding_cities c), '[]'::jsonb),
    'team', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('email', d.email, 'display_name', public.crm_display_name(d.email),
                                          'role', d.role, 'status', d.status)
                       ORDER BY (d.role = 'owner') DESC, d.email)
      FROM public.admin_team_directory() d), '[]'::jsonb),
    'limits', jsonb_build_object('bulk_max', 50));
END;
$$;
REVOKE EXECUTE ON FUNCTION public.crm_config() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_config() TO authenticated, service_role;

CREATE FUNCTION public.crm_records_list(p_pipeline text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v       record;
  v_total bigint;
  v_rows  jsonb;
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  IF p_pipeline IS NULL OR p_pipeline NOT IN ('hosts', 'creators') THEN
    RAISE EXCEPTION 'invalid_pipeline: Use hosts or creators.' USING ERRCODE = '22023';
  END IF;
  SELECT count(*) INTO v_total FROM public.crm_records c
   WHERE c.pipeline = p_pipeline AND c.deleted_at IS NULL;
  SELECT COALESCE(jsonb_agg(public.crm_record_json(x) ORDER BY x.updated_at DESC, x.id), '[]'::jsonb) INTO v_rows
  FROM (SELECT c.* FROM public.crm_records c
         WHERE c.pipeline = p_pipeline AND c.deleted_at IS NULL
         ORDER BY c.updated_at DESC, c.id
         LIMIT 5000) x;
  RETURN jsonb_build_object('pipeline', p_pipeline, 'records', v_rows, 'truncated', v_total > 5000);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.crm_records_list(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_records_list(text) TO authenticated, service_role;

CREATE FUNCTION public.crm_record_get(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v     record;
  v_rec public.crm_records;
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  SELECT * INTO v_rec FROM public.crm_records c WHERE c.id = p_id AND c.deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: That record is no longer here. It may have been deleted.' USING ERRCODE = 'P0002';
  END IF;
  RETURN jsonb_build_object(
    'record', public.crm_record_json(v_rec),
    'links', jsonb_build_object(
      'brand', (SELECT jsonb_build_object('id', b.id, 'name', b.name, 'slug', b.slug,
                                          'is_live', public.crm_brand_is_live(b.id))
                  FROM public.brands b WHERE b.id = v_rec.brand_id AND b.deleted_at IS NULL),
      'place', (SELECT jsonb_build_object('id', p.id, 'name', p.name, 'city', p.city)
                  FROM public.place_pool p WHERE p.id = v_rec.place_id AND p.deleted_at IS NULL)),
    'activity', COALESCE((
      SELECT jsonb_agg(public.crm_activity_json(a) ORDER BY a.occurred_at DESC, a.created_at DESC, a.id)
      FROM (SELECT x.* FROM public.crm_activity x
             WHERE x.record_id = v_rec.id
             ORDER BY x.occurred_at DESC, x.created_at DESC, x.id
             LIMIT 200) a), '[]'::jsonb),
    'undoable_activity_id', public.crm_undoable_activity(v_rec.id, v.actor_email));
END;
$$;
REVOKE EXECUTE ON FUNCTION public.crm_record_get(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_record_get(uuid) TO authenticated, service_role;

CREATE FUNCTION public.crm_duplicate_check(p_pipeline text, p_name text, p_exclude uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v     record;
  v_key text;
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  IF p_pipeline IS NULL OR p_pipeline NOT IN ('hosts', 'creators') THEN
    RAISE EXCEPTION 'invalid_pipeline: Use hosts or creators.' USING ERRCODE = '22023';
  END IF;
  v_key := public.crm_name_key(regexp_replace(btrim(COALESCE(p_name, '')), '\s+', ' ', 'g'));
  IF v_key IS NULL OR v_key = '' THEN
    RETURN jsonb_build_object('exact', NULL, 'similar', '[]'::jsonb);
  END IF;
  RETURN jsonb_build_object(
    'exact', (SELECT public.crm_record_lite_json(c) FROM public.crm_records c
               WHERE c.pipeline = p_pipeline AND c.deleted_at IS NULL AND c.name_key = v_key
                 AND (p_exclude IS NULL OR c.id <> p_exclude)),
    'similar', COALESCE((
      SELECT jsonb_agg(public.crm_record_lite_json(s) ORDER BY s.name, s.id)
      FROM (SELECT c.* FROM public.crm_records c
             WHERE c.pipeline = p_pipeline AND c.deleted_at IS NULL
               AND c.name_key <> v_key
               AND (p_exclude IS NULL OR c.id <> p_exclude)
               AND char_length(v_key) >= 3 AND char_length(c.name_key) >= 3
               AND (position(v_key IN c.name_key) > 0 OR position(c.name_key IN v_key) > 0)
             ORDER BY c.name, c.id
             LIMIT 5) s), '[]'::jsonb));
END;
$$;
REVOKE EXECUTE ON FUNCTION public.crm_duplicate_check(text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_duplicate_check(text, text, uuid) TO authenticated, service_role;

-- Find a Mingla brand or place to link a host to. Only the named keys leave.
CREATE FUNCTION public.crm_link_search(p_kind text, p_query text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v      record;
  v_q    text := btrim(COALESCE(p_query, ''));
  v_like text;
  v_rows jsonb;
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  IF p_kind IS NULL OR p_kind NOT IN ('brand', 'place') THEN
    RAISE EXCEPTION 'invalid_kind: Search for a brand or a place.' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_q) < 2 THEN
    RETURN jsonb_build_object('kind', p_kind, 'results', '[]'::jsonb);
  END IF;
  -- %, _ and \ are searched for as typed, never as wildcards.
  v_like := replace(replace(replace(v_q, E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_');
  IF p_kind = 'brand' THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'slug', x.slug, 'city', x.city,
                                                 'is_live', public.crm_brand_is_live(x.id))
                              ORDER BY x.prefix DESC, x.name, x.id), '[]'::jsonb) INTO v_rows
    FROM (SELECT b.id, b.name, b.slug, b.city, (b.name ILIKE v_like || '%' ESCAPE E'\\') AS prefix
            FROM public.brands b
           WHERE b.deleted_at IS NULL AND b.name ILIKE '%' || v_like || '%' ESCAPE E'\\'
           ORDER BY (b.name ILIKE v_like || '%' ESCAPE E'\\') DESC, b.name, b.id
           LIMIT 10) x;
  ELSE
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'city', x.city)
                              ORDER BY x.prefix DESC, x.name, x.id), '[]'::jsonb) INTO v_rows
    FROM (SELECT p.id, p.name, p.city, (p.name ILIKE v_like || '%' ESCAPE E'\\') AS prefix
            FROM public.place_pool p
           WHERE p.is_active AND p.deleted_at IS NULL AND p.name ILIKE '%' || v_like || '%' ESCAPE E'\\'
           ORDER BY (p.name ILIKE v_like || '%' ESCAPE E'\\') DESC, p.name, p.id
           LIMIT 10) x;
  END IF;
  RETURN jsonb_build_object('kind', p_kind, 'results', v_rows);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.crm_link_search(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_link_search(text, text) TO authenticated, service_role;

-- Add one record. A new record always starts in the pipeline's first stage.
-- Returns {status: 'created', record} or {status: 'duplicate', existing}.
CREATE FUNCTION public.crm_record_create(p_pipeline text, p_fields jsonb, p_request_key text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v     record;
  v_res jsonb;
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  v_res := public.crm_request_begin(v.actor_email, p_request_key, 'crm_record_create');
  IF v_res IS NOT NULL THEN
    RETURN v_res;
  END IF;
  v_res := public.crm_record_create_core(p_pipeline, p_fields, v.actor_email, v.via);
  IF v_res->>'status' = 'created' THEN
    PERFORM public.crm_request_finish(v.actor_email, p_request_key, 'crm_record_create', v_res);
  END IF;
  RETURN v_res;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.crm_record_create(text, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_record_create(text, jsonb, text) TO authenticated, service_role;

-- Add up to 50 records in one request. One bad item never stops the rest:
-- an item whose values are refused (22023) is listed under "invalid" with the
-- reason. Anything else is a fault on the server, not in the item: the whole
-- call stops with try_again, nothing is saved and nothing is kept under the
-- request key, so sending the same request again is safe.
CREATE FUNCTION public.crm_records_bulk_create(p_pipeline text, p_items jsonb, p_request_key text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v         record;
  v_res     jsonb;
  v_item    jsonb;
  v_idx     integer := 0;
  v_one     jsonb;
  v_created jsonb := '[]'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
  v_invalid jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  v_res := public.crm_request_begin(v.actor_email, p_request_key, 'crm_records_bulk_create');
  IF v_res IS NOT NULL THEN
    RETURN v_res;
  END IF;
  IF p_pipeline IS NULL OR p_pipeline NOT IN ('hosts', 'creators') THEN
    RAISE EXCEPTION 'invalid_pipeline: Use hosts or creators.' USING ERRCODE = '22023';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'invalid_items: Send a list of 1 to 50 records, each a JSON object with at least a name.'
      USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_items) > 50 THEN
    RAISE EXCEPTION 'too_many: Send at most 50 records in one request.' USING ERRCODE = '22023';
  END IF;

  FOR v_item IN SELECT t.value FROM jsonb_array_elements(p_items) WITH ORDINALITY AS t(value, ord) ORDER BY t.ord LOOP
    BEGIN
      v_one := public.crm_record_create_core(p_pipeline, v_item, v.actor_email, v.via);
      IF v_one->>'status' = 'created' THEN
        v_created := v_created || jsonb_build_array(jsonb_build_object('index', v_idx, 'record', v_one->'record'));
      ELSE
        v_skipped := v_skipped || jsonb_build_array(jsonb_build_object(
          'index', v_idx,
          'name', CASE WHEN jsonb_typeof(v_item) = 'object' THEN v_item->>'name' ELSE NULL END,
          'reason', 'duplicate', 'existing', v_one->'existing'));
      END IF;
    EXCEPTION
      WHEN invalid_parameter_value THEN
        v_invalid := v_invalid || jsonb_build_array(jsonb_build_object(
          'index', v_idx,
          'name', CASE WHEN jsonb_typeof(v_item) = 'object' THEN v_item->>'name' ELSE NULL END,
          'error', SQLERRM));
      WHEN others THEN
        RAISE WARNING 'crm_records_bulk_create: item % stopped the request (% %)', v_idx, SQLSTATE, SQLERRM;
        RAISE EXCEPTION '%', format('try_again: Something went wrong on our side at item %s of the list, so nothing was saved. Send the same request again.', v_idx + 1)
          USING ERRCODE = '40001';
    END;
    v_idx := v_idx + 1;
  END LOOP;

  PERFORM public.crm_audit(v.actor_email, 'crm.bulk_create', 'crm_pipeline', p_pipeline,
    jsonb_strip_nulls(jsonb_build_object(
      'created', jsonb_array_length(v_created), 'skipped', jsonb_array_length(v_skipped),
      'invalid', jsonb_array_length(v_invalid), 'via', v.via)));

  v_res := jsonb_build_object('created', v_created, 'skipped', v_skipped, 'invalid', v_invalid);
  PERFORM public.crm_request_finish(v.actor_email, p_request_key, 'crm_records_bulk_create', v_res);
  RETURN v_res;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.crm_records_bulk_create(text, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_records_bulk_create(text, jsonb, text) TO authenticated, service_role;

-- Change fields of one record (never stage, never owners).
--   * A creator at Booked or later (Booked, Posted) keeps a signed
--     agreement: changing the agreement to anything else there is refused
--     (agreement_required). Same rule as crm_record_move_stage.
--   * Any change to a host's brand link (set, changed or cleared) settles the
--     stage through crm_apply_brand_link, so a host is never left in Live
--     without a linked brand that has a public listing.
CREATE FUNCTION public.crm_record_update(p_id uuid, p_changes jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v        record;
  v_rec    public.crm_records;
  v_new    public.crm_records;
  v_other  public.crm_records;
  v_clean  jsonb;
  v_cur    jsonb;
  v_before jsonb := '{}'::jsonb;
  v_after  jsonb := '{}'::jsonb;
  v_key    text;
  v_val    jsonb;
  v_moved  text;
  v_label  text;
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  SELECT * INTO v_rec FROM public.crm_records c WHERE c.id = p_id AND c.deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: That record is no longer here. It may have been deleted.' USING ERRCODE = 'P0002';
  END IF;

  v_clean := public.crm_validate_fields(v_rec.pipeline, p_changes, 'update');
  -- The field place_pool_id is stored in the column place_id.
  v_cur := to_jsonb(v_rec);
  v_cur := v_cur || jsonb_build_object('place_pool_id', v_cur->'place_id');
  FOR v_key, v_val IN SELECT e.key, e.value FROM jsonb_each(v_clean) e LOOP
    IF (v_cur->v_key) IS DISTINCT FROM v_val THEN
      v_before := v_before || jsonb_build_object(v_key, v_cur->v_key);
      v_after  := v_after  || jsonb_build_object(v_key, v_val);
    END IF;
  END LOOP;

  IF v_after = '{}'::jsonb THEN
    RETURN jsonb_build_object('record', public.crm_record_json(v_rec), 'changed', false, 'moved_to', NULL);
  END IF;

  IF v_rec.pipeline = 'creators'
     AND (public.crm_stage_def('creators', v_rec.stage)->>'pos')::integer >= (public.crm_stage_def('creators', 'booked')->>'pos')::integer
     AND NOT COALESCE((public.crm_stage_def('creators', v_rec.stage)->>'terminal')::boolean, false)
     AND v_after ? 'agreement' AND (v_after->>'agreement') IS DISTINCT FROM 'signed' THEN
    RAISE EXCEPTION '%', format('agreement_required: This creator is in %s, which keeps a signed agreement. Move the card back to Negotiating before changing the agreement.',
                                public.crm_stage_def('creators', v_rec.stage)->>'label')
      USING ERRCODE = '22023';
  END IF;

  v_label := public.crm_pipeline_def(v_rec.pipeline)->>'label';
  IF v_after ? 'name' AND public.crm_name_key(v_after->>'name') <> v_rec.name_key THEN
    SELECT * INTO v_other FROM public.crm_records c
     WHERE c.pipeline = v_rec.pipeline AND c.deleted_at IS NULL AND c.id <> v_rec.id
       AND c.name_key = public.crm_name_key(v_after->>'name');
    IF FOUND THEN
      RAISE EXCEPTION '%', format('duplicate_name: "%s" is already in %s. Open it instead.', v_other.name, v_label)
        USING ERRCODE = '22023', DETAIL = v_other.id::text;
    END IF;
  END IF;

  v_new := jsonb_populate_record(v_rec, v_after || CASE
    WHEN v_after ? 'place_pool_id' THEN jsonb_build_object('place_id', v_after->'place_pool_id')
    ELSE '{}'::jsonb END);
  BEGIN
    UPDATE public.crm_records
       SET name = v_new.name, icp = v_new.icp, region_id = v_new.region_id, contact = v_new.contact,
           channel = v_new.channel, source = v_new.source, next_action = v_new.next_action,
           due_on = v_new.due_on, brand_id = v_new.brand_id, place_id = v_new.place_id,
           followers = v_new.followers, agreement = v_new.agreement, rate = v_new.rate,
           updated_by = v.actor_email, updated_at = clock_timestamp()
     WHERE id = v_rec.id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION '%', format('duplicate_name: "%s" is already in %s. Open it instead.', v_new.name, v_label)
      USING ERRCODE = '22023';
  END;

  IF v_rec.pipeline = 'hosts' AND v_after ? 'brand_id' THEN
    v_moved := public.crm_apply_brand_link(v_rec.id);
  END IF;

  PERFORM public.crm_audit(v.actor_email, 'crm.record_update', 'crm_record', v_rec.id::text,
    jsonb_strip_nulls(jsonb_build_object('moved_to', v_moved, 'via', v.via))
      || jsonb_build_object('before', v_before, 'after', v_after));

  SELECT * INTO v_rec FROM public.crm_records c WHERE c.id = p_id;
  RETURN jsonb_build_object('record', public.crm_record_json(v_rec), 'changed', true, 'moved_to', v_moved);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.crm_record_update(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_record_update(uuid, jsonb) TO authenticated, service_role;

-- Move a card. Live sets itself; a Live host only moves to Lost; Lost and
-- Passed need a reason; a creator needs a signed agreement before Booked or
-- any later stage (Posted), whichever stage it comes from.
CREATE FUNCTION public.crm_record_move_stage(p_id uuid, p_to text, p_reason text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v        record;
  v_rec    public.crm_records;
  v_to     jsonb;
  v_reason text;
  v_list   text;
  v_act    uuid;
  v_now    timestamptz := clock_timestamp();
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  SELECT * INTO v_rec FROM public.crm_records c WHERE c.id = p_id AND c.deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: That record is no longer here. It may have been deleted.' USING ERRCODE = 'P0002';
  END IF;

  v_to := public.crm_stage_def(v_rec.pipeline, p_to);
  IF v_to IS NULL THEN
    SELECT string_agg(s->>'id', ', ') INTO v_list
    FROM jsonb_array_elements(public.crm_pipeline_def(v_rec.pipeline)->'stages') s;
    RAISE EXCEPTION '%', format('invalid_stage: %s is not a stage of %s. Use one of: %s.', COALESCE(p_to, 'nothing'), v_rec.pipeline, v_list)
      USING ERRCODE = '22023';
  END IF;
  IF v_rec.stage = p_to THEN
    RETURN jsonb_build_object('record', public.crm_record_json(v_rec), 'changed', false, 'activity_id', NULL);
  END IF;
  IF COALESCE((v_to->>'auto')::boolean, false) THEN
    RAISE EXCEPTION 'stage_sets_itself: Live sets itself when the linked brand has a public listing. Move the card to Onboarded and link the brand instead.'
      USING ERRCODE = '22023';
  END IF;
  IF v_rec.stage = 'live' AND p_to <> 'lost' THEN
    RAISE EXCEPTION 'stage_is_live: This host has a public listing, so it stays in Live. Mark it as lost if the relationship ended.'
      USING ERRCODE = '22023';
  END IF;
  -- Lost and Passed need a reason; it is normalised and checked by the shared
  -- helper. Any other stage keeps no reason, whatever was sent.
  IF COALESCE((v_to->>'terminal')::boolean, false) THEN
    v_reason := public.crm_validate_fields(v_rec.pipeline, jsonb_build_object('stage_reason', p_reason), 'reason')->>'stage_reason';
  END IF;
  -- ONE rule for a creator at Booked or later (every stage from Booked on
  -- that is not the closing stage Passed): the agreement is marked signed.
  -- The same test guards the edit (crm_record_update) and the undo
  -- (crm_record_undo_stage_move), so no route skips it.
  IF v_rec.pipeline = 'creators'
     AND (v_to->>'pos')::integer >= (public.crm_stage_def('creators', 'booked')->>'pos')::integer
     AND NOT COALESCE((v_to->>'terminal')::boolean, false)
     AND v_rec.agreement IS DISTINCT FROM 'signed' THEN
    RAISE EXCEPTION '%', format('agreement_required: Mark the agreement as signed before moving to %s.', v_to->>'label')
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.crm_records
     SET stage = p_to, stage_reason = v_reason, updated_by = v.actor_email, updated_at = v_now
   WHERE id = v_rec.id;
  INSERT INTO public.crm_activity (record_id, kind, actor_email, via, body, from_stage, to_stage, occurred_at, created_at)
  VALUES (v_rec.id, 'stage_move', v.actor_email, v.via, v_reason, v_rec.stage, p_to, v_now, v_now)
  RETURNING id INTO v_act;
  PERFORM public.crm_audit(v.actor_email, 'crm.stage_move', 'crm_record', v_rec.id::text,
    jsonb_strip_nulls(jsonb_build_object('via', v.via)) || jsonb_build_object(
      'activity_id', v_act,
      'before', jsonb_build_object('stage', v_rec.stage, 'stage_reason', v_rec.stage_reason),
      'after', jsonb_build_object('stage', p_to, 'stage_reason', v_reason)));

  SELECT * INTO v_rec FROM public.crm_records c WHERE c.id = p_id;
  RETURN jsonb_build_object('record', public.crm_record_json(v_rec), 'changed', true, 'activity_id', v_act);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.crm_record_move_stage(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_record_move_stage(uuid, text, text) TO authenticated, service_role;

-- Undo your own move, for a minute, while nothing else has happened to the
-- card. The only function that deletes an activity row.
-- An undo puts the card back into a stage, so that stage's rule must hold at
-- this moment: a host goes back into Live only if it is still linked to a
-- brand with a public listing (otherwise undo_not_live, nothing changes), and
-- a creator goes back into Booked or Posted only with a signed agreement.
CREATE FUNCTION public.crm_record_undo_stage_move(p_activity_id uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v        record;
  v_act    public.crm_activity;
  v_rec    public.crm_records;
  v_before jsonb;
  v_reason text;
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  SELECT * INTO v_act FROM public.crm_activity a WHERE a.id = p_activity_id;
  IF FOUND THEN
    SELECT * INTO v_rec FROM public.crm_records c WHERE c.id = v_act.record_id AND c.deleted_at IS NULL FOR UPDATE;
  END IF;
  IF v_act.id IS NULL OR v_rec.id IS NULL
     OR public.crm_undoable_activity(v_rec.id, v.actor_email) IS DISTINCT FROM p_activity_id THEN
    RAISE EXCEPTION 'undo_expired: That move can no longer be undone. Move the card back by hand.' USING ERRCODE = '22023';
  END IF;

  SELECT l.metadata->'before' INTO v_before
  FROM public.admin_audit_log l
  WHERE l.target_type = 'crm_record' AND l.target_id = v_rec.id::text
    AND l.action = 'crm.stage_move' AND l.metadata->>'activity_id' = p_activity_id::text
  ORDER BY l.created_at DESC
  LIMIT 1;
  v_reason := NULLIF(btrim(COALESCE(v_before->>'stage_reason', '')), '');
  IF v_act.from_stage IN ('lost', 'passed') AND v_reason IS NULL THEN
    RAISE EXCEPTION 'undo_expired: That move can no longer be undone. Move the card back by hand.' USING ERRCODE = '22023';
  END IF;

  IF v_rec.pipeline = 'hosts' AND v_act.from_stage = 'live' AND NOT public.crm_brand_is_live(v_rec.brand_id) THEN
    RAISE EXCEPTION 'undo_not_live: This host is no longer linked to a brand with a public listing, so it cannot go back to Live. Move the card to Onboarded by hand; Live sets itself once the linked brand has a public listing.'
      USING ERRCODE = '22023';
  END IF;
  IF v_rec.pipeline = 'creators'
     AND (public.crm_stage_def('creators', v_act.from_stage)->>'pos')::integer >= (public.crm_stage_def('creators', 'booked')->>'pos')::integer
     AND NOT COALESCE((public.crm_stage_def('creators', v_act.from_stage)->>'terminal')::boolean, false)
     AND v_rec.agreement IS DISTINCT FROM 'signed' THEN
    RAISE EXCEPTION '%', format('agreement_required: The agreement is not marked as signed, so this card cannot go back to %s. Mark the agreement as signed, then move the card by hand.',
                                public.crm_stage_def('creators', v_act.from_stage)->>'label')
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.crm_records
     SET stage = v_act.from_stage,
         stage_reason = CASE WHEN v_act.from_stage IN ('lost', 'passed') THEN v_reason ELSE NULL END,
         updated_by = v.actor_email, updated_at = clock_timestamp()
   WHERE id = v_rec.id;
  DELETE FROM public.crm_activity a WHERE a.id = p_activity_id;
  PERFORM public.crm_audit(v.actor_email, 'crm.stage_undo', 'crm_record', v_rec.id::text,
    jsonb_strip_nulls(jsonb_build_object('via', v.via)) || jsonb_build_object(
      'activity_id', p_activity_id,
      'before', jsonb_build_object('stage', v_act.to_stage),
      'after', jsonb_build_object('stage', v_act.from_stage)));

  SELECT * INTO v_rec FROM public.crm_records c WHERE c.id = v_rec.id;
  RETURN jsonb_build_object('record', public.crm_record_json(v_rec), 'changed', true);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.crm_record_undo_stage_move(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_record_undo_stage_move(uuid) TO authenticated, service_role;

-- Replace the owners of a card. An empty list means unassigned.
CREATE FUNCTION public.crm_record_set_owners(p_id uuid, p_owner_emails text[]) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v        record;
  v_rec    public.crm_records;
  v_new    text[];
  v_old    text[];
  v_now    timestamptz := clock_timestamp();
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  SELECT * INTO v_rec FROM public.crm_records c WHERE c.id = p_id AND c.deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: That record is no longer here. It may have been deleted.' USING ERRCODE = 'P0002';
  END IF;

  v_new := public.crm_clean_owners(to_jsonb(COALESCE(p_owner_emails, ARRAY[]::text[])));
  SELECT COALESCE(array_agg(o.owner_email ORDER BY o.owner_email), ARRAY[]::text[]) INTO v_old
  FROM public.crm_record_owners o WHERE o.record_id = v_rec.id;

  IF v_new = v_old THEN
    RETURN jsonb_build_object('record', public.crm_record_json(v_rec), 'changed', false);
  END IF;

  DELETE FROM public.crm_record_owners o
   WHERE o.record_id = v_rec.id AND NOT (o.owner_email = ANY (v_new));
  INSERT INTO public.crm_record_owners (record_id, owner_email, added_by, added_at)
  SELECT v_rec.id, n.e, v.actor_email, v_now
  FROM unnest(v_new) AS n(e)
  WHERE NOT (n.e = ANY (v_old));
  UPDATE public.crm_records SET updated_by = v.actor_email, updated_at = v_now WHERE id = v_rec.id;
  PERFORM public.crm_audit(v.actor_email, 'crm.owners_set', 'crm_record', v_rec.id::text,
    jsonb_strip_nulls(jsonb_build_object('via', v.via))
      || jsonb_build_object('before', to_jsonb(v_old), 'after', to_jsonb(v_new)));

  SELECT * INTO v_rec FROM public.crm_records c WHERE c.id = p_id;
  RETURN jsonb_build_object('record', public.crm_record_json(v_rec), 'changed', true);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.crm_record_set_owners(uuid, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_record_set_owners(uuid, text[]) TO authenticated, service_role;

-- Add a note or a touch to a card's log. The time it happened must be a real
-- moment on or after 1 January 2020 and no more than 5 minutes ahead of the
-- server clock.
CREATE FUNCTION public.crm_record_log(p_id uuid, p_entry jsonb, p_request_key text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v           record;
  v_res       jsonb;
  v_rec       public.crm_records;
  v_act       public.crm_activity;
  v_clean     jsonb;
  v_kind      text;
  v_body      text;
  v_channel   text;
  v_direction text;
  v_ref       text;
  v_class     text;
  v_when      timestamptz;
  v_now       timestamptz := clock_timestamp();
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  v_res := public.crm_request_begin(v.actor_email, p_request_key, 'crm_record_log');
  IF v_res IS NOT NULL THEN
    RETURN v_res;
  END IF;

  SELECT * INTO v_rec FROM public.crm_records c WHERE c.id = p_id AND c.deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: That record is no longer here. It may have been deleted.' USING ERRCODE = 'P0002';
  END IF;
  -- Normalised and checked in the shared helper (kind, text, channel,
  -- direction, reply classification, message reference, and the time window).
  v_clean     := public.crm_validate_fields(v_rec.pipeline, p_entry, 'log');
  v_kind      := v_clean->>'kind';
  v_body      := v_clean->>'body';
  v_channel   := v_clean->>'channel';
  v_direction := v_clean->>'direction';
  v_ref       := v_clean->>'message_ref';
  v_class     := v_clean->>'reply_class';
  v_when      := COALESCE((v_clean->>'occurred_at')::timestamptz, v_now);

  INSERT INTO public.crm_activity (record_id, kind, actor_email, via, body, channel, direction,
                                   message_ref, reply_class, occurred_at, created_at)
  VALUES (v_rec.id, v_kind, v.actor_email, v.via, v_body, v_channel, v_direction, v_ref, v_class, v_when, v_now)
  RETURNING * INTO v_act;
  UPDATE public.crm_records SET updated_by = v.actor_email, updated_at = v_now WHERE id = v_rec.id;
  -- The audit row never carries what was said.
  PERFORM public.crm_audit(v.actor_email, 'crm.log_add', 'crm_record', v_rec.id::text,
    jsonb_strip_nulls(jsonb_build_object('activity_id', v_act.id, 'kind', v_kind, 'channel', v_channel,
                                         'direction', v_direction, 'via', v.via)));

  SELECT * INTO v_rec FROM public.crm_records c WHERE c.id = p_id;
  v_res := jsonb_build_object('activity', public.crm_activity_json(v_act), 'record', public.crm_record_json(v_rec));
  PERFORM public.crm_request_finish(v.actor_email, p_request_key, 'crm_record_log', v_res);
  RETURN v_res;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.crm_record_log(uuid, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_record_log(uuid, jsonb, text) TO authenticated, service_role;

-- Delete (soft, restorable). Owner and admin only.
CREATE FUNCTION public.crm_record_delete(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v     record;
  v_rec public.crm_records;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'forbidden: Only an owner or admin can delete. Mark it as lost instead.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v FROM public.crm_ctx();
  SELECT * INTO v_rec FROM public.crm_records c WHERE c.id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: That record does not exist.' USING ERRCODE = 'P0002';
  END IF;
  IF v_rec.deleted_at IS NOT NULL THEN
    RETURN jsonb_build_object('changed', false, 'id', v_rec.id, 'name', v_rec.name, 'pipeline', v_rec.pipeline);
  END IF;
  UPDATE public.crm_records
     SET deleted_at = v_now, deleted_by = v.actor_email, updated_by = v.actor_email, updated_at = v_now
   WHERE id = v_rec.id;
  PERFORM public.crm_audit(v.actor_email, 'crm.record_delete', 'crm_record', v_rec.id::text,
    jsonb_strip_nulls(jsonb_build_object('name', v_rec.name, 'pipeline', v_rec.pipeline, 'via', v.via)));
  RETURN jsonb_build_object('changed', true, 'id', v_rec.id, 'name', v_rec.name, 'pipeline', v_rec.pipeline);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.crm_record_delete(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_record_delete(uuid) TO authenticated, service_role;

-- Bring a deleted record back (the Undo after a delete). Owner and admin only.
CREATE FUNCTION public.crm_record_restore(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v       record;
  v_rec   public.crm_records;
  v_other public.crm_records;
  v_label text;
BEGIN
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'forbidden: Only an owner or admin can restore a deleted record.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v FROM public.crm_ctx();
  SELECT * INTO v_rec FROM public.crm_records c WHERE c.id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: That record does not exist.' USING ERRCODE = 'P0002';
  END IF;
  IF v_rec.deleted_at IS NULL THEN
    RETURN jsonb_build_object('record', public.crm_record_json(v_rec), 'changed', false);
  END IF;

  v_label := public.crm_pipeline_def(v_rec.pipeline)->>'label';
  SELECT * INTO v_other FROM public.crm_records c
   WHERE c.pipeline = v_rec.pipeline AND c.deleted_at IS NULL AND c.name_key = v_rec.name_key;
  IF FOUND THEN
    RAISE EXCEPTION '%', format('duplicate_name: "%s" is already in %s. Open it instead.', v_other.name, v_label)
      USING ERRCODE = '22023', DETAIL = v_other.id::text;
  END IF;

  BEGIN
    UPDATE public.crm_records
       SET deleted_at = NULL, deleted_by = NULL, updated_by = v.actor_email, updated_at = clock_timestamp()
     WHERE id = v_rec.id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION '%', format('duplicate_name: "%s" is already in %s, or its beta lead was added again. Open the existing record instead.', v_rec.name, v_label)
      USING ERRCODE = '22023';
  END;
  PERFORM public.crm_audit(v.actor_email, 'crm.record_restore', 'crm_record', v_rec.id::text,
    jsonb_strip_nulls(jsonb_build_object('name', v_rec.name, 'pipeline', v_rec.pipeline, 'via', v.via)));

  SELECT * INTO v_rec FROM public.crm_records c WHERE c.id = p_id;
  RETURN jsonb_build_object('record', public.crm_record_json(v_rec), 'changed', true);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.crm_record_restore(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_record_restore(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. The Beta leads reader is now limited to full admins.
--
-- Same signature, return type and grants as before; one added first
-- statement. is_admin_user() itself is not touched. The role-aware reader for
-- the rest of the team arrives with the Beta leads page change.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_beta_leads_list()
  RETURNS TABLE(
    id           uuid,
    created_at   timestamptz,
    brand_type   text[],
    brand_name   text,
    contact_name text,
    city         text,
    email        text,
    source       text,
    user_agent   text,
    referer      text
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
AS $$
#variable_conflict use_column
BEGIN
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT
    bal.id,
    bal.created_at,
    bal.brand_type,
    bal.brand_name,
    bal.contact_name,
    bal.city,
    bal.email,
    bal.source,
    bal.user_agent,
    bal.referer
  FROM public.beta_access_leads bal
  ORDER BY bal.created_at DESC;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_beta_leads_list() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_beta_leads_list() FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_beta_leads_list() TO authenticated;

-- ---------------------------------------------------------------------------
-- 8. Schedule: promote hosts to Live every 10 minutes.
--
-- Job name crm_reconcile_live; it calls exactly
--   SELECT public.crm_reconcile_live()
-- Idempotent: scheduling a name that already exists replaces that job (one
-- job per name), so applying this twice leaves one job. With no records the
-- call changes nothing and returns 0. Skipped where pg_cron is absent.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RETURN;
  END IF;
  PERFORM cron.schedule(
    'crm_reconcile_live',
    '*/10 * * * *',
    $cron$SELECT public.crm_reconcile_live()$cron$
  );
EXCEPTION
  -- Extension absent is handled above; undefined_table covers hosts where
  -- cron.job is not visible. Any other scheduling error aborts the apply, so
  -- the job cannot silently fail to register.
  WHEN undefined_table THEN
    NULL;
END;
$$;

-- ---------------------------------------------------------------------------
-- 9. Self-check. Aborts the apply unless the access shape above really holds.
-- ---------------------------------------------------------------------------
DO $check$
DECLARE
  c_client text[] := ARRAY[
    'public.crm_config()',
    'public.crm_records_list(text)',
    'public.crm_record_get(uuid)',
    'public.crm_duplicate_check(text,text,uuid)',
    'public.crm_link_search(text,text)',
    'public.crm_record_create(text,jsonb,text)',
    'public.crm_records_bulk_create(text,jsonb,text)',
    'public.crm_record_update(uuid,jsonb)',
    'public.crm_record_move_stage(uuid,text,text)',
    'public.crm_record_undo_stage_move(uuid)',
    'public.crm_record_set_owners(uuid,text[])',
    'public.crm_record_log(uuid,jsonb,text)',
    'public.crm_record_delete(uuid)',
    'public.crm_record_restore(uuid)'
  ];
  c_internal text[] := ARRAY[
    'public.admin_team_directory()',
    'public.crm_ctx()',
    'public.crm_name_key(text)',
    'public.crm_display_name(text)',
    'public.crm_pipeline_def(text)',
    'public.crm_vocab()',
    'public.crm_stage_def(text,text)',
    'public.crm_brand_is_live(uuid)',
    'public.crm_clean_owners(jsonb)',
    'public.crm_validate_fields(text,jsonb,text)',
    'public.crm_record_json(public.crm_records)',
    'public.crm_record_lite_json(public.crm_records)',
    'public.crm_activity_json(public.crm_activity)',
    'public.crm_audit(text,text,text,text,jsonb)',
    'public.crm_request_begin(text,text,text)',
    'public.crm_request_finish(text,text,text,jsonb)',
    'public.crm_undoable_activity(uuid,text)',
    'public.crm_reconcile_live(uuid)',
    'public.crm_apply_brand_link(uuid)',
    'public.crm_record_create_core(text,jsonb,text,text)'
  ];
  c_tables text[] := ARRAY['public.crm_records','public.crm_record_owners','public.crm_activity','public.crm_request_keys'];
  v_fn    text;
  v_tbl   text;
  v_role  text;
  v_priv  text;
  v_n     integer;
  v_stage text;
BEGIN
  -- 9.1 functions: PUBLIC and anon hold nothing; the signed-in role holds
  -- exactly the client ones; the trusted server role holds all of them.
  FOREACH v_fn IN ARRAY c_client || c_internal LOOP
    IF has_function_privilege('anon', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'issue 3802 wave 1 self-check: anon can execute %', v_fn;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc p, pg_catalog.aclexplode(p.proacl) a
               WHERE p.oid = v_fn::regprocedure AND a.grantee = 0 AND a.privilege_type = 'EXECUTE')
       OR (SELECT p.proacl IS NULL FROM pg_catalog.pg_proc p WHERE p.oid = v_fn::regprocedure) THEN
      RAISE EXCEPTION 'issue 3802 wave 1 self-check: PUBLIC can execute %', v_fn;
    END IF;
    IF NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'issue 3802 wave 1 self-check: service_role cannot execute %', v_fn;
    END IF;
  END LOOP;
  FOREACH v_fn IN ARRAY c_client LOOP
    IF NOT has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'issue 3802 wave 1 self-check: authenticated cannot execute %', v_fn;
    END IF;
  END LOOP;
  FOREACH v_fn IN ARRAY c_internal LOOP
    IF has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'issue 3802 wave 1 self-check: authenticated can execute the internal %', v_fn;
    END IF;
  END LOOP;

  -- 9.2 no crm_* function exists that is not named above (a stray one would
  -- carry the default grants).
  SELECT count(*) INTO v_n
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname LIKE 'crm\_%'
    AND NOT (p.oid = ANY (SELECT x::regprocedure::oid FROM unnest(c_client || c_internal) AS x));
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'issue 3802 wave 1 self-check: % crm_ function(s) are not in the checked list', v_n;
  END IF;

  -- 9.3 tables: nothing for anon or authenticated, row security on, no policy.
  FOREACH v_tbl IN ARRAY c_tables LOOP
    FOREACH v_role IN ARRAY ARRAY['anon','authenticated'] LOOP
      FOREACH v_priv IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'] LOOP
        IF has_table_privilege(v_role, v_tbl, v_priv) THEN
          RAISE EXCEPTION 'issue 3802 wave 1 self-check: % holds % on %', v_role, v_priv, v_tbl;
        END IF;
      END LOOP;
      IF EXISTS (SELECT 1 FROM information_schema.column_privileges cp
                 WHERE cp.table_schema = 'public' AND 'public.' || cp.table_name = v_tbl
                   AND cp.grantee = v_role) THEN
        RAISE EXCEPTION 'issue 3802 wave 1 self-check: % holds a column privilege on %', v_role, v_tbl;
      END IF;
    END LOOP;
    IF NOT (SELECT c.relrowsecurity FROM pg_catalog.pg_class c WHERE c.oid = v_tbl::regclass) THEN
      RAISE EXCEPTION 'issue 3802 wave 1 self-check: row security is off on %', v_tbl;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_policy p WHERE p.polrelid = v_tbl::regclass) THEN
      RAISE EXCEPTION 'issue 3802 wave 1 self-check: a policy exists on %', v_tbl;
    END IF;
  END LOOP;

  -- 9.4 the two new roles can never obtain admin_console from the area map.
  IF 'admin_console' = ANY (public.admin_team_role_areas('growth'))
     OR 'admin_console' = ANY (public.admin_team_role_areas('partner'))
     OR 'team_manage' = ANY (public.admin_team_role_areas('growth'))
     OR 'team_manage' = ANY (public.admin_team_role_areas('partner')) THEN
    RAISE EXCEPTION 'issue 3802 wave 1 self-check: a non-admin role was given an admin area';
  END IF;

  -- 9.5 both unique indexes exist and are valid.
  SELECT count(*) INTO v_n
  FROM pg_catalog.pg_index i
  JOIN pg_catalog.pg_class c ON c.oid = i.indexrelid
  WHERE i.indrelid = 'public.crm_records'::regclass
    AND c.relname IN ('crm_records_live_name_key', 'crm_records_live_beta_lead')
    AND i.indisunique AND i.indisvalid AND i.indpred IS NOT NULL;
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'issue 3802 wave 1 self-check: expected 2 valid unique partial indexes on crm_records, found %', v_n;
  END IF;

  -- 9.6 the stage list in crm_pipeline_def and the table CHECK agree: every
  -- defined stage is accepted, and its ICPs too (rolled back inside).
  BEGIN
    FOR v_tbl, v_stage IN
      SELECT p.pipe, s->>'id'
      FROM unnest(ARRAY['hosts','creators']) AS p(pipe),
           jsonb_array_elements(public.crm_pipeline_def(p.pipe)->'stages') s
    LOOP
      INSERT INTO public.crm_records (pipeline, name, stage, stage_reason, created_by, updated_by)
      VALUES (v_tbl, 'self-check ' || v_tbl || ' ' || v_stage, v_stage,
              CASE WHEN COALESCE((public.crm_stage_def(v_tbl, v_stage)->>'terminal')::boolean, false) THEN 'self-check' END,
              'system', 'system');
    END LOOP;
    FOR v_tbl, v_stage IN
      SELECT p.pipe, s->>'id'
      FROM unnest(ARRAY['hosts','creators']) AS p(pipe),
           jsonb_array_elements(public.crm_pipeline_def(p.pipe)->'icps') s
    LOOP
      INSERT INTO public.crm_records (pipeline, name, stage, icp, created_by, updated_by)
      VALUES (v_tbl, 'self-check icp ' || v_tbl || ' ' || v_stage,
              public.crm_pipeline_def(v_tbl)->'stages'->0->>'id', v_stage, 'system', 'system');
    END LOOP;
    RAISE EXCEPTION 'issue_3802_self_check_rollback' USING ERRCODE = 'P3802';
  EXCEPTION
    WHEN SQLSTATE 'P3802' THEN
      NULL;
    WHEN check_violation THEN
      RAISE EXCEPTION 'issue 3802 wave 1 self-check: crm_pipeline_def and the crm_records CHECK constraints disagree (%)', SQLERRM;
  END;

  -- 9.7 the Beta leads reader: not for anon or PUBLIC; still callable by a
  -- signed-in session (the function itself now refuses non-admins).
  IF has_function_privilege('anon', 'public.admin_beta_leads_list()', 'EXECUTE') THEN
    RAISE EXCEPTION 'issue 3802 wave 1 self-check: anon can execute admin_beta_leads_list()';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.admin_beta_leads_list()', 'EXECUTE') THEN
    RAISE EXCEPTION 'issue 3802 wave 1 self-check: authenticated lost admin_beta_leads_list()';
  END IF;
  IF (SELECT p.prosrc !~ 'is_admin_user\(\)' FROM pg_catalog.pg_proc p
      WHERE p.oid = 'public.admin_beta_leads_list()'::regprocedure) THEN
    RAISE EXCEPTION 'issue 3802 wave 1 self-check: admin_beta_leads_list() does not check for a full admin';
  END IF;

  -- 9.8 the areas function kept its Wave 0 grants.
  IF has_function_privilege('anon', 'public.admin_team_role_areas(text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.admin_team_role_areas(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'issue 3802 wave 1 self-check: admin_team_role_areas(text) grants changed';
  END IF;
END;
$check$;

COMMIT;
