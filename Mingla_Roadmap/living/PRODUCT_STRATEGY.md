# Product Strategy

> Status: first PMM synthesis completed 2026-05-08.
> Owner: `$pmm-mingla`.
> Sources: `BUSINESS_PRD.md`, `BUSINESS_STRATEGIC_PLAN.md`, `MINGLA_PRODUCT_COMPETITIVE_ANALYSIS.md`, lifecycle ledgers, GitHub epics.
> Confidence: Medium. Strategy is strong; several source docs include stale `mingla-web` assumptions and must be read through DEC-081/086.

## Strategic Thesis

Mingla wins by connecting a consumer demand graph to a business operating surface.

Consumer Mingla helps people choose the right place, event, route, or plan for the vibe they want. Mingla Business gives organisers and hospitality brands the tools to create, sell, operate, and eventually market those experiences back into the demand graph.

The near-term product strategy is not "build every event platform feature." It is:

1. Make the organiser foundation trustworthy.
2. Make public event distribution work.
3. Wire real money and event-night operations.
4. Use those successful transactions to power marketing, retention, and AI automation.

## Market / Customer Context

Organisers and hospitality operators currently stitch together ticketing, promotion, RSVP, checkout, door sales, guest lists, marketing, spreadsheets, and feedback tools. Mingla's wedge is not just workflow consolidation; it is distribution into a consumer app that already understands taste, context, location, social planning, and intent.

## Target Segments

| Segment | Current priority | Why |
|---|---|---|
| Independent event organisers | Primary MVP | They need event creation, tickets, checkout, scanner, guest management, and public links immediately. |
| Multi-brand event operators | Near-term expansion | Multi-brand/account/team patterns are already part of the business foundation. |
| Restaurants, bars, nightlife, activity venues | Strategic expansion | Product/competitive analysis shows larger upside beyond ticketed events: reservations, parties, menus, campaigns, repeat visits. |
| Consumer couples/friend groups/new-city users | Demand-side foundation | Consumer app creates the demand graph and viral/social planning motion. |

## Pain Intensity

| Pain | Intensity | Evidence | Product implication |
|---|---|---|---|
| Losing event work or seeing false brand state | High | ORCH-0756A/B active lifecycle | Trust repairs outrank growth features. |
| Sharing public links that do not resolve | Very high | ORCH-0759 investigation | Public URL authority is an S1 launch blocker. |
| Creating attractive event/brand pages | Medium/high | Founder feedback + ORCH-0758A | Rich media improves creator confidence and buyer conversion. |
| Handling real payment, checkout, scanner, and payouts | Very high | Strategic Plan MVP definition; B2-B4 epics | GMV cannot start until live money chain works. |
| Marketing to buyers/followers | Medium now, high later | Marketing Hub Strategy | Must wait until purchases and consent/contact foundation exist. |

## Product Bets

| Bet | Feature IDs | Customer outcome | Business outcome | Evidence | Confidence |
|---|---|---|---|---|---|
| Trust-first organiser core | `FEAT-0001`, `FEAT-0002`, `FEAT-0003`, `FEAT-0004` | Organisers can start, resume, and publish event work with confidence. | Activation and creator retention | ORCH-0754/0756, Business PRD, cycle epics | High |
| Working public distribution | `FEAT-0005`, `FEAT-0006` | Buyers can open good-looking, shareable public pages. | Conversion, social sharing, launch readiness | ORCH-0758A/0759 | High |
| Real commerce chain | `FEAT-0007`, `FEAT-0008`, `FEAT-0009`, `FEAT-0010` | Tickets, payments, scanning, door sales, reconciliation work end-to-end. | GMV and private beta readiness | Strategic Plan, B2-B4 epics | Medium |
| Growth OS for businesses | `FEAT-0013`, `FEAT-0014` | Businesses can acquire and re-engage buyers without tool sprawl. | Expansion revenue and retention | Marketing Hub Strategy, competitive analysis | Medium |
| Agent as automation layer | `FEAT-0015` | Users can ask Mingla to search/create/support/run workflows conversationally. | Differentiation and premium monetization | Brain Strategy | Medium/low until prerequisites close |
| Consumer demand graph | `FEAT-0016`, `FEAT-0017` | Consumers find plans faster and collaborate socially. | Retention, subscription, business-side demand | Positioning/GTM, product competitive analysis | Medium |

## Why Mingla Can Win

- Mingla can pair **intent-rich consumer demand** with **organiser-side commerce tools**.
- The consumer app is already positioned around vibe, mood, collaboration, and taste rather than generic category search.
- The business app can own the full event lifecycle: brand, event, ticket, checkout, scan, payout, follow-up.
- The future Marketing Hub and Brain become credible only because they sit on real transaction, consent, and event data.

## What We Will Not Do

- Do not build the AI agent before the structured event/commerce system works.
- Do not treat marketing automation as MVP.
- Do not claim launch readiness while public links, drafts, or payment flows are unresolved.
- Do not treat old `mingla-web` roadmap references as current stack truth.
- Do not make roadmap promises without artifact evidence.

## Risks

| Risk | Product impact | Mitigation |
|---|---|---|
| Stale docs pollute current roadmap | Wrong build order and false certainty | Source summaries label staleness and decision overrides. |
| Foundation work feels less exciting than AI/marketing | Temptation to skip trust blockers | Keep "trust before growth" as roadmap narrative. |
| Public link/domain fix expands into hosting/public-data architecture | Bigger than string patch | Keep ORCH-0759 spec lifecycle intact. |
| B2-B4 money chain under-scoped | Financial discrepancies or payout distrust | Stripe/webhook/reconciliation specs must be rigorous. |
| Marketing Hub compliance underestimated | Legal/spam risk | Consent/contact foundation Phase 0 before blasts/ads. |

## Metrics

| Metric | Why it matters |
|---|---|
| Time to first draft | Activation and creator momentum |
| Draft recovery success | Trust in event creation |
| Time to publish | Event supply creation |
| Public link cold-load success | Buyer conversion readiness |
| Paid order success rate | GMV unlock |
| Scan success/duplicate/error rate | Event-night reliability |
| Reconciliation discrepancy count | Finance trust |
| Organisers with >=1 live event | Primary business activation |
| GMV per month | Business north star |
