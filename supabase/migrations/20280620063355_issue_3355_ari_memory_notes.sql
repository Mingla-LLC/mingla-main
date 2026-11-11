-- Issue #3355 Wave D (D1) — Ari remembers.
--
-- ari_memory_notes existed since 20280209003355 with 0 rows: notes were
-- always private to their author, and nothing in a turn read them as data.
-- This migration makes memory usable and safe:
--
--   * scope: a note is either the author's own ('user') or shared with the
--     brand ('brand'). A brand note is readable by every member of that brand
--     and by nobody else; a user note only by its author (RLS below).
--   * kinds: preference | correction | fact (the older business_fact and
--     workflow stay valid for notes saved before this wave).
--   * ari_remember_note(): the one write Ari's remember_note tool makes. It is
--     Ari-owned, reversible state (like the existing save_memory_note it
--     replaces), so it runs without a confirmation card, but it still goes
--     through the server: the caller's JWT, brand membership, a short text,
--     idempotent on the normalised words, at most 20 new notes an hour, and a
--     server check that refuses payment, ID and contact details.
--   * ari_memory_list() returns the caller's readable notes (their own, plus
--     the active brand's shared notes) with whether the caller may forget each.
--   * ari_memory_forget(): the author, or a brand admin for a brand note.
--   * ari_memory_save()/ari_memory_update() (the Host settings composer) get
--     the same sensitive-content check.
--
-- Static SQL only; conflicts raise PT409; rate limit raises PT429.
-- Proof: __tests__/issue_3355_ari_memory_notes.implementor.pg17.test.sql.

BEGIN;

ALTER TABLE public.ari_memory_notes
  ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'user',
  ADD COLUMN IF NOT EXISTS content_key text;

ALTER TABLE public.ari_memory_notes
  DROP CONSTRAINT IF EXISTS ari_memory_notes_scope_check;
ALTER TABLE public.ari_memory_notes
  ADD CONSTRAINT ari_memory_notes_scope_check
  CHECK (scope IN ('user', 'brand'));

ALTER TABLE public.ari_memory_notes
  DROP CONSTRAINT IF EXISTS ari_memory_notes_brand_scope_needs_brand;
ALTER TABLE public.ari_memory_notes
  ADD CONSTRAINT ari_memory_notes_brand_scope_needs_brand
  CHECK (scope = 'user' OR brand_id IS NOT NULL);

ALTER TABLE public.ari_memory_notes
  DROP CONSTRAINT IF EXISTS ari_memory_notes_kind_check;
ALTER TABLE public.ari_memory_notes
  ADD CONSTRAINT ari_memory_notes_kind_check
  CHECK (kind IN ('preference', 'correction', 'fact', 'business_fact', 'workflow'));

-- The normalised words of a note: lower case, single spaces, trimmed.
CREATE OR REPLACE FUNCTION public.ari_memory_content_key(p_content text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT md5(lower(regexp_replace(btrim(COALESCE(p_content, '')), '\s+', ' ', 'g')));
$fn$;
REVOKE ALL ON FUNCTION public.ari_memory_content_key(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ari_memory_content_key(text) TO authenticated, service_role;

UPDATE public.ari_memory_notes
   SET content_key = public.ari_memory_content_key(content)
 WHERE content_key IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ari_memory_notes_active_words
  ON public.ari_memory_notes(
    user_id, scope,
    (COALESCE(brand_id, '00000000-0000-0000-0000-000000000000'::uuid)),
    content_key
  )
  WHERE active AND content_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS ari_memory_notes_brand_shared
  ON public.ari_memory_notes(brand_id, active, updated_at DESC)
  WHERE scope = 'brand';

-- Why a note may not be stored, or NULL. Mirrors ariSensitiveReason() in
-- supabase/functions/_shared/ariPii.ts (the edge refuses first, in plain
-- words; this is the server's last word for every writer).
--   contact_details: an email address or a phone number (7+ digits once
--                    dates and times are set aside)
--   payment_details: a card-like number (13-19 digits) or bank words
--   id_details:      passwords and government ID words
CREATE OR REPLACE FUNCTION public.ari_memory_sensitive_reason(p_content text)
RETURNS text
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  -- #3355 rework 1 (tester P3-15): full-width digits read as plain digits.
  v text := normalize(COALESCE(p_content, ''), NFKC);
  v_digits text;
  v_run text;
BEGIN
  IF v ~* '[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}' THEN
    RETURN 'contact_details';
  END IF;
  -- An email written out to dodge a filter ("ada [at] gmail [dot] com").
  IF v ~* '[a-z0-9._%+-]+\s*[[({]\s*at\s*[])}]\s*[a-z0-9-]+((\s*[[({]\s*dot\s*[])}]\s*|\s+dot\s+|\.)[a-z0-9-]+)*(\s*[[({]\s*dot\s*[])}]\s*|\s+dot\s+|\.)[a-z]{2,6}\M'
     OR v ~* '[a-z0-9._%+-]+(\s+at\s+|\s*@\s*)[a-z0-9-]+((\s*[[({]\s*dot\s*[])}]\s*|\s+dot\s+)[a-z0-9-]+)*(\s*[[({]\s*dot\s*[])}]\s*|\s+dot\s+)(com|net|org|co|io|ng|uk|gh|ke|za|edu|gov|me|info|biz|app|dev|ai|africa)\M' THEN
    RETURN 'contact_details';
  END IF;
  IF v ~* '\m(password|passcode|passwd|pin code|one[- ]time code|otp|bvn|nin|ssn|social security|passport( number| no)?|national id|id number|driver''?s licen[cs]e)\M'
     OR v ~* '\mpin(\s+(code|number|no\.?))?\s*(is|:|=|-)?\s*\d{4,8}\M' THEN
    RETURN 'id_details';
  END IF;
  IF v ~* '\m(cvv|cvc|iban|swift|sort code|routing number|account number|acct no|card number)\M' THEN
    RETURN 'payment_details';
  END IF;
  -- Dates and clock times are ordinary facts ("until 2026-12-19 at 23:59").
  v := regexp_replace(v, '\d{4}[-/.]\d{1,2}[-/.]\d{1,2}', ' ', 'g');
  v := regexp_replace(v, '\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}', ' ', 'g');
  v := regexp_replace(v, '\d{1,2}:\d{2}', ' ', 'g');
  FOR v_run IN
    SELECT m[1] FROM regexp_matches(v, '(\+?\d(?:[ ().-]?\d){6,})', 'g') AS m
  LOOP
    v_digits := regexp_replace(v_run, '\D', '', 'g');
    IF left(v_run, 1) = '+' THEN
      RETURN 'contact_details';
    END IF;
    IF char_length(v_digits) BETWEEN 13 AND 19 THEN
      RETURN 'payment_details';
    END IF;
    IF char_length(v_digits) >= 7 THEN
      RETURN 'contact_details';
    END IF;
  END LOOP;
  RETURN NULL;
END;
$fn$;
REVOKE ALL ON FUNCTION public.ari_memory_sensitive_reason(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ari_memory_sensitive_reason(text) TO authenticated, service_role;

-- RLS: a user note is its author's; a brand note is every brand member's.
DROP POLICY IF EXISTS ari_memory_notes_owner_read ON public.ari_memory_notes;
DROP POLICY IF EXISTS ari_memory_notes_scoped_read ON public.ari_memory_notes;
CREATE POLICY ari_memory_notes_scoped_read
  ON public.ari_memory_notes FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR (
      scope = 'brand' AND brand_id IS NOT NULL
      AND public.biz_is_brand_member_for_read(brand_id, (SELECT auth.uid()))
    )
  );

-- The one write Ari's remember_note tool makes.
CREATE OR REPLACE FUNCTION public.ari_remember_note(
  p_scope text,
  p_kind text,
  p_content text,
  p_brand_id uuid DEFAULT NULL,
  p_evidence_message_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_actor uuid := auth.uid();
  v_text text := regexp_replace(btrim(COALESCE(p_content, '')), '\s+', ' ', 'g');
  v_reason text;
  v_note public.ari_memory_notes%ROWTYPE;
  v_existing uuid;
  v_recent integer;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF p_scope IS NULL OR p_scope NOT IN ('user', 'brand') THEN
    RAISE EXCEPTION 'invalid_memory_scope' USING ERRCODE = '22023';
  END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('preference', 'correction', 'fact') THEN
    RAISE EXCEPTION 'invalid_memory_kind' USING ERRCODE = '22023';
  END IF;
  IF p_scope = 'brand' AND p_brand_id IS NULL THEN
    RAISE EXCEPTION 'memory_brand_required' USING ERRCODE = '22023';
  END IF;
  IF p_brand_id IS NOT NULL
     AND NOT public.biz_is_brand_member_for_read(p_brand_id, v_actor) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  -- #3355 rework 1 (tester P2-7): a note every member's Ari reads needs the
  -- marketing manager rank or above; a scanner keeps notes for themself.
  IF p_scope = 'brand'
     AND COALESCE(public.biz_brand_effective_rank(p_brand_id, v_actor), 0)
         < public.biz_role_rank('marketing_manager') THEN
    RAISE EXCEPTION 'memory_brand_note_rank' USING ERRCODE = '42501';
  END IF;
  IF char_length(v_text) NOT BETWEEN 3 AND 280 THEN
    RAISE EXCEPTION 'invalid_memory_content' USING ERRCODE = '22023';
  END IF;
  v_reason := public.ari_memory_sensitive_reason(v_text);
  IF v_reason IS NOT NULL THEN
    RAISE EXCEPTION 'memory_sensitive_content:%', v_reason USING ERRCODE = '22023';
  END IF;
  IF p_evidence_message_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.agent_messages m
     WHERE m.id = p_evidence_message_id AND m.user_id = v_actor
  ) THEN
    RAISE EXCEPTION 'invalid_memory_evidence' USING ERRCODE = '22023';
  END IF;

  -- The same words in the same place are the same note (idempotent).
  SELECT n.id INTO v_existing FROM public.ari_memory_notes n
   WHERE n.user_id = v_actor AND n.scope = p_scope AND n.active
     AND n.brand_id IS NOT DISTINCT FROM p_brand_id
     AND n.content_key = public.ari_memory_content_key(v_text);
  IF v_existing IS NOT NULL THEN
    UPDATE public.ari_memory_notes SET kind = p_kind, updated_at = now()
     WHERE id = v_existing
    RETURNING * INTO v_note;
    RETURN (to_jsonb(v_note) - 'user_id' - 'content_key')
      || jsonb_build_object('deduplicated', true);
  END IF;

  SELECT count(*) INTO v_recent FROM public.ari_memory_notes n
   WHERE n.user_id = v_actor AND n.created_at > now() - interval '1 hour';
  IF v_recent >= 20 THEN
    RAISE EXCEPTION 'memory_rate_limited' USING ERRCODE = 'PT429';
  END IF;

  BEGIN
    INSERT INTO public.ari_memory_notes(
      user_id, brand_id, scope, kind, content, content_key, evidence_message_id
    ) VALUES (
      v_actor, p_brand_id, p_scope, p_kind, v_text,
      public.ari_memory_content_key(v_text), p_evidence_message_id
    )
    RETURNING * INTO v_note;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'memory_conflict' USING ERRCODE = 'PT409';
  END;
  RETURN (to_jsonb(v_note) - 'user_id' - 'content_key')
    || jsonb_build_object('deduplicated', false);
END;
$fn$;
REVOKE ALL ON FUNCTION public.ari_remember_note(text, text, text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ari_remember_note(text, text, text, uuid, uuid) TO authenticated, service_role;

-- Every note the caller can read for this brand: their own (global, or for
-- this brand) and the brand's shared notes. Newest first.
CREATE OR REPLACE FUNCTION public.ari_memory_list(p_brand_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_actor uuid := auth.uid();
  v_admin boolean := false;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF p_brand_id IS NOT NULL THEN
    IF NOT public.biz_is_brand_member_for_read(p_brand_id, v_actor) THEN
      RAISE EXCEPTION 'not_authorized';
    END IF;
    v_admin := COALESCE(public.biz_is_brand_admin_plus(p_brand_id, v_actor), false);
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', n.id, 'brand_id', n.brand_id, 'scope', n.scope, 'kind', n.kind,
      'content', n.content, 'confidence', n.confidence,
      'updated_at', n.updated_at, 'created_at', n.created_at,
      'mine', n.user_id = v_actor,
      'can_forget', n.user_id = v_actor OR (n.scope = 'brand' AND v_admin)
    ) ORDER BY n.updated_at DESC)
    FROM public.ari_memory_notes n
    WHERE n.active
      AND (
        (n.user_id = v_actor
          AND (n.brand_id IS NULL OR n.brand_id IS NOT DISTINCT FROM p_brand_id))
        -- #3355 rework 1 (tester P1-5): a brand note speaks for the brand only
        -- while its author is still on the brand's team.
        OR (p_brand_id IS NOT NULL AND n.scope = 'brand' AND n.brand_id = p_brand_id
            AND public.biz_is_brand_member_for_read(n.brand_id, n.user_id))
      )
  ), '[]'::jsonb);
END;
$fn$;
REVOKE ALL ON FUNCTION public.ari_memory_list(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ari_memory_list(uuid) TO authenticated, service_role;

-- Forget: the author, or a brand admin for a note shared with the brand.
CREATE OR REPLACE FUNCTION public.ari_memory_forget(p_note_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_actor uuid := auth.uid();
  v_count integer;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'not_authorized'; END IF;
  -- #3355 rework 1 (tester P1-5): a brand note is changed only by someone on
  -- the brand's team now; a personal note is always its author's to forget.
  UPDATE public.ari_memory_notes n SET active = false, updated_at = now()
   WHERE n.id = p_note_id AND n.active
     AND (
       (n.user_id = v_actor
         AND (n.scope <> 'brand'
              OR public.biz_is_brand_member_for_read(n.brand_id, v_actor)))
       OR (n.scope = 'brand' AND n.brand_id IS NOT NULL
           AND COALESCE(public.biz_is_brand_admin_plus(n.brand_id, v_actor), false))
     );
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 1 THEN RAISE EXCEPTION 'not_found'; END IF;
  RETURN jsonb_build_object('forgotten', true, 'id', p_note_id);
END;
$fn$;
REVOKE ALL ON FUNCTION public.ari_memory_forget(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ari_memory_forget(uuid) TO authenticated, service_role;

-- The Host settings composer: same shape as before, plus the sensitive check.
CREATE OR REPLACE FUNCTION public.ari_memory_save(
  p_brand_id uuid,
  p_kind text,
  p_content text,
  p_evidence_message_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_actor uuid := auth.uid();
  v_note public.ari_memory_notes%ROWTYPE;
  v_reason text;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF p_brand_id IS NOT NULL AND NOT public.biz_is_brand_member_for_read(p_brand_id, v_actor) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF p_kind NOT IN ('preference', 'correction', 'fact', 'business_fact', 'workflow') THEN
    RAISE EXCEPTION 'invalid_memory_kind';
  END IF;
  IF char_length(btrim(COALESCE(p_content, ''))) NOT BETWEEN 1 AND 1200 THEN
    RAISE EXCEPTION 'invalid_memory_content';
  END IF;
  v_reason := public.ari_memory_sensitive_reason(p_content);
  IF v_reason IS NOT NULL THEN
    RAISE EXCEPTION 'memory_sensitive_content:%', v_reason USING ERRCODE = '22023';
  END IF;
  IF p_evidence_message_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.agent_messages m WHERE m.id = p_evidence_message_id AND m.user_id = v_actor
  ) THEN RAISE EXCEPTION 'invalid_memory_evidence'; END IF;
  INSERT INTO public.ari_memory_notes(user_id, brand_id, kind, content, content_key, evidence_message_id)
  VALUES (v_actor, p_brand_id, p_kind, btrim(p_content), NULL, p_evidence_message_id)
  RETURNING * INTO v_note;
  RETURN to_jsonb(v_note) - 'user_id' - 'content_key';
END;
$fn$;
REVOKE ALL ON FUNCTION public.ari_memory_save(uuid, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ari_memory_save(uuid, text, text, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.ari_memory_update(
  p_note_id uuid,
  p_kind text,
  p_content text,
  p_brand_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_actor uuid := auth.uid();
  v_note public.ari_memory_notes%ROWTYPE;
  v_reason text;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF p_kind NOT IN ('preference', 'correction', 'fact', 'business_fact', 'workflow') THEN
    RAISE EXCEPTION 'invalid_memory_kind';
  END IF;
  IF char_length(btrim(COALESCE(p_content, ''))) NOT BETWEEN 1 AND 1200 THEN
    RAISE EXCEPTION 'invalid_memory_content';
  END IF;
  v_reason := public.ari_memory_sensitive_reason(p_content);
  IF v_reason IS NOT NULL THEN
    RAISE EXCEPTION 'memory_sensitive_content:%', v_reason USING ERRCODE = '22023';
  END IF;
  IF p_brand_id IS NOT NULL AND NOT public.biz_is_brand_member_for_read(p_brand_id, v_actor) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  -- #3355 rework 1 (tester P1-5): the note's own brand decides, not the
  -- argument. A removed member cannot edit a note every member's Ari reads,
  -- and a brand note needs the rank that may write one (P2-7).
  SELECT * INTO v_note FROM public.ari_memory_notes n
   WHERE n.id = p_note_id AND n.user_id = v_actor AND n.active
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF v_note.brand_id IS NOT NULL
     AND NOT public.biz_is_brand_member_for_read(v_note.brand_id, v_actor) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF v_note.scope = 'brand'
     AND COALESCE(public.biz_brand_effective_rank(v_note.brand_id, v_actor), 0)
         < public.biz_role_rank('marketing_manager') THEN
    RAISE EXCEPTION 'memory_brand_note_rank' USING ERRCODE = '42501';
  END IF;

  UPDATE public.ari_memory_notes
  SET kind = p_kind,
      content = btrim(p_content),
      content_key = CASE WHEN content_key IS NULL THEN NULL
                         ELSE public.ari_memory_content_key(p_content) END,
      brand_id = CASE WHEN scope = 'brand' THEN brand_id ELSE p_brand_id END,
      updated_at = now()
  WHERE id = p_note_id AND user_id = v_actor AND active
  RETURNING * INTO v_note;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  RETURN to_jsonb(v_note) - 'user_id' - 'content_key';
END;
$fn$;
REVOKE ALL ON FUNCTION public.ari_memory_update(uuid, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ari_memory_update(uuid, text, text, uuid) TO authenticated, service_role;

COMMENT ON COLUMN public.ari_memory_notes.scope IS
  'Issue #3355 D1: user = only the author reads it; brand = every member of brand_id reads it.';

COMMIT;
