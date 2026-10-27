-- #3872 R2 B4 — Host referral operations, promoter membership and reports.
--
-- Invariant I-3872-REFERRAL-WRITES-SERVER-OWNED (declared in its test suite): Offers, members and tracking links are mutated only through caller-bound SECURITY DEFINER functions invoked by reviewed edge functions or Ari.

BEGIN;
SET LOCAL lock_timeout = '10s';

CREATE OR REPLACE FUNCTION public.brand_referral_access(p_brand_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $fn$
  SELECT COALESCE(public.biz_brand_effective_rank(p_brand_id, auth.uid()), 0) >= 20
    AND public.issue_3872_referrals_on(p_brand_id)
$fn$;
REVOKE ALL ON FUNCTION public.brand_referral_access(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.brand_referral_access(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.issue_3872_referral_offer_json(p_offer_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT jsonb_build_object(
    'id', offer.id,
    'brand_id', offer.brand_id,
    'name', offer.name,
    'audience', offer.audience,
    'scope_kind', offer.scope_kind,
    'reward_kind', offer.reward_kind,
    'share_bps', offer.share_bps,
    'voucher_template', offer.voucher_template,
    'perk_text', offer.perk_text,
    'perk_threshold', offer.perk_threshold,
    'buyer_discount_id', offer.buyer_discount_id,
    'budget_minor', offer.budget_minor,
    'currency', offer.currency,
    'starts_at', offer.starts_at,
    'ends_at', offer.ends_at,
    'status', offer.status,
    'paused_reason', offer.paused_reason,
    'version', offer.version,
    'listings', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'listing_kind', scoped.listing_kind,
        'listing_id', scoped.listing_id
      ) ORDER BY scoped.listing_kind, scoped.listing_id)
      FROM public.referral_offer_listings scoped
      WHERE scoped.offer_id = offer.id
    ), '[]'::jsonb),
    'tiers', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', tier.id,
        'min_sales', tier.min_sales,
        'share_bps', tier.share_bps
      ) ORDER BY tier.min_sales)
      FROM public.referral_offer_tiers tier
      WHERE tier.offer_id = offer.id
    ), '[]'::jsonb),
    'member_count', (SELECT count(*) FROM public.referral_members member
      WHERE member.offer_id = offer.id AND member.status <> 'removed'),
    'sales_count', (SELECT count(*) FROM public.order_attributions attribution
      WHERE attribution.offer_id = offer.id AND attribution.rejected_reason IS NULL),
    'share_minor', COALESCE((SELECT sum(share.net_minor)
      FROM public.payee_shares share
      JOIN public.referral_members member ON member.id = share.member_id
      WHERE member.offer_id = offer.id), 0)
  )
  FROM public.referral_offers offer
  WHERE offer.id = p_offer_id AND offer.deleted_at IS NULL
$fn$;
REVOKE ALL ON FUNCTION public.issue_3872_referral_offer_json(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3872_referral_offer_json(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.brand_referral_offers(p_brand_id uuid)
RETURNS SETOF jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $fn$
BEGIN
  IF COALESCE(public.biz_brand_effective_rank(p_brand_id, auth.uid()), 0) < 20 THEN
    RAISE EXCEPTION 'insufficient_permission';
  END IF;
  IF NOT public.issue_3872_referrals_on(p_brand_id) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT public.issue_3872_referral_offer_json(offer.id)
  FROM public.referral_offers offer
  WHERE offer.brand_id = p_brand_id AND offer.deleted_at IS NULL
  ORDER BY offer.created_at DESC, offer.id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.brand_referral_offers(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.brand_referral_offers(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.issue_3872_referral_offer_write(
  p_actor uuid,
  p_action text,
  p_payload jsonb
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $fn$
DECLARE
  v_id uuid;
  v_brand uuid;
  v_rank integer;
  v_offer public.referral_offers%ROWTYPE;
  v_reward text;
  v_scope text;
  v_status text;
  v_item jsonb;
  v_tier_count integer;
BEGIN
  IF p_actor IS NULL OR p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'invalid_request';
  END IF;
  IF p_action NOT IN ('create','update','pause','resume','end','delete_draft') THEN
    RAISE EXCEPTION 'invalid_action';
  END IF;

  IF p_action = 'create' THEN
    v_brand := NULLIF(p_payload->>'brandId','')::uuid;
    v_reward := p_payload->>'rewardKind';
  ELSE
    v_id := NULLIF(p_payload->>'id','')::uuid;
    SELECT * INTO v_offer FROM public.referral_offers WHERE id = v_id FOR UPDATE;
    IF NOT FOUND OR v_offer.deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'offer_not_found';
    END IF;
    v_brand := v_offer.brand_id;
    v_reward := COALESCE(p_payload->>'rewardKind', v_offer.reward_kind);
    IF NULLIF(p_payload->>'brandId','')::uuid IS DISTINCT FROM v_brand THEN
      RAISE EXCEPTION 'offer_brand_immutable';
    END IF;
    IF (p_payload->>'version')::integer IS DISTINCT FROM v_offer.version THEN
      RAISE EXCEPTION 'version_conflict';
    END IF;
  END IF;

  v_rank := COALESCE(public.biz_brand_effective_rank(v_brand, p_actor), 0);
  IF v_rank < 20 OR (v_reward = 'cash' AND v_rank < 30) THEN
    RAISE EXCEPTION 'insufficient_permission';
  END IF;
  IF NOT public.issue_3872_referrals_on(v_brand) THEN
    RAISE EXCEPTION 'referrals_disabled';
  END IF;

  IF p_action IN ('pause','resume','end','delete_draft') THEN
    IF p_action = 'pause' THEN
      UPDATE public.referral_offers SET status='paused', paused_reason='host'
      WHERE id=v_id RETURNING * INTO v_offer;
    ELSIF p_action = 'resume' THEN
      UPDATE public.referral_offers SET status='active', paused_reason=NULL
      WHERE id=v_id AND status='paused' RETURNING * INTO v_offer;
      IF NOT FOUND THEN RAISE EXCEPTION 'offer_not_paused'; END IF;
    ELSIF p_action = 'end' THEN
      UPDATE public.referral_offers SET status='ended', paused_reason=NULL,
        ends_at=LEAST(COALESCE(ends_at,now()),now())
      WHERE id=v_id RETURNING * INTO v_offer;
    ELSE
      IF v_offer.status <> 'draft' THEN RAISE EXCEPTION 'delete_not_allowed'; END IF;
      UPDATE public.referral_offers SET deleted_at=now() WHERE id=v_id
      RETURNING * INTO v_offer;
    END IF;
    RETURN to_jsonb(v_offer);
  END IF;

  v_scope := p_payload->>'scopeKind';
  v_status := COALESCE(p_payload->>'status','active');
  IF v_scope NOT IN ('brand','listings') OR v_status NOT IN ('draft','active') THEN
    RAISE EXCEPTION 'invalid_request';
  END IF;
  IF jsonb_typeof(COALESCE(p_payload->'listings','[]'::jsonb)) <> 'array'
     OR jsonb_typeof(COALESCE(p_payload->'tiers','[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'invalid_request';
  END IF;
  v_tier_count := jsonb_array_length(COALESCE(p_payload->'tiers','[]'::jsonb));
  IF v_tier_count > 5 OR (v_reward <> 'cash' AND v_tier_count > 0) THEN
    RAISE EXCEPTION 'tiers_invalid';
  END IF;
  IF v_scope = 'listings' AND jsonb_array_length(COALESCE(p_payload->'listings','[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'scope_target_mismatch';
  END IF;
  IF v_scope = 'brand' AND jsonb_array_length(COALESCE(p_payload->'listings','[]'::jsonb)) > 0 THEN
    RAISE EXCEPTION 'scope_target_mismatch';
  END IF;

  IF p_action = 'create' THEN
    INSERT INTO public.referral_offers(
      brand_id,name,audience,scope_kind,reward_kind,share_bps,
      voucher_template,perk_text,perk_threshold,buyer_discount_id,budget_minor,
      currency,starts_at,ends_at,status,created_by
    ) VALUES (
      v_brand,btrim(p_payload->>'name'),p_payload->>'audience',v_scope,v_reward,
      NULLIF(p_payload->>'shareBps','')::integer,p_payload->'voucherTemplate',
      NULLIF(btrim(p_payload->>'perkText'),''),NULLIF(p_payload->>'perkThreshold','')::integer,
      NULLIF(p_payload->>'buyerDiscountId','')::uuid,NULLIF(p_payload->>'budgetMinor','')::bigint,
      upper(p_payload->>'currency'),COALESCE(NULLIF(p_payload->>'startsAt','')::timestamptz,now()),
      NULLIF(p_payload->>'endsAt','')::timestamptz,v_status,p_actor
    ) RETURNING * INTO v_offer;
    v_id := v_offer.id;
  ELSE
    UPDATE public.referral_offers SET
      name=btrim(p_payload->>'name'), audience=p_payload->>'audience', scope_kind=v_scope,
      reward_kind=v_reward, share_bps=NULLIF(p_payload->>'shareBps','')::integer,
      voucher_template=p_payload->'voucherTemplate', perk_text=NULLIF(btrim(p_payload->>'perkText'),''),
      perk_threshold=NULLIF(p_payload->>'perkThreshold','')::integer,
      buyer_discount_id=NULLIF(p_payload->>'buyerDiscountId','')::uuid,
      budget_minor=NULLIF(p_payload->>'budgetMinor','')::bigint,
      currency=upper(p_payload->>'currency'), starts_at=NULLIF(p_payload->>'startsAt','')::timestamptz,
      ends_at=NULLIF(p_payload->>'endsAt','')::timestamptz, status=v_status,
      paused_reason=NULL
    WHERE id=v_id RETURNING * INTO v_offer;
    DELETE FROM public.referral_offer_listings WHERE offer_id=v_id;
    DELETE FROM public.referral_offer_tiers WHERE offer_id=v_id;
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(COALESCE(p_payload->'listings','[]'::jsonb)) LOOP
    INSERT INTO public.referral_offer_listings(offer_id,listing_kind,listing_id)
    VALUES (v_id,v_item->>'listingKind',(v_item->>'listingId')::uuid);
  END LOOP;
  FOR v_item IN SELECT value FROM jsonb_array_elements(COALESCE(p_payload->'tiers','[]'::jsonb)) LOOP
    INSERT INTO public.referral_offer_tiers(offer_id,min_sales,share_bps)
    VALUES (v_id,(v_item->>'minSales')::integer,(v_item->>'shareBps')::integer);
  END LOOP;

  RETURN public.issue_3872_referral_offer_json(v_id);
END;
$fn$;
REVOKE ALL ON FUNCTION public.issue_3872_referral_offer_write(uuid,text,jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3872_referral_offer_write(uuid,text,jsonb)
  TO service_role;

CREATE OR REPLACE FUNCTION public.issue_3872_referral_member_invite(
  p_actor uuid,
  p_offer_id uuid,
  p_members jsonb,
  p_expires_at timestamptz
) RETURNS SETOF jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $fn$
DECLARE
  v_offer public.referral_offers%ROWTYPE;
  v_item jsonb;
  v_member public.referral_members%ROWTYPE;
BEGIN
  SELECT * INTO v_offer FROM public.referral_offers WHERE id=p_offer_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'offer_not_found'; END IF;
  IF COALESCE(public.biz_brand_effective_rank(v_offer.brand_id,p_actor),0)<20 THEN
    RAISE EXCEPTION 'insufficient_permission';
  END IF;
  IF v_offer.audience NOT IN ('invited','both') OR v_offer.status<>'active' THEN
    RAISE EXCEPTION 'offer_not_invitable';
  END IF;
  IF NOT public.issue_3872_referrals_on(v_offer.brand_id) THEN
    RAISE EXCEPTION 'referrals_disabled';
  END IF;
  IF jsonb_typeof(p_members)<>'array' OR jsonb_array_length(p_members) NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION 'invite_batch_invalid';
  END IF;
  IF p_expires_at<=now() OR p_expires_at>now()+interval '14 days 5 minutes' THEN
    RAISE EXCEPTION 'invite_expiry_invalid';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_members) LOOP
    IF lower(btrim(v_item->>'email')) !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
       OR (v_item->>'tokenHash') !~ '^[a-f0-9]{64}$'
       OR (v_item->>'linkSlug') !~ '^[a-z0-9]{8}$' THEN
      RAISE EXCEPTION 'invite_invalid';
    END IF;
    INSERT INTO public.referral_members(
      offer_id,brand_id,role,email_norm,display_name,link_slug,code,status,
      invited_by,invite_token_hash,invite_expires_at
    ) VALUES (
      p_offer_id,v_offer.brand_id,'promoter',lower(btrim(v_item->>'email')),
      left(COALESCE(NULLIF(btrim(v_item->>'displayName'),''),split_part(lower(btrim(v_item->>'email')),'@',1)),100),
      v_item->>'linkSlug',NULLIF(upper(btrim(v_item->>'code')),''),'invited',p_actor,
      v_item->>'tokenHash',p_expires_at
    )
    ON CONFLICT (offer_id,email_norm) WHERE email_norm IS NOT NULL AND status<>'removed'
    DO UPDATE SET invite_token_hash=EXCLUDED.invite_token_hash,
      invite_expires_at=EXCLUDED.invite_expires_at, invited_by=EXCLUDED.invited_by,
      display_name=EXCLUDED.display_name
    WHERE public.referral_members.status='invited'
    RETURNING * INTO v_member;
    IF NOT FOUND THEN RAISE EXCEPTION 'member_already_joined'; END IF;
    RETURN NEXT jsonb_build_object(
      'id',v_member.id,'email',v_member.email_norm,'display_name',v_member.display_name,
      'link_slug',v_member.link_slug,'code',v_member.code,'status',v_member.status
    );
  END LOOP;
END;
$fn$;
REVOKE ALL ON FUNCTION public.issue_3872_referral_member_invite(uuid,uuid,jsonb,timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3872_referral_member_invite(uuid,uuid,jsonb,timestamptz)
  TO service_role;

CREATE OR REPLACE FUNCTION public.issue_3872_referral_member_remove(
  p_actor uuid,
  p_member_id uuid
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $fn$
DECLARE v_member public.referral_members%ROWTYPE;
BEGIN
  SELECT * INTO v_member FROM public.referral_members WHERE id=p_member_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'member_not_found'; END IF;
  IF COALESCE(public.biz_brand_effective_rank(v_member.brand_id,p_actor),0)<20 THEN
    RAISE EXCEPTION 'insufficient_permission';
  END IF;
  UPDATE public.referral_members SET status='removed',removed_at=now()
  WHERE id=p_member_id RETURNING * INTO v_member;
  RETURN jsonb_build_object('id',v_member.id,'status',v_member.status,'removed_at',v_member.removed_at);
END;
$fn$;
REVOKE ALL ON FUNCTION public.issue_3872_referral_member_remove(uuid,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3872_referral_member_remove(uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.issue_3872_referral_invite_accept(
  p_actor uuid,
  p_email text,
  p_token_hash text
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $fn$
DECLARE v_member public.referral_members%ROWTYPE; v_offer public.referral_offers%ROWTYPE;
BEGIN
  SELECT * INTO v_member FROM public.referral_members
  WHERE invite_token_hash=p_token_hash FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'invite_not_found'; END IF;
  IF v_member.status<>'invited' OR v_member.invite_consumed_at IS NOT NULL THEN
    RAISE EXCEPTION 'invite_used';
  END IF;
  IF v_member.invite_expires_at<=now() THEN RAISE EXCEPTION 'invite_expired'; END IF;
  IF lower(btrim(p_email))<>v_member.email_norm THEN RAISE EXCEPTION 'invite_email_mismatch'; END IF;
  SELECT * INTO v_offer FROM public.referral_offers WHERE id=v_member.offer_id;
  IF NOT FOUND OR v_offer.status<>'active' OR NOT public.issue_3872_referrals_on(v_offer.brand_id) THEN
    RAISE EXCEPTION 'offer_unavailable';
  END IF;
  UPDATE public.referral_members SET user_id=p_actor,status='active',joined_at=now(),
    invite_consumed_at=now()
  WHERE id=v_member.id RETURNING * INTO v_member;
  RETURN jsonb_build_object('member_id',v_member.id,'offer_id',v_member.offer_id,
    'brand_id',v_member.brand_id,'status',v_member.status);
END;
$fn$;
REVOKE ALL ON FUNCTION public.issue_3872_referral_invite_accept(uuid,text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3872_referral_invite_accept(uuid,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.brand_referral_members(p_brand_id uuid,p_offer_id uuid DEFAULT NULL)
RETURNS SETOF jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $fn$
BEGIN
  IF COALESCE(public.biz_brand_effective_rank(p_brand_id,auth.uid()),0)<20 THEN
    RAISE EXCEPTION 'insufficient_permission';
  END IF;
  RETURN QUERY
  SELECT jsonb_build_object(
    'id',member.id,'offer_id',member.offer_id,'display_name',member.display_name,
    'email',member.email_norm,'link_slug',member.link_slug,'code',member.code,
    'status',member.status,'invited_at',member.created_at,'joined_at',member.joined_at,
    'sales_count',COALESCE(attribution.sales_count,0),
    'revenue_minor',COALESCE(attribution.revenue_minor,0),
    'owed_minor',COALESCE(share.owed_minor,0),
    'paid_minor',COALESCE(share.paid_minor,0),
    'currency',offer.currency,
    'activity',COALESCE(activity.items,'[]'::jsonb)
  )
  FROM public.referral_members member
  JOIN public.referral_offers offer ON offer.id=member.offer_id
  LEFT JOIN LATERAL (
    SELECT count(*) AS sales_count,COALESCE(sum(a.eligible_minor),0) AS revenue_minor
    FROM public.order_attributions a
    WHERE a.member_id=member.id AND a.rejected_reason IS NULL
  ) attribution ON true
  LEFT JOIN LATERAL (
    SELECT COALESCE(sum(s.net_minor-s.reversed_minor),0) AS owed_minor,
      COALESCE(sum(s.net_minor) FILTER (WHERE s.status='paid'),0) AS paid_minor
    FROM public.payee_shares s WHERE s.member_id=member.id
  ) share ON true
  LEFT JOIN LATERAL (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'kind','sale',
      'happened_at',recent.created_at,
      'order_kind',recent.order_kind,
      'order_id',recent.order_id,
      'eligible_minor',recent.eligible_minor,
      'share_minor',recent.share_minor,
      'status',COALESCE(recent.rejected_reason,'attributed')
    ) ORDER BY recent.created_at DESC),'[]'::jsonb) AS items
    FROM (
      SELECT a.created_at,a.order_kind,a.order_id,a.eligible_minor,a.share_minor,
        a.rejected_reason
      FROM public.order_attributions a
      WHERE a.member_id=member.id
      ORDER BY a.created_at DESC
      LIMIT 20
    ) recent
  ) activity ON true
  WHERE member.brand_id=p_brand_id AND (p_offer_id IS NULL OR member.offer_id=p_offer_id)
  ORDER BY member.created_at DESC;
END;
$fn$;
REVOKE ALL ON FUNCTION public.brand_referral_members(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.brand_referral_members(uuid,uuid) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.issue_3872_tracking_link_write(
  p_actor uuid,p_action text,p_payload jsonb
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=public,auth,pg_temp
AS $fn$
DECLARE v_brand uuid; v_id uuid; v_row public.host_tracking_links%ROWTYPE;
BEGIN
  IF p_action NOT IN ('create','archive') THEN RAISE EXCEPTION 'invalid_action'; END IF;
  IF p_action='create' THEN
    v_brand:=(p_payload->>'brandId')::uuid;
  ELSE
    v_id:=(p_payload->>'id')::uuid;
    SELECT * INTO v_row FROM public.host_tracking_links WHERE id=v_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'tracking_link_not_found'; END IF;
    v_brand:=v_row.brand_id;
  END IF;
  IF COALESCE(public.biz_brand_effective_rank(v_brand,p_actor),0)<20 THEN
    RAISE EXCEPTION 'insufficient_permission';
  END IF;
  IF NOT public.issue_3872_referrals_on(v_brand) THEN RAISE EXCEPTION 'referrals_disabled'; END IF;
  IF p_action='archive' THEN
    UPDATE public.host_tracking_links SET archived_at=COALESCE(archived_at,now()) WHERE id=v_id RETURNING * INTO v_row;
  ELSE
    INSERT INTO public.host_tracking_links(brand_id,listing_kind,listing_id,label,slug,created_by)
    VALUES(v_brand,NULLIF(p_payload->>'listingKind',''),NULLIF(p_payload->>'listingId','')::uuid,
      btrim(p_payload->>'label'),lower(btrim(p_payload->>'slug')),p_actor)
    RETURNING * INTO v_row;
  END IF;
  RETURN to_jsonb(v_row);
END;
$fn$;
REVOKE ALL ON FUNCTION public.issue_3872_tracking_link_write(uuid,text,jsonb)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3872_tracking_link_write(uuid,text,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.brand_tracking_links(p_brand_id uuid)
RETURNS SETOF jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=public,auth,pg_temp
AS $fn$
BEGIN
  IF COALESCE(public.biz_brand_effective_rank(p_brand_id,auth.uid()),0)<20 THEN
    RAISE EXCEPTION 'insufficient_permission';
  END IF;
  IF NOT public.issue_3872_referrals_on(p_brand_id) THEN RETURN; END IF;
  RETURN QUERY
  SELECT jsonb_build_object(
    'id',link.id,'label',link.label,'slug',link.slug,
    'listing_kind',link.listing_kind,'listing_id',link.listing_id,
    'created_at',link.created_at,'archived_at',link.archived_at,
    'touch_count',COALESCE(touches.touch_count,0),
    'order_count',COALESCE(orders.order_count,0),
    'revenue_minor',COALESCE(orders.revenue_minor,0)
  )
  FROM public.host_tracking_links link
  LEFT JOIN LATERAL (
    SELECT count(*) AS touch_count FROM public.attribution_touches touch
    WHERE touch.tracking_id=link.id
  ) touches ON true
  LEFT JOIN LATERAL (
    SELECT count(*) FILTER (WHERE attribution.rejected_reason IS NULL) AS order_count,
      COALESCE(sum(attribution.eligible_minor)
        FILTER (WHERE attribution.rejected_reason IS NULL),0) AS revenue_minor
    FROM public.order_attributions attribution
    WHERE attribution.tracking_id=link.id
  ) orders ON true
  WHERE link.brand_id=p_brand_id
  ORDER BY link.created_at DESC,link.id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.brand_tracking_links(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.brand_tracking_links(uuid) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.brand_referral_report(
  p_brand_id uuid,p_from timestamptz,p_to timestamptz,p_offer_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=public,auth,pg_temp
AS $fn$
DECLARE v_result jsonb;
BEGIN
  IF COALESCE(public.biz_brand_effective_rank(p_brand_id,auth.uid()),0)<20 THEN
    RAISE EXCEPTION 'insufficient_permission';
  END IF;
  IF p_to<=p_from OR p_to>p_from+interval '370 days' THEN RAISE EXCEPTION 'window_invalid'; END IF;
  SELECT jsonb_build_object(
    'orders',count(*) FILTER (WHERE attribution.rejected_reason IS NULL),
    'revenueMinor',COALESCE(sum(attribution.eligible_minor) FILTER (WHERE attribution.rejected_reason IS NULL),0),
    'shareMinor',COALESCE(sum(share.net_minor),0),
    'paidMinor',COALESCE(sum(share.net_minor) FILTER (WHERE share.status='paid'),0),
    'reversedMinor',COALESCE(sum(share.reversed_minor),0),
    'people',COALESCE(jsonb_agg(DISTINCT jsonb_build_object(
      'memberId',member.id,'name',member.display_name,'role',member.role
    )) FILTER (WHERE member.id IS NOT NULL),'[]'::jsonb)
  ) INTO v_result
  FROM public.order_attributions attribution
  LEFT JOIN public.referral_members member ON member.id=attribution.member_id
  LEFT JOIN public.payee_shares share ON share.order_kind=attribution.order_kind
    AND share.order_id=attribution.order_id AND share.payee_kind='referral'
  WHERE attribution.brand_id=p_brand_id AND attribution.created_at>=p_from
    AND attribution.created_at<p_to AND (p_offer_id IS NULL OR attribution.offer_id=p_offer_id);
  RETURN v_result;
END;
$fn$;
REVOKE ALL ON FUNCTION public.brand_referral_report(uuid,timestamptz,timestamptz,uuid)
  FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.brand_referral_report(uuid,timestamptz,timestamptz,uuid)
  TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.my_promoting_offers()
RETURNS SETOF jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=public,auth,pg_temp
AS $fn$
  SELECT jsonb_build_object(
    'memberId',member.id,'offerId',offer.id,'brandId',offer.brand_id,
    'brandName',brand.name,'offerName',offer.name,'rewardKind',offer.reward_kind,
    'shareBps',offer.share_bps,'perkText',offer.perk_text,
    'perkThreshold',offer.perk_threshold,'currency',offer.currency,
    'linkSlug',member.link_slug,'code',member.code,'status',member.status,
    'salesCount',COALESCE(attribution.sales_count,0),
    'earnedMinor',COALESCE(share.earned_minor,0),
    'paidMinor',COALESCE(share.paid_minor,0)
  )
  FROM public.referral_members member
  JOIN public.referral_offers offer ON offer.id=member.offer_id
  JOIN public.brands brand ON brand.id=offer.brand_id
  LEFT JOIN LATERAL (
    SELECT count(*) AS sales_count FROM public.order_attributions a
    WHERE a.member_id=member.id AND a.rejected_reason IS NULL
  ) attribution ON true
  LEFT JOIN LATERAL (
    SELECT COALESCE(sum(s.net_minor-s.reversed_minor),0) AS earned_minor,
      COALESCE(sum(s.net_minor) FILTER (WHERE s.status='paid'),0) AS paid_minor
    FROM public.payee_shares s WHERE s.member_id=member.id
  ) share ON true
  WHERE member.user_id=auth.uid() AND member.role='promoter' AND member.status='active'
    AND offer.deleted_at IS NULL
  ORDER BY brand.name,offer.name
$fn$;
REVOKE ALL ON FUNCTION public.my_promoting_offers() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.my_promoting_offers() TO authenticated,service_role;

-- Referral notifications reuse the governed notification outbox. Copy stays in
-- payload so the generic renderer never fabricates an amount, offer or state.
INSERT INTO public.notification_categories(
  key,section,is_transactional,urgency,default_channels,reach_mode,active
)
SELECT key,'referrals',true,urgency,ARRAY['inapp','push']::text[],'reach_once',true
FROM (VALUES
  ('business.referral.sale','normal'),
  ('business.referral.budget_80','normal'),
  ('business.referral.budget_reached','high'),
  ('business.referral.member_joined','normal'),
  ('business.referral.flagged','high'),
  ('creator.referral.invite','normal'),
  ('creator.referral.sale','normal'),
  ('creator.referral.tier_up','normal'),
  ('creator.referral.paid','normal'),
  ('creator.referral.payout_failed','high'),
  ('creator.referral.reversed','high'),
  ('consumer.referral.earned','normal'),
  ('consumer.referral.paid','normal'),
  ('consumer.referral.voucher','normal'),
  ('consumer.referral.claim','normal'),
  ('consumer.referral.payout_account_needed','high')
) category(key,urgency)
ON CONFLICT (key) DO UPDATE SET active=true;

CREATE OR REPLACE FUNCTION public.issue_3872_enqueue_brand_referral_notice(
  p_brand_id uuid,p_type text,p_marker text,p_title text,p_body text,p_payload jsonb DEFAULT '{}'::jsonb
) RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path=public,pg_temp
AS $fn$
  INSERT INTO public.notification_outbox(
    category_key,user_id,brand_id,country_code,payload,idempotency_key,status
  )
  SELECT p_type,member.user_id,p_brand_id,NULL,
    COALESCE(p_payload,'{}'::jsonb)||jsonb_build_object(
      'title',p_title,'body',p_body,
      'deep_link','mingla-business://brand/'||p_brand_id::text||'/referrals'
    ),
    p_type||':'||p_marker||':'||member.user_id::text,'pending'
  FROM public.brand_team_members member
  WHERE member.brand_id=p_brand_id AND member.accepted_at IS NOT NULL
    AND member.removed_at IS NULL
  ON CONFLICT(idempotency_key) DO NOTHING
$fn$;
REVOKE ALL ON FUNCTION public.issue_3872_enqueue_brand_referral_notice(uuid,text,text,text,text,jsonb)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3872_enqueue_brand_referral_notice(uuid,text,text,text,text,jsonb)
  TO service_role;

CREATE OR REPLACE FUNCTION public.issue_3872_referral_member_notice()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,pg_temp
AS $fn$
DECLARE v_offer_name text;
BEGIN
  IF OLD.status='invited' AND NEW.status='active' THEN
    SELECT name INTO v_offer_name FROM public.referral_offers WHERE id=NEW.offer_id;
    PERFORM public.issue_3872_enqueue_brand_referral_notice(
      NEW.brand_id,'business.referral.member_joined',NEW.id::text,
      'A promoter joined',NEW.display_name||' accepted '||COALESCE(v_offer_name,'your referral offer')||'.',
      jsonb_build_object('member_id',NEW.id,'offer_id',NEW.offer_id)
    );
  END IF;
  RETURN NEW;
END;
$fn$;
DROP TRIGGER IF EXISTS issue_3872_referral_member_notice_trigger ON public.referral_members;
CREATE TRIGGER issue_3872_referral_member_notice_trigger
AFTER UPDATE OF status ON public.referral_members
FOR EACH ROW EXECUTE FUNCTION public.issue_3872_referral_member_notice();

CREATE OR REPLACE FUNCTION public.issue_3872_referral_attribution_notice()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,pg_temp
AS $fn$
BEGIN
  IF NEW.rejected_reason IS NOT NULL AND NEW.offer_id IS NOT NULL THEN
    PERFORM public.issue_3872_enqueue_brand_referral_notice(
      NEW.brand_id,'business.referral.flagged',NEW.order_kind||':'||NEW.order_id::text,
      'Referral needs attention','A referral was not credited because '||replace(NEW.rejected_reason,'_',' ')||'.',
      jsonb_build_object('offer_id',NEW.offer_id,'reason',NEW.rejected_reason)
    );
  END IF;
  RETURN NEW;
END;
$fn$;
DROP TRIGGER IF EXISTS issue_3872_referral_attribution_notice_trigger ON public.order_attributions;
CREATE TRIGGER issue_3872_referral_attribution_notice_trigger
AFTER INSERT ON public.order_attributions
FOR EACH ROW EXECUTE FUNCTION public.issue_3872_referral_attribution_notice();

CREATE OR REPLACE FUNCTION public.issue_3872_referral_share_notice()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,pg_temp
AS $fn$
DECLARE
  v_member public.referral_members%ROWTYPE;
  v_offer public.referral_offers%ROWTYPE;
  v_before bigint;
  v_after bigint;
  v_type text;
  v_sales integer;
  v_tier_bps integer;
BEGIN
  SELECT * INTO v_member FROM public.referral_members WHERE id=NEW.member_id;
  SELECT * INTO v_offer FROM public.referral_offers WHERE id=v_member.offer_id;
  IF TG_OP='INSERT' THEN
    PERFORM public.issue_3872_enqueue_brand_referral_notice(
      NEW.brand_id,'business.referral.sale',NEW.id::text,
      'A referral made a sale',v_member.display_name||' earned a reward from '||v_offer.name||'.',
      jsonb_build_object('share_id',NEW.id,'member_id',NEW.member_id,'offer_id',v_offer.id,
        'amount_cents',NEW.net_minor,'currency',NEW.currency)
    );
    IF v_member.user_id IS NOT NULL THEN
      v_type:=CASE WHEN v_member.role='buyer' THEN 'consumer.referral.earned' ELSE 'creator.referral.sale' END;
      INSERT INTO public.notification_outbox(category_key,user_id,brand_id,payload,idempotency_key,status)
      VALUES(v_type,v_member.user_id,NEW.brand_id,jsonb_build_object(
        'title','You earned a referral reward','body','Your eligible referral to '||v_offer.name||' earned a reward.',
        'share_id',NEW.id,'amount_cents',NEW.net_minor,'currency',NEW.currency,
        'deep_link','mingla://earnings'
      ),v_type||':'||NEW.id::text,'pending') ON CONFLICT(idempotency_key) DO NOTHING;
      IF v_member.role='buyer' AND NOT EXISTS (
        SELECT 1 FROM public.payee_accounts account
        WHERE account.user_id=v_member.user_id
          AND (account.stripe_status='active' OR account.paystack_status='verified')
      ) THEN
        INSERT INTO public.notification_outbox(category_key,user_id,brand_id,payload,idempotency_key,status)
        VALUES('consumer.referral.payout_account_needed',v_member.user_id,NEW.brand_id,
          jsonb_build_object('title','Connect an account to get paid',
            'body','Your referral reward is safe. Connect a payout account so Mingla can send it automatically.',
            'share_id',NEW.id,'deep_link','mingla://earnings/payout-account'),
          'consumer.referral.payout_account_needed:'||v_member.user_id::text,'pending')
        ON CONFLICT(idempotency_key) DO NOTHING;
      END IF;
      SELECT count(*) INTO v_sales FROM public.order_attributions attribution
      WHERE attribution.member_id=v_member.id AND attribution.rejected_reason IS NULL;
      SELECT tier.share_bps INTO v_tier_bps FROM public.referral_offer_tiers tier
      WHERE tier.offer_id=v_offer.id AND tier.min_sales=v_sales;
      IF FOUND AND v_member.role<>'buyer' THEN
        INSERT INTO public.notification_outbox(category_key,user_id,brand_id,payload,idempotency_key,status)
        VALUES('creator.referral.tier_up',v_member.user_id,NEW.brand_id,
          jsonb_build_object('title','Your referral rate went up',
            'body','You reached '||v_sales::text||' sales and unlocked a '||(v_tier_bps::numeric/100)::text||'% reward rate.',
            'offer_id',v_offer.id,'share_bps',v_tier_bps,'deep_link','mingla-business://promoting'),
          'creator.referral.tier_up:'||v_member.id::text||':'||v_sales::text,'pending')
        ON CONFLICT(idempotency_key) DO NOTHING;
      END IF;
    END IF;
    IF v_offer.budget_minor IS NOT NULL THEN
      SELECT COALESCE(sum(gross_minor),0)-NEW.gross_minor INTO v_before
      FROM public.payee_shares share
      JOIN public.referral_members member ON member.id=share.member_id
      WHERE member.offer_id=v_offer.id;
      v_after:=v_before+NEW.gross_minor;
      IF v_before*100<v_offer.budget_minor*80 AND v_after*100>=v_offer.budget_minor*80 THEN
        PERFORM public.issue_3872_enqueue_brand_referral_notice(
          NEW.brand_id,'business.referral.budget_80',v_offer.id::text,
          'Referral budget is 80% used',v_offer.name||' is close to its reward budget.',
          jsonb_build_object('offer_id',v_offer.id,'budget_minor',v_offer.budget_minor,'spent_minor',v_after)
        );
      END IF;
      IF v_before<v_offer.budget_minor AND v_after>=v_offer.budget_minor THEN
        PERFORM public.issue_3872_enqueue_brand_referral_notice(
          NEW.brand_id,'business.referral.budget_reached',v_offer.id::text,
          'Referral budget reached',v_offer.name||' has stopped earning new rewards.',
          jsonb_build_object('offer_id',v_offer.id,'budget_minor',v_offer.budget_minor)
        );
      END IF;
    END IF;
  ELSIF NEW.reversed_minor>OLD.reversed_minor AND v_member.user_id IS NOT NULL THEN
    v_type:=CASE WHEN v_member.role='buyer' THEN 'consumer.referral.claim' ELSE 'creator.referral.reversed' END;
    INSERT INTO public.notification_outbox(category_key,user_id,brand_id,payload,idempotency_key,status)
    VALUES(v_type,v_member.user_id,NEW.brand_id,jsonb_build_object(
      'title','Referral reward adjusted','body','A refund or dispute changed one of your referral rewards.',
      'share_id',NEW.id,'amount_cents',NEW.reversed_minor-OLD.reversed_minor,'currency',NEW.currency,
      'deep_link','mingla://earnings'
    ),v_type||':'||NEW.id::text||':'||NEW.reversed_minor::text,'pending')
    ON CONFLICT(idempotency_key) DO NOTHING;
  ELSIF NEW.status='paid' AND OLD.status IS DISTINCT FROM 'paid' AND v_member.user_id IS NOT NULL THEN
    v_type:=CASE WHEN v_member.role='buyer' THEN 'consumer.referral.paid' ELSE 'creator.referral.paid' END;
    INSERT INTO public.notification_outbox(category_key,user_id,brand_id,payload,idempotency_key,status)
    VALUES(v_type,v_member.user_id,NEW.brand_id,jsonb_build_object(
      'title','Referral payout sent','body','Your referral payout is on its way to your connected account.',
      'share_id',NEW.id,'amount_cents',NEW.net_minor-NEW.reversed_minor,'currency',NEW.currency,
      'deep_link','mingla://earnings'
    ),v_type||':'||NEW.id::text,'pending') ON CONFLICT(idempotency_key) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$fn$;
DROP TRIGGER IF EXISTS issue_3872_referral_share_notice_trigger ON public.payee_shares;
CREATE TRIGGER issue_3872_referral_share_notice_trigger
AFTER INSERT OR UPDATE OF status,reversed_minor ON public.payee_shares
FOR EACH ROW EXECUTE FUNCTION public.issue_3872_referral_share_notice();

CREATE OR REPLACE FUNCTION public.issue_3872_referral_voucher_notice()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,pg_temp
AS $fn$
DECLARE v_user uuid;
BEGIN
  v_user:=COALESCE(NEW.grantee_user_id,(SELECT user_id FROM public.referral_members WHERE id=NEW.member_id));
  IF v_user IS NOT NULL THEN
    INSERT INTO public.notification_outbox(category_key,user_id,brand_id,payload,idempotency_key,status)
    VALUES('consumer.referral.voucher',v_user,NEW.brand_id,jsonb_build_object(
      'title','You unlocked a referral voucher','body','Your referral voucher is ready for a future eligible order.',
      'grant_id',NEW.id,'discount_id',NEW.discount_id,'expires_at',NEW.expires_at,
      'deep_link','mingla://earnings'
    ),'consumer.referral.voucher:'||NEW.id::text,'pending') ON CONFLICT(idempotency_key) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$fn$;
DROP TRIGGER IF EXISTS issue_3872_referral_voucher_notice_trigger ON public.discount_grants;
CREATE TRIGGER issue_3872_referral_voucher_notice_trigger
AFTER INSERT ON public.discount_grants
FOR EACH ROW EXECUTE FUNCTION public.issue_3872_referral_voucher_notice();

CREATE OR REPLACE FUNCTION public.issue_3872_referral_payout_notice()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,pg_temp
AS $fn$
BEGIN
  IF NEW.status IN ('failed','reversed') AND NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.notification_outbox(category_key,user_id,brand_id,payload,idempotency_key,status)
    SELECT 'creator.referral.payout_failed',NEW.payee_user_id,share.brand_id,
      jsonb_build_object('title','Referral payout needs attention',
        'body','Mingla could not complete a referral payout. Check your payout account.',
        'payout_id',NEW.id,'failure_code',NEW.failure_code,'deep_link','mingla-business://promoting'),
      'creator.referral.payout_failed:'||NEW.id::text,'pending'
    FROM public.payee_shares share
    JOIN public.referral_members member ON member.id=share.member_id
    WHERE share.payout_id=NEW.id AND member.role<>'buyer'
    LIMIT 1 ON CONFLICT(idempotency_key) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$fn$;
DROP TRIGGER IF EXISTS issue_3872_referral_payout_notice_trigger ON public.payee_payouts;
CREATE TRIGGER issue_3872_referral_payout_notice_trigger
AFTER UPDATE OF status ON public.payee_payouts
FOR EACH ROW EXECUTE FUNCTION public.issue_3872_referral_payout_notice();

ALTER TABLE public.business_notification_type_preferences
  DROP CONSTRAINT IF EXISTS business_notification_type_preferences_type_check;
ALTER TABLE public.business_notification_type_preferences
  ADD CONSTRAINT business_notification_type_preferences_type_check CHECK (type IN (
    'business.order_paid','business.event_sold_out','business.low_inventory',
    'business.refund_processed','business.dispute_opened','business.dispute_action_needed',
    'business.payout_paid','business.payout_failed','business.payout_waiting_for_bank',
    'business.payouts_paused','business.payouts_resumed','business.account_status_changed',
    'business.new_review','business.claim_decision','business.team_member_joined',
    'business.discount_limit_80','business.discount_ended','business.discount_needs_attention',
    'business.referral.sale','business.referral.budget_80','business.referral.budget_reached',
    'business.referral.member_joined','business.referral.flagged',
    'creator.referral.invite','creator.referral.sale','creator.referral.tier_up',
    'creator.referral.paid','creator.referral.payout_failed','creator.referral.reversed'
  ));

NOTIFY pgrst,'reload schema';
COMMIT;
