# Mingla Business — Strategic Plan

> ⚠️ **MINGLA-WEB DISCONTINUED 2026-04-29 — see DEC-081.** Any strategic
> reference here to a separate `mingla-web/` Next.js codebase, two-codebase
> stack, or Next.js-served marketing surfaces is STALE. Web product =
> `mingla-business` Expo Web only.

> **Status:** Draft v1 — locked planning baseline
> **Owner:** Seth Ogieva
> **Started:** 2026-04-28
> **Companion docs:** [BUSINESS_PRD.md](./BUSINESS_PRD.md) (feature inventory) · [BUSINESS_PROJECT_PLAN.md](./BUSINESS_PROJECT_PLAN.md) (granular execution plan)

---

## 1. Executive Summary

Mingla Business is the partner-side surface of Mingla. Today it is an empty auth shell: Google + Apple OAuth resolves into a `creator_accounts` row and a stub home screen. There is no brand, event, ticket, order, payment, marketing, tracking, or analytics infrastructure — neither in the database nor in the app.

The strategy is: **build foundations first, in tight throughput slices, with mobile + web parity from day one, and only put a chat agent on top once the structured event-creation system exists.** Database is source of truth. The agent never is.

The MVP is a single, complete vertical: an organiser signs in (done), creates a brand, creates an event with the full feature inventory, sells a ticket, scans it at the door, accepts payment, and can delete their account. Marketing, attribution, analytics, AI guest psychology, and the chat agent are explicitly Post-MVP.

---

## 2. Vision

**One sentence:** Mingla Business is the operating system for live experiences — the place where organisers create, manage, market, and monetise events that flow into Mingla's consumer demand graph.

**The change in the world:** Today, organisers run events using stitched-together tools (Posh for promotion, Partiful for RSVPs, OpenTable for reservations, Eventbrite for ticketing, Mailchimp for marketing, Google Sheets for guest lists, Square for door sales). Mingla Business collapses this into one mobile-first, web-accessible surface, and uniquely connects each event to a curated audience of users actively planning experiences. The defensible wedge is **demand-graph integration** — every other tool sells to the same supply side; only Mingla owns the demand side.

**Why this cannot live inside the consumer app:** Organisers and attendees have inverted needs. Attendees want discovery, simplicity, and trust. Organisers want power tools, financial controls, audit trails, team permissions, and revenue visibility. Mixing them produces a worse product for both sides.

---

## 3. Goals

### North Star Metric
**Gross merchandise volume (GMV) processed through Mingla Business per month** — every other metric is a leading indicator of this.

### 90-day goals (MVP cut)
- Ship MVP foundation: account → brand → event → ticket → checkout → scan → payout works end-to-end on mobile and web
- 10 organisers in private beta running real events through the system
- Zero financial discrepancies between Stripe ledger and Mingla ledger across 100 transactions
- Organiser can delete account fully (data + auth + Stripe disconnect) in one flow

### 6-month goals
- 100 organisers active monthly
- Marketing tools (email + SMS) shipping campaigns from the platform
- Attribution / tracking links operational
- First version of the chat agent live as bottom-nav menu (Phase 4 of build order)
- Public event pages indexed and shareable on the open web

### 12-month goals
- 1,000 organisers active monthly
- Multi-brand / multi-team workflows used by ≥20% of organisers
- AI guest psychology + AI-generated marketing assets used in ≥50% of events
- Mingla Business contributes a measurable share of consumer-app session activity (cross-pollination proven)

---

## 4. MVP Definition

### In Scope (must work end-to-end on mobile and web)

| Area | Included | PRD Reference |
|------|----------|---------------|
| **Account** | Sign in / sign out (done), Create account, Delete account, Manage account profile, Manage account settings | §1 |
| **Brand** | Create / name / switch brands, Brand profile (photo, bio, contact, social), Stripe Connect, Brand-level payment view | §2.1, §2.2, §2.3 |
| **Event creation** | All fields in §3.1 (title, description, location, date/time, media, theme, organiser contact, single/recurring/multi-date, draft/publish, edit-after-publish, preview) | §3.1 |
| **Ticket creation** | All fields in §4.1 + all 13 ticket types in §4.2 | §4.1, §4.2 |
| **Event management** | Event overview, orders (view/search/filter/refund/export), guest management (approve/reject/check-in/export) | §5 |
| **Scanners** | Add scanner, invite, permissions, scan QR, validate, dedupe, manual lookup, offline support, activity log | §6.1 |
| **In-person payments** | Card, NFC tap-to-pay, cash, manual, refunds, separate door-revenue tracking | §6.2, §7 |
| **Permissions** | Account owner, brand admin, event manager, finance manager, scanner roles + access restrictions | §11 |
| **Public pages** | Public event page, public brand page, public organiser page — all on mobile + web | Build Principles |

### Explicitly Out of Scope for MVP (Post-MVP)

| Deferred | Reason |
|----------|--------|
| Marketing tools (email/SMS campaigns, CRM, nurturing, compliance) — §8 entirely | Post-MVP. Email/SMS infrastructure, consent management, suppression lists, and templating add 4-6 weeks. Validate organisers actually create events before automating marketing. |
| Tracking links + attribution (§9) | Post-MVP. Useful only once organisers have multi-channel reach. Defer until campaign tools exist. |
| Brand & event analytics dashboards (§10) | Post-MVP — except minimal "tickets sold / scans / revenue" counters which ARE in MVP. Full analytics deferred. |
| AI guest list banner, AI copy/ticket/campaign suggestions (§3.2) | Post-MVP. The chat agent (§U.0–U.14) replaces these. Build the agent properly once foundations are stable. |
| Chat agent in bottom nav | Post-MVP. Per §U.0 it requires Phase 1–3 to be solid first. Targeted for month 4-6. |
| Marketing manager role | Out of MVP. The marketing surface is out of MVP. |
| Audit trail UI for sensitive actions | Audit logs WILL be written from day one (write-only, append-only). The user-facing UI is Post-MVP. |

### MVP "Done" Criteria

The MVP is shippable when:

1. A new organiser can sign up, create a brand, create an event with every PRD §3–§7 feature, sell at least one paid ticket online, sell one in-person ticket, scan both at the door, and view their settled payout — using only the mobile app **OR** only the web app with no functional gap.
2. The organiser can delete their account and confirm: Supabase auth row gone, `creator_accounts` row gone, all owned brands transferred or deleted, Stripe Connect disconnected, no orphan rows in any child table.
3. Permissions are enforced on every endpoint via RLS — bypassing the app produces 403, never 200 with empty data.
4. Every MVP feature has an automated test that runs on both mobile (Detox or Maestro) and web (Playwright).
5. Public event/brand/organiser pages render on mobile + web and are share-link ready (canonical URLs, OG tags).
6. A regression in any MVP slice blocks promotion of the next slice.

---

## 5. Milestones

> **REBALANCED 2026-04-28** per DEC-071 (frontend-first build) and the Frontend Journey Build
> Roadmap (`Mingla_Artifacts/specs/SPEC_BIZ_FRONTEND_JOURNEY_BUILD_ROADMAP.md`). The original
> M0–M21 milestone sequence interleaved backend work throughout; the new structure runs **17
> UI cycles** with stub data first, then **6 backend cycles (B1–B6)** light everything up
> once the UI is shippable-grade. Each cycle is independently founder-refineable; the next
> cycle does not start until the founder signs off on the current one ("is this nailed?").

### 5.1 UI Cycles (frontend-only, stub data, no backend coupling)

| ID | Codebase | Name | Estimated effort | Old milestone equivalent |
|----|----------|------|------------------|--------------------------|
| **0a** | `mingla-business/` | Foundation: tokens, glass primitives, 3-tab nav, AuthScreen, Mingla M monogram, 60-icon library | 40 hrs | (was M0 frontend portion) |
| **0b** | `mingla-web/` (NEW Next.js) | Foundation: Next.js scaffold, shared tokens, auth-callback route, login + landing + share-page placeholders | 32 hrs | (was M0/M7 web portion) |
| **1** | `mingla-business/` | Sign-in → Home → brand creation from topbar chip | 28 hrs | (was M1 partial) |
| **2** | `mingla-business/` | Brands: list, profile, edit, team UI (DESIGN-PACKAGE-SILENT — design in cycle), Stripe-onboard shell, payments shell, finance reports | 72 hrs | (was M2 + M3 UI shell + M12 partial) |
| **3** | `mingla-business/` | Event creator 7-step wizard + draft + publish gate | 48 hrs | (was M4) |
| **4** | `mingla-business/` | Recurring + multi-date + per-date overrides + duplicate event | 40 hrs | (was M5) |
| **5** | `mingla-business/` | Ticket types: free / paid / approval / password / waitlist; reorder; visibility | 32 hrs | (was M6) |
| **6** | `mingla-web/` | Public event page + variants (sold-out, past, pre-sale, password, approval) | 40 hrs | (was M7 partial) |
| **7** | `mingla-web/` | Public brand page + organiser page + share modal | 24 hrs | (was M7 partial) |
| **8** | `mingla-web/` | Checkout flow (UI + payment stubs) | 60 hrs | (was M8 frontend) |
| **9** | `mingla-business/` | Event management: detail dashboard, orders, refunds, cancel-event, share | 56 hrs | (was M9 partial) |
| **10** | `mingla-business/` | Guests: pending approvals, manual add, manual check-in, attendee detail | 28 hrs | (was M9 partial) |
| **11** | `mingla-business/` | Scanner mode: camera, idle/success/duplicate/wrong-event/void/not-found, manual lookup, activity log | 40 hrs | (was M10) |
| **12** | `mingla-business/` | Door payments: cash, card-reader stub, NFC tap stub, manual entry, receipt | 48 hrs | (was M11 frontend) |
| **13** | `mingla-business/` | End-of-night reconciliation report | 24 hrs | (was M11 partial) |
| **14** | `mingla-business/` | Account: edit profile, settings, delete-flow 4-step, sign out | 48 hrs | (was M1 partial + M12 partial) |
| **15** | `mingla-web/` | Marketing landing on `mingla.com` + organiser login on `business.mingla.com/login` + magic-link | 56 hrs | (NEW — Marketing landing was implicit) |
| **16** | both | Cross-cutting: offline, force-update, suspended, error, 404, splash, permission-denied | 36 hrs | (was M13 partial) |
| **17** | both | Refinement pass — apply all founder feedback collected during cycles 1–16 | 40 hrs | (was M13 partial) |

**UI cycle subtotal: ~796 hrs** (revised up from 688 base after design-coverage audit).

### 5.2 Backend cycles (begin only after Cycle 17 founder sign-off)

| ID | Codebase | Name | Estimated effort | Old milestone equivalent |
|----|----------|------|------------------|--------------------------|
| **B1** | `supabase/` | Schema + RLS for accounts, brands, events, tickets, orders, guests, scanners, audit-log | 60 hrs | (was M0 backend) |
| **B2** | `supabase/` + `mingla-business/` | Stripe Connect wired live | 48 hrs | (was M3 backend) |
| **B3** | `supabase/` + `mingla-web/` | Checkout wired live (Stripe Payment Element) | 40 hrs | (was M8 backend) |
| **B4** | `supabase/` + `mingla-business/` | Scanner + door payments wired live (Stripe Terminal, Apple Tap to Pay) | 56 hrs | (was M11 backend) |
| **B5** | `supabase/` + both frontends | Marketing infrastructure (email, SMS, CRM, tracking, attribution, analytics) | 80 hrs | (was M14–M18) |
| **B6** | `supabase/` + `mingla-business/` | Chat agent (M19+ from old plan) | 100 hrs | (was M19–M21) |

**Backend cycle subtotal: ~384 hrs.**

### 5.3 Totals

**Grand total: ~1,180 hrs** of implementor time. UI shippable (private-beta-ready) after Cycle 17. Backend cycles light it up live in B1–B6. Per-cycle metrics will refine after Cycle 0a actuals.

The shippable-private-beta point now lands after **Cycle 17 + B1–B4** (≈ 996 hrs). Marketing (B5) and chat agent (B6) are post-launch enhancements per DEC-070 Q-A3 (Marketing build-when-ready).

---

## 6. Risks & Mitigations

| # | Risk | Likelihood | Impact | Mitigation |
|---|------|-----------|--------|------------|
| R1 | **Mobile + web parity drift** — features ship on mobile but break on web (or vice versa) | High | High | **Refined 2026-04-28:** Cycle 0a + 0b explicitly mirror tokens (manual color-picker check at sign-off). Per-cycle parity test on iOS / Android / web before "nailed." `mingla-business/` uses `react-native-web` for the Business app's web variant; `mingla-web/` (Next.js) handles marketing/login/share with shared design tokens. Where a lib doesn't have a web equivalent (NFC, native camera), document the gap and gate the feature to mobile with a clear UI fallback (manual lookup on web). |
| R2 | **Stripe Connect onboarding friction** — organisers stall at KYC and never finish | Medium | High | **Refined 2026-04-28:** UI shell ships in Cycle 2 (organiser sees status banner + connect CTA in stub form). Live Stripe Connect lands in B2 (after UI cycle 17 founder sign-off). Embedded onboarding (not redirect) when wired live. Allow event creation in draft before Connect is live; only block at publish. Clear progress indicator. Email follow-ups for stalled accounts. |
| R3 | **Financial discrepancy between Stripe and Mingla ledger** — refund races, double-charges, missed webhooks | Medium | Critical | Idempotency keys on every Stripe action. Ledger reconciliation job runs hourly. Stripe webhooks are signed and replayed via durable queue. Manual reconciliation report for finance admin. |
| R4 | **Account deletion incomplete** — GDPR violations from leftover data | Medium | Critical | Account deletion is a single edge function that cascades. Test with synthetic data on every PR. Audit-log every deletion. Hold soft-deleted data for 30 days, then hard-delete via cron. Stripe Connect must be detached before delete completes. |
| R5 | **RLS gap or privilege escalation** — one organiser sees another's data | Medium | Critical | Every table has RLS-on, deny-by-default. Every policy unit-tested against synthetic auth contexts. CI runs an RLS-coverage report. No service-role calls from the client, ever. |
| R6 | **Chat agent built too early** | Medium | High | Hard-coded as Post-MVP per §U.0. No agent code merges before M19. The product exists fully without the agent. |
| R7 | **Scope creep across 11 PRD sections** — every milestone tries to land too much | High | High | Milestones are throughput-locked: each must ship and pass parity tests before the next starts. PR-level scope is single-feature. No "while I'm here" expansions. |
| R8 | **Migration chain conflicts with consumer app** | High | High | Every migration is reviewed against consumer-app reads. Backwards-compatible by default (additive only, no destructive renames). Cross-domain check at every PR per memory rule. |
| R9 | **Dating-app patterns leak into Business** | Medium | Medium | Documented in audit (pairing context, deck engine, board lifecycle are off-limits). Code review red-flags any import from `app-mobile/src/services/board*`, `pairing*`, `recommendations*`. |
| R10 | **Web stack decision** — Expo Web vs separate Next.js for public pages | Medium | Medium | Decision deferred to M0; defaulting to Expo Web for organiser dashboard. Public marketing/event pages may justify Next.js for SEO/performance — flagged as M7 decision. |
| R11 | **NFC tap-to-pay platform support** — iOS Tap to Pay requires Apple approval; Android requires Google Wallet integration | Medium | High | Treat NFC as a feature flag. Ship card-reader and manual-entry first. NFC follows once approval lands. |
| R12 | **Test rig cost** — Detox + Playwright + Supabase test fixtures across 14 milestones | Medium | Medium | **Refined 2026-04-28:** UI cycles 1–17 use stub data and rely on visual + interaction QA at founder sign-off rather than full test rigs. Detox + Playwright + Supabase test fixtures are deferred to backend cycles (B1+) where real data flows. UI-cycle "tests" are: founder walks through, no dead-ends, no Lorem ipsum, no missing states. The deferral keeps UI cycles light; backend cycles absorb the test-rig investment. |
| R13 | **Public event page abuse** — organisers list scams, prohibited content | Medium | High | Pre-publish moderation gate via admin app. Reporting flow on every public page. Trust + Safety policy locked before public-launch. |
| R14 | **Spam through marketing tools** | Medium | High | Marketing is Post-MVP. By the time it ships, double opt-in, suppression lists, sender reputation monitoring, and rate limits are mandatory. |

---

## 7. Build Philosophy (Operating Rules)

These rules are non-negotiable and govern every PR:

1. **Foundations first, agent on top** (§U.0). DB and event-creation logic are source of truth.
2. **Small increments, perfection over large writes.** A PR that does one thing well > a PR that does five things partially.
3. **Mobile + web parity in every milestone.** A feature is not done until it works on both.
4. **Throughput milestones.** Each milestone is independently shippable, independently testable, end-to-end functional.
5. **Diagnose before code.** Per memory rule: investigate, explain in plain English, get user confirmation, then build.
6. **No silent failures.** Errors surface to the user with actionable copy. Edge function errors use the shared duck-typing utility.
7. **Cross-domain check on every DB change.** Consumer app, admin app, and Business app are all checked.
8. **One owner per truth.** Brand finances live on the brand. Event finances roll up to the brand. No duplicate ledgers.
9. **RLS deny-by-default.** No table ships without RLS. No client uses the service role.
10. **Idempotency on every payment + every destructive action.**
11. **Audit log every sensitive action.** Even before the UI exists, the rows get written.
12. **Test before merge.** Every milestone increases test coverage; no regression is acceptable.

---

## 8. Decision Framework

When a question arises mid-build, resolve in this order:

1. **Is the answer in the PRD?** If yes, follow it. If unclear, update the PRD with a Decisions Log entry.
2. **Is the answer in this Strategic Plan?** If yes, follow it.
3. **Is the answer in the Project Plan?** If yes, follow it.
4. **Does it touch a Constitutional principle (§7 above)?** If yes, the principle wins.
5. **Otherwise:** Ask the founder. Do not silently choose.

---

## 9. Open Strategic Questions (To Resolve)

| # | Question | Decision needed by |
|---|----------|-------------------|
| Q1 | ~~Web stack for organiser dashboard~~ **RESOLVED 2026-04-28 (DEC-075):** Expo Web for `mingla-business/` (the Business app at `business.mingla.com`); separate Next.js project at `mingla-web/` for `mingla.com` marketing + login + public share pages. | RESOLVED |
| Q2 | ~~Public event/brand/organiser pages~~ **RESOLVED 2026-04-28 (DEC-075):** Next.js at `mingla-web/`. Same answer as Q1. | RESOLVED |
| Q3 | ~~Stripe Connect type: Standard vs Express vs Custom?~~ **RESOLVED 2026-05-06 (DEC-112): EXPRESS.** Embedded onboarding inside `mingla-business`; Stripe owns KYC + disputes + 1099-K + chargebacks. Aligns with R2 (embedded, not redirect) and B2's 48hr estimate. Migration to Custom remains open future option. | RESOLVED |
| Q4 | ~~Organiser account model~~ **RESOLVED 2026-04-28 (DEC-076):** Native ID-token flow on mobile + Supabase OAuth-redirect on web; same Supabase project = same `auth.users` row across both. Auth cookie domain `.mingla.com` for cross-subdomain session portability. | RESOLVED |
| Q5 | ~~Brand vs Account billing~~ **RESOLVED 2026-05-06 (DEC-113): BRAND-LEVEL.** Each brand has its own Stripe Connect account via `stripe_connect_accounts.brand_id` FK. One Mingla account with N brands has N independent Connect accounts. Already encoded in PRD §2.3, §B.6 schema, and B2 cycle epic — DEC-113 formally closes the paperwork gap. | RESOLVED |
| Q6 | ~~Recurring events~~ **RESOLVED 2026-04-28:** RFC 5545 RRULE-based; recurrence rule + per-date overrides table (preserved in Project Plan §B). UI lands in Cycle 4. | RESOLVED |
| Q7 | ~~Ticket transferability mechanism~~ **RESOLVED 2026-04-28:** Re-issue QR (original voids; new QR sent to transferee). UI affordance lands in Cycle 5. | RESOLVED |
| Q8 | Public-link slug strategy for events/brands — random, vanity, or both? Affects URL stability and SEO. | Cycle 6 (forensics audit recommended hybrid: random default + vanity override) |
| Q9 | ~~Geographic scope for MVP~~ **RESOLVED 2026-04-28:** UK-baseline for sample data + initial launch market. Runtime uses `Intl.NumberFormat` for currency; Stripe Connect Standard supports UK + US + EU + 35+ countries from B2 onwards. | RESOLVED |
| Q10 | ~~Tax/VAT~~ **RESOLVED 2026-04-28:** Per-event organiser-configured tax rate (with brand-level default). Mingla central tax engine deferred to post-MVP when geographic concentration emerges. UI exposes the rate field in Cycle 5 (ticket types) and Cycle 8 (checkout shows tax line). | RESOLVED |

**Resolution status (2026-04-28):** 7 of 10 questions resolved (Q1, Q2, Q4, Q6, Q7, Q9, Q10). 3 deferred to backend cycle B2 (Q3, Q5) or design cycle 6 (Q8). All resolutions logged in `DECISION_LOG.md` (DEC-070 through DEC-076).

**Resolution status (2026-05-06):** Q3 + Q5 resolved at B2-kickoff per operator directive. **9 of 10 questions resolved** (Q1, Q2, Q3, Q4, Q5, Q6, Q7, Q9, Q10). 1 still deferred (Q8 — slug strategy, design cycle 6). DEC-112 + DEC-113 logged in `DECISION_LOG.md`. **B2 unblocked for forensics dispatch.**

---

## 10. Success Metrics (Tracked from Day One)

### Engineering
- PR cycle time (median, p95)
- Test coverage % (mobile + web)
- Mobile/web parity gap count (target: 0)
- RLS coverage % (target: 100%)
- Critical-bug count post-merge (target: 0)
- Migration conflicts with consumer app (target: 0)

### Product
- Organisers signed up
- Organisers with ≥1 published event
- Organisers with ≥1 paid ticket sold
- Organisers retained after 30 days
- Time-to-first-event (signup → publish)
- Time-to-first-sale (publish → first ticket)

### Financial
- GMV per month (north star)
- Take-rate (Mingla fee / GMV)
- Stripe disputes / chargebacks
- Refund rate
- Reconciliation discrepancies (target: 0)

### Trust & Safety
- Public-page report count
- Time-to-takedown for violations
- Account-deletion completion rate (target: 100%)

---

## 11. Communication & Cadence

- **Daily:** Progress against current milestone (commits, PRs, tests passing)
- **Weekly:** Milestone status report — what shipped, what's blocked, what's next
- **Per-milestone:** Definition-of-done checklist signed off; mobile + web parity verified; tests green
- **Per-PR:** Investigator → Spec → Implementor → Tester pipeline per project rules. No skipping.
- **Per-quarter:** Strategic plan review — milestones, risks, scope adjustments

---

## 99. Decisions Log

| Date | Decision | Reasoning |
|------|----------|-----------|
| 2026-04-28 | Strategic plan locked v1 | Founding baseline. MVP scoped to Account → Brand → Event → Ticket → Checkout → Scan → Pay → Account-Delete, mobile + web parity, no marketing/attribution/analytics/chat-agent until Post-MVP. |
| 2026-04-28 | 21 milestones (M0 → M21) sequenced, each independently shippable | Throughput-first build philosophy. Small increments over large writes. |
| 2026-04-28 | Chat agent gated to M19+ | Per §U.0 in PRD: foundations first, agent on top. No exceptions. |
| 2026-04-28 | 14 risks logged with mitigations | Locked in advance to prevent ad-hoc decisions under pressure. |
| 2026-04-28 | 10 open strategic questions queued, each with a resolution-by milestone | No silent decisions. Each question gets resolved and logged in PRD. |
