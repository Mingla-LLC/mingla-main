# SPEC — Meta Ads API Integration: create & manage campaigns

**Issue:** GitHub #862 (child of initiative #852 "[Full Rooms] Internal Ad & Reservation Engine")
**Mode:** SPEC (grounded in a live READ-ONLY probe of the connected `meta-ads` MCP + codebase recon)
**Worktree:** `~/Desktop/mingla-orchs/issue-862-meta-ads-api/` on branch `issue-862-meta-ads-api`
**Downstream routing:** this SPEC → `mingla-implementor` → `mingla-tester` → orchestrator CLOSE
**Author:** mingla-forensics · **Date:** 2026-07-14

> **User story (verbatim):** "As a Mingla admin, I can connect Meta (Marketing API) and create/launch/pause ad campaigns from our admin, so we can drive traffic to specific public pages."

---

## Amendment A1 (2026-07-14) — ad destination is a **smart link**, not a raw URL

**Correction (supersedes the "dest_url = plain public URL" assumption below).** The ad's creative `link_url` MUST be an **AppsFlyer OneLink smart link** that (a) deep-links into the Mingla app if installed, (b) falls back to the public web page otherwise, and (c) carries campaign attribution params (+ passes through `fbclid`/`ttclid` as OneLink `af_sub*` params — the hook the #865 Conversions-API loop reads back).

**Live evidence (AppsFlyer MCP probe, 2026-07-14):**
- Consumer OneLink template `redirection_profile` (ID `w36m`), branded domain **`go.usemingla.com`** (custom domain over `mingla.onelink.me`), **LIVE** — platforms consumer iOS `id6760440898` + Android `com.mingla.app.v2`.
- Business OneLink template `business_profile` (ID `ZSCW`), `minglabiz.onelink.me`, **0 links / version 0 = NOT production-ready** (pending the business native build). → **Use `go.usemingla.com` (consumer) as the smart-link host now; business-app-open is blocked on the business OneLink going live** (Open Decision OD‑9 + §7 action item).

**Construction (reuse the existing convention):** build the smart link **server-side** in `admin-meta-create-campaign` following `app-mobile/src/services/oneLinkShare.ts` (`generateInviteLink`; `deep_link_value ∈ {brand,event,trip,experience}`, `deep_link_sub1 = brandSlug`, `deep_link_sub2 = entitySlug`) with attribution params `af_c_id = <our meta_campaign_id>`, `af_ad = <ad name>`, `pid = meta_ads|tiktok_ads`, and pass-through slots reserved for `fbclid`/`ttclid`. Web fallback URL = the resolved `dest_url` (`{BUSINESS_WEB_ORIGIN}/e/{brandSlug}/{eventSlug}` etc.).

**Data-model change:** add `dest_smart_link text NOT NULL` to `meta_campaigns` (the OneLink used as the creative `link_url`); **keep `dest_url`** as the canonical public web page (reference/fallback). Store BOTH.

**Create-step change (§4.4b step 3):** the creative `link_data.link` / `call_to_action.value.link` = **`dest_smart_link`**, not `dest_url`.

---

## Amendment A2 (2026-07-14) — consumer lane PROVISIONED + two-lane multi-connection model

**The Meta consumer lane is fully provisioned and token-verified (2026-07-14).** §7 consumer-lane prerequisites are DONE. Real IDs (also in `MINGLA_MASTER_KEYS.md` → "Meta Ads Engine"):
- Portfolio **Mingla** `830733900115504` · Ad account **Use Mingla** `2393570861066813` (USD, **ACTIVE**, billing on, min daily $1.00) · Page **Mingla** `797406353459597` · Pixel **Mingla Web** `1949011972638955` · App **Mingla Ads Engine** `1270281948368169` · System User **Mingla-server** `61592024996570`.
- Supabase Function Secrets (set at build): `META_SYSTEM_USER_TOKEN` (**verified valid** — `GET /me/adaccounts` returns Use Mingla ACTIVE + the pixel), `META_CAPI_ACCESS_TOKEN` (**verified valid**), `META_APP_SECRET`, `META_APP_ID=1270281948368169`, `META_BUSINESS_ID=830733900115504`, `META_AD_ACCOUNT_ID=2393570861066813`, `META_PAGE_ID=797406353459597`, `META_DATASET_ID=1949011972638955`, `META_API_VERSION=v21.0`. No App Review needed — a dev-mode system-user token manages the app owner's own account (confirmed live).

**TWO-LANE MODEL (supersedes the single-connection assumption).** `meta_ad_connections` is **multi-row — one per lane/portfolio**:
- Add `lane text NOT NULL UNIQUE CHECK (lane IN ('consumer','business'))`, `token_env_var text NOT NULL` (Supabase secret name for that lane's System User token), and `capi_env_var text` (secret name for its CAPI token).
- `resolveMetaToken(connection)` reads `Deno.env.get(connection.token_env_var)` — NOT one hardcoded env. Consumer → `META_SYSTEM_USER_TOKEN` / `META_CAPI_ACCESS_TOKEN`; business → `META_MINGLABIZ_SYSTEM_USER_TOKEN` / `META_MINGLABIZ_CAPI_ACCESS_TOKEN`.
- **Seed the consumer connection now** (IDs above, `lane='consumer'`). The **business** connection (Mingla Business portfolio) lands when that lane is provisioned. Everywhere below that says "the Mingla account" generalizes to "the connection's account/Page/pixel/token".
- `admin-meta-connect` binds/verifies per-lane; the builder (#864) selects the lane.

---

## 1. Executive summary

Build the **first channel** of Mingla's internal Ad Engine: a Meta (Facebook/Instagram) Marketing‑API integration, driven entirely from **Admin Web** (`mingla-admin`) and backed by Supabase **edge functions + DB**. An admin can (1) connect Mingla's Meta ad account, (2) create a campaign → ad set → ad in one atomic action, (3) set budget & audience, (4) launch and pause it, and (5) have the campaign's Meta IDs, live status, and **destination public‑page reference** persisted in our DB.

The build follows the **exact server‑side pattern already used by Stripe, Paystack, and AppsFlyer**: the Meta credential (a Business **System User token**) lives only in **Supabase Edge Function Secrets** (`Deno.env`), never in the DB and never in any client; the DB stores only non‑secret Meta IDs + status. All Meta writes are **admin‑only** and **fail‑close** when the connection is missing or invalid.

This story is the foundation the four sibling issues build on: campaign‑builder UX (#864), attribution/reservation tracking (#865), creative library (#866), TikTok (#863), and Snapchat/Google (#867) are **out of scope** here.

---

## 2. Scope & non‑goals

### In scope (this story only)
1. **Connect** Mingla's Meta ad account (validate the server‑side System User token against the live account + Page; persist a connection record).
2. **Create** a campaign + ad set + ad in one atomic operation (all created **PAUSED**).
3. **Set budget & audience** (daily/lifetime budget; geo + age targeting).
4. **Launch / pause** a campaign from admin.
5. **Persist** Meta campaign/adset/ad/creative IDs + advertiser status + delivery (effective) status + the **destination public‑page reference**.

### Non‑goals (explicitly NOT built here — separate sibling issues)
- **Campaign‑builder UX** beyond the minimum admin screens needed to exercise 1–5 → **#864**. This spec ships a functional but deliberately minimal admin surface; the polished builder is #864.
- **Attribution / reservation‑conversion tracking** (ad → page → reservation), Meta Pixel/CAPI wiring, and rich insights dashboards → **#865**. We persist status and expose a status‑sync endpoint; we do **not** build attribution. (Insights **field shape** is recorded in §11 evidence for #865's benefit only.)
- **Creative library** (reuse venue content) → **#866**. MVP takes **one image per ad** (URL or uploaded hash) supplied at create time.
- **TikTok** (#863) and **Snapchat/Google** (#867) channels.
- **Consumer app, business app, buyer web, business‑web preview** behavior. Public web is a **destination reference only** — the URL a campaign points at. No code changes to those surfaces.

### Assumptions
- Mingla manages **only its own** Meta ad account (no per‑client / agency multi‑tenant OAuth). This is why a single org‑level System User token is correct (see §9 Open Decision OD‑1).
- The MCP used to author this spec is a **per‑user OAuth exploration tool only**; production control uses Mingla's **own** Meta App + System User token (a hard constraint — §6).

---

## 3. Cross‑Surface Impact Declaration (MANDATORY)

| # | Surface | Covered? | User‑visible behavior demanded | Files touched here | Parity |
|---|---------|----------|-------------------------------|--------------------|--------|
| 1 | Consumer iOS (`app-mobile/` iOS) | **No** | none | none | n/a — engine is admin/back‑office only |
| 2 | Consumer Android (`app-mobile/` Android) | **No** | none | none | n/a |
| 3 | Buyer/anonymous Web (`mingla-business` `/e/…`, `/b/…`, `/t/…`, `/checkout/…`) | **Reference only** | Public page is the campaign **destination**; the live public URL is read (never written) to build the ad's `link_url` | none (reads `business_public_events_view`) | n/a — read‑only consumer of existing public contract |
| 4 | Business iOS | **No** | none | none | n/a |
| 5 | Business Android | **No** | none | none | n/a |
| 6 | **Admin Web** (`mingla-admin/`) | **YES — primary** | Connect Meta; create/launch/pause campaigns; see status | `mingla-admin/src/**` (new Ad‑Engine route, service, hook, components) | Single surface — no cross‑platform parity concern |
| 7 | Business Web preview (adjacent) | **No** | none | none | n/a |
| — | **Backend** (`supabase/`) | **YES — primary** | new tables, RLS, edge functions, secrets | `supabase/migrations/**`, `supabase/functions/admin-meta-*/**`, `supabase/functions/_shared/meta.ts`, `supabase/config.toml` | Server‑authoritative; no parity concern |

**Why each NOT‑covered surface is out:** the Ad Engine is an internal back‑office tool. It runs paid campaigns *pointing at* already‑live public pages; it does not modify what consumers or businesses see. Public web is touched only as a **read** of the existing immutable slug contract.

---

## 4. Layered specification

### 4.0 "What's buildable" — LIVE MCP probe evidence (read‑only, 2026‑07‑14)

All values below are **real responses** from the connected `meta-ads` MCP (`mcp.facebook.com/ads`). No write/create/spend tool was called.

**Ad accounts available (`ads_get_ad_accounts`):**

| ad_account_id | name | business_id | currency | account_status | has_payment_method | queryable | min_daily_budget_cents |
|---|---|---|---|---|---|---|---|
| **2393570861066813** | **Use Mingla** | **830733900115504 (Mingla)** | **USD** | **UNSETTLED** | **false** | false | **100** |
| 282369315810310 | (n/a) | — | NGN | CLOSED | true | false | 138171 |
| 1511388192379566 | (personal) | — | EUR | ACTIVE | true | true | 88 |
| 371558881420027 | Somethingelse Photography | 339499013572386 | EUR | UNSETTLED | true | false | 88 |
| 325538103479763 | Somethingelse Group Ads | 2228299920626336 | EUR | UNSETTLED | true | false | 88 |

→ **The production target is `act_2393570861066813` ("Use Mingla") under business `830733900115504`, USD, min daily budget $1.00 (100¢).** It is `UNSETTLED` with **no payment method** and **not queryable** — Seth must add billing before any live delivery (§7 action item). The other accounts are unrelated (personal / Something Else / closed NGN) and MUST be ignored.

**Page for creatives (`ads_get_pages_for_business` business=830733900115504):** exactly one — **Page "Mingla", `page_id 797406353459597`**. Required for every ad creative (`object_story_spec.page_id`).

**Instagram accounts (`ads_get_ig_accounts` act_2393570861066813):** tool returned *"new and is being gradually rolled out … please check back later."* → IG placement is **not blockable at build time**; Instagram delivery is optional (`instagram_user_id` omitted → Facebook‑only placement). Record as an Open item, not a blocker.

**Valid campaign objectives — the create tool accepts ONLY these 6 ODAX "outcome" values** (`ads_create_campaign`; legacy values like `LINK_CLICKS`, `CONVERSIONS`, `REACH` are **rejected with VALIDATION**, even though `ads_get_field_context` still lists them historically):
`OUTCOME_AWARENESS`, `OUTCOME_TRAFFIC`, `OUTCOME_ENGAGEMENT`, `OUTCOME_LEADS`, `OUTCOME_SALES`, `OUTCOME_APP_PROMOTION`.
→ **For "drive traffic to a public page" use `OUTCOME_TRAFFIC`** (§9 OD‑4).

**Ad‑set optimization goals (LIVE `ads_get_field_context` optimization_goal enum, real):** `AD_RECALL_LIFT, APP_INSTALLS, QUALITY_CALL, CONVERSATIONS, OFFSITE_CONVERSIONS, QUALITY_LEAD, VALUE, REACH, EVENT_RESPONSES, IMPRESSIONS, VISIT_INSTAGRAM_PROFILE, LANDING_PAGE_VIEWS, LEAD_GENERATION, LINK_CLICKS, PAGE_LIKES, POST_ENGAGEMENT, REMINDERS_SET, THRUPLAY, TWO_SECOND_CONTINUOUS_VIDEO_VIEWS`.
→ Under `OUTCOME_TRAFFIC` the compatible/default goals are **`LINK_CLICKS`** (default) and **`LANDING_PAGE_VIEWS`** (higher intent — recommended for reservation traffic).

**Status model (LIVE `ads_get_field_context`):**
- `status` (advertiser‑set): `ACTIVE`, `PAUSED`, `DELETED`, `ARCHIVED`. Entities are **created PAUSED**; launch = `ACTIVE`; pause = `PAUSED`.
- `effective_status` (delivery, may differ from `status`): `ACTIVE, PAUSED, IN_PROCESS, WITH_ISSUES, CAMPAIGN_PAUSED, ADSET_PAUSED, AD_PAUSED, DISAPPROVED, PENDING_REVIEW, PREAPPROVED, PENDING_BILLING_INFO, DELETED, ARCHIVED`.
→ **We MUST persist BOTH.** `effective_status = PENDING_BILLING_INFO` is exactly what the UNSETTLED/no‑payment account will show until Seth adds billing; `PENDING_REVIEW`/`DISAPPROVED` come from Meta ad review. The UI status badge reads `effective_status`, not `status`.

**Create‑field contracts (from the live create‑tool schemas — the exact fields the Marketing API requires/accepts):**

- **Campaign** (`ads_create_campaign`) — **required:** `ad_account_id`, `campaign_name`, `objective` (OUTCOME_*), `buying_type` (`AUCTION` default). **Optional/used:** `special_ad_categories` (JSON array, default `[]`), **CBO** budget `campaign_daily_budget` **or** `campaign_lifetime_budget` (**cents**, mutually exclusive), `campaign_bid_strategy` (`LOWEST_COST_WITHOUT_CAP` default), `campaign_spend_cap`, `campaign_start_time`/`campaign_stop_time` (ISO‑8601). Created **PAUSED**.
- **Ad set** (`ads_create_ad_set`) — **required:** `ad_account_id`, `campaign_id`, `ad_set_name`, `billing_event` (`IMPRESSIONS`|`LINK_CLICKS`|`POST_ENGAGEMENT`|`VIDEO_VIEWS`), `optimization_goal`, `targeting`. **Budget:** `daily_budget`/`lifetime_budget` (**cents**) **only in ABO** (campaign has no CBO budget); with CBO the budget lives on the campaign and ABO budget on the ad set is **rejected**. **Advantage+ Audience is ON by default** — `age_min`/`age_max` become suggestions unless `targeting_automation.advantage_audience = 0`. **EU geo** → `dsa_beneficiary` + `dsa_payor` required (auto‑filled from business name if omitted). `lifetime_budget` requires `end_time`. Created **PAUSED**.
- **Targeting spec shape** (JSON): `{ "geo_locations": { "countries": ["US"], "cities":[…], "regions":[…] }, "age_min": 18, "age_max": 65, "genders":[1,2], "flexible_spec":[{"interests":[{"id":"<numeric>","name":"…"}]}], "targeting_automation": {"advantage_audience": 0|1} }`. **Interest IDs must be real** (13–16 digit) from a Targeting‑Search API — **not exposed in this MCP**. → **MVP targets by `geo_locations` (+ age) only** ("broad", Meta‑recommended). Interest targeting is deferred; the schema field exists for #864.
- **Ad** (`ads_create_ad`) — **required:** `ad_account_id`, `ad_set_id`, `ad_name`, `creative`. `creative` = one of `{creative_id}` | `{object_story_id}` | `{object_story_spec:{ page_id, link_data:{ link, image_hash|(top‑level image_url), message }}}`. **`page_id` is ALWAYS required** inside `object_story_spec` (omission → "Facebook Page is Missing"). Created **PAUSED**.
- **Creative** (`ads_create_creative`) — `ad_account_id`, `page_id`, `link_url`, exactly one of `image_hash`/`image_url`; optional `message` (primary text), `headline`, `description`, `call_to_action_type` (default `LEARN_MORE`; e.g. `BOOK_NOW`, `BUY_TICKETS`, `GET_TICKETS`→`BUY_TICKETS`, `SIGN_UP`), `instagram_user_id`.
- **Budget units & minimums:** all budgets are **integer cents in the account currency**; USD min daily = **100¢** (from the live probe). `daily_budget`/`lifetime_budget` mutually exclusive.
- **Launch / pause:** every entity is created **PAUSED**; activation is **top‑down** (campaign → ad set → ad), each level set to `ACTIVE` individually (a paused parent blocks a child's delivery). Pause = set the campaign `status=PAUSED`. (MCP equivalents: `ads_activate_entity`, `ads_update_entity`; production calls the Graph API directly with our token.)

**Insights/reporting fields (LIVE `ads_get_field_context` — for the FUTURE #865 attribution story, recorded not built):** confirmed available: `amount_spent`(alias `spend`), `impressions`, `clicks`, `reach`, `frequency`, `cpc`, `cpm`, `ctr`, `cost_per_action_type`, `purchase_roas`, `conversions`, plus identifiers `campaign_id`, `adset_id`. The MCP's insights catalog did **not** resolve `actions`, `action_values`, `inline_link_clicks`, `outbound_clicks`, `landing_page_views`, `ad_id`, `date_start`, `date_stop` as aliases — but these **are** first‑class fields on the real Graph `GET /{entity}/insights` endpoint, which the production System‑User token calls directly. **#865 will read `/insights` with `fields=spend,impressions,clicks,actions,action_values,cost_per_action_type` + a date range.** No insights work in THIS story.

---

### 4.1 Architecture & data flow

```
Admin (mingla-admin, React+Vite, 2FA + ALLOWED_ADMIN_EMAILS)
   │  authenticated fetch (Bearer JWT)
   ▼
Supabase Edge Function  admin-meta-*  (verify_jwt=true  →  in-code admin_users gate)
   │  reads META_SYSTEM_USER_TOKEN from Deno.env  (fail-close if absent/invalid)
   ├──────────────► Meta Graph API  https://graph.facebook.com/v{API_VERSION}/...
   │                 (create campaign/adset/creative/ad; set status; read effective_status)
   │  service-role client (SUPABASE_SERVICE_ROLE_KEY)
   ▼
Supabase DB  meta_ad_connections · meta_campaigns · meta_campaign_status_events  (RLS: admin read, service-role write)
   │
   └─ destination resolved (READ-ONLY) from business_public_events_view  →  dest_url = {BUSINESS_WEB_ORIGIN}/e/{brandSlug}/{eventSlug}
```

**Invariants of the flow:** (a) the token never leaves the edge runtime; (b) the client never receives the token or calls Meta directly; (c) a `meta_campaigns` DB row is written **only after all four Meta IDs exist** (no orphan rows); (d) every state‑changing call is gated by `is_admin_user()`; (e) a missing/invalid connection **stops** create/launch (fail‑close), it does not silently no‑op.

### 4.2 Database layer

New migration `supabase/migrations/<ts>_issue_862_meta_ads_engine.sql` (timestamp AFTER the latest existing migration; verify with `ls supabase/migrations | tail`). Follow the house pattern (RLS enabled, admin‑read via `is_admin_user()`, writes service‑role‑only, `updated_at` triggers).

**Table `public.meta_ad_connections`** — one active connection (the single Mingla account). **No token column — ever.**
```
id                     uuid PK default gen_random_uuid()
meta_business_id       text NOT NULL              -- '830733900115504'
meta_ad_account_id     text NOT NULL UNIQUE       -- '2393570861066813' (store WITHOUT 'act_' prefix)
meta_page_id           text NOT NULL              -- '797406353459597'
meta_ig_user_id        text NULL                  -- optional IG placement
currency               text NOT NULL              -- 'USD'
min_daily_budget_cents integer NOT NULL           -- 100 (from live account)
account_status         text NULL                  -- Graph account_status: 'ACTIVE'|'UNSETTLED'|...
has_payment_method     boolean NULL
token_status           text NOT NULL DEFAULT 'unknown' CHECK (token_status IN ('valid','invalid','unknown'))
token_last_verified_at timestamptz NULL
connected              boolean NOT NULL DEFAULT false
connected_by           uuid NULL REFERENCES auth.users(id)
created_at             timestamptz NOT NULL DEFAULT now()
updated_at             timestamptz NOT NULL DEFAULT now()
-- COMMENT: 'Meta System User token is stored ONLY in Supabase Edge Function Secrets (Deno.env META_SYSTEM_USER_TOKEN), NEVER in this table.'
```

**Table `public.meta_campaigns`** — one row per campaign, written only when fully created.
```
id                  uuid PK default gen_random_uuid()
connection_id       uuid NOT NULL REFERENCES public.meta_ad_connections(id) ON DELETE RESTRICT
meta_campaign_id    text NOT NULL UNIQUE
meta_adset_id       text NOT NULL
meta_creative_id    text NOT NULL
meta_ad_id          text NOT NULL
name                text NOT NULL
objective           text NOT NULL CHECK (objective IN ('OUTCOME_AWARENESS','OUTCOME_TRAFFIC','OUTCOME_ENGAGEMENT','OUTCOME_LEADS','OUTCOME_SALES','OUTCOME_APP_PROMOTION'))
buying_type         text NOT NULL DEFAULT 'AUCTION'
optimization_goal   text NOT NULL                 -- e.g. 'LANDING_PAGE_VIEWS'
billing_event       text NOT NULL                 -- e.g. 'IMPRESSIONS'
budget_type         text NOT NULL CHECK (budget_type IN ('daily','lifetime'))
budget_cents        integer NOT NULL CHECK (budget_cents > 0)
bid_strategy        text NULL
targeting           jsonb NOT NULL DEFAULT '{}'   -- the geo/age spec sent to Meta
status              text NOT NULL DEFAULT 'PAUSED' CHECK (status IN ('PAUSED','ACTIVE','ARCHIVED','DELETED'))
effective_status    text NULL                     -- delivery state read back from Meta
status_synced_at    timestamptz NULL
-- destination public-page reference (the point of Full Rooms):
dest_page_type      text NOT NULL CHECK (dest_page_type IN ('event','trip','brand','venue'))
dest_brand_slug     text NOT NULL
dest_entity_slug    text NULL                     -- event/trip/venue slug; NULL for brand pages
dest_event_id       uuid NULL REFERENCES public.events(id) ON DELETE SET NULL
dest_url            text NOT NULL                 -- canonical public web page (fallback/reference), e.g. /e/{brandSlug}/{eventSlug}
dest_smart_link     text NOT NULL                 -- [Amendment A1] AppsFlyer OneLink used as the creative link_url (opens app if installed, else dest_url) + attribution params
created_by          uuid NULL REFERENCES auth.users(id)
created_at          timestamptz NOT NULL DEFAULT now()
updated_at          timestamptz NOT NULL DEFAULT now()
```

**Table `public.meta_campaign_status_events`** — append‑only audit of create/launch/pause (mirrors the `payment_webhook_events`/audit convention; supports the "persist status" AC + reconciliation of any partial‑create failure).
```
id            uuid PK default gen_random_uuid()
campaign_id   uuid NULL REFERENCES public.meta_campaigns(id) ON DELETE CASCADE  -- NULL if the create failed before a row existed
action        text NOT NULL CHECK (action IN ('create','launch','pause','sync','create_failed','rollback'))
actor         uuid NULL REFERENCES auth.users(id)
from_status   text NULL
to_status     text NULL
meta_ids      jsonb NULL         -- partial IDs captured on failure for manual reconciliation
meta_response jsonb NULL         -- normalized Meta error/success (NEVER contains the token)
created_at    timestamptz NOT NULL DEFAULT now()
```

**RLS (all three tables):** `ENABLE ROW LEVEL SECURITY`.
- `SELECT`: `USING ( public.is_admin_user() )` for `authenticated`.
- `INSERT`/`UPDATE`/`DELETE`: **no policy for authenticated** (service‑role bypasses RLS; only the admin‑gated edge functions write). This matches `payment_webhook_events` (RLS‑enabled, service‑role‑only).
- `GRANT SELECT` to `authenticated`; no direct write grants.

**Indexes:** `meta_campaigns (connection_id)`, `meta_campaigns (status)`, `meta_campaigns (dest_event_id)`, `meta_campaign_status_events (campaign_id, created_at DESC)`.

### 4.3 Shared edge module — `supabase/functions/_shared/meta.ts` (NEW)

Mirrors `_shared/stripeMode.ts` / `_shared/paystack.ts` (per‑integration secret resolver + typed client + fail‑close).
- `resolveMetaToken(): string` — `Deno.env.get('META_SYSTEM_USER_TOKEN')`; **throw `MetaNotConnectedError` if unset** (fail‑close; never call Meta without it — mirrors `resolvePaystackSecretKey`'s throw).
- Config from env: `META_API_VERSION` (e.g. `v21.0`), `META_GRAPH_BASE` (default `https://graph.facebook.com`), `META_AD_ACCOUNT_ID`, `META_BUSINESS_ID`, `META_PAGE_ID` (the configured Mingla defaults — validated against the persisted connection).
- `metaGraph(method, path, params, {timeoutMs=15000})` — fetch wrapper with `AbortController` timeout; on non‑2xx, parse Meta's `error.{message,code,error_subcode,error_user_title,error_user_msg,fbtrace_id}` and throw a normalized `MetaApiError` (the raw token is **never** logged or echoed). Auth via `access_token` param / `Authorization: Bearer` header.
- `normalizeMetaError(e)` → `{ code, subcode, message, fbtrace_id }` for client‑safe surfacing.

### 4.4 Edge functions (all POST; `verify_jwt=true`; in‑code `admin_users` gate; service‑role DB writes)

Reuse `_shared/cors.ts` (`corsHeaders`) and the `_shared/stripeEdgeAuth.ts` entry pattern (`requireUserId(req)` → then the admin check below). Add each to `supabase/config.toml` as `[functions.<name>] verify_jwt = true`.

**Admin gate (every function, after `requireUserId`):**
```
const { data: adminRow } = await supabase.from('admin_users')
  .select('id').eq('email', user.email).eq('status','active').maybeSingle();
if (!adminRow) return json({ error: 'forbidden' }, 403);
```

#### (a) `admin-meta-connect`
- **Body:** `{ action: 'connect' | 'status' | 'list_accounts' }` (default `connect`).
- **`connect`:** call `GET /v{ver}/act_{META_AD_ACCOUNT_ID}?fields=id,name,currency,account_status,min_daily_budget,funding_source` and `GET /v{ver}/{META_PAGE_ID}?fields=id,name`. On success → **upsert** `meta_ad_connections` (`connected=true`, `token_status='valid'`, `token_last_verified_at=now()`, currency, `min_daily_budget_cents`, `account_status`, `has_payment_method`). On token/permission failure → upsert `token_status='invalid'`, `connected=false`; return **424** `{error:'meta_not_connected', detail}`.
- **`status`:** re‑verify the token (same reads) → refresh `token_status`/`account_status`; return the connection row. Used by the "connected" UI and (optionally) a health cron.
- **`list_accounts`:** `GET /me/adaccounts?fields=id,name,account_status,currency` — returns candidates for the (rare) case Seth must re‑bind; MVP defaults to the single Mingla account.
- **Output:** the `meta_ad_connections` row (token **never** included) + a `graph` echo of the non‑secret account fields.

#### (b) `admin-meta-create-campaign`  ← the atomic create
- **Body:**
```
{
  name, objective='OUTCOME_TRAFFIC',
  optimization_goal='LANDING_PAGE_VIEWS', billing_event='IMPRESSIONS',
  budget:{ type:'daily'|'lifetime', amount_cents:int, end_time?:iso },   // end_time required if lifetime
  bid_strategy?:'LOWEST_COST_WITHOUT_CAP',
  targeting:{ countries:[…], age_min?, age_max?, genders?:[1,2] },
  destination:{ page_type:'event'|'trip'|'brand'|'venue', brand_slug, entity_slug?, event_id? },
  creative:{ message, headline?, description?, image_url?|image_hash?, call_to_action_type?='LEARN_MORE' },
  special_ad_categories?:[]
}
```
- **Pre‑flight (all fail‑close, before ANY Meta write):**
  1. Load the connection; if `!connected || token_status!=='valid'` → **424** `meta_not_connected`.
  2. **Resolve destination READ‑ONLY** from `business_public_events_view` by `{brand_slug, slug=entity_slug}` (brand page: resolve from `brands.slug`). If no public+live row → **422** `destination_not_public`. Build `dest_url = ${BUSINESS_WEB_ORIGIN}/{e|t|b}/…` (event → `/e/{brandSlug}/{eventSlug}`, trip → `/t/{brandSlug}/{tripSlug}`, brand → `/b/{brandSlug}`). Capture `dest_event_id` when applicable.
  3. Validate `budget.amount_cents >= connection.min_daily_budget_cents` (daily) → else **422** `budget_below_minimum`.
- **Meta create sequence (order fixed; collect IDs; NO DB row yet):**
  1. `POST /act_{id}/campaigns` — `name`, `objective`, `buying_type=AUCTION`, `special_ad_categories`, **CBO** `daily_budget`/`lifetime_budget` (cents), `status=PAUSED`. → `campaign_id`.
  2. `POST /act_{id}/adsets` — `campaign_id`, `name`, `billing_event`, `optimization_goal`, `targeting` (`{geo_locations:{countries},age_min,age_max,genders, targeting_automation:{advantage_audience:0}}`), `promoted_object`?, `status=PAUSED`. (CBO → no budget here.) `lifetime` → `end_time`. → `adset_id`.
  3. `POST /act_{id}/adcreatives` — `object_story_spec:{ page_id:<connection.meta_page_id>, link_data:{ link:dest_url, message, name:headline, description, image_hash|image_url, call_to_action:{type,value:{link:dest_url}} } }`. → `creative_id`.
  4. `POST /act_{id}/ads` — `adset_id`, `name`, `creative:{creative_id}`, `status=PAUSED`. → `ad_id`.
- **Persist:** insert ONE `meta_campaigns` row with all four IDs + budget + targeting + destination + `status='PAUSED'`; read `effective_status` (`GET /{campaign_id}?fields=effective_status`) into the row; append a `meta_campaign_status_events` `action='create'` row.
- **Partial‑failure contract (no orphans):** if any Meta step 1–4 fails, do **NOT** insert a `meta_campaigns` row. Attempt **compensating cleanup**: `DELETE /{campaign_id}` (Meta cascades child adset/creative/ad) for whatever was created; if cleanup itself fails, append `meta_campaign_status_events` `action='create_failed'` with `meta_ids` = the partial IDs for manual reconciliation. Return **502** `meta_create_failed` with `normalizeMetaError`. **Never** a half‑written DB row.
- **Output:** the persisted `meta_campaigns` row.

#### (c) `admin-meta-campaign-action`  ← launch / pause
- **Body:** `{ campaign_id:<our uuid>, action:'launch'|'pause' }`.
- **`launch`:** fail‑close on connection; set `ACTIVE` **top‑down** — `POST /{meta_campaign_id}` `status=ACTIVE`, then `/{meta_adset_id}`, then `/{meta_ad_id}`. Re‑read `effective_status`; update row `status='ACTIVE'`, `effective_status`, `status_synced_at`; append `action='launch'`. If `effective_status ∈ {PENDING_BILLING_INFO, DISAPPROVED, WITH_ISSUES}` → return **200** with a `warning` so the UI can surface it (the launch call succeeded; delivery is blocked upstream — that's Meta's state, not our error).
- **`pause`:** `POST /{meta_campaign_id}` `status=PAUSED`; update row + append `action='pause'`.
- **Output:** updated row (+ optional `warning`).

#### (d) `admin-meta-campaign-sync`  ← status read (no attribution)
- **Body:** `{ campaign_id?:<our uuid> }` — one or all. Reads `GET /{campaign_id}?fields=status,effective_status`; updates `status`, `effective_status`, `status_synced_at`. `verify_jwt=true` admin; MAY also accept a service‑role Bearer for a future cron (like `api-health-probe`). No insights fields here (those are #865).

### 4.5 Service + hook (mingla-admin)
- `mingla-admin/src/services/metaAds.js` — thin wrappers that `supabase.functions.invoke('admin-meta-*', …)`; typed request/response; surface `normalizeMetaError` messages.
- `mingla-admin/src/hooks/useMetaAds.js` (or Context, matching admin conventions) — connection state, campaign list, create/launch/pause mutations with `onError` toasts. No React Query requirement if the admin app doesn't use it — match the existing admin data pattern (direct Supabase calls + Context, per recon).

### 4.6 Component layer (mingla-admin) — see §5 for exact states.

---

## 5. Admin UI states (success criteria are per‑state; single surface → no per‑platform split)

New admin route **`/ad-engine/meta`** (label "Ad Engine → Meta"). Reachable only by an active admin (existing `AuthContext` + `ALLOWED_ADMIN_EMAILS` + 2FA).

- **SC‑1 — Not configured** (`token_status='unknown'`/no connection, i.e. `META_SYSTEM_USER_TOKEN` unset): show the **prerequisite checklist** (§7) + a disabled "Connect" with copy "Provision the Meta System User token first." Create is impossible (fail‑close).
- **SC‑2 — Disconnected/Invalid** (`token_status='invalid'`): red banner "Meta connection invalid — re‑verify the System User token." + "Reconnect" button (calls `admin-meta-connect`). Create disabled.
- **SC‑3 — Connecting:** spinner on the Connect/Reconnect button; buttons disabled; no duplicate submits.
- **SC‑4 — Connected:** show ad‑account name/id, Page name, currency, `account_status`. **If `account_status='UNSETTLED'` or `has_payment_method=false`** → amber warning "Add a payment method in Meta Ads Manager before launching — campaigns will sit at *Pending billing*." "Create campaign" **enabled**.
- **SC‑5 — Create campaign form:** fields — name; objective (default **Traffic**); **destination picker** (pick a live public page → shows `dest_url` preview, resolved server‑side); budget (daily/lifetime toggle, amount with **min = `min_daily_budget_cents`** enforced client + server); targeting (countries multiselect, age min/max); creative (image URL/upload, primary text, optional headline, CTA select). Submit → calls create; on success show "Created — **Paused**. Review, then Launch." with the new campaign in the list.
- **SC‑6 — Campaign list/detail:** each row: name, objective, budget, **two badges** — advertiser `status` (Paused/Active/Archived) and **delivery `effective_status`** (Pending review / **Pending billing** / Active / With issues / Disapproved / Paused). Actions: **Launch** (when Paused), **Pause** (when Active), open **destination link**. A "Sync status" control calls `admin-meta-campaign-sync`.
- **SC‑7 — Error:** any edge error renders inline with the normalized Meta message + `fbtrace_id`; a `meta_not_connected`/`424` routes the user back to the Connect state. Nothing silently succeeds.

---

## 6. Security

- **SC‑SEC‑1 — Token at rest / in transit:** the Meta credential is a **Business System User access token** stored ONLY in **Supabase Edge Function Secrets** as `META_SYSTEM_USER_TOKEN`, read via `Deno.env.get(...)`. Supabase encrypts function secrets at rest — this **is** our stack's token‑encryption mechanism and is **identical** to `STRIPE_RAK_*_LIVE`, `PAYSTACK_SECRET_KEY_LIVE`, `APPSFLYER_S2S_TOKEN` (recon §5: no integration stores a provider token in the DB). The token is **never** written to any table, **never** in an edge‑function response body, **never** in `meta_response`/logs, and **never** in the client bundle. (This resolves the "encrypted server‑side, never client‑exposed" constraint by precedent — see §9 OD‑2.)
- **SC‑SEC‑2 — Distinct from MCP OAuth:** production uses **Mingla's own Meta App + System User token** for server‑side control. The per‑user OAuth of the exploration MCP is **not** used in production and no per‑user Meta OAuth flow is built.
- **SC‑SEC‑3 — Scopes:** the System User token must carry `ads_management` (create/manage), `ads_read` (status/insights), `business_management`, and Page promotion perms (`pages_show_list`, `pages_read_engagement`, `pages_manage_ads`). Least‑privilege: no `pages_manage_posts`/user‑data scopes.
- **SC‑SEC‑4 — Authorization:** gateway `verify_jwt=true` → in‑code `getUser(token)` (401) → `admin_users` active gate (403) on **every** `admin-meta-*` function. Client access to `meta_*` tables is admin‑read‑only via `is_admin_user()` RLS; writes are service‑role‑only.
- **SC‑SEC‑5 — Fail‑close:** missing/invalid token → `meta_not_connected` (424) on connect/create/launch; destination not public → 422; below‑minimum budget → 422. No path proceeds to spend on a broken connection.

---

## 7. Meta‑side prerequisites Seth must provision (ACTION ITEMS — blockers flagged)

These are **not code**; they gate live‑fire and App‑review. Ordered.

1. **Meta App (Business type)** at developers.facebook.com under the Mingla business → add the **Marketing API** product. Capture **App ID + App Secret**.
2. **Business Verification** of the "Mingla" business (`830733900115504`) in Business Settings (required for Advanced Access to `ads_management`).
3. **BILLING (hard blocker for delivery):** the target account **`act_2393570861066813` is `UNSETTLED` with `has_payment_method=false`** (live probe). Add a payment method / funding source in Meta Ads Manager, or every launched campaign sits at `effective_status=PENDING_BILLING_INFO` and never delivers.
4. **System User + token:** create an **Admin System User** in Business Settings → **generate token** with scopes `ads_management, ads_read, business_management, pages_show_list, pages_read_engagement, pages_manage_ads` → **assign** ad account `2393570861066813` **and** Page `797406353459597` to that System User → set the token as the `META_SYSTEM_USER_TOKEN` Function Secret. (Prefer a **60‑day** or **never‑expiring** system‑user token; short‑lived tokens will break the connection.)
5. **App Review / access tier:** `ads_management` needs **Advanced Access** for general use, but a **dev/standard‑access** token **can manage the app owner's own ad accounts** — since Mingla manages only its own account, live‑fire testing can begin on a dev token **after** steps 1–4, and Advanced Access + App Review is the path to remove any per‑app rate limits. Confirm the exact tier during IMPLEMENT (flag if Advanced Access turns out to be required for our own‑account use).
6. **Env/secrets to set** (Supabase → Edge Function Secrets): `META_SYSTEM_USER_TOKEN`, `META_API_VERSION` (e.g. `v21.0`), `META_AD_ACCOUNT_ID=2393570861066813`, `META_BUSINESS_ID=830733900115504`, `META_PAGE_ID=797406353459597`. `BUSINESS_WEB_ORIGIN` already exists (reused for `dest_url`).
7. **(Optional) Instagram:** link the Mingla IG business account to the Page/ad account for IG placements; the `ads_get_ig_accounts` tool is still rolling out, so treat IG placement as optional until confirmed.

---

## 8. Acceptance criteria + test plan

### Acceptance criteria (testable)
- **AC‑1:** `admin-meta-connect` against a valid token persists `meta_ad_connections` with `connected=true, token_status='valid'`, real `currency='USD'`, `min_daily_budget_cents=100`, `account_status`, `has_payment_method`. Invalid/missing token → 424 + `token_status='invalid'`, `connected=false`.
- **AC‑2:** `admin-meta-create-campaign` creates **exactly one** campaign + ad set + creative + ad on Meta (all `status=PAUSED`) and persists **one** `meta_campaigns` row with all four Meta IDs + `dest_url` + `status='PAUSED'` + a read‑back `effective_status`.
- **AC‑3:** Budget is stored/sent in **cents**; a daily budget `< min_daily_budget_cents` is rejected **422** *before* any Meta write.
- **AC‑4:** Destination that is not a **public + live** page is rejected **422 `destination_not_public`** before any Meta write; a valid one yields the correct `dest_url` shape (`/e/{brandSlug}/{eventSlug}` etc.).
- **AC‑5:** `launch` sets campaign+adset+ad to `ACTIVE` top‑down and updates `status`/`effective_status`; `pause` returns them to `PAUSED`. Both append a `meta_campaign_status_events` row.
- **AC‑6 (no orphans):** if the ad‑set (or creative/ad) create fails, **no** `meta_campaigns` row is written, the already‑created campaign is deleted on Meta (or a `create_failed` audit row captures partial IDs), and the caller gets **502 `meta_create_failed`**.
- **AC‑7 (fail‑close):** with `META_SYSTEM_USER_TOKEN` unset, connect/create/launch all return `meta_not_connected` (424) — never a silent success, never a Meta call.
- **AC‑8 (authz):** a non‑admin JWT gets 403 on every `admin-meta-*` function; a non‑admin cannot `SELECT` any `meta_*` table (RLS).
- **AC‑9 (no token leak):** the token string never appears in any edge response, `meta_response`, log line, DB column, or the admin client bundle.

### Test plan
**Unit / integration (edge, Deno test — reuse `__tests__` convention):**
- token‑absent → fail‑close (drives AC‑7 + the regression contract §9).
- create happy path with a mocked Graph returning 4 IDs → one DB row, all IDs present.
- create with step‑2 failure → no DB row + compensating delete invoked (AC‑6).
- budget‑below‑min and destination‑not‑public → 422 before any Graph call (AC‑3/AC‑4).
- response‑body + `meta_response` never contain the token (AC‑9).

**RLS (SQL):** as an ordinary authenticated user, `SELECT` on `meta_ad_connections`/`meta_campaigns`/`meta_campaign_status_events` returns 0 rows / denied; `is_admin_user()` returns them (AC‑8).

**Live‑fire path (post‑prereqs, mingla‑tester, real spend — NOT run in this spec phase):** after Seth completes §7 (esp. billing): connect → create a **$1.00/day `OUTCOME_TRAFFIC`** campaign whose destination is a real **live** Mingla event page → verify it exists PAUSED in Meta Ads Manager and in `meta_campaigns` with matching IDs → **launch** → confirm `effective_status` becomes `ACTIVE` (or `PENDING_REVIEW`/`PENDING_BILLING_INFO` and the UI surfaces it) → **pause** → **archive/cleanup**. Capture screenshots + the IDs.

**Security check (mingla‑tester):** build the admin bundle and `grep -r` for the token / `META_SYSTEM_USER_TOKEN` value → **absent**; inspect network responses of connect/create/launch → token **absent**; confirm the token exists only as a Supabase Function Secret.

---

## 9. Invariants + regression prevention

### Invariants preserved / established
- **Preserve I‑ADMIN‑GATE:** every write path re‑checks `admin_users` active (per recon §7a). Test: AC‑8.
- **Preserve immutable‑slug contract** (`trg_brands_immutable_slug`/`trg_events_immutable_slug`): we only **read** slugs; `dest_url` durability relies on their immutability. Test: AC‑4 URL shape.
- **I‑PROPOSED‑META‑TOKEN‑ENV‑ONLY (DRAFT):** the Meta token lives only in `Deno.env`; it MUST NOT appear in any DB column, response, log, or client bundle. (Flips ACTIVE at CLOSE — orchestrator owns the flip.)
- **I‑PROPOSED‑META‑NO‑ORPHAN‑WRITE (DRAFT):** a `meta_campaigns` row exists **iff** all four Meta IDs exist; partial Meta creates leave no DB row.
- **I‑PROPOSED‑META‑FAIL‑CLOSE (DRAFT):** create/launch/connect refuse and return `meta_not_connected` when the token is absent/invalid.

### Regression contract (fails‑on‑revert)
- **RT‑1 (fail‑close):** edge test asserts token‑absent → `meta_not_connected` and **zero** Graph calls. **Reverting the `resolveMetaToken()` throw makes RT‑1 fail; restoring it passes.** Protective comment on the throw explains why (no silent spend on a broken connection).
- **RT‑2 (no orphan):** edge test asserts a step‑2 Meta failure yields no `meta_campaigns` insert + a compensating delete. Reverting the "insert only after all IDs" ordering fails RT‑2.
- **RT‑3 (no token leak) — strict‑grep CI gate:** a repo grep asserts `META_SYSTEM_USER_TOKEN` / token access appears **only** under `supabase/functions/**` and **never** under `mingla-admin/src/**`, `app-mobile/**`, `mingla-business/**`. Fails CI if a future change references the token client‑side. (Follows the house strict‑grep‑registry pattern.)
- No `app.json`/store‑submit change → the `I-RELEASE-VERSION-PARITY` / `I-RELEASE-SUBMIT-CONFIG` gates (COMMS‑0096/0097) are untouched.

---

## 10. Implementation order + scoped allowlist

### Order (DB → shared → edge → config → admin UI)
1. **Migration** `supabase/migrations/<ts>_issue_862_meta_ads_engine.sql` — 3 tables + RLS + indexes + `updated_at` triggers.
2. **`supabase/functions/_shared/meta.ts`** — token resolver (fail‑close), `metaGraph`, error normalizer.
3. **Edge fns** `admin-meta-connect`, `admin-meta-create-campaign`, `admin-meta-campaign-action`, `admin-meta-campaign-sync` (+ `__tests__`).
4. **`supabase/config.toml`** — four `[functions.admin-meta-*] verify_jwt = true` blocks.
5. **mingla-admin** — `services/metaAds.js`, `hooks/useMetaAds.js`, route `/ad-engine/meta`, components for SC‑1…SC‑7.
6. **CI** — add the RT‑3 strict‑grep gate.

### Allowlist (implementor MAY create/modify ONLY these)
- `supabase/migrations/<ts>_issue_862_meta_ads_engine.sql` (new)
- `supabase/functions/_shared/meta.ts` (new)
- `supabase/functions/admin-meta-connect/**`, `admin-meta-create-campaign/**`, `admin-meta-campaign-action/**`, `admin-meta-campaign-sync/**` (new)
- `supabase/config.toml` (append function blocks only)
- `mingla-admin/src/**` (new Ad‑Engine route, service, hook, components; wire into the existing admin nav only)
- CI workflow file for the strict‑grep gate (append a job)

### DO‑NOT‑TOUCH (stop‑and‑amend before any edit)
- Any existing `supabase/functions/{stripe*,brand-stripe-*,*paystack*,admin-*,events,discover-*}/**` and `_shared/{stripe*,paystack*,appsFlyerS2S,stripeEdgeAuth,cors,audit,idempotency}.ts` (reuse by import; do **not** modify).
- Existing migrations, `brands`/`events`/`orders`/`stripe_connect_accounts`/`admin_users` schemas (read `business_public_events_view` + `is_admin_user()` only; add no columns).
- `app-mobile/**`, `mingla-business/**` (no consumer/business/public‑web code changes — public web is destination‑reference only).
- Any `app.json` / `eas.json` / store‑submit config.
Anything outside the allowlist → request a `SPEC_AMENDMENT_ISSUE-862_*` before touching.

---

## 11. Open decisions (with recommendations)

- **OD‑1 — Connection model:** System‑User token (single org‑level) **[RECOMMEND — matches the constraint + the Stripe/Paystack precedent; Mingla manages only its own account]** vs. interactive 3‑legged per‑admin OAuth **[reject for production; adds token‑refresh + at‑rest storage we don't need]**.
- **OD‑2 — Token at rest:** keep the token only in `Deno.env` (Supabase Function Secrets) **[RECOMMEND — precedent‑matching, no DB token]** vs. Supabase Vault/pgsodium in DB **[only if we ever need per‑brand tokens — not now]**.
- **OD‑3 — Budgeting:** **CBO** (budget on the campaign) **[RECOMMEND — Meta‑preferred; the create tool defaults to it]** vs. ABO (per‑ad‑set). MVP = CBO daily.
- **OD‑4 — Objective/goal:** `OUTCOME_TRAFFIC` + `LANDING_PAGE_VIEWS` **[RECOMMEND — highest‑intent traffic to a reservation page]** vs. `LINK_CLICKS` (cheaper, lower intent). Expose both in the form, default to Landing‑Page‑Views.
- **OD‑5 — Which account:** bind **`act_2393570861066813` (Use Mingla, USD)** exclusively **[RECOMMEND]**; hard‑ignore the EUR/NGN/Something‑Else accounts the probe surfaced.
- **OD‑6 — Creative image source:** MVP accept an **`image_url`** (simplest) with an option to pre‑upload to Meta for a stable **`image_hash`** **[RECOMMEND image_hash once #866 lands; image_url is fine for MVP]**. Full creative library = #866.
- **OD‑7 — Status freshness:** on‑demand "Sync status" button for MVP **[RECOMMEND]**; a `pg_cron` → `admin-meta-campaign-sync` heartbeat is a fast‑follow (nice‑to‑have, not in this story).
- **OD‑8 — IG placement:** ship Facebook‑only (omit `instagram_user_id`) until `ads_get_ig_accounts` confirms the linked IG account **[RECOMMEND]**.

---

## Downstream routing
**Next:** `mingla-implementor` (build from this SPEC in the worktree below) → `mingla-tester` (RLS + fail‑close + live‑fire once §7 prereqs are done) → orchestrator CLOSE.
**Working tree:** `~/Desktop/mingla-orchs/issue-862-meta-ads-api/` on branch `issue-862-meta-ads-api`.
