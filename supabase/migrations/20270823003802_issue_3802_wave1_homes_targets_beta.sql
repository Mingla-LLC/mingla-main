-- Issue #3802 (Wave 1) \u2014 role homes, monthly targets, Beta leads for the whole
-- team, and the last server rules found in testing.
--
-- What this adds:
--   * A move names the stage it saw. public.crm_record_move_stage() takes a
--     fourth, optional argument, p_expected_from. When it is sent and the card
--     has moved since, the move is refused (stage_changed) and nothing is
--     written. Callers that send two or three arguments behave as before.
--   * One form and one key for a name. A stored name is in Unicode form NFC.
--     The duplicate key is built from the NFKC form, so full-width and plain
--     letters, ligatures, and composed or decomposed accents are one record.
--     A name needs at least one visible letter, digit or symbol. Every stored
--     key is recomputed here, after a pre-flight that stops the apply (with a
--     count, never a name) if two records would share a key.
--   * The scheduled Live run reports the same set of skipped hosts once in 24
--     hours instead of on every run. A change in the set is reported at once.
--     A run for one host (a person linked a brand) reports every time.
--   * public.crm_targets: one standing monthly number per region and ICP for
--     Hosts. Row security on, no policy, no client privilege.
--   * Five client functions: crm_home_summary (all four roles),
--     crm_team_summary and crm_target_set (owner and admin),
--     crm_beta_leads_list and crm_beta_lead_to_host (the beta_leads area).
--     Every one gates first, like the functions before them.
--   * A team invitation is refused when it is sent (address_in_use) if the
--     address already belongs to an account that signs in another way. The
--     check made when the invitation is opened stays as it is.
--
-- One transaction. NOT modified: is_admin_user(), admin_team_role(),
-- admin_team_can(), admin_team_my_access(), admin_team_set_member(),
-- admin_team_role_areas(), admin_team_directory(), admin_beta_leads_list(),
-- crm_ctx(), crm_record_create_core(), crm_record_update(),
-- crm_record_undo_stage_move(), crm_apply_brand_link(), crm_brand_is_live(),
-- beta_access_leads, seeding_cities, brands, events, place_pool, and every
-- policy on every table. No trigger and no foreign key is added anywhere.
--
-- Safe to apply while the current admin client and edge functions are live:
-- their three-named-argument move call resolves to the new function, their
-- Beta leads page keeps calling admin_beta_leads_list(), and an invitation
-- refused here reaches the owner as a refusal, never as a sent link.
--
-- Error tokens added (same shape as before: a token, then plain words):
--   stage_changed (22023), invalid_target (22023), lead_name_unusable
--   (22023), address_in_use (22023, code only), forbidden (42501, three new
--   sentences), not_found (P0002, a beta lead).
--
-- Invariants (docs/INVARIANT_REGISTRY.md):
--   I-PROPOSED-3802-BETA-LEADS-READ-IS-ROLE-GATED
--   I-PROPOSED-3802-CRM-NAMES-HAVE-ONE-FORM-AND-ONE-KEY
--   I-PROPOSED-3802-CRM-MOVE-NAMES-THE-STAGE-IT-SAW
--   I-PROPOSED-3802-HOME-NUMBERS-ARE-COUNTED-NOT-TYPED
--   I-PROPOSED-3802-TEAM-INVITE-REFUSES-AN-ADDRESS-WITH-ANOTHER-SIGN-IN
--   I-PROPOSED-3802-CRM-HAS-ONE-FUNCTION-WRITE-PATH (preserved)
--   I-PROPOSED-3802-FULL-ADMIN-TABLE-HOLDS-ONLY-OWNER-AND-ADMIN (preserved)
--
-- ---------------------------------------------------------------------------
-- ROLLBACK (kept here as a comment; there is no down-migration file).
-- Roll the admin web client and the two invite functions back FIRST (the
-- client sends p_expected_from), then the database. Targets are lost when the
-- table is dropped; export them first. Hosts added from a beta lead keep
-- their beta_lead_id (harmless).
--
--   BEGIN;
--   DROP FUNCTION IF EXISTS public.crm_beta_lead_to_host(uuid);
--   DROP FUNCTION IF EXISTS public.crm_beta_leads_list();
--   DROP FUNCTION IF EXISTS public.crm_target_set(uuid, text, integer);
--   DROP FUNCTION IF EXISTS public.crm_team_summary(date);
--   DROP FUNCTION IF EXISTS public.crm_home_summary(date);
--   DROP FUNCTION IF EXISTS public.crm_city_region(text);
--   DROP FUNCTION IF EXISTS public.crm_beta_icp(text[]);
--   DROP FUNCTION IF EXISTS public.crm_targets_json(date);
--   DROP FUNCTION IF EXISTS public.crm_due_json(text, date, integer);
--   DROP FUNCTION IF EXISTS public.crm_stage_counts_json();
--   DROP TABLE IF EXISTS public.crm_targets;
--   DROP FUNCTION IF EXISTS public.crm_record_move_stage(uuid, text, text, text);
--   -- Recreate crm_record_move_stage(uuid, text, text) and restore
--   -- crm_reconcile_live, crm_validate_fields and crm_name_key verbatim from
--   --   20270820003802_issue_3802_wave1_crm_pipelines.sql
--   -- and admin_team_issue_invite verbatim from
--   --   20270818003802_issue_3802_wave0_invite_binding.sql
--   DROP FUNCTION IF EXISTS public.admin_team_invite_address_verdict(text);
--   -- Stored keys follow the restored function:
--   ALTER TABLE public.crm_records DROP CONSTRAINT crm_records_name_check;
--   UPDATE public.crm_records SET name = name;
--   ALTER TABLE public.crm_records ADD CONSTRAINT crm_records_name_check
--     CHECK (name = btrim(name) AND char_length(name) BETWEEN 1 AND 160
--            AND public.crm_name_key(name) <> '');
--   NOTIFY pgrst, 'reload schema';
--   COMMIT;
-- ---------------------------------------------------------------------------

BEGIN;

-- A stuck lock aborts the apply instead of hanging.
SET LOCAL lock_timeout = '10s';

-- Remembered for the self-check at the end: is_admin_user() must be
-- byte-identical before and after this file.
SELECT set_config('issue3802.pr3_admin_fn_md5',
                  (SELECT md5(p.prosrc) FROM pg_catalog.pg_proc p
                    WHERE p.oid = 'public.is_admin_user()'::regprocedure), true);

-- ---------------------------------------------------------------------------
-- 1. Names: one normal form, one key, and a safe re-key.
--
-- The key: fold the name to its compatibility form (NFKC), lower-case it, fold
-- again (lower-casing can leave a decomposed pair), then drop every kind of
-- blank space and every character nobody can see. What is left ("seen"):
--   * nothing, or only combining marks -> ''   (the name has nothing visible)
--   * no letter or digit               -> seen (a name made of symbols or emoji)
--   * otherwise                        -> its letters and digits
-- Combining marks are removed only for the "is anything visible" test, never
-- from the key of a name that has other characters.
--
-- The lines between the two markers are run again by the test suite against
-- planted rows; keep the markers.
-- ---------------------------------------------------------------------------
-- issue-3802-pr3 rekey: begin
LOCK TABLE public.crm_records IN SHARE ROW EXCLUSIVE MODE;

CREATE OR REPLACE FUNCTION public.crm_name_key(p_name text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT SET search_path = ''
AS $$
  SELECT CASE
    WHEN regexp_replace(v.seen,
           '[\u0300-\u036F\u0483-\u0489\u1AB0-\u1AFF\u1DC0-\u1DFF\u20D0-\u20FF\uFE20-\uFE2F]+',
           '', 'g') = '' THEN ''
    WHEN regexp_replace(v.seen, '[^[:alnum:]]+', '', 'g') = '' THEN v.seen
    ELSE regexp_replace(v.seen, '[^[:alnum:]]+', '', 'g')
  END
  FROM (SELECT regexp_replace(normalize(lower(normalize(p_name, NFKC)), NFKC),
          '[\s\u0001-\u001F\u007F-\u00A0\u00AD\u034F\u061C\u115F\u1160\u1680\u17B4\u17B5\u180B-\u180F\u2000-\u200F\u2028-\u202F\u205F-\u206F\u2800\u3000\u3164\uFE00-\uFE0F\uFEFF\uFFA0\uFFF9-\uFFFB\U000110BD\U000110CD\U00013430-\U0001343F\U0001BCA0-\U0001BCA3\U0001D173-\U0001D17A\U000E0000-\U000E0FFF]+',
          '', 'g') AS seen) v
$$;
REVOKE EXECUTE ON FUNCTION public.crm_name_key(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_name_key(text) TO service_role;

-- Pre-flight. Counts only, never a name.
DO $preflight$
DECLARE
  v_blank integer;
  v_clash integer;
BEGIN
  SELECT count(*) INTO v_blank
  FROM public.crm_records r
  WHERE public.crm_name_key(normalize(r.name, NFC)) = '';
  SELECT count(*) INTO v_clash
  FROM (SELECT 1
          FROM public.crm_records r
         WHERE r.deleted_at IS NULL
         GROUP BY r.pipeline, public.crm_name_key(normalize(r.name, NFC))
        HAVING count(*) > 1) d;
  IF v_blank > 0 OR v_clash > 0 THEN
    RAISE EXCEPTION 'issue 3802 pr3 pre-flight: % record name(s) have nothing visible under the new rule and % name key(s) are shared by more than one record; rename or merge them by hand and re-run',
      v_blank, v_clash;
  END IF;
END;
$preflight$;

ALTER TABLE public.crm_records DROP CONSTRAINT crm_records_name_check;
-- Every row, changed or not: naming the column the stored key is generated
-- from recomputes the key. updated_at and updated_by are left alone on purpose.
UPDATE public.crm_records SET name = normalize(name, NFC);
ALTER TABLE public.crm_records ADD CONSTRAINT crm_records_name_check
  CHECK (name = btrim(name) AND char_length(name) BETWEEN 1 AND 160
         AND public.crm_name_key(name) <> '');
-- issue-3802-pr3 rekey: end

-- ---------------------------------------------------------------------------
-- 2. public.crm_validate_fields(): same signature, grants, messages and
-- tokens. Three changes: more characters nobody can see are removed, the
-- ideographic variation marks count as shaping (kept inside a value, nothing
-- on their own), and every value is normalised from its NFC form.
--
-- Known and accepted: removing the tag characters turns the three regional
-- flag emoji (England, Scotland, Wales) into a plain flag.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.crm_validate_fields(p_pipeline text, p_fields jsonb, p_mode text) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = ''
AS $$
DECLARE
  c_hidden  constant text := '[\u0001-\u0008\u000E-\u001F\u007F-\u0084\u0086-\u009F\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180B-\u180F\u200B\u200E\u200F\u202A-\u202E\u2060-\u206F\u2800\u3164\uFEFF\uFFA0\uFFF9-\uFFFB\U000110BD\U000110CD\U00013430-\U0001343F\U0001BCA0-\U0001BCA3\U0001D173-\U0001D17A\U000E0000-\U000E007F]';
  c_space   constant text := '[\s\u0085\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]';
  c_shaping constant text := '[\u200C\u200D\uFE00-\uFE0F\U000E0100-\U000E01EF]';
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

    -- Normalise, starting from the NFC form.
    v_txt := CASE WHEN v_type = 'null' THEN NULL
                  ELSE regexp_replace(normalize(v_val #>> '{}', NFC), c_hidden, '', 'g') END;
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
-- 3. Move a card, naming the stage it was seen in.
--
-- One function, four arguments (two overloads would make a two-argument call
-- ambiguous). The body is the previous one with one added block.
--
--   card is in | p_to | p_expected_from | result
--   X          | X    | anything        | changed: false, nothing written
--   X          | Y    | NULL            | as before
--   X          | Y    | X               | as before
--   Z          | Y    | X               | stage_changed (DETAIL = z), nothing written
--   X          | Y    | not a stage     | invalid_stage
-- ---------------------------------------------------------------------------
DROP FUNCTION public.crm_record_move_stage(uuid, text, text);
CREATE FUNCTION public.crm_record_move_stage(
  p_id uuid, p_to text, p_reason text DEFAULT NULL, p_expected_from text DEFAULT NULL) RETURNS jsonb
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
  -- The caller says which stage it last saw the card in. If the card has
  -- moved since, nothing is moved: the caller reads the card again.
  IF p_expected_from IS NOT NULL THEN
    IF public.crm_stage_def(v_rec.pipeline, p_expected_from) IS NULL THEN
      SELECT string_agg(s->>'id', ', ') INTO v_list
      FROM jsonb_array_elements(public.crm_pipeline_def(v_rec.pipeline)->'stages') s;
      RAISE EXCEPTION '%', format('invalid_stage: %s is not a stage of %s. Use one of: %s.', p_expected_from, v_rec.pipeline, v_list)
        USING ERRCODE = '22023';
    END IF;
    IF v_rec.stage <> p_expected_from THEN
      RAISE EXCEPTION '%', format('stage_changed: This card is in %s now, not %s, so nothing was moved. Read the card again and move it from where it is.',
          public.crm_stage_def(v_rec.pipeline, v_rec.stage)->>'label',
          public.crm_stage_def(v_rec.pipeline, p_expected_from)->>'label')
        USING ERRCODE = '22023', DETAIL = v_rec.stage;
    END IF;
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
REVOKE EXECUTE ON FUNCTION public.crm_record_move_stage(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_record_move_stage(uuid, text, text, text) TO authenticated, service_role;
COMMENT ON FUNCTION public.crm_record_move_stage(uuid, text, text, text) IS
  'Issue #3802. Move a card. p_expected_from is the stage the caller last saw the card in: send it on every move. If the card has moved since, the call is refused with stage_changed (DETAIL = the stage it is in now) and nothing is written; read the card again with crm_record_get and decide again. Omitting it moves the card from wherever it is. Lost and Passed need p_reason. Live sets itself. A creator needs a signed agreement for Booked or Posted.';

-- ---------------------------------------------------------------------------
-- 4. public.crm_reconcile_live(): same signature, grants, return value and
-- per-host behaviour. Only the report of skipped hosts changes.
--
--   * A run for one host (a person linked a brand): one row, every time.
--   * The scheduled run: one row, unless a scheduled run already reported the
--     very same set of hosts in the last 24 hours.
-- The row carries how many were skipped and promoted, which kind of run it
-- was, and a fingerprint of the set. Never a host, a name or an error text.
-- The warning in the server log stays on every run.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.crm_reconcile_live(p_record_id uuid DEFAULT NULL) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  c            record;
  r            public.crm_records;
  v_n          integer := 0;
  v_failed     integer := 0;
  v_failed_ids uuid[] := ARRAY[]::uuid[];
  v_fp         text;
  v_now        timestamptz;
  v_act        uuid;
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
      v_failed_ids := v_failed_ids || c.id;
      RAISE WARNING 'crm_reconcile_live: host % was skipped and will be tried again on the next run (% %)',
        c.id, SQLSTATE, SQLERRM;
    END;
  END LOOP;

  IF v_failed > 0 THEN
    v_fp := md5(array_to_string(ARRAY(SELECT f.id FROM unnest(v_failed_ids) AS f(id) ORDER BY 1), ','));
    IF p_record_id IS NOT NULL THEN
      PERFORM public.crm_audit('system', 'crm.reconcile_failed', 'crm_pipeline', 'hosts',
        jsonb_build_object('failed', v_failed, 'promoted', v_n, 'scope', 'record', 'fingerprint', v_fp));
    ELSIF NOT EXISTS (
            SELECT 1 FROM public.admin_audit_log l
             WHERE l.action = 'crm.reconcile_failed'
               AND l.metadata->>'scope' = 'scheduled'
               AND l.metadata->>'fingerprint' = v_fp
               AND l.created_at > clock_timestamp() - interval '24 hours') THEN
      PERFORM public.crm_audit('system', 'crm.reconcile_failed', 'crm_pipeline', 'hosts',
        jsonb_build_object('failed', v_failed, 'promoted', v_n, 'scope', 'scheduled', 'fingerprint', v_fp));
    END IF;
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
  'Issue #3802. The ONLY function that promotes a host to Live, from the linked brand''s public listing. Runs on brand link and every 10 minutes (pg_cron job crm_reconcile_live). Never demotes; never promotes a Lost host. Each host is handled on its own: one that fails is skipped with a warning and the rest of the run completes. A run that skipped any host writes one crm.reconcile_failed audit row (how many, never which): a run for one host every time, the scheduled run once in 24 hours for the same set of hosts and at once when the set changes. The scheduled call also purges request keys older than 30 days.';

-- ---------------------------------------------------------------------------
-- 5. Targets. Row security on, NO policies, no client privilege.
--
-- A target is one standing monthly number for a region and an ICP of the
-- Hosts pipeline. It applies to every month until it is changed or removed.
-- ---------------------------------------------------------------------------
CREATE TABLE public.crm_targets (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline       text NOT NULL DEFAULT 'hosts',
  region_id      uuid NOT NULL,                 -- seeding_cities.id, validated on write
  icp            text NOT NULL,
  monthly_target integer NOT NULL,
  created_by     text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     text NOT NULL,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crm_targets_pipeline_check CHECK (pipeline = 'hosts'),
  CONSTRAINT crm_targets_icp_check CHECK (icp IN ('restaurant_bar','venue_gallery','event_organizer','community_host','trip_stay_host','partner_org')),
  CONSTRAINT crm_targets_number_check CHECK (monthly_target BETWEEN 1 AND 1000),
  CONSTRAINT crm_targets_slice_key UNIQUE (pipeline, region_id, icp)
);

ALTER TABLE public.crm_targets ENABLE ROW LEVEL SECURITY;
-- No policies on purpose: every read and write goes through the crm_* functions.
REVOKE ALL ON public.crm_targets FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.crm_targets TO service_role;
COMMENT ON TABLE public.crm_targets IS
  'Issue #3802. One standing monthly host target per region and ICP. No client reads or writes: use crm_home_summary, crm_team_summary and crm_target_set. The region is a plain id validated on write (no foreign key on purpose).';

-- ---------------------------------------------------------------------------
-- 6. Internal helpers (service_role only; clients cannot execute them).
-- ---------------------------------------------------------------------------

-- Every stage of both pipelines, in order, with how many records sit in it.
CREATE FUNCTION public.crm_stage_counts_json() RETURNS jsonb
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT COALESCE(jsonb_object_agg(p.pipe, (
    SELECT jsonb_agg(jsonb_build_object(
             'id', s.def->>'id', 'label', s.def->>'label',
             'count', (SELECT count(*) FROM public.crm_records r
                        WHERE r.pipeline = p.pipe AND r.deleted_at IS NULL AND r.stage = s.def->>'id'))
           ORDER BY s.ord)
    FROM jsonb_array_elements(public.crm_pipeline_def(p.pipe)->'stages') WITH ORDINALITY AS s(def, ord))), '{}'::jsonb)
  FROM unnest(ARRAY['hosts', 'creators']) AS p(pipe)
$$;
REVOKE EXECUTE ON FUNCTION public.crm_stage_counts_json() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_stage_counts_json() TO service_role;

-- What is due. A record counts when it has a date on or before p_today and is
-- not in its pipeline's closing stage (Lost, Passed). p_owner NULL = the
-- whole team; otherwise only records that person owns. The counts are exact
-- even when the rows are cut at p_limit.
CREATE FUNCTION public.crm_due_json(p_owner text, p_today date, p_limit integer) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = ''
AS $$
  WITH due AS (
    SELECT r.*
    FROM public.crm_records r
    WHERE r.deleted_at IS NULL
      AND r.due_on IS NOT NULL
      AND r.due_on <= p_today
      AND NOT COALESCE((public.crm_stage_def(r.pipeline, r.stage)->>'terminal')::boolean, false)
      AND (p_owner IS NULL OR EXISTS (
            SELECT 1 FROM public.crm_record_owners o
             WHERE o.record_id = r.id AND o.owner_email = p_owner))
  )
  SELECT COALESCE(jsonb_object_agg(p.pipe, jsonb_build_object(
    'overdue', (SELECT count(*) FROM due d WHERE d.pipeline = p.pipe AND d.due_on < p_today),
    'today',   (SELECT count(*) FROM due d WHERE d.pipeline = p.pipe AND d.due_on = p_today),
    'rows', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', x.id, 'pipeline', x.pipeline, 'name', x.name, 'stage', x.stage, 'icp', x.icp,
               'region_id', x.region_id, 'next_action', x.next_action, 'due_on', x.due_on,
               'owners', COALESCE((SELECT jsonb_agg(o.owner_email ORDER BY o.owner_email)
                                     FROM public.crm_record_owners o WHERE o.record_id = x.id), '[]'::jsonb))
             ORDER BY x.due_on, x.name, x.id)
      FROM (SELECT d.* FROM due d WHERE d.pipeline = p.pipe
             ORDER BY d.due_on, d.name, d.id
             LIMIT GREATEST(COALESCE(p_limit, 0), 0)) x), '[]'::jsonb),
    'truncated', (SELECT count(*) FROM due d WHERE d.pipeline = p.pipe) > GREATEST(COALESCE(p_limit, 0), 0))), '{}'::jsonb)
  FROM unnest(ARRAY['hosts', 'creators']) AS p(pipe)
$$;
REVOKE EXECUTE ON FUNCTION public.crm_due_json(text, date, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_due_json(text, date, integer) TO service_role;

-- Every target with its progress, ordered by region name then ICP label.
--   in_pipeline: hosts in that region and ICP that are not Lost.
--   done: hosts in that region and ICP that are in a reached stage now
--         (Onboarded, Live) and first reached one on or after p_month_start
--         (UTC), going by the earliest stage move into a reached stage.
CREATE FUNCTION public.crm_targets_json(p_month_start date) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', x.id, 'region_id', x.region_id, 'region_name', x.region_name, 'icp', x.icp,
           'icp_label', x.icp_label, 'monthly_target', x.monthly_target,
           'in_pipeline', x.in_pipeline, 'done', x.done)
         ORDER BY x.region_name NULLS LAST, x.icp_label, x.id), '[]'::jsonb)
  FROM (
    SELECT t.id, t.region_id, t.icp, t.monthly_target,
           (SELECT c.name FROM public.seeding_cities c WHERE c.id = t.region_id) AS region_name,
           COALESCE((SELECT i->>'label' FROM jsonb_array_elements(public.crm_pipeline_def('hosts')->'icps') i
                      WHERE i->>'id' = t.icp), t.icp) AS icp_label,
           (SELECT count(*) FROM public.crm_records r
             WHERE r.pipeline = 'hosts' AND r.deleted_at IS NULL
               AND r.region_id = t.region_id AND r.icp = t.icp
               AND NOT COALESCE((public.crm_stage_def('hosts', r.stage)->>'terminal')::boolean, false)) AS in_pipeline,
           (SELECT count(*) FROM public.crm_records r
             WHERE r.pipeline = 'hosts' AND r.deleted_at IS NULL
               AND r.region_id = t.region_id AND r.icp = t.icp
               AND (public.crm_pipeline_def('hosts')->'reached_stages') ? r.stage
               AND (SELECT min(a.created_at) FROM public.crm_activity a
                     WHERE a.record_id = r.id AND a.kind = 'stage_move'
                       AND (public.crm_pipeline_def('hosts')->'reached_stages') ? a.to_stage)
                   >= (p_month_start::timestamp AT TIME ZONE 'UTC')) AS done
    FROM public.crm_targets t
    WHERE t.pipeline = 'hosts'
  ) x
$$;
REVOKE EXECUTE ON FUNCTION public.crm_targets_json(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_targets_json(date) TO service_role;

-- A beta lead's chosen types -> a host ICP. Exactly one distinct ICP is an
-- answer ("set"); none ("none") or more than one ("several") leaves the ICP
-- empty: it is never guessed. "labels" is what the lead chose, in words.
CREATE FUNCTION public.crm_beta_icp(p_types text[]) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$
  WITH map(type_id, label, icp) AS (VALUES
    ('restaurant',      'Restaurant',         'restaurant_bar'),
    ('cafe_bar',        E'Caf\u00E9 / Bar',   'restaurant_bar'),
    ('club_nightlife',  'Club / Nightlife',   'venue_gallery'),
    ('venue_space',     'Venue / Space',      'venue_gallery'),
    ('event_organiser', 'Event organiser',    'event_organizer'),
    ('experience_tour', 'Experience / Tour',  'trip_stay_host'),
    ('other',           'Other',              NULL)
  ),
  chosen AS (
    SELECT DISTINCT t.type_id, COALESCE(m.label, t.type_id) AS label, m.icp
    FROM unnest(COALESCE(p_types, ARRAY[]::text[])) AS t(type_id)
    LEFT JOIN map m ON m.type_id = t.type_id
    WHERE t.type_id IS NOT NULL
  ),
  icps AS (SELECT DISTINCT c.icp FROM chosen c WHERE c.icp IS NOT NULL)
  SELECT jsonb_build_object(
    'icp',  CASE WHEN (SELECT count(*) FROM icps) = 1 THEN (SELECT i.icp FROM icps i) END,
    'note', CASE (SELECT count(*) FROM icps) WHEN 1 THEN 'set' WHEN 0 THEN 'none' ELSE 'several' END,
    'labels', COALESCE((SELECT string_agg(c.label, ', ' ORDER BY c.label) FROM chosen c), ''))
$$;
REVOKE EXECUTE ON FUNCTION public.crm_beta_icp(text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_beta_icp(text[]) TO service_role;

-- A city as someone typed it -> a Launch City, by the same key names use.
-- Nothing matched: the text before the first comma is tried ("Lagos, Nigeria").
-- Exactly one city is an answer; more than one is "ambiguous"; none is
-- "not_launch_city". Live and not-yet-live cities both match.
CREATE FUNCTION public.crm_city_region(p_city text) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = ''
AS $$
DECLARE
  v_try text;
  v_key text;
  v_n   integer;
  v_id  uuid;
BEGIN
  FOREACH v_try IN ARRAY ARRAY[p_city, split_part(COALESCE(p_city, ''), ',', 1)] LOOP
    v_key := public.crm_name_key(v_try);
    IF v_key IS NULL OR v_key = '' THEN
      CONTINUE;
    END IF;
    SELECT count(*), (array_agg(c.id ORDER BY c.id))[1] INTO v_n, v_id
    FROM public.seeding_cities c
    WHERE public.crm_name_key(c.name) = v_key;
    IF v_n = 1 THEN
      RETURN jsonb_build_object('region_id', v_id, 'note', 'set');
    ELSIF v_n > 1 THEN
      RETURN jsonb_build_object('region_id', NULL, 'note', 'ambiguous');
    END IF;
  END LOOP;
  RETURN jsonb_build_object('region_id', NULL, 'note', 'not_launch_city');
END;
$$;
REVOKE EXECUTE ON FUNCTION public.crm_city_region(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_city_region(text) TO service_role;

-- ---------------------------------------------------------------------------
-- 7. Client functions. authenticated may call each; each gates FIRST.
--
-- "Today" is the viewer's own calendar day, accepted only within one day of
-- the server's (UTC) day. The month and the week are the server's: the month
-- starts on the 1st (UTC), the week on Monday 00:00 UTC.
-- ---------------------------------------------------------------------------

-- The numbers a role home shows. All four roles. Nothing here is new
-- exposure: every number can be counted from what crm_records_list already
-- returns to the same person.
CREATE FUNCTION public.crm_home_summary(p_today date DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v         record;
  v_utc     date := (now() AT TIME ZONE 'UTC')::date;
  v_today   date;
  v_month   date;
  v_new     bigint;
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  v_today := CASE WHEN p_today BETWEEN v_utc - 1 AND v_utc + 1 THEN p_today ELSE v_utc END;
  v_month := date_trunc('month', v_utc::timestamp)::date;
  IF COALESCE(public.admin_team_can('beta_leads'), false) THEN
    SELECT count(*) INTO v_new
    FROM public.beta_access_leads l
    WHERE NOT EXISTS (
      SELECT 1 FROM public.crm_records r
       WHERE r.pipeline = 'hosts' AND r.deleted_at IS NULL
         AND (r.beta_lead_id = l.id OR r.name_key = public.crm_name_key(l.brand_name)));
  END IF;
  RETURN jsonb_build_object(
    'me', jsonb_build_object(
      'email', v.actor_email,
      'display_name', public.crm_display_name(v.actor_email),
      'role', public.admin_team_role()),
    'today', v_today,
    'month_start', v_month,
    'can_set_targets', public.is_admin_user(),
    'stages', public.crm_stage_counts_json(),
    'due', jsonb_build_object(
      'mine', public.crm_due_json(v.actor_email, v_today, 50),
      'team', public.crm_due_json(NULL, v_today, 0)),
    'targets', public.crm_targets_json(v_month),
    'beta_leads_new', v_new);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.crm_home_summary(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_home_summary(date) TO authenticated, service_role;
COMMENT ON FUNCTION public.crm_home_summary(date) IS
  'Issue #3802. The numbers on a role home: stage counts, what is due (the caller''s own rows, the team''s counts), targets with progress, and how many beta leads are not in Hosts yet (null without the beta_leads area). p_today is the caller''s calendar day, accepted within one day of the server''s.';

-- The team dashboard. Owner and admin only.
CREATE FUNCTION public.crm_team_summary(p_today date DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v        record;
  v_utc    date := (now() AT TIME ZONE 'UTC')::date;
  v_today  date;
  v_month  date;
  v_week   timestamptz;
  v_new    bigint;
  v_people jsonb;
BEGIN
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'forbidden: Only an owner or admin can open the team dashboard.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v FROM public.crm_ctx();
  v_today := CASE WHEN p_today BETWEEN v_utc - 1 AND v_utc + 1 THEN p_today ELSE v_utc END;
  v_month := date_trunc('month', v_utc::timestamp)::date;
  v_week  := date_trunc('week', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';

  SELECT count(*) INTO v_new
  FROM public.beta_access_leads l
  WHERE NOT EXISTS (
    SELECT 1 FROM public.crm_records r
     WHERE r.pipeline = 'hosts' AND r.deleted_at IS NULL
       AND (r.beta_lead_id = l.id OR r.name_key = public.crm_name_key(l.brand_name)));

  -- Every teammate, then anyone else who logged something this week (so no
  -- logged activity is hidden). The system is not a person.
  WITH people AS (
    SELECT d.email, d.role, d.status, 0 AS grp, (d.role = 'owner') AS is_owner
    FROM public.admin_team_directory() d
    UNION ALL
    SELECT DISTINCT a.actor_email, NULL::text, 'former'::text, 1, false
    FROM public.crm_activity a
    WHERE a.actor_email IS NOT NULL
      AND a.created_at >= v_week
      AND NOT EXISTS (SELECT 1 FROM public.admin_team_directory() d WHERE d.email = a.actor_email)
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'email', p.email,
           'display_name', public.crm_display_name(p.email),
           'role', p.role,
           'status', p.status,
           'touches', (SELECT count(*) FROM public.crm_activity a
                        WHERE a.actor_email = p.email AND a.kind = 'touch' AND a.created_at >= v_week),
           'stage_moves', (SELECT count(*) FROM public.crm_activity a
                            WHERE a.actor_email = p.email AND a.kind = 'stage_move' AND a.created_at >= v_week),
           'added', (SELECT count(*) FROM public.crm_activity a
                      WHERE a.actor_email = p.email AND a.kind = 'created' AND a.created_at >= v_week),
           'overdue', (SELECT count(*) FROM public.crm_records r
                        JOIN public.crm_record_owners o ON o.record_id = r.id AND o.owner_email = p.email
                       WHERE r.deleted_at IS NULL AND r.due_on < v_today
                         AND NOT COALESCE((public.crm_stage_def(r.pipeline, r.stage)->>'terminal')::boolean, false)),
           'due_today', (SELECT count(*) FROM public.crm_records r
                          JOIN public.crm_record_owners o ON o.record_id = r.id AND o.owner_email = p.email
                         WHERE r.deleted_at IS NULL AND r.due_on = v_today
                           AND NOT COALESCE((public.crm_stage_def(r.pipeline, r.stage)->>'terminal')::boolean, false)))
         ORDER BY p.grp, p.is_owner DESC, p.email), '[]'::jsonb)
    INTO v_people
  FROM people p;

  RETURN jsonb_build_object(
    'me', jsonb_build_object(
      'email', v.actor_email,
      'display_name', public.crm_display_name(v.actor_email),
      'role', public.admin_team_role()),
    'today', v_today,
    'month_start', v_month,
    'week_start', v_week,
    'stages', public.crm_stage_counts_json(),
    'due', public.crm_due_json(NULL, v_today, 200),
    'by_person', v_people,
    'targets', public.crm_targets_json(v_month),
    'beta_leads_new', v_new);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.crm_team_summary(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_team_summary(date) TO authenticated, service_role;
COMMENT ON FUNCTION public.crm_team_summary(date) IS
  'Issue #3802. The team dashboard, for an owner or admin: stage counts, everything due across the team (up to 200 rows per pipeline, exact counts), this week by person since Monday 00:00 UTC, targets with progress, and beta leads not in Hosts yet.';

-- Set, change or remove one monthly target. Owner and admin only.
-- A number sets it; nothing (NULL) removes it. State-setting, so a repeat
-- changes nothing; the undo is the same call with "previous".
CREATE FUNCTION public.crm_target_set(p_region_id uuid, p_icp text, p_monthly_target integer) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v       record;
  v_row   public.crm_targets;
  v_list  text;
  v_id    uuid;
  v_now   timestamptz := clock_timestamp();
  v_month date := date_trunc('month', (now() AT TIME ZONE 'UTC'))::date;
BEGIN
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'forbidden: Only an owner or admin can set targets.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v FROM public.crm_ctx();

  IF p_region_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.seeding_cities c WHERE c.id = p_region_id) THEN
    RAISE EXCEPTION 'invalid_region: That region is not in the Launch Cities list. Use an id from crm_config().regions.'
      USING ERRCODE = '22023';
  END IF;
  IF p_icp IS NULL OR NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements(public.crm_pipeline_def('hosts')->'icps') i WHERE i->>'id' = p_icp) THEN
    SELECT string_agg(i->>'id', ', ') INTO v_list FROM jsonb_array_elements(public.crm_pipeline_def('hosts')->'icps') i;
    RAISE EXCEPTION '%', format('invalid_icp: %s is not an ICP for %s. Use one of: %s.', COALESCE(p_icp, 'nothing'), 'hosts', v_list)
      USING ERRCODE = '22023';
  END IF;
  IF p_monthly_target IS NOT NULL AND p_monthly_target NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'invalid_target: A monthly target is a whole number from 1 to 1000. Send nothing to remove the target.'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('crm_target:' || p_region_id::text || ':' || p_icp, 0));
  SELECT * INTO v_row FROM public.crm_targets t
   WHERE t.pipeline = 'hosts' AND t.region_id = p_region_id AND t.icp = p_icp;

  IF p_monthly_target IS NULL THEN
    IF v_row.id IS NULL THEN
      RETURN jsonb_build_object('changed', false, 'previous', NULL, 'target', NULL);
    END IF;
    DELETE FROM public.crm_targets t WHERE t.id = v_row.id;
    PERFORM public.crm_audit(v.actor_email, 'crm.target_remove', 'crm_target', v_row.id::text,
      jsonb_strip_nulls(jsonb_build_object('via', v.via))
        || jsonb_build_object('region_id', p_region_id, 'icp', p_icp, 'before', v_row.monthly_target));
    RETURN jsonb_build_object('changed', true, 'previous', v_row.monthly_target, 'target', NULL);
  END IF;

  IF v_row.id IS NOT NULL AND v_row.monthly_target = p_monthly_target THEN
    RETURN jsonb_build_object('changed', false, 'previous', v_row.monthly_target,
      'target', (SELECT e FROM jsonb_array_elements(public.crm_targets_json(v_month)) e WHERE e->>'id' = v_row.id::text));
  END IF;

  IF v_row.id IS NULL THEN
    INSERT INTO public.crm_targets (pipeline, region_id, icp, monthly_target, created_by, created_at, updated_by, updated_at)
    VALUES ('hosts', p_region_id, p_icp, p_monthly_target, v.actor_email, v_now, v.actor_email, v_now)
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.crm_targets
       SET monthly_target = p_monthly_target, updated_by = v.actor_email, updated_at = v_now
     WHERE id = v_row.id;
    v_id := v_row.id;
  END IF;
  PERFORM public.crm_audit(v.actor_email, 'crm.target_set', 'crm_target', v_id::text,
    jsonb_strip_nulls(jsonb_build_object('via', v.via))
      || jsonb_build_object('region_id', p_region_id, 'icp', p_icp,
                            'before', v_row.monthly_target, 'after', p_monthly_target));
  RETURN jsonb_build_object('changed', true, 'previous', v_row.monthly_target,
    'target', (SELECT e FROM jsonb_array_elements(public.crm_targets_json(v_month)) e WHERE e->>'id' = v_id::text));
END;
$$;
REVOKE EXECUTE ON FUNCTION public.crm_target_set(uuid, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_target_set(uuid, text, integer) TO authenticated, service_role;
COMMENT ON FUNCTION public.crm_target_set(uuid, text, integer) IS
  'Issue #3802. Owner and admin: set the standing monthly host target for one region and ICP (1 to 1000), or remove it by sending no number. Returns {changed, previous, target}. Sending the same number again changes nothing; the undo is the same call with previous.';

-- Beta leads, for everyone who holds the beta_leads area. Never returns the
-- phone number or anything about the device or network a lead came from.
CREATE FUNCTION public.crm_beta_leads_list() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v       record;
  v_total bigint;
  v_new   bigint;
  v_rows  jsonb;
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  IF NOT COALESCE(public.admin_team_can('beta_leads'), false) THEN
    RAISE EXCEPTION 'forbidden: Your account cannot open Beta leads. Ask the owner to give you team access.' USING ERRCODE = '42501';
  END IF;

  SELECT count(*) INTO v_total FROM public.beta_access_leads;
  SELECT count(*) INTO v_new
  FROM public.beta_access_leads l
  WHERE NOT EXISTS (
    SELECT 1 FROM public.crm_records r
     WHERE r.pipeline = 'hosts' AND r.deleted_at IS NULL
       AND (r.beta_lead_id = l.id OR r.name_key = public.crm_name_key(l.brand_name)));

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', x.id, 'created_at', x.created_at, 'brand_types', to_jsonb(x.brand_type),
           'brand_name', x.brand_name, 'contact_name', x.contact_name, 'email', x.email,
           'city', x.city, 'source', x.source,
           'suggested', jsonb_build_object(
             'icp', x.icp->>'icp',
             'icp_label', (SELECT i->>'label' FROM jsonb_array_elements(public.crm_pipeline_def('hosts')->'icps') i
                            WHERE i->>'id' = x.icp->>'icp'),
             'icp_note', x.icp->>'note',
             'region_id', x.region->>'region_id',
             'region_name', (SELECT c.name FROM public.seeding_cities c WHERE c.id = (x.region->>'region_id')::uuid),
             'region_note', x.region->>'note'),
           'host', COALESCE(
             (SELECT jsonb_build_object('id', r.id, 'name', r.name, 'stage', r.stage, 'linked', true)
                FROM public.crm_records r
               WHERE r.pipeline = 'hosts' AND r.deleted_at IS NULL AND r.beta_lead_id = x.id),
             (SELECT jsonb_build_object('id', r.id, 'name', r.name, 'stage', r.stage, 'linked', false)
                FROM public.crm_records r
               WHERE r.pipeline = 'hosts' AND r.deleted_at IS NULL
                 AND r.name_key = public.crm_name_key(x.brand_name))))
         ORDER BY x.created_at DESC, x.id), '[]'::jsonb)
    INTO v_rows
  FROM (SELECT l.id, l.created_at, l.brand_type, l.brand_name, l.contact_name, l.email, l.city, l.source,
               public.crm_beta_icp(l.brand_type) AS icp,
               public.crm_city_region(l.city) AS region
          FROM public.beta_access_leads l
         ORDER BY l.created_at DESC, l.id
         LIMIT 1000) x;

  RETURN jsonb_build_object('leads', v_rows, 'total', v_total, 'new_count', v_new, 'truncated', v_total > 1000);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.crm_beta_leads_list() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_beta_leads_list() TO authenticated, service_role;
COMMENT ON FUNCTION public.crm_beta_leads_list() IS
  'Issue #3802. Beta leads for anyone with the beta_leads area: newest first, at most 1000, each with the ICP and region Add to Hosts would carry over and the host it already is, if any. Returns the contact name and email; never a phone number, a device, a referrer or a network field.';

-- Add one beta lead to Hosts. The lead id is the key: however many times and
-- by however many people this is called, a lead becomes at most one host.
-- Returns {status: created | exists | linked | duplicate, record, ...}.
CREATE FUNCTION public.crm_beta_lead_to_host(p_lead_id uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v        record;
  v_lead   public.beta_access_leads;
  v_host   public.crm_records;
  v_icp    jsonb;
  v_region jsonb;
  v_fields jsonb;
  v_res    jsonb;
  v_note   text;
  v_now    timestamptz := clock_timestamp();
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  IF NOT COALESCE(public.admin_team_can('beta_leads'), false) THEN
    RAISE EXCEPTION 'forbidden: Your account cannot open Beta leads. Ask the owner to give you team access.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_lead FROM public.beta_access_leads l WHERE l.id = p_lead_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: That beta lead is no longer here.' USING ERRCODE = 'P0002';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('crm_beta:' || p_lead_id::text, 0));

  -- Already a host: an answer, not an error. Nothing is written.
  SELECT * INTO v_host FROM public.crm_records c
   WHERE c.pipeline = 'hosts' AND c.deleted_at IS NULL AND c.beta_lead_id = p_lead_id;
  IF FOUND THEN
    RETURN jsonb_build_object('status', 'exists', 'record', public.crm_record_lite_json(v_host));
  END IF;

  v_icp    := public.crm_beta_icp(v_lead.brand_type);
  v_region := public.crm_city_region(v_lead.city);
  -- The email goes first so it is never the part that is cut.
  v_fields := jsonb_strip_nulls(jsonb_build_object(
    'name', v_lead.brand_name,
    'icp', v_icp->>'icp',
    'region_id', v_region->>'region_id',
    'contact', left(v_lead.email || ' ' || chr(183) || ' ' || v_lead.contact_name, 300),
    'channel', 'email',
    'source', 'inbound'))
    || jsonb_build_object('owners', jsonb_build_array(v.actor_email));
  v_note := format('Type chosen: %s. City as typed: %s.', v_icp->>'labels', v_lead.city);

  BEGIN
    v_res := public.crm_record_create_core('hosts', v_fields, v.actor_email, v.via);
  EXCEPTION WHEN invalid_parameter_value THEN
    IF SQLERRM LIKE 'invalid_name:%' THEN
      RAISE EXCEPTION 'lead_name_unusable: This lead''s business name cannot be used as a host name. Add the host by hand from Hosts.'
        USING ERRCODE = '22023';
    END IF;
    RAISE;
  END;

  IF v_res->>'status' = 'duplicate' THEN
    -- A host with this name is already there. Link the lead to it if it has
    -- no lead yet; otherwise say so. Never a second host.
    SELECT * INTO v_host FROM public.crm_records c
     WHERE c.id = (v_res->'existing'->>'id')::uuid AND c.deleted_at IS NULL
       FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'try_again: Another change to the same record happened at the same moment, so nothing was saved. Send the same request again.'
        USING ERRCODE = '40001';
    END IF;
    IF v_host.beta_lead_id IS NOT NULL THEN
      RETURN jsonb_build_object('status', 'duplicate', 'record', public.crm_record_lite_json(v_host));
    END IF;
    BEGIN
      UPDATE public.crm_records
         SET beta_lead_id = p_lead_id, updated_by = v.actor_email, updated_at = v_now
       WHERE id = v_host.id;
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'try_again: Another change to the same record happened at the same moment, so nothing was saved. Send the same request again.'
        USING ERRCODE = '40001';
    END;
    INSERT INTO public.crm_activity (record_id, kind, actor_email, via, body, occurred_at, created_at)
    VALUES (v_host.id, 'note', v.actor_email, v.via, 'Linked to a beta lead. ' || v_note, v_now, v_now);
    PERFORM public.crm_audit(v.actor_email, 'crm.beta_lead_link', 'crm_record', v_host.id::text,
      jsonb_strip_nulls(jsonb_build_object('via', v.via)) || jsonb_build_object('lead_id', p_lead_id));
    SELECT * INTO v_host FROM public.crm_records c WHERE c.id = v_host.id;
    RETURN jsonb_build_object('status', 'linked', 'record', public.crm_record_lite_json(v_host));
  END IF;

  -- Created. Tie the lead to the new host, say where it came from, audit it.
  BEGIN
    UPDATE public.crm_records
       SET beta_lead_id = p_lead_id
     WHERE id = (v_res->'record'->>'id')::uuid;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'try_again: Another change to the same record happened at the same moment, so nothing was saved. Send the same request again.'
      USING ERRCODE = '40001';
  END;
  INSERT INTO public.crm_activity (record_id, kind, actor_email, via, body, occurred_at, created_at)
  VALUES ((v_res->'record'->>'id')::uuid, 'note', v.actor_email, v.via, 'Added from a beta lead. ' || v_note, v_now, v_now);
  PERFORM public.crm_audit(v.actor_email, 'crm.beta_lead_convert', 'crm_record', v_res->'record'->>'id',
    jsonb_strip_nulls(jsonb_build_object('via', v.via)) || jsonb_build_object(
      'lead_id', p_lead_id, 'icp', v_icp->>'icp', 'icp_note', v_icp->>'note',
      'region_id', v_region->>'region_id', 'region_note', v_region->>'note'));

  SELECT * INTO v_host FROM public.crm_records c WHERE c.id = (v_res->'record'->>'id')::uuid;
  RETURN jsonb_build_object('status', 'created', 'record', public.crm_record_json(v_host),
    'icp_note', v_icp->>'note', 'region_note', v_region->>'note', 'city', v_lead.city);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.crm_beta_lead_to_host(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_beta_lead_to_host(uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.crm_beta_lead_to_host(uuid) IS
  'Issue #3802. Add a beta lead to Hosts, for anyone with the beta_leads area. Safe to repeat: the lead id is the key. created = a new host (source Inbound, the caller as owner, the ICP and region carried over when the lead''s type and city give one answer); exists = this lead is already a host; linked = a host with the same name had no lead and now carries this one; duplicate = a host with the same name already carries another lead.';

-- ---------------------------------------------------------------------------
-- 8. Invitations: refuse an address that cannot be used, when it is sent.
--
-- The verdict follows the same rules as the check made when an invitation is
-- opened (supabase/functions/_shared/adminTeamInvite.ts, accountVerdict):
-- the address is fine when it has no account, or an account that signs in
-- with this email only. Where the sign-in tables cannot be read the answer is
-- "unknown", with a warning in the log; "unknown" never blocks an invitation.
-- Internal: only the owner-gated issuer below calls it.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.admin_team_invite_address_verdict(p_email text) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_email text := lower(btrim(COALESCE(p_email, '')));
  v_id    uuid;
  v_phone text;
BEGIN
  BEGIN
    SELECT u.id, u.phone INTO v_id, v_phone
    FROM auth.users u
    WHERE lower(btrim(u.email)) = v_email
    ORDER BY u.created_at
    LIMIT 1;
    IF v_id IS NULL THEN
      RETURN 'ok';
    END IF;
    IF btrim(COALESCE(v_phone, '')) <> '' THEN
      RETURN 'conflict';
    END IF;
    IF EXISTS (SELECT 1 FROM auth.identities i
                WHERE i.user_id = v_id
                  AND (i.provider = 'phone'
                       OR (i.provider <> 'email'
                           AND lower(btrim(COALESCE(i.identity_data->>'email', ''))) <> v_email))) THEN
      RETURN 'conflict';
    END IF;
    RETURN 'ok';
  EXCEPTION WHEN undefined_table OR undefined_column THEN
    RAISE WARNING 'admin_team_invite_address_verdict: the sign-in tables are not readable here; the address was not checked';
    RETURN 'unknown';
  END;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_team_invite_address_verdict(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_team_invite_address_verdict(text) TO service_role;
COMMENT ON FUNCTION public.admin_team_invite_address_verdict(text) IS
  'Issue #3802. Internal: ok, conflict or unknown for an address about to be invited. Not client-executable; called only by admin_team_issue_invite after its owner gate.';

-- Same signature and grants. One added block, after the already_active check.
-- It raises (rather than returning) so the writer's change is rolled back and
-- every caller sees a refusal, never an issued invitation.
CREATE OR REPLACE FUNCTION public.admin_team_issue_invite(p_email text, p_role text, p_token_hash text)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_res   jsonb;
  v_email text;
  v_actor text;
  v_exp   timestamptz := now() + interval '7 days';
BEGIN
  IF NOT COALESCE(public.admin_team_role() = 'owner', false) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid_token' USING ERRCODE = '22023';
  END IF;

  -- Validation, owner/self protection, per-person lock, table move and the
  -- audit row all live in the one writer.
  v_res   := public.admin_team_set_member(p_email, p_role, 'invited');
  v_email := v_res ->> 'email';

  -- Inviting must never take access away from someone who already has it.
  IF v_res -> 'previous' ->> 'status' = 'active' THEN
    RAISE EXCEPTION 'already_active' USING ERRCODE = '23505';   -- rolls the writer's change back
  END IF;

  -- An address whose account signs in another way cannot take team access.
  IF public.admin_team_invite_address_verdict(v_email) = 'conflict' THEN
    RAISE EXCEPTION 'address_in_use' USING ERRCODE = '22023';   -- rolls the writer's change back
  END IF;

  SELECT lower(btrim(u.email)) INTO v_actor FROM auth.users u WHERE u.id = auth.uid();

  INSERT INTO public.admin_team_invites AS i (email, role, token_hash, issued_by, issued_at, expires_at)
  VALUES (v_email, p_role, p_token_hash, v_actor, now(), v_exp)
  ON CONFLICT (email) DO UPDATE
     SET role = EXCLUDED.role, token_hash = EXCLUDED.token_hash, issued_by = EXCLUDED.issued_by,
         issued_at = EXCLUDED.issued_at, expires_at = EXCLUDED.expires_at,
         redeemed_at = NULL, redeemed_user_id = NULL;

  IF NOT (v_res ->> 'changed')::boolean THEN      -- same role, still invited: a re-send
    INSERT INTO public.admin_audit_log (admin_email, action, target_type, target_id, metadata)
    VALUES (v_actor, 'team.invite_resend', 'team_member', v_email, '{}'::jsonb);
  END IF;

  RETURN v_res || jsonb_build_object('expires_at', v_exp);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_team_issue_invite(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_team_issue_invite(text, text, text) TO authenticated, service_role;

-- A function signature changed: have the API layer read the schema again.
NOTIFY pgrst, 'reload schema';

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
    'public.crm_record_move_stage(uuid,text,text,text)',
    'public.crm_record_undo_stage_move(uuid)',
    'public.crm_record_set_owners(uuid,text[])',
    'public.crm_record_log(uuid,jsonb,text)',
    'public.crm_record_delete(uuid)',
    'public.crm_record_restore(uuid)',
    'public.crm_home_summary(date)',
    'public.crm_team_summary(date)',
    'public.crm_target_set(uuid,text,integer)',
    'public.crm_beta_leads_list()',
    'public.crm_beta_lead_to_host(uuid)'
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
    'public.crm_record_create_core(text,jsonb,text,text)',
    'public.crm_stage_counts_json()',
    'public.crm_due_json(text,date,integer)',
    'public.crm_targets_json(date)',
    'public.crm_beta_icp(text[])',
    'public.crm_city_region(text)',
    'public.admin_team_invite_address_verdict(text)'
  ];
  c_tables text[] := ARRAY['public.crm_records','public.crm_record_owners','public.crm_activity',
                           'public.crm_request_keys','public.crm_targets'];
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
      RAISE EXCEPTION 'issue 3802 pr3 self-check: anon can execute %', v_fn;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc p, pg_catalog.aclexplode(p.proacl) a
               WHERE p.oid = v_fn::regprocedure AND a.grantee = 0 AND a.privilege_type = 'EXECUTE')
       OR (SELECT p.proacl IS NULL FROM pg_catalog.pg_proc p WHERE p.oid = v_fn::regprocedure) THEN
      RAISE EXCEPTION 'issue 3802 pr3 self-check: PUBLIC can execute %', v_fn;
    END IF;
    IF NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'issue 3802 pr3 self-check: service_role cannot execute %', v_fn;
    END IF;
  END LOOP;
  FOREACH v_fn IN ARRAY c_client LOOP
    IF NOT has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'issue 3802 pr3 self-check: authenticated cannot execute %', v_fn;
    END IF;
  END LOOP;
  FOREACH v_fn IN ARRAY c_internal LOOP
    IF has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'issue 3802 pr3 self-check: authenticated can execute the internal %', v_fn;
    END IF;
  END LOOP;

  -- 9.2 no crm_* function exists that is not named above (a stray one would
  -- carry the default grants), and the move function exists exactly once.
  SELECT count(*) INTO v_n
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname LIKE 'crm\_%'
    AND NOT (p.oid = ANY (SELECT x::regprocedure::oid FROM unnest(c_client || c_internal) AS x));
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'issue 3802 pr3 self-check: % crm_ function(s) are not in the checked list', v_n;
  END IF;
  SELECT count(*) INTO v_n
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'crm_record_move_stage';
  IF v_n <> 1 OR (SELECT p.pronargs FROM pg_catalog.pg_proc p
                   WHERE p.oid = 'public.crm_record_move_stage(uuid,text,text,text)'::regprocedure) <> 4 THEN
    RAISE EXCEPTION 'issue 3802 pr3 self-check: expected exactly one crm_record_move_stage, with four arguments';
  END IF;

  -- 9.3 tables: nothing for anon or authenticated, row security on, no
  -- policy; and no trigger on the new one.
  FOREACH v_tbl IN ARRAY c_tables LOOP
    FOREACH v_role IN ARRAY ARRAY['anon','authenticated'] LOOP
      FOREACH v_priv IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'] LOOP
        IF has_table_privilege(v_role, v_tbl, v_priv) THEN
          RAISE EXCEPTION 'issue 3802 pr3 self-check: % holds % on %', v_role, v_priv, v_tbl;
        END IF;
      END LOOP;
      IF EXISTS (SELECT 1 FROM information_schema.column_privileges cp
                 WHERE cp.table_schema = 'public' AND 'public.' || cp.table_name = v_tbl
                   AND cp.grantee = v_role) THEN
        RAISE EXCEPTION 'issue 3802 pr3 self-check: % holds a column privilege on %', v_role, v_tbl;
      END IF;
    END LOOP;
    IF NOT (SELECT c.relrowsecurity FROM pg_catalog.pg_class c WHERE c.oid = v_tbl::regclass) THEN
      RAISE EXCEPTION 'issue 3802 pr3 self-check: row security is off on %', v_tbl;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_policy p WHERE p.polrelid = v_tbl::regclass) THEN
      RAISE EXCEPTION 'issue 3802 pr3 self-check: a policy exists on %', v_tbl;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t
             WHERE t.tgrelid = 'public.crm_targets'::regclass AND NOT t.tgisinternal) THEN
    RAISE EXCEPTION 'issue 3802 pr3 self-check: a trigger exists on public.crm_targets';
  END IF;

  -- 9.4 the two new roles can never obtain an admin area from the area map.
  IF 'admin_console' = ANY (public.admin_team_role_areas('growth'))
     OR 'admin_console' = ANY (public.admin_team_role_areas('partner'))
     OR 'team_manage' = ANY (public.admin_team_role_areas('growth'))
     OR 'team_manage' = ANY (public.admin_team_role_areas('partner')) THEN
    RAISE EXCEPTION 'issue 3802 pr3 self-check: a non-admin role was given an admin area';
  END IF;

  -- 9.5 both unique indexes exist and are valid.
  SELECT count(*) INTO v_n
  FROM pg_catalog.pg_index i
  JOIN pg_catalog.pg_class c ON c.oid = i.indexrelid
  WHERE i.indrelid = 'public.crm_records'::regclass
    AND c.relname IN ('crm_records_live_name_key', 'crm_records_live_beta_lead')
    AND i.indisunique AND i.indisvalid AND i.indpred IS NOT NULL;
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'issue 3802 pr3 self-check: expected 2 valid unique partial indexes on crm_records, found %', v_n;
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
    -- Every host ICP is a valid target ICP too.
    FOR v_stage IN SELECT s->>'id' FROM jsonb_array_elements(public.crm_pipeline_def('hosts')->'icps') s LOOP
      INSERT INTO public.crm_targets (region_id, icp, monthly_target, created_by, updated_by)
      VALUES (gen_random_uuid(), v_stage, 1, 'system', 'system');
    END LOOP;
    RAISE EXCEPTION 'issue_3802_self_check_rollback' USING ERRCODE = 'P3802';
  EXCEPTION
    WHEN SQLSTATE 'P3802' THEN
      NULL;
    WHEN check_violation THEN
      RAISE EXCEPTION 'issue 3802 pr3 self-check: crm_pipeline_def and the crm_records CHECK constraints disagree (%)', SQLERRM;
  END;

  -- 9.7 the Beta leads reader for full admins: not for anon or PUBLIC; still
  -- callable by a signed-in session; still checks for a full admin.
  IF has_function_privilege('anon', 'public.admin_beta_leads_list()', 'EXECUTE') THEN
    RAISE EXCEPTION 'issue 3802 pr3 self-check: anon can execute admin_beta_leads_list()';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.admin_beta_leads_list()', 'EXECUTE') THEN
    RAISE EXCEPTION 'issue 3802 pr3 self-check: authenticated lost admin_beta_leads_list()';
  END IF;
  IF (SELECT p.prosrc !~ 'is_admin_user\(\)' FROM pg_catalog.pg_proc p
      WHERE p.oid = 'public.admin_beta_leads_list()'::regprocedure) THEN
    RAISE EXCEPTION 'issue 3802 pr3 self-check: admin_beta_leads_list() does not check for a full admin';
  END IF;

  -- 9.8 the areas function and the invitation issuer kept their grants.
  IF has_function_privilege('anon', 'public.admin_team_role_areas(text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.admin_team_role_areas(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'issue 3802 pr3 self-check: admin_team_role_areas(text) grants changed';
  END IF;
  IF has_function_privilege('anon', 'public.admin_team_issue_invite(text,text,text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.admin_team_issue_invite(text,text,text)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.admin_team_issue_invite(text,text,text)', 'EXECUTE')
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc p, pg_catalog.aclexplode(p.proacl) a
                 WHERE p.oid = 'public.admin_team_issue_invite(text,text,text)'::regprocedure AND a.grantee = 0) THEN
    RAISE EXCEPTION 'issue 3802 pr3 self-check: admin_team_issue_invite(text,text,text) grants changed';
  END IF;

  -- 9.9 names: every stored key is what the function answers now, no two
  -- records share one, and the key behaves as written above.
  IF EXISTS (SELECT 1 FROM public.crm_records r WHERE r.name_key IS DISTINCT FROM public.crm_name_key(r.name)) THEN
    RAISE EXCEPTION 'issue 3802 pr3 self-check: a stored name key differs from crm_name_key(name)';
  END IF;
  IF EXISTS (SELECT 1 FROM public.crm_records r WHERE r.deleted_at IS NULL
              GROUP BY r.pipeline, r.name_key HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'issue 3802 pr3 self-check: two records share a name key';
  END IF;
  IF EXISTS (SELECT 1 FROM public.crm_records r WHERE r.name IS DISTINCT FROM normalize(r.name, NFC)) THEN
    RAISE EXCEPTION 'issue 3802 pr3 self-check: a stored name is not in NFC form';
  END IF;
  IF public.crm_name_key(U&'\FF30\FF41\FF4C\FF4D \FF23\FF4F\FF55\FF52\FF54') IS DISTINCT FROM public.crm_name_key('Palm Court')
     OR public.crm_name_key('Palm Court') IS DISTINCT FROM 'palmcourt' THEN
    RAISE EXCEPTION 'issue 3802 pr3 self-check: full-width and plain letters do not give the same name key';
  END IF;
  IF public.crm_name_key(U&'\2800') <> '' OR public.crm_name_key(U&'\+0E0041') <> ''
     OR public.crm_name_key(U&'\+01D173') <> '' OR public.crm_name_key(U&'\0301') <> '' THEN
    RAISE EXCEPTION 'issue 3802 pr3 self-check: a name with nothing visible in it has a name key';
  END IF;
  IF public.crm_name_key(U&'\+01F355') = '' THEN
    RAISE EXCEPTION 'issue 3802 pr3 self-check: an emoji-only name has no name key';
  END IF;

  -- 9.10 where the sign-in tables exist in the shape the verdict reads, the
  -- real lookup runs (it must not answer "unknown" on production).
  IF to_regclass('auth.identities') IS NOT NULL
     AND EXISTS (SELECT 1 FROM information_schema.columns c
                  WHERE c.table_schema = 'auth' AND c.table_name = 'users' AND c.column_name = 'phone') THEN
    IF public.admin_team_invite_address_verdict('nobody-' || gen_random_uuid()::text || '@invalid.example') IS DISTINCT FROM 'ok' THEN
      RAISE EXCEPTION 'issue 3802 pr3 self-check: the invite address check did not run against the sign-in tables';
    END IF;
  END IF;

  -- 9.11 is_admin_user() is byte-identical to what it was when this file
  -- began. (The value is remembered at the top of this file; a run of this
  -- block on its own, with nothing remembered, has nothing to compare.)
  IF NULLIF(current_setting('issue3802.pr3_admin_fn_md5', true), '') IS NOT NULL
     AND (SELECT md5(p.prosrc) FROM pg_catalog.pg_proc p WHERE p.oid = 'public.is_admin_user()'::regprocedure)
           IS DISTINCT FROM current_setting('issue3802.pr3_admin_fn_md5', true) THEN
    RAISE EXCEPTION 'issue 3802 pr3 self-check: is_admin_user() changed during this migration';
  END IF;

  -- 9.12 the schedule is still one job with the same command (where the
  -- scheduler exists).
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      SELECT count(*) INTO v_n FROM cron.job j
       WHERE j.jobname = 'crm_reconcile_live' AND btrim(j.command) = 'SELECT public.crm_reconcile_live()';
    EXCEPTION WHEN undefined_table THEN
      v_n := 1;   -- the job table is not visible on this host: nothing to check
    END;
    IF v_n <> 1 THEN
      RAISE EXCEPTION 'issue 3802 pr3 self-check: expected one crm_reconcile_live job with its command, found %', v_n;
    END IF;
  END IF;
END;
$check$;

COMMIT;
