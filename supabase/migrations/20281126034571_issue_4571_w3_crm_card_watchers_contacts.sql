-- Issue #4571 (Work pipeline redesign), wave W3: the host and creator card,
-- contacts, watchers, the board tile and "My calls today".
--   1. Socials and the website live in crm_record_identifiers (one home for
--      every contact route and its ok/bad state): a new kind website (an
--      http(s) address; normal form host and path, lower case, no trailing
--      slash) and, on handles, followers and followers_at (shown only when
--      set; never guessed). crm_identifier_set_followers sets them.
--   2. crm_record_watchers: 0 to 10 people watching a host or creator. A
--      person cannot own and watch one record: crm_record_set_people writes
--      both lists at once; crm_record_set_owners refuses an owner who watches.
--   3. Watchers hear about it (team_mentions source crm_record, one row per
--      watcher, never the actor): a person's stage move pushes (kind status);
--      calls, touches and notes are Admin-only (kind edit).
--   4. crm_record_work: every open or recently closed (14 days) Work card and
--      subtask that points at a host or creator (a host or creator link, a
--      call link on one of its calls; for hosts also any host record of the
--      brand, its promised events and the brand's events, as To do read).
--   5. crm_record_json carries watchers, identifiers with status and
--      followers, last_touch (who, when, channel, direction, outcome) and
--      open_work (crm_record_work's rule, open only). Computed on read.
--   6. crm_calls_queue: the caller's "My calls today", in the SOP order.
--
-- INVARIANT crm-record-watchers-optional-not-owner: gate crm_record_set_people
-- and crm_4571_people_overlap (crm_record_set_owners); test
-- supabase/migrations/__tests__/issue_4571_w3_crm_card.implementor.pg17.test.sql
-- INVARIANT crm-calls-queue-order: gate crm_calls_queue; same test
--
-- Static SQL only. Every replaced body is copied from its latest definition
-- (named beside it) and each edit is marked "#4571 W3".
--
-- ROLLBACK (no down file): count rows of kind website and handles with
-- followers (say how many on #4571), delete the website rows, then restore
-- crm_record_identifiers_kind_check to ('email','phone','handle') and drop
-- followers, followers_at and their check; drop crm_record_watchers,
-- crm_record_set_people, crm_record_work, crm_record_work_ids,
-- crm_calls_queue, crm_notify_watchers, crm_4571_people_overlap and
-- crm_identifier_set_followers; delete team_mentions rows of source_kind
-- crm_record and restore team_mentions_source_kind_check from
-- 20280626014398. Restore crm_ident_key from 20271015003802;
-- crm_clean_identifiers, crm_record_json from 20270831003802;
-- crm_identifiers_json and crm_record_log from 20281126024571;
-- crm_record_set_owners from 20271202003980; crm_record_move_stage from
-- 20271116003980.

BEGIN;

SET LOCAL lock_timeout = '10s';

-- ---------------------------------------------------------------------------
-- 1. Contact routes: the website kind and follower counts.
-- ---------------------------------------------------------------------------
ALTER TABLE public.crm_record_identifiers
  ADD COLUMN followers integer,
  ADD COLUMN followers_at timestamptz;
ALTER TABLE public.crm_record_identifiers
  ADD CONSTRAINT crm_record_identifiers_followers_check CHECK (
    (followers IS NULL AND followers_at IS NULL)
    OR (kind = 'handle' AND followers >= 0 AND followers_at IS NOT NULL));
COMMENT ON COLUMN public.crm_record_identifiers.followers IS
  'Issue #4571 W3. How many follow this handle, as a person last read it (followers_at). NULL: not known, and nothing is shown.';

-- From 20271015003802_issue_3802_normal_form_followup.sql:126. #4571 W3: the website kind.
CREATE OR REPLACE FUNCTION public.crm_ident_key(p_kind text, p_value text) RETURNS text
LANGUAGE plpgsql IMMUTABLE STRICT SET search_path = ''
AS $$
DECLARE
  c_hidden constant text := '[\u0000-\u0008\u000E-\u001F\u007F-\u0084\u0086-\u009F\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180B-\u180F\u200B-\u200F\u202A-\u202E\u2060-\u206F\u3164\uFE00-\uFE0F\uFEFF\uFFA0\uFFF9-\uFFFB\U000E0000-\U000E0FFF]';
  c_space  constant text := '[\u0009-\u000D \u0085\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]';
  c_name   constant text := '^[a-z0-9._-]{2,60}$';
  -- A YouTube video id, as typed: its letter case is part of it.
  c_video  constant text := '[A-Za-z0-9_-]{6,20}';
  -- Country codes of two digits; 1 and 7 are one digit; every other is three.
  c_cc2    constant text[] := ARRAY['20','27','30','31','32','33','34','36','39','40','41','43','44','45','46','47',
                                    '48','49','51','52','53','54','55','56','57','58','60','61','62','63','64','65',
                                    '66','81','82','84','86','90','91','92','93','94','95','98'];
  c_sites  constant text[] := ARRAY['instagram.com', 'tiktok.com', 'x.com', 'twitter.com', 'facebook.com',
                                    'youtube.com', 'linkedin.com'];
  -- Link-in-bio and short-link sites: the path is the person, as typed.
  c_links  constant text[] := ARRAY['linktr.ee', 'bit.ly', 'beacons.ai', 't.me', 'lnk.bio', 'linkin.bio',
                                    'taplink.cc', 'tinyurl.com', 'stan.store', 'solo.to', 'carrd.co', 'bio.link',
                                    'hoo.be', 'allmylinks.com', 'msha.ke', 'flow.page', 'linkpop.com',
                                    'campsite.bio', 'koji.to', 'snipfeed.co', 'tr.ee', 'vm.tiktok.com',
                                    'youtu.be', 'fb.me', 'm.me', 'threads.net', 'goo.gl', 'ow.ly', 'rebrand.ly'];
  -- Never a handle: WhatsApp (a phone number), and pages that forward to others.
  c_never  constant text[] := ARRAY['wa.me', 'api.whatsapp.com', 'whatsapp.com', 'l.facebook.com',
                                    'lm.facebook.com', 'l.instagram.com', 't.co'];
  -- The ends of a site name, so a plain "name.com" is read as a site.
  c_ends   constant text[] := ARRAY['com', 'net', 'org', 'io', 'co', 'ai', 'me', 'ly', 'ee', 'to', 'cc', 'bio',
                                    'link', 'page', 'store', 'app', 'site', 'uk', 'us', 'ng', 'de', 'fr', 'info',
                                    'biz', 'xyz', 'online', 'shop'];
  -- Path words of the known sites that introduce the name or id after them.
  c_lead   constant text[] := ARRAY['channel', 'c', 'user', 'in', 'company', 'school', 'pub', 'showcase',
                                    'groups', 'people', 'pages', 'stories'];
  -- Path words of the known sites that are never a person's name.
  c_words  constant text[] := ARRAY[
    'profile.php', 'channel', 'c', 'user', 'pages', 'people', 'groups', 'reel', 'reels', 'stories', 'p',
    'share', 'sharer', 'sharer.php', 'in', 'company', 'school', 'pub', 'showcase', 'explore', 'tv', 'watch',
    'shorts', 'playlist', 'hashtag', 'tag', 'tags', 'intent', 'i', 'home', 'search', 'video', 'videos',
    'events', 'photo', 'photos', 'posts', 'status', 'embed', 'live', 'feed', 'results', 'story.php',
    'permalink.php', 'login', 'signup', 'accounts', 'about', 'help', 'settings', 'discover', 'foryou',
    'following', 'music', 't', 'gaming', 'marketplace', 'profile', 'dialog', 'l.php', 'direct', 'messages'];
  o      text;
  t      text;
  v_plus text;
  v_cc   integer;
  v_site text;
  v_rest text;
  v_orig text;
  v_path text;
  v_id   text;
  v_segs text[];
  v_one  text;
  v_two  text;
  v_key  text;
  v_nat  text;
  v_opath text;
  v_osegs text[];
BEGIN
  o := regexp_replace(normalize(p_value, NFC), c_hidden, '', 'g');
  o := btrim(regexp_replace(o, c_space || '+', ' ', 'g'), ' ');
  t := translate(o, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz');
  IF char_length(t) > 200 THEN
    RETURN NULL;
  END IF;
  -- #4571 W3: a website is an http(s) address; its normal form is the
  -- lower-cased host and path, without the scheme, the query, the fragment
  -- or a trailing slash.
  IF p_kind = 'website' THEN
    IF t !~ '^https?://[a-z0-9-]+([.][a-z0-9-]+)+(:[0-9]{1,5})?([/?#][^ ]*)?$' THEN
      RETURN NULL;
    END IF;
    v_key := regexp_replace(regexp_replace(regexp_replace(t, '^https?://', ''), '[?#].*$', ''), '/+$', '');
    RETURN v_key;
  END IF;

  IF p_kind = 'email' THEN
    RETURN CASE WHEN t ~ '^[^@ ]+@[^@ ]+[.][^@ ]+$' THEN t END;
  END IF;

  IF p_kind = 'phone' THEN
    -- A WhatsApp link holds the number with its country code, without the +.
    v_plus := COALESCE(substring(t from '(?:^|[/.])wa[.]me/[+]?([0-9]{7,15})(?:[/?#]|$)'),
                       substring(t from 'whatsapp[.]com/send/?[?](?:[^#]*&)?phone=[+]?([0-9]{7,15})(?:[&#]|$)'));
    IF v_plus IS NOT NULL THEN
      t := '+' || v_plus;
    ELSE
      t := regexp_replace(t, ' *(?:ext|extension|x|#)[.]? *[0-9]{1,6} *$', '');
      t := regexp_replace(t, '[(] *0 *[)]', '', 'g');
      t := regexp_replace(t, '[^0-9+]', '', 'g');
      IF t ~ '^00' THEN
        t := '+' || substr(t, 3);
      END IF;
      t := CASE WHEN t ~ '^[+]' THEN '+' ELSE '' END || regexp_replace(t, '[^0-9]', '', 'g');
    END IF;
    IF t ~ '^[+]' THEN
      v_cc := CASE WHEN substr(t, 2, 1) IN ('1', '7') THEN 1
                   WHEN substr(t, 2, 2) = ANY (c_cc2) THEN 2 ELSE 3 END;
      t := left(t, 1 + v_cc) || regexp_replace(substr(t, 2 + v_cc), '^0', '');
      -- The mobile digit: Argentina's 9 after +54, Mexico's 1 after +52,
      -- when the ten digits of a national number follow it.
      IF t ~ '^[+]549[0-9]{10}$' OR t ~ '^[+]521[0-9]{10}$' THEN
        t := left(t, 3) || substr(t, 5);
      END IF;
      -- Argentina's other mobile marker, 15 after the area code, when an area
      -- code, 15 and the number make twelve digits: area 11 first, else a
      -- three-digit area, else a four-digit one (both begin with 2 or 3).
      IF t ~ '^[+]54[0-9]{12}$' THEN
        v_nat := substr(t, 4);
        IF v_nat ~ '^1115' THEN
          t := '+5411' || substr(v_nat, 5);
        ELSIF v_nat ~ '^[23][0-9]{2}15' THEN
          t := '+54' || left(v_nat, 3) || substr(v_nat, 6);
        ELSIF v_nat ~ '^[23][0-9]{3}15' THEN
          t := '+54' || left(v_nat, 4) || substr(v_nat, 7);
        END IF;
      END IF;
    END IF;
    RETURN CASE WHEN char_length(regexp_replace(t, '[^0-9]', '', 'g')) BETWEEN 7 AND 15 THEN t END;
  END IF;

  IF p_kind <> 'handle' THEN
    RETURN NULL;
  END IF;

  -- Written plainly.
  IF t !~ '^https?://' AND t !~ '^www[.]' AND t !~ '[/?#]' THEN
    v_key := regexp_replace(t, '^@', '');
    IF v_key = ANY (c_sites) OR v_key = ANY (c_links) OR v_key = ANY (c_never) THEN
      RETURN NULL;
    END IF;
    -- "name.com" with no @ is a site, not a name.
    IF t !~ '^@' AND v_key ~ '[.]' AND split_part(v_key, '.', array_length(string_to_array(v_key, '.'), 1)) = ANY (c_ends) THEN
      RETURN NULL;
    END IF;
    RETURN CASE WHEN v_key ~ c_name THEN v_key END;
  END IF;

  -- Written as a link.
  o := regexp_replace(o, '^[Hh][Tt][Tt][Pp][Ss]?://', '');
  t := regexp_replace(t, '^https?://', '');
  v_site := substring(t from '^[^/?#]*');
  v_rest := substr(t, char_length(v_site) + 1);
  v_orig := substr(o, char_length(v_site) + 1);
  IF v_site !~ '[.]' THEN
    -- Not a site: a name with something after it.
    v_key := regexp_replace(v_site, '^@', '');
    RETURN CASE WHEN v_key ~ c_name THEN v_key END;
  END IF;
  v_site := regexp_replace(v_site, '^(www|m|mobile)[.](?=.*[.])', '');
  v_site := regexp_replace(v_site, '^[a-z]{2}[.]linkedin[.]com$', 'linkedin.com');
  -- The path as typed, in the same segments as the lower-cased one.
  v_opath := btrim(regexp_replace(substring(v_orig from '^[^?#]*'), '/+', '/', 'g'), '/');
  v_osegs := string_to_array(v_opath, '/');
  IF v_site !~ '^[a-z0-9-]+([.][a-z0-9-]+)+$' OR v_site = ANY (c_never) THEN
    RETURN NULL;
  END IF;
  v_path := btrim(regexp_replace(substring(v_rest from '^[^?#]*'), '/+', '/', 'g'), '/');
  v_id := substring('&' || COALESCE(substring(v_rest from '^[^?#]*[?]([^#]*)'), '')
                    from '&id=([a-z0-9._-]{2,60})(?:&|$)');

  -- YouTube Music plays the same videos: its watch page is the video's.
  IF v_site = 'music.youtube.com' AND v_path = 'watch' THEN
    v_site := 'youtube.com';
  END IF;
  -- A video embedded without cookies is the same video.
  IF v_site = 'youtube-nocookie.com' AND v_path ~ '^embed/[^/]+$' AND v_osegs[2] ~ ('^' || c_video || '$') THEN
    RETURN 'youtube.com/watch?v=' || v_osegs[2];
  END IF;

  IF v_site = ANY (c_sites) THEN
    IF v_path = '' THEN
      RETURN NULL;
    END IF;
    v_segs := string_to_array(v_path, '/');
    v_one := regexp_replace(v_segs[1], '^@', '');
    -- A YouTube video names that video, by its id as typed.
    IF v_site = 'youtube.com' AND v_one = 'watch' AND cardinality(v_segs) = 1 THEN
      v_id := substring('&' || COALESCE(substring(v_orig from '^[^?#]*[?]([^#]*)'), '')
                        from '&[Vv]=(' || c_video || ')(?:&|$)');
      RETURN CASE WHEN v_id IS NOT NULL THEN 'youtube.com/watch?v=' || v_id END;
    END IF;
    -- A short, an embed and a live page name their video the same way.
    IF v_site = 'youtube.com' AND v_one IN ('shorts', 'embed', 'live') AND cardinality(v_segs) = 2
       AND v_osegs[2] ~ ('^' || c_video || '$') THEN
      RETURN 'youtube.com/watch?v=' || v_osegs[2];
    END IF;
    IF NOT (v_one = ANY (c_words)) THEN
      RETURN CASE WHEN v_one ~ c_name THEN v_one END;
    END IF;
    IF v_one = 'profile.php' THEN
      RETURN CASE WHEN cardinality(v_segs) = 1 THEN v_id END;
    END IF;
    IF NOT (v_one = ANY (c_lead)) THEN
      RETURN NULL;
    END IF;
    IF v_site = 'facebook.com' AND v_one IN ('pages', 'people') AND cardinality(v_segs) = 3
       AND v_segs[3] ~ '^[0-9]{2,60}$' THEN
      RETURN v_segs[3];
    END IF;
    v_two := regexp_replace(COALESCE(v_segs[2], ''), '^@', '');
    IF v_site = 'youtube.com' AND v_one = 'channel' AND v_two ~ c_name AND NOT (v_two = ANY (c_words)) THEN
      -- A YouTube channel id, like a video id, keeps its case.
      RETURN regexp_replace(v_osegs[2], '^@', '');
    END IF;
    RETURN CASE WHEN v_two ~ c_name AND NOT (v_two = ANY (c_words)) THEN v_two END;
  END IF;

  IF v_path = '' AND v_id IS NULL THEN
    RETURN NULL;
  END IF;
  IF v_site = ANY (c_links) THEN
    -- The path as typed: on these sites it is the whole of the person.
    v_path := btrim(regexp_replace(substring(v_orig from '^[^?#]*'), '/+', '/', 'g'), '/');
    -- A YouTube short link names the same video as its long form.
    IF v_site = 'youtu.be' AND v_path ~ ('^' || c_video || '$') THEN
      RETURN 'youtube.com/watch?v=' || v_path;
    END IF;
  END IF;
  v_key := v_site || CASE WHEN v_path <> '' THEN '/' || v_path ELSE '' END
                  || CASE WHEN v_id IS NOT NULL THEN '?id=' || v_id ELSE '' END;
  RETURN CASE WHEN v_key !~ ' ' THEN v_key END;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.crm_ident_key(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_ident_key(text, text) TO service_role;
COMMENT ON FUNCTION public.crm_ident_key(text, text) IS
  'Issue #3802 / #4571 W3. Internal: the one normal form of an email, a phone number, a handle or a website, or NULL when the value is not usable as that kind.';


-- From 20270831003802_issue_3802_wave4_agent_write_setup.sql:419. #4571 W3: accepts website.
CREATE OR REPLACE FUNCTION public.crm_clean_identifiers(p_items jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = ''
AS $$
DECLARE
  c_shape constant text := 'invalid_identifiers: Send identifiers as a list of at most 20 items like {"kind": "email", "value": "name@example.com"}. Kinds: email, phone, handle, website.';
  v_item jsonb;
  v_kind text;
  v_raw  text;
  v_txt  text;
  v_plat text;
  v_key  text;
  v_low  text;
  v_out  jsonb := '[]'::jsonb;
BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items) = 'null' THEN
    RETURN NULL;
  END IF;
  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) > 20 THEN
    RAISE EXCEPTION '%', c_shape USING ERRCODE = '22023';
  END IF;
  FOR v_item IN SELECT t.e FROM jsonb_array_elements(p_items) WITH ORDINALITY AS t(e, ord) ORDER BY t.ord LOOP
    IF jsonb_typeof(v_item) <> 'object'
       OR EXISTS (SELECT 1 FROM jsonb_object_keys(v_item) AS k WHERE k NOT IN ('kind', 'value', 'platform'))
       OR jsonb_typeof(v_item->'kind') IS DISTINCT FROM 'string'
       OR jsonb_typeof(v_item->'value') IS DISTINCT FROM 'string'
       OR (v_item ? 'platform' AND jsonb_typeof(v_item->'platform') NOT IN ('string', 'null'))
       OR (v_item->>'kind') NOT IN ('email', 'phone', 'handle', 'website') THEN  -- #4571 W3
      RAISE EXCEPTION '%', c_shape USING ERRCODE = '22023';
    END IF;
    v_kind := v_item->>'kind';
    v_raw  := v_item->>'value';
    v_txt  := NULL;
    IF char_length(v_raw) <= 300 THEN
      BEGIN
        v_txt := public.crm_validate_fields('hosts', jsonb_build_object('contact', v_raw), 'update')->>'contact';
      EXCEPTION WHEN invalid_parameter_value THEN
        v_txt := NULL;
      END;
    END IF;
    -- A WhatsApp link is a phone number, whichever kind it was sent as.
    IF v_kind = 'handle' AND v_txt IS NOT NULL AND v_txt ~* '((^|[/.])wa[.]me/[+]?[0-9]{7,15}([/?#]|$)|whatsapp[.]com/send/?[?]([^#]*&)?phone=[+]?[0-9]{7,15}([&#]|$))'
       AND public.crm_ident_key('phone', v_txt) IS NOT NULL THEN
      v_kind := 'phone';
    END IF;
    IF v_txt IS NOT NULL AND char_length(v_txt) <= 200 THEN
      v_key := public.crm_ident_key(v_kind, v_txt);
    ELSE
      v_key := NULL;
    END IF;
    IF v_key IS NULL AND v_kind = 'handle' AND v_txt ~* '(facebook[.]com/(sharer|share|dialog)|sharer[.]php|(twitter|x)[.]com/intent|linkedin[.]com/(share|sharing)|(^|[/.])(l|lm)[.]facebook[.]com|l[.]instagram[.]com|(^|//)t[.]co/|google[.][a-z.]+/url)' THEN
      RAISE EXCEPTION '%', format('invalid_identifier: "%s" is a link that shares or forwards a page, not a profile. Paste the link to the profile itself instead.',
        left(v_txt, 60)) USING ERRCODE = '22023';
    END IF;
    IF v_key IS NULL THEN
      RAISE EXCEPTION '%', format('invalid_identifier: "%s" is not a usable %s. %s',
        left(COALESCE(v_txt, regexp_replace(left(v_raw, 60), '[[:cntrl:]]', '', 'g')), 60), v_kind,
        CASE v_kind WHEN 'email' THEN 'An email needs a name, an @ and a domain.'
                    WHEN 'phone' THEN 'A phone number needs 7 to 15 digits.'
                    WHEN 'website' THEN 'A website is a link that starts with http:// or https://, like https://example.com.'  -- #4571 W3
                    ELSE 'A handle is 2 to 60 letters, digits, dots or underscores, with or without @, or the link to a profile. A site on its own, a post, a search or a share link names no one.' END)
        USING ERRCODE = '22023';
    END IF;

    v_plat := NULLIF(btrim(COALESCE(v_item->>'platform', '')), '');
    IF v_plat IS NOT NULL AND (v_kind <> 'handle'
         OR v_plat NOT IN ('instagram', 'tiktok', 'x', 'facebook', 'youtube', 'linkedin', 'other')) THEN
      RAISE EXCEPTION 'invalid_identifiers: A platform goes with a handle only, and is one of instagram, tiktok, x, facebook, youtube, linkedin, other.'
        USING ERRCODE = '22023';
    END IF;
    IF v_plat IS NULL AND v_kind = 'handle' THEN
      -- Taken from the address the handle was written as, when it was one.
      v_low := regexp_replace(regexp_replace(regexp_replace(lower(v_txt), '^https?://', ''),
                                             '^(www|m|mobile)[.](?=.*[.])', ''),
                              '^[a-z]{2}[.]linkedin[.]com', 'linkedin.com');
      v_plat := CASE
        WHEN v_low LIKE 'instagram.com/%' THEN 'instagram'
        WHEN v_low LIKE 'tiktok.com/%' THEN 'tiktok'
        WHEN v_low LIKE 'x.com/%' OR v_low LIKE 'twitter.com/%' THEN 'x'
        WHEN v_low LIKE 'facebook.com/%' THEN 'facebook'
        WHEN v_low LIKE 'youtube.com/%' THEN 'youtube'
        WHEN v_low LIKE 'linkedin.com/%' THEN 'linkedin'
        ELSE NULL
      END;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_out) AS o
                    WHERE o->>'kind' = v_kind AND o->>'value_key' = v_key) THEN
      v_out := v_out || jsonb_build_array(jsonb_build_object(
        'kind', v_kind, 'platform', v_plat, 'value', v_txt, 'value_key', v_key));
    END IF;
  END LOOP;
  RETURN COALESCE((SELECT jsonb_agg(o ORDER BY o->>'kind', o->>'value_key') FROM jsonb_array_elements(v_out) AS o), '[]'::jsonb);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.crm_clean_identifiers(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_clean_identifiers(jsonb) TO service_role;
COMMENT ON FUNCTION public.crm_clean_identifiers(jsonb) IS
  'Issue #3802 / #4571 W3. Internal: a caller''s list of emails, phone numbers, handles and websites, cleaned, checked and without repeats, each with its normal form.';

ALTER TABLE public.crm_record_identifiers DROP CONSTRAINT crm_record_identifiers_kind_check,
  ADD CONSTRAINT crm_record_identifiers_kind_check CHECK (kind IN ('email','phone','handle','website'));  -- #4571 W3

-- #4571 W3: each identifier with its follower count and when it went bad.
-- From 20281126024571_issue_4571_w2_links_and_call_outcomes.sql:1000.
CREATE OR REPLACE FUNCTION public.crm_identifiers_json(p_record_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('kind', i.kind, 'platform', i.platform, 'value', i.value, 'key', i.value_key,
                                               'id', i.id, 'status', i.status, 'bad_reason', i.bad_reason,  -- #4571 W2
                                               'bad_at', i.bad_at, 'followers', i.followers, 'followers_at', i.followers_at)  -- #4571 W3
                            ORDER BY i.kind, i.value_key), '[]'::jsonb)
  FROM public.crm_record_identifiers i
  WHERE i.record_id = p_record_id
$$;

-- #4571 W3: a person sets (or clears, with NULL) the follower count of one
-- handle on a record they can work. Never an agent's guess: people only.
CREATE FUNCTION public.crm_identifier_set_followers(p_identifier_id uuid, p_followers integer) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v     record;
  v_id  public.crm_record_identifiers;
  v_rec public.crm_records;
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  IF v.via IS NOT NULL THEN
    RAISE EXCEPTION 'needs_a_person: Follower counts are set by a person in Admin.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_id FROM public.crm_record_identifiers i WHERE i.id = p_identifier_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: That contact detail is no longer on the card.' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v_rec FROM public.crm_records c WHERE c.id = v_id.record_id AND c.deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: That record is no longer here. It may have been deleted.' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public.ops_claim_assert('crm_record', v_rec.id, v.actor_email, v.via);
  IF v_id.kind <> 'handle' THEN
    RAISE EXCEPTION 'invalid_value: Only a social handle has followers.' USING ERRCODE = '22023';
  END IF;
  IF p_followers IS NOT NULL AND (p_followers < 0 OR p_followers > 2000000000) THEN
    RAISE EXCEPTION 'invalid_value: Followers is a whole number from 0.' USING ERRCODE = '22023';
  END IF;
  UPDATE public.crm_record_identifiers
     SET followers = p_followers, followers_at = CASE WHEN p_followers IS NULL THEN NULL ELSE clock_timestamp() END
   WHERE id = v_id.id;
  UPDATE public.crm_records SET updated_by = v.actor_email, updated_at = clock_timestamp() WHERE id = v_rec.id;
  PERFORM public.crm_audit(v.actor_email, 'crm.followers_set', 'crm_record', v_rec.id::text,
    jsonb_build_object('identifier_id', v_id.id, 'before', v_id.followers, 'after', p_followers));
  SELECT * INTO v_rec FROM public.crm_records c WHERE c.id = v_rec.id;
  RETURN jsonb_build_object('record', public.crm_record_json(v_rec), 'changed', v_id.followers IS DISTINCT FROM p_followers);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.crm_identifier_set_followers(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_identifier_set_followers(uuid, integer) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Watchers on records.
-- ---------------------------------------------------------------------------
CREATE TABLE public.crm_record_watchers (
  record_id     uuid NOT NULL REFERENCES public.crm_records(id) ON DELETE CASCADE,
  watcher_email text NOT NULL,
  added_by      text NOT NULL,
  added_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (record_id, watcher_email),
  CONSTRAINT crm_record_watchers_email_normalised CHECK (watcher_email = lower(btrim(watcher_email)) AND watcher_email <> '')
);
CREATE INDEX crm_record_watchers_by_watcher ON public.crm_record_watchers (watcher_email);
ALTER TABLE public.crm_record_watchers ENABLE ROW LEVEL SECURITY;
-- No policies on purpose: every read and write goes through the crm_* functions.
REVOKE ALL ON public.crm_record_watchers FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.crm_record_watchers TO service_role;
COMMENT ON TABLE public.crm_record_watchers IS
  'Issue #4571 W3. Who watches a host or creator: 0 to 10 team members, never one of its owners. They hear about stage moves (push) and see calls and notes in Admin. Written only by crm_record_set_people.';

-- #4571 W3 gate for INVARIANT crm-record-watchers-optional-not-owner. Owners
-- (p_owners) against the record's watchers, or watchers (p_watchers) against
-- p_owners. Removing this lets one person own and watch a record;
-- issue_4571_w3_crm_card.implementor.pg17.test.sql fails.
CREATE FUNCTION public.crm_4571_people_overlap(p_record_id uuid, p_owners text[], p_watchers text[]) RETURNS void
LANGUAGE plpgsql STABLE SET search_path = ''
AS $$
DECLARE v_both text;
BEGIN
  SELECT o.e INTO v_both
    FROM unnest(COALESCE(p_owners, ARRAY[]::text[])) AS o(e)
   WHERE o.e = ANY (COALESCE(p_watchers,
           ARRAY(SELECT w.watcher_email FROM public.crm_record_watchers w WHERE w.record_id = p_record_id)))
   ORDER BY o.e LIMIT 1;
  IF v_both IS NOT NULL THEN
    RAISE EXCEPTION '%', format('owner_and_watcher: %s cannot own and watch this card at once. Take them off Watching first, or keep them as a watcher only.',
        public.ops_name(v_both)) USING ERRCODE = '22023';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.crm_4571_people_overlap(uuid, text[], text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_4571_people_overlap(uuid, text[], text[]) TO service_role;

-- #4571 W3: owners and watchers in one step. Owners: 1 to 10 once a record
-- has one (as crm_record_set_owners); watchers: 0 to 10, optional. Nobody in
-- both. p_expected_updated_at, when sent, must be the record's updated_at the
-- caller last read: otherwise nothing changes (PT409, read the card again).
CREATE FUNCTION public.crm_record_set_people(p_id uuid, p_owner_emails text[], p_watcher_emails text[], p_expected_updated_at timestamptz DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v       record;
  v_rec   public.crm_records;
  v_own   text[];
  v_wat   text[];
  v_old_o text[];
  v_old_w text[];
  v_now   timestamptz := clock_timestamp();
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  SELECT * INTO v_rec FROM public.crm_records c WHERE c.id = p_id AND c.deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: That record is no longer here. It may have been deleted.' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public.ops_claim_assert('crm_record', v_rec.id, v.actor_email, v.via);
  IF p_expected_updated_at IS NOT NULL AND v_rec.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'stale: Someone changed this card since you opened it, so nothing was changed. Read it again and try once more.'
      USING ERRCODE = 'PT409';
  END IF;

  v_own := public.crm_clean_owners(to_jsonb(COALESCE(p_owner_emails, ARRAY[]::text[])));
  BEGIN
    v_wat := public.crm_clean_owners(to_jsonb(COALESCE(p_watcher_emails, ARRAY[]::text[])));
  EXCEPTION WHEN invalid_parameter_value THEN
    RAISE EXCEPTION '%', replace(replace(SQLERRM, 'too_many_owners: A card can have at most 10 owners.', 'too_many_watchers: A card can have at most 10 watchers.'),
                                 'unknown_owner:', 'unknown_watcher:') USING ERRCODE = '22023';
  END;
  PERFORM public.crm_4571_people_overlap(v_rec.id, v_own, v_wat);
  SELECT COALESCE(array_agg(o.owner_email ORDER BY o.owner_email), ARRAY[]::text[]) INTO v_old_o
    FROM public.crm_record_owners o WHERE o.record_id = v_rec.id;
  SELECT COALESCE(array_agg(w.watcher_email ORDER BY w.watcher_email), ARRAY[]::text[]) INTO v_old_w
    FROM public.crm_record_watchers w WHERE w.record_id = v_rec.id;
  IF v_own = v_old_o AND v_wat = v_old_w THEN
    RETURN jsonb_build_object('record', public.crm_record_json(v_rec), 'changed', false);
  END IF;
  IF cardinality(v_old_o) > 0 AND cardinality(v_own) = 0 THEN
    RAISE EXCEPTION 'last_owner: A card always keeps one owner. Add someone else first, then remove this one.' USING ERRCODE = '22023';
  END IF;

  DELETE FROM public.crm_record_watchers w WHERE w.record_id = v_rec.id AND NOT (w.watcher_email = ANY (v_wat));
  DELETE FROM public.crm_record_owners o WHERE o.record_id = v_rec.id AND NOT (o.owner_email = ANY (v_own));
  INSERT INTO public.crm_record_owners (record_id, owner_email, added_by, added_at)
  SELECT v_rec.id, n.e, v.actor_email, v_now FROM unnest(v_own) AS n(e) WHERE NOT (n.e = ANY (v_old_o));
  INSERT INTO public.crm_record_watchers (record_id, watcher_email, added_by, added_at)
  SELECT v_rec.id, n.e, v.actor_email, v_now FROM unnest(v_wat) AS n(e) WHERE NOT (n.e = ANY (v_old_w));
  UPDATE public.crm_records SET updated_by = v.actor_email, updated_at = v_now WHERE id = v_rec.id;
  PERFORM public.crm_audit(v.actor_email, 'crm.people_set', 'crm_record', v_rec.id::text,
    jsonb_strip_nulls(jsonb_build_object('via', v.via))
      || jsonb_build_object('before', jsonb_build_object('owners', to_jsonb(v_old_o), 'watchers', to_jsonb(v_old_w)),
                            'after', jsonb_build_object('owners', to_jsonb(v_own), 'watchers', to_jsonb(v_wat))));
  IF cardinality(v_old_o) = 0 AND cardinality(v_own) > 0 AND v_rec.pipeline = 'hosts' THEN
    PERFORM public.ops_host_adopt_cards(v_rec.id, v.actor_email, v.via);
  END IF;
  SELECT * INTO v_rec FROM public.crm_records c WHERE c.id = p_id;
  RETURN jsonb_build_object('record', public.crm_record_json(v_rec), 'changed', true);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.crm_record_set_people(uuid, text[], text[], timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_record_set_people(uuid, text[], text[], timestamptz) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Watchers hear about it.
-- ---------------------------------------------------------------------------
ALTER TABLE public.team_mentions DROP CONSTRAINT team_mentions_source_kind_check;
ALTER TABLE public.team_mentions ADD CONSTRAINT team_mentions_source_kind_check
  CHECK (source_kind = ANY (ARRAY['content_calendar_comment','work_card','team_message','work_due','ops_activity','crm_record']::text[]));  -- #4571 W3

-- #4571 W3: one notice per watcher of a record (never the actor). p_kind
-- 'status' (a stage move) goes through ops_notify_push: a person's move is
-- an Admin row plus the admin email and the Host app push; anything else
-- (calls, touches, notes: 'edit'; anything system@ does) is an Admin-only
-- row. The excerpt never carries what was said, a number or an address.
CREATE FUNCTION public.crm_notify_watchers(p_record_id uuid, p_activity_id uuid, p_actor text, p_excerpt text, p_kind text) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_rec     public.crm_records;
  v_kind    text := CASE WHEN p_kind = 'status' THEN 'status' ELSE 'edit' END;
  v_push    boolean;
  v_actor   uuid;
  v_uid     uuid;
  v_email   text;
  v_mention uuid;
  v_told    integer := 0;
  v_link    text;
  v_excerpt text := COALESCE(left(public.ops_one_line(p_excerpt), 280), 'A card you watch changed.');
BEGIN
  SELECT * INTO v_rec FROM public.crm_records c WHERE c.id = p_record_id;
  IF NOT FOUND OR p_activity_id IS NULL THEN RETURN 0; END IF;
  v_push := public.ops_notify_push(v_kind, p_actor);
  v_link := 'https://admin.usemingla.com/#/' || v_rec.pipeline || '?card=' || v_rec.id::text;
  SELECT u.id INTO v_actor FROM auth.users u WHERE lower(btrim(u.email)) = lower(btrim(p_actor)) ORDER BY u.created_at LIMIT 1;
  FOR v_email IN SELECT w.watcher_email FROM public.crm_record_watchers w
                  WHERE w.record_id = v_rec.id AND w.watcher_email <> lower(btrim(COALESCE(p_actor, '')))
                  ORDER BY w.watcher_email LOOP
    v_uid := NULL;
    SELECT u.id INTO v_uid FROM auth.users u
     WHERE lower(btrim(u.email)) = v_email AND public.issue_3720_active_team_member(u.id)
     ORDER BY u.created_at LIMIT 1;
    CONTINUE WHEN v_uid IS NULL;
    v_mention := NULL;
    INSERT INTO public.team_mentions (source_kind, source_id, actor_user_id, target_user_id, body_excerpt, deep_link, event_kind, push)
    VALUES ('crm_record', p_activity_id, v_actor, v_uid, v_excerpt, v_link, v_kind, v_push)
    ON CONFLICT (source_kind, source_id, target_user_id) DO NOTHING
    RETURNING id INTO v_mention;
    CONTINUE WHEN v_mention IS NULL;
    v_told := v_told + 1;
    CONTINUE WHEN NOT v_push;
    INSERT INTO public.notification_outbox (category_key, user_id, country_code, payload, idempotency_key, status)
    VALUES ('admin.team_mention', v_uid, NULL,
      jsonb_build_object('title', left(v_excerpt, 150), 'body', left(v_excerpt, 180), 'mention_id', v_mention,
        'source_kind', 'crm_record', 'source_id', p_activity_id, 'deep_link', v_link,
        'record_id', v_rec.id, 'record_name', v_rec.name),
      'admin.team_mention:' || v_mention::text, 'pending')
    ON CONFLICT (idempotency_key) DO NOTHING;
    IF public.team_chat_staff(v_uid) THEN
      INSERT INTO public.notification_outbox (category_key, user_id, country_code, payload, idempotency_key, status)
      VALUES ('business.team_mention', v_uid, NULL,
        jsonb_build_object('source_kind', 'crm_record', 'reason', 'work_update',
          'mention_id', v_mention, 'source_id', p_activity_id, 'record_id', v_rec.id, 'record_name', v_rec.name,
          'deep_link', 'mingla-business://team/mention/' || v_mention::text),
        'business.team_mention:' || v_mention::text, 'pending')
      ON CONFLICT (idempotency_key) DO NOTHING;
    END IF;
  END LOOP;
  RETURN v_told;
END;
$$;
REVOKE ALL ON FUNCTION public.crm_notify_watchers(uuid, uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_notify_watchers(uuid, uuid, text, text, text) TO service_role;

-- ---------------------------------------------------------------------------
-- 4. The reverse Work list.
-- ---------------------------------------------------------------------------
-- #4571 W3: the cards (any depth, not archived) that point at a record: a
-- host or creator link on it, or a call link on one of its calls. For a host
-- also what its To do reads (#4270 W2): a host link on any host record of the
-- same brand, its promised events and the brand's events.
CREATE FUNCTION public.crm_record_work_ids(p_id uuid) RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  WITH r AS (SELECT c.id, c.pipeline, c.brand_id FROM public.crm_records c WHERE c.id = p_id),
  recs AS (SELECT x.id FROM public.crm_records x, r
            WHERE x.deleted_at IS NULL AND x.pipeline = r.pipeline
              AND (x.id = r.id OR (r.pipeline = 'hosts' AND r.brand_id IS NOT NULL AND x.brand_id = r.brand_id))
           UNION SELECT r.id FROM r)
  SELECT w.id FROM public.ops_work_cards w, r
   WHERE w.archived_at IS NULL
     AND (EXISTS (SELECT 1 FROM public.ops_work_links l
                   WHERE l.card_id = w.id AND l.kind = CASE r.pipeline WHEN 'hosts' THEN 'host' ELSE 'creator' END
                     AND l.target_id IN (SELECT recs.id FROM recs))
          OR EXISTS (SELECT 1 FROM public.ops_work_links l JOIN public.crm_activity a ON a.id = l.target_id
                      WHERE l.card_id = w.id AND l.kind = 'call' AND a.record_id IN (SELECT recs.id FROM recs))
          OR (r.pipeline = 'hosts' AND w.anchor_kind = 'expected'
              AND w.anchor_id IN (SELECT z.id FROM public.ops_expected_events z WHERE z.record_id IN (SELECT recs.id FROM recs)))
          OR (r.pipeline = 'hosts' AND w.anchor_kind = 'event' AND r.brand_id IS NOT NULL
              AND w.anchor_id IN (SELECT e.id FROM public.events e WHERE e.brand_id = r.brand_id)))
$$;
REVOKE ALL ON FUNCTION public.crm_record_work_ids(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_record_work_ids(uuid) TO service_role;

-- #4571 W3: the Work section of a host or creator card. Open cards and
-- subtasks first (oldest due first), then those closed in the last 14 days.
-- Names only for people (the card's reads carry no email). Agents may read.
CREATE FUNCTION public.crm_record_work(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v       record;
  v_rec   public.crm_records;
  v_today date;
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  SELECT * INTO v_rec FROM public.crm_records c WHERE c.id = p_id AND c.deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: That record is no longer here. It may have been deleted.' USING ERRCODE = 'P0002';
  END IF;
  v_today := public.ops_today(NULL);
  RETURN jsonb_build_object(
    'record_id', v_rec.id,
    'cards', COALESCE((
      SELECT jsonb_agg(public.ops_card_lite(c) || jsonb_build_object(
               'overdue', c.status <> 'done' AND c.due_on < v_today,
               'closed_at', c.closed_at,
               'parent_number', (SELECT pc.number FROM public.ops_work_cards pc WHERE pc.id = c.parent_id),
               'owners', COALESCE((SELECT jsonb_agg(jsonb_build_object('name', public.ops_name(p.email)) ORDER BY p.added_at, p.email)
                                     FROM public.ops_work_people p WHERE p.card_id = c.id AND p.role = 'owner'), '[]'::jsonb),
               'watchers', COALESCE((SELECT jsonb_agg(jsonb_build_object('name', public.ops_name(p.email)) ORDER BY p.added_at, p.email)
                                       FROM public.ops_work_people p WHERE p.card_id = c.id AND p.role = 'watcher'), '[]'::jsonb))
             ORDER BY (c.status = 'done'), c.due_on NULLS LAST, c.number)
        FROM public.ops_work_cards c
       WHERE c.id IN (SELECT public.crm_record_work_ids(v_rec.id))
         AND (c.status <> 'done' OR c.closed_at > now() - interval '14 days')), '[]'::jsonb),
    'open_count', (SELECT count(*) FROM public.ops_work_cards c
                    WHERE c.id IN (SELECT public.crm_record_work_ids(v_rec.id)) AND c.status <> 'done'));
END;
$$;
REVOKE EXECUTE ON FUNCTION public.crm_record_work(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_record_work(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. The record shape: watchers, last touch, open Work. Computed on read.
-- ---------------------------------------------------------------------------
-- From 20270831003802_issue_3802_wave4_agent_write_setup.sql:998. #4571 W3: watchers, last_touch, open_work.
CREATE OR REPLACE FUNCTION public.crm_record_json(r public.crm_records) RETURNS jsonb
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
    'identifiers', public.crm_identifiers_json(r.id),
    'contact_rule', r.contact_rule, 'contact_rule_reason', r.contact_rule_reason,
    'contact_rule_by', r.contact_rule_by, 'contact_rule_at', r.contact_rule_at,
    'last_touch_at', (SELECT max(a.occurred_at) FROM public.crm_activity a WHERE a.record_id = r.id AND a.kind = 'touch'),
    'touch_count', (SELECT count(*) FROM public.crm_activity a WHERE a.record_id = r.id AND a.kind = 'touch'),
    'created_by', r.created_by, 'created_at', r.created_at, 'updated_at', r.updated_at)
  || jsonb_build_object(  -- #4571 W3
    'watchers', COALESCE((SELECT jsonb_agg(w.watcher_email ORDER BY w.watcher_email)
                            FROM public.crm_record_watchers w WHERE w.record_id = r.id), '[]'::jsonb),
    'last_touch', (SELECT jsonb_build_object('at', a.occurred_at, 'actor_name', public.ops_name(a.actor_email),
                                             'channel', a.channel, 'direction', a.direction, 'outcome', a.call_outcome)
                     FROM public.crm_activity a WHERE a.record_id = r.id AND a.kind = 'touch'
                    ORDER BY a.occurred_at DESC, a.created_at DESC, a.id LIMIT 1),
    'open_work', (SELECT count(*) FROM public.ops_work_cards c
                   WHERE c.id IN (SELECT public.crm_record_work_ids(r.id)) AND c.status <> 'done'))
$$;

-- ---------------------------------------------------------------------------
-- 6. Owners refuse a watcher; moves and logs tell the watchers.
-- ---------------------------------------------------------------------------

-- From 20271202003980_issue_3980_synced_w4_backfills_guide.sql:562. #4571 W3: refuses an owner who is watching.
CREATE OR REPLACE FUNCTION public.crm_record_set_owners(p_id uuid, p_owner_emails text[]) RETURNS jsonb
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
  PERFORM public.ops_claim_assert('crm_record', v_rec.id, v.actor_email, v.via);

  v_new := public.crm_clean_owners(to_jsonb(COALESCE(p_owner_emails, ARRAY[]::text[])));
  SELECT COALESCE(array_agg(o.owner_email ORDER BY o.owner_email), ARRAY[]::text[]) INTO v_old
  FROM public.crm_record_owners o WHERE o.record_id = v_rec.id;

  -- #4571 W3 gate for INVARIANT crm-record-watchers-optional-not-owner: a
  -- watcher is not also an owner (take them off Watching first).
  PERFORM public.crm_4571_people_overlap(v_rec.id, v_new, NULL);
  IF v_new = v_old THEN
    RETURN jsonb_build_object('record', public.crm_record_json(v_rec), 'changed', false);
  END IF;
  IF cardinality(v_old) > 0 AND cardinality(v_new) = 0 THEN
    RAISE EXCEPTION 'last_owner: A card always keeps one owner. Add someone else first, then remove this one.' USING ERRCODE = '22023';
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
  IF cardinality(v_old) = 0 AND v_rec.pipeline = 'hosts' THEN
    PERFORM public.ops_host_adopt_cards(v_rec.id, v.actor_email, v.via);
  END IF;

  SELECT * INTO v_rec FROM public.crm_records c WHERE c.id = p_id;
  RETURN jsonb_build_object('record', public.crm_record_json(v_rec), 'changed', true);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.crm_record_set_owners(uuid, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_record_set_owners(uuid, text[]) TO authenticated, service_role;

-- From 20271116003980_issue_3980_wave1_work_board.sql:2798. #4571 W3: tells the record's watchers.
CREATE OR REPLACE FUNCTION public.crm_record_move_stage(
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
  PERFORM public.ops_claim_assert('crm_record', v_rec.id, v.actor_email, v.via);

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
  -- #4571 W3: the record's watchers hear about it (a person's move pushes).
  PERFORM public.crm_notify_watchers(v_rec.id, v_act, v.actor_email,
    format('%s moved %s to %s', public.ops_name(v.actor_email), v_rec.name, v_to->>'label'), 'status');

  SELECT * INTO v_rec FROM public.crm_records c WHERE c.id = p_id;
  RETURN jsonb_build_object('record', public.crm_record_json(v_rec), 'changed', true, 'activity_id', v_act);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.crm_record_move_stage(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_record_move_stage(uuid, text, text, text) TO authenticated, service_role;

-- From 20281126024571_issue_4571_w2_links_and_call_outcomes.sql:1011. #4571 W3: tells the record's watchers.
CREATE OR REPLACE FUNCTION public.crm_record_log(p_id uuid, p_entry jsonb, p_request_key text) RETURNS jsonb
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
  v_other     jsonb;
  -- #4571 W2: a call's outcome, length, the number dialled and its Work card.
  v_outcome   text;
  v_duration  integer;
  v_ident     public.crm_record_identifiers;
  v_ident_in  text;
  v_card      public.ops_work_cards;
  v_card_in   text;
  v_suggest   jsonb;
  c_call_keys constant text[] := ARRAY['outcome','duration_seconds','identifier_id','identifier','work_card_id','work_card'];
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
  PERFORM public.ops_claim_assert('crm_record', v_rec.id, v.actor_email, v.via);
  -- Normalised and checked in the shared helper (kind, text, channel,
  -- direction, reply classification, message reference, and the time window).
  -- #4571 W2: the call keys are checked below; the shared helper checks the rest.
  v_clean     := public.crm_validate_fields(v_rec.pipeline,
                   CASE WHEN jsonb_typeof(p_entry) = 'object' THEN p_entry - c_call_keys ELSE p_entry END, 'log');
  v_kind      := v_clean->>'kind';
  v_body      := v_clean->>'body';
  v_channel   := v_clean->>'channel';
  v_direction := v_clean->>'direction';
  v_ref       := v_clean->>'message_ref';
  v_class     := v_clean->>'reply_class';
  v_when      := COALESCE((v_clean->>'occurred_at')::timestamptz, v_now);

  -- #4571 W2 gate for INVARIANT crm-call-outcome-phone-only (backstopped by
  -- crm_activity_call_outcome_check): an outcome only on a call you made.
  IF jsonb_typeof(p_entry->'outcome') IS NOT NULL AND jsonb_typeof(p_entry->'outcome') <> 'null' THEN
    v_outcome := CASE WHEN jsonb_typeof(p_entry->'outcome') = 'string' THEN btrim(p_entry->>'outcome') END;
    IF public.ops_4571_call_outcome_label(v_outcome) IS NULL THEN
      RAISE EXCEPTION 'invalid_outcome: A call outcome is one of demo_booked, spoke_follow_up, call_back, no_answer, not_interested or wrong_number.' USING ERRCODE = '22023';
    END IF;
    IF NOT (v_kind = 'touch' AND v_channel = 'phone' AND v_direction = 'outbound') THEN
      RAISE EXCEPTION 'outcome_not_a_call: Only a call you made (an outbound touch on phone) has an outcome. Log this without one.' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF jsonb_typeof(p_entry->'duration_seconds') IS NOT NULL AND jsonb_typeof(p_entry->'duration_seconds') <> 'null' THEN
    IF jsonb_typeof(p_entry->'duration_seconds') <> 'number' OR (p_entry->>'duration_seconds') !~ '^\d{1,5}$'
       OR (p_entry->>'duration_seconds')::integer > 14400 THEN
      RAISE EXCEPTION 'invalid_duration: A call lasts whole seconds, from 0 to 14,400 (four hours).' USING ERRCODE = '22023';
    END IF;
    IF NOT (v_kind = 'touch' AND v_channel = 'phone') THEN
      RAISE EXCEPTION 'duration_not_a_call: Only a call has a length.' USING ERRCODE = '22023';
    END IF;
    v_duration := (p_entry->>'duration_seconds')::integer;
  END IF;
  -- The number dialled: its id (Admin) or the number as written (agents).
  v_ident_in := COALESCE(CASE WHEN jsonb_typeof(p_entry->'identifier_id') = 'string' THEN btrim(p_entry->>'identifier_id') END,
                         CASE WHEN jsonb_typeof(p_entry->'identifier') = 'string' THEN btrim(p_entry->>'identifier') END);
  IF v_ident_in IS NOT NULL AND v_ident_in <> '' THEN
    IF v_ident_in ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      SELECT * INTO v_ident FROM public.crm_record_identifiers i
       WHERE i.id = v_ident_in::uuid AND i.record_id = v_rec.id AND i.kind = 'phone';
    ELSE
      SELECT * INTO v_ident FROM public.crm_record_identifiers i
       WHERE i.record_id = v_rec.id AND i.kind = 'phone'
         AND (i.value = v_ident_in OR right(regexp_replace(i.value_key, '\D', '', 'g'), 9) = right(regexp_replace(v_ident_in, '\D', '', 'g'), 9))
       ORDER BY i.created_at LIMIT 1;
    END IF;
    IF v_ident.id IS NULL THEN
      RAISE EXCEPTION '%', format('invalid_identifier: That number is not one of "%s"''s phone numbers. Use a number on the card.', v_rec.name) USING ERRCODE = '22023';
    END IF;
  END IF;
  IF v_outcome = 'wrong_number' AND v_ident.id IS NULL THEN
    RAISE EXCEPTION 'identifier_required: Say which number was wrong, so it is marked and nobody calls it again.' USING ERRCODE = '22023';
  END IF;
  -- The Work card this call belongs to: its id, or its number.
  v_card_in := COALESCE(CASE WHEN jsonb_typeof(p_entry->'work_card_id') = 'string' THEN btrim(p_entry->>'work_card_id') END,
                        CASE WHEN jsonb_typeof(p_entry->'work_card') IN ('string','number') THEN btrim(p_entry->>'work_card') END);
  IF v_card_in IS NOT NULL AND v_card_in <> '' THEN
    IF v_card_in ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      SELECT * INTO v_card FROM public.ops_work_cards w WHERE w.id = v_card_in::uuid AND w.archived_at IS NULL;
    ELSIF v_card_in ~ '^#?[0-9]{1,9}$' THEN
      SELECT * INTO v_card FROM public.ops_work_cards w WHERE w.number = ltrim(v_card_in, '#')::bigint AND w.archived_at IS NULL;
    END IF;
    IF v_card.id IS NULL THEN
      RAISE EXCEPTION 'invalid_work_card: That Work card is not on the board. Send its number or the id Mingla gave.' USING ERRCODE = '22023';
    ELSIF v_card.status = 'done' THEN
      RAISE EXCEPTION '%', format('work_card_closed: Card %s is closed. Reopen it first, or log the call without a card.', v_card.number) USING ERRCODE = '22023';
    ELSIF NOT (v_kind = 'touch' AND v_channel = 'phone') THEN
      RAISE EXCEPTION 'work_card_not_a_call: Only a call is linked to a Work card from the log.' USING ERRCODE = '22023';
    END IF;
  END IF;

  -- What an agent may log. A note and a reply always; an outbound touch only
  -- as the first message to someone who has never been contacted, and never
  -- on a record that carries a contact rule. A person is not held to this.
  IF v.via IS NOT NULL AND v_kind = 'touch' AND v_direction = 'outbound' THEN
    IF v_rec.contact_rule = 'do_not_contact' THEN
      RAISE EXCEPTION '%', format('do_not_contact: "%s" is marked Do not contact: %s. Nothing was logged. Do not message them; tell your person.',
          v_rec.name, v_rec.contact_rule_reason) USING ERRCODE = '42501';
    ELSIF v_rec.contact_rule = 'warm_intro_only' THEN
      RAISE EXCEPTION '%', format('warm_intro_only: "%s" is marked Warm intro only: %s. Nothing was logged. Ask your person to make the introduction.',
          v_rec.name, v_rec.contact_rule_reason) USING ERRCODE = '42501';
    END IF;
    -- The same person may sit on another record: a rule on any record that
    -- shares a contact detail with this one stops the touch too.
    SELECT h->'record' INTO v_other
      FROM jsonb_array_elements(public.crm_identifier_matches(v_rec.pipeline,
             (SELECT COALESCE(jsonb_agg(jsonb_build_object('kind', i.kind, 'value', i.value, 'value_key', i.value_key)), '[]'::jsonb)
                FROM public.crm_record_identifiers i WHERE i.record_id = v_rec.id),
             v_rec.id)) WITH ORDINALITY AS t(h, ord)
     WHERE (h->'record'->>'contact_rule') IS NOT NULL
     ORDER BY ord LIMIT 1;
    IF v_other IS NOT NULL THEN
      RAISE EXCEPTION '%', format('%s: "%s" shares a contact detail with "%s", which is marked %s: %s. Nothing was logged. %s',
          v_other->>'contact_rule', v_rec.name, v_other->>'name',
          CASE v_other->>'contact_rule' WHEN 'do_not_contact' THEN 'Do not contact' ELSE 'Warm intro only' END,
          v_other->>'contact_rule_reason',
          CASE v_other->>'contact_rule' WHEN 'do_not_contact' THEN 'Do not message them; tell your person.'
                                        ELSE 'Ask your person to make the introduction.' END)
        USING ERRCODE = '42501';
    END IF;
    IF v_body IS NULL THEN
      RAISE EXCEPTION 'invalid_body: Log the message you sent, word for word.' USING ERRCODE = '22023';
    END IF;
    -- Counted by rows, not by when a touch says it happened.
    IF EXISTS (SELECT 1 FROM public.crm_activity a WHERE a.record_id = v_rec.id AND a.kind = 'touch') THEN
      RAISE EXCEPTION '%', format('needs_a_person: "%s" has already been contacted, so a follow-up or an answer is your person''s to send and log. Tell them what you would say.',
          v_rec.name) USING ERRCODE = '42501';
    END IF;
  END IF;

  INSERT INTO public.crm_activity (record_id, kind, actor_email, via, body, channel, direction,
                                   message_ref, reply_class, occurred_at, created_at,
                                   call_outcome, duration_seconds, stage_at)  -- #4571 W2
  VALUES (v_rec.id, v_kind, v.actor_email, v.via, v_body, v_channel, v_direction, v_ref, v_class, v_when, v_now,
          v_outcome, v_duration, v_rec.stage)
  RETURNING * INTO v_act;
  -- #4571 W2: a wrong number is marked bad in the same transaction, so
  -- nobody dials it again; a call sent with a Work card is linked to it.
  IF v_outcome = 'wrong_number' THEN
    UPDATE public.crm_record_identifiers
       SET status = 'bad', bad_reason = 'wrong_number', bad_at = v_now, bad_by = v.actor_email
     WHERE id = v_ident.id AND status = 'ok';
  END IF;
  IF v_card.id IS NOT NULL THEN
    PERFORM public.ops_work_link_add(v_card.id, 'call', v_act.id, v.actor_email, v.via);
  END IF;
  UPDATE public.crm_records SET updated_by = v.actor_email, updated_at = v_now WHERE id = v_rec.id;
  -- The audit row never carries what was said.
  PERFORM public.crm_audit(v.actor_email, 'crm.log_add', 'crm_record', v_rec.id::text,
    jsonb_strip_nulls(jsonb_build_object('activity_id', v_act.id, 'kind', v_kind, 'channel', v_channel,
                                         'direction', v_direction, 'via', v.via)));

  -- #4571 W3: the record's watchers see calls, touches and notes in Admin
  -- (Admin only; never what was said, never a number or an address).
  PERFORM public.crm_notify_watchers(v_rec.id, v_act.id, v.actor_email,
    CASE WHEN v_kind = 'note' THEN format('%s added a note on %s', public.ops_name(v.actor_email), v_rec.name)
         WHEN v_channel = 'phone' THEN format('%s logged a call on %s: %s', public.ops_name(v.actor_email), v_rec.name,
                                              COALESCE(public.ops_4571_call_outcome_label(v_outcome), 'logged'))
         ELSE format('%s logged a %s on %s', public.ops_name(v.actor_email),
                     CASE v_direction WHEN 'inbound' THEN 'reply' ELSE 'touch' END, v_rec.name) END,
    'edit');
  SELECT * INTO v_rec FROM public.crm_records c WHERE c.id = p_id;
  v_res := jsonb_build_object('activity', public.crm_activity_json(v_act), 'record', public.crm_record_json(v_rec));
  -- #4571 W2: a suggested next step, never applied (stage moves stay explicit).
  v_suggest := CASE
    WHEN v_outcome = 'demo_booked' THEN
      jsonb_build_object('stage', NULL, 'note', 'Send the card''s scheduler link so the demo is booked and linked.')
    WHEN v_outcome = 'not_interested' AND v_rec.stage NOT IN ('lost', 'passed') THEN
      jsonb_build_object('stage', CASE v_rec.pipeline WHEN 'hosts' THEN 'lost' ELSE 'passed' END,
                         'note', format('Move the card to %s with a reason.', CASE v_rec.pipeline WHEN 'hosts' THEN 'Lost' ELSE 'Passed' END))
    WHEN v_outcome = 'wrong_number' AND NOT EXISTS (SELECT 1 FROM public.crm_record_identifiers i
                                                    WHERE i.record_id = v_rec.id AND i.kind = 'phone' AND i.status = 'ok') THEN
      jsonb_build_object('stage', NULL, 'note', 'Find a new number.')
  END;
  IF v_suggest IS NOT NULL THEN v_res := v_res || jsonb_build_object('suggest_stage', v_suggest); END IF;
  IF v_card.id IS NOT NULL THEN v_res := v_res || jsonb_build_object('work_card', jsonb_build_object('id', v_card.id, 'number', v_card.number)); END IF;
  PERFORM public.crm_request_finish(v.actor_email, p_request_key, 'crm_record_log', v_res);
  RETURN v_res;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.crm_record_log(uuid, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_record_log(uuid, jsonb, text) TO authenticated, service_role;

-- From 20281126024571_issue_4571_w2_links_and_call_outcomes.sql:148. #4571 W3: a booking label ends in its UTC instant
-- (YYYY-MM-DDTHH:MIZ), so each reader shows it in their own time zone (it was a bare UTC clock time).
CREATE OR REPLACE FUNCTION public.ops_link_label(p_kind text, p_id uuid) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v text;
BEGIN
  IF p_id IS NULL THEN RETURN NULL; END IF;
  IF p_kind IN ('host', 'creator') THEN
    SELECT c.name INTO v FROM public.crm_records c WHERE c.id = p_id AND c.deleted_at IS NULL AND c.pipeline = p_kind || 's';
  ELSIF p_kind = 'brand' THEN
    SELECT b.name INTO v FROM public.brands b WHERE b.id = p_id AND b.deleted_at IS NULL;
  ELSIF p_kind = 'event' THEN
    IF public.ops_event_in_scope(p_id) THEN SELECT e.title INTO v FROM public.events e WHERE e.id = p_id; END IF;
  ELSIF p_kind = 'content' THEN
    SELECT i.title INTO v FROM public.content_calendar_items i WHERE i.id = p_id AND i.deleted_at IS NULL;
  ELSIF p_kind = 'expected' THEN
    SELECT x.title INTO v FROM public.ops_expected_events x WHERE x.id = p_id AND x.status <> 'cancelled';
  ELSIF p_kind = 'card' THEN
    SELECT w.title INTO v FROM public.ops_work_cards w WHERE w.id = p_id AND w.archived_at IS NULL;
  ELSIF p_kind = 'roadmap_card' THEN
    -- #3980 synced, Wave 2: a Community roadmap card (Bridge D drafts).
    SELECT r.public_title INTO v FROM public.community_roadmap_cards r WHERE r.id = p_id;
  ELSIF p_kind = 'support_conversation' THEN
    -- #4420: a support conversation (support_tickets row), by number only.
    SELECT 'Conversation ' || t.ticket_number INTO v FROM public.support_tickets t WHERE t.id = p_id;
  ELSIF p_kind = 'call' THEN
    -- #4571 W2: a call (a phone touch). Never the number or an email.
    SELECT 'Call · ' || c.name || ' · ' || COALESCE(public.ops_4571_call_outcome_label(a.call_outcome), 'logged')
           || ' · ' || to_char(a.occurred_at AT TIME ZONE 'UTC', 'FMDD Mon')
      INTO v FROM public.crm_activity a JOIN public.crm_records c ON c.id = a.record_id
     WHERE a.id = p_id AND a.kind = 'touch' AND a.channel = 'phone' AND c.deleted_at IS NULL;
  ELSIF p_kind = 'booking' THEN
    -- #4571 W2: a host demo booking. Never the booker's email or phone.
    SELECT 'Demo · ' || COALESCE(NULLIF(btrim(b.venue), ''), b.name) || ' · ' || to_char(b.call_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI"Z"')  -- #4571 W3: an explicit instant; Admin shows it in the viewer's zone
      INTO v FROM public.book_call_leads b WHERE b.id = p_id AND b.audience = 'host';
  END IF;
  RETURN btrim(left(COALESCE(NULLIF(btrim(v), ''), CASE WHEN v IS NOT NULL THEN 'Untitled' END), 160));
END;
$$;
-- Stored labels of booking links follow.
UPDATE public.ops_work_links l SET label = public.ops_link_label(l.kind, l.target_id)
 WHERE l.kind = 'booking' AND public.ops_link_label(l.kind, l.target_id) IS NOT NULL;
REVOKE ALL ON FUNCTION public.ops_link_label(text, uuid) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. "My calls today".
-- ---------------------------------------------------------------------------
-- #4571 W3 gate for INVARIANT crm-calls-queue-order. The caller's own hosts
-- due today or earlier (their day: ops_today), not deleted, in Replied, Demo
-- booked (meeting), Contacted or Prospect. Replied and Demo booked are pinned
-- first; then Contacted, then Prospect; then oldest due first; then name.
-- Changing this order breaks issue_4571_w3_crm_card.implementor.pg17.test.sql.
CREATE FUNCTION public.crm_calls_queue(p_today date DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v       record;
  v_today date;
  v_rows  jsonb;
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  v_today := public.ops_today(p_today);
  SELECT COALESCE(jsonb_agg(q.j ORDER BY q.rank, q.due_on, q.name_key, q.id), '[]'::jsonb) INTO v_rows
  FROM (SELECT c.id, c.due_on, lower(c.name) AS name_key,
               array_position(ARRAY['replied','meeting','contacted','prospect'], c.stage) AS rank,
               jsonb_build_object('id', c.id, 'name', c.name, 'stage', c.stage, 'due_on', c.due_on,
                 'next_action', c.next_action, 'icp', c.icp, 'region_id', c.region_id,
                 'pinned', c.stage IN ('replied', 'meeting'),
                 'contact_rule', c.contact_rule, 'contact_rule_reason', c.contact_rule_reason,
                 'identifiers', public.crm_identifiers_json(c.id),
                 'last_touch', (SELECT jsonb_build_object('at', a.occurred_at, 'actor_name', public.ops_name(a.actor_email),
                                                          'channel', a.channel, 'direction', a.direction, 'outcome', a.call_outcome)
                                  FROM public.crm_activity a WHERE a.record_id = c.id AND a.kind = 'touch'
                                 ORDER BY a.occurred_at DESC, a.created_at DESC, a.id LIMIT 1)) AS j
          FROM public.crm_records c
         WHERE c.pipeline = 'hosts' AND c.deleted_at IS NULL
           AND c.stage IN ('replied', 'meeting', 'contacted', 'prospect')
           AND c.due_on IS NOT NULL AND c.due_on <= v_today
           AND EXISTS (SELECT 1 FROM public.crm_record_owners o WHERE o.record_id = c.id AND o.owner_email = v.actor_email)
         LIMIT 500) q;
  RETURN jsonb_build_object('today', v_today, 'count', jsonb_array_length(v_rows), 'records', v_rows);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.crm_calls_queue(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_calls_queue(date) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.crm_record_json(public.crm_records) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_record_json(public.crm_records) TO service_role;
REVOKE EXECUTE ON FUNCTION public.crm_identifiers_json(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_identifiers_json(uuid) TO service_role;

COMMIT;
