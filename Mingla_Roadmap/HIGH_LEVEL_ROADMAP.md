# High-Level Roadmap

> Status: first PMM population pass completed 2026-05-08.
> Owner: `$pmm-mingla` for product/market framing; `$orchestrator` for lifecycle sync.
> Authority: outcome-driven roadmap view. This is not an implementation promise.

## Roadmap Narrative

Mingla's near-term roadmap is a trust-first sequence: finish the organiser foundation so real businesses can create, share, sell, scan, and reconcile events without losing work or sending buyers to broken public links. Only after that foundation is credible should Mingla scale into marketing automation and AI-agent workflows.

The product thesis is two-sided:

- Consumer Mingla creates a demand graph around vibes, places, events, friends, and plans.
- Mingla Business turns that demand into bookable/sellable experiences for organisers, venues, and hospitality brands.

The immediate roadmap should therefore prioritize the business-side launch chain that unlocks real GMV and credible public distribution, while keeping consumer discovery/subscription clarity alive as the demand-side engine.

## Strategic Themes

| Theme | Customer outcome | Business outcome | Feature IDs |
|---|---|---|---|
| Trustworthy organiser foundation | Organisers can sign in, see their brand, create and resume event work, and trust Home state. | Activation and creator trust | `FEAT-0001`, `FEAT-0002`, `FEAT-0003`, `FEAT-0004` |
| Public distribution and buyer conversion | Shared event/brand/checkout links work cold and look good. | Conversion and launch readiness | `FEAT-0005`, `FEAT-0006`, `FEAT-0007` |
| Real money and event-night operations | Brands receive payouts, sell tickets, scan at the door, and reconcile money. | GMV and marketplace monetization | `FEAT-0007`, `FEAT-0008`, `FEAT-0009`, `FEAT-0010` |
| Compliance and reliability | Account deletion, permissions, offline/error states, and parity gaps are handled. | Risk reduction and App Store/business trust | `FEAT-0011`, `FEAT-0012` |
| Growth infrastructure | Businesses can market to buyers/followers and Mingla can automate outreach later. | Retention, expansion, paid marketing revenue | `FEAT-0013`, `FEAT-0014`, `FEAT-0015` |
| Consumer demand graph | Consumers discover vibe-fit places/events and collaborate with friends/partners. | Retention, referral, demand-side moat | `FEAT-0016`, `FEAT-0017` |

## Now

| Timeframe | Strategic Theme | Customer Outcome | Product Bets / Feature IDs | Artifact Evidence | Success Metric | Confidence | Status |
|---|---|---|---|---|---|---|---|
| Immediate | Fix organiser trust and public distribution blockers | Organisers do not lose drafts, do not see fake Home state, and can share working public links. | `FEAT-0002`, `FEAT-0003`, `FEAT-0005` | `Mingla_Artifacts/PRIORITY_BOARD.md`; `WORLD_MAP.md`; ORCH-0754/0756B/0759 reports | Runtime draft recovery PASS; public links cold-load; Home remains no-fabricated-data | High | `Committed` |
| Immediate | Finish rich event media first slice safely | Organisers can add expressive event covers without corrupting published event state. | `FEAT-0006` | ORCH-0758A retest Conditional Pass and runtime QA prompt | Published cover edit is atomic; storage upload, native video, and reduced-motion behavior pass runtime QA | High | `Committed` |
| Immediate | Preserve documentation/product planning discipline | PMM work has a usable, evidence-linked roadmap system. | `FEAT-0001` support; ORCH-0760 docs system | ORCH-0760 investigation/scaffold reports; this roadmap | Roadmap docs pass placement/readme checks and stay synced to evidence | High | `Committed` |

## Next

| Timeframe | Strategic Theme | Customer Outcome | Product Bets / Feature IDs | Artifact Evidence | Success Metric | Confidence | Status |
|---|---|---|---|---|---|---|---|
| After current S1 blockers | Live commerce foundation | Buyers can purchase tickets; organisers can receive funds. | `FEAT-0007`, `FEAT-0008` | `cycle-b2.md`, `cycle-b3.md`, DEC-112/113/121/122/123 | Paid order finalizes; Stripe Connect active; webhook replay-safe | Medium | `Planned` |
| After live checkout | Event-night operations | Door staff can scan tickets and sell at the door. | `FEAT-0009`, `FEAT-0010` | `cycle-b4.md`, `cycle-11.md`, `cycle-12.md`, `cycle-13.md` | QR validation works; door payments reconcile; end-of-night report exports | Medium | `Planned` |
| After organiser foundation stabilizes | Account/compliance closure | Organisers can manage settings and delete account completely. | `FEAT-0011`, `FEAT-0012` | `cycle-14.md`, `cycle-16.md`, Strategic Plan R4/R5/R12 | Account deletion completion 100%; no orphan rows; clear edge/error states | Medium | `Planned` |

## Later

| Timeframe | Strategic Theme | Customer Outcome | Product Bets / Feature IDs | Artifact Evidence | Success Metric | Confidence | Status |
|---|---|---|---|---|---|---|---|
| Post-MVP / after B4 stable | Business growth tooling | Brands can reach buyers/followers and acquire new attendees from one system. | `FEAT-0014` | Marketing Hub Strategy; `cycle-b5.md` | Consent rate; campaign sends; attributed sales; zero compliance incidents | Medium | `Exploring` |
| Post-MVP / after B5 foundations | AI productivity layer | Consumers and organisers can ask Mingla to search, create, support, and eventually run campaigns. | `FEAT-0015` | Brain Strategy; `cycle-b6.md` | Agent task completion; safe writes; spend caps; cost per active agent user | Medium | `Exploring` |
| After product proof supports broad GTM | Organiser acquisition story | Cold organisers understand why Mingla is not just another event dashboard. | `FEAT-0013` | Business Strategic Plan; Product Competitive Analysis; Positioning/GTM | Landing conversion; qualified organiser signups; sales-ready messaging | Medium | `Exploring` |

## Shipped / Recently Launched

| Date | Feature ID | Customer Outcome | Evidence | Launch / PMM State | Follow-up |
|---|---|---|---|---|---|
| 2026-05-08 | `FEAT-0002` | Home no longer tells a fake upcoming-events story. | ORCH-0754 close under DEC-132 | Needs PMM release-note framing after chrome cleanup | ORCH-0755 |
| 2026-05-07 | `FEAT-0017` | Android internal-test billing config blocker cleared. | DEC-131 / ORCH-0752 close | Billing-sheet messaging still needs UX/PMM clarity | ORCH-0752A |
| 2026-05-04 backfill | `FEAT-0004`, `FEAT-0005`, `FEAT-0007`, `FEAT-0009` UI foundations | Organisers have UI foundations for event creation, public pages, checkout stubs, scanner, door sales. | GitHub epic backfill cycle 3-12 | Must avoid claiming live commerce readiness until backend cycles close | B1-B4 |
