-- META-ORCH-1104 Phase 0 — Support live-chat + tickets + segmentation: backend foundation.
--
-- Authoritative Phase-0 contract per SPEC §2 (data model 2.1–2.8), §2.6 ('support'
-- linked_entity_type widening), §3 (security). Backend only — no UI.
--
-- Migration-baseline hazards observed (feedback_edge_deploy_and_migration_apply_hazards.md):
--   * widening a CHECK = DROP CONSTRAINT then ADD CONSTRAINT in the same migration;
--   * $function$; terminator before any GRANT;
--   * idempotent ALTER VIEW (CREATE OR REPLACE VIEW);
--   * no unguarded destructive ops on real data (is_admin is snapshotted + deprecated,
--     NOT dropped here — the drop is the SEPARATE operator-gated file
--     20260922000000_meta_orch_1104_drop_profiles_is_admin.sql).
--
-- Read-only remote probes captured 2026-06-08 (Management API execute_sql):
--   * profiles.is_admin: 38 rows, 0 true → blast radius ~0 (SPEC D5.1 / Lane B §3).
--   * profiles.account_type distinct: {null:35, business:2, admin:1} → all CHECK-compatible.
--   * derive_user_segment inline counts: admin=1, business=13, explorer=24 → matches SPEC SC-0.3.
--   * conversations CHECK constraints match the exact names/defs the SPEC DROPs.
--   * can_insert_message_into_conversation: 'support' takes the (linked_entity_type<>ALL(trip,event))
--     branch = TRUE → the RESTRICTIVE messages_broadcast_only_enforcement passes support inserts.
--   * notification_preferences columns are boolean-per-category (messages, marketing, …);
--     no channel/type/opt_in columns (the D6 dead-gate fact).

BEGIN;

-- ───────────────────────────────────────────────────────────────────────────
-- §2.1 support_tickets — the support entity (D2). A ticket OWNS a conversation.
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.support_tickets (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_user_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  requester_segment  text NOT NULL DEFAULT 'business'
                       CHECK (requester_segment IN ('business','explorer')),
  subject            text NOT NULL CHECK (char_length(btrim(subject)) BETWEEN 1 AND 200),
  status             text NOT NULL DEFAULT 'new'
                       CHECK (status IN ('new','open','pending','resolved','closed')),
  priority           text NOT NULL DEFAULT 'normal'
                       CHECK (priority IN ('low','normal','high','urgent')),
  assigned_staff_id  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  conversation_id    uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  brand_id           uuid REFERENCES public.brands(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  first_response_at  timestamptz,
  resolved_at        timestamptz,
  last_message_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS support_tickets_conversation_id_key
  ON public.support_tickets(conversation_id);
CREATE INDEX IF NOT EXISTS support_tickets_status_lastmsg_idx
  ON public.support_tickets(status, last_message_at DESC);
CREATE INDEX IF NOT EXISTS support_tickets_assigned_idx
  ON public.support_tickets(assigned_staff_id) WHERE assigned_staff_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS support_tickets_requester_idx
  ON public.support_tickets(requester_user_id);

ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;

-- ───────────────────────────────────────────────────────────────────────────
-- §2.2 support_staff — staff capability, DECOUPLED from brand membership (D3).
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.support_staff (
  user_id      uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  enabled      boolean NOT NULL DEFAULT false,
  available    boolean NOT NULL DEFAULT false,
  display_name text,
  role         text NOT NULL DEFAULT 'staff' CHECK (role IN ('staff','lead')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.support_staff ENABLE ROW LEVEL SECURITY;

-- ───────────────────────────────────────────────────────────────────────────
-- §3.2 #7 support_audit_log — every staff claim/reply/status change is logged.
-- (admin_audit_log requires admin_email NOT NULL; staff can be non-admin, so a
--  dedicated audit table is used.)
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.support_audit_log (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action         text NOT NULL,
  ticket_id      uuid,
  metadata       jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS support_audit_log_ticket_idx ON public.support_audit_log(ticket_id);
ALTER TABLE public.support_audit_log ENABLE ROW LEVEL SECURITY;

-- ───────────────────────────────────────────────────────────────────────────
-- §2.3 is_support_staff() — mirrors is_admin_user() (Lane D D3/D4).
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_support_staff(p_user_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.support_staff s
    WHERE s.user_id = p_user_id AND s.enabled = true
  );
$function$;
REVOKE ALL ON FUNCTION public.is_support_staff(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_support_staff(uuid) TO authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- §2.4 derive_user_segment() + profiles_with_segment view (D5, Lane B §6).
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.derive_user_segment(p_profile_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM public.admin_users au
      JOIN auth.users u ON lower(u.email) = lower(au.email)
      WHERE u.id = p_profile_id AND au.status = 'active'
    ) THEN 'admin'
    WHEN EXISTS (
      SELECT 1 FROM public.brand_team_members btm
      WHERE btm.user_id = p_profile_id
        AND btm.accepted_at IS NOT NULL
        AND btm.removed_at IS NULL
    ) THEN 'business'
    ELSE 'explorer'
  END;
$function$;
REVOKE ALL ON FUNCTION public.derive_user_segment(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.derive_user_segment(uuid) TO authenticated;

-- security_invoker view: inherits the caller's profiles RLS. A non-admin sees
-- only their own row; an admin (profiles "Admins can read all profiles") sees all.
CREATE OR REPLACE VIEW public.profiles_with_segment
WITH (security_invoker = true) AS
SELECT p.*, public.derive_user_segment(p.id) AS segment
FROM public.profiles p;
GRANT SELECT ON public.profiles_with_segment TO authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- §2.5 Data-integrity cleanup (D5).
-- ───────────────────────────────────────────────────────────────────────────

-- §2.5.1 #1 — admin_toggle_partner privilege divergence: gate on is_admin_user()
-- instead of profiles.account_type='admin'. Re-declares the LIVE def verbatim
-- (probed 2026-06-08) with ONLY the gate block changed (Lane B §2.4). The two
-- migration twins (20260822000000:112/:434, 20260823000000:118) are historical
-- and already applied; the live function is the authoritative target — this
-- CREATE OR REPLACE is the single source of truth post-migration.
CREATE OR REPLACE FUNCTION public.admin_toggle_partner(p_account_id uuid, p_enabled boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_prior boolean;
BEGIN
  -- I-1104-ADMIN-GATE-UNIFIED: gate on the SAME authority login/RLS uses
  -- (admin_users via is_admin_user()), not the divergent profiles.account_type.
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT partner_enabled INTO v_prior
  FROM public.creator_accounts
  WHERE id = p_account_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'account_not_found' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.creator_accounts
  SET partner_enabled = p_enabled
  WHERE id = p_account_id;

  BEGIN
    INSERT INTO public.audit_log
      (user_id, brand_id, action, target_type, target_id, before, after)
    VALUES (
      auth.uid(),
      NULL,
      'admin.partner_enabled_toggle',
      'creator_account',
      p_account_id::text,
      jsonb_build_object('partner_enabled', v_prior),
      jsonb_build_object('partner_enabled', p_enabled)
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN jsonb_build_object(
    'ok', true,
    'account_id', p_account_id,
    'partner_enabled', p_enabled
  );
END;
$function$;

-- §2.5 #2 — account_type as a non-authoritative cache: a CHECK so the admin
-- Edit input can't write garbage, then a one-time backfill from the derived
-- segment so the legacy admin .or(account_type…) filter stops lying.
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_account_type_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_account_type_check
  CHECK (account_type IS NULL OR account_type IN ('explorer','business','admin'));

UPDATE public.profiles p
SET account_type = public.derive_user_segment(p.id)
WHERE account_type IS DISTINCT FROM public.derive_user_segment(p.id);

-- §2.5.1 #3 Step A — REVERSIBLE is_admin retirement: SNAPSHOT + DEPRECATE ONLY.
-- The DROP is the SEPARATE operator-gated file 20260922000000_*.sql, applied on
-- Seth's explicit go after Phase 0 soaks. DO NOT drop the column here.
CREATE TABLE IF NOT EXISTS public._deprecated_profiles_is_admin_backup AS
  SELECT id AS profile_id, is_admin, now() AS snapshotted_at FROM public.profiles;
COMMENT ON TABLE public._deprecated_profiles_is_admin_backup IS
  'META-ORCH-1104 D5.1 snapshot of profiles.is_admin prior to drop. Restore source if the drop must be reversed. Drop this backup once the separate drop migration has soaked.';
COMMENT ON COLUMN public.profiles.is_admin IS
  '[DEPRECATED META-ORCH-1104 D5.1] dead column — 0 readers; segment derives from admin_users/brand_team_members. Drop via the separate operator-gated drop migration. DO NOT add new readers.';

-- ───────────────────────────────────────────────────────────────────────────
-- §2.6 'support' linked_entity_type — 3-constraint CHECK widening (Lane A F1.4).
-- DROP then ADD each (CHECK widening hazard). The group_requires_name CHECK
-- already requires a non-empty trimmed name for type='group' (probed) — no
-- change needed; support conversation = type='group' + name = ticket subject.
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE public.conversations DROP CONSTRAINT conversations_linked_entity_type_check;
ALTER TABLE public.conversations ADD  CONSTRAINT conversations_linked_entity_type_check
  CHECK (linked_entity_type IN ('direct','session','trip','event','support'));

ALTER TABLE public.conversations DROP CONSTRAINT conversations_linked_entity_coherent;
ALTER TABLE public.conversations ADD  CONSTRAINT conversations_linked_entity_coherent CHECK (
  (linked_entity_type = 'direct'  AND session_id IS NULL     AND event_id IS NULL) OR
  (linked_entity_type = 'session' AND session_id IS NOT NULL AND event_id IS NULL) OR
  (linked_entity_type = 'trip'    AND event_id   IS NOT NULL AND session_id IS NULL) OR
  (linked_entity_type = 'event'   AND event_id   IS NOT NULL AND session_id IS NULL) OR
  (linked_entity_type = 'support' AND session_id IS NULL     AND event_id IS NULL)
);

-- ───────────────────────────────────────────────────────────────────────────
-- §2.8 / §2.7 SECURITY DEFINER RPCs.
-- ───────────────────────────────────────────────────────────────────────────

-- create_support_ticket — mint a ticket + conversation + seed the requester,
-- atomically. Safe to call from the client: it only ever acts for auth.uid().
CREATE OR REPLACE FUNCTION public.create_support_ticket(p_subject text, p_brand_id uuid DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE v_conv uuid; v_ticket uuid; v_seg text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF btrim(coalesce(p_subject,'')) = '' THEN
    RAISE EXCEPTION 'subject_required' USING ERRCODE = 'P0001';
  END IF;
  v_seg := public.derive_user_segment(auth.uid());
  -- v1 requesters are business users; an admin who files is still a requester.
  IF v_seg = 'admin' THEN v_seg := 'business'; END IF;
  IF v_seg NOT IN ('business','explorer') THEN v_seg := 'business'; END IF;
  INSERT INTO public.conversations(type, linked_entity_type, name, created_by)
    VALUES ('group','support', left(btrim(p_subject),200), auth.uid()) RETURNING id INTO v_conv;
  INSERT INTO public.conversation_participants(conversation_id, user_id) VALUES (v_conv, auth.uid());
  INSERT INTO public.support_tickets(requester_user_id, requester_segment, subject, conversation_id, brand_id)
    VALUES (auth.uid(), v_seg, left(btrim(p_subject),200), v_conv, p_brand_id) RETURNING id INTO v_ticket;
  RETURN v_ticket;
END; $function$;
REVOKE ALL ON FUNCTION public.create_support_ticket(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_support_ticket(text, uuid) TO authenticated;

-- claim_support_ticket — set assigned_staff_id, seed staffer participant, flip
-- status. MUST only be invoked by a service-role edge fn that re-asserted staff
-- identity (it takes an arbitrary p_staff_id). NOT granted to authenticated/anon.
CREATE OR REPLACE FUNCTION public.claim_support_ticket(p_ticket_id uuid, p_staff_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE v_conv uuid;
BEGIN
  SELECT conversation_id INTO v_conv FROM public.support_tickets WHERE id = p_ticket_id;
  IF v_conv IS NULL THEN
    RAISE EXCEPTION 'ticket_not_found' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.support_tickets
    SET assigned_staff_id = p_staff_id,
        status = CASE WHEN status IN ('new') THEN 'open' ELSE status END
    WHERE id = p_ticket_id;
  INSERT INTO public.conversation_participants(conversation_id, user_id)
    VALUES (v_conv, p_staff_id) ON CONFLICT (conversation_id, user_id) DO NOTHING;
END; $function$;
-- Lane D D5 #5/#6: NEVER expose claim_support_ticket to clients with an
-- arbitrary p_staff_id. Service-role only (service_role bypasses GRANTs).
REVOKE ALL ON FUNCTION public.claim_support_ticket(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_support_ticket(uuid, uuid) FROM anon, authenticated;

-- support_set_available — the staffer's column-restricted self-write of the
-- `available` shift toggle. RLS can't column-restrict an UPDATE cleanly, so this
-- DEFINER RPC writes ONLY `available` for auth.uid() when that user is enabled.
CREATE OR REPLACE FUNCTION public.support_set_available(p_available boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE v_enabled boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  SELECT enabled INTO v_enabled FROM public.support_staff WHERE user_id = auth.uid();
  IF v_enabled IS NOT TRUE THEN
    RAISE EXCEPTION 'not_support_staff' USING ERRCODE = '42501';
  END IF;
  UPDATE public.support_staff
    SET available = p_available, updated_at = now()
    WHERE user_id = auth.uid();
  RETURN p_available;
END; $function$;
REVOKE ALL ON FUNCTION public.support_set_available(boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.support_set_available(boolean) TO authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- §2.7 RLS policies.
-- ───────────────────────────────────────────────────────────────────────────

-- support_tickets: requester sees own; staff/admin see all; nobody else.
DROP POLICY IF EXISTS support_tickets_requester_read ON public.support_tickets;
CREATE POLICY support_tickets_requester_read ON public.support_tickets FOR SELECT
  USING (requester_user_id = auth.uid()
         OR public.is_support_staff(auth.uid()) OR public.is_admin_user());
DROP POLICY IF EXISTS support_tickets_requester_insert ON public.support_tickets;
CREATE POLICY support_tickets_requester_insert ON public.support_tickets FOR INSERT
  WITH CHECK (requester_user_id = auth.uid());
DROP POLICY IF EXISTS support_tickets_staff_update ON public.support_tickets;
CREATE POLICY support_tickets_staff_update ON public.support_tickets FOR UPDATE
  USING (public.is_support_staff(auth.uid()) OR public.is_admin_user())
  WITH CHECK (public.is_support_staff(auth.uid()) OR public.is_admin_user());

-- support_staff: self-read; ALL writes admin-gated; the staffer's available
-- toggle goes through support_set_available (the broad self-update policy is the
-- net, the RPC is the real write path; enabled/role are admin-only via edge fn).
DROP POLICY IF EXISTS support_staff_self_read ON public.support_staff;
CREATE POLICY support_staff_self_read ON public.support_staff FOR SELECT
  USING (user_id = auth.uid() OR public.is_admin_user());
DROP POLICY IF EXISTS support_staff_admin_write ON public.support_staff;
CREATE POLICY support_staff_admin_write ON public.support_staff FOR INSERT
  WITH CHECK (public.is_admin_user());
DROP POLICY IF EXISTS support_staff_admin_update ON public.support_staff;
CREATE POLICY support_staff_admin_update ON public.support_staff FOR UPDATE
  USING (public.is_admin_user() OR user_id = auth.uid())
  WITH CHECK (public.is_admin_user() OR user_id = auth.uid());

-- support_audit_log: staff/admin read; writes flow through DEFINER edge fns
-- (service-role). No client INSERT policy (deny-by-default for authenticated).
DROP POLICY IF EXISTS support_audit_log_staff_read ON public.support_audit_log;
CREATE POLICY support_audit_log_staff_read ON public.support_audit_log FOR SELECT
  USING (public.is_support_staff(auth.uid()) OR public.is_admin_user());

-- support-scoped chat-table policies (option b) — staff/admin read+write support
-- conversations WITHOUT participant pollution. Scoped to linked_entity_type='support'
-- so staff NEVER widen into users' direct/group/event DMs (Lane D D5 PII).
DROP POLICY IF EXISTS conversations_support_staff_read ON public.conversations;
CREATE POLICY conversations_support_staff_read ON public.conversations FOR SELECT
  USING (linked_entity_type = 'support'
         AND (public.is_support_staff(auth.uid()) OR public.is_admin_user()));

DROP POLICY IF EXISTS messages_support_staff_read ON public.messages;
CREATE POLICY messages_support_staff_read ON public.messages FOR SELECT
  USING (deleted_at IS NULL AND EXISTS (
    SELECT 1 FROM public.conversations c WHERE c.id = messages.conversation_id
      AND c.linked_entity_type = 'support')
    AND (public.is_support_staff(auth.uid()) OR public.is_admin_user()));

DROP POLICY IF EXISTS messages_support_staff_insert ON public.messages;
CREATE POLICY messages_support_staff_insert ON public.messages FOR INSERT
  WITH CHECK (sender_id = auth.uid() AND EXISTS (
    SELECT 1 FROM public.conversations c WHERE c.id = messages.conversation_id
      AND c.linked_entity_type = 'support')
    AND (public.is_support_staff(auth.uid()) OR public.is_admin_user()));

-- presence parity (Lane D D5 #9): support staff get the extended presence SELECT.
DROP POLICY IF EXISTS conversation_presence_support_staff_read ON public.conversation_presence;
CREATE POLICY conversation_presence_support_staff_read ON public.conversation_presence FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.conversations c WHERE c.id = conversation_presence.conversation_id
      AND c.linked_entity_type = 'support')
    AND (public.is_support_staff(auth.uid()) OR public.is_admin_user()));

-- support_tickets realtime: the admin desk + phone console + web staff stream
-- the shared queue. RLS-honored SELECT already gates per-viewer (above).
ALTER PUBLICATION supabase_realtime ADD TABLE public.support_tickets;

COMMIT;
