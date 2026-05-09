# Feature Portfolio

> Status: first PMM synthesis completed 2026-05-08.
> Owner: `$pmm-mingla`.
> Source of rows: `Mingla_Roadmap/FEATURE_REGISTRY.md`.

## Portfolio View

| Theme | Feature IDs | Customer outcome | Business outcome | Roadmap bucket | Confidence | Notes |
|---|---|---|---|---|---|---|
| Organiser trust foundation | `FEAT-0001`, `FEAT-0002`, `FEAT-0003`, `FEAT-0004` | Organisers can create/resume/publish without losing work or seeing false state. | Activation and retention | Now / Shipped | High | Current priority cluster. |
| Public distribution and event presentation | `FEAT-0005`, `FEAT-0006` | Public links work and event pages look share-worthy. | Conversion and launch readiness | Now | High | Contains active blockers. |
| Commerce and event-night MVP | `FEAT-0007`, `FEAT-0008`, `FEAT-0009`, `FEAT-0010` | Tickets, payments, scans, door sales, and reconciliation work. | GMV and private beta | Next | Medium | Requires B2-B4 sequencing. |
| Compliance and resilience | `FEAT-0011`, `FEAT-0012` | Users can manage/delete account; app handles degraded states honestly. | Release risk reduction | Next / Later | Medium | Must not be deferred past launch readiness. |
| Growth and automation | `FEAT-0013`, `FEAT-0014`, `FEAT-0015` | Brands can acquire/reach customers; AI automates proven workflows. | Expansion revenue and differentiation | Later | Medium | Post-MVP except research-only work. |
| Consumer demand graph and monetization | `FEAT-0016`, `FEAT-0017` | Consumers discover plans and pay for expanded value. | Retention, referral, subscription | Shipped / ongoing | Medium | Needs current launch-readiness revalidation. |

## Portfolio Balance

| Category | Current emphasis | Risk | Adjustment needed |
|---|---|---|---|
| Activation | High | Draft/public-link blockers can kill activation despite good UI. | Finish trust repairs before more growth work. |
| Retention | Medium | Consumer freshness and organiser repeat-event behavior are not fully quantified. | Add metrics once live flows stabilize. |
| Revenue | Medium | Checkout/Connect/door payments are planned but not fully live in current roadmap view. | Sequence B2 → B3 → B4 after current S1 blockers. |
| Trust / safety | High | Public URLs, draft recovery, account deletion, RLS, and finance reconciliation are launch-sensitive. | Keep trust work ranked above AI/marketing. |
| Operational efficiency | Medium | Scanner/reconciliation/finance workflows not yet live end-to-end. | Treat event-night operations as MVP cutline. |
| Differentiation | Medium | Consumer vibe graph + future Brain/Marketing Hub are compelling, but can distract from core readiness. | Message them as thesis, not immediate promise. |

## Portfolio Recommendation

Do not broaden the build surface yet. The highest-quality portfolio move is to finish the **organiser trust and public distribution chain**:

1. public URL authority;
2. server-backed draft runtime proof;
3. active-brand runtime proof;
4. cover media runtime proof;
5. Home chrome polish;
6. Stripe Connect and checkout specs.

That sequence creates a product story PMM can safely sell: "Mingla Business lets an organiser create, share, and sell an event from a trustworthy mobile-first system."
