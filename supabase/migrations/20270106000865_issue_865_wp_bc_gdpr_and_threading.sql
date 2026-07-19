-- ISSUE-865 [Attribution & reservation-conversion tracking] — WP-B / WP-C
-- Additive migration folding in the two QA hardening notes + the checkout
-- threading column the browser conversion lane needs. WRITTEN, not applied
-- (orchestrator/operator runs `supabase db push` from MERGED main).
--
-- SPEC: SPEC_ISSUE-865_ATTRIBUTION_ENGINE.md §5.1 (threading) + the WP-A QA
--   hardening carry-forward:
--     P3-2 (GDPR) — ad_attribution_touches.user_id must be ON DELETE SET NULL
--       so a user erasure (auth.users delete) NULLs the touch's user_id instead
--       of being blocked by the default NO ACTION / failing the erasure. The
--       WP-A migration (20270105000865) created the FK inline with no ON DELETE
--       action; this narrows it to SET NULL. Additive, non-destructive.
--     §5.1 threading — ticket_checkout_sessions.attribution_click_id carries the
--       first-party click_id captured on the public page (WP-C) from the browser
--       into the session, so the WP-B fire helper can resolve order -> session ->
--       touch -> campaign at the post-finalize point WITHOUT editing the
--       DO-NOT-TOUCH biz_ticket_checkout_finalize internals.
--
-- MIGRATION HYGIENE (COMMS-0102): version prefix 20270106000865 is strictly
-- greater than the WP-A head 20270105000865 and every sibling-worktree prefix,
-- and is none of the six known duplicate 2026-* prefixes.
--
-- This migration touches NO purchase/finalize logic — it only relaxes a FK for
-- GDPR and adds one nullable column. Nothing here can block or reverse a sale.

-- ════════════════════════════════════════════════════════════════════════
-- 1. P3-2 (GDPR) — ad_attribution_touches.user_id → ON DELETE SET NULL
-- ════════════════════════════════════════════════════════════════════════

ALTER TABLE public.ad_attribution_touches
  DROP CONSTRAINT IF EXISTS ad_attribution_touches_user_id_fkey;

ALTER TABLE public.ad_attribution_touches
  ADD CONSTRAINT ad_attribution_touches_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.ad_attribution_touches.user_id IS
  'ISSUE-865 P3-2 (GDPR): ON DELETE SET NULL — a user erasure NULLs the attribution touch''s user_id rather than being blocked. The touch row itself is retained (anonymised) for aggregate campaign rollups; no raw PII is stored on it (only ua_hash/ip_hash — SC-9).';

-- ════════════════════════════════════════════════════════════════════════
-- 2. §5.1 threading — ticket_checkout_sessions.attribution_click_id
-- ════════════════════════════════════════════════════════════════════════
-- Additive, nullable, no default. Populated by ticket-checkout-create ONLY when
-- the browser forwards it (byte-identical write when absent). Read by the WP-B
-- adConversionFire helper via orders.id -> ticket_checkout_sessions.order_id.

ALTER TABLE public.ticket_checkout_sessions
  ADD COLUMN IF NOT EXISTS attribution_click_id text NULL;

COMMENT ON COLUMN public.ticket_checkout_sessions.attribution_click_id IS
  'ISSUE-865 WP-C threading: the first-party ad click_id (from ad_attribution_touches.click_id) captured on the public page and forwarded at checkout-create, so the post-finalize conversion send (WP-B) can link order -> touch -> campaign WITHOUT touching biz_ticket_checkout_finalize internals. NULL for non-ad traffic.';

CREATE INDEX IF NOT EXISTS idx_ticket_checkout_sessions_attribution_click
  ON public.ticket_checkout_sessions (attribution_click_id)
  WHERE attribution_click_id IS NOT NULL;
