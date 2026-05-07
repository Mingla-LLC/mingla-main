-- B2a Path C V3 — Mingla Business ToS acceptance gate (D-V3-17 + I-PROPOSED-U)
-- Per outputs/SPEC_B2_PATH_C_V3.md §6.
--
-- WHY THIS MIGRATION CHANGED FROM ORIGINAL DRAFT:
-- The original draft referenced `public.brand_members` — but the actual baseline-migration
-- table is `public.brand_team_members` (defined in 20260505000000 line 7740). The implementor
-- (Sub-dispatch A) did not grep the baseline schema before drafting; caught at db push apply.
-- Per Sub-dispatch A hotfix lesson: every new migration that references a table MUST grep
-- the baseline-squash for the actual table name first.
--
-- WHY this migration exists:
-- Stripe's Connect Platform Agreement requires platform-level Terms of Service acceptance
-- separate from Stripe's own ToS (which is handled automatically by Embedded Components
-- onboarding). Mingla's Business platform ToS must be accepted before any Stripe Connect
-- operation can proceed for a brand. Pre-launch legal review will confirm exact disclosures.
--
-- This migration adds:
-- 1. brand_team_members.mingla_tos_accepted_at (TIMESTAMPTZ NULL) — when accepted, NULL = not yet
-- 2. brand_team_members.mingla_tos_version_accepted (TEXT NULL) — version string for audit
--    (versioning enables forced re-acceptance when ToS materially changes)
--
-- Sub-dispatch C Phase 12 ships the gate UI (MinglaToSAcceptanceGate component) that calls
-- an edge fn updating these columns. Sub-dispatch B's brand-stripe-onboard fn checks
-- brand_team_members.mingla_tos_accepted_at IS NOT NULL before any Stripe API call
-- (I-PROPOSED-U enforcement; checks the team-member row joining the calling user_id +
-- brand_id, where role IN ('account_owner', 'brand_admin', 'finance_manager') —
-- payment-managing ranks per the existing biz_can_manage_payments_for_brand RPC).
--
-- GRANDFATHER CLAUSE: existing brand_team_members rows that are accepted (accepted_at NOT
-- NULL) and not removed (removed_at IS NULL) are backfilled with placeholder acceptance
-- to avoid breaking existing brand admin workflows. Operator-side migration prompt at
-- first login post-V3-launch updates to current ToS version. Pending invitations
-- (accepted_at IS NULL) are NOT backfilled — they accept ToS as part of accepting their
-- invitation.

ALTER TABLE "public"."brand_team_members"
  ADD COLUMN IF NOT EXISTS "mingla_tos_accepted_at" timestamp with time zone NULL;

ALTER TABLE "public"."brand_team_members"
  ADD COLUMN IF NOT EXISTS "mingla_tos_version_accepted" text NULL;

-- Grandfather existing accepted+active rows: implicit acceptance of pre-V3 ToS at migration time.
-- Operator-side post-V3-launch flow prompts re-acceptance for current version.
-- Pending invitations (accepted_at IS NULL) are intentionally NOT backfilled.
UPDATE "public"."brand_team_members"
  SET
    "mingla_tos_accepted_at" = now(),
    "mingla_tos_version_accepted" = 'pre-v3-grandfathered'
  WHERE "accepted_at" IS NOT NULL
    AND "removed_at" IS NULL
    AND "mingla_tos_accepted_at" IS NULL;

COMMENT ON COLUMN "public"."brand_team_members"."mingla_tos_accepted_at" IS
  'When this team member accepted Mingla Business platform ToS. NULL=not accepted (Stripe Connect ops blocked per I-PROPOSED-U). Per D-V3-17.';

COMMENT ON COLUMN "public"."brand_team_members"."mingla_tos_version_accepted" IS
  'Version string of ToS accepted. Enables forced re-acceptance on material ToS changes. Pre-V3 rows grandfathered with "pre-v3-grandfathered"; operator prompts re-acceptance post-V3-launch.';
