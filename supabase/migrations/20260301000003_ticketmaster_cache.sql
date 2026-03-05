-- Ticketmaster events cache table
-- Stores Ticketmaster API responses to reduce API calls and improve latency.
-- Cache entries expire after 2 hours by default.

CREATE TABLE IF NOT EXISTS ticketmaster_events_cache (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  cache_key TEXT NOT NULL UNIQUE,
  events JSONB NOT NULL DEFAULT '[]',
  total_results INTEGER NOT NULL DEFAULT 0,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '2 hours'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_tm_cache_key ON ticketmaster_events_cache(cache_key);
CREATE INDEX idx_tm_cache_expires ON ticketmaster_events_cache(expires_at);

ALTER TABLE ticketmaster_events_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access" ON ticketmaster_events_cache
  FOR ALL USING (true) WITH CHECK (true);
