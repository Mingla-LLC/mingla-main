# Meta (Facebook/Instagram) Paid-Ads Pipeline — Exhaustive Reference + Mingla Capability Map

**Author:** research pass for the Mingla Ad Engine build (#862 / #866)
**Date:** 2026-07-14
**Mode:** READ-ONLY. No create/update/mutate/delete/publish/boost tool or write API was called. All MCP evidence below is from `get_*` / `list` / schema-inspection only.
**Our real IDs:** ad account `2393570861066813` ("Use Mingla", USD) · business/portfolio `830733900115504` · Page `797406353459597` · pixel/dataset `1949011972638955` ("Mingla Web") · app `1270281948368169` · system user `61592024996570`.

**Confidence legend used throughout:**
- **[LIVE]** — observed directly from a read-only `meta-ads` MCP call in this session (highest confidence; it is *our* account).
- **[SCHEMA]** — read from the MCP create-tool JSONSchema (the tool's own contract; not called).
- **[OFFICIAL]** — verbatim/near-verbatim from a Meta-owned URL.
- **[CONSENSUS]** — practitioner/third-party; explicitly NOT official.
- **[UNVERIFIED]** — could not be confirmed from an official source this session. Do not hardcode.

> **Read this first.** Three widely-believed premises are FALSE as of 2026 and are called out inline: (1) the 20% text-in-image rule is dead — do not build text-density validation; (2) AEM's 8-event cap + priority ranking were removed 2023-05-15 — do not build event-priority logic; (3) the "2x daily budget" pacing rule is really **175%**. A fourth, specific to us: **Advantage+ Shopping/App campaigns can no longer be created OR updated via the Marketing API at all** (v25.0, 2026-02-18).

---

## 0. Sources

### Meta Ads Guide (server-rendered, directly fetched — the authoritative spec surface)
- https://www.facebook.com/business/ads-guide/update/image/facebook-feed/link-clicks
- https://www.facebook.com/business/ads-guide/update/image/instagram-feed
- https://www.facebook.com/business/ads-guide/update/image/facebook-story · `/instagram-story` · `/instagram-reels`
- https://www.facebook.com/business/ads-guide/update/image/facebook-right-hand-column · `/facebook-search` · `/facebook-instream-video` · `/facebook-marketplace` · `/audience-network-native`
- https://www.facebook.com/business/ads-guide/update/image/facebook-facebook-reels-overlay
- https://www.facebook.com/business/ads-guide/update/video/facebook-feed · `/instagram-feed` · `/facebook-story` · `/instagram-story` · `/instagram-reels` · `/facebook-facebook-reels` · `/facebook-instream-video` · `/audience-network-native` · `/audience-network-rewarded-video`
- https://www.facebook.com/business/ads-guide/update/carousel (+ `/instagram-feed`, `/instagram-story`)
- https://www.facebook.com/business/ads-guide/update/collection (+ `/instagram-feed`, `/instagram-story`)

### Marketing API / developer docs
- https://developers.facebook.com/docs/marketing-api/reference/ad-account/ (account_status enum)
- https://developers.facebook.com/docs/marketing-api/reference/ad-campaign/ (ad set reference)
- https://developers.facebook.com/docs/marketing-api/reference/ad-campaign-group/ (campaign reference)
- https://developers.facebook.com/docs/marketing-api/reference/adgroup/ (ad reference, effective_status)
- https://developers.facebook.com/docs/marketing-api/reference/adgroup-issues-info
- https://developers.facebook.com/docs/marketing-api/reference/adgroup-review-feedback/
- https://developers.facebook.com/docs/marketing-api/reference/adgroup-placement-specific-review-feedback
- https://developers.facebook.com/docs/marketing-api/reference/ad-campaign-issues-info/
- https://developers.facebook.com/docs/marketing-api/reference/ad-campaign-learning-stage-info/
- https://developers.facebook.com/docs/marketing-api/reference/ad-campaign-frequency-control-specs/
- https://developers.facebook.com/docs/marketing-api/reference/ad-account/minimum_budgets/
- https://developers.facebook.com/docs/marketing-api/audiences/reference/placement-targeting/
- https://developers.facebook.com/docs/marketing-api/audiences/reference/basic-targeting/ · `/detailed-targeting/` · `/advanced-targeting`
- https://developers.facebook.com/docs/marketing-api/audiences/reference/targeting-search
- https://developers.facebook.com/docs/marketing-api/audiences/reference/advantage-targeting/
- https://developers.facebook.com/docs/marketing-api/audiences/reference/targeting-expansion/advantage-audience/
- https://developers.facebook.com/docs/marketing-api/audiences/special-ad-category/
- https://developers.facebook.com/docs/marketing-api/reference/custom-audience/
- https://developers.facebook.com/docs/marketing-api/audiences/guides/website-custom-audiences/ · `/engagement-custom-audiences/`
- https://developers.facebook.com/documentation/ads-commerce/marketing-api/audiences/guides/lookalike-audiences
- https://developers.facebook.com/docs/marketing-api/brand-safety-and-suitability/
- https://developers.facebook.com/docs/marketing-api/ad-creative/asset-feed-spec/options/ (255/1024 char API maxes)
- https://developers.facebook.com/docs/marketing-api/reference/ad-creative-link-data/ · `/ad-image/`
- https://developers.facebook.com/docs/marketing-api/guides/collection/
- https://developers.facebook.com/docs/marketing-api/conversions-api/ · `/deduplicate-pixel-and-server-events` · `/parameters/customer-information-parameters` · `/parameters/fbp-and-fbc`
- https://developers.facebook.com/docs/marketing-api/advantage-campaigns/
- https://developers.facebook.com/docs/marketing-api/best-practices/manage-your-ad-object-status/
- https://developers.facebook.com/blog/post/2026/02/18/introducing-graph-api-v25-and-marketing-api-v25/ (ASC/AAC API removal)
- https://developers.facebook.com/blog/post/2025/10/16/ads-insights-api-metric-availability-updates/ (7d_view/28d_view deprecation)
- https://developers.facebook.com/ads/blog/post/2018/11/27/with-issues-status-blog/
- https://developers.facebook.com/docs/instagram/ads-api/reference/media-requirements/
- https://github.com/facebook/facebook-python-business-sdk (BrandSafetyContentFilterLevels enum)
- https://github.com/facebook/facebook-business-sdk-codegen/blob/main/api_specs/specs/enum_types.json

### Transparency Center / policy
- https://transparency.meta.com/policies/ad-standards/
- https://transparency.meta.com/policies/ad-standards/objectionable-content/privacy-violations-personal-attributes/
- https://transparency.meta.com/policies/ad-standards/objectionable-content/sensational-content
- https://transparency.meta.com/policies/ad-standards/deceptive-content/circumventing-systems
- https://transparency.meta.com/policies/ad-standards/fraud-scams/unacceptable-business-practices/
- https://transparency.meta.com/policies/ad-standards/unacceptable-content/discriminatory-practices/
- https://transparency.meta.com/features/approach-to-ranking/content-distribution-guidelines/engagement-bait/
- https://transparency.meta.com/features/approach-to-ranking/types-of-content-we-demote/

### Business Help Center
- https://www.facebook.com/business/help/204798856225114 (About Ads In Review — ~24h)
- https://www.facebook.com/business/help/1210227555661027 (troubleshoot rejected ad)
- https://www.facebook.com/business/help/530209463124901 · `/422289316306981` · `/975570072950669` (appeals / Account Quality)
- https://www.facebook.com/business/help/112167992830700 (learning phase) · `/316478108955072` (significant edits) · `/269269737396981` (learning limited)
- https://www.facebook.com/business/help/153514848493595 (Advantage+ campaign budget) · `/458847204894307` (campaign vs ad set budgets)
- https://www.facebook.com/business/help/1362234537597370 (Advantage+ Sales) · `/309994246788275` (Advantage+ App)
- https://www.facebook.com/business/help/1679591828938781 (overlapping audiences)
- https://www.facebook.com/business/help/2720085414702598 (managing ad volume — the "6 ads" page)
- https://www.facebook.com/business/news/demystifying-creative-diversification
- https://www.facebook.com/business/help/2041148702652965 (About CAPI) · `/765081237991954` (EMQ) · `/721422165168355` (AEM — 8-event cap removed)
- https://www.facebook.com/business/help/460276478298895 (attribution setting) · `/854500742637772` (compare attribution)
- https://www.facebook.com/business/help/190490051321426 (daily budgets — the 175% rule)
- https://www.facebook.com/business/help/203183363050448 (minimum budgets)
- https://www.facebook.com/business/help/419552341510847 (custom audience retention)
- https://www.facebook.com/business/help/523719398041952 (supported image formats) · `/469767027114079` (min pixel reqs) · `/463540010482232` (video quality) · `/1675722002698686` (captions) · `/488625428422195` (Audience Network specs)
- https://www.facebook.com/business/help/980593475366490 (Safe Zone — **title only, body unreachable to automated fetch, 2 attempts**)
- https://www.facebook.com/business/help/223409425500940 (text in ads — **title only, body unreachable**)
- **[LIVE via `ads_get_help_article`]** https://www.facebook.com/business/help/401717758239899 · `/643079416901247` · `/3001448133206080` (inventory filter — full body retrieved through the MCP help tool)

### Our specs
- `/Users/sethogieva/Desktop/mingla-orchs/issue-862-meta-ads-api/Mingla_Artifacts/specs/SPEC_ISSUE-862_META_ADS_CAMPAIGN_ENGINE.md` (604 lines, incl. Amendments A1/A2/A3)
- `/Users/sethogieva/Desktop/mingla-orchs/issue-866-creative-library/Mingla_Artifacts/specs/SPEC_ISSUE-866_CREATIVE_LIBRARY.md` (382 lines)

---

## 1. Object hierarchy

```
Business Manager / Portfolio  (830733900115504 "Mingla")
  └── Ad Account               act_2393570861066813   USD, min daily 100¢
        ├── Campaign           objective, buying_type, special_ad_categories, [CBO budget]
        │     └── Ad Set       budget(ABO) · schedule · optimization_goal · billing_event
        │           │          targeting{geo,age,gender,interests,custom_audiences,placements}
        │           │          attribution_spec · promoted_object(pixel) · frequency_control_specs
        │           └── Ad     name · creative ref · tracking_specs · status
        │                 └── Ad Creative   object_story_spec{page_id, link_data|video_data}
        │                                   → requires Page 797406353459597 (+ optional instagram_user_id)
        ├── Ad Images          image_hash        (POST /act_{id}/adimages)
        ├── Ad Videos          video_id          (POST /act_{id}/advideos — ASYNC, poll status)
        ├── Custom Audiences   CUSTOM|WEBSITE|ENGAGEMENT|MOBILE_APP|LOOKALIKE
        └── Datasets/Pixels    1949011972638955 "Mingla Web"
```

**Cardinality.** Campaign 1→N ad sets; ad set 1→N ads; ad 1→1 creative; a creative is reusable across ads. An `image_hash` is **ad-account-scoped** (this is why #866's ref-cache key correctly includes `external_account_id`). A `video_id` is likewise account-scoped. The Page is **not** owned by the ad account — it is assigned to it, and **that assignment is what is currently missing for us** (see §9/§10, GAP-1).

**ID formats.**
| Object | Format | Example / ours |
|---|---|---|
| Ad account | numeric; `act_` prefix in Graph paths, bare in DB | `2393570861066813` → `act_2393570861066813` |
| Business/portfolio | numeric | `830733900115504` |
| Campaign / Ad Set / Ad | numeric string (Graph node ID) | e.g. `23851234567890123` |
| Creative | numeric string | — |
| Page | numeric | `797406353459597` |
| Pixel/Dataset | numeric | `1949011972638955` |
| `image_hash` | 32-char lowercase hex (MD5-like) | — |
| `video_id` | numeric FBID | — |
| Custom audience | numeric | — |
| Interest/behavior | **13–16 digit numeric** | `6003139266461` |
| `object_story_id` | `{pageID}_{postID}` | — |
| Post-ODAX objective | `OUTCOME_*` | `OUTCOME_TRAFFIC` |

**What CBO changes.** Setting `campaign_daily_budget` or `campaign_lifetime_budget` on the campaign implicitly switches it to CBO ("Advantage+ campaign budget"). Under CBO the ad-set-level `daily_budget`/`lifetime_budget` and `bid_strategy` are **rejected** — the campaign's bid strategy governs all children. **[SCHEMA]** — the MCP `ads_create_ad_set` tool explicitly pre-validates this and rejects ABO budgets under a CBO parent ("Must Use Campaign Bid Strategy"). Meta's own guidance: campaign-level budget when ad sets are comparable/scaling; ABO when testing distinct concepts that need isolated learning phases **[OFFICIAL: help/458847204894307]**.

**What Advantage+ changes — and the 2026 API cliff.**
- **Advantage+ placements** (formerly "automatic placements"): *not* a boolean. It is the **absence** of placement targeting. "No action is required to opt in to Advantage+ placement, as it is the default setting in the API" **[OFFICIAL: advantage-campaigns]**. To go manual you populate `publisher_platforms`/`facebook_positions`/etc.
- **Advantage+ audience**: `targeting_automation.advantage_audience` — **defaults to `1` for newly created ad sets as of Marketing API v23.0** **[OFFICIAL]**. Turns `age_min`/`age_max` into suggestions.
- **Advantage+ campaign budget** = the CBO rename.
- **⚠️ Advantage+ Shopping (ASC) / Advantage+ App (AAC) campaigns:** as of **Marketing API v24.0 (2025-10-08)** creation via API was blocked; per the **v25.0 changelog (2026-02-18)** they can **no longer be created OR updated via the Marketing API at all**, phasing out across all versions ~90 days later. Migrated campaigns report `smart_promotion_type = GUIDED_CREATION` **[OFFICIAL: v25 changelog]**. **Engineering consequence: we cannot build "click to make an Advantage+ campaign" via API. Our engine can only build manual campaigns (which is exactly what #862 specs) + the Advantage+ *sub-features* (CBO, A+A, A+ placements) which remain fully API-settable.**

---

## 2. Campaign level — EVERY field

**Endpoint:** `POST /v{ver}/act_{ad_account_id}/campaigns`

### Required
| Field | Type | Notes |
|---|---|---|
| `ad_account_id` | string | numeric, no `act_` prefix in the MCP tool; `act_`-prefixed in the Graph path |
| `name` (`campaign_name` in MCP) | string | |
| `objective` | enum | **ODAX only** — see below |
| `buying_type` | enum | `AUCTION` (default) \| `RESERVED` **[LIVE `ads_get_field_context`]**. `RESERVED` = reach & frequency, buy in advance |
| `special_ad_categories` | JSON array | defaults `[]`. **Required to be present** (may be empty) |

### `objective` — the ODAX 6 (the ONLY accepted values on create)
**[SCHEMA]** `ads_create_campaign` accepts exactly:

| Value | What it optimizes | Ads Manager label |
|---|---|---|
| `OUTCOME_AWARENESS` | "Show your ads to people who are most likely to remember them" — reach/impressions/ad-recall-lift | Awareness |
| `OUTCOME_TRAFFIC` | "Send people to a destination, like your website, app, Instagram profile or Facebook event" — clicks/landing-page views | Traffic |
| `OUTCOME_ENGAGEMENT` | Messages, purchases-via-messaging, video views, post engagement, Page likes, event responses | Engagement |
| `OUTCOME_LEADS` | Collect leads (on-site conversion, instant form, messaging, calls) | Leads |
| `OUTCOME_SALES` | Find people likely to purchase | Sales |
| `OUTCOME_APP_PROMOTION` | Installs + in-app events | App promotion |

> **⚠️ CRITICAL TRAP — [LIVE].** `ads_get_field_context(["objective"])` returns a **22-value enum that still lists all the legacy values** — `APP_INSTALLS, BRAND_AWARENESS, PRODUCT_CATALOG_SALES, CONVERSIONS, CANVAS_APP_ENGAGEMENT, CANVAS_APP_INSTALLS, EVENT_RESPONSES, MOBILE_APP_ENGAGEMENT, LEAD_GENERATION, MESSAGES, MOBILE_APP_INSTALLS, OFFER_CLAIMS, PAGE_LIKES, POST_ENGAGEMENT, REACH, STORE_VISITS, LINK_CLICKS, VIDEO_VIEWS`. **These are read/reporting-historical only.** Passing any of them to create **fails with VALIDATION**. The field-context catalog is a *reporting* catalog, not a *create* contract. Our validator must whitelist the 6 and never trust `ads_get_field_context` for create-time validation. This exact trap is already documented in #862 §4.0 and is confirmed live again this session.

### Optional / used
| Field | Type | Notes |
|---|---|---|
| `campaign_daily_budget` | int (cents) | **CBO.** Mutually exclusive with `campaign_lifetime_budget` |
| `campaign_lifetime_budget` | int (cents) | **CBO.** Requires a stop time |
| `campaign_bid_strategy` | enum | **CBO only.** `LOWEST_COST_WITHOUT_CAP` (default) \| `LOWEST_COST_WITH_BID_CAP` \| `COST_CAP` \| `LOWEST_COST_WITH_MIN_ROAS` |
| `campaign_spend_cap` | int (cents) | lifetime spend ceiling |
| `campaign_start_time` / `campaign_stop_time` | ISO-8601 | |
| `special_ad_category_country` | JSON array | e.g. `["US","CA"]` |
| `promoted_object` | JSON | required for some objectives (APP_PROMOTION, LEADS) |
| `is_skadnetwork_attribution` | bool | iOS app campaigns |
| `campaign_optimization_type` | enum | `NONE` \| `ICO_ONLY` |
| `adlabels` | JSON array | `[{"name":"..."}]` |
| `budget_schedule_specs` | JSON array | high-demand-period budget scheduling |
| `iterative_split_test_configs` | JSON array | A/B test config |
| `source_campaign_id` | string | copy settings from |
| `topline_id` | string | direct-deal insertion order |
| `is_using_l3_schedule` | bool | |
| `status` | enum | `ACTIVE`\|`PAUSED`\|`DELETED`\|`ARCHIVED` — **created PAUSED** |

### `special_ad_categories` — full enum + EXACT restrictions
**[OFFICIAL: special-ad-category]** Values: `HOUSING`, `EMPLOYMENT`, `FINANCIAL_PRODUCTS_SERVICES`, `ISSUES_ELECTIONS_POLITICS`, `NONE`.

> **⚠️ `CREDIT` was RETIRED and replaced by `FINANCIAL_PRODUCTS_SERVICES` effective 2025-01-14.** Any validator whitelisting `CREDIT` is stale. **There is NO `ONLINE_GAMBLING_AND_GAMING` special-ad-category** — gambling is gated by a separate advertiser *authorization* flow, not this field.

Restrictions imposed by HOUSING / EMPLOYMENT / FINANCIAL_PRODUCTS_SERVICES (advertisers in/targeting US, Canada, Europe):

| Dimension | Restriction |
|---|---|
| Age | forced 18–65+ (EU credit ads may differ) |
| Gender | cannot be set — must be all |
| Radius minimum | **15 mi / 25 km** (US+CA); **15 km** (Europe) |
| Location exclusion | **not supported at all** |
| Prohibited location types | `subcity`, `neighborhood`, `metro_area`, `small_geo_area`, `subneighborhood`, `electoral_district`, `zips` |
| Detailed targeting | behavior + demographic targeting removed; interest exclusion removed; detailed-targeting exclusion removed |
| Lookalikes | **unavailable entirely** |

`ISSUES_ELECTIONS_POLITICS` is **different** — targeting is NOT stripped. Instead it requires `authorization_category` at the **ad creative** level: `POLITICAL` or `POLITICAL_WITH_DIGITALLY_CREATED_MEDIA` (required since 2024-01-09 for AI/altered political media). **As of 2025-10-06 SIEP ads may no longer run in the EU at all.**

**Mingla relevance:** we are `NONE` for event/venue traffic. But an events platform can drift into HOUSING (rentals/venue-hire adjacency) or EMPLOYMENT (a "hiring" promo). The field must be **collected and validated**, not hardcoded to `[]` — mis-declaring a special ad category is an account-integrity issue, not a soft error.

### `bid_strategy` semantics
**[LIVE]** `ads_get_field_context(["bid_strategy"])` returns `enum_values: null` — the MCP catalog does not enumerate it; the **[SCHEMA]** is the reliable source:

| Strategy | Requires | Meaning |
|---|---|---|
| `LOWEST_COST_WITHOUT_CAP` | — | autobid / "highest volume" (default) |
| `LOWEST_COST_WITH_BID_CAP` | `bid_amount` (cents) | hard max bid in the auction |
| `COST_CAP` | `bid_amount` (cents) | average cost-per-result target |
| `LOWEST_COST_WITH_MIN_ROAS` | `bid_constraints:{roas_average_floor}` (200 = 2.00×) | value optimization |

### `status`
**[LIVE]** `status` (advertiser-set): `ACTIVE`, `PAUSED`, `DELETED`, `ARCHIVED`. Entities are created PAUSED; launch is **top-down** (campaign → ad set → ad), each level set to `ACTIVE` individually — a paused parent blocks a child's delivery.

---

## 3. Ad set level — EVERY field

**Endpoint:** `POST /v{ver}/act_{ad_account_id}/adsets`

### Required **[SCHEMA]**
`ad_account_id`, `campaign_id`, `name` (`ad_set_name`), `billing_event`, `optimization_goal`, `targeting`.

### `billing_event` — what you are charged for
`IMPRESSIONS` \| `LINK_CLICKS` \| `POST_ENGAGEMENT` \| `VIDEO_VIEWS`. **[SCHEMA]** (`ads_get_field_context` does **not** resolve `billing_event` — it is in `unknown_fields` **[LIVE]**.)

### `optimization_goal` — the two conflicting enums (IMPORTANT)

**[LIVE] `ads_get_field_context` returns 19 values:**
`AD_RECALL_LIFT, APP_INSTALLS, QUALITY_CALL, CONVERSATIONS, OFFSITE_CONVERSIONS, QUALITY_LEAD, VALUE, REACH, EVENT_RESPONSES, IMPRESSIONS, VISIT_INSTAGRAM_PROFILE, LANDING_PAGE_VIEWS, LEAD_GENERATION, LINK_CLICKS, PAGE_LIKES, POST_ENGAGEMENT, REMINDERS_SET, THRUPLAY, TWO_SECOND_CONTINUOUS_VIDEO_VIEWS`

**[SCHEMA] `ads_create_ad_set` accepts a SUPERSET of 26** — it adds: `ENGAGED_PAGE_VIEWS`, `MESSAGING_PURCHASE_CONVERSION`, `MEANINGFUL_CALL_ATTEMPT`, `IN_APP_VALUE`, `PROFILE_VISIT`, `PROFILE_AND_PAGE_ENGAGEMENT`, `VIDEO_VIEWS`. Several are **account-gated** (`MESSAGING_PURCHASE_CONVERSION`, `MEANINGFUL_CALL_ATTEMPT`, `IN_APP_VALUE`, `ENGAGED_PAGE_VIEWS`) — the API errors if the account isn't eligible.

> **Engineering consequence:** neither enum alone is correct. The create-tool superset is the write contract; the field-context 19 is the read/report contract. Our validator must use the **objective→goal compatibility matrix** below, not a flat list.

### Objective → compatible `optimization_goal` (default listed first) **[SCHEMA — verbatim from the create tool]**

| Objective | Compatible optimization_goal values |
|---|---|
| `OUTCOME_AWARENESS` | **REACH**, IMPRESSIONS, AD_RECALL_LIFT, THRUPLAY, TWO_SECOND_CONTINUOUS_VIDEO_VIEWS |
| `OUTCOME_TRAFFIC` | **LINK_CLICKS**, LANDING_PAGE_VIEWS, OFFSITE_CONVERSIONS, IMPRESSIONS, POST_ENGAGEMENT, REACH, CONVERSATIONS, THRUPLAY, VISIT_INSTAGRAM_PROFILE, PROFILE_VISIT, QUALITY_CALL, REMINDERS_SET |
| `OUTCOME_ENGAGEMENT` | **THRUPLAY**, POST_ENGAGEMENT, EVENT_RESPONSES, PAGE_LIKES, IMPRESSIONS, REACH, TWO_SECOND_CONTINUOUS_VIDEO_VIEWS, VIDEO_VIEWS, LINK_CLICKS, CONVERSATIONS, OFFSITE_CONVERSIONS, LANDING_PAGE_VIEWS, QUALITY_CALL |
| `OUTCOME_LEADS` | **OFFSITE_CONVERSIONS**, LEAD_GENERATION, QUALITY_LEAD, LANDING_PAGE_VIEWS, LINK_CLICKS, IMPRESSIONS, REACH, VALUE, CONVERSATIONS, QUALITY_CALL |
| `OUTCOME_SALES` | **OFFSITE_CONVERSIONS**, VALUE, LANDING_PAGE_VIEWS, IMPRESSIONS, POST_ENGAGEMENT, REACH, LINK_CLICKS, CONVERSATIONS |
| `OUTCOME_APP_PROMOTION` | **APP_INSTALLS**, OFFSITE_CONVERSIONS, IMPRESSIONS, LINK_CLICKS, REACH, VALUE, VIDEO_VIEWS |

An invalid goal is **auto-corrected to the recommended default at the server** **[SCHEMA]** — a silent-wrong-config hazard. Our engine must validate client-side rather than rely on Meta's silent correction.

### `promoted_object` — REQUIRED for conversion goals **[SCHEMA]**
Required when `optimization_goal` ∈ {`OFFSITE_CONVERSIONS`, `VALUE`, `LEAD_GENERATION`, `QUALITY_LEAD`, `APP_INSTALLS`, `IN_APP_VALUE`}. Also **required for `OUTCOME_SALES` + WEBSITE destination** — without a `pixel_id` the create fails with "Performance goal isn't available".

Shapes: `{"pixel_id":"123"}` · `{"pixel_id":"123","custom_event_type":"PURCHASE"}` · `{"custom_conversion_id":"123"}` · `{"application_id":"123","object_store_url":"..."}` · `{"page_id":"123"}`.

For `OUTCOME_TRAFFIC`, `promoted_object` is **optional** — but strongly recommended for `LANDING_PAGE_VIEWS` so the pixel is the measurement source.

### `destination_type` — REQUIRED pairings **[SCHEMA]**
Values: `WEBSITE, APP, MESSENGER, INSTAGRAM_DIRECT, WHATSAPP, PHONE_CALL, ON_AD, ON_EVENT, ON_PAGE, ON_POST, ON_VIDEO, INSTAGRAM_PROFILE, FACEBOOK_PAGE, INSTAGRAM_PROFILE_AND_FACEBOOK_PAGE, LEAD_FORM_MESSENGER`.

Mandatory pairings:
- `CONVERSATIONS` / `MESSAGING_PURCHASE_CONVERSION` / `MEANINGFUL_CALL_ATTEMPT` → `MESSENGER` \| `WHATSAPP` \| `INSTAGRAM_DIRECT`
- `VISIT_INSTAGRAM_PROFILE` → `INSTAGRAM_PROFILE`
- `PROFILE_VISIT` → `FACEBOOK_PAGE` \| `INSTAGRAM_PROFILE`
- `PROFILE_AND_PAGE_ENGAGEMENT` → `INSTAGRAM_PROFILE` \| `FACEBOOK_PAGE` \| `INSTAGRAM_PROFILE_AND_FACEBOOK_PAGE`
- `LANDING_PAGE_VIEWS` / `OFFSITE_CONVERSIONS` / `VALUE` → `WEBSITE` (typical)

### Budget + exact minimums

Budgets are **integer minor units of the account currency** (cents for USD). `daily_budget` and `lifetime_budget` are mutually exclusive; `lifetime_budget` **requires `end_time`**.

**[LIVE]** our account: `min_daily_budget_cents = 100` ($1.00), currency USD.

**The right way to get minimums — do NOT hardcode.** `GET /act_{ad_account_id}/minimum_budgets` returns four category fields **[OFFICIAL]**:
| Field | Applies to |
|---|---|
| `min_daily_budget_imp` | impression-optimized ad sets |
| `min_daily_budget_high_freq` | high-frequency actions (clicks, likes) |
| `min_daily_budget_low_freq` | low-frequency actions (app installs, offer claims) |
| `min_daily_budget_video_views` | video-view-optimized ad sets |

Also accepts a `bid_amount` param to compute the minimum for manual-bid strategies.

Commonly-cited USD values **[CONSENSUS — conflicting sources, DO NOT hardcode]**: impressions $1.00/day; high-frequency $5.00/day; low-frequency $40.00/day. One cached doc fragment gave $0.50 / $2.50 / $40.00. **Query the endpoint.**

**Bid-cap multiplier rule [OFFICIAL]:** under `LOWEST_COST_WITH_BID_CAP` the min daily budget must be **≥ `bid_amount`** for impression-optimized ad sets and **≥ 5× `bid_amount`** for click/action-optimized ad sets. (The "4× rule" in circulation is **not** the documented figure — it is 5×.)

**Other budget fields [SCHEMA]:** `daily_spend_cap`, `lifetime_spend_cap`, `daily_min_spend_target`, `lifetime_min_spend_target`, `min_budget_spend_percentage`, `max_budget_spend_percentage`, `budget_schedule_specs`, `daily_imps`/`lifetime_imps` (FIXED_CPM only).

### Schedule / dayparting
- `start_time` / `end_time` — ISO-8601.
- `adset_schedule` — JSON array of dayparting objects: `[{"start_minute":0,"end_minute":1440,"days":[0,1,2,3,4,5,6]}]` **[SCHEMA]**. Minutes are 0–1440 from midnight; `days` 0=Sunday.
- `pacing_type` — `["standard"]` \| `["day_parting"]` \| `["no_pacing"]` **[SCHEMA]**.
- `time_start` / `time_stop`, `campaign_active_time` (UNIX seconds).

### Pacing / delivery [OFFICIAL: help/190490051321426]
> "we may spend up to 75% over your daily budget… up to **175%** of your daily budget… charges will average out over a calendar week (Sunday to Saturday)… you won't spend more than **7 times** your daily budget."

**This is 175%, not 2×.** Standard delivery spreads spend evenly (default/recommended); accelerated spends as fast as possible and is generally only exposed with manual bidding **[CONSENSUS on the accelerated definition — the official page body was not fetchable]**.

### `attribution_spec`
Shape: `[{"event_type":"CLICK_THROUGH","window_days":7,"weight":100}, …]`

| Subfield | Values |
|---|---|
| `event_type` | `CLICK_THROUGH`, `VIEW_THROUGH`, `ENGAGED_VIDEO_VIEW` **[OFFICIAL — exhaustive per the Ad Set reference]** |
| `window_days` | int64. "Supported window lengths differ by optimization goal and campaign objective" — **no single canonical table exists [OFFICIAL statement of variability]**. Commonly 1/7 for click, 1 for view **[CONSENSUS]** |
| `weight` | float, default `100` |

**Current default:** 7-day click + 1-day view (+ 1-day engage-through) **[CONSENSUS, well-corroborated; the official page structure is consistent with it]**. **[SCHEMA]** the MCP tool states the default explicitly: *"Default: 7-day click-through + 1-day view-through"* and **recommends omitting the field** unless the advertiser explicitly requests a window.

**Deprecations that matter:**
- **28-day click** deprecated as a selectable optimization window since **2021-04** (post iOS 14.5) **[OFFICIAL: help/395050428485124]**. Still available **reporting-only** via "Compare Attribution Settings".
- **Insights API deprecated `7d_view`/`28d_view`** as queryable `action_attribution_windows` starting **2026-01-12** **[OFFICIAL: developer blog 2025-10-16]** — this is API-level and distinct from ad-set config. **Directly relevant to #865.**
- `is_incremental_attribution_enabled` **[SCHEMA]** — incremental attribution optimization; supported bid strategies `LOWEST_COST_WITHOUT_CAP`, `COST_CAP`, `LOWEST_COST_WITH_MIN_ROAS`; supported goals `OFFSITE_CONVERSIONS`, `VALUE`, `RETURN_ON_AD_SPEND`. **When using it you must NOT provide `attribution_spec`.**

### Targeting spec — full shape

```json
{
  "geo_locations": {
    "countries": ["US"],
    "regions": [{"key":"3847"}],
    "cities": [{"key":"2418779","radius":10,"distance_unit":"mile"}],
    "zips": [{"key":"US:94304"}],
    "custom_locations": [{"latitude":37.4,"longitude":-122.1,"radius":5,"distance_unit":"mile"}],
    "location_types": ["home","recent"]
  },
  "excluded_geo_locations": { "...": "same shape" },
  "age_min": 18,
  "age_max": 65,
  "genders": [1, 2],
  "locales": [6],
  "flexible_spec": [
    { "interests": [{"id":"6003139266461","name":"Movies"}],
      "behaviors": [{"id":6002714895372,"name":"All travelers"}] }
  ],
  "exclusions": { "interests": [{"id":"...","name":"..."}] },
  "custom_audiences": [{"id":"<CA_ID>"}],
  "excluded_custom_audiences": [{"id":"<CA_ID>"}],
  "targeting_automation": { "advantage_audience": 0 },
  "publisher_platforms": ["facebook","instagram"],
  "facebook_positions": ["feed","story","facebook_reels"],
  "instagram_positions": ["stream","story","reels"],
  "device_platforms": ["mobile","desktop"],
  "brand_safety_content_filter_levels": ["FEED_STANDARD","AN_STANDARD"]
}
```

**Geo limits [OFFICIAL]:**
| Sub-field | Limit |
|---|---|
| `regions` | 200 |
| `cities` | 250; radius **10–50 mi** or **17–80 km** |
| `zips` | **50,000** (raised from 2,500) |
| `custom_locations` (pin drop) | 200; radius **0.63–50 mi** or **1–80 km** |
| `location_types` | `home`, `recent` only; defaults to both |

Geo sub-types resolvable via Targeting Search `type=adgeolocation`: `country`, `region`, `city`, `zip`, `electoral_district`, `geo_market` (DMA, e.g. `"DMA:622"`).

**Age [OFFICIAL]:** `age_min` defaults 18; if set must be **≥13**. `age_max` if set must be **≤65** — **65 means "65+", there is no band above it.** So "13–65+" is the true full range, and 13–17 targeting is heavily restricted in practice.

**Gender:** `1` = male, `2` = female. **No non-binary/other enum value is documented.** Omit for all.

**Locales:** array of **numeric** locale IDs (not `ll_CC` strings — that format is for creative-level Dynamic Language Optimization, a different system). Resolve via Targeting Search `type=adlocale`. **[UNVERIFIED]** — the specific numeric ID list could not be pulled; resolve at runtime.

**Detailed targeting (`flexible_spec`):**
- Interests/behaviors are `{id, name}` pairs. **IDs are 13–16 digit numerics and MUST be real.** Never invent them; `"000"`/`"123"` are rejected **[SCHEMA]**.
- **AND across groups, OR within a group array.**
- If you use `flexible_spec`, `targeting` must ALSO include one of `geo_locations`, `custom_audiences`, `product_audience_specs`, or `dynamic_audience_ids` **[OFFICIAL]**.
- Browse classes via `type=adTargetingCategory&class=`: `life_events`, `industries`, `income`, `family_statuses`, `user_device`, `user_os`, `behaviors`, `demographics`.

**⚠️ Correction to #862 §4.0.** The spec says interest IDs come "from a Targeting-Search API — **not exposed in this MCP**" and therefore defers interest targeting. The first half is right, the conclusion is wrong for production: the MCP lacks it, but the **Graph API has it and our System User token can call it**:

```
GET /v{ver}/search?type=adinterest&q=nightlife&limit=25&access_token={token}
→ [{ id, name, path[], audience_size_lower_bound, audience_size_upper_bound, topic }]
GET /v{ver}/search?type=adinterestvalid&interest_fbid_list=["6003139266461"]&access_token={token}
GET /v{ver}/search?type=adTargetingCategory&class=behaviors&access_token={token}
GET /v{ver}/search?type=adgeolocation&location_types=["city"]&q=London&access_token={token}
GET /v{ver}/search?type=adlocale&q=english&access_token={token}
```

**Interest targeting is buildable now.** The MCP's absence is an artifact of the exploration tool, not a production constraint. (Whether we *should* use interests is a separate question — see §8, where broad + A+A is the modern doctrine.)

### `targeting_automation.advantage_audience` [OFFICIAL]
- int, `0` or `1`. **Defaults to `1` for newly created ad sets as of Marketing API v23.0** (updating an existing ad set does not retroactively flip it).
- Expands the eligible pool beyond your detailed targeting. **"Non-negotiable business constraints are NOT expanded — these include location constraints, minimum age, language, and custom audience exclusions."**
- **When active, the system resets `age_min`/`age_max` to defaults**; you may still pass `age_min` **18–25 only**, and `age_max` is **fixed at 65**.
- Hard-disable: `"targeting_automation": {"advantage_audience": 0}`.
- Related levers: `targeting_optimization_types` (view-only, campaign-level), `targeting_relaxation_types` (editable, ad-set, lookalike+CA expansion), `targeting_optimization` (editable, ad-set, detailed-targeting expansion). Meta auto-sets lookalike/detailed expansion to `1` by default across 20+ optimization goals. **Not supported in Reservation buying.**

**Mingla consequence:** #862 §4.0 correctly notes A+A is on by default and that `age_min`/`age_max` become suggestions. What it does **not** capture: with A+A on, **`age_min` above 25 is silently unusable**. If we ever want a 30+ audience we must set `advantage_audience: 0`. The spec's create sequence does pass `advantage_audience: 0` (§4.4b step 2) — that is correct and should be preserved, but it must be a *deliberate, documented* choice with a UI toggle, because turning A+A off is now against Meta's own delivery advice for broad campaigns.

### Custom audiences & lookalikes

**Subtypes [SCHEMA — `ads_create_custom_audience`]:** `CUSTOM` (customer list/DFCA), `WEBSITE` (WCA), `ENGAGEMENT` (ECA), `MOBILE_APP` (MACA), `LOOKALIKE` (LAL).

**[OFFICIAL]** `IG_BUSINESS`, `FB_EVENT`, `EXPERIMENTAL`, `MULTI_DATA` exist but are **Ads-Manager-only, not API-writable**.

| Subtype | Required fields | Notes |
|---|---|---|
| `CUSTOM` | `customer_file_source` ∈ {`USER_PROVIDED_ONLY`,`PARTNER_PROVIDED_ONLY`,`BOTH_USER_AND_PARTNER_PROVIDED`} | created **empty**; add users via `ads_update_custom_audience_users`. `retention_days` 1–180 (default 180). `is_value_based` for value optimization |
| `WEBSITE` | `rule` (JSON-encoded **string**, pixel `event_sources`) | templates `ALL_VISITORS`, `VISITORS_BY_URL`, `TOP_TIME_SPENDERS`; retention via `retention_seconds` in the rule |
| `ENGAGEMENT` | `rule` with `ig_business`/`page`/`shopping_page`/`shopping_ig`/`marketplace_listings`/`lead`/`ig_lead_generation`/`canvas` sources | |
| `MOBILE_APP` | `rule` with `app` sources | templates `MACA_APP_LAUNCHED_USERS`, `MACA_MOST_ACTIVE_USERS`, `MACA_TOP_PURCHASE_USERS`; percentile windows **top 5%, 10%, 25% only** |
| `LOOKALIKE` | `origin_audience_id` + `lookalike_ratio` | origin must NOT itself be a LOOKALIKE |

**⚠️ Lookalike ratio is 1%–20%, NOT 1%–10%.** **[OFFICIAL + SCHEMA agree]** — range `0.01`–`0.20` in `0.01` steps. `0.01` = closest match/smallest. **[SCHEMA]** also notes: geography is handled automatically (`allow_international_seeds=true`) — **do not ask the user for a country**.

**Minimum seed audience: ≥100 people** **[OFFICIAL]** (practical quality threshold much higher, ~300–500+ **[CONSENSUS]**).

`lookalike_spec` shape: `origin_audience_id` (req), `ratio` (req), `starting_ratio` (opt), `country` (req), `type` ∈ {`similarity`,`reach`}.

**Retention windows [OFFICIAL: `retention_days`]:**
| Audience type | Max |
|---|---|
| Website (pixel) | **180 days** |
| Video engagement | **365 days** |
| Page / IG business profile / Instant Experience | **730 days** |
| Shopping / AR engagement | **365 days** |
| Lead Gen ads | **90 days** |
| Page/IG likes | no limit |
| Offline events | 180 days |

Note an **API-vs-UI discrepancy**: Ads Manager commonly surfaces a 365-day cap for engagement audiences even where the API guide documents up to 730. **[UNVERIFIED]** a reported expansion to 730 days for purchase-event web/app audiences effective 2026-05-18.

**Retargeting mechanics:** pixel/CAPI event stream matched against a `rule` (URL pattern or standard event) with a `retention_days` trailing rolling window.

### Placements — full enum

**`device_platforms`** — `mobile`, `desktop`; (`connected_tv` in Meta's codegen superset, **[UNVERIFIED]** wire value).

**`publisher_platforms`** — `facebook`, `instagram`, `audience_network`, `messenger`, `threads`; (`whatsapp`, `oculus` in codegen, **[UNVERIFIED]**).
Constraints: if `publisher_platforms` is provided it must include `facebook` or be omitted entirely to default to all. `audience_network` **cannot be used alone**.

**`facebook_positions`** — `feed`, `right_hand_column`, `marketplace`, `video_feeds`, `story`, `search`, `instream_video`, `facebook_reels`, `facebook_reels_overlay`, `profile_feed`, `notification`.
Constraints: `right_hand_column` only valid for single image / single video / carousel, and cannot be used alone for video/collection/canvas. `story` requires `device_platforms: mobile`.
Codegen-only/legacy **[UNVERIFIED]**: `BIZ_DISCO_FEED`, `FACEBOOK_CONTEXTUAL_BUNDLE`, `GROUPS`, `GROUP_MALL`, `GROUP_TAB`, `INSTANT_ARTICLE`, `INSTREAM_REEL`, `JOBS_BROWSER`, `STORY_STICKER`, `SUGGESTED_VIDEO`.

**`instagram_positions`** — `stream`, `story`, `explore`, `explore_home`, `reels`, `profile_feed`, `ig_search`, `profile_reels`.
Codegen-only **[UNVERIFIED]**: `EFFECT_TRAY`, `IGTV`, `LEAD_GEN_MULTI_SUBMIT`, `SHOP`, `REELS_INSTREAM`, `REELS_OVERLAY`.

**`audience_network_positions`** — `classic`, `rewarded_video`. Cannot be used alone.

**`messenger_positions`** — `sponsored_messages` (**cannot combine with any other placement, including Facebook**), `story`, `messenger_home`.

**`threads_positions`** — `threads_stream` (the only value). **Requires also selecting Instagram `stream`.**

### Frequency cap — `frequency_control_specs` [OFFICIAL]
| Field | Values |
|---|---|
| `event` | `IMPRESSIONS`, `VIDEO_VIEWS`, `VIDEO_VIEWS_2S`, `VIDEO_VIEWS_15S` |
| `interval_days` | **1–90** inclusive |
| `max_frequency` | **1–90** inclusive |
| `type` | `NONE`, `CAP`, `TARGET` |

Example: `{"event":"IMPRESSIONS","interval_days":3,"max_frequency":1}`.

> **⚠️ Hard constraint [OFFICIAL]:** *"Writes to this field are only available in ad sets where **REACH** and **THRUPLAY** are the performance goal."* Frequency capping is **not available** on our recommended `LANDING_PAGE_VIEWS`/`LINK_CLICKS` traffic ad sets. Any "set a frequency cap" UI must be conditionally gated on the optimization goal or it will 400.

### Brand safety / inventory filter
**API field:** `brand_safety_content_filter_levels` — `list<string>` on the `Targeting` object.

**Values [OFFICIAL — Meta's own Python SDK, class `BrandSafetyContentFilterLevels`]:**
`AN_RELAXED`, `AN_STANDARD`, `AN_STRICT`, `FACEBOOK_RELAXED`, `FACEBOOK_STANDARD`, `FACEBOOK_STRICT`, `FEED_DNM`, `FEED_NESTED_DNM`, `FEED_RELAXED`, `FEED_STANDARD`, `FEED_STRICT`, `UNINITIALIZED`, `UNKNOWN`.

Prefixes: `AN_` = Audience Network, `FACEBOOK_` = in-stream/Reels-type surfaces, `FEED_` = feed surfaces.

**UI mapping [LIVE via `ads_get_help_article` — full article body retrieved, help/3001448133206080]:**
| UI name | Meaning (verbatim) | API tier |
|---|---|---|
| **Expanded inventory** | "show ads adjacent to content that adheres to our content monetization policies so you get the most reach" | `*_RELAXED` |
| **Moderate inventory** | "exclude highly sensitive content. this lowers your reach and may increase costs" | `*_STANDARD` |
| **Limited inventory** | "exclude additional sensitive content **and live videos**. this lowers reach and can increase costs" | `*_STRICT` |

**[LIVE — verbatim]** *"By default, you're opted into **expanded**."* Two control families exist: **feed ads** (FB+IG feed, Reels feed, Threads feed) → inventory filter + publisher block lists; **in-content ads** (FB in-stream reels, ads on FB Reels, Audience Network) → inventory filter + content block lists + **topic exclusions**. Content failing Community Standards (full nudity, excessive violence, terrorist acts, third-party-fact-checked misinformation) is excluded by default regardless.
Caveat **[LIVE — verbatim]**: *"if you don't see the option to use inventory filter, contact your meta account representative for access"* — this may be gated for our account.

### Dataset / pixel selection
Passed via `promoted_object.pixel_id` on the ad set. **[LIVE]** our only dataset is `1949011972638955` "Mingla Web" — see the alarming state in §9.

### Other notable ad-set fields **[SCHEMA]**
`is_dynamic_creative` (DCO), `is_dynamic_creative_format_automation`, `saved_audience_id`, `saved_audience`, `adjust_lookalikes`, `dsa_beneficiary` / `dsa_payor` (**required for EU geo** — auto-filled from the ad account's business name if omitted), `tune_for_category` (`HOUSING`|`CREDIT`|`EMPLOYMENT`|`ISSUES_ELECTIONS_POLITICS`), `conversion_locations` (`WEBSITE`|`APP`|`MESSAGING`|`PHONE_CALL`|`SHOP`|`UNDEFINED`), `cost_bidding_mode` (`VOLUME_FOCUSED`|`BALANCED`|`COST_FOCUSED`), `optimization_sub_event`, `conversion_goal_id`, `existing_customer_budget_percentage`, `marketing_goal` (`NONE`|`NEW_CUSTOMER_ACQUISITION`), `contextual_bundling_spec`, `placement_soft_opt_out`, `creative_sequence`, `time_based_ad_rotation_id_blocks`/`_intervals`, `include_in_ad_study_id`/`_cell_id`, `rf_prediction_id` (Reach & Frequency), `value_rule_set_id`/`value_rules_spec`, `calling_settings`, `brand_audience_id`, `campaign_attribution` (`AEM`|`SKAN`), `lightweight_split_test_options`.

---

## 4. Ad & creative level — EVERY field

### Ad — `POST /act_{id}/ads` **[SCHEMA]**
**Required:** `ad_account_id`, `ad_set_id`, `ad_name`, `creative`.

`creative` must include **exactly one** source:
1. `{"creative_id": "<id>"}` — reuse an existing creative entity
2. `{"object_story_id": "<pageID>_<postID>"}` — promote an existing post
3. `{"object_story_spec": {...}}` — inline creative

> **⚠️ `page_id` is ALWAYS required inside `object_story_spec`.** Omitting it → **"Facebook Page is Missing"** rejection **[SCHEMA, verbatim]**. `object_story_spec` must carry `page_id` **plus** exactly one of `link_data`, `video_data`, `photo_data`, `template_data`.

**Field-placement rule [SCHEMA, verbatim]:** for `link_data`, prefer `image_hash` (from `ads_get_ad_images`) over `image_url` — *"image_hash references an already-uploaded image and is the canonical field. If you have only an image URL, place it at the creative **top level** (not inside link_data)."* For `video_data`, the platform auto-generates a thumbnail from the first frame when `image_hash`/`image_url` is omitted.

Minimal example **[SCHEMA, verbatim]**:
```json
{"object_story_spec":{"page_id":"<PAGE_ID>","link_data":{"link":"https://example.com","image_hash":"<HASH>","message":"Check this out"}}}
```

**Other ad fields:** `ad_schedule_start_time` / `ad_schedule_end_time` (ISO-8601), `adlabels`, `adset_spec` (inline ad set), `bid_amount`, `conversion_domain` (**for Aggregated Event Measurement**), `display_sequence`, `engagement_audience`, `source_ad_id`, `tracking_specs`, `status`.

### Ad Creative — `POST /act_{id}/adcreatives` **[SCHEMA]**
**Required always:** `ad_account_id`, `page_id`.

| Format | Additional required |
|---|---|
| **Image** | `link_url` + exactly one of `image_hash` \| `image_url` |
| **Video** | `video_id` + exactly one of `image_hash` \| `image_url` (**the thumbnail/cover — required**). `link_url` **optional** for video |
| **Advantage+ catalog carousel** | `product_set_id` + `link_url`. **Do NOT provide `image_hash`/`image_url`/`video_id`** — media comes from the catalog |

**Optional (all formats):** `message` (primary text — body above the media), `headline` (under the media), `description` (short description under the media), `call_to_action_type` (default `LEARN_MORE`), `name` (library name — *"strongly recommended"*), `instagram_user_id` (**omit → the creative will NOT deliver on Instagram surfaces**), `self_ai_disclosure`.

**Marketing-API field-name mapping [SCHEMA — `ads_get_creatives`, verbatim]:**
| API field | Ads Manager label |
|---|---|
| `body` | **Primary text** |
| `title` | **Headline** |
| `child_attachments[].name` | Headline (per carousel card) |
| `child_attachments[].description` | Card description |

For carousel `message`, template strings like `{{product.name}}` are filled from the catalog at delivery time.

**`self_ai_disclosure`** — `OPT_IN` (contains third-party generative-AI created/edited media) \| `OPT_OUT`. Only these two exact UPPER_CASE values. When opted in Meta may display an "AI info" label; whether it appears depends on the delivery region's AI-transparency requirements. **Directly relevant to Mingla: our ad pipeline is Higgsfield/AI-generative (`cinematic-ad-director`). Any Higgsfield-produced creative arguably requires `OPT_IN`. This field is absent from both #862 and #866.**

### `call_to_action_type` — FULL enum **[SCHEMA, verbatim by category]**

- **Shopping:** `SHOP_NOW`, `BUY_NOW`, `ORDER_NOW`, `START_ORDER`, `ADD_TO_CART`, `SEE_SHOP`, `BROWSE_SHOP`, `VIEW_PRODUCT`, `BUY`, `SELL_NOW`, `SHOP_WITH_AI`
- **General:** `LEARN_MORE` (default), `SIGN_UP`, `OPEN_LINK`, `GET_STARTED`, `SEE_MORE`, `FIND_OUT_MORE`, `VISIT_WEBSITE`, `GET_DETAILS`, `CONFIRM`, `NO_BUTTON`
- **Contact:** `CALL_NOW`, `CALL`, `CONTACT_US`, `CONTACT`, `GET_QUOTE`, `GET_A_QUOTE`, `MESSAGE_PAGE`, `WHATSAPP_MESSAGE`, `GET_IN_TOUCH`, `AUDIO_CALL`, `VIDEO_CALL`, `EMAIL_NOW`, `ASK_A_QUESTION`, `CHAT_NOW`, `CHAT_WITH_US`, `ASK_FOR_MORE_INFO`
- **Booking:** `BOOK_NOW`, `BOOK_TRAVEL`, `REQUEST_TIME`, `MAKE_AN_APPOINTMENT`, `BOOK_A_CONSULTATION`, `GET_SHOWTIMES`, **`BUY_TICKETS`**
- **App:** `INSTALL_APP`, `INSTALL_MOBILE_APP`, `USE_APP`, `USE_MOBILE_APP`, `DOWNLOAD`, `PLAY_GAME`, `OPEN_INSTANT_APP`, `UPDATE_APP`
- **Lead Gen:** `APPLY_NOW`, `INQUIRE_NOW`, `GET_OFFER`, `GET_DIRECTIONS`
- **Engagement:** `SUBSCRIBE`, `FOLLOW_PAGE`, **`EVENT_RSVP`**, `DONATE`, `DONATE_NOW`, `RAISE_MONEY`, `REFER_FRIENDS`
- **Media:** `WATCH_VIDEO`, `WATCH_MORE`, `LISTEN_NOW`, `LISTEN_MUSIC`, `WATCH_LIVE_VIDEO`

**Mingla-relevant CTAs:** `BOOK_NOW`, `BUY_TICKETS`, `GET_SHOWTIMES`, `EVENT_RSVP`, `LEARN_MORE`, `GET_DIRECTIONS`. Note `GET_TICKETS` **is not a real enum value** — #862 §4.0 correctly maps `GET_TICKETS → BUY_TICKETS`. **CTA destination is auto-set to `link_url`** **[SCHEMA]**.

### URL / destination fields
- `link_url` (creative-level) / `link_data.link` / `call_to_action.value.link` — the click destination. **[SCHEMA]** *"Always include https:// scheme; if omitted the tool prepends it automatically."*
- `caption` / display link — the shown domain (not in the MCP tool's surface; exists on the real `link_data`).
- `url_tags` — URL params appended at delivery (e.g. `utm_source=facebook&utm_campaign={{campaign.name}}`). **Not exposed by the MCP create tool** but first-class on the Graph `adcreative` object. Supports dynamic macros: `{{campaign.id}}`, `{{campaign.name}}`, `{{adset.id}}`, `{{adset.name}}`, `{{ad.id}}`, `{{ad.name}}`, `{{placement}}`, `{{site_source_name}}`.
- `tracking_specs` (ad-level) — conversion tracking config.
- `conversion_domain` (ad-level) — required for AEM.
- Deep link — carried in `link_data.app_link` or via the destination URL itself. **Our A1 amendment puts an AppsFlyer OneLink in `link_url`.** See GAP-8 (policy risk).
- Lead form — `link_data.lead_gen_form_id` / `object_story_spec` with `LEAD_FORM_*`; requires the Page to have `leadgen_tos_accepted=true` **[SCHEMA]** (check via `ads_get_ad_account_pages`; accept at https://www.facebook.com/legal/leadgen/tos).
- Call ads — `calling_settings` on the ad set + `CALL_NOW` CTA.

### Text limits — EXACT

**No official hard/API-enforced character ceiling exists for single-image/video primary text, headline, or description.** The Graph reference types them as unconstrained strings with no documented `maxlength`. The numbers below are Meta's **"recommended for full display"** figures from the live Ads Guide.

| Placement | Primary text | Headline | Description |
|---|---|---|---|
| Facebook Feed | **50–150** | **27** | not listed |
| Instagram Feed | **125** | **40** | not listed |
| Facebook Stories | **125** | **40** | not listed |
| Instagram Stories | **125** | (not shown) | not listed |
| Facebook Reels overlay | **60** (varies by objective; 40 in some variants) | **10** | not listed |
| Facebook Marketplace | **125** | **40** | **30** |
| Facebook Right Column | not listed | **40** | not listed |
| Carousel — FB Feed (per card) | **80** | **20** | **18** |
| Carousel — IG Feed/Stories (per card) | **125** | **40** (Stories) | — |
| Collection — all | **125** | **40** (Feed) | — |

**The ONLY official hard API maxes [OFFICIAL: asset-feed-spec/options]** — these apply to Carousel/Collection asset-feed fields and are safe to hardcode:
| Field | API-accepted max |
|---|---|
| Primary text / body | **1024 chars** |
| Headline / description | **255 chars** |

**Truncation:** Meta publishes no explicit "truncated after X characters" rule. The well-known "See More" cutoff (~125 chars on mobile feed) is **[CONSENSUS]** only, and those sources note truncation is **line-wrap/render-driven, not a fixed character index** — it varies by device and screen. The likely canonical official page (help/223409425500940) returned title-only on two independent fetch attempts.

**Engineering rule:** treat the per-placement numbers as **warn** thresholds (truncation risk), and 1024/255 as **hard reject** thresholds. Do not reject at 125.

### Formats
| Format | Creative shape |
|---|---|
| Single image | `link_data` + `image_hash` |
| Single video | `video_data` + `video_id` + thumbnail `image_hash` |
| Carousel | `link_data.child_attachments[]` (2–10) |
| Collection | `link_data` + `template_data` + **mandatory Instant Experience** |
| Advantage+ catalog | `product_set_id` (no manual media) |
| Dynamic/DCO | ad set `is_dynamic_creative: true` + `asset_feed_spec` |

### Identity
- **Page** — `object_story_spec.page_id`, always required. Ours: `797406353459597`.
- **Instagram** — `instagram_user_id` on the creative. **Omit → no Instagram delivery.** **[LIVE]** `ads_get_ig_accounts(2393570861066813)` → *"This tool is new and is being gradually rolled out across ad accounts. Please check back at a later date."* We cannot enumerate our IG account via MCP; it must be resolved via Graph (`GET /act_{id}/instagram_accounts` or the Page's connected IG business account) or the Business Settings UI.

---

## 5. Creative format specs — exhaustive table per format

> **Two ground rules established by this research.** (1) Meta's current Ads Guide recommends **1440×1800** (feed 4:5) and **1440×2560** (vertical 9:16) — **not** the 1080×1080/1080×1920 still cited by most third-party blogs; 1080-class remains a valid *minimum* but is no longer the "recommended" figure. (2) **Do not build text-density (20%) validation — the rule is dead** (see §7).

### Single image
| Spec | Value | Scope |
|---|---|---|
| Recommended resolution | **1440×1800** | FB Feed, IG Feed |
| Recommended resolution | **1440×2560** | FB/IG Stories, IG Reels |
| Recommended resolution | **≥1080×1080** | Right Column, Search, In-Stream, Marketplace |
| Aspect ratios | **4:5** (FB Feed) · **1:1** (IG Feed, Right Column, Marketplace; continuum 4:5–1.91:1 supported) · **9:16** (Stories/Reels) · **1.91:1–1:1** (Search, In-Stream) | |
| Aspect tolerance | **3%** (Feed, Search, In-Stream) · **1%** (IG Feed, Stories, Reels) | |
| Min width — UI floor | **500 px** | IG Feed/Stories/Reels, FB Stories |
| Min width — **API floor** | **600 px** ("we require ≥600px width") | Instagram ads-api. **⚠️ Conflicts with the 500px UI figure — use 600 px as the safe engineering floor** |
| Min — FB Feed hard floor | **600×750** | |
| Min — Right Column | **254×133** | |
| Min — Search / In-Stream | **600×600** | |
| Min — Audience Network Native | **398×208** | *(this page also labels the ratio "9:16", which is numerically inconsistent with 398×208 ≈ 1.91:1 — an internal Meta page inconsistency)* |
| **Max file size** | **30 MB** | **ALL placements — very consistent** |
| File types | BMP, DIB, HEIC, HEIF, IFF, JFIF, JP2, JPE, JPEG, JPG, PNG, PSD, TIF, TIFF, WBMP, WEBP, XBM. **"recommend JPG or PNG"** | |
| Static GIF | not in the supported list; no explicit denial → **treat as unsupported** | |
| sRGB / color profile | **[UNVERIFIED]** — blog claim only, not on any official page. **Do not hardcode** | |

### Single video
| Spec | Value |
|---|---|
| Recommended resolution | **1440×1800** (FB Feed 4:5) · **1080×1920** (IG Feed) · **1440×2560** (Stories/Reels) · **≥1080×1080** floor (In-Stream, Audience Network) |
| Aspect ratios | **4:5** Feed · **9:16** Stories+Reels (±1%) · **16:9 or 1:1** In-Stream · **16:9–9:16** Audience Network (in-stream subset 4:3–16:9) |
| **Max file size** | **4 GB** (all Ads Guide placements) |
| Alt max file size | **2.3 GB**, duration 3–60s — Instagram ads-api "media-requirements" doc. Likely a distinct ingestion path; **flagged, unreconciled** |
| Container | **MP4, MOV** |
| Codec (verbatim, repeats on every placement page) | **H.264, square pixels, fixed frame rate, progressive scan, stereo AAC audio ≥128 kbps** |
| Frame rate | **≤30 fps** |
| Audio sample rate | **44,100 Hz** stereo |
| Alt codecs | VP8 / Vorbis mentioned on **one** page only (IG Stories design-req) — isolated |
| **Bitrate (Mbps)** | **NOT FOUND on any official page.** "5–10 Mbps" is blog folklore. **Do not hardcode** |
| Captions | "optional but recommended"; FB In-Stream/Reels "strongly recommended"; **Audience Network: captions NOT supported** |
| Caption format | `.srt`, named `filename.[lang]_[country].srt`; or Meta auto-generates (English-only, FB/IG only) |
| Thumbnail | **No fixed official pixel resolution exists** (confirmed absence, not a fetch failure). Guidance: match the video's aspect ratio; Meta can auto-pick from up to 3 frames or you upload your own |

**Video duration — min/max PER PLACEMENT:**
| Placement | Min | Max |
|---|---|---|
| Facebook Feed | 1 sec | **241 min** *(unusual but verified twice)* |
| Instagram Feed | 1 sec | 60 min |
| Facebook Stories | 1 sec | **3 min** |
| Instagram Stories | 1 sec | 60 min |
| Instagram Reels | 0 sec | **15 min** |
| Facebook Reels | not stated | **"No maximum limit"** *(re-verified directly)* |
| FB In-Stream (Desktop) | 5 sec | 15 sec |
| FB In-Stream (Mobile) | 5 sec | 10 min (15 sec recommended) |
| Audience Network Native/Banner/Interstitial | 1 sec | 120 sec |
| Audience Network In-stream | 5 sec | 30 sec |
| Audience Network Rewarded | 3 sec | ~60 sec |

> **⚠️ Reels have no 60s/90s cap.** Third-party sources claiming one are stale/conflating organic-Reels history. Official IG Reels = 15 min; FB Reels = no max. **Do not hardcode 60/90.**

### Carousel
| Spec | Value |
|---|---|
| Cards | **2–10** (current Ads Guide) |
| Legacy conflict | a legacy IG ads-api doc says 2–3 min and a 5-card cap on Stream — **stale; use 2–10** |
| Image ratio | 1:1 (FB Feed) · 1:1, 3:4, 4:5 (IG Feed) · 9:16 (IG Stories) |
| Image resolution | ≥1080×1080 (1080×1920 IG Stories); **API hard floor 600×600** |
| Image file type | JPG or PNG |
| Video file type | MP4, MOV, GIF |
| Video duration | FB Feed 1s–240min · IG Feed 1s–2min · IG Stories 1s–15s *(legacy doc says 120s for "standard cards" vs 15s "fixed cards" — a real sub-format distinction not broken out on the current page)* |
| Max file size | image **30 MB** · video **4 GB** |
| Asset-feed totals | ≤10 images, ≤10 videos |
| **Video codec** | **NOT FOUND on any official carousel page** — do not assume H.264 without a check |
| Per-card text | headline 20 (FB Feed) / 40 (IG Stories); description 18 (FB Feed); primary 80 (FB Feed) / 125 (IG) |
| **API hard max** | primary **1024**, headline/description **255** |
| Structure | Primary text set **once at ad level** (applies to all cards); headline + description are **per-card** |

### Collection
| Spec | Value |
|---|---|
| Cover image ratio | **1.91:1 to 1:1** — **including IG Stories Collection** (NOT 9:16; verified) |
| Cover image resolution | ≥1080×1080; 30 MB; JPG/PNG |
| Cover video | 1.91:1–1:1; ≥1080×1080; 4 GB; MP4/MOV/GIF. **Duration/codec not stated on any fetched Collection page** — gap |
| Instant Experience | **MANDATORY** ("Instant Experience: Required") — 2 independent sources |
| IE templates | **Storefront, Lookbook, Customer Acquisition** (or fully custom) |
| Product tiles shown | **3** (FB Feed, IG Feed) · **2** (IG Stories) |
| Product tile min | 500×500 |
| Rotation pool | **≥4 unique items** required (`collection_thumbnails` requires 4) — reconciles the "3 displayed vs 4 required" apparent conflict |
| `max_items` on `canvas_product_set` | example shows 50 — **illustrative, not a documented hard ceiling** |
| Source | Catalog/product-set driven; requires an existing Meta Catalog |
| Text | primary 125; headline 40 (FB/IG Feed) |

### Stories / Reels — vertical + SAFE ZONES
| Format | Recommended res | Ratio (tol.) | Top safe | Bottom safe | Sides | Duration |
|---|---|---|---|---|---|---|
| **FB Stories — Image** | 1440×2560 (min width 500) | 9:16 (±1%) | **14%** (~269px @1080w) | **35%** (~672px) | **6%** each (~65px) | 8 sec or until swipe |
| **FB Stories — Video** | 1440×2560 | 9:16 (±1%) | **14% / 250px** | **20% / 340px** | not stated | 1 sec – 3 min |
| **IG Stories — Image/Video** | 1440×2560 (video min width 250) | 9:16 (±1%) | 14% | 35% | 6% | Image 5–16s or until swipe; Video 1s–60min |
| **IG Reels — Video** | 1440×2560 (min width 250 <30s / 500 ≥30s) | 9:16 | 14% | 35% | 6% | 0s – 15 min |
| **FB Reels — Video** | 1440×2560 | 9:16 | 14% | 35% | 6% | min n/s; **no max** |

> **⚠️ FB Stories has two conflicting official safe-zone specs** — the Image page says 35% bottom, the Video page says 20% bottom. **Confirmed real internal Meta inconsistency, not a fetch artifact.** **Engineering rule: design to the stricter unified 14% top / 35% bottom / 6% sides across all four vertical formats.**
>
> **Caveat:** Meta's dedicated safe-zone article (help/980593475366490) returned **title-only on two independent fetch attempts across two agent passes**. If pixel-exact certainty is required for a build gate, a human should open it in a logged-in browser.

**Safe-zone math at a 1080×1920 canvas:** top 14% = **269 px**; bottom 35% = **672 px**; sides 6% = **65 px** each. Usable central band ≈ **950 × 979 px**. All CTA/logo/legible text must live inside it.

### Text-in-image / the 20% rule — DEAD
| Fact | Value |
|---|---|
| Removed? | **Yes** |
| When | **~September 2020** (week of Sept 7–23) — 3 independent trade outlets, consistently dated **[CONSENSUS]** |
| What changed | From outright rejection/reach-throttling → **zero enforcement** |
| Text Overlay Tool | retired/redirected at the same time |
| **Current status — strongest evidence** | **[OFFICIAL]** `transparency.meta.com/policies/ad-standards/` was **directly fetched and contains NO language about text-in-image ratios or overlay restrictions at all** — a direct negative confirmation on Meta's live policy doc |
| Residual advisory | "images with less than 20% text perform better" likely still lives on help/223409425500940 — **body unreachable, verbatim unconfirmed** |
| Soft algorithmic penalty | **[CONSENSUS/folklore]** — delivery models may still statistically favor low-text creative. No official statement |
| Do not confuse with | **Safe Zone** (a layout/UI-overlap rule) — structurally unrelated and **still current** |

**Build rule: implement ZERO text-density validation. Implement safe-zone validation.**

---

## 6. Placements → creative requirement → wanted aspect ratio

| Placement (API value) | Wanted ratio | Creative requirement / constraint |
|---|---|---|
| `facebook:feed` | **4:5** (1:1 ok) | 1440×1800 rec; min 600×750; image 30MB / video 4GB; video 1s–241min |
| `facebook:right_hand_column` | 1:1 (or 1.91:1) | **desktop only**; min 254×133; single image/video/carousel only; **cannot be used alone for video/collection/canvas** |
| `facebook:marketplace` | 1:1 | ≥1080×1080; headline 40, desc 30 |
| `facebook:video_feeds` | 4:5 / 1:1 | video-first surface |
| `facebook:story` | **9:16** | 1440×2560; **requires `device_platforms: mobile`**; safe zones apply; video 1s–3min |
| `facebook:search` | 1.91:1–1:1 | min 600×600 |
| `facebook:instream_video` | **16:9 or 1:1** | desktop 5–15s; mobile 5s–10min (15s rec); captions strongly recommended |
| `facebook:facebook_reels` | **9:16** | 1440×2560; no max duration; safe zones apply |
| `facebook:facebook_reels_overlay` | 9:16 banner | primary text **60** (or 40), headline **10** — the tightest copy budget on the platform |
| `facebook:profile_feed` | 4:5 / 1:1 | |
| `facebook:notification` | n/a | |
| `instagram:stream` (Feed) | **1:1** (4:5–1.91:1 continuum) | 1440×1800; ±1% tolerance; **API min width 600px** |
| `instagram:story` | **9:16** | 1440×2560; image 5–16s; video 1s–60min; safe zones |
| `instagram:reels` | **9:16** | 1440×2560; 0s–15min; min width 250 (<30s) / 500 (≥30s) |
| `instagram:explore` / `explore_home` | 1:1 / 4:5 | |
| `instagram:profile_feed` / `profile_reels` | 1:1 / 9:16 | |
| `instagram:ig_search` | 1:1 | |
| `audience_network:classic` | 16:9–9:16 | native/banner/interstitial; min 398×208; video 1–120s; **captions NOT supported**; **cannot be used alone** |
| `audience_network:rewarded_video` | 16:9–9:16 | 3–~60s |
| `messenger:messenger_home` (inbox) | 1:1 / 1.91:1 | |
| `messenger:story` | 9:16 | 1080×1080 min per the coarse summary table |
| `messenger:sponsored_messages` | n/a | **cannot combine with ANY other placement, including Facebook** |
| `threads:threads_stream` | 4:5 / 1:1 | **requires Instagram `stream` to also be selected** |

**Advantage+ placements (default):** omit all placement fields → all eligible placements. This is what Meta recommends and what our engine should default to. **Consequence: a single creative must satisfy the union of these ratios.** The practical, correct answer is to supply **per-ratio assets** (4:5 feed + 9:16 vertical + 1:1) via `asset_feed_spec`, or accept Meta's auto-crop. This is the single biggest creative-engineering implication in this document (GAP-5).

---

## 7. Validation & review

### Review process
- **Timing [OFFICIAL: help/204798856225114]:** *"Ads reviews are typically completed within **24 hours**, although in some cases it may take longer."*
- **What's reviewed:** *"specific components of an ad, such as images, video, text, and targeting information, as well as an ad's destination [landing page]."* — **the landing page is in scope.**
- **Before or after publish:** review runs **before** delivery (`effective_status = PENDING_REVIEW` → no spend). But ads *"may be reviewed again… at any time"* and can be rejected post-launch.
- **Re-review trigger:** any edit to **creative, copy, link/destination URL, or targeting** returns the ad to the review queue, restarting the ~24h clock.
- **Outcomes:** approved → delivers; rejected → edit+resubmit, duplicate, or request review.
- **[Confidence note]** the "~24 hours" figure comes from a search-indexed snippet of the official page — Meta's help pages are JS-gated and returned title-only to direct fetch.

### Policy categories (the live Advertising Standards tree)
| Category | Sub-policy | One line |
|---|---|---|
| **Unacceptable Content** | Discriminatory Practices | no discrimination on protected attributes in content or targeting |
| **Fraud, Scams, Deceptive Practices** | Fraud/Scams/Deceptive | content designed to deceive, esp. re: money or personal info |
| | Unacceptable Business Practices | predatory schemes; verification for suspicious activity |
| **Objectionable Content** | Adult Nudity & Sexual Activity | explicit/suggestive content |
| | Adult Sexual Exploitation / Solicitation | non-consensual content, sexual-service solicitation |
| | **Sensational Content** | *"Ads must not contain shocking, sensational or excessively violent content"* — gore even in health contexts, weapons pointed at viewer. **Ads face a stricter bar than organic** |
| | **Privacy Violations & Personal Attributes** | see below — **the #1 copy-rejection cause** |
| **Restricted Goods & Services** | Alcohol, Health/Wellness, Financial/Insurance, Crypto, Gambling, Weapons, Drugs | age/country gating or prior written permission |
| **IP Infringement** | Third-Party IP | copyright/trademark |
| **SIEP** | Social Issue/Electoral/Political | authorization + disclaimers; **banned in the EU since 2025-10-06** |
| **Product/Format-Specific** | Video Ads | *"must avoid disruptive tactics"* (e.g. flashing screens) — the closest **official** analog to a "low-quality/disruptive" ad rule |
| | Lead Ads | bans requesting sensitive info across 13 defined categories without permission |
| **Business Assets** | Account Integrity, Inauthentic Behavior, Cybersecurity, Spam | account/asset-level, not per-ad |
| **Relevance Requirements** | Landing page match | *"Products/services promoted in an ad must match those promoted on the landing page"* |
| **Circumventing Systems** | (under Deceptive Content) | **cloaking, redirect tricks to hide the true destination**, multi-account evasion, near-duplicate violating ads. **Enforced at advertiser/account-trust level with less transparency and longer timelines than a normal rejection** |

> **⚠️ Two items commonly listed as rejection causes are NOT in the ad-standards tree.** **"Engagement bait"** and **"low-quality/disruptive content"** live under Meta's separate **Content Distribution Guidelines / ranking policy** (transparency.meta.com/features/approach-to-ranking/…). Their effect is **reduced distribution**, not `DISAPPROVED`. Third-party compliance blogs conflate them. **Treat as delivery/cost risk, not rejection risk.** **[Confidence: medium-low that they are formal ad-rejection categories.]**

### Personal Attributes — the "you" rule (build the validator on this)
**[OFFICIAL, near-verbatim]:**
> *"Ads must not contain content that asserts or implies personal attributes. This includes direct or indirect assertions or implications about a person's race, ethnicity, religion, beliefs, age, sexual orientation or practices, gender identity, disability, physical or mental health (including medical conditions), vulnerable financial status, voting status, membership in a trade union, criminal record, or name."*

Also bans ads that *"share or ask for personal attributes of a user or user's family"* or *"imply that the advertiser is aware of someone's personal attributes."*

**The mechanism:** it does not matter what your targeting is. What matters is whether the **copy speaks at the viewer in a way that presumes to know something personal**. Second-person + attribute = violation.

| Attribute | Rejected | Compliant rewrite |
|---|---|---|
| Race | "Meet other black singles near you!" | "Meet other singles near you!" |
| Religion | "Are you Christian?" / "Meet other Buddhists" | "Explore our community" |
| Age | "Meet other seniors" / "Are you 18 years old?" / "Ready to upgrade your skin to look younger?" | "Meet new people" / "Skincare that works for you" |
| Sexual orientation | "Are you gay?" / "Meet other lesbians now!" | "Meet other singles now!" |
| Gender identity | "Questioning your gender identity?" | neutral community framing |
| Health | "Do you have diabetes?" / "Depression getting you down?" | "Learn about managing your health" |
| Financial | "Are you bankrupt? Check out our services." | "Explore financial solutions" |
| Voting | "Your ballot hasn't been received yet" | generic voter-info CTA |
| Trade union | "Dislike your Union rep? Join our union today." | generic recruitment copy |
| Criminal record | "Are you a convicted felon?" | reframe without presuming status |
| Name | "Billy Taylor, get this t-shirt with your name in print!" | generic personalization |

**Validator heuristic:** *second-person ("you"/"your") + protected-attribute noun or presumed condition*. **Interrogative form ("Are you…?", "Do you have…?") is the single most common violating pattern Meta itself calls out.**

**Mingla exposure is real.** Our voice is second-person and social ("Meet people near you", "Your city, your night"). "Meet people near you" is **fine** (no attribute). "Meet other single people near you" edges toward relationship-status inference. "Tired of being alone?" is a **presumed emotional/social state** — high risk. This validator is not theoretical for us.

### Landing page policy
- **Match:** *"The products and services promoted in an ad must match those promoted on the landing page."*
- **Functionality:** *"Ads must not direct people to non-functional landing pages that interfere with navigation."* Broken pages, dead links, pages blocking normal navigation.
- **In scope of review:** the destination is explicitly inspected — a landing-page problem alone can cause `DISAPPROVED` even with compliant creative.
- **Cloaking/redirect** to hide the true destination → **Circumventing Systems** (severe, account-level).
- **[UNVERIFIED]** page-load-speed thresholds, pop-up rules, privacy-policy requirements — these appear in agency guides but could **not** be verified as literal text on any official page. Treat as best practice, not policy.

### How the Marketing API surfaces disapproval

**`effective_status` [OFFICIAL + LIVE — both agree, 13 values]:**
`ACTIVE, PAUSED, DELETED, PENDING_REVIEW, DISAPPROVED, PREAPPROVED, PENDING_BILLING_INFO, CAMPAIGN_PAUSED, ARCHIVED, ADSET_PAUSED, IN_PROCESS, WITH_ISSUES`

**[LIVE]** field description, verbatim: *"The actual delivery status, which can differ from `status` because it accounts for parent state, ad review, billing, and budget conditions."*

Review-relevant: `PENDING_REVIEW` (awaiting the ~24h pass), `PREAPPROVED` (passed initial automated check — may still be bumped to full review or `DISAPPROVED`), `DISAPPROVED`, `WITH_ISSUES` (delivering but impaired — introduced specifically to pair with `issues_info`).

**`issues_info` — `list<AdgroupIssuesInfo>` [OFFICIAL]:**
| Field | Type | Description (verbatim) |
|---|---|---|
| `error_code` | int32 | "Error code for the issue" |
| `error_message` | string | "Error message for this ad with issue" |
| `error_summary` | string | "Error summary for this ad with issue" |
| `error_type` | string | `HARD_ERROR` \| `SOFT_ERROR` |
| `level` | string | "could be ad, ad set or campaign" |
| `mid` | string | "Message id, used for developers to report issues" |

Read-only. Campaign-level equivalent is `AdCampaignIssuesInfo` (same shape minus `mid`).

**`ad_review_feedback` — `AdgroupReviewFeedback` [OFFICIAL]:**
| Field | Type | Description |
|---|---|---|
| `global` | `map<string,string>` | "Reasons for review disapproval across all platforms… Each reason has a key and a description" |
| `placement_specific` | `AdgroupPlacementSpecificReviewFeedback` | per-surface reasons |

`AdgroupPlacementSpecificReviewFeedback` = a set of `map<string,string>` fields, one per surface: `account_admin`, `ad`, `facebook`, `instagram`, `commerce`, `marketplace`, `dpa`, `whatsapp`, **plus 35+ more**.

**`recommendations` — `list<AdRecommendation>`** — `code`, `title`, `message`. **This is Meta's optimization-suggestion feed, NOT a disapproval mechanism.** Do not misclassify these as rejection reasons.

**The exact request to read a disapproval reason:**
```
GET https://graph.facebook.com/v25.0/{ad_id}
  ?fields=id,name,effective_status,issues_info,ad_review_feedback,recommendations
  &access_token={token}
```
Account-wide:
```
GET https://graph.facebook.com/v25.0/act_{ad_account_id}/ads
  ?fields=id,name,effective_status,issues_info,ad_review_feedback
  &access_token={token}
```
**Read order:** check `effective_status` first → if `DISAPPROVED`, read `ad_review_feedback.global` for the human-readable reason map → if `WITH_ISSUES`, read `issues_info` for structured `error_code`/`error_summary`/`error_message`.

> **⚠️ [LIVE] `ads_get_field_context` returns `issues_info` and `ad_review_feedback` in `unknown_fields`** — the MCP's catalog cannot resolve them. They are nonetheless **first-class on the real Graph endpoint**, which our System User token calls directly. This is the same class of MCP-vs-Graph gap as the Targeting Search API. **Do not conclude from the MCP that we cannot read rejection reasons — we can, and #862 currently doesn't.**

### Appeal path
- **No Marketing API endpoint for submitting an appeal exists.** Searched specifically; found none. **[Confidence: high that it's UI-only]** — absence is consistent across every reference page reachable.
- **UI path:** **Account Quality** → `business.facebook.com/accountquality` (also via Meta Business Suite). Lists policy decisions across Pages/profiles/ad accounts and surfaces a **"Request review"** button where the decision is appealable.
- **One shot per ad** — if the appeal is denied the ad is dead; duplicate/resubmit a new creative rather than re-appeal **[CONSENSUS]**. "~48 hour" appeal timelines are **[CONSENSUS]**, not official.
- **Programmatic-adjacent workaround:** edit the ad via the Marketing API to force it back to `PENDING_REVIEW` for a fresh automated pass. This *is* API-accessible even though the formal appeal is not.

### Account-level enforcement — `account_status` [OFFICIAL, exact codes verified]
| Code | Constant |
|---|---|
| **1** | `ACTIVE` |
| **2** | `DISABLED` |
| **3** | `UNSETTLED` ← **ours** |
| **7** | `PENDING_RISK_REVIEW` |
| **8** | `PENDING_SETTLEMENT` |
| **9** | `IN_GRACE_PERIOD` |
| **100** | `PENDING_CLOSURE` |
| **101** | `CLOSED` |
| **201** | `ANY_ACTIVE` (filter-only meta-value) |
| **202** | `ANY_CLOSED` (filter-only meta-value) |

Account-level enforcement is driven by **Business Assets** policies and **Circumventing Systems** trust violations — not by any single ad's content. A disabled/closed account cannot deliver regardless of per-ad `effective_status`.

---

## 8. World-class best practices

### Learning phase
- **Definition [OFFICIAL]:** the period after ad set creation/edit where delivery is still exploring; performance less stable, CPA typically higher.
- **~50 optimization events per ad set per rolling 7 days** to exit **[OFFICIAL, high-confidence corroboration — uniformly quoted across sources citing help/112167992830700; the page itself is JS-rendered and not directly fetchable]**.
- **"Learning Limited" [OFFICIAL, confirmed via Graph]:** `ad-campaign-learning-stage-info` exposes `status` ∈ `LEARNING` \| `SUCCESS` \| `FAIL`. `FAIL` = "Learning Limited" in the UI = **unlikely to hit 50 events/7 days** given audience size, budget, or bid. It is a **forward-looking prediction, not a spend trigger**. Also exposes `last_sig_edit_ts`.
- **Reset triggers [OFFICIAL, verbatim]:** *"A significant edit is when you pause your ad set or make a change to optimization event, audience or creative[,] and may restart the learning phase. Changes to bid strategy or budget may also be significant, but it depends on the magnitude of the change."*
- **⚠️ There is NO official % threshold for budget edits.** The "20% rule" is **[CONSENSUS/folklore]**. Meta's significant-edits page states no percentage; its only concrete example: **"$100→$101 is not significant, $100→$1000 likely is."** Meta deliberately declines to commit to a number.
- **[CONSENSUS]** "7-day pause = reset" and "changing placements resets learning" are also folklore.

**Mingla math that matters:** at **$1.00/day** (our account minimum, and the spec's live-fire plan) with a hypothetical $2 CPC and a 10% landing-page-view→reservation rate, we would generate **~0.5 clicks/day = ~3.5/week**. **50 events/7 days is unreachable by ~2 orders of magnitude.** A $1/day campaign is a *plumbing test*, not a performance campaign, and will sit permanently in Learning Limited. This is fine for AC-validation and must be stated explicitly so no one reads its CPA as signal.

### Advantage+ vs manual (2026 state)
- **Advantage+ Sales** (renamed from Advantage+ Shopping/ASC, Feb 2025) **[OFFICIAL naming]**. **[CONSENSUS on details]** old ASC blended everything into one uncontrollable ad set capped at 150 ads; Advantage+ Sales restored unlimited ad sets, audience suggestion/exclusion controls, reverted the ad cap to 50/ad set, and expanded beyond catalog e-commerce to app installs and lead gen. Legacy ASC deprecated for creation/edits Q1 2026.
- **Advantage+ App Campaigns [OFFICIAL]:** automates creative, audience, optimization-type selection; recommends uncapped Lowest Cost; supports up to **50 uploaded creative assets**, auto-combined.
- **⚠️ THE API CLIFF [OFFICIAL — v24.0 2025-10-08 and v25.0 2026-02-18 changelogs]:** ASC/AAC campaigns **cannot be created OR updated via Marketing API**, phasing out across all versions ~90 days after v25.0. Migrated campaigns report `smart_promotion_type = GUIDED_CREATION`. **In Ads Manager the manual flow still exists, but Advantage+ budget/audience/placement toggles are now bundled into every new-campaign flow rather than a separate fork [CONSENSUS].**
- **What this means for us:** our engine builds **manual campaigns with Advantage+ sub-features on** (CBO + A+A + A+ placements). That is both the correct architecture *and* the only API-legal one. We are not missing an "Advantage+ button" — Meta removed it from the API.

### CBO vs ABO
- **Official rename:** "Advantage+ campaign budget (formerly campaign budget optimization)".
- **[OFFICIAL] guidance:** campaign-level budget when ad sets are **comparable / scaling a proven setup**; ad-set budget when **testing distinct audiences/concepts that need isolated learning phases**.
- **"3–5 ad sets per CBO campaign" is [CONSENSUS]/folklore** — no official Meta page states an ad-set-count recommendation.
- **Our OD-3 (CBO daily) is correct** for a single-ad-set MVP, but note that with exactly one ad set CBO and ABO are functionally identical — the CBO choice only starts paying once we run multiple ad sets.

### Audience consolidation
- **[OFFICIAL, verbatim]:** *"[Overlap] is not necessarily a bad thing, but it can lead to poor delivery of your ad sets."*
- **Mechanics [OFFICIAL logic + CONSENSUS quantification]:** when two of *your own* ad sets would enter the same auction, Meta doesn't run both — it favors the one with better performance history and **suppresses the other**, so the suppressed ad set's budget stops reaching new people (reported up to ~25% reach loss in cannibalized cases **[CONSENSUS]**). Where true head-to-head bidding occurs, CPMs get bid up before either converts.
- **No official "bad overlap %" threshold exists.** The <15% / 15–25% / >25% bands are **[CONSENSUS]**.
- **Learning-phase interaction [OFFICIAL logic]:** narrower audience → fewer eligible daily impressions → fewer optimization events → the 50/7 bar takes longer → higher Learning-Limited risk.
- **Modern doctrine [CONSENSUS, strongly converged]:** start broad, differentiate ad sets by **creative angle, not audience slicing**, let the algorithm do targeting discovery. Meta-published case studies cite Advantage+-style campaigns at ~7–22% better cost-per-action/ROAS vs manual **[OFFICIAL-sourced but not independently re-verified]**.

### Creative volume & testing
- **"6 or fewer ads per ad set"** traces to a real official page (help/2720085414702598, "About Managing Ad Volume") **[OFFICIAL]** but its status is **contested/possibly softened** — a Meta-recognized partner reports Meta quietly de-emphasized the hard "6" framing. It explicitly does **NOT** apply to Advantage+ campaigns, where Meta's guidance is to import all eligible creatives (system tests up to **150 combinations**). **Treat "6" as legacy-official guidance for manual ad sets, not a current hard rule.**
- **Creative diversification [OFFICIAL, verbatim]:** *"develop ads that are truly different in look, feel, storyline, and message"* — *"more diverse creative options means more opportunities for our AI to explore."* **No numeric quantity given.**
- **⚠️ "Hook rate", "thumbstop rate", "3-second hook" are [CONSENSUS] terms — NOT official Meta metrics.** They map onto real official fields: `video_p25/p50/p75/p95/p100_watched_actions`, `video_thruplay_watched_actions`. **ThruPlay IS official** — completed plays for videos ≤15s, or ≥15s watched for longer. "Hold rate" (ThruPlays ÷ 3-sec plays) is practitioner-coined.
- **Creative fatigue:** Meta's own page (help/1346816142327858) is **qualitative only** — watch frequency + falling CTR, refresh creative. **No official numeric frequency threshold exists.** **[CONSENSUS]:** prospecting frequency 2.5–3.5 = watch, >4.0 = replace; retargeting tolerates 4–8.

### Pixel + CAPI signal + dedup
- **Why both [OFFICIAL, verbatim]:** *"Data from the Conversions API is less impacted than the Meta Pixel by browser loading errors, connectivity issues and ad blockers. When you use the Conversions API alongside the Pixel, it creates a more reliable connection that helps the delivery system decrease your cost per action."*
- **Deduplication [OFFICIAL, directly fetched]:**
  - Match key: Pixel `eventID` (4th arg of `fbq('track', …)`) **must equal** CAPI `event_id`, **AND** Pixel `event` must equal CAPI `event_name`. **Exact string match on both.**
  - **Dedup window: 48 hours** — verbatim: *"events are only deduplicated if they are received within 48 hours of when we receive the first event with a given event_id."*
  - `event_time` matching is not addressed — no stated sub-window beyond the 48h rule.
  - If `event_id` is present on only one side, **dedup fails and both are counted** **[CONSENSUS, strongly corroborated]**.
  - Fallback (no shared `event_id`): matches on `event_name` + `fbp`/`external_id`, but **official caveat**: *"it only works for deduplicating events sent first from the browser and then through the server"* — not for browser-only or server-only pairs.
  - **Build rule:** generate **one deterministic `event_id` per real-world conversion** (e.g. the Mingla order/reservation ID), fire it on both Pixel and CAPI with matching `event_name`, within the same transaction so both land inside 48h.
- **Customer-info parameters [OFFICIAL]:**
| Key | Field | Hashed? | Normalization |
|---|---|---|---|
| `em` | email | SHA-256 | trim, lowercase |
| `ph` | phone | SHA-256 | strip symbols + country code, no `+` |
| `fn`/`ln` | first/last name | SHA-256 | lowercase, no punctuation |
| `db` | DOB | SHA-256 | `YYYYMMDD` |
| `ge` | gender | SHA-256 | single lowercase initial |
| `ct`/`st`/`zp`/`country` | location | SHA-256 | lowercase, normalized codes |
| `external_id` | advertiser user id | recommended hashed | — |
| `fbc` | click id | **NOT hashed** | see format |
| `fbp` | browser id | **NOT hashed** | see format |
| `client_ip_address` | raw IP | **NOT hashed** | server-only signal |
| `client_user_agent` | raw UA | **NOT hashed** | server-only signal |
  `madid` hashing status is not explicit **[UNVERIFIED]**. Highest-value: `em`/`ph` most impactful; `fbp`/`fbc` critical for tying server events to browser sessions; `client_ip_address`/`client_user_agent` meaningfully lift EMQ. (Per-field "point values" like "+4 for em" are **[CONSENSUS]**.)
- **EMQ [OFFICIAL]:** scale **0–10**, bands **Poor / OK / Good / Great**. Measures how effective the sent customer info is at matching events to a Meta account. Shown in Events Manager → Data Sources, real-time, **web events only**. Meta recommends targeting Good/Great.
- **`fbc` / `fbp` format [OFFICIAL]:**
  - `fbc = version.subdomainIndex.creationTime.fbclid` → `fb.1.1554763741205.IwAR2F4-dbP0l7...`
    - `version` = literal `"fb"`; `subdomainIndex` = domain level (`com`=0, `example.com`=**1** ← most common, `www.example.com`=2); `creationTime` = Unix **ms** when `_fbc` was saved. If no cookie exists yet, use the timestamp when the `fbclid` was **first observed**.
  - `fbp = version.subdomainIndex.creationTime.randomNumber` → `fb.1.1596403881668.1116446470`
  - Both sent **unhashed** on both Pixel and CAPI.
  - **This is the exact hook our A1 OneLink `af_sub*` fbclid pass-through must reconstruct**, and #865 depends on it.
- **⚠️ AEM — the 8-event limit is GONE [OFFICIAL, verbatim]:** *"You no longer need to prioritize 8 conversion events per domain for web conversion optimization."* Removed **2023-05-15**, along with the manual 1–8 priority ranking and the Events Manager AEM tab. **Domain verification is now explicitly optional for AEM** (*"no longer mandatory for event configuration"*), though still useful for other Business Manager reasons. **Do not build event-priority-ranking logic — it is dead weight.**

### Attribution windows
- **Current model [OFFICIAL]:** Standard vs Incremental. Under Standard: **Click-through** (1-day or 7-day), **View-through** (1-day only), **Engage-through** (1-day; replaced "engaged-view").
- **Default for new ad sets:** 7-day click + 1-day engage-through + 1-day view-through **[CONSENSUS, cross-checked against the official page structure; the MCP tool schema independently states "7-day click-through + 1-day view-through"]**.
- **28-day click:** deprecated as a selectable optimization window since **2021-04**; reporting-only via "Compare Attribution Settings".
- **Insights API deprecated `7d_view`/`28d_view`** as queryable `action_attribution_windows` from **2026-01-12** **[OFFICIAL]** — **#865 must not request them.**
- **Why 1-day-click for certain events [CONSENSUS, NOT Meta-stated]:** tighter causal attribution — avoids crediting Meta for conversions from clicks days earlier that actually converted via organic/email/direct. Common for fast-purchase-cycle DR/app-install flows; 7-day windows tend to inflate apparent ROAS. **For Mingla's reservation flow (an impulse-ish, same-session decision), 1-day-click is the defensible measurement window and 7-day-click is the defensible optimization window.**
- **iOS 14.5+/ATT [OFFICIAL]:** iOS app-install campaigns use **SKAdNetwork**, not AEM. *"SKAdNetwork will not report real-time data to Meta, and has delays of at least 24 hours"*; results are *"aggregated at the campaign level"* with modeling below that. **AEM handles web conversion events** (not installs) from iOS 14.5+ users including opted-out ones, near-real-time. **Modeled conversions** fill privacy gaps via behaviorally-similar cohort inference.

### Retargeting funnel
- **⚠️ TOF/MOF/BOF is NOT Meta's terminology.** No official Meta material uses it — it is generic marketing convention applied to Meta by agencies. **All funnel-stage mappings below are [CONSENSUS], not Meta doctrine.**
- Standard structure: **TOF** broad prospecting (no/loose audience, A+A on, creative-led) → **MOF** engagement audiences (video viewers 25%+, IG/Page engagers, 365–730d retention) → **BOF** website custom audiences (viewed page / added to cart, 7–30d retention) minus converters.
- Exclusions are what make it work: exclude purchasers from TOF/MOF; exclude BOF from TOF.
- **For Mingla:** BOF = "viewed an event page in the last 14 days, did not reserve". This requires **a firing pixel with a URL-rule or standard-event stream** — which we do not have (§9).

### Budget pacing
- **[OFFICIAL, verbatim]:** *"we may spend up to 75% over your daily budget… up to **175%** of your daily budget… charges will average out over a calendar week (Sunday to Saturday)… you won't spend more than **7 times** your daily budget."* **The folklore "2x" number is wrong — it is 175%.**
- Standard delivery = even spread (default/recommended). Accelerated = as fast as possible, generally only exposed with manual bidding **[CONSENSUS — official page body not fetchable]**.
- **The "20% budget-change rule" is not Meta's rule** — see the learning-phase section.

### Benchmarks
**Meta does NOT publish a blanket official CTR/CPM/CVR benchmark page.** The only genuine official data point is the quarterly "average price per ad" YoY disclosure.

| Metric | Value | Scope | Source | Label |
|---|---|---|---|---|
| Avg. ad price | **+12% YoY (Q1 2026)** | platform-wide | Meta Q1 2026 earnings | **OFFICIAL** |
| CTR (Traffic) | 1.71% | all | WordStream 2025 | CONSENSUS |
| CTR (Leads) | 2.59% | all | WordStream 2025 | CONSENSUS |
| CTR / CPC (Travel, Traffic) | 2.76% / $0.51 | Travel | WordStream/LocaliQ 2025 | CONSENSUS |
| CTR / CPC / CVR / CPL (Arts & Entertainment, Leads) | 3.92% / $1.08 / 9.34% / $18.17 | Arts & Ent. | WordStream/LocaliQ 2025 | CONSENSUS |
| CTR / CPC / CVR / CPL (Restaurants & Food, Leads) | 2.97% / $0.74 / 18.25% / $3.16 | Restaurants | WordStream/LocaliQ 2025 | CONSENSUS |
| CPC (Traffic) | $0.70 | all | WordStream 2025 | CONSENSUS |
| CVR (Leads) | 7.72% | all | WordStream 2025 | CONSENSUS |
| CPL | $27.66 (+20.9% YoY) | all | WordStream 2025 | CONSENSUS |
| CPM (median) | $7.26 | cross-industry, N=2,800+ | Databox (Jul 2026) | CONSENSUS |
| CPM (Instagram) | ~$9–10 | Instagram | Socialinsider 2026 | CONSENSUS |

**Mingla's closest published proxies** are **Arts & Entertainment** and **Travel**: **CTR 2.1–2.8%, CPC $0.49–$0.51 on Traffic**; ~9.3% CVR / ~$18 CPL on Leads is a defensible alert baseline. **No solid 2025–2026 app-install-CVR benchmark was found — a genuine data gap, not filled with a guess.**

---

## 9. OUR-ENGINE capability map

### Live account state — [LIVE] read-only probe, 2026-07-14

| Probe | Result | Verdict |
|---|---|---|
| `ads_get_ad_account_pages(2393570861066813)` | **`{"pages":[]}`** | 🔴 **ZERO Pages promoted under the ad account** |
| `ads_get_datasets(ad_account_id=2393570861066813)` | 2 rows, **both `dataset_id 1949011972638955` "Mingla Web"**, `is_active: true`, `business_id 830733900115504`, `data_use_setting: advertising_and_analytics`, `first_party_cookie_status: first_party_cookie_enabled` | ⚠️ duplicate-looking rows (creation_time differs by 1s) |
| `ads_get_dataset_details(1949011972638955)` | `last_fired_time: 1969-12-31T16:00:00-0800`, `server_last_fired_time: 1969-12-31T16:00:00-0800`, `openbridge.gateway_status: NOT_ONBOARDED`, `gateway_status_detail: NO_UPSELL` | 🔴 **epoch-0 = NEVER FIRED, browser AND server. CAPI Gateway not onboarded** |
| `ads_get_ad_account_custom_audiences(2393570861066813)` | **`{"audiences":[]}`** | 🔴 zero audiences — no retargeting, no lookalike seed |
| `ads_get_ad_images(2393570861066813)` | **`{"ad_images":[]}`** | ✅ expected — #866 says platform libraries are destinations we populate |
| `ads_get_ad_videos(2393570861066813)` | **`{"ad_videos":[]}`** | ✅ expected |
| `ads_get_creatives(2393570861066813)` | **`{"ad_creatives":[]}`** | ✅ expected |
| `ads_get_ig_accounts(2393570861066813)` | **error:** *"This tool is new and is being gradually rolled out across ad accounts. Please check back at a later date."* | ⚠️ IG identity unresolvable via MCP |
| `ads_get_field_context` — `objective` | 22 legacy values | ⚠️ read-catalog ≠ create-contract |
| `ads_get_field_context` — `optimization_goal` | 19 values | ⚠️ create-schema has 26 |
| `ads_get_field_context` — `bid_strategy` | `enum_values: null` | ⚠️ unusable for validation |
| `ads_get_field_context` — unresolved | **`billing_event`, `special_ad_categories`, `attribution_spec`, `destination_type`, `promoted_object`, `targeting`, `issues_info`, `ad_review_feedback`, `configured_status`, `call_to_action_type`, `publisher_platforms`, `facebook_positions`, `instagram_positions`, `device_platforms`** all in `unknown_fields` | ⚠️ **the MCP catalog cannot describe most of the write surface — do not use it as a schema source** |
| `ads_get_help_article` (inventory filter) | full article bodies returned | ✅ **the MCP help tool bypasses the JS-gating that blocks direct WebFetch of help.** Useful. |

> **The three red rows are the story.** Our account can *construct* ads today (#866's premise that platform libraries start empty is correct and healthy), but it **cannot deliver them** (no Page assigned, no billing) and **cannot optimize or measure them** (pixel never fired, no audiences).

### What our adapter can set today (per #862 §4.4b + A3 `ChannelAdapter`)

`ChannelAdapter` (A3 §B): `connect` · `createCampaign` · `createAdSet` · `createAd` · `setStatus` · `getStatus`. `AdNotConnectedError` → 424; `AdApiError` normalized `{platform, code, message, trace_id}`; tokens never echoed.

| Level | Field | Our engine | Notes |
|---|---|---|---|
| **Campaign** | `name` | ✅ | |
| | `objective` | ✅ | CHECK-constrained to the ODAX 6 — **correct** |
| | `buying_type` | ✅ | hardcoded `AUCTION`; `RESERVED` not exposed |
| | `special_ad_categories` | ⚠️ | accepted in the body, **defaults `[]`, no validation, no `CREDIT`→`FINANCIAL_PRODUCTS_SERVICES` awareness** |
| | CBO `daily_budget`/`lifetime_budget` | ✅ | cents; OD-3 = CBO daily |
| | `campaign_bid_strategy` | ⚠️ | body accepts `bid_strategy?`; only `LOWEST_COST_WITHOUT_CAP` contemplated; **no `bid_amount`/`bid_constraints` path** → COST_CAP/BID_CAP/MIN_ROAS unreachable |
| | `campaign_spend_cap` | ❌ | |
| | `campaign_start_time`/`stop_time` | ❌ | not in the create body |
| | `status` | ✅ | created PAUSED; top-down launch — **correct** |
| **Ad set** | `billing_event` | ✅ | default `IMPRESSIONS` |
| | `optimization_goal` | ✅ | default `LANDING_PAGE_VIEWS` (OD-4) |
| | **objective→goal compat validation** | ❌ | **relies on Meta's silent server-side auto-correct** |
| | `targeting.geo_locations.countries` | ✅ | |
| | `targeting.geo_locations` regions/cities/zips/radius/custom_locations/location_types | ❌ | **countries only** — no city or radius targeting for a *venue* business |
| | `age_min`/`age_max` | ✅ | |
| | `genders` | ✅ | |
| | `locales` | ❌ | |
| | `flexible_spec` interests/behaviors | ❌ | deferred to #864; **schema field exists** |
| | `exclusions` | ❌ | |
| | `custom_audiences` / `excluded_custom_audiences` | ❌ | **not in the create body at all** |
| | `targeting_automation.advantage_audience` | ⚠️ | hardcoded `0` in §4.4b step 2 — a deliberate but undocumented, un-toggleable choice |
| | **placements** (`publisher_platforms` etc.) | ❌ | **not passed → Advantage+ placements by default.** Accidentally correct default, but not a decision we made |
| | `attribution_spec` | ❌ | |
| | `frequency_control_specs` | ❌ | |
| | `brand_safety_content_filter_levels` | ❌ | defaults to **expanded** |
| | `adset_schedule` / dayparting | ❌ | |
| | `pacing_type` | ❌ | |
| | `start_time`/`end_time` | ⚠️ | `end_time` only, only when `lifetime` |
| | `promoted_object` (pixel) | ⚠️ | `promoted_object?` appears in §4.4b step 2 but **is not in the documented request body** and no pixel is wired |
| | `dsa_beneficiary`/`dsa_payor` | ⚠️ | noted as auto-filled; **EU geo would need them** |
| | ABO `daily_budget` | ➖ | correctly omitted under CBO |
| **Ad** | `ad_name` | ✅ | |
| | `creative: {creative_id}` | ✅ | |
| | `status` | ✅ | PAUSED |
| | `tracking_specs` | ❌ | |
| | `conversion_domain` | ❌ | AEM-relevant |
| | `ad_schedule_*` | ❌ | |
| **Creative** | `page_id` | ✅ | from `connection.meta_page_id` — **but see GAP-1** |
| | `link_url` | ✅ | = `dest_smart_link` (A1 OneLink) |
| | `message` (primary text) | ✅ | |
| | `headline` (`name`) | ✅ | |
| | `description` | ✅ | |
| | `image_hash` \| `image_url` | ✅ | OD-6: `image_url` MVP → `image_hash` via #866 |
| | `call_to_action_type` | ✅ | default `LEARN_MORE`; `GET_TICKETS`→`BUY_TICKETS` mapping is correct |
| | `instagram_user_id` | ❌ | **OD-8 = ship Facebook-only** |
| | `video_id` + thumbnail | ⚠️ | **#866 `uploadToMeta` produces it; #862's creative build is image-only** |
| | **carousel** `child_attachments` | ❌ | |
| | **collection** `template_data` / Instant Experience | ❌ | |
| | `product_set_id` (Advantage+ catalog) | ❌ | no catalog |
| | `self_ai_disclosure` | ❌ | **and our creative pipeline is AI-generative** |
| | `url_tags` | ❌ | |
| | `name` (creative library name) | ❌ | "strongly recommended" per the schema |
| **Status** | `status` | ✅ | persisted |
| | `effective_status` | ✅ | persisted + read back — **good**, and the UI badge correctly reads it |
| | `issues_info` | ❌ | **rejection reason invisible** |
| | `ad_review_feedback` | ❌ | **rejection reason invisible** |
| | learning-stage info | ❌ | |

### Asset upload (#866)
- **Image:** `POST /act_{id}/adimages` (bytes or URL) → `{hash}`. **Account-scoped** — hence the correct cache key `(creative_id, platform, lane, external_account_id)`.
- **Video:** `POST /act_{id}/advideos` (`file_url` = the Bunny URL) → `{id}`. **ASYNC** — must poll `GET /{video_id}?fields=status` until `status.video_status === 'ready'`. #866 §4.3 documents this correctly.
- **Thumbnail:** upload `poster_url` → a second `image_hash`, stored in `external_ref_extra`. OD-4 requires an explicit `poster_url` (DB CHECK) — correct, since Meta *can* auto-generate from frame 1 but that is non-deterministic.
- **Idempotency:** `resolveCreativeRef` returns a cached `ready` ref without re-uploading; `UNIQUE (creative_id, platform, lane, external_account_id)` is the concurrency lock. **This is well-designed** and RT-1 protects it.

### API-supported vs UI-only
| Capability | API? |
|---|---|
| Campaign/ad set/ad/creative CRUD, status, insights | ✅ |
| Custom audiences, lookalikes (CUSTOM/WEBSITE/ENGAGEMENT/MOBILE_APP/LOOKALIKE) | ✅ |
| Targeting search (interests/behaviors/geo/locale) | ✅ `GET /search` |
| Ad preview | ✅ `GET /{ad_id}/previews?ad_format=…` (MCP: `ads_get_ad_preview`) |
| `issues_info` / `ad_review_feedback` | ✅ read-only |
| Learning stage | ✅ read-only |
| Minimum budgets | ✅ `GET /act_{id}/minimum_budgets` |
| **Advantage+ Shopping / App campaign create or update** | ❌ **removed v24/v25** |
| CA subtypes `IG_BUSINESS`, `FB_EVENT`, `EXPERIMENTAL`, `MULTI_DATA` | ❌ Ads-Manager-only |
| **Appeal a rejection** | ❌ **UI-only (Account Quality)** |
| Adding a payment method | ❌ UI-only |
| Assigning a Page to an ad account | ❌ Business Settings UI |
| Inventory filter at ad-account level | UI (Brand Safety Center); ad-set level via `brand_safety_content_filter_levels`; **may be rep-gated** |

### What our system-user token + account can do
- **[LIVE per #862 A2]** `META_SYSTEM_USER_TOKEN` verified: `GET /me/adaccounts` returns Use Mingla ACTIVE + the pixel. `META_CAPI_ACCESS_TOKEN` verified.
- **Scopes needed (SC-SEC-3):** `ads_management`, `ads_read`, `business_management`, `pages_show_list`, `pages_read_engagement`, `pages_manage_ads`. Least-privilege — no `pages_manage_posts`.
- **App Review:** not required — a dev-mode system-user token manages the app owner's own ad accounts. Advanced Access is the path to remove per-app rate limits, not a functional gate for own-account use.
- **`META_API_VERSION = v21.0`** — **stale.** v25.0 shipped 2026-02-18. See GAP-9.
- **Cannot do:** add billing, assign the Page, appeal a rejection, create ASC/AAC.

---

## 10. GAPS & engineering implications

Ranked. Each: what's wrong, evidence, what we build.

---

### 🔴 GAP-1 — **HIGH** — The Page is not promoted under the ad account. Every ad create will fail.
**Evidence [LIVE]:** `ads_get_ad_account_pages(2393570861066813)` → `{"pages":[]}`.
**Why it's fatal:** `page_id` is **always required** inside `object_story_spec`; omission → *"Facebook Page is Missing"* **[SCHEMA, verbatim]**. #862 §4.0 cites `ads_get_pages_for_business(830733900115504)` returning Page `797406353459597` — that proves the Page exists **under the business**, which is a *different assertion* from the Page being **promoted under the ad account**. The ad-account-scoped probe returns empty. #866 §4.0 independently observed the same `{"pages":[]}` and read it as benign ("every platform asset library is empty") — **that reading is wrong for Pages.** An empty *image* library is expected; an empty *Page* list is a blocker.
**Also blocks:** `leadgen_tos_accepted` cannot be checked → any future `OUTCOME_LEADS` work is gated.
**Build:**
1. **Provisioning (Seth, Business Settings → Ad account → Pages, or assign the System User to the Page):** assign Page `797406353459597` to ad account `2393570861066813`. This is **UI-only**. Add to #862 §7 as a **hard blocker alongside billing**.
2. **Code:** `admin-ad-connect` must call `GET /act_{id}/promote_pages` (or `ads_get_ad_account_pages`-equivalent) and **fail the connect with a distinct `424 meta_page_not_assigned`** if the configured `META_PAGE_ID` is absent from the result. Do not let connect report `connected=true` on a Page-less account — that is a false green that hands the failure to create-time.
3. **AC:** extend AC-1 — connect against an account with no promoted Page → 424 `meta_page_not_assigned`, `connected=false`.

---

### 🔴 GAP-2 — **HIGH** — The pixel has NEVER fired. `LANDING_PAGE_VIEWS` has no signal; retargeting/lookalikes are impossible.
**Evidence [LIVE]:** `ads_get_dataset_details(1949011972638955)` → `last_fired_time: 1969-12-31T16:00:00-0800` and `server_last_fired_time: 1969-12-31T16:00:00-0800`. **Both are Unix epoch 0 = never.** `openbridge.gateway_status: NOT_ONBOARDED`. And `ads_get_ad_account_custom_audiences` → `{"audiences":[]}`.
**Why it matters:**
- **OD-4 recommends `LANDING_PAGE_VIEWS`.** LPV is measured *by the pixel*. With a dead pixel, Meta cannot verify a landing-page view, so the goal degrades — and `promoted_object.pixel_id` isn't even being sent (§9). We would be paying for an optimization goal we cannot feed. **`LINK_CLICKS` is the only honest goal until the pixel fires.**
- No WCA → **no retargeting funnel at all** (§8 BOF is unbuildable).
- No seed audience ≥100 → **no lookalikes** (min seed 100 **[OFFICIAL]**).
- **This is #865's foundation and it is not in the ground.**
**Build:**
1. **Verify the pixel is actually installed** on `mingla-business` public pages (`/e/`, `/t/`, `/b/`, `/checkout/`). Epoch-0 on *both* browser and server strongly suggests it was created (2026-07-14 — **today**) and never wired. Given the dataset was created today, this may simply be "not yet done" rather than "broken" — but it must be confirmed before any `LANDING_PAGE_VIEWS`/`OFFSITE_CONVERSIONS` spend.
2. **Gate the optimizer:** `admin-ad-create-campaign` should **reject `LANDING_PAGE_VIEWS`/`OFFSITE_CONVERSIONS`/`VALUE` with `422 pixel_no_signal`** when `GET /{dataset_id}?fields=last_fired_time` returns epoch-0 / null, and steer to `LINK_CLICKS`. Fail-close, consistent with the spec's posture.
3. **Send `promoted_object: {pixel_id}`** on the ad set for any LPV/conversion goal — currently absent from the request body.
4. **Resolve the duplicate dataset rows** (two entries, same ID, creation_time 1s apart) — confirm one canonical dataset before wiring CAPI.
5. **[#865]** wire Pixel + CAPI with `event_id` dedup (deterministic reservation ID), the 48h window, `fbc`/`fbp` per the exact format, and target EMQ Good/Great.

---

### 🔴 GAP-3 — **HIGH** — Account UNSETTLED, no payment method → every launch parks at `PENDING_BILLING_INFO`.
**Evidence:** #862 §4.0 live probe — `account_status: UNSETTLED`, `has_payment_method: false`, `is_queryable: false`. `UNSETTLED` = code **3** **[OFFICIAL]**.
**Status:** already correctly identified as a §7 blocker; SC-4 already surfaces the amber warning; `effective_status = PENDING_BILLING_INFO` is already in the persisted enum. **Well handled — keep.**
**Build:** nothing new beyond making sure `is_queryable: false` is understood — it means `ads_get_ad_entities` (and thus MCP-side reporting) won't work on this account until billing settles. Our production path uses Graph directly and is unaffected, but tester expectations should be set.

---

### 🟠 GAP-4 — **HIGH** — Rejection reasons are invisible. We persist `effective_status` and stop.
**Evidence:** #862 §4.4d syncs `status, effective_status` only. `issues_info` and `ad_review_feedback` are **[OFFICIAL]** first-class read fields. **[LIVE]** the MCP's `ads_get_field_context` cannot resolve them (`unknown_fields`) — which is exactly the trap that makes it easy to conclude they don't exist. **They do.**
**Consequence:** an admin sees a red "Disapproved" badge and has **zero** information about why, and the appeal path is UI-only — so the badge is a dead end. This makes the whole review loop unusable in practice.
**Build:**
1. `admin-ad-report` reads:
   `GET /{ad_id}?fields=id,name,effective_status,issues_info,ad_review_feedback,recommendations`
2. Persist to `ads.review_status` (exists in A3) **plus a new `review_detail jsonb`** capturing `{issues_info[], ad_review_feedback.global, ad_review_feedback.placement_specific}`. **Never store `recommendations` in the same field** — they are optimization tips, not rejection reasons, and conflating them will mislead.
3. Read order: `effective_status` → if `DISAPPROVED` read `ad_review_feedback.global`; if `WITH_ISSUES` read `issues_info` (`error_type` ∈ `HARD_ERROR`/`SOFT_ERROR` drives severity).
4. UI: expand SC-6/SC-7 to render the reason map + a deep link to `business.facebook.com/accountquality` (the only appeal path).

---

### 🟠 GAP-5 — **HIGH** — One image, one aspect ratio, Advantage+ placements ON. The creative cannot satisfy the placements it will be served into.
**Evidence:** #862 takes **one image per ad** (§2 non-goals, OD-6). No placement fields are passed → **Advantage+ placements (all eligible)** by default (§1, **[OFFICIAL]**). But the placement union demands **4:5** (FB Feed), **1:1** (IG Feed, Right Column, Marketplace), **9:16** (Stories/Reels), **1.91:1–1:1** (Search/In-Stream) — see §6.
**Consequence:** a single 1:1 image gets auto-cropped into 9:16 Stories/Reels with **14% top / 35% bottom** of the frame under UI chrome. Our safe-zone-unaware creative will have its CTA/logo/text occluded on the platform's highest-volume surfaces. This is the difference between "the API call succeeded" and "the ad works".
**Build:**
1. **#866 `ad_creatives` already stores `width`, `height`, `aspect_ratio`, `duration_seconds`, `mime_type`.** Use them. Add a **`placement_ratio` derived tag** (`4:5` | `1:1` | `9:16` | `1.91:1`) with the official tolerances (**±3%** Feed/Search/In-Stream, **±1%** IG Feed/Stories/Reels).
2. **Creative validation rules — exact numbers to enforce** (see the consolidated table at the end).
3. **Aspect-crop / transcode service:** from one master, derive 4:5 + 1:1 + 9:16. Enforce the unified **14% top / 35% bottom / 6% sides** safe zone on the 9:16 derivative (at 1080×1920: **269 / 672 / 65 px**; usable band **950×979**).
4. **Medium-term:** adopt `asset_feed_spec` to supply per-placement assets rather than relying on Meta's auto-crop.
5. **Do NOT build text-density (20%) validation.** Dead rule (§5). Build **safe-zone** validation instead.

---

### 🟠 GAP-6 — **MED-HIGH** — Facebook-only. IG is half the inventory and we're shipping without it.
**Evidence:** OD-8 = ship Facebook-only, omitting `instagram_user_id`, justified by `ads_get_ig_accounts` not being rolled out. **[LIVE]** confirmed again this session — the tool still errors with the rollout message.
**Consequence:** **[SCHEMA, verbatim]** *"Omit and the creative will not deliver on Instagram surfaces."* We voluntarily forfeit IG Feed/Stories/Reels/Explore. For a visual, venue/experience product aimed at a young urban audience, **Instagram is arguably the primary surface, not the optional one.** And the justification is an MCP tooling gap, not a Graph limitation.
**Build:**
1. Resolve the IG business account **via Graph, not MCP**: `GET /act_{id}/instagram_accounts` or `GET /{page_id}?fields=instagram_business_account`. Also visible in Business Settings.
2. Add `META_IG_USER_ID` to the connection `extra` (the A3 schema already has `extra jsonb` for exactly this) and pass `instagram_user_id` on the creative.
3. **Reverse OD-8** to "ship with IG when the IG business account resolves; Facebook-only is the fallback, not the target."
4. Note the dependency: IG delivery makes GAP-5 (9:16 + safe zones) *more* urgent, not less.

---

### 🟠 GAP-7 — **MED-HIGH** — No creative validation at all. We'd discover format failures from Meta's error messages.
**Evidence:** #866 stores dimensions but **enforces nothing**. #862 accepts `image_url` with no checks. #866 SC-2 validates only "JPG/PNG ≤30 MB client-side".
**Build — the exact rule set** (numbers from §5; each rule tagged with its enforcement level):

| # | Field | Rule | Level |
|---|---|---|---|
| CV-1 | image mime | `image/jpeg` \| `image/png` | **reject** |
| CV-2 | image bytes | ≤ **30 MB** | **reject** (official, all placements) |
| CV-3 | image min width | ≥ **600 px** (the API floor; the 500px UI figure is the looser of two conflicting officials) | **reject** |
| CV-4 | image min dims (FB Feed) | ≥ **600×750** | **reject** |
| CV-5 | image recommended | **1440×1800** (4:5 feed) / **1440×2560** (9:16 vertical) | **warn** |
| CV-6 | aspect ratio | ∈ {4:5, 1:1, 1.91:1, 9:16} within **±3%** (Feed/Search/In-Stream) or **±1%** (IG Feed/Stories/Reels) | **reject** off-list; **warn** near-tolerance |
| CV-7 | video container | MP4 or MOV | **reject** |
| CV-8 | video codec | H.264, square pixels, fixed frame rate, progressive scan | **warn** (can't always detect) |
| CV-9 | video audio | stereo AAC ≥ **128 kbps**, **44,100 Hz** | **warn** |
| CV-10 | video fps | ≤ **30** | **warn** |
| CV-11 | video bytes | ≤ **4 GB** | **reject** |
| CV-12 | video duration | per-placement table (§5). If Advantage+ placements → enforce the **intersection**: **min 5s** (FB In-Stream floor), **max 180s** (FB Stories 3-min ceiling) | **reject** |
| CV-13 | video bitrate | **NO RULE** — no official number exists. **Do not invent one** | — |
| CV-14 | video thumbnail | `poster_url` required (#866 OD-4 CHECK) | **reject** |
| CV-15 | 9:16 safe zone | keep text/logo/CTA inside **14% top / 35% bottom / 6% sides** (1080×1920 → 269/672/65 px; band 950×979) | **warn** (can't reliably auto-detect text position) |
| CV-16 | text density (20%) | **NO RULE — DO NOT BUILD** | — |
| CV-17 | primary text | ≤ **1024** chars | **reject** (official API max) |
| CV-18 | headline / description | ≤ **255** chars | **reject** (official API max) |
| CV-19 | primary text truncation | > **125** chars → "may truncate on mobile feed"; > **60** → "may truncate on FB Reels overlay" | **warn** |
| CV-20 | headline truncation | > **27** (FB Feed) / > **40** (IG) / > **10** (FB Reels overlay) | **warn** |
| CV-21 | carousel cards | **2–10** | **reject** |
| CV-22 | collection | Instant Experience **mandatory**; product set ≥ **4** unique items | **reject** |
| CV-23 | `link_url` | must be `https://` | **reject** (auto-prepend, then re-validate) |
| CV-24 | CTA | ∈ the official enum (§4); map `GET_TICKETS`→`BUY_TICKETS` | **reject** unknown |

---

### 🟡 GAP-8 — **MED** — The A1 OneLink `link_url` is an unassessed policy risk (Circumventing Systems / landing-page mismatch).
**Evidence:** A1 makes the creative `link_url` an **AppsFlyer OneLink** on `go.usemingla.com` that **redirects** to either the app or the web page. Meta policy: **[OFFICIAL]** ads must not use *"redirect tricks to hide the true destination"* (**Circumventing Systems** — enforced at **account-trust level**, with *less transparency and longer timelines* than a normal rejection), and the landing page must **match** the ad and be **functional**. The review system **explicitly inspects the destination**.
**Assessment — nuanced, not alarmist.** OneLink is a standard, industry-normal deferred-deep-link product; using it is not inherently cloaking. The risk is specific and manageable:
- Meta's crawler must land on **content that matches the ad**. If the OneLink resolves the crawler to an app-store interstitial or a blank JS shell rather than the event page, that is a **landing-page mismatch/functionality** finding.
- If the OneLink's behavior **differs for Meta's reviewer vs real users**, that is **cloaking** — the severe, account-level bucket.
**Build:**
1. **Verify what Meta's crawler sees.** Fetch `dest_smart_link` with Meta's crawler UA (`facebookexternalhit/1.1`) and confirm it resolves to the real event page HTML, not an interstitial. **Do this before any live-fire.**
2. Ensure `go.usemingla.com` web fallback is a **server 307 to the real page** — this matches the already-established house pattern from ORCH-1329 (*"email download = server 307, NOT client JS"*). A **client-JS** redirect is exactly what looks like cloaking to a crawler.
3. Set `conversion_domain` on the ad to the true destination domain (AEM requirement).
4. **[UNVERIFIED]** — I found no official Meta text either permitting or prohibiting attribution-link redirectors specifically. This is a **judgement call flagged for a human**, not a documented rule. Escalate before spending.

---

### 🟡 GAP-9 — **MED** — `META_API_VERSION = v21.0` is stale; two 2026 deprecations already bite.
**Evidence:** A2 pins `META_API_VERSION=v21.0`. **[OFFICIAL]** v25.0 shipped **2026-02-18**.
**What already bit:**
- **Insights API deprecated `7d_view`/`28d_view`** as queryable `action_attribution_windows` from **2026-01-12** → **#865 must not request them.**
- **ASC/AAC create+update removed** (v24/v25) → confirms our manual-campaign architecture is the only legal one.
- Graph versions have ~2-year support windows; v21.0 (late 2024) is heading toward sunset.
**Build:** move to **v25.0** (or the newest stable at implementation), re-verify the create contracts against it, and add a **quarterly version-review checkpoint**. Pin the version in one place (`META_API_VERSION`) — already correct — and add a CI note when it ages past 4 releases.

---

### 🟡 GAP-10 — **MED** — Targeting is countries-only. A venue business cannot target a city.
**Evidence:** #862 create body: `targeting:{ countries:[…], age_min?, age_max?, genders?:[1,2] }`. §4.0 defers interests because "the Targeting-Search API is not exposed in this MCP".
**Two problems:**
1. **The deferral reasoning is wrong for production** — the MCP lacks `/search`, but the **Graph API has it and our token can call it** (§3). Interest targeting is buildable now.
2. **Far more urgent than interests: `cities` + `radius`.** Mingla is live in **London + US cities + Lagos**. A campaign for a Lagos venue that targets `countries: ["NG"]` is spraying an entire nation to fill one room. **`geo_locations.cities` with a radius (10–50 mi / 17–80 km) is the single highest-leverage targeting field we're missing** and it's a trivial add.
**Build:**
1. Extend `targeting` to `{ countries[], cities[{key,radius,distance_unit}], regions[], zips[], location_types[], age_min, age_max, genders[], locales[], flexible_spec[], exclusions{}, custom_audiences[], excluded_custom_audiences[] }`.
2. Add a `admin-ad-targeting-search` edge fn proxying `GET /search` (`adinterest`, `adinterestvalid`, `adTargetingCategory`, `adgeolocation`, `adlocale`) — admin-gated, token stays server-side. This is the **audience-builder UI's** data source (#864).
3. **Resolve city keys from our own venue data:** `place_pool` has `lat`/`lng` → drive `adgeolocation` lookup or use `custom_locations` pin-drop (radius **0.63–50 mi**) centered on the venue. **This is the natural Mingla move — we know exactly where the venue is.**
4. Validate: `flexible_spec` requires `geo_locations` (or custom audiences) also present **[OFFICIAL]**.

---

### 🟡 GAP-11 — **MED** — No ad preview. We ship blind.
**Evidence:** not in #862/#864/#866. **[SCHEMA]** `ads_get_ad_preview(ad_format, ad_id|creative_id)` exists; Graph: `GET /{ad_id}/previews?ad_format=…`.
**Formats [SCHEMA]:** `DESKTOP_FEED_STANDARD`, `MOBILE_FEED_STANDARD`, `INSTAGRAM_STANDARD`, `INSTAGRAM_STORY`, `INSTAGRAM_REELS`, `RIGHT_COLUMN_STANDARD`, `MESSENGER_MOBILE_INBOX_MEDIA`, `THREADS_STREAM`. Returns `preview_html` (iframe), `preview_url`, the creative image, and creative details.
**Why it matters:** this is the **cheapest possible mitigation for GAP-5** — it renders the actual crop and the actual truncation, per placement, before spend. It directly answers "will the 35% bottom safe zone eat our CTA?" without building a crop analyzer.
**Build:** after create (entities are PAUSED — safe), call previews for `MOBILE_FEED_STANDARD` + `INSTAGRAM_STORY` + `INSTAGRAM_REELS` and render them in SC-6 before the admin clicks Launch. **Highest value-per-line-of-code in this entire gap list.**

---

### 🟡 GAP-12 — **MED** — No policy pre-check. Personal Attributes will bite our voice.
**Evidence:** no copy validation anywhere. §7 shows the Personal Attributes rule is the most common copy rejection, and its trigger is **second-person + presumed attribute** — the exact register of Mingla's canonical voice.
**Build a pre-submit linter** (warn, never hard-block — false positives on a social product are guaranteed):
1. **Interrogative + second-person:** `/\b(are|do|did|have|has|is)\s+(you|your)\b/i` → flag. ("Are you…?", "Do you have…?" — Meta's own most-cited pattern.)
2. **Second-person + attribute lexicon:** `you|your` within N tokens of a protected-attribute term (race/ethnicity/religion/age-cohort/orientation/gender-identity/disability/health-condition/financial-status/voting/union/criminal-record) → flag.
3. **Presumed-state phrasings:** "tired of…", "struggling with…", "still single", "getting you down" → flag.
4. **Name insertion:** any templating that injects a person's name into copy → flag.
5. Ship the §7 rejected/compliant table as **inline UI guidance**, not a docs link.
**Explicitly do NOT build:** text-density checks (dead rule), engagement-bait rejection logic (that's a *ranking* demotion, not a rejection — §7).

---

### 🟢 GAP-13 — **MED-LOW** — Min budget hardcoded to 100¢; wrong for any non-impression goal.
**Evidence:** A2/§4.2 store `min_daily_budget_cents = 100` from the account probe. AC-3 validates against it.
**Problem:** **[OFFICIAL]** minimums are **per-optimization-category**, not per-account: `min_daily_budget_imp`, `min_daily_budget_high_freq`, `min_daily_budget_low_freq`, `min_daily_budget_video_views`. **100¢ is the impressions floor.** Our `LANDING_PAGE_VIEWS`/`LINK_CLICKS` ad sets are **high-frequency** (**[CONSENSUS]** ~$5.00/day) — so a $1.00/day LPV campaign may be rejected by Meta *after* passing our 422 check, or accepted and starved.
**Build:**
1. `admin-ad-connect` calls `GET /act_{id}/minimum_budgets` and stores **all four** values in `ad_connections.extra`.
2. Validate `budget.amount_cents` against **the minimum for the chosen `optimization_goal`'s category**, not the flat account minimum.
3. Add the **bid-cap rule**: under `LOWEST_COST_WITH_BID_CAP`, min daily ≥ `bid_amount` (impressions) or **≥ 5× `bid_amount`** (clicks/actions) — **[OFFICIAL]**; the "4×" figure in circulation is wrong.
4. **Do not hardcode the $1/$5/$40 table** — sources conflict; query the endpoint.

---

### 🟢 GAP-14 — **MED-LOW** — No learning-phase awareness. $1/day is ~2 orders of magnitude below the exit threshold.
**Evidence:** ~**50 optimization events per ad set per 7 days** **[OFFICIAL]**. Our live-fire plan is **$1.00/day** (§8 test plan). At a Travel/Arts benchmark CPC of ~$0.50 **[CONSENSUS]**, $1/day ≈ 2 clicks/day ≈ 14/week — and LPV/reservations are a fraction of that. **Permanent Learning Limited.**
**This is not a bug in the plan** — $1/day is the right *plumbing* test. It becomes a bug the moment anyone reads its CPA as performance signal.
**Build:**
1. Read `GET /{adset_id}?fields=learning_stage_info` → `{status: LEARNING|SUCCESS|FAIL, last_sig_edit_ts}`. Persist to `ad_sets`.
2. Surface a **"Learning Limited"** badge in SC-6 with the honest explanation ("this ad set is unlikely to reach ~50 optimization events in 7 days at this budget/audience — treat results as directional only").
3. **Warn at create** when `daily_budget × 7 ÷ estimated_CPA < 50`.
4. **Do NOT implement a "20% budget change" guard** — that rule doesn't exist **[OFFICIAL: no percentage stated; only "$100→$101 not significant, $100→$1000 likely is"]**. Instead warn on **order-of-magnitude** changes and on the edits Meta *does* name: **optimization event, audience, creative, pause**.

---

### 🟢 GAP-15 — **LOW-MED** — `special_ad_categories` accepted but never validated; `CREDIT` is retired.
**Evidence:** #862 accepts `special_ad_categories?:[]`, defaults `[]`, validates nothing. **[OFFICIAL]** `CREDIT` → `FINANCIAL_PRODUCTS_SERVICES` since **2025-01-14**.
**Build:** whitelist `HOUSING | EMPLOYMENT | FINANCIAL_PRODUCTS_SERVICES | ISSUES_ELECTIONS_POLITICS | NONE`; **reject `CREDIT`** with a migration message. When non-empty, **enforce the restriction cascade before the Meta call**: force age 18–65, strip `genders`, forbid `zips`/`excluded_geo_locations`/`custom_locations` below the radius floor (**15 mi / 25 km** US+CA; **15 km** EU), strip `flexible_spec` behaviors/demographics, forbid lookalikes. Also require `special_ad_category_country`. Low likelihood for us today; high blast radius if mis-declared (account-integrity, not a soft error).

---

### 🟢 GAP-16 — **LOW-MED** — Video is half-built across the two specs.
**Evidence:** **#866 §4.3** fully specs `uploadToMeta` video (`POST /act_{id}/advideos` → poll `video_status='ready'` → thumbnail hash). **#862 §4.4b step 3** builds `object_story_spec.link_data` with `image_hash|image_url` — **image only**. The A3 seam (`ads.creative_id` → `resolveCreativeRef`) exists, but #862's creative builder has no `video_data` branch.
**Consequence:** a video creative resolves to a `video_id` that #862 has nowhere to put. Reels/Stories — the formats that matter most for us — are unreachable.
**Build:** add the `video_data` branch to the Meta adapter's creative build: `object_story_spec.video_data = { video_id, image_hash: <thumbnail>, title: headline, message, link_description: description, call_to_action: {type, value:{link}} }`. Enforce CV-7…CV-14. Handle the **async poll** with a timeout + a typed error (a video stuck in transcoding must not hang the atomic create — it should fail-close and roll back per the no-orphan contract).

---

### 🟢 GAP-17 — **LOW** — No custom audiences / lookalikes plumbed, and no seed to build them from.
**Evidence [LIVE]:** `{"audiences":[]}`. `targeting.custom_audiences` isn't in the create body. **[SCHEMA]** `ads_create_custom_audience` supports all five subtypes.
**Blocked by GAP-2** (no pixel signal → no WCA → no seed ≥100 → no lookalike).
**Build (sequenced after GAP-2):** WCA from pixel URL rules (`/e/`, `/checkout/`) at 30d/180d; ENGAGEMENT audiences from IG/Page (**730d** retention — available *without* the pixel, so this is the one retargeting play we could run today **if** GAP-6 IG lands); `CUSTOM` from our own reservation emails (hashed `em`/`ph`, `customer_file_source: USER_PROVIDED_ONLY`); LOOKALIKE at **1%** (`ratio: 0.01`) once a seed ≥100 exists — **and remember the range is 1–20%, not 1–10%**.

---

### 🟢 GAP-18 — **LOW** — Missing small fields with real downside.
| Field | Why it matters | Build |
|---|---|---|
| `self_ai_disclosure` | **Our creative pipeline is Higgsfield/AI-generative.** `OPT_IN` declares third-party genAI media. Meta may show an "AI info" label per region. Non-disclosure of AI media is a compliance exposure we are actively creating | add to `ad_creatives` (`ai_generated boolean`) → map to `OPT_IN`/`OPT_OUT`. **Default `OPT_IN` for anything from the Higgsfield/Remotion pipeline** |
| `url_tags` | no UTMs → our own analytics can't see Meta traffic; PostHog/GA attribution blind | `utm_source=facebook&utm_medium=paid&utm_campaign={{campaign.name}}&utm_content={{ad.name}}&placement={{placement}}` |
| `conversion_domain` | AEM requirement on the ad | set to the true destination domain (interacts with GAP-8) |
| creative `name` | **[SCHEMA]** "strongly recommended"; without it the Meta-side library is unbrowsable | pass #866's `ad_creatives.name` |
| `attribution_spec` | we accept the 7d-click/1d-view default silently | **[SCHEMA] recommends omitting unless explicitly requested** — so the default is *correct*; just **document it** and surface it read-only in the UI. Do not expose a picker we don't need |
| `frequency_control_specs` | **only writable on REACH/THRUPLAY ad sets [OFFICIAL]** | if ever exposed, **gate the UI on optimization goal** or it will 400 |
| `brand_safety_content_filter_levels` | default is **expanded** (widest, least safe) **[LIVE, verbatim]** | consider `FEED_STANDARD` + `AN_STANDARD` (= "moderate"). **[LIVE]** caveat: *"if you don't see the option… contact your meta account representative"* — may be gated for us |
| `adset_schedule` | a venue's ad running at 4am is waste | dayparting `[{start_minute,end_minute,days[]}]` + `pacing_type: ["day_parting"]` |
| `dsa_beneficiary`/`dsa_payor` | **required for EU geo** — and **we are live in London** | auto-fills from business name, but set explicitly. **UK is not EU** for DSA, but any EU expansion trips this immediately |

---

### 🟢 GAP-19 — **LOW** — `ads_get_field_context` is being used as a schema source. It isn't one.
**Evidence [LIVE]:** it returns **legacy** objectives (→ create fails with VALIDATION), a **19-value** optimization_goal enum vs the create tool's **26**, `bid_strategy` with `enum_values: null`, and it **cannot resolve** `billing_event`, `special_ad_categories`, `attribution_spec`, `destination_type`, `promoted_object`, `targeting`, `issues_info`, `ad_review_feedback`, `call_to_action_type`, `publisher_platforms`, `facebook_positions`, `instagram_positions`, `device_platforms`.
**#862 §4.0 already caught the objective trap** — good. But it then **sourced the optimization_goal enum from field_context** ("LIVE `ads_get_field_context` optimization_goal enum, real"), which yields the **incomplete 19**.
**Build:** treat `ads_get_field_context` as a **reporting** catalog only. The write contract comes from the Graph create reference + the create-tool schemas. Add a note to the spec so no future agent re-derives an enum from the wrong source. **Corollary:** the same trap made both #862 and #866 conclude things about Pages (GAP-1), the Targeting Search API (GAP-10), and disapproval fields (GAP-4) that are true of the MCP but **false of the Graph API we actually ship against.** *The MCP is an exploration toy; the Graph API is the product.*

---

### Consolidated: every field WE must collect + validate

| Field | Collect | Validate | Rank |
|---|---|---|---|
| `objective` | select | ODAX 6 only; **never** trust field_context | ✅ have |
| `optimization_goal` | select | objective→goal matrix (§3); **don't rely on Meta's silent auto-correct** | GAP-19 |
| `billing_event` | select | `IMPRESSIONS`\|`LINK_CLICKS`\|`POST_ENGAGEMENT`\|`VIDEO_VIEWS` | ✅ have |
| `promoted_object.pixel_id` | auto | **required** for OFFSITE_CONVERSIONS/VALUE/LEAD_GEN/QUALITY_LEAD/APP_INSTALLS; recommended for LPV | GAP-2 |
| budget amount | number | ≥ **category-specific** min (query `/minimum_budgets`); ≥5× `bid_amount` under BID_CAP | GAP-13 |
| budget type | toggle | daily XOR lifetime; lifetime **requires `end_time`** | ✅ have |
| `bid_strategy` + `bid_amount`/`bid_constraints` | select | BID_CAP/COST_CAP **require** `bid_amount`; MIN_ROAS **requires** `roas_average_floor`; **CBO → campaign-level only** | GAP-18 |
| `special_ad_categories` | multiselect | 4 values + NONE; **reject `CREDIT`**; cascade restrictions | GAP-15 |
| geo countries | multiselect | ISO codes | ✅ have |
| **geo cities + radius** | **search** | **10–50 mi / 17–80 km; ≤250** | **GAP-10** |
| geo custom_locations | lat/lng | 0.63–50 mi / 1–80 km; ≤200 | GAP-10 |
| `location_types` | toggle | `home`\|`recent` only | GAP-10 |
| `age_min`/`age_max` | slider | **13–65**; **A+A on → age_min 18–25 only, age_max fixed 65** | ⚠️ partial |
| `genders` | toggle | `1`\|`2` | ✅ have |
| `locales` | multiselect | numeric IDs via `/search?type=adlocale` | GAP-10 |
| `flexible_spec` interests | **search** | real **13–16 digit** IDs via `/search?type=adinterest`; **never invent**; requires `geo_locations` present | GAP-10 |
| `custom_audiences` | multiselect | must exist | GAP-17 |
| `advantage_audience` | toggle | 0\|1; document the age side-effect | ⚠️ hardcoded 0 |
| placements | multiselect | AN & threads can't stand alone; `sponsored_messages` exclusive; `story` needs mobile; threads needs IG stream | GAP-5 |
| `attribution_spec` | read-only | omit → 7d-click/1d-view default (**correct**) | GAP-18 |
| `frequency_control_specs` | conditional | 1–90/1–90; **REACH/THRUPLAY goals ONLY** | GAP-18 |
| `brand_safety_content_filter_levels` | select | the 13-value enum; default = expanded | GAP-18 |
| `adset_schedule` | grid | 0–1440 minutes, days 0–6; pair `pacing_type:["day_parting"]` | GAP-18 |
| `page_id` | auto | **must be promoted under the ad account** | **GAP-1** |
| `instagram_user_id` | auto | omit → **no IG delivery** | **GAP-6** |
| `link_url` | auto (A1) | https; **crawler-resolvable**; server 307 not client JS | GAP-8 |
| `url_tags` | auto | UTM + macros | GAP-18 |
| `conversion_domain` | auto | true destination domain | GAP-18 |
| `message` | textarea | ≤**1024** reject; >**125** warn; **personal-attributes lint** | GAP-12/CV |
| `headline` | text | ≤**255** reject; >**27**/40/10 warn per placement | CV-20 |
| `description` | text | ≤**255** reject | CV-18 |
| `call_to_action_type` | select | official enum; `GET_TICKETS`→`BUY_TICKETS` | ✅ have |
| image | upload | CV-1…CV-6 | GAP-7 |
| video | upload | CV-7…CV-14 | GAP-7/16 |
| `poster_url` | upload | required for video | ✅ (#866 OD-4) |
| `self_ai_disclosure` | toggle | **OPT_IN for our Higgsfield pipeline** | GAP-18 |
| creative `name` | text | "strongly recommended" | GAP-18 |

### Gap ranking summary

| Rank | Gap | One line |
|---|---|---|
| **HIGH** | GAP-1 | Page not promoted under the ad account → **every** ad create fails "Facebook Page is Missing" |
| **HIGH** | GAP-2 | Pixel **never fired** (epoch-0, browser+server) → LPV goal has no signal; no retargeting; no lookalike seed |
| **HIGH** | GAP-3 | Account UNSETTLED / no payment → every launch parks at `PENDING_BILLING_INFO` *(already tracked)* |
| **HIGH** | GAP-4 | `issues_info`/`ad_review_feedback` never read → rejection reasons invisible; appeal is UI-only |
| **HIGH** | GAP-5 | One image + Advantage+ placements → auto-crop into 9:16 with 14%/35% safe zones unhandled |
| **MED-HIGH** | GAP-6 | Facebook-only (OD-8) → forfeits IG Feed/Stories/Reels on a visual product, for an MCP tooling reason |
| **MED-HIGH** | GAP-7 | No creative validation → format failures discovered from Meta error strings |
| **MED** | GAP-8 | OneLink `link_url` = unassessed Circumventing-Systems / landing-page-mismatch risk |
| **MED** | GAP-9 | `META_API_VERSION=v21.0` stale; 7d_view/28d_view + ASC/AAC deprecations already live |
| **MED** | GAP-10 | Countries-only targeting → can't target a **city** for a venue; Targeting Search wrongly deferred |
| **MED** | GAP-11 | No ad preview → cheapest mitigation for GAP-5, unused |
| **MED** | GAP-12 | No policy pre-check → Personal Attributes will hit our second-person voice |
| **MED-LOW** | GAP-13 | Min budget hardcoded 100¢ (impressions floor); LPV is high-frequency (~$5/day) |
| **MED-LOW** | GAP-14 | No learning-phase awareness; $1/day is ~2 OOM below the ~50-events/7d threshold |
| **LOW-MED** | GAP-15 | `special_ad_categories` unvalidated; `CREDIT` retired → `FINANCIAL_PRODUCTS_SERVICES` |
| **LOW-MED** | GAP-16 | Video half-built: #866 uploads it, #862's creative builder has no `video_data` branch |
| **LOW** | GAP-17 | No custom audiences/lookalikes plumbed (blocked by GAP-2) |
| **LOW** | GAP-18 | Missing small fields: `self_ai_disclosure`, `url_tags`, `conversion_domain`, creative `name`, dayparting, brand safety, DSA |
| **LOW** | GAP-19 | `ads_get_field_context` used as a schema source — it's a reporting catalog and misleads on 14+ fields |

### Things we must NOT build (each would be wasted work)
1. **Text-density / 20% validation** — rule removed ~Sept 2020; **directly confirmed absent from Meta's live ad-standards policy**.
2. **AEM 8-event priority ranking** — removed 2023-05-15; domain verification no longer mandatory for AEM.
3. **A "20% budget-change" learning guard** — not a Meta rule; Meta states no percentage.
4. **A "2× daily budget" pacing assumption** — it is **175%**, weekly-averaged, 7× hard ceiling.
5. **Engagement-bait rejection logic** — that's a *ranking demotion*, not an ad-review disapproval.
6. **An Advantage+ Shopping/App campaign builder** — **create AND update removed from the Marketing API** (v24/v25).
7. **A rejection-appeal API integration** — none exists; deep-link to Account Quality instead.
8. **A video bitrate validator** — no official number exists; the "5–10 Mbps" figure is folklore.
9. **A 60s/90s Reels duration cap** — official is 15 min (IG) / no max (FB).
10. **Lookalike ratio capped at 10%** — the real range is **1–20%**.

---

## Appendix — open questions for a human

1. **[UNVERIFIED]** Does an AppsFlyer OneLink in `link_url` survive Meta ad review at scale? No official text found either way. **Fetch `dest_smart_link` as `facebookexternalhit/1.1` before live-fire** (GAP-8).
2. **[UNVERIFIED]** Meta's dedicated Safe Zone article (help/980593475366490) **never rendered to automated fetch across two independent agent passes**. The 14%/35%/6% figures come from the per-placement Ads Guide pages and are internally inconsistent for FB Stories video (20% vs 35% bottom). A human should open it logged-in before we hard-gate on those pixels.
3. **Duplicate dataset rows [LIVE]** — `ads_get_datasets` returns two entries with the **same** `dataset_id 1949011972638955`, `creation_time` 1 second apart. Confirm one canonical dataset before wiring CAPI.
4. **Is inventory filter available to our account?** **[LIVE, verbatim]** *"if you don't see the option to use inventory filter, contact your meta account representative for access."*
5. **Exact permitted `attribution_spec.window_days` per objective** — **[OFFICIAL]** says they vary; no canonical table exists. Don't hardcode; validate per-objective at runtime.
6. **Confirm `min_daily_budget_*` live** — two conflicting figure sets found ($1/$5/$40 vs $0.50/$2.50/$40). **Query `GET /act_{id}/minimum_budgets`.**
