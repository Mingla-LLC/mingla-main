# Mingla Business — Marketing Hub Strategy (Brainstorm Lock-In)

**Status:** Brainstorm complete with operator modifications, no implementation dispatched
**Date registered:** 2026-05-06
**Last updated:** 2026-05-06 (mapped to Cycle B5)
**Owner:** Seth Ogieva
**Mode:** Strategy / pre-spec — to convert to a formal SPEC per phase before implementor dispatch
**Source:** Operator-led brainstorm (2026-05-06) with Modifications M1–M4 applied
**Sibling doc:** `MINGLA_BRAIN_AGENT_STRATEGY.md` (the AI-agent layer that sits on top of this hub)

> **THIS DOC = CYCLE B5.** Per `BUSINESS_PROJECT_PLAN` Phase 7 (Post-MVP), this
> strategy document is the long-lived design north-star for **Cycle B5 — Backend:
> marketing infrastructure**. It is NOT a per-cycle epic; the per-cycle epic
> document at `Mingla_Artifacts/github/epics/cycle-b5.md` (or equivalent) will be
> created only when B5 actually starts. Until then, this doc is the canonical
> strategic context for any B5 / B5a / B5b decomposition work.

---

## 0. Hard Prerequisite Chain (Non-Negotiable)

This cycle (B5) is **post-MVP** and gated behind a strict prerequisite chain.
The full chain that must complete before any B5 implementation starts:

```
B2 (Stripe Connect wired live)
    ↓ brands can actually receive money
B3 (Checkout wired live — Stripe Payment Element)
    ↓ real purchases generate real orders + real attribution events
B4 (Scanner + door payments wired live)   ← MVP CUTLINE
    ↓ private beta opens
B4 stable for ≥ 4 weeks with zero open S0 / S1 issues
    ↓
B5 — THIS DOC — marketing infrastructure (Phase 7, Post-MVP)
    ↓
Mingla Brain P3 (AI agent ads tooling, per sibling doc §11.1)
```

**Rationale:** B5 is fundamentally about reaching customers who already bought
tickets and acquiring new ones. Without B2 (real money routing) and B3 (real
purchases), there are no real customers to reach and no real conversions to
attribute. Without B4 stable, the product is not yet de-risked enough that
operator + engineering bandwidth can shift from MVP hardening to growth tooling.

**The single exception — Phase E (M4 ads research) can start anytime.**
The ads best-practices research playbook (per Modification M4 §4.4) has zero
code dependencies on B2 / B3 / B4. It is pure synthesis work. Operator may
dispatch this research as a parallel research-only ORCH cycle at any point —
including in parallel with B2 / B3 / B4 implementation. The output
(`Mingla_Artifacts/MINGLA_ADS_PLAYBOOK.md`) becomes available when B5 starts.

**All other B5 phases (A–D, F, G, H) are hard-gated on the prerequisite chain
above.** Do not dispatch SPEC writing for any of these phases until B4 has
been live for 4+ weeks and the Launch Readiness Tracker shows zero open
S0 / S1 issues across mingla-business.

---

## 1. Vision

Build a **two-track marketing hub** inside `mingla-business` so that any business
user can reach their existing customers (Track 1) and find new ones (Track 2)
without leaving Mingla. All consent-tracked, all attribution-instrumented, all
billed through Stripe, all auditable end-to-end.

When mature, this becomes the foundation that the Mingla Brain AI agent automates.

---

## 2. The Two Tracks

| Track | What it is | Channel(s) | Audience source |
|---|---|---|---|
| **1. Marketing Blasts** | Outbound messages to existing contacts | Email, SMS, RCS (via Twilio + Resend) | Ticket buyers (MVP), brand followers (later) |
| **2. Mingla-Managed Ads** | Paid ads to acquire new customers | Meta first, Google + TikTok later | New audiences via Meta targeting + lookalike from existing customers |

Track 1 ships first. Track 2 is the "mechanical ads workflow" already locked
as a prerequisite for Mingla Brain P3 (per `MINGLA_BRAIN_AGENT_STRATEGY.md` §11.1).

---

## 3. Track 1 — Marketing Blasts

### 3.1 Data foundation (already in place)

| Data we have | Source |
|---|---|
| Buyer email | `orders` table (Cycle 12 ticketing) |
| Buyer phone | `orders` table |
| Buyer linked to event | `orders.event_id` |
| Event linked to brand | `events.brand_id` |
| Anonymous buyer pattern | Per Cycle 8a invariant — `orders.account_id` nullable |

Querying "ticket buyers of brand X" is a one-line query. The harder problems are:
contact-data quality (M2), consent (M1), and channel registration paperwork.

### 3.2 Modification M1 — Consent enforcement at every touchpoint

**Operator directive:** Consent must be enforced as deeply as legally possible.
Every touchpoint (checkout, onboarding, brand follow, etc.) must push the user
toward being reachable.

#### 3.2.1 Legal reality — what we CAN and CANNOT do

This is the single most important section in the doc. Get this wrong and
we get sued. Get this right and we still hit ~80% reachability.

| Action | Legal status | Why |
|---|---|---|
| Require email + phone for ticket delivery | **Legal everywhere** | Transactional necessity, not marketing |
| Require marketing consent as a condition of purchase | **Illegal in US (TCPA), EU (GDPR), Canada (CASL)** | TCPA explicitly: "consent cannot be required as a condition of purchase". GDPR requires consent be "freely given". |
| Pre-checked marketing opt-in box at checkout | **Illegal under GDPR**, gray area in US | GDPR requires affirmative unticked opt-in |
| Send transactional emails (ticket confirmation, event reminder, schedule change) without marketing consent | **Legal everywhere** | Transactional ≠ marketing |
| Send "soft opt-in" follow-ups about *similar events from the same brand* with unsubscribe link | **Legal in US (CAN-SPAM), Canada (CASL "implied consent")**, restricted in EU | The buyer-seller relationship grants implied consent for similar offers, with easy opt-out |
| Aggressive multi-touchpoint consent prompts (checkout + post-purchase + onboarding + brand follow) | **Legal everywhere** | As long as the prompt is honest and the path to "no" exists |

**What this means for the build:** "Impossible to decline" is not legally
available, but we can engineer a consent UX that makes opting in the obvious,
easy path and gets us close. The achievable number is **75–85% consent rate**
with the strategy below — vs. the typical 20–30% for industry-standard checkout
checkboxes.

#### 3.2.2 The maximum-reachability consent strategy (M1 implementation)

**Layer 1 — Transactional capture (mandatory, legal):**

- Checkout REQUIRES email + phone (M2 enforces this; see §3.3).
- Both fields are verified (email magic link, phone OTP).
- Buyer cannot complete purchase without verified contact details.
- This data is stored regardless of marketing consent — used for ticket
  delivery, event-day reminders, schedule changes, refunds.

**Layer 2 — Soft opt-in default (legal in US + Canada):**

- By purchasing a ticket from a brand, the user **automatically receives**:
  - Pre-event reminders for *that specific event* (transactional)
  - Post-event follow-up survey (transactional)
  - Notifications about *similar events from the same brand* (soft opt-in,
    legally defensible, must include unsubscribe)
- This is communicated at checkout via a clear, non-checkboxed disclosure:
  > "By purchasing, you agree to receive event updates and similar-event
  > offers from {brand}. You can unsubscribe at any time."
- Stored in `marketing_consent` as `consent_type = 'soft_opt_in'`.
- EU users (detected by IP / billing country) get a different flow: explicit
  unticked opt-in required (GDPR-compliant).

**Layer 3 — Explicit opt-in for full marketing (prominent, optional, legal):**

- After the soft opt-in disclosure, present a prominent (but skippable) UI:
  > "Get the best deals from {brand}? We'll send you exclusive presales,
  > early access, and member-only events."
  > [ Yes, send me deals (big primary button) ] [ No thanks (small text) ]
- Default visual weight pushes "Yes". This is legal — the path to "No"
  exists and is honest.
- Stored as `consent_type = 'explicit_marketing'`.

**Layer 4 — Re-prompt at every consumer-app touchpoint (legal):**

- **Onboarding** (when consumer app is built): explicit consent step.
- **Post-purchase confirmation screen**: "Want VIP perks? Opt in to {brand}'s VIP list."
- **Brand follow flow**: tapping "Follow" auto-grants explicit marketing
  consent for that brand (clearly labeled).
- **Profile / settings**: a "Communications" page where users can see and
  modify all consents per brand and per channel.

**Layer 5 — Multiple-channel granular consent (legal, GDPR-compliant):**

- Consent is stored per (user, brand, channel). Email, SMS, and RCS each have
  separate consent rows.
- A user can opt into email but not SMS, etc.
- Default in non-EU jurisdictions: all three default to soft opt-in for the
  purchasing brand (Layer 2).

**Realistic outcome:** ~80% of US/Canada buyers reachable across at least one
channel (soft opt-in floor), ~50% reachable across all three explicitly,
~20–30% of EU buyers reachable (GDPR limits). This is the legally maximum
position.

#### 3.2.3 Schema for consent tracking

```sql
marketing_consent (
  id uuid pk,
  contact_email text,
  contact_phone text,
  brand_id uuid,                    -- null for "all Mingla" consent
  channel text,                     -- 'email' | 'sms' | 'rcs'
  consent_type text,                -- 'soft_opt_in' | 'explicit_marketing' | 'transactional_only'
  source text,                      -- 'checkout' | 'onboarding' | 'brand_follow' | 'settings'
  opted_in_at timestamptz,
  opted_out_at timestamptz,
  ip_address inet,                  -- audit trail for legal defense
  user_agent text,
  jurisdiction text,                -- 'us' | 'eu' | 'ca' | 'other' — drives consent rules
  raw_disclosure_text text          -- exact words shown to user, for legal proof
);
```

The `raw_disclosure_text` field is critical: in a TCPA lawsuit, we must prove
exactly what the user agreed to. Storing the exact disclosure text at the
moment of consent is the legal defense.

### 3.3 Modification M2 — Mandatory verified email + phone at every entry point

**Operator directive:** Every ticket purchase, on web or app, must collect
verified email AND phone. The Apple "Hide My Email" relay-address problem
must be neutralized.

#### 3.3.1 The "Hide My Email" problem

When a user signs in with Apple, they can choose "Hide My Email", which
creates a relay address like `xyz123@privaterelay.appleid.com`. Apple forwards
emails sent to that relay to the user's real Apple ID email. Three problems:

1. **The relay can break.** If the user revokes the app's access in their
   Apple ID settings, the relay stops forwarding silently. Mingla emails
   bounce into a black hole.
2. **The phone is missing entirely.** Sign in with Apple does not provide a
   phone number — it must be collected separately.
3. **Marketing deliverability is degraded.** Some carriers / inbox providers
   treat relay addresses with suspicion, hurting deliverability rates.

#### 3.3.2 The M2 strategy — separate "deliverable contact" from auth identity

We cannot prevent users from using Sign in with Apple (Apple App Store
guidelines mandate offering it if any social login is offered). But we CAN
require a separately-verified deliverable contact for any ticket purchase.

**The rule:** Authentication identity ≠ deliverable contact. They may be the
same address, or they may not. Both must be verified independently.

**Web buyer flow (anon, per existing Cycle 8a invariant):**

1. Buyer reaches checkout via `/checkout/{eventId}` (no auth required)
2. Required fields: name, email, phone
3. Email verified via OTP code sent to that exact address (must round-trip)
4. Phone verified via SMS OTP
5. If either OTP fails 3 times: purchase blocked
6. Both fields stored in `orders.buyer_email_verified` + `orders.buyer_phone_verified`

**Consumer app buyer flow (authenticated, may have used Sign in with Apple):**

1. Buyer reaches checkout from inside the app
2. Pre-fill from auth identity (email if available, phone if available)
3. **Mandatory step before payment:** "Confirm your contact details for ticket delivery"
   - Email field: pre-filled, editable, must be re-verified via OTP if changed OR if the auth email is a `privaterelay.appleid.com` address
   - Phone field: pre-filled if known, REQUIRED if not, verified via SMS OTP
4. **Privacy relay detection:** if email ends in `@privaterelay.appleid.com`,
   show a warning: "This is an Apple privacy relay address. We recommend
   using your real email so you don't lose access to your tickets if your
   Apple ID privacy settings change." Provide an editable field to override.
5. Both contacts verified before payment is captured.

**Why this works legally and practically:**

- We don't BLOCK users from using privacy relays — that would violate Apple's
  guidelines.
- We DO require a verified deliverable email at the order level — separate
  from the auth identity.
- Users who insist on the relay can keep it, but they've been warned and
  the responsibility is theirs.
- We capture phone universally (auth methods don't always provide it).

#### 3.3.3 Schema additions

```sql
-- New columns on orders table
ALTER TABLE orders ADD COLUMN buyer_email_verified boolean DEFAULT false;
ALTER TABLE orders ADD COLUMN buyer_email_verified_at timestamptz;
ALTER TABLE orders ADD COLUMN buyer_phone_verified boolean DEFAULT false;
ALTER TABLE orders ADD COLUMN buyer_phone_verified_at timestamptz;
ALTER TABLE orders ADD COLUMN buyer_email_is_relay boolean DEFAULT false;

-- Constraint: cannot complete order without both verifications
-- (enforced at application + DB trigger level)
```

DB trigger blocks `UPDATE orders SET status = 'paid'` unless both
verification flags are true. Belt-and-suspenders alongside app-level checks.

#### 3.3.4 Authentication-side enforcement (consumer app)

For NEW account creation (when consumer app onboarding is built later):

- Email/password signup: email must be verified via OTP before account active
- Sign in with Apple: still allowed (App Store mandate), but the app prompts
  the user immediately after first sign-in: "Add a backup email so you don't
  lose your account if Apple privacy relay changes." Heavily encouraged but
  not blocking (legal limit).
- Phone is collected during onboarding and verified via OTP — mandatory.

Result: every consumer app user has at least one verified non-relay contact
method by the end of onboarding, even if their auth identity is a relay.

### 3.4 Channels & registration timeline

| Channel | Provider | Cost (US) | Calendar gate | Engineering effort |
|---|---|---|---|---|
| **Email** | Resend (already in stack) | ~$0.0008/email | None | Low |
| **SMS** | Twilio | ~$0.008/msg | **10DLC registration: 1–3 weeks** | Medium |
| **RCS** | Twilio RBM | ~$0.015/msg | **RBM brand verification: 4–6 weeks** | Medium-High |

**Critical sequencing:** start 10DLC + RBM paperwork on **Day 1 of Phase A**.
By the time email blasts ship, the SMS/RCS channels will be unblocked.

### 3.5 RCS interactivity — what's possible vs. what users actually get

RCS Business Messaging supports rich cards with images, branded sender names,
verified-checkmark badges, and suggested-action buttons. For Mingla:

**Tier 1 — Standard rich card (works on most modern Android + iOS 18+):**

```
┌────────────────────────────────────┐
│ [event cover image]                │
├────────────────────────────────────┤
│ {Brand} ✓                          │
│ Sunset Rooftop Concert · Sat 8pm   │
│ $25 · 47 spots left                │
├────────────────────────────────────┤
│  [ Buy Ticket ]   [ Save for Later ] │
│  [ Get Directions ]                 │
└────────────────────────────────────┘
```

The "Buy Ticket" button deep-links to `/checkout/{eventId}` (anon-tolerant
per memory). The user lands on the existing Mingla checkout page in their
browser. **In-line payment inside RCS is not supported by carriers** — the
deep-link-to-checkout pattern is the maximum.

**Tier 2 — Quick replies (suggested replies that auto-fill):**

After the rich card, the message can offer quick replies like:
- "Yes, save my seat"
- "Tell me more"
- "Stop messages"

Tapping any of these sends a pre-formatted reply back to Mingla's Twilio
number, which our edge function processes.

**Tier 3 — Carousel (multiple cards):**

For "you might also like" multi-event suggestions. Lower carrier support;
deprioritize for MVP.

**Fallback strategy:** Twilio's RCS API automatically falls back to standard
SMS if the recipient's device doesn't support RCS. The SMS contains a short
URL (Mingla redirect with tracking) and the brand name in the body. Less
beautiful but always delivers.

### 3.6 Architecture (Track 1)

```
┌──────────── mingla-business: Marketing Hub UI ────────────┐
│  Audiences  │  Campaigns  │  Templates  │  Analytics       │
└─────────────────────┬─────────────────────────────────────┘
                      ↓
        ┌─── Supabase tables ───┐
        │  marketing_consent       (M1 — granular per channel/brand)
        │  marketing_audiences     (saved queries)
        │  marketing_campaigns     (campaign records)
        │  marketing_templates     (reusable content)
        │  marketing_messages      (per-recipient delivery log)
        │  marketing_unsubscribes  (global opt-out registry)
        │  marketing_clicks        (click-tracking redirects)
        └────────────┬─────────────┘
                     ↓
   edge fn: marketing-send (pg_cron triggered)
                     ↓
   ┌──────────┬─────────────┬──────────────┐
   ↓          ↓             ↓              ↓
 Resend    Twilio SMS   Twilio RCS    Webhook handlers
 (email)   (10DLC)      (branded RBM)  (delivery/open/click)
```

### 3.7 Tracking & attribution

Every link in every blast goes through a Mingla redirect:
`https://mingla.app/m/{trackingId}`. The redirect:

1. Logs the click to `marketing_clicks`
2. Adds UTM params (`utm_source=mingla&utm_medium=email&utm_campaign={id}`)
3. Forwards to the destination

If the user purchases, the order's UTM params link back to the campaign.
Dashboard shows: **sent → delivered → opened → clicked → converted → revenue**.

For SMS/RCS where opens aren't trackable: we infer engagement from clicks.
Email tracks both via Resend webhooks.

---

## 4. Track 2 — Mingla-Managed Ads

### 4.1 The agency model (Mingla owns the ad accounts)

Mingla operates as the advertiser-of-record. Business users do not bring their
own Meta Business Manager, do not deal with platform approvals, do not handle
billing with Meta directly. Mingla owns the relationship; business users
authorize Mingla to spend on their behalf.

**Tradeoffs:**

| Pro | Con |
|---|---|
| Zero onboarding friction | Mingla bears compliance + spend risk |
| Unified Stripe billing | Brand reputation tied to user campaigns |
| Cleaner UX | Spend anomaly detection on consolidated account at scale |

**Mitigation at scale:** Use Meta's "Business Manager → System User → child
ad accounts" structure. Each business gets a dedicated child ad account
created via API. Spend isolated, attribution clean. Migrate from single-account
to multi-account when aggregate spend approaches $50K/month.

### 4.2 The campaign workflow (mechanical, no AI yet)

```
1. Business user clicks "Promote this event" or "Promote my brand"
2. Picks goal:        Drive ticket sales (default) | Drive brand awareness
3. Picks budget:      Daily cap | Total cap | Duration
4. Picks audience:    Local (city radius) | Lookalike (past buyers) | Custom interests
5. Picks creative:    Upload image/video | Use event cover | Mingla auto-generate
6. Reviews:           Estimated reach, est. CPC, est. conversions
7. Funds account:     Stripe → ad_account_balance (pre-pay model)
8. Confirms launch:   UI confirm sheet (jailbreak-safety pattern)
9. Mingla edge fn:    Create campaign in Meta Ads API → campaign_id stored
10. Daily cron:       Pull metrics from Meta + AppsFlyer; deduct spend; pause if cap hit
```

**Pre-pay model (the only safe MVP):**

Business adds $X via Stripe → sits in `ad_account_balance` → spend deducted
as it incurs. No risk of unpaid bills. Low balance auto-pauses campaigns +
sends email.

### 4.3 Modification M3 — AppsFlyer cross-platform attribution (web + mobile)

**Operator directive:** AppsFlyer must track attribution for users who buy
tickets on the **Expo web** version, not just the mobile app.

#### 4.3.1 Answer: Yes, AppsFlyer supports this fully

AppsFlyer offers three relevant products:

| Product | Purpose |
|---|---|
| **AppsFlyer Web SDK** | Browser-side JavaScript SDK that fires conversion events from any web property (Expo web included) |
| **AppsFlyer S2S (Server-to-Server) Conversion API** | Server-side fallback when client-side tracking is blocked (Safari ITP, ad-blockers, cookie restrictions) |
| **PBA (People-Based Attribution)** | Cross-platform user-level attribution — links a user's web visit to their later app install or vice versa |

For Mingla's scenario (user clicks Mingla ad on Instagram → lands on Expo web
event page → buys ticket without installing the app), the flow is:

```
1. User clicks Meta ad     → URL contains AppsFlyer click parameters
2. Lands on Expo web       → AppsFlyer Web SDK fires page_view event
3. Adds to cart            → AppsFlyer Web SDK fires add_to_cart event
4. Buys ticket             → AppsFlyer Web SDK fires purchase event with revenue
5. Server confirms payment → S2S Conversion API also fires purchase (redundant, increases match rate)
6. AppsFlyer matches event → original ad click → attribution recorded
7. AppsFlyer postback      → Meta CAPI receives "this exact ad → this $25 purchase"
8. Meta auto-bidder learns → optimizes future ad delivery for similar buyers
```

#### 4.3.2 Caveats & best practices for web attribution

| Caveat | Impact | Mitigation |
|---|---|---|
| Safari ITP (Intelligent Tracking Prevention) | 1st-party cookies expire in 7 days, 3rd-party blocked | Use **first-party server-side tracking** (S2S Conversion API) as primary; Web SDK as supplementary |
| Chrome 3rd-party cookie sunset (rolling 2024+) | Cross-domain attribution degrades | Use AppsFlyer's **server-to-server postbacks** which don't rely on cookies |
| Privacy Sandbox (Chrome) | Future limits on conversion tracking | AppsFlyer adapting; monitor their roadmap |
| iOS 14.5+ ATT (App Tracking Transparency) | Blocks IDFA in mobile app context | Doesn't affect web flows; mitigates app-side attribution loss |
| Ad-blockers | Block client-side SDK calls | S2S Conversion API bypasses |

**Best-practice implementation for Mingla:**

1. **AppsFlyer Web SDK installed in Expo web bundle** — fires standard events
   client-side (handles 70–80% of attribution).
2. **Server-side `purchase` event fired from `orders` Stripe webhook** — via
   AppsFlyer S2S Conversion API. Captures the 20–30% the client-side SDK misses.
3. **First-party data hashing** — email + phone hashed (SHA-256) and sent with
   conversion events for "enhanced matching" (Meta CAPI feature, dramatically
   improves attribution match rate).
4. **OneLink (AppsFlyer's deep link)** — a single ad URL that:
   - On mobile with app installed → opens app to event page
   - On mobile without app → routes to App Store with deferred deep link
     (event page opens after install)
   - On desktop → opens Expo web event page
   - All three paths attributed to the same ad click
5. **Cross-platform user identity** — pass `customer_user_id` (anonymous UUID,
   then real user_id post-auth) to AppsFlyer so web → app journeys are linked.

#### 4.3.3 Schema additions for attribution

```sql
attribution_events (
  id uuid pk,
  event_name text,                    -- 'page_view' | 'add_to_cart' | 'purchase' | 'follow_brand' | 'install'
  source text,                        -- 'web_sdk' | 's2s_api' | 'mobile_sdk'
  appsflyer_id text,                  -- AppsFlyer's user identifier
  customer_user_id text,              -- Mingla's user_id or anon UUID
  attributed_campaign_id text,        -- Meta/Google/TikTok campaign ID
  attributed_ad_id text,
  attributed_creative_id text,
  value_cents bigint,                 -- revenue for purchase events
  raw_payload jsonb,                  -- full event payload for audit / debugging
  created_at timestamptz
);

ad_campaigns (
  -- existing columns...
  appsflyer_campaign_alias text       -- for matching back to AppsFlyer events
);
```

#### 4.3.4 Cost note

AppsFlyer pricing is event-based: ~$0.05–$0.10 per attributed conversion at
volume, with a minimum monthly commitment (typically $1K–$5K depending on
plan). At 100K MAU with 30% conversion to ticket purchase, this is
~$1,500–$3,000/month — material but well under the value generated by
attribution-optimized Meta ads (typical 3–5x improvement in CPA).

### 4.4 Modification M4 — Best-practices research before launching ads

**Operator directive:** Before we launch the ads feature, we must research
extensively from official sources AND industry experts to train our system
on best practices for conversion-optimized ad operations.

This research is a **mandatory pre-SPEC step** for Track 2. The mechanical ads
workflow CANNOT be specced until this research is complete and synthesized
into an internal "Mingla Ads Playbook" document.

#### 4.4.1 Research scope

The research must cover six topical areas:

**A. Conversion event hierarchy**

- Meta CAPI standard events (which to fire, in what order, with what params)
- Standard funnel events: ViewContent → AddToCart → InitiateCheckout → Purchase
- Custom event design for event-ticketing context
- Deduplication between Meta Pixel (web) and Meta CAPI (server)
- Match rate optimization (what user data improves attribution)

**B. Audience signal best practices**

- Lookalike audience source quality (1% vs 5% vs 10% lookalike, when each works)
- Custom audiences from past buyers (retention windows, refresh cadence)
- Interest-based vs. behavior-based targeting
- "Broad" targeting (let Meta find the audience) vs. precise targeting
- Audience overlap and cannibalization

**C. Creative best practices**

- Vertical 9:16 vs square 1:1 vs landscape 16:9 (which works on which placement)
- Static image vs. short video vs. carousel performance benchmarks
- Hook-first creative principles (capture attention in <3 seconds)
- UGC (user-generated content) vs. polished-brand creative
- Creative refresh cadence (when ads "burn out")
- Text-to-image ratio rules (Meta's 20% rule legacy)
- Music + voiceover impact on conversion

**D. Bid strategies & budget pacing**

- Lowest-cost bidding vs. cost cap vs. ROAS bidding (when each works)
- Daily budget vs. lifetime budget pacing
- "Learning phase" exit thresholds (50 conversions per ad set per week)
- Budget changes during learning phase (don't touch — common mistake)
- Front-loaded vs. evenly-paced budgets for time-sensitive events

**E. Attribution windows & measurement**

- 1-day-click vs. 7-day-click attribution (post-iOS 14.5)
- View-through attribution (1-day-view) — when to enable
- Aggregated Event Measurement (AEM) prioritization
- Holdout tests (proper measurement of incremental lift)

**F. Retargeting & frequency**

- Retargeting audiences (cart abandoners, page viewers, past buyers)
- Sequential messaging (different creative based on funnel stage)
- Frequency caps (when ads start hurting brand)
- Retargeting window optimization (3-day, 7-day, 30-day)

#### 4.4.2 Required sources

The research must synthesize from BOTH official documentation AND independent
industry experts. Single-source-of-truth is insufficient — Meta's docs are
sales-y, expert blogs have biases. Triangulate.

**Official sources (mandatory):**

- Meta Ads Help Center / Meta Business Help Center
- Meta Blueprint courses (free certifications) — particularly "Conversion-Focused Campaigns"
- Meta CAPI Best Practices documentation
- AppsFlyer Knowledge Base — particularly attribution windows + iOS 14.5 guidance
- Apple App Store Review Guidelines (ATT compliance)
- Google Ads Skillshop
- TikTok Business Center education

**Industry expert sources (mandatory, at least 3):**

- Common Thread Collective (Andrew Faris) — DTC brand-side ad operator perspective
- Foxwell Digital (Andrew Foxwell) — testing methodology, creative strategy
- Savannah Sanchez (creative strategy thought leader)
- Disruptive Advertising blog
- ConversionXL / CXL Institute
- Kurt Bullock / Productive Media (event ticketing focus)
- Eventbrite's marketing playbook (closest competitor segment)
- Bandsintown / Dice marketing case studies

**Mingla-specific synthesis:**

The research output is NOT a list of links. It's an internal document:
`Mingla_Artifacts/MINGLA_ADS_PLAYBOOK.md` — a synthesized, opinionated playbook
for how Mingla runs ads on behalf of business users. It must answer:

- What's our default campaign template for a new event ad?
- What conversion events fire, in what order, with what parameters?
- What audiences do we build for every business by default?
- What creative formats do we accept / auto-generate / require?
- What bid strategy do we default to at what spend level?
- What KPIs are reported back to the business user?
- What guardrails prevent waste (e.g., auto-pause if CPA > 2x target)?

#### 4.4.3 Research dispatch (when triggered, sequenced)

This research is dispatched as a **forensics/general-purpose research agent**
task, NOT an implementation task. The output is a single playbook document.
The research happens in **Phase E sub-step 0** (before any mechanical ads code
is written).

Estimated effort: 8–16 hours of research + synthesis. Should be its own
ORCH cycle when triggered.

### 4.5 Optimization (phased, mechanical → AI)

**Phase E (mechanical, MVP optimization):**

- Use Meta's "Sales" objective with Conversions API events
- Auto-bidding optimizes for purchase events (driven by AppsFlyer postbacks)
- Mingla's job: budget cap enforcement (DB triggers), pause/resume, basic insights

**Phase F (Mingla-layer optimization, post-MVP, pre-AI):**

- Daily cron compares CPA across ad sets
- Auto-pauses ad sets with CPA > 1.5x median
- Auto-shifts budget to ad sets with CPA < 0.7x median
- Surfaces insights in dashboard

**Phase G (Mingla Brain AI optimization, per `MINGLA_BRAIN_AGENT_STRATEGY.md` P3):**

- Conversational diagnostics: "Why is this campaign underperforming?"
- Predictive recommendations: "Spend $200 more on this ad set to hit 50 more conversions"
- Cross-business pattern learning (anonymized)

### 4.6 Schema additions (Track 2)

```sql
ad_accounts (
  brand_id uuid pk,
  balance_cents bigint default 0,
  total_funded_cents bigint default 0,
  total_spent_cents bigint default 0,
  low_balance_threshold_cents bigint default 1000,
  meta_ad_account_id text,            -- if/when we shard to per-business accounts
  created_at timestamptz
);

ad_campaigns (
  id uuid pk,
  brand_id uuid fk,
  target_type text,                   -- 'event' | 'brand'
  target_id uuid,
  meta_campaign_id text,
  goal text,                          -- 'sales' | 'awareness' | 'traffic'
  daily_budget_cents bigint,
  total_budget_cents bigint,
  status text,                        -- 'draft' | 'active' | 'paused' | 'completed' | 'cap_exceeded'
  appsflyer_campaign_alias text,
  created_at timestamptz,
  launched_at timestamptz
);

ad_creatives (
  id uuid pk,
  campaign_id uuid fk,
  type text,                          -- 'image' | 'video'
  storage_path text,
  meta_creative_id text,
  approval_status text,               -- pending | approved | rejected
  rejection_reason text
);

ad_spend_log (
  id uuid pk,
  campaign_id uuid fk,
  date date,
  spend_cents bigint,
  impressions int,
  clicks int,
  conversions int,
  raw_meta_payload jsonb,
  created_at timestamptz,
  unique (campaign_id, date)
);

-- Spend cap trigger:
-- BEFORE INSERT/UPDATE on ad_spend_log,
-- if (campaign's total spend after this row) > campaign's total_budget_cents,
-- pause the campaign via Meta API + flip status to 'cap_exceeded'.
```

---

## 5. Compliance Risks (Cross-Track)

| Risk | Track | Severity | Mitigation |
|---|---|---|---|
| TCPA violation (SMS without explicit consent) | 1 | **Critical** ($500–$1,500 per text fines) | M1 multi-layer consent + audit trail |
| GDPR violation (EU user without explicit opt-in) | 1 | **Critical** (4% global revenue fines) | Jurisdiction-aware consent flow |
| CAN-SPAM violation (no unsubscribe link) | 1 | High ($50K per violation) | Mandatory unsubscribe in every email + STOP keyword for SMS |
| Twilio 10DLC unregistered → SMS blocked | 1 | High | Start registration on Day 1 of Phase A |
| Meta ad policy violation (banned content categories) | 2 | Medium (account suspension) | Pre-screen creative; auto-reject high-risk content (alcohol-heavy nightlife) |
| AppsFlyer attribution mismatch / leakage | 2 | Medium (wasted spend) | S2S Conversion API + first-party data hashing |
| Apple App Tracking Transparency violation | 2 | Medium (App Store rejection) | Honest ATT prompts; respect declined permissions |
| Stripe ad-spend pre-funding refund disputes | 2 | Medium | Clear ToS; no refund of unspent balance after 90 days idle |

---

## 6. Phasing Recommendation (Sequential)

| Phase | Scope | Calendar gates | Risk |
|---|---|---|---|
| **Phase 0 — Consent + verified contact foundation** | M1 consent schema, M2 verified email/phone at checkout, jurisdictional flow, audit log | None | Medium (legal) |
| **Phase A — Email blasts MVP** | Resend integration, ticket-buyer audience, composer, schedule, click tracking, unsubscribe | None (Resend instant) | Low |
| **Phase B — SMS blasts** | Twilio 10DLC registration, same audience model, STOP keyword, opt-in granularity | **10DLC: 1–3 weeks** (start parallel with Phase A) | Medium |
| **Phase C — RCS** | Twilio RBM brand verification, rich card composer, suggested actions, SMS fallback | **RBM: 4–6 weeks** (start parallel) | Medium |
| **Phase D — Brand followers** | `brand_follows` table, follow button, follower-based audiences | None | Low |
| **Phase E — Ads research (M4)** | Synthesize official + expert best practices into `MINGLA_ADS_PLAYBOOK.md` | None | Low (research only) |
| **Phase F — Mechanical ads** | Stripe pre-pay, Meta Ads API integration, AppsFlyer Web SDK + S2S, OneLink, daily cron, spend caps | **Meta BM onboarding: 1–2 weeks** | High |
| **Phase G — Mechanical optimizer** | CPA-based pause/boost cron, dashboard insights | None | Medium |
| **Phase H — Mingla Brain (AI agent)** | Per `MINGLA_BRAIN_AGENT_STRATEGY.md` | Gated on Phase G Grade A | High |

**Critical sequencing notes:**

- **Pre-gate (per §0):** B2 → B3 → B4 must all be live and B4 stable for 4+ weeks
  before any phase below kicks off, EXCEPT Phase E.
- **Phase E exception:** Ads research may be dispatched in parallel with B2 / B3 /
  B4 implementation. Pure synthesis work, no code dependencies.
- Phase 0 ships **before** Phase A. No blasts without consent foundation.
- Phases A, B, C run in parallel calendar tracks (paperwork blocks B and C while
  engineering ships A).
- Phase E (research) ships **before** Phase F (engineering). The playbook informs
  the SPEC.
- Phase H (AI) is locked in `MINGLA_BRAIN_AGENT_STRATEGY.md` §11.1 — gated on
  mechanical ads being Grade A in Launch Readiness Tracker.

---

## 7. Open Product Decisions (Operator-Owned)

These are decisions Seth must make; engineering can't decide:

1. **Phase 0 launch threshold** — do we hold all blast features until consent
   schema is live, or grandfather existing users with email-only soft opt-in?
2. **EU jurisdiction handling** — do we restrict EU buyers (avoid GDPR
   complexity) or fully implement GDPR-compliant flow at MVP?
3. **Pre-pay refund policy** — what happens to unspent ad balance after 90/180
   days? Auto-refund? Forfeit to Mingla?
4. **Ad creative approval** — who approves ad creative before submission to
   Meta? Auto-approve and let Meta reject? Manual review by Mingla? AI screen?
5. **Soft opt-in lookback window** — how long after a purchase can a brand
   email a buyer about "similar events"? (US/CASL allows ~2 years; we may set shorter)
6. **Per-business send limits** — what's the max blast volume per day to
   prevent reputation damage? (e.g., 10K SMS/day per brand)
7. **RBM brand verification owner** — who handles the back-and-forth with
   Google + Twilio for RCS brand approval? Internal vs. external consultant?
8. **Multi-account migration trigger** — at what aggregate Meta spend do we
   shard to per-business child ad accounts? ($25K/mo? $50K/mo?)

---

## 8. Confidence Levels

| Claim | Confidence | What would raise it |
|---|---|---|
| Consent compliance strategy (M1 §3.2) | **High** | Already established TCPA / GDPR / CAN-SPAM legal precedent |
| Apple privacy relay handling (M2 §3.3) | **High** | Apple's documentation is clear; pattern is industry standard |
| AppsFlyer cross-platform attribution (M3 §4.3) | **High** | AppsFlyer publicly documents Web SDK + S2S + OneLink; widely deployed |
| 75–85% reachability outcome | **Medium** | Industry benchmark; depends on UX execution quality |
| Ads optimization improvement vs click-only (3–5x) | **Medium** | Cited industry benchmark; Mingla-specific TBD |
| Phasing duration estimates | **Medium** | Engineering estimates; calendar gates (10DLC, RBM, BM) variable |
| Cost projections at scale | **Medium** | AppsFlyer + Twilio pricing tiers depend on negotiation |

---

## 9. Conversion Path: This Doc → SPEC → Implementation

This is brainstorm-locked strategy. Before any code is written:

1. Operator confirms M1 implementation strategy (multi-layer consent, not "impossible to decline")
2. Operator confirms M2 implementation strategy (verified email/phone separate from auth identity)
3. Operator confirms M3 implementation (AppsFlyer Web SDK + S2S + OneLink)
4. Operator confirms M4 research dispatch happens before any ads SPEC is written
5. Forensics writes a SPEC for **Phase 0 only** (consent + verified contact foundation)
6. Implementor executes; Tester verifies; Orchestrator closes
7. Then SPEC for Phase A; repeat for each phase sequentially
8. Phase E (M4 research) is a separate dispatch type — research, not implementation
9. Phase F mechanical ads SPEC explicitly references the M4 playbook output

This is a strategy document, NOT a spec. Do not dispatch implementor against this file.

---

## 10. Cross-References

- **`BUSINESS_PROJECT_PLAN` §B.6 + §B.4 + §B.5** — defines Cycles B2, B3, B4
  (the prerequisite chain for this doc) and §B.5 marketing infrastructure
  (this doc's scope).
- **`BUSINESS_PRD` §8, §9, §10** — original product requirements for marketing,
  CRM, and analytics surfaces.
- **`Strategic Plan` §4** — locks marketing surface as out-of-MVP / Post-MVP.
- **`Strategic Plan` §6 R3, R11, R14** — risk register entries: financial
  reconciliation (R3, gates B3), NFC platform support (R11, gates B4), spam
  through marketing tools (R14, governs M1 consent design in this doc).
- **DEC-076** — auth model decision (buyers can be guest or logged-in);
  preserved by Cycle 8a anon buyer invariant; reflected in §3.3 M2 strategy.
- `Mingla_Artifacts/MINGLA_BRAIN_AGENT_STRATEGY.md` — the AI-agent layer that
  sits on top of this hub. Mingla Brain P3 (ads) is gated on this hub's
  Phase F + G being Grade A.
- `Mingla_Artifacts/INVARIANT_REGISTRY.md` — the new invariants codified by
  this hub (consent audit trail mandatory, verified contact mandatory, spend
  cap DB-trigger enforced) will be added on Phase 0 close.
- Cycle 8a invariant (anon buyer routes outside `app/(tabs)/`) — preserved by
  this hub. Buyer flow remains anon-tolerant; verified email/phone is
  collected per-order, not tied to auth.
- Cycle 12 ticketing schema — this hub builds on `orders` table (M2 adds
  verification columns).
- Cycle 17 Stripe wiring — proves the pre-pay billing pattern works for ads.
- AppsFlyer integration in `app-mobile` and `mingla-business` — already in
  stack per system memory; M3 extends to Expo web.
- Twilio integration — already in stack per system memory; new use case
  (10DLC-registered marketing SMS, RBM-verified RCS).
- Resend integration — already in stack per system memory.

---

## 11. Memory References to Update on Phase 0 CLOSE

When Phase 0 closes (consent + verified contact foundation shipped):

- New project memory: `project_marketing_consent_required.md` — every blast
  feature MUST query `marketing_consent` before sending; every checkout MUST
  collect verified email + phone; jurisdictional flow MUST be respected.
- New invariant: `I-MARKETING-CONSENT-REQUIRED` — registered in
  `INVARIANT_REGISTRY.md`, backed by CI gate (strict-grep registry pattern
  per Cycle 17b memory).
- New invariant: `I-VERIFIED-CONTACT-AT-PURCHASE` — `orders` cannot transition
  to `paid` without `buyer_email_verified` AND `buyer_phone_verified` true.
  Backed by DB trigger + CI gate.

---

**End of strategy artifact. Locked 2026-05-06. Modifiable as direction evolves.**
