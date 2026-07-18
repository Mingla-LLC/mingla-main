# SPEC — Campaign Builder UI: pick media, target a live public page

**Issue:** GitHub #864 (child of initiative #852 "[Full Rooms] Internal Ad & Reservation Engine")
**Mode:** SPEC · **Design contract:** `Mingla_Artifacts/reports/UI_UX_ISSUE-864_CAMPAIGN_BUILDER.md` (embedded/referenced below)
**Worktree:** `~/Desktop/mingla-orchs/issue-864-campaign-builder-ui/` on branch `issue-864-campaign-builder-ui` (branched off `issue-862-meta-ads-api`)
**Hard dependency:** **#862** (Meta connection + `admin-meta-*` edge functions + `meta_campaigns` data model). #864 is the UI layer over #862's engine; it does **not** re-spec the backend.
**Downstream routing:** this SPEC → `mingla-implementor` → `mingla-tester` → orchestrator CLOSE
**Author:** mingla-forensics (design by mingla-designer, inline) · **Date:** 2026-07-14

> **User story (verbatim):** "As a Mingla admin, I can build a campaign in-app: choose creative media and target a specific live public page (venue/event/trip) as the destination." AC: media picker; public-page selector; channel/budget/audience form; review & submit to Meta/TikTok.

---

## Amendment A1 (2026-07-14) — goal-first objectives + smart-link destination

**Two corrections from the "complex formats, simple screen" direction:**

**(1) Goal-first objective step (replaces the plain "objective select" in Step 4).** Step 1 (or a lead sub-step) asks in plain language **"What's the goal of this campaign?"** with four cards, each silently mapping to the Meta objective + optimization + audience underneath — so an admin never touches Meta jargon:
- **Send people to a page** → `OUTCOME_TRAFFIC` + `LANDING_PAGE_VIEWS`. **Active now.**
- **Build awareness** → `OUTCOME_AWARENESS` + `REACH`. **Active now.**
- **Get purchases / reservations** → `OUTCOME_SALES` + `OFFSITE_CONVERSIONS`. **Ships WITH #865** — it cannot function without #865's Pixel/CAPI (there is no purchase signal to optimize toward until then).
- **Bring back past visitors (retargeting)** → a retargeting **custom audience**. **Ships WITH #865** — there is no tracked-visitor audience to retarget until then.
Any power-user knobs (exact objective, optimization goal, bid) hide behind an **"Advanced"** disclosure. This is how the builder supports complex formats without a complex screen.

**No half-built placeholders.** #864 ships **Traffic + Awareness** fully working and shows **only** those. The goal step is built **config‑driven/extensible** (a goals array, not two hardcoded branches) so Purchases + Retargeting are a **small additive change delivered inside the #865 release, fully functional** — NOT dead/greyed buttons shown to the admin now. (This is an internal tool; surface only what works.) The extensibility is architecture, not a shipped half-feature.

**(2) The destination is a SMART LINK, not a raw URL.** Per #862 Amendment A1, the ad points at an AppsFlyer OneLink (`go.usemingla.com`) that opens the Mingla app if installed, else the public web page, carrying attribution. The Step 2 destination preview therefore shows the smart link with a plain-language note: **"Opens the Mingla app if installed, otherwise the web page."** The builder still lets the admin pick the public page; #862 builds the smart link server-side. (Business-app-open is pending the business OneLink going live — surfaced as an info note, not a blocker; consumer app-open + web fallback work now.)

**Dependency note:** Purchases + Retargeting are delivered **as part of the #865 release** (they depend on its tracking), added into the extensible goal step then — not shown to the admin as disabled placeholders in #864.

---

## Amendment A2 (2026-07-14) — audience/lane selector (consumer vs business)

Per #862 Amendment A2, the engine holds **one connection per lane**. The builder's **first decision** is "**Who are you advertising to?**" → **Consumers** (Mingla lane → ads drive to live public pages) or **Businesses** (Mingla Business lane → ads drive businesses to the Mingla Business signup/claim flow). This selection picks the `meta_ad_connections` row and thereby the ad account, Page, pixel, destination source, and token — everything downstream keys off it.
- **Consumers** lane = **active now** (provisioned): destination picker reads `business_public_events_view` (as specced).
- **Businesses** lane = **shown, disabled** until the business lane is provisioned (same forward-compatible pattern as the locked goals in A1): destination = Mingla Business signup/claim URL (TBD).

Order: **audience/lane → goal (A1) → destination → media → budget → copy → review**. The lane selector sits above the goal-first step.

---

## Amendment A3 (2026-07-14) — the builder targets the generalized 5-channel engine

Per **#862 Amendment A3**, the backend is no longer Meta-only: it is one platform-agnostic, lane-aware engine (`ad_connections`/`ad_campaigns`/`ad_sets`/`ads` + a `ChannelAdapter`) with **five provisioned channels** — Meta, TikTok, Snapchat, Google, Reddit. The builder is amended to target it. This is an amendment, not a rewrite: the wizard shape, steps, states, a11y and design contract (§4) stand; only the create path is generalized and Step 1 becomes a real multi-channel picker.

**(1) ONE create flow, parameterized by `platform` + `lane`.** The builder assembles a single request and posts it to the generalized **`admin-ad-create-campaign`** endpoint (#862 A3 §C) — replacing the Meta-only `admin-meta-create-campaign` in §4.3/§4.4. The payload gains `platform` + `lane` (the lane already comes from A2); the rest of §4.4's body is unchanged. `getConnectionStatus()` calls **`admin-ad-connect` `{platform, lane, action:'status'}`**. The service file (§4.3 `metaAdsCampaigns.js`) generalizes to an `adEngine.js` wrapper over `admin-ad-*`.

**(2) Channel picker (replaces the Meta-active / TikTok-"coming-soon" Step 1).** Step 1 becomes "**Which network?**" showing only the channels whose `ad_connections` row is **GREEN (connected)** for the selected lane: **Meta, Snapchat, Google, Reddit** are selectable now; **TikTok** shows **"Coming soon"** (disabled) until its app review clears and the token lands. The picker reads live connection state per `(platform, lane)` and fail-closes exactly as SC-2 already specifies — a channel that isn't connected can't be built on (Next disabled + Connect CTA). Same forward-compatible, config-driven pattern as A1's goals and A2's lanes: a channels array, not hardcoded branches, so a channel flips from disabled→active when its connection turns GREEN, with no new dead UI.

**(3) Per-platform capability flags.** Objectives, optimization goals, and placements differ per network — the builder keys the goal step (A1) and any placement/format controls off a **per-platform capability map** (e.g. Meta = `OUTCOME_TRAFFIC`/`OUTCOME_AWARENESS`; TikTok = `TRAFFIC`; Snapchat = `TRAFFIC` (Swipes / Landing-page views); **Google = Search / Display** channel types with maximize-clicks; **Reddit = ad groups**, CLICKS). Only the goals a channel can actually fulfil render for it; the A1 "no half-built placeholders" rule holds per channel. Advanced (exact objective/optimization/bid) stays behind the A1 "Advanced" disclosure, scoped to the picked platform.

**(4) Reuse A2's audience/lane selector, unchanged.** Order becomes **audience/lane → channel → goal → destination → media → budget → copy → review**. The lane selector (A2) still picks the `ad_connections` family; the channel picker then narrows to a platform within that lane.

**(5) Destination stays the smart link (A1 / #862 A1).** Every channel's ad points at the AppsFlyer OneLink (`go.usemingla.com`) built server-side by `admin-ad-create-campaign`; the builder still lets the admin pick the public page and shows the "Opens the Mingla app if installed, otherwise the web page" note. Media continues through the `meta-ad-creatives` bucket (§4.5); when #866's picker lands, the payload carries `creative_id` (→ `ads.creative_id`) instead of a raw `image_url`, resolved per-platform at create — additive, no builder rewrite.

**Coherence:** the §4.4 payload, §4.5 storage bucket, §5 success criteria, §6 invariants (create-PAUSED, admin-write bucket, token isolation) and §11 allowlist all carry over; only the endpoint names (`admin-meta-*` → `admin-ad-*`) and the Step-1 channel set change. The strict-grep RT-3 gate widens to forbid **any** platform token/Graph host in `mingla-admin/src/**`, not just Meta's.

---

## Amendment A4 — battle-test corrections (2026-07-15, evidence-backed)

**Provenance.** This amendment re-bases the builder on the live battle-test of all five channels: `PIPELINE_BLUEPRINT.md` §1.0–§1.9 (the corrected operator journey — it **supersedes this spec's step order**), `GAP_REGISTER.md` (rows cited per item), and `PROOF_LOG.md` (engine-credential probes, validate-only creates, 2026-07-15). Research folder: `issue-862-meta-ads-api/Mingla_Artifacts/research/ad-pipeline-2026-07-15/`. Append-only: where A4 conflicts with A1–A3 or §1–§11, **A4 wins**; no body text is rewritten.

### A4.0 · Canonical decisions (conductor-fixed, identical across all parallel amendments)

1. **The wizard spine becomes:** `lane → preflight → goal(s, multi-select) → destination → audience → budget & schedule → creative → copy → preview & policy pre-check → review & launch`. **The channel picker is no longer an operator step** — it is an **output** of `preflight ∩ goal ∩ market ∩ budget`. The operator says what they want; the engine says which channels can do it and why the others can't. Manual override survives in **Advanced** via #884's `channel_allowlist`. This supersedes A2's order, A3(2)'s "Which network?" Step 1, and A3(4)'s `audience/lane → channel → goal → …` order. *(Evidence: blueprint §1 spine + §1.0 correction: "GREEN currently means a token minted, not an ad can run".)*
2. **Everything is created PAUSED.** Launch is a **separate, explicit action on the campaign surface, never in the builder**. This re-affirms SC-10 / I-PROPOSED-864-CREATE-PAUSED and extends it across all five channels (Reddit's `configured_status` defaults to ACTIVE — the adapter sends `"PAUSED"` explicitly at all three levels; the builder must never rely on a provider default). *(Evidence: blueprint §1.8 create sequence.)*
3. **Destination policy v1 (supersedes A1(2) and A3(5)).** PROVEN: AppsFlyer serves crawlers an app-install interstitial — `curl -A "facebookexternalhit/1.1" go.usemingla.com/w36m` → 302 to `af-preview/facebook` stub with only app-store meta tags, not the event page. Therefore: the **ad-visible destination is the canonical `https://usemingla.com/e/{brand_slug}/{slug}` on ALL channels**; the OneLink lives **only inside Google's `tracking_url_template`** (Google's own sanctioned pattern); **`minglabiz.onelink.me` is never used anywhere** (dead on Android). The Step-2 destination preview shows the canonical URL as the ad's link; the "opens the app if installed" note applies only where a tracking template carries the OneLink. *(Evidence: PROOF_LOG D-P1 + consequence note; blueprint §1.2 destination-mismatch table.)*
4. **Budget floors are per-channel AND per-category.** Meta's $1/day is the **impressions floor only** — live-probed USD minimums: imp 100¢ · video_views 100¢ · **high_freq 500¢** · low_freq 4000¢, so **LINK_CLICKS = $5.00/day floor**. TikTok **$20/day per ad group**. Snapchat **$5/day squad / $20/day campaign**. Google: no hard API floor, **practical $5–10/day**, with the 2×-daily-overspend disclosure (monthly ≤ daily × 30.4). Reddit: **no invented floor** — the OpenAPI encodes none; let the API 400 and surface it. Currency input is **dollars-in / cents-at-rest** (`CurrencyInput` unchanged; conversion to micro/dollars is the adapter's job at the API boundary, never the builder's). *(Evidence: PROOF_LOG M-P8; blueprint §1.4 floor table.)*
5. **Until pixels fire, goals are limited to what's honest:** Meta `LINK_CLICKS` (not `LANDING_PAGE_VIEWS` — the pixel has never fired, epoch-0 browser AND server), Snap `SWIPES` (not `LANDING_PAGE_VIEW`). The **"Reservations / purchases"** and **"Bring back past visitors"** goal cards are **HIDDEN entirely** (ship with #865, fully working) — no half-built placeholders, per A1's own rule. *(Evidence: PROOF_LOG M-P7, T-P4; blueprint §1.1 grey-out table.)*

### A4.a · Preflight Step-0 screen (new step, blueprint §1.0)

**Old:** no preflight step. A3(2)'s channel picker showed any channel whose `ad_connections` row is GREEN — necessary but **not sufficient** (three of four "GREEN" channels could not actually deliver an ad on the day the register was written).
**New:** a **Channel health** panel rendered above the wizard on `#/campaign-builder` entry (also standalone `#/ad-engine/health`), one row per `(platform, lane)`, fed by `admin-ad-preflight`. Per-channel checks P1–P6 per blueprint §1.0, **re-based on the PROOF_LOG live verdicts**:

| # | Check | Re-based detail (2026-07-15) |
|---|---|---|
| P1 | Token valid | Meta `GET /me` (system user proven) · TikTok token LIVE (app **approved 07-15** — B2 resolved) · Snap mint 3600s · Google **BASIC tier approved 07-15**, real Ads call 200s on account `3623860476` · Reddit mint (`expires_in` **86400**, not 3600) |
| P2 | Billing / funding | Meta `account_status: ACTIVE` + `has_payment_method: true` (old UNSETTLED amber resolved) · TikTok **balance $0 vs $20/day floor — AMBER stands** · Snap funding ACTIVE ($15k/day limit) · Google account ENABLED, billed · Reddit funding **`is_servable: true`** (fixed 07-15) |
| P3 | Identity | **Meta: key on `GET /me/accounts` returning the Page with the `ADVERTISE` task — NOT `promote_pages`.** Live-proven: `promote_pages` returns `{"data":[]}` for us AND the validate-only creative create with our `page_id` **succeeds** — system-user page access via `/me/accounts` is the sufficient condition; the blueprint's B1 check as written is corrected. · **Snap: config-presence only** — the Public Profile lookup on `businessapi.snapchat.com` returns **HTTP 403 with our marketing-scoped token**, so the API check is NOT buildable; treat `SNAPCHAT_PROFILE_ID` (env-var name) as trusted config and verify at first creative create (Snap has no validate-only). Document this "why" inline on the card. · Reddit profile `t2_` **captured — resolved** |
| P4 | Pixel firing | Meta epoch-0 (never fired) · TikTok `events: []` · both drive canonical decision 5. Snap pixel ACTIVE. |
| P5 | Review / access tier | **NEW Meta check — app is Live (B6):** validate-only creative create hard-failed with error **1885183 "app in development mode"** until the dev app was flipped to Live (done 07-15). This is a **proven blocker class**; the preflight re-asserts Live so a dashboard toggle can't silently kill creates. · Google reads the live dev-token tier (TEST-tier B4 **resolved**, guard regression). |
| P6 | Market reachable | **TikTok via live `tool_region_get` — never a build-time map:** GB is **absent** from the 33 returned country codes (proven for BOTH `TRAFFIC` and `APP_PROMOTION`) — London campaigns exclude TikTok; US/NG/CA reachable. Fail loudly on an unavailable market, never drop it silently. |

**The five hard-blocker cards, updated to current reality.** B1 (Meta page) → check re-keyed on `/me/accounts`+`ADVERTISE`, currently **passing**. B2 (TikTok app review) → **resolved**; its slot is now the amber "balance $0 vs $20/day" card. B3 (Snap profile) → downgraded to config-presence with the 403 explanation. B4 (Google TEST tier) → **resolved** (full SEARCH+RSA chain validated clean). B5 (Reddit profile + funding) → **both resolved**. The screen's job is now **regression-guarding and future lanes/portfolios** — the cards stay implemented and fire when reality regresses. Amber note also surfaced: **Meta IG account NOT linked** to Page `797406353459597` (`instagram_business_account` field absent) → **Facebook-only until a human links IG**; the builder shows this as an info card, not a blocker.
**Evidence:** blueprint §1.0 (P1–P6, B1–B5, A1–A4); PROOF_LOG M-P3/M-P4/M-P6 (page check), M-P2 (billing), B6 + M-P6 (app-Live), S-P4 (Snap 403), T-P1/T-P2/T-P3 (TikTok), G-P1/G-P3 (Google), R-P4/R-P5 (Reddit), M-P10 (IG).

### A4.b · Per-channel copy caps replace the Meta-only hints (Step "Copy")

**Old:** §4.1/UI_UX render **Meta** soft-caps (primary ~125, headline ~40) as amber hints, applied to every channel. 125 > TikTok's hard 100 — **our UI actively guides admins into a TikTok validation error**.
**New:** **one shared composer, per-channel counters, per-channel hard caps — never one shared cap**, with a **live truncation preview strip** under the composer showing exactly what each channel renders (blueprint §1.6 mock). The limits table, verbatim from blueprint §1.6:

| Field | Meta | TikTok | Snapchat | Google | Reddit |
|---|---|---|---|---|---|
| **Primary / body** | **≤1024 hard** [OFFICIAL API max]; **warn >125** (mobile-feed truncation), warn >60 (FB Reels overlay) | **`ad_text` ≤100 hard, NO EMOJI** | — | — | `body` ≤40,000 [SPEC]; headline **no schema limit** ⚠ |
| **Headline** | **≤255 hard**; warn **>27** (FB Feed), >40 (IG), >10 (FB Reels overlay) | — | **≤34 hard** | RSA **≤30 hard**; Demand Gen ≤40; PMax `LONG_HEADLINE` ≤90 | policy **≤300**; warn **>100**, warn **>80** |
| **Description** | ≤255 hard; warn >30 (Marketplace) | — | — | RSA **≤90 hard** (max 4) | — |
| **Brand / business name** | — | `display_name` 1–40 Latin / 1–20 CJK | **`brand_name` ≤32** — **leaving it null is often safer** (defaults to the Public Profile's brand name, guaranteeing a policy match) | ≤25 | — |

Contract points the implementor MUST honor:
- **Meta:** reject only at the hard 1024/255; the 125/27 figures are render-truncation **warnings** — *"Do not reject at 125"* (truncation is line-wrap/device-driven, not a fixed index).
- **TikTok:** `ad_text` >100 → **hard reject**; emoji → **strip-with-explanation**: *"TikTok doesn't allow emoji in ad text on a normal ad. We stripped them for the TikTok version — the other channels keep them. (Emoji only work on TikTok through Spark Ads, which use the original post's caption.)"*
- **Google:** **3–15 headlines ≤30** each, **2–4 descriptions ≤90** each (both repeatable fields, seeded from Headline/Description); **keywords are REQUIRED for a Search campaign** (reject with the venue-name/neighbourhood suggestion copy); and **drop `call_to_action_type` from the Google payload entirely** — it is not an RSA field; Search ads have no CTA button. §4.4's payload carries it for Meta only; the Google adapter must never receive it.
- **Reddit:** headline **>300 block** (passes create with a 201 then fails review hours later — validation is ours or we eat the rejection), **>100 warn**, **>80 warn**; **ALL-CAPS block** (Reddit has a literal `CAPITALIZATION` rejection reason; Google rejects the same pattern).
- **Counting:** CJK/double-width characters count **×2** (TikTok verbatim; Google same rule) — the counters count by weight, not `.length`.

**Evidence:** GR-27, M-7; blueprint §1.6 (limits table, validation messages, truncation strip, `call_to_action_type`-not-an-RSA-field note).

### A4.c · Dropzone / creative hints corrected (Step "Creative")

**Old:** §2.4/SC-4's uploader hint is **"≥1080×1080 · 1:1 or 1.91:1 · ≤30 MB"** — Meta ratios and Meta's byte cap, shown for every channel. A 30 MB image passes our gate and fails Google's 5,120 KB limit and Snap's 5 MB limit (both 6× tighter); a 1:1 asset ships byte-identical into TikTok/Snap 9:16 placements.
**New:** the Meta-shaped hint is **replaced by per-channel requirements fed from the #866 validator** (server-side byte-probe — never trust admin-supplied dimensions): per-channel byte caps surfaced in the dropzone (**Snap 5 MB, Google 5,120 KB**, Meta 30 MB), **9:16 variant** slots (4:5 / 1:1 / 9:16 auto-derived from one master, with the crop explanation message), and **audio-required flags** for video (Snap auto-rejects silent video as "Low-Quality Creative"; TikTok requires audio). The `meta-ad-creatives` bucket's 30 MB limit remains the **storage** bound only — it is no longer presented as the acceptance criterion. Validation tiers per blueprint §1.5: auto-fix (resize/re-encode/crop) → warn (safe-zone risk, unverifiable [3P] numbers — all Reddit pixel specs are warn-only) → hard-reject (no audio, over-duration, letterboxing, watermarks).
**"Continue anyway (build paused)"** is allowed past **amber** findings only (everything is created PAUSED, so building while a human clears billing is legitimate) — **never past hard blockers**: a hard blocker makes the create call itself fail, so offering the button there would be a lie.
**Evidence:** GR-22 (the hint steers admins wrong; per-channel caps), GR-23 (one image + Advantage+ placements ON → auto-crop into 9:16 with 14%/35% under UI chrome); blueprint §1.5 (byte-probe design decision, auto-fix/warn/reject tiers) + §1.0 buttons (Continue-anyway semantics).

### A4.d · Policy pre-check panel (new sub-step of Preview, blueprint §7b)

**Old:** no policy checking of any kind; `special_ad_categories` hardcoded `[]` in §4.4's payload with no UI.
**New, four controls:**
1. **Personal-attributes linter** — **warn-only, never hard-block** (false positives on a social product are guaranteed) — the 4 patterns: (1) `/\b(are|do|did|have|has|is)\s+(you|your)\b/i` (the interrogative is Meta's most-cited violating pattern); (2) `you|your` within N tokens of a protected-attribute term; (3) presumed-state phrasings (*"tired of…"*, *"struggling with…"*, *"still single"*); (4) name insertion. **Ship Meta's rejected→compliant examples inline in the panel**, not as a docs link.
2. **Reddit DATING lexicon rule** — Mingla's "not a dating app" positioning is now also a **delivery rule**: `rejection_reason` includes `DATING` + 4 variants. The linter flags "meet someone/meet people" phrasings when Reddit is in the channel set: **say "plan the night", never "meet someone."**
3. **Alcohol-adjacency warning** for nightlife creative: Reddit has 7 `ALCOHOL*` rejection reasons and `ALCOHOL_AGE_TARGETING` forces age targeting **Reddit's API cannot express**; Google and Snap restrict alcohol too. Warning copy per blueprint: *"Consider leading with the room and the music, not the drinks."*
4. **`special_ad_categories` selector** — collected and validated, never hardcoded `[]`. Whitelist `HOUSING | EMPLOYMENT | FINANCIAL_PRODUCTS_SERVICES | ISSUES_ELECTIONS_POLITICS | NONE`; **`CREDIT` is REJECTED with a migration message** (retired 2025-01-14 → `FINANCIAL_PRODUCTS_SERVICES`). Selecting a category renders the **restriction-cascade preview** before the Meta call: age forced 18–65, gender unavailable, radius min 15 mi/25 km, no location exclusion, no lookalikes, `special_ad_category_country` required.

**Evidence:** GR-45 (linter patterns + inline guidance), GR-46 (DATING/ALCOHOL families); blueprint §7b (verbatim rule text, cascade table, CREDIT retirement).

### A4.e · Honest-numbers UX (Budget + Review steps)

**Old:** the builder validates budget ≥ min and says nothing else; SC-7's success panel implies the numbers will mean something.
**New:**
- **Learning-phase badge:** warn at create when `daily_budget × 7 ÷ estimated_CPA < 50` (Meta's learning exit bar is ~50 optimization events/ad set/rolling 7 days; a $1–5/day campaign is a plumbing test and will sit Learning Limited — surface *"Treat the numbers as directional only"*). Post-create, `learning_stage_info.status` drives the badge on the campaign surface.
- **Pacing disclosures** on the budget step and the launch confirm: **Meta may spend up to 175% of daily on a single day, weekly-averaged Sun–Sat, never >7× total** (175%, not the folklore 2×); **Google up to 2× daily, monthly ≤ daily × 30.4**. The confirm modal copy per blueprint §1.8: *"This starts spending up to ${n}/day (Meta can spend up to 175% of that on a busy day, evening out across the week)."*
- **The launch-confirmation summary** per blueprint §1.8: per-channel rows (allocated $/day · status · goal), blocked/excluded channels **with the reason inline** (e.g. *"Not available: TikTok can't target the UK"*), destination + creative + copy check lines, and the amber warnings (billing, learning-phase) — all rendered before the separate Launch action.

**Evidence:** GR-47 (learning-phase math + badge); blueprint §1.4 (pacing truths table, 175%/2×/30.4×), §1.8 (confirmation layout + modal copy).

### A4.f · Audience step corrections (GR-35)

**Old:** §4.4's `targeting:{ countries, age_min, age_max, genders? }` — countries-only. A Lagos-venue campaign targeting `countries:["NG"]` sprays a nation to fill one room.
**New:**
- **City + radius are first-class fields** (city search + chips, radius slider default 10 mi, venue pin-drop from `place_pool.lat/lng`). Meta city keys come from the new **admin-gated targeting-search proxy** (`admin-ad-targeting-search` → Graph `GET /search?type=adgeolocation` etc. — token stays server-side; this is the builder's data source). **Live-proven hazard: Meta's own search sorts London,Canada FIRST** (CA key `294545` before GB `812057`; Lagos NG `1630653` with Lagos,Portugal second) — the picker **must disambiguate by `country_code`**, exactly like Google's geo-resolver; never resolve on name order.
- **Advantage+ audience age-cap rule:** with Advantage+ audience ON, Meta accepts `age_min` only up to 25 (and pins `age_max` at 65). The builder **rejects-with-explanation**: *"To target 30+, turn Advantage+ audience off in Advanced (it'll narrow your reach and Meta advises against it)."*
- **Reddit "no age targeting" passthrough note:** Reddit has **no age field at all** — render the passthrough note verbatim: *"Reddit can't target by age at all — this campaign will reach adults of any age there. If age matters for this creative, exclude Reddit."*
- **Per-channel gender enums** (mapping layer, one UI control): Meta `1`/`2` (no non-binary value documented — omit for "All"); Snap `MALE|FEMALE`; TikTok `GENDER_FEMALE|GENDER_MALE|GENDER_UNLIMITED`; Google `MALE=10, FEMALE=11, UNDETERMINED=20`; Reddit `FEMALE, MALE, null`.

**Evidence:** GR-35 (extended targeting shape, proxy edge fn, place_pool resolution); PROOF_LOG M-P9 (city targeting buildable NOW with our token + the London,Canada-first hazard); blueprint §1.3 (3a geo fields/validation, 3b Advantage+ row + Reddit passthrough + gender enums).

### A4.g · Frequency cap gating, Google toggle-negative, and the ad-preview step

- **Frequency-cap control is gated on optimization goal.** Meta's `frequency_control_specs` is writable **only on `REACH`/`THRUPLAY` ad sets** [OFFICIAL] — on our `LINK_CLICKS` traffic ad sets the write **400s**. If the control is ever exposed, it renders only when `optimization_goal ∈ {REACH, THRUPLAY}`; otherwise it is absent (not disabled — absent). *(Evidence: GR-63; blueprint §1.9/§3 frequency rows.)*
- **Google "toggle negative" is remove + create.** `AdGroupCriterion.negative` is **IMMUTABLE** — a keyword cannot be flipped positive↔negative by update; any toggle affordance in the keywords UI is implemented as **remove the criterion + create a new one**, never an update (an update-based toggle will fail). Also encode the adjacent caps: ≤3 enabled RSAs/ad group, keyword ≤80 chars/≤10 words, final URL ≤2,084 bytes. *(Evidence: GR-73.)*
- **Ad-preview step wired per blueprint §1.7.** Entities are created PAUSED, so previewing after create is free and safe — previews render **before** the operator clicks Launch: **Meta 3 formats** (`MOBILE_FEED_STANDARD`, `INSTAGRAM_STORY`, `INSTAGRAM_REELS` via `GET /{ad_id}/previews`), **TikTok** `creative_ads_preview_create`, **Reddit** `preview_url` (+ `?comment_ad={{Preview ID}}` for the conversation placement). **Where no API preview exists, draw a safe-zone overlay** on the creative: Meta 9:16 marks `y<269px` / `y>1248px` on 1080×1920 (14%/35%); Snap marks `y<150` / `y>1770`; Reddit marks the bottom ~20%. Google has no RSA preview — surface Ad Strength instead (informational, never a gate). *(Evidence: GR-33 — "highest value-per-line-of-code in this entire register"; blueprint §1.7a.)*

### A4.h · Flagged contradictions this amendment supersedes

| # | Where | The contradiction | Resolution |
|---|---|---|---|
| 1 | A1(2), A3(5) | "The destination is a SMART LINK" as the ad's visible URL | **Superseded by A4.0(3)** — D-P1 proved the OneLink serves crawlers an app-install interstitial (the cloaking pattern Meta/Google/Reddit police). Canonical URL on all channels; OneLink only in Google's tracking template. |
| 2 | A3(2) | Channel picker = "channels whose `ad_connections` row is GREEN" | Necessary, not sufficient — GREEN meant "token minted". **Superseded by A4.0(1) + A4.a**: channel set = preflight ∩ goal ∩ market ∩ budget, no operator channel step. |
| 3 | A3(2) | "TikTok shows Coming soon until its app review clears" | App review **cleared 07-15** (token live). TikTok's real gates are balance ($0 vs $20/day) and GB untargetable — the preflight cards say so. |
| 4 | §4.4 | `optimization_goal:'LANDING_PAGE_VIEWS'` as a first-class option | Pixel epoch-0 ⇒ **`LINK_CLICKS` only** until #865 (A4.0(5)). LPV returns when the pixel fires. |
| 5 | §4.4 | `call_to_action_type` in the one generalized payload | Meta/TikTok/Snap/Reddit only — **never sent to Google** (not an RSA field, A4.b). |
| 6 | SC-5 / T5 | "min $1.00/day" as the Meta budget floor | $1 is the impressions floor; **LINK_CLICKS = $5/day** (live `minimum_budgets` probe). SC-5's check reads the per-category minimum for the chosen goal; T5's constant updates accordingly. |
| 7 | §2.4 / SC-4 | "≥1080×1080 · 1:1 or 1.91:1 · ≤30 MB" uploader hint | Meta-shaped; **superseded by A4.c** per-channel requirements from the #866 validator. Bucket 30 MB stays as storage bound only. |
| 8 | Blueprint §1.0 B1 itself | B1 keyed the Meta page check on promotion under the ad account | **PROOF_LOG M-P6 corrected the blueprint too:** `/me/accounts` + `ADVERTISE` task is the sufficient condition and the correct preflight key; `promote_pages` empty does not block creates. A4.a encodes the corrected check. |

**Downstream note:** items A4.a (preflight edge fn), A4.f (targeting-search proxy), and A4.g (preview wiring) consume #862-family endpoints (`admin-ad-preflight`, `admin-ad-targeting-search`) that are specced on the #862 side; this amendment binds only the builder UI contract to them. The §11 allowlist widens accordingly at implementation dispatch — via the normal SPEC_AMENDMENT path, not silently.

---

## 1. Executive summary

Build the **Campaign Builder** — a dedicated multi-step admin screen (`#/campaign-builder` in `mingla-admin`) that lets an admin assemble a Meta ad campaign visually: pick the **channel**, pick a **live public page** as the destination, **upload the ad image**, set **budget & audience**, write **ad copy**, then **review** against a live Facebook-style preview and **create it (paused)**. Submit calls #862's `admin-meta-create-campaign` endpoint; the created campaign lands PAUSED in #862's campaign surface with the Launch control.

This is the **UX half** of the Meta ad engine. #862 built the plumbing (connect, create/launch/pause, persist); #864 gives an admin a builder that doesn't require touching Meta Ads Manager or the raw API. Channel selection is **forward‑compatible** (Meta active now; TikTok visible‑but‑disabled, wired in #863).

---

## 2. Scope & non‑goals

### In scope
1. `#/campaign-builder` route + left‑nav entry, gated to active admins (existing `AuthContext`).
2. **Step 1 Channel** — Meta (active) / TikTok (disabled, "Coming soon"); surfaces #862's connection state (fail‑close: can't build if Meta not connected).
3. **Step 2 Destination** — searchable picker of **live public pages** from `business_public_events_view` (+ brands for brand pages); resolves and previews the public URL.
4. **Step 3 Media** — upload ONE ad image to a new Storage bucket; client‑side validation; preview.
5. **Step 4 Budget & audience** — objective (Traffic default), daily/lifetime budget (min enforced from the connection), country multiselect + age.
6. **Step 5 Ad copy** — primary text, headline, description, CTA.
7. **Step 6 Review** — summary + live ad preview + "Create campaign (paused)" → #862 create endpoint.
8. One **backend addition**: a public‑read Supabase Storage bucket `meta-ad-creatives` + admin‑write policy (so uploaded images have a URL Meta can fetch).

### Non‑goals (explicit)
- **All Meta API plumbing, the data model, launch/pause, connection** → **#862** (consumed, not rebuilt).
- **TikTok submit** → **#863** (channel shown but disabled here).
- **Attribution / conversion reporting** → **#865**.
- **Reusable creative library / browse‑and‑reuse venue media** → **#866**. #864 uploads a **single** image per campaign; it does not build a library. (The `meta-ad-creatives` bucket introduced here is the shared substrate #866 will extend.)
- **Draft persistence / "save & resume"** — not in this story; an in‑progress build is client‑state only, guarded by a discard confirm. (Open Decision OD‑3.)
- **Editing an existing campaign's creative/budget after creation** — out; create‑only here.
- **Consumer/business apps, public web** — untouched (public web read‑only as the destination source).

### Assumptions
- #862 is merged (or co‑developed on the stacked branch) before #864 ships; the create endpoint contract is exactly as in `SPEC_ISSUE-862_META_ADS_CAMPAIGN_ENGINE.md` §4.4(b).

---

## 3. Cross‑Surface Impact Declaration (MANDATORY)

| # | Surface | Covered? | User‑visible behavior | Files touched | Parity |
|---|---------|----------|-----------------------|---------------|--------|
| 1 | Consumer iOS | No | none | none | n/a |
| 2 | Consumer Android | No | none | none | n/a |
| 3 | Buyer/anon Web (`mingla-business`) | **Reference only** | its live public pages are the selectable destinations + the ad's link target (read‑only) | none (reads `business_public_events_view`) | n/a |
| 4 | Business iOS | No | none | none | n/a |
| 5 | Business Android | No | none | none | n/a |
| 6 | **Admin Web** (`mingla-admin`) | **YES — primary & only** | the entire Campaign Builder screen | `mingla-admin/src/**` | single surface — no cross‑platform parity |
| 7 | Business Web preview | No | none | none | n/a |
| — | **Backend** (`supabase/`) | **YES — minimal** | one Storage bucket + policy | `supabase/migrations/**` (bucket + RLS) | server‑authoritative |

**Not‑covered reasons:** the builder is an internal admin tool; it only *reads* the existing public‑page contract and *calls* #862's endpoints. No consumer/business/public‑web behavior changes.

---

## 4. Layered specification

### 4.1 Design contract (embedded — full pixel detail in `UI_UX_ISSUE-864_CAMPAIGN_BUILDER.md`)

The design artifact is binding. Key contract points the implementor MUST honor (see the UI_UX file for exact tokens, states, motion, a11y):
- **Layout:** dedicated page in `AppShell`; two‑column at ≥1024px (step column `max-w-720` + sticky `AdPreview` rail `w-380`); single column + bottom preview accordion below 1024px. 6‑step **Stepper** (back‑navigable, no forward‑skip). Sticky footer nav (Back / primary).
- **Tokens:** reuse `globals.css` vars only (brand `#f97316`, `--space-*`, `--radius-*`, Geist Sans); dark mode free via `[data-theme]`. **Reuse the `Button` primary variant — never hand‑roll an orange button** (contrast is owned there).
- **States:** every step specifies loading / empty / error / invalid / submitting (UI_UX §5). Selection = ring **+ check** (never color alone). Motion 150–300ms with `prefers-reduced-motion` fallbacks (UI_UX §6). WCAG AA per UI_UX §7 (radio‑group cards, labeled inputs, keyboard‑operable uploader, ≥44px targets).
- **New components to build:** `CampaignBuilderPage`, `WizardShell`+`Stepper`, `ChannelCard`, `DestinationPicker`, `ImageUploader`, `MultiSelect`, `AdPreview`, `CurrencyInput` (UI_UX §9). **Reuse:** `Button`, `Input`, `Textarea`, `Toggle`, `SearchInput`, `Badge`, `Spinner`, `Card`/`SectionCard`/`AlertCard`, `Modal`/`HighRiskActionModal`, `Toast`/`useToast`, `framer-motion`.

### 4.2 Routing & nav (hash router — matches admin convention)
- Add `"campaign-builder": CampaignBuilderPage` to the `PAGES` map in `mingla-admin/src/App.jsx`.
- Add a nav item `{ id: "campaign-builder", label: "Campaigns", icon: "Rocket" }` to a group in `mingla-admin/src/lib/constants.js` `NAV_GROUPS`.
- Add `Rocket` to the `ICON_MAP` in `mingla-admin/src/components/layout/Sidebar.jsx` (documented footgun — omission silently falls back to `LayoutDashboard`).
- Edit‑jump/step deep‑links use the existing hash‑query pattern (`#/campaign-builder?step=2`), parsed with `URLSearchParams`.

### 4.3 Data access (services layer — no React Query; `useState/useEffect`)
- **New reader** `mingla-admin/src/services/metaAdsDestinations.js` → `listDestinations({ search, type, status, page })` querying `business_public_events_view` for `id, title, slug, brand_slug, brand_name, cover_media_url, city, master_start_at, status, event_type, visibility` (admin‑read; the view already grants `authenticated`). Returns `{ rows, total }`, throws on error (house pattern). Brand‑page option list from `brands` (`id, name, slug, profile_photo_url`).
- **New service** `mingla-admin/src/services/metaAdsCampaigns.js` → `createCampaign(payload)` calling `invokeWithRefresh('admin-meta-create-campaign', { body })`; `getConnectionStatus()` calling `admin-meta-connect` `{action:'status'}`. (Both endpoints are #862's.)
- **Media upload helper** `mingla-admin/src/services/mediaUpload.js` → uploads a `File` to Storage bucket `meta-ad-creatives` via the `supabase` client, returns `{ publicUrl, path }`. First upload helper in `mingla-admin` (none existed — build it).

### 4.4 Payload contract to #862 (`admin-meta-create-campaign`)
The builder assembles exactly #862's request body:
```
{ name, objective:'OUTCOME_TRAFFIC', optimization_goal:'LANDING_PAGE_VIEWS'|'LINK_CLICKS',
  billing_event:'IMPRESSIONS',
  budget:{ type:'daily'|'lifetime', amount_cents, end_time? },
  targeting:{ countries:[…], age_min, age_max, genders? },
  destination:{ page_type, brand_slug, entity_slug?, event_id? },
  creative:{ message, headline?, description?, image_url:<meta-ad-creatives public URL>, call_to_action_type },
  special_ad_categories:[] }
```
Name auto‑suggested as `"{brand_name} — {title} — {YYYY-MM-DD}"`, editable. `amount_cents` derived from the `CurrencyInput`. `image_url` is the uploaded bucket URL. The **server** re‑validates destination‑is‑public, budget‑min, and connection (fail‑close) — the client validates for UX but never bypasses the server gate.

### 4.5 Backend addition (the ONLY backend change here)
New migration `supabase/migrations/<ts>_issue_864_meta_ad_creatives_bucket.sql` (timestamp after the latest existing migration):
- Create Storage bucket `meta-ad-creatives`, `public = true` (Meta must fetch the image by URL), file‑size limit 30 MB, `allowed_mime_types = {image/png,image/jpeg}`.
- RLS on `storage.objects` for this bucket: **INSERT/UPDATE/DELETE** `USING (bucket_id='meta-ad-creatives' AND public.is_admin_user())`; **SELECT** public (bucket is public‑read). Mirrors the admin‑gate convention (recon: `is_admin_user()`).

---

## 5. Success criteria (single surface → no per‑platform split; testable)

- **SC‑1:** Navigating to `#/campaign-builder` as an active admin renders the builder at Step 1; a non‑admin never reaches it (existing auth gate).
- **SC‑2 (fail‑close):** If #862 reports Meta not connected/invalid, Step 1 shows the "Connect Meta" AlertCard and **Next is disabled** — the builder cannot proceed to create.
- **SC‑3:** Step 2 lists only **public + live/scheduled** pages from `business_public_events_view`; search/filter narrow results; selecting one shows the correct resolved URL (`/e/{brand_slug}/{slug}` etc.). Loading→skeletons, none→empty state, failure→retry.
- **SC‑4:** Step 3 uploads one JPG/PNG to `meta-ad-creatives`, rejects wrong type/oversize/undersize **client‑side** with an inline message, and yields a public URL; the preview thumbnail renders.
- **SC‑5:** Step 4 blocks Next when budget `< min_daily_budget_cents` (from the live connection), when `age_min > age_max`, or when zero countries — each with a specific inline message; otherwise Next enabled.
- **SC‑6:** Step 5 fields update the **live `AdPreview`** on each keystroke; empty fields show muted placeholders (frame never collapses).
- **SC‑7:** Step 6 summary matches every entered value; "Create campaign (paused)" calls `admin-meta-create-campaign`, shows submitting state, and on success shows the "Created — Paused" panel + a route to the #862 campaign detail. The created campaign is **PAUSED** (never auto‑launched).
- **SC‑8 (error surfacing):** A server 4xx/5xx (e.g. `destination_not_public`, `budget_below_minimum`, `meta_create_failed`) renders the normalized Meta message + `fbtrace_id` in an AlertCard, preserves form state, and (for `destination_not_public`) deep‑links back to Step 2. No silent failure.
- **SC‑9 (a11y):** Keyboard‑only completion of all 6 steps is possible; stepper exposes `aria-current`; cards are a keyboard radio‑group; uploader is keyboard‑operable; contrast passes AA in light and dark (UI_UX §7).
- **SC‑10 (no auto‑spend):** No path in the builder sets a campaign ACTIVE — launching remains the explicit, separate #862 action.

---

## 6. Invariants + regression prevention

### Invariants
- **Preserve I‑ADMIN‑GATE:** builder route + the Storage write policy are admin‑only.
- **Preserve #862's fail‑close** (`I-PROPOSED-META-FAIL-CLOSE`): the UI must not offer "create" when disconnected; and it relies on the **server** re‑checking (client checks are UX‑only).
- **Preserve immutable‑slug contract:** the resolved `dest_url` is built from immutable `brand_slug`/`slug`; the builder only reads them.
- **I‑PROPOSED‑864‑CREATE‑PAUSED (DRAFT):** the builder always creates PAUSED; it never activates. (Flips ACTIVE at CLOSE — orchestrator owns the flip.)
- **I‑PROPOSED‑864‑CREATIVE‑BUCKET‑ADMIN‑WRITE (DRAFT):** writes to `meta-ad-creatives` require `is_admin_user()`.

### Regression contract (fails‑on‑revert)
- **RT‑1:** a UI/unit test asserts Step 1 renders the disabled‑Next + Connect CTA when `getConnectionStatus()` returns not‑connected. Reverting the fail‑close gate makes it fail.
- **RT‑2:** a test asserts the create payload carries the resolved `image_url` from `meta-ad-creatives` and `objective='OUTCOME_TRAFFIC'` with a PAUSED‑expected outcome (no `activate` call). Reverting to an auto‑launch would fail it.
- **RT‑3 (strict‑grep CI gate):** assert `mingla-admin/src/**` never references `META_SYSTEM_USER_TOKEN` or calls `graph.facebook.com` directly — all Meta calls go through #862's edge functions (defends the token‑isolation invariant from the UI side).
- No `app.json`/store‑submit change → release‑parity gates (COMMS‑0096/0097) untouched.

---

## 7. Test cases

| Test | Scenario | Input | Expected | Layer |
|---|---|---|---|---|
| T1 | happy path | valid page + image + $5/day + US + copy | 4 Meta entities + 1 `meta_campaigns` row, PAUSED; success panel | e2e |
| T2 | not connected | connection status invalid | Step 1 blocks; Next disabled; Connect CTA | component |
| T3 | empty destinations | search matches nothing | empty state, no crash | component |
| T4 | bad image | 5 MB GIF / 400×400 PNG | client reject + inline message; no upload | component |
| T5 | below‑min budget | $0.50/day (min $1.00) | Next disabled + "Minimum $1.00/day" | component |
| T6 | age inversion | min 45 / max 25 | inline error, Next disabled | component |
| T7 | server 422 | destination went private post‑pick | AlertCard + jump to Step 2 | e2e |
| T8 | server 502 | Meta create fails mid‑chain (#862 rolls back) | AlertCard + fbtrace_id; form preserved; no orphan | e2e |
| T9 | a11y | keyboard‑only run | all 6 steps completable; focus visible | manual/axe |
| T10 | storage RLS | non‑admin attempts bucket write | denied | SQL |

**Live‑fire (mingla‑tester, after #862 prereqs incl. billing):** drive the full builder on the admin web against a real live event page, upload a real image, create a $1/day Traffic campaign, confirm it appears PAUSED in Meta + `meta_campaigns`, then launch/pause from the #862 surface. Capture screenshots.

---

## 8. Implementation order

1. **Migration** — `meta-ad-creatives` bucket + RLS (§4.5).
2. **Services** — `mediaUpload.js`, `metaAdsDestinations.js`, `metaAdsCampaigns.js`.
3. **Primitives (new)** — `MultiSelect`, `CurrencyInput`, `ImageUploader`, `AdPreview`, `WizardShell`+`Stepper`, `ChannelCard`, `DestinationPicker`.
4. **`CampaignBuilderPage`** — compose steps + state machine + submit.
5. **Wire routing** — `App.jsx` PAGES, `constants.js` NAV_GROUPS, `Sidebar.jsx` ICON_MAP.
6. **CI** — RT‑3 strict‑grep gate; component tests T2–T6.

## 9. Regression prevention
See §6 (RT‑1/2/3). Protective comment on the Step‑1 connection gate explaining the fail‑close "why". The RT‑3 grep gate is the structural guard that the admin client never touches the Meta token or Graph directly.

## 10. Open questions (with recommendation)
- **OD‑1 — Picker UI:** rich **card grid** with cover images **[RECOMMEND — the cover is the point of "pick a page"]** vs. reuse the plain `DataTable`. → card grid.
- **OD‑2 — Image handling:** upload to `meta-ad-creatives` and pass **`image_url`** to #862 **[RECOMMEND for MVP]** vs. have #862 pre‑upload to Meta for a stable `image_hash` (defer to #866). → `image_url` now.
- **OD‑3 — Draft persistence:** client‑state only, discard‑guarded **[RECOMMEND for this story]** vs. persist drafts server‑side (own story). → no drafts now.
- **OD‑4 — Objectives exposed:** default **Traffic** only, with Awareness/Engagement selectable **[RECOMMEND]** vs. Traffic‑locked. → Traffic default, others available.
- **OD‑5 — Country default:** prefill `US/GB/NG` (live markets) editable **[RECOMMEND]** vs. empty. → prefill.
- **OD‑6 — Nav label:** "Campaigns" **[RECOMMEND]** vs. "Ad Engine". → "Campaigns" (with #862's connect living under the same section).

## 11. Scoped allowlist + DO‑NOT‑TOUCH

**Allowlist (implementor MAY create/modify ONLY):**
- `mingla-admin/src/pages/CampaignBuilderPage.jsx` (new) + step subcomponents under `mingla-admin/src/components/campaign-builder/**` (new)
- new primitives under `mingla-admin/src/components/ui/**` (`MultiSelect`, `CurrencyInput`, `ImageUploader`, `AdPreview`, `Stepper`/`WizardShell`) — additive only
- `mingla-admin/src/services/{mediaUpload,metaAdsDestinations,metaAdsCampaigns}.js` (new)
- `mingla-admin/src/App.jsx` (add one PAGES entry), `mingla-admin/src/lib/constants.js` (add one NAV item), `mingla-admin/src/components/layout/Sidebar.jsx` (add one ICON_MAP entry)
- `supabase/migrations/<ts>_issue_864_meta_ad_creatives_bucket.sql` (new)
- CI workflow (append the RT‑3 grep job)

**DO‑NOT‑TOUCH (stop‑and‑amend first):**
- Any `supabase/functions/**` including the #862 `admin-meta-*` functions and `_shared/meta.ts` (call them, don't edit them).
- The #862 tables/migrations (`meta_ad_connections`, `meta_campaigns`, `meta_campaign_status_events`) — read via #862's endpoints; add no columns here.
- Existing `mingla-admin/src/components/ui/**` primitives (reuse; don't rewrite `Button`/`Input`/`Modal`/etc.).
- `app-mobile/**`, `mingla-business/**`, `mingla-marketing/**`, any `app.json`/`eas.json`.
Anything outside the allowlist → `SPEC_AMENDMENT_ISSUE-864_*` before touching.

---

## Downstream routing
**Next:** `mingla-implementor` (build from this SPEC + the embedded design contract; requires #862's endpoints to exist on the branch). → `mingla-tester` (component tests + a11y + live‑fire once #862 billing prereqs are met) → orchestrator CLOSE.
**Working tree:** `~/Desktop/mingla-orchs/issue-864-campaign-builder-ui/` on branch `issue-864-campaign-builder-ui` (stacked on `issue-862-meta-ads-api`).
