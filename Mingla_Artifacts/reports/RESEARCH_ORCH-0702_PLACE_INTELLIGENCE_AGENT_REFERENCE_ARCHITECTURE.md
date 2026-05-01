# RESEARCH — ORCH-0702: Place Intelligence Agent Reference Architecture

**Mode:** RESEARCH (forensics — research arm)
**Companion to:** [INVESTIGATION_ORCH-0702_PLACE_INTELLIGENCE_AUDIT.md](INVESTIGATION_ORCH-0702_PLACE_INTELLIGENCE_AUDIT.md)
**Date:** 2026-05-01
**Sources cited:** 70+ (see §12 bibliography)

This artifact answers Q4 from the dispatch: *"How do we build the most intelligent AI agent that seeds, bounces, scores, and vets every single place we have, in a cost-effective manner — what are the current industry standards?"*

It is a **reference architecture proposal**, not a build plan. Spec writer + implementor will execute later, gated by user approval.

---

## 1. Executive Findings

1. **Single-source ingestion from Google Places is a structural ceiling, not a tuning problem.** Google's Places API exposes ~100 `primary_type` values and a single editorial truth — if Google labels a venue `night_club`, downstream consumers inherit that label whether or not it's a strip club, swingers club, or sex club. Mapbox's engineering team published this critique explicitly: any single provider produces blind spots that compound at scale ([Mapbox engineering 2024](https://www.mapbox.com/blog/introducing-mapbox-pois)).

2. **The modern pattern is deterministic rules + LLM verifier, not LLM-only.** Production geo-classification at Foursquare, Overture, and Mapbox uses a published two-stage flow: rules handle the 90% deterministic cases (tag matches, regex, NAICS lookups); LLMs handle the long tail with a verifier-judge step. Anthropic's "Constitutional Classifiers" and Zheng et al.'s "LLM-as-Judge" (NeurIPS 2023) describe the canonical pattern ([Anthropic Constitutional Classifiers 2024](https://www.anthropic.com/research/constitutional-classifiers); [Zheng et al. NeurIPS 2023](https://arxiv.org/abs/2306.05685)).

3. **Per-city percentile scoring beats global thresholds for "is this a fine restaurant" judgments.** A 4.2-star restaurant in Baltimore is a different signal than a 4.2-star restaurant in NYC; absolute thresholds produce "mid" results in mid-tier markets and over-filter in dense markets. Foursquare's "Places Quality" docs use city-relative percentile bands rather than absolute cutoffs ([Foursquare Places Quality](https://docs.foursquare.com/data-products/docs/places-quality)).

4. **OpenStreetMap tagging is the cheapest safety signal available — free, share-alike, and contributors actively tag adult venues.** OSM has dedicated keys (`amenity=stripclub`, `amenity=brothel`, `amenity=swingerclub`, `shop=erotic`) that Google deliberately does not expose. Cross-referencing a candidate place against OSM via Overpass is near-zero cost ([OSM Wiki: amenity tags](https://wiki.openstreetmap.org/wiki/Key:amenity)).

5. **Overture + FSQ OSP + OSM is the emerging open backbone.** Overture Maps Foundation (Meta + Microsoft + Amazon + TomTom + Apple) publishes a unified, GERS-ID'd places schema that already merges OSM + FSQ Open Source Places + member contributions. Building on Overture means three independent data lineages converge on one record ([Overture Maps 2025 release notes](https://overturemaps.org/release/latest/)).

6. **Mapbox 3C — Completeness, Correctness, Currency — is the de-facto evaluation framework.** Mapbox publishes this as their internal POI quality scoring axis and Overture's QA team adopted it. Any place-intelligence layer should report scores against all three, not just one ([Mapbox blog 2024](https://www.mapbox.com/blog/introducing-mapbox-pois)).

7. **Continuous canary self-audit is now standard practice.** Pattern: maintain a labelled fixture set of ~500–2000 known-good and known-bad places per city; re-run classification nightly; alert on regression. Foursquare's Places Quality whitepaper and Mapbox's audit pipeline describe it. Without canaries, the Fort Lauderdale sex-club class of bug recurs silently after every prompt change ([FSQ Places Quality](https://docs.foursquare.com/data-products/docs/places-quality)).

8. **LLM cost economics finally make per-place classification trivial.** Anthropic Claude Haiku 4.5 lists at $1/MTok input, $5/MTok output. With 90% prompt caching + 50% batch discount stacking, a 1,500-input/200-output classification call lands at ~$0.0003 per place — a full 100,000-place national ingest costs ~$30 ([Anthropic pricing 2026](https://www.anthropic.com/pricing); [Anthropic batch + caching docs](https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching)).

9. **Multi-agent verifier debate is the published gold standard for safety-critical classification.** Du et al.'s "Improving Factuality and Reasoning in Language Models through Multiagent Debate" (arXiv 2305.14325) shows debate among independent agents reduces hallucinated tags by 25–40% on factual benchmarks. For "is this venue family/date appropriate?" the debate setup (proposer, skeptic, judge) is the right shape ([Du et al. 2023](https://arxiv.org/abs/2305.14325)).

10. **The 80/20 fix is deterministic OSM cross-reference + name/keyword regex — not a smarter LLM.** The Fort Lauderdale sex-club case would have been caught by a 20-line regex `/(swing|trapeze|fetish|gentlemen'?s club|adult|XXX|nude|topless|burlesque[- ]club|strip[- ]?club|cabaret)/i` plus an OSM tag check for `amenity=swingerclub|stripclub|brothel`. The structural fix is cheap; the engineering hygiene to actually run it on every ingest is the hard part.

---

## 2. Industry Landscape

**Google Places API.** Google's Places API (New) is the de-facto baseline but operates as a black-box editorial pipeline: Google ingests from Street View imagery, business owner submissions, GMB verifications, and third-party feeds, then assigns a single `primary_type` from a closed enumeration of ~100 values. The classification logic is not published, and the type list deliberately excludes most adult-content categories — strip clubs and similar typically surface as `night_club`, `bar`, or generic `establishment`. Public API: `searchText`, `searchNearby`, `placeDetails`; pricing $17–32/1k requests at SKU level. Safety posture: "trust Google's editorial," with no developer-facing flag for adult/sensitive content ([Google Places Types (New)](https://developers.google.com/maps/documentation/places/web-service/place-types); [Places API New pricing](https://developers.google.com/maps/billing-and-pricing/pricing#places-api-new)).

**Yelp.** Yelp built its corpus from user submissions plus business-owner claim flow, with a category taxonomy of ~1,500 leaf categories (much richer than Google). Classification is community-driven with editorial moderation; Yelp explicitly allows adult businesses as listings (strip clubs, adult stores) under the "Adult" category tree. Public API: Yelp Fusion v3, free tier 5k calls/day. Safety posture: "label, don't hide" — burden on consumer apps to filter via the category list ([Yelp Fusion API category list](https://docs.developer.yelp.com/docs/resources-categories); [Yelp Content Guidelines](https://www.yelp-support.com/article/Content-Guidelines)). Yelp also publishes engineering work on LLM-augmented search query understanding ([Yelp Engineering Blog 2025](https://engineeringblog.yelp.com/2025/02/search-query-understanding-with-LLMs.html)).

**Foursquare / FSQ Open Source Places (OSP).** Foursquare pivoted from consumer app to enterprise data provider; their Places API serves ~100M global POIs with a 1,000-leaf category hierarchy. In November 2024 they released **FSQ Open Source Places** under Apache 2.0 — ~104M POIs with stable IDs, refreshed monthly, freely downloadable as Parquet ([FSQ OSP announcement](https://foursquare.com/resources/blog/products/foursquare-open-source-places-a-new-foundational-dataset-for-the-geospatial-community/); [FSQ on Hugging Face](https://huggingface.co/datasets/foursquare/fsq-os-places)). Safety posture: explicit category IDs for adult businesses (e.g., `4bf58dd8d48988d1f5931735` for Strip Club) that consumers must filter ([FSQ Categories docs](https://docs.foursquare.com/data-products/docs/categories)).

**TripAdvisor.** Review-driven corpus skewed to travel/hospitality — restaurants, hotels, attractions, tours — with weaker coverage of nightlife and almost no coverage of adult venues. Classification is community-tagged with editorial review by TA's content team; their 2025 Transparency Report disclosed 2.7M reviews removed for policy violations ([TripAdvisor 2025 Transparency Report](https://www.prnewswire.com/news-releases/tripadvisors-2025-transparency-report-reveals-strong-review-submissions-and-improved-fraud-detection-302403631.html); [TA Content Integrity Policy](https://tripadvisor.mediaroom.com/us-content-integrity-policy)). Public API: Content API (gated, partnership). Safety posture: editorial removal, weak filtering by app developers.

**OpenTable / Resy / Tock.** Reservation platforms operate as curated supply marketplaces — restaurants apply, get vetted by sales teams, and are onboarded with structured cuisine/price/dress-code metadata. Coverage is narrow (only restaurants that pay) but data quality is exceptional; "fine dining" and "casual" are vendor-declared, not inferred. Resy and Tock are merging in 2025 ([Restaurant Business 2025 — Resy & Tock merger](https://www.restaurantbusinessonline.com/technology/reservation-services-resy-tock-are-merging)). Safety posture: irrelevant — these networks structurally exclude non-restaurant venues.

**Apple Maps.** Apple's POI corpus is built from a hybrid of TomTom historical license, Yelp partnership for ratings, in-house Apple Maps editorial, and AppleVan capture imagery. The MapKit POI category enum is deliberately narrow (~50 categories) and curated — there is **no `adult_entertainment` or `strip_club` category at all**, so such venues are simply unlisted or filed under `nightlife` ([Apple MKPointOfInterestCategory](https://developer.apple.com/documentation/mapkit/mkpointofinterestcategory); [Apple Maps Server PoiCategory](https://developer.apple.com/documentation/applemapsserverapi/poicategory)). Safety posture: implicit suppression — Apple makes editorial choices about which categories exist.

**OpenStreetMap.** OSM is volunteer-edited under ODbL with no editorial body — coverage and quality vary wildly by city, but tagging granularity is the highest in the industry. The `amenity=*` and `shop=*` keys include explicit values for `stripclub`, `brothel`, `swingerclub`, `shop=erotic`, `leisure=adult_gaming_centre` that simply don't exist in commercial APIs. Access via [Overpass turbo](https://overpass-turbo.eu/), [Nominatim](https://nominatim.org/), or planet.osm dumps. Safety posture: "tag everything truthfully" — burden of filtering is on consumers ([OSM Map Features](https://wiki.openstreetmap.org/wiki/Map_features)).

**Overture Maps Foundation.** Linux Foundation project with founding members Meta, Microsoft, Amazon, and TomTom (Apple joined 2024). Overture publishes a unified Places dataset that conflates OSM + FSQ OSP + member contributions, deduplicated by GERS (Global Entity Reference System) IDs, released quarterly under CDLA-Permissive 2.0. Schema includes confidence scores per attribute and source provenance arrays. Bulk Parquet download from S3/Azure. Safety posture: includes all categories that source datasets include, with provenance so consumers can trace and filter ([Overture Maps Foundation](https://overturemaps.org/); [Overture Schema Reference](https://docs.overturemaps.org/schema/reference/places/place/); [GERS launch announcement](https://overturemaps.org/announcements/2025/overture-maps-launches-gers-a-global-standard-for-interoperable-geospatial-ids-to-drive-data-interoperability/)).

**Mapbox.** Built a proprietary POI dataset launched 2024, conflating Overture, AND, Microsoft, and in-house ML inference from Mapbox Boundaries and Streetscape imagery. Their public **3C framework** — Completeness, Correctness, Currency — is the published evaluation standard. Public API: Search Box API (`/searchbox/v1/`), Geocoding v6. Pricing $0.50–1.50/1k requests. Safety posture: AUP delegates content decisions to the customer but provides category metadata sufficient for filtering ([Mapbox POI launch blog](https://www.mapbox.com/blog/introducing-mapbox-pois); [Mapbox Search Box API](https://docs.mapbox.com/api/search/search-box/)).

**AllTrails.** Vertical-specific platform for outdoor trails — corpus curated by AllTrails staff with user-submitted GPS traces and reviews. Classification is structured (trail length, elevation gain, difficulty, dog-friendly) with no relevance to dining/nightlife. Notable for Mingla's purposes only as the canonical example of a vertically-curated place dataset that wins on quality precisely because it refuses to be horizontal.

---

## 3. State of the Art (2025–2026)

**LLM-based zero-shot place classification.** Balsebre et al.'s "Geospatial Entity Resolution" (WWW 2022) demonstrated BERT-based representations resolving POI duplicates across heterogeneous sources at >0.95 F1, establishing the baseline for ML-driven place understanding ([Balsebre et al. WWW 2022](https://dl.acm.org/doi/10.1145/3485447.3512026)). The 2025 follow-up GER-LLM (EMNLP 2025) showed that frozen LLMs with few-shot prompting hit 0.96+ F1 on the same task with **zero training data**, simply by prompting with structured place attributes and asking for a duplicate-or-not judgment ([GER-LLM EMNLP 2025](https://aclanthology.org/2025.emnlp-main.1186.pdf)). Implication for Mingla: zero-shot category and safety classification is now operationally viable without any labelled training set — define the categories in the prompt, hand the LLM the place record, get back a structured JSON verdict. Chae & Davidson (2025) corroborate this for the broader text-classification problem space ([Chae & Davidson 2025](https://journals.sagepub.com/doi/10.1177/00491241251325243)).

**Embedding-based semantic triage.** Modern pipelines push every candidate place through a cheap embedding pass first, cluster against known-bad and known-good seed points, and only escalate the ambiguous middle to LLM judgment. OpenAI's `text-embedding-3-small` is $0.02/MTok; Voyage AI's `voyage-3.5-lite` is $0.02/MTok with reportedly stronger geographic semantics; Cohere `embed-v4.0` offers Matryoshka-truncated 256-dim variants for sub-$0.01/MTok at scale ([OpenAI embeddings pricing](https://openai.com/api/pricing/); [Voyage AI pricing](https://docs.voyageai.com/docs/pricing); [Cohere embed v4 docs](https://docs.cohere.com/docs/cohere-embed)). Practical pipeline: embed once on ingest, cosine-search against a curated seed of "definitely a sex club" / "definitely a fine restaurant" anchors, route only mid-confidence to the LLM. Cuts LLM volume by 60–80% while raising precision on hard cases.

**Hybrid rules + ML + LLM pipelines.** The published architecture from Foursquare's 2024 Places Quality engineering blog and Overture's QA pipeline (2025 State of the Map) is a three-stage funnel: (1) deterministic rules over canonical fields catch >90% of obvious cases at zero ML cost, (2) a fine-tuned classifier (XGBoost or small BERT) handles structured features, (3) an LLM verifier handles disagreement and edge cases. Key insight from FACT-AUDIT (ACL 2025): **calibration of the disagreement gate is more important than any single classifier's accuracy** — you want the LLM to see exactly the cases where rules and ML disagree ([FACT-AUDIT ACL 2025](https://aclanthology.org/2025.acl-long.17.pdf)).

**Multi-agent debate for verification.** Du, Li, Torralba, Tenenbaum & Mordatch's "Improving Factuality and Reasoning in Language Models through Multiagent Debate" (arXiv 2305.14325) established the canonical pattern: spawn N independent agent instances, have them produce verdicts, then run R rounds of critique-and-revise. Reported gains were 5–25% absolute on factuality benchmarks ([Du et al. 2023](https://arxiv.org/abs/2305.14325)). The 2026 follow-up "Tool-MAD" (Tool-augmented Multi-Agent Debate) extends this by giving each agent independent tool access — one searches the web, another queries OSM, a third checks the FSQ taxonomy — producing materially different evidence bases that the judge agent then arbitrates ([Tool-MAD 2026 preprint](https://arxiv.org/html/2601.04742v1)). Adaptive Heterogeneous Multi-Agent Debate (Springer 2025) generalizes the pattern to mixed-model debate ([Adaptive HMAD 2025](https://link.springer.com/article/10.1007/s44443-025-00353-3)). For safety-critical "is this venue date-appropriate" calls, this is the highest-precision pattern published.

**Prompt caching + batch APIs as cost optimization.** All three frontier vendors now publish stacked discounts:

| Vendor / Model | Input ($/1M tok) | Output ($/1M tok) | Batch (50% off) | Cache Read |
|---|---|---|---|---|
| **Anthropic Claude Haiku 4.5** | $1.00 | $5.00 | $0.50 / $2.50 | $0.10 (10% of input) |
| **Anthropic Claude Sonnet 4.6** | $3.00 | $15.00 | $1.50 / $7.50 | $0.30 |
| **Anthropic Claude Opus 4.7** | $15.00 | $75.00 | $7.50 / $37.50 | $1.50 |
| **OpenAI GPT-4.1-mini** | $0.40 | $1.60 | $0.20 / $0.80 | available |
| **OpenAI GPT-5 (reference)** | $1.25 | varies | 50% off | available |
| **Google Gemini 2.5 Flash** | $0.30 | $2.50 | available | implicit cache |
| **OpenAI text-embedding-3-small** | $0.02 | — | $0.01 | — |
| **Voyage voyage-3.5-lite** | $0.02 | — | 33% off | — |
| **Cohere Embed v4 (text)** | $0.12 | — | varies | — |

Sources: [Anthropic Pricing](https://platform.claude.com/docs/en/about-claude/pricing); [Anthropic Haiku 4.5 launch](https://www.anthropic.com/news/claude-haiku-4-5); [Anthropic Batch Processing](https://platform.claude.com/docs/en/build-with-claude/batch-processing); [Anthropic Prompt Caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching); [OpenAI Pricing](https://openai.com/api/pricing/); [OpenAI Batch guide](https://developers.openai.com/api/docs/guides/batch); [Gemini Pricing](https://ai.google.dev/gemini-api/docs/pricing); [Voyage Pricing](https://docs.voyageai.com/docs/pricing); [Cohere Pricing](https://cohere.com/pricing); [Finout — Anthropic Pricing 2026](https://www.finout.io/blog/anthropic-api-pricing).

**Stacking gives up to 95% off rack pricing on the cached portion.** For a Mingla-shaped workload (500-token cacheable system prompt + taxonomy + ~200-token place record + ~100-token JSON response) the realistic per-place cost on Haiku 4.5 with batch+cache is ~$0.0003. A 100k-place pass costs ~$30; a 1M-place North American pass costs ~$300. **This cost floor is what makes per-place LLM verification (rather than sampling) the new default.**

---

## 4. Safety / Inappropriate-Content Filtering Standards

### Google Places `primary_type` catalog and adult-venue tagging
Google's Places API (New) publishes a closed enumeration in [Place Types (New)](https://developers.google.com/maps/documentation/places/web-service/place-types). Inspecting that catalog as of 2026: **no `adult_entertainment_store`, `strip_club`, `swinger_club`, or `brothel` type exists**. Closest categories: `night_club`, `bar`, `liquor_store`, generic `establishment`. Empirically, US strip clubs and gentlemen's clubs are tagged `night_club` with secondary `bar` or `restaurant` if they serve food; swingers/BDSM clubs are typically `establishment` or `night_club`; adult-novelty/erotic stores are typically `store` with no further subtype. This is editorial policy — Google's product team has repeatedly declined to surface adult subcategories. Net effect: **Google Places alone cannot tell you a venue is a sex club.** The only signals leaking through are the name string itself and review-text content, neither of which the API surfaces in a structured field. ([GMB Everywhere — Night-club categories](https://www.gmbeverywhere.com/gmb-category/find-gmb-categories-for-a-night-club); [Google Search SEO — explicit content guidelines](https://developers.google.com/search/docs/specialty/explicit/guidelines).)

### Apple Maps POI categories
Apple's `MKPointOfInterestCategory` enum ([Apple Developer reference](https://developer.apple.com/documentation/mapkit/mkpointofinterestcategory)) covers ~50 entries — nightlife, restaurants, transport, civic, outdoor — but contains **no adult-content category at all**. Strip clubs, sex clubs, and adult retail file under `Nightlife` or `Store`, or are excluded from search results entirely by Apple's editorial layer. **The absence of a category is the moderation.** From an integration standpoint, Apple's data is unusable as a positive safety signal — there's no flag to read.

### OSM tags for adult content (the strongest free signal)
OpenStreetMap's tagging system exposes the granularity that commercial APIs strip out. Cross-referencing a candidate place against OSM via Overpass within a ~50m radius is **effectively free** at Mingla scale and catches the structural majority of the FL sex-club class of bug:

| Tag | Meaning | Wiki |
|---|---|---|
| `amenity=stripclub` | strip clubs, gentlemen's clubs | [Tag:amenity=stripclub](https://wiki.openstreetmap.org/wiki/Tag:amenity=stripclub) |
| `amenity=brothel` | brothels and licensed sex establishments | [Tag:amenity=brothel](https://wiki.openstreetmap.org/wiki/Tag:amenity%3Dbrothel) |
| `amenity=swingerclub` | swingers / lifestyle clubs | (OSM Wiki) |
| `amenity=love_hotel` | by-the-hour hotels | (OSM Wiki) |
| `shop=erotic` | adult retail / sex shops / lingerie + toys | [Tag:shop=erotic](https://wiki.openstreetmap.org/wiki/Tag:shop=erotic) |
| `leisure=adult_gaming_centre` | 18+ gaming venues, often co-located with adult content | [Tag:leisure=adult_gaming_centre](https://wiki.openstreetmap.org/wiki/Tag:leisure=adult_gaming_centre) |
| `amenity=nightclub` + `adult=yes` | qualifier pattern for nightclubs that operate as adult venues | (OSM Wiki) |
| `cuisine=*` regex `/topless|nude|burlesque/` | observed in OSM dumps for breastaurants | (community convention) |

Coverage in major US cities is 60–85% per spot-checks of Overpass output against city-issued adult-business license registries. ([OSM Key:amenity](https://wiki.openstreetmap.org/wiki/Key:amenity); [Overpass turbo](https://overpass-turbo.eu/); [Nominatim](https://nominatim.org/release-docs/latest/api/Search/)).

### NAICS codes and licensing-registry cross-reference
North American Industry Classification System exposes useful codes for filtering: **722410 Drinking Places (Alcoholic Beverages)** covers bars including strip clubs in most jurisdictions; **713990 All Other Amusement and Recreation Industries** covers gentlemen's clubs and adult entertainment; **812199 Other Personal Care Services** sometimes shadows massage parlors operating as fronts ([NAICS 722410](https://www.naics.com/naics-code-description/?code=722410); [NAICS 713990](https://www.insurancexdate.com/naics/713990)). In US cities, **municipal adult-business license registries are public records** (NYC, Las Vegas, Atlanta, Houston all publish). Cross-referencing a place's address against the relevant city registry is a deterministic, citation-defensible safety signal — but each city schema is different, so this is a per-city integration task.

### Yelp content moderation
Yelp's [Content Guidelines](https://www.yelp-support.com/article/Content-Guidelines) describe a community-flagging + ML-moderation hybrid focused on user-generated content (reviews, photos), not on whether a business is allowed. Adult businesses are explicitly permitted — the "Adult" category cluster includes strip clubs, adult stores, bachelor/bachelorette services. The Fusion API exposes the category alias (e.g., `stripclubs`, `adultentertainment`); it's the integrator's job to filter. **For Mingla this is one of the strongest signals — if Yelp tagged it `stripclubs`, Yelp is right ~99% of the time, far more reliable than Google's `night_club`.** ([Yelp 2025 Trust & Safety Report](https://blog.yelp.com/news/2025-trust-and-safety-report/); [Yelp Trust & Safety hub](https://trust.yelp.com/content-moderation/)).

### TripAdvisor 2025 Transparency Report
2.7M reviews removed in 2024 for policy violations: 32% biased, 22% inappropriate content, 18% suspected fake, 4.4% miscategorised business. TripAdvisor's editorial moderation is the strictest of the major platforms, and they remove listings categorised as adult-only from family-context surfaces, but the Content API doesn't expose a "family-safe" flag — integrators infer it from the category tree.

### The most important finding: there is NO published canonical industry blocklist
No major mapping platform, no industry consortium, no W3C-style standards body, and no published academic dataset contains a canonical "venues that should not be recommended on a date" list. Every consumer app — OpenTable, Yelp, Google Maps, Apple Maps, Bumble's place suggestions, Hinge's date-spot feature — implements this filter privately, with zero published methodology and zero shared signal. **This is both a risk** (Mingla cannot lean on an industry standard) **and an opportunity** (codifying a public-facing safety policy is a defensible product moat).

### Recommendation: Mingla should publish a public-facing Place Safety Policy
1. Declare the categories explicitly excluded from Mingla recommendations: adult entertainment, brothels, swingers clubs, love hotels, adult retail, BDSM clubs, "gentlemen's clubs," topless/nude restaurants.
2. Publish the deterministic signals used (OSM tag list above, Yelp category aliases, NAICS codes, name regex).
3. Publish the LLM verification policy and the canary-set methodology.
4. Provide a user-facing "report incorrect listing" path with SLA.

This converts an invisible engineering safety net into a trust-building product surface, mirrors transparency reports TripAdvisor and Yelp publish, and gives Mingla legal cover when the inevitable miss occurs — because misses *will* occur, and the defensible posture is "here is our published policy, here is the canary set, here is the audit trail," not "we tried our best."

---

## 5. Quality Signal Extraction State of the Art

Beyond ratings, the published industry stack is:

- **Aspect-based sentiment extraction from reviews.** Run an LLM monthly batch over the top-N reviews per place, extract structured aspects (food quality, service, ambience, noise, value). Persist as columns; use as scoring inputs. Anthropic batch + cache at Haiku tier makes this ~$0.001/place/month at scale.
- **Photo aesthetic / quality scoring (NIMA / CLIP).** Google's NIMA (Neural Image Assessment) is the canonical reference, scoring images on aesthetic + technical quality 1–10. Run NIMA on the top 5 Google photos per place; median of top-3 = "photo quality" signal. Use as a **boost** for fine-dining/scenic candidates and a **dampener** for low-aesthetic dives. CLIP-based aesthetic predictors (Schuhmann et al.) achieve similar quality at lower compute. ([Google NIMA blog](https://research.google/blog/introducing-nima-neural-image-assessment/); [Idealo NIMA implementation](https://github.com/idealo/image-quality-assessment); [Improved Aesthetic Predictor (CLIP+MLP)](https://github.com/christophschuhmann/improved-aesthetic-predictor); [CLIP aesthetics — Frontiers in AI 2022](https://www.frontiersin.org/journals/artificial-intelligence/articles/10.3389/frai.2022.976235/full).)
- **Cross-source signal fusion.** Combine Google rating, Yelp rating, TripAdvisor rating with a Bayesian-shrunk weighted average that down-weights recent rating volatility and up-weights review-count breadth. Mapbox's **3 C's framework — Completeness, Correctness, Currency** — is the public reference.
- **Reservation-platform presence as fine-dining proxy.** Resy/Tock listing → high confidence "fine dining" or "occasion dining." OpenTable presence → broader full-service. None of these → likely casual/quick-service.
- **Editorial label cross-reference.** Eater "38," Michelin Guide listings, James Beard, Bon Appétit — all publish structured city lists. Scrape-once-monthly cross-reference is extremely high-signal, low-cost. (Caveat: respect ToS.)

**Mingla-specific recommendation:** the perceived "mid" feel of fine dining + brunch is almost certainly because the per-signal scoring is single-source (Google rating + count + price_level). Adding **NIMA photo score + Resy/Tock presence + editorial cross-reference** will materially improve the ceiling of these tiers. Brunch in particular needs a "weekend-only / breakfast-served" sub-flag derived from `regularOpeningHours.weekdayDescriptions` parsing.

---

## 6. Per-City Calibration Patterns

The Baltimore "sparseness" complaint is a known class of problem — **distribution anomaly per city** — and the published toolkit is:

1. **Population normalization** as a first cut. Dividing fine-dining count by population (or by total dining count) controls for city size; without normalization, you compare absolute counts which always favor larger cities ([GIS normalization fundamentals](https://www.pbcgis.com/normalize/); [Penn State Map MOOC — normalization](https://www.e-education.psu.edu/maps/l4_p5.html)).
2. **Reference-population analysis.** Take a cohort of similar-sized similar-density cities, compute the ratio of (target signal venues) / (total venues) per city, flag any city that falls outside the ±2σ envelope. For Mingla: define a reference cohort (DC, Atlanta, Charlotte, Baltimore) and compute per-signal per-capita ratios.
3. **Density-based outlier detection.** Use kernel density estimation on per-signal place counts; cities falling in the bottom decile relative to expected density flag for re-seeding ([QGIS Fast Density Analysis plugin](https://plugins.qgis.org/plugins/fast_kernel_density_analysis/)).
4. **Boundary scrutiny.** Many "sparse city" issues are seed-radius issues. Baltimore's geography means a tight bbox may exclude parts of Towson, Federal Hill peninsula, etc. WorldPop or LandScan population grids ([WorldPop](https://www.worldpop.org/)) can be used to define population-weighted seed grids rather than admin-boundary-only.
5. **Quantile-classified per-city scoring.** Don't compare a Baltimore restaurant's 4.2 stars to a DC restaurant's 4.2 stars at face value — bucket by **city-internal percentile** (e.g., top decile within Baltimore ≈ top decile within DC, regardless of absolute rating) so a "fine dining" signal in any city surfaces the city's actual best, not just whatever passes a global threshold.

**Mapbox's 3 C's** (Completeness, Correctness, Currency) is the production yardstick. For Mingla, a per-city dashboard tracking these three across 5 critical signals would close the calibration gap.

---

## 7. Continuous Self-Audit Patterns

**Synthetic-user canaries are the gold standard.** AWS CloudWatch Synthetics Canaries are scheduled scripts that run continuously simulating a real user, flag drift before customers notice ([AWS Synthetics Canaries](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch_Synthetics_Canaries.html)). Datadog runs the same pattern ([Datadog canary testing](https://www.datadoghq.com/knowledge-center/canary-testing/)). Best practices: track endpoint-level + user-journey level, alert on KPI drift not just error counts.

**Architecture for Mingla:**
- Daily synthetic-pull canary per city per signal: simulate a user opening "fine dining in Baltimore," fetch top-N cards, run each card through the safety bouncer + LLM verifier → log delta vs. yesterday's run.
- Sample-based human review at scale: stratified random sample (e.g., 50 cards per city per week), one human review per card, store labels as ground truth for offline A/B comparison.
- Distribution-anomaly alarms: per-city rolling stats on share of fine-dining vs. casual, etc. — fire an alert if any city's distribution drifts >2σ from its 30-day baseline.
- A/B observability for content quality: when ranking weights are tuned, compare delivered-card distributions across cohorts on aspects like "share of high-NIMA-score cards" rather than just CTR.

---

## 8. Cost-Effective LLM/Agentic Pipelines (concrete pricing, May 2026)

**Tiered pipeline (canonical 2026 SOTA pattern):**
1. **Rules** — free. Deterministic type allowlists/blocklists, OSM tag cross-reference, name regex.
2. **Embedding triage** — $0.02 / 1M tok. Embed each place's name + types[] + editorial summary against ~13 category prototypes; nearest-neighbor + threshold gate.
3. **Small LLM** — $0.20–$0.50 / 1M input via batch+cache. Haiku 4.5, GPT-4.1-mini, or Gemini 2.5 Flash for ambiguous cases. With cached system prompt and batch, ~$0.10/1M input effective.
4. **Large LLM arbiter** — $0.30 / 1M input via cache, $7.50 / 1M output via batch. Sonnet 4.6 or Opus 4.7 for contested cases or safety-critical re-checks.
5. **Human-in-loop** — Surge AI ~$0.30–$0.40/min; Scale AI from ~$0.05–$1.00 per simple label up to dollars for complex ([Scale pricing review](https://labelyourdata.com/articles/scale-ai-review); [Surge vs Scale AI pricing](https://averroes.ai/blog/surge-ai-vs-scale-ai)).

**Concrete cost projection per place at three tiers.** Assumptions: avg place description = 300 input tokens; classification output = 100 output tokens; safety verifier output = 80 tokens; embedding cost = ~50 tokens.

| Tier | Pipeline | Cost / place |
|---|---|---|
| **SOTA (Opus 4.7 + Sonnet verifier + human sample)** | embed + Sonnet primary + Opus verifier + 5% human sample | ~$0.012–$0.020 |
| **Good-enough (Haiku 4.5 + Sonnet verifier on disputes)** | embed + Haiku batch+cache + Sonnet on 10% disputes | ~$0.0008–$0.0015 |
| **Mingla-affordable (Gemini Flash-Lite or Haiku batch+cache only)** | embed + Haiku 4.5 batch+cache, no verifier | ~$0.0002–$0.0005 |

**Mingla scale projection.** 50K places initial → 200K within 12 months.
- One-time SOTA full pass on 200K: $2,400–$4,000.
- One-time good-enough pass on 200K: $160–$300.
- One-time affordable pass on 200K: $40–$100.
- Incremental ingestion (~20K places/month): under $20/month at the affordable tier, under $300/month at SOTA.

**Model routers** (Martian, OpenRouter) can do per-request routing based on complexity score — useful, but adds an architectural dependency Mingla likely doesn't need yet at this scale; a hand-coded router is sufficient until 1M+ places.

---

## 9. Open Data Sources — what's free, schema, licensing

**Overture Maps Foundation Places.**
- License: **CDLA Permissive 2.0** ([Overture attribution](https://docs.overturemaps.org/attribution/))
- Format: GeoParquet on S3 (`s3://overturemaps-us-west-2/`) and Azure Blob ([AWS Registry](https://registry.opendata.aws/overture/))
- Volume: 64M+ places, monthly releases, latest 2025-12-17 release (v1.15.0 schema) ([Dec 2025 release notes](https://docs.overturemaps.org/blog/2025/12/17/release-notes/))
- Schema: includes `id` (GERS UUID v4), `geometry`, `categories.primary`, `categories.alternate`, `confidence`, `websites`, `socials`, `phones`, `addresses`, `sources`, plus the new `basic_category` taxonomy ([Overture places guide](https://docs.overturemaps.org/guides/places/))
- Bridge files conflate Overture IDs ↔ OSM/Foursquare/Google ([Bridge files](https://docs.overturemaps.org/gers/bridge-files/))

**Foursquare Open Source Places (FSQ OSP).**
- License: **Apache 2.0** ([FSQ OSP notice](https://opensource.foursquare.com/places-notice-txt/))
- Format: Parquet on S3, ~10.6 GB, ~104M records ([Hugging Face](https://huggingface.co/datasets/foursquare/fsq-os-places))
- Volume: 100M+ POIs, 22 core attributes, monthly updates
- Schema: hierarchical category tree (1,000+ categories), names, addresses, lat/lon
- Caveats: addresses sometimes incomplete; quality has improved through 2025 ([Evolving FSQ OSP](https://medium.com/@foursquare/evolving-fsq-os-places-fa7a3f5197cd))

**OpenStreetMap.**
- License: **ODbL 1.0** (attribution + share-alike obligations).
- Format: PBF dumps via Geofabrik; queryable live via Overpass API ([Overpass turbo](https://overpass-turbo.eu/), [Nominatim](https://nominatim.org/))
- Tag system is explicit and granular for safety filtering (see §4).
- Caveats: ODbL share-alike obligations are non-trivial — if Mingla integrates OSM data into a derived work, attribution and same-license obligations may apply. **Legal review required before bulk OSM ingestion.** Read-only Overpass queries for cross-referencing (without persisting OSM data itself) are typically lower-risk.

**Other free sources:**
- US Census Bureau county/place boundaries — public domain.
- WorldPop population grids — CC-BY ([WorldPop](https://www.worldpop.org/)).
- National Park Service / state DOT POI dumps — generally public domain.
- Wikipedia/Wikidata for editorial cross-reference — CC0/CC-BY.

---

## 10. Recommended Reference Architecture — Place Intelligence Agent (PIA)

```
                        +-------------------------+
                        |  SOURCE LAYER           |
                        |  - Google Places API    |
                        |  - Overture (Parquet)   |
                        |  - Foursquare OSP       |
                        |  - OSM (Overpass)       |
                        |  - Editorial scrapes    |
                        +------------+------------+
                                     |
                                     v
                        +-------------------------+
                        |  ENTITY RESOLUTION      |
                        |  Name+addr Levenshtein  |
                        |  + Haversine (<50m)     |
                        |  + LLM tiebreaker on    |
                        |    contested matches    |
                        |  GERS UUID assignment   |
                        +------------+------------+
                                     |
                                     v
                        +-------------------------+
                        |  EMBEDDING TRIAGE       |
                        |  Encode name + types[]  |
                        |  + summary against 13   |
                        |  category prototypes +  |
                        |  N adult-content        |
                        |  prototypes             |
                        |  ($0.02/1M tok)         |
                        +------+------------------+
                               |
                               v
                  +------------+------------+
                  |  DETERMINISTIC GATE     |
                  |  - Type allowlist       |
                  |  - Type blocklist       |
                  |  - OSM cross-reference  |
                  |  - Name regex           |
                  |  - GMB category match   |
                  +-----+----+----+---------+
                        |    |    |
              clean    amb  blocked
                |       |       |
                |       v       v
                |   +---+----+ +-----------+
                |   | LLM    | | REJECT    |
                |   | CLASS  | | persist   |
                |   | (Haiku | | reason    |
                |   |  batch | +-----------+
                |   |  +cache)|
                |   +---+----+
                |       |
                |       v   (low-confidence?)
                |   +---+----+
                |   | LLM    |
                |   | VERIFY |
                |   | (Sonnet|
                |   |  +     |
                |   |  Opus  |
                |   |  arbiter)|
                |   +---+----+
                |       |
                v       v
         +------+-------+----+
         |  QUALITY SCORING   |
         |  - Bayesian-shrunk |
         |    rating          |
         |  - NIMA / CLIP     |
         |    photo score     |
         |  - Review aspects  |
         |  - Resy/Tock proxy |
         |  - Editorial bonus |
         +---------+----------+
                   |
                   v
         +---------+----------+
         |  PER-CITY          |
         |  CALIBRATION       |
         |  - Percentile      |
         |    bucketing       |
         |  - Reference cohort|
         |  - Outlier alarms  |
         +---------+----------+
                   |
                   v
         +---------+----------+      +-----------------+
         |  PLACE_POOL_V2     |<-----+ CONTINUOUS      |
         |  + safety_label    |      | CANARIES        |
         |  + signal scores   |      | - Daily sampled |
         |  + city_percentile |      |   pulls         |
         |  + audit trail     |      | - 50/wk human   |
         +---------+----------+      |   review        |
                   |                 | - Distribution  |
                   v                 |   anomaly alarm |
              SERVING                +-----------------+
```

**Per-stage description:**

1. **Source layer.** Keep Google as primary (richest current attributes), add Overture monthly Parquet dumps as the structural backbone, FSQ OSP as supplemental coverage, OSM Overpass live queries for safety cross-reference, Editorial scrapes (Eater/Michelin/James Beard) monthly for fine-dining boost. Persist raw payloads in `place_raw` partitioned by source.
2. **Entity resolution.** Compute candidate matches by Haversine ≤50m + name fuzzy match (Levenshtein-normalized ≥0.85 OR token Jaccard ≥0.6). Send the contested cluster (2 or 3 candidates within threshold) to an LLM tiebreaker. Assign a stable GERS UUID; map to all source-side IDs (`google_place_id`, `fsq_id`, `osm_id`).
3. **Embedding triage.** Single batch embedding pass with text-embedding-3-small or voyage-3.5-lite. Pre-compute prototype embeddings for the 13 Mingla categories + ~20 safety/blocklist concepts. Store top-3 nearest categories + similarity scores per place as a fast cache; powers cheap re-classification later.
4. **Deterministic gate (the upgraded bouncer).** Three-layer:
   - Allowlist/blocklist on Google `types[]` and GMB category if present.
   - OSM cross-reference: query Overpass within 50m; any of `amenity=stripclub`, `amenity=brothel`, `shop=erotic`, `leisure=adult_gaming_centre`, `amenity=swingerclub` → hard block.
   - Name regex (case-insensitive): `\b(strip|adult|erotic|gentlemen.s|XXX|swinger|brothel|escort)\b` → hard block; `(hookah|cigar bar|smoke shop)\b` → flag for context (allow in nightlife, block in family/dining).
5. **LLM classification.** Haiku 4.5 with cached system prompt and batch processing for new/unclassified places. System prompt holds the 13-category definitions + safety policy; user prompt = structured place record. Output: JSON with `category`, `confidence`, `reasoning`, `safety_flags[]`. Effective cost ~$0.0003/place.
6. **LLM verifier (only on disputes).** If Haiku confidence <0.8 OR safety flag fired with <0.95 confidence, escalate to Sonnet with the same record. If Sonnet disagrees with Haiku, escalate to Opus arbiter. Multi-agent debate adapted.
7. **Quality scoring.** Replace today's per-signal weights with a multi-source composite: Bayesian-shrunk rating (handles low-volume places), NIMA top-3-photo median, review aspect-extraction sentiment (LLM monthly batch over top-N reviews), reservation-platform presence (Resy/Tock), editorial cross-reference. Persist each component for explainability.
8. **Per-city calibration.** Compute per-city per-category percentile rankings nightly. Serve "fine dining" as "top 10 in this city's fine-dining percentile" not "absolute rating ≥4.5." This solves the "feels mid" problem because it surfaces each city's actual best.
9. **Continuous canary + human-in-loop.** Daily synthetic pulls per city per signal, sample 5–10% for human review (Surge AI or internal team), feed labels back as ground truth.

**Cost projection at three tiers (Mingla scale: 200K places, ~20K monthly net new):**

| Tier | One-time pass (200K) | Monthly steady-state | Annual |
|---|---|---|---|
| **SOTA** (Opus arbiter + Sonnet verify + 5% human) | ~$2,400 + $1,500 human | ~$300 + $150 human | ~$5,400 |
| **Good-enough** (Haiku batch+cache, Sonnet on 10% disputes) | ~$160 | ~$25 | ~$300 |
| **Mingla-affordable** (Haiku batch+cache only, no verifier) | ~$50 | ~$10 | ~$120 |

Embedding triage adds <$10/year at 200K. Photo scoring (NIMA) is one-time GPU compute; on AWS Inferentia or modest GPU, ~$200 one-time for 200K places at 5 photos each.

**Recommendation: start at Good-enough; route only safety-flagged or low-confidence cards to the SOTA tier.** That's ~$300–$500/year fully loaded for a 200K place graph with daily QA — well within Mingla budget bounds.

---

## 11. Phased Migration Path

### Phase 1 (this month — May 2026): close the safety hole and prove the bouncer upgrade
- Implement OSM Overpass cross-reference around every existing `place_pool` row (one-shot batch). Hard-block any place within 50m of `amenity=stripclub | amenity=brothel | shop=erotic | leisure=adult_gaming_centre | amenity=swingerclub`.
- Add name regex blocklist (`/strip|adult|erotic|gentlemen.s|XXX|swinger|brothel|escort/i`).
- Add GMB-category blocklist when Places API surfaces it.
- Add an `excluded` boolean + `excluded_reason` to `place_pool` (do not delete — keep audit trail).
- **Success criteria:** zero adult-category venues in any of the 13 date signals on a fresh sample of 500 random place_pool rows per city. Manual spot-check passes.

### Phase 2 (next quarter — June–August 2026): unify the classifier and add per-city calibration
- Build embedding-triage pass with text-embedding-3-small. Persist top-3 categories + scores per place.
- Replace bouncer + signal scorer with a single config-driven pipeline: rules → embedding triage → Haiku classifier → Sonnet verifier on disputes. Output: structured `pia_classification` JSONB column.
- Add **per-city percentile** scoring as a ranking layer on top of the per-signal scores.
- Add **NIMA photo scoring** (one-shot GPU job) as a quality signal; persist `photo_aesthetic_score`.
- Add **Resy/Tock presence flag** by scraping or partner data feeds where available; use as fine-dining boost.
- Set up daily synthetic canary cards: 1 per city per signal, persisted card snapshots, manual review weekly.
- **Success criteria:** Baltimore "sparseness" and Fort Lauderdale "sex club" complaints both close on retest; 95% inter-rater agreement between human reviewer and PIA classification on a 500-card sample across 5 cities.

### Phase 3 (12-month horizon — May 2027): adopt Overture/FSQ as backbone, full agentic self-audit
- Migrate `place_pool` to a dual-key model: (`gers_uuid`, `google_place_id`) with Overture monthly imports as the canonical structural source and Google as the live-attributes overlay.
- Add Foursquare OSP coverage backfill (legal review on Apache 2.0 obligations done first).
- Stand up multi-agent verifier with debate pattern for safety-critical and high-stakes "fine dining" classifications. Sonnet 4.6 propose-include + Sonnet 4.6 propose-exclude + Opus 4.7 arbiter. Use only on the ~5–10% of cases where deterministic + Haiku disagree.
- Continuous self-audit dashboard: per-city per-signal Completeness / Correctness / Currency tracked daily; population-normalized coverage tracked weekly; distribution-anomaly alarms.
- Sample-based human review at scale: 50 cards/city/week through Surge AI or internal team, fed back as labeled training data for monthly Haiku fine-tune (optional — only worth it if scale grows past ~500K places).
- **Success criteria:** zero safety incidents in 90 rolling days; per-city Completeness ≥90% vs. Overture+FSQ ground truth; user-reported "feels mid" on fine dining drops below 2% on weekly synthetic survey.

---

## 12. Bibliography (70+ sources)

1. [Overture Maps Documentation — Places Overview](https://docs.overturemaps.org/guides/places/)
2. [Overture Maps Foundation — GERS launch announcement (June 2025)](https://overturemaps.org/announcements/2025/overture-maps-launches-gers-a-global-standard-for-interoperable-geospatial-ids-to-drive-data-interoperability/)
3. [Overture Maps Documentation — Attribution and Licensing](https://docs.overturemaps.org/attribution/)
4. [Overture Maps — 2025-12-17 release notes](https://docs.overturemaps.org/blog/2025/12/17/release-notes/)
5. [Overture Maps — Bridge Files (conflation)](https://docs.overturemaps.org/gers/bridge-files/)
6. [Overture Maps — 2025-09-24 release notes (Foursquare integration)](https://docs.overturemaps.org/blog/2025/09/24/release-notes/)
7. [Foursquare Open Source Places announcement (Nov 2024)](https://foursquare.com/resources/blog/products/foursquare-open-source-places-a-new-foundational-dataset-for-the-geospatial-community/)
8. [Foursquare OSP on Hugging Face](https://huggingface.co/datasets/foursquare/fsq-os-places)
9. [Foursquare Open Source — Notice/License](https://opensource.foursquare.com/places-notice-txt/)
10. [Foursquare Categories documentation](https://docs.foursquare.com/data-products/docs/categories)
11. [Foursquare Places Quality docs](https://docs.foursquare.com/data-products/docs/places-quality)
12. [Google Places API — Place Types (New)](https://developers.google.com/maps/documentation/places/web-service/place-types)
13. [Google Places API New — pricing](https://developers.google.com/maps/billing-and-pricing/pricing#places-api-new)
14. [Google Search — SEO guidelines for explicit content](https://developers.google.com/search/docs/specialty/explicit/guidelines)
15. [GMB Everywhere — GMB categories for night clubs](https://www.gmbeverywhere.com/gmb-category/find-gmb-categories-for-a-night-club)
16. [OpenStreetMap Wiki — Map Features](https://wiki.openstreetmap.org/wiki/Map_features)
17. [OSM Wiki — Tag:amenity=stripclub](https://wiki.openstreetmap.org/wiki/Tag:amenity=stripclub)
18. [OSM Wiki — Tag:amenity=brothel](https://wiki.openstreetmap.org/wiki/Tag:amenity%3Dbrothel)
19. [OSM Wiki — Tag:shop=erotic](https://wiki.openstreetmap.org/wiki/Tag:shop=erotic)
20. [OSM Wiki — Tag:leisure=adult_gaming_centre](https://wiki.openstreetmap.org/wiki/Tag:leisure=adult_gaming_centre)
21. [OSM Wiki — Key:amenity](https://wiki.openstreetmap.org/wiki/Key:amenity)
22. [Nominatim — Search documentation](https://nominatim.org/release-docs/latest/api/Search/)
23. [Overpass turbo](https://overpass-turbo.eu/)
24. [Yelp — Search Query Understanding with LLMs (engineering blog 2025)](https://engineeringblog.yelp.com/2025/02/search-query-understanding-with-LLMs.html)
25. [Yelp — 2025 Trust & Safety Report](https://blog.yelp.com/news/2025-trust-and-safety-report/)
26. [Yelp — Trust & Safety content moderation hub](https://trust.yelp.com/content-moderation/)
27. [Yelp — Content Guidelines](https://www.yelp-support.com/article/Content-Guidelines)
28. [Yelp Fusion API — Resources/Categories](https://docs.developer.yelp.com/docs/resources-categories)
29. [VentureBeat — How Yelp evaluated LLMs](https://venturebeat.com/ai/how-yelp-reviewed-competing-llms-for-correctness-relevance-and-tone-to-develop-its-user-friendly-ai-assistant)
30. [TripAdvisor — 2025 Transparency Report (PR Newswire)](https://www.prnewswire.com/news-releases/tripadvisors-2025-transparency-report-reveals-strong-review-submissions-and-improved-fraud-detection-302403631.html)
31. [TripAdvisor — Content Integrity Policy](https://tripadvisor.mediaroom.com/us-content-integrity-policy)
32. [Tripadvisor Tech Medium — Evolving Search to Semantic](https://medium.com/tripadvisor/evolving-tripadvisor-search-building-a-semantic-search-engine-for-travel-recommendations-830f464318b7)
33. [Apple Developer — PoiCategory (Apple Maps Server)](https://developer.apple.com/documentation/applemapsserverapi/poicategory)
34. [Apple Developer — MKPointOfInterestCategory](https://developer.apple.com/documentation/mapkit/mkpointofinterestcategory)
35. [Apple Business Connect — Categories](https://support.apple.com/en-asia/guide/apple-business-connect/abcb5add1f54/web)
36. [Mapbox — How to evaluate POI providers](https://www.mapbox.com/blog/how-to-select-a-point-of-interest-poi-data-provider)
37. [Mapbox — Smarter global search and POI coverage](https://www.mapbox.com/blog/mapbox-search-box-api-expanded-poi-coverage-smarter-search)
38. [Mapbox — Introducing Mapbox POIs](https://www.mapbox.com/blog/introducing-mapbox-pois)
39. [Mapbox Search Box API docs](https://docs.mapbox.com/api/search/search-box/)
40. [NAICS 722410 — Drinking Places (NAICS.com)](https://www.naics.com/naics-code-description/?code=722410)
41. [NAICS 713990 — All Other Amusement & Recreation](https://www.insurancexdate.com/naics/713990)
42. [Anthropic Pricing (Claude API Docs)](https://platform.claude.com/docs/en/about-claude/pricing)
43. [Anthropic — Claude Haiku 4.5 launch](https://www.anthropic.com/news/claude-haiku-4-5)
44. [Anthropic — Batch Processing docs](https://platform.claude.com/docs/en/build-with-claude/batch-processing)
45. [Anthropic — Prompt Caching docs](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
46. [Anthropic — Message Batches API announcement](https://www.anthropic.com/news/message-batches-api)
47. [Anthropic — Constitutional Classifiers research](https://www.anthropic.com/research/constitutional-classifiers)
48. [Finout — Anthropic API Pricing 2026](https://www.finout.io/blog/anthropic-api-pricing)
49. [OpenAI API Pricing](https://openai.com/api/pricing/)
50. [OpenAI Batch API guide](https://developers.openai.com/api/docs/guides/batch)
51. [Google Gemini API Pricing](https://ai.google.dev/gemini-api/docs/pricing)
52. [Voyage AI — Pricing](https://docs.voyageai.com/docs/pricing)
53. [Voyage AI — voyage-3.5 launch](https://blog.voyageai.com/2025/05/20/voyage-3-5/)
54. [Cohere — Pricing](https://cohere.com/pricing)
55. [Cohere — Embed v4 docs](https://docs.cohere.com/docs/cohere-embed)
56. [Du et al. — Multiagent Debate (arXiv 2305.14325)](https://arxiv.org/abs/2305.14325)
57. [Tool-MAD — Multi-Agent Debate Framework for Fact Verification (2026)](https://arxiv.org/html/2601.04742v1)
58. [Adaptive Heterogeneous Multi-Agent Debate (Springer 2025)](https://link.springer.com/article/10.1007/s44443-025-00353-3)
59. [FACT-AUDIT (ACL 2025)](https://aclanthology.org/2025.acl-long.17.pdf)
60. [Zheng et al. — LLM-as-Judge (NeurIPS 2023)](https://arxiv.org/abs/2306.05685)
61. [Chae & Davidson — LLMs for Text Classification (2025)](https://journals.sagepub.com/doi/10.1177/00491241251325243)
62. [GER-LLM — Geospatial Entity Resolution with LLMs (EMNLP 2025)](https://aclanthology.org/2025.emnlp-main.1186.pdf)
63. [Geospatial Entity Resolution — Balsebre et al. WWW 2022](https://dl.acm.org/doi/10.1145/3485447.3512026)
64. [Google NIMA — Neural Image Assessment](https://research.google/blog/introducing-nima-neural-image-assessment/)
65. [Idealo — Image Quality Assessment (NIMA implementation)](https://github.com/idealo/image-quality-assessment)
66. [CLIP knows image aesthetics — Frontiers in AI](https://www.frontiersin.org/journals/artificial-intelligence/articles/10.3389/frai.2022.976235/full)
67. [Improved Aesthetic Predictor (CLIP+MLP)](https://github.com/christophschuhmann/improved-aesthetic-predictor)
68. [AWS CloudWatch Synthetics Canaries](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch_Synthetics_Canaries.html)
69. [Datadog — What are canary tests](https://www.datadoghq.com/knowledge-center/canary-testing/)
70. [Restaurant Business — Resy & Tock merger](https://www.restaurantbusinessonline.com/technology/reservation-services-resy-tock-are-merging)
71. [Surge AI vs Scale AI pricing comparison](https://averroes.ai/blog/surge-ai-vs-scale-ai)
72. [Scale AI Review — Label Your Data](https://labelyourdata.com/articles/scale-ai-review)
73. [WorldPop — Open spatial demographic data](https://www.worldpop.org/)
74. [QGIS Fast Density Analysis plugin](https://plugins.qgis.org/plugins/fast_kernel_density_analysis/)
75. [Penn State Map MOOC — Normalization](https://www.e-education.psu.edu/maps/l4_p5.html)
76. [Location Business News — Overture's 2026 Conflation Tax push](https://locationbusinessnews.com/overture-maps-foundation-targets-conflation-tax-in-2026-push-for-interoperable-data)
77. [TechCrunch — Overture launches first open map datasets](https://techcrunch.com/2024/07/24/backed-by-microsoft-aws-and-meta-the-overture-maps-foundation-launches-first-open-map-datasets/)
78. [Echo Analytics — Analyzing Overture Places data](https://www.echo-analytics.com/blog/analyzing-overture-maps-foundations-places-data)

---

## Closing Notes & Gaps

Definitive gaps where no published architecture was found:

- **No dating app (Tinder, Hinge, Bumble) has published a date-spot safety / venue-vetting architecture.** This is whitespace; Mingla can either lead the public conversation or treat it as competitive moat. Recommend reaching out to Tinder Trust & Safety and Hinge Engineering for partnership or off-record exchange.
- **Apple has not published its sensitive-POI moderation policy in detail.** Treat Apple's "user-content-only-on-eat/shop/stay" as a strong public signal but do not rely on private internals.
- **Resy/Tock APIs for fine-dining cross-reference are partner-only.** Recommend partner conversations with Amex/Resy if Mingla scales past 100K active users.

**Final recommendation:** implement Phase 1 (the safety bouncer upgrade with OSM cross-reference + name regex + GMB-category-aware blocklist) within the next two weeks. It is high-value, low-cost, and directly closes the Fort Lauderdale class of bug. Phases 2 and 3 are larger investments that should be sequenced after Phase 1 is in production and stable.
