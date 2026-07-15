# SPEC — Reddit Ads Channel (issue TBD)

**Issue:** GitHub TBD at build dispatch (child of initiative #852 "[Full Rooms] Internal Ad & Reservation Engine"; plugs into **#862 Amendment A3** — the 5-channel engine — and the **A4-widened `ChannelAdapter`** being filed in parallel)
**Mode:** SPEC (docs-only; grounded in Reddit's own OpenAPI 3.1 document + six live engine-credential probes, 2026-07-15)
**Worktree:** `~/Desktop/mingla-orchs/issue-862-meta-ads-api/` (shared; conductor commits)
**Downstream routing:** this SPEC → `mingla-implementor` → `mingla-tester` → orchestrator CLOSE
**Author:** mingla-forensics · **Date:** 2026-07-15

> **User story:** "As a Mingla admin, I can connect Reddit Ads and create/launch/pause promoted-post campaigns from our admin — targeted at the subreddits where our cities actually live — so we can drive traffic to specific public event/offering pages."

---

## The three facts that govern this whole spec (read first)

1. **A Reddit ad IS a post.** `ad.post_id` points at a real `t3_` Reddit post authored by a `t2_` profile. There is no standalone creative object bound to the ad — the post is the creative, and it is created by an **async job** that must be polled to completion before `createAd` is even callable. [reddit.md §1.1, GR-10]
2. **`configured_status` defaults to `ACTIVE`.** A forgotten field on any create body publishes a **live, spending campaign**. Every create body in `_shared/reddit.ts` sends `"PAUSED"` explicitly, enforced by a strict-grep CI gate. [reddit.md §2.1, GR-11]
3. **Reddit's only machine feedback on creative is prose.** The OpenAPI spec encodes **zero** pixel dimensions, byte caps, durations, or codecs; media failures arrive asynchronously as `INVALID_MEDIA` + `errors[].message` — human English with no error code. Copy/creative validation is **ours**, and third-party constants are warn-only. [reddit.md §5.1–§5.2, GR-28, GR-22]

---

## §0 · Scope + evidence base

### 0.1 In scope (this story)

1. **Connect** the Reddit Ads account: refresh-token mint, full pre-flight (account, profile, funding instrument, pixel), `ad_connections` row for `(platform='reddit', lane='consumer')`.
2. **`_shared/reddit.ts`** — the fifth `ChannelAdapter`, implementing the A4-widened interface including `createCreative` (the structured-post sub-pipeline).
3. **Atomic-ish create** campaign → ad group → post (async job) → ad, all `PAUSED`, inside #862's compensating-rollback envelope (Reddit rollback = `PATCH configured_status:"DELETED"` — no DELETE verb exists).
4. **Targeting** — the normalized A3 shape **plus the per-platform passthrough** carrying `communities`/`excluded_communities` (the reason to do Reddit at all), with pre-create keyword/geo validation and the community-search backend.
5. **Copy + creative validation** (ours): headline/caption/body/name/URL limits, ALL-CAPS block, Title-Case CTA map, display-url domain rule, VIDEO thumbnail rule, warn-only [3P] media numbers.
6. **Review/status sync**: `effective_status` → `review_status` mapping, `rejection_reason` persisted verbatim, poll cadence, billing-state warnings.
7. **CI gates**: strict-grep `configured_status`, CTA-case unit test, cents→micro unit-conversion test, targeting-key allowlist test.

### 0.2 Non-goals (explicitly NOT built here)

- **Reddit CAPI / conversion events** — blocked on the `adsconversions` scope we do not hold (re-consent, not config) and on the #865 scope decision. §10.
- **Reporting / insights / attribution readback** — #865.
- **Builder UI** — #864 (this spec defines the validator rules and messages #864 consumes).
- **Lead generation** — never (form API sunsets 2026-09-30). **Catalog/DPA** — never (no product catalog). **Max campaigns** — API-unsupported (UI-only). [reddit.md §9.4]
- **Custom/saved audiences, lookalikes** — v1 passthrough fields exist but no picker/ingestion is built.
- **Business lane** — `lane='business'` lands when provisioned; schema already supports it (A3 §D).
- **Nigeria lane** — Reddit cannot bill NGN and has no Nigerian language; do not route Lagos spend here (§4.6, GR-72).

### 0.3 Evidence base

| Source | What it is | Authority |
|---|---|---|
| `research/ad-pipeline-2026-07-15/reddit.md` (1,088 ln) | Full-platform reference extracted from **Reddit's own OpenAPI 3.1 spec** (`reddit-ads-api-v3.yaml`, 76,392 lines, pinned locally 2026-07-14) + official guides | **[SPEC]-grade for every field/enum/constraint cited** |
| `research/ad-pipeline-2026-07-15/PROOF_LOG.md` R-P1…R-P6 + D-P1 | **Live probes with the engine's own credentials, 2026-07-15** — token mint, business, ad account, profile, funding, community search, crawler check | **Ground truth; supersedes all research-doc claims where they conflict** |
| `research/ad-pipeline-2026-07-15/GAP_REGISTER.md` | GR-10, GR-11, GR-12, GR-13, GR-28, GR-29, GR-30, GR-31, GR-32, GR-46, GR-59, GR-69, GR-70, GR-71, GR-72 + §4 corrections R-1…R-11 | Consolidated defect register |
| `research/ad-pipeline-2026-07-15/PIPELINE_BLUEPRINT.md` | §1.3d (communities), §1.5 (post job pipeline), §1.6 (CTA/copy), §1.8 (create-paused + rollback), §1.9a/b (status/rejection sync), §2.5 (creative tiers), §3 field maps | Cross-channel operating blueprint |
| `specs/SPEC_ISSUE-862_META_ADS_CAMPAIGN_ENGINE.md` **Amendment A3** | The unified schema (`ad_connections`/`ad_campaigns`/`ad_sets`/`ads`/`ad_status_events`) + `ChannelAdapter` + registry this spec plugs into | Canonical parent |
| **Amendment A4** (filed in parallel) | Widens `ChannelAdapter` with `createCreative(conn, input)` (GR-17); Reddit's return shape is `{postId, profileId}` | Canonical on the interface; if A4's merged shape differs, **A4 governs** |

### 0.4 Live-captured constants (engine credentials, 2026-07-15 — proof-grade)

| Asset | Value | Proof |
|---|---|---|
| Business id | `950c8eac-da26-45e6-942e-645ed657e43f` ("Mingla") | R-P2 |
| Ad account id | `a2_jcfwvnfcfqcs` — SELF_SERVE, USD, `admin_approval: VALID` | R-P3 |
| Profile id | `t2_2ikkjswp3a` ("usemingla") — the post author | R-P4 |
| Funding instrument | `1889187` — `is_servable: true`, `credit_limit: 100000000` micro ($100), `reasons_not_servable: []` | R-P5 |
| Conversion pixel id | `a2_jcfwvnfcfqcs` — **on Reddit the pixel id IS the ad-account id** (consistent across `/businesses/…/pixels` and `/ad_accounts/…/pixels`) | R-P3 |
| Token `expires_in` | **86400** (NOT 3600) on our account | R-P1 |
| Scopes held | `adsread adsedit` (no `adsconversions`) | R-P1 |
| Community search param | **`query=`** — `q=` silently no-ops and returns the popular list | R-P6 |

---

## §1 · Connection contract

### 1.1 Secrets (env-var NAMES only — never values; A3 §E invariant)

| Supabase Edge secret NAME | Holds |
|---|---|
| `REDDIT_ADS_CLIENT_ID` | OAuth client id of the Reddit dev app |
| `REDDIT_ADS_CLIENT_SECRET` | OAuth client secret |
| `REDDIT_ADS_REFRESH_TOKEN` | Permanent-duration refresh token (`duration=permanent` at consent; `temporary` yields a 1-hour token that cannot be refreshed) |

The DB stores these NAMES in `ad_connections.token_env_var` / `extra`; the values live only in Supabase Edge Function Secrets (`Deno.env`). Access tokens are minted in edge memory per invocation and never persisted (A3 connection comment).

### 1.2 Token mint — `mintRedditAccessToken()`

- `POST https://www.reddit.com/api/v1/access_token`, HTTP **Basic** auth (`client_id:client_secret`), `content-type: application/x-www-form-urlencoded`, body `grant_type=refresh_token&refresh_token=…`. [reddit.md §1.3]
- **Read `expires_in` from the response and cache the token for `expires_in − 300` seconds. NEVER hardcode 3600.** The guide says 3600 *or* 86400 "whichever is listed"; **ours is proven 86400** (R-P1), but the adapter must accept either (R-2).
- **Descriptive `User-Agent` on EVERY request — including this token mint.** Reddit aggressively 429s/403s default UA strings (`python-requests`, bare `curl`). Constant: `UA = 'mingla-ad-engine/1.0 (by /u/usemingla; support@usemingla.com)'` set in one place in the transport wrapper so no call can miss it. [GR-71]

### 1.3 `connect()` pre-flight — fail-close, in order

| # | Call | Assert | On failure |
|---|---|---|---|
| 1 | mint token (§1.2) | 200 + `access_token` | `424 reddit_not_connected` |
| 2 | `GET /api/v3/me` | 200; capture `t2_` user | `424 reddit_not_connected` |
| 3 | `GET /api/v3/me/businesses` | contains `950c8eac-da26-45e6-942e-645ed657e43f` | `424 reddit_not_connected` |
| 4 | `GET /api/v3/businesses/{business_id}/ad_accounts` | account matching **`^(t2\|a2)_.*`** — **both prefixes are legal; never assume `a2_`** (R-1); `currency ∈ {USD, GBP, CAD, EUR, AUD, NZD, SGD, BRL}` (**no NGN**) | `424 reddit_not_connected` / currency violation → `invalid` + admin warning |
| 5 | `GET /api/v3/ad_accounts/{id}/profiles` | **≥1 `t2_` profile** (no profile ⇒ no post ⇒ no ad) | **`424 reddit_profile_missing`** |
| 6 | `GET /api/v3/ad_accounts/{id}/funding_instruments` | **≥1 with `is_servable: true`** | **`424 reddit_funding_not_servable`** — surface `reasons_not_servable[]` **verbatim** |
| 7 | `GET /api/v3/ad_accounts/{id}/pixels` | pixel present (ours: `a2_jcfwvnfcfqcs`) | `424 reddit_not_connected` (pixel is mandatory on every ad group since 2026-07-13 — GR-12) |

On success, upsert the `ad_connections` row and cache steps 4–7 into `extra`. **Never report `connected=true` past a failed step** — "created fine, never spends" (`PENDING_BILLING_INFO`) is the silent failure mode this pre-flight exists to kill (GR-13).

### 1.4 The `ad_connections` seed row (corrects A3 §D's "a2_ id TBD")

| column | value |
|---|---|
| `platform` / `lane` | `'reddit'` / `'consumer'` |
| `display_name` | `'Reddit · Consumer (Mingla Ad Account 0)'` |
| `external_account_id` | `a2_jcfwvnfcfqcs` |
| `external_org_id` | `950c8eac-da26-45e6-942e-645ed657e43f` |
| `auth_kind` | `'refresh_token'` |
| `token_env_var` | `'REDDIT_ADS_REFRESH_TOKEN'` |
| `extra` | `{ "client_id_env_var": "REDDIT_ADS_CLIENT_ID", "client_secret_env_var": "REDDIT_ADS_CLIENT_SECRET", "reddit_profile_id": "t2_2ikkjswp3a", "reddit_funding_instrument_id": "1889187", "reddit_pixel_id": "a2_jcfwvnfcfqcs", "scopes": "adsread adsedit" }` |
| `status` | `'connected'` after §1.3 passes |

### 1.5 Transport + rate limits

- Base URL `https://ads-api.reddit.com/api/v3` (single production server; **no sandbox, no validate-only — the first create is the proof**).
- **Success = plain HTTP status codes.** `201` on create, `200` on read/patch. There is **no batch envelope** (no Snap `sub_request_status`, no TikTok `code===0`) — genuinely simpler; do not invent one. Errors: 400 / 401 / 403 / 404 / 429 / 5XX. [reddit.md §7.4]
- Create/update bodies are wrapped: `{ "data": { … } }`.
- **Honour the IETF `RateLimit` / `RateLimit-Policy` headers; back off when `r=0`.** Pools (per authorizing user): **400 reads/60 s** (`ads-campaign-management-read`), **200 writes/60 s** (`…-write`), **100/60 s `ads-targeting-taxonomy`** — the tightest budget; the community picker lives here → **cache hard** (§4.4). [reddit.md §1.6, GR-71]
- `AdApiError` normalization: `{ platform:'reddit', code:<http status>, message:<verbatim provider message>, request_id? }` — never echoes a token, never regex-parses provider prose.

---

## §2 · Data-model mapping onto A3/A4 tables

No new tables. Reddit rows land in A3's generalized set. Mapping, per level:

| A3 table.column | Reddit source | Notes |
|---|---|---|
| `ad_campaigns.external_campaign_id` | campaign `id` (numeric string, e.g. `"1684291704682361243"`) | |
| `ad_campaigns.objective` | **mapped constant `REDDIT_OBJECTIVE.TRAFFIC` → `"CLICKS"`** | Never a hardcoded literal at call sites (GR-70; §3.3). A3's "traffic Reddit" normalization is confirmed correct (R-6) |
| `ad_campaigns.daily_budget_cents` | `NULL` in v1 (non-CBO: budget lives on the ad group); under CBO → campaign `goal_value` ÷ 10,000 | cents at rest, always |
| `ad_sets.external_adset_id` | ad group `id` (numeric string) | |
| `ad_sets.budget_cents` | ad group `goal_value` ÷ 10,000 with `goal_type='DAILY_SPEND'` | boundary conversion §3.2 |
| `ad_sets.optimization_goal` | `'CLICKS'` | pixel-independent safe default [S4 rule, reddit.md §3.3] |
| `ad_sets.targeting` | normalized shape **+ `passthrough.reddit`** (§4.1) | GR-31: the normalized shape cannot express Reddit |
| `ad_sets.placement` | `{ "locations": ["FEED","COMMENTS_PAGE"], "view_modes": ["CARD","IMMERSIVE"] }` | both axes modeled explicitly (GR-69) |
| `ads.external_ad_id` | ad `id` | |
| `ads.review_status` | **derived — Reddit has NO `review_status` field.** Map from `ad.effective_status` (§6.1) | R-3 |
| `ads.review_detail` (jsonb, per GR-18) | `{ "rejection_reason": <verbatim>, "effective_status": …, "delivery_status": [...] }` | verbatim persistence, §6.2 |
| creative ref (#866 `ad_creative_platform_refs`) | **NOT a media id** (R-4 — no media id exists on a Reddit ad). The Reddit platform ref is the **`{post_id: "t3_…", profile_id: "t2_…"}` pair** produced by `createCreative`. Cache key must include the **copy+destination+CTA hash**, not just the creative id — a Reddit post fuses creative and copy, so a copy change means a NEW post | GR-10 |
| `ad_status_events.external_ids` | partial ids captured on failure — including an orphaned `t3_` post id when the job succeeded but `createAd` failed (§7.2) | |

**Money invariant (conductor-fixed):** budgets are stored in **cents** everywhere (A3 §A). The Reddit boundary conversion is **`micro = cents × 10_000`**, applied in exactly one function (`toMicro(cents)`) in `_shared/reddit.ts`. All minimum/band checks run **in micro, after conversion**. Unit test: **$5.00 → `500` cents → `5_000_000` micro** (§8, gate G-3). The **ONLY hard money bound** encoded anywhere: **`bid_value` $3.50–$100 USD when `bid_type=CPC` = `3_500_000`–`100_000_000` micro** [SPEC, reddit.md §3.1]. **Do NOT invent a daily-budget floor** — the spec has `goal_value: minimum: 0` and no floor; a floor check would reject valid campaigns (GR-59). If Reddit 400s on a low budget, surface that 400 **verbatim**.

---

## §3 · Adapter contract — `_shared/reddit.ts`

Implements the **A4-widened** `ChannelAdapter`:

```ts
// A4 shape (parallel amendment; A4 governs if it lands with a different signature)
interface ChannelAdapter {
  platform: Platform;                                    // 'reddit'
  connect(conn): AuthedClient;                           // §1.2–§1.3; fail-close
  createCampaign(conn, input): { externalId, status };
  createAdSet(conn, campaignExternalId, input): { externalId };
  createCreative(conn, input): { postId, profileId };    // ← A4; Reddit = the structured-post sub-pipeline (§3.4)
  createAd(conn, adSetExternalId, input): { externalId, reviewStatus };
  setStatus(conn, level, externalId, status): void;      // PATCH configured_status
  getStatus(conn, level, externalId): status;
}
```

The full create sequence (all called from `admin-ad-create-campaign`, all inside the compensating-rollback envelope, §7):

```
createCampaign → createAdSet → createCreative (job → poll → t3_) → createAd → [admin clicks Launch] → setStatus ACTIVE top-down
```

### 3.1 `createCampaign` — body, field by field

`POST /api/v3/ad_accounts/a2_jcfwvnfcfqcs/campaigns` — `additionalProperties: false` (unknown keys 400). v1 default is **non-CBO** (budget on the ad group; no campaign pixel required; simplest shape):

```jsonc
{ "data": {
    "name": "<3–500 chars>",                                   // [SPEC]
    "objective": "CLICKS",                                     // via REDDIT_OBJECTIVE map — §3.3
    "configured_status": "PAUSED",                             // EXPLICIT. ALWAYS. Schema default is ACTIVE = live spend. G-1 gate
    "funding_instrument_id": "1889187",                        // from extra.reddit_funding_instrument_id — explicit, not account-default
    "is_campaign_budget_optimization": false                   // immutable after publish
}}
```

**CBO variant (admin opt-in) — cross-field rules enforced pre-flight as 422s, before any provider call** [reddit.md §7.2, GR-59]:

- CBO=true ⇒ `bid_strategy`, `bid_type`, **and `start_time`** are REQUIRED.
- CBO=true ⇒ **`conversion_pixel_id` REQUIRED on the campaign** (since 2026-07-13) — injected unconditionally (§3.5).
- `goal_type='LIFETIME_SPEND'` ⇒ `end_time` non-null.
- Campaign `bid_value` set ⇒ ad-group `bid_value` **must be null**.
- `spend_cap` only for non-CBO, or CBO with `goal_type='DAILY_SPEND'`.
- **`APP_INSTALLS` / `CONVERSIONS` / `CATALOG_SALES` cannot use CBO** — reject the combination.

### 3.2 `createAdSet` (Reddit ad group) — body, field by field

`POST /api/v3/ad_accounts/a2_jcfwvnfcfqcs/ad_groups`:

```jsonc
{ "data": {
    "campaign_id": "<external campaign id>",
    "name": "<3–500 chars>",
    "configured_status": "PAUSED",                             // EXPLICIT. G-1 gate
    "conversion_pixel_id": "a2_jcfwvnfcfqcs",                  // UNCONDITIONAL — required on EVERY ad group since 2026-07-13 (GR-12).
                                                               // Value = extra.reddit_pixel_id; on Reddit the pixel id IS the account id (R-P3)
    "bid_strategy": "MAXIMIZE_VOLUME",                         // default start (bid_value optional under it) [reddit.md §8.10]
    "bid_type": "CPC",                                         // CLICKS objective bills CPC [S4]
    "bid_value": null,                                         // manual path: MANUAL_BIDDING + micro value in [3_500_000, 100_000_000] — the only hard band
    "goal_type": "DAILY_SPEND",
    "goal_value": 5000000,                                     // = toMicro(budget_cents); e.g. $5.00 → 500¢ → 5,000,000 micro. NO floor check of ours
    "optimization_goal": "CLICKS",                             // pixel-independent safe default; must match a pixel-tracked event otherwise
    "start_time": "<ISO 8601>",
    "end_time": null,
    "targeting": { /* §4 — serialized through the allowlist */ }
}}
```

Optional passthroughs: `schedule[]` (weekly windows `{start_day, end_day, start_hour, end_hour}`, **day 0=Sunday…6=Saturday**) when the admin sets dayparting.

### 3.3 The objective map — a constant, not a literal

```ts
// GR-70: the 2026-09-30 migration renames IMPRESSIONS→BRAND_AWARENESS, CONVERSIONS→SALES.
// CLICKS→CLICKS is stable. Keep the enum in ONE place; call sites use REDDIT_OBJECTIVE.*.
const REDDIT_OBJECTIVE = { TRAFFIC: 'CLICKS' } as const;
const REDDIT_OBJECTIVE_ENUM = ['APP_INSTALLS','CATALOG_SALES','CLICKS','CONVERSIONS',
  'IMPRESSIONS','LEAD_GENERATION','VIDEO_VIEWABLE_IMPRESSIONS'] as const;  // the REAL 7-value enum [SPEC]
```

- There is **no `TRAFFIC`, no `REACH`, no `BRAND_AWARENESS`** in the current enum (R-6). Any objective not in the 7-value enum → 422 before the provider call.
- **NEVER build on `LEAD_GENERATION`** — the lead-gen form API sunsets 2026-09-30. Reject it at the adapter with an explanatory error.
- After 2026-09-30, re-pull `reddit-ads-api-v3.yaml` and diff (local pin: 3,687,594 bytes, retrieved 2026-07-14); migrating means editing the map in one place.

### 3.4 `createCreative` — the structured-post sub-pipeline (A4; the heart of the adapter)

**This is what makes Reddit different (GR-10):** the post must exist before the ad. `createCreative(conn, input) → {postId, profileId}` runs:

**Step 1 — submit the job.** `POST /api/v3/profiles/t2_2ikkjswp3a/structured_posts/jobs`:

```jsonc
{ "data": {
    "allow_comments": true,                                    // default ON — comments are the format's advantage [reddit.md §8.6]
    "creative": {                                              // 5-way oneOf; v1 supports IMAGE, VIDEO, CAROUSEL
      "type": "IMAGE",
      "headline": "<validated per §5.2 BEFORE submit>",
      "destination": {
        "url": "https://usemingla.com/e/{brandSlug}/{eventSlug}",   // CANONICAL PAGE — never the OneLink (§5.4)
        "display_url": "usemingla.com",                        // MUST match destination domain [SPEC]
        "type": "URL",
        "call_to_action": "Buy Tickets"                        // Title-Case VERBATIM — §5.1
      },
      "image": { "media": { "url": "<public master URL>", "type": "URL" } },  // URL intake: Reddit downloads + rehosts; crop supported
      "enhancements": { "user_generated_content": { "enroll_status": "OPT_IN" } }  // Redditor Highlights [reddit.md §8.7]
    }
}}
```

Variant requirements [SPEC, reddit.md §4.2]: `ImageCreative` requires `type, destination, headline, image` · `VideoCreative` requires `video, thumbnail, type, headline, destination` (**thumbnail REQUIRED for VIDEO**) · `CarouselCreative` requires `carousel, type, headline` with **`minItems: 1, maxItems: 6`** — the guide's "2–7" conflicts with the schema; **trust the schema, encode 1–6, let the API 400 decide** (R-10).

**Step 2 — poll the job.** `GET /api/v3/structured_posts/jobs/{job_id}`, bounded exponential backoff (2 s → 4 s → 8 s → … cap 30 s; overall deadline 5 min, then fail the create and roll back):

| Job `status` | Action |
|---|---|
| `QUEUED` / `PROCESSING` | keep polling (backoff) |
| `SUCCESS` | extract the **`t3_` post id** → return `{ postId, profileId: 't2_2ikkjswp3a' }` |
| `CLIENT_ERROR` | **the creative config is wrong. Fix the config and submit a NEW job — NEVER retry the same job as-is.** Surface the provider message verbatim; fail the create |
| `SERVER_ERROR` | Reddit-side fault — **retry later** (bounded retries of a NEW job submission with the SAME config), then fail |

**Step 3 — media feedback loop.** If the underlying asset lands in the async media pipeline: `PROCESSING_MEDIA → ACTIVE | INVALID_MEDIA | DUPLICATE_ASSET`. `INVALID_MEDIA` is **terminal and user-facing**: surface `errors[].message` **verbatim — it is prose with NO error code; never regex it, never map it** (GR-22 tier rule). `DUPLICATE_ASSET` is benign (Reddit deduped identical bytes) — proceed.

**`createCreative` is long-running and non-atomic.** It sits inside the compensating-rollback envelope (§7); a `SUCCESS` job followed by a failed `createAd` leaves a real `t3_` post on the profile, which must be recorded (§7.2).

### 3.5 `createAd` — body, field by field

`POST /api/v3/ad_accounts/a2_jcfwvnfcfqcs/ads` — `required: [ad_group_id, configured_status, name]`:

```jsonc
{ "data": {
    "ad_group_id": "<external ad group id>",
    "name": "<3–500 chars>",
    "configured_status": "PAUSED",                             // EXPLICIT. G-1 gate
    "post_id": "t3_…",                                         // from createCreative — pattern ^t3_.*
    "profile_id": "t2_2ikkjswp3a",                             // from createCreative — pattern ^t2_.*
    "click_url": "https://usemingla.com/e/{brandSlug}/{eventSlug}",   // canonical page; ≤5,000 chars
    "click_url_query_parameters": [                            // ≤14; {{AD_ID}} is a documented macro
      { "name": "utm_source",   "value": "reddit" },
      { "name": "utm_medium",   "value": "paid" },
      { "name": "utm_campaign", "value": "<ad_campaigns.id>" },
      { "name": "utm_content",  "value": "{{AD_ID}}" }
    ]
}}
```

Response is `201`; capture `ad.id` → `ads.external_ad_id`, and read back `effective_status` (initially `PROCESSING`/`PENDING_APPROVAL`) → `review_status` via §6.1. Also capture **`preview_url`** and surface it in admin (append `?comment_ad={{Preview ID}}` to the post URL to eyeball the conversation placement) — the cheapest pre-launch QA lever on the channel [reddit.md §4.1, GR-33].

### 3.6 `setStatus` / `getStatus` / launch

- `setStatus`: `PATCH /api/v3/campaigns/{id}` · `/ad_groups/{id}` · `/ads/{id}` with `{ "data": { "configured_status": "ACTIVE" | "PAUSED" | "DELETED" } }`. **There is no DELETE verb anywhere on campaign/ad_group/ad — "delete" IS this PATCH** (R-5).
- **Launch is top-down:** campaign → ad group → ad, each PATCHed `ACTIVE` individually (a paused parent blocks children). Per #867's precedent, `admin-ad-set-status` returns **200 + `warning`** when the ad's review state is PENDING or REJECTED — launch is accepted, delivery is gated on review.
- `getStatus`: `GET` the entity; return `configured_status` + `effective_status` + `delivery_status[]` (the real state; `configured_status` is only what we asked for).

---

## §4 · Targeting

### 4.1 Shape — normalized + passthrough (GR-31)

A3's normalized `{countries, age_min, age_max, genders}` **cannot express Reddit and partially doesn't exist on Reddit**. The Reddit serializer consumes:

- **From the normalized shape:** `countries` → `geolocations[]`; `genders` → `gender` (must collapse to a single value or null — Reddit's field is scalar).
- **From `targeting.passthrough.reddit`:** `communities[]`, `excluded_communities[]`, `keywords[]`, `excluded_keywords[]`, `interests[]`, `locations[]`, `view_modes[]`, `languages[]`, `devices[]`, `platforms[]`.
- **NEVER from anywhere:** age. **Reddit has NO age targeting** — `min_age`/`max_age` exist only as query params on the `/channel_planning/reach` forecasting endpoint. `targeting` is **`additionalProperties: false`** — an emitted `age_min` key is an outright 400 (R-8). The serializer emits **only allowlisted keys** (gate G-4). Builder copy when age is set on a multi-channel plan: *"Reddit can't target by age at all — this campaign will reach adults of any age there. If age matters for this creative, exclude Reddit."* [PIPELINE_BLUEPRINT §1.3b]

### 4.2 Field rules [all SPEC]

| Field | Rule | Enforcement |
|---|---|---|
| `gender` | enum **`FEMALE, MALE, null`** — that's it, no other value | 422 pre-flight |
| `communities` / `excluded_communities` | **plain subreddit names, NO `r/` prefix** (`["london","AskLondon","nyc"]`); serializer strips a leading `r/` if the picker let one through | normalize + 422 on empties |
| `excluded_communities` default | **`["politics"]`** (brand adjacency) | default, admin-editable |
| `geolocations` / `excluded_geolocations` | ids like `"US"`, `"US-VA"`, `"CA:6167865"`; **≤20,000** each | 422 pre-flight |
| `interests` | **≤200**; `excluded_interests` is **deprecated → warn, don't send** | 422 / warn |
| `keywords` | **≤1,000** | 422 pre-flight |
| `excluded_keywords` | **≤2,000** | 422 pre-flight |
| `devices` | ≤100; iOS `min_version ≥ 14` | 422 pre-flight |
| `platforms` | ≤7; `DESKTOP_LEGACY` deprecated — never send | 422 / strip |
| `locations` | enum **`FEED`, `COMMENTS_PAGE`** — **default BOTH** (the conversation placement is deep-intent and historically cheaper). There is **no `COMMUNITY` placement** — communities are *who*, locations are *where on the page*; they compose | default + 422 |
| `view_modes` | ≤5; **default `["CARD","IMMERSIVE"]`** — **`COMPACT`/`CLASSIC` shrink our 4:5 hero to a thumbnail**; admins opting into them get a warning | default + warn |
| `languages` | 21-value ISO 639-1 enum; default `["EN"]`; **no Nigerian language exists** | 422 pre-flight |
| `schedule` | `{start_day, end_day, start_hour, end_hour}`, **day 0=Sunday** | 422 pre-flight |

### 4.3 Pre-create validation calls (free, and mandatory before any create)

- Keywords: **`POST /api/v3/targeting/keyword_validations`** — invalid keywords block the create with the provider's reason.
- Geos: **`POST /api/v3/targeting/geolocations_validations`** — same.
Both run under `ads-targeting-taxonomy` (100 req/60 s) — batch them, one call each per create.

### 4.4 Community picker backend

- **`GET /api/v3/targeting/communities/search?query=<text>`** — **the param is `query=`, NOT `q=`. `q=` silently no-ops and returns the popular list** (proven live, R-P6 — a silent-wrong-results bug if miscoded; gate-tested in G-4).
- `GET /api/v3/targeting/communities/suggestions` — seed suggestions from the destination city (e.g. `london` → r/london 1.56M, r/LondonPics, r/MovingToLondon, r/LondonTravel — R-P6).
- **Both live in the `ads-targeting-taxonomy` bucket at 100 req/60 s — the tightest pool on the platform. Cache HARD:** server-side cache keyed by query with ≥24 h TTL; debounced admin input; honour `RateLimit` headers and back off at `r=0` (GR-71).

### 4.5 Sanity default (the v1 targeting shape)

```jsonc
"targeting": {
  "communities": ["london", "AskLondon"],        // from passthrough; picker-driven
  "excluded_communities": ["politics"],
  "geolocations": ["GB"],
  "locations": ["FEED", "COMMENTS_PAGE"],
  "view_modes": ["CARD", "IMMERSIVE"],
  "languages": ["EN"]
}
```

### 4.6 Market note (GR-72 — no code, a routing rule)

Reddit funding currencies are `USD, GBP, CAD, EUR, AUD, NZD, SGD, BRL` — **no NGN**; the languages enum has **no Nigerian language**. **Reddit is a US/UK/CA/EU/AU channel for Mingla. Do not route the Nigeria lane here.** Lagos is geographically targetable and billed USD, but the #884 Brain's eligibility function (`objective × lane × market × connection-health`) must exclude Reddit for Nigeria-market plans.

---

## §5 · Creative + copy validation (ours — Reddit will not do it for us)

### 5.1 CTA — Title-Case verbatim display strings (GR-29)

The 24-value enum is literally: `Apply Now · Contact Us · Download · Get a Quote · Get Showtimes · Install · Learn More · Order Now · Play Now · Pre-order Now · See Menu · Shop Now · Sign Up · View More · Watch Now · Book Now · Buy Tickets · Get Directions · Listen Now · Read More · Subscribe · Visit Store · Donate Now · Remind Me` (+ `null`).

**These are display strings, not constants** — unlike every other Reddit enum and unlike Meta/TikTok/Snap CTA enums. **Any shared `toUpperCase()`/snake-case normalizer will 400 here.** The Reddit CTA map is per-platform and verbatim; membership is checked against the 24 strings; **unit test G-2 asserts the emitted CTA is never uppercased or snake-cased.**

**Mingla offering → CTA map** [PIPELINE_BLUEPRINT §1.6]:

| Mingla offering | Reddit CTA |
|---|---|
| Ticketed event | `Buy Tickets` |
| Bookable offering | `Book Now` |
| Restaurant | `See Menu` |
| Venue | `Get Directions` |
| Upcoming event (no sales yet) | `Remind Me` |
| Default / anything else | `Learn More` |

### 5.2 Copy validation — hard rules and warn rules (GR-28)

The headline trap: the API enforces **no** headline maxLength for IMAGE/VIDEO/TEXT/CAROUSEL (only PROMOTED_POST @ 2000); the policy limit is ~300; `rejection_reason` includes `EXCEEDING_CHARACTERS`. **An over-length headline passes create with a 201 and fails review hours later.** So we enforce, client + server, before any job submission:

| Rule | Level | Basis |
|---|---|---|
| Headline **> 300** chars | **Hard-block** | policy limit [3P] + `EXCEEDING_CHARACTERS` rejection [SPEC] |
| Headline > 100 | Warn (*"starts reading like an ad — Reddit punishes that"*) | [3P] |
| Headline > 80 | Warn (mobile truncation) | [3P] |
| **ALL-CAPS anywhere in headline/copy** | **Hard-block** | `CAPITALIZATION` is a literal rejection reason [SPEC] |
| Carousel `caption` **> 180** | **Hard-block** | [SPEC] |
| `body` > 40,000 | **Hard-block** | [SPEC] |
| Entity `name` outside 3–500 | **Hard-block** | [SPEC] |
| `click_url` > 5,000 | **Hard-block** | [SPEC] |
| `click_url_query_parameters` > 14 | **Hard-block** | [SPEC] |
| `supplementary_text` > 100 | Warn (display tip; select-advertiser field) | [GUIDE] |

### 5.3 Positioning rules — brand rules that are Reddit delivery rules (GR-46)

- **`DATING` + 4 `DATING_*` variants are rejection reasons.** Mingla is an experience app, not a dating app — on Reddit that's not brand preference, it's the difference between running and rejection. **Copy says "plan the night", never "meet someone."** Feed the shared copy-linter lexicon.
- **`ALCOHOL*` (7 reasons) is live risk for nightlife creative** — and alcohol classification forces age targeting **that Reddit's API cannot express**. Warn on alcohol-adjacent creative: lead with the room and the music, not the drinks. Escalate before any bar-led creative runs here.
- Safe zone: **warn** when text/logos sit in the bottom ~20% of the image — the upvote/comment engagement bar overlays it [3P; warn-only].

### 5.4 Destination policy — canonical page, never the OneLink (D-P1, GR-32)

- `destination.url` and `click_url` = **the canonical public page on `usemingla.com`** (e.g. `https://usemingla.com/e/{brandSlug}/{eventSlug}` = A3's `dest_url`). **The AppsFlyer OneLink (`go.usemingla.com/…`) is NEVER the Reddit destination** — D-P1 proved AppsFlyer serves crawlers an app-install interstitial (`af-preview` + `af_robot_sig`), which is exactly what Reddit's **`BRIDGE_PAGE`** rejection describes. **`minglabiz.onelink.me` is never used anywhere** (dead on Android — COMMS-0100/0101).
- **`display_url` MUST equal the destination domain** [SPEC — `DISPLAY_URL` is also a rejection reason]: `display_url: "usemingla.com"`, validated as a hard 422 (`display_url domain ≠ destination domain` → reject).
- Attribution rides the `click_url_query_parameters` UTMs (§3.5) — web analytics only in v1; app attribution for Reddit waits on #865/CAPI (§10).

### 5.5 Media rules — trust only the schema; warn on the rest (GR-22)

- **Intake is URL-based:** `{media: {url, type: "URL"}}` — Reddit downloads from our public URL and rehosts; `crop: {top_left_coordinates:{x,y}, dimensions:{…}}` is supported. #866's role for Reddit is simply serving a public master URL (no byte-upload path needed — unlike Snap/Google).
- **Thumbnail REQUIRED for VIDEO** creatives — hard 422 if missing [SPEC].
- **Carousel 1–6 cards** — hard [SPEC]; the guide's "2–7" is a documented conflict; do not encode it (R-10).
- **Every pixel-dimension / byte-size / duration / codec number is [3P] and self-contradictory** (carousel 3 MB vs 20 MB; the official spec page is a JS-gated Salesforce SPA). **WARN-only on all of them. Hard-block only [SPEC] rows.** Validating on wrong constants is worse than not validating.
- Async media verdicts: `PROCESSING_MEDIA → ACTIVE | INVALID_MEDIA | DUPLICATE_ASSET`. **`INVALID_MEDIA` → surface `errors[].message` verbatim** — admin copy: *"Reddit checks images after upload and only tells us in plain English. Here's exactly what Reddit said: '{message}'."* **Never regex or classify that prose.**

---

## §6 · Review / status sync

### 6.1 Status mapping — there is NO `review_status` field on Reddit (R-3)

Review state is read from the **ad's `effective_status`** via `GET /api/v3/ads/{ad_id}` (`ads-campaign-management-read`, 400 req/60 s). Mapping into A3's columns:

| Reddit `ad.effective_status` | `ads.review_status` | Also |
|---|---|---|
| `PENDING_APPROVAL` | `PENDING` | |
| `REJECTED` | `REJECTED` | **persist `rejection_reason` verbatim** into `ads.review_detail` |
| `ACTIVE` | `APPROVED` | |
| `PENDING_BILLING_INFO` | (unchanged) | → `delivery_status` + admin warning: *"approved-but-won't-spend — billing"* |
| `PENDING_ID_VERIFICATION` | (unchanged) | → `delivery_status` warning (identity verification outstanding) |
| `MISSING_PERMISSIONS` | (unchanged) | → `delivery_status` warning (auth/permission gap) |
| `INVALID_DATA_SOURCE` (ad group) | (unchanged) | → `delivery_status` warning (pixel/data-source problem) |
| `PROCESSING` | `PENDING` | still being set up |
| `AD_GROUP_PAUSED` / `CAMPAIGN_PAUSED` / `PAUSED` / `COMPLETED` / `ARCHIVED` / `DELETED` | (status passthrough) | paused-by-parent is not a review state |

### 6.2 `rejection_reason` — persist verbatim, then translate

- 100+ value readOnly enum on the ad, including: **`DATING` + 4 `DATING_*` variants; `ALCOHOL*` ×7; `CAPITALIZATION`; `EXCEEDING_CHARACTERS`; `BRIDGE_PAGE`; `BROKEN_URL`; `DISPLAY_URL`; `EMAIL_GATED`; `DECEPTIVE` (+variants); `GAMBLING`; `CBD`; and `FACILIATE_ILLEGAL_FRAUDULENT_OR_MISLEADING_BEHAVIOR`** — *sic*, **Reddit's own typo ("FACILIATE"); match it verbatim, never "fix" the spelling** in code or comparisons.
- Store the raw enum string in `ads.review_detail.rejection_reason`; render the cause→fix copy in admin [PIPELINE_BLUEPRINT §1.9b]: `DATING` → *"Mingla isn't a dating app, but '{line}' reads like one to Reddit's reviewers — try 'plan the night' instead of 'meet someone'"*; `CAPITALIZATION` → *"drop the ALL CAPS"*; `EXCEEDING_CHARACTERS` → *"headline over ~300"*; `BRIDGE_PAGE` → *"point Reddit at the canonical page"* (§5.4 already guarantees this — if it still fires, escalate).

### 6.3 Poll cadence

- **No webhooks, no push — poll-only.** Extend the cron-driven `admin-ad-campaign-sync`: **every 30–60 min while any Reddit ad is `PENDING`**, then daily (post-launch re-review happens on other channels; assume it can here).
- **Review SLA is unpublished — nowhere in the API docs or guides.** Admin copy: *"Nobody publishes how long Reddit takes — we'll poll and tell you."* **Measure it empirically** and record the observed distribution in the World Map after the first 10 reviews.
- Appeal: **no API surface** — Ads Manager UI / `adsapi-partner-support@reddit.com`. Deep-link, don't build.

---

## §7 · Rollback + failure envelope

### 7.1 Compensating rollback — PATCH, not DELETE (R-5)

**There is no DELETE verb for campaign/ad_group/ad** (verified across all 76 spec paths). A3's "compensating delete" is, on Reddit:

```
PATCH /api/v3/{campaigns|ad_groups|ads}/{id}   { "data": { "configured_status": "DELETED" } }
```

On any mid-chain failure, roll back **in reverse creation order** (ad → ad group → campaign) with the PATCH above; each rollback attempt is recorded in `ad_status_events` (`action='rollback'`). A failed rollback logs `external_ids` for manual reconciliation and does not mask the original error.

### 7.2 The orphan class unique to Reddit: the post

`createCreative` is long-running and non-atomic (§3.4). If the job reaches `SUCCESS` (a real `t3_` post now exists on the `usemingla` profile) and a later step fails, the rollback envelope **cannot delete the post via the ads tree** — posts are profile-scoped, not children of the campaign. Rules:

- A `t3_` post with no ad attached is **not spend-bearing** — it is safe residue, not a money bug.
- Record it: `ad_status_events.external_ids = { "orphaned_post_id": "t3_…", "profile_id": "t2_…" }` with `action='create_failed'` so an operator can clean the profile manually (or a later ad create can **reuse** it via the #866 platform-ref cache, §2).
- Never auto-retry `createAd` against an orphaned post without operator action — idempotency comes from the `request_id` key (A3/#863 precedent), not from guessing.

### 7.3 Error envelope

- **Plain HTTP codes.** `201` = created; `400` = validation (surface the body **verbatim** — this includes any daily-budget floor Reddit enforces that its spec doesn't document, GR-59); `401` = re-mint once, then fail-close `424 reddit_not_connected`; `403` = scope/UA problem — check the UA constant before blaming scopes (Reddit 403s default UAs); `404`; `429` = honour `RateLimit`/`RateLimit-Policy`, back off to the reset window, retry once, then surface; `5XX` = bounded retry then surface.
- Every provider response lands in `ad_status_events.provider_response` (normalized; **never contains a token**).

---

## §8 · CI gates (all fail-on-revert; house strict-grep pattern)

| Gate | What it asserts | Mechanism |
|---|---|---|
| **G-1 · strict-grep `configured_status`** | `_shared/reddit.ts` **never constructs a create body without an explicit `configured_status`** — the schema default is `ACTIVE` = live spend on a forgotten field (GR-11). | Structural check over the adapter source: every create-body builder (`buildCampaignBody`/`buildAdGroupBody`/`buildAdBody` — the only three places a `POST` body may be constructed) must set `configured_status` from an explicit parameter; the gate greps that every `data:` object literal passed to a `POST` on `/campaigns`, `/ad_groups`, `/ads` contains the key `configured_status`. Reverting the key in any builder fails CI. |
| **G-2 · CTA-case unit test** | The emitted `call_to_action` is byte-identical to one of the 24 Title-Case strings; **`"Buy Tickets"` never becomes `BUY_TICKETS` or `"BUY TICKETS"`** (GR-29). Feeds every offering type through the map and asserts verbatim membership + that no uppercase/snake normalizer touched the value. | Unit test in the adapter suite |
| **G-3 · unit-conversion test** | `toMicro(500) === 5_000_000` (**$5.00 → 5,000,000 micro**); `toMicro(2000) === 20_000_000`; bid-band check accepts `3_500_000` and `100_000_000`, rejects `3_499_999` and `100_000_001`; **asserts NO daily-floor check exists** (a $2.00/day `goal_value` passes our validator — the API, not us, owns the floor) (GR-01, GR-59). | Unit test |
| **G-4 · targeting-allowlist + query-param test** | The targeting serializer emits **only** allowlisted keys — property test proving `age_min`/`age_max`/any unknown key can never appear (Reddit 400s unknown keys, R-8); gender output ∈ `{FEMALE, MALE, null}`; a leading `r/` is stripped from community names; the community-search client uses **`query=`** and never `q=` (R-P6). | Unit/property test |

These join the widened cross-platform RT-gates from A3 §E (env-var names only under `supabase/functions/**`; no token in any client bundle).

---

## §9 · Acceptance criteria

Every AC is testable and cites its evidence. Connection ACs run against the live account (read-only); create-chain ACs run against mocked transport in CI plus one supervised live-fire (Reddit has **no validate-only** — the first real create is the proof, executed PAUSED and rolled back).

**Connection**
- **AC-R-1** `connect()` mints a token via HTTP Basic + form-encoded refresh grant and `GET /me` returns `t2_2ikkjswp3a`; the `ad_connections` row is upserted with `external_account_id='a2_jcfwvnfcfqcs'`, `external_org_id='950c8eac-da26-45e6-942e-645ed657e43f'`, and `extra` containing `reddit_profile_id='t2_2ikkjswp3a'`, `reddit_funding_instrument_id='1889187'`, `reddit_pixel_id='a2_jcfwvnfcfqcs'`. [R-P1…R-P5]
- **AC-R-2** Token TTL is read from `expires_in`: a mocked mint returning `86400` caches ~86100 s, one returning `3600` caches ~3300 s; **no `3600` literal exists as a TTL constant in the adapter**. [R-2, R-P1]
- **AC-R-3** The descriptive `User-Agent` is present on **every** outbound request **including the token mint** — transport-layer test intercepts all calls. [GR-71]
- **AC-R-4** Fail-close: missing `REDDIT_ADS_REFRESH_TOKEN` secret → `424 reddit_not_connected`; zero profiles → `424 reddit_profile_missing`; no servable funding instrument → `424 reddit_funding_not_servable` with `reasons_not_servable[]` surfaced verbatim (test uses the pre-fix probe values `CREDIT_CARD_NOT_APPROVED`, `CREDIT_LINE_EXHAUSTED`). [GR-13, R-P5]
- **AC-R-5** An ad-account id with `t2_` prefix passes validation (`^(t2|a2)_.*`) — the adapter never asserts `a2_`. [R-1]
- **AC-R-6** A funding instrument in a currency outside the 8-value enum (or a hypothetical NGN) marks the connection `invalid` with an admin-visible reason. [GR-72]

**Create chain**
- **AC-R-7** `createCampaign` body: `configured_status:"PAUSED"` explicit, `objective` sourced from `REDDIT_OBJECTIVE.TRAFFIC` (resolves to `"CLICKS"`), `funding_instrument_id:"1889187"` attached, `is_campaign_budget_optimization:false`, wrapped in `{data:{…}}`. [reddit.md §2.1, §10.2]
- **AC-R-8** `createAdSet` **unconditionally** injects `conversion_pixel_id` (= `extra.reddit_pixel_id`) — there is no code path that builds an ad-group body without it; test constructs bodies for every input combination and asserts presence. [GR-12]
- **AC-R-9** CBO pre-flight 422s (before any provider call): CBO without `bid_strategy`/`bid_type`/`start_time`; CBO campaign without `conversion_pixel_id`; `LIFETIME_SPEND` without `end_time`; campaign `bid_value` set with ad-group `bid_value` non-null; CBO with `APP_INSTALLS`/`CONVERSIONS`/`CATALOG_SALES`; `spend_cap` on CBO+`LIFETIME_SPEND`. [reddit.md §7.2, GR-59]
- **AC-R-10** Money: gate G-3 passes ($5.00 → 5,000,000 micro; bid band edges; no daily floor of ours); a mocked Reddit 400 on a low budget is surfaced to the admin **verbatim**. [GR-01, GR-59]
- **AC-R-11** `createCreative` state machine: `SUCCESS` → returns `{postId:'t3_…', profileId:'t2_2ikkjswp3a'}`; `CLIENT_ERROR` → fails with the provider message and any retry submits a **NEW** job (the same `job_id` is never re-submitted); `SERVER_ERROR` → bounded later-retry of a new job with the same config; `QUEUED`/`PROCESSING` → backoff-poll capped at 30 s intervals with a 5-min deadline. [reddit.md §4.2 Path B, GR-10]
- **AC-R-12** `createAd` posts `{post_id, profile_id}` matching `^t3_` / `^t2_`; an ad create without a resolved `post_id` is unrepresentable in the adapter's types; `click_url` is the canonical `usemingla.com` page with ≤14 query params including `{{AD_ID}}`. [reddit.md §4.1, D-P1]
- **AC-R-13** Launch PATCHes `configured_status:"ACTIVE"` **top-down** (campaign → ad group → ad) and returns **200 + `warning`** while the ad's review state is PENDING/REJECTED. [#867 precedent, GR-18]
- **AC-R-14** Mid-chain failure rolls back every created entity in reverse order via **`PATCH configured_status:"DELETED"`** — the string `DELETE` never appears as an HTTP verb in the adapter; an orphaned `t3_` post is recorded in `ad_status_events.external_ids.orphaned_post_id`. [R-5, GR-10]

**Targeting**
- **AC-R-15** Gate G-4 passes: serializer output keys ⊆ the allowlist; `age_min`/`age_max` unrepresentable; property test over arbitrary normalized-targeting inputs. [R-8, GR-31]
- **AC-R-16** `gender` emitted only as `FEMALE`, `MALE`, or `null`; any other normalized gender input → `null` + warn. [reddit.md §3.2]
- **AC-R-17** Communities flow from `targeting.passthrough.reddit`, plain names with any `r/` prefix stripped; default `excluded_communities:["politics"]` applied when the admin sets none. [GR-31, PIPELINE_BLUEPRINT §1.3d]
- **AC-R-18** Cap 422s: 20,001 geolocations, 201 interests, 1,001 keywords, 2,001 excluded_keywords, 6 view_modes — each rejected pre-flight with the limit named. [reddit.md §3.2]
- **AC-R-19** `POST /targeting/keyword_validations` and `POST /targeting/geolocations_validations` are called **before** ad-group create whenever keywords/geos are present; a validation failure blocks the create and surfaces the provider response. [GR-31]
- **AC-R-20** Community search sends **`query=`** (never `q=`); results are served from a ≥24 h server-side cache on repeat queries; on a mocked `RateLimit: r=0` header the client backs off to the reset window. [R-P6, GR-71]
- **AC-R-21** Defaults: `locations:["FEED","COMMENTS_PAGE"]`, `view_modes:["CARD","IMMERSIVE"]`; selecting `COMPACT`/`CLASSIC` produces the thumbnail warning. [GR-69]

**Creative + copy**
- **AC-R-22** Gate G-2 passes; the offering→CTA map returns `Buy Tickets`/`Book Now`/`See Menu`/`Get Directions`/`Remind Me`/`Learn More` for the six offering classes; a CTA outside the 24-string enum → 422 `invalid_cta`. [GR-29]
- **AC-R-23** Copy validator: headline 301 chars → hard-block; 101 and 81 → the two distinct warns; ALL-CAPS headline → hard-block; caption 181 → hard-block; body 40,001 → hard-block; name 2 and 501 chars → hard-block; click_url 5,001 → hard-block; 15 query params → hard-block. [GR-28, reddit.md §5.1]
- **AC-R-24** Destination policy: `display_url` domain ≠ destination domain → 422; a `go.usemingla.com` or `*.onelink.me` destination URL → 422 with the bridge-page explanation. **No OneLink can reach a Reddit create body.** [D-P1, GR-32]
- **AC-R-25** VIDEO creative without `thumbnail` → 422; carousel with 0 or 7 cards → 422 (1–6 [SPEC]); a [3P] media constraint (e.g. image > 3 MB) produces a **warn, never a block**; a mocked `INVALID_MEDIA` response surfaces `errors[].message` character-for-character with no parsing. [reddit.md §4.2/§5, GR-22]

**Review sync**
- **AC-R-26** `effective_status` mapping per §6.1 including all four billing/identity/permission states → `delivery_status` warnings; a `REJECTED` ad persists `rejection_reason` verbatim into `review_detail` — including the literal enum string `FACILIATE_ILLEGAL_FRAUDULENT_OR_MISLEADING_BEHAVIOR` (test asserts the typo is preserved). [R-3, GR-18]
- **AC-R-27** Sync scheduling: with a `PENDING` Reddit ad the sync runs on the 30–60 min cadence; poll calls stay within the 400 reads/60 s pool (batch reads via list endpoints where >1 ad is pending). [GR-71, PIPELINE_BLUEPRINT §1.9a]

**Gates**
- **AC-R-28** Gate G-1 **fails on revert**: deleting the `configured_status` key from any one of the three body builders breaks CI. [GR-11]
- **AC-R-29** Gates G-2, G-3, G-4 run in the standard CI suite and each fails when its guarded behavior is reverted (uppercase the CTA; change ×10,000 to ×1,000; add an `age_min` emit; switch `query=` to `q=`). [GR-29, GR-01, R-8, R-P6]

**Total: 29 ACs.**

---

## §10 · Out of scope + open questions

### 10.1 Deferred — with the reason on record

| Item | Status | Why |
|---|---|---|
| **Reddit CAPI** (`POST /pixels/{pixel_id}/conversion_events`) | **Pending #865 scope decision** | We hold `adsread adsedit` only; CAPI needs **`adsconversions`** — a **re-consent** (re-run the authorize URL with `adsread,adsedit,adsconversions,adsmeasurement:read,adsmeasurement:write` + `duration=permanent`), not a config change (GR-30). Note CAPI has unique rate limits and emits **no** `RateLimit` headers. **Open question:** whether Reddit CAPI enters #865's scope at all, and whether the re-consented refresh token replaces `REDDIT_ADS_REFRESH_TOKEN` or lands as a separate Events-Manager-style secret (the `extra.capi_env_var` slot A3 reserved, name TBD). Today #865 does not cover Reddit — decide before the re-consent. |
| **Lead generation** | **Never** | On-site forms no longer supported; the form API **sunsets 2026-09-30**; `LEAD_GENERATION` is rejected at the adapter (§3.3). |
| **Catalog / DPA / shopping** | **Never (no catalog exists)** | `CATALOG_SALES`, `product_set_id`, `shopping_creative` all unbuilt; adapter rejects the objective. |
| **Max campaigns** | Not possible | "Max campaigns creation isn't currently supported in the Reddit Ads API" [SPEC]. |
| **Custom/saved audiences, lookalikes, third-party audiences** | v1 passthrough only | No ingestion/picker; retargeting audiences are additionally blocked on the `adsconversions` scope. |
| **Business lane** | When provisioned | `UNIQUE (platform, lane)` already supports it; the business OneLink is dead on Android and irrelevant here anyway (§5.4). |
| **Nigeria market** | Routed away | GR-72 — no NGN, no Nigerian language (§4.6). |

### 10.2 Open questions (could not be resolved from sources)

1. **The real media pixel/byte/duration constraints.** Reddit's official ad-unit spec page (S8) is a JS-gated Salesforce SPA; [3P] sources contradict each other. Human unblock: read it in a real browser or ask `adsapi-partner-support@reddit.com` — until then all media numbers stay warn-only (§5.5).
2. **Review SLA.** Published nowhere. Poll and measure empirically (§6.3).
3. **Whether a daily-budget floor exists server-side.** Not in the OpenAPI spec (`goal_value: minimum: 0`); deliberately unencoded — the first live create at a low budget answers it, and the 400 (if any) is surfaced verbatim (GR-59).
4. **The CAPI scope/token question** — see the table above (re-consent target + #865 ownership).
5. **GitHub issue number** — TBD at build dispatch; retitle this file's header when assigned.
6. **Objective-migration timing.** `CLICKS`→`CLICKS` is stable, but re-pull and diff `reddit-ads-api-v3.yaml` after **2026-09-30** (migration + lead-gen sunset) before touching the objective map (GR-70).

---

*End of spec. Downstream: `mingla-implementor` builds `_shared/reddit.ts` + the connect/create/sync wiring against A3/A4; `mingla-tester` verifies AC-R-1…AC-R-29; the supervised live-fire create runs PAUSED and is rolled back via `PATCH configured_status:"DELETED"`.*
