-- #3872 R2 B5 — buyer referral wallet, personal links, shared-by privacy and guest claims.
--
-- MINGLA-INVARIANT: I-3872-EARNINGS-IS-NOT-BALANCE | issue #3872 | Explorer reports immutable reward obligations by lifecycle state; no stored-value balance or withdrawal RPC exists.
-- MINGLA-INVARIANT: I-3872-SHARER-ALLOWLIST | issue #3872 | Public share attribution exposes only the sharer's first name and avatar after an explicit show_sharer choice.
-- MINGLA-INVARIANT: I-3872-CLAIM-EMAIL-MATCH | issue #3872 | Guest rewards can be claimed only by an authenticated user whose normalized auth email equals the hashed claim token's email.

BEGIN;
SET LOCAL lock_timeout = '10s';

ALTER TABLE public.content_share_links
  ADD COLUMN sharer_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN show_sharer boolean NOT NULL DEFAULT false;

ALTER TABLE public.referral_members
  ADD COLUMN last_listing_kind text CHECK (
    last_listing_kind IS NULL OR last_listing_kind IN ('event','venue')
  ),
  ADD COLUMN last_listing_id uuid;
ALTER TABLE public.referral_members
  ADD CONSTRAINT referral_members_last_listing_shape CHECK (
    (last_listing_kind IS NULL)=(last_listing_id IS NULL)
  );

ALTER TABLE public.content_share_links
  ADD CONSTRAINT content_share_links_sharer_visibility_shape CHECK (
    NOT show_sharer OR sharer_user_id IS NOT NULL
  );
CREATE INDEX content_share_links_sharer_idx
  ON public.content_share_links(sharer_user_id,created_at DESC)
  WHERE sharer_user_id IS NOT NULL AND state='active';

CREATE TABLE public.payee_claim_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_norm text NOT NULL CHECK (
    email_norm=lower(btrim(email_norm)) AND position('@' in email_norm)>1
  ),
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  claimed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payee_claim_tokens_window CHECK (expires_at>created_at),
  CONSTRAINT payee_claim_tokens_consumed_shape CHECK (
    (consumed_at IS NULL)=(claimed_by IS NULL)
  )
);
CREATE INDEX payee_claim_tokens_email_live_idx
  ON public.payee_claim_tokens(email_norm,expires_at DESC)
  WHERE consumed_at IS NULL;

ALTER TABLE public.payee_claim_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payee_claim_tokens FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.payee_claim_tokens FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.payee_claim_tokens TO service_role;

CREATE OR REPLACE FUNCTION public.issue_3872_my_earnings_summary()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=public,pg_temp
AS $fn$
DECLARE
  v_actor uuid:=auth.uid();
  v_totals jsonb;
  v_shares jsonb;
  v_vouchers jsonb;
  v_perks jsonb;
  v_links jsonb;
  v_account jsonb;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;

  SELECT COALESCE(jsonb_object_agg(currency,jsonb_build_object(
    'onWayMinor',on_way_minor,
    'readyMinor',ready_minor,
    'paidMinor',paid_minor,
    'reversedMinor',reversed_minor
  )),'{}'::jsonb) INTO v_totals
  FROM (
    SELECT currency,
      COALESCE(sum(net_minor-reversed_minor) FILTER (
        WHERE status IN ('pending','held_until_event')
      ),0) on_way_minor,
      COALESCE(sum(net_minor-reversed_minor) FILTER (
        WHERE status IN ('releasable','accumulating')
      ),0) ready_minor,
      COALESCE(sum(net_minor-reversed_minor) FILTER (WHERE status='paid'),0) paid_minor,
      COALESCE(sum(reversed_minor),0) reversed_minor
    FROM public.payee_shares
    WHERE payee_user_id=v_actor
    GROUP BY currency
  ) amounts;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id',s.id,'orderKind',s.order_kind,'orderId',s.order_id,
    'listingName',COALESCE(e.title,v.name,b.name,'Mingla purchase'),
    'earnedAt',s.created_at,'releaseAfter',s.release_after,
    'amountMinor',greatest(s.net_minor-s.reversed_minor,0),
    'grossMinor',s.gross_minor,'feeMinor',s.mingla_fee_minor,
    'reversedMinor',s.reversed_minor,'currency',s.currency,
    'status',s.status,'rail',s.rail
  ) ORDER BY s.created_at DESC),'[]'::jsonb) INTO v_shares
  FROM public.payee_shares s
  LEFT JOIN public.orders o ON s.order_kind='ticket' AND o.id=s.order_id
  LEFT JOIN public.events e ON e.id=o.event_id
  LEFT JOIN public.venue_orders vo ON s.order_kind='venue_order' AND vo.id=s.order_id
  LEFT JOIN public.venue_listings v ON v.id=vo.venue_id
  LEFT JOIN public.brands b ON b.id=s.brand_id
  WHERE s.payee_user_id=v_actor;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id',g.id,'brandId',g.brand_id,'brandName',b.name,
    'discountId',g.discount_id,'status',g.status,'expiresAt',g.expires_at,
    'grantedAt',g.granted_at
  ) ORDER BY g.granted_at DESC),'[]'::jsonb) INTO v_vouchers
  FROM public.discount_grants g
  JOIN public.brands b ON b.id=g.brand_id
  WHERE g.grantee_user_id=v_actor;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'offerId',o.id,'offerName',o.name,'brandName',b.name,
    'perkText',o.perk_text,'threshold',o.perk_threshold,
    'qualifiedSales',COALESCE(stats.sales_count,0),
    'unlocked',COALESCE(stats.sales_count,0)>=o.perk_threshold
  ) ORDER BY b.name,o.name),'[]'::jsonb) INTO v_perks
  FROM public.referral_members m
  JOIN public.referral_offers o ON o.id=m.offer_id AND o.reward_kind='perk'
  JOIN public.brands b ON b.id=o.brand_id
  LEFT JOIN LATERAL (
    SELECT count(*)::integer sales_count
    FROM public.order_attributions a
    WHERE a.member_id=m.id AND a.rejected_reason IS NULL
      AND a.eligible_minor>0
  ) stats ON true
  WHERE m.user_id=v_actor AND m.status='active';

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'memberId',m.id,'offerId',o.id,'offerName',o.name,'brandName',b.name,
    'role',m.role,'linkSlug',m.link_slug,
    'url','https://usemingla.com/r/'||m.link_slug||CASE
      WHEN m.last_listing_kind IS NULL THEN ''
      ELSE '?kind='||m.last_listing_kind||'&id='||m.last_listing_id::text END,
    'rewardKind',o.reward_kind,'shareBps',o.share_bps,
    'perkText',o.perk_text,'status',o.status
  ) ORDER BY b.name,o.name),'[]'::jsonb) INTO v_links
  FROM public.referral_members m
  JOIN public.referral_offers o ON o.id=m.offer_id
  JOIN public.brands b ON b.id=o.brand_id
  WHERE m.user_id=v_actor AND m.status='active' AND o.status='active'
    AND o.deleted_at IS NULL AND o.starts_at<=now()
    AND (o.ends_at IS NULL OR o.ends_at>now());

  SELECT jsonb_build_object(
    'stripe',jsonb_build_object(
      'connected',stripe_account_id IS NOT NULL,'status',stripe_status,
      'country',stripe_country
    ),
    'paystack',jsonb_build_object(
      'connected',paystack_recipient_code IS NOT NULL,'status',paystack_status,
      'bankName',bank_name,
      'accountNumberMasked',CASE WHEN bank_account_last4 IS NULL THEN NULL
        ELSE '••••'||bank_account_last4 END,
      'country',paystack_country,'currency',paystack_currency
    )
  ) INTO v_account
  FROM public.payee_accounts WHERE user_id=v_actor;

  RETURN jsonb_build_object(
    'totals',v_totals,'shares',v_shares,'vouchers',v_vouchers,
    'perks',v_perks,'links',v_links,
    'payoutAccount',COALESCE(v_account,jsonb_build_object(
      'stripe',jsonb_build_object('connected',false,'status','none','country',NULL),
      'paystack',jsonb_build_object('connected',false,'status','none',
        'bankName',NULL,'accountNumberMasked',NULL,'country',NULL,'currency',NULL)
    ))
  );
END;
$fn$;

CREATE OR REPLACE FUNCTION public.issue_3872_buyer_referral_link(
  p_actor uuid,p_email text,p_display_name text,p_listing_kind text,
  p_listing_id uuid,p_link_slug text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,pg_temp
AS $fn$
DECLARE
  v_email text:=lower(btrim(COALESCE(p_email,'')));
  v_brand uuid;
  v_offer public.referral_offers%ROWTYPE;
  v_member public.referral_members%ROWTYPE;
  v_brand_name text;
BEGIN
  IF p_actor IS NULL OR p_listing_kind NOT IN ('event','venue')
     OR p_listing_id IS NULL OR p_link_slug !~ '^[a-z0-9]{8}$'
     OR position('@' in v_email)<=1 THEN
    RAISE EXCEPTION 'invalid_request';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM auth.users u WHERE u.id=p_actor
    AND lower(btrim(COALESCE(u.email,'')))=v_email) THEN
    RAISE EXCEPTION 'email_mismatch';
  END IF;
  IF p_listing_kind='event' THEN
    SELECT e.brand_id INTO v_brand FROM public.events e
    WHERE e.id=p_listing_id AND e.deleted_at IS NULL;
  ELSE
    SELECT v.brand_id INTO v_brand FROM public.venue_listings v
    WHERE v.id=p_listing_id;
  END IF;
  IF v_brand IS NULL THEN RAISE EXCEPTION 'listing_not_found'; END IF;

  SELECT o.* INTO v_offer FROM public.referral_offers o
  WHERE o.brand_id=v_brand AND o.audience IN ('buyers','both')
    AND o.status='active' AND o.deleted_at IS NULL AND o.starts_at<=now()
    AND (o.ends_at IS NULL OR o.ends_at>now())
    AND (o.scope_kind='brand' OR EXISTS(
      SELECT 1 FROM public.referral_offer_listings l
      WHERE l.offer_id=o.id AND l.listing_kind=p_listing_kind
        AND l.listing_id=p_listing_id
    ))
  ORDER BY (o.scope_kind='listings') DESC,o.created_at DESC LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT m.* INTO v_member FROM public.referral_members m
  WHERE m.offer_id=v_offer.id AND m.status<>'removed'
    AND (m.user_id=p_actor OR m.email_norm=v_email)
  ORDER BY (m.user_id=p_actor) DESC,m.created_at LIMIT 1 FOR UPDATE;
  IF FOUND THEN
    IF v_member.user_id IS NOT NULL AND v_member.user_id<>p_actor THEN
      RAISE EXCEPTION 'member_identity_conflict';
    END IF;
    UPDATE public.referral_members SET
      user_id=p_actor,email_norm=v_email,
      display_name=COALESCE(NULLIF(btrim(p_display_name),''),display_name),
      status='active',joined_at=COALESCE(joined_at,now()),
      invite_consumed_at=CASE WHEN status='invited' THEN now() ELSE invite_consumed_at END,
      last_listing_kind=p_listing_kind,last_listing_id=p_listing_id
    WHERE id=v_member.id RETURNING * INTO v_member;
  ELSE
    INSERT INTO public.referral_members(
      offer_id,brand_id,role,user_id,email_norm,display_name,link_slug,
      status,joined_at
    ) VALUES (
      v_offer.id,v_brand,'buyer',p_actor,v_email,
      COALESCE(NULLIF(btrim(p_display_name),''),split_part(v_email,'@',1)),
      p_link_slug,'active',now()
    ) RETURNING * INTO v_member;
    UPDATE public.referral_members SET
      last_listing_kind=p_listing_kind,last_listing_id=p_listing_id
    WHERE id=v_member.id RETURNING * INTO v_member;
  END IF;
  SELECT name INTO v_brand_name FROM public.brands WHERE id=v_brand;
  RETURN jsonb_build_object(
    'memberId',v_member.id,'offerId',v_offer.id,'offerName',v_offer.name,
    'brandId',v_brand,'brandName',v_brand_name,'linkSlug',v_member.link_slug,
    'url','https://usemingla.com/r/'||v_member.link_slug||'?kind='||
      p_listing_kind||'&id='||p_listing_id::text,
    'rewardKind',v_offer.reward_kind,'shareBps',v_offer.share_bps,
    'perkText',v_offer.perk_text,
    'buyerDiscount',v_offer.buyer_discount_id IS NOT NULL
  );
END;
$fn$;

CREATE OR REPLACE FUNCTION public.issue_3872_mark_content_share_sharer(
  p_actor uuid,p_link_id uuid,p_show_sharer boolean
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,pg_temp
AS $fn$
DECLARE v_link public.content_share_links%ROWTYPE;
BEGIN
  IF p_actor IS NULL OR p_show_sharer IS NULL THEN RAISE EXCEPTION 'invalid_request'; END IF;
  SELECT * INTO v_link FROM public.content_share_links
  WHERE id=p_link_id FOR UPDATE;
  IF NOT FOUND OR v_link.creator_principal IS DISTINCT FROM p_actor THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  UPDATE public.content_share_links SET
    sharer_user_id=p_actor,show_sharer=p_show_sharer,updated_at=now()
  WHERE id=p_link_id;
  RETURN jsonb_build_object('linkId',p_link_id,'showSharer',p_show_sharer);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.public_content_share_sharer(p_short_code text)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=public,pg_temp
AS $fn$
  SELECT CASE WHEN l.id IS NULL OR NOT l.show_sharer THEN NULL ELSE jsonb_build_object(
    'first_name',COALESCE(NULLIF(btrim(p.first_name),''),
      split_part(COALESCE(NULLIF(btrim(p.display_name),''),'A friend'),' ',1)),
    'avatar_url',p.avatar_url
  ) END
  FROM (SELECT 1) singleton
  LEFT JOIN public.content_share_links l ON l.short_code=p_short_code
    AND l.state='active' AND (l.expires_at IS NULL OR l.expires_at>now())
  LEFT JOIN public.profiles p ON p.id=l.sharer_user_id
  LIMIT 1
$fn$;

CREATE OR REPLACE FUNCTION public.public_content_share_friend_discount(p_short_code text)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=public,pg_temp
AS $fn$
DECLARE v_event uuid;v_venue uuid;v_result boolean;
BEGIN
  SELECT
    CASE WHEN l.source_reference->>'eventId' ~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      THEN (l.source_reference->>'eventId')::uuid END,
    CASE WHEN l.source_reference->>'venueId' ~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      THEN (l.source_reference->>'venueId')::uuid END
  INTO v_event,v_venue FROM public.content_share_links l
  WHERE l.short_code=p_short_code AND l.state='active'
    AND (l.expires_at IS NULL OR l.expires_at>now());
  SELECT EXISTS(
    SELECT 1
    FROM public.referral_offers o WHERE o.brand_id=COALESCE(
      (SELECT e.brand_id FROM public.events e WHERE e.id=v_event),
      (SELECT v.brand_id FROM public.venue_listings v WHERE v.id=v_venue)
    )
      AND o.audience IN ('buyers','both') AND o.buyer_discount_id IS NOT NULL
      AND o.status='active' AND o.deleted_at IS NULL AND o.starts_at<=now()
      AND (o.ends_at IS NULL OR o.ends_at>now())
      AND (
        o.scope_kind='brand' OR EXISTS(
          SELECT 1 FROM public.referral_offer_listings ol
          WHERE ol.offer_id=o.id AND (
            (ol.listing_kind='event' AND ol.listing_id=v_event)
            OR (ol.listing_kind='venue' AND ol.listing_id=v_venue)
          )
        )
      )
  ) INTO v_result;
  RETURN COALESCE(v_result,false);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.public_referral_landing(
  p_slug text,p_listing_kind text,p_listing_id uuid
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=public,pg_temp
AS $fn$
DECLARE
  v_member public.referral_members%ROWTYPE;
  v_offer public.referral_offers%ROWTYPE;
  v_brand_slug text;v_brand_name text;v_listing_slug text;v_listing_title text;
  v_first_name text;v_avatar_url text;v_active boolean:=false;
BEGIN
  IF p_slug !~ '^[a-z0-9][a-z0-9_-]{5,47}$'
     OR p_listing_kind NOT IN ('event','venue') OR p_listing_id IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT * INTO v_member FROM public.referral_members WHERE link_slug=p_slug;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO v_offer FROM public.referral_offers WHERE id=v_member.offer_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT slug,name INTO v_brand_slug,v_brand_name FROM public.brands
  WHERE id=v_member.brand_id;
  IF p_listing_kind='event' THEN
    SELECT slug,title INTO v_listing_slug,v_listing_title FROM public.events
    WHERE id=p_listing_id AND brand_id=v_member.brand_id AND deleted_at IS NULL;
  ELSE
    SELECT slug,name INTO v_listing_slug,v_listing_title FROM public.venue_listings
    WHERE id=p_listing_id AND brand_id=v_member.brand_id;
  END IF;
  IF v_listing_slug IS NULL THEN RETURN NULL; END IF;
  v_active:=v_member.status='active' AND v_member.removed_at IS NULL
    AND v_offer.status='active' AND v_offer.deleted_at IS NULL
    AND v_offer.audience IN ('buyers','both') AND v_offer.starts_at<=now()
    AND (v_offer.ends_at IS NULL OR v_offer.ends_at>now())
    AND public.issue_3872_referrals_on(v_member.brand_id)
    AND (v_offer.scope_kind='brand' OR EXISTS(
      SELECT 1 FROM public.referral_offer_listings l WHERE l.offer_id=v_offer.id
        AND l.listing_kind=p_listing_kind AND l.listing_id=p_listing_id
    ));
  IF v_active AND v_member.user_id IS NOT NULL THEN
    SELECT COALESCE(NULLIF(btrim(p.first_name),''),
      split_part(COALESCE(NULLIF(btrim(p.display_name),''),'A friend'),' ',1)),
      p.avatar_url INTO v_first_name,v_avatar_url
    FROM public.profiles p WHERE p.id=v_member.user_id;
  END IF;
  RETURN jsonb_build_object(
    'active',v_active,'firstName',CASE WHEN v_active THEN v_first_name END,
    'avatarUrl',CASE WHEN v_active THEN v_avatar_url END,
    'brandName',v_brand_name,'listingTitle',v_listing_title,
    'buyerDiscount',v_active AND v_offer.buyer_discount_id IS NOT NULL,
    'destinationUrl',CASE WHEN p_listing_kind='event'
      THEN 'https://host.usemingla.com/e/'||v_brand_slug||'/'||v_listing_slug
      ELSE 'https://host.usemingla.com/b/'||v_brand_slug||'/v/'||v_listing_slug END
  );
END;
$fn$;

CREATE OR REPLACE FUNCTION public.issue_3872_create_payee_claim_token(
  p_email text,p_token_hash text,p_expires_at timestamptz
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,pg_temp
AS $fn$
DECLARE v_email text:=lower(btrim(COALESCE(p_email,'')));v_id uuid;
BEGIN
  IF current_user NOT IN ('postgres','service_role') THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF position('@' in v_email)<=1 OR p_token_hash !~ '^[a-f0-9]{64}$'
     OR p_expires_at<=now() THEN RAISE EXCEPTION 'invalid_request'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.payee_shares s
    WHERE s.payee_user_id IS NULL AND s.payee_email_norm=v_email
      AND s.status<>'unclaimed_expired') THEN RAISE EXCEPTION 'nothing_to_claim'; END IF;
  INSERT INTO public.payee_claim_tokens(email_norm,token_hash,expires_at)
  VALUES(v_email,p_token_hash,p_expires_at) RETURNING id INTO v_id;
  RETURN jsonb_build_object('claimId',v_id,'expiresAt',p_expires_at);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.issue_3872_claim_guest_earnings(
  p_actor uuid,p_email text,p_token_hash text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,pg_temp
AS $fn$
DECLARE
  v_email text:=lower(btrim(COALESCE(p_email,'')));
  v_token public.payee_claim_tokens%ROWTYPE;
  v_members integer:=0;v_shares integer:=0;v_grants integer:=0;
BEGIN
  IF p_actor IS NULL OR position('@' in v_email)<=1
     OR p_token_hash !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'invalid_request'; END IF;
  IF NOT EXISTS(SELECT 1 FROM auth.users u WHERE u.id=p_actor
    AND lower(btrim(COALESCE(u.email,'')))=v_email) THEN
    RAISE EXCEPTION 'claim_email_mismatch';
  END IF;
  SELECT * INTO v_token FROM public.payee_claim_tokens
  WHERE token_hash=p_token_hash FOR UPDATE;
  IF NOT FOUND OR v_token.email_norm<>v_email THEN RAISE EXCEPTION 'claim_not_found'; END IF;
  IF v_token.consumed_at IS NOT NULL THEN RAISE EXCEPTION 'claim_used'; END IF;
  IF v_token.expires_at<=now() THEN RAISE EXCEPTION 'claim_expired'; END IF;
  IF EXISTS(
    SELECT 1 FROM public.referral_members guest
    JOIN public.referral_members owned ON owned.offer_id=guest.offer_id
      AND owned.user_id=p_actor AND owned.status<>'removed' AND owned.id<>guest.id
    WHERE guest.email_norm=v_email AND guest.user_id IS NULL
      AND guest.status<>'removed'
  ) THEN RAISE EXCEPTION 'claim_member_conflict'; END IF;

  UPDATE public.referral_members SET user_id=p_actor,
    status=CASE WHEN status='invited' THEN 'active' ELSE status END,
    joined_at=CASE WHEN status='invited' THEN COALESCE(joined_at,now()) ELSE joined_at END,
    invite_consumed_at=CASE WHEN status='invited' THEN COALESCE(invite_consumed_at,now()) ELSE invite_consumed_at END
  WHERE email_norm=v_email AND user_id IS NULL AND status<>'removed';
  GET DIAGNOSTICS v_members=ROW_COUNT;
  UPDATE public.payee_shares SET payee_user_id=p_actor,updated_at=now()
  WHERE payee_email_norm=v_email AND payee_user_id IS NULL
    AND status<>'unclaimed_expired';
  GET DIAGNOSTICS v_shares=ROW_COUNT;
  UPDATE public.discount_grants SET grantee_user_id=p_actor
  WHERE grantee_email_norm=v_email AND grantee_user_id IS NULL
    AND status IN ('active','used');
  GET DIAGNOSTICS v_grants=ROW_COUNT;
  UPDATE public.payee_claim_tokens SET consumed_at=now(),claimed_by=p_actor
  WHERE id=v_token.id;
  RETURN jsonb_build_object('membersClaimed',v_members,'sharesClaimed',v_shares,
    'vouchersClaimed',v_grants);
END;
$fn$;

REVOKE ALL ON FUNCTION public.issue_3872_my_earnings_summary(),
  public.issue_3872_buyer_referral_link(uuid,text,text,text,uuid,text),
  public.issue_3872_mark_content_share_sharer(uuid,uuid,boolean),
  public.public_content_share_sharer(text),
  public.public_content_share_friend_discount(text),
  public.public_referral_landing(text,text,uuid),
  public.issue_3872_create_payee_claim_token(text,text,timestamptz),
  public.issue_3872_claim_guest_earnings(uuid,text,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3872_my_earnings_summary() TO authenticated;
GRANT EXECUTE ON FUNCTION public.public_content_share_sharer(text) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.public_content_share_friend_discount(text) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.public_referral_landing(text,text,uuid) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3872_buyer_referral_link(uuid,text,text,text,uuid,text),
  public.issue_3872_mark_content_share_sharer(uuid,uuid,boolean),
  public.issue_3872_create_payee_claim_token(text,text,timestamptz),
  public.issue_3872_claim_guest_earnings(uuid,text,text)
  TO service_role;

COMMIT;
