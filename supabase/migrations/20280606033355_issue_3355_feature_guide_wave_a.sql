-- Issue #3355 Wave A — the Feature Guide says what Ari and Brand profile now do.
--
-- Forward-only content update (docs/runbooks/feature-guide.md) for two
-- existing entries; no claim, evidence or review date changes here (the merge
-- release record invalidates stale proof for the keys this PR names):
--   * ari-host-assistant — asking for something else mid-setup pauses the
--     setup with a Resume choice; a setup idle for a day closes; stated
--     values (code, percentage, end date, use limit) reach the card or Ari
--     asks.
--   * brand-profile — the Time zone field, and the automatic zone for a
--     single-zone country.
--
-- Static SQL. Idempotent: each update applies only while the old wording is
-- still there.

BEGIN;

WITH saved AS (
  UPDATE public.product_capabilities c
     SET how_to = c.how_to || E'\n7. If you ask for something else while Ari is walking you through a setup, Ari pauses the setup and helps with the new request first. Tap Resume to carry on where you left off. A setup left untouched for a day is closed, and you can start it again anytime.',
         limitations = c.limitations || ' Details you give in a request, such as a discount code, percentage, end date or use limit, are carried onto the confirmation card; if one does not match, Ari asks before preparing the card. An end date such as "until 19 December" ends at 11:59 pm that day in the brand''s time zone.',
         revision = c.revision + 1,
         updated_at = now()
   WHERE c.capability_key = 'ari-host-assistant'
     AND position('Ari pauses the setup' IN c.how_to) = 0
  RETURNING c.id, c.revision
)
INSERT INTO public.product_truth_audit(action, capability_id, metadata)
SELECT 'capability_saved', id,
       jsonb_build_object('source','issue_3355_feature_guide_wave_a','issue',3355,
         'capability_key','ari-host-assistant','revision',revision)
  FROM saved;

WITH saved AS (
  UPDATE public.product_capabilities c
     SET how_to = replace(c.how_to, 'cover, theme, address, social links',
                          'cover, theme, address, time zone, social links'),
         limitations = c.limitations || ' A brand in a country with one time zone, such as Nigeria or the United Kingdom, gets that time zone automatically; choose a different one under Time zone in Edit brand. The Time zone field reaches the iOS and Android apps with an approved app release.',
         revision = c.revision + 1,
         updated_at = now()
   WHERE c.capability_key = 'brand-profile'
     AND position('time zone' IN c.limitations) = 0
  RETURNING c.id, c.revision
)
INSERT INTO public.product_truth_audit(action, capability_id, metadata)
SELECT 'capability_saved', id,
       jsonb_build_object('source','issue_3355_feature_guide_wave_a','issue',3355,
         'capability_key','brand-profile','revision',revision)
  FROM saved;

COMMIT;
