# SPEC — TikTok Ads API Integration: create & manage campaigns

**Issue:** GitHub #863 (child of initiative #852 "[Full Rooms] Internal Ad & Reservation Engine")
**Mode:** SPEC (grounded in a live READ-ONLY probe of the connected `tiktok-ads` MCP against advertiser `7627974536397766673`)
**Worktree:** `~/Desktop/mingla-orchs/issue-863-tiktok-ads-api/` on branch `issue-863-tiktok-ads-api`
**Downstream routing:** this SPEC → `mingla-implementor` → `mingla-tester` → orchestrator CLOSE
**Author:** mingla-forensics · **Date:** 2026-07-15
**Sibling specs mirrored:** #862 Meta Ads Campaign Engine (THE structural template — this spec mirrors its 11 sections), #864 Campaign Builder UI (drives this engine), #865 Attribution Engine (owns TikTok Events API / conversions — NOT here).

> **User story:** "As a Mingla admin, I can connect TikTok (Marketing API) and create/launch/pause ad campaigns from our admin, so we can drive traffic to specific public pages — the same way #862 does for Meta."

> **Ledger:** COMMS-0096 (WARN→ALL, release-config parity gates) factored in — this spec changes **no** `app.json`/`eas.json`/store-submit config; both CI gates (`I-RELEASE-VERSION-PARITY`, `I-RELEASE-SUBMIT-CONFIG`) remain untouched (§9, §10 DO-NOT-TOUCH).

---

## 1. Executive summary

Build the **second channel** of Mingla's internal Ad Engine: a **TikTok Marketing-API** integration, driven from **Admin Web** (`mingla-admin`, via #864's builder) and backed by Supabase **edge functions + DB**. An admin can (1) connect Mingla's TikTok advertiser, (2) create a campaign → ad group → ad in one atomic action, (3) set budget & audience, (4) launch and pause it, and (5) have the TikTok IDs, live status, and destination public-page reference persisted in our DB — exactly the capability set #862 delivered for Meta.

This story does the coherent thing #862 foreshadowed: instead of a parallel `tiktok_*` schema, it **generalizes** the ad-engine data model to a single **platform-agnostic** table set (`ad_connections`, `ad_campaigns`, `ad_sets`, `ads`) keyed by a `platform` discriminator + `lane`, behind a shared **`ChannelAdapter`** interface. TikTok is implemented in `_shared/tiktok.ts`; Meta's `_shared/meta.ts` conforms to the same interface (§10 dependency). One set of edge functions (`admin-ads-*`) serves every channel; the caller passes `platform` + `lane`.

The build follows the **exact server-side pattern already used by Stripe, Paystack, AppsFlyer, and #862/Meta**: the TikTok credential (our own long-lived **Marketing-API access token**) lives only in **Supabase Edge Function Secrets** (`Deno.env`), never in the DB, never in any client; the DB stores only non-secret TikTok IDs + status. All writes are **admin-only** and **fail-close** when the connection is missing or invalid.

**Live-probe verdict (§4.0):** the **standard campaign API** (`campaign/create` → `adgroup/create` → `ad/create`) is the correct primary surface — it supports the full **TRAFFIC** objective with granular budget/targeting/creative control matching #864's builder. TikTok **Smart+** (`smart_plus_*`) does **not** offer a traffic objective (`objective_type ∈ {APP_PROMOTION, WEB_CONVERSIONS, LEAD_GENERATION}` only) and its `WEB_CONVERSIONS` path requires the pixel + conversion events that are #865's job — so Smart+ is deferred to an **optional future path**, not the MVP.

Attribution/conversions (TikTok **Events API**, pixel install), the campaign-builder UX, the creative library, and Snapchat/Google are **out of scope** (siblings #865, #864, #866, #867).

---

## 2. Scope & non-goals

### In scope (this story only)
1. **Connect** Mingla's TikTok advertiser — validate the server-side Marketing-API access token against the live advertiser + confirm the `identity` and (non-secret) pixel; persist a platform-agnostic connection record.
2. **Create** a campaign + ad group + ad in one atomic operation (all created **PAUSED** / `operation_status=DISABLE`).
3. **Set budget & audience** — daily/lifetime budget; geo (country → TikTok `location_ids`) + age + gender targeting.
4. **Launch / pause** a campaign from admin (top-down status update).
5. **Persist** TikTok campaign/adgroup/ad IDs + operation status + delivery/effective status + the destination public-page reference (+ smart link).
6. **Generalize** the ad-engine schema + edge surface to be platform-agnostic (`ad_connections`/`ad_campaigns`/`ad_sets`/`ads` + `ChannelAdapter`), so #862/Meta and #863/TikTok share one model and #867 (Snap/Google) plugs in later.

### Non-goals (explicitly NOT built here — separate sibling issues)
- **Campaign-builder UX** (the multi-step visual builder) → **#864**. This spec ships a functional-but-minimal admin surface to exercise 1–5 and, critically, the **generalized create endpoint #864 calls**. The polished builder is #864.
- **Attribution / conversion tracking / TikTok Events API / pixel install** → **#865**. TikTok conversions (`/event/track/`, the `TIKTOK_EVENTS_ACCESS_TOKEN`, pixel `7662469356818858002` install, `custom_conversion` and retargeting audiences) live entirely in #865. THIS story creates & manages campaigns only; it does **not** fire or read conversion events, and it does **not** require the pixel (traffic optimization does not use it — §4.0).
- **Creative library** (browse/reuse venue media) → **#866**. MVP takes **one image (or one video) per ad**, supplied at create time as a URL that the adapter uploads to TikTok's Asset Library.
- **Snapchat / Google** channels → **#867** (the generalized model reserves `platform` slots for them; no Snap/Google code here).
- **Consumer app, business app, buyer web, business-web preview** behavior. Public web is a **destination reference only** — the URL a campaign points at. No code changes to those surfaces.

### Assumptions
- Mingla manages **only its own** TikTok advertiser (no per-client / agency multi-tenant OAuth) → a single org-level long-lived access token is correct (mirrors #862 OD-1; see §11 OD-1).
- The hosted `tiktok-ads` MCP used to author this spec is a **per-user OAuth exploration tool only**; production control uses Mingla's **own** TikTok Business app + long-lived access token (hard constraint — §6, §7).
- #862 is merged (or co-developed on a stacked branch). The generalized tables either **replace** #862's `meta_*` tables via a coordinated migration (RECOMMENDED — §11 OD-2) or are mirrored; either way the create-endpoint contract #864 consumes gains a `platform` field (§4.5, §11 OD-2).
- The **two-lane** model from #862 A2 holds: **consumer** ads → public pages / AppsFlyer smart link; **business** ads → Mingla Business signup/claim (business lane provisioned later).

---

## 3. Cross-Surface Impact Declaration (MANDATORY)

| # | Surface | Covered? | User-visible behavior demanded | Files touched here | Parity |
|---|---------|----------|-------------------------------|--------------------|--------|
| 1 | Consumer iOS (`app-mobile/` iOS) | **No** | none | none | n/a — engine is admin/back-office only |
| 2 | Consumer Android (`app-mobile/` Android) | **No** | none | none | n/a |
| 3 | Buyer/anonymous Web (`mingla-business` `/e/…`, `/b/…`, `/t/…`, `/checkout/…`) | **Reference only** | Public page is the campaign **destination**; the live public URL is read (never written) to build the ad's `landing_page_url` (smart link) | none (reads `business_public_events_view`) | n/a — read-only consumer of existing public contract |
| 4 | Business iOS | **No** | none | none | n/a |
| 5 | Business Android | **No** | none | none | n/a |
| 6 | **Admin Web** (`mingla-admin/`) | **YES — primary** | Connect TikTok; create/launch/pause TikTok campaigns; see status; #864's builder gains the TikTok channel | `mingla-admin/src/**` (service + hook + minimal Ad-Engine surface; #864 owns the full builder) | Single surface — no cross-platform parity concern |
| 7 | Business Web preview (adjacent) | **No** | none | none | n/a |
| — | **Backend** (`supabase/`) | **YES — primary** | generalized tables + RLS, `admin-ads-*` edge functions, `_shared/tiktok.ts` + `_shared/adChannel.ts`, secrets | `supabase/migrations/**`, `supabase/functions/admin-ads-*/**`, `supabase/functions/_shared/{adChannel,tiktok}.ts`, `supabase/config.toml` | Server-authoritative |

**Why each NOT-covered surface is out:** the Ad Engine is an internal back-office tool. It runs paid campaigns *pointing at* already-live public pages; it does not modify what consumers or businesses see. Public web is touched only as a **read** of the existing immutable slug contract (identical to #862).

---

## 4. Layered specification

### 4.0 "What's buildable" — LIVE MCP probe evidence (read-only, 2026-07-15)

All values below are **real responses** from the connected `tiktok-ads` MCP against advertiser **`7627974536397766673`**. No write/create/spend tool was called. TikTok Business API base = `https://business-api.tiktok.com/open_api/v1.3/…`; auth header = **`Access-Token: <token>`** (not Bearer); every response is `{ code, message, request_id, data }` where **`code === 0` = success** (non-zero = error → normalize `{code, message, request_id}`).

**Advertiser (`advertiser_info_get`):**
`advertiser_id=7627974536397766673`, `name="Mingla LLC_adv"`, `company="MINGLA LLC"`, `currency=USD`, `country=US`, `timezone=Etc/GMT+5` (`display_timezone=America/New_York`), `advertiser_account_type=AUCTION`, `status=STATUS_ENABLE` (**ACTIVE**), `owner_bc_id=7627974686760009729`.
→ **`balance` reads `0.0` in the Marketing API.** Per `MINGLA_MASTER_KEYS.md`, the account holds **$10 prepaid** in the Advanced Payment Portfolio, which the API `balance` field does **not** reflect — **UI is source of truth**. Account budget cap = Unlimited, so the prepaid balance is the effective spend cap. **Flag (§7):** $10 is below one day of TikTok's minimum ad-group budget → top up before live-fire.

**Identity (`identity_get`) — REQUIRED for `ad_create`, and it EXISTS:**
Exactly one identity: `identity_id="b3f0f8f4-1beb-5c23-8a2c-9f440cec58a5"`, `username="usemingla"`, `display_name="usemingla"`, `identity_type="TT_USER"`, `available_status="AVAILABLE"`, `can_push_video=true`, `can_pull_video=true`.
→ **Ad creation is UNBLOCKED** — the required creative fields `identity_type=TT_USER` + `identity_id=b3f0f8f4-…` are already provisioned (the @usemingla TikTok account is authorized for ads). Store on the connection at connect-time (resolved via `identity_get`).

**Pixel (`pixel_list_get`) — confirmed, NOT needed by this story:**
One pixel: `pixel_id="7662469356818858002"`, `pixel_name="Mingla Web"`, `pixel_code="D9B98EBC77U1EOHV2O0G"` (public — embedded in the client `ttq` script), `pixel_setup_mode="DEVELOPER"`, `enable_first_party_cookies=true`, `activity_status="NO_RECENT_ACTIVITY"` (not yet installed), `events=[]`.
→ Recorded on the connection for #865's benefit. **Traffic campaigns do not use it** — `adgroup_create.pixel_id` is "Required when `optimization_goal` is `CONVERT` or `VALUE`. Not supported" otherwise (live schema). Pixel install + conversion events = #865.

**Custom conversions (`custom_conversion_list_get`):** returned `code 40002 "event_source_type: value is required but missing"` — requires an `event_source_type` param not relevant to campaign create. Custom conversions are a **#865** concern; noted, not used here.

**Custom audiences (`dmp_custom_audience_list_get`):** `total_number: 0` — **none provisioned.** MVP targets by **geo + age + gender only** (broad); `audience_ids`/`saved_audience_id`/retargeting are #865 Phase B. (Mirrors #862's "geo+age only for MVP" decision.)

**Create-field contracts — the EXACT fields the standard Marketing API requires/accepts (from the live `tool_get` schemas):**

- **Campaign** (`campaign_create`, `POST /campaign/create/`) — **required:** `advertiser_id`, `campaign_name`, `objective_type`. **Budget/used:** `budget` (number, **major currency units — dollars, NOT cents**), `budget_mode` ∈ `{BUDGET_MODE_INFINITE, BUDGET_MODE_TOTAL, BUDGET_MODE_DYNAMIC_DAILY_BUDGET, BUDGET_MODE_DAY}`, `budget_optimize_on` (boolean = **CBO** toggle), `operation_status` ∈ `{ENABLE, DISABLE}` (**create `DISABLE` = paused**), `campaign_type` ∈ `{REGULAR_CAMPAIGN, IOS14_CAMPAIGN}` (use `REGULAR_CAMPAIGN`), `special_industries` (array), `objective_type` for a traffic/reach campaign = **`TRAFFIC`** (standard TikTok objective; description = "Advertising objective"). Accepts `request_id` for **native idempotency**.
- **Ad group** (`adgroup_create`, `POST /adgroup/create/`) — **required:** `adgroup_name`, `advertiser_id`, `campaign_id`, `billing_event`, `budget`, `budget_mode` ∈ `{BUDGET_MODE_TOTAL, BUDGET_MODE_DYNAMIC_DAILY_BUDGET, BUDGET_MODE_DAY}`, `optimization_goal`, `pacing` ∈ `{PACING_MODE_SMOOTH, PACING_MODE_FAST}`, `schedule_type` ∈ `{SCHEDULE_START_END, SCHEDULE_FROM_NOW}`, `schedule_start_time` (`"YYYY-MM-DD HH:MM:SS"` in the advertiser timezone).
  - **`optimization_goal` (live enum):** `CLICK, INSTALL, IN_APP_EVENT, SHOW, REACH, LEAD_GENERATION, CONVERSATION, FOLLOWERS, PAGE_VISIT, VALUE, AUTOMATIC_VALUE_OPTIMIZATION, ENGAGED_VIEW, ENGAGED_VIEW_FIFTEEN, TRAFFIC_LANDING_PAGE_VIEW, DESTINATION_VISIT, PREFERRED_LEAD`. → For traffic-to-a-page use **`CLICK`** (default, cheaper) or **`TRAFFIC_LANDING_PAGE_VIEW`** (higher intent — recommended, the TikTok analog of Meta's `LANDING_PAGE_VIEWS`; §11 OD-4).
  - **`billing_event`** (enum via TikTok "Billing Event" reference; each optimization goal has a required billing event) → for `CLICK`/`TRAFFIC_LANDING_PAGE_VIEW` use **`CPC`**.
  - **Targeting fields:** `location_ids` (array of **numeric TikTok location IDs** — you MUST set `location_ids` or `zipcode_ids`; overlapping locations not allowed; country codes are NOT accepted — resolve via TikTok's targeting/region tool, §4.3), `age_groups` (array of TikTok buckets, e.g. `AGE_18_24 … AGE_55_100`), `gender` ∈ `{GENDER_FEMALE, GENDER_MALE, GENDER_UNLIMITED}`, `languages`, `interest_category_ids`, `audience_ids`/`excluded_audience_ids`/`saved_audience_id`.
  - **Placement:** `placement_type` ∈ `{PLACEMENT_TYPE_AUTOMATIC, PLACEMENT_TYPE_NORMAL}`; `placements` (array) ∈ `{PLACEMENT_TIKTOK, PLACEMENT_PANGLE, PLACEMENT_GLOBAL_APP_BUNDLE}` (required when `PLACEMENT_TYPE_NORMAL`; `PLACEMENT_TOPBUZZ`/`PLACEMENT_HELO` deprecated). MVP → `PLACEMENT_TYPE_NORMAL` + `placements=["PLACEMENT_TIKTOK"]` (TikTok feed only; §11 OD-5).
  - **`pixel_id`** — "Required when `optimization_goal` is `CONVERT` or `VALUE`. Not supported when neither" → **omitted for our traffic MVP** (confirms pixel is #865).
  - `promotion_target_type` ∈ `{INSTANT_PAGE, EXTERNAL_WEBSITE}` (valid only for `objective_type=LEAD_GENERATION`) — not used by traffic MVP. `operation_status ∈ {ENABLE, DISABLE}` (create `DISABLE`). Accepts `request_id`.
- **Ad** (`ad_create`, `POST /ad/create/`) — **required:** `advertiser_id`, `adgroup_id`, `creatives` (array, **max 20/call**). Each `creatives` item **required:** `ad_name`, `identity_type` ∈ `{CUSTOMIZED_USER, AUTH_CODE, TT_USER, BC_AUTH_TT}`, `identity_id`, `ad_format` ∈ `{SINGLE_IMAGE, SINGLE_VIDEO, LIVE_CONTENT, CAROUSEL_ADS, CATALOG_CAROUSEL}`. **Used:** `image_ids` (array — Asset-Library image IDs) **or** `video_id` (string), `ad_text` (primary text), `call_to_action` / `call_to_action_id`, `landing_page_url` (the destination — **our smart link**), `deeplink`/`deeplink_type` ∈ `{NORMAL, DEFERRED_DEEPLINK}` (app deep-linking; #865 attribution), `click_tracking_url`/`impression_tracking_url`/`utm_params` (tracking — #865), `page_id` (Instant Page — not used), `operation_status ∈ {ENABLE, DISABLE}`. → MVP: **`ad_format=SINGLE_IMAGE`**, `identity_type=TT_USER`, `identity_id=b3f0f8f4-…`, `image_ids=[<uploaded id>]`, `ad_text`, `call_to_action`, `landing_page_url=<smart link>`.
- **Creative media upload** (`file_image_ad_upload`, `POST /file/image/ad/upload/`) — a single image must live in the advertiser's **Asset Library** before `ad_create` can reference it. Upload the #864 bucket URL (`upload_type=UPLOAD_BY_URL`, `image_url=<public bucket URL>`) → returns an **`image_id`** (TikTok's analog of Meta's `image_hash`). Video ads use `file_video_ad_upload` → `video_id` (deferred; SINGLE_IMAGE MVP).
- **Budget units & minimums:** TikTok `budget` is a **decimal number in the account currency (USD dollars)** — NOT integer cents. Our DB normalizes to **minor units (cents)** for cross-platform parity with #862; the TikTok adapter converts cents → dollars (÷100) at the API boundary. **TikTok enforces a server-side minimum daily budget** (per TikTok docs, historically ≈ **USD $20/day per ad group** for auction and ≈ **$50/day per campaign** for CBO); the exact current minimum is **not** returned by `advertiser_info_get` — the create call returns a validation error below it. Read/handle at implement; surface the error verbatim. **Our $10 prepaid balance is below one day's minimum → §7 funding action.**
- **Launch / pause / delete:** every entity is created **`DISABLE` (paused)**; activation is **top-down** (campaign → ad group → ad), each set `ENABLE` via `campaign_status_update` / `adgroup_status_update` / `ad_status_update` (a paused parent blocks a child's delivery). Pause = set `DISABLE`. Compensating cleanup on partial-create failure = `campaign_status_update` `operation=DELETE` (cascades to children).
- **Status read:** `campaign_get` / `adgroup_get` / `ad_get` return `operation_status` (advertiser-set: `ENABLE`/`DISABLE`) AND a delivery/`secondary_status` (e.g. review states, `AUDIT`, `NOT_START`, `DELIVERY_OK`, `NO_BUDGET`, `BALANCE_EXCEED`) — **persist BOTH** (mirrors Meta's `status` vs `effective_status`; the "no funds" state is TikTok's analog of Meta `PENDING_BILLING_INFO`).

**Smart+ path — probed, and DEFERRED (evidence for the decision):**
`smart_plus_campaign_create` **`objective_type` enum = `{APP_PROMOTION, WEB_CONVERSIONS, LEAD_GENERATION}` only** — there is **no** traffic/reach objective. `smart_plus_adgroup_create` requires `targeting_spec, bid_type, promotion_type, request_id` and its `optimization_goal ∈ {CLICK, INSTALL, IN_APP_EVENT, VALUE, CONVERT, TRAFFIC_LANDING_PAGE_VIEW, CONVERSATION, LEAD_GENERATION}`, with placements auto-configured. → **Smart+ cannot express "drive traffic to a public page"**; its `WEB_CONVERSIONS` route depends on the pixel + conversion events (#865). **Decision (§11 OD-3): standard API primary; Smart+ optional future path once #865's pixel/CAPI is live** and we want automated conversion-optimized delivery. The `ChannelAdapter` interface leaves room to add a `smart_plus` sub-adapter without schema change.

**Reporting fields (for FUTURE #865 — recorded, not built):** `report_integrated_get` exposes spend, impressions, clicks, CPC, CPM, CTR, reach, conversions, cost-per-conversion, plus `advertiser_transaction_get`/`advertiser_balance_get` for spend/balance. #865 (not this story) reads these for ROAS.

---

### 4.1 Architecture & data flow

```
Admin (mingla-admin, React+Vite; #864 builder passes { platform:'tiktok', lane })
   │  authenticated fetch (Bearer JWT)
   ▼
Supabase Edge Function  admin-ads-*  (verify_jwt=true  →  in-code admin_users gate)
   │  resolve ChannelAdapter by platform  →  adapter reads Deno.env[connection.token_env_var]
   │  (fail-close if token unset/invalid — never call TikTok without it)
   ├──────────────► TikTok Marketing API  https://business-api.tiktok.com/open_api/v1.3/...
   │                 header Access-Token: <TIKTOK_ACCESS_TOKEN>
   │                 (upload image → create campaign/adgroup/ad; set status; read status)
   │  service-role client (SUPABASE_SERVICE_ROLE_KEY)
   ▼
Supabase DB  ad_connections · ad_campaigns · ad_sets · ads · ad_campaign_status_events
             (RLS: admin read, service-role write; row keyed by platform + lane)
   │
   └─ destination resolved (READ-ONLY) from business_public_events_view → dest_url + dest_smart_link (OneLink)
```

**Invariants of the flow:** (a) the token never leaves the edge runtime; (b) the client never receives the token or calls TikTok directly; (c) an `ad_campaigns` (+`ad_sets`+`ads`) row set is written **only after all three TikTok IDs exist** (no orphan rows); (d) every state-changing call is gated by `is_admin_user()`; (e) a missing/invalid connection **stops** create/launch (fail-close), it does not silently no-op; (f) `request_id` idempotency prevents a retried create from double-spending.

### 4.2 Database layer — **generalized, platform-agnostic** (generalizes #862's `meta_*` — §10 / §11 OD-2)

New migration `supabase/migrations/<ts>_issue_863_ad_engine_generalized.sql` (timestamp AFTER the latest existing migration; verify `ls supabase/migrations | tail`). House pattern: RLS enabled, admin-read via `is_admin_user()`, writes service-role-only, `updated_at` triggers. **No token column — ever** (any table).

**Table `public.ad_connections`** — one row per `(platform, lane)`.
```
id                     uuid PK default gen_random_uuid()
platform               text NOT NULL CHECK (platform IN ('meta','tiktok','snapchat','google'))
lane                   text NOT NULL CHECK (lane IN ('consumer','business'))
account_id             text NOT NULL            -- TikTok advertiser_id '7627974536397766673' | Meta ad_account_id
business_center_id     text NULL                -- TikTok BC '7627974686760009729' | Meta business_id
identity_ref           text NULL                -- TikTok identity_id 'b3f0f8f4-…' | Meta page_id
identity_type          text NULL                -- TikTok 'TT_USER' | NULL for Meta
pixel_ref              text NULL                -- TikTok pixel_id '7662469356818858002' | Meta dataset/pixel id (informational; #865 owns)
currency               text NOT NULL            -- 'USD'
timezone               text NULL                -- TikTok 'America/New_York'
min_daily_budget_cents integer NULL             -- normalized minor units; NULL if platform doesn't expose it (TikTok — validated at create)
account_status         text NULL                -- 'STATUS_ENABLE' | Meta 'ACTIVE'/'UNSETTLED'
has_funds              boolean NULL             -- best-effort (TikTok balance/UI is source of truth)
token_env_var          text NOT NULL            -- Supabase secret NAME, e.g. 'TIKTOK_ACCESS_TOKEN' (NEVER the value)
token_status           text NOT NULL DEFAULT 'unknown' CHECK (token_status IN ('valid','invalid','unknown'))
token_last_verified_at timestamptz NULL
connected              boolean NOT NULL DEFAULT false
connected_by           uuid NULL REFERENCES auth.users(id)
created_at             timestamptz NOT NULL DEFAULT now()
updated_at             timestamptz NOT NULL DEFAULT now()
UNIQUE (platform, lane)
-- COMMENT: 'Ad-platform access tokens live ONLY in Supabase Edge Function Secrets (Deno.env, resolved via token_env_var), NEVER in this table.'
```

**Table `public.ad_campaigns`** — one row per campaign, written only when the full campaign→adgroup→ad set is created.
```
id                    uuid PK default gen_random_uuid()
connection_id         uuid NOT NULL REFERENCES public.ad_connections(id) ON DELETE RESTRICT
platform              text NOT NULL            -- denormalized for query/index; must equal connection.platform
external_campaign_id  text NOT NULL            -- TikTok campaign_id | Meta campaign id
name                  text NOT NULL
objective             text NOT NULL            -- TikTok 'TRAFFIC' | Meta 'OUTCOME_TRAFFIC'
budget_level          text NOT NULL CHECK (budget_level IN ('campaign','adset'))  -- CBO vs ABO
budget_type           text NOT NULL CHECK (budget_type IN ('daily','lifetime','infinite'))
budget_amount_cents   integer NULL CHECK (budget_amount_cents IS NULL OR budget_amount_cents > 0)  -- minor units; NULL when infinite (budget on adset)
status                text NOT NULL DEFAULT 'PAUSED' CHECK (status IN ('PAUSED','ACTIVE','ARCHIVED','DELETED'))  -- normalized
external_status       text NULL                -- raw operation_status ('ENABLE'/'DISABLE')
delivery_status       text NULL                -- raw secondary/effective status read back
status_synced_at      timestamptz NULL
targeting             jsonb NOT NULL DEFAULT '{}'   -- normalized {countries, age_min, age_max, genders}
request_id            text NOT NULL            -- idempotency key sent to the platform create call
-- destination public-page reference (the point of Full Rooms):
dest_page_type        text NOT NULL CHECK (dest_page_type IN ('event','trip','brand','venue'))
dest_brand_slug       text NOT NULL
dest_entity_slug      text NULL
dest_event_id         uuid NULL REFERENCES public.events(id) ON DELETE SET NULL
dest_url              text NOT NULL            -- canonical public web page (fallback/reference)
dest_smart_link       text NOT NULL            -- AppsFlyer OneLink used as the ad landing_page_url (opens app if installed, else dest_url) + attribution
created_by            uuid NULL REFERENCES auth.users(id)
created_at            timestamptz NOT NULL DEFAULT now()
updated_at            timestamptz NOT NULL DEFAULT now()
UNIQUE (platform, external_campaign_id)
UNIQUE (connection_id, request_id)   -- idempotency: a repeated request_id cannot create a second campaign row
```

**Table `public.ad_sets`** — one row per ad group (= TikTok adgroup / Meta adset).
```
id                    uuid PK default gen_random_uuid()
campaign_id           uuid NOT NULL REFERENCES public.ad_campaigns(id) ON DELETE CASCADE
external_adset_id     text NOT NULL            -- TikTok adgroup_id | Meta adset_id
name                  text NOT NULL
optimization_goal     text NOT NULL            -- TikTok 'TRAFFIC_LANDING_PAGE_VIEW'/'CLICK' | Meta 'LANDING_PAGE_VIEWS'
billing_event         text NOT NULL            -- TikTok 'CPC' | Meta 'IMPRESSIONS'
budget_type           text NULL CHECK (budget_type IS NULL OR budget_type IN ('daily','lifetime'))  -- NULL when CBO (budget on campaign)
budget_amount_cents   integer NULL CHECK (budget_amount_cents IS NULL OR budget_amount_cents > 0)
placement             jsonb NOT NULL DEFAULT '{}'   -- {placement_type, placements}
schedule_start_at     timestamptz NULL
schedule_end_at       timestamptz NULL
status                text NOT NULL DEFAULT 'PAUSED'
external_status       text NULL
UNIQUE (external_adset_id)
```

**Table `public.ads`** — one row per ad.
```
id                    uuid PK default gen_random_uuid()
ad_set_id             uuid NOT NULL REFERENCES public.ad_sets(id) ON DELETE CASCADE
external_ad_id        text NOT NULL            -- TikTok ad_id | Meta ad_id
external_creative_id  text NULL                -- Meta creative_id; NULL for TikTok (creative is inline in ad_create)
name                  text NOT NULL
ad_format             text NULL                -- TikTok 'SINGLE_IMAGE' | Meta creative type
identity_ref          text NULL                -- TikTok identity_id used
media_ref             text NULL                -- TikTok image_id (Asset Library) | Meta image_hash
landing_page_url      text NOT NULL            -- the smart link
call_to_action        text NULL
status                text NOT NULL DEFAULT 'PAUSED'
external_status       text NULL
UNIQUE (external_ad_id)
```

**Table `public.ad_campaign_status_events`** — append-only audit (generalizes #862's `meta_campaign_status_events`).
```
id            uuid PK default gen_random_uuid()
campaign_id   uuid NULL REFERENCES public.ad_campaigns(id) ON DELETE CASCADE  -- NULL if create failed before a row existed
platform      text NULL
action        text NOT NULL CHECK (action IN ('create','launch','pause','sync','create_failed','rollback'))
actor         uuid NULL REFERENCES auth.users(id)
from_status   text NULL
to_status     text NULL
external_ids  jsonb NULL         -- partial IDs captured on failure for manual reconciliation
provider_response jsonb NULL     -- normalized platform response (NEVER contains the token)
created_at    timestamptz NOT NULL DEFAULT now()
```

**RLS (all five tables):** `ENABLE ROW LEVEL SECURITY`.
- `SELECT`: `USING ( public.is_admin_user() )` for `authenticated`. **Per-lane/brand read** note: an admin sees all; when the business-proof surface later needs per-brand reads, scope by `dest_event_id → events.brand_id` (deferred; #865). The invariant "a brand reads only its own" is honored today because **only admins read** (no brand-facing read path exists in this story) — the RLS is admin-gated and there is no policy exposing rows to non-admin `authenticated` users.
- `INSERT`/`UPDATE`/`DELETE`: **no policy for `authenticated`** (service-role bypasses RLS; only the admin-gated edge functions write). Matches `payment_webhook_events`.
- `GRANT SELECT` to `authenticated`; no direct write grants.

**Indexes:** `ad_campaigns (connection_id)`, `ad_campaigns (platform, status)`, `ad_campaigns (dest_event_id)`, `ad_sets (campaign_id)`, `ads (ad_set_id)`, `ad_campaign_status_events (campaign_id, created_at DESC)`.

### 4.3 Shared edge modules — `_shared/adChannel.ts` (NEW) + `_shared/tiktok.ts` (NEW)

**`_shared/adChannel.ts`** — the platform-agnostic contract + adapter registry.
```
export interface ChannelAdapter {
  platform: 'meta' | 'tiktok';
  resolveToken(conn): string;                         // Deno.env.get(conn.token_env_var); throw AdNotConnectedError if unset (fail-close)
  connect(conn): Promise<ConnectionInfo>;             // verify token + read account/identity/pixel/currency/status
  uploadImage(conn, imageUrl): Promise<string>;       // → media_ref (TikTok image_id / Meta image_hash)
  resolveGeo(conn, countries[]): Promise<string[]>;   // → platform location refs (TikTok location_ids / Meta geo)
  createCampaign(conn, spec): Promise<{ externalId; externalStatus }>;
  createAdGroup(conn, campaignExtId, spec): Promise<{ externalId }>;
  createAd(conn, adgroupExtId, spec): Promise<{ externalId; creativeId? }>;
  setStatus(conn, level: 'campaign'|'adset'|'ad', extId, status: 'ACTIVE'|'PAUSED'|'DELETE'): Promise<void>;
  getStatus(conn, level, extId): Promise<{ status; deliveryStatus }>;
}
export function getAdapter(platform): ChannelAdapter   // registry: { tiktok: tiktokAdapter, meta: metaAdapter }
export class AdNotConnectedError extends Error {}       // → 424 meta/tiktok_not_connected
export class AdApiError extends Error {}                // normalized { code, message, request_id }
```
`_shared/meta.ts` (from #862) is refactored to **implement `ChannelAdapter`** (§10 dependency); its existing logic is unchanged, only re-shaped behind the interface.

**`_shared/tiktok.ts`** — TikTok implementation (mirrors `_shared/paystack.ts`/`_shared/meta.ts`: secret resolver + typed client + fail-close).
- `resolveToken(conn)` → `Deno.env.get(conn.token_env_var)` (e.g. `TIKTOK_ACCESS_TOKEN`); **throw `AdNotConnectedError` if unset** — never call TikTok without it.
- Config from env: `TIKTOK_API_VERSION` (default `v1.3`), `TIKTOK_GRAPH_BASE` (default `https://business-api.tiktok.com`), `TIKTOK_ADVERTISER_ID` (validated against the persisted connection).
- `tiktokApi(path, body, {timeoutMs=15000})` — POST/GET wrapper with `AbortController` timeout; header **`Access-Token: <token>`**, `Content-Type: application/json`; on `code !== 0` (or non-2xx) throw a normalized `AdApiError { code, message, request_id }` (raw token **never** logged/echoed). GET params serialized per TikTok convention (JSON-encoded array/object query params).
- `connect`: `advertiser/info/get` + `identity/get` (capture `identity_id`,`identity_type`) + `pixel/list/get` (record pixel ref, informational) → `ConnectionInfo`.
- `uploadImage`: `file/image/ad/upload` `{advertiser_id, upload_type:'UPLOAD_BY_URL', image_url}` → `image_id`.
- `resolveGeo`: map ISO country → TikTok `location_id` via the targeting/region tool (`tool/region/` or `tool/targeting/search`); cache the small country→id map (build-time constant seeded for launch countries; extendable). `age_min/age_max` → `age_groups[]` bucket mapping helper.
- `createCampaign`/`createAdGroup`/`createAd`/`setStatus`/`getStatus`: the §4.4 sequences.
- `normalizeTikTokError(resp)` → `{ code, message, request_id }` for client-safe surfacing.

### 4.4 Edge functions (all POST; `verify_jwt=true`; in-code `admin_users` gate; service-role DB writes)

**Generalized, platform-dispatched.** Reuse `_shared/cors.ts` and the `_shared/stripeEdgeAuth.ts` entry pattern (`requireUserId(req)` → admin check). Add each to `supabase/config.toml` as `[functions.<name>] verify_jwt = true`. Each function reads `{ platform, lane, … }`, loads the `ad_connections` row for `(platform, lane)`, and resolves the adapter via `getAdapter(platform)`.

**Admin gate (every function, after `requireUserId`):**
```
const { data: adminRow } = await supabase.from('admin_users')
  .select('id').eq('email', user.email).eq('status','active').maybeSingle();
if (!adminRow) return json({ error: 'forbidden' }, 403);
```

#### (a) `admin-ads-connect`
- **Body:** `{ platform:'tiktok'|'meta', lane:'consumer'|'business', action:'connect'|'status' }` (default `connect`).
- **`connect`:** adapter `connect()` verifies the token against the live advertiser (TikTok `advertiser/info/get` + `identity/get` + `pixel/list/get`). On success → **upsert** `ad_connections` for `(platform,lane)` (`connected=true`, `token_status='valid'`, `token_last_verified_at=now()`, `account_id`, `business_center_id`, `identity_ref`, `identity_type`, `pixel_ref`, `currency`, `timezone`, `account_status`, `token_env_var`). On token/permission failure → upsert `token_status='invalid'`, `connected=false`; return **424** `{error:'tiktok_not_connected', detail}`.
- **`status`:** re-verify → refresh; return the connection row (token **never** included).
- **Output:** the `ad_connections` row + a `provider` echo of non-secret account/identity fields.

#### (b) `admin-ads-create-campaign` ← the atomic create
- **Body:**
```
{
  platform:'tiktok', lane:'consumer',
  name, objective='TRAFFIC',
  optimization_goal='TRAFFIC_LANDING_PAGE_VIEW', billing_event='CPC',
  budget:{ level:'adset'|'campaign', type:'daily'|'lifetime', amount_cents:int, end_time?:iso },  // end_time required if lifetime
  placement?:{ type:'PLACEMENT_TYPE_NORMAL', placements:['PLACEMENT_TIKTOK'] },
  targeting:{ countries:[…], age_min?, age_max?, genders? },
  destination:{ page_type:'event'|'trip'|'brand'|'venue', brand_slug, entity_slug?, event_id? },
  creative:{ ad_text, call_to_action?='LEARN_MORE', image_url },   // image_url = #864 bucket public URL
  request_id?:<uuid>   // idempotency; server generates if absent
}
```
- **Pre-flight (all fail-close, before ANY TikTok write):**
  1. Load the `(platform,lane)` connection; if `!connected || token_status!=='valid'` → **424** `tiktok_not_connected`.
  2. **Idempotency:** if an `ad_campaigns` row exists for `(connection_id, request_id)` → return it (200, no new create).
  3. **Resolve destination READ-ONLY** from `business_public_events_view` by `{brand_slug, slug=entity_slug}` (brand page: from `brands.slug`). No public+live row → **422** `destination_not_public`. Build `dest_url = ${BUSINESS_WEB_ORIGIN}/{e|t|b}/…`; build `dest_smart_link` server-side per #862 A1 (AppsFlyer OneLink `go.usemingla.com`, `deep_link_value ∈ {brand,event,trip,experience}`, `af_c_id`, `pid=tiktok_ads`, `ttclid` pass-through slot). Capture `dest_event_id`.
- **TikTok create sequence (order fixed; collect IDs; NO DB rows yet):**
  1. **Upload media:** adapter `uploadImage(conn, creative.image_url)` → `image_id`.
  2. **Resolve geo:** adapter `resolveGeo(conn, targeting.countries)` → `location_ids`; map `age_min/age_max` → `age_groups`.
  3. `POST /campaign/create/` — `advertiser_id`, `campaign_name=name`, `objective_type='TRAFFIC'`, `campaign_type='REGULAR_CAMPAIGN'`, budget (CBO: `budget_optimize_on=true` + `budget_mode`+`budget`; ABO: `budget_mode='BUDGET_MODE_INFINITE'`), `operation_status='DISABLE'`, `request_id`. → `campaign_id`.
  4. `POST /adgroup/create/` — `advertiser_id`, `campaign_id`, `adgroup_name`, `optimization_goal`, `billing_event='CPC'`, `pacing='PACING_MODE_SMOOTH'`, `placement_type`+`placements`, `location_ids`, `age_groups`, `gender`, budget (ABO only: `budget_mode`+`budget`; omit under CBO), `schedule_type` (`SCHEDULE_FROM_NOW` daily / `SCHEDULE_START_END`+`schedule_end_time` lifetime), `schedule_start_time`, `operation_status='DISABLE'`, `request_id`. → `adgroup_id`.
  5. `POST /ad/create/` — `advertiser_id`, `adgroup_id`, `creatives:[{ ad_name, identity_type:conn.identity_type, identity_id:conn.identity_ref, ad_format:'SINGLE_IMAGE', image_ids:[image_id], ad_text, call_to_action, landing_page_url:dest_smart_link, operation_status:'ENABLE' }]`. → `ad_id`.
- **Persist:** insert ONE `ad_campaigns` row + ONE `ad_sets` row + ONE `ads` row (all three IDs) with budget/targeting/destination + `status='PAUSED'`; read delivery status (`campaign/get`) into `delivery_status`; append `ad_campaign_status_events` `action='create'`.
- **Partial-failure contract (no orphans):** if any create step 3–5 fails, do **NOT** insert any DB rows. Attempt **compensating cleanup**: `campaign_status_update` `operation=DELETE` on the created `campaign_id` (cascades adgroup/ad). If cleanup itself fails, append `ad_campaign_status_events` `action='create_failed'` with `external_ids` = the partial IDs for manual reconciliation. Return **502** `tiktok_create_failed` with the normalized error. **Never** a half-written DB set.
- **Output:** the persisted `ad_campaigns` row (+ nested set/ad IDs).

#### (c) `admin-ads-campaign-action` ← launch / pause
- **Body:** `{ campaign_id:<our uuid>, action:'launch'|'pause' }`.
- **`launch`:** fail-close on connection; set `ENABLE` **top-down** — `campaign_status_update`, then `adgroup_status_update`, then `ad_status_update`. Re-read delivery status; update `status='ACTIVE'`, `delivery_status`, `status_synced_at`; append `action='launch'`. If delivery is `BALANCE_EXCEED`/`NO_BUDGET`/an audit/review state → return **200** with a `warning` so the UI surfaces it (the call succeeded; delivery is blocked upstream — TikTok's state, not our error — the TikTok analog of Meta `PENDING_BILLING_INFO`).
- **`pause`:** set `DISABLE` on the campaign; update row + append `action='pause'`.
- **Output:** updated row (+ optional `warning`).

#### (d) `admin-ads-campaign-sync` ← status read (no attribution)
- **Body:** `{ campaign_id?:<our uuid> }` — one or all. Adapter `getStatus()`; updates `status`, `delivery_status`, `status_synced_at`. `verify_jwt=true` admin; MAY also accept a service-role Bearer for a future cron. **No reporting/insights fields here** (those are #865).

### 4.5 Service + hook (mingla-admin) — the contract #864 consumes
- `mingla-admin/src/services/adEngine.js` — thin wrappers that `invokeWithRefresh('admin-ads-*', { body })`; typed request/response; surface normalized errors. #864's `metaAdsCampaigns.js`/`createCampaign(payload)` gains a `platform` field and points at `admin-ads-create-campaign` (small additive contract change — §11 OD-2; the payload body shape is otherwise identical to #864 §4.4 plus `platform`+`lane`).
- `mingla-admin/src/hooks/useAdEngine.js` (or Context, matching admin conventions) — connection state per `(platform,lane)`, campaign list, create/launch/pause mutations with `onError` toasts. Match the existing admin data pattern (direct Supabase calls + Context; no React Query requirement).

### 4.6 Component layer (mingla-admin) — see §5. #864 owns the full builder; this story ships only the minimal connect + campaign-list surface needed to exercise the engine and to unlock #864's TikTok channel.

---

## 5. Admin UI states (single surface → no per-platform split)

Minimal Ad-Engine surface (the polished builder is #864). Reachable only by an active admin (existing `AuthContext` + `ALLOWED_ADMIN_EMAILS` + 2FA). Scoped to `platform='tiktok'` (Meta reuses the same components).

- **SC-1 — Not configured** (`token_status='unknown'`/no connection, i.e. `TIKTOK_ACCESS_TOKEN` unset): show the **prerequisite checklist** (§7) + a disabled "Connect TikTok" with copy "Provision the TikTok Marketing-API access token first." Create is impossible (fail-close).
- **SC-2 — Disconnected/Invalid** (`token_status='invalid'`): red banner "TikTok connection invalid — re-verify the access token." + "Reconnect" (calls `admin-ads-connect`). Create disabled.
- **SC-3 — Connecting:** spinner on Connect/Reconnect; buttons disabled; no duplicate submits.
- **SC-4 — Connected:** show advertiser name/id, identity (`@usemingla`), currency, `account_status`. **If TikTok reports no spendable funds** (balance/prepaid unavailable) → amber warning "Add funds in TikTok Ads Manager before launching — campaigns will not deliver (Balance exceeded)." "Create campaign" **enabled**.
- **SC-5 — Create campaign form:** name; objective (default **Traffic**); **destination picker** (pick a live public page → `dest_url` + smart-link preview, resolved server-side); budget (daily/lifetime toggle, amount — TikTok min enforced server-side, error surfaced verbatim); targeting (countries multiselect, age min/max, gender); creative (image URL/upload, primary text, CTA select). Submit → create; on success "Created — **Paused**. Review, then Launch." with the new campaign in the list.
- **SC-6 — Campaign list/detail:** each row: name, objective, budget, **two badges** — advertiser `status` (Paused/Active/Archived) and **delivery status** (Under review / **Balance exceeded** / Delivering / Not started / Paused). Actions: **Launch** (when Paused), **Pause** (when Active), open **destination link**. "Sync status" → `admin-ads-campaign-sync`.
- **SC-7 — Error:** any edge error renders inline with the normalized TikTok message + `request_id`; a `tiktok_not_connected`/424 routes back to Connect. Nothing silently succeeds.

---

## 6. Security

- **SC-SEC-1 — Token at rest / in transit:** the TikTok credential is a **long-lived Marketing-API access token** stored ONLY in **Supabase Edge Function Secrets** as `TIKTOK_ACCESS_TOKEN`, read via `Deno.env.get(conn.token_env_var)`. Supabase encrypts function secrets at rest — this **is** our stack's token-encryption mechanism, **identical** to `STRIPE_RAK_*_LIVE`, `PAYSTACK_SECRET_KEY_LIVE`, `META_SYSTEM_USER_TOKEN`, `TIKTOK_EVENTS_ACCESS_TOKEN`. **NO at-rest DB token encryption** — no token in any table. The token is **never** written to any table, **never** in an edge-function response body, **never** in `provider_response`/logs, and **never** in the client bundle. (Resolves the "encrypted server-side, never client-exposed" constraint by precedent — §11 OD-1.)
- **SC-SEC-2 — Distinct from MCP OAuth:** production uses **Mingla's own TikTok Business app + long-lived access token** for server-side control. The per-user OAuth of the exploration MCP is **not** used in production and no per-user TikTok OAuth flow is built (mirrors #862 SEC-2).
- **SC-SEC-3 — Least-privilege scopes:** the access token must carry the Marketing-API ad-management scopes for **campaign/adgroup/ad create + status + read** and **asset (image) upload** on advertiser `7627974536397766673`; no user-data or messaging scopes. The Events-API token (`TIKTOK_EVENTS_ACCESS_TOKEN`, #865) is a **separate** credential and is NOT used by this story.
- **SC-SEC-4 — Authorization:** gateway `verify_jwt=true` → in-code `getUser(token)` (401) → `admin_users` active gate (403) on **every** `admin-ads-*` function. Client access to `ad_*` tables is admin-read-only via `is_admin_user()` RLS; writes are service-role-only.
- **SC-SEC-5 — Fail-close:** missing/invalid token → `tiktok_not_connected` (424) on connect/create/launch; destination not public → 422. No path proceeds to spend on a broken connection. The public `pixel_code` (`D9B98EBC77U1EOHV2O0G`) is **not** a secret and is not gated (but is not used by this story).

---

## 7. TikTok-side prerequisites Seth must provision (ACTION ITEMS — done vs remaining)

**Already DONE (live-probe confirmed 2026-07-15):**
- ✅ **Business Center** `7627974686760009729` + **advertiser** "Mingla LLC_adv" `7627974536397766673` created, **`STATUS_ENABLE`** (business verified — IRS CP575).
- ✅ **$10 prepaid** cash balance in the Advanced Payment Portfolio (UI-confirmed; API `balance` reads $0 and does not reflect it).
- ✅ **Identity** `@usemingla` (`identity_id b3f0f8f4-1beb-5c23-8a2c-9f440cec58a5`, `TT_USER`, AVAILABLE) — satisfies the REQUIRED `ad_create` identity fields. **Ad creation is unblocked.**
- ✅ **Pixel** "Mingla Web" `7662469356818858002` / code `D9B98EBC77U1EOHV2O0G` created (used by #865, not this story).

**REMAINING (blockers flagged):**
1. **Own TikTok Business app + long-lived Marketing-API access token (HARD BLOCKER — the #863 credential does not yet exist).** Master keys list only the **Events-API** token (`TIKTOK_EVENTS_ACCESS_TOKEN`, #865). Create Mingla's own TikTok for Business **developer app**, authorize advertiser `7627974536397766673`, and generate a **long-lived Marketing-API access token** with ad-management + file-upload scopes. Set Supabase Function Secrets: **`TIKTOK_ACCESS_TOKEN`** (server-side ONLY — never client, never repo), `TIKTOK_APP_ID`, `TIKTOK_APP_SECRET` (for token refresh/regeneration), `TIKTOK_ADVERTISER_ID=7627974536397766673`, `TIKTOK_API_VERSION=v1.3`, `TIKTOK_GRAPH_BASE=https://business-api.tiktok.com`. `BUSINESS_WEB_ORIGIN` already exists (reused for `dest_url`). Until this token exists, connect/create/launch fail-close (`tiktok_not_connected`) by design.
2. **FUNDING for live-fire (blocker for delivery):** TikTok enforces a **minimum daily budget** (≈ USD $20/ad group, ≈ $50/campaign CBO); the **$10 prepaid** balance is below one day's minimum. Top up the Advanced Payment Portfolio before any live campaign, or launched campaigns sit at **Balance exceeded** and never deliver (TikTok's analog of Meta `PENDING_BILLING_INFO`).
3. **Country → `location_id` mapping** for the launch markets (US, UK, NG, …). Resolved at build via TikTok's targeting/region tool and cached; confirm the launch-country set with Seth so the map is seeded (non-blocking — extendable).
4. **(Not #863) Events-API partner link / pixel install** — TikTok conversion tracking (pixel install, `/event/track/`, `custom_conversion`) is **#865**. Do NOT provision or wire it here.
5. **(Later) Business lane** — a separate business TikTok identity + (if a distinct advertiser) a second `ad_connections` row `lane='business'` with its own `token_env_var`. Out of scope now; the schema already supports it.

---

## 8. Acceptance criteria + test plan

### Acceptance criteria (testable)
- **AC-1:** `admin-ads-connect {platform:'tiktok',lane:'consumer'}` against a valid token persists `ad_connections` with `connected=true, token_status='valid'`, `account_id='7627974536397766673'`, `currency='USD'`, `identity_ref='b3f0f8f4-…'`, `identity_type='TT_USER'`, `pixel_ref='7662469356818858002'`, `token_env_var='TIKTOK_ACCESS_TOKEN'`. Invalid/missing token → 424 + `token_status='invalid'`, `connected=false`.
- **AC-2:** `admin-ads-create-campaign` creates **exactly one** campaign + ad group + ad on TikTok (all `operation_status=DISABLE`/paused) and persists **one** `ad_campaigns` + **one** `ad_sets` + **one** `ads` row with all three TikTok IDs + `dest_url` + `dest_smart_link` + `status='PAUSED'` + a read-back `delivery_status`.
- **AC-3 (units):** budget is stored in **cents** (minor units) in the DB and sent to TikTok as **dollars** (÷100) by the adapter; a below-minimum budget is rejected with TikTok's validation error surfaced verbatim (no silent clamp).
- **AC-4 (destination):** a destination that is not a **public + live** page → **422 `destination_not_public`** before any TikTok write; a valid one yields the correct `dest_url` shape (`/e/{brandSlug}/{eventSlug}` etc.) and a `dest_smart_link` (OneLink) used as the ad `landing_page_url`.
- **AC-5 (launch/pause):** `launch` sets campaign+adgroup+ad to `ENABLE` top-down and updates `status`/`delivery_status`; `pause` returns the campaign to `DISABLE`. Both append an `ad_campaign_status_events` row.
- **AC-6 (no orphans):** if the ad-group (or ad) create fails, **no** `ad_campaigns`/`ad_sets`/`ads` rows are written, the already-created campaign is deleted on TikTok (`campaign_status_update operation=DELETE`) — or a `create_failed` audit row captures partial IDs — and the caller gets **502 `tiktok_create_failed`**.
- **AC-7 (fail-close):** with `TIKTOK_ACCESS_TOKEN` unset, connect/create/launch all return `tiktok_not_connected` (424) — never a silent success, never a TikTok call.
- **AC-8 (idempotency):** two `admin-ads-create-campaign` calls with the same `request_id` create **one** campaign (the second returns the existing row) — enforced by the TikTok `request_id` + the `UNIQUE (connection_id, request_id)` DB constraint.
- **AC-9 (authz):** a non-admin JWT gets 403 on every `admin-ads-*` function; a non-admin cannot `SELECT` any `ad_*` table (RLS).
- **AC-10 (no token leak):** the token string never appears in any edge response, `provider_response`, log line, DB column, or the admin client bundle.
- **AC-11 (generalization):** the same `admin-ads-*` functions + `ad_*` tables serve `platform:'meta'` and `platform:'tiktok'` with no per-platform table; #864's create call works by passing `platform`.

### Test plan
**Unit / integration (edge, Deno test — reuse `__tests__` convention):**
- token-absent → fail-close (drives AC-7 + regression contract §9).
- create happy path with a mocked TikTok returning campaign/adgroup/ad IDs (`code:0`) → one row set, all IDs present, budget cents→dollars conversion asserted.
- create with adgroup-step failure (`code≠0`) → no DB rows + compensating `campaign_status_update DELETE` invoked (AC-6).
- destination-not-public → 422 before any TikTok call (AC-4).
- duplicate `request_id` → single row (AC-8).
- response-body + `provider_response` never contain the token (AC-10).

**RLS (SQL):** as an ordinary authenticated user, `SELECT` on each `ad_*` table returns 0 rows / denied; `is_admin_user()` returns them (AC-9).

**Live-fire path (post-prereqs §7, mingla-tester, real spend — NOT run in this spec phase):** after Seth provisions the access token + funds: connect → create a small `TRAFFIC` campaign to a real **live** Mingla event page → verify it exists PAUSED in TikTok Ads Manager + in `ad_campaigns`/`ad_sets`/`ads` with matching IDs → **launch** → confirm delivery becomes Delivering (or Under review / Balance-exceeded and the UI surfaces it) → **pause** → **delete/cleanup**. Capture screenshots + IDs.

**Security check (mingla-tester):** build the admin bundle and `grep -r` for the token / `TIKTOK_ACCESS_TOKEN` value → **absent**; inspect connect/create/launch network responses → token **absent**; confirm the token exists only as a Supabase Function Secret.

---

## 9. Invariants + regression prevention

### Invariants preserved / established
- **Preserve I-ADMIN-GATE:** every write path re-checks `admin_users` active. Test: AC-9.
- **Preserve immutable-slug contract** (`trg_brands_immutable_slug`/`trg_events_immutable_slug`): we only **read** slugs; `dest_url`/`dest_smart_link` durability relies on their immutability. Test: AC-4 URL shape.
- **I-PROPOSED-AD-TOKEN-ENV-ONLY (DRAFT):** any ad-platform token lives only in `Deno.env` (resolved via `token_env_var`); it MUST NOT appear in any DB column, response, log, or client bundle. **Generalizes #862's `I-PROPOSED-META-TOKEN-ENV-ONLY`** to all platforms. (Flips ACTIVE at CLOSE — orchestrator owns the flip.)
- **I-PROPOSED-AD-NO-ORPHAN-WRITE (DRAFT):** an `ad_campaigns` (+ its `ad_sets`/`ads`) row set exists **iff** all three TikTok IDs exist; partial creates leave no DB rows + a compensating delete/`create_failed` audit. **Generalizes #862's no-orphan invariant.**
- **I-PROPOSED-AD-FAIL-CLOSE (DRAFT):** create/launch/connect refuse and return `*_not_connected` when the token is absent/invalid.
- **I-PROPOSED-AD-IDEMPOTENT-CREATE (DRAFT):** a repeated `request_id` never creates a second campaign (TikTok `request_id` + `UNIQUE (connection_id, request_id)`).

### Regression contract (fails-on-revert)
- **RT-1 (fail-close):** edge test asserts token-absent → `tiktok_not_connected` and **zero** TikTok calls. **Reverting the `resolveToken()` throw makes RT-1 fail; restoring it passes.** Protective comment on the throw explains why (no silent spend on a broken connection).
- **RT-2 (no orphan):** edge test asserts an adgroup-step TikTok failure yields no `ad_campaigns`/`ad_sets`/`ads` insert + a compensating `campaign_status_update DELETE`. Reverting the "insert only after all IDs" ordering fails RT-2.
- **RT-3 (no token leak) — strict-grep CI gate:** a repo grep asserts `TIKTOK_ACCESS_TOKEN` / token access appears **only** under `supabase/functions/**` and **never** under `mingla-admin/src/**`, `app-mobile/**`, `mingla-business/**`. Fails CI if a future change references the token client-side. (Follows the house strict-grep-registry pattern; extend #862's existing gate to also cover `TIKTOK_ACCESS_TOKEN`.)
- **RT-4 (idempotency):** edge test asserts two same-`request_id` creates yield one row. Reverting the `UNIQUE (connection_id, request_id)` constraint or the pre-flight idempotency check fails RT-4.
- **No `app.json`/`eas.json`/store-submit change** → the `I-RELEASE-VERSION-PARITY` / `I-RELEASE-SUBMIT-CONFIG` gates (COMMS-0096/0097) are untouched.

---

## 10. Implementation order + scoped allowlist

### Order (DB → shared → edge → config → admin UI)
1. **Migration** `supabase/migrations/<ts>_issue_863_ad_engine_generalized.sql` — 5 tables (`ad_connections`, `ad_campaigns`, `ad_sets`, `ads`, `ad_campaign_status_events`) + RLS + indexes + `updated_at` triggers. **(If OD-2 = generalize:)** in the same migration, migrate #862's `meta_*` data into the generalized tables (backfill `platform='meta'`, `lane='consumer'`) and drop/rename the `meta_*` tables; otherwise create fresh (mirror).
2. **`supabase/functions/_shared/adChannel.ts`** — `ChannelAdapter` interface + `getAdapter` registry + `AdNotConnectedError`/`AdApiError`.
3. **`supabase/functions/_shared/tiktok.ts`** — token resolver (fail-close), `tiktokApi`, connect/upload/geo/create/status, error normalizer.
4. **Refactor `supabase/functions/_shared/meta.ts`** (from #862) to implement `ChannelAdapter` (logic unchanged; interface-shaped) — **coordinated with #862** (§11 OD-2).
5. **Edge fns** `admin-ads-connect`, `admin-ads-create-campaign`, `admin-ads-campaign-action`, `admin-ads-campaign-sync` (+ `__tests__`); deprecate/shim #862's `admin-meta-*` (OD-2).
6. **`supabase/config.toml`** — four `[functions.admin-ads-*] verify_jwt = true` blocks.
7. **mingla-admin** — `services/adEngine.js`, `hooks/useAdEngine.js`, minimal TikTok connect + campaign-list surface (SC-1…SC-7); update #864's create service to pass `platform`.
8. **CI** — extend the RT-3 strict-grep gate to `TIKTOK_ACCESS_TOKEN`.

### Allowlist (implementor MAY create/modify ONLY these)
- `supabase/migrations/<ts>_issue_863_ad_engine_generalized.sql` (new)
- `supabase/functions/_shared/adChannel.ts` (new), `supabase/functions/_shared/tiktok.ts` (new)
- `supabase/functions/_shared/meta.ts` (refactor to interface — **only** if OD-2=generalize; else DO-NOT-TOUCH)
- `supabase/functions/admin-ads-connect/**`, `admin-ads-create-campaign/**`, `admin-ads-campaign-action/**`, `admin-ads-campaign-sync/**` (new)
- `supabase/functions/admin-meta-*/**` (deprecate/shim — **only** if OD-2=generalize)
- `supabase/config.toml` (append function blocks only)
- `mingla-admin/src/**` (new Ad-Engine service/hook/minimal surface; wire into existing admin nav only; update #864's create-service `platform` field)
- CI workflow file for the strict-grep gate (extend the existing job)

### DO-NOT-TOUCH (stop-and-amend before any edit)
- Any existing `supabase/functions/{stripe*,brand-stripe-*,*paystack*,events,discover-*}/**` and `_shared/{stripe*,paystack*,appsFlyerS2S,stripeEdgeAuth,cors,audit,idempotency}.ts` (reuse by import; do **not** modify).
- Existing migrations, `brands`/`events`/`orders`/`stripe_connect_accounts`/`admin_users` schemas (read `business_public_events_view` + `is_admin_user()` only; add no columns).
- `app-mobile/**`, `mingla-business/**` (no consumer/business/public-web code changes — public web is destination-reference only).
- **`#865` territory:** the TikTok Events API (`/event/track/`), pixel install, `custom_conversion*`, retargeting/`dmp_custom_audience*`, `report_integrated_get`/insights, and `TIKTOK_EVENTS_ACCESS_TOKEN`. Do NOT wire any of it here.
- Any `app.json` / `eas.json` / store-submit config (preserves COMMS-0096/0097 gates).
Anything outside the allowlist → request a `SPEC_AMENDMENT_ISSUE-863_*` before touching.

---

## 11. Open decisions (with recommendations)

- **OD-1 — Connection/token model:** own-app **long-lived Marketing-API access token** (single org-level, in `Deno.env`) **[RECOMMEND — matches the constraint + the Stripe/Paystack/#862 precedent; Mingla manages only its own advertiser; NO at-rest DB token encryption]** vs. interactive 3-legged per-admin OAuth **[reject for production; adds refresh + at-rest storage we don't need]**.
- **OD-2 — Schema/endpoint reconciliation with #862 (the big one):** **(A) Generalize now [RECOMMEND]** — one coordinated migration folds #862's `meta_*` tables into `ad_connections`/`ad_campaigns`/`ad_sets`/`ads` (backfill `platform='meta'`, `lane='consumer'`), `_shared/meta.ts` becomes a `ChannelAdapter`, `admin-meta-*` become shims over `admin-ads-*`, and #864's create service passes `platform`. Single coherent model; #867 plugs in free. **(B) Mirror** — create `ad_*` fresh for TikTok, leave `meta_*` as-is (dual model, temporary divergence debt) **[reject unless #862 must ship un-touched on a hard deadline]**. Recommend A; it requires a small coordinated #862 + #864 change (flag to orchestrator).
- **OD-3 — Standard vs Smart+ campaign API:** **standard `campaign/create`→`adgroup/create`→`ad/create` [RECOMMEND — full TRAFFIC objective + budget/targeting/creative control matching #864; probe-proven]**; **Smart+ deferred** — it has no traffic objective (`APP_PROMOTION`/`WEB_CONVERSIONS`/`LEAD_GENERATION` only) and `WEB_CONVERSIONS` needs #865's pixel/CAPI. Add a Smart+ sub-adapter later when we want automated conversion-optimized delivery (post-#865).
- **OD-4 — Optimization goal:** **`TRAFFIC_LANDING_PAGE_VIEW` [RECOMMEND — highest-intent traffic to a reservation page, TikTok analog of Meta's `LANDING_PAGE_VIEWS`]** vs `CLICK` (cheaper, lower intent). Expose both; default to Landing-Page-View.
- **OD-5 — Budget level & placement:** **ABO** (budget on the ad group, `campaign budget_mode=BUDGET_MODE_INFINITE`) **[RECOMMEND for TikTok MVP — TikTok's default; simplest; avoids CBO's extra constraints]** vs CBO (`budget_optimize_on=true`). Placement: **`PLACEMENT_TYPE_NORMAL` + `["PLACEMENT_TIKTOK"]` [RECOMMEND — TikTok feed only; predictable; excludes lower-quality Pangle/audience-network]** vs `PLACEMENT_TYPE_AUTOMATIC`. (Note: this deliberately diverges from #862's CBO recommendation for Meta — TikTok's ABO default is the lower-risk MVP.)
- **OD-6 — Creative source:** MVP accept an **`image_url`** (the #864 bucket URL) that the adapter uploads to TikTok's Asset Library → `image_id` **[RECOMMEND]**; SINGLE_VIDEO + creative library = #866. TikTok generally favors video — flag that image-only ads may underperform; video is a fast-follow.
- **OD-7 — Geo resolution:** resolve country → `location_id` via a **cached build-time map** seeded for launch countries **[RECOMMEND — small, stable set]** vs a live `tool/region` lookup per create **[unnecessary latency]**. Extend the map as markets grow.
- **OD-8 — Status freshness:** on-demand "Sync status" button for MVP **[RECOMMEND]**; a `pg_cron` → `admin-ads-campaign-sync` heartbeat is a fast-follow (nice-to-have, not this story).

---

## Downstream routing
**Next:** `mingla-implementor` (build from this SPEC in the worktree below) → `mingla-tester` (RLS + fail-close + idempotency + no-orphan + live-fire once §7 prereqs are done) → orchestrator CLOSE. **Coordinate OD-2 with #862/#864** (shared generalized model) before implementation starts.
**Working tree:** `~/Desktop/mingla-orchs/issue-863-tiktok-ads-api/` on branch `issue-863-tiktok-ads-api`.
