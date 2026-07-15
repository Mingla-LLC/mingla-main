# SPEC — Add Snapchat + Google ad channels (internal Ad Engine)

**Issue:** GitHub #867 (child of initiative #852 "[Full Rooms] Internal Ad & Reservation Engine")
**Mode:** SPEC (grounded in a live READ-ONLY probe of the Snapchat Marketing API + Google-Ads-docs recon + codebase recon, 2026-07-14)
**Worktree:** `~/Desktop/mingla-orchs/issue-867-snapchat-google-channels/` on branch `issue-867-snapchat-google-channels`
**Extends:** **#862** (Meta engine — the generalized two-lane connection/campaign/adset/ad model + fail-close/no-orphan/idempotency invariants) · **references #865** (Snapchat/Meta/TikTok CONVERSIONS live there — NOT here)
**Downstream routing:** this SPEC → `mingla-implementor` → `mingla-tester` → orchestrator CLOSE
**Author:** mingla-forensics · **Date:** 2026-07-14

> **User story (verbatim):** "As a Mingla admin, I can connect Snapchat and Google as additional ad channels and create/launch/pause campaigns from our admin, alongside Meta — so the Ad Engine drives traffic to public pages across all our paid channels."

---

## Asymmetry banner (read first — it governs the whole spec)

This story adds **two** channels that are at **opposite readiness states**. The spec keeps them explicitly separate everywhere.

| | **Snapchat** | **Google** |
|---|---|---|
| Provisioning | **READY** — org + ad account + funding + pixel + OAuth app + refresh token all exist, live-probed 2026-07-14 | **PROVISION-BLOCKED** — no Google Ads account, no MCC, no developer token, no OAuth client |
| Evidence | **Live Marketing-API probe** (§4.0): real hierarchy + create schemas observed | **Docs-only** (§4.0b): API shape from developers.google.com only |
| Buildable now? | **YES — implementor builds + live-fires immediately** | **NO — adapter is specced; build gated on §7 action items** |
| ACs | Testable now (§8, `AC-S-*`) | Gated on provisioning (§8, `AC-G-*`, marked BLOCKED) |

**Do not let the Google lane block the Snapchat lane.** The implementor ships Snapchat end-to-end first; the Google adapter is written to the same interface but `connect()` fail-closes with `google_not_provisioned` until §7 completes.

---

## 1. Executive summary

Add **Snapchat** and **Google** as the third and fourth channels of Mingla's internal Ad Engine, on top of the Meta foundation (#862). Both are driven entirely from **Admin Web** (`mingla-admin`) and backed by Supabase **edge functions + DB**, reusing #862's exact server-side pattern: the provider credential lives **only** in Supabase Edge Function Secrets (`Deno.env`), never in the DB, never in any client; the DB stores only non-secret IDs + status; all writes are **admin-only** and **fail-close**.

Rather than fork per-platform tables, this story **generalizes** #862's `meta_*` schema into a platform-agnostic engine: `ad_connections` (one row per `platform` × `lane`), `ad_campaigns`, `ad_sets` (Snap "ad squads" / Google "ad groups"), `ads`, and an `ad_status_events` audit trail. Each platform ships a shared edge adapter (`_shared/snapchat.ts`, `_shared/google.ts`) implementing one **`ChannelAdapter`** interface (`connect`, `createCampaign`, `createAdSet`, `createAd`, `setStatus`, `getStatus`). The generalized edge functions (`admin-ad-connect`, `admin-ad-create-campaign`, `admin-ad-campaign-action`, `admin-ad-campaign-sync`) route to the adapter by `platform`.

**Snapchat is fully provisioned and token-verified (live probe, 2026-07-14):** org **Usemingla** `9389df65-3fa2-4a79-9593-479eee8d67bb`, ad account **"Mingla Ads"** `6421cc96-dcaf-4a09-a7fa-b24199dcb391` (**ACTIVE**, USD, tz America/New_York), an **ACTIVE VISA funding source** `6af02267-…` ($15k/day limit — billing is LIVE), pixel **"Usemingla Pixel"** `af5f8fc4-1ef6-41e7-81c5-042b7be7df38` (ACTIVE), OAuth app **Mingla Ads Engine** (client id `0c517e9f-…`). Snapchat uses a **refresh-token → 60-minute access-token** mint (`grant_type=refresh_token`) done **server-side per call** and cached until expiry, from env vars `SNAPCHAT_REFRESH_TOKEN` / `SNAPCHAT_CLIENT_ID` / `SNAPCHAT_CLIENT_SECRET`. The Snapchat lane is buildable and live-fireable **now**.

**Google is not provisioned.** No Google Ads account or MCC exists, and Google's official MCP is read-only/gated. This spec defines the Google adapter's shape from the docs so it is ready the moment provisioning lands, and §7 lists the provisioning action items (developer-token application is slow — **apply now**).

Snapchat/Google **CONVERSIONS** (Conversions/Offline-Conversions API, pixel install) are **out of scope — they live in #865.** This story is channel **connection + campaign/adsquad(adgroup)/ad CREATE/MANAGE + launch/pause + persist IDs** only.

---

## 2. Scope & non-goals

### In scope (this story)
1. **Generalize** the #862 ad-engine schema into platform-agnostic `ad_connections` / `ad_campaigns` / `ad_sets` / `ads` / `ad_status_events`, keyed by `platform` × `lane` (see §10 dependency note on folding `meta_*`).
2. **Snapchat channel (READY — build + live-fire now):**
   - **Connect** the Mingla Snapchat ad account (mint an access token from the refresh token, validate against the live org + ad account; persist a connection record).
   - **Create** a campaign → ad squad → creative → ad in one atomic operation (all created **PAUSED**).
   - **Set budget & targeting** (daily/lifetime budget in micro; geo targeting).
   - **Launch / pause** from admin.
   - **Persist** Snapchat campaign/adsquad/creative/ad IDs + status + review status + destination reference (the `dest_smart_link` from #862 A1).
3. **Google channel (PROVISION-BLOCKED — spec only):** the `_shared/google.ts` adapter to the same `ChannelAdapter` interface, `connect()` fail-closing with `google_not_provisioned` until §7 lands; the campaign→adGroup→adGroupAd `mutate` shape documented so implementation is a drop-in once provisioned.
4. **Admin surface:** minimal channel picker + per-channel connect/create/launch/pause/status, extending #862's `/ad-engine` route (Snapchat tab functional; Google tab shows a provisioning-blocked state).

### Non-goals (explicitly NOT built here — separate issues)
- **Snapchat / Google CONVERSIONS** — Snap Conversions API (`tr.snapchat.com/v3/{pixel}/events`, token `SNAPCHAT_CAPI_TOKEN`), pixel install, offline-conversions, and the Google conversion/tag wiring → **#865** (Snapchat CAPI is already folded into #865; do NOT re-spec it here). This story only sends **create/manage** calls to the Marketing/Google-Ads API, never conversion events.
- **Campaign-builder UX** beyond the minimum admin screens to exercise connect/create/launch/pause → **#864**. This spec ships a deliberately minimal admin surface.
- **Creative library** (reusable venue media, video/image asset pipeline) → **#866**. Snapchat creatives require an uploaded `top_snap_media_id`; MVP accepts a single media upload (or an existing `top_snap_media_id`/`creative_id`) at create time. The polished asset library is #866.
- **Meta (#862) and TikTok (#863) channels** — reused/coordinated with, not rebuilt. (Meta's `meta_*` tables are generalized as a §10 dependency, not re-implemented.)
- **Consumer app, business app, buyer web, business-web preview behavior.** Public web is a **destination reference only**. No code changes to those surfaces.

### Assumptions
- **#862 is the parent.** The generalized `ad_*` schema + `ChannelAdapter` interface + `dest_smart_link` construction either land with #862's generalization or are created by whichever of #862/#863/#867 merges first; #867 depends on that generalized schema existing (§10 OD-1 / dependency note). If it does not yet exist, #867's migration creates it.
- Mingla manages **only its own** Snapchat/Google ad accounts (no per-client/agency multi-tenant OAuth) — a single org-level credential per platform per lane, matching #862.
- Snapchat access tokens are short-lived (60 min); the server mints and caches them per the adapter. No Snapchat token is ever stored at rest.

---

## 3. Cross-Surface Impact Declaration (MANDATORY)

| # | Surface | Covered? | User-visible behavior demanded | Files touched here | Parity |
|---|---------|----------|-------------------------------|--------------------|--------|
| 1 | Consumer iOS (`app-mobile/` iOS) | **No** | none | none | n/a — engine is admin/back-office only |
| 2 | Consumer Android (`app-mobile/` Android) | **No** | none | none | n/a |
| 3 | Buyer/anonymous Web (`mingla-business` `/e/…`, `/b/…`, `/t/…`, `/checkout/…`) | **Reference only** | Public page is the campaign **destination**; the live public URL/`dest_smart_link` is read (never written) to build the ad's web-view/link URL | none (reads `business_public_events_view`) | n/a — read-only consumer of existing public contract |
| 4 | Business iOS | **No** | none | none | n/a |
| 5 | Business Android | **No** | none | none | n/a |
| 6 | **Admin Web** (`mingla-admin/`) | **YES — primary** | Pick channel (Meta/Snapchat/Google); connect Snapchat; create/launch/pause Snapchat campaigns; see status; Google tab shows provisioning-blocked | `mingla-admin/src/**` (extend the #862 Ad-Engine route: channel picker, Snapchat service/hook/components, Google blocked state) | Single surface — no cross-platform parity concern |
| 7 | Business Web preview (adjacent) | **No** | none | none | n/a |
| — | **Backend** (`supabase/`) | **YES — primary** | generalized tables + RLS; `_shared/adChannel.ts`, `_shared/snapchat.ts`, `_shared/snapAuth.ts`, `_shared/google.ts`; generalized `admin-ad-*` edge fns; secrets | `supabase/migrations/**`, `supabase/functions/admin-ad-*/**`, `supabase/functions/_shared/{adChannel,snapchat,snapAuth,google}.ts`, `supabase/config.toml` | Server-authoritative; no parity concern |

**Why each NOT-covered surface is out:** the Ad Engine is an internal back-office tool that runs paid campaigns *pointing at* already-live public pages; it does not modify what consumers or businesses see. Public web is touched only as a **read** of the existing immutable slug contract (reused from #862).

---

## 4. Layered specification

### 4.0 "What's buildable" — LIVE Snapchat Marketing-API probe evidence (read-only, 2026-07-14)

All values below are **real responses** from `https://adsapi.snapchat.com/v1` using an access token minted server-side from `SNAPCHAT_REFRESH_TOKEN`/`SNAPCHAT_CLIENT_ID`/`SNAPCHAT_CLIENT_SECRET`. **No write/create tool was called.** (Token minted via `POST https://accounts.snapchat.com/login/oauth2/access_token`, `grant_type=refresh_token` → `expires_in=3600`, `token_type=Bearer`, `scope="snapchat-offline-conversions-api snapchat-marketing-api"`.)

**Response envelope (every endpoint).** Snapchat wraps every response:
```
{ "request_status":"SUCCESS", "request_id":"<uuid>", "paging":{…},
  "<collection>":[ { "sub_request_status":"SUCCESS", "<entity>":{ … } } ] }
```
Both the outer `request_status` AND each `sub_request_status` must be checked — a 200 can carry a per-entity failure. **This is the adapter's success contract.**

**Organization (`GET /organizations/9389df65-…`):** `name:"Usemingla"`, `country:"US"`, `type:"ENTERPRISE"`, `state:"ACTIVE"`. → org is live.

**Ad account (`GET /adaccounts/6421cc96-…`):** `name:"Mingla Ads"`, `type:"PARTNER"`, `status:"ACTIVE"`, `currency:"USD"`, `timezone:"America/New_York"`, `funding_source_ids:["6af02267-372a-41de-84f9-cddc024a183b"]`, `billing_type:"REVOLVING"`. → **account ACTIVE and fundable.**

**Funding source (`GET /organizations/9389df65-…/fundingsources`):** `type:"CREDIT_CARD"`, `card_type:"VISA"`, `last_4:"4101"`, `status:"ACTIVE"`, `daily_spend_limit_micro:15000000000` (USD $15,000/day), `expiration:"03/2029"`. → **billing is LIVE** (contrast with Meta #862, whose account was `UNSETTLED` with no payment method). Snapchat can deliver the moment a campaign launches.

**Pixel (`GET /adaccounts/6421cc96-…/pixels`):** exactly one — `id:"af5f8fc4-1ef6-41e7-81c5-042b7be7df38"`, `name:"Usemingla Pixel"`, `status:"ACTIVE"`, `automatic_event_opt_in:"OPT_OUT"`. Ad squads may reference `pixel_id` for conversion-optimized goals; the **pixel install + conversion events are #865**, not this story.

**Current entity hierarchy — all empty (fresh account, ready to create):** `campaigns:[]`, `adsquads:[]`, `ads:[]`, `creatives:[]`, `media:[]`, `catalogs:[]` — all `HTTP 200 request_status:SUCCESS`. → nothing to reconcile; the engine starts clean.

**Snapchat hierarchy & create-field contracts** (create schemas from developers.snap.com — the current reference site; the legacy `marketingapi.snapchat.com/docs` is deprecated). **Budgets are in MICRO** (value × 1,000,000; $20 = `20000000`). Hierarchy: **Organization → Ad Account → Campaign → Ad Squad → Ad → Creative** (+ Media uploaded separately).

- **Campaign** — `POST /adaccounts/{ad_account_id}/campaigns`. **Required:** `name` (≤375), `ad_account_id`, `status` (`ACTIVE`|`PAUSED`), `start_time` (ISO-8601), `buy_model` (`AUCTION` default | `RESERVED`). **Optional/used:** `objective_v2_properties.objective_v2` (`AWARENESS_AND_ENGAGEMENT`, `TRAFFIC`, `SALES`, `APP_PROMOTION`, `LEADS`) — **use `TRAFFIC`** for "drive traffic to a public page"; `end_time`; **campaign-level** `daily_budget_micro` / `lifetime_spend_cap_micro` (min `20000000` = $20). Created **PAUSED**.
- **Ad Squad** — `POST /campaigns/{campaign_id}/adsquads`. **Required:** `name`, `campaign_id`, `type` (`SNAP_ADS`), `targeting` (e.g. `{ "geos":[{"country_code":"us"}] }`; + optional `demographics`/`interests`), `billing_event` (`IMPRESSION`), `bid_strategy` (`AUTO_BID` | `LOWEST_COST_WITH_MAX_BID` + `bid_micro` | `TARGET_COST`), `daily_budget_micro` **or** `lifetime_budget_micro` (min `5000000` = $5), `optimization_goal`, `placement_v2` (e.g. `{ "config":"AUTOMATIC" }`). **Optional:** `status`, `start_time`, `end_time`, `pixel_id`. **`optimization_goal` values** (LIVE from docs): `IMPRESSIONS, SWIPES, APP_INSTALLS, VIDEO_VIEWS, VIDEO_VIEWS_15_SEC, USES, STORY_OPENS, PIXEL_PAGE_VIEW, PIXEL_ADD_TO_CART, LANDING_PAGE_VIEW, LEAD_FORM_SUBMISSIONS, PIXEL_PURCHASE, PIXEL_SIGNUP, APP_ADD_TO_CART, APP_PURCHASE, APP_SIGNUP, APP_REENGAGE_OPEN, APP_REENGAGE_PURCHASE`. → **For traffic use `SWIPES`** (default, cheapest click) or **`LANDING_PAGE_VIEW`** (higher intent — recommended for reservation traffic; both compatible with `TRAFFIC`). Budget-on-squad = ABO; budget-on-campaign = CBO (mutually exclusive with squad budget). Created **PAUSED**.
- **Media** (prereq for a creative) — `POST /adaccounts/{ad_account_id}/media` creates the media entity, then upload the file to the returned media object (`/media/{id}/upload`). Returns `top_snap_media_id`. (Full media/asset UX = #866; MVP does a single upload or accepts an existing media id.)
- **Creative** — `POST /adaccounts/{ad_account_id}/creatives`. **Required:** `name`, `ad_account_id`, `type` (`SNAP_AD` | `WEB_VIEW` | `APP_INSTALL` | `DEEP_LINK` — **use `WEB_VIEW`** for a public-page destination), `top_snap_media_id`, `headline` (≤34), `profile_properties.profile_id` (the Snap **Public Profile** id — §7 Snap-3). **Optional:** `brand_name` (≤32), `call_to_action` (e.g. `VIEW_MORE`), `web_view_properties.url` (= the `dest_smart_link`), `shareable` (default true). Returns `creative_id`.
- **Ad** — `POST /adsquads/{ad_squad_id}/ads`. **Required:** `name`, `ad_squad_id`, `creative_id`, `type` (`SNAP_AD`). **Optional:** `status`. Created **PAUSED**.
- **Launch / pause (status update).** Snapchat updates via **PUT to the parent-collection endpoint** with the entity carrying its id: `PUT /adaccounts/{acct}/campaigns` body `{"campaigns":[{"id":…,"status":"ACTIVE"}]}` (likewise `/adsquads`, `/ads`). Activation is **top-down** (campaign → ad squad → ad, each set `ACTIVE`); pause = set the campaign `PAUSED`. (`PATCH` is available for partial field updates.)
- **Status model.** Entity `status` = `ACTIVE`|`PAUSED` (advertiser-set). Ads also carry a **`review_status`** (`PENDING`|`APPROVED`|`REJECTED`) — the delivery gate analogous to Meta's `effective_status`. **Persist BOTH** `status` and the ad-level `review_status`. Editing a creative re-triggers review and pauses its ads until re-approved.

**Snapchat vs Meta create-shape deltas (for the generalization):** budgets in **micro** (Meta = cents); objective under `objective_v2_properties.objective_v2=TRAFFIC` (Meta = `OUTCOME_TRAFFIC`); ad squad = Meta ad set; creative needs an **uploaded media id + a Public Profile** (Meta accepts a raw `image_url` + Page); update = **PUT to parent collection** (Meta = POST to the entity id); delivery gate = ad `review_status` (Meta = `effective_status`); batch envelope with `sub_request_status` (Meta = flat object or `error`).

---

### 4.0b Google Ads API — DOCS-ONLY shape (PROVISION-BLOCKED, 2026-07-14)

No Google Ads account/MCC/developer-token exists, and Google's official MCP is read-only/gated — so this is **API shape from developers.google.com only**, not a live probe. Documented so the adapter is a drop-in once §7 provisioning lands.

- **Auth:** OAuth2 access token (`Authorization: Bearer`) **plus** a `developer-token` header (a 22-char string from the API Center) **plus** `login-customer-id` (the **MCC/manager** customer id) when operating through a manager account. Missing `login-customer-id` → `AuthorizationError.USER_PERMISSION_DENIED`.
- **Base:** `POST https://googleads.googleapis.com/v{API_VERSION}/customers/{CUSTOMER_ID}/…` (e.g. `v25` current at time of writing).
- **Hierarchy:** **Customer → Campaign Budget → Campaign → Ad Group → Ad Group Ad** (Google's "ad group" = our `ad_set`). Budgets in **micros** (`CampaignBudget.amount_micros`).
- **Create = `mutate`.** Per-resource endpoints `campaignBudgets:mutate`, `campaigns:mutate`, `adGroups:mutate`, `adGroupAds:mutate`, or the **combined atomic** `googleAds:mutate` (a single request creating budget→campaign→adGroup→ad where each op references the previous via a temp resource name; if one op fails the **whole group fails** — a native no-orphan guarantee that maps cleanly onto our atomicity invariant). Each op is `{create:{…}}` / `{update:{…}, updateMask}` / `{remove:…}`.
  - `CampaignBudget{ name, amount_micros, delivery_method:STANDARD }`.
  - `Campaign{ name, advertising_channel_type:SEARCH|DISPLAY|…, status:PAUSED, campaign_budget:<budget res name>, network_settings, start_date, end_date, bidding strategy (e.g. maximize_clicks / target_spend) }` — created **PAUSED**.
  - `AdGroup{ name, campaign:<res name>, status:ENABLED, type:SEARCH_STANDARD, cpc_bid_micros }`.
  - `AdGroupAd{ ad_group:<res name>, status:PAUSED, ad:{ final_urls:[dest_smart_link], responsive_search_ad|display fields } }`.
- **Launch / pause:** `campaigns:mutate` with `{update:{resource_name, status:ENABLED|PAUSED}, updateMask:"status"}` (top-down like Snapchat/Meta).
- **Status read:** GAQL via `POST customers/{id}/googleAds:searchStream` (`SELECT campaign.id, campaign.status, campaign_budget.amount_micros FROM campaign WHERE …`). Ad approval = `ad_group_ad.policy_summary.approval_status`.
- **Provisioning gate:** everything above is **inert** until a Google Ads account + MCC + **approved developer token** + OAuth client exist (§7 Google-*). Until then the adapter `connect()` returns `google_not_provisioned` (fail-close).

---

### 4.1 Architecture & data flow

```
Admin (mingla-admin, React+Vite, 2FA + ALLOWED_ADMIN_EMAILS)
   │  authenticated fetch (Bearer JWT), body carries { platform, lane, … }
   ▼
Supabase Edge Function  admin-ad-*  (verify_jwt=true → in-code admin_users gate)
   │  resolves the ChannelAdapter by platform  →  _shared/{snapchat,google,meta}.ts
   │  Snapchat: _shared/snapAuth.ts mints+caches a 60-min access token from
   │            SNAPCHAT_REFRESH_TOKEN/CLIENT_ID/CLIENT_SECRET (fail-close if mint fails)
   │  Google:   connect() → google_not_provisioned until §7 lands
   ├──────────────► Snapchat Marketing API  https://adsapi.snapchat.com/v1/…
   │                 (create campaign/adsquad/creative/ad; PUT status; read review_status)
   │  service-role client (SUPABASE_SERVICE_ROLE_KEY)
   ▼
Supabase DB  ad_connections · ad_campaigns · ad_sets · ads · ad_status_events
             (RLS: admin read, service-role write; keyed by platform × lane)
   │
   └─ destination resolved (READ-ONLY) from business_public_events_view + dest_smart_link (#862 A1 OneLink)
```

**Invariants of the flow (inherited from #862):** (a) the token never leaves the edge runtime — and for Snapchat is never even persisted, only minted in-memory and cached until expiry; (b) the client never receives a token or calls a provider directly; (c) a full `ad_campaigns`+`ad_sets`+`ads` set is written **only after all provider IDs exist** (no orphan rows); (d) every state-changing call is gated by `is_admin_user()`; (e) a missing/invalid/unmintable credential **stops** create/launch (fail-close) — it does not silently no-op.

### 4.2 Database layer — generalize the #862 schema

New migration `supabase/migrations/<ts>_issue_867_ad_engine_generalize.sql` (timestamp AFTER the latest existing migration — currently `20261229000000_orch_1359_peer_guest_location.sql`; verify with `ls supabase/migrations | tail`). Follow the house pattern (RLS enabled, admin-read via `is_admin_user()`, writes service-role-only, `updated_at` triggers).

> **§10 dependency:** if #862's `meta_*` tables have already merged, this migration also **renames/migrates** them into the generalized tables (see §10). If not, it **creates** the generalized tables fresh. Either way the end state is the four tables below. No `meta_*`-prefixed table survives.

**Table `public.ad_connections`** — one row per `platform` × `lane`. **No token column — ever.**
```
id                      uuid PK default gen_random_uuid()
platform                text NOT NULL CHECK (platform IN ('meta','tiktok','snapchat','google'))
lane                    text NOT NULL CHECK (lane IN ('consumer','business'))
auth_kind               text NOT NULL CHECK (auth_kind IN ('bearer_token','refresh_token','oauth_service'))
                        -- meta/tiktok='bearer_token'; snapchat='refresh_token'; google='oauth_service'
token_env_var           text NOT NULL       -- primary secret NAME (e.g. 'SNAPCHAT_REFRESH_TOKEN'); NEVER a value
auth_env_vars           jsonb NOT NULL DEFAULT '{}'  -- extra secret NAMES the adapter needs
                        --   snapchat: {"client_id":"SNAPCHAT_CLIENT_ID","client_secret":"SNAPCHAT_CLIENT_SECRET"}
                        --   google:   {"developer_token":"GOOGLE_ADS_DEVELOPER_TOKEN","refresh_token":"GOOGLE_ADS_REFRESH_TOKEN",
                        --              "client_id":"GOOGLE_ADS_OAUTH_CLIENT_ID","client_secret":"GOOGLE_ADS_OAUTH_CLIENT_SECRET",
                        --              "login_customer_id":"GOOGLE_ADS_LOGIN_CUSTOMER_ID"}
org_id                  text NULL           -- snapchat org '9389df65-…'; google MCC id; meta business id
account_id              text NOT NULL       -- snapchat adaccount '6421cc96-…'; google customer id; meta ad account
profile_or_page_id      text NULL           -- snapchat Public Profile id (creative); meta page id
pixel_id                text NULL           -- snapchat 'af5f8fc4-…' (used by #865, stored here for reference)
currency                text NULL           -- 'USD'
timezone                text NULL           -- 'America/New_York'
min_budget_micro        bigint NULL         -- snapchat squad min 5000000; campaign min 20000000
account_status          text NULL           -- 'ACTIVE' | 'UNSETTLED' | 'google_not_provisioned' | …
has_funding             boolean NULL        -- snapchat funding source ACTIVE → true
token_status            text NOT NULL DEFAULT 'unknown' CHECK (token_status IN ('valid','invalid','unknown'))
token_last_verified_at  timestamptz NULL
connected               boolean NOT NULL DEFAULT false
connected_by            uuid NULL REFERENCES auth.users(id)
created_at              timestamptz NOT NULL DEFAULT now()
updated_at              timestamptz NOT NULL DEFAULT now()
UNIQUE (platform, lane)
-- COMMENT: 'Provider credentials are stored ONLY in Supabase Edge Function Secrets (Deno.env), referenced here by env-var NAME. Snapchat access tokens are minted in-memory from SNAPCHAT_REFRESH_TOKEN and NEVER persisted.'
```

**Table `public.ad_campaigns`** — one row per campaign, written only when fully created (with its `ad_sets`/`ads` children in the same transaction).
```
id                  uuid PK default gen_random_uuid()
connection_id       uuid NOT NULL REFERENCES public.ad_connections(id) ON DELETE RESTRICT
platform            text NOT NULL          -- denormalized for query/index; matches connection.platform
lane                text NOT NULL
provider_campaign_id text NOT NULL         -- Snap campaign id / Google campaign resource name / Meta campaign id
name                text NOT NULL
objective           text NOT NULL          -- 'TRAFFIC' (snap objective_v2) / mapped per platform
buy_model           text NULL              -- snapchat 'AUCTION'
budget_level        text NOT NULL CHECK (budget_level IN ('campaign','adset'))  -- CBO vs ABO
budget_type         text NULL CHECK (budget_type IN ('daily','lifetime'))       -- when budget_level='campaign'
budget_micro        bigint NULL CHECK (budget_micro IS NULL OR budget_micro > 0)
status              text NOT NULL DEFAULT 'PAUSED' CHECK (status IN ('PAUSED','ACTIVE','ARCHIVED','DELETED'))
delivery_status     text NULL              -- snapchat rollup of ad review_status / meta effective_status / google approval
status_synced_at    timestamptz NULL
-- destination (the point of Full Rooms):
dest_page_type      text NOT NULL CHECK (dest_page_type IN ('event','trip','brand','venue'))
dest_brand_slug     text NOT NULL
dest_entity_slug    text NULL
dest_event_id       uuid NULL REFERENCES public.events(id) ON DELETE SET NULL
dest_url            text NOT NULL          -- canonical public web page (fallback/reference)
dest_smart_link     text NOT NULL          -- #862 A1 OneLink used as the creative web-view/final url
created_by          uuid NULL REFERENCES auth.users(id)
created_at          timestamptz NOT NULL DEFAULT now()
updated_at          timestamptz NOT NULL DEFAULT now()
UNIQUE (platform, provider_campaign_id)
```

**Table `public.ad_sets`** — Snap "ad squad" / Google "ad group" / Meta "ad set".
```
id                  uuid PK default gen_random_uuid()
campaign_id         uuid NOT NULL REFERENCES public.ad_campaigns(id) ON DELETE CASCADE
provider_adset_id   text NOT NULL
name                text NOT NULL
optimization_goal   text NOT NULL          -- snapchat 'SWIPES'|'LANDING_PAGE_VIEW'
billing_event       text NULL              -- snapchat 'IMPRESSION'
bid_strategy        text NULL              -- snapchat 'AUTO_BID'
budget_type         text NULL CHECK (budget_type IS NULL OR budget_type IN ('daily','lifetime'))
budget_micro        bigint NULL            -- when budget_level='adset'
targeting           jsonb NOT NULL DEFAULT '{}'  -- snapchat {geos:[{country_code}]}
status              text NOT NULL DEFAULT 'PAUSED' CHECK (status IN ('PAUSED','ACTIVE','ARCHIVED','DELETED'))
created_at          timestamptz NOT NULL DEFAULT now()
updated_at          timestamptz NOT NULL DEFAULT now()
UNIQUE (campaign_id, provider_adset_id)
```

**Table `public.ads`** — the ad + its creative reference.
```
id                  uuid PK default gen_random_uuid()
ad_set_id           uuid NOT NULL REFERENCES public.ad_sets(id) ON DELETE CASCADE
provider_ad_id      text NOT NULL
provider_creative_id text NULL             -- snapchat creative id
provider_media_id   text NULL             -- snapchat top_snap_media_id
name                text NOT NULL
status              text NOT NULL DEFAULT 'PAUSED' CHECK (status IN ('PAUSED','ACTIVE','ARCHIVED','DELETED'))
review_status       text NULL             -- snapchat 'PENDING'|'APPROVED'|'REJECTED'
created_at          timestamptz NOT NULL DEFAULT now()
updated_at          timestamptz NOT NULL DEFAULT now()
UNIQUE (ad_set_id, provider_ad_id)
```

**Table `public.ad_status_events`** — append-only audit of create/launch/pause/sync/failure (mirrors #862's `meta_campaign_status_events`; supports the "persist status" AC + reconciliation of any partial-create failure).
```
id            uuid PK default gen_random_uuid()
campaign_id   uuid NULL REFERENCES public.ad_campaigns(id) ON DELETE CASCADE  -- NULL if create failed before a row existed
platform      text NOT NULL
action        text NOT NULL CHECK (action IN ('create','launch','pause','sync','create_failed','rollback'))
actor         uuid NULL REFERENCES auth.users(id)
from_status   text NULL
to_status     text NULL
provider_ids  jsonb NULL         -- partial IDs captured on failure for manual reconciliation
provider_response jsonb NULL     -- normalized provider error/success (NEVER contains a token)
created_at    timestamptz NOT NULL DEFAULT now()
```

**RLS (all five tables):** `ENABLE ROW LEVEL SECURITY`.
- `SELECT`: `USING ( public.is_admin_user() )` for `authenticated`.
- `INSERT`/`UPDATE`/`DELETE`: **no policy for authenticated** (service-role bypasses RLS; only the admin-gated edge functions write). Matches #862 / `payment_webhook_events`.
- `GRANT SELECT` to `authenticated`; no direct write grants.

**Indexes:** `ad_campaigns (connection_id)`, `ad_campaigns (platform, status)`, `ad_campaigns (dest_event_id)`, `ad_sets (campaign_id)`, `ads (ad_set_id)`, `ad_status_events (campaign_id, created_at DESC)`.

### 4.3 Shared edge modules

**`supabase/functions/_shared/adChannel.ts` (NEW)** — the platform-agnostic contract + registry.
- `interface ChannelAdapter { platform; connect(conn); createCampaign(ctx); createAdSet(ctx); createAd(ctx); setStatus(ctx, status); getStatus(ids); }` — each method returns typed provider IDs / status, throws a normalized `AdChannelError { platform, code, subcode, message, trace_id }` on failure (never echoing a token).
- `getAdapter(platform): ChannelAdapter` — registry `{ snapchat: snapchatAdapter, google: googleAdapter, meta: metaAdapter }`. Meta's #862 logic is refactored behind this interface (§10). Unknown/absent platform → throw.
- `normalizeAdError(platform, e)` → client-safe `{ code, subcode, message, trace_id }`.

**`supabase/functions/_shared/snapAuth.ts` (NEW)** — Snapchat token minting + cache (mirrors #862 `resolveMetaToken`'s fail-close, extended for refresh-token flow).
- `mintSnapAccessToken(): Promise<string>` — reads `SNAPCHAT_REFRESH_TOKEN`, `SNAPCHAT_CLIENT_ID`, `SNAPCHAT_CLIENT_SECRET` from `Deno.env`; **throw `SnapNotConnectedError` if any is unset** (fail-close). `POST https://accounts.snapchat.com/login/oauth2/access_token` (form-encoded `grant_type=refresh_token`) → returns `access_token`; **caches** it in a module-scope variable with an expiry = `now + (expires_in − 60s)` safety margin; subsequent calls within the window reuse the cache. On a 4xx from the mint (revoked/expired refresh token) → **`SnapNotConnectedError` (fail-close)** — never proceed to a create/launch without a token. The refresh token and minted access token are **never** logged, returned, or persisted.

**`supabase/functions/_shared/snapchat.ts` (NEW)** — `snapchatAdapter: ChannelAdapter`.
- `snapGraph(method, path, body?, {timeoutMs=15000})` — `AbortController` timeout; `Authorization: Bearer <mintSnapAccessToken()>`; parses the batch envelope and asserts BOTH `request_status==='SUCCESS'` AND every `sub_request_status==='SUCCESS'`, else throws `AdChannelError` from the entity's error. Base `https://adsapi.snapchat.com/v1`.
- `connect(conn)` — `GET /organizations/{org}` + `GET /adaccounts/{account}` + `GET /organizations/{org}/fundingsources`; returns `{ account_status, currency:'USD', timezone, has_funding, min_budget_micro }`. Mint failure → fail-close.
- `createCampaign` → `POST /adaccounts/{account}/campaigns` `{name, status:'PAUSED', start_time, buy_model:'AUCTION', objective_v2_properties:{objective_v2:'TRAFFIC'}, daily_budget_micro?}`.
- `createAdSet` → `POST /campaigns/{campaign}/adsquads` `{name, type:'SNAP_ADS', targeting:{geos}, billing_event:'IMPRESSION', bid_strategy:'AUTO_BID', optimization_goal, daily_budget_micro|lifetime_budget_micro, placement_v2:{config:'AUTOMATIC'}, start_time, status:'PAUSED'}`.
- creative helper → optional `POST /adaccounts/{account}/media` (+ upload) to get `top_snap_media_id`; then `POST /adaccounts/{account}/creatives` `{name, type:'WEB_VIEW', top_snap_media_id, headline, brand_name, profile_properties:{profile_id:<conn.profile_or_page_id>}, web_view_properties:{url:dest_smart_link}, call_to_action:'VIEW_MORE'}`.
- `createAd` → `POST /adsquads/{adsquad}/ads` `{name, creative_id, type:'SNAP_AD', status:'PAUSED'}`.
- `setStatus(ids, 'ACTIVE'|'PAUSED')` → `PUT /adaccounts/{account}/campaigns` `{campaigns:[{id, status}]}` (+ `/adsquads`, `/ads` for top-down launch).
- `getStatus(ids)` → `GET /campaigns/{id}` + `GET /ads/{id}` → `{status, review_status}`.
- compensating cleanup → `DELETE /campaigns/{id}` (Snapchat cascades child squad/ad/creative) for a partial create.

**`supabase/functions/_shared/google.ts` (NEW — PROVISION-BLOCKED stub to the same interface).**
- `connect(conn)` — reads `GOOGLE_ADS_DEVELOPER_TOKEN` / `GOOGLE_ADS_REFRESH_TOKEN` / OAuth client / `GOOGLE_ADS_LOGIN_CUSTOMER_ID`; if **any is unset** → return `{ account_status:'google_not_provisioned' }` and throw `google_not_provisioned` (fail-close). When provisioned: mint an OAuth access token, `GET customers/{id}/googleAds:searchStream` a trivial query to validate.
- `createCampaign`/`createAdSet`/`createAd`/`setStatus`/`getStatus` — bodies documented to the §4.0b `mutate` shape (`campaignBudgets:mutate` → `campaigns:mutate` → `adGroups:mutate` → `adGroupAds:mutate`, or the combined atomic `googleAds:mutate`), headers `developer-token` + `login-customer-id` + `Authorization`. **Implementation gated on §7 Google-*; until then every method throws `google_not_provisioned`.**

### 4.4 Edge functions (all POST; `verify_jwt=true`; in-code `admin_users` gate; service-role DB writes)

Reuse `_shared/cors.ts` and the #862 admin-gate pattern (`requireUserId(req)` → `admin_users` active check → 403). Add each to `supabase/config.toml` as `[functions.<name>] verify_jwt = true`. **These generalize #862's `admin-meta-*` functions** — the body carries `{ platform, lane, … }` and dispatches via `getAdapter(platform)`.

**(a) `admin-ad-connect`** — Body `{ platform, lane, action:'connect'|'status' }`.
- `connect`: `getAdapter(platform).connect(conn)`; on success upsert `ad_connections` (`connected=true`, `token_status='valid'`, `token_last_verified_at=now()`, `account_status`, `currency`, `timezone`, `has_funding`, `min_budget_micro`). On mint/permission failure → upsert `token_status='invalid'`, `connected=false`; return **424** `{error:'<platform>_not_connected', detail}`. **Google** → **409** `{error:'google_not_provisioned'}` (distinct from 424 — it's a provisioning gap, not a broken token).
- `status`: re-verify; refresh the row.
- Output: the `ad_connections` row (no token) + a non-secret echo of the account fields.

**(b) `admin-ad-create-campaign`** ← the atomic create. Body:
```
{ platform, lane, name, objective='TRAFFIC',
  optimization_goal='LANDING_PAGE_VIEW',
  budget:{ level:'campaign'|'adset', type:'daily'|'lifetime', amount_micro:int, end_time?:iso },
  targeting:{ countries:[…] },
  destination:{ page_type, brand_slug, entity_slug?, event_id? },
  creative:{ headline, brand_name?, call_to_action?='VIEW_MORE', top_snap_media_id?|media_upload_ref?, creative_id? } }
```
- **Pre-flight (fail-close, before ANY provider write):** (1) load the `platform`/`lane` connection; `!connected || token_status!=='valid'` → **424** `<platform>_not_connected` (Google → **409** `google_not_provisioned`). (2) resolve destination READ-ONLY from `business_public_events_view`; not public+live → **422** `destination_not_public`; build `dest_url` + `dest_smart_link` (reuse #862 A1 OneLink construction). (3) validate `budget.amount_micro >= connection.min_budget_micro` for the chosen level → else **422** `budget_below_minimum`.
- **Provider create sequence (Snapchat; order fixed; collect IDs; NO DB rows yet):** campaign → ad squad → (media upload if needed) → creative → ad, all `PAUSED`, via the adapter. Read back the ad `review_status`.
- **Persist (one transaction, only after all provider IDs exist):** insert `ad_campaigns` + `ad_sets` + `ads` rows; append an `ad_status_events` `action='create'`.
- **Partial-failure contract (no orphans):** if any provider step fails, write **no** DB rows; attempt compensating cleanup (`DELETE /campaigns/{id}` — cascades); if cleanup fails, append `ad_status_events` `action='create_failed'` with `provider_ids` = the partial IDs. Return **502** `ad_create_failed` with `normalizeAdError`.
- Output: the persisted `ad_campaigns` row + its `ad_sets`/`ads`.

**(c) `admin-ad-campaign-action`** ← launch / pause. Body `{ campaign_id:<our uuid>, action:'launch'|'pause' }`.
- `launch`: fail-close on connection; adapter `setStatus` **top-down** (campaign → ad set → ad = `ACTIVE`); re-read `review_status`; update rows `status='ACTIVE'` + `delivery_status` + `status_synced_at`; append `action='launch'`. If the ad `review_status ∈ {PENDING, REJECTED}` → **200** with a `warning` so the UI surfaces it (the launch call succeeded; delivery waits on Snapchat review).
- `pause`: adapter `setStatus` campaign `PAUSED`; update + append `action='pause'`.
- Output: updated rows (+ optional `warning`).

**(d) `admin-ad-campaign-sync`** ← status read (no attribution). Body `{ campaign_id?:<our uuid> }` (one or all). Adapter `getStatus`; update `status`/`delivery_status`/`ads.review_status`/`status_synced_at`. `verify_jwt=true` admin; MAY also accept a service-role Bearer for a future cron. **No conversion/insights fields here** (those are #865).

### 4.5 Service + hook (mingla-admin)
- `mingla-admin/src/services/adEngine.js` — generalize the #862 `metaAds.js` wrappers to `supabase.functions.invoke('admin-ad-*', { platform, lane, … })`; typed request/response; surface `normalizeAdError` messages.
- `mingla-admin/src/hooks/useAdEngine.js` (or Context, matching admin conventions) — per-platform connection state, campaign list, create/launch/pause mutations with `onError` toasts. Match the existing admin data pattern (direct Supabase calls + Context).

### 4.6 Component layer (mingla-admin) — see §5 for exact states.

---

## 5. Admin UI states (per-state success criteria; single surface → no per-platform split)

Extend the #862 route **`/ad-engine`** with a **channel picker** (Meta · Snapchat · Google). Reachable only by an active admin.

- **SC-1 — Channel picker:** three tabs. Meta (from #862), **Snapchat** (functional), **Google** (blocked). Each tab shows its connection state.
- **SC-2 — Snapchat Not configured** (`SNAPCHAT_REFRESH_TOKEN`/`CLIENT_ID`/`CLIENT_SECRET` unset → mint fails): prerequisite note + disabled "Connect" ("Provision the Snapchat OAuth secrets first"). Create impossible (fail-close).
- **SC-3 — Snapchat Connecting/Connected:** spinner on Connect (no duplicate submits); on success show ad-account name/id ("Mingla Ads" `6421cc96-…`), currency USD, timezone, **funding: Active** (the live VISA source), pixel name. "Create campaign" enabled. (No amber billing warning — unlike Meta, Snapchat billing is live.)
- **SC-4 — Snapchat Disconnected/Invalid** (`token_status='invalid'` — refresh token revoked/expired): red banner "Snapchat connection invalid — the refresh token could not mint an access token. Re-provision `SNAPCHAT_REFRESH_TOKEN`." + "Reconnect". Create disabled.
- **SC-5 — Snapchat Create campaign form:** name; objective (default **Traffic**); **destination picker** (live public page → `dest_url` preview + resolved `dest_smart_link`); budget level (campaign/ad-squad) + daily/lifetime + amount with **min enforced** (`min_budget_micro`, shown in dollars: squad ≥ $5, campaign ≥ $20); optimization goal (Swipes / Landing-page views); targeting (countries multiselect); creative (media upload or existing `top_snap_media_id`, headline ≤34, brand name ≤32, CTA select). Submit → create; on success "Created — **Paused**. Review, then Launch."
- **SC-6 — Snapchat Campaign list/detail:** each row: name, objective, budget, **two badges** — advertiser `status` (Paused/Active) and **ad `review_status`** (Pending review / Approved / Rejected). Actions: **Launch** (when Paused), **Pause** (when Active), open **destination link**, **Sync status** (`admin-ad-campaign-sync`).
- **SC-7 — Google Provisioning-blocked:** the Google tab renders a **blocked** panel: "Google Ads is not provisioned yet." + the §7 Google checklist (developer token pending, MCC, OAuth client) + a disabled "Connect". No create path. `admin-ad-connect{platform:'google'}` returns **409** `google_not_provisioned` and the UI shows the checklist.
- **SC-8 — Error:** any edge error renders inline with the normalized provider message + `trace_id`; a `*_not_connected`/424 routes back to Connect; a `409 google_not_provisioned` routes to SC-7. Nothing silently succeeds.

---

## 6. Security

- **SC-SEC-1 — Token at rest / in transit:** no provider credential is ever in the DB, an edge response, `provider_response`/logs, or the client bundle. For **Snapchat** the refresh token + client secret live only as Supabase Function Secrets (`SNAPCHAT_REFRESH_TOKEN`, `SNAPCHAT_CLIENT_ID`, `SNAPCHAT_CLIENT_SECRET`); the minted access token exists **only in edge memory** (module-scope cache) and is never persisted — this **is** our stack's token mechanism, identical to #862 (`META_SYSTEM_USER_TOKEN`), Stripe (`STRIPE_RAK_*_LIVE`), Paystack, AppsFlyer. **NO at-rest DB token encryption** (env/Supabase secrets only). For **Google** the developer token + OAuth refresh token + client secret + `login-customer-id` live only as Function Secrets.
- **SC-SEC-2 — Distinct from any MCP/OAuth exploration:** production control uses Mingla's own OAuth app + refresh token server-side; no per-user OAuth flow is built.
- **SC-SEC-3 — Scopes (least-privilege):** Snapchat token carries `snapchat-marketing-api` (create/manage) — the offline-conversions scope on the same refresh token is used by #865, not here. Google: `https://www.googleapis.com/auth/adwords`.
- **SC-SEC-4 — Authorization:** gateway `verify_jwt=true` → in-code `getUser` (401) → `admin_users` active gate (403) on **every** `admin-ad-*` function. Client access to `ad_*` tables is admin-read-only via `is_admin_user()` RLS; writes are service-role-only.
- **SC-SEC-5 — Fail-close:** missing/unmintable Snapchat token → `snapchat_not_connected` (424); missing Google provisioning → `google_not_provisioned` (409); destination not public → 422; below-minimum budget → 422. No path proceeds to spend on a broken/absent connection.

---

## 7. Provider-side prerequisites Seth must provision (ACTION ITEMS)

### Snapchat — mostly DONE (live-probe verified 2026-07-14); one item to confirm
1. **DONE** — Org `9389df65-…`, ad account "Mingla Ads" `6421cc96-…` (ACTIVE, USD), **funding source ACTIVE** (VISA, $15k/day), pixel `af5f8fc4-…` (ACTIVE), OAuth app "Mingla Ads Engine" (client `0c517e9f-…`), **verified refresh token**.
2. **DONE** — Secrets set: `SNAPCHAT_REFRESH_TOKEN`, `SNAPCHAT_CLIENT_ID`, `SNAPCHAT_CLIENT_SECRET` (server-side only). `BUSINESS_WEB_ORIGIN` already exists (reused for `dest_url`).
3. **Snap-3 (CONFIRM before live-fire):** creatives require a **`profile_properties.profile_id`** = the Snap **Public Profile** for "Usemingla". The org has `snapchat_username:"usemingla"`; confirm the Public Profile id and set it as `ad_connections.profile_or_page_id` (the implementor reads it during connect, or Seth supplies it). Without a Public Profile id, creative-create fails. (No pixel install needed here — that's #865.)

### Google — PROVISION-BLOCKED (all outstanding; developer-token application is SLOW — do #1 NOW)
1. **Apply for a Google Ads developer token NOW** (long lead time): create/sign in to a **Google Ads manager account (MCC — not a test manager)**, go to the **API Center** (`ads.google.com/aw/apicenter`), submit the API Access form (live company website, monitored compliance email). The token starts at **Test-account access / Pending approval**; **Basic access** (production accounts) requires review approval — this is the critical-path blocker.
2. **Create the Google Ads (advertiser) account** under the MCC and add a billing/payment method.
3. **Create an OAuth 2.0 client** (Google Cloud console) for the `adwords` scope; complete the consent + generate a **refresh token** for the server.
4. **Capture the customer id** (advertiser) + **`login-customer-id`** (the MCC).
5. **Set secrets:** `GOOGLE_ADS_DEVELOPER_TOKEN`, `GOOGLE_ADS_REFRESH_TOKEN`, `GOOGLE_ADS_OAUTH_CLIENT_ID`, `GOOGLE_ADS_OAUTH_CLIENT_SECRET`, `GOOGLE_ADS_LOGIN_CUSTOMER_ID`, `GOOGLE_ADS_CUSTOMER_ID`, `GOOGLE_ADS_API_VERSION`.
6. **Seed the Google connection** (`ad_connections` `platform='google', lane='consumer'`) once 1–5 are done; the adapter flips from `google_not_provisioned` to live with no further code beyond wiring the documented `mutate` bodies.

---

## 8. Acceptance criteria + test plan

### Snapchat lane — testable NOW (`AC-S-*`)
- **AC-S-1:** `admin-ad-connect{platform:'snapchat'}` with valid secrets mints an access token from the refresh token, validates against org `9389df65-…` + account `6421cc96-…`, and persists `ad_connections` (`platform='snapchat', lane='consumer', connected=true, token_status='valid', currency='USD', timezone='America/New_York', has_funding=true, account_status='ACTIVE'`). Missing/expired refresh token → **424** + `token_status='invalid'`, `connected=false`, and **zero** Marketing-API create calls.
- **AC-S-2:** `admin-ad-create-campaign{platform:'snapchat'}` creates **exactly one** campaign + ad squad + creative + ad on Snapchat (all `PAUSED`) and persists **one** `ad_campaigns` + one `ad_sets` + one `ads` row with all provider IDs + `dest_smart_link` + `status='PAUSED'` + a read-back `review_status`.
- **AC-S-3:** budgets are stored/sent in **micro**; an ad-squad budget `< 5000000` (or campaign `< 20000000`) is rejected **422 `budget_below_minimum`** *before* any provider write.
- **AC-S-4:** a destination that is not a **public + live** page → **422 `destination_not_public`** before any provider write; a valid one yields the correct `dest_url` + `dest_smart_link`.
- **AC-S-5:** `launch` sets campaign+adsquad+ad `ACTIVE` top-down and updates `status`/`review_status`; `pause` returns them to `PAUSED`; both append an `ad_status_events` row.
- **AC-S-6 (no orphans):** if the ad-squad/creative/ad create fails, **no** `ad_*` rows are written, the created campaign is deleted on Snapchat (or a `create_failed` audit row captures partial IDs), and the caller gets **502 `ad_create_failed`**.
- **AC-S-7 (fail-close):** with `SNAPCHAT_REFRESH_TOKEN` unset, connect/create/launch all return `snapchat_not_connected` (424) — never a silent success, never a Marketing-API call.
- **AC-S-8 (token mint + cache):** the adapter mints one access token, reuses it within its ~60-min window, and re-mints after expiry; a mint 4xx (revoked refresh token) fails-close, it does not proceed with a stale/empty token.
- **AC-S-9 (authz):** a non-admin JWT gets 403 on every `admin-ad-*` function; a non-admin cannot `SELECT` any `ad_*` table (RLS).
- **AC-S-10 (no token leak):** no refresh token or minted access token appears in any edge response, `provider_response`, log line, DB column, or the admin client bundle.

### Google lane — BLOCKED on §7 provisioning (`AC-G-*`, cannot pass until then)
- **AC-G-1 (now):** `admin-ad-connect{platform:'google'}` with secrets unset returns **409 `google_not_provisioned`** and the UI renders the SC-7 checklist; no Google API call is attempted.
- **AC-G-2 (post-provisioning):** once §7 Google 1–6 land, `admin-ad-connect{platform:'google'}` validates via a GAQL `searchStream` and persists the connection; create/launch/pause exercise the documented `mutate` bodies (campaignBudget→campaign→adGroup→adGroupAd, atomic; all created PAUSED). *(Gated — verified in a follow-up once the developer token is approved.)*

### Test plan
**Unit / integration (edge, Deno test — reuse `__tests__` convention):**
- Snapchat token-absent → fail-close (drives AC-S-7 + the RT-1 regression contract §9).
- Snapchat mint cache: two adapter calls within the window → one mint HTTP call; after expiry → re-mint (AC-S-8).
- create happy path with a mocked Snapchat returning the batch envelope + IDs → one campaign/adset/ad row set, all IDs present (AC-S-2).
- create with ad-squad-step failure → no DB rows + compensating `DELETE /campaigns/{id}` invoked (AC-S-6).
- budget-below-min and destination-not-public → 422 before any Snapchat call (AC-S-3/AC-S-4).
- `sub_request_status:'FAILURE'` inside an HTTP 200 → treated as an error, not a success (envelope contract).
- response-body + `provider_response` never contain a token (AC-S-10).
- Google adapter with secrets unset → `google_not_provisioned` (AC-G-1).

**RLS (SQL):** an ordinary authenticated user `SELECT` on all five `ad_*` tables → 0 rows/denied; `is_admin_user()` returns them (AC-S-9).

**Live-fire (mingla-tester, real spend — Snapchat, runnable now):** connect → create a **$5/day ad-squad `TRAFFIC`** campaign whose destination is a real **live** Mingla event page → verify it exists PAUSED in Snapchat Ads Manager and in `ad_campaigns`/`ad_sets`/`ads` with matching IDs → **launch** → confirm `status=ACTIVE` and `review_status` becomes `PENDING`→`APPROVED` (or surfaces `REJECTED`) → **pause** → cleanup. Capture screenshots + the IDs. **(Confirm Snap-3 Public Profile id first.)**

**Security check (mingla-tester):** build the admin bundle and `grep -r` for the Snapchat secrets → **absent**; inspect connect/create/launch network responses → tokens **absent**; confirm the tokens exist only as Supabase Function Secrets.

---

## 9. Invariants + regression prevention

### Invariants preserved / established
- **Preserve I-ADMIN-GATE:** every write path re-checks `admin_users` active. Test: AC-S-9.
- **Preserve immutable-slug contract:** we only **read** slugs; `dest_url`/`dest_smart_link` durability relies on their immutability. Test: AC-S-4.
- **I-PROPOSED-AD-TOKEN-ENV-ONLY (DRAFT):** no provider token (incl. the Snapchat refresh token AND the minted access token) appears in any DB column, response, log, or client bundle; the minted access token lives only in edge memory. (Generalizes #862's `I-PROPOSED-META-TOKEN-ENV-ONLY`; flips ACTIVE at CLOSE — orchestrator owns the flip.)
- **I-PROPOSED-AD-NO-ORPHAN-WRITE (DRAFT):** an `ad_campaigns`+`ad_sets`+`ads` row set exists **iff** all provider IDs exist; partial provider creates leave no DB rows.
- **I-PROPOSED-AD-FAIL-CLOSE (DRAFT):** create/launch/connect refuse and return `<platform>_not_connected` (424) / `google_not_provisioned` (409) when the credential is absent/invalid/unmintable.

### Regression contract (fails-on-revert)
- **RT-1 (fail-close):** edge test asserts Snapchat token-absent → `snapchat_not_connected` and **zero** Marketing-API calls. **Reverting the `mintSnapAccessToken()` throw makes RT-1 fail; restoring it passes.** Protective comment on the throw explains why (no silent spend on a broken connection).
- **RT-2 (no orphan):** edge test asserts an ad-squad-step failure yields no `ad_*` inserts + a compensating campaign delete. Reverting the "insert only after all IDs" ordering fails RT-2.
- **RT-3 (envelope contract):** edge test asserts an HTTP 200 carrying `sub_request_status:'FAILURE'` is treated as a create failure (→ RT-2 path), not a success. Reverting the `sub_request_status` check fails RT-3.
- **RT-4 (no token leak) — strict-grep CI gate:** a repo grep asserts `SNAPCHAT_REFRESH_TOKEN` / `SNAPCHAT_CLIENT_SECRET` / `GOOGLE_ADS_*` token access appears **only** under `supabase/functions/**` and **never** under `mingla-admin/src/**`, `app-mobile/**`, `mingla-business/**`. Fails CI if a future change references a token client-side. (House strict-grep-registry pattern; extends #862's RT-3.)
- No `app.json`/`eas.json`/store-submit change → the `I-RELEASE-VERSION-PARITY` / `I-RELEASE-SUBMIT-CONFIG` gates (COMMS-0096/0097) are untouched (respected).

---

## 10. Implementation order + scoped allowlist

### The `meta_*` generalization dependency (READ FIRST)
This story's schema **is the generalized form of #862's `meta_*` tables**. Coordinate one of:
- **(preferred) #862 lands first**, then #867's migration **renames** `meta_ad_connections`→`ad_connections` (+ the platform/lane/auth_kind columns), `meta_campaigns`→`ad_campaigns` (+ split `ad_sets`/`ads`), `meta_campaign_status_events`→`ad_status_events`, refactors `admin-meta-*`→`admin-ad-*` (platform dispatch), and moves Meta behind `metaAdapter: ChannelAdapter`. **OD-1.**
- **(fallback) #867 lands first / independently:** the migration **creates** the generalized tables fresh; #862's Meta path is folded in when it merges. Since neither `meta_*` nor `ad_*` tables exist on `main` today (verified), this is clean either way.
Whichever path: the **end state has no `meta_*`-prefixed table** and one `ChannelAdapter` registry. The orchestrator sequences #862/#863/#867 to avoid a double-create; if a conflict is detected at IMPLEMENT, request a `SPEC_AMENDMENT_ISSUE-867_*`.

### Order (DB → shared → edge → config → admin UI)
1. **Migration** `supabase/migrations/<ts>_issue_867_ad_engine_generalize.sql` — the five generalized tables (create-or-rename per OD-1) + RLS + indexes + `updated_at` triggers.
2. **`_shared/adChannel.ts`** — interface + registry + `normalizeAdError`.
3. **`_shared/snapAuth.ts`** — refresh-token mint + cache (fail-close).
4. **`_shared/snapchat.ts`** — `snapchatAdapter` (connect/create/setStatus/getStatus + compensating delete + envelope assertion).
5. **`_shared/google.ts`** — `googleAdapter` stub (fail-close `google_not_provisioned`; documented `mutate` bodies).
6. **Edge fns** `admin-ad-connect`, `admin-ad-create-campaign`, `admin-ad-campaign-action`, `admin-ad-campaign-sync` (+ `__tests__`), dispatching by `platform` (fold in Meta per OD-1).
7. **`supabase/config.toml`** — four `[functions.admin-ad-*] verify_jwt = true` blocks.
8. **mingla-admin** — `services/adEngine.js`, `hooks/useAdEngine.js`, channel picker on `/ad-engine`, Snapchat components (SC-2…SC-6), Google blocked state (SC-7).
9. **CI** — add/extend the RT-4 strict-grep gate for the Snapchat/Google secret names.

### Allowlist (implementor MAY create/modify ONLY these)
- `supabase/migrations/<ts>_issue_867_ad_engine_generalize.sql` (new)
- `supabase/functions/_shared/{adChannel,snapAuth,snapchat,google}.ts` (new)
- `supabase/functions/admin-ad-connect/**`, `admin-ad-create-campaign/**`, `admin-ad-campaign-action/**`, `admin-ad-campaign-sync/**` (new)
- `supabase/functions/_shared/meta.ts` + `admin-meta-*/**` — **only** to refactor Meta behind the `ChannelAdapter` per OD-1 (rename/fold; coordinate with #862's owner)
- `supabase/config.toml` (append/rename function blocks only)
- `mingla-admin/src/**` (channel picker + Snapchat components + Google blocked state; generalize the #862 service/hook; wire into the existing admin nav only)
- CI workflow file for the RT-4 strict-grep gate (append/extend a job)

### DO-NOT-TOUCH (stop-and-amend before any edit)
- Any existing `supabase/functions/{stripe*,brand-stripe-*,*paystack*,events,discover-*}/**` and `_shared/{stripe*,paystack*,appsFlyerS2S,stripeEdgeAuth,cors,audit,idempotency}.ts` (reuse by import; do not modify).
- **#865's** `attribution-capture`, `_shared/metaCapi.ts`/`tiktokEvents.ts`, Snap Conversions API paths, and any pixel-install code — Snapchat/Google CONVERSIONS are #865, not here.
- Existing migrations, `brands`/`events`/`orders`/`admin_users` schemas (read `business_public_events_view` + `is_admin_user()` only; add no columns).
- `app-mobile/**`, `mingla-business/**` (no consumer/business/public-web code changes — public web is destination-reference only).
- Any `app.json` / `eas.json` / store-submit config.
Anything outside the allowlist → request a `SPEC_AMENDMENT_ISSUE-867_*` before touching.

---

## 11. Open decisions (with recommendations)

- **OD-1 — Schema generalization sequencing:** #862 lands first then #867 renames `meta_*`→`ad_*` **[RECOMMEND — one clean rename, no duplicate create]** vs. #867 creates the generalized tables and #862 folds in. Orchestrator sequences; migration handles both via create-or-rename.
- **OD-2 — Snapchat token cache scope:** module-scope in-memory cache per edge instance, re-mint on expiry **[RECOMMEND — simplest, matches the stateless-edge model; a cold instance just re-mints]** vs. a shared cache table (adds a token-at-rest surface — rejected, violates the no-DB-token invariant).
- **OD-3 — Budget level:** ABO (budget on the ad squad) for MVP **[RECOMMEND — Snapchat's default; simplest single-squad campaign; min $5/day]** vs. CBO (campaign-level, min $20/day). Expose both in the form; default ABO daily.
- **OD-4 — Objective/goal:** `TRAFFIC` + `LANDING_PAGE_VIEW` **[RECOMMEND — highest-intent traffic to a reservation page]** vs. `SWIPES` (cheaper, lower intent). Expose both; default Landing-page views. (Note `LANDING_PAGE_VIEW`/`PIXEL_*` goals optimize better once #865's pixel is installed — until then `SWIPES` is the safe default.)
- **OD-5 — Snap creative Public Profile:** confirm and store the "Usemingla" Public Profile id (§7 Snap-3) at connect **[RECOMMEND — required for creative-create; block live-fire until confirmed]**.
- **OD-6 — Snap media upload in MVP:** support a single in-form media upload (`POST /media` + upload) **[RECOMMEND — needed for a functional ad]** vs. accept only an existing `top_snap_media_id`/`creative_id`. The full reusable asset library is #866.
- **OD-7 — Google developer-token access tier:** apply for **Basic access** immediately (Test access only reaches test accounts; our own production account needs Basic) **[RECOMMEND — start the slow review now]**. Confirm whether Explorer access suffices for own-account management during IMPLEMENT.
- **OD-8 — Google delivery gate:** persist `ad_group_ad.policy_summary.approval_status` as the Google `delivery_status` **[RECOMMEND — mirrors Snap `review_status` / Meta `effective_status`]**.

---

## Downstream routing
**Next:** `mingla-implementor` — build the **Snapchat lane end-to-end from this SPEC now** (it is live-fireable: real IDs, verified token, live-probe evidence). The **Google lane** ships to the same `ChannelAdapter` interface but stays fail-closed (`google_not_provisioned`) until §7 Google provisioning lands — implement its `mutate` bodies as a fast-follow once the developer token is approved. → `mingla-tester` (RLS + fail-close + token-mint cache + no-orphan + Snapchat live-fire; Google `AC-G-1` now, `AC-G-2` post-provisioning). → orchestrator CLOSE.
**Working tree:** `~/Desktop/mingla-orchs/issue-867-snapchat-google-channels/` on branch `issue-867-snapchat-google-channels`.

---
---

# Amendment A1 — battle-test corrections (2026-07-15, evidence-backed)

**Author:** mingla-forensics (SPEC mode, docs-only) · **Date:** 2026-07-15
**Evidence base:** `GAP_REGISTER.md` §2–§6 (consolidated 5-channel register, 2026-07-14) + `PROOF_LOG.md` (2026-07-15 live probes with the **engine's own credentials** — S-P1…S-P5, G-P1…G-P3, D-P1) + `snapchat.md`/`google.md` full field research + `PIPELINE_BLUEPRINT.md` §1.8/§2.3/§2.4/§3 — all in `~/Desktop/mingla-orchs/issue-862-meta-ads-api/Mingla_Artifacts/research/ad-pipeline-2026-07-15/`.
**Precedence:** this amendment is **append-only**; where it conflicts with the body above, **the amendment wins**. Where the GAP register and the PROOF LOG conflict, **the PROOF LOG wins** (it is newer and probe-grade).
**Why this amendment exists:** the register proved this spec carries the most field-level errors of any channel spec — its Snapchat create sequence **cannot succeed as written** (four field-level errors across all four levels, GR-08), and its budget schema carries the **10,000× money bug** (GR-01) behind a **$15,000/day** live funding limit. The Google lane's "PROVISION-BLOCKED" premise is now **stale** — BASIC-tier access was approved 2026-07-15 and the full SEARCH+RSA chain validated clean against the real, billed account (G-P1/G-P3).

Every item below is stated as **old → new → evidence**.

---

## A1.0 Headline state changes (read before the diffs)

1. **Google is NO LONGER provision-blocked.** `[ENGINE-LIVE, G-P1]` Developer token **BASIC tier approved 2026-07-15**; `listAccessibleCustomers` → 200; `googleAds:search` on customer **`3623860476`** → `status: ENABLED`, `testAccount: false`, USD, **billed**. MCC (login-customer-id) = **`8284700017`**. **The old customer `5083048929` is dead — replace it everywhere; never reference it again.** The Asymmetry banner's Google column, §4.0b's "PROVISION-BLOCKED" framing, §7 Google items 1–4, and AC-G-2's gate are all superseded (details in A1.3). A3 §D registry `google/consumer`: AMBER → **GREEN** on account `3623860476`.
2. **The full Google SEARCH+RSA chain is PROVEN.** `[VALIDATE-ONLY, G-P3]` `googleAds:mutate` with `validateOnly:true, partialFailure:false` validated **clean** (`{}`): budget → campaign (PAUSED, SEARCH, targetSpend, PRESENCE geo type) → campaignCriterion (London `1006886`) → adGroup (SEARCH_STANDARD) → RSA (3 headlines ≤30 × 2 descriptions ≤90) → PHRASE keyword. Zero objects created (verified by list-after). It exposed **one NEW REQUIRED field in no spec** — see **G-14**.
3. **The Snapchat Public Profile preflight lookup specced at §7 Snap-3 is UNBUILDABLE.** `[ENGINE-LIVE, S-P4]` `GET https://businessapi.snapchat.com/v1/organizations/{org}/public_profiles` → **HTTP 403 "unauthorized"** on our token class (the `businessapi` host is not authorized for marketing-scoped tokens). The profile id is **UI-captured TRUSTED CONFIG**: `2cfbdc85-890c-43af-b393-10c0adbbad67`. See A1.2 item 8.
4. **Snap remains fully funded and live:** `[ENGINE-LIVE, S-P1/S-P2/S-P3/S-P5]` token mints (3600 s, both scopes), account "Mingla Ads" ACTIVE, funding ACTIVE at **$15,000/day**, pixel `af5f8fc4-…` ACTIVE. The envelope's `request_status` + per-item `sub_request_status` double structure was observed live (S-9 double-assert confirmed real).
5. **The A1-OneLink-as-destination design is VETOED by live evidence.** `[ENGINE-LIVE, D-P1]` `curl -A "facebookexternalhit/1.1" -L go.usemingla.com/w36m` → 302 to an **AppsFlyer app-install interstitial** (`/af-preview/…&af_robot_sig=…`, app-store meta tags only; HEAD → 404) — NOT the destination page. The cloaking-pattern risk is **real, not theoretical**. Destination policy v1 in A1.1(5).

---

## A1.1 Conductor-fixed canonical decisions (identical across the parallel #862/#863/#866/#867 amendments)

### (1) THE MONEY FIX — budgets in CENTS at rest (GR-01) 🔴

**Old (this spec):** `ad_campaigns.budget_micro bigint` / `ad_sets.budget_micro bigint` (§4.2); request body `budget:{ …, amount_micro:int }` (§4.4b); AC-S-3 asserts budgets "stored/sent in **micro**".
**Why it's a blocker:** A3 (the canonical engine model) pins budgets **in cents** at rest. Two specs disagreeing on the money unit is a classic 10,000× failure: $5.00 stored as `500` cents sent raw as micro = **$0.0005** (below every floor → reject — the loud case); `5000000` micro read as cents = **$50,000** (the silent case) — behind a **$15,000/day** funding limit. (GAP_REGISTER GR-01.)
**New (binding):**
- **At rest:** `budget_cents bigint` replaces `budget_micro` on `ad_campaigns` and `ad_sets` (same NULL/positivity CHECKs). Admin UI collects dollars, stores cents.
- **Conversion happens at exactly ONE boundary per adapter, nowhere else:** Snapchat `micro = cents × 10_000`; Google `micros = cents × 10_000`. No other layer converts; no layer stores micro.
- **Min-checks run in micro, AFTER conversion:** `cents × 10_000 ≥ min_budget_micro` (ad-squad floor `5_000_000`, campaign floor `20_000_000`). `ad_connections.min_budget_micro` is **retained in micro** as the platform-native floor constant (it is a provider constant, not a stored budget).
- **Mandatory unit tests (regression contract RT-5):** `$5.00 (500 cents) → 5_000_000 micro` and `$20.00 (2000 cents) → 20_000_000 micro`. A conversion in any other layer, or a min-check in cents, fails RT-5.
- **All ACs restated in cents** — see A1.4.

### (2) The A4-widened `ChannelAdapter` (being filed in #862 in parallel — this spec consumes it, does not redefine it)

**Old:** §4.3's interface is `connect/createCampaign/createAdSet/createAd/setStatus/getStatus` with one creative inline — a Meta cast that neither Snap nor Google fits (GR-15, GR-17).
**New (from #862 A4):**
- **`createCreative(conn, input)` — optional adapter method.** Snapchat: Media create → upload bytes → **poll `media_status` → `READY`** → Creative (→ poll creative `packaging_status` → `SUCCESS`). Google: assets created via `assets:mutate` first, then linked (only `TextAsset` is inline on the ad).
- **Create-ad input carries `headlines[]` / `descriptions[]` / `keywords[]` / `negative_keywords[]`** (Google RSA needs 3–15 headlines + 2–4 descriptions; a SEARCH campaign without keywords cannot meaningfully serve — GR-15).
- **`setBudget(conn, level, externalId, cents)`** — cents in, converted at the adapter boundary per (1).
- **Per-platform CTA maps** — never a shared normalizer (Snap's enum is per-creative-type; Reddit's is Title-Case strings; GR-29).
- **MVP = Google SEARCH+RSA ONLY.** **PMax is explicitly DEFERRED** — an asset group **plus all minimum-required assets must be created in a single bulk mutate with temp IDs** (`AssetGroupError.NOT_ENOUGH_*` otherwise); it is **not expressible as sequential `createX` calls** (GR-15). Recorded as a standing decision so nobody "adds PMax" through the sequential interface. §4.0b's `advertising_channel_type:SEARCH|DISPLAY|…` claim is **narrowed to `SEARCH`** for this story; DISPLAY leaves MVP scope.

### (3) Versions

**Old:** §4.0b — "e.g. `v25` current at time of writing".
**New:** **`GOOGLE_ADS_API_VERSION=v24`** — **v25 DOES NOT EXIST** (G-1; current is v24.2, 2026-06-24; v24 GA 2026-04-22). ~1-year support ⇒ **calendar the ~April-2027 v24 sunset**; add a **quarterly version checkpoint** for both channels to the ops calendar. (Snap's Marketing API is unversioned-in-path `v1` — no change.)

### (4) Create-PAUSED + atomicity + status semantics (blueprint §1.8)

- Everything is created **PAUSED** at every level, on both channels (unchanged from the body — re-affirmed).
- **Google `REMOVED` is PERMANENT** — there is no un-remove. Our `ARCHIVED`/`DELETED` statuses have **no Google equivalent**. The Google adapter's pause/launch paths send **only `ENABLED|PAUSED` in `updateMask:"status"` mutates and may NEVER emit `REMOVED`** (guarded by unit test — new AC-G-4).
- **Google is the ONLY channel with native atomicity:** `googleAds:mutate` with **`partialFailure:false`** rolls back the entire request if any op fails — it satisfies `I-PROPOSED-AD-NO-ORPHAN-WRITE` at the provider level, so the Google adapter needs **no compensating-delete path at all**. Capture `request_id` into `ad_status_events.provider_response` (it is what Google support requires).
- **Snapchat's compensating delete is NOT sufficient as specced** (§4.3 "Snapchat cascades child squad/ad/creative" — **unverified and probably false for creatives/media**, which are **ad-account-scoped** and almost certainly survive `DELETE /campaigns/{id}`; GR-48). The rollback path must **track every created creative id and media id**, attempt explicit deletes, verify the cascade live during live-fire, and on any residue append them to `ad_status_events.external_ids` for reconciliation.

### (5) Destination policy v1 (PROVEN by D-P1) — supersedes every `dest_smart_link`-as-URL usage in the body

**Old:** §4.0 creative `web_view_properties.url` (= the `dest_smart_link`); §4.3 `web_view_properties:{url:dest_smart_link}`; §4.0b `AdGroupAd.ad.final_urls:[dest_smart_link]`.
**New (binding, v1):**
- **Google:** `final_urls = [canonical usemingla.com page]` (= `dest_url`) + the OneLink **ONLY in `tracking_url_template`** — Google's sanctioned pattern (tracking template redirects; final URL is the real page).
- **Snapchat:** `web_view_properties.url` = the **canonical page** (`dest_url`) too for v1 (≤2048 chars, SSL/https required).
- **`minglabiz.onelink.me` is NEVER used anywhere** (dead on Android; COMMS-0100/0101).
- `ad_campaigns.dest_smart_link` **column is retained** (attribution reference + Google tracking template source) but is **demoted from ad-visible destination to tracking-only**.
**Evidence:** D-P1 — AppsFlyer serves ad-review crawlers an app-install interstitial, which reads as cloaking (Meta "Circumventing Systems" — account-level; Google "destination mismatch"; GR-32).

### (6) Snapchat optimization-goal default — OD-4 REVERSED (GR-21)

**Old:** §4.4(b) default `optimization_goal='LANDING_PAGE_VIEW'`; OD-4 recommends `LANDING_PAGE_VIEW`; SC-5 defaults Landing-page views.
**New:** **default `SWIPES`** until #865's pixel is live and firing. `LANDING_PAGE_VIEW` and every `PIXEL_*` goal are **gated in the UI and the edge fn on `pixel_installed`** (a #865 signal). When a pixel goal IS chosen, the adapter **must pass `pixel_id`** (`af5f8fc4-1ef6-41e7-81c5-042b7be7df38`) on the ad squad — it is required for those goals.
**Evidence:** GR-21 — optimizing to an event we don't send = no/erratic delivery; the Snap pixel is ACTIVE but `automatic_event_opt_in: OPT_OUT` and pixel install is #865, not #867.

### (7) Naming — reconciled to A3 §F (GR-42)

**Old (this spec §4.2):** `auth_kind IN ('bearer_token','refresh_token','oauth_service')`; columns `provider_campaign_id`, `provider_adset_id`, `provider_ad_id`, `provider_creative_id`, `provider_media_id`; `ad_status_events.provider_ids`.
**New (A3 §F is canonical):**
- `auth_kind IN ('system_user_token','refresh_token','dev_token_oauth')` — meta = `'system_user_token'`, **snapchat = `'refresh_token'`, google = `'dev_token_oauth'`** (tiktok's value is #863's to state).
- `external_campaign_id` / `external_adset_id` / `external_ad_id` / `external_creative_id` / `external_media_id` replace the `provider_*` id columns (UNIQUE constraints follow the rename, e.g. `UNIQUE (platform, external_campaign_id)`).
- `ad_status_events.provider_ids` → **`external_ids`** (`provider_response` keeps its name — it is not an id column).
- Platform value is **`'snapchat'`**, never `'snap'`; there is **no static `SNAP_ACCESS_TOKEN`** (S-8 — #866's drift, corrected there; recorded here so the RT-4 strict-grep covers the real names only).

---

## A1.2 SNAPCHAT SECTION — create-sequence fixes + hardening (all evidence-backed)

> The body's §4.0/§4.3/§4.4 Snap create sequence contains **four field-level errors across all four levels** (GR-08). As written: campaign, ad squad, and creative each 400 — and the ad-level error is worse: it can **succeed** and create an ad that can never reach the destination. Each fix below is an exact body diff.

### S-1 — campaign objective key is `objective_v2_type`, not `objective_v2` 🔴

- **Old (§4.0 campaign bullet + §4.3 `createCampaign`):** `objective_v2_properties.objective_v2` / `objective_v2_properties:{objective_v2:'TRAFFIC'}`.
- **New:** `objective_v2_properties: { objective_v2_type: 'TRAFFIC', promotion_type?: <enum> }`. The 5-value `objective_v2_type` enum in the body (`AWARENESS_AND_ENGAGEMENT | TRAFFIC | SALES | APP_PROMOTION | LEADS`) was correct — only the **key name** was wrong. `promotion_type` enum: `PROMOTE_PLACES | PROMOTE_SHOWS | APP_INSTALL | APP_REENGAGEMENT` (see item 12).
- **Evidence:** GAP_REGISTER §4 S-1; `snapchat.md` §2 field table (`{ "objective_v2_type": <enum>, "promotion_type": <enum> }`); https://developers.snap.com/marketing-api/Ads-API/campaigns

### S-2 — ad `type` for a `WEB_VIEW` creative is `REMOTE_WEBPAGE`, not `SNAP_AD` 🔴

- **Old (§4.0 Ad bullet + §4.3 `createAd`):** `type` (`SNAP_AD`) / `{name, creative_id, type:'SNAP_AD', status:'PAUSED'}`.
- **New:** ad `type` is **derived from a creative-type→ad-type map, never hardcoded**: `WEB_VIEW → REMOTE_WEBPAGE` (also `APP_INSTALL→APP_INSTALL`, `DEEP_LINK→DEEP_LINK`, `COLLECTION→COLLECTION`, `LEAD_GENERATION→LEAD_GENERATION`). Assert the map in a unit test.
- **Why it matters:** `SNAP_AD` is the **attachment-less top snap**. Best case the create 400s (loud); worst case it **succeeds and we pay for impressions that can never reach the destination page** — the entire point of the engine, silently defeated.
- **Evidence:** GAP_REGISTER §4 S-2; `snapchat.md` §4c ("the `optimization_goal`+`conversion_window` combos *'can be used with the Creative type WEB_VIEW and the **Ad type REMOTE_WEBPAGE**'*"; full 16-value ad-type enum); https://developers.snap.com/marketing-api/Ads-API/ads

### S-3 — CTA `VIEW_MORE` does not exist, on any creative type 🔴

- **Old (§4.0 creative bullet, §4.3 creative helper, §4.4b `call_to_action?='VIEW_MORE'`, SC-5):** default CTA `VIEW_MORE`.
- **New:** **per-creative-type CTA allowlist validated BEFORE the provider call → `422 invalid_cta`.** The `WEB_VIEW` allowlist (exact 23 values): `APPLY_NOW, MORE, ORDER_NOW, PLAY, READ, SHOP_NOW, SHOW, SIGN_UP, VIEW, WATCH, DONATE, DOWNLOAD, RESPOND, BUY_TICKETS, SHOWTIMES, BOOK_NOW, GET_NOW, LISTEN, TRY, VOTE, VIEW_MENU, PRE_REGISTER, PLAY_GAME`. **Default `BOOK_NOW` (bookable) / `BUY_TICKETS` (ticketed)** for reservation traffic — far higher intent than `MORE`/`VIEW`. Expose as an admin select, never a free string. Per A1.1(2), the CTA map is per-platform.
- **Evidence:** GAP_REGISTER §4 S-3; `snapchat.md` "FULL `call_to_action` enum BY creative type" table + "**`VIEW_MORE` IS NOT A VALID CTA — on any type**"; https://developers.snap.com/marketing-api/Ads-API/creatives

### S-4 — `delivery_constraint` is REQUIRED on the ad squad and absent from the body 🔴

- **Old (§4.0 Ad Squad bullet + §4.3 `createAdSet`):** no `delivery_constraint`.
- **New:** `delivery_constraint` is **REQUIRED**: `DAILY_BUDGET | LIFETIME_BUDGET | REACH_AND_FREQUENCY` — **derived from the budget field used** (`daily_budget_micro` ⇒ `DAILY_BUDGET`; `lifetime_budget_micro` ⇒ `LIFETIME_BUDGET`; R&F only with `buy_model=RESERVED`, out of MVP). The adapter derives it; it is not admin input.
- **Evidence:** GAP_REGISTER §4 S-4; `snapchat.md` §3 field table (`delivery_constraint` marked **R**, "must match the budget field used"); https://developers.snap.com/marketing-api/Ads-API/ad-squads

### S-6 — never send the legacy `objective` field

- **Old:** the body never sends it, but nothing forbids it.
- **New (guard):** campaign create bodies **must never contain the key `objective`** — it is **DEPRECATED**, auto-translated by a translator service since **21 Mar 2025**; sending it invites the translator's default instead of our intent. Unit-test the constructed body for key absence.
- **Evidence:** GAP_REGISTER §4 S-6; `snapchat.md` §2 (`objective` — "**DEPRECATED** … Do not use").

### S-7 — `MIN_ROAS` bid strategy is deprecated

- **Old (§4.0):** `bid_strategy` (`AUTO_BID` | `LOWEST_COST_WITH_MAX_BID` + `bid_micro` | `TARGET_COST`) — already omits `MIN_ROAS`, correctly.
- **New (lock it):** `MIN_ROAS` was **deprecated 10 Feb 2025** — the allowlist is exactly the three values above and `MIN_ROAS` must be rejected if ever submitted. (`bid_micro`: required for `LOWEST_COST_WITH_MAX_BID`/`TARGET_COST`, omit for `AUTO_BID`; min `10_000` micro.)
- **Evidence:** GAP_REGISTER §4 S-7; `snapchat.md` §3 (`MIN_ROAS` "**deprecated 10 Feb 2025**").

### S-9 — keep the `request_status` AND `sub_request_status` double-assert (re-affirmed, now probe-proven)

- **Old (§4.0 envelope + §4.3 `snapGraph` + RT-3):** correct as written — **preserve unchanged**.
- **New evidence strengthens it:** the live S-P5 probe observed the envelope carrying `request_status` + per-item `sub_request_status` on a real response. An HTTP 200 with `request_status:"SUCCESS"` can still carry a per-entity `sub_request_status:"FAILURE"`; both must be asserted. RT-3 protects this.
- **Evidence:** PROOF_LOG S-P5; GAP_REGISTER §4 S-9.

### 8. GR-07 corrected per PROOF_LOG — Public Profile is TRUSTED CONFIG; the specced preflight lookup is UNBUILDABLE 🔴

- **Old (§7 Snap-3 / OD-5):** "confirm the Public Profile id … the implementor reads it during connect". The register's own fix (resolve `profile_id` during `connect()` via `GET businessapi.snapchat.com/v1/organizations/{org}/public_profiles`) is ALSO dead.
- **New (PROOF_LOG wins):** that lookup returns **HTTP 403 "unauthorized" on our token class** (S-P4 — the `businessapi` host is not authorized for the marketing-scoped token; the Public Profile API is read-only and, for us, unreachable). Therefore:
  - `SNAPCHAT_PROFILE_ID` = **`2cfbdc85-890c-43af-b393-10c0adbbad67`** (UI-captured 2026-07-15) is **TRUSTED CONFIG**, seeded into `ad_connections.profile_or_page_id`.
  - **Preflight = config-presence only:** `connect()` checks the value is non-null (no API verification is possible pre-create; Snap has no validate-only).
  - **Fail-close at create:** `admin-ad-create-campaign` pre-flight returns **`424 snapchat_profile_missing`** if `profile_or_page_id` is null — before ANY provider write.
  - **The first creative create is the verification** — an invalid profile id surfaces there. Accepted residual risk, recorded.
- **Evidence:** PROOF_LOG S-P4 (**overrides** GAP_REGISTER GR-07's connect-time-lookup fix); GR-07 for the underlying mandatory-profile fact (Public Profiles mandatory for all Snap advertisers since June 2022).

### 9. GR-38 — review polling + both review vocabularies + reasons persisted

- **Old (§4.0 status model / §4.2 `ads.review_status` / §4.4d sync):** persists ad `review_status` only; sync is manual/admin-triggered; `review_status_reasons` and `delivery_status` are dropped.
- **New:**
  - **Schema:** `ads.review_status_reasons jsonb NULL` (array of strings — the **only** machine-readable Snap rejection signal); `delivery_status jsonb NULL` on **all three** of `ad_campaigns`/`ad_sets`/`ads` (Snap returns it as an array at every level; the campaign-level text rollup in the body is replaced by this jsonb).
  - **Two review vocabularies, BOTH persisted:** the **creative** enum is `PENDING_REVIEW | APPROVED` — **different from the ad** enum `PENDING | APPROVED | REJECTED`. Add `ads.creative_review_status text NULL`. Mapping one onto the other loses the distinction; don't.
  - **Cron-driven sync (upgrade of §4.4d's "MAY accept a service-role Bearer for a future cron" → MUST):** poll every **30–60 min while any ad is PENDING/PENDING_REVIEW, then daily** — Snap **re-reviews post-launch** and can pause a live campaign; review is 3–5 business days standard (5–10 restricted), no published SLA — treat as unbounded and poll. Surface `review_status_reasons` verbatim; alert on `REJECTED`.
- **Evidence:** GAP_REGISTER GR-38; `snapchat.md` §4c read-only fields (`review_status`, `review_status_reasons`, `delivery_status`).

### 10. GR-39 — default demographics `min_age: "18"` (strings)

- **Old (§4.0/§4.3 targeting):** geos-only (`{geos:[{country_code}]}`).
- **New:** targeting input widens to accept `demographics` and the adapter **defaults `demographics:[{min_age:'18'}]`** when the admin sets none. **`min_age`/`max_age` are STRINGS** (`"18"`, not `18`); `genders ∈ MALE|FEMALE` (no non-binary value exists); `languages` (e.g. `ENGLISH`). Reason: Snapchat skews **13–34**; an untargeted geos-only squad serves heavily to minors — a real problem for a venue/reservation product and a policy risk for anything alcohol-adjacent. Full interests/devices/SAM/lookalike targeting stays out of MVP (High before meaningful spend).
- **Evidence:** GAP_REGISTER GR-39; `snapchat.md` targeting section (`min_age`/`max_age` as **strings**; example `{ "min_age": "18", … }`).

### 11. GR-54 — server-side length validators (the body has UI hints only)

- **Old (SC-5):** "headline ≤34, brand name ≤32" as form hints; the edge fn enforces nothing.
- **New (server-side 422s, before any provider call):** `headline` ≤ **34** → `422 headline_too_long`; `brand_name` ≤ **32** → `422 brand_name_too_long`; `name` ≤ **375** (campaign/squad/ad/creative) → `422 name_too_long`; `web_view_properties.url` ≤ **2048** chars **and https/SSL** → `422 invalid_destination_url`. Note: `brand_name` **defaults to the Public Profile's brand name** when omitted — leaving it null is often *safer* (guaranteed policy match); the form should present it as optional.
- **Evidence:** GAP_REGISTER GR-54; `snapchat.md` §4b limits table; PIPELINE_BLUEPRINT §2.3.

### 12. GR-64 — early safety rail: `lifetime_spend_cap_micro` + `paging.next_link`

- **New (a):** set **`lifetime_spend_cap_micro`** on every campaign create as a hard ceiling on the $15k/day-limit account — admin input in **cents** (`spend_cap_cents`, converted ×10,000 at the adapter boundary per A1.1(1)); provider min **`20_000_000`** micro ($20.00); **reducible only if the new cap > 1.1× already-spent** (encode that rule in `setBudget`).
- **New (b):** every Snap list read handles **`paging.next_link`** — without it, reads **silently truncate at page 1** the moment >1 page of entities exists (sync would quietly miss campaigns). Batch reads (`get_*_by_ids`, ≤2,000 ids) are the preferred sync path.
- **Evidence:** GAP_REGISTER GR-64; `snapchat.md` §2 (`lifetime_spend_cap_micro` min/reduction rule), envelope section (`paging.next_link`).

### 13. GR-65 — evaluate `promotion_type: PROMOTE_PLACES` during live-fire

- **New:** Snap has a promotion type **literally named for our product shape** (venues/places); it changes Ads-Manager business logic and the available optimization goals. During the §8 live-fire, run `TRAFFIC` + `promotion_type:'PROMOTE_PLACES'` vs bare `TRAFFIC` and record the delta. Not a default until evaluated.
- **Evidence:** GAP_REGISTER GR-65; `snapchat.md` §2 (`promotion_type` enum + Mingla note).

### 14. Top Snap video duration — validate 3–180 s

- **New:** validate Top Snap video duration to **3–180 s** → `422 invalid_duration`. Snap's media doc table renders max as **1800 s** — that figure most likely covers `LONGFORM_VIDEO`, not the Top Snap. **Confirm live during live-fire** and record the outcome. (Companion constraints for the MVP media path: 9:16 exact, 1080×1920, ≤32 MB standard upload, MP4/MOV H.264, **audio required** — silent video auto-rejects as "Low-Quality Creative".)
- **Evidence:** GAP_REGISTER appendix open-Q4; `snapchat.md` duration-discrepancy note; PIPELINE_BLUEPRINT §2.3.

*(Item 15 — the OD-4/GR-21 goal-default flip — is canonical decision A1.1(6). Item S-5/S-8 — the media `upload_from_url` fiction and the `'snap'`/`SNAP_ACCESS_TOKEN` drift — are **#866's** rows, corrected in #866's amendment; recorded here only so the implementor knows `POST /media/{id}/upload` (multipart ≤32 MB) / `multipart-upload-v2` (>32 MB) is the real path this spec's "media upload if needed" step must use.)*

---

## A1.3 GOOGLE SECTION — provisioning flip + G-1…G-14 + the proven reference body + operating rules

### 0. The provisioning flip (supersedes the Asymmetry banner, §4.0b's premise, §7 Google 1–4, SC-7, and AC-G-2's gate)

- **Old:** "PROVISION-BLOCKED — no Google Ads account, no MCC, no developer token, no OAuth client"; §7 Google 1–5 all outstanding; AC-G-2 gated indefinitely.
- **New:** `[ENGINE-LIVE, G-P1 2026-07-15]` — **MCC `8284700017`** exists (login-customer-id); **customer `3623860476`** is **ENABLED, billed, `testAccount:false`, USD**; developer token **BASIC tier approved 2026-07-15** and **works on v24 against the real account** (`listAccessibleCustomers` 200; `googleAds:search` 200). OAuth client + refresh token exist and mint. **The old customer `5083048929` no longer exists — purge it from every doc/config; never target it.**
- **Remaining §7 Google work is only item 5–6 (seed secrets + connection row):** `GOOGLE_ADS_DEVELOPER_TOKEN`, `GOOGLE_ADS_REFRESH_TOKEN`, `GOOGLE_ADS_OAUTH_CLIENT_ID`, `GOOGLE_ADS_OAUTH_CLIENT_SECRET`, `GOOGLE_ADS_LOGIN_CUSTOMER_ID` (=`8284700017`), `GOOGLE_ADS_CUSTOMER_ID` (=`3623860476`), `GOOGLE_ADS_API_VERSION` (=`v24`). The `google_not_provisioned` (409) fail-close **remains** as the behavior when secrets are unset — but it is now a deploy-config step, not an external blocker. SC-7's blocked panel applies only until the secrets are seeded. **A3 §D registry: `google/consumer` AMBER → GREEN on account `3623860476`.**
- **Build consequence:** the Google adapter is **no longer a stub** — the implementor builds it live in this story, to the PROVEN shape below. **AC-G-2 is ungated** (A1.4).

### G-1 — API version 🔴

- **Old (§4.0b):** "e.g. `v25` current at time of writing".
- **New:** **`v24`** — v25 does not exist; an unsupported version is a **hard `UNSUPPORTED_VERSION` fail**, not a warning. Quarterly version checkpoint; v24 sunset ~2027-04. **Confirm the v24 date-field spelling before the first non-validate mutate** (`start_date_time` `YYYY-MM-DD[ HH:MM:SS]` vs legacy `start_date` `YYYYMMDD` — both circulate; the PROVEN G-P3 body used `startDate: "YYYYMMDD"` successfully in validate-only).
- **Evidence:** GAP_REGISTER §4 G-1 + GR-44; PROOF_LOG G-P1/G-P3 (probes ran on v24).

### G-14 — NEW REQUIRED FIELD: `contains_eu_political_advertising` on EVERY v24 campaign create 🔴

- **Old:** in **no spec, no research doc, no brief**.
- **New:** v24 **REQUIRES `contains_eu_political_advertising`** on campaign create. For our traffic campaigns the value is **`DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING`** — set it on every campaign create, unconditionally.
- **Evidence:** PROOF_LOG G-P3 — the validate-only mutate **failed without it, then validated clean (`{}`) with it**. Proof-grade, discovered only by running the probe.

### The PROVEN reference create body (G-P3) — the Google adapter's `mutate` contract

Recorded as the canonical create shape; the implementor builds **exactly this**, with values parameterized:

```jsonc
POST https://googleads.googleapis.com/v24/customers/3623860476/googleAds:mutate
// headers: Authorization: Bearer <minted>, developer-token: <GOOGLE_ADS_DEVELOPER_TOKEN>,
//          login-customer-id: 8284700017   (digits only, no dashes)
{
  "mutateOperations": [
    { "campaignBudgetOperation": { "create": {
        "resourceName": "customers/3623860476/campaignBudgets/-1",     // temp id (negative)
        "name": "<name> — budget", "amountMicros": "<cents × 10000>",  // A1.1(1)
        "deliveryMethod": "STANDARD", "explicitlyShared": false } } },
    { "campaignOperation": { "create": {
        "resourceName": "customers/3623860476/campaigns/-2",
        "name": "<name>", "status": "PAUSED",
        "advertisingChannelType": "SEARCH",
        "campaignBudget": "customers/3623860476/campaignBudgets/-1",
        "targetSpend": {},                                             // maximize_clicks; see GR-55
        "containsEuPoliticalAdvertising": "DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING",  // G-14
        "geoTargetTypeSetting": { "positiveGeoTargetType": "PRESENCE" },                // GR-37
        "networkSettings": { "targetGoogleSearch": true, "targetSearchNetwork": false,
                             "targetContentNetwork": false, "targetPartnerSearchNetwork": false } } } },
    { "campaignCriterionOperation": { "create": {
        "campaign": "customers/3623860476/campaigns/-2",
        "location": { "geoTargetConstant": "geoTargetConstants/1006886" } } } },        // London (UK)
    { "adGroupOperation": { "create": {
        "resourceName": "customers/3623860476/adGroups/-3",
        "name": "<name>", "campaign": "customers/3623860476/campaigns/-2",
        "status": "ENABLED", "type": "SEARCH_STANDARD", "cpcBidMicros": "<cents × 10000>" } } },
    { "adGroupAdOperation": { "create": {
        "adGroup": "customers/3623860476/adGroups/-3", "status": "PAUSED",
        "ad": { "finalUrls": ["<dest_url — canonical usemingla.com page, A1.1(5)>"],
                "responsiveSearchAd": { "headlines": [/* 3–15 × ≤30 */],
                                        "descriptions": [/* 2–4 × ≤90 */] } } } } },
    { "adGroupCriterionOperation": { "create": {
        "adGroup": "customers/3623860476/adGroups/-3", "status": "ENABLED",
        "keyword": { "text": "<keyword>", "matchType": "PHRASE" } } } }
  ],
  "partialFailure": false,      // all-or-nothing — the native no-orphan guarantee (A1.1(4))
  "validateOnly": false
}
```

**Temp-ID rules (hard):** negative integers, **unique within the request**, **defined before referenced** (declaration order matters — budget before campaign before ad group). `tracking_url_template` (campaign level) carries the OneLink per A1.1(5). A paused parent + `ENABLED` ad group matches the proven shape; the ad itself is `PAUSED`.
**Evidence:** PROOF_LOG G-P3 — this exact chain validated clean on the real account; `google.md` §1.3 (temp-ID rules, atomicity, limits: ≤10,000 ops/request).

### G-2 — URL expansion field name

- **Old (register-cited engine claim):** `url_expansion_opt_out`.
- **New:** **not a v24 field.** The mechanism is `asset_automation_settings[]` → `{ asset_automation_type: FINAL_URL_EXPANSION_TEXT_ASSET_AUTOMATION, asset_automation_status: OPTED_OUT }`. Matters chiefly for PMax (deferred) and any future expansion feature — since our whole product is "this ad promotes THIS event page," URL expansion must be **opted out** wherever the surface exists.
- **Evidence:** GAP_REGISTER §4 G-2; `google.md` §2.2 (`AssetAutomationType` list).

### G-3 — policy-topic enum names

- **Old:** `LIMITS_SERVING` / `FULLY_LIMITS_SERVING`.
- **New:** **`LIMITED` / `FULLY_LIMITED`** (`PolicyTopicEntryType`: `PROHIBITED=2, LIMITED=4, DESCRIPTIVE=5, BROADENING=6, AREA_OF_INTEREST_ONLY=7, FULLY_LIMITED=8`). For OD-8's `delivery_status`: persist **BOTH** `policy_summary.approval_status` (`DISAPPROVED=2, APPROVED_LIMITED=3, APPROVED=4, AREA_OF_INTEREST_ONLY=5`) **and** `ad_group_ad.review_status` (`REVIEW_IN_PROGRESS / REVIEWED / UNDER_APPEAL / ELIGIBLE_MAY_SERVE`) — Google splits what Snap merges; plus `policy_topic_entries[]` into `ads.review_status_reasons` (same column as Snap's reasons, per-platform payload).
- **Evidence:** GAP_REGISTER §4 G-3 + GR-18; `google.md` policy section (proto-verbatim enums).

### G-4 — RSA description count

- **Old:** 5 descriptions.
- **New:** **RSA = 2–4 descriptions (max 4)** × ≤90; headlines **3–15 × ≤30**; path1/path2 ≤15. (**PMax = 5 descriptions, and ≥1 must be ≤60** else `AssetGroupError.SHORT_DESCRIPTION_REQUIRED` — recorded for the deferred PMax lane; **key the limit off the ad type**, the two are routinely conflated.)
- **Evidence:** GAP_REGISTER §4 G-4; `google.md` RSA/PMax tables; PIPELINE_BLUEPRINT §2.4.

### G-5 — channel-type enum corrections

- **Old:** `DISCOVERY`; an `APP` channel type.
- **New:** **`DEMAND_GEN=14`** superseded `DISCOVERY` (=12 is absent from v24). There is **no `APP` value** — App campaigns are `MULTI_CHANNEL=7` + `advertising_channel_sub_type=APP_CAMPAIGN=12`. Neither is in MVP; recorded so nobody writes stale enums into the adapter's types.
- **Evidence:** GAP_REGISTER §4 G-5; `google.md` §2.1 (`AdvertisingChannelType` verbatim).

### G-6 — policy exemption parameter

- **Old:** `policy_violation_key` / `exempt_policy_violation_keys`.
- **New:** legacy AdWords SOAP names. The v24 mechanism is **`PolicyValidationParameter.ignorable_policy_topics`**: catch the policy error → read `policy_topic_entries[].topic` → set `ignorable_policy_topics` → **resubmit the same mutate** (only exemptible findings). This is Google's "appeal" — there is no appeal button in the API.
- **Evidence:** GAP_REGISTER §4 G-6; `google.md` appeals section.

### G-7 — video upload path (cross-ref #866)

- **Old (#866 OD-2, referenced by this spec's creative scope):** "Bunny video cannot upload → YouTube dependency (channel + Data API)".
- **New:** **wrong conclusion.** `YouTubeVideoUploadService.CreateYouTubeVideoUpload` accepts **raw bytes over resumable REST**; with `channel_id` omitted it uploads to a **Google-managed channel** (forced UNLISTED). No YouTube channel, no YouTube Data API. Poll `PENDING→UPLOADED→PROCESSED` → `youtube_video_id` → `YoutubeVideoAsset`. Video stays **out of this story's MVP** (SEARCH+RSA is text-only); the corrected path is #866's to implement — recorded here so this spec stops carrying the phantom blocker.
- **Evidence:** GAP_REGISTER §4 G-7 + §6 DO-NOT-BUILD #5; `google.md` video section.

### G-8 — brand safety field

- **Old:** `video_brand_safety_suitability` as a campaign field.
- **New:** **not a top-level v24 Campaign field.** Content exclusions are applied via **`CampaignCriterion`**. Out of MVP; recorded for the adapter's types.
- **Evidence:** GAP_REGISTER §4 G-8; `google.md` §2.2.

### G-9 — asset "types" that are actually field types

- **Old:** `BusinessNameAsset` / `BusinessLogoAsset` / `WhatsappBusinessMessageAsset` as message types.
- **New:** **not message types.** `BUSINESS_NAME=18`, `BUSINESS_LOGO=27`, `LOGO=21` are **`AssetFieldType` values** applied to plain `TextAsset`/`ImageAsset` when linking; WhatsApp is a nested variant inside `BusinessMessageAsset`. Matters the moment `createCreative` links assets (PMax/RDA lanes).
- **Evidence:** GAP_REGISTER §4 G-9; `google.md` `AssetFieldType` proto-verbatim list.

### G-10 — PMax search themes

- **Old:** 25 per asset group.
- **New:** **50** per asset group (SA360 still 25). PMax is deferred (A1.1(2)); recorded so the deferred lane starts from the right constant.
- **Evidence:** GAP_REGISTER §4 G-10; `google.md` `AssetGroupSignal` section.

### G-11 — registry status

- **Old:** A3 §D `google/consumer` GREEN (then GR-06/GR-44 downgraded it to AMBER on the TEST-tier 403).
- **New:** **GREEN — on account `3623860476`** (BASIC tier proven live, G-P1). Both the original GREEN (wrong reason: "token mints" ≠ "API answers") and the register's AMBER (stale: tier since approved) are superseded. The registry row must also carry `external_account_id=3623860476`, `external_org_id=8284700017`, `auth_kind='dev_token_oauth'`.
- **Evidence:** PROOF_LOG G-P1 (**overrides** GAP_REGISTER GR-06/G-11).

### G-12 — image assets: bytes-only, ≤5120 KB, pre-cropped, JPG/PNG only

- **Old (#866, referenced here):** `ImageAsset` "(bytes/URL)".
- **New:** **URL is not an option — Google never fetches remote URLs.** Bytes only, base64 into `assets:mutate`; **≤5120 KB**; **JPG/PNG only** (GIF/WEBP are rejected for marketing/logo assets despite existing in the `MimeType` enum — the enum is broader than the policy); **the API has NO crop parameter** (DO-NOT-BUILD #12) — **pre-crop server-side** to 1200×628 (1.91:1) / 1200×1200 (1:1) / 960×1200 (4:5), minimums 600×314 / 300×300 / 480×600. **Assets are immutable** — an "edit" = new asset + relink, which **restarts review**; asset names must be **unique per account**; the platform-ref cache must key on **content, not name**. Image assets are out of the SEARCH+RSA MVP (text-only) but the `createCreative` contract records this now.
- **Evidence:** GAP_REGISTER §4 G-12 + GR-53 + §6 DO-NOT-BUILD #12; `google.md` §2.4/image tables; PIPELINE_BLUEPRINT §2.4.

### G-13 — live deprecations to not build against

- **New:** **`CallAdInfo` was removed from the `Ad` oneof in v23** (no new call ads; existing stop serving Feb 2027) → phone CTAs are RSA + `CallAsset`. **Smart Campaigns are deprecated for new creation 2026-08-03 — do not build toward `SMART`.** **`ACCELERATED` budget delivery is sunset for Search/Shopping** → `delivery_method: STANDARD` only (the proven body already does this).
- **Evidence:** GAP_REGISTER §4 G-13; `google.md` release-notes section.

### Geo-resolver rules (GR-37) — mandatory, not nice-to-have

- **Old (§4.0b):** targeting shape undefined beyond "network_settings"; the engine elsewhere collects Meta-style country codes.
- **New:** Google needs **numeric criterion IDs**. **"London" matches 5+ constants and `London,Ontario,Canada` sorts FIRST** — a naive name lookup targets the wrong continent. Rules:
  - Resolve via `geoTargetConstants:suggest` **scoped by `countryCode`** (the disambiguation path proven by G-P2: locale `en` + `countryCode:GB` → **`1006886` London,England,United Kingdom ENABLED, first result**), or the published CSV. **Disambiguate on `Country Code` + `Canonical Name`, never `Name`.**
  - **Verified IDs (seed constants):** US **2840** · UK **2826** · NG **2566** · **London (UK) 1006886** · Lagos city **1010294**.
  - **IDs rot:** 2,916 constants are `Removal Planned` (2,212 in GB/US/NG). **Refresh quarterly; alert on `Removal Planned`.**
  - **`positive_geo_target_type = PRESENCE`** always (the default `PRESENCE_OR_INTEREST` shows a London campaign to people merely *interested in* London, from anywhere — wrong for local events). Proven in the G-P3 body.
- **Evidence:** PROOF_LOG G-P2; GAP_REGISTER GR-37; `google.md` geo section (verified-ID table + suggest transcript).

### GR-52 — the destination re-checker (our highest live Google risk)

- **Old (§4.4b/§4.4d):** destination validated **once** at create (`422 destination_not_public`); sync reads status only.
- **New:** Google polices *unavailable offers* / *destination not working* for the ad's **whole life**, and every Mingla ad promotes a **dated, finite event**. Extend `admin-ad-campaign-sync` (the A1.2-item-9 cron): on every sync, **re-assert the destination is public + live + future-dated** (same read-only `business_public_events_view` check as create). On failure: **auto-pause the campaign** (adapter `setStatus PAUSED`) + append `ad_status_events` (`action='pause'`, `provider_response.reason='destination_not_public'`). Cheap; protects the **account**, not just the campaign. Applies to Snap too (same cron, same check).
- **Evidence:** GAP_REGISTER GR-52.

### GR-55 — Smart-Bidding gate + spend semantics + status mapping

- **New:**
  - **Do not offer tCPA/tROAS until ≥15 conversions/30 days exist** (we have zero Google conversion tracking today). The only honest strategies now: **`targetSpend` (maximize clicks — the proven default)** and `maximizeConversions`. The builder must not render tCPA/tROAS options until the volume gate passes.
  - **Spend semantics surfaced in the UI:** Google may spend **up to 2× the daily budget on any single day**; monthly charges cap at **daily × 30.4**. "$20/day" is not a daily hard cap — say so next to the budget field (mirror of Meta's 175% note).
  - **Status mapping:** our `ARCHIVED`/`DELETED` have **no Google equivalent**; `REMOVED` is permanent and is **never** emitted by launch/pause paths (A1.1(4), AC-G-4).
- **Evidence:** GAP_REGISTER GR-55; `google.md` spend-mechanics + status sections.

### GR-73 — hard caps to encode in validators

- **New (server-side, pre-call):** **≤3 enabled RSAs per ad group** (hard cap); keyword **≤80 chars / ≤10 words**; negatives **≤5,000/ad group, ≤10,000/campaign**; final URL **≤2,084 bytes**; **`AdGroupCriterion.negative` is IMMUTABLE** — a keyword can never be flipped positive↔negative; any "toggle negative" affordance = **remove + create**, never update.
- **Evidence:** GAP_REGISTER GR-73; `google.md` limits table + criteria section.

---

## A1.4 Acceptance criteria — restated and extended

**Restated (cents, per A1.1(1)):**
- **AC-S-3 (replaces the body's):** budgets are stored in **cents** (`budget_cents`); the Snapchat adapter converts `cents × 10_000 → micro` at its single boundary; min-checks run **in micro after conversion** — an ad-squad budget whose converted value is `< 5_000_000` micro (i.e. < $5.00 = 500 cents), or campaign `< 20_000_000` micro (< $20.00 = 2,000 cents), is rejected **`422 budget_below_minimum` before any provider write**. **RT-5 unit tests:** `$5.00 (500¢) → 5_000_000` and `$20.00 (2000¢) → 20_000_000`.
- **AC-S-2 (tightened):** the created sequence uses `objective_v2_properties.objective_v2_type` (S-1), ad `type='REMOTE_WEBPAGE'` via the creative-type map (S-2), a CTA from the WEB_VIEW allowlist (S-3), and an adapter-derived `delivery_constraint` (S-4); the persisted `ads` row carries `review_status`, `creative_review_status`, and `review_status_reasons`.
- **AC-S-5 (unchanged in shape)** — plus the launch warning path keys off BOTH review vocabularies.

**New:**
- **AC-S-11 (profile fail-close):** with `ad_connections.profile_or_page_id` null, `admin-ad-create-campaign{platform:'snapchat'}` returns **`424 snapchat_profile_missing`** and makes **zero** provider calls. With it set (trusted config `2cfbdc85-…`), create proceeds; an invalid profile surfaces at the first creative create (accepted residual risk).
- **AC-S-12 (review cron):** while any Snap ad is `PENDING`/`PENDING_REVIEW`, the sync cron polls every 30–60 min and persists `review_status` + `creative_review_status` + `review_status_reasons` + `delivery_status` at all three levels; after approval it degrades to daily (post-launch re-review).
- **AC-S-13 (goal gating):** with no pixel signal, the create form/edge fn defaults `optimization_goal='SWIPES'` and rejects `LANDING_PAGE_VIEW`/`PIXEL_*` (`422 pixel_goal_unavailable`); when a pixel goal is permitted, the ad-squad body carries `pixel_id`.
- **AC-G-1 (unchanged):** secrets unset → **409 `google_not_provisioned`**, zero Google calls.
- **AC-G-2 (UNGATED — replaces the body's):** with the §A1.3-0 secrets seeded, `admin-ad-connect{platform:'google'}` validates via GAQL against customer `3623860476` (login-customer-id `8284700017`) and persists the connection; `admin-ad-create-campaign` issues **one atomic `googleAds:mutate` (`partialFailure:false`)** matching the G-P3 reference body — including `containsEuPoliticalAdvertising` (G-14), `PRESENCE` geo type, a country-scoped geo criterion, RSA 3×2 minima, and a keyword — everything PAUSED; budgets in cents (`$20.00 = 2000¢ → 20_000_000` micros).
- **AC-G-3 (destination re-checker):** a campaign whose destination stops being public/live/future is auto-paused by the next sync with an `ad_status_events` audit row.
- **AC-G-4 (REMOVED guard):** no launch/pause/sync path can emit `status: REMOVED`; unit test asserts the adapter's status writer only produces `ENABLED|PAUSED`.

---

## A1.5 Flagged contradictions (for the conductor / downstream agents)

1. **PROOF_LOG vs GAP_REGISTER — Google tier guidance.** GR-06, §6 DO-NOT-BUILD #13 ("use a test manager hierarchy; validate_only can't dry-run") and #14 ("don't apply — Explorer suffices") are **stale**: BASIC was approved 2026-07-15 and validate-only ran clean on the **real** account (G-P1/G-P3). **PROOF_LOG wins**; the test-manager-hierarchy advice is no longer needed for this story.
2. **PROOF_LOG vs GAP_REGISTER — Snap profile resolution.** GR-07's fix ("resolve `profile_id` during `connect()` via the businessapi host") is **unbuildable** on our token class (S-P4 403). **PROOF_LOG wins**: trusted config + create-time verification (A1.2 item 8).
3. **D-P1 vs google.md option (b).** `google.md` offered "rely on `go.usemingla.com` being a subdomain of the same registrable domain" as a possible destination pattern; **D-P1's proven interstitial vetoes it** — canonical-page-only v1, OneLink in `tracking_url_template` (A1.1(5)).
4. **Floor-unit seam.** `ad_connections.min_budget_micro` stays **micro** (platform-native constant; checks run in micro post-conversion) while budgets at rest are **cents** — deliberate, but #884's floor table is written in cents; the conductor should confirm #884 reads floors per-platform-native or converts once, not both.
5. **Snap Top Snap duration.** Snap's own docs conflict (3–180 s vs a rendered 1800 s max — likely `LONGFORM_VIDEO`). We validate 3–180 s and **confirm live** (A1.2 item 14).
6. **OD overturns recorded:** OD-4 reversed (SWIPES default — A1.1(6)); OD-5 resolved as trusted config (A1.2 item 8); OD-7 resolved — BASIC approved, Standard/Explorer discussion moot; OD-8 widened — Google needs BOTH `approval_status` and `review_status` persisted (G-3).
7. **Old Google customer id.** Any artifact still carrying `5083048929` (including `google.md`'s §1 examples and A3 §D's registry seed) is stale — **`3623860476`** is the only valid customer id (G-P1).

**End of Amendment A1.**
