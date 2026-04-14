ALTER TABLE public.place_pool
  ADD COLUMN IF NOT EXISTS is_claimed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS claimed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_place_pool_claimed_by
  ON public.place_pool (claimed_by) WHERE claimed_by IS NOT NULL;
