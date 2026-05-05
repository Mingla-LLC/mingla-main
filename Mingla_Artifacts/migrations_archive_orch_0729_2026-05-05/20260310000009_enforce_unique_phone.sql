-- Migration: 20260310000009_enforce_unique_phone.sql
-- Enforces phone number uniqueness on profiles table.
-- Prevents multiple users from claiming the same verified phone number.

-- Step 1: Resolve any existing duplicates before adding the constraint.
-- Keeps the most recently updated profile's phone; NULLs the rest.
DO $$
DECLARE
  dup RECORD;
BEGIN
  FOR dup IN
    SELECT phone, array_agg(id ORDER BY updated_at DESC) AS ids
    FROM public.profiles
    WHERE phone IS NOT NULL
    GROUP BY phone
    HAVING COUNT(*) > 1
  LOOP
    UPDATE public.profiles
    SET phone = NULL, updated_at = NOW()
    WHERE phone = dup.phone
      AND id != dup.ids[1];
    RAISE NOTICE 'Resolved duplicate phone %: kept %, NULLed % others',
      dup.phone, dup.ids[1], array_length(dup.ids, 1) - 1;
  END LOOP;
END;
$$;

-- Step 2: Drop the old non-unique partial index (superseded by the unique constraint).
DROP INDEX IF EXISTS idx_profiles_phone;

-- Step 3: Add UNIQUE constraint on phone.
-- PostgreSQL allows multiple NULLs in UNIQUE columns (NULLs are not equal),
-- so users without a verified phone are unaffected.
ALTER TABLE public.profiles
ADD CONSTRAINT profiles_phone_unique UNIQUE (phone);
