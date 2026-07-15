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

## Amendment A3 (2026-07-14) — generalization to the platform-agnostic, lane-aware, 5-channel engine

**Correction (supersedes the Meta-only shape of §1–§10 below).** This story is no longer "the Meta channel with `meta_*` tables"; it is **the engine** — one platform-agnostic, lane-aware table set + one `ChannelAdapter` interface + one `admin-ad-*` edge surface that serves **five** provisioned ad channels (Meta, TikTok, Snapchat, Google, Reddit). Meta is simply the **first adapter**. A2 established multi-connection across **lanes** (consumer/business); A3 extends that same model across **platforms**. Every sibling spec (#863 TikTok, #866 creative library, #867 Snap+Google) independently converged on exactly this generalization; **A3 is the canonical definition they all depend on.**

**This is a spec-level rename, NOT a data migration.** #862 is unbuilt — the implementor builds the generalized version **from the start**. There is no `meta_*` table to migrate; every `meta_*` name in §4.2–§10 below reads as its generalized equivalent (mapping in **F**). Where §4.2–§10 still say `meta_ad_connections`/`meta_campaigns`/`_shared/meta.ts`/`admin-meta-*`, A3 governs.

### A. Generalized schema (replaces the `meta_*` tables)

Budgets are stored in **minor units (cents)** everywhere; each adapter converts at its API boundary (TikTok cents → dollars ÷100; Snapchat/Google/Reddit cents → micro ×10,000). No token column exists on any table — ever.

**`public.ad_connections`** — one row per `(platform, lane)`.
```
id                  uuid PK default gen_random_uuid()
platform            text NOT NULL CHECK (platform IN ('meta','tiktok','snapchat','google','reddit'))
lane                text NOT NULL CHECK (lane IN ('consumer','business'))
display_name        text NOT NULL                 -- human label, e.g. 'Meta · Consumer (Use Mingla)'
external_account_id text NOT NULL                 -- the ad-account id (Meta ad account / TikTok advertiser / Snap adaccount / Google customer / Reddit ad account)
external_org_id     text NULL                     -- Snap org / TikTok Business Center / Google MCC login-customer-id / Reddit business id / Meta business id
auth_kind           text NOT NULL CHECK (auth_kind IN ('system_user_token','refresh_token','dev_token_oauth'))
token_env_var       text NOT NULL                 -- NAME of the Supabase Edge secret holding the token/refresh token — NEVER the value
extra               jsonb NOT NULL DEFAULT '{}'   -- pixel_id, page_id, capi_env_var, client-id/secret env-var NAMES, cloud project, identity id, etc.
status              text NOT NULL DEFAULT 'unknown' CHECK (status IN ('connected','invalid','unknown'))
created_at          timestamptz NOT NULL DEFAULT now()
updated_at          timestamptz NOT NULL DEFAULT now()
UNIQUE (platform, lane)
-- COMMENT: 'Ad-platform credentials live ONLY in Supabase Edge Function Secrets (Deno.env, resolved via token_env_var / the *_env_var NAMES in extra). This table stores env-var NAMES, never a token value. Refresh-token platforms (snapchat/reddit) mint a short-lived access token in edge memory per call; it is never persisted.'
```
> Operational status columns established by A2/§4.2 and the siblings — `currency`, `timezone`, `min_daily_budget_cents`, `account_status`, `token_last_verified_at`, `connected`, `connected_by` — are **retained** on `ad_connections` (folded from the `meta_*` shape); `extra` absorbs the per-platform miscellany (pixel/page/identity/capi env-var names). `status` is the coarse connect state the UI badges.

**`public.ad_campaigns`** — one row per campaign, written only when the full campaign→ad-set→ad set is created.
```
id                  uuid PK default gen_random_uuid()
connection_id       uuid NOT NULL REFERENCES public.ad_connections(id) ON DELETE RESTRICT
platform            text NOT NULL                 -- denormalized (= connection.platform) for query/index
external_campaign_id text NOT NULL                -- Meta campaign / TikTok campaign / Snap campaign / Google campaign resource / Reddit campaign id
name                text NOT NULL
objective           text NOT NULL                 -- normalized-per-platform ('OUTCOME_TRAFFIC' Meta / 'TRAFFIC' TikTok+Snap / channel type Google / traffic Reddit)
status              text NOT NULL DEFAULT 'PAUSED' CHECK (status IN ('PAUSED','ACTIVE','ARCHIVED','DELETED'))
daily_budget_cents  integer NULL CHECK (daily_budget_cents IS NULL OR daily_budget_cents > 0)  -- minor units; NULL when budget lives on the ad set (ABO)
dest_url            text NOT NULL                 -- canonical public web page (fallback/reference), e.g. /e/{brandSlug}/{eventSlug}  [A1]
dest_smart_link     text NOT NULL                 -- AppsFlyer OneLink used as the creative link/landing/final URL (opens app if installed, else dest_url) + attribution  [A1]
created_by          uuid NULL REFERENCES auth.users(id)
created_at          timestamptz NOT NULL DEFAULT now()
updated_at          timestamptz NOT NULL DEFAULT now()
UNIQUE (platform, external_campaign_id)
```
> Retained from the `meta_*`/sibling shape: `delivery_status` (Meta `effective_status` / TikTok secondary / Snap ad-review rollup / Google approval), `status_synced_at`, `targeting jsonb`, the destination reference columns (`dest_page_type`, `dest_brand_slug`, `dest_entity_slug`, `dest_event_id`), and (#863) a `request_id` idempotency key `UNIQUE (connection_id, request_id)`.

**`public.ad_sets`** — one row per ad set (Meta ad set / TikTok ad group / Snap ad squad / Google ad group / Reddit ad group).
```
id                  uuid PK default gen_random_uuid()
campaign_id         uuid NOT NULL REFERENCES public.ad_campaigns(id) ON DELETE CASCADE
external_adset_id   text NOT NULL
name                text NOT NULL
targeting           jsonb NOT NULL DEFAULT '{}'   -- normalized {countries, age_min, age_max, genders, …}
budget_cents        integer NULL CHECK (budget_cents IS NULL OR budget_cents > 0)   -- minor units; NULL under CBO (budget on campaign)
optimization_goal   text NOT NULL                 -- Meta 'LANDING_PAGE_VIEWS' / TikTok 'TRAFFIC_LANDING_PAGE_VIEW' / Snap 'LANDING_PAGE_VIEW'|'SWIPES' / Google maximize_clicks / Reddit CLICKS
status              text NOT NULL DEFAULT 'PAUSED' CHECK (status IN ('PAUSED','ACTIVE','ARCHIVED','DELETED'))
created_at          timestamptz NOT NULL DEFAULT now()
updated_at          timestamptz NOT NULL DEFAULT now()
UNIQUE (campaign_id, external_adset_id)
```
> Retained: `billing_event`, `bid_strategy`, `placement jsonb`, `schedule_start_at`/`schedule_end_at`, `external_status` where a platform exposes them (per §4.0 / #863 / #867).

**`public.ads`** — one row per ad.
```
id                  uuid PK default gen_random_uuid()
ad_set_id           uuid NOT NULL REFERENCES public.ad_sets(id) ON DELETE CASCADE
external_ad_id      text NOT NULL
creative_id         uuid NULL REFERENCES public.ad_creatives(id) ON DELETE SET NULL   -- → #866 ad_creatives.id (the canonical creative)
name                text NOT NULL
status              text NOT NULL DEFAULT 'PAUSED' CHECK (status IN ('PAUSED','ACTIVE','ARCHIVED','DELETED'))
review_status       text NULL                     -- Meta ad review / TikTok audit / Snap 'PENDING'|'APPROVED'|'REJECTED' / Google approval_status / Reddit review
created_at          timestamptz NOT NULL DEFAULT now()
updated_at          timestamptz NOT NULL DEFAULT now()
UNIQUE (ad_set_id, external_ad_id)
```
> `creative_id` is the FK to #866's `ad_creatives`; the platform-specific uploaded ref (Meta `image_hash`, TikTok `material_id`, Snap `media_id`, Google asset resource, Reddit media id) is resolved at ad-create by #866's `resolveCreativeRef(creative_id, platform, lane)` and cached in #866's `ad_creative_platform_refs` — it is NOT a column here. The MVP `image_url` path from §4.4b remains as a backward-compatible alternative until #864 adopts the #866 picker.

**`public.ad_status_events`** — append-only audit (`entity`, `from_status`→`to_status`, `actor`, `ts`).
```
id            uuid PK default gen_random_uuid()
campaign_id   uuid NULL REFERENCES public.ad_campaigns(id) ON DELETE CASCADE  -- NULL if create failed before a row existed
platform      text NULL
entity        text NULL CHECK (entity IS NULL OR entity IN ('campaign','ad_set','ad'))
action        text NOT NULL CHECK (action IN ('create','launch','pause','sync','create_failed','rollback'))
actor         uuid NULL REFERENCES auth.users(id)
from_status   text NULL
to_status     text NULL
external_ids  jsonb NULL         -- partial IDs captured on failure for manual reconciliation
provider_response jsonb NULL     -- normalized provider response (NEVER contains a token)
created_at    timestamptz NOT NULL DEFAULT now()
```

**RLS (all five tables):** `ENABLE ROW LEVEL SECURITY`. `SELECT USING ( public.is_admin_user() )` for `authenticated`; **no** INSERT/UPDATE/DELETE policy (service-role — the admin-gated edge functions — writes only; matches `payment_webhook_events`). `GRANT SELECT` to `authenticated`. **Admin-only today**; the forward path for a **brand reading only its own attributed rows** is scoping by `dest_event_id → events.brand_id` — deferred (no brand-facing read path ships in this engine). **Indexes:** `ad_campaigns (connection_id)`, `ad_campaigns (platform, status)`, `ad_campaigns (dest_event_id)`, `ad_sets (campaign_id)`, `ads (ad_set_id)`, `ad_status_events (campaign_id, created_at DESC)`.

### B. `ChannelAdapter` interface — new `_shared/adChannel.ts`

One interface; per-platform modules `_shared/{meta,tiktok,snapchat,google,reddit}.ts` each implement it. Atomic create with **compensating rollback** (no orphaned partial writes) is carried from §4.4b unchanged, now per-adapter.

```
type Platform = 'meta' | 'tiktok' | 'snapchat' | 'google' | 'reddit';

interface ChannelAdapter {
  platform: Platform;
  connect(conn): AuthedClient;                               // resolves the token from Deno.env[conn.token_env_var];
                                                             // for refresh_token / dev_token_oauth, MINTS a short-lived access token in memory;
                                                             // fail-CLOSE (throw AdNotConnectedError) if the secret is missing/expired
  createCampaign(conn, input): { externalId, status };
  createAdSet(conn, campaignExternalId, input): { externalId };
  createAd(conn, adSetExternalId, input): { externalId, reviewStatus };
  setStatus(conn, level, externalId, status): void;          // level ∈ {'campaign','ad_set','ad'}; status = pause | activate (top-down launch)
  getStatus(conn, level, externalId): status;
}

function getAdapter(platform: Platform): ChannelAdapter;     // registry { meta, tiktok, snapchat, google, reddit }
class AdNotConnectedError extends Error {}                    // → 424 <platform>_not_connected  (google provisioning gap → 409 google_not_provisioned)
class AdApiError extends Error {}                             // normalized { platform, code, message, trace_id/request_id }  (NEVER echoes a token)
```

Each adapter translates the common shape to its API:
- **Meta** — Graph API `https://graph.facebook.com/v{ver}` (§4.0); `system_user_token`.
- **TikTok** — Marketing API `https://business-api.tiktok.com/open_api/v1.3`, **standard** campaign API (`campaign/create` → `adgroup/create` → `ad/create`), header `Access-Token`, `code===0`=success; Smart+ deferred (#863 §4.0).
- **Snapchat** — Marketing API `https://adsapi.snapchat.com/v1`; `refresh_token` → 60-min access token minted server-side (`_shared/snapAuth.ts`) and cached; batch envelope (`request_status` + per-entity `sub_request_status`); budgets micro; update = **PUT to parent collection** (#867 §4.0).
- **Google** — `POST customers/{id}/googleAds:mutate` (or the combined atomic `googleAds:mutate`) + GAQL `searchStream` for status; headers `developer-token` + `login-customer-id` + `Authorization: Bearer`; `dev_token_oauth`; budgets micros (#867 §4.0b).
- **Reddit** — Ads API v3 `https://ads-api.reddit.com/api/v3`, **HTTP-Basic** client-id/secret token refresh, **`User-Agent` header required**; `refresh_token`.

`_shared/meta.ts` (§4.3) is written to **implement `ChannelAdapter`** from the start (its `resolveMetaToken`/`metaGraph`/`normalizeMetaError` become the Meta adapter internals).

### C. Edge functions — generalize `admin-meta-*` → `admin-ad-*`

All POST, `verify_jwt=true`, in-code `admin_users` active gate (§4.4), service-role DB writes. Each reads `{ platform, lane, … }`, loads the `ad_connections` row for `(platform, lane)`, and dispatches via `getAdapter(platform)`:
- **`admin-ad-connect`** — `{ platform, lane, action:'connect'|'status' }`; verifies the credential, upserts the connection (`status='connected'|'invalid'`); missing/invalid token → **424** `<platform>_not_connected`; Google provisioning gap → **409** `google_not_provisioned`.
- **`admin-ad-create-campaign`** — the atomic create (destination resolve → budget-min → per-adapter campaign→ad-set→ad, all PAUSED → persist one `ad_campaigns`+`ad_sets`+`ads` set; no-orphan compensating rollback).
- **`admin-ad-set-status`** (a.k.a. `admin-ad-campaign-action` in the siblings) — `{ campaign_id, action:'launch'|'pause' }`; top-down `setStatus`.
- **`admin-ad-report`** (a.k.a. `admin-ad-campaign-sync` in the siblings) — status read-back (`status`/`delivery_status`/`review_status`); **no attribution/insights** (that is #865).

### D. The 5-channel connection registry (seed rows — real IDs; tokens by ENV-VAR NAME only, NEVER values)

| platform / lane | external_account_id | external_org_id | auth_kind | token_env_var | extra (env-var NAMES + non-secret ids) | status |
|---|---|---|---|---|---|---|
| **meta / consumer** | `2393570861066813` | `830733900115504` (business) | `system_user_token` | `META_SYSTEM_USER_TOKEN` | page `797406353459597`, pixel `1949011972638955`, capi_env_var `META_CAPI_ACCESS_TOKEN` | **GREEN** |
| **tiktok / consumer** | `7627974536397766673` (advertiser) | `7627974686760009729` (Business Center) | `system_user_token` | `TIKTOK_ACCESS_TOKEN` | pixel `7662469356818858002`, events_env_var `TIKTOK_EVENTS_ACCESS_TOKEN`, identity `@usemingla` | **app in review** (token pending TikTok app review) |
| **snapchat / consumer** | `6421cc96-dcaf-4a09-a7fa-b24199dcb391` | `9389df65-3fa2-4a79-9593-479eee8d67bb` (org) | `refresh_token` | `SNAPCHAT_REFRESH_TOKEN` | client-id env `SNAPCHAT_CLIENT_ID`, client-secret env `SNAPCHAT_CLIENT_SECRET`, pixel `af5f8fc4-1ef6-41e7-81c5-042b7be7df38`, capi_env_var `SNAPCHAT_CAPI_TOKEN` | **GREEN** |
| **google / consumer** | `5083048929` (customer) | `8284700017` (MCC login-customer-id) | `dev_token_oauth` | `GOOGLE_ADS_REFRESH_TOKEN` | dev-token env `GOOGLE_ADS_DEVELOPER_TOKEN`, oauth-client env `GOOGLE_ADS_OAUTH_CLIENT_ID`/`GOOGLE_ADS_OAUTH_CLIENT_SECRET`, cloud project `mingla-ads-engine` | **GREEN** (server verified; prod Basic-access approval pending) |
| **reddit / consumer** | "Mingla Ad Account 0" (a2_ id TBD) | `950c8eac…` (business) | `refresh_token` | `REDDIT_ADS_REFRESH_TOKEN` | client-id env `REDDIT_ADS_CLIENT_ID`, client-secret env `REDDIT_ADS_CLIENT_SECRET`, pixel `a2_jcfwvnfcfqcs`, capi_env_var `REDDIT_ADS_CAPI_TOKEN` (TBD) | **GREEN** (own-account Ads-API verified, no allow-list) |

Four of the five are verified live (Meta, Snapchat, Google, Reddit); TikTok delivery waits on TikTok app review. Seed all five as `consumer`-lane rows.

**Business lane (future work):** a parallel set of `lane='business'` connections (the Mingla Business B2B portfolio) is **not yet provisioned** — most business-lane accounts/tokens don't exist. The `UNIQUE (platform, lane)` schema already supports them; **consumer lane ships first**, business lands per-platform as it is provisioned (the builder shows business as a disabled option until then — #864 A2).

### E. Secrets invariant

All tokens live **ONLY** in Supabase Edge Function Secrets (`Deno.env`), resolved via `token_env_var` (and the `*_env_var` NAMES inside `extra`). The DB stores only the env-var **NAME**, never a token. Refresh-token platforms (Snapchat, Reddit) and `dev_token_oauth` (Google) mint a short-lived access token **in edge memory** per call and never persist it. **No at-rest DB token encryption** — this matches the Stripe / Paystack / AppsFlyer precedent (and §6/OD-2 below). The strict-grep CI gate (RT-3, §9) is widened to assert **every** platform token/refresh-secret name appears only under `supabase/functions/**` and never in any client bundle.

### F. Migration / coordination note (governs §4.2, §4.3, §4.4, §10)

This amendment **generalizes** #862's `meta_*` schema + `_shared/meta.ts` + `admin-meta-*` functions. Because #862 is **unbuilt**, the implementor builds the generalized version **directly — no live data migration**. Name mapping (A3 wins wherever §4.2–§10 still use the old names):

| §4.2–§10 (Meta-only) | A3 canonical |
|---|---|
| `meta_ad_connections` | `ad_connections` |
| `meta_campaigns` | `ad_campaigns` (+ child `ad_sets`, `ads`) |
| `meta_campaign_status_events` | `ad_status_events` |
| `_shared/meta.ts` (sole module) | `_shared/adChannel.ts` (interface) + `_shared/meta.ts` (one adapter of five) |
| `admin-meta-connect` / `-create-campaign` / `-campaign-action` / `-campaign-sync` | `admin-ad-connect` / `admin-ad-create-campaign` / `admin-ad-set-status` / `admin-ad-report` |
| `META_*` only in the §10 allowlist / strict-grep | all five platforms' env-var names (Meta/TikTok/Snapchat/Google/Reddit) |

**Sibling coherence (this A3 is the canonical source they depend on):** #863 (TikTok), #866 (creative library) and #867 (Snapchat+Google) already reference `ad_connections`/`ad_campaigns`/`ad_sets`/`ads`/`ad_creatives`. Reconciliations A3 pins as canonical: (1) the audit table is **`ad_status_events`** (not #863's `ad_campaign_status_events`); (2) edge functions are **`admin-ad-*`** without a trailing "s" (not #863's `admin-ads-*`); (3) external IDs are **`external_campaign_id`/`external_adset_id`/`external_ad_id`** (not #867's `provider_*`); (4) budgets are stored in **cents** (adapters convert to micro/dollars at the boundary — not #867's `budget_micro`); (5) the platform enum is **`('meta','tiktok','snapchat','google','reddit')`** — adds `reddit` and uses full `snapchat` (not #866's `'snap'`); (6) `auth_kind ∈ ('system_user_token','refresh_token','dev_token_oauth')` (folds #867's `'bearer_token'`→`system_user_token`, `'oauth_service'`→`dev_token_oauth`). **#866's `ad_creatives.id` is the `ads.creative_id` FK** — the creative library is the canonical creative source; `resolveCreativeRef` produces the per-platform uploaded ref at ad-create.

---

## Amendment A4 — battle-test corrections (2026-07-15, evidence-backed)

**Sources (all local to `Mingla_Artifacts/research/ad-pipeline-2026-07-15/`):** `GAP_REGISTER.md` (74 gaps, §4 spec-correction tables), `PROOF_LOG.md` (live probes with the **engine's own credentials**, 2026-07-15 session — proof-grade, **overrides the gap register wherever they conflict**), `PIPELINE_BLUEPRINT.md` (§1.0 preflight, §3.5 objective→goal matrix, §4.12/§4.13 interface widening). Evidence keys: `GR-nn` = gap-register row · `M-n`/`R-n`/`G-n` = §4 correction-table rows · `M-Pn`/`T-Pn`/`S-Pn`/`G-Pn`/`R-Pn`/`D-P1` = PROOF_LOG probe ids.

**A4 supersedes conflicting text in A1–A3 and the body below; it does not rewrite them.** The same conductor-fixed canonical decision block is being encoded into every sibling spec amendment filed 2026-07-15 — this A4 is its expression for #862/A3. Unchanged and reaffirmed as canon: the platform enum `('meta','tiktok','snapchat','google','reddit')` and A3 §F naming (`ad_status_events`, `admin-ad-*`, `external_campaign_id`/`external_adset_id`/`external_ad_id`).

### A4.a — `ChannelAdapter` widening (this IS the A4 interface — the ONE coordinated change all five adapters build against)

Supersedes A3 §B's interface as written. Final shape:

```
type Platform = 'meta' | 'tiktok' | 'snapchat' | 'google' | 'reddit';

interface ChannelAdapter {
  platform: Platform;
  connect(conn): AuthedClient;                       // unchanged (fail-CLOSE on missing secret)

  createCampaign(conn, input): { externalId, status };
  createAdSet(conn, campaignExternalId, input): { externalId };

  // NEW — OPTIONAL creative step (GR-17: three of five channels have nowhere to put
  // their creative step in A3's shape; GR-10: Reddit's ad points at a post, not media):
  createCreative?(conn, input): { externalCreativeId?, postId?, profileId? };
  //   meta     → AdCreative        (POST /act_{id}/adcreatives)                → externalCreativeId
  //   snapchat → Media → Creative  (upload bytes, poll media READY, create)    → externalCreativeId
  //   google   → assets via assets:mutate (linked at ad-create)                → externalCreativeId (asset resource)
  //   reddit   → structured-post job (POST /profiles/{t2_}/structured_posts/jobs
  //              → poll QUEUED/PROCESSING → SUCCESS|CLIENT_ERROR|SERVER_ERROR,
  //              bounded backoff; CLIENT_ERROR ⇒ new job, not a retry)          → { postId: t3_…, profileId: t2_… }
  //   tiktok   → NO-OP (creative is inline in ad create)
  // The Reddit poll makes the create long-running and non-atomic — it sits inside the
  // §4.4b compensating-rollback envelope; Reddit rollback = PATCH configured_status:"DELETED"
  // (no DELETE verb exists — R-5).

  createAd(conn, adSetExternalId, input): { externalId, reviewStatus };
  setStatus(conn, level, externalId, status): void;
  getStatus(conn, level, externalId): status;

  // NEW — folds in #884's coordinated change (BLUEPRINT §4.12); the Brain's reallocation
  // loop needs a budget mutator. `cents` is the at-rest unit; conversion below.
  setBudget(conn, level, externalId, cents): void;
}
```

**Create-ad input widening (GR-15):** the create input gains `headlines[]`, `descriptions[]`, `keywords[]`, `negative_keywords[]`. Google RSA requires **3–15 headlines × ≤30 chars and 2–4 descriptions × ≤90** (GAP §4 G-4); a SEARCH campaign without keywords cannot meaningfully serve. **PMax is explicitly DEFERRED — MVP = Google SEARCH + RSA only** (PMax has no ad groups/ads and requires a single bulk `googleAds:mutate` with temp IDs — not expressible as sequential `createX` calls; BLUEPRINT §4.13). This decision is recorded here because #864 currently advertises "Google = Search / Display" — superseded.

**Budgets — cents at rest, one conversion point per adapter (GR-01, the 10,000× money bug):** the at-rest column is **`budget_cents bigint`** (widens A3 §A's `integer`; applies to `ad_campaigns.daily_budget_cents` and `ad_sets.budget_cents`). Conversion happens at **exactly one place per adapter**: Meta cents→cents (identity) · TikTok cents ÷ 100 → dollars · Snapchat/Google/Reddit cents × 10,000 → micro. **Minimum-budget checks run in the platform unit AFTER conversion.** Mandatory unit test: **$5.00 → 5,000,000 micro** and **$20.00 → 20,000,000 micro**.

**Targeting passthrough (GR-31 / R-8):** `ad_sets.targeting` gains a per-platform **`passthrough` jsonb**. Reddit's goes here: `communities[]`, `excluded_communities[]`, `view_modes[]`, `locations[]`. **Reddit has NO age field** — the normalized `age_min`/`age_max` apply to Meta/TikTok/Snapchat/Google **only**; Reddit's `targeting` object is `additionalProperties: false`, so any unknown key (including an age field) is an outright **400**.

**CTA maps are per-platform — never a shared normalizer (GR-29):** Reddit's CTA enum is **Title-Case display strings** (`"Buy Tickets"`, `"Book Now"`, `"See Menu"`), unlike every other channel. **Mandatory unit test: the Reddit CTA is never uppercased.**

**PAUSED invariant (GR-11 / R-7):** everything is created **PAUSED explicitly at every level on every channel** — never rely on a platform default. Reddit's schema default is `ACTIVE`, so the adapter always sends `configured_status: "PAUSED"` at campaign, ad-group and ad level, guarded by a **strict-grep CI gate** (house pattern) asserting `_shared/reddit.ts` never constructs a create body without an explicit `configured_status`.

**Versions:** `META_API_VERSION=v25.0` (M-1) · `GOOGLE_ADS_API_VERSION=v24` — **v25 does not exist**; current is v24.x (GAP §4 G-1 / GR-44).

### A4.b — Meta field corrections M-1…M-13 (old → new → evidence)

| # | Location | Old (body/A2) | New (canonical) | Evidence |
|---|---|---|---|---|
| **M-1** | `META_API_VERSION` | `v21.0` (A2, §7.6) | **`v25.0`** (shipped 2026-02-18; `7d_view`/`28d_view` attribution windows already dropped 2026-01-12) | GAP §4 M-1 / GR-43; v25 changelog |
| **M-2** | `optimization_goal` enum | the 19 values from `ads_get_field_context` (§4.0) | the create contract accepts **26** (adds `ENGAGED_PAGE_VIEWS`, `MESSAGING_PURCHASE_CONVERSION`, `MEANINGFUL_CALL_ATTEMPT`, `IN_APP_VALUE`, `PROFILE_VISIT`, `PROFILE_AND_PAGE_ENGAGEMENT`, `VIDEO_VIEWS`; several account-gated). **Validate off the objective→goal matrix (BLUEPRINT §3.5), not a flat list** | GAP §4 M-2; `ads_create_ad_set` schema |
| **M-3** | objective→goal validation | absent (relies on Meta server-side auto-correct) | an invalid goal is **silently auto-corrected** to the recommended default — a silent-wrong-config hazard; validate client-side against the §3.5 matrix | GAP §4 M-3 |
| **M-4** | `special_ad_categories` | `CREDIT` implicitly valid | **`CREDIT` RETIRED 2025-01-14 → `FINANCIAL_PRODUCTS_SERVICES`**; there is no `ONLINE_GAMBLING_AND_GAMING` category (see A4.g) | GAP §4 M-4 / GR-56 |
| **M-5** | Lookalike ratio | 1%–10% assumed | **1%–20%** (`0.01`–`0.20`, `0.01` steps); min seed ≥100; geography automatic | GAP §4 M-5 |
| **M-6** | Pacing | "2× daily budget" | **175%** of daily, averaged over a **calendar week (Sun–Sat)**, **7×** hard ceiling | GAP §4 M-6; help/190490051321426 |
| **M-7** | Text limits | per-placement figures treated as hard | only official hard maxes: **primary/body 1024, headline/description 255**; per-placement figures (125/40/27…) are "recommended for full display" → **warn, never reject** | GAP §4 M-7 |
| **M-8** | `frequency_control_specs` | ungated | writable **ONLY on REACH/THRUPLAY** ad sets — 400s on our LINK_CLICKS/LPV sets | GAP §4 M-8 |
| **M-9** | Min budget | flat `100`¢ (A2/§4.2, AC-3) | **per-optimization-category** via `GET /act_{id}/minimum_budgets` — see A4.g for the live values | GAP §4 M-9 / GR-41; **PROOF M-P8** |
| **M-10** | Creative body | image-only `link_data` | needs a **`video_data` branch** — see A4.g | GAP §4 M-10 / GR-57 |
| **M-11** | CTA map | `GET_TICKETS → BUY_TICKETS` | **correct — keep** (`GET_TICKETS` is not a real enum value) | GAP §4 M-11 |
| **M-12** | Reels duration | 60s/90s caps assumed | **IG Reels = 15 min; FB Reels = no maximum** — do not hardcode 60/90 | GAP §4 M-12 |
| **M-13** | **campaign create — NEW REQUIRED FIELD** | absent from every spec | v25 campaign create **REQUIRES `is_adset_budget_sharing_enabled`** when not using CBO (subcode 4834011) — **send explicit `false` unless CBO**. Proven by validate-only: first run failed on the missing field; with it, `{"success":true}` and nothing created | **PROOF M-P5 [VALIDATE-ONLY]** |

> **Sibling correction G-14 (Google), recorded here because it was proven in the same validate-only session:** Google v24 campaign create **REQUIRES `contains_eu_political_advertising`** (send `DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING`) — a required field in no spec; without it the mutate fails, with it the full SEARCH+RSA chain validates clean (**PROOF G-P3 [VALIDATE-ONLY]**).

### A4.c — §D registry re-baseline (per PROOF_LOG channel scoreboard; supersedes A3 §D statuses and IDs)

| platform / lane | Status (2026-07-15, proof-grade) | Evidence + registry-row corrections |
|---|---|---|
| **meta / consumer** | **GREEN — validation-complete** | Token authenticates (M-P1); account **ACTIVE + payment method** (M-P2 — GR-03 is STALE); campaign shape validates with M-13 (M-P5); creative with our `page_id` validates after the app was flipped to **Live** (M-P6, B6 resolved); exactly one canonical pixel (M-P11). **IG account NOT linked to Page `797406353459597`** (M-P10) → **Facebook-only until a human links IG** (see A4.e). |
| **tiktok / consumer** | **AMBER** | Token LIVE, app approved 2026-07-15 (T-P1 — A3's "app in review" and GR-04 are STALE). Remaining gates: **balance $0 vs the $20/day ad-group floor** (T-P3); **GB ABSENT from `tool_region_get`** for TRAFFIC and APP_PROMOTION — London untargetable, US/NG/CA viable (T-P2); pixel zero events (T-P4); identity `@usemingla` TT_USER AVAILABLE (T-P5). |
| **snapchat / consumer** | **AMBER-GREEN** | Mint works, `expires_in: 3600`, both scopes (S-P1); account ACTIVE (S-P2); funding servable, $15k/day limit (S-P3); pixel ACTIVE (S-P5). **Public Profile = trusted config `SNAPCHAT_PROFILE_ID`** — the profile lookup **403s on our token class** (S-P4), so it is config-trusted, verified at first creative create (Snap has no validate-only). |
| **google / consumer** | **GREEN** | **BASIC tier approved 2026-07-15** (G-P1 — GR-06's TEST-tier framing is STALE). **Account `3623860476` (ENABLED, `testAccount:false`, USD, billed) REPLACES the dead `5083048929` EVERYWHERE** — including A3 §D's `external_account_id`. London geo constant `1006886` resolved via country-scoped suggest (G-P2); full SEARCH+RSA chain validate-only clean with G-14 (G-P3). |
| **reddit / consumer** | **GREEN-provisioned** | All captured live: business **`950c8eac-da26-45e6-942e-645ed657e43f`** (R-P2 — replaces A3's truncated `950c8eac…`); ad account **`a2_jcfwvnfcfqcs`** SELF_SERVE, USD, `admin_approval: VALID` (R-P3 — replaces A3's "a2_ id TBD"); profile **`t2_2ikkjswp3a`** (R-P4); funding **`is_servable: true`** after the 2026-07-15 billing fix (R-P5). **Note: the Reddit pixel id == the ad-account id** (`a2_jcfwvnfcfqcs`) — consistent across both pixel endpoints (R-P3). No validate-only exists on Reddit — the first create is the proof. |

### A4.d — A3 Reddit corrections R-1…R-11 (supersede A3's registry line and §A/§B Reddit semantics)

| # | Location | Old (A3/brief) | New (canonical) | Evidence |
|---|---|---|---|---|
| **R-1** | A3 §D registry | "a2_ id TBD", GREEN asserted | id can be `t2_` or `a2_` (`pattern: ^(t2|a2)_.*`) — never assume; **now CAPTURED: `a2_jcfwvnfcfqcs`** (see A4.c) | GAP §4 R-1; **PROOF R-P3** |
| **R-2** | A3 §B token mint | 3600 s implied | **`expires_in` is 3600 OR 86400** ("whichever is listed") — do not hardcode 3600; **ours proven 86400** | GAP §4 R-2; **PROOF R-P1** |
| **R-3** | A3 §A `ads.review_status` | "Reddit review" | **no such field** — it is **`ad.effective_status`** ∈ `{PENDING_APPROVAL, REJECTED, ACTIVE, PENDING_BILLING_INFO, PENDING_ID_VERIFICATION, PROCESSING, MISSING_PERMISSIONS, INVALID_DATA_SOURCE, …}` + **`rejection_reason`** (100+ enum) | GAP §4 R-3; OpenAPI spec |
| **R-4** | A3 §A creative ref | "Reddit media id" via `resolveCreativeRef` | **there is no media id on a Reddit ad** — the ad is `{ad_group_id, post_id: t3_…, profile_id: t2_…}`; the **post must exist first** (async structured-post job, A4.a) | GAP §4 R-4 / GR-10 |
| **R-5** | A3 §B rollback | "compensating **delete**" | **no DELETE verb exists** for campaign/ad_group/ad → rollback = **`PATCH configured_status: "DELETED"`** | GAP §4 R-5 |
| **R-6** | objective enum | brief's `BRAND_AWARENESS/REACH/TRAFFIC/…` | real enum: `APP_INSTALLS, CATALOG_SALES, CLICKS, CONVERSIONS, IMPRESSIONS, LEAD_GENERATION, VIDEO_VIEWABLE_IMPRESSIONS` — no REACH/TRAFFIC/BRAND_AWARENESS. **A3's "traffic → CLICKS" mapping is correct — keep** | GAP §4 R-6 |
| **R-7** | `configured_status` | omitted from create bodies | **`default: ACTIVE`** — omission publishes a **live, spending campaign**; send `"PAUSED"` explicitly at all three levels + strict-grep CI gate (A4.a) | GAP §4 R-7 / GR-11 |
| **R-8** | A3 normalized targeting | `{countries, age_min, age_max, genders}` | **Reddit has NO age field**; `gender ∈ {FEMALE, MALE, null}`; `targeting` is **`additionalProperties: false`** ⇒ any unknown key is a 400 → use the A4.a `passthrough` | GAP §4 R-8 / GR-31 |
| **R-9** | coverage | #867 registry omits Reddit (`grep -i reddit` → 0 hits) | Reddit lives **only** in this spec's A3/A4 — its full adapter spec must still be written from scratch | GAP §4 R-9 |
| **R-10** | carousel | guide says 2–7 creatives | **schema says `minItems: 1, maxItems: 6`** — schema and guide conflict; **trust the schema**, let the API 400 decide (flagged, unresolved by live proof) | GAP §4 R-10 |
| **R-11** | `profile_username` | listed in the brief | deprecated — "never populated… removed in the next API version" | GAP §4 R-11 |

> **Spec-grade addendum (proven live):** the community-search param is **`query=`, NOT `q=`** — `q=` silently no-ops and returns the popular list (**PROOF R-P6**: `/targeting/communities/search?query=london` → r/london 1.56M, LondonPics, MovingToLondon, LondonTravel…).

### A4.e — Preflight / connect contract (re-based on PROOF_LOG) + targeting extensions

1. **Meta Page check = `GET /me/accounts` contains Page `797406353459597` with an `ADVERTISE` task.** PROVEN sufficient: `promote_pages` is empty (`{"data":[]}`, M-P3) **and creative create with our `page_id` still validates clean** (M-P6). **GR-02's hard-blocker framing and BLUEPRINT §1.0 B1 (keying preflight on `promote_pages` with `424 meta_page_not_assigned`) are both corrected** — preflight keys on `/me/accounts` + ADVERTISE task; fail connect `424 meta_page_not_assigned` only when THAT is absent. Evidence: **PROOF M-P4 + M-P6**.
2. **NEW connect-time precondition B6 — the Meta developer app must be in Live mode.** A dev-mode app hard-fails creative create with **error 1885183** ("app in development mode") — proven live (first M-P6 run), then proven resolved after the app was flipped to Live 2026-07-15 (M-P6 re-run: `{"success":true}`). Connect performs a validate-only `adcreatives` probe and maps 1885183 → **`424 meta_app_not_live`**. Evidence: **PROOF M-P6 [VALIDATE-ONLY]**.
3. **Snapchat Public Profile is trusted config** (`SNAPCHAT_PROFILE_ID`): the public-profiles lookup returns **HTTP 403 on our token class** (S-P4), so BLUEPRINT §1.0 P3's Snap check is **NOT buildable** — the profile is config-trusted and verified at the first creative create (accepted residual risk; Snap has no validate-only). Evidence: **PROOF S-P4**.
4. **Market eligibility comes from live sources, never build-time maps:** TikTok `tool_region_get` live — **GB proven ABSENT** (33 country codes, both TRAFFIC and APP_PROMOTION; US/NG/CA present). Fail loudly on an unavailable country. Evidence: **PROOF T-P2**.
5. **The `422 pixel_no_signal` gate:** until the pixel fires, Meta `optimization_goal = LINK_CLICKS` (default) and Snap `= SWIPES`; `admin-ad-create-campaign` **rejects `LANDING_PAGE_VIEWS`/`OFFSITE_CONVERSIONS`/`VALUE` with `422 pixel_no_signal`** while `last_fired_time` is epoch-0/null (both browser and server `last_fired_time` are epoch-0 today — **PROOF M-P7**; GR-19/GR-21). This supersedes OD-4's `LANDING_PAGE_VIEWS` recommendation. Goal validity is checked against the objective→goal matrix (BLUEPRINT §3.5), per M-2/M-3.
6. **City/radius targeting extension (GR-35):** the Meta Targeting Search API is **PROVEN callable with our token** (`GET /search?type=adgeolocation`, **PROOF M-P9**) — §4.0's "not exposed" claim was an MCP artifact (GR-74). Extend `targeting` with `cities[{key, radius, distance_unit}]` (+ the wider GR-35 shape) and add an admin-gated `admin-ad-targeting-search` edge fn proxying `GET /search`. **Hazard (proven):** Meta's own city search sorts **London, Canada (key `294545`) BEFORE London, GB (`812057`)**; Lagos NG = `1630653` (PT Lagos second) — **always disambiguate by `country_code`**, exactly like Google's London problem.
7. **IG resolution via Graph (GR-34 — reverses OD-8's posture):** resolve via `GET /{page_id}?fields=instagram_business_account` (proven callable — **PROOF M-P10**); the field is **currently absent** (no IG account linked to the Page) → **Facebook-only is the fallback until a human links IG, not the target**. Store the resolved IG user id in `ad_connections.extra` when it appears; IG delivery unlocks Feed/Stories/Reels/Explore.

### A4.f — Destination policy v1 (supersedes A1's "creative `link_url` = `dest_smart_link`")

**PROVEN by PROOF D-P1 [ENGINE-LIVE]:** fetching `go.usemingla.com/w36m` as `facebookexternalhit/1.1` returns a 302 to an **`af-preview` app-install interstitial** (`af_robot_sig`, app-store meta tags only — not the destination page; HEAD → 404), while canonical `usemingla.com` serves 200 to the same UA. **The cloaking-pattern risk (GR-32) is real, not theoretical.** Policy v1, mandatory on all channels:

- The **ad-visible destination is the canonical `https://usemingla.com/e/…` page on ALL channels** — creative `link_url` (Meta), landing URL (TikTok/Snap), `final_urls` (Google), `click_url` (Reddit) all carry `dest_url`, never the OneLink.
- The **OneLink rides ONLY in Google `tracking_url_template`** (the platform-sanctioned slot). No other channel carries it in v1.
- **`minglabiz.onelink.me` is NEVER used anywhere** — dead on Android (COMMS-0100/0101).
- `ad_campaigns.dest_smart_link` is **retained** (A1's column stands) but demoted: it is the Google tracking-template value / future re-enable slot, **not** the creative link. A1's create-step change (§4.4b step 3 `link = dest_smart_link`) is **reverted to `link = dest_url`** until AppsFlyer's crawler behavior is reconfigured and re-proven against a real crawler UA.

### A4.g — Budget floors + creative-body corrections

- **Meta budget floors are per-optimization-category** via `GET /act_{id}/minimum_budgets`. Live USD values (**PROOF M-P8**): **imp 100¢ · video_views 100¢ · high_freq 500¢ · low_freq 4000¢** ($1/$1/$5/$40). **`LINK_CLICKS` is high-frequency ⇒ the floor is $5/day, not $1** — A2/§4.2's flat `min_daily_budget_cents = 100` and AC-3's check against it are superseded; validate against the floor for the chosen goal's category. **Never hardcode the table — fetch at connect and store all four values in `ad_connections.extra`.** (Consequence: §8's "$1.00/day live-fire" reads as **$5.00/day** under LINK_CLICKS.) Evidence: GR-41 / M-9 / **PROOF M-P8**.
- **Creative `video_data` branch (GR-57 / M-10):** `object_story_spec.video_data = { video_id, image_hash:<thumbnail>, title, message, link_description, call_to_action }` — #866 already produces the `video_id` via `POST /act_{id}/advideos` + poll `video_status === 'ready'`. The async poll gets a timeout + typed error; a video stuck in transcoding **fails closed and rolls back** per the no-orphan contract. Without this branch, Reels/Stories are unreachable.
- **`special_ad_categories` validation (M-4 / GR-56):** whitelist `HOUSING | EMPLOYMENT | FINANCIAL_PRODUCTS_SERVICES | ISSUES_ELECTIONS_POLITICS | NONE`; **reject `CREDIT`** (retired 2025-01-14 → `FINANCIAL_PRODUCTS_SERVICES`) with a migration message; there is no `ONLINE_GAMBLING_AND_GAMING` value. When non-empty, enforce the restriction cascade **before** the Meta call (force age 18–65, strip `genders`, forbid `zips`/`excluded_geo_locations`, radius floors, strip behavior/demographic `flexible_spec`, forbid lookalikes) and require `special_ad_category_country`.
- **`self_ai_disclosure` (GR-61):** add `ad_creatives.ai_generated boolean`; **default `OPT_IN` for anything from the Higgsfield/Remotion pipeline** — our creative pipeline is AI-generative and non-disclosure is a compliance exposure we are actively creating.
- **`url_tags` UTM template (GR-61):** `utm_source=facebook&utm_medium=paid&utm_campaign={{campaign.name}}&utm_content={{ad.name}}&placement={{placement}}` (per-platform `utm_source` in the other adapters) — without it PostHog/GA are blind to paid traffic.
- **`conversion_domain = usemingla.com`** on the ad (Meta AEM) — pairs with A4.f: the conversion domain is the canonical destination domain.

**A4 supersession map (governs on conflict):** A1 §4.4b-step-3 (`link_url` → A4.f) · A2/§7.6 `META_API_VERSION` (→ v25.0) · A3 §A `budget_cents`/`daily_budget_cents` type (→ `bigint`) and `ads.review_status` Reddit semantics (→ R-3) · A3 §B interface (→ A4.a) · A3 §D statuses + Google/Reddit account ids (→ A4.c) · §4.0 optimization-goal sourcing (→ M-2/GR-74) · §4.2/AC-3 min-budget (→ A4.g) · OD-4 (→ A4.e.5) · OD-8 (→ A4.e.7).

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
