import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
  CREATE SCHEMA IF NOT EXISTS "sites_cms";
  REVOKE ALL ON SCHEMA "sites_cms" FROM PUBLIC, anon, authenticated;
  CREATE TYPE "sites_cms"."enum_tenants_status" AS ENUM('provisioning', 'active', 'suspended');
  CREATE TYPE "sites_cms"."enum_pages_blocks_media_feature_alignment" AS ENUM('left', 'right');
  CREATE TYPE "sites_cms"."enum_pages_blocks_spacer_size" AS ENUM('small', 'medium', 'large');
  CREATE TYPE "sites_cms"."enum_pages_role" AS ENUM('home', 'about', 'menu', 'gallery', 'contact');
  CREATE TYPE "sites_cms"."enum_pages_status" AS ENUM('draft', 'published');
  CREATE TYPE "sites_cms"."enum__pages_v_blocks_media_feature_alignment" AS ENUM('left', 'right');
  CREATE TYPE "sites_cms"."enum__pages_v_blocks_spacer_size" AS ENUM('small', 'medium', 'large');
  CREATE TYPE "sites_cms"."enum__pages_v_version_role" AS ENUM('home', 'about', 'menu', 'gallery', 'contact');
  CREATE TYPE "sites_cms"."enum__pages_v_version_status" AS ENUM('draft', 'published');
  CREATE TYPE "sites_cms"."enum_media_state" AS ENUM('UPLOADING', 'QUARANTINED', 'PROCESSING', 'READY', 'REJECTED', 'RETRYABLE_FAILED', 'TOMBSTONED');
  CREATE TYPE "sites_cms"."enum_media_declared_mime" AS ENUM('image/jpeg', 'image/png', 'image/webp');
  CREATE TYPE "sites_cms"."enum_media_rejection_code" AS ENUM('TYPE_NOT_ALLOWED', 'TOO_LARGE', 'DIMENSIONS_TOO_LARGE', 'MIME_MISMATCH', 'DECODE_FAILED', 'CHECKSUM_MISMATCH', 'METADATA_RETAINED', 'PROCESSING_FAILED');
  CREATE TYPE "sites_cms"."enum_navigation_status" AS ENUM('draft', 'published');
  CREATE TYPE "sites_cms"."enum__navigation_v_version_status" AS ENUM('draft', 'published');
  CREATE TYPE "sites_cms"."enum_footer_status" AS ENUM('draft', 'published');
  CREATE TYPE "sites_cms"."enum__footer_v_version_status" AS ENUM('draft', 'published');
  CREATE TYPE "sites_cms"."enum_site_settings_typography" AS ENUM('modern-sans', 'editorial-serif');
  CREATE TYPE "sites_cms"."enum_site_settings_analytics_consent_mode" AS ENUM('optional');
  CREATE TYPE "sites_cms"."enum_site_settings_status" AS ENUM('draft', 'published');
  CREATE TYPE "sites_cms"."enum__site_settings_v_version_typography" AS ENUM('modern-sans', 'editorial-serif');
  CREATE TYPE "sites_cms"."enum__site_settings_v_version_analytics_consent_mode" AS ENUM('optional');
  CREATE TYPE "sites_cms"."enum__site_settings_v_version_status" AS ENUM('draft', 'published');
  CREATE TYPE "sites_cms"."enum_publication_jobs_status" AS ENUM('queued', 'validating', 'materializing', 'probing', 'published', 'failed', 'ambiguous');
  CREATE TYPE "sites_cms"."enum_gateway_nonces_direction" AS ENUM('core_to_cms');
  CREATE TABLE "sites_cms"."studio_users_tenants" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"tenant_id" uuid
  );
  
  CREATE TABLE "sites_cms"."studio_users" (
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"core_user_id" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "sites_cms"."tenants" (
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"name" varchar NOT NULL,
  	"core_site_id" varchar NOT NULL,
  	"core_brand_id" varchar NOT NULL,
  	"status" "sites_cms"."enum_tenants_status" DEFAULT 'active' NOT NULL,
  	"renderer_key" varchar DEFAULT 'restaurant-website-v1' NOT NULL,
  	"renderer_version" numeric DEFAULT 1 NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "sites_cms"."pages_blocks_hero_ctas" (
  	"_order" integer NOT NULL,
  	"_parent_id" varchar NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"label" varchar,
  	"href" varchar
  );
  
  CREATE TABLE "sites_cms"."pages_blocks_hero" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"_path" text NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"heading" varchar,
  	"subheading" varchar,
  	"media_id" uuid,
  	"block_name" varchar
  );
  
  CREATE TABLE "sites_cms"."pages_blocks_rich_text" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"_path" text NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"heading" varchar,
  	"content" jsonb,
  	"block_name" varchar
  );
  
  CREATE TABLE "sites_cms"."pages_blocks_media_feature" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"_path" text NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"media_id" uuid,
  	"alt" varchar,
  	"heading" varchar,
  	"caption" varchar,
  	"alignment" "sites_cms"."enum_pages_blocks_media_feature_alignment" DEFAULT 'left',
  	"block_name" varchar
  );
  
  CREATE TABLE "sites_cms"."pages_blocks_cta" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"_path" text NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"heading" varchar,
  	"body" varchar,
  	"label" varchar,
  	"href" varchar,
  	"block_name" varchar
  );
  
  CREATE TABLE "sites_cms"."pages_blocks_offering_grid_offering_ids" (
  	"_order" integer NOT NULL,
  	"_parent_id" varchar NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"offering_id" varchar
  );
  
  CREATE TABLE "sites_cms"."pages_blocks_offering_grid" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"_path" text NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"heading" varchar,
  	"block_name" varchar
  );
  
  CREATE TABLE "sites_cms"."pages_blocks_venue_reservation" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"_path" text NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"heading" varchar,
  	"body" varchar,
  	"reservation_target_id" varchar,
  	"block_name" varchar
  );
  
  CREATE TABLE "sites_cms"."pages_blocks_menu_link" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"_path" text NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"heading" varchar,
  	"label" varchar,
  	"href" varchar,
  	"block_name" varchar
  );
  
  CREATE TABLE "sites_cms"."pages_blocks_gallery_images" (
  	"_order" integer NOT NULL,
  	"_parent_id" varchar NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"media_id" uuid,
  	"alt" varchar
  );
  
  CREATE TABLE "sites_cms"."pages_blocks_gallery" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"_path" text NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"heading" varchar,
  	"block_name" varchar
  );
  
  CREATE TABLE "sites_cms"."pages_blocks_hours_location_hours" (
  	"_order" integer NOT NULL,
  	"_parent_id" varchar NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"day" varchar,
  	"value" varchar
  );
  
  CREATE TABLE "sites_cms"."pages_blocks_hours_location" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"_path" text NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"heading" varchar,
  	"address" varchar,
  	"map_url" varchar,
  	"block_name" varchar
  );
  
  CREATE TABLE "sites_cms"."pages_blocks_testimonials_items" (
  	"_order" integer NOT NULL,
  	"_parent_id" varchar NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"name" varchar,
  	"quote" varchar
  );
  
  CREATE TABLE "sites_cms"."pages_blocks_testimonials" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"_path" text NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"heading" varchar,
  	"block_name" varchar
  );
  
  CREATE TABLE "sites_cms"."pages_blocks_faq_items" (
  	"_order" integer NOT NULL,
  	"_parent_id" varchar NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"question" varchar,
  	"answer" varchar
  );
  
  CREATE TABLE "sites_cms"."pages_blocks_faq" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"_path" text NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"heading" varchar,
  	"block_name" varchar
  );
  
  CREATE TABLE "sites_cms"."pages_blocks_contact_handoff" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"_path" text NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"heading" varchar,
  	"body" varchar,
  	"label" varchar,
  	"href" varchar,
  	"block_name" varchar
  );
  
  CREATE TABLE "sites_cms"."pages_blocks_divider" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"_path" text NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"block_name" varchar
  );
  
  CREATE TABLE "sites_cms"."pages_blocks_spacer" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"_path" text NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"size" "sites_cms"."enum_pages_blocks_spacer_size" DEFAULT 'medium',
  	"block_name" varchar
  );
  
  CREATE TABLE "sites_cms"."pages" (
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"tenant_id" uuid,
  	"role" "sites_cms"."enum_pages_role",
  	"slug" varchar,
  	"title" varchar,
  	"enabled" boolean DEFAULT true,
  	"nav_label" varchar,
  	"nav_order" numeric,
  	"revision" numeric DEFAULT 1,
  	"seo_title" varchar,
  	"seo_description" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"_status" "sites_cms"."enum_pages_status" DEFAULT 'draft'
  );
  
  CREATE TABLE "sites_cms"."_pages_v_blocks_hero_ctas" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"label" varchar,
  	"href" varchar,
  	"_uuid" varchar
  );
  
  CREATE TABLE "sites_cms"."_pages_v_blocks_hero" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"_path" text NOT NULL,
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"heading" varchar,
  	"subheading" varchar,
  	"media_id" uuid,
  	"_uuid" varchar,
  	"block_name" varchar
  );
  
  CREATE TABLE "sites_cms"."_pages_v_blocks_rich_text" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"_path" text NOT NULL,
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"heading" varchar,
  	"content" jsonb,
  	"_uuid" varchar,
  	"block_name" varchar
  );
  
  CREATE TABLE "sites_cms"."_pages_v_blocks_media_feature" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"_path" text NOT NULL,
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"media_id" uuid,
  	"alt" varchar,
  	"heading" varchar,
  	"caption" varchar,
  	"alignment" "sites_cms"."enum__pages_v_blocks_media_feature_alignment" DEFAULT 'left',
  	"_uuid" varchar,
  	"block_name" varchar
  );
  
  CREATE TABLE "sites_cms"."_pages_v_blocks_cta" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"_path" text NOT NULL,
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"heading" varchar,
  	"body" varchar,
  	"label" varchar,
  	"href" varchar,
  	"_uuid" varchar,
  	"block_name" varchar
  );
  
  CREATE TABLE "sites_cms"."_pages_v_blocks_offering_grid_offering_ids" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"offering_id" varchar,
  	"_uuid" varchar
  );
  
  CREATE TABLE "sites_cms"."_pages_v_blocks_offering_grid" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"_path" text NOT NULL,
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"heading" varchar,
  	"_uuid" varchar,
  	"block_name" varchar
  );
  
  CREATE TABLE "sites_cms"."_pages_v_blocks_venue_reservation" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"_path" text NOT NULL,
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"heading" varchar,
  	"body" varchar,
  	"reservation_target_id" varchar,
  	"_uuid" varchar,
  	"block_name" varchar
  );
  
  CREATE TABLE "sites_cms"."_pages_v_blocks_menu_link" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"_path" text NOT NULL,
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"heading" varchar,
  	"label" varchar,
  	"href" varchar,
  	"_uuid" varchar,
  	"block_name" varchar
  );
  
  CREATE TABLE "sites_cms"."_pages_v_blocks_gallery_images" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"media_id" uuid,
  	"alt" varchar,
  	"_uuid" varchar
  );
  
  CREATE TABLE "sites_cms"."_pages_v_blocks_gallery" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"_path" text NOT NULL,
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"heading" varchar,
  	"_uuid" varchar,
  	"block_name" varchar
  );
  
  CREATE TABLE "sites_cms"."_pages_v_blocks_hours_location_hours" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"day" varchar,
  	"value" varchar,
  	"_uuid" varchar
  );
  
  CREATE TABLE "sites_cms"."_pages_v_blocks_hours_location" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"_path" text NOT NULL,
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"heading" varchar,
  	"address" varchar,
  	"map_url" varchar,
  	"_uuid" varchar,
  	"block_name" varchar
  );
  
  CREATE TABLE "sites_cms"."_pages_v_blocks_testimonials_items" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"name" varchar,
  	"quote" varchar,
  	"_uuid" varchar
  );
  
  CREATE TABLE "sites_cms"."_pages_v_blocks_testimonials" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"_path" text NOT NULL,
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"heading" varchar,
  	"_uuid" varchar,
  	"block_name" varchar
  );
  
  CREATE TABLE "sites_cms"."_pages_v_blocks_faq_items" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"question" varchar,
  	"answer" varchar,
  	"_uuid" varchar
  );
  
  CREATE TABLE "sites_cms"."_pages_v_blocks_faq" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"_path" text NOT NULL,
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"heading" varchar,
  	"_uuid" varchar,
  	"block_name" varchar
  );
  
  CREATE TABLE "sites_cms"."_pages_v_blocks_contact_handoff" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"_path" text NOT NULL,
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"heading" varchar,
  	"body" varchar,
  	"label" varchar,
  	"href" varchar,
  	"_uuid" varchar,
  	"block_name" varchar
  );
  
  CREATE TABLE "sites_cms"."_pages_v_blocks_divider" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"_path" text NOT NULL,
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"_uuid" varchar,
  	"block_name" varchar
  );
  
  CREATE TABLE "sites_cms"."_pages_v_blocks_spacer" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"_path" text NOT NULL,
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"size" "sites_cms"."enum__pages_v_blocks_spacer_size" DEFAULT 'medium',
  	"_uuid" varchar,
  	"block_name" varchar
  );
  
  CREATE TABLE "sites_cms"."_pages_v" (
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"parent_id" uuid,
  	"version_tenant_id" uuid,
  	"version_role" "sites_cms"."enum__pages_v_version_role",
  	"version_slug" varchar,
  	"version_title" varchar,
  	"version_enabled" boolean DEFAULT true,
  	"version_nav_label" varchar,
  	"version_nav_order" numeric,
  	"version_revision" numeric DEFAULT 1,
  	"version_seo_title" varchar,
  	"version_seo_description" varchar,
  	"version_updated_at" timestamp(3) with time zone,
  	"version_created_at" timestamp(3) with time zone,
  	"version__status" "sites_cms"."enum__pages_v_version_status" DEFAULT 'draft',
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"latest" boolean
  );
  
  CREATE TABLE "sites_cms"."media" (
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"tenant_id" uuid,
  	"state" "sites_cms"."enum_media_state" DEFAULT 'UPLOADING' NOT NULL,
  	"original_filename_safe" varchar NOT NULL,
  	"declared_mime" "sites_cms"."enum_media_declared_mime" NOT NULL,
  	"detected_mime" varchar,
  	"bytes" numeric,
  	"checksum" varchar,
  	"quarantine_key" varchar,
  	"approved_master_key" varchar,
  	"rendition_manifest" jsonb,
  	"rejection_code" "sites_cms"."enum_media_rejection_code",
  	"created_by" varchar,
  	"tombstoned_at" timestamp(3) with time zone,
  	"prefix" varchar DEFAULT 'payload-approved',
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"url" varchar,
  	"thumbnail_u_r_l" varchar,
  	"filename" varchar,
  	"mime_type" varchar,
  	"filesize" numeric,
  	"width" numeric,
  	"height" numeric,
  	"focal_x" numeric,
  	"focal_y" numeric
  );
  
  CREATE TABLE "sites_cms"."navigation" (
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"tenant_id" uuid,
  	"label" varchar DEFAULT 'Main navigation',
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"_status" "sites_cms"."enum_navigation_status" DEFAULT 'draft'
  );
  
  CREATE TABLE "sites_cms"."navigation_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" uuid NOT NULL,
  	"path" varchar NOT NULL,
  	"pages_id" uuid
  );
  
  CREATE TABLE "sites_cms"."_navigation_v" (
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"parent_id" uuid,
  	"version_tenant_id" uuid,
  	"version_label" varchar DEFAULT 'Main navigation',
  	"version_updated_at" timestamp(3) with time zone,
  	"version_created_at" timestamp(3) with time zone,
  	"version__status" "sites_cms"."enum__navigation_v_version_status" DEFAULT 'draft',
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"latest" boolean
  );
  
  CREATE TABLE "sites_cms"."_navigation_v_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" uuid NOT NULL,
  	"path" varchar NOT NULL,
  	"pages_id" uuid
  );
  
  CREATE TABLE "sites_cms"."footer_links" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"label" varchar,
  	"href" varchar
  );
  
  CREATE TABLE "sites_cms"."footer" (
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"tenant_id" uuid,
  	"label" varchar DEFAULT 'Website footer',
  	"address" varchar,
  	"hours_summary" varchar,
  	"legal_text" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"_status" "sites_cms"."enum_footer_status" DEFAULT 'draft'
  );
  
  CREATE TABLE "sites_cms"."_footer_v_version_links" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"label" varchar,
  	"href" varchar,
  	"_uuid" varchar
  );
  
  CREATE TABLE "sites_cms"."_footer_v" (
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"parent_id" uuid,
  	"version_tenant_id" uuid,
  	"version_label" varchar DEFAULT 'Website footer',
  	"version_address" varchar,
  	"version_hours_summary" varchar,
  	"version_legal_text" varchar,
  	"version_updated_at" timestamp(3) with time zone,
  	"version_created_at" timestamp(3) with time zone,
  	"version__status" "sites_cms"."enum__footer_v_version_status" DEFAULT 'draft',
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"latest" boolean
  );
  
  CREATE TABLE "sites_cms"."site_settings" (
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"tenant_id" uuid,
  	"display_name" varchar,
  	"short_description" varchar,
  	"logo_id" uuid,
  	"background_color" varchar,
  	"foreground_color" varchar,
  	"accent_color" varchar,
  	"typography" "sites_cms"."enum_site_settings_typography" DEFAULT 'editorial-serif',
  	"canonical_url" varchar DEFAULT 'https://gogi.sites.usemingla.com',
  	"seo_title" varchar,
  	"seo_description" varchar,
  	"social_image_id" uuid,
  	"analytics_consent_mode" "sites_cms"."enum_site_settings_analytics_consent_mode" DEFAULT 'optional',
  	"renderer_key" varchar DEFAULT 'restaurant-website-v1',
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"_status" "sites_cms"."enum_site_settings_status" DEFAULT 'draft'
  );
  
  CREATE TABLE "sites_cms"."_site_settings_v" (
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"parent_id" uuid,
  	"version_tenant_id" uuid,
  	"version_display_name" varchar,
  	"version_short_description" varchar,
  	"version_logo_id" uuid,
  	"version_background_color" varchar,
  	"version_foreground_color" varchar,
  	"version_accent_color" varchar,
  	"version_typography" "sites_cms"."enum__site_settings_v_version_typography" DEFAULT 'editorial-serif',
  	"version_canonical_url" varchar DEFAULT 'https://gogi.sites.usemingla.com',
  	"version_seo_title" varchar,
  	"version_seo_description" varchar,
  	"version_social_image_id" uuid,
  	"version_analytics_consent_mode" "sites_cms"."enum__site_settings_v_version_analytics_consent_mode" DEFAULT 'optional',
  	"version_renderer_key" varchar DEFAULT 'restaurant-website-v1',
  	"version_updated_at" timestamp(3) with time zone,
  	"version_created_at" timestamp(3) with time zone,
  	"version__status" "sites_cms"."enum__site_settings_v_version_status" DEFAULT 'draft',
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"latest" boolean
  );
  
  CREATE TABLE "sites_cms"."publication_jobs" (
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"tenant_id" uuid,
  	"operation_id" varchar NOT NULL,
  	"source_revision_id" varchar NOT NULL,
  	"source_digest" varchar NOT NULL,
  	"validation_result" jsonb,
  	"artifact_key" varchar,
  	"artifact_digest" varchar,
  	"status" "sites_cms"."enum_publication_jobs_status" NOT NULL,
  	"retry_count" numeric DEFAULT 0,
  	"failure_code" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "sites_cms"."gateway_nonces" (
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"nonce" varchar NOT NULL,
  	"direction" "sites_cms"."enum_gateway_nonces_direction" NOT NULL,
  	"site_id" varchar NOT NULL,
  	"operation_id" varchar NOT NULL,
  	"expires_at" timestamp(3) with time zone NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "sites_cms"."payload_kv" (
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"key" varchar NOT NULL,
  	"data" jsonb NOT NULL
  );
  
  CREATE TABLE "sites_cms"."payload_locked_documents" (
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"global_slug" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "sites_cms"."payload_locked_documents_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" uuid NOT NULL,
  	"path" varchar NOT NULL,
  	"studio_users_id" uuid,
  	"tenants_id" uuid,
  	"pages_id" uuid,
  	"media_id" uuid,
  	"navigation_id" uuid,
  	"footer_id" uuid,
  	"site_settings_id" uuid,
  	"publication_jobs_id" uuid,
  	"gateway_nonces_id" uuid
  );
  
  CREATE TABLE "sites_cms"."payload_preferences" (
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"key" varchar,
  	"value" jsonb,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "sites_cms"."payload_preferences_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" uuid NOT NULL,
  	"path" varchar NOT NULL,
  	"studio_users_id" uuid
  );
  
  CREATE TABLE "sites_cms"."payload_migrations" (
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"name" varchar,
  	"batch" numeric,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "sites_cms"."studio_users_tenants" ADD CONSTRAINT "studio_users_tenants_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "sites_cms"."tenants"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "sites_cms"."studio_users_tenants" ADD CONSTRAINT "studio_users_tenants_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."studio_users"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."pages_blocks_hero_ctas" ADD CONSTRAINT "pages_blocks_hero_ctas_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."pages_blocks_hero"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."pages_blocks_hero" ADD CONSTRAINT "pages_blocks_hero_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "sites_cms"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "sites_cms"."pages_blocks_hero" ADD CONSTRAINT "pages_blocks_hero_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."pages"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."pages_blocks_rich_text" ADD CONSTRAINT "pages_blocks_rich_text_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."pages"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."pages_blocks_media_feature" ADD CONSTRAINT "pages_blocks_media_feature_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "sites_cms"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "sites_cms"."pages_blocks_media_feature" ADD CONSTRAINT "pages_blocks_media_feature_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."pages"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."pages_blocks_cta" ADD CONSTRAINT "pages_blocks_cta_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."pages"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."pages_blocks_offering_grid_offering_ids" ADD CONSTRAINT "pages_blocks_offering_grid_offering_ids_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."pages_blocks_offering_grid"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."pages_blocks_offering_grid" ADD CONSTRAINT "pages_blocks_offering_grid_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."pages"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."pages_blocks_venue_reservation" ADD CONSTRAINT "pages_blocks_venue_reservation_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."pages"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."pages_blocks_menu_link" ADD CONSTRAINT "pages_blocks_menu_link_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."pages"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."pages_blocks_gallery_images" ADD CONSTRAINT "pages_blocks_gallery_images_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "sites_cms"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "sites_cms"."pages_blocks_gallery_images" ADD CONSTRAINT "pages_blocks_gallery_images_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."pages_blocks_gallery"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."pages_blocks_gallery" ADD CONSTRAINT "pages_blocks_gallery_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."pages"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."pages_blocks_hours_location_hours" ADD CONSTRAINT "pages_blocks_hours_location_hours_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."pages_blocks_hours_location"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."pages_blocks_hours_location" ADD CONSTRAINT "pages_blocks_hours_location_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."pages"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."pages_blocks_testimonials_items" ADD CONSTRAINT "pages_blocks_testimonials_items_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."pages_blocks_testimonials"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."pages_blocks_testimonials" ADD CONSTRAINT "pages_blocks_testimonials_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."pages"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."pages_blocks_faq_items" ADD CONSTRAINT "pages_blocks_faq_items_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."pages_blocks_faq"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."pages_blocks_faq" ADD CONSTRAINT "pages_blocks_faq_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."pages"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."pages_blocks_contact_handoff" ADD CONSTRAINT "pages_blocks_contact_handoff_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."pages"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."pages_blocks_divider" ADD CONSTRAINT "pages_blocks_divider_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."pages"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."pages_blocks_spacer" ADD CONSTRAINT "pages_blocks_spacer_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."pages"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."pages" ADD CONSTRAINT "pages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "sites_cms"."tenants"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "sites_cms"."_pages_v_blocks_hero_ctas" ADD CONSTRAINT "_pages_v_blocks_hero_ctas_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."_pages_v_blocks_hero"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."_pages_v_blocks_hero" ADD CONSTRAINT "_pages_v_blocks_hero_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "sites_cms"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "sites_cms"."_pages_v_blocks_hero" ADD CONSTRAINT "_pages_v_blocks_hero_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."_pages_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."_pages_v_blocks_rich_text" ADD CONSTRAINT "_pages_v_blocks_rich_text_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."_pages_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."_pages_v_blocks_media_feature" ADD CONSTRAINT "_pages_v_blocks_media_feature_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "sites_cms"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "sites_cms"."_pages_v_blocks_media_feature" ADD CONSTRAINT "_pages_v_blocks_media_feature_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."_pages_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."_pages_v_blocks_cta" ADD CONSTRAINT "_pages_v_blocks_cta_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."_pages_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."_pages_v_blocks_offering_grid_offering_ids" ADD CONSTRAINT "_pages_v_blocks_offering_grid_offering_ids_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."_pages_v_blocks_offering_grid"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."_pages_v_blocks_offering_grid" ADD CONSTRAINT "_pages_v_blocks_offering_grid_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."_pages_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."_pages_v_blocks_venue_reservation" ADD CONSTRAINT "_pages_v_blocks_venue_reservation_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."_pages_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."_pages_v_blocks_menu_link" ADD CONSTRAINT "_pages_v_blocks_menu_link_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."_pages_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."_pages_v_blocks_gallery_images" ADD CONSTRAINT "_pages_v_blocks_gallery_images_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "sites_cms"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "sites_cms"."_pages_v_blocks_gallery_images" ADD CONSTRAINT "_pages_v_blocks_gallery_images_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."_pages_v_blocks_gallery"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."_pages_v_blocks_gallery" ADD CONSTRAINT "_pages_v_blocks_gallery_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."_pages_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."_pages_v_blocks_hours_location_hours" ADD CONSTRAINT "_pages_v_blocks_hours_location_hours_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."_pages_v_blocks_hours_location"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."_pages_v_blocks_hours_location" ADD CONSTRAINT "_pages_v_blocks_hours_location_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."_pages_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."_pages_v_blocks_testimonials_items" ADD CONSTRAINT "_pages_v_blocks_testimonials_items_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."_pages_v_blocks_testimonials"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."_pages_v_blocks_testimonials" ADD CONSTRAINT "_pages_v_blocks_testimonials_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."_pages_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."_pages_v_blocks_faq_items" ADD CONSTRAINT "_pages_v_blocks_faq_items_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."_pages_v_blocks_faq"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."_pages_v_blocks_faq" ADD CONSTRAINT "_pages_v_blocks_faq_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."_pages_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."_pages_v_blocks_contact_handoff" ADD CONSTRAINT "_pages_v_blocks_contact_handoff_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."_pages_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."_pages_v_blocks_divider" ADD CONSTRAINT "_pages_v_blocks_divider_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."_pages_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."_pages_v_blocks_spacer" ADD CONSTRAINT "_pages_v_blocks_spacer_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."_pages_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."_pages_v" ADD CONSTRAINT "_pages_v_parent_id_pages_id_fk" FOREIGN KEY ("parent_id") REFERENCES "sites_cms"."pages"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "sites_cms"."_pages_v" ADD CONSTRAINT "_pages_v_version_tenant_id_tenants_id_fk" FOREIGN KEY ("version_tenant_id") REFERENCES "sites_cms"."tenants"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "sites_cms"."media" ADD CONSTRAINT "media_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "sites_cms"."tenants"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "sites_cms"."navigation" ADD CONSTRAINT "navigation_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "sites_cms"."tenants"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "sites_cms"."navigation_rels" ADD CONSTRAINT "navigation_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "sites_cms"."navigation"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."navigation_rels" ADD CONSTRAINT "navigation_rels_pages_fk" FOREIGN KEY ("pages_id") REFERENCES "sites_cms"."pages"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."_navigation_v" ADD CONSTRAINT "_navigation_v_parent_id_navigation_id_fk" FOREIGN KEY ("parent_id") REFERENCES "sites_cms"."navigation"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "sites_cms"."_navigation_v" ADD CONSTRAINT "_navigation_v_version_tenant_id_tenants_id_fk" FOREIGN KEY ("version_tenant_id") REFERENCES "sites_cms"."tenants"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "sites_cms"."_navigation_v_rels" ADD CONSTRAINT "_navigation_v_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "sites_cms"."_navigation_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."_navigation_v_rels" ADD CONSTRAINT "_navigation_v_rels_pages_fk" FOREIGN KEY ("pages_id") REFERENCES "sites_cms"."pages"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."footer_links" ADD CONSTRAINT "footer_links_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."footer"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."footer" ADD CONSTRAINT "footer_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "sites_cms"."tenants"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "sites_cms"."_footer_v_version_links" ADD CONSTRAINT "_footer_v_version_links_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."_footer_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."_footer_v" ADD CONSTRAINT "_footer_v_parent_id_footer_id_fk" FOREIGN KEY ("parent_id") REFERENCES "sites_cms"."footer"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "sites_cms"."_footer_v" ADD CONSTRAINT "_footer_v_version_tenant_id_tenants_id_fk" FOREIGN KEY ("version_tenant_id") REFERENCES "sites_cms"."tenants"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "sites_cms"."site_settings" ADD CONSTRAINT "site_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "sites_cms"."tenants"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "sites_cms"."site_settings" ADD CONSTRAINT "site_settings_logo_id_media_id_fk" FOREIGN KEY ("logo_id") REFERENCES "sites_cms"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "sites_cms"."site_settings" ADD CONSTRAINT "site_settings_social_image_id_media_id_fk" FOREIGN KEY ("social_image_id") REFERENCES "sites_cms"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "sites_cms"."_site_settings_v" ADD CONSTRAINT "_site_settings_v_parent_id_site_settings_id_fk" FOREIGN KEY ("parent_id") REFERENCES "sites_cms"."site_settings"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "sites_cms"."_site_settings_v" ADD CONSTRAINT "_site_settings_v_version_tenant_id_tenants_id_fk" FOREIGN KEY ("version_tenant_id") REFERENCES "sites_cms"."tenants"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "sites_cms"."_site_settings_v" ADD CONSTRAINT "_site_settings_v_version_logo_id_media_id_fk" FOREIGN KEY ("version_logo_id") REFERENCES "sites_cms"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "sites_cms"."_site_settings_v" ADD CONSTRAINT "_site_settings_v_version_social_image_id_media_id_fk" FOREIGN KEY ("version_social_image_id") REFERENCES "sites_cms"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "sites_cms"."publication_jobs" ADD CONSTRAINT "publication_jobs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "sites_cms"."tenants"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "sites_cms"."payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "sites_cms"."payload_locked_documents"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_studio_users_fk" FOREIGN KEY ("studio_users_id") REFERENCES "sites_cms"."studio_users"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_tenants_fk" FOREIGN KEY ("tenants_id") REFERENCES "sites_cms"."tenants"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_pages_fk" FOREIGN KEY ("pages_id") REFERENCES "sites_cms"."pages"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_media_fk" FOREIGN KEY ("media_id") REFERENCES "sites_cms"."media"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_navigation_fk" FOREIGN KEY ("navigation_id") REFERENCES "sites_cms"."navigation"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_footer_fk" FOREIGN KEY ("footer_id") REFERENCES "sites_cms"."footer"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_site_settings_fk" FOREIGN KEY ("site_settings_id") REFERENCES "sites_cms"."site_settings"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_publication_jobs_fk" FOREIGN KEY ("publication_jobs_id") REFERENCES "sites_cms"."publication_jobs"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_gateway_nonces_fk" FOREIGN KEY ("gateway_nonces_id") REFERENCES "sites_cms"."gateway_nonces"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."payload_preferences_rels" ADD CONSTRAINT "payload_preferences_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "sites_cms"."payload_preferences"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."payload_preferences_rels" ADD CONSTRAINT "payload_preferences_rels_studio_users_fk" FOREIGN KEY ("studio_users_id") REFERENCES "sites_cms"."studio_users"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "studio_users_tenants_order_idx" ON "sites_cms"."studio_users_tenants" USING btree ("_order");
  CREATE INDEX "studio_users_tenants_parent_id_idx" ON "sites_cms"."studio_users_tenants" USING btree ("_parent_id");
  CREATE INDEX "studio_users_tenants_tenant_idx" ON "sites_cms"."studio_users_tenants" USING btree ("tenant_id");
  CREATE UNIQUE INDEX "studio_users_core_user_id_idx" ON "sites_cms"."studio_users" USING btree ("core_user_id");
  CREATE INDEX "studio_users_updated_at_idx" ON "sites_cms"."studio_users" USING btree ("updated_at");
  CREATE INDEX "studio_users_created_at_idx" ON "sites_cms"."studio_users" USING btree ("created_at");
  CREATE UNIQUE INDEX "tenants_core_site_id_idx" ON "sites_cms"."tenants" USING btree ("core_site_id");
  CREATE UNIQUE INDEX "tenants_core_brand_id_idx" ON "sites_cms"."tenants" USING btree ("core_brand_id");
  CREATE INDEX "tenants_updated_at_idx" ON "sites_cms"."tenants" USING btree ("updated_at");
  CREATE INDEX "tenants_created_at_idx" ON "sites_cms"."tenants" USING btree ("created_at");
  CREATE INDEX "pages_blocks_hero_ctas_order_idx" ON "sites_cms"."pages_blocks_hero_ctas" USING btree ("_order");
  CREATE INDEX "pages_blocks_hero_ctas_parent_id_idx" ON "sites_cms"."pages_blocks_hero_ctas" USING btree ("_parent_id");
  CREATE INDEX "pages_blocks_hero_order_idx" ON "sites_cms"."pages_blocks_hero" USING btree ("_order");
  CREATE INDEX "pages_blocks_hero_parent_id_idx" ON "sites_cms"."pages_blocks_hero" USING btree ("_parent_id");
  CREATE INDEX "pages_blocks_hero_path_idx" ON "sites_cms"."pages_blocks_hero" USING btree ("_path");
  CREATE INDEX "pages_blocks_hero_media_idx" ON "sites_cms"."pages_blocks_hero" USING btree ("media_id");
  CREATE INDEX "pages_blocks_rich_text_order_idx" ON "sites_cms"."pages_blocks_rich_text" USING btree ("_order");
  CREATE INDEX "pages_blocks_rich_text_parent_id_idx" ON "sites_cms"."pages_blocks_rich_text" USING btree ("_parent_id");
  CREATE INDEX "pages_blocks_rich_text_path_idx" ON "sites_cms"."pages_blocks_rich_text" USING btree ("_path");
  CREATE INDEX "pages_blocks_media_feature_order_idx" ON "sites_cms"."pages_blocks_media_feature" USING btree ("_order");
  CREATE INDEX "pages_blocks_media_feature_parent_id_idx" ON "sites_cms"."pages_blocks_media_feature" USING btree ("_parent_id");
  CREATE INDEX "pages_blocks_media_feature_path_idx" ON "sites_cms"."pages_blocks_media_feature" USING btree ("_path");
  CREATE INDEX "pages_blocks_media_feature_media_idx" ON "sites_cms"."pages_blocks_media_feature" USING btree ("media_id");
  CREATE INDEX "pages_blocks_cta_order_idx" ON "sites_cms"."pages_blocks_cta" USING btree ("_order");
  CREATE INDEX "pages_blocks_cta_parent_id_idx" ON "sites_cms"."pages_blocks_cta" USING btree ("_parent_id");
  CREATE INDEX "pages_blocks_cta_path_idx" ON "sites_cms"."pages_blocks_cta" USING btree ("_path");
  CREATE INDEX "pages_blocks_offering_grid_offering_ids_order_idx" ON "sites_cms"."pages_blocks_offering_grid_offering_ids" USING btree ("_order");
  CREATE INDEX "pages_blocks_offering_grid_offering_ids_parent_id_idx" ON "sites_cms"."pages_blocks_offering_grid_offering_ids" USING btree ("_parent_id");
  CREATE INDEX "pages_blocks_offering_grid_order_idx" ON "sites_cms"."pages_blocks_offering_grid" USING btree ("_order");
  CREATE INDEX "pages_blocks_offering_grid_parent_id_idx" ON "sites_cms"."pages_blocks_offering_grid" USING btree ("_parent_id");
  CREATE INDEX "pages_blocks_offering_grid_path_idx" ON "sites_cms"."pages_blocks_offering_grid" USING btree ("_path");
  CREATE INDEX "pages_blocks_venue_reservation_order_idx" ON "sites_cms"."pages_blocks_venue_reservation" USING btree ("_order");
  CREATE INDEX "pages_blocks_venue_reservation_parent_id_idx" ON "sites_cms"."pages_blocks_venue_reservation" USING btree ("_parent_id");
  CREATE INDEX "pages_blocks_venue_reservation_path_idx" ON "sites_cms"."pages_blocks_venue_reservation" USING btree ("_path");
  CREATE INDEX "pages_blocks_menu_link_order_idx" ON "sites_cms"."pages_blocks_menu_link" USING btree ("_order");
  CREATE INDEX "pages_blocks_menu_link_parent_id_idx" ON "sites_cms"."pages_blocks_menu_link" USING btree ("_parent_id");
  CREATE INDEX "pages_blocks_menu_link_path_idx" ON "sites_cms"."pages_blocks_menu_link" USING btree ("_path");
  CREATE INDEX "pages_blocks_gallery_images_order_idx" ON "sites_cms"."pages_blocks_gallery_images" USING btree ("_order");
  CREATE INDEX "pages_blocks_gallery_images_parent_id_idx" ON "sites_cms"."pages_blocks_gallery_images" USING btree ("_parent_id");
  CREATE INDEX "pages_blocks_gallery_images_media_idx" ON "sites_cms"."pages_blocks_gallery_images" USING btree ("media_id");
  CREATE INDEX "pages_blocks_gallery_order_idx" ON "sites_cms"."pages_blocks_gallery" USING btree ("_order");
  CREATE INDEX "pages_blocks_gallery_parent_id_idx" ON "sites_cms"."pages_blocks_gallery" USING btree ("_parent_id");
  CREATE INDEX "pages_blocks_gallery_path_idx" ON "sites_cms"."pages_blocks_gallery" USING btree ("_path");
  CREATE INDEX "pages_blocks_hours_location_hours_order_idx" ON "sites_cms"."pages_blocks_hours_location_hours" USING btree ("_order");
  CREATE INDEX "pages_blocks_hours_location_hours_parent_id_idx" ON "sites_cms"."pages_blocks_hours_location_hours" USING btree ("_parent_id");
  CREATE INDEX "pages_blocks_hours_location_order_idx" ON "sites_cms"."pages_blocks_hours_location" USING btree ("_order");
  CREATE INDEX "pages_blocks_hours_location_parent_id_idx" ON "sites_cms"."pages_blocks_hours_location" USING btree ("_parent_id");
  CREATE INDEX "pages_blocks_hours_location_path_idx" ON "sites_cms"."pages_blocks_hours_location" USING btree ("_path");
  CREATE INDEX "pages_blocks_testimonials_items_order_idx" ON "sites_cms"."pages_blocks_testimonials_items" USING btree ("_order");
  CREATE INDEX "pages_blocks_testimonials_items_parent_id_idx" ON "sites_cms"."pages_blocks_testimonials_items" USING btree ("_parent_id");
  CREATE INDEX "pages_blocks_testimonials_order_idx" ON "sites_cms"."pages_blocks_testimonials" USING btree ("_order");
  CREATE INDEX "pages_blocks_testimonials_parent_id_idx" ON "sites_cms"."pages_blocks_testimonials" USING btree ("_parent_id");
  CREATE INDEX "pages_blocks_testimonials_path_idx" ON "sites_cms"."pages_blocks_testimonials" USING btree ("_path");
  CREATE INDEX "pages_blocks_faq_items_order_idx" ON "sites_cms"."pages_blocks_faq_items" USING btree ("_order");
  CREATE INDEX "pages_blocks_faq_items_parent_id_idx" ON "sites_cms"."pages_blocks_faq_items" USING btree ("_parent_id");
  CREATE INDEX "pages_blocks_faq_order_idx" ON "sites_cms"."pages_blocks_faq" USING btree ("_order");
  CREATE INDEX "pages_blocks_faq_parent_id_idx" ON "sites_cms"."pages_blocks_faq" USING btree ("_parent_id");
  CREATE INDEX "pages_blocks_faq_path_idx" ON "sites_cms"."pages_blocks_faq" USING btree ("_path");
  CREATE INDEX "pages_blocks_contact_handoff_order_idx" ON "sites_cms"."pages_blocks_contact_handoff" USING btree ("_order");
  CREATE INDEX "pages_blocks_contact_handoff_parent_id_idx" ON "sites_cms"."pages_blocks_contact_handoff" USING btree ("_parent_id");
  CREATE INDEX "pages_blocks_contact_handoff_path_idx" ON "sites_cms"."pages_blocks_contact_handoff" USING btree ("_path");
  CREATE INDEX "pages_blocks_divider_order_idx" ON "sites_cms"."pages_blocks_divider" USING btree ("_order");
  CREATE INDEX "pages_blocks_divider_parent_id_idx" ON "sites_cms"."pages_blocks_divider" USING btree ("_parent_id");
  CREATE INDEX "pages_blocks_divider_path_idx" ON "sites_cms"."pages_blocks_divider" USING btree ("_path");
  CREATE INDEX "pages_blocks_spacer_order_idx" ON "sites_cms"."pages_blocks_spacer" USING btree ("_order");
  CREATE INDEX "pages_blocks_spacer_parent_id_idx" ON "sites_cms"."pages_blocks_spacer" USING btree ("_parent_id");
  CREATE INDEX "pages_blocks_spacer_path_idx" ON "sites_cms"."pages_blocks_spacer" USING btree ("_path");
  CREATE INDEX "pages_tenant_idx" ON "sites_cms"."pages" USING btree ("tenant_id");
  CREATE INDEX "pages_updated_at_idx" ON "sites_cms"."pages" USING btree ("updated_at");
  CREATE INDEX "pages_created_at_idx" ON "sites_cms"."pages" USING btree ("created_at");
  CREATE INDEX "pages__status_idx" ON "sites_cms"."pages" USING btree ("_status");
  CREATE INDEX "_pages_v_blocks_hero_ctas_order_idx" ON "sites_cms"."_pages_v_blocks_hero_ctas" USING btree ("_order");
  CREATE INDEX "_pages_v_blocks_hero_ctas_parent_id_idx" ON "sites_cms"."_pages_v_blocks_hero_ctas" USING btree ("_parent_id");
  CREATE INDEX "_pages_v_blocks_hero_order_idx" ON "sites_cms"."_pages_v_blocks_hero" USING btree ("_order");
  CREATE INDEX "_pages_v_blocks_hero_parent_id_idx" ON "sites_cms"."_pages_v_blocks_hero" USING btree ("_parent_id");
  CREATE INDEX "_pages_v_blocks_hero_path_idx" ON "sites_cms"."_pages_v_blocks_hero" USING btree ("_path");
  CREATE INDEX "_pages_v_blocks_hero_media_idx" ON "sites_cms"."_pages_v_blocks_hero" USING btree ("media_id");
  CREATE INDEX "_pages_v_blocks_rich_text_order_idx" ON "sites_cms"."_pages_v_blocks_rich_text" USING btree ("_order");
  CREATE INDEX "_pages_v_blocks_rich_text_parent_id_idx" ON "sites_cms"."_pages_v_blocks_rich_text" USING btree ("_parent_id");
  CREATE INDEX "_pages_v_blocks_rich_text_path_idx" ON "sites_cms"."_pages_v_blocks_rich_text" USING btree ("_path");
  CREATE INDEX "_pages_v_blocks_media_feature_order_idx" ON "sites_cms"."_pages_v_blocks_media_feature" USING btree ("_order");
  CREATE INDEX "_pages_v_blocks_media_feature_parent_id_idx" ON "sites_cms"."_pages_v_blocks_media_feature" USING btree ("_parent_id");
  CREATE INDEX "_pages_v_blocks_media_feature_path_idx" ON "sites_cms"."_pages_v_blocks_media_feature" USING btree ("_path");
  CREATE INDEX "_pages_v_blocks_media_feature_media_idx" ON "sites_cms"."_pages_v_blocks_media_feature" USING btree ("media_id");
  CREATE INDEX "_pages_v_blocks_cta_order_idx" ON "sites_cms"."_pages_v_blocks_cta" USING btree ("_order");
  CREATE INDEX "_pages_v_blocks_cta_parent_id_idx" ON "sites_cms"."_pages_v_blocks_cta" USING btree ("_parent_id");
  CREATE INDEX "_pages_v_blocks_cta_path_idx" ON "sites_cms"."_pages_v_blocks_cta" USING btree ("_path");
  CREATE INDEX "_pages_v_blocks_offering_grid_offering_ids_order_idx" ON "sites_cms"."_pages_v_blocks_offering_grid_offering_ids" USING btree ("_order");
  CREATE INDEX "_pages_v_blocks_offering_grid_offering_ids_parent_id_idx" ON "sites_cms"."_pages_v_blocks_offering_grid_offering_ids" USING btree ("_parent_id");
  CREATE INDEX "_pages_v_blocks_offering_grid_order_idx" ON "sites_cms"."_pages_v_blocks_offering_grid" USING btree ("_order");
  CREATE INDEX "_pages_v_blocks_offering_grid_parent_id_idx" ON "sites_cms"."_pages_v_blocks_offering_grid" USING btree ("_parent_id");
  CREATE INDEX "_pages_v_blocks_offering_grid_path_idx" ON "sites_cms"."_pages_v_blocks_offering_grid" USING btree ("_path");
  CREATE INDEX "_pages_v_blocks_venue_reservation_order_idx" ON "sites_cms"."_pages_v_blocks_venue_reservation" USING btree ("_order");
  CREATE INDEX "_pages_v_blocks_venue_reservation_parent_id_idx" ON "sites_cms"."_pages_v_blocks_venue_reservation" USING btree ("_parent_id");
  CREATE INDEX "_pages_v_blocks_venue_reservation_path_idx" ON "sites_cms"."_pages_v_blocks_venue_reservation" USING btree ("_path");
  CREATE INDEX "_pages_v_blocks_menu_link_order_idx" ON "sites_cms"."_pages_v_blocks_menu_link" USING btree ("_order");
  CREATE INDEX "_pages_v_blocks_menu_link_parent_id_idx" ON "sites_cms"."_pages_v_blocks_menu_link" USING btree ("_parent_id");
  CREATE INDEX "_pages_v_blocks_menu_link_path_idx" ON "sites_cms"."_pages_v_blocks_menu_link" USING btree ("_path");
  CREATE INDEX "_pages_v_blocks_gallery_images_order_idx" ON "sites_cms"."_pages_v_blocks_gallery_images" USING btree ("_order");
  CREATE INDEX "_pages_v_blocks_gallery_images_parent_id_idx" ON "sites_cms"."_pages_v_blocks_gallery_images" USING btree ("_parent_id");
  CREATE INDEX "_pages_v_blocks_gallery_images_media_idx" ON "sites_cms"."_pages_v_blocks_gallery_images" USING btree ("media_id");
  CREATE INDEX "_pages_v_blocks_gallery_order_idx" ON "sites_cms"."_pages_v_blocks_gallery" USING btree ("_order");
  CREATE INDEX "_pages_v_blocks_gallery_parent_id_idx" ON "sites_cms"."_pages_v_blocks_gallery" USING btree ("_parent_id");
  CREATE INDEX "_pages_v_blocks_gallery_path_idx" ON "sites_cms"."_pages_v_blocks_gallery" USING btree ("_path");
  CREATE INDEX "_pages_v_blocks_hours_location_hours_order_idx" ON "sites_cms"."_pages_v_blocks_hours_location_hours" USING btree ("_order");
  CREATE INDEX "_pages_v_blocks_hours_location_hours_parent_id_idx" ON "sites_cms"."_pages_v_blocks_hours_location_hours" USING btree ("_parent_id");
  CREATE INDEX "_pages_v_blocks_hours_location_order_idx" ON "sites_cms"."_pages_v_blocks_hours_location" USING btree ("_order");
  CREATE INDEX "_pages_v_blocks_hours_location_parent_id_idx" ON "sites_cms"."_pages_v_blocks_hours_location" USING btree ("_parent_id");
  CREATE INDEX "_pages_v_blocks_hours_location_path_idx" ON "sites_cms"."_pages_v_blocks_hours_location" USING btree ("_path");
  CREATE INDEX "_pages_v_blocks_testimonials_items_order_idx" ON "sites_cms"."_pages_v_blocks_testimonials_items" USING btree ("_order");
  CREATE INDEX "_pages_v_blocks_testimonials_items_parent_id_idx" ON "sites_cms"."_pages_v_blocks_testimonials_items" USING btree ("_parent_id");
  CREATE INDEX "_pages_v_blocks_testimonials_order_idx" ON "sites_cms"."_pages_v_blocks_testimonials" USING btree ("_order");
  CREATE INDEX "_pages_v_blocks_testimonials_parent_id_idx" ON "sites_cms"."_pages_v_blocks_testimonials" USING btree ("_parent_id");
  CREATE INDEX "_pages_v_blocks_testimonials_path_idx" ON "sites_cms"."_pages_v_blocks_testimonials" USING btree ("_path");
  CREATE INDEX "_pages_v_blocks_faq_items_order_idx" ON "sites_cms"."_pages_v_blocks_faq_items" USING btree ("_order");
  CREATE INDEX "_pages_v_blocks_faq_items_parent_id_idx" ON "sites_cms"."_pages_v_blocks_faq_items" USING btree ("_parent_id");
  CREATE INDEX "_pages_v_blocks_faq_order_idx" ON "sites_cms"."_pages_v_blocks_faq" USING btree ("_order");
  CREATE INDEX "_pages_v_blocks_faq_parent_id_idx" ON "sites_cms"."_pages_v_blocks_faq" USING btree ("_parent_id");
  CREATE INDEX "_pages_v_blocks_faq_path_idx" ON "sites_cms"."_pages_v_blocks_faq" USING btree ("_path");
  CREATE INDEX "_pages_v_blocks_contact_handoff_order_idx" ON "sites_cms"."_pages_v_blocks_contact_handoff" USING btree ("_order");
  CREATE INDEX "_pages_v_blocks_contact_handoff_parent_id_idx" ON "sites_cms"."_pages_v_blocks_contact_handoff" USING btree ("_parent_id");
  CREATE INDEX "_pages_v_blocks_contact_handoff_path_idx" ON "sites_cms"."_pages_v_blocks_contact_handoff" USING btree ("_path");
  CREATE INDEX "_pages_v_blocks_divider_order_idx" ON "sites_cms"."_pages_v_blocks_divider" USING btree ("_order");
  CREATE INDEX "_pages_v_blocks_divider_parent_id_idx" ON "sites_cms"."_pages_v_blocks_divider" USING btree ("_parent_id");
  CREATE INDEX "_pages_v_blocks_divider_path_idx" ON "sites_cms"."_pages_v_blocks_divider" USING btree ("_path");
  CREATE INDEX "_pages_v_blocks_spacer_order_idx" ON "sites_cms"."_pages_v_blocks_spacer" USING btree ("_order");
  CREATE INDEX "_pages_v_blocks_spacer_parent_id_idx" ON "sites_cms"."_pages_v_blocks_spacer" USING btree ("_parent_id");
  CREATE INDEX "_pages_v_blocks_spacer_path_idx" ON "sites_cms"."_pages_v_blocks_spacer" USING btree ("_path");
  CREATE INDEX "_pages_v_parent_idx" ON "sites_cms"."_pages_v" USING btree ("parent_id");
  CREATE INDEX "_pages_v_version_version_tenant_idx" ON "sites_cms"."_pages_v" USING btree ("version_tenant_id");
  CREATE INDEX "_pages_v_version_version_updated_at_idx" ON "sites_cms"."_pages_v" USING btree ("version_updated_at");
  CREATE INDEX "_pages_v_version_version_created_at_idx" ON "sites_cms"."_pages_v" USING btree ("version_created_at");
  CREATE INDEX "_pages_v_version_version__status_idx" ON "sites_cms"."_pages_v" USING btree ("version__status");
  CREATE INDEX "_pages_v_created_at_idx" ON "sites_cms"."_pages_v" USING btree ("created_at");
  CREATE INDEX "_pages_v_updated_at_idx" ON "sites_cms"."_pages_v" USING btree ("updated_at");
  CREATE INDEX "_pages_v_latest_idx" ON "sites_cms"."_pages_v" USING btree ("latest");
  CREATE INDEX "media_tenant_idx" ON "sites_cms"."media" USING btree ("tenant_id");
  CREATE INDEX "media_updated_at_idx" ON "sites_cms"."media" USING btree ("updated_at");
  CREATE INDEX "media_created_at_idx" ON "sites_cms"."media" USING btree ("created_at");
  CREATE UNIQUE INDEX "media_filename_idx" ON "sites_cms"."media" USING btree ("filename");
  CREATE INDEX "navigation_tenant_idx" ON "sites_cms"."navigation" USING btree ("tenant_id");
  CREATE INDEX "navigation_updated_at_idx" ON "sites_cms"."navigation" USING btree ("updated_at");
  CREATE INDEX "navigation_created_at_idx" ON "sites_cms"."navigation" USING btree ("created_at");
  CREATE INDEX "navigation__status_idx" ON "sites_cms"."navigation" USING btree ("_status");
  CREATE INDEX "navigation_rels_order_idx" ON "sites_cms"."navigation_rels" USING btree ("order");
  CREATE INDEX "navigation_rels_parent_idx" ON "sites_cms"."navigation_rels" USING btree ("parent_id");
  CREATE INDEX "navigation_rels_path_idx" ON "sites_cms"."navigation_rels" USING btree ("path");
  CREATE INDEX "navigation_rels_pages_id_idx" ON "sites_cms"."navigation_rels" USING btree ("pages_id");
  CREATE INDEX "_navigation_v_parent_idx" ON "sites_cms"."_navigation_v" USING btree ("parent_id");
  CREATE INDEX "_navigation_v_version_version_tenant_idx" ON "sites_cms"."_navigation_v" USING btree ("version_tenant_id");
  CREATE INDEX "_navigation_v_version_version_updated_at_idx" ON "sites_cms"."_navigation_v" USING btree ("version_updated_at");
  CREATE INDEX "_navigation_v_version_version_created_at_idx" ON "sites_cms"."_navigation_v" USING btree ("version_created_at");
  CREATE INDEX "_navigation_v_version_version__status_idx" ON "sites_cms"."_navigation_v" USING btree ("version__status");
  CREATE INDEX "_navigation_v_created_at_idx" ON "sites_cms"."_navigation_v" USING btree ("created_at");
  CREATE INDEX "_navigation_v_updated_at_idx" ON "sites_cms"."_navigation_v" USING btree ("updated_at");
  CREATE INDEX "_navigation_v_latest_idx" ON "sites_cms"."_navigation_v" USING btree ("latest");
  CREATE INDEX "_navigation_v_rels_order_idx" ON "sites_cms"."_navigation_v_rels" USING btree ("order");
  CREATE INDEX "_navigation_v_rels_parent_idx" ON "sites_cms"."_navigation_v_rels" USING btree ("parent_id");
  CREATE INDEX "_navigation_v_rels_path_idx" ON "sites_cms"."_navigation_v_rels" USING btree ("path");
  CREATE INDEX "_navigation_v_rels_pages_id_idx" ON "sites_cms"."_navigation_v_rels" USING btree ("pages_id");
  CREATE INDEX "footer_links_order_idx" ON "sites_cms"."footer_links" USING btree ("_order");
  CREATE INDEX "footer_links_parent_id_idx" ON "sites_cms"."footer_links" USING btree ("_parent_id");
  CREATE INDEX "footer_tenant_idx" ON "sites_cms"."footer" USING btree ("tenant_id");
  CREATE INDEX "footer_updated_at_idx" ON "sites_cms"."footer" USING btree ("updated_at");
  CREATE INDEX "footer_created_at_idx" ON "sites_cms"."footer" USING btree ("created_at");
  CREATE INDEX "footer__status_idx" ON "sites_cms"."footer" USING btree ("_status");
  CREATE INDEX "_footer_v_version_links_order_idx" ON "sites_cms"."_footer_v_version_links" USING btree ("_order");
  CREATE INDEX "_footer_v_version_links_parent_id_idx" ON "sites_cms"."_footer_v_version_links" USING btree ("_parent_id");
  CREATE INDEX "_footer_v_parent_idx" ON "sites_cms"."_footer_v" USING btree ("parent_id");
  CREATE INDEX "_footer_v_version_version_tenant_idx" ON "sites_cms"."_footer_v" USING btree ("version_tenant_id");
  CREATE INDEX "_footer_v_version_version_updated_at_idx" ON "sites_cms"."_footer_v" USING btree ("version_updated_at");
  CREATE INDEX "_footer_v_version_version_created_at_idx" ON "sites_cms"."_footer_v" USING btree ("version_created_at");
  CREATE INDEX "_footer_v_version_version__status_idx" ON "sites_cms"."_footer_v" USING btree ("version__status");
  CREATE INDEX "_footer_v_created_at_idx" ON "sites_cms"."_footer_v" USING btree ("created_at");
  CREATE INDEX "_footer_v_updated_at_idx" ON "sites_cms"."_footer_v" USING btree ("updated_at");
  CREATE INDEX "_footer_v_latest_idx" ON "sites_cms"."_footer_v" USING btree ("latest");
  CREATE INDEX "site_settings_tenant_idx" ON "sites_cms"."site_settings" USING btree ("tenant_id");
  CREATE INDEX "site_settings_logo_idx" ON "sites_cms"."site_settings" USING btree ("logo_id");
  CREATE INDEX "site_settings_social_image_idx" ON "sites_cms"."site_settings" USING btree ("social_image_id");
  CREATE INDEX "site_settings_updated_at_idx" ON "sites_cms"."site_settings" USING btree ("updated_at");
  CREATE INDEX "site_settings_created_at_idx" ON "sites_cms"."site_settings" USING btree ("created_at");
  CREATE INDEX "site_settings__status_idx" ON "sites_cms"."site_settings" USING btree ("_status");
  CREATE INDEX "_site_settings_v_parent_idx" ON "sites_cms"."_site_settings_v" USING btree ("parent_id");
  CREATE INDEX "_site_settings_v_version_version_tenant_idx" ON "sites_cms"."_site_settings_v" USING btree ("version_tenant_id");
  CREATE INDEX "_site_settings_v_version_version_logo_idx" ON "sites_cms"."_site_settings_v" USING btree ("version_logo_id");
  CREATE INDEX "_site_settings_v_version_version_social_image_idx" ON "sites_cms"."_site_settings_v" USING btree ("version_social_image_id");
  CREATE INDEX "_site_settings_v_version_version_updated_at_idx" ON "sites_cms"."_site_settings_v" USING btree ("version_updated_at");
  CREATE INDEX "_site_settings_v_version_version_created_at_idx" ON "sites_cms"."_site_settings_v" USING btree ("version_created_at");
  CREATE INDEX "_site_settings_v_version_version__status_idx" ON "sites_cms"."_site_settings_v" USING btree ("version__status");
  CREATE INDEX "_site_settings_v_created_at_idx" ON "sites_cms"."_site_settings_v" USING btree ("created_at");
  CREATE INDEX "_site_settings_v_updated_at_idx" ON "sites_cms"."_site_settings_v" USING btree ("updated_at");
  CREATE INDEX "_site_settings_v_latest_idx" ON "sites_cms"."_site_settings_v" USING btree ("latest");
  CREATE INDEX "publication_jobs_tenant_idx" ON "sites_cms"."publication_jobs" USING btree ("tenant_id");
  CREATE UNIQUE INDEX "publication_jobs_operation_id_idx" ON "sites_cms"."publication_jobs" USING btree ("operation_id");
  CREATE INDEX "publication_jobs_updated_at_idx" ON "sites_cms"."publication_jobs" USING btree ("updated_at");
  CREATE INDEX "publication_jobs_created_at_idx" ON "sites_cms"."publication_jobs" USING btree ("created_at");
  CREATE UNIQUE INDEX "gateway_nonces_nonce_idx" ON "sites_cms"."gateway_nonces" USING btree ("nonce");
  CREATE INDEX "gateway_nonces_site_id_idx" ON "sites_cms"."gateway_nonces" USING btree ("site_id");
  CREATE INDEX "gateway_nonces_operation_id_idx" ON "sites_cms"."gateway_nonces" USING btree ("operation_id");
  CREATE INDEX "gateway_nonces_expires_at_idx" ON "sites_cms"."gateway_nonces" USING btree ("expires_at");
  CREATE INDEX "gateway_nonces_updated_at_idx" ON "sites_cms"."gateway_nonces" USING btree ("updated_at");
  CREATE INDEX "gateway_nonces_created_at_idx" ON "sites_cms"."gateway_nonces" USING btree ("created_at");
  CREATE UNIQUE INDEX "payload_kv_key_idx" ON "sites_cms"."payload_kv" USING btree ("key");
  CREATE INDEX "payload_locked_documents_global_slug_idx" ON "sites_cms"."payload_locked_documents" USING btree ("global_slug");
  CREATE INDEX "payload_locked_documents_updated_at_idx" ON "sites_cms"."payload_locked_documents" USING btree ("updated_at");
  CREATE INDEX "payload_locked_documents_created_at_idx" ON "sites_cms"."payload_locked_documents" USING btree ("created_at");
  CREATE INDEX "payload_locked_documents_rels_order_idx" ON "sites_cms"."payload_locked_documents_rels" USING btree ("order");
  CREATE INDEX "payload_locked_documents_rels_parent_idx" ON "sites_cms"."payload_locked_documents_rels" USING btree ("parent_id");
  CREATE INDEX "payload_locked_documents_rels_path_idx" ON "sites_cms"."payload_locked_documents_rels" USING btree ("path");
  CREATE INDEX "payload_locked_documents_rels_studio_users_id_idx" ON "sites_cms"."payload_locked_documents_rels" USING btree ("studio_users_id");
  CREATE INDEX "payload_locked_documents_rels_tenants_id_idx" ON "sites_cms"."payload_locked_documents_rels" USING btree ("tenants_id");
  CREATE INDEX "payload_locked_documents_rels_pages_id_idx" ON "sites_cms"."payload_locked_documents_rels" USING btree ("pages_id");
  CREATE INDEX "payload_locked_documents_rels_media_id_idx" ON "sites_cms"."payload_locked_documents_rels" USING btree ("media_id");
  CREATE INDEX "payload_locked_documents_rels_navigation_id_idx" ON "sites_cms"."payload_locked_documents_rels" USING btree ("navigation_id");
  CREATE INDEX "payload_locked_documents_rels_footer_id_idx" ON "sites_cms"."payload_locked_documents_rels" USING btree ("footer_id");
  CREATE INDEX "payload_locked_documents_rels_site_settings_id_idx" ON "sites_cms"."payload_locked_documents_rels" USING btree ("site_settings_id");
  CREATE INDEX "payload_locked_documents_rels_publication_jobs_id_idx" ON "sites_cms"."payload_locked_documents_rels" USING btree ("publication_jobs_id");
  CREATE INDEX "payload_locked_documents_rels_gateway_nonces_id_idx" ON "sites_cms"."payload_locked_documents_rels" USING btree ("gateway_nonces_id");
  CREATE INDEX "payload_preferences_key_idx" ON "sites_cms"."payload_preferences" USING btree ("key");
  CREATE INDEX "payload_preferences_updated_at_idx" ON "sites_cms"."payload_preferences" USING btree ("updated_at");
  CREATE INDEX "payload_preferences_created_at_idx" ON "sites_cms"."payload_preferences" USING btree ("created_at");
  CREATE INDEX "payload_preferences_rels_order_idx" ON "sites_cms"."payload_preferences_rels" USING btree ("order");
  CREATE INDEX "payload_preferences_rels_parent_idx" ON "sites_cms"."payload_preferences_rels" USING btree ("parent_id");
  CREATE INDEX "payload_preferences_rels_path_idx" ON "sites_cms"."payload_preferences_rels" USING btree ("path");
  CREATE INDEX "payload_preferences_rels_studio_users_id_idx" ON "sites_cms"."payload_preferences_rels" USING btree ("studio_users_id");
  CREATE INDEX "payload_migrations_updated_at_idx" ON "sites_cms"."payload_migrations" USING btree ("updated_at");
  CREATE INDEX "payload_migrations_created_at_idx" ON "sites_cms"."payload_migrations" USING btree ("created_at");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP TABLE "sites_cms"."studio_users_tenants" CASCADE;
  DROP TABLE "sites_cms"."studio_users" CASCADE;
  DROP TABLE "sites_cms"."tenants" CASCADE;
  DROP TABLE "sites_cms"."pages_blocks_hero_ctas" CASCADE;
  DROP TABLE "sites_cms"."pages_blocks_hero" CASCADE;
  DROP TABLE "sites_cms"."pages_blocks_rich_text" CASCADE;
  DROP TABLE "sites_cms"."pages_blocks_media_feature" CASCADE;
  DROP TABLE "sites_cms"."pages_blocks_cta" CASCADE;
  DROP TABLE "sites_cms"."pages_blocks_offering_grid_offering_ids" CASCADE;
  DROP TABLE "sites_cms"."pages_blocks_offering_grid" CASCADE;
  DROP TABLE "sites_cms"."pages_blocks_venue_reservation" CASCADE;
  DROP TABLE "sites_cms"."pages_blocks_menu_link" CASCADE;
  DROP TABLE "sites_cms"."pages_blocks_gallery_images" CASCADE;
  DROP TABLE "sites_cms"."pages_blocks_gallery" CASCADE;
  DROP TABLE "sites_cms"."pages_blocks_hours_location_hours" CASCADE;
  DROP TABLE "sites_cms"."pages_blocks_hours_location" CASCADE;
  DROP TABLE "sites_cms"."pages_blocks_testimonials_items" CASCADE;
  DROP TABLE "sites_cms"."pages_blocks_testimonials" CASCADE;
  DROP TABLE "sites_cms"."pages_blocks_faq_items" CASCADE;
  DROP TABLE "sites_cms"."pages_blocks_faq" CASCADE;
  DROP TABLE "sites_cms"."pages_blocks_contact_handoff" CASCADE;
  DROP TABLE "sites_cms"."pages_blocks_divider" CASCADE;
  DROP TABLE "sites_cms"."pages_blocks_spacer" CASCADE;
  DROP TABLE "sites_cms"."pages" CASCADE;
  DROP TABLE "sites_cms"."_pages_v_blocks_hero_ctas" CASCADE;
  DROP TABLE "sites_cms"."_pages_v_blocks_hero" CASCADE;
  DROP TABLE "sites_cms"."_pages_v_blocks_rich_text" CASCADE;
  DROP TABLE "sites_cms"."_pages_v_blocks_media_feature" CASCADE;
  DROP TABLE "sites_cms"."_pages_v_blocks_cta" CASCADE;
  DROP TABLE "sites_cms"."_pages_v_blocks_offering_grid_offering_ids" CASCADE;
  DROP TABLE "sites_cms"."_pages_v_blocks_offering_grid" CASCADE;
  DROP TABLE "sites_cms"."_pages_v_blocks_venue_reservation" CASCADE;
  DROP TABLE "sites_cms"."_pages_v_blocks_menu_link" CASCADE;
  DROP TABLE "sites_cms"."_pages_v_blocks_gallery_images" CASCADE;
  DROP TABLE "sites_cms"."_pages_v_blocks_gallery" CASCADE;
  DROP TABLE "sites_cms"."_pages_v_blocks_hours_location_hours" CASCADE;
  DROP TABLE "sites_cms"."_pages_v_blocks_hours_location" CASCADE;
  DROP TABLE "sites_cms"."_pages_v_blocks_testimonials_items" CASCADE;
  DROP TABLE "sites_cms"."_pages_v_blocks_testimonials" CASCADE;
  DROP TABLE "sites_cms"."_pages_v_blocks_faq_items" CASCADE;
  DROP TABLE "sites_cms"."_pages_v_blocks_faq" CASCADE;
  DROP TABLE "sites_cms"."_pages_v_blocks_contact_handoff" CASCADE;
  DROP TABLE "sites_cms"."_pages_v_blocks_divider" CASCADE;
  DROP TABLE "sites_cms"."_pages_v_blocks_spacer" CASCADE;
  DROP TABLE "sites_cms"."_pages_v" CASCADE;
  DROP TABLE "sites_cms"."media" CASCADE;
  DROP TABLE "sites_cms"."navigation" CASCADE;
  DROP TABLE "sites_cms"."navigation_rels" CASCADE;
  DROP TABLE "sites_cms"."_navigation_v" CASCADE;
  DROP TABLE "sites_cms"."_navigation_v_rels" CASCADE;
  DROP TABLE "sites_cms"."footer_links" CASCADE;
  DROP TABLE "sites_cms"."footer" CASCADE;
  DROP TABLE "sites_cms"."_footer_v_version_links" CASCADE;
  DROP TABLE "sites_cms"."_footer_v" CASCADE;
  DROP TABLE "sites_cms"."site_settings" CASCADE;
  DROP TABLE "sites_cms"."_site_settings_v" CASCADE;
  DROP TABLE "sites_cms"."publication_jobs" CASCADE;
  DROP TABLE "sites_cms"."gateway_nonces" CASCADE;
  DROP TABLE "sites_cms"."payload_kv" CASCADE;
  DROP TABLE "sites_cms"."payload_locked_documents" CASCADE;
  DROP TABLE "sites_cms"."payload_locked_documents_rels" CASCADE;
  DROP TABLE "sites_cms"."payload_preferences" CASCADE;
  DROP TABLE "sites_cms"."payload_preferences_rels" CASCADE;
  DROP TABLE "sites_cms"."payload_migrations" CASCADE;
  DROP TYPE "sites_cms"."enum_tenants_status";
  DROP TYPE "sites_cms"."enum_pages_blocks_media_feature_alignment";
  DROP TYPE "sites_cms"."enum_pages_blocks_spacer_size";
  DROP TYPE "sites_cms"."enum_pages_role";
  DROP TYPE "sites_cms"."enum_pages_status";
  DROP TYPE "sites_cms"."enum__pages_v_blocks_media_feature_alignment";
  DROP TYPE "sites_cms"."enum__pages_v_blocks_spacer_size";
  DROP TYPE "sites_cms"."enum__pages_v_version_role";
  DROP TYPE "sites_cms"."enum__pages_v_version_status";
  DROP TYPE "sites_cms"."enum_media_state";
  DROP TYPE "sites_cms"."enum_media_declared_mime";
  DROP TYPE "sites_cms"."enum_media_rejection_code";
  DROP TYPE "sites_cms"."enum_navigation_status";
  DROP TYPE "sites_cms"."enum__navigation_v_version_status";
  DROP TYPE "sites_cms"."enum_footer_status";
  DROP TYPE "sites_cms"."enum__footer_v_version_status";
  DROP TYPE "sites_cms"."enum_site_settings_typography";
  DROP TYPE "sites_cms"."enum_site_settings_analytics_consent_mode";
  DROP TYPE "sites_cms"."enum_site_settings_status";
  DROP TYPE "sites_cms"."enum__site_settings_v_version_typography";
  DROP TYPE "sites_cms"."enum__site_settings_v_version_analytics_consent_mode";
  DROP TYPE "sites_cms"."enum__site_settings_v_version_status";
  DROP TYPE "sites_cms"."enum_publication_jobs_status";
  DROP TYPE "sites_cms"."enum_gateway_nonces_direction";
  DROP SCHEMA IF EXISTS "sites_cms";`)
}
