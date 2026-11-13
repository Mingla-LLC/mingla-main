-- #4402 polish PR, migration M2: the minimum creator fee, changing an open
-- interest's price, and an honest reach count for the host.
--
-- WHY (spec comment 6855228971 on #4402; Seth's decisions D2, OQ-7, OQ-8):
--   * D2: the server refuses a creator fee below NGN 5,000 / USD 10 / EUR 10 /
--     GBP 10 (500000 / 1000 / 1000 / 1000 minor units) for the gig budget
--     (gig_save.pay_up_to_minor), offers (offer prepare fee_minor), counters
--     (gig_counter_send, and gig_counter_respond for counters already open)
--     and, per OQ-8, a creator's interest price. OQ-7: other currencies have
--     no minimum. Existing gigs are not rewritten; a new offer on a gig below
--     the minimum is refused until the host edits the budget. Closing or
--     cancelling such a gig is still allowed.
--     gig_change_proposal_save already refuses any fee_minor change (live
--     body), so it is not replaced.
--   * Offer prepare is replaced here once (spec section 5): the minimum fee,
--     plus the in-call retire of an unpaid offer now reopens the interest
--     like the sweep does.
--   * E31: a creator can change the price of an interest that is still open
--     ('sent' or 'shortlisted'); the status is kept.
--   * H18: gig_host_home says how many verified creators in the gig's city
--     can see the gig (an aggregate count only; no identities).
--
-- Every replaced function is copied from the production body and changed only
-- as the spec says.
-- Proof: __tests__/issue_4402_polish_min_fee_and_interest_edit.implementor.pg17.test.sql
BEGIN;
SET LOCAL lock_timeout = '10s';

CREATE OR REPLACE FUNCTION public.issue_4402_gig_min_fee_minor(p_currency text) RETURNS bigint
LANGUAGE sql IMMUTABLE SET search_path=public,pg_temp AS $fn$
  -- MINGLA-INVARIANT: I-4402-FEE-1 | issue #4402 | no gig budget, offer, counter or interest price below the currency minimum
  SELECT CASE upper(btrim(coalesce(p_currency,'')))
    WHEN 'NGN' THEN 500000::bigint
    WHEN 'USD' THEN 1000::bigint
    WHEN 'EUR' THEN 1000::bigint
    WHEN 'GBP' THEN 1000::bigint
    ELSE NULL END
$fn$;
REVOKE ALL ON FUNCTION public.issue_4402_gig_min_fee_minor(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4402_gig_min_fee_minor(text) TO service_role;

CREATE OR REPLACE FUNCTION public.issue_4402_gig_fee_below_minimum(p_amount bigint, p_currency text, p_field text) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path=public,pg_temp AS $fn$
  SELECT CASE WHEN public.issue_4402_gig_min_fee_minor(p_currency) IS NOT NULL AND p_amount IS NOT NULL
      AND p_amount<public.issue_4402_gig_min_fee_minor(p_currency)
    THEN jsonb_build_object('ok',false,'error','fee_below_minimum','field',p_field,
      'min_minor',public.issue_4402_gig_min_fee_minor(p_currency),'currency',upper(btrim(p_currency)))
    END
$fn$;
REVOKE ALL ON FUNCTION public.issue_4402_gig_fee_below_minimum(bigint,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4402_gig_fee_below_minimum(bigint,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.gig_save(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid:=auth.uid();
  v_uuid constant text:='^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_date constant text:='^[0-9]{4}-[0-9]{2}-[0-9]{2}$';
  v_int constant text:='^[0-9]{1,9}$';
  v_brand uuid; v_id uuid; v_existing public.gigs; v_hits text[];
  v_kind text; v_listing uuid; v_title text; v_brief text; v_private text; v_format text;
  v_deliverables jsonb; v_must_tag jsonb; v_city uuid; v_category text;
  v_start date; v_end date; v_post_by date; v_usage integer; v_pay bigint; v_currency text; v_below jsonb;
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
  -- Closing or cancelling a gig saved before pay existed keeps it as stored.
  IF nullif(p_payload->>'pay_up_to_minor','') IS NULL AND v_existing.id IS NOT NULL
     AND v_existing.pay_up_to_minor IS NULL
     AND coalesce(nullif(p_payload->>'status',''),'') IN ('closed','cancelled') THEN
    v_pay:=NULL;
  ELSIF coalesce(p_payload->>'pay_up_to_minor','')!~'^[0-9]{1,15}$' OR (p_payload->>'pay_up_to_minor')::bigint<=0 THEN
    RETURN jsonb_build_object('ok',false,'error','pay_required','field','pay_up_to_minor');
  ELSE
    v_pay:=(p_payload->>'pay_up_to_minor')::bigint;
  END IF;
  v_currency:=upper(btrim(coalesce(p_payload->>'currency','')));
  IF v_currency!~'^[A-Z]{3}$' THEN RETURN jsonb_build_object('ok',false,'error','currency_invalid','field','currency'); END IF;
  IF v_existing.id IS NOT NULL AND v_existing.currency<>v_currency THEN RETURN jsonb_build_object('ok',false,'error','currency_immutable','field','currency'); END IF;
  -- #4402 D2: the budget is at least the currency minimum, except when the
  -- save only closes or cancels the gig.
  IF coalesce(nullif(p_payload->>'status',''),'') NOT IN ('closed','cancelled') THEN
    v_below:=public.issue_4402_gig_fee_below_minimum(v_pay,v_currency,'pay_up_to_minor');
    IF v_below IS NOT NULL THEN RETURN v_below; END IF;
  END IF;
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
$function$;
REVOKE ALL ON FUNCTION public.gig_save(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gig_save(jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.issue_4216_gig_offer_prepare_impl(p_interest_id uuid, p_terms jsonb, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid:=auth.uid(); v_interest public.gig_interest; v_gig public.gigs; v_contract uuid;
  v_fee bigint; v_booking bigint; v_rail text; v_existing public.gig_holds; v_live public.gig_contracts;
  v_terms jsonb:=coalesce(CASE WHEN jsonb_typeof(p_terms)='object' THEN p_terms END,'{}'::jsonb);
  v_shoot date; v_post_by date; v_below jsonb;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='28000'; END IF;
  IF char_length(coalesce(p_idempotency_key,''))<8 THEN RETURN jsonb_build_object('ok',false,'error','idempotency_key_required'); END IF;
  SELECT * INTO v_existing FROM public.gig_holds WHERE idempotency_key=p_idempotency_key;
  IF FOUND THEN
    IF NOT EXISTS(SELECT 1 FROM public.gig_contracts c WHERE c.id=v_existing.contract_id AND public.issue_3872_gig_host_writer(c.brand_id,v_actor)) THEN RAISE EXCEPTION 'permission_denied' USING ERRCODE='42501'; END IF;
    SELECT t.fee_minor,t.booking_fee_minor INTO v_fee,v_booking FROM public.gig_terms_versions t WHERE t.contract_id=v_existing.contract_id AND t.version=v_existing.terms_version;
    RETURN jsonb_build_object('ok',true,'contract_id',v_existing.contract_id,'terms_version',v_existing.terms_version,'rail',v_existing.rail,'fee_minor',v_fee,'booking_fee_minor',v_booking,'total_minor',v_existing.amount_minor,'currency',v_existing.currency,'replayed',true);
  END IF;
  SELECT * INTO v_interest FROM public.gig_interest WHERE id=p_interest_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'interest_not_found' USING ERRCODE='P0002'; END IF;
  -- Lock the gig row so two concurrent offers cannot both see a free slot.
  SELECT * INTO v_gig FROM public.gigs WHERE id=v_interest.gig_id FOR UPDATE;
  IF NOT public.issue_3872_gig_host_writer(v_gig.brand_id,v_actor) THEN RAISE EXCEPTION 'permission_denied' USING ERRCODE='42501'; END IF;
  IF NOT public.issue_3872_creator_gigs_on(v_gig.brand_id) THEN RAISE EXCEPTION 'creator_gigs_disabled' USING ERRCODE='55000'; END IF;
  IF v_gig.status NOT IN ('open') THEN RETURN jsonb_build_object('ok',false,'error','gig_not_open'); END IF;

  SELECT * INTO v_live FROM public.gig_contracts c
   WHERE c.gig_id=v_gig.id AND c.creator_account_id=v_interest.creator_account_id
     AND c.state NOT IN ('declined','expired','cancelled','completed','resolved_release','resolved_partial','resolved_refund')
   FOR UPDATE;
  IF FOUND THEN
    -- A provider start that never completed leaves an unpaid offer the
    -- creator never saw. Retire it (no money moved) so the host can retry.
    IF v_live.state='offered' AND EXISTS(SELECT 1 FROM public.gig_holds h WHERE h.contract_id=v_live.id AND h.status='pending')
       AND NOT EXISTS(SELECT 1 FROM public.gig_holds h WHERE h.contract_id=v_live.id AND h.status<>'pending') THEN
      UPDATE public.gig_holds SET status='failed' WHERE contract_id=v_live.id AND status='pending';
      PERFORM public.issue_3872_contract_apply_state(v_live.id,'cancelled',NULL,NULL,NULL,'payment_not_completed');
      INSERT INTO public.gig_events(contract_id,actor,kind,data) VALUES(v_live.id,'system','offer_payment_abandoned','{}'::jsonb);
      -- #4402: the retired offer reopens the interest, as the sweep does.
      UPDATE public.gig_interest SET status='shortlisted',updated_at=now() WHERE id=v_interest.id AND status='offered';
    ELSE
      RETURN jsonb_build_object('ok',false,'error','already_offered');
    END IF;
  ELSIF v_interest.status NOT IN ('sent','shortlisted') THEN
    -- Withdrawn or passed interest cannot be offered.
    RETURN jsonb_build_object('ok',false,'error','interest_not_open');
  END IF;
  IF public.issue_3872_gig_slots_left(v_gig.id)<=0 THEN RETURN jsonb_build_object('ok',false,'error','gig_full'); END IF;

  IF nullif(v_terms->>'fee_minor','') IS NOT NULL AND v_terms->>'fee_minor'!~'^[0-9]{1,15}$' THEN
    RETURN jsonb_build_object('ok',false,'error','fee_invalid','field','fee_minor');
  END IF;
  v_fee:=coalesce(nullif(v_terms->>'fee_minor','')::bigint,v_interest.quoted_minor);
  IF v_fee IS NULL OR v_fee<=0 THEN RETURN jsonb_build_object('ok',false,'error','fee_invalid','field','fee_minor'); END IF;
  -- #4402 D2: the offered fee is at least the currency minimum.
  v_below:=public.issue_4402_gig_fee_below_minimum(v_fee,v_gig.currency,'fee_minor');
  IF v_below IS NOT NULL THEN RETURN v_below; END IF;
  BEGIN
    v_shoot:=nullif(v_terms->>'shoot_date','')::date;
    v_post_by:=coalesce(nullif(v_terms->>'post_by','')::date,v_gig.post_by);
  EXCEPTION WHEN others THEN RETURN jsonb_build_object('ok',false,'error','date_invalid','field','shoot_date');
  END;
  IF v_shoot IS NOT NULL AND v_shoot NOT BETWEEN v_gig.shoot_window_start AND v_gig.shoot_window_end THEN
    RETURN jsonb_build_object('ok',false,'error','shoot_outside_window','field','shoot_date');
  END IF;
  IF v_post_by<current_date THEN RETURN jsonb_build_object('ok',false,'error','post_by_in_past','field','post_by'); END IF;
  v_booking:=((v_fee*1500+5000)/10000); v_rail:=CASE WHEN v_gig.currency='NGN' THEN 'paystack' ELSE 'stripe' END;
  INSERT INTO public.gig_contracts(gig_id,brand_id,creator_account_id,state,state_deadline_at)
  VALUES(v_gig.id,v_gig.brand_id,v_interest.creator_account_id,'offered',now()+interval '48 hours') RETURNING id INTO v_contract;
  INSERT INTO public.gig_terms_versions(contract_id,version,fee_minor,booking_fee_minor,currency,format_key,deliverables,shoot_date,post_by,usage_days,sales_share_bps,shoot_passes,proposed_by)
  VALUES(v_contract,1,v_fee,v_booking,v_gig.currency,v_gig.format_key,
    CASE WHEN jsonb_typeof(v_terms->'deliverables')='array' THEN v_terms->'deliverables' ELSE v_gig.deliverables END,
    v_shoot,v_post_by,coalesce(nullif(v_terms->>'usage_days','')::integer,v_gig.usage_days),
    coalesce(nullif(v_terms->>'sales_share_bps','')::integer,v_gig.sales_share_bps),
    coalesce(nullif(v_terms->>'shoot_passes','')::integer,v_gig.shoot_passes),'host');
  INSERT INTO public.gig_holds(contract_id,terms_version,rail,amount_minor,currency,idempotency_key)
  VALUES(v_contract,1,v_rail,v_fee+v_booking,v_gig.currency,p_idempotency_key);
  UPDATE public.gig_interest SET status='offered' WHERE id=v_interest.id;
  INSERT INTO public.gig_events(contract_id,actor,kind,data) VALUES(v_contract,'host','offer_created',jsonb_build_object('terms_version',1,'amount_minor',v_fee+v_booking));
  RETURN jsonb_build_object('ok',true,'contract_id',v_contract,'terms_version',1,'rail',v_rail,'fee_minor',v_fee,'booking_fee_minor',v_booking,'total_minor',v_fee+v_booking,'currency',v_gig.currency);
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4216_gig_offer_prepare_impl(uuid,jsonb,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4216_gig_offer_prepare_impl(uuid,jsonb,text) TO service_role;

CREATE OR REPLACE FUNCTION public.gig_counter_send(p_contract_id uuid, p_fee_minor bigint, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_actor uuid:=auth.uid(); v public.gig_contracts; v_terms public.gig_terms_versions; v_gig public.gigs; v_hits text[]; v_id uuid; v_below jsonb;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='28000'; END IF;
  SELECT * INTO v FROM public.gig_contracts WHERE id=p_contract_id FOR UPDATE;
  IF NOT FOUND OR v.creator_account_id<>v_actor THEN RAISE EXCEPTION 'permission_denied' USING ERRCODE='42501'; END IF;
  IF v.state<>'offered' OR NOT public.issue_3872_offer_ready(v.id) THEN RETURN jsonb_build_object('ok',false,'error','counter_not_open'); END IF;
  IF p_fee_minor IS NULL OR p_fee_minor<=0 THEN RETURN jsonb_build_object('ok',false,'error','fee_invalid','field','fee_minor'); END IF;
  SELECT * INTO v_terms FROM public.gig_terms_versions WHERE contract_id=v.id AND version=v.current_terms_version;
  IF p_fee_minor=v_terms.fee_minor THEN RETURN jsonb_build_object('ok',false,'error','fee_unchanged','field','fee_minor'); END IF;
  -- #4402 D2
  v_below:=public.issue_4402_gig_fee_below_minimum(p_fee_minor,v_terms.currency,'fee_minor');
  IF v_below IS NOT NULL THEN RETURN v_below; END IF;
  IF char_length(btrim(coalesce(p_note,'')))>300 THEN RETURN jsonb_build_object('ok',false,'error','note_too_long','field','note'); END IF;
  SELECT * INTO v_gig FROM public.gigs WHERE id=v.gig_id;
  v_hits:=public.issue_3872_brief_lint(v_gig.brand_id,v_gig.listing_kind,v_gig.listing_id,coalesce(p_note,''));
  IF cardinality(v_hits)>0 THEN RETURN jsonb_build_object('ok',false,'error','note_not_anonymous','reasons',to_jsonb(v_hits),'field','note'); END IF;
  UPDATE public.gig_change_proposals SET status='expired' WHERE contract_id=v.id AND status='open' AND expires_at<=now();
  IF EXISTS(SELECT 1 FROM public.gig_change_proposals WHERE contract_id=v.id AND status='open') THEN
    RETURN jsonb_build_object('ok',false,'error','counter_already_open');
  END IF;
  INSERT INTO public.gig_change_proposals(contract_id,from_version,proposed_by,changes,reason,note,expires_at)
  VALUES(v.id,v.current_terms_version,'creator',jsonb_build_object('fee_minor',p_fee_minor),'price',nullif(btrim(p_note),''),
    least(now()+interval '48 hours',coalesce(v.state_deadline_at,now()+interval '48 hours')))
  RETURNING id INTO v_id;
  INSERT INTO public.gig_events(contract_id,actor,kind,data) VALUES(v.id,'creator','counter_sent',jsonb_build_object('proposal_id',v_id,'fee_minor',p_fee_minor,'from_version',v.current_terms_version));
  RETURN jsonb_build_object('ok',true,'proposal_id',v_id);
END;
$function$;
REVOKE ALL ON FUNCTION public.gig_counter_send(uuid,bigint,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gig_counter_send(uuid,bigint,text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.gig_counter_respond(p_proposal_id uuid, p_accept boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid:=auth.uid(); v_proposal public.gig_change_proposals; v public.gig_contracts; v_terms public.gig_terms_versions;
  v_hold public.gig_holds; v_fee bigint; v_booking bigint; v_old_total bigint; v_new_total bigint; v_next integer; v_below jsonb;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='28000'; END IF;
  SELECT * INTO v_proposal FROM public.gig_change_proposals WHERE id=p_proposal_id FOR UPDATE;
  IF NOT FOUND OR v_proposal.reason<>'price' OR v_proposal.proposed_by<>'creator' THEN RAISE EXCEPTION 'counter_not_found' USING ERRCODE='P0002'; END IF;
  SELECT * INTO v FROM public.gig_contracts WHERE id=v_proposal.contract_id FOR UPDATE;
  IF NOT public.issue_3872_gig_host_writer(v.brand_id,v_actor) THEN RAISE EXCEPTION 'permission_denied' USING ERRCODE='42501'; END IF;
  IF NOT public.issue_3872_creator_gigs_on(v.brand_id) THEN RAISE EXCEPTION 'creator_gigs_disabled' USING ERRCODE='55000'; END IF;
  IF v_proposal.status<>'open' OR v_proposal.expires_at<=now() OR v_proposal.from_version<>v.current_terms_version OR v.state<>'offered' THEN
    RETURN jsonb_build_object('ok',false,'error','counter_stale');
  END IF;
  IF NOT coalesce(p_accept,false) THEN
    UPDATE public.gig_change_proposals SET status='declined' WHERE id=v_proposal.id;
    INSERT INTO public.gig_events(contract_id,actor,kind,data) VALUES(v.id,'host','counter_declined',jsonb_build_object('proposal_id',v_proposal.id));
    RETURN jsonb_build_object('ok',true,'accepted',false,'terms_version',v.current_terms_version,'requires_topup',false,'topup_minor',0,'refund_minor',0);
  END IF;
  SELECT * INTO v_terms FROM public.gig_terms_versions WHERE contract_id=v.id AND version=v.current_terms_version;
  SELECT * INTO v_hold FROM public.gig_holds WHERE contract_id=v.id AND terms_version=v.current_terms_version FOR UPDATE;
  IF v_hold.status<>'captured' THEN RETURN jsonb_build_object('ok',false,'error','counter_stale'); END IF;
  v_fee:=(v_proposal.changes->>'fee_minor')::bigint;
  -- #4402 D2: a counter opened before the minimum existed cannot be accepted below it.
  v_below:=public.issue_4402_gig_fee_below_minimum(v_fee,v_terms.currency,'fee_minor');
  IF v_below IS NOT NULL THEN RETURN v_below; END IF;
  v_booking:=((v_fee*1500+5000)/10000);
  v_old_total:=v_terms.fee_minor+v_terms.booking_fee_minor;
  v_new_total:=v_fee+v_booking;
  v_next:=v.current_terms_version+1;
  INSERT INTO public.gig_terms_versions(contract_id,version,fee_minor,booking_fee_minor,currency,format_key,deliverables,shoot_date,post_by,usage_days,sales_share_bps,shoot_passes,proposed_by,accepted_at)
  VALUES(v.id,v_next,v_fee,v_booking,v_terms.currency,v_terms.format_key,v_terms.deliverables,v_terms.shoot_date,v_terms.post_by,v_terms.usage_days,v_terms.sales_share_bps,v_terms.shoot_passes,'creator',now());
  -- The captured base hold follows the current terms version, exactly like
  -- gig_change_proposal_respond. The difference lives in an adjustment row.
  UPDATE public.gig_holds SET terms_version=v_next WHERE id=v_hold.id;
  UPDATE public.gig_contracts SET current_terms_version=v_next,state_deadline_at=now()+interval '48 hours' WHERE id=v.id;
  IF v_new_total>v_old_total THEN
    INSERT INTO public.gig_hold_adjustments(contract_id,proposal_id,kind,terms_version,rail,amount_minor,currency)
    VALUES(v.id,v_proposal.id,'topup',v_next,v_hold.rail,v_new_total-v_old_total,v_hold.currency);
  ELSIF v_new_total<v_old_total THEN
    INSERT INTO public.gig_hold_adjustments(contract_id,proposal_id,kind,terms_version,rail,amount_minor,currency)
    VALUES(v.id,v_proposal.id,'refund',v_next,v_hold.rail,v_old_total-v_new_total,v_hold.currency);
  END IF;
  UPDATE public.gig_change_proposals SET status='accepted' WHERE id=v_proposal.id;
  INSERT INTO public.gig_events(contract_id,actor,kind,data) VALUES(v.id,'host','counter_accepted',jsonb_build_object('proposal_id',v_proposal.id,'version',v_next,'fee_minor',v_fee));
  RETURN jsonb_build_object('ok',true,'accepted',true,'terms_version',v_next,
    'requires_topup',v_new_total>v_old_total,'topup_minor',greatest(v_new_total-v_old_total,0),
    'refund_minor',greatest(v_old_total-v_new_total,0));
END;
$function$;
REVOKE ALL ON FUNCTION public.gig_counter_respond(uuid,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gig_counter_respond(uuid,boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.gig_interest_send(p_gig_id uuid, p_package_id uuid, p_quoted_minor bigint, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_actor uuid:=auth.uid(); v_gig public.gigs; v_hits text[]; v_existing public.gig_interest; v_below jsonb;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='28000'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.creator_profiles WHERE creator_account_id=v_actor AND verification='verified' AND mode_enabled) THEN
    RETURN jsonb_build_object('ok',false,'error','creator_not_ready');
  END IF;
  SELECT * INTO v_gig FROM public.gigs WHERE id=p_gig_id;
  IF NOT FOUND OR v_gig.status<>'open' OR v_gig.shoot_window_end<current_date
     OR NOT public.issue_3872_creator_gigs_on(v_gig.brand_id)
     OR (v_gig.visibility='invite_only' AND NOT EXISTS(SELECT 1 FROM public.gig_invites i WHERE i.gig_id=v_gig.id AND i.creator_account_id=v_actor)) THEN
    RETURN jsonb_build_object('ok',false,'error','gig_not_open');
  END IF;
  IF public.issue_3872_gig_slots_left(v_gig.id)=0 THEN RETURN jsonb_build_object('ok',false,'error','gig_full'); END IF;
  IF NOT EXISTS(SELECT 1 FROM public.creator_packages WHERE id=p_package_id AND creator_account_id=v_actor AND active) THEN
    RETURN jsonb_build_object('ok',false,'error','package_not_owned','field','package_id');
  END IF;
  IF p_quoted_minor IS NULL OR p_quoted_minor<=0 THEN RETURN jsonb_build_object('ok',false,'error','quote_invalid','field','quoted_minor'); END IF;
  -- #4402 OQ-8: the interest price is at least the currency minimum.
  v_below:=public.issue_4402_gig_fee_below_minimum(p_quoted_minor,v_gig.currency,'quoted_minor');
  IF v_below IS NOT NULL THEN RETURN v_below; END IF;
  IF char_length(btrim(coalesce(p_note,'')))>300 THEN RETURN jsonb_build_object('ok',false,'error','note_too_long','field','note'); END IF;
  v_hits:=public.issue_3872_brief_lint(v_gig.brand_id,v_gig.listing_kind,v_gig.listing_id,coalesce(p_note,''));
  IF cardinality(v_hits)>0 THEN RETURN jsonb_build_object('ok',false,'error','note_not_anonymous','reasons',to_jsonb(v_hits),'field','note'); END IF;
  IF (v_gig.currency='NGN' AND NOT EXISTS(SELECT 1 FROM public.payee_accounts WHERE user_id=v_actor AND paystack_status='verified'))
     OR (v_gig.currency<>'NGN' AND NOT EXISTS(SELECT 1 FROM public.payee_accounts WHERE user_id=v_actor AND stripe_status='active')) THEN
    RETURN jsonb_build_object('ok',false,'error','payout_rail_mismatch','currency',v_gig.currency);
  END IF;
  SELECT * INTO v_existing FROM public.gig_interest WHERE gig_id=p_gig_id AND creator_account_id=v_actor FOR UPDATE;
  -- #4402 E31: an open interest can change its price, package and note; it
  -- keeps its status. Offered or passed interest cannot change.
  IF FOUND AND v_existing.status IN ('sent','shortlisted') THEN
    UPDATE public.gig_interest SET package_id=p_package_id,quoted_minor=p_quoted_minor,note=nullif(btrim(p_note),''),updated_at=now()
     WHERE id=v_existing.id;
    RETURN jsonb_build_object('ok',true,'updated',true,'status',v_existing.status);
  END IF;
  IF FOUND AND v_existing.status<>'withdrawn' THEN RETURN jsonb_build_object('ok',false,'error','already_interested'); END IF;
  INSERT INTO public.gig_interest(gig_id,creator_account_id,package_id,quoted_minor,note) VALUES(p_gig_id,v_actor,p_package_id,p_quoted_minor,nullif(btrim(p_note),''))
  ON CONFLICT(gig_id,creator_account_id) DO UPDATE SET package_id=excluded.package_id,quoted_minor=excluded.quoted_minor,note=excluded.note,status='sent';
  RETURN jsonb_build_object('ok',true);
END;
$function$;
REVOKE ALL ON FUNCTION public.gig_interest_send(uuid,uuid,bigint,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gig_interest_send(uuid,uuid,bigint,text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.gig_host_home(p_brand_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE WHEN public.biz_is_brand_member_for_read(p_brand_id,auth.uid()) THEN jsonb_build_object(
    'gigs',coalesce((SELECT jsonb_agg(to_jsonb(g)||jsonb_build_object(
        'interest_count',(SELECT count(*) FROM public.gig_interest i WHERE i.gig_id=g.id AND i.status IN ('sent','shortlisted')
           AND NOT public.issue_3872_creator_hired_on_gig(g.id,i.creator_account_id)),
        'hired_count',(SELECT count(*) FROM public.gig_contracts x WHERE x.gig_id=g.id AND x.state NOT IN ('offered','declined','expired','cancelled','resolved_refund')),
        'slots_left',public.issue_3872_gig_slots_left(g.id),
        -- #4402 H18: how many verified creators in the gig's city can see it.
        'city_name',(SELECT sc.name FROM public.seeding_cities sc WHERE sc.id=g.city_id),
        'city_creator_count',(SELECT count(*) FROM public.creator_profiles cp
          WHERE cp.home_city_id=g.city_id AND cp.mode_enabled AND cp.verification='verified'),
        'min_fee_minor',public.issue_4402_gig_min_fee_minor(g.currency)
      ) ORDER BY g.updated_at DESC) FROM public.gigs g WHERE g.brand_id=p_brand_id),'[]'::jsonb),
    'contracts',coalesce((SELECT jsonb_agg(jsonb_build_object(
        'id',c.id,'gig_id',c.gig_id,'state',c.state,'deadline_at',c.state_deadline_at,'title',g.title_public,'creator',p.display_name,
        'video_due_at',coalesce(tv.video_due_at,g.video_due_at),'post_by',coalesce(tv.post_by,g.post_by),
        'due_at',CASE WHEN c.state IN ('approved','posting','posts_failed') THEN ((coalesce(tv.post_by,g.post_by)+1)::timestamp AT TIME ZONE 'UTC') ELSE c.state_deadline_at END,
        'needs_host',(c.state IN ('accepted','shoot_planned','script_sent','delivered')
            OR EXISTS(SELECT 1 FROM public.gig_change_proposals pr WHERE pr.contract_id=c.id AND pr.status='open' AND pr.proposed_by='creator')
            OR EXISTS(SELECT 1 FROM public.gig_hold_adjustments a WHERE a.contract_id=c.id AND a.kind='topup' AND a.status='pending')
            OR (c.state='offered' AND NOT EXISTS(SELECT 1 FROM public.gig_holds h WHERE h.contract_id=c.id AND h.status<>'pending'))),
        'payment_pending',(c.state='offered' AND NOT public.issue_3872_offer_ready(c.id)),
        'fee_minor',tv.fee_minor,'currency',tv.currency
      ) ORDER BY c.updated_at DESC)
      FROM public.gig_contracts c JOIN public.gigs g ON g.id=c.gig_id
      JOIN public.creator_profiles p ON p.creator_account_id=c.creator_account_id
      LEFT JOIN public.gig_terms_versions tv ON tv.contract_id=c.id AND tv.version=c.current_terms_version
      WHERE c.brand_id=p_brand_id AND c.cancel_reason IS DISTINCT FROM 'payment_not_completed'),'[]'::jsonb)
  ) ELSE NULL END;
$function$;
REVOKE ALL ON FUNCTION public.gig_host_home(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gig_host_home(uuid) TO authenticated, service_role;

COMMIT;
