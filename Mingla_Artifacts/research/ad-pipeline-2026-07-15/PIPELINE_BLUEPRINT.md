# PIPELINE_BLUEPRINT — Mingla Ad Engine, end to end, no step unturned

**Date:** 2026-07-14 · **Mode:** design/doc only — no product code, no API writes.
**Grounded in:** `meta.md` (1,441 ln) · `tiktok.md` (950) · `snapchat.md` (654) · `google.md` (805) · `reddit.md` (1,089) — the exhaustive per-platform research passes — plus our four live specs: **#862 Amendment A3** (unified model + `ChannelAdapter`), **#864** (builder UI), **#866** (creative library), **#884** (cross-channel budget optimizer / the Brain).

> **What this document is.** The build contract for the operator's path from *"I want to fill this room"* to *a live, optimizing, multi-channel campaign*. Every screen, every field, every validation rule with its number, every user-facing message verbatim, every button and what it does, and the per-platform branch at each step. Where the research corrected a spec, the correction is inline and marked **[CORRECTION]**. Where a number is unverifiable, it is marked **[UNVERIFIED — warn, do not hard-gate]** and we do not invent one.

> **Reading order for a builder.** §4 ("what we must build that we haven't specced") is the work list. §1 is why. §2 and §3 are the constants you encode. §5 is what to tell Seth we cannot do.

---

## 0. Provenance, confidence, and the four rules that govern every number here

**Confidence tags** carried from the research and preserved in this doc:
- **[SPEC]** — from a platform's own OpenAPI/protobuf/create-tool JSONSchema. Safe to hardcode.
- **[OFFICIAL]** — verbatim from a platform-owned URL.
- **[LIVE]** — observed from a read-only probe of *our* account.
- **[CONSENSUS]** — practitioner/third-party. Warn-level only.
- **[UNVERIFIED]** — could not be confirmed. **Never hard-gate on these.**

**The four rules.**
1. **Validate client-side, re-validate server-side, never trust the platform's silent correction.** Meta auto-corrects an invalid `optimization_goal` to its recommended default at the server **[SCHEMA]** — a silent-wrong-config hazard. We validate before the call.
2. **Never hardcode a number the platform will tell us.** Meta's `GET /act_{id}/minimum_budgets` and TikTok's `tool_region_get` are live sources. A build-time map of either is a silent-failure generator (see §1.4, §1.3).
3. **Validating on a wrong constant is worse than not validating.** Reddit's creative specs are [3P] and self-contradictory (carousel 3 MB vs 20 MB; caption 50 vs the API's real 180). Warn, don't block, until verified.
4. **An MCP absence is not an API absence.** Meta's MCP `ads_get_field_context` cannot resolve `issues_info`, `ad_review_feedback`, `targeting`, `billing_event`, or 10+ other fields — all of which are first-class on the Graph API our token calls. *The MCP is an exploration toy; the Graph API is the product.* Three of our specs drew a wrong conclusion from this (GAP-1, GAP-4, GAP-10 in `meta.md`).

---

## 1. The operator's journey, end to end

**The spine.** `lane → preflight → goal(s) → destination → audience → budget & schedule → creative → copy → preview & policy pre-check → review & launch → in-flight`.

This supersedes #864 A3's order (`audience/lane → channel → goal → destination → media → budget → copy → review`) in exactly one way: **the channel picker is no longer a step the operator drives — it is an output of preflight ∩ goal ∩ market ∩ budget.** The operator says what they want; the engine says which channels can do it and why the others can't. #884's Brain then decides how much each gets. Manual channel override survives as an "Advanced" affordance (#884's `channel_allowlist`).

**[CORRECTION to #864 A3(2).]** #864 says Step 1 shows "only the channels whose `ad_connections` row is GREEN". That is necessary and *not sufficient*. Four of our five channels are marked GREEN in A3's registry and **three of those four cannot actually deliver an ad today** (Meta: no Page assigned; Google: TEST-tier dev token 403s every production call; Reddit: no profile captured → no post → no ad). GREEN currently means "a token minted", not "an ad can run". Preflight is the fix.

---

### 1.0 · Step 0 — Preflight

**Screen:** `#/campaign-builder` → **Channel health** panel, rendered above the wizard and re-run on entry. Also the standalone `#/ad-engine/health` route.
**Purpose:** answer one question per channel — *if I launch right now, will an ad actually run?* — and never let a red channel reach the create call. This is the screen where the five hard blockers surface.
**Data source:** a new `admin-ad-preflight` edge function (§4.1), one row per `(platform, lane)`.

**Per-channel checks and what each proves:**

| # | Check | Meta | TikTok | Snapchat | Google | Reddit |
|---|---|---|---|---|---|---|
| P1 | **Token valid** | `GET /me/adaccounts` returns the account | `advertiser_info_get` → `STATUS_ENABLE` | refresh→access mint (`expires_in` 3600) | OAuth refresh mint **+ a real Ads call** | refresh mint (`expires_in` **3600 *or* 86400**) |
| P2 | **Billing / funding present** | `account_status`=1 `ACTIVE` **and** `has_payment_method` | balance ≥ 1 day of ad-group floor | funding source `ACTIVE` | account enabled (`CUSTOMER_NOT_ENABLED=24`) | funding instrument **`is_servable: true`** |
| P3 | **Identity present** | Page **promoted under the ad account** | identity `AVAILABLE` (`TT_USER`) | **Public Profile `profile_id`** (different host) | n/a | **profile `t2_`** (authors the post) |
| P4 | **Pixel firing** | `last_fired_time` ≠ epoch-0 | `pixel_list_get.events` non-empty | pixel `ACTIVE` | conversion tracking exists | `GET /pixels/{id}/last_fired_at` |
| P5 | **Review / access tier** | n/a | **app review state** | n/a | **dev-token tier** (TEST / Explorer / Basic) | scopes held |
| P6 | **Market reachable** | countries+cities via `/search?type=adgeolocation` | **`tool_region_get` live** | `geos` country codes | `geoTargetConstants` | `targeting/geolocations` |

**The five hard blockers — one per channel — with the exact message.**

Each renders as a red `AlertCard` on the channel's row, with the channel unselectable and a **"Recheck"** button (re-runs `admin-ad-preflight` for that channel only; toast on success: *"Meta is ready."*; on continued failure the same card re-renders with a refreshed timestamp).

**B1 · Meta — Page not promoted under the ad account.** `[LIVE: ads_get_ad_account_pages(2393570861066813) → {"pages":[]}]`
`page_id` is **always required** inside `object_story_spec`; omission returns *"Facebook Page is Missing"* **[SCHEMA, verbatim]**. #862 §4.0 cites `ads_get_pages_for_business(830733900115504)` returning Page `797406353459597` — that proves the Page exists **under the business**, a different assertion from being **promoted under the ad account**. #866 §4.0 saw the same `{"pages":[]}` and read it as benign ("every platform asset library is empty") — correct for images, **wrong for Pages**.

> **No Facebook Page is linked to this ad account — every ad needs one. Link a Page in Meta Business Settings (Ad account → Pages → Add), then refresh.**

Error code: `424 meta_page_not_assigned`. **`admin-ad-connect` must fail the connect on this**, not report `connected=true` and hand the failure to create-time.

**B2 · TikTok — the token is still in app review.** `[A3 registry: "app in review"]`
`TIKTOK_ACCESS_TOKEN` does not exist. `TIKTOK_EVENTS_ACCESS_TOKEN` is a *different* credential (#865's Events API) and cannot create ads. Every path correctly fail-closes `424 tiktok_not_connected`.

> **TikTok is waiting on app review. Our developer app hasn't been approved yet, so we can't create ads on TikTok. Nothing to fix on our side — this clears when TikTok approves. Everything else about TikTok is built and ready.**

**B3 · Snapchat — no Public Profile linked.** `[#867 §7 Snap-3 / OD-5: UNCONFIRMED]`
Every creative requires `profile_properties.profile_id`; Public Profiles are **mandatory for all Snap advertisers since June 2022**. The lookup lives on `https://businessapi.snapchat.com/v1` — **a different host** from `snapGraph()`'s hardcoded `https://adsapi.snapchat.com/v1`. Public Profile APIs are **read-only**: if none exists, it must be created by hand in Business Manager. No code path can provision it.

> **Snapchat needs a Public Profile before any ad can run — it's the account the ad is published from. Create one in Snapchat Business Manager (Public Profiles → Create), then refresh. We can't create it for you; Snapchat's API is read-only here.**

Error code: `424 snapchat_profile_missing`.

**B4 · Google — the developer token is TEST tier.** `[#867 §4.0b + google.md §7]`
`AuthorizationError.DEVELOPER_TOKEN_NOT_APPROVED = 10` → HTTP 403 on **every** call to production customer `5083048929`. **`validate_only=true` does not bypass it** — authorization is evaluated before validation. We cannot even dry-run our mutate shapes against the real account.

> **Google Ads hasn't approved our API access for live accounts yet. Our developer token only works on test accounts today. Check the API Center for Explorer access (it's granted automatically and is enough for us) — otherwise the Basic-access application takes about 5 business days.**

Error code: `409 google_not_provisioned`.
**[CORRECTION to #862 A3 §D.]** The registry marks `google/consumer` **GREEN** ("server verified"). An OAuth token that mints is not an Ads-API call that succeeds. **GREEN → AMBER until a real production Ads call returns 200.** Additionally `scratchpad/google_token_resp.json` contains `{"error":"invalid_grant"}` — the only token evidence in the tree, and it contradicts "server verified". Re-verify before build.
**The unlock nobody costed:** **Explorer Access** reaches production at **2,880 ops/day**, is granted **automatically (no application)**, and blocks only account-creation / user-management / planning / billing services — **none of which we use**. Our own Basic application models "tens to low-hundreds of operations per day". **Read the live tier in the API Center first — we may already be unblocked.**

**B5 · Reddit — no profile and no funding instrument captured.** `[reddit.md §9.3]`
A Reddit ad **is a promoted post**: `ad.post_id` (`t3_…`) points at a real post authored by a `t2_` **profile**. No profile → no post → no ad. Separately, a campaign with a non-servable funding instrument lands in `PENDING_BILLING_INFO` and silently never delivers.

> **Reddit needs two things we haven't captured: the Reddit profile that will publish the ad, and a payment method that's ready to bill. Pick the profile in Business Manager and confirm billing, then refresh.**

Error codes: `424 reddit_profile_missing` · `424 reddit_funding_not_servable` (surface `reasons_not_servable` verbatim).

**The amber blockers — they don't block create, they block *value*.**

**A1 · Meta — account UNSETTLED, no payment method.** `account_status: 3 (UNSETTLED)`, `has_payment_method: false`, `is_queryable: false` **[#862 §4.0 live probe]**. Create succeeds; every launch parks at `effective_status = PENDING_BILLING_INFO` and spends nothing. Already correctly tracked in #862 §7 + SC-4.

> **Meta will let us build this campaign but won't run it — the ad account has no payment method and is marked unsettled. Add billing in Meta Ads Manager before you launch, or it'll sit at "Pending billing info" and never spend.**

**A2 · Meta — the pixel has never fired.** `[LIVE: last_fired_time = 1969-12-31T16:00:00-0800 AND server_last_fired_time = same]` — **both Unix epoch 0 = never, browser and server.** `openbridge.gateway_status: NOT_ONBOARDED`. `ads_get_ad_account_custom_audiences` → `{"audiences":[]}`.
This has three consequences that cascade through every later step:
- **`LANDING_PAGE_VIEWS` is measured by the pixel.** #862 OD-4 recommends it as the default. With a dead pixel Meta cannot verify a landing-page view — we'd be paying for an optimization goal we cannot feed. **`LINK_CLICKS` is the only honest goal until the pixel fires.**
- **No website custom audience → no retargeting funnel at all.**
- **No seed audience ≥100 → no lookalikes** (min seed **100** **[OFFICIAL]**; practical quality bar 300–500+ **[CONSENSUS]**).

> **Our Meta pixel has never received a single event — not from the browser, not from the server. Optimizing for landing-page views needs it. We've switched this campaign to optimize for link clicks instead, which works today. (Retargeting and lookalike audiences also need this pixel; both are unavailable until it fires.)**

Gate: `admin-ad-create-campaign` returns **`422 pixel_no_signal`** for `LANDING_PAGE_VIEWS` / `OFFSITE_CONVERSIONS` / `VALUE` when `GET /{dataset_id}?fields=last_fired_time` is epoch-0/null, and steers to `LINK_CLICKS`.
Also: **resolve the duplicate dataset rows** — `ads_get_datasets` returns two entries with the *same* `dataset_id 1949011972638955`, `creation_time` 1 second apart. Confirm one canonical dataset before wiring CAPI.

**A3 · TikTok — balance $0.00 against a $20/day floor.** `[LIVE: advertiser_info_get → balance 0.0]`; #863 notes **$10 prepaid** in the Advanced Payment Portfolio **that the API cannot see**. $10 < one day's ad-group minimum ($20). Any launched campaign parks at `BALANCE_EXCEED`.

> **TikTok's balance reads $0. TikTok ad groups have a $20/day minimum, so even the $10 you've pre-paid isn't enough for one day. Top up in TikTok Ads Manager — the API can't see the Advanced Payment Portfolio, so this number may lag.**

**A4 · Snapchat — funding source is live with a $15,000/day limit.** `[#867 §4.0: daily_spend_limit_micro: 15000000000]`. Not a blocker — a **blast radius**. It is the reason the cents-vs-micro bug (§1.4) is a money bug and not a rounding bug.

**Buttons on this screen.**
- **`Recheck`** (per channel) → re-runs preflight for that channel. Toast: *"Meta is ready."* / *"Still blocked — see the card."*
- **`Recheck all`** → re-runs all five. Toast: *"2 of 5 channels ready."*
- **`Continue`** → enabled when **≥1 channel is green**. Disabled with: *"No channel can run an ad right now. Fix at least one blocker above to continue."*
- **`Continue anyway (build paused)`** → **[design decision]** allowed, because everything is created PAUSED and a blocked channel is still worth *building* while a human clears billing. It creates the campaign and shows the amber warning on the campaign row. It is **never** allowed past a **hard** blocker (B1–B5) — those make the create call itself fail, so offering it would be a lie.

---

### 1.1 · Step 1 — Goal(s)

**Screen:** "What do you want this campaign to do?" — multi-select goal cards.
**Purpose:** collect intent in plain language; never show platform jargon. #864 A1's goal-first design is correct and stands; this step extends it from Meta-only to a per-goal × per-platform mapping table, and makes it **multi-select** (a room needs traffic *and* the app installed; the Brain will split the money).

**Fields.**

| Label | Type | Default | Required |
|---|---|---|---|
| Goal cards (multi-select) | card radio-group, multi | **Send people to a page** pre-selected | **Yes** — ≥1 |
| Advanced → exact objective | select, per chosen channel | derived | No |
| Advanced → exact optimization goal | select | derived | No |

**Validation.** ≥1 goal. If the operator picks two goals whose eligible-channel sets are disjoint, warn:
> **These two goals don't share a single channel. We'll run them as separate campaigns under one budget plan — that's fine, but each goal gets its own money.**

#### The goal → per-platform native objective mapping table

This is the table the engine encodes. It **[CORRECTS]** #884 §4.3's registry in five places, marked ⚠.

| Mingla goal | Meta | TikTok | Snapchat | Google | Reddit |
|---|---|---|---|---|---|
| **Send people to a page** (`event_page_traffic`) · result = `landing_views`, fallback `clicks` | `OUTCOME_TRAFFIC` + `LINK_CLICKS` ⚠ *(not `LANDING_PAGE_VIEWS` — pixel dead, A2)* | `TRAFFIC` + `TRAFFIC_LANDING_PAGE_VIEW` | `objective_v2_type: TRAFFIC` ⚠ *(key is `objective_v2_type`, not `objective_v2`)* + **`SWIPES`** ⚠ *(not `LANDING_PAGE_VIEW` — needs a firing pixel)* | `advertising_channel_type: SEARCH` + `maximize_clicks` (`target_spend`) | `objective: CLICKS` + `optimization_goal: CLICKS` |
| **Get the app installed** (`app_downloads`) · result = `installs` | `OUTCOME_APP_PROMOTION` + `APP_INSTALLS` | `APP_PROMOTION` + `INSTALL` ⚠ *(`IN_APP_EVENT` blocked — `app_optimization_event_get` → `[]`)* | `APP_PROMOTION` + `APP_INSTALLS` | `MULTI_CHANNEL` + `advertising_channel_sub_type: APP_CAMPAIGN` ⚠ *(there is **no** `APP` channel type)* | `APP_INSTALLS` |
| **Build awareness** (`awareness`) · result = `impressions` | `OUTCOME_AWARENESS` + `REACH` | `REACH` + `REACH` | `AWARENESS_AND_ENGAGEMENT` + `IMPRESSIONS` | `DISPLAY` + `target_impression_share` | `IMPRESSIONS` ⚠ *(→ renamed `BRAND_AWARENESS` on **2026-09-30**)* |
| **Get reservations / purchases** (`event_conversions`) · result = `conversions` | `OUTCOME_SALES` + `OFFSITE_CONVERSIONS` | `WEB_CONVERSIONS` + `CONVERT` | `SALES` + `PIXEL_PURCHASE` | `SEARCH` + `maximize_conversions` | `CONVERSIONS` ⚠ *(→ renamed `SALES` on 2026-09-30)* |
| **Bring back past visitors** (retargeting) | custom audience | `audience_ids` | `custom_audiences` | `user_list` | `custom_audience_ids` |

#### Which goals are impossible per channel today, and why — the grey-out reasons

Each renders as a disabled card with the reason inline. **[#864 A1's "no half-built placeholders" rule holds]**: a goal a channel cannot fulfil is not shown *for that channel*; a goal **no** channel can fulfil is not shown at all.

| Goal × channel | State | The exact reason shown |
|---|---|---|
| **Reservations / purchases** — *all channels* | **Hidden entirely** | Needs #865's pixel + CAPI. Meta's pixel has never fired; TikTok's `pixel_list_get` → `events: []`; Reddit CAPI needs the `adsconversions` scope we don't hold. **Ships with #865, fully working — not a dead button now.** |
| **Bring back past visitors** — *all channels* | **Hidden entirely** | 0 custom audiences on Meta, 0 on TikTok, none on Snap. Meta lookalikes need a **≥100-person seed** [OFFICIAL] — we have **0**. Ships with #865 Phase B. |
| Reservations — TikTok | *(also)* Greyed | *"TikTok's pixel has never received an event, so there's nothing to optimize toward. Traffic works today."* |
| **Get the app installed** — Reddit | Greyed, `degraded` | *"Reddit can only send people to the app store as a link — it can't optimize for installs the way the other channels do. We'd rather spend that money on Meta or TikTok."* |
| **Get the app installed** — Meta/TikTok/Snap/Google | **Live but result-blind** | `app_downloads` result metric needs an install count in #865's CPR feed (**#884 OD-4**, unresolved). Until it exists the Brain cannot optimize it. **Show the goal; label it: *"We can run this today, but we can't yet measure cost-per-install automatically — you'll be reading the numbers, not the Brain."*** |
| **Build awareness** — the Brain | Live, weak | `impressions` is the weakest CPR signal. The Brain will allocate but its reallocation is near-meaningless. Label: *"Awareness has no strong success signal — the Brain won't move money on it much."* |

**⚠ The finding that changes the goal step: TikTok's strongest asset is the goal nobody selected.** `app_list_get` returns **2 apps** (iOS `7659045322872684562`, Android `7659053200868786183`), both AppsFlyer-linked (`partner_id: 1`), `self_attribution_enabled: true`, `skan_allowed: ALLOWED`, `enable_retargeting: RETARGETING`. **`APP_PROMOTION` needs no pixel and is viable today** — and #863 hardcodes `objective_type='TRAFFIC'` and never mentions it. **Make `objective_type` a parameter, not a constant.** (Same for Meta: `OUTCOME_APP_PROMOTION` needs no website pixel.)

**Per-platform traps this step must encode.**
- **Meta [LIVE TRAP]:** `ads_get_field_context(["objective"])` returns a **22-value enum listing every legacy value** (`LINK_CLICKS`, `CONVERSIONS`, `REACH`, `VIDEO_VIEWS`…). Those are **read/reporting-historical only** — passing one to create **fails with VALIDATION**. Whitelist the **ODAX 6** and never source the create contract from `ads_get_field_context`. #862 §4.0 already caught this and is correct.
- **Meta:** objective → `optimization_goal` is a **matrix, not a flat list** (§3). The create-tool schema accepts **26** goals; field-context lists **19**. Neither alone is correct.
- **Meta:** **Advantage+ Shopping/App campaigns can no longer be created OR updated via the Marketing API at all** (v25.0, 2026-02-18; phasing out across all versions ~90 days later). We build **manual campaigns with Advantage+ sub-features on** (CBO + Advantage+ audience + Advantage+ placements) — which is both the correct architecture *and* the only API-legal one. **Do not build an Advantage+ campaign builder.**
- **TikTok:** `objective_type` is a **bare string with no enum** in the MCP schema. Our adapter owns the 8-value enum client-side or we ship runtime 400s.
- **TikTok:** **Smart+ has only 3 objectives** (`APP_PROMOTION`, `WEB_CONVERSIONS`, `LEAD_GENERATION`) — **no `TRAFFIC`**. Our MVP goal is structurally inexpressible in Smart+. Correctly deferred (#863 OD-3).
- **Snapchat:** legacy `objective` is **deprecated** (translator-defaulted since 2025-03-21). Never send it.
- **Google:** the `advertising_channel_type` **is** the objective. `DISCOVERY=12` is gone → **`DEMAND_GEN=14`**. Smart Campaigns are **deprecated for new creation 2026-08-03** — three weeks out; don't build toward `SMART`.
- **Reddit:** the objective enum is `APP_INSTALLS, CATALOG_SALES, CLICKS, CONVERSIONS, IMPRESSIONS, LEAD_GENERATION, VIDEO_VIEWABLE_IMPRESSIONS` — there is **no `TRAFFIC`, no `REACH`, no `BRAND_AWARENESS`**. `CLICKS` is our goal and it **survives the 2026-09-30 migration unchanged** — the lowest-risk objective on the platform. **Never build on `LEAD_GENERATION`** (form API sunsets 2026-09-30).
- **Reddit:** `APP_INSTALLS`, `CONVERSIONS`, `CATALOG_SALES` are **not CBO-eligible**.

**Buttons.** `Back` → Preflight. `Next` → Destination; disabled with *"Pick at least one goal."*

---

### 1.2 · Step 2 — Destination

**Screen:** "Where are we sending people?" — searchable card grid of live public pages (#864 §4.3, `business_public_events_view`), plus an app-install branch.
**Purpose:** pick the page, resolve the URL(s), and **prove the destination is live before we spend a cent on it** — then keep proving it (Google polices the destination for the ad's whole life).

**Fields.**

| Label | Type | Default | Required |
|---|---|---|---|
| Destination type | segmented: **Event page** / Venue page / Trip / **App install** | Event page | Yes |
| Search | text | empty | No |
| Page | card grid (cover, title, brand, city, start time, status) | none | **Yes** (unless App install) |
| Advanced → canonical URL | read-only text | derived | — |
| Advanced → smart link | read-only text | derived | — |

**Validation, with numbers.**

| Rule | Threshold | Level | Message |
|---|---|---|---|
| Page is public + live/scheduled | `visibility='public'` AND `status ∈ {live, scheduled}` | **Reject** `422 destination_not_public` | *"This page isn't public anymore, so we can't advertise it. Pick another page, or publish this one and try again."* |
| Event is in the future | `master_start_at > now()` | **Reject** | *"This event already happened. Ads pointing at a past event get rejected as an unavailable offer — pick an upcoming one."* |
| Live URL check | HTTP 200 within 5 s, following redirects | **Reject** | *"We couldn't load that page (got {status}). Every platform reviews the destination and rejects broken links. Check the page loads, then try again."* |
| Crawler check (Meta) | fetch as `facebookexternalhit/1.1` → must return the real page HTML | **Warn** | *"Facebook's crawler sees an app-store interstitial at this link, not the event page. That reads as a landing-page mismatch and risks the whole ad account. Route it through the web fallback first."* |
| Smart-link length | ≤ **2,048** chars (Snap `web_view_properties.url` hard cap) | **Reject** | *"This link is {n} characters — Snapchat's limit is 2,048. Trim the tracking parameters."* |
| Final URL length (Google) | ≤ **2,084 bytes** | **Reject** | *"This link is {n} bytes — Google's limit is 2,084."* |
| Click URL length (Reddit) | ≤ **5,000** chars | **Reject** | *"This link is {n} characters — Reddit's limit is 5,000."* |
| Scheme | `https://` | **Reject** (auto-prepend, then re-validate) | *"The link must start with https://."* |

#### The Google destination-mismatch risk on `go.usemingla.com` — and the fix

**The problem.** #862 A1 makes every channel's creative URL an AppsFlyer OneLink on **`go.usemingla.com`** that redirects to either the app or `usemingla.com`. Three channels have a policy line pointed straight at this:

| Channel | The policy | Severity |
|---|---|---|
| **Google** | *Destination mismatch* — the **display-URL domain must match the final-URL domain**; the policy explicitly targets redirects landing on a different domain. **Google is materially stricter than the others.** | **Risks disapproval of every Google ad we create** |
| **Meta** | *Circumventing Systems* — *"redirect tricks to hide the true destination"*. Enforced at **account-trust level, with less transparency and longer timelines than a normal rejection**. Plus *Relevance*: the landing page must match the ad and be functional; **the destination is explicitly inspected in review.** | **Account-level, not ad-level** |
| **Reddit** | **`BRIDGE_PAGE`** is a literal `rejection_reason` value, and a redirect is exactly what it describes. `display_url` **must match the destination domain** [SPEC]. | Ad-level rejection |

**[DESIGN DECISION] The destination is a per-channel decision, not one smart link.** #862 A1's "one OneLink everywhere" is wrong for Google and risky for Meta and Reddit. The engine resolves **two** URLs and each adapter picks:

```
dest_url         = https://usemingla.com/e/{brandSlug}/{eventSlug}    ← canonical, same registrable domain
dest_smart_link  = https://go.usemingla.com/…?deep_link_value=event&… ← OneLink, app-or-web + attribution
```

| Channel | `final/link` URL | Tracking |
|---|---|---|
| **Google** | **`final_urls = [dest_url]`** | **OneLink in `tracking_url_template`** — this is *Google's own sanctioned pattern*: the tracking template redirects, the final URL is the real page. It satisfies the policy and keeps attribution. |
| **Meta** | `link_url = dest_smart_link` — **conditional on the crawler check passing** | `url_tags` + `conversion_domain = usemingla.com` (AEM requirement) |
| **TikTok** | `landing_page_url = dest_smart_link` | `utm_params` (≤14; keys case-sensitive; macros `__CAMPAIGN_ID__`, `__AID__`, `__CID__`, `__PLACEMENT__`) |
| **Snapchat** | `web_view_properties.url = dest_smart_link` (≤2,048, SSL) | URL macros `~.~SERVER_CAMPAIGN_ID~.~` etc. |
| **Reddit** | `click_url = dest_smart_link`, **`display_url = usemingla.com`** | `click_url_query_parameters` (≤14, macros `{{AD_ID}}`) |

**Two hard preconditions before any spend** (both flagged **[UNVERIFIED]** in the research — this is a judgement call for a human, not a documented rule):
1. **`go.usemingla.com` must be a server 307 to the real page — not a client-JS redirect.** A client-JS redirect is exactly what looks like cloaking to a crawler. This matches the already-established house pattern from ORCH-1329 (*"email download = server 307, NOT client JS"*).
2. **Fetch `dest_smart_link` as `facebookexternalhit/1.1` and confirm it resolves to real event-page HTML**, not an app-store interstitial or a blank JS shell. Do this **before** live-fire.

`go.usemingla.com` **is** a subdomain of the same registrable domain (`usemingla.com`), which likely satisfies Google's policy — **but this must be confirmed with one live ad, not assumed.**

#### Google polices the destination for the ad's whole life — we check it once

**[GAP]** We validate `destination_not_public` **once at create** (422) and never again. Google's *unavailable offers* policy (*"promoting something not available or not easily found at the destination"*) and *destination not working* apply **for the ad's entire life**. A Mingla event that **sells out, gets unpublished, or whose date passes** turns a live, compliant ad into a policy violation — and burns money pointing at a dead page. `admin-ad-campaign-sync` reads status but never revalidates the destination.

**Build:** the sync job re-asserts *public + live + future* on every run and **auto-pauses** the campaign (+ an `ad_status_events` row) when it isn't.

> **We paused this campaign — "{event title}" is no longer public (it {sold out / was unpublished / already happened}). Google and Meta both reject ads pointing at a page that doesn't deliver what the ad promised, so we stopped it before it cost you a rejection.**

**Buttons.** `Back`. `Next` → Audience; disabled with *"Pick a page to send people to."*

---

### 1.3 · Step 3 — Audience

**Screen:** "Who should see this?" — geo first (it is the highest-leverage field we're missing), then demographics, then the per-channel levers.
**Purpose:** collect one normalized audience and translate it per channel — while being honest that the normalized shape **cannot** express what two channels need.

**[CORRECTION to #862 §4.4b and A3's `targeting jsonb`.]** The create body is `targeting:{ countries:[…], age_min, age_max, genders? }`. That shape is wrong in both directions:
- **It's too narrow.** Mingla is live in **London + US cities + Lagos**. A campaign for a Lagos venue targeting `countries:["NG"]` is spraying an entire nation to fill one room. **`geo_locations.cities` with a radius is the single highest-leverage targeting field we're missing, and it's a trivial add.**
- **It's too presumptuous.** **Reddit has no age targeting at all** — `min_age`/`max_age` exist *only* as query params on the `/channel_planning/reach` forecasting endpoint. A3's normalized shape assumes `age_min`/`age_max` universally. Reddit needs a passthrough or it's crippled.

#### 3a · Geo

| Label | Type | Default | Required |
|---|---|---|---|
| Country | multiselect | prefilled from the destination's market (**US/GB/NG**, #864 OD-5) | **Yes** — ≥1 |
| City | search + chips | prefilled from the destination venue's city | No |
| Radius | slider, unit-aware | **10 mi** | Only when a city is picked |
| Pin drop (venue-centred) | derived from `place_pool.lat/lng` | off | No |
| Exclusions | multiselect | empty | No |

**Validation, with numbers.**

| Rule | Threshold | Level | Message |
|---|---|---|---|
| ≥1 country | 1 | **Reject** | *"Pick at least one country."* |
| Meta cities cap | ≤ **250** | Reject | *"Meta allows up to 250 cities per ad set. You've picked {n}."* |
| Meta city radius | **10–50 mi** / **17–80 km** | Reject | *"Meta's radius has to be between 10 and 50 miles. {n} is outside that."* |
| Meta pin-drop radius | **0.63–50 mi** / **1–80 km**, ≤ **200** pins | Reject | *"A dropped pin can cover 0.63 to 50 miles."* |
| Meta regions / zips | ≤ **200** / ≤ **50,000** | Reject | — |
| Meta `location_types` | `home`, `recent` only (defaults to both) | Reject unknown | — |
| TikTok location count | ≤ **3,000** combined (`location_ids` + `zipcode_ids`) | Reject | *"TikTok allows up to 3,000 locations."* |
| TikTok overlap | **no overlapping locations** (can't target US + California together) | **Reject** | *"TikTok won't let you target a country and a place inside it at the same time. Pick one: {US} or {California}."* |
| TikTok id format | **numeric only — ISO codes are rejected** | Reject | (internal — never surface) |
| Reddit geolocations | ≤ **20,000** | Reject | — |
| Google proximity radius | ≤ **800 km / 500 mi** | Reject | — |

#### The two market findings that change channel eligibility

**⚠ TikTok cannot target GB. We are live in London.** `[LIVE: tool_region_get returns 33 countries for BOTH TRAFFIC and APP_PROMOTION — GB is not among them. US 6252001 ✓, NG 2328926 ✓.]` Meanwhile #863 §7 says to seed the map for *"US, UK, NG"*.

> **TikTok can't advertise in the United Kingdom from our ad account — the UK isn't in the list of countries TikTok returns for us. This looks like an account eligibility gate, not a product limit, and it needs escalating to TikTok. For now: London campaigns can't include TikTok.**

**[CORRECTION to #863 OD-7.]** OD-7 recommends a **build-time** geo map. **That recommendation is now unsafe** — it would silently ship a GB id that 400s. Build `resolveGeo` against the **live** `tool_region_get`, and **fail loudly** when a requested country is unavailable rather than dropping it.

**⚠ Reddit cannot bill NGN and has no Nigerian language.** Funding currencies are **`USD, GBP, CAD, EUR, AUD, NZD, SGD, BRL`** (8 — **no NGN**); the `languages` enum (21 ISO 639-1 values) has none. **Reddit is a US/UK/CA/EU/AU channel for us.** Lagos is targetable geographically, billed USD. **Don't route the Nigeria lane to Reddit.**

**[DESIGN DECISION] Eligibility is `objective × lane × market × connection-health`, not `objective × lane`.** #884 §4.3's `eligibleChannels(objective, lane, allowlist)` needs a **market** term and a **preflight** term. A London traffic plan has TikTok structurally excluded; a Lagos plan has Reddit excluded. The Brain must not allocate a cent to a channel that cannot reach the market.

#### Google's "London" problem — the geo-resolver is mandatory, not nice-to-have

We collect **country codes** (Meta-style). Google needs **numeric criterion IDs**. `[Verified against the downloaded CSV: geotargets-2026-07-06, 273,644 rows.]`

```
1002325  London,London,Ontario,Canada          ← sorts FIRST on a naive name lookup
1006886  London,England,United Kingdom          ← the one we want
1013271  London,Arkansas,United States
1017821  London,Kentucky,United States
1023797  London,Ohio,United States
```

**A naive name lookup targets the wrong continent.** Resolution **must** disambiguate on **`Country Code` + `Canonical Name`**, never on `Name`.

Verified constants for our live markets: **US `2840`** · **UK `2826`** · **Nigeria `2566`** · **London (UK) `1006886`** (canonical `London,England,United Kingdom`, parent 20339) · **Lagos city `1010294`** · **Lagos state `21564`** · **New York `1023191`** · **Los Angeles `1013962`** · **Chicago `1016367`** · English `languageConstants/1000`.

**Geo IDs rot.** `Status ∈ {Active, Removal Planned}`. **2,916 constants are `Removal Planned` — 2,212 of them in our own markets (GB/US/NG).** Cached IDs decay. Refresh quarterly; alert on `Removal Planned`.

**And the default is wrong for us.** `geo_target_type_setting.positive_geo_target_type` defaults to **`PRESENCE_OR_INTEREST`** — your "London" campaign also shows to people *interested in* London **from anywhere**. For a local-events product that is money on fire.

> **Set `positive_geo_target_type = PRESENCE` on every Google campaign.** Default: `PRESENCE=7`. Surface it as *"Only people actually in {city}"* (on) vs *"Also people interested in {city}"* (off, warned).

#### 3b · Demographics

| Label | Type | Default | Required |
|---|---|---|---|
| Age range | dual slider **13–65+** | **18–65** | No |
| Gender | segmented: All / Women / Men | **All** | No |
| Languages | multiselect | empty (= all) | No |

**Validation and the per-channel truth.**

| Rule | Level | Message |
|---|---|---|
| `age_min ≤ age_max` | Reject | *"The minimum age can't be higher than the maximum."* |
| Meta `age_min ≥ 13`, `age_max ≤ 65` | Reject | *"Meta's range is 13 to 65+. **65 means 65 and over** — there's no band above it."* |
| **Meta + Advantage+ audience ON → `age_min` **18–25 only**, `age_max` **fixed at 65** | **Reject with explanation** | *"Meta's Advantage+ audience is on, which means it treats your age range as a suggestion — and it won't accept a minimum above 25. To target 30+, turn Advantage+ audience off in Advanced (it'll narrow your reach and Meta advises against it)."* |
| Snap `min_age`/`max_age` are **strings** | (internal) | — |
| **Snap default `min_age` = "18"** | **Enforced default** | Snapchat skews **13–34**. An untargeted `geos:[{country_code:'us'}]` squad **serves heavily to minors** — a real problem for a venue/reservation product and a policy risk for anything alcohol-adjacent. **Default `min_age: "18"`.** |
| TikTok `age_groups` enum | Reject unknown | `AGE_13_17, AGE_18_24, AGE_25_34, AGE_35_44, AGE_45_54, AGE_55_100`. **`AGE_13_17` is restricted in US/LatAm/EEA/UK/CH/CA** — unspecified there defaults to 18+. |
| Google age is **discrete, not a range** | (mapping) | `AGE_RANGE_18_24=503001 … _65_UP=503006`, plus **`AGE_RANGE_UNDETERMINED=503999`** — which is **a real audience segment, not a null**. Decide explicitly whether to include it (recommend: include; excluding it silently drops real reach). |
| **Reddit has NO age field** | **Passthrough** | *"Reddit can't target by age at all — this campaign will reach adults of any age there. If age matters for this creative, exclude Reddit."* |
| Gender enums | (mapping) | Meta `1`=male `2`=female (**no non-binary value documented** — omit for all). Snap `MALE|FEMALE` (**no non-binary**). TikTok `GENDER_FEMALE|GENDER_MALE|GENDER_UNLIMITED`. Google `MALE=10, FEMALE=11, UNDETERMINED=20`. **Reddit `FEMALE, MALE, null` — that's it.** |

#### 3c · Interests, custom audiences, lookalikes

**[CORRECTION to #862 §4.0.]** The spec says interest IDs come "from a Targeting-Search API — **not exposed in this MCP**" and defers interest targeting. The first half is right; **the conclusion is wrong for production.** The MCP lacks it; **the Graph API has it and our System User token can call it**:

```
GET /v{ver}/search?type=adinterest&q=nightlife&limit=25
GET /v{ver}/search?type=adinterestvalid&interest_fbid_list=["6003139266461"]
GET /v{ver}/search?type=adTargetingCategory&class=behaviors
GET /v{ver}/search?type=adgeolocation&location_types=["city"]&q=London
GET /v{ver}/search?type=adlocale&q=english
```

**Interest targeting is buildable now.** (Whether we *should* is separate — see the doctrine note below.)

| Rule | Level | Message |
|---|---|---|
| Meta interest IDs must be **real 13–16-digit numerics** | Reject | Never invent them; `"000"`/`"123"` are rejected [SCHEMA]. Validate via `type=adinterestvalid`. |
| Meta `flexible_spec` requires `geo_locations` (or custom audiences) also present | Reject | *"Pick a location before adding interests — Meta requires it."* |
| Meta lookalike seed | **≥100 people** [OFFICIAL] | Reject | *"A lookalike needs at least 100 people to copy. We have 0 tracked visitors — this unlocks when the pixel starts firing (#865)."* |
| **Meta lookalike ratio is 1%–20%, NOT 1%–10%** | Reject outside | Range `0.01`–`0.20` in `0.01` steps [OFFICIAL + SCHEMA agree]. `0.01` = closest/smallest. **Geography is automatic (`allow_international_seeds=true`) — do not ask for a country.** |
| Snap lookalike ratio | **1%–10%** | Reject outside | Different from Meta. Start 1–3% for prospecting. |
| Reddit `interests` ≤ **200**; `keywords` ≤ **1,000**; `excluded_keywords` ≤ **2,000** | Reject | — |
| Reddit `excluded_interests` | **deprecated** | Warn | — |

**Retention windows [OFFICIAL], for when #865 lands:** Meta website (pixel) **180 d** · video engagement **365 d** · Page/IG-business/Instant-Experience **730 d** · lead-gen ads **90 d** · Page/IG likes no limit. Note an **API-vs-UI discrepancy**: Ads Manager commonly shows a 365-day cap for engagement audiences where the API guide documents 730.

**The one retargeting play available before the pixel:** **Meta ENGAGEMENT audiences from IG/Page (730-day retention) need no pixel at all.** They are the single retargeting lever we could run today — *if* the IG account resolves (see below).

#### 3d · Reddit communities — the unique lever, and the reason to do Reddit at all

**`targeting.communities`** (plain subreddit names, **no `r/` prefix**, e.g. `["london","AskLondon","nyc"]`) + **`excluded_communities`** have **no analogue on Meta, TikTok, Snapchat, or Google.** Mingla is a **city-level experience app**; Reddit's city subreddits are a near-perfect ICP match.

> **Ship the community picker or don't ship Reddit.** A3's normalized `targeting jsonb` (`{countries, age_min, age_max, genders}`) **cannot express it** — and its age assumption is meaningless on Reddit. The normalized shape **must gain a per-platform passthrough**.

| Field | Type | Default | Required |
|---|---|---|---|
| Communities | search + chips, backed by `GET /targeting/communities/search` + `/suggestions` | suggested from the destination city | No |
| Excluded communities | chips | **`["politics"]`** (brand adjacency) | No |
| Keywords | chips, validated via `POST /targeting/keyword_validations` | empty | No |
| Placement (`locations`) | multiselect: **Feed** / **Comments page** | **both** | Yes |
| View modes | multiselect | **`["CARD","IMMERSIVE"]`** | Yes |
| Allow comments | toggle | **on** | — |
| Redditor Highlights (UGC) | toggle | **on** (`enroll_status: OPT_IN`) | — |

**Rate-limit reality:** the community picker runs on `ads-targeting-taxonomy` at **100 req / 60 s** — the tightest budget on the platform. **Cache the taxonomy hard.** Set a descriptive `User-Agent` on **every** call including the token refresh (Reddit aggressively 429s/403s default UAs like `python-requests` and bare `curl`).

**Two orthogonal axes nobody modelled:** `communities` = *which subreddits* (who); `locations` = *where on the page* (`FEED` / `COMMENTS_PAGE`); `view_modes` = *what layout the ad renders in* (`ALL/CARD/CLASSIC/COMPACT/IMMERSIVE`). **`COMPACT` renders our 4:5 hero as a thumbnail.** No other channel has this axis and A3's `placement jsonb` models none of it.

> **There is no `COMMUNITY` placement.** The "feed / conversation / community" trio in circulation is not Reddit's model.

#### 3e · Placements (all channels)

| Channel | Default | Why |
|---|---|---|
| **Meta** | **Advantage+ placements = omit all placement fields** | *"No action is required to opt in… it is the default setting in the API"* [OFFICIAL]. **This is what Meta recommends and it's what #862 accidentally does by not passing them.** It is now a *decision*, not an accident — and it makes the creative problem (§2) worse, not better. |
| **TikTok** | `PLACEMENT_TYPE_NORMAL` + `placements: ["PLACEMENT_TIKTOK"]` | **Immutable after create.** `PLACEMENT_TOPBUZZ`/`PLACEMENT_HELO` are **deprecated — never use**. |
| **Snapchat** | `placement_v2: { config: "AUTOMATIC" }` | Maximizes auction liquidity. `CUSTOM` requires `platforms` **and** a non-empty `snapchat_positions` (9 values). |
| **Google** | per channel type | Search: `target_google_search=true`, `target_search_network=false`. |
| **Reddit** | `locations: ["FEED","COMMENTS_PAGE"]` | The conversation placement is deep-intent and historically cheaper. Test it as its own ad group. |

**Meta placement constraints the validator must encode:** `audience_network` **cannot be used alone** · `threads_stream` **requires Instagram `stream` also selected** · `messenger:sponsored_messages` **cannot combine with ANY other placement, including Facebook** · `facebook:story` **requires `device_platforms: mobile`** · `right_hand_column` is single-image/video/carousel only and **cannot be used alone for video/collection/canvas**.

**TikTok `PLACEMENT_GLOBAL_APP_BUNDLE` is a trap.** Geo-locked to **BR, ID, VN, PH, TH, MY, MX, SA, JP only**; **does not support `TRAFFIC_LANDING_PAGE_VIEW`** (our default goal). If a placement picker ever exposes it, the combination silently fails. **Gate it.**

#### 3f · The Instagram decision

**[CORRECTION to #862 OD-8.]** OD-8 = ship **Facebook-only**, omitting `instagram_user_id`, justified because `ads_get_ig_accounts` errors with *"This tool is new and is being gradually rolled out."* **[SCHEMA, verbatim]:** *"Omit and the creative will not deliver on Instagram surfaces."*

We would voluntarily forfeit **IG Feed, Stories, Reels, and Explore** — for a visual, venue/experience product aimed at a young urban audience, **Instagram is arguably the primary surface, not the optional one** — and the justification is **an MCP tooling gap, not a Graph limitation**.

**Build:** resolve the IG business account **via Graph, not MCP** (`GET /act_{id}/instagram_accounts` or `GET /{page_id}?fields=instagram_business_account`), store `META_IG_USER_ID` in the connection's `extra` (A3's schema already has `extra jsonb` for exactly this), pass `instagram_user_id` on the creative. **Reverse OD-8** to *"ship with IG when the IG business account resolves; Facebook-only is the fallback, not the target."*

**Doctrine note (why the defaults are broad).** Modern Meta doctrine [CONSENSUS, strongly converged]: **start broad, differentiate ad sets by creative angle, not audience slicing.** Narrower audience → fewer eligible impressions → fewer optimization events → the ~50-events/7-days learning bar takes longer → higher Learning-Limited risk. TikTok's algorithm likewise resolves audience faster than manual interest stacking; **geo + age is the recommended MVP** — which #862 and #863 both already chose correctly. **The interest builder is for control, not for performance.**

**Buttons.** `Back`. `Next` → Budget.

---

### 1.4 · Step 4 — Budget & schedule

**Screen:** "How much, and when?" — **one** total daily budget (the #884 Brain's whole thesis), the proposed split, and the schedule.
**Purpose:** take one number, prove it's spendable, and split it across channels that can actually use it.

**Fields.**

| Label | Type | Default | Required |
|---|---|---|---|
| **Total daily budget** | `CurrencyInput` (dollars in, **cents at rest**) | none | **Yes** |
| Budget type | segmented: **Daily** / Lifetime | Daily | Yes |
| Strategy | segmented: **Auto** / Concentrate / Diversify | Auto | Yes |
| Channel allowlist | multiselect (Advanced) | all eligible | No |
| Start | datetime | now | No |
| End | datetime | none | **Yes if Lifetime** |
| Dayparting | 7×24 grid (Advanced) | off | No |

#### The per-channel floors — and the two things wrong with our table

**#884 §4.0's floor table, corrected:**

| Channel | Floor as specced | **The truth** | Source |
|---|---|---|---|
| **Meta** | `$1.00 = 100¢` | **⚠ `100¢` is the IMPRESSIONS floor only.** Minimums are **per-optimization-category**, not per-account: `min_daily_budget_imp`, `min_daily_budget_high_freq`, `min_daily_budget_low_freq`, `min_daily_budget_video_views`. Our `LINK_CLICKS`/`LANDING_PAGE_VIEWS` ad sets are **high-frequency** (~**$5.00/day** [CONSENSUS]); app installs are **low-frequency** (~**$40.00/day** [CONSENSUS]). | `GET /act_{id}/minimum_budgets` [OFFICIAL] |
| **TikTok** | `$20/day adgroup = 2000¢`; `$50/day campaign CBO = 5000¢` | **Confirmed verbatim.** Lifetime ad-group min = **$20 × scheduled days** (31 days → **$620**). Not exposed by any read API — the create call rejects below it. | ads.tiktok.com/help/article/budget |
| **Snapchat** | squad `$5 = 500¢` (`5000000` micro); campaign `$20 = 2000¢` (`20000000` micro) | **Confirmed.** `bid_micro` min **10,000** ($0.01) across all currencies; USD max **500,000,000**. | developers.snap.com |
| **Google** | "no hard API floor; practical ≈ $5–10/day = 500–1000¢" | Confirmed. **But:** Google may spend **up to 2× the average daily budget on any single day**; monthly ≤ **average daily × 30.4**. $10/day → **$304/month** hard ceiling. | support.google.com |
| **Reddit** | `≈$5/day = 500¢` | **⚠ Not in the API spec.** Full-text grep of the 76,392-line OpenAPI: `goal_value: minimum: 0`, **no daily-budget floor**. The only hard money bound [SPEC] is **`bid_value` $3.50–$100 USD for CPC → 3,500,000–100,000,000 micro**. **Do not hardcode $5/day** — let the API 400 and surface it. | reddit-ads-api-v3.yaml |

**⚠ Discovery 1 — Meta's floor is the wrong floor, and it breaks the plan silently.** #862 A2/§4.2 store `min_daily_budget_cents = 100` from the account probe; AC-3 validates against it. A **$2/day Meta LINK_CLICKS ad set passes our 422 check and is then rejected by Meta** (or accepted and starved). **Build:** `admin-ad-connect` calls `GET /act_{id}/minimum_budgets`, stores **all four** values in `ad_connections.extra`, and the validator picks **the minimum for the chosen goal's category**. **Do not hardcode the $1/$5/$40 table** — sources conflict ($1/$5/$40 vs $0.50/$2.50/$40). Query the endpoint.

Also encode the **bid-cap multiplier rule [OFFICIAL]**: under `LOWEST_COST_WITH_BID_CAP`, min daily ≥ `bid_amount` (impression-optimized) or **≥ 5× `bid_amount`** (click/action-optimized). **The "4× rule" in circulation is wrong — it is 5×.**

**⚠ Discovery 2 — the Brain's concentrate/diversify threshold diversifies into starvation.** #884 §4.4(a).3: `auto` → **concentrate if `total < 2 × median_floor`**. With the floors as specced — `{Meta 100, Snap 500, Google 500, Reddit 500, TikTok 2000}` — **median = 500¢**, so the threshold is **$10/day**. Any plan ≥ $10 diversifies. Walk a **$20/day** plan through `planInitial`:

```
greedy fill by priority (Meta > TikTok > Google > Snap > Reddit), admit while Σfloor ≤ 2000:
  Meta   100   Σ=100
  TikTok 2000  Σ=2100 > 2000  → rejected
  Google 500   Σ=600
  Snap   500   Σ=1100
  Reddit 500   Σ=1600
K=4; remainder 400 split evenly (+100 each)
→ Meta $2/day · Google $6/day · Snap $6/day · Reddit $6/day
```

Every one of those is below its own viability threshold, and **Meta at $2/day is below its own high-frequency category floor (~$5)** — so the create call fails. **Meta's $1 floor is an outlier that drags the median down and makes `auto` diversify roughly 5× too early.**

> **[DESIGN DECISION] Replace `2 × median_floor` with a viability floor.** A channel is admitted only when it can be funded at **`max(floor_c, viability_c)`**, where `viability_c` is derived from the learning-phase bar, not the API minimum — the budget at which the channel can plausibly produce enough results to optimize. Ship conservative constants (#884 OD-3 already flags per-platform calibration as open) and **default `auto` to concentrate far more aggressively**: `concentrate unless total ≥ Σ(viability_c) for at least 2 channels`.

**The honest math that forces this.** Meta's learning phase needs **~50 optimization events per ad set per rolling 7 days** [OFFICIAL] to exit. At **$1/day** (our account minimum and the spec's live-fire plan) with a Travel/Arts benchmark CPC of **~$0.50** [CONSENSUS]: **~2 clicks/day ≈ 14/week** — and landing-page-views/reservations are a fraction of that. **50 events/7 days is unreachable by roughly two orders of magnitude.** A $1/day campaign is a **plumbing test, not a performance campaign**, and it will sit permanently in **Learning Limited**.

> **This is not a bug in the plan.** $1/day is the right plumbing test. **It becomes a bug the moment anyone reads its CPA as signal.** Surface it:
>
> **This ad set is unlikely to reach the ~50 results per week Meta needs to leave its learning phase at this budget. Treat the numbers as directional only — they are not a verdict on the channel.**

**Build:** read `GET /{adset_id}?fields=learning_stage_info` → `{status: LEARNING|SUCCESS|FAIL, last_sig_edit_ts}`; persist to `ad_sets`; render a **"Learning Limited"** badge (`FAIL` = Meta's own forward-looking prediction that 50/7d is unreachable given audience, budget, or bid). **Warn at create** when `daily_budget × 7 ÷ estimated_CPA < 50`.

#### ⚠ Discovery 3 — the cents-vs-micro bug is live in our specs, and it is a 10,000× money bug

**#862 A3 (declared canonical, and the model #863/#866/#867 all depend on):** *"budgets are stored in **cents** (adapters convert to micro/dollars at the boundary — **not #867's `budget_micro`**)"*.
**#867 ships `budget_micro bigint` and its ACs assert micro.**

Two adapters written to two conventions is an off-by-**10,000×** budget bug, and it is live on an account with a **$15,000/day** funding limit:

| The mistake | The result |
|---|---|
| $5.00 stored as `500` cents, sent **raw** as micro | `500` micro = **$0.0005** → below every minimum → reject (loud, survivable) |
| `5000000` micro read as **cents** | **$50,000** → **silent, catastrophic** |

> **[DESIGN DECISION] Cents is canonical, everywhere, at rest. Conversion happens at exactly one place per adapter: the API boundary.**

| Channel | Conversion | Assertion |
|---|---|---|
| **Meta** | `cents` → `cents` (no conversion) | `daily_budget: 500` = $5.00 |
| **TikTok** | `cents ÷ 100` → **dollars (double)** | `budget: 20.0` = $20.00 |
| **Snapchat** | `cents × 10,000` → **micro** | **`$5.00 → 5000000`**, **`$20.00 → 20000000`** |
| **Google** | `cents × 10,000` → **micros** | `$20.00 → amount_micros: "20000000"` |
| **Reddit** | `cents × 10,000` → **micro** | `$100 → goal_value: 100000000`; `bid_value` band **3500000–100000000** |

**Non-negotiable:** a unit test asserting `$5.00 → 5000000 micro` and `$20.00 → 20000000 micro`, and **the min-check runs in micro *after* conversion**, not in cents before it. File `SPEC_AMENDMENT_ISSUE-867` to reconcile. This is the single most expensive line in this document.

#### Validation, with numbers and messages

| Rule | Level | Message |
|---|---|---|
| `total > 0` | Reject | *"Enter a daily budget."* |
| `total < min(floor_c)` across eligible channels | **Reject** `422 budget_below_cheapest_floor` | *"$
{n}/day is below every channel's minimum. The cheapest we can run is **${min}/day on {channel}**."* |
| Below a specific channel's floor | **Exclude that channel + explain** | *"At ${n}/day we're leaving TikTok out — TikTok's minimum is $20/day per ad group, and we'd rather put your money where it can actually run."* |
| Below Meta's **category** floor for the chosen goal | Reject | *"Meta needs about ${cat_min}/day for a link-clicks campaign — its $1 minimum only applies to impressions campaigns."* |
| Lifetime without an end time | Reject | *"A lifetime budget needs an end date."* |
| TikTok lifetime | Reject | *"TikTok's lifetime minimum is $20 × the number of days you run — {days} days needs at least ${days×20}."* |
| Snap `lifetime_spend_cap_micro` reduction | Reject | Reducible **only if the new cap > 1.1 × already spent**. |
| Reddit CBO cross-rules | Reject | CBO ⇒ `bid_strategy` + `bid_type` + `start_time` required; `goal_type=LIFETIME_SPEND` ⇒ `end_time` non-null; campaign `bid_value` set ⇒ ad-group `bid_value` **must** be null; `spend_cap` only for non-CBO or CBO+`DAILY_SPEND`; **`APP_INSTALLS`/`CONVERSIONS`/`CATALOG_SALES` cannot use CBO**. |
| TikTok CBO | Reject | **`bid_type` is REQUIRED when CBO is on.** #863 sets no `bid_type` at all and #862 OD-3 recommends CBO daily — **a CBO campaign built to #863 as written will fail validation.** Under one CBO campaign, `bid_type` + `optimization_event` **must match the first ad group**. |
| TikTok `bid_price` | Reject | Must be **lower than both** the campaign budget and the ad-group budget. |
| Meta CBO | Reject | Setting `campaign_daily_budget` implicitly switches to CBO; ad-set-level `daily_budget`/`bid_strategy` are then **rejected** ("Must Use Campaign Bid Strategy"). |
| Meta ABO/CBO exclusivity | Reject | `daily_budget` XOR `lifetime_budget`; lifetime **requires `end_time`**. |

#### The spend-pacing truths to surface (so "$20/day" isn't read as a hard cap)

| Channel | The real pacing rule |
|---|---|
| **Meta** | **[OFFICIAL, verbatim]** *"we may spend up to 75% over your daily budget… up to **175%** of your daily budget… charges will average out over a calendar week (Sunday to Saturday)… you won't spend more than **7 times** your daily budget."* **It is 175%, not 2× — the "2x" figure is folklore.** |
| **Google** | Up to **2× the average daily budget** on any single day; monthly ≤ **daily × 30.4**; overage refunded as an overdelivery credit. |
| **TikTok** | `BUDGET_MODE_DYNAMIC_DAILY_BUDGET` = average over a week: **daily ≤ 125% of average; weekly ≤ average × 7**. |
| **Snapchat** | `pacing_type: STANDARD` (default) vs `ACCELERATED` — **`ACCELERATED` requires `LOWEST_COST_WITH_MAX_BID` + `bid_micro` + goal ∈ {IMPRESSIONS, USES, SWIPES, VIDEO_VIEWS, VIDEO_VIEWS_15_SEC, STORY_OPENS}, and is immutable once set.** |

> **A day can cost more than your daily budget.** Meta can spend up to **175%** of it on a busy day and evens out across the week (never more than 7× in total). Google can spend up to **2×** on one day, capped at about **30.4×** a month. The Brain's cap is the honest number: **the plan total never moves.**

#### Budget-change rules the optimizer must obey

| Channel | Rule |
|---|---|
| **TikTok [OFFICIAL]** | Increases **≤40% per adjustment during learning**; **≤30% after**; **not more often than every 2 days**. Campaign budget must not be lower than ad-group budget. |
| **Meta** | **⚠ There is NO official % threshold for budget edits.** The "20% rule" is **folklore**. Meta's own significant-edits page states no percentage; its only concrete example: **"$100→$101 is not significant, $100→$1000 likely is."** **Do NOT implement a "20% budget change" guard.** Warn on **order-of-magnitude** changes and on the edits Meta *does* name: **optimization event, audience, creative, pause.** |
| **Google** | Changing **strategy type / conversion goals / targeting / creative** resets learning; **changing only the tCPA/tROAS target does not.** Learning ~5–7 days; PMax up to **6 weeks** to mature. |

**#884's ±20% max daily shift cap** (OD-6) is *our* anti-whiplash rule and is sound — it is **not** a platform rule, and it must be **reconciled with TikTok's real ≤40%/≤30%-every-2-days constraint**, which is stricter in cadence and looser in magnitude. **The optimizer must take the intersection: ≤20% magnitude AND ≥2 days between TikTok adjustments.**

#### Schedule

| Rule | Level | Message |
|---|---|---|
| **TikTok `schedule_start_time` is `YYYY-MM-DD HH:MM:SS` in UTC+0** | Reject | **[CORRECTION to #863]:** the spec says *"in the advertiser timezone"*. **The live MCP schema says UTC+0.** Our advertiser is `Etc/GMT+5`/`America/New_York` → **a 5-hour scheduling error.** |
| TikTok start bound | Reject | ≤12 h in the past; **no later than `2028-01-01 00:00:00`**. |
| TikTok end bound | Reject | **No later than `2038-01-01 00:00:00`**. |
| TikTok dayparting | Reject | **Exactly 336 chars of `0`/`1`** (48 × 7). Char 1 = Mon 00:01–00:30; char 336 = Sun 23:31–00:00. All-`0`/all-`1`/omitted = full-time. |
| Meta dayparting | Reject | `adset_schedule: [{start_minute, end_minute, days:[0..6]}]`, minutes **0–1440** from midnight, **0 = Sunday**; pair with `pacing_type: ["day_parting"]`. |
| Reddit schedule | Reject | `{start_day, end_day, start_hour, end_hour}`, **day 0=Sunday … 6=Saturday**. |
| Snap/Google | — | Snap `end_time` must be **after** `start_time`. Google v24 exposes **`start_date_time`/`end_date_time`** accepting **`YYYY-MM-DD[ HH:MM:SS]`**, superseding the legacy `start_date`/`end_date` that took bare **`YYYYMMDD`** — **both spellings circulate in older docs. Confirm against v24 before the first mutate.** |

> **No shared date helper across adapters.** TikTok = UTC+0 string; Snapchat = ISO-8601 with offset; Google = `YYYY-MM-DD HH:MM:SS`; Meta = ISO-8601. Four formats, four timezones-of-record. This is a per-adapter concern and a classic silent bug.

**Dayparting is high-value for us and unbuilt on every channel.** A venue's ad running at 4am is waste. Meta `adset_schedule`, TikTok `dayparting`, Snap `ad_scheduling_config`, Reddit `schedule`, Google `ad_schedule` criterion — **all API-supported, none specced.**

**Buttons.**
- `Back`.
- `Preview split` → `admin-ad-budget-plan-preview` (pure, no writes — safe on every keystroke). Renders the stacked bar + the reasoning copy:
  > **At $20/day we'll put everything on Meta.** It's the only channel whose minimum leaves room to actually optimize — TikTok needs $20/day just to start, and splitting $20 four ways gives every channel less than it needs to learn. **Raise to about $120/day to run three channels (Meta + Snapchat + Google).**
- `Next` → Creative.

---

### 1.5 · Step 5 — Creative

**Screen:** "What are people going to see?" — the #866 `CreativePicker` embedded per **stage**, with a live per-channel validation panel.
**Purpose:** get a real asset that will actually run on every channel it's shipped to — and auto-fix what we can, reject what we can't, before a platform review cycle eats 24 hours.

#### Two stages, one picker

| Stage | Purpose | When |
|---|---|---|
| **Launch** | The prospecting creative — the one that fills the room. | Always |
| **Retargeting** | The "you looked at this" creative for people who visited and didn't book. | **Shown only when a retargeting audience exists** (#865 Phase B). Until then: hidden, per the "no half-built placeholders" rule. |

#### ⚠ The core discovery: our creative pipeline is Meta-shaped, pass-through, and will ship a square image into a 9:16 placement

**Evidence.** #866 is **transport only** — full-text grep: `watermark` 0 mentions · `safe zone` 0 · `black bar` 0 · `transcode` 0 · `bitrate` 0 · `codec` 0 · `fps` 0 · `vertical` 0. `width`/`height`/`aspect_ratio`/`duration_seconds`/`mime_type` are **admin-supplied, nullable, and never validated against the bytes**. Variant generation is explicitly ruled **out** (OD-6). And **#864's dropzone hint literally steers admins to "≥1080×1080 · 1:1 or 1.91:1" — Meta ratios** — after which a 1:1 asset is shipped **byte-identical** to TikTok's 9:16 placement.

**Four consequences, each independently fatal:**

1. **Meta:** one image + **Advantage+ placements ON by default** → the placement union demands **4:5** (FB Feed), **1:1** (IG Feed/Right Column/Marketplace), **9:16** (Stories/Reels), **1.91:1–1:1** (Search/In-Stream). A single 1:1 image gets **auto-cropped into 9:16 Stories/Reels with 14% top / 35% bottom of the frame under UI chrome.** Our safe-zone-unaware creative has its CTA and logo occluded on the platform's highest-volume surfaces. *This is the difference between "the API call succeeded" and "the ad works."*
2. **TikTok:** a 16:9 or 1:1 asset letterboxed into 9:16 is **the single most common auto-reject in practice** — caught by *"must not use columns or pixels to partially cover images"* + *"must be legible and of a high resolution"* + the standard-video-size requirement.
3. **Snapchat:** a silent video is **auto-rejected as "Low-Quality Creative"** — and **#864's image cap is ≤30 MB, which is 6× Snap's 5 MB limit.** A 16:9 landscape asset from the library will be accepted, uploaded, and rejected days later (3–5 business days), or cropped into garbage by `top_snap_crop_position: OPTIMIZED`.
4. **Google:** our bucket allows **30 MB** and `{image/png, image/jpeg}` — a 30 MB image passes our gate and **fails Google's 5,120 KB limit**. **Google has no crop parameter and never fetches remote URLs** — we must download the bytes and pre-crop to each target ratio ourselves.

> **[DESIGN DECISION] The creative validator is a server-side byte-probe, not a form check.** Never trust admin-supplied dimensions. `ffprobe` (or equivalent) on the actual bytes, then the §2 matrix, then auto-fix or hard-reject **before** any platform upload.

#### Fields

| Label | Type | Default | Required |
|---|---|---|---|
| Creative | `CreativePicker` (library grid, filtered to the destination's venue by default) | none | **Yes** |
| Upload new | drag/drop → `mediaUpload.js` (image → `meta-ad-creatives`) / Bunny (video) | — | — |
| Poster / cover | upload | **required for video** (#866 OD-4 DB CHECK) | Conditional |
| **AI-generated?** | toggle | **on** for anything from the Higgsfield/Remotion pipeline | **Yes** |
| Format | derived: Single image / Single video / Carousel | derived | — |
| Advanced → per-ratio variants | 4:5 / 1:1 / 9:16 slots | auto-derived | No |

#### The `self_ai_disclosure` field nobody specced — and we're actively creating the exposure

**[SCHEMA]** Meta's creative accepts **`self_ai_disclosure`** ∈ `OPT_IN` (contains third-party generative-AI created/edited media) | `OPT_OUT`. Only those two exact UPPER_CASE values. **Our ad pipeline is Higgsfield/AI-generative (`cinematic-ad-director`).** Any Higgsfield-produced creative arguably requires `OPT_IN`. **The field is absent from both #862 and #866.**

> **Build:** add `ai_generated boolean` to `ad_creatives` → map to `OPT_IN`/`OPT_OUT`. **Default `OPT_IN` for anything from the Higgsfield/Remotion pipeline.** Non-disclosure of AI media is a compliance exposure we are actively creating.

**And TikTok makes it worse.** `aigc_disclosure_type` (`SELF_DISCLOSURE` | `NOT_DECLARED`) is **valid only when `identity_type=CUSTOMIZED_USER`** — which our account **cannot use** (see below). **We cannot self-disclose AI-generated content on TikTok via the API at all.** Escalate separately.

#### ⚠ TikTok: our account class cannot use `CUSTOMIZED_USER` identity — and nobody knows this

**[Live `ad_create` description, verbatim]:** *"…all new ad accounts created on or after **January 15, 2026** cannot create non-Spark Ads using Custom Identities for these placements [Automatic or Select Placement when TikTok is included]. Existing ads remain editable. Campaigns that deliver only to Pangle or Global App Bundle placements are not affected."*

**Our advertiser `create_time = 1776026274` = 2026-04-12 20:37:54 UTC — after the cutoff.**

This is not a soft warning; it is a **hard account-class restriction**. Our identity options collapse to exactly two:
- **`TT_USER`** — `@usemingla` (`AVAILABLE`, `can_push_video: true`, `can_pull_video: true`). **We have it. This is the only viable non-Spark path** — and #863's choice of `TT_USER` is therefore not a preference, it is the *only* legal option, and the spec never says why.
- **`AUTH_CODE`** — Spark Ads via a creator authorization code.

**Build:** **hard-fail `CUSTOMIZED_USER` in the adapter with an explanatory error** — do not let it reach TikTok. The Pangle/GAB exemption is not a real escape (Pangle is low-intent; GAB is geo-locked away from our markets).

**And Spark — the highest-performing TikTok format — is half-blocked.** `identity_video_get` → **`video_list: []`**. **`@usemingla` has zero posts, so Spark Ads *Pull* has nothing to pull.** **Spark Ads *Push* works from zero posts** (publish as ad, `dark_post_status=ON`, accepts `image_ids` + `ad_text`) — **this is the viable path today**. Creator-code Spark requires the creator to generate a code **in-app** (7/30/60/365-day durations; batch ≤20 in Ads Manager) — **not automatable**; it needs an ops flow, which **pairs naturally with the existing influencer-intake pipeline**. #863 mentions Spark **zero times**.

**One thing Spark unlocks that nothing else does:** emoji. `ad_text` on a **non-Spark** TikTok ad **forbids emoji**; a **Spark** ad uses the *organic post's caption*, which **does** support emoji (*"A maximum of 4 lines can be displayed, including emojis"*). Our copy pipeline (`mingla-content-engine`) is emoji-native. **Emoji reach TikTok only via Spark.** (And *"you cannot edit a post's caption after it's been authorized as an ad."*)

#### What we auto-fix vs what we hard-reject

**[DESIGN DECISION] Three tiers.** *Auto-fix* = we change the bytes and tell the operator. *Warn* = we ship it and flag the risk. *Hard-reject* = we refuse before upload, because the platform will refuse after.

| Tier | Rule of thumb |
|---|---|
| **Auto-fix** | Anything deterministic and lossless-enough: resize, re-encode, re-container, crop to a target ratio from a master, generate the missing per-ratio variant, strip metadata. |
| **Warn** | Anything we cannot reliably detect (text position inside a safe zone; codec details we can't probe) or any **[3P]/[UNVERIFIED]** number (all of Reddit's pixel specs). |
| **Hard-reject** | Anything the platform enforces that we cannot fix without changing the creative's meaning: missing audio, over-duration, watermarks, black bars, char limits. |

**The free auto-fixes already on the table (both unused):**
- **TikTok Smart Fix** — `file_video_ad_upload` with `flaw_detect=true` + `auto_fix_enabled=true` auto-fixes **only** `LOW_RESOLUTION` (→ upscaled to **1280×720**) and `ILLEGAL_VIDEO_SIZE` (→ adjusted to **1:1, 9:16, or 16:9**), since 2025-04-24. Returns `fix_task_id` + `flaw_types`; **one** fixed version. **If issues are detected and `auto_fix_enabled=false`, the API returns an error with the flaw types.** **Turn both on.**
- **TikTok `creative_auto_enhancement_strategy_list`** — `VIDEO_QUALITY`, `MUSIC_REFRESH`, `IMAGE_QUALITY`, **`IMAGE_RESIZE`**. GA to all advertisers. **`IMAGE_RESIZE` is a free partial mitigation for our aspect-ratio gap.**

> **Neither touches duration, watermarks, black bars, or safe zones.** Those remain ours.

#### The exact reject / auto-fix messages

| Trigger | Level | Message |
|---|---|---|
| Ratio ≠ target, master available | **Auto-fix** | *"We cropped this to 9:16 for TikTok and Snapchat, and to 4:5 for Facebook. Check the previews — the crop keeps the centre, so anything near an edge may be cut."* |
| Resolution below the recommended but above the floor | **Auto-fix** | *"We upscaled this to 1280×720 — TikTok wants at least 720p. It'll look softer than a native-resolution asset."* |
| **Video has no audio track** (Snap, TikTok) | **Hard-reject** | *"This video has no sound. Snapchat auto-rejects silent video as low-quality, and TikTok requires audio. Add a soundtrack or a voiceover — a trending sound beats stock music on both."* |
| **TikTok duration outside 5–60 s** | **Hard-reject** | *"This video is {n} seconds. TikTok's technical limit is 10 minutes but its **advertising policy** is 5–60 seconds — it'll upload fine, create fine, and then get rejected in review. Trim it to 60 seconds or under. (Sweet spot: 9–15 seconds.)"* |
| **Snap duration outside 3–180 s** | **Hard-reject** | *"Snapchat Top Snaps run 3 to 180 seconds. This one is {n}. (Snap ads under 10 seconds consistently outperform longer cuts.)"* |
| **Black bars / letterboxing detected** | **Hard-reject** | *"This looks like a 16:9 video letterboxed into a vertical frame — black bars top and bottom. It's the single most common TikTok auto-reject. Give us the original and we'll crop it properly."* |
| **Watermark / other-platform logo detected** | **Hard-reject** | *"There's a watermark in the corner — looks like an Instagram/Reels/Shorts export. TikTok explicitly prohibits blurred or masked third-party watermarks, and repurposed-content burn-ins are a standard rejection. Use a clean export."* |
| **Safe-zone risk (Meta 9:16)** | **Warn** | *"On Stories and Reels, the top 14% and bottom 35% of the frame sit under Instagram's own buttons. Your text looks close to that. Check the Story preview before you launch."* |
| **Safe-zone risk (Snap)** | **Warn** | *"Keep logos and text out of the top and bottom 150 pixels — Snapchat's own UI covers them."* |
| **Safe-zone risk (TikTok)** | **Warn** | *"TikTok's safe zone shrinks as your caption gets longer, and the right rail eats about 120 pixels. Your caption is {n} characters — the longer it is, the less room your creative has."* |
| **Safe-zone risk (Reddit)** | **Warn** | *"Reddit's upvote/comment bar overlays the bottom ~20% of the image. Keep text and logos out of it."* |
| Image over a channel's byte cap | **Auto-fix** (re-encode) then reject if still over | *"This image is {n} MB. Google's limit is 5 MB and Snapchat's is 5 MB — we re-encoded it to {m} MB."* / *"We couldn't get it under 5 MB without wrecking it. Use a smaller source."* |
| **GIF/WEBP for Google** | **Hard-reject** | *"Google only takes JPG or PNG for ad images — GIF and WEBP get rejected even though the format list suggests otherwise."* |
| TikTok carousel without music | **Hard-reject** | *"TikTok carousels need a music track. Pick one from the Commercial Music Library or upload your own (mp3/wav/m4a/flac, at least 2 seconds, under 10 MB)."* |
| Video creative on Google | **Auto-path** | *"We'll upload this to YouTube for you — Google can only run YouTube-hosted video. It'll be unlisted."* |
| Meta video stuck in transcoding | **Hard-reject (fail-close)** | *"Meta is still processing this video and it's taking too long. We stopped the campaign build rather than create half of it. Try again in a few minutes."* |
| Reddit media | **Warn only** | Reddit's OpenAPI encodes **zero** pixel dimensions, byte caps, durations, or codecs. Its only machine feedback is async `INVALID_MEDIA` + `errors[].message` **prose with no error code**. *"Reddit checks images after upload and only tells us in plain English. If it bounces, we'll show you exactly what Reddit said."* — **never regex that message.** |

#### The Google video path — the spec's "blocker" is wrong

**#866 §4.0 / §205 record this as a hard dependency:** *"**Bunny video cannot upload directly — YouTube dependency**, §11 OD-2"* and *"video → `YoutubeVideoAsset` **requires a YouTube-hosted `youtube_video_id`**"*.

**Half true, and the conclusion is wrong.** TRUE: `YoutubeVideoAsset` has exactly two fields (`youtube_video_id`, `youtube_video_title`), accepts **no bytes and no URL**, and `AssetService` will not fetch one. (Also true and worth killing as a fallback: the legacy `MediaFile` path **never** accepted video bytes — `MediaImage.data` and `MediaBundle.data` exist, but **`MediaVideo` has no bytes field at all**. True since the AdWords era; unchanged in v24.)

**FALSE — that this forces a YouTube channel + the YouTube Data API.** The Google Ads API ships **`YouTubeVideoUploadService.CreateYouTubeVideoUpload`**, which **accepts raw video bytes over a resumable REST protocol**:

```
POST https://googleads.googleapis.com/resumable/upload/v24/customers/{CID}/youTubeVideoUploads:create
  X-Goog-Upload-Protocol: resumable
  X-Goog-Upload-Command: start | upload | query | finalize
  X-Goog-Upload-Header-Content-Length: {FILE_SIZE}
  X-Goog-Upload-Offset: {byte offset}
```

- **`channel_id` omitted ⇒ the video uploads to a Google-managed YouTube channel** tied to the Ads account. **We do not need to own a YouTube channel, and we do not need the YouTube Data API at all.** Trade-off: no YouTube analytics, no view-based remarketing, no appeals on that asset, and privacy is forced **`UNLISTED`**.
- `channel_id` supplied ⇒ our own brand channel; **user-auth only, not service accounts** — our OAuth refresh-token flow qualifies; **`PUBLIC`** becomes available.
- **Poll `state`: `PENDING → UPLOADED → PROCESSED`** before the video is usable (same async shape as Meta's `video_status='ready'`).
- **[OFFICIAL constraint]** *"Uploading videos with the Google Ads API is only supported with the Python client library and by using REST."* — **REST is supported, so our Deno/TypeScript edge adapter can do this natively** (we call REST anyway; we use no client library).

**Net path:** `Bunny bytes → fetch in edge → resumable REST upload → poll to PROCESSED → youtube_video_id → YoutubeVideoAsset → link`. Real work (resumable chunking + polling), **not the blocker the spec records**. **Reject the YouTube Data API alternative** (`videos.insert` ~100 units since 2025-12-04, but capped at ~**100 uploads/day** in its own bucket, needs a separate `youtube.upload` scope + channel + OAuth consent — strictly worse). **#866 OD-2 should be closed with this finding.**

#### The Snapchat upload path — the spec's flow does not exist

**#866's `uploadToSnap` posts `.../media/{media_id}/upload_from_url` with a Bunny Stream URL. Snap documents no `upload_from_url` endpoint.** The real paths:

| Path | Endpoint | Constraint |
|---|---|---|
| Standard | `POST /v1/media/{media_id}/upload` | **`multipart/form-data`, NOT JSON. ≤ 32 MB.** |
| Chunked | `POST /v1/media/{media_id}/multipart-upload-v2` | **> 32 MB.** 3 phases: **INIT → ADD → FINALIZE**. **Max 32 chunks × 32 MB = 1 GB.** |

**Compounding: Bunny Stream serves HLS, not a single downloadable MP4** — so there is no URL to hand Snap even if the endpoint existed.

**Build:** (a) resolve a **direct MP4 rendition** from Bunny (or keep an MP4 master in Supabase Storage); (b) **stream the bytes** into a `multipart/form-data` POST from the edge function; (c) **branch to chunked at >32 MB** with INIT/ADD/FINALIZE + per-chunk retry; (d) **poll `media_status` until `READY`** before creating the creative (a creative referencing `PENDING_UPLOAD` media will fail); (e) poll creative `packaging_status` → `SUCCESS`. **This is the single largest under-scoped work item in the Snap lane.** Note Deno edge memory/time limits — a 1 GB chunked upload may need a different runtime.

#### The Reddit creative path — it's a post, and it's an async job

**Reddit's ad IS a promoted post.** `ad.post_id` → a real `t3_` post authored by a `t2_` profile. **There is no standalone creative object bound to the ad.** The modern path:

```
POST /profiles/{t2_…}/structured_posts/jobs   → job id
  poll GET /structured_posts/jobs/{id}
    QUEUED | PROCESSING → keep polling (bounded backoff)
    SUCCESS      → a t3_ post exists
    CLIENT_ERROR → fix the creative config and create a NEW job (not retryable as-is)
    SERVER_ERROR → retry later
POST /ad_accounts/{a2_…}/ads  { post_id: "t3_…", profile_id: "t2_…", … }
```

`creative` is a **5-way `oneOf`**: `ImageCreative` (needs `type, destination, headline, image`) · `VideoCreative` (`video, thumbnail, type, headline, destination`) · `TextCreative` (`type, body, headline, text_format`) · `CarouselCreative` (`carousel, type, headline`) · `PromotedPostCreative` (`type, headline, post`).

**The poll makes `createAd` long-running and non-atomic** — it must land inside #862's compensating-rollback envelope. And **rollback is `PATCH configured_status: "DELETED"`, not DELETE — there is no DELETE verb for campaign/ad_group/ad.**

**Schema vs guide conflict:** `CarouselCreative.carousel` is **`minItems: 1, maxItems: 6`** [SPEC]; the guide says *"Between 2–7 creatives must be added."* **Trust the schema (1–6) and let the API 400 decide; do not encode 2–7.**

**Buttons.** `Back`. `Validate` (re-runs the byte-probe; toast: *"Ready on 4 of 4 channels."* / *"2 problems to fix."*). `Next` → Copy; disabled with *"Fix the creative problems above first."*

---

### 1.6 · Step 6 — Copy

**Screen:** "What does it say?" — **one shared composer** with **per-channel counters and a live truncation preview**.
**Purpose:** write once, see exactly what each channel will do to it, and never discover a character limit from a rejection.

**[DESIGN DECISION] One composer, per-channel counters, per-channel hard caps — never one shared cap.** #864 renders **Meta** soft-caps (primary ~125, headline ~40) as amber hints. **125 > TikTok's hard 100** — so **our UI actively guides admins into a TikTok validation error.** And #863 states *"Character limits: NONE stated"*. #866 has none.

#### Fields

| Label | Type | Default | Required | Feeds |
|---|---|---|---|---|
| **Primary text / body** | textarea + per-channel counters | — | Yes | Meta `message`, TikTok `ad_text`, Reddit headline |
| **Headline** | text | — | Yes | Meta `title`, Snap `headline`, Google RSA headline #1 |
| **Description** | text | — | No | Meta `link_description`, Google RSA description #1 |
| **Google headlines** | repeatable, **3–15** | seeded from Headline | **Yes for Google** | RSA `headlines[]` |
| **Google descriptions** | repeatable, **2–4** | seeded from Description | **Yes for Google** | RSA `descriptions[]` |
| **Keywords** | chips | — | **Yes for Google Search** | `AdGroupCriterion.keyword` |
| **Negative keywords** | chips | — | No | |
| **CTA** | select, per-channel enum | `LEARN_MORE` | Yes | |
| Brand name | text | from Public Profile | No | Snap `brand_name`, Google `business_name` |

#### The exact per-channel character limits

| Field | Meta | TikTok | Snapchat | Google | Reddit |
|---|---|---|---|---|---|
| **Primary / body** | **≤1024 hard** [OFFICIAL API max]; **warn >125** (mobile-feed truncation), **warn >60** (FB Reels overlay) | **`ad_text` ≤100 hard, NO EMOJI** | — | — | `body` **≤40,000** [SPEC]; headline **no schema limit** ⚠ |
| **Headline** | **≤255 hard**; warn **>27** (FB Feed), **>40** (IG), **>10** (FB Reels overlay) | — | **≤34 hard** | RSA **≤30 hard**; Demand Gen **≤40**; PMax `LONG_HEADLINE` **≤90** | policy **≤300**; warn **>100**, warn **>80** |
| **Description** | **≤255 hard**; warn >30 (Marketplace) | — | — | RSA **≤90 hard** (**max 4**); PMax **≤90** (**max 5**, **≥1 must be ≤60**) | — |
| **Brand / business name** | — | `display_name` **1–40 Latin / 1–20 CJK** | **`brand_name` ≤32** ⚠ | **≤25** | — |
| **Entity name** | — | **≤512, no emoji** (campaign/adgroup/ad) | **≤375** | ≤256 | **3–500** |
| **Other** | — | `disclaimer_text` ≤90; `disclaimer_clickable_texts` ≤40 each **and** ≤40 combined, max 3 | `preview_headline` ≤55; `app_name` ≤30; `message` ≤160 | `path1`/`path2` **≤15**; sitelink `link_text` ≤25, `description1/2` ≤35; callout ≤25 | `caption` **≤180** [SPEC]; `supplementary_text` **≤100** (display tip) |

⚠ **Discrepancy flagged:** the brief cites Snap `brand_name ≤25`; the research (`snapchat.md` §4b field table **and** §5 text limits, twice) says **32**. **Encoding 32.** Google RDA `business_name` is 25 — likely the source of the conflation. Confirm live.
⚠ **Reddit's headline trap** — three facts that only matter together: (1) the API enforces **no** headline maxLength for IMAGE/VIDEO/TEXT/CAROUSEL [SPEC]; (2) the policy limit is **~300** [3P]; (3) `rejection_reason` includes **`EXCEEDING_CHARACTERS`** [SPEC]. **An over-length headline passes create with a 201, then fails review hours later, burning a review cycle. Headline validation is ours or we eat the rejection.**

#### The counting rules

| Rule | Applies |
|---|---|
| **CJK/Japanese words count as 2 characters; each Latin letter counts as 1** [TikTok, verbatim] | `ad_text`, `ad_name`, `campaign_name`, `adgroup_name` |
| **"Every character in a double width language like Korean, Japanese, or Chinese counts as 2 characters"** [Google] | RSA headlines (→ effective 15) / descriptions |
| **Punctuation and spaces count** [TikTok] | names, descriptions |
| Emoji and `{ } #` **not supported** [TikTok] | names/descriptions |

**Not a concern for US/UK/NG today — but the validator counts by weight, not `.length`.**

#### Validation and messages

| Rule | Level | Message |
|---|---|---|
| Meta primary >1024 | **Reject** | *"Facebook's hard limit is 1,024 characters. You're at {n}."* |
| Meta primary >125 | **Warn** | *"Past about 125 characters Facebook shows a 'See more' link on mobile — your first line is doing all the work. ({n} characters.)"* — note: truncation is **line-wrap/render-driven, not a fixed character index**; it varies by device. **Warn, never reject at 125.** |
| Meta headline >255 / >27 | Reject / Warn | *"Facebook's hard limit is 255. You're at {n}."* / *"Facebook Feed shows about 27 characters of a headline. Yours is {n} — the rest gets cut."* |
| **TikTok `ad_text` >100** | **Reject** | *"TikTok's limit is 100 characters and it's a hard one — you're at {n}. Trim it."* |
| **TikTok `ad_text` contains emoji** | **Reject + explain the workaround** | *"TikTok doesn't allow emoji in ad text on a normal ad. We stripped them for the TikTok version — the other channels keep them. (Emoji only work on TikTok through Spark Ads, which use the original post's caption.)"* |
| Snap headline >34 | **Reject** | *"Snapchat's headline limit is 34 characters. You're at {n}."* |
| Snap brand_name >32 | Reject | *"Snapchat's brand name limit is 32 characters."* — **note: leaving `brand_name` null is often *safer*; it defaults to the Public Profile's brand name, which guarantees a policy match.** |
| Google <3 headlines | **Reject** | *"Google needs at least 3 headlines — it mixes and matches them. Give it 15 if you can; more combinations means better performance."* |
| Google headline >30 | Reject | *"Google headlines cap at 30 characters. '{headline}' is {n}."* |
| Google <2 descriptions | **Reject** | *"Google needs at least 2 descriptions (max 4)."* |
| Google description >90 | Reject | *"Google descriptions cap at 90 characters."* |
| **PMax: no description ≤60** | **Reject** | *"Performance Max needs at least one description of 60 characters or less."* (`AssetGroupError.SHORT_DESCRIPTION_REQUIRED`) |
| **Google Search with no keywords** | **Reject** | *"A Google Search campaign without keywords can't really serve. Add a few — we suggest starting with the venue name, the neighbourhood, and what people would type to find this kind of night out."* |
| Google keyword >80 chars / >10 words | Reject | *"Google keywords cap at 80 characters and 10 words."* (`KEYWORD_HAS_TOO_MANY_WORDS`) |
| Google >3 enabled RSAs per ad group | Reject | *"Google allows 3 enabled responsive search ads per ad group."* |
| **Editorial tripwires (Google + Reddit)** | **Reject** | *"Drop the ALL CAPS / the extra exclamation marks — both Google and Reddit reject ads for it. (Reddit literally has a rejection reason called CAPITALIZATION.)"* Google issues a warning **≥7 days** before suspension. |
| Reddit headline >300 / >100 / >80 | Reject / Warn / Warn | *"Reddit's policy limit is 300 characters — you're at {n}, and it'll pass create then get rejected hours later."* / *"Over ~100 characters starts reading like an ad. Reddit punishes that."* |
| **Reddit `display_url` domain ≠ destination domain** | **Reject** | *"Reddit requires the shown link to match where it actually goes."* |
| Reddit CTA case | **Reject** | See below. |

#### ⚠ Reddit's CTA enum is Title-Case display strings — and a shared normalizer will 400 on it

**[SPEC]** the 24 values are literally: `Apply Now · Contact Us · Download · Get a Quote · Get Showtimes · Install · Learn More · Order Now · Play Now · Pre-order Now · See Menu · Shop Now · Sign Up · View More · Watch Now · Book Now · Buy Tickets · Get Directions · Listen Now · Read More · Subscribe · Visit Store · Donate Now · Remind Me · null`

**Not `BUY_TICKETS`.** Unlike every other Reddit enum, and unlike Meta/TikTok/Snap CTA enums. **Any generic `toUpperCase()`/snake-case normalizer in a shared `adChannel.ts` layer will produce a 400 here.** Unit-test that the Reddit CTA is never uppercased.

#### The CTA map — and Reddit's is the best fit we have

| Mingla offering | Meta | TikTok | Snapchat (`WEB_VIEW`) | Google | Reddit |
|---|---|---|---|---|---|
| Ticketed event | **`BUY_TICKETS`** ⚠ *(`GET_TICKETS` is **not** a real enum value — #862 §4.0's mapping is correct)* | `Get ticket now` | **`BUY_TICKETS`** | (RSA has no CTA field) | **`Buy Tickets`** |
| Bookable offering | `BOOK_NOW` | `Book now` | **`BOOK_NOW`** | — | **`Book Now`** |
| Restaurant | `GET_DIRECTIONS` | `Learn more` | `VIEW_MENU` | — | **`See Menu`** |
| Venue | `GET_DIRECTIONS` | `Learn more` | `BOOK_NOW` | — | **`Get Directions`** |
| Upcoming event | `EVENT_RSVP` | `Get showtimes` | `SHOWTIMES` | — | **`Remind Me`** |
| Default | `LEARN_MORE` | **`Learn more`** (TikTok's default) | `MORE` | — | `Learn More` |

**⚠ `VIEW_MORE` is not a valid Snapchat CTA on any type. Our #867 spec sends it — the creative create will reject.** The `WEB_VIEW` enum has 23 values; the nearest are **`MORE`**, **`VIEW`**, **`BOOK_NOW`**, **`BUY_TICKETS`**. **Default to `BOOK_NOW` or `BUY_TICKETS` for reservation traffic** (far higher intent than `MORE`). Expose the enum as a select, **not a free string**.

**Reddit's CTA set is a richer, better fit for Mingla than any other channel's** — `Buy Tickets` + `Book Now` + `See Menu` map cleanly onto our three offering types.

**⚠ `call_to_action_type` is not an RSA field at all.** #864 collects it and passes it to Google. Google Search ads have no CTA button. Drop it from the Google payload.

**Note:** TikTok's `call_to_action` is a **bare string with no enum** in the MCP schema, and `call_to_action_id` (CTA portfolio) **wins over** `call_to_action` if both are set. CTA text is **auto-translated** to the viewer's app language. App-download destinations have only **4** CTAs: `Download`, `Learn more`, `Listen now`, `Play game`.

#### The live truncation preview

Under the composer, a per-channel strip showing **exactly what renders**:

```
Facebook Feed      "Sold-out energy, Tuesday night. The room only holds 40 and…"   [See more]
Instagram Feed     "Sold-out energy, Tuesday night. The room only holds 40 and…"
FB Reels overlay   "Sold-out energy, Tuesday…"                          headline: "Book the ni…"
TikTok             "Sold-out energy, Tuesday night. The room only holds 40."   ✓ 56/100  (2 emoji stripped)
Snapchat           headline: "Sold-out energy, Tuesday nigh"            ✓ 30/34
Google RSA         H1 "Book Tuesday at Lorne"  H2 …  (3 of 15 — add more)
Reddit             "Sold-out energy, Tuesday night…"                    ✓ 56  (warn >80)
```

**Buttons.** `Back`. `Next` → Preview.

---

### 1.7 · Step 7 — Preview & policy pre-check

**Screen:** "Here's what it'll actually look like — and what might get it rejected."
**Purpose:** the cheapest possible mitigation for every creative and copy risk in §1.5–§1.6. **This is the highest value-per-line-of-code in the entire build.**

#### 7a · Real previews, from the platforms

**[GAP]** Ad preview appears in **none** of #862 / #864 / #866. It exists and is free.

| Channel | How | Formats |
|---|---|---|
| **Meta** | `GET /{ad_id}/previews?ad_format=…` (MCP: `ads_get_ad_preview`). Returns `preview_html` (iframe), `preview_url`, the creative image, and creative details. | **`DESKTOP_FEED_STANDARD`, `MOBILE_FEED_STANDARD`, `INSTAGRAM_STANDARD`, `INSTAGRAM_STORY`, `INSTAGRAM_REELS`, `RIGHT_COLUMN_STANDARD`, `MESSENGER_MOBILE_INBOX_MEDIA`, `THREADS_STREAM`** |
| **TikTok** | `creative_ads_preview_create` (+ `smart_plus_ad_preview`) | in-feed |
| **Snapchat** | **No documented preview endpoint.** Rely on the safe-zone overlay (below). | — |
| **Google** | No API preview for RSA. Surface `ad_strength` instead (below). | — |
| **Reddit** | **`preview_url`** on the ad (valid while `preview_expiry` holds; set `preview_expiry: null` to disable). Append **`?comment_ad={{Preview ID}}`** to a post URL to preview the **conversation placement**. | feed + comments |

> **Why this matters more than anything else in §1.5.** The Meta preview **renders the actual crop and the actual truncation, per placement, before spend.** It directly answers *"will the 35% bottom safe zone eat our CTA?"* without building a crop analyzer. **Everything is created PAUSED, so calling previews after create is safe.**

**Build:** after create, call previews for **`MOBILE_FEED_STANDARD` + `INSTAGRAM_STORY` + `INSTAGRAM_REELS`** (Meta), TikTok's preview, and Reddit's `preview_url` (both placements), and render them **before** the operator clicks Launch.

**Where no preview exists, draw one:** a safe-zone overlay on the creative — Meta 9:16 marks `y < 269px` and `y > 1248px` on a 1080×1920 canvas (14% / 35%); Snap marks `y < 150` and `y > 1770`; Reddit marks the bottom 20%. Also expose Snap's **`top_snap_crop_position`** (`OPTIMIZED` default **silently crops** off-ratio media — `MIDDLE`/`TOP`/`BOTTOM` are the alternatives).

#### 7b · Our own policy pre-check — what we CAN predict

**Meta's Personal Attributes rule — the #1 copy-rejection cause, and it is pointed straight at our voice.**

**[OFFICIAL, near-verbatim]:** *"Ads must not contain content that asserts or implies personal attributes. This includes direct or indirect assertions or implications about a person's race, ethnicity, religion, beliefs, age, sexual orientation or practices, gender identity, disability, physical or mental health (including medical conditions), vulnerable financial status, voting status, membership in a trade union, criminal record, or name."*

**The mechanism:** it does not matter what your targeting is. What matters is whether the **copy speaks at the viewer in a way that presumes to know something personal**. **Second-person + attribute = violation. The interrogative form ("Are you…?", "Do you have…?") is the single most common violating pattern Meta itself calls out.**

**Mingla's exposure is real, not theoretical.** Our canonical voice is second-person and social. *"Meet people near you"* is **fine** (no attribute). *"Meet other single people near you"* edges toward relationship-status inference. **"Tired of being alone?" is a presumed emotional/social state — high risk.**

**The linter (warn, never hard-block — false positives on a social product are guaranteed):**

| # | Pattern | Flag |
|---|---|---|
| 1 | `/\b(are\|do\|did\|have\|has\|is)\s+(you\|your)\b/i` | *"'Are you…?' phrasing is the pattern Meta rejects most. It reads as though we know something about the person. Try stating it instead of asking it."* |
| 2 | `you\|your` within N tokens of a protected-attribute term (race / ethnicity / religion / age-cohort / orientation / gender-identity / disability / health / financial status / voting / union / criminal record) | *"This line points a personal attribute at the reader. Meta rejects that even when the targeting is fine."* |
| 3 | Presumed-state phrasings: *"tired of…", "struggling with…", "still single", "getting you down"* | *"This assumes something about how the reader feels. Meta treats that as a personal attribute."* |
| 4 | Name insertion into copy | *"Never put a person's name in ad copy — Meta's example rejection is literally 'Billy Taylor, get this t-shirt with your name in print!'"* |

Ship Meta's own rejected→compliant table as **inline UI guidance**, not a docs link.

**Reddit's `DATING` rule makes our positioning a hard delivery constraint.** `rejection_reason` includes **`DATING`** plus **`DATING_DISCRIMINATORY`, `DATING_FOCUS_ON_CASUAL_SEX_PROSTITUTION_FETISHES`, `DATING_FOCUS_ON_INFIDELITY`, `DATING_MAIL_ORDER_BRIDE_SERVICES`**. **Mingla is explicitly not a dating app** (non-negotiable positioning). **Creative that reads "meet people" trips this on Reddit.**

> **Say "plan the night", not "meet someone."** On Reddit that's not a brand preference — it's the difference between running and being rejected under `DATING`.

**Alcohol is a live classification risk for a nightlife product.** Reddit has **7** alcohol rejection reasons (`ALCOHOL`, `ALCOHOL_GLORIFICATION`, `ALCOHOL_MINORS`, `ALCOHOL_AGE_TARGETING`, `ALCOHOL_GEO_TARGETING`, `ALCOHOL_LICENSING_AND_REGISTRATION_UK_ONLY`, `ALCOHOL_ADDICTION_AND_TREATMENT_PROGRAMS`). **`ALCOHOL_AGE_TARGETING` forces age targeting that Reddit's API cannot express** (§1.3). Google restricts alcohol. Snap restricts it. **Flag bar/nightlife creative and warn:**

> **This reads as alcohol-adjacent. Reddit can reject it for that and then require age targeting it doesn't support. Google and Snapchat both restrict alcohol too. Consider leading with the room and the music, not the drinks.**

**Google's "dating/companionship" classifier is a second, separate risk** — our social/experience copy may be mis-bucketed into a restricted vertical.

**`special_ad_categories` — collected and validated, never hardcoded to `[]`.** **[GAP]** #862 accepts it, defaults `[]`, validates nothing.

| Rule | Detail |
|---|---|
| Whitelist | `HOUSING` \| `EMPLOYMENT` \| `FINANCIAL_PRODUCTS_SERVICES` \| `ISSUES_ELECTIONS_POLITICS` \| `NONE` |
| **⚠ `CREDIT` was RETIRED** | Replaced by **`FINANCIAL_PRODUCTS_SERVICES`** effective **2025-01-14**. **Reject `CREDIT` with a migration message.** Any validator whitelisting it is stale. |
| **There is NO `ONLINE_GAMBLING_AND_GAMING` category** | Gambling is gated by a separate advertiser *authorization* flow. |
| Cascade (enforce **before** the Meta call) | Age forced **18–65**; **gender cannot be set**; radius min **15 mi / 25 km** (US+CA) or **15 km** (EU); **location exclusion not supported at all**; `subcity`/`neighborhood`/`metro_area`/`small_geo_area`/`subneighborhood`/`electoral_district`/`zips` prohibited; behavior + demographic targeting removed; **lookalikes unavailable entirely**. Also require `special_ad_category_country`. |
| `ISSUES_ELECTIONS_POLITICS` is different | Targeting is **not** stripped; instead requires creative-level `authorization_category` ∈ `POLITICAL` \| `POLITICAL_WITH_DIGITALLY_CREATED_MEDIA` (required since 2024-01-09 for AI/altered political media). **As of 2025-10-06 SIEP ads may not run in the EU at all.** |

**Mingla relevance:** we are `NONE` for event/venue traffic — but an events platform can drift into `HOUSING` (venue-hire adjacency) or `EMPLOYMENT` (a "we're hiring" promo). **Mis-declaring is an account-integrity issue, not a soft error.** Low likelihood, high blast radius.

**TikTok gives us a free pre-flight text check nobody uses:** **`blockedword_check`** / `blockedword_create` / `blockedword_task_check` — **an API-callable text check before submitting.** Also `tool_url_validate` (landing page), `file_name_check` (duplicate asset names), `playable_validate`.

**⚠ TikTok file names must be unique per advertiser** — else a duplicate-name error. Append a timestamp; use `file_name_check`.

#### 7c · What we CAN'T predict — say so

| We cannot predict | Why | What we say |
|---|---|---|
| Whether a human reviewer approves | Snap *"reserves the right to reject or remove any ad **in its sole discretion for any reason**."* | *"Every platform reviews ads by hand as well as by machine. We've checked everything a machine can check."* |
| Meta's safe-zone pixel exactness | help/980593475366490 **returned title-only on two independent fetch attempts across two agent passes**. The 14%/35%/6% figures come from the per-placement Ads Guide pages and are **internally inconsistent for FB Stories video (20% vs 35% bottom)** — a confirmed real Meta inconsistency, not a fetch artifact. | **Design to the stricter unified 14% top / 35% bottom / 6% sides.** A human should open the article logged-in before we hard-gate on those pixels. |
| Reddit's creative specs | The official ad-unit spec page (S8) is a **Salesforce Lightning SPA** returning only a CSS-error shell to non-JS clients. [3P] sources contradict each other. | **Warn-only on all Reddit pixel numbers.** Verify in a real browser or via `adsapi-partner-support@reddit.com` before hard-failing anything. |
| Reddit's review SLA | **Not stated anywhere** in the API docs or guides. | *"We don't know how long Reddit takes — nobody publishes it. We'll poll and tell you."* Measure it empirically. |
| Whether the OneLink survives review at scale | **No official Meta text found either way** [UNVERIFIED]. | Escalate to a human before spending (§1.2). |

#### 7d · Google's Ad Strength is NOT a gate — surface it, don't fail on it

**[OFFICIAL]** *"The Ad strength rating of an ad doesn't directly influence your ad's serving eligibility"* — not used in Ad Rank or Quality Score. Values: `PENDING`, `NO_ADS`, `POOR`, `AVERAGE`, `GOOD`, `EXCELLENT`. It **correlates with performance, not approval**: Poor→Excellent correlates with **+12%** conversions (`answer/9921843`) / **+15%** (`answer/6167122`); PMax Excellent ≈ **+6%**. *(Google publishes both the 12% and 15% figures — cite per-page, don't average.)*

> **Google rates this ad "Average". That's not a pass/fail — it just means more headlines would give Google more combinations to test. Ads that go from Poor to Excellent see roughly 12–15% more conversions.**

**Also surface `AssetPerformanceLabel`** (`PENDING`, `LEARNING`, `LOW`, `GOOD`, `BEST`, `NOT_APPLICABLE`) per text asset — the per-asset signal that drives "replace this headline" guidance.

**Pinning guidance:** only `HEADLINE_1..3` and `DESCRIPTION_1..2` exist — **there is no `HEADLINE_4`**. Google: *"Pinning reduces the overall number of headlines or descriptions that can be matched"* and *"isn't recommended for most advertisers and can affect ad strength."* **Best practice: pin 2–3 variants to the same position, not one static string.**

**Buttons.** `Back`. `Next` → Review.

---

### 1.8 · Step 8 — Review & launch

**Screen:** the summary, every preview, every warning, and one button.
**Purpose:** everything gets created **PAUSED**. Launch is a separate, explicit, human act.

#### The create sequence — everything PAUSED, per channel

| Channel | Created-paused mechanism | The trap |
|---|---|---|
| **Meta** | `status: 'PAUSED'` at all 3 levels; launch **top-down** (campaign → ad set → ad), each set `ACTIVE` individually — a paused parent blocks a child's delivery. | — |
| **TikTok** | `operation_status: 'DISABLE'` at all 3 levels. | **⚠ #863 internal contradiction:** §4.4 step 5 sets ad-level `operation_status: 'ENABLE'` while §2/§4.0/AC-2 mandate everything PAUSED. Harmless in effect (paused parent blocks delivery) but literally contradictory. **Fix.** |
| **Snapchat** | `status: 'PAUSED'` at all 3 levels. | — |
| **Google** | `status: 'PAUSED'`. | `REMOVED` is **permanent** — there is no un-remove. Our `ARCHIVED`/`DELETED` statuses **have no Google equivalent**. |
| **⚠ Reddit** | **`configured_status` defaults to `ACTIVE`.** | **Omitting the field publishes a live, spending campaign.** The adapter must send **`"PAUSED"` explicitly at all three levels.** **Add a strict-grep CI gate** (house pattern) asserting `_shared/reddit.ts` never constructs a create body without an explicit `configured_status`. **Cheap; prevents the worst possible bug in this system.** |

#### Atomicity — Google is the only channel that gives it for free

| Channel | Atomicity | Rollback |
|---|---|---|
| **Google** | **Native.** `googleAds:mutate` with `partial_failure=false` ⇒ **if any operation fails the entire request is rolled back and nothing is created.** This satisfies `I-PROPOSED-AD-NO-ORPHAN-WRITE` **at the provider level** — the Google adapter needs **no compensating-delete path.** Temp IDs (negative ints, unique per request, **defined before referenced**) chain the objects. Limits: **10,000** mutate ops/request; **100** "action" ops; 64 MB response cap. | none needed |
| **Meta / TikTok / Snapchat** | None — sequential creates. | Compensating delete. **⚠ Snap's cascade is unverified for creative/media** — those are **ad-account-scoped** and almost certainly **survive** `DELETE /campaigns/{id}` → orphaned creatives accumulate on every failed create. Our no-orphan invariant covers **DB** rows, not **provider-side** orphans. **Track created creative/media ids in the rollback path.** |
| **Reddit** | None, **and there is no DELETE verb.** | **`PATCH configured_status: "DELETED"`.** A3's "compensating delete" is a PATCH here. |

#### The success contract per channel — HTTP 200 does not mean success

| Channel | Envelope | The assertion |
|---|---|---|
| **Snapchat** | Batch envelope | **An HTTP 200 with `request_status: "SUCCESS"` can still carry a per-entity `sub_request_status: "FAILURE"`.** Both the outer `request_status` **and every element's `sub_request_status`** must be asserted. Checking only the HTTP code or only `request_status` **silently treats failures as successes.** (#867's `snapGraph()` gets this right — RT-3 protects it.) |
| **TikTok** | `{code, message, data}` | `code === 0` is success. |
| **Meta** | Flat object or `{error: {…}}` | — |
| **Google** | `mutate` results array | Partial-failure semantics. Capture `request_id` into `ad_status_events.provider_response` — **it's what Google support requires.** |
| **Reddit** | **Plain HTTP status codes** | No batch envelope. **201** created, 400, 401, 403, 404, 429 (+ `RateLimit` headers), 5XX. **Genuinely simpler than the other four.** |

#### The launch confirmation

```
Ready to launch across 2 channels · $20.00/day total

  Meta       $20.00/day    Paused → will go live      Link clicks
  Snapchat   —             Blocked: no Public Profile
  Google     —             Blocked: developer token is test-tier
  TikTok     —             Not available: TikTok can't target the UK
  Reddit     —             Not selected

  Destination   Tuesdays at Lorne — usemingla.com/e/lorne/tuesdays
  Creative      1 video (9:16, 14s, sound on) — cropped for 3 placements
  Copy          Checked: no personal-attribute risk, no editorial flags

  ⚠ Meta will accept this campaign but won't spend — the ad account has no
    payment method. Add billing before you expect delivery.
  ⚠ At $20/day this ad set won't reach the ~50 results/week Meta needs to
    leave its learning phase. Treat early numbers as directional.
```

**Buttons.**
- **`Create campaign (paused)`** → `admin-ad-create-campaign`. Submitting state; on success → the "Created — Paused" panel + a route to the campaign detail. Toast: *"Created on Meta. Nothing is spending yet."*
- **`Launch`** — a **separate, explicit action on the campaign surface**, never in the builder. **[#864 SC-10 / I-PROPOSED-864-CREATE-PAUSED]:** no path in the builder sets a campaign ACTIVE. Confirm modal:
  > **Launch across 1 channel? This starts spending up to $20.00/day (Meta can spend up to 175% of that on a busy day, evening out across the week). You can pause any time.**
  > `[Cancel]` `[Launch]`
- Toast on launch: *"Live on Meta. It'll be in review for about 24 hours before it starts delivering."*

#### What happens next — say it plainly

> **What happens now.** Each platform reviews the ad before it delivers: **Meta usually within 24 hours**, **TikTok usually within 24 hours**, **Google usually within 1 business day**, **Snapchat 3–5 business days** (longer for restricted categories), **Reddit — nobody publishes a number, we'll poll and tell you**. Nothing spends while it's in review. We'll check every 30 minutes and tell you the moment it's approved or rejected — and if it's rejected, we'll show you exactly why and what to change.
>
> **Any edit to the creative, the copy, the link, or the targeting sends it back to review and restarts the clock.**

*(That last line is [OFFICIAL] on Meta, TikTok, Snapchat, and Google — all four re-review on edit. On Google, "editing" a creative means **creating a new asset and relinking** — assets are **immutable**: *"to stop an asset from serving, remove the asset from the entity that is using it."*)*

---

### 1.9 · Step 9 — In-flight

**Screen:** the campaign detail + the #884 plan dashboard.
**Purpose:** know the verdict, know why, fix it, and let the Brain do its job.

#### 9a · Review-status polling — no channel pushes, all five poll

**[GAP]** #862 §4.4d syncs `status, effective_status` **only**. Sync is **manual/admin-triggered** — a `REJECTED` ad sits undetected indefinitely, and an `APPROVED` one isn't noticed either.

**Build:** a **cron-driven `admin-ad-campaign-sync`** — **every 30–60 min while any ad is pending, then daily** (for post-launch re-review, which **Meta, Snapchat, and Google all do** — a live campaign can be paused or removed later).

| Channel | Read | Statuses |
|---|---|---|
| **Meta** | `GET /{ad_id}?fields=id,name,effective_status,issues_info,ad_review_feedback,recommendations` | `effective_status` (13 values): `ACTIVE, PAUSED, DELETED, PENDING_REVIEW, DISAPPROVED, PREAPPROVED, PENDING_BILLING_INFO, CAMPAIGN_PAUSED, ARCHIVED, ADSET_PAUSED, IN_PROCESS, WITH_ISSUES` |
| **TikTok** | `ad_review_info_get` (**max 100 ad_ids/call**), `adgroup_review_info_get` | **Two-status rule:** persist **both** `operation_status` (advertiser-set) **and** the secondary/delivery status: `AUDIT`, `NOT_START`, `DELIVERY_OK`, `NO_BUDGET`, **`BALANCE_EXCEED`**. **The UI badge must read the secondary.** |
| **Snapchat** | `GET /ads/{id}` | **Two different vocabularies:** ad `review_status` ∈ `PENDING\|APPROVED\|REJECTED`; **creative** `review_status` ∈ `PENDING_REVIEW\|APPROVED` — **different enums, both needed.** Plus `packaging_status` ∈ `PENDING\|SUCCESS\|IN_PROGRESS` and `delivery_status` (array, all 3 levels). |
| **Google** | GAQL on `ad_group_ad.policy_summary` | **Google splits what Snap merges:** `approval_status` ∈ `DISAPPROVED=2, APPROVED_LIMITED=3, APPROVED=4, AREA_OF_INTEREST_ONLY=5` **and** `review_status` ∈ `REVIEW_IN_PROGRESS=2, REVIEWED=3, UNDER_APPEAL=4, ELIGIBLE_MAY_SERVE=5`. **Store both.** |
| **Reddit** | `GET /ads/{ad_id}` under `ads-campaign-management-read` (**400 req/60 s**) | **No `review_status` field exists.** Review state lives on the ad's `effective_status`: `PENDING_APPROVAL`, `REJECTED`, `ACTIVE`, `PENDING_BILLING_INFO`, `PENDING_ID_VERIFICATION`, `PROCESSING`, `MISSING_PERMISSIONS`, `INVALID_DATA_SOURCE`, `AD_GROUP_PAUSED`, `CAMPAIGN_PAUSED`, `COMPLETED`. |

**⚠ A3's `ads.review_status` column has no Reddit source field.** Map: `PENDING_APPROVAL`→PENDING, `REJECTED`→REJECTED (+ persist `rejection_reason`), `ACTIVE`→APPROVED; and `PENDING_BILLING_INFO`/`PENDING_ID_VERIFICATION`/`MISSING_PERMISSIONS`/`INVALID_DATA_SOURCE` → `delivery_status` with an admin-visible warning.

**Push exists on exactly one channel:** TikTok's `subscription_subscribe_create` (webhooks). Everything else is poll-only. Currently we poll nothing.

#### 9b · Rejection reasons — surfaced with cause AND fix

**[GAP — this is the one that makes the whole review loop unusable.]** #862 persists `effective_status` and stops. An admin sees a red "Disapproved" badge with **zero** information about why — **and the appeal path is UI-only, so the badge is a dead end.**

**⚠ The trap that made us think we couldn't read them: [LIVE] Meta's MCP `ads_get_field_context` returns `issues_info` and `ad_review_feedback` in `unknown_fields`.** They are nonetheless **first-class on the real Graph endpoint**, which our System User token calls directly. **Do not conclude from the MCP that we cannot read rejection reasons — we can, and #862 currently doesn't.**

| Channel | The machine-readable reason | Shape |
|---|---|---|
| **Meta** | **`ad_review_feedback`** + **`issues_info`** | `ad_review_feedback.global` = `map<string,string>` — *"Reasons for review disapproval across all platforms… Each reason has a key and a description"*; `.placement_specific` = per-surface maps (`facebook`, `instagram`, `marketplace`, `account_admin`, + **35 more**). `issues_info[]` = `{error_code (int32), error_message, error_summary, error_type ∈ HARD_ERROR\|SOFT_ERROR, level ∈ ad\|ad set\|campaign, mid}`. |
| **TikTok** | `ad_review_info_get` → `reject_info` | **v1.3 changes: `is_pass` → `is_approved`; `id` → `ad_id`; `reject_info` changed from an object to an `object[]`.** New: `carousel_music_content`, `music_id` — **because music is a distinct rejection axis.** |
| **Snapchat** | **`review_status_reasons`** (array of strings) | **The only machine-readable rejection signal Snap gives.** #867 drops it entirely. |
| **Google** | `policy_summary.policy_topic_entries[]` | `.type` ∈ `PROHIBITED=2`, **`LIMITED=4`**, `DESCRIPTIVE=5`, `BROADENING=6`, `AREA_OF_INTEREST_ONLY=7`, **`FULLY_LIMITED=8`**. `evidences[]` carries `TextList` / `WebsiteList` (≤5) / **`DestinationMismatch`** / **`DestinationNotWorking`**; `constraints[]` carries country constraints. |
| **Reddit** | **`rejection_reason`** (100+ value enum) | `DATING`, `ALCOHOL*` (7), `CAPITALIZATION`, `EXCEEDING_CHARACTERS`, `BROKEN_URL`, `DISPLAY_URL`, **`BRIDGE_PAGE`**, `EMAIL_GATED`, `DECEPTIVE`, `COUNTERFEIT`, `GAMBLING`, `FACILIATE_ILLEGAL_FRAUDULENT_OR_MISLEADING_BEHAVIOR` **[sic — Reddit's typo; match it verbatim]**… |

**⚠ Corrections to the brief's Google names:** **`LIMITS_SERVING` / `FULLY_LIMITS_SERVING` do not exist.** The real names are **`LIMITED`** and **`FULLY_LIMITED`**.

**⚠ Meta's `recommendations` is NOT a disapproval mechanism.** `list<AdRecommendation>` = `{code, title, message}` — it is Meta's **optimization-suggestion feed**. **Never store it in the same field as rejection reasons** — conflating them will mislead. **Do not misclassify these as rejection reasons.**

**Read order (Meta):** `effective_status` first → if `DISAPPROVED`, read `ad_review_feedback.global` for the human-readable reason map → if `WITH_ISSUES`, read `issues_info` for the structured `error_code`/`error_summary`/`error_message` (`error_type` drives severity: `HARD_ERROR` vs `SOFT_ERROR`). Note `WITH_ISSUES` means **delivering but impaired** — it was introduced specifically to pair with `issues_info`. `PREAPPROVED` = passed the initial automated check but **may still be bumped to full review or `DISAPPROVED`**.

**Build:** persist **`review_detail jsonb`** on `ads` capturing `{issues_info[], ad_review_feedback.global, ad_review_feedback.placement_specific}` (Meta), `review_status_reasons` (Snap), `rejection_reason` (Reddit), `policy_topic_entries` (Google), `reject_info[]` (TikTok). Surface **verbatim**, plus our cause→fix mapping:

| Reason | What we show |
|---|---|
| Meta Personal Attributes | *"**Meta rejected this for 'personal attributes'.** Your copy says '{line}' — Meta reads second-person plus an implied personal detail as claiming to know something about the viewer. Rewrite it as a statement about the night, not about the reader. [Edit copy]"* |
| Reddit `DATING` | *"**Reddit rejected this as a dating ad.** Mingla isn't a dating app, but '{line}' reads like one to Reddit's reviewers. Try 'plan the night' instead of 'meet someone'. [Edit copy]"* |
| Reddit `CAPITALIZATION` | *"**Reddit rejected this for capitalisation.** Drop the ALL CAPS. [Edit copy]"* |
| Reddit `EXCEEDING_CHARACTERS` | *"**Reddit rejected this for length** — the headline is {n} characters, over their ~300 limit. We should have caught this before submitting; we've added the check. [Edit copy]"* |
| Reddit `BRIDGE_PAGE` | *"**Reddit rejected the link as a bridge page** — go.usemingla.com redirects rather than being the destination. Point Reddit at the canonical page instead. [Switch to direct link]"* |
| Google `DestinationMismatch` | *"**Google rejected the destination.** The shown domain doesn't match where the link lands. Fix: put the real page in the final URL and the tracking link in the tracking template — that's Google's own sanctioned pattern. [Apply fix]"* |
| Google *unavailable offers* | *"**Google says the offer isn't available at the destination.** '{event}' looks sold out or unpublished. We've paused the campaign. [View page]"* |
| TikTok quality | *"**TikTok rejected this for creative quality.** Their reason: '{verbatim}'. TikTok's own line is: the ad must be legible, high-resolution, contain audio, and be dynamic — static images can't be more than 50% of the video."* |
| Snap `review_status_reasons` | *"**Snapchat rejected this.** Their reason, word for word: '{verbatim}'."* |
| `PENDING_BILLING_INFO` / `BALANCE_EXCEED` | *"This isn't a rejection — {channel} approved the ad but won't run it because billing isn't set up. [Fix billing]"* |

**⚠ Enforcement is not binary — TikTok, verbatim:** *"Based on various quality signals, including automated machine review, human review, and viewer engagement signals, your ad may be rejected, **receive fewer impressions, or your ad's cost-per-impression may increase**."* **Low-quality creative is taxed even when it passes.** Say so.

#### 9c · Appeals — one channel has an API, four don't

| Channel | Appeal path |
|---|---|
| **TikTok** | **API-callable:** `adgroup_appeal`, `ad_appeal`, `smart_plus_ad_appeal`. Response targeted within 24 h. *"Please only file one appeal for each incident — filing multiple appeals in a short period for the same issue will lead to delays."* |
| **Meta** | **No Marketing API endpoint exists.** UI-only: **Account Quality** → `business.facebook.com/accountquality` → "Request review". **One shot per ad** [CONSENSUS] — if the appeal is denied the ad is dead; duplicate/resubmit a new creative rather than re-appeal. **Programmatic-adjacent workaround: edit the ad via the API to force it back to `PENDING_REVIEW` for a fresh automated pass.** |
| **Google** | **Not a button — a policy exemption.** Catch the error → read `policy_topic_entries[].topic` from `policy_finding_details` (ads) / `policy_violation_details` (keywords) → set **`PolicyValidationParameter.ignorable_policy_topics`** → **resubmit the same mutate**. Only *exemptible* findings can be bypassed. **⚠ The brief's `policy_violation_key` / `exempt_policy_violation_keys` are legacy AdWords SOAP names.** UI appeal: **max 3 per ad, min 24 h apart**. |
| **Snapchat** | No API path. Ads Manager / Snap support. |
| **Reddit** | No API path. Ads Manager / `adsapi-partner-support@reddit.com`. |

**Build:** a **"Request review"** button that calls the API on TikTok, and **deep-links to Account Quality / Ads Manager** on the other four. Never fake an appeal we can't file.

#### 9d · Pause / resume

`admin-ad-set-status` → `getAdapter(platform).setStatus(conn, level, externalId, status)`, **top-down** on launch (campaign → ad set → ad), and the plan-level **kill-switch** pauses **all** child campaigns immediately (#884 SC-5 / AC-10).

- Toast on pause: *"Paused. Spending stopped."*
- Toast on plan kill: *"Plan paused — all 3 channels stopped."*
- Reddit: **`PATCH configured_status`**, not DELETE.
- Google: **never send `REMOVED`** from a pause action — it's permanent.

#### 9e · The Brain's daily reallocation

The loop (#884 §4.4b), with the guards that matter:

1. **Freshness gate → HOLD.** If any funded channel's rollup is missing or `freshness_ts` is older than the threshold (**default 26 h**) → **HOLD**: return the current allocation unchanged, write one `ad_allocation_events(action='hold')`, and **STOP**. **Never reallocate on stale or absent data.** Surface it explicitly — never a silent freeze:
   > **Holding the split — we're waiting on fresh numbers.** The last attribution data we have is from {n} hours ago, and we won't move your money based on stale numbers.
2. **CPR per channel** = `spend_c ÷ results_c`; `results_c = 0` → `CPR = ∞` (a defund candidate, subject to the guards).
3. **Exploration protection.** A channel below `min_results` or still inside its learning window is `state='exploring'` and is **not** defunded or paused this cycle. *Don't kill a channel that hasn't had a fair statistical chance.*
   > **We're leaving Snapchat's budget alone this week.** It's only had {n} results — not enough to judge it. Meta's had 300.
4. **Shift toward low CPR**, blended with an **exploration reserve** (ε default 10%, epsilon-greedy; upgradeable to Thompson sampling without touching the caller).
5. **Max daily shift ±20%** — **intersected with TikTok's real rules: ≤40% during learning / ≤30% after, and not more often than every 2 days.**
6. **Floor enforcement: pause, don't underfund.** Below floor ⇒ pinned at `floor_c` (`state='floored'`) or **paused** and redistributed. **A channel is either funded ≥ its floor or paused — never underfunded.**
7. **Conservation.** `Σ new_c == total_daily_budget_cents` **exactly**; rounding remainder to the lowest-CPR active channel; assert or abort.

> **Moved $4/day from Snapchat to Meta.** Meta is getting you a landing-page view for $0.42; Snapchat's costing $1.10. Your $20/day hasn't changed — we just moved where it goes. [Undo]

**Phase A (`recommend`)** = the cron computes and records the recommendation; the admin approves each shift. **Phase B (`auto`)** = the cron applies it. Same guardrails in both.

**⚠ The reallocation actuates through `setBudget()` — a method `ChannelAdapter` does not yet have.** #884 §10 flags it as the one coordinated #862 change. Per-adapter: **Meta** cents (CBO → campaign, ABO → ad set) · **TikTok** `budget = cents/100` via `campaign/update` or `adgroup/update` · **Snapchat** `daily_budget_micro = cents × 10,000` via PUT to the parent collection · **Google** `campaignBudgets:mutate amount_micros = cents × 10,000` · **Reddit** `goal_value = cents × 10,000` micro.

**Per-channel failure isolation:** an adapter failure records the error and **continues with the other channels**; `current_daily_budget_cents` is written **only** for channels whose `setBudget` succeeded, so DB state always mirrors platform state (**no drift**). A channel throwing `AdNotConnectedError` mid-run is auto-paused in the plan and flagged.

#### 9f · Retargeting growth

Once #865's pixel fires, the retargeting audience **grows on its own** and the Brain funds it as it crosses viability:

| Stage | Trigger | Message |
|---|---|---|
| Seeding | pixel firing, audience < 100 | *"Building your retargeting audience — {n} people so far. At 100 we can start showing ads to people who looked and didn't book. Meta needs 100 to build a lookalike too."* |
| Live | audience ≥ 100 | *"Retargeting is live — {n} people who viewed this page in the last 14 days and didn't book."* |
| Lookalike | seed ≥ 100 (quality bar 300–500+) | *"We can now build a lookalike from your {n} bookers. Starting at 1% — the closest match. (Meta's range is 1–20%.)"* |

**The Mingla-shaped BOF audience:** *"viewed an event page in the last 14 days, did not reserve"* — a website custom audience from a pixel URL rule (`/e/`, `/checkout/`) at 30d/180d retention, **minus converters**. **Exclusions are what make the funnel work:** exclude purchasers from prospecting; exclude retargeting from prospecting.

**⚠ TOF/MOF/BOF is not Meta's terminology** — no official Meta material uses it. All funnel-stage mappings are **[CONSENSUS]**, not Meta doctrine. Don't put it in the UI.

#### 9g · Creative fatigue

| Channel | The signal | The truth |
|---|---|---|
| **TikTok** | **`creative_fatigue_get`** — TikTok's own fatigue signal, **API-callable and unused by our spec.** | Refresh *"when delivery results exhibit a consistently declining trend, or when daily new users are low"* — **no fixed cadence published.** TikTok creative fatigues **faster than Meta**. |
| **Meta** | Frequency + falling CTR | Meta's own fatigue page is **qualitative only. No official numeric frequency threshold exists.** [CONSENSUS]: prospecting frequency 2.5–3.5 = watch, >4.0 = replace; retargeting tolerates 4–8. **Warn, don't automate on folklore.** |
| **Snapchat / Reddit** | — | Snap's short-form auction burns creative fast. **Reddit fatigue expresses as downvotes** — same people, same subreddits, daily. |

**⚠ "Hook rate", "thumbstop rate", "3-second hook" are [CONSENSUS] terms — NOT official Meta metrics.** They map onto real official fields: `video_p25/p50/p75/p95/p100_watched_actions`, `video_thruplay_watched_actions`. **ThruPlay IS official** (completed plays for videos ≤15s, or ≥15s watched for longer). "Hold rate" is practitioner-coined. **Use the real field names in the dashboard.**

---

## 2. The creative validation matrix

**Legend.** **REJECT** = refuse before upload. **AUTO** = we fix the bytes and tell the operator. **WARN** = ship + flag. **—** = no rule exists; **do not invent one.**

### 2.1 Meta

| Format | Constraint | Exact value | Action | Message ref |
|---|---|---|---|---|
| Image | mime | `image/jpeg` \| `image/png` (full list incl. BMP/HEIC/TIFF/WEBP; Meta *"recommend JPG or PNG"*) | **REJECT** other | §1.5 |
| Image | max bytes | **30 MB** — *all* placements, very consistent | **REJECT** | §1.5 |
| Image | min width (**API floor**) | **600 px** (*"we require ≥600px width"*) ⚠ conflicts with the 500 px UI figure — **use 600** | **REJECT** | |
| Image | min dims, FB Feed | **600 × 750** | **REJECT** | |
| Image | min, Right Column | **254 × 133** | REJECT | |
| Image | min, Search / In-Stream | **600 × 600** | REJECT | |
| Image | min, Audience Network Native | **398 × 208** *(this page also labels the ratio "9:16", numerically inconsistent with 398×208 ≈ 1.91:1 — an internal Meta page inconsistency)* | REJECT | |
| Image | recommended | **1440 × 1800** (4:5 feed) · **1440 × 2560** (9:16 vertical) — **not** the 1080×1080/1080×1920 cited by most blogs | **WARN** | |
| Image | ratio | ∈ {**4:5**, **1:1**, **1.91:1**, **9:16**}, tolerance **±3%** (Feed/Search/In-Stream) · **±1%** (IG Feed/Stories/Reels) | **REJECT** off-list · **WARN** near-tolerance · **AUTO** crop from master | §1.5 |
| Image | static GIF | not in the supported list; no explicit denial → **treat as unsupported** | REJECT | |
| Image | sRGB / colour profile | **[UNVERIFIED]** — blog claim only, on no official page | **—** | |
| Video | container | **MP4** or **MOV** | **REJECT** | |
| Video | codec | **H.264, square pixels, fixed frame rate, progressive scan, stereo AAC ≥128 kbps** *(verbatim, repeats on every placement page)* | **WARN** (can't always probe) | |
| Video | audio sample rate | **44,100 Hz** stereo | WARN | |
| Video | fps | **≤ 30** | WARN | |
| Video | max bytes | **4 GB** (all Ads Guide placements) ⚠ an IG ads-api doc gives **2.3 GB** + 3–60 s — likely a distinct ingestion path; **flagged, unreconciled** | **REJECT** | |
| Video | duration | **Per placement.** Under Advantage+ placements enforce the **intersection: min 5 s** (FB In-Stream floor) **max 180 s** (FB Stories 3-min ceiling) | **REJECT** | §1.5 |
| Video | **bitrate** | **NO RULE — no official number exists.** "5–10 Mbps" is folklore | **— DO NOT BUILD** | |
| Video | thumbnail | `poster_url` **required** (#866 OD-4 DB CHECK). **No fixed official pixel resolution exists** (confirmed absence, not a fetch failure) — match the video's ratio | **REJECT** if absent | |
| Video | captions | optional/recommended; FB In-Stream + Reels *"strongly recommended"*; **Audience Network: captions NOT supported**. `.srt`, named `filename.[lang]_[country].srt` | WARN | |
| 9:16 | **safe zone** | **top 14% / bottom 35% / sides 6%.** At 1080×1920: **269 / 672 / 65 px**; usable band **950 × 979** | **WARN** (can't reliably auto-detect text position) | §1.5 |
| 9:16 | ⚠ conflict | **FB Stories has two conflicting official safe-zone specs** — the Image page says **35%** bottom, the Video page says **20%**. Confirmed real Meta inconsistency. **Design to the stricter unified 14/35/6.** | | |
| **Text density (20% rule)** | **DEAD — removed ~Sept 2020** | Directly confirmed absent from `transparency.meta.com/policies/ad-standards/` (fetched; contains **no** language about text-in-image ratios at all). Text Overlay Tool retired at the same time. | **— DO NOT BUILD** | |
| Carousel | cards | **2–10** | **REJECT** | |
| Carousel | ratios | 1:1 (FB Feed) · 1:1/3:4/4:5 (IG Feed) · 9:16 (IG Stories); **API hard floor 600×600** | REJECT | |
| Carousel | video codec | **NOT FOUND on any official carousel page** — do not assume H.264 without a check | **—** | |
| Carousel | structure | Primary text is set **once at ad level** (applies to all cards); headline + description are **per-card** | | |
| Collection | Instant Experience | **MANDATORY** (2 independent sources) | **REJECT** if absent | |
| Collection | cover ratio | **1.91:1 to 1:1 — including IG Stories Collection** (**NOT** 9:16; verified) | REJECT | |
| Collection | rotation pool | **≥4 unique items** (`collection_thumbnails` requires 4) — reconciles the "3 displayed vs 4 required" apparent conflict | REJECT | |
| Copy | primary text | **≤1024 hard** [OFFICIAL API max] · **warn >125** · **warn >60** (Reels overlay) | REJECT / WARN | §1.6 |
| Copy | headline / description | **≤255 hard** · warn **>27** (FB Feed) / **>40** (IG) / **>10** (Reels overlay) | REJECT / WARN | §1.6 |
| Link | scheme | `https://` (auto-prepend, then re-validate) | **AUTO** → REJECT | |
| CTA | enum | the official list; **`GET_TICKETS` → `BUY_TICKETS`** | REJECT unknown | §1.6 |

**Video duration per placement [OFFICIAL]:** FB Feed 1 s–**241 min** *(unusual but verified twice)* · IG Feed 1 s–60 min · **FB Stories 1 s–3 min** · IG Stories 1 s–60 min · **IG Reels 0 s–15 min** · **FB Reels — "No maximum limit"** *(re-verified directly)* · FB In-Stream desktop 5–15 s / mobile 5 s–10 min · Audience Network Native/Banner/Interstitial 1–120 s · AN In-stream 5–30 s · AN Rewarded 3–~60 s.

> **⚠ Reels have no 60 s / 90 s cap.** Third-party sources claiming one are stale or conflating organic-Reels history. **Official: IG Reels = 15 min; FB Reels = no max. Do not hardcode 60/90.**

### 2.2 TikTok

| Format | Constraint | Exact value | Action |
|---|---|---|---|
| Video | **ratio** | **9:16 (vertical) · 1:1 (square) · 16:9 (horizontal)** — nothing else | **REJECT** · **AUTO** crop |
| Video | min res — vertical | **540 × 960** | **REJECT** (**WARN** below 720×1280) |
| Video | min res — horizontal | **960 × 540** | REJECT |
| Video | min res — square | **640 × 640** | REJECT |
| Video | recommended | **≥ 720 × 1280 (720p)** — *"at least 720P resolution"* | WARN · **AUTO** upscale (Smart Fix → 1280×720) |
| Video | container | **.mp4, .mov, .mpeg, .3gp, .avi** | REJECT |
| Video | **duration — POLICY** | **min 5 s, max 60 s** ← *Ad Format and Functionality policy* | **REJECT** |
| Video | duration — technical | *up to 10 minutes* | **⚠ THE TRAP: a 3-minute video uploads fine, creates fine, and then gets rejected in review. Enforce 5–60 s, not 10 min.** |
| Video | duration — optimal | **9–15 s** [CONSENSUS]; GAB doc recommends **21–30 s** | — |
| Video | max bytes | **≤ 500 MB** | REJECT |
| Video | bitrate | **≥ 516 kbps** (TopView: **> 2500 kbps**) | REJECT |
| Video | codec / fps | **Not specified by TikTok.** H.264/AAC in MP4 @30 fps = safe default | **—** |
| Video | **audio** | **REQUIRED** — *"The ad must contain audio and it must not be of poor quality, such as having unclear or muffled sound."* | **REJECT** |
| Video | static content | *"Static images should not occupy more than 50% of the video"* | WARN |
| Video | **watermarks** | *"Blurred or masked third-party watermarks"* — **prohibited** | **REJECT** |
| Video | **black bars / letterbox** | Not named as a distinct policy line, but caught by *"must not use columns or pixels to partially cover images"* + *"legible and of a high resolution"* + the standard-video-size requirement. **A 16:9 asset letterboxed into 9:16 is the single most common auto-reject in practice.** | **REJECT** |
| Video | safe zone | **A function of caption length, not a constant** — *"The safe zone size is determined by the ad caption length and any Interactive Add-on usage; the longer the caption, the smaller the safe zone."* Engineering defaults at 1080×1920: keep key elements out of **top ~130 px**, **bottom ~480–560 px**, **right ~120 px** (action rail). **These are our defaults, not TikTok constants.** | **WARN** |
| Video | background | *"Avoid using transparent or white background… nicknames, ad captions, and music captions may not be visible, because the text color and UI icons on the TikTok app are white."* | WARN |
| Image | formats | **.jpg, .jpeg, .png** | REJECT |
| Image | res | **9:16 ≥720×1280** · **16:9 ≥1280×720** · **1:1 ≥640×640** | REJECT |
| Image | max bytes | **≤ 100 MB** (TikTok/GAB image ad) | REJECT |
| Carousel image | max bytes | **≤ 100 KB suggested** ⚠ **note the 1000× discrepancy with the 100 MB GAB figure — both are TikTok's own numbers. Validate per-format.** | WARN |
| Carousel | count | **2–35 images** (schema says 1–35; the help doc says min 2 — **trust the help doc: a 1-image "carousel" will fail**); **2–20 shown** | REJECT |
| Carousel | resolutions | Horizontal **1200 × 628** · Square **640 × 640** · Vertical **720 × 1280** | REJECT |
| Carousel | **music** | **REQUIRED.** `.mp3, .wav, .m4a, .flac`; **≤10 MB**; **≥2 s**; loop playback. Standard: CML **or** upload. VSA: **upload only** | **REJECT** |
| Carousel | caption / CTA / URL | **One caption + one CTA + one URL for ALL images** (Standard) | — |
| **Cover** | `SINGLE_VIDEO` | **exactly 1 image, SAME aspect ratio as the video** (`image_ids`) | **REJECT** |
| Avatar | `avatar_icon_web_uri` | **1:1 required** | REJECT |
| Profile photo | dims / bytes / safe zone | **98 × 98 (1:1)** · **< 50 KB** · **66 × 66 px centre** ← *the one hard TikTok safe-zone number* | REJECT |
| Copy | `ad_text` | **≤100 chars, NO EMOJI** (CJK ×2) | **REJECT** |
| Copy | names | `ad_name`/`campaign_name`/`adgroup_name` **≤512, no emoji** | REJECT |
| Copy | `display_name` | **1–40 Latin / 1–20 CJK** — **required** for landing-page / pure-exposure promotion | REJECT |
| Copy | `app_name` | **1–40** (required if the store name > 40) | REJECT |
| Pangle | video / image / banner / carousel / playable | 1280×720, 720×1280, 720×720 · ≤500 MB · images 1200×628/640×640/720×1280 ≤100 MB · **banner-exclusive 600×500, 640×200, 640×100** · carousel **up to 50** · **playable .zip ≤5 MB** | REJECT |
| Playable | TikTok placement | **⚠ Since 2024-09-30 Playable Ads can no longer be created for TikTok placement** | REJECT |

**Free auto-fix available now:** `file_video_ad_upload` with **`flaw_detect=true` + `auto_fix_enabled=true`** auto-fixes **only** `LOW_RESOLUTION` (→1280×720) and `ILLEGAL_VIDEO_SIZE` (→1:1/9:16/16:9), since 2025-04-24; returns `fix_task_id` + `flaw_types`; one fixed version; **`auto_bind_enabled`** uploads the fixed video to the library. **If flaws are detected and `auto_fix_enabled=false` → the API returns an error with the flaw types.** Plus `creative_auto_enhancement_strategy_list` ∈ `VIDEO_QUALITY, MUSIC_REFRESH, IMAGE_QUALITY, **IMAGE_RESIZE**`. **Turn both on. Neither touches duration, watermarks, black bars, or safe zones.**

### 2.3 Snapchat

| Format | Constraint | Exact value | Action |
|---|---|---|---|
| Top Snap — Video | ratio | **9:16 exact** — `\|w/h − 0.5625\| ≤ 0.01` | **REJECT** `invalid_aspect_ratio` |
| Top Snap — Video | resolution | **1080 × 1920** (reject below) | **REJECT** `invalid_resolution` |
| Top Snap — Video | max bytes | **≤ 32 MB** standard · **≤ 1 GB** chunked (**max 32 chunks × 32 MB**) | **REJECT** `video_too_large` |
| Top Snap — Video | container / codec | **MP4, MOV** · **H.264** [secondary] | REJECT |
| Top Snap — Video | **duration** | **3–180 s** ⚠ Snap's media doc table renders max as **1800 s** (30 min) — that most likely covers `LONGFORM_VIDEO`. **Validate 3–180 s for the Top Snap lane and confirm live.** | **REJECT** `invalid_duration` |
| Top Snap — Video | **audio** | **REQUIRED. 2 channels (L/R), balanced, target −16 LUFS. Silent / text-only video is auto-rejected as "Low-Quality Creative."** | **REJECT** `missing_audio` |
| Top Snap — Image | ratio / res / bytes / format | **9:16** · **1080 × 1920** · **≤ 5 MB** · **PNG, JPG** | **REJECT** `image_too_large` — ⚠ **#864's bucket allows 30 MB = 6× this** |
| **Safe zones** | top / bottom | **Top 150 px** and **bottom 150 px** free of logos/text/disclaimers (Snap UI chrome). Usable band on a 1920 canvas: **y ∈ [150, 1770]** | **WARN** (pixel policy; no API field expresses it) |
| Safe zones | Collection hero | **bottom 450 px** free of text/complex visuals (product tiles overlay it) → hero band **y ∈ [150, 1470]** | WARN |
| Preview / Story tile | ratio / min / bytes / format | **3:5** · **min 360 × 600** · **≤ 2 MB** · **PNG** | REJECT |
| Logo | dims | **993 × 284** · PNG | REJECT |
| App icon | Snap Ads / Lens | **200–2000 × 2000 (1:1)** / **256 × 256 (1:1)** · PNG | REJECT |
| App end card | dims / bytes | **1080×1920 or 1920×1080** · **≤ 1 MB** · JPG/PNG · **2–10 cards** | REJECT |
| Playable | bytes | **≤ 5 MB** · ZIP | REJECT |
| Chat wallpaper | dims | **1080 × 1920** IMAGE | REJECT |
| Collection | structure | **hero + exactly 4 product tiles** (`interaction_zone_id`), each tappable; fallback interaction required | REJECT |
| Story ad | structure | tile **3:5 (min 360×600, ≤2 MB PNG)** + **3–20 snaps** [secondary for the count] | WARN |
| Composite | `creative_ids` | **1–20** | REJECT |
| Copy | `headline` | **≤ 34** | **REJECT** `headline_too_long` |
| Copy | `brand_name` | **≤ 32** — **leaving it null is often safer** (defaults to the Public Profile's brand name → guaranteed policy match) | REJECT |
| Copy | `preview_headline` / `app_name` / `message` | **≤ 55** / **≤ 30** / **≤ 160** | REJECT |
| Copy | `name` (campaign/squad/ad/creative) | **≤ 375** | REJECT |
| Link | `web_view_properties.url` | **SSL-enabled, ≤ 2048 chars** | REJECT |
| CTA | `WEB_VIEW` enum (23 values) | **`VIEW_MORE` IS NOT VALID on any type.** Nearest: `MORE`, `VIEW`, `BOOK_NOW`, `BUY_TICKETS` | **REJECT** `invalid_cta` |
| Crop | `top_snap_crop_position` | `OPTIMIZED` (**default — silently crops off-ratio media**) \| `MIDDLE` \| `TOP` \| `BOTTOM` | expose it |

### 2.4 Google

| Asset | Ratio | Recommended | Minimum | Max file | Formats | Action |
|---|---|---|---|---|---|---|
| Marketing / landscape | **1.91:1** | **1200 × 628** | **600 × 314** | **5120 KB** | **JPG, PNG** | REJECT / **AUTO** crop |
| Square marketing | **1:1** | **1200 × 1200** † | **300 × 300** | **5120 KB** | JPG, PNG | REJECT / AUTO |
| Portrait | **4:5** | **960 × 1200** | **480 × 600** | **5120 KB** | JPG, PNG | REJECT / AUTO |
| Vertical (Demand Gen / Shorts) | **9:16** | **1080 × 1920** | **600 × 1067** | 5120 KB | JPG, PNG | REJECT / AUTO |
| Logo square | **1:1** | **1200 × 1200** | **128 × 128** ‡ | 5120 KB | JPG, PNG | REJECT |
| Logo landscape | **4:1** | **1200 × 300** | **512 × 128** | 5120 KB | JPG, PNG | REJECT |
| Uploaded display ad | fixed IAB sizes | — | — | **150 KB** | GIF, JPG, PNG | REJECT |
| Media bundle (PMax) | — | — | — | **< 150 KB** | ZIP/HTML5 | REJECT |
| Media bundle (display HTML5) | — | — | — | **600 KB** (≤40 files) | ZIP | REJECT |

† **Doc conflict:** the standalone RDA page says square recommended **600×600**; PMax/Demand Gen/API pages say **1200×1200**. **Use 1200×1200 universally.**
‡ **Doc conflict:** Demand Gen logo min quoted **144×144** on one page, **128×128** on another. **Use 144×144 as the safe floor.**

| Constraint | Value | Action |
|---|---|---|
| **Aspect-ratio tolerance** | **No published tolerance.** The commonly-cited "±1%" appears in **no** current Google doc. | **— do not encode a constant against a source that doesn't exist** |
| **GIF / WEBP** | **NOT accepted** for marketing/logo asset types (JPG/PNG only) — **despite `IMAGE_GIF`/`IMAGE_WEBP` existing in the `MimeType` enum. The enum is broader than the policy.** | **REJECT** |
| Animated GIF (uploaded display only) | **≤30 s**, must stop after 30 s, frame rate **<5 FPS** | REJECT |
| **Asset names** | **must be unique per account** (image + media-bundle assets) | REJECT / auto-suffix |
| **Crop** | **The API has NO crop parameter.** The UI has a crop tool; the API takes **pre-encoded bytes** at a fixed `full_size` and **Google will not crop or fetch server-side.** *"Google does not directly fetch remote URLs — you must download the image and pass the binary data to the API."* | **AUTO — we pre-crop, always** |
| **Asset immutability** | **Assets are immutable once created.** *"To stop an asset from serving, remove the asset from the entity that is using it."* **A creative "edit" = new asset + relink, and that restarts review.** | The ref cache must key on **content, not name**, or we'll silently reuse a stale asset |
| Video | hosting | **YouTube-hosted only** — via `YouTubeVideoUploadService` resumable REST (§1.5) | AUTO |
| Video | ratios / res / max | 16:9 / 9:16 / 1:1 (4:3, 2:3 SD only) · rec **1080p**, min **720p** · **max file 256 GB** · MP4, WebM, MOV, AVI, WMV, FLV, 3GPP, ProRes, DNxHR, HEVC | REJECT |
| Video | **PMax** | **≥ 10 s**; max 15 per asset group | REJECT |
| Video | Demand Gen | ≥5 s accepted; **<10 s ineligible for in-stream**; >15 s recommended; 1–5 per ad | WARN |
| Video | Bumper / skippable / non-skippable / CTV | **≤6 s** / skip after **5 s** (best practice 15–20 s) / **7–15 s** / **16–30 s must be horizontal** | REJECT |
| Copy | RSA | headlines **3–15 × ≤30** · descriptions **2–4 × ≤90** · path1/path2 **≤15** · **≤3 enabled RSAs per ad group** | REJECT |
| Copy | PMax | `HEADLINE` **3–15 ≤30** · `LONG_HEADLINE` **1–5 ≤90** · `DESCRIPTION` **2–5 ≤90, ≥1 must be ≤60** · `BUSINESS_NAME` **1 ≤25** · `MARKETING_IMAGE` **1–20** · `SQUARE_MARKETING_IMAGE` **1–20** · `LOGO` **1–5** · `YOUTUBE_VIDEO` **0–15** | REJECT |
| Copy | RDA | `short_headline` **≤30** · `long_headline` **≤90** · headlines **1–5 ≤30** · descriptions **1–5 ≤90** · `business_name` **≤25** · marketing images **1–15** (5 rec.) | REJECT |
| Copy | Demand Gen | **headlines ≤40 — not 30**; min 3 unique; long headlines ≤90; descriptions ≤90; carousel **2–10** cards; up to **20** images/ad | REJECT |
| Copy | double-width | Korean/Japanese/Chinese chars count as **2** | count by weight |
| Link | final URL | **≤ 2,084 bytes**; criterion final URL ≤2,047 | REJECT |
| Keyword | limits | **≤80 chars, ≤10 words**; allowed chars: letters, digits, space, `# $ & _ - " [ ] ' + . / :` | REJECT |
| Editorial | tripwires | ALL-CAPS, `!!!`, `★`, gimmicky spacing/repetition, incomprehensible copy. **Warning issued ≥7 days before suspension.** | REJECT |
| Asset field types | inline vs service | **Only `TextAsset` is created inline on the ad.** Every other asset type must be created via `AssetService.MutateAssets` **first**, then linked. | |

> **RSA = 4 descriptions max. PMax = 5.** *These are routinely conflated — the research's own first pass got it wrong before verifying against Google's page.* **Key the limit off the ad type.**

### 2.5 Reddit

> **⚠ Read this before encoding anything.** The OpenAPI spec (76,392 lines) encodes **ZERO pixel dimensions, ZERO file-size caps, ZERO duration bounds, ZERO codec/format lists** — verified by full-text grep for `aspect ratio|resolution|MB|1080|1200|jpg|png|mp4|mov|gif|codec|duration`. Media constraints are enforced **server-side at ingest**, surfaced asynchronously as `status: INVALID_MEDIA` + `errors[].message` **prose with no error code**. The official ad-unit spec page is a **Salesforce Lightning SPA** that returns only a CSS-error shell to any non-JS client. **[3P] sources contradict each other.** **Hard-block only on the [SPEC] rows below. Everything else is WARN until verified.**

| Constraint | Value | Confidence | Action |
|---|---|---|---|
| Carousel cards | **1–6** (`minItems: 1, maxItems: 6`) ⚠ the guide says "2–7" — **trust the schema** | **[SPEC]** | **REJECT** |
| Legacy post `content` items | **≤ 6** | **[SPEC]** | REJECT |
| Carousel caption | **≤ 180 chars** ⚠ [3P] says 50 — **the API says 180** | **[SPEC]** | REJECT |
| Text body | **≤ 40,000 chars** | **[SPEC]** | REJECT |
| `PROMOTED_POST` headline | **≤ 2,000** | **[SPEC]** | REJECT |
| **Other headlines** (IMAGE/VIDEO/TEXT/CAROUSEL) | **no limit in schema** — policy limit **~300** [3P], `EXCEEDING_CHARACTERS` is a real rejection reason | **[SPEC] absence + [3P] number** | **REJECT >300 · WARN >100 · WARN >80** (ours to build or we eat the rejection) |
| Ad `click_url` | **≤ 5,000** | **[SPEC]** | REJECT |
| Click URL query params | **≤ 14** | **[SPEC]** | REJECT |
| Products per ad | **≤ 6** | **[SPEC]** | REJECT |
| Asset upload batch | **1–50** | **[SPEC]** | REJECT |
| Entity name | **3–500** | **[SPEC]** | REJECT |
| Thumbnail | **required for VIDEO posts** | **[SPEC]** | REJECT |
| `display_url` | **must match the destination domain** | **[SPEC]** | REJECT |
| Media intake | **URL-based** — `{media: {url, type: "URL"}}`; **Reddit downloads and rehosts.** `crop: {top_left_coordinates:{x,y}, dimensions:{…}}` available | **[SPEC]** | — |
| ALL-CAPS | `CAPITALIZATION` is a literal rejection reason | **[SPEC] enum** | **REJECT** |
| Image dims | 1080×1080 (1:1), **1080×1350 (4:5 — recommended default**, Reddit is mobile-dominant), 1920×1080 (16:9), 1440×1080 (4:3); 1200×628 feed | **[3P]** | **WARN** |
| Image max size | **3 MB** | **[3P]** | **WARN** |
| Carousel max size | **3 MB** [S10] vs **20 MB, GIF 3 MB** [S9] — ⚠ **sources conflict** | **[3P]** | **WARN** |
| Video | 1920×1080 / 1440×1080 desktop; 1200×1200 / 1200×1500 mobile; **≤1 GB (rec <512 MB)**; MP4/MOV; **2 s–15 min** (rec 5–30 s); **≤30 FPS** | **[3P]** | **WARN** |
| Thumbnail | 400×300 (4:3); 500 KB [S10] / up to 3 MB [S9] — ⚠ conflict | **[3P]** | WARN |
| Carousel ratio | all cards **must share one ratio** | **[3P]** | WARN |
| **Safe zone** | keep essential content **centred / in the top two-thirds**; leave the **bottom ~20%** clear of text and logos (the upvote/comment engagement bar overlays it) | **[3P]** | **WARN** |

**Reddit's async media feedback loop:**
```
POST /profiles/{id}/creative_assets/uploads   (or structured_posts/jobs)
  → status: PROCESSING_MEDIA
  → poll GET /creative_assets/{id}
      ACTIVE          ✓ media.height / media.width / media.mime_type now readable
      INVALID_MEDIA   ✗ errors[]: {field: "media", message: "The image you provided is too small."}
      DUPLICATE_ASSET ⚠ Reddit dedupes identical media
      DELETED
```
**`message` is human prose with no stable error code — surface it verbatim, never regex it.**

---

## 3. The per-platform field map

Our normalized field → the platform's actual field/enum. **⚠ = a correction the research forced.**

### 3.1 Connection / identity

| Ours | Meta | TikTok | Snapchat | Google | Reddit |
|---|---|---|---|---|---|
| `external_account_id` | `2393570861066813` (`act_` prefix in Graph paths, **bare in DB**) | advertiser `7627974536397766673` (19-digit) | adaccount `6421cc96-…` (**UUID v4 lowercase**) | customer **`5083048929`** (**digits only, no dashes**) | **⚠ `^(t2\|a2)_.*` — both prefixes legal, never assume `a2_`** |
| `external_org_id` | business `830733900115504` | Business Center `7627974686760009729` | org `9389df65-…` | **MCC `8284700017`** → `login-customer-id` header | business `t2_…` |
| `auth_kind` | `system_user_token` | `system_user_token` | `refresh_token` | `dev_token_oauth` | `refresh_token` |
| Token lifetime | long-lived | long-lived | **3600 s** | ~3600 s | **⚠ `expires_in` is 3600 *or* 86400 — "whichever is listed". Do not hardcode 3600.** |
| Identity | **`page_id` `797406353459597`** (+ `instagram_user_id`) | **`identity_id` `b3f0f8f4-…` (UUID) + `identity_type`** | **`profile_properties.profile_id`** (Public Profile) | n/a | **`profile_id` `t2_…`** |
| Pixel | `1949011972638955` | `7662469356818858002` (code `D9B98EBC77U1EOHV2O0G`) | `af5f8fc4-…` | conversion action | **`a2_jcfwvnfcfqcs`** |
| Base URL | `graph.facebook.com/v{ver}` — **⚠ pin v25.0, not v21.0** | `business-api.tiktok.com/open_api/v1.3` | **`adsapi.snapchat.com/v1` + `businessapi.snapchat.com/v1` (TWO hosts)** | `googleads.googleapis.com/v24` — **⚠ v25 does not exist** | `ads-api.reddit.com/api/v3` (**`User-Agent` required on every call incl. token refresh**) |
| Success test | flat object or `{error}` | `code === 0` | **`request_status` AND every `sub_request_status`** | `mutate` results array | **plain HTTP codes (201/400/…)** |

**⚠ Version pinning.** `META_API_VERSION = v21.0` is **stale** (v25.0 shipped 2026-02-18; ~2-year support windows). Two 2026 deprecations already bite: **Insights deprecated `7d_view`/`28d_view` as queryable `action_attribution_windows` from 2026-01-12** (#865 must not request them), and **ASC/AAC create+update removed** (v24/v25). Google: pin **`v24`** (v24.2 current, GA 2026-04-22, ~1-yr support → ~2027-04; v21 sunsets Aug 2026, v22 Oct 2026). **`UNSUPPORTED_VERSION` is a hard fail, not a warning.**

### 3.2 Campaign

| Ours | Meta | TikTok | Snapchat | Google | Reddit |
|---|---|---|---|---|---|
| `name` | `name` | `campaign_name` (**≤512, no emoji**) | `name` (**≤375**) | `name` (unique per account) | `name` (**3–500**) |
| `objective` | `objective` — **ODAX 6 ONLY** | `objective_type` (**bare string, no enum in MCP — we own it**) | **⚠ `objective_v2_properties.objective_v2_type`** (not `objective_v2`) | `advertising_channel_type` (**`SEARCH=2`, `DISPLAY=3`, `VIDEO=6`, `MULTI_CHANNEL=7`, `PERFORMANCE_MAX=10`, `DEMAND_GEN=14`** — **⚠ no `DISCOVERY=12`, no `APP` value**) | `objective` (7-enum) |
| `status` (PAUSED) | `status: 'PAUSED'` | `operation_status: 'DISABLE'` | `status: 'PAUSED'` | `status: 'PAUSED'` (**`REMOVED` is permanent**) | **⚠ `configured_status: 'PAUSED'` — defaults to `ACTIVE`!** |
| `daily_budget_cents` (CBO) | `campaign_daily_budget` (**cents**) | `budget` (**dollars**) + `budget_mode` + `budget_optimize_on: true` | `daily_budget_micro` (**×10,000**) | `campaign_budget` → `amount_micros` (**×10,000**) | `goal_value` (**micro**) + `goal_type` + `is_campaign_budget_optimization` |
| `buying_type` | `AUCTION` \| `RESERVED` | (via `objective_type=RF_REACH`) | `buy_model: AUCTION` \| `RESERVED` | n/a | n/a |
| bid strategy | `campaign_bid_strategy` (CBO only) | **⚠ `bid_type` deprecated at campaign level in v1.3** — set at ad group | (ad-squad level) | inline `oneof` **or** portfolio — **never both** | `bid_strategy` ∈ `BIDLESS, MAXIMIZE_VOLUME, TARGET_CPX` |
| special categories | `special_ad_categories` — **⚠ `CREDIT` retired → `FINANCIAL_PRODUCTS_SERVICES`** | `special_industries` ∈ `HOUSING, EMPLOYMENT, CREDIT` | `regulations` (HEC) | n/a | `special_ad_categories` ∈ `HOUSING_EMPLOYMENT_CREDIT, NONE` (**`readOnly` on create**) |
| idempotency | — | **`request_id`** (same id within 10 s → only one succeeds) | — | temp IDs (negative, unique, **defined before referenced**) | — |
| pixel | (ad-set `promoted_object`) | (ad-group `pixel_id`) | (ad-squad `pixel_id`) | — | **⚠ `conversion_pixel_id` REQUIRED on every CBO campaign since 2026-07-13** |

### 3.3 Ad set / ad group / ad squad

| Ours | Meta (ad set) | TikTok (ad group) | Snapchat (ad squad) | Google (ad group) | Reddit (ad group) |
|---|---|---|---|---|---|
| `optimization_goal` | `optimization_goal` (**26 in create schema, 19 in field-context — use the objective→goal matrix**) | `optimization_goal` (16-enum; **`VIDEO_VIEW` deprecated in v1.3**) | `optimization_goal` (18-enum) | (bidding strategy) | `optimization_goal` (**28-enum**) |
| `billing_event` | `IMPRESSIONS` \| `LINK_CLICKS` \| `POST_ENGAGEMENT` \| `VIDEO_VIEWS` | `billing_event` (**no enum in MCP**: CPC/CPM/OCPM/CPV) | **`IMPRESSION` — the ONLY value** | n/a | `bid_type` ∈ `CPC, CPM, CPV, CPV6` (**⚠ ad group adds `CPV`; campaign has only CPC/CPM/CPV6**) |
| budget | `daily_budget` XOR `lifetime_budget` (**cents**; lifetime **requires `end_time`**) | `budget` + `budget_mode` (**⚠ no `BUDGET_MODE_INFINITE` at ad-group level**; ignored under CBO) | `daily_budget_micro` \| `lifetime_budget_micro` **+ ⚠ REQUIRED `delivery_constraint`** (`DAILY_BUDGET`/`LIFETIME_BUDGET`/`REACH_AND_FREQUENCY`) | `cpc_bid_micros` | `goal_value` + `goal_type` |
| bid | `bid_amount` / `bid_constraints.roas_average_floor` (200 = 2.00×) | **⚠ `bid_type` REQUIRED under CBO**; `bid_price` must be **< both** budgets | `bid_micro` (**min 10,000; USD max 500,000,000**; **omit for `AUTO_BID`**) | `cpc_bid_micros` etc. | `bid_value` (**⚠ CPC band 3,500,000–100,000,000 micro = $3.50–$100**) |
| pixel | **`promoted_object: {pixel_id}`** — required for `OFFSITE_CONVERSIONS`/`VALUE`/`LEAD_GENERATION`/`QUALITY_LEAD`/`APP_INSTALLS`/`IN_APP_VALUE` | `pixel_id` + **`optimization_event` (required whenever `pixel_id` is set)** | `pixel_id` | — | **⚠ `conversion_pixel_id` REQUIRED on EVERY ad group since 2026-07-13** |
| `destination_type` | `WEBSITE, APP, MESSENGER, …` (**mandatory pairings with the goal**) | `promotion_type` (**no enum in schema**) | `child_ad_type` (16-enum) | — | — |
| geo | `geo_locations.{countries, regions(200), cities(250, 10–50mi), zips(50k), custom_locations(200, 0.63–50mi), location_types[home,recent]}` | `location_ids` (**numeric only, ≤3,000, no overlap**) + `zipcode_ids` | `geos: [{country_code: 'us'}]` (**lowercase ISO**) + `operation: INCLUDE\|EXCLUDE` | `location` **CampaignCriterion** → `geoTargetConstants/{id}` (**campaign level, not ad group**) | `geolocations` (**≤20,000**; `"US"`, `"US-VA"`, `"CA:6167865"`) |
| age | `age_min` (≥13, default 18) / `age_max` (≤65 = "65+") | `age_groups` (6-enum) | `demographics[].min_age`/`max_age` (**strings**) | **discrete `AGE_RANGE_18_24=503001 … _65_UP=503006`, `_UNDETERMINED=503999`** (ad group) | **⚠ DOES NOT EXIST** |
| gender | `genders: [1,2]` (1=M, 2=F) | `gender` (3-enum) | `genders: ['MALE','FEMALE']` | `MALE=10, FEMALE=11, UNDETERMINED=20` | **`FEMALE, MALE, null`** |
| interests | `flexible_spec[].interests[{id,name}]` (**13–16-digit real IDs**; AND across groups, OR within) | `interest_category_ids` / `interest_keyword_ids` | `interests` (Snap Lifestyle Categories) | `user_interest` (ad group) | `interests` (**≤200**) |
| custom audiences | `custom_audiences[{id}]` / `excluded_custom_audiences` | `audience_ids` / `excluded_audience_ids` | `custom_audiences` / `lookalike_audiences` | `user_list` | `custom_audience_ids` / `excluded_…` |
| **communities** | — | — | — | — | **`communities` / `excluded_communities` (plain names, no `r/`) ← unique** |
| placement | omit → **Advantage+**; else `publisher_platforms`/`facebook_positions`/`instagram_positions`/`device_platforms` | `placement_type` + `placements` (**both immutable**) + `tiktok_subplacements` | `placement_v2: {config: AUTOMATIC\|CUSTOM}` + `snapchat_positions` (9) | `network_settings` | **`locations` ∈ `FEED, COMMENTS_PAGE`** + **`view_modes` ∈ `ALL, CARD, CLASSIC, COMPACT, IMMERSIVE`** |
| audience expansion | `targeting_automation.advantage_audience` (**defaults to `1` since v23.0**) | `smart_audience_enabled` / `smart_interest_behavior_enabled` | `enable_targeting_expansion` + `auto_expansion_options` | (PMax signals — **do not restrict**) | `expand_targeting` |
| frequency cap | `frequency_control_specs {event, interval_days 1–90, max_frequency 1–90, type}` — **⚠ writable ONLY on `REACH`/`THRUPLAY` goals** | `frequency` (1–1000) + `frequency_schedule` (1–30) — **`REACH` ads only** | `cap_and_exclusion_config` (**incompatible with multi-format delivery in Auction**) | `frequency_caps[]` | — |
| brand safety | `brand_safety_content_filter_levels` (13-enum; **default = expanded/widest**) | `brand_safety_type` (5-enum; default `NO_BRAND_SAFETY` → **`EXPANDED_INVENTORY` next version**) | `brand_safety_config.inventory_option` ∈ `FULL_INVENTORY \| LIMITED_INVENTORY` | `CampaignCriterion` content exclusions — **⚠ `video_brand_safety_suitability` is NOT a top-level v24 field** | — |
| dayparting | `adset_schedule [{start_minute 0–1440, end_minute, days[0=Sun]}]` + `pacing_type:["day_parting"]` | `dayparting` (**336-char 0/1 string**) | `ad_scheduling_config` | `ad_schedule` criterion | `schedule [{start_day 0=Sun, end_day, start_hour, end_hour}]` |
| attribution | `attribution_spec [{event_type ∈ CLICK_THROUGH\|VIEW_THROUGH\|ENGAGED_VIDEO_VIEW, window_days, weight}]` — **default 7d-click + 1d-view; SCHEMA recommends omitting** | `click_attribution_window` (OFF/1/7/14/28) + `view_attribution_window` (OFF/1/7) | `conversion_window` ∈ `SWIPE_28DAY_VIEW_1DAY` (default) \| `SWIPE_7DAY` | conversion action settings | `view_through_conversion_type` ∈ `SEVEN_DAY_CLICKS \| SEVEN_DAY_CLICKS_ONE_DAY_VIEW` |
| pacing | `pacing_type: ["standard"\|"day_parting"\|"no_pacing"]` | `pacing` ∈ `PACING_MODE_SMOOTH \| PACING_MODE_FAST` (**forced SMOOTH under CBO; otherwise required**) | `pacing_type` ∈ `STANDARD \| ACCELERATED` (**ACCELERATED has a 3-way constraint + immutable**) | `delivery_method` ∈ `STANDARD \| ACCELERATED` (**ACCELERATED effectively retired**) | — |
| EU compliance | **`dsa_beneficiary` / `dsa_payor` — required for EU geo** (auto-fills from the business name) | — | — | `contains_eu_political_advertising` | — |

### 3.4 Ad / creative

| Ours | Meta | TikTok | Snapchat | Google | Reddit |
|---|---|---|---|---|---|
| creative model | **first-class `adcreative` object** (`creative_id`, reusable) | **⚠ NO standalone creative** — inline in `creatives[]` on `ad_create` | **`creative` is ad-account-scoped and reusable**; media uploaded FIRST, must be `READY` | **assets are account-scoped, reusable, immutable**; only `TextAsset` inline | **⚠ the ad IS a promoted post** (`post_id` `t3_` + `profile_id` `t2_`) |
| `creative` source | exactly one of `{creative_id}` \| `{object_story_id}` \| `{object_story_spec}` | `creatives[]` (**max 20 per call**) | `creative_id` | `ad.responsive_search_ad{headlines[], descriptions[]}` | `post_id` |
| **required identity** | **`object_story_spec.page_id` ALWAYS** — omit → *"Facebook Page is Missing"* | **`identity_type` + `identity_id` on every creative** — no identity, no ad | **`profile_properties.profile_id`** | n/a | `profile_id` |
| image ref | **`image_hash`** (**ad-account-scoped**) — prefer over `image_url`; a bare URL goes at the creative **top level**, not inside `link_data` | **`image_id` + `material_id`** | **`media_id`** (type IMAGE) | asset **`resource_name`** | creative asset id (`t2_…-IMAGE-232`) |
| video ref | **`video_id`** + thumbnail `image_hash` (**ASYNC — poll `video_status='ready'`**) | **`video_id` + `material_id`** | **`media_id`** (type VIDEO) | **`youtube_video_id`** (via resumable upload; poll to `PROCESSED`) | asset id |
| ad type | — | `ad_format` ∈ `SINGLE_IMAGE, SINGLE_VIDEO, LIVE_CONTENT, CAROUSEL_ADS, CATALOG_CAROUSEL` (**carousel types immutable**; **there is no `SPARK` ad_format** — Spark = `identity_type` + `tiktok_item_id`) | **⚠ creative `WEB_VIEW` ↔ ad `REMOTE_WEBPAGE`** (NOT `SNAP_AD` — `SNAP_AD` is the attachment-less top snap) | `ad_group_ad.ad` | `type: UNSPECIFIED` |
| primary text | `body` → **"Primary text"** | `ad_text` (**≤100, no emoji**) | — | `descriptions[]` | headline |
| headline | `title` → **"Headline"** | — | `headline` (**≤34**) | `headlines[]` | `headline` |
| description | `link_description` | — | — | `descriptions[]` | `body` |
| CTA | `call_to_action_type` (default `LEARN_MORE`; **destination auto-set to `link_url`**) | `call_to_action` (**no enum**) / `call_to_action_id` (**wins**) | `call_to_action` (**per-type enum**) | n/a | **⚠ Title-Case strings** (`"Buy Tickets"`) |
| link | `link_url` / `link_data.link` / `call_to_action.value.link` | `landing_page_url` | `web_view_properties.url` (**SSL, ≤2048**) | `final_urls[]` (**≤2,084 bytes**) | `click_url` (≤5000) + **`display_url` (must match domain)** |
| UTM / tracking | **`url_tags`** (macros `{{campaign.id}}`, `{{ad.name}}`, `{{placement}}`, `{{site_source_name}}`) — **not in the MCP tool but first-class on Graph** | `utm_params` (**≤14**, keys case-sensitive; macros `__CAMPAIGN_ID__`, `__AID__`, `__CID__`, `__PLACEMENT__`) | third-party URLs (**5-domain allowlist**) + macros `~.~SERVER_CAMPAIGN_ID~.~` | `tracking_url_template` / `final_url_suffix` / `url_custom_parameters` | `click_url_query_parameters` (**≤14**, macros `{{AD_ID}}`) |
| AEM / domain | **`conversion_domain`** (ad level) | — | — | — | — |
| AI disclosure | **`self_ai_disclosure` ∈ `OPT_IN` \| `OPT_OUT`** | `aigc_disclosure_type` — **⚠ `CUSTOMIZED_USER` only → unavailable to us** | — | — | — |
| UGC | — | `item_duet_status` / `item_stitch_status` (Spark; need `promotional_music_disabled=false`) | — | — | **`enhancements.user_generated_content.enroll_status` ∈ `OPT_IN`\|`OPT_OUT`** ("Redditor Highlights") |
| comments | — | `comment_disabled` (ad-group) | — | — | **`allow_comments`** (default **false** in the job body — **set true**) |
| review read | `effective_status` + **`issues_info`** + **`ad_review_feedback`** | `ad_review_info_get` (**`is_approved`, `reject_info[]`**) | `review_status` + **`review_status_reasons`** | `policy_summary.{approval_status, review_status, policy_topic_entries}` | `effective_status` + **`rejection_reason`** |
| preview | `GET /{ad_id}/previews?ad_format=…` (8 formats) | `creative_ads_preview_create` | — | — | **`preview_url`** (+ `?comment_ad=`) |

**Name-mapping corrections the research forced (Google):**

| Written as | Actually |
|---|---|
| `v25` | **doesn't exist** — current **v24.2** |
| `url_expansion_opt_out` | **`asset_automation_settings` → `FINAL_URL_EXPANSION_TEXT_ASSET_AUTOMATION` = `OPTED_OUT`** |
| `LIMITS_SERVING` / `FULLY_LIMITS_SERVING` | **`LIMITED`** / **`FULLY_LIMITED`** |
| `DISCOVERY` (=12) | **`DEMAND_GEN=14`** |
| `policy_violation_key` / `exempt_policy_violation_keys` | **`PolicyValidationParameter.ignorable_policy_topics`** (old names are AdWords SOAP) |
| `video_brand_safety_suitability` (campaign field) | not top-level — content exclusions via `CampaignCriterion` |
| `BusinessNameAsset` / `BusinessLogoAsset` | not message types — **`AssetFieldType` values on `TextAsset`/`ImageAsset`** |
| `WhatsappBusinessMessageAsset` | nested variant inside `BusinessMessageAsset` |
| PMax search themes = 25 | **50** |
| RSA descriptions = 5 | **4** (PMax = 5) |

**Live Google deprecations to respect:** `CallAdInfo` **removed from the `Ad` oneof in v23** (new call ads unsupported since 2026-01-01; existing stop serving Feb 2027) → use RSA + `CallAsset`. `ExpandedTextAd` creation dead since 2022-06-30. **Smart Campaigns deprecated for new creation 2026-08-03.** `ACCELERATED` budget delivery sunset for Search/Shopping/shared.

**Resource-name formats (Google) — the `~` composites are a real parsing hazard:**
`customers/{cid}/campaignCriteria/{campaign_id}~{criterion_id}` · `adGroupCriteria/{ad_group_id}~{criterion_id}` · **`adGroupAds/{ad_group_id}~{ad_id}`** · `assetGroupAssets/{asset_group_id}~{asset_id}~{field_type}` (**triple tilde**) · `geoTargetConstants/{criterion_id}` (**global, not customer-scoped**).
**⚠ `ads.external_ad_id` must store `{ad_group_id}~{ad_id}`, not the bare ad id**, or we cannot address the ad again.

**⚠ `AdGroupCriterion.negative` is IMMUTABLE** — a keyword cannot be flipped positive↔negative. Any "toggle negative" affordance must be implemented as **remove + create**, not update.

### 3.5 Objective → compatible `optimization_goal` (Meta) — the matrix, not a flat list

**[SCHEMA — verbatim from the create tool; default listed first]**

| Objective | Compatible goals |
|---|---|
| `OUTCOME_AWARENESS` | **REACH**, IMPRESSIONS, AD_RECALL_LIFT, THRUPLAY, TWO_SECOND_CONTINUOUS_VIDEO_VIEWS |
| `OUTCOME_TRAFFIC` | **LINK_CLICKS**, LANDING_PAGE_VIEWS, OFFSITE_CONVERSIONS, IMPRESSIONS, POST_ENGAGEMENT, REACH, CONVERSATIONS, THRUPLAY, VISIT_INSTAGRAM_PROFILE, PROFILE_VISIT, QUALITY_CALL, REMINDERS_SET |
| `OUTCOME_ENGAGEMENT` | **THRUPLAY**, POST_ENGAGEMENT, EVENT_RESPONSES, PAGE_LIKES, IMPRESSIONS, REACH, TWO_SECOND_CONTINUOUS_VIDEO_VIEWS, VIDEO_VIEWS, LINK_CLICKS, CONVERSATIONS, OFFSITE_CONVERSIONS, LANDING_PAGE_VIEWS, QUALITY_CALL |
| `OUTCOME_LEADS` | **OFFSITE_CONVERSIONS**, LEAD_GENERATION, QUALITY_LEAD, LANDING_PAGE_VIEWS, LINK_CLICKS, IMPRESSIONS, REACH, VALUE, CONVERSATIONS, QUALITY_CALL |
| `OUTCOME_SALES` | **OFFSITE_CONVERSIONS**, VALUE, LANDING_PAGE_VIEWS, IMPRESSIONS, POST_ENGAGEMENT, REACH, LINK_CLICKS, CONVERSATIONS |
| `OUTCOME_APP_PROMOTION` | **APP_INSTALLS**, OFFSITE_CONVERSIONS, IMPRESSIONS, LINK_CLICKS, REACH, VALUE, VIDEO_VIEWS |

**An invalid goal is auto-corrected to the recommended default at the server** [SCHEMA] — **validate client-side rather than rely on Meta's silent correction.** Several goals are **account-gated** (`MESSAGING_PURCHASE_CONVERSION`, `MEANINGFUL_CALL_ATTEMPT`, `IN_APP_VALUE`, `ENGAGED_PAGE_VIEWS`) — the API errors if the account isn't eligible.

**Mandatory `destination_type` pairings [SCHEMA]:** `CONVERSATIONS`/`MESSAGING_PURCHASE_CONVERSION`/`MEANINGFUL_CALL_ATTEMPT` → `MESSENGER`\|`WHATSAPP`\|`INSTAGRAM_DIRECT` · `VISIT_INSTAGRAM_PROFILE` → `INSTAGRAM_PROFILE` · `PROFILE_VISIT` → `FACEBOOK_PAGE`\|`INSTAGRAM_PROFILE` · `LANDING_PAGE_VIEWS`/`OFFSITE_CONVERSIONS`/`VALUE` → `WEBSITE`.

---

## 4. What we must build that we haven't specced

Ranked by *launch impact × irreversibility*. Each: **purpose**, **why it's mandatory**, and **what breaks without it**.

### 4.1 · Preflight / connection-health service — **P0**

**Purpose.** One call per `(platform, lane)` that answers *"if I launch right now, will an ad actually run?"* — token, billing/funding, identity, pixel, review tier, market reachability (§1.0 P1–P6).
**Why mandatory.** **Four of our five channels are marked GREEN in A3's registry and three of those four cannot deliver an ad today.** `connect()` currently proves a token mints — not that an ad can run. Preflight is the difference.
**Without it.** The first live-fire attempt fails at create with *"Facebook Page is Missing"* / 403 `DEVELOPER_TOKEN_NOT_APPROVED` / a Snap creative rejection, and we debug it as a code bug for a day.
**Build:** `admin-ad-preflight` edge fn; `admin-ad-connect` fails the connect (424) on a missing Page / Public Profile / profile / funding instrument; **downgrade A3's `google/consumer` GREEN → AMBER**; extend the connect AC per channel.

### 4.2 · Creative validator + probe/transcode/crop/safe-zone service — **P0**

**Purpose.** A server-side byte-probe (`ffprobe` or equivalent) → the §2 matrix → auto-fix / warn / hard-reject → per-ratio variant derivation (4:5 + 1:1 + 9:16 from one master) → safe-zone enforcement.
**Why mandatory.** #866 is **transport only** (`watermark` 0 mentions, `safe zone` 0, `transcode` 0, `bitrate` 0, `codec` 0, `fps` 0, `vertical` 0); dimensions are **admin-supplied, nullable, never validated against the bytes**; #864's dropzone hints at **Meta ratios** and ships a 1:1 asset byte-identical into TikTok's 9:16.
**Without it.** *"A square, 90-second, emoji-captioned asset gets rejected in review while the campaign burns a $20/day minimum against a $10 balance in a country we can't target."*
**Sub-components:** media probe · per-platform validators with exact numbers · vertical transcode to 9:16 1080×1920 · **black-bar / letterbox detection** (edge-row luma — the #1 TikTok auto-reject) · **watermark / other-platform-logo detection** (corner-region analysis for TikTok/IG/Reels/Shorts burn-ins) · **caption-length-aware** TikTok safe-zone check · audio-track presence check (Snap + TikTok hard-reject) · Meta `asset_feed_spec` per-placement assets (medium-term, replaces relying on Meta's auto-crop).
**Free wins to switch on immediately:** TikTok `flaw_detect=true` + `auto_fix_enabled=true` and `creative_auto_enhancement_strategy_list: [IMAGE_RESIZE, IMAGE_QUALITY, VIDEO_QUALITY]`.

### 4.3 · Real media-upload paths for Snapchat and Google — **P0**

**Purpose.** Replace two upload flows that **do not exist as designed**.
**Snapchat:** `upload_from_url` **is not a Snap endpoint**. Real paths: `POST /media/{id}/upload` (**`multipart/form-data`, ≤32 MB**) and `POST /media/{id}/multipart-upload-v2` (**INIT→ADD→FINALIZE, >32 MB, max 32×32 MB = 1 GB**). **Compounding: Bunny Stream serves HLS, not a downloadable MP4** — there is no URL to hand Snap even if the endpoint existed. Need: a direct MP4 rendition (or an MP4 master in Supabase Storage), byte-streaming multipart from the edge, chunked branch >32 MB with per-chunk retry, **poll `media_status` → `READY`** before creating the creative, then poll creative `packaging_status` → `SUCCESS`. **The single largest under-scoped item in the Snap lane.** Deno edge memory/time limits may force a different runtime for 1 GB.
**Google (the YouTube upload path):** **#866 OD-2's "Bunny cannot upload directly → hard YouTube dependency" is wrong and should be closed.** `YouTubeVideoUploadService.CreateYouTubeVideoUpload` takes **raw bytes over resumable REST**; **`channel_id` omitted ⇒ a Google-managed channel ⇒ no YouTube channel and no YouTube Data API needed.** Poll `PENDING→UPLOADED→PROCESSED`. Decide: Google-managed (**UNLISTED only**) vs our brand channel (`channel_id` + user auth ⇒ `PUBLIC`). **Reject the YouTube Data API path** (~100 uploads/day bucket, extra scope/channel/consent).

### 4.4 · Reddit promoted-post job runner + native-creative interface — **P0**

**Purpose.** Reddit's ad **is a post**. `createAd` cannot be called first.
**Why mandatory.** A3's interface has **no post/creative-create method**, and its `ads.creative_id → resolveCreativeRef → "Reddit media id"` assumption is **simply wrong — there is no media id on a Reddit ad.**
**Build:** either extend `ChannelAdapter` with an optional `createNativeCreative(conn, input) → {postId, profileId}` (no-op for the other four) **or** let `redditAdapter.createAd` run the sub-pipeline internally: `POST /profiles/{t2_}/structured_posts/jobs` → **poll** `GET /structured_posts/jobs/{id}` until `SUCCESS | CLIENT_ERROR | SERVER_ERROR` (bounded backoff; `CLIENT_ERROR` ⇒ **new job**, not a retry) → take the `t3_` id → `POST /ads`. **The poll makes `createAd` long-running and non-atomic** — it must sit inside #862's compensating-rollback envelope, and **rollback is `PATCH configured_status:"DELETED"`, not DELETE.**
**Plus the `configured_status` guard:** Reddit's campaign schema **`default: ACTIVE`** turns a forgotten field into real money. **Strict-grep CI gate:** `_shared/reddit.ts` never constructs a create body without an explicit `configured_status`. **Cheap; prevents the worst possible bug in this system.**

### 4.5 · Community-targeting model + per-platform targeting passthrough — **P1**

**Purpose.** Ship Reddit's only real advantage, and stop A3's normalized shape from lying.
**Why mandatory.** `targeting.communities` + `excluded_communities` have **no analogue on any other channel**; Mingla is a city-level experience app and Reddit's city subreddits are a near-perfect ICP match. **A3's normalized `{countries, age_min, age_max, genders}` cannot express communities — and its age assumption is meaningless on Reddit, which has no age targeting at all.** *Ship the community picker or don't ship Reddit.*
**Build:** a community picker over `GET /targeting/communities/search` + `/suggestions` (**100 req/60 s — cache hard**); `POST /targeting/keyword_validations` + `/geolocations_validations` **before** create; a **per-platform passthrough** on `ad_sets.targeting`; enforce the caps (interests 200, keywords 1,000, excluded_keywords 2,000, geolocations 20,000, carriers/devices 100, platforms 7, view_modes 5). Also model `locations` (FEED/COMMENTS_PAGE) and `view_modes` — neither is in A3's `placement jsonb`.

### 4.6 · Geo-resolver — **P1**

**Purpose.** Country codes in → the right numeric ID per platform out, with the market-eligibility answer attached.
**Why mandatory.** Three independent failure modes: **Google's "London" resolves to Ontario** on a naive name lookup (5+ matches; `1002325` sorts first, we want **`1006886`**); **TikTok returns no GB at all** and #863 OD-7's build-time map would silently ship a GB id that 400s; **Meta has no city targeting in our create body** at all — a Lagos venue campaign sprays Nigeria.
**Build:** Google — ship the CSV (`geotargets-2026-07-06`, 273,644 rows) or call `SuggestGeoTargetConstants`; **disambiguate on `Country Code` + `Canonical Name`, never `Name`**; store the resolved ID **+ canonical name**; refresh quarterly and **alert on `Removal Planned`** (2,916 constants, **2,212 in GB/US/NG**); set **`positive_geo_target_type = PRESENCE`**. TikTok — resolve against **live** `tool_region_get`, **fail loudly** on an unavailable country, enforce no-overlap + the 3,000 cap, **never accept ISO codes**. Meta — `admin-ad-targeting-search` proxying `GET /search` (`adinterest`, `adinterestvalid`, `adTargetingCategory`, `adgeolocation`, `adlocale`), admin-gated, token server-side; **drive city keys from our own `place_pool.lat/lng`** — *we know exactly where the venue is*; `custom_locations` pin-drop (0.63–50 mi) centred on it is the natural Mingla move.
**And feed the result into eligibility:** `eligibleChannels(objective, lane, **market**, allowlist, **preflight**)`.

### 4.7 · Per-channel copy validators + one shared composer — **P1**

**Purpose.** Per-channel hard caps, per-channel counters, weight-aware counting, emoji policy, live truncation preview.
**Why mandatory.** **#864's Meta soft-cap hint (125) exceeds TikTok's hard limit (100) — our UI actively guides admins into a validation error.** #863 states *"Character limits: NONE stated."* Reddit's headline has **no API limit but a real `EXCEEDING_CHARACTERS` rejection** hours later.
**Build:** the §2/§1.6 limits per channel; CJK ×2 / double-width ×2 counting; **emoji strip-or-reject on TikTok with the Spark workaround explained**; Google's RSA repeatables (3–15 / 2–4) + keywords + negatives; the Reddit **Title-Case CTA map with a unit test that it's never uppercased**; the truncation preview strip.

### 4.8 · Preview service — **P1**

**Purpose.** Render the real ad, per placement, before spend.
**Why mandatory.** **This is the cheapest possible mitigation for the entire creative gap** and the highest value-per-line-of-code in the build. It answers *"will the 35% bottom safe zone eat our CTA?"* without building a crop analyzer. Entities are PAUSED, so it's free and safe.
**Build:** Meta `ads_get_ad_preview` for `MOBILE_FEED_STANDARD` + `INSTAGRAM_STORY` + `INSTAGRAM_REELS`; TikTok `creative_ads_preview_create`; Reddit `preview_url` (+ `?comment_ad=` for the conversation placement); a **drawn safe-zone overlay** where no preview API exists (Snap 150/150, Meta 269/672/65, Reddit bottom 20%).

### 4.9 · Rejection-reason ingestor — **P1**

**Purpose.** Turn a red badge into a cause and a fix.
**Why mandatory.** We persist `effective_status` and stop. **An admin sees "Disapproved" with zero information, and the appeal path is UI-only — so the badge is a dead end.** This makes the whole review loop unusable in practice.
**Without it.** Every rejection is a support ticket to Seth.
**Build:** a **cron-driven `admin-ad-campaign-sync`** (every 30–60 min while pending, then daily for post-launch re-review); a new **`review_detail jsonb`** on `ads`; per-channel readers (§1.9b); **never store Meta's `recommendations` in the same field** (they're optimization tips, not rejections); the cause→fix message map; TikTok's **API-callable appeal** (`ad_appeal`/`adgroup_appeal`) and deep-links to Account Quality / Ads Manager for the other four.

### 4.10 · Policy pre-check — **P1**

**Purpose.** Catch the rejections we can predict, before a 24-hour review cycle.
**Why mandatory.** Meta's **Personal Attributes** rule is the #1 copy-rejection cause and its trigger — *second-person + presumed attribute* — **is the exact register of Mingla's canonical voice**. Reddit's **`DATING`** rejection makes our "experience app, not a dating app" positioning **a hard delivery constraint, not a brand preference**. Alcohol classification is live for a nightlife product across three channels.
**Build:** the 4-pattern linter (**warn, never hard-block** — false positives on a social product are guaranteed); the rejected→compliant table as inline UI guidance; ALL-CAPS/editorial checks (Google + Reddit); `special_ad_categories` validation + the restriction cascade + **reject `CREDIT`**; wire TikTok's free **`blockedword_check`** and `tool_url_validate`.
**Explicitly do NOT build:** text-density (20%) validation (dead rule) · engagement-bait rejection logic (that's a *ranking demotion*, not a disapproval).

### 4.11 · Destination re-checker — **P2**

**Purpose.** Re-assert *public + live + future* on every sync; auto-pause when it fails.
**Why mandatory.** **Google polices the destination for the ad's whole life** (*unavailable offers*, *destination not working*). A sold-out, unpublished, or past-date Mingla event **turns a live compliant ad into a policy violation** — and burns money on a dead page. We check once at create and never again.
**Build:** extend the sync job; auto-pause + `ad_status_events` + the operator message (§1.2). **Cheap, and it protects the account, not just the campaign.**

### 4.12 · `setBudget()` on `ChannelAdapter` — **P2** (the coordinated #862 change)

**Purpose.** The Brain's reallocation loop needs to change a live campaign's budget; A3's interface has `createCampaign`/`createAdSet`/`createAd`/`setStatus`/`getStatus` and **no budget mutator**.
**Build:** one method, five adapters, **conversion at the boundary only** (§1.4), per-channel failure isolation, and the **`$5.00 → 5000000 micro`** unit test. If #862 is closed, file `SPEC_AMENDMENT_ISSUE-862_setBudget`.

### 4.13 · `ChannelAdapter` interface widening — **P2**

**Purpose.** Two channels do not fit the Meta-shaped interface.
- **Google:** `createAd` takes **one creative**; an RSA needs **3–15 headlines + 2–4 descriptions**. **PMax has no ad groups and no ads at all** — it's `AssetGroup` + `AssetGroupAsset` + `AssetGroupSignal`, and **an AssetGroup plus all its minimum-required assets must be created in a SINGLE bulk mutate** (`AssetGroupError.NOT_ENOUGH_MARKETING_IMAGE_ASSET` otherwise) — **so PMax is not expressible as sequential `createX` calls; it requires `googleAds:mutate` with temp IDs.** Also: `{ad_group_id}~{ad_id}` in `external_ad_id`; `approval_status` **and** `review_status` as a pair.
- **Reddit:** the post-create step (§4.4).
**Decide explicitly and record it:** **MVP = Google SEARCH + RSA only; PMax deferred** — because **#864's channel picker currently advertises "Google = Search / Display."**

### 4.14 · Spark Ads intake (TikTok) — **P2**

**Purpose.** Spark is TikTok's highest-performing format **and one of only two legal identity paths for our account class** (§1.5). #863 mentions it **zero times**.
**Build:** **Push** works from zero posts today (`dark_post_status=ON`) — ship it. **Pull is impossible** (`@usemingla` has zero posts). **Creator-code Spark is an ops flow, not an API** (creator generates a 7/30/60/365-day code in-app; batch ≤20 in Ads Manager) — **pair it with the existing influencer-intake pipeline**. Add `tt_video_authorize_apply` + `identity_video_get` refresh; set `dark_post_status` / `promotional_music_disabled` / `item_duet_status` / `item_stitch_status` **deliberately**.
**Hard-fail `CUSTOMIZED_USER` in the adapter with an explanatory error** — our account (created 2026-04-12, after the 2026-01-15 cutoff) cannot use it, and nobody knows.

### 4.15 · Audience builder — **P3** (blocked on #865)

**Purpose.** WCA from pixel URL rules (`/e/`, `/checkout/`) at 30d/180d; **ENGAGEMENT audiences from IG/Page (730d) — the one retargeting play available *without* a pixel**; `CUSTOM` from our own reservation emails (hashed `em`/`ph`, `customer_file_source: USER_PROVIDED_ONLY`); LOOKALIKE at **1% (`ratio: 0.01`)** once a seed ≥100 exists — **and the range is 1–20%, not 1–10%.**
**Blocked by:** the dead pixel. TikTok/Snap equivalents (`dmp_custom_audience_create`, `dmp_custom_audience_lookalike_create`, SAM) are all API-callable and unbuilt.

### 4.16 · Small fields with real downside — **P3**

| Field | Why | Action |
|---|---|---|
| **`self_ai_disclosure`** | **Our creative pipeline is Higgsfield/AI-generative.** Non-disclosure is a compliance exposure we are actively creating. | `ad_creatives.ai_generated boolean` → **default `OPT_IN` for the Higgsfield/Remotion pipeline** |
| `url_tags` / `utm_params` | No UTMs → our own analytics can't see paid traffic; PostHog/GA attribution blind | `utm_source=facebook&utm_medium=paid&utm_campaign={{campaign.name}}&utm_content={{ad.name}}&placement={{placement}}` |
| `conversion_domain` | AEM requirement on the Meta ad | set to the true destination domain |
| creative `name` | **[SCHEMA]** *"strongly recommended"*; without it the Meta-side library is unbrowsable | pass #866's `ad_creatives.name` |
| `attribution_spec` | We accept the 7d-click/1d-view default silently | **[SCHEMA] recommends omitting unless explicitly requested — so the default is correct. Document it; surface it read-only. Do not expose a picker we don't need.** |
| `frequency_control_specs` | **Writable ONLY on `REACH`/`THRUPLAY` ad sets [OFFICIAL]** | **Gate the UI on the optimization goal or it will 400** |
| `brand_safety_content_filter_levels` | Default is **expanded** (widest, least safe) [LIVE, verbatim] | Consider `FEED_STANDARD` + `AN_STANDARD` (= "moderate"). **[LIVE] caveat:** *"if you don't see the option to use inventory filter, contact your meta account representative for access"* — **may be gated for us** |
| `dsa_beneficiary` / `dsa_payor` | **Required for EU geo — and we are live in London** (UK is not EU for DSA, but any EU expansion trips it immediately) | Set explicitly; auto-fills from the business name |
| Dayparting | A venue's ad at 4am is waste. **API-supported on all five, specced on none.** | Meta `adset_schedule` · TikTok 336-char string · Snap `ad_scheduling_config` · Reddit `schedule` · Google `ad_schedule` |
| Snap `lifetime_spend_cap_micro` | A cheap hard ceiling on a live **$15,000/day-limit** account | Min 20,000,000; reducible only if the new cap **> 1.1× already spent** |
| Reddit batch reads | `get_campaigns_by_ids` / `get_ads_by_ids` (**up to 2,000**) unused → sync will N+1 | — |
| Snap `paging.next_link` | Unhandled → **reads silently truncate at the first page** once >1 page exists | — |

### 4.17 · Spec reconciliations to file before implementation

| # | Conflict | Resolution |
|---|---|---|
| 1 | **Budget units: A3 = cents; #867 = `budget_micro`** | **A3/cents canonical.** `SPEC_AMENDMENT_ISSUE-867`. **10,000× money bug.** |
| 2 | Audit table: A3 `ad_status_events` vs #863 `ad_campaign_status_events` | **A3** |
| 3 | Edge fns: A3 `admin-ad-*` vs #863 `admin-ads-*` | **A3** (no trailing "s") |
| 4 | External IDs: A3 `external_*_id` vs #867 `provider_*` | **A3** |
| 5 | Platform enum: A3 `'snapchat'` vs #866 `'snap'`; #866 omits `'reddit'` | **A3** — `('meta','tiktok','snapchat','google','reddit')` |
| 6 | Snap token: #866 reads a **static** `SNAP_ACCESS_TOKEN`; **there is no static Snap token** — it's minted per-call from `SNAPCHAT_REFRESH_TOKEN`/`_CLIENT_ID`/`_CLIENT_SECRET` and expires in 3600 s | **If #866 lands first, `uploadToSnap` reads a secret that will never exist and fails closed forever.** `uploadToSnap` must call `mintSnapAccessToken()`. **RT-4 strict-grep must cover the real names.** |
| 7 | #863 `schedule_start_time` "advertiser timezone" vs the live schema's **UTC+0** | **UTC+0** — a 5-hour error (`Etc/GMT+5`) |
| 8 | #863 §4.4 step 5 sets ad `operation_status:'ENABLE'` vs §2/§4.0/AC-2's PAUSED mandate | **PAUSED** |
| 9 | #862 `META_API_VERSION=v21.0`; #867 "e.g. v25 current" for Google | **Meta → v25.0; Google → v24** (v25 does not exist). Quarterly version-review checkpoint. |
| 10 | #862 OD-8 "ship Facebook-only" | **Reverse** — resolve IG via Graph, not MCP |
| 11 | #862 OD-4 `LANDING_PAGE_VIEWS` default | **`LINK_CLICKS`** until the pixel fires |
| 12 | #867 OD-4 Snap `LANDING_PAGE_VIEW` default | **`SWIPES`** until the pixel fires |
| 13 | #866 OD-2 "Bunny cannot upload to Google → YouTube dependency" | **Close it** — `YouTubeVideoUploadService` takes bytes |
| 14 | #863 OD-7 build-time geo map | **Unsafe** — resolve live |
| 15 | #884 `auto` = `total < 2 × median_floor` | **Replace with a viability floor** |
| 16 | #884/#862 Meta floor `min_daily_budget_cents = 100` | **Per-category** via `/minimum_budgets` |
| 17 | #884 Reddit floor `500¢` | **Not in the spec.** Only `bid_value` **$3.50–$100 CPC** is real. Let the API 400. |
| 18 | #867 Snap: `objective_v2` key, `VIEW_MORE` CTA, `SNAP_AD` ad type, missing `delivery_constraint` | **Four field-level errors across campaign, ad squad, creative, and ad — the specced Snap create sequence cannot succeed as written.** |

---

## 5. Honest limits — what a world-class marketer expects that we simply cannot do

| # | What they expect | The reality | The workaround |
|---|---|---|---|
| 1 | **"Just build me an Advantage+ campaign."** | **Advantage+ Shopping (ASC) / Advantage+ App (AAC) can no longer be created OR updated via the Marketing API at all** — v24.0 blocked creation (2025-10-08); the **v25.0 changelog (2026-02-18)** removed create *and* update, phasing out across all versions ~90 days later. Migrated campaigns report `smart_promotion_type = GUIDED_CREATION`. | **Manual campaigns with the Advantage+ *sub-features* on** — CBO, Advantage+ audience, Advantage+ placements — all remain fully API-settable. **We're not missing a button; Meta removed it from the API.** This is the only legal architecture, and it's the one #862 already specs. |
| 2 | **"Appeal that rejection."** | **No Marketing API appeal endpoint exists on Meta, Snapchat, or Reddit.** Meta = Account Quality UI, **one shot per ad**; Snap = Ads Manager/support; Reddit = Ads Manager / `adsapi-partner-support@reddit.com`. | **TikTok has a real API appeal** (`ad_appeal`) — use it. **Google's "appeal" is a policy exemption**, not a button: read `policy_topic_entries[].topic` → set `ignorable_policy_topics` → **resubmit the same mutate** (exemptible findings only); UI appeals are **max 3/ad, min 24 h apart**. **Meta's programmatic-adjacent workaround:** edit the ad via the API to force it back to `PENDING_REVIEW` for a fresh automated pass. Everywhere else: **deep-link and be honest.** |
| 3 | **"Add a payment method / assign the Page / create the Public Profile."** | **All UI-only.** Meta billing and Page assignment are Business Settings. Snap's **Public Profile API is read-only** — a profile cannot be created via API. TikTok's balance top-up is Ads Manager (and `advertiser_balance_get` is BC-scoped and **does not reflect the Advanced Payment Portfolio** — the UI is source of truth). | **Preflight detects and names each one with the exact click-path.** No code path can provision them. |
| 4 | **"Retarget everyone who viewed the page."** | **The Meta pixel has never fired — epoch-0, browser AND server. 0 custom audiences. No lookalike is possible (min seed 100).** TikTok's pixel: `events: []`, 0 custom conversions, 0 audiences. Snap has no audiences. | **The one play available today: Meta ENGAGEMENT audiences from IG/Page — 730-day retention, no pixel required.** Everything else waits on #865. Say so; don't ship a dead button. |
| 5 | **"Advertise our London venues on TikTok."** | **GB is not in the 33 countries `tool_region_get` returns for our advertiser — for either TRAFFIC or APP_PROMOTION.** | **Escalate to TikTok — this smells like an allowlist/entity-registration gate, not a product limit.** Until then, exclude TikTok from UK plans and **fail loudly**, never silently drop the country. |
| 6 | **"Run Reddit in Lagos."** | **Reddit's funding currencies are `USD, GBP, CAD, EUR, AUD, NZD, SGD, BRL` — no NGN. Its `languages` enum has no Nigerian language.** | **Reddit is a US/UK/CA/EU/AU channel for us.** Lagos is targetable geographically, billed USD. **A channel-strategy note, not code: don't route the Nigeria lane to Reddit.** |
| 7 | **"Put emoji in the TikTok copy."** | **`ad_text` on a non-Spark TikTok ad forbids emoji** — and our copy pipeline is emoji-native. | **Emoji reach TikTok only through Spark Ads**, which use the organic post's caption (max 4 lines, emoji allowed). Note: *"you cannot edit a post's caption after it's been authorized as an ad."* |
| 8 | **"Automate Spark Ads with creators."** | **Code generation is creator-side, in the TikTok app** (video → ⋯ → Ad settings → Generate; 7/30/60/365-day durations). **Cannot be automated.** `tt_video_authorize_apply` only *redeems* a code you already have. Batch ≤20 in Ads Manager. | **An ops flow, not an API** — pair it with influencer-intake. Spark **Push** (from zero posts) is the automatable path today. |
| 9 | **"Target 30+ on Meta."** | **With Advantage+ audience ON (the default since v23.0), `age_min` above 25 is silently unusable and `age_max` is fixed at 65.** | Set `targeting_automation.advantage_audience: 0` — **a deliberate, documented choice with a UI toggle**, because turning A+A off is now against Meta's own delivery advice for broad campaigns. |
| 10 | **"Cap frequency on the traffic campaign."** | **[OFFICIAL, verbatim]** *"Writes to this field are only available in ad sets where **REACH** and **THRUPLAY** are the performance goal."* **Not available on our `LINK_CLICKS`/`LANDING_PAGE_VIEWS` ad sets.** TikTok: `REACH` ads only. Snap: incompatible with multi-format delivery in Auction. | **Gate the UI on the optimization goal or it will 400.** |
| 11 | **"Self-disclose our AI creative on TikTok."** | **`aigc_disclosure_type` is valid only when `identity_type=CUSTOMIZED_USER`** — which **our account class cannot use** (created 2026-04-12, after the 2026-01-15 cutoff). **We cannot self-disclose AI-generated content on TikTok via the API at all.** | **Escalate separately.** Disclose on Meta (`self_ai_disclosure: OPT_IN`). |
| 12 | **"Show me the exact character limit / safe zone / spec."** | **Meta's dedicated Safe Zone article returned title-only across two independent agent passes.** Meta publishes **no** hard API char ceiling for single-image primary text/headline (only the 1024/255 asset-feed maxes) and **no** video bitrate figure. Google publishes **no** aspect-ratio tolerance. **Reddit's spec page is a JS-gated SPA and its OpenAPI encodes zero media constraints.** | **Warn on the soft numbers, hard-reject only on the verified ones, and never invent a constant.** Get a human to open Meta's safe-zone article logged-in and Reddit's spec page in a real browser before we hard-gate on those pixels. |
| 13 | **"Tell me if this ad will be approved."** | Snap *"reserves the right to reject or remove any ad in its sole discretion for any reason."* All five re-review post-launch and can pause a live campaign. **Reddit publishes no review SLA anywhere.** | **We check everything a machine can check** (§1.7) and poll for the verdict. Be honest about the rest. |
| 14 | **"Read the CPA from this $1/day test."** | **~50 optimization events per ad set per 7 days** is Meta's learning-phase exit bar. At $1/day and a ~$0.50 CPC that's **~14 clicks/week** — **unreachable by two orders of magnitude.** It sits permanently in Learning Limited. | **$1/day is a plumbing test, not a performance campaign.** Label it. `learning_stage_info.status = FAIL` is Meta's own prediction. **The moment anyone reads its CPA as signal, it becomes a bug.** |
| 15 | **"Optimize the bids too."** | **Not our job and we shouldn't.** Meta CBO/Advantage+, TikTok auto-optimization, Google Smart Bidding run **within** each channel. | **#884's `I-884-BETWEEN-NOT-WITHIN` is right.** *Meta optimizes within Meta. Google optimizes within Google. **Nobody optimizes between them. We do.*** That's the whole thesis — don't dilute it. |
| 16 | **"Use Smart+ / PMax."** | **TikTok Smart+ has only 3 objectives — no `TRAFFIC`.** Our MVP goal is structurally inexpressible. **Google PMax has no ad groups or ads** and requires a single bulk mutate — our adapter cannot express it. | Smart+ becomes viable via `WEB_CONVERSIONS` **once the pixel has real event volume**. PMax: decide explicitly and record it — **MVP = Search + RSA.** |
| 17 | **"Just point everything at the smart link."** | **Google's destination-mismatch policy, Meta's Circumventing Systems, and Reddit's `BRIDGE_PAGE` are all pointed at exactly that.** No official text exists either way on whether an attribution redirector survives review at scale **[UNVERIFIED]**. | **Per-channel destination** (§1.2): Google gets `final_urls = [canonical]` + OneLink in `tracking_url_template` (**Google's own sanctioned pattern**); Reddit gets `display_url = usemingla.com`; Meta keeps the OneLink **only if the crawler check passes**. **Server 307, never client JS.** Verify with one ad before scaling. |
| 18 | **"Get the numbers from the API."** | **Meta's Insights API deprecated `7d_view`/`28d_view` as queryable `action_attribution_windows` from 2026-01-12.** **28-day click** has been deprecated as a selectable optimization window since 2021-04 (reporting-only via "Compare Attribution Settings"). Google's **GCLID retention is 90 days** — later offline uploads **silently fail**. **Customer Match needs 1,000 users for Search + YouTube** (100 elsewhere). **Consent Mode v2 is mandatory for EEA since March 2024 — directly relevant to London.** | **#865 must not request `7d_view`/`28d_view`.** Budget for the GCLID window. |

### The ten things we must NOT build — each would be wasted work

1. **Text-density / 20% validation** — rule removed ~Sept 2020; **directly confirmed absent from Meta's live ad-standards policy** (fetched; contains no language about text-in-image ratios at all).
2. **AEM 8-event priority ranking** — removed **2023-05-15**. *"You no longer need to prioritize 8 conversion events per domain for web conversion optimization."* Domain verification is **no longer mandatory** for AEM.
3. **A "20% budget-change" learning guard** — **not a Meta rule.** Meta states no percentage; its only example is *"$100→$101 is not significant, $100→$1000 likely is."*
4. **A "2× daily budget" pacing assumption** — it is **175%**, weekly-averaged (Sunday–Saturday), with a **7×** hard ceiling.
5. **Engagement-bait rejection logic** — that's a **ranking demotion** under the Content Distribution Guidelines, **not** an ad-review disapproval. Same for "low-quality/disruptive content". Treat as delivery/cost risk, not rejection risk.
6. **An Advantage+ Shopping/App campaign builder** — **create AND update removed** (v24/v25).
7. **A rejection-appeal API integration** on Meta/Snap/Reddit — none exists.
8. **A video bitrate validator (Meta)** — no official number exists; "5–10 Mbps" is folklore. *(TikTok's ≥516 kbps **is** official — enforce that one.)*
9. **A 60 s / 90 s Reels duration cap** — official is **15 min (IG) / no max (FB)**.
10. **A lookalike ratio capped at 10% (Meta)** — the real range is **1–20%**. *(Snap's **is** 1–10% — don't cross the wires.)*

**Plus two sources to stop trusting:**
- **`ads_get_field_context` is a reporting catalog, not a schema source.** It returns legacy objectives (create fails with VALIDATION), a 19-value `optimization_goal` enum vs the create tool's 26, `bid_strategy` with `enum_values: null`, and **cannot resolve** `billing_event`, `special_ad_categories`, `attribution_spec`, `destination_type`, `promoted_object`, `targeting`, `issues_info`, `ad_review_feedback`, `call_to_action_type`, `publisher_platforms`, `facebook_positions`, `instagram_positions`, `device_platforms`. **This one trap produced wrong conclusions in three of our specs.**
- **Third-party spec blogs.** Meta's current Ads Guide recommends **1440×1800** and **1440×2560** — not the 1080-class figures every blog still cites. Reddit's [3P] numbers contradict each other.

---

## Appendix — open questions for a human

1. **[UNVERIFIED]** Does an AppsFlyer OneLink in `link_url` survive Meta ad review at scale? No official text found either way. **Fetch `dest_smart_link` as `facebookexternalhit/1.1` before live-fire.**
2. **[UNVERIFIED]** Meta's Safe Zone article (help/980593475366490) **never rendered to automated fetch across two independent agent passes**, and the per-placement pages are **internally inconsistent for FB Stories video (20% vs 35% bottom)**. A human should open it logged-in before we hard-gate on those pixels.
3. **[LIVE]** `ads_get_datasets` returns **two entries with the same `dataset_id 1949011972638955`**, `creation_time` 1 second apart. **Confirm one canonical dataset before wiring CAPI.**
4. **[LIVE, verbatim]** *"if you don't see the option to use inventory filter, contact your meta account representative for access"* — **is the inventory filter available to our account?**
5. **Exact permitted `attribution_spec.window_days` per objective** — **[OFFICIAL]** says they vary; **no canonical table exists.** Don't hardcode; validate per-objective at runtime.
6. **Confirm `min_daily_budget_*` live** — two conflicting figure sets exist ($1/$5/$40 vs $0.50/$2.50/$40). **Query `GET /act_{id}/minimum_budgets`.**
7. **Google's live developer-token tier** — **read it in the API Center.** If we're already on Explorer, the "Google is provision-blocked" premise is stale and nothing but the adapter blocks us.
8. **Google's refresh token** — `scratchpad/google_token_resp.json` contains `{"error":"invalid_grant"}`. **Re-verify before any build.**
9. **Snap's Top Snap max duration** — the media doc renders **1800 s**; business-help and [secondary] sources say **3–180 s**. **Validate 3–180 s and confirm live.**
10. **Snap's `brand_name` limit** — the research says **32** (twice); the brief says 25. **Confirm live.**
11. **Reddit's creative specs** — verify §2.5's [3P] rows in a real browser or via `adsapi-partner-support@reddit.com` **before hard-failing anything**.
12. **Reddit's review SLA** — unpublished. **Measure empirically.**
13. **Reddit CAPI scope** — we hold `adsread` + `adsedit`. CAPI needs **`adsconversions`** — a **re-consent, not a config change**. Decide whether Reddit CAPI is in #865's scope; **today it is not.**
14. **Snap's compensating-delete cascade** — **unverified for creative/media** (ad-account-scoped, almost certainly survive). Verify live or accumulate provider-side orphans.
15. **TikTok's fetcher reachability** — nobody has verified TikTok can reach **Bunny** (no hotlink/geo/allowlist analysis exists), and `video_url` has a **10-second request timeout** with a **≤10 MB recommended** size.
16. **`promotion_type: PROMOTE_PLACES`** (Snap) — a promotion type **literally named for our product shape** (venues/places), unevaluated. Test `TRAFFIC` + `PROMOTE_PLACES` vs bare `TRAFFIC` during live-fire.

