# META-ORCH-1160 — Mingla Growth Operating System: Strategy Brief

**ID:** META-ORCH-1160
**Owner:** Seth (Head of Product + Marketing)
**Skill:** mingla-product
**Date:** 2026-06-18
**Status:** STRATEGY (front-of-pipeline brief; no code in this artifact)
**Type:** Growth/Marketing operating-system design — the single source-of-truth for the whole growth org

> This brief defines the metric system, channel measurement model, the one system-of-truth doc,
> the team orchestration model (roles + ClickUp), the dashboard architecture, and the phased rollout.
> It is grounded in what Mingla actually has shipped: Mixpanel (consumer + business native),
> AppsFlyer (install attribution), Stripe + Paystack, RevenueCat. **Web surfaces have NO analytics today**
> — that is the single biggest visibility gap and the first thing Phase 1 fixes.

---

## 0. Operating principles (the spirit Seth asked for)

Seth wants: **SPEED, EFFICIENCY, GRANULARITY, DEPTH, TOTAL VISIBILITY**, AI-driven direction, and a
**30-minute feedback loop**. Most of the team is entry-level, so every instruction is a *template a
novice can execute without judgment calls*, and every repetitive step is automated. The design rules:

1. **One event spec, every surface.** Same event name + same property schema across consumer app,
   business app, and web — so a metric means the same thing everywhere. No surface-specific event names.
2. **Every spend has an owner and a field.** A channel without a cost-input mechanism produces a CPL of
   "unknown" — banned. Each channel names who enters spend, where, and how often.
3. **Every channel is made measurable by convention,** even the "unattributable" ones (cold calling,
   community chats, influencers) — via tracked links, promo codes, unique landing pages, and UTM.
4. **The doc drives the org; ClickUp executes; the 30-min loop re-steers.** The repo doc is strategy +
   targets + playbooks (changes slowly). ClickUp holds the live work. The feedback column is the steering
   wheel read every 30 minutes.
5. **Broken-automation detection is a first-class metric,** not an afterthought. If a pipe is silently
   dropping leads, that is a P0 incident surfaced on the master dashboard.

---

## A. METRIC DEFINITIONS

Notation: **[NEW]** = needs new instrumentation; **[DERIVE]** = computable from data we already emit or
from a join; **[TOOL]** = lives in a third-party tool's API (Stripe/Paystack/RevenueCat/AppsFlyer/ad
platforms) and must be ingested.

**Universal slice dimensions** (apply to every metric unless noted): `channel`, `source/medium/campaign`
(UTM), `geo` (DC / Raleigh / Lagos + "other"), `platform` (iOS / Android / Web), `brand_id` (for the
business/venue side), `persona` (consumer side, where derivable), `date` (day/week/month).

### Stage 1 — AWARENESS

| Metric | Formula | Computing event(s) | Slice by | New vs derive |
|---|---|---|---|---|
| Impressions | sum of platform-reported impressions | ad-platform API; organic post reach | channel, geo, campaign | [TOOL] ad APIs; [NEW] manual entry for organic |
| Reach (unique) | unique people reached | platform API | channel, geo | [TOOL] |
| Clicks / link taps | count of tracked-link redirects | `link_click` on the redirect service (see §B) | channel, campaign, geo | [NEW] redirect service |
| CTR | clicks ÷ impressions | derived | channel, campaign | [DERIVE] |
| Landing-page views | `page_view` on a mingla-marketing page | web analytics `page_view` | channel (UTM), geo, page | [NEW] web analytics |
| Leads (per channel) | count of qualified lead events (see §B lead definition) | `lead_captured` | channel, geo, campaign | [NEW] |
| Spend (per channel) | sum of cost inputs | ad APIs + manual cost rows | channel, campaign | [TOOL]+[NEW] cost sheet |
| **CPL** | spend ÷ leads | derived | channel, campaign, geo | [DERIVE] |
| Channel effectiveness score | weighted blend: leads, CPL, downstream activation rate of those leads | derived (joins to Stage 3) | channel | [DERIVE] |

**Lead definition (single, canonical):** a `lead_captured` event fires when a human gives us a way to
reach them OR takes a high-intent step: email submitted, phone submitted, demo booked, app install
attributed, ROI-calc completed with email, pitch-deck/whitepaper email-gated download, or a cold-call/
DM that the sales rep logs as "interested." One person can generate at most one lead per channel per 30
days (dedupe key = email|phone|device_id + channel).

### Stage 2 — ACQUISITION

| Metric | Formula | Event(s) | Slice | New/derive |
|---|---|---|---|---|
| App downloads | installs | AppsFlyer install postback → `install` | media-source, geo, platform | [TOOL] AppsFlyer (have it) |
| Web signups | account created on web | `signup_completed` (web) | UTM, geo | [NEW] web |
| App signups | account created in app | `signup_completed` (app) | media-source, geo, platform | [DERIVE] Mixpanel (have it) |
| Emails collected | distinct emails captured | `email_captured` | channel, geo | [NEW] web + forms |
| Phone numbers collected | distinct phones captured | `phone_captured` | channel, geo | [NEW] |
| Calls set up | sales call scheduled | `call_scheduled` | rep, geo, source | [NEW] (Calendly/ClickUp) |
| Demos registered | demo booking | `demo_registered` | rep, source, geo | [NEW] |
| ROI-calc usage | ROI calculator completed | `roi_calc_completed` | UTM, geo | [NEW] web |
| Comparison-chart downloads | gated download | `asset_downloaded{type:comparison}` | UTM | [NEW] web |
| Pitch-deck reads | deck opened/scrolled ≥50% | `asset_viewed{type:pitch_deck}` | UTM | [NEW] (DocSend-style) |
| Whitepaper downloads | gated download | `asset_downloaded{type:whitepaper}` | UTM | [NEW] |
| **CAC** | total acquisition spend ÷ new acquired users (by definition of "acquired" — pick: installs, signups, or paying brands; report all three) | derived join (spend ÷ count) | channel, geo, platform | [DERIVE] |
| Automation health | % of expected pipe steps that fired vs dropped | synthetic canary + ratio checks (see §E) | pipe | [NEW] monitoring |

### Stage 3 — ACTIVATION

| Metric | Formula | Event(s) | Slice | New/derive |
|---|---|---|---|---|
| Onboarding complete | reached end of onboarding | `onboarding_completed` | platform, geo, persona | [DERIVE] (likely emitted; verify) |
| Swipes | swipe actions | `card_swiped` | platform, geo | [DERIVE] Mixpanel |
| Saves | card/offer saved | `item_saved` | platform, geo, kind | [DERIVE] |
| Scheduled | plan scheduled | `plan_scheduled` | platform, geo | [DERIVE] |
| Purchased | checkout success | `purchase_completed` (Stripe/Paystack webhook → Mixpanel) | platform, geo, currency, brand | [DERIVE]+[TOOL] |
| Stripe/Paystack connected | brand payout enabled | `payout_connected` | geo, provider, brand | [DERIVE]/[NEW] from `stripe_charges_enabled` flip |
| Offering created | event/trip/experience/rsvp created | `offering_created{kind}` | kind, geo, brand | [DERIVE] (verify per kind) |
| **Time-to-first-value (TTFV)** | timestamp(first activation event) − timestamp(signup); pick the value event per side: consumer = first save OR first schedule; brand = first offering published OR first payout connected | derived | platform, geo, persona, side | [DERIVE] |
| **Active-SKU count over time** | distinct published offerings live on a given day, by kind | derived from `offering_created` − `offering_unpublished/expired` | kind, geo, brand | [DERIVE] (needs unpublish event — verify [NEW]) |

### Stage 4 — RETENTION

| Metric | Formula | Event(s) | Slice | New/derive |
|---|---|---|---|---|
| D7 / D14 / D30 retention | % of a signup cohort with ≥1 qualifying session on day N (rolling window ±1) | `session_start` cohorted on `signup_completed` | platform, geo, persona, channel | [DERIVE] Mixpanel cohorts |
| MAU | distinct users with ≥1 session in trailing 30 days | `session_start` | platform, geo, side | [DERIVE] |
| Churn | 1 − (retained users this period ÷ active prior period) | derived | platform, geo, side | [DERIVE] |
| Uninstalls | install-removal postbacks | AppsFlyer uninstall measurement | media-source, geo, platform | [TOOL] (enable if not on) |
| Subscription churn | cancelled subs ÷ active subs (period) | RevenueCat events | platform, geo, plan | [TOOL] RevenueCat |

### Stage 5 — REVENUE

| Metric | Formula | Source | Slice | New/derive |
|---|---|---|---|---|
| Commission growth over time | sum of Mingla application-fee per period; period-over-period delta | Stripe `application_fee` + Paystack split | geo, currency, brand, kind | [TOOL] |
| Total cost over time | sum of all spend (ad + tooling + payroll if entered) per period | cost sheet + ad APIs | category, channel | [TOOL]+[NEW] |
| Net profit | revenue (commission + subscription) − total cost | derived | period, geo | [DERIVE] |
| Subscriptions (MRR) | active subs × price (normalized currency) | RevenueCat | plan, platform, geo | [TOOL] |
| AOV | gross merchandise value ÷ orders | `purchase_completed` amount | geo, currency, kind, brand | [DERIVE] |
| LTV | per-cohort cumulative net revenue per user (consumer: spend × margin; brand: commission generated) | derived cohort model | side, geo, channel | [DERIVE] (modeled) |
| Cart-abandonment rate | 1 − (purchases ÷ checkout-starts) | `checkout_started` vs `purchase_completed` | platform, geo, kind | [NEW] need `checkout_started` on all surfaces |
| Profit margin | net profit ÷ total revenue | derived | period | [DERIVE] |

### Stage 6 — REFERRAL

| Metric | Formula | Event(s) | Slice | New/derive |
|---|---|---|---|---|
| NPS | % promoters (9–10) − % detractors (0–6) | `nps_submitted{score}` in-app survey | platform, geo, side, persona | [NEW] in-app survey |
| Unique invite links | distinct invite links generated; and their click/convert | `invite_link_created`, `invite_link_clicked`, `invite_converted` | inviter, geo, platform | [NEW] (note: ORCH-1111 already surfaces pending invites — extend, don't rebuild) |
| K-factor (viral coefficient) | invites sent per user × conversion rate per invite | derived | geo, persona | [DERIVE] |

**Instrumentation summary:** the heaviest NEW lift is **web analytics (all of Stage 1–2 web), the
tracked-link redirect service, `checkout_started`, NPS survey, and the invite-link event trio.**
Everything app-native is mostly [DERIVE] once we confirm the events fire with the right properties.

---

## B. CHANNEL MEASUREMENT MODEL

**Goal:** every one of the ~21 awareness channels produces *leads* and *cost*, so CPL and downstream CAC
exist for each. The trick is a **single tracked-link + promo-code + UTM convention** that turns even
"unattributable" channels into measured ones.

### B.1 The three attribution instruments

1. **Tracked short-links (the backbone).** Stand up one redirect service (e.g. a `go.usemingla.com`
   short-domain on a Cloudflare Worker or Dub.co) that:
   - logs every click with the channel/campaign baked into the slug,
   - 302s to the destination with UTM params appended,
   - for app destinations, hands off to an AppsFlyer OneLink so install attribution survives the store
     bounce. **Every link any team member ever shares is one of these — never a raw URL.**
2. **Promo / referral codes.** For channels where a person speaks (cold call, influencer read-out,
   community chat, podcast): issue a unique human-memorable code (`DC10`, `RALEIGHJEN`, `LAGOSTOLA`) tied
   in a lookup table to `channel + campaign + rep/creator`. Code used at signup or checkout → attribute
   the lead/acquisition to that channel. Codes also work where links can't (spoken word, print).
3. **UTM standard (rigid).** `utm_source` = platform (reddit, tiktok, ig, cold_email…), `utm_medium` =
   paid|organic|social|email|dm|referral|community, `utm_campaign` = `{geo}_{theme}_{yyyymm}`,
   `utm_content` = creative/variant id, `utm_term` = rep/creator handle for person-driven channels.
   **A link without a full UTM set is rejected by the link builder** (the builder is a small form/sheet,
   not free-text).

### B.2 Per-channel attribution recipe (all 21)

| Channel | Primary instrument | Lead capture | Cost input |
|---|---|---|---|
| Blog | tracked link + UTM | landing page form / install | content tooling (mostly time) |
| Landing pages | UTM + web analytics | form submit | hosting (negligible) |
| Reddit (organic) | tracked link in post/comment | click → form/install | time → $0 cost, CPL = ∞-safe (use CPL=time-cost optional) |
| Quora | tracked link | click → form | time |
| Instagram (organic) | link-in-bio tracked link + promo code | code/form | time |
| Facebook (organic) | tracked link + code | code/form | time |
| TikTok (organic) | bio link + promo code | code/form | time |
| Threads | tracked link | click → form | time |
| X | tracked link | click → form | time |
| Snapchat (organic) | tracked link + code | code/form | time |
| Influencers | **unique promo code per creator** + tracked link | code at signup/checkout | creator fee (manual cost row per deal) |
| Local blogs | tracked link + code | code/form | placement fee (manual) |
| Local Telegram/WhatsApp | **promo code** (links often stripped) + a per-group tracked link | code at signup | time / small group-admin fee (manual) |
| Cold calling | **per-rep promo code** + `call_logged` outcome field | rep logs interested → `lead_captured`; code on signup | rep time (payroll allocation, manual monthly) |
| Cold email | tracked link per sequence + UTM | click→form / reply logged | tooling seat (manual) |
| Cold DM | tracked link per platform + code | code/form / reply logged | tooling/time |
| Search ads | auto-tagged UTM (gclid) | landing → form/install | **ad API (auto)** |
| Meta ads | UTM + Meta API | form/install | **ad API (auto)** |
| TikTok ads | UTM + TikTok API | form/install | **ad API (auto)** |
| Reddit ads | UTM + Reddit API | form/install | **ad API (auto)** |
| Snapchat ads | UTM + Snap API | form/install | **ad API (auto)** |

**Unattributable-channel principle:** if no click and no code can be captured (e.g. a pure brand
billboard), the channel is logged as "untracked" and its leads land in an `unattributed` bucket whose
*size is itself a monitored metric* — we drive it toward zero by making codes/links mandatory.

### B.3 Cost-input mechanism (the "who enters spend, where")

- **Paid ad channels:** automatic — ingested daily from each ad platform's API into the warehouse.
- **Manual-cost channels (influencer fees, placements, community admin tips, tooling seats, rep payroll
  allocation):** a single **"Spend" ClickUp list** (or a locked Google Sheet synced nightly) with fields
  `date, channel, campaign, geo, amount, currency, owner, note`. **The Growth Lead owns weekly entry;
  the Brand Marketer enters influencer/placement deals at signing.** Nightly job sums manual + API spend
  into the `channel_spend` table that powers every CPL/CAC tile.
- **Rule:** a channel that is "on" in ClickUp but has zero spend rows for the week throws a "missing
  cost input" warning on the master dashboard (so CPL is never silently wrong).

### B.4 CPL & CAC formulas (canonical)

- **CPL(channel, period)** = `channel_spend / leads_captured` (leads per the §A lead definition,
  deduped). Organic channels with $0 cash spend report CPL = $0 *and* a parallel "cost-per-lead in hours"
  for honesty.
- **CAC(channel, period, target)** = `channel_spend / acquired(target)` where `target` ∈ {install,
  signup, paying_brand}. **Always report all three CACs** — a channel cheap per-install can be expensive
  per-paying-brand. Blended CAC = `total_spend / total_acquired`.
- **Payback / efficiency:** pair CAC with the LTV of that channel's cohort (Stage 5) → the master
  dashboard's "what's working" ranking = LTV:CAC by channel, not CPL alone (cheap leads that never
  activate are not "working").

---

## C. THE STRATEGIC SYSTEM-OF-TRUTH DOCUMENT

**One repo markdown file** drives the whole growth org. Proposed canonical path:
`Mingla_Roadmap/living/GROWTH_OS.md` (durable planning lives in `Mingla_Roadmap/`; this brief stays in
`Mingla_Artifacts/investigations/` as its origin/evidence). It changes *slowly* (weekly), is the thing
everyone reads Monday morning, and links out to ClickUp for live work. **Outline:**

```
# Mingla Growth OS — System of Truth
0. How to use this doc (read order; what's here vs in ClickUp; the 30-min loop pointer)
1. North Star + Funnel Goals
   1.1 North-star metric (single number, defined) + why
   1.2 The 6-stage funnel diagram with current vs target conversion at each step
   1.3 This quarter's funnel goals (one target number per stage)
2. Per-Stage Targets (the scoreboard)
   2.1 Awareness targets (leads, CPL ceiling per channel)
   2.2 Acquisition targets (installs/signups/CAC ceiling)
   2.3 Activation targets (TTFV, activation rate, active-SKU count)
   2.4 Retention targets (D7/D30, MAU, churn cap)
   2.5 Revenue targets (commission, MRR, margin)
   2.6 Referral targets (NPS floor, K-factor)
3. Channel Playbooks (one sub-section per channel — the novice-proof part)
   For each channel: objective · who owns it · the exact link/code/UTM convention ·
   step-by-step weekly motion · creative/template links · "good looks like" · CPL ceiling ·
   kill/scale rule (when to cut or double down)
4. Role Charters (mirrors §D; one block per role: north-star, weekly goals, definition of good)
5. Cadence
   5.1 Daily standup format + the daily dashboard to check
   5.2 Weekly review format (what numbers, what decisions)
   5.3 The 30-minute feedback loop spec (where the column is, who/what reads it, how re-direction lands)
6. Measurement & Attribution Reference
   6.1 Canonical event dictionary (name + properties) — the contract
   6.2 UTM / link / promo-code conventions
   6.3 CPL / CAC / LTV formulas
   6.4 Dashboard index (links to every dashboard)
   6.5 Automation-health checks + what "broken" looks like
7. Decision Log (dated; every scale/kill/pivot with the number that drove it)
8. Glossary (lead, activation, qualified, value-event — so nobody argues definitions)
```

**Governance:** the Growth Lead owns edits; Seth approves target changes; the event dictionary (§6.1) is
*append-only contract* — changing an event name is a coordinated change across surfaces (route through
forensics, like any instrumentation change).

---

## D. TEAM ORCHESTRATION MODEL

For each role: **north-star metric → weekly goals → tactical task templates (novice-grade) → what good
looks like.** Templates are written so an inexperienced hire executes without inventing steps.

### D.1 Growth Lead
- **North star:** blended LTV:CAC (and keeping every channel under its CPL ceiling).
- **Weekly goals:** all channels have fresh spend rows; 2 experiments running; master dashboard green;
  unattributed-lead bucket < 10%; one scale + one kill decision logged.
- **Task templates:**
  - *Weekly channel review:* open master dashboard → for each channel record leads/CPL/CAC →
    flag any > ceiling → write scale/kill in Decision Log → update ClickUp channel statuses.
  - *Experiment setup:* fill the experiment template (hypothesis, metric, channel, variant ids,
    duration, success threshold) → create tracked links/codes via the link builder → schedule readout.
  - *Spend reconciliation:* confirm ad-API spend imported; enter manual-cost rows; resolve "missing cost
    input" warnings.
- **Good looks like:** no channel is "unknown CPL"; decisions trace to numbers; CAC trending down or LTV up.

### D.2 Community / Social Manager
- **North star:** leads + engaged-reach from organic social & community channels (IG/FB/TikTok/Threads/
  X/Snap/Reddit/Quora/Telegram/WhatsApp).
- **Weekly goals:** post cadence hit per platform; every post uses a tracked link/code; X community DMs
  logged; top-3 performing posts identified and reported into feedback.
- **Task templates:**
  - *Daily post:* pull the day's content from the content list → paste caption template → insert the
    correct tracked bio-link/code for that platform+geo → publish → log the post URL + link slug in
    ClickUp → at +24h enter reach/clicks.
  - *Community drop (Telegram/WhatsApp/Reddit):* use approved message template + per-group promo code →
    post → log group + code → never paste a raw URL.
  - *Engagement reply pass:* 20 min/day replying with the value template; log any interested DM as a lead.
- **Good looks like:** zero raw links shipped; every channel has attributable clicks; reach growing.

### D.3 Designer
- **North star:** creative throughput that converts (assets shipped × their downstream CTR/conversion).
- **Weekly goals:** N ad/social creatives per channel in the right specs; all variants labeled with
  `utm_content` ids; refresh the lowest-CTR creatives.
- **Task templates:**
  - *Creative request intake:* read the brief card (channel, message, geo, format/spec) → produce
    variants → name each file with the `utm_content` id → attach to the card → set status "Ready".
  - *Creative refresh:* pull bottom-quartile-CTR creatives from dashboard → produce 2 new variants each.
- **Good looks like:** every asset is spec-correct, labeled, and traceable to a performance number.

### D.4 Video Editor
- **North star:** video assets shipped × their watch-through/conversion (TikTok/Reels/Shorts/Snap).
- **Weekly goals:** N short-form videos per platform; hooks A/B'd; all anchored to the Canonical Voice
  scripts (consumer / business / manifesto) — never off-message.
- **Task templates:**
  - *Short-form cut:* take the script/brief → cut to platform length/aspect → add the on-screen CTA with
    the tracked link/code → export per-platform spec → label variant → attach + set "Ready".
  - *Hook test:* produce 3 hook variants of the top video → label → hand to social for posting.
- **Good looks like:** on-voice, spec-correct, hook-tested, labeled for attribution.

### D.5 Brand Marketer
- **North star:** quality awareness + influencer/partner-driven leads at acceptable CPL.
- **Weekly goals:** influencer/local-blog/podcast deals sourced + signed with unique promo codes; brand
  message consistent across channels; deck/whitepaper/comparison assets current.
- **Task templates:**
  - *Influencer deal:* source → negotiate → at signing create a unique promo code + tracked link, enter
    the fee as a Spend row, brief the creator with on-voice talking points → log expected post date →
    at post, record performance.
  - *Asset upkeep:* keep pitch deck / whitepaper / comparison chart gated behind email capture
    (`asset_downloaded` fires) and current with shipped-grade features only (reality-check rule).
- **Good looks like:** every partner has a code, a cost row, and a tracked outcome; messaging on-brand.

### D.6 Sales Manager (cold calling)
- **North star:** calls → demos → connected/paying brands (and CAC of that path).
- **Weekly goals:** call volume target; demos booked; every interested call logged as a lead with the
  rep's promo code; pipeline stages current.
- **Task templates:**
  - *Call block:* work the call list → use the script → for each call set the `call_logged` outcome
    (no-answer / not-interested / interested / demo-booked) → interested/demo → create the lead with the
    rep promo code → schedule follow-up.
  - *Demo:* run the demo deck → after, set stage → send the tracked follow-up link → log result.
- **Good looks like:** every dial logged with an outcome; interested calls always carry the rep code so
  attribution survives to signup; demo→paying conversion visible.

### D.7 ClickUp structure

**Space:** `Mingla Growth`. **Folders → Lists:**

- **Funnel folder** (one list per stage): `1-Awareness`, `2-Acquisition`, `3-Activation`,
  `4-Retention`, `5-Revenue`, `6-Referral` — but most *work* lives in role lists; funnel lists hold
  channel/experiment cards.
- **Role lists:** `Growth Lead`, `Social & Community`, `Design`, `Video`, `Brand`, `Sales`.
- **Ops lists:** `Spend` (cost rows), `Experiments`, `Content Calendar`, `Creative Requests`,
  `Feedback` (the 30-min loop, see below), `Decision Log`.

**Custom fields (task-level):**
`channel` (dropdown, the 21), `geo` (DC/Raleigh/Lagos/Other), `platform` (iOS/Android/Web),
`campaign` (text, the UTM campaign id), `utm_content` (text), `tracked_link` (url), `promo_code` (text),
`spend_amount` + `currency`, `metric_result` (number), `funnel_stage` (dropdown),
**`Feedback`** (long-text — the steering field), `Feedback_Status` (dropdown: `none / needs_attention /
ai_read / re_directed / resolved`), `owner`, `due`.

**Statuses (workflow):** `Backlog → Ready → In Progress → Needs Review → Blocked → Done`.
Blocked tasks auto-surface to the master dashboard.

### D.8 The 30-minute AI feedback-ingestion loop

- **Where the team writes:** the **`Feedback` custom field** on the task they're working (and a top-level
  `Feedback` list for general signals). When a hire is stuck, sees a number move, or needs direction,
  they write plain-English into `Feedback` and set `Feedback_Status = needs_attention`.
- **The reader (every 30 min):** a scheduled job (Claude Code `schedule`/`loop` skill, or an n8n/Make
  cron hitting the ClickUp API) pulls every task where `Feedback_Status = needs_attention`, plus the
  latest dashboard deltas. An AI pass (this product-mind prompt) reads each, and for each either:
  (a) answers/re-directs by writing into the same task (a comment + updated checklist + new due) and sets
  `Feedback_Status = re_directed`; (b) escalates to Seth if it's a strategy/budget call (tags Seth, sets
  `Blocked`); or (c) marks `resolved`. It also scans the master dashboard for any CPL > ceiling or
  broken-automation alert and *proactively* creates re-direction tasks even with no human feedback.
- **Re-direction lands as concrete tasks,** not advice: "Kill the Snap organic posts (CPL 5× ceiling),
  reallocate that hour to Reddit value replies — here's today's 3 threads." So an entry-level hire just
  executes the next card.
- **Total visibility:** every loop pass appends a one-line entry to the `Decision Log` list, so Seth
  sees, end-to-end, what changed every 30 minutes and why.

---

## E. DASHBOARD ARCHITECTURE

### E.1 Recommended stack (with tradeoffs)

**Recommended: a thin warehouse + BI layer, fed by everything, with Mixpanel kept for product analytics.**

- **Event collection:** add **web analytics now** — fastest is a CDP-style tracker that fans out. Use a
  lightweight event SDK on `mingla-marketing` + `mingla-business` web emitting the *same* canonical
  events to (a) Mixpanel (so web joins the existing product funnels) and (b) the warehouse. Practical
  pick: **Segment or RudderStack (open-source, cheaper)** as the single pipe → Mixpanel + warehouse +
  ad-platform conversions API. If budget-minimal, **GA4 on web for page/UTM basics + Mixpanel via a
  direct web SDK** is the cheap path, but it fragments definitions — so RudderStack is preferred.
- **Warehouse:** **BigQuery** (cheap at this scale, ad-platform + Stripe + RevenueCat connectors are
  mature). It is the join point where Mixpanel exports, AppsFlyer, Stripe/Paystack, RevenueCat, ad-spend
  APIs, and the ClickUp spend/lead data all meet — the *only* place CPL/CAC/LTV-by-channel can be
  computed truthfully.
- **BI layer:** **Metabase** (self-host, free, fast for the team to build dashboards) — or **Looker
  Studio** (free, easiest to share, weaker modeling) if no one can host Metabase. Recommend **Metabase**
  for the depth/granularity Seth wants; Looker Studio as the zero-ops fallback.
- **Why not Mixpanel-only:** Mixpanel can't ingest ad spend, Stripe revenue, or ClickUp cost rows, so it
  cannot compute CPL/CAC/LTV-by-channel or net profit. It stays the *product-behavior* tool; the
  *business/growth* truth lives in the warehouse.

**Tradeoff summary:** RudderStack+BigQuery+Metabase = most depth, total visibility, modest setup cost,
some engineering. GA4+Looker Studio = live in a day, but shallow and definition-fragmented. Given Seth's
explicit demand for GRANULARITY/DEPTH/TOTAL VISIBILITY, build the warehouse path; ship a Looker Studio
stopgap in week 1 so visibility isn't zero while the warehouse lands.

### E.2 The dashboards

- **Per-channel dashboard (×21):** impressions, reach, clicks, CTR, leads, CPL, spend, trend lines, top
  creatives (`utm_content`), and the *downstream* activation/retention rate of that channel's cohort.
  One template, parameterized by `channel`.
- **Per-source acquisition dashboard:** installs/signups/emails/phones/demos/asset-actions by source,
  CAC (all three targets), and automation-health for that source's pipe.
- **Activation dashboard:** funnel onboarding→swipe→save→schedule→purchase, TTFV distribution,
  active-SKU count over time by kind/geo.
- **Retention dashboard:** D7/D14/D30 cohort grid, MAU, churn, uninstalls, sub-churn — all on one screen.
- **Revenue dashboard:** commission over time, total cost over time, net profit, MRR, AOV, LTV,
  cart-abandonment, margin.
- **Referral dashboard:** NPS trend, invite links created/clicked/converted, K-factor.
- **THE MASTER "what's working" dashboard:** one screen ranking every channel by **LTV:CAC** (then CPL),
  with the full funnel's current-vs-target per stage, the north-star number, the unattributed-lead %,
  and a **red alert strip** for: any CPL > ceiling, any "missing cost input," and any broken-automation
  flag. This is the daily-standup screen.

### E.3 "Is an automation broken?" monitoring

- **Synthetic canaries:** a scheduled job runs a fake lead/signup/checkout through each automated pipe
  daily and asserts the expected events landed end-to-end; a missing step = P0 alert.
- **Ratio guards:** alert when a step's pass-through drops anomalously (e.g. installs > 0 but
  `signup_completed` = 0 for 2h; `checkout_started` with no `purchase_completed`; ad spend logged but
  zero attributed clicks).
- **Freshness guards:** every connector (ad API, Stripe, AppsFlyer, RudderStack→BQ) has a "last-synced"
  timestamp; stale > threshold = alert. (Mirrors the realtime-freshness lessons from META-ORCH-1148.)
- **Surface:** all of the above light up the master dashboard's red strip and auto-create a `Blocked`
  ClickUp incident card tagging the Growth Lead + Seth.

---

## F. PHASING (4-phase rollout for fastest visibility)

**Phase 1 — Make web visible + the link backbone (week 1–2). Biggest gap, fastest payoff.**
Stand up the tracked-link redirect service + UTM/promo-code conventions; add web analytics to
mingla-marketing + business web emitting canonical events; ship a Looker Studio stopgap showing
page-views/clicks/leads by channel. Define the canonical event dictionary in `GROWTH_OS.md`. Outcome:
every channel a person shares becomes measurable; web stops being a black box.

**Phase 2 — Warehouse + cost + CPL/CAC (week 2–4).**
RudderStack → BigQuery; ingest ad-platform spend APIs + the ClickUp/Sheet manual `Spend`; ingest Stripe/
Paystack/RevenueCat/AppsFlyer; build Metabase; ship per-channel dashboards + the master "what's working"
board with CPL/CAC. Stand up automation-health canaries. Outcome: true CPL/CAC per channel, broken-pipe
detection, the master scoreboard.

**Phase 3 — Activation/Retention/Revenue depth + the team OS (week 4–6).**
Confirm/repair app-native events (TTFV, active-SKU, `checkout_started`, payout-connected); build
activation/retention/revenue dashboards; stand up the ClickUp space (lists, custom fields incl.
`Feedback`/`Feedback_Status`, statuses); write role charters into `GROWTH_OS.md`; launch the 30-minute
AI feedback loop. Outcome: full-funnel depth + the team runs in ClickUp with AI re-direction.

**Phase 4 — Referral + optimization + automation hardening (week 6–8+).**
Ship the NPS survey + invite-link event trio (extend ORCH-1111) + K-factor; turn on LTV:CAC channel
ranking as the master sort; close the unattributed-lead bucket toward zero; add cohort LTV modeling and
scale/kill automation. Outcome: the full 6-stage loop instrumented, referral measured, the system
self-steers.

---

## Reality-check note (grade gate)

This brief instruments and *measures* the funnel; it does not claim features above their grade. Any
marketing asset (deck/whitepaper/comparison/landing copy) produced by the Brand Marketer must pass the
mingla-product reality-check: only A/B-grade shipped features become headlines; C is "early"; D/F do not
appear. Web-analytics, NPS, invite-link, and `checkout_started` instrumentation are NEW code changes and
must route through the normal pipeline (forensics → implement → test) — they are not done until shipped
and verified per surface.
