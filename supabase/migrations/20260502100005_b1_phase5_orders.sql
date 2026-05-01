-- Cycle B1 Phase 5 — Orders + line items (BUSINESS_PROJECT_PLAN §B.4).
-- Issued tickets (tickets table) ship in phase 6 after event_scanners exists.

CREATE TABLE IF NOT EXISTS public.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events (id) ON DELETE CASCADE,
  buyer_user_id uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  buyer_email text,
  buyer_name text,
  buyer_phone text,
  total_cents integer NOT NULL DEFAULT 0,
  currency char(3) NOT NULL DEFAULT 'GBP',
  payment_method text NOT NULL DEFAULT 'online_card'
    CONSTRAINT orders_payment_method_check
      CHECK (
        payment_method IN (
          'online_card',
          'nfc',
          'card_reader',
          'cash',
          'manual'
        )
      ),
  payment_status text NOT NULL DEFAULT 'pending'
    CONSTRAINT orders_payment_status_check
      CHECK (
        payment_status IN (
          'pending',
          'paid',
          'failed',
          'refunded',
          'partial_refund'
        )
      ),
  stripe_payment_intent_id text,
  stripe_charge_id text,
  is_door_sale boolean NOT NULL DEFAULT false,
  created_by_scanner_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT orders_total_non_negative CHECK (total_cents >= 0)
);

CREATE INDEX IF NOT EXISTS idx_orders_event_id ON public.orders (event_id);
CREATE INDEX IF NOT EXISTS idx_orders_buyer_user_id ON public.orders (buyer_user_id);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON public.orders (created_at);
CREATE INDEX IF NOT EXISTS idx_orders_payment_status ON public.orders (payment_status);

DROP TRIGGER IF EXISTS trg_orders_updated_at ON public.orders;
CREATE TRIGGER trg_orders_updated_at
  BEFORE UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

COMMENT ON TABLE public.orders IS 'Ticket / door orders (B1 §B.4).';
COMMENT ON COLUMN public.orders.created_by_scanner_id IS 'FK to event_scanners added in phase 6 migration.';

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.order_line_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders (id) ON DELETE CASCADE,
  ticket_type_id uuid NOT NULL REFERENCES public.ticket_types (id) ON DELETE RESTRICT,
  quantity integer NOT NULL DEFAULT 1,
  unit_price_cents integer NOT NULL DEFAULT 0,
  total_cents integer NOT NULL DEFAULT 0,
  CONSTRAINT order_line_items_qty_positive CHECK (quantity > 0),
  CONSTRAINT order_line_items_prices_non_negative CHECK (
    unit_price_cents >= 0 AND total_cents >= 0
  )
);

CREATE INDEX IF NOT EXISTS idx_order_line_items_order_id ON public.order_line_items (order_id);
CREATE INDEX IF NOT EXISTS idx_order_line_items_ticket_type_id ON public.order_line_items (ticket_type_id);

COMMENT ON TABLE public.order_line_items IS 'Line items for an order (B1 §B.4).';

ALTER TABLE public.order_line_items ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.biz_can_read_order(p_order_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.orders o
    JOIN public.events e ON e.id = o.event_id
    WHERE o.id = p_order_id
      AND e.deleted_at IS NULL
      AND (
        o.buyer_user_id IS NOT DISTINCT FROM p_user_id
        OR public.biz_is_brand_member_for_read(e.brand_id, p_user_id)
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.biz_can_manage_orders_for_event(p_event_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.biz_brand_effective_rank(
    public.biz_event_brand_id(p_event_id),
    p_user_id
  ) >= public.biz_role_rank('finance_manager'::text);
$$;

-- orders RLS
DROP POLICY IF EXISTS "Buyer or brand team can select orders" ON public.orders;
CREATE POLICY "Buyer or brand team can select orders"
  ON public.orders
  FOR SELECT
  TO authenticated
  USING (public.biz_can_read_order(id, auth.uid()));

DROP POLICY IF EXISTS "Finance plus can insert orders" ON public.orders;
CREATE POLICY "Finance plus can insert orders"
  ON public.orders
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.biz_can_manage_orders_for_event(event_id, auth.uid())
  );

DROP POLICY IF EXISTS "Finance plus can update orders" ON public.orders;
CREATE POLICY "Finance plus can update orders"
  ON public.orders
  FOR UPDATE
  TO authenticated
  USING (public.biz_can_manage_orders_for_event(event_id, auth.uid()))
  WITH CHECK (public.biz_can_manage_orders_for_event(event_id, auth.uid()));

DROP POLICY IF EXISTS "Finance plus can delete orders" ON public.orders;
CREATE POLICY "Finance plus can delete orders"
  ON public.orders
  FOR DELETE
  TO authenticated
  USING (public.biz_can_manage_orders_for_event(event_id, auth.uid()));

-- order_line_items RLS (inherit order access)
DROP POLICY IF EXISTS "Order parties can select line items" ON public.order_line_items;
CREATE POLICY "Order parties can select line items"
  ON public.order_line_items
  FOR SELECT
  TO authenticated
  USING (public.biz_can_read_order(order_id, auth.uid()));

DROP POLICY IF EXISTS "Finance plus can insert line items" ON public.order_line_items;
CREATE POLICY "Finance plus can insert line items"
  ON public.order_line_items
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.orders o
      WHERE o.id = order_line_items.order_id
        AND public.biz_can_manage_orders_for_event(o.event_id, auth.uid())
    )
  );

DROP POLICY IF EXISTS "Finance plus can update line items" ON public.order_line_items;
CREATE POLICY "Finance plus can update line items"
  ON public.order_line_items
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.orders o
      WHERE o.id = order_line_items.order_id
        AND public.biz_can_manage_orders_for_event(o.event_id, auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.orders o
      WHERE o.id = order_line_items.order_id
        AND public.biz_can_manage_orders_for_event(o.event_id, auth.uid())
    )
  );

DROP POLICY IF EXISTS "Finance plus can delete line items" ON public.order_line_items;
CREATE POLICY "Finance plus can delete line items"
  ON public.order_line_items
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.orders o
      WHERE o.id = order_line_items.order_id
        AND public.biz_can_manage_orders_for_event(o.event_id, auth.uid())
    )
  );
