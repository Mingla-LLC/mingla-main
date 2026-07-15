# Snapchat Ads — Exhaustive Pipeline Reference & Mingla Capability Gap Map

**Date:** 2026-07-14 · **Mode:** RESEARCH-ONLY (docs + our specs; **zero** Snap API writes; no POST/PUT/PATCH/DELETE issued)
**Scope:** Snapchat Marketing API (Ads API) full paid pipeline → mapped against Mingla's internal Ad Engine (#862/#866/#867)

> **Unit convention (governs this whole doc):** Snapchat budgets/bids are **MICRO-currency**. `1.00 local currency = 1,000,000 micro`. $20.00 = `20000000`. $5.00 = `5000000`.

---

## 0. Sources

**Primary (Snap official — authoritative):**
- `https://developers.snap.com/marketing-api/Ads-API/campaigns` — campaign fields, objective_v2, budget minimums, endpoints
- `https://developers.snap.com/marketing-api/Ads-API/ad-squads` — ad squad fields, optimization_goal, bid_strategy, placement_v2, targeting, delivery_constraint
- `https://developers.snap.com/marketing-api/Ads-API/creatives` — creative types, headline/brand_name limits, CTA enum map, web_view_properties, profile_properties
- `https://developers.snap.com/marketing-api/Ads-API/ads` — ad fields, ad type enum, review_status + review_status_reasons
- `https://developers.snap.com/marketing-api/Ads-API/media` — media create/upload/chunked upload, media specs table, size thresholds
- `https://developers.snap.com/marketing-api/Ads-API/targeting` · `.../example-targeting-specs` — targeting spec structure
- `https://developers.snap.com/marketing-api/Public-Profile-API/Profiles` · `.../GetStarted` — Public Profile API (**different host**)
- `https://developers.snap.com/marketing-api/Ads-API/introduction` · `.../quick-start` · `.../announcements`
- `https://developers.snap.com/marketing-api/Ads-API/dynamic-product-ads`

**Snap business/policy:**
- `https://businesshelp.snapchat.com/s/article/public-profiles` · `.../public-profiles-faq` · `.../profile-ad-account`
- `https://businesshelp.snapchat.com/s/article/snap-ads-practices` — single image/video creative best practices
- `https://businesshelp.snapchat.com/s/article/placements` · `.../image-video-ad-restrictions` · `.../create-sam-audience` · `.../custom-audiences`
- `https://values.snap.com/policy/advertising-policies` · `https://www.snap.com/ad-policies` · `https://www.snap.com/terms/commercial-content`
- `https://forbusiness.snapchat.com/advertising/ad-formats` · `.../targeting`

**Deprecated:** `https://marketingapi.snapchat.com/docs/` — legacy site, superseded by developers.snap.com. **Do not cite as current.**

**Secondary (creative specs cross-check — corroborating, NOT authoritative):** Strike Social, Benly, AdNabu, AuditSocials, QuickFrame, Sprout Social, Marpipe, advertiserreview.com. Used only where Snap's own numbers were ambiguous; flagged inline as `[secondary]`.

**Our ground truth (read-only):**
- `/Users/sethogieva/Desktop/mingla-orchs/issue-867-snapchat-google-channels/Mingla_Artifacts/specs/SPEC_ISSUE-867_SNAPCHAT_GOOGLE_CHANNELS.md` (501 lines) — Snapchat lane, live-probe evidence
- `/Users/sethogieva/Desktop/mingla-orchs/issue-862-meta-ads-api/Mingla_Artifacts/specs/SPEC_ISSUE-862_META_ADS_CAMPAIGN_ENGINE.md` — **Amendment A3** = canonical engine model
- `/Users/sethogieva/Desktop/mingla-orchs/issue-866-creative-library/Mingla_Artifacts/specs/SPEC_ISSUE-866_CREATIVE_LIBRARY.md` — creative library + `uploadToSnap`

**Mingla live-probed IDs (from #867 §4.0, 2026-07-14):** org `9389df65-3fa2-4a79-9593-479eee8d67bb` "Usemingla" (US, ENTERPRISE, ACTIVE) · ad account `6421cc96-dcaf-4a09-a7fa-b24199dcb391` "Mingla Ads" (PARTNER, ACTIVE, USD, America/New_York, billing_type REVOLVING) · funding source `6af02267-372a-41de-84f9-cddc024a183b` (VISA •4101, ACTIVE, `daily_spend_limit_micro:15000000000` = $15,000/day, exp 03/2029) · pixel `af5f8fc4-1ef6-41e7-81c5-042b7be7df38` "Usemingla Pixel" (ACTIVE, `automatic_event_opt_in:OPT_OUT`) · OAuth app "Mingla Ads Engine" client `0c517e9f-…` · snapchat_username `usemingla`. Hierarchy all empty (`campaigns/adsquads/ads/creatives/media/catalogs = []`).

---

## 1. Object hierarchy

```
Organization  (9389df65-…)
   └── Ad Account  (6421cc96-…)            [+ Funding Sources, Pixels, Catalogs, Media, Creatives]
         └── Campaign                       objective_v2_type, buy_model, budget(optional/CBO)
               └── Ad Squad                 targeting, bid, budget(ABO), optimization_goal, placement_v2
                     └── Ad                 status + review_status  ← DELIVERY GATE
                           └── Creative     (owned by AD ACCOUNT, referenced by ad; reusable)
                                 └── Media  (owned by AD ACCOUNT; uploaded FIRST; reusable)

Public Profile  ← owned by ORGANIZATION, on a DIFFERENT HOST, REQUIRED by every creative
```

**Key structural facts:**
- **Creative and Media are ad-account-scoped, not ad-scoped** — both are reusable across many ads. Media must exist and be `READY` before a creative can reference it.
- **Public Profile is org-scoped** and lives on `businessapi.snapchat.com`, *not* `adsapi.snapchat.com`. Two base URLs are required.
- **Ad Squad ≈ Meta ad set ≈ Google ad group.**
- Campaign budget (CBO) and ad-squad budget (ABO) are **mutually exclusive**.

**Hosts / IDs / envelope:**

| Item | Value |
|---|---|
| Ads API base | `https://adsapi.snapchat.com/v1` |
| Public Profile API base | `https://businessapi.snapchat.com/v1` ← **different host** |
| Token mint | `POST https://accounts.snapchat.com/login/oauth2/access_token` |
| Auth | `Authorization: Bearer <access_token>` |
| Token flow | `grant_type=refresh_token` (form-encoded) → `expires_in=3600` (60 min), `token_type=Bearer` |
| Scopes (our token) | `snapchat-marketing-api` (create/manage) + `snapchat-offline-conversions-api` (→ #865) |
| ID format | **UUID v4** lowercase (`8-4-4-4-12`) for every entity: org, account, campaign, adsquad, ad, creative, media, pixel, profile |
| Google contrast | Google uses **resource names** (`customers/123/campaigns/456`), not UUIDs — the generalized `external_*_id` column must be `text`, wide enough for both |

**Response envelope — EVERY endpoint wraps in a batch envelope:**

```json
{
  "request_status": "SUCCESS",
  "request_id": "<uuid>",
  "paging": { "next_link": "..." },
  "campaigns": [
    { "sub_request_status": "SUCCESS",
      "campaign": { "id": "...", "...": "..." } }
  ]
}
```

**THE SUCCESS CONTRACT (non-negotiable):** an **HTTP 200 with `request_status:"SUCCESS"` can still carry a per-entity `sub_request_status:"FAILURE"`.** Both the outer `request_status` **and** every element's `sub_request_status` must be asserted. Checking only the HTTP code or only `request_status` silently treats failures as successes. `request_status` ∈ `SUCCESS | ERROR`; `sub_request_status` ∈ `SUCCESS | ERROR | FAILURE`. Errors surface per-entity (e.g. `{"sub_request_status":"ERROR","errors":[…]}`).

**Cross-platform envelope deltas:** Snapchat = batch envelope + `sub_request_status`; Meta = flat object or `{error:{…}}`; Google = `mutate` results array with partial-failure semantics; TikTok = `{code, message, data}`.

---

## 2. Campaign level — EVERY field

`POST /adaccounts/{ad_account_id}/campaigns`

### Required
| Field | Type | Notes / exact values |
|---|---|---|
| `ad_account_id` | UUID | our `6421cc96-…` |
| `name` | string | **max 375 chars** |
| `start_time` | ISO-8601 | e.g. `2026-08-01T00:00:00.000-04:00` |
| `status` | enum | `ACTIVE` \| `PAUSED` — **always create `PAUSED`** |
| `measurement_spec` | object | **Required ONLY** for ad types `APP_INSTALL`, `DEEP_LINK`, `STORY` (with app swipes), `LENS_APP_INSTALL`, `LENS_DEEP_LINK`. Format `{"ios_app_id":"1234","android_app_url":"com.snapchat.android"}`. **Not required for our `REMOTE_WEBPAGE`/web traffic lane.** |

### Optional
| Field | Type | Exact constraint |
|---|---|---|
| `end_time` | ISO-8601 | must be **after** `start_time` |
| `daily_budget_micro` | int | **min 20,000,000** ($20.00) — campaign level = **CBO** |
| `lifetime_spend_cap_micro` | int | **min 20,000,000** ($20.00). May be raised or removed; may only be **reduced if the new cap > 1.1 × already-spent** |
| `objective` | enum | **DEPRECATED** — replaced by `objective_v2_properties`. Legacy apps auto-translated by a translator service as of **21 March 2025**; adoption expected **before 2025**. **Do not use.** |
| `objective_v2_properties` | object | `{ "objective_v2_type": <enum>, "promotion_type": <enum> }` — drives which `optimization_goal`s the Ad Squad may use |
| `buy_model` | enum | `AUCTION` (**default**) \| `RESERVED` |
| `reserved_type` | enum | `REACH_AND_FREQUENCY` (R&F campaigns only) |
| `regulations` | object | **Required** for Housing / Credit / Employment (HEC) ads |
| `mobile_app_properties` | object | SKAdNetwork enrollment |
| `shared_properties` | object | Smart Budgets config |
| `product_properties` | object | Dynamic Ads **catalog id** |
| `pacing_level` | enum | `AD_SQUAD` \| `CAMPAIGN` |

### Read-only
`id`, `created_at`, `updated_at`, `delivery_status` (**array**), `deleted` (only with `read_deleted_entities`), `auto_bid_max_bid_micro` (auto-set by Smart Budgets).

### FULL `objective_v2_type` enum (5 values)
`AWARENESS_AND_ENGAGEMENT` · `TRAFFIC` · `SALES` · `APP_PROMOTION` · `LEADS`

### FULL `promotion_type` enum (4 values)
`PROMOTE_PLACES` · `PROMOTE_SHOWS` · `APP_INSTALL` · `APP_REENGAGEMENT`

> **Mingla:** `objective_v2_type = "TRAFFIC"` for driving traffic to a public event/venue page. `PROMOTE_PLACES` is a *notable* promotion_type for a venue-led product — worth evaluating (§10 G-16).

### Campaign endpoints
| Method | Endpoint |
|---|---|
| POST | `/v1/adaccounts/{ad_account_id}/campaigns` (create) |
| PUT | `/v1/adaccounts/{ad_account_id}/campaigns` (update — **parent collection**, entity carries its `id`) |
| PATCH | `/v1/adaccounts/{ad_account_id}/campaigns/{campaign_id}` (partial) |
| GET | `/v1/adaccounts/{ad_account_id}/campaigns` (list) |
| GET | `/v1/campaigns/{campaign_id}` (single) |
| POST | `/v1/adaccounts/{ad_account_id}/get_campaigns_by_ids` (batch read) |
| DELETE | `/v1/campaigns/{campaign_id}` |

---

## 3. Ad Squad level — EVERY field

`POST /campaigns/{campaign_id}/adsquads`

### Fields
| Field | Type | Req | Exact constraint |
|---|---|---|---|
| `campaign_id` | UUID | **R** | parent |
| `name` | string | **R** | **max 375 chars** |
| `type` | enum | **R** | `SNAP_ADS` \| `LENS` \| `FILTER` |
| `status` | enum | O | `ACTIVE` \| `PAUSED` |
| `optimization_goal` | enum | **R** | 18 values (below) |
| `bid_strategy` | enum | **R** | `AUTO_BID` \| `LOWEST_COST_WITH_MAX_BID` \| `TARGET_COST` \| `MIN_ROAS`(**deprecated 10 Feb 2025**) |
| `bid_micro` | int | Cond. | **Required** for `LOWEST_COST_WITH_MAX_BID` / `TARGET_COST`; **omit for `AUTO_BID`**. **Min 10,000 micro ($0.01) across ALL currencies** |
| `billing_event` | enum | **R** | **`IMPRESSION` — the ONLY value** (always set) |
| `placement_v2` | object | **R** | see below |
| `targeting` | object | **R** | see below |
| `delivery_constraint` | enum | **R** | `DAILY_BUDGET` \| `LIFETIME_BUDGET` \| `REACH_AND_FREQUENCY` — **must match the budget field used** |
| `daily_budget_micro` | int | Cond. | **min 5,000,000** ($5.00) across all currencies |
| `lifetime_budget_micro` | int | Cond. | **min 5,000,000** ($5.00) |
| `start_time` | ISO-8601 | O | |
| `end_time` | ISO-8601 | O | |
| `pacing_type` | enum | O | `STANDARD` (**default**) \| `ACCELERATED` |
| `child_ad_type` | enum | O | 16 values (below) |
| `pixel_id` | UUID | O | our `af5f8fc4-…` — required for `PIXEL_*` / `LANDING_PAGE_VIEW` goals |
| `event_sources` | object | O/R | required for SKAdNetwork enrollment |
| `roas_value_micro` | int | R if `MIN_ROAS` | **min 10,000; max 100,000,000** |
| `conversion_window` | enum | O | `SWIPE_28DAY_VIEW_1DAY` (**default**) \| `SWIPE_7DAY` |
| `brand_safety_config` | object | O | `{"inventory_option":"FULL_INVENTORY"\|"LIMITED_INVENTORY"}` |
| `cap_and_exclusion_config` | object | O | **frequency cap**. Cannot combine with multi-format delivery in Auction campaigns |
| `ad_scheduling_config` | object | O | dayparting |
| `forced_view_setting` | enum | O | `FULL_DURATION` \| `SIX_SECONDS` \| `NONE` |
| `story_ad_creative_type` | enum | O | `APP_INSTALL` \| `WEB_VIEW` \| `DEEP_LINK` |
| `measurement_provider_names` | enum | O | `DOUBLEVERIFY` |
| `reach_goal` | int | R for R&F | from forecasting request |
| `impression_goal` | int | R for R&F | from forecasting request |
| `reach_and_frequency_status` | enum | R for R&F | `PENDING` |
| `skadnetwork_properties` | object | O | `{status: ENROLLED\|NEVER_ENROLLED\|WITHDRAWN, enroll_action: OPT_IN\|OPT_OUT, ecid_enroll_action: ATTACH\|DETACH, enable_skoverlay: bool}` |
| `campaign_budget_optimization_properties` | object | O | Smart Budgets (campaign-level only) |
| `separated_types` | array | RO | targeting-spec separation indicator |
| `deleted` | bool | RO | |
| `delivery_status` | array | RO | current delivery state |

### FULL `optimization_goal` enum (18 values)
`IMPRESSIONS` · `SWIPES` · `APP_INSTALLS` · `VIDEO_VIEWS` · `VIDEO_VIEWS_15_SEC` · `USES` · `STORY_OPENS` · `PIXEL_PAGE_VIEW` · `PIXEL_ADD_TO_CART` · `LANDING_PAGE_VIEW` · `LEAD_FORM_SUBMISSIONS` · `PIXEL_PURCHASE` · `PIXEL_SIGNUP` · `APP_ADD_TO_CART` · `APP_PURCHASE` · `APP_SIGNUP` · `APP_REENGAGE_OPEN` · `APP_REENGAGE_PURCHASE`

### `bid_strategy` semantics
| Strategy | Requires | Snap's description |
|---|---|---|
| `AUTO_BID` | — | "Drive the most efficient cost per action while spending your budget" |
| `LOWEST_COST_WITH_MAX_BID` | `bid_micro` | "Bids conservatively at or below your desired bid" |
| `TARGET_COST` | `bid_micro` | "Achieves the most volume while aiming to keep your average cost per action below your target cost" |
| `MIN_ROAS` | `roas_value_micro` | **Deprecated 10 Feb 2025** |

### `bid_micro` ranges — **min 10,000 micro for every currency**
| Max | Currencies |
|---|---|
| **500,000,000** | AED, CNY, DKK, HKD, ILS, INR, NOK, QAR, SAR, SEK, **USD** |
| **100,000,000** | AUD, BAM, CAD, CHF, EUR, GBP, KWD |

### `pacing_type` constraint
`ACCELERATED` **requires** `bid_strategy=LOWEST_COST_WITH_MAX_BID` **and** `bid_micro` set **and** `optimization_goal ∈ {IMPRESSIONS, USES, SWIPES, VIDEO_VIEWS, VIDEO_VIEWS_15_SEC, STORY_OPENS}`. **Immutable once set.**

### FULL `child_ad_type` enum (16 values)
`SNAP_AD` · `LONGFORM_VIDEO` · `APP_INSTALL` · `REMOTE_WEBPAGE` · `DEEP_LINK` · `STORY` · `AD_TO_LENS` · `AD_TO_CALL` · `AD_TO_MESSAGE` · `FILTER` · `LENS` · `LENS_WEB_VIEW` · `LENS_APP_INSTALL` · `LENS_DEEP_LINK` · `LENS_LONGFORM_VIDEO` · `COLLECTION`

### `placement_v2`
```json
{ "config": "AUTOMATIC" }
```
```json
{ "config": "CUSTOM",
  "platforms": ["SNAPCHAT"],
  "snapchat_positions": ["INTERSTITIAL_USER", "INSTREAM"],
  "inclusion": { "content_types": ["NEWS", "ENTERTAINMENT"] },
  "exclusion": { "content_types": ["GAMING"] } }
```
- `config`: `AUTOMATIC` ("Snapchat will choose the optimal placement across all of Snapchat") | `CUSTOM` (**requires** `platforms` **and** a non-empty `snapchat_positions`)
- **FULL `snapchat_positions` enum (9 values):** `INTERSTITIAL_USER` · `INTERSTITIAL_CONTENT` · `INTERSTITIAL_SPOTLIGHT` · `INSTREAM` · `PUBLIC_STORIES_INSTREAM` · `CHAT_FEED` · `FEED` · `CAMERA` · `POST_CAPTURE_CAROUSEL`

### `targeting` object — full structure
```json
{
  "regulated_content": false,
  "geos": [{ "country_code": "us" }],
  "demographics": [{ "min_age": "18", "max_age": "65", "genders": ["MALE","FEMALE"], "languages": ["ENGLISH"] }],
  "devices": [{ "os_type": "iOS", "os_version_min": "11.3", "operation": "INCLUDE" }],
  "interests": [],
  "segments": [],
  "custom_audiences": [],
  "lookalike_audiences": [],
  "enable_targeting_expansion": true,
  "auto_expansion_options": {
    "interest_expansion_option": { "enabled": true },
    "custom_audience_expansion_option": { "enabled": true }
  }
}
```
- **geos:** `country_code` (lowercase ISO, e.g. `us`, `gb`, `ng`); also supports regions/metros/postal codes/radius. **`operation: INCLUDE|EXCLUDE`.**
- **demographics:** `min_age`/`max_age` as **strings**; `genders` ∈ `MALE|FEMALE` (**no non-binary option**); `languages` (e.g. `ENGLISH`).
- **devices:** `os_type` ∈ `iOS | Android | WEB`; `os_version_min`/`os_version_max`; also `carriers`, `connection_type` (`CELL`/`WIFI`), `marketing_name` (device model). `operation` ∈ `INCLUDE|EXCLUDE`.
- **interests:** Snap Lifestyle Categories (SLC) + Purchase Behaviors — retrieved per country via the targeting endpoint (e.g. Parents, Pet Owners, Fitness Enthusiasts, Travelers; Online/In-Store Shoppers).
- **segments:** `ab_segments`, `engagement`, `first_party`, `fti`, `lookalike`, `mobile`, `pixel`.
- **custom_audiences / lookalike_audiences:** SAM (Snap Audience Match — customer-list uploads of email / phone / MAID), pixel audiences, engagement audiences. **Lookalike size: 1%–10%** of Snapchat users in the target country (1% = most similar/smallest; 10% = broadest/least similar).

### Attribution windows
`conversion_window` ∈ `SWIPE_28DAY_VIEW_1DAY` (**default**) | `SWIPE_7DAY`. Valid combinations are constrained by creative type `WEB_VIEW` + ad type `REMOTE_WEBPAGE`.

### Frequency / Reach & Frequency
- **Frequency cap:** `cap_and_exclusion_config`. Incompatible with multi-format delivery in Auction campaigns.
- **R&F:** `buy_model=RESERVED` + `reserved_type=REACH_AND_FREQUENCY` + `delivery_constraint=REACH_AND_FREQUENCY` + `reach_goal`/`impression_goal` from a **forecasting** request + `reach_and_frequency_status=PENDING`.

### Ad Squad endpoints
| Method | Endpoint |
|---|---|
| POST | `/v1/campaigns/{campaign_id}/adsquads` |
| PUT | `/v1/campaigns/{campaign_id}/adsquads` |
| GET | `/v1/adsquads/{ad_squad_id}` |
| GET | `/v1/adsquads/{ad_squad_id}/ad_squad_ad_restrictions` |
| GET | `/v1/adaccounts/{ad_account_id}/spend_guidance/?signal_type=PIXEL&signal_id={pixel_id}&optimization_goal={goal}` — **bid recommendations** |
| GET | `/v1/mobile_apps/{snap_app_id}/ecid_status` · `/v1/mobile_apps/{snap_app_id}/skadnetwork_adsquads` |

---

## 4. Ad & Creative level — EVERY field

### 4a. Media (prerequisite — must exist and be `READY` first)

**Create:** `POST /v1/adaccounts/{ad_account_id}/media`
| Field | Req | Values |
|---|---|---|
| `name` | R | |
| `type` | R | `VIDEO` \| `IMAGE` \| `LENS_PACKAGE` \| `PLAYABLE` |
| `ad_account_id` | R | |

**Upload (two paths — size-dependent):**
| Path | Endpoint | Constraint |
|---|---|---|
| Standard | `POST /v1/media/{media_id}/upload` | **`multipart/form-data`, NOT JSON.** **≤ 32 MB** |
| Chunked | `POST /v1/media/{media_id}/multipart-upload-v2` | **> 32 MB.** 3 phases: **INIT → ADD → FINALIZE**. **Max 32 chunks × 32 MB = 1 GB** |

- `media_status` ∈ `PENDING_UPLOAD` | `READY`
- `download_link` (read-only, hosted URL)
- `media_usages` array (`TOP_SNAP`, `OVERLAY_IMAGE`, `PLAYABLE`, …)
- **There is NO documented `upload_from_url` endpoint.** Snap ingests **raw bytes**, not a remote URL. ← see G-5.

### 4b. Creative — `POST /v1/adaccounts/{ad_account_id}/creatives`

**Required (all creatives):**
| Field | Constraint |
|---|---|
| `ad_account_id` | UUID |
| `name` | **max 375 chars** |
| `type` | enum (16 values below) |
| `headline` | **max 34 chars** |
| `top_snap_media_id` | UUID (media must be `READY`) |

**FULL creative `type` enum (16 values):**
`SNAP_AD` · `APP_INSTALL` · `WEB_VIEW` · `DEEP_LINK` · `AD_TO_LENS` · `AD_TO_CALL` · `AD_TO_MESSAGE` · `PREVIEW` · `COMPOSITE` · `LENS` · `LENS_WEB_VIEW` · `LENS_APP_INSTALL` · `LENS_DEEP_LINK` · `COLLECTION` · `LEAD_GENERATION` · `REMINDER`

**Optional / conditional:**
| Field | Constraint |
|---|---|
| `brand_name` | **max 32 chars.** **Required** for attachment types; optional for `SNAP_AD`. Defaults to the **Public Profile's** brand name |
| `call_to_action` | enum — **varies by creative type** (map below) |
| `shareable` | bool, **default `true`** |
| `profile_properties` | `{ "profile_id": <UUID> }` — attaches the **Public Profile** |
| `favorite_display_mode` | `SHOW` \| `HIDE` |
| `cta_color_display_mode` | `DEFAULT_COLOR` \| `AUTO_COLOR_DETECTION` |
| `top_snap_crop_position` | `OPTIMIZED` (**default**) \| `MIDDLE` \| `TOP` \| `BOTTOM` |
| `forced_view_eligibility` | `FULL_DURATION` \| `SIX_SECONDS` \| `NONE` |
| `ad_product` | `SNAP_AD` (**default**) \| `LENS` \| `FILTER` |
| `render_type` | `STATIC` |
| `review_status` | **RO** — `PENDING_REVIEW` \| `APPROVED` ← **note: creative enum differs from ad enum** |
| `packaging_status` | **RO** — `PENDING` \| `SUCCESS` \| `IN_PROGRESS` |

**`web_view_properties` (types `WEB_VIEW`, `LENS_WEB_VIEW`):**
| Field | Req | Constraint |
|---|---|---|
| `url` | **R** | **SSL-enabled, max 2048 chars** |
| `block_preload` | O | bool, default `false` |
| `allow_snap_javascript_sdk` | O | bool |
| `use_immersive_mode` | O | bool |
| `deep_link_urls` | O | array (auto-detected) |

**`app_install_properties`:** `app_name` (**max 30**), `ios_app_id` **or** `android_app_url`, `icon_media_id` (R), `enable_skoverlay`, `ios_app_end_card_media_ids` (**2–10**), `android_app_end_card_media_ids` (**2–10**), `product_page_id`, `playable_media_properties`.
**`deep_link_properties`:** `deep_link_uri` (R), `app_name` (**max 30**), `ios_app_id`/`android_app_url`, `icon_media_id` (R), `fallback_type` `APP_INSTALL`(default)|`WEB_SITE`, `web_view_fallback_url`, `product_page_id`.
**`collection_properties`:** `interaction_zone_id` (R), `default_fallback_interaction_type` `WEB_VIEW|DEEP_LINK|APP_INSTALL` (R), + the matching properties object.
**`composite_properties`:** `creative_ids` array (**1–20**).
**`preview_properties`:** `preview_media_id` (**3:5, min 360×600**), `logo_media_id` (**993×284**), `preview_headline` (**max 55**).
**`chat_properties`:** `wallpaper_media_id` (**1080×1920 IMAGE**), `additional_messages`, `default_responses`, `response_interaction_setting` `NO_USER_INPUT|SEND_DEFAULT_UNLIMITED`.
**`ad_to_lens_properties`:** `lens_media_id`. **`ad_to_call_properties`:** `phone_number_id`. **`ad_to_message_properties`:** `phone_number_id`, `message` (**max 160**). **`reminder_properties`:** `event_detail_id`.
**`ar_extension_properties`:** `lens_media_id` (R), `product_info_card_display_mode` `SHOW|HIDE`(default HIDE), `ar_extension_button_text` `TRY_ON|AR_LENS`, `ar_extension_button_color_theme` `DARK_GRAY|LIGHT_GRAY`.

**FULL `call_to_action` enum BY creative type:**
| Type | CTAs |
|---|---|
| **`WEB_VIEW`** (ours) | `APPLY_NOW`, `MORE`, `ORDER_NOW`, `PLAY`, `READ`, `SHOP_NOW`, `SHOW`, `SIGN_UP`, `VIEW`, `WATCH`, `DONATE`, `DOWNLOAD`, `RESPOND`, `BUY_TICKETS`, `SHOWTIMES`, `BOOK_NOW`, `GET_NOW`, `LISTEN`, `TRY`, `VOTE`, `VIEW_MENU`, `PRE_REGISTER`, `PLAY_GAME` |
| `APP_INSTALL` | `BOOK_NOW`, `DONATE`, `DOWNLOAD`, `GET_NOW`, `INSTALL_NOW`, `ORDER_NOW`, `PLAY`, `SHOP_NOW`, `SIGN_UP`, `TRY`, `USE_APP`, `WATCH`, `VOTE`, `DIRECTIONS`, `PLAY_GAME` |
| `DEEP_LINK` | `DONATE`, `PLAY`, `SHOP_NOW`, `SIGN_UP`, `USE_APP`, `MORE`, `OPEN_APP`, `TRY`, `WATCH`, `VIEW_PROFILE`, `VOTE`, `DIRECTIONS`, `PRE_REGISTER`, `PLAY_GAME`, `DOWNLOAD` |
| `AD_TO_LENS` | `PLAY`, `TRY`, `SHOP_NOW`, `VOTE` |
| `AD_TO_CALL` | `CALL_NOW`, `OPEN_APP` |
| `AD_TO_MESSAGE` | `MESSAGE_NOW`, `OPEN_APP` |
| `LEAD_GENERATION` | `APPLY_NOW`, `MORE`, `BOOK_NOW`, `GET_NOW`, `SIGN_UP`, `TEST_DRIVE`, `REQUEST_APPOINTMENT`, `REQUEST_QUOTE`, `FREE_TRIAL`, `CLAIM_SAMPLE`, `GET_COUPON` |

> **`VIEW_MORE` IS NOT A VALID CTA — on any type.** Our spec uses it. The nearest valid values are **`MORE`**, **`VIEW`**, **`BOOK_NOW`**, **`BUY_TICKETS`**. ← **G-3**

**Creative endpoints:** POST `/v1/adaccounts/{id}/creatives` · PUT `/v1/adaccounts/{id}/creatives` · PATCH `/v1/adaccounts/{id}/creatives/{creative_id}` · GET `/v1/adaccounts/{id}/phone_numbers`.

### 4c. Ad — `POST /v1/adsquads/{ad_squad_id}/ads`

**Required:** `ad_squad_id`, `creative_id`, `name` (**max 375**), `status` (`ACTIVE`|`PAUSED`), `type`.

**FULL ad `type` enum (16 values):**
`SNAP_AD` · `APP_INSTALL` · **`REMOTE_WEBPAGE`** · `DEEP_LINK` · `STORY` · `AD_TO_LENS` · `AD_TO_CALL` · `AD_TO_MESSAGE` · `FILTER` · `LENS` · `LENS_WEB_VIEW` · `LENS_APP_INSTALL` · `LENS_DEEP_LINK` · `COLLECTION` · `LEAD_GENERATION` · `REMINDER`

> **CRITICAL MAPPING:** creative `type=WEB_VIEW` pairs with ad **`type=REMOTE_WEBPAGE`**, *not* `SNAP_AD`. Snap's own docs state the `optimization_goal`+`conversion_window` combinations "can be used with the Creative type WEB_VIEW and the **Ad type REMOTE_WEBPAGE**". `SNAP_AD` is the bare top-snap-only ad with no attachment. ← **G-2**

**Optional:** `paying_advertiser_name` (inherited from ad account, **immutable**), `third_party_on_swipe_tracking_urls`, `third_party_paid_impression_tracking_urls`, `start_time` (**required for PATCH**), `end_time`.

**Read-only:** `id`, `created_at`, `updated_at`, **`review_status`**, **`review_status_reasons`** (array of strings — the rejection feedback), `delivery_status` (array), `render_type` (`STATIC`|`DYNAMIC`), `deleted`.

**Approved 3rd-party tracking domains (allowlist):** `secure-gl.imrworldwide.com`, `secure-cert.imrworldwide.com`, `pixel.adsafeprotected.com`, `ad.doubleclick.net/ddm/trackclk`, `ad.doubleclick.net/ddm/trackimp`.

**URL macros:** `~.~SERVER_ORG_ID~.~`, `~.~SERVER_AD_ACCOUNT_ID~.~`, `~.~SERVER_CAMPAIGN_ID~.~`, `~.~SERVER_AD_SQUAD_ID~.~`, `~.~SERVER_CREATIVE_ID~.~`, `~.~SERVER_AD_ID~.~`, `~.~SERVER_MOAT_PRODUCT_TYPE~.~`, `~.~TIMESTAMP~.~`.

**Ad endpoints:** POST `/v1/adsquads/{id}/ads` · PUT `/v1/adsquads/{id}/ads` · PATCH `/v1/adsquads/{id}/ads/{ad_id}` · GET `/v1/adsquads/{id}/ads` · GET `/v1/campaigns/{id}/ads` · GET `/v1/adaccounts/{id}/ads` · GET `/v1/ads/{ad_id}` · POST `/v1/adaccounts/{id}/get_ads_by_ids` (**up to 2,000 ads**) · DELETE `/v1/ads/{ad_id}`.

### 4d. Public Profile — `GET https://businessapi.snapchat.com/v1/organizations/{organization_id}/public_profiles?limit=10&cursor=xxxx`
Returns `id`, `organization_id`, `display_name`, `description`, logo URLs. Fails with `AUTHORIZATION_PERMISSION_DENIED` if the user has no Membership in the org. **Snap Public Profile APIs are READ-ONLY** — a profile cannot be created via API; it must exist in Business Manager. Sharing policies can share profiles/pixels across orgs and to ad accounts.

---

## 5. Creative format specs — EXHAUSTIVE

### Media specs table (from Snap's media docs)
| Asset | Resolution | Ratio | Max size | Formats | Duration |
|---|---|---|---|---|---|
| **Top Snap — Video** | **1080×1920 px** | **9:16** | **32 MB** standard (**1 GB** chunked) | **MP4, MOV** | **3 s – 180 s** ⚠ |
| **Top Snap — Image** | **1080×1920 px** | **9:16** | **5 MB** | **PNG, JPG** | n/a |
| App Icon (Snap Ads) | 200–2000 × 2000 px | 1:1 | — | PNG | n/a |
| App Icon (Lens) | 256×256 px | 1:1 | — | PNG | n/a |
| **Preview / Story tile** | **min 360×600 px** | **3:5** | **2 MB** | PNG | n/a |
| Logo | 993×284 px | — | — | PNG | n/a |
| App End Card | 1080×1920 **or** 1920×1080 | varies | **1 MB** | JPG, PNG | n/a |
| Playable | — | — | **5 MB** | ZIP | n/a |
| Chat wallpaper | 1080×1920 | 9:16 | — | IMAGE | n/a |

> ⚠ **Duration discrepancy — resolve at implementation.** Snap's media doc table renders max duration as **1800 s** (30 min); Snap's own business-help/creative guidance and secondary sources say **3–180 s** for a Top Snap. The 1800 s figure most likely covers `LONGFORM_VIDEO`. **Validate to 3–180 s** for the Top Snap lane and confirm live. `[secondary corroboration: Strike Social, Benly, AdNabu]`

### Encoding
- **Video codec:** H.264 `[secondary]`. Container MP4/MOV.
- **Audio: REQUIRED.** 2 channels (L/R), balanced, target **−16 LUFS**. **Silent / text-only video is auto-rejected as "Low-Quality Creative."** `[secondary: AuditSocials, Strike Social]`

### Safe zones (**hard creative constraint**)
- **Top 150 px** — keep free of logos/text/disclaimers (Snap UI chrome).
- **Bottom 150 px** — keep free (CTA/attachment chrome).
- **Bottom 450 px of the hero** — keep free of text/complex visuals for **Collection ads** (product tiles overlay this band).
- Usable safe band on a 1920 px canvas: **y ∈ [150, 1770]** (1620 px tall); for Collection hero: **y ∈ [150, 1470]**.

### Text limits (API-enforced)
| Field | Max |
|---|---|
| `headline` | **34 chars** |
| `brand_name` | **32 chars** |
| `preview_headline` | **55 chars** |
| `app_name` | **30 chars** |
| `name` (campaign/adsquad/ad/creative) | **375 chars** |
| `web_view_properties.url` | **2048 chars**, must be SSL |
| `ad_to_message_properties.message` | **160 chars** |

### Format composition
- **Single Image/Video (Top Snap):** 1 media, 9:16 full-screen, optional attachment (web view / app install / deep link).
- **Collection ad:** **hero + exactly 4 product tiles** (`interaction_zone_id`), each tile tappable; fallback interaction required.
- **Story ad:** **tile image 3:5 (min 360×600, ≤2 MB PNG)** + **3–20 snaps** in the story. `[secondary for the 3–20 count]`
- **Composite:** `creative_ids` **1–20**.

---

## 6. Placements

| Ads Manager name | `snapchat_positions` value | Creative requirement |
|---|---|---|
| **Between Content** (between user Stories / publisher content / creator shows) | `INTERSTITIAL_USER`, `INTERSTITIAL_CONTENT` | 9:16 Top Snap, 3–180 s |
| **Content** (mid-roll inside publisher/creator content) | `INSTREAM` | 9:16, sound-on; `forced_view_setting` applies |
| **Stories** (public Stories in-stream) | `PUBLIC_STORIES_INSTREAM` | 9:16 |
| **Spotlight** (TikTok-like short-video feed; ads between clips) | `INTERSTITIAL_SPOTLIGHT` | 9:16, **native/UGC style strongly favored** |
| **Creator** (mid-roll in Snap Star public Stories) | `INSTREAM` / `PUBLIC_STORIES_INSTREAM` | 9:16 |
| **Feed** (Discover/chat feed surfaces) | `FEED`, `CHAT_FEED` | 9:16 |
| **Camera** | `CAMERA` | AR/Lens-oriented |
| **Post-capture carousel** | `POST_CAPTURE_CAROUSEL` | 9:16 |

- **`AUTOMATIC`** = Snap chooses across all of the above (**recommended default**; maximizes auction liquidity).
- **`CUSTOM`** requires `platforms:["SNAPCHAT"]` + non-empty `snapchat_positions`, and supports `inclusion`/`exclusion` by `content_types` (e.g. `NEWS`, `ENTERTAINMENT`, `GAMING`).
- **Brand safety** is orthogonal: `brand_safety_config.inventory_option` ∈ `FULL_INVENTORY` (max reach) | `LIMITED_INVENTORY` (extra moderation filters).

---

## 7. Validation & review

### Review lifecycle
- **Every ad is reviewed.** Snap "reserves the right to reject or remove any ad **in its sole discretion for any reason**."
- **Ad `review_status`:** `PENDING` → `APPROVED` | `REJECTED`. Rejection detail in **`review_status_reasons`** (array of strings).
- **Creative `review_status`:** `PENDING_REVIEW` | `APPROVED` — **different enum from the ad's.** Also `packaging_status` ∈ `PENDING|SUCCESS|IN_PROGRESS` (media transcode/packaging must reach `SUCCESS`).
- **Review timing:** **3–5 business days** standard; **5–10 business days** for restricted categories. `[secondary: advertiserreview.com, AuditSocials]` (Snap does not publish a hard SLA; Ads Manager historically indicates ~24 h for simple auction ads — **treat as unbounded and poll**.)
- **Editing a creative re-triggers review** and pauses its ads until re-approved.
- **Post-launch review:** Snap conducts reviews **after** ads go live — a live campaign can be paused/removed later.

### DELIVERY GATE (both must hold)
1. Ad `review_status = APPROVED`, **and**
2. A **Public Profile** is attached (`profile_properties.profile_id`) — **mandatory for all advertisers since June 2022**.

Plus: campaign `ACTIVE` + ad squad `ACTIVE` + ad `ACTIVE` (top-down), account `ACTIVE`, funding source `ACTIVE`, and `delivery_status` (array, read-only, at all three levels) free of blockers.

### Prohibited content
Drugs · counterfeit goods · weapons · adult content · misleading financial schemes · hateful/discriminatory/extremist content · deceiving CTAs · cloaking · content encouraging dishonest behavior · **political and issue-based advertising (fully banned** — including indirect mention of candidates, parties, legislation, or social issues) · tobacco/e-cigarettes/vaping (fully prohibited in sponsored AR Lens formats).

### Restricted (allowed only under conditions / in certain regions)
Alcohol · gambling · weight-loss products · HEC (Housing/Employment/Credit — **requires the `regulations` field**) · age-gated verticals (require `targeting.demographics.min_age` gating + additional disclosures).

### Common rejection causes
1. **Silent video / text-only** → "Low-Quality Creative" (**audio is required**).
2. **Low resolution or 'busy' design** → suppressed from Discover feed.
3. **Safe-zone violations** — text/logo under Snap UI chrome (top/bottom 150 px).
4. **`headline`/`brand_name`** over limit, misleading, or mismatched to the Public Profile brand.
5. **Landing page** — broken, non-SSL, cloaked, mismatched to ad claim, excessive interstitials.
6. **Polished studio commercial repurposed from TV/16:9** — reads as non-native and underdelivers.

### Appeal
No documented API appeal path. Appeals go through Ads Manager / Snap support. **`review_status_reasons` is the only machine-readable rejection signal** → must be persisted and surfaced.

---

## 8. World-class best practices

| # | Practice | Exact guidance |
|---|---|---|
| 1 | **Full-screen vertical native** | 9:16 / 1080×1920 only. Non-vertical is "jarring" and wastes canvas (Snap's own wording). |
| 2 | **3–5 s hook** | Snap recommends **3–5 s** for the single image/video placement. Establish the brand moment **before the :02 mark**. **Never** open on a static logo/product frame — open on dynamic footage. |
| 3 | **Total length** | Mirror the bite-sized linear storytelling of organic Snaps — **~5–6 s**. **Snap Ads under 10 s consistently outperform longer cuts** on completion and swipe-up. |
| 4 | **Sound-on, but design for both** | Audio **required** (−16 LUFS, 2 balanced channels). Use voice + music + **captions** so the message lands sound-off too. |
| 5 | **Snap-native, not repurposed** | Lo-fi / creator-led / **UGC** mimicking organic trends beats studio-grade commercials. Speaking-to-camera UGC with Snapchat-inspired features is "significantly stronger at driving view-through." |
| 6 | **Bid strategy ladder** | Launch **`AUTO_BID`** to find the efficient CPA and let the budget spend → once CPA is stable, graduate to **`TARGET_COST`** (volume at a target CPA) or **`LOWEST_COST_WITH_MAX_BID`** (hard ceiling). Use `GET /adaccounts/{id}/spend_guidance` for a recommended bid. **`MIN_ROAS` deprecated 10 Feb 2025.** |
| 7 | **Pixel + CAPI dedup** | Browser pixel + server-side Conversions API with a **shared `event_id`/`client_dedup_id`** so the same conversion isn't double-counted. Improves match quality + signal under ATT. (**Mingla: #865, not #867.**) |
| 8 | **Audiences** | **SAM** (customer-list: email / phone / MAID) for upsell **and as an exclusion** on acquisition; **lookalikes 1–10%** (start **1–3%** for prospecting, widen as you scale) seeded from **high-value** customers; pixel + engagement audiences for retargeting. Layer `enable_targeting_expansion` once seeded. |
| 9 | **Snap's age skew** | Snapchat skews **13–34** (and is the dominant reach platform in that band). Set `min_age` **18** for commerce/alcohol-adjacent, and write creative for a **Gen-Z/young-millennial** register — not a 35+ register. |
| 10 | **Creative refresh** | Test **creative angles, not just edits** — swap hooks, offers, visuals, messages. Refresh before fatigue (Snap's short-form auction burns creative fast); frequency-cap via `cap_and_exclusion_config`. |
| 11 | **Dynamic Ads for catalog** | For catalog-scale inventory, use Dynamic Ads (`product_properties.catalog_id` on the campaign) — auto-generates per-product creative from a feed. |
| 12 | **Placement** | Start `AUTOMATIC` for auction liquidity; only go `CUSTOM` with a proven placement thesis. Keep `FULL_INVENTORY` unless brand safety demands `LIMITED_INVENTORY` (which shrinks reach). |
| 13 | **Structure** | Fewer, better-funded ad squads > many starved squads (min $5/day, but **$5 is a floor, not a strategy**). CBO ($20/day min) once you have ≥3 squads worth comparing. |
| 14 | **Attribution window** | Default `SWIPE_28DAY_VIEW_1DAY`; use `SWIPE_7DAY` for a tighter, more conservative read. |

---

## 9. OUR-ENGINE capability map

Sources: #867 §4.0/§4.3/§4.4 (Snapchat lane), #862 **Amendment A3** (canonical engine model), #866 (creative library).

### What our Snapchat adapter (`_shared/snapchat.ts`) is specced to do
| Capability | Spec'd shape | API-supported? | Verdict |
|---|---|---|---|
| **Auth** — `_shared/snapAuth.ts` `mintSnapAccessToken()` | `POST accounts.snapchat.com/login/oauth2/access_token`, `grant_type=refresh_token`, module-scope cache to `now + (expires_in − 60s)`, fail-close `SnapNotConnectedError` on unset/4xx | ✅ correct | **Solid.** Matches the 3600 s token. No token at rest. |
| **Envelope assertion** — `snapGraph()` | asserts `request_status==='SUCCESS'` **AND** every `sub_request_status==='SUCCESS'`; RT-3 regression test | ✅ correct | **Solid — this is the right contract.** |
| **`connect()`** | `GET /organizations/{org}` + `GET /adaccounts/{acct}` + `GET /organizations/{org}/fundingsources` → `{account_status, currency, timezone, has_funding, min_budget_micro}` | ✅ | **Works.** But does **not** fetch `profile_id` (different host) → G-1. |
| **`createCampaign()`** | `POST /adaccounts/{acct}/campaigns` `{name, status:'PAUSED', start_time, buy_model:'AUCTION', objective_v2_properties:{objective_v2:'TRAFFIC'}, daily_budget_micro?}` | ⚠ | **Field-name bug** — key is `objective_v2_type`, not `objective_v2` → **G-4** |
| **`createAdSet()`** | `POST /campaigns/{id}/adsquads` `{name, type:'SNAP_ADS', targeting:{geos}, billing_event:'IMPRESSION', bid_strategy:'AUTO_BID', optimization_goal, daily_budget_micro\|lifetime_budget_micro, placement_v2:{config:'AUTOMATIC'}, start_time, status:'PAUSED'}` | ⚠ | **Missing REQUIRED `delivery_constraint`** → **G-6**. Targeting = geos only → G-13. |
| **Media upload** | `POST /adaccounts/{acct}/media` (+ upload) → `top_snap_media_id`; #866 `uploadToSnap` uses **`.../media/{id}/upload_from_url`** | ❌ | **`upload_from_url` does not exist** → **G-5** |
| **Creative** | `POST /adaccounts/{acct}/creatives` `{name, type:'WEB_VIEW', top_snap_media_id, headline, brand_name, profile_properties:{profile_id}, web_view_properties:{url:dest_smart_link}, call_to_action:'VIEW_MORE'}` | ⚠ | **`VIEW_MORE` is not a valid CTA** → **G-3**. `profile_id` unconfirmed → **G-1** |
| **`createAd()`** | `POST /adsquads/{id}/ads` `{name, creative_id, type:'SNAP_AD', status:'PAUSED'}` | ❌ | **Wrong ad type** — WEB_VIEW creative needs **`REMOTE_WEBPAGE`** → **G-2** |
| **`setStatus()`** | `PUT /adaccounts/{acct}/campaigns` `{campaigns:[{id,status}]}`; top-down campaign→squad→ad | ✅ | **Correct** — PUT-to-parent-collection is right |
| **`getStatus()`** | `GET /campaigns/{id}` + `GET /ads/{id}` → `{status, review_status}` | ⚠ | Works, but drops **`review_status_reasons`** + `delivery_status` → G-9 |
| **Compensating delete** | `DELETE /campaigns/{id}` "Snapchat cascades child squad/ad/creative" | ⚠ | Cascade to **creative/media is unverified** — those are **ad-account-scoped**, so they almost certainly survive → G-14 |
| **Persistence** | `ad_connections` / `ad_campaigns` / `ad_sets` / `ads` / `ad_status_events`; RLS admin-read, service-role write | ✅ | Sound |
| **Fail-close / no-orphan / authz** | 424 `snapchat_not_connected`, 422 `budget_below_minimum`, 422 `destination_not_public`, 502 `ad_create_failed`, `is_admin_user()` on every write, RT-1..RT-4 | ✅ | **Excellent** — genuinely strong invariants |

### Provisioning state
| Item | State |
|---|---|
| Org / ad account / funding / pixel / OAuth app / refresh token | ✅ **live-probed ACTIVE** 2026-07-14 |
| Secrets `SNAPCHAT_REFRESH_TOKEN` / `_CLIENT_ID` / `_CLIENT_SECRET` | ✅ set (Function Secrets only) |
| **Public Profile `profile_id`** | ❌ **UNCONFIRMED** (#867 §7 Snap-3, OD-5) — **live-fire blocker** |

### API-supported but NOT in our engine at all
Lifetime budgets at campaign level (`lifetime_spend_cap_micro`) · CBO `shared_properties`/`pacing_level` · `bid_micro` + `TARGET_COST`/`LOWEST_COST_WITH_MAX_BID` · `pacing_type` · demographics/interests/devices/audiences targeting · SAM/lookalike/custom audiences · `placement_v2 CUSTOM` · `conversion_window` · `cap_and_exclusion_config` (frequency cap) · `brand_safety_config` · `ad_scheduling_config` · R&F/`RESERVED` buy model · Dynamic Ads (`product_properties.catalog_id`) · Collection/Story/Lead-Gen/Composite creatives · `top_snap_crop_position` · `forced_view_eligibility` · 3rd-party tracking URLs + macros · `spend_guidance` bid recommendations · chunked upload · `get_*_by_ids` batch reads.

---

## 10. GAPS & engineering implications

**Ranking:** **High** = blocks live-fire or silently burns money / breaks the create. **Med** = correctness/coverage risk. **Low** = optimization.

### HIGH

**G-1 — Public Profile `profile_id` unconfirmed AND on a different host. [BLOCKER]**
Creatives **require** `profile_properties.profile_id`; Public Profiles are **mandatory for all Snap advertisers since June 2022**. Our spec flags it "CONFIRM before live-fire" (Snap-3 / OD-5) and never resolves it. Worse: the lookup is `GET https://businessapi.snapchat.com/v1/organizations/{org}/public_profiles` — a **different base URL** from `snapGraph()`'s hardcoded `https://adsapi.snapchat.com/v1`. **Public Profile APIs are read-only** — if no profile exists for "Usemingla", it must be created **manually in Business Manager**; no code path can provision it.
→ **Build:** a second base URL in `snapGraph` (`{ host: 'ads'|'business' }`); resolve `profile_id` during `connect()` and persist to `ad_connections.profile_or_page_id`; **fail-close `snapchat_profile_missing` (424)** at create if null — never attempt a creative without it. Add to the connect AC.

**G-2 — Ad `type` is wrong: `SNAP_AD` should be `REMOTE_WEBPAGE`.**
Our `createAd()` hardcodes `type:'SNAP_AD'` while the creative is `type:'WEB_VIEW'`. Snap's docs pair **WEB_VIEW creative ↔ REMOTE_WEBPAGE ad**; `SNAP_AD` is the attachment-less top-snap. Best case the create 400s (loud); worst case it creates an ad with **no swipe-up attachment** — meaning **we pay for impressions that can never reach the destination page**. That is the entire point of the Full-Rooms engine, silently defeated.
→ **Build:** a creative-type→ad-type map (`WEB_VIEW→REMOTE_WEBPAGE`, `APP_INSTALL→APP_INSTALL`, `DEEP_LINK→DEEP_LINK`, `COLLECTION→COLLECTION`, `LEAD_GENERATION→LEAD_GENERATION`); never hardcode. Assert in a unit test.

**G-3 — `call_to_action:'VIEW_MORE'` is not in any CTA enum.**
Our creative body sends `VIEW_MORE`; the `WEB_VIEW` enum has **23** values and `VIEW_MORE` is not among them (`MORE` and `VIEW` are). Creative create will reject.
→ **Build:** a per-creative-type CTA allowlist (exact 23 values for `WEB_VIEW`), validated **before** the provider call → 422 `invalid_cta`. Default to **`BOOK_NOW`** or **`BUY_TICKETS`** for reservation traffic (far higher intent than `MORE`); expose the enum as an admin select, not a free string.

**G-4 — `objective_v2_properties.objective_v2` is the wrong key — it's `objective_v2_type`.**
Both #867 §4.0 and the `createCampaign` body use `objective_v2`. Docs: `objective_v2_properties: { objective_v2_type, promotion_type }`. Campaign create will either 400 or silently fall through to the deprecated translator default.
→ **Build:** correct the key; add `promotion_type` as optional (evaluate **`PROMOTE_PLACES`** — semantically exact for a venue product, see G-16).

**G-5 — Media upload flow does not exist as designed (`upload_from_url`), and 32 MB/chunking is unhandled.**
#866's `uploadToSnap` posts `.../media/{id}/upload_from_url` with a **Bunny Stream URL**. **Snap documents no `upload_from_url`.** The real paths are `POST /media/{id}/upload` (**`multipart/form-data`, ≤32 MB**) and `POST /media/{id}/multipart-upload-v2` (**INIT→ADD→FINALIZE, >32 MB, max 32×32 MB = 1 GB**). Compounding: **Bunny Stream serves HLS**, not a single downloadable MP4 — so there is no URL to hand Snap even if the endpoint existed.
→ **Build:** (a) resolve a **direct MP4 rendition** from Bunny (or keep an MP4 master in Supabase Storage); (b) **stream the bytes** into a `multipart/form-data` POST from the edge function; (c) **branch to chunked upload at >32 MB** with INIT/ADD/FINALIZE + per-chunk retry; (d) **poll `media_status` until `READY`** before creating the creative (a creative referencing a `PENDING_UPLOAD` media will fail); (e) poll creative `packaging_status` → `SUCCESS`. **This is the single largest under-scoped work item in the Snap lane.** Note Deno edge memory/time limits — a 1 GB chunked upload may need a different runtime.

**G-6 — `delivery_constraint` is REQUIRED and absent from our `createAdSet()` body.**
Ad squad create will reject (or mis-pace).
→ **Build:** derive it from the budget field — `daily_budget_micro → DAILY_BUDGET`, `lifetime_budget_micro → LIFETIME_BUDGET`; assert exactly one budget field is set (422 `budget_ambiguous`); never allow both.

**G-7 — Budget-unit contradiction across our own specs: A3 says CENTS, #867 says MICRO.**
#862 **A3** (declared *canonical*, and the model #863/#866/#867 all depend on) pins: *"budgets are stored in **cents** (adapters convert to micro/dollars at the boundary — not #867's `budget_micro`)"*. #867's schema ships `budget_micro bigint` and its ACs assert micro. Two adapters written to two conventions = an off-by-**10,000×** budget bug. $5.00 stored as `500` cents but sent raw as micro = `$0.0005` (below every minimum → reject); or `5000000` micro read as cents = **$50,000**. This is the classic money-units failure and it is **live**, on an account with a **$15,000/day** funding limit.
→ **Build:** pick ONE (recommend **A3/cents** as canonical since it's the declared canonical model and Meta/TikTok also aren't micro-native). Store `budget_cents bigint`. Convert **only** at the adapter boundary: `micro = cents × 10_000`. **Add a unit test asserting `$5.00 → 5000000 micro` and `$20.00 → 20000000 micro`**, and a min-check **in micro after conversion**. File a `SPEC_AMENDMENT_ISSUE-867` to reconcile.

**G-8 — Zero creative validation. We can upload anything.**
Nothing in #866/#867 validates aspect ratio, resolution, size, duration, or audio. #866 stores `width/height/aspect_ratio/duration_seconds` but **enforces nothing**, and #864's image cap is **≤30 MB** — **6× Snap's 5 MB image limit**. A 16:9 landscape asset from the ad library will be accepted, uploaded, and **rejected by Snap days later** (3–5 business days), or worse, cropped into garbage by `top_snap_crop_position:OPTIMIZED` and served.
→ **Build** a `validateSnapCreative()` gate rejecting **before** upload, with exact numbers:
  - ratio **9:16** (`|w/h − 0.5625| ≤ 0.01`) → 422 `invalid_aspect_ratio`
  - resolution **1080×1920** (reject < 1080×1920) → 422 `invalid_resolution`
  - image **≤ 5 MB**, **PNG/JPG** → 422 `image_too_large`
  - video **≤ 32 MB** standard / **≤ 1 GB** chunked, **MP4/MOV**, **H.264** → 422 `video_too_large`
  - duration **3–180 s** (confirm the 1800 s doc discrepancy live) → 422 `invalid_duration`
  - **audio stream present** (silent = guaranteed "Low-Quality Creative" rejection) → 422 `missing_audio`
  - Story tile **3:5, ≥360×600, ≤2 MB PNG**; end card **≤1 MB**; playable **≤5 MB ZIP**

**G-9 — `review_status_reasons` is never captured; no review polling.**
`ads.review_status` is persisted, but **`review_status_reasons`** (the *only* machine-readable rejection explanation) and `delivery_status` (array, all 3 levels) are dropped. Sync is **manual/admin-triggered** — a `REJECTED` ad sits undetected indefinitely, and an `APPROVED` one isn't noticed either. Snap also **re-reviews post-launch** and can pause a live campaign.
→ **Build:** persist `review_status_reasons jsonb` + `delivery_status jsonb` on `ads`/`ad_sets`/`ad_campaigns`; a **cron-driven `admin-ad-campaign-sync`** (every 30–60 min while any ad is `PENDING`, then daily for post-launch re-review); surface reasons verbatim in SC-6; alert on `REJECTED`. Also handle the **creative** enum `PENDING_REVIEW|APPROVED` ≠ the **ad** enum `PENDING|APPROVED|REJECTED` — two different vocabularies, both needed.

### MED

**G-10 — Platform-enum + env-var contradictions across specs.** #866 uses `platform IN ('meta','tiktok','snap','google')` and env `SNAP_ACCESS_TOKEN` (a *static* token); #867 + A3 use **`'snapchat'`** and the **refresh-token mint** (`SNAPCHAT_REFRESH_TOKEN`/`_CLIENT_ID`/`_CLIENT_SECRET`) — **there is no static Snap access token**; it's minted per-call and expires in 3600 s. A3 also pins `external_*_id` over #867's `provider_*`, and `auth_kind ∈ ('system_user_token','refresh_token','dev_token_oauth')`. If #866 lands first, `uploadToSnap` reads a secret that will never exist and fails closed forever. → **Build:** reconcile to A3 (`'snapchat'`, `external_*_id`, `refresh_token`); `uploadToSnap` must call `mintSnapAccessToken()`; RT-4 strict-grep must cover the **real** names. Amendment required.

**G-11 — No length validation on `headline`(34) / `brand_name`(32) / `name`(375) / `url`(2048).** SC-5 mentions "headline ≤34, brand name ≤32" as a **UI hint only**; the edge function doesn't enforce. → **Build:** server-side validation → 422 `headline_too_long` etc. Note `brand_name` **defaults to the Public Profile's brand name** — leaving it null is often *safer* (guarantees policy match).

**G-12 — `web_view_properties.url` SSL + 2048-char cap unchecked against `dest_smart_link`.** OneLink URLs with attribution params get long. → **Build:** assert `https://` + `length ≤ 2048` before create → 422.

**G-13 — Targeting is geos-only; no audience builder.** No demographics/interests/devices/SAM/lookalikes/expansion. Snap's **13–34 skew** means an untargeted `geos:[{country_code:'us'}]` squad serves heavily to minors — a real problem for a venue/reservation product (and a policy risk for anything alcohol-adjacent). → **Build:** at minimum `demographics:[{min_age:'18', max_age:'34'}]` as the default; then interests (SLC per country), devices, and a SAM/lookalike builder. **Med now, High before meaningful spend.**

**G-14 — Compensating-delete cascade is unverified for creative/media.** `DELETE /campaigns/{id}` plausibly cascades squads/ads, but **creatives and media are ad-account-scoped** and almost certainly survive → orphaned creatives accumulate on every failed create. Our own I-PROPOSED-AD-NO-ORPHAN-WRITE covers **DB** rows, not **provider-side** orphans. → **Build:** track created creative/media ids in the rollback path; verify cascade live; if not cascaded, delete explicitly or record in `ad_status_events.provider_ids` for reconciliation.

**G-15 — `bid_micro` min 10,000 unvalidated; no `spend_guidance`.** Only `AUTO_BID` is spec'd (so `bid_micro` is correctly omitted today), but the moment `TARGET_COST`/`LOWEST_COST_WITH_MAX_BID` is exposed, min **10,000** and the per-currency max (**USD 500,000,000**) need enforcing, and `ACCELERATED` pacing's 3-way constraint applies. → **Build:** validate on introduction; wire `GET /adaccounts/{id}/spend_guidance` into the admin form as a recommended bid.

**G-16 — `promotion_type: PROMOTE_PLACES` unevaluated.** Snap has a promotion type *literally named for* our product shape (venues/places). It changes the Ads-Manager business logic and available optimization goals. → **Build:** evaluate `TRAFFIC` + `PROMOTE_PLACES` vs bare `TRAFFIC` during live-fire.

**G-17 — `LANDING_PAGE_VIEW` default may not deliver without the pixel.** #867 OD-4 defaults to `LANDING_PAGE_VIEW`, but that goal needs `pixel_id` **and** a firing pixel — and **pixel install is #865, not #867**. Optimizing to an event we don't yet send = no/erratic delivery. → **Build:** default **`SWIPES`** until #865's pixel is live; gate `LANDING_PAGE_VIEW`/`PIXEL_*` in the UI on `pixel_installed`; pass `pixel_id` (`af5f8fc4-…`) whenever such a goal is chosen. (#867 OD-4 notes this but still recommends the pixel-dependent default — flip it.)

**G-18 — No safe-zone enforcement or preview.** Top/bottom **150 px** (and **bottom 450 px** for Collection heroes) must stay clear; violations are a top rejection cause and no API field expresses them — it's pure pixel policy. → **Build:** a safe-zone overlay in the #866 creative preview (mark `y<150` and `y>1770` on the 1920 canvas); optional automated text-detection in those bands; a documented checklist gate. Also expose `top_snap_crop_position` (`OPTIMIZED` default silently crops off-ratio media).

### LOW

- **G-19 — No `lifetime_spend_cap_micro`.** Min **20,000,000**; reducible only if the new cap **> 1.1× already spent**. A cheap hard ceiling on a live $15k/day account — worth having as a safety rail.
- **G-20 — No frequency cap** (`cap_and_exclusion_config`; incompatible with multi-format delivery in Auction) → creative burn.
- **G-21 — No `conversion_window`** (`SWIPE_28DAY_VIEW_1DAY` default | `SWIPE_7DAY`).
- **G-22 — No `brand_safety_config`** (`FULL_INVENTORY` | `LIMITED_INVENTORY`).
- **G-23 — No `ad_scheduling_config`** (dayparting) — high value for venue/nightlife traffic.
- **G-24 — No `placement_v2: CUSTOM`** — can't isolate Spotlight vs Between-Content to test.
- **G-25 — No Dynamic Ads / catalog** (`product_properties.catalog_id`; probe showed `catalogs:[]`) — the natural end-state for many venues/events.
- **G-26 — No Collection / Story / Lead-Gen / Composite creatives** (only single-image/video WEB_VIEW).
- **G-27 — No 3rd-party tracking URLs / macros** (`~.~SERVER_CAMPAIGN_ID~.~` etc.) — restricted to Snap's 5-domain allowlist anyway.
- **G-28 — No batch reads** (`get_campaigns_by_ids` / `get_ads_by_ids` up to **2,000**) — sync will N+1 as volume grows.
- **G-29 — No `paging.next_link` handling** — reads silently truncate at the first page once >1 page of entities exists.
- **G-30 — Legacy `objective` still referenced conceptually** — deprecated, translator-defaulted since **21 Mar 2025**. Ensure it's never sent.

### Every field WE must collect + validate (admin form → edge contract)
| Field | Validation |
|---|---|
| `name` | ≤375, non-empty |
| `objective_v2_type` | enum(5); default `TRAFFIC` |
| `promotion_type` | enum(4), optional; evaluate `PROMOTE_PLACES` |
| `budget.level` | `campaign`(CBO) \| `adset`(ABO); **mutually exclusive** |
| `budget.type` | `daily` \| `lifetime` → sets `delivery_constraint` |
| `budget.amount` | **cents** (A3); → micro at boundary; **≥5,000,000 micro** (squad) / **≥20,000,000 micro** (campaign) |
| `start_time`/`end_time` | ISO-8601; `end > start` |
| `optimization_goal` | enum(18); gate pixel-dependent goals on `pixel_installed` |
| `bid_strategy` | enum(3 live); `bid_micro` required unless `AUTO_BID`; ≥10,000; ≤500,000,000 (USD) |
| `targeting.geos` | ≥1 country_code (lowercase) |
| `targeting.demographics` | `min_age` default **"18"**; genders; languages |
| `placement_v2` | `AUTOMATIC` default; `CUSTOM` ⇒ `platforms` + non-empty `snapchat_positions`(9) |
| `pixel_id` | required for `PIXEL_*`/`LANDING_PAGE_VIEW` |
| `creative.headline` | **≤34** |
| `creative.brand_name` | **≤32**, optional (defaults to Public Profile) |
| `creative.call_to_action` | per-type enum (23 for WEB_VIEW); **no `VIEW_MORE`** |
| `creative.type` | `WEB_VIEW` → ad type **`REMOTE_WEBPAGE`** |
| `profile_id` | **required**; fail-close if null |
| `web_view_properties.url` | `https://`, **≤2048** |
| media | 9:16 · 1080×1920 · img ≤5 MB PNG/JPG · vid ≤32 MB (1 GB chunked) MP4/MOV H.264 · 3–180 s · **audio required** · safe zones 150/150 (450 Collection hero) |

### Recommended build order
1. **G-1** profile_id + second host (unblocks live-fire) → **G-2/G-3/G-4/G-6** (4 one-line correctness fixes that decide whether create works at all) → **G-7** budget units (money bug) → **G-5** real media upload → **G-8** creative validation → **G-9** review polling.
2. Then G-10..G-18 (spec reconciliation, targeting, safe zones, pixel-gated goals).
3. Then the LOW backlog as spend scales.

> **Sharpest single point:** G-2/G-3/G-4/G-6 mean the specced Snapchat create sequence **cannot succeed as written** — four separate field-level errors across campaign, ad squad, creative, and ad. They're individually trivial to fix, but they invalidate #867's "buildable + live-fireable now" claim until corrected. G-7 (cents-vs-micro, 10,000×) and G-1 (Public Profile) are the two that could respectively **burn real money** on a $15k/day-limit account and **hard-block** the first live ad.

---

**Research-only confirmation:** every Snap interaction in this document is documentation reading (WebSearch/WebFetch) plus reads of our own spec files. **No Snapchat API call of any kind was issued — no POST, PUT, PATCH, or DELETE, and no create of any campaign, ad squad, ad, creative, or media.** Snap has no MCP; nothing was authenticated against `adsapi.snapchat.com` or `businessapi.snapchat.com`. All live IDs/values quoted are transcribed from #867's pre-existing 2026-07-14 read-only probe record.
