# RESEARCH — Business App → Pipeline Feeder (Supply Side)

**Mode:** Forensics INVESTIGATE + RESEARCH (no SPEC, no solutions; matrix only, operator picks the winner)
**Dispatch:** `Mingla_Artifacts/prompts/FORENSICS_BRAINSTORM_BUSINESS_APP_TO_PIPELINE_FEEDER.md` (2026-05-26)
**Status:** Brainstorm — no ORCH-ID yet
**Companion report:** `Mingla_Artifacts/research/RESEARCH_EXPERIENCE_PIPELINE_TO_CONSUMER_DECK.md` (demand side — must be read first; this report builds on it)
**Author skill:** Claude `mingla-forensics`
**Date:** 2026-05-26

**Single question answered:** *How do we design and structure the Mingla business app so it keys into the recommendation pipeline — replacing Google as the `place_pool` feeder — by capturing the right data from operators, processing it through AI that produces the same per-signal evaluations the consumer deck consumes, and surfacing it back to the consumer-app swipeable deck with no special-casing at the ranker level?*

---

## §1 — Executive answer (read this first)

**The four-part answer, in plain English.**

**(1) What we ask the operator.** A short minimum (about 4 minutes of work — name + address + 1 photo + hours + the venue category they're in), then an AI-assisted enrichment pass (photo upload of menu OR activity list, which Gemini parses into structured items), then a 6-question "what's this place for?" vibe questionnaire that is the supply-side equivalent of the Gemini Q2 evaluation from the demand-side research. Tier 1 is the gate to publish; Tier 2 is the gate to be deck-eligible; Tier 3 is ongoing maintenance prompts.

**(2) What our AI does.** Five stages, all writing to either the existing `agent_pending_actions` queue (operator confirms before persistence) or directly to a new `place_pool` row (when the operator is brand-new with no Google place to claim): menu OCR (already live, Gemini 2.5 Flash), photo analysis for `primary_type` candidates + aesthetic score + dedupe, structured-facet inference (auto-populate the 30+ Google booleans like `serves_brunch`, `outdoor_seating`, `live_music` from menu + photos + operator answers), description generation (operator-style editorial_summary), and signal pre-evaluation (the Q2-shaped output the consumer ranker reads). The signal pre-evaluation is the key new piece — it produces the same `{score_0_to_100, inappropriate_for, reasoning}` shape per signal that the demand-side research locks in, so a brand-new operator-authored place is rankable from day one without waiting for Serper review scrapes.

**(3) How it hooks to the deck.** Two contracts. **Part A — Places:** every business-authored place becomes a `place_pool` row that is shape-identical to a Google-sourced row. `claimed_by = brand.id`, `is_servable = true` (after bouncer pass against the same chain rules Google places face), and `ai_signal_scores` populated at onboarding time from the operator-vibe pass. The consumer ranker reads it with zero special-casing. **Part B — Experiences:** the existing brand-authored experiences (today `events` table where `event_type='experience'`, none in production yet) become a NEW deck card surface — `cardType: 'brand_curated'` alongside today's AI-generated `cardType: 'curated'`. When a user's intent is `first-date` and a brand has authored an experience tagged for `first-date`, the brand's hand-curated card surfaces with priority. This is the supply side's biggest unique unlock — it lets brands actively recommend "here's the 3-stop date I'd recommend" rather than passively wait to be ranked.

**(4) How the business app is structured.** The unified 4-step `BrandCreationFlow` post-META-ORCH-0972 [brand-kind decommission] is the right starting frame, but it needs three extensions to feed the pipeline: (a) the 7-step `VenueCreatorWizard` (already live for the Ve1 venue claim path) becomes the universal venue-authoring flow rather than a claim-only flow, gated by "do you have a physical address?" yes/no; (b) the menu/activities parser flow (live as Ve5/Ve6, currently 0 completions out of 26 attempts) becomes a permanent feature of the brand Hub rather than a one-shot during onboarding; (c) a new "Vibe" tab where the operator answers 6 questions ("Best for: first date / group nights / quiet solo / brunch with friends / etc.") and sees the AI's signal-pre-evaluation result with edit-or-confirm buttons — this is both the supply-side delight (operator sees how the deck will rank them) and the trust-and-verify mechanism (operator can correct overconfident AI).

**The top 3 risks.** First, **completion-funnel collapse.** Today's 26 parse attempts → 0 completed experiences is a -100% completion rate. If onboarding doubles in length to feed the pipeline, this gets worse. Mitigation: every new field must be either AI-derivable with operator-confirm-or-edit, or progressively disclosed across multiple sessions. Second, **operator-self-report bias on vibe.** Every restaurant claims to be "great for first dates." Mitigation: use operator vibe as one signal among three (operator self-report + AI-from-menu-and-photos + AI-from-reviews-once-they-exist), with operator overrides bounded to "edit, not invent" — they can correct an AI score within a band, not push it from 20 to 95. Third, **chain venue duplicate-claim spam.** The live data already shows 2 brands claiming the same place (no UNIQUE on `brands.place_pool_id`). Mitigation: claim verification before deck eligibility, not just before published-page visibility.

---

## §2 — Phase 0 evidence (one-line cite per source)

### Codebase reads (business app + supply-side pipeline)

- [`mingla-business/src/types/brand.ts`](mingla-business/src/types/brand.ts):170-299 — `Brand` interface; Ve1 claim fields (`claimStatus, rejectionReason, claimFollowUpAt, duplicateOfBrandId, googlePlaceId, lat, lng, city, countryCode, venueCategory`), Ve2 pool link `placePoolId`, Stripe fields, profile fields, custom_links + social_links + display_attendee_count. The `kind` field DELETED post META-ORCH-0972 (data still in DB until Stage 4).
- [`mingla-business/app/venue/create.tsx`](mingla-business/app/venue/create.tsx):1-100 — pool match search via `usePoolMatchSearch()`, 7-step `VenueCreatorWizard` (Address → Name+slug → Photos → Hours → Contact → Story → Review).
- `mingla-business/src/services/poolSearchService.ts:51` — calls `claim-search-pool` edge function (Ve2 RPC consumer; defaults to single match, ORCH-0883 flags this as a chain-venue gap).
- [`mingla-business/src/services/experiencesService.ts`](mingla-business/src/services/experiencesService.ts):70-80 — reads from `events` table where `event_type='experience'`, extracts `theme.experience_meta`. Brand-scoped, no `place_pool_id` link.
- [`mingla-business/src/services/experienceGenerationService.ts`](mingla-business/src/services/experienceGenerationService.ts):12-111 — input shape (`brand_id`, `files[]` jpeg/png/pdf base64, max 10MB), rate limit 20 parses/day, calls `parse-restaurant-menu` or `parse-play-activities`, then `confirmExperienceProposal()` calls `confirmAgentAction()` which routes to `agent-confirm-action` edge fn.
- [`supabase/functions/parse-restaurant-menu/index.ts`](supabase/functions/parse-restaurant-menu/index.ts):1-238 — Gemini 2.5 Flash via `geminiMenuParser.ts`, output shape `ParsedMenuExperience = {title, narrative, suggested_price_min_cents, suggested_price_max_cents, currency, intent_tags[], confidence}`, writes to `agent_pending_actions` with `source='hub_experience'` + 24h expiry. No direct INSERT to `events`.
- [`supabase/functions/parse-play-activities/index.ts`](supabase/functions/parse-play-activities/index.ts):1-256 — same Gemini provider, additional fields `capacity_min, capacity_max, suggested_time_of_day`, gated by `brand.venue_category='play'`.
- `supabase/functions/claim-search-pool/index.ts:124` — RPC call to `biz_search_place_pool_for_claim(p_query, p_limit)`.
- `supabase/migrations/20260618000001_ve2_claim_search_rpc.sql:5-66` — `biz_search_place_pool_for_claim(text, int DEFAULT 5)` SECURITY DEFINER, capped at 10 results, ordered by name prefix + review_count + name.
- `supabase/migrations/20260603000001_orch_0821_ari_agent_tables.sql:111+` — `agent_pending_actions` table created (Ari MVP, ORCH-0821). Status check constraint: `'pending','confirmed','completed','failed','expired','rejected'`.
- `supabase/migrations/20260613000000_ve1_physical_venue_brand_onboarding.sql:11` — `brands.place_pool_id` FK to `place_pool(id)` added. No UNIQUE constraint (multiple brands can claim the same place).
- `supabase/functions/brand-stripe-onboard/index.ts:1-80` — Stripe Connect onboarding entry; Mingla stores `stripe_connect_id, country, default_currency, stripe_charges_enabled, stripe_payouts_enabled` only. **Full KYC payload lives in Stripe, NOT in Mingla DB.**

### Prior artifact reads (constraints)

- `Mingla_Artifacts/specs/SPEC_META-ORCH-0972_BRAND_KIND_DECOMMISSION.md` — universal authoring, Stripe gates money not authoring, address optional, persona picker DELETED, unified `BrandCreationFlow` (4 steps: Identity → Address [optional] → Cover → Welcome+OfferingChooser), hub + public page tabs data-driven.
- `Mingla_Artifacts/specs/SPEC_ORCH-0881_VE5_MENU_AI_PARSER.md` — `agent_pending_actions` extended with `source` enum + `related_brand_id` FK + `related_event_id` FK + `idx_agent_pending_hub_experience` partial index.
- `Mingla_Artifacts/INVARIANT_REGISTRY.md` — I-BRAND-UNIVERSAL-AUTHORING (ACTIVE), I-VENUE-CLAIM-OPTIONAL (ACTIVE), I-PUBLIC-PAGE-DATA-DRIVEN-TABS (ACTIVE), I-HUB-TABS-DATA-DRIVEN (ACTIVE), I-PROPOSED-BRAND-FIELD-MAP-COVERAGE (ACTIVE post ORCH-0962), I-ARI-USER-DATA-WRAP (defense against prompt injection — gates ALL operator-text-to-AI passes), I-ARI-PENDING-STATE-MACHINE (DB-enforced 6-state machine).
- `Mingla_Artifacts/DECISION_LOG.md` DEC-180 (2026-05-25, ORCH-0957) — operator deferred "stop mirroring Google Places photos" — explicitly does NOT include any decision to replace Google as the place_pool feeder. **No prior ORCH or DEC has discussed replacing Google as the source of place_pool rows.** This is novel architectural territory.
- `Mingla_Artifacts/WORLD_MAP.md` — Ve1-Ve6 phase timeline: Ve1 (ORCH-0100, CLOSED 2026-03-23, claim gate), Ve2 (PR #142, CLOSED 2026-05-19, pool search), Ve4 (migration `20260622000000_ve4_claimed_venues_public_view.sql`, public view + RLS), Ve5 (ORCH-0881, READY FOR SPEC, menu parser), Ve6 (no dedicated ORCH-0884 close note — implementation found but documentation gap), Ve3 (admin moderation — documentation gap; presumed operational via `biz_review_venue_claim` RPC).
- `Mingla_Artifacts/MASTER_BUG_LIST.md` open ORCHs touching supply side: ORCH-0883 (chain-venue single-match bottleneck, SPEC READY), ORCH-0968 (no hours editor in `BrandEditView`), ORCH-0967 (display_attendee_count toggle exists but no consumer renders it), ORCH-0966 (phoneCountryIso not persisted), ORCH-0969 (custom_links editor + renderer gap).

### Schema layer (live DB probes via Supabase Management API, 2026-05-26)

`brands` table columns (43 total):
- Identity: `id, account_id, name, slug, description`
- Media: `profile_photo_url, profile_photo_type, cover_media_url, cover_media_type, cover_hue`
- Theme (post ORCH-0964): `theme_color, theme_font, theme_animation`
- Contact: `contact_email, contact_phone, social_links jsonb, custom_links jsonb, display_attendee_count`
- Money: `default_currency, stripe_connect_id, stripe_payouts_enabled, stripe_charges_enabled, tax_settings jsonb`
- Lifecycle: `kind` (deprecated, data still present), `created_at, updated_at, deleted_at`
- Ve1/Ve2 venue claim: `address, lat, lng, city, country_code, venue_category, place_pool_id (FK → place_pool.id, no UNIQUE), google_place_id, claim_status, verified_at, verified_by, rejection_reason, claim_follow_up_at, duplicate_of_brand_id, marked_called_at, marked_called_by, claim_decision_emailed_at`
- `agent_pending_actions` columns: `id, user_id, conversation_id (nullable post-Ve5), tool_name, tool_args jsonb, status, expires_at, created_at, updated_at, source ('ari'|'hub_experience'|'hub_trip_day'), related_brand_id, related_event_id`.

### Data layer (live counts, 2026-05-26)

| Metric | Value | Implication |
|---|---|---|
| Total brands | **38** | Early-stage; all created within last 30 days (no historical accretion to leverage). |
| Active brands (deleted_at IS NULL) | **20** | ~50% retention from signup — typical early-stage attrition. |
| Stripe-connected brands | **19** | 50% of total brands have completed Stripe Connect. Identity data sits in Stripe, not Mingla DB. |
| Brands linked to a place_pool row | **2** | 5% of total. The Ve1 claim flow is rarely used today. |
| Distinct places claimed | **1** | The two brands above are both claiming the SAME place (exactly the chain-duplicate case ORCH-0883 flagged). |
| `claim_status` values seen | `none, rejected, verified` | No pending claims live today. |
| `venue_category` values seen | `restaurant` only | The taxonomy field exists; only one value populated in production. |
| `kind` values still set | `physical, popup, trip_planner` | Column data persists despite reads being decommissioned by META-ORCH-0972 (Stage 4 drops the column). |
| Total events | **121** across **7 brands** | Most brands (31 of 38) have authored nothing. |
| Events with `event_type='experience'` | **0** | **Zero brand-authored experiences exist in production yet.** Ve5 wired but unused. |
| `agent_pending_actions` total rows | **32** | Including Ari (general agent) + hub-experience parses. |
| `agent_pending_actions` source breakdown | `'ari'` + `'hub_experience'` | Both flows are active. |
| `agent_pending_actions` statuses seen | `cancelled, executed, failed, pending` | Note `executed` not `completed` — confirm semantics. |
| Hub-experience parse attempts | **26** | Operators have triggered the menu parser. |
| Hub-experience parses completed | **0** | **-100% completion rate.** This is the most important number in this report. |
| `place_pool.is_claimed = true` | **0** | Column exists, never written. |
| `place_pool.claimed_by IS NOT NULL` | **0** | Same — dead schema. Brand→place link lives ONLY on `brands.place_pool_id`. |

### External research (cited)

- Google Business Profile verification — postcard increasingly deprecated; **video verification is the 2026 default** for new listings; postcards still issued but slow (5-14 days delivery + 30-day code expiry). Per [Google Business support](https://support.google.com/business/answer/7107242) and [JXT Group 2026 verification analysis](https://www.jxtgroup.com/google-business-profile-verification-in-2026-new-warnings-video-requirements-how-to-stay-compliant/).
- Marketplace cold-start research: **68% of new vendors abandon onboarding due to friction**; **each additional form field reduces completion 5-7%**; **two-thirds of failed marketplaces die on the supply side, not the demand side**. Per [FORKOFF's 2026 playbook](https://forkoff.xyz/blog/founder-growth/two-sided-marketplace-cold-start-2026) and [Sharetribe Academy](https://www.sharetribe.com/academy/onboard-initial-marketplace-supply/). Mitigation pattern: AI-assisted onboarding cuts cold-start time to ~90 days.
- Schema.org `Restaurant` + `Menu` + `MenuItem` vocabulary is industry-standard. Key fields: `servesCuisine` (plain text — "Italian", "Sushi"), `hasMenu` → `Menu` → `MenuItem` (with `suitableForDiet`, `nutrition`, `offers.price`, `offers.priceCurrency`). See [schema.org/Restaurant](https://schema.org/Restaurant), [schema.org/Menu](https://schema.org/Menu), [schema.org/MenuItem](https://schema.org/MenuItem). Reference [richmenu.io 2026 implementation guide](https://richmenu.io/restaurant-schema-markup/).
- **Square Catalog API** as a programmatic menu source: full menu items + pricing + variations + categories pullable for any seller using Square POS. Free tier exists. Per [Square Catalog API docs](https://developer.squareup.com/docs/catalog-api/what-it-does) and the [Square Restaurants 2026 review](https://www.nerdwallet.com/business/software/reviews/square-for-restaurants).
- **Claude vision pricing for menu OCR.** Token cost ≈ `(width × height) / 750`. A 2000×2000 image = ~5,300 tokens. At Claude Haiku 4.5 batch ($0.50/M input), that's ~$0.003 per image. Resizing to 1024px long edge cuts cost 40-70% with no accuracy loss on text-heavy imagery. Per [Anthropic Vision docs](https://platform.claude.com/docs/en/build-with-claude/vision) and [pricing](https://platform.claude.com/docs/en/about-claude/pricing).
- **Yelp claim flow** — photo review takes 24h; low-quality (blurry/dark) photos auto-removed. Per [Yelp claim guide](https://business.yelp.com/resources/articles/ultimate-guide-to-claiming-your-yelp-page/).
- **Atlas Obscura + Apple Maps Guides** as the reference for brand-curated experiences as a deck surface — operator-authored "guides" with editorial framing, surfaced as a discrete content type alongside algorithmic recommendations. Per [Atlas Obscura on Apple Maps](https://maps.apple.com/guides?publisher=16848065406089037853).
- **OpenTable** structured data — `servesCuisine`, dress code, reservation slots; deep enterprise integration not realistic for indie at Mingla's scale. Reference [OpenTable support](https://support.opentable.com/s/?language=en_US).

---

## §3 — Current state truth table (5 layers, by subsystem)

| Subsystem | Docs | Schema | Code | Runtime | Data |
|---|---|---|---|---|---|
| **Brand creation** | META-ORCH-0972 spec: unified 4-step `BrandCreationFlow` | `brands` table 43 columns; `kind` deprecated but still present | `BrandCreationFlow` post-Sub-B | Live | 38 brands; 0 experiences authored |
| **Venue claim (Ve1+Ve2)** | Ve1 spec + Ve2 RPC migration | `brands.place_pool_id` FK (no UNIQUE) + `claim_status` enum | 7-step `VenueCreatorWizard` + `biz_search_place_pool_for_claim` RPC | Live | 2 brands linked, 1 distinct place (chain duplicate) |
| **Admin claim review (Ve3)** | Documentation gap | `brands.verified_at, verified_by, rejection_reason, claim_decision_emailed_at, marked_called_at` | Presumed `biz_review_venue_claim` RPC | Live (probably) | 0 pending claims today |
| **Public claim visibility (Ve4)** | Migration only | `claimed_venues_public_view` + public-read RLS | Used in `business_public_brands_view` | Live | 1 verified claim visible |
| **Menu parser (Ve5)** | SPEC_ORCH-0881 | `agent_pending_actions` with `source='hub_experience'` + 24h expiry + per-day rate-limit 20 | Gemini 2.5 Flash via `parse-restaurant-menu` | Live | 26 attempts, 0 completions |
| **Activities parser (Ve6)** | Documentation gap | Same `agent_pending_actions` table | Same model + provider as Ve5 | Live | Counted in the 26 above |
| **Experience persistence** | Spec implies `events` table | `events` with `event_type` enum, no `place_pool_id` FK | `experiencesService.ts` reads | Live | **0 experience rows in production** |
| **Place_pool authoring from business app** | NOT DOCUMENTED — novel territory | `place_pool.is_claimed, claimed_by` exist but unused | NO WRITE PATHS from `mingla-business/` | NOT WIRED | 0 brand-authored places |
| **Stripe Connect identity** | Stripe spec (ORCH-0950-0954 family) | `brands.stripe_connect_id` flag + status booleans only | `brand-stripe-onboard` | Live | 19 connected brands; full identity lives in Stripe, NOT in Mingla |

**Contradictions detected.**

1. **`place_pool.is_claimed` and `claimed_by` columns are completely unused** (0 rows). The Ve1/Ve2 design uses `brands.place_pool_id` as the link instead. Either drop the unused columns OR migrate to using them as the canonical link.
2. **Ve5/Ve6 parser flow has 100% drop-off** (26 attempts, 0 completions). Either the parse output is poor enough that operators abandon, or the confirmation UX is missing/broken, or operators don't know that they need to come back and confirm. This is the single largest red flag in the entire supply-side surface.
3. **`brand.kind` column still has data** (`physical, popup, trip_planner` all present) despite META-ORCH-0972 decommissioning reads. Stage 4 DROP COLUMN pending — registered for follow-up (META-ORCH-0972 Sub-E or equivalent).
4. **No UNIQUE constraint on `brands.place_pool_id`** + zero verification before publishing = chain-venue duplicate spam already happening (live data shows 2 brands on 1 place).
5. **`venue_category` field has only 1 value populated** (`restaurant`) despite Ve6 supporting `play` activities. Either the field isn't being set by current onboarding flows or play-category onboarding hasn't been used.

---

## §4 — The supply-side data model: what exists vs. what the pipeline needs

The demand-side report locks the contract: every place the consumer ranker reads needs a `place_pool` row with Google-shape columns, AND (post-wiring) an `ai_signal_scores` JSONB with the 16 per-signal evaluations.

**Maps current business-app data → required pipeline columns:**

| Pipeline-required field | Source today | Gap |
|---|---|---|
| `place_pool.name` | `brands.name` | OK if linked |
| `place_pool.address` | `brands.address` | OK |
| `place_pool.lat, lng` | `brands.lat, lng` | OK (Ve1 captures) |
| `place_pool.city, country` | `brands.city, country_code` | OK |
| `place_pool.primary_type, types[]` | NOT CAPTURED today | **Gap** — Google's place_pool inherits from Google's type taxonomy; business-app has `venue_category` (single value) which is much coarser. Need AI inference + operator-confirm. |
| `place_pool.opening_hours jsonb` (Google shape: periods + weekdayDescriptions) | `brand_hours` separate table (different shape) | **Gap** — schema reshape needed at the bridge. |
| `place_pool.stored_photo_urls[]` | `brand.profile_photo_url + cover_media_url` | **Gap** — Google places have 5-9 photos; brands have 2. Need a "venue photos" gallery beyond cover + profile. |
| `place_pool.serves_brunch, outdoor_seating, live_music, good_for_groups, allows_dogs, ...` (30+ booleans) | NOT CAPTURED | **Gap** — needs the AI-infer + operator-confirm flow per §6. |
| `place_pool.editorial_summary, generative_summary` | `brands.description, tagline` | Partial — needs LLM normalisation pass. |
| `place_pool.reviews jsonb` (Google's) | NOT CAPTURED | **Gap** — operator-authored places have no reviews on day one. Cold start. |
| `place_pool.rating, review_count` | NOT CAPTURED | **Gap** — cold start; default to NULL until in-app review/rating system exists. |
| `place_pool.price_level, price_tier, price_min, price_max` | `events.suggested_price_min/max_cents` (per experience) | Partial — needs aggregation at brand level OR per-experience pricing. |
| `place_pool.is_servable` | NOT SET today for brand-authored | **Gap** — needs new bouncer pass criteria for business-authored places. |
| `place_pool.is_claimed, claimed_by` | NOT WIRED (zero rows) | **Gap** — wire `claimed_by = brand.id` when a place is linked. |
| **`place_pool.ai_signal_scores` (new from demand-side research)** | NOT CAPTURED | **Gap** — needs §6 onboarding-time signal pre-evaluation pass. |

**Maps current business-app experiences → potential new deck card surface:**

| Field needed for `cardType: 'brand_curated'` deck cards | Source today | Gap |
|---|---|---|
| Brand identity (who curated this) | `brands.name, profile_photo_url, slug` | OK |
| Experience title + narrative | `events.title + theme.experience_meta.narrative` | OK (when populated) |
| Stops (multi-stop) | `events.theme.experience_meta` | Partial — current shape designed for single-experience-at-one-venue, not multi-stop |
| Intent tags (which intent does this serve) | `events.theme.experience_meta.intent_tags[]` | OK |
| Suggested price | `events.suggested_price_min/max_cents` | OK |
| Capacity | `events.theme.experience_meta.capacity_min/max` | OK (when activities-parsed) |
| Time of day | `events.theme.experience_meta.suggested_time_of_day` | OK (when activities-parsed) |
| Location for each stop | NOT in current shape | **Gap** — multi-stop experiences need per-stop `place_pool_id` references |

---

## §5 — The "what to ask the operator" matrix

Three tiers, with AI-derivable flag per field.

### Tier 1 — Onboarding required (gate to publish — 4 minutes target)

| # | Field | Why we need it | Capture mode | Add'l minutes | Pipeline use | AI-derivable? |
|---|---|---|---|---|---|---|
| 1 | Brand name | Identity | Text input | 0.2 | `place_pool.name`, `brands.name` | No |
| 2 | Venue category (`restaurant / play / nature / icebreakers / drinks / brunch / casual / fine_dining / movies / theatre / creative_arts`) | Routing to right Ve5/Ve6 parser; coarse signal floor | Multi-select chip | 0.3 | Maps to one of 10 Mingla category slugs; routes parser type | Yes from photos but operator must confirm |
| 3 | Address (1-line + city + country) | Geographic match, distance math | Autocomplete (Google Places search OR Mingla pool search) | 0.5 | `place_pool.address, lat, lng, city, country` | No |
| 4 | At least 1 hero photo | Card display; AI photo analysis input | Photo picker (camera or library) | 0.5 | `place_pool.stored_photo_urls[0]` | No |
| 5 | Opening hours per day | Open-now filtering | Time picker per day | 1.5 | `place_pool.opening_hours` (transformed to Google `periods` shape) | Inferable from POS if operator links Square/Toast; otherwise No |
| 6 | Contact (email OR phone, plus website if exists) | Verification + visibility | Text inputs | 0.5 | `brands.contact_email, contact_phone`; verification code path | No |
| 7 | A claim-or-create decision: "Is this place already on Google?" | Decides Ve1 (link existing place_pool row) vs. new path (create fresh row) | Search-and-pick or skip | 0.5 | If link: set `brands.place_pool_id`. If create: insert new `place_pool` row owned by brand | Yes — auto-search by name+address |

**Tier 1 total: ~4.0 minutes.** This is the minimum to be PUBLISHED (`PublicBrandPage` visible). It is NOT enough to be DECK-eligible — that's Tier 2.

### Tier 2 — Onboarding optional (gate to be deck-eligible — additional 3-5 minutes)

| # | Field | Why | Capture mode | Add'l minutes | Pipeline use | AI-derivable? |
|---|---|---|---|---|---|---|
| 8 | 3-5 more photos (interior, food, vibe) | Photo carousel, NIMA aesthetic ranking, vibe extraction | Photo picker | 1.0 | `place_pool.stored_photo_urls[1..5]` + collage source | No (operator provides; AI ranks) |
| 9 | Menu photo (restaurants) OR activity list photo (play venues) | Triggers Ve5/Ve6 parser → structured menu items → `serves_*` booleans | Photo + Gemini parse | 0.5 + async | Populates `serves_brunch, serves_lunch, serves_dinner, serves_breakfast, serves_beer, serves_wine, serves_cocktails, serves_dessert, serves_vegetarian_food` etc. | YES — Gemini parses, operator confirms |
| 10 | Vibe questionnaire (6 questions): "Who is this place best for?" "What's the energy level?" "What time of day shines?" "Group size sweet spot?" "Date vibe — quiet conversation, loud fun, or both?" "Special occasions or everyday?" | Signal pre-evaluation seed | Multi-select chips + slider | 1.5 | Feeds AI signal pre-evaluation (§6); written to `place_pool.ai_signal_scores` after AI pass | Combined input — operator + AI |
| 11 | Structured facets (booleans): outdoor seating, live music, good for groups, allows dogs, reservable, accessibility | Direct mapping to signal scorer field_weights | Toggle chips | 1.0 | `place_pool.outdoor_seating, live_music, good_for_groups, allows_dogs, reservable, accessibility_options` | YES from photos + menu — operator confirms |
| 12 | Price tier (chill / comfy / bougie / lavish) | Display + price signal in deck | Single-select chip | 0.2 | `place_pool.price_tier` | YES from menu (parsed prices) — operator confirms |
| 13 | Short story / bio (operator-style description) | LLM-rewrite into `editorial_summary` + `generative_summary` equivalents | Text area + AI-rewrite preview | 0.8 | `place_pool.editorial_summary, generative_summary` | YES — operator writes, AI normalises |

**Tier 2 total: ~5 additional minutes.** Tier 1+2 ≈ 9 minutes to deck-eligible. Below the 10-minute drop-off cliff per [marketplace onboarding research](https://forkoff.xyz/blog/founder-growth/two-sided-marketplace-cold-start-2026).

### Tier 3 — Ongoing maintenance (asked on revisits)

| # | Field | When prompted | Capture mode | Pipeline use |
|---|---|---|---|---|
| 14 | Refresh photos | Monthly nudge if last update >60 days | Hub home banner | Re-trigger photo analysis + collage |
| 15 | Update hours for holidays | Calendar-aware (US holidays + operator-set) | Hub home banner | `place_pool.secondary_opening_hours` |
| 16 | New menu | Whenever menu changes; operator-initiated | Same Ve5 parser | Re-extract `serves_*` booleans, refresh `ai_signal_scores` |
| 17 | Author a brand-curated experience | Always available in Hub | Multi-stop wizard (NEW) | Creates `events.event_type='experience'` with `cardType: 'brand_curated'` deck eligibility |
| 18 | Confirm or correct AI vibe pre-evaluation | After every Tier 2 onboarding OR menu refresh | Inline edit on signal scores | Updates `place_pool.ai_signal_scores` with operator override (within ±20 of AI baseline) |
| 19 | Review external reviews when Serper scrapes them | When >5 reviews aggregated | Notification + acknowledge | Operator-acknowledgement bumps brand_score for the place |

---

## §6 — The "what AI does" pipeline

Eight stages, all writing to either `agent_pending_actions` (operator confirms) or directly to `place_pool` / `ai_signal_scores`.

### Stage 1 — Menu OCR + dish extraction (EXISTING, live)

- **Input:** 1-5 menu photos/PDFs, base64-encoded, max 10MB total. From `experienceGenerationService.ts`.
- **Provider + model:** Google Gemini 2.5 Flash via `geminiMenuParser.ts`. Cited at [Gemini 2.5 Flash pricing](https://ai.google.dev/pricing/gemini-2-5-flash).
- **Output:** `ParsedMenuExperience { title, narrative, suggested_price_min_cents, suggested_price_max_cents, currency, intent_tags[], confidence }`.
- **Persistence:** `agent_pending_actions` row, `source='hub_experience'`, 24h expiry, operator approves → routes to `agent-confirm-action`.
- **Cost:** Per-image ~$0.003 at Gemini 2.5 Flash batch pricing (similar to Claude Haiku 4.5 at $0.50/M input batch — see [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing)).
- **Latency:** Async; operator returns to confirm.
- **Failure mode:** Confidence < 0.7 → flag for re-upload. Currently 0/26 completion suggests the confirmation UX is the blocker, not parse quality. **Top investigation priority for any spec dispatch.**

### Stage 2 — Activity-list extraction (EXISTING, live, Ve6)

Same provider/cost as Stage 1; additional output fields `capacity_min, capacity_max, suggested_time_of_day`. Gated by `brand.venue_category='play'`.

### Stage 3 — Photo analysis (NEW)

- **Input:** All operator-uploaded venue photos (Tier 1 hero + Tier 2 carousel = 4-9 photos).
- **Provider + model:** Claude Haiku 4.5 vision (existing in `score-place-photo-aesthetics` decommissioned-in-plan; the model + provider reuse, NOT the column). Per [Anthropic vision docs](https://platform.claude.com/docs/en/build-with-claude/vision).
- **Output:** `{primary_type_candidates: [{type, confidence}], aesthetic_score: 1-10, dedupe_hashes: [], vibe_tags: [], inferred_facets: {outdoor_seating, live_music, ...}}`.
- **Persistence:** Writes to a NEW `place_pool.photo_analysis JSONB` column (NOT the decommissioned `photo_aesthetic_data` — distinguish them to honor DEC-099 Cut 1). Operator sees aesthetic ranking + can reorder photos. Inferred facets queue into Stage 5.
- **Cost:** ~$0.003-0.007 per photo × 9 photos ≈ $0.03-0.06 per brand onboarding (resize to 1024px long edge per [vision cost optimization](https://www.developersdigest.tech/blog/claude-vision-api-production-guide)).
- **Latency:** Async; resolves within 5 seconds for a fresh upload batch.
- **Failure mode:** Aesthetic score < 4 → photo flagged for operator re-upload guidance ("this photo looks blurry — try retaking").

### Stage 4 — Description normalisation (NEW)

- **Input:** `brand.description` (operator-written), `brand.name`, parsed menu items (if available), photo vibe tags (Stage 3 output).
- **Provider + model:** Claude Haiku 4.5 text.
- **Output:** Two strings — short editorial-summary-equivalent (≤120 chars) + longer generative-summary-equivalent (≤400 chars), styled to match Google's voice for ranker-pattern compatibility.
- **Persistence:** `place_pool.editorial_summary, generative_summary`.
- **Cost:** ~5K input + 500 output tokens × $0.50/M input batch + $2.50/M output batch = ~$0.004 per pass.
- **Latency:** Sub-second.
- **Failure mode:** Output contains operator's literal claim ("we are the best"). Mitigation: prompt enforces neutral third-person editorial voice + operator review-and-confirm.

### Stage 5 — Structured-facet inference (NEW)

- **Input:** Parsed menu items (Stage 1), photo analysis (Stage 3), operator vibe questionnaire (Tier 2 #10), operator-toggled facets (Tier 2 #11).
- **Provider + model:** Claude Haiku 4.5 text (with structured JSON output mode).
- **Output:** Filled values for all 30+ `place_pool` booleans: `serves_brunch, serves_lunch, serves_dinner, serves_breakfast, serves_beer, serves_wine, serves_cocktails, serves_coffee, serves_dessert, serves_vegetarian_food, outdoor_seating, live_music, good_for_groups, good_for_children, good_for_watching_sports, allows_dogs, has_restroom, reservable, menu_for_children, dine_in, takeout, delivery, curbside_pickup` plus `accessibility_options jsonb, parking_options jsonb, payment_options jsonb`.
- **Persistence:** Direct writes to `place_pool` columns. Operator sees pre-filled toggles in Tier 2 onboarding (Tier 2 #11) with the AI-inferred values; operator can flip any of them.
- **Cost:** ~3K input + 1K output tokens × Haiku batch = ~$0.004 per pass.
- **Latency:** Sub-second.
- **Failure mode:** Inferred true for `outdoor_seating` when no patio actually exists → operator flips it false → AI doesn't override on next re-run (operator override sticky).

### Stage 6 — Signal pre-evaluation (NEW — KEY UNLOCK)

This is the supply-side mirror of the demand-side trial pipeline's Q2 evaluation. Same shape, different input.

- **Input:** Everything else (parsed menu, photo analysis output, operator vibe answers, operator structured facets, generated description).
- **Provider + model:** Gemini 2.5 Flash with the same prompt template as the trial pipeline's Q2 (sampled live during demand-side research at `place_intelligence_trial_runs.q2_response`), adapted to use operator-provided data INSTEAD of scraped reviews.
- **Output shape (identical to trial pipeline):** `{evaluations: [{signal_id, score_0_to_100, inappropriate_for, reasoning}, ...]}` — 16 entries, one per signal.
- **Persistence:** `place_pool.ai_signal_scores JSONB` keyed by signal_id (the column the demand-side research locks as the consumer ranker's read target).
- **Cost:** ~5K input + 2K output × $0.50/$2.50 batch ≈ $0.0075 per place (same as the trial pipeline's per-place cost).
- **Latency:** Async; resolves within 30 seconds.
- **Failure mode:** Operator-self-report bias inflates all scores. **Mitigation: detect when operator-provided vibe contradicts AI-from-menu-and-photos and surface both side-by-side in the "Vibe" tab; bound operator override to ±20 from AI baseline.**

### Stage 7 — Cross-validation against Google (NEW)

- **Input:** When Ve1 claim flow links to an existing Google-ingested `place_pool` row.
- **Provider + model:** No AI — deterministic field comparison.
- **Output:** Diff report — what does the operator say differs from Google? Operator confirms which side is truth.
- **Persistence:** Operator-confirmed values overwrite Google's; Google's values archived to `place_pool.raw_google_data` (already exists).
- **Cost:** Free.
- **Latency:** Sub-second.
- **Failure mode:** Operator confirms wrong (e.g., claims hours that don't match reality). Mitigation: spot-check via in-app reviews + bounce rate; flag suspicious overrides for admin review.

### Stage 8 — Bouncer servability check (REUSE EXISTING)

- **Input:** A `place_pool` row (newly authored OR newly enriched).
- **Provider + model:** No AI — same rules as `_shared/bouncer.ts` + `bouncerChainRules.ts` apply.
- **Output:** `is_servable: true | false` + `bouncer_reason`.
- **Persistence:** Updates `place_pool.is_servable, bouncer_reason, bouncer_validated_at`.
- **Cost:** Free.
- **Latency:** Sub-second.
- **Failure mode:** Operator-authored place fails bouncer (e.g., missing photos, missing hours). Mitigation: surface in operator's Hub with explicit checklist — "complete these to be deck-eligible."

---

## §7 — The hook-to-deck contract

### Part A — Places

**A.1 — Same shape, no special-casing.** A business-authored `place_pool` row must be column-shape-identical to a Google-sourced row. The consumer ranker (`discover-cards`, `generate-curated-experiences`) reads `place_pool` JOINed with `place_scores` JOINed with the new `ai_signal_scores` (per demand-side research). It does not care which side wrote the row.

**A.2 — RLS contract.** A new edge function (`brand-author-place` or extend `claim-search-pool`) writes the `place_pool` row with `service_role`. The brand owner can UPDATE their owned row (where `claimed_by = auth.uid()-resolved-to-brand-owner`) via a new direct-predicate RLS policy (per `feedback_rls_returning_owner_gap.md`). Admin can UPDATE any row.

**A.3 — The claim setup.** When a Tier 1 onboarding picks "this is on Google" and links to an existing place_pool row: `place_pool.is_claimed = true`, `place_pool.claimed_by = brand.id` (resurrect the dead columns and use them as canonical), `brands.place_pool_id = place_pool.id` (existing FK). When picking "create new" (no Google match): insert fresh `place_pool` row, set `place_pool.fetched_via = 'business_authored'` (new enum value alongside `'google_places_v1'`), `claimed_by` and `place_pool_id` linked as above.

**A.4 — Bouncer pass criteria for self-authored.** Same chain rules apply. Additional criteria: must have ≥1 photo + non-empty `opening_hours` + non-null `lat/lng` + `ai_signal_scores` populated (Stage 6 ran). The bouncer's existing `is_servable` flag is the gate.

**A.5 — UNIQUE on `brands.place_pool_id`?** **NO** — chain venues legitimately have multiple brands. But add a UNIQUE on `(brands.place_pool_id, brands.deleted_at IS NULL)` so deleted+restored brands can re-link, plus a `place_pool.canonical_brand_id` pointer (when multiple brands claim, one is the canonical operator for display purposes). This is a new sub-question for §9.

### Part B — Experiences (brand-curated cards as a new deck surface)

**B.1 — The new card type.** Extend the discriminated union in `app-mobile/src/types/expandedCardTypes.ts` to add `cardType: 'brand_curated'`. Same shape as today's `cardType: 'curated'` but with: `authoredBy: {brandId, brandName, brandPhoto}`, `narrative` (the operator's own pitch, not AI-generated), and `stops: BrandCuratedStop[]` where each stop references either a `place_pool_id` (must exist + servable) or a free-text "where" with operator-provided description.

**B.2 — Surfacing logic.** In the consumer deck's intent path, when a user selects an intent (e.g. `first-date`), the deck fetcher queries: (a) AI-generated `curated` cards via `generate-curated-experiences` (existing); (b) brand-authored `brand_curated` cards via a new `discover-brand-curated` edge function that reads `events` where `event_type='experience'` AND `intent_tags @> ARRAY[intent]`. Interleave brand-curated cards into the deck at a fixed slot ratio (e.g., 1 in 5 cards for paid brands, 1 in 10 for free brands).

**B.3 — Operator visibility into how their experience ranks.** Operator's Hub shows: total times surfaced, swipe-right rate, swipe-left rate, save rate, breakdown by intent. This is the supply-side delight feedback loop — operator sees the deck working for them.

**B.4 — Quality bar.** Brand-curated cards must pass a one-time quality gate before deck eligibility: ≥3 stops named, narrative ≥100 chars, every stop has a photo + address, all referenced `place_pool_id`s are servable. Mitigation against spam: rate-limit operators to ≤5 published experiences at a time (anti-Atlas-Obscura-listicle-fatigue).

### Part C — Refresh + freshness

Same triggers as the demand-side research §9 Q6, plus operator-specific:

| Trigger | Effect on the pipeline |
|---|---|
| Operator updates hours | `place_pool.opening_hours` overwritten + `last_detail_refresh` advances |
| Operator uploads new menu | Re-runs Stage 1 + Stage 5 + Stage 6 (parse → infer → signal pre-eval); `ai_signal_scores` refreshed |
| Operator updates photos | Re-runs Stage 3 (photo analysis); aesthetic ranking + dedupe + collage rebuilt |
| Operator confirms or corrects AI vibe pre-eval | Sticky override on `ai_signal_scores` for the corrected signals |
| Google reports `business_status` change (closed/relocated) | Auto-flag to operator in Hub; pause `is_servable` until operator confirms |
| 90-day silence | Nudge operator to refresh — auto-pause `is_servable` after 180 days if no activity |

---

## §8 — Cold-start + acquisition strategy (without Google)

**Reality check from live data.** 38 brands today, 19 Stripe-connected, 7 with events, 0 with experiences, 1 distinct place claimed. Mingla is in pre-liquidity territory. Per [FORKOFF marketplace cold-start research](https://forkoff.xyz/blog/founder-growth/two-sided-marketplace-cold-start-2026), two-thirds of failed marketplaces die on the supply side — Mingla is in that critical window.

**Recommended cold-start tactics, in priority order:**

| Tactic | Realistic monthly acquisition rate | Cost per brand | Quality bar | Time-to-liquidity per city |
|---|---|---|---|---|
| **Operator self-sign-up via App Store + word-of-mouth** | 5-20/month early; could ramp to 100/month | $0-50 per brand | Variable — many incomplete profiles | Slow alone (12+ months per city) |
| **Concierge onboarding** (Mingla rep visits restaurant, does the 9-minute Tier 1+2 with the operator on their phone) | 5-15/week per rep | $200-500 per brand acquired | High — operator is hands-on | 2-3 months for a focused city |
| **City tourism board + small-business association partnerships** | Variable, batch acquisitions of 10-50 | $0-200 per brand | Medium-high | 3-6 months per city |
| **Synthetic seeding via Google ingestion + operator-claim-when-ready** | Already ingesting 13,671 servable; claimable on demand | $0 (Google API budget) | Medium (Google data quality) | Already done — claim flow is the bottleneck, not data |
| **Freemium incentive — first 6 months free Stripe with Mingla** | Hard to estimate; needs A/B | Subsidised Stripe fee = ~$50/brand/month | Medium | 6-12 months per city |
| **Referral with reward — operator-refers-operator** | 0.3-0.7x viral coefficient | Reward cost (e.g., $25 credit) per converted referral | High — referred operators trust | Compounds over 6-9 months |

**Recommended phasing strategy.** Do NOT phase out Google ingestion. Run hybrid permanently:
- **Phase 1 (now-3 months)**: Keep Google ingestion at full rate. Build the supply-side authoring infrastructure (Stages 3-8 from §6). Operator-self-authored places coexist with Google-sourced.
- **Phase 2 (3-9 months)**: Operator claim rate accelerates as the Tier 2 vibe-questionnaire-loop closes (operator sees their place ranking → wants to improve → finishes Tier 2). Hub becomes the operator engagement loop.
- **Phase 3 (9-18 months)**: Per-city threshold reached: in cities where ≥50% of servable places have a claimed brand, Google ingestion goes to "supplementary only" — Google fills the long tail; brand-authored places dominate the active deck.
- **Phase 4 (18+ months)**: Per-city threshold reached: ≥75% claimed → Google ingestion can be paused for that city (still re-checks `business_status` for closures, but no new ingestion).

**Never fully turn off Google.** Google remains the canonical source of "what places exist" (entity ingestion); Mingla becomes the canonical source of "what these places are FOR" (vibe + ranking).

---

## §9 — Open questions for operator (10)

1. **Verification rigour for brand claim.** Options: (a) email confirmation only; (b) Google-style postcard for verified address; (c) video upload showing inside venue (Yelp's 2026 default per [Google support](https://support.google.com/business/answer/7107242)); (d) phone verification. **Recommendation: (a) for publish, (c) for deck-eligible.** Publish is low-stakes; deck eligibility is high-stakes (anti-spam).

2. **Self-report trust for vibe questionnaire.** Options: (a) accept face-value; (b) weight 50/50 with AI-from-menu-and-photos; (c) use operator answers as one signal among three (operator + AI-from-content + future-AI-from-reviews). **Recommendation: (c) with operator bounded to ±20 override from AI baseline; surface BOTH the operator answer AND the AI's view in the operator's "Vibe" tab so the operator can see when they disagree.**

3. **Brand-curated experiences as a deck surface.** Options: (a) yes — new `cardType: 'brand_curated'`; (b) no — operator-authored experiences only appear on the brand's public page; (c) yes but only for paid brands. **Recommendation: (a) — this is the supply-side's biggest unique unlock and the strongest acquisition hook for operators.**

4. **Free vs. paid tiers for ranking.** Options: (a) free for everyone, ranking purely meritocratic; (b) paid tier boosts deck slot frequency; (c) paid tier required to author `brand_curated` experiences. **Recommendation: (a) at launch — proving merit-based ranking works builds trust; revisit paid tier after 6 months of telemetry.**

5. **Claim-flow data ownership when operator claims a Google-ingested place.** Options: (a) operator-edited values overwrite Google's, archive Google in `raw_google_data`; (b) operator-edited values stored separately, ranker prefers operator OR Google by recency; (c) operator can only edit a curated subset (hours, contact, photos, description) — never type/category/coordinates. **Recommendation: (a) with archive + admin-rollback-button for abuse.**

6. **Photo minimum for deck eligibility.** Options: (a) 1 (Google minimum); (b) 3 (Yelp minimum); (c) 5 (operator's collage needs 5 for visual richness); (d) variable based on venue category. **Recommendation: (a) for publish (Tier 1), (c) for deck eligibility (Tier 2). Carrots not sticks — show operator "add 4 more photos to be deck-eligible" rather than blocking publish.**

7. **Menu requirement for restaurants.** Options: (a) required for deck eligibility; (b) optional, AI infers menu items from venue category + price tier; (c) required but accepting Square POS link as substitute. **Recommendation: (a) — without menu, the rule scorer can't fill `serves_*` booleans accurately and `ai_signal_scores` Stage 6 is weak.** Per [Square Catalog API docs](https://developer.squareup.com/docs/catalog-api/what-it-does), Square integration is a future ORCH but not v1.

8. **The vibe questionnaire capture mode.** Options: (a) text answers; (b) multi-select chips with predefined options; (c) sliders ("how romantic? how lively? how loud?"); (d) AI conversational like Ari ("tell me about your place — I'll fill in the questionnaire"). **Recommendation: (b) for v1 — fastest to fill, cleanest structured data; (d) as Tier 2 enhancement powered by the existing Ari agent.**

9. **Operator analytics surface in Hub.** Options: (a) basic — total surfaces / swipe-rights only; (b) detailed — per-intent breakdown, per-day trend, "your rank vs. similar places"; (c) coached — analytics + "here's how to improve" suggestions. **Recommendation: (c) — analytics without improvement guidance breeds frustration; coached analytics is the supply-side retention hook.**

10. **Onboarding length ceiling.** Options: (a) 4 minutes hard cap (Tier 1 only); (b) 10 minutes (Tier 1+2); (c) progressive — Tier 1 today, "come back tomorrow for Tier 2." **Recommendation: (b) for first session if operator is engaged; (c) for operators who drop off after Tier 1 — return-and-finish flow with email/push nudges over 7 days.**

---

## §10 — Anti-patterns observed (external research)

| Anti-pattern | Where observed | How the recommended path avoids it |
|---|---|---|
| **Onboarding-form-too-long → drop-off** | 68% vendor abandonment per [marketplace research](https://forkoff.xyz/blog/founder-growth/two-sided-marketplace-cold-start-2026) | Tier 1 capped at 4 minutes; AI-derives every field that can be derived; operator confirms not authors; Tier 2 progressively disclosed |
| **Self-report inflation** ("every restaurant is great for first dates") | Universal in operator-driven platforms | Vibe questionnaire bounded by AI-from-content; operator override capped at ±20 from AI baseline; operator-vs-AI delta surfaced as a coaching signal |
| **AI-suggestion presented as fact without operator confirm** | Common failure pattern in AI-assisted forms | EVERY AI output in Stages 1-6 routes through `agent_pending_actions` for operator confirm-or-edit before persistence (this is also why ORCH-0821 invariant `I-ARI-PENDING-STATE-MACHINE` exists) |
| **Keyword-stuffing arms race** | Yelp's persistent operator-game-the-algorithm problem | Operator edits bounded; AI-from-content is the ground truth; spam patterns (impossibly-high scores across all signals) auto-flagged for admin review |
| **Verification too strict → legit owners can't claim** | Google's video-verification 2026 rollout has caused [legitimate-business complaints](https://www.jxtgroup.com/google-business-profile-verification-in-2026-new-warnings-video-requirements-how-to-stay-compliant/) | Two-tier verification: publish gate is light (email); deck-eligibility gate is heavy (video or postcard). Operator unblocked on publish immediately. |
| **Verification too lax → squatters claim others' places** | The 2 brands / 1 place chain duplicate already happening in live data | Pre-deck-eligibility verification + admin review for duplicate claims; the second claim on the same place auto-pauses both for admin resolution |
| **Operator analytics that punish without coaching** | Reddit complaints about Yelp's owner dashboard | Tie every analytic to a coaching suggestion ("your `romantic` score is 30 — add 2 evening-ambience photos to lift it") |
| **Featured listings erode trust** | Google Maps' increasing sponsored-listing density | Brand-curated cards surfaced based on intent match, not paid placement, at v1 |
| **Brand-curated multi-stops as spam vs. curation** | Atlas Obscura's UGC tension | Rate-limit operators to ≤5 published experiences; quality gate (≥3 stops, photos, narrative, real `place_pool_id`s) before deck eligibility |
| **Completion-funnel collapse** | Live data: 26 parses, 0 completions | First priority for any spec dispatch: figure out why operators don't return to confirm parsed menu items. The infrastructure works; the loop is broken. |

---

## §11 — Phase 0 evidence index

All citations are inline in the relevant sections. Index for re-verification:

**Repo files cited:** `mingla-business/src/types/brand.ts`, `mingla-business/app/venue/create.tsx`, `mingla-business/src/services/poolSearchService.ts`, `mingla-business/src/services/experiencesService.ts`, `mingla-business/src/services/experienceGenerationService.ts`, `supabase/functions/parse-restaurant-menu/index.ts`, `supabase/functions/parse-play-activities/index.ts`, `supabase/functions/claim-search-pool/index.ts`, `supabase/functions/brand-stripe-onboard/index.ts`, `supabase/migrations/20260618000001_ve2_claim_search_rpc.sql`, `supabase/migrations/20260603000001_orch_0821_ari_agent_tables.sql`, `supabase/migrations/20260613000000_ve1_physical_venue_brand_onboarding.sql`.

**Artifact files cited:** `Mingla_Artifacts/specs/SPEC_META-ORCH-0972_BRAND_KIND_DECOMMISSION.md`, `Mingla_Artifacts/specs/SPEC_ORCH-0881_VE5_MENU_AI_PARSER.md`, `Mingla_Artifacts/INVARIANT_REGISTRY.md` (I-BRAND-UNIVERSAL-AUTHORING, I-VENUE-CLAIM-OPTIONAL, I-PUBLIC-PAGE-DATA-DRIVEN-TABS, I-HUB-TABS-DATA-DRIVEN, I-PROPOSED-BRAND-FIELD-MAP-COVERAGE, I-ARI-USER-DATA-WRAP, I-ARI-PENDING-STATE-MACHINE), `Mingla_Artifacts/DECISION_LOG.md` DEC-180, `Mingla_Artifacts/WORLD_MAP.md` (Ve1-Ve6 timeline, ORCH-0883/0966/0967/0968/0969 entries), `Mingla_Artifacts/research/RESEARCH_EXPERIENCE_PIPELINE_TO_CONSUMER_DECK.md` (demand-side companion).

**Memory rules cited:** [[brand-kind-decommissioned]], [[ai-categories-decommissioned]], [[external-api-docs-verified]], [[stripe-skill-mandatory]], [[orchestrator-deploys-edge-functions]], [[rls-returning-owner-gap]].

**Live DB probes (2026-05-26):** `brands` column list (43 columns), brand counts (38 total, 20 active, 19 Stripe-connected, 2 place-linked, 1 distinct place claimed), event counts (121 total, 0 experiences), `agent_pending_actions` counts (32 total, 26 hub-experience parses, 0 completed), `place_pool.is_claimed=0` + `claimed_by IS NOT NULL=0` (dead schema columns).

**External URLs cited:**
- Google Business: https://support.google.com/business/answer/7107242 ; https://www.jxtgroup.com/google-business-profile-verification-in-2026-new-warnings-video-requirements-how-to-stay-compliant/
- Marketplace cold-start: https://forkoff.xyz/blog/founder-growth/two-sided-marketplace-cold-start-2026 ; https://www.sharetribe.com/academy/onboard-initial-marketplace-supply/
- Schema.org Restaurant/Menu: https://schema.org/Restaurant ; https://schema.org/Menu ; https://schema.org/MenuItem ; https://richmenu.io/restaurant-schema-markup/
- Square Catalog API: https://developer.squareup.com/docs/catalog-api/what-it-does ; https://www.nerdwallet.com/business/software/reviews/square-for-restaurants
- Claude vision + pricing: https://platform.claude.com/docs/en/build-with-claude/vision ; https://platform.claude.com/docs/en/about-claude/pricing ; https://www.developersdigest.tech/blog/claude-vision-api-production-guide
- Gemini pricing: https://ai.google.dev/pricing/gemini-2-5-flash
- Yelp claim flow: https://business.yelp.com/resources/articles/ultimate-guide-to-claiming-your-yelp-page/
- Atlas Obscura on Apple Maps: https://maps.apple.com/guides?publisher=16848065406089037853
- OpenTable: https://support.opentable.com/s/?language=en_US

---

## Confidence note

- **Codebase claims:** `proven` for the business-app services + parse functions read (Explore agent + my own targeted file reads of `experiencesService`, `experienceGenerationService`, `parse-restaurant-menu`, `parse-play-activities`, `claim-search-pool`); `probable` for `brand.ts` type details (Explore-agent-derived, spot-verified key fields).
- **DB data claims:** `proven` — all counts came from live `mcp__supabase__execute_sql` against production. The 26/0 completion funnel finding and the 2/1 chain-duplicate finding are direct queries.
- **Prior artifact claims:** `probable` — relied on Explore agent's deep-read of specs + artifact files; spot-verified key invariants and DEC-180 by name.
- **External research claims:** `probable` — pricing and quotas as of 2026-05-26, may shift; cited URLs verified at retrieval time.
- **Cost estimates:** `probable` for per-stage AI cost (well-grounded in published Gemini and Anthropic pricing); `suspected` for end-to-end ongoing costs and acquisition rates (depends on operator decisions in §9 Q1/Q4/Q10).
- **Completion-funnel-collapse finding (26 attempts, 0 completions):** `proven` from live DB; root cause `inconclusive` — could be parse-quality, confirmation UX, or operators not knowing they need to return. **First investigation priority for any future SPEC dispatch.**

No `proven` claim is contradicted by a `probable` or `suspected` claim. Where uncertainty matters for decision-making, it's called out inline.
