-- =====================================================================================
-- Issue #2589 — a content-share version identifies the CARD, not the inventory.
--
-- WHAT IS WRONG TODAY. `version_fingerprint` is a SHA-256 over the whole facts
-- payload. `facts.availability` ("958 left") is inside that payload and moves every
-- time a ticket sells. So an ordinary ticket sale mints a brand-new immutable share
-- version, which mints a brand-new versioned image URL, which no CDN has ever seen.
--
-- MEASURED, not assumed (2026-08-25, production, read-only):
--   * one live link had burned 88 versions in 4 days — 64% of every version row in
--     the project — and versions 40, 41, 42 and 88 render BYTE-IDENTICAL JPEGs
--     (same md5, same 136,884 bytes).
--   * `md5(facts - 'availability')` is identical across all 25 most recent versions
--     of that link. The changed key is always and only `availability`.
--   * each new version costs a guaranteed ~2 s cold render for a picture that was
--     already warm in the CDN one version ago.
--
-- AND THE FIELD IS NOT EVEN DRAWN. The card clips its fact row to two lines and the
-- date + venue string consume both, so `availability` never reaches the artwork. A
-- field nobody can see was minting permanent URLs.
--
-- WHAT THIS CHANGES. One thing: the fingerprint is taken over the facts payload with
-- the volatile key removed. `availability` STAYS in `facts` and stays on the share
-- page, in the share message, and in the sheet's preview line — it is display-only
-- truth, and dropping it would be a product change nobody asked for. It simply stops
-- deciding whether a new immutable version exists.
--
-- WHAT MUST KEEP MINTING, and why this is not a stale-image bug. Everything else in
-- the fingerprint is untouched, INCLUDING `p_media_identity` and `facts.media`. That
-- is the load-bearing property: adding, changing or removing a cover changes the
-- media identity, so it still mints a new version and the new picture still
-- propagates. Before this change that propagation was riding on the churn by
-- accident; after it, it rides on the cover's own identity, deliberately. Pinned in
-- both directions by `scripts/issue-2589/share-version-identity.dbboundary.test.mjs`.
--
-- ONE-TIME COST, stated plainly. The fingerprint text changes, so the first public
-- read of each existing link whose facts carry `availability` computes a value that
-- differs from its stored one and mints exactly ONE corrective version. After that
-- the chain is stable. Roughly one row per active event/rsvp/experience link, once.
-- It is NOT possible to avoid this by rewriting the stored fingerprints: version rows
-- are protected by `content_share_versions_immutable`, which raises on any UPDATE,
-- and #2589 does not weaken that trigger. `place`/`curated` links carry no
-- `availability` key at all, so `p_facts - 'availability'` is the identical jsonb for
-- them and their fingerprints do not move — they mint nothing.
--
-- NOT DOING (deliberate):
--   * No row is edited, deleted or backfilled. History stays immutable.
--   * `availability` is not removed from the share facts contract.
--   * The public read path still re-derives on every read. Stopping the read-side
--     write entirely is a separate decision and is not made here.
--
-- ORDERING: strictly greater than 20270528002489, which was the maximum prefix in the
-- anchor checkout, in the linked project's applied history, and across every sibling
-- worktree under ~/Desktop/mingla-orchs/ at the moment this file was written.
--
-- DEPLOY: this file only. Confirm no unapplied sibling migration would be carried
-- along by a bare `db push`, and re-read the live definitions afterwards — a deploy
-- command's exit code is not evidence.
-- =====================================================================================

BEGIN;

-- =====================================================================================
-- 1 — THE IDENTITY PROJECTION. Defined once; referenced by both mint RPCs.
--
-- This is the single answer to "which facts is a share version allowed to depend on?".
-- It is a projection rather than an inline `- 'availability'` in two function bodies
-- precisely because #2589 found the same rule hand-copied into three places elsewhere
-- in this pipeline, where the copies had already drifted. A future volatile fact is
-- added HERE and nowhere else.
--
-- TOTAL and non-raising: a NULL payload collapses to '{}' rather than propagating
-- NULL into the digest, which would make every fingerprint NULL and therefore make
-- `IS DISTINCT FROM` mint a version on every single read — the exact failure this
-- migration exists to end, inverted.
-- =====================================================================================
CREATE OR REPLACE FUNCTION public.issue_2589_share_version_identity_facts(p_facts jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public, pg_temp
AS $function$
  SELECT COALESCE(p_facts, '{}'::jsonb) - 'availability'
$function$;

COMMENT ON FUNCTION public.issue_2589_share_version_identity_facts(jsonb) IS
  'Issue #2589 — the facts a content-share version identity may depend on. Volatile, '
  'display-only facts are removed here so an ordinary inventory change cannot mint a '
  'new immutable version and strand the CDN copy of an unchanged card. The ONLY place '
  'that list is written down. I-PROPOSED-2589-SHARE-VERSION-IS-IDENTITY-ONLY.';

REVOKE ALL ON FUNCTION public.issue_2589_share_version_identity_facts(jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_2589_share_version_identity_facts(jsonb)
  TO service_role;

-- =====================================================================================
-- 2 — THE MINT RPC. Reproduced verbatim from 20270226001615 except for the single
-- fingerprint line, which now hashes the identity projection instead of raw facts.
-- Nothing else in this function's behaviour, validation, locking or return shape
-- changes; it is restated in full because CREATE OR REPLACE has no patch form.
-- =====================================================================================
CREATE OR REPLACE FUNCTION public.upsert_content_share_version(
  p_entity_kind text,
  p_creator_principal uuid,
  p_source_key text,
  p_source_reference jsonb,
  p_attribution jsonb,
  p_facts jsonb,
  p_media_identity jsonb,
  p_destination_manifest jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_link public.content_share_links%ROWTYPE;
  v_code text;
  v_fingerprint text;
  v_current_fingerprint text;
  v_version integer;
  v_created boolean := false;
  v_attempt integer := 0;
BEGIN
  IF p_entity_kind NOT IN ('place','curated','event','rsvp_event','trip','experience','venue','brand')
     OR p_source_key IS NULL OR char_length(p_source_key) NOT BETWEEN 1 AND 512
     OR jsonb_typeof(p_source_reference) <> 'object'
     OR jsonb_typeof(COALESCE(p_attribution, '{}'::jsonb)) <> 'object'
     OR jsonb_typeof(p_facts) <> 'object'
     OR p_facts->>'schemaVersion' <> '1'
     OR p_facts->>'kind' IS DISTINCT FROM p_entity_kind
     OR jsonb_typeof(p_facts->'title') <> 'string'
     OR char_length(btrim(p_facts->>'title')) NOT BETWEEN 1 AND 160
     OR (p_media_identity IS NOT NULL AND jsonb_typeof(p_media_identity) <> 'object')
     OR jsonb_typeof(p_destination_manifest) <> 'object' THEN
    RAISE EXCEPTION 'invalid_content_share_contract';
  END IF;
  IF p_creator_principal IS NULL
     AND NOT (p_source_reference @> '{"serverCreated":true}'::jsonb) THEN
    RAISE EXCEPTION 'creator_principal_required';
  END IF;

  SELECT * INTO v_link
  FROM public.content_share_links
  WHERE creator_principal IS NOT DISTINCT FROM p_creator_principal
    AND entity_kind = p_entity_kind
    AND access_policy = 'public'
    AND source_key = p_source_key
    AND state = 'active'
  FOR UPDATE;

  IF NOT FOUND THEN
    LOOP
      v_attempt := v_attempt + 1;
      IF v_attempt > 8 THEN RAISE EXCEPTION 'short_code_collision_exhausted'; END IF;
      v_code := public.content_share_random_code();
      BEGIN
        INSERT INTO public.content_share_links (
          short_code, entity_kind, creator_principal, source_key, source_reference, attribution
        ) VALUES (
          v_code, p_entity_kind, p_creator_principal, p_source_key, p_source_reference,
          COALESCE(p_attribution, '{}'::jsonb)
        ) RETURNING * INTO v_link;
        EXIT;
      EXCEPTION WHEN unique_violation THEN
        SELECT * INTO v_link
        FROM public.content_share_links
        WHERE creator_principal IS NOT DISTINCT FROM p_creator_principal
          AND entity_kind = p_entity_kind AND access_policy = 'public'
          AND source_key = p_source_key AND state = 'active'
        FOR UPDATE;
        IF FOUND THEN EXIT; END IF;
      END;
    END LOOP;
  END IF;

  -- issue #2589 — the ONLY changed line. `p_facts` became
  -- `public.issue_2589_share_version_identity_facts(p_facts)` so a volatile,
  -- display-only fact cannot mint an immutable version. `p_media_identity` stays in
  -- the digest on purpose: a cover added, changed or removed MUST still mint.
  v_fingerprint := encode(extensions.digest(convert_to(
    public.issue_2589_share_version_identity_facts(p_facts)::text || '|' || COALESCE(p_media_identity, 'null'::jsonb)::text
      || '|' || p_destination_manifest::text, 'UTF8'), 'sha256'), 'hex');
  IF v_link.current_version > 0 THEN
    SELECT version_fingerprint INTO v_current_fingerprint
    FROM public.content_share_versions
    WHERE link_id = v_link.id AND version = v_link.current_version;
  END IF;

  IF v_current_fingerprint IS DISTINCT FROM v_fingerprint THEN
    v_version := v_link.current_version + 1;
    INSERT INTO public.content_share_versions (
      link_id, version, facts, media_identity, destination_manifest, version_fingerprint
    ) VALUES (
      v_link.id, v_version, p_facts, p_media_identity, p_destination_manifest, v_fingerprint
    );
    UPDATE public.content_share_links SET
      current_version = v_version,
      source_reference = p_source_reference,
      attribution = COALESCE(p_attribution, '{}'::jsonb),
      updated_at = now()
    WHERE id = v_link.id;
    v_created := true;
  ELSE
    v_version := v_link.current_version;
    UPDATE public.content_share_links SET
      attribution = COALESCE(p_attribution, '{}'::jsonb),
      updated_at = now()
    WHERE id = v_link.id;
  END IF;

  RETURN jsonb_build_object(
    'linkId', v_link.id, 'shortCode', v_link.short_code,
    'version', v_version, 'versionCreated', v_created
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.upsert_content_share_version(text,uuid,text,jsonb,jsonb,jsonb,jsonb,jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_content_share_version(text,uuid,text,jsonb,jsonb,jsonb,jsonb,jsonb)
  TO service_role;

-- =====================================================================================
-- 3 — THE NATIVE-SNAPSHOT MINT RPC. Same one-line change, for the same reason.
--
-- `place` and `curated` facts do not carry `availability` today, so this is a no-op
-- for every existing native link: `p_facts - 'availability'` is the identical jsonb
-- and renders to the identical text, so no fingerprint moves and nothing re-mints.
-- It is changed anyway so the two mint paths cannot answer "what is a version?"
-- differently the first time a volatile fact reaches a native kind.
--
-- Reproduced verbatim from 20270301001719 except for that line.
-- =====================================================================================
CREATE OR REPLACE FUNCTION public.upsert_content_share_version_with_native_snapshot(
  p_entity_kind text, p_creator_principal uuid, p_source_key text,
  p_source_reference jsonb, p_attribution jsonb, p_facts jsonb,
  p_media_identity jsonb, p_destination_manifest jsonb,
  p_native_snapshot jsonb, p_native_preview jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  v_link public.content_share_links%ROWTYPE; v_code text; v_version integer;
  v_fingerprint text; v_native_fingerprint text; v_current text;
  v_created boolean := false; v_attempt integer := 0;
  v_snapshot_bytes integer; v_preview_bytes integer;
BEGIN
  v_snapshot_bytes := octet_length(convert_to(p_native_snapshot::text,'UTF8'));
  v_preview_bytes := octet_length(convert_to(p_native_preview::text,'UTF8'));
  IF p_entity_kind NOT IN ('place','curated') OR p_source_key IS NULL OR char_length(p_source_key) NOT BETWEEN 1 AND 512
    OR jsonb_typeof(p_source_reference)<>'object' OR jsonb_typeof(COALESCE(p_attribution,'{}'::jsonb))<>'object'
    OR jsonb_typeof(p_facts)<>'object' OR p_facts->>'schemaVersion'<>'1' OR p_facts->>'kind' IS DISTINCT FROM p_entity_kind
    OR jsonb_typeof(p_destination_manifest)<>'object' OR jsonb_typeof(p_native_snapshot)<>'object'
    OR p_native_snapshot->>'contract'<>'native_content_card_snapshot_v1' OR p_native_snapshot->>'version'<>'1'
    OR p_native_snapshot->>'kind' IS DISTINCT FROM p_entity_kind OR jsonb_typeof(p_native_preview)<>'object'
    OR jsonb_typeof(p_native_preview->'title')<>'string' OR char_length(btrim(p_native_preview->>'title')) NOT BETWEEN 1 AND 160
    OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_native_snapshot) AS key
      WHERE key<>ALL(ARRAY['contract','version','kind','id','title','category','categoryIcon','image','images','description','fullDescription',
        'address','rating','reviewCount','priceRange','priceRangeStatus','sourceMinMinor','sourceMaxMinor','sourceCurrencyCode',
        'sourceMinorUnitExponent','displayMinMinor','displayMaxMinor','displayCurrencyCode','displayMinorUnitExponent','priceIsApproximate',
        'fxSnapshotId','fxProvider','fxProviderUpdatedAt','fxFreshness','lat','lng','placeId','openingHours','utcOffsetMinutes','phone',
        'countryCode','website','highlights','tags','socialStats','cardType','stops','tagline','categoryLabel','pairingKey','experienceType',
        'totalPriceMin','totalPriceMax','estimatedDurationMinutes','shoppingList','tip']))
    OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_native_preview) AS key
      WHERE key<>ALL(ARRAY['title','category','image','cardType','stopCount']))
    OR (p_native_preview?'image' AND (jsonb_typeof(p_native_preview->'image')<>'string' OR p_native_preview->>'image'!~'^https://'))
    OR (p_entity_kind='place' AND (p_native_preview->>'cardType' IS DISTINCT FROM 'single' OR p_native_preview?'stopCount'))
    OR (p_entity_kind='curated' AND (p_native_preview->>'cardType' IS DISTINCT FROM 'curated'
      OR jsonb_typeof(p_native_preview->'stopCount')<>'number' OR (p_native_preview->>'stopCount')!~'^[0-9]+$'
      OR (p_native_preview->>'stopCount')::numeric NOT BETWEEN 1 AND 24))
    OR v_snapshot_bytes>262144 OR v_preview_bytes>2600 THEN
    RAISE EXCEPTION 'invalid_native_content_share_contract';
  END IF;
  IF p_creator_principal IS NULL AND NOT (p_source_reference @> '{"serverCreated":true}'::jsonb) THEN
    RAISE EXCEPTION 'creator_principal_required';
  END IF;
  SELECT * INTO v_link FROM public.content_share_links
   WHERE creator_principal IS NOT DISTINCT FROM p_creator_principal AND entity_kind=p_entity_kind
    AND access_policy='public' AND source_key=p_source_key AND state='active' FOR UPDATE;
  IF NOT FOUND THEN
    LOOP
      v_attempt:=v_attempt+1; IF v_attempt>8 THEN RAISE EXCEPTION 'short_code_collision_exhausted'; END IF;
      v_code:=public.content_share_random_code();
      BEGIN
        INSERT INTO public.content_share_links(short_code,entity_kind,creator_principal,source_key,source_reference,attribution)
        VALUES(v_code,p_entity_kind,p_creator_principal,p_source_key,p_source_reference,COALESCE(p_attribution,'{}'::jsonb)) RETURNING * INTO v_link;
        EXIT;
      EXCEPTION WHEN unique_violation THEN
        SELECT * INTO v_link FROM public.content_share_links
         WHERE creator_principal IS NOT DISTINCT FROM p_creator_principal AND entity_kind=p_entity_kind
          AND access_policy='public' AND source_key=p_source_key AND state='active' FOR UPDATE;
        IF FOUND THEN EXIT; END IF;
      END;
    END LOOP;
  END IF;
  v_native_fingerprint:=encode(extensions.digest(convert_to(p_native_snapshot::text||'|'||p_native_preview::text,'UTF8'),'sha256'),'hex');
  -- issue #2589 — the ONLY changed line in this function. See §2.
  v_fingerprint:=encode(extensions.digest(convert_to(public.issue_2589_share_version_identity_facts(p_facts)::text||'|'||COALESCE(p_media_identity,'null'::jsonb)::text||'|'||p_destination_manifest::text||'|'||v_native_fingerprint,'UTF8'),'sha256'),'hex');
  IF v_link.current_version>0 THEN SELECT version_fingerprint INTO v_current FROM public.content_share_versions WHERE link_id=v_link.id AND version=v_link.current_version; END IF;
  IF v_current IS DISTINCT FROM v_fingerprint THEN
    v_version:=v_link.current_version+1;
    INSERT INTO public.content_share_versions(link_id,version,facts,media_identity,destination_manifest,version_fingerprint)
      VALUES(v_link.id,v_version,p_facts,p_media_identity,p_destination_manifest,v_fingerprint);
    INSERT INTO public.content_share_native_snapshots(link_id,version,contract,kind,snapshot,preview,snapshot_fingerprint,snapshot_bytes,preview_bytes)
      VALUES(v_link.id,v_version,'native_content_card_snapshot_v1',p_entity_kind,p_native_snapshot,p_native_preview,v_native_fingerprint,v_snapshot_bytes,v_preview_bytes);
    UPDATE public.content_share_links SET current_version=v_version,source_reference=p_source_reference,
      attribution=COALESCE(p_attribution,'{}'::jsonb),updated_at=now() WHERE id=v_link.id;
    v_created:=true;
  ELSE
    v_version:=v_link.current_version;
    UPDATE public.content_share_links SET attribution=COALESCE(p_attribution,'{}'::jsonb),updated_at=now() WHERE id=v_link.id;
  END IF;
  RETURN jsonb_build_object('linkId',v_link.id,'shortCode',v_link.short_code,'version',v_version,'versionCreated',v_created);
END; $$;
REVOKE ALL ON FUNCTION public.upsert_content_share_version_with_native_snapshot(text,uuid,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_content_share_version_with_native_snapshot(text,uuid,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb) TO service_role;

COMMIT;
