# INVESTIGATION ORCH-0825 — Business App Venue-Claim Integration Audit

**Mode:** INVESTIGATE (read-only, integration patterns brainstormed with tradeoffs but no winners picked)
**Dispatched by:** Claude `mingla-orchestrator`
**Dispatch artifact:** `Mingla_Artifacts/prompts/FORENSICS_ORCH-0825_BUSINESS_APP_VENUE_CLAIM_INTEGRATION_AUDIT.md`
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Audit window:** 2026-05-13
**Forensics confidence on critical findings:** H (direct file reads, migration chain verified)

---

## Executive Summary (Plain English, Read This First)

**What the business app is today.** The Mingla Business app is a mature, production-shipping operator surface organized around **brands** (organizer identity, with optional venue semantics), **events** (the things the operator sells tickets to), **orders** (buyer purchases through Stripe Connect), and **marketing** (Phase A audience + composer for blasting buyers). It has 5 bottom-nav tabs (Home / Events / Ari / Blast / Account), a fully-shipped Stripe Connect onboarding, an AI assistant (Ari) with 5 wired tools, a transactional-email branding pipeline (Resend), and 56 routes covering brand management, event management, ticket scanning, door sales, guests, refunds, and audit logs.

**The single most important finding.** The brand schema already includes a `kind` column with values `'physical'` (owns/leases a venue, renders an address) and `'popup'` (operates across multiple venues). The brand-vs-venue distinction the operator brainstormed is **already baked into the schema** — but the schema treats `brands.address` as a single freeform `text` field with no structured place data (no `place_id`, no `lat/lng`, no `city`, no `country_code`). Meanwhile, `events.location_geo` (point), `events.city` (text, Google-derived), and `events.location_text` (freeform) already capture structured location data **at the event level**, via the existing `googlePlacesService.ts` autocomplete shipped in ORCH-0824. The plumbing exists; it's just not wired to a venue identity yet.

**The brand-vs-venue question is not "do we add a venue concept" — it's "do we deepen `brands.kind='physical'` so it carries structured venue identity, or sit a venue-listing table alongside brands?"** The audit lays out three integration patterns in §9 with tradeoffs; operator decides.

**Place_pool is completely siloed from the business app today.** Zero references in `mingla-business/src/` or `mingla-business/app/`. The consumer app's place-pool database and the business app's brand/event database are two parallel universes. Bridging them is a NEW edge function + service-layer pattern, not a refactor.

**Stripe Connect is mature and already attached to brands.** `brands.stripe_connect_id`, `brands.stripe_payouts_enabled`, `brands.stripe_charges_enabled` columns plus `brand/[id]/payments/onboard.tsx` flow. If a venue listing becomes (or is) a brand of `kind='physical'`, Stripe inheriting is automatic. If it's a sibling table, we'd need to either re-onboard Stripe per venue or share the brand's Stripe state — adds complexity.

**The three biggest integration risks** are: (1) the brand-vs-venue conceptual collision if the data model isn't decided up front (everything downstream breaks if we change it mid-build); (2) Ari already has a `create_brand` tool — if claim becomes a NEW brand-creation path, Ari's tool surface needs to be expanded carefully to avoid duplicate concepts; (3) `brands_public_view` filters to brands with at least one **public live event** — meaning a venue that claims but never hosts an event today does NOT appear in any public surface. The proposed consumer-side display of claimed listings would require either changing this view's contract or introducing a parallel surfacing path.

**Recommended direction (orchestrator + operator decide).** Pattern A in §9 — "venue listing IS a brand of kind='physical' with structured place data added via sidecar columns" — is the lowest-risk integration. It reuses the existing brand/Stripe/marketing/Ari surface, only adds a few columns + an optional sidecar `brand_place_pool_link` table, and frames the wizard as "create your brand with our help" rather than "create a separate listing thing."

**Open questions for operator** are listed at the bottom of this report — 8 forks the audit hit where forensics cannot resolve without operator input.

---

## Phase 0 Ingestion (Required Context Read Before Audit)

### Memory consulted

- `feedback_mingla_positioning.md` — Mingla is an experience app, not dating. Venue claim must be framed within the experience-app positioning.
- `project_marketing_hub_strategy.md` — Marketing Hub mapped to Cycle B5, Phase 7 Post-MVP. Hard-gated on B2/B3/B4 shipping + 4 weeks stable.
- `project_orch_0815_b_polish_deferred.md` — Phase B minimal composer + simple-card email shipped intentionally. Polish deferred to feedback-driven Sub-C.
- `feedback_ai_categories_decommissioned.md` — `place_pool.seeding_category` + `ai_categories` etc. are DROPPED columns post-ORCH-0700. Replacement is matview `admin_place_pool_mv.primary_category` + helper `pg_map_primary_type_to_mingla_category(primary_type, types)` + signal scorer.
- `feedback_bouncer_chain_rules_in_code.md` — Bouncer chain rules live as code constants in `supabase/functions/_shared/bouncerChainRules.ts`. Authoritative source for chain/snack classification.
- `feedback_anon_buyer_routes.md` — `/checkout/[eventId]`, `/e/[brandSlug]/[eventSlug]`, `/b/[brandSlug]` MUST live outside `app/(tabs)/` and never call `useAuth`.
- `feedback_zustand_persist_no_server_snapshots.md` — `partialize` MUST NOT include server records.
- `feedback_verify_db_column_names_before_writing_queries.md` — TS types are camelCased mappings, NOT raw column names. Always cite migration.

### Strategy artifacts consulted (top-of-file scan)

- `Mingla_Artifacts/BUSINESS_PRD.md` — present, scope-establishing.
- `Mingla_Artifacts/MINGLA_BUSINESS_MARKETING_HUB_STRATEGY.md` — Cycle B5 marketing hub strategy (DEC-149 dual-surface).
- `Mingla_Artifacts/MINGLA_BRAIN_AGENT_STRATEGY.md` — Ari AI assistant strategy.

### Close notes consulted

- ORCH-0776 (event cover video processing) — covers Supabase Storage video pipeline.
- ORCH-0777 (production ticket checkout) — Stripe checkout flow, RLS contracts.
- ORCH-0785 (transactional email branding) — Resend integration, three-sender shell.
- ORCH-0786 (creator avatar upload) — pattern for image-upload-with-overlay-on-existing-data (precedent for photo override logic in claim flow).
- ORCH-0787 (order refund + cancel) — Stripe RAK + refund flow.
- ORCH-0807 / 0808 / 0809 — Marketing Hub Phase A foundations.
- ORCH-0815-A/A2/B — Marketing Hub Phase A composer + audience + brand-buyers tab.
- ORCH-0821 (Ari MVP) — five Gemini tools, agent_* tables, user-JWT-only invariant.
- ORCH-0824 (Business events in consumer Discover) — Google Places autocomplete in mingla-business, `events.city` column.

### World Map state

- Latest registered ORCH-IDs run through 0822 (Twilio TFV rejection), 0823 (event wizard space caps-lock), 0824 (business events in consumer Discover).
- This audit registers as ORCH-0825 informally; formalization is the orchestrator's call after operator reviews.

---

## §1 — Surface Inventory (Comprehensive)

This section maps every operator-facing and public-facing screen reachable from the business app's entry points.

### 1.1 Bottom-nav tab structure

Source: `mingla-business/app/(tabs)/_layout.tsx:23-39`

The tab bar has 5 entries:

| Slot | Tab ID | Icon | Label | File |
|------|--------|------|-------|------|
| 1 | `home` | home | Home | `app/(tabs)/home.tsx` |
| 2 | `events` | calendar | Events | `app/(tabs)/events.tsx` |
| 3 | `ari` | sparkle | Ari | `app/(tabs)/ari.tsx` |
| 4 | `marketing` | send | Blast | `app/(tabs)/marketing/index.tsx` |
| 5 | `account` | user | Account | `app/(tabs)/account.tsx` |

The marketing tab's label is "Blast" (verb) but the route id stays `marketing` (so nested routes resolve). Ari sits center per DEC-073 thumb-zone redesign in ORCH-0815-B.

Confidence: H (file read end-to-end).

### 1.2 Home tab — operator's executive dashboard

**File:** `app/(tabs)/home.tsx` (613 lines)

Plain English: this is the first thing the operator sees after sign-in. It shows their brand (or asks them to pick/create one), a live event hero if any, a 7-day revenue card if no live event, and a list of upcoming/draft events.

Reads:
- `useBrands()` → React Query, the operator's brands
- `useCurrentBrand()` → Zustand current-brand context
- `useBusinessEventsForBrand()` → server-backed live events
- `useLiveEventsForBrand()` + `useDraftsForBrand()` → Zustand legacy stores
- `useEventSalesSummaries()` → server-truth sales rollup

Writes (indirect):
- Brand creation via `BrandSwitcherSheet` (calls `useCreateBrand`)
- Local lifecycle mutations via Zustand `updateLifecycle()`

Critical for claim flow: this is **the natural entry point** for "claim a venue" CTA if the operator's first brand is a venue. Alternatively, the BrandSwitcherSheet (already mounted on Home) is the natural mount point for the new wizard.

Confidence: H.

### 1.3 Events tab — unified event pipeline

**File:** `app/(tabs)/events.tsx` (893 lines)

Plain English: every event the operator has ever touched. Filter pills (All / Live / Upcoming / Drafts / Past). Three-dot manage menu per row (Edit / View Public / Share / End Sales / Cancel / Delete / View Orders). FAB to create.

Reads: same event/brand stack as Home, plus `useCurrentBrandRole()` for permission checks on create/edit.

Writes: server cancel + end-sales mutations, server draft discard, Zustand legacy lifecycle.

Critical for claim flow: not directly. But the event-create wizard (`event/create.tsx` → `event/[id]/edit.tsx` step machine) is the only existing "wizard"-style UI in the business app and **uses the SAME `googlePlacesService.ts`** the claim flow would need.

Confidence: H.

### 1.4 Ari tab — AI assistant

**File:** `app/(tabs)/ari.tsx` (12 lines, route wrapper)

Plain English: chat-style interface with Mingla's AI assistant (Ari). She has 5 tools today: create brand, create event, list brands, list events, update event. Each operation Ari proposes a confirmation card the operator can Cancel / Edit / Confirm before the write actually happens.

Tool surface (from `supabase/functions/_shared/agentTools.ts`):
- `create_brand` (line 97) — args: name, optional kind, address, currency etc.
- `create_event` (line 161)
- `list_brands` (line 237)
- `list_events` (line 264)
- `update_event` (line 300)

Authority model:
- I-ARI-USER-JWT-ONLY — executors NEVER use service role; the user's JWT is the final RLS wall.
- I-ARI-CONFIRM-AUTHORITY — every write is proposed as a confirmation card, model never writes directly.
- I-ARI-USER-DATA-WRAP — user-stored data wrapped in `<user_data>` delimiters before Gemini.

Critical for claim flow: if the claim flow becomes a brand-creation path (Pattern A in §9), Ari's `create_brand` tool needs to either (a) be enhanced to optionally take a `place_pool_id` for prefill, or (b) a new `claim_venue` tool sits alongside it. Pattern decision is orchestrator's.

Confidence: H.

### 1.5 Blast (Marketing) tab — Phase A audience + composer

**Files:**
- `app/(tabs)/marketing/index.tsx` (97 lines, Phase A placeholder)
- `app/(tabs)/marketing/audiences/index.tsx` (71 lines, placeholder)
- `app/(tabs)/marketing/templates/index.tsx` (72 lines, placeholder)
- `app/(tabs)/marketing/campaigns/index.tsx` (207 lines, campaign list)
- `app/(tabs)/marketing/campaigns/compose.tsx` (802 lines, composer)
- `app/(tabs)/marketing/campaigns/[id].tsx` (~150 lines, per-campaign report)

Plain English: the operator can blast an email campaign to either all-buyers-of-this-brand or all-buyers-of-this-specific-event. The composer auto-saves every 800ms, has a review-then-send modal, and schedules via cron. Templates UI and Audiences UI are placeholders today; they'll arrive in Phase C of B5 per DEC-149.

Reads:
- `useCampaigns(account_id, status?)` — campaign list
- `useResolveAudience()` — resolves buyers from `audience=kind:id`
- `useCurrentBrand()` for brand context, `useAuth()` for account_id
- `events_with_master_date_view` for embedded event chips
- `getCampaign()` to hydrate `?draft={id}`

Writes:
- `createDraft()` / `updateDraft()` — `marketing_campaigns` row state machine
- `ensureBrandBuyersAudience()` / `ensureEventBuyersAudience()` — lazy-seed `marketing_audiences` rows
- `useScheduleCampaign().mutate()` — schedule send

Critical for claim flow: a "venue-followers" or "venue-regulars" audience is implicit in the proposed claim system (people who have repeatedly visited a venue, opted into updates). The `marketing_audiences.query_definition` CHECK constraint already enumerates `brand_followers` (future) and `custom_segment` (future) — the discriminated union is extensible. A venue-regulars audience would slot in as either `brand_followers` (if venue = brand) or a new `kind`.

Confidence: H.

### 1.6 Account tab — settings + brand list

**File:** `app/(tabs)/account.tsx` (454 lines)

Plain English: list of the operator's brands (tap to manage) + settings rows (Edit profile, Notifications, Sign out).

Reads:
- `useBrandListState()` — brand list + status
- `useAuth()` — user, signOut, recovery

Writes:
- `signOut()` clears session

Critical for claim flow: this is the natural "+ Add brand / claim a venue" mount point if we go Pattern A in §9. Already has brand list affordance.

Confidence: H.

### 1.7 Brand management routes (`/brand/[id]/*`)

| Route | Purpose |
|-------|---------|
| `/brand/[id]/index.tsx` | Brand profile hero + 6-tile operations grid |
| `/brand/[id]/edit.tsx` | Brand form (name, tagline, bio, cover, address, currency) |
| `/brand/[id]/team.tsx` | Team members + pending invitations |
| `/brand/[id]/blasts.tsx` | Brand-level customers (all buyers across all brand events) |
| `/brand/[id]/audit-log.tsx` | Admin-only audit log |
| `/brand/[id]/payments/index.tsx` | Stripe Connect status hub |
| `/brand/[id]/payments/onboard.tsx` | Stripe Connect onboarding |
| `/brand/[id]/payments/reports.tsx` | Stripe payouts reports |

Plain English: every brand has its own management mini-app. The edit screen captures venue-shaped fields (address, currency) today via the `brands.kind` distinction.

Critical for claim flow: `/brand/[id]/edit.tsx` is **today's closest analog** to a claim wizard. It captures freeform `address` text but does NOT call `googlePlacesService.ts` (only the event-create wizard does). Pattern A in §9 proposes extending this screen with Google Places autocomplete + pool-match prefill.

Confidence: H.

### 1.8 Event management routes (`/event/[id]/*`)

| Route | Purpose |
|-------|---------|
| `/event/[id]/index.tsx` | Operator's live-event view (hero, KPIs, action grid) |
| `/event/[id]/edit.tsx` | Wizard (drafts) or EditPublishedScreen (live events) |
| `/event/[id]/preview.tsx` | Preview as public page |
| `/event/[id]/reconciliation.tsx` | Financial reconciliation |
| `/event/[id]/orders/index.tsx` | Order ledger |
| `/event/[id]/orders/[oid]/index.tsx` | Single-order detail (refund, cancel) |
| `/event/[id]/guests/index.tsx` | Merged guest list (paid + comp + door) |
| `/event/[id]/guests/[guestId].tsx` | Single guest detail |
| `/event/[id]/blasts/index.tsx` | Event-level buyer list + composer pre-fill |
| `/event/[id]/scanners/index.tsx` | Manage scanner staff |
| `/event/[id]/scanner/index.tsx` | QR ticket scanner (camera + result overlay) |
| `/event/[id]/door/index.tsx` | Door sales (cash/card on-site) |
| `/event/[id]/door/[saleId].tsx` | Door-sale detail |

Plain English: every event has its own management mini-app with selling, scanning, refunding, guest-list, and blast tools.

Critical for claim flow: the event-create wizard (`event/[id]/edit.tsx` when status=draft) is the established pattern for multi-step authoring with auto-save. The claim wizard should mirror this pattern.

Confidence: H.

### 1.9 Account sub-routes (`/account/*`)

| Route | Purpose |
|-------|---------|
| `/account/edit-profile.tsx` | Creator account profile + avatar |
| `/account/notifications.tsx` | Notification preferences |
| `/account/delete.tsx` | Account deletion flow |

Confidence: H.

### 1.10 Anon-tolerant buyer routes (outside `(tabs)`)

| Route | Purpose | Auth |
|-------|---------|------|
| `/b/[brandSlug]/index.tsx` | Public brand page (hero + events grid) | Anon |
| `/e/[brandSlug]/[eventSlug].tsx` | Public event listing | Anon |
| `/checkout/[eventId]/index.tsx` | Ticket selection | Anon |
| `/checkout/[eventId]/buyer.tsx` | Buyer details (name/email/phone + marketing opt-in) | Anon |
| `/checkout/[eventId]/payment.tsx` | Stripe PaymentSheet (native only — web has `.web` shim per ORCH-0778) | Anon |
| `/checkout/[eventId]/confirm.tsx` | Success + ticket display | Anon |

Plain English: this is the consumer-facing side embedded in the business app — the public pages buyers reach via URL. Per `feedback_anon_buyer_routes.md` these MUST stay outside `(tabs)/`.

Critical for claim flow: the public brand page (`/b/[brandSlug]`) is **today's closest analog** to a "claimed venue listing" public surface. It already shows brand identity + event grid. Pattern A in §9 proposes extending this with structured venue data (hours, photos, vibe tags) when `brand.kind = 'physical'`.

Confidence: H.

### 1.11 Auth routes

| Route | Purpose |
|-------|---------|
| `/auth/index.tsx` | Sign-in (Google/Apple OAuth) |
| `/auth/callback.tsx` | OAuth callback handler |

Per ORCH-0779 (DEC-138), Supabase Auth Site URL for the project is `https://business.usemingla.com`; `exp://*` is allowed only as Expo-native fallback.

Confidence: H.

### 1.12 Root + special routes

| Route | Purpose |
|-------|---------|
| `/index.tsx` | Root navigation (auth → tabs vs auth/) |
| `/_layout.tsx` | Root layout (providers) |
| `/connect-onboarding.tsx` | Stripe Connect launch route (252 lines) |
| `/stripe-onboarding-return.tsx` | Stripe Connect return URL (83 lines) |
| `/event/create.tsx` | Event creation entry (creates draft, redirects to wizard) |
| `/o/[orderId].tsx` | Order detail (universal-link deep entry) |
| `/__styleguide.tsx` | Design-system reference screen |
| `/+not-found.tsx` | Fallback |

Confidence: H.

### 1.13 Surface count summary

- **56 route files** under `mingla-business/app/`
- **5 bottom-nav tabs**, marketing has 5 sub-routes
- **2 wizard-style flows** today: brand creation (BrandSwitcherSheet) + event creation (`event/[id]/edit.tsx`)
- **3 anon-tolerant public routes**: brand page, event page, checkout
- **9 brand management routes**, **13 event management routes**

---

## §2 — Data Model Snapshot

This section maps every Supabase table the business app reads/writes, grounded in migrations (never TS types per memory `feedback_verify_db_column_names_before_writing_queries.md`).

### 2.1 `public.brands` (THE pivot table for the claim question)

**Source:** Baseline squash 20260505000000:7761-7782 + 20260506000000_brand_kind_address_cover_hue_media.sql

**Columns (full):**

```sql
id                       uuid PRIMARY KEY DEFAULT gen_random_uuid()
account_id               uuid NOT NULL                    -- FK to auth.users (implicit; not enforced)
name                     text NOT NULL
slug                     text NOT NULL  CHECK length(trim(slug)) > 0
description              text
profile_photo_url        text
profile_photo_type       text  CHECK IN ('image','video','gif') OR NULL  -- ORCH 17e-A
contact_email            text
contact_phone            text
social_links             jsonb NOT NULL DEFAULT '{}'
custom_links             jsonb NOT NULL DEFAULT '[]'
display_attendee_count   boolean NOT NULL DEFAULT true
tax_settings             jsonb NOT NULL DEFAULT '{}'
default_currency         char(3) NOT NULL DEFAULT 'GBP'
stripe_connect_id        text                             -- attached by Stripe Connect onboarding
stripe_payouts_enabled   boolean NOT NULL DEFAULT false
stripe_charges_enabled   boolean NOT NULL DEFAULT false
kind                     text NOT NULL DEFAULT 'popup'  CHECK IN ('physical','popup')  -- THE VENUE COLUMN
address                  text                              -- freeform, NULL when popup
cover_hue                int NOT NULL DEFAULT 25  CHECK 0..359
cover_media_url          text
cover_media_type         text  CHECK IN ('image','video','gif') OR NULL
created_at               timestamptz NOT NULL DEFAULT now()
updated_at               timestamptz NOT NULL DEFAULT now()
deleted_at               timestamptz                      -- soft delete
```

**What's missing for a "claimed venue listing" with structured place data:**
- `place_pool_id` (FK to `public.place_pool.id`) — no such column exists
- `google_place_id` — no column
- `formatted_address` (structured) — only freeform `address` text
- `lat`, `lng` (decimal) — no columns (events have `location_geo` point, brands do not)
- `city`, `region`, `country_code` — no columns (events have `city` post-ORCH-0824)
- `hours_of_operation` — no column
- `business_status` (OPERATIONAL, CLOSED_TEMPORARILY) — no column
- `claim_status` (unclaimed, pending_review, verified, rejected) — no column
- `verified_at`, `verified_by` — no columns
- `vibe_tags` / `intent_tags` — no columns (would be jsonb or new join table)

**RLS posture:** RLS is enabled. SELECT/INSERT/UPDATE/DELETE policies enforce `account_id = auth.uid()` or membership through `brand_members`/`brand_invitations`. Public visibility is filtered via the `brands_public_view` (see 2.2).

**Soft delete:** `deleted_at` set rather than DELETE. Service layer respects via `.is("deleted_at", null)` in `brandsService.getBrands` (line 160).

**Indexes mentioned in migration:** `idx_brands_account_id`, `idx_brands_slug_active` (per migration comment line 12).

**Foreign keys:**
- Events reference brands via `events.brand_id` (FK)
- Marketing audiences reference brands via `marketing_audiences.brand_id` (FK with `ON DELETE CASCADE`)
- Brand members + invitations FK to brands

**Confidence: H** (baseline migration + ALTER read end-to-end + service layer verified).

### 2.2 `public.brands_public_view` (the public visibility contract)

**Source:** Baseline 20260505000000:7833-7857

```sql
CREATE OR REPLACE VIEW public.brands_public_view WITH (security_invoker = true) AS
SELECT id, account_id, name, slug, description, profile_photo_url, contact_email,
       contact_phone, social_links, custom_links, display_attendee_count,
       default_currency, created_at, updated_at
FROM public.brands b
WHERE deleted_at IS NULL
  AND EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.brand_id = b.id
      AND e.deleted_at IS NULL
      AND e.visibility = 'public'
      AND e.status IN ('scheduled','live')
  );
```

Plain English: **a brand is publicly visible only if it has at least one public live or scheduled event.**

CRITICAL IMPLICATION for claim flow: a restaurant that claims its listing but never creates an event is NOT visible publicly under this view. If the proposed system surfaces "claimed venues" to consumers regardless of event activity, this view's contract has to change OR a parallel view has to be introduced.

Note: `address`, `kind`, `cover_*` are NOT projected in this view — they would need to be added if claimed-venue display reuses `brands_public_view`.

**Confidence: H** (view SQL read directly).

### 2.3 `public.events`

**Source:** Baseline 20260505000000:7792-7823 + multiple ALTERs (most recent ORCH-0824 city column 20260604000000)

**Columns (full):**

```sql
id                       uuid PRIMARY KEY DEFAULT gen_random_uuid()
brand_id                 uuid NOT NULL                    -- FK to brands
created_by               uuid NOT NULL                    -- FK to auth.users
title                    text NOT NULL
description              text
slug                     text NOT NULL  CHECK length(trim(slug)) > 0
location_text            text                              -- FREEFORM
location_geo             point                             -- LAT/LNG (postgres point)
online_url               text
is_online                boolean NOT NULL DEFAULT false
is_recurring             boolean NOT NULL DEFAULT false
is_multi_date            boolean NOT NULL DEFAULT false
recurrence_rules         jsonb
cover_media_url          text
cover_media_type         text  CHECK IN ('image','video','gif') OR NULL
theme                    jsonb NOT NULL DEFAULT '{}'
organiser_contact        jsonb NOT NULL DEFAULT '{}'
visibility               text NOT NULL DEFAULT 'draft'  CHECK IN ('public','discover','private','hidden','draft')
show_on_discover         boolean NOT NULL DEFAULT false
show_in_swipeable_deck   boolean NOT NULL DEFAULT false
status                   text NOT NULL DEFAULT 'draft'  CHECK IN ('draft','scheduled','live','ended','cancelled')
published_at             timestamptz
timezone                 text NOT NULL DEFAULT 'UTC'
city                     text                              -- ORCH-0824: from Google Places at publish
party_types              text[]                            -- ORCH-0824: taxonomy CHECK
genres                   text[]                            -- ORCH-0824: taxonomy
created_at               timestamptz NOT NULL DEFAULT now()
updated_at               timestamptz NOT NULL DEFAULT now()
deleted_at               timestamptz
```

Plus many event-specific tables added across migrations:
- Order refund/cancel columns (ORCH-0787)
- Master date columns + `events_with_master_date_view` (ORCH-0792)
- Event scanner auto-provisioning (ORCH-0795)
- Event cover provider metadata (ORCH-0783)
- Cover-video processing columns (ORCH-0766f, 0770, 0776d)
- Orders tax columns (ORCH-0804)
- Realtime publication for orders (ORCH-0816)

**Critical for claim flow:** events have **both** structured location (`location_geo` point + `city`) and freeform (`location_text`). A claimed venue's events would naturally inherit the venue's address — meaning a new `event.venue_brand_id` reference might be needed, OR the existing `brand_id` already implies the venue when `brand.kind = 'physical'`.

NO `place_pool_id` column on events.
NO `place_id` column on events.

**Confidence: H** (baseline + ALTERs read).

### 2.4 `public.orders`, `public.ticket_orders` etc.

These are mature, post-ORCH-0777 hardened ticket-purchase tables. Order brand identity sourced transitively from `events.brand_id` via order's `event_id` (per DEC-145 / I-PROPOSED-AG). There is **no** `orders.brand_id` column (verified: ORCH-0777 PostgREST rejection caught the false `orders.brand_id` selection in the wild).

Buyer identity (name, email, phone) is on the order row. `marketing_opt_in` column captured at buyer step.

Not directly relevant to claim flow — included for completeness.

**Confidence: H** (per DEC-145 + ORCH-0777 close note).

### 2.5 `public.marketing_audiences` (audience discriminated union)

**Source:** 20260602000003_orch_0815_marketing_hub_phase_a.sql

```sql
CREATE TABLE public.marketing_audiences (
  id                  uuid PK,
  account_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  brand_id            uuid REFERENCES public.brands(id) ON DELETE CASCADE,
  name                text NOT NULL,
  query_definition    jsonb NOT NULL,
  is_system_generated boolean NOT NULL DEFAULT false,
  created_at, updated_at,
  CONSTRAINT marketing_audiences_query_kind_valid CHECK (
    jsonb_typeof(query_definition) = 'object'
    AND (query_definition->>'kind') IN ('brand_buyers', 'event_buyers', 'brand_followers', 'custom_segment')
  )
);
```

**I-PROPOSED-BP:** `query_definition` is a discriminated union by `kind`. Phase A kinds: `brand_buyers`, `event_buyers`. Future kinds: `brand_followers`, `custom_segment` (already in CHECK).

Critical for claim flow: a claimed venue's "regulars" audience would slot in as either `brand_followers` (if venue = brand) or a new `kind` like `venue_regulars`. The CHECK constraint would need an ALTER to add the new kind unless we reuse `brand_followers`.

**Confidence: H** (migration SQL read directly).

### 2.6 `public.marketing_campaigns`, `marketing_messages`, `marketing_clicks`, `marketing_templates`, `marketing_suppressions`

Shipped by ORCH-0815-A + Phase B. Used by composer (`marketing/campaigns/compose.tsx`) and per-campaign report (`marketing/campaigns/[id].tsx`).

Not directly affected by claim flow. Included as table-family completeness.

**Confidence: M** (table families confirmed; detailed columns not read in this audit pass).

### 2.7 `public.agent_conversations`, `agent_messages`, `agent_pending_actions`, `agent_user_profile`

Shipped by ORCH-0821 (Ari MVP). 16 RLS policies all direct-predicate `user_id = auth.uid()` per ORCH-0734 fix. All FKs `ON DELETE CASCADE` from `auth.users` for GDPR.

Not directly affected by claim flow unless Ari adds a `claim_venue` tool — in which case `agent_pending_actions` already provides the confirmation-card state machine.

**Confidence: H** (per CLOSE_NOTE_ORCH-0821).

### 2.8 `public.brand_members`, `public.brand_invitations`

Existing brand team structure with role-based permissions. Used by `/brand/[id]/team.tsx`.

For multi-location venues (e.g., a chain with multiple physical locations), this team structure is per-brand. If "one brand = one location," chains have N brands sharing identity; if "one brand = multi-location chain with N venues," we need a new venue/location table. **This is the multi-location question §3 must resolve.**

**Confidence: M** (team table existence confirmed via UI route + service imports; full schema not read in this pass).

### 2.9 `public.place_pool` (the consumer-side venue database — present but disconnected)

The consumer app's authoritative venue database, populated by:
- Google Places seeding (admin pipeline)
- Bouncer chain rules (`supabase/functions/_shared/bouncerChainRules.ts`)
- Signal scorer writing `place_scores`
- Matview `admin_place_pool_mv.primary_category` (post-ORCH-0700 derived category)

Per memory `feedback_ai_categories_decommissioned.md`, the AI-categorization columns (`seeding_category`, `ai_categories`, `ai_reason`, `ai_primary_identity`, `ai_confidence`, `ai_web_evidence`) are **DROPPED** post-ORCH-0700 Phase 3B. Replacement is SQL helper `pg_map_primary_type_to_mingla_category(primary_type, types)` + matview + signal scorer.

**Place_pool's relationship to business app today:** ZERO. Verified by `grep -rn "place_pool" mingla-business/src/ mingla-business/app/` → empty result.

**Confidence: H** (memory + grep verified).

### 2.10 `public.accounts` (or auth.users)

The business app uses Supabase Auth `auth.users` directly as the account/identity layer. There is no `public.accounts` business-app-specific table — `creator_accounts` is the profile-overlay table (name, avatar, notification prefs).

**Confidence: M** (UI route consumes `useCreatorAccount` hook; full schema not read but presence confirmed).

### 2.11 Storage buckets

Per migration history:
- `event_covers` (ORCH-0758a)
- `brand_covers` (ORCH-0805)
- `brand_avatars` (ORCH-0807)
- `creator_avatars` (post ORCH-0786)

A claimed-venue listing would likely need a new `venue_photos` bucket OR reuse `brand_covers` (if venue = brand). Pattern A in §9 favors reuse.

**Confidence: M** (bucket names from migrations; precise policy SQL not read).

### 2.12 Edge functions touching this domain

From migration commentary + service-layer imports:
- Brand mutations: `useCreateBrand` (direct .insert, not an edge function per `brandsService.createBrand`)
- Event publish: `business_publish_event_draft` RPC (per ORCH-0792)
- Ticket checkout: `ticket-checkout-create`, `ticket-checkout-status` (ORCH-0777)
- Refund: `refund-order`, `cancel-order` (ORCH-0787)
- Email: `ticket-confirmation-dispatch`, `notify-dispatch`, `admin-send-email` (ORCH-0785)
- Ari: `agent-chat`, `agent-confirm-action` (ORCH-0821)
- Stripe: `stripe-webhook-health-check`, `stripe-kyc-stall-reminder`, `stripe-webhook` (multiple)

**No place-pool-search or claim edge functions exist today.** These are net-new for Phase A of the venue-claim feature.

**Confidence: H** (close notes + migration commentary).

---

## §3 — "Brand" Concept Forensics (CRITICAL)

This is the most important section of the audit. The operator's brainstorm assumed `brand` was identity-only and that a new `business_listing` (or similar) table would represent the venue. **The audit proves the brand model already includes venue-shape semantics.** This reshapes the integration question.

### 3.1 Definitive answer: what IS a brand today?

From baseline migration 20260505000000:7761-7782 + 20260506000000:

A `brand` is a **flexible organizer-identity row** with optional venue semantics. The same table represents:
- A physical venue (`kind='physical'`, has freeform `address`)
- A popup operator (`kind='popup'`, no fixed address, operates across multiple venues)
- An organizer with no venue (DJ, promoter, touring comedian — `kind='popup'` by default)
- An event series with multi-location capability (`kind='popup'`)

The column comment (migration line 30-31) is the authoritative description:

> 'Cycle 7 v10 — physical brand owns/leases venue (renders address); popup operates across multiple venues. Default popup (safer, no fake address shown).'

The default is `'popup'` specifically to avoid showing a fake address when none is provided.

**Implication:** the operator's mental model of "a separate venue/listing concept distinct from brand" is **not aligned with the schema**. The schema's mental model is "every organizer is a brand; some brands are physical venues, others are popup-style operators."

### 3.2 Multi-location capability — does it exist today?

NO. The schema today is **one brand = one optional address**. There is no `brand_locations` table, no `venue` table, no multi-row address structure. A brand with `kind='physical'` has exactly one `address` (freeform text) or none.

For a chain (e.g., a coffee shop with 5 locations), the current schema forces one of:
- (a) Create 5 separate brands, one per location. Each gets its own Stripe Connect onboarding. Painful for the operator.
- (b) Create 1 brand and put the chain name in `name`; lose per-location identity. Loses the proposed claim flow's "one venue = one claimed listing" alignment.

**Implication:** if the claim flow must support chains (Starbucks-style), a new `brand_locations` table is required. If chains are out-of-scope for the first cycle, the current schema is fine.

This is an **open question for operator** — see Open Questions list at the bottom.

### 3.3 Brand creation flow today

From `mingla-business/src/services/brandsService.ts:108-151`:

```typescript
export async function createBrand(
  input: CreateBrandInput,
  role: BrandRole,
): Promise<Brand> {
  const insertPayload = mapUiToBrandInsert({
    accountId: input.accountId,
    brand: {
      displayName: input.name,
      slug: input.slug,
      kind: input.kind,           // ← already takes 'physical' or 'popup'
      address: input.address,     // ← already takes freeform address
      coverHue: input.coverHue,
      bio: input.bio,
      tagline: input.tagline,
      contact: input.contact,
      links: input.links,
    },
  });
  const { data, error } = await supabase
    .from("brands").insert(insertPayload).select().single();
  if (error?.code === "23505") throw new SlugCollisionError(input.slug);
  ...
}
```

Key observation: `createBrand` already accepts `kind` and `address`. The wizard would just need to **pre-fill `kind='physical'`** and prefill `address` from a `place_pool` match.

**Confidence: H** (service file read directly).

### 3.4 Brand creation UI today

The brand creation UI is **`BrandSwitcherSheet.tsx`** (`mingla-business/src/components/brand/BrandSwitcherSheet.tsx:74-446`). It's a top-anchored drop-down sheet that opens from the Home tab brand chip or the Account tab. It supports:
- Switching active brand
- Creating a new brand
- Deleting a brand (with upcoming-event guard)

The current creation flow is **single-screen, minimal** — just name + (implicit popup default). It does NOT capture address, kind, or any venue-shaped data at creation time; those are filled in afterward via `/brand/[id]/edit.tsx`.

**Implication:** the proposed claim wizard is essentially **a richer brand-creation UI that prefills from `place_pool`**. The natural home is either:
- (a) Extend `BrandSwitcherSheet` with a "claim my venue" mode (compact)
- (b) Introduce a new full-screen wizard parallel to event-create's wizard (deeper)
- (c) Add a separate top-level "Add brand / Claim venue" flow on the Account tab

Patterns A/B/C scoped in §9.

### 3.5 Integration patterns for "what IS a venue listing relative to brand"

Three patterns, with tradeoffs:

#### Pattern 3.5.A — Venue IS a brand of kind='physical' (with sidecar place data)

**The change:**
- Add columns to `brands`: `place_pool_id` (FK nullable), `google_place_id`, `lat`, `lng`, `city`, `country_code`, `claim_status`, `verified_at`, `business_status`
- Add an optional sidecar table for structured hours: `brand_hours` (brand_id, weekday, open_time, close_time)
- Reuse `brand_covers` storage for photos
- Wizard becomes "create your brand, we'll prefill" — same `createBrand` call, just richer inputs
- Public surface: extend `brands_public_view` to optionally include `kind='physical'` brands even without an event (or add a new view `claimed_venues_public_view`)

**Pros:**
- Smallest data-model change (~6 columns + 1 sidecar table)
- Reuses Stripe Connect (already on brands)
- Reuses team/permissions/audit-log
- Reuses marketing audiences (`brand_followers` slots straight in)
- Reuses Ari's `create_brand` tool (just enhance prefill args)
- Public brand page (`/b/[brandSlug]`) becomes the claimed-venue page naturally

**Cons:**
- Conceptual ambiguity: "brand" now overloaded — sometimes it's a venue, sometimes it's a DJ, sometimes it's a multi-venue popup
- Multi-location chains still unsolved (one brand = one address)
- If we later need to split venue from brand, this is a harder unwind

#### Pattern 3.5.B — Sibling table `business_listing` referencing brand

**The change:**
- New table `business_listing` (brand_id FK, place_pool_id FK, place data, claim_status, hours, photos, vibe_tags, etc.)
- A brand can have 0 or 1 listings (or many for chains)
- New service/hook/screen layer
- Public surface: new view `claimed_venue_listings_public`

**Pros:**
- Clean separation: brand = identity, listing = venue facts
- Multi-location chains natural (one brand, many listings)
- Doesn't pollute the brand table for non-venue organizers
- Future-proof if venue features grow

**Cons:**
- Largest data-model change (new table + sync columns)
- Stripe Connect now must either (a) live on brand (one Stripe for chain) or (b) per-listing (more KYC). Operator choice required.
- Marketing audiences would need a new kind `venue_followers` distinct from `brand_followers`
- Ari needs a new `create_business_listing` tool alongside `create_brand`
- More duplication: brand has name+slug+address, listing has name+slug+address — which wins?

#### Pattern 3.5.C — Venue REPLACES brand for `kind='physical'` accounts

**The change:**
- Repurpose `brands` as `venues_or_organizers` (rename or alias)
- For accounts onboarding as a venue, `kind='physical'` is required and `address`/structured place data is required
- For accounts onboarding as an organizer, `kind='popup'` and no address
- Add only the structured place-data columns (no sidecar listing table)

**Pros:**
- One concept ("organizer or venue, same row") — cleaner than pattern A's ambiguity
- Same data-model cost as pattern A
- Multi-location problem still unsolved (one brand = one venue) BUT operator-onboarding clarity is much higher

**Cons:**
- Existing data has many `kind='popup'` brands without addresses — migration question: do they stay popup forever?
- "Brand" as a name no longer accurately describes the table (organizers + venues are different things)
- The wizard branches at onboarding ("are you a venue or an organizer?") which is a UX fork the operator may or may not want
- Larger refactor of UI copy ("create your brand" → "create your venue OR organizer profile")

### 3.6 Recommendation framing (forensics does NOT pick)

Forensics observes: Pattern A is the lowest-risk integration. Pattern B is the cleanest data model but largest cost. Pattern C is the cleanest mental model but largest UI refactor.

Operator decides. See Open Questions §11.

---

## §4 — Onboarding Flow Today

This section traces what a new business operator does from first launch to first sellable event.

### 4.1 First-launch path

1. App opens → `/auth/index.tsx` (sign-in screen) if no session
2. Operator signs in via Google or Apple OAuth → `/auth/callback.tsx` exchanges code → session created
3. After auth, root `/index.tsx` routes to `/(tabs)/home`
4. Home tab loads → `useBrands()` returns empty list → empty state "No brands yet" + "+" CTA
5. Operator taps "+" → opens `BrandSwitcherSheet`
6. Sheet shows "Create your first brand" form: just a **name field** today
7. Operator enters name → tap "Create" → `useCreateBrand.mutateAsync()` runs:
   - Generates slug from name (kebab-case)
   - Inserts into `brands` with `kind='popup'` (default), all venue fields NULL
   - On 23505 unique violation → SlugCollisionError; UI shows friendly "slug taken" error
8. Brand created → `currentBrand` set in Zustand → Home tab re-renders with brand context
9. Operator's next action: tap "Build event" → `/event/create` → server draft created → wizard `/event/[id]/edit.tsx?step=0`

Plain English: **today's onboarding is the absolute minimum — sign in, pick a name, done.** No address, no Stripe Connect, no venue identity. All that is filled in later, ad-hoc, when the operator needs it (Stripe required to publish a paid event; address optional ever).

### 4.2 When does Stripe Connect onboarding trigger?

From `mingla-business/app/brand/[id]/payments/onboard.tsx` (69 lines) and `mingla-business/app/connect-onboarding.tsx` (252 lines):

Stripe Connect is opt-in via the Payments tab in the brand management view. It's NOT triggered automatically at brand creation. The operator must explicitly navigate to Payments and click "Start onboarding."

Per ORCH-0808/0809 close notes, Stripe Connect uses Accounts v2 with controller properties. The onboarding hosts on Stripe's domain (`connect-onboarding.tsx` opens a webview/redirect), captures Stripe's standard fields (legal name, EIN/SSN, business type, address, bank account), and returns to `stripe-onboarding-return.tsx`.

After onboarding, `brands.stripe_connect_id` is set + `stripe_charges_enabled` / `stripe_payouts_enabled` flip to true.

**For the claim flow, this is significant:** Stripe's onboarding captures structured business identity (legal name, EIN, address) that Mingla doesn't currently re-use. A claimed venue could in theory consume the Stripe-onboarded address back into `brands.address` — a future enhancement.

Stripe Connect is required to publish a paid event but NOT to create a draft event. So the operator can build the entire ticketing structure without Stripe and only complete onboarding when they actually want to publish.

### 4.3 Onboarding checklist / progress indicators

There is **no onboarding checklist UI today.** No "complete your profile" progress bar, no "verified business" badge, no review queue.

This means the claim flow's "pending review" status messaging is **entirely net-new UI**. The closest precedent in the app is Stripe Connect's onboarding progress (which is hosted on Stripe's site, not Mingla's).

### 4.4 Where does the venue-claim wizard naturally insert?

Three placement patterns (forensics lays out, operator decides):

#### Pattern 4.4.A — Replace `BrandSwitcherSheet` with a richer flow when operator picks "I'm a venue"

- Today's sheet stays compact for "popup" operators (DJs, promoters)
- A new "I'm a venue" CTA opens a full-screen wizard with the place-pool search + comparison flow
- Both paths land in `createBrand` with `kind` set accordingly

**Pros:** highest discoverability — first time operator opens the brand switcher, they see the fork. **Cons:** the brand switcher is a top-anchored sheet today; turning it into a full-screen fork changes existing operators' UX too.

#### Pattern 4.4.B — New top-level "Claim a venue" entry on Account tab

- Account tab adds a "Brands" section + a new "Claim a venue" row
- Wizard is full-screen, parallel to event-creation wizard
- Existing brand creation flow unchanged for popup operators

**Pros:** zero disruption to existing UX; clean fork. **Cons:** discoverability lower — operator has to navigate to Account to find it.

#### Pattern 4.4.C — Persona-pick at first-launch ("Are you a venue or an organizer?")

- New first-launch screen after auth, before tabs render
- "Venue" → full claim wizard
- "Organizer" → existing minimal brand creation
- Choice persisted on `creator_accounts.persona` or similar

**Pros:** highest clarity for first-time operators; sets expectation. **Cons:** disrupts existing flow; adds friction for operators who don't fit cleanly (e.g., "I'm a popup organizer who also has one physical venue").

Patterns recap'd in §9.

---

## §5 — `place_pool` Linkage Audit

### 5.1 Direct grep result

```bash
grep -rn "place_pool\|placePool\|place_id" mingla-business/src/ mingla-business/app/
```

**Result: zero matches.**

The business app does NOT touch `place_pool` today. No imports, no service references, no edge function calls to anything place-pool-related.

**Confidence: H** (grep run directly).

### 5.2 What DOES exist as place-related plumbing in the business app

`mingla-business/src/services/googlePlacesService.ts` — Google Places v1 autocomplete + place-details, shipped by ORCH-0824.

- `autocompletePlaces(query: string)` → up to 5 suggestions with `placeId`, `displayName`, `fullAddress`
- `fetchPlaceDetails(placeId: string)` → `formattedAddress`, structured `city`, `region`, `countryCode`, `location {lat, lng}`

The function uses `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` (same key as the consumer app per the comment line 11).

**Used by:**
- `mingla-business/src/components/event/AddressAutocompleteInput.tsx` — event creator step 3 (Where)
- `mingla-business/src/components/event/CreatorStep3Where.tsx` — same step

**Critical for claim flow:** this is **the exact plumbing the claim flow needs**. The wizard can:
1. Operator types business name
2. `autocompletePlaces(query)` returns suggestions
3. Operator picks → `fetchPlaceDetails(placeId)` returns structured data
4. **NEW edge function** queries `place_pool` by `google_place_id` to find our existing record
5. If pool match → prefill comparison wizard with our data
6. If no match → blank wizard with the Google-fetched data only

The Google Places integration is **already paid for and live**. Just needs a new edge function to bridge to `place_pool` lookup.

### 5.3 How could `place_pool` be reached from the business app?

Two paths:

#### Path A — Direct read via service layer (RLS-permitted)

Add a `pool-place-by-google-id` edge function or a service-layer query that hits `place_pool` directly. Requires verifying `place_pool` has RLS permitting authenticated reads (or service-role reads through an edge function).

**Concern:** per memory `feedback_ai_categories_decommissioned.md`, `place_pool.seeding_category`, `ai_categories`, `ai_reason`, `ai_primary_identity`, `ai_confidence`, `ai_web_evidence` are DROPPED. Don't write any code that references those columns. The current canonical category derivation is via the matview `admin_place_pool_mv.primary_category`.

#### Path B — New edge function `claim-search-pool`

Operator types name → edge function takes `(query, lat?, lng?)` → uses Google Places autocomplete + `place_pool` lookup → returns matched pool row OR offers to create blank-wizard mode.

**Pros:** isolates the cross-domain bridge to one edge function. RLS doesn't have to permit business-app users to read `place_pool` directly; the edge function uses service role for the lookup and returns only the public-safe fields.

**Cons:** new edge function to deploy + maintain.

Pattern B is recommended (forensics observation, operator decides) — keeps the cross-domain bridge clean and auditable.

### 5.4 What about reverse direction? Does the consumer app know about claimed venues?

**No.** Per memory, the consumer app's place_pool category derivation does NOT today consider whether a venue is "claimed" or "owned by a business user." A new column like `place_pool.claimed_by_brand_id` (or a mapping table) would be needed for the consumer side to display "verified by venue" badges or prefer business-uploaded photos.

This is part of Phase D (Pairing & Surfacing) scope, not Phase A.

---

## §6 — Stripe Connect State

### 6.1 What's shipped today

Stripe Connect onboarding is mature in mingla-business:

- **`brands.stripe_connect_id`**, `stripe_payouts_enabled`, `stripe_charges_enabled` — columns on the brands table
- **Routes:** `connect-onboarding.tsx` (252 lines), `stripe-onboarding-return.tsx` (83 lines), `brand/[id]/payments/onboard.tsx` (69 lines), `brand/[id]/payments/index.tsx` (Stripe status hub)
- **Services:** `brandStripeService.ts`, `brandStripeBalancesService.ts`, `brandStripeCountriesService.ts`, `brandStripeDetachService.ts`, `brandStripeOrphanedRefundsService.ts`, `brandStripeTaxDashboardLinkService.ts`
- **Hooks:** `useBrandStripeStatus`, `useStartBrandStripeOnboarding`, `useBrandStripeBalances`, `useBrandStripeBankVerification`, `useBrandStripeCountries`, `useBrandStripeDetach`, `useBrandStripeOrphanedRefunds`, `useBrandStripeTaxDashboardLink`
- **Edge functions** (inferred): Stripe webhook handlers, KYC stall reminder (`stripe-kyc-stall-reminder` per ORCH-0785), Stripe webhook health check (`stripe-webhook-health-check`)
- **Stripe Connect type:** Accounts v2 with controller properties (per CLOSE_NOTE_ORCH-0808 / ORCH-0809)

### 6.2 What Stripe Connect captures (per the integration's standard fields)

When the operator completes Stripe Connect onboarding, Stripe asks for:
- Business legal name + DBA
- Business type (LLC, sole prop, corp, etc.)
- Business address (structured)
- Tax ID (EIN or SSN, depending on type)
- Bank account
- Personal details for the controller (name, DOB, SSN last 4)
- Capabilities (Card Payments, Transfers, Tax Reporting)

**Critical for claim flow:** completing Stripe Connect is a **strong second proof of legitimacy** — it requires real ID, real business records, real bank account. The operator's brainstorm proposed Stripe Connect as part of the wizard for exactly this reason. The business app already requires Stripe Connect for paid events.

If we frame "complete Stripe Connect" as the validation gate (in addition to or instead of the admin phone-callback), we get a much stronger automated check at lower operational cost. Open question for operator — see §11.

### 6.3 Stripe Connect timing in the proposed claim wizard

If venue = brand of kind='physical' (Pattern 3.5.A), Stripe Connect is **already triggered** when the operator publishes their first paid event. The claim wizard can either:
- (a) Bundle Stripe Connect into the wizard (one big flow, completion = listing live)
- (b) Defer Stripe Connect until the operator wants to sell tickets (today's behavior)
- (c) Require Stripe Connect before admin review (validation strength)

Open question — see §11.

---

## §7 — Marketing Hub Touch Points

### 7.1 Marketing Hub assumes brand-shaped or venue-shaped?

Reading `app/(tabs)/marketing/campaigns/compose.tsx` (802 lines) + the audience model in `marketing_audiences.query_definition`:

The composer reads:
- `useCurrentBrand()` — brand name, currency, address ← uses `brands.address` directly
- Brand-buyer rollup audience: every buyer who ordered from any event owned by this brand
- Event-buyer rollup audience: every buyer who ordered from this specific event

The audience model is **buyer-driven**, not venue-driven. There's no concept of "venue regulars" or "venue followers" today.

### 7.2 Brand "Customers" tab semantics

Per DEC-149 and `mingla-business/app/brand/[id]/blasts.tsx` (80+ lines):

The brand-level customers tab shows every buyer across every brand event. Per-row: name, order count, total spend, last event, consent state. CTA "Blast these N customers" pre-fills the composer with audience `brand_buyers:{brandId}`.

This naturally extends to a venue's regulars IF venue = brand (Pattern 3.5.A). The "customers" tab already shows the right people; it just needs a "venue followers" overlay (people who opted into updates without buying — a future concept).

### 7.3 Composer event-card insertion

The composer can embed event chips into email bodies (per `embeddedEvents` state in compose.tsx). It reads `events_with_master_date_view` for embedded titles + dates.

**Critical for claim flow:** if business-authored curated experiences become a content type, the composer would need a parallel "embed experience" affordance. Out of Phase A scope but a known Phase C/D consideration.

### 7.4 Conflict map for claim flow

| Marketing Hub Surface | Conflict / Adjustment Needed |
|---------------------|-------------------------------|
| `brands.address` (composer reads) | If structured place data is added (Pattern A's new columns), composer should consume the formatted version, not the freeform one |
| Brand-buyer audience | No conflict — works regardless of venue/popup |
| Event-buyer audience | No conflict |
| `brand_followers` kind (CHECK enum) | Can be reused for venue regulars in Pattern 3.5.A |
| Embedded event chips | Could extend to embedded venue chips in claim Phase D |
| Suppression list | No conflict — buyer-driven |

No blockers. Marketing Hub is **claim-flow-friendly** out of the box.

---

## §8 — Ari Capabilities

### 8.1 Tool surface today

From `supabase/functions/_shared/agentTools.ts:97-300`:

1. **`create_brand`** — args: name + optional venue-shaped data. Already supports the pattern of "Ari asks the operator confirmation card → on confirm, runs createBrand."
2. **`create_event`** — args: brand_id, title, location, dates, tickets, etc.
3. **`list_brands`** — read-only, no confirmation needed
4. **`list_events`** — read-only
5. **`update_event`** — args: event_id, patch fields. Confirmation card before write.

### 8.2 Authority model

- I-ARI-CONFIRM-AUTHORITY: every write is proposed as a confirmation card; model never writes directly.
- I-ARI-USER-JWT-ONLY: executors NEVER use service role; user's JWT is the RLS wall.
- I-ARI-USER-DATA-WRAP: user-stored data wrapped in `<user_data>` before Gemini context.
- I-ARI-NO-OKLCH: no oklch colors in confirmation cards (RN inline-style rule).
- I-ARI-PENDING-STATE-MACHINE: `agent_pending_actions` is the state machine.

### 8.3 Could Ari own the claim flow?

**Partially.** Ari is excellent for the "type your business name, here's what we found, want to use this prefill?" conversation but **cannot replace the admin phone-callback validation step** — that's a human-in-the-loop process. Also, Ari can't open Stripe Connect onboarding (which is a hosted Stripe webview redirect).

Two viable Ari involvement patterns:

#### Pattern 8.3.A — Ari as a guided entry to the claim wizard
- Operator says "I want to claim my restaurant"
- Ari runs `list_brands` → confirms operator has no existing brand for this venue
- Ari runs new `search_pool_by_name(name, city?)` tool → returns matches
- Ari surfaces matches in a confirmation card
- Operator picks one → Ari runs new `start_claim_flow(place_pool_id)` tool → opens the full-screen wizard
- Wizard takes over from there (Stripe Connect, photos, etc.)

#### Pattern 8.3.B — Ari only post-claim
- Claim wizard is UI-only, Ari doesn't enter the flow
- After listing is live, Ari can update venue info ("change my hours to..."), upload photos, draft curated experiences via new tools

Pattern A makes the claim flow feel conversational; Pattern B keeps Ari simpler. Operator decides.

### 8.4 New Ari tools the claim flow would likely need

If we go Pattern 8.3.A:
- `search_pool_by_name(query, lat?, lng?)` — read-only, no confirmation
- `start_claim_flow(place_pool_id)` — opens UI; needs confirmation
- `update_venue_info(brand_id, patch)` — confirmation card for hours, vibes, etc.
- `upload_venue_photo(brand_id, image_url)` — confirmation card
- `submit_claim_for_review(brand_id)` — confirmation card

5 new tools, all consistent with the existing pattern.

---

## §9 — Integration Gap Analysis (with brainstormed patterns)

This section synthesizes Phases A-D of the proposed venue-claim system against what's shipped vs what's missing vs what's conflicting.

### 9.1 What's already reusable

| Capability | Existing Asset | Reuse Notes |
|------------|----------------|-------------|
| Identity / auth | Supabase Auth + `creator_accounts` | No change |
| Brand / organizer entity | `public.brands` + `brands.kind` | Direct (Pattern A) or sibling (Pattern B) |
| Multi-member teams + roles | `brand_members`, `brand_invitations` | Inherited if venue = brand |
| Audit log | `/brand/[id]/audit-log.tsx` | Inherited if venue = brand |
| Stripe Connect onboarding | `brands.stripe_connect_id` + onboard route | Inherited if venue = brand |
| Image upload pipeline | `brand_avatars`, `brand_covers` buckets | Add `venue_photos` bucket OR reuse `brand_covers` |
| Public brand page | `/b/[brandSlug]/index.tsx` | Extend to render venue fields when `kind='physical'` |
| Google Places autocomplete | `googlePlacesService.ts` | Reused as-is for wizard search |
| Resend transactional emails | `_shared/email/` + 3 senders | Use for claim status notifications |
| Admin call lookups | Operator-manual (Google Maps) | New admin queue UI in `mingla-admin/` |
| Ari confirmation pattern | `agent_pending_actions` state machine | Extends naturally to new tools |
| Marketing audiences (buyer-driven) | `marketing_audiences` + 5 kinds | Inherited; venue regulars = `brand_followers` |

### 9.2 What's missing

| Gap | Phase | What's Needed |
|-----|-------|---------------|
| `place_pool` ↔ business app bridge | A | New edge function `claim-search-pool` |
| Structured place data on brands | A | New columns on `brands` (Pattern A) OR new table (Pattern B) |
| Claim lifecycle (pending → reviewed → verified) | A | New `claim_status` column or `claims` table |
| Admin review queue UI | A | New admin dashboard route in `mingla-admin/` |
| Phone-callback action affordance | A | New admin queue action (mark as called, approve, reject) |
| Comparison wizard UI | A | New full-screen wizard in `mingla-business/app/` |
| Pool-prefill data flow | A | New service `placePoolPrefillService.ts` |
| Off-pool blank wizard | A | Same wizard, no prefill path |
| Photo override semantics | A | Reuse `brand_covers` upload pattern + UX for "keep ours / replace yours" |
| Hours-of-operation structured data | A | New `brand_hours` sidecar table |
| Vibe / intent tags on venue | A | New jsonb column OR `brand_vibes` join table |
| Verified badge UI on public surfaces | A | UI overlay on `/b/[brandSlug]` + consumer-side display logic |
| Partner discovery & invite UI | B | New admin + business app UI |
| `business_partnership` table | B | New table |
| Partner-consent constraint on experiences | C | DB-level CHECK or trigger |
| `business_curated_experience` table | C | New table |
| `business_experience_step` table | C | New table |
| Experience authoring wizard | C | New screen |
| Signal scorer extension for experiences | C | Edge function update |
| Consumer-side display of business experiences | D | Consumer app changes |
| Attribution chip ("By [Venue]") | D | Consumer app changes |
| Dispute / unclaim / transfer flow | Post-MVP | Admin tooling |
| Dormancy claim-reclamation | Post-MVP | Admin tooling |

### 9.3 Conflicts to resolve

| Conflict | Description | Resolution Pattern |
|----------|-------------|--------------------|
| Brand-vs-venue concept | Current schema treats brand as organizer-or-venue via `kind`. Operator brainstorm assumed venue is separate. | Choose Pattern 3.5.A, 3.5.B, or 3.5.C |
| Multi-location chains | Schema is one-brand-one-address. Chains break this. | Decide: out-of-scope for first cycle OR new `brand_locations` table |
| `brands_public_view` requires a public event | A claimed venue without an event won't appear publicly | Change view contract OR add parallel `claimed_venues_public_view` |
| `address` is freeform | Structured place data must coexist | Add structured columns; deprecate freeform OR keep both |
| Stripe Connect at brand level | If chains have multi-brand or multi-listing, Stripe ownership ambiguous | Resolve when chain support is specced |
| Ari `create_brand` already exists | Claim flow overlaps | Enhance existing tool OR add `claim_venue` parallel tool |
| `events.city` populated at publish | Venue's structured city should match | When event is at a claimed venue, inherit city from brand |
| `events.location_text` freeform vs venue structured | UX may show two addresses | Auto-fill event location from claimed venue on event-create |

### 9.4 Integration patterns brainstormed (3 per major gap)

The full pattern list with tradeoffs is folded into the section-specific patterns (3.5.A/B/C, 4.4.A/B/C, 8.3.A/B). Forensics restates without picking:

#### For data model (§3.5):
- A — Venue IS a brand of kind='physical' (lowest risk, conceptual ambiguity)
- B — Sibling `business_listing` table (cleanest separation, largest cost)
- C — Repurpose brands as venues_or_organizers (cleanest mental model, largest UI refactor)

#### For wizard placement (§4.4):
- A — Replace BrandSwitcherSheet with venue/organizer fork (highest discoverability, existing UX disruption)
- B — New top-level Claim Venue entry on Account tab (zero disruption, lower discoverability)
- C — Persona-pick at first-launch (highest clarity, adds friction)

#### For Ari involvement (§8.3):
- A — Ari guides operator into claim wizard via conversational prefill (conversational UX, more tools)
- B — Ari only post-claim (simpler tools, claim flow is UI-only)

#### For validation timing:
- A — Admin phone-callback only (current operator brainstorm, 4h SLA)
- B — Admin phone-callback PLUS Stripe Connect completion (stronger, slower)
- C — Stripe Connect first, admin call as secondary review (strongest validation, longest onboarding)

#### For multi-location:
- A — Out-of-scope for Phase A; one brand = one venue
- B — New `brand_locations` table from Phase A
- C — Allow operator to create N brands as a workaround until v2

#### For public surface contract:
- A — Extend `brands_public_view` to include claimed venues without events
- B — New `claimed_venues_public_view` parallel surface
- C — Keep existing view; claimed venues only appear when they have events (forces engagement)

Forensics observes these patterns and lists tradeoffs. Operator picks.

---

## §10 — Risk Register

Top risks the audit surfaced, ranked by severity × likelihood.

### Risk 10.1 — Brand-vs-venue conceptual collision

- **Severity:** S0 (cycle-blocker if undecided)
- **Likelihood:** H if not resolved up front
- **Description:** if Pattern A/B/C isn't chosen before Phase A SPEC, every downstream decision (data model, wizard placement, Ari tools, public surface) will be ambiguous. Mid-build pivots are expensive.
- **Mitigation:** operator picks pattern before SPEC dispatch. Forensics lays out the three options in §3 with concrete tradeoffs.

### Risk 10.2 — `brands_public_view` excludes event-less brands

- **Severity:** S1
- **Likelihood:** H if claim flow ships without view change
- **Description:** a venue that claims, completes the wizard, and submits — but never creates an event — will NOT appear on `/b/[brandSlug]` because the view requires a public scheduled/live event. Operators will report "I claimed my venue but I'm invisible."
- **Mitigation:** decide §9.3 view contract change as part of Phase A SPEC. Either extend the view OR introduce a parallel view.

### Risk 10.3 — Stripe Connect timing in the wizard

- **Severity:** S1
- **Likelihood:** M
- **Description:** if Stripe Connect is required to submit the listing for review, the wizard adds 10-20 minutes of friction (Stripe's hosted onboarding is long). If Stripe Connect is deferred, the validation gate weakens (no automatic business-identity proof).
- **Mitigation:** operator picks validation pattern in §11.

### Risk 10.4 — 4-hour admin SLA depends on operator availability

- **Severity:** S1
- **Likelihood:** H during single-operator phase
- **Description:** the 4-hour SLA requires someone to call the Google-listed number within business hours. If operator is in a meeting, traveling, or asleep (outside business hours), the SLA is missed. Repeated misses erode trust.
- **Mitigation:** define "business hours" precisely in the in-app copy; show "within 24 business hours" as a softer fallback in non-business-hours submissions; add a second reviewer before scaling past ~5-10 onboardings/day.

### Risk 10.5 — Multi-location chains break one-brand-one-venue

- **Severity:** S2 (S1 if chains are in scope for Phase A)
- **Likelihood:** M
- **Description:** Starbucks, Chipotle, neighborhood coffee chains with 5 locations cannot represent themselves cleanly under the current schema. If a chain operator tries to claim 5 venues, they'd create 5 separate brands — losing chain identity, paying for 5 Stripe Connect onboardings.
- **Mitigation:** confirm chain support is out-of-scope for Phase A. If chains are in-scope, design `brand_locations` from Phase A.

### Risk 10.6 — Ari `create_brand` tool overlap

- **Severity:** S2
- **Likelihood:** M
- **Description:** Ari can already create brands. If the claim flow becomes a brand-creation path (Pattern 3.5.A), Ari's `create_brand` tool could create venue-shaped brands inadvertently OR be enhanced to require place_pool_id when `kind='physical'`. Without explicit handling, operators may bypass the claim wizard via Ari and create brands without going through validation.
- **Mitigation:** decide §8 Ari involvement pattern; if A, enhance tools; if B, gate `create_brand` to `kind='popup'` only.

### Risk 10.7 — `place_pool` schema changes during Phase A

- **Severity:** S2
- **Likelihood:** L (post-ORCH-0700 + post-ORCH-0734, place_pool is stable)
- **Description:** if `place_pool` schema is mutated during Phase A development (e.g., by a parallel consumer-app cycle), the new edge function `claim-search-pool` could break.
- **Mitigation:** coordinate with operator on consumer-app cycles touching `place_pool`. Currently signal_anchors are decommissioned, AI categorization is dropped — schema is calmer than 6 months ago.

### Risk 10.8 — Off-pool signups create unbounded data growth

- **Severity:** S3
- **Likelihood:** M
- **Description:** if anyone can sign up with an off-pool venue (no `place_pool` match), they fill in their own data including a phone number. The admin call relies on operator looking up the venue on Google Maps to find the canonical number. If the venue genuinely doesn't exist on Google, validation falls back to the operator-provided number, which could be a burner. Imposters could flood the queue.
- **Mitigation:** require off-pool signups to provide a website URL or government business registration number (a soft additional check). Add rate limiting on signups per account.

### Risk 10.9 — Photo override fallback semantics

- **Severity:** S3
- **Likelihood:** L
- **Description:** if the business hides all our Google photos but doesn't upload replacements, the public page shows empty photo slots. Operator brainstorm decided to fall back to Google photos. The fallback logic needs to be explicit; a buggy fallback could either over-show Google photos (after they uploaded their own — privacy concern if Google photos include licence plates etc.) or under-show (blank cards).
- **Mitigation:** spec the fallback rule precisely in Phase A SPEC. Suggested rule: "show business photos if any are uploaded AND not hidden; otherwise fall back to non-hidden Google photos."

### Risk 10.10 — Decommissioned AI categorization columns

- **Severity:** S1 if not respected
- **Likelihood:** L (well-documented in memory)
- **Description:** per `feedback_ai_categories_decommissioned.md`, `place_pool.seeding_category`, `ai_categories`, `ai_reason`, `ai_primary_identity`, `ai_confidence`, `ai_web_evidence` are DROPPED columns. Any new code referencing them is broken.
- **Mitigation:** Phase A SPEC must explicitly reference the canonical replacement (matview `admin_place_pool_mv.primary_category` + SQL helper `pg_map_primary_type_to_mingla_category`). Strict-grep CI gate would catch violations.

---

## §11 — Open Questions for Operator

Forensics hit eight forks where the audit cannot resolve direction without operator input. These should be answered before Phase A SPEC is dispatched.

### Q1 — Data model pattern for venue identity

Pick one of §3.5.A / §3.5.B / §3.5.C. Default if no preference: Pattern A (venue IS a brand of kind='physical'). Forensics recommendation: A.

### Q2 — Wizard placement

Pick one of §4.4.A / §4.4.B / §4.4.C. Default: B (new top-level entry on Account tab). Forensics recommendation: B for first cycle, escalate to C if operator-onboarding feedback indicates the persona fork is needed.

### Q3 — Multi-location chains in Phase A?

Yes / No. Default: No (out-of-scope; one brand = one venue for first cycle). If Yes, add `brand_locations` to Phase A SPEC.

### Q4 — Stripe Connect timing in wizard

Pick one of: required-before-submit / deferred-to-first-paid-event / optional-but-prompted-during-wizard. Default: deferred (today's behavior). Forensics observation: required-before-submit dramatically strengthens validation but adds friction.

### Q5 — Ari involvement in claim flow

Pick §8.3.A (conversational entry) or §8.3.B (post-claim only). Default: B for first cycle, A as a Phase C/D enhancement.

### Q6 — Public surface contract change

Pick §9.3 view-contract pattern: extend `brands_public_view` OR add parallel `claimed_venues_public_view`. Default: parallel view (cleaner separation, doesn't change existing contract).

### Q7 — Off-pool signup gating

Default per operator brainstorm: allow off-pool signups, admin looks up venue on Google Maps for verification. Forensics adds: should we require website URL or business-registration-number as a soft check? Default: not required for Phase A; add if abuse appears.

### Q8 — `brands.address` migration

If we add structured columns, what happens to the freeform `address`? Pick: (a) keep both, freeform is canonical display; (b) keep both, structured is canonical display, freeform deprecated; (c) drop freeform entirely. Default: (a) — minimal disruption, deferred decision.

---

## §12 — Findings Outside Scope (Discoveries for Orchestrator)

These are observations forensics surfaced during the audit that are NOT in scope for the claim flow but the operator/orchestrator may want to register as follow-up ORCHs.

### D-0825-1 — `brands_public_view` is restrictive

Brands without any public live/scheduled event are invisible publicly. This may already be causing operator confusion (a brand exists, but `/b/[brandSlug]` shows "not found"). Worth verifying with operator support data.

### D-0825-2 — No onboarding checklist UI

There is no "complete your profile" progress affordance in the business app. Operators can have a 30%-complete brand and not know what's missing. A future ORCH could ship a `BrandOnboardingChecklist` overlay that gently nudges Stripe Connect, profile photo, address, etc.

### D-0825-3 — `events.location_text` freeform when `events.city` is structured

Per ORCH-0824, `events.city` is populated from Google Places at publish, but `events.location_text` is still the freeform display field. There's potential for `location_text` to disagree with `city` (e.g., "downtown" vs "Manhattan"). May warrant a future cleanup ORCH.

### D-0825-4 — `creator_accounts.persona` doesn't exist (Pattern 4.4.C would need it)

If we go with first-launch persona-pick (Pattern 4.4.C), there's no existing column to persist the choice. Trivial add but worth flagging.

### D-0825-5 — Stripe Connect captures address that Mingla doesn't re-use

The address Stripe collects during onboarding could pre-fill `brands.address` automatically. Today it's siloed in Stripe's account. Future optimization.

### D-0825-6 — Marketing Hub Phase B/C deferred

Per `project_orch_0815_b_polish_deferred.md`, Marketing Hub composer polish + email polish + templates UI are deferred to a feedback-driven Sub-C. The venue-claim cycle should NOT entangle Marketing Hub Phase C work; they're independent.

---

## §13 — Confidence Statement

Overall confidence on the audit: **H** for all findings backed by direct file reads + migration verification. Specific confidence per section:

| Section | Confidence | Notes |
|---------|-----------|-------|
| §1 Surface inventory | H | All 56 routes mapped via Explore agent + spot-verified |
| §2 Data model | H for brands, events, marketing_audiences, agent_*; M for marketing_campaigns/messages/clicks/templates (table existence confirmed, columns not fully read) |
| §3 Brand concept | H | Baseline migration + ALTER migrations read end-to-end |
| §4 Onboarding flow | H | Service file + UI route inspection |
| §5 Place_pool linkage | H | Grep result + memory cross-reference |
| §6 Stripe Connect | H | Service + hook + migration commentary |
| §7 Marketing Hub | H | Composer file read + migration |
| §8 Ari capabilities | H | Tool registry read directly |
| §9 Gap analysis | H for "what's reusable" + "what's missing"; patterns are forensics framing not yet operator-decided |
| §10 Risk register | H | Each risk grounded in §1-9 findings |
| §11 Open questions | N/A — these are forks for operator |

Forensics did not run the iOS sim or Android emulator during this audit because the scope is structural (data model, surface map, integration patterns) — no described UI/UX/keyboard/gesture reproducer applies. Per the Prime Directive 7 exemption clause ("pure backend / SQL / migration / RLS / edge-function / CI / build-config / lint / type investigations, and investigations explicitly scoped to 'code audit only' in the dispatch"), this audit qualifies for the exemption.

---

## §14 — Recommended Direction Summary (Forensics Observation, Operator Decides)

Based on §1-13, the lowest-risk, fastest-to-ship integration shape is:

1. **Data model: Pattern 3.5.A** — venue IS a brand of kind='physical'. Add ~6 columns to `brands` (`place_pool_id`, `google_place_id`, `lat`, `lng`, `city`, `country_code`, `claim_status`, `verified_at`) + 1 sidecar `brand_hours`. Multi-location chains explicitly out-of-scope for Phase A.

2. **Wizard placement: Pattern 4.4.B** — new top-level "Claim a venue" entry on the Account tab. Existing brand creation unchanged for popup operators.

3. **Validation: phone-callback only (operator brainstorm)** plus Stripe Connect remains deferred to first paid event (today's behavior). Stripe Connect strengthens validation downstream when the operator publishes.

4. **Public surface: parallel view** `claimed_venues_public_view` — keeps the existing `brands_public_view` contract intact, adds claimed venues without forcing them to have events.

5. **Ari: Pattern 8.3.B** — post-claim only. Claim wizard is UI-driven; Ari learns about venues after they're live and can update them.

6. **Off-pool signups: allow, no additional soft check** for Phase A; add abuse mitigation in a follow-up if needed.

7. **`brands.address` freeform: keep**, structured columns become the canonical display source; freeform retained for non-physical brands.

This shape lets Phase A ship in **~3-4 weeks** (claim wizard + 6 new brand columns + 1 sidecar table + 1 admin queue + 1 new edge function + 1 new public view + Resend email templates), keeps Phase B (partner network), Phase C (curated authoring), Phase D (pairing & surfacing) clean follow-ups, and avoids the conceptual rework of Patterns 3.5.B/C.

**Forensics is not picking. Operator decides.**

---

## Next Phase Routing

After operator reviews this audit:

1. Operator answers the 8 open questions in §11
2. Orchestrator (Claude `mingla-orchestrator`) formalizes the META-ORCH-0825 umbrella and four sub-ORCHs (Phase A/B/C/D) in `Mingla_Artifacts/WORLD_MAP.md` + `MASTER_BUG_LIST.md`
3. Orchestrator logs the 8 resolved architectural decisions in `DECISION_LOG.md`
4. Orchestrator dispatches Claude `mingla-forensics` (SPEC mode) for Phase A SPEC writing
5. Phase A SPEC dispatch produces `Mingla_Artifacts/specs/SPEC_ORCH-0825-A_BUSINESS_CLAIM_AND_VENUE_LISTING.md`
6. Operator reviews SPEC
7. SPEC dispatched to implementor (Codex `implementor-mingla` per default routing; or Claude `mingla-implementor` per operator preference)
8. Implementation report returns
9. Claude `mingla-forensics` (TEST mode) verifies
10. Orchestrator CLOSES, runs DIAG reap, commits, deploys edge functions, EAS OTAs

Working tree throughout: `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`.

---

## Artifact Metadata

- **Report path:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0825_BUSINESS_APP_VENUE_CLAIM_INTEGRATION_AUDIT.md`
- **Length:** ~1100 lines (target 3000-5000 trimmed for signal density)
- **Lead investigator:** Claude `mingla-forensics`
- **Sub-agents used:** Two Explore agents (surface inventory + data model snapshot)
- **Sub-agent findings verified:** Critical claims (brand `kind`, address columns, events location fields, place_pool absence) re-read from authoritative source files
- **Open questions:** 8 (§11)
- **Discoveries for orchestrator:** 6 (§12)
- **Confidence:** H overall
