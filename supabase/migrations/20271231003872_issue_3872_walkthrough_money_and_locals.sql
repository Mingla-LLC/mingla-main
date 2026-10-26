-- #3872 walkthrough build pass (W1 server) — referrals, the shared payee
-- ledger, Mingla Locals and the creator earnings summary.
--
-- Reviewed R2/R4 migrations are not edited; this file layers the approved
-- walkthrough contract and QA defect fixes on top.
--
-- MINGLA-INVARIANT: I-3872-NO-SELF-REFERRAL-SHARE | issue #3872 | An order whose buyer is the referral payee (same user or same email) never creates a payee share or voucher; issue_3872_finalize_referral_attribution is the database backstop behind the edge resolver.
-- MINGLA-INVARIANT: I-3872-SHARE-FROZEN | issue #3872 | Payee share money and identity columns are immutable and only SECURITY DEFINER ledger functions may write payee_shares; service_role has no direct write grant.
-- MINGLA-INVARIANT: I-3872-NO-EMAIL-PUBLIC-NAME | issue #3872 | Public referral reads never derive a name from an email address; referral_link_resolve returns a member-set or profile first name only while the offer is active.

BEGIN;
SET LOCAL lock_timeout='10s';

-- ---------------------------------------------------------------------------
-- #4 Referral offer writes: JSON null is SQL NULL.
-- ---------------------------------------------------------------------------
-- p_payload->'voucherTemplate' is the jsonb value 'null' (not SQL NULL) when
-- the Host sends voucherTemplate:null, so every cash and perk offer violated
-- referral_offers_reward_shape and could never be created.
CREATE OR REPLACE FUNCTION public.issue_3872_jsonb_value(p_value jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $fn$
  SELECT CASE WHEN p_value IS NULL OR jsonb_typeof(p_value)='null' THEN NULL ELSE p_value END
$fn$;

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
  v_listings jsonb;
  v_tiers jsonb;
  v_template jsonb;
BEGIN
  IF p_actor IS NULL OR p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'invalid_request';
  END IF;
  IF p_action NOT IN ('create','update','pause','resume','end','delete_draft') THEN
    RAISE EXCEPTION 'invalid_action';
  END IF;
  v_listings := coalesce(public.issue_3872_jsonb_value(p_payload->'listings'),'[]'::jsonb);
  v_tiers := coalesce(public.issue_3872_jsonb_value(p_payload->'tiers'),'[]'::jsonb);
  v_template := public.issue_3872_jsonb_value(p_payload->'voucherTemplate');

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
  IF jsonb_typeof(v_listings) <> 'array' OR jsonb_typeof(v_tiers) <> 'array' THEN
    RAISE EXCEPTION 'invalid_request';
  END IF;
  -- Fields that do not belong to the chosen reward are cleared, so a Host
  -- switching an offer from voucher to cash cannot leave a stale template.
  IF v_reward = 'perk' THEN v_template := NULL; END IF;
  v_tier_count := jsonb_array_length(v_tiers);
  IF v_tier_count > 5 OR (v_reward <> 'cash' AND v_tier_count > 0) THEN
    RAISE EXCEPTION 'tiers_invalid';
  END IF;
  IF v_scope = 'listings' AND jsonb_array_length(v_listings) = 0 THEN
    RAISE EXCEPTION 'scope_target_mismatch';
  END IF;
  IF v_scope = 'brand' AND jsonb_array_length(v_listings) > 0 THEN
    RAISE EXCEPTION 'scope_target_mismatch';
  END IF;

  IF p_action = 'create' THEN
    INSERT INTO public.referral_offers(
      brand_id,name,audience,scope_kind,reward_kind,share_bps,
      voucher_template,perk_text,perk_threshold,buyer_discount_id,budget_minor,
      currency,starts_at,ends_at,status,created_by
    ) VALUES (
      v_brand,btrim(p_payload->>'name'),p_payload->>'audience',v_scope,v_reward,
      CASE WHEN v_reward='cash' THEN NULLIF(p_payload->>'shareBps','')::integer END,v_template,
      CASE WHEN v_reward='perk' THEN NULLIF(btrim(p_payload->>'perkText'),'') END,
      CASE WHEN v_reward='perk' THEN NULLIF(p_payload->>'perkThreshold','')::integer END,
      NULLIF(p_payload->>'buyerDiscountId','')::uuid,NULLIF(p_payload->>'budgetMinor','')::bigint,
      upper(p_payload->>'currency'),COALESCE(NULLIF(p_payload->>'startsAt','')::timestamptz,now()),
      NULLIF(p_payload->>'endsAt','')::timestamptz,v_status,p_actor
    ) RETURNING * INTO v_offer;
    v_id := v_offer.id;
  ELSE
    UPDATE public.referral_offers SET
      name=btrim(p_payload->>'name'), audience=p_payload->>'audience', scope_kind=v_scope,
      reward_kind=v_reward,
      share_bps=CASE WHEN v_reward='cash' THEN NULLIF(p_payload->>'shareBps','')::integer END,
      voucher_template=v_template,
      perk_text=CASE WHEN v_reward='perk' THEN NULLIF(btrim(p_payload->>'perkText'),'') END,
      perk_threshold=CASE WHEN v_reward='perk' THEN NULLIF(p_payload->>'perkThreshold','')::integer END,
      buyer_discount_id=NULLIF(p_payload->>'buyerDiscountId','')::uuid,
      budget_minor=NULLIF(p_payload->>'budgetMinor','')::bigint,
      currency=upper(p_payload->>'currency'),
      starts_at=COALESCE(NULLIF(p_payload->>'startsAt','')::timestamptz,starts_at),
      ends_at=NULLIF(p_payload->>'endsAt','')::timestamptz, status=v_status,
      paused_reason=NULL
    WHERE id=v_id RETURNING * INTO v_offer;
    DELETE FROM public.referral_offer_listings WHERE offer_id=v_id;
    DELETE FROM public.referral_offer_tiers WHERE offer_id=v_id;
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(v_listings) LOOP
    INSERT INTO public.referral_offer_listings(offer_id,listing_kind,listing_id)
    VALUES (v_id,v_item->>'listingKind',(v_item->>'listingId')::uuid);
  END LOOP;
  FOR v_item IN SELECT value FROM jsonb_array_elements(v_tiers) LOOP
    INSERT INTO public.referral_offer_tiers(offer_id,min_sales,share_bps)
    VALUES (v_id,(v_item->>'minSales')::integer,(v_item->>'shareBps')::integer);
  END LOOP;

  RETURN public.issue_3872_referral_offer_json(v_id);
END;
$fn$;

-- ---------------------------------------------------------------------------
-- #16 Public names never come from an email address.
-- ---------------------------------------------------------------------------
ALTER TABLE public.referral_members
  ADD COLUMN IF NOT EXISTS display_name_source text NOT NULL DEFAULT 'member'
  CHECK (display_name_source IN ('member','email_default'));
UPDATE public.referral_members
   SET display_name_source='email_default'
 WHERE email_norm IS NOT NULL AND btrim(display_name)=left(split_part(email_norm,'@',1),100);

-- Invite and buyer-link writers default the stored name to the email local
-- part for the Host's own lists. Mark that so public surfaces skip it.
CREATE OR REPLACE FUNCTION public.issue_3872_referral_member_name_source() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $fn$
BEGIN
  NEW.display_name_source:=CASE
    WHEN NEW.email_norm IS NOT NULL AND btrim(NEW.display_name)=left(split_part(NEW.email_norm,'@',1),100) THEN 'email_default'
    ELSE 'member' END;
  RETURN NEW;
END;
$fn$;
DROP TRIGGER IF EXISTS issue_3872_referral_member_name_source ON public.referral_members;
CREATE TRIGGER issue_3872_referral_member_name_source
BEFORE INSERT OR UPDATE OF display_name,email_norm ON public.referral_members
FOR EACH ROW EXECUTE FUNCTION public.issue_3872_referral_member_name_source();

CREATE OR REPLACE FUNCTION public.referral_link_resolve(p_slug text)
RETURNS TABLE(
  brand_slug text,
  event_slug text,
  member_first_name text,
  offer_active boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  WITH link AS (
    SELECT
      brand.slug AS brand_slug,
      offer.id AS offer_id,
      member.display_name,
      member.display_name_source,
      member.user_id,
      member.status='active'
        AND member.removed_at IS NULL
        AND offer.deleted_at IS NULL
        AND offer.status='active'
        AND offer.starts_at<=now()
        AND (offer.ends_at IS NULL OR offer.ends_at>now())
        AND public.issue_3872_referrals_on(offer.brand_id) AS active
    FROM public.referral_members member
    JOIN public.referral_offers offer ON offer.id=member.offer_id
    JOIN public.brands brand ON brand.id=member.brand_id
    WHERE member.link_slug=lower(btrim(p_slug))
      AND brand.deleted_at IS NULL
    LIMIT 1
  )
  SELECT
    link.brand_slug,
    (
      SELECT event.slug
      FROM public.referral_offer_listings scoped
      JOIN public.events event
        ON scoped.listing_kind='event' AND event.id=scoped.listing_id
      WHERE scoped.offer_id=link.offer_id AND event.deleted_at IS NULL
      ORDER BY event.created_at,event.id
      LIMIT 1
    ),
    CASE WHEN link.active THEN coalesce(
      CASE WHEN link.display_name_source='member' THEN nullif(split_part(btrim(link.display_name),' ',1),'') END,
      (SELECT nullif(split_part(btrim(p.first_name),' ',1),'') FROM public.profiles p WHERE p.id=link.user_id)
    ) END,
    link.active
  FROM link;
$fn$;
REVOKE ALL ON FUNCTION public.referral_link_resolve(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.referral_link_resolve(text) TO anon,authenticated,service_role;

-- ---------------------------------------------------------------------------
-- #20 Self-referral backstop at attribution finalize.
-- ---------------------------------------------------------------------------
DO $rename$
BEGIN
  -- Keep the reviewed R2 body as the core; the wrapper below adds the check.
  IF to_regprocedure('public.issue_3872_finalize_referral_attribution_core(text,uuid,uuid,jsonb,timestamptz)') IS NULL THEN
    ALTER FUNCTION public.issue_3872_finalize_referral_attribution(text,uuid,uuid,jsonb,timestamptz)
      RENAME TO issue_3872_finalize_referral_attribution_core;
  END IF;
END;
$rename$;
REVOKE ALL ON FUNCTION public.issue_3872_finalize_referral_attribution_core(text,uuid,uuid,jsonb,timestamptz) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.issue_3872_finalize_referral_attribution(
  p_order_kind text,
  p_order_id uuid,
  p_brand_id uuid,
  p_snapshot jsonb,
  p_release_after timestamptz
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_buyer_user uuid; v_buyer_email text; v_member public.referral_members%ROWTYPE;
  v_payee_user uuid; v_payee_email text; v_snapshot jsonb:=p_snapshot;
BEGIN
  IF p_snapshot IS NULL OR p_snapshot->'memberId' IS NULL OR jsonb_typeof(p_snapshot->'memberId')='null' THEN
    PERFORM public.issue_3872_finalize_referral_attribution_core(p_order_kind,p_order_id,p_brand_id,p_snapshot,p_release_after);
    RETURN;
  END IF;
  IF p_order_kind='ticket' THEN
    SELECT coalesce(o.buyer_user_id,o.purchased_by_user_id),nullif(lower(btrim(o.buyer_email)),'')
      INTO v_buyer_user,v_buyer_email FROM public.orders o WHERE o.id=p_order_id;
  ELSIF p_order_kind='venue_order' THEN
    SELECT o.buyer_user_id,nullif(lower(btrim(o.buyer_email)),'')
      INTO v_buyer_user,v_buyer_email FROM public.venue_orders o WHERE o.id=p_order_id;
  END IF;
  SELECT * INTO v_member FROM public.referral_members WHERE id=NULLIF(p_snapshot->>'memberId','')::uuid;
  v_payee_user:=coalesce(NULLIF(p_snapshot->>'payeeUserId','')::uuid,v_member.user_id);
  v_payee_email:=coalesce(NULLIF(p_snapshot->>'payeeEmailNorm',''),v_member.email_norm);
  -- The edge resolver already rejects self-referrals; this catches anything
  -- that slips past it (e.g. a buyer who signs in after the snapshot froze).
  IF (v_buyer_user IS NOT NULL AND v_buyer_user IS NOT DISTINCT FROM v_payee_user)
     OR (v_buyer_user IS NOT NULL AND v_buyer_user IS NOT DISTINCT FROM v_member.user_id)
     OR (v_buyer_email IS NOT NULL AND v_buyer_email IS NOT DISTINCT FROM v_payee_email) THEN
    v_snapshot:=p_snapshot||jsonb_build_object('rejectedReason','self_referral','shareMinor','0','rewardKind','perk');
  END IF;
  PERFORM public.issue_3872_finalize_referral_attribution_core(p_order_kind,p_order_id,p_brand_id,v_snapshot,p_release_after);
END;
$fn$;
REVOKE ALL ON FUNCTION public.issue_3872_finalize_referral_attribution(text,uuid,uuid,jsonb,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3872_finalize_referral_attribution(text,uuid,uuid,jsonb,timestamptz) TO service_role;

-- ---------------------------------------------------------------------------
-- #17 Payee shares: no direct writes, frozen money and identity.
-- ---------------------------------------------------------------------------
-- The share guard re-checked identity only, so service_role could UPDATE a
-- share's status (e.g. releasable -> paid) or currency directly. Every
-- sanctioned writer is a SECURITY DEFINER function owned by postgres.
REVOKE INSERT,UPDATE,DELETE,TRUNCATE ON public.payee_shares FROM service_role;

CREATE OR REPLACE FUNCTION public.issue_3872_payee_share_freeze() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $fn$
BEGIN
  IF NEW.order_kind IS DISTINCT FROM OLD.order_kind OR NEW.order_id IS DISTINCT FROM OLD.order_id
     OR NEW.payee_kind IS DISTINCT FROM OLD.payee_kind OR NEW.member_id IS DISTINCT FROM OLD.member_id
     OR NEW.brand_id IS DISTINCT FROM OLD.brand_id OR NEW.rail IS DISTINCT FROM OLD.rail
     OR NEW.currency IS DISTINCT FROM OLD.currency OR NEW.gross_minor IS DISTINCT FROM OLD.gross_minor
     OR NEW.mingla_fee_minor IS DISTINCT FROM OLD.mingla_fee_minor OR NEW.net_minor IS DISTINCT FROM OLD.net_minor
     OR NEW.reversed_minor<OLD.reversed_minor
     -- A guest share may be claimed once; an account deletion may null it.
     OR (OLD.payee_user_id IS NOT NULL AND NEW.payee_user_id IS NOT NULL AND NEW.payee_user_id<>OLD.payee_user_id) THEN
    RAISE EXCEPTION 'payee_share_frozen' USING ERRCODE='55000';
  END IF;
  -- Paid and fully reversed shares never become payable again.
  IF OLD.status IN ('paid','reversed') AND NEW.status IN ('pending','held_until_event','releasable','accumulating') THEN
    RAISE EXCEPTION 'payee_share_frozen' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END;
$fn$;
DROP TRIGGER IF EXISTS issue_3872_payee_share_freeze ON public.payee_shares;
CREATE TRIGGER issue_3872_payee_share_freeze BEFORE UPDATE ON public.payee_shares
FOR EACH ROW EXECUTE FUNCTION public.issue_3872_payee_share_freeze();

-- ---------------------------------------------------------------------------
-- #14 Admin payee ledger covers every payee kind.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_list_payee_ledger(text,text,text,integer,integer);
CREATE OR REPLACE FUNCTION public.admin_list_payee_ledger(
  p_search text DEFAULT NULL,p_status_filter text DEFAULT NULL,
  p_rail_filter text DEFAULT NULL,p_limit integer DEFAULT 25,p_offset integer DEFAULT 0,
  p_kind_filter text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp
AS $fn$
DECLARE v_rows jsonb;v_total integer;
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF p_kind_filter IS NOT NULL AND p_kind_filter NOT IN ('referral','gig_fee','local_month') THEN
    RAISE EXCEPTION 'invalid_kind_filter' USING ERRCODE='22023';
  END IF;
  -- The R2 version inner-joined referral_members and brands, so gig fee and
  -- Local shares (no member; Local has no brand) never appeared.
  WITH base AS (
    SELECT s.id,s.payee_kind,s.order_kind,s.order_id,s.member_id,
      CASE s.payee_kind
        WHEN 'referral' THEN m.display_name
        WHEN 'gig_fee' THEN cp.display_name
        ELSE coalesce(nullif(btrim(pr.display_name),''),nullif(btrim(concat_ws(' ',pr.first_name,pr.last_name)),''),pr.username)
      END AS payee_name,
      m.display_name,coalesce(m.email_norm,s.payee_email_norm) AS email_norm,
      s.payee_user_id,s.brand_id,b.name brand_name,s.rail,s.currency,
      s.gross_minor,s.mingla_fee_minor,s.net_minor,s.reversed_minor,
      public.issue_3872_payee_remaining_net(s) remaining_net_minor,
      s.status,s.release_after,s.payout_id,p.status payout_status,p.provider_ref,
      p.amount_minor payout_amount_minor,p.provider_fee_minor,
      COALESCE(h.active,false) risk_held,h.source risk_source,h.reason risk_reason,
      a.stripe_status,a.paystack_status,a.bank_name,a.bank_account_last4,
      COALESCE((SELECT sum(d.amount_minor-d.recovered_minor) FROM public.payee_debts d
        WHERE d.payee_user_id=s.payee_user_id AND d.rail=s.rail
          AND d.currency=s.currency AND d.status='open'),0) open_debt_minor,
      s.created_at,s.updated_at
    FROM public.payee_shares s
    LEFT JOIN public.referral_members m ON m.id=s.member_id
    LEFT JOIN public.brands b ON b.id=s.brand_id
    LEFT JOIN public.gig_contracts gc ON s.payee_kind='gig_fee' AND gc.id=s.order_id
    LEFT JOIN public.creator_profiles cp ON cp.creator_account_id=gc.creator_account_id
    LEFT JOIN public.profiles pr ON pr.id=s.payee_user_id
    LEFT JOIN public.payee_payouts p ON p.id=s.payout_id
    LEFT JOIN public.referral_member_risk_holds h ON h.member_id=s.member_id
    LEFT JOIN public.payee_accounts a ON a.user_id=s.payee_user_id
  ), filtered AS (
    SELECT * FROM base WHERE
      (p_search IS NULL OR brand_name ILIKE '%'||p_search||'%'
        OR payee_name ILIKE '%'||p_search||'%' OR email_norm ILIKE '%'||p_search||'%'
        OR order_id::text=p_search OR id::text=p_search)
      AND (p_status_filter IS NULL OR status=p_status_filter
        OR (p_status_filter='held' AND risk_held))
      AND (p_rail_filter IS NULL OR rail=p_rail_filter)
      AND (p_kind_filter IS NULL OR payee_kind=p_kind_filter)
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(q) ORDER BY q.created_at DESC),'[]'::jsonb),
    (SELECT count(*) FROM filtered) INTO v_rows,v_total
  FROM (SELECT * FROM filtered ORDER BY created_at DESC
    LIMIT greatest(p_limit,1) OFFSET greatest(p_offset,0)) q;
  RETURN jsonb_build_object('rows',v_rows,'total',v_total);
END;
$fn$;
REVOKE ALL ON FUNCTION public.admin_list_payee_ledger(text,text,text,integer,integer,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_list_payee_ledger(text,text,text,integer,integer,text) TO authenticated,service_role;

-- ---------------------------------------------------------------------------
-- Locals: per-city monthly rate and payout currency.
-- ---------------------------------------------------------------------------
ALTER TABLE public.local_city_programs
  ADD COLUMN IF NOT EXISTS monthly_rate_minor bigint CHECK (monthly_rate_minor IS NULL OR monthly_rate_minor>0),
  ADD COLUMN IF NOT EXISTS payout_currency text NOT NULL DEFAULT 'USD' CHECK (payout_currency ~ '^[A-Z]{3}$');
UPDATE public.local_city_programs SET monthly_rate_minor=monthly_usd_minor WHERE monthly_rate_minor IS NULL;
ALTER TABLE public.local_city_programs ALTER COLUMN monthly_rate_minor SET NOT NULL;
-- Writers that predate the per-city rate still insert monthly_usd_minor only.
CREATE OR REPLACE FUNCTION public.issue_3872_local_program_rate_default() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $fn$
BEGIN
  NEW.monthly_rate_minor:=coalesce(NEW.monthly_rate_minor,NEW.monthly_usd_minor);
  RETURN NEW;
END;
$fn$;
DROP TRIGGER IF EXISTS issue_3872_local_program_rate_default ON public.local_city_programs;
CREATE TRIGGER issue_3872_local_program_rate_default BEFORE INSERT OR UPDATE ON public.local_city_programs
FOR EACH ROW EXECUTE FUNCTION public.issue_3872_local_program_rate_default();

DROP FUNCTION IF EXISTS public.local_city_program_save(uuid,integer,boolean,bigint);
CREATE OR REPLACE FUNCTION public.local_city_program_save(
  p_city_id uuid,p_seats integer,p_is_open boolean,
  p_monthly_rate_minor bigint DEFAULT NULL,p_payout_currency text DEFAULT NULL,
  p_monthly_usd_minor bigint DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_active integer; v_existing public.local_city_programs; v_rate bigint; v_currency text;
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'admin_only' USING ERRCODE='42501'; END IF;
  IF p_city_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.seeding_cities WHERE id=p_city_id) THEN
    RETURN jsonb_build_object('ok',false,'error','city_not_found','field','city_id');
  END IF;
  IF p_seats IS NULL OR p_seats NOT BETWEEN 0 AND 10 THEN RETURN jsonb_build_object('ok',false,'error','seats_invalid','field','seats'); END IF;
  SELECT * INTO v_existing FROM public.local_city_programs WHERE city_id=p_city_id FOR UPDATE;
  -- p_monthly_usd_minor is the pre-walkthrough argument and stays optional.
  v_currency:=upper(btrim(coalesce(p_payout_currency,v_existing.payout_currency,'USD')));
  v_rate:=coalesce(p_monthly_rate_minor,CASE WHEN v_currency='USD' THEN p_monthly_usd_minor END,v_existing.monthly_rate_minor,15000);
  IF v_currency!~'^[A-Z]{3}$' OR NOT EXISTS(SELECT 1 FROM public.supported_brand_currencies c WHERE c.code=v_currency) THEN
    RETURN jsonb_build_object('ok',false,'error','currency_invalid','field','payout_currency');
  END IF;
  IF v_rate<=0 THEN RETURN jsonb_build_object('ok',false,'error','rate_invalid','field','monthly_rate_minor'); END IF;
  SELECT count(*) INTO v_active FROM public.locals WHERE city_id=p_city_id AND status='active';
  IF p_seats<v_active THEN RETURN jsonb_build_object('ok',false,'error','seats_below_active_locals','field','seats','active',v_active); END IF;
  INSERT INTO public.local_city_programs(city_id,seats,is_open,monthly_usd_minor,monthly_rate_minor,payout_currency,updated_by)
  VALUES(p_city_id,p_seats,coalesce(p_is_open,false),CASE WHEN v_currency='USD' THEN v_rate ELSE coalesce(p_monthly_usd_minor,15000) END,v_rate,v_currency,auth.uid())
  ON CONFLICT(city_id) DO UPDATE SET seats=excluded.seats,is_open=excluded.is_open,
    monthly_usd_minor=CASE WHEN excluded.payout_currency='USD' THEN excluded.monthly_rate_minor ELSE public.local_city_programs.monthly_usd_minor END,
    monthly_rate_minor=excluded.monthly_rate_minor,payout_currency=excluded.payout_currency,updated_by=excluded.updated_by;
  RETURN jsonb_build_object('ok',true,'active',v_active,'seats',p_seats,'monthly_rate_minor',v_rate,'payout_currency',v_currency);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.local_landing() RETURNS jsonb
LANGUAGE sql SECURITY DEFINER STABLE SET search_path=public,pg_temp AS $fn$
  SELECT jsonb_build_object(
    'enabled',coalesce((SELECT is_enabled FROM public.feature_flags WHERE flag_key='mingla_locals_enabled'),false),
    'viewer_city_id',coalesce(
      (SELECT l.city_id FROM public.locals l WHERE l.user_id=auth.uid()),
      (SELECT p.home_city_id FROM public.creator_profiles p WHERE p.creator_account_id=auth.uid())),
    'programs',coalesce((SELECT jsonb_agg(jsonb_build_object('city_id',cp.city_id,'city',c.name,'seats',cp.seats,
        'monthly_usd_minor',cp.monthly_usd_minor,'monthly_rate_minor',cp.monthly_rate_minor,'payout_currency',cp.payout_currency) ORDER BY c.name)
      FROM public.local_city_programs cp JOIN public.seeding_cities c ON c.id=cp.city_id
      WHERE cp.is_open AND EXISTS(SELECT 1 FROM public.feature_flags f WHERE f.flag_key='mingla_locals_enabled' AND f.is_enabled)),'[]'::jsonb),
    'applications',coalesce((SELECT jsonb_agg(jsonb_build_object('id',a.id,'city_id',a.city_id,'city',c.name,'status',a.status,'created_at',a.created_at) ORDER BY a.created_at DESC)
      FROM public.local_applications a JOIN public.seeding_cities c ON c.id=a.city_id WHERE a.user_id=auth.uid()),'[]'::jsonb),
    'local',(
      SELECT jsonb_build_object('id',l.id,'city_id',l.city_id,'city',c.name,'status',l.status,'since',l.seat_started_on,
        'monthly_rate_minor',cp.monthly_rate_minor,'payout_currency',cp.payout_currency)
      FROM public.locals l JOIN public.seeding_cities c ON c.id=l.city_id
      LEFT JOIN public.local_city_programs cp ON cp.city_id=l.city_id WHERE l.user_id=auth.uid()
    )
  );
$fn$;

-- ---------------------------------------------------------------------------
-- #18 One conflict source for the picker and the pick; #3 flag on pick.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_3872_local_place_conflict(p_local_id uuid,p_place_id uuid) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_local public.locals; v_place public.place_pool; v_month date:=date_trunc('month',current_date)::date;
BEGIN
  SELECT * INTO v_local FROM public.locals WHERE id=p_local_id;
  SELECT * INTO v_place FROM public.place_pool WHERE id=p_place_id;
  IF v_local.id IS NULL OR v_place.id IS NULL OR v_place.city_id IS DISTINCT FROM v_local.city_id
     OR NOT v_place.is_active OR NOT coalesce(v_place.is_servable,true) THEN
    RETURN 'place_not_eligible';
  END IF;
  -- 12 months: one Local review per place per city per year.
  IF EXISTS(SELECT 1 FROM public.local_months m JOIN public.locals l ON l.id=m.local_id
      WHERE m.place_id=p_place_id AND l.city_id=v_local.city_id AND m.month>=v_month-interval '12 months' AND m.status NOT IN ('void','missed')) THEN
    RETURN 'city_place_recently_reviewed';
  END IF;
  IF EXISTS(SELECT 1 FROM public.local_months m WHERE m.local_id=v_local.id AND m.place_id=p_place_id AND m.status NOT IN ('void','missed')) THEN
    RETURN 'local_already_reviewed_place';
  END IF;
  -- 180 days: no paid relationship with any brand tied to the place, whether
  -- it authored the place or holds a verified claim on it. The picker used
  -- the first source and the pick used the second, so they disagreed.
  IF EXISTS(
    SELECT 1 FROM (
      SELECT v_place.business_author_brand_id AS brand_id
      UNION SELECT vl.brand_id FROM public.venue_listings vl WHERE vl.place_pool_id=p_place_id AND vl.claim_status='verified'
    ) b
    WHERE b.brand_id IS NOT NULL AND (
      EXISTS(SELECT 1 FROM public.gig_contracts gc WHERE gc.brand_id=b.brand_id AND gc.creator_account_id=v_local.user_id AND gc.created_at>=now()-interval '180 days')
      OR EXISTS(SELECT 1 FROM public.payee_shares ps WHERE ps.brand_id=b.brand_id AND ps.payee_user_id=v_local.user_id AND ps.created_at>=now()-interval '180 days'))
  ) THEN
    RETURN 'paid_relationship_conflict';
  END IF;
  RETURN NULL;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.local_place_candidates(p_query text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path=public,pg_temp AS $fn$
DECLARE v_actor uuid:=auth.uid(); v_local public.locals;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.feature_flags WHERE flag_key='mingla_locals_enabled' AND is_enabled) THEN
    RAISE EXCEPTION 'locals_not_open' USING ERRCODE='55000';
  END IF;
  SELECT * INTO v_local FROM public.locals WHERE user_id=v_actor AND status='active';
  IF NOT FOUND THEN RAISE EXCEPTION 'active_local_required' USING ERRCODE='42501'; END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'id',q.id,'name',q.name,'address',q.address,'primary_type',q.primary_type_display_name,
      'eligible',q.code IS NULL,'reason_code',q.code,
      'reason',CASE q.code
        WHEN 'city_place_recently_reviewed' THEN 'Reviewed by a Local in the last 12 months'
        WHEN 'local_already_reviewed_place' THEN 'You already reviewed this place'
        WHEN 'paid_relationship_conflict' THEN 'Recent paid relationship with this place'
        WHEN 'place_not_eligible' THEN 'This place can’t be picked right now'
        ELSE NULL END
    ) ORDER BY q.name)
    FROM (
      SELECT p.id,p.name,p.address,p.primary_type_display_name,public.issue_3872_local_place_conflict(v_local.id,p.id) AS code
      FROM public.place_pool p
      WHERE p.city_id=v_local.city_id AND p.is_active AND coalesce(p.is_servable,true)
        AND (nullif(btrim(p_query),'') IS NULL OR p.name ILIKE '%'||btrim(p_query)||'%')
      ORDER BY p.name
      LIMIT 40
    ) q
  ),'[]'::jsonb);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.local_pick_place(p_place_id uuid,p_personal_tie boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_actor uuid:=auth.uid(); v_local public.locals; v_month date:=date_trunc('month',current_date)::date; v_id uuid; v_conflict text;
BEGIN
  -- #3: the pick ignored the global Locals kill switch.
  IF NOT EXISTS(SELECT 1 FROM public.feature_flags WHERE flag_key='mingla_locals_enabled' AND is_enabled) THEN
    RAISE EXCEPTION 'locals_not_open' USING ERRCODE='55000';
  END IF;
  SELECT * INTO v_local FROM public.locals WHERE user_id=v_actor AND status='active' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'active_local_required' USING ERRCODE='42501'; END IF;
  IF extract(day FROM current_date)>7 THEN RAISE EXCEPTION 'pick_window_closed' USING ERRCODE='55000'; END IF;
  IF p_personal_tie THEN RAISE EXCEPTION 'personal_tie_conflict' USING ERRCODE='23514'; END IF;
  v_conflict:=public.issue_3872_local_place_conflict(v_local.id,p_place_id);
  IF v_conflict IS NOT NULL THEN RAISE EXCEPTION '%',v_conflict USING ERRCODE='23514'; END IF;
  INSERT INTO public.local_months(local_id,month,place_id,status,picked_at,confirmed_at)
  VALUES(v_local.id,v_month,p_place_id,'confirmed',now(),now()) RETURNING id INTO v_id;
  INSERT INTO public.local_events(local_id,local_month_id,actor,kind,data) VALUES(v_local.id,v_id,'local','local_pick',jsonb_build_object('result','confirmed','place_id',p_place_id));
  RETURN jsonb_build_object('ok',true,'local_month_id',v_id,'status','confirmed');
END;
$fn$;

CREATE OR REPLACE FUNCTION public.local_review_submit(p_local_month_id uuid,p_rating integer,p_title text,p_body text,p_visited_on date,p_spend_band text,p_media_job_ids uuid[],p_social_post_url text,p_disclosure_ack boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_month public.local_months; v_now date:=current_date;
BEGIN
  SELECT m.* INTO v_month FROM public.local_months m JOIN public.locals l ON l.id=m.local_id WHERE m.id=p_local_month_id AND l.user_id=auth.uid() FOR UPDATE OF m;
  IF NOT FOUND OR v_month.status NOT IN ('visited','changes_requested') THEN RAISE EXCEPTION 'review_not_submittable' USING ERRCODE='55000'; END IF;
  IF v_now>=(v_month.month+interval '1 month 3 days')::date OR (v_month.status='changes_requested' AND (v_month.changes_due_at IS NULL OR now()>v_month.changes_due_at OR v_month.resubmission_count>=1)) THEN RAISE EXCEPTION 'review_deadline_passed' USING ERRCODE='55000'; END IF;
  -- #18: the visit must fall inside this Local month and not in the future
  -- (a 2025-01-01 visit used to pass).
  IF p_visited_on IS NULL OR date_trunc('month',p_visited_on)::date<>v_month.month OR p_visited_on>v_now THEN
    RAISE EXCEPTION 'visited_on_outside_month' USING ERRCODE='22023';
  END IF;
  -- #18: the disclosed social post must be on a supported social host.
  IF p_social_post_url IS NULL OR p_social_post_url !~* '^https://((www|m|vm)\.)?(instagram\.com|tiktok\.com|youtube\.com|youtu\.be|x\.com|twitter\.com|facebook\.com|threads\.net)/[^[:space:]]+$' THEN
    RAISE EXCEPTION 'social_post_url_not_allowed' USING ERRCODE='22023';
  END IF;
  IF NOT p_disclosure_ack
    OR cardinality(p_media_job_ids) NOT BETWEEN 1 AND 6
    OR EXISTS(SELECT 1 FROM unnest(p_media_job_ids) id WHERE NOT EXISTS(
      SELECT 1 FROM public.creator_media_jobs j
      WHERE j.id=id AND j.owner_kind='local' AND j.owner_id=auth.uid()
        AND j.local_month_id=v_month.id AND j.purpose='local_review'
        AND j.status='ready' AND j.deleted_at IS NULL
    ))
    OR (
      EXISTS(SELECT 1 FROM public.creator_media_jobs j WHERE j.id=ANY(p_media_job_ids) AND j.duration_s IS NOT NULL)
      AND (
        cardinality(p_media_job_ids)<>1
        OR NOT EXISTS(SELECT 1 FROM public.creator_media_jobs j WHERE j.id=p_media_job_ids[1] AND j.duration_s>0)
      )
    )
  THEN RAISE EXCEPTION 'review_evidence_invalid' USING ERRCODE='22023'; END IF;
  INSERT INTO public.local_reviews(local_month_id,rating,title,body,visited_on,spend_band,media_job_ids,social_post_url,disclosure_ack)
  VALUES(v_month.id,p_rating,btrim(p_title),btrim(p_body),p_visited_on,p_spend_band,p_media_job_ids,p_social_post_url,true)
  ON CONFLICT(local_month_id) DO UPDATE SET rating=excluded.rating,title=excluded.title,body=excluded.body,visited_on=excluded.visited_on,spend_band=excluded.spend_band,media_job_ids=excluded.media_job_ids,social_post_url=excluded.social_post_url,social_check_status='pending',social_check_detail='{}',disclosure_ack=true,changes_requested='{}';
  UPDATE public.local_months SET status='submitted',submitted_at=now(),resubmission_count=CASE WHEN status='changes_requested' THEN resubmission_count+1 ELSE resubmission_count END,changes_due_at=NULL WHERE id=v_month.id;
  INSERT INTO public.local_events(local_id,local_month_id,actor,kind) VALUES(v_month.local_id,v_month.id,'local','local_submitted');
  RETURN jsonb_build_object('ok',true,'status','submitted');
END;
$fn$;

-- #15: voiding a month after its payout share exists reverses that share.
CREATE OR REPLACE FUNCTION public.local_month_void(p_local_month_id uuid,p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v public.local_months; v_share public.payee_shares; v_reversed bigint:=0;
BEGIN
  IF NOT public.is_admin_user() OR nullif(btrim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'admin_only_or_reason_required' USING ERRCODE='42501'; END IF;
  SELECT * INTO v FROM public.local_months WHERE id=p_local_month_id FOR UPDATE;
  IF NOT FOUND OR v.status IN ('paid','void') THEN RAISE EXCEPTION 'local_month_not_voidable' USING ERRCODE='55000'; END IF;
  IF v.payee_share_id IS NOT NULL THEN
    SELECT * INTO v_share FROM public.payee_shares WHERE id=v.payee_share_id FOR UPDATE;
    -- Money already handed to a provider cannot be voided here.
    IF v_share.status='paid' OR v_share.payout_id IS NOT NULL THEN
      RAISE EXCEPTION 'local_month_payout_in_flight' USING ERRCODE='55000';
    END IF;
    v_reversed:=v_share.gross_minor-v_share.reversed_minor;
    IF v_reversed>0 THEN
      INSERT INTO public.payee_share_reversals(share_id,refund_ref,amount_minor,refunded_eligible_minor,net_amount_minor)
      VALUES(v_share.id,'local_void:'||v.id::text,v_reversed,0,v_reversed);
    END IF;
  END IF;
  UPDATE public.local_months SET status='void',place_id=NULL,void_reason=btrim(p_reason),changes_due_at=NULL WHERE id=v.id RETURNING * INTO v;
  INSERT INTO public.local_events(local_id,local_month_id,actor,kind,data) VALUES(v.local_id,v.id,'admin','local_voided',jsonb_build_object('reason',p_reason,'share_reversed_minor',v_reversed));
  RETURN jsonb_build_object('ok',true,'status','void','share_reversed_minor',v_reversed);
END;
$fn$;

-- The city program sets the rate and the currency the Local is paid in.
CREATE OR REPLACE FUNCTION public.local_payout_prepare(p_local_month_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_month public.local_months; v_local public.locals; v_program public.local_city_programs; v_account public.payee_accounts; v_currency text; v_rail text; v_snapshot uuid;
BEGIN
  IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'service_role_only' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_month FROM public.local_months WHERE id=p_local_month_id FOR UPDATE;
  IF NOT FOUND OR v_month.status<>'published' THEN RAISE EXCEPTION 'local_month_not_payable' USING ERRCODE='55000'; END IF;
  IF v_month.payee_share_id IS NOT NULL THEN RETURN jsonb_build_object('ok',true,'replayed',true,'currency',v_month.payout_currency,'amount_minor',v_month.payout_amount_minor); END IF;
  SELECT * INTO v_local FROM public.locals WHERE id=v_month.local_id;
  SELECT * INTO v_program FROM public.local_city_programs WHERE city_id=v_local.city_id;
  IF v_program.city_id IS NULL THEN RAISE EXCEPTION 'local_city_program_missing' USING ERRCODE='55000'; END IF;
  SELECT * INTO v_account FROM public.payee_accounts WHERE user_id=v_local.user_id;
  v_currency:=v_program.payout_currency;
  IF v_currency='NGN' THEN
    IF v_account.paystack_status IS DISTINCT FROM 'verified' OR upper(coalesce(v_account.paystack_currency,''))<>'NGN' THEN RAISE EXCEPTION 'active_payee_required' USING ERRCODE='55000'; END IF;
    v_rail:='paystack';
  ELSE
    IF v_account.stripe_status IS DISTINCT FROM 'active' THEN RAISE EXCEPTION 'active_payee_required' USING ERRCODE='55000'; END IF;
    v_rail:='stripe';
  END IF;
  -- No conversion: the rate is set in the payout currency. The active FX
  -- snapshot is still recorded on the month as the audit reference.
  SELECT s.id INTO v_snapshot FROM public.fx_rate_snapshots s WHERE s.status='active' ORDER BY s.fetched_at DESC LIMIT 1;
  IF v_snapshot IS NULL THEN RAISE EXCEPTION 'active_fx_rate_required' USING ERRCODE='55000'; END IF;
  RETURN jsonb_build_object('ok',true,'rail',v_rail,'currency',v_currency,'amount_minor',v_program.monthly_rate_minor,'fx_snapshot_id',v_snapshot,'monthly_rate_minor',v_program.monthly_rate_minor);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.admin_local_queue() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path=public,pg_temp AS $fn$
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'admin_only' USING ERRCODE='42501'; END IF;
  RETURN jsonb_build_object(
    'cities',coalesce((SELECT jsonb_agg(jsonb_build_object('id',c.id,'name',c.name) ORDER BY c.name) FROM public.seeding_cities c),'[]'::jsonb),
    'programs',coalesce((SELECT jsonb_agg(jsonb_build_object('city_id',p.city_id,'city',c.name,'seats',p.seats,'active',(SELECT count(*) FROM public.locals l WHERE l.city_id=p.city_id AND l.status='active'),'is_open',p.is_open,'monthly_usd_minor',p.monthly_usd_minor,'monthly_rate_minor',p.monthly_rate_minor,'payout_currency',p.payout_currency) ORDER BY c.name) FROM public.local_city_programs p JOIN public.seeding_cities c ON c.id=p.city_id),'[]'::jsonb),
    'applications',coalesce((SELECT jsonb_agg(jsonb_build_object('id',a.id,'user_id',a.user_id,'city_id',a.city_id,'city',c.name,'handles',a.handles,'sample_links',a.sample_links,'why',a.why,'status',a.status,'created_at',a.created_at) ORDER BY a.created_at) FROM public.local_applications a JOIN public.seeding_cities c ON c.id=a.city_id WHERE a.status IN ('submitted','shortlisted','waitlisted')),'[]'::jsonb),
    'picks',coalesce((SELECT jsonb_agg(jsonb_build_object('local_month_id',m.id,'local_id',m.local_id,'local_name',coalesce(nullif(btrim(p.display_name),''),p.username),'city',c.name,'place_id',m.place_id,'place_name',pp.name,'status',m.status,'picked_at',m.picked_at) ORDER BY m.picked_at DESC NULLS LAST) FROM public.local_months m JOIN public.locals l ON l.id=m.local_id JOIN public.profiles p ON p.id=l.user_id JOIN public.seeding_cities c ON c.id=l.city_id LEFT JOIN public.place_pool pp ON pp.id=m.place_id WHERE m.month=date_trunc('month',current_date)::date),'[]'::jsonb),
    'reviews',coalesce((SELECT jsonb_agg(jsonb_build_object('local_month_id',m.id,'local_id',m.local_id,'local_name',coalesce(p.display_name,p.username),'place_name',pp.name,'month',m.month,'status',m.status,'review',to_jsonb(r),'events',(SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.created_at,e.id),'[]'::jsonb) FROM public.local_events e WHERE e.local_month_id=m.id)) ORDER BY m.submitted_at) FROM public.local_months m JOIN public.local_reviews r ON r.local_month_id=m.id JOIN public.locals l ON l.id=m.local_id JOIN public.profiles p ON p.id=l.user_id JOIN public.place_pool pp ON pp.id=m.place_id WHERE m.status IN ('submitted','changes_requested')),'[]'::jsonb),
    'payouts',coalesce((SELECT jsonb_agg(jsonb_build_object('local_month_id',m.id,'local_name',coalesce(p.display_name,p.username),'month',m.month,'status',m.status,'currency',m.payout_currency,'amount_minor',m.payout_amount_minor,'share_status',s.status) ORDER BY m.month DESC) FROM public.local_months m JOIN public.locals l ON l.id=m.local_id JOIN public.profiles p ON p.id=l.user_id LEFT JOIN public.payee_shares s ON s.id=m.payee_share_id WHERE m.status IN ('published','paid')),'[]'::jsonb)
  );
END;
$fn$;

-- ---------------------------------------------------------------------------
-- Creator earnings summary: On the way · Ready · Paid (the caller's money).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.creator_earnings_summary() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path=public,pg_temp AS $fn$
DECLARE v_actor uuid:=auth.uid(); v_rows jsonb; v_currency text;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='28000'; END IF;
  WITH rows AS (
    -- Ledger shares: never "paid" before the provider says so.
    SELECT CASE s.payee_kind WHEN 'gig_fee' THEN 'gig' WHEN 'local_month' THEN 'local' ELSE 'referral' END AS kind,
      CASE s.payee_kind
        WHEN 'gig_fee' THEN coalesce(g.title_public,'Creator gig')
        WHEN 'local_month' THEN 'Mingla Local · '||to_char(lm.month,'Mon YYYY')
        ELSE coalesce(e.title,vl.name,b.name,'Referral reward') END AS title,
      greatest(s.net_minor-s.reversed_minor,0) AS amount_minor,s.currency,
      CASE WHEN s.status IN ('pending','held_until_event') THEN 'on_the_way'
           WHEN s.status='paid' THEN 'paid' ELSE 'ready' END AS state,
      coalesce(s.updated_at,s.created_at) AS at
    FROM public.payee_shares s
    LEFT JOIN public.gig_contracts gc ON s.payee_kind='gig_fee' AND gc.id=s.order_id
    LEFT JOIN public.gigs g ON g.id=gc.gig_id
    LEFT JOIN public.local_months lm ON s.payee_kind='local_month' AND lm.id=s.order_id
    LEFT JOIN public.orders o ON s.order_kind='ticket' AND o.id=s.order_id
    LEFT JOIN public.events e ON e.id=o.event_id
    LEFT JOIN public.venue_orders vo ON s.order_kind='venue_order' AND vo.id=s.order_id
    LEFT JOIN public.venue_listings vl ON vl.id=vo.venue_id
    LEFT JOIN public.brands b ON b.id=s.brand_id
    WHERE s.payee_user_id=v_actor AND s.status NOT IN ('reversed','unclaimed_expired') AND s.net_minor-s.reversed_minor>0
    UNION ALL
    -- Gig fee held while the work is in progress.
    SELECT 'gig',g.title_public,tv.fee_minor,tv.currency,'on_the_way',c.updated_at
    FROM public.gig_contracts c
    JOIN public.gigs g ON g.id=c.gig_id
    JOIN public.gig_terms_versions tv ON tv.contract_id=c.id AND tv.version=c.current_terms_version
    JOIN public.gig_holds h ON h.contract_id=c.id AND h.terms_version=c.current_terms_version AND h.status='captured'
    WHERE c.creator_account_id=v_actor
      AND c.state IN ('accepted','shoot_planned','script_drafting','script_sent','script_locked','delivered','fix_requested','approved','posting','posts_submitted','posts_failed','posts_verified','disputed')
      AND NOT EXISTS(SELECT 1 FROM public.payee_shares x WHERE x.order_kind='gig' AND x.order_id=c.id)
    UNION ALL
    -- Local month approved but not yet in the ledger.
    SELECT 'local','Mingla Local · '||to_char(m.month,'Mon YYYY'),cp.monthly_rate_minor,cp.payout_currency,'on_the_way',coalesce(m.approved_at,m.updated_at)
    FROM public.local_months m
    JOIN public.locals l ON l.id=m.local_id
    JOIN public.local_city_programs cp ON cp.city_id=l.city_id
    WHERE l.user_id=v_actor AND m.status IN ('approved','published') AND m.payee_share_id IS NULL
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('kind',kind,'title',title,'amount_minor',amount_minor,'currency',currency,'state',state,'at',at) ORDER BY at DESC),'[]'::jsonb),
    (SELECT r.currency FROM rows r GROUP BY r.currency ORDER BY sum(r.amount_minor) DESC,r.currency LIMIT 1)
  INTO v_rows,v_currency FROM rows;
  v_currency:=coalesce(v_currency,(SELECT upper(p.currency) FROM public.profiles p WHERE p.id=v_actor),'USD');
  -- Totals are in the main currency only; rows keep their own currency.
  RETURN jsonb_build_object(
    'currency',v_currency,
    'on_the_way_minor',coalesce((SELECT sum((r->>'amount_minor')::bigint) FROM jsonb_array_elements(v_rows) r WHERE r->>'currency'=v_currency AND r->>'state'='on_the_way'),0),
    'ready_minor',coalesce((SELECT sum((r->>'amount_minor')::bigint) FROM jsonb_array_elements(v_rows) r WHERE r->>'currency'=v_currency AND r->>'state'='ready'),0),
    'paid_minor',coalesce((SELECT sum((r->>'amount_minor')::bigint) FROM jsonb_array_elements(v_rows) r WHERE r->>'currency'=v_currency AND r->>'state'='paid'),0),
    'rows',v_rows
  );
END;
$fn$;

-- ---------------------------------------------------------------------------
-- Grants.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.issue_3872_jsonb_value(jsonb),public.issue_3872_local_program_rate_default(),public.issue_3872_referral_member_name_source(),public.issue_3872_payee_share_freeze(),
  public.issue_3872_local_place_conflict(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3872_jsonb_value(jsonb),public.issue_3872_local_place_conflict(uuid,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.local_city_program_save(uuid,integer,boolean,bigint,text,bigint),public.creator_earnings_summary() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.local_city_program_save(uuid,integer,boolean,bigint,text,bigint),public.creator_earnings_summary() TO authenticated,service_role;

NOTIFY pgrst,'reload schema';
COMMIT;
