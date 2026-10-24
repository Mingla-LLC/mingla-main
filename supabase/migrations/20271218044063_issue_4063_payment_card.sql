BEGIN;
SET LOCAL lock_timeout = '10s';

ALTER TABLE public.ticket_checkout_sessions
  ADD COLUMN IF NOT EXISTS payment_card_brand text NULL,
  ADD COLUMN IF NOT EXISTS payment_card_last4 text NULL,
  ADD COLUMN IF NOT EXISTS payment_wallet text NULL;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS payment_card_brand text NULL,
  ADD COLUMN IF NOT EXISTS payment_card_last4 text NULL,
  ADD COLUMN IF NOT EXISTS payment_wallet text NULL;

ALTER TABLE public.ticket_checkout_sessions
  DROP CONSTRAINT IF EXISTS ticket_checkout_sessions_payment_card_brand_check,
  DROP CONSTRAINT IF EXISTS ticket_checkout_sessions_payment_card_last4_check,
  DROP CONSTRAINT IF EXISTS ticket_checkout_sessions_payment_wallet_check,
  ADD CONSTRAINT ticket_checkout_sessions_payment_card_brand_check CHECK (
    payment_card_brand IS NULL OR payment_card_brand IN
      ('visa','mastercard','amex','discover','diners','jcb','unionpay','verve','eftpos','other')
  ),
  ADD CONSTRAINT ticket_checkout_sessions_payment_card_last4_check CHECK (
    payment_card_last4 IS NULL OR payment_card_last4 ~ '^[0-9]{4}$'
  ),
  ADD CONSTRAINT ticket_checkout_sessions_payment_wallet_check CHECK (
    payment_wallet IS NULL OR payment_wallet IN
      ('apple_pay','google_pay','samsung_pay','link')
  );

ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_payment_card_brand_check,
  DROP CONSTRAINT IF EXISTS orders_payment_card_last4_check,
  DROP CONSTRAINT IF EXISTS orders_payment_wallet_check,
  ADD CONSTRAINT orders_payment_card_brand_check CHECK (
    payment_card_brand IS NULL OR payment_card_brand IN
      ('visa','mastercard','amex','discover','diners','jcb','unionpay','verve','eftpos','other')
  ),
  ADD CONSTRAINT orders_payment_card_last4_check CHECK (
    payment_card_last4 IS NULL OR payment_card_last4 ~ '^[0-9]{4}$'
  ),
  ADD CONSTRAINT orders_payment_wallet_check CHECK (
    payment_wallet IS NULL OR payment_wallet IN
      ('apple_pay','google_pay','samsung_pay','link')
  );

COMMENT ON COLUMN public.ticket_checkout_sessions.payment_card_brand IS
  '#4063 decision 3: card brand and last 4 digits as reported by the provider at payment; never a full number; display only.';
COMMENT ON COLUMN public.ticket_checkout_sessions.payment_card_last4 IS
  '#4063 decision 3: card brand and last 4 digits as reported by the provider at payment; never a full number; display only.';
COMMENT ON COLUMN public.ticket_checkout_sessions.payment_wallet IS
  '#4063 decision 3: provider-reported wallet type; display only.';
COMMENT ON COLUMN public.orders.payment_card_brand IS
  '#4063 decision 3: card brand and last 4 digits as reported by the provider at payment; never a full number; display only.';
COMMENT ON COLUMN public.orders.payment_card_last4 IS
  '#4063 decision 3: card brand and last 4 digits as reported by the provider at payment; never a full number; display only.';
COMMENT ON COLUMN public.orders.payment_wallet IS
  '#4063 decision 3: provider-reported wallet type; display only.';

CREATE OR REPLACE FUNCTION public.issue_4063_record_payment_card(
  p_checkout_session_id uuid,
  p_brand text,
  p_last4 text,
  p_wallet text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_brand text := lower(btrim(coalesce(p_brand, '')));
  v_last4 text := btrim(coalesce(p_last4, ''));
  v_wallet text := lower(btrim(coalesce(p_wallet, '')));
  v_order_id uuid;
  v_existing_last4 text;
  v_changed integer := 0;
BEGIN
  IF p_checkout_session_id IS NULL OR v_last4 !~ '^[0-9]{4}$' THEN
    RETURN jsonb_build_object('outcome', 'invalid');
  END IF;

  v_brand := CASE v_brand
    WHEN 'american express' THEN 'amex'
    WHEN 'american_express' THEN 'amex'
    WHEN 'amex' THEN 'amex'
    WHEN 'master' THEN 'mastercard'
    WHEN 'mastercard' THEN 'mastercard'
    WHEN 'diners club' THEN 'diners'
    WHEN 'diners' THEN 'diners'
    WHEN 'china unionpay' THEN 'unionpay'
    WHEN 'unionpay' THEN 'unionpay'
    WHEN 'eftpos_au' THEN 'eftpos'
    WHEN 'eftpos' THEN 'eftpos'
    WHEN 'visa' THEN 'visa'
    WHEN 'discover' THEN 'discover'
    WHEN 'jcb' THEN 'jcb'
    WHEN 'verve' THEN 'verve'
    ELSE 'other'
  END;

  IF v_wallet NOT IN ('apple_pay','google_pay','samsung_pay','link') THEN
    v_wallet := NULL;
  END IF;

  SELECT order_id, payment_card_last4
    INTO v_order_id, v_existing_last4
    FROM public.ticket_checkout_sessions
   WHERE id = p_checkout_session_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'not_found');
  END IF;

  IF v_existing_last4 IS NOT NULL THEN
    IF v_order_id IS NOT NULL THEN
      UPDATE public.orders
         SET payment_card_brand = COALESCE(payment_card_brand, v_brand),
             payment_card_last4 = COALESCE(payment_card_last4, v_existing_last4),
             payment_wallet = COALESCE(payment_wallet, v_wallet)
       WHERE id = v_order_id
         AND payment_card_last4 IS NULL;
    END IF;
    RETURN jsonb_build_object('outcome', 'already_recorded');
  END IF;

  UPDATE public.ticket_checkout_sessions
     SET payment_card_brand = v_brand,
         payment_card_last4 = v_last4,
         payment_wallet = v_wallet
   WHERE id = p_checkout_session_id
     AND payment_card_last4 IS NULL;
  GET DIAGNOSTICS v_changed = ROW_COUNT;
  IF v_changed = 0 THEN
    RETURN jsonb_build_object('outcome', 'already_recorded');
  END IF;

  IF v_order_id IS NOT NULL THEN
    UPDATE public.orders
       SET payment_card_brand = v_brand,
           payment_card_last4 = v_last4,
           payment_wallet = v_wallet
     WHERE id = v_order_id
       AND payment_card_last4 IS NULL;
  END IF;

  RETURN jsonb_build_object('outcome', 'recorded');
END;
$fn$;

REVOKE ALL ON FUNCTION public.issue_4063_record_payment_card(uuid,text,text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4063_record_payment_card(uuid,text,text,text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.tg_tcs_4063_copy_card()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  UPDATE public.orders
     SET payment_card_brand = NEW.payment_card_brand,
         payment_card_last4 = NEW.payment_card_last4,
         payment_wallet = NEW.payment_wallet
   WHERE id = NEW.order_id
     AND payment_card_last4 IS NULL;
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.tg_tcs_4063_copy_card()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tg_tcs_4063_copy_card()
  TO service_role;

DROP TRIGGER IF EXISTS trg_tcs_a4063_copy_card
  ON public.ticket_checkout_sessions;
CREATE TRIGGER trg_tcs_a4063_copy_card
AFTER UPDATE OF order_id ON public.ticket_checkout_sessions
FOR EACH ROW
WHEN (
  NEW.order_id IS NOT NULL
  AND OLD.order_id IS DISTINCT FROM NEW.order_id
  AND NEW.payment_card_last4 IS NOT NULL
)
EXECUTE FUNCTION public.tg_tcs_4063_copy_card();

-- MINGLA-INVARIANT: I-4063-PAYMENT-CARD-DISPLAY-ONLY | issue #4063 | Provider card capture stores only normalized brand, last four digits and wallet; first writer wins.

COMMIT;
NOTIFY pgrst, 'reload schema';
