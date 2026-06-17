-- ===========================================================================
-- META-ORCH-1148 sub-ORCH 2.2a — reservations guest fields + consumer-own RLS
-- ---------------------------------------------------------------------------
-- Additive-only schema extensions enabling the guest/consumer reservation
-- write path (SPEC §4.A.2 + §4.A.5):
--
--   (1) Widen the created_via CHECK from ('operator','consumer') to add 'guest'
--       (anon-web). 'guest' = anon-web (identity is buyer name/email/E.164 on
--       the row); 'consumer' = signed-in app user (consumer_user_id set);
--       'operator' = manual operator create. A CHECK widen is a DROP-then-ADD,
--       NOT an in-place edit (migration-baseline rule).
--   (2) Add guest_cancel_token text NULL — an opaque random token minted for
--       source='website' rows, used by the web cancel-from-link. NULL for
--       app/operator rows where the signed-in user owns the row. Never exposed
--       to other guests.
--   (3) A partial index on guest_cancel_token (the cancel-link lookup path).
--   (4) The deferred 2.0-promised consumer "see my own reservation" SELECT RLS
--       policy (20261003000005 header lines 6-7): a signed-in consumer reads
--       ONLY rows where consumer_user_id = auth.uid(). The existing
--       brand-member-read policy is UNAFFECTED (RLS is permissive-OR), so a
--       brand member still reads their brand's rows.
--
-- `source` is NOT altered — it already includes 'mingla' (app) and 'website'
-- (anon web). status CHECK is NOT altered. RLS write policy is NOT loosened —
-- the guest write goes through the SECURITY DEFINER service-role RPC in
-- 20261012000002, never a client-direct INSERT.
--
-- Additive-only; idempotent; BEGIN/COMMIT. MONOTONIC VERSION 20261012000001.
-- Apply via the Supabase Management API.
-- ===========================================================================

BEGIN;

-- (1) Widen created_via CHECK: add 'guest'. DROP-then-ADD (not in-place).
ALTER TABLE public.reservations
  DROP CONSTRAINT IF EXISTS reservations_created_via_check;
ALTER TABLE public.reservations
  ADD CONSTRAINT reservations_created_via_check
  CHECK (created_via IN ('operator', 'consumer', 'guest'));

-- (2) guest_cancel_token — opaque web cancel-link token (NULL for app/operator).
ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS guest_cancel_token text NULL;

COMMENT ON COLUMN public.reservations.guest_cancel_token IS
  'META-ORCH-1148 2.2a: opaque random token minted for source=''website'' (anon-web) rows; the web cancel-from-link presents it to pg_cancel_guest_reservation. NULL for app/operator rows (the signed-in user owns the row). Never exposed to other guests.';

-- (3) cancel-link lookup index (partial — only the web rows carry a token).
CREATE INDEX IF NOT EXISTS reservations_guest_cancel_token_idx
  ON public.reservations (guest_cancel_token)
  WHERE guest_cancel_token IS NOT NULL;

-- (4) The deferred consumer-own-read SELECT RLS policy (2.0 promised it). A
-- signed-in consumer reads ONLY their own reservations. Additive — the
-- brand-member-read policy is unaffected (permissive-OR). NO write policy added
-- (the guest writer is the service-role RPC). I-PROPOSED-1148-RESERVATIONS-
-- RLS-BRAND-SCOPED is EXTENDED, not loosened.
DROP POLICY IF EXISTS "reservations consumer can read own" ON public.reservations;
CREATE POLICY "reservations consumer can read own" ON public.reservations
  FOR SELECT TO authenticated
  USING (consumer_user_id = auth.uid());

COMMIT;
