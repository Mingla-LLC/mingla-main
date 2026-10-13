-- #3720 Phase 0 / Slice A — new support tickets notify staff server-side.
--
-- Bug: the Host app called notify-support with the caller's JWT, but that
-- function only accepts the service-role bearer, so staff never got the push.
-- Fix: AFTER INSERT on support_tickets, pg_net-invoke notify-support with the
-- vault service_role_key. Ticket mint must never fail if notify is unavailable.

CREATE OR REPLACE FUNCTION public.tg_support_ticket_notify_staff()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_supabase_url text;
  v_service_key text;
BEGIN
  SELECT decrypted_secret INTO v_supabase_url
    FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1;
  SELECT decrypted_secret INTO v_service_key
    FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1;

  IF v_supabase_url IS NULL OR v_service_key IS NULL THEN
    RAISE NOTICE
      '#3720: vault secrets missing; skipping new_ticket notify for ticket %',
      NEW.id;
    RETURN NEW;
  END IF;

  BEGIN
    PERFORM net.http_post(
      url := v_supabase_url || '/functions/v1/notify-support',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_service_key
      ),
      body := jsonb_build_object(
        'event', 'new_ticket',
        'ticketId', NEW.id
      ),
      timeout_milliseconds := 5000
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE
      '#3720: notify-support kick failed for ticket %: %',
      NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$$;

ALTER FUNCTION public.tg_support_ticket_notify_staff() OWNER TO postgres;

COMMENT ON FUNCTION public.tg_support_ticket_notify_staff() IS
  '#3720 Phase 0: AFTER INSERT on support_tickets → service-role notify-support '
  '(new_ticket). Exception-safe; missing vault skips.';

DROP TRIGGER IF EXISTS tg_support_ticket_notify_staff ON public.support_tickets;
CREATE TRIGGER tg_support_ticket_notify_staff
  AFTER INSERT ON public.support_tickets
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_support_ticket_notify_staff();

COMMENT ON TRIGGER tg_support_ticket_notify_staff ON public.support_tickets IS
  '#3720: server-side staff push on new support ticket (not client JWT).';

DO $$
BEGIN
  IF to_regprocedure('public.tg_support_ticket_notify_staff()') IS NULL THEN
    RAISE EXCEPTION '#3720 self-check: tg_support_ticket_notify_staff missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'tg_support_ticket_notify_staff'
      AND tgrelid = 'public.support_tickets'::regclass
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION '#3720 self-check: trigger tg_support_ticket_notify_staff missing';
  END IF;
END;
$$;
