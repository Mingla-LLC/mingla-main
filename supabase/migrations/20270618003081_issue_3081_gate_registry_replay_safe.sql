-- =====================================================================================
-- Issue #3081 — the #2489 gate registry must survive a replay.
--
-- WHAT BROKE. `public.issue_2489_gate_registry()` was a hardcoded VALUES list re-emitted
-- by every migration that added a carrier — 9 entries in
-- `20270523002489_issue_2489_address_privacy_server_gate.sql`, 10 in
-- `20270614002986_issue_2986_public_search_documents.sql`, which added
-- `public_search_source_facts`. #2489 ALSO carries the apply-time set-equality check,
-- ~1,500 lines after its own registry definition. So re-applying #2489 rewound the
-- registry to 9 and then compared it against a catalog that still held the tenth
-- carrier, and raised:
--
--   ERROR:  #2489: undeclared objects are carrying the shared gate: public_search_source_facts
--
-- `#2333`'s replay-safety step re-applies #2489 as its LAST file, by design, and nothing
-- re-applies #2986 after it. main went red 2026-09-02 20:22 and every merge was blocked.
-- The gate was RIGHT — at that instant an undeclared object really was carrying it. The
-- defect was that the declared set could be reverted by an older file.
--
-- THE FIX, and why it is this one. The registry is now APPEND-ONLY DATA
-- (`public.issue_2489_gate_carriers`), not a function body. A `CREATE OR REPLACE` can
-- revert code; nothing reverts a row. The set can therefore only grow under replay, in
-- any order, partial or full — so the check may stay exactly where it is, exactly as
-- strict as it is, and simply stops being able to observe a half-rewound registry.
--
-- WHY THIS FILE EXISTS SEPARATELY. #2489 and #2986 were edited in place, which only a
-- from-zero replay ever sees. A database that ALREADY applied them — production — would
-- never get the table. This migration is the forward path for those: it is a no-op on a
-- fresh replay (the table exists and already holds every row) and the real upgrade on an
-- applied one. It is deliberately idempotent end to end.
--
-- ADDING THE ELEVENTH CARRIER. One statement, in the same migration that adds the object:
--
--   INSERT INTO public.issue_2489_gate_carriers (object_name, object_kind)
--   VALUES ('your_new_object', 'function') ON CONFLICT (object_name) DO NOTHING;
--
-- Do NOT re-emit `issue_2489_gate_registry()` as a hardcoded list. Removing a carrier
-- means DELETEing its row in the same change that drops the gate from it.
-- =====================================================================================
BEGIN;

CREATE TABLE IF NOT EXISTS public.issue_2489_gate_carriers (
  object_name text PRIMARY KEY,
  object_kind text NOT NULL CHECK (object_kind IN ('function', 'view'))
);

-- A new table in `public` inherits default-privilege grants for anon, authenticated AND
-- service_role, and every table in this schema must carry RLS (#1860).
--
-- service_role IS NAMED IN THE REVOKE DELIBERATELY. Leaving it out does not leave it
-- read-only — it leaves the inherited `arwdDxtm` untouched and makes the GRANT SELECT
-- below a NO-OP, so any service-key holder could INSERT, UPDATE, DELETE or TRUNCATE the
-- carrier map; service_role also has rolbypassrls, so RLS would not stop it either. The
-- SQL text read correctly and the catalog disagreed: verified by reading relacl back
-- from a live apply, not from this file.
--
-- After the revoke, service_role holds SELECT and nothing else. No policy is defined:
-- every WRITER is the migration applier or a fixture, and both run as the owner, so the
-- set is never written or compared through RLS.
ALTER TABLE public.issue_2489_gate_carriers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.issue_2489_gate_carriers
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.issue_2489_gate_carriers TO service_role;

COMMENT ON TABLE public.issue_2489_gate_carriers IS
  '#2489 — the pinned set of objects required to carry the shared address-privacy '
  'gate, held as APPEND-ONLY DATA (#3081). Adding a gated object means INSERTing it '
  'here, ON CONFLICT DO NOTHING, in the same change that adds the object. Never '
  're-emit this set as a VALUES list from a function: that is what let an older '
  'migration revert a newer one''s extension on replay.';

-- All TEN carriers as of this migration: #2489's original nine plus #2986's
-- `public_search_source_facts`. ON CONFLICT DO NOTHING so a fresh replay — where
-- #2489 and #2986 already seeded every one of these — reaches this line as a no-op.
INSERT INTO public.issue_2489_gate_carriers (object_name, object_kind) VALUES
  ('issue_2489_public_theme',          'function'),
  ('business_public_events_view',      'view'),
  ('events_public_view',               'view'),
  ('pg_discover_business_events',      'function'),
  ('pg_public_brand_upcoming',         'function'),
  ('pg_public_event_by_slug',          'function'),
  ('pg_public_rsvp_by_slug',           'function'),
  ('pg_public_experience_by_slug',     'function'),
  ('pg_direct_event_checkout_bundle',  'function'),
  ('public_search_source_facts',       'function')
ON CONFLICT (object_name) DO NOTHING;

-- STABLE, not IMMUTABLE: the declared set is read from a table. Byte-identical to the
-- body #2489 now installs, so which of the two ran last cannot matter.
CREATE OR REPLACE FUNCTION public.issue_2489_gate_registry()
RETURNS TABLE (object_name text, object_kind text)
LANGUAGE sql
STABLE
SET search_path = ''
AS $function$
  SELECT r.object_name, r.object_kind FROM public.issue_2489_gate_carriers r
$function$;

COMMENT ON FUNCTION public.issue_2489_gate_registry() IS
  '#2489 — the pinned set of objects required to carry the shared address-privacy '
  'gate. Compared for SET EQUALITY, in both directions, against what the catalog '
  'actually references, at the end of a true-order full-chain replay. Adding a gated '
  'object means INSERTing it into public.issue_2489_gate_carriers in the same change '
  '(#3081); this function is a READER of that table and must never be re-emitted as a '
  'hardcoded list. Meaningful only to a reader that can see the table (owner or '
  'service_role); the fixture''s non-vacuity assertion pins that.';

REVOKE ALL ON FUNCTION public.issue_2489_gate_registry() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.issue_2489_gate_registry() TO anon, authenticated, service_role;

-- =====================================================================================
-- NO GATE CHECK LIVES IN THIS FILE, DELIBERATELY.
--
-- The set-equality check belongs in #2489 and stays there. It can only be evaluated on a
-- database where #2489 actually ran, because it compares the declared set against the
-- objects #2489 itself creates. Two migration-replay lanes — the #1931 private-event
-- access suite and the #2117 offering-visibility gate suite — deliberately SKIP #2489 by
-- exact filename while still replaying the rest of the chain, so the shared predicate,
-- the public-theme projection and the gated read paths do not exist there. A check in
-- THIS file would run on those lanes and raise "declared objects are not carrying the
-- shared gate" for every one of them — turning a correct skip into a false red, which is
-- the same mistake #3081 exists to fix, pointed at a different lane.
--
-- Those two lanes are named by ISSUE, not by workflow filename, deliberately: the CI
-- provider authority (#2148/#2591) discovers a workflow's external consumers by scanning
-- every tracked non-workflow file for `.y`+`ml` literals, so spelling a workflow filename
-- in this migration would register this SQL file as a CONSUMER of those two lanes, move
-- the frozen 73-record provider seal, and red eleven class-A gates. It did exactly that
-- once; the fix was to stop naming them, not to re-derive the seal.
--
-- This file therefore only guarantees the SHAPE of the registry: the table exists, holds
-- every carrier known at this version, and is what the function reads. Enforcement stays
-- with #2489 at apply time, and with the end-of-chain fixture (SC-25 in
-- `__tests__/issue_2489_address_privacy_server_gate.test.sql`, plus
-- `__tests__/issue_3081_gate_registry_replay.implementor.happy.test.sql`).
-- =====================================================================================

COMMIT;

NOTIFY pgrst, 'reload schema';
