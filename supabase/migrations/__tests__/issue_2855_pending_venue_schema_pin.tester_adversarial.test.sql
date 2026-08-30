-- Tester-owned #2855 adversarial transaction fragment.
-- A schema hash review approves only the lane's existence, never nonzero use:
-- every reviewed lane remains disallowed and must be empty before correction.
-- CI owner: issue-2099-pending-venue-identity-correction-tests.yml.

DO $$
DECLARE
  v_reviewed_lanes text[];
BEGIN
  WITH reviewed_relations(relname) AS (
    VALUES
      ('event_cover_video_jobs'),
      ('tool_competitor_budget_ledger'),
      ('tool_competitor_model_usage_receipts'),
      ('tool_competitor_refresh_jobs'),
      ('tool_competitor_sources'),
      ('tool_competitor_venue_week_budget_boundaries')
  ), semantic AS (
    SELECT c.relname, a.attname,
      CASE WHEN a.attname='place_pool_id' THEN 'pool' ELSE 'venue' END target,
      'semantic' source
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid
    JOIN reviewed_relations rr ON rr.relname=c.relname
    WHERE n.nspname='public' AND c.relkind IN ('r','p')
      AND a.attnum>0 AND NOT a.attisdropped
      AND a.attname IN ('venue_id','serving_venue_id','duplicate_of_venue_id','place_pool_id')
  ), fk AS (
    SELECT src.relname, sa.attname,
      CASE ref.relname WHEN 'place_pool' THEN 'pool' ELSE 'venue' END target,
      'fk' source
    FROM pg_catalog.pg_constraint con
    JOIN pg_catalog.pg_class src ON src.oid=con.conrelid
    JOIN pg_catalog.pg_namespace ns ON ns.oid=src.relnamespace
    JOIN reviewed_relations rr ON rr.relname=src.relname
    JOIN pg_catalog.pg_class ref ON ref.oid=con.confrelid
    JOIN LATERAL unnest(con.conkey,con.confkey) pair(srcatt,refatt) ON true
    JOIN pg_catalog.pg_attribute sa ON sa.attrelid=src.oid AND sa.attnum=pair.srcatt
    JOIN pg_catalog.pg_attribute ra ON ra.attrelid=ref.oid AND ra.attnum=pair.refatt
    WHERE con.contype='f' AND ns.nspname='public' AND src.relkind IN ('r','p')
      AND ref.relname IN ('venue_listings','place_pool') AND ra.attname='id'
  ), lanes AS (
    SELECT relname,attname,target,string_agg(source,',' ORDER BY source) sources
    FROM (SELECT * FROM semantic UNION ALL SELECT * FROM fk) x
    GROUP BY relname,attname,target
  )
  SELECT array_agg(relname||'|'||attname||'|'||target||'|'||sources ORDER BY relname,attname,target)
  INTO v_reviewed_lanes
  FROM lanes;

  IF v_reviewed_lanes IS DISTINCT FROM ARRAY[
    'event_cover_video_jobs|venue_id|venue|fk,semantic',
    'tool_competitor_budget_ledger|venue_listing_id|venue|fk',
    'tool_competitor_model_usage_receipts|venue_listing_id|venue|fk',
    'tool_competitor_refresh_jobs|venue_listing_id|venue|fk',
    'tool_competitor_sources|venue_listing_id|venue|fk',
    'tool_competitor_venue_week_budget_boundaries|venue_listing_id|venue|fk'
  ]::text[] THEN
    RAISE EXCEPTION '#2855 reviewed lane catalog mismatch: %',v_reviewed_lanes;
  END IF;

  IF (SELECT count(*) FROM public.venue_identity_correction_audit
      WHERE corrected_venue_id='20990000-0000-0000-0000-000000000020')<>2 THEN
    RAISE EXCEPTION '#2855 precondition audit count drifted';
  END IF;
END $$;

INSERT INTO public.tool_competitor_venue_week_budget_boundaries(venue_listing_id,iso_week)
VALUES('20990000-0000-0000-0000-000000000020',DATE '2099-01-05');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','20990000-0000-0000-0000-000000000001',true);
DO $$
DECLARE
  p jsonb;
BEGIN
  p:=public.preview_pending_venue_identity_correction('20990000-0000-0000-0000-000000000020');
  IF p->>'ok'<>'false' OR p->>'eligible'<>'false'
     OR p->>'code'<>'DEPENDENCY_NOT_EMPTY'
     OR p->>'schema_fingerprint'<>'52f4624c994529d2e63b8f70b79a3fcfe28f3ff90dafe300bc45439e37cd2921'
     OR COALESCE((SELECT sum((lane->>'count')::bigint)
                  FROM jsonb_array_elements(p->'dependency_counts') lane
                  WHERE lane->>'classification'='disallowed'),0)<>1 THEN
    RAISE EXCEPTION '#2855 nonzero reviewed lane did not fail closed: %',p;
  END IF;
END $$;
RESET ROLE;

DO $$
BEGIN
  IF (SELECT count(*) FROM public.venue_identity_correction_audit
      WHERE corrected_venue_id='20990000-0000-0000-0000-000000000020')<>2
     OR NOT EXISTS (
       SELECT 1 FROM public.venue_listings
       WHERE id='20990000-0000-0000-0000-000000000020'
         AND name='Old venue' AND slug='oldvenue' AND venue_category='play'
         AND claim_status='pending_review'
     ) THEN
    RAISE EXCEPTION '#2855 rejected preview changed identity or wrote an audit row';
  END IF;
END $$;

DELETE FROM public.tool_competitor_venue_week_budget_boundaries
WHERE venue_listing_id='20990000-0000-0000-0000-000000000020'
  AND iso_week=DATE '2099-01-05';

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','20990000-0000-0000-0000-000000000001',true);
DO $$
DECLARE
  p jsonb;
BEGIN
  p:=public.preview_pending_venue_identity_correction('20990000-0000-0000-0000-000000000020');
  IF p->>'ok'<>'true' OR p->>'eligible'<>'true' OR p->>'code' IS NOT NULL
     OR p->>'schema_fingerprint'<>'52f4624c994529d2e63b8f70b79a3fcfe28f3ff90dafe300bc45439e37cd2921'
     OR length(p->>'state_fingerprint')<>64 THEN
    RAISE EXCEPTION '#2855 deleting the reviewed-lane row did not restore eligibility: %',p;
  END IF;
END $$;
RESET ROLE;

DO $$
BEGIN
  IF EXISTS (
       SELECT 1 FROM public.tool_competitor_venue_week_budget_boundaries
       WHERE venue_listing_id='20990000-0000-0000-0000-000000000020'
         AND iso_week=DATE '2099-01-05'
     )
     OR (SELECT count(*) FROM public.venue_identity_correction_audit
         WHERE corrected_venue_id='20990000-0000-0000-0000-000000000020')<>2 THEN
    RAISE EXCEPTION '#2855 tester cleanup or zero-audit contract failed';
  END IF;
END $$;
