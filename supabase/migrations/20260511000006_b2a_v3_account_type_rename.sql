-- B2a Path C V3 — rename stripe_connect_accounts.account_type → controller_dashboard_type
-- Per outputs/SPEC_B2_PATH_C_V3.md §2 D-V3-14.
-- Per Stripe best-practices audit C18 (terminology drift).
--
-- WHY this migration exists:
-- Stripe explicitly states: "Don't use the terms 'Standard', 'Express', or 'Custom' as
-- account types. These are legacy categories that bundle together responsibility, dashboard,
-- and requirement decisions into opaque labels. Controller properties give explicit control
-- over each dimension."
-- (https://docs.stripe.com/connect/accounts-v2)
--
-- The original column name `account_type` reflects Stripe's deprecated terminology. The
-- value 'express' is actually the controller.stripe_dashboard.type setting (a dashboard
-- access level), NOT a Stripe legacy account type.
--
-- Per D-V3-14, rename column to `controller_dashboard_type` to align Mingla's schema with
-- current Stripe controller-property terminology. Cascading code updates (edge fns, services,
-- TS types) ship in Sub-dispatch B + C — this migration is just the schema rename.

ALTER TABLE "public"."stripe_connect_accounts"
  RENAME COLUMN "account_type" TO "controller_dashboard_type";

COMMENT ON COLUMN "public"."stripe_connect_accounts"."controller_dashboard_type" IS
  'Stripe controller.stripe_dashboard.type value (full|express|none). Renamed from "account_type" 2026-05-06 per D-V3-14 to align with Stripe Accounts v2 controller-property terminology. Pre-V3 code referenced this column as account_type; Sub-dispatch B/C update all references.';
