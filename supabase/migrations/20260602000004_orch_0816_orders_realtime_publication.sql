-- ORCH-0816 — add `public.orders` to the supabase_realtime publication so the
-- mingla-business brand owner can subscribe to postgres_changes on their
-- brand's orders for KPI tile freshness.
--
-- Security note: RLS policy "Buyer or brand team can select orders"
-- (defined in baseline squash) gates SELECT to the buyer and the brand
-- team via biz_can_read_order_for_caller(id). The publication change
-- does NOT broaden read access — Supabase Realtime enforces the same
-- RLS on event delivery as it does on direct SELECT.
ALTER PUBLICATION supabase_realtime ADD TABLE public.orders;
