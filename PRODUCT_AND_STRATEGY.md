# Mingla — Product & Strategy

> **This is the canonical product and strategy document for Mingla.**
> It states what Mingla is, what is live, what we will not compromise on, where growth
> comes from, and the roadmap at initiative level.
>
> - **Day-to-day work** lives as issues on the Mingla Avengers board:
>   https://github.com/orgs/Mingla-LLC/projects/4
> - **Pre-2026-07-19 detail** (per-issue history, close notes, old roadmap ledgers) is
>   preserved at git tag `pre-avengers-archive`. Nothing in the archive overrides this
>   document.
>
> Last distilled: 2026-07-19. If this document and the Avengers board disagree on the
> status of a specific piece of work, the board wins; if they disagree on positioning,
> principles, or strategy, this document wins.

---

## 1. What Mingla Is

Mingla is an **experience app**: it connects people to real-world experiences — venues,
events, trips, and multi-stop plans — and gives the businesses behind those experiences
the tools to be found, booked, and paid.

**Mingla is never a dating app.** This is non-negotiable positioning. Mingla helps
couples, friend groups, and solo explorers plan real-world outings (including dates),
but it does not match strangers and it is never described, marketed, or built as a
dating product. The word "dating app" is on the words-to-avoid list, and business-side
code is explicitly barred from importing consumer pairing/matching patterns.

**One-line positioning (canonical):** Mingla is the vibe-to-plan decision engine for
consumers plus the growth operating system for venues and experience brands.

- Consumer tagline: *"Find the plan that fits the vibe."*
- Brand close: *"Find the plan. Feel the city. Show up."*

The canonical brand voice lives in the verbatim voice-and-scripts document (three
scripts: Consumer, Business, Brand Manifesto). All external copy anchors to it; the
scripts are quoted, never paraphrased.

### The two apps

**Mingla Explorer** — the consumer app (iOS + Android).
For people who want to go out but hate deciding. Vibe-based discovery of places and
events, curated multi-stop plan decks (romantic, first-date, group-fun, adventurous,
and more), collaborative planning with a partner or friend group, guest lists and
RSVPs, tickets, trips and experiences, and the Mingla+ subscription for expanded
planning features. The initial consumer ICP is the **Social Plan Captain**: an urban
22–35 year old who regularly decides where the date, the friend hangout, or the
new-city weekend happens — date-night planners, friend-group plan captains, and
new-city social rebuilders.

**Mingla Business** — the business app (iOS + Android) plus the buyer-facing web.
For event organisers, venues, restaurants, bars, activity spaces, and experience
brands. Create a brand and as many venue listings as it really has; author events,
RSVP parties, trips, and experiences; sell tickets with honest all-in pricing; take
reservations; scan guests at the door; collect voluntary "Chip In" gifts on free
RSVPs; get paid out; and use AI assists (the Ari assistant, menu-snap-to-experiences)
to author faster. Every offering gets a polished public page on the web that a
stranger can open cold from a shared link and buy from — the buyer web is how demand
reaches supply without needing the app first.

### The two-sided thesis

Consumer Mingla builds a **demand graph** — real signals about vibes, places, events,
friends, and plans. Mingla Business turns that demand into bookable, sellable
experiences. Every other tool sells software to the same supply side; only Mingla owns
the demand side. **Demand-graph integration is the defensible wedge**: your event or
venue does not just get a page, it meets people already looking for that kind of
night.

### North Star

- **Business North Star: GMV processed through Mingla per month.** Every business-side
  metric (organisers with a live event, time-to-first-sale, payout trust) is a leading
  indicator of it.
- **Consumer North Star: active users whose plans turn into real outings** — the
  strategic growth goal is 100,000 active users within 12 months, built on repeat
  planning habits, group virality, and local supply density, not content volume.

---

## 2. Current Live State (2026-07-19)

**Fully launched.** All four store listings — Mingla Explorer (iOS + Android) and
Mingla Business (iOS + Android) — are live on the App Store and Google Play at
version 1.1.2. The two apps always ship the same version number, together. The
buyer-facing web (public event/brand/venue pages, checkout, RSVP, invite accept) is
live, along with the marketing site and a careers site.

**Live markets:** London, US cities, and Lagos. Growth beachheads are Lagos and the
Raleigh/Triangle area, with DC and New York entered as the playbook proves out.

**Payments are real money, on two rails:**

- **Stripe (live mode)** — card checkout for tickets, reservations, trips, and
  experiences, with brand-level Stripe Connect payouts (each brand owns its own
  connected account) and dispute events routed and persisted.
- **Paystack (live mode)** — the Nigeria rail, including a partner rail with revenue
  share, so Lagos hosts can collect in naira.
- **Chip In** — guests who RSVP free to a party can voluntarily chip in a gift, on
  card and in Nigeria; coming stays free.
- **Mingla+** — the consumer subscription, sold through the app stores via
  RevenueCat.

**Supporting infrastructure that is live:**

- Roughly 35,000 seeded places with photos, hours, and descriptions power consumer
  discovery and let a business claim its venue with everything pre-filled.
- An admin console with full visibility and audited edit powers across users, brands,
  offerings, venues, and money.
- End-to-end ad attribution on the business web: browser pixels plus server-side
  conversion senders across four ad platforms, and AppsFlyer smart links
  (go.usemingla.com for Explorer, biz.usemingla.com for Business) so installs and
  purchases can be traced to channels.
- Transactional email and SMS (US SMS live; a cheap Nigeria SMS route is built and
  ready to switch on), confirmation emails with QR ticket PDFs for every offering
  type, and outbound sales calling.
- Supply and influencer CRMs feeding founder-led outreach (current supply focus:
  fine dining across the live-market cities).

**Stack:** React Native / Expo (both apps from one monorepo; Expo Web serves the
business/buyer web), Supabase (Postgres + RLS, edge functions, realtime, storage,
auth), Vercel for web deploys, Bunny Stream for video, Stripe + Paystack for money.
Pure-JS changes ship over-the-air; native builds only when needed.

---

## 3. Product Principles (Non-Negotiable)

These govern every feature, every PR, and every piece of copy.

1. **Experience app, never dating.** No matching-app framing, patterns, or copy —
   anywhere, ever.

2. **All-in pricing, honestly displayed.** The price a buyer sees is the price they
   are charged, on every screen from public page to cart to receipt. Fees and tax
   appear as ONE combined "Fees & tax" line. Brands control whether fees/tax are
   passed to the buyer or absorbed. The displayed number and the charged number read
   from one server-computed source so they can never drift.

3. **Cross-surface parity.** Public offering pages exist on the buyer web, inside the
   business app, and inside the consumer app. Any change to a public page must land
   on ALL surfaces — ideally as one shared component. A feature is not done until it
   works on every surface it appears on.

4. **No fabricated data, no lying empty states, no silent failures.** Dashboards
   derive from real queries. Empty states appear only when something is genuinely
   empty. Errors surface to the user with actionable copy.

5. **Database is the source of truth. AI never is.** AI features (Ari, menu snap,
   pitch generation, future Brain) draft and assist on top of the structured system;
   they never invent state, self-publish, or bypass approval gates.

6. **Trust before growth.** Money paths are idempotent, webhook-safe, and
   reconciled. RLS is deny-by-default on every table. Sensitive actions are audit
   logged. Payment onboarding fails closed. We do not market what is not proven.

7. **Brand voice is warm, cinematic, and human — never salesy.** Social content is
   influencer-first: the value stands alone and the app is who we are, not what we
   pitch. Marketing copy never promises what is not built and shipped.

8. **Unified releases.** Both apps carry the same version and are bumped together.
   Store-facing contact is always support@usemingla.com.

---

## 4. Strategy

### Where growth comes from

**Supply first, concierge-led.** The bottleneck is not awareness or measurement — it
is getting hosts, venues, promoters, and trip organisers live *this week*. The motion
is concierge onboarding: "send us your flyer, ticket tiers, and links — we build your
Mingla page and hand you a promo pack." Every published listing ships with promo
assets and a tracked link; nothing is published silently. AI drafts, researches, and
organizes; **humans close**. The numbers that count: creators contacted → onboarded →
listings live → RSVPs/tickets → repeat creators.

**Beachheads, not blankets.** Lagos (dense culture, nightlife, creators, local rails
already built) and the Raleigh/Triangle area (controllable, relationship-buildable)
get the focused push; London runs alongside; DC and New York scale once the playbook
is proven in a beachhead.

**Founder-led demand.** Consumer demand is built through founder-led, influencer-first
organic content and creator partnerships, with smart links in bios and full
attribution now in place so paid channels can be tested honestly, channel by channel,
and killed or scaled on evidence.

### The key bets

1. **The demand-graph wedge.** Businesses join Mingla because it brings people, not
   because it is another dashboard. Everything that deepens consumer taste, plan, and
   social data compounds the business-side pitch.

2. **Full rooms: complete venue commerce.** One surface for the whole lifecycle —
   listing, events, tickets, reservations, door scanning, payouts, reconciliation —
   replacing the stitched-together stack (ticketing + RSVP tools + spreadsheets +
   door apps). GMV through this loop is the north star.

3. **Nigeria as a first-mover market.** Local corporate entity, Paystack rail with
   partner revenue share, naira-cheap SMS, and Lagos supply density — infrastructure
   most competitors will not build.

4. **Mechanical ads first, then the AI layer.** A five-channel ad engine (tokens and
   attribution already provisioned) makes paid acquisition a measurable machine.
   Mingla Brain — the conversational agent across consumer, business, and admin —
   comes only after the mechanical rails are proven, so AI automates working systems
   instead of inventing state.

5. **Subscription plus take rate.** Consumer monetization through Mingla+; business
   monetization through the payment take rate today, with marketing tools and managed
   ads as the expansion revenue path once supply and consent foundations mature.

### What we will not do

- Build the AI agent ahead of the structured commerce system it must sit on.
- Treat marketing automation as a launch feature.
- Claim readiness, in copy or store listings, above what is shipped and proven.
- Spread growth effort evenly across every market at once.

---

## 5. Roadmap by Horizon

Initiative-level view. Statuses of individual items live on the Avengers board.

### Now

- **Turn the ad engine on.** The five-channel paid-acquisition pipeline is
  provisioned (tokens, specs, attribution); the work now is making each channel able
  to create and run a real ad, then testing spend against measured installs and
  purchases.
- **Concierge supply acquisition in the beachheads.** Fill Lagos and the Triangle
  (plus London) with live venues, events, and trips through the supply CRM,
  fine-dining prospecting, and hands-on onboarding with promo packs.
- **Founder-led content and influencer pipeline.** Keep demand-side organic content
  shipping weekly with tracked bio links; grow the influencer roster through the
  intake CRM.
- **Admin console completion.** Finish the remaining full-visibility/edit console
  work so support and operations never need raw database access.
- **Store listing and funnel polish.** Keep the download funnels (device-aware "get
  the app" flows, email CTAs, smart links) converting cleanly now that all listings
  are live.

### Next

- **Social proof in the consumer app.** "Who's going" cards and richer guest-list
  surfaces that make events feel alive and drive invites.
- **Native parity for recently web-shipped features.** Chip In screens and other
  web-first flows ride onto the phone apps with the next native builds.
- **Switch on Nigeria SMS.** The Termii route is built and dark; flip it live once
  the wallet is funded, unlocking cheap transactional reach in Lagos.
- **Business app ergonomics.** Home to-do redesign, unified cover-media picker, and
  publish-integrity guards for paid offerings.
- **Growth measurement deepening.** Extend the visibility floor (tracked links, UTM
  discipline, conversion events) toward per-channel cost and LTV truth — added as
  live supply and spend justify it, not before.

### Later

- **Marketing Hub for businesses.** Blasts, CRM, consent management, tracking, and
  managed ads inside Mingla Business — strategy locked, gated on stable commerce
  volume and a consent/contact foundation.
- **Mingla Brain.** The conversational agent across consumer, business, and admin,
  built on the proven mechanical rails (events, tickets, payments, ads), with
  approval gates and spend caps from day one.
- **Trust and operational hardening cluster** (explicitly parked to Later,
  2026-07-18): booking-deadline enforcement, sold-out race protection at capacity,
  clearer invite-error recovery, CI guard blind-spots, and a redesigned admin access
  gate before onboarding additional admins.
- **Offering-page standardization, trip leg.** Bring the trip public page fully onto
  the single shared-page pattern the event page already uses (on hold).
- **Market expansion.** Scale DC and New York — and evaluate new markets — once a
  beachhead playbook demonstrably repeats.
- **Growth OS at full depth.** The warehouse, CPL/CAC-by-channel joins, and the
  automated team feedback loop, once there is enough live volume to make the
  machinery worth its cost.

---

*Sources: the pre-archive roadmap and artifacts set (feature registry, high-level
roadmap, product snapshot ship log, Business PRD / strategic plan / project plan,
living GTM, ICP, growth, and canonical voice documents), distilled 2026-07-19. Where
older planning documents conflicted with shipped reality, shipped reality won.*
