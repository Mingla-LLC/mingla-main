# Next Up

> Status: first PMM sequencing pass completed 2026-05-08.
> Owner: `$pmm-mingla` for product/market rationale; `$orchestrator` for lifecycle dispatch order.
> Authority: sequenced upcoming product/market work.

## Recommended Sequence

| Rank | Feature ID | Work | Why now | Customer value | Business value | Dependency | Evidence | Confidence | Next lifecycle step |
|---:|---|---|---|---|---|---|---|---|---|
| 1 | `FEAT-0006` | ORCH-0758A media runtime proof | Retest cleared the known code blockers; the remaining unlock is migrated storage plus native upload/playback QA. | Organisers get beautiful event pages without corrupting published state. | Improves public conversion and creator expression. | Operator DB push decision, native/dev-client build, runtime media QA | ORCH-0758A retest conditional PASS | High | `$tester` runtime QA after DB/native readiness |
| 2 | `FEAT-0005` | Public domain/share URL authority QA | Implementation has returned; buyer-facing public links remain an S1 launch blocker until QA and deploy/runtime proof pass. | Buyers can open shared event/brand/checkout links reliably. | Protects revenue funnel and organiser trust. | Tester QA, DB push, Vercel deploy, production cold-link smoke | ORCH-0759 investigation + implementation report | High | `$tester` |
| 3 | `FEAT-0003` | Runtime smoke for server-backed drafts | Code/retest is directionally good; close needs actual durability proof. | Organisers can trust drafts survive sign-out/app deletion. | Reduces abandonment and support escalations. | Credentialed runtime account/fixture | ORCH-0756B retest conditional PASS | High | Runtime smoke / close decision |
| 4 | `FEAT-0001` | Active brand recovery runtime decision | Returning organiser trust depends on seeing the right brand state. | Organisers do not feel their account/brand disappeared. | Prevents first-session churn and support confusion. | Runtime evidence or accepted conditional deferral | ORCH-0756A conditional PASS | High | Runtime smoke / close decision |
| 5 | `FEAT-0002` | Business Home chrome cleanup | ORCH-0754 made Home truthful; ORCH-0755 makes it feel operational. | Cleaner first-screen dashboard. | Better perceived product quality in founder/private beta. | Implementor/tester lifecycle | ORCH-0755 prompt ready | Medium | `$implementor` |
| 6 | `FEAT-0008` | Stripe Connect live plan/spec | Money routing must precede live checkout and private beta. | Brands can onboard for payouts. | Unlocks paid tickets and GMV. | B1 schema/RLS decisions; Stripe operator setup | DEC-112/113/121/122/123; cycle-b2 | Medium | Forensics/spec after current S1s |
| 7 | `FEAT-0007` | Live checkout/payment finalization | UI stubs need real order/payment/ticket issuance. | Buyers can purchase tickets. | Direct GMV. | B2 Connect; public URL authority | cycle-b3; Strategic Plan MVP criteria | Medium | Forensics/spec after B2 |
| 8 | `FEAT-0009` | Live scanner + door payments | Event-night operations complete the MVP loop. | Door staff can scan/sell reliably. | Captures door revenue and private beta readiness. | B2/B3; Stripe Terminal/native approvals | cycle-b4; PRD §6-7 | Medium | Forensics/spec after B3 |
| 9 | `FEAT-0011` | Account deletion and settings | Compliance and App Store trust cannot remain deferred forever. | Users control account and deletion. | Reduces legal/release risk. | B1/B2 data/Stripe disconnect contract | Strategic Plan R4; cycle-14 | Medium | Investigation/spec after foundation closes |
| 10 | `FEAT-0014` | Marketing Hub research-only Phase E | Ads best-practices research can happen before B5 code and reduces future uncertainty. | Future brands get better growth tools. | Prepares paid marketing revenue path. | None for research-only | Marketing Hub Strategy §0 | Medium | Research dispatch, not implementation |

## Sequencing Logic

1. Close public-link, draft, brand, Home, and media trust gaps before broad GTM.
2. Then wire money: Connect before checkout, checkout before scanner/door reconciliation.
3. Then complete compliance and cross-cutting reliability.
4. Then move into marketing automation and AI.

## Explicit Deferrals

| Feature ID | Deferral reason | Revisit trigger |
|---|---|---|
| `FEAT-0014` | Most B5 phases require B2/B3/B4 and 4 weeks of B4 stability. | B4 stable with zero open S0/S1. |
| `FEAT-0015` | Agent must sit on proven mechanical capabilities; ads phase gated by B5 Phase F/G. | B5 foundations and mechanical ads pipeline Grade A. |
| `FEAT-0013` | Organiser marketing story needs working public links, product proof, and screenshots. | Public URL authority fixed and event/media core polished. |
