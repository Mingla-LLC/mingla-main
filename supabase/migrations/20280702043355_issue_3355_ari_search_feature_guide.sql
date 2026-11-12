-- Issue #3355 Wave B (B1) — Ari reads the Feature Guide.
--
-- Production 2026-11-10: public.product_capabilities (the Feature Guide) has
-- 160 entries with how_to, limitations, support wording and a claimed
-- status, and Ari never read it, so it told hosts "I can't do that" about
-- things Mingla does and gave steps from memory.
--
-- ari_search_feature_guide(p_query, p_limit) is the read behind Ari's
-- search_mingla_guide tool:
--   * signed-in callers only (execute: authenticated; auth.uid() required);
--   * full-text search over title, outcome_summary, how_to and limitations
--     (an expression GIN index; the table itself is unchanged);
--   * returns the public parts of an entry and its effective status from the
--     Feature Guide's own rule (issue_3720_feature_guide_effective_status:
--     Live only with current verified evidence), plus evidence_current —
--     never evidence rows, URLs, reviewers or audit data;
--   * staff-only entries (every surface is Mingla Admin, GitHub or the staff
--     agent connector) are not returned to hosts.
--
-- Static SQL. Read-only. No data change.
-- Invariant I-ARI-KNOWLEDGE-FROM-GUIDE is declared beside its enforcing test:
-- supabase/functions/_shared/__tests__/issue_3355_wave_b_guide.implementor.test.ts

BEGIN;

SET LOCAL lock_timeout = '10s';

DO $foundation$
BEGIN
  IF to_regclass('public.product_capabilities') IS NULL
     OR to_regprocedure('public.issue_3720_feature_guide_effective_status(uuid)') IS NULL THEN
    RAISE EXCEPTION 'issue3355_feature_guide_foundation_missing';
  END IF;
END;
$foundation$;

-- The searchable document of one entry. Immutable (fixed text-search
-- configuration) so it can back an expression index.
CREATE OR REPLACE FUNCTION public.ari_feature_guide_document(
  p_title text,
  p_outcome_summary text,
  p_how_to text,
  p_limitations text
) RETURNS tsvector
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $function$
  SELECT pg_catalog.setweight(pg_catalog.to_tsvector('pg_catalog.english'::regconfig, COALESCE(p_title, '')), 'A')
      || pg_catalog.setweight(pg_catalog.to_tsvector('pg_catalog.english'::regconfig, COALESCE(p_outcome_summary, '')), 'B')
      || pg_catalog.setweight(pg_catalog.to_tsvector('pg_catalog.english'::regconfig, COALESCE(p_how_to, '')), 'C')
      || pg_catalog.setweight(pg_catalog.to_tsvector('pg_catalog.english'::regconfig, COALESCE(p_limitations, '')), 'D');
$function$;

REVOKE ALL ON FUNCTION public.ari_feature_guide_document(text,text,text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ari_feature_guide_document(text,text,text,text)
  TO service_role;

CREATE INDEX IF NOT EXISTS product_capabilities_ari_search_idx
  ON public.product_capabilities
  USING gin (public.ari_feature_guide_document(title, outcome_summary, how_to, limitations));

CREATE OR REPLACE FUNCTION public.ari_search_feature_guide(
  p_query text,
  p_limit integer DEFAULT 3
) RETURNS TABLE (
  capability_key text,
  title text,
  outcome_summary text,
  how_to text,
  limitations text,
  support_wording text,
  who_can_use text[],
  surfaces text[],
  claimed_status text,
  guide_status text,
  evidence_current boolean,
  rank real
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_query text := pg_catalog.btrim(COALESCE(p_query, ''));
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 3), 1), 5);
  v_lexemes text[];
  v_tsquery tsquery;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF v_query = '' THEN
    RAISE EXCEPTION 'query_required' USING ERRCODE = '22023';
  END IF;
  IF pg_catalog.char_length(v_query) > 300 THEN
    RAISE EXCEPTION 'query_too_long' USING ERRCODE = '22023';
  END IF;

  -- The question's words: conversational filler dropped ("I want to…",
  -- "can you help me make…"), a few host words widened to the guide's own
  -- ("upload" also finds "import", "customer" finds "contact", "promo" finds
  -- "discount"). Any word may match (OR); ts_rank with length
  -- normalisation orders them, title words weighing most. Each lexeme is
  -- quoted, so the host's words are never parsed as query syntax.
  SELECT pg_catalog.array_agg(DISTINCT
           '''' || pg_catalog.replace(w.lexeme, '''', '''''') || '''')
    INTO v_lexemes
    FROM (
      SELECT t.lexeme
        FROM pg_catalog.unnest(
               pg_catalog.to_tsvector('pg_catalog.english'::regconfig, v_query)) AS t
       WHERE t.lexeme <> ALL (ARRAY[
         'want','need','like','would','could','help','pleas','get','use',
         'let','know','tell','show','ask','make','way','possibl','run','now'])
      UNION
      SELECT alias.word
        FROM pg_catalog.unnest(
               pg_catalog.to_tsvector('pg_catalog.english'::regconfig, v_query)) AS t
        JOIN (VALUES ('upload','import'), ('custom','contact'),
                     ('promo','discount'), ('coupon','discount'),
                     ('voucher','discount'), ('staff','team'))
             AS alias(host_word, word)
          ON alias.host_word = t.lexeme
    ) AS w;

  IF v_lexemes IS NULL THEN
    RETURN;
  END IF;
  v_tsquery := pg_catalog.to_tsquery(
    'pg_catalog.english'::regconfig,
    pg_catalog.array_to_string(v_lexemes, ' | '));

  RETURN QUERY
  SELECT ranked.capability_key, ranked.title, ranked.outcome_summary,
         ranked.how_to, ranked.limitations, ranked.support_wording,
         ranked.who_can_use, ranked.surfaces, ranked.claimed_status,
         ranked.guide_status, ranked.guide_status = 'Live', ranked.rank
    FROM (
      SELECT c.capability_key, c.title, c.outcome_summary, c.how_to,
             c.limitations, c.support_wording, c.who_can_use, c.surfaces,
             c.claimed_status,
             public.issue_3720_feature_guide_effective_status(c.id) AS guide_status,
             pg_catalog.ts_rank(
               public.ari_feature_guide_document(c.title, c.outcome_summary, c.how_to, c.limitations),
               v_tsquery, 1) AS rank
        FROM public.product_capabilities c
       WHERE public.ari_feature_guide_document(c.title, c.outcome_summary, c.how_to, c.limitations)
             @@ v_tsquery
         AND EXISTS (
           SELECT 1
             FROM pg_catalog.unnest(c.surfaces) AS s(surface)
            WHERE s.surface !~* '(mingla admin|admin web|github|my agent|team agents|claude|codex|careers)'
         )
    ) AS ranked
   ORDER BY ranked.rank DESC, ranked.capability_key
   LIMIT v_limit;
END;
$function$;

COMMENT ON FUNCTION public.ari_search_feature_guide(text, integer) IS
  '#3355 Wave B: Ari''s Feature Guide search (search_mingla_guide). Public entry text and effective status only; no evidence rows.';

REVOKE ALL ON FUNCTION public.ari_search_feature_guide(text, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ari_search_feature_guide(text, integer)
  TO authenticated;

DO $guard$
BEGIN
  IF has_function_privilege('anon', 'public.ari_search_feature_guide(text,integer)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.ari_search_feature_guide(text,integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.issue_3720_feature_guide_effective_status(uuid)', 'EXECUTE')
     OR has_table_privilege('authenticated', 'public.product_capabilities', 'SELECT') THEN
    RAISE EXCEPTION 'issue3355_feature_guide_search_acl_invalid';
  END IF;
END;
$guard$;

NOTIFY pgrst, 'reload schema';

COMMIT;
