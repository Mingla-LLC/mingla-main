# Reddit Ads — Full Paid Pipeline Reference & Mingla Engine Gap Map

**Compiled:** 2026-07-14 · **Method:** read-only. Zero writes to the Reddit Ads API.
**Authority note:** every field/enum/constraint below marked **[SPEC]** is extracted from Reddit's own
OpenAPI 3.1 document (`reddit-ads-api-v3.yaml`, 3,687,594 bytes / 76,392 lines, `openapi: 3.1.0`,
`info.version: '3'`), downloaded from the docs site and parsed locally. That is the highest-fidelity
source available and it supersedes every blog/third-party spec sheet. Items marked **[HELP]** come
from Reddit's help center, **[GUIDE]** from the docs guides, **[3P]** from third-party spec sheets
(explicitly lower confidence — see §5.5).

---

## 0. Sources

| # | Source | How obtained | Confidence |
|---|---|---|---|
| S1 | **`https://ads-api.reddit.com/docs/specs/reddit-ads-api-v3.yaml`** — the complete OpenAPI 3.1 spec. Local copy: `./reddit-ads-api-v3.yaml` | `curl` w/ custom User-Agent; parsed with PyYAML, `$ref`s dereferenced | **Authoritative** |
| S2 | `https://ads-api.reddit.com/docs/v3/guides/quick-start/authenticate` | curl + HTML→text | Authoritative |
| S3 | `https://ads-api.reddit.com/docs/v3/guides/quick-start/create-dev-app` | curl + HTML→text | Authoritative |
| S4 | `https://ads-api.reddit.com/docs/v3/guides/programs/campaign/campaign-setup` | curl + HTML→text | Authoritative |
| S5 | `https://ads-api.reddit.com/docs/v3/guides/programs/campaign/campaign-objective-migration` | curl + HTML→text | Authoritative |
| S6 | `https://ads-api.reddit.com/docs/blog/conversion-pixel-id-requirement-notice` (dated **April 13, 2026**) | curl + HTML→text | Authoritative |
| S7 | `https://ads-api.reddit.com/docs/sitemap.xml` — 187 URLs (129 × `/v3/api/*`, 28 × `/v3/guides/*`) | curl | Authoritative |
| S8 | `https://business.reddithelp.com/s/article/Reddit-Ad-Unit-Specifications` | **BLOCKED** — Salesforce Lightning SPA, body loads via `sfsites/aura` XHR; server returns only a CSS-error shell to any non-JS client. **Creative pixel/filesize numbers could not be verified against official source.** | n/a |
| S9 | `https://strikesocial.com/blog/reddit-ad-specs-complete-sizes-dimensions-and-safe-zones-guide/` | WebFetch | **[3P] low** |
| S10 | Web search corpus (stackmatix, busylike, spilno, vizup, thebrief, admiral.media) | WebSearch | **[3P] low** |
| M1 | `mingla-orchs/issue-862-meta-ads-api/…/SPEC_ISSUE-862_META_ADS_CAMPAIGN_ENGINE.md` — **Amendment A3** (2026-07-14), lines 43–175. **This is where Reddit appears in our registry.** | local read | Authoritative (ours) |
| M2 | `mingla-orchs/issue-867-snapchat-google-channels/…/SPEC_ISSUE-867_SNAPCHAT_GOOGLE_CHANNELS.md` (500 lines) | local read | Authoritative (ours) |
| M3 | `mingla-orchs/issue-866-creative-library/…/SPEC_ISSUE-866_CREATIVE_LIBRARY.md` (381 lines) | local read | Authoritative (ours) |

### 0.1 Two corrections to the brief, up front

1. **"Spec 867 registry references Reddit" — false.** `grep -i reddit` over
   `SPEC_ISSUE-867_SNAPCHAT_GOOGLE_CHANNELS.md` returns **zero hits**. #867's registry is literally
   `{ snapchat: snapchatAdapter, google: googleAdapter, meta: metaAdapter }`. The Reddit reference
   lives in **#862 Amendment A3** (M1), which defines the 5-channel registry
   `{ meta, tiktok, snapchat, google, reddit }`. A3 is the canonical parent; #867 is a sibling that
   predates/omits Reddit.
2. **The objective enum in the brief is not Reddit's enum.** The brief proposed
   `BRAND_AWARENESS/REACH/TRAFFIC/CONVERSIONS/APP_INSTALLS/VIDEO_VIEWABILITY/CATALOG_SALES/LEAD_GEN`.
   The **actual current [SPEC]** enum is `APP_INSTALLS, CATALOG_SALES, CLICKS, CONVERSIONS,
   IMPRESSIONS, LEAD_GENERATION, VIDEO_VIEWABLE_IMPRESSIONS`. There is **no** `REACH`, no `TRAFFIC`,
   no `BRAND_AWARENESS`, no `VIDEO_VIEWABILITY`, no `LEAD_GEN`. See §2.2 — and note the
   **September 30, 2026** migration (§2.3) that introduces `BRAND_AWARENESS` and `SALES`.

---

## 1. Object hierarchy, IDs, transport

### 1.1 Hierarchy

```
business  (id: "t2_…"  via /me/businesses)
└── ad_account            (id: "a2_…" | "t2_…")   ← pattern ^(t2|a2)_.*   [SPEC]
    ├── funding_instrument   (billing source; currency-bound)
    ├── pixel                (conversion signal; ours: a2_jcfwvnfcfqcs)
    ├── profile              (id "t2_…" — the Reddit account that AUTHORS the ad post)
    │   ├── creative_assets  (asset library; id e.g. "t2_1234567890-IMAGE-232")
    │   ├── posts            (id "t3_…" — legacy direct post create)
    │   └── structured_posts (id "t3_…" — MODERN async job path)  [GUIDE-preferred]
    ├── campaign            (id: numeric string, e.g. "1684291704682361243")
    │   └── ad_group        (id: numeric string, e.g. "142154364526")
    │       └── ad          (references post_id "t3_…" + profile_id "t2_…")
    ├── custom_audiences / saved_audiences
    ├── lead_gen_forms      (SUNSET 2026-09-30 — see §2.3)
    └── product_catalogs → product_feeds → product_sets → products
```

**The defining structural fact:** a Reddit ad is a **promoted post**. `ad.post_id` points at a real
`t3_` Reddit post authored by a `t2_` **profile**. There is no standalone "creative" object bound to
the ad — the post *is* the creative. This is the single biggest shape mismatch against our
`ChannelAdapter` (§9/§10).

### 1.2 ID formats [SPEC]

| Entity | Format | Regex / example |
|---|---|---|
| Ad account | `a2_` or `t2_` | `pattern: ^(t2|a2)_.*` — ours is an `a2_` id |
| Business | `t2_` | `t2_…` |
| Profile | `t2_` | `pattern: ^t2_.*` |
| Post | `t3_` | `pattern: ^t3_.*` (e.g. `t3_12345`) |
| Campaign | numeric string | `"1684291704682361243"` |
| Ad group | numeric string | `"142154364526"` |
| Pixel | `a2_` | ours: `a2_jcfwvnfcfqcs` |
| Creative asset | composite | `t2_1234567890-IMAGE-232` |

Reddit's `t2_`/`t3_` are its classic "thing" prefixes (t2 = account, t3 = link/post). `a2_` is the
ads-platform prefix. **Both `t2_` and `a2_` are legal ad-account ids — never assume `a2_`.**

### 1.3 Transport [SPEC]

- **Base URL:** `https://ads-api.reddit.com/api/v3` (single production server; no sandbox).
- **Auth:** OAuth2 **authorizationCode** flow.
  - `authorizationUrl`: `https://www.reddit.com/api/v1/authorize`
  - `tokenUrl` / `refreshUrl`: `https://www.reddit.com/api/v1/access_token`
- **Token exchange/refresh:** HTTP **Basic** auth (`-u '<client_id>:<client_secret>'`),
  `content-type: application/x-www-form-urlencoded`, `grant_type=authorization_code|refresh_token`. [S2]
- **`User-Agent` header is REQUIRED** — Reddit's docs pass `-A '<user agent>'` on every token call.
  Reddit aggressively 429s/403s default UA strings (`python-requests`, bare `curl`). [S2]
- **Access-token lifetime:** `expires_in` is **3600** (1 h) **or 86400** (1 day) — "whichever is
  listed". Do not hardcode 3600. [S2]
- **Authorization code:** valid **10 minutes**, **single use**. `duration=permanent` is required to
  receive a refresh token; `duration=temporary` yields a 1-hour token that **cannot be refreshed**. [S2]

### 1.4 OAuth scopes — the full list [S2, SPEC]

The OpenAPI `securitySchemes` lists only 4; the authenticate guide lists **7**. The guide is
authoritative and broader:

| Scope | Purpose | In OpenAPI? |
|---|---|---|
| `adsread` | Read advertising data | ✅ |
| `adsedit` | Write/edit advertising data | ✅ |
| `adsconversions` | Post conversion events (CAPI) | ✅ |
| `adsdatadeletion` | Delete advertising data | ✅ |
| `adsleadgendownloader` | Read Lead Gen forms + retrieve leads | ❌ guide-only |
| `adsmeasurement:read` | Read measurement/attribution data | ❌ guide-only |
| `adsmeasurement:write` | Write measurement/attribution data | ❌ guide-only |

**Ours:** `adsread` + `adsedit`, own-account, verified live (`GET /api/v3/me` → 200).
**Implication:** we can read+write campaign structure but **cannot** post CAPI events
(`adsconversions`) — that's a re-consent, not a config change. See Gap G3.

### 1.5 Developer app provisioning [S3]

- Only **business admins with a verified account** can create dev apps
  (Business Manager → Developer Application).
- Fields: App name (Reddit explicitly rejects generic names like "Reddit Integration"/"Test"),
  Description, About URL, **Redirect URL**, **Primary contact** (must be a business admin).
- A member **cannot be removed from the business while they are an active primary contact**.
- Migrating an existing Reddit app **permanently limits its scope to the Ads API** (removes Devvit).

### 1.6 Rate limits [SPEC] — pooled per endpoint-group, **per authorizing user**

Limits are per *authorized instance* of your app: each user who authorizes gets their own pool.

| Group slug | Quota | Window | Covers |
|---|---|---|---|
| `ads-campaign-management-read` | **400** req | 60 s | Get Ad Account, List/Get Campaign, List/Get Ad Group, List/Get Ad, List Apps, List/Get Saved Audience, List Ad Accounts By Business, List Time Zones |
| `ads-campaign-management-write` | **200** req | 60 s | Create/Update Campaign, Ad Group, Ad, Saved Audience; Update Ad Account |
| `ads-targeting-taxonomy` | **100** req | 60 s | List Communities, Search Communities, Community Suggestions, List Carriers/Devices/Geolocations/Interests/Languages, Keyword+Geo Validations, Custom Audience reads, 3rd-party audiences |
| `ads-custom-audience-ingestion` | **3000** req | 900 s | Create/Delete Custom Audience, Update Custom Audience Users |
| `ads-custom-audience-ingestion-burst` | **500** req | 60 s | (same — burst layer) |
| `ads-privacy` | **60** req | 60 s | Data deletion jobs |
| `ads-funding-instruments` | **30** req | 60 s | List/Query funding instruments, child funding instruments |
| `ads-business-manager` | **100** req | 60 s | Get Me, Get/Update Business, Query Ad Accounts, List Profiles, Feature Access, Industries, Ad Account History |
| `ads-leads` | **20** req | 60 s | Lead gen forms |
| `ads-conversion-signals` | **30** req | 60 s | List Pixels (by account/business), Last Fired At |
| `ads-reporting` | **60** req | 60 s | Get A Report |
| `ads-product-catalog` | **7000** req | 300 s | Catalog endpoints |

**Headers (IETF `RateLimit` draft):**
- `RateLimit-Policy: "<name>";q=<quota>;w=<window>,…`
- `RateLimit: "<name>";r=<remaining>;t=<seconds-to-reset>,…`
- On 429 the exhausted policy reports `r=0`.
- **CAPI (`POST /pixels/{pixel_id}/conversion_events`) has unique limits and does NOT emit these
  standard headers.** [SPEC]

### 1.7 Endpoint surface [SPEC] — 76 paths

Full path list (method → path), grouped:

**Identity/business:** `GET /me`, `GET /me/businesses`, `GET|PATCH /businesses/{business_id}`,
`GET /businesses/{business_id}/ad_accounts`, `POST /businesses/{business_id}/ad_accounts/query`,
`POST /businesses/{business_id}/funding_instruments/query`, `GET /businesses/{business_id}/pixels`,
`GET /businesses/{business_id}/profiles`, `GET /feature_access`, `GET /industries`, `GET /time_zones`

**Ad account:** `GET|PATCH /ad_accounts/{id}`, `POST /ad_accounts/{id}/history`,
`GET /ad_accounts/{id}/apps`, `GET /ad_accounts/{id}/funding_instruments`,
`GET /ad_accounts/{id}/pixels`, `GET /ad_accounts/{id}/profiles`, `POST /ad_accounts/{id}/reports`

**Structure (the pipeline):**
- `GET|POST /ad_accounts/{ad_account_id}/campaigns` · `GET|PATCH /campaigns/{campaign_id}`
- `GET|POST /ad_accounts/{ad_account_id}/ad_groups` · `GET|PATCH /ad_groups/{ad_group_id}`
- `GET|POST /ad_accounts/{ad_account_id}/ads` · `GET|PATCH /ads/{ad_id}`

**Creative:**
- `GET|POST /profiles/{profile_id}/posts` · `GET|PATCH /posts/{post_id}` (legacy)
- `GET /profiles/{profile_id}/structured_posts` · `POST /profiles/{profile_id}/structured_posts/jobs`
  · `GET /structured_posts/jobs/{post_creation_job_id}` · `GET|PATCH /structured_posts/{post_id}` (modern)
- `GET|POST /profiles/{profile_id}/creative_assets/uploads` · `GET /creative_assets/uploads/{id}`
  · `GET /creative_assets/{creative_asset_id}` · `GET /profiles/{profile_id}/creative_assets`

**Audiences:** `GET|POST /ad_accounts/{id}/custom_audiences`, `GET|DELETE /custom_audiences/{audience_id}`,
`PATCH /custom_audiences/{audience_id}/users`, `GET|POST /ad_accounts/{id}/saved_audiences`,
`GET|PATCH /saved_audiences/{saved_audience_id}`

**Targeting taxonomy:** `GET /targeting/communities`, `GET /targeting/communities/search`,
`GET /targeting/communities/suggestions`, `GET /targeting/geolocations`,
`POST /targeting/geolocations_validations`, `GET /targeting/interests`,
`POST /targeting/keyword_suggestions`, `POST /targeting/keyword_validations`,
`GET /targeting/carriers`, `GET /targeting/devices`, `GET /targeting/languages`,
`GET /targeting/third_party_audiences`

**Signals/measurement:** `POST /pixels/{pixel_id}/conversion_events` (CAPI),
`GET /pixels/{pixel_id}/last_fired_at`, `GET /apps/{app_id}/last_fired_at_report`,
`GET /apps/{app_id}/skan_availability`

**Planning:** `GET /channel_planning/reach`, `POST /forecasting/bid_suggestions`,
`GET /funding_instruments/{funding_instrument_id}/allocations`

**Lead gen (sunsetting):** `GET|POST /ad_accounts/{id}/lead_gen_forms`, `GET /lead_gen_forms/{id}`

**Catalog:** `GET|POST /businesses/{id}/product_catalogs`, `GET|PATCH|DELETE /product_catalogs/{catalog_id}`,
`GET|POST /product_catalogs/{catalog_id}/product_feeds`, `GET|POST /product_catalogs/{catalog_id}/product_sets`,
`GET /product_catalogs/{catalog_id}/products`, `POST /product_catalogs/{catalog_id}/products/batch_upsert`,
`POST /product_catalogs/{catalog_id}/products/batch_delete`, `GET|PATCH|DELETE /product_feeds/{feed_id}`,
`GET|PATCH|DELETE /product_sets/{product_set_id}`, `GET /product_sets/{product_set_id}/products`,
`GET /product_catalogs/{catalog_id}/catalog_imports`, `GET /catalog_imports/{import_id}/issues`,
`GET /catalog_imports/{import_id}/report`

**Privacy:** `POST /ad_accounts/{id}/data_deletion_jobs`, `GET /data_deletion_jobs/{job_id}`

> **Note:** there is **no DELETE** for campaign/ad_group/ad. Deletion is
> `PATCH configured_status: "DELETED"`. Rollback/compensation must use PATCH, not DELETE. (Gap G8.)

---

## 2. Campaign level — every field

`POST /ad_accounts/{ad_account_id}/campaigns` · body `{ "data": { … } }` ·
`additionalProperties: false` (unknown keys are rejected). [SPEC]

### 2.1 Field table [SPEC]

| Field | Type | Req | Constraints / notes |
|---|---|---|---|
| `name` | string\|null | **REQ** | `minLength: 3`, `maxLength: 500` |
| `configured_status` | string | **REQ** | enum `ACTIVE, ARCHIVED, DELETED, PAUSED`; **`default: ACTIVE`** ⚠ |
| `objective` | string | **REQ** | enum — see §2.2 |
| `funding_instrument_id` | string\|null | — | campaign-level funding instrument |
| `is_campaign_budget_optimization` | boolean\|null | — | **immutable after publish** |
| `goal_type` | string\|null | — | enum `LIFETIME_SPEND, DAILY_SPEND, null`; used when CBO=true; **immutable after publish** |
| `goal_value` | integer\|null | — | **microcurrency**; only when CBO=true; e.g. `100000000` = $100 |
| `bid_strategy` | string\|null | — | enum `BIDLESS, MAXIMIZE_VOLUME, TARGET_CPX, null`; **required when CBO=true** |
| `bid_type` | string\|null | — | enum `CPC, CPM, CPV6, null`; **required when CBO=true** |
| `bid_value` | integer\|null | — | microcurrency; used when CBO=true; optional when `bid_strategy=MAXIMIZE_VOLUME`; **if set at campaign level it CANNOT be set at ad-group level** |
| `optimization_goal` | string\|null | — | 28-value enum (§3.3); required when CBO=true for conversions/video campaigns; **immutable**. ⚠ **From 2026-03-31 cannot be `null` for video-views campaigns — use `VIDEO_VIEW_6S`** |
| `spend_cap` | integer\|null | — | microcurrency **lifetime** cap; available for **non-CBO** campaigns, and for CBO **only when `goal_type=DAILY_SPEND`** |
| `start_time` | string\|null | — | ISO 8601; **required and only available when CBO=true** |
| `end_time` | string\|null | — | ISO 8601; **non-null required if `goal_type=LIFETIME_SPEND`** |
| `app_id` | string\|null | — | App Store / Play id (`1064216828`, `com.reddit.frontpage`); for `APP_INSTALLS` |
| `view_through_conversion_type` | string\|null | — | enum `SEVEN_DAY_CLICKS, SEVEN_DAY_CLICKS_ONE_DAY_VIEW, null`; only when CBO=true; **immutable after publish** |
| `special_ad_categories` | array\|null | — | items enum `HOUSING_EMPLOYMENT_CREDIT, NONE`; **`readOnly: true`** in the create schema; **immutable after publish** |
| `conversion_pixel_id` | string | **conditionally REQ** | **Required for all CBO campaigns from 2026-07-13** [S4, S6] |

**⚠ `configured_status` defaults to `ACTIVE`.** Omitting it publishes a live, spending campaign.
Every create we issue must pass `"PAUSED"` explicitly. (Gap G6.)

### 2.2 `objective` — the current enum [SPEC]

```
APP_INSTALLS
CATALOG_SALES
CLICKS
CONVERSIONS
IMPRESSIONS
LEAD_GENERATION
VIDEO_VIEWABLE_IMPRESSIONS
```

Semantics + billing [S4]:

| Objective | Purpose | Cost model |
|---|---|---|
| `IMPRESSIONS` (awareness) | Brand/product awareness; optimized for impressions | **CPM** |
| `CLICKS` (traffic) | Traffic to your website | **CPC** |
| `CONVERSIONS` | Valuable on-site actions | **CPC** |
| `VIDEO_VIEWABLE_IMPRESSIONS` (video views) | Views for your video | **CPV** |
| `APP_INSTALLS` | Mobile app installs | pay for clicks |
| `CATALOG_SALES` | Retail product/DPA sales; optimized for clicks | **CPC** |
| `LEAD_GENERATION` **(beta)** | Capture leads via on-Reddit forms | **CPC** |

**CBO eligibility [S4]:** `APP_INSTALLS`, `CONVERSIONS`, and `CATALOG_SALES` are **NOT eligible for
CBO**. Only `IMPRESSIONS`, `CLICKS`, `VIDEO_VIEWABLE_IMPRESSIONS` (and LEAD_GENERATION) can use CBO.
**Video-views campaigns can only serve video ads.**

For Mingla (drive traffic to public event/offering pages) the objective is **`CLICKS`**, bid_type
**`CPC`**. A3 already normalizes this correctly ("traffic Reddit" → ad-set goal `CLICKS`).

### 2.3 ⚠ Objective migration — **September 30, 2026** [S5]

Reddit is renaming objectives to industry conventions. Legacy enums remain supported "for the
foreseeable future," but new integrations should target the new set.

| Legacy enum | **New enum** | Valid optimization goals (new) |
|---|---|---|
| `IMPRESSIONS` | **`BRAND_AWARENESS`** | `null` |
| `VIDEO_VIEWABLE_IMPRESSIONS` | **`BRAND_AWARENESS`** | `VIDEO_VIEW_6S` |
| `CONVERSIONS` | **`SALES`** | `CLICKS, PURCHASE, ADD_TO_CART, PAGE_VISIT, SIGN_UP, ADD_TO_WISHLIST, VIEW_CONTENT, LEAD` |
| `CATALOG_SALES` | **`SALES`** | `CLICKS, PURCHASE` |
| `LEAD_GENERATION` | **`LEAD_GENERATION`** | `LEAD, SIGN_UP, CLICKS` |
| `CLICKS` | **`CLICKS`** | `CLICKS` |
| `APP_INSTALLS` | **`APP_INSTALLS`** | all 14 `MOBILE_CONVERSION_*` goals |

**Objective-specific rules after migration [S5]:**
- **Catalog:** `objective=SALES` + **`use_catalog=true`** (new field, not in current spec) →
  `product_set_id` required on **every** ad group. Catalog usage is uniform: all ad groups use one or
  none. `PURCHASE` → `view_through_conversion_type` must be `SEVEN_DAY_CLICKS_ONE_DAY_VIEW`;
  `CLICKS` → must be `null`. `shopping_ad_type` required on all ad groups.
- **Conversions:** `objective=SALES`, do **not** set `use_catalog=true` (it restricts goals to
  PURCHASE/CLICKS). Pixel or CAPI still required.
- **Brand awareness:** all ad groups in the campaign **must share the same `optimization_goal`** —
  mixing `null` and `VIDEO_VIEW_6S` is **not supported**.
- **Lead gen:** `optimization_goal` must be `LEAD` or `SIGN_UP`; `null` no longer supported for new
  campaigns. **On-site (onsite) lead-generation forms are no longer supported. Lead-gen form API
  sunsets 2026-09-30** — pull data before then. Pixel/CAPI now required.

**Impact on us:** our `CLICKS` objective is **stable across the migration** (`CLICKS` → `CLICKS`).
This is the lowest-risk objective to build on. But the adapter must not hardcode the legacy set.

### 2.4 Campaign read-side fields [SPEC]

`id`, `ad_account_id`, `created_at`, `modified_at`, `effective_status`,
`is_campaign_budget_optimization` (readOnly on ad group), `delivery_status[]`.

`effective_status` enum (§3.4) is the **real** delivery state; `configured_status` is only what you
asked for.

---

## 3. Ad group level — every field

`POST /ad_accounts/{ad_account_id}/ad_groups` · body `{ "data": { … } }` ·
schema is a **`oneOf`** (CBO vs non-CBO variants). [SPEC]

### 3.1 Field table [SPEC]

| Field | Type | Req | Constraints / notes |
|---|---|---|---|
| `campaign_id` | string | **REQ** | parent campaign |
| `name` | string | **REQ** | `minLength: 3`, `maxLength: 500` |
| `configured_status` | string\|null | **REQ** | enum `ACTIVE, ARCHIVED, DELETED, PAUSED, null` |
| **`conversion_pixel_id`** | string | **REQ (2026-07-13+)** | **The ad group's Pixel ID.** Required for **all** ad groups from 2026-07-13 [S6] |
| `bid_strategy` | string\|null | cond | enum `BIDLESS, MANUAL_BIDDING, MAXIMIZE_VOLUME, TARGET_CPX, null`. ⚠ Ad group has **`MANUAL_BIDDING`**; campaign does **not**. Under CBO **must match campaign**; set `null` to inherit |
| `bid_type` | string\|null | cond | enum `CPC, CPM, CPV, CPV6, null`. ⚠ Ad group adds **`CPV`**; campaign has only `CPC/CPM/CPV6`. Under CBO must match campaign; `null` inherits |
| `bid_value` | integer\|null | cond | `minimum: 0`; **microcurrency**. **Must be between $3.50 and $100 USD when `bid_type` is `CPC`** → **3_500_000 – 100_000_000 micro** |
| `goal_type` | string\|null | cond | enum `DAILY_SPEND, LIFETIME_SPEND, null`; under CBO must match campaign; `null` inherits |
| `goal_value` | integer\|null | cond | `minimum: 0`; **microcurrency** for monetary goal types; `null` inherits |
| `optimization_goal` | string\|null | cond | 28-value enum — §3.3 |
| `optimization_strategy_type` | string | — | enum `DOWNSTREAM_CONVERSIONS, APP_INSTALLS` |
| `start_time` | string\|null | — | ISO 8601 |
| `end_time` | string\|null | — | ISO 8601 |
| `schedule` | array\|null | — | `minItems: 0`; recurring weekly windows; objects `{start_day, end_day, start_hour, end_hour}`; **day 0=Sunday … 6=Saturday** |
| `targeting` | object\|null | — | **§3.2 — the whole game** |
| `saved_audience_id` | string\|null | — | reusable audience |
| `app_id` | string\|null | — | for `APP_INSTALLS` |
| `product_set_id` | string\|null | — | **required for all `CATALOG_SALES` ads** |
| `shopping_type` | string\|null | — | enum `DYNAMIC, STATIC, null` |
| `shopping_targeting` | object\|null | — | `{lookback_window_days, targeting_type: RETARGETING}` |
| `view_through_conversion_type` | string\|null | — | enum `SEVEN_DAY_CLICKS, SEVEN_DAY_CLICKS_ONE_DAY_VIEW, null`; must be `SEVEN_DAY_CLICKS_ONE_DAY_VIEW` for `CATALOG_SALES` |
| `skadnetwork_metadata` | object\|null | — | SKAdNetwork source-id status |
| `campaign_objective_type` | string\|null | readOnly | mirrors campaign objective |
| `is_campaign_budget_optimization` | boolean\|null | readOnly | **cannot be modified on the ad group** |
| `effective_status` | string\|null | readOnly | §3.4 |
| `delivery_status` | array\|null | readOnly | delivery reasons |
| `id`, `created_at`, `modified_at`, `ad_account_id` | | readOnly | |

**On the "~$5/day minimum" in the brief:** **not present in the API spec.** The spec encodes
`goal_value: minimum: 0` and no daily-budget floor. The only hard money bound [SPEC] is
**`bid_value` $3.50–$100 USD for CPC**. Any $5/day figure is a help-center/UI-level constraint,
unverified here (S8 blocked). **Do not hardcode $5/day** — treat the floor as unknown and surface the
API's 400 instead. (Gap G7.)

### 3.2 `targeting` — every field [SPEC]

`additionalProperties: false`. Whole object may be `null`.

| Field | Type | Limits | Values |
|---|---|---|---|
| **`communities`** | array | `minItems: 0`, no max | **subreddit names, plain strings, no `r/`** — e.g. `["aww"]`. ← **the Reddit-unique lever** |
| **`excluded_communities`** | array | `minItems: 0` | e.g. `["politics"]`. Ads ineligible for auctions there |
| `geolocations` | array | `minItems: 0`, **`maxItems: 20000`** | ids: `"US"`, `"US-VA"`, `"CA:6167865"`, `"3852263"` |
| `excluded_geolocations` | array | `minItems: 0`, `maxItems: 20000` | same id space |
| `interests` | array | `minItems: 0`, **`maxItems: 200`** | e.g. `["entertainment"]` |
| `excluded_interests` | array\|null | `maxItems: 200` | **`deprecated: true`** |
| `keywords` | array\|null | `minItems: 0`, **`maxItems: 1000`** | e.g. `["apple","computer"]` |
| `excluded_keywords` | array\|null | `minItems: 0`, **`maxItems: 2000`** | e.g. `["alcohol","drugs"]` |
| `custom_audience_ids` | array | `minItems: 0` | ignored when `shopping_type=DYNAMIC` |
| `excluded_custom_audience_ids` | array | `minItems: 0` | ignored when `shopping_type=DYNAMIC` |
| **`gender`** | string\|null | — | enum **`FEMALE, MALE, null`** — that's it |
| **age** | — | — | **DOES NOT EXIST.** No age field on ad-group targeting anywhere in the spec. `min_age`/`max_age` exist **only** as query params on `GET /channel_planning/reach` (a forecasting endpoint). ⚠ corrects the brief |
| `devices` | array | `minItems: 0`, `maxItems: 100` | objects: `{type: DESKTOP\|MOBILE, os: ANDROID\|IOS\|null, min_version, max_version, label_map}`. **min_version ≥ 14 for iOS.** **Exactly one device must be targeted for `APP_INSTALLS`** |
| `platforms` | array\|null | `minItems: 0`, `maxItems: 7` | enum `ALL, DESKTOP, DESKTOP_LEGACY, MOBILE_NATIVE, MOBILE_WEB, MOBILE_WEB_3X, SHREDTOP`. **`DESKTOP_LEGACY` deprecated/unsupported.** At least one mobile type required for `APP_INSTALLS` |
| **`locations`** | array | — | **enum `FEED, COMMENTS_PAGE`** ← the placement field. Collections ads: `FEED` only |
| `view_modes` | array | `minItems: 0`, `maxItems: 5` | enum `ALL, CARD, CLASSIC, COMPACT, IMMERSIVE` |
| `carriers` | array\|null | `minItems: 0`, `maxItems: 100` | **73-value enum** (`ATT_WIRELESS_US, SPRINT_US, TMOBILE_US, VERIZON_US, EE_UK, VODAFONE_UK, O2_UK, THREE_UK, SKY_MOBILE_UK, BT_MOBILE_UK, TALKTALK_UK, VIRGIN_MEDIA_UK, ROGERS_WIRELESS_CA, BELL_MOBILITY_CA, …, COMCAST, US_CELLULAR`) |
| `languages` | array\|null | — | ISO 639-1, **21 values**: `AR, CS, DA, DE, EL, EN, ES, FI, FR, HU, IT, JA, KO, NL, NO, PL, PT, RO, SV, VI, ZH` |
| `expand_targeting` | boolean\|null | — | Reddit's automated targeting expansion |
| `suppression_event_types` | array | `minItems: 0`, `maxItems: 11` | items `const: ALL_FEATURES` |

**Nigeria note:** Reddit's `languages` enum has **no Nigerian language**, and funding currencies
(§3.5) are **USD, GBP, CAD, EUR, AUD, NZD, SGD, BRL** — **no NGN**. Reddit is a **US/UK/CA/EU/AU**
channel for us; Lagos would be targeted geographically and billed in USD. (Gap G9.)

### 3.3 `optimization_goal` — full 28-value enum [SPEC]

```
ADD_TO_CART, ADD_TO_WISHLIST, CLICKS, LEAD, PAGE_VISIT, PURCHASE, SEARCH, SIGN_UP,
UNKNOWN, VIEW_CONTENT, LANDING_PAGE_VISIT, VIDEO_VIEW_6S, VIDEO_VIEW_15S,
MOBILE_CONVERSION_INSTALL, MOBILE_CONVERSION_SIGN_UP, MOBILE_CONVERSION_ADD_PAYMENT_INFO,
MOBILE_CONVERSION_ADD_TO_CART, MOBILE_CONVERSION_PURCHASE, MOBILE_CONVERSION_COMPLETED_TUTORIAL,
MOBILE_CONVERSION_LEVEL_ACHIEVED, MOBILE_CONVERSION_SPEND_CREDITS, MOBILE_CONVERSION_REINSTALL,
MOBILE_CONVERSION_UNLOCK_ACHIEVEMENT, MOBILE_CONVERSION_START_TRIAL, MOBILE_CONVERSION_SUBSCRIBE,
MOBILE_CONVERSION_ONBOARD_STARTED, MOBILE_CONVERSION_FIRST_TIME_PURCHASE, null
```

**Rule [S4]:** `optimization_goal` must match an event your **Pixel is actually tracking** — or use
`CLICKS` if the Pixel isn't fully set up. This is the safe default for our first Reddit campaign.

### 3.4 `effective_status` — full enum [SPEC]

Ad group / ad:
```
ACTIVE, AD_GROUP_PAUSED, ARCHIVED, CAMPAIGN_PAUSED, COMPLETED, DELETED,
PAUSED, PENDING_APPROVAL, PENDING_BILLING_INFO, PENDING_ID_VERIFICATION,
REJECTED, INVALID_DATA_SOURCE, MISSING_PERMISSIONS, PROCESSING, null
```
(`INVALID_DATA_SOURCE` appears on ad group; the ad enum otherwise matches.)

**This is the review-status field** — Reddit has no separate `review_status` object.
`PENDING_APPROVAL` / `REJECTED` on the **ad** is the review signal, paired with `rejection_reason`
(§4.3).

### 3.5 Funding instruments [SPEC] — `GET /ad_accounts/{id}/funding_instruments`

Fields: `id`, `name`, `currency`, `credit_limit`, `billable_amount`, `start_time`, `end_time`,
**`is_servable`**, **`reasons_not_servable`**, `invoice_group_status`, `authorize_status`.

- `currency` enum: **`USD, GBP, CAD, EUR, AUD, NZD, SGD, BRL`** (8 — **no NGN**).
- `authorize_status` enum: `PENDING, APPROVED, DECLINE_RETRYABLE, DECLINE_TERMINAL, null`.
- `invoice_group_status` enum: `ELIGIBLE, NO_ACTIVE_CL_FOUND, MULTI_BILL_ENTITY_FOUND,
  MULTI_PO_FOUND, MULTI_PAY_TERMS_FOUND, MULTI_OPPORTUNITY_FOUND, null`.

**`is_servable` + `reasons_not_servable` are the pre-flight gate** — check before create, otherwise
the campaign lands in `PENDING_BILLING_INFO` and silently never delivers. (Gap G5.)

---

## 4. Ad & creative level — every field

### 4.1 Ad — `POST /ad_accounts/{ad_account_id}/ads` [SPEC]

`required: ["ad_group_id", "configured_status", "name"]` · `additionalProperties: true` ·
single variant, `type` enum = `["UNSPECIFIED"]`.

| Field | Type | Req | Constraints |
|---|---|---|---|
| `ad_group_id` | string | **REQ** | e.g. `"142154364526"` |
| `name` | string | **REQ** | `minLength: 3`, `maxLength: 500`; used on dashboard + reports |
| `configured_status` | string | **REQ** | enum `ACTIVE, ARCHIVED, DELETED, PAUSED` |
| **`post_id`** | string\|null | — | **`pattern: ^t3_.*`** — the promoted post |
| **`profile_id`** | string\|null | — | the post author's profile. **Required for catalog sales campaigns** |
| `click_url` | string\|null | — | **`maxLength: 5000`**. Ignored when `shopping_creative` is set |
| `click_url_query_parameters` | array\|null | — | **`maxItems: 14`**; `{name, value}`; value supports **macros** e.g. `{{AD_ID}}` |
| `event_trackers` | array\|null | — | `{type: CLICK\|VIEW, url}`. **Only URLs from Reddit's approved measurement-provider list are allowed** |
| `products` | array\|null | — | **up to 6**; `{product_id}` |
| `shopping_creative` | object\|null | — | catalog/DPA creative — §4.4 |
| `skadnetwork_metadata` | object\|null | — | |
| `type` | string | — | enum `UNSPECIFIED` |
| `campaign_id` | string | readOnly | |
| `campaign_objective_type` | string\|null | readOnly | mirrors objective enum |
| `post_url` | string\|null | readOnly | `https://www.reddit.com/comments/123abc7` |
| `effective_status` | string\|null | readOnly | §3.4 |
| `delivery_status` | array\|null | readOnly | |
| **`rejection_reason`** | string\|null | readOnly | §4.3 |
| `preview_url` | string\|null | readOnly | valid while `preview_expiry` holds |
| `preview_expiry` | string\|null | — | date-time; set `null` to disable preview |
| `profile_username` | string\|null | **deprecated** | "This field is never populated… will be removed in the next API version" ⚠ the brief lists it |
| `id`, `ad_account_id`, `created_at`, `modified_at` | | readOnly | |

**Ad preview [SPEC]:** `preview_url` renders the ad in a placement. Append
`?comment_ad={{Preview ID}}` to a post URL to preview the **conversation placement**. This is a real
pre-launch QA lever we can expose to admin.

### 4.2 Creative — the two post-creation paths

**Path A — legacy direct: `POST /profiles/{profile_id}/posts`** [SPEC]

`additionalProperties: false`. Post `type` enum: **`CAROUSEL, IMAGE, TEXT, VIDEO`**.

| Field | Type | Constraints |
|---|---|---|
| `type` | string | enum `CAROUSEL, IMAGE, TEXT, VIDEO` |
| `headline` | string | the post's title — **no maxLength in schema** ⚠ |
| `body` | string | text posts — **`maxLength: 40000`** |
| `is_richtext` | boolean\|null | text body uses richtext |
| `allow_comments` | boolean | see §8 |
| `thumbnail_url` | string\|null | **required for VIDEO posts** |
| `content` | array | **`maxItems: 6`**. Carousel ≤6 images; IMAGE/VIDEO/TEXT support exactly 1 |
| `content[].media_url` | string\|null | **required for image, video, carousel** |
| `content[].destination_url` | string\|null | **required for image and carousel** |
| `content[].display_url` | string\|null | shown instead of destination; **must match destination domain** |
| `content[].caption` | string\|null | **`maxLength: 180`** (carousel image caption) |
| `content[].call_to_action` | string\|null | **24-value enum** — §4.5 |
| `id`, `post_url`, `profile_id`, `created_at` | | readOnly (`id` pattern `^t3_.*`) |

**Path B — modern async job (Reddit's documented path) [S4, SPEC]:**
`POST /profiles/{profile_id}/structured_posts/jobs` → poll `GET /structured_posts/jobs/{id}`.

Job `status` enum: **`QUEUED, PROCESSING, SUCCESS, CLIENT_ERROR, SERVER_ERROR`**.
- `SUCCESS` → a post is created.
- `CLIENT_ERROR` → fix the creative config and **create a new job** (not retryable as-is).
- `SERVER_ERROR` → retry later.

Body: `{ "data": { "allow_comments": bool (default false), "creative": { … } } }`,
`required: ["creative"]`. **`creative` is a 5-way `oneOf`:**

| Variant | `type` const | `required` |
|---|---|---|
| `ImageCreative` | `IMAGE` | `type, destination, headline, image` |
| `VideoCreative` | `VIDEO` | `video, thumbnail, type, headline, destination` |
| `TextCreative` | `TEXT` | `type, body, headline, text_format` |
| `CarouselCreative` | `CAROUSEL` | `carousel, type, headline` |
| `PromotedPostCreative` | `PROMOTED_POST` | `type, headline, post` |

Notable [SPEC]:
- `TextCreative.body`: `maxLength: 40000`; `text_format`: 2-value enum.
- `CarouselCreative.carousel`: **`minItems: 1, maxItems: 6`** — ⚠ **the guide [S4] says "Between 2–7
  creatives must be added."** **Schema and guide conflict.** Trust the schema (1–6) and let the API
  400 decide; do not encode 2–7.
- `PromotedPostCreative.headline`: **`maxLength: 2000`** — the **only** headline with a schema-level
  limit. Image/Video/Text/Carousel `headline` have **no maxLength** ⚠ (§5.4).
- `supplementary_text` (string\|null): disclaimer text, **"only available for select advertisers"**;
  **tip: limit to 100 chars** for display.
- `destination`: `{url, display_url, type: "URL"}` + `call_to_action` (24-enum).
- `thumbnail` / `image` / `video`: `{media: {url, type: "URL"}}` — Reddit **downloads from your URL**
  and rehosts. Supports `crop: {top_left_coordinates:{x,y}, dimensions:{…}}`.
- `enhancements.user_generated_content.enroll_status`: enum **`OPT_IN, OPT_OUT`** — "Redditor
  Highlights" (surfaces real Redditor comments in your ad). `allow_user_generated_content` is
  **deprecated** in favour of this.

**Path C — asset library:** `POST /profiles/{profile_id}/creative_assets/uploads`,
`data` array **`minItems: 1, maxItems: 50`**, per-item `oneOf` `NewImageAsset` / `NewVideoAsset`,
each `{reference_id, name, type: IMAGE|VIDEO, media: {url, type: "URL"}}`, `required: [type, name]`.

`GET /creative_assets/{id}` returns `StoredImageAsset`/`StoredVideoAsset`:
- `status` enum: **`DELETED, ACTIVE, PROCESSING_MEDIA, INVALID_MEDIA, DUPLICATE_ASSET`**
- `source` enum: `USER, GENERATED`
- `errors[]`: `{field, message}` — e.g. `field: "media"`, `message: "The image you provided is too small."`
- `media`: `{url, permanent_url, mime_type, height, width, aspect_ratio…}` (`height`/`width` readOnly)

**This is the only machine-readable creative validation Reddit offers** — and it's *post-upload*,
async, and prose-only (`message` is a human string, no error code). (Gap G4.)

### 4.3 `rejection_reason` — the review-failure enum [SPEC]

`readOnly`, on the **ad**. A large enum (100+ values). Complete list of what we could extract, in
spec order:

```
ADULT_CONTENT_PROHIBITED, ADULT_GENERAL, ALCOHOL, ALCOHOL_ADDICTION_AND_TREATMENT_PROGRAMS,
ALCOHOL_AGE_TARGETING, ALCOHOL_GEO_TARGETING, ALCOHOL_GLORIFICATION,
ALCOHOL_LICENSING_AND_REGISTRATION_UK_ONLY, ALCOHOL_MINORS, BRIDGE_PAGE, BROKEN_URL,
CAPITALIZATION, CAPITALIZING_ON_TRAGEDIES_OR_CRISES, CBD, CONTENT, COUNTERFEIT,
COUNTERFEIT_GOODS, DATING, DATING_DISCRIMINATORY,
DATING_FOCUS_ON_CASUAL_SEX_PROSTITUTION_FETISHES, DATING_FOCUS_ON_INFIDELITY,
DATING_MAIL_ORDER_BRIDE_SERVICES, DECEPTIVE, DECEPTIVE_MISLEADING_IRRESPONSIBLE_OR_MISLEADING,
DECEPTIVE_MISLEADING_USE_OR_COLLECTION_OF_DATA, DISCLOSURE_PROPER_ACCREDITATION, DISPLAY_URL,
EMAIL_GATED, EXCEEDING_CHARACTERS, FACILIATE_ILLEGAL_FRAUDULENT_OR_MISLEADING_BEHAVIOR [sic],
FINANCE_AND_CRYPTO_GEO_TARGETING, FINANCE_AND_CRYPTO_LICENSING_AND_REGISTRATION,
FINANCE_AND_CRYPTO_RESTRICTED, FINANCE_CRYPTO_EXAGGERATED_CLAIMS,
FINANCE_CRYPTO_INDIVIDUAL_INVESTMENTS, FINANCE_CRYPTO_PROHIBITED_PRODUCTS_AND_SERVICES,
FINANCIAL_CRYPTO_PRODUCTS_AND_SERVICES_…, GAMBLING, …
```
(spec `example: "GAMBLING"`)

**Directly relevant to Mingla** (an experience/social app, nightlife-adjacent):
- `DATING` and the four `DATING_*` reasons — **Mingla is explicitly not a dating app**
  (positioning is non-negotiable per project memory). If creative reads as dating, Reddit will reject
  under `DATING`. This makes the "experience app, not dating app" voice rule a **hard delivery
  constraint** on Reddit, not just brand preference.
- `ALCOHOL*` (7 reasons) — nightlife/bar venue creative risks alcohol classification, which forces
  **age targeting** (which Reddit's API **cannot express** — §3.2) and **geo targeting** constraints.
- `EXCEEDING_CHARACTERS` — headline/body length rejection, and **the API does not enforce the limit**
  (§5.4). This is a rejection we can only prevent client-side.
- `CAPITALIZATION` — ALL-CAPS/title-case rejection. Real, enforced.
- `BROKEN_URL`, `DISPLAY_URL`, `BRIDGE_PAGE`, `EMAIL_GATED` — landing-page policy. Our OneLink
  smart-link (`go.usemingla.com` → app or `/e/{brandSlug}/{eventSlug}`) is a **redirect**, which is
  exactly what `BRIDGE_PAGE` targets. Needs a policy read before spend. (Gap G10.)

### 4.4 `shopping_creative` (catalog/DPA) [SPEC]

`{allow_comments, call_to_action, destination_url, headline, second_line_cta, …}`. `destination_url`
empty/null → users go to the product's page. Out of scope for Mingla now (no product catalog).

### 4.5 `call_to_action` — full 24-value enum [SPEC]

```
Apply Now · Contact Us · Download · Get a Quote · Get Showtimes · Install · Learn More ·
Order Now · Play Now · Pre-order Now · See Menu · Shop Now · Sign Up · View More ·
Watch Now · Book Now · Buy Tickets · Get Directions · Listen Now · Read More ·
Subscribe · Visit Store · Donate Now · Remind Me · null
```

⚠ **These are Title-Case display strings, not SCREAMING_SNAKE constants** — unlike every other Reddit
enum, and unlike Meta/TikTok/Snap CTA enums. Any generic `toUpperCase()`/snake-case normalizer in a
shared adapter layer **will produce a 400 here**. (Gap G11.)

**Mingla-relevant CTAs:** `Buy Tickets` (ticketed events), `Book Now` (bookable offerings),
`Get Directions` (venue), `See Menu` (restaurants), `Learn More` (default), `Remind Me` (upcoming
events), `View More`. This is a **richer, better-fitting CTA set than most channels** — `Buy Tickets`
+ `Book Now` + `See Menu` map cleanly onto Mingla's three offering types.

---

## 5. Creative format specs

### 5.1 What the API actually enforces [SPEC] — authoritative

| Constraint | Value | Where |
|---|---|---|
| Carousel cards | **1–6** (`minItems: 1, maxItems: 6`) | `CarouselCreative.carousel` |
| Legacy post content items | **≤6** (`maxItems: 6`) | `Post.content` |
| Carousel caption | **≤180 chars** | `Post.content[].caption` |
| Text body | **≤40,000 chars** | `body` (both paths) |
| PROMOTED_POST headline | **≤2000 chars** | `PromotedPostCreative.headline` |
| Other headlines | **no limit in schema** | Image/Video/Text/Carousel |
| Ad `click_url` | **≤5000 chars** | `Ad.click_url` |
| Click URL query params | **≤14** | `Ad.click_url_query_parameters` |
| Products per ad | **≤6** | `Ad.products` |
| Asset upload batch | **1–50** | `creative_assets/uploads` |
| Entity name | **3–500 chars** | campaign/ad_group/ad `name` |
| Media intake | **URL-based** — `{media: {url, type: "URL"}}`; Reddit downloads + rehosts | all creative paths |
| Image crop | `{top_left_coordinates:{x,y}, dimensions:{…}}`, `x/y minimum: 0` | `ImageCreativeAsset.crop` |

**Critical finding: the OpenAPI spec encodes ZERO pixel dimensions, ZERO file-size caps, ZERO
duration bounds, ZERO codec/format lists.** I grepped the full 76,392-line spec for
`aspect ratio|resolution|MB|1080|1200|jpg|png|mp4|mov|gif|codec|duration` — the only hits are
unrelated (favicon URL, table markup, an example `height: 1080`/`width: 1920`, `- 1200` as a numeric
example). Media constraints are enforced **server-side at ingest**, surfaced asynchronously as
`status: INVALID_MEDIA` + `errors[].message` prose.

### 5.2 Media validation feedback loop [SPEC]

```
POST /profiles/{id}/creative_assets/uploads   (or structured_posts/jobs)
      → status: PROCESSING_MEDIA
      → poll GET /creative_assets/{id}
          → ACTIVE           ✅ media.height / media.width / media.mime_type now readable
          → INVALID_MEDIA    ❌ errors[]: {field: "media", message: "The image you provided is too small."}
          → DUPLICATE_ASSET  ⚠  Reddit dedupes identical media
          → DELETED
```
`message` is **human prose with no stable error code** — not safely machine-parseable. (Gap G4.)

### 5.3 Published creative specs [3P — UNVERIFIED, S8 blocked]

> ⚠ **These numbers could NOT be verified against Reddit's official ad-unit spec page** — it is a
> Salesforce Lightning SPA that returns only a CSS-error shell to non-JS clients. Third-party
> sources **contradict each other** (carousel max size: 3 MB [S10] vs 20 MB [S9]; caption 50 chars
> [S9] vs the API's actual **180** [SPEC]). Treat this table as **provisional**; the API-enforced
> values in §5.1 are the only ones we should hard-validate against today.

| Format | Dimensions [3P] | Ratios [3P] | Max size [3P] | Formats [3P] | Duration [3P] |
|---|---|---|---|---|---|
| **Image** | 1080×1080 (1:1), 1080×1350 (4:5), 1920×1080 (16:9), 1440×1080 (4:3); 1200×628 for feed | 1:1, 4:5, 16:9, 4:3 | **3 MB** | JPG, PNG, GIF | — |
| **Video** | 1920×1080 (16:9), 1440×1080 (4:3) desktop; 1200×1200 (1:1), 1200×1500 (4:5) mobile | 1:1, 4:5, 16:9, 4:3 | **1 GB** (rec. <512 MB) | MP4, MOV | **2 s – 15 min**; rec. 5–30 s (some sources 5–60 s); **≤30 FPS** |
| **Carousel** | 1200×1500 (4:5), 1440×1080 (4:3), 1920×1080 (16:9) | all cards **must share one ratio** | **3 MB** [S10] / **20 MB, GIF 3 MB** [S9] — ⚠ conflict | JPG, PNG, GIF | — |
| **Thumbnail** | 400×300 (4:3) | 4:3 | 500 KB [S10] / up to 3 MB [S9] — ⚠ conflict | — | — |
| **Headline** | — | — | **≤300 chars**, **≤80–100 recommended** | — | — |

**Safe zones [3P]:** keep essential content **centered / in the top two-thirds**; leave the
**bottom ~20%** clear of text and logos (the engagement bar — upvote/comment chrome — overlays it).
**4:5 portrait (1080×1350) is the recommended default** given Reddit's mobile-dominant traffic.

### 5.4 The headline trap [SPEC + S9/S10 + rejection enum]

Three facts that only matter together:
1. The API enforces **no** headline maxLength for IMAGE/VIDEO/TEXT/CAROUSEL creatives. [SPEC]
2. The documented policy limit is **300 chars** (≤80–100 recommended). [3P]
3. `rejection_reason` includes **`EXCEEDING_CHARACTERS`**. [SPEC]

→ An over-length headline **passes create with a 201**, then **fails review hours later**, burning a
review cycle. Headline validation is **ours to build or we eat the rejection**. (Gap G2.)

### 5.5 Confidence statement

Everything in §1–§4 and §5.1–§5.2 is **[SPEC]** — extracted from Reddit's own OpenAPI document and
safe to encode. §5.3 is **[3P]** and must be re-verified against S8 (rendered in a real browser, or
via `adsapi-partner-support@reddit.com`) **before** we hard-fail any creative on those numbers.
Validating against wrong constants is worse than not validating.

---

## 6. Placements

Reddit's placement model is the `targeting.locations` array [SPEC]:

| Value | Surface | Notes |
|---|---|---|
| **`FEED`** | Home / Popular / community feed | The default. **Collections ads: `FEED` only** |
| **`COMMENTS_PAGE`** | Conversation placement — inside the comment thread of a post | Reddit's highest-intent surface |

**There is no `COMMUNITY` placement value** — the brief's "feed / conversation / community" trio is
not the API's model. "Community targeting" is `targeting.communities` (**which subreddits**), a
different axis from `locations` (**where on the page**). They compose:
`communities: ["london"] + locations: ["FEED","COMMENTS_PAGE"]`.

**`view_modes`** (`ALL, CARD, CLASSIC, COMPACT, IMMERSIVE`) is a third, orthogonal axis — the layout
the ad renders in. Reddit users choose their feed density; `COMPACT`/`CLASSIC` render your creative
tiny. For an image-led brand like Mingla, `CARD` + `IMMERSIVE` is the quality-controlled choice.
**No other channel we integrate has this axis** — and nothing in A3's `placement jsonb` models it.

**Per-placement creative requirements:** not encoded in the API. `preview_url` +
`?comment_ad={{Preview ID}}` is the documented way to eyeball a placement before launch. [SPEC]

---

## 7. Validation & review

### 7.1 How review surfaces through the API [SPEC]

There is **no** dedicated review endpoint or `review_status` field. Review state is read from the
**ad's** `effective_status`:

| `effective_status` | Meaning |
|---|---|
| `PENDING_APPROVAL` | in review |
| `REJECTED` | rejected → read `rejection_reason` (§4.3) |
| `ACTIVE` | approved + delivering |
| `PENDING_BILLING_INFO` | funding instrument not servable (§3.5) |
| `PENDING_ID_VERIFICATION` | advertiser identity verification outstanding |
| `PROCESSING` | still being set up |
| `MISSING_PERMISSIONS` | auth/permission gap |
| `INVALID_DATA_SOURCE` | (ad group) pixel/data-source problem |
| `AD_GROUP_PAUSED` / `CAMPAIGN_PAUSED` | paused by a parent, not by this entity |
| `COMPLETED` | flight ended |

`delivery_status[]` carries additional reasons. Polling `GET /ads/{ad_id}` (under
`ads-campaign-management-read`, **400 req/60 s**) is the only way to learn a verdict — **no webhook,
no push**. (Gap G12.)

**Review time:** not stated anywhere in the API docs or guides. Reddit's published SLA is
help-center-gated (S8). Unknown — must be measured empirically.

**Appeal:** no API surface. Ads Manager UI / `adsapi-partner-support@reddit.com` only. [S6]

### 7.2 Validation layers, in the order they bite

1. **Schema (synchronous, 400).** `additionalProperties: false` on campaign + post + targeting —
   **any unknown key is rejected outright**. Enum/length/pattern violations 400 here.
2. **Cross-field business rules (synchronous, 400).** CBO⇄bid_strategy/bid_type/goal_type coherence;
   `bid_value` $3.50–$100 CPC; campaign-level `bid_value` forbids ad-group `bid_value`;
   `product_set_id` required for CATALOG_SALES; exactly one device + a mobile platform for
   APP_INSTALLS; `SEVEN_DAY_CLICKS_ONE_DAY_VIEW` required for CATALOG_SALES.
3. **`conversion_pixel_id` enforcement (synchronous, 400) — LIVE since 2026-07-13.** [S6]
   Required on **every ad group** and **every CBO campaign**. Retrieve via
   `GET /ad_accounts/{id}/pixels`. The docs give no error-code string; expect a 400 on the field.
   **Today's date is 2026-07-14 — this is in force as of yesterday.**
4. **Media ingest (asynchronous).** `PROCESSING_MEDIA` → `INVALID_MEDIA` + prose `errors[]`, or job
   `CLIENT_ERROR` (fix + **new job**) / `SERVER_ERROR` (retry).
5. **Human/policy review (asynchronous, hours).** `PENDING_APPROVAL` → `ACTIVE` | `REJECTED` +
   `rejection_reason`.
6. **Billing/identity gates.** `PENDING_BILLING_INFO`, `PENDING_ID_VERIFICATION` — a "successful"
   launch that never spends.

### 7.3 Rejection cause families (from the enum, §4.3)

- **Restricted verticals:** alcohol (7 reasons: glorification, minors, age/geo targeting, licensing
  UK-only, addiction/treatment), CBD, gambling, finance/crypto (7+ reasons: licensing, geo,
  exaggerated claims, individual investments, prohibited products), dating (5 reasons), adult (2),
  counterfeit (2).
- **Creative quality/formatting:** `CAPITALIZATION`, `EXCEEDING_CHARACTERS`, `CONTENT`, `DECEPTIVE`
  (+3 variants), `CAPITALIZING_ON_TRAGEDIES_OR_CRISES`.
- **Landing page:** `BROKEN_URL`, `DISPLAY_URL`, `BRIDGE_PAGE`, `EMAIL_GATED`,
  `DISCLOSURE_PROPER_ACCREDITATION`.
- **Behavioural:** `FACILIATE_ILLEGAL_FRAUDULENT_OR_MISLEADING_BEHAVIOR` [sic — Reddit's typo, must
  be matched verbatim].

### 7.4 Error envelope

The spec documents standard HTTP codes per operation — **201** (created), **400** (bad request),
**401** (no/bad bearer token), **403** (insufficient authentication scopes), **404**, **429** (with
`RateLimit-Policy`/`RateLimit` headers), **5XX**. There is **no batch envelope** (unlike Snapchat's
`request_status`/`sub_request_status`, unlike TikTok's `code===0`). Reddit uses **plain HTTP status
codes** — genuinely simpler than our other three adapters.

---

## 8. World-class best practices

1. **Native or dead.** Reddit's ad *is a post* — it sits in a feed of organic posts, is **upvoted,
   downvoted, and commented on**, and its comment section is public. Ad-looking creative gets
   downvoted and roasted in its own thread. This is not a soft style preference — the format
   structurally punishes advertising voice. Mingla's canonical voice
   (relatable, funny, edgy, not salesy) is already the correct Reddit voice; the
   **influencer-first / never-salesy** rule from Seth's content posture transfers directly.
2. **Community targeting is the killer lever, and it's Reddit-only.** `targeting.communities` buys
   intent no interest-graph can match: r/londonevents, r/AskLondon, r/nyc, r/FoodNYC, r/Nigeria,
   r/lagos. Mingla is a **city-level experience app** — Reddit's city subreddits are a near-perfect
   ICP match and there is **no equivalent primitive on Meta/TikTok/Snap/Google**. Ship the community
   picker or don't ship Reddit.
3. **Blocklist deliberately.** `excluded_communities` protects brand adjacency. Also
   `excluded_keywords` (`maxItems: 2000`) — a huge budget for negative keywords.
4. **Combine community + keyword.** Community = *where the audience lives*; keyword = *what they're
   talking about right now*. The intersection is Reddit's highest-signal targeting. Validate both
   first: `POST /targeting/keyword_validations`, `POST /targeting/keyword_suggestions`,
   `GET /targeting/communities/suggestions`, `POST /targeting/geolocations_validations` — all free,
   all under `ads-targeting-taxonomy` (100 req/60 s).
5. **Run the conversation placement.** `locations: ["COMMENTS_PAGE"]` reaches users mid-thread —
   deep intent, and historically cheaper than feed. Test it as its own ad group so you can read it.
6. **Leave comments ON.** `allow_comments: true`. Reddit ads with engaged comment sections earn
   social proof (upvotes + replies) that IS the creative. Turning comments off reads as cowardice to
   the audience and forfeits the format's only unique advantage. Requires actually moderating —
   budget for it.
7. **Opt into Redditor Highlights.** `enhancements.user_generated_content.enroll_status: "OPT_IN"`
   surfaces genuine Redditor comments in the ad — third-party social proof, free.
8. **Pixel + CAPI, deduplicated.** Browser pixel alone under-reports (cookie restrictions). Run both
   and dedupe by event id; CAPI has `click-id-persistence` + `verify-events` + `best-practices`
   guides. **Requires the `adsconversions` scope we do not currently hold.**
9. **Set `view_modes` deliberately.** `CARD`/`IMMERSIVE` protect image-led creative; `COMPACT` will
   render your beautiful 4:5 hero as a thumbnail.
10. **Bid where the API lets you.** `POST /forecasting/bid_suggestions` and
    `GET /channel_planning/reach` (with `min_age`/`max_age`/`geolocation`/`duration_days`) are free
    pre-flight planning. Start `MAXIMIZE_VOLUME` (bid_value optional) rather than guessing a manual
    CPC.
11. **Creative refresh.** Reddit audiences are the same people in the same subreddits daily; fatigue
    is fast and expresses as downvotes. Rotate on a fixed cadence.
12. **Respect the bottom 20%.** The engagement bar overlays it. Any text/logo there is destroyed.
13. **Never ALL-CAPS.** `CAPITALIZATION` is a literal rejection reason.
14. **Watch the dating line.** Mingla is an **experience app, not a dating app** — and `DATING` +
    4 variants are rejection reasons. Creative that reads "meet people" trips this. Say
    "plan the night", not "meet someone."

---

## 9. Our-engine capability map

### 9.1 Where Reddit lives in our specs today

| Artifact | Reddit content |
|---|---|
| **#862 Amendment A3** (M1, lines 43–175) — *the only place Reddit exists* | `platform` CHECK includes `'reddit'`; `Platform` type includes `'reddit'`; registry `{meta, tiktok, snapchat, google, reddit}`; `_shared/reddit.ts` named as a module to write; adapter line: *"**Reddit** — Ads API v3 `https://ads-api.reddit.com/api/v3`, **HTTP-Basic** client-id/secret token refresh, **`User-Agent` header required**; `refresh_token`."*; `auth_kind='refresh_token'`; budgets "Snapchat/Google/**Reddit** cents → micro ×10,000"; objective normalization "…/ traffic Reddit"; ad-set goal "… / Reddit CLICKS"; `review_status` "… / Reddit review"; creative ref "… / Reddit media id"; connection comment "Refresh-token platforms (snapchat/**reddit**) mint a short-lived access token in edge memory per call; it is never persisted." |
| **#867** (M2) | **ZERO Reddit references.** Registry = `{snapchat, google, meta}` |
| **#866** (M3) | Creative library; `resolveCreativeRef(creative_id, platform, lane)` + `ad_creative_platform_refs` cache — Reddit named only via A3's "Reddit media id" |
| **#863** | TikTok |
| **#865** | Conversions/attribution (Snap/Google CAPI) — **explicitly out of scope for channel specs** |

**Bottom line: there is no Reddit adapter spec, no Reddit field mapping, no Reddit creative rules,
and no Reddit line item beyond A3's one-sentence description. `_shared/reddit.ts` does not exist.**

### 9.2 A3 contract vs Reddit reality

| A3 says | Reddit reality [SPEC] | Verdict |
|---|---|---|
| Base `https://ads-api.reddit.com/api/v3` | exact match | ✅ |
| HTTP-Basic client-id/secret token refresh | exact match (`-u client:secret` at `https://www.reddit.com/api/v1/access_token`) | ✅ |
| `User-Agent` header required | confirmed | ✅ |
| `auth_kind='refresh_token'` | correct (`duration=permanent`) | ✅ |
| "mint a short-lived access token in edge memory per call; never persisted" | correct — but **`expires_in` is 3600 *or* 86400** | ⚠ don't hardcode 3600 |
| budgets "cents → micro ×10,000" | correct (microcurrency; $100 = 100_000_000) | ✅ |
| objective "traffic Reddit" | → **`CLICKS`** (survives the Sept-30 migration unchanged) | ✅ |
| ad-set goal "Reddit CLICKS" | `optimization_goal: CLICKS` — correct + the pixel-independent safe default | ✅ |
| `review_status` "Reddit review" column | ❌ **no such field** — it's `ad.effective_status` ∈ {PENDING_APPROVAL, REJECTED, …} + `rejection_reason` | ⚠ remap |
| `external_account_id` = "Reddit ad account" | ✅ but **`^(t2|a2)_.*`** — both prefixes legal | ⚠ |
| `external_org_id` = "Reddit business id" | ✅ `t2_` via `/me/businesses` | ✅ |
| creative ref = "Reddit media id" | ❌ **there is no media id on an ad.** The ad points at **`post_id` (`t3_`) + `profile_id` (`t2_`)**. A post must be created first | ❌ **model break** |
| `ChannelAdapter.createAd(conn, adSetExternalId, input) → {externalId, reviewStatus}` | Reddit needs a **post-create step + async job poll** before `createAd` is even callable | ❌ **interface gap** |
| `setStatus(level, externalId, status)` top-down | ✅ via `PATCH configured_status` | ✅ |
| compensating rollback / "delete" | ⚠ **no DELETE verb** — must `PATCH configured_status: "DELETED"` | ⚠ |
| `ad_connections.extra` holds pixel env-var names | ✅ fits `conversion_pixel_id` + `profile_id` | ✅ |

### 9.3 Our verified access

| Asset | Value | Status |
|---|---|---|
| Business | `950c8eac…` | ✅ |
| Ad account | "Mingla Ad Account 0" (`a2_…`) | ✅ |
| Pixel | **`a2_jcfwvnfcfqcs`** | ✅ — satisfies the 2026-07-13 `conversion_pixel_id` requirement |
| Scopes | `adsread`, `adsedit` | ✅ for structure; ❌ **no `adsconversions`** (CAPI blocked) |
| Access | own-account Ads-API verified, `GET /api/v3/me` → **200** | ✅ live |
| Profile (`t2_`) | **UNKNOWN — not captured** | ❌ **blocker**: no profile = no post = no ad |
| Funding instrument | **UNKNOWN — not captured** | ❌ **blocker**: no funding = `PENDING_BILLING_INFO` |

### 9.4 API-supported vs UI-only

| Capability | API? |
|---|---|
| Campaign/ad group/ad CRUD, status, targeting, audiences, catalogs, reporting, CAPI, pixels, forecasting, ad preview | ✅ |
| **Max campaigns** | ❌ **"Max campaigns creation isn't currently supported in the Reddit Ads API. Set up Max campaigns in the Ads Manager."** [SPEC, create-campaign] |
| Onsite lead-gen forms | ❌ **no longer supported**; lead-gen form API **sunsets 2026-09-30** [S5] |
| Creative dimension/size specs | ❌ not in API; help-center only (S8 blocked) |
| Review SLA / appeal | ❌ UI + `adsapi-partner-support@reddit.com` only |
| Dev app creation | ❌ Business Manager UI, business-admin-only, verified account [S3] |
| Review webhooks | ❌ poll-only |

---

## 10. Gaps & engineering implications

Ranked. **Ideal** = what a world-class Reddit buyer needs. **Capability** = what our engine has today
(**nothing** — `_shared/reddit.ts` is unwritten).

### HIGH

**G1 — The promoted-post step breaks `ChannelAdapter`. `createAd` cannot be called first.**
Reddit's ad = `{ad_group_id, post_id: t3_…, profile_id: t2_…, name, configured_status}`. The post
must exist. A3's interface has **no post/creative-create method** and its `ads.creative_id →
resolveCreativeRef → "Reddit media id"` assumption is simply wrong for Reddit — there is no media id
on an ad.
*Build:* extend `ChannelAdapter` with an optional `createNativeCreative(conn, input) →
{postId, profileId}` (no-op for Meta/TikTok/Snap/Google) OR let `redditAdapter.createAd` internally
run the full sub-pipeline: `POST /profiles/{profile_id}/structured_posts/jobs` → poll
`GET /structured_posts/jobs/{id}` until `SUCCESS|CLIENT_ERROR|SERVER_ERROR` (bounded backoff) → take
`t3_` id → `POST /ads`. The poll makes `createAd` **long-running and non-atomic** — it must land
inside #862's compensating-rollback envelope (and rollback = `PATCH DELETED`, not DELETE).
*Collect+validate:* `profile_id` (`^t2_.*`, required, from `GET /ad_accounts/{id}/profiles`),
creative type, headline, destination URL, CTA, media URL(s), `allow_comments`, UGC enroll status.

**G2 — Headline validation is ours or we eat `EXCEEDING_CHARACTERS` rejections.**
API enforces no headline maxLength for IMAGE/VIDEO/TEXT/CAROUSEL (only PROMOTED_POST @ 2000). Policy
limit is ~300 (≤80–100 recommended). Rejection arrives **hours later**, after a 201.
*Build:* client-side headline validator — hard-block >300, warn >100, warn >80 (mobile truncation);
block ALL-CAPS (→ `CAPITALIZATION`); enforce `caption ≤180` [SPEC-backed], `body ≤40000`,
`supplementary_text ≤100` (display tip), `name` 3–500, `click_url ≤5000`.

**G3 — We hold `adsread`+`adsedit`; CAPI needs `adsconversions`. Re-consent, not config.**
Pixel-only under-reports; #865's dedup story can't reach Reddit without the scope. Also
`adsmeasurement:read|write` are undocumented in the OpenAPI `securitySchemes` but real [S2].
*Build:* re-run the authorize URL with
`adsread,adsedit,adsconversions,adsmeasurement:read,adsmeasurement:write` and
**`duration=permanent`**; store the new refresh token in the Edge secret named by
`ad_connections.token_env_var`. Decide now whether Reddit CAPI is in #865's scope — today it is not.

**G4 — Creative validation has no authoritative constants, and Reddit's own feedback is prose.**
The OpenAPI spec carries **zero** px/filesize/duration/codec constraints (verified by full-text
grep). The official spec page (S8) is JS-gated. Third-party sources **contradict each other**
(carousel 3 MB vs 20 MB; caption 50 vs the API's real 180). Reddit's only machine feedback is async
`INVALID_MEDIA` + `errors[].message` prose with **no error code**.
*Build:* (a) **verify §5.3 in a real browser or via `adsapi-partner-support@reddit.com` before
hard-failing anything** — validating on wrong constants is worse than not validating; (b) implement
warn-not-block for [3P] numbers, hard-block only §5.1 [SPEC] values; (c) treat `INVALID_MEDIA` as a
terminal user-facing error surfacing `errors[].message` verbatim — never regex it.

**G5 — No funding-instrument or profile pre-flight ⇒ silent non-delivery.**
`PENDING_BILLING_INFO` / `PENDING_ID_VERIFICATION` mean "created fine, never spends." We've captured
neither a funding instrument nor a profile id.
*Build:* `connect()` must fetch `GET /ad_accounts/{id}/funding_instruments` and fail-close unless
one has **`is_servable: true`** (surface `reasons_not_servable`), and `GET
/ad_accounts/{id}/profiles` for ≥1 `t2_` profile. Cache both into `ad_connections.extra`. Check
`currency ∈ {USD,GBP,CAD,EUR,AUD,NZD,SGD,BRL}` — **NGN absent**.

**G6 — `configured_status` defaults to `ACTIVE`. Omission = live spend.**
A3 mandates create-PAUSED. Reddit's campaign schema `default: ACTIVE` turns a forgotten field into
real money.
*Build:* adapter always sends `"PAUSED"` explicitly at all three levels; add a **strict-grep CI
gate** (house pattern) asserting `_shared/reddit.ts` never constructs a create body without an
explicit `configured_status`. Cheap; prevents the worst possible bug in this system.

### MEDIUM

**G7 — Budget/bid validation: encode only what's real.** The brief's "~$5/day min" is **not in the
spec**; the only [SPEC] money bound is **`bid_value` $3.50–$100 USD for CPC** →
**3_500_000–100_000_000 micro**. `goal_value` is `minimum: 0`.
*Build:* validate the CPC bid band; convert cents→micro **×10,000** per A3; do **not** invent a
$5/day floor — let the API 400 and surface it. Enforce cross-field CBO rules pre-flight:
CBO ⇒ `bid_strategy`+`bid_type`+`start_time` required; `goal_type=LIFETIME_SPEND` ⇒ `end_time`
non-null; campaign `bid_value` set ⇒ ad-group `bid_value` must be null; `spend_cap` only for non-CBO
or CBO+`DAILY_SPEND`; **`APP_INSTALLS`/`CONVERSIONS`/`CATALOG_SALES` cannot use CBO**.

**G8 — `conversion_pixel_id` auto-attach (in force since 2026-07-13 — *yesterday*).**
Required on **every ad group** and **every CBO campaign**. We have `a2_jcfwvnfcfqcs`.
*Build:* store as `ad_connections.extra.reddit_pixel_id`; adapter **unconditionally** injects it into
every ad-group create and every CBO campaign create; validate against
`GET /ad_accounts/{id}/pixels` at connect. Also: **no DELETE verb exists** — rollback must
`PATCH configured_status: "DELETED"` (A3's "compensating delete" is a PATCH here).

**G9 — Review-status polling + status remap.** No webhooks. A3's `ads.review_status` column has no
Reddit source field.
*Build:* map `ad.effective_status` → our `review_status`
(`PENDING_APPROVAL`→PENDING, `REJECTED`→REJECTED + persist `rejection_reason`, `ACTIVE`→APPROVED);
map `PENDING_BILLING_INFO`/`PENDING_ID_VERIFICATION`/`MISSING_PERMISSIONS`/`INVALID_DATA_SOURCE` →
`delivery_status` with an admin-visible warning. Extend `admin-ad-campaign-sync` to poll
`GET /ads/{ad_id}` under the **400 req/60 s** read budget. Per #867's precedent, `launch` returns
**200 + `warning`** when review is PENDING/REJECTED.

**G10 — Subreddit/community targeting picker — the reason to do Reddit at all.**
`targeting.communities` (plain names, no `r/`) + `excluded_communities` have **no analogue** in Meta/
TikTok/Snap/Google, and A3's `targeting jsonb` "normalized `{countries, age_min, age_max, genders}`"
**cannot express it** — and worse, A3's normalized shape assumes `age_min`/`age_max`, which **Reddit
does not support at all** (§3.2).
*Build:* a community picker backed by `GET /targeting/communities/search` +
`/suggestions` (100 req/60 s, cache aggressively); store under a per-platform escape hatch in
`ad_sets.targeting` (A3's normalized shape must gain a passthrough or Reddit is crippled); validate
keywords via `POST /targeting/keyword_validations` and geos via
`POST /targeting/geolocations_validations` **before** create. Enforce caps: interests **200**,
keywords **1000**, excluded_keywords **2000**, geolocations **20000**, carriers/devices **100**,
platforms **7**, view_modes **5**.

**G11 — CTA enum is Title-Case display strings, not constants.**
`"Buy Tickets"`, `"Book Now"`, `"See Menu"` — **not** `BUY_TICKETS`. Any shared uppercase/snake-case
normalizer in `adChannel.ts` **will 400** on Reddit.
*Build:* per-platform CTA map with Reddit's 24 verbatim strings; map Mingla offering types →
`Buy Tickets` (ticketed) / `Book Now` (bookable) / `See Menu` (restaurant) /
`Get Directions` (venue) / `Remind Me` (upcoming) / `Learn More` (default). Unit-test that the Reddit
CTA is never uppercased.

### LOW

**G12 — Placement + `view_modes` axes unmodelled.** A3 has `placement jsonb` but nothing for
`locations` (`FEED`/`COMMENTS_PAGE`) or `view_modes` (`ALL/CARD/CLASSIC/COMPACT/IMMERSIVE`).
*Build:* expose both; default `locations: ["FEED","COMMENTS_PAGE"]` (conversation placement is a
Reddit edge) and `view_modes: ["CARD","IMMERSIVE"]` to protect image-led creative. Wire
`preview_url` (+ `?comment_ad=`) into admin for pre-launch eyeball.

**G13 — Objective migration lands 2026-09-30.** `CLICKS`→`CLICKS` is stable, so we're low-risk, but
a hardcoded legacy enum ages badly, and `use_catalog`/`shopping_ad_type` are new fields absent from
today's spec.
*Build:* objective as a mapped constant (not a literal); re-pull the OpenAPI YAML after 2026-09-30
and diff. Never build on `LEAD_GENERATION` (**form API sunsets 2026-09-30**).

**G14 — Rate-limit + User-Agent handling.** Pooled per-authorizing-user; 200 writes/60 s;
`ads-targeting-taxonomy` only **100/60 s** (a community picker will hit this).
*Build:* honour `RateLimit`/`RateLimit-Policy` headers, backoff on `r=0`; cache the targeting
taxonomy hard; set a descriptive `User-Agent` on **every** call including token refresh (Reddit
throttles default UAs); note **CAPI emits no rate-limit headers**.

**G15 — Nigeria is out of reach on Reddit.** Funding currencies exclude **NGN**; `languages` has no
Nigerian language. Reddit is a **US/UK/CA/EU/AU** channel for us; Lagos is targetable only
geographically, billed USD.
*Build:* no code — a **channel-strategy note**. Don't route the Nigeria lane to Reddit.

**G16 — `BRIDGE_PAGE` risk on our OneLink smart link.** A3 mandates `dest_smart_link`
(`go.usemingla.com` → app-or-web) as the creative URL. `BRIDGE_PAGE` is a live rejection reason and a
redirect is exactly what it describes. `display_url` must **match the destination domain** [SPEC].
*Build:* policy read before spend; have `dest_url` (canonical `/e/{brandSlug}/{eventSlug}`) ready as
the fallback; set `display_url` to `usemingla.com`. Cheap to check, expensive to discover at scale.

### 10.1 Fields we collect + validate (the build checklist)

| Level | Collect | Validate |
|---|---|---|
| Connection | ad_account_id, business_id, **profile_id**, **funding_instrument_id**, **pixel_id**, token env-var name | `^(t2\|a2)_`; funding `is_servable`; ≥1 profile; pixel in account; currency ∈ 8-enum; scopes |
| Campaign | name, objective, configured_status, CBO?, goal_type, goal_value, bid_strategy, bid_type, bid_value, spend_cap, start/end, conversion_pixel_id | name 3–500; objective ∈ 7-enum; **status explicitly PAUSED**; CBO cross-rules; CBO⇏{APP_INSTALLS,CONVERSIONS,CATALOG_SALES}; pixel required if CBO |
| Ad group | name, campaign_id, status, **conversion_pixel_id**, bid_type, bid_value, bid_strategy, goal_type/value, optimization_goal, start/end, schedule, targeting | name 3–500; **pixel required**; CPC bid 3.5e6–1e8 micro; goal ∈ 28-enum; schedule day 0–6; targeting caps (§3.2); **no age field**; gender ∈ {FEMALE,MALE,null} |
| Creative/post | profile_id, type, headline, body, destination_url, display_url, CTA, media_url(s), thumbnail, caption, allow_comments, UGC enroll | type ∈ 5 variants; headline ≤300 (warn ≤100/≤80), no ALL-CAPS; caption ≤180; body ≤40000; carousel **1–6** [SPEC]; thumbnail **required for VIDEO**; CTA ∈ 24 Title-Case; display_url domain == destination domain |
| Ad | ad_group_id, name, status, post_id, profile_id, click_url, query params, event_trackers | name 3–500; post `^t3_.*`; profile `^t2_.*`; click_url ≤5000; params ≤14; trackers ∈ approved providers |

### 10.2 Recommended first Reddit campaign (all-[SPEC], lowest-risk)

```
campaign:  objective=CLICKS, is_campaign_budget_optimization=false,
           configured_status=PAUSED, name="…"                       (CBO off ⇒ no campaign pixel needed;
                                                                     CLICKS survives the Sept-30 migration)
ad_group:  bid_strategy=MANUAL_BIDDING, bid_type=CPC,
           bid_value=<3_500_000..100_000_000 micro>,
           optimization_goal=CLICKS,                                (pixel-independent safe default [S4])
           conversion_pixel_id="a2_jcfwvnfcfqcs",                   (REQUIRED since 2026-07-13)
           configured_status=PAUSED,
           targeting={ communities:["london","AskLondon","nyc"],
                       geolocations:["US","GB"],
                       locations:["FEED","COMMENTS_PAGE"],
                       view_modes:["CARD","IMMERSIVE"],
                       languages:["EN"] }
post:      POST /profiles/{t2_…}/structured_posts/jobs
           creative={ type:IMAGE, headline:"≤100 chars, sentence case",
                      destination:{url:<dest_smart_link>, display_url:"usemingla.com",
                                   type:"URL", call_to_action:"Buy Tickets"},
                      image:{media:{url:…, type:"URL"}},
                      enhancements:{user_generated_content:{enroll_status:"OPT_IN"}} }
           allow_comments=true
           → poll GET /structured_posts/jobs/{id} → SUCCESS → t3_…
ad:        POST /ad_accounts/{a2_…}/ads
           { ad_group_id, name, configured_status:"PAUSED",
             post_id:"t3_…", profile_id:"t2_…",
             click_url:<dest_smart_link>,
             click_url_query_parameters:[{name:"utm_source",value:"reddit"},
                                         {name:"utm_medium",value:"{{AD_ID}}"}] }
launch:    PATCH configured_status=ACTIVE top-down (campaign → ad_group → ad)
           then poll GET /ads/{ad_id}.effective_status for PENDING_APPROVAL → ACTIVE|REJECTED
```

---

## 11. Verification note

**Research-only. Zero mutating calls were made to the Reddit Ads API.** No campaign, ad group, ad,
post, creative asset, audience, or catalog object was created, updated, or deleted. Every Reddit
network call in this research was either (a) a `GET` of public documentation on
`ads-api.reddit.com/docs/**`, or (b) the `GET` of the public OpenAPI YAML at
`ads-api.reddit.com/docs/specs/reddit-ads-api-v3.yaml`. **No request was made to
`ads-api.reddit.com/api/v3/**` at any point** — the `GET /api/v3/me` → 200 referenced in §9.3 was a
pre-existing verification supplied in the brief, not re-run here. No OAuth token was minted, read, or
transmitted.

**Local artifact:** `./reddit-ads-api-v3.yaml` (3,687,594 bytes) — the authoritative spec, pinned as
retrieved 2026-07-14. Re-pull and diff after **2026-09-30** (objective migration + lead-gen sunset).
