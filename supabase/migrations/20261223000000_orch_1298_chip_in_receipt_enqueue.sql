-- ===========================================================================
-- ORCH-1298 [chip-in-receipt-emails] — receipt when a chip-in gift clears, for
-- BOTH the guest (gift-framed thank-you) and the host ("you got a gift").
--
-- WHAT: when a voluntary RSVP chip-in flips to `paid`, enqueue two notifications
-- exactly once, on BOTH payment rails (Stripe + Paystack):
--   (1) GUEST receipt   — email (always; anon by guest_email OR logged-in by
--       account) + in-app + push (logged-in guests).
--   (2) HOST alert      — business-app push + in-app per accepted owner/admin/
--       finance team member, PLUS one brand-contact email (fail-soft: skipped
--       when brands.contact_email is null).
--
-- HOW (single idempotent write, both rails): BOTH the Stripe router and the
-- Paystack router call ONE RPC — public.finalize_rsvp_contribution — which
-- early-returns on an already-`paid` row (idempotent replay) and serializes
-- concurrent webhooks via SELECT … FOR UPDATE. So the enqueue lives on the
-- NON-REPLAY branch of that RPC: written ONCE, covers Stripe AND Paystack, and
-- a replayed webhook enqueues NOTHING (idempotency, §9 fails-on-revert). The
-- rows drain via the LIVE META-ORCH-1161 v2 pipeline:
--   notification_outbox → 1-min cron notify-outbox-drain → notify-dispatch v2
--   → renderCategoryMessage(category_key,payload) → Resend / OneSignal / in-app.
--
-- WHY the enqueue is on the non-replay branch (NOT in the webhook routers):
-- a single idempotent write point means the dual rails cannot double-send and a
-- replay cannot re-enqueue. Removing/relocating it breaks the idempotency contract.
--
-- SCOPE GUARD: this migration touches ONLY (a) the two seeded categories and
-- (b) finalize_rsvp_contribution (CREATE OR REPLACE, signature UNCHANGED → no
-- DROP). The ORCH-1291 body is reproduced VERBATIM; the ONLY addition is the
-- exception-safe enqueue block after the `status='paid'` UPDATE and before the
-- final RETURN. NO money math, NO paid-flip logic change, NO schema ALTER.
--
-- Monotonic prefix 20261223000000 (frontier across all worktrees + anchor =
-- 20261222000000_orch_1296; verified — nothing >= 20261223 exists).
--
-- Contract: Mingla_Artifacts/specs/SPEC_ORCH-1298_CHIP_IN_RECEIPT_EMAILS.md §4.1, §8.
-- Evidence: Mingla_Artifacts/reports/INVESTIGATION_ORCH-1298_CHIP_IN_RECEIPT_EMAILS.md.
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- (a) Seed the two notification_categories (idempotent ON CONFLICT DO UPDATE,
--     mirroring 20261110000001_orch_1161_seed_notification_categories.sql).
--
--     • buyer_contribution_receipt  — GUEST gift receipt. is_transactional=true
--       (can_send on-by-default). Channels: inapp+push+email. NO sms (DC-3 /
--       I-PROPOSED-1161 closed-SMS-set preserved). Unprefixed key → the v2 push
--       routes to the CONSUMER OneSignal app (resolveOneSignalApp).
--     • business.rsvp_contribution_received — HOST gift-received. `business.`-
--       prefixed key → the v2 push routes to the BUSINESS OneSignal app
--       (I-PROPOSED-W). Channels: inapp+push+email. NO sms.
--
--     Copy is rendered in _shared/notifyTemplates.ts (renderCategoryMessage),
--     NOT here. NO tax/invoice language — these are gift thank-yous.
-- ---------------------------------------------------------------------------
INSERT INTO public.notification_categories
  (key, section, is_transactional, urgency, default_channels, reach_mode)
VALUES
  ('buyer_contribution_receipt', 'Purchases', true, 'normal',
     ARRAY['inapp','push','email'], 'reach_once'),
  ('business.rsvp_contribution_received', 'Payments', true, 'normal',
     ARRAY['inapp','push','email'], 'reach_once')
ON CONFLICT (key) DO UPDATE SET
  section          = EXCLUDED.section,
  is_transactional = EXCLUDED.is_transactional,
  urgency          = EXCLUDED.urgency,
  default_channels = EXCLUDED.default_channels,
  reach_mode       = EXCLUDED.reach_mode,
  active           = true;

-- ---------------------------------------------------------------------------
-- (b) finalize_rsvp_contribution — ORCH-1291 body reproduced VERBATIM (signature
--     unchanged → CREATE OR REPLACE, NO DROP) with the ONLY addition being the
--     ORCH-1298 exception-safe enqueue block on the non-replay branch.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.finalize_rsvp_contribution(
  p_contribution_id     uuid,
  p_provider_ref        text,
  p_charge_id           text,
  p_payment_method_type text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_row public.event_rsvp_contributions%ROWTYPE;
  -- ORCH-1298 — enqueue locals (declared but only used on the non-replay branch).
  v_event_title   text;
  v_guest_label   text;
  v_guest_email   text;
  v_guest_payload jsonb;
  v_host_payload  jsonb;
BEGIN
  SELECT * INTO v_row
    FROM public.event_rsvp_contributions
   WHERE id = p_contribution_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'contribution_not_found';
  END IF;

  -- Idempotent early-return: a duplicate webhook delivery for an already-paid
  -- contribution is a no-op (T-11). Return the current row as-is.
  -- ORCH-1298: because the enqueue below lives AFTER this guard, a replayed
  -- webhook enqueues NOTHING (SC-6 / T-4).
  IF v_row.status = 'paid' THEN
    RETURN jsonb_build_object(
      'ok', true,
      'idempotent_replay', true,
      'contribution_id', v_row.id,
      'status', v_row.status
    );
  END IF;

  -- Authenticity note: p_contribution_id arrives from Stripe/Paystack metadata
  -- that Mingla set at create and the provider echoes back verbatim on a
  -- signature-verified webhook, so the id is trustworthy. We do NOT hard-match
  -- the provider ref (the web Stripe path stores the Checkout Session id, but
  -- payment_intent.succeeded carries the PI id — a strict match would falsely
  -- reject the web finalize). The ref is back-filled below for audit only.
  UPDATE public.event_rsvp_contributions
     SET status = 'paid',
         paid_at = now(),
         stripe_charge_id = COALESCE(p_charge_id, stripe_charge_id),
         stripe_payment_intent_id = COALESCE(stripe_payment_intent_id, p_provider_ref),
         updated_at = now()
   WHERE id = p_contribution_id
     AND status <> 'paid';

  -- =========================================================================
  -- ORCH-1298 — enqueue the guest gift-receipt + host gift-received rows.
  -- NON-REPLAY branch ONLY (the replay path early-returned above), so this runs
  -- EXACTLY ONCE per paid contribution, for BOTH rails (Stripe + Paystack call
  -- this same RPC). v_row still holds the pre-UPDATE snapshot; every field used
  -- here (id/event_id/brand_id/user_id/guest_name/guest_email/amount_cents/
  -- currency) is UNCHANGED by the UPDATE above, so the snapshot is correct.
  --
  -- FAIL-SOFT: the whole block is a nested BEGIN…EXCEPTION subtransaction so a
  -- notification failure NEVER rolls back the paid-flip (mirrors the
  -- "notifications are best-effort" posture of fireOrderFinalizeNotifications).
  -- Each INSERT is ON CONFLICT (idempotency_key) DO NOTHING (the outbox has a
  -- UNIQUE index on idempotency_key), so a concurrent/duplicate enqueue collapses.
  -- =========================================================================
  BEGIN
    v_event_title := (SELECT e.title FROM public.events e WHERE e.id = v_row.event_id);
    -- Guest display label for the HOST copy ("Someone chipped in …" when anon w/o name).
    v_guest_label := COALESCE(NULLIF(btrim(v_row.guest_name), ''), 'Someone');
    -- Reachable guest email: the raw guest_email (anon) OR the account email
    -- (logged-in guest whose guest_email is null). auth.users is schema-qualified
    -- (search_path excludes auth); this SECURITY DEFINER fn's owner can read it.
    v_guest_email := COALESCE(
      v_row.guest_email,
      (SELECT u.email FROM auth.users u WHERE u.id = v_row.user_id)
    );

    -- Payload carried to renderCategoryMessage (F-3): amount_cents + currency
    -- drive the currency-aware fmtAmount (§4.5). brand_name is injected by the
    -- outbox drain from brand_id, so it is NOT set here.
    v_guest_payload := jsonb_build_object(
      'contribution_id', v_row.id,
      'event_id',        v_row.event_id,
      'event_title',     v_event_title,
      'amount_cents',    v_row.amount_cents,
      'currency',        v_row.currency
    );
    v_host_payload := v_guest_payload || jsonb_build_object('guest_name', v_guest_label);

    -- (1) GUEST receipt — one row. contact = resolved email; user_id may be null
    --     (anon → dispatchAnon emails the raw contact) or set (logged-in →
    --     inapp+push+email).
    INSERT INTO public.notification_outbox
      (category_key, user_id, contact, brand_id, payload, idempotency_key)
    VALUES (
      'buyer_contribution_receipt',
      v_row.user_id,
      v_guest_email,
      v_row.brand_id,
      v_guest_payload,
      'chip_in_receipt:' || v_row.id || ':guest'
    )
    ON CONFLICT (idempotency_key) DO NOTHING;

    -- (2) HOST push + in-app — one row PER accepted owner/admin/finance team
    --     member (v2 push targets a single user_id). contact=NULL → the email
    --     channel records skipped(no_contact) while business-app push + in-app
    --     fire. Roles match the LIVE brand-payments audience (BRAND_PAYMENTS_ROLES
    --     in _shared/stripeEdgeAuth.ts; post-ORCH-1047 the owner role is
    --     'brand_owner').
    INSERT INTO public.notification_outbox
      (category_key, user_id, contact, brand_id, payload, idempotency_key)
    SELECT
      'business.rsvp_contribution_received',
      m.user_id,
      NULL,
      v_row.brand_id,
      v_host_payload,
      'chip_in_receipt:' || v_row.id || ':host:' || m.user_id
    FROM public.brand_team_members m
    WHERE m.brand_id = v_row.brand_id
      AND m.removed_at IS NULL
      AND m.accepted_at IS NOT NULL
      AND m.role IN ('brand_owner', 'brand_admin', 'finance_manager')
    ON CONFLICT (idempotency_key) DO NOTHING;

    -- (3) HOST email — one row to the brand contact address (email leg; user_id
    --     NULL → dispatchAnon emails once, inapp/push skipped). Seth-requested
    --     addition beyond ticket-sale parity. FAIL-SOFT: skipped when
    --     brands.contact_email is null/blank (the host still gets push + in-app
    --     from (2)).
    INSERT INTO public.notification_outbox
      (category_key, user_id, contact, brand_id, payload, idempotency_key)
    SELECT
      'business.rsvp_contribution_received',
      NULL,
      b.contact_email,
      v_row.brand_id,
      v_host_payload,
      'chip_in_receipt:' || v_row.id || ':host_email'
    FROM public.brands b
    WHERE b.id = v_row.brand_id
      AND b.contact_email IS NOT NULL
      AND btrim(b.contact_email) <> ''
    ON CONFLICT (idempotency_key) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    -- Notifications are best-effort: swallow + log so the paid finalize commits.
    RAISE WARNING 'finalize_rsvp_contribution: chip-in receipt enqueue failed (contribution %): %',
      p_contribution_id, SQLERRM;
  END;

  RETURN jsonb_build_object(
    'ok', true,
    'idempotent_replay', false,
    'contribution_id', p_contribution_id,
    'status', 'paid'
  );
END;
$function$;

COMMENT ON FUNCTION public.finalize_rsvp_contribution(uuid, text, text, text) IS
  'ORCH-1291 + ORCH-1298 — finalize a voluntary RSVP contribution from the '
  'verified Stripe/Paystack webhook. IDEMPOTENT: early-returns if already paid '
  '(T-11). Writes ONLY the contribution row (NO order/ticket/QR). ORCH-1298: on '
  'the NON-REPLAY branch ONLY, enqueues a guest gift-receipt + host '
  'gift-received into notification_outbox (exception-safe, ON CONFLICT DO '
  'NOTHING) — one idempotent write covering BOTH rails; a replay enqueues '
  'nothing. service_role only.';

GRANT EXECUTE ON FUNCTION public.finalize_rsvp_contribution(uuid, text, text, text) TO service_role;

COMMIT;

-- PostgREST schema-cache reload (harmless; keeps parity with sibling migrations).
NOTIFY pgrst, 'reload schema';
