-- Issue #4398 (Work board v3), migration 4 of 4: the one-time clear-up (spec
-- v3 section 3). Every Work update already sent is marked read for everyone,
-- so every list starts at zero under the new notification rules.
--
-- APPLY ONLY ON SETH'S GO. This is a one-time production data change, kept
-- in its own file so it can be applied (or held) separately from the schema
-- migrations 20280626004398 to 20280626034398. It touches team_mentions
-- read_at only, for Work card, due and Admin activity notices; team chat
-- mentions (unread in their chats) and content calendar comments are left as
-- they are.
--
-- ROLLBACK: none needed for correctness (read_at only). The rows marked here
-- carry read_at = the time of this migration, so they can be found.

BEGIN;

UPDATE public.team_mentions SET read_at = now()
 WHERE read_at IS NULL AND source_kind IN ('work_card', 'work_due', 'ops_activity');

COMMIT;
