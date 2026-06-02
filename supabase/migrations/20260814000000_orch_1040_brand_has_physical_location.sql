-- ORCH-1040 — per-brand "physical location" flag.
--
-- Gates the venue/listing surfaces (the "Add your venue" to-do + the "Venue
-- listing" management entry) so they only appear for brands that actually have a
-- bricks-and-mortar place to list on the consumer deck. Online-only brands,
-- event organizers and pop-ups never get nagged to add a venue.
--
-- Opt-in by design (operator decision 2026-06-01): every EXISTING brand defaults
-- to FALSE — no backfill from place_pool_id. Brands opt in via the toggle (brand
-- settings / creation); the venue-create + claim paths also set it true so a
-- brand that engages the physical flow stays consistent.
--
-- Additive + idempotent.

alter table public.brands
  add column if not exists has_physical_location boolean not null default false;

comment on column public.brands.has_physical_location is
  'ORCH-1040 — brand has a physical location customers visit. Gates the venue/'
  'listing to-dos + the listing management surface. Opt-in: defaults false; set '
  'via the brand toggle and auto-set true when a venue is created/claimed.';
