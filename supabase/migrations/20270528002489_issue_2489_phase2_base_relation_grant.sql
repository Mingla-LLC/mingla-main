-- =====================================================================================
-- Issue #2489, PHASE 2 — close the base relation.
--
-- WHAT PHASE 1 DID: gated nine derived read paths so that a host who turns on
-- "Hide address until ticket purchase" is not relying on a renderer to keep that
-- promise. Every one of those objects now withholds correctly.
--
-- WHAT PHASE 1 COULD NOT DO: an unauthenticated caller never had to go through a
-- derived read path. The `anon` role holds SELECT on the base relation itself, and the
-- public-read policy on it carries no column restriction, so the withheld values were
-- still one direct read away. Worse, they were recoverable WITHOUT being selected: a
-- caller with SELECT on a column may put that column in a WHERE clause, so a range
-- predicate is a search oracle for the value. A projection gate on a derived object
-- cannot close either vector.
--
-- =====================================================================================
-- THE CORRECTION THAT MATTERS. READ THIS BEFORE CHANGING ANY LINE BELOW.
--
-- The obvious form of this fix is a column-level revoke:
--
--     REVOKE SELECT (location_geo, location_text) ON public.events FROM anon;   -- WRONG
--
-- That statement is a NO-OP here, and it is a no-op silently. A column-level revoke
-- only removes a column-level grant. While the role still holds the TABLE-level SELECT
-- privilege — which `anon` does — the table-level grant continues to authorise every
-- column, including the ones just "revoked". Verified both directions on a disposable
-- PostgreSQL 17 cluster: with a table-level grant in place, revoking a column and then
-- selecting it returns the value.
--
-- Shipped as written, that statement would have applied cleanly, exited zero, passed a
-- textual review, and changed nothing at all.
--
-- The correct shape is the one below: remove the TABLE-level grant, then grant back
-- exactly the columns anonymous consumers are proven to need. `REVOKE SELECT ON <table>`
-- also clears any column-level grants the role held, so this file is idempotent.
-- =====================================================================================
--
-- ORDERING: strictly greater than 20270527002592, which is simultaneously the highest
-- local migration, the highest across every sibling worktree under ~/Desktop/mingla-orchs,
-- and the remote history head. Re-scan before re-timestamping; parallel sessions claim
-- versions at any time.
--
-- DEPLOY: `supabase db push` is FORBIDDEN for this change. Production migration history
-- has drifted — unapplied migrations belonging to unrelated issues sit below this one,
-- plus one malformed history row — and a push would carry all of them into production as
-- a side effect of a privacy fix. Apply THIS FILE'S SQL alone, then insert only its
-- history row. A deploy command's exit code is not evidence: re-read the grants and the
-- view reloption afterwards and confirm them.
-- =====================================================================================

BEGIN;

-- =====================================================================================
-- 1 — THE TWO CALLER-RIGHTS VIEWS. These must be handled BEFORE the grant change, or
--     the grant change takes anonymous browsing down with it.
--
-- A view marked `security_invoker = true` runs with the CALLER's privileges. That has a
-- consequence which is easy to miss and expensive to discover in production:
--
--   an invoker view fails ENTIRELY — permission denied on the base table — when its
--   BODY references a column the caller may not select, even if the caller's own query
--   never projects that column, and even if the column appears only in the view's WHERE.
--
-- Verified on a disposable cluster: an invoker view selecting `id, pub, secret` raised
-- 42501 for a caller asking only for `pub`. The permission check is against the view's
-- rangetable, not the outer projection.
--
-- Two anon-granted invoker views over this relation reference the withheld columns in
-- their bodies. Both would have gone dark the instant the grant changed. Each is handled
-- on its own merits below — NOT with one blanket rule, because they are not the same
-- kind of object.
-- =====================================================================================

-- -------------------------------------------------------------------------------------
-- 1a — events_public_view: flip to owner rights, which it can afford, because it is
--      already gated.
--
-- Phase 1 rewrote this view WITH the address-privacy gate but left it caller-rights.
-- Owner rights make it immune to the grant change; the gate it already carries is what
-- keeps that safe. Flipping a view from caller to owner rights normally WIDENS what it
-- returns, because the view stops inheriting the base relation's row-level policies — so
-- that widening is checked rather than assumed:
--
--   this view's own WHERE:  deleted_at IS NULL
--                       AND visibility = 'public'
--                       AND status IN ('scheduled','live')
--                       AND NOT <the private-event block predicate>
--
--   the anon read policy:   deleted_at IS NULL
--                       AND visibility = 'public'
--                       AND status IN ('scheduled','live','ended','cancelled')
--                       AND NOT <the same private-event block predicate>
--
-- The view's own WHERE is a strict SUBSET of the policy on every conjunct — identical on
-- three of them and narrower on the status list. Owner rights therefore return anonymous
-- callers a subset of what caller rights returned. This flip cannot widen anonymous
-- visibility. The self-check at the end of this file re-derives that rather than trusting
-- this comment.
--
-- ALTER VIEW is used deliberately in place of CREATE OR REPLACE VIEW: it changes the
-- reloption and NOTHING else, so the gated body Phase 1 shipped cannot be silently
-- altered, reordered or dropped by a re-statement of it here.
-- -------------------------------------------------------------------------------------
ALTER VIEW public.events_public_view SET (security_invoker = false);

COMMENT ON VIEW public.events_public_view IS
  '#2489 — anon-readable event read model. location_text, location_geo and the theme''s '
  'business_event.location.address are withheld whenever '
  'issue_2489_address_withheld(theme) is true, and the host''s unpublished business_draft '
  'blob is stripped unconditionally. Phase 2: OWNER rights (security_invoker=false). It '
  'no longer inherits the base relation''s row policies, so its own WHERE is the whole '
  'row filter — that WHERE is a strict subset of the anonymous read policy and must stay '
  'that way. Do not re-emit this view without the gate, do not re-implement the predicate '
  'inline, and do not restore caller rights: caller rights would make this view fail '
  'closed-with-an-error for anon, because its body references columns anon may no longer '
  'select.';

-- -------------------------------------------------------------------------------------
-- 1b — events_with_master_date_view: withdraw the anonymous read instead.
--
-- The opposite call, for opposite reasons. This view is `SELECT e.*` with a master-date
-- join and NO WHERE CLAUSE AT ALL — every row it filters is filtered by the caller's
-- row-level policies and nothing else. Giving it owner rights would hand anonymous
-- callers every deleted, private and unpublished offering in the table. It is exactly
-- the view that must NOT be flipped.
--
-- It is also, today, ungated: it projects the exact pin, the combined address string and
-- the raw theme with no privacy gate, to anyone anonymous. It is a door Phase 1 did not
-- enumerate.
--
-- Its anonymous grant was never deliberate. #1856 recorded it in source as a
-- default-privilege artefact that predated that migration, kept only so that #1856
-- changed no read, and flagged in that file's own words as not blessed. Its three
-- readers are a signed-in group-chat surface, a service-role edge function, and a
-- signed-in business surface — none anonymous.
--
-- This REVOKE adds NO breakage that the grant change in section 2 would not have caused
-- anyway: as a caller-rights view whose body reads the withheld columns, it stops
-- serving anonymous callers either way. The difference is that this way it stops
-- deliberately, in a reviewable line, with a reason — instead of by raising a permission
-- error nobody chose.
-- -------------------------------------------------------------------------------------
REVOKE SELECT ON public.events_with_master_date_view FROM anon;

COMMENT ON VIEW public.events_with_master_date_view IS
  '#2489 phase 2 — NOT an anonymous read surface. This view has no WHERE clause and no '
  'address-privacy gate; it relies entirely on the caller''s row-level policies. Its anon '
  'SELECT was a default-privilege artefact (#1856) with no anonymous caller, and was '
  'withdrawn. Its readers are signed-in or service-role. Do not grant SELECT on it to '
  'anon, and do not give it owner rights — with no WHERE clause, owner rights would '
  'publish every deleted, private and unpublished offering.';

-- =====================================================================================
-- 2 — THE GRANT CHANGE.
--
-- The withheld set is stated ONCE, here, as the exception list. The permitted set is
-- derived from the catalog rather than typed out, so it cannot drift from the table as
-- the table changes, and so this file states a POLICY ("everything except these") rather
-- than a snapshot that silently rots.
--
-- WHAT IS WITHHELD, AND WHY ONLY THESE TWO:
--
--   location_geo   the exact venue coordinate.
--   location_text  the combined "<venue> · <street>" string.
--
-- WHAT IS DELIBERATELY *NOT* WITHHELD, stated plainly so nobody reads this file as
-- closing more than it closes:
--
--   theme          NOT withheld, and this leaves a real residual: the structured street
--                  address lives at business_event.location.address inside this column,
--                  so an anonymous caller can still read the street of a gated offering
--                  directly off the base relation, and can still read the host's
--                  unpublished business_draft blob.
--
--                  It is not withheld because two live anonymous buyer-web routes — the
--                  trip detail resolver and the experience detail resolver — read this
--                  column and cannot render without it. Phase 1 narrowed both from a
--                  star-select to an explicit column list, which is what makes THEM
--                  immune to the two withholds above; it does not make them immune to
--                  this one. Rerouting them would mean building new anonymous read
--                  surface, because the gated objects that could serve a scrubbed theme
--                  either do not carry trips at all or would withhold a trip's address
--                  that is legitimately public. That is a change with its own design,
--                  its own tests and its own deploy — not a line in this file.
--
--                  Withholding it here would have 42501'd both routes for every
--                  anonymous visitor. Trading a partial disclosure for a customer-facing
--                  outage on live revenue routes is not a trade this migration makes.
--
--   city_geo       the privacy-SAFE city centroid. Exempt by design, and the gated read
--                  paths return it unconditionally.
--
--   departure_geo / departure_text
--                  the trip privacy model, which has no hide-until-ticket concept and is
--                  explicitly out of this issue's scope.
--
-- SCOPE LIMIT, stated explicitly: this closes the ANONYMOUS disclosure. The public read
-- policy names authenticated as well and carries no auth.uid() check, so anyone with a
-- free account can still read these columns off the base relation. `authenticated` is
-- how hosts edit their own offerings, so it is deliberately untouched here. #2489 must
-- not be read as "address privacy enforced" — it is "address privacy enforced against
-- unauthenticated callers".
--
-- A PROPERTY WORTH KNOWING BEFORE YOU ADD A COLUMN: after this change, a column added to
-- this table in a later migration is NOT granted to anon until someone grants it. That
-- fails CLOSED, which is the correct default for a relation carrying location data — but
-- it does mean a new column is invisible to anonymous readers until deliberately opened.
-- =====================================================================================
DO $issue_2489_phase2_grant$
DECLARE
  -- Stated once. Everything not in here is granted.
  v_withheld  text[] := ARRAY['location_geo', 'location_text'];
  v_permitted text;
  v_count     integer;
BEGIN
  SELECT string_agg(format('%I', a.attname), ', ' ORDER BY a.attnum), count(*)
    INTO v_permitted, v_count
  FROM pg_catalog.pg_attribute a
  WHERE a.attrelid = 'public.events'::regclass
    AND a.attnum > 0
    AND NOT a.attisdropped
    AND a.attname <> ALL (v_withheld);

  -- Vacuity guard. If the exception list ever stops naming real columns — a rename, a
  -- typo — the derivation above still succeeds and grants EVERY column, and this file
  -- becomes the second silent no-op in this issue's history. Refuse instead.
  IF (SELECT count(*)
        FROM pg_catalog.pg_attribute a
       WHERE a.attrelid = 'public.events'::regclass
         AND a.attnum > 0
         AND NOT a.attisdropped
         AND a.attname = ANY (v_withheld)) <> cardinality(v_withheld) THEN
    RAISE EXCEPTION
      '#2489 phase 2 VACUITY: the withheld list does not resolve to that many live columns on public.events — this migration would grant everything and close nothing';
  END IF;

  IF v_count < 10 THEN
    RAISE EXCEPTION
      '#2489 phase 2 VACUITY: only % columns resolved as permitted — refusing to strip the anonymous read surface to nothing', v_count;
  END IF;

  -- Removes the table-level privilege AND every column-level privilege the role held,
  -- which is what makes the pair below idempotent.
  EXECUTE 'REVOKE SELECT ON public.events FROM anon';
  EXECUTE format('GRANT SELECT (%s) ON public.events TO anon', v_permitted);

  RAISE NOTICE '#2489 phase 2: anon holds column SELECT on % of % columns on public.events; % withheld',
    v_count, v_count + cardinality(v_withheld), array_to_string(v_withheld, ', ');
END $issue_2489_phase2_grant$;

COMMENT ON COLUMN public.events.location_geo IS
  '#2489 — the exact venue coordinate. NOT granted to anon. Anonymous callers reach a '
  'location only through a gated read path. Restoring a table-level SELECT grant to anon '
  'on this relation silently re-opens this column, the combined address string, and the '
  'ability to recover either by filtering on it.';

COMMENT ON COLUMN public.events.location_text IS
  '#2489 — the combined "<venue> · <street>" string. NOT granted to anon. See the note on '
  'location_geo.';

COMMIT;

-- =====================================================================================
-- 3 — POST-APPLY SELF-CHECK. Outside the transaction, so the recorded state is the
--     committed state and not something a later rollback could take back.
--
-- This is not a substitute for the behavioural fixture in
-- supabase/migrations/__tests__/issue_2489_phase2_base_relation_grant.test.sql — that
-- file performs real anonymous reads. This block exists so that an operator applying
-- this SQL by hand, against a drifted history, on a deploy path where `db push` is
-- forbidden, gets a verdict from the database instead of from an exit code.
-- =====================================================================================
DO $issue_2489_phase2_verify$
DECLARE
  v_withheld text[] := ARRAY['location_geo', 'location_text'];
  v_col      text;
  v_missing  text[] := ARRAY[]::text[];
BEGIN
  IF has_table_privilege('anon', 'public.events', 'SELECT') THEN
    RAISE EXCEPTION
      '#2489 phase 2 FAILED: anon still holds TABLE-level SELECT on public.events. Every column-level revoke on this relation is a no-op while that is true — which is the exact defect this migration exists to correct.';
  END IF;

  FOREACH v_col IN ARRAY v_withheld LOOP
    IF has_column_privilege('anon', 'public.events', v_col, 'SELECT') THEN
      RAISE EXCEPTION '#2489 phase 2 FAILED: anon can still select public.events.%', v_col;
    END IF;
  END LOOP;

  -- Anti-vacuity. A revoke that closes the hole by closing the product is an outage.
  -- These are columns anonymous browsing demonstrably needs; if any is missing, the
  -- derivation went wrong and public pages are about to start erroring.
  FOREACH v_col IN ARRAY ARRAY['id','brand_id','title','slug','status','visibility','theme','city_geo','cover_media_url','event_type','deleted_at'] LOOP
    IF NOT has_column_privilege('anon', 'public.events', v_col, 'SELECT') THEN
      v_missing := array_append(v_missing, v_col);
    END IF;
  END LOOP;
  IF cardinality(v_missing) > 0 THEN
    RAISE EXCEPTION
      '#2489 phase 2 FAILED: anonymous browsing lost columns it needs: %', array_to_string(v_missing, ', ');
  END IF;

  -- The roles this migration must NOT have touched.
  IF NOT has_table_privilege('authenticated', 'public.events', 'SELECT') THEN
    RAISE EXCEPTION
      '#2489 phase 2 FAILED: authenticated lost SELECT on public.events. Hosts author their own offerings through that role; this migration is scoped to anon.';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.events', 'SELECT') THEN
    RAISE EXCEPTION '#2489 phase 2 FAILED: service_role lost SELECT on public.events';
  END IF;

  -- The two views from section 1.
  IF (SELECT COALESCE(
        (SELECT o FROM unnest(c.reloptions) o WHERE o LIKE 'security_invoker%'),
        'security_invoker=false')
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname = 'events_public_view')
     NOT IN ('security_invoker=false') THEN
    RAISE EXCEPTION
      '#2489 phase 2 FAILED: events_public_view is not on owner rights. On caller rights it raises permission denied for every anonymous reader, because its body reads the withheld columns.';
  END IF;

  IF has_table_privilege('anon', 'public.events_with_master_date_view', 'SELECT') THEN
    RAISE EXCEPTION
      '#2489 phase 2 FAILED: anon still holds SELECT on events_with_master_date_view — an ungated, WHERE-less projection of this relation';
  END IF;

  RAISE NOTICE '#2489 phase 2 VERIFIED: anon holds no table-level SELECT on public.events; % withheld; anonymous browsing columns intact; authenticated and service_role untouched',
    array_to_string(v_withheld, ', ');
END $issue_2489_phase2_verify$;
