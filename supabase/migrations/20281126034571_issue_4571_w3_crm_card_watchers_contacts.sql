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
--   7. The connector: set_owners takes watcher_emails (crm_record_set_people)
--      and my_day carries calls_due (team_agent_call). Booking link labels end
--      in their UTC instant so every reader shows its own time zone.
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
-- 20271116003980; ops_link_label from 20281126024571 (and refresh stored
-- booking labels); team_agent_call from 20271231204134.

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
-- From 20281126024571_issue_4571_w2_links_and_call_outcomes.sql:1004.
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

-- From 20281126024571_issue_4571_w2_links_and_call_outcomes.sql:1015. #4571 W3: tells the record's watchers.
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

-- From 20281126024571_issue_4571_w2_links_and_call_outcomes.sql:152. #4571 W3: a booking label ends in its UTC instant
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

-- From 20271231204134_issue_4134_pt409_application_conflicts.sql:10005. #4571 W3: set_owners takes watcher_emails
-- (crm_record_set_people); my_day carries calls_due (crm_calls_queue's count).
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
    'move_stage', 'set_owners', 'log_activity', 'record_reply',
    'save_drafts', 'update_draft', 'list_drafts', 'withdraw_drafts'];
  c_writes constant text[] := ARRAY[
    'add_records', 'upsert_record', 'update_records',
    'move_stage', 'set_owners', 'log_activity', 'record_reply',
    'save_drafts', 'update_draft', 'withdraw_drafts'];
  c_plumbing constant text[] := ARRAY[
    'mcp:initialize', 'mcp:ping', 'mcp:tools/list', 'mcp:resources/list', 'mcp:resources/read',
    'mcp:prompts/list', 'mcp:prompts/get', 'mcp:notification', 'mcp:other'];
  c_uuid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  c_rk constant text := '^[A-Za-z0-9_-]{8,70}$';
  -- The argument that holds the list, for each tool that takes one.
  c_lists constant jsonb := '{"add_records": "records", "update_records": "updates", "move_stage": "moves",
                              "set_owners": "items", "log_activity": "entries", "record_reply": "replies",
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
      IF v_tool IN ('add_records', 'upsert_record', 'log_activity', 'record_reply', 'save_drafts') THEN
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
$function$
;
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
