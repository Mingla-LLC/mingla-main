# Google Ads — Full Paid Pipeline Reference vs. Mingla Ad Engine Capability

**Mode:** RESEARCH-ONLY. No Google Ads API mutation was performed. No write/create/update/remove call was issued. Every Google fact below is from official docs or the published protobuf source; every Mingla fact is from our specs + the repo working tree.
**Date:** 2026-07-14 · **API version current:** **v24.2** (released 2026-06-24)
**Our account:** MCC `8284700017` · customer `5083048929` · Cloud project `mingla-ads-engine` (904622604544) · dev token **TEST tier** · Basic-access application **PENDING**.

> **Read §9–§10 first if you are deciding what to build.** The single most consequential finding is not a missing feature — it is that **three separate spec assumptions are wrong** (API version, the video-upload dead-end, and the access tier that actually unblocks us), and that our engine's Meta-shaped `ChannelAdapter` **structurally cannot express a valid Google Search ad**.

---

## 0. Sources

All fetched live 2026-07-14. Reference pages (`/reference/rpc/...`) are JS-rendered and return only nav menus to a fetcher; **enum values below were taken from the published protobuf source** (`googleapis/googleapis`, Apache-2.0), which is the same source those pages are generated from, and is authoritative.

**Google Ads API (developers.google.com/google-ads/api)**
- Release notes / versioning: `/docs/release-notes`, `/docs/sunset-dates`; blog `Announcing v24.2 of the Google Ads API` (2026-06-24)
- Access + quotas: `/docs/api-policy/access-levels`, `/docs/best-practices/quotas`, `/docs/api-policy/developer-token`, `/docs/productionize/access-levels`, `/docs/api-policy/rmf`, `/docs/best-practices/test-accounts`, `/docs/best-practices/testing`
- Mutate/errors: `/docs/best-practices/understand-api-errors`, `/docs/best-practices/partial-failures`, `/docs/get-started/common-errors`, `/docs/samples/handle-rate-exceeded-error`
- Assets: `/docs/assets/overview`, `/docs/assets/working-with-assets`, **`/docs/assets/upload-videos`** (the decisive page — see §5.3)
- PMax: **`/performance-max/asset-requirements`** (authoritative asset table)
- Policy: `/docs/policy-exemption/overview`, `/docs/policy-exemption/ads`, `/docs/policy-exemption/keywords`, `/docs/samples/get-all-disapproved-ads`
- Geo: `/docs/data/geotargets`, `/docs/targeting/location-targeting`
- **Protobuf source:** `raw.githubusercontent.com/googleapis/googleapis/master/google/ads/googleads/v21/{enums,errors,common}/*.proto`
- **Geo CSV (downloaded + parsed):** `developers.google.com/static/google-ads/api/data/geo/geotargets-2026-07-06.csv.zip` — 273,644 rows

**Google Ads Help / Policy (support.google.com)**
- RSA specs `answer/7684791`; RDA specs `answer/17090561`; PMax specs `answer/17091269`; PMax image `answer/14530211`; PMax video `answer/14528532`; PMax video automation `answer/16048023`; Demand Gen `answer/13695777`, `answer/17140672`, `answer/17141078`, `answer/13704860`; uploaded display `answer/1722096`; account limits `answer/6372658`; Ad Strength `answer/9142254`, `answer/9921843`, `answer/14143250`; RSA best practice `answer/6167122`; Smart Bidding `answer/7065882`, `answer/6268637`; Maps `answer/7040605`; Display network `answer/2404190`; PMax channels `answer/16260129`
- Policy: `adspolicy/answer/6008942` (taxonomy), `6020955` (misrepresentation), `6021546` (editorial), `14847994`, `14848295`, `6368661` (destination), `16428020`, `16428019`, `6118` (trademarks), `10347108` (image formats), `15938075` (circumventing systems), `9338593` (appeals), `1722120` (review process)
- YouTube Data API (for the rejected alternative): `/youtube/v3/determine_quota_cost`, `/youtube/v3/docs/videos/insert`

**Mingla internal (read-only)**
- `~/Desktop/mingla-orchs/issue-862-meta-ads-api/Mingla_Artifacts/specs/SPEC_ISSUE-862_META_ADS_CAMPAIGN_ENGINE.md` — **Amendment A3** = canonical engine model (lines 43–211)
- `~/Desktop/mingla-orchs/issue-867-snapchat-google-channels/Mingla_Artifacts/specs/SPEC_ISSUE-867_SNAPCHAT_GOOGLE_CHANNELS.md` — Google lane §4.0b, §7, OD-7/OD-8
- `~/Desktop/mingla-orchs/issue-866-creative-library/Mingla_Artifacts/specs/SPEC_ISSUE-866_CREATIVE_LIBRARY.md` — `uploadToGoogle`, OD-2
- `~/Desktop/mingla-orchs/issue-864-campaign-builder-ui/Mingla_Artifacts/specs/SPEC_ISSUE-864_CAMPAIGN_BUILDER_UI.md` — builder payload §4.4
- Repo `/Users/sethogieva/Desktop/mingla-main` — **verified: zero Google/ad-engine code exists on `main`** (`grep -rl "GOOGLE_ADS_" .` → 0 hits; `grep -rl "googleads.googleapis" .` → 0 hits; no `ad_connections`/`ad_campaigns` migration; no `admin-ad-*`/`admin-meta-*` function). The engine is **spec-only**.
- Scratchpad `google_ads_api_design_doc.html` — the Basic-access application (prepared 2026-07-14); `google_token_resp.json` — contains `{"error":"invalid_grant"}` (see §9.4)

---

## 1. Object hierarchy, resource names, mutate mechanics, GAQL

### 1.1 Hierarchy

```
Manager account (MCC)  customers/8284700017        ← login-customer-id header; never holds ads itself
  └── Customer (advertiser)  customers/5083048929  ← every mutate targets THIS id in the URL path
        ├── CampaignBudget          (shared or single; MUST exist before the campaign)
        ├── Campaign                → references campaign_budget by resource name
        │     ├── CampaignCriterion (location, language, device, ad_schedule, negative keywords,
        │     │                      proximity, brand lists, audiences at campaign level)
        │     ├── AdGroup                                   [SEARCH / DISPLAY / VIDEO / DEMAND_GEN]
        │     │     ├── AdGroupCriterion  (keyword, audience, age_range, gender, placement, topic…)
        │     │     ├── AdGroupAd → Ad    (responsive_search_ad | responsive_display_ad | …)
        │     │     └── AdGroupAsset      (asset links scoped to the ad group)
        │     ├── AssetGroup                               [PERFORMANCE_MAX ONLY — replaces AdGroup+Ad]
        │     │     ├── AssetGroupAsset   (asset ←→ field_type: HEADLINE, MARKETING_IMAGE, …)
        │     │     └── AssetGroupSignal  (audience + search themes)
        │     └── CampaignAsset           (sitelinks/callouts/etc. at campaign level)
        ├── Asset                   (account-scoped, reusable: ImageAsset, YoutubeVideoAsset, Text…)
        └── CustomerAsset           (account-level asset links)
```

**The PMax fork is structural, not cosmetic.** A `PERFORMANCE_MAX` campaign has **no ad groups and no ads**. It has `AssetGroup` + `AssetGroupAsset` + `AssetGroupSignal`. Any adapter modelled as `campaign → adGroup → adGroupAd` **cannot create a PMax campaign at all** — see §10 GAP-2.

### 1.2 Resource-name formats (exact)

| Resource | Format | Note |
|---|---|---|
| Customer | `customers/{customer_id}` | digits only, **no dashes** (`5083048929`, not `508-304-8929`) |
| CampaignBudget | `customers/{cid}/campaignBudgets/{budget_id}` | |
| Campaign | `customers/{cid}/campaigns/{campaign_id}` | |
| CampaignCriterion | `customers/{cid}/campaignCriteria/{campaign_id}~{criterion_id}` | **tilde composite** |
| AdGroup | `customers/{cid}/adGroups/{ad_group_id}` | |
| AdGroupCriterion | `customers/{cid}/adGroupCriteria/{ad_group_id}~{criterion_id}` | **tilde composite** |
| AdGroupAd | `customers/{cid}/adGroupAds/{ad_group_id}~{ad_id}` | **tilde composite** |
| Ad | `customers/{cid}/ads/{ad_id}` | |
| Asset | `customers/{cid}/assets/{asset_id}` | |
| AssetGroup | `customers/{cid}/assetGroups/{asset_group_id}` | |
| AssetGroupAsset | `customers/{cid}/assetGroupAssets/{asset_group_id}~{asset_id}~{field_type}` | **triple tilde** |
| GeoTargetConstant | `geoTargetConstants/{criterion_id}` | **global, not customer-scoped** |
| LanguageConstant | `languageConstants/{criterion_id}` | global |

> The `~` composites are a real parsing hazard: `ads.external_ad_id` in our schema is a `text` column, and the value we must store to address an ad again is `{ad_group_id}~{ad_id}`, not the bare ad id.

### 1.3 `googleAds:mutate` — atomic, with temp IDs

`POST https://googleads.googleapis.com/v24/customers/{cid}/googleAds:mutate`

```jsonc
{
  "mutateOperations": [
    { "campaignBudgetOperation": { "create": {
        "resourceName": "customers/5083048929/campaignBudgets/-1",   // TEMP ID (negative)
        "name": "Mingla — budget — 2026-07-14",
        "amountMicros": "20000000",                                   // $20.00
        "deliveryMethod": "STANDARD",
        "explicitlyShared": false } } },
    { "campaignOperation": { "create": {
        "resourceName": "customers/5083048929/campaigns/-2",
        "name": "Mingla — Event — 2026-07-14",
        "status": "PAUSED",
        "advertisingChannelType": "SEARCH",
        "campaignBudget": "customers/5083048929/campaignBudgets/-1",  // ← chains the temp id
        "maximizeConversions": {},
        "networkSettings": { "targetGoogleSearch": true, "targetSearchNetwork": false,
                             "targetContentNetwork": false, "targetPartnerSearchNetwork": false },
        "startDate": "20260715", "endDate": "20260815" } } },
    { "adGroupOperation": { "create": {
        "resourceName": "customers/5083048929/adGroups/-3",
        "name": "…", "campaign": "customers/5083048929/campaigns/-2",
        "status": "ENABLED", "type": "SEARCH_STANDARD", "cpcBidMicros": "1000000" } } },
    { "adGroupAdOperation": { "create": {
        "adGroup": "customers/5083048929/adGroups/-3",
        "status": "PAUSED",
        "ad": { "finalUrls": ["<dest_smart_link>"],
                "responsiveSearchAd": { "headlines": [...], "descriptions": [...] } } } } }
  ],
  "partialFailure": false,     // false ⇒ ALL-OR-NOTHING (this is what we want)
  "validateOnly": false,
  "responseContentType": "MUTABLE_RESOURCE"
}
```

**Temp-ID rules:** negative integers in place of the id segment; **unique within one request**; must be **defined before referenced** (declaration order matters); only valid inside `googleAds:mutate`. Reusing an id across two mutates in one request → `MutateError.ID_EXISTS_IN_MULTIPLE_MUTATES (7)`.

**Atomicity:** with `partial_failure=false`, if any operation fails **the entire request is rolled back** and nothing is created. **This is a native no-orphan guarantee** — it satisfies our `I-PROPOSED-AD-NO-ORPHAN-WRITE` invariant *at the provider level*, so the Google adapter needs **no compensating-delete path** (unlike Snapchat's `DELETE /campaigns/{id}`). With `partial_failure=true`, successful ops commit and per-op errors return in `partial_failure_error`. **Google is the only one of our five channels that gives atomicity for free.**

**Limits:** max **10,000** mutate operations/request (`TOO_MANY_MUTATE_OPERATIONS`); max **100** "action" operations/request (`TOO_MANY_ACTION_OPERATIONS`); gRPC response payload cap **64 MB**.

**Per-service mutate endpoints** (non-atomic across services): `campaignBudgets:mutate`, `campaigns:mutate`, `adGroups:mutate`, `adGroupAds:mutate`, `adGroupCriteria:mutate`, `campaignCriteria:mutate`, `assets:mutate`, `assetGroups:mutate`, `assetGroupAssets:mutate`, `assetGroupSignals:mutate`.

### 1.4 Reads — GAQL

`POST customers/{cid}/googleAds:search` (paged) · `POST customers/{cid}/googleAds:searchStream` (streamed, no paging — preferred for reports).

```sql
SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type,
       campaign_budget.amount_micros, metrics.impressions, metrics.clicks, metrics.cost_micros
FROM campaign
WHERE campaign.status != 'REMOVED' AND segments.date DURING LAST_30_DAYS
ORDER BY metrics.cost_micros DESC
LIMIT 100
```
Grammar: `SELECT … FROM <single resource> [WHERE …] [ORDER BY …] [LIMIT n] [PARAMETERS …]`. **No JOINs** — implicit attribution only via the resource's own related fields. `IN` clause cap **20,000** items (`FILTER_HAS_TOO_MANY_VALUES`).

### 1.5 Headers (every request)

| Header | Value | Note |
|---|---|---|
| `Authorization` | `Bearer <oauth access token>` | minted from refresh token, scope `https://www.googleapis.com/auth/adwords` |
| `developer-token` | 22-char token from API Center | **tier-gated — see §7.1** |
| `login-customer-id` | `8284700017` (our MCC, **no dashes**) | required when operating through a manager; omitting → `USER_PERMISSION_DENIED` |
| `linked-customer-id` | (n/a for us) | only for third-party linked accounts |

---

## 2. Campaign level — every field

### 2.1 `advertising_channel_type` (verbatim, from `advertising_channel_type.proto`)

`UNSPECIFIED=0` · `UNKNOWN=1` · **`SEARCH=2`** · **`DISPLAY=3`** · `SHOPPING=4` · `HOTEL=5` · **`VIDEO=6`** · `MULTI_CHANNEL=7` (App campaigns) · `LOCAL=8` · `SMART=9` · **`PERFORMANCE_MAX=10`** · `LOCAL_SERVICES=11` · `TRAVEL=13` · **`DEMAND_GEN=14`**

> `12` is absent: the old `DISCOVERY=12` was **superseded by `DEMAND_GEN=14`**. Any code or spec written against `DISCOVERY` is stale. There is **no `APP` value** — App campaigns are `MULTI_CHANNEL=7` + `advertising_channel_sub_type=APP_CAMPAIGN=12`.

`advertising_channel_sub_type` (selected): `SEARCH_MOBILE_APP=2`, `DISPLAY_MOBILE_APP=3`, `SHOPPING_SMART_ADS=6`, `DISPLAY_GMAIL_AD=7`, `DISPLAY_SMART_CAMPAIGN=8` (no new creates), `VIDEO_ACTION=10`, `VIDEO_NON_SKIPPABLE=11`, `APP_CAMPAIGN=12`, `APP_CAMPAIGN_FOR_ENGAGEMENT=13`, `LOCAL_CAMPAIGN=14`, `SHOPPING_COMPARISON_LISTING_ADS=15`, `SMART_CAMPAIGN=16`, `VIDEO_SEQUENCE=17`.

### 2.2 `campaign_budget`

| Field | Type / values | Notes |
|---|---|---|
| `name` | string | must be **unique per account** |
| `amount_micros` | int64 | **MICROS = currency × 1,000,000.** $20.00 → `20000000`. USD account. |
| `total_amount_micros` | int64 | lifetime total (campaign must set an end date) |
| `delivery_method` | `STANDARD=2` \| `ACCELERATED=3` | `ACCELERATED` is **effectively retired** for Search/Shopping/Display — use `STANDARD` |
| `explicitly_shared` | bool | `false` = single-campaign budget (our case); `true` = shared across campaigns |
| `period` | `DAILY` \| `CUSTOM_PERIOD` | |
| `has_recommended_budget`, `recommended_budget_amount_micros` | read-only | |

**Spend mechanics (Google-published, exact):** a campaign may spend **up to 2× the average daily budget** on any single day; monthly charges never exceed **average daily budget × 30.4** (365÷12). $10/day → **$304/month** hard ceiling; overage is refunded as an overdelivery credit.

### 2.3 Bidding strategies

Set **either** a standard strategy inline on the campaign (a `oneof`) **or** a portfolio `bidding_strategy` resource — never both.

| Strategy | Campaign field | Key sub-fields | Requires conversions? |
|---|---|---|---|
| Maximize Conversions | `maximize_conversions` | `target_cpa_micros` (optional) | recommended entry Smart Bidding; no hard minimum |
| Maximize Conversion Value | `maximize_conversion_value` | `target_roas` (double, e.g. `3.5`) | yes |
| Target CPA | `target_cpa` | `target_cpa_micros`, `cpc_bid_ceiling_micros`, `cpc_bid_floor_micros` | **≥15 conv / 30 days** |
| Target ROAS | `target_roas` | `target_roas`, ceilings/floors | **≥15 conv / 30 days** (eval at ≥50) |
| Maximize Clicks | `target_spend` | `cpc_bid_ceiling_micros` | no |
| Manual CPC | `manual_cpc` | `enhanced_cpc_enabled` (bool) | no |
| Manual CPM | `manual_cpm` | — | VIDEO/DISPLAY |
| Target Impression Share | `target_impression_share` | `location` (`ANYWHERE_ON_PAGE`/`TOP_OF_PAGE`/`ABSOLUTE_TOP_OF_PAGE`), `location_fraction_micros`, `cpc_bid_ceiling_micros` | no |
| Target CPM / Commission / Percent CPC | `target_cpm` / `commission` / `percent_cpc` | | specialised |

> `PERFORMANCE_MAX` accepts only `maximize_conversions` (+optional tCPA) or `maximize_conversion_value` (+optional tROAS). `MANUAL_CPC` is **invalid** for PMax.

### 2.4 Other campaign fields

- `status` — `ENABLED=2` \| `PAUSED=3` \| `REMOVED=4` (`REMOVED` is **permanent**; there is no un-remove — our `ARCHIVED`/`DELETED` schema values have no Google equivalent).
- **Dates:** v24 exposes **`start_date_time` / `end_date_time`**, accepting **`YYYY-MM-DD[ HH:MM:SS]`**, superseding the legacy `start_date`/`end_date` that took bare **`YYYYMMDD`**. Both spellings circulate in older docs/samples. **Confirm the exact accepted format against v24 before first mutate** — this is a trivially avoidable `FieldError`. (Snapchat uses ISO-8601; Meta differs again — no shared date helper across adapters.)
- `network_settings` — `target_google_search`, `target_search_network` (requires `target_google_search=true`), `target_content_network`, `target_partner_search_network` (SA360 only), plus `target_youtube` / `target_google_tv_network` on video.
- `geo_target_type_setting.positive_geo_target_type` — `PRESENCE_OR_INTEREST=5` \| `SEARCH_INTEREST=6` \| **`PRESENCE=7`**; `negative_geo_target_type` — `PRESENCE_OR_INTEREST` \| `PRESENCE`. **Default is `PRESENCE_OR_INTEREST`** — i.e. by default your "London" campaign also shows to people *interested in* London from anywhere. For a local-events product this is usually wrong → set **`PRESENCE`**. (See §10 GAP-8.)
- `ad_serving_optimization_status` — `OPTIMIZE`, `CONVERSION_OPTIMIZE`, `ROTATE`, `ROTATE_INDEFINITELY`, `UNAVAILABLE`.
- `selective_optimization.conversion_actions[]` / `conversion_goal_campaign_config` (`goal_config_level`: `CUSTOMER`\|`CAMPAIGN`, `custom_conversion_goal`).
- `tracking_url_template`, `final_url_suffix`, `url_custom_parameters[]`.
- `frequency_caps[]`, `targeting_setting.target_restrictions[]`, `real_time_bidding_setting`, `shopping_setting`, `app_campaign_setting`, `local_campaign_setting`, `audience_setting.use_audience_grouped`, `optimization_score` (read-only), `labels[]`, `payment_mode`, `excluded_parent_asset_field_types[]`, `dynamic_search_ads_setting`, `demand_gen_campaign_settings.upgraded_targeting`, `video_campaign_settings`, `pmax_campaign_settings`, `performance_max_upgrade`, `ai_max_setting.enable_ai_max`, `contains_eu_political_advertising`, `keyword_match_type` (campaign-level `BROAD` setting), `base_campaign` (draft/experiment lineage), `experiment_type`.
- ⚠ **`url_expansion_opt_out` is NOT a v24 field.** Its function moved to **`asset_automation_settings[]`** — repeated `{asset_automation_type, asset_automation_status}` where status ∈ `OPTED_IN` \| `OPTED_OUT`. `AssetAutomationType` includes **`FINAL_URL_EXPANSION_TEXT_ASSET_AUTOMATION`** (this is URL expansion), `TEXT_ASSET_AUTOMATION`, `GENERATE_VERTICAL_YOUTUBE_VIDEOS`, `GENERATE_SHORTER_YOUTUBE_VIDEOS`, `GENERATE_ENHANCED_YOUTUBE_VIDEOS`, `GENERATE_IMAGE_ENHANCEMENT`, `GENERATE_IMAGE_EXTRACTION`, `GENERATE_DESIGN_VERSIONS_FOR_IMAGES`, `GENERATE_LANDING_PAGE_PREVIEW`. **To stop Google swapping your event page for another URL: `FINAL_URL_EXPANSION_TEXT_ASSET_AUTOMATION` → `OPTED_OUT`.** (Any spec/blog saying `url_expansion_opt_out=true` is stale.) (§10 GAP-8.)
- ⚠ **`video_brand_safety_suitability` is not a top-level v24 Campaign field** — brand-safety suitability is configured via `CampaignCriterion` content exclusions + account-level controls.
- `brand_guidelines_enabled` (PMax) + `brand_guidelines{main_color, accent_color, predefined_font_family}` — when enabled, `BUSINESS_NAME`/`LOGO`/`LANDSCAPE_LOGO` **must be linked via `CampaignAsset`, not `AssetGroupAsset`**.

### 2.5 Per-channel-type differences (what changes for the adapter)

| | SEARCH | DISPLAY | PERFORMANCE_MAX | DEMAND_GEN | VIDEO | MULTI_CHANNEL (App) |
|---|---|---|---|---|---|---|
| Children | AdGroup→AdGroupAd | AdGroup→AdGroupAd | **AssetGroup** (no ad groups/ads) | AdGroup→AdGroupAd | AdGroup→AdGroupAd | AdGroup (≤100) |
| Keywords | **required in practice** | no (placements/audiences) | no (search themes as signals) | no | no | no |
| Ad type | `responsive_search_ad` | `responsive_display_ad` | n/a — assets by `field_type` | `demand_gen_*_ad` | video ads | `app_ad` |
| Bidding | any | any | MaxConv / MaxConvValue only | MaxConv / MaxConvValue / tCPA | CPM/CPV/tCPA | tCPA / tROAS |
| Video | n/a | optional | optional (auto-generated if absent) | **required** | **required** | optional |
| Network settings | search + partners | content network | not granularly exposed | not granularly exposed | youtube | n/a |

---

## 3. Ad group level — every field

### 3.1 AdGroup

- `name` (unique within campaign), `campaign` (resource name), `status` (`ENABLED`/`PAUSED`/`REMOVED`).
- `type` — `AdGroupType` (verbatim): `SEARCH_STANDARD=2`, `DISPLAY_STANDARD=3`, `SHOPPING_PRODUCT_ADS=4`, `HOTEL_ADS=6`, `SHOPPING_SMART_ADS=7`, `VIDEO_BUMPER=8`, `VIDEO_TRUE_VIEW_IN_STREAM=9`, `VIDEO_TRUE_VIEW_IN_DISPLAY=10`, `VIDEO_NON_SKIPPABLE_IN_STREAM=11`, `SEARCH_DYNAMIC_ADS=13`, `SHOPPING_COMPARISON_LISTING_ADS=14`, `PROMOTED_HOTEL_ADS=15`, `VIDEO_RESPONSIVE=16`, `VIDEO_EFFICIENT_REACH=17`, `SMART_CAMPAIGN_ADS=18`, `TRAVEL_ADS=19`, `YOUTUBE_AUDIO=20`. (No `DEMAND_GEN_*` values — Demand Gen ad groups use `UNSPECIFIED`/are managed implicitly.)
- Bids: `cpc_bid_micros`, `cpm_bid_micros`, `cpv_bid_micros`, `target_cpa_micros`, `target_roas`, `percent_cpc_bid_micros`, `target_cpm_micros`; read-only `effective_target_cpa_micros`, `effective_target_roas`.
- `ad_rotation_mode` — `OPTIMIZE` \| `ROTATE_FOREVER`.
- `tracking_url_template`, `url_custom_parameters[]`, `final_url_suffix`, `targeting_setting`, `excluded_parent_asset_field_types[]`, `audience_setting`, `labels[]`.

### 3.2 Criteria — which level

| Criterion | Level | Notes |
|---|---|---|
| `keyword` {`text`, `match_type`} | ad group | **`EXACT=2` / `PHRASE=3` / `BROAD=4`**; `negative` bool |
| `location` (`geo_target_constant`) | **campaign** | positive + negative |
| `language` (`language_constant`) | **campaign** | |
| `device` | **campaign** (bid modifiers) | `MOBILE`/`DESKTOP`/`TABLET`/`CONNECTED_TV` |
| `ad_schedule` | campaign | day-of-week + hours |
| `proximity` | campaign | radius + geo point |
| `age_range` | ad group | discrete: `AGE_RANGE_18_24=503001`, `_25_34=503002`, `_35_44=503003`, `_45_54=503004`, `_55_64=503005`, `_65_UP=503006`, `_UNDETERMINED=503999` |
| `gender` | ad group | `MALE=10`, `FEMALE=11`, `UNDETERMINED=20` |
| `parental_status` | ad group | `PARENT`, `NOT_A_PARENT`, `UNDETERMINED` |
| `income_range` | ad group | `INCOME_RANGE_0_50`, …, `_90_UP`, `_UNDETERMINED` |
| `user_list` (remarketing / Customer Match) | ad group or campaign | |
| `user_interest` (affinity / in-market) | ad group | |
| `custom_audience`, `custom_intent`, `combined_audience`, `audience` | ad group | |
| `placement`, `youtube_video`, `youtube_channel`, `topic` | ad group | Display/Video |
| `webpage` | ad group | DSA |
| `listing_group` | ad group | Shopping |
| `keyword_theme` | campaign | Smart campaigns |
| `brand_list` | campaign | PMax brand exclusions |

**Keyword limits:** ≤**80 characters**, ≤**10 words** per keyword (`KEYWORD_HAS_TOO_MANY_WORDS`). `bid_modifier` range **0.1–10.0** (0 to opt out of device).

**Exact level matrix** (which criterion types are legal where — getting this wrong is a `FieldError`):
- **Campaign-only:** `device`, `ad_schedule`, `proximity`, `ip_block`, `content_label`, `carrier`, `operating_system_version`, `mobile_device`, `location_group`, `keyword_theme`, `local_service_id`, `listing_scope`, `webpage_list`
- **Ad-group-only:** `listing_group`, `app_payment_model`, `custom_intent`, `audience` (the grouped `Audience` object), `vertical_ads_item_group_rule_list`, `retail_filter_bundle`
- **Both levels:** `keyword`, `placement`, `mobile_app_category`, `mobile_application`, `location`, `language`, `age_range`, `gender`, `income_range`, `parental_status`, `user_list`, `youtube_video`, `youtube_channel`, `topic`, `user_interest`, `webpage`, `custom_affinity`, `custom_audience`, `combined_audience`, `brand_list`, `life_event`, `video_lineup`, `extended_demographic`

⚠ **`AdGroupCriterion.negative` is IMMUTABLE** — you cannot flip a keyword positive↔negative; remove and re-add it.
`AdGroupCriterion` also carries `quality_info{quality_score, creative_quality_score, post_click_quality_score, search_predicted_ctr}` (output-only) — the Quality Score read path.

### 3.3 Account resource limits (support.google.com/google-ads/answer/6372658)

| Limit | Exact value |
|---|---|
| Campaigns per account (active + paused) | **10,000** |
| Ad groups per campaign | **20,000** (Local/App: **100**) |
| Ad group targeting items per account (keywords, placements, audiences) | **5,000,000** |
| Campaign targeting items per account | **1,000,000** |
| **Enabled RSAs per ad group** | **3** ← hard cap |
| Active text/non-image ads per ad group | 50 |
| Image/gallery ads per ad group | 300 |
| Ads per account | 4,000,000 |
| **Negative keywords per campaign** | **10,000** |
| **Negative keywords per ad group** | **5,000** |
| Negative keyword lists (shared sets) per account | 20 (**5,000** members each) |
| Account-level negative keyword list | 1,000 |
| Ad group targeting items per **ad group** | 20,000 |
| Campaign budgets per account | 11,000 shared / 20,000 unshared |
| **PMax campaigns per account** | **100** |
| **Asset groups per PMax campaign** | **100** |
| Campaign / ad group name | 256 chars |
| **Final URL** | **2,084 bytes** |
| Criterion final URL | 2,047 bytes |
| Proximity radius | **800 km / 500 mi** |
| Labels per entity | 50 |
| Test accounts per hierarchy | 50 |
| Manager accounts per account / hierarchy depth | 5 / 6 levels |

**Bulk path (not `googleAds:mutate`):** `BatchJobService` supports up to **1,000,000 operations per job**; each `AddBatchJobOperations` call caps at 10,000 ops but Google recommends **≤1,000 per call**, chaining via `sequence_token` (`REQUEST_TOO_LARGE` otherwise). Irrelevant at our volume — noted so nobody reaches for it.

### 3.4 `geo_target_constant` — verified against the live CSV

Downloaded `geotargets-2026-07-06.csv.zip` → **273,644 rows**; columns `Criteria ID,Name,Canonical Name,Parent ID,Country Code,Target Type,Status`.

**Our live markets (exact, verified):**

| Market | Criteria ID | Canonical Name | Parent | Type |
|---|---|---|---|---|
| United States | **2840** | `United States` | — | Country |
| United Kingdom | **2826** | `United Kingdom` | — | Country |
| Nigeria | **2566** | `Nigeria` | — | Country |
| **London (UK)** | **1006886** | `London,England,United Kingdom` | 20339 | City |
| Lagos (city) | **1010294** | `Lagos,Lagos,Nigeria` | 21564 | City |
| Lagos (state) | **21564** | `Lagos,Nigeria` | 2566 | State |
| New York (city) | **1023191** | `New York,New York,United States` | 21167 | City |
| Los Angeles | **1013962** | `Los Angeles,California,United States` | 21137 | City |
| Chicago | **1016367** | `Chicago,Illinois,United States` | 21147 | City |

**⚠ "London" is ambiguous — 5+ matches.** A naive name lookup resolves to the **wrong continent**:
```
1002325  London,London,Ontario,Canada          ← alphabetically/ordinally FIRST
1006886  London,England,United Kingdom          ← the one we want
1013271  London,Arkansas,United States
1017821  London,Kentucky,United States
1023797  London,Ohio,United States
```
Any geo resolution **must** disambiguate on `Country Code` + `Canonical Name`, never on `Name`. (§10 GAP-5.)

**Geo IDs rot:** `Status` ∈ {`Active`, `Removal Planned`}. **2,916** rows are `Removal Planned` — **2,212 of them in our own markets (GB/US/NG)**. Target-type spread: Postal Code 131,299 · City 65,368 · Municipality 23,405 · District 18,065 · Neighborhood 15,187 · County 3,698 · Province 1,272 · Region 1,162.

Lookup options: `GeoTargetConstantService.SuggestGeoTargetConstants` (by name+locale+country) or ship the CSV. `LanguageConstant`: English = **1000**.

---

## 4. Ad & asset level — every field, exact limits

### 4.1 Responsive Search Ad — `ad.responsive_search_ad` (verified: support.google.com/google-ads/answer/7684791)

| Field | Min | Max | Char limit |
|---|---|---|---|
| `headlines[]` (`AdTextAsset.text`) | **3** | **15** | **30** |
| `descriptions[]` | **2** | **4** | **90** |
| `path1` | — | 1 | **15** |
| `path2` | — | 1 | **15** (requires path1) |
| `final_urls[]` | 1 | — | — |

> **RSA = 4 descriptions max. PMax = 5.** These are routinely conflated (one of my own research passes got this wrong before I verified it against Google's page). Our validator must key the limit off ad type.

**Double-width languages:** "Every character in a double width language like Korean, Japanese, or Chinese counts as 2 characters" → effective 15 headline chars. Not a concern for our current markets (US/UK/NG) but the validator should count by weight, not `.length`.

**Pinning** — `AdTextAsset.pinned_field` (`ServedAssetFieldType`, from proto):
`HEADLINE_1=2`, `HEADLINE_2=3`, `HEADLINE_3=4`, `DESCRIPTION_1=5`, `DESCRIPTION_2=6` (also `HEADLINE=7`, `LONG_HEADLINE=9`, `DESCRIPTION=10`, `HEADLINE_IN_PORTRAIT=8`…).
**You can only pin to headline positions 1–3 and description positions 1–2** — there is no `HEADLINE_4`. Google: *"Pinning reduces the overall number of headlines or descriptions that can be matched"* and *"isn't recommended for most advertisers and can affect ad strength."* Best practice: pin **2–3 variants to the same position** rather than one static string.

Other: `final_urls[]`, `final_mobile_urls[]`, `tracking_url_template`, `final_url_suffix`, `url_custom_parameters[]`; read-only `ad_strength`, `asset_performance_label`, `policy_summary_info`.
**`ad_strength`** (proto): `PENDING=2`, `NO_ADS=3`, `POOR=4`, `AVERAGE=5`, `GOOD=6`, `EXCELLENT=7`. **Not a serving gate** (§7.4).

### 4.2 Responsive Display Ad — `ad.responsive_display_ad`

| Field | Min | Max | Limit |
|---|---|---|---|
| `short_headline` | 1 | 1 | **30** chars |
| `long_headline` | 1 | 1 | **90** chars |
| `headlines[]` | 1 | 5 | 30 chars |
| `descriptions[]` | 1 | 5 | **90** chars |
| `business_name` | 1 | 1 | **25** chars |
| `marketing_images[]` (1.91:1) | 1 | **15** (5 rec.) | 5120 KB |
| `square_marketing_images[]` (1:1) | 1 | **15** (5 rec.) | 5120 KB |
| `logo_images[]` (4:1) | 0 | 5 | optional |
| `square_logo_images[]` (1:1) | 0 | 5 | optional |
| `youtube_videos[]` | 0 | 5 | YouTube-hosted |
| `call_to_action_text` | 0 | 1 | ~15 chars |

Plus `main_color`/`accent_color` (hex), `allow_flexible_color`, `price_prefix`, `promo_text`, `format_setting` (`ALL_FORMATS`/`NON_NATIVE`/`NATIVE`), `control_spec.enable_asset_enhancements`/`enable_autogen_video`.

### 4.3 Performance Max `asset_group` — authoritative (developers.google.com/google-ads/api/performance-max/asset-requirements)

| AssetFieldType | Min | Max | Spec |
|---|---|---|---|
| `HEADLINE` | **3** | **15** | 30 chars |
| `LONG_HEADLINE` | **1** | **5** | 90 chars |
| `DESCRIPTION` | **2** | **5** | 90 chars — **⚠ at least one DESCRIPTION must be ≤60 chars**, else `AssetGroupError.SHORT_DESCRIPTION_REQUIRED` |
| `BUSINESS_NAME` | **1** | **1** | 25 chars (brand guidelines disabled) |
| `MARKETING_IMAGE` (1.91:1) | **1** | **20** | rec 1200×628, min 600×314, ≤5120 KB |
| `SQUARE_MARKETING_IMAGE` (1:1) | **1** | **20** | rec 1200×1200, min 300×300, ≤5120 KB |
| `LOGO` (1:1) | **1** | **5** | rec 1200×1200, min **128×128**, ≤5120 KB |
| `PORTRAIT_MARKETING_IMAGE` (4:5) | 0 | 20 | rec 960×1200, min 480×600, ≤5120 KB |
| `LANDSCAPE_LOGO` (4:1) | 0 | **20** | rec 1200×300, min 512×128, ≤5120 KB |
| `YOUTUBE_VIDEO` | 0 | **15** | 16:9 / 1:1 / 9:16, **≥10 seconds** |
| `MEDIA_BUNDLE` | 0 | 1 | **<150 KB** |
| `CALL_TO_ACTION_SELECTION` | 0 | 1 | automated by default |

`AssetGroup` fields: `resource_name`, `id` (output-only), `campaign` (immutable), `name` (**1–128 chars**, unique per campaign), `final_urls[]`, `final_mobile_urls[]`, `status` (`ENABLED`/`PAUSED`/`REMOVED`), `path1`/`path2`, read-only `ad_strength`, `asset_coverage`, `primary_status`/`primary_status_reasons`.
`AssetGroupAsset`: `{asset_group, asset, field_type, status, primary_status, policy_summary, source}`.
`AssetGroupSignal`: `oneof signal { audience | search_theme | local_services_id | vertical_ads_item_group_rule_list }` — **max 50 search themes per asset group** (raised from 25; SA360 still caps at 25; the 50 is support-doc-sourced, not encoded in the proto — the proto only fails with `ResourceCountLimitExceededError.RESOURCE_LIMIT`). Signals **do not restrict targeting** — Google: *"Performance Max may show ads to relevant audiences outside of your signals."*

⚠ **Creation constraint the adapter must honour:** an `AssetGroup` **cannot** be created by `assetGroups:mutate` alone and then populated — the asset group **and all its minimum-required `AssetGroupAsset` links must be created in the SAME bulk mutate request**, or it fails `AssetGroupError.NOT_ENOUGH_<X>_ASSET` (e.g. `NOT_ENOUGH_MARKETING_IMAGE_ASSET`). This forces PMax through `googleAds:mutate` with temp IDs — it is not expressible as sequential per-service calls.

**PMax limits:** **100** PMax campaigns/account · **100** asset groups/campaign · 1,000 listing-group filters/asset group.

### 4.4 Demand Gen

`demand_gen_multi_asset_ad`, `demand_gen_carousel_ad`, `demand_gen_video_responsive_ad`, `demand_gen_product_ad`.
**Headlines are 40 chars in Demand Gen — not 30.** Min 3 unique headlines; min 3 long headlines (90); min 3 descriptions (90); business name 25. Single-image ads: up to **20** image assets/ad. Carousel: **2–10** cards. Video: **1–5** per ad.

### 4.5 App campaign — `ad.app_ad`

`headlines[]` **2–5** (30 chars), `descriptions[]` **1–5** (90 chars), `images[]`, `youtube_videos[]`, `html5_media_bundles[]`, `mandatory_ad_text`.

### 4.6 Extensions = Assets

| Asset | Fields + exact limits |
|---|---|
| `SitelinkAsset` | `link_text` **≤25**, `description1` **≤35**, `description2` **≤35** (both-or-neither), `final_urls[]`. **4+ recommended; 6+ for PMax "Excellent"** |
| `CalloutAsset` | `callout_text` **≤25**. 4+ recommended |
| `StructuredSnippetAsset` | `header` (from a fixed list: Amenities, Brands, Courses, Degree programs, Destinations, Featured hotels, Insurance coverage, Models, Neighborhoods, Service catalog, Shows, Styles, Types), `values[]` **3–10**, each **≤25** |
| `ImageAsset` | `data` (bytes), `file_size`, `mime_type`, `full_size{width_pixels,height_pixels,url}` |
| `CallAsset` | `country_code`, `phone_number`, `call_conversion_action`, `call_conversion_reporting_state` |
| `PromotionAsset` | `promotion_target` ≤25, discount modifier, dates, `occasion` |
| `PriceAsset` | `type`, `price_qualifier`, `price_offerings[]` **3–8** (header ≤25, description ≤25) |
| `LeadFormAsset` | `business_name`, `headline`, `description`, `call_to_action_type`, `call_to_action_description`, `privacy_policy_url` (**required**), `fields[]`, `custom_question_fields[]` (**max 5**), `background_image_asset` (**must be exactly 1200×628**), single `WebhookDelivery`. `LeadFormSingleChoiceAnswers` **2–12**. *(≤30 headline / ≤200 description are widely cited but **not** in the proto — treat as unverified.)* |
| `MobileAppAsset` | `app_id` + `app_store` (both required), `link_text` **1–25** |
| `HotelCalloutAsset` | `text` **1–25**, `language_code` (required) |
| `YouTubeVideoListAsset` | `youtube_videos[]` **min 2, max 5** (`RELATED_YOUTUBE_VIDEOS`) |
| `BusinessMessageAsset` | `oneof message_provider_data { whatsapp_info | facebook_messenger_info | zalo_info }` — **there is no standalone `WhatsappBusinessMessageAsset`**; WhatsApp is a variant nested here |
| `LocationAsset` | `place_id`, `location_ownership_type` (`BUSINESS_OWNER`/`AFFILIATE`) |

⚠ **`BusinessNameAsset` and `BusinessLogoAsset` do not exist as message types.** `BUSINESS_NAME` / `BUSINESS_LOGO` / `LOGO` are **`AssetFieldType` enum values applied to plain `TextAsset` / `ImageAsset` instances**.

⚠ **Assets are immutable once created.** Per `asset.proto`: *"to stop an asset from serving, remove the asset from the entity that is using it."* You never mutate an Asset — you unlink it at the `CustomerAsset`/`CampaignAsset`/`AdGroupAsset`/`AssetGroupAsset` level. (A creative "edit" = create a new asset + relink, and that **restarts review** — §6.3.)

Linking: `CustomerAsset` / `CampaignAsset` / `AdGroupAsset` / `AssetGroupAsset`, each `{asset, field_type, status}`.
Link resource names are composite: `customerAssets/{asset_id}~{field_type}`, `campaignAssets/{campaign_id}~{asset_id}~{field_type}`, `adGroupAssets/{ad_group_id}~{asset_id}~{field_type}`, `assetGroupAssets/{asset_group_id}~{asset_id}~{field_type}`.
**`AssetFieldType` (verbatim, proto):** `HEADLINE=2`, `DESCRIPTION=3`, `MANDATORY_AD_TEXT=4`, `MARKETING_IMAGE=5`, `MEDIA_BUNDLE=6`, `YOUTUBE_VIDEO=7`, `BOOK_ON_GOOGLE=8`, `LEAD_FORM=9`, `PROMOTION=10`, `CALLOUT=11`, `STRUCTURED_SNIPPET=12`, `SITELINK=13`, `MOBILE_APP=14`, `HOTEL_CALLOUT=15`, `CALL=16`, `LONG_HEADLINE=17`, `BUSINESS_NAME=18`, `SQUARE_MARKETING_IMAGE=19`, `PORTRAIT_MARKETING_IMAGE=20`, `LOGO=21`, `LANDSCAPE_LOGO=22`, `VIDEO=23`, `PRICE=24`, `CALL_TO_ACTION_SELECTION=25`, `AD_IMAGE=26`, `BUSINESS_LOGO=27`, `HOTEL_PROPERTY=28`, `DEMAND_GEN_CAROUSEL_CARD=30`, `BUSINESS_MESSAGE=31`, `TALL_PORTRAIT_MARKETING_IMAGE=32`, `RELATED_YOUTUBE_VIDEOS=33`, plus `LANDING_PAGE_PREVIEW`, `LONG_DESCRIPTION`, `CALL_TO_ACTION`, `CLASSIC_DISPLAY_IMAGE`.

**Only `TextAsset` is created inline on the ad.** Every other asset type must be created via `AssetService.MutateAssets` (`POST /v24/customers/{cid}/assets:mutate`) **first**, then linked.

**`ServedAssetFieldType`** (reporting — *where an asset actually served*, distinct from `AssetFieldType`): `HEADLINE_1/2/3`, `DESCRIPTION_1/2`, `HEADLINE`, `HEADLINE_IN_PORTRAIT`, `LONG_HEADLINE`, `DESCRIPTION`, `DESCRIPTION_IN_PORTRAIT`, `BUSINESS_NAME`, `BUSINESS_NAME_IN_PORTRAIT`, `MARKETING_IMAGE`, `MARKETING_IMAGE_IN_PORTRAIT`, `SQUARE_MARKETING_IMAGE`, `PORTRAIT_MARKETING_IMAGE`, `LOGO`, `LANDSCAPE_LOGO`, `CALL_TO_ACTION`, `YOU_TUBE_VIDEO`, `SITELINK`, `CALL`, `MOBILE_APP`, `CALLOUT`, `STRUCTURED_SNIPPET`, `PRICE`, `PROMOTION`, `AD_IMAGE`, `LEAD_FORM`, `BUSINESS_LOGO`, `DESCRIPTION_PREFIX`, `HEADLINE_AS_SITELINK_POSITION_ONE/TWO`, `DESCRIPTION_LINE_HEADLINE_AS_SITELINK_POSITION_ONE/TWO`.

**`AssetPerformanceLabel`** (on `AdTextAsset.asset_performance_label`): `PENDING`, `LEARNING`, `LOW`, `GOOD`, `BEST`, `NOT_APPLICABLE` — the per-asset signal to drive "replace this headline" guidance.

---

## 5. Creative / asset specs — exhaustive

### 5.1 Image assets

| Asset | Ratio | Recommended | Minimum | Max file | Formats |
|---|---|---|---|---|---|
| Marketing / landscape | **1.91:1** | **1200×628** | **600×314** | **5120 KB** | JPG, PNG |
| Square marketing | **1:1** | **1200×1200** † | **300×300** | **5120 KB** | JPG, PNG |
| Portrait | **4:5** | **960×1200** | **480×600** | **5120 KB** | JPG, PNG |
| Vertical (Demand Gen/Shorts) | **9:16** | **1080×1920** | **600×1067** | 5120 KB | JPG, PNG |
| Logo square | **1:1** | **1200×1200** | **128×128** ‡ | **5120 KB** | JPG, PNG |
| Logo landscape | **4:1** | **1200×300** | **512×128** | **5120 KB** | JPG, PNG |
| Uploaded display ad | fixed IAB sizes | — | — | **150 KB** | GIF, JPG, PNG |
| Media bundle (PMax) | — | — | — | **<150 KB** | ZIP/HTML5 |
| Media bundle (uploaded display HTML5) | — | — | — | **600 KB** (≤40 files) | ZIP |

† **Doc conflict:** the standalone RDA spec page says square recommended **600×600**; PMax/Demand Gen/API pages say **1200×1200**. Use **1200×1200** universally.
‡ **Doc conflict:** Demand Gen logo min quoted **144×144** on one page, **128×128** on another. Use **144×144** as the safe floor.

- **No published aspect-ratio tolerance.** The commonly-cited "±1%" does **not** appear in any current Google doc. Do not encode a tolerance constant against a source that doesn't exist.
- **GIF/WEBP are NOT accepted** for marketing/logo asset types (JPG/PNG only), despite `IMAGE_GIF`/`IMAGE_WEBP` existing in the `MimeType` enum. The enum is broader than the policy.
- Animated GIF (uploaded display ads only): ≤**30 s**, must stop after 30 s, frame rate **<5 FPS**.
- **`ImageAsset` names must be unique per account** for image + media-bundle assets.
- **The API has NO crop parameter.** The Ads UI has a crop tool; the API takes pre-encoded bytes at a fixed `full_size` and **Google will not crop or fetch server-side**. You must download the bytes and pre-crop to each target ratio yourself before `assets:mutate`. Confirmed: *"Google does not directly fetch remote URLs — you must download the image and pass the binary data to the API."*
- Uploaded-display IAB sizes: 200×200, 240×400, 250×250, 250×360, **300×250**, **336×280**, 580×400, 120×600, **160×600**, **300×600**, 300×1050, 468×60, **728×90**, 930×180, **970×90**, **970×250**, 980×120, 300×50, **320×50**, 320×100 (+ regional PL/SE/DK/NO sizes).

### 5.2 Video specs

| Format | Length | Notes |
|---|---|---|
| Bumper | **≤6 s** | non-skippable, CPM |
| Skippable in-stream | skip after **5 s**; best practice 15–20 s | CPV |
| Non-skippable in-stream | **7–15 s** | |
| Non-skippable 30 s (CTV) | **16–30 s** | **must be horizontal** |
| In-feed | no stated max | thumbnail + headline |
| Shorts | <60 s recommended | vertical 9:16 |
| Masthead | desktop autoplay ≤30 s | reservation |
| **PMax video asset** | **≥10 s** | 16:9 / 1:1 / 9:16; max 15 |
| Demand Gen | ≥5 s accepted; **<10 s ineligible for in-stream**; >15 s recommended | 1–5 per ad |

Ratios 16:9 / 9:16 / 1:1 (4:3, 2:3 SD only). Resolution rec **1080p**, min **720p**. Formats MP4, WebM, MOV, AVI, WMV, FLV, 3GPP, ProRes, DNxHR, HEVC. **Max file 256 GB.**

**PMax auto-generated video:** if an asset group has **no** user-uploaded video, Google AI **auto-generates one** from your images + text. Uploading your own video disables it for that group. Opt-out path: Campaign settings → **Asset optimization → Video → uncheck Enhancement**. There is no separate independent "don't auto-generate" toggle.

### 5.3 ⚠ THE VIDEO-HOSTING QUESTION — the spec's premise is WRONG

Our specs state this as a hard blocker:
> #866 §4.0: *"**Bunny video cannot upload directly — YouTube dependency**, §11 OD-2"*
> #866 §205: *"video → `YoutubeVideoAsset` **requires a YouTube-hosted `youtube_video_id`** (Bunny cannot upload directly → OD-2)"*

**Half true, and the conclusion drawn from it is wrong.**

TRUE: `YoutubeVideoAsset` has exactly two fields — `youtube_video_id` (the 11-char YouTube id), `youtube_video_title`. It accepts **no bytes and no URL**. You cannot hand Google a Bunny URL. `AssetService` will not fetch it.
Also true, and worth killing as a fallback idea: the legacy `MediaFile` path **never** accepted video bytes either. `MediaImage.data` (bytes) and `MediaBundle.data` (bytes) exist, but **`MediaVideo` has no bytes field at all** — only an immutable `youtube_video_id`. This has been true since the AdWords era; nothing changed in v24.

**FALSE — that this forces a YouTube channel + the YouTube Data API.** The Google Ads API ships **`YouTubeVideoUploadService.CreateYouTubeVideoUpload`**, which *"lets you upload videos directly to YouTube through the Google Ads API"* — it **accepts raw video bytes** over a resumable REST protocol:

```
POST https://googleads.googleapis.com/resumable/upload/v24/customers/{CUSTOMER_ID}/youTubeVideoUploads:create

Headers:
  X-Goog-Upload-Protocol: resumable
  X-Goog-Upload-Command: start | upload | query | finalize
  X-Goog-Upload-Header-Content-Length: {FILE_SIZE}
  X-Goog-Upload-Offset: {byte offset}

Body:
{ "customer_id": "5083048929",
  "you_tube_video_upload": {
      "video_title": "...", "video_description": "...",
      "video_privacy": "UNLISTED",
      "channel_id": "{OPTIONAL}" } }
```

**Resource `YouTubeVideoUpload`** — `customers/{cid}/youTubeVideoUploads/{video_upload_id}`; fields: `video_upload_id` (output-only), `channel_id` (immutable), **`video_id` (output-only — the resulting YouTube id we feed to `YoutubeVideoAsset`)**, `state`, `video_title` / `video_description` (input-only, immutable), `video_privacy`.
**Service RPCs:** `CreateYouTubeVideoUpload`, `UpdateYouTubeVideoUpload` (metadata only, and *only* for videos uploaded via this API), `RemoveYouTubeVideoUpload`.

- **`channel_id` omitted ⇒ the video is uploaded to a Google-managed YouTube channel** associated with the Google Ads account. **We do not need to own a YouTube channel, and we do not need the YouTube Data API at all.** Trade-off: on the house channel we don't own the YouTube asset ⇒ **no YouTube analytics, no view-based remarketing, no appeals** on it, and privacy is forced `UNLISTED`.
- `channel_id` supplied ⇒ uploads to the advertiser's own brand channel; **user-auth only, not service accounts** — our OAuth refresh-token flow qualifies.
- Upload state enum: `PENDING`, `UPLOADED`, `PROCESSED`, `FAILED`, `REJECTED`, `UNAVAILABLE` → **must poll to `PROCESSED`** before the video is usable as an asset (same async shape as Meta's `video_status='ready'`).
- `YouTubeVideoPrivacy`: **`PUBLIC` (brand channels only)** · **`UNLISTED` (default; the only option for Google-managed channels)**.
- `RemoveYouTubeVideoUpload` deletes from **both** the Ads asset library **and** YouTube.
- **Constraint:** *"Uploading videos with the Google Ads API is only supported with the Python client library and by using REST."* **REST is supported ⇒ our Deno/TypeScript edge adapter can do this natively** (we call REST anyway; we use no client library).

**Net:** the path is **Bunny bytes → fetch in edge → resumable REST upload → poll to `PROCESSED` → `youtube_video_id` → `YoutubeVideoAsset` → link**. Real work (resumable chunking + polling + a video that lands UNLISTED on a Google-managed channel unless we pass our own `channel_id`), but **not the blocker the spec records**, and **the YouTube Data API alternative should be rejected** (`videos.insert` costs ~100 units since 2025-12-04, down from 1,600, but is capped at ~**100 uploads/day** in its own bucket and needs a separate `youtube.upload` scope + channel + OAuth consent — strictly worse).

→ **#866 OD-2 should be closed with this finding.** (§10 GAP-3.)

### 5.4 Networks / placements

| Surface | Reached by |
|---|---|
| Google Search | SEARCH, PMax, Shopping, Smart |
| Search partners | SEARCH (`target_search_network`), PMax |
| Display Network (**35M+ sites/apps**) | DISPLAY, PMax, Demand Gen |
| YouTube (in-stream, in-feed, Shorts, Masthead) | VIDEO, PMax, Demand Gen |
| Discover | PMax, Demand Gen |
| Gmail (**Promotions + Social tabs only**) | PMax, Demand Gen |
| Maps (promoted pins, map search, map suggest) | SEARCH, PMax for store goals, Smart, Shopping — **requires location assets** |

**PMax spans (cited, `answer/16260129`):** Search, Display, YouTube, Discover, Maps, Gmail, Search partners (+ Shopping inventory).
**Demand Gen spans:** YouTube in-stream/in-feed/Shorts/Home/Watch-Next, Discover, Gmail, Display, video partners (~2.9B reach).

**Asset → surface dependencies (this is how assets gate reach):**
- No video → no YouTube in-stream serving (PMax falls back to auto-generated video if Enhancement is on).
- **No logo → limits Discover + Gmail eligibility** (template-driven surfaces expect a brand mark).
- No square 1:1 → limits in-feed/native placements.
- No 9:16 → excludes Shorts.
- Demand Gen video <10 s → ineligible for in-stream specifically.

---

## 6. Validation, review & policy

### 6.1 Reading approval status

```sql
SELECT ad_group_ad.policy_summary.approval_status,
       ad_group_ad.policy_summary.review_status,
       ad_group_ad.policy_summary.policy_topic_entries
FROM ad_group_ad
WHERE ad_group_ad.policy_summary.approval_status = 'DISAPPROVED'
```

**`approval_status`** (`PolicyApprovalStatus`, proto): `UNSPECIFIED=0`, `UNKNOWN=1`, **`DISAPPROVED=2`** (will not serve), **`APPROVED_LIMITED=3`** (serves with restrictions), **`APPROVED=4`**, **`AREA_OF_INTEREST_ONLY=5`**. Severity: `DISAPPROVED` > `AREA_OF_INTEREST_ONLY` > `APPROVED_LIMITED` > `APPROVED`.

**`review_status`** (`PolicyReviewStatus`): `REVIEW_IN_PROGRESS=2`, `REVIEWED=3`, `UNDER_APPEAL=4`, `ELIGIBLE_MAY_SERVE=5`.

**`policy_topic_entries[].type`** (`PolicyTopicEntryType`): `PROHIBITED=2`, **`LIMITED=4`**, `DESCRIPTIVE=5`, `BROADENING=6`, `AREA_OF_INTEREST_ONLY=7`, **`FULLY_LIMITED=8`**.
> **The spec brief's `LIMITS_SERVING` / `FULLY_LIMITS_SERVING` do not exist.** The real names are **`LIMITED`** and **`FULLY_LIMITED`**. `evidences[]` carries `TextList`/`WebsiteList`(≤5)/`DestinationMismatch`/`DestinationNotWorking`; `constraints[]` carries country constraints.

→ **#867 OD-8 is correct**: persist `ad_group_ad.policy_summary.approval_status` as our `delivery_status`. But `review_status` is a **separate field** — Snapchat rolls both into one `review_status`; Google splits them. Store both.

### 6.2 Disapproval causes relevant to us

- **Prohibited content** — counterfeit, dangerous products, dishonest behavior, inappropriate content.
- **Prohibited practices** — abusing the ad network, data collection/use, **misrepresentation**: *unclear relevance* (ad not relevant to destination), ***unavailable offers*** (promoting something not available/easily found at the destination), misleading/unsupported claims, unsubstantiated superlatives ("#1", "guaranteed").
  - ⚠ **This is our highest live risk.** A Mingla ad for a **specific event** whose page later sells out, is unpublished, or whose date passes becomes an "unavailable offer" → disapproval. Our destination is validated **once at create** (`destination_not_public` 422) and never re-checked. (§10 GAP-6.)
- **Restricted** — alcohol (**directly relevant**: venue/nightlife events), gambling, adult, healthcare, political, financial, trademarks, dating/companionship (**relevant given the "not a dating app" positioning** — Google's classifier may mis-bucket social/experience copy).
- **Editorial** — incorrect capitalization ("FrEe"/ALL CAPS), punctuation/symbol misuse ("!!!", "★"), gimmicky spacing/repetition, incomprehensible copy. Warning issued **≥7 days** before suspension.
- **Destination requirements** — URL must work (no under-construction/parked), **display-URL domain must match final-URL domain**, no phishing.
  - ⚠ **`dest_smart_link` = `go.usemingla.com` (AppsFlyer OneLink) redirecting to `usemingla.com`.** A **cross-domain redirect** is precisely what the *destination mismatch* policy targets. Meta/Snapchat/TikTok tolerate this; **Google is materially stricter.** (§10 GAP-4.)
- **Trademarks** — free to *bid on* as keywords; **restricted in ad text** unless owner/authorized reseller. Complaints are per-advertiser-by-URL; 3rd-party authorization ≈5–7 business days.

### 6.3 Review timing & appeal

- Most ads reviewed **within 1 business day**; check after **2 full business days**; contact support after **1 week**. **Ads do not serve while under review.**
- **Editing an approved ad restarts review** — *"Changes to your ad or assets restart the review process."*
- **UI appeal:** max **3 appeals per ad**, min **24 h** between appeals, review typically ≤24 h.
- **API appeal = policy exemption**, not a button: catch the error → read `policy_topic_entries[].topic` from `policy_finding_details` (ads) / `policy_violation_details` (keywords) → set `PolicyValidationParameter.ignorable_policy_topics` → **resubmit the same mutate**. Only *exemptible* findings can be bypassed.
  > The brief's `policy_violation_key` / `exempt_policy_violation_keys` are **legacy AdWords SOAP** names — superseded by `ignorable_policy_topics`.
- Errors: `PolicyFindingError.POLICY_FINDING=2` (ads) · `PolicyViolationError.POLICY_ERROR=2` (keywords).

### 6.4 Ad Strength is NOT a gate

Values `PENDING/NO_ADS/POOR/AVERAGE/GOOD/EXCELLENT`. Google: *"The Ad strength rating of an ad doesn't directly influence your ad's serving eligibility"* — not used in Ad Rank or Quality Score. It correlates with performance, not approval. Do not fail-close on it; surface it.

### 6.5 Error taxonomy the adapter must handle

`GoogleAdsFailure { errors[], request_id }`; `GoogleAdsError { error_code (oneof), message, trigger, location.field_path_elements[], details }`.

| Class | Values we must handle |
|---|---|
| `AuthorizationError` | **`DEVELOPER_TOKEN_NOT_APPROVED=10`**, `CUSTOMER_NOT_ENABLED=24`, `USER_PERMISSION_DENIED`, `ACTION_NOT_PERMITTED_FOR_SUSPENDED_ACCOUNT` |
| `AuthenticationError` | `OAUTH_TOKEN_EXPIRED`, `OAUTH_TOKEN_REVOKED`, `OAUTH_TOKEN_INVALID`, `DEVELOPER_TOKEN_INVALID`, `CUSTOMER_NOT_FOUND` |
| `QuotaError` | `RESOURCE_EXHAUSTED=2` (daily cap — **not** retryable), `RESOURCE_TEMPORARILY_EXHAUSTED=4` (**retry w/ backoff**) |
| `RequestError` | `REQUIRED_FIELD_MISSING`, `RESOURCE_NAME_MALFORMED`, `TOO_MANY_MUTATE_OPERATIONS`, `DEVELOPER_TOKEN_PARAMETER_MISSING`, `LOGIN_CUSTOMER_ID_PARAMETER_MISSING`, `UNSUPPORTED_VERSION` |
| `StringLengthError` | `TOO_SHORT=2`, `TOO_LONG=3`, `EMPTY=4` |
| `FieldError` | `REQUIRED=2`, `IMMUTABLE_FIELD=3`, `VALUE_MUST_BE_UNSET=5`, `REQUIRED_NONEMPTY_LIST=6` |
| `AdError` | `LINE_TOO_WIDE=58`, `TOO_LONG=83`, `TOO_SHORT=84`, `INVALID_AD_TYPE=40` |
| `ResourceCountLimitExceededError` | `CAMPAIGN_LIMIT=3`, `ADGROUP_LIMIT=4`, `AD_GROUP_AD_LIMIT=5`, `AD_GROUP_CRITERION_LIMIT=6` |
| `MutateError` | `ID_EXISTS_IN_MULTIPLE_MUTATES=7`, `RESOURCE_ALREADY_EXISTS=11`, `RESOURCE_DOES_NOT_SUPPORT_VALIDATE_ONLY=12` |
| `DatabaseError` | `CONCURRENT_MODIFICATION=2` (**retryable**) |
| `PolicyFindingError` / `PolicyViolationError` | `POLICY_FINDING=2` / `POLICY_ERROR=2` |

**Retry:** `RESOURCE_TEMPORARILY_EXHAUSTED` + `CONCURRENT_MODIFICATION` → exponential backoff (Google's sample: 5 s → 10 s → 20 s); `QuotaErrorDetails.retry_delay` may be supplied. Validation/policy/field errors are **never** retryable unchanged.
`request_id` must be captured into `ad_status_events.provider_response` — it's what Google support requires.

---

## 7. Access tiers — the production gate

### 7.1 Four tiers (not three)

| Tier | Accounts | Daily ops | How |
|---|---|---|---|
| **Test Account Access** | **test accounts only** | 15,000 | **automatic default — believed to be what we have** |
| **Explorer Access** | **test AND production** | **2,880 /day (production)**; 15,000 (test) | **automatic — no application.** *"Google may automatically upgrade your developer token from Test Account Access level to the Explorer Access level in some cases."* |
| **Basic Access** | test + production | **15,000 /day** | API Center application; **~5 business days** |
| **Standard Access** | test + production | **unlimited** | application; ~10 business days; RMF applies |

**Explorer blocks:** account creation (`CreateCustomerClient`), user-management services, planning tools (`KeywordPlanService`, `KeywordPlanIdeaService`), billing/payment services.

> **None of Explorer's blocked features are ones we need.** We create campaigns/ad groups/ads, flip status, and read GAQL — all permitted. Our own Basic application models *"tens to low-hundreds of operations per day"*, which sits inside **2,880/day** with ~10–100× headroom.
> **⇒ Explorer would fully unblock production for our use case, and it is granted automatically rather than applied for.** This answers **#867 OD-7 affirmatively**. **Action: read the actual current tier in the API Center — we may already be Explorer and not know it**, in which case the "Google is provision-blocked" premise is already false. (§10 GAP-1.)

**RMF (Required Minimum Functionality) applies to Standard only** — our tool is **Internal-Use-Only**, which requires **none** of the three functionality categories. We should not request Standard.

### 7.2 What a TEST token does against our production customer

`AuthorizationError.DEVELOPER_TOKEN_NOT_APPROVED = 10` — *"The developer token is only approved for use with test accounts. To access non-test accounts, apply for Basic or Standard access."* → gRPC `PERMISSION_DENIED (7)` / **HTTP 403**.

Distinct from `CUSTOMER_NOT_ENABLED=24` (account not yet enabled/deactivated — not a token-tier issue).

### 7.3 `validate_only` does NOT bypass the tier gate

Authorization (*may this token touch this customer at all?*) is evaluated **before** validation (*is this payload legal?*). A **TEST** token calling `validate_only=true` against production customer `5083048929` **still fails** with `DEVELOPER_TOKEN_NOT_APPROVED`. **We cannot dry-run our mutate shapes against the real account until the tier changes.** (`MutateError.RESOURCE_DOES_NOT_SUPPORT_VALIDATE_ONLY=12` for a few resources.)

### 7.4 Test accounts

Separate **test manager** hierarchy (cannot link to production); ≤**50** test accounts; **serve no ads** (*"appear in the Google Ads UI as cancelled accounts… they don't render ads to users"*); no metrics/billing/conversion-upload testing. **Do not require an approved token.** Fully valid for **validating mutate shapes** — which is exactly how we should build and CI-test the adapter today. Deleted after **1 year** of inactivity.

---

## 8. World-class best practices (what "ideal" looks like)

1. **Search intent + RSA volume.** Supply all **15 headlines** and **4 descriptions**, unique and non-redundant. Poor→Excellent Ad Strength correlates with **+12%** conversions (`answer/9921843`) / **+15%** (`answer/6167122`) — Google publishes both; cite per-page, don't average. PMax Excellent ≈ **+6%** (`answer/14143250`).
2. **Pinning sparingly.** Pinning shrinks the combination space and lowers Ad Strength. If legally required, pin **2–3 variants to the same slot**. Only positions H1–H3 / D1–D2 exist.
3. **Smart Bidding needs volume.** tCPA/tROAS: **≥15 conv/30 days** to enable; evaluate at **≥30** (tCPA) / **≥50** (tROAS). Below that use **Maximize Conversions** (no minimum). App: ≥10/day or 300/30d. Video Action: ≥30/30d. Demand Gen VBB: ≥50 w/ value in 35d incl. ≥10 in 7d.
4. **Learning period ~5–7 days**; avoid changes for **7–14 days**; PMax can take **6 weeks** to mature. Changing **strategy type / conversion goals / targeting / creative** resets learning; **changing only the tCPA/tROAS target does not.**
5. **PMax = asset quality + signals.** Audience signals **accelerate**, they don't restrict. **Max 50 search themes**/asset group. Budget **≥3× tCPA/day** (Google-stated). Use brand exclusions (account-level brand list) — stronger than negatives. Set `url_expansion_opt_out=true` when the destination must be a specific page.
6. **Match types 2025-26.** Broad + Smart Bidding is Google's recommended default: broad is the only type using the full auction-time signal set; Google reports **+25% conversions** (tCPA) / **+12% conv value** (tROAS) vs phrase. Pair with disciplined negatives (10,000/campaign; 1,000 account-level list).
7. **Account structure.** SKAGs are largely obsolete (contested — Search Engine Land still defends niche cases); **thematic ad groups (STAGs, 3–20 related keywords)** pool signal so Smart Bidding converges. One campaign per objective/geo.
8. **Conversion tracking.** gtag/GTM → **Enhanced Conversions** (SHA-256 of normalized email: lowercase, trim, strip dots for gmail) → **offline import via GCLID** (**90-day** GCLID retention — later uploads silently fail). **Consent Mode v2 mandatory for EEA since March 2024** — directly relevant to our **London/UK** market.
9. **Customer Match.** Min **100** active users for lists refreshed on/after 2024-02-01 — **except Search + YouTube, which still require 1,000**. EEA targeting needs both consent fields `GRANTED`.
10. **Budget math.** daily = tCPA × target daily conversions; ≥3× tCPA for PMax. Ceiling = daily × 30.4/month; ≤2× on any day.

---

## 9. Our engine's real capability

### 9.1 What exists

**Nothing.** Verified on `main`: no `GOOGLE_ADS_*` reference, no `googleads.googleapis` reference, no `ad_connections`/`ad_campaigns` migration, no `admin-ad-*` or `admin-meta-*` edge function, no `_shared/google.ts`. **The entire Ad Engine — all five channels — is spec-only.** Every "capability" below is *specified*, not built.

### 9.2 The specified Google adapter (#862 A3 §B, #867 §4.3)

```ts
interface ChannelAdapter {
  platform: 'meta'|'tiktok'|'snapchat'|'google'|'reddit';
  connect(conn): AuthedClient;
  createCampaign(conn, input): { externalId, status };
  createAdSet(conn, campaignExternalId, input): { externalId };
  createAd(conn, adSetExternalId, input): { externalId, reviewStatus };
  setStatus(conn, level, externalId, status): void;   // level ∈ {campaign, ad_set, ad}
  getStatus(conn, level, externalId): status;
}
```
Registry seed (A3 §D): `google/consumer` → `external_account_id=5083048929`, `external_org_id=8284700017`, `auth_kind='dev_token_oauth'`, `token_env_var='GOOGLE_ADS_REFRESH_TOKEN'`, extra = `GOOGLE_ADS_DEVELOPER_TOKEN`/`GOOGLE_ADS_OAUTH_CLIENT_ID`/`GOOGLE_ADS_OAUTH_CLIENT_SECRET`, project `mingla-ads-engine`. Status recorded **GREEN** ("server verified; prod Basic-access approval pending").
Budgets stored in **cents**; Google adapter converts **cents → micros ×10,000**.

**What it can set (per spec):** `campaignBudget{name, amount_micros, delivery_method:STANDARD}` → `campaign{name, advertising_channel_type, status:PAUSED, campaign_budget, network_settings, start_date, end_date, maximize_clicks/target_spend}` → `adGroup{name, campaign, status, type:SEARCH_STANDARD, cpc_bid_micros}` → `adGroupAd{ad_group, status:PAUSED, ad:{final_urls:[dest_smart_link], responsive_search_ad|display}}`; launch/pause via `campaigns:mutate` + `updateMask:"status"`; status via GAQL `searchStream`; `ad_group_ad.policy_summary.approval_status` as `delivery_status` (OD-8).

### 9.3 What the builder actually collects (#864 §4.4) — the mismatch

```jsonc
{ budget:    { type:'daily'|'lifetime', amount_cents, end_time? },
  targeting: { countries:[…], age_min, age_max, genders? },
  creative:  { message, headline?, description?, image_url, call_to_action_type } }
```
**One** headline. **One** description. **One** `image_url`. `age_min`/`age_max` as integers. **Zero keywords.** This is a faithful Meta model and it is **not expressible in Google** — see §10 GAP-2/GAP-7.

### 9.4 Credential reality — three corrections

1. **Dev token is TEST tier** ⇒ **every call to customer `5083048929` fails `DEVELOPER_TOKEN_NOT_APPROVED` (HTTP 403)**, including `validate_only`. The A3 registry marking `google/consumer` **GREEN** is **not supportable today**: an OAuth token that mints is *not* an Ads-API call that succeeds. **GREEN should be AMBER/BLOCKED until the tier changes.**
2. `scratchpad/google_token_resp.json` contains `{"error":"invalid_grant","error_description":"Bad Request"}` — a **failed** refresh-token exchange. It may be a stale artifact from before a later success, but it is the **only** token evidence in the tree and it contradicts "server verified." **Re-verify the refresh token before any build.**
3. Spec §4.0b says *"e.g. `v25` current at time of writing."* **v25 does not exist.** Current is **v24.2** (2026-06-24); v24 GA 2026-04-22; monthly minors, 4 majors/year, **1-year support** per major (v24 → ~2027-04). v21 sunsets Aug 2026, v22 Oct 2026. `GOOGLE_ADS_API_VERSION` must be pinned to **v24** and rotated on a schedule (`UNSUPPORTED_VERSION` on sunset).

### 9.5 Feasibility summary

| Capability | Feasible? |
|---|---|
| OAuth refresh → access token (server-side, edge memory) | Yes — same shape as Snapchat/Reddit; **re-verify (§9.4.2)** |
| Atomic create | **Yes, better than any other channel** — native `googleAds:mutate` all-or-nothing ⇒ **no compensating-delete needed** |
| Launch/pause | Yes — `updateMask:"status"` |
| Status/approval read | Yes — GAQL; store `approval_status` **and** `review_status` |
| RSA create | **Only after the builder collects 3–15 headlines + 2–4 descriptions** |
| Search campaign | **No — we collect no keywords** |
| PMax | **No — adapter has no asset_group concept** |
| Image asset | Needs bytes + **pre-cropping** (no URL fetch, no crop param) |
| Video asset | **Yes via `YouTubeVideoUploadService` REST** (§5.3) — not the dead-end the spec records |
| Enhanced Conversions / Customer Match | Out of scope here (#865); CM needs **1,000** for Search/YouTube; EEA needs Consent Mode v2 |
| Production spend | **BLOCKED on tier** (§7) |

---

## 10. Gaps & engineering implications — ranked

### GAP-1 — Production is hard-blocked by the developer-token tier; **Explorer is the unlock** · **HIGH**
**Ideal:** create/manage campaigns on customer `5083048929`.
**Reality:** TEST tier ⇒ `DEVELOPER_TOKEN_NOT_APPROVED` (403) on **every** production call, and `validate_only` **cannot** bypass it (§7.3). No Google AC beyond `AC-G-1` (fail-close) is testable today. Basic ≈ **5 business days** after a *complete* application (live site + monitored compliance email).
**Build:** (a) **read the live tier in the API Center first.** Explorer is granted **automatically, not by application**, reaches production at **2,880 ops/day**, and blocks only account-creation/user-management/planning/billing — **none of which we use**. We may already have it; if so the entire "provision-blocked" premise is stale and nothing but the adapter blocks us. (b) build + CI the adapter against a **test manager hierarchy** now (shape-valid, no token approval needed, ≤50 accounts); (c) keep `connect()` fail-closing `google_not_provisioned` (409) until the tier is *confirmed by a real API call*, not inferred; (d) **downgrade A3's `google/consumer` GREEN → AMBER**; (e) do **not** apply for Standard (RMF burden; we are Internal-Use-Only, which requires none).

### GAP-2 — `ChannelAdapter` structurally cannot express a valid Google ad · **HIGH**
**Ideal:** RSA with 3–15 headlines + 2–4 descriptions + keywords; or PMax asset groups.
**Reality:** the interface is `createCampaign → createAdSet → createAd` with **one creative** (Meta's shape). Google needs **N text assets per ad** (min 3 headlines + 2 descriptions) and **PMax has no ad groups or ads at all** — it is `AssetGroup` + `AssetGroupAsset` + `AssetGroupSignal`. Worse, **an AssetGroup and its minimum-required assets must be created in a single bulk mutate** (`AssetGroupError.NOT_ENOUGH_*` otherwise) — so PMax is **not expressible as sequential `createX` calls at all**; it *requires* `googleAds:mutate` with temp IDs. `createAd` returning `{externalId, reviewStatus}` also can't carry `{ad_group_id}~{ad_id}` semantics cleanly, and Google splits `approval_status` from `review_status` where Snap has one field.
**Build:** extend `ChannelAdapter` with an optional `createAssetGroup(...)` (or a per-platform capability descriptor) so PMax is reachable; widen the create input to `headlines[]`/`descriptions[]`; store the `~` composite in `external_ad_id`; add a `delivery_status` **+** `review_status` pair. **Decide explicitly: MVP = SEARCH-with-RSA only, PMax deferred** — and record it, because #864's channel picker currently advertises "Google = Search / Display."

### GAP-3 — The video "blocker" is wrong; the real work is a resumable upload · **HIGH (correction)**
**Ideal:** Bunny-hosted video → Google video ad.
**Reality:** `YoutubeVideoAsset` takes **no bytes/URL** (spec right), but **`YouTubeVideoUploadService.CreateYouTubeVideoUpload` accepts raw bytes over REST and, with `channel_id` omitted, uploads to a Google-managed channel** — **no YouTube channel and no YouTube Data API required** (§5.3). #866 OD-2 and the "Bunny cannot upload directly → hard dependency" framing are **wrong** and should be closed.
**Build:** `uploadToGoogle(video)` = fetch Bunny bytes → resumable REST (`X-Goog-Upload-Protocol: resumable`, `start`/`upload`/`finalize`, `X-Goog-Upload-Offset`) → **poll `PENDING→UPLOADED→PROCESSED`** (async, like Meta's `video_status`) → cache `youtube_video_id` in `ad_creative_platform_refs.external_ref` → `YoutubeVideoAsset`. Decide: Google-managed channel (**UNLISTED only**) vs our own brand channel (`channel_id` + user auth ⇒ **PUBLIC** allowed). Reject the YouTube Data API path (~100 uploads/day bucket, extra scope/channel/consent).

### GAP-4 — `dest_smart_link` cross-domain redirect vs. Google's destination-mismatch policy · **HIGH**
**Ideal:** ad → destination, same domain.
**Reality:** every channel points at the AppsFlyer OneLink **`go.usemingla.com`** → redirects to `usemingla.com`. Google's *destination mismatch* policy requires the display-URL domain to match the final URL and targets redirects that land on a different domain. Meta/Snap/TikTok tolerate this; **Google is materially stricter** — this risks disapproval of **every Google ad we create**, and it's a cross-cutting A1 decision, not a Google-local detail.
**Build:** validate before spend — options: (a) `final_urls=[canonical usemingla.com page]` + OneLink in `tracking_url_template` (the sanctioned Google pattern: tracking template redirects, final URL is the real page); (b) verify `go.usemingla.com` is a verified subdomain of the same registrable domain — **it is** (`usemingla.com`), which likely satisfies the policy, but this must be **confirmed, not assumed**. Test with one ad the moment tier allows.

### GAP-5 — Geo: name→ID resolution is ambiguous and IDs rot · **MEDIUM**
**Ideal:** "London" → `geoTargetConstants/1006886`.
**Reality:** we collect `targeting.countries[]` (Meta-style **country codes**). Google needs **numeric criterion IDs**. **"London" matches 5+ constants — London/Ontario/Canada sorts first**; a naive lookup targets the wrong continent. **2,916** constants are `Removal Planned` (**2,212 in GB/US/NG**), so cached IDs decay.
**Build:** ship the CSV (`geotargets-2026-07-06`, 273,644 rows) or call `SuggestGeoTargetConstants`; **disambiguate on `Country Code` + `Canonical Name`, never `Name`**; store the resolved ID + canonical name; refresh quarterly and alert on `Removal Planned`. Verified constants for our markets are tabulated in §3.4. Also set `positive_geo_target_type=PRESENCE` (default `PRESENCE_OR_INTEREST` shows London ads to people merely *interested* in London).

### GAP-6 — Destination is validated once, but Google polices it continuously · **MEDIUM**
**Ideal:** the ad's promise matches the live page.
**Reality:** we check `destination_not_public` **once at create** (422). Google's *unavailable offers* / *destination not working* policies apply **for the ad's whole life** — a sold-out, unpublished, or past-date event turns a live ad into a policy violation (and wasted spend). Nothing in the engine re-checks, and `admin-ad-campaign-sync` reads status but never revalidates the destination.
**Build:** extend the sync job to re-assert the destination is public+live+future and auto-pause (+ audit event) when it isn't. Cheap, and it protects the account, not just the campaign.

### GAP-7 — Text/creative collection is Meta-shaped; no RSA validator, no keywords · **MEDIUM**
**Ideal:** 3–15 headlines ≤30, 2–4 descriptions ≤90, path1/path2 ≤15, optional pinning, plus keywords + negatives.
**Reality:** builder collects `headline?` (one), `description?` (one), `message`, `call_to_action_type` (**not an RSA field at all**), and **no keywords** — a SEARCH campaign without keywords cannot meaningfully serve.
**Build (exact limits to enforce client- and server-side):** headlines **3–15 × ≤30**; descriptions **2–4 × ≤90** (**PMax = 5, and ≥1 must be ≤60**); path1/path2 ≤15; business_name ≤25; long_headline ≤90; final URL **≤2,084 bytes**; **≤3 enabled RSAs per ad group**; keyword **≤80 chars / ≤10 words** (allowed chars: letters, digits, space, `# $ & _ - " [ ] ' + . / :`), match `EXACT|PHRASE|BROAD`, **≤5,000 negatives/ad group, ≤10,000/campaign**; count double-width chars as 2; pinning restricted to `HEADLINE_1..3`/`DESCRIPTION_1..2`; block editorial tripwires (ALL-CAPS, `!!!`, repeated symbols) pre-submit. Map `age_min/age_max` → the **discrete** `AGE_RANGE_18_24…65_UP` set (+ decide `AGE_RANGE_UNDETERMINED`, which is a real audience segment, not a null).
⚠ **`AdGroupCriterion.negative` is IMMUTABLE** — a keyword cannot be flipped positive↔negative; it must be **removed and re-added**. Any "toggle negative" affordance in the builder must be implemented as remove+create, not update.

### GAP-8 — Image pipeline: no bytes path, no crop, wrong size ceiling · **MEDIUM**
**Ideal:** one master image → correct 1.91:1 / 1:1 / 4:5 crops ≤5120 KB.
**Reality:** #866's `uploadToGoogle` is specced as *"`ImageAsset` (bytes/URL)"* — **URL is not an option**; Google never fetches. The **API has no crop parameter** (only the UI crops). Our bucket allows **30 MB** and `{image/png,image/jpeg}` — a 30 MB image passes our gate and **fails Google's 5120 KB limit**; GIF/WEBP would pass a naive mime check but are **rejected** for marketing/logo assets.
**Build:** fetch bytes → validate ≤5120 KB and JPG/PNG → **auto-crop/resize** to 1200×628 / 1200×1200 / 960×1200 (min 600×314 / 300×300 / 480×600) → base64 → `assets:mutate` → cache `resource_name`. Enforce **unique asset names per account**. `LOGO` is **required** for PMax, and missing logos throttle Discover/Gmail.
**Also — stop Google swapping our destination:** set `asset_automation_settings` → **`FINAL_URL_EXPANSION_TEXT_ASSET_AUTOMATION` = `OPTED_OUT`** on PMax. **Do not use `url_expansion_opt_out`** — it is not a v24 field (§2.4); any code written to it will fail. Since our whole product is "this ad promotes *this* event page," leaving URL expansion on lets Google send paid traffic to a different page and quietly breaks both attribution and the *unavailable offers* policy posture in GAP-6.
**Asset immutability:** assets can't be edited — a creative change = new asset + relink, which **restarts review**. The creative library's ref cache (`ad_creative_platform_refs`) must key on content, not name, or we'll silently reuse a stale asset.

### GAP-9 — Version pinning, stale field names, and live deprecations · **LOW (but cheap to get wrong)**
Every one of these is a name in our specs/brief that **does not exist in v24**:

| Written as | Actually |
|---|---|
| `v25` | **doesn't exist** — current **v24.2**; v24 GA 2026-04-22, supported ~1 yr |
| `url_expansion_opt_out` | **`asset_automation_settings` → `FINAL_URL_EXPANSION_TEXT_ASSET_AUTOMATION` = `OPTED_OUT`** |
| `LIMITS_SERVING` / `FULLY_LIMITS_SERVING` | **`LIMITED`** / **`FULLY_LIMITED`** |
| `DISCOVERY` (=12) | **`DEMAND_GEN=14`** |
| `policy_violation_key` / `exempt_policy_violation_keys` | **`PolicyValidationParameter.ignorable_policy_topics`** (the old names are AdWords SOAP) |
| `video_brand_safety_suitability` (campaign field) | not a top-level field — content exclusions via `CampaignCriterion` |
| `BusinessNameAsset` / `BusinessLogoAsset` | not message types — `AssetFieldType` values on `TextAsset`/`ImageAsset` |
| `WhatsappBusinessMessageAsset` | nested variant inside `BusinessMessageAsset` |
| PMax search themes = 25 | **50** |
| RSA descriptions = 5 | **4** (PMax = 5) |

**Live deprecations to respect:** `CallAdInfo` **removed from the `Ad` oneof in v23** (new call ads unsupported since **2026-01-01**; existing stop serving **Feb 2027**) → use RSA + `CallAsset`. `ExpandedTextAd` creation dead since 2022-06-30. **Smart Campaigns deprecated for new creation 2026-08-03** — three weeks out; do not build toward `SMART`. `ACCELERATED` budget delivery sunset for Search/Shopping/shared.
**Build:** pin `GOOGLE_ADS_API_VERSION=v24`, calendar the ~April-2027 sunset (`UNSUPPORTED_VERSION` is a hard fail, not a warning), and correct the specs.

### GAP-10 — Smart-Bidding gating & spend semantics · **LOW**
tCPA/tROAS need **≥15 conv/30 days** — we have **no Google conversion tracking** (#865) and a fresh account, so **only `maximize_clicks`/`maximize_conversions` are honest today**; the builder must not offer tCPA/tROAS until volume exists. Surface Google's spend model (**≤2× daily, ≤30.4× monthly**) so "$20/day" isn't read as a hard cap. Note **`REMOVED` is permanent** — our `ARCHIVED`/`DELETED` statuses have no Google equivalent.

---

### Fastest honest path to a live Google ad
1. Re-verify the refresh token (§9.4.2); pin `v24`; downgrade the GREEN registry claim.
2. Check for **Explorer** access (2,880 prod ops/day) — likely unblocks production **without** waiting on Basic; otherwise complete the Basic application (~5 business days).
3. Build + CI the adapter against a **test manager account** now (no approved token required) — mutate shapes validate for free.
4. Widen the builder to RSA reality (**3–15 headlines / 2–4 descriptions + keywords + negatives**) — without this there is no Google ad to create.
5. Resolve GAP-4 (`go.usemingla.com` vs destination-mismatch) **before** first spend.
6. MVP = **SEARCH + RSA**, image assets pre-cropped from bytes. Defer PMax (GAP-2) and video (GAP-3) as fast-follows.
</content>
