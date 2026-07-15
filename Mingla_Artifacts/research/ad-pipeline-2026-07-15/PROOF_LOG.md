# PROOF LOG — Ad Engine capability validation

**Started:** 2026-07-15 (evening session) · **Phase V1 completed same session.**
**Doctrine:** every capability claim carries evidence — a live read-only probe, a validate-only/dry-run call, or an official platform doc URL. Verdicts: **PROVEN / UNPROVEN / IMPOSSIBLE**. An MCP result is directional only — the MCP authenticates as Seth's user, NOT as the engine's tokens (it can see Seth's unrelated personal ad accounts). Engine-credential probes via raw platform APIs are proof-grade.

## Legend
- `[MCP-LIVE]` — live probe via MCP tools (directional; user-scoped credential)
- `[ENGINE-LIVE]` — live probe with the engine's own credential from master keys (proof-grade)
- `[VALIDATE-ONLY]` — dry-run create (Meta `execution_options:['validate_only']`, Google `validateOnly:true`) — **zero objects created, verified**
- `[OFFICIAL]` — platform-owned doc URL
- `[STALE?]` — research-doc claim contradicted by newer evidence

---

## PHASE V1 RESULTS — capability × channel

### Meta (system-user token `Mingla-server`, Graph v25.0)

| # | Claim | Evidence | Verdict |
|---|---|---|---|
| M-P1 | Engine token authenticates | `[ENGINE-LIVE]` `GET /me` → `{"id":"122096902323400833","name":"Mingla-server"}` | **PROVEN** |
| M-P2 | Account ACTIVE + payment | `[MCP-LIVE]` `account_status: ACTIVE`, `has_payment_method: true`, `is_queryable: true`. GR-03 **STALE — resolved**. | **PROVEN** |
| M-P3 | Page promoted under ad account | `[ENGINE-LIVE]` `GET /act_…/promote_pages` → `{"data":[]}` — definitively NOT promoted, even via system user. | **PROVEN (negative)** |
| M-P4 | Page granted to system user | `[ENGINE-LIVE]` `GET /me/accounts` → Page `797406353459597` "Mingla" with tasks `ADVERTISE, ANALYZE, CREATE_CONTENT, MESSAGING, MODERATE, MANAGE, VIEW_MONETIZATION_INSIGHTS`. | **PROVEN** |
| M-P5 | Campaign create shape valid (v25) | `[VALIDATE-ONLY]` `POST /act_…/campaigns` OUTCOME_TRAFFIC/PAUSED → **first failed**: v25 REQUIRES **`is_adset_budget_sharing_enabled`** when not using CBO (subcode 4834011) — **a required field in NO spec**. With it: `{"success":true}`. `GET /act_…/campaigns` after → `{"data":[]}` (nothing created). | **PROVEN + NEW SPEC CORRECTION M-13** |
| M-P6 | Creative create with our `page_id` | `[VALIDATE-ONLY]` `POST /act_…/adcreatives` with `object_story_spec.page_id=797406353459597` → **first run** error **1885183 ("app in development mode")** = **NEW BLOCKER B6**, resolved by Seth flipping app `1270281948368169` to **Live** (2026-07-15). **Re-run after flip: `{"success":true}`** — creative with our page_id validates clean; `GET /act_…/adcreatives` after → `{"data":[]}` (nothing created). **PAGE QUESTION SETTLED: `promote_pages` being empty does NOT block creates — system-user page access (`/me/accounts` with ADVERTISE task) is the sufficient condition and the CORRECT preflight check. GR-02's hard-blocker framing and the blueprint's B1 check are both corrected: preflight must key on `/me/accounts`, not `promote_pages`.** | **PROVEN** |
| M-P7 | Pixel never fired | `[MCP-LIVE]` + `[ENGINE-LIVE]` `last_fired_time` = epoch-0 both browser+server; `NOT_ONBOARDED`. ⇒ `LINK_CLICKS` only honest goal (GR-19 stands). | **PROVEN** |
| M-P8 | Per-category minimum budgets | `[ENGINE-LIVE]` `GET /act_…/minimum_budgets` USD: **imp 100¢ · video_views 100¢ · high_freq 500¢ · low_freq 4000¢** ($1/$1/$5/$40). Settles GR-41 + open-Q6 (the $1/$5/$40 set was right; $0.50/$2.50 set wrong). LINK_CLICKS floor = **$5/day**, NOT $1. #884 floor table must change. | **PROVEN** |
| M-P9 | City targeting buildable (Targeting Search) | `[ENGINE-LIVE]` `GET /search?type=adgeolocation` works with our token. London: **CA key `294545` sorts FIRST**, GB = **`812057`**; Lagos NG = **`1630653`** (PT Lagos second). ⇒ GR-35 buildable now; **Meta needs country-code disambiguation exactly like Google**. | **PROVEN + new hazard noted** |
| M-P10 | IG business account on the Page | `[ENGINE-LIVE]` `GET /797406353459597?fields=instagram_business_account` → field **absent** ⇒ **no IG account linked**. IG surfaces (Feed/Stories/Reels/Explore) unavailable until a human links IG to the Page. GR-34's "resolve via Graph" path proven callable; the asset just isn't there. | **PROVEN (negative) — human unblock** |
| M-P11 | Duplicate dataset rows | `[ENGINE-LIVE]` `GET /act_…/adspixels` → exactly ONE pixel `1949011972638955`. The "duplicate" was an MCP artifact. Open-Q3 CLOSED. | **PROVEN (single canonical dataset)** |

### TikTok (engine long-lived token, v1.3)

| # | Claim | Evidence | Verdict |
|---|---|---|---|
| T-P1 | Engine token works / app approved | `[ENGINE-LIVE]` `tool/region`, `app/list` return `code:0`. GR-04 **STALE — app approved 07-15, token live**. | **PROVEN** |
| T-P2 | GB not targetable | `[ENGINE-LIVE]` `tool/region` TRAFFIC → 2,831 regions across **33 country codes; GB ABSENT**. APP_PROMOTION → same. **London on TikTok is IMPOSSIBLE today.** US ✓ NG ✓ CA ✓. | **PROVEN (negative)** — escalate to TikTok |
| T-P3 | Balance < $20/day floor | `[MCP-LIVE]` `balance: 0.0` (API can't see the $10 portfolio; $10 < $20 anyway). | **PROVEN (blocker stands)** |
| T-P4 | Pixel zero events | `[MCP-LIVE]` `events: []`, `NO_RECENT_ACTIVITY`. No conversion optimization until #865. | **PROVEN** |
| T-P5 | `@usemingla` TT_USER identity | `[MCP-LIVE]` `AVAILABLE`, `can_push_video: true`, `can_pull_video: true`, id `b3f0f8f4-…`. | **PROVEN** |
| T-P6 | CUSTOMIZED_USER barred (account after 2026-01-15) | `[ENGINE-LIVE]` `create_time: 1776026274` = 2026-04-12. GR-25 stands. | **PROVEN** |
| T-P7 | APP_PROMOTION viable (AppsFlyer-linked apps) | `[ENGINE-LIVE]` `app/list` → both apps, `partner_id: 1` (AppsFlyer), `self_attribution_enabled: true`, `skan_allowed: ALLOWED`, `enable_retargeting: RETARGETING`. GR-49 stands. | **PROVEN** |

### Snapchat (refresh→access mint)

| # | Claim | Evidence | Verdict |
|---|---|---|---|
| S-P1 | Token mints (3600 s, both scopes) | `[ENGINE-LIVE]` mint → `expires_in: 3600`, scopes `snapchat-marketing-api` + `snapchat-offline-conversions-api`. | **PROVEN** |
| S-P2 | Ad account ACTIVE | `[ENGINE-LIVE]` `GET /adaccounts/6421cc96-…` → "Mingla Ads", PARTNER, **ACTIVE**, USD. | **PROVEN** |
| S-P3 | Funding servable, $15k/day | `[ENGINE-LIVE]` `GET /organizations/…/fundingsources` → CREDIT_CARD "Mingla LLC Card" **ACTIVE**, `daily_spend_limit_micro: 15000000000`. | **PROVEN** |
| S-P4 | Public Profile `2cfbdc85-…` verifiable by API | `[ENGINE-LIVE]` `GET businessapi…/public_profiles` → **HTTP 403 "unauthorized"** with our marketing-scoped token. Profile is UI-sourced config only. **Blueprint's preflight P3 check for Snap is NOT BUILDABLE with our token** — treat `SNAPCHAT_PROFILE_ID` as trusted config; verify at first creative create (Snap has no validate-only). | **UNPROVEN (unverifiable pre-create)** — accepted residual risk |
| S-P5 | Pixel ACTIVE | `[ENGINE-LIVE]` `GET /adaccounts/…/pixels` → `af5f8fc4-…` "Usemingla Pixel" **ACTIVE**. Envelope shows `request_status` + per-item `sub_request_status` (S-9 double-assert confirmed real). | **PROVEN** |

### Google (dev token + OAuth, v24, MCC 8284700017 → account 3623860476)

| # | Claim | Evidence | Verdict |
|---|---|---|---|
| G-P1 | BASIC tier works on real accounts (v24) | `[ENGINE-LIVE]` `listAccessibleCustomers` 200; `googleAds:search` on `3623860476` → `status: ENABLED`, `testAccount: false`, USD. GR-06 **STALE — BASIC approved 07-15**. Old customer `5083048929` gone; all research evidence re-based onto the new account. | **PROVEN** |
| G-P2 | London geo constant | `[ENGINE-LIVE]` `geoTargetConstants:suggest` (locale en, countryCode GB) → **`1006886` London,England,United Kingdom ENABLED** first result. Country-code-scoped suggest = correct disambiguation path. | **PROVEN** |
| G-P3 | Full SEARCH+RSA chain shape | `[VALIDATE-ONLY]` `googleAds:mutate` `validateOnly:true, partialFailure:false` with temp IDs: budget(-1) → campaign(-2, PAUSED, SEARCH, targetSpend, PRESENCE geo type) → campaignCriterion(London 1006886) → adGroup(-3, SEARCH_STANDARD) → RSA (3 headlines ≤30, 2 descriptions ≤90, finalUrls) → PHRASE keyword. **First run failed: v24 REQUIRES `contains_eu_political_advertising` on campaign create — a required field in NO spec.** With `DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING`: **`{}` = clean validation.** Campaign list after: only the REMOVED wizard campaign — nothing created. | **PROVEN + NEW SPEC CORRECTION G-14** |

### Reddit (refresh mint, descriptive UA)

| # | Claim | Evidence | Verdict |
|---|---|---|---|
| R-P1 | Token + scopes | `[ENGINE-LIVE]` mint → **`expires_in: 86400`** (NOT 3600 — R-2 correction proven on our own account), scopes `adsread adsedit`. `/me` → `t2_2ikkjswp3a` (usemingla). | **PROVEN** |
| R-P2 | Business ID (was partial in master keys) | `[ENGINE-LIVE]` `/me/businesses` → **`950c8eac-da26-45e6-942e-645ed657e43f`** "Mingla". | **PROVEN — captured** |
| R-P3 | Ad account `a2_` id (was TODO) | `[ENGINE-LIVE]` `/businesses/…/ad_accounts` → **`a2_jcfwvnfcfqcs`**, SELF_SERVE, USD, `admin_approval: VALID`. **The master-keys "pixel id" is the SAME string — on Reddit the pixel id IS the ad-account id** (consistent across `/businesses/…/pixels` and `/ad_accounts/…/pixels`). | **PROVEN — captured** |
| R-P4 | Profile `t2_` exists (B5 "no profile") | `[ENGINE-LIVE]` `/businesses/…/profiles` → **`t2_2ikkjswp3a`** "usemingla". B5's profile half is **RESOLVED**; a post CAN be authored. | **PROVEN** |
| R-P5 | Funding servable | `[ENGINE-LIVE]` first probe: `is_servable: FALSE` (`CREDIT_CARD_NOT_APPROVED`, `CREDIT_LINE_EXHAUSTED`) → Seth fixed billing 2026-07-15 → **re-probe: `is_servable: TRUE`, `credit_limit: 100000000` micro ($100), `reasons_not_servable: []`.** Reddit can spend. | **PROVEN (servable)** |
| R-P6 | Community targeting search | `[ENGINE-LIVE]` `/targeting/communities/search?query=london` → r/london (1.56M), LondonPics, MovingToLondon, LondonTravel… **Param is `query=`, NOT `q=`** (`q=` silently ignored, returns popular list — spec-grade detail). | **PROVEN** |

### Destination (GR-32 crawler check)

| # | Claim | Evidence | Verdict |
|---|---|---|---|
| D-P1 | OneLink resolves to real page for Meta's crawler | `[ENGINE-LIVE]` `curl -A "facebookexternalhit/1.1" -L go.usemingla.com/w36m` → **302 to `go.usemingla.com/af-preview/facebook?...&af_robot_sig=…`** serving a stub HTML containing ONLY app-store meta tags (`al:ios:app_store_id`, `al:android:package`, og app title/icon) — **an AppsFlyer app-install interstitial, NOT the destination page**. HEAD → 404. Canonical `usemingla.com` serves 200 to the same UA. | **PROVEN (negative) — the cloaking-pattern risk is REAL, not theoretical** |

**D-P1 consequence (design decision required):** the per-channel destination strategy hardens from "recommended" to **mandatory**: ad-review-visible URLs must be the canonical `usemingla.com/e/…` page on **every** channel (not just Google); the OneLink lives only in tracking templates where the platform sanctions it (Google `tracking_url_template`) or is dropped from ads v1. Meta `link_url = OneLink` is vetoed by this probe until AppsFlyer's crawler behavior is changed/configured and re-proven. (Also: COMMS-0100/0101 — the business OneLink is dead on Android; never use it anywhere.)

---

## NEW DISCOVERIES this session (in no research doc, no spec, no brief)

1. **B6 (Meta, NEW HARD BLOCKER):** dev app `1270281948368169` is in **development mode** — creative create hard-fails (1885183) until the app is switched to **Live** in the App Dashboard. Found only because we ran the validate-only creative probe.
2. **M-13 (Meta, spec correction):** v25 campaign create REQUIRES `is_adset_budget_sharing_enabled` (true/false) when not using campaign budget.
3. **G-14 (Google, spec correction):** v24 campaign create REQUIRES `contains_eu_political_advertising` (enum, e.g. `DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING`).
4. **Meta city-key disambiguation hazard:** Meta's `adgeolocation` search also sorts London,Canada first — the "Google London problem" is cross-channel.
5. **Reddit pixel id == ad-account id** (`a2_jcfwvnfcfqcs`) — the `conversion_pixel_id` GR-12 injects is the account's own id.
6. **Reddit communities search param is `query=`**, `q=` silently no-ops.
7. **Snap preflight P3 unbuildable:** public-profile lookup 403s on our token class — profile is config-trusted until first creative create.
8. **AppsFlyer serves crawlers an interstitial** (`af-preview` + `af_robot_sig`) — D-P1.

## HUMAN UNBLOCK LIST (updated, ranked)

| # | Action | Unblocks | Effort |
|---|---|---|---|
| 1 | ~~Switch Meta app to Live~~ **DONE 2026-07-15** — M-P6 re-run passed | — | ✓ |
| 2 | ~~Fix Reddit billing~~ **DONE 2026-07-15** — funding `is_servable: true` | — | ✓ |
| 3 | **Link the Instagram account to Page `797406353459597`** (Page settings → Linked accounts) | IG Feed/Stories/Reels/Explore — arguably our primary surface | 5 min |
| 4 | **Top up TikTok balance to ≥ $20** | TikTok delivery (first day) | 5 min |
| 5 | **Escalate GB targeting with TikTok** (account-level country allowlist) | London on TikTok | 30 min + external |
| 6 | ~~Conditional Page assignment~~ **NOT NEEDED** — M-P6 proved system-user page access suffices | — | ✓ |
| 7 | **Decide the ad-destination policy** given D-P1 (recommendation: canonical URLs as the ad-visible destination on ALL channels v1; OneLink only in Google's tracking template) | Live spend on Meta/Google/Reddit without account-level risk | decision |

## Channel readiness — after Phase V1

| Channel | Verdict tonight | Remaining gate(s) |
|---|---|---|
| **Meta** | **GREEN — validation-complete** (campaign shape ✓ creative+page ✓ billing ✓; IG link still absent → Facebook-only until linked, re-probed 07-15 post-fix) | build the adapter |
| **Google** | **GREEN — full chain validate-only clean** on the real, billed, ENABLED account | build the adapter |
| **Reddit** | **GREEN-provisioned** (business ✓ account VALID ✓ profile ✓ funding servable ✓) | needs its spec written from scratch; no validate-only exists — first create is the proof |
| **Snapchat** | AMBER-GREEN | profile config-trusted (unverifiable pre-create); spec §4 S-1…S-9 corrections before any code |
| **TikTok** | AMBER | balance top-up · GB impossible (escalate) · US/NG viable today |
