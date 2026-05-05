-- Migration: 20260309000006_fix_referral_code_length.sql
-- Description: MED-002 fix — Extend referral codes from 8 to 12 hex chars to push
-- birthday-paradox 50% collision threshold from ~77K to ~20M users.
-- Also adds retry loop to the trigger to handle any remaining collisions.

-- 1. Update existing 8-char codes to 12-char codes
UPDATE public.profiles
SET referral_code = 'MGL-' || UPPER(SUBSTR(MD5(id::text || created_at::text || random()::text), 1, 12))
WHERE referral_code IS NOT NULL AND LENGTH(referral_code) <= 12;

-- 2. Replace the trigger function with retry loop + longer code
CREATE OR REPLACE FUNCTION public.generate_referral_code()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  candidate TEXT;
  max_attempts INTEGER := 10;
  attempt INTEGER := 0;
BEGIN
  IF NEW.referral_code IS NULL THEN
    LOOP
      attempt := attempt + 1;
      candidate := 'MGL-' || UPPER(SUBSTR(MD5(NEW.id::text || clock_timestamp()::text || random()::text), 1, 12));
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.profiles WHERE referral_code = candidate);
      IF attempt >= max_attempts THEN
        RAISE EXCEPTION 'Unable to generate unique referral code after % attempts', max_attempts;
      END IF;
    END LOOP;
    NEW.referral_code := candidate;
  END IF;
  RETURN NEW;
END;
$$;
