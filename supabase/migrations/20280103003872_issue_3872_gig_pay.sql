-- #3872: gigs carry the most the host will pay each creator.
-- Budget levels (b1-b4) and their admin-edited ranges are retired: the host
-- types "Pay each creator up to $300" and that exact amount is stored and read.
-- 1. gigs.pay_up_to_minor (backfilled from the old level's range top where one
--    existed; otherwise left empty and every read tolerates null).
-- 2. gig_save requires pay_up_to_minor > 0 (error pay_required).
-- 3. Gig reads return pay_up_to_minor + currency instead of the level.
-- 4. gigs.budget_band, gig_budget_bands and admin_budget_band_save are dropped.
BEGIN;
SET LOCAL lock_timeout = '10s';

-- 1. Column + backfill ------------------------------------------------------
ALTER TABLE public.gigs ADD COLUMN pay_up_to_minor bigint;
ALTER TABLE public.gigs ADD CONSTRAINT gigs_pay_up_to_minor_positive
  CHECK (pay_up_to_minor IS NULL OR pay_up_to_minor > 0);
UPDATE public.gigs g SET pay_up_to_minor=bb.max_minor
FROM public.gig_budget_bands bb
WHERE bb.currency=g.currency AND bb.band=g.budget_band AND g.pay_up_to_minor IS NULL AND bb.max_minor>0;

-- 2. gig_save stores the pay (everything else is unchanged) -----------------
CREATE OR REPLACE FUNCTION public.gig_save(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_actor uuid:=auth.uid();
  v_uuid constant text:='^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_date constant text:='^[0-9]{4}-[0-9]{2}-[0-9]{2}$';
  v_int constant text:='^[0-9]{1,9}$';
  v_brand uuid; v_id uuid; v_existing public.gigs; v_hits text[];
  v_kind text; v_listing uuid; v_title text; v_brief text; v_private text; v_format text;
  v_deliverables jsonb; v_must_tag jsonb; v_city uuid; v_category text;
  v_start date; v_end date; v_post_by date; v_usage integer; v_pay bigint; v_currency text;
  v_share integer; v_passes integer; v_slots integer; v_visibility text; v_status text;
  v_hired integer; v_constraint text;
  v_tz text; v_due timestamptz; v_shoot_at timestamptz; v_due_txt text; v_shoot_txt text;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='28000'; END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN
    RETURN jsonb_build_object('ok',false,'error','invalid_payload');
  END IF;
  IF coalesce(p_payload->>'brand_id','')!~v_uuid THEN
    RETURN jsonb_build_object('ok',false,'error','brand_required','field','brand_id');
  END IF;
  v_brand:=(p_payload->>'brand_id')::uuid;
  IF NOT public.issue_3872_gig_host_writer(v_brand,v_actor) THEN RAISE EXCEPTION 'permission_denied' USING ERRCODE='42501'; END IF;
  IF NOT public.issue_3872_creator_gigs_on(v_brand) THEN RAISE EXCEPTION 'creator_gigs_disabled' USING ERRCODE='55000'; END IF;

  IF nullif(p_payload->>'id','') IS NOT NULL THEN
    IF p_payload->>'id'!~v_uuid THEN RETURN jsonb_build_object('ok',false,'error','gig_not_found','field','id'); END IF;
    v_id:=(p_payload->>'id')::uuid;
    SELECT * INTO v_existing FROM public.gigs WHERE id=v_id FOR UPDATE;
    -- Another brand's gig id used to fall through ON CONFLICT ... WHERE and
    -- return ok without saving anything.
    IF NOT FOUND OR v_existing.brand_id<>v_brand THEN RETURN jsonb_build_object('ok',false,'error','gig_not_found','field','id'); END IF;
    IF v_existing.status NOT IN ('draft','open') THEN RETURN jsonb_build_object('ok',false,'error','gig_not_editable'); END IF;
  ELSE
    v_id:=gen_random_uuid();
  END IF;

  v_kind:=p_payload->>'listing_kind';
  IF v_kind NOT IN ('event','venue') OR v_kind IS NULL THEN RETURN jsonb_build_object('ok',false,'error','listing_required','field','listing_kind'); END IF;
  IF coalesce(p_payload->>'listing_id','')!~v_uuid THEN RETURN jsonb_build_object('ok',false,'error','listing_required','field','listing_id'); END IF;
  v_listing:=(p_payload->>'listing_id')::uuid;
  -- The listing must belong to the saving brand (cross-brand ids were accepted).
  IF (v_kind='event' AND NOT EXISTS(SELECT 1 FROM public.events e WHERE e.id=v_listing AND e.brand_id=v_brand AND e.deleted_at IS NULL))
     OR (v_kind='venue' AND NOT EXISTS(SELECT 1 FROM public.venue_listings vl WHERE vl.id=v_listing AND vl.brand_id=v_brand)) THEN
    RETURN jsonb_build_object('ok',false,'error','listing_not_found','field','listing_id');
  END IF;
  IF v_existing.id IS NOT NULL AND (v_existing.listing_kind<>v_kind OR v_existing.listing_id<>v_listing) THEN
    RETURN jsonb_build_object('ok',false,'error','listing_immutable','field','listing_id');
  END IF;

  v_title:=btrim(coalesce(p_payload->>'title_public',''));
  IF char_length(v_title) NOT BETWEEN 8 AND 70 THEN RETURN jsonb_build_object('ok',false,'error','title_length','field','title_public'); END IF;
  v_brief:=btrim(coalesce(p_payload->>'brief_public',''));
  IF char_length(v_brief) NOT BETWEEN 40 AND 800 THEN RETURN jsonb_build_object('ok',false,'error','brief_length','field','brief_public'); END IF;
  v_private:=nullif(btrim(coalesce(p_payload->>'brief_private','')),'');
  IF char_length(coalesce(v_private,''))>2000 THEN RETURN jsonb_build_object('ok',false,'error','private_brief_length','field','brief_private'); END IF;
  v_format:=p_payload->>'format_key';
  IF NOT EXISTS(SELECT 1 FROM public.gig_formats f WHERE f.key=v_format AND f.active) THEN RETURN jsonb_build_object('ok',false,'error','format_invalid','field','format_key'); END IF;
  v_deliverables:=p_payload->'deliverables';
  IF v_deliverables IS NULL OR jsonb_typeof(v_deliverables)<>'array' OR jsonb_array_length(v_deliverables) NOT BETWEEN 1 AND 10 THEN
    RETURN jsonb_build_object('ok',false,'error','deliverables_invalid','field','deliverables');
  END IF;
  v_must_tag:=CASE WHEN p_payload->'must_tag' IS NULL OR jsonb_typeof(p_payload->'must_tag')='null' THEN '{}'::jsonb ELSE p_payload->'must_tag' END;
  IF jsonb_typeof(v_must_tag)<>'object' THEN RETURN jsonb_build_object('ok',false,'error','must_tag_invalid','field','must_tag'); END IF;
  IF coalesce(p_payload->>'city_id','')!~v_uuid OR NOT EXISTS(SELECT 1 FROM public.seeding_cities WHERE id=(p_payload->>'city_id')::uuid) THEN
    RETURN jsonb_build_object('ok',false,'error','city_required','field','city_id');
  END IF;
  v_city:=(p_payload->>'city_id')::uuid;
  v_category:=btrim(coalesce(p_payload->>'category',''));
  IF char_length(v_category) NOT BETWEEN 2 AND 60 THEN RETURN jsonb_build_object('ok',false,'error','category_invalid','field','category'); END IF;
  -- Round 2: exact times. video_due_at is required (old clients may send
  -- post_by only: due at 23:59 that day); shoot_at is optional (null means
  -- the creator proposes a time in Plan the shoot). A time with no offset is
  -- the listing's local time.
  v_tz:=coalesce((SELECT nullif(e.timezone,'') FROM public.events e WHERE v_kind='event' AND e.id=v_listing),'UTC');
  v_due_txt:=nullif(btrim(coalesce(p_payload->>'video_due_at','')),'');
  v_shoot_txt:=nullif(btrim(coalesce(p_payload->>'shoot_at','')),'');
  IF v_due_txt IS NOT NULL THEN
    v_due:=public.issue_3872_listing_time(v_due_txt,v_tz);
    IF v_due IS NULL THEN RETURN jsonb_build_object('ok',false,'error','video_due_required','field','video_due_at'); END IF;
    v_post_by:=(v_due AT TIME ZONE v_tz)::date;
  ELSIF coalesce(p_payload->>'post_by','')~v_date THEN
    BEGIN v_post_by:=(p_payload->>'post_by')::date;
    EXCEPTION WHEN others THEN RETURN jsonb_build_object('ok',false,'error','date_invalid','field','post_by'); END;
    v_due:=(v_post_by+time '23:59') AT TIME ZONE v_tz;
  ELSE
    RETURN jsonb_build_object('ok',false,'error','video_due_required','field','video_due_at');
  END IF;
  IF v_shoot_txt IS NOT NULL THEN
    v_shoot_at:=public.issue_3872_listing_time(v_shoot_txt,v_tz);
    IF v_shoot_at IS NULL THEN RETURN jsonb_build_object('ok',false,'error','date_invalid','field','shoot_at'); END IF;
  END IF;
  -- A set shoot time with no window shoots on that day.
  IF v_shoot_at IS NOT NULL AND coalesce(p_payload->>'shoot_window_start','')='' AND coalesce(p_payload->>'shoot_window_end','')='' THEN
    v_start:=(v_shoot_at AT TIME ZONE v_tz)::date; v_end:=v_start;
  ELSE
    IF coalesce(p_payload->>'shoot_window_start','')!~v_date THEN RETURN jsonb_build_object('ok',false,'error','date_invalid','field','shoot_window_start'); END IF;
    IF coalesce(p_payload->>'shoot_window_end','')!~v_date THEN RETURN jsonb_build_object('ok',false,'error','date_invalid','field','shoot_window_end'); END IF;
    BEGIN
      v_start:=(p_payload->>'shoot_window_start')::date; v_end:=(p_payload->>'shoot_window_end')::date;
    EXCEPTION WHEN others THEN RETURN jsonb_build_object('ok',false,'error','date_invalid','field','shoot_window_start');
    END;
  END IF;
  -- Past shoot windows were accepted. A new or moved window must start today
  -- or later; every window must still be open.
  IF v_end<current_date THEN RETURN jsonb_build_object('ok',false,'error','shoot_window_in_past','field','shoot_window_end'); END IF;
  IF v_start<current_date AND (v_existing.id IS NULL OR v_existing.shoot_window_start IS DISTINCT FROM v_start) THEN
    RETURN jsonb_build_object('ok',false,'error','shoot_window_in_past','field','shoot_window_start');
  END IF;
  IF v_end<v_start THEN RETURN jsonb_build_object('ok',false,'error','shoot_window_order','field','shoot_window_end'); END IF;
  IF v_shoot_at IS NOT NULL THEN
    IF v_shoot_at<=now() AND (v_existing.id IS NULL OR v_existing.shoot_at IS DISTINCT FROM v_shoot_at) THEN
      RETURN jsonb_build_object('ok',false,'error','shoot_window_in_past','field','shoot_at');
    END IF;
    IF (v_shoot_at AT TIME ZONE v_tz)::date NOT BETWEEN v_start AND v_end THEN
      RETURN jsonb_build_object('ok',false,'error','shoot_outside_window','field','shoot_at');
    END IF;
  END IF;
  -- The video must be due in the future (an unchanged due time on an edit
  -- may stay as it was) and after the shoot.
  IF v_due<=now() AND (v_existing.id IS NULL OR v_existing.video_due_at IS DISTINCT FROM v_due) THEN
    RETURN jsonb_build_object('ok',false,'error','video_due_required','field','video_due_at');
  END IF;
  IF v_shoot_at IS NOT NULL AND v_due<=v_shoot_at THEN
    RETURN jsonb_build_object('ok',false,'error','video_due_before_shoot','field','video_due_at');
  END IF;
  IF v_post_by<v_end THEN RETURN jsonb_build_object('ok',false,'error','post_by_before_shoot','field','post_by'); END IF;
  IF coalesce(nullif(p_payload->>'usage_days',''),'90')!~v_int THEN RETURN jsonb_build_object('ok',false,'error','usage_invalid','field','usage_days'); END IF;
  v_usage:=coalesce(nullif(p_payload->>'usage_days',''),'90')::integer;
  IF v_usage NOT IN (30,90,365) THEN RETURN jsonb_build_object('ok',false,'error','usage_invalid','field','usage_days'); END IF;
  -- The host names the most each creator can be paid, in minor units.
  IF coalesce(p_payload->>'pay_up_to_minor','')!~'^[0-9]{1,15}$' OR (p_payload->>'pay_up_to_minor')::bigint<=0 THEN
    RETURN jsonb_build_object('ok',false,'error','pay_required','field','pay_up_to_minor');
  END IF;
  v_pay:=(p_payload->>'pay_up_to_minor')::bigint;
  v_currency:=upper(btrim(coalesce(p_payload->>'currency','')));
  IF v_currency!~'^[A-Z]{3}$' THEN RETURN jsonb_build_object('ok',false,'error','currency_invalid','field','currency'); END IF;
  IF v_existing.id IS NOT NULL AND v_existing.currency<>v_currency THEN RETURN jsonb_build_object('ok',false,'error','currency_immutable','field','currency'); END IF;
  IF nullif(p_payload->>'sales_share_bps','') IS NOT NULL THEN
    IF p_payload->>'sales_share_bps'!~v_int OR (p_payload->>'sales_share_bps')::integer NOT BETWEEN 100 AND 3000 THEN
      RETURN jsonb_build_object('ok',false,'error','sales_share_invalid','field','sales_share_bps');
    END IF;
    v_share:=(p_payload->>'sales_share_bps')::integer;
  END IF;
  IF coalesce(nullif(p_payload->>'shoot_passes',''),'1')!~v_int OR coalesce(nullif(p_payload->>'shoot_passes',''),'1')::integer NOT BETWEEN 0 AND 4 THEN
    RETURN jsonb_build_object('ok',false,'error','shoot_passes_invalid','field','shoot_passes');
  END IF;
  v_passes:=coalesce(nullif(p_payload->>'shoot_passes',''),'1')::integer;
  IF coalesce(nullif(p_payload->>'slots',''),'1')!~v_int OR coalesce(nullif(p_payload->>'slots',''),'1')::integer NOT BETWEEN 1 AND 10 THEN
    RETURN jsonb_build_object('ok',false,'error','slots_invalid','field','slots');
  END IF;
  v_slots:=coalesce(nullif(p_payload->>'slots',''),'1')::integer;
  IF v_existing.id IS NOT NULL THEN
    SELECT count(*) INTO v_hired FROM public.gig_contracts x WHERE x.gig_id=v_id AND x.state NOT IN ('declined','expired','cancelled','resolved_refund');
    IF v_slots<v_hired THEN RETURN jsonb_build_object('ok',false,'error','slots_below_hired','field','slots'); END IF;
  END IF;
  v_visibility:=coalesce(nullif(p_payload->>'visibility',''),'board');
  IF v_visibility NOT IN ('board','invite_only') THEN RETURN jsonb_build_object('ok',false,'error','visibility_invalid','field','visibility'); END IF;
  v_status:=coalesce(nullif(p_payload->>'status',''),coalesce(v_existing.status,'draft'));
  IF v_status NOT IN ('draft','open','closed','cancelled') OR (v_existing.id IS NULL AND v_status NOT IN ('draft','open')) THEN
    RETURN jsonb_build_object('ok',false,'error','status_invalid','field','status');
  END IF;

  v_hits:=public.issue_3872_brief_lint(v_brand,v_kind,v_listing,v_title)
    || public.issue_3872_brief_lint(v_brand,v_kind,v_listing,v_brief);
  IF cardinality(v_hits)>0 THEN
    RETURN jsonb_build_object('ok',false,'error','public_brief_not_anonymous','reasons',to_jsonb(v_hits),'field','brief_public');
  END IF;

  BEGIN
    IF v_existing.id IS NULL THEN
      INSERT INTO public.gigs(id,brand_id,listing_kind,listing_id,title_public,brief_public,brief_private,format_key,deliverables,must_tag,city_id,category,shoot_window_start,shoot_window_end,post_by,video_due_at,shoot_at,usage_days,pay_up_to_minor,currency,sales_share_bps,shoot_passes,slots,visibility,status,created_by)
      VALUES(v_id,v_brand,v_kind,v_listing,v_title,v_brief,v_private,v_format,v_deliverables,v_must_tag,v_city,v_category,v_start,v_end,v_post_by,v_due,v_shoot_at,v_usage,v_pay,v_currency,v_share,v_passes,v_slots,v_visibility,v_status,v_actor);
    ELSE
      UPDATE public.gigs SET title_public=v_title,brief_public=v_brief,brief_private=v_private,format_key=v_format,
        deliverables=v_deliverables,must_tag=v_must_tag,city_id=v_city,category=v_category,
        shoot_window_start=v_start,shoot_window_end=v_end,post_by=v_post_by,video_due_at=v_due,shoot_at=v_shoot_at,usage_days=v_usage,
        pay_up_to_minor=v_pay,sales_share_bps=v_share,shoot_passes=v_passes,slots=v_slots,
        visibility=v_visibility,status=v_status,version=version+1
      WHERE id=v_id;
    END IF;
  EXCEPTION WHEN check_violation OR not_null_violation OR foreign_key_violation OR invalid_text_representation OR numeric_value_out_of_range THEN
    -- Never surface raw constraint text; name the constraint as the field.
    GET STACKED DIAGNOSTICS v_constraint=CONSTRAINT_NAME;
    RETURN jsonb_build_object('ok',false,'error','invalid_gig','field',coalesce(nullif(v_constraint,''),'gig'));
  END;
  RETURN jsonb_build_object('ok',true,'id',v_id,'status',v_status);
END;
$fn$;

-- 3. Reads ------------------------------------------------------------------
-- The creator's gig card, detail and saved list (creator_gig_board,
-- creator_gig_detail, creator_saved_gigs, gig_creator_home.saved) all build
-- from this one function. gig_host_home returns to_jsonb(g), so it carries
-- pay_up_to_minor and currency from the column itself.
CREATE OR REPLACE FUNCTION public.issue_3872_public_gig_json(p_gig_id uuid,p_viewer uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
  SELECT jsonb_build_object(
    'id',g.id,'title_public',g.title_public,'brief_public',g.brief_public,'format_key',g.format_key,
    'deliverables',g.deliverables,'city_name',c.name,'category',g.category,
    'shoot_window',jsonb_build_object('start',g.shoot_window_start,'end',g.shoot_window_end),
    'post_by',g.post_by,'video_due_at',g.video_due_at,'shoot_at',g.shoot_at,
    'usage_days',g.usage_days,'pay_up_to_minor',g.pay_up_to_minor,'currency',g.currency,
    'sales_share_bps',g.sales_share_bps,'slots_left',public.issue_3872_gig_slots_left(g.id),
    'saved',EXISTS(SELECT 1 FROM public.creator_saved_gigs s WHERE s.gig_id=g.id AND s.creator_account_id=p_viewer)
  )
  FROM public.gigs g
  JOIN public.seeding_cities c ON c.id=g.city_id
  WHERE g.id=p_gig_id;
$fn$;

-- Admin gig list: each row also says what the gig pays, in the gig's currency.
CREATE OR REPLACE FUNCTION public.admin_gig_list(p_state text DEFAULT NULL,p_query text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path=public,pg_temp AS $fn$
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'admin_only' USING ERRCODE='42501'; END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'contract_id',c.id,'gig_id',g.id,'gig_title',g.title_public,'brand_name',b.name,
      'creator_display_name',p.display_name,'city',sc.name,'state',c.state,
      'fee_minor',tv.fee_minor,'currency',coalesce(tv.currency,g.currency),
      'pay_up_to_minor',g.pay_up_to_minor,'pay_currency',g.currency,
      'due_at',CASE WHEN c.state IN ('approved','posting','posts_failed') THEN ((coalesce(tv.post_by,g.post_by)+1)::timestamp AT TIME ZONE 'UTC') ELSE c.state_deadline_at END,
      'updated_at',c.updated_at
    ) ORDER BY c.updated_at DESC)
    FROM public.gig_contracts c
    JOIN public.gigs g ON g.id=c.gig_id
    JOIN public.brands b ON b.id=c.brand_id
    JOIN public.creator_profiles p ON p.creator_account_id=c.creator_account_id
    JOIN public.seeding_cities sc ON sc.id=g.city_id
    LEFT JOIN public.gig_terms_versions tv ON tv.contract_id=c.id AND tv.version=c.current_terms_version
    WHERE (p_state IS NULL OR c.state=p_state)
      AND (nullif(btrim(p_query),'') IS NULL OR g.title_public ILIKE '%'||btrim(p_query)||'%'
        OR b.name ILIKE '%'||btrim(p_query)||'%' OR p.display_name ILIKE '%'||btrim(p_query)||'%'
        OR c.id::text=btrim(p_query))
  ),'[]'::jsonb);
END;
$fn$;

-- 4. Retire budget levels ---------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_budget_band_save(text,text,bigint,bigint);
DROP TABLE IF EXISTS public.gig_budget_bands;
ALTER TABLE public.gigs DROP COLUMN budget_band;

COMMIT;
