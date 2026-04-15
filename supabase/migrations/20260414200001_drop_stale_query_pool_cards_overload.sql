-- Drop stale query_pool_cards overload with p_pref_updated_at parameter.
--
-- The dead code cleanup migration (20260412400003) was supposed to drop this,
-- but the DROP didn't execute on production (migration applied via execute_sql
-- which ran the CREATE OR REPLACE but the DROP targeted a different signature).
--
-- This stale overload causes PostgreSQL ambiguous function resolution when the
-- edge function calls query_pool_cards via PostgREST with named parameters —
-- both overloads match (the old one has p_pref_updated_at with a DEFAULT),
-- so PostgreSQL refuses to pick one and returns an error. The edge function's
-- catch block silently swallows the error and returns zero cards.
--
-- The old overload also references the deleted user_card_impressions system
-- and lacks the ORCH-0421 price-exempt category logic.

DROP FUNCTION IF EXISTS public.query_pool_cards(
  UUID, TEXT[],
  DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION,
  INTEGER, TEXT, TEXT,
  TIMESTAMPTZ,  -- p_pref_updated_at (the distinguishing parameter)
  UUID[], INTEGER, TEXT[], TEXT[],
  DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION
);
