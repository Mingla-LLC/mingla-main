-- Clear today's discover_daily_cache rows so the edge function re-generates
-- cards with the new 2-hero side-by-side layout.
-- The us_date_key for today (March 2, 2026 US Eastern) is '2026-03-02'.
DELETE FROM discover_daily_cache
WHERE us_date_key = '2026-03-02';
