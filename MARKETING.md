# Mingla — Marketing (Canonical)

> **This is the canonical marketing document for Mingla.** It holds current truth only: brand,
> voice, channels, infrastructure, motion, and markets. Marketing work items live as issues on the
> **Mingla Avengers board**: https://github.com/orgs/Mingla-LLC/projects/4. Historical marketing
> material (per-ORCH close notes, superseded strategy docs, archived roadmap files) is preserved at
> git tag `pre-avengers-archive` — do not resurrect it as current truth.
>
> Last distilled: 2026-09-01.

---

## 1. Brand & Voice Essentials

### What Mingla is (and is not)

- Mingla is an **experience app** — vibe-based discovery and planning for real life. It is
  **never** positioned or described as a dating app.
- One-line positioning: Mingla is the vibe-to-plan decision engine for consumers plus the growth
  operating system for venues and experience brands.
- Consumer tagline: **"Find the plan that fits the vibe."**
- Brand close: **"Find the plan. Feel the city. Show up."**
- The enemy is the group chat that goes nowhere, stale date ideas, and generic local search.

### Two sides of the marketplace

| Side | App | Who it serves |
|---|---|---|
| Consumer (Explorer) | Mingla | Date-night planners, friend groups, solo explorers, people new to a city |
| Supply (Business) | Mingla Host | Restaurants, bars, venues, cafés, activity spaces, event organisers, creators |

### Voice

The verbatim source of truth for voice is the canonical voice document with its three scripts
(Consumer: "Less Planning. More Living." / Business: "Your Place Deserves to Be Found." /
Manifesto: "Real Life Is Still the Point."). All external copy anchors to those scripts — do not
paraphrase them. In brief:

- Consumer voice: warm, cinematic, intimate. Less searching, less overthinking, more showing up.
- Business voice: empathetic, founder-led, pro-local-business. "You shouldn't need to become a
  full-time marketer just to help your community understand why your place matters."
- Words we use: vibe, plan, experience, organiser, brand, public page, trust, follow-up.
- Words we avoid: dating app, generic event listing, AI magic, guaranteed revenue, and any claim
  about features that are not actually shipped.

### Content posture (non-negotiable)

**Influencer-first, never salesy.** Founder-led organic content builds authority in Mingla's
domain — going out, local discovery, city life. Most posts do not pitch the app at all; the value
stands alone and the app is who the founder is, not what he sells. Salesy content is rejected on
sight, in both founder content and creator collaborations.

---

## 2. Channels & Infrastructure

### App stores

- **Fully launched.** All four listings (Mingla + Mingla Host, App Store + Google Play) are
  LIVE at version 1.1.2. Both apps always ship the same version number.
- Store creative (screenshots, feature banners) exists only in the store consoles; it is
  recoverable read-only via the App Store Connect and Play APIs if assets are ever needed again.
- Store copy, release notes, and ASO changes go through the canonical voice — never promise
  unshipped features.

### Smart links (AppsFlyer OneLink, branded subdomains)

| Audience | Link | Use |
|---|---|---|
| Consumer (Explorer) | `go.usemingla.com/w36m` | Bios, organic content, consumer campaigns |
| Business | `biz.usemingla.com/ZSCW` | Business bios, partner outreach, supply campaigns |

- Bio links carry `pid=bio_<platform>` (e.g. `bio_instagram`, `bio_tiktok`) so installs attribute
  to the platform the click came from.
- Both subdomains are branded and live; each OneLink domain maps to exactly one template, and the
  CNAME target is per-subdomain.
- Email download CTAs are device-aware via a **server-side 307 redirect**, not client-side JS —
  reuse that pattern for any email that offers the app.

### Attribution stack (LIVE as of 2026-07-19)

- **Browser pixels:** 4 live on `host.usemingla.com` — Meta, TikTok, Reddit, Snap.
- **Server-side:** 4 conversion-API (CAPI) senders mirror those networks from the backend.
- All senders are **fail-open** — attribution failures never block a user-facing flow.
- All CAPI tokens are consolidated in the single `AD_CONVERSION_TOKENS` secret.
- Rule of thumb from shipping this: always live-fire CAPI senders against the real endpoints
  before trusting them; network docs drift (endpoint versions, action-source fields).
- AppsFlyer handles install/app attribution behind the smart links above.

### Web properties

| Property | What it is |
|---|---|
| `usemingla.com` | Canonical marketing and editorial origin (source in `mingla-marketing/`) |
| `host.usemingla.com` | Buyer and operator product authority (source in `mingla-business/`) |
| `career.usemingla.com` | Isolated careers site, live |
| `go.usemingla.com` / `biz.usemingla.com` | Branded smart-link subdomains (above) |

`www.usemingla.com` is an alias only and permanently redirects to the apex while preserving the
path and query. Careers, public share routes and assets, internal share APIs, and `.well-known`
association files stay isolated from that marketing redirect and search lifecycle.

### Search indexing contract

- Every marketing route is assigned exactly one lifecycle state by
  `mingla-marketing/lib/search/route-registry.ts`: `draft`, `public_noindex`, `search_ready`,
  `stale`, `expired_archived`, `redirected`, or `gone`.
- Only `search_ready` pages receive self-canonicals and enter the sitemap. Draft, public-noindex,
  stale, and expired pages carry `noindex`; redirects are permanent; gone routes return 410.
- The initial search-ready set is the apex home page, Host home page, Tools hub and its Events,
  Venues, Trips, and Pricing pages, Support, Privacy Policy, and Terms of Service. Utility,
  unsubscribe, preview, report, order, chat, board, and invite routes are deliberately excluded.
- Visible marketing demos may use clearly illustrative metrics to explain the product. Search
  metadata and structured data must remain factual: no invented ratings, reviews, usage totals,
  download counts, or performance claims.
- Search crawlers receive the same status, canonical, primary answer, and entity graph as ordinary
  browsers. AI search agents may crawl; model-training-only crawlers are blocked by default.

### Email & contact

- **Public contact is always `support@usemingla.com`** — never a personal address, anywhere
  public-facing (stores, site, outreach templates, legal text).
- Transactional email sends through the backend dispatch pipeline (Resend). A hosted email
  signature exists for founder outreach.
- Nigeria SMS rail (Termii) is built but currently dark behind a flag.

### In-product Marketing Hub (adjacent, for clarity)

The **Marketing Hub inside Mingla Host** (blasts, brand CRM, managed ads for organisers) is a
product feature, not Mingla's own marketing. Its first phase shipped; the remaining phases are
gated behind commerce, consent, and delivery infrastructure per the gap analysis. Do not conflate
its status with the company marketing stack described in this document.

---

## 3. Motion — How Marketing Actually Runs

### Organic content engine (primary motion)

- Founder-led, platform-native content across Instagram, TikTok, Snapchat, Threads, X, Facebook,
  and LinkedIn.
- Posture: build the founder as the trusted voice on going out and local discovery. The app enters
  via the lightest-touch connection — often the CTA is just "follow me."
- Bio links on every platform use the branded smart links with `pid=bio_<platform>` so organic
  traffic is attributable.

### Paid ads pipeline

- Production pipeline: **Envato stock → Remotion** by default. The cinematic director supplies
  exact search requirements, Seth manually downloads/licenses the chosen clips, and every ad is
  assembled and rendered in Remotion. **Magnific is opt-in only**: use it solely when Seth
  explicitly requests generated media for the current project or shot, then finish in Remotion.
  Higgsfield, Seedance, and Soul are retired from production.
- Creative disclosure follows the delivered pixels: stock/real UI + Remotion defaults to
  `ai_generated=false`; a creative containing materially Magnific-generated visuals uses `true`.
- Finished ads live in `~/Desktop/Mingla Ads/` — one folder per ad.
- Channel infrastructure (Meta, TikTok, Reddit, Snap, Google) is provisioned with tokens, and the
  measurement layer (pixels + CAPI) is live — but as of this writing **no channel can
  programmatically create an ad end-to-end yet**; campaign creation still has open gaps. Never
  derive campaign fields from channel API catalogs; verify against the live network.

### Influencer program

- **Influencer CRM in ClickUp** is the system of record for creator outreach and ambassadors:
  research, geo, status lifecycle, contract folders on the shared Drive, and outreach drafting.
- Collaborations follow the same content posture: creators make content that stands on its own —
  never scripted ads.
- London-based creators are in-market (ambassador fit) even though the CRM Geo dropdown lags the
  real footprint — never tell a London creator Mingla isn't there.

### Supply-side prospecting

- **Supply CRM in ClickUp** feeds venue acquisition. Current state: **fine-dining only**, seeded
  from the production database's deck scores across Lagos, New York, Raleigh, Cary, and Durham,
  so prospecting mirrors what consumers actually see in the app.
- Cards land as prospects for a human to work via cold call, cold email, or physical visit.
- Early-creator motion is **concierge onboarding**: don't ask supply to "try the platform" — ask
  for their next event/menu/offer and build the page for them, then hand them a promo pack. No
  listing publishes silently.

### Outbound calling

- Outbound sales calling is **live** via Twilio SIP (softphone: Zoiper). Used for venue and
  organiser outreach in call-first markets.
- Lagos outreach runs warmer channels first — WhatsApp Business and Instagram DMs beat cold calls
  there. Venue outreach elsewhere: call → email recap → IG DM → follow-up → walk-in.

---

## 4. Committed City Scope & Targeting

Mingla's committed city-by-city search and launch scope is **Lagos, Durham, Cary, Raleigh, New
York City, Brussels, Paris, London, Fort Lauderdale, and Washington DC**. These are individual
city markets; do not collapse Durham, Cary, and Raleigh into a regional label. Do not infer live
availability from a CRM dropdown or from inclusion in this forward launch scope.

| City | Initial emphasis |
|---|---|
| Lagos | Creators, promoters, nightlife and experience brands; Explorer acquisition through creator-led content and WhatsApp/Instagram-led Host outreach |
| Durham | Date-night and friend-group Explorers; restaurants, activity spaces, venues and independent organisers |
| Cary | Date-night and friend-group Explorers; restaurants, resorts, venues and family/group experiences |
| Raleigh | Social plan captains and new-city Explorers; restaurants, bars, venues, promoters and independent organisers |
| New York City | High-intent social plan captains; restaurants, nightlife, venues, promoters and experience brands |
| Brussels | Local and visiting Explorers; restaurants, cultural venues, events and independent experiences |
| Paris | Date-plan and city-experience Explorers; restaurants, cultural venues, events and experience brands |
| London | Explorer acquisition plus the active creator/ambassador pipeline; restaurants, events, nightlife and experiences |
| Fort Lauderdale | Local and visiting Explorers; restaurants, resorts, nightlife, trips and waterfront experiences |
| Washington DC | Date-night, friend-group and visitor Explorers; restaurants, cultural venues, events and promoters |

Across every market the consumer ICP is the **Social Plan Captain** — the 22–35 urban/suburban
person who picks the spot for a date, partner, or small friend group: (1) date-night planners,
(2) friend-group plan captains, (3) new-city social rebuilders. Position around vibe-fit social
planning, never generic local search.

---

*Update rule: edit this file only with verified current truth (shipped, live, or explicitly
flagged as dark/gated). New marketing work starts as an issue on the Avengers board; history
belongs to the archive tag, not this document.*
