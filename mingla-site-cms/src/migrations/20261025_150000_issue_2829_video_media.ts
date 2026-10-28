import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

// #2829 W6 (AD-9) — media kind (image / file_video / stream_video), a video's
// length, the stream video fields, and the two video refusal codes. Chunk
// digests live in the existing rendition_manifest json (no column).

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "sites_cms"."enum_media_kind" AS ENUM('image', 'file_video', 'stream_video');
  ALTER TYPE "sites_cms"."enum_media_rejection_code" ADD VALUE 'VIDEO_NOT_FASTSTART';
  ALTER TYPE "sites_cms"."enum_media_rejection_code" ADD VALUE 'VIDEO_CODEC';
  ALTER TABLE "sites_cms"."media" ADD COLUMN "duration_ms" numeric;
  ALTER TABLE "sites_cms"."media" ADD COLUMN "kind" "sites_cms"."enum_media_kind";
  ALTER TABLE "sites_cms"."media" ADD COLUMN "stream_video_id" varchar;
  ALTER TABLE "sites_cms"."media" ADD COLUMN "stream_url" varchar;
  ALTER TABLE "sites_cms"."media" ADD COLUMN "stream_host" varchar;`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "sites_cms"."media" ALTER COLUMN "rejection_code" SET DATA TYPE text;
  DROP TYPE "sites_cms"."enum_media_rejection_code";
  CREATE TYPE "sites_cms"."enum_media_rejection_code" AS ENUM('TYPE_NOT_ALLOWED', 'TOO_LARGE', 'DIMENSIONS_TOO_LARGE', 'MIME_MISMATCH', 'DECODE_FAILED', 'CHECKSUM_MISMATCH', 'METADATA_RETAINED', 'PROCESSING_FAILED');
  ALTER TABLE "sites_cms"."media" ALTER COLUMN "rejection_code" SET DATA TYPE "sites_cms"."enum_media_rejection_code" USING "rejection_code"::"sites_cms"."enum_media_rejection_code";
  ALTER TABLE "sites_cms"."media" DROP COLUMN "duration_ms";
  ALTER TABLE "sites_cms"."media" DROP COLUMN "kind";
  ALTER TABLE "sites_cms"."media" DROP COLUMN "stream_video_id";
  ALTER TABLE "sites_cms"."media" DROP COLUMN "stream_url";
  ALTER TABLE "sites_cms"."media" DROP COLUMN "stream_host";
  DROP TYPE "sites_cms"."enum_media_kind";`)
}
