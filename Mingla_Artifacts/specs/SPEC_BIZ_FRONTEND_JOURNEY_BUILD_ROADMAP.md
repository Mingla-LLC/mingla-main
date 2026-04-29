# Mingla Business — Frontend Journey Build Roadmap

> ⚠️ **MINGLA-WEB DISCONTINUED 2026-04-29 — see DEC-081 in DECISION_LOG.md.**
> All references in this document to `mingla-web/` (Next.js separate codebase),
> `business.mingla.com`, `mingla.com/[slug]` share pages hosted on Next.js,
> two-codebase deploys, or Cycle-6/7/8 web-marketing work are STALE. The web
> product is now `mingla-business` running on Expo Web only. Cycles 6–8's web
> deliverables are either rehomed to `mingla-business` Expo Web or deferred
> until founder reopens the marketing-site question. Cycle 0b's scope is
> reduced to wiring Supabase OAuth-redirect web auth inside `mingla-business`
> (no separate codebase setup). Read accordingly.

> **Mode:** Forensics SPEC (output of `FORENSICS_FRONTEND_JOURNEY_BUILD_ROADMAP.md` dispatch)
> **ORCH-ID:** ORCH-BIZ-FRONTEND-ROADMAP-001
> **Companion:** `Mingla_Artifacts/reports/AUDIT_BIZ_JOURNEY_GAPS.md`
> **Authored:** 2026-04-28
> **Confidence:** H (all locked decisions cited; design-package coverage verified per file)
> **Status:** PARTIALLY-SUPERSEDED by DEC-081. Cycle 0a + 1 implementations honour the roadmap minus mingla-web; Cycles 6+ require re-spec when reached.

---

## 1. Executive Summary

Mingla Business will be built **front-end first** across **two codebases** (`mingla-business/` Expo for the app, `mingla-web/` Next.js for landing + share + login pages) over **17 UI cycles + 6 deferred backend cycles**. Every cycle is a discrete, founder-refineable deliverable. No backend code ships until the UI is shippable-grade.

The roadmap absorbs the Claude Design package and the locked Designer Handoff into journey-shaped slices. Every screen serves at least one journey, and every journey lands in exactly one cycle. Foundations (Cycle 0a + 0b) are non-negotiable prerequisites — they boot both codebases with shared design tokens, glass primitives, 3-tab nav, brand-chip topbar, auth shell — before any journey-cycle starts.

**Sequencing principle:** founder sees something demoable on day one. Cycle 1 (immediately after foundation) is sign-in → Home with a brand-chip-empty state. Cycle 2 lands brand creation from the topbar chip. Cycle 3 is the 7-step event creator. By Cycle 5, an organiser can build their first event end-to-end in stub data. By Cycle 8, attendees can buy a ticket on a public share page (UI + payment stub). By Cycle 11, an event-night door operation works (scan + cash). Cycle 17 is a refinement-only cycle — apply all founder feedback from Cycles 1–16.

After Cycle 17, the UI is shippable-grade. Backend cycles B1–B6 then light it up: Supabase schema, Stripe Connect, checkout, scanner, marketing, chat agent.

**Decisions absorbed (DEC-070 through DEC-076):**
- 3-tab nav (Home / Events / Account) + adaptive 4th when Marketing ships
- No onboarding screens — sign-in routes straight to Home
- Producer-consumer architecture — events injected into consumer Mingla Discover + swipeable deck
- Mobile native ID-token auth + web Supabase OAuth-redirect with cookie domain `.mingla.com`
- Sample data canonical (Sara Marlowe / Lonely Moth / Slow Burn vol. 4)
- Microcopy from design package canonical
- 60+ icon library + Mingla M monogram v1
- Marketing built-and-shipped-when-ready (no placeholder)

**Patches surfaced:** the Strategic Plan rebalances M0–M21 to map onto the new cycle sequence; the Project Plan repo layout adopts the Next.js `mingla-web/` codebase; the Designer Handoff cycles 0a/0b foundation matches §7 here; the PRD nav section is rewritten per DEC-073. Patch list is in §9–§11.

**Open uncertainties:** subdomain choice (`business.` vs `app.`) deferred to v2 brand decision; Cycle 12 (door payments — card/NFC) needs implementor design-time work for the 3 net-new screens the design package is silent on; chat agent UI (M19+) not in this roadmap's scope.

---

## 2. Bedrock Decisions Table

| DEC | Subject | This roadmap absorbs by |
|-----|---------|------------------------|
| DEC-070 | 14 audit answers | KEEP/TUNE/DISCARD per audit applied throughout |
| DEC-071 | Frontend-first; backend deferred | 17 UI cycles before B1–B6 backend cycles |
| DEC-072 | Producer model | No browse surface in journeys; events injected via flags only |
| DEC-073 | 3-tab nav + adaptive 4th | BottomNav primitive accepts `tabs` config prop in Cycle 0a |
| DEC-074 | No onboarding | Sign-in → Home; topbar brand chip = "Create brand" until brand exists |
| DEC-075 | Next.js + Expo Web web stack | Cycle 0b bootstraps `mingla-web/` Next.js |
| DEC-076 | Auth: native ID-token mobile + Supabase OAuth-redirect web | Cycle 0a auth flows mobile; Cycle 0b implements `auth/callback/route.ts` web |
| DEC-066 | Microcopy from design package canonical | Every cycle uses package strings verbatim |
| DEC-067 | Sample data canonical | Stub data uses Sara Marlowe / Lonely Moth |
| DEC-068 | Mingla M monogram v1 locked | Cycle 0a builds it |
| DEC-069 | Icon library v1 locked | Cycle 0a ports 60+ glyphs |

Locked Constitutional rules respected: no dead taps, one owner per truth, no silent failures, no fabricated data, currency-aware UI, never describe Mingla as a dating app. Forbidden imports from app-mobile (board / pairing / recommendations / boardDiscussion) flagged in every cycle.

---

## 3. Journey Inventory

Every journey carries: **persona · entry condition · goal · trigger · happy-path screens · branches · failure paths · data deps**. The full table runs ~95 journeys; below is the structured catalog organized by domain.

### 3.1 Account-level journeys (J-A1 to J-A17)

| ID | Journey | Persona | Trigger | Screens | Cycle |
|----|---------|---------|---------|---------|-------|
| J-A1 | Sign in via Google → Home (no brand) | New organiser | App launch, first time | AuthScreen → /home (brand chip = "Create brand") | 1 |
| J-A2 | Sign in via Apple → Home (no brand) | New organiser | App launch, first time | AuthScreen → /home | 1 |
| J-A3 | Sign in returning organiser (with brands) | Account owner | App launch, returning | AuthScreen → /home (brand chip = "Lonely Moth", last-active) | 1 |
| J-A4 | Create first brand from topbar chip | New organiser | Tap "Create brand" chip | BrandSwitcherSheet (or inline create form) → toast → /home reflows | 1 |
| J-A5 | Switch active brand | Multi-brand owner | Tap brand chip | BrandSwitcherSheet → pick brand → /home reflows | 1 |
| J-A6 | Create additional brand | Multi-brand owner | BrandSwitcherSheet → "+ Create new brand" | Brand creation sheet → toast | 2 |
| J-A7 | View brand profile (founder view) | Account owner / Brand admin | Account → tap brand row | /brand/:id/ | 2 |
| J-A8 | Edit brand profile | Brand admin | /brand/:id/ → "Edit" | /brand/:id/edit (photo, bio, contact, social, custom links) | 2 |
| J-A9 | Brand team (list / invite / accept / role / remove) | Brand admin | /brand/:id/ → Team | /brand/:id/team + invite sheet + accept-invitation deep-link | 2 |
| J-A10 | Stripe Connect onboarding (UI + stub) | Finance manager / Brand admin | /brand/:id/payments → Connect | Embedded WebView placeholder → return banner | 2 |
| J-A11 | View brand payments | Finance manager | /brand/:id/payments | KPIs + payouts list + fees + refunds | 2 |
| J-A12 | View finance reports | Finance manager | /brand/:id/payments → Reports | KPI bars + breakdown + top events + CSV export action (stub) | 2 |
| J-A13 | Edit personal profile | Account owner | Account → Personal details | Profile edit form | 14 |
| J-A14 | Account settings | Account owner | Account → Notifications / Locale / Timezone | Settings rows | 14 |
| J-A15 | Delete account 4-step flow | Account owner | Account → Delete account | Step 1 warning → Step 2 consequences → Step 3 type DELETE → Step 4 scheduled | 14 |
| J-A16 | Cancel scheduled deletion via email link | Account owner | Email link tap | Deep-link → cancel-deletion screen → toast | 14 |
| J-A17 | Sign out | All authenticated roles | Account → Sign out | Confirm → /welcome | 14 |

### 3.2 Event lifecycle journeys (J-E1 to J-E17)

| ID | Journey | Trigger | Screens | Cycle |
|----|---------|---------|---------|-------|
| J-E1 | Build first event from Home empty state | Home "Build a new event" CTA | EventCreator step 1 → 7 → Preview → Save Draft / Publish gate | 3 |
| J-E2 | Publish event with paid tickets (Stripe live) | Publish gate → confirm | Confirm modal → toast "Live. Share this link…" → Share modal | 3 |
| J-E3 | Publish event when Stripe missing | Publish gate → connect-Stripe prompt | Banner "Connect Stripe to publish paid events" with deferred CTA | 3 |
| J-E4 | Edit draft event | Events list → tap draft row | Resume EventCreator at last step | 3 |
| J-E5 | Build recurring event (RRULE picker) | EventCreator step 2 → Recurring | Recurrence rule picker + occurrence preview chips | 4 |
| J-E6 | Build multi-date event | EventCreator step 2 → Multi-date | Date list + per-date overrides editor | 4 |
| J-E7 | Per-date override editor | Multi-date event Detail → date selector → Edit this date | Override form (title / location / description) | 4 |
| J-E8 | Duplicate event | Events list → manage menu → Duplicate | EventCreator pre-filled with copy | 4 |
| J-E9 | End ticket sales for live event | Events list → manage menu → End sales | Confirm sheet → status morphs to "Closed" | 9 |
| J-E10 | Cancel event with refund cascade | Event detail → Cancel event | Confirm modal w/ type-EVENTNAME → loading → email cascade → status: Cancelled | 9 |
| J-E11 | Edit-after-publish (price change) | Event detail → Edit | EventCreator with banner "Editing live event" → change-summary modal on save | 9 |
| J-E12 | Publish-with-validation-errors | Publish gate → missing fields | Modal lists missing → tap "Fix" routes to step → fix → return | 3 |
| J-E13 | View event detail (KPIs / tickets / activity) | Events list → tap row | EventDetailScreen | 9 |
| J-E14 | Browse events list with filter pills | Events tab | EventsListScreen with All / Live / Upcoming / Drafts / Past | 9 |
| J-E15 | Per-event manage menu (10 actions) | Events list → tap ⋯ | Menu sheet with context-aware actions | 9 |
| J-E16 | View public event page from organiser side | Event detail → "View public page" tile | /public/e/:slug rendered in-app webview | 6 |
| J-E17 | Share event (Copy / Native / Per-platform) | Event detail / Events list manage menu → Share | Share modal | 9 |

### 3.3 Tickets journeys (J-T1 to J-T8)

| ID | Journey | Cycle |
|----|---------|-------|
| J-T1 | Create free ticket type | 5 |
| J-T2 | Create paid ticket type | 5 |
| J-T3 | Create approval-required ticket | 5 |
| J-T4 | Create password-protected ticket | 5 |
| J-T5 | Create waitlist-enabled ticket | 5 |
| J-T6 | Edit ticket type (post-publish quantity lock) | 5 |
| J-T7 | Reorder ticket types | 5 |
| J-T8 | Toggle ticket visibility / disable | 5 |

### 3.4 Public pages journeys — `mingla-web/` (J-P1 to J-P9)

| ID | Journey | Cycle |
|----|---------|-------|
| J-P1 | Attendee lands on `mingla.com/e/[slug]` — default | 6 |
| J-P2 | Sold-out variant | 6 |
| J-P3 | Past-event variant | 6 |
| J-P4 | Pre-sale variant | 6 |
| J-P5 | Password-protected variant | 6 |
| J-P6 | Approval-required apply flow | 6 |
| J-P7 | Attendee lands on `mingla.com/b/[slug]` — public brand | 7 |
| J-P8 | Attendee lands on `mingla.com/o/[slug]` — public organiser | 7 |
| J-P9 | Share modal (copy URL + native share + per-platform buttons) | 7 |

### 3.5 Checkout journeys — `mingla-web/` (J-C1 to J-C5)

| ID | Journey | Cycle |
|----|---------|-------|
| J-C1 | Ticket selection on public event page | 8 |
| J-C2 | Buyer details form | 8 |
| J-C3 | Stripe Payment Element + Apple Pay / Google Pay (UI stub) | 8 |
| J-C4 | 3DS challenge variant | 8 |
| J-C5 | Order confirmation + QR ticket display + wallet add intents | 8 |

### 3.6 Event management journeys (J-M1 to J-M11)

| ID | Journey | Cycle |
|----|---------|-------|
| J-M1 | Orders list (filter / search / paginate / export — UI only) | 9 |
| J-M2 | Order detail | 9 |
| J-M3 | Refund order full | 9 |
| J-M4 | Refund order partial | 9 |
| J-M5 | Cancel order | 9 |
| J-M6 | Resend ticket (UI affordance + toast) | 9 |
| J-M7 | Guests list (Pending / Approved / All tabs) | 10 |
| J-M8 | Approve pending guest | 10 |
| J-M9 | Reject pending guest | 10 |
| J-M10 | Manual add guest | 10 |
| J-M11 | Manual check-in + attendee detail | 10 |

### 3.7 Scanner journeys (J-S1 to J-S16)

| ID | Journey | Cycle |
|----|---------|-------|
| J-S1 | Scanner-mode entry from Event Detail "Scan tickets" CTA | 11 |
| J-S2 | Scanner-mode entry from Home "Live tonight" KPI card | 11 |
| J-S3 | Scanner-mode entry from deep-link email | 11 |
| J-S4 | Camera scan view → idle | 11 |
| J-S5 | Camera scan → success animation | 11 |
| J-S6 | Camera scan → duplicate (already used) | 11 |
| J-S7 | Camera scan → wrong-event | 11 |
| J-S8 | Camera scan → not-found / counterfeit | 11 |
| J-S9 | Camera scan → void (refunded) | 11 |
| J-S10 | Manual lookup (search + commit check-in) | 11 |
| J-S11 | Door cash sale (numeric pad → confirm → ticket QR) | 12 |
| J-S12 | Door card sale (Stripe Terminal connect — UI stub) | 12 |
| J-S13 | Door NFC tap-to-pay (UI stub for iOS Tap to Pay) | 12 |
| J-S14 | Manual entry (cheque / voucher) | 12 |
| J-S15 | Door receipt + email/SMS share | 12 |
| J-S16 | Scanner activity log (own scans) | 11 |
| J-S17 | End-of-night reconciliation report | 13 |

### 3.8 Cross-cutting journeys (J-X1 to J-X8)

| ID | Journey | Cycle |
|----|---------|-------|
| J-X1 | Offline state banner | 16 |
| J-X2 | Force-update modal | 16 |
| J-X3 | Suspended-account landing | 16 |
| J-X4 | Global error boundary fallback | 16 |
| J-X5 | 404 not-found | 16 |
| J-X6 | Loading splash (cold start) | 16 |
| J-X7 | Permission-denied (role lacks access) | 16 |
| J-X8 | Network-down banner with retry | 16 |

### 3.9 Public marketing surface — `mingla-web/` (J-W1 to J-W6)

| ID | Journey | Cycle |
|----|---------|-------|
| J-W1 | Visitor lands on `mingla.com` — landing | 15 |
| J-W2 | Visitor scrolls landing → "Run events on Mingla" CTA → routes to Business sign-up | 15 |
| J-W3 | Visitor lands via direct share link → `mingla.com/e/[slug]` (covered J-P1) | 6 |
| J-W4 | Organiser opens `business.mingla.com/login` → Continue with Google | 15 + 0b |
| J-W5 | Organiser opens `business.mingla.com/login` → Continue with Apple | 15 + 0b |
| J-W6 | Magic-link / email auth flow (UI only) | 15 |

### 3.10 Refinement journey (J-R1)

| ID | Journey | Cycle |
|----|---------|-------|
| J-R1 | Founder feedback applied across cycles 1–16 | 17 |

**Total: ~99 enumerated journeys across 8 domains.**

---

## 4. Screen Mapping per Journey

Mapping table (key journeys; full mapping derived in cycle spec blocks below):

| Journey ID | Source design-package file(s) | Designer Handoff §§ | Net-new design needed | Mobile route | Web route | Stub data shape |
|------------|------------------------------|---------------------|----------------------|--------------|-----------|-----------------|
| J-A1, J-A2, J-A3 | `screens-auth.jsx` (AuthScreen) | §5.1.1 | None | `/welcome` (existing); `/(tabs)/home` | `/login` (web parity) | `currentUser` profile, `currentBrand` (null on first run) |
| J-A4 | `screens-brand.jsx` (BrandSwitcherSheet — extend with create form) | §5.3.1, §5.3.2, §5.3.10 | Inline create form within sheet | `/brand/create` | — | `brandName: string`, `slug: string` |
| J-A5 | `screens-brand.jsx` (BrandSwitcherSheet) | §5.3.2 | None | overlay only | overlay only | brand list array |
| J-A6 | `screens-brand.jsx` (BrandsListScreen) | §5.3.9 | None | `/brand/list` | — | brand list array |
| J-A7 | `screens-brand.jsx` (BrandProfileScreen) | §5.3.3 | None | `/brand/:id/` | — | brand object |
| J-A8 | `screens-brand.jsx` (BrandProfileScreen edit) | §5.3.5 | Edit-form variants | `/brand/:id/edit` | — | brand object |
| J-A9 | (DESIGN-PACKAGE-SILENT) | §5.3.9–§5.3.11 | All team / invite / role-detail screens | `/brand/:id/team`, `/brand/:id/team/invite`, `/brand/:id/team/:memberId` | — | members array, invitation tokens |
| J-A10, J-A11 | `screens-brand.jsx` (BrandPaymentsScreen) | §5.3.7, §5.3.8 | Stripe-onboard webview (UI stub) | `/brand/:id/payments`, `/brand/:id/payments/onboard` | — | stripe status object |
| J-A12 | `screens-brand.jsx` (FinanceReportsScreen) | (NEW — DEC-067) | None | `/brand/:id/payments/reports` | — | finance KPIs + breakdown + top events |
| J-A13–J-A17 | `screens-ops.jsx` (AccountScreen, DeleteScreen) | §5.2.1–§5.2.7 | Edit profile + Settings | `/(tabs)/account`, `/account/profile`, `/account/settings`, `/account/delete/:step` | — | user profile |
| J-E1–J-E4 | `screens-creator.jsx` (EventCreatorScreen + steps 1–7) | §5.4.1.1–§5.4.1.7 | None (Q-A10 adopt-with-refine) | `/event/create`, `/event/:id/edit` | — | DraftEvent state machine per design-package U.1 |
| J-E5–J-E7 | (DESIGN-PACKAGE-PARTIAL) | §5.4.4 | Recurrence-rule picker + per-date override editor | `/event/:id/dates/*` | — | event dates array with overrides |
| J-E8 | `screen-events-list.jsx` (manage menu Duplicate) | §5.4.6 | None | — | — | event copy data |
| J-E9–J-E12 | `screens-home.jsx` (EventDetailScreen) + various | §5.8.1, §5.4.7 | Cancel-event flow (DESIGN-PACKAGE-PARTIAL) | `/event/:id/`, `/event/:id/edit`, `/event/:id/publish` | — | event object |
| J-E13–J-E15 | `screens-home.jsx` (EventDetailScreen, EventRow, KpiTile, ActionTile) + `screen-events-list.jsx` | §5.8.1, §5.5.1 | None | `/(tabs)/events`, `/event/:id/` | — | events array, KPIs |
| J-E16 | `screens-extra.jsx` (PublicEventScreen) | §5.6.1 | None | `/event/:id/preview` | `/e/[slug]` | event public payload |
| J-E17 | `screens-extra.jsx` (Toast — share interaction) | §5.6.9 | Share modal sheet (DESIGN-PACKAGE-SILENT) | `/event/:id/share` | `/e/[slug]/share` | event slug + canonical URL |
| J-T1–J-T8 | `screens-creator.jsx` (CreatorStep5 — Tickets) | §5.5.1, §5.5.2 | Ticket-type detail editor (DESIGN-PACKAGE-PARTIAL) | `/event/:id/tickets`, `/event/:id/tickets/create`, `/event/:id/tickets/:tid` | — | ticket types array |
| J-P1–J-P6 | `screens-extra.jsx` (PublicEventScreen + PublicTicket) | §5.6.1–§5.6.6 | Sold-out / past / pre-sale / password / approval variants | — | `/e/[slug]/`, `/e/[slug]/sold-out`, `/e/[slug]/past`, `/e/[slug]/pre-sale`, `/e/[slug]/protected`, `/e/[slug]/apply` | event public payload variants |
| J-P7 | `screen-public-brand.jsx` (PublicBrandScreen) | §5.6.7 | None | — | `/b/[slug]/` | brand public payload |
| J-P8 | (DESIGN-PACKAGE-SILENT — gated by Q-A4 founder decision) | §5.6.8 | Public organiser page | — | `/o/[slug]/` | organiser-account public payload |
| J-P9 | `screens-extra.jsx` (Toast share interaction) | §5.6.9 | Share modal (DESIGN-PACKAGE-SILENT) | — | `/e/[slug]/share`, `/b/[slug]/share` | shareable URL |
| J-C1–J-C5 | (DESIGN-PACKAGE-SILENT — checkout) | §5.7.1–§5.7.5 | All checkout screens | — | `/checkout/[eventId]/`, `/checkout/[eventId]/buyer`, `/checkout/[eventId]/payment`, `/checkout/[eventId]/confirm`, `/checkout/[eventId]/wallet` | order draft, payment intent stub, ticket QR |
| J-M1–J-M6 | `screens-ops.jsx` (OrdersScreen, OrderDetailScreen) + `screens-extra.jsx` (RefundSheet) | §5.8.2–§5.8.5 | None | `/event/:id/orders`, `/event/:id/orders/:oid`, `/event/:id/orders/:oid/refund` | — | orders array |
| J-M7–J-M11 | `screens-extra.jsx` (GuestsScreen) + (DESIGN-PACKAGE-PARTIAL for attendee detail) | §5.8.6–§5.8.9 | Manual add guest, attendee detail | `/event/:id/guests`, `/event/:id/guests/pending`, `/event/:id/guests/add`, `/event/:id/guests/:aid` | — | guests array, pending applications |
| J-S1–J-S10, J-S16 | `screens-ops.jsx` (ScannerScreen, ScanBtn) | §5.9.1–§5.9.3, §5.9.11 | None | `/scanner/`, `/scanner/scan`, `/scanner/lookup`, `/scanner/activity` | — | event scan state, scanner permissions |
| J-S11–J-S15 | `screens-ops.jsx` (CashSaleScreen) + `screens-extra.jsx` (TicketQRScreen) | §5.9.8, §5.9.10 | Card / NFC / Manual entry screens (DESIGN-PACKAGE-PARTIAL) | `/scanner/sale/select`, `/scanner/sale/payment/{card,nfc,cash,manual}`, `/scanner/sale/receipt` | — | door sale draft, cash entry state |
| J-S17 | (DESIGN-PACKAGE-SILENT) | §5.10.1 | End-of-night reconciliation | `/event/:id/reconciliation` | — | reconciliation report |
| J-X1–J-X8 | `screens-ops.jsx` (Toast — partially) | §5.13.1–§5.13.8 | All cross-cutting screens | `/system/{offline,maintenance,update-required,suspended,error,404}` | (parallel routes on web) | system-state objects |
| J-W1–J-W6 | (DESIGN-PACKAGE-SILENT) | (NEW — Cycle 15) | Marketing landing + login | — | `/`, `/business/login`, `/auth/callback` | landing copy, auth state |

---

## 5. Cycle Sequencing — Master Table

| Cycle | Codebase | Name | Journeys | Dep on | Estimated effort |
|-------|----------|------|----------|--------|------------------|
| **0a** | mingla-business | Foundation: tokens + glass primitives + 3-tab nav + AuthScreen | — (foundation) | — | 40 hrs |
| **0b** | mingla-web | Foundation: Next.js scaffold + shared tokens + auth-callback route + login skeleton | — (foundation) | — | 32 hrs |
| **1** | mingla-business | Account anchor: sign-in → Home → brand creation from topbar chip | J-A1, J-A2, J-A3, J-A4, J-A5 | 0a | 28 hrs |
| **2** | mingla-business | Brands: list, profile, edit, team UI, payments shell | J-A6, J-A7, J-A8, J-A9, J-A10, J-A11, J-A12 | 1 | 56 hrs |
| **3** | mingla-business | Event creator: 7-step wizard + draft + publish gate | J-E1, J-E2, J-E3, J-E4, J-E12 | 1 | 48 hrs |
| **4** | mingla-business | Recurring + multi-date + duplicate | J-E5, J-E6, J-E7, J-E8 | 3 | 32 hrs |
| **5** | mingla-business | Tickets: types, create, edit, reorder, visibility | J-T1, J-T2, J-T3, J-T4, J-T5, J-T6, J-T7, J-T8 | 3 | 32 hrs |
| **6** | mingla-web | Public event page + variants | J-P1, J-P2, J-P3, J-P4, J-P5, J-P6, J-E16 | 0b, 3 | 40 hrs |
| **7** | mingla-web | Public brand page + organiser page + share modal | J-P7, J-P8, J-P9 | 6 | 24 hrs |
| **8** | mingla-web | Checkout flow (UI + stubs) | J-C1, J-C2, J-C3, J-C4, J-C5 | 6 | 36 hrs |
| **9** | mingla-business | Event management: detail, orders, refunds, cancel, share | J-E9, J-E10, J-E11, J-E13, J-E14, J-E15, J-E17, J-M1, J-M2, J-M3, J-M4, J-M5, J-M6 | 3 | 56 hrs |
| **10** | mingla-business | Guests + pending approvals + manual add + attendee detail | J-M7, J-M8, J-M9, J-M10, J-M11 | 9 | 28 hrs |
| **11** | mingla-business | Scanner mode: entry + camera + states + manual lookup + activity log | J-S1, J-S2, J-S3, J-S4, J-S5, J-S6, J-S7, J-S8, J-S9, J-S10, J-S16 | 9 | 40 hrs |
| **12** | mingla-business | Door payments: cash + card + NFC + manual + receipt | J-S11, J-S12, J-S13, J-S14, J-S15 | 11 | 36 hrs |
| **13** | mingla-business | End-of-night reconciliation | J-S17 | 12 | 16 hrs |
| **14** | mingla-business | Account: profile, settings, delete-flow, sign out | J-A13, J-A14, J-A15, J-A16, J-A17 | 1 | 32 hrs |
| **15** | mingla-web | Marketing landing + login + magic-link auth | J-W1, J-W2, J-W4, J-W5, J-W6 | 0b | 40 hrs |
| **16** | both | Cross-cutting states: offline, force-update, suspended, error, 404, splash | J-X1, J-X2, J-X3, J-X4, J-X5, J-X6, J-X7, J-X8 | All prior | 24 hrs |
| **17** | both | Refinement pass — apply founder feedback | J-R1 | All prior | 40 hrs |
| **— UI shippable; backend cycles begin —** | | | | | |
| **B1** | supabase | Schema + RLS for accounts, brands, events, tickets, orders, guests, scanners | — (backend foundation) | All UI | 60 hrs |
| **B2** | supabase + business | Stripe Connect wired live | — | B1 | 48 hrs |
| **B3** | supabase + web | Checkout wired live (Stripe Payment Element) | — | B2 | 40 hrs |
| **B4** | supabase + business | Scanner + door payments wired live (Stripe Terminal, Apple Tap to Pay) | — | B2 | 56 hrs |
| **B5** | supabase + business + web | Marketing infrastructure (M14+) | — | B1–B4 | 80 hrs |
| **B6** | supabase + business | Chat agent (M19+) | — | B1–B5 | 100 hrs |

**Total UI cycles 0a–17: ~688 hrs.** Backend cycles B1–B6: ~384 hrs. Grand total ~1,072 hrs of implementor time. This is rough; per-cycle metrics will refine after Cycle 0a ships.

---

## 6. Per-Cycle Spec Blocks (UI Cycles)

### Cycle 0a — `mingla-business/` Foundation

**Codebase:** mingla-business
**Journeys covered:** Foundation (no journeys land here — tabs render placeholder text)
**Source files:** `design-package/project/{tokens.css, chrome.jsx, primitives.jsx, screens-auth.jsx (AuthScreen only)}`
**Target files:**
- `mingla-business/src/constants/designSystem.ts` (extend additively)
- `mingla-business/src/components/ui/{GlassCard, GlassChrome, BottomNav, TopBar, IconChrome, MinglaMark, Icon, Button, Pill, Input, StatusPill, KpiTile, ActionTile, EventCover, Toast, Sheet, Modal, Skeleton, Spinner, Stepper, EmptyState, ErrorBoundary, ConfirmDialog}.tsx`
- `mingla-business/app/(tabs)/_layout.tsx`
- `mingla-business/app/(tabs)/{home, events, account}.tsx` (placeholder text)
- `mingla-business/app/welcome.tsx` (existing — verify routes to /(tabs)/home post-sign-in)
- `mingla-business/app/__styleguide.tsx` (DEV-only)
- DELETE: `mingla-business/app/home.tsx` (redundant stub)

**Stub data:** sample brand `Lonely Moth` + 3 secondary; sample events Slow Burn vol. 4 etc., per DEC-067.

**Mobile + web parity check:**
- iOS / Android: native blur via `expo-blur`
- Web: CSS `backdrop-filter` shim with `@supports` fallback to solid `rgba(20,22,26,0.92)`
- BottomNav config-prop accepts `tabs: Array<{ id, icon, label }>` — Cycle 0a renders 3 tabs (Home, Events, Account)

**Acceptance criteria:**
1. `npx expo start` boots; sign-in routes to /(tabs)/home; placeholder reads "Home (Cycle 1 lands content)"
2. All 3 tabs render with bottom nav glass capsule and orange spotlight on active tab
3. TopBar shows MinglaMark + "Create brand" chip (no brand exists yet)
4. `__styleguide` route renders all 22 primitives without crash on iOS / Android / web
5. `tsc --noEmit` clean
6. No imports from `app-mobile/services/board*`, `pairing*`, `recommendations*`, `boardDiscussion*`
7. Sign out from any tab returns to /welcome

**Founder sign-off prompt:** "Is the foundation nailed? Tap through every primitive in `__styleguide` and the 3-tab nav. Anything off?"

**Refinement loop:** orchestrator captures feedback → writes refinement dispatch → implementor revises → resubmit. Loop until "nailed."

**Dependencies:** none

---

### Cycle 0b — `mingla-web/` Next.js Foundation

**Codebase:** mingla-web (NEW)
**Journeys covered:** Foundation (login + landing render placeholder)
**Source files:** None (greenfield)
**Target files:**
- `mingla-web/` (new directory at repo root)
- `mingla-web/package.json`, `next.config.ts`, `tsconfig.json`, `eslint.config.mjs`
- `mingla-web/app/layout.tsx` (root layout with Inter / SF Pro font)
- `mingla-web/app/page.tsx` (landing placeholder — Cycle 15 fills it)
- `mingla-web/app/business/login/page.tsx` (login placeholder — Cycle 15 fills)
- `mingla-web/app/auth/callback/route.ts` (Supabase code-exchange handler)
- `mingla-web/app/e/[slug]/page.tsx` (placeholder — Cycle 6 fills)
- `mingla-web/app/b/[slug]/page.tsx` (placeholder — Cycle 7 fills)
- `mingla-web/app/o/[slug]/page.tsx` (placeholder — Cycle 7 fills)
- `mingla-web/lib/supabase/client.ts`, `lib/supabase/server.ts`, `middleware.ts` (using `@supabase/ssr`)
- `mingla-web/styles/tokens.css` (copy from design package, kept in sync via package or symlink)
- `mingla-web/styles/globals.css`
- `vercel.json` (rewrites for `business.mingla.com` → mingla-business export, root → mingla-web)

**Dependencies:** `next@latest`, `react@latest`, `@supabase/supabase-js`, `@supabase/ssr`

**Stub data:** mocked event payload for `/e/[slug]/`, brand for `/b/[slug]/`. No real DB calls.

**Auth implementation per DEC-076:**
- `lib/supabase/client.ts` exports `createBrowserClient`
- `lib/supabase/server.ts` exports `createServerClient` with cookie domain `.mingla.com`
- `middleware.ts` refreshes session on every request
- `auth/callback/route.ts` handles `?code=` exchange → redirects to `/`

**Acceptance criteria:**
1. `cd mingla-web && npm run dev` boots Next.js dev server on port 3000
2. `cd mingla-business && npx expo start` runs in parallel (different port — typically 8081 / 19000)
3. `/` renders landing placeholder with MinglaMark
4. `/business/login` renders Continue with Google + Continue with Apple buttons (non-functional in 0b — Cycle 15 wires)
5. `/auth/callback` route exists and would exchange code (testable with mocked code)
6. `/e/lonelymoth/`, `/b/lonelymoth/`, `/o/lonelymoth/` render placeholder cards
7. Vercel deploy succeeds for both codebases
8. Cookie domain set to `.mingla.com` in dev / staging / prod environments
9. Tokens identical visual values across both codebases (manual color picker check)

**Founder sign-off prompt:** "Does both `npm run dev` and `npx expo start` run side-by-side? Are the placeholder pages rendered cleanly with the right typography and colors?"

**Refinement loop:** as above.

**Dependencies:** none

---

### Cycle 1 — Account anchor (sign-in → Home → brand creation from topbar chip)

**Codebase:** mingla-business
**Journeys covered:** J-A1, J-A2, J-A3, J-A4, J-A5
**Source files:** `screens-auth.jsx` (AuthScreen — already absorbed in 0a), `screens-home.jsx` (HomeScreen + KpiTile + ActionTile + EventRow), `screens-brand.jsx` (BrandSwitcherSheet)
**Target files:**
- `mingla-business/app/(tabs)/home.tsx` (HomeScreen with greeting, hero KPI tile, 2-col KPI grid, Upcoming events section, Build CTA)
- `mingla-business/app/brand/switcher.tsx` (BrandSwitcherSheet as overlay route)
- `mingla-business/app/brand/create.tsx` (inline create form within sheet OR full-screen)
- `mingla-business/src/store/currentBrandStore.ts` (Zustand persisted; current brand ID + brand list)
- `mingla-business/src/store/brandList.ts` (stub data array)

**Stub data:**
```ts
type Brand = { id: string; name: string; slug: string; photo?: string; role: 'owner' | 'admin'; stats: { events: number; followers: number; rev: number } };
const brands: Brand[] = [
  { id: 'lm', name: 'Lonely Moth', slug: 'lonelymoth', role: 'owner', stats: { events: 3, followers: 2418, rev: 24180 } },
  { id: 'tll', name: 'The Long Lunch', slug: 'thelonglunch', role: 'owner', stats: { events: 1, followers: 412, rev: 1860 } },
  { id: 'sl', name: 'Sunday Languor', slug: 'sundaylanguor', role: 'owner', stats: { events: 6, followers: 1124, rev: 8420 } },
  { id: 'hr', name: 'Hidden Rooms', slug: 'hiddenrooms', role: 'owner', stats: { events: 2, followers: 824, rev: 3120 } },
];
```

**Mobile + web parity check:** Home renders identically on Expo Web at `lg+` breakpoint with sidebar nav. KPIs grid responsive 1-col → 2-col → 3-col.

**Acceptance criteria:**
1. New user signs in (mocked) → routes to /(tabs)/home → empty state "No brands yet" with topbar chip "Create brand"
2. Tap "Create brand" → BrandSwitcherSheet opens with create form pre-populated; submit → toast "Lonely Moth is ready" → home reflows with stub data
3. Returning user with stub brands → routes to /(tabs)/home with hero KPI "Slow Burn vol. 4 — Live tonight £8,420 / £12,000"
4. Tap topbar chip → BrandSwitcherSheet shows all 4 brands; pick another → current brand persists, home reflows
5. KPI tiles, EventRow stack, Build CTA all per design package screens-home.jsx
6. Dark mode default; light + warm-glow only on /welcome

**Founder sign-off prompt:** "Is the Home screen + brand-chip flow nailed? Tap through every state."

**Dependencies:** Cycle 0a

---

### Cycle 2 — Brands

**Journeys:** J-A6, J-A7, J-A8, J-A9, J-A10, J-A11, J-A12

Source: `screens-brand.jsx` (BrandsListScreen, BrandProfileScreen, BrandPaymentsScreen, FinanceReportsScreen). Net-new: team UI (DESIGN-PACKAGE-SILENT — design from Designer Handoff §5.3.9–§5.3.11).

Target routes: `/brand/list`, `/brand/:id/`, `/brand/:id/edit`, `/brand/:id/team`, `/brand/:id/team/invite`, `/brand/:id/team/:memberId`, `/brand/:id/payments`, `/brand/:id/payments/onboard`, `/brand/:id/payments/reports`, `/brand/:id/settings`.

Stub Stripe state: `'not_connected' | 'onboarding' | 'active' | 'restricted'`.

**Sign-off prompt:** "Are brand profile + payments + reports nailed? Team UI is net-new — does the design feel right?"

---

### Cycle 3 — Event creator (7-step wizard)

**Journeys:** J-E1, J-E2, J-E3, J-E4, J-E12

Source: `screens-creator.jsx` (EventCreatorScreen, CreatorStep1–7). Adopt-with-refine per Q-A10.

Target: `/event/create`, `/event/create/[step]`, `/event/:id/edit`, `/event/:id/preview`, `/event/:id/publish`.

Stub `DraftEvent` state shape per design package U.1 (preserved in Project Plan).

**Refinement focus:** wizard step labels (Basics / When / Where / Cover / Tickets / Settings / Preview) per DEC-065 are starting point — founder will iterate.

---

### Cycle 4 — Recurring + multi-date

**Journeys:** J-E5, J-E6, J-E7, J-E8

Net-new: Recurrence-rule picker (RFC 5545 RRULE), per-date override editor.

Target: `/event/:id/dates/list`, `/event/:id/dates/[dateId]/edit`, `/event/:id/duplicate`.

---

### Cycle 5 — Tickets

**Journeys:** J-T1 through J-T8

Source: `screens-creator.jsx` (CreatorStep5). Net-new: standalone ticket-type editor screen with all 27 PRD §4.1 fields.

Target: `/event/:id/tickets/`, `/event/:id/tickets/create`, `/event/:id/tickets/[tid]`, `/event/:id/tickets/[tid]/preview`.

---

### Cycle 6 — Public event page (`mingla-web/`)

**Journeys:** J-P1 through J-P6, J-E16 (in-app preview)

Source: `screens-extra.jsx` (PublicEventScreen + PublicTicket). Net-new variants: sold-out, past, pre-sale, password, approval.

Target: `mingla-web/app/e/[slug]/`, `/e/[slug]/sold-out`, `/e/[slug]/past`, `/e/[slug]/pre-sale`, `/e/[slug]/protected`, `/e/[slug]/apply`. Plus in-app preview at `mingla-business/app/event/[id]/preview`.

OG card template per Designer Handoff §1.10.4.

---

### Cycle 7 — Public brand + organiser page + share modal

**Journeys:** J-P7, J-P8, J-P9

Source: `screen-public-brand.jsx` (PublicBrandScreen). Net-new: PublicOrganiserScreen (gated by Q-A4 — adopted to MVP).

Target: `mingla-web/app/b/[slug]/`, `mingla-web/app/o/[slug]/`. Plus share modal in `mingla-business/`.

---

### Cycle 8 — Checkout (`mingla-web/`)

**Journeys:** J-C1 through J-C5

Net-new: all checkout screens (DESIGN-PACKAGE-SILENT).

Target: `mingla-web/app/checkout/[eventId]/`, `/buyer`, `/payment`, `/confirm`, `/wallet`.

UI stubs Stripe Payment Element with mock processing 1.2s → confirmation. No real Stripe calls until B3.

---

### Cycle 9 — Event management

**Journeys:** J-E9, J-E10, J-E11, J-E13, J-E14, J-E15, J-E17, J-M1, J-M2, J-M3, J-M4, J-M5, J-M6

Source: `screens-home.jsx` (EventDetailScreen), `screen-events-list.jsx` (EventsListScreen + EventListCard + Manage menu), `screens-ops.jsx` (OrdersScreen, OrderDetailScreen), `screens-extra.jsx` (RefundSheet).

Net-new: Cancel-event flow + change-summary modal + share modal.

Target: `/(tabs)/events`, `/event/:id/`, `/event/:id/orders`, `/event/:id/orders/[oid]`, `/event/:id/orders/[oid]/refund`, `/event/:id/cancel`.

---

### Cycle 10 — Guests

**Journeys:** J-M7 through J-M11

Source: `screens-extra.jsx` (GuestsScreen). Net-new: manual add guest, attendee detail.

Target: `/event/:id/guests/`, `/event/:id/guests/pending`, `/event/:id/guests/add`, `/event/:id/guests/[aid]`.

---

### Cycle 11 — Scanner mode

**Journeys:** J-S1 through J-S10, J-S16

Source: `screens-ops.jsx` (ScannerScreen, ScanBtn).

Target: `/scanner/`, `/scanner/scan`, `/scanner/lookup`, `/scanner/activity`.

Scanner-mode entry from THREE places per DEC-073: Event Detail "Scan tickets" CTA, Home "Live tonight" KPI card, deep-link email.

---

### Cycle 12 — Door payments

**Journeys:** J-S11 through J-S15

Source: `screens-ops.jsx` (CashSaleScreen), `screens-extra.jsx` (TicketQRScreen). Net-new: card-reader / NFC tap-to-pay / manual entry screens (DESIGN-PACKAGE-PARTIAL).

Target: `/scanner/sale/select`, `/scanner/sale/payment/{cash, card, nfc, manual}`, `/scanner/sale/receipt`.

---

### Cycle 13 — End-of-night reconciliation

**Journeys:** J-S17

Net-new: ReconciliationReportScreen.

Target: `/event/:id/reconciliation`.

---

### Cycle 14 — Account refinements

**Journeys:** J-A13, J-A14, J-A15, J-A16, J-A17

Source: `screens-ops.jsx` (AccountScreen, DeleteScreen). Net-new: edit profile, settings rows.

Target: `/(tabs)/account`, `/account/profile`, `/account/settings`, `/account/delete/[step]`, `/account/delete/cancel`.

---

### Cycle 15 — Marketing landing + login (`mingla-web/`)

**Journeys:** J-W1, J-W2, J-W4, J-W5, J-W6

Net-new: marketing landing sections, login form, magic-link UX.

Target: `mingla-web/app/`, `mingla-web/app/business/login`, `mingla-web/app/auth/callback` (already in 0b — refine).

Auth flow per DEC-076: web uses `supabase.auth.signInWithOAuth({ provider, options: { redirectTo } })`.

---

### Cycle 16 — Cross-cutting states

**Journeys:** J-X1 through J-X8

Source: design-package-silent — design new from Designer Handoff §5.13.

Target (mobile): `/system/{offline, maintenance, update-required, suspended, error, 404}`. Parallel routes on web.

---

### Cycle 17 — Refinement pass

**Journeys:** J-R1

Apply all founder feedback captured during cycles 1–16 sign-off rounds. No new screens; only revisions.

**Acceptance:** founder signs off on the entire app as shippable-grade UI.

---

## 7. Foundation Cycle Detailed Specs

(Cycles 0a and 0b detailed in §6 above. Both are non-negotiable prerequisites; no journey-cycle starts before both complete.)

---

## 8. Risk + Invariant Check Results

| Item | Status |
|------|--------|
| No journey couples to backend | ✅ All journeys use stub data |
| No screen absorbed without journey rationale | ✅ Every screen ties to ≥ 1 journey |
| Nav stays 3-tab + adaptive 4th | ✅ DEC-073 enforced; BottomNav config-prop'd |
| No onboarding screens resurrected | ✅ DEC-074 enforced; sign-in → Home directly |
| Producer model — no consumer-style browsing | ✅ Zero "browse events near me" surfaces; only own-events |
| Mingla = experience / date-planning, not dating | ✅ All copy verified |
| Forbidden imports from app-mobile | ✅ No imports from board/pairing/recommendations/boardDiscussion |
| Currency-aware UI | ✅ All money uses `Intl.NumberFormat` at runtime |
| Mobile + web parity | ⚠️ NFC tap-to-pay + camera scanner are mobile-only; documented fallback (manual lookup on web) |
| Stub data realistic | ✅ Sara Marlowe / Lonely Moth canonical per DEC-067 |
| Reduce-motion + reduce-transparency fallbacks | ⚠️ Implementor responsibility per cycle; verified during sign-off |

**No constitutional violations.**

---

## 9. Strategic Plan Patches Required

### Patch SP-1 — Rebalance milestones M0–M21

**File:** `Mingla_Artifacts/BUSINESS_STRATEGIC_PLAN.md` §5 Milestones

**Action:** Replace existing M0–M13 → MVP → M14–M21 sequence with the cycle structure above. The 17 UI cycles + 6 backend cycles map to:

| Old | New |
|-----|-----|
| M0 (Foundations & infra) | Cycle 0a + 0b |
| M1 (Account lifecycle) | Cycle 1 + Cycle 14 |
| M2 (Brands) | Cycle 2 |
| M3 (Stripe Connect) | Cycle 2 (UI shell) + B2 (live) |
| M4 (Event creation core) | Cycle 3 |
| M5 (Recurring + multi-date) | Cycle 4 |
| M6 (Ticket creation) | Cycle 5 |
| M7 (Public pages) | Cycle 6 + Cycle 7 |
| M8 (Online checkout) | Cycle 8 (UI) + B3 (live) |
| M9 (Event management) | Cycle 9 + Cycle 10 |
| M10 (Scanner app) | Cycle 11 |
| M11 (In-person payments) | Cycle 12 + Cycle 13 + B4 (live) |
| M12 (Permissions UI) | Folded into Cycle 2 (team UI subset) |
| M13 (MVP hardening) | Cycle 17 (refinement) |
| M14–M16 (Marketing) | B5 (build-when-ready per DEC-070 Q-A3) |
| M17 (Tracking) | B5 |
| M18 (Analytics) | B5 |
| M19–M21 (Chat agent) | B6 |

### Patch SP-2 — Mark Q1, Q2, Q3, Q4, Q6, Q7 as resolved

Q1 web stack = Next.js + Expo Web (DEC-075). Q2 public stack = same (DEC-075). Q3 Stripe Connect type = Standard (deferred to B2 spec). Q4 organiser auth = native ID-token mobile + OAuth-redirect web, same Supabase project (DEC-076). Q6 recurring events = RRULE-based, lands Cycle 4. Q7 ticket transferability = re-issue QR (lands Cycle 5).

### Patch SP-3 — Adjust risks

R1 (mobile/web parity drift) — mitigation refined: Cycle 0b explicitly mirrors tokens; manual color-picker check at sign-off.
R2 (Stripe onboarding friction) — moves to B2 cycle; UI shell in Cycle 2 keeps draft events un-blocked.
R12 (test rig cost) — defer test rig investment until backend cycles begin.

---

## 10. Project Plan Patches Required

### Patch PP-1 — Repo layout

Add `mingla-web/` as a new top-level directory parallel to `mingla-business/`. Update Part A.4 repository layout to include the Next.js structure.

### Patch PP-2 — Component library

Cycle 0a's UI primitive list (§6 above) supersedes existing Project Plan Part A.4 component list. Update verbatim.

### Patch PP-3 — Per-milestone task lists

Replace existing M0–M21 task list with the per-cycle spec blocks from §6 of THIS roadmap. Project Plan §G becomes a pointer to this roadmap.

### Patch PP-4 — Data model

Existing Project Plan §B data model is preserved verbatim — it's the contract the eventual backend cycles (B1–B6) implement. No changes.

### Patch PP-5 — API surface

Existing Project Plan §C API surface is preserved verbatim — implemented during B1–B6 backend cycles.

---

## 11. Designer Handoff Patches Required

### Patch DH-1 — Section 6 cross-reference

Section 6 user journeys remain the truth. This roadmap maps each to a cycle ID. Add a "Cycle Map" table at the start of Section 6 referencing this roadmap's §3.

### Patch DH-2 — Part 14 prototype interaction map

The 7 must-work sequences A–G in Part 14 map to Cycles 1, 2, 3, 6, 9, 11, 14. Annotate each sequence with its cycle ID.

### Patch DH-3 — Acceptance criteria

Part 15 acceptance criteria fold into per-cycle sign-off prompts. Add cross-reference.

### Patch DH-4 — Add web codebase reference

Insert a new section after Part 2.1 Breakpoints: "Web Stack — Next.js for marketing/login/share at `mingla-web/`; Expo Web for app at `mingla-business/`." Per DEC-075.

---

## 12. Confidence Assessment

| Cycle | Confidence | Reasoning |
|-------|------------|-----------|
| 0a Foundation (mingla-business) | H | Tokens + primitives all present in design package; ports are mechanical |
| 0b Foundation (mingla-web) | M | Greenfield Next.js; auth-callback pattern standard but DNS / cookie domain config needs explicit setup |
| 1 Account anchor | H | Most-used path; design package has full coverage |
| 2 Brands | M | Team UI is design-package-silent; design-time work in cycle |
| 3 Event creator | H | Design package + Designer Handoff cover end-to-end |
| 4 Recurring/multi-date | M | Recurrence picker is partial in package; net-new design needed |
| 5 Tickets | M | Standalone ticket editor is partial; design-time work |
| 6 Public event page | H | PublicEventScreen complete; variants are extensions of base |
| 7 Public brand/organiser | M | Brand page complete; organiser page silent (Q-A4 adopted) |
| 8 Checkout | M | Design-package-silent; net-new; 5 screens to design + build |
| 9 Event management | H | Detail + Orders + Refund + List all in package |
| 10 Guests | M | GuestsScreen present; manual add + attendee detail are silent |
| 11 Scanner | H | Full scanner flow in package |
| 12 Door payments | M | Cash done; card/NFC/manual partial |
| 13 Reconciliation | L | Design-package-silent; net-new |
| 14 Account refinements | H | AccountScreen + DeleteScreen complete |
| 15 Marketing landing | L | Greenfield; founder taste-driven |
| 16 Cross-cutting | M | Patterns from package extend to error states |
| 17 Refinement pass | n/a | Iteration cycle |

**Overall roadmap confidence: H** — every cycle has a clear scope, source files cited, and acceptance criteria. Per-cycle effort estimates are rough; will refine after Cycle 0a metrics.

---

## 13. Open Uncertainties

1. **Subdomain choice** — `business.mingla.com` vs `app.mingla.com`. Recommend `business.` for v1; revisit at brand phase. Affects Cycle 0b Vercel config + DNS.
2. **Cycle 12 card-reader integration** — Stripe Terminal SDK requires a real device; UI-stub fidelity vs. eventual integration may diverge. Plan for refinement loop in B4.
3. **Cycle 15 marketing copy** — landing page hero copy, value props, social proof. Founder-driven; cycle includes copy ideation as part of design-time work.
4. **Stub data freshness (Risk R-15)** — sample dates need runtime generation (`today + N days`) so demo doesn't stale.
5. **Refinement loop discipline** — founder must sign off per cycle. If a cycle drags through 3+ refinement rounds, escalate to roadmap re-scoping.

---

**End of roadmap. Companion audit at `Mingla_Artifacts/reports/AUDIT_BIZ_JOURNEY_GAPS.md`.**
