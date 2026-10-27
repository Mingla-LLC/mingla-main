-- #3872 R2 B1 — attribution, referrals, payee ledger and payout-account foundation.
--
-- Invariant I-3872-ONE-PAYEE (declared in its test suite): An eligible order has at most one referral payee share; payee_shares(order_kind,order_id,payee_kind) is the enforcement authority.
-- Invariant I-3872-NO-STORED-VALUE (declared in its test suite): Referral rewards are automatic payout obligations, vouchers or perks; no user balance, cash-out or withdrawal rail exists.

BEGIN;
SET LOCAL lock_timeout = '10s';

-- ---------------------------------------------------------------------------
-- Offer definitions and membership.
-- ---------------------------------------------------------------------------
CREATE TABLE public.referral_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 60),
  audience text NOT NULL CHECK (audience IN ('buyers','invited','both')),
  scope_kind text NOT NULL CHECK (scope_kind IN ('brand','listings')),
  reward_kind text NOT NULL CHECK (reward_kind IN ('cash','voucher','perk')),
  share_bps integer CHECK (share_bps BETWEEN 100 AND 5000),
  voucher_template jsonb,
  perk_text text CHECK (char_length(btrim(perk_text)) BETWEEN 1 AND 80),
  perk_threshold integer CHECK (perk_threshold > 0),
  buyer_discount_id uuid REFERENCES public.brand_discounts(id) ON DELETE RESTRICT,
  budget_minor bigint CHECK (budget_minor > 0),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('draft','active','paused','ended')),
  paused_reason text CHECK (paused_reason IN ('budget_reached','host','flag_off')),
  version integer NOT NULL DEFAULT 1,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT referral_offers_window CHECK (ends_at IS NULL OR ends_at > starts_at),
  CONSTRAINT referral_offers_pause_shape CHECK (
    (status = 'paused') = (paused_reason IS NOT NULL)
  ),
  CONSTRAINT referral_offers_reward_shape CHECK (
    (reward_kind = 'cash' AND share_bps IS NOT NULL
      AND (voucher_template IS NULL OR jsonb_typeof(voucher_template)='object')
      AND perk_text IS NULL AND perk_threshold IS NULL)
    OR
    (reward_kind = 'voucher' AND share_bps IS NULL
      AND jsonb_typeof(voucher_template)='object'
      AND perk_text IS NULL AND perk_threshold IS NULL)
    OR
    (reward_kind = 'perk' AND share_bps IS NULL AND voucher_template IS NULL
      AND perk_text IS NOT NULL AND perk_threshold IS NOT NULL)
  )
);
CREATE INDEX referral_offers_brand_live_idx
  ON public.referral_offers(brand_id,status,starts_at)
  WHERE deleted_at IS NULL;

CREATE TABLE public.referral_offer_listings (
  offer_id uuid NOT NULL REFERENCES public.referral_offers(id) ON DELETE CASCADE,
  listing_kind text NOT NULL CHECK (listing_kind IN ('event','venue')),
  listing_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(offer_id,listing_kind,listing_id)
);
COMMENT ON COLUMN public.referral_offer_listings.listing_id IS
  '#3872 R2: polymorphic event or venue id, paired with listing_kind. A single event_id column cannot safely represent both referral-eligible rails.';
CREATE INDEX referral_offer_listings_lookup_idx
  ON public.referral_offer_listings(listing_kind,listing_id);

CREATE TABLE public.referral_offer_tiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id uuid NOT NULL REFERENCES public.referral_offers(id) ON DELETE CASCADE,
  min_sales integer NOT NULL CHECK (min_sales > 0),
  share_bps integer NOT NULL CHECK (share_bps BETWEEN 100 AND 5000),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(offer_id,min_sales)
);

CREATE TABLE public.referral_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id uuid NOT NULL REFERENCES public.referral_offers(id) ON DELETE RESTRICT,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('buyer','promoter','creator')),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  email_norm text,
  display_name text NOT NULL CHECK (char_length(btrim(display_name)) BETWEEN 1 AND 100),
  link_slug text NOT NULL CHECK (link_slug ~ '^[a-z0-9]{8}$'),
  code text CHECK (code IS NULL OR code ~ '^[A-Z0-9]{4,16}$'),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('invited','active','removed','declined')),
  invited_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  invite_token_hash text UNIQUE CHECK (
    invite_token_hash IS NULL OR invite_token_hash ~ '^[a-f0-9]{64}$'
  ),
  invite_expires_at timestamptz,
  invite_consumed_at timestamptz,
  joined_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  removed_at timestamptz,
  CONSTRAINT referral_members_identity CHECK (user_id IS NOT NULL OR email_norm IS NOT NULL),
  CONSTRAINT referral_members_email_norm CHECK (
    email_norm IS NULL OR (email_norm = lower(btrim(email_norm)) AND position('@' in email_norm) > 1)
  ),
  CONSTRAINT referral_members_status_shape CHECK (
    (status = 'removed') = (removed_at IS NOT NULL)
  ),
  CONSTRAINT referral_members_invite_shape CHECK (
    status <> 'invited'
    OR (
      email_norm IS NOT NULL AND invite_token_hash IS NOT NULL
      AND invite_expires_at IS NOT NULL AND invite_consumed_at IS NULL
    )
  ),
  CONSTRAINT referral_members_invite_consumed_shape CHECK (
    invite_consumed_at IS NULL OR invite_token_hash IS NOT NULL
  ),
  UNIQUE(link_slug)
);
CREATE UNIQUE INDEX referral_members_brand_code_live_uq
  ON public.referral_members(brand_id,code)
  WHERE code IS NOT NULL AND status<>'removed';
CREATE UNIQUE INDEX referral_members_offer_user_live_uq
  ON public.referral_members(offer_id,user_id)
  WHERE user_id IS NOT NULL AND status<>'removed';
CREATE UNIQUE INDEX referral_members_offer_email_live_uq
  ON public.referral_members(offer_id,email_norm)
  WHERE email_norm IS NOT NULL AND status<>'removed';
CREATE INDEX referral_members_user_idx ON public.referral_members(user_id,status)
  WHERE user_id IS NOT NULL;
CREATE INDEX referral_members_email_idx ON public.referral_members(email_norm,status)
  WHERE email_norm IS NOT NULL;

CREATE TABLE public.host_tracking_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  listing_kind text CHECK (listing_kind IN ('event','venue')),
  listing_id uuid,
  label text NOT NULL CHECK (char_length(btrim(label)) BETWEEN 1 AND 60),
  slug text NOT NULL CHECK (slug ~ '^[a-z0-9][a-z0-9_-]{5,47}$'),
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  CONSTRAINT host_tracking_links_listing_shape CHECK (
    (listing_kind IS NULL) = (listing_id IS NULL)
  ),
  UNIQUE(slug)
);
CREATE INDEX host_tracking_links_brand_idx
  ON public.host_tracking_links(brand_id,created_at DESC)
  WHERE archived_at IS NULL;

-- ---------------------------------------------------------------------------
-- Attribution snapshots.
-- ---------------------------------------------------------------------------
CREATE TABLE public.attribution_touches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('member','tracking')),
  member_id uuid REFERENCES public.referral_members(id) ON DELETE SET NULL,
  tracking_id uuid REFERENCES public.host_tracking_links(id) ON DELETE SET NULL,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  listing_kind text CHECK (listing_kind IN ('event','venue')),
  listing_id uuid,
  visitor_key text NOT NULL CHECK (visitor_key ~ '^[a-f0-9]{64}$'),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  surface text NOT NULL CHECK (surface IN ('web','explorer_ios','explorer_android')),
  touched_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  CONSTRAINT attribution_touches_kind_shape CHECK (
    (kind='member' AND member_id IS NOT NULL AND tracking_id IS NULL)
    OR (kind='tracking' AND tracking_id IS NOT NULL AND member_id IS NULL)
  ),
  CONSTRAINT attribution_touches_listing_shape CHECK (
    (listing_kind IS NULL) = (listing_id IS NULL)
  ),
  CONSTRAINT attribution_touches_window CHECK (expires_at > touched_at)
);
CREATE INDEX attribution_touches_visitor_idx
  ON public.attribution_touches(visitor_key,brand_id,touched_at DESC);
CREATE INDEX attribution_touches_user_idx
  ON public.attribution_touches(user_id,brand_id,touched_at DESC)
  WHERE user_id IS NOT NULL;

CREATE TABLE public.order_attributions (
  order_kind text NOT NULL CHECK (order_kind IN ('ticket','venue_order')),
  order_id uuid NOT NULL,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE RESTRICT,
  source text NOT NULL CHECK (source IN ('code','member_link','tracking_link','none')),
  touch_id uuid REFERENCES public.attribution_touches(id) ON DELETE SET NULL,
  member_id uuid REFERENCES public.referral_members(id) ON DELETE RESTRICT,
  tracking_id uuid REFERENCES public.host_tracking_links(id) ON DELETE SET NULL,
  offer_id uuid REFERENCES public.referral_offers(id) ON DELETE RESTRICT,
  rejected_reason text CHECK (rejected_reason IN (
    'self_referral','member_removed','offer_ended','budget_reached','cross_rail'
  )),
  eligible_minor bigint NOT NULL DEFAULT 0 CHECK (eligible_minor >= 0),
  share_bps integer CHECK (share_bps BETWEEN 100 AND 5000),
  share_minor bigint NOT NULL DEFAULT 0 CHECK (share_minor >= 0 AND share_minor <= eligible_minor),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT order_attributions_source_shape CHECK (
    (source='code' AND member_id IS NOT NULL AND offer_id IS NOT NULL)
    OR (source='member_link' AND member_id IS NOT NULL AND offer_id IS NOT NULL AND touch_id IS NOT NULL)
    OR (source='tracking_link' AND tracking_id IS NOT NULL AND touch_id IS NOT NULL
      AND member_id IS NULL AND share_minor=0)
    OR (source='none' AND member_id IS NULL AND tracking_id IS NULL AND touch_id IS NULL
      AND share_minor=0)
  ),
  CONSTRAINT order_attributions_share_shape CHECK (
    (share_minor=0)
    OR (share_bps IS NOT NULL AND member_id IS NOT NULL AND offer_id IS NOT NULL)
  ),
  CONSTRAINT order_attributions_rejection_shape CHECK (
    rejected_reason IS NULL OR share_minor=0
  ),
  PRIMARY KEY(order_kind,order_id)
);
CREATE INDEX order_attributions_member_idx
  ON public.order_attributions(member_id,created_at DESC)
  WHERE member_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Payout accounts, one-payee ledger, reversals, payouts and debt.
-- ---------------------------------------------------------------------------
CREATE TABLE public.payee_accounts (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_account_id text UNIQUE,
  stripe_status text NOT NULL DEFAULT 'none'
    CHECK (stripe_status IN ('none','onboarding','restricted','active')),
  paystack_recipient_code text UNIQUE,
  paystack_status text NOT NULL DEFAULT 'none'
    CHECK (paystack_status IN ('none','verified','failed')),
  bank_name text,
  bank_account_last4 text CHECK (bank_account_last4 IS NULL OR bank_account_last4 ~ '^[0-9]{4}$'),
  stripe_country text CHECK (stripe_country IS NULL OR stripe_country ~ '^[A-Z]{2}$'),
  paystack_country text CHECK (paystack_country IS NULL OR paystack_country ~ '^[A-Z]{2}$'),
  paystack_currency text CHECK (paystack_currency IS NULL OR paystack_currency ~ '^[A-Z]{3}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payee_accounts_stripe_shape CHECK (
    (stripe_account_id IS NULL AND stripe_status='none')
    OR (stripe_account_id IS NOT NULL AND stripe_status<>'none')
  ),
  CONSTRAINT payee_accounts_paystack_shape CHECK (
    (paystack_recipient_code IS NULL AND paystack_status IN ('none','failed'))
    OR (paystack_recipient_code IS NOT NULL AND paystack_status<>'none')
  )
);

CREATE TABLE public.payee_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_kind text NOT NULL CHECK (order_kind IN ('ticket','venue_order')),
  order_id uuid NOT NULL,
  payee_kind text NOT NULL CHECK (payee_kind IN ('referral')),
  member_id uuid NOT NULL REFERENCES public.referral_members(id) ON DELETE RESTRICT,
  payee_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  payee_email_norm text,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE RESTRICT,
  rail text NOT NULL CHECK (rail IN ('stripe','paystack')),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  gross_minor bigint NOT NULL CHECK (gross_minor >= 0),
  mingla_fee_minor bigint NOT NULL CHECK (mingla_fee_minor >= 0),
  net_minor bigint NOT NULL CHECK (net_minor >= 0),
  reversed_minor bigint NOT NULL DEFAULT 0 CHECK (reversed_minor >= 0),
  status text NOT NULL CHECK (status IN (
    'pending','held_until_event','releasable','accumulating','paid','reversed',
    'failed','unclaimed_expired'
  )),
  release_after timestamptz NOT NULL,
  payout_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payee_shares_attribution_fkey
    FOREIGN KEY(order_kind,order_id)
    REFERENCES public.order_attributions(order_kind,order_id) ON DELETE RESTRICT,
  CONSTRAINT payee_shares_identity CHECK (payee_user_id IS NOT NULL OR payee_email_norm IS NOT NULL),
  CONSTRAINT payee_shares_email_norm CHECK (
    payee_email_norm IS NULL OR (
      payee_email_norm=lower(btrim(payee_email_norm)) AND position('@' in payee_email_norm)>1
    )
  ),
  CONSTRAINT payee_shares_fee_rate CHECK (
    mingla_fee_minor=((gross_minor*5+50)/100)
  ),
  CONSTRAINT payee_shares_fee_identity CHECK (gross_minor = mingla_fee_minor + net_minor),
  CONSTRAINT payee_shares_reversal_cap CHECK (reversed_minor <= gross_minor),
  CONSTRAINT payee_shares_one_payee UNIQUE(order_kind,order_id,payee_kind)
);
CREATE INDEX payee_shares_payee_idx
  ON public.payee_shares(payee_user_id,status,release_after)
  WHERE payee_user_id IS NOT NULL;
CREATE INDEX payee_shares_guest_idx
  ON public.payee_shares(payee_email_norm,status,release_after)
  WHERE payee_email_norm IS NOT NULL;
CREATE INDEX payee_shares_brand_idx
  ON public.payee_shares(brand_id,status,release_after);

CREATE TABLE public.payee_share_reversals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  share_id uuid NOT NULL REFERENCES public.payee_shares(id) ON DELETE RESTRICT,
  refund_ref text NOT NULL,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(share_id,refund_ref)
);

CREATE TABLE public.payee_payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payee_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  rail text NOT NULL CHECK (rail IN ('stripe','paystack')),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  provider_ref text,
  idempotency_key text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','in_transit','paid','failed','reversed')),
  attempt integer NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  failure_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz
);
CREATE UNIQUE INDEX payee_payouts_provider_ref_uq
  ON public.payee_payouts(provider_ref) WHERE provider_ref IS NOT NULL;
CREATE INDEX payee_payouts_payee_idx
  ON public.payee_payouts(payee_user_id,status,created_at DESC);

ALTER TABLE public.payee_shares
  ADD CONSTRAINT payee_shares_payout_id_fkey
  FOREIGN KEY(payout_id) REFERENCES public.payee_payouts(id) ON DELETE SET NULL;

CREATE TABLE public.payee_debts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payee_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  origin_share_id uuid REFERENCES public.payee_shares(id) ON DELETE RESTRICT,
  rail text NOT NULL CHECK (rail IN ('stripe','paystack')),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  recovered_minor bigint NOT NULL DEFAULT 0 CHECK (recovered_minor >= 0),
  reason text NOT NULL CHECK (reason IN ('refund_after_payout','dispute_after_payout','payout_reversal')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','recovered','written_off')),
  created_at timestamptz NOT NULL DEFAULT now(),
  recovered_at timestamptz,
  written_off_at timestamptz,
  CONSTRAINT payee_debts_recovery_cap CHECK (recovered_minor <= amount_minor),
  CONSTRAINT payee_debts_status_shape CHECK (
    (status='recovered') = (recovered_at IS NOT NULL)
    AND (status='written_off') = (written_off_at IS NOT NULL)
    AND (status<>'recovered' OR recovered_minor=amount_minor)
  )
);
CREATE INDEX payee_debts_payee_idx
  ON public.payee_debts(payee_user_id,status,created_at DESC);

CREATE TABLE public.discount_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE RESTRICT,
  discount_id uuid NOT NULL REFERENCES public.brand_discounts(id) ON DELETE RESTRICT,
  member_id uuid REFERENCES public.referral_members(id) ON DELETE SET NULL,
  grantee_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  grantee_email_norm text,
  origin_order_kind text NOT NULL CHECK (origin_order_kind IN ('ticket','venue_order')),
  origin_order_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','used','expired','revoked')),
  granted_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  redeemed_order_kind text CHECK (redeemed_order_kind IN ('ticket','venue_order')),
  redeemed_order_id uuid,
  redeemed_at timestamptz,
  CONSTRAINT discount_grants_identity CHECK (
    grantee_user_id IS NOT NULL OR grantee_email_norm IS NOT NULL
  ),
  CONSTRAINT discount_grants_window CHECK (expires_at > granted_at),
  CONSTRAINT discount_grants_redeemed_shape CHECK (
    (status='used') = (
      redeemed_at IS NOT NULL AND redeemed_order_kind IS NOT NULL AND redeemed_order_id IS NOT NULL
    )
    AND ((redeemed_order_kind IS NULL) = (redeemed_order_id IS NULL))
  ),
  UNIQUE(origin_order_kind,origin_order_id)
);
CREATE INDEX discount_grants_user_idx
  ON public.discount_grants(grantee_user_id,status,expires_at)
  WHERE grantee_user_id IS NOT NULL;
CREATE INDEX discount_grants_email_idx
  ON public.discount_grants(grantee_email_norm,status,expires_at)
  WHERE grantee_email_norm IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Race-safe offer, tier, namespace and ledger guards.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_3872_referral_offer_reference_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $fn$
DECLARE v_discount public.brand_discounts%ROWTYPE; v_check_discount boolean;
BEGIN
  IF TG_OP='UPDATE' AND NEW.brand_id<>OLD.brand_id THEN
    RAISE EXCEPTION 'referral_offer_brand_immutable';
  END IF;
  IF TG_OP='INSERT' THEN
    v_check_discount:=NEW.buyer_discount_id IS NOT NULL;
  ELSE
    v_check_discount:=NEW.buyer_discount_id IS NOT NULL
      AND NEW.buyer_discount_id IS DISTINCT FROM OLD.buyer_discount_id;
  END IF;
  IF v_check_discount THEN
    SELECT * INTO v_discount FROM public.brand_discounts
    WHERE id=NEW.buyer_discount_id;
    IF NOT FOUND OR v_discount.brand_id<>NEW.brand_id
       OR v_discount.kind<>'code' OR v_discount.deleted_at IS NOT NULL
       OR v_discount.status='ended' THEN
      RAISE EXCEPTION 'referral_buyer_discount_invalid';
    END IF;
  END IF;
  IF NEW.reward_kind<>'cash' AND EXISTS (
    SELECT 1 FROM public.referral_offer_tiers tier WHERE tier.offer_id=NEW.id
  ) THEN
    RAISE EXCEPTION 'referral_tiers_cash_only';
  END IF;
  IF NEW.scope_kind='brand' AND EXISTS (
    SELECT 1 FROM public.referral_offer_listings listing WHERE listing.offer_id=NEW.id
  ) THEN
    RAISE EXCEPTION 'referral_scope_has_listings';
  END IF;
  RETURN NEW;
END;
$fn$;
CREATE TRIGGER referral_offers_reference_guard
BEFORE INSERT OR UPDATE ON public.referral_offers
FOR EACH ROW EXECUTE FUNCTION public.issue_3872_referral_offer_reference_guard();

CREATE OR REPLACE FUNCTION public.issue_3872_referral_offer_overlap_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $fn$
DECLARE v_other uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('referral-offer:'||NEW.brand_id::text,0));
  IF NEW.status <> 'active' OR NEW.deleted_at IS NOT NULL THEN RETURN NEW; END IF;

  SELECT candidate.id INTO v_other
  FROM public.referral_offers candidate
  WHERE candidate.brand_id=NEW.brand_id
    AND candidate.id<>NEW.id
    AND candidate.status='active' AND candidate.deleted_at IS NULL
    AND (candidate.audience=NEW.audience OR candidate.audience='both' OR NEW.audience='both')
    AND tstzrange(candidate.starts_at,candidate.ends_at,'[)') &&
        tstzrange(NEW.starts_at,NEW.ends_at,'[)')
    AND (
      candidate.scope_kind='brand' OR NEW.scope_kind='brand'
      OR EXISTS (
        SELECT 1 FROM public.referral_offer_listings mine
        JOIN public.referral_offer_listings theirs
          ON theirs.listing_kind=mine.listing_kind AND theirs.listing_id=mine.listing_id
        WHERE mine.offer_id=NEW.id AND theirs.offer_id=candidate.id
      )
    )
  LIMIT 1;
  IF v_other IS NOT NULL THEN RAISE EXCEPTION 'offer_overlap'; END IF;
  RETURN NEW;
END;
$fn$;
CREATE TRIGGER referral_offers_overlap_guard
BEFORE INSERT OR UPDATE ON public.referral_offers
FOR EACH ROW EXECUTE FUNCTION public.issue_3872_referral_offer_overlap_guard();

CREATE OR REPLACE FUNCTION public.issue_3872_referral_offer_touch()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $fn$
BEGIN
  NEW.updated_at:=now();
  NEW.version:=OLD.version+1;
  RETURN NEW;
END;
$fn$;
CREATE TRIGGER referral_offers_touch
BEFORE UPDATE ON public.referral_offers
FOR EACH ROW EXECUTE FUNCTION public.issue_3872_referral_offer_touch();

CREATE OR REPLACE FUNCTION public.issue_3872_referral_listing_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $fn$
DECLARE
  v_offer public.referral_offers%ROWTYPE;
  v_offer_brand uuid;
  v_listing_brand uuid;
  v_other uuid;
BEGIN
  SELECT brand_id INTO v_offer_brand FROM public.referral_offers WHERE id=NEW.offer_id;
  IF v_offer_brand IS NULL THEN RAISE EXCEPTION 'referral_listing_scope_invalid'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('referral-offer:'||v_offer_brand::text,0));
  SELECT * INTO v_offer FROM public.referral_offers WHERE id=NEW.offer_id;
  IF NOT FOUND OR v_offer.scope_kind<>'listings' THEN RAISE EXCEPTION 'referral_listing_scope_invalid'; END IF;
  IF NEW.listing_kind='event' THEN
    SELECT brand_id INTO v_listing_brand FROM public.events
      WHERE id=NEW.listing_id AND deleted_at IS NULL;
  ELSE
    SELECT brand_id INTO v_listing_brand FROM public.venue_listings WHERE id=NEW.listing_id;
  END IF;
  IF v_listing_brand IS NULL OR v_listing_brand<>v_offer.brand_id THEN
    RAISE EXCEPTION 'referral_listing_not_in_brand';
  END IF;
  IF v_offer.status<>'active' OR v_offer.deleted_at IS NOT NULL THEN RETURN NEW; END IF;

  SELECT candidate.id INTO v_other
  FROM public.referral_offers candidate
  WHERE candidate.brand_id=v_offer.brand_id
    AND candidate.id<>v_offer.id
    AND candidate.status='active' AND candidate.deleted_at IS NULL
    AND (candidate.audience=v_offer.audience OR candidate.audience='both' OR v_offer.audience='both')
    AND tstzrange(candidate.starts_at,candidate.ends_at,'[)') &&
        tstzrange(v_offer.starts_at,v_offer.ends_at,'[)')
    AND (
      candidate.scope_kind='brand'
      OR EXISTS (SELECT 1 FROM public.referral_offer_listings existing
        WHERE existing.offer_id=candidate.id
          AND existing.listing_kind=NEW.listing_kind
          AND existing.listing_id=NEW.listing_id)
    )
  LIMIT 1;
  IF v_other IS NOT NULL THEN RAISE EXCEPTION 'offer_overlap'; END IF;
  RETURN NEW;
END;
$fn$;
CREATE TRIGGER referral_offer_listings_guard
BEFORE INSERT OR UPDATE ON public.referral_offer_listings
FOR EACH ROW EXECUTE FUNCTION public.issue_3872_referral_listing_guard();

CREATE OR REPLACE FUNCTION public.issue_3872_tracking_link_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $fn$
DECLARE v_listing_brand uuid;
BEGIN
  IF TG_OP='UPDATE'
     AND NEW.brand_id=OLD.brand_id
     AND NEW.listing_kind IS NOT DISTINCT FROM OLD.listing_kind
     AND NEW.listing_id IS NOT DISTINCT FROM OLD.listing_id THEN
    RETURN NEW;
  END IF;
  IF NEW.listing_kind='event' THEN
    SELECT brand_id INTO v_listing_brand FROM public.events
    WHERE id=NEW.listing_id AND deleted_at IS NULL;
  ELSIF NEW.listing_kind='venue' THEN
    SELECT brand_id INTO v_listing_brand FROM public.venue_listings WHERE id=NEW.listing_id;
  END IF;
  IF NEW.listing_id IS NOT NULL AND (v_listing_brand IS NULL OR v_listing_brand<>NEW.brand_id) THEN
    RAISE EXCEPTION 'referral_tracking_listing_mismatch';
  END IF;
  RETURN NEW;
END;
$fn$;
CREATE TRIGGER host_tracking_links_guard
BEFORE INSERT OR UPDATE ON public.host_tracking_links
FOR EACH ROW EXECUTE FUNCTION public.issue_3872_tracking_link_guard();

CREATE OR REPLACE FUNCTION public.issue_3872_attribution_touch_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $fn$
DECLARE v_related_brand uuid; v_listing_brand uuid;
BEGIN
  IF NEW.kind='member' THEN
    SELECT brand_id INTO v_related_brand FROM public.referral_members WHERE id=NEW.member_id;
  ELSE
    SELECT brand_id INTO v_related_brand FROM public.host_tracking_links WHERE id=NEW.tracking_id;
  END IF;
  IF v_related_brand IS NULL OR v_related_brand<>NEW.brand_id THEN
    RAISE EXCEPTION 'referral_touch_brand_mismatch';
  END IF;
  IF NEW.listing_kind='event' THEN
    SELECT brand_id INTO v_listing_brand FROM public.events
    WHERE id=NEW.listing_id AND deleted_at IS NULL;
  ELSIF NEW.listing_kind='venue' THEN
    SELECT brand_id INTO v_listing_brand FROM public.venue_listings WHERE id=NEW.listing_id;
  END IF;
  IF NEW.listing_id IS NOT NULL AND (v_listing_brand IS NULL OR v_listing_brand<>NEW.brand_id) THEN
    RAISE EXCEPTION 'referral_touch_listing_mismatch';
  END IF;
  RETURN NEW;
END;
$fn$;
CREATE TRIGGER attribution_touches_guard
BEFORE INSERT OR UPDATE ON public.attribution_touches
FOR EACH ROW EXECUTE FUNCTION public.issue_3872_attribution_touch_guard();

CREATE OR REPLACE FUNCTION public.issue_3872_referral_tier_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $fn$
DECLARE v_kind text; v_count integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('referral-tier:'||NEW.offer_id::text,0));
  SELECT reward_kind INTO v_kind FROM public.referral_offers WHERE id=NEW.offer_id;
  IF v_kind<>'cash' THEN RAISE EXCEPTION 'referral_tiers_cash_only'; END IF;
  SELECT count(*) INTO v_count FROM public.referral_offer_tiers
   WHERE offer_id=NEW.offer_id AND id<>NEW.id;
  IF v_count>=5 THEN RAISE EXCEPTION 'too_many_referral_tiers'; END IF;
  RETURN NEW;
END;
$fn$;
CREATE TRIGGER referral_offer_tiers_guard
BEFORE INSERT OR UPDATE ON public.referral_offer_tiers
FOR EACH ROW EXECUTE FUNCTION public.issue_3872_referral_tier_guard();

CREATE OR REPLACE FUNCTION public.issue_3872_code_namespace_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_offer_brand uuid;
BEGIN
  IF TG_TABLE_NAME='brand_discounts' THEN
    IF NEW.code IS NULL THEN RETURN NEW; END IF;
    NEW.code:=upper(btrim(NEW.code));
    PERFORM pg_advisory_xact_lock(hashtextextended('referral-code:'||NEW.brand_id::text||':'||NEW.code,0));
    IF NEW.deleted_at IS NULL AND NEW.status<>'ended' AND EXISTS (
      SELECT 1 FROM public.referral_members member
      WHERE member.brand_id=NEW.brand_id AND member.code=NEW.code
        AND member.status<>'removed'
    ) THEN RAISE EXCEPTION 'code_taken'; END IF;
    RETURN NEW;
  END IF;

  IF TG_OP='UPDATE' AND (
    NEW.offer_id<>OLD.offer_id OR NEW.brand_id<>OLD.brand_id OR NEW.link_slug<>OLD.link_slug
  ) THEN
    RAISE EXCEPTION 'referral_member_origin_immutable';
  END IF;
  IF TG_OP='UPDATE' AND OLD.status IN ('removed','declined') AND NEW.status<>OLD.status THEN
    RAISE EXCEPTION 'referral_member_status_terminal';
  END IF;
  SELECT brand_id INTO v_offer_brand FROM public.referral_offers WHERE id=NEW.offer_id;
  IF v_offer_brand IS NULL OR v_offer_brand<>NEW.brand_id THEN
    RAISE EXCEPTION 'referral_member_brand_mismatch';
  END IF;
  NEW.email_norm:=NULLIF(lower(btrim(COALESCE(NEW.email_norm,''))), '');
  IF NEW.code IS NULL THEN RETURN NEW; END IF;
  NEW.code:=upper(btrim(NEW.code));
  PERFORM pg_advisory_xact_lock(hashtextextended('referral-code:'||NEW.brand_id::text||':'||NEW.code,0));
  IF NEW.status<>'removed' AND EXISTS (
    SELECT 1 FROM public.brand_discounts discount
    WHERE discount.brand_id=NEW.brand_id AND discount.code=NEW.code
      AND discount.deleted_at IS NULL AND discount.status<>'ended'
  ) THEN RAISE EXCEPTION 'code_taken'; END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.issue_3872_code_namespace_guard() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER issue_3872_brand_discount_code_namespace
BEFORE INSERT OR UPDATE ON public.brand_discounts
FOR EACH ROW EXECUTE FUNCTION public.issue_3872_code_namespace_guard();
CREATE TRIGGER issue_3872_referral_member_code_namespace
BEFORE INSERT OR UPDATE ON public.referral_members
FOR EACH ROW EXECUTE FUNCTION public.issue_3872_code_namespace_guard();

CREATE OR REPLACE FUNCTION public.issue_3872_order_attribution_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $fn$
DECLARE
  v_brand uuid;
  v_member_offer uuid;
  v_touch_kind text;
  v_touch_member uuid;
  v_touch_tracking uuid;
BEGIN
  IF NEW.offer_id IS NOT NULL THEN
    SELECT brand_id INTO v_brand FROM public.referral_offers WHERE id=NEW.offer_id;
    IF v_brand IS NULL OR v_brand<>NEW.brand_id THEN
      RAISE EXCEPTION 'order_attribution_offer_mismatch';
    END IF;
  END IF;
  IF NEW.member_id IS NOT NULL THEN
    SELECT brand_id,offer_id INTO v_brand,v_member_offer
    FROM public.referral_members WHERE id=NEW.member_id;
    IF v_brand IS NULL OR v_brand<>NEW.brand_id
       OR (NEW.offer_id IS NOT NULL AND v_member_offer<>NEW.offer_id) THEN
      RAISE EXCEPTION 'order_attribution_member_mismatch';
    END IF;
  END IF;
  IF NEW.tracking_id IS NOT NULL THEN
    SELECT brand_id INTO v_brand FROM public.host_tracking_links WHERE id=NEW.tracking_id;
    IF v_brand IS NULL OR v_brand<>NEW.brand_id THEN
      RAISE EXCEPTION 'order_attribution_tracking_mismatch';
    END IF;
  END IF;
  IF NEW.touch_id IS NOT NULL THEN
    SELECT brand_id,kind,member_id,tracking_id
      INTO v_brand,v_touch_kind,v_touch_member,v_touch_tracking
    FROM public.attribution_touches WHERE id=NEW.touch_id;
    IF v_brand IS NULL OR v_brand<>NEW.brand_id THEN
      RAISE EXCEPTION 'order_attribution_touch_mismatch';
    END IF;
    IF (NEW.source='member_link' AND (v_touch_kind<>'member' OR v_touch_member<>NEW.member_id))
       OR (NEW.source='tracking_link' AND (v_touch_kind<>'tracking' OR v_touch_tracking<>NEW.tracking_id)) THEN
      RAISE EXCEPTION 'order_attribution_touch_mismatch';
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;
CREATE TRIGGER order_attributions_guard
BEFORE INSERT ON public.order_attributions
FOR EACH ROW EXECUTE FUNCTION public.issue_3872_order_attribution_guard();

CREATE OR REPLACE FUNCTION public.issue_3872_payee_account_touch()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $fn$
BEGIN NEW.updated_at:=now(); RETURN NEW; END;
$fn$;
CREATE TRIGGER payee_accounts_touch
BEFORE UPDATE ON public.payee_accounts
FOR EACH ROW EXECUTE FUNCTION public.issue_3872_payee_account_touch();

CREATE OR REPLACE FUNCTION public.issue_3872_payee_share_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $fn$
DECLARE
  v_member public.referral_members%ROWTYPE;
  v_attribution public.order_attributions%ROWTYPE;
BEGIN
  NEW.payee_email_norm:=NULLIF(lower(btrim(COALESCE(NEW.payee_email_norm,''))), '');
  SELECT * INTO v_member FROM public.referral_members WHERE id=NEW.member_id;
  IF NOT FOUND OR v_member.brand_id<>NEW.brand_id THEN
    RAISE EXCEPTION 'payee_share_member_mismatch';
  END IF;
  IF NOT (
    (NEW.payee_user_id IS NOT NULL AND v_member.user_id=NEW.payee_user_id)
    OR (NEW.payee_email_norm IS NOT NULL AND v_member.email_norm=NEW.payee_email_norm)
  ) THEN
    RAISE EXCEPTION 'payee_share_identity_mismatch';
  END IF;
  SELECT * INTO v_attribution FROM public.order_attributions
  WHERE order_kind=NEW.order_kind AND order_id=NEW.order_id;
  IF NOT FOUND OR v_attribution.brand_id<>NEW.brand_id
     OR v_attribution.member_id IS DISTINCT FROM NEW.member_id
     OR v_attribution.share_minor<>NEW.gross_minor THEN
    RAISE EXCEPTION 'payee_share_attribution_mismatch';
  END IF;
  RETURN NEW;
END;
$fn$;
CREATE TRIGGER payee_shares_guard
BEFORE INSERT OR UPDATE ON public.payee_shares
FOR EACH ROW EXECUTE FUNCTION public.issue_3872_payee_share_guard();

CREATE OR REPLACE FUNCTION public.issue_3872_discount_grant_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $fn$
DECLARE v_discount public.brand_discounts%ROWTYPE; v_member public.referral_members%ROWTYPE;
BEGIN
  NEW.grantee_email_norm:=NULLIF(lower(btrim(COALESCE(NEW.grantee_email_norm,''))), '');
  IF TG_OP='UPDATE' AND (
    NEW.brand_id<>OLD.brand_id OR NEW.discount_id<>OLD.discount_id
    OR NEW.member_id IS DISTINCT FROM OLD.member_id
    OR NEW.origin_order_kind<>OLD.origin_order_kind OR NEW.origin_order_id<>OLD.origin_order_id
  ) THEN
    RAISE EXCEPTION 'discount_grant_origin_immutable';
  END IF;
  IF TG_OP='INSERT' THEN
    SELECT * INTO v_discount FROM public.brand_discounts WHERE id=NEW.discount_id;
    IF NOT FOUND OR v_discount.brand_id<>NEW.brand_id
       OR v_discount.kind<>'voucher' OR v_discount.source<>'referral'
       OR v_discount.max_total_uses<>1 OR v_discount.max_uses_per_buyer<>1
       OR v_discount.deleted_at IS NOT NULL OR v_discount.status='ended' THEN
      RAISE EXCEPTION 'discount_grant_voucher_invalid';
    END IF;
  END IF;
  IF NEW.member_id IS NOT NULL THEN
    SELECT * INTO v_member FROM public.referral_members WHERE id=NEW.member_id;
    IF NOT FOUND OR v_member.brand_id<>NEW.brand_id OR NOT (
      (NEW.grantee_user_id IS NOT NULL AND v_member.user_id=NEW.grantee_user_id)
      OR (NEW.grantee_email_norm IS NOT NULL AND v_member.email_norm=NEW.grantee_email_norm)
    ) THEN
      RAISE EXCEPTION 'discount_grant_member_mismatch';
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;
CREATE TRIGGER discount_grants_guard
BEFORE INSERT OR UPDATE ON public.discount_grants
FOR EACH ROW EXECUTE FUNCTION public.issue_3872_discount_grant_guard();

CREATE OR REPLACE FUNCTION public.issue_3872_order_attribution_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $fn$
BEGIN RAISE EXCEPTION 'order_attributions_immutable'; END;
$fn$;
CREATE TRIGGER order_attributions_immutable
BEFORE UPDATE OR DELETE ON public.order_attributions
FOR EACH ROW EXECUTE FUNCTION public.issue_3872_order_attribution_immutable();

CREATE OR REPLACE FUNCTION public.issue_3872_payee_reversal_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $fn$
DECLARE v_share public.payee_shares%ROWTYPE;
BEGIN
  SELECT * INTO v_share FROM public.payee_shares WHERE id=NEW.share_id FOR UPDATE;
  IF NOT FOUND OR v_share.reversed_minor+NEW.amount_minor>v_share.gross_minor THEN
    RAISE EXCEPTION 'payee_reversal_exceeds_share';
  END IF;
  RETURN NEW;
END;
$fn$;
CREATE TRIGGER payee_share_reversals_guard
BEFORE INSERT ON public.payee_share_reversals
FOR EACH ROW EXECUTE FUNCTION public.issue_3872_payee_reversal_guard();

CREATE OR REPLACE FUNCTION public.issue_3872_payee_reversal_apply()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $fn$
BEGIN
  UPDATE public.payee_shares
     SET reversed_minor=reversed_minor+NEW.amount_minor,
         status=CASE WHEN reversed_minor+NEW.amount_minor=gross_minor THEN 'reversed' ELSE status END,
         updated_at=now()
   WHERE id=NEW.share_id;
  RETURN NEW;
END;
$fn$;
CREATE TRIGGER payee_share_reversals_apply
AFTER INSERT ON public.payee_share_reversals
FOR EACH ROW EXECUTE FUNCTION public.issue_3872_payee_reversal_apply();

CREATE OR REPLACE FUNCTION public.issue_3872_payee_reversal_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $fn$
BEGIN RAISE EXCEPTION 'payee_share_reversals_immutable'; END;
$fn$;
CREATE TRIGGER payee_share_reversals_immutable
BEFORE UPDATE OR DELETE ON public.payee_share_reversals
FOR EACH ROW EXECUTE FUNCTION public.issue_3872_payee_reversal_immutable();

-- ---------------------------------------------------------------------------
-- Dark rollout: the global kill switch remains authoritative.
-- ---------------------------------------------------------------------------
INSERT INTO public.feature_flags(flag_key,is_enabled,description)
VALUES('referrals_enabled',false,'#3872 R2 global kill switch')
ON CONFLICT(flag_key) DO UPDATE
  SET is_enabled=false,description=EXCLUDED.description;

CREATE OR REPLACE FUNCTION public.issue_3872_referrals_on(p_brand_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
  SELECT COALESCE((SELECT is_enabled FROM public.feature_flags WHERE flag_key='referrals_enabled'),false)
    AND EXISTS (
      SELECT 1 FROM public.program_brand_rollouts
      WHERE brand_id=p_brand_id AND program='referrals' AND phase IN ('pilot','ga')
    )
$fn$;
REVOKE ALL ON FUNCTION public.issue_3872_referrals_on(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3872_referrals_on(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- Least privilege. Clients can read only through owner/brand-scoped RLS;
-- every mutation is mediated by service-role functions.
-- ---------------------------------------------------------------------------
ALTER TABLE public.referral_offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_offer_listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_offer_tiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.host_tracking_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attribution_touches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_attributions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payee_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payee_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payee_share_reversals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payee_payouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payee_debts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.discount_grants ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.referral_offers FORCE ROW LEVEL SECURITY;
ALTER TABLE public.referral_offer_listings FORCE ROW LEVEL SECURITY;
ALTER TABLE public.referral_offer_tiers FORCE ROW LEVEL SECURITY;
ALTER TABLE public.referral_members FORCE ROW LEVEL SECURITY;
ALTER TABLE public.host_tracking_links FORCE ROW LEVEL SECURITY;
ALTER TABLE public.attribution_touches FORCE ROW LEVEL SECURITY;
ALTER TABLE public.order_attributions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.payee_accounts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.payee_shares FORCE ROW LEVEL SECURITY;
ALTER TABLE public.payee_share_reversals FORCE ROW LEVEL SECURITY;
ALTER TABLE public.payee_payouts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.payee_debts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.discount_grants FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.referral_offers,public.referral_offer_listings,
  public.referral_offer_tiers,public.referral_members,public.host_tracking_links,
  public.attribution_touches,public.order_attributions,public.payee_accounts,
  public.payee_shares,public.payee_share_reversals,public.payee_payouts,
  public.payee_debts,public.discount_grants
  FROM PUBLIC,anon,authenticated;
GRANT SELECT ON TABLE public.referral_offers,public.referral_offer_listings,
  public.referral_offer_tiers,public.referral_members,public.host_tracking_links,
  public.attribution_touches,public.order_attributions,public.payee_accounts,
  public.payee_shares,public.payee_share_reversals,public.payee_payouts,
  public.payee_debts,public.discount_grants TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE public.referral_offers,
  public.referral_offer_listings,public.referral_offer_tiers,public.referral_members,
  public.host_tracking_links,public.attribution_touches,public.order_attributions,
  public.payee_accounts,public.payee_shares,public.payee_share_reversals,
  public.payee_payouts,public.payee_debts,public.discount_grants TO service_role;

CREATE POLICY referral_offers_brand_read ON public.referral_offers FOR SELECT TO authenticated
USING (deleted_at IS NULL AND COALESCE(public.biz_brand_effective_rank(brand_id,auth.uid()),0)>=20);
CREATE POLICY referral_offer_listings_brand_read ON public.referral_offer_listings FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.referral_offers offer WHERE offer.id=offer_id
  AND offer.deleted_at IS NULL AND COALESCE(public.biz_brand_effective_rank(offer.brand_id,auth.uid()),0)>=20));
CREATE POLICY referral_offer_tiers_brand_read ON public.referral_offer_tiers FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.referral_offers offer WHERE offer.id=offer_id
  AND offer.deleted_at IS NULL AND COALESCE(public.biz_brand_effective_rank(offer.brand_id,auth.uid()),0)>=20));
CREATE POLICY referral_members_owner_or_brand_read ON public.referral_members FOR SELECT TO authenticated
USING (user_id=auth.uid() OR COALESCE(public.biz_brand_effective_rank(brand_id,auth.uid()),0)>=20);
CREATE POLICY host_tracking_links_brand_read ON public.host_tracking_links FOR SELECT TO authenticated
USING (COALESCE(public.biz_brand_effective_rank(brand_id,auth.uid()),0)>=20);
CREATE POLICY attribution_touches_brand_read ON public.attribution_touches FOR SELECT TO authenticated
USING (COALESCE(public.biz_brand_effective_rank(brand_id,auth.uid()),0)>=50);
CREATE POLICY order_attributions_brand_read ON public.order_attributions FOR SELECT TO authenticated
USING (COALESCE(public.biz_brand_effective_rank(brand_id,auth.uid()),0)>=20);
CREATE POLICY payee_accounts_owner_read ON public.payee_accounts FOR SELECT TO authenticated
USING (user_id=auth.uid());
CREATE POLICY payee_shares_owner_or_brand_read ON public.payee_shares FOR SELECT TO authenticated
USING (payee_user_id=auth.uid() OR COALESCE(public.biz_brand_effective_rank(brand_id,auth.uid()),0)>=30);
CREATE POLICY payee_share_reversals_owner_or_brand_read ON public.payee_share_reversals FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.payee_shares share WHERE share.id=share_id AND
  (share.payee_user_id=auth.uid() OR COALESCE(public.biz_brand_effective_rank(share.brand_id,auth.uid()),0)>=30)));
CREATE POLICY payee_payouts_owner_read ON public.payee_payouts FOR SELECT TO authenticated
USING (payee_user_id=auth.uid());
CREATE POLICY payee_debts_owner_read ON public.payee_debts FOR SELECT TO authenticated
USING (payee_user_id=auth.uid());
CREATE POLICY discount_grants_owner_or_brand_read ON public.discount_grants FOR SELECT TO authenticated
USING (grantee_user_id=auth.uid() OR COALESCE(public.biz_brand_effective_rank(brand_id,auth.uid()),0)>=20);

NOTIFY pgrst,'reload schema';
COMMIT;
