# TikTok Paid-Ads Pipeline — Exhaustive Reference + Mingla Capability Map

Author: performance-marketing engineering research pass
Date: 2026-07-15
Advertiser probed: `7627974536397766673` (Mingla LLC_adv)
Posture: **READ-ONLY**. No create/update/mutate/delete/publish tool was invoked. All MCP writes were avoided; only `tool_list` / `tool_get` (schema inspection) and `get_`/`list_` reads were called.

---

## 0. Sources

### 0.1 Live MCP probes (read-only, 2026-07-15)

| Probe | Tool | Result summary |
|---|---|---|
| Advertiser info | `advertiser_info_get` | Mingla LLC_adv, USD, US, AUCTION, `STATUS_ENABLE`, balance `0.0` |
| Identity | `identity_get` | 1 identity — `@usemingla`, `TT_USER`, AVAILABLE |
| Identity videos | `identity_video_get` | `video_list: []` — **zero posts** |
| Pixel | `pixel_list_get` | 1 pixel — `Mingla Web`, `events: []` |
| Custom conversions | `custom_conversion_list_get` | `total_number: 0` |
| Custom audiences | `dmp_custom_audience_list_get` | `total_number: 0` |
| Saved audiences | `dmp_saved_audience_list_get` | `total_number: 0` |
| Catalogs | `catalog_get` (bc `7627974686760009729`) | `total_number: 0` |
| Apps | `app_list_get` | 2 apps (iOS + Android), AppsFlyer-linked |
| App optimization events | `app_optimization_event_get` | `optimization_events: []` |
| Asset library images | `file_image_ad_search` | `total_number: 0` |
| Locations (APP_PROMOTION) | `tool_region_get` | 33 countries; **no GB** |
| Locations (TRAFFIC) | `tool_region_get` | 33 countries; **no GB** |
| Schemas inspected | `tool_get` | `campaign_create`, `adgroup_create`, `ad_create`, `file_image_ad_upload`, `file_video_ad_upload`, `smart_plus_campaign_create`, `tool_region_get`, `advertiser_balance_get`, `ad_review_info_get` |
| Tool inventory | `tool_list` | ~50 groups, ~400 tools |

### 0.2 Official TikTok documentation

- TikTok Auction In-Feed Ads specs — https://ads.tiktok.com/help/article/tiktok-auction-in-feed-ads
- Global App Bundle video ad specs — https://ads.tiktok.com/help/article/global-app-bundle-video-ad-specifications
- Global App Bundle image ad specs — https://ads.tiktok.com/help/article/global-app-bundle-image-ad-specifications
- Carousel Ads specs — https://ads.tiktok.com/help/article/specifications-for-carousel-ads
- Pangle ad asset specs — https://ads.tiktok.com/help/article/specifications-for-pangle-ad-assets
- About Budget — https://ads.tiktok.com/help/article/budget
- Ad Format and Functionality policy — https://ads.tiktok.com/help/article/tiktok-ads-policy-ad-format-and-functionality
- Ad Creatives and Landing Page: Prohibited Content — https://ads.tiktok.com/help/article/tiktok-advertising-policies-ad-creatives-landing-page-prohibited-content
- Ad Review FAQs — https://ads.tiktok.com/help/article/ad-review-faq
- About Spark Ads — https://ads.tiktok.com/help/article/spark-ads
- About Smart+ Campaigns — https://ads.tiktok.com/help/article/about-smart-plus-campaign
- Creative best practices for performance ads — https://ads.tiktok.com/help/article/creative-best-practices
- About the Call to Action button — https://ads.tiktok.com/help/article/in-app-behavior-call-to-action-button
- Marketing API portal — https://business-api.tiktok.com/portal/docs
- Official SDK (field inventory) — https://github.com/tiktok/tiktok-business-api-sdk

### 0.3 Mingla internal specs

- `/Users/sethogieva/Desktop/mingla-orchs/issue-863-tiktok-ads-api/Mingla_Artifacts/specs/SPEC_ISSUE-863_TIKTOK_ADS_CAMPAIGN_ENGINE.md` (490 lines)
- `/Users/sethogieva/Desktop/mingla-orchs/issue-862-meta-ads-api/Mingla_Artifacts/specs/SPEC_ISSUE-862_META_ADS_CAMPAIGN_ENGINE.md` (603 lines; A3 unified model = lines 43–211)
- `/Users/sethogieva/Desktop/mingla-orchs/issue-866-creative-library/Mingla_Artifacts/specs/SPEC_ISSUE-866_CREATIVE_LIBRARY.md` (381 lines)
- `/Users/sethogieva/Desktop/mingla-orchs/issue-864-campaign-builder-ui/Mingla_Artifacts/specs/SPEC_ISSUE-864_CAMPAIGN_BUILDER_UI.md`
- `/Users/sethogieva/Desktop/mingla-orchs/issue-864-campaign-builder-ui/Mingla_Artifacts/reports/UI_UX_ISSUE-864_CAMPAIGN_BUILDER.md`

---

## 1. Object hierarchy

### 1.1 The tree

```
TikTok for Business Account
└── Business Center (BC)            id 7627974686760009729   (19-digit numeric string)
    └── Advertiser (ad account)     id 7627974536397766673   (19-digit numeric string)
        ├── Identity                id b3f0f8f4-1beb-5c23-8a2c-9f440cec58a5  (UUID — NOT numeric)
        ├── Pixel                   id 7662469356818858002 / code D9B98EBC77U1EOHV2O0G
        ├── App (MMP-linked)        app_id 7659053200868786183 (Android) / 7659045322872684562 (iOS)
        ├── Asset Library           image_id + material_id / video_id + material_id
        ├── Catalog (BC-scoped)     none provisioned
        ├── Custom / Saved audience none provisioned
        └── Campaign                (max 999 per ad account)
            └── Ad group            ("adgroup" — TikTok's name for Meta's ad set)
                └── Ad              (max 50 per ad group; max 20 per /ad/create/ call)
                    └── Creative    (INLINE inside ad_create — no standalone creative object)
```

### 1.2 ID formats (live-observed)

| Object | Format | Live value |
|---|---|---|
| Business Center | 19-digit numeric string | `7627974686760009729` |
| Advertiser | 19-digit numeric string | `7627974536397766673` |
| Identity (TT_USER) | **UUID** | `b3f0f8f4-1beb-5c23-8a2c-9f440cec58a5` |
| Pixel | 19-digit numeric string | `7662469356818858002` |
| Pixel code | 20-char alphanumeric | `D9B98EBC77U1EOHV2O0G` |
| App | 19-digit numeric string | `7659053200868786183` |
| TikTok app | 19-digit numeric string | `7659053200868769799` |
| app_platform_id | package/store id | `com.mingla.app.v2` / `6760440898` |
| Location | 6–7-digit numeric string | US `6252001`, NG `2328926` |
| Campaign / adgroup / ad | 19-digit numeric string | n/a |
| Image asset | `image_id` + `material_id` | n/a |
| Video asset | `video_id` + `material_id` | n/a |

**Critical asymmetry:** identity is a UUID; everything else is a numeric snowflake. `location_id` is numeric and **country codes are NOT accepted** — a lookup table is mandatory.

### 1.3 Creative is not an object

Unlike Meta (`adcreative` is a first-class object with its own `creative_id`), **TikTok has no standalone creative entity.** The creative is an inline element of the `creatives[]` array inside `ad_create`. This is confirmed by the #862 A3 model, which annotates `ads.external_creative_id` as *"Meta creative_id; NULL for TikTok (creative is inline in ad_create)"*. The only persistent creative artifacts are Asset Library entries (`image_id`/`video_id` + `material_id`).

### 1.4 Standard vs Smart+ vs GMV Max — three parallel API surfaces

| Surface | Endpoints | Objectives | Notes |
|---|---|---|---|
| **Standard (auction)** | `campaign_create` → `adgroup_create` → `ad_create` | Full set (8) | Full manual control. **This is what we build.** |
| **Smart+** | `smart_plus_campaign_create` → `smart_plus_adgroup_create` → `smart_plus_ad_create` | **Only 3**: `APP_PROMOTION`, `WEB_CONVERSIONS`, `LEAD_GENERATION` | AI-automated targeting/creative/placement/budget. `request_id` **required** (unlike standard). |
| **GMV Max** | `campaign_gmv_max_create` + `gmv_max_*` | TikTok Shop only | Not applicable — no Shop, no catalog. |
| **Reach & Frequency** | `adgroup_rf_create` | `RF_REACH` | Reservation buying. Separate booking flow. |

**Smart+ objective limit is a hard constraint:** there is **no `TRAFFIC` and no `REACH` objective in Smart+**. Our MVP objective is `TRAFFIC` (drive to a public page), which Smart+ structurally cannot express. Smart+ only becomes viable via `WEB_CONVERSIONS`, which requires a working pixel with events (see §9.4). The #863 spec reached the same conclusion (OD-3) and deferred Smart+.

---

## 2. Campaign level — every field

**Endpoint:** `POST /open_api/v1.3/campaign/create/`
**Required (MCP schema, live):** `advertiser_id`, `objective_type`, `campaign_name` — only 3.
**Limit:** 999 campaigns per ad account.

### 2.1 Core fields

| Field | Type | Req | Enum / limits | Notes |
|---|---|---|---|---|
| `advertiser_id` | string | **Y** | — | `7627974536397766673` |
| `campaign_name` | string | **Y** | **max 512 chars, NO emoji** | CJK/JP word = 2 chars; Latin letter = 1 |
| `objective_type` | string | **Y** | **NO ENUM in MCP schema** (free string) | See §2.2 |
| `budget_mode` | string | cond | `BUDGET_MODE_INFINITE`, `BUDGET_MODE_TOTAL`, `BUDGET_MODE_DYNAMIC_DAILY_BUDGET`, `BUDGET_MODE_DAY` | Required unless `objective_type=RF_REACH` |
| `budget` | number (double) | cond | **major units (dollars), NOT cents** | Required when mode = DAY / DYNAMIC_DAILY / TOTAL |
| `budget_optimize_on` | boolean | N | `true` only | **CBO toggle.** Supported value is `true` |
| `operation_status` | string | N | `ENABLE`, `DISABLE` | Default `ENABLE`. **We create `DISABLE`** |
| `campaign_type` | string | N | `REGULAR_CAMPAIGN`, `IOS14_CAMPAIGN` | Use `REGULAR_CAMPAIGN` |
| `special_industries` | array | N | `HOUSING`, `EMPLOYMENT`, `CREDIT` | US/CA advertisers GA. Removable but not changeable |
| `request_id` | string | N | 64-bit int as string | **Native idempotency.** Same `request_id` within 10 s → only one succeeds |
| `po_number` | string | N | — | Invoice reconciliation |

### 2.2 `objective_type` — full enum

MCP schema declares `objective_type` as a **bare `string` with no enum** — a real schema gap. From official SDK + docs, the accepted auction values are:

```
REACH
TRAFFIC
VIDEO_VIEWS
ENGAGEMENT
APP_PROMOTION
LEAD_GENERATION
WEB_CONVERSIONS
PRODUCT_SALES
```

Plus `RF_REACH` (Reach & Frequency reservation). A newer `virtual_objective_type=SALES` combines `WEB_CONVERSIONS` + `PRODUCT_SALES` and requires `sales_destination`.

Because the MCP does not enum-constrain this, **our adapter must validate `objective_type` client-side** or TikTok returns a runtime validation error.

### 2.3 `budget_mode` rules (verbatim from schema)

- `budget_optimize_on=true` (CBO) → supported: `BUDGET_MODE_TOTAL`, `BUDGET_MODE_DYNAMIC_DAILY_BUDGET`, `BUDGET_MODE_DAY`
- `budget_optimize_on` off → supported: `BUDGET_MODE_INFINITE`, `BUDGET_MODE_TOTAL`, `BUDGET_MODE_DAY`
- `BUDGET_MODE_DYNAMIC_DAILY_BUDGET` = average daily budget over a week. **Daily cost ≤ 125% of average; weekly cost ≤ average × 7**
- For `TRAFFIC`, `APP_PROMOTION`, `WEB_CONVERSIONS`, `LEAD_GENERATION`, `PRODUCT_SALES` (VSA only), `REACH`, `VIDEO_VIEWS`, `ENGAGEMENT` — use `BUDGET_MODE_DYNAMIC_DAILY_BUDGET` for a non-lifetime budget
- Dynamic daily budget for `REACH`/`VIDEO_VIEWS`/`ENGAGEMENT` is **allowlist-only**
- Non-CBO `BUDGET_MODE_DAY` is **deprecated** for `REACH`, `VIDEO_VIEWS`, `ENGAGEMENT`
- `objective_type=RF_REACH` → only `BUDGET_MODE_INFINITE`

### 2.4 `bid_type` — DEPRECATED at campaign level

v1.3 **deprecates** campaign-level `budget_optimize_switch` (→ `budget_optimize_on`), `bid_type`, `deep_bid_type`, `roas_bid`, `optimize_goal`. `industry_types` → `special_industries`. The official SDK still lists `bid_type` on `CampaignCreateBody` — **ignore it; set bidding at the ad group.**

### 2.5 iOS 14 / SKAN fields

| Field | Enum | Notes |
|---|---|---|
| `app_id` | string | Req when `IOS14_CAMPAIGN` + (`PRODUCT_SALES` or `APP_PROMOTION`+`APP_INSTALL`) |
| `app_promotion_type` | `APP_INSTALL`, `APP_RETARGETING`, `APP_PREREGISTRATION` | Req when `APP_PROMOTION`. Pre-reg = allowlist |
| `campaign_app_profile_page_state` | `ON`, `OFF` | iOS14 dedicated only |
| `disable_skan_campaign` | boolean | Allowlist. Requires `advanced_dedicated_campaign_allowed` — **our apps: `false`** |
| `is_advanced_dedicated_campaign` | boolean | Immutable. **Our apps: not allowed** |
| `postback_window_mode` | `POSTBACK_WINDOW_MODE1/2/3` | Only when `IOS14_CAMPAIGN` + `operation_status=DISABLE`. MODE1 = 0–2 day window / quota released ≤4 d; MODE2 = 3–7 d / ≤13 d; MODE3 = 8–35 d / ≤41 d |

### 2.6 Immutable-after-create

`is_search_campaign`, `is_advanced_dedicated_campaign`, `disable_skan_campaign`, `rf_campaign_type`, `catalog_enabled`, `postback_window_mode`, `rta_id`, `rta_bid_enabled`, `rta_product_selection_enabled`.

### 2.7 Allowlist-gated (will 400 for us)

App Pre-Registration · `sales_destination=WEB_AND_APP` · Search Ads (`is_search_campaign`) · TikTok Pulse (`rf_campaign_type=PULSE`) · Product Sales · disable-SKAN · RTA / RTA bid / RTA product selection · CBO for VSA with `CATALOG`.

### 2.8 Smart+ campaign delta

`smart_plus_campaign_create` required: `advertiser_id`, **`request_id`**, `objective_type`, `campaign_name`.
`objective_type` enum: **`APP_PROMOTION` | `WEB_CONVERSIONS` | `LEAD_GENERATION`** (3 only).
`budget_optimize_on` **defaults to `true`**; `budget_mode` defaults `BUDGET_MODE_DYNAMIC_DAILY_BUDGET` (CBO on) or `BUDGET_MODE_INFINITE` (CBO off). `budget_mode` immutable.
`app_promotion_type` adds `MINIS`. `budget_auto_adjust_strategy=AUTO_BUDGET_INCREASE` (allowlist) → +20% up to 10×/day at ≥90% utilization.

---

## 3. Ad group level — every field

**Endpoint:** `POST /open_api/v1.3/adgroup/create/`
**Property count (MCP live): 110.**
**Required (10):** `advertiser_id`, `campaign_id`, `adgroup_name`, `budget_mode`, `budget`, `schedule_type`, `schedule_start_time`, `optimization_goal`, `billing_event`, `pacing`.

### 3.1 Budget + EXACT minimums — CONFIRMED

| Level | Daily minimum | Lifetime minimum |
|---|---|---|
| **Campaign** | **> $50 USD** | **> $50 USD** |
| **Ad group** | **> $20 USD** | **$20 × scheduled days** (31 days → **$620**) |

Confirmed verbatim from https://ads.tiktok.com/help/article/budget. Additional numeric rules from the same page:

- Budget increases **during** learning phase: **≤ 40% per adjustment**
- Budget increases **after** learning phase: **≤ 30% per adjustment**
- Adjustment frequency: **not more often than every 2 days**
- Campaign budget must **not** be lower than ad group budget (delivery issues)

**Not exposed by any read API.** `advertiser_info_get` does not return a minimum. The create call returns a validation error below it. The #863 spec is correct to leave `ad_connections.min_daily_budget_cents` NULL for TikTok and to surface the error verbatim (no silent clamp).

`budget_mode` (ad group) enum: `BUDGET_MODE_TOTAL`, `BUDGET_MODE_DYNAMIC_DAILY_BUDGET`, `BUDGET_MODE_DAY` — **note: no `BUDGET_MODE_INFINITE` at ad group level.** Under CBO, ad-group `budget`/`budget_mode` are **ignored**.

### 3.2 Schedule + dayparting

| Field | Format / enum | Notes |
|---|---|---|
| `schedule_type` | `SCHEDULE_START_END`, `SCHEDULE_FROM_NOW` | `BUDGET_MODE_TOTAL` **forces** `SCHEDULE_START_END` |
| `schedule_start_time` | `YYYY-MM-DD HH:MM:SS` **UTC+0** | ≤12 h in the past; **no later than `2028-01-01 00:00:00`** |
| `schedule_end_time` | `YYYY-MM-DD HH:MM:SS` **UTC+0** | Req when `SCHEDULE_START_END` or `BUDGET_MODE_TOTAL`. **No later than `2038-01-01 00:00:00`** |
| `dayparting` | **336-char string of `0`/`1`** | **48 × 7 = 336.** Char 1 = Mon 00:01–00:30; char 2 = Mon 00:31–01:00; char 336 = Sun 23:31–00:00. All-`0` / all-`1` / omitted = full-time |

**Note a spec bug:** #863 says `schedule_start_time` is *"in the advertiser timezone"*. The live MCP schema says **UTC+0**. Our advertiser timezone is `Etc/GMT+5` / `America/New_York` — a 5-hour error. This must be fixed.

### 3.3 Bidding + optimization

| Field | Enum | Notes |
|---|---|---|
| `optimization_goal` | **`CLICK`, `INSTALL`, `IN_APP_EVENT`, `SHOW`, `REACH`, `LEAD_GENERATION`, `CONVERSATION`, `FOLLOWERS`, `PAGE_VISIT`, `VALUE`, `AUTOMATIC_VALUE_OPTIMIZATION`, `ENGAGED_VIEW`, `ENGAGED_VIEW_FIFTEEN`, `TRAFFIC_LANDING_PAGE_VIEW`, `DESTINATION_VISIT`, `PREFERRED_LEAD`** (16) | v1.3 **deprecates `VIDEO_VIEW`** |
| `billing_event` | **NO ENUM in MCP schema** | Docs: `CPC`, `CPM`, `OCPM`, `CPV`. Each optimization goal has a required billing event |
| `bid_type` | **NO ENUM in MCP schema** | Docs: `BID_TYPE_NO_BID` (lowest cost / max delivery), `BID_TYPE_CUSTOM` (cost cap). **Required when CBO on.** Under one CBO campaign, must match the first ad group |
| `bid_price` | number | Req when `bid_type=BID_TYPE_CUSTOM` **and** `billing_event ∈ {CPC, CPM, CPV}`. Must be **lower than** campaign-level AND ad-group-level budget |
| `conversion_bid_price` | number | Conversion bid |
| `pacing` | `PACING_MODE_SMOOTH`, `PACING_MODE_FAST` | **Ignored under CBO → forced `PACING_MODE_SMOOTH`.** Otherwise **required** |
| `bid_display_mode` | `CPV` | **Required and must be `CPV`** when `objective_type=VIDEO_VIEW`. Immutable. `CPMV` deprecated in v1.3 |
| `deep_bid_type` | `VO_MIN_ROAS`, `VO_HIGHEST_VALUE` | Allowlist. Required when CBO + `optimization_goal=VALUE`. Required whenever `secondary_optimization_event` is set |
| `roas_bid` | number | ROAS target |
| `skip_learning_phase` | boolean (v1.3) | — |

### 3.4 Pixel / conversion

| Field | Notes |
|---|---|
| `pixel_id` | Our pixel `7662469356818858002` |
| `optimization_event` | **Required when `pixel_id` is specified**, or when `optimization_goal ∈ {IN_APP_EVENT, VALUE}` without pixel. Auto-set to `PAGE_VISIT` when `optimization_goal=PAGE_VISIT`. Must match first ad group under CBO |
| `custom_conversion_id` | none provisioned |
| `secondary_optimization_event` | Requires `deep_bid_type` |
| `statistic_type` | `EVERYTIME` (each purchase), `NONE` (unique purchase) |
| `attribution_event_count` | `UNSET`, `EVERY`, `ONCE` |
| `click_attribution_window` | `OFF`, `ONE_DAY`, `SEVEN_DAYS`, `FOURTEEN_DAYS`, `TWENTY_EIGHT_DAYS` |
| `view_attribution_window` | `OFF`, `ONE_DAY`, `SEVEN_DAYS` |
| `engaged_view_attribution_window` | `ONE_DAY`, `SEVEN_DAYS` |
| `vbo_window` | `SEVEN_DAYS`, `ZERO_DAY` |

### 3.5 Deep funnel

| Field | Enum |
|---|---|
| `deep_funnel_optimization_status` | `ON`, `OFF` |
| `deep_funnel_event_source` | `PIXEL`, `OFFLINE`, `CRM` |
| `deep_funnel_event_source_id` | string |
| `deep_funnel_optimization_event` | string |

### 3.6 Targeting — complete

| Field | Type / enum | Limits |
|---|---|---|
| `location_ids` | array of **numeric** strings | **Must set `location_ids` or `zipcode_ids` or both.** **Max 3,000 combined.** **Overlapping not supported** (cannot target US + California together). If you target US on create, you may switch US→US but **cannot remove all US locations** to target only non-US |
| `zipcode_ids` | array | counts toward the 3,000 |
| `age_groups` | array | `AGE_13_17`, `AGE_18_24`, `AGE_25_34`, `AGE_35_44`, `AGE_45_54`, `AGE_55_100`. **`AGE_13_17` restricted** in US/LatAm/EEA/UK/CH/CA. If unspecified/`[]` in those regions → defaults to `["AGE_18_24","AGE_25_34","AGE_35_44","AGE_45_54","AGE_55_100"]` |
| `gender` | `GENDER_FEMALE`, `GENDER_MALE`, `GENDER_UNLIMITED` | — |
| `languages` | array of codes | Omit / `[]` = all |
| `interest_category_ids` | array | via `tool_interest_category_get` |
| `interest_keyword_ids` | array | via `tool_interest_keyword_get` |
| `purchase_intention_keyword_ids` | array | — |
| `actions` | array of objects | `action_scene ∈ {VIDEO_RELATED, CREATOR_RELATED, HASHTAG_RELATED}`; `action_period ∈ {0, 7, 15}` days (`CREATOR_RELATED`/`HASHTAG_RELATED` force `0`); `action_category_ids` **valid only when TikTok is the only placement** |
| `included_custom_actions` / `excluded_custom_actions` | array | — |
| `audience_ids` | array | custom audiences to **include** — **we have 0** |
| `excluded_audience_ids` | array | custom audiences to **exclude** — **we have 0** |
| `saved_audience_id` | string | **we have 0** |
| `audience_type` | `NEW_CUSTOM_AUDIENCE` | — |
| `audience_rule` | object | — |
| `smart_audience_enabled` | boolean | — |
| `smart_interest_behavior_enabled` | boolean | — |
| `household_income` | `TOP5`, `TOP10`, `TOP10_25`, `TOP25_50` | US-centric |
| `spending_power` | `ALL`, `HIGH` | — |
| `operating_systems` | `ANDROID`, `IOS` | — |
| `min_android_version` / `min_ios_version` | string | Set `16.1` for SKAN 4.0 postbacks |
| `ios14_targeting` | `UNSET`, `IOS14_MINUS`, `IOS14_PLUS`, `ALL` | iOS14 dedicated → `IOS14_PLUS`; **max 2 active ad groups per such campaign** |
| `device_model_ids` | array | via `tool_device_model_get` |
| `device_price_ranges` | array of numbers | **Multiples of 50.** `10000` = 1000+. Upper limit **+50** in practice: `[0,250]` = `[0,300]` in Ads Manager |
| `network_types` | array | WIFI / 2G / 3G / 4G / 5G |
| `carrier_ids` / `isp_ids` | array | via `tool_carrier_get` |
| `contextual_tag_ids` | array | via `tool_contextual_tag_get` |

### 3.7 Placement

| Field | Enum | Notes |
|---|---|---|
| `placement_type` | `PLACEMENT_TYPE_AUTOMATIC`, `PLACEMENT_TYPE_NORMAL` | Default `PLACEMENT_TYPE_NORMAL`. **Immutable** |
| `placements` | `PLACEMENT_TIKTOK`, `PLACEMENT_PANGLE`, `PLACEMENT_GLOBAL_APP_BUNDLE` | Required when `NORMAL`; **ignored + overwritten** when `AUTOMATIC`. **Immutable.** `PLACEMENT_TOPBUZZ` / `PLACEMENT_HELO` **deprecated — do not use** |
| `tiktok_subplacements` | `IN_FEED`, `SEARCH_FEED`, `LEMON8` | Schema enum. Description also names `TIKTOK_LITE` (JP/KR only) but it is **not in the enum** |
| `search_result_enabled` | boolean | Search feed toggle |
| `blocked_pangle_app_ids` | array | Pangle only |
| `included_pangle_audience_package_ids` / `excluded_...` | array | Pangle only |

`PLACEMENT_GLOBAL_APP_BUNDLE` constraints (verbatim): available **only** in Brazil, Indonesia, Vietnam, the Philippines, Thailand, Malaysia, Mexico, Saudi Arabia, Japan. **Does not support `optimization_goal=TRAFFIC_LANDING_PAGE_VIEW`.** Allowlist-only in Auction Reach. With `objective_type=REACH` + GAB you cannot also set `contextual_tag_ids`; with `placements=["PLACEMENT_GLOBAL_APP_BUNDLE"]` you cannot set `brand_safety_type=THIRD_PARTY`. `PRODUCT_SALES` → **only `PLACEMENT_TIKTOK`**.

### 3.8 Comment / download / share toggles + brand safety

| Field | Type / enum | Notes |
|---|---|---|
| `comment_disabled` | boolean | — |
| `video_download_disabled` | boolean | — |
| `share_disabled` | boolean | — |
| `brand_safety_type` | `NO_BRAND_SAFETY`, `EXPANDED_INVENTORY`, `STANDARD_INVENTORY`, `LIMITED_INVENTORY`, `THIRD_PARTY` | Default `NO_BRAND_SAFETY`. **`EXPANDED_INVENTORY` will replace `NO_BRAND_SAFETY` as default in the next API version.** Pre-bid 1P brand safety for `APP_PROMOTION`/`WEB_CONVERSIONS`/`TRAFFIC`/`LEAD_GENERATION` is **allowlist-only** |
| `brand_safety_partner` | `IAS`, `OPEN_SLATE` | Req when `THIRD_PARTY`; TikTok placement only. Allowlist |
| `category_exclusion_ids` | array | Only when objective ∈ {REACH, VIDEO_VIEWS, ENGAGEMENT, RF_REACH, APP_PROMOTION, WEB_CONVERSIONS, TRAFFIC, LEAD_GENERATION} **and** `placements=["PLACEMENT_TIKTOK"]` **and** `brand_safety_type ∈ {STANDARD_INVENTORY, LIMITED_INVENTORY}` |
| `vertical_sensitivity_id` | string | Only when objective ∈ {REACH, VIDEO_VIEWS, ENGAGEMENT} + TikTok-only + STANDARD/LIMITED |

### 3.9 Frequency

`frequency` + `frequency_schedule` — **`REACH` ads only.** Bounds: `1 ≤ frequency ≤ 1000` and `1 ≤ frequency_schedule ≤ 30`. Example: `frequency=2, frequency_schedule=3` → "no more than twice every 3 days".

### 3.10 Other

| Field | Enum / notes |
|---|---|
| `promotion_type` | **NO ENUM in schema.** Required unless objective ∈ {REACH, VIDEO_VIEWS, ENGAGEMENT}. `ENGAGEMENT` → only `EXTERNAL_OR_DISPLAY`. Docs values include `WEBSITE`, `APP_ANDROID`, `APP_IOS`, `LEAD_GEN_CLICK_TO_CALL`, `LEAD_GEN_CLICK_TO_TT_DIRECT_MESSAGE`, `LEAD_GEN_CLICK_TO_SOCIAL_MEDIA_APP_MESSAGE`, `LIVE_SHOPPING`, `EXTERNAL_OR_DISPLAY` |
| `promotion_target_type` | `INSTANT_PAGE`, `EXTERNAL_WEBSITE` — `LEAD_GENERATION` only |
| `promotion_website_type` | `UNSET`, `TIKTOK_NATIVE_PAGE` |
| `creative_material_mode` | `CUSTOM` (default). **`DYNAMIC` (Automated Ads) deprecated** → use Smart Creative with `CUSTOM` |
| `operation_status` | `ENABLE`, `DISABLE` |
| `identity_id` / `identity_type` | **Ad-group level only for** (`shopping_ads_type=VIDEO` + `product_source=SHOWCASE`) or `shopping_ads_type=LIVE`. Enum here is `AUTH_CODE`, `TT_USER`, `BC_AUTH_TT` — **note `CUSTOMIZED_USER` is absent at ad-group level** |
| `search_keywords` | Search campaigns only. **Max 1,000/ad group**; keyword **max 80 chars**; excludes emoji and `! # $ % & ( ) * - / : ; < > ? @ \ ^ _ ¥ ……`. Review via `adgroup_get` → `search_keywords[].audit_status` |
| `is_hfss` | boolean — high fat/salt/sugar (UK) |
| `is_lhf_compliance` | boolean |
| `message_event_set_id`, `messaging_app_type` (`MESSENGER`/`WHATSAPP`/`ZALO`/`LINE`/`IM_URL`), `messaging_app_account_id`, `phone_number`, `phone_region_code`, `phone_region_calling_code` | Messaging/call ads |
| `shopping_ads_type` | `VIDEO`, `LIVE`, `PRODUCT_SHOPPING_ADS` |
| `product_source` | `UNSET`, `CATALOG`, `STORE`, `SHOWCASE` |
| `shopping_ads_retargeting_type` | `LAB1`, `LAB2`, `LAB3`, `OFF` |
| `next_day_retention` | number |
| `automated_keywords_enabled` | boolean |

### 3.11 Immutable-after-create

`placement_type`, `placements`, `bid_display_mode`, `deeplink_format_type` (ad), `tracking_message_event_set_id`, plus objective/campaign-level immutables.

---

## 4. Ad & creative level — every field

**Endpoint:** `POST /open_api/v1.3/ad/create/`
**Required (top):** `advertiser_id`, `adgroup_id`, `creatives` (array, **max 20 per call**).
**Required (per creative):** `ad_name`, `identity_type`, `identity_id`, `ad_format`.

**Ads-per-ad-group ceilings (verbatim):** 20 for `RF_REACH`; 20 for `PRODUCT_SALES` + `campaign_product_source=STORE`; **50** for `PRODUCT_SALES` + `CATALOG`; **50** for all other objectives.

### 4.1 THE DEPRECATION THAT BLOCKS US

Verbatim from the live `ad_create` description:

> *"Important deprecation: creating non-Spark Ads using Custom Identities in ad groups that deliver to Automatic Placement or Select Placement when TikTok is included is no longer supported for existing ad accounts, and **all new ad accounts created on or after January 15, 2026 cannot create non-Spark Ads using Custom Identities for these placements**. Existing ads remain editable. Campaigns that deliver only to Pangle or Global App Bundle placements are not affected."*

**Our advertiser `create_time` = `1776026274` = 2026-04-12 20:37:54 UTC — AFTER the 2026-01-15 cutoff.**

Consequence: **`identity_type=CUSTOMIZED_USER` is unusable for any TikTok-placement ad on our account.** We must use `TT_USER` (`@usemingla` — which we have) or `AUTH_CODE` (Spark Ads). This is not a soft warning; it is a hard account-class restriction. The #863 spec's choice of `TT_USER` is therefore not merely a preference — it is **the only viable non-Spark path**, and the spec never states why.

### 4.2 Identity

| Field | Enum | Notes |
|---|---|---|
| `identity_type` | **`CUSTOMIZED_USER`, `AUTH_CODE`, `TT_USER`, `BC_AUTH_TT`** | **Required.** `CUSTOMIZED_USER` blocked for us (§4.1) |
| `identity_id` | string (UUID for TT_USER) | **Required.** Ours: `b3f0f8f4-1beb-5c23-8a2c-9f440cec58a5` |
| `identity_authorized_bc_id` | string | **Required when `BC_AUTH_TT`** |

Semantics: `TT_USER` = TikTok Business Account User (our `@usemingla`). `AUTH_CODE` = Authorized Post User (Spark Ads via creator authorization code). `BC_AUTH_TT` = TikTok account a Business Center is authorized to access. `CUSTOMIZED_USER` = custom display name + avatar, no real TikTok account.

**Identity is required for `ad_create` — no identity, no ad.** We have one and it is `AVAILABLE`, so ad creation is unblocked on the identity axis.

### 4.3 Format + media

| Field | Enum / limits | Notes |
|---|---|---|
| `ad_format` | **`SINGLE_IMAGE`, `SINGLE_VIDEO`, `LIVE_CONTENT`, `CAROUSEL_ADS`, `CATALOG_CAROUSEL`** | **Required.** `CAROUSEL_ADS`/`CATALOG_CAROUSEL` **immutable**. Note: **there is no `SPARK` ad_format** — Spark is expressed via `identity_type` + `tiktok_item_id` |
| `video_id` | string | Req when `SINGLE_VIDEO` + `CUSTOMIZED_USER`. With `TT_USER`/`BC_AUTH_TT` → pass **either** `video_id` **or** `tiktok_item_id`. **Not supported** for `SINGLE_IMAGE`/`CAROUSEL_ADS` |
| `image_ids` | array | `SINGLE_VIDEO` → **required, exactly 1** = the video cover, **same aspect ratio as the video**. `CAROUSEL_ADS` → **required, 1–35**, order = display order. `CATALOG_CAROUSEL` → exactly 1 (summary photo). `SINGLE_IMAGE` → **required, exactly 1** |
| `tiktok_item_id` | string | **Spark Ads Pull.** Required when `identity_type=AUTH_CODE`, or `BC_AUTH_TT` + Pull. **Not supported with `CUSTOMIZED_USER`.** From `tt_video_info_get` / `identity_video_get` |
| `music_id` | string | **Required** for `CAROUSEL_ADS` (Push / non-Spark) and `CATALOG_CAROUSEL` |
| `avatar_icon_web_uri` | string | Avatar image ID, **1:1 required** |
| `playable_url` | string | Pangle + TikTok. **Since 2024-09-30 Playable Ads can no longer be created for TikTok placement** |

### 4.4 Text — EXACT limits

| Field | **Limit** | Emoji |
|---|---|---|
| `ad_text` | **Max 100 characters** | **NOT allowed** |
| `ad_texts` | **Max 5 items, each max 100 characters** | **NOT allowed.** Search Ads only. If both `ad_text` and `ad_texts` set → **`ad_text` is ignored** |
| `ad_name` | **Max 512 characters** | **NOT allowed.** Pass `""` to auto-generate (name becomes `ad_id`) |
| `campaign_name` | **Max 512 characters** | **NOT allowed** |
| `adgroup_name` | Max 512 characters | NOT allowed |
| `app_name` | **1–40 characters** | Required if store name > 40 |
| `display_name` | **1–40 Latin, or 1–20 CJK** | **Required** for landing-page / pure-exposure promotion |
| `disclaimer_text.text` | **Max 90 characters** | — |
| `disclaimer_clickable_texts[].text` | **Max 40 chars each AND max 40 combined**, max 3 items | — |

Character counting rule (verbatim, applies to `ad_text`/`ad_name`/`campaign_name`): *"Each Chinese or Japanese word counts as two characters; each English letter counts as one."*

**Emoji rule is asymmetric and important:** `ad_text` on a **non-Spark** ad **forbids emoji**. But a **Spark Ad** uses the *organic post's caption*, which **does** support emoji — TikTok's in-feed spec says *"A maximum of 4 lines can be displayed, including emojis."* So emoji in ad copy is only reachable via Spark. Also: *"you cannot edit a post's caption after it's been authorized as an ad."*

`ad_text`/`ad_texts` requirement: *"For Spark Ads Push, `ad_text` is required. For non-Spark Ads, either `ad_text` or `ad_texts` must be set."*

### 4.5 Call to action

| Field | Notes |
|---|---|
| `call_to_action` | **NO ENUM in MCP schema** (free string). Ignored if `call_to_action_id` is set |
| `call_to_action_id` | CTA portfolio ID. **Wins over `call_to_action`** |

**Full CTA list (landing-page destinations), from TikTok help:**

```
Apply now · Book now · Contact us · Download · Experience now · Get quote ·
Get showtimes · Get ticket now · Install now · Interested · Join this hashtag ·
Learn more · Listen now · Order now · Play game · Pre-order now · Read more ·
Shoot with this effect · Shop now · Sign up · Subscribe · View now ·
View video with this effect · Visit store · Watch now
```

**App-download destinations — only 4:** `Download`, `Learn more`, `Listen now`, `Play game`.
**Default: `Learn more`.** CTA text is **auto-translated** to the viewer's app language; untranslated CTAs fall back to English. `Join this hashtag` requires a commercial/sponsored Hashtag Challenge. Live Shopping with `creative_type=SHORT_VIDEO_LIVE` → **must be `WATCH_LIVE`**.

Relevant for Mingla: `Get ticket now` / `Book now` / `Get showtimes` map cleanly to experiences/events. `Download` for app-install. `creative_cta_recommend_get` returns TikTok's recommended CTA.

`end_card_cta` (automotive carousel) has its own enum: `SEARCH_INVENTORY`, `LEARN_MORE`, `SHOP_NOW`, `SIGN_UP`, `CONTACT_US`, `BOOK_NOW`, `READ_MORE`, `VIEW_MORE`, `ORDER_NOW`.

### 4.6 Destination

| Field | Enum / notes |
|---|---|
| `landing_page_url` | May already include URL params. **This is where our OneLink smart link goes** |
| `deeplink` | In-app destination |
| `deeplink_type` | `NORMAL`, `DEFERRED_DEEPLINK`. **Deferred = allowlist.** Cannot be `DEFERRED_DEEPLINK` when `IOS14_CAMPAIGN` |
| `deeplink_format_type` | `UNIVERSAL_OR_APP_LINK`, `SCHEME_LINK`. Req with `deeplink` when `TRAFFIC` + `DESTINATION_VISIT`. **Immutable** |
| `fallback_type` | `APP_INSTALL`, `WEBSITE`, `UNSET`. `WEBSITE` → `landing_page_url` required |
| `page_id` | TikTok Instant Page / Instant Form. **LeadAds agreement must be signed via `/term/confirm/` first.** Collection Ads sunset 2023-02-16 |
| `tiktok_page_category` | `PROFILE_PAGE`, `OTHER_TIKTOK_PAGE`, `TIKTOK_INSTANT_PAGE`. Req when `optimization_goal=PAGE_VISIT`. **Immutable**; `OTHER_TIKTOK_PAGE` also freezes `landing_page_url` |
| `instant_product_page_used` | boolean |
| `dynamic_destination` | `DLP`, `UNSET`. **Cannot be `DLP` when `promotion_type ∈ {APP_ANDROID, APP_IOS}`** |
| `cpp_url` | Custom Product Page. **Max 512 chars.** Format `https://apps.apple.com/{region}/app/{app_name}/id{app_id}?ppid={ppid}`. Allowlist |

### 4.7 Tracking / third-party

| Field | Notes |
|---|---|
| `tracking_pixel_id` | Must match ad-group `pixel_id` if that is set. Objectives: REACH, VIDEO_VIEWS, TRAFFIC, WEB_CONVERSIONS, LEAD_GENERATION, APP_PROMOTION, PRODUCT_SALES, ENGAGEMENT, RF_REACH |
| `tracking_app_id` | Must match ad-group `app_id` if set |
| `tracking_offline_event_set_ids` | **Max 50.** If passed, must include **all** existing auto-tracking sets |
| `click_tracking_url` / `impression_tracking_url` | **Ignored when MMP partner_id = `44` (TikTok Business SDK) or `49` (TikTok App API).** **Pangle does not support DCM, Sizmek, or Flashtalking.** **Our apps are AppsFlyer `partner_id: 1` → these fields ARE live and self-attribution is enabled** |
| `video_view_tracking_url` | — |
| `utm_params` | **Max 14.** Keys: custom (≤100 chars) or `utm_source`/`utm_medium`/`utm_content`/`utm_campaign` (**case-sensitive**). Values: custom (≤600 chars) or macros **`__CAMPAIGN_NAME__`, `__CAMPAIGN_ID__`, `__AID_NAME__`, `__AID__`, `__CID_NAME__`, `__CID__`, `__PLACEMENT__`** |
| `deeplink_utm_params` | **Max 14.** Allowlist |
| `viewability_postbid_partner` | `MOAT`, `DOUBLE_VERIFY`, `IAS`, `ZEFR`. Allowlist |
| `brand_safety_postbid_partner` | `DOUBLE_VERIFY`, `IAS`, `ZEFR`. Allowlist. If either partner is `IAS` → both must be `IAS` and `brand_safety_vast_url` must **equal** `viewability_vast_url` |

### 4.8 Spark-specific ad fields

| Field | Enum | Notes |
|---|---|---|
| `dark_post_status` | `ON`, `OFF` | **Default `ON`.** Dark post = does not appear on the creator's homepage. `OFF` only if identity's "Show through ads only" is disabled AND account has no mandatory ads-only mode |
| `promotional_music_disabled` | boolean | **Default `true`.** Set `false` to allow duet/stitch |
| `item_duet_status` | `ENABLE`, `DISABLE` | Spark only; requires `promotional_music_disabled=false` |
| `item_stitch_status` | `ENABLE`, `DISABLE` | Same |

### 4.9 AIGC + creative automation

| Field | Enum | Notes |
|---|---|---|
| `aigc_disclosure_type` | `SELF_DISCLOSURE`, `NOT_DECLARED` | **Valid only when `identity_type=CUSTOMIZED_USER`** — i.e. **unavailable to us** (§4.1). Default `NOT_DECLARED` |
| `creative_auto_enhancement_strategy_list` | `VIDEO_QUALITY`, `MUSIC_REFRESH`, `IMAGE_QUALITY`, `IMAGE_RESIZE` | GA to all; default-on is allowlist. **`IMAGE_RESIZE` is a free partial mitigation for our aspect-ratio gap** |
| `creative_authorized` | boolean | Show in Creative Center. **Non-US advertisers only → we are US, unusable.** Video only |
| `dynamic_format` | `UNSET`, `DYNAMIC_CREATIVE` | `DYNAMIC_CREATIVE` forces `vertical_video_strategy=UNSET` |
| `vertical_video_strategy` | `UNSET`, `SINGLE_VIDEO`, `CATALOG_VIDEOS`, `CATALOG_UPLOADED_VIDEOS`, `LIVE_STREAM` | `CATALOG_UPLOADED_VIDEOS` allowlist + irreversible |

### 4.10 Disclaimers

`disclaimer_type` ∈ `TEXT_ONLY` (needs `disclaimer_text`, ≤90 chars) / `TEXT_LINK` (needs `disclaimer_clickable_texts`, ≤3, ≤40 chars each and combined). **Allowlist for some advertiser groups and for all R&F objectives.** Supported objectives: APP_PROMOTION, WEB_CONVERSIONS, REACH, TRAFFIC, VIDEO_VIEWS, ENGAGEMENT, LEAD_GENERATION, RF_REACH. **TikTok placement only. Not for ACO.** **Once added, a disclaimer cannot be deleted.**

### 4.11 Shopping / catalog (not applicable — 0 catalogs)

`catalog_id`, `product_set_id`, `item_group_ids` (max 20 / 50), `sku_ids` (max 20), `showcase_products` (max 20), `product_specific_type` (`ALL`/`PRODUCT_SET`/`CUSTOMIZED_PRODUCTS`), `carousel_image_index` (0–9), `page_image_index` (0–9), `shopping_ads_deeplink_type` (`NONE`/`CUSTOM`/`SHOPPING_ADS`), `shopping_ads_fallback_type` (`DEFAULT`/`CUSTOM`/`SHOPPING_ADS`), `shopping_ads_video_package_id`, `creative_type` (`SHORT_VIDEO_LIVE`/`DIRECT_LIVE`/`PSA`/`CUSTOM_INSTANT_PAGE`/`AUTO_INVENTORY_INSTANT_PAGE`), `vehicle_ids`, `auto_disclaimer_types` (`EMISSION`/`DISCOUNT`), `product_display_field_list` (max 2 of DEALER_NAME/MAKE/MODEL/YEAR/MILEAGE/PRICE/SALE_PRICE/EXTERIOR_COLOR/TRIM/ADDRESS_CITY/VEHICLE_STATE).

---

## 5. Creative format specs — exhaustive

### 5.1 Video — TikTok in-feed (auction)

| Spec | Value |
|---|---|
| **Aspect ratios** | **9:16 (vertical), 1:1 (square), 16:9 (horizontal)** |
| **Min resolution — vertical** | **540 × 960 px** |
| **Min resolution — horizontal** | **960 × 540 px** |
| **Min resolution — square** | **640 × 640 px** |
| **Recommended resolution** | **≥ 720 × 1280 px (720p)** — best-practice doc says *"at least 720P resolution"* |
| **Container / format** | **.mp4, .mov, .mpeg, .3gp, .avi** |
| **Duration — technical max** | **Up to 10 minutes** |
| **Duration — POLICY** | **Min 5 s, max 60 s** ← *Ad Format and Functionality policy* |
| **Duration — optimal** | **9–15 s** (industry consensus); TikTok GAB doc recommends **21–30 s** for app-bundle |
| **File size** | **≤ 500 MB** |
| **Bitrate** | **≥ 516 kbps** (TopView: **> 2500 kbps**) |
| **Codec** | Not specified by TikTok. H.264/AAC in MP4 is the safe default |
| **fps** | Not specified. 30 fps safe default |
| **Audio** | **Required.** *"The ad must contain audio and it must not be of poor quality"* |
| **Static content** | *"Static images should not occupy more than 50% of the video"* |

**THE 10-MINUTE vs 60-SECOND TRAP.** The technical spec accepts up to 10 minutes. The **advertising policy** states *"The duration of the ad must be a minimum of 5 seconds, and a maximum of 60 seconds."* A 3-minute video **uploads fine, creates fine, and then gets rejected in review.** Our validator must enforce **5–60 s**, not 10 minutes. Spark Ads are the documented exception (*"There is a 10 minute maximum on videos that can be sparked"*), because the organic post is the ad.

### 5.2 Video — Global App Bundle

| Spec | Value |
|---|---|
| Vertical (recommended) | **9:16, ≥ 720 × 1280 px** |
| Horizontal | **16:9, ≥ 1280 × 720 px** |
| Square | **1:1, ≥ 640 × 640 px** |
| **Duration** | **5–60 s**; **recommended 21–30 s** |
| Formats | **.mp4, .mov, .mpeg, .avi** (no .3gp) |
| File size | **≤ 500 MB** |
| Bitrate | **≥ 516 kbps** |

### 5.3 Image

| Spec | TikTok / GAB image ad | Carousel image |
|---|---|---|
| Formats | **.jpg, .jpeg, .png** | **.jpg/.jpeg or .png** |
| Vertical | **9:16, ≥ 720 × 1280 px** | **720 × 1280 px** |
| Horizontal | **16:9, ≥ 1280 × 720 px** | **1200 × 628 px** |
| Square | **1:1, ≥ 640 × 640 px** | **640 × 640 px** |
| File size | **≤ 100 MB** | **≤ 100 KB suggested** |

**Note the 1000× discrepancy:** the GAB image spec allows **100 MB**; the Carousel spec suggests **≤ 100 KB**. Both are TikTok's own numbers. Validate per-format.

### 5.4 Carousel (Standard)

| Spec | Value |
|---|---|
| **Number of images** | **min 2 – max 35** |
| **Images shown** | **min 2 – max 20** |
| Formats | **.jpg/.jpeg or .png** |
| File size | **≤ 100 KB suggested** |
| Resolutions | Horizontal **1200 × 628**; Square **640 × 640**; Vertical **720 × 1280** |
| **Music** | **REQUIRED.** Formats **.mp3, .wav, .m4a, .flac**; **≤ 10 MB**; **duration ≥ 2 s**; **loop playback**. Standard Carousel: CML music **or** upload. VSA Carousel: **upload only** |
| Caption / CTA | **One ad caption + one CTA for ALL images** |
| URL | **One URL for all images** (Standard). VSA: per-product links via catalog |

API note: `ad_create.image_ids` for `CAROUSEL_ADS` states size range **1 to 35**, while the help doc says **min 2**. Trust the help doc (2) — a 1-image "carousel" will fail review or validation.

### 5.5 Cover / thumbnail

For `ad_format=SINGLE_VIDEO`, `image_ids` must contain **exactly one** image used as the video cover, **with the same aspect ratio as the video**. `file_video_suggestcover_get` returns TikTok-suggested covers. Avatar (`avatar_icon_web_uri`) must be **1:1**.

### 5.6 Profile photo / display

| Spec | Value |
|---|---|
| **Profile photo dimension** | **98 × 98 px (1:1)** |
| **Profile photo file size** | **< 50 KB** |
| **Profile photo safe zone** | **66 × 66 px center** |
| Formats | .jpg, .jpeg, .png |
| **Account name** | **10 characters (CJK) / 20 characters (other)** |
| **App name** | **4–40 Latin letters, 2–20 Asian characters** |
| **Brand name** | **2–20 Latin letters, 1–10 Asian characters** |
| **Ad description** | **1–100 Latin characters, 1–50 Asian characters** |

Emoji and special characters `{ } #` are **not supported** in names/descriptions; punctuation and spaces **count** toward the limit.

### 5.7 Pangle assets

| Asset | Resolutions | Format | Max size |
|---|---|---|---|
| Video | **1280×720, 720×1280, 720×720** | .mp4/.mov/.mpeg/.avi | **500 MB** (up to 10 min) |
| Image | **1200×628, 640×640, 720×1280** | .jpg/.jpeg/.png | **100 MB** |
| Pangle-exclusive banner image | **600×500, 640×200, 640×100** | .jpg/.jpeg/.png | **100 MB** |
| Carousel | **1200×628, 640×640, 720×1280** — **up to 50 images** | .jpg/.jpeg/.png | **100 MB** |
| Playable | **1280×720, 720×1280** | **.zip** | **5 MB** |

Pangle ad formats: Interstitial, Rewarded, App Open, Native, Banner.

### 5.8 Spark Ads

| Aspect | Value |
|---|---|
| Mechanism | Promote an **existing organic TikTok post** |
| **Pull** | Post from **our own** identity (`TT_USER`/`BC_AUTH_TT`) — pass `tiktok_item_id`, **`image_ids` NOT supported** |
| **Push** | Post published **as an ad** from the account — pass `image_ids` + `ad_text` (**`ad_text` required for Push**) |
| **Authorization code** | Creator generates in-app: video → **⋯** → **Ad settings** → **Generate**. Durations **7 / 30 / 60 / 365 days** |
| **Batch authorization** | **Up to 20 codes at a time** in Ads Manager |
| **Max sparked video length** | **10 minutes** |
| Caption | Uses the **organic caption** — **max 4 lines displayed, emojis allowed**. **Cannot be edited after authorization** |
| Privacy | *"A private video will become public once it is used in a campaign"*; privacy **cannot change during promotion** |
| API surface | `tt_video_authorize_apply`, `tt_video_info_get`, `tt_video_list_get`, `tt_video_unbind`, `identity_video_get`, `spark_ad_recommend_get`, `tcm_tt_video_apply` |
| **Is authorization API-doable?** | **Code GENERATION is creator-side in the TikTok app — NOT an API call.** `tt_video_authorize_apply` submits/redeems an existing code. See §9.6 |

### 5.9 Safe zones

TikTok does not publish a single canonical pixel margin. What is documented:

- *"Elements that appear out of the safe zone might be covered or cropped."*
- **The safe zone is dynamic:** *"The safe zone size is determined by the ad caption length and any Interactive Add-on usage; the longer the caption, the smaller the safe zone will be."* Also determined by dimension (vertical/horizontal/square) and additional formats.
- **Profile photo safe zone is the one hard number: 66 × 66 px center of the 98 × 98 image.**
- *"Avoid using transparent or white background for the creative, as nicknames, ad captions, and music captions may not be visible, because the text color and UI icons on the TikTok app are white."*
- TopView has **two** distinct safe zones (initial 3-s zoom-in takeover stage vs feed stage); the feed-stage safe zone is **more restrictive**.
- Safe-zone template files are downloadable from Ads Manager, differentiated by stage and by LTR vs RTL languages.

**Engineering consequence:** a static safe-zone rectangle is not derivable from docs alone. The practical, defensible approach for a 1080 × 1920 (9:16) canvas — widely used and consistent with TikTok's own templates — is to keep key elements out of roughly the **top ~130 px**, **bottom ~480–560 px** (caption + CTA + music stack grows with caption length), and **right ~120 px** (action rail). These are **engineering defaults, not TikTok-published constants** — they must be calibrated against the downloaded template and re-checked when caption length changes. Our validator should treat safe zone as a **function of caption length**, not a constant.

---

## 6. Placements

| Placement | Enum | Creative requirement | Our fit |
|---|---|---|---|
| **TikTok** | `PLACEMENT_TIKTOK` | 9:16 / 1:1 / 16:9 video; min 540×960 vertical; 5–60 s (policy); ≥516 kbps; ≤500 MB. Image + Carousel supported. **Identity required.** **Non-Spark + CUSTOMIZED_USER blocked for our account** | **Primary** |
| **TikTok sub — In-Feed** | `IN_FEED` | For You feed; may also serve Profile Page + Following feeds | Primary |
| **TikTok sub — Search Feed** | `SEARCH_FEED` | Search results feed. Full Search *Campaigns* (`is_search_campaign`) are allowlist; the **subplacement** is not | Useful |
| **TikTok sub — Lemon8** | `LEMON8` | For You / Search / Immersive Video feeds of Lemon8 | Optional |
| **TikTok sub — TikTok Lite** | (in description, **not in enum**) | **JP / KR targeting only** | N/A |
| **Pangle** | `PLACEMENT_PANGLE` | 1280×720 / 720×1280 / 720×720; ≤500 MB; banner-exclusive 600×500, 640×200, 640×100; playable .zip ≤5 MB; carousel up to **50** images. **No DCM/Sizmek/Flashtalking tracking** | Low intent; audience network |
| **Global App Bundle** | `PLACEMENT_GLOBAL_APP_BUNDLE` | 9:16 ≥720×1280 rec; **5–60 s, rec 21–30 s**; ≤500 MB; ≥516 kbps | **Geo-locked: BR, ID, VN, PH, TH, MY, MX, SA, JP only. Does NOT support `TRAFFIC_LANDING_PAGE_VIEW`. Allowlist in Auction Reach.** Not usable for our markets |
| **Automatic** | `PLACEMENT_TYPE_AUTOMATIC` | System picks; `placements` ignored + overwritten. Response reflects actual | Reasonable default |

Deprecated — **do not use**: `PLACEMENT_TOPBUZZ`, `PLACEMENT_HELO`.

**Placement escape hatch worth noting:** the CUSTOMIZED_USER deprecation explicitly exempts *"Campaigns that deliver only to Pangle or Global App Bundle placements."* So a Pangle-only campaign could use custom identities — but Pangle is low-intent and GAB is geo-locked away from our markets. Not a real escape for us.

---

## 7. Validation, review, and rejection

### 7.1 Review timing

- **Most ads reviewed within 24 hours.** Some take longer.
- Editing creative **automatically re-triggers review**, up to another **24 h**.
- **Appeals: response targeted within 24 h.** *"Please only file one appeal for each incident, as filing multiple appeals in a short period of time for the same issue will lead to delays."*

### 7.2 How rejection surfaces in the API

| Endpoint | Returns |
|---|---|
| `ad_review_info_get` | Per-ad review info. **v1.3 changes: `is_pass` → `is_approved`; `id` → `ad_id`; `reject_info` changed from object to `object[]`**; new `carousel_music_content`, `music_id`. **Max 100 ad_ids per call**. Optional `lang` |
| `adgroup_review_info_get` | Approval status, **rejection reasons, and suggestions** |
| `smart_plus_ad_review_info_get` / `smart_plus_material_review_info_get` | Smart+ equivalents |
| `ad_get` / `adgroup_get` / `campaign_get` | `operation_status` (advertiser-set `ENABLE`/`DISABLE`) **AND** a **secondary/delivery status** — values include **`AUDIT`, `NOT_START`, `DELIVERY_OK`, `NO_BUDGET`, `BALANCE_EXCEED`** |
| `adgroup_get` → `search_keywords[].audit_status` | Per-keyword review result |
| `adgroup_appeal` / `ad_appeal` / `smart_plus_ad_appeal` | **Appeal IS API-callable** |
| `subscription_subscribe_create` | Webhook subscriptions — push notification of status changes |
| `tool_diagnosis_get` | Delivery diagnostics |

**Two-status rule (mirrors Meta):** persist **both** `operation_status` and the secondary/delivery status. `BALANCE_EXCEED` is TikTok's analog of Meta's `PENDING_BILLING_INFO`; `AUDIT` is `PENDING_REVIEW`. A UI badge must read the **secondary** status.

### 7.3 Rejection causes

**Ad Format and Functionality (quality) — verbatim:**
- *"The duration of the ad must be a minimum of 5 seconds, and a maximum of 60 seconds."*
- *"The ad video must use the standard video size: Vertical (9:16), Square (1:1), Horizontal (16:9)"*
- *"The ad must be legible and of a high resolution."*
- *"The ad must contain audio and it must not be of poor quality, such as having unclear or muffled sound."*
- *"Ad content must be dynamic. Do not rely on static or still images as the primary element in your ad. Static images should not occupy more than 50% of the video."*
- *"The ad image must not feature blurry, unclear, and unrecognizable visuals, and must not use columns or pixels to partially cover images."*
- *"Blurred or masked third-party watermarks"* — **prohibited**
- *"The ad caption and text must be free of spelling or grammatical mistakes, and must not use symbols incorrectly among the letters."*
- *"Landing pages must be functional. Ensure that your landing page functions properly on the network of the targeted market."*

**Enforcement is not binary — verbatim:** *"Based on various quality signals, including automated machine review, human review, and viewer engagement signals, your ad may be rejected, **receive fewer impressions, or your ad's cost-per-impression may increase**."* Low-quality creative is taxed even when it passes.

**Policy-level rejection reasons:**
- Misleading claims, false information, sensational/shocking content
- Suggestive or sexually provocative scenes; graphic imagery
- IP infringement; political, religious, or culturally sensitive material
- Non-functional landing page
- Landing-page language inconsistent with ad language / targeted region
- Prohibited or restricted industry

**Music/copyright:** Spark Ads — *"By using Spark Ads, you confirm you have the rights to use the music in the videos for commercial purposes."* Carousel music must come from the Commercial Music Library or be an owned upload. `file_music_get` / `file_music_upload` / `identity_music_authorization_get` manage this. `ad_review_info_get` returns `carousel_music_content` + `music_id` specifically because music is a distinct rejection axis.

**Watermarks:** third-party watermarks (blurred/masked) are prohibited. Other-platform logos (an IG/Reels/Shorts burn-in) are the classic repurposed-content rejection — and TikTok's own downloaded-video watermark on re-uploaded content triggers the same.

**Black bars / letterboxing:** not named as a distinct policy line, but caught by *"must not use columns or pixels to partially cover images"* + *"legible and of a high resolution"* + the standard-video-size requirement. A 16:9 asset letterboxed into 9:16 is the single most common auto-reject in practice.

**Blocked words:** `blockedword_check`, `blockedword_create`, `blockedword_task_check` — a **pre-flight text check is API-callable before submitting**.

### 7.4 Other pre-flight validators available

`tool_url_validate` (landing page), `file_name_check` (duplicate asset names), `video_fix_task_create`/`video_fix_task_get` (Smart Fix), `playable_validate`, `creative_ads_preview_create` (render a preview), `ad_audience_size_estimate`, `tool_bid_recommend`, `adgroup_quota_get`, `campaign_quota_info_get`, `tool_vbo_status_check`, `term_check`/`term_confirm` (LeadAds agreement).

### 7.5 Smart Fix (upload-time auto-repair)

From `file_video_ad_upload`: with `flaw_detect=true` + `auto_fix_enabled=true`, TikTok **automatically fixes only** `LOW_RESOLUTION` and `ILLEGAL_VIDEO_SIZE` (since 2025-04-24). `LOW_RESOLUTION` → upscaled to **1280×720 (720p)**. `ILLEGAL_VIDEO_SIZE` → adjusted to **1:1, 9:16, or 16:9**. Returns `fix_task_id` + `flaw_types`; only **one** fixed version is returned. If issues are detected and `auto_fix_enabled=false` → **the API returns an error with flaw types**. `auto_bind_enabled` uploads the fixed video to the library.

**This is free partial coverage for two of our worst creative gaps** — but it does not touch duration, watermarks, black bars, or safe zones.

### 7.6 Identity blocks ad create

`identity_type` + `identity_id` are **required** on every `ad_create` creative. No identity → no ad, full stop. We have `@usemingla` (`AVAILABLE`), so this is **not** a blocker for us — but see §4.1: our post-2026-01-15 account cannot use `CUSTOMIZED_USER` on TikTok placements, which collapses our identity options to `TT_USER` (have it) or `AUTH_CODE` (Spark, needs creator codes).

---

## 8. World-class best practices

### 8.1 TikTok's own published numbers

| Practice | Exact figure | Source |
|---|---|---|
| **Hook — proposition** | *"first **3 seconds** for better recall and awareness"* | creative-best-practices |
| **Hook — recall** | *"**90%** of ad recall impact is captured within the first **six seconds**"* | TFB blog |
| **Text pacing** | *"**5-10 words per second** when using text"* | creative-best-practices |
| **Creatives per ad group** | *"between **3-5** different creatives per ad group"* | creative-best-practices |
| **Ad groups per campaign** | *"**3-5** diversified ad groups per campaign"* | creative-best-practices |
| **Creative volume payoff** | NA campaigns with **≥10 unique creatives** → **2.6× ad recall, 3× purchase intent, 1.5× awareness** vs **<5** creatives | TFB blog |
| **Sound** | *"Over **93%** of top-performing videos use audio"*; non-music audio triggers emotional response **up to 1.5 s faster** than music | TFB blog |
| **Resolution** | *"at least **720P**"*, **9:16** | creative-best-practices |
| **Style** | *"**DIY or not overly polished** style"*; feature *"creators, employees, or customers"* | creative-best-practices |
| **Refresh trigger** | *"when delivery results exhibit a **consistently declining trend**, or when **daily new users are low**"* — **no fixed cadence published** | creative-best-practices |
| **Budget adjustment** | ≤**40%** in learning phase; ≤**30%** after; **not more often than every 2 days** | budget doc |

### 8.2 Practitioner doctrine

1. **Don't make ads, make TikToks.** TikTok's own Spark Ads collateral is literally titled this. Polished 16:9 brand film reads as an ad and gets scrolled. Native, vertical, hand-held, first-person wins.
2. **Hook in 3 s or lose.** Open on motion/face/text-hook. No logo intro, no slow build, no black frame.
3. **Sound-on is the default assumption.** 93% of top performers use audio. Silent-safe design is a Meta habit that actively hurts on TikTok. Trending sounds > licensed stock. Voiceover > music-only for emotional latency.
4. **Spark Ads outperform.** Running through a real identity with a real post inherits social proof (likes/comments/shares carry over), permits emoji-rich native captions (4 lines), and enables duet/stitch. It is also — for our post-2026-01-15 account — one of only two legal identity paths.
5. **Creative volume beats creative perfection.** 10+ unique creatives → 2.6× ad recall. TikTok creative fatigues **faster than Meta**; refresh on declining trend + low daily new users. `creative_fatigue_get` exposes TikTok's own fatigue signal — use it, don't eyeball it.
6. **Smart+ vs manual.** Smart+ automates targeting/creative/placement/budget — but only for `APP_PROMOTION` / `WEB_CONVERSIONS` / `LEAD_GENERATION`. **It cannot do TRAFFIC.** Manual first for control and learning; Smart+ once the pixel has real event volume.
7. **oCPM + lowest-cost first.** Start `BID_TYPE_NO_BID` (max delivery) and let the auction learn; move to `BID_TYPE_CUSTOM` cost-cap only once CPA is stable. Remember `bid_price` **must be lower than both campaign and ad-group budget**.
8. **Respect the learning phase.** ~50 conversions/week per ad group is the conventional exit bar. Don't edit mid-learning; budget jumps >40% reset it. `skip_learning_phase` exists but is a footgun.
9. **Pixel + Events API dedup.** Browser pixel alone loses to ITP/ad-blockers. Server-side Events API with a shared `event_id` for dedup is the standard. Our pixel is `DEVELOPER` mode with `enable_first_party_cookies=true`, `advanced_matching_fields: {email:true, phone_number:true}` — correctly configured but **zero events firing**.
10. **Broad targeting.** TikTok's algorithm resolves audience faster than manual interest stacking. Geo + age is the recommended MVP — which both #862 and #863 already chose correctly.
11. **Creative Center + trends.** `tool_hashtag_recommend_search`, `tool_interest_keyword_recommend_search`, `tool_targeting_category_recommend_get`, `creative_smart_text_get`, `creative_cta_recommend_get`, `spark_ad_recommend_get` are all read-callable and unused by our spec.
12. **Test structurally.** `split_test_create` (A/B) is API-native and unused.

---

## 9. OUR-ENGINE capability map

### 9.1 Live account state (probed 2026-07-15)

| Asset | State | Verdict |
|---|---|---|
| Advertiser `7627974536397766673` | `STATUS_ENABLE`, AUCTION, USD, US, `Etc/GMT+5` | **GREEN** |
| **Balance** | **`0.0`** (API). #863 notes **$10 prepaid** in Advanced Payment Portfolio not reflected by the API | **RED — $10 < $20/day ad-group minimum** |
| BC `7627974686760009729` | present | GREEN |
| Identity `@usemingla` `TT_USER` | `AVAILABLE`, `can_push_video: true`, `can_pull_video: true` | **GREEN — ad create unblocked** |
| **Identity videos** | **`video_list: []` — ZERO posts** | **RED — Spark Ads Pull impossible** |
| Pixel `7662469356818858002` | `NO_RECENT_ACTIVITY`, **`events: []`**, `DEVELOPER` mode, 1P cookies on, advanced matching (email+phone) on | **RED — WEB_CONVERSIONS + Smart+ blocked** |
| Custom conversions | **0** | RED (for conversion optimization) |
| Custom audiences / Saved audiences | **0 / 0** | RED (no retargeting, no lookalikes) |
| Catalogs (BC) | **0** | N/A |
| **Apps** | **2 — Android `7659053200868786183`, iOS `7659045322872684562`.** AppsFlyer `partner_id: 1`, `self_attribution_enabled: true`, `skan_allowed: ALLOWED`, `enable_retargeting: RETARGETING`, `advanced_dedicated_campaign_allowed: false` | **GREEN — APP_PROMOTION is viable TODAY** |
| **App optimization events** | **`optimization_events: []`** | **RED — `IN_APP_EVENT` optimization blocked; `INSTALL` only** |
| Asset library | **0 images** | Expected (we populate it) |
| **Token** | **Own app token PENDING TIKTOK APP REVIEW** (#862 A3 registry: *"app in review"*) | **RED — hardest blocker** |
| **Locations** | **33 countries for both TRAFFIC and APP_PROMOTION. GB ABSENT.** US `6252001`, NG `2328926` | **RED for London** |

### 9.2 What our adapter can set (per #863 spec)

`ChannelAdapter` (`_shared/adChannel.ts`) + `_shared/tiktok.ts`. Spec sets:

**Campaign:** `advertiser_id`, `campaign_name`, `objective_type='TRAFFIC'` (hardcoded), `campaign_type='REGULAR_CAMPAIGN'`, `budget_mode`, `budget`, `budget_optimize_on`, `operation_status='DISABLE'`, `request_id`.

**Ad group:** `adgroup_name`, `advertiser_id`, `campaign_id`, `budget_mode`, `budget`, `optimization_goal='TRAFFIC_LANDING_PAGE_VIEW'` (default), `billing_event='CPC'` (hardcoded), `pacing='PACING_MODE_SMOOTH'`, `schedule_type`, `schedule_start_time`, `schedule_end_time`, `location_ids`, `age_groups`, `gender`, `placement_type='PLACEMENT_TYPE_NORMAL'`, `placements=['PLACEMENT_TIKTOK']`, `operation_status='DISABLE'`.

**Ad:** `ad_name`, `identity_type` (from conn), `identity_id` (from conn), `ad_format='SINGLE_IMAGE'`, `image_ids=[image_id]`, `ad_text`, `call_to_action` (default `'LEARN_MORE'`), `landing_page_url=dest_smart_link`, `operation_status`.

**Asset:** `uploadImage(conn, imageUrl)` → `file/image/ad/upload` `{advertiser_id, upload_type:'UPLOAD_BY_URL', image_url}` → `image_id`.

Of TikTok's **110 ad-group fields**, our adapter sets **~17**. Of `ad_create`'s ~60 creative fields, **~9**. That is a defensible MVP surface — but the unset fields include several that are *required for correctness*, not just optimization (see §10).

### 9.3 The A3 unified model (from #862)

Canonical tables: `ad_connections`, `ad_campaigns`, `ad_sets`, `ads`, `ad_status_events`. Platform enum `('meta','tiktok','snapchat','google','reddit')`; lane `('consumer','business')`; `UNIQUE (platform, lane)`.

**Budgets stored in cents everywhere; TikTok adapter converts cents → dollars (÷100) at the API boundary.** **No token column on any table, ever** — only `token_env_var` (the env-var NAME). TikTok registry row: advertiser `7627974536397766673`, BC `7627974686760009729`, `auth_kind='system_user_token'`, `token_env_var='TIKTOK_ACCESS_TOKEN'`, `extra={pixel 7662469356818858002, events_env_var TIKTOK_EVENTS_ACCESS_TOKEN, identity @usemingla}`, status **"app in review"**.

**Naming conflicts A3 pins as canonical** (and #863 currently violates): audit table is **`ad_status_events`** (not #863's `ad_campaign_status_events`); functions are **`admin-ad-*`** singular (not #863's `admin-ads-*`); creative ref is **#866's `ad_creative_platform_refs`**, not a column on `ads`.

### 9.4 API-supported vs UI-only

| Capability | API? | Notes |
|---|---|---|
| Campaign / adgroup / ad create + status + read | **Yes** | Full |
| Image upload | **Yes** | `file_image_ad_upload` — **`UPLOAD_BY_URL` / `UPLOAD_BY_FILE_ID` only in MCP schema. No multipart binary param exposed.** Requires a public URL |
| Video upload | **Yes** | `file_video_ad_upload` — `UPLOAD_BY_URL` / `UPLOAD_BY_FILE_ID` / `UPLOAD_BY_VIDEO_ID`. **`video_url` recommended ≤10 MB; request timeout 10 s.** Same ratio/format/resolution/bitrate limits as direct file |
| **Spark Ads — creating the ad** | **Yes** | `tiktok_item_id` + `identity_type=AUTH_CODE`/`TT_USER`/`BC_AUTH_TT` |
| **Spark Ads — creator generating the auth code** | **NO — in-app, creator-side** | Video → ⋯ → Ad settings → Generate. **Cannot be automated.** `tt_video_authorize_apply` redeems a code you already have |
| Ad review status + reject reasons | **Yes** | `ad_review_info_get`, `adgroup_review_info_get` |
| Appeal | **Yes** | `adgroup_appeal`, `ad_appeal` |
| Audience create / lookalike | **Yes** | `dmp_custom_audience_create`, `dmp_custom_audience_lookalike_create` |
| Pixel + events | **Yes** | `pixel_create`, `pixel_event_create` |
| Location lookup | **Yes** | `tool_region_get` (delivery-aware), `search_region_get` (advertiser-scoped) |
| Preview | **Yes** | `creative_ads_preview_create`, `smart_plus_ad_preview` |
| Split test | **Yes** | `split_test_create` |
| Creative fatigue | **Yes** | `creative_fatigue_get` |
| Blocked-word pre-check | **Yes** | `blockedword_check` |
| Reporting | **Yes** | `report_integrated_get`, `report_task_create` — **#865** |
| **Funding / top-up** | **NO — UI only** | `advertiser_balance_get` is BC-scoped and does not reflect the Advanced Payment Portfolio. **UI is source of truth** |
| **App review / token issuance** | **NO — TikTok developer portal** | The blocker |
| Safe-zone templates | **NO — download from Ads Manager** | — |

### 9.5 Token status — FLAG

The #862 A3 registry marks TikTok as the **only** channel of five not GREEN: *"**app in review** (token pending TikTok app review)"* and *"TikTok delivery waits on TikTok app review."* #863 §7 item 1 calls it a **HARD BLOCKER**: *"the #863 credential does not yet exist."* Master keys hold only `TIKTOK_EVENTS_ACCESS_TOKEN` (that's #865's Events API credential — **a different token**, not usable for ad management).

Required secrets not yet provisioned: `TIKTOK_ACCESS_TOKEN`, `TIKTOK_APP_ID`, `TIKTOK_APP_SECRET`, `TIKTOK_ADVERTISER_ID`, `TIKTOK_API_VERSION`, `TIKTOK_GRAPH_BASE`.

Until then every path fail-closes with `424 tiktok_not_connected` — **by design, and correctly**. Meta / Snapchat / Google / Reddit are all live; **TikTok is the last channel gated on an external approval we do not control.**

### 9.6 Spark Ads reality check for Mingla

Spark is our best-performing format *and* one of only two legal identity paths (§4.1). But:
- `identity_video_get` → **`video_list: []`**. `@usemingla` has **zero posts**. **Spark Ads Pull has nothing to pull.**
- Spark Ads **Push** works from zero posts (publish as ad, `dark_post_status=ON`) — this is the **viable path today**, and it accepts `image_ids` + `ad_text`.
- Spark from **creator** content requires the creator to generate a code in-app (7/30/60/365 d) and hand it over. **Not automatable.** A human/ops flow is required — which pairs naturally with the existing influencer-intake pipeline.

---

## 10. Gaps and engineering implications

Ranked. **Severity = launch impact × irreversibility.**

### HIGH

**G1 — Token pending TikTok app review. The whole channel is dark.**
Ideal: a long-lived Marketing-API token with ad-management + file-upload scopes on advertiser `7627974536397766673`.
Reality: **does not exist.** App in review. `TIKTOK_EVENTS_ACCESS_TOKEN` is a different credential and cannot create ads.
Build: nothing to build — but **everything downstream is untestable live**. The fail-close (`424`) is correct and already specified. **Track the review as a launch blocker with an owner and a date.** Every other gap here is moot until this clears. Meta/Snap/Google/Reddit are GREEN; TikTok alone is externally gated.

**G2 — Our ad account cannot use `CUSTOMIZED_USER` identity. Nobody knows this.**
Ideal: pick any identity type.
Reality: account created **2026-04-12**, after the **2026-01-15** cutoff → **non-Spark ads with Custom Identities are blocked on TikTok/Automatic placements.** Only `TT_USER` (`@usemingla`) or `AUTH_CODE` (Spark) work. Pangle/GAB-only campaigns are exempt but useless to us.
Build: **hard-fail `CUSTOMIZED_USER` in the adapter with an explanatory error** — do not let it reach TikTok. Document the constraint in the spec (it is currently absent). Note the knock-on: `aigc_disclosure_type` is **`CUSTOMIZED_USER`-only** → **we cannot self-disclose AI-generated content via the API**, which matters if cinematic-ad-director output ever goes live on TikTok. Escalate that separately.

**G3 — Creative pipeline is Meta-shaped and pass-through. It will send square images into a 9:16 placement.**
Ideal: 9:16, ≥720×1280, 5–60 s, sound-on, safe-zone-clean, watermark-free, no black bars.
Reality: #866 is **transport only** — `watermark` 0 mentions, `safe zone` 0, `black bar` 0, `transcode` 0, `bitrate` 0, `codec` 0, `fps` 0, `vertical` 0. `width`/`height`/`aspect_ratio`/`duration_seconds`/`mime_type` are **admin-supplied, nullable, never validated against the bytes.** Variant generation explicitly ruled OUT (OD-6). And #864's dropzone hint literally steers admins to **"≥1080×1080 · 1:1 or 1.91:1"** — **Meta ratios**. A 1:1 asset is then shipped **byte-identical** to TikTok's 9:16 placement.
Build (all new):
- **Server-side media probe** (ffprobe or equivalent) — never trust admin-supplied dimensions.
- **TikTok validator with exact numbers:** ratio ∈ {9:16, 1:1, 16:9}; vertical ≥540×960 (warn <720×1280); horizontal ≥960×540; square ≥640×640; duration **5–60 s** (hard — **not** 10 min; block on the policy number); ≤500 MB; bitrate ≥516 kbps; container ∈ {mp4, mov, mpeg, 3gp, avi}; **audio track present** (policy requires it); static content ≤50%.
- **Vertical transcode** to 9:16 1080×1920.
- **Black-bar / letterbox detection** (edge-row luma) — the #1 auto-reject.
- **Watermark / other-platform-logo detection** — corner-region analysis for TikTok/IG/Reels/Shorts burn-ins.
- **Caption-length-aware safe-zone check** — safe zone is a **function of caption length**, not a constant. Calibrate against the downloaded template; treat top ~130 / bottom ~480–560 / right ~120 px on a 1080×1920 canvas as engineering defaults, not TikTok constants.
- **Free partial mitigation available now:** `file_video_ad_upload` with `flaw_detect=true, auto_fix_enabled=true` auto-fixes `LOW_RESOLUTION` (→720p) and `ILLEGAL_VIDEO_SIZE` (→1:1/9:16/16:9), and `creative_auto_enhancement_strategy_list` supports `IMAGE_RESIZE`/`IMAGE_QUALITY`/`VIDEO_QUALITY`. Turn both on. Neither touches duration, watermarks, black bars, or safe zones.

**G4 — `ad_text` 100-char / no-emoji limit is nowhere in our stack.**
Ideal: validate before submit.
Reality: **#863 states no character limits at all** ("Character limits: NONE stated"). #866 has none. #864 has **Meta** soft-caps (primary ~125, headline ~40) rendered as amber hints — **125 > TikTok's hard 100**, so our UI actively guides admins into a TikTok validation error. Emoji is **forbidden** in `ad_text` but our copy pipeline (mingla-content-engine) is emoji-native.
Build: **hard** validators — `ad_text` ≤100 (CJK×2 counting), `ad_name`/`campaign_name`/`adgroup_name` ≤512, **emoji strip/reject** on all four, `display_name` 1–40 Latin / 1–20 CJK, `app_name` 1–40. Per-channel limits — not one shared cap. Pre-check text with `blockedword_check` before submit. **Note the honest workaround: emoji reach TikTok only via Spark Ads' organic caption (max 4 lines, emoji allowed).**

**G5 — UK/London is not targetable. Our spec assumes it is.**
Ideal: target our live markets — London, US cities, Lagos.
Reality: `tool_region_get` returns **33 countries for BOTH `TRAFFIC` and `APP_PROMOTION`, and GB is not among them.** US `6252001` ✓, NG `2328926` ✓ — **GB absent.** Meanwhile #863 §7 item 3 says to seed the map for *"US, UK, NG"*. **We are live in London and cannot advertise there on this account.**
Build: (a) **escalate to TikTok / check account eligibility for UK/EEA** — this smells like an allowlist or entity-registration gate, not a product limit; (b) build `resolveGeo` against the **live** `tool_region_get`, not a hardcoded build-time map (OD-7 recommends build-time — **that recommendation is now unsafe**: it would silently ship a GB id that 400s); (c) **fail loudly** when a requested country is unavailable rather than dropping it; (d) enforce **no overlapping locations** and the **3,000** cap; (e) never accept ISO codes as `location_ids`.

**G6 — Budget minimums are unvalidated and the account is unfunded.**
Ideal: reject below-minimum before the API call; be funded.
Reality: **campaign > $50/day, ad group > $20/day, ad-group lifetime = $20 × days.** Not returned by any read API. Balance reads **`0.0`**; **$10 prepaid** sits in the Advanced Payment Portfolio that the API cannot see. **$10 < one day's ad-group minimum** → any launched campaign parks at `BALANCE_EXCEED` and never delivers.
Build: client + server validation for both tiers; **cents → dollars ÷100** at the boundary (already correctly specified); surface TikTok's min-budget error **verbatim, no silent clamp** (AC-3); map `BALANCE_EXCEED` → an actionable admin warning (200 + warning, not an error); enforce the **≤40% learning / ≤30% post / every-2-days** adjustment rules in any auto-optimizer (#884). **Fund the account before live-fire.**

### MEDIUM

**G7 — `schedule_start_time` timezone is wrong in the spec.**
MCP schema: **UTC+0**. #863: *"in the advertiser timezone."* Our advertiser is `Etc/GMT+5` / `America/New_York` → **a 5-hour scheduling error**. Also: start ≤12 h in the past, **no later than `2028-01-01 00:00:00`**; end **no later than `2038-01-01 00:00:00`**. Fix the spec; validate both bounds.

**G8 — Pixel has zero events → `WEB_CONVERSIONS` and Smart+ are structurally unavailable.**
Pixel `7662469356818858002` is correctly configured (`DEVELOPER`, 1P cookies, advanced matching email+phone) but **`events: []`, `NO_RECENT_ACTIVITY`**, 0 custom conversions. `optimization_event` is **required** whenever `pixel_id` is set. Smart+ supports only APP_PROMOTION / WEB_CONVERSIONS / LEAD_GENERATION — with a dead pixel, **Smart+ is unreachable for anything but app**. #865 owns the pixel + Events API; **flag the ordering dependency: no conversion optimization on TikTok until #865 lands.** Correctly, #863 does not attempt it.

**G9 — APP_PROMOTION is viable today and nobody noticed.**
Both apps are registered, AppsFlyer-linked (`partner_id: 1`), `self_attribution_enabled: true`, `skan_allowed: ALLOWED`, `enable_retargeting: RETARGETING`. **This is the strongest asset on the account** — and #863 hardcodes `objective_type='TRAFFIC'`, never mentioning it. Caveats: `app_optimization_event_get` → **`[]`** (so `INSTALL` only, no `IN_APP_EVENT` until AppsFlyer postbacks flow); `advanced_dedicated_campaign_allowed: false` on both. Since `click_tracking_url`/`impression_tracking_url` are **only ignored for partner_id 44/49** and we are **partner_id 1**, those tracking fields are live for us. **Recommend: make `objective_type` a parameter, not a constant, and evaluate APP_PROMOTION/INSTALL as a first campaign** — it needs no pixel.

**G10 — Zero audiences. No retargeting, no lookalikes.**
0 custom, 0 saved, 0 custom conversions. `dmp_custom_audience_create` / `dmp_custom_audience_lookalike_create` / `dmp_saved_audience_create` are all API-callable and unbuilt. #863 defers to "#865 Phase B". Broad geo+age is the right MVP — but **an audience builder is a known, scoped, unstarted build.**

**G11 — Bidding is entirely unspecified.**
#863 sets no `bid_type`, `bid_price`, `conversion_bid_price`, or `deep_bid_type`, and never states the intent. Implicitly lowest-cost. But **`bid_type` is REQUIRED when CBO is on**, and #862's OD-3 recommends **CBO daily** — so a CBO campaign built to #863 as written **will fail validation**. Also unenforced: `bid_price` must be **lower than both** campaign and ad-group budget; under one CBO campaign `bid_type` + `optimization_event` must **match the first ad group**. Specify explicitly.

**G12 — Spark Ads absent from the spec; the identity has no posts.**
#863 mentions Spark **zero times**. Given G2 (Spark is one of only two legal identity paths) and §8 (Spark is the highest-performing format), this is a strategic hole. `@usemingla` has **zero posts** → **Pull is impossible**; **Push is the viable path** (works from zero posts, `dark_post_status=ON`). Creator-code Spark needs an **ops flow, not an API** (creator generates 7/30/60/365-day code in-app; batch ≤20 in Ads Manager) — pair it with influencer-intake. Build: an authorization-code intake + `tt_video_authorize_apply` + `identity_video_get` refresh, and set `dark_post_status` / `promotional_music_disabled` / `item_duet_status` / `item_stitch_status` deliberately.

**G13 — Two-status persistence + review surfacing.**
Must persist **both** `operation_status` and the secondary/delivery status (`AUDIT`, `NOT_START`, `DELIVERY_OK`, `NO_BUDGET`, `BALANCE_EXCEED`); UI badge reads the **secondary**. #863 gets this right. Unbuilt: `ad_review_info_get` reject-reason ingestion (note v1.3 `is_pass`→`is_approved`, `reject_info` object→**array**, max 100 ids), `adgroup_appeal`/`ad_appeal`, and `subscription_subscribe_create` webhooks (currently polling-only; `pg_cron` heartbeat is a deferred fast-follow).

**G14 — Asset upload needs a public URL and has a 10-second timeout.**
`file_image_ad_upload` / `file_video_ad_upload` expose **`UPLOAD_BY_URL` / `UPLOAD_BY_FILE_ID`** (+ `UPLOAD_BY_VIDEO_ID` for video) — **no multipart binary param in the MCP schema.** *"Request timeout is 10 seconds"*; `video_url` *"recommended file size is within 10 MB"*. URL must be browser-valid, properly encoded (spaces → `%20`), correct `Content-Type` (text/* rejected), verified against `Content-MD5` if present. Our #866 design is public-URL-first (bucket `public=true`, Bunny for video) — **compatible**. Risks: **file names must be unique per advertiser** (`file_name_check`; else duplicate-name error → append timestamp); **a large Bunny video may exceed the 10-s fetch**; and nobody has verified TikTok's fetcher can reach Bunny (no hotlink/geo/allowlist analysis exists). Also capture **both** `image_id`/`video_id` **and** `material_id` — #866 keys `external_ref = material_id` with the id in `external_ref_extra`.

### LOW

**G15 — Naming conflicts between sibling specs.** A3 pins `ad_status_events` + `admin-ad-*`; #863 uses `ad_campaign_status_events` + `admin-ads-*`. Reconcile before implementation (A3 is canonical).

**G16 — #863 internal contradiction.** §4.4 step 5 sets ad-level `operation_status:'ENABLE'` while §2/§4.0/AC-2 mandate everything created **PAUSED**. Harmless in effect (paused parent blocks delivery) but literally contradictory. Fix.

**G17 — Unused free intelligence.** `creative_fatigue_get`, `split_test_create`, `creative_ads_preview_create`, `tool_bid_recommend`, `ad_audience_size_estimate`, `creative_cta_recommend_get`, `creative_smart_text_get`, `spark_ad_recommend_get`, `tool_hashtag_recommend_search`, `tool_url_validate`, `blockedword_check`, `adgroup_quota_get`. Cheap wins for #884 (budget optimizer) and #864 (builder UX).

**G18 — MCP schema enum gaps.** `objective_type`, `billing_event`, `bid_type`, `promotion_type`, `call_to_action` are declared as **bare strings with no enum**. Our adapter must own these enums client-side or ship runtime 400s. Encode: objective (8), billing_event (CPC/CPM/OCPM/CPV), bid_type (BID_TYPE_NO_BID/BID_TYPE_CUSTOM), CTA (25 landing-page / 4 app-download, default `LEARN_MORE`).

**G19 — `PLACEMENT_GLOBAL_APP_BUNDLE` is a trap.** Geo-locked to BR/ID/VN/PH/TH/MY/MX/SA/JP; **does not support `TRAFFIC_LANDING_PAGE_VIEW`** (our default goal). If a placement picker ever exposes it, the combination silently fails. Gate it.

**G20 — `creative_authorized` is US-blocked.** *"Valid only for non-US advertisers."* We are US → unusable. Remove from consideration.

### Field-collection matrix — what WE collect and validate

| Field | Collect from | Validate |
|---|---|---|
| `campaign_name` | admin | ≤512, no emoji |
| `objective_type` | **admin (currently hardcoded — make it a param, G9)** | ∈ 8-value enum |
| `budget` + `budget_mode` | admin (cents) | campaign >$50/d, adgroup >$20/d, lifetime $20×days; ÷100 at boundary |
| `budget_optimize_on` | admin | if true → **`bid_type` required (G11)** |
| `schedule_start/end` | admin | **UTC+0**; ≤12 h past; ≤2028-01-01 / ≤2038-01-01 |
| `dayparting` | admin (optional) | exactly **336** chars of 0/1 |
| `optimization_goal` | admin | ∈ 16-value enum; compatible with objective |
| `billing_event` | derived | CPC for CLICK/TRAFFIC_LANDING_PAGE_VIEW |
| `bid_type` / `bid_price` | admin | **required under CBO**; `bid_price` < both budgets |
| `location_ids` | **live `tool_region_get`** | numeric only; **no ISO codes**; ≤3,000; no overlap; **fail loudly if unavailable (G5)** |
| `age_groups` / `gender` | admin | AGE_13_17 regional restriction |
| `placements` | admin | not TOPBUZZ/HELO; GAB geo + goal gate |
| `identity_type` / `identity_id` | connection | **reject `CUSTOMIZED_USER` (G2)** |
| `ad_format` | admin | ∈ 5-value enum |
| `image_ids` / `video_id` | #866 | SINGLE_IMAGE=1; SINGLE_VIDEO cover=1 **same ratio**; CAROUSEL 2–35 |
| `ad_text` | admin | **≤100, no emoji** (G4) |
| `call_to_action` | admin | ∈ 25 / 4 enum; default LEARN_MORE |
| `landing_page_url` | derived (OneLink) | `tool_url_validate`; public+live destination |
| `music_id` | #866 | **required for CAROUSEL**; ≥2 s, ≤10 MB |
| Media bytes | #866 | **full §5.1 matrix + probe (G3)** |

---

## Bottom line

The API surface is fully mapped and our adapter design is sound — the A3 unified model, fail-close token handling, no-orphan atomic create, and cents-at-rest are all correct. But **three findings are not in any spec and change the build**: our account class **cannot use `CUSTOMIZED_USER` identity** (post-2026-01-15 rule), **UK/London is not in the returned location set** for either TRAFFIC or APP_PROMOTION, and the **policy duration limit is 5–60 s, not the 10 minutes the technical spec advertises**. Add to that a creative pipeline that is pure transport with Meta-shaped ratio hints, and the most likely failure mode at launch is not a token error — it is **a square, 90-second, emoji-captioned asset getting rejected in review while the campaign burns a $20/day minimum against a $10 balance in a country we can't target.**

The token is the gate. Everything else is buildable before it clears.
