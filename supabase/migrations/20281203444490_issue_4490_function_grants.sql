-- Issue #4490: one explicit grant decision for the venue functions.
--
-- Spec 06 W3 fix round 1. Every function a #4490 migration creates or
-- re-emits falls in one class, and the pg17 suite
-- issue_4490_function_grants.implementor.pg17.test.sql holds the full list:
--   public read  - anon and authenticated (each one is listed, with its
--                  reason, in supabase/security/anon_executable_definer_allowlist.txt);
--   signed-in    - authenticated only (the function checks who is calling);
--   internal     - called only by other database functions or the service
--                  role (triggers included);
--   helper       - SECURITY INVOKER helpers, which run with the caller's own
--                  rights.
-- A function that is only revoked from PUBLIC keeps the schema's default
-- grants, so every decision here names its roles.
--
-- Number: 20281203444490 sits between 20281203434490 (W3 deck facts) and the
-- 20281203504490..594490 block that spec 08 reserves (the same spare-slot
-- form as 20281203354490).
-- Static SQL. Local stack only until Seth approves a production migration.

BEGIN;
SET LOCAL lock_timeout = '5s';

-- Internal: called by other database functions (or the service role) only.
-- (The two table-hold helpers keep spec 07's authenticated grant.)
REVOKE ALL ON FUNCTION
  public.issue_4490_allocate_member_code(uuid),
  public.issue_4490_member_code_candidate(),
  public.issue_4490_feature_needs(uuid, text),
  public.issue_4490_offer_hours_check(uuid),
  public.issue_4490_table_service_date(uuid, timestamptz),
  public.issue_4490_venue_service_date(uuid, timestamptz),
  public.issue_4490_forget_feature_pause(),
  public.issue_4490_lock_plan_period(),
  public.issue_4490_sync_member_desk(),
  public.issue_4490_validate_plan_desks()
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.issue_4490_allocate_member_code(uuid),
  public.issue_4490_member_code_candidate(),
  public.issue_4490_feature_needs(uuid, text),
  public.issue_4490_offer_hours_check(uuid),
  public.issue_4490_table_service_date(uuid, timestamptz),
  public.issue_4490_venue_service_date(uuid, timestamptz),
  public.issue_4490_forget_feature_pause(),
  public.issue_4490_lock_plan_period(),
  public.issue_4490_sync_member_desk(),
  public.issue_4490_validate_plan_desks()
TO service_role;

-- Public reads of the venue page and its booking panes (signed out included);
-- each is listed in the anon allowlist with its reason.
REVOKE ALL ON FUNCTION
  public.pg_public_venue_page(text, text),
  public.pg_venue_available_slots(date, integer, uuid, uuid, uuid),
  public.pg_venue_available_tables(uuid, date, integer, timestamptz, uuid),
  public.pg_venue_hire_options(uuid, uuid, integer),
  public.pg_venue_hour_day(uuid, date, integer, uuid),
  public.pg_venue_offer_availability(uuid, date, date, integer, uuid),
  public.pg_deck_venue_facts(uuid[])
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  public.pg_public_venue_page(text, text),
  public.pg_venue_available_slots(date, integer, uuid, uuid, uuid),
  public.pg_venue_available_tables(uuid, date, integer, timestamptz, uuid),
  public.pg_venue_hire_options(uuid, uuid, integer),
  public.pg_venue_hour_day(uuid, date, integer, uuid),
  public.pg_venue_offer_availability(uuid, date, date, integer, uuid),
  public.pg_deck_venue_facts(uuid[])
TO anon, authenticated, service_role;

COMMIT;

-- Reverse (local use only): re-grant EXECUTE on the ten internal functions
-- to anon and authenticated; the public reads keep their grants.
