-- Issue #3355 Wave B — the Feature Guide says Ari now reads the Feature Guide.
--
-- Forward-only content update (docs/runbooks/feature-guide.md) for the
-- existing ari-host-assistant entry; no claim, evidence or review date
-- changes here (the merge release record invalidates stale proof for the key
-- this PR names):
--   * Ari answers "how do I…" and "can Mingla…" from this guide, says Live
--     features as fact, hedges entries that need review, and says planned
--     ones are not available yet;
--   * Ari only sends a host to a Host app screen that exists, and explains
--     why something did not go through and what to do next.
--
-- Static SQL. Idempotent: the update applies only while the new wording is
-- not there yet.

BEGIN;

WITH saved AS (
  UPDATE public.product_capabilities c
     SET how_to = c.how_to || E'\n8. Ask Ari how to do something, or whether Mingla can do it. Ari answers from the Mingla Feature Guide and points you to the screen where you do it.',
         limitations = c.limitations || ' Ari''s answers about what Mingla can do come from the Feature Guide: a feature still being checked is described carefully with a pointer to its screen, and a planned feature is described as not available yet. If something does not go through, Ari says why and what to do next.',
         revision = c.revision + 1,
         updated_at = now()
   WHERE c.capability_key = 'ari-host-assistant'
     AND position('Ari answers from the Mingla Feature Guide' IN c.how_to) = 0
  RETURNING c.id, c.revision
)
INSERT INTO public.product_truth_audit(action, capability_id, metadata)
SELECT 'capability_saved', id,
       jsonb_build_object('source','issue_3355_feature_guide_wave_b','issue',3355,
         'capability_key','ari-host-assistant','revision',revision)
  FROM saved;

COMMIT;
