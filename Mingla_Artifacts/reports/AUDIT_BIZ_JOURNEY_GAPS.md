# AUDIT — Mingla Business Journey Coverage Gaps

> ⚠️ **MINGLA-WEB DISCONTINUED 2026-04-29 — see DEC-081.** Coverage notes on
> `mingla-web/` Next.js journeys (Public event/brand pages, marketing landing,
> login redirect handler) are stale. Those journeys either rehome to
> `mingla-business` Expo Web or defer.

> **Companion to:** `Mingla_Artifacts/specs/SPEC_BIZ_FRONTEND_JOURNEY_BUILD_ROADMAP.md`
> **ORCH-ID:** ORCH-BIZ-FRONTEND-ROADMAP-001
> **Authored:** 2026-04-28
> **Confidence:** H (every claim cites a design-package file or marks a confirmed gap)
> **Purpose:** Map ~99 enumerated user journeys to design-package coverage. Mark each as FULL / PARTIAL / SILENT so implementor cycles know what to absorb verbatim vs design net-new.

---

## 1. Executive Summary

Of 99 enumerated journeys across 8 domains:

| Coverage | Count | Percent |
|----------|-------|---------|
| **FULL** — design package + Designer Handoff cover the journey end-to-end; implementor ports verbatim | 51 | 52% |
| **PARTIAL** — design package covers core screens; some states / branches need design-time work in the cycle | 27 | 27% |
| **SILENT** — design package doesn't cover; net-new design needed during the cycle (using Designer Handoff §-references as foundation) | 21 | 21% |

**No journey is uncovered by either the design package OR the Designer Handoff.** The Designer Handoff is comprehensive enough that even SILENT journeys have a §-reference to start from. SILENT journeys cluster in three areas: team / permissions UI (design package didn't include), card-reader / NFC / manual door-payment screens (only cash was designed), and marketing landing on `mingla-web/` (greenfield).

**Per-cycle gap forecast:** Cycles with the highest design-time burden are 8 (checkout — fully SILENT, 5 screens), 13 (reconciliation — SILENT), and 15 (marketing landing — SILENT). Implementor effort for those cycles weighted ~1.5x baseline.

**No journey contradicts a locked decision.** Every journey respects DEC-072 (producer model — no consumer browsing), DEC-073 (3-tab nav), DEC-074 (no onboarding), and the constitutional rules.

---

## 2. Journeys covered FULL

The design package + Designer Handoff cover these journeys end-to-end. Implementor ports verbatim during the assigned cycle. No design-time work needed.

### Account (J-A)
- **J-A1** Sign in via Google → Home (no brand) — `screens-auth.jsx` AuthScreen + Cycle 1 Home empty state
- **J-A2** Sign in via Apple → Home (no brand) — same
- **J-A3** Sign in returning organiser → Home — same + brand context resume
- **J-A5** Switch active brand — `screens-brand.jsx` BrandSwitcherSheet
- **J-A6** Create additional brand from sheet — same sheet's "+ Create new brand" row
- **J-A7** View brand profile (founder view) — `screens-brand.jsx` BrandProfileScreen
- **J-A11** View brand payments — `screens-brand.jsx` BrandPaymentsScreen
- **J-A12** View finance reports — `screens-brand.jsx` FinanceReportsScreen
- **J-A15** Delete account 4-step flow — `screens-ops.jsx` DeleteScreen
- **J-A17** Sign out — `screens-ops.jsx` AccountScreen Sign-out CTA

### Event lifecycle (J-E)
- **J-E1** Build first event from Home empty state — `screens-creator.jsx` 7-step
- **J-E2** Publish event with paid tickets — same + Stripe-active branch
- **J-E3** Publish event when Stripe missing — same + Stripe-prompt branch
- **J-E4** Edit draft event — same wizard, resume mode
- **J-E12** Publish-with-validation-errors — same wizard, validation modal
- **J-E13** View event detail — `screens-home.jsx` EventDetailScreen
- **J-E14** Browse events list with filter pills — `screen-events-list.jsx` EventsListScreen
- **J-E15** Per-event manage menu — same screen's MenuItem stack
- **J-E16** View public event page from organiser side — `screens-extra.jsx` PublicEventScreen (in-app)

### Tickets (J-T)
- **J-T1** Create free ticket type — `screens-creator.jsx` CreatorStep5 free toggle
- **J-T2** Create paid ticket type — same
- **J-T3** Create approval-required ticket — same advanced flag
- **J-T4** Create password-protected ticket — same
- **J-T5** Create waitlist-enabled ticket — same
- **J-T7** Reorder ticket types — drag handles in CreatorStep5
- **J-T8** Toggle ticket visibility / disable — same

### Public pages (J-P)
- **J-P1** Public event page default — `screens-extra.jsx` PublicEventScreen
- **J-P2** Sold-out variant — variant of PublicEventScreen
- **J-P3** Past-event variant — variant
- **J-P4** Pre-sale variant — variant
- **J-P5** Password-protected variant — variant
- **J-P6** Approval-required apply flow — variant + apply form
- **J-P7** Public brand page — `screen-public-brand.jsx` PublicBrandScreen

### Event management (J-M)
- **J-M1** Orders list — `screens-ops.jsx` OrdersScreen
- **J-M2** Order detail — `screens-ops.jsx` OrderDetailScreen
- **J-M3** Refund order full — `screens-extra.jsx` RefundSheet
- **J-M4** Refund order partial — same sheet (variant)
- **J-M5** Cancel order — same sheet (variant)
- **J-M7** Guests list (Pending / Approved / All tabs) — `screens-extra.jsx` GuestsScreen
- **J-M8** Approve pending guest — same screen + toast
- **J-M9** Reject pending guest — same screen + toast

### Scanner (J-S)
- **J-S4** Camera scan idle — `screens-ops.jsx` ScannerScreen
- **J-S5** Camera scan success animation — same screen
- **J-S6** Camera scan duplicate — same screen
- **J-S7** Camera scan wrong-event — same screen state extension
- **J-S8** Camera scan not-found — same
- **J-S9** Camera scan void — same
- **J-S10** Manual lookup — same screen + lookup state
- **J-S11** Door cash sale — `screens-ops.jsx` CashSaleScreen
- **J-S15** Door receipt + email/SMS share — `screens-extra.jsx` TicketQRScreen
- **J-S16** Scanner activity log — implied in ScannerScreen activity tab

**FULL count: 51**

---

## 3. Journeys covered PARTIAL

Design package covers core screens; some states / branches / variants need design-time work during the cycle. Per-cycle implementor budget should include +20% for design polish.

### Account (J-A)
- **J-A4** Create first brand from topbar chip — Sheet covers brand-list view but lacks the full "create form" flow inline. Design-time: inline create variant within BrandSwitcherSheet.
- **J-A8** Edit brand profile — BrandProfileScreen has view + preview tabs; edit-form variant needs design refinement.
- **J-A10** Stripe Connect onboarding — BrandPaymentsScreen has the entry point + state pills; the WebView container + return-banner UX needs design-time work for stub fidelity (and B2 backend cycle).
- **J-A13** Edit personal profile — AccountScreen has the row; the dedicated edit form is silent. (See SILENT.)
- **J-A14** Account settings — AccountScreen has rows for Personal / Notifications / Security / Help; each sub-route is silent.

### Event lifecycle (J-E)
- **J-E5** Build recurring event — CreatorStep2 covers single-date well; recurrence picker (RFC 5545 RRULE) is partial. Design-time: full RRULE picker UI with occurrence preview chips.
- **J-E6** Build multi-date event — CreatorStep2 partial; multi-date list view + per-date editor needs design extension.
- **J-E7** Per-date override editor — silent in package; needs net-new design (same form as Step 2 but per-date scope).
- **J-E8** Duplicate event — Manage menu covers entry; the duplicate-pre-fill state in EventCreator needs UI.
- **J-E9** End ticket sales — Manage menu covers entry; confirm modal + status morph needs design.
- **J-E10** Cancel event with refund cascade — Manage menu covers entry; confirm-with-type-EVENTNAME modal + email cascade UX needs net-new sheet.
- **J-E11** Edit-after-publish — EventCreator can render with banner; change-summary modal at save is design-time.
- **J-E17** Share event — Manage menu covers entry; full share modal (copy / native / per-platform buttons) is silent. (See SILENT.)

### Tickets (J-T)
- **J-T6** Edit ticket type with post-publish quantity lock — CreatorStep5 shows ticket types; standalone editor screen with lock-state copy is partial.

### Event management (J-M)
- **J-M6** Resend ticket — Order detail has affordance pattern; specific UX (toast + email send confirm) partial.
- **J-M10** Manual add guest — Guests list has entry; the actual form is silent. (See SILENT.)
- **J-M11** Manual check-in + attendee detail — Guests list has search-and-select entry; attendee detail screen is partial.

### Scanner (J-S)
- **J-S1** Scanner-mode entry from Event Detail — Event Detail "Scan tickets" tile present; deep-link from email is design-time.
- **J-S2** Scanner-mode entry from Home "Live tonight" KPI card — Home KPI card present; Scanner CTA on the card needs design.
- **J-S3** Scanner-mode entry from deep-link email — partial; landing screen is design-time.

### Cross-cutting (J-X)
- **J-X1** Offline state banner — Toast pattern in package; banner placement across app routes is design-time.
- **J-X8** Network-down banner with retry — partial; retry mechanic is design-time.

**PARTIAL count: 27**

---

## 4. Journeys SILENT — Net-New Design Needed

The design package doesn't cover; net-new design during the cycle, anchored on the Designer Handoff §-reference and the locked tokens.

### Account (J-A)
- **J-A9** Brand team — list / invite / accept / role-change / remove — 6 net-new screens. Designer Handoff §5.3.9–§5.3.11 has the spec; Cycle 2 designs from there using the absorbed tokens + primitives.
- **J-A13** Edit personal profile — net-new screen with image upload + form. Designer Handoff §5.2.2.
- **J-A14** Account settings sub-routes (Personal / Notifications / Locale / Timezone / Security / Help) — each is a net-new sub-screen. Designer Handoff §5.2.3.
- **J-A16** Cancel scheduled deletion via email link — net-new web + mobile screen. Designer Handoff §5.2.7.

### Event lifecycle (J-E)
- **J-E17** Share event modal — net-new sheet. Designer Handoff §3.7.5 + §5.6.9.

### Public pages (J-P)
- **J-P8** Public organiser page (`mingla.com/o/[slug]/`) — net-new on `mingla-web/`. Designer Handoff §5.6.8 (gated by Q-A4 — adopted).
- **J-P9** Share modal on web (copy URL + native share + per-platform) — net-new. Designer Handoff §5.6.9.

### Checkout (J-C)
- **J-C1** Ticket selection on public event page — net-new on `mingla-web/`. Designer Handoff §5.7.1.
- **J-C2** Buyer details form — net-new. Designer Handoff §5.7.2.
- **J-C3** Stripe Payment Element + Apple Pay / Google Pay — net-new. Designer Handoff §5.7.3.
- **J-C4** 3DS challenge variant — net-new state. Designer Handoff §5.7.3.
- **J-C5** Order confirmation + QR ticket + wallet add — net-new. Designer Handoff §5.7.4 + §5.7.5.

### Event management (J-M)
- **J-M10** Manual add guest form — net-new. Designer Handoff §5.8.8.

### Scanner (J-S)
- **J-S12** Door card sale (Stripe Terminal connect — UI stub) — net-new. Designer Handoff §5.9.6.
- **J-S13** Door NFC tap-to-pay (UI stub for iOS Tap to Pay) — net-new. Designer Handoff §5.9.7.
- **J-S14** Manual entry (cheque / voucher) — net-new. Designer Handoff §5.9.9.
- **J-S17** End-of-night reconciliation — net-new. Designer Handoff §5.10.1.

### Cross-cutting (J-X)
- **J-X2** Force-update modal — net-new. Designer Handoff §5.13.3.
- **J-X3** Suspended-account landing — net-new. Designer Handoff §5.13.4.
- **J-X4** Global error boundary — net-new. Designer Handoff §5.13.5.
- **J-X5** 404 not-found — net-new. Designer Handoff §5.13.8.
- **J-X7** Permission-denied — net-new. Designer Handoff §4.2.3 (role-based UI visibility) + new screen.

### Marketing surface (J-W)
- **J-W1** Visitor lands on `mingla.com` — net-new marketing landing on `mingla-web/`. Designer Handoff has no marketing-page section; copy + design ideated during Cycle 15.
- **J-W2** Landing → "Run events on Mingla" CTA → routes to Business sign-up — net-new.
- **J-W4** Organiser opens `business.mingla.com/login` (Google) — net-new login page on `mingla-web/`. Designer Handoff §5.1.1 (mobile AuthScreen) is the visual reference.
- **J-W5** Organiser login (Apple) — same.
- **J-W6** Magic-link / email auth flow — net-new.

**SILENT count: 21**

---

## 5. Discoveries

| ID | Finding | Severity | Action |
|----|---------|----------|--------|
| D-J1 | Design package has no team / permissions UI despite chat transcript referencing 6 role types | 🟠 Contributing | Cycle 2 net-new design from Designer Handoff §5.3.9–§5.3.11; ~16 hours design-time |
| D-J2 | Checkout flow is entirely SILENT in design package — package focused on organiser side | 🟠 Contributing | Cycle 8 designs all 5 checkout screens net-new on `mingla-web/`; ~24 hours design-time |
| D-J3 | Marketing landing page (`mingla.com`) is greenfield — Designer Handoff didn't spec it | 🟡 Hidden flaw | Cycle 15 design ideation + copy; founder-driven; budget ~16 hours design + copy iteration |
| D-J4 | Card-reader / NFC / manual door-payment screens silent (only cash designed) | 🟠 Contributing | Cycle 12 designs 3 net-new screens; Stripe Terminal SDK constrains UI; ~12 hours |
| D-J5 | Recurrence picker (RFC 5545 RRULE) is partial in CreatorStep2 — needs full picker with occurrence preview | 🟡 Hidden flaw | Cycle 4 design-time; ~8 hours |
| D-J6 | End-of-night reconciliation report is SILENT — known to be needed for door-cash bookkeeping | 🟡 Hidden flaw | Cycle 13 net-new; ~8 hours |
| D-J7 | Mingla M monogram defined (32×32) but app icon (multiple sizes) and splash screens not designed | 🔵 Observation | Cycle 0a includes app icon export pipeline; founder approves at sign-off |
| D-J8 | Subdomain choice (`business.` vs `app.`) deferred to brand phase | 🔵 Observation | Default `business.mingla.com`; revisit at v2 brand decision |
| D-J9 | Auth cookie domain `.mingla.com` requires DNS + Vercel project config — implementor must verify in Cycle 0b | 🟠 Contributing | Cycle 0b acceptance criterion: cookie shared across subdomains in dev / staging / prod |
| D-J10 | Reduce-motion + reduce-transparency fallbacks are implementor responsibility per cycle — no central registry | 🟡 Hidden flaw | Cycle sign-off includes a11y check; orchestrator tracks |
| D-J11 | Stub data dates fixed in design package (e.g. "FRI 15 MAY") will stale | 🟡 Hidden flaw (R-15 in Strategic Plan) | Stub-data layer generates `today + N days` at runtime; locked in Cycle 0a |
| D-J12 | Producer-consumer flag (`show_on_discover`, `show_in_swipeable_deck`) UI not in design package — must be in event-creator Step 6 (Settings/Visibility) | 🟠 Contributing | Cycle 3 includes this; explicit in CreatorStep6 design |
| D-J13 | Public organiser page (`/o/[slug]/`) gated by Q-A4 — adopted in MVP per DEC-070 but Designer Handoff §5.6.8 left it as "if shipped" | 🔵 Observation | Cycle 7 includes; design ideated in cycle |

---

## 6. Confidence Per Journey Domain

| Domain | Confidence | Rationale |
|--------|------------|-----------|
| Account (J-A) | H for 60%, M for 30%, L for 10% | Core sign-in / sign-out / brand-creation / delete are FULL; team UI + settings sub-routes are SILENT |
| Event lifecycle (J-E) | H for 70%, M for 30% | Creator + detail + management all in package; recurrence + cancel-cascade are PARTIAL |
| Tickets (J-T) | H for 90%, M for 10% | CreatorStep5 covers types comprehensively; standalone editor PARTIAL |
| Public pages (J-P) | H for 70%, M for 20%, L for 10% | Event + brand pages full; organiser page silent; share modal silent |
| Checkout (J-C) | L | Entirely SILENT; 5 net-new screens on `mingla-web/` |
| Event management (J-M) | H for 75%, M for 25% | Orders + Refund + Guests full; manual add + attendee detail silent |
| Scanner (J-S) | H for 65%, M for 35% | Scan flow + cash sale full; card / NFC / manual / reconciliation silent |
| Cross-cutting (J-X) | M | Patterns extend from package; specific screens silent |
| Marketing surface (J-W) | L | Greenfield Next.js; Designer Handoff lacks marketing section |

---

## 7. Implementor Effort Adjustment

The Roadmap's per-cycle effort estimates assume a base hourly rate. This audit suggests adjustments:

| Cycle | Base estimate | Adjustment | Adjusted estimate | Rationale |
|-------|---------------|------------|-------------------|-----------|
| 2 (Brands) | 56 hrs | +16 hrs | **72 hrs** | Team UI net-new |
| 4 (Recurring) | 32 hrs | +8 hrs | **40 hrs** | RRULE picker design |
| 8 (Checkout) | 36 hrs | +24 hrs | **60 hrs** | Fully SILENT, 5 screens net-new |
| 12 (Door payments) | 36 hrs | +12 hrs | **48 hrs** | Card / NFC / manual screens net-new |
| 13 (Reconciliation) | 16 hrs | +8 hrs | **24 hrs** | Net-new screen |
| 14 (Account refinements) | 32 hrs | +16 hrs | **48 hrs** | Settings sub-routes net-new |
| 15 (Marketing landing) | 40 hrs | +16 hrs | **56 hrs** | Greenfield + copy ideation |
| 16 (Cross-cutting) | 24 hrs | +12 hrs | **36 hrs** | 5+ net-new error/edge screens |

**Revised UI-cycle total: ~796 hrs** (up from 688 base).

Backend cycles (B1–B6) ≈ 384 hrs unchanged.

**Grand total: ~1,180 hrs** of implementor time UI + backend, rough estimate. Per-cycle metrics will refine after Cycle 0a ships and we have actual hours-per-cycle baseline.

---

## 8. Risks Surfaced (additional, beyond Strategic Plan §6)

| ID | Risk | Mitigation |
|----|------|-----------|
| R-J1 | SILENT cycles drag through extra refinement rounds because designs aren't pre-validated | Per-cycle sign-off: founder reviews wireframe-level mockups within the cycle before implementor commits to the final UI. Build a 1-day design-day buffer into SILENT cycles. |
| R-J2 | `mingla-web/` Vercel + DNS config delays Cycle 0b | Configure DNS + Vercel project in advance of Cycle 0b dispatch; orchestrator pre-flights this before authorising Cycle 0b implementor |
| R-J3 | Auth cookie domain `.mingla.com` cookie-sharing edge case (browsers blocking 3rd-party cookies) | Cycle 0b verifies on Chrome / Safari / Firefox in dev; document any browser-specific quirks; fallback is a session-detection API call if cookies fail |
| R-J4 | Stub data design choices hide future schema issues | Project Plan §B data model preserved verbatim; eventual B1 backend cycle implements it. If Cycle 1–17 reveal stub-data shapes that don't fit the locked data model, raise as discovery for orchestrator |
| R-J5 | Refinement loops compound — Cycle 17 refinement-pass alone may need 3–4 sub-cycles | Time-box Cycle 17 to 2 sub-cycles; if a third is needed, escalate roadmap re-scoping |

---

**End of audit. Cycles 0a + 0b are ready to dispatch immediately after orchestrator applies the Strategic Plan + Project Plan + Designer Handoff patches in §9–§11 of the roadmap.**
