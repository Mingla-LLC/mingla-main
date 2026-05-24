-- ORCH-0948 — Waitlist feature.
-- Reuses public.waitlist_entries, hardens the buyer signup contract, and
-- enqueues FIFO spot-open notifications through ticket_order_notifications.

ALTER TABLE public.ticket_order_notifications
  ALTER COLUMN order_id DROP NOT NULL;

ALTER TABLE public.waitlist_entries
  ADD COLUMN IF NOT EXISTS qty_requested int NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'buyer_web',
  ADD COLUMN IF NOT EXISTS notified_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS consent_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS notification_id uuid NULL
    REFERENCES public.ticket_order_notifications(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS converted_order_id uuid NULL
    REFERENCES public.orders(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'waitlist_entries_qty_requested_positive'
       AND conrelid = 'public.waitlist_entries'::regclass
  ) THEN
    ALTER TABLE public.waitlist_entries
      ADD CONSTRAINT waitlist_entries_qty_requested_positive
      CHECK (qty_requested > 0 AND qty_requested <= 20) NOT VALID;
  END IF;
END$$;

ALTER TABLE public.waitlist_entries
  VALIDATE CONSTRAINT waitlist_entries_qty_requested_positive;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'waitlist_entries_source_known'
       AND conrelid = 'public.waitlist_entries'::regclass
  ) THEN
    ALTER TABLE public.waitlist_entries
      ADD CONSTRAINT waitlist_entries_source_known
      CHECK (source IN ('buyer_web','buyer_app','planner_manual','migration')) NOT VALID;
  END IF;
END$$;

ALTER TABLE public.waitlist_entries
  VALIDATE CONSTRAINT waitlist_entries_source_known;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'waitlist_entries_contact_present'
       AND conrelid = 'public.waitlist_entries'::regclass
  ) THEN
    ALTER TABLE public.waitlist_entries
      ADD CONSTRAINT waitlist_entries_contact_present
      CHECK (
        (email IS NOT NULL AND length(btrim(email)) > 0)
        OR (phone IS NOT NULL AND length(btrim(phone)) > 0)
      ) NOT VALID;
  END IF;
END$$;

ALTER TABLE public.waitlist_entries
  VALIDATE CONSTRAINT waitlist_entries_contact_present;

CREATE UNIQUE INDEX IF NOT EXISTS waitlist_entries_dedupe_email_idx
  ON public.waitlist_entries (ticket_type_id, lower(email))
  WHERE status IN ('waiting','invited') AND email IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS waitlist_entries_dedupe_phone_idx
  ON public.waitlist_entries (ticket_type_id, phone)
  WHERE status IN ('waiting','invited') AND phone IS NOT NULL AND (email IS NULL OR length(btrim(email)) = 0);

CREATE INDEX IF NOT EXISTS waitlist_entries_fifo_idx
  ON public.waitlist_entries (ticket_type_id, created_at)
  WHERE status = 'waiting';

DO $$
BEGIN
  IF (SELECT is_nullable FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'ticket_order_notifications' AND column_name = 'order_id') = 'NO'
  THEN
    RAISE EXCEPTION 'ORCH-0948 requires ticket_order_notifications.order_id to be NULLABLE for waitlist invites';
  END IF;
END$$;

CREATE OR REPLACE FUNCTION public.fn_waitlist_drain_on_capacity_freed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_freed int;
  v_running int := 0;
  v_entry record;
  v_notification_id uuid;
  v_channel text;
  v_recipient text;
BEGIN
  IF NEW.status NOT IN ('refunded','cancelled','void') THEN RETURN NEW; END IF;
  IF OLD.status NOT IN ('valid','used','transferred') THEN RETURN NEW; END IF;
  IF NEW.ticket_type_id IS NULL THEN RETURN NEW; END IF;

  v_freed := 1;

  FOR v_entry IN
    SELECT id, event_id, ticket_type_id, email, phone, qty_requested
      FROM public.waitlist_entries
     WHERE ticket_type_id = NEW.ticket_type_id
       AND status = 'waiting'
       AND notified_at IS NULL
     ORDER BY created_at ASC
  LOOP
    EXIT WHEN v_running >= v_freed;

    IF v_entry.email IS NOT NULL AND length(btrim(v_entry.email)) > 0 THEN
      v_channel := 'email';
      v_recipient := v_entry.email;
    ELSIF v_entry.phone IS NOT NULL AND length(btrim(v_entry.phone)) > 0 THEN
      v_channel := 'sms';
      v_recipient := v_entry.phone;
    ELSE
      CONTINUE;
    END IF;

    INSERT INTO public.ticket_order_notifications
      (order_id, event_id, channel, recipient, status, payload, idempotency_key, attempt_count)
    VALUES
      (NULL, v_entry.event_id, v_channel, v_recipient, 'pending',
       jsonb_build_object(
         'template_key','waitlist_spot_open',
         'waitlist_entry_id', v_entry.id,
         'event_id', v_entry.event_id,
         'ticket_type_id', v_entry.ticket_type_id,
         'qty_requested', v_entry.qty_requested,
         'invite_expires_at', (now() + interval '24 hours')
       ),
       'waitlist_invite:' || v_entry.id::text,
       0)
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING id INTO v_notification_id;

    IF v_notification_id IS NOT NULL THEN
      UPDATE public.waitlist_entries
         SET status = 'invited',
             invited_at = now(),
             notified_at = now(),
             notification_id = v_notification_id
       WHERE id = v_entry.id;
      v_running := v_running + v_entry.qty_requested;
    END IF;
  END LOOP;

  RETURN NEW;
END$$;

DROP TRIGGER IF EXISTS trg_waitlist_drain_on_capacity_freed ON public.tickets;
CREATE TRIGGER trg_waitlist_drain_on_capacity_freed
  AFTER UPDATE OF status ON public.tickets
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.fn_waitlist_drain_on_capacity_freed();

CREATE OR REPLACE FUNCTION public.event_waitlist_get(
  p_event_id uuid,
  p_recent_limit int DEFAULT 5
)
RETURNS TABLE (
  ticket_type_id uuid,
  ticket_type_name text,
  waitlist_enabled boolean,
  waiting_count int,
  invited_count int,
  recent jsonb
)
LANGUAGE sql
SECURITY INVOKER
STABLE
SET search_path = public
AS $$
  SELECT
    tt.id AS ticket_type_id,
    tt.name AS ticket_type_name,
    tt.waitlist_enabled,
    COALESCE((SELECT count(*)::int FROM public.waitlist_entries we
              WHERE we.ticket_type_id = tt.id AND we.status = 'waiting'), 0) AS waiting_count,
    COALESCE((SELECT count(*)::int FROM public.waitlist_entries we
              WHERE we.ticket_type_id = tt.id AND we.status = 'invited'), 0) AS invited_count,
    COALESCE((SELECT jsonb_agg(jsonb_build_object(
              'id', we.id, 'name', we.name, 'email', we.email, 'phone', we.phone,
              'qty_requested', we.qty_requested, 'status', we.status, 'created_at', we.created_at
            ) ORDER BY we.created_at DESC)
            FROM (SELECT * FROM public.waitlist_entries
                  WHERE ticket_type_id = tt.id
                  ORDER BY created_at DESC LIMIT p_recent_limit) we), '[]'::jsonb) AS recent
  FROM public.ticket_types tt
  WHERE tt.event_id = p_event_id
    AND tt.deleted_at IS NULL
    AND tt.waitlist_enabled = true
  ORDER BY tt.display_order ASC NULLS LAST;
$$;

GRANT EXECUTE ON FUNCTION public.event_waitlist_get(uuid, int) TO authenticated;
