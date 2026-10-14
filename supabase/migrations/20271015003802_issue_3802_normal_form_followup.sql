-- Issue #3802 (follow-up to Wave 4, second part) -- corrections to the one
-- normal form of a contact detail, public.crm_ident_key(), to how two phone
-- numbers match, and to an agent's search.
--
-- What changes:
--   * A YouTube id keeps its letter case. Video ids and channel ids are case
--     sensitive: "dQw4w9WgXcQ" and "dqw4w9wgxcq" are two videos. Every way of
--     writing a video link (youtube.com/watch?v=, youtu.be/, /shorts/,
--     /embed/, /live/, youtube-nocookie.com/embed/ and music.youtube.com
--     /watch?v=) gives youtube.com/watch?v=<id> with the id as typed, so one
--     video written any of these ways is one key; youtube.com/channel/<id>
--     gives the id as typed. Every other handle on a known profile site is
--     lower-cased, as before.
--   * Argentine and Mexican mobile numbers have one form. The normal form
--     drops the mobile 9 after +54 and the 1 after +52 when ten digits
--     follow, and Argentina's other mobile marker, 15 after the area code,
--     when an area code, 15 and the number make twelve digits after +54
--     (area 11 first, else a three-digit area, else a four-digit one, both
--     beginning with 2 or 3). So "+54 9 11 1234 5678", "+54 11 1234 5678"
--     and "+54 11 15 1234 5678" are one key, as are "+52 1 55 ..." and
--     "+52 55 ...". Mexico's 044 and 045 prefixes are left as they are.
--   * Matching (crm_identifier_hits, replaced): a number written without its
--     country code also matches one stored with it when, read in that
--     country, it gives the same normal form, so "9 11 1234 5678",
--     "011 15 1234-5678", "11 15 1234 5678", "1 55 1234 5678" and
--     "01 55 1234 5678" find their numbers. The lookup by the last seven
--     digits of the national part takes the ends each way of writing gives.
--   * An agent's search (team_agent_records_find, replaced): part of an email
--     or a handle is found whatever its case, in the normal form and as
--     typed, so a bare YouTube id or a link-in-bio name finds its record.
--
-- public.crm_phone_national() is not replaced: it reads the national part of
-- a number already in its normal form, and that is still right.
--
-- Stored rows: the normal form is kept in public.crm_record_identifiers
-- (value_key, and from it the generated columns national and tail9). A row
-- whose normal form changes is taken out and put back with its new form,
-- keeping its id, who added it and when. When a record would then hold one
-- detail twice (it held two ways of writing one number or one video), the
-- row that already holds that form, or else the earliest, is kept and the
-- repeat is not put back.
--
-- One transaction. Additive: no table, column or function is dropped or
-- added. The replaced functions keep their signatures,
-- attributes and grants. NOT modified: is_admin_user(), crm_phone_national(),
-- every other function, every policy. No trigger is added. Nothing here
-- reaches outside the database.
--
-- Safe to apply while the current admin client and the current edge function
-- are live: signatures and grants are unchanged, a key only changes for a
-- YouTube link or an Argentine or Mexican mobile number, and matching and
-- search only find more.
--
-- Invariant (docs/INVARIANT_REGISTRY.md):
--   I-PROPOSED-3802-CONTACT-IDENTIFIERS-HAVE-ONE-NORMAL-FORM
--
-- ---------------------------------------------------------------------------
-- ROLLBACK (kept here as a comment; there is no down-migration file).
-- Roll the admin web client back FIRST, then the database.
--
--   BEGIN;
--   -- 1. crm_ident_key: copy its statement from
--   --    20270831003802_issue_3802_wave4_agent_write_setup.sql, changing
--   --    "CREATE FUNCTION" to "CREATE OR REPLACE FUNCTION", with its REVOKE,
--   --    GRANT and COMMENT.
--   --    From the same file: crm_identifier_hits and
--   --    team_agent_records_find (each already CREATE OR REPLACE there or
--   --    changed to it), with their REVOKE and GRANT.
--   -- 2. Re-key the stored rows exactly as section 4 below does.
--   COMMIT;
-- ---------------------------------------------------------------------------

BEGIN;

-- A stuck lock aborts the apply instead of hanging.
SET LOCAL lock_timeout = '10s';

-- Remembered for the self-check at the end: is_admin_user() and
-- crm_phone_national() must be byte-identical before and after this file.
SELECT set_config('issue3802.nf_admin_fn_md5',
                  (SELECT md5(p.prosrc) FROM pg_catalog.pg_proc p
                    WHERE p.oid = 'public.is_admin_user()'::regprocedure), true);
SELECT set_config('issue3802.nf_national_fn_md5',
                  (SELECT md5(p.prosrc) FROM pg_catalog.pg_proc p
                    WHERE p.oid = 'public.crm_phone_national(text)'::regprocedure), true);

-- No identifier is written while the stored forms are recomputed.
LOCK TABLE public.crm_record_identifiers IN SHARE ROW EXCLUSIVE MODE;

-- ---------------------------------------------------------------------------
-- 1. THE one normal form. NULL when the value is not usable as that kind.
--
-- First, for every kind: the text is put in its composed form (NFC),
-- characters nobody can see are removed, every kind of space becomes one
-- plain space and spaces at the ends are removed. A value longer than 200
-- characters is not usable.
--   email:  the letters A to Z lower-cased; it needs a name, an @ and a domain.
--   phone:  an extension at the end is dropped. A number written with its
--           country code (a leading + or 00, or a WhatsApp link) is "+",
--           the country code and the national number, where a "(0)" and a
--           trunk 0 right after the country code are removed, and so is the
--           mobile 9 after +54 and the mobile 1 after +52 when ten digits
--           follow it, and the 15 after an Argentine area code when twelve
--           digits follow +54. Any other number is its digits. 7 to 15
--           digits.
--   handle: written plainly (alice, @alice): 2 to 60 of a-z 0-9 . _ -, A to
--           Z lower-cased; a link site, or a site name with no @, is not one.
--           Written as a link, it depends on the site.
--           A known profile site (Instagram, TikTok, X, Facebook, YouTube,
--           LinkedIn): the name in the address, lower-cased. A path word that
--           introduces a name (channel, in, pages, ...) means the name or id
--           that follows it; any other page of those sites (a post, a reel,
--           search, a share link, ...) names no one and is not a handle. A
--           YouTube video (watch?v=, youtu.be/, shorts/, embed/, live/, the
--           no-cookie embed, YouTube Music's watch page) is
--           youtube.com/watch?v=<id>, and a YouTube channel/<id> is the id,
--           each with the id as typed.
--           A link-in-bio or short-link site: site/path, the path as typed.
--           Any other site: site/path, lower-cased. Without http(s)://, www.
--           or m., a trailing /, the query (an id= value is kept) or the
--           fragment. A site with no path is not a handle. A WhatsApp link
--           is a phone number, not a handle.
-- The admin web has a twin of this function, held to it by shared tables of
-- examples that both test suites assert.
-- ---------------------------------------------------------------------------
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
  'Issue #3802. Internal: the one normal form of an email, a phone number or a handle, or NULL when the value is not usable as that kind.';

-- ---------------------------------------------------------------------------
-- 2. Matching two phone numbers (crm_identifier_hits, replaced).
-- ---------------------------------------------------------------------------
-- The earlier body with two changes. One more way two numbers match: when
-- one carries a country code, the other's digits read in that country give
-- the same normal form ("9 11 1234 5678", "011 15 1234-5678" and
-- "1 55 1234 5678" find the number stored with +54 or +52). And the lookup
-- by the last seven digits of the national part takes the ends of every way
-- the asked number may be written: its own; for a number without a country
-- code, read with one (as typed after a +, or as an Argentine or Mexican
-- number); for an Argentine number, with the 15 marker after an area code of
-- two, three or four digits. Same signature, attributes and grants.
CREATE OR REPLACE FUNCTION public.crm_identifier_hits(p_pipeline text, p_idents jsonb, p_exclude uuid)
RETURNS TABLE (record_id uuid, kind text, platform text, value text, value_key text, rule text)
LANGUAGE sql STABLE SET search_path = ''
AS $$
  WITH want AS (
    SELECT e->>'kind' AS kind, e->>'value_key' AS value_key,
           CASE WHEN e->>'kind' = 'phone' THEN public.crm_phone_national(e->>'value_key') END AS national,
           (e->>'value_key') ~ '^[+]' AS intl
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_idents) = 'array' THEN p_idents ELSE '[]'::jsonb END) AS e
  ),
  tail AS (
    SELECT w.value_key, right(w.national, 7) AS tail
    FROM want w WHERE w.kind = 'phone' AND w.national IS NOT NULL
    UNION
    SELECT w.value_key, right(public.crm_phone_national(k.k), 7)
    FROM want w
    CROSS JOIN LATERAL unnest(ARRAY[public.crm_ident_key('phone', '+' || w.national),
                                    public.crm_ident_key('phone', '+54' || w.national),
                                    public.crm_ident_key('phone', '+52' || w.national)]) AS k(k)
    WHERE w.kind = 'phone' AND NOT w.intl AND k.k IS NOT NULL
    UNION
    SELECT w.value_key, right(left(w.national, a.n) || '15' || substr(w.national, a.n + 1), 7)
    FROM want w CROSS JOIN unnest(ARRAY[2, 3, 4]) AS a(n)
    WHERE w.kind = 'phone' AND w.value_key ~ '^[+]54' AND char_length(w.national) = 10
  ),
  hit AS (
    SELECT i.record_id, i.kind, i.platform, i.value, i.value_key, 'exact'::text AS rule
    FROM want w
    JOIN public.crm_record_identifiers i ON i.kind = w.kind AND i.value_key = w.value_key
    UNION
    SELECT i.record_id, i.kind, i.platform, i.value, i.value_key, 'national_number'::text
    FROM want w
    JOIN tail t ON t.value_key = w.value_key
    JOIN public.crm_record_identifiers i
      ON i.kind = 'phone' AND w.kind = 'phone' AND i.value_key <> w.value_key
     AND right(i.national, 7) = t.tail
    WHERE i.national IS NOT NULL AND w.national IS NOT NULL
      AND CASE
            WHEN i.value_key ~ '^[+]' AND w.intl THEN false
            -- Neither has a country code: the shorter (at least seven digits) ends the longer.
            WHEN NOT (i.value_key ~ '^[+]') AND NOT w.intl THEN
              CASE WHEN char_length(i.national) <= char_length(w.national)
                   THEN char_length(i.national) >= 7 AND right(w.national, char_length(i.national)) = i.national
                   ELSE char_length(w.national) >= 7 AND right(i.national, char_length(w.national)) = w.national END
            -- One has a country code: the other's digits end its national part, or are
            -- its own digits written without the +, or read in its country give it.
            WHEN w.intl THEN (char_length(i.national) >= 7 AND right(w.national, char_length(i.national)) = i.national)
                             OR public.crm_ident_key('phone', '+' || i.national) = w.value_key
                             OR public.crm_ident_key('phone', left(w.value_key, char_length(w.value_key) - char_length(w.national))
                                                             || i.national) = w.value_key
            ELSE (char_length(w.national) >= 7 AND right(i.national, char_length(w.national)) = w.national)
                 OR public.crm_ident_key('phone', '+' || w.national) = i.value_key
                 OR public.crm_ident_key('phone', left(i.value_key, char_length(i.value_key) - char_length(i.national))
                                                 || w.national) = i.value_key
          END
  )
  SELECT h.record_id, h.kind, h.platform, h.value, h.value_key, h.rule
  FROM hit h
  JOIN public.crm_records c ON c.id = h.record_id
  WHERE c.pipeline = p_pipeline AND c.deleted_at IS NULL
    AND (p_exclude IS NULL OR c.id <> p_exclude)
$$;
REVOKE EXECUTE ON FUNCTION public.crm_identifier_hits(text, jsonb, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_identifier_hits(text, jsonb, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 3. An agent's search. The earlier body of team_agent_records_find
-- (20270831003802) with one change: part of an email or a handle is found
-- whatever its case, in the normal form and as typed, because a YouTube id
-- and a link-in-bio name are stored with their case. Same signature, grants
-- and attributes.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.team_agent_records_find(p_query jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v         record;
  q         jsonb := CASE WHEN jsonb_typeof(p_query) = 'object' THEN p_query ELSE '{}'::jsonb END;
  v_lim     jsonb := public.team_agent_limits();
  v_pipe    text := q->>'pipeline';
  v_def     jsonb;
  v_q       text := btrim(COALESCE(q->>'q', ''));
  v_like    text;
  v_qe      text;
  v_qp      text;
  v_qh      text;
  v_qd      text;
  v_qf      text;
  v_rule    text := q->>'contact_rule';
  v_stages  text[];
  v_icps    text[];
  v_regions uuid[];
  v_owner   text;
  v_due     text := q->>'due';
  v_reply   boolean := COALESCE(q->'needs_reply' = 'true'::jsonb, false);
  v_notouch boolean := COALESCE(q->'no_touch' = 'true'::jsonb, false);
  v_since   timestamptz;
  v_by      text[];
  v_limit   integer;
  v_cur_at  timestamptz;
  v_cur_id  uuid;
  v_raw     text;
  v_today   date := (now() AT TIME ZONE 'UTC')::date;
  v_monday  date;
  v_ids     uuid[];
  v_total   integer;
  v_rows    jsonb;
  v_last    record;
  v_bad     text;
BEGIN
  SELECT * INTO v FROM public.crm_ctx();

  IF v_pipe IS NULL OR v_pipe NOT IN ('hosts', 'creators') THEN
    RAISE EXCEPTION 'invalid_pipeline: Use hosts or creators.' USING ERRCODE = '22023';
  END IF;
  v_def := public.crm_pipeline_def(v_pipe);

  IF char_length(v_q) > 160 THEN
    RAISE EXCEPTION 'invalid_arguments: "q" is too long. Search for at most 160 characters of a name.' USING ERRCODE = '22023';
  END IF;
  IF v_q <> '' THEN
    -- %, _ and \ are searched for as typed, never as wildcards.
    v_like := replace(replace(replace(v_q, E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_');
    -- The same text as an email, a phone number or a handle, in its normal
    -- form; its digits when it holds at least seven; and, from three
    -- characters on, as part of an email or a handle.
    v_qe := public.crm_ident_key('email', v_q);
    v_qp := public.crm_ident_key('phone', v_q);
    v_qh := public.crm_ident_key('handle', v_q);
    v_qd := regexp_replace(v_q, '[^0-9]', '', 'g');
    IF char_length(v_qd) < 7 THEN
      v_qd := NULL;
    END IF;
    v_qf := regexp_replace(lower(v_q), '^@', '');
    IF char_length(v_qf) < 3 THEN
      v_qf := NULL;
    END IF;
  END IF;

  IF q ? 'stage' AND jsonb_typeof(q->'stage') <> 'null' THEN
    IF jsonb_typeof(q->'stage') <> 'array' OR jsonb_array_length(q->'stage') > 20 THEN
      RAISE EXCEPTION 'invalid_arguments: "stage" is missing or the wrong kind. Send a list of stage ids from get_started.' USING ERRCODE = '22023';
    END IF;
    v_stages := ARRAY(SELECT jsonb_array_elements_text(q->'stage'));
    SELECT s INTO v_bad FROM unnest(v_stages) AS s
     WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_def->'stages') d WHERE d->>'id' = s) LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION '%', format('invalid_stage: %s is not a stage of %s. Use one of: %s.', left(COALESCE(v_bad, 'nothing'), 40), v_pipe,
        (SELECT string_agg(d->>'id', ', ') FROM jsonb_array_elements(v_def->'stages') d)) USING ERRCODE = '22023';
    END IF;
  END IF;

  IF q ? 'icp' AND jsonb_typeof(q->'icp') <> 'null' THEN
    IF jsonb_typeof(q->'icp') <> 'array' OR jsonb_array_length(q->'icp') > 20 THEN
      RAISE EXCEPTION 'invalid_arguments: "icp" is missing or the wrong kind. Send a list of ICP ids from get_started.' USING ERRCODE = '22023';
    END IF;
    v_icps := ARRAY(SELECT jsonb_array_elements_text(q->'icp'));
    SELECT s INTO v_bad FROM unnest(v_icps) AS s
     WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_def->'icps') d WHERE d->>'id' = s) LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION '%', format('invalid_icp: %s is not an ICP for %s. Use one of: %s.', left(COALESCE(v_bad, 'nothing'), 40), v_pipe,
        (SELECT string_agg(d->>'id', ', ') FROM jsonb_array_elements(v_def->'icps') d)) USING ERRCODE = '22023';
    END IF;
  END IF;

  IF q ? 'region_id' AND jsonb_typeof(q->'region_id') <> 'null' THEN
    IF jsonb_typeof(q->'region_id') <> 'array' OR jsonb_array_length(q->'region_id') > 50
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(q->'region_id') e
                   WHERE jsonb_typeof(e) <> 'string'
                      OR (e #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') THEN
      RAISE EXCEPTION 'invalid_arguments: "region_id" is missing or the wrong kind. Send a list of region ids from get_started (regions).' USING ERRCODE = '22023';
    END IF;
    v_regions := ARRAY(SELECT (jsonb_array_elements_text(q->'region_id'))::uuid);
  END IF;

  IF q ? 'owner' AND jsonb_typeof(q->'owner') <> 'null' THEN
    v_owner := lower(btrim(COALESCE(q->>'owner', '')));
    IF jsonb_typeof(q->'owner') <> 'string' OR v_owner = '' OR char_length(v_owner) > 254 THEN
      RAISE EXCEPTION 'invalid_arguments: "owner" is missing or the wrong kind. Send me, none, or a team email address from get_started (team).' USING ERRCODE = '22023';
    END IF;
    IF v_owner = 'me' THEN
      v_owner := v.actor_email;
    END IF;
  END IF;

  -- "Today" is the caller's own date when the gateway worked one out.
  IF jsonb_typeof(q->'today') = 'string' AND (q->>'today') ~ '^\d{4}-\d{2}-\d{2}$' THEN
    BEGIN
      v_today := (q->>'today')::date;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'invalid_arguments: "today" is missing or the wrong kind. Send a date such as 2026-10-13.' USING ERRCODE = '22023';
    END;
  END IF;
  v_monday := date_trunc('week', v_today::timestamp)::date;

  IF v_due IS NOT NULL AND v_due NOT IN ('overdue', 'today', 'this_week', 'none') THEN
    RAISE EXCEPTION 'invalid_arguments: "due" is missing or the wrong kind. Send overdue, today, this_week or none.' USING ERRCODE = '22023';
  END IF;

  IF q ? 'contact_rule' AND jsonb_typeof(q->'contact_rule') <> 'null'
     AND (jsonb_typeof(q->'contact_rule') <> 'string'
          OR v_rule NOT IN ('any', 'none', 'do_not_contact', 'warm_intro_only')) THEN
    RAISE EXCEPTION 'invalid_arguments: "contact_rule" is missing or the wrong kind. Send any, none, do_not_contact or warm_intro_only.' USING ERRCODE = '22023';
  END IF;

  IF q ? 'updated_since' AND jsonb_typeof(q->'updated_since') <> 'null' THEN
    BEGIN
      IF jsonb_typeof(q->'updated_since') <> 'string' OR (q->>'updated_since') !~ '^\d{4}-\d{2}-\d{2}' THEN
        RAISE EXCEPTION 'bad' USING ERRCODE = '22007';
      END IF;
      v_since := (q->>'updated_since')::timestamptz;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'invalid_arguments: "updated_since" is missing or the wrong kind. Send a time such as 2026-10-13T09:00:00Z.' USING ERRCODE = '22023';
    END;
  END IF;

  IF q ? 'count_by' AND jsonb_typeof(q->'count_by') <> 'null' THEN
    IF jsonb_typeof(q->'count_by') <> 'array' OR jsonb_array_length(q->'count_by') NOT BETWEEN 1 AND 4
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(q->'count_by') e
                   WHERE jsonb_typeof(e) <> 'string' OR (e #>> '{}') NOT IN ('stage', 'icp', 'region', 'owner')) THEN
      RAISE EXCEPTION 'invalid_arguments: "count_by" is missing or the wrong kind. Send any of stage, icp, region, owner.' USING ERRCODE = '22023';
    END IF;
    v_by := ARRAY(SELECT jsonb_array_elements_text(q->'count_by'));
  END IF;

  v_limit := (v_lim->>'find_page_default')::integer;
  IF q ? 'limit' AND jsonb_typeof(q->'limit') <> 'null' THEN
    IF jsonb_typeof(q->'limit') <> 'number' OR (q->>'limit') !~ '^\d{1,3}$'
       OR (q->>'limit')::integer NOT BETWEEN 1 AND (v_lim->>'find_page_max')::integer THEN
      RAISE EXCEPTION '%', format('invalid_arguments: "limit" is missing or the wrong kind. Send a whole number from 1 to %s.', v_lim->>'find_page_max') USING ERRCODE = '22023';
    END IF;
    v_limit := (q->>'limit')::integer;
  END IF;

  IF q ? 'cursor' AND jsonb_typeof(q->'cursor') <> 'null' THEN
    BEGIN
      IF jsonb_typeof(q->'cursor') <> 'string' OR (q->>'cursor') !~ '^[A-Za-z0-9+/=]{20,200}$' THEN
        RAISE EXCEPTION 'bad' USING ERRCODE = '22007';
      END IF;
      v_raw := convert_from(decode(q->>'cursor', 'base64'), 'UTF8');
      v_cur_at := (split_part(v_raw, '|', 1) || '+00')::timestamptz;
      v_cur_id := split_part(v_raw, '|', 2)::uuid;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'invalid_cursor: That cursor cannot be used. Send the request again without a cursor.' USING ERRCODE = '22023';
    END;
  END IF;

  -- Every record that matches, by id.
  SELECT COALESCE(array_agg(c.id), ARRAY[]::uuid[]) INTO v_ids
  FROM public.crm_records c
  WHERE c.pipeline = v_pipe AND c.deleted_at IS NULL
    AND (v_like IS NULL OR c.name ILIKE '%' || v_like || '%' ESCAPE E'\\'
         OR EXISTS (SELECT 1 FROM public.crm_record_identifiers i
                     WHERE i.record_id = c.id
                       AND ((i.kind = 'email' AND i.value_key = v_qe)
                            OR (i.kind = 'phone' AND i.value_key = v_qp)
                            OR (i.kind = 'handle' AND i.value_key = v_qh)
                            OR (i.kind = 'phone' AND v_qd IS NOT NULL
                                AND (position(v_qd IN i.value_key) > 0
                                     OR (char_length(v_qd) >= 9 AND i.tail9 = right(v_qd, 9))))
                            OR (i.kind IN ('email', 'handle') AND v_qf IS NOT NULL
                                AND (position(v_qf IN lower(i.value_key)) > 0
                                     OR position(v_qf IN lower(i.value)) > 0)))))
    AND (v_rule IS NULL
         OR (v_rule = 'any' AND c.contact_rule IS NOT NULL)
         OR (v_rule = 'none' AND c.contact_rule IS NULL)
         OR c.contact_rule = v_rule)
    AND (v_stages IS NULL OR c.stage = ANY (v_stages))
    AND (v_icps IS NULL OR c.icp = ANY (v_icps))
    AND (v_regions IS NULL OR c.region_id = ANY (v_regions))
    AND (v_owner IS NULL
         OR (v_owner = 'none' AND NOT EXISTS (SELECT 1 FROM public.crm_record_owners o WHERE o.record_id = c.id))
         OR (v_owner <> 'none' AND EXISTS (SELECT 1 FROM public.crm_record_owners o
                                            WHERE o.record_id = c.id AND o.owner_email = v_owner)))
    AND (v_due IS NULL
         OR (v_due = 'overdue' AND c.due_on < v_today)
         OR (v_due = 'today' AND c.due_on = v_today)
         OR (v_due = 'this_week' AND c.due_on BETWEEN v_monday AND v_monday + 6)
         OR (v_due = 'none' AND c.due_on IS NULL))
    AND (NOT v_reply OR COALESCE((SELECT a.direction FROM public.crm_activity a
                                   WHERE a.record_id = c.id AND a.kind = 'touch'
                                   ORDER BY a.occurred_at DESC, a.created_at DESC, a.id LIMIT 1) = 'inbound', false))
    AND (NOT v_notouch OR NOT EXISTS (SELECT 1 FROM public.crm_activity a
                                       WHERE a.record_id = c.id AND a.kind = 'touch'))
    AND (v_since IS NULL OR c.updated_at >= v_since);
  v_total := cardinality(v_ids);

  IF v_by IS NOT NULL THEN
    SELECT COALESCE(jsonb_agg(
             (jsonb_build_object('stage', g.stage, 'icp', g.icp, 'region_id', g.region_id,
                                 'region', (SELECT s.name FROM public.seeding_cities s WHERE s.id = g.region_id),
                                 'owner', g.owner)
                - ARRAY(SELECT k FROM unnest(ARRAY['stage','icp','region_id','region','owner']) AS k
                         WHERE NOT (CASE k WHEN 'region_id' THEN 'region' ELSE k END = ANY (v_by))))
             || jsonb_build_object('count', g.n)
             ORDER BY g.n DESC, g.stage NULLS LAST, g.icp NULLS LAST, g.region_id NULLS LAST, g.owner NULLS LAST), '[]'::jsonb)
      INTO v_rows
    FROM (SELECT CASE WHEN 'stage' = ANY (v_by) THEN c.stage END AS stage,
                 CASE WHEN 'icp' = ANY (v_by) THEN c.icp END AS icp,
                 CASE WHEN 'region' = ANY (v_by) THEN c.region_id END AS region_id,
                 o.owner_email AS owner,
                 count(*) AS n
            FROM public.crm_records c
            LEFT JOIN public.crm_record_owners o ON o.record_id = c.id AND 'owner' = ANY (v_by)
           WHERE c.id = ANY (v_ids)
           GROUP BY 1, 2, 3, 4) g;
    RETURN jsonb_build_object('pipeline', v_pipe, 'counts', v_rows, 'total', v_total);
  END IF;

  SELECT COALESCE(jsonb_agg(
           public.crm_record_json(x)
           || jsonb_build_object(
                'last_touch', (SELECT jsonb_build_object('at', a.occurred_at, 'channel', a.channel, 'direction', a.direction,
                                                         'by', a.actor_email, 'via', a.via, 'message_ref', a.message_ref,
                                                         'text', left(a.body, 280))
                                 FROM public.crm_activity a
                                WHERE a.record_id = x.id AND a.kind = 'touch'
                                ORDER BY a.occurred_at DESC, a.created_at DESC, a.id LIMIT 1),
                'last_reply', (SELECT jsonb_build_object('at', a.occurred_at, 'channel', a.channel, 'direction', a.direction,
                                                         'by', a.actor_email, 'via', a.via, 'message_ref', a.message_ref,
                                                         'text', left(a.body, 280))
                                 FROM public.crm_activity a
                                WHERE a.record_id = x.id AND a.kind = 'touch' AND a.direction = 'inbound'
                                ORDER BY a.occurred_at DESC, a.created_at DESC, a.id LIMIT 1))
           ORDER BY x.updated_at DESC, x.id DESC), '[]'::jsonb)
    INTO v_rows
  FROM (SELECT c.* FROM public.crm_records c
         WHERE c.id = ANY (v_ids)
           AND (v_cur_at IS NULL OR (c.updated_at, c.id) < (v_cur_at, v_cur_id))
         ORDER BY c.updated_at DESC, c.id DESC
         LIMIT v_limit) x;

  -- The cursor names the last row of this page, when more rows follow it.
  SELECT c.updated_at, c.id INTO v_last
  FROM public.crm_records c
  WHERE c.id = ((v_rows -> (jsonb_array_length(v_rows) - 1)) ->> 'id')::uuid;
  IF FOUND AND EXISTS (SELECT 1 FROM public.crm_records c
                        WHERE c.id = ANY (v_ids) AND (c.updated_at, c.id) < (v_last.updated_at, v_last.id)) THEN
    v_raw := translate(encode(convert_to(
               to_char(v_last.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') || '|' || v_last.id::text,
               'UTF8'), 'base64'), E'\n', '');
  ELSE
    v_raw := NULL;
  END IF;

  RETURN jsonb_build_object('pipeline', v_pipe, 'records', v_rows, 'next_cursor', v_raw, 'total', v_total);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.team_agent_records_find(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.team_agent_records_find(jsonb) TO service_role;

-- ---------------------------------------------------------------------------
-- 4. The stored forms. Each row whose normal form changes is taken out and
-- put back with the new one (its id, who added it and when are kept), so no
-- row is ever compared with a form that is about to change. The generated
-- columns national and tail9 follow value_key. A repeat on one record is
-- not put back: the row that already holds that form, or the earliest.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE issue3802_nf_rekey ON COMMIT DROP AS
  SELECT i.id, i.record_id, i.kind, i.platform, i.value, public.crm_ident_key(i.kind, i.value) AS value_key,
         i.created_by, i.created_at
  FROM public.crm_record_identifiers i
  WHERE public.crm_ident_key(i.kind, i.value) IS DISTINCT FROM i.value_key;

DO $rekey$
DECLARE
  v_moved integer;
  v_back  integer;
BEGIN
  IF EXISTS (SELECT 1 FROM issue3802_nf_rekey WHERE value_key IS NULL) THEN
    RAISE EXCEPTION 'issue 3802 normal form follow-up: a stored contact detail has no normal form under the new function';
  END IF;
  DELETE FROM public.crm_record_identifiers i USING issue3802_nf_rekey r WHERE i.id = r.id;
  GET DIAGNOSTICS v_moved = ROW_COUNT;
  INSERT INTO public.crm_record_identifiers (id, record_id, kind, platform, value, value_key, created_by, created_at)
  SELECT r.id, r.record_id, r.kind, r.platform, r.value, r.value_key, r.created_by, r.created_at
  FROM issue3802_nf_rekey r
  ORDER BY r.created_at, r.id
  ON CONFLICT ON CONSTRAINT crm_record_identifiers_one_per_record DO NOTHING;
  GET DIAGNOSTICS v_back = ROW_COUNT;
  RAISE NOTICE 'issue 3802 normal form follow-up: % stored contact detail(s) re-keyed, % repeat(s) on one record not put back',
    v_back, v_moved - v_back;
END;
$rekey$;

-- ---------------------------------------------------------------------------
-- 5. Self-check. Any failure aborts the whole file.
-- ---------------------------------------------------------------------------
DO $nfcheck$
DECLARE
  v_fn constant regprocedure := 'public.crm_ident_key(text,text)'::regprocedure;
  v_n  integer;
  v_bad text;
  v_f  text;
  v_g  text;
  v_rec uuid;
BEGIN
  -- 3.1 the same functions: same arguments, result, language and attributes.
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_language l ON l.oid = p.prolang
                  WHERE p.oid = v_fn AND l.lanname = 'plpgsql' AND p.provolatile = 'i' AND p.proisstrict
                    AND NOT p.prosecdef AND p.prorettype = 'text'::regtype
                    AND p.proconfig = ARRAY['search_path=""']) THEN
    RAISE EXCEPTION 'issue 3802 normal form follow-up self-check: crm_ident_key() lost its signature or attributes';
  END IF;
  SELECT string_agg(e.f, ', ') INTO v_bad
  FROM (VALUES
    ('public.crm_identifier_hits(text,jsonb,uuid)', 'sql', 's', false, false),
    ('public.team_agent_records_find(jsonb)', 'plpgsql', 's', false, true)
  ) AS e(f, lang, vol, strict, secdef)
  WHERE NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_language l ON l.oid = p.prolang
                     WHERE p.oid = e.f::regprocedure AND l.lanname = e.lang AND p.provolatile = e.vol
                       AND p.proisstrict = e.strict AND p.prosecdef = e.secdef
                       AND p.proconfig = ARRAY['search_path=""']);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'issue 3802 normal form follow-up self-check: % lost its signature or attributes', v_bad;
  END IF;

  -- 3.2 the same grants: only the trusted server role (and its owner).
  FOREACH v_f IN ARRAY ARRAY['public.crm_ident_key(text,text)', 'public.crm_identifier_hits(text,jsonb,uuid)',
                             'public.team_agent_records_find(jsonb)'] LOOP
    IF has_function_privilege('anon', v_f, 'EXECUTE') OR has_function_privilege('authenticated', v_f, 'EXECUTE')
       OR NOT has_function_privilege('service_role', v_f, 'EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc p, pg_catalog.aclexplode(p.proacl) a
                   WHERE p.oid = v_f::regprocedure AND a.grantee = 0 AND a.privilege_type = 'EXECUTE')
       OR (SELECT p.proacl IS NULL FROM pg_catalog.pg_proc p WHERE p.oid = v_f::regprocedure) THEN
      RAISE EXCEPTION 'issue 3802 normal form follow-up self-check: %() grants changed', split_part(substr(v_f, 8), '(', 1);
    END IF;
  END LOOP;

  -- 3.3 the normal form behaves as written: the two corrections, what they
  -- must not touch, and the four examples the first migration checked.
  SELECT string_agg(format('%s %s -> %s, not %s', e.kind, e.val, COALESCE(public.crm_ident_key(e.kind, e.val), '-'), e.want), '; ')
    INTO v_bad
  FROM (VALUES
    ('phone',  '+54 9 11 1234 5678',                          '+541112345678'),
    ('phone',  '+54 11 1234 5678',                            '+541112345678'),
    ('phone',  '0054 9 11 1234-5678',                         '+541112345678'),
    ('phone',  'https://wa.me/5491112345678',                 '+541112345678'),
    ('phone',  '+54 9 11 1234 567',                           '+549111234567'),
    ('phone',  '+52 1 55 1234 5678',                          '+525512345678'),
    ('phone',  '+52 55 1234 5678',                            '+525512345678'),
    ('phone',  '+52 1 55 1234 56789',                         '+52155123456789'),
    ('phone',  '549 11 1234 5678',                            '5491112345678'),
    ('phone',  '+254 9 11 1234 5678',                         '+25491112345678'),
    ('phone',  '+1 919 555 0142',                             '+19195550142'),
    ('phone',  '+54 11 15 1234 5678',                         '+541112345678'),
    ('phone',  '+54 (011) 15 1234-5678',                      '+541112345678'),
    ('phone',  '+54 351 15 123 4567',                         '+543511234567'),
    ('phone',  '+54 2954 15 12 3456',                         '+542954123456'),
    ('phone',  '+55 11 15 1234 5678',                         '+55111512345678'),
    ('handle', 'https://www.youtube.com/shorts/dQw4w9WgXcQ',  'youtube.com/watch?v=dQw4w9WgXcQ'),
    ('handle', 'https://www.youtube.com/embed/dQw4w9WgXcQ',   'youtube.com/watch?v=dQw4w9WgXcQ'),
    ('handle', 'https://www.youtube.com/live/dQw4w9WgXcQ',    'youtube.com/watch?v=dQw4w9WgXcQ'),
    ('handle', 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ', 'youtube.com/watch?v=dQw4w9WgXcQ'),
    ('handle', 'https://music.youtube.com/watch?v=dQw4w9WgXcQ', 'youtube.com/watch?v=dQw4w9WgXcQ'),
    ('handle', 'https://www.youtube.com/channel/UCuAXFkgsw1L7xaCfnd5JJOw', 'UCuAXFkgsw1L7xaCfnd5JJOw'),
    ('handle', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'youtube.com/watch?v=dQw4w9WgXcQ'),
    ('handle', 'https://youtu.be/dQw4w9WgXcQ?si=abc',         'youtube.com/watch?v=dQw4w9WgXcQ'),
    ('handle', 'https://www.youtube.com/watch?v=dqw4w9wgxcq', 'youtube.com/watch?v=dqw4w9wgxcq'),
    ('handle', 'https://www.youtube.com/@Chan-Nel',           'chan-nel'),
    ('email',  ' A@B.co ',                                    'a@b.co'),
    ('phone',  '+234 (0)803 555-0101',                        '+2348035550101'),
    ('handle', 'https://www.instagram.com/Palm.Court/?hl=en', 'palm.court'),
    ('handle', '@x',                                          '-')
  ) AS e(kind, val, want)
  WHERE COALESCE(public.crm_ident_key(e.kind, e.val), '-') IS DISTINCT FROM e.want;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'issue 3802 normal form follow-up self-check: crm_ident_key() does not give the normal form it is documented to give (%)', v_bad;
  END IF;

  -- 3.3b a number written without its country code finds the one stored
  -- with it, however the mobile marker was written, and the other way round
  -- (on a record made and undone here).
  BEGIN
    v_bad := NULL;
    INSERT INTO public.crm_records (pipeline, name, stage, created_by, updated_by)
    VALUES ('creators', 'Issue 3802 normal form self-check', 'identified', 'system', 'system') RETURNING id INTO v_rec;
    FOR v_f, v_g IN SELECT * FROM (VALUES ('9 11 1234 5678', '+54 9 11 1234 5678'), ('011 15 1234-5678', '+54 11 1234 5678'),
                                         ('02954 15 12-3456', '+54 2954 12 3456'), ('01 55 1234 5678', '+52 55 1234 5678')) AS e(a, b) LOOP
      FOR v_n IN 1..2 LOOP
        DELETE FROM public.crm_record_identifiers i WHERE i.record_id = v_rec;
        INSERT INTO public.crm_record_identifiers (record_id, kind, value, value_key, created_by)
        VALUES (v_rec, 'phone', CASE v_n WHEN 1 THEN v_g ELSE v_f END,
                public.crm_ident_key('phone', CASE v_n WHEN 1 THEN v_g ELSE v_f END), 'system');
        IF NOT EXISTS (SELECT 1 FROM public.crm_identifier_hits('creators',
                         public.crm_clean_identifiers(jsonb_build_array(jsonb_build_object('kind', 'phone',
                           'value', CASE v_n WHEN 1 THEN v_f ELSE v_g END))), NULL) h
                        WHERE h.record_id = v_rec AND h.rule = 'national_number') THEN
          v_bad := concat_ws('; ', v_bad, v_f || ' / ' || v_g);
        END IF;
      END LOOP;
    END LOOP;
    RAISE EXCEPTION 'issue_3802_self_check_rollback' USING ERRCODE = 'P3802', DETAIL = COALESCE(v_bad, '');
  EXCEPTION WHEN SQLSTATE 'P3802' THEN
    GET STACKED DIAGNOSTICS v_bad = PG_EXCEPTION_DETAIL;
  END;
  IF NULLIF(v_bad, '') IS NOT NULL THEN
    RAISE EXCEPTION 'issue 3802 normal form follow-up self-check: crm_identifier_hits() misses a way of writing a number (%)', v_bad;
  END IF;

  -- 3.4 every stored row holds the form the function gives today, and its
  -- generated columns follow it.
  SELECT count(*) INTO v_n
  FROM public.crm_record_identifiers i
  WHERE i.value_key IS DISTINCT FROM public.crm_ident_key(i.kind, i.value)
     OR i.national IS DISTINCT FROM CASE WHEN i.kind = 'phone' THEN public.crm_phone_national(i.value_key) END
     OR i.tail9 IS DISTINCT FROM CASE WHEN i.kind = 'phone' AND char_length(i.value_key) >= 9 THEN right(i.value_key, 9) END;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'issue 3802 normal form follow-up self-check: % stored contact detail(s) do not hold their normal form', v_n;
  END IF;

  -- 3.5 every row taken out is back, or a repeat of one its record still holds.
  SELECT count(*) INTO v_n
  FROM issue3802_nf_rekey r
  WHERE NOT EXISTS (SELECT 1 FROM public.crm_record_identifiers i
                     WHERE i.record_id = r.record_id AND i.kind = r.kind AND i.value_key = r.value_key);
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'issue 3802 normal form follow-up self-check: % contact detail(s) were lost while re-keying', v_n;
  END IF;

  -- 3.6 is_admin_user() and crm_phone_national() are byte-identical to what
  -- they were when this file began.
  IF NULLIF(current_setting('issue3802.nf_admin_fn_md5', true), '') IS NOT NULL
     AND (SELECT md5(p.prosrc) FROM pg_catalog.pg_proc p WHERE p.oid = 'public.is_admin_user()'::regprocedure)
           IS DISTINCT FROM current_setting('issue3802.nf_admin_fn_md5', true) THEN
    RAISE EXCEPTION 'issue 3802 normal form follow-up self-check: is_admin_user() changed during this migration';
  END IF;
  IF (SELECT md5(p.prosrc) FROM pg_catalog.pg_proc p WHERE p.oid = 'public.crm_phone_national(text)'::regprocedure)
       IS DISTINCT FROM current_setting('issue3802.nf_national_fn_md5', true) THEN
    RAISE EXCEPTION 'issue 3802 normal form follow-up self-check: crm_phone_national() changed during this migration';
  END IF;
END;
$nfcheck$;

COMMIT;
