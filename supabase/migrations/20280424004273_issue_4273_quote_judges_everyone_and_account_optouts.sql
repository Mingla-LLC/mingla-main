-- #4273 rework — the quote judges everyone the send judges, an account-level
-- opt-out wins, and the automatic grant names Mingla as well as the brand.
--
-- SETH'S DECISIONS (2026-11-06, in chat):
--   * Honest counts win over hiding contact-match refusals. A host may infer
--     that a number belongs to an account that blocked them or opted out; that
--     is accepted. No reason is ever shown.
--   * Buyers are opted in to updates from the brand AND Mingla, by email and
--     text, unless they said no.
--
-- WHAT WAS WRONG.
--   (1) 20280422014273 ran issue_4273_send_verdict in the quote only for people
--       known through the follower graph. A Book row or a buyer whose contact
--       matched someone who blocked the host or opted out was still priced, and
--       the send then refused it.
--   (2) The ingest grader called issue_4273_record_auto_optin with no account,
--       so an account-scope unsubscribe or a suppression keyed to the buyer's
--       account graded a logged-in buyer 'granted'.
--   (3) A phone opt-out stored without its leading '+' (or with spaces) did not
--       match the E.164 contact.
--
-- WHAT THIS DOES.
--   (1) issue_4273_decided_people runs the send's verdict, with the send's own
--       arguments, on every recipient it would price, and prices one address
--       once whoever holds it (the send already sends once per address), so a
--       follower sharing a Book row's number is no longer priced twice.
--   (2) issue_4273_contact_accounts names every account this brand knows on a
--       contact (order buyer accounts, linked Book accounts). The opt-in writer
--       treats an opt-out on any of them as the person's own.
--   (3) Phone opt-outs compare digits only.
--   (4) The automatic-grant disclosure now says brand and Mingla (version v2).
--       Rows already written keep their own words: consent_records is an
--       append-only legal record.
--   (5) Correction pass: any contact a #4273 automatic grant moved to
--       'granted' whose person had in fact opted out (by the rules above) goes
--       back to 'withheld'. The grant row stays as the record of what the
--       process did. Read-only count on production 2026-11-06: 0 such rows
--       (12 of the 43 backfill contacts have an account; none has an
--       account-level or digit-matched opt-out), so the backfill still moves 43.
--
-- Static SQL only.
--
-- Invariants (declared in the pg17 tests): I-4273-QUOTE-AND-SEND-SHARE-ONE-VERDICT
-- and I-4273-EXPLICIT-OPT-OUT-ALWAYS-WINS.

BEGIN;

-- ── (2)+(3) Who said no ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.issue_4273_marketing_opted_out(
  p_brand_id uuid, p_channel text, p_contact text, p_user_id uuid DEFAULT NULL
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
  WITH c AS (
    SELECT CASE p_channel WHEN 'phone' THEN 'sms' ELSE p_channel END AS ch,
           CASE WHEN p_channel = 'email' THEN lower(btrim(p_contact)) ELSE btrim(p_contact) END AS v,
           regexp_replace(COALESCE(p_contact, ''), '[^0-9]', '', 'g') AS digits
  ), same AS (
    -- One address, compared the way its channel needs: email case-insensitive,
    -- phone on digits only (a stored number may lack its '+').
    SELECT c.*, (c.ch = 'sms' AND c.digits <> '') AS phone_ok FROM c
  )
  SELECT EXISTS (
    SELECT 1 FROM same c JOIN public.consent_records r
      ON r.channel = c.ch AND r.scope = 'marketing' AND r.action = 'revoked'
     AND (r.brand_id IS NULL OR r.brand_id = p_brand_id)
     AND CASE WHEN c.ch = 'sms' THEN c.phone_ok AND regexp_replace(r.contact, '[^0-9]', '', 'g') = c.digits
              ELSE lower(btrim(r.contact)) = c.v END
     WHERE NOT EXISTS (
       SELECT 1 FROM public.consent_records g
        WHERE g.channel = r.channel AND g.scope = 'marketing' AND g.action = 'granted'
          AND lower(btrim(g.contact)) = lower(btrim(r.contact))
          AND (g.brand_id IS NULL OR g.brand_id = p_brand_id)
          AND g.source NOT IN ('purchase_auto_optin', 'follow_auto_optin')
          AND g.created_at > r.created_at)
    UNION ALL
    SELECT 1 FROM same c JOIN public.marketing_unsubscribes u ON u.channel IN (c.ch, 'all')
     WHERE ((c.ch = 'email' AND lower(btrim(u.contact_email)) = c.v)
            OR (c.phone_ok AND regexp_replace(COALESCE(u.contact_phone, ''), '[^0-9]', '', 'g') = c.digits))
       AND (u.scope = 'global' OR (u.scope = 'brand' AND u.brand_id = p_brand_id)
            OR (u.scope = 'account' AND p_user_id IS NOT NULL AND u.account_id = p_user_id))
    UNION ALL
    -- An account-scope unsubscribe on this person's account, whatever address
    -- it was made from.
    SELECT 1 FROM same c JOIN public.marketing_unsubscribes u
      ON u.scope = 'account' AND u.channel IN (c.ch, 'all')
     WHERE p_user_id IS NOT NULL AND u.account_id = p_user_id
    UNION ALL
    SELECT 1 FROM same c JOIN public.channel_suppressions s
      ON s.channel = c.ch AND s.scope IN ('marketing', 'all')
     WHERE (c.ch = 'email' AND lower(btrim(s.contact)) = c.v)
        OR (c.phone_ok AND regexp_replace(COALESCE(s.contact, ''), '[^0-9]', '', 'g') = c.digits)
        OR (p_user_id IS NOT NULL AND s.user_id = p_user_id)
    UNION ALL
    SELECT 1 FROM same c JOIN public.venue_sms_opt_out o
      ON c.phone_ok AND regexp_replace(o.phone_e164, '[^0-9]', '', 'g') = c.digits
     WHERE o.brand_id IS NULL OR o.brand_id = p_brand_id
    UNION ALL
    SELECT 1 FROM same c JOIN public.brand_person_contact_methods m
      ON m.brand_id = p_brand_id AND m.record_state = 'active'
     AND m.channel = CASE c.ch WHEN 'sms' THEN 'phone' ELSE 'email' END
     AND CASE WHEN c.ch = 'sms' THEN c.phone_ok AND regexp_replace(m.normalized_value, '[^0-9]', '', 'g') = c.digits
              ELSE lower(m.normalized_value) = c.v END
      JOIN public.brand_person_channel_suppressions s
        ON s.brand_person_id = m.brand_person_id AND s.channel = c.ch
       AND s.lifted_at IS NULL AND s.scope IN ('marketing', 'all')
  )
$fn$;

COMMENT ON FUNCTION public.issue_4273_marketing_opted_out(uuid, text, text, uuid) IS
  '#4273: true when this contact (or, given an account, that account) said no to this brand''s marketing on this channel: an unreversed marketing revocation, an unsubscribe (account-scope included), a suppression (STOP included, account-keyed included), a venue SMS opt-out, or a host-side suppression on a Book row holding it. Phones compare on digits only. An automatic grant never reverses any of these.';

-- Every account this brand knows on one contact: the accounts on its orders
-- (buyer_user_id, and purchased_by_user_id when a signed-in purchaser typed a
-- contact their account does not own — #4063 moves the account there) and the
-- accounts linked to its Book rows. Service-only. Erring wide is deliberate:
-- an opt-out on any of them keeps the contact withheld.
CREATE OR REPLACE FUNCTION public.issue_4273_contact_accounts(
  p_brand_id uuid, p_channel text, p_contact text
) RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
  WITH c AS (
    SELECT CASE p_channel WHEN 'phone' THEN 'sms' ELSE p_channel END AS ch,
           lower(btrim(p_contact)) AS v,
           regexp_replace(COALESCE(p_contact, ''), '[^0-9]', '', 'g') AS digits
  )
  SELECT a.account FROM c
    JOIN public.orders o ON TRUE
    JOIN public.events e ON e.id = o.event_id AND e.brand_id = p_brand_id
    CROSS JOIN LATERAL (VALUES (o.buyer_user_id), (o.purchased_by_user_id)) a(account)
   WHERE a.account IS NOT NULL
     AND ((c.ch = 'email' AND lower(btrim(o.buyer_email)) = c.v)
      OR (c.ch = 'sms' AND c.digits <> ''
          AND regexp_replace(COALESCE(o.buyer_phone_e164, o.buyer_phone, ''), '[^0-9]', '', 'g') = c.digits))
  UNION
  SELECT bp.linked_user_id FROM c
    JOIN public.brand_person_contact_methods m
      ON m.brand_id = p_brand_id AND m.record_state = 'active'
     AND m.channel = CASE c.ch WHEN 'sms' THEN 'phone' ELSE 'email' END
    JOIN public.brand_people bp ON bp.id = m.brand_person_id AND bp.linked_user_id IS NOT NULL
   WHERE (c.ch = 'email' AND lower(m.normalized_value) = c.v)
      OR (c.ch = 'sms' AND c.digits <> '' AND regexp_replace(m.normalized_value, '[^0-9]', '', 'g') = c.digits)
$fn$;

REVOKE ALL ON FUNCTION public.issue_4273_contact_accounts(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4273_contact_accounts(uuid, text, text) TO service_role;

-- True when the contact, the given account, or any account the brand knows on
-- the contact said no.
CREATE OR REPLACE FUNCTION public.issue_4273_person_opted_out(
  p_brand_id uuid, p_channel text, p_contact text, p_user_id uuid DEFAULT NULL
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
  SELECT public.issue_4273_marketing_opted_out(p_brand_id, p_channel, p_contact, p_user_id)
      OR EXISTS (
        SELECT 1 FROM public.issue_4273_contact_accounts(p_brand_id, p_channel, p_contact) a
         WHERE a IS DISTINCT FROM p_user_id
           AND public.issue_4273_marketing_opted_out(p_brand_id, p_channel, p_contact, a))
$fn$;

REVOKE ALL ON FUNCTION public.issue_4273_person_opted_out(uuid, text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4273_person_opted_out(uuid, text, text, uuid) TO service_role;

-- ── (2)+(4) The opt-in writer ───────────────────────────────────────────────
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
     OR public.issue_4273_person_opted_out(p_brand_id, v_ch, v_contact, p_user_id) THEN
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
        'Automatic opt-in: buying from this brand opts the buyer in to updates from this brand and Mingla by email and text. The checkout says so; no box was ticked. Any unsubscribe, STOP reply or suppression overrides it.'
      ELSE
        'Automatic opt-in: following this brand opts the follower in to updates from this brand and Mingla by email and text. No box was ticked. Any unsubscribe, STOP reply, mute or switched-off channel overrides it.'
    END,
    '2026-11-06-auto-optin-v2', p_brand_id, 'derived'
  ) RETURNING id INTO v_id;
  RETURN v_id;
END;
$fn$;

COMMENT ON FUNCTION public.issue_4273_record_auto_optin(uuid, text, text, text, uuid) IS
  '#4273: the grant on file for this brand + contact + channel; writes an automatic one (purchase_auto_optin / follow_auto_optin, brand_attribution derived, brand and Mingla) when none exists. NULL when the contact, the given account or any account the brand knows on the contact opted out. Never writes a second grant for one brand + contact + channel.';

-- ── (1) The quote runs the send's verdict on everyone it prices ─────────────
CREATE OR REPLACE FUNCTION public.issue_4273_decided_people(
  p_actor_id uuid, p_brand_id uuid, p_sources jsonb, p_channel text
) RETURNS TABLE(
  person_key text, subject text, brand_person_id uuid, user_id uuid, ring text,
  buyer_key text, contact_method_id uuid, normalized_contact text, allowed boolean, reason text
)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
  WITH identities AS MATERIALIZED (
    SELECT DISTINCT ON (i.node) i.* FROM public.issue_4273_combined_identities(p_brand_id, p_sources) i
     ORDER BY i.node, i.source_key
  ), decided AS MATERIALIZED (
    SELECT i.person_key, i.node, i.subject, i.brand_person_id, i.user_id, i.ring, i.buyer_key, i.buyer_email,
      d.contact_method_id, d.normalized_contact, d.reason AS raw_reason,
      public.issue_4273_follow_gate_ok(i.user_id, p_brand_id, p_channel) AS follow_ok,
      COALESCE(d.allowed, false) AS contact_ok,
      CASE WHEN i.subject = 'book' THEN 0 WHEN i.subject = 'circle' THEN 1 ELSE 2 END AS subject_rank,
      i.user_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.blocked_users bu WHERE
        (bu.blocker_id = p_actor_id AND bu.blocked_id = i.user_id) OR
        (bu.blocker_id = i.user_id AND bu.blocked_id = p_actor_id)) AS blocked
    FROM identities i
    LEFT JOIN LATERAL (
      SELECT a.contact_method_id, a.normalized_contact, a.allowed, a.reason
        FROM public.biz_brand_person_authorized_contact_v2(p_brand_id, i.brand_person_id, p_channel, 'marketing_blast') a
       WHERE i.subject = 'book'
      UNION ALL
      SELECT NULL::uuid, c.normalized_contact, c.allowed, c.reason
        FROM public.issue_1778_circle_authorized_contact(p_brand_id, i.user_id, p_channel) c
       WHERE i.subject = 'circle'
      UNION ALL
      SELECT NULL::uuid, b.normalized_contact, b.allowed, b.reason
        FROM public.issue_4273_buyer_contact_decision(p_brand_id, i.buyer_email, i.buyer_phone, p_channel) b
       WHERE i.subject = 'buyer'
    ) d ON true
  ), marked AS MATERIALIZED (
    SELECT d.*,
      (d.normalized_contact IS NOT NULL AND NOT d.contact_ok)
        OR d.raw_reason = 'consent_missing' OR NOT d.follow_ok AS denied,
      bool_or((d.normalized_contact IS NOT NULL AND NOT d.contact_ok)
        OR d.raw_reason = 'consent_missing' OR NOT d.follow_ok) OVER w AS person_denied,
      bool_or(d.blocked) OVER w AS person_blocked,
      count(*) FILTER (WHERE d.subject = 'book' AND d.normalized_contact IS NOT NULL) OVER w AS book_contacts,
      row_number() OVER (PARTITION BY d.person_key ORDER BY
        (d.normalized_contact IS NOT NULL AND ((NOT d.contact_ok) OR NOT d.follow_ok)) DESC,
        (d.normalized_contact IS NOT NULL) DESC, d.subject_rank, d.node) AS rn
    FROM decided d
    WINDOW w AS (PARTITION BY d.person_key)
  ), recipients AS MATERIALIZED (
    SELECT m.*, NOT m.person_denied AND m.contact_ok AND m.normalized_contact IS NOT NULL AS pre_allowed
      FROM marked m
     WHERE NOT m.person_blocked
       AND (CASE WHEN m.person_denied OR m.book_contacts = 0 THEN m.rn = 1
                 ELSE m.subject = 'book' AND m.normalized_contact IS NOT NULL END)
  ), verdicts AS MATERIALIZED (
    -- #4273 (Seth, 2026-11-06: honest counts over hiding contact-match
    -- refusals): the send's own verdict, with the send's own arguments, for
    -- every recipient the quote would price. Refused reads as an ordinary
    -- suppression; no reason says a contact matched.
    SELECT r.*,
      r.pre_allowed AND public.issue_4273_send_verdict(
        p_actor_id, p_brand_id, p_channel, r.normalized_contact,
        CASE WHEN r.subject = 'book' THEN r.brand_person_id END,
        r.user_id,
        CASE WHEN r.subject = 'buyer' THEN r.buyer_email END) = 'send'
        AS final_allowed
      FROM recipients r
  )
  SELECT DISTINCT ON (
    CASE WHEN r.normalized_contact IS NOT NULL
         THEN 'a:' || lower(r.normalized_contact) ELSE 'n:' || r.node END)
    r.person_key, r.subject, r.brand_person_id, r.user_id, r.ring, r.buyer_key,
    CASE WHEN r.normalized_contact IS NULL THEN NULL ELSE r.contact_method_id END,
    r.normalized_contact, r.final_allowed,
    CASE
      WHEN r.normalized_contact IS NULL THEN 'channel_unavailable'
      WHEN r.final_allowed THEN 'allowed'
      WHEN r.raw_reason IN ('suppressed', 'can_send_denied', 'delivery_denied') THEN r.raw_reason
      ELSE 'suppressed'
    END
  FROM verdicts r
  ORDER BY
    CASE WHEN r.normalized_contact IS NOT NULL
         THEN 'a:' || lower(r.normalized_contact) ELSE 'n:' || r.node END,
    r.final_allowed, r.subject_rank, r.node
$fn$;

COMMENT ON FUNCTION public.issue_4273_decided_people(uuid, uuid, jsonb, text) IS
  '#4273: one row per recipient for one email or SMS method. Every recipient the quote would price is judged by issue_4273_send_verdict with the send''s own arguments, so the quote never prices a text the send will refuse; a refusal reads as suppressed with no reason (Seth, 2026-11-06: honest counts over hiding contact-match refusals).';

-- ── (5) Correction: an opt-out wins over an automatic grant already applied ──
UPDATE public.brand_person_contact_methods m
   SET marketing_consent_state = 'withheld', marketing_consent_record_id = NULL,
       marketing_consent_graded_at = now(), updated_at = now()
  FROM public.consent_records r, public.brand_people bp
 WHERE r.id = m.marketing_consent_record_id
   AND r.source IN ('purchase_auto_optin', 'follow_auto_optin')
   AND bp.id = m.brand_person_id
   AND m.marketing_consent_state = 'granted'
   AND public.issue_4273_person_opted_out(
     m.brand_id, CASE m.channel WHEN 'phone' THEN 'sms' ELSE 'email' END,
     m.normalized_value, bp.linked_user_id);

COMMIT;
