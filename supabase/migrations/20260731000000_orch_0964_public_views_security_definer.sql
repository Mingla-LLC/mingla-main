-- ORCH-0964: restore anonymous (logged-out) access to public brand + event pages.
--
-- PROBLEM
-- Anonymous visitors hit "could not load" on /b/{slug} and /e/{brand}/{event}.
-- The public views `claimed_venues_public_view` and `business_public_events_view`
-- were set to `security_invoker = true`, so they execute as the *calling* role.
-- An anonymous visitor therefore needs direct SELECT on every underlying table.
-- Every table the views read already grants SELECT to `anon` (events, event_dates,
-- brand_hours, place_pool, ticket_types) EXCEPT `brands` — so PostgREST returned
-- `42501 permission denied for table brands` (HTTP 401) for every anonymous load.
--
-- FIX
-- Run these two views as their OWNER (security-definer), matching the already-
-- working sibling `business_public_brands_view` (which is security-definer and
-- loads fine for anon). Anonymous visitors then read only the view's scoped,
-- public-safe output and never touch the `brands` table directly. This is the
-- safest option: `brands` holds sensitive columns (Stripe connect/payout flags,
-- contact email/phone, account internals), and the broad "Public can read non-
-- deleted brands" RLS policy means granting anon direct table access would let
-- anyone with the public anon key harvest that data. Security-definer avoids any
-- direct anon access to `brands`; the views' own WHERE clauses scope the rows:
--   * claimed_venues_public_view  -> deleted_at IS NULL AND claim_status = 'verified'
--   * business_public_events_view -> non-deleted public events on non-deleted brands
--
-- No CI gate or invariant requires security_invoker on these views.

ALTER VIEW public.claimed_venues_public_view SET (security_invoker = false);
ALTER VIEW public.business_public_events_view SET (security_invoker = false);
