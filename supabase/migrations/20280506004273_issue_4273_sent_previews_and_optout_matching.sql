-- #4273 polish — what a sent campaign looked like, one view of a whole blast,
-- a sent campaign that stays as sent, and opt-out matching that knows which
-- account and which country a contact belongs to.
--
-- SETH'S DECISIONS (2026-11-07, in chat):
--   * Q1  marketing_unsubscribes.account_id is the SENDING HOST's account: an
--         account-scope row means "stop hearing from every brand that host
--         account runs" (Phase A's design). Five later readers took it as the
--         guest's own account; they are corrected here.
--   * Q1b the two older readers (#1778 circle authoriser, #3682 follow gate)
--         get the same correction in this migration.
--   * Q2  campaigns sent before this ships have no snapshot; the app rebuilds
--         their preview from the saved message and says so.
--   * Extras: (a) a sent campaign's text and status cannot be changed through
--         the API; (b) a failed or cancelled method no longer holds its slot in
--         the campaign's group; (c) is app-only (the composer's From line).
--
-- WHAT THIS DOES.
--   (M1) marketing_campaigns.sent_snapshot: what each method sent, written once
--        by marketing-send before the first recipient. No recipient data.
--   (M2) a guard: only the server writes it, and only once.
--   (M3) biz_marketing_campaign_group_view_v1: every method of one campaign,
--        its content, status, counts (push included) and SMS cost. Counts only;
--        no column that identifies a person or a contact.
--   (M4) issue_4273_phone_key: one E.164 key per stored phone. A US number
--        missing its +1 is the US number; a number with a trunk 0 has no
--        country and matches nothing.
--   (M5) issue_4273_marketing_opted_out: phones compare on that key; the
--        account arm reads the brand's owning account (Q1); the contact-less
--        account arm is gone.
--   (M6) issue_4273_contact_accounts: also knows the accounts that verified the
--        contact (verified_phone_identities, GoTrue identities). Erring wide is
--        deliberate: an account found here can only withhold.
--   (M7) issue_4273_address_denied: the account arm follows Q1.
--   (Q1b) biz_brand_follow_channel_ok and issue_1778_circle_authorized_contact:
--        the account arm follows Q1. Every other line is the live definition.
--   (Xa) issue_4273_campaign_lock_guard: an app or API caller may only edit a
--        draft, schedule a draft, reschedule or cancel a send that has not
--        started. Sent, sending, failed, cancelled, already-due and partly-sent
--        campaigns are read-only to them. The server (service_role, and the
--        SECURITY DEFINER functions, which run as postgres) is not restricted.
--   (Xc) issue_4273_campaign_delete_guard: an app or API caller may delete only a
--        draft, or a failed or cancelled campaign that reached nobody (no
--        sent-family message, no sent push, recipient_count 0). Anything that
--        sent stays on record. The server is not restricted.
--   (Xb) issue_3682_one_channel_per_campaign_group counts only methods that are
--        still live: a failed or cancelled method no longer holds the slot.
--
-- Static SQL only (RLS gate C7). Read-only production probes, 2026-11-07:
-- marketing_unsubscribes 3 rows, all scope 'brand', 0 with an account_id;
-- marketing_campaigns 29 draft / 24 sent / 1 failed, 1 group with 2 methods,
-- so no existing row can collide with the partial unique index.
--
-- Invariants (declared in the pg17 tests): I-4273-SENT-SNAPSHOT-WRITE-ONCE,
-- I-4273-SENT-VIEW-NO-CONTACTS, I-4273-PHONE-MATCH-E164,
-- I-4273-ACCOUNT-SCOPE-IS-THE-SENDING-HOST, I-4273-SENT-CAMPAIGN-READ-ONLY.

BEGIN;

-- ── (M1) The send snapshot ──────────────────────────────────────────────────
ALTER TABLE public.marketing_campaigns ADD COLUMN IF NOT EXISTS sent_snapshot jsonb;
ALTER TABLE public.marketing_campaigns DROP CONSTRAINT IF EXISTS issue_4273_sent_snapshot_object;
ALTER TABLE public.marketing_campaigns ADD CONSTRAINT issue_4273_sent_snapshot_object
  CHECK (sent_snapshot IS NULL OR (jsonb_typeof(sent_snapshot) = 'object'
         AND sent_snapshot ->> 'v' = '1' AND sent_snapshot ->> 'kind' IN ('email', 'sms', 'push')));
COMMENT ON COLUMN public.marketing_campaigns.sent_snapshot IS
  '#4273: what this method sent, written once by marketing-send before the first recipient (v1: email subject/body/From/banner/event cards as rendered; SMS wire text with a sample short link, segments, encoding; push title/body per reason). Never a recipient, contact, user id, unsubscribe link or the brand''s contact address. NULL for campaigns sent before 2026-11-07 and for anything not yet sent.';

-- ── (M2) Only the server writes it, and only once ───────────────────────────
-- SECURITY INVOKER on purpose: current_user must be the caller's role. A
-- column REVOKE does not hold while a table-level UPDATE grant exists.
CREATE OR REPLACE FUNCTION public.issue_4273_sent_snapshot_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.sent_snapshot IS NOT NULL
       AND current_user NOT IN ('service_role', 'postgres', 'supabase_admin') THEN
      RAISE EXCEPTION 'sent_snapshot_server_only' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.sent_snapshot IS DISTINCT FROM OLD.sent_snapshot THEN
    IF OLD.sent_snapshot IS NOT NULL THEN
      RAISE EXCEPTION 'sent_snapshot_immutable' USING ERRCODE = '42501';
    END IF;
    IF current_user NOT IN ('service_role', 'postgres', 'supabase_admin') THEN
      RAISE EXCEPTION 'sent_snapshot_server_only' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.issue_4273_sent_snapshot_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS issue_4273_sent_snapshot_guard ON public.marketing_campaigns;
CREATE TRIGGER issue_4273_sent_snapshot_guard
BEFORE INSERT OR UPDATE OF sent_snapshot ON public.marketing_campaigns
FOR EACH ROW EXECUTE FUNCTION public.issue_4273_sent_snapshot_guard();

-- ── (Xa/Xc) What a campaign has already sent ────────────────────────────────
-- 'sent' when a message reached the provider (any sent-family email/SMS row,
-- a sent push, or a recipient_count above 0); 'started' when any message row
-- other than one held for quiet hours exists; else 'none'. SECURITY DEFINER
-- because the guards below run as the caller, who may not read message rows;
-- answers only for a campaign the caller may see (else 'none': the caller's
-- own UPDATE/DELETE cannot reach a row it cannot see anyway).
CREATE OR REPLACE FUNCTION public.issue_4273_campaign_send_record(p_campaign_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT CASE
    WHEN c.id IS NULL THEN 'none'
    WHEN COALESCE(c.recipient_count, 0) > 0
      OR EXISTS (SELECT 1 FROM public.marketing_messages m
                  WHERE m.campaign_id = c.id
                    AND m.status IN ('sent', 'delivered', 'opened', 'clicked', 'unsubscribed', 'bounced', 'complained'))
      OR EXISTS (SELECT 1 FROM public.marketing_push_messages p
                  WHERE p.campaign_id = c.id AND p.status = 'sent') THEN 'sent'
    WHEN EXISTS (SELECT 1 FROM public.marketing_messages m
                  WHERE m.campaign_id = c.id AND m.status <> 'deferred')
      OR EXISTS (SELECT 1 FROM public.marketing_push_messages p
                  WHERE p.campaign_id = c.id) THEN 'started'
    ELSE 'none'
  END
  FROM (SELECT 1) one
  LEFT JOIN public.marketing_campaigns c
    ON c.id = p_campaign_id
   AND (c.account_id = auth.uid() OR COALESCE(public.mkt_brand_min_rank(c.brand_id, 'brand_member'), false))
$fn$;

REVOKE ALL ON FUNCTION public.issue_4273_campaign_send_record(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_4273_campaign_send_record(uuid) TO authenticated, service_role;

-- ── (Xa) A campaign that has started is read-only to the app and the API ────
-- The app's own transitions (draft edits, draft -> scheduled, rescheduling or
-- cancelling a send that has not started) are unchanged. Everything the server
-- does runs as service_role or postgres and is not restricted.
CREATE OR REPLACE FUNCTION public.issue_4273_campaign_lock_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF current_user IN ('service_role', 'postgres', 'supabase_admin') THEN
    RETURN NEW;
  END IF;
  IF OLD.status NOT IN ('draft', 'scheduled')
     OR OLD.sent_snapshot IS NOT NULL
     OR (OLD.status = 'scheduled' AND (OLD.scheduled_for IS NULL OR OLD.scheduled_for <= now()))
     -- A partly sent campaign whose snapshot write failed still has message
     -- rows: any row other than one held for quiet hours means it started.
     OR (OLD.status = 'scheduled' AND public.issue_4273_campaign_send_record(OLD.id) <> 'none') THEN
    -- Started, finished, due, or partly sent and held for quiet hours: only a
    -- no-op touch of updated_at is accepted.
    IF (to_jsonb(NEW) - 'updated_at') IS DISTINCT FROM (to_jsonb(OLD) - 'updated_at') THEN
      RAISE EXCEPTION 'campaign_locked' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NOT ((OLD.status = 'draft' AND NEW.status = 'scheduled')
              OR (OLD.status = 'scheduled' AND NEW.status = 'cancelled')) THEN
    RAISE EXCEPTION 'campaign_status_transition_refused' USING ERRCODE = '42501';
  END IF;
  IF NEW.sent_at IS DISTINCT FROM OLD.sent_at
     OR NEW.recipient_count IS DISTINCT FROM OLD.recipient_count THEN
    RAISE EXCEPTION 'campaign_server_field' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.issue_4273_campaign_lock_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS issue_4273_campaign_lock_guard ON public.marketing_campaigns;
CREATE TRIGGER issue_4273_campaign_lock_guard
BEFORE UPDATE ON public.marketing_campaigns
FOR EACH ROW EXECUTE FUNCTION public.issue_4273_campaign_lock_guard();

-- ── (Xc) Only an unsent campaign can be deleted by the app or the API ───────
-- A draft, or a failed or cancelled campaign that reached nobody. A campaign
-- that sent anything is kept on record: deleting it would cascade away its
-- message and click history. The server is not restricted.
CREATE OR REPLACE FUNCTION public.issue_4273_campaign_delete_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF current_user IN ('service_role', 'postgres', 'supabase_admin') THEN
    RETURN OLD;
  END IF;
  IF OLD.status NOT IN ('draft', 'failed', 'cancelled')
     OR public.issue_4273_campaign_send_record(OLD.id) = 'sent' THEN
    RAISE EXCEPTION 'campaign_kept_for_records' USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END;
$fn$;

REVOKE ALL ON FUNCTION public.issue_4273_campaign_delete_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS issue_4273_campaign_delete_guard ON public.marketing_campaigns;
CREATE TRIGGER issue_4273_campaign_delete_guard
BEFORE DELETE ON public.marketing_campaigns
FOR EACH ROW EXECUTE FUNCTION public.issue_4273_campaign_delete_guard();

-- ── (Xb) A failed or cancelled method no longer holds its slot ──────────────
DROP INDEX IF EXISTS public.issue_3682_one_channel_per_campaign_group;
CREATE UNIQUE INDEX issue_3682_one_channel_per_campaign_group
  ON public.marketing_campaigns ((COALESCE(campaign_group_id, id)), channel)
  WHERE status NOT IN ('failed', 'cancelled');
COMMENT ON INDEX public.issue_3682_one_channel_per_campaign_group IS
  '#3682 one method per campaign group; #4273 counts only live methods (draft, scheduled, sending, sent), so a failed or cancelled method can be sent again.';

-- ── (M3) One campaign, every method ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.biz_marketing_campaign_group_view_v1(p_campaign_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  c public.marketing_campaigns%ROWTYPE;
  g uuid;
  v_brand jsonb;
  v_members jsonb;
BEGIN
  SELECT * INTO c FROM public.marketing_campaigns WHERE id = p_campaign_id;
  -- One answer for "missing" and "not yours": no existence leak.
  IF NOT FOUND OR NOT (c.account_id = auth.uid()
                       OR COALESCE(public.mkt_brand_min_rank(c.brand_id, 'brand_member'), false)) THEN
    RAISE EXCEPTION 'campaign_not_found' USING ERRCODE = 'P0002';
  END IF;
  g := COALESCE(c.campaign_group_id, c.id);

  SELECT jsonb_build_object(
           'name', b.name,
           'slug', b.slug,
           'coverUrl', CASE WHEN b.cover_media_type IS DISTINCT FROM 'video'
                             AND btrim(COALESCE(b.cover_media_url, '')) <> ''
                            THEN b.cover_media_url END)
    INTO v_brand
    FROM public.brands b
   WHERE b.id = c.brand_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'campaignId', m.id,
           'channel', m.channel,
           'status', m.status,
           'name', m.name,
           'isHead', m.id = g,
           'createdAt', m.created_at,
           'updatedAt', m.updated_at,
           'scheduledFor', m.scheduled_for,
           'sentAt', m.sent_at,
           'payload', m.channel_payload,
           'snapshot', m.sent_snapshot,
           'push', CASE WHEN m.channel = 'push' THEN jsonb_build_object(
                     'queued', COALESCE(pc.queued, 0), 'sent', COALESCE(pc.sent, 0),
                     'failed', COALESCE(pc.failed, 0), 'skipped', COALESCE(pc.skipped, 0)) END,
           'sms', CASE WHEN m.channel = 'sms' THEN jsonb_build_object(
                    'segmentsSent', COALESCE(sc.segments_sent, 0),
                    'messagesAccepted', COALESCE(sc.accepted, 0),
                    'deferred', COALESCE(sc.deferred, 0)) END,
           'cost', CASE WHEN e.id IS NOT NULL THEN jsonb_build_object(
                     'costKind', e.cost_kind, 'estimatedCostMinor', e.estimated_cost_minor,
                     'currency', e.currency, 'smsSegmentCount', e.sms_segment_count,
                     'reachableCount', e.reachable_count, 'selectedCount', e.selected_count) END
         ) ORDER BY m.created_at, m.id), '[]'::jsonb)
    INTO v_members
    FROM public.marketing_campaigns m
    LEFT JOIN LATERAL (
      SELECT count(*) FILTER (WHERE p.status = 'queued') AS queued,
             count(*) FILTER (WHERE p.status = 'sent') AS sent,
             count(*) FILTER (WHERE p.status = 'failed') AS failed,
             count(*) FILTER (WHERE p.status = 'skipped') AS skipped
        FROM public.marketing_push_messages p
       WHERE p.campaign_id = m.id
    ) pc ON m.channel = 'push'
    LEFT JOIN LATERAL (
      SELECT sum(mm.segments) FILTER (WHERE mm.status IN ('sent', 'delivered', 'clicked', 'unsubscribed')) AS segments_sent,
             count(*) FILTER (WHERE mm.status IN ('sent', 'delivered', 'clicked', 'unsubscribed')) AS accepted,
             count(*) FILTER (WHERE mm.status = 'deferred') AS deferred
        FROM public.marketing_messages mm
       WHERE mm.campaign_id = m.id
    ) sc ON m.channel = 'sms'
    LEFT JOIN public.marketing_book_send_executions e ON e.campaign_id = m.id
   WHERE COALESCE(m.campaign_group_id, m.id) = g
     AND m.brand_id = c.brand_id;

  RETURN jsonb_build_object(
    'groupId', g,
    'focusCampaignId', c.id,
    'brand', v_brand,
    'members', v_members);
END;
$fn$;

REVOKE ALL ON FUNCTION public.biz_marketing_campaign_group_view_v1(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.biz_marketing_campaign_group_view_v1(uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.biz_marketing_campaign_group_view_v1(uuid) IS
  '#4273: every method of the campaign group that p_campaign_id belongs to, for the author or a brand member: status, saved message, send snapshot, push counts, SMS segments and the confirmed cost. Counts only: never a recipient, contact, user id or reason per person. Missing and not-yours both raise campaign_not_found (P0002).';

-- ── (M4) One key per phone ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.issue_4273_phone_key(p text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $fn$
  WITH s AS (
    SELECT btrim(COALESCE(p, '')) AS raw,
           regexp_replace(COALESCE(p, ''), '[^0-9]', '', 'g') AS d
  ), k AS (
    SELECT CASE
      WHEN s.raw = '' OR position('@' IN s.raw) > 0 OR s.d = '' THEN NULL
      WHEN left(s.raw, 1) = '+' THEN '+' || s.d
      WHEN left(s.d, 2) = '00' THEN '+' || substr(s.d, 3)
      -- A ten-digit North American number written without its country code.
      WHEN s.d ~ '^[2-9][0-9]{2}[2-9][0-9]{6}$' THEN '+1' || s.d
      -- A national number with a trunk 0: the country is unknown.
      WHEN left(s.d, 1) = '0' THEN NULL
      -- Country code present, '+' missing.
      ELSE '+' || s.d
    END AS key
    FROM s
  )
  SELECT CASE WHEN k.key ~ '^\+[1-9][0-9]{6,14}$' THEN k.key END FROM k
$fn$;

REVOKE ALL ON FUNCTION public.issue_4273_phone_key(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4273_phone_key(text) TO service_role;
COMMENT ON FUNCTION public.issue_4273_phone_key(text) IS
  '#4273: the E.164 key of a stored phone for opt-out matching. +digits and 00digits keep their country; ten NANP digits are +1; a number with a trunk 0 is NULL (country unknown, matches nothing); other bare digits are taken to carry their country code. Two phones are the same only when both keys are non-null and equal.';

-- ── (M5) Who said no ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.issue_4273_marketing_opted_out(
  p_brand_id uuid, p_channel text, p_contact text, p_user_id uuid DEFAULT NULL
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
  WITH c AS (
    SELECT CASE p_channel WHEN 'phone' THEN 'sms' ELSE p_channel END AS ch,
           CASE WHEN p_channel = 'email' THEN lower(btrim(p_contact)) ELSE btrim(p_contact) END AS v,
           public.issue_4273_phone_key(p_contact) AS pkey
  ), same AS (
    -- One address, compared the way its channel needs: email case-insensitive,
    -- phone on its E.164 key (a stored number may lack its '+', or its +1).
    SELECT c.*, (c.ch = 'sms' AND c.pkey IS NOT NULL) AS phone_ok FROM c
  )
  SELECT EXISTS (
    SELECT 1 FROM same c JOIN public.consent_records r
      ON r.channel = c.ch AND r.scope = 'marketing' AND r.action = 'revoked'
     AND (r.brand_id IS NULL OR r.brand_id = p_brand_id)
     AND CASE WHEN c.ch = 'sms' THEN c.phone_ok AND public.issue_4273_phone_key(r.contact) = c.pkey
              ELSE lower(btrim(r.contact)) = c.v END
     WHERE NOT EXISTS (
       SELECT 1 FROM public.consent_records g
        WHERE g.channel = r.channel AND g.scope = 'marketing' AND g.action = 'granted'
          AND lower(btrim(g.contact)) = lower(btrim(r.contact))
          AND (g.brand_id IS NULL OR g.brand_id = p_brand_id)
          AND g.source NOT IN ('purchase_auto_optin', 'follow_auto_optin')
          AND g.created_at > r.created_at)
    UNION ALL
    -- Q1: an account-scope row belongs to the SENDING HOST's account, so it
    -- holds for every brand that account runs.
    SELECT 1 FROM same c JOIN public.marketing_unsubscribes u ON u.channel IN (c.ch, 'all')
     WHERE ((c.ch = 'email' AND lower(btrim(u.contact_email)) = c.v)
            OR (c.phone_ok AND public.issue_4273_phone_key(u.contact_phone) = c.pkey))
       AND (u.scope = 'global' OR (u.scope = 'brand' AND u.brand_id = p_brand_id)
            OR (u.scope = 'account'
                AND u.account_id = (SELECT b.account_id FROM public.brands b WHERE b.id = p_brand_id)))
    UNION ALL
    SELECT 1 FROM same c JOIN public.channel_suppressions s
      ON s.channel = c.ch AND s.scope IN ('marketing', 'all')
     WHERE (c.ch = 'email' AND lower(btrim(s.contact)) = c.v)
        OR (c.phone_ok AND public.issue_4273_phone_key(s.contact) = c.pkey)
        OR (p_user_id IS NOT NULL AND s.user_id = p_user_id)
    UNION ALL
    SELECT 1 FROM same c JOIN public.venue_sms_opt_out o
      ON c.phone_ok AND public.issue_4273_phone_key(o.phone_e164) = c.pkey
     WHERE o.brand_id IS NULL OR o.brand_id = p_brand_id
    UNION ALL
    SELECT 1 FROM same c JOIN public.brand_person_contact_methods m
      ON m.brand_id = p_brand_id AND m.record_state = 'active'
     AND m.channel = CASE c.ch WHEN 'sms' THEN 'phone' ELSE 'email' END
     AND CASE WHEN c.ch = 'sms' THEN c.phone_ok AND public.issue_4273_phone_key(m.normalized_value) = c.pkey
              ELSE lower(m.normalized_value) = c.v END
      JOIN public.brand_person_channel_suppressions s
        ON s.brand_person_id = m.brand_person_id AND s.channel = c.ch
       AND s.lifted_at IS NULL AND s.scope IN ('marketing', 'all')
  )
$fn$;

COMMENT ON FUNCTION public.issue_4273_marketing_opted_out(uuid, text, text, uuid) IS
  '#4273: true when this contact (or, given an account, a suppression keyed to that account) said no to this brand''s marketing on this channel: an unreversed marketing revocation, an unsubscribe (global, this brand, or account scope from the account that owns this brand), a suppression (STOP included, account-keyed included), a venue SMS opt-out, or a host-side suppression on a Book row holding it. Phones compare on issue_4273_phone_key (E.164; a trunk-0 national number matches nothing). An automatic grant never reverses any of these.';

-- ── (M6) Every account known on a contact, verified identities included ─────
CREATE OR REPLACE FUNCTION public.issue_4273_contact_accounts(
  p_brand_id uuid, p_channel text, p_contact text
) RETURNS SETOF uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_ch text := CASE p_channel WHEN 'phone' THEN 'sms' ELSE p_channel END;
  v_email text := lower(btrim(p_contact));
  v_pkey text := public.issue_4273_phone_key(p_contact);
BEGIN
  RETURN QUERY
  SELECT a.account
    FROM public.orders o
    JOIN public.events e ON e.id = o.event_id AND e.brand_id = p_brand_id
    CROSS JOIN LATERAL (VALUES (o.buyer_user_id), (o.purchased_by_user_id)) a(account)
   WHERE a.account IS NOT NULL
     AND ((v_ch = 'email' AND lower(btrim(o.buyer_email)) = v_email)
      OR (v_ch = 'sms' AND v_pkey IS NOT NULL
          AND public.issue_4273_phone_key(COALESCE(o.buyer_phone_e164, o.buyer_phone)) = v_pkey))
  UNION
  SELECT bp.linked_user_id
    FROM public.brand_person_contact_methods m
    JOIN public.brand_people bp ON bp.id = m.brand_person_id AND bp.linked_user_id IS NOT NULL
   WHERE m.brand_id = p_brand_id AND m.record_state = 'active'
     AND m.channel = CASE v_ch WHEN 'sms' THEN 'phone' ELSE 'email' END
     AND ((v_ch = 'email' AND lower(m.normalized_value) = v_email)
      OR (v_ch = 'sms' AND v_pkey IS NOT NULL AND public.issue_4273_phone_key(m.normalized_value) = v_pkey))
  UNION
  -- 3a: an account that verified this number, whether or not it ever bought.
  SELECT v.user_id
    FROM public.verified_phone_identities v
   WHERE v_ch = 'sms' AND v_pkey IS NOT NULL
     AND public.issue_4273_phone_key(v.phone_e164) = v_pkey;

  -- 3a: GoTrue identities, with the same predicates as
  -- verified_account_identifiers, read contact -> accounts. Guarded because the
  -- CI image's auth schema has no identities table; plpgsql plans this
  -- statement only when it runs, so the guard holds without EXECUTE.
  IF to_regclass('auth.identities') IS NOT NULL THEN
    RETURN QUERY
    SELECT i.user_id
      FROM auth.identities i
     WHERE v_ch = 'email'
       AND btrim(COALESCE(i.identity_data ->> 'email', '')) <> ''
       AND lower(btrim(i.identity_data ->> 'email')) = v_email
       AND (i.provider = 'email'
            OR lower(COALESCE(i.identity_data ->> 'email_verified', '')) IN ('true', 't'))
    UNION
    SELECT i.user_id
      FROM auth.identities i
      JOIN auth.users u ON u.id = i.user_id
     WHERE v_ch = 'sms' AND v_pkey IS NOT NULL
       AND i.provider = 'phone'
       AND public.issue_4273_phone_key(COALESCE(i.identity_data ->> 'phone', u.phone)) = v_pkey;
  END IF;
END;
$fn$;

REVOKE ALL ON FUNCTION public.issue_4273_contact_accounts(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4273_contact_accounts(uuid, text, text) TO service_role;
COMMENT ON FUNCTION public.issue_4273_contact_accounts(uuid, text, text) IS
  '#4273: every account this brand knows on one contact: order buyer and purchaser accounts, linked Book accounts, and any account that verified the contact (verified_phone_identities, GoTrue phone or email identity). Erring wide is deliberate: an identity here can only withhold. Service-only.';

-- ── (M7) The address check follows Q1 ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.issue_4273_address_denied(
  p_brand_id uuid, p_channel text, p_address text, p_user_id uuid
) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM public.marketing_unsubscribes u
       WHERE u.channel IN (p_channel, 'all')
         AND ((p_channel = 'email' AND lower(u.contact_email) = lower(p_address))
              OR (p_channel = 'sms' AND u.contact_phone = p_address))
         AND (u.scope = 'global' OR (u.scope = 'brand' AND u.brand_id = p_brand_id)
              OR (u.scope = 'account'
                  AND u.account_id = (SELECT b.account_id FROM public.brands b WHERE b.id = p_brand_id)))
      UNION ALL
      SELECT 1 FROM public.channel_suppressions s
       WHERE s.channel = p_channel AND s.scope IN ('marketing', 'all')
         AND (lower(s.contact) = lower(p_address) OR (p_user_id IS NOT NULL AND s.user_id = p_user_id))
    ) THEN 'suppressed'
    WHEN NOT public.can_send(p_user_id, 'marketing_blast', p_channel, p_address) THEN 'can_send_denied'
  END
$fn$;

-- ── (Q1b) The #3682 follow gate: account arm follows Q1 ─────────────────────
CREATE OR REPLACE FUNCTION public.biz_brand_follow_channel_ok(
  p_user_id uuid,
  p_brand_id uuid,
  p_channel text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $f$
DECLARE
  v_muted timestamptz;
  v_enabled boolean;
  v_contact text;
BEGIN
  IF p_user_id IS NULL OR p_brand_id IS NULL
     OR p_channel IS NULL OR p_channel NOT IN ('push', 'email', 'sms') THEN
    RETURN false;
  END IF;

  SELECT bf.muted_until INTO v_muted
  FROM public.brand_follows bf
  WHERE bf.user_id = p_user_id AND bf.brand_id = p_brand_id;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- Muted (indefinite infinity or still in the future).
  IF v_muted IS NOT NULL AND v_muted > now() THEN
    RETURN false;
  END IF;

  SELECT p.enabled INTO v_enabled
  FROM public.brand_follow_channel_prefs p
  WHERE p.user_id = p_user_id
    AND p.brand_id = p_brand_id
    AND p.channel = p_channel;

  IF FOUND AND v_enabled IS NOT TRUE THEN
    RETURN false;
  END IF;

  -- One-click / self-serve unsubscribe authority (email + sms only).
  IF p_channel IN ('email', 'sms') THEN
    SELECT i.value INTO v_contact
    FROM public.verified_account_identifiers(p_user_id) i
    WHERE i.kind = CASE WHEN p_channel = 'sms' THEN 'phone' ELSE 'email' END
    ORDER BY i.value
    LIMIT 1;

    IF v_contact IS NOT NULL AND EXISTS (
      SELECT 1
      FROM public.marketing_unsubscribes u
      WHERE u.channel IN (p_channel, 'all')
        AND (
          (p_channel = 'email' AND lower(u.contact_email) = lower(v_contact))
          OR (p_channel = 'sms' AND u.contact_phone = v_contact)
        )
        AND (
          u.scope = 'global'
          OR (u.scope = 'brand' AND u.brand_id = p_brand_id)
          -- #4273 Q1: account scope is the sending host's account.
          OR (u.scope = 'account'
              AND u.account_id = (SELECT b.account_id FROM public.brands b WHERE b.id = p_brand_id))
        )
    ) THEN
      RETURN false;
    END IF;
  END IF;

  -- No pref row → default on (after mute + unsubscribe gates).
  RETURN true;
END;
$f$;

REVOKE ALL ON FUNCTION public.biz_brand_follow_channel_ok(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.biz_brand_follow_channel_ok(uuid, uuid, text)
  TO service_role;

-- ── (Q1b) The #1778 circle authoriser: account arm follows Q1 ───────────────
CREATE OR REPLACE FUNCTION public.issue_1778_circle_authorized_contact(
  p_brand_id uuid, p_user_id uuid, p_channel text
) RETURNS TABLE(normalized_contact text, allowed boolean, reason text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $function$
DECLARE v_contact text; v_allowed boolean;
BEGIN
  IF p_channel NOT IN('email','sms') THEN
    RETURN QUERY SELECT NULL::text,false,'channel_unavailable'::text; RETURN;
  END IF;
  SELECT i.value INTO v_contact
  FROM public.verified_account_identifiers(p_user_id) i
  WHERE i.kind=CASE WHEN p_channel='sms' THEN 'phone' ELSE 'email' END
  ORDER BY i.value LIMIT 1;
  IF v_contact IS NULL THEN
    RETURN QUERY SELECT NULL::text,false,'channel_unavailable'::text; RETURN;
  END IF;
  IF EXISTS(
    SELECT 1 FROM public.brand_circle_exits x
    WHERE x.brand_id=p_brand_id AND x.user_id=p_user_id
      AND (x.visibility_exited_at IS NOT NULL OR x.delivery_exited_at IS NOT NULL)
  ) THEN RETURN QUERY SELECT v_contact,false,'delivery_denied'::text; RETURN; END IF;
  IF EXISTS (
    SELECT 1
    FROM public.marketing_unsubscribes u
    WHERE u.channel IN (p_channel, 'all')
      AND (
        (p_channel = 'email' AND lower(u.contact_email) = lower(v_contact))
        OR (p_channel = 'sms' AND u.contact_phone = v_contact)
      )
      AND (
        u.scope = 'global'
        OR (u.scope = 'brand' AND u.brand_id = p_brand_id)
        -- #4273 Q1: account scope is the sending host's account.
        OR (u.scope = 'account'
            AND u.account_id = (SELECT b.account_id FROM public.brands b WHERE b.id = p_brand_id))
      )
  ) THEN
    RETURN QUERY SELECT v_contact,false,'unsubscribed'::text; RETURN;
  END IF;
  v_allowed:=public.can_send(p_user_id,'marketing_blast',p_channel,v_contact);
  RETURN QUERY SELECT v_contact,v_allowed,CASE WHEN v_allowed THEN 'allowed' ELSE 'can_send_denied' END;
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_1778_circle_authorized_contact(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_1778_circle_authorized_contact(uuid,uuid,text) TO service_role;

-- ── (M8) Post-apply assertions ──────────────────────────────────────────────
DO $assert$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'marketing_campaigns'
                    AND column_name = 'sent_snapshot') THEN
    RAISE EXCEPTION '#4273 M8: sent_snapshot column missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.marketing_campaigns'::regclass
                    AND conname = 'issue_4273_sent_snapshot_object') THEN
    RAISE EXCEPTION '#4273 M8: sent_snapshot constraint missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgrelid = 'public.marketing_campaigns'::regclass
                    AND tgname = 'issue_4273_sent_snapshot_guard' AND NOT tgisinternal) THEN
    RAISE EXCEPTION '#4273 M8: sent_snapshot guard trigger missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgrelid = 'public.marketing_campaigns'::regclass
                    AND tgname = 'issue_4273_campaign_delete_guard' AND NOT tgisinternal) THEN
    RAISE EXCEPTION '#4273 M8: campaign delete trigger missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgrelid = 'public.marketing_campaigns'::regclass
                    AND tgname = 'issue_4273_campaign_lock_guard' AND NOT tgisinternal) THEN
    RAISE EXCEPTION '#4273 M8: campaign lock trigger missing';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.biz_marketing_campaign_group_view_v1(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.biz_marketing_campaign_group_view_v1(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '#4273 M8: group view grants wrong';
  END IF;
  IF public.issue_4273_phone_key('2025550199') IS DISTINCT FROM '+12025550199'
     OR public.issue_4273_phone_key('+2025550199') IS DISTINCT FROM '+2025550199'
     OR public.issue_4273_phone_key('08031100042') IS NOT NULL
     OR public.issue_4273_phone_key('234 803 110 0043') IS DISTINCT FROM '+2348031100043' THEN
    RAISE EXCEPTION '#4273 M8: phone key cases wrong';
  END IF;
END
$assert$;

COMMIT;
