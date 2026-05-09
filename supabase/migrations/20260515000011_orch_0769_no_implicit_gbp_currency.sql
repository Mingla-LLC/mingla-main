-- ORCH-0769 rework: remove implicit GBP currency fallbacks.
-- Currency should be empty until Stripe/brand/event context sets it, and
-- money-bearing rows must provide an explicit currency instead of inheriting
-- a database default.

ALTER TABLE public.brands
  ALTER COLUMN default_currency DROP DEFAULT,
  ALTER COLUMN default_currency DROP NOT NULL;

ALTER TABLE public.events
  ALTER COLUMN currency DROP DEFAULT,
  ALTER COLUMN currency DROP NOT NULL;

ALTER TABLE public.ticket_types
  ALTER COLUMN currency DROP DEFAULT;

ALTER TABLE public.orders
  ALTER COLUMN currency DROP DEFAULT;

ALTER TABLE public.mingla_revenue_log
  ALTER COLUMN currency DROP DEFAULT;

ALTER TABLE public.events
  DROP CONSTRAINT IF EXISTS events_published_currency_required_check;

ALTER TABLE public.events
  ADD CONSTRAINT events_published_currency_required_check
  CHECK (
    status = 'draft'
    OR currency IS NOT NULL
  );

COMMENT ON COLUMN public.brands.default_currency IS
  'ORCH-0769: canonical brand commerce currency once Stripe/brand setup sets it. NULL means currency is not set; do not imply GBP.';

COMMENT ON COLUMN public.events.currency IS
  'ORCH-0769: immutable commerce currency for published event ticket pricing. Drafts may be NULL until brand/Stripe currency is known; published events must set it explicitly.';

-- Safely repair legacy GBP event/ticket/order rows that never carried real
-- money. Positive historical money remains in its recorded currency.
WITH brand_currency AS (
  SELECT
    b.id AS brand_id,
    upper(COALESCE(sca.default_currency::text, b.default_currency::text))::char(3) AS currency
  FROM public.brands b
  LEFT JOIN public.stripe_connect_accounts sca
    ON sca.brand_id = b.id
   AND sca.detached_at IS NULL
  WHERE COALESCE(sca.default_currency::text, b.default_currency::text) IS NOT NULL
),
repaired_events AS (
  UPDATE public.events e
  SET currency = bc.currency
  FROM brand_currency bc
  WHERE e.brand_id = bc.brand_id
    AND bc.currency IS NOT NULL
    AND bc.currency <> 'GBP'::bpchar
    AND e.currency = 'GBP'::bpchar
    AND NOT EXISTS (
      SELECT 1
      FROM public.orders o
      WHERE o.event_id = e.id
        AND o.total_cents > 0
        AND o.payment_status IN ('paid', 'refunded', 'partial_refund')
    )
  RETURNING e.id, e.currency
)
UPDATE public.ticket_types tt
SET currency = re.currency
FROM repaired_events re
WHERE tt.event_id = re.id
  AND tt.currency = 'GBP'::bpchar
  AND tt.deleted_at IS NULL;

UPDATE public.orders o
SET currency = e.currency
FROM public.events e
WHERE o.event_id = e.id
  AND o.currency = 'GBP'::bpchar
  AND e.currency IS NOT NULL
  AND e.currency <> 'GBP'::bpchar
  AND o.total_cents = 0;

UPDATE public.mingla_revenue_log mrl
SET currency = upper(COALESCE(sca.default_currency::text, b.default_currency::text))::char(3)
FROM public.brands b
LEFT JOIN public.stripe_connect_accounts sca
  ON sca.brand_id = b.id
 AND sca.detached_at IS NULL
WHERE mrl.brand_id = b.id
  AND mrl.currency = 'GBP'::bpchar
  AND mrl.amount_cents = 0
  AND COALESCE(sca.default_currency::text, b.default_currency::text) IS NOT NULL
  AND upper(COALESCE(sca.default_currency::text, b.default_currency::text)) <> 'GBP';

CREATE OR REPLACE FUNCTION public.tg_require_event_brand_currency()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_brand_currency char(3);
BEGIN
  IF NEW.status <> 'draft' THEN
    SELECT upper(COALESCE(sca.default_currency::text, b.default_currency::text))::char(3)
    INTO v_brand_currency
    FROM public.brands b
    LEFT JOIN public.stripe_connect_accounts sca
      ON sca.brand_id = b.id
     AND sca.detached_at IS NULL
    WHERE b.id = NEW.brand_id
      AND b.deleted_at IS NULL
    LIMIT 1;

    IF v_brand_currency IS NULL THEN
      RAISE EXCEPTION 'event_currency_required';
    END IF;

    IF TG_OP = 'INSERT' THEN
      NEW.currency := v_brand_currency;
    ELSIF OLD.status = 'draft' THEN
      NEW.currency := v_brand_currency;
    ELSIF NEW.currency IS NULL THEN
      NEW.currency := v_brand_currency;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_require_event_brand_currency_insert ON public.events;
CREATE TRIGGER trg_require_event_brand_currency_insert
  BEFORE INSERT ON public.events
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_require_event_brand_currency();

DROP TRIGGER IF EXISTS trg_require_event_brand_currency_update ON public.events;
CREATE TRIGGER trg_require_event_brand_currency_update
  BEFORE UPDATE OF status, currency, brand_id ON public.events
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_require_event_brand_currency();

CREATE OR REPLACE FUNCTION public.tg_enforce_event_ticket_currency()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_event_currency char(3);
BEGIN
  SELECT e.currency
  INTO v_event_currency
  FROM public.events e
  WHERE e.id = NEW.event_id;

  IF v_event_currency IS NULL THEN
    RAISE EXCEPTION 'event_currency_not_found';
  END IF;

  IF NULLIF(btrim(COALESCE(NEW.currency::text, '')), '') IS NULL THEN
    NEW.currency := v_event_currency;
  ELSIF upper(NEW.currency::text)::char(3) = 'GBP'::bpchar
    AND v_event_currency <> 'GBP'::bpchar
  THEN
    NEW.currency := v_event_currency;
  ELSIF upper(NEW.currency::text)::char(3) <> v_event_currency THEN
    RAISE EXCEPTION 'ticket_currency_must_match_event_currency';
  ELSE
    NEW.currency := v_event_currency;
  END IF;

  RETURN NEW;
END;
$$;
