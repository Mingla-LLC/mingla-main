# SPEC — Attribution & reservation-conversion tracking

**Issue:** GitHub #865 (child of initiative #852 "[Full Rooms] Internal Ad & Reservation Engine")
**Mode:** INVESTIGATE-THEN-SPEC (recon done; grounded in live AppsFlyer/Meta probes + codebase recon, 2026‑07‑14)
**Worktree:** `~/Desktop/mingla-orchs/issue-865-attribution-engine/` on branch `issue-865-attribution-engine` (stacked on `issue-864` → `issue-862`)
**Depends on:** **#862** (campaign IDs + `dest_smart_link`) · **complements #864** (unlocks its disabled Purchases/Retargeting goals)
**Downstream routing:** this SPEC → `mingla-implementor` → `mingla-tester` → orchestrator CLOSE
**Author:** mingla-forensics · **Date:** 2026-07-14

> **User story (verbatim):** "As Mingla, I can attribute reservations/visits back to the ad and public page that drove them, so we can prove ROI to venues." AC: click/deep-link tracking to public page; conversion event on reservation; per-campaign + per-page rollups; feeds the business proof surface.

---

## Amendment A1 (2026-07-14) — consumer-lane pixel/CAPI PROVISIONED + two-lane tracking

**Consumer tracking assets are provisioned + verified (2026-07-14):** Meta pixel **Mingla Web `1949011972638955`** (created; NOT yet installed on the site — this spec installs it) and a **Conversions-API token** (**verified valid**). Real values → `MINGLA_MASTER_KEYS.md` → "Meta Ads Engine". Secrets: `META_DATASET_ID=1949011972638955`, `META_CAPI_ACCESS_TOKEN` (verified), `EXPO_PUBLIC_META_PIXEL_ID=1949011972638955`. So §4's "Meta Pixel/CAPI = greenfield" updates to **"provisioned but not yet wired into code"** — this spec wires it.

**TikTok tracking ALSO provisioned + verified (2026-07-15):** TikTok pixel **"Mingla Web" `7662469356818858002`** (code `D9B98EBC77U1EOHV2O0G`, created via the hosted TikTok MCP; NOT yet installed — this spec installs it) + an **Events API access token** (stored). Advertiser `7627974536397766673` (**STATUS_ENABLE**, $10 prepaid), BC `7627974686760009729`. Secrets: `TIKTOK_EVENTS_ACCESS_TOKEN`, `TIKTOK_PIXEL_CODE=D9B98EBC77U1EOHV2O0G`, `TIKTOK_ADVERTISER_ID=7627974536397766673`, `EXPO_PUBLIC_TIKTOK_PIXEL_CODE=D9B98EBC77U1EOHV2O0G` (real values → `MINGLA_MASTER_KEYS.md` → "TikTok Ads"). So **both Meta AND TikTok conversion channels are provisioned** — this spec sends to **both** (Meta CAPI via `graph.facebook.com` + TikTok Events API via `business-api.tiktok.com/open_api/v1.3/event/track/`), each deduped with its browser pixel per §5.

**Snapchat tracking ALSO provisioned + verified (2026-07-14):** Snap pixel **"Usemingla Pixel" `af5f8fc4-1ef6-41e7-81c5-042b7be7df38`** + Conversions API token (`SNAPCHAT_CAPI_TOKEN`) + **verified OAuth refresh token** (`SNAPCHAT_REFRESH_TOKEN`, mints 60-min access tokens). Org `9389df65-…`, ad account **"Mingla Ads" `6421cc96-…`** (ACTIVE). Snap Conversions API = `POST https://tr.snapchat.com/v3/{pixel_id}/events?access_token=…` (or the CAPI-token auth). Real values → `MINGLA_MASTER_KEYS.md` → "Snapchat Ads". So **#865 sends conversions to THREE platforms** — Meta CAPI, TikTok Events API, and **Snapchat Conversions API** — each deduped with its browser pixel. All three channels' pixels + server tokens are live.

**TWO-LANE tracking (per #862/#864 Amendment A2).** Attribution is per-lane:
- **Consumer lane** — conversion = a reservation/purchase on a public page; uses the Mingla Web pixel + `META_CAPI_ACCESS_TOKEN`. Active now.
- **Business lane** — conversion = a business signs up / claims; uses a SEPARATE Mingla Business pixel + `META_MINGLABIZ_CAPI_ACCESS_TOKEN` (later).
`ad_attribution_touches` + `ad_conversions` carry the lane (or `connection_id` → #862 `meta_ad_connections`); rollups + retargeting audiences are per-lane.

---

## 1. Executive summary

Close the loop: connect an **ad click** → **public page visit** (web or in‑app) → **reservation/purchase**, so Mingla can (a) **prove ROI to venues** (per‑campaign, per‑page rollups), (b) **feed conversions back to Meta & TikTok** so they optimize delivery, and (c) **build retargeting audiences**. This is the measurement engine the whole "Full Rooms" thesis runs on.

**Grounded reality (recon):** the smart link (#862 Amendment A1, AppsFlyer OneLink `go.usemingla.com`) and a web funnel (PostHog + GA4: `view → begin_checkout → purchase`, with `capture_pageleave` = bounce) **already exist** — but **no Meta Pixel, no Meta CAPI, no TikTok tracking exist anywhere**, and **ad click‑ids/UTMs are dropped on landing**. So #865 is mostly greenfield measurement wiring on top of an existing purchase pipeline (`biz_ticket_checkout_finalize` → `orders.payment_status='paid'`).

**Phasing (honest — this is a P0 but large story):**
- **Phase A — Measure, attribute, prove:** capture click/deep‑link → persist attribution → fire a conversion on reservation → send it to **Meta CAPI + TikTok Events API** → per‑campaign/per‑page rollups → feed the business proof surface.
- **Phase B — Feed‑back & retarget:** build Meta/TikTok **retargeting audiences** from tracked visitors/converters; unlock #864's disabled **Purchases** and **Retargeting** goals.

---

## 2. Scope & non‑goals

### In scope (Phase A unless marked B)
1. **Click/deep‑link capture** on the public page — web (mingla‑business buyer pages) AND in‑app deep link (both apps) — persisting `fbclid`/`ttclid`/`af_c_id`/`utm_*` + our campaign id.
2. **Attribution persistence** — a durable touch record + threading the attribution context through checkout to the finalized order.
3. **Conversion event on reservation/purchase** — fire when `biz_ticket_checkout_finalize` marks an order `paid` and when a venue reservation is confirmed.
4. **Send conversions back** — server‑side **Meta Conversions API** + **TikTok Events API** (+ continue AppsFlyer S2S), deduplicated with the browser pixels via a shared `event_id`.
5. **Client pixels (consent‑gated)** — add **Meta Pixel + TikTok Pixel** to the existing web analytics init (alongside GA4), for browser‑side PageView/ViewContent/Purchase + click‑id cookies.
6. **Per‑campaign + per‑page rollups** — clicks, landing views, **bounce**, reservations/purchases, revenue, and **ROAS** (revenue ÷ Meta spend from #862's sync).
7. **Business‑proof data feed** — expose the per‑brand/per‑page attributed conversions + revenue the business proof surface reads.
8. **(Phase B) Retargeting audiences** — `admin-meta-audience-create` building WEBSITE/ENGAGEMENT/MOBILE_APP custom audiences; consumed by #864's retargeting goal.

### Non‑goals
- **The campaign‑create builder / launch‑pause** → #862/#864 (consumed).
- **The full business‑proof UI surface** — #865 **provides the data**; the venue‑facing proof screen is the separate "business‑proof surface" dependency named in #852. A minimal admin rollup view is included; the polished business‑app proof screen is out.
- **TikTok campaign CREATE** → #863 (this only sends conversion EVENTS to TikTok, which works independent of who created the campaign).
- **Google/Snapchat** → #867.
- **Rebuilding the purchase pipeline** — hook the existing `biz_ticket_checkout_finalize`; don't refork checkout.
- **New consent framework** — reuse the existing consent gate (`mingla_consent_v1`, PostHog `opt_out_capturing_by_default`, GA Consent Mode).

### Assumptions
- #862 is built (smart link carries `af_c_id`, `pid`, `fbclid`/`ttclid` pass‑through) — the click‑id chain starts there.

---

## 3. Cross‑Surface Impact Declaration (MANDATORY)

| # | Surface | Covered? | Behavior | Files | Parity |
|---|---------|----------|----------|-------|--------|
| 1 | Consumer iOS (`app-mobile`) | **Yes** | deep‑link touch capture in AppsFlyer `onDeepLink`; thread attribution into checkout | `app-mobile/src/services/appsFlyerService.ts`, checkout hook | **manual** parity w/ Android |
| 2 | Consumer Android (`app-mobile`) | **Yes** | same | same | manual |
| 3 | Buyer/anon **Web** (`mingla-business` web) | **Yes — primary** | capture click‑ids on landing; Meta/TikTok pixels (consent‑gated); thread into checkout | `mingla-business/src/analytics/webAnalytics.web.ts`, public route hooks, checkout | **manual** parity w/ apps |
| 4 | Business iOS (`mingla-business` native) | **Yes** | deep‑link capture (business app) — note business OneLink pending (§7) | `mingla-business/src/services/appsFlyerService.ts` | manual |
| 5 | Business Android | **Yes** | same | same | manual |
| 6 | **Admin Web** (`mingla-admin`) | **Yes** | per‑campaign/page rollup view; (Phase B) audience create | `mingla-admin/src/**` | single |
| 7 | Business Web preview | **Reference** | consumes rollup data (proof) — full UI out of scope | none here | n/a |
| — | **Backend** (`supabase/`) | **Yes — primary** | attribution tables, capture + CAPI + TikTok edge fns, rollup RPC | `supabase/migrations/**`, `supabase/functions/**` | server‑authoritative |

**Parity note:** conversion counting must be **surface‑split** (`SC‑*‑web` / `SC‑*‑ios` / `SC‑*‑android`) because web uses Pixel+CAPI while apps use AppsFlyer — a converted purchase must be counted **exactly once** per surface (dedup via `event_id`).

---

## 4. Current‑state evidence (recon, read‑only 2026‑07‑14)

- **Smart link / deep-link:** AppsFlyer OneLink live for **consumer** (`go.usemingla.com`, template `w36m`, apps `id6760440898`/`com.mingla.app.v2`); **business** template `ZSCW` (`minglabiz.onelink.me`) has **0 links / v0 = not live**. Client SDKs: `app-mobile/src/services/appsFlyerService.ts` + `mingla-business/src/services/appsFlyerService.ts` (`setOneLinkCustomDomains(['go.usemingla.com'])`, `onDeepLink`, `deep_link_value ∈ {brand,event,trip,experience,referral,internal}`). Web SDK = no‑op.
- **Purchase finalization:** RPC `biz_ticket_checkout_finalize` → `orders.payment_status='paid'`, called from `_shared/stripeWebhookRouter.ts:1165`, `paystack-webhook`, `ticket-checkout-create` (free), `reconcile-stuck-checkouts`. Venue reservations: `venue-reservation-confirm` (gated on `payment_status='paid'`).
- **`orders` schema:** `payment_status ∈ {pending,paid,failed,refunded,partial_refund}`; `event_id NOT NULL`; **no `brand_id`** (derive via `event_id → events.brand_id`); `metadata jsonb` (attribution can ride here). Intermediate `ticket_checkout_sessions` (pending → order).
- **Existing analytics:** `mingla-business/src/analytics/webAnalytics.web.ts` — PostHog‑js + GA4, **consent‑gated**, `capture_pageview:true` + `capture_pageleave:true` (**bounce captured**), funnel `web_public_offering_viewed → web_checkout_started/begin_checkout → web_purchase_completed/GA4 purchase` (the GA4 `purchase` is already commented *"for the Ads conversion link"*). Init at `mingla-business/app/_layout.tsx:556`.
- **Server S2S:** `_shared/appsFlyerS2S.ts` → `api3.appsflyer.com/inappevent/{appId}`; fires **milestone** events only (`af_purchase` **first‑sale‑per‑brand**, `mingla_first_payout`, `mingla_stripe_connect_activated`) — **not per‑conversion**. Secrets `APPSFLYER_S2S_TOKEN`, `APPSFLYER_BUSINESS_{IOS,ANDROID}_APP_ID`.
- **GREENFIELD (must build):** Meta Pixel, Meta CAPI, TikTok pixel/Events API — **none exist** client or server. No `fbclid`/`ttclid`/`utm_` capture on any public route. No `META_PIXEL_*`/`TIKTOK_*` secrets.

---

## 5. Layered specification

### 5.1 Database (migration `<ts>_issue_865_attribution.sql`)

**`public.ad_attribution_touches`** — one row per inbound tracked click/deep‑link.
```
id             uuid PK default gen_random_uuid()
click_id       text NOT NULL UNIQUE          -- our first-party id (stored in cookie / passed to checkout)
network        text NOT NULL CHECK (network IN ('meta','tiktok','other'))
external_click_id text NULL                  -- fbclid | ttclid
campaign_id    uuid NULL REFERENCES public.meta_campaigns(id) ON DELETE SET NULL
af_c_id        text NULL                     -- OneLink campaign param
utm            jsonb NOT NULL DEFAULT '{}'    -- utm_source/medium/campaign/content
dest_page_type text NULL  · dest_brand_slug text NULL · dest_entity_slug text NULL · dest_event_id uuid NULL
surface        text NOT NULL CHECK (surface IN ('web','ios','android'))
user_id        uuid NULL REFERENCES auth.users(id)
af_uid         text NULL                     -- app device (from appsflyer_devices)
ua_hash        text NULL · ip_hash text NULL -- SHA-256 (pgcrypto), privacy; never raw
created_at     timestamptz NOT NULL DEFAULT now()
```

**`public.ad_conversions`** — one row per attributed conversion (dedup‑keyed).
```
id             uuid PK default gen_random_uuid()
touch_id       uuid NULL REFERENCES public.ad_attribution_touches(id) ON DELETE SET NULL
click_id       text NULL                     -- copy for late-binding when touch not yet resolved
order_id       uuid NULL REFERENCES public.orders(id) ON DELETE SET NULL
event_type     text NOT NULL CHECK (event_type IN ('purchase','reservation','lead','view'))
value_cents    integer NULL · currency text NULL
campaign_id    uuid NULL REFERENCES public.meta_campaigns(id) ON DELETE SET NULL
brand_id       uuid NULL · event_id uuid NULL      -- resolved for rollups
surface        text NOT NULL
event_id       text NOT NULL UNIQUE          -- dedup key shared with browser pixel + CAPI
meta_capi_status    text NOT NULL DEFAULT 'pending'   CHECK (... IN ('pending','sent','failed','skipped'))
tiktok_events_status text NOT NULL DEFAULT 'pending'  CHECK (...)
appsflyer_status    text NOT NULL DEFAULT 'pending'   CHECK (...)
provider_response   jsonb NULL               -- normalized send result (NEVER a token)
created_at     timestamptz NOT NULL DEFAULT now()
```

**Threading:** add `attribution_click_id text NULL` to `ticket_checkout_sessions` (carried from the client at checkout‑create) so `biz_ticket_checkout_finalize` can stamp `orders.metadata->>'attribution_click_id'`. (Minimal, additive; do NOT restructure checkout.)

**Rollup:** `public.ad_campaign_rollups_v` (security‑invoker view) + RPC `admin_ad_rollups(p_campaign_id?, p_brand_id?, p_range)` returning per‑campaign AND per‑page: `clicks` (touches), `landing_views`, `bounce_rate` (from PostHog/pageleave — §5.5), `conversions`, `revenue_cents`, `spend_cents` (from `meta_campaigns` insights sync), `roas`.

**RLS:** `ad_attribution_touches` + `ad_conversions` — **INSERT** service‑role‑only (edge fns); **SELECT** `is_admin_user()` (admin rollups) + a brand‑scoped policy for the business proof feed (`brand_id` owned by `auth.uid()` via `brands.account_id`). Touch capture from anon web writes through the edge fn (service role), never client‑direct.

### 5.2 Edge functions

- **`attribution-capture`** (`verify_jwt=false`, anon buyer surface — pattern like `discover-merged-events`): body `{ network?, external_click_id?, af_c_id?, utm?, dest:{…}, surface, user_id? }`; generates `click_id`, inserts a touch, returns `{ click_id }`. Called from the web landing on first load AND from the apps' `onDeepLink`. Rate‑limited; hashes IP/UA.
- **`_shared/metaCapi.ts` + send on finalize** — `sendMetaConversion({event_id, event_name:'Purchase', value, currency, fbc, fbp, hashed_email, hashed_phone, event_source_url, action_source})` → `POST /v{ver}/{META_DATASET_ID}/events?access_token=…`. Token: `META_CAPI_ACCESS_TOKEN` (dataset‑scoped) OR reuse the #862 System User token if dataset‑authorized (OD‑2). Hashes PII with pgcrypto SHA‑256. Fail‑open (never block the purchase; record `meta_capi_status='failed'`).
- **`_shared/tiktokEvents.ts`** — `sendTikTokConversion({event_id, ttclid, hashed_email, hashed_phone, value, currency, url})` → TikTok Events API `POST /event/track/` with `TIKTOK_EVENTS_ACCESS_TOKEN` + `TIKTOK_PIXEL_ID`. Fail‑open.
- **Finalize hook** — in `stripeWebhookRouter` (+ `paystack-webhook`, free path, `venue-reservation-confirm`), AFTER `biz_ticket_checkout_finalize` success: resolve attribution (`orders.metadata->>'attribution_click_id'` → touch), insert `ad_conversions` (one, unique `event_id`), then call Meta CAPI + TikTok + AppsFlyer S2S. Extend AppsFlyer from milestone‑only to a per‑conversion `af_purchase` for ad‑attributed orders. **Idempotent** (unique `event_id`; re‑delivered webhooks don't double‑count).
- **`admin-ad-rollups`** (`verify_jwt=true`, admin gate) — wraps `admin_ad_rollups` RPC for the admin rollup view + business proof feed.
- **(Phase B) `admin-meta-audience-create`** (`verify_jwt=true`, admin gate) — `ads_create_custom_audience`‑shape call via the #862 System User token: WEBSITE audience (from Pixel/dataset), ENGAGEMENT, or MOBILE_APP; returns the audience id for #864's retargeting goal. TikTok audience = fast‑follow.

config.toml: `attribution-capture` `verify_jwt=false` (with in‑fn rate‑limit + no PII echo); the rest `verify_jwt=true` admin, except the finalize hook which runs inside existing service‑role webhooks.

### 5.3 Client — Web (`mingla-business`)
- Extend `src/analytics/webAnalytics.web.ts`: **consent‑gated** init of **Meta Pixel** (`fbq`) + **TikTok Pixel** (`ttq`) alongside GA4 (same consent flags — no new consent framework). On first public‑page load: parse `fbclid`/`ttclid`/`af_c_id`/`utm_*` from the URL, set `_fbc`/`_fbp` cookies, `POST attribution-capture`, store `click_id` in first‑party storage. Fire `PageView`/`ViewContent`.
- Public route hooks (`app/e/…`, `/b/…`, `/t/…`) already fire `web_public_offering_viewed` — add the click capture there. Checkout (`app/checkout/[eventId]`) passes `attribution_click_id` into `ticket-checkout-create`; confirm page fires Pixel `Purchase`/TikTok `CompletePayment` with the shared `event_id` (dedup with CAPI).
- New secrets: `EXPO_PUBLIC_META_PIXEL_ID`, `EXPO_PUBLIC_TIKTOK_PIXEL_ID`.

### 5.4 Client — Apps (`app-mobile` + `mingla-business` native)
- In `appsFlyerService.ts` `onDeepLink`: read `af_c_id` + `deep_link_*`, `POST attribution-capture` (`surface:'ios'|'android'`, `user_id`, `af_uid`), persist `click_id` locally; thread into the checkout call. AppsFlyer already attributes install/re‑engagement; configure **Meta + TikTok as connected partners in the AppsFlyer dashboard** so in‑app purchase events forward automatically (dashboard config = §7 action item, not code). Server‑side CAPI (5.2) covers webhook‑confirmed purchases regardless of surface.

### 5.5 Bounce & metrics
- **Bounce** = a public‑page session with `web_public_offering_viewed` but no `web_checkout_started` before `pageleave` — already captured by PostHog. Rollup reads it via a PostHog query (PostHog MCP/project `479999`) OR a lightweight derived counter; surface `bounce_rate` per page/campaign. No new client event needed.
- **ROAS** = attributed `revenue_cents` ÷ `spend_cents` (spend from #862's `meta-campaign-sync`, extended to pull `spend` insight).

---

## 6. Success criteria (surface‑split where parity is manual)

- **SC‑1‑web / SC‑1‑ios / SC‑1‑android:** a click on a #862 smart link that lands on a public page persists ONE `ad_attribution_touches` row with the correct `network`, `external_click_id`, `campaign_id`, `surface`, and page ref.
- **SC‑2:** the attribution `click_id` threads from landing → checkout → `orders.metadata` so a finalized order is linkable to its campaign+page.
- **SC‑3:** when an order flips to `paid` (or a venue reservation confirms), exactly ONE `ad_conversions` row is written with a unique `event_id`; re‑delivered webhooks do NOT double‑count (idempotent).
- **SC‑4‑meta / SC‑4‑tiktok:** the conversion is sent to Meta CAPI and TikTok Events API with hashed PII + the shared `event_id`; `*_status` reflects sent/failed; a send failure **never** blocks or reverses the purchase (fail‑open).
- **SC‑5 (dedup):** a web purchase counted by the browser Pixel and the server CAPI is deduplicated by Meta via the shared `event_id` (not double‑counted).
- **SC‑6:** `admin_ad_rollups` returns per‑campaign AND per‑page `clicks, landing_views, bounce_rate, conversions, revenue_cents, spend_cents, roas`, matching hand‑computed values on a seeded dataset.
- **SC‑7 (proof feed):** a brand owner can read their own page's attributed conversions + revenue (brand‑scoped RLS), and cannot read another brand's.
- **SC‑8 (consent):** with consent denied, NO Meta/TikTok pixel fires client‑side and NO PII leaves the browser; server CAPI still may run on the lawful‑basis purchase record per the existing policy (OD‑4).
- **SC‑9 (privacy):** all PII sent to Meta/TikTok is SHA‑256 hashed; no raw email/phone/IP is stored in `ad_*` tables or sent unhashed; GDPR erasure cascades.
- **SC‑10 (Phase B):** `admin-meta-audience-create` builds a real retargeting audience id that #864's retargeting goal can select.

---

## 7. Meta/TikTok/AppsFlyer prerequisites (Seth — action items)

1. **Meta dataset/Pixel:** create a Meta **Pixel/Dataset** in Events Manager; capture `META_DATASET_ID` (aka pixel id) + a **CAPI access token** (`META_CAPI_ACCESS_TOKEN`) — or authorize the #862 System User token on the dataset (OD‑2).
2. **TikTok:** create a TikTok **Pixel** + **Events API access token** in TikTok Ads Manager → `TIKTOK_PIXEL_ID`, `TIKTOK_EVENTS_ACCESS_TOKEN`. (TikTok ad *account* is #863; the pixel/events can exist independently.)
3. **AppsFlyer partner config:** connect **Meta** and **TikTok** as integrated partners in the AppsFlyer dashboard so in‑app purchase events forward (no code).
4. **Business OneLink:** the business template `ZSCW` (`minglabiz.onelink.me`) is **0 links / v0** — if business‑app‑open is desired for ad traffic, it must go live (native build). Consumer app‑open + web fallback already work.
5. **Secrets:** `META_DATASET_ID`, `META_CAPI_ACCESS_TOKEN`, `TIKTOK_PIXEL_ID`, `TIKTOK_EVENTS_ACCESS_TOKEN`, `EXPO_PUBLIC_META_PIXEL_ID`, `EXPO_PUBLIC_TIKTOK_PIXEL_ID`.
6. **App Review:** Meta CAPI needs the dataset + (for advanced matching) may require business verification (shared with #862's).

---

## 8. Invariants + regression prevention

- **Preserve purchase integrity:** the conversion send is **fail‑open** and **after** finalize — attribution must NEVER block, delay, or reverse a purchase. **RT‑1:** a test forcing CAPI/TikTok to throw asserts the order still finalizes `paid` and the conversion row records `failed`. Reverting fail‑open (making the send throw upward) fails RT‑1.
- **Idempotency:** unique `event_id` on `ad_conversions`. **RT‑2:** replaying the same webhook writes no second conversion + sends no duplicate. Reverting the unique key fails RT‑2.
- **Consent/privacy:** **RT‑3 (strict‑grep + test):** no raw email/phone/IP in `ad_*` inserts (only `*_hash`); client pixels gated on the existing consent flag. Reverting the hash or the consent gate fails RT‑3.
- **I‑PROPOSED‑865‑CONVERSION‑FAIL‑OPEN / ‑IDEMPOTENT / ‑PII‑HASHED (DRAFT)** — flip ACTIVE at CLOSE.
- No `app.json`/store‑submit change beyond adding pixel env → release‑parity gates (COMMS‑0096/0097) respected; the two apps' analytics changes must ship in lockstep native builds (they add client pixels).

## 9. Test cases

| Test | Scenario | Expected | Layer |
|---|---|---|---|
| T1 | web click w/ fbclid → land | 1 touch, network=meta | edge/e2e |
| T2 | app deep-link w/ af_c_id | 1 touch, surface=ios/android | app+edge |
| T3 | paid order w/ attribution | 1 conversion, sent to Meta+TikTok, correct value | e2e |
| T4 | CAPI throws | order still paid; status=failed | edge |
| T5 | webhook replay | no duplicate conversion/send | edge |
| T6 | pixel + CAPI same purchase | deduped by event_id | live-fire |
| T7 | rollup accuracy | rollup == hand count on seed | SQL |
| T8 | brand-scope RLS | brand A can't read brand B | SQL |
| T9 | consent denied | no client pixel, no PII egress | web |
| T10 (B) | audience create | real audience id returned | live-fire |

**Live‑fire (mingla‑tester):** run a real #862 campaign to a live page, click from a test device (web + app), complete a real purchase, and confirm the conversion appears in Meta Events Manager (Test Events) + TikTok + the admin rollup, deduplicated, with correct revenue/ROAS.

## 10. Implementation order
1. Migration (tables + RLS + rollup view/RPC + `ticket_checkout_sessions.attribution_click_id`).
2. `attribution-capture` edge fn + `_shared/metaCapi.ts` + `_shared/tiktokEvents.ts`.
3. Finalize hook wiring (stripe/paystack/free/venue) — insert conversion + sends (fail‑open, idempotent).
4. Web pixels + click capture + checkout threading (`webAnalytics.web.ts`, route hooks, checkout).
5. App deep‑link capture + checkout threading (both `appsFlyerService.ts`).
6. `admin-ad-rollups` + admin rollup view; brand‑scoped proof feed.
7. **(Phase B)** `admin-meta-audience-create`; unlock #864 goals.
8. CI: RT‑1/2/3 gates.

## 11. Open questions (with recommendation)
- **OD‑1 — Attribution model:** last‑click within a 7‑day window keyed by `click_id` **[RECOMMEND — simple, provable]** vs. multi‑touch. → last‑click v1.
- **OD‑2 — Meta CAPI token:** dedicated dataset `META_CAPI_ACCESS_TOKEN` **[RECOMMEND — least‑privilege, decoupled from #862]** vs. reuse the System User token. → dataset token.
- **OD‑3 — TikTok in Phase A or B:** include TikTok Events send in Phase A **[RECOMMEND — parent explicitly says "meta/tiktok"]** vs. defer. → Phase A.
- **OD‑4 — CAPI under denied consent:** send server purchase conversions on the transaction's lawful basis while suppressing client pixels **[RECOMMEND — legal review flag]** vs. suppress all. → legal‑review open item.
- **OD‑5 — Bounce source:** derive from existing PostHog `pageleave` **[RECOMMEND — no new event]** vs. a new beacon. → PostHog.
- **OD‑6 — Business proof UI:** #865 ships the data + admin rollup only; the venue‑facing proof screen is the #852 "business‑proof surface" story **[RECOMMEND]**.
- **OD‑7 — Business OneLink:** gate business‑app‑open on the `ZSCW` template going live (native build) **[RECOMMEND — consumer + web now]**.

---

## Scoped allowlist + DO‑NOT‑TOUCH
**Allowlist:** new `supabase/migrations/<ts>_issue_865_attribution.sql`; new `supabase/functions/{attribution-capture,admin-ad-rollups,admin-meta-audience-create}/**` + `_shared/{metaCapi,tiktokEvents}.ts`; edits to `_shared/stripeWebhookRouter.ts`, `paystack-webhook`, `ticket-checkout-create`, `venue-reservation-confirm` **only at the post‑finalize hook point**; `supabase/config.toml`; `mingla-business/src/analytics/webAnalytics.web.ts` + public route hooks + checkout files; `app-mobile/src/services/appsFlyerService.ts` + `mingla-business/src/services/appsFlyerService.ts` (deep‑link capture); `mingla-admin/src/**` (rollup view); CI.
**DO‑NOT‑TOUCH:** `biz_ticket_checkout_finalize` internals (call it; don't rewrite the mint/idempotency logic — hook AFTER it); the #862 `admin-meta-*` fns + `meta_*` tables (read/reuse the token via a shared helper, don't fork); existing milestone AppsFlyer logic (extend, don't replace); payment/refund paths beyond the hook; `app.json`/`eas.json` except adding pixel env. Outside allowlist → `SPEC_AMENDMENT_ISSUE-865_*` first.

## Downstream routing
**Next:** `mingla-implementor` (Phase A first; Phase B unlocks #864). → `mingla-tester` (idempotency + fail‑open + consent + live‑fire dedup). → orchestrator CLOSE.
**Working tree:** `~/Desktop/mingla-orchs/issue-865-attribution-engine/` on branch `issue-865-attribution-engine` (stacked on `issue-864` → `issue-862`).

---

## Amendment A2 — battle-test corrections (2026-07-15, evidence-backed)

**Provenance:** Phase‑V1 battle-test of the full ad pipeline — `issue-862-meta-ads-api/Mingla_Artifacts/research/ad-pipeline-2026-07-15/` (`GAP_REGISTER.md`, `PROOF_LOG.md`, `PIPELINE_BLUEPRINT.md`, `meta.md`, `reddit.md`) — plus one fresh official-docs verification (A2‑7, Reddit). Items A2‑3…A2‑6 and A2‑8/A2‑9 encode **conductor-fixed canonical decisions**, identical across the parallel channel-spec amendments. Append-only: nothing above this line is edited; where a delta below contradicts earlier text, **the delta wins**. Env-var **names** only — real values live in `MINGLA_MASTER_KEYS.md`.

### A2-1 · Meta pixel-state ground truth — PROVEN never-fired; "duplicate dataset" CLOSED (single canonical)
- **Old:** A1: pixel `1949011972638955` "created; NOT yet installed"; §4: Pixel/CAPI "greenfield". Open blocker: `ads_get_datasets` showed two rows with the same `dataset_id` 1 s apart — "resolve the duplicate dataset rows before wiring CAPI".
- **New:** Engine-live-proven ground truth: the pixel has **NEVER fired** — `last_fired_time` **and** `server_last_fired_time` are both **Unix epoch‑0** (browser AND server), `openbridge.gateway_status: NOT_ONBOARDED`, ad-account custom audiences `[]`. The "duplicate dataset" is **CLOSED as an MCP artifact**: engine-credential `GET /act_…/adspixels` returns **exactly ONE** pixel `1949011972638955`. There is a **single canonical dataset** — wire Pixel + CAPI against it directly; the "resolve duplicates first" pre-step is deleted.
- **Evidence:** PROOF_LOG M‑P7 + M‑P11 `[ENGINE-LIVE]`; GAP_REGISTER GR‑19; `meta.md` live probe `ads_get_dataset_details(1949011972638955)`.

### A2-2 · TikTok pixel ground truth — zero events, otherwise correctly configured
- **Old:** A1 records the TikTok pixel as "provisioned + verified … NOT yet installed".
- **New (confirmed + sharpened):** pixel `7662469356818858002` has **zero events** (`events: []`, `NO_RECENT_ACTIVITY`) and **0 custom conversions** — but is otherwise correctly configured (`DEVELOPER` mode, first-party cookies ON, advanced matching email+phone ON). TikTok `WEB_CONVERSIONS` (and therefore Smart+ for web) is **structurally unavailable** until this spec makes the pixel fire; `optimization_event` is **required** whenever `pixel_id` is set on an ad group.
- **Evidence:** PROOF_LOG T‑P4 `[MCP-LIVE]`; GAP_REGISTER GR‑20.

### A2-3 · Canonical pixel install targets + canonical tracking IDs (all channels)
- **Old:** §5.3 wires pixels via "public route hooks (`app/e/…`, `/b/…`, `/t/…`)" + checkout; A1 names Meta/TikTok/Snap assets; Reddit and Google absent.
- **New (canonical decision):** the pixel install-target set is **`/e/`, `/t/`, `/b/`, `/checkout/`** on the canonical web surfaces — all four are MANDATORY (checkout included: it is where `Purchase`/`CompletePayment` fires and what WCA URL rules key on). Canonical tracking IDs:
  - **Meta:** pixel/dataset `1949011972638955` (single canonical dataset — A2‑1).
  - **TikTok:** pixel `7662469356818858002`.
  - **Snapchat:** pixel `af5f8fc4-1ef6-41e7-81c5-042b7be7df38` (ACTIVE; note `automatic_event_opt_in: OPT_OUT`).
  - **Reddit:** pixel id **= the ad-account id `a2_jcfwvnfcfqcs`** — proven: on Reddit the pixel id IS the ad-account id (consistent across `/businesses/…/pixels` and `/ad_accounts/…/pixels`).
  - **Google:** **no conversion tracking exists — it must be created** (conversion actions + site tag/Enhanced Conversions). Until it exists **and** accrues volume, **tCPA/tROAS stay un-offered** (≥15 conversions/30 days before offering them).
- **Evidence:** GAP_REGISTER GR‑19 (install-target list) + GR‑51; PROOF_LOG R‑P3 + "New discoveries" #5 (Reddit pixel id == account id); PROOF_LOG S‑P5 (Snap pixel ACTIVE); PIPELINE_BLUEPRINT §5 (Google gaps).

### A2-4 · Until the pixels fire: LINK_CLICKS / SWIPES only — and every downstream gate keys on LIVE SIGNAL, not "#865 shipped"
- **Old:** the spec treats #865's ship as the unlock for #864's Purchases/Retargeting goals ("Phase B … unlock #864's disabled goals").
- **New (canonical decision):** while `last_fired_time` is epoch‑0/null the ad engine runs **`LINK_CLICKS` (Meta)** and **`SWIPES` (Snap)** — the only honest optimization goals; pixel-fed goals (`LANDING_PAGE_VIEWS`, `OFFSITE_CONVERSIONS`, `VALUE`, Snap `LANDING_PAGE_VIEW`/`PIXEL_*`, TikTok `WEB_CONVERSIONS`) are rejected with `422 pixel_no_signal`. **#865 is the unlock for LPV/conversions/retargeting/lookalikes everywhere — but the gate condition downstream systems MUST test is live signal (`last_fired_time ≠ epoch-0` on the channel's pixel), never the boolean "#865 shipped".** Shipping this spec's code does not flip any gate; the first real fired event does. `promoted_object:{pixel_id}` must be sent once pixel goals are offered.
- **Evidence:** GAP_REGISTER GR‑19 (Meta gate + 422), GR‑21 (Snap default flipped to `SWIPES`), GR‑20 (TikTok dependency); PIPELINE_BLUEPRINT golden rule #5.

### A2-5 · Dedup contracts hardened (Meta exact-match pair · TikTok · Snap)
- **Old:** §5.2/§5.3/SC‑5 say "shared `event_id`" and "deduplicated by Meta via the shared `event_id`".
- **New (canonical decision — hard AC):**
  - **Meta:** browser Pixel `eventID` (4th arg of `fbq('track', …)`) **MUST equal** CAPI `event_id` **AND** Pixel `event` **MUST equal** CAPI `event_name` — **exact string match on BOTH**, else dedup fails and the conversion double-counts. **Dedup window = 48 hours.** Generate **one deterministic `event_id` per real-world conversion** (the Mingla order/reservation id). **`fbc`/`fbp` are passed UNHASHED on both sides**, exact formats `fbc = fb.1.{creationTimeMs}.{fbclid}` and `fbp = fb.1.{creationTimeMs}.{randomNumber}` (subdomainIndex 1 for `usemingla.com`); if no `_fbc` cookie exists, use the timestamp when the `fbclid` was first observed.
  - **TikTok:** same shared-`event_id` discipline on Pixel + Events API.
  - **Snapchat:** server sends authenticate with the CAPI token (env `SNAPCHAT_CAPI_TOKEN`), deduped against the Snap pixel with the shared event id.
  - SC‑5 is upgraded accordingly: the live-fire dedup test must assert the **event_name/eventID exact-match pair**, not just a shared id.
- **Evidence:** `meta.md` §"Pixel + CAPI signal + dedup" (`[OFFICIAL]` verbatim: 48‑hour window; fbc/fbp formats; unhashed both sides); GAP_REGISTER §5 capability-matrix row "Conversion signal / CAPI".

### A2-6 · HARD AC — never request deprecated attribution windows; pin `META_API_VERSION=v25.0`
- **Old:** no constraint on Insights attribution windows; #862's version pin predates v25.
- **New (canonical decision — hard AC, strict-grep guarded):** **NEVER request `7d_view` or `28d_view` as `action_attribution_windows`** in any Insights call (rollups §5.5 spend sync included) — Meta deprecated them as queryable from **2026‑01‑12**; requesting them is a live 4xx/garbage-data bug, not a style issue. 28‑day click has been reporting-only since 2021‑04. All Meta calls in #865 pin **`META_API_VERSION=v25.0`** (v21.0 is stale; v25.0 shipped 2026‑02‑18). **RT‑4 (new):** CI strict-grep asserts no `7d_view`/`28d_view` literal appears in any Insights request payload; reverting the version pin or adding the windows fails RT‑4.
- **Evidence:** GAP_REGISTER GR‑43; PIPELINE_BLUEPRINT §5 row 18.

### A2-7 · Reddit CAPI — VERDICT: token-first CONFIRMED (Events-Manager Conversions access token suffices; NO OAuth re-consent needed); GR‑30 corrected
- **Old (GR‑30):** "We hold `adsread`+`adsedit`; CAPI needs `adsconversions`. That's a re-consent, not a config change. … Reddit CAPI is unreachable."
- **New (verified against Reddit's OFFICIAL docs, 2026‑07‑15):** **CONFIRMED — the handoff brief is right; GR‑30 is overstated as the only path.** Reddit's official CAPI **direct-integration guide** authenticates with an **Events-Manager-generated "conversion access token"** — its setup flow is exactly: (1) retrieve Pixel ID in Events Manager, (2) **"Generate a conversion access token"** (Generate Access Token → shown once, cannot be retrieved later), (3) POST to `https://ads-api.reddit.com/api/v3/pixels/{pixel_id}/conversion_events`. **No OAuth authorize step and no `adsconversions` consent appears anywhere in the guide**; prerequisites are only an Ads account + admin/creator membership + Pixel ID. Reddit's help center adds: the conversion access token is a **non-expiring** key (max 5 per business, deletable to revoke) and **"Reddit recommends using a conversion access token over a developer access token for Conversions API."**
  - **Both paths, ranked:** **token-first** (env `REDDIT_ADS_CAPI_TOKEN` — **still TODO: generate in Events Manager**) is primary; the **`adsconversions` OAuth re-consent remains the documented FALLBACK** — the live OpenAPI (`https://ads-api.reddit.com/api/v3/openapi.json`, fetched 2026‑07‑15) still declares `security: [{"RedditAPIKey": ["adsconversions"]}]` on `POST /pixels/{pixel_id}/conversion_events` for developer-OAuth callers. If the token path fails live-fire, re-run the authorize URL with `adsread,adsedit,adsconversions,adsmeasurement:read,adsmeasurement:write` + `duration=permanent` per GR‑30.
  - **Official CAPI operating limits captured for the sender:** rate limit **1,000 requests/s, 10,000 events/s, 1,000 events/request**; events **must be sent within 7 days** of occurring; **dedup is REQUIRED when Pixel + CAPI are both used** (conversion-id dedup recommended; session-based is the default; dedup applies **only within the same channel**); **CAPI v3 field values differ from v2** (e.g. `tracking_type`) — build against v3, not v2 snippets; success envelope `{"data":{"message":"Successfully processed N conversion events."}}`. CAPI emits **no** standard rate-limit headers (GR‑71).
  - **AC (new, SC‑12):** with `REDDIT_ADS_CAPI_TOKEN` set, an attributed conversion is POSTed to `pixels/a2_jcfwvnfcfqcs/conversion_events` (Reddit pixel id = ad-account id, A2‑3) with the shared dedup id; `reddit_capi_status` recorded like the other channels; **conditional on token generation** — until the token exists this AC is PENDING‑CONFIG, not failed. Fallback path (scope re-consent) only if token-path live-fire fails.
- **Evidence:** **[OFFICIAL]** `https://ads-api.reddit.com/docs/v3/guides/programs/capi/direct-integration` (fetched live 2026‑07‑15; steps + limits + 7‑day window + dedup requirement verbatim); **[OFFICIAL]** `https://business.reddithelp.com/s/article/conversion-access-token` (non-expiring, max 5, "recommends … over a developer access token"; page is a JS-gated SPA — content confirmed via search index of the official article, direct fetch renders the shell only, consistent with PIPELINE_BLUEPRINT §5 row 12); **[OFFICIAL]** `https://ads-api.reddit.com/api/v3/openapi.json` (endpoint security = `adsconversions` for the OAuth path); GAP_REGISTER GR‑30 + GR‑71; `reddit.md` §1.4/§1.6; PROOF_LOG R‑P3.

### A2-8 · Google measurement lane (canonical decision) — Enhanced Conversions + GCLID import, budgeted honestly
- **Old:** §2 non-goals: "Google/Snapchat → #867" (A1 already pulled Snapchat in; Google remained unaddressed).
- **New (canonical decision):** Google conversion tracking is **created as part of the measurement fan-out** (nothing exists today — A2‑3): **Enhanced Conversions** (SHA‑256 **normalized** email) + **GCLID offline conversion import**, with the **90‑day GCLID retention budgeted** — uploads referencing older GCLIDs **silently fail**, so the import job must run well inside the window and alert on silent-zero batches. **Consent Mode v2 is MANDATORY for EEA traffic — directly relevant to London**, one of our live markets: the web consent gate (§5.3) must emit Consent Mode v2 signals for Google tags. tCPA/tROAS remain un-offered until ≥15 conversions/30 days (A2‑3).
- **Evidence:** PIPELINE_BLUEPRINT §5 row 18; GAP_REGISTER §5 capability-matrix row "Conversion signal / CAPI" (Google column); GAP_REGISTER GR‑51 (Consent Mode v2 / London).

### A2-9 · Phase B audiences re-specced (GR‑51) — sequenced AFTER pixel signal; retargeting growth stages + honest operator messages
- **Old:** §5.2 Phase B `admin-meta-audience-create` builds WEBSITE/ENGAGEMENT/MOBILE_APP audiences; SC‑10 requires a real audience id. No sequencing, sizes, or ratios.
- **New (canonical decision):** the audience phase is **sequenced strictly AFTER pixel signal exists** (per A2‑4's live-signal gate — zero audiences exist on ANY channel today):
  - **Meta WCA:** URL rules on `/e/` + `/checkout/` at **30d/180d retention, MINUS converters** — exclusions are what make the funnel work (exclude purchasers from prospecting; exclude retargeting from prospecting). The Mingla-shaped BOF audience: *"viewed an event page in the last 14 days, did not reserve."*
  - **ENGAGEMENT audiences (IG/Page, 730‑day retention) are the ONLY no-pixel retargeting play** — available before any pixel fires. **Constraint: no IG account is linked to Page `797406353459597`** (engine-live: `instagram_business_account` absent) — **Facebook-only until a human links IG** (Human-unblock #3).
  - **Lookalikes:** seed **≥100** (quality bar 300–500+); **Meta ratio range is 1–20%** — Snap's is **1–10%; do not cross the wires**. **Customer Match needs 100 users (1,000 for Search + YouTube).**
  - **Retargeting growth stages + operator messages (verbatim from blueprint §1.9f — use these, they are the honest ones):**
    | Stage | Trigger | Operator message |
    |---|---|---|
    | Seeding | pixel firing, audience < 100 | *"Building your retargeting audience — {n} people so far. At 100 we can start showing ads to people who looked and didn't book. Meta needs 100 to build a lookalike too."* |
    | Live | audience ≥ 100 | *"Retargeting is live — {n} people who viewed this page in the last 14 days and didn't book."* |
    | Lookalike | seed ≥ 100 (quality bar 300–500+) | *"We can now build a lookalike from your {n} bookers. Starting at 1% — the closest match. (Meta's range is 1–20%.)"* |
  - Do **not** put TOF/MOF/BOF in any UI — not Meta terminology (blueprint §1.9f).
  - SC‑10 is amended: audience create must respect the sequencing gate (refuse WCA create while the pixel is signal-dead, with the Seeding message) and the size floors above.
- **Evidence:** GAP_REGISTER GR‑51; PROOF_LOG M‑P10 `[ENGINE-LIVE]` (IG not linked) + M‑P7 (no signal); PIPELINE_BLUEPRINT §1.9f (stages + messages, verbatim) + §5 row 4.

### A2 — new/changed acceptance criteria (delta summary)
- **SC‑5 (upgraded):** Meta dedup asserts the **`eventID`==`event_id` AND `event`==`event_name` exact-match pair**, 48h window, `fbc`/`fbp` unhashed both sides (A2‑5).
- **SC‑11 (new, HARD):** no Insights request anywhere in #865 contains `7d_view`/`28d_view`; `META_API_VERSION=v25.0` — CI RT‑4 strict-grep (A2‑6).
- **SC‑12 (new, conditional):** Reddit conversion send via `REDDIT_ADS_CAPI_TOKEN` (token-first; PENDING‑CONFIG until the Events-Manager token is generated; OAuth `adsconversions` re-consent = fallback only) (A2‑7).
- **SC‑13 (new):** every downstream goal/audience gate reads **live pixel signal** (`last_fired_time ≠ epoch‑0`), never a "#865 shipped" flag (A2‑4).
- **SC‑14 (new, Phase B):** audience creation enforces the sequencing gate + size floors + per-channel lookalike ratios of A2‑9.
- **§7 action items (amended):** add **"Generate the Reddit Conversions access token in Events Manager → `REDDIT_ADS_CAPI_TOKEN`"** and **"Link IG to Page `797406353459597`"**; delete the "resolve duplicate dataset" item (closed, A2‑1).
