-- #4339 round B — the redesigned usemingla.com landing pages become ad
-- destinations: the seven Host landing pages (/host/<icp>) and the ten city
-- pages (/cities/<city>). Same shape and family as the Wave 4 marketing pages
-- (20271101003697_issue_3697_v14_control_plane.sql); ad_marketing_route_rows()
-- reads this registry, so the campaign builder lists them with no other change.
-- Ids and slugs match supabase/functions/_shared/adDestination.ts
-- MARKETING_ROUTES and mingla-marketing/lib/ad-marketing-routes.ts.
-- Idempotent: an existing row (by id or key) is left alone.

INSERT INTO public.ad_destination_registry (
  id, destination_family, destination_key, title, canonical_url, result_kind,
  app_key, os, status
) VALUES
  ('43390000-0001-4000-8000-000000000001','marketing_page','host-events','Mingla Host for Event organisers','https://usemingla.com/host/events','installs',NULL,NULL,'active'),
  ('43390000-0001-4000-8000-000000000002','marketing_page','host-trips','Mingla Host for Trip operators','https://usemingla.com/host/trips','installs',NULL,NULL,'active'),
  ('43390000-0001-4000-8000-000000000003','marketing_page','host-experiences','Mingla Host for Experience hosts','https://usemingla.com/host/experiences','installs',NULL,NULL,'active'),
  ('43390000-0001-4000-8000-000000000004','marketing_page','host-restaurants','Mingla Host for Restaurants','https://usemingla.com/host/restaurants','installs',NULL,NULL,'active'),
  ('43390000-0001-4000-8000-000000000005','marketing_page','host-hotels','Mingla Host for Hotels & resorts','https://usemingla.com/host/hotels','installs',NULL,NULL,'active'),
  ('43390000-0001-4000-8000-000000000006','marketing_page','host-art','Mingla Host for Galleries & art spaces','https://usemingla.com/host/art','installs',NULL,NULL,'active'),
  ('43390000-0001-4000-8000-000000000007','marketing_page','host-play','Mingla Host for Play & games','https://usemingla.com/host/play','installs',NULL,NULL,'active'),
  ('43390000-0001-4000-8000-000000000008','marketing_page','city-lagos','Things to do in Lagos','https://usemingla.com/cities/lagos','installs',NULL,NULL,'active'),
  ('43390000-0001-4000-8000-000000000009','marketing_page','city-durham-nc','Things to do in Durham','https://usemingla.com/cities/durham-nc','installs',NULL,NULL,'active'),
  ('43390000-0001-4000-8000-000000000010','marketing_page','city-cary-nc','Things to do in Cary','https://usemingla.com/cities/cary-nc','installs',NULL,NULL,'active'),
  ('43390000-0001-4000-8000-000000000011','marketing_page','city-raleigh-nc','Things to do in Raleigh','https://usemingla.com/cities/raleigh-nc','installs',NULL,NULL,'active'),
  ('43390000-0001-4000-8000-000000000012','marketing_page','city-new-york-city','Things to do in New York City','https://usemingla.com/cities/new-york-city','installs',NULL,NULL,'active'),
  ('43390000-0001-4000-8000-000000000013','marketing_page','city-brussels','Things to do in Brussels','https://usemingla.com/cities/brussels','installs',NULL,NULL,'active'),
  ('43390000-0001-4000-8000-000000000014','marketing_page','city-paris','Things to do in Paris','https://usemingla.com/cities/paris','installs',NULL,NULL,'active'),
  ('43390000-0001-4000-8000-000000000015','marketing_page','city-london','Things to do in London','https://usemingla.com/cities/london','installs',NULL,NULL,'active'),
  ('43390000-0001-4000-8000-000000000016','marketing_page','city-fort-lauderdale','Things to do in Fort Lauderdale','https://usemingla.com/cities/fort-lauderdale','installs',NULL,NULL,'active'),
  ('43390000-0001-4000-8000-000000000017','marketing_page','city-washington-dc','Things to do in Washington, DC','https://usemingla.com/cities/washington-dc','installs',NULL,NULL,'active')
ON CONFLICT DO NOTHING;
