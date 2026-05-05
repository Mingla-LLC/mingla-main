-- ORCH-0371: Add optional screenshot support to beta feedback
-- New nullable array columns for screenshot storage paths and signed URLs.
-- NULL = no screenshots (backward compatible with all existing rows).

ALTER TABLE beta_feedback
  ADD COLUMN screenshot_paths TEXT[] DEFAULT NULL,
  ADD COLUMN screenshot_urls  TEXT[] DEFAULT NULL;

-- Update the beta-feedback storage bucket to also accept JPEG images.
-- Existing allowed_mime_types: ARRAY['audio/mp4', 'audio/x-m4a', 'audio/mpeg', 'audio/aac']
UPDATE storage.buckets
SET allowed_mime_types = ARRAY[
  'audio/mp4', 'audio/x-m4a', 'audio/mpeg', 'audio/aac',
  'image/jpeg'
]
WHERE id = 'beta-feedback';
