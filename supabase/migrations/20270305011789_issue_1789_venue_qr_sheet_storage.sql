-- Issue #1789 (#1767 Phase 1) — private storage for the venue QR print sheet.
--
-- SPEC #1788 P-27 / DESIGN D-5: `venue-qr-sheet` renders server-side on the
-- shipped ticket-PDF rail into a PRIVATE bucket and returns a short-TTL signed
-- URL — the `ticket-pdf-fetch` posture (I-PROPOSED-AM
-- TICKET_PDF_STORAGE_BUCKET_PRIVATE, cloned here). Client print is REJECTED:
-- no expo-print dependency exists anywhere and one was deliberately avoided
-- before (`mingla-business/src/utils/guestCsvExport.ts:412`).
--
-- The bucket is private with ZERO client-role policies on storage.objects.
-- Reads happen exclusively through the 60-second signed URLs issued by the
-- manager-plus-gated edge function; writes happen via service-role, which
-- bypasses RLS, so no explicit policy is needed.
--
-- Path convention: `venue-qr/<brand_id>/<sheet_id>.pdf`.

BEGIN;

-- Guard: the local CI Postgres baseline ships a stripped-down storage schema
-- without the `public` / `file_size_limit` / `allowed_mime_types` columns the
-- Supabase storage extension adds on the real project. Skip the INSERT when
-- those columns are absent so the migration applies cleanly in CI. On the real
-- project the INSERT executes verbatim with public=false.
DO $bucket$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'storage'
      AND table_name = 'buckets'
      AND column_name = 'public'
  ) THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES (
      'venue-qr-sheets',
      'venue-qr-sheets',
      false,
      12 * 1024 * 1024,
      ARRAY['application/pdf']
    )
    ON CONFLICT (id) DO NOTHING;
  END IF;
END
$bucket$;

COMMIT;
