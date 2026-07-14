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
