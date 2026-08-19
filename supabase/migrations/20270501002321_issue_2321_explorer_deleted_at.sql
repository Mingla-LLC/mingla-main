-- #2321 — profiles.explorer_deleted_at. The ORCH-1240 migration (20261128000000)
-- that first defined this column was never applied to production; its FK half is
-- deferred to the migration-drift triage issue. Column only, idempotent.
--
-- Version prefix note: the SPEC named 20270425002321, but current main and sibling
-- worktrees now reach 20270430002305. The monotonic-prefix rule (strictly greater
-- than every local, remote and sibling-worktree prefix) requires a later stamp, so
-- this ships as 20270501002321. Same content, same issue.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS explorer_deleted_at timestamptz NULL;

COMMENT ON COLUMN public.profiles.explorer_deleted_at IS
  'Set when the user deletes their explorer/consumer side. Auth login may remain while the business side is active (#668, repaired #2321).';
