-- Add preparing/ready/failed_preparing statuses to seeding_runs
-- Enables strict 2-phase workflow: prepare all batches first, then approve one by one.
--
-- New lifecycle: preparing → ready → running ⇄ paused → completed
--                preparing → failed_preparing (if batch creation fails)
--                ready/running/paused → cancelled

-- Drop the old CHECK and add the expanded one
ALTER TABLE public.seeding_runs DROP CONSTRAINT IF EXISTS seeding_runs_status_check;
ALTER TABLE public.seeding_runs ADD CONSTRAINT seeding_runs_status_check
  CHECK (status IN ('preparing', 'ready', 'running', 'paused', 'completed', 'cancelled', 'failed_preparing'));

-- Migrate any existing 'pending' rows to 'ready' (they already have all batches created)
UPDATE public.seeding_runs SET status = 'ready' WHERE status = 'pending';
