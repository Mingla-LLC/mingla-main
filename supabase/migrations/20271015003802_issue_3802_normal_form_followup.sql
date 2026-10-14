-- Issue #3802 (follow-up to Wave 4, second part) -- two corrections to the
-- one normal form of a contact detail, public.crm_ident_key().
--
-- What changes:
--   * A YouTube video id keeps its letter case. YouTube video ids are case
--     sensitive: "dQw4w9WgXcQ" and "dqw4w9wgxcq" are two videos. Both ways of
--     writing a video link, youtube.com/watch?v=<id> and youtu.be/<id>, now
--     give youtube.com/watch?v=<id> with the id as typed, so one video written
--     either way is one key, and two ids that differ only in case are two.
--     Every other handle on a known profile site is lower-cased, as before.
--   * A mobile number written with the mobile digit: Argentina "+54 9 11 ..."
--     and Mexico "+52 1 55 ..." are the same numbers as "+54 11 ..." and
--     "+52 55 ...". The normal form drops the 9 after +54 and the 1 after +52
--     when ten digits follow it (the length of a national number in both
--     countries), so both ways of writing one number are one key.
--
-- Nothing else in the function changes. public.crm_phone_national() is not
-- replaced: it reads the national part of a number already in its normal
-- form, and that is still right.
--
-- Stored rows: the normal form is kept in public.crm_record_identifiers
-- (value_key, and from it the generated columns national and tail9). A row
-- whose normal form changes is taken out and put back with its new form,
-- keeping its id, who added it and when. When a record would then hold one
-- detail twice (it held both ways of writing one number or one video), the
-- row that already holds that form, or else the earliest, is kept and the
-- repeat is not put back.
--
-- One transaction. Additive: no table, column or function is dropped. Same
-- signature, attributes and grants. NOT modified: is_admin_user(),
-- crm_phone_national(), every other function, every policy. No trigger is
-- added. Nothing here reaches outside the database.
--
-- Safe to apply while the current admin client and the current edge function
-- are live: the function keeps its signature and grants, and a key only
-- changes for a YouTube video link or an Argentine or Mexican number written
-- with its mobile digit.
--
-- Invariant (docs/INVARIANT_REGISTRY.md):
--   I-3802-CONTACT-IDENTIFIERS-HAVE-ONE-NORMAL-FORM
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
--   -- 2. Re-key the stored rows exactly as section 2 below does.
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
--           follow it. Any other number is its digits. 7 to 15 digits.
--   handle: written plainly (alice, @alice): 2 to 60 of a-z 0-9 . _ -, A to
--           Z lower-cased; a link site, or a site name with no @, is not one.
--           Written as a link, it depends on the site.
--           A known profile site (Instagram, TikTok, X, Facebook, YouTube,
--           LinkedIn): the name in the address, lower-cased. A path word that
--           introduces a name (channel, in, pages, ...) means the name or id
--           that follows it; any other page of those sites (a post, a reel,
--           search, a share link, ...) names no one and is not a handle. A
--           YouTube video, written youtube.com/watch?v=<id> or youtu.be/<id>,
--           is youtube.com/watch?v=<id> with the id as typed.
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
  IF v_site !~ '^[a-z0-9-]+([.][a-z0-9-]+)+$' OR v_site = ANY (c_never) THEN
    RETURN NULL;
  END IF;
  v_path := btrim(regexp_replace(substring(v_rest from '^[^?#]*'), '/+', '/', 'g'), '/');
  v_id := substring('&' || COALESCE(substring(v_rest from '^[^?#]*[?]([^#]*)'), '')
                    from '&id=([a-z0-9._-]{2,60})(?:&|$)');

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
-- 2. The stored forms. Each row whose normal form changes is taken out and
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
-- 3. Self-check. Any failure aborts the whole file.
-- ---------------------------------------------------------------------------
DO $nfcheck$
DECLARE
  v_fn constant regprocedure := 'public.crm_ident_key(text,text)'::regprocedure;
  v_n  integer;
  v_bad text;
BEGIN
  -- 3.1 the same function: same arguments, result, language and attributes.
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_language l ON l.oid = p.prolang
                  WHERE p.oid = v_fn AND l.lanname = 'plpgsql' AND p.provolatile = 'i' AND p.proisstrict
                    AND NOT p.prosecdef AND p.prorettype = 'text'::regtype
                    AND p.proconfig = ARRAY['search_path=""']) THEN
    RAISE EXCEPTION 'issue 3802 normal form follow-up self-check: crm_ident_key() lost its signature or attributes';
  END IF;

  -- 3.2 the same grants: only the trusted server role (and its owner).
  IF has_function_privilege('anon', v_fn, 'EXECUTE') OR has_function_privilege('authenticated', v_fn, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_fn, 'EXECUTE')
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc p, pg_catalog.aclexplode(p.proacl) a
                 WHERE p.oid = v_fn AND a.grantee = 0 AND a.privilege_type = 'EXECUTE')
     OR (SELECT p.proacl IS NULL FROM pg_catalog.pg_proc p WHERE p.oid = v_fn) THEN
    RAISE EXCEPTION 'issue 3802 normal form follow-up self-check: crm_ident_key() grants changed';
  END IF;

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
