import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "sites_cms"."enum_pages_blocks_destination_grid_variant" AS ENUM('neutral');
  CREATE TYPE "sites_cms"."enum_pages_blocks_story_grid_variant" AS ENUM('neutral');
  CREATE TYPE "sites_cms"."enum_pages_blocks_offering_history_kind" AS ENUM('trip', 'event', 'experience', 'all');
  CREATE TYPE "sites_cms"."enum_pages_blocks_offering_history_variant" AS ENUM('neutral');
  CREATE TYPE "sites_cms"."enum_pages_blocks_contact_form_variant" AS ENUM('neutral');
  CREATE TYPE "sites_cms"."enum_pages_blocks_newsletter_signup_variant" AS ENUM('neutral');
  CREATE TYPE "sites_cms"."enum__pages_v_blocks_destination_grid_variant" AS ENUM('neutral');
  CREATE TYPE "sites_cms"."enum__pages_v_blocks_story_grid_variant" AS ENUM('neutral');
  CREATE TYPE "sites_cms"."enum__pages_v_blocks_offering_history_kind" AS ENUM('trip', 'event', 'experience', 'all');
  CREATE TYPE "sites_cms"."enum__pages_v_blocks_offering_history_variant" AS ENUM('neutral');
  CREATE TYPE "sites_cms"."enum__pages_v_blocks_contact_form_variant" AS ENUM('neutral');
  CREATE TYPE "sites_cms"."enum__pages_v_blocks_newsletter_signup_variant" AS ENUM('neutral');
  CREATE TYPE "sites_cms"."enum_destinations_status" AS ENUM('draft', 'published');
  CREATE TYPE "sites_cms"."enum__destinations_v_version_status" AS ENUM('draft', 'published');
  CREATE TYPE "sites_cms"."enum_categories_status" AS ENUM('draft', 'published');
  CREATE TYPE "sites_cms"."enum__categories_v_version_status" AS ENUM('draft', 'published');
  CREATE TYPE "sites_cms"."enum_stories_status" AS ENUM('draft', 'published');
  CREATE TYPE "sites_cms"."enum__stories_v_version_status" AS ENUM('draft', 'published');
  CREATE TYPE "sites_cms"."enum_testimonials_status" AS ENUM('draft', 'published');
  CREATE TYPE "sites_cms"."enum__testimonials_v_version_status" AS ENUM('draft', 'published');
  CREATE TABLE "sites_cms"."pages_blocks_testimonials_testimonial_ids" (
  	"_order" integer NOT NULL,
  	"_parent_id" varchar NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"testimonial_id" uuid
  );
  
  CREATE TABLE "sites_cms"."pages_blocks_destination_grid_destinations" (
  	"_order" integer NOT NULL,
  	"_parent_id" varchar NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"destination_id" uuid
  );
  
  CREATE TABLE "sites_cms"."pages_blocks_destination_grid" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"_path" text NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"eyebrow" varchar,
  	"heading" varchar,
  	"intro" varchar,
  	"cta_label" varchar,
  	"cta_href" varchar,
  	"variant" "sites_cms"."enum_pages_blocks_destination_grid_variant" DEFAULT 'neutral',
  	"block_name" varchar
  );
  
  CREATE TABLE "sites_cms"."pages_blocks_story_grid" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"_path" text NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"eyebrow" varchar,
  	"heading" varchar,
  	"intro" varchar,
  	"category_id" uuid,
  	"limit" numeric,
  	"cta_label" varchar,
  	"cta_href" varchar,
  	"variant" "sites_cms"."enum_pages_blocks_story_grid_variant" DEFAULT 'neutral',
  	"block_name" varchar
  );
  
  CREATE TABLE "sites_cms"."pages_blocks_offering_history_series_offering_ids" (
  	"_order" integer NOT NULL,
  	"_parent_id" varchar NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"offering_id" varchar
  );
  
  CREATE TABLE "sites_cms"."pages_blocks_offering_history_series" (
  	"_order" integer NOT NULL,
  	"_parent_id" varchar NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"label" varchar
  );
  
  CREATE TABLE "sites_cms"."pages_blocks_offering_history" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"_path" text NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"eyebrow" varchar,
  	"heading" varchar,
  	"intro" varchar,
  	"kind" "sites_cms"."enum_pages_blocks_offering_history_kind" DEFAULT 'trip',
  	"cta_label" varchar,
  	"cta_href" varchar,
  	"variant" "sites_cms"."enum_pages_blocks_offering_history_variant" DEFAULT 'neutral',
  	"block_name" varchar
  );
  
  CREATE TABLE "sites_cms"."pages_blocks_contact_form" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"_path" text NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"eyebrow" varchar,
  	"heading" varchar,
  	"intro" varchar,
  	"show_phone" boolean DEFAULT false,
  	"message_label" varchar,
  	"message_placeholder" varchar,
  	"submit_label" varchar,
  	"success_text" varchar,
  	"fallback_email" varchar,
  	"variant" "sites_cms"."enum_pages_blocks_contact_form_variant" DEFAULT 'neutral',
  	"block_name" varchar
  );
  
  CREATE TABLE "sites_cms"."pages_blocks_newsletter_signup" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"_path" text NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"eyebrow" varchar,
  	"heading" varchar,
  	"body" varchar,
  	"placeholder" varchar,
  	"button_label" varchar,
  	"small_print" varchar,
  	"variant" "sites_cms"."enum_pages_blocks_newsletter_signup_variant" DEFAULT 'neutral',
  	"block_name" varchar
  );
  
  CREATE TABLE "sites_cms"."_pages_v_blocks_testimonials_testimonial_ids" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"testimonial_id" uuid,
  	"_uuid" varchar
  );
  
  CREATE TABLE "sites_cms"."_pages_v_blocks_destination_grid_destinations" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"destination_id" uuid,
  	"_uuid" varchar
  );
  
  CREATE TABLE "sites_cms"."_pages_v_blocks_destination_grid" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"_path" text NOT NULL,
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"eyebrow" varchar,
  	"heading" varchar,
  	"intro" varchar,
  	"cta_label" varchar,
  	"cta_href" varchar,
  	"variant" "sites_cms"."enum__pages_v_blocks_destination_grid_variant" DEFAULT 'neutral',
  	"_uuid" varchar,
  	"block_name" varchar
  );
  
  CREATE TABLE "sites_cms"."_pages_v_blocks_story_grid" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"_path" text NOT NULL,
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"eyebrow" varchar,
  	"heading" varchar,
  	"intro" varchar,
  	"category_id" uuid,
  	"limit" numeric,
  	"cta_label" varchar,
  	"cta_href" varchar,
  	"variant" "sites_cms"."enum__pages_v_blocks_story_grid_variant" DEFAULT 'neutral',
  	"_uuid" varchar,
  	"block_name" varchar
  );
  
  CREATE TABLE "sites_cms"."_pages_v_blocks_offering_history_series_offering_ids" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"offering_id" varchar,
  	"_uuid" varchar
  );
  
  CREATE TABLE "sites_cms"."_pages_v_blocks_offering_history_series" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"label" varchar,
  	"_uuid" varchar
  );
  
  CREATE TABLE "sites_cms"."_pages_v_blocks_offering_history" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"_path" text NOT NULL,
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"eyebrow" varchar,
  	"heading" varchar,
  	"intro" varchar,
  	"kind" "sites_cms"."enum__pages_v_blocks_offering_history_kind" DEFAULT 'trip',
  	"cta_label" varchar,
  	"cta_href" varchar,
  	"variant" "sites_cms"."enum__pages_v_blocks_offering_history_variant" DEFAULT 'neutral',
  	"_uuid" varchar,
  	"block_name" varchar
  );
  
  CREATE TABLE "sites_cms"."_pages_v_blocks_contact_form" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"_path" text NOT NULL,
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"eyebrow" varchar,
  	"heading" varchar,
  	"intro" varchar,
  	"show_phone" boolean DEFAULT false,
  	"message_label" varchar,
  	"message_placeholder" varchar,
  	"submit_label" varchar,
  	"success_text" varchar,
  	"fallback_email" varchar,
  	"variant" "sites_cms"."enum__pages_v_blocks_contact_form_variant" DEFAULT 'neutral',
  	"_uuid" varchar,
  	"block_name" varchar
  );
  
  CREATE TABLE "sites_cms"."_pages_v_blocks_newsletter_signup" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"_path" text NOT NULL,
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"eyebrow" varchar,
  	"heading" varchar,
  	"body" varchar,
  	"placeholder" varchar,
  	"button_label" varchar,
  	"small_print" varchar,
  	"variant" "sites_cms"."enum__pages_v_blocks_newsletter_signup_variant" DEFAULT 'neutral',
  	"_uuid" varchar,
  	"block_name" varchar
  );
  
  CREATE TABLE "sites_cms"."destinations_seasons_activities" (
  	"_order" integer NOT NULL,
  	"_parent_id" varchar NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"text" varchar
  );
  
  CREATE TABLE "sites_cms"."destinations_seasons" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"heading" varchar,
  	"body" varchar,
  	"image_id" uuid
  );
  
  CREATE TABLE "sites_cms"."destinations_did_you_know" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"text" varchar
  );
  
  CREATE TABLE "sites_cms"."destinations_related_offerings" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"offering_id" varchar
  );
  
  CREATE TABLE "sites_cms"."destinations_gallery" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"media_id" uuid,
  	"alt" varchar
  );
  
  CREATE TABLE "sites_cms"."destinations" (
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"tenant_id" uuid,
  	"title" varchar,
  	"slug" varchar,
  	"country" varchar,
  	"featured_image_id" uuid,
  	"tagline" varchar,
  	"summary" varchar,
  	"facts_language" varchar,
  	"facts_currency" varchar,
  	"facts_religion" varchar,
  	"facts_timezone" varchar,
  	"story_heading" varchar,
  	"body" jsonb,
  	"seo_title" varchar,
  	"seo_description" varchar,
  	"seo_noindex" boolean DEFAULT false,
  	"enabled" boolean DEFAULT true,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"_status" "sites_cms"."enum_destinations_status" DEFAULT 'draft'
  );
  
  CREATE TABLE "sites_cms"."_destinations_v_version_seasons_activities" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"text" varchar,
  	"_uuid" varchar
  );
  
  CREATE TABLE "sites_cms"."_destinations_v_version_seasons" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"heading" varchar,
  	"body" varchar,
  	"image_id" uuid,
  	"_uuid" varchar
  );
  
  CREATE TABLE "sites_cms"."_destinations_v_version_did_you_know" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"text" varchar,
  	"_uuid" varchar
  );
  
  CREATE TABLE "sites_cms"."_destinations_v_version_related_offerings" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"offering_id" varchar,
  	"_uuid" varchar
  );
  
  CREATE TABLE "sites_cms"."_destinations_v_version_gallery" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"media_id" uuid,
  	"alt" varchar,
  	"_uuid" varchar
  );
  
  CREATE TABLE "sites_cms"."_destinations_v" (
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"parent_id" uuid,
  	"version_tenant_id" uuid,
  	"version_title" varchar,
  	"version_slug" varchar,
  	"version_country" varchar,
  	"version_featured_image_id" uuid,
  	"version_tagline" varchar,
  	"version_summary" varchar,
  	"version_facts_language" varchar,
  	"version_facts_currency" varchar,
  	"version_facts_religion" varchar,
  	"version_facts_timezone" varchar,
  	"version_story_heading" varchar,
  	"version_body" jsonb,
  	"version_seo_title" varchar,
  	"version_seo_description" varchar,
  	"version_seo_noindex" boolean DEFAULT false,
  	"version_enabled" boolean DEFAULT true,
  	"version_updated_at" timestamp(3) with time zone,
  	"version_created_at" timestamp(3) with time zone,
  	"version__status" "sites_cms"."enum__destinations_v_version_status" DEFAULT 'draft',
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"latest" boolean
  );
  
  CREATE TABLE "sites_cms"."categories" (
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"tenant_id" uuid,
  	"title" varchar,
  	"slug" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"_status" "sites_cms"."enum_categories_status" DEFAULT 'draft'
  );
  
  CREATE TABLE "sites_cms"."_categories_v" (
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"parent_id" uuid,
  	"version_tenant_id" uuid,
  	"version_title" varchar,
  	"version_slug" varchar,
  	"version_updated_at" timestamp(3) with time zone,
  	"version_created_at" timestamp(3) with time zone,
  	"version__status" "sites_cms"."enum__categories_v_version_status" DEFAULT 'draft',
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"latest" boolean
  );
  
  CREATE TABLE "sites_cms"."stories" (
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"tenant_id" uuid,
  	"title" varchar,
  	"slug" varchar,
  	"published_at" timestamp(3) with time zone,
  	"category_id" uuid,
  	"featured_image_id" uuid,
  	"excerpt" varchar,
  	"content" jsonb,
  	"seo_title" varchar,
  	"seo_description" varchar,
  	"seo_noindex" boolean DEFAULT false,
  	"enabled" boolean DEFAULT true,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"_status" "sites_cms"."enum_stories_status" DEFAULT 'draft'
  );
  
  CREATE TABLE "sites_cms"."_stories_v" (
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"parent_id" uuid,
  	"version_tenant_id" uuid,
  	"version_title" varchar,
  	"version_slug" varchar,
  	"version_published_at" timestamp(3) with time zone,
  	"version_category_id" uuid,
  	"version_featured_image_id" uuid,
  	"version_excerpt" varchar,
  	"version_content" jsonb,
  	"version_seo_title" varchar,
  	"version_seo_description" varchar,
  	"version_seo_noindex" boolean DEFAULT false,
  	"version_enabled" boolean DEFAULT true,
  	"version_updated_at" timestamp(3) with time zone,
  	"version_created_at" timestamp(3) with time zone,
  	"version__status" "sites_cms"."enum__stories_v_version_status" DEFAULT 'draft',
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"latest" boolean
  );
  
  CREATE TABLE "sites_cms"."testimonials" (
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"tenant_id" uuid,
  	"quote" varchar,
  	"reviewer" varchar,
  	"review_date" timestamp(3) with time zone,
  	"trip_name" varchar,
  	"related_offering" varchar,
  	"source_note" varchar,
  	"confirmed_real" boolean DEFAULT false,
  	"enabled" boolean DEFAULT true,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"_status" "sites_cms"."enum_testimonials_status" DEFAULT 'draft'
  );
  
  CREATE TABLE "sites_cms"."_testimonials_v" (
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"parent_id" uuid,
  	"version_tenant_id" uuid,
  	"version_quote" varchar,
  	"version_reviewer" varchar,
  	"version_review_date" timestamp(3) with time zone,
  	"version_trip_name" varchar,
  	"version_related_offering" varchar,
  	"version_source_note" varchar,
  	"version_confirmed_real" boolean DEFAULT false,
  	"version_enabled" boolean DEFAULT true,
  	"version_updated_at" timestamp(3) with time zone,
  	"version_created_at" timestamp(3) with time zone,
  	"version__status" "sites_cms"."enum__testimonials_v_version_status" DEFAULT 'draft',
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"latest" boolean
  );
  
  ALTER TABLE "sites_cms"."pages_blocks_testimonials" ADD COLUMN "from_collection" boolean DEFAULT false;
  ALTER TABLE "sites_cms"."pages_blocks_testimonials" ADD COLUMN "intro" varchar;
  ALTER TABLE "sites_cms"."pages_blocks_testimonials" ADD COLUMN "limit" numeric;
  ALTER TABLE "sites_cms"."pages_blocks_testimonials" ADD COLUMN "cta_label" varchar;
  ALTER TABLE "sites_cms"."pages_blocks_testimonials" ADD COLUMN "cta_href" varchar;
  ALTER TABLE "sites_cms"."_pages_v_blocks_testimonials" ADD COLUMN "from_collection" boolean DEFAULT false;
  ALTER TABLE "sites_cms"."_pages_v_blocks_testimonials" ADD COLUMN "intro" varchar;
  ALTER TABLE "sites_cms"."_pages_v_blocks_testimonials" ADD COLUMN "limit" numeric;
  ALTER TABLE "sites_cms"."_pages_v_blocks_testimonials" ADD COLUMN "cta_label" varchar;
  ALTER TABLE "sites_cms"."_pages_v_blocks_testimonials" ADD COLUMN "cta_href" varchar;
  ALTER TABLE "sites_cms"."payload_locked_documents_rels" ADD COLUMN "destinations_id" uuid;
  ALTER TABLE "sites_cms"."payload_locked_documents_rels" ADD COLUMN "categories_id" uuid;
  ALTER TABLE "sites_cms"."payload_locked_documents_rels" ADD COLUMN "stories_id" uuid;
  ALTER TABLE "sites_cms"."payload_locked_documents_rels" ADD COLUMN "testimonials_id" uuid;
  ALTER TABLE "sites_cms"."pages_blocks_testimonials_testimonial_ids" ADD CONSTRAINT "pages_blocks_testimonials_testimonial_ids_testimonial_id_testimonials_id_fk" FOREIGN KEY ("testimonial_id") REFERENCES "sites_cms"."testimonials"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "sites_cms"."pages_blocks_testimonials_testimonial_ids" ADD CONSTRAINT "pages_blocks_testimonials_testimonial_ids_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."pages_blocks_testimonials"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."pages_blocks_destination_grid_destinations" ADD CONSTRAINT "pages_blocks_destination_grid_destinations_destination_id_destinations_id_fk" FOREIGN KEY ("destination_id") REFERENCES "sites_cms"."destinations"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "sites_cms"."pages_blocks_destination_grid_destinations" ADD CONSTRAINT "pages_blocks_destination_grid_destinations_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."pages_blocks_destination_grid"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."pages_blocks_destination_grid" ADD CONSTRAINT "pages_blocks_destination_grid_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."pages"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."pages_blocks_story_grid" ADD CONSTRAINT "pages_blocks_story_grid_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "sites_cms"."categories"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "sites_cms"."pages_blocks_story_grid" ADD CONSTRAINT "pages_blocks_story_grid_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."pages"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."pages_blocks_offering_history_series_offering_ids" ADD CONSTRAINT "pages_blocks_offering_history_series_offering_ids_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."pages_blocks_offering_history_series"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."pages_blocks_offering_history_series" ADD CONSTRAINT "pages_blocks_offering_history_series_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."pages_blocks_offering_history"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."pages_blocks_offering_history" ADD CONSTRAINT "pages_blocks_offering_history_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."pages"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."pages_blocks_contact_form" ADD CONSTRAINT "pages_blocks_contact_form_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."pages"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."pages_blocks_newsletter_signup" ADD CONSTRAINT "pages_blocks_newsletter_signup_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."pages"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."_pages_v_blocks_testimonials_testimonial_ids" ADD CONSTRAINT "_pages_v_blocks_testimonials_testimonial_ids_testimonial_id_testimonials_id_fk" FOREIGN KEY ("testimonial_id") REFERENCES "sites_cms"."testimonials"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "sites_cms"."_pages_v_blocks_testimonials_testimonial_ids" ADD CONSTRAINT "_pages_v_blocks_testimonials_testimonial_ids_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."_pages_v_blocks_testimonials"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."_pages_v_blocks_destination_grid_destinations" ADD CONSTRAINT "_pages_v_blocks_destination_grid_destinations_destination_id_destinations_id_fk" FOREIGN KEY ("destination_id") REFERENCES "sites_cms"."destinations"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "sites_cms"."_pages_v_blocks_destination_grid_destinations" ADD CONSTRAINT "_pages_v_blocks_destination_grid_destinations_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."_pages_v_blocks_destination_grid"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."_pages_v_blocks_destination_grid" ADD CONSTRAINT "_pages_v_blocks_destination_grid_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."_pages_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."_pages_v_blocks_story_grid" ADD CONSTRAINT "_pages_v_blocks_story_grid_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "sites_cms"."categories"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "sites_cms"."_pages_v_blocks_story_grid" ADD CONSTRAINT "_pages_v_blocks_story_grid_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."_pages_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."_pages_v_blocks_offering_history_series_offering_ids" ADD CONSTRAINT "_pages_v_blocks_offering_history_series_offering_ids_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."_pages_v_blocks_offering_history_series"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."_pages_v_blocks_offering_history_series" ADD CONSTRAINT "_pages_v_blocks_offering_history_series_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."_pages_v_blocks_offering_history"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."_pages_v_blocks_offering_history" ADD CONSTRAINT "_pages_v_blocks_offering_history_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."_pages_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."_pages_v_blocks_contact_form" ADD CONSTRAINT "_pages_v_blocks_contact_form_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."_pages_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."_pages_v_blocks_newsletter_signup" ADD CONSTRAINT "_pages_v_blocks_newsletter_signup_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."_pages_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."destinations_seasons_activities" ADD CONSTRAINT "destinations_seasons_activities_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."destinations_seasons"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."destinations_seasons" ADD CONSTRAINT "destinations_seasons_image_id_media_id_fk" FOREIGN KEY ("image_id") REFERENCES "sites_cms"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "sites_cms"."destinations_seasons" ADD CONSTRAINT "destinations_seasons_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."destinations"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."destinations_did_you_know" ADD CONSTRAINT "destinations_did_you_know_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."destinations"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."destinations_related_offerings" ADD CONSTRAINT "destinations_related_offerings_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."destinations"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."destinations_gallery" ADD CONSTRAINT "destinations_gallery_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "sites_cms"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "sites_cms"."destinations_gallery" ADD CONSTRAINT "destinations_gallery_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."destinations"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."destinations" ADD CONSTRAINT "destinations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "sites_cms"."tenants"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "sites_cms"."destinations" ADD CONSTRAINT "destinations_featured_image_id_media_id_fk" FOREIGN KEY ("featured_image_id") REFERENCES "sites_cms"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "sites_cms"."_destinations_v_version_seasons_activities" ADD CONSTRAINT "_destinations_v_version_seasons_activities_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."_destinations_v_version_seasons"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."_destinations_v_version_seasons" ADD CONSTRAINT "_destinations_v_version_seasons_image_id_media_id_fk" FOREIGN KEY ("image_id") REFERENCES "sites_cms"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "sites_cms"."_destinations_v_version_seasons" ADD CONSTRAINT "_destinations_v_version_seasons_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."_destinations_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."_destinations_v_version_did_you_know" ADD CONSTRAINT "_destinations_v_version_did_you_know_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."_destinations_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."_destinations_v_version_related_offerings" ADD CONSTRAINT "_destinations_v_version_related_offerings_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."_destinations_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."_destinations_v_version_gallery" ADD CONSTRAINT "_destinations_v_version_gallery_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "sites_cms"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "sites_cms"."_destinations_v_version_gallery" ADD CONSTRAINT "_destinations_v_version_gallery_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."_destinations_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."_destinations_v" ADD CONSTRAINT "_destinations_v_parent_id_destinations_id_fk" FOREIGN KEY ("parent_id") REFERENCES "sites_cms"."destinations"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "sites_cms"."_destinations_v" ADD CONSTRAINT "_destinations_v_version_tenant_id_tenants_id_fk" FOREIGN KEY ("version_tenant_id") REFERENCES "sites_cms"."tenants"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "sites_cms"."_destinations_v" ADD CONSTRAINT "_destinations_v_version_featured_image_id_media_id_fk" FOREIGN KEY ("version_featured_image_id") REFERENCES "sites_cms"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "sites_cms"."categories" ADD CONSTRAINT "categories_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "sites_cms"."tenants"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "sites_cms"."_categories_v" ADD CONSTRAINT "_categories_v_parent_id_categories_id_fk" FOREIGN KEY ("parent_id") REFERENCES "sites_cms"."categories"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "sites_cms"."_categories_v" ADD CONSTRAINT "_categories_v_version_tenant_id_tenants_id_fk" FOREIGN KEY ("version_tenant_id") REFERENCES "sites_cms"."tenants"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "sites_cms"."stories" ADD CONSTRAINT "stories_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "sites_cms"."tenants"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "sites_cms"."stories" ADD CONSTRAINT "stories_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "sites_cms"."categories"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "sites_cms"."stories" ADD CONSTRAINT "stories_featured_image_id_media_id_fk" FOREIGN KEY ("featured_image_id") REFERENCES "sites_cms"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "sites_cms"."_stories_v" ADD CONSTRAINT "_stories_v_parent_id_stories_id_fk" FOREIGN KEY ("parent_id") REFERENCES "sites_cms"."stories"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "sites_cms"."_stories_v" ADD CONSTRAINT "_stories_v_version_tenant_id_tenants_id_fk" FOREIGN KEY ("version_tenant_id") REFERENCES "sites_cms"."tenants"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "sites_cms"."_stories_v" ADD CONSTRAINT "_stories_v_version_category_id_categories_id_fk" FOREIGN KEY ("version_category_id") REFERENCES "sites_cms"."categories"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "sites_cms"."_stories_v" ADD CONSTRAINT "_stories_v_version_featured_image_id_media_id_fk" FOREIGN KEY ("version_featured_image_id") REFERENCES "sites_cms"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "sites_cms"."testimonials" ADD CONSTRAINT "testimonials_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "sites_cms"."tenants"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "sites_cms"."_testimonials_v" ADD CONSTRAINT "_testimonials_v_parent_id_testimonials_id_fk" FOREIGN KEY ("parent_id") REFERENCES "sites_cms"."testimonials"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "sites_cms"."_testimonials_v" ADD CONSTRAINT "_testimonials_v_version_tenant_id_tenants_id_fk" FOREIGN KEY ("version_tenant_id") REFERENCES "sites_cms"."tenants"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "pages_blocks_testimonials_testimonial_ids_order_idx" ON "sites_cms"."pages_blocks_testimonials_testimonial_ids" USING btree ("_order");
  CREATE INDEX "pages_blocks_testimonials_testimonial_ids_parent_id_idx" ON "sites_cms"."pages_blocks_testimonials_testimonial_ids" USING btree ("_parent_id");
  CREATE INDEX "pages_blocks_testimonials_testimonial_ids_testimonial_idx" ON "sites_cms"."pages_blocks_testimonials_testimonial_ids" USING btree ("testimonial_id");
  CREATE INDEX "pages_blocks_destination_grid_destinations_order_idx" ON "sites_cms"."pages_blocks_destination_grid_destinations" USING btree ("_order");
  CREATE INDEX "pages_blocks_destination_grid_destinations_parent_id_idx" ON "sites_cms"."pages_blocks_destination_grid_destinations" USING btree ("_parent_id");
  CREATE INDEX "pages_blocks_destination_grid_destinations_destination_idx" ON "sites_cms"."pages_blocks_destination_grid_destinations" USING btree ("destination_id");
  CREATE INDEX "pages_blocks_destination_grid_order_idx" ON "sites_cms"."pages_blocks_destination_grid" USING btree ("_order");
  CREATE INDEX "pages_blocks_destination_grid_parent_id_idx" ON "sites_cms"."pages_blocks_destination_grid" USING btree ("_parent_id");
  CREATE INDEX "pages_blocks_destination_grid_path_idx" ON "sites_cms"."pages_blocks_destination_grid" USING btree ("_path");
  CREATE INDEX "pages_blocks_story_grid_order_idx" ON "sites_cms"."pages_blocks_story_grid" USING btree ("_order");
  CREATE INDEX "pages_blocks_story_grid_parent_id_idx" ON "sites_cms"."pages_blocks_story_grid" USING btree ("_parent_id");
  CREATE INDEX "pages_blocks_story_grid_path_idx" ON "sites_cms"."pages_blocks_story_grid" USING btree ("_path");
  CREATE INDEX "pages_blocks_story_grid_category_idx" ON "sites_cms"."pages_blocks_story_grid" USING btree ("category_id");
  CREATE INDEX "pages_blocks_offering_history_series_offering_ids_order_idx" ON "sites_cms"."pages_blocks_offering_history_series_offering_ids" USING btree ("_order");
  CREATE INDEX "pages_blocks_offering_history_series_offering_ids_parent_id_idx" ON "sites_cms"."pages_blocks_offering_history_series_offering_ids" USING btree ("_parent_id");
  CREATE INDEX "pages_blocks_offering_history_series_order_idx" ON "sites_cms"."pages_blocks_offering_history_series" USING btree ("_order");
  CREATE INDEX "pages_blocks_offering_history_series_parent_id_idx" ON "sites_cms"."pages_blocks_offering_history_series" USING btree ("_parent_id");
  CREATE INDEX "pages_blocks_offering_history_order_idx" ON "sites_cms"."pages_blocks_offering_history" USING btree ("_order");
  CREATE INDEX "pages_blocks_offering_history_parent_id_idx" ON "sites_cms"."pages_blocks_offering_history" USING btree ("_parent_id");
  CREATE INDEX "pages_blocks_offering_history_path_idx" ON "sites_cms"."pages_blocks_offering_history" USING btree ("_path");
  CREATE INDEX "pages_blocks_contact_form_order_idx" ON "sites_cms"."pages_blocks_contact_form" USING btree ("_order");
  CREATE INDEX "pages_blocks_contact_form_parent_id_idx" ON "sites_cms"."pages_blocks_contact_form" USING btree ("_parent_id");
  CREATE INDEX "pages_blocks_contact_form_path_idx" ON "sites_cms"."pages_blocks_contact_form" USING btree ("_path");
  CREATE INDEX "pages_blocks_newsletter_signup_order_idx" ON "sites_cms"."pages_blocks_newsletter_signup" USING btree ("_order");
  CREATE INDEX "pages_blocks_newsletter_signup_parent_id_idx" ON "sites_cms"."pages_blocks_newsletter_signup" USING btree ("_parent_id");
  CREATE INDEX "pages_blocks_newsletter_signup_path_idx" ON "sites_cms"."pages_blocks_newsletter_signup" USING btree ("_path");
  CREATE INDEX "_pages_v_blocks_testimonials_testimonial_ids_order_idx" ON "sites_cms"."_pages_v_blocks_testimonials_testimonial_ids" USING btree ("_order");
  CREATE INDEX "_pages_v_blocks_testimonials_testimonial_ids_parent_id_idx" ON "sites_cms"."_pages_v_blocks_testimonials_testimonial_ids" USING btree ("_parent_id");
  CREATE INDEX "_pages_v_blocks_testimonials_testimonial_ids_testimonial_idx" ON "sites_cms"."_pages_v_blocks_testimonials_testimonial_ids" USING btree ("testimonial_id");
  CREATE INDEX "_pages_v_blocks_destination_grid_destinations_order_idx" ON "sites_cms"."_pages_v_blocks_destination_grid_destinations" USING btree ("_order");
  CREATE INDEX "_pages_v_blocks_destination_grid_destinations_parent_id_idx" ON "sites_cms"."_pages_v_blocks_destination_grid_destinations" USING btree ("_parent_id");
  CREATE INDEX "_pages_v_blocks_destination_grid_destinations_destinatio_idx" ON "sites_cms"."_pages_v_blocks_destination_grid_destinations" USING btree ("destination_id");
  CREATE INDEX "_pages_v_blocks_destination_grid_order_idx" ON "sites_cms"."_pages_v_blocks_destination_grid" USING btree ("_order");
  CREATE INDEX "_pages_v_blocks_destination_grid_parent_id_idx" ON "sites_cms"."_pages_v_blocks_destination_grid" USING btree ("_parent_id");
  CREATE INDEX "_pages_v_blocks_destination_grid_path_idx" ON "sites_cms"."_pages_v_blocks_destination_grid" USING btree ("_path");
  CREATE INDEX "_pages_v_blocks_story_grid_order_idx" ON "sites_cms"."_pages_v_blocks_story_grid" USING btree ("_order");
  CREATE INDEX "_pages_v_blocks_story_grid_parent_id_idx" ON "sites_cms"."_pages_v_blocks_story_grid" USING btree ("_parent_id");
  CREATE INDEX "_pages_v_blocks_story_grid_path_idx" ON "sites_cms"."_pages_v_blocks_story_grid" USING btree ("_path");
  CREATE INDEX "_pages_v_blocks_story_grid_category_idx" ON "sites_cms"."_pages_v_blocks_story_grid" USING btree ("category_id");
  CREATE INDEX "_pages_v_blocks_offering_history_series_offering_ids_order_idx" ON "sites_cms"."_pages_v_blocks_offering_history_series_offering_ids" USING btree ("_order");
  CREATE INDEX "_pages_v_blocks_offering_history_series_offering_ids_parent_id_idx" ON "sites_cms"."_pages_v_blocks_offering_history_series_offering_ids" USING btree ("_parent_id");
  CREATE INDEX "_pages_v_blocks_offering_history_series_order_idx" ON "sites_cms"."_pages_v_blocks_offering_history_series" USING btree ("_order");
  CREATE INDEX "_pages_v_blocks_offering_history_series_parent_id_idx" ON "sites_cms"."_pages_v_blocks_offering_history_series" USING btree ("_parent_id");
  CREATE INDEX "_pages_v_blocks_offering_history_order_idx" ON "sites_cms"."_pages_v_blocks_offering_history" USING btree ("_order");
  CREATE INDEX "_pages_v_blocks_offering_history_parent_id_idx" ON "sites_cms"."_pages_v_blocks_offering_history" USING btree ("_parent_id");
  CREATE INDEX "_pages_v_blocks_offering_history_path_idx" ON "sites_cms"."_pages_v_blocks_offering_history" USING btree ("_path");
  CREATE INDEX "_pages_v_blocks_contact_form_order_idx" ON "sites_cms"."_pages_v_blocks_contact_form" USING btree ("_order");
  CREATE INDEX "_pages_v_blocks_contact_form_parent_id_idx" ON "sites_cms"."_pages_v_blocks_contact_form" USING btree ("_parent_id");
  CREATE INDEX "_pages_v_blocks_contact_form_path_idx" ON "sites_cms"."_pages_v_blocks_contact_form" USING btree ("_path");
  CREATE INDEX "_pages_v_blocks_newsletter_signup_order_idx" ON "sites_cms"."_pages_v_blocks_newsletter_signup" USING btree ("_order");
  CREATE INDEX "_pages_v_blocks_newsletter_signup_parent_id_idx" ON "sites_cms"."_pages_v_blocks_newsletter_signup" USING btree ("_parent_id");
  CREATE INDEX "_pages_v_blocks_newsletter_signup_path_idx" ON "sites_cms"."_pages_v_blocks_newsletter_signup" USING btree ("_path");
  CREATE INDEX "destinations_seasons_activities_order_idx" ON "sites_cms"."destinations_seasons_activities" USING btree ("_order");
  CREATE INDEX "destinations_seasons_activities_parent_id_idx" ON "sites_cms"."destinations_seasons_activities" USING btree ("_parent_id");
  CREATE INDEX "destinations_seasons_order_idx" ON "sites_cms"."destinations_seasons" USING btree ("_order");
  CREATE INDEX "destinations_seasons_parent_id_idx" ON "sites_cms"."destinations_seasons" USING btree ("_parent_id");
  CREATE INDEX "destinations_seasons_image_idx" ON "sites_cms"."destinations_seasons" USING btree ("image_id");
  CREATE INDEX "destinations_did_you_know_order_idx" ON "sites_cms"."destinations_did_you_know" USING btree ("_order");
  CREATE INDEX "destinations_did_you_know_parent_id_idx" ON "sites_cms"."destinations_did_you_know" USING btree ("_parent_id");
  CREATE INDEX "destinations_related_offerings_order_idx" ON "sites_cms"."destinations_related_offerings" USING btree ("_order");
  CREATE INDEX "destinations_related_offerings_parent_id_idx" ON "sites_cms"."destinations_related_offerings" USING btree ("_parent_id");
  CREATE INDEX "destinations_gallery_order_idx" ON "sites_cms"."destinations_gallery" USING btree ("_order");
  CREATE INDEX "destinations_gallery_parent_id_idx" ON "sites_cms"."destinations_gallery" USING btree ("_parent_id");
  CREATE INDEX "destinations_gallery_media_idx" ON "sites_cms"."destinations_gallery" USING btree ("media_id");
  CREATE INDEX "destinations_tenant_idx" ON "sites_cms"."destinations" USING btree ("tenant_id");
  CREATE INDEX "destinations_featured_image_idx" ON "sites_cms"."destinations" USING btree ("featured_image_id");
  CREATE INDEX "destinations_updated_at_idx" ON "sites_cms"."destinations" USING btree ("updated_at");
  CREATE INDEX "destinations_created_at_idx" ON "sites_cms"."destinations" USING btree ("created_at");
  CREATE INDEX "destinations__status_idx" ON "sites_cms"."destinations" USING btree ("_status");
  CREATE INDEX "_destinations_v_version_seasons_activities_order_idx" ON "sites_cms"."_destinations_v_version_seasons_activities" USING btree ("_order");
  CREATE INDEX "_destinations_v_version_seasons_activities_parent_id_idx" ON "sites_cms"."_destinations_v_version_seasons_activities" USING btree ("_parent_id");
  CREATE INDEX "_destinations_v_version_seasons_order_idx" ON "sites_cms"."_destinations_v_version_seasons" USING btree ("_order");
  CREATE INDEX "_destinations_v_version_seasons_parent_id_idx" ON "sites_cms"."_destinations_v_version_seasons" USING btree ("_parent_id");
  CREATE INDEX "_destinations_v_version_seasons_image_idx" ON "sites_cms"."_destinations_v_version_seasons" USING btree ("image_id");
  CREATE INDEX "_destinations_v_version_did_you_know_order_idx" ON "sites_cms"."_destinations_v_version_did_you_know" USING btree ("_order");
  CREATE INDEX "_destinations_v_version_did_you_know_parent_id_idx" ON "sites_cms"."_destinations_v_version_did_you_know" USING btree ("_parent_id");
  CREATE INDEX "_destinations_v_version_related_offerings_order_idx" ON "sites_cms"."_destinations_v_version_related_offerings" USING btree ("_order");
  CREATE INDEX "_destinations_v_version_related_offerings_parent_id_idx" ON "sites_cms"."_destinations_v_version_related_offerings" USING btree ("_parent_id");
  CREATE INDEX "_destinations_v_version_gallery_order_idx" ON "sites_cms"."_destinations_v_version_gallery" USING btree ("_order");
  CREATE INDEX "_destinations_v_version_gallery_parent_id_idx" ON "sites_cms"."_destinations_v_version_gallery" USING btree ("_parent_id");
  CREATE INDEX "_destinations_v_version_gallery_media_idx" ON "sites_cms"."_destinations_v_version_gallery" USING btree ("media_id");
  CREATE INDEX "_destinations_v_parent_idx" ON "sites_cms"."_destinations_v" USING btree ("parent_id");
  CREATE INDEX "_destinations_v_version_version_tenant_idx" ON "sites_cms"."_destinations_v" USING btree ("version_tenant_id");
  CREATE INDEX "_destinations_v_version_version_featured_image_idx" ON "sites_cms"."_destinations_v" USING btree ("version_featured_image_id");
  CREATE INDEX "_destinations_v_version_version_updated_at_idx" ON "sites_cms"."_destinations_v" USING btree ("version_updated_at");
  CREATE INDEX "_destinations_v_version_version_created_at_idx" ON "sites_cms"."_destinations_v" USING btree ("version_created_at");
  CREATE INDEX "_destinations_v_version_version__status_idx" ON "sites_cms"."_destinations_v" USING btree ("version__status");
  CREATE INDEX "_destinations_v_created_at_idx" ON "sites_cms"."_destinations_v" USING btree ("created_at");
  CREATE INDEX "_destinations_v_updated_at_idx" ON "sites_cms"."_destinations_v" USING btree ("updated_at");
  CREATE INDEX "_destinations_v_latest_idx" ON "sites_cms"."_destinations_v" USING btree ("latest");
  CREATE INDEX "categories_tenant_idx" ON "sites_cms"."categories" USING btree ("tenant_id");
  CREATE INDEX "categories_updated_at_idx" ON "sites_cms"."categories" USING btree ("updated_at");
  CREATE INDEX "categories_created_at_idx" ON "sites_cms"."categories" USING btree ("created_at");
  CREATE INDEX "categories__status_idx" ON "sites_cms"."categories" USING btree ("_status");
  CREATE INDEX "_categories_v_parent_idx" ON "sites_cms"."_categories_v" USING btree ("parent_id");
  CREATE INDEX "_categories_v_version_version_tenant_idx" ON "sites_cms"."_categories_v" USING btree ("version_tenant_id");
  CREATE INDEX "_categories_v_version_version_updated_at_idx" ON "sites_cms"."_categories_v" USING btree ("version_updated_at");
  CREATE INDEX "_categories_v_version_version_created_at_idx" ON "sites_cms"."_categories_v" USING btree ("version_created_at");
  CREATE INDEX "_categories_v_version_version__status_idx" ON "sites_cms"."_categories_v" USING btree ("version__status");
  CREATE INDEX "_categories_v_created_at_idx" ON "sites_cms"."_categories_v" USING btree ("created_at");
  CREATE INDEX "_categories_v_updated_at_idx" ON "sites_cms"."_categories_v" USING btree ("updated_at");
  CREATE INDEX "_categories_v_latest_idx" ON "sites_cms"."_categories_v" USING btree ("latest");
  CREATE INDEX "stories_tenant_idx" ON "sites_cms"."stories" USING btree ("tenant_id");
  CREATE INDEX "stories_category_idx" ON "sites_cms"."stories" USING btree ("category_id");
  CREATE INDEX "stories_featured_image_idx" ON "sites_cms"."stories" USING btree ("featured_image_id");
  CREATE INDEX "stories_updated_at_idx" ON "sites_cms"."stories" USING btree ("updated_at");
  CREATE INDEX "stories_created_at_idx" ON "sites_cms"."stories" USING btree ("created_at");
  CREATE INDEX "stories__status_idx" ON "sites_cms"."stories" USING btree ("_status");
  CREATE INDEX "_stories_v_parent_idx" ON "sites_cms"."_stories_v" USING btree ("parent_id");
  CREATE INDEX "_stories_v_version_version_tenant_idx" ON "sites_cms"."_stories_v" USING btree ("version_tenant_id");
  CREATE INDEX "_stories_v_version_version_category_idx" ON "sites_cms"."_stories_v" USING btree ("version_category_id");
  CREATE INDEX "_stories_v_version_version_featured_image_idx" ON "sites_cms"."_stories_v" USING btree ("version_featured_image_id");
  CREATE INDEX "_stories_v_version_version_updated_at_idx" ON "sites_cms"."_stories_v" USING btree ("version_updated_at");
  CREATE INDEX "_stories_v_version_version_created_at_idx" ON "sites_cms"."_stories_v" USING btree ("version_created_at");
  CREATE INDEX "_stories_v_version_version__status_idx" ON "sites_cms"."_stories_v" USING btree ("version__status");
  CREATE INDEX "_stories_v_created_at_idx" ON "sites_cms"."_stories_v" USING btree ("created_at");
  CREATE INDEX "_stories_v_updated_at_idx" ON "sites_cms"."_stories_v" USING btree ("updated_at");
  CREATE INDEX "_stories_v_latest_idx" ON "sites_cms"."_stories_v" USING btree ("latest");
  CREATE INDEX "testimonials_tenant_idx" ON "sites_cms"."testimonials" USING btree ("tenant_id");
  CREATE INDEX "testimonials_updated_at_idx" ON "sites_cms"."testimonials" USING btree ("updated_at");
  CREATE INDEX "testimonials_created_at_idx" ON "sites_cms"."testimonials" USING btree ("created_at");
  CREATE INDEX "testimonials__status_idx" ON "sites_cms"."testimonials" USING btree ("_status");
  CREATE INDEX "_testimonials_v_parent_idx" ON "sites_cms"."_testimonials_v" USING btree ("parent_id");
  CREATE INDEX "_testimonials_v_version_version_tenant_idx" ON "sites_cms"."_testimonials_v" USING btree ("version_tenant_id");
  CREATE INDEX "_testimonials_v_version_version_updated_at_idx" ON "sites_cms"."_testimonials_v" USING btree ("version_updated_at");
  CREATE INDEX "_testimonials_v_version_version_created_at_idx" ON "sites_cms"."_testimonials_v" USING btree ("version_created_at");
  CREATE INDEX "_testimonials_v_version_version__status_idx" ON "sites_cms"."_testimonials_v" USING btree ("version__status");
  CREATE INDEX "_testimonials_v_created_at_idx" ON "sites_cms"."_testimonials_v" USING btree ("created_at");
  CREATE INDEX "_testimonials_v_updated_at_idx" ON "sites_cms"."_testimonials_v" USING btree ("updated_at");
  CREATE INDEX "_testimonials_v_latest_idx" ON "sites_cms"."_testimonials_v" USING btree ("latest");
  ALTER TABLE "sites_cms"."payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_destinations_fk" FOREIGN KEY ("destinations_id") REFERENCES "sites_cms"."destinations"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_categories_fk" FOREIGN KEY ("categories_id") REFERENCES "sites_cms"."categories"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_stories_fk" FOREIGN KEY ("stories_id") REFERENCES "sites_cms"."stories"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_testimonials_fk" FOREIGN KEY ("testimonials_id") REFERENCES "sites_cms"."testimonials"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_destinations_id_idx" ON "sites_cms"."payload_locked_documents_rels" USING btree ("destinations_id");
  CREATE INDEX "payload_locked_documents_rels_categories_id_idx" ON "sites_cms"."payload_locked_documents_rels" USING btree ("categories_id");
  CREATE INDEX "payload_locked_documents_rels_stories_id_idx" ON "sites_cms"."payload_locked_documents_rels" USING btree ("stories_id");
  CREATE INDEX "payload_locked_documents_rels_testimonials_id_idx" ON "sites_cms"."payload_locked_documents_rels" USING btree ("testimonials_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "sites_cms"."pages_blocks_testimonials_testimonial_ids" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "sites_cms"."pages_blocks_destination_grid_destinations" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "sites_cms"."pages_blocks_destination_grid" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "sites_cms"."pages_blocks_story_grid" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "sites_cms"."pages_blocks_offering_history_series_offering_ids" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "sites_cms"."pages_blocks_offering_history_series" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "sites_cms"."pages_blocks_offering_history" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "sites_cms"."pages_blocks_contact_form" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "sites_cms"."pages_blocks_newsletter_signup" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "sites_cms"."_pages_v_blocks_testimonials_testimonial_ids" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "sites_cms"."_pages_v_blocks_destination_grid_destinations" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "sites_cms"."_pages_v_blocks_destination_grid" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "sites_cms"."_pages_v_blocks_story_grid" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "sites_cms"."_pages_v_blocks_offering_history_series_offering_ids" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "sites_cms"."_pages_v_blocks_offering_history_series" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "sites_cms"."_pages_v_blocks_offering_history" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "sites_cms"."_pages_v_blocks_contact_form" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "sites_cms"."_pages_v_blocks_newsletter_signup" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "sites_cms"."destinations_seasons_activities" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "sites_cms"."destinations_seasons" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "sites_cms"."destinations_did_you_know" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "sites_cms"."destinations_related_offerings" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "sites_cms"."destinations_gallery" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "sites_cms"."destinations" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "sites_cms"."_destinations_v_version_seasons_activities" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "sites_cms"."_destinations_v_version_seasons" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "sites_cms"."_destinations_v_version_did_you_know" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "sites_cms"."_destinations_v_version_related_offerings" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "sites_cms"."_destinations_v_version_gallery" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "sites_cms"."_destinations_v" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "sites_cms"."categories" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "sites_cms"."_categories_v" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "sites_cms"."stories" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "sites_cms"."_stories_v" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "sites_cms"."testimonials" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "sites_cms"."_testimonials_v" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "sites_cms"."pages_blocks_testimonials_testimonial_ids" CASCADE;
  DROP TABLE "sites_cms"."pages_blocks_destination_grid_destinations" CASCADE;
  DROP TABLE "sites_cms"."pages_blocks_destination_grid" CASCADE;
  DROP TABLE "sites_cms"."pages_blocks_story_grid" CASCADE;
  DROP TABLE "sites_cms"."pages_blocks_offering_history_series_offering_ids" CASCADE;
  DROP TABLE "sites_cms"."pages_blocks_offering_history_series" CASCADE;
  DROP TABLE "sites_cms"."pages_blocks_offering_history" CASCADE;
  DROP TABLE "sites_cms"."pages_blocks_contact_form" CASCADE;
  DROP TABLE "sites_cms"."pages_blocks_newsletter_signup" CASCADE;
  DROP TABLE "sites_cms"."_pages_v_blocks_testimonials_testimonial_ids" CASCADE;
  DROP TABLE "sites_cms"."_pages_v_blocks_destination_grid_destinations" CASCADE;
  DROP TABLE "sites_cms"."_pages_v_blocks_destination_grid" CASCADE;
  DROP TABLE "sites_cms"."_pages_v_blocks_story_grid" CASCADE;
  DROP TABLE "sites_cms"."_pages_v_blocks_offering_history_series_offering_ids" CASCADE;
  DROP TABLE "sites_cms"."_pages_v_blocks_offering_history_series" CASCADE;
  DROP TABLE "sites_cms"."_pages_v_blocks_offering_history" CASCADE;
  DROP TABLE "sites_cms"."_pages_v_blocks_contact_form" CASCADE;
  DROP TABLE "sites_cms"."_pages_v_blocks_newsletter_signup" CASCADE;
  DROP TABLE "sites_cms"."destinations_seasons_activities" CASCADE;
  DROP TABLE "sites_cms"."destinations_seasons" CASCADE;
  DROP TABLE "sites_cms"."destinations_did_you_know" CASCADE;
  DROP TABLE "sites_cms"."destinations_related_offerings" CASCADE;
  DROP TABLE "sites_cms"."destinations_gallery" CASCADE;
  DROP TABLE "sites_cms"."destinations" CASCADE;
  DROP TABLE "sites_cms"."_destinations_v_version_seasons_activities" CASCADE;
  DROP TABLE "sites_cms"."_destinations_v_version_seasons" CASCADE;
  DROP TABLE "sites_cms"."_destinations_v_version_did_you_know" CASCADE;
  DROP TABLE "sites_cms"."_destinations_v_version_related_offerings" CASCADE;
  DROP TABLE "sites_cms"."_destinations_v_version_gallery" CASCADE;
  DROP TABLE "sites_cms"."_destinations_v" CASCADE;
  DROP TABLE "sites_cms"."categories" CASCADE;
  DROP TABLE "sites_cms"."_categories_v" CASCADE;
  DROP TABLE "sites_cms"."stories" CASCADE;
  DROP TABLE "sites_cms"."_stories_v" CASCADE;
  DROP TABLE "sites_cms"."testimonials" CASCADE;
  DROP TABLE "sites_cms"."_testimonials_v" CASCADE;
  ALTER TABLE "sites_cms"."payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_destinations_fk";
  
  ALTER TABLE "sites_cms"."payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_categories_fk";
  
  ALTER TABLE "sites_cms"."payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_stories_fk";
  
  ALTER TABLE "sites_cms"."payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_testimonials_fk";
  
  DROP INDEX "sites_cms"."payload_locked_documents_rels_destinations_id_idx";
  DROP INDEX "sites_cms"."payload_locked_documents_rels_categories_id_idx";
  DROP INDEX "sites_cms"."payload_locked_documents_rels_stories_id_idx";
  DROP INDEX "sites_cms"."payload_locked_documents_rels_testimonials_id_idx";
  ALTER TABLE "sites_cms"."pages_blocks_testimonials" DROP COLUMN "from_collection";
  ALTER TABLE "sites_cms"."pages_blocks_testimonials" DROP COLUMN "intro";
  ALTER TABLE "sites_cms"."pages_blocks_testimonials" DROP COLUMN "limit";
  ALTER TABLE "sites_cms"."pages_blocks_testimonials" DROP COLUMN "cta_label";
  ALTER TABLE "sites_cms"."pages_blocks_testimonials" DROP COLUMN "cta_href";
  ALTER TABLE "sites_cms"."_pages_v_blocks_testimonials" DROP COLUMN "from_collection";
  ALTER TABLE "sites_cms"."_pages_v_blocks_testimonials" DROP COLUMN "intro";
  ALTER TABLE "sites_cms"."_pages_v_blocks_testimonials" DROP COLUMN "limit";
  ALTER TABLE "sites_cms"."_pages_v_blocks_testimonials" DROP COLUMN "cta_label";
  ALTER TABLE "sites_cms"."_pages_v_blocks_testimonials" DROP COLUMN "cta_href";
  ALTER TABLE "sites_cms"."payload_locked_documents_rels" DROP COLUMN "destinations_id";
  ALTER TABLE "sites_cms"."payload_locked_documents_rels" DROP COLUMN "categories_id";
  ALTER TABLE "sites_cms"."payload_locked_documents_rels" DROP COLUMN "stories_id";
  ALTER TABLE "sites_cms"."payload_locked_documents_rels" DROP COLUMN "testimonials_id";
  DROP TYPE "sites_cms"."enum_pages_blocks_destination_grid_variant";
  DROP TYPE "sites_cms"."enum_pages_blocks_story_grid_variant";
  DROP TYPE "sites_cms"."enum_pages_blocks_offering_history_kind";
  DROP TYPE "sites_cms"."enum_pages_blocks_offering_history_variant";
  DROP TYPE "sites_cms"."enum_pages_blocks_contact_form_variant";
  DROP TYPE "sites_cms"."enum_pages_blocks_newsletter_signup_variant";
  DROP TYPE "sites_cms"."enum__pages_v_blocks_destination_grid_variant";
  DROP TYPE "sites_cms"."enum__pages_v_blocks_story_grid_variant";
  DROP TYPE "sites_cms"."enum__pages_v_blocks_offering_history_kind";
  DROP TYPE "sites_cms"."enum__pages_v_blocks_offering_history_variant";
  DROP TYPE "sites_cms"."enum__pages_v_blocks_contact_form_variant";
  DROP TYPE "sites_cms"."enum__pages_v_blocks_newsletter_signup_variant";
  DROP TYPE "sites_cms"."enum_destinations_status";
  DROP TYPE "sites_cms"."enum__destinations_v_version_status";
  DROP TYPE "sites_cms"."enum_categories_status";
  DROP TYPE "sites_cms"."enum__categories_v_version_status";
  DROP TYPE "sites_cms"."enum_stories_status";
  DROP TYPE "sites_cms"."enum__stories_v_version_status";
  DROP TYPE "sites_cms"."enum_testimonials_status";
  DROP TYPE "sites_cms"."enum__testimonials_v_version_status";`)
}
