-- ORCH-1272 [Admin Identity console — READ-ONLY] — identity admin-read RLS.
--
-- Adds an is_admin_user() SELECT RLS policy to the four identity tables the
-- admin console reads directly through the browser (anon key + admin JWT):
--   * creator_accounts  — business-account layer (incl. soft-deleted rows)
--   * brand_team_members — brand roster / roles (no FK on user_id)
--   * brand_invitations  — pending / historical invites
--   * partner_brand_links — partner ↔ brand link state
--
-- Read-authz rule (ORCH-1271 §3): whole-row single-table reads with no
-- cross-brand derivation → an is_admin_user() SELECT RLS policy that mirrors the
-- already-shipped "brands admin can read" / "venue_listings admin can read"
-- exemplars. The unified Person bundle (which joins + crosses the sensitive
-- subscriptions / admin_subscription_overrides tables) is served by the
-- guard-first admin_get_person() read-RPC instead (sibling migration
-- 20261205000002_orch_1272_admin_get_person.sql) — NOT a browser read.
--
-- brands already has an is_admin_user() SELECT policy ("brands admin can read")
-- that also exposes soft-deleted brands — REUSED, no new brands policy here.
--
-- Single admin gate: public.is_admin_user() only — never account_type='admin'
-- (preserves I-PROPOSED-1271-ADMIN-SINGLE-GATE). DROP-then-CREATE keeps the
-- apply idempotent and re-runnable (matches the 1271 flip + the existing
-- brands/venue_listings admin-read policies).
--
-- Enforces: I-PROPOSED-1272-IDENTITY-ADMIN-READ.

--------------------------------------------------------------------------------
-- 1. creator_accounts — admin can read every account, incl. soft-deleted.
--------------------------------------------------------------------------------
DROP POLICY IF EXISTS "creator_accounts admin can read" ON public.creator_accounts;
CREATE POLICY "creator_accounts admin can read"
  ON public.creator_accounts
  FOR SELECT
  USING (public.is_admin_user());

--------------------------------------------------------------------------------
-- 2. brand_team_members — admin can read any brand's roster.
--------------------------------------------------------------------------------
DROP POLICY IF EXISTS "brand_team_members admin can read" ON public.brand_team_members;
CREATE POLICY "brand_team_members admin can read"
  ON public.brand_team_members
  FOR SELECT
  USING (public.is_admin_user());

--------------------------------------------------------------------------------
-- 3. brand_invitations — admin can read any brand's invites (all statuses).
--------------------------------------------------------------------------------
DROP POLICY IF EXISTS "brand_invitations admin can read" ON public.brand_invitations;
CREATE POLICY "brand_invitations admin can read"
  ON public.brand_invitations
  FOR SELECT
  USING (public.is_admin_user());

--------------------------------------------------------------------------------
-- 4. partner_brand_links — admin can read any partner ↔ brand link.
--------------------------------------------------------------------------------
DROP POLICY IF EXISTS "partner_brand_links admin can read" ON public.partner_brand_links;
CREATE POLICY "partner_brand_links admin can read"
  ON public.partner_brand_links
  FOR SELECT
  USING (public.is_admin_user());
