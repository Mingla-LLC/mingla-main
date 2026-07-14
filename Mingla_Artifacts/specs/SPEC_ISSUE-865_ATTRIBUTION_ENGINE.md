# SPEC — Attribution & reservation-conversion tracking

**Issue:** GitHub #865 (child of initiative #852 "[Full Rooms] Internal Ad & Reservation Engine")
**Mode:** INVESTIGATE-THEN-SPEC (recon done; grounded in live AppsFlyer/Meta probes + codebase recon, 2026‑07‑14)
**Worktree:** `~/Desktop/mingla-orchs/issue-865-attribution-engine/` on branch `issue-865-attribution-engine` (stacked on `issue-864` → `issue-862`)
**Depends on:** **#862** (campaign IDs + `dest_smart_link`) · **complements #864** (unlocks its disabled Purchases/Retargeting goals)
**Downstream routing:** this SPEC → `mingla-implementor` → `mingla-tester` → orchestrator CLOSE
**Author:** mingla-forensics · **Date:** 2026-07-14

> **User story (verbatim):** "As Mingla, I can attribute reservations/visits back to the ad and public page that drove them, so we can prove ROI to venues." AC: click/deep-link tracking to public page; conversion event on reservation; per-campaign + per-page rollups; feeds the business proof surface.

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
