-- #3872 R2 B2 — link resolution, anonymous touch throttling, immutable checkout
-- snapshots, and one-payee order finalization.
--
-- Invariant I-3872-ATTRIBUTION-SNAPSHOT (declared in its test suite): The referral decision is
-- frozen on the checkout row before a provider object is created; finalization
-- may materialize it once but can never re-resolve or rewrite it.
-- Invariant I-3872-ONE-PAYEE (declared in its test suite): Finalization inserts at
-- most one referral share and the existing order/payee uniqueness constraint is
-- the last-line database authority.

BEGIN;
SET LOCAL lock_timeout = '10s';

-- A voucher reward (including a cash offer's cross-rail fallback) must be
-- executable by the R1 discount engine without inventing a second value rail.
ALTER TABLE public.referral_offers
  ADD CONSTRAINT referral_offers_voucher_template_shape CHECK (
    voucher_template IS NULL OR (
      jsonb_typeof(voucher_template) = 'object'
      AND voucher_template->>'value_type' IN ('percent','amount')
      AND COALESCE(voucher_template->>'scope','brand') = 'brand'
      AND COALESCE(voucher_template->>'expires_days','') ~ '^[1-9][0-9]{0,2}$'
      AND (voucher_template->>'expires_days')::integer BETWEEN 1 AND 365
      AND (
        (voucher_template->>'value_type' = 'percent'
          AND COALESCE(voucher_template->>'value_bps','') ~ '^[1-9][0-9]{0,4}$'
          AND (voucher_template->>'value_bps')::integer BETWEEN 1 AND 10000
          AND NOT voucher_template ? 'value_minor')
        OR
        (voucher_template->>'value_type' = 'amount'
          AND COALESCE(voucher_template->>'value_minor','') ~ '^[1-9][0-9]*$'
          AND (voucher_template->>'value_minor')::numeric <= 2147483647
          AND NOT voucher_template ? 'value_bps')
      )
    )
  );

-- The immutable attribution keeps the touch UUID as evidence. A retention
-- delete must not issue an ON DELETE SET NULL update that the immutability
-- trigger correctly refuses, so the insertion guard is the FK-equivalent and
-- the UUID is deliberately retained after the 90-day touch cleanup.
ALTER TABLE public.order_attributions
  DROP CONSTRAINT IF EXISTS order_attributions_touch_id_fkey;

-- -------------------------------------------------------------------------
-- Public link resolution. These SECURITY DEFINER RPCs expose only safe routing
-- copy; the service-role touch function resolves the private member/tracking id.
-- -------------------------------------------------------------------------
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
  SELECT
    brand.slug,
    (
      SELECT event.slug
      FROM public.referral_offer_listings scoped
      JOIN public.events event
        ON scoped.listing_kind='event' AND event.id=scoped.listing_id
      WHERE scoped.offer_id=offer.id AND event.deleted_at IS NULL
      ORDER BY event.created_at,event.id
      LIMIT 1
    ),
    split_part(btrim(member.display_name),' ',1),
    member.status='active'
      AND member.removed_at IS NULL
      AND offer.deleted_at IS NULL
      AND offer.status='active'
      AND offer.starts_at<=now()
      AND (offer.ends_at IS NULL OR offer.ends_at>now())
      AND public.issue_3872_referrals_on(offer.brand_id)
  FROM public.referral_members member
  JOIN public.referral_offers offer ON offer.id=member.offer_id
  JOIN public.brands brand ON brand.id=member.brand_id
  WHERE member.link_slug=lower(btrim(p_slug))
    AND brand.deleted_at IS NULL
  LIMIT 1;
$fn$;
REVOKE ALL ON FUNCTION public.referral_link_resolve(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.referral_link_resolve(text)
  TO anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.tracking_link_resolve(p_slug text)
RETURNS TABLE(
  brand_slug text,
  event_slug text,
  venue_slug text,
  link_active boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT
    brand.slug,
    CASE WHEN link.listing_kind='event' THEN event.slug END,
    CASE WHEN link.listing_kind='venue' THEN venue.slug END,
    link.archived_at IS NULL
      AND brand.deleted_at IS NULL
      AND public.issue_3872_referrals_on(link.brand_id)
  FROM public.host_tracking_links link
  JOIN public.brands brand ON brand.id=link.brand_id
  LEFT JOIN public.events event
    ON link.listing_kind='event' AND event.id=link.listing_id
  LEFT JOIN public.venue_listings venue
    ON link.listing_kind='venue' AND venue.id=link.listing_id
  WHERE link.slug=lower(btrim(p_slug))
  LIMIT 1;
$fn$;
REVOKE ALL ON FUNCTION public.tracking_link_resolve(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tracking_link_resolve(text)
  TO anon,authenticated,service_role;

-- -------------------------------------------------------------------------
-- Durable, cross-isolate guest touch rate limit: 60 per minute independently
-- for the HMAC device digest and HMAC IP digest. No raw token or IP is stored.
-- -------------------------------------------------------------------------
CREATE TABLE public.referral_touch_rate_limits (
  scope_kind text NOT NULL CHECK (scope_kind IN ('device','ip')),
  scope_hash text NOT NULL CHECK (scope_hash ~ '^[a-f0-9]{64}$'),
  window_started_at timestamptz NOT NULL,
  hit_count integer NOT NULL CHECK (hit_count BETWEEN 1 AND 60),
  PRIMARY KEY(scope_kind,scope_hash,window_started_at),
  CONSTRAINT referral_touch_rate_minute CHECK (
    window_started_at=date_trunc('minute',window_started_at)
  )
);
CREATE INDEX referral_touch_rate_retention_idx
  ON public.referral_touch_rate_limits(window_started_at);
ALTER TABLE public.referral_touch_rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_touch_rate_limits FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.referral_touch_rate_limits
  FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE public.referral_touch_rate_limits
  TO service_role;

CREATE OR REPLACE FUNCTION public.issue_3872_claim_referral_touch_rate(
  p_device_hash text,
  p_ip_hash text,
  p_now timestamptz DEFAULT now()
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_window timestamptz := date_trunc('minute',p_now);
  v_scope text;
  v_hash text;
  v_count integer;
BEGIN
  IF p_device_hash !~ '^[a-f0-9]{64}$' OR p_ip_hash !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'referral_touch_hash_invalid';
  END IF;
  FOREACH v_scope IN ARRAY ARRAY['device','ip'] LOOP
    v_hash := CASE WHEN v_scope='device' THEN p_device_hash ELSE p_ip_hash END;
    INSERT INTO public.referral_touch_rate_limits(
      scope_kind,scope_hash,window_started_at,hit_count
    ) VALUES(v_scope,v_hash,v_window,1)
    ON CONFLICT(scope_kind,scope_hash,window_started_at) DO UPDATE
      SET hit_count=public.referral_touch_rate_limits.hit_count+1
      WHERE public.referral_touch_rate_limits.hit_count<60
    RETURNING hit_count INTO v_count;
    IF v_count IS NULL THEN
      RAISE EXCEPTION 'referral_touch_rate_limited';
    END IF;
  END LOOP;
END;
$fn$;
REVOKE ALL ON FUNCTION public.issue_3872_claim_referral_touch_rate(text,text,timestamptz)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3872_claim_referral_touch_rate(text,text,timestamptz)
  TO service_role;

CREATE OR REPLACE FUNCTION public.issue_3872_referral_touch_rate_cleanup(
  p_before timestamptz DEFAULT now()-interval '2 hours'
) RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE v_count bigint;
BEGIN
  DELETE FROM public.referral_touch_rate_limits
  WHERE window_started_at<p_before;
  GET DIAGNOSTICS v_count=ROW_COUNT;
  RETURN v_count;
END;
$fn$;
REVOKE ALL ON FUNCTION public.issue_3872_referral_touch_rate_cleanup(timestamptz)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3872_referral_touch_rate_cleanup(timestamptz)
  TO service_role;

-- -------------------------------------------------------------------------
-- Checkout snapshot validation and immutability.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_3872_referral_snapshot_valid(
  p_snapshot jsonb,
  p_order_kind text
) RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $fn$
  SELECT p_snapshot IS NULL OR (
    jsonb_typeof(p_snapshot)='object'
    AND p_snapshot->>'version'='1'
    AND p_snapshot->>'orderKind'=p_order_kind
    AND p_snapshot->>'source' IN ('code','member_link','tracking_link','none')
    AND p_snapshot->>'listingKind' IN ('event','venue')
    AND COALESCE(p_snapshot->>'listingId','') ~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    AND p_snapshot->>'rail' IN ('stripe','paystack')
    AND COALESCE(p_snapshot->>'currency','') ~ '^[A-Z]{3}$'
    AND COALESCE(p_snapshot->>'eligibleMinor','') ~ '^(0|[1-9][0-9]*)$'
    AND COALESCE(p_snapshot->>'shareMinor','') ~ '^(0|[1-9][0-9]*)$'
    AND (p_snapshot->>'shareMinor')::numeric <= (p_snapshot->>'eligibleMinor')::numeric
    AND (
      p_snapshot->'shareBps'='null'::jsonb OR (
        COALESCE(p_snapshot->>'shareBps','') ~ '^[1-9][0-9]{2,3}$'
        AND (p_snapshot->>'shareBps')::integer BETWEEN 100 AND 5000
      )
    )
    AND (
      p_snapshot->'rewardKind'='null'::jsonb
      OR p_snapshot->>'rewardKind' IN ('cash','voucher','perk')
    )
    AND (
      p_snapshot->'rejectedReason'='null'::jsonb
      OR p_snapshot->>'rejectedReason' IN (
        'self_referral','member_removed','offer_ended','budget_reached','cross_rail'
      )
    )
    AND (
      p_snapshot->'touchId'='null'::jsonb
      OR COALESCE(p_snapshot->>'touchId','') ~
        '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    )
    AND (
      p_snapshot->'memberId'='null'::jsonb
      OR COALESCE(p_snapshot->>'memberId','') ~
        '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    )
    AND (
      p_snapshot->'trackingId'='null'::jsonb
      OR COALESCE(p_snapshot->>'trackingId','') ~
        '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    )
    AND (
      p_snapshot->'offerId'='null'::jsonb
      OR COALESCE(p_snapshot->>'offerId','') ~
        '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    )
    AND (
      p_snapshot->'payeeUserId'='null'::jsonb
      OR COALESCE(p_snapshot->>'payeeUserId','') ~
        '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    )
    AND (
      p_snapshot->'payeeEmailNorm'='null'::jsonb
      OR (
        p_snapshot->>'payeeEmailNorm'=lower(btrim(p_snapshot->>'payeeEmailNorm'))
        AND position('@' in p_snapshot->>'payeeEmailNorm')>1
      )
    )
    AND CASE p_snapshot->>'source'
      WHEN 'code' THEN p_snapshot->'memberId'<>'null'::jsonb
        AND p_snapshot->'offerId'<>'null'::jsonb
        AND p_snapshot->'touchId'='null'::jsonb
      WHEN 'member_link' THEN p_snapshot->'memberId'<>'null'::jsonb
        AND p_snapshot->'offerId'<>'null'::jsonb
        AND p_snapshot->'touchId'<>'null'::jsonb
      WHEN 'tracking_link' THEN p_snapshot->'memberId'='null'::jsonb
        AND p_snapshot->'trackingId'<>'null'::jsonb
        AND p_snapshot->'touchId'<>'null'::jsonb
        AND (p_snapshot->>'shareMinor')::numeric=0
      WHEN 'none' THEN p_snapshot->'memberId'='null'::jsonb
        AND p_snapshot->'trackingId'='null'::jsonb
        AND p_snapshot->'touchId'='null'::jsonb
        AND (p_snapshot->>'shareMinor')::numeric=0
      ELSE false
    END
    AND (
      p_snapshot->'rejectedReason'='null'::jsonb
      OR (p_snapshot->>'shareMinor')::numeric=0
    )
    AND (
      (p_snapshot->>'shareMinor')::numeric=0
      OR (
        p_snapshot->>'rewardKind'='cash'
        AND p_snapshot->'memberId'<>'null'::jsonb
        AND p_snapshot->'offerId'<>'null'::jsonb
        AND (
          p_snapshot->'payeeUserId'<>'null'::jsonb
          OR p_snapshot->'payeeEmailNorm'<>'null'::jsonb
        )
      )
    )
    AND (
      p_snapshot->>'rewardKind'<>'voucher'
      OR jsonb_typeof(p_snapshot->'voucherTemplate')='object'
    )
  );
$fn$;
REVOKE ALL ON FUNCTION public.issue_3872_referral_snapshot_valid(jsonb,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3872_referral_snapshot_valid(jsonb,text)
  TO service_role;

ALTER TABLE public.ticket_checkout_sessions
  ADD COLUMN referral_attribution_snapshot jsonb,
  ADD CONSTRAINT ticket_checkout_referral_snapshot_shape CHECK (
    public.issue_3872_referral_snapshot_valid(referral_attribution_snapshot,'ticket')
  );
ALTER TABLE public.venue_orders
  ADD COLUMN referral_attribution_snapshot jsonb,
  ADD CONSTRAINT venue_order_referral_snapshot_shape CHECK (
    public.issue_3872_referral_snapshot_valid(referral_attribution_snapshot,'venue_order')
  );
ALTER TABLE public.order_installments
  ADD COLUMN referral_share_minor bigint NOT NULL DEFAULT 0,
  ADD CONSTRAINT order_installments_referral_share_bounds CHECK (
    referral_share_minor BETWEEN 0 AND amount_cents
  );

COMMENT ON COLUMN public.ticket_checkout_sessions.referral_attribution_snapshot IS
  '#3872 D8: immutable create-time resolver output. It changes application fee only; buyer totals never include the share.';
COMMENT ON COLUMN public.venue_orders.referral_attribution_snapshot IS
  '#3872 D8: immutable create-time resolver output. It changes application fee only; buyer totals never include the share.';

CREATE OR REPLACE FUNCTION public.issue_3872_referral_snapshot_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF OLD.referral_attribution_snapshot IS NOT NULL
     AND NEW.referral_attribution_snapshot IS DISTINCT FROM OLD.referral_attribution_snapshot THEN
    RAISE EXCEPTION 'referral_attribution_snapshot_immutable';
  END IF;
  RETURN NEW;
END;
$fn$;
CREATE TRIGGER ticket_checkout_referral_snapshot_immutable
BEFORE UPDATE OF referral_attribution_snapshot ON public.ticket_checkout_sessions
FOR EACH ROW EXECUTE FUNCTION public.issue_3872_referral_snapshot_immutable();
CREATE TRIGGER venue_order_referral_snapshot_immutable
BEFORE UPDATE OF referral_attribution_snapshot ON public.venue_orders
FOR EACH ROW EXECUTE FUNCTION public.issue_3872_referral_snapshot_immutable();

-- A retried checkout must reuse the snapshot that won the first create race.
-- The provider fee and the materialized ledger therefore always read the same
-- immutable decision, even when an offer is paused between network retries.
CREATE OR REPLACE FUNCTION public.issue_3872_freeze_ticket_referral_snapshot(
  p_checkout_session_id uuid,
  p_event_id uuid,
  p_snapshot jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_snapshot jsonb;
BEGIN
  IF NOT public.issue_3872_referral_snapshot_valid(p_snapshot,'ticket') THEN
    RAISE EXCEPTION 'referral_attribution_snapshot_invalid';
  END IF;

  SELECT referral_attribution_snapshot
  INTO v_snapshot
  FROM public.ticket_checkout_sessions
  WHERE id=p_checkout_session_id
    AND event_id=p_event_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'checkout_session_not_found';
  END IF;

  IF v_snapshot IS NULL THEN
    UPDATE public.ticket_checkout_sessions
    SET referral_attribution_snapshot=p_snapshot,
        updated_at=now()
    WHERE id=p_checkout_session_id;
    v_snapshot:=p_snapshot;
  END IF;
  RETURN v_snapshot;
END;
$fn$;
REVOKE ALL ON FUNCTION public.issue_3872_freeze_ticket_referral_snapshot(uuid,uuid,jsonb)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3872_freeze_ticket_referral_snapshot(uuid,uuid,jsonb)
  TO service_role;

-- -------------------------------------------------------------------------
-- Materialize the frozen snapshot. This function never runs the resolver.
-- -------------------------------------------------------------------------
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
  v_member_id uuid;
  v_offer_id uuid;
  v_touch_id uuid;
  v_tracking_id uuid;
  v_payee_user_id uuid;
  v_payee_email text;
  v_eligible bigint;
  v_share bigint;
  v_fee bigint;
  v_reward text;
  v_template jsonb;
  v_discount_id uuid;
  v_discount_code text;
  v_expires_at timestamptz;
  v_offer public.referral_offers%ROWTYPE;
BEGIN
  IF p_snapshot IS NULL THEN RETURN; END IF;
  IF NOT public.issue_3872_referral_snapshot_valid(p_snapshot,p_order_kind) THEN
    RAISE EXCEPTION 'referral_attribution_snapshot_invalid';
  END IF;

  v_member_id := NULLIF(p_snapshot->>'memberId','')::uuid;
  v_offer_id := NULLIF(p_snapshot->>'offerId','')::uuid;
  v_touch_id := NULLIF(p_snapshot->>'touchId','')::uuid;
  v_tracking_id := NULLIF(p_snapshot->>'trackingId','')::uuid;
  v_payee_user_id := NULLIF(p_snapshot->>'payeeUserId','')::uuid;
  v_payee_email := NULLIF(p_snapshot->>'payeeEmailNorm','');
  v_eligible := (p_snapshot->>'eligibleMinor')::bigint;
  v_share := (p_snapshot->>'shareMinor')::bigint;
  v_reward := NULLIF(p_snapshot->>'rewardKind','');
  v_template := p_snapshot->'voucherTemplate';

  INSERT INTO public.order_attributions(
    order_kind,order_id,brand_id,source,touch_id,member_id,tracking_id,offer_id,
    rejected_reason,eligible_minor,share_bps,share_minor
  ) VALUES(
    p_order_kind,p_order_id,p_brand_id,p_snapshot->>'source',v_touch_id,
    v_member_id,v_tracking_id,v_offer_id,NULLIF(p_snapshot->>'rejectedReason',''),
    v_eligible,
    NULLIF(p_snapshot->>'shareBps','')::integer,v_share
  ) ON CONFLICT(order_kind,order_id) DO NOTHING;

  IF NOT EXISTS (
    SELECT 1 FROM public.order_attributions attribution
    WHERE attribution.order_kind=p_order_kind AND attribution.order_id=p_order_id
      AND attribution.brand_id=p_brand_id
      AND attribution.member_id IS NOT DISTINCT FROM v_member_id
      AND attribution.tracking_id IS NOT DISTINCT FROM v_tracking_id
      AND attribution.offer_id IS NOT DISTINCT FROM v_offer_id
      AND attribution.share_minor=v_share
  ) THEN
    RAISE EXCEPTION 'referral_attribution_conflict';
  END IF;

  IF v_reward='cash' AND v_share>0 THEN
    -- D35: an installment order earns on the full discounted plan total, but
    -- each provider charge collects only its proportional share. Cumulative
    -- half-up allocation makes the deposit + installments sum exactly to the
    -- frozen whole-order obligation; the last installment absorbs rounding.
    IF p_order_kind='ticket' AND EXISTS(
      SELECT 1 FROM public.order_installments installment
      WHERE installment.order_id=p_order_id
    ) THEN
      IF (
        SELECT COALESCE(sum(installment.amount_cents),0)
        FROM public.order_installments installment
        WHERE installment.order_id=p_order_id
      )>v_eligible THEN
        RAISE EXCEPTION 'referral_installment_schedule_exceeds_eligible';
      END IF;

      WITH payment_slices AS (
        SELECT
          installment.id,
          v_eligible-sum(installment.amount_cents) OVER ()
            +COALESCE(sum(installment.amount_cents) OVER (
              ORDER BY installment.ordinal
              ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
            ),0) AS prior_minor,
          v_eligible-sum(installment.amount_cents) OVER ()
            +sum(installment.amount_cents) OVER (
              ORDER BY installment.ordinal
              ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
            ) AS cumulative_minor
        FROM public.order_installments installment
        WHERE installment.order_id=p_order_id
      ), allocations AS (
        SELECT
          slice.id,
          floor(
            (2*slice.cumulative_minor::numeric*v_share+v_eligible)
            /(2*v_eligible)
          )::bigint-floor(
            (2*slice.prior_minor::numeric*v_share+v_eligible)
            /(2*v_eligible)
          )::bigint AS share_minor
        FROM payment_slices slice
      )
      UPDATE public.order_installments installment
      SET referral_share_minor=allocation.share_minor,
          updated_at=now()
      FROM allocations allocation
      WHERE installment.id=allocation.id;
    END IF;

    v_fee := (v_share*5+50)/100;
    INSERT INTO public.payee_shares(
      order_kind,order_id,payee_kind,member_id,payee_user_id,payee_email_norm,
      brand_id,rail,currency,gross_minor,mingla_fee_minor,net_minor,status,
      release_after
    ) VALUES(
      p_order_kind,p_order_id,'referral',v_member_id,v_payee_user_id,v_payee_email,
      p_brand_id,p_snapshot->>'rail',p_snapshot->>'currency',v_share,v_fee,
      v_share-v_fee,
      CASE WHEN p_order_kind='ticket' THEN 'held_until_event' ELSE 'pending' END,
      p_release_after
    ) ON CONFLICT(order_kind,order_id,payee_kind) DO NOTHING;
    RETURN;
  END IF;

  IF v_reward='voucher' AND v_template IS NOT NULL THEN
    SELECT * INTO v_offer FROM public.referral_offers WHERE id=v_offer_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'referral_voucher_offer_missing'; END IF;
    v_expires_at := now()+make_interval(
      days => (v_template->>'expires_days')::integer
    );
    v_discount_id := gen_random_uuid();
    v_discount_code := 'R'||upper(substr(encode(extensions.gen_random_bytes(8),'hex'),1,15));
    INSERT INTO public.brand_discounts(
      id,brand_id,kind,code,name,value_type,value_bps,value_minor,currency,
      scope_kind,combines_with,starts_at,ends_at,max_total_uses,
      max_uses_per_buyer,status,source,source_ref,created_by
    ) VALUES(
      v_discount_id,p_brand_id,'voucher',v_discount_code,'Referral reward',
      v_template->>'value_type',
      CASE WHEN v_template->>'value_type'='percent'
        THEN (v_template->>'value_bps')::integer END,
      CASE WHEN v_template->>'value_type'='amount'
        THEN (v_template->>'value_minor')::integer END,
      CASE WHEN v_template->>'value_type'='amount'
        THEN p_snapshot->>'currency' END,
      'brand','automatic_only',now(),v_expires_at,1,1,'active','referral',
      v_offer_id,v_offer.created_by
    );
    INSERT INTO public.discount_grants(
      brand_id,discount_id,member_id,grantee_user_id,grantee_email_norm,
      origin_order_kind,origin_order_id,expires_at
    ) VALUES(
      p_brand_id,v_discount_id,v_member_id,v_payee_user_id,v_payee_email,
      p_order_kind,p_order_id,v_expires_at
    ) ON CONFLICT(origin_order_kind,origin_order_id) DO NOTHING;
  END IF;
END;
$fn$;
REVOKE ALL ON FUNCTION public.issue_3872_finalize_referral_attribution(text,uuid,uuid,jsonb,timestamptz)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3872_finalize_referral_attribution(text,uuid,uuid,jsonb,timestamptz)
  TO service_role;

CREATE OR REPLACE FUNCTION public.issue_3872_ticket_referral_finalize()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_snapshot jsonb;
  v_brand_id uuid;
  v_release_after timestamptz;
BEGIN
  IF NEW.checkout_session_id IS NULL THEN RETURN NEW; END IF;
  SELECT session.brand_id,session.referral_attribution_snapshot
    INTO v_brand_id,v_snapshot
  FROM public.ticket_checkout_sessions session
  WHERE session.id=NEW.checkout_session_id;
  IF v_snapshot IS NULL THEN RETURN NEW; END IF;

  SELECT GREATEST(
    COALESCE((
      SELECT max(event_date.end_at)
      FROM public.ticket_checkout_session_event_dates chosen
      JOIN public.event_dates event_date ON event_date.id=chosen.event_date_id
      WHERE chosen.checkout_session_id=NEW.checkout_session_id
    ),'-infinity'::timestamptz),
    COALESCE((
      SELECT event_date.end_at FROM public.event_dates event_date
      WHERE event_date.id=NEW.event_date_id
    ),'-infinity'::timestamptz),
    COALESCE((
      SELECT max(event_date.end_at) FROM public.event_dates event_date
      WHERE event_date.event_id=NEW.event_id
    ),'-infinity'::timestamptz),
    now()
  )+interval '24 hours' INTO v_release_after;

  PERFORM public.issue_3872_finalize_referral_attribution(
    'ticket',NEW.id,v_brand_id,v_snapshot,v_release_after
  );
  RETURN NEW;
END;
$fn$;
CREATE TRIGGER issue_3872_ticket_referral_finalize
AFTER INSERT ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.issue_3872_ticket_referral_finalize();

CREATE OR REPLACE FUNCTION public.issue_3872_venue_referral_finalize()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF NEW.payment_status<>'paid'
     OR NEW.referral_attribution_snapshot IS NULL
     OR (TG_OP='UPDATE' AND OLD.payment_status='paid') THEN
    RETURN NEW;
  END IF;
  PERFORM public.issue_3872_finalize_referral_attribution(
    'venue_order',NEW.id,NEW.brand_id,NEW.referral_attribution_snapshot,
    COALESCE(NEW.confirmed_at,now())+interval '24 hours'
  );
  RETURN NEW;
END;
$fn$;
CREATE TRIGGER issue_3872_venue_referral_finalize
AFTER INSERT OR UPDATE OF payment_status ON public.venue_orders
FOR EACH ROW EXECUTE FUNCTION public.issue_3872_venue_referral_finalize();

NOTIFY pgrst,'reload schema';
COMMIT;
