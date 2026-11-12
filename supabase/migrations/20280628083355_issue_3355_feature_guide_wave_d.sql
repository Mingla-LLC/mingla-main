-- Issue #3355 Wave D — the Feature Guide says Ari remembers and can ask the
-- Mingla team.
--
-- Forward-only content update (docs/runbooks/feature-guide.md) for the
-- existing ari-host-assistant entry; no claim, evidence or review date
-- changes here (the merge release record invalidates stale proof for the key
-- this PR names):
--   * Ari keeps short notes (corrections, preferences, facts) for later
--     chats; the host sees and deletes them in Ari settings > What Ari
--     remembers; a brand note is shared with the brand's team; Ari never
--     keeps contact, card, bank, password or ID details;
--   * when a host is stuck, Ari changes approach and offers "Ask the Mingla
--     team", which posts a short summary in the brand's group chat only after
--     the host confirms it.
--
-- Static SQL. Idempotent: the update applies only while the new wording is
-- not there yet.

BEGIN;

WITH saved AS (
  UPDATE public.product_capabilities c
     SET how_to = c.how_to || E'\n9. Tell Ari a correction or a preference and it keeps a short note for later chats. See or delete notes in Ari settings > What Ari remembers.\n10. If Ari can''t sort something out, tap Confirm on "Ask the Mingla team" and Ari posts a short summary in your brand group chat.',
         limitations = c.limitations || ' Ari''s notes are short; a note shared with the brand is visible to everyone on the brand''s team, and Ari never keeps emails, phone numbers, card or bank details, passwords or ID numbers. "Ask the Mingla team" posts only after you confirm it, at most once an hour from the same chat.',
         revision = c.revision + 1,
         updated_at = now()
   WHERE c.capability_key = 'ari-host-assistant'
     AND position('What Ari remembers' IN c.how_to) = 0
  RETURNING c.id, c.revision
)
INSERT INTO public.product_truth_audit(action, capability_id, metadata)
SELECT 'capability_saved', id,
       jsonb_build_object('source','issue_3355_feature_guide_wave_d','issue',3355,
         'capability_key','ari-host-assistant','revision',revision)
  FROM saved;

COMMIT;
