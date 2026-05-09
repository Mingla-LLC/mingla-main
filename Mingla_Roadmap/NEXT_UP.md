# Next Up

> Status: first PMM sequencing pass completed 2026-05-08.
> Owner: `$pmm-mingla` for product/market rationale; `$orchestrator` for lifecycle dispatch order.
> Authority: sequenced upcoming product/market work.

## Recommended Sequence

| Rank | Feature ID | Work | Why now | Customer value | Business value | Dependency | Evidence | Confidence | Next lifecycle step |
|---:|---|---|---|---|---|---|---|---|---|
| 1 | `FEAT-0004` | ORCH-0763 event system regression repair rework | Tester proved the first implementation only partially fixed the problem, and forensics found the rework scope was still missing a P1 child-route blast radius: Step 7/share URLs improved, but autosave race protection, lifecycle action honesty, Event Detail management routes, and behavioral regression coverage are still unsafe. | Organisers can trust typing will not be overwritten, published event management will not lie or dead-end into not-found screens, and public links will only be declared fixed after server/runtime proof. | Protects the core event supply and buyer link funnel before media/GTM expansion. | Implementor rework, tester retest, operator DB push, deploy, runtime publish/share smoke | ORCH-0763 tester FAIL report, forensic addendum, orchestrator addendum review, updated rework prompt | High | `$implementor` rework |
| 2 | `FEAT-0008` | ORCH-0764A Stripe API v2 version-header runtime retest | Version-header rework is implemented, reviewed, and deployed as `brand-stripe-onboard` version `7`; runtime must now prove `Stripe Wise` receives a hosted Account Link instead of another Stripe API error. | Brands can actually start payout onboarding instead of getting a Stripe API error before account creation. | Unblocks the B2 Connect foundation required before checkout, GMV, and payouts. | Simulator retest; Accounts v2 Account Link proof; possible next Stripe access/scope blocker classification | ORCH-0764A version-header deploy report, implementation review, approved spec, prior retest FAIL report | High | `$tester` retest |
| 3 | `FEAT-0006` | ORCH-0758A media runtime proof | Media should pause behind ORCH-0763 and Stripe runtime repair, but remains the next expression proof once event/payment foundations are stable. | Organisers get beautiful event pages without corrupting published state. | Improves public conversion and creator expression. | ORCH-0763 repair, authenticated disposable business fixture, media assets, runtime media QA | ORCH-0758A runtime BLOCKED/UNVERIFIED | High | Hold until higher trust/payment blockers are underway |
| 4 | `FEAT-0005` | Public domain/share URL runtime smoke | Retest and deployment cleared active URL blockers, but real public links still depend on a durable published event source. | Buyers can open shared event/brand/checkout links reliably. | Protects revenue funnel and organiser trust. | ORCH-0763 event authority repair and safe fixture URLs | ORCH-0759 deploy cleared; ORCH-0763 found publish authority gap | High | Runtime smoke after event-system repair path |
| 5 | `FEAT-0003` | Runtime smoke for server-backed drafts | Code/retest is directionally good, but ORCH-0763 supersedes close because published-event authority remains broken. | Organisers can trust drafts survive sign-out/app deletion. | Reduces abandonment and support escalations. | ORCH-0763 spec and runtime fixture | ORCH-0756B retest conditional PASS; ORCH-0763 review | High | Fold evidence into ORCH-0763 spec |
| 6 | `FEAT-0001` | Active brand recovery runtime decision | Returning organiser trust depends on seeing the right brand state, but event disappearance is now the higher launch blocker. | Organisers do not feel their account/brand disappeared. | Prevents first-session churn and support confusion. | Runtime evidence or accepted conditional deferral | ORCH-0756A conditional PASS | High | Runtime smoke / close decision after ORCH-0763 priority |
| 7 | `FEAT-0002` | Business Home chrome cleanup | ORCH-0754 made Home truthful; ORCH-0755 makes it feel operational. | Cleaner first-screen dashboard. | Better perceived product quality in founder/private beta. | Implementor/tester lifecycle | ORCH-0755 prompt ready | Medium | `$implementor` after P0 event integrity |
| 8 | `FEAT-0007` | Live checkout/payment finalization | UI stubs need real order/payment/ticket issuance. | Buyers can purchase tickets. | Direct GMV. | B2 Connect; public URL authority; durable event publish | cycle-b3; Strategic Plan MVP criteria; ORCH-0763; ORCH-0764A | Medium | Forensics/spec after B2 and ORCH-0763 |
| 9 | `FEAT-0009` | Live scanner + door payments | Event-night operations complete the MVP loop. | Door staff can scan/sell reliably. | Captures door revenue and private beta readiness. | B2/B3; Stripe Terminal/native approvals; durable event IDs | cycle-b4; PRD §6-7 | Medium | Forensics/spec after B3 |
| 10 | `FEAT-0011` | Account deletion and settings | Compliance and App Store trust cannot remain deferred forever. | Users control account and deletion. | Reduces legal/release risk. | B1/B2 data/Stripe disconnect contract | Strategic Plan R4; cycle-14 | Medium | Investigation/spec after foundation closes |

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
