-- Cycle B1 Phase 4a — Ticket catalog + waitlist (BUSINESS_PROJECT_PLAN §B.4).
-- Issued tickets ship in phase 6 after scanners; orders in phase 5.

CREATE TABLE IF NOT EXISTS public.ticket_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events (id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  price_cents integer NOT NULL DEFAULT 0,
  currency char(3) NOT NULL DEFAULT 'GBP',
  quantity_total integer,
  is_unlimited boolean NOT NULL DEFAULT false,
  is_free boolean NOT NULL DEFAULT false,
  sale_start_at timestamptz,
  sale_end_at timestamptz,
  validity_start_at timestamptz,
  validity_end_at timestamptz,
  min_purchase_qty integer NOT NULL DEFAULT 1,
  max_purchase_qty integer,
  is_hidden boolean NOT NULL DEFAULT false,
  is_disabled boolean NOT NULL DEFAULT false,
  requires_approval boolean NOT NULL DEFAULT false,
  allow_transfers boolean NOT NULL DEFAULT false,
  password_protected boolean NOT NULL DEFAULT false,
  password_hash text,
  available_online boolean NOT NULL DEFAULT true,
  available_in_person boolean NOT NULL DEFAULT true,
  waitlist_enabled boolean NOT NULL DEFAULT false,
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT ticket_types_name_nonempty CHECK (length(trim(name)) > 0),
  CONSTRAINT ticket_types_price_non_negative CHECK (price_cents >= 0),
  CONSTRAINT ticket_types_qty_positive CHECK (quantity_total IS NULL OR quantity_total > 0),
  CONSTRAINT ticket_types_min_max_qty CHECK (
    max_purchase_qty IS NULL OR max_purchase_qty >= min_purchase_qty
  )
);

CREATE INDEX IF NOT EXISTS idx_ticket_types_event_id
  ON public.ticket_types (event_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_ticket_types_event_display
  ON public.ticket_types (event_id, display_order)
  WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_ticket_types_updated_at ON public.ticket_types;
CREATE TRIGGER trg_ticket_types_updated_at
  BEFORE UPDATE ON public.ticket_types
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

COMMENT ON TABLE public.ticket_types IS 'Sellable ticket products for an event (B1 §B.4).';

ALTER TABLE public.ticket_types ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.waitlist_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events (id) ON DELETE CASCADE,
  ticket_type_id uuid NOT NULL REFERENCES public.ticket_types (id) ON DELETE CASCADE,
  email text NOT NULL,
  phone text,
  name text,
  status text NOT NULL DEFAULT 'waiting'
    CONSTRAINT waitlist_entries_status_check
      CHECK (status IN ('waiting', 'invited', 'converted', 'expired')),
  invited_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT waitlist_entries_email_nonempty CHECK (length(trim(email)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_waitlist_entries_event_id ON public.waitlist_entries (event_id);
CREATE INDEX IF NOT EXISTS idx_waitlist_entries_ticket_type_id ON public.waitlist_entries (ticket_type_id);

COMMENT ON TABLE public.waitlist_entries IS 'Waitlist; client writes via service role only (B1 §B.4).';

ALTER TABLE public.waitlist_entries ENABLE ROW LEVEL SECURITY;

-- RLS ticket_types: team read; finance_manager+ write
DROP POLICY IF EXISTS "Brand team can select ticket_types" ON public.ticket_types;
CREATE POLICY "Brand team can select ticket_types"
  ON public.ticket_types
  FOR SELECT
  TO authenticated
  USING (
    deleted_at IS NULL
    AND EXISTS (
      SELECT 1
      FROM public.events e
      WHERE e.id = ticket_types.event_id
        AND e.deleted_at IS NULL
        AND public.biz_is_brand_member_for_read(e.brand_id, auth.uid())
    )
  );

DROP POLICY IF EXISTS "Finance or event manager can insert ticket_types" ON public.ticket_types;
CREATE POLICY "Finance or event manager can insert ticket_types"
  ON public.ticket_types
  FOR INSERT
  TO authenticated
  WITH CHECK (
    deleted_at IS NULL
    AND EXISTS (
      SELECT 1
      FROM public.events e
      WHERE e.id = ticket_types.event_id
        AND e.deleted_at IS NULL
        AND public.biz_brand_effective_rank(e.brand_id, auth.uid())
          >= public.biz_role_rank('finance_manager'::text)
    )
  );

DROP POLICY IF EXISTS "Finance or event manager can update ticket_types" ON public.ticket_types;
CREATE POLICY "Finance or event manager can update ticket_types"
  ON public.ticket_types
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.events e
      WHERE e.id = ticket_types.event_id
        AND e.deleted_at IS NULL
        AND public.biz_brand_effective_rank(e.brand_id, auth.uid())
          >= public.biz_role_rank('finance_manager'::text)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.events e
      WHERE e.id = ticket_types.event_id
        AND e.deleted_at IS NULL
        AND public.biz_brand_effective_rank(e.brand_id, auth.uid())
          >= public.biz_role_rank('finance_manager'::text)
    )
  );

DROP POLICY IF EXISTS "Finance or event manager can delete ticket_types" ON public.ticket_types;
CREATE POLICY "Finance or event manager can delete ticket_types"
  ON public.ticket_types
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.events e
      WHERE e.id = ticket_types.event_id
        AND e.deleted_at IS NULL
        AND public.biz_brand_effective_rank(e.brand_id, auth.uid())
          >= public.biz_role_rank('finance_manager'::text)
    )
  );

-- waitlist: brand team read only (writes = service role)
DROP POLICY IF EXISTS "Brand team can select waitlist_entries" ON public.waitlist_entries;
CREATE POLICY "Brand team can select waitlist_entries"
  ON public.waitlist_entries
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.events e
      WHERE e.id = waitlist_entries.event_id
        AND e.deleted_at IS NULL
        AND public.biz_is_brand_member_for_read(e.brand_id, auth.uid())
    )
  );
