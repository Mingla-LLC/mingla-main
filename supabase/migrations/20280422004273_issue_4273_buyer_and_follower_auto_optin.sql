-- #4273 — buyers and followers are opted in to a host's marketing, by email and
-- by text, unless they said no.
--
-- SETH'S RULE (2026-11-06): "Anybody who buys is automatically opted into
-- marketing. Same for people who follow the brand." Email AND SMS.
--
-- WHAT WAS WRONG.
--   #3524 graded a buyer's Book contact 'granted' only when a consent_records row
--   (brand + contact + channel + scope 'marketing' + action 'granted') existed,
--   and 'withheld' otherwise. Since #3899 (2026-10-15, dac4a01b6a) the checkout
--   writes scope 'transactional' on every purchase and scope 'marketing' only
--   when the buyer ticks the optional updates box
--   (mingla-business/app/checkout/[eventId]/buyer.tsx:556-594). So every buyer
--   since then who left the box alone was graded 'withheld' on email AND phone.
--   Production on 2026-11-06: 22 email and 21 phone Book contacts are withheld,
--   all from the order / ticket_holder rail, every one with a transactional
--   record and no marketing record. A withheld phone is blocked from every
--   Blast, and issue_4273_send_verdict's contact_match_blocked also blocks any
--   follower who shares that number.
--
-- WHAT THIS DOES.
--   (1) issue_4273_marketing_opted_out — ONE answer to "did this person say no":
--       a marketing consent revocation not later re-granted by the person, a
--       marketing_unsubscribes row, a channel_suppressions row (STOP replies land
--       here with scope 'all'), a venue_sms_opt_out row, or a host-side
--       suppression on any Book row of this brand holding the contact. Blocks
--       between a host and a person are per-sender and stay where they are, in
--       the send-time verdict; they never change a permission.
--   (2) The grader. An order / ticket_holder contact with an explicit grant
--       keeps it. One with no record and no opt-out is opted in, and the grant is
--       RECORDED in consent_records with source 'purchase_auto_optin' and
--       brand_attribution 'derived' (the grant was attributed by a process, not
--       captured from a box the person ticked). One that opted out is withheld.
--       biz_resolve_brand_person_source calls this function by name, so the
--       ingest rail changes with no patch to that function.
--   (3) Following a brand records 'follow_auto_optin' for the follower's
--       verified email and phone, and lifts any Book contact of that brand on the
--       same address that is withheld only for lack of a record.
--   (4) Backfill. Every active Book contact that is 'withheld', has no
--       consent record, and has no opt-out gets a recorded automatic grant and
--       turns 'granted'. Read-only count on production 2026-11-06: 43 contact
--       methods across 6 brands (22 email, 21 phone; 19 Nigerian, 1 US, 1 other
--       phone), writing 43 consent_records rows, none with any opt-out or
--       revocation on file. Re-running touches nothing: the rows it moves
--       are no longer 'withheld', and a grant is never written twice for one
--       brand + contact + channel.
--
-- NOT CHANGED: a person who opted out stays withheld, and every authoriser still
-- consults the suppression ledgers on its own, so a grant never overrides a
-- later opt-out. The checkout's optional box still records an explicit grant
-- when ticked; that row wins over the automatic one by being first.
--
-- Static SQL only. No production row is touched until this is applied.
--
-- Invariants (declared in the pg17 test): I-4273-BUYER-AND-FOLLOWER-AUTO-OPTIN
-- and I-4273-EXPLICIT-OPT-OUT-ALWAYS-WINS.

BEGIN;

-- ── (1) Did this person say no? ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.issue_4273_marketing_opted_out(
  p_brand_id uuid, p_channel text, p_contact text, p_user_id uuid DEFAULT NULL
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
  WITH c AS (
    SELECT CASE p_channel WHEN 'phone' THEN 'sms' ELSE p_channel END AS ch,
           CASE WHEN p_channel = 'email' THEN lower(btrim(p_contact)) ELSE btrim(p_contact) END AS v
  )
  SELECT EXISTS (
    -- A revocation the person did not later reverse with a grant of their own.
    -- Automatic grants never reverse a revocation.
    SELECT 1 FROM c JOIN public.consent_records r
      ON r.channel = c.ch AND r.scope = 'marketing' AND r.action = 'revoked'
     AND lower(btrim(r.contact)) = lower(c.v)
     AND (r.brand_id IS NULL OR r.brand_id = p_brand_id)
     WHERE NOT EXISTS (
       SELECT 1 FROM public.consent_records g
        WHERE g.channel = r.channel AND g.scope = 'marketing' AND g.action = 'granted'
          AND lower(btrim(g.contact)) = lower(c.v)
          AND (g.brand_id IS NULL OR g.brand_id = p_brand_id)
          AND g.source NOT IN ('purchase_auto_optin', 'follow_auto_optin')
          AND g.created_at > r.created_at)
    UNION ALL
    SELECT 1 FROM c JOIN public.marketing_unsubscribes u ON u.channel IN (c.ch, 'all')
     WHERE ((c.ch = 'email' AND lower(btrim(u.contact_email)) = c.v)
            OR (c.ch = 'sms' AND btrim(u.contact_phone) = c.v))
       AND (u.scope = 'global' OR (u.scope = 'brand' AND u.brand_id = p_brand_id)
            OR (u.scope = 'account' AND p_user_id IS NOT NULL AND u.account_id = p_user_id))
    UNION ALL
    SELECT 1 FROM c JOIN public.channel_suppressions s
      ON s.channel = c.ch AND s.scope IN ('marketing', 'all')
     WHERE lower(btrim(s.contact)) = lower(c.v)
        OR (p_user_id IS NOT NULL AND s.user_id = p_user_id)
    UNION ALL
    SELECT 1 FROM c JOIN public.venue_sms_opt_out o ON c.ch = 'sms' AND o.phone_e164 = c.v
     WHERE o.brand_id IS NULL OR o.brand_id = p_brand_id
    UNION ALL
    SELECT 1 FROM c JOIN public.brand_person_contact_methods m
      ON m.brand_id = p_brand_id AND m.record_state = 'active'
     AND m.channel = CASE c.ch WHEN 'sms' THEN 'phone' ELSE 'email' END
     AND lower(m.normalized_value) = lower(c.v)
      JOIN public.brand_person_channel_suppressions s
        ON s.brand_person_id = m.brand_person_id AND s.channel = c.ch
       AND s.lifted_at IS NULL AND s.scope IN ('marketing', 'all')
  )
$fn$;

COMMENT ON FUNCTION public.issue_4273_marketing_opted_out(uuid, text, text, uuid) IS
  '#4273: true when this contact said no to this brand''s marketing on this channel: an unreversed marketing revocation, an unsubscribe, a suppression (STOP included), a venue SMS opt-out, or a host-side suppression on a Book row holding it. An automatic grant never reverses any of these.';

REVOKE ALL ON FUNCTION public.issue_4273_marketing_opted_out(uuid, text, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4273_marketing_opted_out(uuid, text, text, uuid)
  TO service_role;

-- ── Recording an automatic grant ────────────────────────────────────────────
-- Returns the grant on file for this brand + contact + channel, writing an
-- automatic one first when none exists and the person has not opted out. NULL
-- when they opted out or there is nothing to record against.
CREATE OR REPLACE FUNCTION public.issue_4273_record_auto_optin(
  p_brand_id uuid, p_channel text, p_contact text, p_source text, p_user_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_ch text := CASE p_channel WHEN 'phone' THEN 'sms' ELSE p_channel END;
  v_contact text := CASE WHEN p_channel = 'email' THEN lower(btrim(p_contact)) ELSE btrim(p_contact) END;
  v_id uuid;
BEGIN
  IF p_source NOT IN ('purchase_auto_optin', 'follow_auto_optin') THEN
    RAISE EXCEPTION 'issue_4273_auto_optin_source_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_brand_id IS NULL OR v_ch NOT IN ('email', 'sms') OR COALESCE(v_contact, '') = ''
     OR public.issue_4273_marketing_opted_out(p_brand_id, v_ch, v_contact, p_user_id) THEN
    RETURN NULL;
  END IF;
  SELECT r.id INTO v_id FROM public.consent_records r
   WHERE r.brand_id = p_brand_id AND r.contact = v_contact AND r.channel = v_ch
     AND r.scope = 'marketing' AND r.action = 'granted'
   ORDER BY r.created_at DESC, r.id DESC LIMIT 1;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;
  INSERT INTO public.consent_records(
    user_id, contact, channel, scope, action, source, disclosure_text,
    disclosure_version, brand_id, brand_attribution
  ) VALUES (
    p_user_id, v_contact, v_ch, 'marketing', 'granted', p_source,
    CASE p_source
      WHEN 'purchase_auto_optin' THEN
        'Automatic opt-in: buying from this host opts the buyer in to the host''s marketing by email and text. No box was ticked. Any unsubscribe, STOP reply or suppression overrides it.'
      ELSE
        'Automatic opt-in: following this host opts the follower in to the host''s marketing by email and text. No box was ticked. Any unsubscribe, STOP reply, mute or switched-off channel overrides it.'
    END,
    '2026-11-06-auto-optin-v1', p_brand_id, 'derived'
  ) RETURNING id INTO v_id;
  RETURN v_id;
END;
$fn$;

COMMENT ON FUNCTION public.issue_4273_record_auto_optin(uuid, text, text, text, uuid) IS
  '#4273: the grant on file for this brand + contact + channel; writes an automatic one (purchase_auto_optin / follow_auto_optin, brand_attribution derived) when none exists. NULL when the person opted out. Never writes a second grant for one brand + contact + channel.';

REVOKE ALL ON FUNCTION public.issue_4273_record_auto_optin(uuid, text, text, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4273_record_auto_optin(uuid, text, text, text, uuid)
  TO service_role;

-- ── (2) The grader, called by name from biz_resolve_brand_person_source ─────
-- Same signature and result shape as #3524. It now writes, so it is VOLATILE.
CREATE OR REPLACE FUNCTION public.issue_3524_grade_marketing_consent(
  p_source_kind text,
  p_brand_id uuid,
  p_channel text,
  p_contact text
)
RETURNS TABLE (state text, record_id uuid)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE v_id uuid;
BEGIN
  -- event_rsvp, rsvp_plus_one, reservation and stay_reservation keep their own
  -- consent story and stay 'unknown', exactly as #3524 left them.
  IF p_source_kind NOT IN ('order', 'ticket_holder') THEN
    RETURN QUERY SELECT 'unknown'::text, NULL::uuid; RETURN;
  END IF;
  v_id := public.issue_4273_record_auto_optin(p_brand_id, p_channel, p_contact, 'purchase_auto_optin', NULL);
  IF v_id IS NULL THEN
    RETURN QUERY SELECT 'withheld'::text, NULL::uuid; RETURN;
  END IF;
  RETURN QUERY SELECT 'granted'::text, v_id;
END;
$function$;

COMMENT ON FUNCTION public.issue_3524_grade_marketing_consent(text, uuid, text, text) IS
  '#3524 + #4273: grades a contact method the order/ticket ingest rail just wrote. granted (with the grant''s record) unless the person opted out; a buyer with no grant on file is opted in and the automatic grant is recorded as purchase_auto_optin. withheld only when they said no. unknown for every other source kind.';

REVOKE ALL ON FUNCTION public.issue_3524_grade_marketing_consent(text, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3524_grade_marketing_consent(text, uuid, text, text)
  TO service_role;

-- ── (3) Following a brand ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.issue_4273_follow_auto_optin()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_ident record; v_id uuid;
BEGIN
  -- The follow is the person's own act and must never fail because the audit
  -- write did. Follower reach does not read these rows (it reads the follow and
  -- its channel switches), so a missed record is logged loudly, not fatal.
  BEGIN
  FOR v_ident IN
    SELECT i.kind, i.value FROM public.verified_account_identifiers(NEW.user_id) i
     WHERE i.kind IN ('email', 'phone') AND btrim(COALESCE(i.value, '')) <> ''
  LOOP
    v_id := public.issue_4273_record_auto_optin(
      NEW.brand_id, CASE v_ident.kind WHEN 'phone' THEN 'sms' ELSE 'email' END,
      v_ident.value, 'follow_auto_optin', NEW.user_id);
    IF v_id IS NOT NULL THEN
      UPDATE public.brand_person_contact_methods m
         SET marketing_consent_state = 'granted', marketing_consent_record_id = v_id,
             marketing_consent_graded_at = now(), updated_at = now()
       WHERE m.brand_id = NEW.brand_id AND m.channel = v_ident.kind
         AND m.record_state = 'active' AND m.marketing_consent_state = 'withheld'
         AND lower(m.normalized_value) = lower(btrim(v_ident.value));
    END IF;
  END LOOP;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '#4273 follow_auto_optin not recorded for brand % follower %: %',
      NEW.brand_id, NEW.user_id, SQLERRM;
  END;
  RETURN NULL;
END;
$fn$;

REVOKE ALL ON FUNCTION public.issue_4273_follow_auto_optin() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS issue_4273_follow_auto_optin ON public.brand_follows;
CREATE TRIGGER issue_4273_follow_auto_optin
  AFTER INSERT ON public.brand_follows
  FOR EACH ROW EXECUTE FUNCTION public.issue_4273_follow_auto_optin();

-- ── (4) Backfill: contacts withheld only because no record existed ──────────
-- 'withheld' was written only by the order / ticket_holder grader. A contact
-- that opted out stays withheld; everything else gets a recorded automatic grant.
-- A function so the pg17 suite can run it against fixtures and prove a second
-- run moves nothing. Returns how many contact methods it moved.
CREATE OR REPLACE FUNCTION public.issue_4273_backfill_auto_optin()
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_moved integer;
BEGIN
  WITH targets AS MATERIALIZED (
    SELECT m.id, m.brand_id, m.channel, m.normalized_value, bp.linked_user_id
      FROM public.brand_person_contact_methods m
      JOIN public.brand_people bp ON bp.id = m.brand_person_id
     WHERE m.record_state = 'active' AND m.channel IN ('email', 'phone')
       AND m.marketing_consent_state = 'withheld'
       AND m.marketing_consent_record_id IS NULL
       AND btrim(COALESCE(m.normalized_value, '')) <> ''
       AND EXISTS (SELECT 1 FROM public.brand_person_source_links l
                    WHERE l.brand_person_id = m.brand_person_id
                      AND l.source_kind IN ('order', 'ticket_holder'))
       AND NOT public.issue_4273_marketing_opted_out(
         m.brand_id, CASE m.channel WHEN 'phone' THEN 'sms' ELSE 'email' END,
         m.normalized_value, bp.linked_user_id)
  ), granted AS MATERIALIZED (
    SELECT t.id, public.issue_4273_record_auto_optin(
      t.brand_id, CASE t.channel WHEN 'phone' THEN 'sms' ELSE 'email' END,
      t.normalized_value, 'purchase_auto_optin', NULL) AS record_id
      FROM targets t
  ), moved AS (
    UPDATE public.brand_person_contact_methods m
       SET marketing_consent_state = 'granted', marketing_consent_record_id = g.record_id,
           marketing_consent_graded_at = now(), updated_at = now()
      FROM granted g
     WHERE m.id = g.id AND g.record_id IS NOT NULL AND m.marketing_consent_state = 'withheld'
    RETURNING 1
  )
  SELECT count(*)::integer INTO v_moved FROM moved;
  RETURN v_moved;
END;
$fn$;

REVOKE ALL ON FUNCTION public.issue_4273_backfill_auto_optin() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4273_backfill_auto_optin() TO service_role;

DO $backfill$
DECLARE v_moved integer := public.issue_4273_backfill_auto_optin();
BEGIN
  RAISE NOTICE '#4273: % withheld buyer contact method(s) opted in with a recorded automatic grant', v_moved;
END
$backfill$;

COMMIT;
