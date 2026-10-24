BEGIN;
SET LOCAL lock_timeout = '10s';

-- #4063 Wave 2 is switched on only after the reviewed edge bundle is live.
-- Until then, gated producers retain their pre-#4063 behavior exactly.
CREATE TABLE IF NOT EXISTS public.issue_4063_switches (
  name text PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT false,
  changed_at timestamptz NULL
);

ALTER TABLE public.issue_4063_switches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.issue_4063_switches FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.issue_4063_switches FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.issue_4063_switches
  TO service_role;

INSERT INTO public.issue_4063_switches(name, enabled, changed_at)
VALUES ('messages_v2', false, NULL)
ON CONFLICT (name) DO NOTHING;

CREATE OR REPLACE FUNCTION public.issue_4063_switch_on(p_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT coalesce((
    SELECT switch.enabled
      FROM public.issue_4063_switches AS switch
     WHERE switch.name = p_name
  ), false)
$function$;

REVOKE ALL ON FUNCTION public.issue_4063_switch_on(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4063_switch_on(text)
  TO service_role;

COMMENT ON TABLE public.issue_4063_switches IS
  '#4063: service-role-only release switches. messages_v2 stays false until the reviewed edge bundle is verified live.';
COMMENT ON FUNCTION public.issue_4063_switch_on(text) IS
  '#4063: fail-closed switch reader used by SECURITY DEFINER notification producers.';

CREATE OR REPLACE FUNCTION public.tg_venue_orders_a4063_receipt()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_venue_name text;
BEGIN
  IF NEW.money_path <> 'mingla'
     OR NEW.payment_status <> 'paid'
     OR NEW.confirmed_at IS NULL
     OR NEW.buyer_phone_e164 !~ '^\+[1-9][0-9]{1,14}$'
     OR NOT public.issue_4063_switch_on('messages_v2')
     OR (
       TG_OP = 'UPDATE'
       AND OLD.payment_status = 'paid'
       AND OLD.confirmed_at IS NOT NULL
     ) THEN
    RETURN NEW;
  END IF;

  BEGIN
    SELECT venue.name
      INTO v_venue_name
      FROM public.venue_listings AS venue
     WHERE venue.id = NEW.venue_id;

    INSERT INTO public.notification_outbox (
      category_key,
      user_id,
      contact,
      brand_id,
      payload,
      idempotency_key,
      country_code,
      status
    ) VALUES (
      'buyer_venue_order_receipt',
      NEW.buyer_user_id,
      NEW.buyer_phone_e164,
      NEW.brand_id,
      jsonb_build_object(
        'venue_order_id', NEW.id,
        'venue_id', NEW.venue_id,
        'venue_name', coalesce(nullif(btrim(v_venue_name), ''), 'the venue'),
        'pickup_code', NEW.pickup_code,
        'claimed', NEW.buyer_user_id IS NOT NULL,
        'channel_hint', 'sms'
      ),
      'buyer_venue_order_receipt:' || NEW.id::text || ':sms',
      public.mingla_e164_country(NEW.buyer_phone_e164),
      'pending'
    )
    ON CONFLICT (idempotency_key) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    -- A notification failure must never roll back a successful payment write.
    RAISE WARNING 'issue_4063_receipt_enqueue_failed %', SQLSTATE;
  END;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.tg_venue_orders_a4063_receipt()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tg_venue_orders_a4063_receipt()
  TO service_role;

DROP TRIGGER IF EXISTS trg_venue_orders_a4063_receipt
  ON public.venue_orders;
CREATE TRIGGER trg_venue_orders_a4063_receipt
AFTER INSERT OR UPDATE OF payment_status, confirmed_at
ON public.venue_orders
FOR EACH ROW
EXECUTE FUNCTION public.tg_venue_orders_a4063_receipt();

-- MINGLA-INVARIANT: I-4063-OLD-SENDERS-NEVER-SEE-NEW-ROWS | issue #4063 | New message rows are emitted only after the service-role messages_v2 switch is enabled.
-- MINGLA-INVARIANT: I-4063-RECEIPT-NEVER-BLOCKS-PAYMENT | issue #4063 | Food-receipt enqueue failures are warning-only and cannot roll back a venue payment write.

COMMIT;
NOTIFY pgrst, 'reload schema';
