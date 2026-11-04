-- #3682 closeout — auto-follow on standalone RSVPs and bookings.
--
-- brand_follow_auto_claims was keyed by order_id only, so a standalone RSVP
-- (event_rsvps) or a venue booking (reservations) had no way to record "we
-- already auto-followed for this", and the helper refused to call without an
-- order. This migration adds a generic (source_kind, source_id) claim key:
--   * 'order'       → public.orders.id        (existing purchase / free RSVP orders)
--   * 'rsvp'        → public.event_rsvps.id   (standalone RSVP events)
--   * 'reservation' → public.reservations.id  (venue bookings)
-- Existing order claims are backfilled to source_kind='order', source_id=order_id
-- and keep their order_id. The replay-safe key is
-- UNIQUE (source_kind, source_id, user_id, brand_id): a claim that already
-- exists means "already processed", so a confirm/webhook replay never
-- re-follows someone who unfollowed in between.
--
-- biz_auto_follow_brand keeps the #4111 body (sources incl. web_subscribe /
-- site_subscribe, SECURITY DEFINER, service_role-only EXECUTE) and gains two
-- trailing defaulted args. The old 4-arg signature is dropped so positional SQL
-- callers (#4111 subscribe confirmers) and named PostgREST callers resolve to the
-- one function with defaults.

BEGIN;

ALTER TABLE public.brand_follow_auto_claims
  ADD COLUMN IF NOT EXISTS id uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS source_kind text,
  ADD COLUMN IF NOT EXISTS source_id uuid;

UPDATE public.brand_follow_auto_claims
   SET source_kind = 'order',
       source_id = order_id
 WHERE source_kind IS NULL OR source_id IS NULL;

ALTER TABLE public.brand_follow_auto_claims
  ALTER COLUMN source_kind SET NOT NULL,
  ALTER COLUMN source_id SET NOT NULL;

ALTER TABLE public.brand_follow_auto_claims
  DROP CONSTRAINT IF EXISTS brand_follow_auto_claims_pkey;
ALTER TABLE public.brand_follow_auto_claims
  ALTER COLUMN order_id DROP NOT NULL;
ALTER TABLE public.brand_follow_auto_claims
  ADD CONSTRAINT brand_follow_auto_claims_pkey PRIMARY KEY (id);

ALTER TABLE public.brand_follow_auto_claims
  DROP CONSTRAINT IF EXISTS brand_follow_auto_claims_source_kind_check;
ALTER TABLE public.brand_follow_auto_claims
  ADD CONSTRAINT brand_follow_auto_claims_source_kind_check
  CHECK (source_kind IN ('order', 'rsvp', 'reservation'));

ALTER TABLE public.brand_follow_auto_claims
  DROP CONSTRAINT IF EXISTS brand_follow_auto_claims_order_shape_check;
ALTER TABLE public.brand_follow_auto_claims
  ADD CONSTRAINT brand_follow_auto_claims_order_shape_check
  CHECK (
    (source_kind = 'order' AND order_id IS NOT NULL AND order_id = source_id)
    OR (source_kind <> 'order' AND order_id IS NULL)
  );

ALTER TABLE public.brand_follow_auto_claims
  DROP CONSTRAINT IF EXISTS brand_follow_auto_claims_source_key;
ALTER TABLE public.brand_follow_auto_claims
  ADD CONSTRAINT brand_follow_auto_claims_source_key
  UNIQUE (source_kind, source_id, user_id, brand_id);

-- One claim per order stays true (the old primary key's guarantee).
CREATE UNIQUE INDEX IF NOT EXISTS brand_follow_auto_claims_order_uidx
  ON public.brand_follow_auto_claims (order_id)
  WHERE order_id IS NOT NULL;

-- Unfollow-after-claim lookups (backfill + support reads) go by person+brand.
CREATE INDEX IF NOT EXISTS brand_follow_auto_claims_user_brand_idx
  ON public.brand_follow_auto_claims (user_id, brand_id);

COMMENT ON TABLE public.brand_follow_auto_claims IS
  '#3682: one row per (source_kind, source_id, user, brand) auto-follow already processed. '
  'Survives unfollow so confirm/webhook replay cannot re-follow.';

DROP FUNCTION IF EXISTS public.biz_auto_follow_brand(uuid, uuid, text, uuid);

CREATE OR REPLACE FUNCTION public.biz_auto_follow_brand(
  p_user_id uuid,
  p_brand_id uuid,
  p_source text DEFAULT 'purchase',
  p_order_id uuid DEFAULT NULL,
  p_source_kind text DEFAULT NULL,
  p_source_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $f$
DECLARE
  v_source text := COALESCE(NULLIF(btrim(p_source), ''), 'purchase');
  v_kind text := NULLIF(btrim(COALESCE(p_source_kind, '')), '');
  v_source_id uuid := p_source_id;
  v_order_id uuid := p_order_id;
  v_claim_count integer := 0;
  v_row_count integer := 0;
BEGIN
  IF p_user_id IS NULL OR p_brand_id IS NULL THEN
    RAISE EXCEPTION 'auto_follow_args_required' USING ERRCODE = '22023';
  END IF;
  IF v_source NOT IN (
    'purchase', 'rsvp', 'booking', 'brand_page', 'web_email', 'web_follow_invite',
    'web_subscribe', 'site_subscribe'
  ) THEN
    RAISE EXCEPTION 'auto_follow_source_invalid' USING ERRCODE = '22023';
  END IF;

  -- Normalise the claim key. An order id alone means source_kind 'order'.
  IF v_kind IS NULL AND v_order_id IS NOT NULL THEN
    v_kind := 'order';
  END IF;
  IF v_kind IS NOT NULL AND v_kind NOT IN ('order', 'rsvp', 'reservation') THEN
    RAISE EXCEPTION 'auto_follow_source_kind_invalid' USING ERRCODE = '22023';
  END IF;
  IF v_kind = 'order' THEN
    IF v_order_id IS NOT NULL AND v_source_id IS NOT NULL
       AND v_order_id IS DISTINCT FROM v_source_id THEN
      RAISE EXCEPTION 'auto_follow_source_mismatch' USING ERRCODE = '22023';
    END IF;
    v_order_id := COALESCE(v_order_id, v_source_id);
    v_source_id := v_order_id;
  ELSIF v_kind IS NOT NULL AND v_order_id IS NOT NULL THEN
    RAISE EXCEPTION 'auto_follow_source_mismatch' USING ERRCODE = '22023';
  END IF;

  -- Purchase/RSVP/booking MUST claim so unfollow stays sticky across replay.
  -- (Error text kept from 20270805003682 for existing callers and tests.)
  IF v_source IN ('purchase', 'rsvp', 'booking')
     AND (v_kind IS NULL OR v_source_id IS NULL) THEN
    RAISE EXCEPTION 'auto_follow_order_required' USING ERRCODE = '22023';
  END IF;

  -- New kinds are checked against their own row: the person and brand must be
  -- the ones on that RSVP / reservation (service-role callers only, but a
  -- mis-wired caller must not follow the wrong person).
  IF v_kind = 'rsvp' THEN
    IF NOT EXISTS (
      SELECT 1
        FROM public.event_rsvps r
        JOIN public.events e ON e.id = r.event_id
       WHERE r.id = v_source_id
         AND r.user_id = p_user_id
         AND e.brand_id = p_brand_id
    ) THEN
      RAISE EXCEPTION 'auto_follow_source_mismatch' USING ERRCODE = '22023';
    END IF;
  ELSIF v_kind = 'reservation' THEN
    IF NOT EXISTS (
      SELECT 1
        FROM public.reservations r
       WHERE r.id = v_source_id
         AND r.consumer_user_id = p_user_id
         AND r.brand_id = p_brand_id
    ) THEN
      RAISE EXCEPTION 'auto_follow_source_mismatch' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF v_kind IS NOT NULL THEN
    INSERT INTO public.brand_follow_auto_claims (
      order_id, user_id, brand_id, source, source_kind, source_id
    )
    VALUES (v_order_id, p_user_id, p_brand_id, v_source, v_kind, v_source_id)
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS v_claim_count = ROW_COUNT;
    IF v_claim_count = 0 THEN
      RETURN jsonb_build_object(
        'followed', false,
        'created', false,
        'skipped', 'already_claimed',
        'userId', p_user_id,
        'brandId', p_brand_id,
        'orderId', v_order_id,
        'sourceKind', v_kind,
        'sourceId', v_source_id,
        'source', v_source
      );
    END IF;
  END IF;

  INSERT INTO public.brand_follows (user_id, brand_id, source)
  VALUES (p_user_id, p_brand_id, v_source)
  ON CONFLICT ON CONSTRAINT brand_follows_user_brand_key DO NOTHING;

  GET DIAGNOSTICS v_row_count = ROW_COUNT;
  RETURN jsonb_build_object(
    'followed', true,
    'created', (v_row_count > 0),
    'userId', p_user_id,
    'brandId', p_brand_id,
    'orderId', v_order_id,
    'sourceKind', v_kind,
    'sourceId', v_source_id,
    'source', v_source
  );
END;
$f$;

REVOKE ALL ON FUNCTION public.biz_auto_follow_brand(uuid, uuid, text, uuid, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.biz_auto_follow_brand(uuid, uuid, text, uuid, text, uuid)
  TO service_role;

COMMIT;
