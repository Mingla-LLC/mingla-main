-- #4273 — the quote and the send use one rule, and the sent count is honest.
--
-- WHAT WAS WRONG.
--   (1) issue_4273_decided_people (20280405004273, ~l.428) never compared a
--       person known only through followers or friends of followers with the
--       contacts the brand holds. issue_4273_send_verdict did, at send. So the
--       quote priced a text to a follower whose number the send then refused
--       ('contact_match_blocked'): the host paid for, and was told they reached,
--       someone who got nothing.
--   (2) mkt_finalize_campaign counted every sealed target the send withheld for
--       a contact match as reached: recipient_count = LEAST(delivered + hidden
--       skips, quoted). A text that never left was reported as sent.
--
-- WHAT THIS DOES.
--   (1) issue_4273_decided_people runs issue_4273_send_verdict — the same
--       function the send runs, not a copy of it — on every allowed person known
--       only through the follower graph. A person it refuses is quoted as an
--       ordinary 'suppressed' entry: not priced, not sealed, and with no reason
--       that says a contact matched. Book rows and buyers keep their existing
--       preview rule, so a contact typed into a Book row still previews
--       identically whoever else holds it (I-4273-PREVIEW-NEVER-CONTACT-MATCHES-GRAPH).
--   (2) A sealed target that the send withheld counts as reached only when it
--       shared its address with a message that went out ('address_duplicate'):
--       that person did get the text. Every other withheld target is not
--       counted, and the host's skipped figure includes it, so the composer
--       says "N couldn't be reached" without a reason.
--       biz_marketing_combined_hidden_skips_v1 therefore now returns only the
--       targets that were reached through a shared address. marketing-send reads
--       it unchanged, so no edge deploy is needed for the count.
--
-- Static SQL only; ACLs on the replaced functions are kept by CREATE OR REPLACE.
--
-- Invariants (declared in the pg17 test): I-4273-QUOTE-AND-SEND-SHARE-ONE-VERDICT
-- and I-4273-WITHHELD-TEXT-IS-NOT-COUNTED-AS-SENT.

BEGIN;

-- ── (1) The quote runs the send's verdict on graph-only people ──────────────
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
    SELECT i.person_key, i.node, i.subject, i.brand_person_id, i.user_id, i.ring, i.buyer_key,
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
      bool_and(d.subject = 'circle') OVER w AS graph_only,
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
    -- #4273: the send's own verdict, for everyone the send would compare and the
    -- preview did not. Refused reads as an ordinary suppression.
    SELECT r.*,
      r.pre_allowed AND (NOT r.graph_only OR public.issue_4273_send_verdict(
        p_actor_id, p_brand_id, p_channel, r.normalized_contact, NULL, r.user_id, NULL) = 'send')
        AS final_allowed
      FROM recipients r
  )
  SELECT DISTINCT ON (
    CASE WHEN r.subject <> 'circle' AND r.normalized_contact IS NOT NULL
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
    CASE WHEN r.subject <> 'circle' AND r.normalized_contact IS NOT NULL
         THEN 'a:' || lower(r.normalized_contact) ELSE 'n:' || r.node END,
    r.final_allowed, r.subject_rank, r.node
$fn$;

COMMENT ON FUNCTION public.issue_4273_decided_people(uuid, uuid, jsonb, text) IS
  '#4273: one row per recipient for one email or SMS method. People known only through the follower graph are judged by issue_4273_send_verdict, the function the send uses, so the quote never prices a text the send will refuse; a refusal reads as suppressed with no reason. Book rows and buyers are never compared with graph contacts here.';

-- ── (2) Only a target reached through a shared address counts as reached ────
CREATE OR REPLACE FUNCTION public.biz_marketing_combined_hidden_skips_v1(p_campaign_id uuid)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
  SELECT count(*)::integer FROM public.marketing_combined_send_skips s
    JOIN public.marketing_book_send_executions e ON e.id = s.execution_id
   WHERE e.campaign_id = p_campaign_id AND s.reason = 'address_duplicate'
$fn$;

COMMENT ON FUNCTION public.biz_marketing_combined_hidden_skips_v1(uuid) IS
  '#4273: sealed targets that got the text through another target on the same address. They are reached, so they stay out of the host''s skipped count. Every other sealed-and-unsent target is a skip the host sees as "couldn''t be reached", without a reason.';

-- ── (2) Finalize: the 20280405004273 body, counting only what was reached ───
CREATE OR REPLACE FUNCTION public.mkt_finalize_campaign(p_campaign_id uuid)
RETURNS text
LANGUAGE plpgsql
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_delivered integer;
  v_deferred integer;
  v_preview integer;
  v_failed integer;
  v_shared integer;
  v_quoted integer;
  v_min_next timestamptz;
  v_new_status text;
  v_channel text;
BEGIN
  SELECT channel INTO v_channel FROM public.marketing_campaigns WHERE id = p_campaign_id;
  IF v_channel = 'push' THEN
    SELECT count(*) FILTER (WHERE status = 'sent') INTO v_delivered
      FROM public.marketing_push_messages WHERE campaign_id = p_campaign_id;
    v_new_status := CASE WHEN v_delivered > 0 THEN 'sent' ELSE 'failed' END;
    UPDATE public.marketing_campaigns
       SET status = v_new_status,
           recipient_count = v_delivered,
           sent_at = CASE WHEN v_delivered > 0 THEN now() ELSE sent_at END,
           updated_at = now()
     WHERE id = p_campaign_id;
    RETURN v_new_status;
  END IF;

  SELECT
    count(*) FILTER (WHERE status IN ('sent', 'delivered', 'opened', 'clicked')),
    count(*) FILTER (WHERE status = 'deferred'),
    count(*) FILTER (WHERE status = 'preview_skipped'),
    count(*) FILTER (WHERE status IN ('failed', 'bounced')),
    min(next_attempt_at) FILTER (WHERE status = 'deferred')
  INTO v_delivered, v_deferred, v_preview, v_failed, v_min_next
  FROM public.marketing_messages
  WHERE campaign_id = p_campaign_id;

  -- #4273: a sealed target withheld at send is NOT counted as reached. The one
  -- exception is a target that shared its address with a message that actually
  -- went out (or is held for the next window): that person got the text.
  SELECT e.reachable_count INTO v_quoted
    FROM public.marketing_book_send_executions e WHERE e.campaign_id = p_campaign_id;
  SELECT count(*)::integer INTO v_shared
    FROM public.marketing_combined_send_skips s
    JOIN public.marketing_book_send_executions e ON e.id = s.execution_id
    JOIN public.marketing_book_send_targets t ON t.id = s.target_id
   WHERE e.campaign_id = p_campaign_id AND s.reason = 'address_duplicate'
     AND EXISTS (
       SELECT 1 FROM public.marketing_messages m
        WHERE m.campaign_id = p_campaign_id
          AND m.status IN ('sent', 'delivered', 'opened', 'clicked', 'deferred', 'preview_skipped')
          AND t.contact_value_digest IN (
            encode(extensions.digest(convert_to(m.recipient_phone, 'UTF8'), 'sha256'), 'hex'),
            encode(extensions.digest(convert_to(lower(btrim(m.recipient_email)), 'UTF8'), 'sha256'), 'hex')));

  IF v_deferred > 0 THEN
    v_new_status := 'scheduled';
    UPDATE public.marketing_campaigns
       SET status = 'scheduled',
           recipient_count = LEAST(v_delivered + v_shared, COALESCE(v_quoted, v_delivered + v_shared)),
           sent_at = NULL,
           scheduled_for = COALESCE(v_min_next, now() + interval '15 minutes'),
           updated_at = now()
     WHERE id = p_campaign_id;
  ELSIF v_delivered > 0 THEN
    v_new_status := 'sent';
    UPDATE public.marketing_campaigns
       SET status = 'sent',
           recipient_count = LEAST(v_delivered + v_shared, COALESCE(v_quoted, v_delivered + v_shared)),
           sent_at = now(),
           updated_at = now()
     WHERE id = p_campaign_id;
  ELSIF v_preview > 0 THEN
    v_new_status := 'sent';
    UPDATE public.marketing_campaigns
       SET status = 'sent',
           recipient_count = LEAST(v_preview + v_shared, COALESCE(v_quoted, v_preview + v_shared)),
           sent_at = now(),
           updated_at = now()
     WHERE id = p_campaign_id;
  ELSE
    -- INVARIANT (I-PROPOSED-1270-NO-EMPTY-SENT): 'sent' needs delivered or preview > 0.
    -- #4273: a campaign whose every sealed target was withheld at send reached
    -- nobody, and says so.
    v_new_status := 'failed';
    UPDATE public.marketing_campaigns
       SET status = 'failed',
           recipient_count = 0,
           updated_at = now()
     WHERE id = p_campaign_id;
  END IF;

  RETURN v_new_status;
END;
$$;

COMMIT;
