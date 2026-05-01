-- Cycle B1 Phase 6 — Scanners, scan audit, issued tickets (BUSINESS_PROJECT_PLAN §B.4–§B.5).

CREATE TABLE IF NOT EXISTS public.scanner_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events (id) ON DELETE CASCADE,
  email text NOT NULL,
  permissions jsonb NOT NULL DEFAULT '{"scan": true, "take_payments": false}'::jsonb,
  token text NOT NULL,
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  CONSTRAINT scanner_invitations_email_nonempty CHECK (length(trim(email)) > 0),
  CONSTRAINT scanner_invitations_token_nonempty CHECK (length(trim(token)) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_scanner_invitations_token ON public.scanner_invitations (token);
CREATE INDEX IF NOT EXISTS idx_scanner_invitations_event_id ON public.scanner_invitations (event_id);

COMMENT ON TABLE public.scanner_invitations IS 'Invite flow for event scanners (B1 §B.5).';

ALTER TABLE public.scanner_invitations ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.event_scanners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  permissions jsonb NOT NULL DEFAULT '{"scan": true, "take_payments": false}'::jsonb,
  assigned_by uuid NOT NULL REFERENCES auth.users (id),
  assigned_at timestamptz NOT NULL DEFAULT now(),
  removed_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_event_scanners_event_user_active
  ON public.event_scanners (event_id, user_id)
  WHERE removed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_event_scanners_user_id ON public.event_scanners (user_id);

COMMENT ON TABLE public.event_scanners IS 'Scanner role assignments per event (B1 §B.5).';

ALTER TABLE public.event_scanners ENABLE ROW LEVEL SECURITY;

-- Orders: optional link to scanner user who created a door sale.
ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_created_by_scanner_user_fkey;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_created_by_scanner_user_fkey
  FOREIGN KEY (created_by_scanner_id)
  REFERENCES auth.users (id)
  ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders (id) ON DELETE CASCADE,
  ticket_type_id uuid NOT NULL REFERENCES public.ticket_types (id) ON DELETE RESTRICT,
  event_id uuid NOT NULL REFERENCES public.events (id) ON DELETE CASCADE,
  attendee_name text,
  attendee_email text,
  attendee_phone text,
  qr_code text NOT NULL,
  status text NOT NULL DEFAULT 'valid'
    CONSTRAINT tickets_status_check
      CHECK (status IN ('valid', 'used', 'void', 'transferred', 'refunded')),
  transferred_to_email text,
  transferred_at timestamptz,
  approval_status text NOT NULL DEFAULT 'auto'
    CONSTRAINT tickets_approval_status_check
      CHECK (approval_status IN ('auto', 'pending', 'approved', 'rejected')),
  approval_decided_by uuid REFERENCES auth.users (id),
  approval_decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  used_at timestamptz,
  used_by_scanner_id uuid REFERENCES auth.users (id),
  CONSTRAINT tickets_qr_nonempty CHECK (length(trim(qr_code)) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tickets_qr_code ON public.tickets (qr_code);
CREATE INDEX IF NOT EXISTS idx_tickets_order_id ON public.tickets (order_id);
CREATE INDEX IF NOT EXISTS idx_tickets_event_id ON public.tickets (event_id);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON public.tickets (status);

COMMENT ON TABLE public.tickets IS 'Issued attendee tickets; issuance via service role (B1 §B.4).';

ALTER TABLE public.tickets ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.scan_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.tickets (id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES public.events (id) ON DELETE CASCADE,
  scanner_user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  scan_result text NOT NULL
    CONSTRAINT scan_events_result_check
      CHECK (
        scan_result IN (
          'success',
          'duplicate',
          'not_found',
          'wrong_event',
          'void'
        )
      ),
  scanned_at timestamptz NOT NULL DEFAULT now(),
  client_offline boolean NOT NULL DEFAULT false,
  synced_at timestamptz,
  device_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_scan_events_ticket_id ON public.scan_events (ticket_id);
CREATE INDEX IF NOT EXISTS idx_scan_events_event_id ON public.scan_events (event_id);
CREATE INDEX IF NOT EXISTS idx_scan_events_scanned_at ON public.scan_events (scanned_at);

COMMENT ON TABLE public.scan_events IS 'Append-only scan audit trail (B1 §B.5).';

ALTER TABLE public.scan_events ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Trigger: scanners may only mutate check-in columns; finance+ bypasses.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.biz_tickets_enforce_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_brand uuid;
  v_is_team boolean;
  v_is_scanner boolean;
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  v_brand := public.biz_event_brand_id(OLD.event_id);
  v_is_team :=
    public.biz_is_brand_member_for_read(v_brand, auth.uid())
    AND public.biz_brand_effective_rank(v_brand, auth.uid())
      >= public.biz_role_rank('finance_manager'::text);

  v_is_scanner := EXISTS (
    SELECT 1
    FROM public.event_scanners es
    WHERE es.event_id = OLD.event_id
      AND es.user_id = auth.uid()
      AND es.removed_at IS NULL
      AND COALESCE((es.permissions ->> 'scan')::boolean, true)
  );

  IF v_is_team THEN
    RETURN NEW;
  END IF;

  IF v_is_scanner THEN
    IF NEW.id IS DISTINCT FROM OLD.id
      OR NEW.order_id IS DISTINCT FROM OLD.order_id
      OR NEW.ticket_type_id IS DISTINCT FROM OLD.ticket_type_id
      OR NEW.event_id IS DISTINCT FROM OLD.event_id
      OR NEW.attendee_name IS DISTINCT FROM OLD.attendee_name
      OR NEW.attendee_email IS DISTINCT FROM OLD.attendee_email
      OR NEW.attendee_phone IS DISTINCT FROM OLD.attendee_phone
      OR NEW.qr_code IS DISTINCT FROM OLD.qr_code
      OR NEW.transferred_to_email IS DISTINCT FROM OLD.transferred_to_email
      OR NEW.transferred_at IS DISTINCT FROM OLD.transferred_at
      OR NEW.approval_status IS DISTINCT FROM OLD.approval_status
      OR NEW.approval_decided_by IS DISTINCT FROM OLD.approval_decided_by
      OR NEW.approval_decided_at IS DISTINCT FROM OLD.approval_decided_at
      OR NEW.created_at IS DISTINCT FROM OLD.created_at
    THEN
      RAISE EXCEPTION 'Scanners may only update check-in fields on tickets';
    END IF;

    IF OLD.status = 'valid' AND NEW.status = 'used' THEN
      RETURN NEW;
    END IF;

    IF NEW.status IS DISTINCT FROM OLD.status
      OR NEW.used_at IS DISTINCT FROM OLD.used_at
      OR NEW.used_by_scanner_id IS DISTINCT FROM OLD.used_by_scanner_id
    THEN
      RAISE EXCEPTION 'Invalid ticket update for scanner role';
    END IF;

    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Not authorized to update ticket';
END;
$$;

DROP TRIGGER IF EXISTS trg_tickets_enforce_update ON public.tickets;
CREATE TRIGGER trg_tickets_enforce_update
  BEFORE UPDATE ON public.tickets
  FOR EACH ROW
  EXECUTE FUNCTION public.biz_tickets_enforce_update();

CREATE OR REPLACE FUNCTION public.biz_scan_events_block_mutate()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  RAISE EXCEPTION 'scan_events is append-only for clients';
END;
$$;

DROP TRIGGER IF EXISTS trg_scan_events_block_update ON public.scan_events;
CREATE TRIGGER trg_scan_events_block_update
  BEFORE UPDATE OR DELETE ON public.scan_events
  FOR EACH ROW
  EXECUTE FUNCTION public.biz_scan_events_block_mutate();

-- ---------------------------------------------------------------------------
-- RLS: scanner_invitations (event_manager+)
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Event manager plus can manage scanner_invitations" ON public.scanner_invitations;
CREATE POLICY "Event manager plus can manage scanner_invitations"
  ON public.scanner_invitations
  FOR ALL
  TO authenticated
  USING (public.biz_is_event_manager_plus(event_id, auth.uid()))
  WITH CHECK (public.biz_is_event_manager_plus(event_id, auth.uid()));

-- ---------------------------------------------------------------------------
-- RLS: event_scanners
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Scanners and managers read event_scanners" ON public.event_scanners;
CREATE POLICY "Scanners and managers read event_scanners"
  ON public.event_scanners
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR public.biz_is_event_manager_plus(event_id, auth.uid())
  );

DROP POLICY IF EXISTS "Event manager plus insert event_scanners" ON public.event_scanners;
CREATE POLICY "Event manager plus insert event_scanners"
  ON public.event_scanners
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.biz_is_event_manager_plus(event_id, auth.uid())
    AND assigned_by = auth.uid()
  );

DROP POLICY IF EXISTS "Event manager plus update event_scanners" ON public.event_scanners;
CREATE POLICY "Event manager plus update event_scanners"
  ON public.event_scanners
  FOR UPDATE
  TO authenticated
  USING (public.biz_is_event_manager_plus(event_id, auth.uid()))
  WITH CHECK (public.biz_is_event_manager_plus(event_id, auth.uid()));

DROP POLICY IF EXISTS "Event manager plus delete event_scanners" ON public.event_scanners;
CREATE POLICY "Event manager plus delete event_scanners"
  ON public.event_scanners
  FOR DELETE
  TO authenticated
  USING (public.biz_is_event_manager_plus(event_id, auth.uid()));

-- ---------------------------------------------------------------------------
-- RLS: tickets
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Buyer or brand team can select tickets" ON public.tickets;
CREATE POLICY "Buyer or brand team can select tickets"
  ON public.tickets
  FOR SELECT
  TO authenticated
  USING (
    public.biz_is_brand_member_for_read(
      public.biz_event_brand_id(event_id),
      auth.uid()
    )
    OR EXISTS (
      SELECT 1
      FROM public.orders o
      WHERE o.id = tickets.order_id
        AND o.buyer_user_id IS NOT DISTINCT FROM auth.uid()
    )
  );

DROP POLICY IF EXISTS "Finance plus can update tickets" ON public.tickets;
CREATE POLICY "Finance plus can update tickets"
  ON public.tickets
  FOR UPDATE
  TO authenticated
  USING (
    public.biz_brand_effective_rank(
      public.biz_event_brand_id(event_id),
      auth.uid()
    ) >= public.biz_role_rank('finance_manager'::text)
  )
  WITH CHECK (
    public.biz_brand_effective_rank(
      public.biz_event_brand_id(event_id),
      auth.uid()
    ) >= public.biz_role_rank('finance_manager'::text)
  );

DROP POLICY IF EXISTS "Scanners can update tickets for check-in" ON public.tickets;
CREATE POLICY "Scanners can update tickets for check-in"
  ON public.tickets
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.event_scanners es
      WHERE es.event_id = tickets.event_id
        AND es.user_id = auth.uid()
        AND es.removed_at IS NULL
        AND COALESCE((es.permissions ->> 'scan')::boolean, true)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.event_scanners es
      WHERE es.event_id = tickets.event_id
        AND es.user_id = auth.uid()
        AND es.removed_at IS NULL
        AND COALESCE((es.permissions ->> 'scan')::boolean, true)
    )
  );

-- ---------------------------------------------------------------------------
-- RLS: scan_events (team read; scanner inserts own rows)
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Brand team can select scan_events" ON public.scan_events;
CREATE POLICY "Brand team can select scan_events"
  ON public.scan_events
  FOR SELECT
  TO authenticated
  USING (
    public.biz_is_brand_member_for_read(
      public.biz_event_brand_id(event_id),
      auth.uid()
    )
  );

DROP POLICY IF EXISTS "Scanners insert own scan_events" ON public.scan_events;
CREATE POLICY "Scanners insert own scan_events"
  ON public.scan_events
  FOR INSERT
  TO authenticated
  WITH CHECK (
    scanner_user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.event_scanners es
      WHERE es.event_id = scan_events.event_id
        AND es.user_id = auth.uid()
        AND es.removed_at IS NULL
        AND COALESCE((es.permissions ->> 'scan')::boolean, true)
    )
  );
