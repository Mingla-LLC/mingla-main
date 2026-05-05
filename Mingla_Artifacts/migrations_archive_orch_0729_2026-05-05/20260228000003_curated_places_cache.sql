CREATE TABLE curated_places_cache (
  location_key TEXT NOT NULL,
  radius_m INTEGER NOT NULL,
  category_places JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (location_key, radius_m)
);

CREATE INDEX idx_curated_places_cache_ttl ON curated_places_cache(created_at);

ALTER TABLE curated_places_cache ENABLE ROW LEVEL SECURITY;
